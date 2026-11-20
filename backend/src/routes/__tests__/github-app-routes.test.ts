/**
 * D8a routes over HTTP against the real database:
 * - /api/integrations/github: owner/admin only for changes, members and
 *   viewers read; the demo workspace is refused; bodies are strict (an
 *   organization id is rejected); repositories map only to the
 *   organization's own services; never a cross-organization row.
 * - /api/webhooks/github-app through the application's own body parsing:
 *   raw body + signature, the 1 MB limit, and the general limiter skip.
 * No GitHub call is made: every claim request here fails before one.
 */
import crypto from 'crypto';
import express from 'express';
import http from 'http';
import * as demo from '../../demo/demo-workspace';
import githubAppConnectionRoutes from '../github-app-connection.routes';
import githubAppWebhookRoutes from '../github-app-webhook.routes';
import { applyBodyParsing, GITHUB_APP_WEBHOOK_PATH, RAW_BODY_PATHS } from '../../middleware/body-parsing';
import { isGitHubAppWebhookRequest } from '../../middleware/rateLimiter';
import { errorHandler } from '../../middleware/error-handler';
import { ADMIN_REFUSAL, createRoleGateHarness, RoleGateOrg } from './role-gate-harness';

const SECRET = 'route-test-webhook-secret-000000001';
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const ENV = {
  GITHUB_APP_ENABLED: 'true',
  GITHUB_APP_ID: '123456',
  GITHUB_APP_SLUG: 'devcontrol-test',
  GITHUB_APP_CLIENT_ID: 'Iv1.placeholder0000',
  GITHUB_APP_CLIENT_SECRET: 'route-test-client-secret-0000001',
  GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().trim(),
  GITHUB_APP_WEBHOOK_SECRET: SECRET,
};

const harness = createRoleGateHarness('d8a-routes');
let A: RoleGateOrg;
let B: RoleGateOrg;
let repoA: string;
let repoB: string;
let serviceA: string;
let serviceB: string;
let webhookServer: http.Server;
let webhookUrl = '';
const heldInstallations: number[] = [];

beforeAll(async () => {
  Object.assign(process.env, ENV);
  A = await harness.buildOrg();
  B = await harness.buildOrg();
  const svc = async (org: string, name: string) => (await harness.pool.query(
    `INSERT INTO services (name, template, owner, status, organization_id) VALUES ($1, 'api', 'd8a', 'active', $2) RETURNING id::text AS id`,
    [name, org])).rows[0].id as string;
  serviceA = await svc(A.orgId, 'svc-a');
  serviceB = await svc(B.orgId, 'svc-b');
  const repo = async (org: string, n: number) => (await harness.pool.query(
    `INSERT INTO pipeline_repositories (organization_id, github_repo_id, full_name) VALUES ($1, $2, $3) RETURNING id::text AS id`,
    [org, 900000000 + n + Math.floor(Math.random() * 1e6), `acme/r${n}`])).rows[0].id as string;
  repoA = await repo(A.orgId, 1);
  repoB = await repo(B.orgId, 2);
  await harness.listen((app) => app.use('/api/integrations/github', githubAppConnectionRoutes));

  const app = express();
  applyBodyParsing(app);
  app.use(GITHUB_APP_WEBHOOK_PATH, githubAppWebhookRoutes);
  app.use(errorHandler);
  webhookServer = http.createServer(app);
  await new Promise<void>((resolve) => webhookServer.listen(0, resolve));
  const address = webhookServer.address();
  webhookUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}${GITHUB_APP_WEBHOOK_PATH}`;
});

afterAll(async () => {
  for (const k of Object.keys(ENV)) delete process.env[k];
  await new Promise<void>((resolve) => webhookServer.close(() => resolve()));
  await harness.pool.query('DELETE FROM github_held_deliveries WHERE installation_id = ANY($1::bigint[])', [heldInstallations]);
  await harness.close(async (orgIds) => {
    await harness.pool.query('DELETE FROM pipeline_repositories WHERE organization_id = ANY($1)', [orgIds]);
    await harness.pool.query('DELETE FROM github_install_states WHERE organization_id = ANY($1)', [orgIds]);
    await harness.pool.query('DELETE FROM services WHERE organization_id = ANY($1)', [orgIds]);
  });
});

afterEach(() => jest.restoreAllMocks());

const STATE = crypto.randomBytes(32).toString('base64url');

describe('/api/integrations/github', () => {
  it.each(['viewer', 'member'] as const)('%s: install, claim, retry and mapping are refused (403)', async (role) => {
    for (const [method, path, body] of [
      ['POST', '/integrations/github/install', {}],
      ['POST', '/integrations/github/claim', { state: STATE }],
      ['POST', '/integrations/github/claim/retry', { state: STATE }],
      ['PUT', `/integrations/github/repositories/${repoA}/service`, { service_id: serviceA }],
    ] as const) {
      const res = await harness.sendAs(A.orgId, A[role], method, path, body);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ ...ADMIN_REFUSAL, current: role });
    }
  });

  it('admin: install returns the GitHub install URL with a state; claim with an unknown state -> 400 before any GitHub call', async () => {
    const res = await harness.sendAs(A.orgId, A.admin, 'POST', '/integrations/github/install', {});
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.install_url).toMatch(/^https:\/\/github\.com\/apps\/devcontrol-test\/installations\/new\?state=[A-Za-z0-9_-]{43}$/);
    const fetchSpy = jest.spyOn(global, 'fetch');
    const claim = await harness.sendAs(A.orgId, A.owner, 'POST', '/integrations/github/claim', { state: STATE, code: 'abc', installation_id: '42' });
    expect(claim.status).toBe(400);
    expect(await claim.json()).toEqual({ success: false, error: 'invalid_state' });
    expect(fetchSpy.mock.calls.filter(([url]) => /github\.com/.test(String(url)))).toEqual([]);
  });

  it('bodies are strict: an organization id, an unknown field, a malformed installation id or state -> 400', async () => {
    for (const body of [
      { state: STATE, organization_id: B.orgId },
      { state: STATE, installation_id: 42 },
      { state: STATE, installation_id: '0042' },
      { state: 'short' },
      { state: STATE, setup_action: 'hack' },
    ]) {
      const res = await harness.sendAs(A.orgId, A.owner, 'POST', '/integrations/github/claim', body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ success: false, error: 'invalid_request' });
    }
  });

  it('the demo workspace is refused (403) for every change', async () => {
    jest.spyOn(demo, 'isDemoOrganization').mockResolvedValue(true);
    for (const [method, path, body] of [
      ['POST', '/integrations/github/install', {}],
      ['POST', '/integrations/github/claim', { state: STATE }],
      ['PUT', `/integrations/github/repositories/${repoA}/service`, { service_id: serviceA }],
    ] as const) {
      const res = await harness.sendAs(A.orgId, A.owner, method, path, body);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ success: false, error: 'not_available_in_demo' });
    }
  });

  it('feature off -> 503 for install and claim; GET answers configured:false only (zero-query proof: github-app-flag-off.test.ts)', async () => {
    process.env.GITHUB_APP_ENABLED = 'false';
    try {
      expect((await harness.sendAs(A.orgId, A.owner, 'POST', '/integrations/github/install', {})).status).toBe(503);
      expect((await harness.sendAs(A.orgId, A.owner, 'POST', '/integrations/github/claim', { state: STATE })).status).toBe(503);
      const get = await harness.sendAs(A.orgId, A.viewer, 'GET', '/integrations/github');
      expect(get.status).toBe(200);
      expect((await get.json()).data).toEqual({ configured: false });
    } finally {
      process.env.GITHUB_APP_ENABLED = 'true';
    }
  });

  it('repositories: a viewer reads only its organization\'s; mapping takes only the organization\'s own service and repository', async () => {
    const list = await (await harness.sendAs(A.orgId, A.viewer, 'GET', '/integrations/github/repositories')).json();
    expect(list.data.repositories.map((r: { id: string }) => r.id)).toEqual([repoA]);

    const own = await harness.sendAs(A.orgId, A.admin, 'PUT', `/integrations/github/repositories/${repoA}/service`, { service_id: serviceA });
    expect(own.status).toBe(200);
    const otherService = await harness.sendAs(A.orgId, A.admin, 'PUT', `/integrations/github/repositories/${repoA}/service`, { service_id: serviceB });
    expect(otherService.status).toBe(404);
    const otherRepo = await harness.sendAs(A.orgId, A.admin, 'PUT', `/integrations/github/repositories/${repoB}/service`, { service_id: serviceA });
    expect(otherRepo.status).toBe(404);
    const unmap = await harness.sendAs(A.orgId, A.admin, 'PUT', `/integrations/github/repositories/${repoA}/service`, { service_id: null });
    expect(unmap.status).toBe(200);
    const rows = (await harness.pool.query('SELECT id::text AS id, service_id FROM pipeline_repositories WHERE id = ANY($1::uuid[]) ORDER BY id', [[repoA, repoB]])).rows;
    expect(rows.every((r) => r.service_id === null)).toBe(true);
    // The organization id in the body is refused, never used.
    expect((await harness.sendAs(A.orgId, A.admin, 'PUT', `/integrations/github/repositories/${repoA}/service`, { service_id: serviceA, organization_id: B.orgId })).status).toBe(400);
  });
});

describe('/api/webhooks/github-app through the application body parsing', () => {
  const post = (raw: Buffer, headers: Record<string, string>) => fetch(webhookUrl, { method: "POST", body: new Uint8Array(raw), headers });
  const signed = (raw: Buffer) => 'sha256=' + crypto.createHmac('sha256', SECRET).update(raw).digest('hex');

  it('raw path: listed for the raw parser and the sanitizer skip; exempt from the general limiter', () => {
    expect(RAW_BODY_PATHS).toContain('/api/webhooks/github-app');
    const req = (method: string, originalUrl: string) => ({ method, originalUrl }) as express.Request;
    expect(isGitHubAppWebhookRequest(req('POST', '/api/webhooks/github-app'))).toBe(true);
    expect(isGitHubAppWebhookRequest(req('POST', '/api/webhooks/github-app?x=1'))).toBe(true);
    expect(isGitHubAppWebhookRequest(req('POST', '/api/webhooks/github'))).toBe(false);
    expect(isGitHubAppWebhookRequest(req('GET', '/api/webhooks/github-app'))).toBe(false);
  });

  it('a signed delivery for an unclaimed installation is held (202)', async () => {
    const inst = 8_500_000_000 + Math.floor(Math.random() * 1e8);
    heldInstallations.push(inst);
    const raw = Buffer.from(JSON.stringify({ action: 'created', installation: { id: inst, account: { id: 1, login: 'acme', type: 'Organization' } }, sender: { id: 5, login: 'x' } }));
    const id = crypto.randomUUID();
    const res = await post(raw, { 'content-type': 'application/json', 'x-github-event': 'installation', 'x-github-delivery': id, 'x-hub-signature-256': signed(raw) });
    expect(res.status).toBe(202);
    expect((await harness.pool.query('SELECT count(*)::int AS n FROM github_held_deliveries WHERE delivery_id = $1', [id])).rows[0].n).toBe(1);
  });

  it('over 1 MB -> 413, nothing written; a non-JSON content type -> 400 (no raw body)', async () => {
    const inst = 8_600_000_000 + Math.floor(Math.random() * 1e8);
    heldInstallations.push(inst);
    const big = Buffer.from(JSON.stringify({ action: 'created', installation: { id: inst }, pad: 'x'.repeat(1024 * 1024) }));
    const id = crypto.randomUUID();
    const res = await post(big, { 'content-type': 'application/json', 'x-github-event': 'installation', 'x-github-delivery': id, 'x-hub-signature-256': signed(big) });
    expect(res.status).toBe(413);
    expect((await harness.pool.query('SELECT count(*)::int AS n FROM github_held_deliveries WHERE delivery_id = $1', [id])).rows[0].n).toBe(0);
    const raw = Buffer.from('{"action":"created"}');
    const text = await post(raw, { 'content-type': 'text/plain', 'x-github-event': 'installation', 'x-github-delivery': crypto.randomUUID(), 'x-hub-signature-256': signed(raw) });
    expect(text.status).toBe(400);
  });
});
