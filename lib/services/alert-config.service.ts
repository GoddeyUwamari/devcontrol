import api, { handleApiResponse } from '../api';

export interface EmailConfig {
  enabled: boolean;
  recipients: string[];
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  /** Write-only: always '' from the server. Send '' to keep the saved value. */
  smtpPass: string;
  smtpPassSet?: boolean;
}

export interface SlackConfig {
  enabled: boolean;
  /** Write-only: always '' from the server. Send '' to keep the saved value. */
  webhookUrl: string;
  webhookUrlSet?: boolean;
  channel: string;
}

export interface WebhookConfig {
  enabled: boolean;
  /** Write-only: always '' from the server. Send '' to keep the saved value. */
  url: string;
  urlSet?: boolean;
  /** Header names with '' values from the server; '' keeps the saved value. */
  headers?: Record<string, string>;
  /** Names of headers that have a saved value. */
  headersSet?: string[];
}

export interface JiraConfig {
  enabled: boolean;
  baseUrl: string;
  email: string;
  /** Write-only: always '' from the server. Send '' to keep the saved value. */
  apiToken: string;
  apiTokenSet?: boolean;
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

/** A save: the configuration plus saved credentials to remove, by path (e.g. 'slack.webhookUrl'). */
export interface AlertConfigurationUpdate extends AlertConfiguration {
  clearSecrets?: string[];
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
  updateConfig: async (config: AlertConfigurationUpdate): Promise<void> => {
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
