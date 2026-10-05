import { isAxiosError } from 'axios';
import api from '../api';
import { DORAMetricsResponse, DORAMetricsFilters } from '../types';

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
    const url = `/api/metrics/dora${queryString ? `?${queryString}` : ''}`;

    try {
      const response = await api.get<DORAMetricsResponse>(url);
      return response.data;
    } catch (error) {
      if (isAxiosError<{ error?: string }>(error) && error.response) {
        throw new Error(
          error.response.data?.error || `Failed to fetch DORA metrics: ${error.response.statusText}`
        );
      }
      throw error;
    }
  },
};
