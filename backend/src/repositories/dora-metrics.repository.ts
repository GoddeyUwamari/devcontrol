import { Pool } from 'pg';

export interface DORAMetricsFilters {
  dateRange?: '7d' | '30d' | '90d';
  serviceId?: string;
  teamId?: string;
  environment?: string;
  organizationId?: string;
}

export interface LeadTimeResult {
  averageLeadTimeHours: number;
  breakdown: { [key: string]: number };
}

export interface MTTRResult {
  averageMTTRMinutes: number;
  incidents: number;
  breakdown: { [key: string]: number };
}

/**
 * What every query of one GET /api/metrics/dora request is scoped to: the
 * authenticated organization plus the normalized filters (null = all).
 */
export interface DoraQueryScope {
  organizationId: string;
  environment: string | null;
  serviceId: string | null;
  teamId: string | null;
}

/** Finished deployments of one UTC day on one side of the period boundary. */
export interface DoraDayCountRow {
  /** UTC date, YYYY-MM-DD. */
  day: string;
  /** True for the current period, false for the previous one. */
  isCurrent: boolean;
  succeeded: number;
  failed: number;
}

export interface DoraServiceCountRow {
  serviceName: string;
  succeeded: number;
  failed: number;
}

export class DORAMetricsRepository {
  constructor(private pool: Pool) {}

  /**
   * The one place the scope becomes SQL, so every query of a request filters
   * identically. Expects `deployments d JOIN services s` in the FROM clause.
   * The organization always comes first and is never optional.
   */
  private scopeClause(scope: DoraQueryScope, firstParam: number): { sql: string; params: unknown[] } {
    if (!scope.organizationId) {
      throw new Error('DORAMetricsRepository: an organization is required');
    }
    const params: unknown[] = [scope.organizationId];
    let sql = `d.organization_id = $${firstParam}`;
    const add = (column: string, value: string | null) => {
      if (value === null) return;
      params.push(value);
      sql += ` AND ${column} = $${firstParam + params.length - 1}`;
    };
    add('d.environment', scope.environment);
    add('d.service_id', scope.serviceId);
    add('s.team_id', scope.teamId);
    return { sql, params };
  }

  /**
   * Finished deployments ('success' / 'failed' only; 'deploying' and unknown
   * statuses never count) grouped by UTC date and by period, for
   * [previousStartAt, endAt). Rows at or after currentStartAt are current.
   *
   * `AT TIME ZONE 'UTC'` turns the timestamptz into UTC wall time whatever
   * the session TimeZone, and to_char returns the date as text so the pg
   * driver never turns it into a local-midnight Date. A UTC day that the
   * period boundary cuts appears once per side.
   */
  async countFinishedByUtcDay(
    scope: DoraQueryScope,
    bounds: { previousStartAt: Date; currentStartAt: Date; endAt: Date }
  ): Promise<DoraDayCountRow[]> {
    const where = this.scopeClause(scope, 4);
    const result = await this.pool.query<{ day: string; is_current: boolean; succeeded: number; failed: number }>(
      `SELECT to_char(d.deployed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
              (d.deployed_at >= $2::timestamptz) AS is_current,
              (COUNT(*) FILTER (WHERE d.status = 'success'))::int AS succeeded,
              (COUNT(*) FILTER (WHERE d.status = 'failed'))::int AS failed
         FROM deployments d
         JOIN services s ON s.id = d.service_id
        WHERE ${where.sql}
          AND d.status IN ('success', 'failed')
          AND d.deployed_at >= $1::timestamptz
          AND d.deployed_at <  $3::timestamptz
        GROUP BY 1, 2
        ORDER BY 1, 2`,
      [
        bounds.previousStartAt.toISOString(),
        bounds.currentStartAt.toISOString(),
        bounds.endAt.toISOString(),
        ...where.params,
      ]
    );
    return result.rows.map((row) => ({
      day: row.day,
      isCurrent: row.is_current,
      succeeded: Number(row.succeeded),
      failed: Number(row.failed),
    }));
  }

  /**
   * Finished deployments per service name in [startAt, endAt), for the
   * per-service breakdowns. Same scope and status rules as countFinishedByUtcDay.
   */
  async countFinishedByService(
    scope: DoraQueryScope,
    bounds: { startAt: Date; endAt: Date }
  ): Promise<DoraServiceCountRow[]> {
    const where = this.scopeClause(scope, 3);
    const result = await this.pool.query<{ service_name: string; succeeded: number; failed: number }>(
      `SELECT s.name AS service_name,
              (COUNT(*) FILTER (WHERE d.status = 'success'))::int AS succeeded,
              (COUNT(*) FILTER (WHERE d.status = 'failed'))::int AS failed
         FROM deployments d
         JOIN services s ON s.id = d.service_id
        WHERE ${where.sql}
          AND d.status IN ('success', 'failed')
          AND d.deployed_at >= $1::timestamptz
          AND d.deployed_at <  $2::timestamptz
        GROUP BY s.name
        ORDER BY s.name`,
      [bounds.startAt.toISOString(), bounds.endAt.toISOString(), ...where.params]
    );
    return result.rows.map((row) => ({
      serviceName: row.service_name,
      succeeded: Number(row.succeeded),
      failed: Number(row.failed),
    }));
  }

  // calculateLeadTime / calculateMTTR below are not called by anything: lead
  // time and time to restore are reported as not tracked (D6 / D7). They are
  // left as they were and do not follow the bounded-window rules above.

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
          AND d.organization_id = $2
    `;

    const params: any[] = [startDate, filters.organizationId];
    let paramIndex = 3;

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
          AND d.organization_id = $2
    `;

    const params: any[] = [startDate, filters.organizationId];
    let paramIndex = 3;

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
