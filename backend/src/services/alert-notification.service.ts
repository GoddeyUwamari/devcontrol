import nodemailer from 'nodemailer';
import { WebClient } from '@slack/web-api';
import { JiraClient } from './jira-client.service';

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

interface Alert {
  severity: 'critical' | 'warning' | 'info';
  title: string;
  message: string;
  source: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export class AlertNotificationService {
  private emailTransporter?: nodemailer.Transporter;
  private slackClient?: WebClient;
  private jiraClient?: JiraClient;

  constructor(private config: AlertConfig) {
    if (config.email?.enabled) {
      this.emailTransporter = nodemailer.createTransport({
        host: config.email.smtpHost,
        port: config.email.smtpPort,
        secure: config.email.smtpPort === 465,
        auth: {
          user: config.email.smtpUser,
          pass: config.email.smtpPass,
        },
      });
    }

    if (config.slack?.enabled && config.slack.webhookUrl) {
      this.slackClient = new WebClient();
    }

    if (config.jira?.enabled) {
      this.jiraClient = new JiraClient(
        config.jira.baseUrl,
        config.jira.email,
        config.jira.apiToken
      );
    }
  }

  async sendAlert(alert: Alert): Promise<void> {
    const promises: Promise<any>[] = [];

    // Send email notification
    if (this.config.email?.enabled && this.emailTransporter) {
      promises.push(this.sendEmailAlert(alert));
    }

    // Send Slack notification
    if (this.config.slack?.enabled && this.slackClient) {
      promises.push(this.sendSlackAlert(alert));
    }

    // Send webhook notification
    if (this.config.webhook?.enabled) {
      promises.push(this.sendWebhookAlert(alert));
    }

    // Send Jira notification
    if (this.config.jira?.enabled && this.jiraClient) {
      promises.push(this.sendJiraAlert(alert));
    }

    await Promise.allSettled(promises);
  }

  private async sendEmailAlert(alert: Alert): Promise<void> {
    if (!this.emailTransporter || !this.config.email) return;

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

    await this.emailTransporter.sendMail({
      from: this.config.email.smtpUser,
      to: this.config.email.recipients.join(', '),
      subject: `[DevControl ${alert.severity.toUpperCase()}] ${alert.title}`,
      html,
    });
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

    await fetch(this.config.slack.webhookUrl, {
      method: 'POST',
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
  }

  private async sendWebhookAlert(alert: Alert): Promise<void> {
    if (!this.config.webhook) return;

    await fetch(this.config.webhook.url, {
      method: 'POST',
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
  }

  private async sendJiraAlert(alert: Alert): Promise<void> {
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
