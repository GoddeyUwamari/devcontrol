/**
 * AI Chat Context Repository
 * Gathers the AI Assistant's context: each source becomes a section that
 * carries its own state, source, as-of, scope, and coverage
 * (see services/ai-context-contract.ts).
 */

import { Pool } from 'pg';
import {
  COMPARISON_BASIS,
  type ChatContext,
  type ContextDataState,
  type CostComparison,
  type CostExplorerScope,
  type InventoryResources,
  type InventoryScope,
} from '../services/ai-chat.service';
import { collectSection, notSupported, type ContextSection } from '../services/ai-context-contract';
import awsCostService, { MonthlyCost } from '../services/aws-cost.service';
import { DORAMetricsRepository } from './dora-metrics.repository';
import { DORAMetricsService } from '../services/dora-metrics.service';
import { AWSResourcesRepository } from './awsResources.repository';

const INVENTORY_SOURCE = 'DevControl resource inventory (periodic AWS discovery)';

// alert_history's only writer (the Prometheus alert sync) stores no
// organization_id, so org-scoped reads can never see its rows (see
// AlertHistoryRepository.create()). Until that is fixed, "0 alerts" would be
// a fabricated fact -- the section is not_supported instead.
const ALERTS_NOT_SUPPORTED_REASON =
  "Organization-scoped alert data is not connected to the assistant: DevControl's alert sync does not yet associate alerts with an organization, so this account's alert counts cannot be determined.";

// The former cost_spike query was a fixed spend threshold over inventory
// estimates, not anomaly detection; anomaly_detections is not wired in yet.
const ANOMALIES_NOT_SUPPORTED_REASON = "No anomaly detection is connected to the assistant's context.";

// No source writes a CPU figure into aws_resources (the old query read a
// tags->>'cpu_utilization' key nothing sets), so "0 underutilized" was never a measurement.
const EC2_UTILIZATION_NOT_SUPPORTED_REASON = 'DevControl does not collect EC2 CPU utilization into the resource inventory.';

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
    asOf: null,
    basis: COMPARISON_BASIS,
  };
}

export class AIChatContextRepository {
  private doraMetricsService: DORAMetricsService;
  private awsResourcesRepository: AWSResourcesRepository;

  constructor(private pool: Pool) {
    this.doraMetricsService = new DORAMetricsService(new DORAMetricsRepository(pool), pool);
    this.awsResourcesRepository = new AWSResourcesRepository(pool);
  }

  /**
   * Gather complete context for AI chat
   */
  async gatherContext(organizationId: string): Promise<ChatContext> {
    console.log(`[AI Chat Context] Gathering context for org: ${organizationId}`);

    // Fetched up front (not inside the Promise.all below) because the
    // inventory sections and getCostData's estimated-fallback branch need
    // them too -- one query each, reused, rather than a second identical lookup.
    const [discovery, account] = await Promise.all([
      this.getDiscoveryFreshness(organizationId),
      this.getConnectedAccount(organizationId),
    ]);

    // Discovery's real scope: AWSClientFactory.createClients() reads this same
    // row and falls back to 'us-east-1' when region is null. No connected
    // account row (or a failed lookup) means the scope is unknown -- not a guess;
    // `account.state` says which.
    const connectedAccount = account.data;
    const inventoryScope: InventoryScope = {
      kind: 'resource_inventory',
      connectedAccountId: connectedAccount?.accountId ?? null,
      discoveryRegion: connectedAccount ? (connectedAccount.region ?? 'us-east-1') : null,
    };

    const [costs, resources, services, dora] = await Promise.all([
      this.getCostData(organizationId, discovery.data?.completedAt ?? null, connectedAccount?.accountId ?? null, inventoryScope),
      this.getResourceData(organizationId, discovery, inventoryScope),
      this.getServices(organizationId, discovery, inventoryScope),
      this.getDORAMetrics(organizationId),
    ]);
    const alerts = notSupported<NonNullable<ChatContext['alerts']['data']>>({ source: 'DevControl alert history' }, ALERTS_NOT_SUPPORTED_REASON);
    const anomalies = notSupported<NonNullable<ChatContext['anomalies']['data']>>({ source: 'DevControl anomaly detection' }, ANOMALIES_NOT_SUPPORTED_REASON);

    console.log(`[AI Chat Context] Context gathered: services ${services.state}, resources ${resources.state}, dora ${dora.state}, cost state ${costs.state} (source: ${costs.source})`);

    return {
      discovery,
      account,
      services,
      costs,
      inventoryScope,
      resources,
      alerts,
      anomalies,
      dora,
    };
  }

  /**
   * Latest successful (status = 'completed') discovery run's completion
   * timestamp for this organization -- reuses the existing discovery-job
   * repository/table (AWSResourcesRepository.getLatestDiscoveryJob(),
   * resource_discovery_jobs; see database/migrations-admin/008_create_aws_resources.sql)
   * rather than a second discovery mechanism or a manufactured timestamp.
   *
   * 'unavailable' (never a fabricated/guessed timestamp) when the most recent
   * row isn't itself a completed run -- e.g. it's still 'running' or ended
   * 'failed' -- or no discovery job has ever run; 'error' when the lookup fails.
   */
  private getDiscoveryFreshness(organizationId: string): Promise<ChatContext['discovery']> {
    return collectSection<{ completedAt: string }>({ source: 'DevControl resource discovery runs' }, async () => {
      const job = await this.awsResourcesRepository.getLatestDiscoveryJob(organizationId);
      if (job && job.status === 'completed' && job.completed_at) {
        const completedAt = new Date(job.completed_at).toISOString();
        return { state: 'available', data: { completedAt }, asOf: completedAt };
      }
      return {
        state: 'unavailable',
        reason: job ? `the latest discovery run has not completed (status: ${job.status})` : 'no discovery run has ever run for this account',
      };
    });
  }

  /**
   * The org's connected AWS account row -- the same row (org_id is UNIQUE on
   * aws_accounts, and this query mirrors AWSClientFactory.createClients()'s
   * own lookup) that both discovery and Cost Explorer assume a role from.
   * Carries no account-type metadata: aws_accounts stores none, and DevControl
   * does not detect management/payer/member status. 'unavailable' when there
   * is no row, 'error' when the lookup fails -- never a fabricated ID or region.
   */
  private getConnectedAccount(organizationId: string): Promise<ChatContext['account']> {
    return collectSection<{ accountId: string | null; region: string | null }>({ source: 'DevControl connected AWS account record' }, async () => {
      const { rows } = await this.pool.query(
        `SELECT account_id, region FROM aws_accounts WHERE org_id = $1 LIMIT 1`,
        [organizationId]
      );
      if (rows.length === 0) return { state: 'unavailable', reason: 'no AWS account is connected' };
      return { state: 'available', data: { accountId: rows[0].account_id ?? null, region: rows[0].region ?? null } };
    });
  }

  /**
   * An inventory read (aws_resources) as a section. A failing query is
   * 'error'. A result is only 'available' (and an empty one only a confirmed
   * zero) once the latest discovery run has completed. Otherwise an empty
   * result is 'unavailable', not "none", and existing rows are 'partial' --
   * kept, but possibly stale or incomplete.
   */
  private inventorySection<T>(
    discovery: ChatContext['discovery'],
    inventoryScope: InventoryScope,
    coverage: string | null,
    isEmpty: (data: T) => boolean,
    query: () => Promise<T>
  ): Promise<ContextSection<T>> {
    return collectSection<T>({ source: INVENTORY_SOURCE, scope: inventoryScope, coverage }, async () => {
      const data = await query();
      if (discovery.state === 'available' && discovery.data) {
        return { state: 'available', data, asOf: discovery.data.completedAt };
      }
      const discoveryProblem = discovery.state === 'error'
        ? 'The status of the latest discovery run could not be determined'
        : 'Latest discovery run is incomplete';
      if (isEmpty(data)) {
        return { state: 'unavailable', reason: `${discoveryProblem}, so an empty inventory is not a confirmed zero` };
      }
      return { state: 'partial', data, asOf: null, reason: `${discoveryProblem}; inventory data may be stale or incomplete.` };
    });
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
    costTrend: Array<{ date: string; total: number }>,
    asOf: string | null = null
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
        asOf,
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
      asOf,
      basis: COMPARISON_BASIS,
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
        comparison = this.computeMonthOverMonthComparison(costTrend, awsCostService.getCostTrendFetchedAt(organizationId, '90d'));
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
   * EC2/RDS/Lambda counts from the resource inventory. Every count is explicit,
   * including a real 0; a failed query is 'error', never {} or "no resources".
   */
  private getResourceData(
    organizationId: string,
    discovery: ChatContext['discovery'],
    inventoryScope: InventoryScope
  ): Promise<ChatContext['resources']> {
    const isEmpty = (r: InventoryResources) => r.ec2.count === 0 && r.rds.count === 0 && r.lambda.count === 0;
    return this.inventorySection<InventoryResources>(discovery, inventoryScope, 'EC2, RDS, and Lambda resources only', isEmpty, async () => {
      // Current infrastructure context — excludes soft-terminated resources so the
      // AI never describes something as part of "your infrastructure" that AWS no
      // longer has (see resourceReconciliation.service.ts).
      const ec2Query = `
        SELECT COUNT(*) as total
        FROM aws_resources
        WHERE organization_id = $1
        AND resource_type = 'ec2'
        AND status != 'terminated'
      `;

      // estimated_monthly_cost is DevControl's list-price estimate for the whole
      // database -- only summed over the rows that actually carry one.
      const rdsQuery = `
        SELECT
          COUNT(*) as total,
          COUNT(estimated_monthly_cost) as estimated_count,
          SUM(estimated_monthly_cost) as estimated_cost
        FROM aws_resources
        WHERE organization_id = $1
        AND resource_type = 'rds'
        AND status != 'terminated'
      `;

      // invocations is summed from metadata->>'invocations_30d' -- the real
      // 30-day CloudWatch usage figure discovery persists per function (see
      // awsResourceDiscovery.ts::discoverLambdaFunctions() and
      // lambda-usage.util.ts). known_for_count is how many functions actually
      // have that key set -- a per-function CloudWatch failure at discovery time
      // leaves it unset (not 0) for that one function, and callers must not
      // present the sum as a complete total when known_for_count < total.
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

      const rdsEstimatedCount = parseInt(rdsResult.rows[0]?.estimated_count ?? '0', 10);
      return {
        ec2: {
          count: parseInt(ec2Result.rows[0]?.total ?? '0', 10),
          utilization: notSupported<{ underutilized: number }>({ source: 'EC2 CPU utilization' }, EC2_UTILIZATION_NOT_SUPPORTED_REASON),
        },
        rds: {
          count: parseInt(rdsResult.rows[0]?.total ?? '0', 10),
          estimatedMonthlyCost: rdsEstimatedCount > 0 ? roundCents(parseFloat(rdsResult.rows[0].estimated_cost)) : null,
          estimatedForCount: rdsEstimatedCount,
        },
        lambda: {
          count: parseInt(lambdaResult.rows[0]?.total ?? '0', 10),
          invocations: parseInt(lambdaResult.rows[0]?.invocations ?? '0', 10),
          invocationsKnownForCount: parseInt(lambdaResult.rows[0]?.known_for_count ?? '0', 10),
        },
      };
    });
  }

  /**
   * Distinct discovered resource types. An empty list is only "none" once a
   * discovery run has completed; a failed query is 'error', never [].
   */
  private getServices(
    organizationId: string,
    discovery: ChatContext['discovery'],
    inventoryScope: InventoryScope
  ): Promise<ChatContext['services']> {
    return this.inventorySection<string[]>(discovery, inventoryScope, null, types => types.length === 0, async () => {
      const result = await this.pool.query(
        `SELECT DISTINCT resource_type
         FROM aws_resources
         WHERE organization_id = $1
         AND resource_type IS NOT NULL
         AND status != 'terminated'
         ORDER BY resource_type`,
        [organizationId]
      );
      return result.rows.map(row => row.resource_type as string);
    });
  }

  /**
   * DORA metrics.
   * Reuses DORAMetricsService — the same real, working computation behind
   * GET /api/metrics/dora — instead of querying a `dora_metrics` table that
   * has never existed in any migration. DORA here is computed live from the
   * real `deployments` table, not read from a persisted snapshot, so asOf is
   * the moment it was computed. No deployments in the window is 'unavailable'
   * and a failed computation is 'error' -- never an omitted section.
   */
  private getDORAMetrics(organizationId: string): Promise<ChatContext['dora']> {
    return collectSection<NonNullable<ChatContext['dora']['data']>>({
      source: 'DevControl deployment records',
      scope: { kind: 'organization', window: 'last 30 days' },
      coverage: 'deployments and incidents recorded in DevControl for this organization; deployments made outside DevControl are not included',
    }, async () => {
      const asOf = new Date().toISOString();
      const metrics = await this.doraMetricsService.getComprehensiveMetrics({
        organizationId,
        dateRange: '30d',
      });

      // deploymentsPerDay is 0 only when totalDeployments is 0 — no deployment
      // history at all in this window, so there's genuinely nothing to report
      // rather than a real measured zero across every metric.
      if (metrics.deploymentFrequency.value === 0) {
        return { state: 'unavailable', reason: 'no deployments were recorded for this organization in the last 30 days', asOf };
      }

      return {
        state: 'available',
        asOf,
        data: {
          deploymentFrequency: metrics.deploymentFrequency.description
            ?? `${metrics.deploymentFrequency.value} ${metrics.deploymentFrequency.unit}`,
          // Carries the metric's own description: DORAMetricsService measures the
          // average gap between consecutive deployments, not commit-to-deploy time,
          // and the model must not restate it as the latter.
          leadTime: `${metrics.leadTime.value} ${metrics.leadTime.unit}${metrics.leadTime.description ? ` (${metrics.leadTime.description})` : ''}`,
          mttr: `${metrics.mttr.value} ${metrics.mttr.unit}${metrics.mttr.description ? ` (${metrics.mttr.description})` : ''}`,
        },
      };
    });
  }
}
