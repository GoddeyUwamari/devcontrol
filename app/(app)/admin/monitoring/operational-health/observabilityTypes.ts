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
}

export interface ResourcesNotOk {
  status: 'not_connected' | 'multiple_accounts' | 'failed'
  reason?: 'query_failed' | 'connection_failed'
  region: null
  account_count: number | null
}

export type ResourcesData = ResourcesOk | ResourcesNotOk

export type AlarmsErrorReason = 'access_denied' | 'throttled' | 'failed' | 'not_connected' | 'multiple_accounts'

export type AlarmsData =
  | {
      status: 'ok'
      reason: null
      checked_at: string
      region: string
      in_alarm: unknown[]
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
