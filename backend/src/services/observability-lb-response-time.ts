/**
 * O3b: the load balancer response-time chart and the request total behind the
 * table's "5xx X% of N requests", for GET /api/observability/resources. Pure: no
 * AWS, no database. Everything here is read from what the sweep already fetched
 * (the ALB capability's TargetResponseTime Average series and the per-query
 * evidence), so it adds no CloudWatch query.
 *
 * lb_response_time (sent only with lb_response_time=1, status ok):
 *   eligible           Application Load Balancer rows in the queried scope that a query
 *                      could be built for: not not_measured (NLB/GWLB), not outside the
 *                      account or region, not not_supported
 *   charted            one eligible load balancer, first by: a complete latency series
 *                      -> RequestCount Sum descending (a failed count after every known
 *                      count, never 0) -> name A-Z (case-insensitive, nulls last) -> id
 *   state              none     no eligible load balancer
 *                      ok       the first in that order has a complete latency series
 *                      failed   none has one and at least one latency query failed
 *                      no_data  none has one and every latency query completed empty
 *   selection_complete every eligible RequestCount query completed
 *   collection         complete when every eligible load balancer's queries completed
 *   checked_at         the sweep time, only when collection is complete
 *
 * A latency query that did not complete (PartialData included) is never charted, and
 * an empty one is never drawn as 0 ms. The chart's value is the table row's own
 * "Avg latency", so the page shows one average, not two.
 */
import type { BatchSeriesResult } from './cloudwatch-metric-batch.util'
import type { ObservabilityMetric, ObservabilityRow, ResourceEvidence } from './observability-states'

export interface LbResponseTimePoint {
  t: string
  ms: number
}

export interface LbResponseTimeBlock {
  range: string
  window_start: string
  window_end: string
  period_seconds: number
  statistic: 'Average'
  unit: 'ms'
  eligible_count: number | null
  selection_complete: boolean
  collection: 'complete' | 'partial'
  checked_at: string | null
  state: 'none' | 'ok' | 'no_data' | 'failed'
  charted: { resource_id: string; name: string; value_ms: number; points: LbResponseTimePoint[] } | null
}

/** One row of the sweep, with the keys the builder orders and looks evidence up by. */
export interface LbRowInput {
  row: ObservabilityRow
  sortName: string | null
  dbId: string
}

export interface LbResponseTimeInput {
  rows: LbRowInput[]
  evidence: Map<string, ResourceEvidence>
  latencySeries: Map<string, BatchSeriesResult | null>
  range: string
  windowStart: Date
  windowEnd: Date
  periodSeconds: number
  sweepAt: Date
}

const completed = (outcome: string | undefined) => outcome === 'complete' || outcome === 'empty'

/** Whether a row is a load balancer the chart could draw (see the module header). */
export function isChartEligible(row: ObservabilityRow): boolean {
  return (
    row.resource_type === 'load-balancer' &&
    row.check_status !== 'not_measured' &&
    row.unknown_reason !== 'outside_account' &&
    row.unknown_reason !== 'outside_region' &&
    row.unknown_reason !== 'not_supported'
  )
}

/** RequestCount over the range: completed with datapoints -> their sum; completed empty -> 0; otherwise null. */
export function requestTotal(evidence: ResourceEvidence | undefined): number | null {
  const outcome = evidence?.queries.requestSum
  if (outcome === 'empty') return 0
  if (outcome === 'complete') return evidence?.values?.requestSum ?? null
  return null
}

/**
 * The table's extra request total for a load balancer row (decision 5b): only in the
 * table block, only when RequestCount completed. Never a guessed 0 for a failed query.
 */
export function requestsTableMetric(row: ObservabilityRow, evidence: ResourceEvidence | undefined, window: string): ObservabilityMetric[] {
  if (!isChartEligible(row) || evidence?.kind !== 'cloudwatch') return []
  const requests = requestTotal(evidence)
  if (requests === null) return []
  return [{ label: 'Requests', value: requests, statistic: 'Sum', window }]
}

function pointsOf(series: BatchSeriesResult): LbResponseTimePoint[] {
  const points: Array<{ at: number; ms: number }> = []
  for (let i = 0; i < series.timestamps.length; i++) {
    const ts = series.timestamps[i]
    const v = series.values[i]
    if (!(ts instanceof Date) || isNaN(ts.getTime()) || typeof v !== 'number' || !Number.isFinite(v)) continue
    points.push({ at: ts.getTime(), ms: Math.round(v * 1000) })
  }
  return points.sort((a, b) => a.at - b.at).map((p) => ({ t: new Date(p.at).toISOString(), ms: p.ms }))
}

interface Candidate {
  input: LbRowInput
  chartable: { valueMs: number; points: LbResponseTimePoint[] } | null
  latencyOutcome: string | undefined
  requests: number | null
}

function compareNames(a: string | null, b: string | null): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  const lower = a.toLowerCase().localeCompare(b.toLowerCase(), 'en')
  if (lower !== 0) return lower
  return a < b ? -1 : a > b ? 1 : 0
}

/** The charting order (decision 8): chartable first, most requests (unknown last), name, id. */
export function compareCandidates(a: Candidate, b: Candidate): number {
  if ((a.chartable !== null) !== (b.chartable !== null)) return a.chartable !== null ? -1 : 1
  if ((a.requests !== null) !== (b.requests !== null)) return a.requests !== null ? -1 : 1
  if (a.requests !== null && b.requests !== null && a.requests !== b.requests) return b.requests - a.requests
  const byName = compareNames(a.input.sortName, b.input.sortName)
  if (byName !== 0) return byName
  return a.input.dbId < b.input.dbId ? -1 : a.input.dbId > b.input.dbId ? 1 : 0
}

function candidateOf(input: LbRowInput, evidence: ResourceEvidence | undefined, series: BatchSeriesResult | null | undefined): Candidate {
  const latencyOutcome = evidence?.queries.latencySec
  const avg = input.row.metrics.find((m) => m.label === 'Avg latency' && m.unit === 'ms')
  const points = latencyOutcome === 'complete' && series ? pointsOf(series) : []
  return {
    input,
    chartable: avg && points.length > 0 ? { valueMs: avg.value, points } : null,
    latencyOutcome,
    requests: requestTotal(evidence),
  }
}

export function buildLbResponseTime(input: LbResponseTimeInput): LbResponseTimeBlock {
  const candidates = input.rows
    .filter((r) => isChartEligible(r.row))
    .map((r) => candidateOf(r, input.evidence.get(r.dbId), input.latencySeries.get(r.dbId)))
    .sort(compareCandidates)

  // Every query an eligible load balancer's check made (no evidence: its block failed).
  const allCompleted = candidates.every((c) => {
    const queries = input.evidence.get(c.input.dbId)?.queries
    return queries !== undefined && Object.keys(queries).length > 0 && Object.values(queries).every(completed)
  })
  const first = candidates[0]
  const state: LbResponseTimeBlock['state'] =
    candidates.length === 0 ? 'none' : first.chartable ? 'ok' : candidates.some((c) => !completed(c.latencyOutcome)) ? 'failed' : 'no_data'

  return {
    ...blockFrame(input),
    eligible_count: candidates.length,
    selection_complete: candidates.every((c) => c.requests !== null),
    collection: allCompleted ? 'complete' : 'partial',
    checked_at: allCompleted ? input.sweepAt.toISOString() : null,
    state,
    charted:
      state === 'ok' && first.chartable
        ? { resource_id: first.input.row.resource_id, name: first.input.row.name, value_ms: first.chartable.valueMs, points: first.chartable.points }
        : null,
  }
}

function blockFrame(input: Pick<LbResponseTimeInput, 'range' | 'windowStart' | 'windowEnd' | 'periodSeconds'>) {
  return {
    range: input.range,
    window_start: input.windowStart.toISOString(),
    window_end: input.windowEnd.toISOString(),
    period_seconds: input.periodSeconds,
    statistic: 'Average' as const,
    unit: 'ms' as const,
  }
}

/** What the block says when building it threw: failed, with no counts and no chart. */
export function failedLbResponseTime(input: Pick<LbResponseTimeInput, 'range' | 'windowStart' | 'windowEnd' | 'periodSeconds'>): LbResponseTimeBlock {
  return { ...blockFrame(input), eligible_count: null, selection_complete: false, collection: 'partial', checked_at: null, state: 'failed', charted: null }
}
