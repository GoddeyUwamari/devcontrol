import api, { handleApiResponse } from '../api';
import type {
  CostRecommendation,
  RecommendationStats,
  AnalysisResult,
  ApiResponse,
} from '../types';

export const costRecommendationsService = {
  // Get all recommendations
  getAll: async (filters?: {
    severity?: string;
    status?: string;
    resourceType?: string;
  }): Promise<CostRecommendation[]> => {
    const params = new URLSearchParams();
    if (filters?.severity) params.append('severity', filters.severity);
    if (filters?.status) params.append('status', filters.status);
    if (filters?.resourceType) params.append('resource_type', filters.resourceType);

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
    };
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
