import api, { handleApiResponse } from '../api';
import type {
  DeploymentFilters,
  ApiResponse,
} from '../types';
import { recordedCost } from '../deployments/status';
import type { DeploymentPage, DeploymentStats, RecordedDeployment, StatsWindow } from '../deployments/status';
import type { RecordedResult } from '../deployments/record';

export const deploymentsService = {
  // Get all deployments with optional filters
  getAll: async (filters?: DeploymentFilters): Promise<RecordedDeployment[]> => {
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
      costEstimate: recordedCost(d.cost_estimate),
      deployedBy: d.deployed_by,
      deployedAt: d.deployed_at,
      resources: d.resources,
      logs: d.logs,
      metadata: d.metadata,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
    }));
  },

  // One page of the deployment log. The environment filter, the window and
  // the paging are all applied by the server, and `total` is counted with the
  // same filters -- so it matches the summary counts for them.
  getPage: async (filters: {
    environment?: string; dateRange?: StatsWindow; limit: number; offset: number;
  }): Promise<DeploymentPage> => {
    const params = new URLSearchParams();
    if (filters.environment && filters.environment !== 'all') params.append('environment', filters.environment);
    if (filters.dateRange) params.append('date_range', filters.dateRange);
    params.append('limit', filters.limit.toString());
    params.append('offset', filters.offset.toString());

    const response = await api.get<ApiResponse<any> & { total?: number }>(`/api/deployments?${params.toString()}`);
    const rows = handleApiResponse(response) || [];
    const total = response.data.total;
    if (typeof total !== 'number') throw new Error('Deployment list returned no total');

    return {
      deployments: rows.map((d: any) => ({
        id: d.id,
        serviceId: d.service_id,
        serviceName: d.service_name,
        environment: d.environment,
        awsRegion: d.aws_region,
        status: d.status,
        costEstimate: recordedCost(d.cost_estimate),
        deployedBy: d.deployed_by,
        deployedAt: d.deployed_at,
        resources: d.resources,
        logs: d.logs,
        metadata: d.metadata,
        createdAt: d.created_at,
        updatedAt: d.updated_at,
      })),
      total,
      limit: filters.limit,
      offset: filters.offset,
    };
  },

  // Get deployment by ID
  getById: async (id: string): Promise<RecordedDeployment> => {
    const response = await api.get<ApiResponse<any>>(`/api/deployments/${id}`);
    const d = handleApiResponse(response);
    
    return {
      id: d.id,
      serviceId: d.service_id,
      serviceName: d.service_name,
      environment: d.environment,
      awsRegion: d.aws_region,
      status: d.status,
      costEstimate: recordedCost(d.cost_estimate),
      deployedBy: d.deployed_by,
      deployedAt: d.deployed_at,
      resources: d.resources,
      logs: d.logs,
      metadata: d.metadata,
      githubRepository: typeof d.github_repository?.full_name === 'string' ? d.github_repository.full_name : null,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
    };
  },

  // Delete deployment
  delete: async (id: string): Promise<void> => {
    await api.delete(`/api/deployments/${id}`);
  },

  // Counts for the caller's organization over a window (default 30 days):
  // statuses as recorded, change failure rate, and the last finished deployment.
  getStats: async (filters?: { environment?: string; dateRange?: StatsWindow }): Promise<DeploymentStats> => {
    const params = new URLSearchParams();
    if (filters?.environment && filters.environment !== 'all') params.append('environment', filters.environment);
    if (filters?.dateRange) params.append('date_range', filters.dateRange);
    const query = params.toString() ? `?${params.toString()}` : '';
    const response = await api.get<{ success: boolean; stats: DeploymentStats }>(`/api/deployments/stats${query}`);
    if (!response.data.success) throw new Error('Failed to load deployment stats');
    return response.data.stats;
  },

  // Record a deployment that has already happened (the Deployments page's
  // "Record a deployment" form, the only one). The server sets who recorded
  // it (the signed-in user), when (now) and metadata.source = 'manual'; the
  // service must already be registered in the organization.
  record: async (payload: {
    serviceId: string; environment: string; region: string; status: RecordedResult; version?: string;
  }): Promise<void> => {
    const response = await api.post<ApiResponse<any>>('/api/deployments', {
      service_id:  payload.serviceId,
      environment: payload.environment,
      aws_region:  payload.region,
      status:      payload.status,
      ...(payload.version ? { version: payload.version } : {}),
    });
    handleApiResponse(response);
  },
};