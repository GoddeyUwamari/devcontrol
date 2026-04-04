import { Pool } from 'pg';
import { NLQueryIntent } from './nl-query.service';

export interface NLQueryResult {
  intent: NLQueryIntent;
  data: NLQueryResultData;
  executedAt: Date;
  rowCount: number;
  executionMs: number;
}

export interface NLQueryResultData {
  type: 'resources' | 'costs' | 'deployments' | 'alerts' | 'anomalies' | 'services' | 'empty';
  rows: any[];
  summary: string;
  columns: string[];
}

export class NLQueryExecutorService {
  constructor(private pool: Pool) {}

  async execute(intent: NLQueryIntent, organizationId: string): Promise<NLQueryResult> {
    const start = Date.now();

    try {
      const data = await this.routeAndExecute(intent, organizationId);
      return {
        intent,
        data,
        executedAt: new Date(),
        rowCount: data.rows.length,
        executionMs: Date.now() - start,
      };
    } catch (err) {
      console.error('[NL Query Executor] Error:', err);
      return {
        intent,
        data: { type: 'empty', rows: [], summary: 'Query executed but no data was found.', columns: [] },
        executedAt: new Date(),
        rowCount: 0,
        executionMs: Date.now() - start,
      };
    }
  }

  private async routeAndExecute(intent: NLQueryIntent, organizationId: string): Promise<NLQueryResultData> {
    switch (intent.target) {
      case 'infrastructure': return this.queryResources(intent, organizationId);
      case 'services':       return this.queryServices(intent, organizationId);
      case 'deployments':    return this.queryDeployments(intent, organizationId);
      case 'alerts':         return this.queryAlerts(intent, organizationId);
      case 'costs':          return this.queryCosts(intent, organizationId);
      default:               return this.queryResources(intent, organizationId);
    }
  }

  // ── RESOURCES ──────────────────────────────────────────────────────────────

  private async queryResources(intent: NLQueryIntent, organizationId: string): Promise<NLQueryResultData> {
    const filters = intent.filters ?? {};
    const conditions: string[] = ['organization_id = $1'];
    const values: any[] = [organizationId];
    let idx = 2;

    if (filters.resourceType && typeof filters.resourceType === 'string') {
      conditions.push(`resource_type::text ILIKE $${idx++}`);
      values.push(`%${filters.resourceType}%`);
    }
    if (filters.status && typeof filters.status === 'string') {
      conditions.push(`status::text ILIKE $${idx++}`);
      values.push(String(filters.status));
    }
    if (filters.awsRegion && typeof filters.awsRegion === 'string') {
      conditions.push(`region::text ILIKE $${idx++}`);
      values.push(`%${filters.awsRegion}%`);
    }
    const costMinVal = filters.costMin !== undefined ? parseFloat(String(filters.costMin)) : NaN;
    if (!isNaN(costMinVal)) {
      conditions.push(`estimated_monthly_cost >= $${idx++}`);
      values.push(costMinVal);
    }
    const costMaxVal = filters.costMax !== undefined ? parseFloat(String(filters.costMax)) : NaN;
    if (!isNaN(costMaxVal)) {
      conditions.push(`estimated_monthly_cost <= $${idx++}`);
      values.push(costMaxVal);
    }
    if (filters.encrypted === false) {
      conditions.push(`is_encrypted = $${idx++}`);
      values.push(false);
    }
    if (filters.hasBackup === false) {
      conditions.push(`has_backup = $${idx++}`);
      values.push(false);
    }
    if (filters.publicAccess === true) {
      conditions.push(`is_public = $${idx++}`);
      values.push(true);
    }

    const orderBy = filters.costMin || filters.costMax
      ? 'ORDER BY estimated_monthly_cost DESC'
      : 'ORDER BY estimated_monthly_cost DESC NULLS LAST';

    const result = await this.pool.query(
      `SELECT
         id,
         resource_id,
         resource_name,
         resource_type,
         region,
         status,
         ROUND(estimated_monthly_cost::numeric, 2) AS monthly_cost,
         tags->>'environment' AS environment,
         created_at
       FROM aws_resources
       WHERE ${conditions.join(' AND ')}
       ${orderBy}
       LIMIT 25`,
      values
    );

    const totalCost = result.rows.reduce((sum, r) => sum + parseFloat(r.monthly_cost ?? 0), 0);
    const summary = result.rows.length > 0
      ? `Found ${result.rows.length} resource${result.rows.length !== 1 ? 's' : ''} · Total cost ${totalCost.toFixed(2)}/mo`
      : 'No resources matched your query.';

    return {
      type: 'resources',
      rows: result.rows,
      summary,
      columns: ['Resource', 'Type', 'Region', 'Status', 'Monthly Cost'],
    };
  }

  // ── SERVICES ───────────────────────────────────────────────────────────────

  private async queryServices(intent: NLQueryIntent, organizationId: string): Promise<NLQueryResultData> {
    const filters = intent.filters ?? {};
    const conditions: string[] = ['organization_id = $1'];
    const values: any[] = [organizationId];
    let idx = 2;

    if (filters.status) {
      conditions.push(`status = ${idx++}`);
      values.push(filters.status);
    }

    const result = await this.pool.query(
      `SELECT
         name,
         service_type,
         status,
         environment,
         ROUND(monthly_cost::numeric, 2) AS monthly_cost,
         last_deployed_at,
         health_score
       FROM services
       WHERE ${conditions.join(' AND ')}
       ORDER BY monthly_cost DESC NULLS LAST
       LIMIT 25`,
      values
    );

    const summary = result.rows.length > 0
      ? `Found ${result.rows.length} service${result.rows.length !== 1 ? 's' : ''}`
      : 'No services matched your query.';

    return {
      type: 'services',
      rows: result.rows,
      summary,
      columns: ['Service', 'Type', 'Status', 'Environment', 'Monthly Cost'],
    };
  }

  // ── DEPLOYMENTS ────────────────────────────────────────────────────────────

  private async queryDeployments(intent: NLQueryIntent, organizationId: string): Promise<NLQueryResultData> {
    const filters = intent.filters ?? {};
    const conditions: string[] = ['organization_id = $1'];
    const values: any[] = [organizationId];
    let idx = 2;

    if (filters.status) {
      conditions.push(`status = ${idx++}`);
      values.push(filters.status);
    }
    if (filters.environment) {
      conditions.push(`environment ILIKE ${idx++}`);
      values.push(`%${filters.environment}%`);
    }
    if (filters.dateRange) {
      const days = parseInt(filters.dateRange) || 30;
      conditions.push(`deployed_at > NOW() - INTERVAL '${days} days'`);
    }

    const result = await this.pool.query(
      `SELECT
         service_name,
         version,
         environment,
         status,
         deployed_by,
         deployed_at,
         duration_seconds
       FROM deployments
       WHERE ${conditions.join(' AND ')}
       ORDER BY deployed_at DESC
       LIMIT 25`,
      values
    );

    const summary = result.rows.length > 0
      ? `Found ${result.rows.length} deployment${result.rows.length !== 1 ? 's' : ''}`
      : 'No deployments matched your query.';

    return {
      type: 'deployments',
      rows: result.rows,
      summary,
      columns: ['Service', 'Version', 'Environment', 'Status', 'Deployed By', 'Deployed At'],
    };
  }

  // ── ALERTS ─────────────────────────────────────────────────────────────────

  private async queryAlerts(intent: NLQueryIntent, organizationId: string): Promise<NLQueryResultData> {
    const filters = intent.filters ?? {};
    const conditions: string[] = ['organization_id = $1'];
    const values: any[] = [organizationId];
    let idx = 2;

    if (filters.severity) {
      conditions.push(`severity = ${idx++}`);
      values.push(filters.severity);
    }
    if (filters.status) {
      conditions.push(`status = ${idx++}`);
      values.push(filters.status);
    }
    if (filters.dateRange) {
      const days = parseInt(filters.dateRange) || 7;
      conditions.push(`triggered_at > NOW() - INTERVAL '${days} days'`);
    }

    const result = await this.pool.query(
      `SELECT
         title,
         severity,
         status,
         service_name,
         triggered_at,
         resolved_at,
         message
       FROM alert_history
       WHERE ${conditions.join(' AND ')}
       ORDER BY triggered_at DESC
       LIMIT 25`,
      values
    );

    const critical = result.rows.filter(r => r.severity === 'critical').length;
    const summary = result.rows.length > 0
      ? `Found ${result.rows.length} alert${result.rows.length !== 1 ? 's' : ''}${critical > 0 ? ` · ${critical} critical` : ''}`
      : 'No alerts matched your query.';

    return {
      type: 'alerts',
      rows: result.rows,
      summary,
      columns: ['Title', 'Severity', 'Status', 'Service', 'Triggered At'],
    };
  }

  // ── COSTS ──────────────────────────────────────────────────────────────────

  private async queryCosts(intent: NLQueryIntent, organizationId: string): Promise<NLQueryResultData> {
    const filters = intent.filters ?? {};

    const days = filters.dateRange ? parseInt(filters.dateRange) : 30;

    const result = await this.pool.query(
      `SELECT
         resource_type,
         COUNT(*) AS resource_count,
         ROUND(SUM(estimated_monthly_cost)::numeric, 2) AS total_cost,
         ROUND(AVG(estimated_monthly_cost)::numeric, 2) AS avg_cost,
         ROUND(MAX(estimated_monthly_cost)::numeric, 2) AS max_cost
       FROM aws_resources
       WHERE organization_id = $1
         AND estimated_monthly_cost > 0
       GROUP BY resource_type
       ORDER BY total_cost DESC
       LIMIT 20`,
      [organizationId]
    );

    const grandTotal = result.rows.reduce((sum, r) => sum + parseFloat(r.total_cost ?? 0), 0);
    const summary = result.rows.length > 0
      ? `Cost breakdown across ${result.rows.length} service type${result.rows.length !== 1 ? 's' : ''} · Total ${grandTotal.toFixed(2)}/mo`
      : 'No cost data available.';

    return {
      type: 'costs',
      rows: result.rows,
      summary,
      columns: ['Service Type', 'Resources', 'Total Cost/mo', 'Avg Cost/mo', 'Max Cost/mo'],
    };
  }
}
