/**
 * Weekly AI Summary Job
 * Sends AI-powered weekly summary emails every Monday at 9 AM
 */

import cron from 'node-cron';
import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import Handlebars from 'handlebars';
import nodemailer from 'nodemailer';
import { AIInsightsService, WeeklySummaryData } from '../services/ai-insights.service';
import { WeeklySummaryRepository } from '../repositories/weekly-summary.repository';

export class WeeklyAISummaryJob {
  private aiService: AIInsightsService;
  private repository: WeeklySummaryRepository;
  private task: ReturnType<typeof cron.schedule> | null = null;
  private emailTemplate: HandlebarsTemplateDelegate | null = null;
  private transporter: nodemailer.Transporter | null = null;

  constructor(private pool: Pool) {
    this.aiService = new AIInsightsService(pool);
    this.repository = new WeeklySummaryRepository(pool);
    this.loadEmailTemplate();
    this.setupEmailTransporter();
  }

  /**
   * Load Handlebars email template
   */
  private loadEmailTemplate(): void {
    try {
      const templatePath = path.join(__dirname, '../templates/weekly-summary-email.html');
      if (fs.existsSync(templatePath)) {
        const templateSource = fs.readFileSync(templatePath, 'utf-8');
        this.emailTemplate = Handlebars.compile(templateSource);
        console.log('[Weekly AI Summary] Email template loaded');
      } else {
        console.warn('[Weekly AI Summary] Email template not found at:', templatePath);
      }
    } catch (error: any) {
      console.error('[Weekly AI Summary] Failed to load email template:', error.message);
    }
  }

  /**
   * Setup nodemailer transporter
   */
  private setupEmailTransporter(): void {
    const host = process.env.SMTP_HOST;
    const port = parseInt(process.env.SMTP_PORT || '587');
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (!host || !user || !pass) {
      console.warn('[Weekly AI Summary] SMTP not configured - email sending disabled');
      console.warn('  Required env vars: SMTP_HOST, SMTP_USER, SMTP_PASS');
      return;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });

    console.log('[Weekly AI Summary] Email transporter configured');
  }

  /**
   * Start the cron job
   */
  start(): void {
    // Run every Monday at 9 AM (0 9 * * 1)
    this.task = cron.schedule('0 9 * * 1', async () => {
      console.log('[Weekly AI Summary] Starting weekly summary job...');
      try {
        await this.sendWeeklySummaries();
      } catch (error: any) {
        console.error('[Weekly AI Summary] Job error:', error.message);
      }
    });

    console.log('[Weekly AI Summary] Job scheduled - runs every Monday at 9 AM');
  }

  /**
   * Stop the cron job
   */
  stop(): void {
    if (this.task) {
      this.task.stop();
      console.log('[Weekly AI Summary] Job stopped');
    }
  }

  /**
   * Manually trigger summary (for testing)
   */
  async triggerManual(organizationId?: string): Promise<{ sent: number; errors: number }> {
    console.log('[Weekly AI Summary] Manual trigger...');

    if (organizationId) {
      try {
        await this.sendSummaryForOrganization(organizationId);
        return { sent: 1, errors: 0 };
      } catch (error: any) {
        console.error('[Weekly AI Summary] Manual trigger failed:', error.message);
        return { sent: 0, errors: 1 };
      }
    }

    return await this.sendWeeklySummaries();
  }

  /**
   * Send weekly summaries to all active organizations
   */
  private async sendWeeklySummaries(): Promise<{ sent: number; errors: number }> {
    const organizations = await this.repository.getActiveOrganizations();
    console.log(`[Weekly AI Summary] Found ${organizations.length} organizations`);

    let sent = 0;
    let errors = 0;

    for (const orgId of organizations) {
      try {
        await this.sendSummaryForOrganization(orgId);
        sent++;
      } catch (error: any) {
        console.error(`[Weekly AI Summary] Failed for org ${orgId}:`, error.message);
        errors++;
      }
    }

    console.log(`[Weekly AI Summary] Completed: ${sent} sent, ${errors} errors`);
    return { sent, errors };
  }

  /**
   * Send summary for a single organization
   */
  private async sendSummaryForOrganization(organizationId: string): Promise<void> {
    if (!this.transporter) {
      throw new Error('Email transporter not configured');
    }

    if (!this.emailTemplate) {
      throw new Error('Email template not loaded');
    }

    // Calculate date range (last 7 days)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);

    const query = { organizationId, startDate, endDate };

    // Gather weekly data in parallel
    const [costData, previousCost, alertsData, userInfo, doraMetrics] = await Promise.all([
      this.repository.getWeeklyCostData(query),
      this.repository.getPreviousWeekCostData(query),
      this.repository.getWeeklyAlerts(query),
      this.repository.getUserInfo(organizationId),
      this.repository.getWeeklyDORAMetrics(query)
    ]);

    if (!userInfo?.email) {
      console.log(`[Weekly AI Summary] No email found for org ${organizationId}`);
      return;
    }

    // Calculate current cost total
    const currentCost = costData.reduce((sum, item) => sum + parseFloat(item.total_cost || '0'), 0);
    const changePercent = previousCost > 0 ? ((currentCost - previousCost) / previousCost) * 100 : 0;

    // Build weekly summary data
    const weeklyData: WeeklySummaryData = {
      costs: {
        previous: previousCost,
        current: currentCost,
        changePercent: Math.round(changePercent * 100) / 100,
        topChanges: costData.slice(0, 3).map(item => ({
          service: item.resource_type,
          change: 0 // Would need historical data to calculate change
        }))
      },
      alerts: {
        total: alertsData.total,
        critical: alertsData.critical,
        topAlert: alertsData.topAlert
      },
      dora: doraMetrics
    };

    // Generate AI summary
    const aiSummary = await this.aiService.generateWeeklySummary(weeklyData);

    // Render email HTML
    const userName = userInfo.fullName?.split(' ')[0] || userInfo.email.split('@')[0];
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3010';

    const html = this.emailTemplate({
      userName,
      costSummary: aiSummary.costs.summary,
      hasAlerts: aiSummary.alerts.total > 0,
      totalAlerts: aiSummary.alerts.total,
      alertSummary: aiSummary.alerts.summary,
      doraSummary: aiSummary.dora.summary,
      recommendation: aiSummary.recommendation.text,
      estimatedSavings: aiSummary.recommendation.estimatedSavings,
      dashboardUrl: `${frontendUrl}/dashboard`,
      unsubscribeUrl: `${frontendUrl}/settings/notifications`,
      preferencesUrl: `${frontendUrl}/settings/notifications`,
      year: new Date().getFullYear()
    });

    // Send email
    await this.transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: userInfo.email,
      subject: 'Your DevControl Weekly Summary (AI-Powered)',
      html,
    });

    console.log(`[Weekly AI Summary] Sent to ${userInfo.email}`);
  }

  /**
   * Test email configuration
   */
  async testEmailConfig(): Promise<boolean> {
    if (!this.transporter) {
      console.error('[Weekly AI Summary] Transporter not configured');
      return false;
    }

    try {
      await this.transporter.verify();
      console.log('[Weekly AI Summary] Email configuration verified');
      return true;
    } catch (error: any) {
      console.error('[Weekly AI Summary] Email config test failed:', error.message);
      return false;
    }
  }
}
