import { Pool } from 'pg';
import {
  DORAMetricsRepository,
  DORAMetricsFilters,
  DoraQueryScope,
  DoraServiceCountRow,
} from '../repositories/dora-metrics.repository';
import { organizationHasEntitlement } from '../middleware/subscription.middleware';
import { DORA_BANDS, DoraBands, gradeAgainstBands } from '../config/dora-bands';
import { isStatsWindow, STATS_WINDOW_DAYS } from './deployment-status';
import { normalizeDoraFilters, NormalizedDoraFilters } from './dora-filters';
import {
  buildDailySeries,
  DoraBusiestDay,
  DoraDailyEntry,
  pickBusiestDay,
  PeriodWindow,
  relativeChangePercent,
  rollingWindows,
  windowDateRange,
} from './dora-periods';

export type BenchmarkLevel = 'elite' | 'high' | 'medium' | 'low';

/** A metric the deployment records can support. */
export interface TrackedDORAMetric {
  tracked: true;
  /**
   * Null when nothing finished in the period (no success and no failed
   * deployment): there is nothing to measure. Never 0 for "unavailable".
   * A real 0 (deployments finished, none succeeded / none failed) stays 0.
   */
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

export interface DoraDeploymentCounts {
  successful: number;
  failed: number;
  /** successful + failed. 'deploying' and unknown statuses are in neither. */
  finished: number;
}

export interface DoraPeriodBounds {
  /** First UTC date the window touches (YYYY-MM-DD). */
  start: string;
  /** Last UTC date the window touches (YYYY-MM-DD). */
  end: string;
  /** N: 7, 30 or 90. */
  days: number;
  /** Inclusive lower bound, ISO 8601 UTC. */
  startAt: string;
  /** Exclusive upper bound, ISO 8601 UTC. For the current period this is the request's one captured `now`. */
  endAt: string;
}

/** The previous period's raw figures, counted exactly like the current period's. */
export interface DoraPreviousPeriod extends DoraPeriodBounds {
  deployments: DoraDeploymentCounts;
  /** successful ÷ days, 2 dp. Null when the previous period has no finished deployment. */
  deploymentsPerDay: number | null;
  /** failed ÷ finished × 100, 2 dp. Null when the previous period has no finished deployment. */
  changeFailureRate: number | null;
}

/**
 * Relative change, current vs previous, in percent (1 dp), computed from the
 * unrounded figures. Each is null unless BOTH periods have finished
 * deployments AND the previous value is above 0. Not percentage points: for
 * a point change of the failure rate use the two raw rates.
 */
export interface DoraPeriodChange {
  finishedPercent: number | null;
  deploymentsPerDayPercent: number | null;
  changeFailureRatePercent: number | null;
}

export interface ComprehensiveDORAMetrics {
  deploymentFrequency: TrackedDORAMetric;
  leadTime: UntrackedDORAMetric;
  changeFailureRate: TrackedDORAMetric;
  mttr: UntrackedDORAMetric;
  /** Finished deployments in the period, as recorded. */
  deployments: DoraDeploymentCounts;
  period: DoraPeriodBounds;
  previousPeriod: DoraPreviousPeriod;
  change: DoraPeriodChange;
  /** Current period, every UTC day it touches, ascending, zero-filled. */
  daily: DoraDailyEntry[];
  /** Null when nothing finished in the current period. */
  busiestDay: DoraBusiestDay | null;
  /** The filters every figure above was computed with. Null = all. */
  filters: NormalizedDoraFilters;
  /** The standard comparison bands the industry grades come from (config/dora-bands.ts). */
  bands: DoraBands;
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
  /**
   * @param now The clock. Read exactly once per getComprehensiveMetrics call;
   *            every bound of that request derives from that one value.
   *            Injected in tests to freeze time.
   */
  constructor(
    private repository: DORAMetricsRepository,
    private pool?: Pool,
    private now: () => Date = () => new Date()
  ) {}

  // ─── Custom benchmark loader ────────────────────────────────────────────────

  /**
   * Load all custom benchmarks for the organization from the database.
   * Returns an empty object if no pool or no organizationId is provided,
   * if the organization's plan does not include custom benchmarks
   * (PLAN_ENTITLEMENTS.doraCustomBenchmarks -- saved rows are kept, only not
   * applied), or if either query fails (graceful fallback to industry
   * standards).
   */
  private async loadCustomBenchmarks(
    organizationId?: string
  ): Promise<CustomBenchmarkMap> {
    if (!this.pool || !organizationId) return {};

    try {
      if (!(await organizationHasEntitlement(organizationId, 'doraCustomBenchmarks', this.pool))) {
        return {};
      }

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
   * and change failure rate -- with benchmarks, the previous period, the
   * daily series and the busiest day. Lead time for changes and time to
   * restore are reported as not tracked, with the reason; they are never
   * estimated from deployment timestamps.
   *
   * One captured `now` per call. Current = [now − N×24h, now), previous =
   * [now − 2N×24h, now − N×24h) (see dora-periods.ts). Current totals,
   * previous totals and the daily series come from ONE grouped query, so they
   * share bounds and filters by construction; the per-service breakdowns use
   * the same bounds and the same filter builder.
   *
   * If filters.organizationId is set and a pool was injected, custom
   * benchmarks from custom_dora_benchmarks take precedence over the standard
   * bands for any metric that has been configured.
   *
   * Throws DoraFilterError for an invalid service / team / environment.
   */
  async getComprehensiveMetrics(
    filters: DORAMetricsFilters
  ): Promise<ComprehensiveDORAMetrics> {
    if (!filters.organizationId) {
      throw new Error('DORAMetricsService: an organization is required');
    }
    const normalized = normalizeDoraFilters(filters);
    const scope: DoraQueryScope = { organizationId: filters.organizationId, ...normalized };
    const days = STATS_WINDOW_DAYS[isStatsWindow(filters.dateRange) ? filters.dateRange : '30d'];

    const now = this.now();
    const { current, previous } = rollingWindows(now, days);

    const [dayRows, serviceRows, custom] = await Promise.all([
      this.repository.countFinishedByUtcDay(scope, {
        previousStartAt: previous.startAt,
        currentStartAt: current.startAt,
        endAt: current.endAt,
      }),
      this.repository.countFinishedByService(scope, { startAt: current.startAt, endAt: current.endAt }),
      this.loadCustomBenchmarks(filters.organizationId),
    ]);

    const daily = buildDailySeries(current, dayRows.filter((row) => row.isCurrent));
    const previousTotals = sumCounts(dayRows.filter((row) => !row.isCurrent));
    const currentTotals = sumCounts(daily);
    const { successful, failed, finished } = currentTotals;
    // With nothing finished in the period there is no measurement to grade.
    const measured = finished > 0;
    const deploymentsPerDay = measured ? round2(successful / days) : null;
    const failureRate = measured ? round2((failed / finished) * 100) : null;

    return {
      deploymentFrequency: {
        tracked: true,
        value: deploymentsPerDay,
        unit: 'per day',
        ...(deploymentsPerDay !== null
          ? this.resolveDeploymentFrequency(deploymentsPerDay, custom.deployment_frequency)
          : { benchmark: null, isCustomBenchmark: false }),
        breakdown: frequencyBreakdown(serviceRows, days),
        description: `${successful} successful deployments in ${days} days`,
      },
      leadTime: { tracked: false, reason: LEAD_TIME_NOT_TRACKED_REASON },
      changeFailureRate: {
        tracked: true,
        value: failureRate,
        unit: 'percentage',
        ...(failureRate !== null
          ? this.resolveChangeFailureRate(failureRate, custom.change_failure_rate)
          : { benchmark: null, isCustomBenchmark: false }),
        breakdown: failureRateBreakdown(serviceRows),
        description: measured
          ? `${failed} failed out of ${finished} finished deployments`
          : 'No finished deployments in this period',
      },
      mttr: { tracked: false, reason: TIME_TO_RESTORE_NOT_TRACKED_REASON },
      deployments: currentTotals,
      period: periodBounds(current),
      previousPeriod: {
        ...periodBounds(previous),
        deployments: previousTotals,
        deploymentsPerDay: previousTotals.finished > 0 ? round2(previousTotals.successful / days) : null,
        changeFailureRate: previousTotals.finished > 0
          ? round2((previousTotals.failed / previousTotals.finished) * 100)
          : null,
      },
      change: periodChange(currentTotals, previousTotals),
      daily,
      busiestDay: pickBusiestDay(daily),
      filters: normalized,
      bands: DORA_BANDS,
    };
  }

  // ─── Benchmark resolvers ────────────────────────────────────────────────────
  //
  // Used by getComprehensiveMetrics only (nothing else imports them; the
  // weekly email grades nothing). Each returns { benchmark, isCustomBenchmark }
  // and grades the value as reported (2 dp), so benchmark always matches
  // `value` read against `bands`.
  //
  // Without a custom target the standard comparison bands of
  // config/dora-bands.ts grade the value (deployment frequency and change
  // failure rate). They are informed by the DORA 2023 performance clusters and
  // are not DORA's own thresholds.
  //
  // With a custom (Enterprise) target t, the multipliers are, per metric:
  //   - deployment frequency (higher = better): elite ≥ t, high ≥ t×0.5, medium ≥ t×0.2
  //     (note: ≥ t for elite, unlike the standard band's > 1)
  //   - change failure rate (lower = better):   elite ≤ t, high ≤ t×2,   medium ≤ t×3
  //   - lead time (lower = better, unused):     elite ≤ t, high ≤ t×2,   medium ≤ t×5
  //   - time to restore (lower = better, unused): elite ≤ t, high ≤ t×3, medium ≤ t×10
  //   - anything worse is low.

  /**
   * Deployment frequency (successful deployments per day) — higher is better.
   * Standard: DORA_BANDS.deploymentFrequency (elite > 1, high ≥ 0.14, medium ≥ 0.03).
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
    return {
      benchmark: gradeAgainstBands(DORA_BANDS.deploymentFrequency, deploymentsPerDay),
      isCustomBenchmark: false,
    };
  }

  /**
   * Lead Time — lower is better (hours). Not called: lead time is not
   * tracked (D6). Its literal bands below are not DevControl's standard
   * comparison bands and must move to config/dora-bands.ts before any use.
   * Custom: elite ≤ t, high ≤ t×2, medium ≤ t×5.
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
   * Change failure rate (percent of finished) — lower is better.
   * Standard: DORA_BANDS.changeFailureRate (elite ≤ 5, high ≤ 10, medium ≤ 15, low > 15).
   * Custom: elite ≤ t, high ≤ t×2, medium ≤ t×3.
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
    return {
      benchmark: gradeAgainstBands(DORA_BANDS.changeFailureRate, failureRate),
      isCustomBenchmark: false,
    };
  }

  /**
   * MTTR — lower is better (minutes). Not called: time to restore is not
   * tracked (D7). Its literal bands below are not DevControl's standard
   * comparison bands and must move to config/dora-bands.ts before any use.
   * Custom: elite ≤ t, high ≤ t×3, medium ≤ t×10.
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function round2(value: number): number {
  return parseFloat(value.toFixed(2));
}

function sumCounts(rows: ReadonlyArray<{ succeeded: number; failed: number }>): DoraDeploymentCounts {
  let successful = 0;
  let failed = 0;
  for (const row of rows) {
    successful += row.succeeded;
    failed += row.failed;
  }
  return { successful, failed, finished: successful + failed };
}

function periodBounds(window: PeriodWindow): DoraPeriodBounds {
  return {
    ...windowDateRange(window),
    days: window.days,
    startAt: window.startAt.toISOString(),
    endAt: window.endAt.toISOString(),
  };
}

/**
 * D4-D8: a relative change only when both periods have finished deployments
 * and the previous value is above 0, from unrounded figures. Each metric's
 * change is computed from its own two values; none is derived from another.
 * Both periods are N days long, so deploys/day changes exactly as the
 * successful count does.
 */
function periodChange(current: DoraDeploymentCounts, previous: DoraDeploymentCounts): DoraPeriodChange {
  if (current.finished === 0 || previous.finished === 0) {
    return { finishedPercent: null, deploymentsPerDayPercent: null, changeFailureRatePercent: null };
  }
  return {
    finishedPercent: relativeChangePercent(current.finished, previous.finished),
    deploymentsPerDayPercent: relativeChangePercent(current.successful, previous.successful),
    changeFailureRatePercent: relativeChangePercent(
      current.failed / current.finished,
      previous.failed / previous.finished
    ),
  };
}

/** Successful deployments per day per service, services with a success only, most first. */
function frequencyBreakdown(rows: readonly DoraServiceCountRow[], days: number): { [key: string]: number } {
  const breakdown: { [key: string]: number } = {};
  [...rows]
    .filter((row) => row.succeeded > 0)
    .sort((a, b) => b.succeeded - a.succeeded || a.serviceName.localeCompare(b.serviceName))
    .forEach((row) => { breakdown[row.serviceName] = round2(row.succeeded / days); });
  return breakdown;
}

/** Change failure rate per service (percent of its finished), highest first. */
function failureRateBreakdown(rows: readonly DoraServiceCountRow[]): { [key: string]: number } {
  const rated = rows
    .filter((row) => row.succeeded + row.failed > 0)
    .map((row) => ({ name: row.serviceName, rate: (row.failed / (row.succeeded + row.failed)) * 100 }))
    .sort((a, b) => b.rate - a.rate || a.name.localeCompare(b.name));
  const breakdown: { [key: string]: number } = {};
  rated.forEach((row) => { breakdown[row.name] = round2(row.rate); });
  return breakdown;
}
