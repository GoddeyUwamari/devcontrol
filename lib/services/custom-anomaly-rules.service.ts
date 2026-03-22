import api, { handleApiResponse } from '@/lib/api'

export interface CustomAnomalyRule {
  id: string
  organizationId: string
  name: string
  description?: string
  metric: string
  condition: 'greater_than' | 'less_than' | 'percent_change_up' | 'percent_change_down'
  threshold: number
  timeWindow: string
  severity: 'info' | 'warning' | 'critical'
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateRulePayload {
  name: string
  description?: string
  metric: string
  condition: CustomAnomalyRule['condition']
  threshold: number
  timeWindow?: string
  severity?: CustomAnomalyRule['severity']
}

const customAnomalyRulesService = {
  async getRules(): Promise<CustomAnomalyRule[]> {
    const response = await api.get<{ success: boolean; data: CustomAnomalyRule[] }>('/api/anomaly-rules')
    return handleApiResponse(response)
  },

  async createRule(payload: CreateRulePayload): Promise<CustomAnomalyRule> {
    const response = await api.post<{ success: boolean; data: CustomAnomalyRule }>('/api/anomaly-rules', payload)
    return handleApiResponse(response)
  },

  async updateRule(id: string, payload: Partial<CreateRulePayload & { enabled: boolean }>): Promise<CustomAnomalyRule> {
    const response = await api.patch<{ success: boolean; data: CustomAnomalyRule }>(`/api/anomaly-rules/${id}`, payload)
    return handleApiResponse(response)
  },

  async toggleRule(id: string, enabled: boolean): Promise<CustomAnomalyRule> {
    const response = await api.patch<{ success: boolean; data: CustomAnomalyRule }>(`/api/anomaly-rules/${id}/toggle`, { enabled })
    return handleApiResponse(response)
  },

  async deleteRule(id: string): Promise<void> {
    await api.delete(`/api/anomaly-rules/${id}`)
  },
}

export default customAnomalyRulesService
