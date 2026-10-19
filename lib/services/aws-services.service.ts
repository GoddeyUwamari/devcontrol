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
}

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
