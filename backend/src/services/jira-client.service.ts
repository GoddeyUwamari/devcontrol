import axios, { AxiosInstance } from 'axios';

/**
 * Jira API Client
 * Implements Jira Cloud REST API v3 integration with Basic Authentication
 */

interface JiraIssuePayload {
  projectKey: string;
  summary: string;
  description: any; // ADF format
  issueType: string;
  priority: string;
  labels: string[];
}

export class JiraClient {
  private axios: AxiosInstance;

  constructor(
    private baseUrl: string,
    private email: string,
    private apiToken: string
  ) {
    // Remove trailing slash from baseUrl
    this.baseUrl = baseUrl.replace(/\/$/, '');

    // Create axios instance with default config
    this.axios = axios.create({
      baseURL: this.baseUrl,
      headers: this.getHeaders(),
      timeout: 10000, // 10 second timeout
    });
  }

  /**
   * Get authentication headers for Jira API
   */
  private getHeaders(): Record<string, string> {
    const auth = Buffer.from(`${this.email}:${this.apiToken}`).toString('base64');
    return {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
  }

  /**
   * Test connection to Jira by fetching current user
   */
  async testConnection(): Promise<boolean> {
    try {
      const response = await this.axios.get('/rest/api/3/myself');
      return response.status === 200;
    } catch (error: any) {
      if (error.response?.status === 401) {
        throw new Error('Invalid Jira credentials. Check email and API token.');
      } else if (error.response?.status === 403) {
        throw new Error('Jira access forbidden. Check account permissions.');
      } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        throw new Error('Cannot connect to Jira. Check the Jira URL.');
      } else {
        throw new Error(`Jira connection test failed: ${error.message}`);
      }
    }
  }

  /**
   * Create a Jira issue
   */
  async createIssue(payload: JiraIssuePayload): Promise<any> {
    try {
      const jiraPayload = {
        fields: {
          project: {
            key: payload.projectKey,
          },
          summary: payload.summary,
          description: payload.description,
          issuetype: {
            name: payload.issueType,
          },
          priority: {
            name: payload.priority,
          },
          labels: payload.labels,
        },
      };

      const response = await this.axios.post('/rest/api/3/issue', jiraPayload);
      return response.data;
    } catch (error: any) {
      // Handle specific error cases
      if (error.response?.status === 401) {
        throw new Error('Invalid Jira credentials. Check email and API token.');
      } else if (error.response?.status === 404) {
        throw new Error(
          `Project "${payload.projectKey}" not found or you don't have access.`
        );
      } else if (error.response?.status === 400) {
        const errors = error.response?.data?.errors;
        if (errors) {
          const errorMessages = Object.entries(errors)
            .map(([field, msg]) => `${field}: ${msg}`)
            .join('; ');
          throw new Error(`Invalid issue data: ${errorMessages}`);
        }
        throw new Error('Invalid issue data. Check issue type and required fields.');
      } else {
        throw new Error(`Jira API error: ${error.message}`);
      }
    }
  }

  /**
   * Validate project exists and is accessible
   */
  async validateProject(projectKey: string): Promise<boolean> {
    try {
      const response = await this.axios.get(`/rest/api/3/project/${projectKey}`);
      return response.status === 200;
    } catch (error: any) {
      if (error.response?.status === 404) {
        throw new Error(`Project "${projectKey}" not found.`);
      } else if (error.response?.status === 401 || error.response?.status === 403) {
        throw new Error(`No access to project "${projectKey}".`);
      } else {
        throw new Error(`Error validating project: ${error.message}`);
      }
    }
  }
}
