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
 *                                                                 (RDS: any of its core queries did)
 *                   not_enough_traffic                            a load balancer served fewer than 100
 *                                                                 requests and fewer than 100 5xx in the range
 *   telemetry       reporting     a query completed with at least one datapoint
 *                                 (point-in-time types: the describe call returned a status)
 *                   no_telemetry  every query completed and returned nothing
 *                   unknown       otherwise, including not queried at all
 *   activity        active | no_activity, only for Lambda (Invocations) and ALB
 *                   (RequestCount, or any 5xx), and only from a completed query; null otherwise
 *   status_detail   the AWS-reported state behind check_status when that state decided
 *                   it (RDS: failing, transitional or unrecognised); null otherwise
 *
 * Precedence (first match wins): outside_account, outside_region, not measured
 * (or stopped, for a stopped RDS instance), a failed type block, no evaluated
 * row (not_supported), a query that did not complete, a deliberate stop, a
 * resource the check can't evaluate, an Inactive Lambda function (no_activity),
 * the type's own OB3 rules (RDS status, storage and CPU; Lambda throttles, before
 * idle; load balancer 5xx and latency), a completed activity query at zero
 * (no_activity, unless the evaluator found a real failure), then the evaluator's
 * own verdict.
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
  | 'not_enough_traffic'
export type TelemetryState = 'reporting' | 'no_telemetry' | 'unknown'
export type ActivityState = 'active' | 'no_activity'
export type MetricStatistic = 'Average' | 'Sum' | 'Maximum' | 'Minimum'

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
  status_detail: string | null
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
  // Each current-window query's value over the window, by metric key (null: no datapoints).
  values?: Record<string, number | null>
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

/** An RDS instance that is a member of an Aurora cluster: its cluster's aurora row measures it. */
export function isAuroraMemberInstance(resource: Pick<InventoryView, 'resource_type' | 'metadata'>): boolean {
  return resource.resource_type === 'rds' && typeof resource.metadata?.engine === 'string' && resource.metadata.engine.startsWith('aurora')
}

/** Types with no check wired today: listed as not_measured, never as missing telemetry. */
export function isNotMeasured(resource: Pick<InventoryView, 'resource_type' | 'metadata'>): boolean {
  if (isAuroraMemberInstance(resource) || resource.resource_type === 'api-gateway' || resource.resource_type === 's3') return true
  return resource.resource_type === 'load-balancer' && resource.metadata?.type !== 'application'
}

// Global services, whose rows are not stored under a region the clients query.
const REGIONLESS_TYPES = new Set(['cloudfront', 's3'])

const EC2_STOPPED = new Set(['stopped', 'stopping', 'shutting-down'])
const RDS_STOPPED = new Set(['stopped', 'stopping'])

// RDS DBInstanceStatus values (founder decision R1). 'available' is judged by its metrics.
const RDS_FAILING = (status: string) =>
  status === 'failed' ||
  status === 'storage-full' ||
  status === 'restore-error' ||
  status.startsWith('incompatible-') ||
  status.startsWith('inaccessible-encryption-credentials')
// Serving states judged by their metrics: storage-optimization keeps the instance fully
// available (R1 amendment).
const RDS_JUDGED_BY_METRICS = new Set(['available', 'storage-optimization'])
const RDS_TRANSITIONAL = (status: string) =>
  ['modifying', 'rebooting', 'backing-up', 'upgrading', 'maintenance', 'starting'].includes(status) || status.startsWith('configuring-')

/** Below this share of allocated storage left free, an RDS instance needs attention (R5). */
export const RDS_FREE_STORAGE_MIN_RATIO = 0.1
/** Average CPU at or above this, over the range, needs attention (R2; EC2's threshold). */
export const RDS_CPU_ATTENTION_PERCENT = 80
/** Load balancer 5xx: fewer requests and fewer 5xx than this in the range is not enough traffic to judge. */
export const LB_MIN_REQUESTS = 100
// errors x RATIO <= requests: at most 1% passes; at most 5% needs attention; more fails.
const LB_5XX_PASS_RATIO = 100
const LB_5XX_ATTENTION_RATIO = 20
const BYTES_PER_GIB = 1024 ** 3

/** The 12-digit account in a resource ARN (arn:partition:service:region:account:...); null when it has none. */
export function accountIdOfResourceArn(arn: string | null | undefined): string | null {
  const match = arn?.match(/^arn:aws[a-z-]*:[^:]*:[^:]*:(\d{12}):/)
  return match ? match[1] : null
}

const FAILURE_ORDER: QueryOutcome[] = ['access_denied', 'throttled', 'query_failed']

/**
 * The worst failure among the outcomes; else 'empty' when every one is empty; else
 * 'complete'. No outcomes at all is query_failed: a check that ran no query measured
 * nothing, so it can never count as a completed collection.
 */
export function aggregateOutcome(outcomes: QueryOutcome[]): QueryOutcome {
  if (outcomes.length === 0) return 'query_failed'
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
  rangeLabel: string,
  metadata: Record<string, any> | null
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
    // The legacy ALB error rate counts target 5xx only and is 0 when that query returned
    // nothing for any reason; the 5xx metrics below replace it here.
    if (resourceType === 'load-balancer' && m.label === 'Error rate') continue
    metrics.push({
      label: m.label,
      value: m.value,
      ...(m.unit ? { unit: m.unit } : {}),
      statistic: pointInTime ? null : (STATISTICS[resourceType]?.[m.label] ?? null),
      window,
    })
  }
  if (evidence) metrics.push(...ob3Metrics(resourceType, evidence, metadata, window))
  return metrics
}

const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places

/**
 * OB3's metrics, read from the evidence's values: each only when its query completed
 * (a completed count query with no datapoints is 0; any other completed query with no
 * datapoints has no value to show).
 */
function ob3Metrics(resourceType: string, evidence: ResourceEvidence, metadata: Record<string, any> | null, window: string): ObservabilityMetric[] {
  const completed = (key: string) => evidence.queries[key] === 'complete' || evidence.queries[key] === 'empty'
  const value = (key: string) => (evidence.queries[key] === 'complete' ? (evidence.values?.[key] ?? null) : null)
  const metrics: ObservabilityMetric[] = []
  if (resourceType === 'load-balancer' && completed('errorSum') && completed('elb5xxSum')) {
    const errors = (value('errorSum') ?? 0) + (value('elb5xxSum') ?? 0)
    metrics.push({ label: '5xx errors', value: errors, statistic: 'Sum', window })
    const requests = completed('requestSum') ? (value('requestSum') ?? 0) : null
    if (requests !== null && requests > 0 && (requests >= LB_MIN_REQUESTS || errors >= LB_MIN_REQUESTS)) {
      metrics.push({ label: '5xx rate', value: round((errors / requests) * 100, 2), unit: '%', statistic: 'Sum', window })
    }
  }
  if (resourceType === 'lambda' && completed('throttles')) {
    metrics.push({ label: 'Throttles', value: value('throttles') ?? 0, statistic: 'Sum', window })
  }
  if (resourceType === 'rds') {
    const cpu = value('cpu')
    const connections = value('connections')
    const connectionsMax = value('connectionsMax')
    const freeBytes = value('freeStorageMin')
    if (cpu !== null) metrics.push({ label: 'CPU', value: round(cpu, 1), unit: '%', statistic: 'Average', window })
    if (connections !== null) metrics.push({ label: 'Connections', value: round(connections, 1), statistic: 'Average', window })
    if (connectionsMax !== null) metrics.push({ label: 'Connections (max)', value: connectionsMax, statistic: 'Maximum', window })
    if (freeBytes !== null) {
      metrics.push({ label: 'Free storage', value: round(freeBytes / BYTES_PER_GIB, 2), unit: 'GiB', statistic: 'Minimum', window })
      const allocatedGiB = Number(metadata?.allocated_storage)
      if (allocatedGiB > 0) {
        metrics.push({ label: 'Free storage', value: round((freeBytes / (allocatedGiB * BYTES_PER_GIB)) * 100, 1), unit: '% of allocated', statistic: 'Minimum', window })
      }
    }
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
  status_detail: string | null
}

const unknown = (reason: UnknownReason, telemetry: TelemetryState = 'unknown', activity: ActivityState | null = null, statusDetail: string | null = null): Verdict => ({
  check_status: 'unknown',
  unknown_reason: reason,
  telemetry,
  activity,
  status_detail: statusDetail,
})

const judged = (check_status: CheckStatus, telemetry: TelemetryState, activity: ActivityState | null, statusDetail: string | null = null): Verdict => ({
  check_status,
  unknown_reason: null,
  telemetry,
  activity,
  status_detail: statusDetail,
})

const SEVERITY: Record<'passing' | 'needs_attention' | 'failing', number> = { passing: 0, needs_attention: 1, failing: 2 }
const worse = (a: 'passing' | 'needs_attention' | 'failing', b: 'passing' | 'needs_attention' | 'failing') => (SEVERITY[a] >= SEVERITY[b] ? a : b)

/** A completed query's value over the window; a completed query with no datapoints is 0. */
function completedCount(evidence: ResourceEvidence, key: string): number {
  return evidence.queries[key] === 'complete' ? (evidence.values?.[key] ?? 0) : 0
}

/**
 * RDS instance (R1-R5): the status discovery recorded decides failing / transitional /
 * unrecognised; an available instance -- or one in storage-optimization, which is fully
 * available meanwhile (R1 amendment; its status_detail names it) -- is judged by its core
 * metrics, all of which must have data. Query failures and stops were handled before this.
 */
function rdsVerdict(resource: InventoryView, evidence: ResourceEvidence, telemetry: TelemetryState): Verdict {
  const status = resource.status ?? ''
  if (RDS_FAILING(status)) return judged('failing', telemetry, null, status)
  if (RDS_TRANSITIONAL(status)) return judged('needs_attention', telemetry, null, status)
  if (!RDS_JUDGED_BY_METRICS.has(status)) return unknown('not_supported', telemetry, null, status || null)
  const detail = status === 'available' ? null : status

  if (Object.values(evidence.queries).some((o) => o !== 'complete')) return unknown('no_telemetry', telemetry, null, detail)
  const cpu = evidence.values?.cpu ?? null
  const freeBytes = evidence.values?.freeStorageMin ?? null
  if (cpu === null || freeBytes === null) return unknown('no_telemetry', telemetry, null, detail)
  const allocatedGiB = Number(resource.metadata?.allocated_storage)
  if (!(allocatedGiB > 0)) return unknown('not_supported', telemetry, null, detail)

  const lowStorage = freeBytes < RDS_FREE_STORAGE_MIN_RATIO * allocatedGiB * BYTES_PER_GIB
  const busyCpu = cpu >= RDS_CPU_ATTENTION_PERCENT
  return judged(lowStorage || busyCpu ? 'needs_attention' : 'passing', telemetry, null, detail)
}

/**
 * Application load balancer (L1/L2): the 5xx rate (ELB + target 5xx over RequestCount,
 * one LoadBalancer dimension, the selected range) and the existing average-latency
 * verdict, the worse of the two. Nothing served and nothing failed is no_activity; fewer
 * than 100 requests and fewer than 100 5xx is not enough traffic to judge.
 */
function albVerdict(row: EvaluatedRowView, evidence: ResourceEvidence, telemetry: TelemetryState): Verdict {
  const requests = completedCount(evidence, 'requestSum')
  const errors = completedCount(evidence, 'errorSum') + completedCount(evidence, 'elb5xxSum')
  if (requests === 0 && errors === 0) return unknown('no_activity', telemetry, 'no_activity')
  const activity: ActivityState = 'active'
  if (requests < LB_MIN_REQUESTS && errors < LB_MIN_REQUESTS) return unknown('not_enough_traffic', telemetry, activity)

  const fivexx = errors * LB_5XX_PASS_RATIO <= requests ? 'passing' : errors * LB_5XX_ATTENTION_RATIO <= requests ? 'needs_attention' : 'failing'
  if (fivexx === 'failing') return judged('failing', telemetry, activity)
  const latency = row.status === 'healthy' ? 'passing' : row.status === 'degraded' ? 'needs_attention' : null
  if (latency === null) return unknown('no_telemetry', telemetry, activity)
  return judged(worse(fivexx, latency), telemetry, activity)
}

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
    if (resource.resource_type === 'rds' && resource.status === 'stopped') return judged('stopped', 'unknown', null)
    return judged('not_measured', 'unknown', null)
  }
  if (ctx.blockFailed) return unknown('query_failed')
  // Evaluated type, but no row: its dimension could not be resolved.
  if (!row || !evidence) return unknown('not_supported')

  // A resource the check can't evaluate at all (no query could be built for it) is
  // not_supported, not a failed collection.
  if (evidence.unsupported && Object.keys(evidence.queries).length === 0) return unknown('not_supported')
  const all = aggregateOutcome(Object.values(evidence.queries))
  if (isFailure(all)) return unknown(all)

  const datapointOutcomes = Object.entries(evidence.queries)
    .filter(([key]) => evidence.kind === 'point_in_time' || key !== 'describe')
    .map(([, outcome]) => outcome)
  const telemetryOutcome = aggregateOutcome(datapointOutcomes)
  // No datapoint query at all is no telemetry evidence either way: unknown.
  const telemetry: TelemetryState =
    evidence.unsupported || isFailure(telemetryOutcome) ? 'unknown' : telemetryOutcome === 'empty' ? 'no_telemetry' : 'reporting'

  let activity: ActivityState | null = null
  if (evidence.activity) {
    const outcome = evidence.queries[evidence.activity.key]
    if (outcome === 'empty' || (outcome === 'complete' && (evidence.activity.value ?? 0) === 0)) activity = 'no_activity'
    else if (outcome === 'complete') activity = 'active'
  }

  if (
    evidence.stopped ||
    (resource.resource_type === 'ec2' && EC2_STOPPED.has(resource.status ?? '')) ||
    (resource.resource_type === 'rds' && RDS_STOPPED.has(resource.status ?? ''))
  ) {
    return judged('stopped', telemetry, activity)
  }
  if (evidence.unsupported) return unknown('not_supported', telemetry, activity)

  if (resource.resource_type === 'rds') return rdsVerdict(resource, evidence, telemetry)
  if (resource.resource_type === 'load-balancer') return albVerdict(row, evidence, telemetry)
  // T1: a throttled function needs attention, checked before idle -- throttled calls are
  // not counted as invocations, so a fully throttled function looks idle (Inactive
  // included: the legacy rule calls it down). A Failed function stays failing below.
  if (resource.resource_type === 'lambda' && completedCount(evidence, 'throttles') > 0 && resource.status !== 'Failed' && row.status !== 'critical') {
    return judged('needs_attention', telemetry, activity)
  }

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
      return judged('passing', telemetry, activity)
    case 'degraded':
      return judged('needs_attention', telemetry, activity)
    case 'critical':
    case 'down':
      return judged('failing', telemetry, activity)
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
    metrics: row && inScope ? labelledMetrics(resource.resource_type, row, evidence, ctx.rangeLabel, resource.metadata) : [],
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
