import { Request, Response } from 'express';
import { AlertNotificationService } from '../services/alert-notification.service';
import { JiraClient } from '../services/jira-client.service';

// Store configurations in database (add table later)
export const alertConfigs = new Map<string, any>();

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
    description: 'Stay compliant with SOC2, HIPAA, and PCI-DSS requirements',
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

export class AlertConfigController {
  // Get alert configuration
  async getConfig(req: Request, res: Response) {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }
      const config = alertConfigs.get(organizationId) || {
        email: { enabled: false, recipients: [], smtpHost: '', smtpPort: 587, smtpUser: '', smtpPass: '' },
        slack: { enabled: false, webhookUrl: '', channel: '#devcontrol-alerts' },
        webhook: { enabled: false, url: '', headers: {} },
        jira: { enabled: false, baseUrl: '', email: '', apiToken: '', projectKey: '', issueType: 'Task' },
        alertTypes: defaultAlertTypes,
      };

      res.json({ success: true, data: config });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // Update alert configuration
  async updateConfig(req: Request, res: Response) {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }
      const config = req.body;

      // Validate Jira config if enabled
      if (config.jira?.enabled) {
        if (!config.jira.baseUrl?.startsWith('https://')) {
          return res.status(400).json({ success: false, error: 'Jira URL must be HTTPS' });
        }
        if (!config.jira.email?.includes('@')) {
          return res.status(400).json({ success: false, error: 'Valid email required' });
        }
        if (!config.jira.apiToken || config.jira.apiToken.length < 20) {
          return res.status(400).json({ success: false, error: 'Valid API token required' });
        }
        if (!config.jira.projectKey || config.jira.projectKey.length < 2) {
          return res.status(400).json({ success: false, error: 'Project key required' });
        }
      }

      // TODO: Store in database

      alertConfigs.set(organizationId, config);

      res.json({ success: true, message: 'Alert configuration updated' });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // Test alert notification
  async testAlert(req: Request, res: Response) {
    try {
      const organizationId = req.user?.organizationId;
      if (!organizationId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }
      const { type } = req.body; // 'email', 'slack', 'webhook', or 'jira'

      const config = alertConfigs.get(organizationId);
      if (!config) {
        return res.status(400).json({ success: false, error: 'No configuration found' });
      }

      // Test Jira connection first if testing Jira
      if (type === 'jira' && config.jira?.enabled) {
        const jiraClient = new JiraClient(
          config.jira.baseUrl,
          config.jira.email,
          config.jira.apiToken
        );

        try {
          await jiraClient.testConnection();
        } catch (error: any) {
          return res.status(400).json({
            success: false,
            error: 'Jira connection failed: ' + error.message,
          });
        }
      }

      const alertService = new AlertNotificationService(config);

      await alertService.sendAlert({
        severity: 'info',
        title: 'Test Alert',
        message: 'This is a test alert from DevControl. If you received this, your notifications are working correctly!',
        source: 'DevControl Test',
        timestamp: new Date(),
        metadata: { test: true, channel: type },
      });

      res.json({ success: true, message: `Test alert sent successfully to ${type}` });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
}
