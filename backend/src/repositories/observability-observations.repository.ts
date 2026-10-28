/**
 * Storage for the Observability page's memory beyond one metrics window
 * (202610281200_create_resource_telemetry_observations.sql): each resource's
 * newest datapoint and last completed check, and each (account, region)
 * scope's last fully successful collection.
 *
 * Every statement runs on a dedicated connection in its own transaction with
 * the tenant tag set LOCAL, never on the request's connection: a metrics sweep
 * can outlive the request that started it (later requests join it in flight),
 * and a query issued after a request's connection is released is refused.
 * Every statement also names the organization, account and region explicitly,
 * so isolation does not rest on row-level security alone.
 *
 * Nothing here throws. When the tables are missing (the migration is not
 * applied) or the database fails, the caller gets no stored history and the
 * page falls back to what the current sweep saw.
 */
import type { Pool, PoolClient } from 'pg'
import { DISCOVERY_WARNING_LISTING_TRUNCATED, DISCOVERY_WARNING_TRUNCATED_INDEX, jobWarnings } from '../services/discovery-warnings'
import type { StoredObservation } from '../services/observability-states'

export interface ObservationWrite {
  resourceDbId: string
  lastDatapointAt: Date | null
  lastSuccessfulCheckAt: Date | null
}

export type CollectionOutcome = 'complete' | 'partial'

export interface ObservationScope {
  organizationId: string
  awsAccountId: string
  region: string
}

export interface RecordedObservations {
  stored: Map<string, StoredObservation>
  // The scope's last fully successful collection after this one is recorded; null when unknown.
  lastFullSuccessAt: Date | null
  persisted: boolean
}

const UNDEFINED_TABLE = '42P01'
let missingTablesLogged = false

async function inTenantTransaction<T>(client: PoolClient, organizationId: string, work: () => Promise<T>): Promise<T> {
  await client.query('BEGIN')
  try {
    await client.query("SELECT set_config('app.current_organization_id', $1, true)", [organizationId])
    const result = await work()
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  }
}

/**
 * Records this sweep's observations and outcome for the scope, then reads back
 * every stored observation for it. Writes only move timestamps forward
 * (GREATEST), so an out-of-order or older sweep never moves Last seen back, and
 * a partial collection never advances last_full_success_at.
 */
export async function recordObservations(
  db: Pick<Pool, 'connect'>,
  scope: ObservationScope,
  writes: ObservationWrite[],
  outcome: CollectionOutcome,
  sweepAt: Date
): Promise<RecordedObservations> {
  const fallback: RecordedObservations = {
    stored: new Map(),
    lastFullSuccessAt: outcome === 'complete' ? sweepAt : null,
    persisted: false,
  }
  let client: PoolClient | undefined
  try {
    client = await db.connect()
    const c = client
    return await inTenantTransaction(c, scope.organizationId, async () => {
      const rows = writes.filter((w) => w.lastDatapointAt || w.lastSuccessfulCheckAt)
      if (rows.length > 0) {
        await c.query(
          `INSERT INTO resource_telemetry_observations
             (organization_id, aws_account_id, region, resource_id, last_datapoint_at, last_successful_check_at)
           SELECT $1, $2, $3, w.resource_id, w.last_datapoint_at, w.last_successful_check_at
             FROM unnest($4::uuid[], $5::timestamptz[], $6::timestamptz[])
                  AS w(resource_id, last_datapoint_at, last_successful_check_at)
           ON CONFLICT (organization_id, aws_account_id, region, resource_id) DO UPDATE SET
             last_datapoint_at = GREATEST(resource_telemetry_observations.last_datapoint_at, EXCLUDED.last_datapoint_at),
             last_successful_check_at = GREATEST(resource_telemetry_observations.last_successful_check_at, EXCLUDED.last_successful_check_at),
             updated_at = NOW()`,
          [
            scope.organizationId,
            scope.awsAccountId,
            scope.region,
            rows.map((w) => w.resourceDbId),
            rows.map((w) => w.lastDatapointAt),
            rows.map((w) => w.lastSuccessfulCheckAt),
          ]
        )
      }

      const { rows: storedRows } = await c.query(
        `SELECT resource_id, last_datapoint_at, last_successful_check_at
           FROM resource_telemetry_observations
          WHERE organization_id = $1 AND aws_account_id = $2 AND region = $3`,
        [scope.organizationId, scope.awsAccountId, scope.region]
      )
      const stored = new Map<string, StoredObservation>()
      for (const r of storedRows) {
        stored.set(r.resource_id, { lastDatapointAt: r.last_datapoint_at, lastSuccessfulCheckAt: r.last_successful_check_at })
      }

      const { rows: scopeRows } = await c.query(
        `INSERT INTO observability_collection_scopes
           (organization_id, aws_account_id, region, last_full_success_at, last_attempt_at, last_attempt_outcome)
         VALUES ($1, $2, $3, CASE WHEN $4 = 'complete' THEN $5::timestamptz END, $5::timestamptz, $4)
         ON CONFLICT (organization_id, aws_account_id, region) DO UPDATE SET
           last_full_success_at = CASE WHEN EXCLUDED.last_attempt_outcome = 'complete'
             THEN GREATEST(observability_collection_scopes.last_full_success_at, EXCLUDED.last_attempt_at)
             ELSE observability_collection_scopes.last_full_success_at END,
           last_attempt_at = EXCLUDED.last_attempt_at,
           last_attempt_outcome = EXCLUDED.last_attempt_outcome,
           updated_at = NOW()
         RETURNING last_full_success_at`,
        [scope.organizationId, scope.awsAccountId, scope.region, outcome, sweepAt]
      )
      return { stored, lastFullSuccessAt: scopeRows[0]?.last_full_success_at ?? null, persisted: true }
    })
  } catch (err: any) {
    if (err?.code === UNDEFINED_TABLE) {
      if (!missingTablesLogged) {
        missingTablesLogged = true
        console.warn('[Observability] observation tables are not present; Last seen uses the current window only')
      }
    } else {
      console.error('[Observability] recording observations failed:', err?.message ?? err)
    }
    return fallback
  } finally {
    client?.release()
  }
}

/**
 * Whether the organization's newest discovery job reported a cut-off
 * listing or a truncated Resource Explorer index. Only a job that completed can
 * answer: true when it reported either, false when it reported neither. null when
 * there is no job, the newest one did not complete (it failed, was interrupted, or
 * is still running or pending: its inventory is not proven complete, whatever it
 * reported), or it can't be read.
 * Only false supports a full-account coverage claim.
 */
export async function readInventoryCapped(
  db: Pick<Pool, 'connect'>,
  organizationId: string
): Promise<{ capped: boolean | null; reasons: string[] }> {
  let client: PoolClient | undefined
  try {
    client = await db.connect()
    const c = client
    return await inTenantTransaction(c, organizationId, async () => {
      const { rows } = await c.query(
        `SELECT j.status, to_jsonb(j) -> 'warnings' AS warnings_column, j.error_message
           FROM resource_discovery_jobs j
          WHERE j.organization_id = $1
          ORDER BY j.created_at DESC, j.id DESC
          LIMIT 1`,
        [organizationId]
      )
      if (rows.length === 0 || rows[0].status !== 'completed') return { capped: null, reasons: [] }
      const reasons = jobWarnings(rows[0].warnings_column, rows[0].error_message).filter(
        (code) => code === DISCOVERY_WARNING_LISTING_TRUNCATED || code === DISCOVERY_WARNING_TRUNCATED_INDEX
      )
      return { capped: reasons.length > 0, reasons }
    })
  } catch (err: any) {
    console.error('[Observability] reading discovery coverage failed:', err?.message ?? err)
    return { capped: null, reasons: [] }
  } finally {
    client?.release()
  }
}
