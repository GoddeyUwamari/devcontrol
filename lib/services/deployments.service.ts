import api, { handleApiResponse } from '../api';
import type {
  Deployment,
  CreateDeploymentPayload,
  DeploymentFilters,
  ApiResponse,
} from '../types';

export const deploymentsService = {
  // Get all deployments with optional filters
  getAll: async (filters?: DeploymentFilters): Promise<Deployment[]> => {
    const params = new URLSearchParams();
    if (filters?.serviceId) params.append('service_id', filters.serviceId);
    if (filters?.environment) params.append('environment', filters.environment);
    if (filters?.status) params.append('status', filters.status);
    if (filters?.limit) params.append('limit', filters.limit.toString());
    
    const queryString = params.toString() ? `?${params.toString()}` : '';
    const response = await api.get<ApiResponse<any>>(`/api/deployments${queryString}`);
    const result = handleApiResponse(response);
    
    // Transform backend snake_case to frontend camelCase
    return (result || []).map((d: any) => ({
      id: d.id,
      serviceId: d.service_id,
      serviceName: d.service_name,
      environment: d.environment,
      awsRegion: d.aws_region,
      status: d.status,
      costEstimate: parseFloat(d.cost_estimate) || 0,
      deployedBy: d.deployed_by,
      deployedAt: d.deployed_at,
      resources: d.resources,
      logs: d.logs,
      metadata: d.metadata,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
    }));
  },

  // Get deployment by ID
  getById: async (id: string): Promise<Deployment> => {
    const response = await api.get<ApiResponse<any>>(`/api/deployments/${id}`);
    const d = handleApiResponse(response);
    
    return {
      id: d.id,
      serviceId: d.service_id,
      serviceName: d.service_name,
      environment: d.environment,
      awsRegion: d.aws_region,
      status: d.status,
      costEstimate: parseFloat(d.cost_estimate) || 0,
      deployedBy: d.deployed_by,
      deployedAt: d.deployed_at,
      resources: d.resources,
      logs: d.logs,
      metadata: d.metadata,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
    };
  },

  // Create new deployment
  create: async (payload: CreateDeploymentPayload): Promise<Deployment> => {
    const response = await api.post<ApiResponse<any>>('/api/deployments', payload);
    const d = handleApiResponse(response);
    
    return {
      id: d.id,
      serviceId: d.service_id,
      serviceName: d.service_name,
      environment: d.environment,
      awsRegion: d.aws_region,
      status: d.status,
      costEstimate: parseFloat(d.cost_estimate) || 0,
      deployedBy: d.deployed_by,
      deployedAt: d.deployed_at,
      resources: d.resources,
      logs: d.logs,
      metadata: d.metadata,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
    };
  },

  // Delete deployment
  delete: async (id: string): Promise<void> => {
    await api.delete(`/api/deployments/${id}`);
  },

  // Get deployment stats (total, running, failed, deploying, success_rate, total_cost)
  getStats: async (environment?: string): Promise<{
    total: number; running: number; failed: number; deploying: number;
    success_rate: number | null; total_cost: number;
  }> => {
    const query = environment && environment !== 'all' ? `?environment=${environment}` : '';
    const response = await api.get<ApiResponse<any>>(`/api/deployments/stats${query}`);
    return handleApiResponse(response);
  },

  // Create deployment from modal (accepts serviceName instead of service_id)
  createFromModal: async (payload: {
    serviceName: string; environment: string; region: string; version?: string;
  }): Promise<void> => {
    const response = await api.post<ApiResponse<any>>('/api/deployments', {
      service_name:  payload.serviceName,
      environment:   payload.environment,
      aws_region:    payload.region,
      deployed_by:   'platform-portal',
      ...(payload.version ? { version: payload.version } : {}),
    });
    handleApiResponse(response);
  },
};