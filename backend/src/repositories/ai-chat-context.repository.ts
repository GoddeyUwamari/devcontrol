/**
 * AI Chat Context Repository
 * Gathers real-time AWS context for AI chat interactions
 */

import { Pool } from 'pg';
import { ChatContext } from '../services/ai-chat.service';
import awsCostService from '../services/aws-cost.service';

export class AIChatContextRepository {
  constructor(private pool: Pool) {}

  /**
   * Gather complete context for AI chat
   */
  async gatherContext(organizationId: string): Promise<ChatContext> {
    console.log(`[AI Chat Context] Gathering context for org: ${organizationId}`);

    const [costs, resources, alerts, services, anomalies, dora] = await Promise.all([
      this.getCostData(organizationId),
      this.getResourceData(organizationId),
      this.getAlertData(organizationId),
      this.getServices(organizationId),
      this.getAnomalies(organizationId),
      this.getDORAMetrics(organizationId),
    ]);

    console.log(`[AI Chat Context] Context gathered: ${services.length} services, $${costs.current} spend`);

    return {
      services,
      costs,
      resources,
      alerts,
      anomalies,
      dora,
      timeRange: 'Last 30 days',
    };
  }

  /**
   * Get cost data.
   * Reuses awsCostService.fetchMonthlyCosts() — the same live Cost Explorer call
   * that powers the Dashboard and AISummaryService — instead of re-deriving spend
   * from aws_resources with a second, independently-maintained query.
   *
   * There is no authoritative previous-period figure available server-side (the
   * Dashboard's month-over-month delta is computed client-side from a daily cost
   * trend this context builder doesn't have). previous/changePercent used to be
   * filled with `totalCurrent * 0.88` — a fabricated placeholder — whenever the
   * (also-broken: risk_score_history has no total_cost column) history lookup
   * failed, which was every call. Reporting 0% change against the real current
   * total is an honest neutral default; it does not invent a number.
   */
  private async getCostData(organizationId: string): Promise<ChatContext['costs']> {
    try {
      const monthlyCost = await awsCostService.fetchMonthlyCosts(organizationId);

      const topSpenders = [...monthlyCost.byService]
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5)
        .map(item => ({
          service: item.service,
          cost: Math.round(item.amount),
          percentage: monthlyCost.total > 0 ? (item.amount / monthlyCost.total) * 100 : 0,
        }));

      return {
        current: Math.round(monthlyCost.total),
        previous: Math.round(monthlyCost.total),
        changePercent: 0,
        topSpenders,
      };
    } catch (error: any) {
      console.error('[AI Chat Context] Error getting cost data:', error.message);
      return {
        current: 0,
        previous: 0,
        changePercent: 0,
        topSpenders: [],
      };
    }
  }

  /**
   * Get resource data
   */
  private async getResourceData(organizationId: string): Promise<ChatContext['resources']> {
    try {
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
      `;

      // RDS databases
      const rdsQuery = `
        SELECT
          COUNT(*) as total,
          SUM(COALESCE(estimated_monthly_cost, 0)) as storage_cost
        FROM aws_resources
        WHERE organization_id = $1
        AND resource_type = 'rds'
      `;

      // Lambda functions
      const lambdaQuery = `
        SELECT
          COUNT(*) as total,
          COALESCE(SUM((tags->>'invocations')::bigint), 0) as invocations
        FROM aws_resources
        WHERE organization_id = $1
        AND resource_type = 'lambda'
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
   * Get alert data
   */
  private async getAlertData(organizationId: string): Promise<ChatContext['alerts']> {
    try {
      const query = `
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE severity = 'critical') as critical,
          array_agg(title ORDER BY created_at DESC) FILTER (
            WHERE created_at > NOW() - INTERVAL '7 days'
          ) as recent_titles
        FROM alert_history
        WHERE organization_id = $1
        AND status = 'active'
      `;

      const result = await this.pool.query(query, [organizationId]);
      const row = result.rows[0];

      return {
        total: parseInt(row?.total || 0),
        critical: parseInt(row?.critical || 0),
        recent: (row?.recent_titles || []).filter(Boolean).slice(0, 3),
      };
    } catch (error: any) {
      // Table might not exist yet
      console.log('[AI Chat Context] Alert table not available:', error.message);
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
   * Get DORA metrics
   */
  private async getDORAMetrics(organizationId: string): Promise<ChatContext['dora'] | undefined> {
    try {
      const query = `
        SELECT
          deployment_frequency,
          lead_time_for_changes,
          mean_time_to_recovery,
          change_failure_rate
        FROM dora_metrics
        WHERE organization_id = $1
        ORDER BY created_at DESC
        LIMIT 1
      `;

      const result = await this.pool.query(query, [organizationId]);

      if (result.rows.length === 0) {
        return undefined;
      }

      const row = result.rows[0];
      return {
        deploymentFrequency: row.deployment_frequency || 'Unknown',
        leadTime: row.lead_time_for_changes || 'Unknown',
        mttr: row.mean_time_to_recovery || 'Unknown',
      };
    } catch (error: any) {
      console.log('[AI Chat Context] DORA metrics not available:', error.message);
      return undefined;
    }
  }
}
