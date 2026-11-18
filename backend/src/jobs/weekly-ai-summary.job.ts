/**
 * Weekly Summary Job
 * Sends the evidence-grounded weekly summary email every Monday at 09:00 UTC
 * to every eligible owner of every eligible organization.
 * The email contains no model-written content: every line comes from
 * composeWeeklyBrief() (services/weekly-brief/rules.ts) over the facts
 * WeeklySummaryRepository.buildWeeklyFacts() reads.
 * Log lines keep the "[Weekly AI Summary]" prefix: weeklyEmailJobMonitor.ts
 * matches its START/COMPLETE/ERROR markers on it.
 */

import cron from 'node-cron';
import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import Handlebars from 'handlebars';
import { Resend } from 'resend';
import {
  WeeklySummaryRepository,
  WEEKLY_SUMMARY_ORG_PAGE_SIZE,
  type UserInfo,
} from '../repositories/weekly-summary.repository';
import { requireOrganizationId } from '../services/ai-context-contract';
import { composeWeeklyBrief, type BriefCostSection, type BriefLink, type BriefTile, type WeeklyBrief } from '../services/weekly-brief/rules';
import { SUPPORT_EMAIL, WEEKLY_EMAIL_PATHS } from '../config/weekly-email-paths';
import { signUnsubscribeToken } from '../services/unsubscribe-token';
import { RELEASE_SHA } from '../version';
import { safeErrorFields } from '../utils/safe-error-log';

/**
 * The subject is brief.subject: "Your DevControl weekly summary · Nov 9 – 15, 2026"
 * (WE-D12), with no "AI" claim -- the email contains no model-written content.
 */
export { WEEKLY_SUMMARY_SUBJECT_PREFIX } from '../services/weekly-brief/rules';

/** Mondays at 09:00 (minute hour day-of-month month day-of-week). */
export const WEEKLY_SUMMARY_CRON = '0 9 * * 1';
/**
 * The schedule's time zone, pinned so the send time never follows the host's
 * zone (WE-D8). The notification settings say "09:00 UTC".
 */
export const WEEKLY_SUMMARY_TIMEZONE = 'Etc/UTC';

/** One organization's outcome: how many of its owners were sent the email, and how many sends failed. */
export interface OrganizationSendOutcome {
  recipients: number;
  sent: number;
  failed: number;
}

/** Counts for a run or a manual send. `skipped` = organizations with no eligible owner. */
export interface WeeklySummaryRunCounts {
  sent: number;
  skipped: number;
  errors: number;
}

/** Replies go to the support mailbox, whatever EMAIL_FROM is (WE-D11). */
export const WEEKLY_SUMMARY_REPLY_TO = SUPPORT_EMAIL;

interface TemplateLink {
  label: string;
  href: string;
}

/** Everything the template renders: the composed brief with absolute link URLs, the greeting and the fixed footer fields. */
export interface WeeklyEmailTemplateData {
  subject: string;
  eyebrow: string;
  title: string;
  orgLine: string | null;
  userName: string;
  summary: { bold: string; plain: string };
  tiles: BriefTile[];
  attention: Array<{ number: number; title: string; body: string[]; time: string | null; link: TemplateLink; tint: string; border: string; ink: string }>;
  notConnected: { status: string[]; action: TemplateLink; sections: Array<{ title: string; line: string }> } | null;
  /** Each cost line split around its bold part. */
  cost: { lines: Array<{ text: string; before: string; strong: string; after: string }>; services: BriefCostSection['services']; link: TemplateLink } | null;
  delivery: { line: string; link: TemplateLink };
  button: TemplateLink & { isButton: boolean };
  footer: { lines: string[]; alarms: { text: string; link: TemplateLink | null } };
  organizationName: string;
  dashboardUrl: string;
  unsubscribeUrl: string;
  preferencesUrl: string;
  privacyUrl: string;
  supportEmail: string;
  year: number;
}

/** The attention box colours per tone (mock: security orange, cost blue). */
const TONE_COLOURS: Record<'warning' | 'info', { tint: string; border: string; ink: string }> = {
  warning: { tint: '#FFF7ED', border: '#FED7AA', ink: '#C2410C' },
  info: { tint: '#EFF6FF', border: '#BFDBFE', ink: '#1D4ED8' },
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
   * Start the cron job: Mondays at 09:00 in WEEKLY_SUMMARY_TIMEZONE.
   */
  start(): void {
    this.task = cron.schedule(WEEKLY_SUMMARY_CRON, async () => {
      try {
        await this.sendWeeklySummaries();
      } catch (error: any) {
        // sendWeeklySummaries() already catches every per-org and per-recipient
        // failure internally and never rethrows for those -- reaching here
        // means something broke outside them (e.g. reading a page of
        // organizations failed), so no COMPLETE marker was ever logged for
        // this run. Emitted as its own structured marker (see
        // weeklyEmailJobMonitor.ts) rather than relying on a bare stack trace
        // to be greppable.
        console.error(`[Weekly AI Summary] ERROR ${JSON.stringify({
          timestamp: new Date().toISOString(),
          message: safeErrorFields(error).message,
          releaseSha: RELEASE_SHA,
        })}`);
      }
    }, { timezone: WEEKLY_SUMMARY_TIMEZONE });

    console.log('[Weekly AI Summary] Job scheduled - runs every Monday at 09:00 UTC');
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
   * Manually send one organization's summary (the authenticated trigger route)
   * to each of its eligible owners. Always a single organization -- never a
   * fallthrough to every org -- and subject to the same recipient eligibility
   * as the scheduled run. `sent` and `errors` count emails; `skipped` is 1
   * when no owner is eligible.
   */
  async triggerManual(organizationId: string): Promise<WeeklySummaryRunCounts> {
    requireOrganizationId(organizationId, 'Weekly AI Summary', 'a manual weekly summary');
    console.log('[Weekly AI Summary] Manual trigger...');

    try {
      const outcome = await this.sendSummaryForOrganization(organizationId);
      if (outcome.recipients === 0) return { sent: 0, skipped: 1, errors: 0 };
      return { sent: outcome.sent, skipped: 0, errors: outcome.failed };
    } catch (error: unknown) {
      console.error('[Weekly AI Summary] Manual trigger failed:', safeErrorFields(error));
      return { sent: 0, skipped: 0, errors: 1 };
    }
  }

  /**
   * Send weekly summaries to every eligible organization, a page at a time
   * (getActiveOrganizationsPage: id order, bounded page size), until a short
   * page. One organization's failure, or one recipient's, is counted and the
   * run goes on.
   *
   * Emits a structured START marker here and a matching COMPLETE marker at
   * the end -- the only two lines weeklyEmailJobMonitor.ts's read-only,
   * production-log-based monitor looks for to establish whether a given
   * Monday run happened, finished, and under which release. Every log line
   * of the run carries only counts, error names and the release SHA -- never
   * an org id, email address, provider message id, or any other
   * customer-identifying data.
   *
   * COMPLETE counts: `organizations` visited; `sent` emails accepted;
   * `skipped` organizations with no eligible owner; `errors` =
   * `failedOrganizations` (nothing could be sent for the organization) +
   * `failedSends` (one recipient's email failed).
   */
  private async sendWeeklySummaries(pageSize?: number): Promise<WeeklySummaryRunCounts> {
    const startedAt = new Date();
    console.log(`[Weekly AI Summary] START ${JSON.stringify({
      timestamp: startedAt.toISOString(),
      releaseSha: RELEASE_SHA,
    })}`);

    let organizations = 0;
    let pages = 0;
    let recipients = 0;
    let sent = 0;
    let skipped = 0;
    let failedOrganizations = 0;
    let failedSends = 0;

    let afterId: string | null = null;
    const limit = pageSize ?? WEEKLY_SUMMARY_ORG_PAGE_SIZE;
    for (;;) {
      const page = await this.repository.getActiveOrganizationsPage(afterId, limit);
      pages++;
      // Pages are in id order after the cursor. A page that doesn't move past
      // it would revisit organizations (and send twice), so the run stops.
      if (afterId !== null && page.length > 0 && !(page[0] > afterId)) {
        throw new Error('Organization paging did not advance');
      }
      for (const orgId of page) {
        organizations++;
        try {
          const outcome = await this.sendSummaryForOrganization(orgId);
          if (outcome.recipients === 0) skipped++;
          recipients += outcome.recipients;
          sent += outcome.sent;
          failedSends += outcome.failed;
        } catch (error: unknown) {
          console.error('[Weekly AI Summary] An organization failed:', safeErrorFields(error));
          failedOrganizations++;
        }
      }
      if (page.length < limit) break;
      afterId = page[page.length - 1];
    }

    const errors = failedOrganizations + failedSends;
    const completedAt = new Date();
    console.log(`[Weekly AI Summary] COMPLETE ${JSON.stringify({
      timestamp: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
      organizations,
      pages,
      recipients,
      sent,
      skipped,
      errors,
      failedOrganizations,
      failedSends,
      releaseSha: RELEASE_SHA,
    })}`);
    return { sent, skipped, errors };
  }

  /**
   * Send one organization's summary to each of its eligible owners. The
   * evidence is gathered once, on one connection tagged for the
   * organization; each owner gets their own greeting and their own signed
   * unsubscribe link. A failed send to one owner is counted and the others
   * are still sent. Gathers nothing when no owner is eligible
   * (`recipients: 0`). Throws when nothing can be sent for the organization
   * (no email client or template, or a failed read).
   */
  private async sendSummaryForOrganization(organizationId: string): Promise<OrganizationSendOutcome> {
    if (!this.resend) {
      throw new Error('Resend email client not configured');
    }

    if (!this.emailTemplate) {
      throw new Error('Email template not loaded');
    }

    // One held client for the organization, tagged session-scoped: every read
    // below runs under its tenant context, the same way the preview reads
    // (WeeklySummaryRepository.withOrganizationClient).
    return this.repository.withOrganizationClient(organizationId, async (client) => {
      // Eligibility first (opted in + verified owners, see getRecipients), so
      // an ineligible org costs no Cost Explorer calls.
      const recipients = await this.repository.getRecipients(organizationId, client);
      if (recipients.length === 0) {
        return { recipients: 0, sent: 0, failed: 0 };
      }

      const [facts, organizationName, planName] = await Promise.all([
        this.repository.buildWeeklyFacts(organizationId, new Date(), client),
        this.repository.getOrganizationName(organizationId, client),
        this.repository.getPlanName(organizationId, client),
      ]);
      const brief = composeWeeklyBrief(facts, { organizationName, planName });

      let sent = 0;
      let failed = 0;
      for (const recipient of recipients) {
        try {
          await this.sendToRecipient(recipient, brief, organizationName);
          sent++;
        } catch (error: unknown) {
          // No recipient address and no provider message id in the logs.
          console.error('[Weekly AI Summary] ❌ A send failed:', safeErrorFields(error));
          failed++;
        }
      }
      return { recipients: recipients.length, sent, failed };
    });
  }

  /** Render and send the composed brief to one owner, with that owner's own unsubscribe link. */
  private async sendToRecipient(recipient: UserInfo, brief: WeeklyBrief, organizationName: string | null): Promise<void> {
    const userName = recipient.fullName?.split(' ')[0] || recipient.email.split('@')[0];
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3010';
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:8080';

    // Signed, purpose-bound unsubscribe token for this recipient only
    // (services/unsubscribe-token.ts). GET on the link only shows a confirm
    // page; List-Unsubscribe-Post below lets mail clients POST to the same
    // URL (RFC 8058 one-click).
    const unsubscribeToken = signUnsubscribeToken(recipient.userId, 'weekly-summary');

    const templateData = this.buildTemplateData({
      userName,
      brief,
      organizationName,
      frontendUrl,
      unsubscribeUrl: `${backendUrl}/api/user/preferences/unsubscribe?token=${unsubscribeToken}`,
    });

    const html = this.emailTemplate!(templateData);

    // Generate plain text version for better deliverability
    const textContent = this.generateTextVersion(templateData);

    // Send email via Resend with anti-spam headers
    const result = await this.resend!.emails.send({
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
  }

  /** Template and text-version fields from the composed brief; link paths become absolute URLs. Decides no wording. */
  buildTemplateData(input: {
    userName: string;
    brief: WeeklyBrief;
    organizationName: string | null;
    frontendUrl: string;
    unsubscribeUrl: string;
  }): WeeklyEmailTemplateData {
    const { brief, frontendUrl } = input;
    const link = (l: BriefLink): TemplateLink => ({ label: l.label, href: `${frontendUrl}${l.path}` });
    return {
      subject: brief.subject,
      eyebrow: brief.eyebrow,
      title: brief.title,
      orgLine: brief.orgLine,
      userName: input.userName,
      summary: brief.summary,
      tiles: brief.tiles,
      attention: brief.attention.map(item => ({
        number: item.number,
        title: item.title,
        body: item.body,
        time: item.time,
        link: link(item.link),
        ...TONE_COLOURS[item.tone],
      })),
      notConnected: brief.notConnected
        ? { status: brief.notConnected.status, action: link(brief.notConnected.action), sections: brief.notConnected.sections }
        : null,
      cost: brief.cost
        ? {
            lines: brief.cost.lines.map(l => {
              const at = l.strong ? l.text.indexOf(l.strong) : -1;
              return at === -1
                ? { text: l.text, before: l.text, strong: '', after: '' }
                : { text: l.text, before: l.text.slice(0, at), strong: l.strong!, after: l.text.slice(at + l.strong!.length) };
            }),
            services: brief.cost.services,
            link: link(brief.cost.link),
          }
        : null,
      delivery: { line: brief.delivery.line, link: link(brief.delivery.link) },
      button: { ...link(brief.button), isButton: brief.button.style === 'button' },
      footer: { lines: brief.footer.lines, alarms: { text: brief.footer.alarms.text, link: brief.footer.alarms.link ? link(brief.footer.alarms.link) : null } },
      // Named in the footer only; when the name couldn't be read, no name is invented.
      organizationName: input.organizationName || 'your organization',
      dashboardUrl: `${frontendUrl}${WEEKLY_EMAIL_PATHS.dashboard}`,
      unsubscribeUrl: input.unsubscribeUrl,
      preferencesUrl: `${frontendUrl}${WEEKLY_EMAIL_PATHS.preferences}`,
      privacyUrl: `${frontendUrl}${WEEKLY_EMAIL_PATHS.privacy}`,
      supportEmail: SUPPORT_EMAIL,
      year: new Date().getUTCFullYear(),
    };
  }

  /** The full rendered email for an already-composed brief -- no send. */
  renderEmail(templateData: WeeklyEmailTemplateData): { html: string; text: string } {
    if (!this.emailTemplate) throw new Error('Email template not loaded');
    return { html: this.emailTemplate(templateData), text: this.generateTextVersion(templateData) };
  }

  /**
   * The plain-text part: the same strings as the HTML, in the same order. A
   * link is written as "Label: URL" (arrow dropped).
   */
  private generateTextVersion(data: WeeklyEmailTemplateData): string {
    const linkText = (l: TemplateLink) => `${l.label.replace(/ →$/, '')}: ${l.href}`;
    const parts: string[] = [data.eyebrow, data.title];
    if (data.orgLine) parts.push(data.orgLine);
    parts.push('', `Hi ${data.userName},`, '', [data.summary.bold, data.summary.plain].filter(Boolean).join(' '));
    if (data.notConnected) {
      parts.push('', ...data.notConnected.status, linkText(data.notConnected.action));
      for (const section of data.notConnected.sections) parts.push('', section.title, section.line);
    }
    for (const tile of data.tiles) {
      parts.push('', tile.label, ...(tile.sublabel ? [tile.sublabel] : []), tile.value, ...tile.lines);
    }
    if (data.attention.length > 0) {
      parts.push('', 'NEEDS YOUR ATTENTION');
      for (const item of data.attention) {
        parts.push(`${item.number}. ${item.title}`, ...item.body, ...(item.time ? [item.time] : []), linkText(item.link));
      }
    }
    if (data.cost) {
      parts.push('', 'COST', ...data.cost.lines.map(l => l.text));
      if (data.cost.services) parts.push('', data.cost.services.heading, ...data.cost.services.rows.map(r => `${r.service}  ${r.amount}`));
      parts.push(linkText(data.cost.link));
    }
    parts.push('', 'DELIVERY', data.delivery.line, linkText(data.delivery.link));
    parts.push('', linkText(data.button));
    parts.push('', '---', ...data.footer.lines);
    parts.push(data.footer.alarms.link ? linkText(data.footer.alarms.link) : data.footer.alarms.text);
    parts.push(
      '',
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
