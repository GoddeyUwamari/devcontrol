import api from '@/lib/api'

export interface AWSService {
  id: string
  name: string
  type: string          // resource_type: 'ec2' | 'ecs' | 'lambda' | 'rds' | 'eks' etc.
  environment: string | null  // null: no environment tag (shown as "Untagged")
  region: string
  // 'unknown': no lifecycle state to judge -- the type has none (S3, SNS, VPC) or it was not read.
  status: 'healthy' | 'warning' | 'critical' | 'unknown'
  uptime: number
  owner: string | null
  team: string | null
  monthly_cost: number | null
  last_deployed: string | null
  metadata: Record<string, any>
  // Unified severity — merges resource status, compliance findings, and cost
  // recommendations server-side (see services.routes.ts). null = no findings.
  priority_severity: 'critical' | 'high' | 'medium' | 'low' | null
  needs_attention: boolean
  reason: string | null
  // From services Phase 1 (S1-A). Absent from an older backend.
  /** aws_resources.region: the region the resource was discovered in ('global' for CloudFront). */
  aws_region?: string | null
  /** When a discovery last listed the resource. */
  last_seen_at?: string | null
  ownership?: ResourceOwnership
  /** Why a resource that needs attention does; null when it doesn't. */
  attention_cause?: AttentionCause | null
}

/**
 * Whose a resource is, from its tags: 'owned' has an Owner or a Team tag,
 * 'unowned' has neither, 'unknown' means its tags could not be read (not
 * counted as unowned).
 */
export type ResourceOwnership = 'owned' | 'unowned' | 'unknown'
export type AttentionCause = 'finding' | 'cost_recommendation' | 'status'

export interface AWSServicesStats {
  total: number
  healthy: number
  needs_attention: number
  avg_uptime: number | null
  // Current findings on those resources, by severity. Absent from an older backend.
  findings_by_severity?: { critical: number; high: number; medium: number; low: number }
  // Why the needs_attention resources are counted. A resource can be in more than one.
  attention_reasons?: { with_finding: number; with_cost_recommendation: number; stopped_or_degraded: number; failed: number }
  // The organization's connected AWS accounts (its aws_accounts rows). Absent from an older backend.
  aws_accounts_connected?: number
  // From services Phase 1 (S1-A). Absent from an older backend.
  /** The needs_attention resources by their priority_severity (resources, not findings). */
  attention_by_severity?: { critical: number; high: number; medium: number; low: number }
  ownership?: Record<ResourceOwnership, number>
  /** The 'unknown' ownership count by resource type. */
  unknown_by_type?: Record<string, number>
  regions?: { region: string; count: number }[]
  /** By Team tag value, case-insensitively; only resources whose tags were read. */
  teams?: { top: { team: string; count: number }[]; all: { team: string; count: number }[]; total_teams: number }
  /** Resources whose service_id names a registered service of this organization. */
  mapped_to_service?: number
}

/**
 * GET /api/services/coverage (S1-B): what the page may say about scan
 * coverage, read from the database only.
 *
 * - scope.home_region.count includes S3 buckets stored in the home region, so it
 *   is never added to the S3 or CloudFront counts: totals come from `total` or
 *   `regions`.
 * - in_last_scan means the type was in the last scan's planned scope, not that
 *   it was scanned successfully: read it with last_scan.status.
 * - last_scan is the organization's newest discovery job, which can predate a
 *   reconnect, so it is not described as the connected account's scan. It is
 *   the latest attempt: whether the latest scan worked is read here, not from
 *   region_status (a scan that stopped early leaves a region's status as it was).
 * - The multi-region keys (M5c) are optional: a backend before M5c does not send
 *   them, and nothing may assume them. Nothing renders them before M6.
 */
export interface ServicesCoverage {
  account: { connected: boolean; status: string | null; home_region: string | null }
  scope: {
    home_region: { region: string; count: number } | null
    s3: { in_last_scan: boolean; regions: { region: string | null; count: number }[] }
    cloudfront: { in_last_scan: boolean; count: number }
    enabled_regions: {
      known: boolean
      /** Enabled regions in the latest region list; null while no list has been stored. */
      count: number | null
      /** When the latest region list was taken. */
      listed_at?: string | null
      /** The latest list is older than about 2 scan intervals (server clock); false while unknown. */
      stale?: boolean
    }
  }
  /** The enabled regions of the latest region list, home first; [] with no account or no list. */
  region_status?: RegionCoverage[]
  /** Non-null only while a discovery scan holds the lease with its job running (a cost Analyze is not one). */
  scan_in_progress?: { since: string } | null
  /** The newest completed job; its completed_at equals last_successful_scan_at. */
  last_completed_scan?: {
    started_at: string | null
    completed_at: string
    resource_types: string[]
    warnings: string[]
  } | null
  last_successful_scan_at: string | null
  last_scan: {
    status: string
    started_at: string | null
    completed_at: string | null
    warnings: string[]
  } | null
  resource_types: string[] | null
  tags_unknown_by_type: Record<string, number>
  regions: { region: string | null; count: number }[]
  total: number
}

/**
 * aws_account_regions.last_scan_status. Multi-region M5 writes ok, partial,
 * failed, denied and timed_out (each failure means at least one home-region
 * source, not the whole region); never_scanned is the default.
 */
export type RegionScanStatus =
  | 'ok'
  | 'partial'
  | 'failed'
  | 'denied'
  | 'timed_out'
  | 'never_scanned'
  | 'skipped_locked'
  | 'not_enabled'

/** One enabled region of the latest region list (GET /api/services/coverage, M5c). */
export interface RegionCoverage {
  region: string
  home: boolean
  status: RegionScanStatus
  last_scan_finished_at: string | null
  last_success_at: string | null
  /** A known code (today only partial's two truncation codes), never text; null otherwise. */
  last_error_code: string | null
  /**
   * Scans in a row that reached the status write with a failed home-region
   * source. A scan that stopped before the write is not counted: not "failed
   * attempts in a row".
   */
  consecutive_failures: number
  /** The status is older than about 2 scan intervals (server clock); never for never_scanned. */
  stale: boolean
}

export interface DiscoverResult {
  discovered: number
  updated: number
  errors: string[]
  /** Discovery warning codes (components/aws/discovery-warning-notice.tsx). */
  warnings: string[]
  jobId?: string
  message: string
}

export interface AWSServiceFilters {
  type?: string
  env?: string
  search?: string
}

export interface AWSServicesPageRequest extends AWSServiceFilters {
  // true: only resources that need attention; false: only the others; absent: both.
  needs_attention?: boolean
  // Opt-in filters from services Phase 1 (S1-A); each is sent only when set.
  /** aws_resources.region, exactly. */
  region?: string
  ownership?: ResourceOwnership
  /** The Team tag value, case-insensitively. Empty means every team and is not sent (the API rejects ?team=). */
  team?: string
  /** true: only resources whose tags were read; false: only the others. */
  tags_known?: boolean
  /** ?search also matches tag keys and values. */
  search_tags?: boolean
  /** 'attention': resources that need attention first, by severity, then name. */
  sort?: 'name' | 'attention'
  page?: number
  limit?: number
}

// One page of GET /api/services. Every number is the server's, computed over the
// full filtered set for the organization, never over the rows of this page.
export interface AWSServicesPage {
  services: AWSService[]
  pagination: { page: number; limit: number; total: number; total_pages: number; has_more: boolean }
  // The type/env/search-filtered set split by needs_attention; needs_attention= does not narrow these.
  counts: { needs_attention: number; no_flagged_issues: number }
}

const awsServicesService = {
  async getServices(filters?: AWSServicesPageRequest): Promise<AWSServicesPage> {
    const params = new URLSearchParams()
    if (filters?.type   && filters.type   !== 'all') params.set('type',   filters.type)
    if (filters?.env    && filters.env    !== 'all') params.set('env',    filters.env)
    if (filters?.search && filters.search.trim())    params.set('search', filters.search.trim())
    if (filters?.needs_attention !== undefined)      params.set('needs_attention', String(filters.needs_attention))
    if (filters?.region)                             params.set('region', filters.region)
    if (filters?.ownership)                          params.set('ownership', filters.ownership)
    if (filters?.team && filters.team.trim())        params.set('team', filters.team.trim())
    if (filters?.tags_known !== undefined)           params.set('tags_known', String(filters.tags_known))
    if (filters?.search_tags)                        params.set('search_tags', 'true')
    if (filters?.sort)                               params.set('sort', filters.sort)
    if (filters?.page)  params.set('page',  String(filters.page))
    if (filters?.limit) params.set('limit', String(filters.limit))

    const query = params.toString() ? `?${params}` : ''
    const res = await api.get<{
      success: boolean
      services: AWSService[]
      pagination?: AWSServicesPage['pagination']
      counts?: AWSServicesPage['counts']
      error?: string
    }>(`/api/services${query}`)
    if (!res.data.success) throw new Error(res.data.error || 'Failed to load services')
    // A response without the server's pagination or counts can't be shown truthfully as a page.
    if (!res.data.pagination || !res.data.counts) throw new Error('Failed to load services')
    return { services: res.data.services ?? [], pagination: res.data.pagination, counts: res.data.counts }
  },

  async getStats(): Promise<AWSServicesStats> {
    const res = await api.get<{ success: boolean; stats: AWSServicesStats; error?: string }>(
      '/api/services/stats'
    )
    if (!res.data.success) throw new Error(res.data.error || 'Failed to load stats')
    return res.data.stats
  },

  async getCoverage(): Promise<ServicesCoverage> {
    const res = await api.get<{ success: boolean; coverage?: ServicesCoverage; error?: string }>(
      '/api/services/coverage'
    )
    if (!res.data.success || !res.data.coverage) throw new Error(res.data.error || 'Failed to load scan coverage')
    return res.data.coverage
  },

  async discoverServices(): Promise<DiscoverResult> {
    const res = await api.post<{
      success: boolean
      discovered: number
      updated: number
      errors: string[]
      warnings?: string[]
      jobId?: string
      message: string
      error?: string
    }>('/api/services/discover')
    if (!res.data.success) throw new Error(res.data.error || 'Discovery failed')
    return {
      discovered: res.data.discovered,
      updated:    res.data.updated,
      errors:     res.data.errors ?? [],
      warnings:   res.data.warnings ?? [],
      jobId:      res.data.jobId,
      message:    res.data.message,
    }
  },

  async getService(id: string): Promise<AWSService> {
    const res = await api.get<{ success: boolean; service: AWSService; error?: string }>(
      `/api/services/${id}`
    )
    if (!res.data.success) throw new Error(res.data.error || 'Service not found')
    return res.data.service
  },
}

export default awsServicesService
