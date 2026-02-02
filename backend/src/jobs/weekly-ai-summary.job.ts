/**
 * Weekly AI Summary Job
 * Sends AI-powered weekly summary emails every Monday at 9 AM
 */

import cron from 'node-cron';
import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import Handlebars from 'handlebars';
import { Resend } from 'resend';
import { AIInsightsService, WeeklySummaryData } from '../services/ai-insights.service';
import { WeeklySummaryRepository } from '../repositories/weekly-summary.repository';

export class WeeklyAISummaryJob {
  private aiService: AIInsightsService;
  private repository: WeeklySummaryRepository;
  private task: ReturnType<typeof cron.schedule> | null = null;
  private emailTemplate: HandlebarsTemplateDelegate | null = null;
  private resend: Resend | null = null;

  constructor(private pool: Pool) {
    this.aiService = new AIInsightsService(pool);
    this.repository = new WeeklySummaryRepository(pool);
    this.loadEmailTemplate();
    this.setupResendClient();
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
   * Setup Resend email client
   */
  private setupResendClient(): void {
    const apiKey = process.env.RESEND_API_KEY;

    if (!apiKey) {
      console.warn('[Weekly AI Summary] Resend not configured - email sending disabled');
      console.warn('  Required env var: RESEND_API_KEY');
      return;
    }

    this.resend = new Resend(apiKey);
    console.log('[Weekly AI Summary] Resend email client configured');
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
    if (!this.resend) {
      throw new Error('Resend email client not configured');
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

    // Get user ID for unsubscribe token
    const userResult = await this.pool.query(
      'SELECT id FROM users WHERE email = $1',
      [userInfo.email]
    );
    const userId = userResult.rows[0]?.id;

    // Create unsubscribe token (base64 encoded user ID)
    const unsubscribeToken = userId ? Buffer.from(userId).toString('base64') : '';
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:8080';

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
      unsubscribeUrl: `${backendUrl}/api/user/preferences/unsubscribe?token=${unsubscribeToken}`,
      preferencesUrl: `${frontendUrl}/settings/notifications`,
      privacyUrl: `${frontendUrl}/privacy`,
      year: new Date().getFullYear()
    });

    // Generate plain text version for better deliverability
    const textContent = this.generateTextVersion({
      userName,
      costSummary: aiSummary.costs.summary,
      hasAlerts: aiSummary.alerts.total > 0,
      totalAlerts: aiSummary.alerts.total,
      alertSummary: aiSummary.alerts.summary,
      doraSummary: aiSummary.dora.summary,
      recommendation: aiSummary.recommendation.text,
      estimatedSavings: aiSummary.recommendation.estimatedSavings,
      dashboardUrl: `${frontendUrl}/dashboard`,
      unsubscribeUrl: `${backendUrl}/api/user/preferences/unsubscribe?token=${unsubscribeToken}`,
      preferencesUrl: `${frontendUrl}/settings/notifications`,
    });

    // Send email via Resend with anti-spam headers
    try {
      const result = await this.resend.emails.send({
        from: process.env.EMAIL_FROM || 'DevControl <noreply@devcontrol.app>',
        to: userInfo.email,
        subject: 'Your DevControl Weekly Summary (AI-Powered)',
        html,
        text: textContent,
        headers: {
          'List-Unsubscribe': `<${backendUrl}/api/user/preferences/unsubscribe?token=${unsubscribeToken}>`,
          'X-Entity-Ref-ID': `weekly-summary-${Date.now()}`,
        },
      });

      console.log(`[Weekly AI Summary] ✅ Sent to ${userInfo.email} via Resend (ID: ${result.data?.id})`);
    } catch (error: any) {
      console.error(`[Weekly AI Summary] ❌ Failed to send to ${userInfo.email}:`, error.message);
      throw error;
    }
  }

  /**
   * Generate plain text version of email for better deliverability
   */
  private generateTextVersion(data: {
    userName: string;
    costSummary: string;
    hasAlerts: boolean;
    totalAlerts: number;
    alertSummary: string;
    doraSummary: string;
    recommendation: string;
    estimatedSavings?: number | null;
    dashboardUrl: string;
    unsubscribeUrl: string;
    preferencesUrl: string;
  }): string {
    let text = `
Your DevControl Weekly Summary
AI-Powered Infrastructure Insights

Hi ${data.userName},

Here's what happened this week:

COSTS
${data.costSummary}
`;

    if (data.hasAlerts) {
      text += `
ALERTS: ${data.totalAlerts} this week
${data.alertSummary}
`;
    }

    text += `
DORA METRICS
${data.doraSummary}

AI RECOMMENDATION
${data.recommendation}`;

    if (data.estimatedSavings) {
      text += `\nEstimated Savings: $${data.estimatedSavings}/month`;
    }

    text += `

View Full Dashboard: ${data.dashboardUrl}

---
This is your weekly automated summary from DevControl.
Unsubscribe: ${data.unsubscribeUrl}
Email Preferences: ${data.preferencesUrl}

You're receiving this email because you have an active DevControl account
with weekly summaries enabled.

DevControl, Inc.
Questions? Reply to this email or contact support.

© ${new Date().getFullYear()} DevControl. All rights reserved.
`.trim();

    return text;
  }

  /**
   * Test email configuration
   */
  async testEmailConfig(): Promise<boolean> {
    if (!this.resend) {
      console.error('[Weekly AI Summary] Resend client not configured');
      return false;
    }

    try {
      // Resend doesn't have a verify method, so we just check if the client is initialized
      console.log('[Weekly AI Summary] Resend client verified (API key configured)');
      return true;
    } catch (error: any) {
      console.error('[Weekly AI Summary] Resend config test failed:', error.message);
      return false;
    }
  }
}
