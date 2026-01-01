/**
 * Audit Logs Service
 * Frontend service for querying audit logs
 */

import api from '../api';

export interface AuditLog {
  id: string;
  organization_id: string;
  user_id: string | null;
  user_email: string | null;
  action: string;
  resource_type?: string | null;
  resource_id?: string | null;
  ip_address: string;
  user_agent: string;
  metadata: any;
  method?: string;
  path?: string;
  status_code?: number;
  duration_ms?: number;
  error_message?: string;
  created_at: string;
}

export interface AuditLogFilters {
  user_id?: string;
  action?: string;
  resource_type?: string;
  start_date?: string;
  end_date?: string;
  page?: number;
  limit?: number;
}

export interface AuditLogResponse {
  success: boolean;
  data: AuditLog[];
  total: number;
  page: number;
  limit: number;
}

export const auditLogsService = {
  /**
   * Get all audit logs with optional filters
   */
  async getAll(filters?: AuditLogFilters): Promise<AuditLogResponse> {
    const params: any = {
      ...filters,
      offset: filters?.page ? ((filters.page - 1) * (filters.limit || 50)) : 0,
    };

    const response = await api.get('/api/audit-logs', { params });
    return response.data;
  },

  /**
   * Get unique actions for filter dropdown
   */
  async getActions(): Promise<string[]> {
    const response = await api.get('/api/audit-logs/actions');
    return response.data.data;
  },

  /**
   * Get unique resource types for filter dropdown
   */
  async getResourceTypes(): Promise<string[]> {
    const response = await api.get('/api/audit-logs/resource-types');
    return response.data.data;
  },
};
