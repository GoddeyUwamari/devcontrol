/**
 * The responses the Operational Health page reads, as the backend sends them:
 * GET /api/observability/resources (OB2, OB2.1, OB3) and GET
 * /api/observability/alarms (OB1). Nothing here is computed on the client.
 */

export type MonitoringRange = '5m' | '15m' | '1h' | '3h' | '24h' | '7d'

/** The explicit split of every resource row (OB2.1, observability-states.ts ObservabilityBreakdown). */
export interface Breakdown {
  count: number
  measured: number
  passing: number
  needs_attention: number
  failing: number
  check_unknown: number
  /** The check_unknown rows whose query failed, was denied or throttled. */
  check_failed: number
  neutral: number
  stopped: number
  no_activity: number
  not_enough_traffic: number
  not_measured: number
  outside_scope: number
  reporting: number
  no_telemetry: number
  unknown: number
}

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

/** One labelled metric value (observability-states.ts ObservabilityMetric). */
export interface ObservabilityMetric {
  label: string
  value: number
  unit?: string
  statistic: 'Average' | 'Sum' | 'Maximum' | 'Minimum' | null
  /** The range (e.g. "1h") for a value over the window; "current" for a point-in-time value. */
  window: string
}

/** One resource's row (observability-states.ts ObservabilityRow). */
export interface ObservabilityRow {
  resource_id: string
  resource_type: string
  name: string
  region: string | null
  check_status: CheckStatus
  unknown_reason: UnknownReason | null
  telemetry: 'reporting' | 'no_telemetry' | 'unknown'
  activity: 'active' | 'no_activity' | null
  status_detail: string | null
  last_seen: string | null
  last_seen_source: 'datapoint' | 'observation' | null
  metrics: ObservabilityMetric[]
}

/** The Resource checks table's request (O2): sent as table=1&q=&filter=&page=. */
export interface TableQuery {
  q: string
  /** all · attention (failing + needs attention) · a resource type */
  filter: string
  page: number
}

/** The table block, sent only with table=1 (observability-table.ts). */
export interface TableBlock {
  /** The request as the server applied it; page is clamped to the last page. */
  query: TableQuery & { page_size: number; order: 'status' }
  rows: ObservabilityRow[]
  /** Rows matching q and filter. */
  total: number
  pages: number
  /** Over the rows matching q, before the filter. */
  facets: { all: number; attention: number; types: Record<string, number> }
}

export interface ResourcesOk {
  status: 'ok'
  region: string
  account_count: number
  multiple_accounts: false
  range: MonitoringRange
  collection: 'complete' | 'partial'
  checked_at: string | null
  captured_at: string
  inventory_capped: boolean | null
  inventory_capped_reasons: string[]
  type_breakdown: Record<string, Breakdown>
  fleet_summary: Breakdown
  table?: TableBlock
}

export interface ResourcesNotOk {
  status: 'not_connected' | 'multiple_accounts' | 'failed'
  reason?: 'query_failed' | 'connection_failed'
  region: null
  account_count: number | null
}

export type ResourcesData = ResourcesOk | ResourcesNotOk

export type AlarmsErrorReason = 'access_denied' | 'throttled' | 'failed' | 'not_connected' | 'multiple_accounts'

/** The resource an alarm watches (cloudwatch-alarms.service.ts AlarmResource). */
export interface AlarmResource {
  type: string
  id: string
}

/** One alarm in ALARM (cloudwatch-alarms.service.ts InAlarmItem). No severity: CloudWatch has none (B4). */
export interface InAlarmItem {
  name: string
  type: 'metric' | 'composite'
  /** Null for composite and metric-math alarms. */
  namespace: string | null
  metric: string | null
  /** Null for composite alarms. */
  comparison: string | null
  /** Null for composite alarms and for alarms with no numeric threshold (anomaly bands). */
  threshold: number | null
  /** When the alarm last changed state (StateTransitionedTimestamp); null when AWS gives none. */
  state_since: string | null
  /** Only when one well-known dimension names it. */
  resource: AlarmResource | null
}

export type AlarmsData =
  | {
      status: 'ok'
      reason: null
      checked_at: string
      region: string
      /** In no particular order (API page order); the page sorts it. */
      in_alarm: InAlarmItem[]
      in_alarm_complete: boolean
      configured_count: number
      configured_count_complete: boolean
      truncated: boolean
    }
  | {
      status: 'error'
      reason: AlarmsErrorReason
      checked_at: string
      region: string | null
      in_alarm: null
      in_alarm_complete: null
      configured_count: null
      configured_count_complete: null
      truncated: null
    }

/**
 * One request's state on the page. `error`: the request itself failed
 * (`unavailable`: HTTP 503, DevControl couldn't reach AWS; `failed`: anything else).
 */
export type Source<T> = { state: 'loading' } | { state: 'ok'; data: T } | { state: 'error'; kind: 'unavailable' | 'failed' }

/** The SLO row's state (O1 decision D13). */
export type SloState =
  | { state: 'loading' }
  | { state: 'plan_required' }
  | { state: 'plan_error' }
  | { state: 'none' }
  | { state: 'ok'; count: number; breached: number; unevaluated: number }
  | { state: 'error' }

export interface PlanInfo {
  status: 'loading' | 'known' | 'error'
  tier: 'free' | 'starter' | 'pro' | 'enterprise'
}
