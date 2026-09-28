/**
 * Weekly Summary Repository
 * Fetches aggregated data for weekly AI-powered email summaries.
 *
 * Every figure the email states is gathered here as a shared ContextSection
 * (ai-context-contract.ts), so a missing, failed, or unsupported source stays
 * missing -- never $0, "no alerts", or "no findings". The email's wording is
 * composed from these sections by weekly-summary-content.ts.
 */

import { Pool, PoolClient } from 'pg';
import awsCostService from '../services/aws-cost.service';
import { requestContext } from '../config/database';
import {
  collectSection,
  deriveSection,
  hasEvidence,
  notSupported,
  type ContextSection,
  type CostExplorerScope,
} from '../services/ai-context-contract';
import { DORAMetricsRepository, DORAMetricsFilters } from './dora-metrics.repository';
import { DORAMetricsService, BenchmarkLevel } from '../services/dora-metrics.service';
import { RiskTrackingService } from '../services/risk-tracking.service';
import { CostRecommendationsRepository } from './cost-recommendations.repository';
import { AccountSecurityFindingsRepository } from './account-security-findings.repository';

export interface WeeklyDataQuery {
  organizationId: string;
  startDate: Date;
  endDate: Date;
}

export interface UserInfo {
  userId: string;
  email: string;
  fullName: string | null;
}

/** A window of whole UTC days, as YYYY-MM-DD with an exclusive end (Cost Explorer's convention). */
export interface DayWindow {
  start: string;
  endExclusive: string;
}

/**
 * The periods one weekly summary covers.
 *   cost / previousCost = the last 7 complete UTC days and the 7 before them.
 *     Today is excluded: Cost Explorer is still billing it, so including it
 *     would compare a partial week against a complete one.
 *   delivery = the 7 x 24h before generation. Deployment records are written
 *     as events happen, so this window has no partial-day gap.
 */
export interface WeeklySummaryPeriod {
  generatedAt: string;
  cost: DayWindow;
  previousCost: DayWindow;
  delivery: { start: string; end: string };
}

/** Gross daily charges for one window: the sum of Cost Explorer trend days, each category floored at $0. */
export interface WeeklySpendEvidence {
  amount: number;
  basis: 'gross_daily_charges_before_credits';
}

export interface WeekOverWeekEvidence {
  currentTotal: number;
  previousTotal: number;
  changeAmount: number;
  /** null when the previous window totals $0 (a percentage is undefined). */
  changePercent: number | null;
}

/** DevControl's list-price monthly run-rate for currently discovered resources -- never billed spend. */
export interface InventoryEstimateEvidence {
  monthlyRunRate: number;
  pricedResources: number;
  totalResources: number;
}

export interface WeeklyAlertEvidence {
  total: number;
  critical: number;
}

export interface WeeklySecurityEvidence {
  score: number;
  accountLevelFindings: number;
  resourceComplianceIssues: number;
}

export interface WeeklyRecommendationEvidence {
  active: number;
  /** De-duplicated estimate (aggregateEstimatedSavings), not realized savings. */
  totalEstimatedMonthlySavings: number;
}

export interface DORABenchmarkResult {
  level: BenchmarkLevel;
  isCustom: boolean;
}

/**
 * Deployment metrics for the delivery window. timeBetweenSuccessfulDeployments
 * is the average gap between consecutive successful deployments of the same
 * service -- NOT DORA lead time for changes (there is no commit timestamp to
 * measure that from), so it is never graded against DORA lead-time bands.
 */
export interface WeeklyDORAMetrics {
  deploymentCount: number;
  failedDeployments: number;
  deploymentFrequency: string;
  timeBetweenSuccessfulDeployments: string;
  mttr: string;
  changeFailureRate: number;
  benchmarks: {
    deploymentFrequency: DORABenchmarkResult | null;
    changeFailureRate: DORABenchmarkResult | null;
    mttr: DORABenchmarkResult | null;
  };
}

export interface WeeklyEvidence {
  period: WeeklySummaryPeriod;
  currentWeekSpend: ContextSection<WeeklySpendEvidence>;
  previousWeekSpend: ContextSection<WeeklySpendEvidence>;
  weekOverWeek: ContextSection<WeekOverWeekEvidence>;
  /** Only gathered when Cost Explorer spend for the current window has no evidence; null otherwise. */
  inventoryEstimate: ContextSection<InventoryEstimateEvidence> | null;
  alerts: ContextSection<WeeklyAlertEvidence>;
  delivery: ContextSection<WeeklyDORAMetrics>;
  security: ContextSection<WeeklySecurityEvidence>;
  recommendations: ContextSection<WeeklyRecommendationEvidence>;
}

const TREND_SOURCE = 'AWS Cost Explorer daily trend';
const COMPARISON_SOURCE = 'DevControl week-over-week comparison';
const ESTIMATE_SOURCE = 'DevControl inventory cost estimate';
const DAY_MS = 24 * 60 * 60 * 1000;

/** Same limitation AI Reports records for alert_history (see migration 028). */
export const WEEKLY_ALERTS_NOT_SUPPORTED_REASON =
  "DevControl's alert sync does not yet associate alerts with an organization, so this organization's alert counts cannot be determined";

const COST_EXPLORER_SCOPE: CostExplorerScope = {
  kind: 'cost_explorer',
  connectedAccountId: null,
  linkedAccountFilter: 'none',
  consolidatedBilling: 'unknown',
  regions: 'all',
};

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function daysOf(window: DayWindow): string[] {
  const days: string[] = [];
  for (let t = Date.parse(`${window.start}T00:00:00Z`); isoDay(t) < window.endExclusive; t += DAY_MS) {
    days.push(isoDay(t));
  }
  return days;
}

function roundCents(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export function weeklySummaryPeriod(now: Date): WeeklySummaryPeriod {
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return {
    generatedAt: now.toISOString(),
    cost: { start: isoDay(todayUtc - 7 * DAY_MS), endExclusive: isoDay(todayUtc) },
    previousCost: { start: isoDay(todayUtc - 14 * DAY_MS), endExclusive: isoDay(todayUtc - 7 * DAY_MS) },
    delivery: { start: new Date(now.getTime() - 7 * DAY_MS).toISOString(), end: now.toISOString() },
  };
}

/**
 * Who may receive an organization's weekly summary (aliases: u = users,
 * om = organization_memberships, o = organizations). Shared verbatim by
 * getActiveOrganizations() and getUserInfo() so the two can never diverge.
 *
 * "Accepted membership" is om.joined_at IS NOT NULL: every path that creates
 * or accepts a membership sets it (org creator, signup, invitation accept,
 * standalone invitation accept, and the legacy migrations-admin/005 owner
 * row); only a pending invitation leaves it NULL. Pending existing-user
 * invitations are also stored is_active = false, and SAML sign-in never
 * creates or activates a membership, so this is belt-and-braces: a pending
 * invitee is excluded until they accept -- skipped, never broadened.
 */
const WEEKLY_SUMMARY_RECIPIENT_PREDICATES = `om.role = 'owner'
         AND om.is_active = true
         AND om.joined_at IS NOT NULL
         AND o.deleted_at IS NULL
         AND u.deleted_at IS NULL
         AND u.email IS NOT NULL
         AND u.email_weekly_summary = true
         AND u.is_email_verified = true`;

const EMPTY_DORA_BENCHMARKS: WeeklyDORAMetrics['benchmarks'] = {
  deploymentFrequency: null,
  changeFailureRate: null,
  mttr: null,
};

export class WeeklySummaryRepository {
  private doraMetricsRepository: DORAMetricsRepository;
  private doraMetricsService: DORAMetricsService;
  private riskTrackingService: RiskTrackingService;
  private costRecommendationsRepository: CostRecommendationsRepository;
  private accountFindingsRepository: AccountSecurityFindingsRepository;

  constructor(private pool: Pool) {
    this.doraMetricsRepository = new DORAMetricsRepository(pool);
    this.doraMetricsService = new DORAMetricsService(this.doraMetricsRepository);
    this.riskTrackingService = new RiskTrackingService(pool);
    this.costRecommendationsRepository = new CostRecommendationsRepository();
    this.accountFindingsRepository = new AccountSecurityFindingsRepository();
  }

  /**
   * Everything one organization's weekly summary states, each as its own
   * section so one failed source never blanks or zeroes the others.
   * `client` must already carry this organization's tenant context.
   */
  async gatherWeeklyEvidence(organizationId: string, now: Date, client?: PoolClient): Promise<WeeklyEvidence> {
    const period = weeklySummaryPeriod(now);
    const deliveryQuery: WeeklyDataQuery = {
      organizationId,
      startDate: new Date(period.delivery.start),
      endDate: new Date(period.delivery.end),
    };

    const [spend, delivery, security, recommendations] = await Promise.all([
      this.getWeeklySpendSections(organizationId, period, client),
      collectSection<WeeklyDORAMetrics>(
        {
          source: 'DevControl deployment records',
          provenance: 'derived',
          scope: { kind: 'organization', window: 'the 7 days before this summary was generated' },
          period: { kind: 'range', start: period.delivery.start, endExclusive: period.delivery.end },
        },
        async () => ({ state: 'available', data: await this.getWeeklyDORAMetrics(deliveryQuery, client) })
      ),
      this.getSecuritySection(organizationId),
      collectSection<WeeklyRecommendationEvidence>(
        { source: 'DevControl cost recommendations', provenance: 'estimated' },
        async () => {
          const stats = await this.costRecommendationsRepository.getStats(organizationId);
          return {
            state: 'available',
            data: { active: stats.active_recommendations, totalEstimatedMonthlySavings: stats.total_potential_savings },
          };
        }
      ),
    ]);

    return { period, ...spend, alerts: this.getWeeklyAlerts(), delivery, security, recommendations };
  }

  /**
   * Cost Explorer spend for the current and previous complete-day windows,
   * their comparison, and -- only when the current window has no Cost
   * Explorer evidence -- the inventory estimate, labeled as an estimate.
   *
   * The trend is AWSCostService.fetchCostTrend() (the dashboard's source),
   * whose categories are floored at $0 per day: these are gross charges
   * before credits, not the net bill. A day Cost Explorer did not return is
   * reported missing, never filled.
   */
  async getWeeklySpendSections(
    organizationId: string,
    period: WeeklySummaryPeriod,
    client?: PoolClient
  ): Promise<Pick<WeeklyEvidence, 'currentWeekSpend' | 'previousWeekSpend' | 'weekOverWeek' | 'inventoryEstimate'>> {
    let trendByDay: Map<string, number> | null = null;
    let notConnected = false;
    let failure: unknown = null;
    try {
      const trend = await awsCostService.fetchCostTrend(organizationId, '30d');
      trendByDay = new Map(trend.map(point => [point.date.slice(0, 10), point.total]));
    } catch (error: any) {
      // AWSCostService.createForOrg() throws AWS_NOT_CONNECTED when the org has
      // no active AWS connection: nothing to query, not a failure.
      if (String(error?.message ?? '').startsWith('AWS_NOT_CONNECTED')) notConnected = true;
      else failure = error;
    }
    const asOf = awsCostService.getCostTrendFetchedAt(organizationId, '30d');

    const windowSpend = (window: DayWindow) =>
      collectSection<WeeklySpendEvidence>(
        {
          source: TREND_SOURCE,
          provenance: 'actual',
          scope: COST_EXPLORER_SCOPE,
          period: { kind: 'range', start: window.start, endExclusive: window.endExclusive },
        },
        async () => {
          if (failure) throw failure;
          if (notConnected || !trendByDay) return { state: 'unavailable', reason: 'no AWS account is connected' };
          const days = daysOf(window);
          const received = days.filter(day => trendByDay!.has(day));
          const missing = days.filter(day => !trendByDay!.has(day));
          const completeness = {
            unit: 'days of daily Cost Explorer data',
            expected: days.length,
            received: received.length,
            missing: missing.length > 0 ? missing : null,
          };
          if (received.length === 0) {
            return { state: 'unavailable', reason: 'AWS Cost Explorer returned no daily data for this period', completeness };
          }
          const amount = roundCents(received.reduce((sum, day) => sum + trendByDay!.get(day)!, 0));
          return { state: 'available', asOf, completeness, data: { amount, basis: 'gross_daily_charges_before_credits' } };
        }
      );

    const [currentWeekSpend, previousWeekSpend] = await Promise.all([
      windowSpend(period.cost),
      windowSpend(period.previousCost),
    ]);

    const weekOverWeek = await deriveSection(
      {
        source: COMPARISON_SOURCE,
        scope: COST_EXPLORER_SCOPE,
        period: { kind: 'range', start: period.previousCost.start, endExclusive: period.cost.endExclusive },
        asOf,
        coverage: 'the 7 UTC days before today vs the 7 days before them; gross daily charges before credits, per Cost Explorer data that may still be updating for recent days',
      },
      [currentWeekSpend, previousWeekSpend] as const,
      ([current, previous]) => ({
        currentTotal: current.amount,
        previousTotal: previous.amount,
        changeAmount: roundCents(current.amount - previous.amount),
        changePercent: previous.amount > 0
          ? Math.round(((current.amount - previous.amount) / previous.amount) * 1000) / 10
          : null,
      })
    );

    const inventoryEstimate = hasEvidence(currentWeekSpend)
      ? null
      : await collectSection<InventoryEstimateEvidence>(
          { source: ESTIMATE_SOURCE, provenance: 'estimated', period: { kind: 'point_in_time' } },
          async () => {
            const result = await (client ?? this.pool).query(
              `SELECT COUNT(*) AS total_resources,
                      COUNT(estimated_monthly_cost) AS priced_resources,
                      COALESCE(SUM(estimated_monthly_cost), 0) AS total_cost
               FROM aws_resources
               WHERE organization_id = $1 AND status != 'terminated'`,
              [organizationId]
            );
            const row = result.rows[0] ?? {};
            const totalResources = parseInt(row.total_resources ?? '0', 10);
            const pricedResources = parseInt(row.priced_resources ?? '0', 10);
            if (pricedResources === 0) {
              return { state: 'unavailable', reason: 'no discovered resources have a cost estimate' };
            }
            return {
              state: 'available',
              asOf: new Date().toISOString(),
              completeness: { unit: 'discovered resources with a cost estimate', expected: totalResources, received: pricedResources, missing: null },
              data: { monthlyRunRate: roundCents(parseFloat(row.total_cost)), pricedResources, totalResources },
            };
          }
        );

    return { currentWeekSpend, previousWeekSpend, weekOverWeek, inventoryEstimate };
  }

  /**
   * Current cost breakdown by resource type/region from the aws_resources
   * snapshot (estimated monthly list-price, not billed spend). Only used by
   * the preview route; the email itself does not list these.
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
   * Alerts for the week. alert_history rows written by the Prometheus alert
   * sync carry no organization_id (migration 028), so an org-scoped count
   * cannot establish that there were zero alerts -- the section is
   * not_supported, never a count of 0.
   */
  getWeeklyAlerts(): ContextSection<WeeklyAlertEvidence> {
    return notSupported<WeeklyAlertEvidence>({ source: 'DevControl alert history' }, WEEKLY_ALERTS_NOT_SUPPORTED_REASON);
  }

  /**
   * DevControl's security posture score and the account-level findings it
   * includes. Unavailable while the score is preliminary; a failure is an
   * error -- never a zero-findings result.
   */
  private async getSecuritySection(organizationId: string): Promise<ContextSection<WeeklySecurityEvidence>> {
    return collectSection<WeeklySecurityEvidence>(
      {
        source: 'DevControl security posture score and configuration checks',
        provenance: 'derived',
        coverage: "DevControl's own configuration checks on discovered resources and account-level checks (security groups, IAM); not AWS Security Hub",
      },
      async () => {
        const [risk, active] = await Promise.all([
          this.riskTrackingService.getCurrentRiskScore(organizationId),
          this.accountFindingsRepository.getActive(organizationId),
        ]);
        if (risk.isPreliminary) return { state: 'unavailable', reason: 'the security posture score is still preliminary' };
        // The score's counts combine account-level findings with per-resource
        // compliance issues (RiskTrackingService.combineSeverityCounts), so the
        // resource count is the exact difference.
        const c = risk.complianceIssueCounts;
        const combined = c.critical + c.high + c.medium + c.low;
        return {
          state: 'available',
          data: {
            score: risk.score,
            accountLevelFindings: active.length,
            resourceComplianceIssues: Math.max(0, combined - active.length),
          },
        };
      }
    );
  }

  /**
   * The organization owner who receives the weekly summary. Same eligibility
   * as getActiveOrganizations() (WEEKLY_SUMMARY_RECIPIENT_PREDICATES), so an
   * owner who opted out, is unverified, was deactivated or soft-deleted, or
   * has only a pending (unaccepted) invitation is never selected -- on the
   * scheduled path or the manual trigger -- and a soft-deleted organization
   * gets no summary. Deterministic when an org has several eligible owners:
   * earliest membership first, then user id. Returns null when no owner is
   * eligible (the org is skipped, never sent to a fallback); a query failure
   * throws.
   */
  async getUserInfo(organizationId: string, client?: PoolClient): Promise<UserInfo | null> {
    const result = await (client ?? this.pool).query(
      `SELECT u.id, u.email, u.full_name
       FROM users u
       JOIN organization_memberships om ON u.id = om.user_id
       JOIN organizations o ON o.id = om.organization_id
       WHERE om.organization_id = $1
         AND ${WEEKLY_SUMMARY_RECIPIENT_PREDICATES}
       ORDER BY om.created_at ASC NULLS LAST, u.id ASC
       LIMIT 1`,
      [organizationId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return {
      userId: result.rows[0].id,
      email: result.rows[0].email,
      fullName: result.rows[0].full_name
    };
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
   * Organizations with at least one eligible weekly-summary recipient --
   * the same predicates getUserInfo() applies (WEEKLY_SUMMARY_RECIPIENT_PREDICATES).
   */
  async getActiveOrganizations(): Promise<string[]> {
    const result = await this.pool.query(
      `SELECT DISTINCT o.id, o.created_at
       FROM organizations o
       JOIN organization_memberships om ON o.id = om.organization_id
       JOIN users u ON om.user_id = u.id
       WHERE ${WEEKLY_SUMMARY_RECIPIENT_PREDICATES}
       ORDER BY o.created_at DESC
       LIMIT 100`
    );

    console.log(`[Weekly Summary] Found ${result.rows.length} organizations with email preferences enabled`);

    return result.rows.map(r => r.id);
  }

  /**
   * Deployment metrics for the window (aggregated).
   *
   * Deployment frequency and change failure rate are computed directly here —
   * simple per-org counts over the window. The average time between
   * successful deployments and the failed-deployment recovery time reuse
   * DORAMetricsRepository.calculateLeadTime() / calculateMTTR(), the same
   * calculations the DORA dashboard uses (dora-metrics.controller.ts ->
   * GET /api/metrics/dora), over its rolling '7d' window.
   *
   * calculateLeadTime() measures the average time between consecutive
   * successful deployments of the same service. That is NOT DORA lead time
   * for changes -- there is no commit timestamp column to measure
   * commit-to-deploy from -- so it is reported under its real meaning and is
   * never graded against DORA lead-time bands.
   *
   * A query failure throws (gatherWeeklyEvidence records it as an error
   * section) instead of returning placeholder values.
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
    const countResult = await (client ?? this.pool).query(
      `SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'failed') as failed
       FROM deployments
       WHERE organization_id = $1
         AND deployed_at BETWEEN $2 AND $3`,
      [query.organizationId, query.startDate, query.endDate]
    );

    const total = parseInt(countResult.rows[0]?.total || '0');
    const failed = parseInt(countResult.rows[0]?.failed || '0');
    const days = Math.ceil((query.endDate.getTime() - query.startDate.getTime()) / DAY_MS);
    const deploymentsPerDay = days > 0 ? total / days : 0;
    const changeFailureRate = total > 0 ? Math.round(((failed / total) * 100) * 10) / 10 : 0;

    const doraFilters: DORAMetricsFilters = { organizationId: query.organizationId, dateRange: '7d' };
    const [gapResult, mttrResult] = client
      ? await requestContext.run(client, () => Promise.all([
          this.doraMetricsRepository.calculateLeadTime(doraFilters),
          this.doraMetricsRepository.calculateMTTR(doraFilters),
        ]))
      : await Promise.all([
          this.doraMetricsRepository.calculateLeadTime(doraFilters),
          this.doraMetricsRepository.calculateMTTR(doraFilters),
        ]);

    const timeBetweenSuccessfulDeployments = gapResult.averageLeadTimeHours > 0
      ? `${gapResult.averageLeadTimeHours.toFixed(1)} hours`
      : 'N/A';
    const mttr = mttrResult.incidents > 0
      ? mttrResult.averageMTTRMinutes < 60
        ? `${mttrResult.averageMTTRMinutes.toFixed(0)} minutes`
        : `${(mttrResult.averageMTTRMinutes / 60).toFixed(1)} hours`
      : 'N/A';

    // Benchmark tiers use only the documented, industry-standard DORA 2024
    // bands in DORAMetricsService (the same source the dashboard uses), and
    // only when there's an actual value to grade. The time between
    // deployments has no benchmark: it is not the DORA lead-time metric.
    //
    // Per-org custom benchmarks (custom_dora_benchmarks) are intentionally
    // not applied here — that table isn't present in every environment's
    // schema today, so this matches the dashboard's own effective
    // (industry-default) behavior wherever it's absent.
    const benchmarks: WeeklyDORAMetrics['benchmarks'] = total === 0 ? EMPTY_DORA_BENCHMARKS : {
      deploymentFrequency: { level: this.doraMetricsService.resolveDeploymentFrequency(deploymentsPerDay).benchmark, isCustom: false },
      changeFailureRate: { level: this.doraMetricsService.resolveChangeFailureRate(changeFailureRate).benchmark, isCustom: false },
      mttr: mttrResult.incidents > 0
        ? { level: this.doraMetricsService.resolveMTTR(mttrResult.averageMTTRMinutes).benchmark, isCustom: false }
        : null,
    };

    return {
      deploymentCount: total,
      failedDeployments: failed,
      deploymentFrequency: `${deploymentsPerDay.toFixed(1)} per day`,
      timeBetweenSuccessfulDeployments,
      mttr,
      changeFailureRate,
      benchmarks,
    };
  }
}
