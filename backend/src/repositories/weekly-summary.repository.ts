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
import {
  collectSection,
  deriveSection,
  hasEvidence,
  notConnected,
  type ContextSection,
  type CostExplorerScope,
} from '../services/ai-context-contract';
import { collectProvider } from '../services/ai/evidence/registry';
import { createEvidenceBasis } from '../services/ai/evidence/basis';
import { alertHistoryProvider } from '../services/ai/evidence/providers/not-built';
import { changeFailureRate } from '../services/deployment-status';
import { RiskTrackingService } from '../services/risk-tracking.service';
import { CostRecommendationsRepository, type ActiveSavingsBreakdown } from './cost-recommendations.repository';
import { hasEligibleAwsAccount } from './aws-accounts.repository';
import { AccountSecurityFindingsRepository } from './account-security-findings.repository';
import { organizationHasEntitlement } from '../middleware/subscription.middleware';

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

/**
 * Cost Explorer spend for one window: the sum of the trend's days. Each day is
 * UnblendedCost by service, so credits and refunds are already netted in; a
 * category that credits take below $0 on a day counts as $0
 * (AWSCostService.queryCostTrend). Not gross, not the net bill.
 */
export interface WeeklySpendEvidence {
  amount: number;
  basis: 'unblended_after_credits_category_floored';
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
  /**
   * The security posture score: left out (not null) below
   * PLAN_ENTITLEMENTS.riskScore, as GET /api/risk-score/current is gated.
   */
  score?: number;
  accountLevelFindings: number;
  resourceComplianceIssues: number;
}

/** Open savings findings by what their figure is (CostRecommendationsRepository.getActiveSavingsBreakdown). */
export type WeeklyRecommendationEvidence = ActiveSavingsBreakdown;

/**
 * Whether the organization has an AWS connection DevControl uses (one
 * eligible account). 'unknown' when that could not be read: then no section
 * is worded as not connected.
 */
export type WeeklyAwsConnection = 'connected' | 'not_connected' | 'unknown';

/** The reason the security section gives while no scan has completed. */
export const SECURITY_PRELIMINARY_REASON = 'the security posture score is still preliminary';
const NOT_CONNECTED_REASON = 'no AWS account is connected';

/**
 * Deployment metrics for the delivery window, with the same definitions as
 * the Deployments and DORA pages: frequency counts successful deployments
 * only, and the change failure rate is failed / (success + failed) -- null
 * when nothing finished. Lead time for changes and time to restore are not
 * tracked (no commit or incident records), so they are never derived here.
 * No figure is graded against a benchmark tier.
 */
export interface WeeklyDORAMetrics {
  /** Every deployment recorded in the window, whatever its status. */
  deploymentCount: number;
  successfulDeployments: number;
  failedDeployments: number;
  /**
   * Successful deployments per day over the window. This and
   * changeFailureRate are DORA metrics: left out (not null) below
   * PLAN_ENTITLEMENTS.doraMetrics, see getWeeklyDeliveryOnPlan.
   */
  deploymentFrequency?: string;
  /** Null when no deployment finished in the window. */
  changeFailureRate?: number | null;
}

export interface WeeklyEvidence {
  period: WeeklySummaryPeriod;
  awsConnection: WeeklyAwsConnection;
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
const SECURITY_SOURCE = 'DevControl security posture score and configuration checks';
const RECOMMENDATIONS_SOURCE = 'DevControl cost recommendations';
const DAY_MS = 24 * 60 * 60 * 1000;


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

export class WeeklySummaryRepository {
  private riskTrackingService: RiskTrackingService;
  private costRecommendationsRepository: CostRecommendationsRepository;
  private accountFindingsRepository: AccountSecurityFindingsRepository;

  constructor(private pool: Pool) {
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

    const awsConnection = await this.getAwsConnection(organizationId, client);
    const notConnectedSection = <T>(source: string) =>
      notConnected<T>({ source }, NOT_CONNECTED_REASON);

    const [spend, delivery, security, recommendations] = await Promise.all([
      this.getWeeklySpendSections(organizationId, period, client),
      collectSection<WeeklyDORAMetrics>(
        {
          source: 'DevControl deployment records',
          provenance: 'derived',
          scope: { kind: 'organization', window: 'the 7 days before this summary was generated' },
          period: { kind: 'range', start: period.delivery.start, endExclusive: period.delivery.end },
        },
        async () => ({ state: 'available', data: await this.getWeeklyDeliveryOnPlan(deliveryQuery, client) })
      ),
      awsConnection === 'not_connected'
        ? Promise.resolve(notConnectedSection<WeeklySecurityEvidence>(SECURITY_SOURCE))
        : this.getSecuritySection(organizationId, client),
      awsConnection === 'not_connected'
        ? Promise.resolve(notConnectedSection<WeeklyRecommendationEvidence>(RECOMMENDATIONS_SOURCE))
        : collectSection<WeeklyRecommendationEvidence>(
            { source: RECOMMENDATIONS_SOURCE, provenance: 'estimated' },
            async () => ({ state: 'available', data: await this.costRecommendationsRepository.getActiveSavingsBreakdown(organizationId) })
          ),
    ]);

    const alerts = await this.getWeeklyAlerts(organizationId, period);
    return { period, awsConnection, ...spend, alerts, delivery, security, recommendations };
  }

  /** One eligible AWS account or none; 'unknown' when the read fails (logged without detail). */
  async getAwsConnection(organizationId: string, client?: PoolClient): Promise<WeeklyAwsConnection> {
    try {
      return (await hasEligibleAwsAccount(client ?? this.pool, organizationId)) ? 'connected' : 'not_connected';
    } catch {
      console.error('[Weekly Summary] AWS connection lookup failed');
      return 'unknown';
    }
  }

  /**
   * Cost Explorer spend for the current and previous complete-day windows,
   * their comparison, and -- only when the current window has no Cost
   * Explorer evidence -- the inventory estimate, labeled as an estimate.
   *
   * The trend is AWSCostService.fetchCostTrend() (the dashboard's source):
   * UnblendedCost by service, so credits and refunds are netted in, with each
   * category floored at $0 per day -- neither gross charges nor the net bill.
   * A day Cost Explorer did not return is reported missing, never filled.
   * No AWS connection makes every cost section not_connected and skips the
   * inventory estimate.
   */
  async getWeeklySpendSections(
    organizationId: string,
    period: WeeklySummaryPeriod,
    client?: PoolClient
  ): Promise<Pick<WeeklyEvidence, 'currentWeekSpend' | 'previousWeekSpend' | 'weekOverWeek' | 'inventoryEstimate'>> {
    let trendByDay: Map<string, number> | null = null;
    let notConnectedOrg = false;
    let failure: unknown = null;
    try {
      const trend = await awsCostService.fetchCostTrend(organizationId, '30d');
      trendByDay = new Map(trend.map(point => [point.date.slice(0, 10), point.total]));
    } catch (error: any) {
      // AWSCostService.createForOrg() throws AWS_NOT_CONNECTED when the org has
      // no active AWS connection: nothing to query, not a failure.
      if (String(error?.message ?? '').startsWith('AWS_NOT_CONNECTED')) notConnectedOrg = true;
      else failure = error;
    }
    const asOf = await awsCostService.getCostTrendFetchedAt(organizationId, '30d');

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
          if (notConnectedOrg) return { state: 'not_connected', reason: NOT_CONNECTED_REASON };
          if (!trendByDay) return { state: 'unavailable', reason: 'AWS Cost Explorer returned no data' };
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
          return { state: 'available', asOf, completeness, data: { amount, basis: 'unblended_after_credits_category_floored' } };
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
        coverage: 'the 7 UTC days before today vs the 7 days before them; UnblendedCost by service after credits and refunds, each category floored at $0 per day, per Cost Explorer data that may still be updating for recent days',
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

    const inventoryEstimate = hasEvidence(currentWeekSpend) || notConnectedOrg
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
   * Alerts for the week: the alert history provider (alerts.history) of the
   * shared evidence registry. DevControl keeps no organization-scoped history
   * of past alerts (alert_history's only writer stores no organization), so
   * the section is not_built -- never a count of 0. CloudWatch alarms are
   * current state, not a weekly history, so they are not read here.
   */
  getWeeklyAlerts(organizationId: string, period: WeeklySummaryPeriod): Promise<ContextSection<WeeklyAlertEvidence>> {
    return collectProvider(alertHistoryProvider, {
      organizationId,
      now: new Date(period.generatedAt),
      period: { from: period.delivery.start, to: period.delivery.end },
      basis: createEvidenceBasis(organizationId),
    });
  }

  /**
   * DevControl's security posture score and the account-level findings it
   * includes. Unavailable while the score is preliminary; a failure is an
   * error -- never a zero-findings result. The score itself is left out below
   * PLAN_ENTITLEMENTS.riskScore (and when the plan cannot be read), as the
   * risk score API is gated; the finding counts are on every plan.
   */
  private async getSecuritySection(organizationId: string, client?: PoolClient): Promise<ContextSection<WeeklySecurityEvidence>> {
    return collectSection<WeeklySecurityEvidence>(
      {
        source: SECURITY_SOURCE,
        provenance: 'derived',
        coverage: "DevControl's own configuration checks on discovered resources and account-level checks (security groups, IAM); not AWS Security Hub",
      },
      async () => {
        const [risk, active, scoreOnPlan] = await Promise.all([
          this.riskTrackingService.getCurrentRiskScore(organizationId),
          this.accountFindingsRepository.getActive(organizationId),
          organizationHasEntitlement(organizationId, 'riskScore', client ?? this.pool).catch(() => {
            console.error('[Weekly Summary] plan lookup failed');
            return false;
          }),
        ]);
        if (risk.isPreliminary) return { state: 'unavailable', reason: SECURITY_PRELIMINARY_REASON };
        // The score's counts combine account-level findings with per-resource
        // compliance issues (RiskTrackingService.combineSeverityCounts), so the
        // resource count is the exact difference.
        const c = risk.complianceIssueCounts;
        const combined = c.critical + c.high + c.medium + c.low;
        return {
          state: 'available',
          data: {
            ...(scoreOnPlan ? { score: risk.score } : {}),
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
   * The organization's name, or null when it can't be read (no row, an empty
   * name, or a failed query) -- the email then names no organization.
   */
  async getOrganizationName(organizationId: string, client?: PoolClient): Promise<string | null> {
    try {
      const result = await (client ?? this.pool).query(
        `SELECT name FROM organizations WHERE id = $1`,
        [organizationId]
      );

      return result.rows[0]?.name || null;
    } catch (error) {
      return null;
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
   * Deployment metrics for the window (aggregated), one organization's.
   *
   * Same definitions as GET /api/deployments/stats and GET /api/metrics/dora:
   * only 'success' rows count towards frequency, and only finished rows
   * ('success' + 'failed') enter the change failure rate, which is null when
   * nothing finished. Rows that never finished or have an unrecognised status
   * are in the recorded total and nothing else.
   *
   * A query failure throws (gatherWeeklyEvidence records it as an error
   * section) instead of returning placeholder values.
   */
  async getWeeklyDORAMetrics(query: WeeklyDataQuery, client?: PoolClient): Promise<WeeklyDORAMetrics> {
    const countResult = await (client ?? this.pool).query(
      `SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'success') as success,
        COUNT(*) FILTER (WHERE status = 'failed') as failed
       FROM deployments
       WHERE organization_id = $1
         AND deployed_at BETWEEN $2 AND $3`,
      [query.organizationId, query.startDate, query.endDate]
    );

    const total = parseInt(countResult.rows[0]?.total || '0');
    const success = parseInt(countResult.rows[0]?.success || '0');
    const failed = parseInt(countResult.rows[0]?.failed || '0');
    const days = Math.ceil((query.endDate.getTime() - query.startDate.getTime()) / DAY_MS);
    const deploymentsPerDay = days > 0 ? parseFloat((success / days).toFixed(2)) : 0;
    const failureRate = changeFailureRate(success, failed);

    return {
      deploymentCount: total,
      successfulDeployments: success,
      failedDeployments: failed,
      deploymentFrequency: `${deploymentsPerDay} per day`,
      changeFailureRate: failureRate,
    };
  }

  /**
   * The window's deployment metrics as the organization's plan allows: the
   * counts on every plan; deployment frequency and the change failure rate
   * (DORA metrics) only when the plan includes PLAN_ENTITLEMENTS.doraMetrics,
   * resolved as for every request (a restricted or lapsed organization is
   * free). Below it, and when the plan cannot be read, those two keys are
   * left out -- as GET /api/deployments/stats does. The email and its preview
   * both read this.
   */
  async getWeeklyDeliveryOnPlan(query: WeeklyDataQuery, client?: PoolClient): Promise<WeeklyDORAMetrics> {
    const [metrics, doraOnPlan] = await Promise.all([
      this.getWeeklyDORAMetrics(query, client),
      organizationHasEntitlement(query.organizationId, 'doraMetrics', client ?? this.pool).catch((err) => {
        console.error('[Weekly Summary] plan lookup failed', err?.message ?? err);
        return false;
      }),
    ]);
    if (doraOnPlan) return metrics;
    return {
      deploymentCount: metrics.deploymentCount,
      successfulDeployments: metrics.successfulDeployments,
      failedDeployments: metrics.failedDeployments,
    };
  }
}
