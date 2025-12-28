import { Pool } from 'pg';

export interface DORAMetricsFilters {
  dateRange?: '7d' | '30d' | '90d';
  serviceId?: string;
  teamId?: string;
  environment?: string;
}

export interface DeploymentFrequencyResult {
  totalDeployments: number;
  deploymentsPerDay: number;
  breakdown: { [key: string]: number };
}

export interface LeadTimeResult {
  averageLeadTimeHours: number;
  breakdown: { [key: string]: number };
}

export interface ChangeFailureRateResult {
  totalDeployments: number;
  failedDeployments: number;
  failureRate: number;
  breakdown: { [key: string]: number };
}

export interface MTTRResult {
  averageMTTRMinutes: number;
  incidents: number;
  breakdown: { [key: string]: number };
}

export class DORAMetricsRepository {
  constructor(private pool: Pool) {}

  /**
   * Calculate Deployment Frequency
   * How often code is deployed to production
   */
  async calculateDeploymentFrequency(
    filters: DORAMetricsFilters
  ): Promise<DeploymentFrequencyResult> {
    const days = this.getDaysFromDateRange(filters.dateRange || '30d');
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    let query = `
      WITH deployment_counts AS (
        SELECT
          s.name as service_name,
          COUNT(d.id) as deployment_count
        FROM deployments d
        JOIN services s ON d.service_id = s.id
        WHERE d.deployed_at >= $1
    `;

    const params: any[] = [startDate];
    let paramIndex = 2;

    if (filters.environment) {
      query += ` AND d.environment = $${paramIndex}`;
      params.push(filters.environment);
      paramIndex++;
    }

    if (filters.serviceId) {
      query += ` AND d.service_id = $${paramIndex}`;
      params.push(filters.serviceId);
      paramIndex++;
    }

    if (filters.teamId) {
      query += ` AND s.team_id = $${paramIndex}`;
      params.push(filters.teamId);
      paramIndex++;
    }

    query += `
        GROUP BY s.name
      ),
      totals AS (
        SELECT
          SUM(deployment_count) as total,
          $${paramIndex} as days
        FROM deployment_counts
      )
      SELECT
        dc.service_name,
        dc.deployment_count,
        t.total,
        t.days
      FROM deployment_counts dc
      CROSS JOIN totals t
      ORDER BY dc.deployment_count DESC
    `;

    params.push(days);

    const result = await this.pool.query(query, params);

    if (result.rows.length === 0) {
      return {
        totalDeployments: 0,
        deploymentsPerDay: 0,
        breakdown: {},
      };
    }

    const totalDeployments = parseInt(result.rows[0].total) || 0;
    const deploymentsPerDay = totalDeployments / days;

    const breakdown: { [key: string]: number } = {};
    result.rows.forEach((row) => {
      breakdown[row.service_name] = parseFloat(
        (row.deployment_count / days).toFixed(2)
      );
    });

    return {
      totalDeployments,
      deploymentsPerDay: parseFloat(deploymentsPerDay.toFixed(2)),
      breakdown,
    };
  }

  /**
   * Calculate Lead Time for Changes
   * Average time between consecutive successful deployments (deployment velocity)
   */
  async calculateLeadTime(
    filters: DORAMetricsFilters
  ): Promise<LeadTimeResult> {
    const days = this.getDaysFromDateRange(filters.dateRange || '30d');
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    let query = `
      WITH successful_deployments AS (
        SELECT
          d.id,
          d.service_id,
          s.name as service_name,
          d.deployed_at,
          LAG(d.deployed_at) OVER (
            PARTITION BY d.service_id
            ORDER BY d.deployed_at
          ) as previous_deploy_at
        FROM deployments d
        JOIN services s ON d.service_id = s.id
        WHERE d.status = 'success'
          AND d.deployed_at >= $1
    `;

    const params: any[] = [startDate];
    let paramIndex = 2;

    if (filters.environment) {
      query += ` AND d.environment = $${paramIndex}`;
      params.push(filters.environment);
      paramIndex++;
    }

    if (filters.serviceId) {
      query += ` AND d.service_id = $${paramIndex}`;
      params.push(filters.serviceId);
      paramIndex++;
    }

    if (filters.teamId) {
      query += ` AND s.team_id = $${paramIndex}`;
      params.push(filters.teamId);
      paramIndex++;
    }

    query += `
      ),
      lead_times AS (
        SELECT
          service_name,
          EXTRACT(EPOCH FROM (deployed_at - previous_deploy_at)) / 3600 as hours
        FROM successful_deployments
        WHERE previous_deploy_at IS NOT NULL
      ),
      service_averages AS (
        SELECT
          service_name,
          AVG(hours) as avg_hours
        FROM lead_times
        GROUP BY service_name
      )
      SELECT
        service_name,
        avg_hours,
        (SELECT AVG(hours) FROM lead_times) as overall_avg
      FROM service_averages
      ORDER BY avg_hours ASC
    `;

    const result = await this.pool.query(query, params);

    if (result.rows.length === 0) {
      return {
        averageLeadTimeHours: 0,
        breakdown: {},
      };
    }

    const averageLeadTimeHours = parseFloat(result.rows[0].overall_avg) || 0;

    const breakdown: { [key: string]: number } = {};
    result.rows.forEach((row) => {
      breakdown[row.service_name] = parseFloat(
        parseFloat(row.avg_hours).toFixed(2)
      );
    });

    return {
      averageLeadTimeHours: parseFloat(averageLeadTimeHours.toFixed(2)),
      breakdown,
    };
  }

  /**
   * Calculate Change Failure Rate
   * Percentage of deployments that fail
   */
  async calculateChangeFailureRate(
    filters: DORAMetricsFilters
  ): Promise<ChangeFailureRateResult> {
    const days = this.getDaysFromDateRange(filters.dateRange || '30d');
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    let query = `
      WITH deployment_stats AS (
        SELECT
          s.name as service_name,
          COUNT(*) as total_deployments,
          COUNT(*) FILTER (WHERE d.status = 'failed') as failed_deployments
        FROM deployments d
        JOIN services s ON d.service_id = s.id
        WHERE d.deployed_at >= $1
    `;

    const params: any[] = [startDate];
    let paramIndex = 2;

    if (filters.environment) {
      query += ` AND d.environment = $${paramIndex}`;
      params.push(filters.environment);
      paramIndex++;
    }

    if (filters.serviceId) {
      query += ` AND d.service_id = $${paramIndex}`;
      params.push(filters.serviceId);
      paramIndex++;
    }

    if (filters.teamId) {
      query += ` AND s.team_id = $${paramIndex}`;
      params.push(filters.teamId);
      paramIndex++;
    }

    query += `
        GROUP BY s.name
      ),
      totals AS (
        SELECT
          SUM(total_deployments) as total,
          SUM(failed_deployments) as failed
        FROM deployment_stats
      )
      SELECT
        ds.service_name,
        ds.total_deployments,
        ds.failed_deployments,
        CASE
          WHEN ds.total_deployments > 0
          THEN (ds.failed_deployments::float / ds.total_deployments::float * 100)
          ELSE 0
        END as failure_rate,
        t.total,
        t.failed
      FROM deployment_stats ds
      CROSS JOIN totals t
      ORDER BY failure_rate DESC
    `;

    const result = await this.pool.query(query, params);

    if (result.rows.length === 0) {
      return {
        totalDeployments: 0,
        failedDeployments: 0,
        failureRate: 0,
        breakdown: {},
      };
    }

    const totalDeployments = parseInt(result.rows[0].total) || 0;
    const failedDeployments = parseInt(result.rows[0].failed) || 0;
    const failureRate =
      totalDeployments > 0
        ? (failedDeployments / totalDeployments) * 100
        : 0;

    const breakdown: { [key: string]: number } = {};
    result.rows.forEach((row) => {
      breakdown[row.service_name] = parseFloat(
        parseFloat(row.failure_rate).toFixed(2)
      );
    });

    return {
      totalDeployments,
      failedDeployments,
      failureRate: parseFloat(failureRate.toFixed(2)),
      breakdown,
    };
  }

  /**
   * Calculate Mean Time to Recovery (MTTR)
   * Average time from failed deployment to next successful deployment
   */
  async calculateMTTR(filters: DORAMetricsFilters): Promise<MTTRResult> {
    const days = this.getDaysFromDateRange(filters.dateRange || '30d');
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    let query = `
      WITH deployments_ordered AS (
        SELECT
          d.id,
          d.service_id,
          s.name as service_name,
          d.status,
          d.deployed_at,
          LEAD(d.status) OVER (
            PARTITION BY d.service_id
            ORDER BY d.deployed_at
          ) as next_status,
          LEAD(d.deployed_at) OVER (
            PARTITION BY d.service_id
            ORDER BY d.deployed_at
          ) as next_deploy_at
        FROM deployments d
        JOIN services s ON d.service_id = s.id
        WHERE d.deployed_at >= $1
    `;

    const params: any[] = [startDate];
    let paramIndex = 2;

    if (filters.environment) {
      query += ` AND d.environment = $${paramIndex}`;
      params.push(filters.environment);
      paramIndex++;
    }

    if (filters.serviceId) {
      query += ` AND d.service_id = $${paramIndex}`;
      params.push(filters.serviceId);
      paramIndex++;
    }

    if (filters.teamId) {
      query += ` AND s.team_id = $${paramIndex}`;
      params.push(filters.teamId);
      paramIndex++;
    }

    query += `
      ),
      recovery_times AS (
        SELECT
          service_name,
          EXTRACT(EPOCH FROM (next_deploy_at - deployed_at)) / 60 as recovery_minutes
        FROM deployments_ordered
        WHERE status = 'failed'
          AND next_status = 'success'
          AND next_deploy_at IS NOT NULL
      ),
      service_averages AS (
        SELECT
          service_name,
          AVG(recovery_minutes) as avg_recovery_minutes,
          COUNT(*) as incident_count
        FROM recovery_times
        GROUP BY service_name
      )
      SELECT
        service_name,
        avg_recovery_minutes,
        incident_count,
        (SELECT AVG(recovery_minutes) FROM recovery_times) as overall_avg,
        (SELECT COUNT(*) FROM recovery_times) as total_incidents
      FROM service_averages
      ORDER BY avg_recovery_minutes DESC
    `;

    const result = await this.pool.query(query, params);

    if (result.rows.length === 0) {
      return {
        averageMTTRMinutes: 0,
        incidents: 0,
        breakdown: {},
      };
    }

    const averageMTTRMinutes = parseFloat(result.rows[0].overall_avg) || 0;
    const incidents = parseInt(result.rows[0].total_incidents) || 0;

    const breakdown: { [key: string]: number } = {};
    result.rows.forEach((row) => {
      breakdown[row.service_name] = parseFloat(
        parseFloat(row.avg_recovery_minutes).toFixed(2)
      );
    });

    return {
      averageMTTRMinutes: parseFloat(averageMTTRMinutes.toFixed(2)),
      incidents,
      breakdown,
    };
  }

  /**
   * Get date range period info
   */
  async getDateRangePeriod(dateRange: string = '30d') {
    const days = this.getDaysFromDateRange(dateRange);
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    return {
      start: startDate.toISOString().split('T')[0],
      end: endDate.toISOString().split('T')[0],
      days,
    };
  }

  private getDaysFromDateRange(dateRange: string): number {
    switch (dateRange) {
      case '7d':
        return 7;
      case '30d':
        return 30;
      case '90d':
        return 90;
      default:
        return 30;
    }
  }
}
