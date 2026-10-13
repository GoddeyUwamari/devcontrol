import { isAxiosError } from 'axios';
import api from '../api';
import type { BenchmarkLevel, DORAMetricsFilters } from '../types';

/** A metric the deployment records can support. */
export interface TrackedDORAMetric {
  tracked: true;
  /** Null when there is nothing in the period to measure it from. */
  value: number | null;
  unit: string;
  /** Null whenever there is no measurement to grade. */
  benchmark: BenchmarkLevel | null;
  isCustomBenchmark: boolean;
  breakdown?: { [key: string]: number };
  description?: string;
}

/** A metric the deployment records cannot support. Never estimated. */
export interface UntrackedDORAMetric {
  tracked: false;
  reason: string;
}

export interface DORAMetricsData {
  deploymentFrequency: TrackedDORAMetric;
  leadTime: UntrackedDORAMetric;
  changeFailureRate: TrackedDORAMetric;
  mttr: UntrackedDORAMetric;
  /** Finished deployments in the period, as recorded. */
  deployments: { successful: number; failed: number; finished: number };
  period: { start: string; end: string; days: number };
}

export interface DORAMetricsResponse {
  success: boolean;
  data: DORAMetricsData;
}

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
