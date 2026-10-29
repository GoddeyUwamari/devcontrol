/**
 * GET /api/observability/resources (OB2): every state the contract defines,
 * for a real mixed fleet in Postgres with fake AWS clients; the per-type
 * summary reconciling over the whole fleet on every page; the page-level
 * states (not connected, more than one account, a connection that can't be
 * used); and that the organization is always the caller's.
 *
 * Auth is real (authService.verifyToken stubbed to a fixed payload), as in
 * cloudwatch-metrics-pagination.test.ts. Placeholders only.
 */
import express from 'express'
import fs from 'fs'
import path from 'path'
import http from 'http'
import { Pool } from 'pg'
import observabilityResourcesRoutes from '../observability-resources.routes'
import cloudwatchRoutes from '../cloudwatch.routes'
import observabilityRoutes from '../observability.routes'
import { authService } from '../../services/auth.service'
import { AWSClientFactory } from '../../services/aws-client-factory.service'
import awsCostService from '../../services/aws-cost.service'
import { PlatformAwsCredentialsUnavailableError, PLATFORM_AWS_UNAVAILABLE_MESSAGE } from '../../services/platform-sts'
import { ensureSharedFixtureTable } from './shared-fixture-tables'
import * as accountsRepository from '../../repositories/aws-accounts.repository'
import { AwsAccountAmbiguousError } from '../../repositories/aws-accounts.repository'
import {
  DATAPOINT_AT,
  deleteFleetOrgs,
  fakeClients,
  insertFleetOrg,
  mixedFleet,
  mixedMetrics,
} from './observability-fleet-fixture'

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
const createdUserIds: string[] = []
let server: http.Server
let baseUrl: string

beforeAll(async () => {
  const app = express()
  app.use(express.json())
  // As server.ts mounts them (/api/system serves the shared observability router only).
  app.use('/api/observability', observabilityRoutes)
  app.use('/api/observability', observabilityResourcesRoutes)
  app.use('/api/system', observabilityRoutes)
  app.use('/api/cloudwatch', cloudwatchRoutes)
  server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, resolve))
  const address = server.address()
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api`
  await ensureSharedFixtureTable(pool, 'aws_accounts')
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await deleteFleetOrgs(pool, createdOrgIds)
  if (createdUserIds.length > 0) await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds])
  await pool.end()
})

beforeEach(() => {
  jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockResolvedValue({ total: 42 } as any)
})
afterEach(() => jest.restoreAllMocks())

async function signInAs(orgId: string): Promise<void> {
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Observability Route User') RETURNING id`,
    [`obs-route-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`]
  )
  createdUserIds.push(rows[0].id)
  await pool.query(
    `INSERT INTO organization_memberships (organization_id, user_id, role, joined_at, is_active) VALUES ($1, $2, 'viewer', NOW(), true)`,
    [orgId, rows[0].id]
  )
  jest.spyOn(authService, 'verifyToken').mockReturnValue({
    userId: rows[0].id,
    email: 'obs-route@example.com',
    organizationId: orgId,
    role: 'viewer',
    type: 'access',
  } as any)
}

async function mixedOrg(label: string) {
  const fleet = await insertFleetOrg(pool, label, mixedFleet)
  createdOrgIds.push(fleet.orgId)
  await signInAs(fleet.orgId)
  return fleet
}

async function get(path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${path}`, { headers: { Authorization: 'Bearer test-token' } })
  return { status: res.status, body: await res.json() }
}

const byName = (resources: any[]) => Object.fromEntries(resources.map((r) => [r.name, r]))

describe('GET /api/observability/resources', () => {
  it('(R1) 401 without a token', async () => {
    const res = await fetch(`${baseUrl}/observability/resources`)
    expect(res.status).toBe(401)
  })

  it('(R2) one row per state for the mixed fleet', async () => {
    const { accountId } = await mixedOrg('states')
    jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue(fakeClients({ metrics: mixedMetrics(), accountId }))

    const { status, body } = await get('/observability/resources?range=1h&pageSize=100')
    expect(status).toBe(200)
    const data = body.data
    expect(data).toMatchObject({ status: 'ok', region: 'us-east-1', account_count: 1, multiple_accounts: false, range: '1h', collection: 'partial' })
    // The only fully successful collection would be this one, and it was partial.
    expect(data.checked_at).toBeNull()
    expect(data.inventory_capped).toBeNull()

    const r = byName(data.resources)
    const state = (name: string) => [r[name].check_status, r[name].unknown_reason, r[name].telemetry, r[name].activity]
    expect(state('web-running')).toEqual(['passing', null, 'reporting', null])
    expect(r['web-running'].last_seen).toBe(DATAPOINT_AT.toISOString())
    expect(state('web-stopped')).toEqual(['stopped', null, 'no_telemetry', null])
    expect(state('web-denied')).toEqual(['unknown', 'access_denied', 'unknown', null])
    expect(state('web-other-region')).toEqual(['unknown', 'outside_region', 'unknown', null])
    expect(state('web-other-account')).toEqual(['unknown', 'outside_account', 'unknown', null])
    expect(state('app-alb')).toEqual(['needs_attention', null, 'reporting', 'active'])
    expect(state('net-lb')).toEqual(['not_measured', null, 'unknown', null])
    expect(state('idle-fn')).toEqual(['unknown', 'no_activity', 'no_telemetry', 'no_activity'])
    // OB3: RDS is measured; the fixture's fake returns no AWS/RDS datapoints, so this
    // available instance is unknown/no_telemetry (R3), never passing.
    expect(state('example-db')).toEqual(['unknown', 'no_telemetry', 'no_telemetry', null])
    expect(state('orders')).toEqual(['unknown', 'no_telemetry', 'no_telemetry', null])
    expect(state('api-svc')).toEqual(['passing', null, 'reporting', null])
    expect(state('k8s')).toEqual(['passing', null, 'reporting', null])
    expect(state('data-vol')).toEqual(['passing', null, 'reporting', null])
    expect(r['data-vol'].last_seen_source).toBe('observation')
    expect(state('cdn')).toEqual(['passing', null, 'reporting', null])
    expect(state('aurora-main')).toEqual(['passing', null, 'reporting', null])
    expect(state('logs-bucket')).toEqual(['not_measured', null, 'unknown', null])
    expect(state('rest-api')).toEqual(['not_measured', null, 'unknown', null])

    expect(r['app-alb'].metrics).toEqual(
      expect.arrayContaining([{ label: 'Avg latency', value: 740, unit: 'ms', statistic: 'Average', window: '1h' }])
    )
    expect(r['api-svc'].metrics).toEqual(expect.arrayContaining([{ label: 'Running', value: 2, statistic: null, window: 'current' }]))

    // Summary: every type reconciles; unknown and stopped are never passing.
    expect(data.type_summary.ec2).toEqual({ count: 5, passing: 1, needs_attention: 0, failing: 0, other: 4 })
    expect(data.type_summary['load-balancer']).toEqual({ count: 2, passing: 0, needs_attention: 1, failing: 0, other: 1 })
    expect(data.type_summary.lambda).toEqual({ count: 1, passing: 0, needs_attention: 0, failing: 0, other: 1 })
    expect(data.type_summary.rds).toEqual({ count: 1, passing: 0, needs_attention: 0, failing: 0, other: 1 })
    for (const s of Object.values<any>(data.type_summary)) expect(s.passing + s.needs_attention + s.failing + s.other).toBe(s.count)
    const counted = Object.values<any>(data.type_summary).reduce((n, s) => n + s.count, 0)
    expect(counted).toBe(data.pagination.total)
    expect(data.pagination.total).toBe(17)
  })

  it('(R3) pages walk the whole fleet once, and the summary is the whole fleet on every page', async () => {
    const { accountId } = await mixedOrg('paging')
    jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue(fakeClients({ metrics: mixedMetrics(), accountId }))

    const seen: string[] = []
    const summaries: string[] = []
    let cursor: string | null = null
    for (let i = 0; i < 10; i++) {
      const { body } = await get(`/observability/resources?pageSize=5${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
      seen.push(...body.data.resources.map((r: any) => r.name))
      summaries.push(JSON.stringify(body.data.type_summary))
      cursor = body.data.pagination.cursor
      if (!body.data.pagination.has_more) break
    }
    expect(seen).toHaveLength(17)
    expect(new Set(seen).size).toBe(17)
    expect(new Set(summaries).size).toBe(1)
  })

  it('(R4) the query string selects no organization', async () => {
    const other = await insertFleetOrg(pool, 'other', (a) => mixedFleet(a).slice(0, 1))
    createdOrgIds.push(other.orgId)
    const { accountId } = await mixedOrg('own')
    jest.spyOn(AWSClientFactory, 'createClients').mockImplementation(async (orgId: string) => {
      expect(orgId).not.toBe(other.orgId)
      return fakeClients({ metrics: mixedMetrics(), accountId })
    })
    const { body } = await get(`/observability/resources?org=${other.orgId}&organizationId=${other.orgId}&account_id=${other.accountId}&region=eu-west-1`)
    expect(body.data.region).toBe('us-east-1')
    expect(body.data.pagination.total).toBe(17)
  })

  it('(R5) a whole-request throttle: CloudWatch rows unknown/throttled, describe-based rows unaffected', async () => {
    const { accountId } = await mixedOrg('throttled')
    const throttle = Object.assign(new Error('Rate exceeded'), { name: 'ThrottlingException', $metadata: {} })
    jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue(fakeClients({ metrics: mixedMetrics(), accountId, getMetricDataError: throttle }))

    const { body } = await get('/observability/resources?pageSize=100')
    const r = byName(body.data.resources)
    expect([r['web-running'].check_status, r['web-running'].unknown_reason]).toEqual(['unknown', 'throttled'])
    expect([r['idle-fn'].check_status, r['idle-fn'].unknown_reason, r['idle-fn'].activity]).toEqual(['unknown', 'throttled', null])
    expect(r['web-stopped'].check_status).toBe('unknown')
    expect(r['api-svc'].check_status).toBe('passing')
    expect(body.data.collection).toBe('partial')
    expect(body.data.type_summary.ec2.passing).toBe(0)
  })

  it('(R6) InternalError from CloudWatch is unknown/query_failed', async () => {
    const { accountId } = await mixedOrg('internal')
    const metrics = { ...mixedMetrics(), 'i-1234567890abcdef0': { kind: 'internal_error' as const } }
    jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue(fakeClients({ metrics, accountId }))
    const { body } = await get('/observability/resources?pageSize=100')
    const r = byName(body.data.resources)
    expect([r['web-running'].check_status, r['web-running'].unknown_reason, r['web-running'].telemetry]).toEqual(['unknown', 'query_failed', 'unknown'])
  })

  it('(R7) no eligible account: not_connected with no counts', async () => {
    const { rows } = await pool.query(`INSERT INTO organizations (name, slug, display_name) VALUES ($1, $1, $1) RETURNING id`, [
      `obs-fixture-none-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ])
    createdOrgIds.push(rows[0].id)
    await signInAs(rows[0].id)
    const { body } = await get('/observability/resources')
    expect(body.data).toEqual({
      status: 'not_connected',
      account_count: 0,
      multiple_accounts: false,
      region: null,
      checked_at: null,
      type_summary: null,
      resources: null,
      pagination: null,
    })
  })

  it('(R8, B11) two eligible accounts: multiple_accounts, never not_connected; the old route is unchanged (500)', async () => {
    // The aws_accounts fixture allows one row per organization (UNIQUE org_id), so the
    // second eligible account is stubbed at the repository, as aws-account-ambiguous-routes.test.ts does.
    const { orgId } = await mixedOrg('two-accounts')
    jest.spyOn(accountsRepository, 'countEligibleAwsAccounts').mockResolvedValue(2)
    jest.spyOn(accountsRepository, 'findEligibleAwsAccount').mockRejectedValue(new AwsAccountAmbiguousError(orgId, 2))
    const createClients = jest.spyOn(AWSClientFactory, 'createClients')
    const { body } = await get('/observability/resources')
    expect(body.data).toMatchObject({ status: 'multiple_accounts', account_count: 2, multiple_accounts: true, resources: null, type_summary: null })
    expect(createClients).not.toHaveBeenCalled()
    const legacy = await get('/cloudwatch/metrics')
    expect(legacy.status).toBe(500)
  })

  it('(R8b) an ambiguous account found during the sweep (a race with the count) is multiple_accounts too', async () => {
    const { orgId } = await mixedOrg('two-accounts-race')
    jest.spyOn(accountsRepository, 'findEligibleAwsAccount').mockRejectedValue(new AwsAccountAmbiguousError(orgId, 2))
    const { body } = await get('/observability/resources')
    expect(body.data).toMatchObject({ status: 'multiple_accounts', multiple_accounts: true, resources: null })
  })

  it('(R9) an account whose connection cannot be used is failed/connection_failed, not not_connected', async () => {
    await mixedOrg('assume-fails')
    jest.spyOn(AWSClientFactory, 'createClients').mockRejectedValue(new Error('AWS_NOT_CONNECTED: org has not connected an AWS account'))
    const { body } = await get('/observability/resources')
    expect(body.data).toMatchObject({ status: 'failed', reason: 'connection_failed', account_count: 1, resources: null, type_summary: null })
    // The old route keeps its meaning: data null.
    const legacy = await get('/cloudwatch/metrics?refresh=true')
    expect(legacy.body).toEqual({ success: true, data: null, connected: false })
  })

  it('is not served under /api/system', async () => {
    await mixedOrg('system-path')
    const res = await fetch(`${baseUrl}/system/resources`, { headers: { Authorization: 'Bearer test-token' } })
    expect(res.status).toBe(404)
  })

  it('server.ts mounts it at /api/observability only', () => {
    const server = fs.readFileSync(path.join(__dirname, '..', '..', 'server.ts'), 'utf-8')
    const mounts = server.match(/app\.use\([^)]*observabilityResourcesRoutes\)/g)
    expect(mounts).toEqual(["app.use('/api/observability', observabilityResourcesRoutes)"])
  })

  it('(R10) the platform identity being unavailable is a 503; a malformed cursor is a 400', async () => {
    await mixedOrg('platform')
    jest.spyOn(AWSClientFactory, 'createClients').mockRejectedValue(new PlatformAwsCredentialsUnavailableError(new Error('no creds')))
    const unavailable = await get('/observability/resources')
    expect(unavailable.status).toBe(503)
    expect(unavailable.body).toEqual({ success: false, error: PLATFORM_AWS_UNAVAILABLE_MESSAGE })
    const bad = await get('/observability/resources?cursor=not-base64-json')
    expect(bad.status).toBe(400)
  })
})
