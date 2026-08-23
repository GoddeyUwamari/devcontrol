/**
 * Email Service
 * Sends transactional emails (invitation, verification, password reset) via Resend
 */

import fs from 'fs';
import path from 'path';
import Handlebars from 'handlebars';
import { Resend } from 'resend';

interface SendParams {
  to: string;
  subject: string;
  template: HandlebarsTemplateDelegate | null;
  templateData: Record<string, unknown>;
  operation: string;
}

interface InvitationEmailParams {
  to: string;
  organizationName: string;
  role: string;
  invitationToken: string;
}

interface VerificationEmailParams {
  to: string;
  fullName: string;
  verificationToken: string;
}

interface PasswordResetEmailParams {
  to: string;
  resetToken: string;
}

export class EmailService {
  private resend: Resend | null = null;
  private invitationTemplate: HandlebarsTemplateDelegate | null = null;
  private verificationTemplate: HandlebarsTemplateDelegate | null = null;
  private passwordResetTemplate: HandlebarsTemplateDelegate | null = null;

  constructor() {
    this.setupResendClient();
    this.invitationTemplate = this.loadTemplate('invitation-email.html');
    this.verificationTemplate = this.loadTemplate('verification-email.html');
    this.passwordResetTemplate = this.loadTemplate('password-reset-email.html');
  }

  /**
   * Setup Resend email client
   */
  private setupResendClient(): void {
    const apiKey = process.env.RESEND_API_KEY;

    if (!apiKey) {
      console.warn('[Email Service] Resend not configured - email sending disabled');
      console.warn('  Required env var: RESEND_API_KEY');
      return;
    }

    this.resend = new Resend(apiKey);
  }

  /**
   * Load a Handlebars email template from backend/src/templates
   */
  private loadTemplate(filename: string): HandlebarsTemplateDelegate | null {
    try {
      const templatePath = path.join(__dirname, '../templates', filename);
      if (fs.existsSync(templatePath)) {
        const templateSource = fs.readFileSync(templatePath, 'utf-8');
        return Handlebars.compile(templateSource);
      }
      console.warn(`[Email Service] Template not found at: ${templatePath}`);
      return null;
    } catch (error: any) {
      console.error(`[Email Service] Failed to load template ${filename}:`, error.message);
      return null;
    }
  }

  private getFrontendUrl(): string {
    return process.env.FRONTEND_URL || 'http://localhost:3010';
  }

  private getSenderAddress(): string {
    return process.env.EMAIL_FROM || 'DevControl <noreply@devcontrol.app>';
  }

  /**
   * Render and send one transactional email via Resend. Deliberately never
   * throws: a delivery failure must not be distinguishable from success by
   * any caller -- in particular requestPasswordReset's account-enumeration-safe
   * response must not change based on whether the email actually went out.
   * Failures are logged with safe metadata only (operation, recipient,
   * provider error name/message) -- never the template data (which carries
   * the raw token) and never the full provider response object.
   */
  private async send(params: SendParams): Promise<boolean> {
    const { to, subject, template, templateData, operation } = params;

    if (!this.resend) {
      console.warn(`[Email Service] Skipped ${operation}: Resend not configured`);
      return false;
    }

    if (!template) {
      console.warn(`[Email Service] Skipped ${operation}: template not loaded`);
      return false;
    }

    const html = template(templateData);

    try {
      const result = await this.resend.emails.send({
        from: this.getSenderAddress(),
        to,
        subject,
        html,
      });

      if (result.error) {
        console.error(
          `[Email Service] ${operation} to ${to} failed:`,
          result.error.name,
          result.error.message
        );
        return false;
      }

      console.log(`[Email Service] ${operation} sent to ${to} (id: ${result.data?.id})`);
      return true;
    } catch (error: any) {
      console.error(`[Email Service] ${operation} to ${to} threw:`, error?.message || 'unknown error');
      return false;
    }
  }

  /**
   * Send an organization invitation email. Only call this for a branch that
   * has actually persisted invitationToken somewhere it can later be looked
   * up -- the email only carries a link, it creates no state of its own.
   */
  async sendInvitationEmail(params: InvitationEmailParams): Promise<boolean> {
    const { to, organizationName, role, invitationToken } = params;
    const invitationUrl = `${this.getFrontendUrl()}/accept-invitation?token=${invitationToken}`;

    return this.send({
      to,
      subject: `You've been invited to join ${organizationName} on DevControl`,
      template: this.invitationTemplate,
      templateData: {
        organizationName,
        role,
        invitationUrl,
        year: new Date().getFullYear(),
      },
      operation: 'invitation email',
    });
  }

  async sendVerificationEmail(params: VerificationEmailParams): Promise<boolean> {
    const { to, fullName, verificationToken } = params;
    const verificationUrl = `${this.getFrontendUrl()}/verify-email?token=${verificationToken}`;

    return this.send({
      to,
      subject: 'Verify your email address',
      template: this.verificationTemplate,
      templateData: {
        fullName,
        verificationUrl,
        year: new Date().getFullYear(),
      },
      operation: 'verification email',
    });
  }

  async sendPasswordResetEmail(params: PasswordResetEmailParams): Promise<boolean> {
    const { to, resetToken } = params;
    const resetUrl = `${this.getFrontendUrl()}/reset-password?token=${resetToken}`;

    return this.send({
      to,
      subject: 'Reset your DevControl password',
      template: this.passwordResetTemplate,
      templateData: {
        resetUrl,
        year: new Date().getFullYear(),
      },
      operation: 'password reset email',
    });
  }
}

// Export singleton instance
export const emailService = new EmailService();
