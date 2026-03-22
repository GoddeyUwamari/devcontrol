import api from '@/lib/api'

export interface AWSService {
  id: string
  name: string
  type: string          // resource_type: 'ec2' | 'ecs' | 'lambda' | 'rds' | 'eks' etc.
  environment: string
  region: string
  status: 'healthy' | 'warning' | 'critical'
  uptime: number
  owner: string | null
  team: string | null
  monthly_cost: number | null
  last_deployed: string | null
  metadata: Record<string, any>
}

export interface AWSServicesStats {
  total: number
  healthy: number
  needs_attention: number
  avg_uptime: number | null
}

export interface DiscoverResult {
  discovered: number
  updated: number
  errors: string[]
  jobId?: string
  message: string
}

export interface AWSServiceFilters {
  type?: string
  env?: string
  search?: string
}

const awsServicesService = {
  async getServices(filters?: AWSServiceFilters): Promise<AWSService[]> {
    const params = new URLSearchParams()
    if (filters?.type   && filters.type   !== 'all') params.set('type',   filters.type)
    if (filters?.env    && filters.env    !== 'all') params.set('env',    filters.env)
    if (filters?.search && filters.search.trim())    params.set('search', filters.search.trim())

    const query = params.toString() ? `?${params}` : ''
    const res = await api.get<{ success: boolean; services: AWSService[]; error?: string }>(
      `/api/services${query}`
    )
    if (!res.data.success) throw new Error(res.data.error || 'Failed to load services')
    return res.data.services ?? []
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
      jobId?: string
      message: string
      error?: string
    }>('/api/services/discover')
    if (!res.data.success) throw new Error(res.data.error || 'Discovery failed')
    return {
      discovered: res.data.discovered,
      updated:    res.data.updated,
      errors:     res.data.errors ?? [],
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
