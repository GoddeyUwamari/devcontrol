/**
 * Observability states (OB2): the explicit per-resource states GET
 * /api/observability/resources reports, derived from one CloudWatchService
 * evaluation plus the evidence that evaluation collected about how each query
 * ended. Pure: no AWS, no database.
 *
 * The page shows the status sent here and never infers health from a missing
 * value, so every state is explicit:
 *
 *   check_status    passing | needs_attention | failing | stopped | not_measured | unknown
 *   unknown_reason  set exactly when check_status is unknown:
 *                   access_denied | throttled | query_failed      a query did not complete
 *                   outside_region | outside_account              not in the queried scope
 *                   not_supported                                 a check exists, this resource can't be evaluated by it
 *                   no_activity                                   the activity query completed with zero (idle)
 *                   no_telemetry                                  every query completed with no datapoints
 *   telemetry       reporting     a query completed with at least one datapoint
 *                                 (point-in-time types: the describe call returned a status)
 *                   no_telemetry  every query completed and returned nothing
 *                   unknown       otherwise, including not queried at all
 *   activity        active | no_activity, only for Lambda (Invocations) and ALB
 *                   (RequestCount), and only from a completed query; null otherwise
 *
 * Precedence (first match wins): outside_account, outside_region, not measured
 * (or stopped, for a stopped RDS instance), a failed type block, no evaluated
 * row (not_supported), a query that did not complete, a deliberate stop, a
 * resource the check can't evaluate, an Inactive Lambda function (no_activity),
 * a completed activity query at zero (no_activity, unless the evaluator found a
 * real failure), then the evaluator's own verdict.
 *
 * The legacy CloudWatchServiceHealth rows are read, never changed: this module
 * adds states beside them.
 */
import type { QueryOutcome } from './cloudwatch-metric-batch.util'

export type CheckStatus = 'passing' | 'needs_attention' | 'failing' | 'stopped' | 'not_measured' | 'unknown'
export type UnknownReason =
  | 'access_denied'
  | 'throttled'
  | 'query_failed'
  | 'outside_region'
  | 'outside_account'
  | 'not_supported'
  | 'no_activity'
  | 'no_telemetry'
export type TelemetryState = 'reporting' | 'no_telemetry' | 'unknown'
export type ActivityState = 'active' | 'no_activity'
export type MetricStatistic = 'Average' | 'Sum' | 'Maximum'

export interface ObservabilityMetric {
  label: string
  value: number
  unit?: string
  statistic: MetricStatistic | null
  // The range (e.g. "1h") for a value computed over the window; "current" for a point-in-time value.
  window: string
}

export interface ObservabilityRow {
  resource_id: string
  resource_type: string
  name: string
  region: string | null
  check_status: CheckStatus
  unknown_reason: UnknownReason | null
  telemetry: TelemetryState
  activity: ActivityState | null
  last_seen: string | null
  last_seen_source: 'datapoint' | 'observation' | null
  metrics: ObservabilityMetric[]
}

export interface TypeSummary {
  count: number
  passing: number
  needs_attention: number
  failing: number
  other: number
}

/** How one resource's queries ended, recorded by the evaluator that ran them. */
export interface ResourceEvidence {
  // cloudwatch: GetMetricData queries (Aurora also records its describe call as 'describe').
  // point_in_time: one describe call, recorded as 'describe'.
  kind: 'cloudwatch' | 'point_in_time'
  // Every query the resource's check needs, by metric key.
  queries: Record<string, QueryOutcome>
  // The sparse activity query, for Lambda and ALB.
  activity?: { key: string; value: number | null }
  newestDatapointAt: Date | null
  // The check exists but this resource can't be evaluated by it (not found, unrecognized state...).
  unsupported?: boolean
  // AWS reports a deliberate stop (Aurora stopped/stopping, CloudFront disabled).
  stopped?: boolean
}

export type EvidenceSink = Map<string, ResourceEvidence>

/** The fields of a legacy evaluated row this module reads. */
export interface EvaluatedRowView {
  status: 'healthy' | 'degraded' | 'critical' | 'down' | 'unknown'
  responseTimeMs: number | null
  metrics?: Array<{ label: string; value: number; unit?: string }>
}

export interface InventoryView {
  id: string
  resource_id: string
  resource_name: string | null
  resource_type: string
  resource_arn: string
  region?: string | null
  status: string | null
  metadata: Record<string, any> | null
}

export interface StoredObservation {
  lastDatapointAt: Date | null
  lastSuccessfulCheckAt: Date | null
}

export interface RowContext {
  // The connected account (12 digits) and the region every client queried; null when unknown.
  accountId: string | null
  region: string
  rangeLabel: string
  sweepAt: Date
  blockFailed: boolean
  stored: StoredObservation | undefined
}

/** Types with no check wired today: listed as not_measured, never as missing telemetry. */
export function isNotMeasured(resource: Pick<InventoryView, 'resource_type' | 'metadata'>): boolean {
  if (resource.resource_type === 'rds' || resource.resource_type === 'api-gateway' || resource.resource_type === 's3') return true
  return resource.resource_type === 'load-balancer' && resource.metadata?.type !== 'application'
}

// Global services, whose rows are not stored under a region the clients query.
const REGIONLESS_TYPES = new Set(['cloudfront', 's3'])

const EC2_STOPPED = new Set(['stopped', 'stopping', 'shutting-down'])

/** The 12-digit account in a resource ARN (arn:partition:service:region:account:...); null when it has none. */
export function accountIdOfResourceArn(arn: string | null | undefined): string | null {
  const match = arn?.match(/^arn:aws[a-z-]*:[^:]*:[^:]*:(\d{12}):/)
  return match ? match[1] : null
}

const FAILURE_ORDER: QueryOutcome[] = ['access_denied', 'throttled', 'query_failed']

/** The worst failure among the outcomes; else 'empty' when every one is empty; else 'complete'. */
export function aggregateOutcome(outcomes: QueryOutcome[]): QueryOutcome {
  for (const failure of FAILURE_ORDER) if (outcomes.includes(failure)) return failure
  if (outcomes.length > 0 && outcomes.every((o) => o === 'empty')) return 'empty'
  return 'complete'
}

function isFailure(outcome: QueryOutcome): outcome is 'access_denied' | 'throttled' | 'query_failed' {
  return FAILURE_ORDER.includes(outcome)
}

// Statistic per legacy metric label, per type. A label not listed is shown without one.
const STATISTICS: Record<string, Record<string, MetricStatistic>> = {
  ec2: { CPU: 'Average' },
  'load-balancer': { 'Requests/min': 'Sum', 'Error rate': 'Sum' },
  lambda: { Invocations: 'Sum', Errors: 'Sum' },
  dynamodb: { 'System errors': 'Sum', Throttled: 'Sum' },
  cloudfront: { '4xx rate': 'Average', '5xx rate': 'Average' },
  aurora: { CPU: 'Average', 'Replica lag': 'Maximum' },
}

const POINT_IN_TIME_TYPES = new Set(['ecs', 'eks', 'ebs'])

function labelledMetrics(
  resourceType: string,
  row: EvaluatedRowView,
  evidence: ResourceEvidence | undefined,
  rangeLabel: string
): ObservabilityMetric[] {
  const pointInTime = POINT_IN_TIME_TYPES.has(resourceType)
  const window = pointInTime ? 'current' : rangeLabel
  const metrics: ObservabilityMetric[] = []
  if ((resourceType === 'load-balancer' || resourceType === 'lambda') && row.responseTimeMs !== null) {
    metrics.push({
      label: resourceType === 'lambda' ? 'Avg duration' : 'Avg latency',
      value: row.responseTimeMs,
      unit: 'ms',
      statistic: 'Average',
      window,
    })
  }
  for (const m of row.metrics ?? []) {
    // The legacy ALB error rate is 0 when the 5xx query returned nothing for any
    // reason; here it is shown only when that query completed.
    if (resourceType === 'load-balancer' && m.label === 'Error rate') {
      const errorOutcome = evidence?.queries.errorSum
      if (errorOutcome !== 'complete' && errorOutcome !== 'empty') continue
    }
    metrics.push({
      label: m.label,
      value: m.value,
      ...(m.unit ? { unit: m.unit } : {}),
      statistic: pointInTime ? null : (STATISTICS[resourceType]?.[m.label] ?? null),
      window,
    })
  }
  return metrics
}

function latest(a: Date | null | undefined, b: Date | null | undefined): Date | null {
  if (!a) return b ?? null
  if (!b) return a
  return a > b ? a : b
}

interface Verdict {
  check_status: CheckStatus
  unknown_reason: UnknownReason | null
  telemetry: TelemetryState
  activity: ActivityState | null
}

const unknown = (reason: UnknownReason, telemetry: TelemetryState = 'unknown', activity: ActivityState | null = null): Verdict => ({
  check_status: 'unknown',
  unknown_reason: reason,
  telemetry,
  activity,
})

function verdictFor(
  resource: InventoryView,
  row: EvaluatedRowView | undefined,
  evidence: ResourceEvidence | undefined,
  ctx: RowContext
): Verdict {
  const arnAccount = accountIdOfResourceArn(resource.resource_arn)
  if (ctx.accountId && arnAccount && arnAccount !== ctx.accountId) return unknown('outside_account')
  // A row with no recorded region can't be shown to be in the queried one.
  if (!REGIONLESS_TYPES.has(resource.resource_type) && resource.region !== ctx.region) return unknown('outside_region')
  if (isNotMeasured(resource)) {
    if (resource.resource_type === 'rds' && resource.status === 'stopped') {
      return { check_status: 'stopped', unknown_reason: null, telemetry: 'unknown', activity: null }
    }
    return { check_status: 'not_measured', unknown_reason: null, telemetry: 'unknown', activity: null }
  }
  if (ctx.blockFailed) return unknown('query_failed')
  // Evaluated type, but no row: its dimension could not be resolved.
  if (!row || !evidence) return unknown('not_supported')

  const all = aggregateOutcome(Object.values(evidence.queries))
  if (isFailure(all)) return unknown(all)

  const datapointOutcomes = Object.entries(evidence.queries)
    .filter(([key]) => evidence.kind === 'point_in_time' || key !== 'describe')
    .map(([, outcome]) => outcome)
  const telemetryOutcome = aggregateOutcome(datapointOutcomes)
  const telemetry: TelemetryState = evidence.unsupported ? 'unknown' : telemetryOutcome === 'empty' ? 'no_telemetry' : 'reporting'

  let activity: ActivityState | null = null
  if (evidence.activity) {
    const outcome = evidence.queries[evidence.activity.key]
    if (outcome === 'empty' || (outcome === 'complete' && (evidence.activity.value ?? 0) === 0)) activity = 'no_activity'
    else if (outcome === 'complete') activity = 'active'
  }

  if (evidence.stopped || (resource.resource_type === 'ec2' && EC2_STOPPED.has(resource.status ?? ''))) {
    return { check_status: 'stopped', unknown_reason: null, telemetry, activity }
  }
  if (evidence.unsupported) return unknown('not_supported', telemetry, activity)
  // An Inactive function is one AWS reclaimed for being idle (invoking it reactivates it):
  // idle, not failing. Failed stays failing below.
  if (resource.resource_type === 'lambda' && resource.status === 'Inactive') return unknown('no_activity', telemetry, activity)
  // D3: a completed activity query at zero (nothing ran, no traffic) is never passing,
  // whatever the evaluator concluded from it; only a real failure verdict stays failing.
  if (activity === 'no_activity' && row.status !== 'critical' && row.status !== 'down') {
    return unknown('no_activity', telemetry, activity)
  }

  switch (row.status) {
    case 'healthy':
      return { check_status: 'passing', unknown_reason: null, telemetry, activity }
    case 'degraded':
      return { check_status: 'needs_attention', unknown_reason: null, telemetry, activity }
    case 'critical':
    case 'down':
      return { check_status: 'failing', unknown_reason: null, telemetry, activity }
    default:
      if (activity === 'no_activity') return unknown('no_activity', telemetry, activity)
      if (telemetry === 'no_telemetry') return unknown('no_telemetry', telemetry, activity)
      return unknown('not_supported', telemetry, activity)
  }
}

/** One resource's observability row. */
export function observabilityRowFor(
  resource: InventoryView,
  row: EvaluatedRowView | undefined,
  evidence: ResourceEvidence | undefined,
  ctx: RowContext
): ObservabilityRow {
  const verdict = verdictFor(resource, row, evidence, ctx)
  const inScope = verdict.unknown_reason !== 'outside_account' && verdict.unknown_reason !== 'outside_region'

  let lastSeen: Date | null = null
  let lastSeenSource: ObservabilityRow['last_seen_source'] = null
  if (inScope && !isNotMeasured(resource)) {
    if (evidence?.kind === 'point_in_time') {
      lastSeen = latest(ctx.stored?.lastSuccessfulCheckAt, checkObserved(evidence, ctx) ? ctx.sweepAt : null)
      lastSeenSource = lastSeen ? 'observation' : null
    } else {
      lastSeen = latest(ctx.stored?.lastDatapointAt, evidence?.newestDatapointAt)
      lastSeenSource = lastSeen ? 'datapoint' : null
    }
  }

  return {
    resource_id: resource.resource_id,
    resource_type: resource.resource_type,
    name: resource.resource_name || resource.resource_id,
    region: resource.region ?? null,
    ...verdict,
    last_seen: lastSeen ? lastSeen.toISOString() : null,
    last_seen_source: lastSeenSource,
    metrics: row && inScope ? labelledMetrics(resource.resource_type, row, evidence, ctx.rangeLabel) : [],
  }
}

/**
 * Whether this sweep observed the resource: for a CloudWatch check, every query it needs
 * completed (empty counts); for a point-in-time check, the describe call returned a
 * verdict -- a completed call that returned nothing for the resource (EBS
 * insufficient-data, or no entry) is no observation, so Last seen never becomes "now"
 * for a resource AWS said nothing about.
 */
export function checkObserved(evidence: ResourceEvidence | undefined, ctx: Pick<RowContext, 'blockFailed'>): boolean {
  if (!checkCompleted(evidence, ctx)) return false
  return evidence!.kind !== 'point_in_time' || Object.values(evidence!.queries).every((o) => o === 'complete')
}

/** Whether every query the resource's check needs completed this sweep (empty counts as completed). */
export function checkCompleted(evidence: ResourceEvidence | undefined, ctx: Pick<RowContext, 'blockFailed'>): boolean {
  if (!evidence || ctx.blockFailed || evidence.unsupported) return false
  return !isFailure(aggregateOutcome(Object.values(evidence.queries)))
}

/** Per-type counts over every row: count = passing + needs_attention + failing + other. */
export function typeSummaryOf(rows: Array<Pick<ObservabilityRow, 'resource_type' | 'check_status'>>): Record<string, TypeSummary> {
  const summary: Record<string, TypeSummary> = {}
  for (const row of rows) {
    const s = (summary[row.resource_type] ??= { count: 0, passing: 0, needs_attention: 0, failing: 0, other: 0 })
    s.count += 1
    if (row.check_status === 'passing') s.passing += 1
    else if (row.check_status === 'needs_attention') s.needs_attention += 1
    else if (row.check_status === 'failing') s.failing += 1
    else s.other += 1
  }
  return summary
}
