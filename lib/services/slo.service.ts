import api, { handleApiResponse } from '@/lib/api'

// Mirrors backend/src/services/slo-evaluation.ts's canonical domain exactly — the
// frontend must never offer a choice (resource type, SLI, window) the backend cannot
// actually evaluate. See GET /api/slos/options, which is fetched at runtime rather than
// hardcoded a second time, so the two can never drift apart.
export type SloResourceType = 'ec2' | 'load-balancer' | 'lambda'
export type SloIndicator = 'ec2_availability' | 'alb_latency_avg' | 'alb_error_rate' | 'lambda_error_rate'
export type SloWindow = '24h' | '7d'
export type SloUnit = 'percent' | 'ms'

export const SLI_RESOURCE_TYPE: Record<SloIndicator, SloResourceType> = {
  ec2_availability: 'ec2',
  alb_latency_avg: 'load-balancer',
  alb_error_rate: 'load-balancer',
  lambda_error_rate: 'lambda',
}

export const SLI_LABEL: Record<SloIndicator, string> = {
  ec2_availability: 'EC2 Availability',
  alb_latency_avg: 'ALB Average Latency',
  alb_error_rate: 'ALB Error Rate',
  lambda_error_rate: 'Lambda Error Rate',
}

export interface SloDefinition {
  id: string
  organizationId: string
  name: string
  resourceType: SloResourceType
  resourceId: string
  sli: SloIndicator
  targetValue: number
  evaluationWindow: SloWindow
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateSloPayload {
  name: string
  resourceId: string
  sli: SloIndicator
  targetValue: number
  evaluationWindow?: SloWindow
}

export interface UpdateSloPayload {
  name?: string
  resourceId?: string
  targetValue?: number
  evaluationWindow?: SloWindow
  enabled?: boolean
}

export type SloEvaluationStatus = 'healthy' | 'breached' | 'insufficient_data' | 'resource_not_found' | 'aws_not_connected'

export interface SloErrorBudget {
  applicable: boolean
  allowedFailureRate: number | null
  observedFailureRate: number | null
  consumedFraction: number | null
  remainingFraction: number | null
}

export interface SloEvaluationResult {
  status: SloEvaluationStatus
  observedValue: number | null
  targetValue: number
  unit: SloUnit
  errorBudget: SloErrorBudget
}

export interface SloWithEvaluation {
  definition: SloDefinition
  evaluation: SloEvaluationResult
}

export interface SloOptions {
  slis: SloIndicator[]
  windows: SloWindow[]
}

const sloService = {
  async getOptions(): Promise<SloOptions> {
    const response = await api.get<{ success: boolean; data: SloOptions }>('/api/slos/options')
    return handleApiResponse(response)
  },

  async listSlos(): Promise<SloDefinition[]> {
    const response = await api.get<{ success: boolean; data: SloDefinition[] }>('/api/slos')
    return handleApiResponse(response)
  },

  async createSlo(payload: CreateSloPayload): Promise<SloDefinition> {
    const response = await api.post<{ success: boolean; data: SloDefinition }>('/api/slos', payload)
    return handleApiResponse(response)
  },

  async updateSlo(id: string, payload: UpdateSloPayload): Promise<SloDefinition> {
    const response = await api.patch<{ success: boolean; data: SloDefinition }>(`/api/slos/${id}`, payload)
    return handleApiResponse(response)
  },

  async deleteSlo(id: string): Promise<void> {
    await api.delete(`/api/slos/${id}`)
  },

  async evaluateSlo(id: string): Promise<SloWithEvaluation> {
    const response = await api.get<{ success: boolean; data: SloWithEvaluation }>(`/api/slos/${id}/evaluate`)
    return handleApiResponse(response)
  },

  async evaluateAll(): Promise<SloWithEvaluation[]> {
    const response = await api.get<{ success: boolean; data: SloWithEvaluation[] }>('/api/slos/evaluate')
    return handleApiResponse(response)
  },
}

export default sloService
