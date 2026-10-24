import nodemailer from 'nodemailer';
import { WebClient } from '@slack/web-api';
import { JiraClient, JiraFailureReason, JiraRequestError } from './jira-client.service';
import { OutboundRefused, SMTP_CLIENT_NAME, pinnedSmtpTarget, safeHttpsPost } from '../utils/safe-outbound';

interface AlertConfig {
  email?: {
    enabled: boolean;
    recipients: string[];
    smtpHost: string;
    smtpPort: number;
    smtpUser: string;
    smtpPass: string;
  };
  slack?: {
    enabled: boolean;
    webhookUrl: string;
    channel: string;
  };
  webhook?: {
    enabled: boolean;
    url: string;
    headers?: Record<string, string>;
  };
  jira?: {
    enabled: boolean;
    baseUrl: string;
    email: string;
    apiToken: string;
    projectKey: string;
    issueType: string;
  };
}

export interface ChannelResult {
  channel: 'email' | 'slack' | 'webhook' | 'jira';
  ok: boolean;
  /** For a failed Jira delivery that Jira itself refused: which of the fixed reasons. */
  reason?: JiraFailureReason;
}

interface Alert {
  severity: 'critical' | 'warning' | 'info';
  title: string;
  message: string;
  source: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

/** A non-2xx answer is a failed delivery. */
function assertDelivered(status: number, label: string): void {
  if (status >= 200 && status <= 299) return;
  throw new Error(`${label} returned ${status}`);
}

/**
 * Transport options for an organization's mail server: connect to the
 * checked address, verify the certificate against the configured host name,
 * require TLS (STARTTLS except on 465), and announce a fixed client name.
 */
export function buildSmtpTransportOptions(
  target: { address: string; servername?: string; port: number; secure: boolean },
  auth?: { user: string; pass: string }
) {
  return {
    host: target.address,
    port: target.port,
    secure: target.secure,
    requireTLS: !target.secure,
    ignoreTLS: false,
    ...(target.servername ? { servername: target.servername } : {}),
    tls: {
      ...(target.servername ? { servername: target.servername } : {}),
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2' as const,
    },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    dnsTimeout: 5_000,
    name: SMTP_CLIENT_NAME,
    logger: false,
    debug: false,
    ...(auth ? { auth } : {}),
  };
}

export class AlertNotificationService {
  private slackClient?: WebClient;
  private jiraClient?: JiraClient;
  private jiraSetupError?: unknown;

  constructor(
    private config: AlertConfig,
    private context: { organizationId?: string } = {}
  ) {
    if (config.slack?.enabled && config.slack.webhookUrl) {
      this.slackClient = new WebClient();
    }

    if (config.jira?.enabled) {
      try {
        this.jiraClient = new JiraClient(
          config.jira.baseUrl,
          config.jira.email,
          config.jira.apiToken
        );
      } catch (error) {
        // Reported as this channel's failed delivery.
        this.jiraSetupError = error;
      }
    }
  }

  /** Sends to every enabled channel; one result per channel attempted. */
  async sendAlert(alert: Alert): Promise<ChannelResult[]> {
    const attempts: { channel: ChannelResult['channel']; promise: Promise<void> }[] = [];

    // Send email notification
    if (this.config.email?.enabled) {
      attempts.push({ channel: 'email', promise: this.sendEmailAlert(alert) });
    }

    // Send Slack notification
    if (this.config.slack?.enabled && this.slackClient) {
      attempts.push({ channel: 'slack', promise: this.sendSlackAlert(alert) });
    }

    // Send webhook notification
    if (this.config.webhook?.enabled) {
      attempts.push({ channel: 'webhook', promise: this.sendWebhookAlert(alert) });
    }

    // Send Jira notification
    if (this.config.jira?.enabled) {
      attempts.push({ channel: 'jira', promise: this.sendJiraAlert(alert) });
    }

    const settled = await Promise.allSettled(attempts.map((attempt) => attempt.promise));
    return settled.map((outcome, i) => {
      const channel = attempts[i].channel;
      if (outcome.status === 'fulfilled') return { channel, ok: true };
      if (outcome.reason instanceof OutboundRefused) {
        console.warn('[SafeOutbound] refused', {
          organizationId: this.context.organizationId,
          channel,
          code: outcome.reason.code,
        });
      }
      if (channel === 'jira' && outcome.reason instanceof JiraRequestError) {
        return { channel, ok: false, reason: outcome.reason.reason };
      }
      return { channel, ok: false };
    });
  }

  private async sendEmailAlert(alert: Alert): Promise<void> {
    if (!this.config.email) return;

    const severityColor = {
      critical: '#dc2626',
      warning: '#f59e0b',
      info: '#3b82f6',
    };

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: ${severityColor[alert.severity]}; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
          <h2 style="margin: 0;">${alert.severity.toUpperCase()}: ${alert.title}</h2>
        </div>
        <div style="background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
          <p style="margin: 0 0 15px 0; color: #374151;">${alert.message}</p>
          <div style="background: white; padding: 15px; border-radius: 6px; margin-top: 15px;">
            <p style="margin: 0 0 10px 0; color: #6b7280; font-size: 14px;"><strong>Source:</strong> ${alert.source}</p>
            <p style="margin: 0; color: #6b7280; font-size: 14px;"><strong>Time:</strong> ${alert.timestamp.toISOString()}</p>
          </div>
          ${alert.metadata ? `
            <div style="background: white; padding: 15px; border-radius: 6px; margin-top: 15px;">
              <p style="margin: 0 0 10px 0; color: #374151; font-weight: bold;">Details:</p>
              <pre style="background: #f3f4f6; padding: 10px; border-radius: 4px; overflow-x: auto; font-size: 12px;">${JSON.stringify(alert.metadata, null, 2)}</pre>
            </div>
          ` : ''}
        </div>
      </div>
    `;

    // Resolved and checked on every send, then connected to by address.
    const target = await pinnedSmtpTarget(this.config.email.smtpHost, this.config.email.smtpPort);
    const transporter = nodemailer.createTransport(
      buildSmtpTransportOptions(target, { user: this.config.email.smtpUser, pass: this.config.email.smtpPass })
    );
    try {
      await transporter.sendMail({
        from: this.config.email.smtpUser,
        to: this.config.email.recipients.join(', '),
        subject: `[DevControl ${alert.severity.toUpperCase()}] ${alert.title}`,
        html,
      });
    } finally {
      transporter.close();
    }
  }

  private async sendSlackAlert(alert: Alert): Promise<void> {
    if (!this.slackClient || !this.config.slack) return;

    const severityEmoji = {
      critical: '🚨',
      warning: '⚠️',
      info: 'ℹ️',
    };

    const severityColor = {
      critical: '#dc2626',
      warning: '#f59e0b',
      info: '#3b82f6',
    };

    const { status } = await safeHttpsPost(this.config.slack.webhookUrl, {
      policy: 'slack-webhook',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: this.config.slack.channel,
        attachments: [
          {
            color: severityColor[alert.severity],
            blocks: [
              {
                type: 'header',
                text: {
                  type: 'plain_text',
                  text: `${severityEmoji[alert.severity]} ${alert.title}`,
                },
              },
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: alert.message,
                },
              },
              {
                type: 'context',
                elements: [
                  {
                    type: 'mrkdwn',
                    text: `*Source:* ${alert.source} | *Time:* ${alert.timestamp.toISOString()}`,
                  },
                ],
              },
              ...(alert.metadata
                ? [
                    {
                      type: 'section',
                      text: {
                        type: 'mrkdwn',
                        text: `\`\`\`${JSON.stringify(alert.metadata, null, 2)}\`\`\``,
                      },
                    },
                  ]
                : []),
            ],
          },
        ],
      }),
    });
    assertDelivered(status, 'Slack webhook');
  }

  private async sendWebhookAlert(alert: Alert): Promise<void> {
    if (!this.config.webhook) return;

    const { status } = await safeHttpsPost(this.config.webhook.url, {
      policy: 'public-https',
      headers: {
        'Content-Type': 'application/json',
        ...this.config.webhook.headers,
      },
      body: JSON.stringify({
        event: 'alert',
        severity: alert.severity,
        title: alert.title,
        message: alert.message,
        source: alert.source,
        timestamp: alert.timestamp.toISOString(),
        metadata: alert.metadata,
      }),
    });
    assertDelivered(status, 'Webhook');
  }

  private async sendJiraAlert(alert: Alert): Promise<void> {
    if (this.jiraSetupError) throw this.jiraSetupError;
    if (!this.jiraClient || !this.config.jira) return;

    const severityPriorityMap = {
      critical: 'Highest',
      warning: 'High',
      info: 'Medium',
    };

    const description = this.buildJiraDescription(alert);

    await this.jiraClient.createIssue({
      projectKey: this.config.jira.projectKey,
      summary: `[${alert.severity.toUpperCase()}] ${alert.title}`,
      description,
      issueType: this.config.jira.issueType || 'Task',
      priority: severityPriorityMap[alert.severity],
      labels: ['devcontrol', 'alert', alert.severity],
    });
  }

  private buildJiraDescription(alert: Alert): any {
    const paragraphs: any[] = [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: `Severity: ${alert.severity.toUpperCase()}\nMessage: ${alert.message}\nSource: ${alert.source}\nTimestamp: ${alert.timestamp.toISOString()}`,
          },
        ],
      },
    ];

    if (alert.metadata) {
      paragraphs.push({
        type: 'codeBlock',
        attrs: { language: 'json' },
        content: [
          {
            type: 'text',
            text: JSON.stringify(alert.metadata, null, 2),
          },
        ],
      });
    }

    paragraphs.push({
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: '\n---\nGenerated by DevControl Alert System',
        },
      ],
    });

    return {
      type: 'doc',
      version: 1,
      content: paragraphs,
    };
  }
}
