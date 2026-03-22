import api, { handleApiResponse } from '@/lib/api'

export interface ApiKey {
  id: string
  name: string
  prefix: string
  scopes: string[]
  status: 'active' | 'revoked'
  created_at: string
  last_used_at: string | null
  raw_key?: string
}

export interface WebhookEndpoint {
  id: string
  url: string
  events: string[]
  status: 'active' | 'failing' | 'disabled'
  created_at: string
  last_triggered_at: string | null
  secret?: string
}

const developersService = {
  // API Keys
  async getKeys(): Promise<ApiKey[]> {
    const response = await api.get<{ success: boolean; data: ApiKey[] }>('/api/keys')
    return handleApiResponse(response)
  },

  async generateKey(name: string, scopes?: string[]): Promise<ApiKey> {
    const response = await api.post<{ success: boolean; data: ApiKey }>('/api/keys', { name, scopes })
    return handleApiResponse(response)
  },

  async revokeKey(id: string): Promise<void> {
    await api.delete(`/api/keys/${id}`)
  },

  // Webhooks
  async getWebhooks(): Promise<WebhookEndpoint[]> {
    const response = await api.get<{ success: boolean; data: WebhookEndpoint[] }>('/api/webhooks')
    return handleApiResponse(response)
  },

  async addWebhook(url: string, events?: string[]): Promise<WebhookEndpoint> {
    const response = await api.post<{ success: boolean; data: WebhookEndpoint }>('/api/webhooks', { url, events })
    return handleApiResponse(response)
  },

  async deleteWebhook(id: string): Promise<void> {
    await api.delete(`/api/webhooks/${id}`)
  },
}

export default developersService
