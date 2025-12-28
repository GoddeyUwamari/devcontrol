import { DORAMetricsResponse, DORAMetricsFilters } from '../types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export const doraMetricsService = {
  /**
   * Fetch DORA metrics with optional filters
   */
  async getDORAMetrics(filters?: DORAMetricsFilters): Promise<DORAMetricsResponse> {
    const params = new URLSearchParams();

    if (filters?.dateRange) {
      params.append('date_range', filters.dateRange);
    }
    if (filters?.serviceId) {
      params.append('service_id', filters.serviceId);
    }
    if (filters?.teamId) {
      params.append('team_id', filters.teamId);
    }
    if (filters?.environment) {
      params.append('environment', filters.environment);
    }

    const queryString = params.toString();
    const url = `${API_BASE_URL}/api/metrics/dora${queryString ? `?${queryString}` : ''}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Failed to fetch DORA metrics: ${response.statusText}`);
    }

    return response.json();
  },
};
