import api, { handleApiResponse } from '../api';
import type {
  Service,
  RegisteredService,
  CreateServicePayload,
  UpdateServicePayload,
  ServiceFilters,
  ApiResponse,
} from '../types';

export const servicesService = {
  /**
   * The organization's registered services (the services table), newest
   * first: GET /api/services/registered, which answers
   * { success, services: [...], total }.
   */
  getRegistered: async (): Promise<RegisteredService[]> => {
    const response = await api.get<{ success: boolean; services?: any[]; error?: string }>('/api/services/registered');
    if (!response.data.success || !Array.isArray(response.data.services)) {
      throw new Error(response.data.error || 'Failed to load registered services');
    }
    return response.data.services.map((s: any) => ({
      id: s.id,
      name: s.name,
      owner: s.owner,
      teamId: s.team_id ?? null,
      teamName: s.team_name ?? null,
      githubUrl: s.github_url ?? null,
      createdAt: s.created_at,
    }));
  },

  // Get all services with optional filters
  getAll: async (filters?: ServiceFilters): Promise<Service[]> => {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.teamId) params.append('team_id', filters.teamId);
    if (filters?.template) params.append('template', filters.template);
    
    const queryString = params.toString() ? `?${params.toString()}` : '';
    const response = await api.get<ApiResponse<any>>(`/api/services${queryString}`);
    const result = handleApiResponse(response);
    
    // Transform backend snake_case to frontend camelCase
    return (result || []).map((s: any) => ({
      id: s.id,
      name: s.name,
      template: s.template,
      owner: s.owner,
      teamId: s.team_id,
      githubUrl: s.github_url,
      status: s.status,
      description: s.description,
      metadata: s.metadata,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
    }));
  },

  // Get service by ID
  getById: async (id: string): Promise<Service> => {
    const response = await api.get<ApiResponse<any>>(`/api/services/${id}`);
    const s = handleApiResponse(response);
    
    return {
      id: s.id,
      name: s.name,
      template: s.template,
      owner: s.owner,
      teamId: s.team_id,
      githubUrl: s.github_url,
      status: s.status,
      description: s.description,
      metadata: s.metadata,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
    };
  },

  // Create new service
  create: async (payload: CreateServicePayload): Promise<Service> => {
    // POST /api/services validates snake_case (backend createServiceSchema);
    // unknown keys are stripped, so camelCase teamId/githubUrl would be lost.
    const response = await api.post<ApiResponse<any>>('/api/services', {
      name: payload.name,
      template: payload.template,
      owner: payload.owner,
      team_id: payload.teamId,
      github_url: payload.githubUrl,
      description: payload.description,
    });
    const s = handleApiResponse(response);
    
    return {
      id: s.id,
      name: s.name,
      template: s.template,
      owner: s.owner,
      teamId: s.team_id,
      githubUrl: s.github_url,
      status: s.status,
      description: s.description,
      metadata: s.metadata,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
    };
  },

  // Update service
  update: async (id: string, payload: UpdateServicePayload): Promise<Service> => {
    const response = await api.put<ApiResponse<any>>(`/api/services/${id}`, payload);
    const s = handleApiResponse(response);
    
    return {
      id: s.id,
      name: s.name,
      template: s.template,
      owner: s.owner,
      teamId: s.team_id,
      githubUrl: s.github_url,
      status: s.status,
      description: s.description,
      metadata: s.metadata,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
    };
  },

  // Delete service
  delete: async (id: string): Promise<void> => {
    await api.delete(`/api/services/${id}`);
  },
};