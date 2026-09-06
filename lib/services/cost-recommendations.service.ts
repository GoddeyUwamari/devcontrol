import api, { handleApiResponse } from '../api';
import type {
  CostRecommendation,
  RecommendationStats,
  AnalysisResult,
  ApiResponse,
} from '../types';

// Sanitized shape returned by GET /api/cost-recommendations/analysis-runs --
// see CostRecommendationsController.getAnalysisRuns(): error_message here is
// already a safe, classified string (or null), never the raw stored error.
export interface CostAnalysisRun {
  id: string;
  status: 'running' | 'completed' | 'failed';
  recommendations_found: number | null;
  total_potential_savings: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
  error_message: string | null;
}

export const costRecommendationsService = {
  // Get all recommendations. limit/offset are already supported by the backend
  // (repository.findAll -- ORDER BY potential_savings DESC, created_at DESC) but were
  // not previously exposed here; no backend change needed to add them.
  getAll: async (filters?: {
    severity?: string;
    status?: string;
    resourceType?: string;
    limit?: number;
    offset?: number;
  }): Promise<CostRecommendation[]> => {
    const params = new URLSearchParams();
    if (filters?.severity) params.append('severity', filters.severity);
    if (filters?.status) params.append('status', filters.status);
    if (filters?.resourceType) params.append('resource_type', filters.resourceType);
    if (filters?.limit != null) params.append('limit', String(filters.limit));
    if (filters?.offset != null) params.append('offset', String(filters.offset));

    const queryString = params.toString() ? `?${params.toString()}` : '';
    const response = await api.get<ApiResponse<any>>(
      `/api/cost-recommendations${queryString}`
    );
    const result = handleApiResponse(response);

    // Transform backend snake_case to frontend camelCase
    return (result || []).map((r: any) => ({
      id: r.id,
      resourceId: r.resource_id,
      resourceName: r.resource_name,
      resourceType: r.resource_type,
      issue: r.issue,
      description: r.description,
      potentialSavings: parseFloat(r.potential_savings) || 0,
      severity: r.severity,
      status: r.status,
      awsRegion: r.aws_region,
      metadata: r.metadata,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      resolvedAt: r.resolved_at,
    }));
  },

  // Get recommendation statistics
  getStats: async (): Promise<RecommendationStats> => {
    const response = await api.get<ApiResponse<any>>('/api/cost-recommendations/stats');
    const result = handleApiResponse(response);

    return {
      totalRecommendations: result.total_recommendations || 0,
      activeRecommendations: result.active_recommendations || 0,
      totalPotentialSavings: parseFloat(result.total_potential_savings) || 0,
      bySeverity: {
        high: result.by_severity?.high || 0,
        medium: result.by_severity?.medium || 0,
        low: result.by_severity?.low || 0,
      },
    };
  },

  // Get recommendation by ID
  getById: async (id: string): Promise<CostRecommendation> => {
    const response = await api.get<ApiResponse<any>>(`/api/cost-recommendations/${id}`);
    const r = handleApiResponse(response);

    return {
      id: r.id,
      resourceId: r.resource_id,
      resourceName: r.resource_name,
      resourceType: r.resource_type,
      issue: r.issue,
      description: r.description,
      potentialSavings: parseFloat(r.potential_savings) || 0,
      severity: r.severity,
      status: r.status,
      awsRegion: r.aws_region,
      metadata: r.metadata,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      resolvedAt: r.resolved_at,
    };
  },

  // Analyze AWS resources to generate recommendations
  analyze: async (): Promise<AnalysisResult> => {
    const response = await api.post<ApiResponse<any>>('/api/cost-recommendations/analyze');
    const result = handleApiResponse(response);

    return {
      recommendationsFound: result.recommendationsFound || 0,
      totalPotentialSavings: parseFloat(result.totalPotentialSavings) || 0,
      bySeverity: {
        high: result.bySeverity?.high || 0,
        medium: result.bySeverity?.medium || 0,
        low: result.bySeverity?.low || 0,
      },
      timestamp: result.timestamp,
    };
  },

  // History of manual "Run cost analysis" invocations, latest first -- the
  // manual-run counterpart to awsResourcesService.getDiscoveryJobs(), which
  // only covers the separate scheduled discovery cron.
  getAnalysisRuns: async (limit: number = 5): Promise<CostAnalysisRun[]> => {
    const response = await api.get<ApiResponse<CostAnalysisRun[]>>(
      `/api/cost-recommendations/analysis-runs?limit=${limit}`
    );
    return handleApiResponse(response);
  },

  // Mark recommendation as resolved
  resolve: async (id: string): Promise<CostRecommendation> => {
    const response = await api.patch<ApiResponse<any>>(
      `/api/cost-recommendations/${id}/resolve`
    );
    const r = handleApiResponse(response);

    return {
      id: r.id,
      resourceId: r.resource_id,
      resourceName: r.resource_name,
      resourceType: r.resource_type,
      issue: r.issue,
      description: r.description,
      potentialSavings: parseFloat(r.potential_savings) || 0,
      severity: r.severity,
      status: r.status,
      awsRegion: r.aws_region,
      metadata: r.metadata,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      resolvedAt: r.resolved_at,
    };
  },

  // Execute real remediation for an Idle EC2 recommendation (stops the instance
  // via RemediationService). Only valid for resourceType === 'EC2' && issue ===
  // 'Idle Instance' recommendations — the backend rejects anything else.
  executeRemediation: async (
    id: string
  ): Promise<{ recommendation: CostRecommendation; workflow: any; message: string }> => {
    const response = await api.post<ApiResponse<{ recommendation: any; workflow: any }> & { message?: string }>(
      `/api/cost-recommendations/${id}/execute-remediation`
    );

    if (!response.data.success) {
      throw new Error((response.data as any).error || 'Execution failed');
    }

    const { recommendation: r, workflow } = response.data.data!;

    return {
      recommendation: {
        id: r.id,
        resourceId: r.resource_id,
        resourceName: r.resource_name,
        resourceType: r.resource_type,
        issue: r.issue,
        description: r.description,
        potentialSavings: parseFloat(r.potential_savings) || 0,
        severity: r.severity,
        status: r.status,
        awsRegion: r.aws_region,
        metadata: r.metadata,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        resolvedAt: r.resolved_at,
      },
      workflow,
      message: response.data.message || 'Remediation executed.',
    };
  },

  // Mark recommendation as dismissed
  dismiss: async (id: string): Promise<CostRecommendation> => {
    const response = await api.patch<ApiResponse<any>>(
      `/api/cost-recommendations/${id}/dismiss`
    );
    const r = handleApiResponse(response);

    return {
      id: r.id,
      resourceId: r.resource_id,
      resourceName: r.resource_name,
      resourceType: r.resource_type,
      issue: r.issue,
      description: r.description,
      potentialSavings: parseFloat(r.potential_savings) || 0,
      severity: r.severity,
      status: r.status,
      awsRegion: r.aws_region,
      metadata: r.metadata,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      resolvedAt: r.resolved_at,
    };
  },

  // Delete recommendation
  delete: async (id: string): Promise<void> => {
    await api.delete(`/api/cost-recommendations/${id}`);
  },

  // Get count of active recommendations
  getActiveCount: async (): Promise<number> => {
    const stats = await costRecommendationsService.getStats();
    return stats.activeRecommendations;
  },
};
