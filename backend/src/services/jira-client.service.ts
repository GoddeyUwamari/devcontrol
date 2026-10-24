import axios, { AxiosInstance, AxiosResponse, Method } from 'axios';
import { Readable } from 'stream';
import { checkUrlSyntax, createSafeHttpsAgent } from '../utils/safe-outbound';

/**
 * Jira API Client
 * Implements Jira Cloud REST API v3 integration with Basic Authentication
 *
 * Requests go only to the configured base URL, through an agent that checks
 * every address before connecting; redirects are not followed and no proxy
 * is used. A failed request is reported by status code alone: Jira's
 * response body is never read for it.
 */

interface JiraIssuePayload {
  projectKey: string;
  summary: string;
  description: any; // ADF format
  issueType: string;
  priority: string;
  labels: string[];
}

export type JiraFailureReason = 'issue_rejected' | 'credentials_rejected' | 'failed';

/** Every message a JiraRequestError can carry. */
export const JIRA_FAILURE_MESSAGES: Readonly<Record<JiraFailureReason, string>> = Object.freeze({
  issue_rejected: 'Jira rejected the issue: check the project key and issue type',
  credentials_rejected: 'Jira rejected the credentials',
  failed: 'Jira request failed',
});

export class JiraRequestError extends Error {
  readonly reason: JiraFailureReason;

  constructor(reason: JiraFailureReason) {
    const known: JiraFailureReason = Object.prototype.hasOwnProperty.call(JIRA_FAILURE_MESSAGES, reason)
      ? reason
      : 'failed';
    super(JIRA_FAILURE_MESSAGES[known]);
    this.name = 'JiraRequestError';
    this.reason = known;
  }
}

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_ISSUE_RESPONSE_BYTES = 16_384;
const ISSUE_KEY = /^[A-Z][A-Z0-9_]{0,63}-[1-9][0-9]{0,17}$/;

const isSuccess = (status: number) => status >= 200 && status <= 299;

/** Closes a response body without reading it. */
function discard(body: Readable): void {
  body.on('error', () => {});
  body.destroy();
}

/** The failure for a non-2xx status. 400 is only meaningful for issue creation. */
function failureFor(status: number, creatingIssue: boolean): JiraRequestError {
  if (status === 401 || status === 403) return new JiraRequestError('credentials_rejected');
  if (status === 400 && creatingIssue) return new JiraRequestError('issue_rejected');
  return new JiraRequestError('failed');
}

/** The JSON body of `body`, read only up to `limit` bytes. */
async function readCappedJson(body: Readable, limit: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of body) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > limit) throw new JiraRequestError('failed');
      chunks.push(buffer);
    }
  } catch {
    body.destroy();
    throw new JiraRequestError('failed');
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new JiraRequestError('failed');
  }
}

export class JiraClient {
  private axios: AxiosInstance;

  constructor(
    private baseUrl: string,
    private email: string,
    private apiToken: string
  ) {
    checkUrlSyntax(baseUrl, 'public-https');
    // Remove trailing slash from baseUrl
    this.baseUrl = baseUrl.trim().replace(/\/$/, '');

    // Create axios instance with default config
    this.axios = axios.create({
      baseURL: this.baseUrl,
      headers: this.getHeaders(),
      timeout: REQUEST_TIMEOUT_MS,
      adapter: 'http',
      // With no redirects axios uses core https rather than follow-redirects.
      maxRedirects: 0,
      // Otherwise HTTP(S)_PROXY from the environment would be the host connected to.
      proxy: false,
      httpsAgent: createSafeHttpsAgent(),
      allowAbsoluteUrls: false,
      responseType: 'stream',
      validateStatus: () => true,
      maxContentLength: 65_536,
      maxBodyLength: 1_048_576,
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

  private async request(method: Method, path: string, data?: unknown): Promise<AxiosResponse<Readable>> {
    try {
      return await this.axios.request<Readable>({
        method,
        url: path,
        data,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new JiraRequestError('failed');
    }
  }

  /** A request whose body is not needed: resolves on 2xx, otherwise throws by status. */
  private async requestStatusOnly(method: Method, path: string): Promise<void> {
    const response = await this.request(method, path);
    discard(response.data);
    if (!isSuccess(response.status)) throw failureFor(response.status, false);
  }

  /**
   * Test connection to Jira by fetching current user
   */
  async testConnection(): Promise<boolean> {
    await this.requestStatusOnly('GET', '/rest/api/3/myself');
    return true;
  }

  /**
   * Create a Jira issue. Only the new issue's key is taken from Jira's answer;
   * the link is built from the configured base URL.
   */
  async createIssue(payload: JiraIssuePayload): Promise<{ key: string; url: string }> {
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

    const response = await this.request('POST', '/rest/api/3/issue', jiraPayload);
    if (!isSuccess(response.status)) {
      discard(response.data);
      throw failureFor(response.status, true);
    }

    const body = await readCappedJson(response.data, MAX_ISSUE_RESPONSE_BYTES);
    const key = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).key : undefined;
    if (typeof key !== 'string' || !ISSUE_KEY.test(key)) throw new JiraRequestError('failed');
    return { key, url: `${this.baseUrl}/browse/${key}` };
  }

  /**
   * Validate project exists and is accessible
   */
  async validateProject(projectKey: string): Promise<boolean> {
    await this.requestStatusOnly('GET', `/rest/api/3/project/${projectKey}`);
    return true;
  }
}
