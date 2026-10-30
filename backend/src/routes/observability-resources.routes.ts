/**
 * GET /api/observability/resources (OB2): every monitored resource's explicit
 * check, telemetry and activity state, Last seen, labelled metric values, a
 * per-type summary computed over the whole fleet, and the page-level scope
 * (region, account count, last fully successful check, inventory coverage).
 * OB2.1 adds type_breakdown and fleet_summary: the explicit split behind
 * type_summary's "other" (measured, neutral, not measured, outside scope, and
 * the telemetry of the measured rows), per type and over the whole fleet, on
 * status ok only; the other statuses' bodies are unchanged.
 * O2 adds `table` (status ok and table=1 only): the Resource checks table's
 * page, searched, filtered and sorted by urgency over the same snapshot, with
 * its total and filter counts (services/observability-table.ts). q, filter and
 * page are read only with table=1; without it the response is unchanged.
 * O3b adds `lb_response_time` (status ok and lb_response_time=1 only): the load
 * balancer response-time chart (services/observability-lb-response-time.ts), from
 * the same sweep, so it adds no AWS call. Without the parameter the response is
 * unchanged.
 *
 * Reads the same CloudWatchService.getMetrics() result as GET
 * /api/cloudwatch/metrics (same 45s cache and in-flight sweep, keyed by
 * organization and range), so it never starts a second AWS sweep. The
 * organization is the authenticated caller's; nothing in the query string
 * selects an organization, account or region.
 *
 * data.status:
 *   ok                 states for the connected account's region
 *   not_connected      no eligible AWS account
 *   multiple_accounts  more than one eligible account (not supported on this page yet)
 *   failed             the sweep could not run; no counts and no list
 */
import { Router } from 'express'
import { authenticateToken } from '../middleware/auth.middleware'
import { pool } from '../config/database'
import { cloudWatchService, compareObservabilityKeys, OBSERVABILITY_TYPE_ORDER, ObservabilitySnapshotRow } from '../services/cloudwatch.service'
import { countEligibleAwsAccounts, AwsAccountAmbiguousError } from '../repositories/aws-accounts.repository'
import { isPlatformAwsCredentialsUnavailable, PLATFORM_AWS_UNAVAILABLE_MESSAGE } from '../services/platform-sts'
import { clampPageSize, InvalidCursorError } from '../services/cloudwatch-pagination.util'
import { InvalidTableQueryError, parseTableQuery, tableOf, TableQuery } from '../services/observability-table'

const router = Router()

interface Cursor {
  type: string
  name: string | null
  id: string
}

function decodeCursor(raw: unknown): Cursor | null {
  if (raw === undefined || raw === null || raw === '') return null
  if (typeof raw !== 'string') throw new InvalidCursorError('Cursor must be a string')
  let parsed: any
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'))
  } catch {
    throw new InvalidCursorError('Cursor is not valid base64-encoded JSON')
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof parsed.type !== 'string' ||
    !(parsed.type in OBSERVABILITY_TYPE_ORDER) ||
    typeof parsed.id !== 'string' ||
    !parsed.id ||
    (parsed.name !== null && typeof parsed.name !== 'string')
  ) {
    throw new InvalidCursorError('Cursor is missing required fields or has the wrong shape')
  }
  return { type: parsed.type, name: parsed.name, id: parsed.id }
}

function encodeCursor(row: ObservabilitySnapshotRow): string {
  return Buffer.from(JSON.stringify({ type: row.row.resource_type, name: row.sortName, id: row.dbId }), 'utf8').toString('base64')
}

function page(rows: ObservabilitySnapshotRow[], cursor: Cursor | null, pageSize: number) {
  let start = 0
  if (cursor) {
    const key = { row: { resource_type: cursor.type }, sortName: cursor.name, dbId: cursor.id }
    const idx = rows.findIndex((r) => compareObservabilityKeys(r, key) > 0)
    start = idx === -1 ? rows.length : idx
  }
  const slice = rows.slice(start, start + pageSize)
  const hasMore = start + pageSize < rows.length
  const last = slice[slice.length - 1]
  return {
    resources: slice.map((r) => r.row),
    pagination: { shown: slice.length, total: rows.length, has_more: hasMore, cursor: hasMore && last ? encodeCursor(last) : null },
  }
}

const empty = { region: null, checked_at: null, type_summary: null, resources: null, pagination: null }

router.get('/resources', authenticateToken, async (req, res) => {
  const organizationId = (req as any).user?.organizationId
  if (!organizationId) {
    return res.status(401).json({ success: false, error: 'Unauthorized' })
  }

  let cursor: Cursor | null
  try {
    cursor = decodeCursor(req.query.cursor)
  } catch (err) {
    if (err instanceof InvalidCursorError) {
      return res.status(400).json({ success: false, error: 'Invalid pagination cursor' })
    }
    throw err
  }

  let tableQuery: TableQuery | null
  try {
    tableQuery = parseTableQuery(req.query as Record<string, unknown>)
  } catch (err) {
    if (err instanceof InvalidTableQueryError) {
      return res.status(400).json({ success: false, error: 'Invalid table query' })
    }
    throw err
  }

  let accountCount: number
  try {
    accountCount = await countEligibleAwsAccounts(pool, organizationId)
  } catch (err) {
    console.error('[Observability] account lookup failed:', err)
    return res.json({ success: true, data: { status: 'failed', reason: 'query_failed', account_count: null, multiple_accounts: null, ...empty } })
  }
  if (accountCount === 0) {
    return res.json({ success: true, data: { status: 'not_connected', account_count: 0, multiple_accounts: false, ...empty } })
  }
  const multipleAccounts = { status: 'multiple_accounts', account_count: accountCount, multiple_accounts: true, ...empty }
  if (accountCount > 1) {
    return res.json({ success: true, data: multipleAccounts })
  }

  try {
    const range = typeof req.query.range === 'string' ? req.query.range : undefined
    const metrics = await cloudWatchService.getMetrics(organizationId, range, req.query.refresh === 'true')
    const snapshot = metrics?.observability
    if (!metrics || !snapshot) {
      // One eligible account, yet no evaluation: its connection could not be used
      // (for example the role could not be assumed). Not "not connected".
      return res.json({ success: true, data: { status: 'failed', reason: 'connection_failed', account_count: 1, multiple_accounts: false, ...empty } })
    }
    const { resources, pagination } = page(snapshot.rows, cursor, clampPageSize(req.query.pageSize))
    return res.json({
      success: true,
      data: {
        status: 'ok',
        region: snapshot.region,
        account_count: 1,
        multiple_accounts: false,
        range: snapshot.range,
        collection: snapshot.collection,
        checked_at: snapshot.checkedAt,
        captured_at: metrics.capturedAt,
        inventory_capped: snapshot.inventoryCapped,
        inventory_capped_reasons: snapshot.inventoryCappedReasons,
        type_summary: snapshot.typeSummary,
        type_breakdown: snapshot.typeBreakdown,
        fleet_summary: snapshot.fleetSummary,
        resources,
        pagination,
        // O2: only with table=1, so every other response is unchanged.
        ...(tableQuery ? { table: tableOf(snapshot.rows, tableQuery) } : {}),
        // O3b: only with lb_response_time=1, likewise.
        ...(req.query.lb_response_time === '1' ? { lb_response_time: snapshot.lbResponseTime } : {}),
      },
    })
  } catch (err) {
    if (isPlatformAwsCredentialsUnavailable(err)) {
      return res.status(503).json({ success: false, error: PLATFORM_AWS_UNAVAILABLE_MESSAGE })
    }
    if (err instanceof AwsAccountAmbiguousError) {
      return res.json({ success: true, data: { ...multipleAccounts, account_count: null } })
    }
    console.error('[Observability] resources failed:', err)
    return res.json({ success: true, data: { status: 'failed', reason: 'query_failed', account_count: 1, multiple_accounts: false, ...empty } })
  }
})

export default router
