import { Pool } from 'pg';
import {
  DORAMetricsRepository,
  DORAMetricsFilters,
} from '../repositories/dora-metrics.repository';

export type BenchmarkLevel = 'elite' | 'high' | 'medium' | 'low';
export type TrendDirection = 'improving' | 'stable' | 'declining';

export interface DORAMetric {
  value: number;
  unit: string;
  benchmark: BenchmarkLevel;
  isCustomBenchmark: boolean;
  trend: TrendDirection;
  breakdown?: { [key: string]: number };
  description?: string;
}

export interface ComprehensiveDORAMetrics {
  deploymentFrequency: DORAMetric;
  leadTime: DORAMetric;
  changeFailureRate: DORAMetric;
  mttr: DORAMetric;
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
   * Get all four DORA metrics with benchmarks and trends.
   * If filters.organizationId is set and a pool was injected, custom
   * benchmarks from custom_dora_benchmarks take precedence over industry
   * standards for any metric that has been configured.
   */
  async getComprehensiveMetrics(
    filters: DORAMetricsFilters
  ): Promise<ComprehensiveDORAMetrics> {
    const [
      deploymentFrequency,
      leadTime,
      changeFailureRate,
      mttr,
      period,
      custom,
    ] = await Promise.all([
      this.repository.calculateDeploymentFrequency(filters),
      this.repository.calculateLeadTime(filters),
      this.repository.calculateChangeFailureRate(filters),
      this.repository.calculateMTTR(filters),
      this.repository.getDateRangePeriod(filters.dateRange || '30d'),
      this.loadCustomBenchmarks(filters.organizationId),
    ]);

    return {
      deploymentFrequency: {
        value: deploymentFrequency.deploymentsPerDay,
        unit: 'per day',
        ...this.resolveDeploymentFrequency(
          deploymentFrequency.deploymentsPerDay,
          custom.deployment_frequency
        ),
        trend: 'stable', // TODO: Calculate from historical data
        breakdown: deploymentFrequency.breakdown,
        description: `${deploymentFrequency.totalDeployments} deployments in ${period.days} days`,
      },
      leadTime: {
        value: leadTime.averageLeadTimeHours,
        unit: 'hours',
        ...this.resolveLeadTime(
          leadTime.averageLeadTimeHours,
          custom.lead_time
        ),
        trend: 'stable',
        breakdown: leadTime.breakdown,
        description: 'Average time between consecutive deployments',
      },
      changeFailureRate: {
        value: changeFailureRate.failureRate,
        unit: 'percentage',
        ...this.resolveChangeFailureRate(
          changeFailureRate.failureRate,
          custom.change_failure_rate
        ),
        trend: 'stable',
        breakdown: changeFailureRate.breakdown,
        description: `${changeFailureRate.failedDeployments} failed out of ${changeFailureRate.totalDeployments} deployments`,
      },
      mttr: {
        value: mttr.averageMTTRMinutes,
        unit: 'minutes',
        ...this.resolveMTTR(
          mttr.averageMTTRMinutes,
          custom.recovery_time
        ),
        trend: 'stable',
        breakdown: mttr.breakdown,
        description: `${mttr.incidents} incidents recovered`,
      },
      period,
    };
  }

  // ─── Benchmark resolvers ────────────────────────────────────────────────────
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
  private resolveDeploymentFrequency(
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
  private resolveLeadTime(
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
  private resolveChangeFailureRate(
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
  private resolveMTTR(
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

  // ─── Trend helper ────────────────────────────────────────────────────────────

  /**
   * Calculate trend by comparing current period to previous period.
   * TODO: Wire up to historical data from repository.
   */
  private calculateTrend(
    currentValue: number,
    previousValue: number,
    lowerIsBetter: boolean = false
  ): TrendDirection {
    const changePercent = ((currentValue - previousValue) / previousValue) * 100;

    if (Math.abs(changePercent) < 5) return 'stable';

    if (lowerIsBetter) {
      return changePercent < 0 ? 'improving' : 'declining';
    } else {
      return changePercent > 0 ? 'improving' : 'declining';
    }
  }
}
