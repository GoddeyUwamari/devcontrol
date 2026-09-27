/**
 * Weekly Summary Job
 * Sends the evidence-grounded weekly summary email every Monday at 9 AM.
 * The email contains no model-written content (see generateAIRecommendation).
 * Log lines keep the "[Weekly AI Summary]" prefix: weeklyEmailJobMonitor.ts
 * matches its START/COMPLETE/ERROR markers on it.
 */

import cron from 'node-cron';
import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import Handlebars from 'handlebars';
import { Resend } from 'resend';
import { WeeklySummaryRepository, type WeeklyEvidence } from '../repositories/weekly-summary.repository';
import { requireOrganizationId } from '../services/ai-context-contract';
import { composeWeeklySummary, type WeeklySummaryContent } from '../services/weekly-summary-content';
import { RELEASE_SHA } from '../version';

/** No "AI" claim: the email contains no model-written content. */
export const WEEKLY_SUMMARY_SUBJECT = 'Your DevControl Weekly Summary';

export interface WeeklyEmailTemplateData {
  userName: string;
  costSummary: string;
  securitySummary: string;
  alertSummary: string;
  deliverySummary: string;
  hasRecommendations: boolean;
  recommendation?: string;
  savingsSummary?: string;
  dashboardUrl: string;
  unsubscribeUrl: string;
  preferencesUrl: string;
  privacyUrl: string;
  year: number;
}

export class WeeklyAISummaryJob {
  private repository: WeeklySummaryRepository;
  private task: ReturnType<typeof cron.schedule> | null = null;
  private emailTemplate: HandlebarsTemplateDelegate | null = null;
  private resend: Resend | null = null;

  constructor(private pool: Pool) {
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
      try {
        await this.sendWeeklySummaries();
      } catch (error: any) {
        // sendWeeklySummaries() already catches every per-org failure internally
        // and never rethrows for those -- reaching here means something broke
        // before/outside the per-org loop (e.g. getActiveOrganizations() itself
        // failing), so no COMPLETE marker was ever logged for this run. Emitted
        // as its own structured marker (see weeklyEmailJobMonitor.ts) rather than
        // relying on a bare stack trace to be greppable.
        console.error(`[Weekly AI Summary] ERROR ${JSON.stringify({
          timestamp: new Date().toISOString(),
          message: error.message,
          releaseSha: RELEASE_SHA,
        })}`);
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
   * Manually send one organization's summary (the authenticated trigger route).
   * Always a single organization -- never a fallthrough to every org -- and
   * subject to the same recipient eligibility as the scheduled run.
   */
  async triggerManual(organizationId: string): Promise<{ sent: number; skipped: number; errors: number }> {
    requireOrganizationId(organizationId, 'Weekly AI Summary', 'a manual weekly summary');
    console.log('[Weekly AI Summary] Manual trigger...');

    try {
      const outcome = await this.sendSummaryForOrganization(organizationId);
      return outcome === 'sent' ? { sent: 1, skipped: 0, errors: 0 } : { sent: 0, skipped: 1, errors: 0 };
    } catch (error: any) {
      console.error('[Weekly AI Summary] Manual trigger failed:', error.message);
      return { sent: 0, skipped: 0, errors: 1 };
    }
  }

  /**
   * Send weekly summaries to all active organizations.
   *
   * Emits a structured START marker here and a matching COMPLETE marker at
   * the end -- the only two lines weeklyEmailJobMonitor.ts's read-only,
   * production-log-based monitor looks for to establish whether a given
   * Monday run happened, finished, and under which release. Deliberately
   * carries only counts and the release SHA, never an org id, email address,
   * or any other customer-identifying data. `skipped` counts organizations
   * with no eligible recipient -- they are not counted as sent.
   */
  private async sendWeeklySummaries(): Promise<{ sent: number; skipped: number; errors: number }> {
    const startedAt = new Date();
    console.log(`[Weekly AI Summary] START ${JSON.stringify({
      timestamp: startedAt.toISOString(),
      releaseSha: RELEASE_SHA,
    })}`);

    const organizations = await this.repository.getActiveOrganizations();
    console.log(`[Weekly AI Summary] Found ${organizations.length} organizations`);

    let sent = 0;
    let skipped = 0;
    let errors = 0;

    for (const orgId of organizations) {
      try {
        const outcome = await this.sendSummaryForOrganization(orgId);
        if (outcome === 'sent') sent++;
        else skipped++;
      } catch (error: any) {
        console.error(`[Weekly AI Summary] Failed for org ${orgId}:`, error.message);
        errors++;
      }
    }

    const completedAt = new Date();
    console.log(`[Weekly AI Summary] COMPLETE ${JSON.stringify({
      timestamp: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
      organizations: organizations.length,
      sent,
      skipped,
      errors,
      releaseSha: RELEASE_SHA,
    })}`);
    return { sent, skipped, errors };
  }

  /**
   * Send summary for a single organization. Returns 'skipped' (nothing
   * gathered, nothing sent) when the organization has no eligible recipient.
   */
  private async sendSummaryForOrganization(organizationId: string): Promise<'sent' | 'skipped'> {
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

      // Eligibility first (opted in + verified owner, see getUserInfo), so an
      // ineligible org costs no Cost Explorer or model calls.
      const recipient = await this.repository.getUserInfo(organizationId, client);
      if (!recipient) {
        console.log(`[Weekly AI Summary] No eligible recipient for org ${organizationId} -- skipped`);
        return 'skipped';
      }

      const evidence = await this.repository.gatherWeeklyEvidence(organizationId, new Date(), client);
      const content = composeWeeklySummary(evidence);
      const recommendation = await this.generateAIRecommendation(evidence, content);

      const userName = recipient.fullName?.split(' ')[0] || recipient.email.split('@')[0];
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3010';
      const backendUrl = process.env.BACKEND_URL || 'http://localhost:8080';

      // Unsubscribe token (base64 encoded user ID) -- unchanged scheme, see
      // user-preferences.controller.ts unsubscribeAll().
      const unsubscribeToken = Buffer.from(recipient.userId).toString('base64');

      const templateData = this.buildTemplateData({
        userName,
        content,
        recommendation,
        dashboardUrl: `${frontendUrl}/dashboard`,
        unsubscribeUrl: `${backendUrl}/api/user/preferences/unsubscribe?token=${unsubscribeToken}`,
        preferencesUrl: `${frontendUrl}/settings/notifications`,
        privacyUrl: `${frontendUrl}/privacy`,
      });

      const html = this.emailTemplate(templateData);

      // Generate plain text version for better deliverability
      const textContent = this.generateTextVersion(templateData);

      // Send email via Resend with anti-spam headers
      try {
        const result = await this.resend.emails.send({
          from: process.env.EMAIL_FROM || 'DevControl <noreply@devcontrol.app>',
          to: recipient.email,
          subject: WEEKLY_SUMMARY_SUBJECT,
          html,
          text: textContent,
          headers: {
            'List-Unsubscribe': `<${templateData.unsubscribeUrl}>`,
            'X-Entity-Ref-ID': `weekly-summary-${Date.now()}`,
          },
        });

        // Resend reports API failures (validation, rate limit, auth) as a
        // returned { error }, not a throw -- same check as EmailService.send.
        // A returned error is a failed send: counted as an error, never sent.
        if (result.error) {
          throw new Error(`Resend rejected the send (${result.error.name ?? 'unknown_error'})`);
        }

        console.log(`[Weekly AI Summary] ✅ Sent to ${recipient.email} via Resend (ID: ${result.data?.id})`);
        return 'sent';
      } catch (error: any) {
        console.error(`[Weekly AI Summary] ❌ Failed to send to ${recipient.email}:`, error.message);
        throw error;
      }
    } finally {
      client.release();
    }
  }

  /** Template/text-version fields, from the deterministic content plus the optional model recommendation. */
  buildTemplateData(input: {
    userName: string;
    content: WeeklySummaryContent;
    recommendation: string | null;
    dashboardUrl: string;
    unsubscribeUrl: string;
    preferencesUrl: string;
    privacyUrl: string;
  }): WeeklyEmailTemplateData {
    const { content, recommendation } = input;
    return {
      userName: input.userName,
      costSummary: content.costSummary,
      securitySummary: content.securitySummary,
      alertSummary: content.alertSummary,
      deliverySummary: content.deliverySummary,
      hasRecommendations: recommendation !== null || content.savingsSummary !== null,
      recommendation: recommendation ?? undefined,
      savingsSummary: content.savingsSummary ?? undefined,
      dashboardUrl: input.dashboardUrl,
      unsubscribeUrl: input.unsubscribeUrl,
      preferencesUrl: input.preferencesUrl,
      privacyUrl: input.privacyUrl,
      year: new Date().getFullYear(),
    };
  }

  /** The full rendered email for already-gathered evidence -- no send. */
  renderEmail(templateData: WeeklyEmailTemplateData): { html: string; text: string } {
    if (!this.emailTemplate) throw new Error('Email template not loaded');
    return { html: this.emailTemplate(templateData), text: this.generateTextVersion(templateData) };
  }

  /**
   * The model-written recommendation is DISABLED: always null, and no model
   * call is made. PR #136 review finding B1 showed the denylist in
   * checkRecommendationText() (weekly-summary-content.ts) lets evidence-
   * contradicting prose through -- "No security issues were detected" while
   * security is unavailable, "Your monthly spend is $X" for a 7-day figure,
   * spelled-out or "k"/"percent" figures, "guaranteed" savings, and
   * downsizing/reservation advice. buildRecommendationPrompt() and
   * checkRecommendationText() are kept, unused, pending a grounded redesign
   * (e.g. an allowlist of evidence figures and claims); re-enabling needs
   * that redesign, not this denylist.
   */
  async generateAIRecommendation(_evidence: WeeklyEvidence, _content: WeeklySummaryContent): Promise<string | null> {
    return null;
  }

  /**
   * Generate plain text version of email for better deliverability
   */
  private generateTextVersion(data: WeeklyEmailTemplateData): string {
    let text = `
Your DevControl Weekly Summary
Cost, security, and delivery summary

Hi ${data.userName},

Here's your DevControl summary for the past week:

COSTS
${data.costSummary}

SECURITY
${data.securitySummary}

ALERTS
${data.alertSummary}

DELIVERY
${data.deliverySummary}
`;

    if (data.hasRecommendations) {
      text += `
RECOMMENDATIONS`;
      if (data.recommendation) {
        text += `
AI recommendation: ${data.recommendation}`;
      }
      if (data.savingsSummary) {
        text += `
${data.savingsSummary}`;
      }
      text += '\n';
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

© ${data.year} DevControl. All rights reserved.
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
