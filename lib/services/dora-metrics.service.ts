import { isAxiosError } from 'axios';
import api from '../api';
import type { BenchmarkLevel, DORAMetricsFilters } from '../types';

/** A metric the deployment records can support. */
export interface TrackedDORAMetric {
  tracked: true;
  /** Null when nothing finished in the period (never 0 for "unavailable"). */
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

export interface DORADeploymentCounts { successful: number; failed: number; finished: number }

/** A level boundary; null on a level means "open". */
export interface DORABandBound { value: number; inclusive: boolean }
export interface DORABand {
  level: BenchmarkLevel;
  lower: DORABandBound | null;
  upper: DORABandBound | null;
  label: string;
}
export interface DORAMetricBands {
  unit: 'per_day' | 'percentage';
  direction: 'higher_is_better' | 'lower_is_better';
  levels: DORABand[];
}
/** The standard comparison bands, as served by the API (never imported from the backend). */
export interface DORABands {
  version: number;
  description: string;
  deploymentFrequency: DORAMetricBands;
  changeFailureRate: DORAMetricBands;
}

export interface DORADailyEntry {
  /** UTC date, YYYY-MM-DD. */
  date: string;
  succeeded: number;
  failed: number;
  total: number;
  /** Only part of this UTC day is inside the period (the first and last day). */
  partial: boolean;
}

/**
 * GET /api/metrics/dora. The fields marked optional were added by D4 (backend
 * API docs: docs/API.md, "DORA Metrics API"); they are optional here only so
 * a frontend deployed before the backend still type-checks what it receives.
 */
export interface DORAMetricsData {
  deploymentFrequency: TrackedDORAMetric;
  leadTime: UntrackedDORAMetric;
  changeFailureRate: TrackedDORAMetric;
  mttr: UntrackedDORAMetric;
  /** Finished deployments in the period, as recorded. */
  deployments: DORADeploymentCounts;
  /** start/end: first and last UTC date; startAt inclusive, endAt exclusive (ISO). */
  period: { start: string; end: string; days: number; startAt?: string; endAt?: string };
  previousPeriod?: {
    start: string; end: string; days: number; startAt: string; endAt: string;
    deployments: DORADeploymentCounts;
    /** Null when the previous period has no finished deployment. */
    deploymentsPerDay: number | null;
    /** Null when the previous period has no finished deployment. */
    changeFailureRate: number | null;
  };
  /** Relative % change; each null unless both periods have finished deployments and the previous value is > 0. */
  change?: {
    finishedPercent: number | null;
    deploymentsPerDayPercent: number | null;
    changeFailureRatePercent: number | null;
  };
  /** Every UTC day the current period touches, ascending, zero-filled. */
  daily?: DORADailyEntry[];
  /** Null when nothing finished in the period. Ties: the most recent tied day. */
  busiestDay?: (Omit<DORADailyEntry, 'total'> & { total: number; tiedDays: number }) | null;
  /** The filters applied; null = all. */
  filters?: { environment: string | null; serviceId: string | null; teamId: string | null };
  bands?: DORABands;
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
