import { Request, Response } from 'express';
import { AlertNotificationService } from '../services/alert-notification.service';
import { JiraClient } from '../services/jira-client.service';

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

function validateConfig(config: any): void {
  if (config.jira?.enabled) {
    if (!config.jira.baseUrl?.startsWith('https://')) {
      throw new ConfigValidationError('Jira URL must be HTTPS');
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
      validateConfig(config);

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

      const fail = () => {
        console.warn('[AlertConfig] test failed', { organizationId, channel: type });
        return res.status(502).json({ success: false, error: testFailed(type) });
      };

      // Test Jira connection first if testing Jira
      if (type === 'jira') {
        const jiraClient = new JiraClient(
          config.jira.baseUrl,
          config.jira.email,
          config.jira.apiToken
        );

        try {
          await jiraClient.testConnection();
        } catch {
          return fail();
        }
      }

      // Only the channel under test is sent to.
      const alertService = new AlertNotificationService({ [type]: config[type] });

      const results = await alertService.sendAlert({
        severity: 'info',
        title: 'Test Alert',
        message: 'This is a test alert from DevControl. If you received this, your notifications are working correctly!',
        source: 'DevControl Test',
        timestamp: new Date(),
        metadata: { test: true, channel: type },
      });

      if (!results.some((result) => result.channel === type && result.ok)) {
        return fail();
      }

      res.json({ success: true, message: `Test alert sent successfully to ${type}` });
    } catch {
      res.status(500).json({ success: false, error: 'Failed to send test alert' });
    }
  }
}
