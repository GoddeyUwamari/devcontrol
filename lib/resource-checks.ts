/**
 * Resource checks: the shared client for GET /api/cloudwatch/metrics, used by
 * /admin/monitoring and the Dashboard's Resource checks section. The backend
 * (CloudWatchService.getMetrics) is the only source of check results and
 * caches them for 45s per (organization, range); nothing here caches, and
 * nothing here re-derives a resource's status.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'

/** The range /admin/monitoring opens with. Callers that share it share the backend's cache entry. */
export const RESOURCE_CHECKS_DEFAULT_RANGE = '1h'

export interface ServiceMetric {
  label: string
  value: number
  unit?: string
}

export type ResourceCheckStatus = 'healthy' | 'degraded' | 'critical' | 'down' | 'unknown'

export interface ServiceHealth {
  name: string; description?: string; status: ResourceCheckStatus
  uptime: string; responseTime: string; errorRate: number | null; critical?: boolean
  recentIncidents?: number; uptimeHistory?: number[]; monitored?: boolean
  // Phase B additions, passed through from the backend response below.
  resourceType?: string; metrics?: ServiceMetric[]
  /** The AWS-side identifier (e.g. an EC2 instance id). */
  resourceId?: string
}

// CloudWatch Scalability Phase 2D: complete-fleet aggregate health, computed server-side
// from every evaluated resource (see cloudwatch.service.ts's computeMetrics()) -- never
// derived client-side from `services` anymore, since that's now only a bounded page.
export interface HealthSummary { total: number; healthy: number; degraded: number; critical: number; down: number; monitored: number }
export type SystemStatus = 'healthy' | 'degraded' | 'critical' | 'down'
export interface PaginationMeta { shown: number; total: number; hasMore: boolean; cursor: string | null }

// Resource check counts among resources reporting telemetry, from the
// server's healthSummary as-is. Each type runs its own check (status checks
// for EC2/EBS, thresholds for ALB/Lambda/Aurora...), so a mixed fleet is
// reported as "N of M with no issues detected" -- never as a health
// percentage. A resource whose check produced no result ('unknown') is
// counted as undetermined, never as passing.
export interface CheckCounts { reporting: number; noIssues: number; withIssues: number; undetermined: number; discovered: number }
export function checkCountsFrom(summary: HealthSummary): CheckCounts {
  const withIssues = summary.degraded + summary.critical + summary.down
  return {
    reporting: summary.monitored,
    noIssues: summary.healthy,
    withIssues,
    undetermined: Math.max(0, summary.monitored - summary.healthy - withIssues),
    discovered: summary.total,
  }
}

// CloudWatch Scalability Phase 2D: shared mapper so the first page and subsequent pages
// map a raw API service row to the display shape identically.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const mapServiceRow = (s: any): ServiceHealth => ({
  name: s.name,
  description: s.description,
  status: s.status,
  uptime: s.uptime !== null && s.uptime !== undefined ? `${s.uptime}%` : 'N/A',
  responseTime: s.responseTimeMs !== null && s.responseTimeMs !== undefined ? `${s.responseTimeMs}ms` : 'N/A',
  errorRate: s.errorRate ?? null,
  critical: s.critical,
  monitored: s.monitored,
  // Phase B: pass through resourceType and metrics — previously dropped here even
  // though the backend already returned resourceType, which is why filter tabs and
  // per-resource metrics couldn't be built without this fix.
  resourceType: s.resourceType,
  metrics: Array.isArray(s.metrics) ? s.metrics : undefined,
  resourceId: typeof s.resourceId === 'string' ? s.resourceId : undefined,
})

function authToken(): string | null | undefined {
  return document.cookie.split(';').find(c => c.trim().startsWith('auth-token='))?.split('=')[1] || localStorage.getItem('accessToken')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CloudWatchMetricsData = any

/**
 * 'ok': the endpoint returned check results. 'not_connected': it answered
 * `data: null` (no AWS account for this organization). 'failed': the request
 * failed or returned no success flag.
 */
export type CloudWatchMetricsResult =
  | { kind: 'ok'; data: CloudWatchMetricsData }
  | { kind: 'not_connected' }
  | { kind: 'failed' }

/**
 * One GET /api/cloudwatch/metrics. `forceRefresh` maps to `?refresh=true`, the backend's
 * explicit cache-bypass signal -- only a user asking for fresh data passes it.
 */
export async function requestCloudWatchMetrics(opts: { range?: string; forceRefresh?: boolean; cursor?: string } = {}): Promise<CloudWatchMetricsResult> {
  try {
    const params = new URLSearchParams()
    if (opts.range) params.set('range', opts.range)
    if (opts.forceRefresh) params.set('refresh', 'true')
    if (opts.cursor) params.set('cursor', opts.cursor)
    const query = params.toString()
    const res = await fetch(`${API_URL}/api/cloudwatch/metrics${query ? `?${query}` : ''}`, { headers: { 'Authorization': `Bearer ${authToken()}` } })
    const data = await res.json()
    if (data.success && data.data) return { kind: 'ok', data: data.data }
    if (data.success && data.data === null) return { kind: 'not_connected' }
    return { kind: 'failed' }
  } catch {
    return { kind: 'failed' }
  }
}
