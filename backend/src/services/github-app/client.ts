/**
 * The few GitHub API calls D8a makes, behind an interface so tests use local
 * fixtures and never the network. No dependency: Node's fetch and crypto.
 *
 * - App JWT (docs: "Generating a JSON Web Token (JWT) for a GitHub App"):
 *   RS256, iat 60 s in the past, exp at most 10 minutes ahead (9 here),
 *   iss = the App's client ID (recommended by the docs).
 * - User code exchange (docs: "Generating a user access token for a GitHub
 *   App"): POST https://github.com/login/oauth/access_token with client_id,
 *   client_secret, code. JSON is requested; a form-encoded answer is parsed too
 *   (d8a-build.md §1.9 V9 unconfirmed).
 *
 * Tokens (user, installation, JWT) live in memory only: never stored, never
 * logged. Errors carry a fixed code, never a response body.
 */
import crypto from 'crypto';
import { GitHubAppConfig } from '../../config/github-app';

export class GitHubClientError extends Error {
  constructor(readonly code: 'github_unavailable' | 'github_rejected' | 'github_malformed') {
    super(code);
    this.name = 'GitHubClientError';
  }
}

interface GitHubAccount {
  id: number;
  login: string;
  type: 'User' | 'Organization' | 'Enterprise';
}

export interface GitHubInstallationDetails {
  id: number;
  account: GitHubAccount;
  repositorySelection: 'all' | 'selected';
  permissions: Record<string, string>;
  events: string[];
}

interface GitHubRepository {
  id: number;
  fullName: string;
  defaultBranch: string | null;
}

export interface GitHubAppClient {
  /** OAuth code -> user access token (kept in memory by the caller for one request). */
  exchangeCode(code: string): Promise<string>;
  getAuthenticatedUser(userToken: string): Promise<{ id: number; login: string }>;
  /** Installation ids of this App the user can access (paginated, bounded). */
  listUserInstallations(userToken: string): Promise<Array<{ id: number; account: GitHubAccount }>>;
  getInstallation(installationId: number): Promise<GitHubInstallationDetails>;
  listInstallationRepositories(installationId: number): Promise<GitHubRepository[]>;
}

const API = 'https://api.github.com';
const OAUTH_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const ALLOWED_HOSTS = new Set(['api.github.com', 'github.com']);
const TIMEOUT_MS = 5000;
const MAX_PAGES = 10;
const ACCOUNT_TYPES = new Set(['User', 'Organization', 'Enterprise']);

const b64url = (input: Buffer | string) => Buffer.from(input).toString('base64url');

/** The App JWT. `now` is injectable for tests. */
export function createAppJwt(config: Pick<GitHubAppConfig, 'clientId' | 'privateKey'>, now: number = Date.now()): string {
  const iat = Math.floor(now / 1000) - 60;
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iat, exp: iat + 60 + 9 * 60, iss: config.clientId }));
  const signature = crypto.createSign('RSA-SHA256').update(`${header}.${payload}`).sign(config.privateKey);
  return `${header}.${payload}.${b64url(signature)}`;
}

type Fetch = typeof fetch;

const positiveId = (x: unknown): number | null => (typeof x === 'number' && Number.isSafeInteger(x) && x > 0 ? x : null);

function account(x: any): GitHubAccount | null {
  const id = positiveId(x?.id);
  const login = typeof x?.login === 'string' ? x.login : typeof x?.slug === 'string' ? x.slug : null;
  if (!id || !login || login.length > 100 || !ACCOUNT_TYPES.has(x?.type)) return null;
  return { id, login, type: x.type };
}

export function createFetchGitHubAppClient(config: GitHubAppConfig, fetchImpl: Fetch = fetch): GitHubAppClient {
  const installationTokens = new Map<number, { token: string; expiresAt: number }>();

  async function call(url: string, init: RequestInit): Promise<any> {
    const host = new URL(url).hostname;
    if (!ALLOWED_HOSTS.has(host)) throw new GitHubClientError('github_rejected');
    let response: Response;
    try {
      response = await fetchImpl(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new GitHubClientError('github_unavailable');
    }
    if (response.status >= 500 || response.status === 429) throw new GitHubClientError('github_unavailable');
    if (!response.ok) throw new GitHubClientError('github_rejected');
    const body = await response.text();
    try {
      return JSON.parse(body);
    } catch {
      // The OAuth endpoint may answer form-encoded.
      const form = new URLSearchParams(body);
      if ([...form.keys()].length > 0) return Object.fromEntries(form);
      throw new GitHubClientError('github_malformed');
    }
  }

  const apiHeaders = (token: string, scheme: 'Bearer' | 'token' = 'Bearer') => ({
    Accept: 'application/vnd.github+json',
    Authorization: `${scheme} ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'devcontrol-github-app',
  });

  async function installationToken(installationId: number): Promise<string> {
    const cached = installationTokens.get(installationId);
    if (cached && cached.expiresAt - 5 * 60_000 > Date.now()) return cached.token;
    const body = await call(`${API}/app/installations/${installationId}/access_tokens`, {
      method: 'POST',
      headers: apiHeaders(createAppJwt(config)),
    });
    const token = typeof body?.token === 'string' ? body.token : null;
    const expiresAt = Date.parse(body?.expires_at);
    if (!token || !Number.isFinite(expiresAt)) throw new GitHubClientError('github_malformed');
    installationTokens.set(installationId, { token, expiresAt });
    return token;
  }

  return {
    async exchangeCode(code) {
      const body = await call(OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'devcontrol-github-app' },
        body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, code }),
      });
      if (typeof body?.access_token !== 'string' || body.access_token.length === 0) throw new GitHubClientError('github_rejected');
      return body.access_token;
    },

    async getAuthenticatedUser(userToken) {
      const body = await call(`${API}/user`, { headers: apiHeaders(userToken) });
      const id = positiveId(body?.id);
      if (!id || typeof body?.login !== 'string') throw new GitHubClientError('github_malformed');
      return { id, login: body.login };
    },

    async listUserInstallations(userToken) {
      const out: Array<{ id: number; account: GitHubAccount }> = [];
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const body = await call(`${API}/user/installations?per_page=100&page=${page}`, { headers: apiHeaders(userToken) });
        const items: any[] = Array.isArray(body?.installations) ? body.installations : [];
        for (const item of items) {
          const id = positiveId(item?.id);
          const acct = account(item?.account);
          if (id && acct) out.push({ id, account: acct });
        }
        if (items.length < 100) break;
      }
      return out;
    },

    async getInstallation(installationId) {
      const body = await call(`${API}/app/installations/${installationId}`, { headers: apiHeaders(createAppJwt(config)) });
      const acct = account(body?.account);
      const selection = body?.repository_selection;
      if (positiveId(body?.id) !== installationId || !acct || (selection !== 'all' && selection !== 'selected')) {
        throw new GitHubClientError('github_malformed');
      }
      const permissions: Record<string, string> = {};
      for (const [k, v] of Object.entries(body?.permissions ?? {})) if (typeof v === 'string') permissions[k] = v;
      const events = Array.isArray(body?.events) ? body.events.filter((e: unknown) => typeof e === 'string') : [];
      return { id: installationId, account: acct, repositorySelection: selection, permissions, events };
    },

    async listInstallationRepositories(installationId) {
      const token = await installationToken(installationId);
      const out: GitHubRepository[] = [];
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const body = await call(`${API}/installation/repositories?per_page=100&page=${page}`, { headers: apiHeaders(token) });
        const items: any[] = Array.isArray(body?.repositories) ? body.repositories : [];
        for (const item of items) {
          const id = positiveId(item?.id);
          if (id && typeof item?.full_name === 'string' && item.full_name.includes('/') && item.full_name.length <= 255) {
            out.push({ id, fullName: item.full_name, defaultBranch: typeof item.default_branch === 'string' ? item.default_branch.slice(0, 255) : null });
          }
        }
        if (items.length < 100) break;
      }
      return out;
    },
  };
}
