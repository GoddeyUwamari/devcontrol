/**
 * Weekly Summary Repository
 * Fetches aggregated data for weekly AI-powered email summaries
 */

import { Pool, PoolClient } from 'pg';
import awsCostService from '../services/aws-cost.service';
import { requestContext } from '../config/database';
import { DORAMetricsRepository, DORAMetricsFilters } from './dora-metrics.repository';
import { DORAMetricsService, BenchmarkLevel } from '../services/dora-metrics.service';

export interface WeeklyDataQuery {
  organizationId: string;
  startDate: Date;
  endDate: Date;
}

export interface UserInfo {
  email: string;
  fullName: string | null;
}

export interface WeeklyCostComparison {
  currentCost: number;
  previousCost: number | null;
  hasComparableCosts: boolean;
  costSource: 'actual' | 'estimated';
}

export interface DORABenchmarkResult {
  level: BenchmarkLevel;
  isCustom: boolean;
}

export interface WeeklyDORAMetrics {
  deploymentFrequency: string;
  leadTime: string;
  mttr: string;
  changeFailureRate: number;
  benchmarks: {
    deploymentFrequency: DORABenchmarkResult | null;
    leadTime: DORABenchmarkResult | null;
    changeFailureRate: DORABenchmarkResult | null;
    mttr: DORABenchmarkResult | null;
  };
}

const EMPTY_DORA_BENCHMARKS: WeeklyDORAMetrics['benchmarks'] = {
  deploymentFrequency: null,
  leadTime: null,
  changeFailureRate: null,
  mttr: null,
};

export class WeeklySummaryRepository {
  private doraMetricsRepository: DORAMetricsRepository;
  private doraMetricsService: DORAMetricsService;

  constructor(private pool: Pool) {
    this.doraMetricsRepository = new DORAMetricsRepository(pool);
    this.doraMetricsService = new DORAMetricsService(this.doraMetricsRepository);
  }

  /**
   * Get current cost breakdown by resource type/region, for the "top cost drivers" list.
   * This reflects the current aws_resources snapshot, not a week-filtered range — those
   * rows are overwritten in place on every discovery sync (see upsertResource), so there
   * is no historical breakdown to filter by date. For the actual week-over-week total,
   * see getWeeklyCostComparison.
   */
  async getWeeklyCostData(query: WeeklyDataQuery, client?: PoolClient) {
    try {
      const result = await (client ?? this.pool).query(
        `SELECT
          COALESCE(SUM(estimated_monthly_cost), 0) as total_cost,
          resource_type,
          region
         FROM aws_resources
         WHERE organization_id = $1 AND status != 'terminated'
         GROUP BY resource_type, region
         ORDER BY total_cost DESC
         LIMIT 10`,
        [query.organizationId]
      );

      return result.rows;
    } catch (error) {
      console.warn('[Weekly Summary] Cost data query failed, returning empty:', error);
      return [];
    }
  }

  /**
   * Get this-week vs previous-week cost totals for real week-over-week comparison.
   *
   * Sourced from AWS Cost Explorer via awsCostService.fetchCostTrend — the same live
   * data source the dashboard KPI uses (see stats.controller.ts getDashboardStats) —
   * so the weekly email and the dashboard never disagree. Cost Explorer returns real
   * daily granularity, unlike aws_resources (a current-state table whose rows are
   * overwritten on every discovery sync, so it holds no history to compare against).
   *
   * Falls back to the static estimated_monthly_cost snapshot when the org has no AWS
   * connection or Cost Explorer doesn't return enough history yet. That fallback has
   * no prior-week value to compare against, so it's reported honestly as 'estimated'
   * with hasComparableCosts: false rather than faking a 0% change.
   */
  async getWeeklyCostComparison(query: WeeklyDataQuery, client?: PoolClient): Promise<WeeklyCostComparison> {
    try {
      const trend = await awsCostService.fetchCostTrend(query.organizationId, '30d');

      if (trend.length >= 14) {
        const currentWeek = trend.slice(-7);
        const previousWeek = trend.slice(-14, -7);
        const currentCost = currentWeek.reduce((sum, point) => sum + point.total, 0);
        const previousCost = previousWeek.reduce((sum, point) => sum + point.total, 0);

        return {
          currentCost,
          previousCost,
          hasComparableCosts: previousCost > 0 && currentCost > 0,
          costSource: 'actual'
        };
      }
    } catch (error) {
      console.warn('[Weekly Summary] Cost Explorer trend query failed, falling back to estimate:', error);
    }

    try {
      const result = await (client ?? this.pool).query(
        `SELECT COALESCE(SUM(estimated_monthly_cost), 0) as total_cost
         FROM aws_resources
         WHERE organization_id = $1 AND status != 'terminated'`,
        [query.organizationId]
      );

      return {
        currentCost: parseFloat(result.rows[0]?.total_cost || '0'),
        previousCost: null,
        hasComparableCosts: false,
        costSource: 'estimated'
      };
    } catch (error) {
      console.warn('[Weekly Summary] Estimated cost fallback query failed, returning 0:', error);
      return { currentCost: 0, previousCost: null, hasComparableCosts: false, costSource: 'estimated' };
    }
  }

  /**
   * Get alerts for the week (gracefully handles missing table)
   */
  async getWeeklyAlerts(query: WeeklyDataQuery, client?: PoolClient) {
    try {
      // First check if alert_history table exists (used by this codebase)
      const tableCheck = await (client ?? this.pool).query(
        `SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_name = 'alert_history'
        )`
      );

      if (!tableCheck.rows[0]?.exists) {
        return { total: 0, critical: 0, topAlert: null };
      }

      const result = await (client ?? this.pool).query(
        `SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE severity = 'critical') as critical
         FROM alert_history
         WHERE organization_id = $1
           AND created_at BETWEEN $2 AND $3`,
        [query.organizationId, query.startDate, query.endDate]
      );

      return {
        total: parseInt(result.rows[0]?.total || '0'),
        critical: parseInt(result.rows[0]?.critical || '0'),
        topAlert: null
      };
    } catch (error) {
      console.warn('[Weekly Summary] Alerts query failed, returning empty:', error);
      return { total: 0, critical: 0, topAlert: null };
    }
  }

  /**
   * Get user info for organization owner
   */
  async getUserInfo(organizationId: string, client?: PoolClient): Promise<UserInfo | null> {
    try {
      const result = await (client ?? this.pool).query(
        `SELECT u.email, u.full_name
         FROM users u
         JOIN organization_memberships om ON u.id = om.user_id
         WHERE om.organization_id = $1
           AND om.role = 'owner'
         LIMIT 1`,
        [organizationId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      return {
        email: result.rows[0].email,
        fullName: result.rows[0].full_name
      };
    } catch (error) {
      console.warn('[Weekly Summary] User info query failed:', error);
      return null;
    }
  }

  /**
   * Get organization name
   */
  async getOrganizationName(organizationId: string): Promise<string> {
    try {
      const result = await this.pool.query(
        `SELECT name FROM organizations WHERE id = $1`,
        [organizationId]
      );

      return result.rows[0]?.name || 'Your Organization';
    } catch (error) {
      return 'Your Organization';
    }
  }

  /**
   * Get all active organizations with email enabled
   * Filters by user email preferences (opt-in/opt-out)
   */
  async getActiveOrganizations(): Promise<string[]> {
    const result = await this.pool.query(
      `SELECT DISTINCT o.id, o.created_at
       FROM organizations o
       JOIN organization_memberships om ON o.id = om.organization_id
       JOIN users u ON om.user_id = u.id
       WHERE om.role = 'owner'
         AND u.email_weekly_summary = true
         AND u.email IS NOT NULL
         AND u.is_email_verified = true
       ORDER BY o.created_at DESC
       LIMIT 100`
    );

    console.log(`[Weekly Summary] Found ${result.rows.length} organizations with email preferences enabled`);

    return result.rows.map(r => r.id);
  }

  /**
   * Get DORA metrics for the week (aggregated).
   *
   * Deployment frequency and change failure rate are computed directly here —
   * simple per-org counts over the window, already correct. Lead time and MTTR
   * are NOT re-derived here: they reuse DORAMetricsRepository.calculateLeadTime()
   * / calculateMTTR(), the same calculations the DORA dashboard already uses
   * (dora-metrics.controller.ts -> GET /api/metrics/dora), instead of this
   * function's old standalone queries.
   *
   * The old lead-time query filtered on `status = 'running'` to mean "average
   * time from commit to deploy" — but nothing in this codebase ever writes
   * that status to a deployment row (GitHub-webhook rows are only ever
   * 'success'/'failed', see github-webhook.routes.ts; the manual deployments
   * API never transitions status after insert either), and there is no commit
   * timestamp column to measure commit-to-deploy from in the first place. That
   * query always matched zero rows and always rendered "N/A", regardless of
   * how much real deploy history existed. DORAMetricsRepository.calculateLeadTime
   * measures something real and already shipped instead: average time between
   * consecutive successful deployments. MTTR was simply hardcoded to 'N/A' and
   * never computed at all, even though calculateMTTR() already existed.
   *
   * DORAMetricsRepository's own pool.query() calls only pick up this org's RLS
   * context via the AsyncLocalStorage-based `pool` proxy in config/database.ts
   * (the same mechanism auth.middleware.ts's runWithOrgClient uses for every
   * authenticated route). The weekly email job doesn't run inside that
   * context — it threads its own `client` explicitly instead — so that scope
   * is opened here around the reused calls specifically, tied to the same
   * already org-tagged `client` the rest of this function uses.
   */
  async getWeeklyDORAMetrics(query: WeeklyDataQuery, client?: PoolClient): Promise<WeeklyDORAMetrics> {
    try {
      // Get deployment count for frequency
      const deploymentResult = await (client ?? this.pool).query(
        `SELECT COUNT(*) as deployment_count
         FROM deployments
         WHERE organization_id = $1
           AND deployed_at BETWEEN $2 AND $3`,
        [query.organizationId, query.startDate, query.endDate]
      );

      const deploymentCount = parseInt(deploymentResult.rows[0]?.deployment_count || '0');
      const days = Math.ceil((query.endDate.getTime() - query.startDate.getTime()) / (1000 * 60 * 60 * 24));
      const deploymentsPerDay = days > 0 ? deploymentCount / days : 0;
      const deploymentFrequency = deploymentsPerDay.toFixed(1);

      // Get change failure rate
      const failureResult = await (client ?? this.pool).query(
        `SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'failed') as failed
         FROM deployments
         WHERE organization_id = $1
           AND deployed_at BETWEEN $2 AND $3`,
        [query.organizationId, query.startDate, query.endDate]
      );

      const total = parseInt(failureResult.rows[0]?.total || '0');
      const failed = parseInt(failureResult.rows[0]?.failed || '0');
      const changeFailureRate = total > 0 ? Math.round(((failed / total) * 100) * 10) / 10 : 0;

      // Lead time + MTTR, reused from DORAMetricsRepository (see doc comment above).
      const doraFilters: DORAMetricsFilters = { organizationId: query.organizationId, dateRange: '7d' };
      const [leadTimeResult, mttrResult] = client
        ? await requestContext.run(client, () => Promise.all([
            this.doraMetricsRepository.calculateLeadTime(doraFilters),
            this.doraMetricsRepository.calculateMTTR(doraFilters),
          ]))
        : await Promise.all([
            this.doraMetricsRepository.calculateLeadTime(doraFilters),
            this.doraMetricsRepository.calculateMTTR(doraFilters),
          ]);

      const leadTime = leadTimeResult.averageLeadTimeHours > 0
        ? `${leadTimeResult.averageLeadTimeHours.toFixed(1)} hours`
        : 'N/A';
      const mttr = mttrResult.incidents > 0
        ? mttrResult.averageMTTRMinutes < 60
          ? `${mttrResult.averageMTTRMinutes.toFixed(0)} minutes`
          : `${(mttrResult.averageMTTRMinutes / 60).toFixed(1)} hours`
        : 'N/A';

      // Benchmark tiers use only the documented, industry-standard DORA 2024
      // bands in DORAMetricsService (the same source the dashboard uses) —
      // never an invented threshold or an LLM's own qualitative judgment. Only
      // attached when there's an actual value to grade: unknown/insufficient
      // data must never be silently labeled with a tier (e.g. "low").
      //
      // Per-org custom benchmarks (custom_dora_benchmarks) are intentionally
      // not applied here — see PR notes: that table isn't present in every
      // environment's schema today, so this matches the dashboard's own
      // effective (industry-default) behavior wherever it's absent.
      const benchmarks: WeeklyDORAMetrics['benchmarks'] = {
        deploymentFrequency: deploymentCount > 0
          ? { level: this.doraMetricsService.resolveDeploymentFrequency(deploymentsPerDay).benchmark, isCustom: false }
          : null,
        changeFailureRate: total > 0
          ? { level: this.doraMetricsService.resolveChangeFailureRate(changeFailureRate).benchmark, isCustom: false }
          : null,
        leadTime: leadTimeResult.averageLeadTimeHours > 0
          ? { level: this.doraMetricsService.resolveLeadTime(leadTimeResult.averageLeadTimeHours).benchmark, isCustom: false }
          : null,
        mttr: mttrResult.incidents > 0
          ? { level: this.doraMetricsService.resolveMTTR(mttrResult.averageMTTRMinutes).benchmark, isCustom: false }
          : null,
      };

      return {
        deploymentFrequency: `${deploymentFrequency} per day`,
        leadTime,
        mttr,
        changeFailureRate,
        benchmarks,
      };
    } catch (error) {
      console.warn('[Weekly Summary] DORA metrics query failed:', error);
      return {
        deploymentFrequency: 'N/A',
        leadTime: 'N/A',
        mttr: 'N/A',
        changeFailureRate: 0,
        benchmarks: EMPTY_DORA_BENCHMARKS,
      };
    }
  }
}
