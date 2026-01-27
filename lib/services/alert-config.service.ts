import api, { handleApiResponse } from '../api';

export interface EmailConfig {
  enabled: boolean;
  recipients: string[];
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
}

export interface SlackConfig {
  enabled: boolean;
  webhookUrl: string;
  channel: string;
}

export interface WebhookConfig {
  enabled: boolean;
  url: string;
  headers?: Record<string, string>;
}

export interface JiraConfig {
  enabled: boolean;
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
  issueType: string;
}

export interface AlertType {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  threshold?: number;
  thresholdUnit?: string;
  severities: ('critical' | 'warning' | 'info')[];
  // icon is UI-only, not stored in backend
}

export interface AlertConfiguration {
  email: EmailConfig;
  slack: SlackConfig;
  webhook: WebhookConfig;
  jira: JiraConfig;
  alertTypes?: AlertType[];
}

export const alertConfigService = {
  /**
   * Get current alert configuration
   */
  getConfig: async (): Promise<AlertConfiguration> => {
    const response = await api.get('/api/alert-config/config');
    return handleApiResponse(response);
  },

  /**
   * Update alert configuration
   */
  updateConfig: async (config: AlertConfiguration): Promise<void> => {
    const response = await api.put('/api/alert-config/config', config);
    return handleApiResponse(response);
  },

  /**
   * Test an alert channel
   * @param type - Channel type: 'email', 'slack', 'jira', or 'webhook'
   */
  testChannel: async (type: 'email' | 'slack' | 'jira' | 'webhook'): Promise<void> => {
    const response = await api.post('/api/alert-config/test', { type });
    return handleApiResponse(response);
  },
};
