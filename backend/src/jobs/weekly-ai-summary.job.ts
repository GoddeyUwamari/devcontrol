/**
 * Weekly Summary Job
 * Sends the evidence-grounded weekly summary email every Monday at 9 AM.
 * The email contains no model-written content: every line comes from
 * composeWeeklySummary() (weekly-summary-content.ts).
 * Log lines keep the "[Weekly AI Summary]" prefix: weeklyEmailJobMonitor.ts
 * matches its START/COMPLETE/ERROR markers on it.
 */

import cron from 'node-cron';
import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import Handlebars from 'handlebars';
import { Resend } from 'resend';
import { WeeklySummaryRepository } from '../repositories/weekly-summary.repository';
import { requireOrganizationId } from '../services/ai-context-contract';
import {
  composeWeeklySummary,
  SUPPORT_EMAIL,
  WEEKLY_EMAIL_PATHS,
  type EmailLine,
  type EmailLink,
  type EmailSectionId,
  type WeeklySummaryContent,
} from '../services/weekly-summary-content';
import { signUnsubscribeToken } from '../services/unsubscribe-token';
import { RELEASE_SHA } from '../version';

/**
 * The subject is content.subject: "Your DevControl weekly summary · Nov 9 – 15, 2026"
 * (WE-D12), with no "AI" claim -- the email contains no model-written content.
 */
export { WEEKLY_SUMMARY_SUBJECT_PREFIX } from '../services/weekly-summary-content';

/** Replies go to the support mailbox, whatever EMAIL_FROM is (WE-D11). */
export const WEEKLY_SUMMARY_REPLY_TO = SUPPORT_EMAIL;

/** One rendered line: the text split around its bold part, with absolute link URLs. */
export interface TemplateLine {
  text: string;
  before: string;
  strong: string;
  after: string;
  hasText: boolean;
  isNote: boolean;
  isUpsell: boolean;
  chip: string;
  link: { label: string; href: string } | null;
}

export interface WeeklyEmailTemplateData {
  subject: string;
  /** The line under the title: organization · plan · cost window (UTC). */
  header: string;
  userName: string;
  organizationName: string;
  intro: string;
  status: { lines: TemplateLine[]; action: { label: string; href: string } | null } | null;
  sections: Array<{ id: EmailSectionId; title: string; cssClass: string; lines: TemplateLine[] }>;
  cta: { label: string; href: string; isButton: boolean };
  dashboardUrl: string;
  unsubscribeUrl: string;
  preferencesUrl: string;
  privacyUrl: string;
  supportEmail: string;
  year: number;
}

/** The template's colour per section (classes kept from the previous layout). */
const SECTION_CSS: Record<EmailSectionId, string> = {
  costs: 'cost',
  security: 'security',
  savings: 'recommendation',
  alerts: 'alert',
  delivery: 'dora',
};

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

      const [evidence, organizationName, planName] = await Promise.all([
        this.repository.gatherWeeklyEvidence(organizationId, new Date(), client),
        this.repository.getOrganizationName(organizationId, client),
        this.repository.getPlanName(organizationId, client),
      ]);
      const content = composeWeeklySummary(evidence, { organizationName, planName });

      const userName = recipient.fullName?.split(' ')[0] || recipient.email.split('@')[0];
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3010';
      const backendUrl = process.env.BACKEND_URL || 'http://localhost:8080';

      // Signed, purpose-bound unsubscribe token (services/unsubscribe-token.ts).
      // GET on the link only shows a confirm page; List-Unsubscribe-Post below
      // lets mail clients POST to the same URL (RFC 8058 one-click).
      const unsubscribeToken = signUnsubscribeToken(recipient.userId, 'weekly-summary');

      const templateData = this.buildTemplateData({
        userName,
        content,
        frontendUrl,
        unsubscribeUrl: `${backendUrl}/api/user/preferences/unsubscribe?token=${unsubscribeToken}`,
      });

      const html = this.emailTemplate(templateData);

      // Generate plain text version for better deliverability
      const textContent = this.generateTextVersion(templateData);

      // Send email via Resend with anti-spam headers
      try {
        const result = await this.resend.emails.send({
          from: process.env.EMAIL_FROM || 'DevControl <noreply@devcontrol.app>',
          to: recipient.email,
          replyTo: WEEKLY_SUMMARY_REPLY_TO,
          subject: templateData.subject,
          html,
          text: textContent,
          headers: {
            'List-Unsubscribe': `<${templateData.unsubscribeUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            'X-Entity-Ref-ID': `weekly-summary-${Date.now()}`,
          },
        });

        // Resend reports API failures (validation, rate limit, auth) as a
        // returned { error }, not a throw -- same check as EmailService.send.
        // A returned error is a failed send: counted as an error, never sent.
        if (result.error) {
          throw new Error(`Resend rejected the send (${result.error.name ?? 'unknown_error'})`);
        }

        // No recipient address and no provider message id in the logs.
        console.log(`[Weekly AI Summary] ✅ Sent the summary for org ${organizationId}`);
        return 'sent';
      } catch (error: any) {
        console.error(`[Weekly AI Summary] ❌ Send failed for org ${organizationId}:`, error.message);
        throw error;
      }
    } finally {
      client.release();
    }
  }

  /** Template and text-version fields from the composed content; link paths become absolute URLs. */
  buildTemplateData(input: {
    userName: string;
    content: WeeklySummaryContent;
    frontendUrl: string;
    unsubscribeUrl: string;
  }): WeeklyEmailTemplateData {
    const { content, frontendUrl } = input;
    const href = (link: EmailLink) => (link.path.startsWith('mailto:') ? link.path : `${frontendUrl}${link.path}`);
    const line = (l: EmailLine): TemplateLine => {
      const at = l.strong ? l.text.indexOf(l.strong) : -1;
      return {
        text: l.text,
        before: at === -1 ? l.text : l.text.slice(0, at),
        strong: at === -1 ? '' : l.strong!,
        after: at === -1 ? '' : l.text.slice(at + l.strong!.length),
        hasText: l.text !== '',
        isNote: l.style === 'note',
        isUpsell: l.style === 'upsell',
        chip: l.chip ?? '',
        link: l.link ? { label: l.link.label, href: href(l.link) } : null,
      };
    };
    return {
      subject: content.subject,
      header: content.header,
      userName: input.userName,
      // Named in the footer only; when the name couldn't be read, no name is invented.
      organizationName: content.organizationNameKnown ? content.organizationName : 'your organization',
      intro: content.intro,
      status: content.status
        ? {
            lines: content.status.lines.map(line),
            action: content.status.action ? { label: content.status.action.label, href: href(content.status.action) } : null,
          }
        : null,
      sections: content.sections.map(s => ({ id: s.id, title: s.title, cssClass: SECTION_CSS[s.id], lines: s.lines.map(line) })),
      cta: { label: content.cta.link.label, href: href(content.cta.link), isButton: content.cta.style === 'button' },
      dashboardUrl: `${frontendUrl}${WEEKLY_EMAIL_PATHS.dashboard}`,
      unsubscribeUrl: input.unsubscribeUrl,
      preferencesUrl: `${frontendUrl}${WEEKLY_EMAIL_PATHS.preferences}`,
      privacyUrl: `${frontendUrl}${WEEKLY_EMAIL_PATHS.privacy}`,
      supportEmail: SUPPORT_EMAIL,
      year: new Date().getFullYear(),
    };
  }

  /** The full rendered email for already-gathered evidence -- no send. */
  renderEmail(templateData: WeeklyEmailTemplateData): { html: string; text: string } {
    if (!this.emailTemplate) throw new Error('Email template not loaded');
    return { html: this.emailTemplate(templateData), text: this.generateTextVersion(templateData) };
  }

  /**
   * The plain-text part: the same lines as the HTML, a link written as
   * "Label: URL" (arrow dropped) and a chip as "(Coming soon)".
   */
  private generateTextVersion(data: WeeklyEmailTemplateData): string {
    const lineText = (l: TemplateLine) => {
      let out = l.text;
      if (l.chip) out += ` (${l.chip})`;
      if (l.link) out += `${l.hasText ? ' ' : ''}${l.link.label.replace(/ →$/, '')}: ${l.link.href}`;
      return out;
    };
    const parts: string[] = [
      'Your DevControl Weekly Summary',
      data.header,
      '',
      `Hi ${data.userName},`,
      '',
      data.intro,
    ];
    if (data.status) {
      parts.push('', ...data.status.lines.map(lineText));
      if (data.status.action) parts.push(`${data.status.action.label.replace(/ →$/, '')}: ${data.status.action.href}`);
    }
    for (const section of data.sections) {
      parts.push('', section.title, ...section.lines.map(lineText));
    }
    parts.push(
      '',
      `${data.cta.label.replace(/ →$/, '')}: ${data.cta.href}`,
      '',
      '---',
      'This is your weekly automated summary from DevControl.',
      `Unsubscribe: ${data.unsubscribeUrl}`,
      `Email Preferences: ${data.preferencesUrl}`,
      `Privacy Policy: ${data.privacyUrl}`,
      '',
      `You're receiving this because you're an owner of ${data.organizationName} and weekly summaries are on in your notification settings.`,
      '',
      'DevControl, Inc.',
      `Questions? Email ${data.supportEmail}.`,
      '',
      `© ${data.year} DevControl. All rights reserved.`,
    );
    return parts.join('\n');
  }
}
