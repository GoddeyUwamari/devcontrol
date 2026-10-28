/**
 * OB2: Last seen, checked at and inventory coverage across sweeps, against
 * real Postgres with the 202610281200 tables (CI bootstrap), and the storage's
 * isolation by organization, AWS account and region.
 *
 * The sweep tests drive CloudWatchService.getMetrics() (a fresh instance per
 * test, so no cache is shared) with fake AWS clients. The connecting role is a
 * superuser in CI and locally, which row-level security never restricts, so
 * the RLS assertions run after SET LOCAL ROLE devcontrol in a transaction that
 * is always rolled back. Placeholders only.
 */
import { Pool, PoolClient } from 'pg'
import { CloudWatchService } from '../cloudwatch.service'
import { AWSClientFactory } from '../aws-client-factory.service'
import awsCostService from '../aws-cost.service'
import { pool as appPool, requestContext } from '../../config/database'
import { recordObservations, readInventoryCapped } from '../../repositories/observability-observations.repository'
import { DATAPOINT_AT, deleteFleetOrgs, fakeClients, insertFleetOrg, mixedFleet, MetricBehaviour, REGION } from '../../routes/__tests__/observability-fleet-fixture'

function dbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  }
}

const pool = new Pool(dbConfig())
const createdOrgIds: string[] = []
const EARLIER = new Date('2026-10-27T18:20:00.000Z')
const OTHER_ACCOUNT = '111122223333'

const oneEc2 = (accountId: string) => mixedFleet(accountId).filter((r) => r.name === 'web-running')
const ec2 = (behaviour: MetricBehaviour) => ({ 'i-1234567890abcdef0': behaviour })
const ok: MetricBehaviour = { kind: 'values', byMetric: { StatusCheckFailed: 0, CPUUtilization: 12 } }

async function sweep(orgId: string, accountId: string, metrics: Record<string, MetricBehaviour>, datapointAt?: Date) {
  jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue(fakeClients({ metrics, accountId, datapointAt }))
  const result = await new CloudWatchService().getMetrics(orgId, '1h', true)
  jest.restoreAllMocks()
  jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockResolvedValue({ total: 0 } as any)
  const snapshot = result!.observability!
  return { snapshot, row: snapshot.rows.find((r) => r.row.name === 'web-running')?.row as any }
}

async function storedRow(orgId: string) {
  const { rows } = await pool.query(
    `SELECT aws_account_id, region, last_datapoint_at, last_successful_check_at FROM resource_telemetry_observations WHERE organization_id = $1`,
    [orgId]
  )
  return rows
}

async function newOrg(label: string, fleetFor = oneEc2) {
  const fleet = await insertFleetOrg(pool, label, fleetFor)
  createdOrgIds.push(fleet.orgId)
  return fleet
}

beforeEach(() => {
  jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockResolvedValue({ total: 0 } as any)
})
afterEach(() => jest.restoreAllMocks())
afterAll(async () => {
  await deleteFleetOrgs(pool, createdOrgIds)
  await pool.end()
})

describe('Last seen across sweeps', () => {
  it('(L1-L3) persisted, kept through an empty window and a denied one, while telemetry reports each sweep', async () => {
    const { orgId, accountId, idsByName } = await newOrg('sequence')

    // L1: a datapoint is observed and stored under (org, account, region, resource).
    const first = await sweep(orgId, accountId, ec2(ok))
    expect(first.row).toMatchObject({ check_status: 'passing', telemetry: 'reporting', last_seen: DATAPOINT_AT.toISOString() })
    const afterFirst = await storedRow(orgId)
    expect(afterFirst).toHaveLength(1)
    expect(afterFirst[0]).toMatchObject({ aws_account_id: accountId, region: REGION, last_datapoint_at: DATAPOINT_AT })
    const firstCheck: Date = afterFirst[0].last_successful_check_at
    expect(firstCheck).toBeInstanceOf(Date)
    const { rows: ids } = await pool.query('SELECT resource_id FROM resource_telemetry_observations WHERE organization_id = $1', [orgId])
    expect(ids[0].resource_id).toBe(idsByName['web-running'])

    // L2: a later window with no datapoints keeps Last seen; telemetry is this sweep's, not stale.
    const second = await sweep(orgId, accountId, ec2({ kind: 'empty' }))
    expect(second.row).toMatchObject({ telemetry: 'no_telemetry', unknown_reason: 'no_telemetry', last_seen: DATAPOINT_AT.toISOString() })
    const afterSecond = await storedRow(orgId)
    expect(afterSecond[0].last_datapoint_at).toEqual(DATAPOINT_AT)
    expect(afterSecond[0].last_successful_check_at.getTime()).toBeGreaterThanOrEqual(firstCheck.getTime())

    // L3: a denied query keeps Last seen and does not advance the last successful check.
    const third = await sweep(orgId, accountId, ec2({ kind: 'forbidden' }))
    expect(third.row).toMatchObject({ check_status: 'unknown', unknown_reason: 'access_denied', telemetry: 'unknown', last_seen: DATAPOINT_AT.toISOString() })
    const afterThird = await storedRow(orgId)
    expect(afterThird[0].last_successful_check_at).toEqual(afterSecond[0].last_successful_check_at)
  })

  it('(L4) an older datapoint never moves Last seen back', async () => {
    const { orgId, accountId } = await newOrg('older')
    await sweep(orgId, accountId, ec2(ok))
    const older = await sweep(orgId, accountId, ec2(ok), EARLIER)
    expect(older.row.last_seen).toBe(DATAPOINT_AT.toISOString())
    expect((await storedRow(orgId))[0].last_datapoint_at).toEqual(DATAPOINT_AT)
  })

  it('(L5) with nothing stored and no datapoint, Last seen is null', async () => {
    const { orgId, accountId } = await newOrg('nothing')
    const { row } = await sweep(orgId, accountId, ec2({ kind: 'empty' }))
    expect(row).toMatchObject({ last_seen: null, last_seen_source: null, telemetry: 'no_telemetry' })
  })

  it('outside-account and outside-region resources are never recorded', async () => {
    const { orgId, accountId } = await newOrg('scope', (a) => mixedFleet(a).filter((r) => r.name === 'web-other-region' || r.name === 'web-other-account'))
    const { snapshot } = await sweep(orgId, accountId, {
      'i-0dddddddddddddddd': ok,
      'i-0eeeeeeeeeeeeeeee': ok,
    })
    expect(snapshot.rows.map((r) => r.row.unknown_reason).sort()).toEqual(['outside_account', 'outside_region'])
    expect(await storedRow(orgId)).toEqual([])
  })
})

describe('checked_at', () => {
  it('(P3) a partial sweep never advances the last fully successful check', async () => {
    const { orgId, accountId } = await newOrg('checked-at')
    const before = Date.now()
    const complete = await sweep(orgId, accountId, ec2(ok))
    expect(complete.snapshot.collection).toBe('complete')
    const checkedAt = complete.snapshot.checkedAt!
    expect(new Date(checkedAt).getTime()).toBeGreaterThanOrEqual(before - 1000)

    const partial = await sweep(orgId, accountId, ec2({ kind: 'forbidden' }))
    expect(partial.snapshot.collection).toBe('partial')
    expect(partial.snapshot.checkedAt).toBe(checkedAt)

    const { rows } = await pool.query(`SELECT last_attempt_outcome FROM observability_collection_scopes WHERE organization_id = $1`, [orgId])
    expect(rows).toEqual([{ last_attempt_outcome: 'partial' }])
  })

  it('(P4) a first sweep that is partial has no checked_at', async () => {
    const { orgId, accountId } = await newOrg('first-partial')
    const { snapshot } = await sweep(orgId, accountId, ec2({ kind: 'forbidden' }))
    expect(snapshot.checkedAt).toBeNull()
  })
})

describe('inventory coverage', () => {
  it('(P6) capped from the newest finished discovery job: truncated -> true, clean -> false, none -> null', async () => {
    const { orgId } = await newOrg('coverage')
    expect(await readInventoryCapped(appPool, orgId)).toEqual({ capped: null, reasons: [] })

    await pool.query(
      `INSERT INTO resource_discovery_jobs (organization_id, status, completed_at, warnings) VALUES ($1, 'completed', NOW() - INTERVAL '2 hours', '["discovery_listing_truncated"]'::jsonb)`,
      [orgId]
    )
    expect(await readInventoryCapped(appPool, orgId)).toEqual({ capped: true, reasons: ['discovery_listing_truncated'] })

    await pool.query(`INSERT INTO resource_discovery_jobs (organization_id, status, completed_at, warnings) VALUES ($1, 'completed', NOW(), '[]'::jsonb)`, [orgId])
    expect(await readInventoryCapped(appPool, orgId)).toEqual({ capped: false, reasons: [] })

    // A job still running is not a finished inventory.
    await pool.query(`INSERT INTO resource_discovery_jobs (organization_id, status, warnings) VALUES ($1, 'running', '["deletion_detection_paused_truncated_index"]'::jsonb)`, [orgId])
    expect((await readInventoryCapped(appPool, orgId)).capped).toBe(false)
  })
})

describe('storage isolation and failure', () => {
  async function asDevcontrol<T>(organizationId: string, work: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect()
    try {
      await c.query('BEGIN')
      await c.query('SET LOCAL ROLE devcontrol')
      const { rows } = await c.query(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`)
      expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false })
      await c.query(`SELECT set_config('app.current_organization_id', $1, true)`, [organizationId])
      return await work(c)
    } finally {
      await c.query('ROLLBACK').catch(() => {})
      c.release()
    }
  }

  it('(L7) RLS: devcontrol tagged as org A sees none of org B, and cannot write for org B', async () => {
    const a = await newOrg('rls-a')
    const b = await newOrg('rls-b')
    await recordObservations(appPool, { organizationId: b.orgId, awsAccountId: b.accountId, region: REGION }, [
      { resourceDbId: b.idsByName['web-running'], lastDatapointAt: DATAPOINT_AT, lastSuccessfulCheckAt: null },
    ], 'complete', new Date())

    await asDevcontrol(a.orgId, async (c) => {
      const seen = await c.query(`SELECT organization_id FROM resource_telemetry_observations WHERE organization_id = $1`, [b.orgId])
      expect(seen.rows).toEqual([])
      const scopes = await c.query(`SELECT organization_id FROM observability_collection_scopes WHERE organization_id = $1`, [b.orgId])
      expect(scopes.rows).toEqual([])
      await c.query('SAVEPOINT s')
      await expect(
        c.query(
          `INSERT INTO resource_telemetry_observations (organization_id, aws_account_id, region, resource_id, last_datapoint_at) VALUES ($1, $2, $3, $4, NOW())`,
          [b.orgId, b.accountId, REGION, b.idsByName['web-running']]
        )
      ).rejects.toThrow(/row-level security/)
      await c.query('ROLLBACK TO SAVEPOINT s')
    })
  })

  it('(L7b) devcontrol has SELECT, INSERT, UPDATE and nothing else; both tables force RLS', async () => {
    const { rows } = await pool.query(
      `SELECT table_name, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privileges
         FROM information_schema.role_table_grants
        WHERE grantee = 'devcontrol' AND table_name IN ('resource_telemetry_observations', 'observability_collection_scopes')
        GROUP BY table_name ORDER BY table_name`
    )
    expect(rows).toEqual([
      { table_name: 'observability_collection_scopes', privileges: 'INSERT,SELECT,UPDATE' },
      { table_name: 'resource_telemetry_observations', privileges: 'INSERT,SELECT,UPDATE' },
    ])
    const { rows: rls } = await pool.query(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN ('resource_telemetry_observations', 'observability_collection_scopes') ORDER BY relname`
    )
    expect(rls.every((r: any) => r.relrowsecurity && r.relforcerowsecurity)).toBe(true)
  })

  it('(L8/L9) a read names org, account and region: another account or region gets nothing', async () => {
    const { orgId, accountId, idsByName } = await newOrg('scope-keys')
    const write = [{ resourceDbId: idsByName['web-running'], lastDatapointAt: DATAPOINT_AT, lastSuccessfulCheckAt: null }]
    const own = await recordObservations(appPool, { organizationId: orgId, awsAccountId: accountId, region: REGION }, write, 'complete', new Date())
    expect(own.stored.get(idsByName['web-running'])?.lastDatapointAt).toEqual(DATAPOINT_AT)

    const otherAccount = await recordObservations(appPool, { organizationId: orgId, awsAccountId: OTHER_ACCOUNT, region: REGION }, [], 'complete', new Date())
    expect(otherAccount.stored.size).toBe(0)
    const otherRegion = await recordObservations(appPool, { organizationId: orgId, awsAccountId: accountId, region: 'eu-west-1' }, [], 'complete', new Date())
    expect(otherRegion.stored.size).toBe(0)
  })

  it('(L6) a missing table is no stored history, never an error; checked_at falls back to this sweep only when complete', async () => {
    const missing = Object.assign(new Error('relation "resource_telemetry_observations" does not exist'), { code: '42P01' })
    const fakeDb = {
      connect: async () => ({
        query: async (sql: string) => {
          if (/^(BEGIN|ROLLBACK)|set_config/.test(sql)) return { rows: [] }
          throw missing
        },
        release: () => {},
      }),
    } as any
    const sweepAt = new Date('2026-10-28T10:00:00.000Z')
    const scope = { organizationId: '00000000-0000-4000-8000-00000000000a', awsAccountId: OTHER_ACCOUNT, region: REGION }
    expect(await recordObservations(fakeDb, scope, [], 'complete', sweepAt)).toEqual({ stored: new Map(), lastFullSuccessAt: sweepAt, persisted: false })
    expect(await recordObservations(fakeDb, scope, [], 'partial', sweepAt)).toEqual({ stored: new Map(), lastFullSuccessAt: null, persisted: false })
  })

  it('(L10) writes use their own connection, never the request one (which may already be released)', async () => {
    const { orgId, accountId, idsByName } = await newOrg('own-connection')
    const released = { query: () => Promise.reject(new Error('request connection already released')) } as any
    const result = await requestContext.run(released, () =>
      recordObservations(appPool, { organizationId: orgId, awsAccountId: accountId, region: REGION }, [
        { resourceDbId: idsByName['web-running'], lastDatapointAt: DATAPOINT_AT, lastSuccessfulCheckAt: null },
      ], 'complete', new Date())
    )
    expect(result.persisted).toBe(true)
    expect(await storedRow(orgId)).toHaveLength(1)
  })

  it('deleting the resource deletes its observations (composite foreign key, cascade)', async () => {
    const { orgId, accountId, idsByName } = await newOrg('cascade')
    await recordObservations(appPool, { organizationId: orgId, awsAccountId: accountId, region: REGION }, [
      { resourceDbId: idsByName['web-running'], lastDatapointAt: DATAPOINT_AT, lastSuccessfulCheckAt: null },
    ], 'complete', new Date())
    await pool.query('DELETE FROM aws_resources WHERE id = $1', [idsByName['web-running']])
    expect(await storedRow(orgId)).toEqual([])
  })
})
