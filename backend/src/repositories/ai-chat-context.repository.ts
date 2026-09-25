/**
 * AI Chat Context Repository
 * Gathers real-time AWS context for AI chat interactions
 */

import { Pool } from 'pg';
import type {
  ChatContext,
  ContextDataState,
  CostComparison,
  CostExplorerScope,
  InventoryScope,
} from '../services/ai-chat.service';
import awsCostService, { MonthlyCost } from '../services/aws-cost.service';
import { AlertHistoryRepository } from './alert-history.repository';
import { DORAMetricsRepository } from './dora-metrics.repository';
import { DORAMetricsService } from '../services/dora-metrics.service';
import { AWSResourcesRepository } from './awsResources.repository';

/** Whole cents -- the unit every displayed money figure (and any arithmetic between them) is done in. */
function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/** Cents precision -- never whole-dollar rounding, which turns a real sub-dollar figure into a "$0". */
function roundCents(amount: number): number {
  return toCents(amount) / 100;
}

/** A comparison with no figures -- its state and note say why. */
function emptyComparison(state: ContextDataState, note: string): CostComparison {
  return {
    state,
    note,
    currentWindow: null,
    previousWindow: null,
    currentWindowTotal: null,
    previousWindowTotal: null,
    changeAmount: null,
    changePercent: null,
    coverage: null,
    currentWindowIncludesToday: false,
  };
}

export class AIChatContextRepository {
  private alertHistoryRepository: AlertHistoryRepository;
  private doraMetricsService: DORAMetricsService;
  private awsResourcesRepository: AWSResourcesRepository;

  constructor(private pool: Pool) {
    this.alertHistoryRepository = new AlertHistoryRepository(pool);
    this.doraMetricsService = new DORAMetricsService(new DORAMetricsRepository(pool), pool);
    this.awsResourcesRepository = new AWSResourcesRepository(pool);
  }

  /**
   * Gather complete context for AI chat
   */
  async gatherContext(organizationId: string): Promise<ChatContext> {
    console.log(`[AI Chat Context] Gathering context for org: ${organizationId}`);

    // Fetched up front (not inside the Promise.all below) because getCostData's
    // estimated-fallback branch needs them too -- one query each, reused,
    // rather than a second identical lookup.
    const [resourceDataAsOf, connectedAccount] = await Promise.all([
      this.getDiscoveryFreshness(organizationId),
      this.getConnectedAccount(organizationId),
    ]);

    // Discovery's real scope: AWSClientFactory.createClients() reads this same
    // row and falls back to 'us-east-1' when region is null. No connected
    // account row (or a failed lookup) means the scope is unknown -- not a guess.
    const inventoryScope: InventoryScope = {
      kind: 'resource_inventory',
      connectedAccountId: connectedAccount?.accountId ?? null,
      discoveryRegion: connectedAccount ? (connectedAccount.region ?? 'us-east-1') : null,
    };

    const [costs, resources, alerts, services, anomalies, dora] = await Promise.all([
      this.getCostData(organizationId, resourceDataAsOf, connectedAccount?.accountId ?? null, inventoryScope),
      this.getResourceData(organizationId),
      this.getAlertData(organizationId),
      this.getServices(organizationId),
      this.getAnomalies(organizationId),
      this.getDORAMetrics(organizationId),
    ]);

    console.log(`[AI Chat Context] Context gathered: ${services.length} services, cost state ${costs.state} (source: ${costs.source})`);

    return {
      services,
      costs,
      inventoryScope,
      resources,
      alerts,
      anomalies,
      dora,
      timeRange: 'Last 30 days',
      resourceDataAsOf,
    };
  }

  /**
   * Latest successful (status = 'completed') discovery run's completion
   * timestamp for this organization -- reuses the existing discovery-job
   * repository/table (AWSResourcesRepository.getLatestDiscoveryJob(),
   * resource_discovery_jobs; see database/migrations-admin/008_create_aws_resources.sql)
   * rather than a second discovery mechanism or a manufactured timestamp.
   *
   * Deliberately returns null (never a fabricated/guessed value) when the
   * most recent row isn't itself a completed run -- e.g. it's still
   * 'running' or ended 'failed' -- since that row's completed_at is either
   * absent or would misrepresent an unfinished/failed attempt as fresh data.
   * Also null if no discovery job has ever run for this org at all.
   */
  private async getDiscoveryFreshness(organizationId: string): Promise<string | null> {
    try {
      const job = await this.awsResourcesRepository.getLatestDiscoveryJob(organizationId);
      if (job && job.status === 'completed' && job.completed_at) {
        return new Date(job.completed_at).toISOString();
      }
      return null;
    } catch (error: any) {
      console.error('[AI Chat Context] Error getting discovery freshness:', error.message);
      return null;
    }
  }

  /**
   * The org's connected AWS account row -- the same row (org_id is UNIQUE on
   * aws_accounts, and this query mirrors AWSClientFactory.createClients()'s
   * own lookup) that both discovery and Cost Explorer assume a role from.
   * Carries no account-type metadata: aws_accounts stores none, and DevControl
   * does not detect management/payer/member status. Returns null -- never a
   * fabricated ID or region -- when there is no row or the lookup fails.
   */
  private async getConnectedAccount(
    organizationId: string
  ): Promise<{ accountId: string | null; region: string | null } | null> {
    try {
      const { rows } = await this.pool.query(
        `SELECT account_id, region FROM aws_accounts WHERE org_id = $1 LIMIT 1`,
        [organizationId]
      );
      if (rows.length === 0) return null;
      return { accountId: rows[0].account_id ?? null, region: rows[0].region ?? null };
    } catch (error: any) {
      console.error('[AI Chat Context] Error getting connected AWS account:', error.message);
      return null;
    }
  }

  /**
   * Real month-over-month spend comparison — same algorithm and same underlying
   * data (awsCostService.fetchCostTrend) as the Dashboard's
   * computeMonthOverMonthCostChange() in app/(app)/dashboard/page.tsx. That
   * function can't be imported directly: it's a private helper inside a Next.js
   * page component in the frontend workspace, and this backend has its own
   * separate tsconfig rootDir (backend/src) with no shared package boundary to
   * the frontend app/ tree — so it's ported here verbatim against the same real
   * Cost Explorer trend data both surfaces already read from, rather than
   * re-derived independently.
   *
   * Returns the comparison with its own state rather than a bare number: the
   * same 80%-of-days coverage threshold decides 'unavailable' (never a
   * fabricated previous figure or 0% change), fewer days than the windows span
   * is 'partial', and a previous window totalling $0 is still a real
   * comparison whose percentage is undefined (null), not 0.
   *
   * The change is derived from the two window totals as displayed (whole
   * cents), not from the unrounded sums -- otherwise e.g. $14.83 vs $14.33
   * could report a $0.51 change the reader can't reproduce from the figures.
   *
   * Like the Dashboard, the current window runs through today, which Cost
   * Explorer has not finished billing, while the previous window's days are
   * complete. That is kept (so both surfaces agree) but flagged via
   * currentWindowIncludesToday rather than presented as like-for-like days.
   */
  private computeMonthOverMonthComparison(
    costTrend: Array<{ date: string; total: number }>
  ): CostComparison {
    const now = new Date();
    const curYear = now.getFullYear();
    const curMonth = now.getMonth();
    const dayOfMonth = now.getDate();
    const lastMonth = curMonth === 0 ? 11 : curMonth - 1;
    const lastMonthYear = curMonth === 0 ? curYear - 1 : curYear;
    const daysInLastMonth = new Date(curYear, curMonth, 0).getDate();

    const isoDate = (year: number, monthIndex: number, day: number) =>
      `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const expectedCurrentDays = dayOfMonth;
    const expectedPreviousDays = Math.min(dayOfMonth, daysInLastMonth);
    const currentWindow = { start: isoDate(curYear, curMonth, 1), end: isoDate(curYear, curMonth, dayOfMonth) };
    const previousWindow = { start: isoDate(lastMonthYear, lastMonth, 1), end: isoDate(lastMonthYear, lastMonth, expectedPreviousDays) };

    let currentSum = 0, currentDays = 0;
    let lastSum = 0, lastDays = 0;

    for (const entry of costTrend ?? []) {
      const [y, m, d] = entry.date.split('-').map(Number);
      const month = m - 1;
      if (y === curYear && month === curMonth && d <= dayOfMonth) {
        currentSum += entry.total;
        currentDays++;
      } else if (y === lastMonthYear && month === lastMonth && d <= dayOfMonth) {
        lastSum += entry.total;
        lastDays++;
      }
    }

    const coverage = { currentDays, previousDays: lastDays, expectedCurrentDays, expectedPreviousDays };
    const minDays = Math.max(1, Math.floor(dayOfMonth * 0.8));
    if (currentDays < minDays || lastDays < minDays) {
      return {
        ...emptyComparison('unavailable', `not enough daily Cost Explorer data to compare (at least ${minDays} days needed in each window)`),
        currentWindow,
        previousWindow,
        coverage,
        currentWindowIncludesToday: true,
      };
    }

    const currentCents = toCents(currentSum);
    const previousCents = toCents(lastSum);
    const changeCents = currentCents - previousCents;
    const partial = currentDays < expectedCurrentDays || lastDays < expectedPreviousDays;
    return {
      state: partial ? 'partial' : 'available',
      note: partial ? 'some days in the compared windows have no daily Cost Explorer data' : null,
      currentWindow,
      previousWindow,
      currentWindowTotal: currentCents / 100,
      previousWindowTotal: previousCents / 100,
      changeAmount: changeCents / 100,
      changePercent: previousCents > 0 ? Math.round((changeCents / previousCents) * 1000) / 10 : null,
      coverage,
      currentWindowIncludesToday: true,
    };
  }

  /**
   * Get cost data.
   * Reuses awsCostService.fetchMonthlyCosts() — the same live-Cost-Explorer-or-
   * cached call that powers the Dashboard and AISummaryService — instead of
   * re-deriving spend from aws_resources with a second, independently-maintained
   * query. The previous-period comparison reuses awsCostService.fetchCostTrend()
   * at the same '90d' range the Dashboard requests, via
   * computeMonthOverMonthComparison() above.
   *
   * Every outcome carries an explicit state, and a failure is never a number:
   *   - Cost Explorer succeeded: 'actual', including a real $0 or a
   *     net-negative (credit) total -- a successful result is billing data
   *     whatever its value. Scope is the connected role's billing scope,
   *     not-region-filtered, consolidation unknown (see CostExplorerScope).
   *   - Cost Explorer unavailable/failed, but aws_resources carries estimates:
   *     'estimated', with inventory scope and coverage -- the same DB fallback
   *     the Dashboard uses. costExplorer.state still records why Cost Explorer
   *     wasn't used.
   *   - Neither: current is null, state 'error' if either attempt failed,
   *     'unavailable' otherwise.
   */
  private async getCostData(
    organizationId: string,
    discoveryAsOf: string | null,
    connectedAccountId: string | null,
    inventoryScope: InventoryScope
  ): Promise<ChatContext['costs']> {
    let monthlyCost: MonthlyCost | null = null;
    let costExplorer: ChatContext['costs']['costExplorer'];
    try {
      monthlyCost = await awsCostService.fetchMonthlyCosts(organizationId);
      costExplorer = Number.isFinite(monthlyCost?.total)
        ? { state: 'available', reason: null }
        : { state: 'error', reason: 'Cost Explorer returned no usable total' };
    } catch (error: any) {
      console.error('[AI Chat Context] Error getting live cost data:', error.message);
      // AWSCostService.createForOrg() throws AWS_NOT_CONNECTED when the org has
      // no active aws_accounts row -- nothing to query, not a failed query.
      costExplorer = String(error?.message ?? '').startsWith('AWS_NOT_CONNECTED')
        ? { state: 'unavailable', reason: 'no connected AWS account' }
        : { state: 'error', reason: 'the Cost Explorer request failed' };
    }

    if (monthlyCost && costExplorer.state === 'available') {
      let comparison: CostComparison;
      try {
        const costTrend = await awsCostService.fetchCostTrend(organizationId, '90d');
        comparison = this.computeMonthOverMonthComparison(costTrend);
      } catch (error: any) {
        console.error('[AI Chat Context] Error getting cost trend:', error.message);
        comparison = emptyComparison('error', 'the Cost Explorer daily trend request failed');
      }

      const total = monthlyCost.total;
      const topSpenders = [...monthlyCost.byService]
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5)
        .map(item => ({
          service: item.service,
          cost: roundCents(item.amount),
          // A share of a zero or net-negative total is meaningless -- null, not 0.
          percentage: total > 0 ? (item.amount / total) * 100 : null,
        }));

      const scope: CostExplorerScope = {
        kind: 'cost_explorer',
        connectedAccountId,
        linkedAccountFilter: 'none',
        consolidatedBilling: 'unknown',
        regions: 'all',
      };

      return {
        state: 'available',
        source: 'actual',
        current: roundCents(total),
        asOf: monthlyCost.fetchedAt ?? null,
        period: { start: monthlyCost.period.start, endExclusive: monthlyCost.period.end },
        scope,
        topSpenders,
        costExplorer,
        estimateCoverage: null,
        comparison,
      };
    }

    const noCurrentPeriod = emptyComparison('unavailable', 'no Cost Explorer data for the current period, so there is nothing to compare');

    // Cost Explorer unavailable or failed -- fall back to the same DB estimate
    // stats.controller.ts's getDashboardStats() already uses, labeled as an
    // estimate with its own inventory scope and coverage.
    let estimateState: ContextDataState;
    try {
      const { rows } = await this.pool.query(
        `SELECT COUNT(*) AS total_resources,
                COUNT(estimated_monthly_cost) AS estimated_resources,
                SUM(estimated_monthly_cost) AS total
         FROM aws_resources
         WHERE organization_id = $1 AND status != 'terminated'`,
        [organizationId]
      );
      const totalResources = parseInt(rows[0]?.total_resources ?? '0', 10);
      const estimatedResources = parseInt(rows[0]?.estimated_resources ?? '0', 10);

      if (estimatedResources > 0) {
        return {
          state: estimatedResources < totalResources ? 'partial' : 'available',
          source: 'estimated',
          current: roundCents(parseFloat(rows[0].total)),
          asOf: discoveryAsOf,
          period: null,
          scope: inventoryScope,
          topSpenders: null,
          costExplorer,
          estimateCoverage: { estimatedResources, totalResources },
          comparison: noCurrentPeriod,
        };
      }
      estimateState = 'unavailable';
    } catch (error: any) {
      console.error('[AI Chat Context] Error getting cost estimate fallback:', error.message);
      estimateState = 'error';
    }

    // Neither a Cost Explorer result nor a DB estimate exists -- no figure at all.
    return {
      state: costExplorer.state === 'error' || estimateState === 'error' ? 'error' : 'unavailable',
      source: 'unavailable',
      current: null,
      asOf: null,
      period: null,
      scope: null,
      topSpenders: null,
      costExplorer,
      estimateCoverage: null,
      comparison: noCurrentPeriod,
    };
  }

  /**
   * Get resource data
   */
  private async getResourceData(organizationId: string): Promise<ChatContext['resources']> {
    try {
      // Current infrastructure context — excludes soft-terminated resources so the
      // AI never describes something as part of "your infrastructure" that AWS no
      // longer has (see resourceReconciliation.service.ts).

      // EC2 instances
      const ec2Query = `
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (
            WHERE tags->>'cpu_utilization' IS NOT NULL
            AND (tags->>'cpu_utilization')::numeric < 20
          ) as underutilized
        FROM aws_resources
        WHERE organization_id = $1
        AND resource_type = 'ec2'
        AND status != 'terminated'
      `;

      // RDS databases
      const rdsQuery = `
        SELECT
          COUNT(*) as total,
          SUM(COALESCE(estimated_monthly_cost, 0)) as storage_cost
        FROM aws_resources
        WHERE organization_id = $1
        AND resource_type = 'rds'
        AND status != 'terminated'
      `;

      // Lambda functions.
      // invocations is summed from metadata->>'invocations_30d' -- the real
      // 30-day CloudWatch usage figure discovery now persists per function
      // (see awsResourceDiscovery.ts::discoverLambdaFunctions() and
      // lambda-usage.util.ts). This replaces a prior query that summed
      // tags->>'invocations', a key nothing ever wrote, so it always
      // evaluated to a confident 0 regardless of real usage.
      // known_for_count is how many functions actually have that key set --
      // a per-function CloudWatch failure at discovery time leaves it unset
      // (not 0) for that one function, and callers must not present the sum
      // as a complete total when known_for_count < total.
      const lambdaQuery = `
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE metadata ? 'invocations_30d') as known_for_count,
          COALESCE(SUM((metadata->>'invocations_30d')::bigint), 0) as invocations
        FROM aws_resources
        WHERE organization_id = $1
        AND resource_type = 'lambda'
        AND status != 'terminated'
      `;

      const [ec2Result, rdsResult, lambdaResult] = await Promise.all([
        this.pool.query(ec2Query, [organizationId]),
        this.pool.query(rdsQuery, [organizationId]),
        this.pool.query(lambdaQuery, [organizationId]),
      ]);

      const resources: ChatContext['resources'] = {};

      const ec2Count = parseInt(ec2Result.rows[0]?.total || 0);
      if (ec2Count > 0) {
        resources.ec2 = {
          count: ec2Count,
          underutilized: parseInt(ec2Result.rows[0]?.underutilized || 0),
        };
      }

      const rdsCount = parseInt(rdsResult.rows[0]?.total || 0);
      if (rdsCount > 0) {
        resources.rds = {
          count: rdsCount,
          storageCost: Math.round(parseFloat(rdsResult.rows[0]?.storage_cost || 0)),
        };
      }

      const lambdaCount = parseInt(lambdaResult.rows[0]?.total || 0);
      if (lambdaCount > 0) {
        resources.lambda = {
          count: lambdaCount,
          invocations: parseInt(lambdaResult.rows[0]?.invocations || 0),
          invocationsKnownForCount: parseInt(lambdaResult.rows[0]?.known_for_count || 0),
        };
      }

      return resources;
    } catch (error: any) {
      console.error('[AI Chat Context] Error getting resource data:', error.message);
      return {};
    }
  }

  /**
   * Get alert data.
   * Reuses AlertHistoryRepository — the same real, working repository behind
   * the authenticated alert-history routes — instead of a second, independently
   * broken query against a `title` column that doesn't exist (real column:
   * alert_name) and a `status = 'active'` filter that never matches any row
   * (real status values: 'firing' | 'acknowledged' | 'resolved' — "active"
   * means status = 'firing', per AlertHistoryRepository.getStats()).
   */
  private async getAlertData(organizationId: string): Promise<ChatContext['alerts']> {
    try {
      const [totalResult, criticalResult, recentResult] = await Promise.all([
        this.alertHistoryRepository.findAll({ organizationId, status: 'firing', limit: 1 }),
        this.alertHistoryRepository.findAll({ organizationId, status: 'firing', severity: 'critical', limit: 1 }),
        this.alertHistoryRepository.findAll({ organizationId, status: 'firing', limit: 3 }),
      ]);

      return {
        total: totalResult.total,
        critical: criticalResult.total,
        recent: recentResult.alerts.map(a => a.alertName),
      };
    } catch (error: any) {
      console.error('[AI Chat Context] Error getting alert data:', error.message);
      return {
        total: 0,
        critical: 0,
        recent: [],
      };
    }
  }

  /**
   * Get services in use
   */
  private async getServices(organizationId: string): Promise<string[]> {
    try {
      const query = `
        SELECT DISTINCT resource_type
        FROM aws_resources
        WHERE organization_id = $1
        AND resource_type IS NOT NULL
        AND status != 'terminated'
        ORDER BY resource_type
      `;

      const result = await this.pool.query(query, [organizationId]);
      return result.rows.map(row => row.resource_type);
    } catch (error: any) {
      console.error('[AI Chat Context] Error getting services:', error.message);
      return [];
    }
  }

  /**
   * Get detected anomalies
   */
  private async getAnomalies(organizationId: string): Promise<ChatContext['anomalies']> {
    try {
      // Check for cost anomalies based on significant changes
      const anomalyQuery = `
        SELECT
          resource_type,
          SUM(estimated_monthly_cost) as current_cost,
          COUNT(*) as resource_count
        FROM aws_resources
        WHERE organization_id = $1
        AND estimated_monthly_cost > 100
        AND updated_at > NOW() - INTERVAL '14 days'
        AND status != 'terminated'
        GROUP BY resource_type
        HAVING SUM(estimated_monthly_cost) > 500
        ORDER BY current_cost DESC
        LIMIT 3
      `;

      const result = await this.pool.query(anomalyQuery, [organizationId]);

      return result.rows.map(row => ({
        type: 'cost_spike',
        service: row.resource_type,
        description: `${row.resource_count} resources with high spend`,
        impact: `$${Math.round(row.current_cost)}/month`,
      }));
    } catch (error: any) {
      console.log('[AI Chat Context] Anomaly detection skipped:', error.message);
      return [];
    }
  }

  /**
   * Get DORA metrics.
   * Reuses DORAMetricsService — the same real, working computation behind
   * GET /api/metrics/dora — instead of querying a `dora_metrics` table that
   * has never existed in any migration. DORA here is computed live from the
   * real `deployments` table, not read from a persisted snapshot.
   */
  private async getDORAMetrics(organizationId: string): Promise<ChatContext['dora'] | undefined> {
    try {
      const metrics = await this.doraMetricsService.getComprehensiveMetrics({
        organizationId,
        dateRange: '30d',
      });

      // deploymentsPerDay is 0 only when totalDeployments is 0 — no deployment
      // history at all in this window, so there's genuinely nothing to report
      // rather than a real measured zero across every metric.
      if (metrics.deploymentFrequency.value === 0) {
        return undefined;
      }

      return {
        deploymentFrequency: metrics.deploymentFrequency.description
          ?? `${metrics.deploymentFrequency.value} ${metrics.deploymentFrequency.unit}`,
        // Carries the metric's own description: DORAMetricsService measures the
        // average gap between consecutive deployments, not commit-to-deploy time,
        // and the model must not restate it as the latter.
        leadTime: `${metrics.leadTime.value} ${metrics.leadTime.unit}${metrics.leadTime.description ? ` (${metrics.leadTime.description})` : ''}`,
        mttr: `${metrics.mttr.value} ${metrics.mttr.unit}${metrics.mttr.description ? ` (${metrics.mttr.description})` : ''}`,
      };
    } catch (error: any) {
      console.error('[AI Chat Context] Error getting DORA metrics:', error.message);
      return undefined;
    }
  }
}
