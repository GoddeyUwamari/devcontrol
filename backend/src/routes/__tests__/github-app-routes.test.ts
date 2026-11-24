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
    await harness.pool.query('DELETE FROM pipeline_events WHERE organization_id = ANY($1)', [orgIds]);
    await harness.pool.query('DELETE FROM pipeline_repositories WHERE organization_id = ANY($1)', [orgIds]);
    await harness.pool.query('DELETE FROM github_install_states WHERE organization_id = ANY($1)', [orgIds]);
    await harness.pool.query('DELETE FROM services WHERE organization_id = ANY($1)', [orgIds]);
  });
});

afterEach(() => jest.restoreAllMocks());

const STATE = crypto.randomBytes(32).toString('base64url');

describe('/api/integrations/github', () => {
  it.each(['viewer', 'member'] as const)('%s: install, claim, retry, mapping and deploy rules are refused (403)', async (role) => {
    for (const [method, path, body] of [
      ['POST', '/integrations/github/install', {}],
      ['POST', '/integrations/github/claim', { state: STATE }],
      ['POST', '/integrations/github/claim/retry', { state: STATE }],
      ['PUT', `/integrations/github/repositories/${repoA}/service`, { service_id: serviceA }],
      ['PUT', `/integrations/github/repositories/${repoA}/deploy-rule`, { mode: 'none' }],
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
      ['PUT', `/integrations/github/repositories/${repoA}/deploy-rule`, { mode: 'none' }],
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

  it('deploy rule (D8a-2): an admin stores a validated, versioned rule on the organization\'s own repository; replay counts are returned', async () => {
    const res = await harness.sendAs(A.orgId, A.admin, 'PUT', `/integrations/github/repositories/${repoA}/deploy-rule`,
      { mode: 'job', workflow_name: 'CI', job_name: 'deploy-backend', aws_region: 'eu-west-1' });
    expect(res.status).toBe(200);
    const stored = { v: 1, mode: 'job', workflow_name: 'CI', job_name: 'deploy-backend', environment: 'production', branch: 'default', branch_name: null, aws_region: 'eu-west-1' };
    expect(await res.json()).toEqual({ success: true, data: { deploy_rule: stored, replay: { considered: 0, recorded: 0 } } });
    const row = (await harness.pool.query('SELECT deploy_rule FROM pipeline_repositories WHERE id = $1', [repoA])).rows[0];
    expect(row.deploy_rule).toEqual(stored);
    const list = await (await harness.sendAs(A.orgId, A.viewer, 'GET', '/integrations/github/repositories')).json();
    expect(list.data.repositories[0].deploy_rule).toEqual(stored);

    // Another organization's repository -> 404, unchanged.
    const other = await harness.sendAs(A.orgId, A.admin, 'PUT', `/integrations/github/repositories/${repoB}/deploy-rule`, { mode: 'none' });
    expect(other.status).toBe(404);
    expect((await harness.pool.query('SELECT deploy_rule FROM pipeline_repositories WHERE id = $1', [repoB])).rows[0].deploy_rule).toBeNull();
  });

  it('deploy rule bodies are strict: an organization id, an unknown mode or field, a bad region -> 400 and nothing stored', async () => {
    await harness.pool.query('UPDATE pipeline_repositories SET deploy_rule = NULL WHERE id = $1', [repoA]);
    for (const body of [
      { mode: 'none', organization_id: B.orgId },
      { mode: 'auto' },
      { mode: 'job', workflow_name: 'CI' },
      { mode: 'job', workflow_name: 'CI', job_name: 'deploy', aws_region: 'nowhere' },
      { mode: 'github_deployments', environment_map: { prod: 'prod' } },
    ]) {
      const res = await harness.sendAs(A.orgId, A.owner, 'PUT', `/integrations/github/repositories/${repoA}/deploy-rule`, body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ success: false, error: 'invalid_request' });
    }
    const duplicate = await harness.sendAs(A.orgId, A.owner, 'PUT', `/integrations/github/repositories/${repoA}/deploy-rule`,
      { mode: 'github_deployments', environment_map: { Prod: 'production', prod: 'staging' } });
    expect(duplicate.status).toBe(400);
    expect(await duplicate.json()).toEqual({
      success: false,
      error: 'invalid_request',
      message: 'environment_map names GitHub environments that differ only in letter case ("Prod", "prod"). Names are matched without case, so keep one of each.',
    });
    expect((await harness.sendAs(A.orgId, A.owner, 'PUT', '/integrations/github/repositories/not-a-uuid/deploy-rule', { mode: 'none' })).status).toBe(400);
    expect((await harness.pool.query('SELECT deploy_rule FROM pipeline_repositories WHERE id = $1', [repoA])).rows[0].deploy_rule).toBeNull();
  });

  describe('D8b-1: can_manage, demo, permission differences, disconnect', () => {
    const instA = 8_800_000_000 + Math.floor(Math.random() * 1e8);
    const instB = instA + 1;
    const seedClaim = (org: RoleGateOrg, inst: number, permissions: Record<string, string>, state: 'expected' | 'mismatch') => harness.pool.query(
      `INSERT INTO github_installations (installation_id, organization_id, account_id, account_login, account_type, repository_selection,
         permissions, permissions_state, installer_github_user_id, claimed_by_user_id, claimed_by_github_user_id)
       VALUES ($1, $2, 777, $3, 'Organization', 'selected', $4::jsonb, $5, 8123, $6, 8123)`,
      [inst, org.orgId, `acct-${inst}`, JSON.stringify(permissions), state, org.owner]);
    const EXPECTED = { actions: 'read', deployments: 'read', metadata: 'read', pull_requests: 'read' };

    beforeAll(async () => {
      await seedClaim(A, instA, { ...EXPECTED, contents: 'read', actions: 'write' }, 'mismatch');
      await seedClaim(B, instB, EXPECTED, 'expected');
      await harness.pool.query('UPDATE pipeline_repositories SET installation_id = $1, service_id = $2, deploy_rule = $3::jsonb WHERE id = $4',
        [instA, serviceA, JSON.stringify({ v: 1, mode: 'none' }), repoA]);
      await harness.pool.query('UPDATE pipeline_repositories SET installation_id = $1 WHERE id = $2', [instB, repoB]);
    });
    afterAll(async () => {
      await harness.pool.query('UPDATE pipeline_repositories SET installation_id = NULL WHERE id = ANY($1::uuid[])', [[repoA, repoB]]);
      await harness.pool.query('DELETE FROM github_installations WHERE installation_id = ANY($1::bigint[])', [[instA, instB]]);
    });

    it.each([['owner', true], ['admin', true], ['member', false], ['viewer', false]] as const)('GET as %s: can_manage %s, demo false', async (role, canManage) => {
      const res = await harness.sendAs(A.orgId, A[role], 'GET', '/integrations/github');
      expect(res.status).toBe(200);
      const data = (await res.json()).data;
      expect(data).toMatchObject({ configured: true, can_manage: canManage, demo: false });
    });

    it('GET in the demo workspace: can_manage false even for the owner, demo true', async () => {
      jest.spyOn(demo, 'isDemoOrganization').mockResolvedValue(true);
      const data = (await (await harness.sendAs(A.orgId, A.owner, 'GET', '/integrations/github')).json()).data;
      expect(data).toMatchObject({ configured: true, can_manage: false, demo: true });
    });

    it('GET lists only the organization\'s own installations, with the permission differences and the claimer\'s name; never the raw permission set', async () => {
      const data = (await (await harness.sendAs(A.orgId, A.viewer, 'GET', '/integrations/github')).json()).data;
      expect(data.installations).toHaveLength(1);
      const [row] = data.installations;
      expect(row).toMatchObject({ installation_id: String(instA), account_login: `acct-${instA}`, permissions_state: 'mismatch', claimed_by_name: 'Role Gate User' });
      expect(row.permission_differences).toEqual([
        { permission: 'actions', granted: 'write', expected: 'read' },
        { permission: 'contents', granted: 'read', expected: null },
      ]);
      expect(row).not.toHaveProperty('permissions');
      const other = (await (await harness.sendAs(B.orgId, B.viewer, 'GET', '/integrations/github')).json()).data;
      expect(other.installations.map((i: { installation_id: string }) => i.installation_id)).toEqual([String(instB)]);
      expect(other.installations[0].permission_differences).toEqual([]);
    });

    it.each(['viewer', 'member'] as const)('DELETE as %s -> 403, nothing changed', async (role) => {
      const res = await harness.sendAs(A.orgId, A[role], 'DELETE', `/integrations/github/installations/${instA}`);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ ...ADMIN_REFUSAL, current: role });
      expect((await harness.pool.query('SELECT count(*)::int AS n FROM github_installations WHERE installation_id = $1', [instA])).rows[0].n).toBe(1);
    });

    it('DELETE in the demo workspace -> 403 not_available_in_demo, nothing changed', async () => {
      jest.spyOn(demo, 'isDemoOrganization').mockResolvedValue(true);
      const res = await harness.sendAs(A.orgId, A.owner, 'DELETE', `/integrations/github/installations/${instA}`);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ success: false, error: 'not_available_in_demo' });
      expect((await harness.pool.query('SELECT count(*)::int AS n FROM github_installations WHERE installation_id = $1', [instA])).rows[0].n).toBe(1);
    });

    it('DELETE of another organization\'s installation -> 404 and it is untouched; a malformed id -> 400', async () => {
      const res = await harness.sendAs(A.orgId, A.owner, 'DELETE', `/integrations/github/installations/${instB}`);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ success: false, error: 'not_found' });
      const b = (await harness.pool.query('SELECT organization_id::text AS org FROM github_installations WHERE installation_id = $1', [instB])).rows;
      expect(b).toEqual([{ org: B.orgId }]);
      expect((await harness.pool.query('SELECT installation_id::text AS i FROM pipeline_repositories WHERE id = $1', [repoB])).rows[0].i).toBe(String(instB));
      for (const id of ['0', '0042', 'abc', '12345678901234567890']) {
        expect((await harness.sendAs(A.orgId, A.owner, 'DELETE', `/integrations/github/installations/${id}`)).status).toBe(400);
      }
    });

    it('DELETE by an admin: the claim goes, the repository keeps its service and rule (detached), deployments untouched; again -> 404', async () => {
      const deployment = (await harness.pool.query(
        `INSERT INTO deployments (service_id, environment, aws_region, status, deployed_by, organization_id)
         VALUES ($1, 'production', 'us-east-1', 'success', 'd8b-test', $2) RETURNING id::text AS id`, [serviceA, A.orgId])).rows[0].id;
      try {
        const res = await harness.sendAs(A.orgId, A.admin, 'DELETE', `/integrations/github/installations/${instA}`);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ success: true, data: { disconnected: true, repositories: 1 } });
        expect((await harness.pool.query('SELECT count(*)::int AS n FROM github_installations WHERE installation_id = $1', [instA])).rows[0].n).toBe(0);
        const repo = (await harness.pool.query('SELECT installation_id, service_id::text AS service_id, deploy_rule FROM pipeline_repositories WHERE id = $1', [repoA])).rows[0];
        expect(repo).toEqual({ installation_id: null, service_id: serviceA, deploy_rule: { v: 1, mode: 'none' } });
        expect((await harness.pool.query('SELECT count(*)::int AS n FROM deployments WHERE id = $1', [deployment])).rows[0].n).toBe(1);
        // B's installation is not affected.
        expect((await harness.pool.query('SELECT count(*)::int AS n FROM github_installations WHERE installation_id = $1', [instB])).rows[0].n).toBe(1);
        expect((await harness.sendAs(A.orgId, A.owner, 'DELETE', `/integrations/github/installations/${instA}`)).status).toBe(404);
        const after = (await (await harness.sendAs(A.orgId, A.viewer, 'GET', '/integrations/github')).json()).data;
        expect(after.installations).toEqual([]);
      } finally {
        await harness.pool.query('DELETE FROM deployments WHERE id = $1', [deployment]);
      }
    });
  });

  it('jobs seen: a viewer reads its own repository\'s completed jobs (30 days, distinct); another organization\'s repository -> 404', async () => {
    const repoIdOf = async (id: string) => (await harness.pool.query('SELECT github_repo_id FROM pipeline_repositories WHERE id = $1', [id])).rows[0].github_repo_id;
    const seed = async (org: string, repo: string, job: string, branch: string, daysAgo: number) => harness.pool.query(
      `INSERT INTO pipeline_events (delivery_id, organization_id, installation_id, github_repo_id, event, action, normalizer_version, facts, received_at)
       VALUES (gen_random_uuid(), $1, 1, $2, 'workflow_job', 'completed', 1, $3::jsonb, NOW() - make_interval(days => $4))`,
      [org, await repoIdOf(repo), JSON.stringify({ kind: 'workflow_job', workflow_name: 'CI', job_name: job, head_branch: branch }), daysAgo]);
    await seed(A.orgId, repoA, 'deploy-backend', 'main', 1);
    await seed(A.orgId, repoA, 'deploy-backend', 'main', 2);
    await seed(A.orgId, repoA, 'lint-and-build', 'feature', 3);
    await seed(A.orgId, repoA, 'old-job', 'main', 40);
    await seed(B.orgId, repoB, 'b-secret-job', 'main', 1);

    const own = await harness.sendAs(A.orgId, A.viewer, 'GET', `/integrations/github/repositories/${repoA}/jobs-seen`);
    expect(own.status).toBe(200);
    const jobs = (await own.json()).data.jobs;
    expect(jobs.map((j: { workflow_name: string; job_name: string; head_branch: string; runs: number }) => [j.workflow_name, j.job_name, j.head_branch, j.runs])).toEqual([
      ['CI', 'deploy-backend', 'main', 2],
      ['CI', 'lint-and-build', 'feature', 1],
    ]);
    expect((await harness.sendAs(A.orgId, A.viewer, 'GET', `/integrations/github/repositories/${repoB}/jobs-seen`)).status).toBe(404);
    expect((await harness.sendAs(A.orgId, A.viewer, 'GET', '/integrations/github/repositories/x/jobs-seen')).status).toBe(400);
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
    expect(isGitHubAppWebhookRequest(req('POST', '/api/webhooks/github-app/'))).toBe(true);
    expect(isGitHubAppWebhookRequest(req('POST', '/api/webhooks/github-app/?x=1'))).toBe(true);
    expect(isGitHubAppWebhookRequest(req('POST', '/api/webhooks/github-app/x'))).toBe(false);
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

  it('unsigned or wrongly signed, through the real body parser -> 401, no held row and no event row', async () => {
    const inst = 8_700_000_000 + Math.floor(Math.random() * 1e8);
    heldInstallations.push(inst);
    const raw = Buffer.from(JSON.stringify({ action: 'created', installation: { id: inst, account: { id: 1, login: 'acme', type: 'Organization' } }, sender: { id: 5, login: 'x' } }));
    const wrong = 'sha256=' + crypto.createHmac('sha256', 'not-the-route-test-webhook-secret-01').update(raw).digest('hex');
    const ids: string[] = [];
    for (const signature of [undefined, wrong]) {
      const id = crypto.randomUUID();
      ids.push(id);
      const headers: Record<string, string> = { 'content-type': 'application/json', 'x-github-event': 'installation', 'x-github-delivery': id };
      if (signature) headers['x-hub-signature-256'] = signature;
      const res = await post(raw, headers);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ received: false, error: 'invalid_signature' });
    }
    const count = async (table: string) => (await harness.pool.query(
      `SELECT count(*)::int AS n FROM ${table} WHERE delivery_id = ANY($1::uuid[]) OR installation_id = $2`, [ids, inst])).rows[0].n;
    expect(await count('github_held_deliveries')).toBe(0);
    expect(await count('pipeline_events')).toBe(0);
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
