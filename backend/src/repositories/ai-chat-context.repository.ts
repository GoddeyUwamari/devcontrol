/**
 * AI Chat Context Repository
 * Gathers real-time AWS context for AI chat interactions
 */

import { Pool } from 'pg';
import { ChatContext } from '../services/ai-chat.service';
import awsCostService, { MonthlyCost } from '../services/aws-cost.service';
import { AlertHistoryRepository } from './alert-history.repository';
import { DORAMetricsRepository } from './dora-metrics.repository';
import { DORAMetricsService } from '../services/dora-metrics.service';
import { AWSResourcesRepository } from './awsResources.repository';

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
    // estimated-fallback branch needs it too -- one query, reused, rather than
    // a second identical lookup.
    const resourceDataAsOf = await this.getDiscoveryFreshness(organizationId);

    const [costs, resources, alerts, services, anomalies, dora] = await Promise.all([
      this.getCostData(organizationId, resourceDataAsOf),
      this.getResourceData(organizationId),
      this.getAlertData(organizationId),
      this.getServices(organizationId),
      this.getAnomalies(organizationId),
      this.getDORAMetrics(organizationId),
    ]);

    console.log(`[AI Chat Context] Context gathered: ${services.length} services, $${costs.current} spend (source: ${costs.source})`);

    return {
      services,
      costs,
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
   * Real month-over-month spend comparison — same algorithm and same underlying
   * data (awsCostService.fetchCostTrend) as the Dashboard's
   * computeMonthOverMonthCostChange() in app/(app)/dashboard/page.tsx. That
   * function can't be imported directly: it's a private helper inside a Next.js
   * page component in the frontend workspace, and this backend has its own
   * separate tsconfig rootDir (backend/src) with no shared package boundary to
   * the frontend app/ tree — so it's ported here verbatim against the same real
   * Cost Explorer trend data both surfaces already read from, rather than
   * re-derived independently. Returns null — never a fabricated 0 — when there
   * isn't enough real daily coverage in either window to trust the comparison.
   */
  private computeMonthOverMonthChange(
    costTrend: Array<{ date: string; total: number }>
  ): { changePercent: number; previousTotal: number } | null {
    if (!costTrend || costTrend.length === 0) return null;

    const now = new Date();
    const curYear = now.getFullYear();
    const curMonth = now.getMonth();
    const dayOfMonth = now.getDate();
    const lastMonth = curMonth === 0 ? 11 : curMonth - 1;
    const lastMonthYear = curMonth === 0 ? curYear - 1 : curYear;

    let currentSum = 0, currentDays = 0;
    let lastSum = 0, lastDays = 0;

    for (const entry of costTrend) {
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

    const minDays = Math.max(1, Math.floor(dayOfMonth * 0.8));
    if (currentDays < minDays || lastDays < minDays || lastSum <= 0) return null;

    return {
      changePercent: Math.round(((currentSum - lastSum) / lastSum) * 1000) / 10,
      previousTotal: lastSum,
    };
  }

  /**
   * Get cost data.
   * Reuses awsCostService.fetchMonthlyCosts() — the same live-Cost-Explorer-or-
   * cached call that powers the Dashboard and AISummaryService — instead of
   * re-deriving spend from aws_resources with a second, independently-maintained
   * query. The previous-period comparison reuses awsCostService.fetchCostTrend()
   * at the same '90d' range the Dashboard requests, via
   * computeMonthOverMonthChange() above.
   *
   * Distinguishes three states, mirroring stats.controller.ts's
   * getDashboardStats() actual-vs-estimated logic exactly (same threshold,
   * same fallback query) rather than inventing a new definition:
   *   - 'actual': a real Cost Explorer result (fresh or served from
   *     awsCostService's own cache — monthlyCost.fetchedAt says which, see
   *     aws-cost.service.ts).
   *   - 'estimated': Cost Explorer returned nothing/failed, but aws_resources
   *     has a usable estimated_monthly_cost sum — the same DB fallback the
   *     Dashboard already uses. Its "as of" is the discovery job's freshness
   *     (discoveryAsOf), since that's what populated estimated_monthly_cost.
   *   - 'unavailable': neither exists. current/previous are 0 here, but that
   *     0 must never be read as confirmed spend — see formatContext() and
   *     getFallbackResponse() in ai-chat.service.ts, both of which branch on
   *     `source` before printing a dollar figure.
   */
  private async getCostData(
    organizationId: string,
    discoveryAsOf: string | null
  ): Promise<ChatContext['costs']> {
    let monthlyCost: MonthlyCost | null = null;
    try {
      monthlyCost = await awsCostService.fetchMonthlyCosts(organizationId);
    } catch (error: any) {
      console.error('[AI Chat Context] Error getting live cost data:', error.message);
    }

    if (monthlyCost && monthlyCost.total > 0) {
      const costTrend = await awsCostService.fetchCostTrend(organizationId, '90d').catch((error: any) => {
        console.error('[AI Chat Context] Error getting cost trend:', error.message);
        return [];
      });

      const topSpenders = [...monthlyCost.byService]
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5)
        .map(item => ({
          service: item.service,
          cost: Math.round(item.amount),
          percentage: monthlyCost!.total > 0 ? (item.amount / monthlyCost!.total) * 100 : 0,
        }));

      const monthOverMonth = this.computeMonthOverMonthChange(costTrend);

      return {
        current: Math.round(monthlyCost.total),
        previous: monthOverMonth ? Math.round(monthOverMonth.previousTotal) : Math.round(monthlyCost.total),
        changePercent: monthOverMonth ? monthOverMonth.changePercent : null,
        topSpenders,
        source: 'actual',
        asOf: monthlyCost.fetchedAt ?? null,
      };
    }

    // Cost Explorer returned nothing (or threw) -- fall back to the same
    // DB estimate stats.controller.ts's getDashboardStats() already uses,
    // rather than silently reporting a bare $0 as if it were confirmed spend.
    try {
      const estimateResult = await this.pool.query(
        `SELECT COALESCE(SUM(estimated_monthly_cost), 0) as total FROM aws_resources WHERE organization_id = $1 AND status != 'terminated'`,
        [organizationId]
      );
      const estimateTotal = parseFloat(estimateResult.rows[0]?.total || 0);

      if (estimateTotal > 0) {
        return {
          current: Math.round(estimateTotal),
          previous: Math.round(estimateTotal),
          changePercent: null,
          topSpenders: [],
          source: 'estimated',
          asOf: discoveryAsOf,
        };
      }
    } catch (error: any) {
      console.error('[AI Chat Context] Error getting cost estimate fallback:', error.message);
    }

    // Neither a live/cached Cost Explorer result nor a DB estimate exists --
    // genuinely no cost data. current/previous are 0 by necessity of the
    // ChatContext shape, but `source: 'unavailable'` is what formatContext()
    // and getFallbackResponse() actually check before ever printing a dollar
    // amount, so this 0 can never surface as a confirmed figure.
    return {
      current: 0,
      previous: 0,
      changePercent: null,
      topSpenders: [],
      source: 'unavailable',
      asOf: null,
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

      // Lambda functions
      const lambdaQuery = `
        SELECT
          COUNT(*) as total,
          COALESCE(SUM((tags->>'invocations')::bigint), 0) as invocations
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
        leadTime: `${metrics.leadTime.value} ${metrics.leadTime.unit}`,
        mttr: `${metrics.mttr.value} ${metrics.mttr.unit}${metrics.mttr.description ? ` (${metrics.mttr.description})` : ''}`,
      };
    } catch (error: any) {
      console.error('[AI Chat Context] Error getting DORA metrics:', error.message);
      return undefined;
    }
  }
}
