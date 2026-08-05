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
import { RiskTrackingService } from '../services/risk-tracking.service';
import { CostRecommendationsRepository } from '../repositories/cost-recommendations.repository';
import { AccountSecurityFindingsRepository } from '../repositories/account-security-findings.repository';

export class WeeklyAISummaryJob {
  private aiService: AIInsightsService;
  private repository: WeeklySummaryRepository;
  private riskTrackingService: RiskTrackingService;
  private costRecommendationsRepository: CostRecommendationsRepository;
  private accountFindingsRepository: AccountSecurityFindingsRepository;
  private task: ReturnType<typeof cron.schedule> | null = null;
  private emailTemplate: HandlebarsTemplateDelegate | null = null;
  private resend: Resend | null = null;

  constructor(private pool: Pool) {
    this.aiService = new AIInsightsService(pool);
    this.repository = new WeeklySummaryRepository(pool);
    this.riskTrackingService = new RiskTrackingService(pool);
    this.costRecommendationsRepository = new CostRecommendationsRepository();
    this.accountFindingsRepository = new AccountSecurityFindingsRepository();
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

    // Single held client for the whole run: org context below is session-scoped
    // (is_local = false) and threaded through every query on this connection, same
    // pattern as RiskTrackingService.storeAllOrganizationSnapshots() /
    // AnomalyDetectionJob.runDetection() (see a1f894b). pool.query() per-call would
    // silently drop the context on a different pooled connection.
    const client = await this.pool.connect();
    try {
      await client.query(
        "SELECT set_config('app.current_organization_id', $1, false)",
        [organizationId]
      );

      // Calculate date range (last 7 days)
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 7);

      const query = { organizationId, startDate, endDate };

      // Gather weekly data in parallel
      const [costData, costComparison, alertsData, userInfo, doraMetrics] = await Promise.all([
        this.repository.getWeeklyCostData(query, client),
        this.repository.getWeeklyCostComparison(query, client),
        this.repository.getWeeklyAlerts(query, client),
        this.repository.getUserInfo(organizationId, client),
        this.repository.getWeeklyDORAMetrics(query, client)
      ]);

      if (!userInfo?.email) {
        console.log(`[Weekly AI Summary] No email found for org ${organizationId}`);
        return;
      }

      const { currentCost, previousCost, hasComparableCosts, costSource } = costComparison;
      const changePercent = hasComparableCosts && previousCost
        ? ((currentCost - previousCost) / previousCost) * 100
        : 0;

      let costSummaryText: string;
      if (hasComparableCosts && previousCost) {
        const direction = changePercent >= 0 ? 'increased' : 'decreased';
        costSummaryText = `Costs ${direction} ${Math.abs(changePercent).toFixed(1)}% this week ($${previousCost.toFixed(0)} → $${currentCost.toFixed(0)}).`;
      } else if (currentCost > 0) {
        costSummaryText = costSource === 'estimated'
          ? `Estimated cloud spend: $${currentCost.toFixed(0)} (connect an AWS account for week-over-week trends).`
          : `New spend detected: $${currentCost.toFixed(0)} this week.`;
      } else {
        costSummaryText = 'No cloud spend recorded this week.';
      }

      // DORA section is only meaningful once there's real pipeline activity —
      // deploymentFrequency parses to a number even in its "0.0 per day" empty state,
      // so pair it with leadTime still being 'N/A' to detect "nothing has happened yet".
      const deploymentFreqValue = parseFloat(doraMetrics.deploymentFrequency);
      const hasDora = !((isNaN(deploymentFreqValue) || deploymentFreqValue === 0) && doraMetrics.leadTime === 'N/A');

      // Build weekly summary data
      const weeklyData: WeeklySummaryData = {
        costs: {
          previous: previousCost ?? 0,
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
          topAlert: alertsData.topAlert ?? undefined
        },
        dora: doraMetrics
      };

      // Generate AI summary for alerts/dora narrative — cost summary is overwritten
      // below with deterministic text since arithmetic shouldn't be left to AI/fallback.
      const aiSummary = await this.aiService.generateWeeklySummary(weeklyData);
      aiSummary.costs.summary = costSummaryText;

      // Real AI recommendation grounded in this org's actual data — omitted entirely
      // (not a generic fallback string) if generation fails or there's nothing real to say.
      const recommendation = await this.generateAIRecommendation(organizationId, currentCost);

      // Render email HTML
      const userName = userInfo.fullName?.split(' ')[0] || userInfo.email.split('@')[0];
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3010';

      // Get user ID for unsubscribe token
      const userResult = await client.query(
        'SELECT id FROM users WHERE email = $1',
        [userInfo.email]
      );
      const userId = userResult.rows[0]?.id;

      // Create unsubscribe token (base64 encoded user ID)
      const unsubscribeToken = userId ? Buffer.from(userId).toString('base64') : '';
      const backendUrl = process.env.BACKEND_URL || 'http://localhost:8080';

      const templateData = {
        userName,
        costSummary: aiSummary.costs.summary,
        hasAlerts: aiSummary.alerts.total > 0,
        totalAlerts: aiSummary.alerts.total,
        alertSummary: aiSummary.alerts.summary,
        hasDora,
        doraSummary: aiSummary.dora.summary,
        hasRecommendation: recommendation !== null,
        recommendation: recommendation?.text,
        estimatedSavings: recommendation?.estimatedSavings,
        dashboardUrl: `${frontendUrl}/dashboard`,
        unsubscribeUrl: `${backendUrl}/api/user/preferences/unsubscribe?token=${unsubscribeToken}`,
        preferencesUrl: `${frontendUrl}/settings/notifications`,
        privacyUrl: `${frontendUrl}/privacy`,
        year: new Date().getFullYear()
      };

      const html = this.emailTemplate(templateData);

      // Generate plain text version for better deliverability
      const textContent = this.generateTextVersion(templateData);

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
    } finally {
      client.release();
    }
  }

  /**
   * Build a fact-only prompt from this org's real security/cost data and ask Claude
   * for a short recommendation — same fact-gathering shape as AISummaryService, but
   * for the weekly email context. Returns null (never a generic placeholder) if AI
   * generation fails or there's nothing real to recommend on.
   */
  private async generateAIRecommendation(
    organizationId: string,
    monthlySpend: number
  ): Promise<{ text: string; estimatedSavings: number | null } | null> {
    try {
      const [riskScore, costStats, activeFindings] = await Promise.all([
        this.riskTrackingService.getCurrentRiskScore(organizationId),
        this.costRecommendationsRepository.getStats(organizationId),
        this.accountFindingsRepository.getActive(organizationId)
      ]);

      const facts: string[] = [];

      if (!riskScore.isPreliminary) {
        // Same split as AISummaryService's dashboard summary: complianceIssueCounts
        // combines account-level findings (security groups, IAM) with per-resource
        // compliance issues (encryption/backup/tagging/SOC2/HIPAA) from two different
        // scanners — report them separately instead of one undifferentiated total.
        const c = riskScore.complianceIssueCounts;
        const totalCombined = c.critical + c.high + c.medium + c.low;
        const accountLevelCount = activeFindings.length;
        const resourceComplianceCount = totalCombined - accountLevelCount;
        facts.push(
          `Security posture score: ${riskScore.score}/100 — ${accountLevelCount} account-level ` +
          `finding${accountLevelCount !== 1 ? 's' : ''} (security groups, IAM) and ` +
          `${resourceComplianceCount} resource compliance issue${resourceComplianceCount !== 1 ? 's' : ''} ` +
          `(encryption, backups, tagging, SOC2/HIPAA checks) currently active.`
        );
      }

      if (costStats.active_recommendations > 0) {
        facts.push(
          `${costStats.active_recommendations} active cost optimization` +
          `${costStats.active_recommendations !== 1 ? 's' : ''} could save approximately ` +
          `$${Math.round(costStats.total_potential_savings).toLocaleString()}/month.`
        );
      }

      if (monthlySpend > 0) {
        facts.push(`Current monthly cloud spend is $${Math.round(monthlySpend).toLocaleString()}.`);
      }

      if (facts.length === 0) return null;

      const prompt =
        `You are writing a single, specific, actionable recommendation for a weekly ` +
        `cloud infrastructure email, aimed at an engineering lead.\n\n` +
        `Use ONLY the facts below. Do not invent, estimate, or assume anything not explicitly ` +
        `stated. Do not add generic advice like "review your dashboard".\n\n` +
        `Facts:\n${facts.map((f) => `- ${f}`).join('\n')}\n\n` +
        `Write the recommendation now (1-2 sentences, no preamble, no markdown):`;

      const text = await this.aiService.generateDashboardSummary(prompt);
      if (!text) return null;

      const estimatedSavings = costStats.active_recommendations > 0
        ? Math.round(costStats.total_potential_savings)
        : null;

      return { text, estimatedSavings };
    } catch (error: any) {
      console.error('[Weekly AI Summary] AI recommendation generation failed:', error.message);
      return null;
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
    hasDora: boolean;
    doraSummary: string;
    hasRecommendation: boolean;
    recommendation?: string;
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

    if (data.hasDora) {
      text += `
DORA METRICS
${data.doraSummary}
`;
    }

    if (data.hasRecommendation) {
      text += `
AI RECOMMENDATION
${data.recommendation}`;

      if (data.estimatedSavings) {
        text += `\nEstimated Savings: $${data.estimatedSavings}/month`;
      }
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
