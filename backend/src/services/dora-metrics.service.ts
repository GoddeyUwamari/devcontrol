import { Pool } from 'pg';
import {
  DORAMetricsRepository,
  DORAMetricsFilters,
} from '../repositories/dora-metrics.repository';

export type BenchmarkLevel = 'elite' | 'high' | 'medium' | 'low';

/** A metric the deployment records can support. */
export interface TrackedDORAMetric {
  tracked: true;
  /** Null when there is nothing in the window to measure it from. */
  value: number | null;
  unit: string;
  /** Null whenever value is null: no tier without a measurement. */
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

export type DORAMetric = TrackedDORAMetric | UntrackedDORAMetric;

export const LEAD_TIME_NOT_TRACKED_REASON =
  'Deployment records hold no commit or change timestamp, so the time from change to deployment cannot be measured.';
export const TIME_TO_RESTORE_NOT_TRACKED_REASON =
  'No incident or service-restoration records are collected; a failed deployment is not evidence of an outage.';

export interface ComprehensiveDORAMetrics {
  deploymentFrequency: TrackedDORAMetric;
  leadTime: UntrackedDORAMetric;
  changeFailureRate: TrackedDORAMetric;
  mttr: UntrackedDORAMetric;
  /** Finished deployments in the period, as recorded. */
  deployments: {
    successful: number;
    failed: number;
    finished: number;
  };
  period: {
    start: string;
    end: string;
    days: number;
  };
}

// Shape of a single row from custom_dora_benchmarks
interface CustomBenchmarkRow {
  target_value: number;
  performance_label: string;
}

// Keyed map loaded per request
interface CustomBenchmarkMap {
  deployment_frequency?: CustomBenchmarkRow;
  lead_time?: CustomBenchmarkRow;
  change_failure_rate?: CustomBenchmarkRow;
  recovery_time?: CustomBenchmarkRow;
}

export class DORAMetricsService {
  constructor(
    private repository: DORAMetricsRepository,
    private pool?: Pool
  ) {}

  // ─── Custom benchmark loader ────────────────────────────────────────────────

  /**
   * Load all custom benchmarks for the organization from the database.
   * Returns an empty object if no pool or no organizationId is provided,
   * or if the table query fails (graceful fallback to industry standards).
   */
  private async loadCustomBenchmarks(
    organizationId?: string
  ): Promise<CustomBenchmarkMap> {
    if (!this.pool || !organizationId) return {};

    try {
      const result = await this.pool.query<{
        metric_name: string;
        target_value: string;
        performance_label: string;
      }>(
        `SELECT metric_name, target_value, performance_label
         FROM custom_dora_benchmarks
         WHERE organization_id = $1`,
        [organizationId]
      );

      return result.rows.reduce<CustomBenchmarkMap>((acc, row) => {
        const key = row.metric_name as keyof CustomBenchmarkMap;
        acc[key] = {
          target_value:      parseFloat(row.target_value),
          performance_label: row.performance_label,
        };
        return acc;
      }, {});
    } catch (err) {
      // Non-fatal: fall back to industry standards silently
      console.warn('[DORAMetricsService] Could not load custom benchmarks:', err);
      return {};
    }
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * The DORA metrics the deployment records support -- deployment frequency
   * and change failure rate -- with benchmarks. Lead time for changes and
   * time to restore are reported as not tracked, with the reason; they are
   * never estimated from deployment timestamps.
   *
   * If filters.organizationId is set and a pool was injected, custom
   * benchmarks from custom_dora_benchmarks take precedence over industry
   * standards for any metric that has been configured.
   */
  async getComprehensiveMetrics(
    filters: DORAMetricsFilters
  ): Promise<ComprehensiveDORAMetrics> {
    const [
      deploymentFrequency,
      changeFailureRate,
      period,
      custom,
    ] = await Promise.all([
      this.repository.calculateDeploymentFrequency(filters),
      this.repository.calculateChangeFailureRate(filters),
      this.repository.getDateRangePeriod(filters.dateRange || '30d'),
      this.loadCustomBenchmarks(filters.organizationId),
    ]);

    const successful = deploymentFrequency.totalDeployments;
    const finished = changeFailureRate.totalDeployments;
    const failed = changeFailureRate.failedDeployments;
    // With nothing finished in the period there is no measurement to grade.
    const measured = finished > 0;

    return {
      deploymentFrequency: {
        tracked: true,
        value: deploymentFrequency.deploymentsPerDay,
        unit: 'per day',
        ...(measured
          ? this.resolveDeploymentFrequency(
              deploymentFrequency.deploymentsPerDay,
              custom.deployment_frequency
            )
          : { benchmark: null, isCustomBenchmark: false }),
        breakdown: deploymentFrequency.breakdown,
        description: `${successful} successful deployments in ${period.days} days`,
      },
      leadTime: { tracked: false, reason: LEAD_TIME_NOT_TRACKED_REASON },
      changeFailureRate: {
        tracked: true,
        value: measured ? changeFailureRate.failureRate : null,
        unit: 'percentage',
        ...(measured
          ? this.resolveChangeFailureRate(
              changeFailureRate.failureRate,
              custom.change_failure_rate
            )
          : { benchmark: null, isCustomBenchmark: false }),
        breakdown: changeFailureRate.breakdown,
        description: measured
          ? `${failed} failed out of ${finished} finished deployments`
          : 'No finished deployments in this period',
      },
      mttr: { tracked: false, reason: TIME_TO_RESTORE_NOT_TRACKED_REASON },
      deployments: { successful, failed, finished },
      period,
    };
  }

  // ─── Benchmark resolvers ────────────────────────────────────────────────────
  //
  // Public so other consumers (e.g. the weekly summary email) can label a raw
  // measured value with the same industry-standard tier the dashboard shows,
  // instead of re-deriving their own thresholds or leaving an LLM to invent a
  // qualitative judgment ("healthy", "low") with no defensible basis.
  //
  // Each resolver returns { benchmark, isCustomBenchmark }.
  // When a custom threshold is provided:
  //   - For frequency metrics (higher = better):  elite ≥ t, high ≥ t×0.5, medium ≥ t×0.2
  //   - For time/rate metrics (lower = better):   elite ≤ t, high ≤ t×2,   medium ≤ t×5
  // When no custom threshold: industry-standard DORA 2024 thresholds are used.

  /**
   * Deployment Frequency — higher is better
   * Industry: Elite >1/day, High ≥0.14/day (~1/week), Medium ≥0.03/day (~1/month)
   */
  resolveDeploymentFrequency(
    deploymentsPerDay: number,
    custom?: CustomBenchmarkRow
  ): { benchmark: BenchmarkLevel; isCustomBenchmark: boolean } {
    if (custom) {
      const t = custom.target_value;
      const benchmark: BenchmarkLevel =
        deploymentsPerDay >= t        ? 'elite'  :
        deploymentsPerDay >= t * 0.5  ? 'high'   :
        deploymentsPerDay >= t * 0.2  ? 'medium' :
                                        'low';
      return { benchmark, isCustomBenchmark: true };
    }
    const benchmark: BenchmarkLevel =
      deploymentsPerDay > 1    ? 'elite'  :
      deploymentsPerDay >= 0.14 ? 'high'   :
      deploymentsPerDay >= 0.03 ? 'medium' :
                                  'low';
    return { benchmark, isCustomBenchmark: false };
  }

  /**
   * Lead Time — lower is better (hours)
   * Industry: Elite <24h, High ≤168h (1 week), Medium ≤720h (1 month)
   */
  resolveLeadTime(
    leadTimeHours: number,
    custom?: CustomBenchmarkRow
  ): { benchmark: BenchmarkLevel; isCustomBenchmark: boolean } {
    if (custom) {
      const t = custom.target_value;
      const benchmark: BenchmarkLevel =
        leadTimeHours <= t      ? 'elite'  :
        leadTimeHours <= t * 2  ? 'high'   :
        leadTimeHours <= t * 5  ? 'medium' :
                                  'low';
      return { benchmark, isCustomBenchmark: true };
    }
    const benchmark: BenchmarkLevel =
      leadTimeHours < 24   ? 'elite'  :
      leadTimeHours <= 168  ? 'high'   :
      leadTimeHours <= 720  ? 'medium' :
                              'low';
    return { benchmark, isCustomBenchmark: false };
  }

  /**
   * Change Failure Rate — lower is better (percentage)
   * Industry: Elite ≤15%, High ≤30%, Medium ≤45%
   */
  resolveChangeFailureRate(
    failureRate: number,
    custom?: CustomBenchmarkRow
  ): { benchmark: BenchmarkLevel; isCustomBenchmark: boolean } {
    if (custom) {
      const t = custom.target_value;
      const benchmark: BenchmarkLevel =
        failureRate <= t     ? 'elite'  :
        failureRate <= t * 2 ? 'high'   :
        failureRate <= t * 3 ? 'medium' :
                               'low';
      return { benchmark, isCustomBenchmark: true };
    }
    const benchmark: BenchmarkLevel =
      failureRate <= 15 ? 'elite'  :
      failureRate <= 30 ? 'high'   :
      failureRate <= 45 ? 'medium' :
                          'low';
    return { benchmark, isCustomBenchmark: false };
  }

  /**
   * MTTR — lower is better (minutes)
   * Industry: Elite <60min, High <1440min (1 day), Medium ≤10080min (1 week)
   */
  resolveMTTR(
    mttrMinutes: number,
    custom?: CustomBenchmarkRow
  ): { benchmark: BenchmarkLevel; isCustomBenchmark: boolean } {
    if (custom) {
      const t = custom.target_value;
      const benchmark: BenchmarkLevel =
        mttrMinutes <= t       ? 'elite'  :
        mttrMinutes <= t * 3   ? 'high'   :
        mttrMinutes <= t * 10  ? 'medium' :
                                 'low';
      return { benchmark, isCustomBenchmark: true };
    }
    const benchmark: BenchmarkLevel =
      mttrMinutes < 60    ? 'elite'  :
      mttrMinutes < 1440  ? 'high'   :
      mttrMinutes <= 10080 ? 'medium' :
                             'low';
    return { benchmark, isCustomBenchmark: false };
  }
}
