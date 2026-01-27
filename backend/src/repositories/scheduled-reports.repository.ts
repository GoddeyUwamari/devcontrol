import { Pool } from 'pg';

export interface ScheduledReport {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  report_type: 'cost_summary' | 'security_audit' | 'compliance_status';
  schedule_type: 'daily' | 'weekly' | 'monthly';
  schedule_time: string; // TIME format: HH:MM:SS
  schedule_day_of_week: number | null; // 0-6
  schedule_day_of_month: number | null; // 1-31
  timezone: string;
  delivery_email: boolean;
  delivery_slack: boolean;
  email_recipients: string[];
  slack_channels: string[];
  format: 'pdf' | 'csv' | 'both';
  filters: Record<string, any>;
  columns: string[];
  enabled: boolean;
  last_run_at: Date | null;
  last_run_status: 'success' | 'failed' | 'partial' | null;
  last_run_error: string | null;
  next_run_at: Date | null;
  run_count: number;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ReportExecution {
  id: string;
  scheduled_report_id: string;
  executed_at: Date;
  status: 'success' | 'failed' | 'partial';
  records_processed: number;
  file_size_bytes: number | null;
  execution_time_ms: number | null;
  email_sent: boolean;
  email_recipients: string[];
  slack_sent: boolean;
  slack_channels: string[];
  error_message: string | null;
  error_stack: string | null;
  created_at: Date;
}

export interface CreateScheduledReportData {
  organization_id: string;
  name: string;
  description?: string;
  report_type: 'cost_summary' | 'security_audit' | 'compliance_status';
  schedule_type: 'daily' | 'weekly' | 'monthly';
  schedule_time: string;
  schedule_day_of_week?: number;
  schedule_day_of_month?: number;
  timezone: string;
  delivery_email: boolean;
  delivery_slack: boolean;
  email_recipients: string[];
  slack_channels: string[];
  format?: 'pdf' | 'csv' | 'both';
  filters?: Record<string, any>;
  columns?: string[];
  next_run_at?: Date;
  created_by?: string;
}

export interface UpdateScheduledReportData {
  name?: string;
  description?: string;
  report_type?: 'cost_summary' | 'security_audit' | 'compliance_status';
  schedule_type?: 'daily' | 'weekly' | 'monthly';
  schedule_time?: string;
  schedule_day_of_week?: number | null;
  schedule_day_of_month?: number | null;
  timezone?: string;
  delivery_email?: boolean;
  delivery_slack?: boolean;
  email_recipients?: string[];
  slack_channels?: string[];
  format?: 'pdf' | 'csv' | 'both';
  filters?: Record<string, any>;
  columns?: string[];
  enabled?: boolean;
  next_run_at?: Date;
}

export interface LogExecutionData {
  scheduled_report_id: string;
  status: 'success' | 'failed' | 'partial';
  records_processed?: number;
  file_size_bytes?: number;
  execution_time_ms?: number;
  email_sent?: boolean;
  email_recipients?: string[];
  slack_sent?: boolean;
  slack_channels?: string[];
  error_message?: string;
  error_stack?: string;
}

export interface ScheduledReportsFilters {
  report_type?: 'cost_summary' | 'security_audit' | 'compliance_status';
  enabled?: boolean;
  page?: number;
  limit?: number;
}

export class ScheduledReportsRepository {
  constructor(private pool: Pool) {}

  /**
   * Find all scheduled reports for an organization
   */
  async findAll(
    organizationId: string,
    filters: ScheduledReportsFilters = {}
  ): Promise<{ reports: ScheduledReport[]; total: number }> {
    const conditions: string[] = ['organization_id = $1'];
    const values: any[] = [organizationId];
    let paramIndex = 2;

    if (filters.report_type) {
      conditions.push(`report_type = $${paramIndex++}`);
      values.push(filters.report_type);
    }

    if (filters.enabled !== undefined) {
      conditions.push(`enabled = $${paramIndex++}`);
      values.push(filters.enabled);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    // Get total count
    const countResult = await this.pool.query(
      `SELECT COUNT(*) as total FROM scheduled_reports ${whereClause}`,
      values
    );
    const total = parseInt(countResult.rows[0].total);

    // Get paginated results
    const page = filters.page || 1;
    const limit = filters.limit || 50;
    const offset = (page - 1) * limit;

    const query = `
      SELECT * FROM scheduled_reports
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    const result = await this.pool.query(query, [...values, limit, offset]);

    return {
      reports: result.rows,
      total,
    };
  }

  /**
   * Find a single scheduled report by ID (with organization isolation)
   */
  async findById(id: string, organizationId: string): Promise<ScheduledReport | null> {
    const query = `
      SELECT * FROM scheduled_reports
      WHERE id = $1 AND organization_id = $2
    `;

    const result = await this.pool.query(query, [id, organizationId]);
    return result.rows[0] || null;
  }

  /**
   * Find all due reports across all organizations (for cron job)
   * Returns enabled reports where next_run_at <= NOW()
   */
  async findDueReports(): Promise<ScheduledReport[]> {
    const query = `
      SELECT * FROM scheduled_reports
      WHERE enabled = true
        AND next_run_at IS NOT NULL
        AND next_run_at <= NOW()
      ORDER BY next_run_at ASC
    `;

    const result = await this.pool.query(query);
    return result.rows;
  }

  /**
   * Create a new scheduled report
   */
  async create(data: CreateScheduledReportData): Promise<ScheduledReport> {
    const query = `
      INSERT INTO scheduled_reports (
        organization_id,
        name,
        description,
        report_type,
        schedule_type,
        schedule_time,
        schedule_day_of_week,
        schedule_day_of_month,
        timezone,
        delivery_email,
        delivery_slack,
        email_recipients,
        slack_channels,
        format,
        filters,
        columns,
        next_run_at,
        created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      RETURNING *
    `;

    const values = [
      data.organization_id,
      data.name,
      data.description || null,
      data.report_type,
      data.schedule_type,
      data.schedule_time,
      data.schedule_day_of_week || null,
      data.schedule_day_of_month || null,
      data.timezone,
      data.delivery_email,
      data.delivery_slack,
      data.email_recipients,
      data.slack_channels,
      data.format || 'pdf',
      JSON.stringify(data.filters || {}),
      JSON.stringify(data.columns || []),
      data.next_run_at || null,
      data.created_by || null,
    ];

    const result = await this.pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Update a scheduled report (with organization isolation)
   */
  async update(
    id: string,
    organizationId: string,
    data: UpdateScheduledReportData
  ): Promise<ScheduledReport | null> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (data.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(data.name);
    }

    if (data.description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(data.description);
    }

    if (data.report_type !== undefined) {
      updates.push(`report_type = $${paramIndex++}`);
      values.push(data.report_type);
    }

    if (data.schedule_type !== undefined) {
      updates.push(`schedule_type = $${paramIndex++}`);
      values.push(data.schedule_type);
    }

    if (data.schedule_time !== undefined) {
      updates.push(`schedule_time = $${paramIndex++}`);
      values.push(data.schedule_time);
    }

    if (data.schedule_day_of_week !== undefined) {
      updates.push(`schedule_day_of_week = $${paramIndex++}`);
      values.push(data.schedule_day_of_week);
    }

    if (data.schedule_day_of_month !== undefined) {
      updates.push(`schedule_day_of_month = $${paramIndex++}`);
      values.push(data.schedule_day_of_month);
    }

    if (data.timezone !== undefined) {
      updates.push(`timezone = $${paramIndex++}`);
      values.push(data.timezone);
    }

    if (data.delivery_email !== undefined) {
      updates.push(`delivery_email = $${paramIndex++}`);
      values.push(data.delivery_email);
    }

    if (data.delivery_slack !== undefined) {
      updates.push(`delivery_slack = $${paramIndex++}`);
      values.push(data.delivery_slack);
    }

    if (data.email_recipients !== undefined) {
      updates.push(`email_recipients = $${paramIndex++}`);
      values.push(data.email_recipients);
    }

    if (data.slack_channels !== undefined) {
      updates.push(`slack_channels = $${paramIndex++}`);
      values.push(data.slack_channels);
    }

    if (data.format !== undefined) {
      updates.push(`format = $${paramIndex++}`);
      values.push(data.format);
    }

    if (data.filters !== undefined) {
      updates.push(`filters = $${paramIndex++}`);
      values.push(JSON.stringify(data.filters));
    }

    if (data.columns !== undefined) {
      updates.push(`columns = $${paramIndex++}`);
      values.push(JSON.stringify(data.columns));
    }

    if (data.enabled !== undefined) {
      updates.push(`enabled = $${paramIndex++}`);
      values.push(data.enabled);
    }

    if (data.next_run_at !== undefined) {
      updates.push(`next_run_at = $${paramIndex++}`);
      values.push(data.next_run_at);
    }

    if (updates.length === 0) {
      // No updates provided
      return this.findById(id, organizationId);
    }

    const query = `
      UPDATE scheduled_reports
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex} AND organization_id = $${paramIndex + 1}
      RETURNING *
    `;

    values.push(id, organizationId);

    const result = await this.pool.query(query, values);
    return result.rows[0] || null;
  }

  /**
   * Delete a scheduled report (with organization isolation)
   */
  async delete(id: string, organizationId: string): Promise<boolean> {
    const query = `
      DELETE FROM scheduled_reports
      WHERE id = $1 AND organization_id = $2
      RETURNING id
    `;

    const result = await this.pool.query(query, [id, organizationId]);
    return result.rowCount > 0;
  }

  /**
   * Update run status after execution
   */
  async updateRunStatus(
    id: string,
    status: 'success' | 'failed' | 'partial',
    nextRunAt: Date | null,
    errorMessage?: string
  ): Promise<void> {
    const query = `
      UPDATE scheduled_reports
      SET last_run_at = NOW(),
          last_run_status = $1,
          last_run_error = $2,
          next_run_at = $3,
          run_count = run_count + 1
      WHERE id = $4
    `;

    await this.pool.query(query, [status, errorMessage || null, nextRunAt, id]);
  }

  /**
   * Log a report execution
   */
  async logExecution(data: LogExecutionData): Promise<ReportExecution> {
    const query = `
      INSERT INTO scheduled_report_executions (
        scheduled_report_id,
        status,
        records_processed,
        file_size_bytes,
        execution_time_ms,
        email_sent,
        email_recipients,
        slack_sent,
        slack_channels,
        error_message,
        error_stack
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `;

    const values = [
      data.scheduled_report_id,
      data.status,
      data.records_processed || 0,
      data.file_size_bytes || null,
      data.execution_time_ms || null,
      data.email_sent || false,
      data.email_recipients || [],
      data.slack_sent || false,
      data.slack_channels || [],
      data.error_message || null,
      data.error_stack || null,
    ];

    const result = await this.pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Get execution history for a scheduled report
   */
  async getExecutions(
    scheduledReportId: string,
    limit: number = 50
  ): Promise<ReportExecution[]> {
    const query = `
      SELECT * FROM scheduled_report_executions
      WHERE scheduled_report_id = $1
      ORDER BY executed_at DESC
      LIMIT $2
    `;

    const result = await this.pool.query(query, [scheduledReportId, limit]);
    return result.rows;
  }

  /**
   * Get execution statistics for a scheduled report
   */
  async getExecutionStats(scheduledReportId: string): Promise<{
    total_executions: number;
    success_count: number;
    failed_count: number;
    partial_count: number;
    avg_execution_time_ms: number | null;
    last_success_at: Date | null;
  }> {
    const query = `
      SELECT
        COUNT(*) as total_executions,
        COUNT(*) FILTER (WHERE status = 'success') as success_count,
        COUNT(*) FILTER (WHERE status = 'failed') as failed_count,
        COUNT(*) FILTER (WHERE status = 'partial') as partial_count,
        AVG(execution_time_ms) FILTER (WHERE execution_time_ms IS NOT NULL) as avg_execution_time_ms,
        MAX(executed_at) FILTER (WHERE status = 'success') as last_success_at
      FROM scheduled_report_executions
      WHERE scheduled_report_id = $1
    `;

    const result = await this.pool.query(query, [scheduledReportId]);
    const stats = result.rows[0];

    return {
      total_executions: parseInt(stats.total_executions) || 0,
      success_count: parseInt(stats.success_count) || 0,
      failed_count: parseInt(stats.failed_count) || 0,
      partial_count: parseInt(stats.partial_count) || 0,
      avg_execution_time_ms: stats.avg_execution_time_ms ? parseFloat(stats.avg_execution_time_ms) : null,
      last_success_at: stats.last_success_at || null,
    };
  }
}
