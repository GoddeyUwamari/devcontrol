import { Request, Response } from 'express';
import { AlertNotificationService } from '../services/alert-notification.service';
import { JIRA_FAILURE_MESSAGES, JiraFailureReason, JiraClient, JiraRequestError } from '../services/jira-client.service';
import {
  OutboundRefused,
  SMTP_PORTS,
  assertDestination,
  assertSmtpHost,
  checkUrlSyntax,
  isForbiddenWebhookHeader,
  slackWebhookUrlError,
} from '../utils/safe-outbound';

// Store configurations in database (add table later)
export const alertConfigs = new Map<string, any>();

type Channel = 'email' | 'slack' | 'webhook' | 'jira';
const CHANNELS: Channel[] = ['email', 'slack', 'webhook', 'jira'];

/**
 * Credential fields, one per channel. They are write-only: never returned to
 * any caller, only reported as set or not set. A blank or omitted value on
 * save keeps the stored one; clearSecrets removes it. Each webhook header
 * value is treated the same way, by the path 'webhook.headers.<name>'.
 */
const SECRET_FIELD: Record<Channel, string> = {
  email: 'smtpPass',
  slack: 'webhookUrl',
  webhook: 'url',
  jira: 'apiToken',
};
/** The clearSecrets paths for SECRET_FIELD; header paths are HEADER_PATH_PREFIX + name. */
export const ALERT_CONFIG_SECRET_PATHS: readonly string[] = CHANNELS.map((channel) => `${channel}.${SECRET_FIELD[channel]}`);
const HEADER_PATH_PREFIX = 'webhook.headers.';

// The non-credential fields each channel stores; anything else sent is dropped.
const CHANNEL_FIELDS: Record<Channel, string[]> = {
  email: ['enabled', 'recipients', 'smtpHost', 'smtpPort', 'smtpUser'],
  slack: ['enabled', 'channel'],
  webhook: ['enabled'],
  jira: ['enabled', 'baseUrl', 'email', 'projectKey', 'issueType'],
};

class ConfigValidationError extends Error {}

const isObject = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const hasValue = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

// Default alert types
const defaultAlertTypes = [
  {
    id: 'cost_threshold',
    name: 'Cost Threshold Exceeded',
    description: 'Get alerted when AWS spending exceeds your budget',
    enabled: true,
    threshold: 1000,
    thresholdUnit: 'USD/month',
    severities: ['critical', 'warning'],
  },
  {
    id: 'security_issue',
    name: 'Security Issues Detected',
    description: 'Immediate alerts for public S3 buckets, unencrypted resources',
    enabled: true,
    severities: ['critical', 'warning'],
  },
  {
    id: 'compliance_failure',
    name: 'Compliance Violations',
    description: 'Get alerted on compliance findings, including SOC 2 readiness gaps and PCI-DSS issues',
    enabled: true,
    severities: ['critical', 'warning', 'info'],
  },
  {
    id: 'resource_drift',
    name: 'Infrastructure Changes',
    description: 'Track new, modified, or deleted AWS resources',
    enabled: false,
    severities: ['info'],
  },
];

function defaultConfig() {
  return {
    email: { enabled: false, recipients: [], smtpHost: '', smtpPort: 587, smtpUser: '', smtpPass: '' },
    slack: { enabled: false, webhookUrl: '', channel: '#devcontrol-alerts' },
    webhook: { enabled: false, url: '', headers: {} },
    jira: { enabled: false, baseUrl: '', email: '', apiToken: '', projectKey: '', issueType: 'Task' },
    alertTypes: defaultAlertTypes,
  };
}

/** The stored configuration as any caller may see it: credentials replaced by set/not-set flags. */
function redactConfig(config: any): any {
  if (!isObject(config)) return config;
  const redacted: Record<string, any> = { ...config };
  for (const channel of CHANNELS) {
    if (!isObject(config[channel])) continue;
    const field = SECRET_FIELD[channel];
    const view: Record<string, any> = { ...config[channel], [field]: '', [`${field}Set`]: hasValue(config[channel][field]) };
    if (channel === 'webhook') {
      const headers = isObject(config.webhook.headers) ? config.webhook.headers : {};
      view.headers = Object.fromEntries(Object.keys(headers).map((name) => [name, '']));
      view.headersSet = Object.keys(headers).filter((name) => hasValue(headers[name]));
    }
    redacted[channel] = view;
  }
  return redacted;
}

/**
 * `config` with the credentials named in `clear` removed. Throws on a path
 * that names no credential.
 */
function clearCredentials(config: Record<string, any>, clear: unknown): Record<string, any> {
  if (clear === undefined) return config;
  if (!Array.isArray(clear)) throw new ConfigValidationError('Invalid clearSecrets');
  const cleared: Record<string, any> = { ...config };
  const channelOf = (channel: Channel): Record<string, any> => (isObject(cleared[channel]) ? cleared[channel] : defaultConfig()[channel]);
  for (const path of clear) {
    if (ALERT_CONFIG_SECRET_PATHS.includes(path)) {
      const [channel, field] = (path as string).split('.') as [Channel, string];
      cleared[channel] = { ...channelOf(channel), [field]: '' };
    } else if (typeof path === 'string' && path.startsWith(HEADER_PATH_PREFIX) && path.length > HEADER_PATH_PREFIX.length) {
      const webhook = channelOf('webhook');
      const headers = { ...(isObject(webhook.headers) ? webhook.headers : {}) };
      delete headers[path.slice(HEADER_PATH_PREFIX.length)];
      cleared.webhook = { ...webhook, headers };
    } else {
      throw new ConfigValidationError('Unknown credential in clearSecrets');
    }
  }
  return cleared;
}

/**
 * The stored configuration with `body` applied: channels the body leaves out
 * are kept, a channel's sent fields replace the stored ones, and a blank or
 * omitted credential keeps the stored value. clearSecrets is applied first, so
 * a new value sent for a cleared credential is the one kept.
 */
function mergeConfig(stored: any, body: Record<string, any>): any {
  const base = clearCredentials(isObject(stored) ? stored : defaultConfig(), body.clearSecrets);
  const merged: Record<string, any> = {};

  for (const channel of CHANNELS) {
    const current: Record<string, any> = isObject(base[channel]) ? base[channel] : defaultConfig()[channel];
    const sent = body[channel];
    if (sent === undefined) {
      merged[channel] = current;
      continue;
    }
    if (!isObject(sent)) throw new ConfigValidationError(`Invalid ${channel} settings`);

    const next: Record<string, any> = { ...current };
    for (const field of CHANNEL_FIELDS[channel]) {
      if (sent[field] !== undefined) next[field] = sent[field];
    }
    const secret = SECRET_FIELD[channel];
    if (hasValue(sent[secret])) next[secret] = sent[secret];

    if (channel === 'webhook') {
      const headers: Record<string, string> = { ...(isObject(current.headers) ? current.headers : {}) };
      if (sent.headers !== undefined) {
        if (!isObject(sent.headers)) throw new ConfigValidationError('Invalid webhook headers');
        for (const [name, value] of Object.entries(sent.headers)) {
          if (hasValue(value)) headers[name] = value;
        }
      }
      next.headers = headers;
    }
    merged[channel] = next;
  }

  const storedTypes = Array.isArray(base.alertTypes) ? base.alertTypes : defaultAlertTypes;
  if (body.alertTypes !== undefined && !Array.isArray(body.alertTypes)) {
    throw new ConfigValidationError('Invalid alert types');
  }
  merged.alertTypes = Array.isArray(body.alertTypes) ? body.alertTypes : storedTypes;

  return merged;
}

const DESTINATION_ERRORS = {
  webhook: 'Webhook URL must be a public https:// address.',
  webhookHeaders: "Webhook headers can't include Host, Content-Length, Connection, Transfer-Encoding or proxy headers.",
  jira: 'Jira URL must be a public https:// address.',
  smtpHost: 'SMTP host must be a public mail server.',
  smtpPort: 'SMTP port must be 25, 465, 587 or 2525.',
};

/** Whether a destination field holds something to check. Blank, null and NaN (an emptied port field) do not. */
function isProvided(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (typeof value === 'number') return !Number.isNaN(value);
  return true;
}

/**
 * Checks the merged configuration. A destination is checked whenever one is
 * provided, whether or not its channel is enabled, so nothing invalid is
 * stored; an enabled email channel always needs an allowed port. Each refusal
 * has one fixed message per field.
 */
async function validateConfig(config: any): Promise<void> {
  if (config.jira?.enabled) {
    try {
      checkUrlSyntax(config.jira.baseUrl, 'public-https');
    } catch {
      throw new ConfigValidationError(DESTINATION_ERRORS.jira);
    }
    if (!config.jira.email?.includes('@')) {
      throw new ConfigValidationError('Valid email required');
    }
    if (!config.jira.apiToken || config.jira.apiToken.length < 20) {
      throw new ConfigValidationError('Valid API token required');
    }
    if (!config.jira.projectKey || config.jira.projectKey.length < 2) {
      throw new ConfigValidationError('Project key required');
    }
  }

  const headerNames = isObject(config.webhook?.headers) ? Object.keys(config.webhook.headers) : [];
  if (headerNames.some(isForbiddenWebhookHeader)) {
    throw new ConfigValidationError(DESTINATION_ERRORS.webhookHeaders);
  }

  const email = isObject(config.email) ? config.email : {};
  if (email.enabled || isProvided(email.smtpPort)) {
    if (!Number.isInteger(email.smtpPort) || !(SMTP_PORTS as readonly number[]).includes(email.smtpPort)) {
      throw new ConfigValidationError(DESTINATION_ERRORS.smtpPort);
    }
  }

  // Each lookup has its own deadline; they run together and the first refusal in this order is reported.
  const destinations: Array<{ value: unknown; check: (value: unknown) => Promise<void>; error: string }> = [
    { value: config.slack?.webhookUrl, check: (value) => assertDestination(value, 'slack-webhook'), error: slackWebhookUrlError },
    { value: config.webhook?.url, check: (value) => assertDestination(value, 'public-https'), error: DESTINATION_ERRORS.webhook },
    { value: config.jira?.baseUrl, check: (value) => assertDestination(value, 'public-https'), error: DESTINATION_ERRORS.jira },
    { value: email.smtpHost, check: assertSmtpHost, error: DESTINATION_ERRORS.smtpHost },
  ];
  const checks = destinations.filter((entry) => isProvided(entry.value));
  const outcomes = await Promise.allSettled(checks.map((entry) => entry.check(entry.value)));
  const refused = outcomes.findIndex((outcome) => outcome.status === 'rejected');
  if (refused >= 0) throw new ConfigValidationError(checks[refused].error);
}

/** Whether `channel` is switched on and has what it needs to send. */
function isChannelReady(config: any, channel: Channel): boolean {
  const settings = config?.[channel];
  if (!settings?.enabled) return false;
  switch (channel) {
    case 'email':
      return hasValue(settings.smtpHost) && Array.isArray(settings.recipients) && settings.recipients.length > 0;
    case 'slack':
      return hasValue(settings.webhookUrl);
    case 'webhook':
      return hasValue(settings.url);
    case 'jira':
      return hasValue(settings.baseUrl) && hasValue(settings.apiToken);
  }
}

const testFailed = (channel: Channel) =>
  `Test alert to ${channel} failed. Check the channel settings and try again.`;

/**
 * The message for a failed test. Jira's own refusals (a rejected issue or
 * rejected credentials) get their fixed message; anything else gets the
 * generic one.
 */
function testFailureMessage(channel: Channel, reason?: JiraFailureReason): string {
  if (channel === 'jira' && (reason === 'issue_rejected' || reason === 'credentials_rejected')) {
    return JIRA_FAILURE_MESSAGES[reason];
  }
  return testFailed(channel);
}

export class AlertConfigController {
  // Get alert configuration
  async getConfig(req: Request, res: Response) {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }
      const config = alertConfigs.get(organizationId) || defaultConfig();

      res.json({ success: true, data: redactConfig(config) });
    } catch {
      res.status(500).json({ success: false, error: 'Failed to load alert configuration' });
    }
  }

  // Update alert configuration
  async updateConfig(req: Request, res: Response) {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }
      if (!isObject(req.body)) {
        return res.status(400).json({ success: false, error: 'Invalid alert configuration' });
      }

      const config = mergeConfig(alertConfigs.get(organizationId), req.body);
      await validateConfig(config);

      // TODO: Store in database

      alertConfigs.set(organizationId, config);

      res.json({ success: true, message: 'Alert configuration updated' });
    } catch (error: any) {
      if (error instanceof ConfigValidationError) {
        return res.status(400).json({ success: false, error: error.message });
      }
      res.status(500).json({ success: false, error: 'Failed to update alert configuration' });
    }
  }

  // Test alert notification
  async testAlert(req: Request, res: Response) {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }
      const type = req.body?.type as Channel; // 'email', 'slack', 'webhook', or 'jira'
      if (!CHANNELS.includes(type)) {
        return res.status(400).json({ success: false, error: 'Unknown alert channel' });
      }

      const config = alertConfigs.get(organizationId);
      if (!config) {
        return res.status(400).json({ success: false, error: 'No configuration found' });
      }
      if (!isChannelReady(config, type)) {
        return res.status(400).json({ success: false, error: `${type} is not enabled` });
      }

      const fail = (reason?: JiraFailureReason) => {
        console.warn('[AlertConfig] test failed', { organizationId, channel: type });
        return res.status(502).json({ success: false, error: testFailureMessage(type, reason) });
      };

      // Test Jira connection first if testing Jira
      if (type === 'jira') {
        try {
          const jiraClient = new JiraClient(
            config.jira.baseUrl,
            config.jira.email,
            config.jira.apiToken
          );
          await jiraClient.testConnection();
        } catch (error) {
          if (error instanceof OutboundRefused) {
            console.warn('[SafeOutbound] refused', { organizationId, channel: type, code: error.code });
          }
          return fail(error instanceof JiraRequestError ? error.reason : undefined);
        }
      }

      // Only the channel under test is sent to.
      const alertService = new AlertNotificationService({ [type]: config[type] }, { organizationId });

      const results = await alertService.sendAlert({
        severity: 'info',
        title: 'Test Alert',
        message: 'This is a test alert from DevControl. If you received this, your notifications are working correctly!',
        source: 'DevControl Test',
        timestamp: new Date(),
        metadata: { test: true, channel: type },
      });

      const result = results.find((entry) => entry.channel === type);
      if (!result?.ok) {
        return fail(result?.reason);
      }

      res.json({ success: true, message: `Test alert sent successfully to ${type}` });
    } catch {
      res.status(500).json({ success: false, error: 'Failed to send test alert' });
    }
  }
}
