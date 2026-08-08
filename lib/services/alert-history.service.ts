import {
  Alert,
  AlertStats,
  AlertFilters,
  AlertHistoryResponse,
  AlertStatsResponse,
  ApiResponse,
} from '../types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

// All /api/alerts routes are behind authenticateToken (Bearer-header only, no
// cookie fallback on the backend) — every call below must carry this or it 401s.
function authHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

class AlertHistoryService {
  /**
   * Get paginated alert history with filters
   */
  async getAlertHistory(
    filters: AlertFilters & { page?: number; limit?: number } = {}
  ): Promise<AlertHistoryResponse> {
    const params = new URLSearchParams();

    if (filters.dateRange) params.append('date_range', filters.dateRange);
    if (filters.serviceId) params.append('service_id', filters.serviceId);
    if (filters.severity) params.append('severity', filters.severity);
    if (filters.status) params.append('status', filters.status);
    if (filters.page) params.append('page', filters.page.toString());
    if (filters.limit) params.append('limit', filters.limit.toString());

    const response = await fetch(`${API_BASE_URL}/api/alerts/history?${params}`, {
      method: 'GET',
      headers: authHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch alert history: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get alert statistics
   */
  async getAlertStats(filters: Omit<AlertFilters, 'status'> = {}): Promise<AlertStatsResponse> {
    const params = new URLSearchParams();

    if (filters.dateRange) params.append('date_range', filters.dateRange);
    if (filters.serviceId) params.append('service_id', filters.serviceId);

    const response = await fetch(`${API_BASE_URL}/api/alerts/stats?${params}`, {
      method: 'GET',
      headers: authHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch alert stats: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get a single alert by ID
   */
  async getAlert(id: string): Promise<ApiResponse<Alert>> {
    const response = await fetch(`${API_BASE_URL}/api/alerts/${id}`, {
      method: 'GET',
      headers: authHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch alert: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Acknowledge an alert
   */
  async acknowledgeAlert(id: string, user: string = 'admin'): Promise<ApiResponse<Alert>> {
    const response = await fetch(`${API_BASE_URL}/api/alerts/${id}/acknowledge`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify({ user }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `Failed to acknowledge alert: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Resolve an alert
   */
  async resolveAlert(id: string): Promise<ApiResponse<Alert>> {
    const response = await fetch(`${API_BASE_URL}/api/alerts/${id}/resolve`, {
      method: 'PATCH',
      headers: authHeaders(),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `Failed to resolve alert: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Delete an alert
   */
  async deleteAlert(id: string): Promise<ApiResponse<null>> {
    const response = await fetch(`${API_BASE_URL}/api/alerts/${id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to delete alert: ${response.statusText}`);
    }

    return response.json();
  }
}

// Export singleton instance
export const alertHistoryService = new AlertHistoryService();
