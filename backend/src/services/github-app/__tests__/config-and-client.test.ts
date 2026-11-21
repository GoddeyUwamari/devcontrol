import crypto from 'crypto';
import { GITHUB_APP_REQUIRED_ENV, gitHubAppConfigWarning, readGitHubAppConfig } from '../../../config/github-app';
import { createAppJwt, createFetchGitHubAppClient, GitHubClientError } from '../client';
import { EXPECTED_PERMISSIONS, permissionsStateOf } from '../permissions';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().trim();

const SECRET_VALUES = {
  clientSecret: 'planted-client-secret-value-123456',
  webhook: 'planted-webhook-secret-value-123456',
};

function env(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    GITHUB_APP_ENABLED: 'true',
    GITHUB_APP_ID: '123456',
    GITHUB_APP_SLUG: 'devcontrol-test',
    GITHUB_APP_CLIENT_ID: 'Iv1.placeholder0000',
    GITHUB_APP_CLIENT_SECRET: SECRET_VALUES.clientSecret,
    GITHUB_APP_PRIVATE_KEY: PEM.replace(/\n/g, '\\n'),
    GITHUB_APP_WEBHOOK_SECRET: SECRET_VALUES.webhook,
    ...overrides,
  };
}

describe('GitHub App configuration (names only, off unless complete)', () => {
  it('enabled with every value; the one-line PEM is unescaped', () => {
    const result = readGitHubAppConfig(env());
    expect(result.enabled).toBe(true);
    if (result.enabled) {
      expect(result.config.privateKey).toBe(PEM);
      expect(result.config.webhookSecrets).toEqual([SECRET_VALUES.webhook]);
    }
  });

  it('off unless GITHUB_APP_ENABLED is exactly "true"', () => {
    expect(readGitHubAppConfig(env({ GITHUB_APP_ENABLED: undefined }))).toEqual({ enabled: false, reason: 'disabled', problems: [] });
    expect(readGitHubAppConfig(env({ GITHUB_APP_ENABLED: '1' })).enabled).toBe(false);
    expect(gitHubAppConfigWarning(env({ GITHUB_APP_ENABLED: undefined }))).toBeNull();
  });

  it.each(GITHUB_APP_REQUIRED_ENV)('off when %s is missing, and the warning names it without any value', (name) => {
    const result = readGitHubAppConfig(env({ [name]: '' }));
    expect(result.enabled).toBe(false);
    const warning = gitHubAppConfigWarning(env({ [name]: '' }))!;
    expect(warning).toContain(`${name} is not set`);
    for (const value of [SECRET_VALUES.clientSecret, SECRET_VALUES.webhook, 'BEGIN PRIVATE KEY', '123456']) {
      expect(warning).not.toContain(value);
    }
  });

  it('rejects malformed values and short secrets; adds the previous secret while rotating', () => {
    expect(readGitHubAppConfig(env({ GITHUB_APP_ID: 'abc' })).enabled).toBe(false);
    expect(readGitHubAppConfig(env({ GITHUB_APP_SLUG: 'Bad Slug' })).enabled).toBe(false);
    expect(readGitHubAppConfig(env({ GITHUB_APP_PRIVATE_KEY: 'not a key' })).enabled).toBe(false);
    expect(readGitHubAppConfig(env({ GITHUB_APP_WEBHOOK_SECRET: 'short' })).enabled).toBe(false);
    const rotating = readGitHubAppConfig(env({ GITHUB_APP_WEBHOOK_SECRET_PREVIOUS: 'previous-secret-value-0123456' }));
    expect(rotating.enabled && rotating.config.webhookSecrets).toEqual([SECRET_VALUES.webhook, 'previous-secret-value-0123456']);
  });
});

describe('App permissions check (D8-D3)', () => {
  it('expected = exactly Metadata, Actions, Deployments, Pull requests, all read', () => {
    expect(permissionsStateOf(EXPECTED_PERMISSIONS)).toBe('expected');
    expect(permissionsStateOf({ ...EXPECTED_PERMISSIONS, contents: 'read' })).toBe('mismatch');
    expect(permissionsStateOf({ ...EXPECTED_PERMISSIONS, actions: 'write' })).toBe('mismatch');
    const { pull_requests: _dropped, ...fewer } = EXPECTED_PERMISSIONS;
    expect(permissionsStateOf(fewer)).toBe('mismatch');
  });
});

describe('GitHub client (local fixtures, no network)', () => {
  const config = (readGitHubAppConfig(env()) as { enabled: true; config: any }).config;

  it('App JWT: RS256, iat 60 s back, exp 9 min ahead, iss = client ID, verifiable with the public key', () => {
    const now = Date.UTC(2026, 10, 20, 12, 0, 0);
    const jwt = createAppJwt(config, now);
    const [h, p, s] = jwt.split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
    expect(claims).toEqual({ iat: now / 1000 - 60, exp: now / 1000 + 540, iss: 'Iv1.placeholder0000' });
    expect(crypto.createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, Buffer.from(s, 'base64url'))).toBe(true);
  });

  function fakeFetch(routes: Record<string, (init: RequestInit) => { status: number; body: string }>) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const impl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const key = Object.keys(routes).find((k) => url.startsWith(k));
      const out = key ? routes[key](init) : { status: 404, body: '{}' };
      return new Response(out.body, { status: out.status });
    }) as unknown as typeof fetch;
    return { impl, calls };
  }

  it('exchanges the code (JSON or form answer) and never sends anything outside github.com / api.github.com', async () => {
    const json = fakeFetch({ 'https://github.com/login/oauth/access_token': () => ({ status: 200, body: '{"access_token":"ghu_placeholder"}' }) });
    expect(await createFetchGitHubAppClient(config, json.impl).exchangeCode('code123')).toBe('ghu_placeholder');
    expect(JSON.parse(json.calls[0].init.body as string)).toEqual({ client_id: 'Iv1.placeholder0000', client_secret: SECRET_VALUES.clientSecret, code: 'code123' });
    const form = fakeFetch({ 'https://github.com/login/oauth/access_token': () => ({ status: 200, body: 'access_token=ghu_form&token_type=bearer' }) });
    expect(await createFetchGitHubAppClient(config, form.impl).exchangeCode('c')).toBe('ghu_form');
    const denied = fakeFetch({ 'https://github.com/login/oauth/access_token': () => ({ status: 200, body: '{"error":"bad_verification_code"}' }) });
    await expect(createFetchGitHubAppClient(config, denied.impl).exchangeCode('c')).rejects.toEqual(new GitHubClientError('github_rejected'));
  });

  it('maps 5xx/429/network to github_unavailable and 4xx to github_rejected, with no body in the error', async () => {
    const down = fakeFetch({ 'https://api.github.com/user': () => ({ status: 503, body: 'secret-looking upstream text' }) });
    const err = await createFetchGitHubAppClient(config, down.impl).getAuthenticatedUser('t').catch((e) => e);
    expect(err).toBeInstanceOf(GitHubClientError);
    expect(err.code).toBe('github_unavailable');
    expect(String(err.message)).not.toContain('upstream');
    const no = fakeFetch({ 'https://api.github.com/user': () => ({ status: 401, body: '{}' }) });
    expect((await createFetchGitHubAppClient(config, no.impl).getAuthenticatedUser('t').catch((e) => e)).code).toBe('github_rejected');
  });

  it('lists the user installations across pages, and reads an installation with the App JWT', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, account: { id: 777, login: 'acme', type: 'Organization' } }));
    const f = fakeFetch({
      'https://api.github.com/user/installations?per_page=100&page=1': () => ({ status: 200, body: JSON.stringify({ installations: page1 }) }),
      'https://api.github.com/user/installations?per_page=100&page=2': () => ({ status: 200, body: JSON.stringify({ installations: [{ id: 4242, account: { id: 777, login: 'acme', type: 'Organization' } }] }) }),
      'https://api.github.com/app/installations/4242': () => ({ status: 200, body: JSON.stringify({ id: 4242, account: { id: 777, login: 'acme', type: 'Organization' }, repository_selection: 'all', permissions: EXPECTED_PERMISSIONS, events: ['workflow_job'] }) }),
    });
    const client = createFetchGitHubAppClient(config, f.impl);
    const list = await client.listUserInstallations('ghu_x');
    expect(list).toHaveLength(101);
    expect(list.some((i) => i.id === 4242)).toBe(true);
    const details = await client.getInstallation(4242);
    expect(details).toMatchObject({ id: 4242, repositorySelection: 'all', account: { login: 'acme' } });
    const auth = (f.calls.at(-1)!.init.headers as Record<string, string>).Authorization;
    expect(auth).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  });
});
