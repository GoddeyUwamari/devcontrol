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

export class DORAMetricsService {
  constructor(private repository: DORAMetricsRepository) {}

  /**
   * Get all DORA metrics with benchmarks and trends
   */
  async getComprehensiveMetrics(
    filters: DORAMetricsFilters
  ): Promise<ComprehensiveDORAMetrics> {
    // Fetch all metrics in parallel
    const [
      deploymentFrequency,
      leadTime,
      changeFailureRate,
      mttr,
      period,
    ] = await Promise.all([
      this.repository.calculateDeploymentFrequency(filters),
      this.repository.calculateLeadTime(filters),
      this.repository.calculateChangeFailureRate(filters),
      this.repository.calculateMTTR(filters),
      this.repository.getDateRangePeriod(filters.dateRange || '30d'),
    ]);

    return {
      deploymentFrequency: {
        value: deploymentFrequency.deploymentsPerDay,
        unit: 'per day',
        benchmark: this.getDeploymentFrequencyBenchmark(
          deploymentFrequency.deploymentsPerDay
        ),
        trend: 'stable', // TODO: Calculate from historical data
        breakdown: deploymentFrequency.breakdown,
        description: `${deploymentFrequency.totalDeployments} deployments in ${period.days} days`,
      },
      leadTime: {
        value: leadTime.averageLeadTimeHours,
        unit: 'hours',
        benchmark: this.getLeadTimeBenchmark(leadTime.averageLeadTimeHours),
        trend: 'stable', // TODO: Calculate from historical data
        breakdown: leadTime.breakdown,
        description: 'Average time between consecutive deployments',
      },
      changeFailureRate: {
        value: changeFailureRate.failureRate,
        unit: 'percentage',
        benchmark: this.getChangeFailureRateBenchmark(
          changeFailureRate.failureRate
        ),
        trend: 'stable', // TODO: Calculate from historical data
        breakdown: changeFailureRate.breakdown,
        description: `${changeFailureRate.failedDeployments} failed out of ${changeFailureRate.totalDeployments} deployments`,
      },
      mttr: {
        value: mttr.averageMTTRMinutes,
        unit: 'minutes',
        benchmark: this.getMTTRBenchmark(mttr.averageMTTRMinutes),
        trend: 'stable', // TODO: Calculate from historical data
        breakdown: mttr.breakdown,
        description: `${mttr.incidents} incidents recovered`,
      },
      period,
    };
  }

  /**
   * Determine benchmark level for Deployment Frequency
   * Elite: Multiple deploys per day (>1)
   * High: 1 deploy per day to 1 per week (0.14 - 1)
   * Medium: 1 per week to 1 per month (0.03 - 0.14)
   * Low: Less than 1 per month (<0.03)
   */
  private getDeploymentFrequencyBenchmark(
    deploymentsPerDay: number
  ): BenchmarkLevel {
    if (deploymentsPerDay > 1) return 'elite';
    if (deploymentsPerDay >= 0.14) return 'high'; // ~1 per week
    if (deploymentsPerDay >= 0.03) return 'medium'; // ~1 per month
    return 'low';
  }

  /**
   * Determine benchmark level for Lead Time
   * Elite: Less than 1 hour
   * High: 1 day to 1 week (24 - 168 hours)
   * Medium: 1 week to 1 month (168 - 720 hours)
   * Low: More than 1 month (>720 hours)
   */
  private getLeadTimeBenchmark(leadTimeHours: number): BenchmarkLevel {
    if (leadTimeHours < 1) return 'elite';
    if (leadTimeHours < 24) return 'elite'; // Still elite if under 1 day
    if (leadTimeHours <= 168) return 'high'; // Up to 1 week
    if (leadTimeHours <= 720) return 'medium'; // Up to 1 month
    return 'low';
  }

  /**
   * Determine benchmark level for Change Failure Rate
   * Elite: 0-15%
   * High: 16-30%
   * Medium: 31-45%
   * Low: 46-100%
   */
  private getChangeFailureRateBenchmark(
    failureRate: number
  ): BenchmarkLevel {
    if (failureRate <= 15) return 'elite';
    if (failureRate <= 30) return 'high';
    if (failureRate <= 45) return 'medium';
    return 'low';
  }

  /**
   * Determine benchmark level for MTTR
   * Elite: Less than 1 hour (60 minutes)
   * High: Less than 1 day (1440 minutes)
   * Medium: 1 day to 1 week (1440 - 10080 minutes)
   * Low: More than 1 week (>10080 minutes)
   */
  private getMTTRBenchmark(mttrMinutes: number): BenchmarkLevel {
    if (mttrMinutes < 60) return 'elite';
    if (mttrMinutes < 1440) return 'high'; // Less than 1 day
    if (mttrMinutes <= 10080) return 'medium'; // Up to 1 week
    return 'low';
  }

  /**
   * Calculate trend by comparing current period to previous period
   * TODO: Implement historical comparison
   */
  private async calculateTrend(
    currentValue: number,
    previousValue: number,
    lowerIsBetter: boolean = false
  ): Promise<TrendDirection> {
    const changePercent = ((currentValue - previousValue) / previousValue) * 100;

    // Significant change threshold: 5%
    if (Math.abs(changePercent) < 5) {
      return 'stable';
    }

    if (lowerIsBetter) {
      return changePercent < 0 ? 'improving' : 'declining';
    } else {
      return changePercent > 0 ? 'improving' : 'declining';
    }
  }
}
