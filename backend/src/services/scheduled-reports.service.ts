import { Pool } from 'pg';
import nodemailer from 'nodemailer';
import {
  ScheduledReportsRepository,
  ScheduledReport,
  CreateScheduledReportData,
  UpdateScheduledReportData,
  LogExecutionData,
  ReportExecution,
  ScheduledReportsFilters,
} from '../repositories/scheduled-reports.repository';
import { ReportGeneratorService } from './report-generator.service';
import { ResourceFilters } from '../types/aws-resources.types';

export class ScheduledReportsService {
  private repository: ScheduledReportsRepository;
  private reportGenerator: ReportGeneratorService;

  constructor(private pool: Pool) {
    this.repository = new ScheduledReportsRepository(pool);
    this.reportGenerator = new ReportGeneratorService(pool);
  }

  /**
   * Main cron job entry point - process all due reports
   */
  async processScheduledReports(): Promise<void> {
    console.log('[ScheduledReports] Checking for due reports...');

    const dueReports = await this.repository.findDueReports();

    if (dueReports.length === 0) {
      console.log('[ScheduledReports] No reports due at this time');
      return;
    }

    console.log(`[ScheduledReports] Found ${dueReports.length} due report(s)`);

    for (const report of dueReports) {
      try {
        await this.executeReport(report);
      } catch (error: any) {
        console.error(`[ScheduledReports] Error executing report ${report.id}:`, error.message);
        // Continue with other reports even if one fails
      }
    }

    console.log('[ScheduledReports] Finished processing due reports');
  }

  /**
   * Execute a single report (generate and deliver)
   */
  private async executeReport(report: ScheduledReport): Promise<void> {
    const startTime = Date.now();
    console.log(`[ScheduledReports] Executing report: ${report.name} (${report.id})`);

    try {
      // Verify organization still has Enterprise tier
      const tierCheck = await this.pool.query(
        'SELECT subscription_tier FROM organizations WHERE id = $1 AND deleted_at IS NULL',
        [report.organization_id]
      );

      if (tierCheck.rows.length === 0 || tierCheck.rows[0].subscription_tier !== 'enterprise') {
        console.log(`[ScheduledReports] Organization ${report.organization_id} is not Enterprise tier, skipping`);
        // Disable the schedule
        await this.repository.update(report.id, report.organization_id, { enabled: false });
        return;
      }

      // Generate report
      const reportData = await this.generateReport(report);

      // Deliver report
      const deliveryResults = await this.deliverReport(report, reportData);

      // Calculate next run time
      const nextRunAt = this.calculateNextRun(report);

      // Determine execution status
      const status = this.determineExecutionStatus(deliveryResults);

      // Log execution
      const executionTime = Date.now() - startTime;
      await this.repository.logExecution({
        scheduled_report_id: report.id,
        status,
        records_processed: reportData.recordsProcessed,
        file_size_bytes: reportData.fileSizeBytes,
        execution_time_ms: executionTime,
        email_sent: deliveryResults.emailSuccess,
        email_recipients: report.delivery_email ? report.email_recipients : [],
        slack_sent: deliveryResults.slackSuccess,
        slack_channels: report.delivery_slack ? report.slack_channels : [],
        error_message: deliveryResults.error || null,
      });

      // Update schedule status
      await this.repository.updateRunStatus(report.id, status, nextRunAt, deliveryResults.error);

      console.log(
        `[ScheduledReports] Report ${report.id} completed with status: ${status} (${executionTime}ms). Next run: ${nextRunAt?.toISOString()}`
      );
    } catch (error: any) {
      console.error(`[ScheduledReports] Report ${report.id} failed:`, error);

      // Log failed execution
      await this.repository.logExecution({
        scheduled_report_id: report.id,
        status: 'failed',
        error_message: error.message,
        error_stack: error.stack,
      });

      // Update schedule with error
      const nextRunAt = this.calculateNextRun(report);
      await this.repository.updateRunStatus(report.id, 'failed', nextRunAt, error.message);
    }
  }

  /**
   * Generate report based on type
   */
  private async generateReport(report: ScheduledReport): Promise<{
    pdf?: Buffer;
    csv?: Buffer;
    recordsProcessed: number;
    fileSizeBytes: number;
  }> {
    const filters: ResourceFilters = report.filters || {};
    const columns = report.columns || [];

    let result: { pdf?: Buffer; csv?: Buffer };

    switch (report.report_type) {
      case 'cost_summary':
        result = await this.reportGenerator.generateCostSummaryReport({
          organizationId: report.organization_id,
          format: report.format,
          filters,
          columns: columns as any,
        });
        break;

      case 'security_audit':
        result = await this.reportGenerator.generateSecurityAuditReport({
          organizationId: report.organization_id,
          format: report.format,
          filters,
          columns: columns as any,
        });
        break;

      case 'compliance_status':
        result = await this.reportGenerator.generateComplianceStatusReport({
          organizationId: report.organization_id,
          format: report.format,
          filters,
          columns: columns as any,
        });
        break;

      default:
        throw new Error(`Unknown report type: ${report.report_type}`);
    }

    // Calculate file size and record count (estimate from buffer size)
    let fileSizeBytes = 0;
    if (result.pdf) fileSizeBytes += result.pdf.length;
    if (result.csv) fileSizeBytes += result.csv.length;

    // Get resource count from database
    const countQuery = await this.pool.query(
      'SELECT COUNT(*) as count FROM aws_resources WHERE organization_id = $1',
      [report.organization_id]
    );
    const recordsProcessed = parseInt(countQuery.rows[0]?.count || '0');

    return {
      ...result,
      recordsProcessed,
      fileSizeBytes,
    };
  }

  /**
   * Deliver report via configured channels
   */
  private async deliverReport(
    report: ScheduledReport,
    reportData: { pdf?: Buffer; csv?: Buffer }
  ): Promise<{ emailSuccess: boolean; slackSuccess: boolean; error?: string }> {
    const results = { emailSuccess: false, slackSuccess: false, error: undefined as string | undefined };

    // Email delivery
    if (report.delivery_email && report.email_recipients.length > 0) {
      try {
        await this.deliverViaEmail(report, reportData);
        results.emailSuccess = true;
      } catch (error: any) {
        console.error('[ScheduledReports] Email delivery failed:', error.message);
        results.error = results.error ? `${results.error}; Email: ${error.message}` : `Email: ${error.message}`;
      }
    }

    // Slack delivery
    if (report.delivery_slack && report.slack_channels.length > 0) {
      try {
        await this.deliverViaSlack(report, reportData);
        results.slackSuccess = true;
      } catch (error: any) {
        console.error('[ScheduledReports] Slack delivery failed:', error.message);
        results.error = results.error ? `${results.error}; Slack: ${error.message}` : `Slack: ${error.message}`;
      }
    }

    return results;
  }

  /**
   * Deliver report via email
   */
  private async deliverViaEmail(
    report: ScheduledReport,
    reportData: { pdf?: Buffer; csv?: Buffer }
  ): Promise<void> {
    // Fetch organization's SMTP config from alert_config (if available)
    // For now, use environment variables or fail gracefully
    const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
    const smtpPort = parseInt(process.env.SMTP_PORT || '587');
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;

    if (!smtpUser || !smtpPass) {
      throw new Error('SMTP credentials not configured. Set SMTP_USER and SMTP_PASS environment variables.');
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    const reportTypeLabel = this.getReportTypeLabel(report.report_type);
    const subject = `[DevControl] ${reportTypeLabel} - ${new Date().toLocaleDateString()}`;

    const attachments: any[] = [];
    if (reportData.pdf) {
      attachments.push({
        filename: `${report.report_type}_${Date.now()}.pdf`,
        content: reportData.pdf,
        contentType: 'application/pdf',
      });
    }
    if (reportData.csv) {
      attachments.push({
        filename: `${report.report_type}_${Date.now()}.csv`,
        content: reportData.csv,
        contentType: 'text/csv',
      });
    }

    const htmlContent = this.generateEmailHTML(report, reportTypeLabel);

    await transporter.sendMail({
      from: `"DevControl Reports" <${smtpUser}>`,
      to: report.email_recipients.join(', '),
      subject,
      html: htmlContent,
      attachments,
    });

    console.log(`[ScheduledReports] Email sent to ${report.email_recipients.join(', ')}`);
  }

  /**
   * Deliver report via Slack
   */
  private async deliverViaSlack(
    report: ScheduledReport,
    reportData: { pdf?: Buffer; csv?: Buffer }
  ): Promise<void> {
    // Fetch organization's Slack webhook URL from alert_config
    const webhookQuery = await this.pool.query(
      "SELECT settings FROM organizations WHERE id = $1 AND settings->>'slack_webhook_url' IS NOT NULL",
      [report.organization_id]
    );

    let webhookUrl: string | null = null;
    if (webhookQuery.rows.length > 0) {
      webhookUrl = webhookQuery.rows[0].settings?.slack_webhook_url;
    }

    if (!webhookUrl) {
      webhookUrl = process.env.SLACK_WEBHOOK_URL || null;
    }

    if (!webhookUrl) {
      throw new Error('Slack webhook URL not configured for organization');
    }

    const reportTypeLabel = this.getReportTypeLabel(report.report_type);

    const message = {
      text: `${this.getReportEmoji(report.report_type)} *${reportTypeLabel}*`,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `${this.getReportEmoji(report.report_type)} ${reportTypeLabel}`,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Report Name:* ${report.name}\n*Generated:* ${new Date().toLocaleString()}\n*Schedule:* ${this.getScheduleDescription(report)}`,
          },
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `Format: ${report.format.toUpperCase()} | Automated by DevControl`,
            },
          ],
        },
      ],
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      throw new Error(`Slack webhook returned ${response.status}: ${await response.text()}`);
    }

    console.log(`[ScheduledReports] Slack notification sent to ${report.slack_channels.join(', ')}`);
  }

  /**
   * Calculate next run time based on schedule
   */
  calculateNextRun(report: ScheduledReport): Date | null {
    const now = new Date();

    try {
      // Parse schedule time (HH:MM:SS)
      const [hours, minutes, seconds] = report.schedule_time.split(':').map((n) => parseInt(n));

      // Get timezone offset (simplified - assumes timezone is UTC offset like 'UTC' or standard IANA)
      // For production, use a proper timezone library like dayjs with timezone plugin
      const timezoneOffset = this.getTimezoneOffset(report.timezone);

      let nextRun = new Date();
      nextRun.setUTCHours(hours, minutes, seconds || 0, 0);

      // Adjust for timezone offset
      nextRun = new Date(nextRun.getTime() - timezoneOffset * 60 * 60 * 1000);

      switch (report.schedule_type) {
        case 'daily':
          // If time has passed today, schedule for tomorrow
          if (nextRun <= now) {
            nextRun.setUTCDate(nextRun.getUTCDate() + 1);
          }
          break;

        case 'weekly':
          if (report.schedule_day_of_week === null) {
            throw new Error('schedule_day_of_week is required for weekly schedules');
          }

          // Find next occurrence of the target day
          const targetDay = report.schedule_day_of_week;
          const currentDay = nextRun.getUTCDay();

          let daysUntilTarget = targetDay - currentDay;
          if (daysUntilTarget < 0 || (daysUntilTarget === 0 && nextRun <= now)) {
            daysUntilTarget += 7; // Next week
          }

          nextRun.setUTCDate(nextRun.getUTCDate() + daysUntilTarget);
          break;

        case 'monthly':
          if (report.schedule_day_of_month === null) {
            throw new Error('schedule_day_of_month is required for monthly schedules');
          }

          const targetDayOfMonth = report.schedule_day_of_month;

          // Set to target day of current month
          nextRun.setUTCDate(targetDayOfMonth);

          // If already passed this month, move to next month
          if (nextRun <= now) {
            nextRun.setUTCMonth(nextRun.getUTCMonth() + 1);
            nextRun.setUTCDate(targetDayOfMonth);
          }

          // Handle months with fewer days (e.g., day 31 in February)
          // If target day doesn't exist in this month, use last day of month
          if (nextRun.getUTCDate() !== targetDayOfMonth) {
            nextRun.setUTCDate(0); // Last day of previous month
          }
          break;

        default:
          throw new Error(`Unknown schedule type: ${report.schedule_type}`);
      }

      return nextRun;
    } catch (error: any) {
      console.error('[ScheduledReports] Error calculating next run:', error.message);
      return null;
    }
  }

  /**
   * Get timezone offset in hours (simplified version)
   * For production, use a proper timezone library
   */
  private getTimezoneOffset(timezone: string): number {
    // Simplified timezone handling
    // Common timezones with UTC offset
    const timezoneMap: Record<string, number> = {
      UTC: 0,
      'America/New_York': -5, // EST (simplified, doesn't handle DST)
      'America/Chicago': -6, // CST
      'America/Denver': -7, // MST
      'America/Los_Angeles': -8, // PST
      'Europe/London': 0, // GMT
      'Europe/Paris': 1, // CET
      'Asia/Tokyo': 9, // JST
    };

    return timezoneMap[timezone] || 0;
  }

  /**
   * Determine execution status based on delivery results
   */
  private determineExecutionStatus(results: {
    emailSuccess: boolean;
    slackSuccess: boolean;
    error?: string;
  }): 'success' | 'failed' | 'partial' {
    if (results.error) {
      // If there's an error but some deliveries succeeded, it's partial
      if (results.emailSuccess || results.slackSuccess) {
        return 'partial';
      }
      return 'failed';
    }
    return 'success';
  }

  /**
   * Get human-readable report type label
   */
  private getReportTypeLabel(reportType: string): string {
    const labels: Record<string, string> = {
      cost_summary: 'Cost Summary Report',
      security_audit: 'Security Audit Report',
      compliance_status: 'Compliance Status Report',
    };
    return labels[reportType] || reportType;
  }

  /**
   * Get emoji for report type
   */
  private getReportEmoji(reportType: string): string {
    const emojis: Record<string, string> = {
      cost_summary: '💰',
      security_audit: '🛡️',
      compliance_status: '📋',
    };
    return emojis[reportType] || '📊';
  }

  /**
   * Get schedule description for display
   */
  private getScheduleDescription(report: ScheduledReport): string {
    const time = report.schedule_time.substring(0, 5); // HH:MM

    switch (report.schedule_type) {
      case 'daily':
        return `Daily at ${time} ${report.timezone}`;
      case 'weekly':
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const dayName = report.schedule_day_of_week !== null ? days[report.schedule_day_of_week] : 'Unknown';
        return `Weekly on ${dayName} at ${time} ${report.timezone}`;
      case 'monthly':
        const day = report.schedule_day_of_month || '?';
        return `Monthly on day ${day} at ${time} ${report.timezone}`;
      default:
        return 'Unknown schedule';
    }
  }

  /**
   * Generate HTML email content
   */
  private generateEmailHTML(report: ScheduledReport, reportTypeLabel: string): string {
    const scheduleDesc = this.getScheduleDescription(report);

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
    .info-row { margin: 15px 0; }
    .label { font-weight: bold; color: #4b5563; }
    .value { color: #1f2937; }
    .footer { text-align: center; margin-top: 30px; color: #6b7280; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0; font-size: 28px;">📊 ${reportTypeLabel}</h1>
      <p style="margin: 10px 0 0 0; opacity: 0.9;">Generated on ${new Date().toLocaleString()}</p>
    </div>
    <div class="content">
      <div class="info-row">
        <span class="label">Report Name:</span> <span class="value">${report.name}</span>
      </div>
      <div class="info-row">
        <span class="label">Schedule:</span> <span class="value">${scheduleDesc}</span>
      </div>
      <div class="info-row">
        <span class="label">Format:</span> <span class="value">${report.format.toUpperCase()}</span>
      </div>
      ${report.description ? `<div class="info-row"><span class="label">Description:</span> <span class="value">${report.description}</span></div>` : ''}

      <p style="margin-top: 25px; color: #4b5563;">
        Your scheduled report is attached to this email. Review the findings and take appropriate actions as needed.
      </p>
    </div>
    <div class="footer">
      <p>This is an automated report from DevControl. Do not reply to this email.</p>
      <p>&copy; ${new Date().getFullYear()} DevControl. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
    `;
  }

  // ==================== CRUD Methods ====================

  /**
   * List all schedules for an organization
   */
  async list(organizationId: string, filters?: ScheduledReportsFilters): Promise<{ reports: ScheduledReport[]; total: number }> {
    return this.repository.findAll(organizationId, filters);
  }

  /**
   * Get a single schedule by ID
   */
  async get(id: string, organizationId: string): Promise<ScheduledReport | null> {
    return this.repository.findById(id, organizationId);
  }

  /**
   * Create a new schedule
   */
  async create(data: CreateScheduledReportData): Promise<ScheduledReport> {
    // Calculate initial next_run_at
    const mockReport: ScheduledReport = {
      ...data,
      id: '',
      enabled: true,
      last_run_at: null,
      last_run_status: null,
      last_run_error: null,
      run_count: 0,
      created_at: new Date(),
      updated_at: new Date(),
      filters: data.filters || {},
      columns: data.columns || [],
      format: data.format || 'pdf',
      description: data.description || null,
      created_by: data.created_by || null,
      next_run_at: null,
      schedule_day_of_week: data.schedule_day_of_week || null,
      schedule_day_of_month: data.schedule_day_of_month || null,
    };

    const nextRunAt = this.calculateNextRun(mockReport);

    return this.repository.create({
      ...data,
      next_run_at: nextRunAt || undefined,
    });
  }

  /**
   * Update a schedule
   */
  async update(id: string, organizationId: string, data: UpdateScheduledReportData): Promise<ScheduledReport | null> {
    // If schedule configuration changed, recalculate next_run_at
    if (
      data.schedule_type ||
      data.schedule_time ||
      data.schedule_day_of_week !== undefined ||
      data.schedule_day_of_month !== undefined ||
      data.timezone
    ) {
      const current = await this.repository.findById(id, organizationId);
      if (current) {
        const updatedReport = { ...current, ...data };
        const nextRunAt = this.calculateNextRun(updatedReport as ScheduledReport);
        data.next_run_at = nextRunAt || undefined;
      }
    }

    return this.repository.update(id, organizationId, data);
  }

  /**
   * Delete a schedule
   */
  async delete(id: string, organizationId: string): Promise<boolean> {
    return this.repository.delete(id, organizationId);
  }

  /**
   * Toggle schedule enabled status
   */
  async toggle(id: string, organizationId: string, enabled: boolean): Promise<ScheduledReport | null> {
    return this.repository.update(id, organizationId, { enabled });
  }

  /**
   * Manually trigger a report (for testing)
   */
  async test(id: string, organizationId: string): Promise<void> {
    const report = await this.repository.findById(id, organizationId);
    if (!report) {
      throw new Error('Schedule not found');
    }

    await this.executeReport(report);
  }

  /**
   * Get execution history for a schedule
   */
  async getExecutions(id: string, limit?: number): Promise<ReportExecution[]> {
    return this.repository.getExecutions(id, limit);
  }

  /**
   * Get execution statistics for a schedule
   */
  async getExecutionStats(id: string) {
    return this.repository.getExecutionStats(id);
  }
}
