import api, { handleApiResponse } from '../api';
import type {
  ServiceDependency,
  CreateDependencyPayload,
  UpdateDependencyPayload,
  DependencyFilters,
  DependencyGraph,
  ImpactAnalysis,
  CircularDependency,
  ApiResponse,
} from '../types';

export const dependenciesService = {
  /**
   * Get all dependencies with optional filters
   */
  getAll: async (filters?: DependencyFilters): Promise<ServiceDependency[]> => {
    const params = new URLSearchParams();
    if (filters?.sourceServiceId) params.append('source_service_id', filters.sourceServiceId);
    if (filters?.targetServiceId) params.append('target_service_id', filters.targetServiceId);
    if (filters?.dependencyType) params.append('dependency_type', filters.dependencyType);
    if (filters?.isCritical !== undefined) params.append('is_critical', String(filters.isCritical));

    const queryString = params.toString() ? `?${params.toString()}` : '';
    const response = await api.get<ApiResponse<any>>(`/api/dependencies${queryString}`);
    const result = handleApiResponse(response);

    // Transform snake_case to camelCase
    return (result || []).map((d: any) => ({
      id: d.id,
      organizationId: d.organization_id,
      sourceServiceId: d.source_service_id,
      targetServiceId: d.target_service_id,
      dependencyType: d.dependency_type,
      description: d.description,
      isCritical: d.is_critical,
      metadata: d.metadata,
      createdBy: d.created_by,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
      sourceServiceName: d.source_service_name,
      targetServiceName: d.target_service_name,
      sourceServiceStatus: d.source_service_status,
      targetServiceStatus: d.target_service_status,
    }));
  },

  /**
   * Get dependency by ID
   */
  getById: async (id: string): Promise<ServiceDependency> => {
    const response = await api.get<ApiResponse<any>>(`/api/dependencies/${id}`);
    const d = handleApiResponse(response);

    return {
      id: d.id,
      organizationId: d.organization_id,
      sourceServiceId: d.source_service_id,
      targetServiceId: d.target_service_id,
      dependencyType: d.dependency_type,
      description: d.description,
      isCritical: d.is_critical,
      metadata: d.metadata,
      createdBy: d.created_by,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
      sourceServiceName: d.source_service_name,
      targetServiceName: d.target_service_name,
    };
  },

  /**
   * Create new dependency (Admin+ only)
   */
  create: async (payload: CreateDependencyPayload): Promise<ServiceDependency> => {
    // Transform camelCase to snake_case for backend
    const backendPayload = {
      source_service_id: payload.sourceServiceId,
      target_service_id: payload.targetServiceId,
      dependency_type: payload.dependencyType,
      description: payload.description,
      is_critical: payload.isCritical,
      metadata: payload.metadata,
    };

    const response = await api.post<ApiResponse<any>>('/api/dependencies', backendPayload);
    const d = handleApiResponse(response);

    return {
      id: d.id,
      organizationId: d.organization_id,
      sourceServiceId: d.source_service_id,
      targetServiceId: d.target_service_id,
      dependencyType: d.dependency_type,
      description: d.description,
      isCritical: d.is_critical,
      metadata: d.metadata,
      createdBy: d.created_by,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
    };
  },

  /**
   * Update dependency (Admin+ only)
   */
  update: async (id: string, payload: UpdateDependencyPayload): Promise<ServiceDependency> => {
    const backendPayload = {
      dependency_type: payload.dependencyType,
      description: payload.description,
      is_critical: payload.isCritical,
      metadata: payload.metadata,
    };

    const response = await api.put<ApiResponse<any>>(`/api/dependencies/${id}`, backendPayload);
    const d = handleApiResponse(response);

    return {
      id: d.id,
      organizationId: d.organization_id,
      sourceServiceId: d.source_service_id,
      targetServiceId: d.target_service_id,
      dependencyType: d.dependency_type,
      description: d.description,
      isCritical: d.is_critical,
      metadata: d.metadata,
      createdBy: d.created_by,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
    };
  },

  /**
   * Delete dependency (Admin+ only)
   */
  delete: async (id: string): Promise<void> => {
    await api.delete(`/api/dependencies/${id}`);
  },

  /**
   * Get dependency graph (React Flow format)
   */
  getGraph: async (): Promise<DependencyGraph> => {
    const response = await api.get<ApiResponse<any>>('/api/dependencies/graph');
    const result = handleApiResponse(response);

    // Backend already returns in correct format, but ensure camelCase
    return {
      nodes: (result.nodes || []).map((n: any) => ({
        id: n.id,
        type: n.type,
        position: n.position,
        data: {
          label: n.data.label,
          status: n.data.status,
          owner: n.data.owner,
          template: n.data.template,
        },
      })),
      edges: (result.edges || []).map((e: any) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: e.type,
        label: e.label,
        animated: e.animated,
        data: e.data ? {
          dependencyType: e.data.dependency_type,
          isCritical: e.data.is_critical,
          description: e.data.description,
        } : undefined,
      })),
    };
  },

  /**
   * Get impact analysis for a service
   */
  getImpactAnalysis: async (serviceId: string): Promise<ImpactAnalysis> => {
    const response = await api.get<ApiResponse<any>>(`/api/dependencies/impact/${serviceId}`);
    const a = handleApiResponse(response);

    return {
      serviceId: a.service_id,
      serviceName: a.service_name,
      upstreamDependencies: (a.upstream_dependencies || []).map((d: any) => ({
        id: d.id,
        name: d.name,
        dependencyType: d.dependency_type,
        isCritical: d.is_critical,
      })),
      downstreamDependencies: (a.downstream_dependencies || []).map((d: any) => ({
        id: d.id,
        name: d.name,
        dependencyType: d.dependency_type,
        isCritical: d.is_critical,
      })),
      totalUpstream: a.total_upstream,
      totalDownstream: a.total_downstream,
      totalAffectedIfFails: a.total_affected_if_fails,
      criticalPath: a.critical_path,
    };
  },

  /**
   * Detect circular dependencies
   */
  detectCircularDependencies: async (): Promise<CircularDependency[]> => {
    const response = await api.get<ApiResponse<any>>('/api/dependencies/cycles');
    const result = handleApiResponse(response);

    return (result || []).map((c: any) => ({
      cycle: (c.cycle || []).map((s: any) => ({
        serviceId: s.service_id,
        serviceName: s.service_name,
      })),
      path: c.path,
      dependencyIds: c.dependency_ids || [],
      severity: c.severity,
    }));
  },

  /**
   * Get dependencies for a specific service
   */
  getServiceDependencies: async (serviceId: string): Promise<{
    upstream: ServiceDependency[];
    downstream: ServiceDependency[];
  }> => {
    const response = await api.get<ApiResponse<any>>(`/api/services/${serviceId}/dependencies`);
    const result = handleApiResponse(response);

    const transform = (deps: any[]) => (deps || []).map((d: any) => ({
      id: d.id,
      organizationId: d.organization_id,
      sourceServiceId: d.source_service_id,
      targetServiceId: d.target_service_id,
      dependencyType: d.dependency_type,
      description: d.description,
      isCritical: d.is_critical,
      metadata: d.metadata,
      createdBy: d.created_by,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
      sourceServiceName: d.source_service_name,
      targetServiceName: d.target_service_name,
    }));

    return {
      upstream: transform(result.upstream),
      downstream: transform(result.downstream),
    };
  },
};
