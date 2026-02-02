/**
 * Weekly Summary Repository
 * Fetches aggregated data for weekly AI-powered email summaries
 */

import { Pool } from 'pg';

export interface WeeklyDataQuery {
  organizationId: string;
  startDate: Date;
  endDate: Date;
}

export interface UserInfo {
  email: string;
  fullName: string | null;
}

export class WeeklySummaryRepository {
  constructor(private pool: Pool) {}

  /**
   * Get cost data for the week
   */
  async getWeeklyCostData(query: WeeklyDataQuery) {
    try {
      const result = await this.pool.query(
        `SELECT
          COALESCE(SUM(estimated_monthly_cost), 0) as total_cost,
          resource_type,
          region
         FROM aws_resources
         WHERE organization_id = $1
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
   * Get previous week cost data for comparison
   */
  async getPreviousWeekCostData(query: WeeklyDataQuery): Promise<number> {
    try {
      const result = await this.pool.query(
        `SELECT COALESCE(SUM(estimated_monthly_cost), 0) as total_cost
         FROM aws_resources
         WHERE organization_id = $1`,
        [query.organizationId]
      );

      return parseFloat(result.rows[0]?.total_cost || '0');
    } catch (error) {
      console.warn('[Weekly Summary] Previous cost query failed, returning 0:', error);
      return 0;
    }
  }

  /**
   * Get alerts for the week (gracefully handles missing table)
   */
  async getWeeklyAlerts(query: WeeklyDataQuery) {
    try {
      // First check if alert_history table exists (used by this codebase)
      const tableCheck = await this.pool.query(
        `SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_name = 'alert_history'
        )`
      );

      if (!tableCheck.rows[0]?.exists) {
        return { total: 0, critical: 0, topAlert: null };
      }

      const result = await this.pool.query(
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
  async getUserInfo(organizationId: string): Promise<UserInfo | null> {
    try {
      const result = await this.pool.query(
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
   * Get DORA metrics for the week (aggregated)
   */
  async getWeeklyDORAMetrics(query: WeeklyDataQuery) {
    try {
      // Get deployment count for frequency
      const deploymentResult = await this.pool.query(
        `SELECT COUNT(*) as deployment_count
         FROM deployments
         WHERE organization_id = $1
           AND deployed_at BETWEEN $2 AND $3`,
        [query.organizationId, query.startDate, query.endDate]
      );

      const deploymentCount = parseInt(deploymentResult.rows[0]?.deployment_count || '0');
      const days = Math.ceil((query.endDate.getTime() - query.startDate.getTime()) / (1000 * 60 * 60 * 24));
      const deploymentFrequency = days > 0 ? (deploymentCount / days).toFixed(1) : '0';

      // Get lead time (average time from commit to deploy)
      const leadTimeResult = await this.pool.query(
        `SELECT AVG(EXTRACT(EPOCH FROM (deployed_at - created_at)) / 3600) as avg_lead_time_hours
         FROM deployments
         WHERE organization_id = $1
           AND deployed_at BETWEEN $2 AND $3
           AND status = 'running'`,
        [query.organizationId, query.startDate, query.endDate]
      );

      const avgLeadTimeHours = parseFloat(leadTimeResult.rows[0]?.avg_lead_time_hours || '0');
      const leadTime = avgLeadTimeHours > 0 ? `${avgLeadTimeHours.toFixed(1)} hours` : 'N/A';

      // Get change failure rate
      const failureResult = await this.pool.query(
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
      const changeFailureRate = total > 0 ? ((failed / total) * 100) : 0;

      return {
        deploymentFrequency: `${deploymentFrequency} per day`,
        leadTime,
        mttr: 'N/A',
        changeFailureRate: Math.round(changeFailureRate * 10) / 10
      };
    } catch (error) {
      console.warn('[Weekly Summary] DORA metrics query failed:', error);
      return {
        deploymentFrequency: 'N/A',
        leadTime: 'N/A',
        mttr: 'N/A',
        changeFailureRate: 0
      };
    }
  }
}
