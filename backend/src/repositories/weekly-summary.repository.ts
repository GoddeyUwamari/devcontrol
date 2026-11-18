/**
 * Weekly Summary Repository
 * Reads everything the weekly summary email states, for one organization.
 *
 * Every source is gathered here as a shared ContextSection
 * (ai-context-contract.ts), so a missing, failed, or unsupported source stays
 * missing -- never $0 or "no findings". buildWeeklyFacts() turns the sections
 * into the typed facts (services/weekly-brief/facts.ts) the email's rules and
 * template read.
 */

import { Pool, PoolClient } from 'pg';
import awsCostService from '../services/aws-cost.service';
import {
  collectSection,
  notConnected,
  type ContextSection,
  type CostExplorerScope,
} from '../services/ai-context-contract';
import { changeFailureRate } from '../services/deployment-status';
import type { CostReportState } from '../services/cost-trend-report-state';
import { RiskTrackingService } from '../services/risk-tracking.service';
import { CostRecommendationsRepository, type ActiveSavingsBreakdown } from './cost-recommendations.repository';
import { findEligibleAwsAccount, hasEligibleAwsAccount } from './aws-accounts.repository';
import { AccountSecurityFindingsRepository } from './account-security-findings.repository';
import { SECURITY_PRELIMINARY_REASON, weeklyFacts, type WeeklyFacts } from '../services/weekly-brief/facts';
import { connectionChecksView, readConnectionChecksOrNull } from './aws-connection-checks.repository';
import { latestAnalysisRuns } from './cost-analysis-runs.repository';
import { DEMO_EXCLUSION_SQL } from '../demo/demo-workspace';
import type { HealthDisplay } from '../services/connection-health';
import { getOrganizationEntitlement, organizationHasEntitlement } from '../middleware/subscription.middleware';
import { PLAN_NAME } from '../config/plan-names';

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
 * One UTC day of the Cost Explorer trend (AWSCostService.fetchCostTrend, the
 * Dashboard's source): `total` is UnblendedCost by service with credits and
 * refunds netted in, each category floored at $0 per day; `byService` holds
 * the raw per-service amounts (not floored, so a credit can make one
 * negative), null when the point carries none.
 *
 * `reportState` is the point's own state, set once by costReportStates() when
 * the trend was fetched (trend-lag rule): the email reads it and never
 * recomputes it. Null when the point carries none (not determined).
 */
export interface WeeklyTrendDay {
  date: string;
  total: number;
  reportState: CostReportState | null;
  byService: { service: string; amount: number }[] | null;
}

/** The 30-day daily trend, in date order: it covers this week's 7 days and the same weekdays of the week before. */
export interface WeeklyCostTrendEvidence {
  days: WeeklyTrendDay[];
}

export interface WeeklySecurityEvidence {
  /**
   * The security posture score: left out (not null) below
   * PLAN_ENTITLEMENTS.riskScore, as GET /api/risk-score/current is gated.
   */
  score?: number;
  /**
   * Open account-level findings, as the Security page counts them (founder
   * Q5, brief-step1.md): derived status active or acknowledged. A dismissed
   * or accepted-risk finding is not open.
   */
  accountLevelFindings: number;
  resourceComplianceIssues: number;
}

/**
 * Resolved findings the latest analysis still detects: the Cost Optimization
 * page's own numbers (CostRecommendationsRepository.getHiddenFindings()
 * summary.stillDetected), plus the one the email names.
 */
export interface WeeklyStillDetectedEvidence {
  count: number;
  /** The page's "Estimated $X/mo if addressed" (C8). */
  estimatedMonthlySavings: number;
  /** The page's "Plus up to $X/mo in estimated ceilings" (C9). */
  ceilingMonthlySavings: number;
  /** The finding the email names: the highest estimate, then the newest decision. Null when there is none. */
  example: { check: string; resource: string; region: string | null; resolvedAt: string } | null;
}

/** The connection's health as the Connect AWS page shows it, plus the last successful check (aws_connection_checks.last_ok_at). */
export type WeeklyConnectionHealth = HealthDisplay & { lastOkAt: string | null };

/** Open savings findings by what their figure is (CostRecommendationsRepository.getActiveSavingsBreakdown). */
export type WeeklyRecommendationEvidence = ActiveSavingsBreakdown;

/**
 * Whether the organization has an AWS connection DevControl uses (one
 * eligible account). 'unknown' when that could not be read: then no section
 * is worded as not connected.
 */
export type WeeklyAwsConnection = 'connected' | 'not_connected' | 'unknown';

/** The reason the security section gives while no scan has completed. */
export { SECURITY_PRELIMINARY_REASON };
const NOT_CONNECTED_REASON = 'no AWS account is connected';

/** Organizations read per page by the scheduled run (getActiveOrganizationsPage). */
export const WEEKLY_SUMMARY_ORG_PAGE_SIZE = 100;
/** The largest page getActiveOrganizationsPage() reads, whatever is asked. */
export const WEEKLY_SUMMARY_MAX_PAGE_SIZE = 500;

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

/** How a scan or a cost analysis ended, as the email states it. */
export type WeeklyRunState = 'completed' | 'in_progress' | 'did_not_finish';

/**
 * How a cost analysis ended. 'partial' is a run that reached its end with at
 * least one cost check failed (completed with gaps, WE-2 review H-1): it set
 * completed_at and reconciled the open findings, so it dates them, and the
 * email adds the Cost Optimization page's partial sentence. A 'partial' row
 * with no completion time didn't finish.
 */
export type WeeklyAnalysisRunState = WeeklyRunState | 'partial';

/**
 * The latest discovery scan (or cost analysis) and the last one that
 * completed, as ISO timestamps. `latest.at` is when it ended, or when it
 * started while it is still running; `latest.startedAt` is when it started.
 */
export interface WeeklyRunEvidence<S extends WeeklyAnalysisRunState = WeeklyRunState> {
  /** Null when there has been none. */
  latest: { state: S; at: string; startedAt: string } | null;
  /**
   * Null when none has completed. For a cost analysis, a partial run with a
   * completion time counts as completed, with `partial: true`.
   */
  lastCompleted: { at: string; partial?: true } | null;
}

/**
 * The latest cost analysis run and the last completed one (completed, or
 * partial with gaps). `latestChecks`: how many checks the latest run recorded
 * and how many of them completed; null when it recorded none.
 */
export type WeeklyAnalysisEvidence = WeeklyRunEvidence<WeeklyAnalysisRunState> & {
  latestChecks: { total: number; complete: number } | null;
};

/** Whether any deployment was ever recorded for the organization, whatever the window. */
export interface WeeklyDeploymentHistoryEvidence {
  anyRecorded: boolean;
}

export interface WeeklyEvidence {
  period: WeeklySummaryPeriod;
  awsConnection: WeeklyAwsConnection;
  /**
   * The connection's health as the Connect AWS page shows it (displayHealth
   * over aws_connection_checks, D1a). Null when no AWS account is connected.
   */
  connectionHealth: ContextSection<WeeklyConnectionHealth> | null;
  /**
   * The latest discovery scan, and the last one that completed (status
   * 'completed' with its compliance scan completed): the scan the security
   * counts, the posture score and the inventory estimate come from. Null when
   * no AWS account is connected.
   */
  scan: ContextSection<WeeklyRunEvidence> | null;
  /** The latest cost analysis run (cost_analysis_runs, any source) and the last completed one. Null when not connected. */
  costAnalysis: ContextSection<WeeklyAnalysisEvidence> | null;
  deploymentHistory: ContextSection<WeeklyDeploymentHistoryEvidence>;
  /** The daily Cost Explorer trend; not_connected (never read) when no AWS account is connected. */
  costTrend: ContextSection<WeeklyCostTrendEvidence>;
  delivery: ContextSection<WeeklyDORAMetrics>;
  security: ContextSection<WeeklySecurityEvidence>;
  recommendations: ContextSection<WeeklyRecommendationEvidence>;
  stillDetected: ContextSection<WeeklyStillDetectedEvidence>;
}

const TREND_SOURCE = 'AWS Cost Explorer daily trend';
const SECURITY_SOURCE = 'DevControl security posture score and configuration checks';
const RECOMMENDATIONS_SOURCE = 'DevControl cost recommendations';
const STILL_DETECTED_SOURCE = 'DevControl resolved cost findings still detected';
const HEALTH_SOURCE = 'DevControl AWS connection health';
const SCAN_SOURCE = 'DevControl discovery scans';
const ANALYSIS_SOURCE = 'DevControl cost analysis runs';
const DEPLOYMENT_HISTORY_SOURCE = 'DevControl deployment records (all time)';
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

type RunTimes = { started_at?: unknown; completed_at?: unknown; created_at?: unknown; status?: unknown };

function isoOf(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** A latest run (job or analysis) and the last completed one as WeeklyRunEvidence; times fall back to the row's creation. */
function runEvidence<S extends WeeklyAnalysisRunState>(
  latest: RunTimes | undefined | null,
  state: S | null,
  lastCompleted: RunTimes | undefined | null
): WeeklyRunEvidence<S> {
  const created = (row: RunTimes) => isoOf(row.created_at);
  const startedAt = latest ? isoOf(latest.started_at) ?? created(latest) : null;
  const at = latest && state
    ? state === 'in_progress' ? startedAt : isoOf(latest.completed_at) ?? startedAt
    : null;
  const lastAt = lastCompleted ? isoOf(lastCompleted.completed_at) ?? created(lastCompleted) : null;
  return {
    latest: latest && state && at && startedAt ? { state, at, startedAt } : null,
    lastCompleted: lastAt ? { at: lastAt, ...(lastCompleted?.status === 'partial' ? { partial: true as const } : {}) } : null,
  };
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
 * getActiveOrganizationsPage() and getRecipients() so the two can never diverge.
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
         AND u.is_email_verified = true
         AND ${DEMO_EXCLUSION_SQL}`;

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
   * The organization's weekly facts (services/weekly-brief/facts.ts): every
   * read below, as one typed object the email's rules and template read.
   * `client` must already carry this organization's tenant context.
   */
  async buildWeeklyFacts(organizationId: string, now: Date, client?: PoolClient): Promise<WeeklyFacts> {
    return weeklyFacts(await this.gatherWeeklyEvidence(organizationId, now, client));
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

    const off = awsConnection === 'not_connected';
    const [costTrend, delivery, security, recommendations, stillDetected, connectionHealth, scan, costAnalysis, deploymentHistory] = await Promise.all([
      off ? Promise.resolve(notConnectedSection<WeeklyCostTrendEvidence>(TREND_SOURCE)) : this.getCostTrendSection(organizationId),
      collectSection<WeeklyDORAMetrics>(
        {
          source: 'DevControl deployment records',
          provenance: 'derived',
          scope: { kind: 'organization', window: 'the 7 days before this summary was generated' },
          period: { kind: 'range', start: period.delivery.start, endExclusive: period.delivery.end },
        },
        async () => ({ state: 'available', data: await this.getWeeklyDeliveryOnPlan(deliveryQuery, client) })
      ),
      off ? Promise.resolve(notConnectedSection<WeeklySecurityEvidence>(SECURITY_SOURCE)) : this.getSecuritySection(organizationId, client),
      off
        ? Promise.resolve(notConnectedSection<WeeklyRecommendationEvidence>(RECOMMENDATIONS_SOURCE))
        : collectSection<WeeklyRecommendationEvidence>(
            { source: RECOMMENDATIONS_SOURCE, provenance: 'estimated' },
            async () => ({ state: 'available', data: await this.costRecommendationsRepository.getActiveSavingsBreakdown(organizationId) })
          ),
      off ? Promise.resolve(notConnectedSection<WeeklyStillDetectedEvidence>(STILL_DETECTED_SOURCE)) : this.getStillDetectedSection(organizationId),
      off ? Promise.resolve(null) : this.getConnectionHealthSection(organizationId, now, client),
      off ? Promise.resolve(null) : this.getScanSection(organizationId, client),
      off ? Promise.resolve(null) : this.getCostAnalysisSection(organizationId, client),
      this.getDeploymentHistorySection(organizationId, client),
    ]);

    return {
      period, awsConnection, connectionHealth, scan, costAnalysis, deploymentHistory,
      costTrend, delivery, security, recommendations, stillDetected,
    };
  }

  /**
   * Runs `read` on the caller's org-tagged client; without one (the preview
   * route), on a pooled connection tagged for this organization inside its
   * own read transaction (set_config LOCAL, so the tag never outlives it).
   */
  private async onOrgClient<T>(
    organizationId: string,
    client: PoolClient | undefined,
    read: (db: Pick<PoolClient, 'query'>) => Promise<T>
  ): Promise<T> {
    if (client) return read(client);
    const own = await this.pool.connect();
    try {
      await own.query('BEGIN READ ONLY');
      await own.query("SELECT set_config('app.current_organization_id', $1, true)", [organizationId]);
      const result = await read(own);
      await own.query('COMMIT');
      return result;
    } catch (error) {
      await own.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      own.release();
    }
  }

  /**
   * The connection's health, read as GET /api/aws/accounts reads it: the one
   * eligible account, its aws_connection_checks row (none, or no table yet:
   * not checked yet) through connectionChecksView/displayHealth at `now`.
   * A failed read (including more than one eligible account) is an error
   * section, never a health state.
   */
  getConnectionHealthSection(organizationId: string, now: Date, client?: PoolClient): Promise<ContextSection<WeeklyConnectionHealth>> {
    return collectSection<WeeklyConnectionHealth>(
      { source: HEALTH_SOURCE, provenance: 'derived', period: { kind: 'point_in_time' } },
      () => this.onOrgClient(organizationId, client, async (db) => {
        const account = await findEligibleAwsAccount(db, organizationId);
        if (!account) return { state: 'unavailable', reason: NOT_CONNECTED_REASON };
        const row = await readConnectionChecksOrNull(db, organizationId, account.id);
        // last_ok_at is on the row but not in the page's HealthDisplay: read
        // here, so the Connect AWS API is unchanged.
        return { state: 'available', data: { ...connectionChecksView(row, now).health, lastOkAt: isoOf(row?.last_ok_at) } };
      })
    );
  }

  /**
   * The latest discovery job and the last completed one (status 'completed'
   * and compliance_scan_completed): the scan the findings, the posture score
   * and the inventory estimate are dated with. A job still pending or running
   * is in progress; any other job that is not completed didn't finish.
   */
  getScanSection(organizationId: string, client?: PoolClient): Promise<ContextSection<WeeklyRunEvidence>> {
    return collectSection<WeeklyRunEvidence>(
      { source: SCAN_SOURCE, provenance: 'derived', period: { kind: 'point_in_time' } },
      () => this.onOrgClient(organizationId, client, async (db) => {
        const latest = await db.query(
          `SELECT status, compliance_scan_completed, started_at, completed_at, created_at
           FROM resource_discovery_jobs
           WHERE organization_id = $1
           ORDER BY created_at DESC
           LIMIT 1`,
          [organizationId]
        );
        const completed = await db.query(
          `SELECT completed_at, created_at
           FROM resource_discovery_jobs
           WHERE organization_id = $1 AND status = 'completed' AND compliance_scan_completed = true
           ORDER BY created_at DESC
           LIMIT 1`,
          [organizationId]
        );
        const job = latest.rows[0];
        const state: WeeklyRunState | null = !job
          ? null
          : job.status === 'pending' || job.status === 'running'
            ? 'in_progress'
            : job.status === 'completed' && job.compliance_scan_completed === true ? 'completed' : 'did_not_finish';
        return { state: 'available', data: runEvidence(job, state, completed.rows[0]) };
      })
    );
  }

  /**
   * The latest cost analysis run (any source) and the last completed one, as
   * the Cost Optimization page reads them (latestAnalysisRuns: run_state, so a
   * dead worker's run is interrupted). Running is in progress; partial with a
   * completion time is completed with gaps ("Analysis partly complete" on the
   * Cost Optimization page); failed, interrupted, and partial with no
   * completion time didn't finish.
   */
  getCostAnalysisSection(organizationId: string, client?: PoolClient): Promise<ContextSection<WeeklyAnalysisEvidence>> {
    return collectSection<WeeklyAnalysisEvidence>(
      { source: ANALYSIS_SOURCE, provenance: 'derived', period: { kind: 'point_in_time' } },
      () => this.onOrgClient(organizationId, client, async (db) => {
        const runs = await latestAnalysisRuns(db, organizationId);
        const run = runs.latest;
        const state: WeeklyAnalysisRunState | null = !run
          ? null
          : run.run_state === 'running'
            ? 'in_progress'
            : run.run_state === 'completed'
              ? 'completed'
              : run.run_state === 'partial' && isoOf(run.completed_at) ? 'partial' : 'did_not_finish';
        const checks = Array.isArray(run?.checks) ? run!.checks : null;
        return {
          state: 'available',
          data: {
            ...runEvidence(run, state, runs.lastCompleted),
            latestChecks: checks && checks.length > 0
              ? { total: checks.length, complete: checks.filter(c => c?.outcome === 'complete').length }
              : null,
          },
        };
      })
    );
  }

  /** Whether the organization has ever recorded a deployment. */
  getDeploymentHistorySection(organizationId: string, client?: PoolClient): Promise<ContextSection<WeeklyDeploymentHistoryEvidence>> {
    return collectSection<WeeklyDeploymentHistoryEvidence>(
      { source: DEPLOYMENT_HISTORY_SOURCE, provenance: 'derived', period: { kind: 'point_in_time' } },
      () => this.onOrgClient(organizationId, client, async (db) => {
        const result = await db.query(
          `SELECT EXISTS (SELECT 1 FROM deployments WHERE organization_id = $1) AS any_recorded`,
          [organizationId]
        );
        return { state: 'available', data: { anyRecorded: result.rows[0]?.any_recorded === true } };
      })
    );
  }

  /**
   * The organization's plan name on its effective tier, resolved as for every
   * request (a restricted or lapsed organization is on Visibility), from the
   * server's PLAN_NAME mirror -- never a tier id. Null when it can't be read:
   * the email then names no plan.
   */
  async getPlanName(organizationId: string, client?: PoolClient): Promise<string | null> {
    try {
      const entitlement = await getOrganizationEntitlement(organizationId, client ?? this.pool);
      return entitlement ? PLAN_NAME[entitlement.effectiveTier] : null;
    } catch {
      console.error('[Weekly Summary] plan lookup failed');
      return null;
    }
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
   * The 30-day daily Cost Explorer trend: AWSCostService.fetchCostTrend(), the
   * Dashboard's source and cache, so the email sees the same points and the
   * same per-day reportState (trend-lag rule, costReportStates()). Nothing is
   * reclassified, filled or summed here. A failed read is an error section,
   * never $0; AWS_NOT_CONNECTED (no eligible account) is not_connected.
   */
  getCostTrendSection(organizationId: string): Promise<ContextSection<WeeklyCostTrendEvidence>> {
    return collectSection<WeeklyCostTrendEvidence>(
      { source: TREND_SOURCE, provenance: 'actual', scope: COST_EXPLORER_SCOPE },
      async () => {
        let trend;
        try {
          trend = await awsCostService.fetchCostTrend(organizationId, '30d');
        } catch (error: any) {
          if (String(error?.message ?? '').startsWith('AWS_NOT_CONNECTED')) return { state: 'not_connected', reason: NOT_CONNECTED_REASON };
          throw error;
        }
        if (trend.length === 0) return { state: 'unavailable', reason: 'AWS Cost Explorer returned no daily data' };
        const asOf = await awsCostService.getCostTrendFetchedAt(organizationId, '30d');
        return {
          state: 'available',
          asOf,
          data: {
            days: trend.map(point => ({
              date: point.date.slice(0, 10),
              total: point.total,
              reportState: point.reportState ?? null,
              byService: Array.isArray(point.byService) ? point.byService : null,
            })),
          },
        };
      }
    );
  }

  /**
   * Resolved findings the latest analysis still detects, read through the
   * Cost Optimization page's own function (getHiddenFindings, the
   * GET /api/cost-recommendations/hidden source), never a copy of its rule.
   */
  getStillDetectedSection(organizationId: string): Promise<ContextSection<WeeklyStillDetectedEvidence>> {
    return collectSection<WeeklyStillDetectedEvidence>(
      { source: STILL_DETECTED_SOURCE, provenance: 'estimated' },
      async () => {
        const hidden = await this.costRecommendationsRepository.getHiddenFindings(organizationId);
        const still = hidden.items
          .filter(item => item.decision === 'RESOLVED' && item.detection.state === 'still_detected')
          .sort((a, b) => (b.detection.potentialSavings ?? 0) - (a.detection.potentialSavings ?? 0) || b.decidedAt.localeCompare(a.decidedAt));
        const first = still[0];
        const s = hidden.summary.stillDetected;
        return {
          state: 'available',
          data: {
            count: s.count,
            estimatedMonthlySavings: s.estimatedMonthlySavings,
            ceilingMonthlySavings: s.ceilingMonthlySavings,
            example: first
              ? { check: first.issueLabel, resource: first.resourceName || first.resourceId, region: first.awsRegion, resolvedAt: first.decidedAt }
              : null,
          },
        };
      }
    );
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
        // The score's counts combine every status-active account-level finding
        // with the per-resource compliance issues
        // (RiskTrackingService.combineSeverityCounts), so the resource count is
        // the exact difference. Open account findings are the Security page's:
        // derived status active or acknowledged (founder Q5).
        const c = risk.complianceIssueCounts;
        const combined = c.critical + c.high + c.medium + c.low;
        const open = active.filter(f => f.derived_status === 'active' || f.derived_status === 'acknowledged').length;
        return {
          state: 'available',
          data: {
            ...(scoreOnPlan ? { score: risk.score } : {}),
            accountLevelFindings: open,
            resourceComplianceIssues: Math.max(0, combined - active.length),
          },
        };
      }
    );
  }

  /**
   * Every organization owner who receives the weekly summary (WE-D7): each
   * active, joined, opted-in owner with a verified email, by the same
   * predicates as getActiveOrganizationsPage() (WEEKLY_SUMMARY_RECIPIENT_PREDICATES).
   * An owner who opted out, is unverified, was deactivated or soft-deleted,
   * or has only a pending (unaccepted) invitation is never included -- on
   * the scheduled path or the manual trigger -- and admins and members never
   * are. A soft-deleted organization has none. Ordered by membership (the
   * earliest first, then user id), so a run is deterministic. Empty when no
   * owner is eligible (the org is skipped, never sent to a fallback); a
   * query failure throws.
   */
  async getRecipients(organizationId: string, client?: PoolClient): Promise<UserInfo[]> {
    const result = await (client ?? this.pool).query(
      `SELECT u.id, u.email, u.full_name
       FROM users u
       JOIN organization_memberships om ON u.id = om.user_id
       JOIN organizations o ON o.id = om.organization_id
       WHERE om.organization_id = $1
         AND ${WEEKLY_SUMMARY_RECIPIENT_PREDICATES}
       ORDER BY om.created_at ASC NULLS LAST, u.id ASC`,
      [organizationId]
    );

    return result.rows.map(row => ({ userId: row.id, email: row.email, fullName: row.full_name }));
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
   * One page of the organizations with at least one eligible weekly-summary
   * recipient (the predicates getRecipients() applies), in id order after
   * `afterId` (null for the first page). Keyset paging on the primary key is
   * a stable order: an organization is visited once per run, and one that
   * joins or leaves mid-run never shifts another across a page boundary.
   * A page shorter than `pageSize` is the last. The page size is clamped to
   * 1..WEEKLY_SUMMARY_MAX_PAGE_SIZE.
   */
  async getActiveOrganizationsPage(afterId: string | null, pageSize: number = WEEKLY_SUMMARY_ORG_PAGE_SIZE): Promise<string[]> {
    const limit = Math.min(Math.max(Math.trunc(pageSize) || 1, 1), WEEKLY_SUMMARY_MAX_PAGE_SIZE);
    const result = await this.pool.query(
      `SELECT DISTINCT o.id
       FROM organizations o
       JOIN organization_memberships om ON o.id = om.organization_id
       JOIN users u ON om.user_id = u.id
       WHERE ${WEEKLY_SUMMARY_RECIPIENT_PREDICATES}
         AND ($1::uuid IS NULL OR o.id > $1::uuid)
       ORDER BY o.id ASC
       LIMIT $2`,
      [afterId, limit]
    );

    return result.rows.map(r => String(r.id));
  }

  /**
   * Runs `work` on one connection tagged for this organization
   * (session-scoped, so every statement on it carries the tag), then
   * releases it; the pool clears the tag on release (installTenantTagReset).
   * The scheduled send and the preview both read through this, so the two
   * see the same rows under row level security.
   */
  async withOrganizationClient<T>(organizationId: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query(
        "SELECT set_config('app.current_organization_id', $1, false)",
        [organizationId]
      );
      return await work(client);
    } finally {
      client.release();
    }
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
    const countResult = await this.onOrgClient(query.organizationId, client, db => db.query(
      `SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'success') as success,
        COUNT(*) FILTER (WHERE status = 'failed') as failed
       FROM deployments
       WHERE organization_id = $1
         AND deployed_at BETWEEN $2 AND $3`,
      [query.organizationId, query.startDate, query.endDate]
    ));

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
