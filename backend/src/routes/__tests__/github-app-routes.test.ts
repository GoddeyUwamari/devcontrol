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

    it('DELETE whose last step fails on a foreign key (23503) -> 409 try_again, and the whole disconnect is rolled back: claim kept, repository still linked', async () => {
      // A probe table referencing only this test's installation makes step 3 (DELETE the claim) fail after
      // step 2 (detach the repositories) ran: only one transaction around both undoes the detach.
      const instC = instB + 1;
      const probe = `d8b_fix_fk_probe_${Math.random().toString(36).slice(2, 10)}`;
      await seedClaim(A, instC, EXPECTED, 'expected');
      const repoC = (await harness.pool.query(
        `INSERT INTO pipeline_repositories (organization_id, github_repo_id, installation_id, full_name) VALUES ($1, $2, $3, 'acme/fk-probe') RETURNING id::text AS id`,
        [A.orgId, 910000000 + Math.floor(Math.random() * 1e6), instC])).rows[0].id;
      await harness.pool.query(`CREATE TABLE ${probe} (installation_id BIGINT NOT NULL REFERENCES github_installations(installation_id))`);
      try {
        await harness.pool.query(`INSERT INTO ${probe} VALUES ($1)`, [instC]);
        const res = await harness.sendAs(A.orgId, A.owner, 'DELETE', `/integrations/github/installations/${instC}`);
        expect(res.status).toBe(409);
        expect(await res.json()).toEqual({ success: false, error: 'try_again' });
        expect((await harness.pool.query('SELECT organization_id::text AS org FROM github_installations WHERE installation_id = $1', [instC])).rows).toEqual([{ org: A.orgId }]);
        expect((await harness.pool.query('SELECT installation_id::text AS i FROM pipeline_repositories WHERE id = $1', [repoC])).rows).toEqual([{ i: String(instC) }]);
      } finally {
        await harness.pool.query(`DROP TABLE IF EXISTS ${probe}`);
        await harness.pool.query('DELETE FROM pipeline_repositories WHERE id = $1', [repoC]);
        await harness.pool.query('DELETE FROM github_installations WHERE installation_id = $1', [instC]);
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

describe('D8b-2: repository activity, current role, one environment', () => {
  const inst = 8_900_000_000 + Math.floor(Math.random() * 1e8);
  const instB2 = inst + 1;
  let ghWait: number;
  let ghNoRule: number;
  let ghRec: number;
  let rowWait: string;
  let rowNoRule: string;
  let rowRec: string;
  let svcRec: string;

  const addRepo = async (org: string, gh: number, name: string, installation: number, service: string | null, rule: unknown) =>
    (await harness.pool.query(
      `INSERT INTO pipeline_repositories (organization_id, github_repo_id, installation_id, full_name, service_id, deploy_rule)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING id::text AS id`,
      [org, gh, installation, name, service, rule === null ? null : JSON.stringify(rule)])).rows[0].id as string;
  const addEvent = (org: string, gh: number, o: { event?: string; status: string; reason?: string | null; ago?: string; facts?: Record<string, unknown>; installation?: number }) =>
    harness.pool.query(
      `INSERT INTO pipeline_events (delivery_id, organization_id, installation_id, github_repo_id, event, action, normalizer_version, facts,
                                    received_at, processing_status, processing_reason, processed_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, 'completed', 1, $5::jsonb, NOW() - $6::interval, $7::text, $8::text,
               CASE WHEN $7::text = 'pending' THEN NULL ELSE NOW() END)`,
      [org, o.installation ?? inst, gh, o.event ?? 'workflow_job', JSON.stringify(o.facts ?? { kind: o.event ?? 'workflow_job' }), o.ago ?? '1 hour', o.status, o.reason ?? null]);
  const addAppDeployment = (org: string, service: string, gh: number, at: string, extra: Record<string, unknown> = {}) => harness.pool.query(
    `INSERT INTO deployments (service_id, environment, status, deployed_by, deployed_at, organization_id, metadata)
     VALUES ($1, 'production', 'success', 'd8b2', $2, $3, $4::jsonb) RETURNING id::text AS id`,
    [service, at, org, JSON.stringify({ connection: 'github_app', pipeline_metadata_version: 1, source: 'github_actions', github_repo_id: gh, ...extra })]);

  beforeAll(async () => {
    for (const [org, i] of [[A, inst], [B, instB2]] as const) {
      await harness.pool.query(
        `INSERT INTO github_installations (installation_id, organization_id, account_id, account_login, account_type, repository_selection,
           permissions, permissions_state, installer_github_user_id, claimed_by_user_id, claimed_by_github_user_id)
         VALUES ($1, $2, 777, $3, 'Organization', 'selected', '{}'::jsonb, 'expected', 8123, $4, 8123)`,
        [i, org.orgId, `acct-${i}`, org.owner]);
    }
    const base = 950_000_000 + Math.floor(Math.random() * 1e6);
    [ghWait, ghNoRule, ghRec] = [base, base + 1, base + 2];
    svcRec = (await harness.pool.query(
      `INSERT INTO services (name, template, owner, status, organization_id) VALUES ('svc-rec', 'api', 'd8b2', 'active', $1) RETURNING id::text AS id`,
      [A.orgId])).rows[0].id;
    rowWait = await addRepo(A.orgId, ghWait, 'acme/web-app', inst, null, null);
    rowNoRule = await addRepo(A.orgId, ghNoRule, 'acme/worker', inst, serviceA, null);
    rowRec = await addRepo(A.orgId, ghRec, 'acme/mobile-api', inst, svcRec, { v: 1, mode: 'job', workflow_name: 'CI', job_name: 'deploy-prod' });
    // B has a repository with A's waiting repository's GitHub id, and plenty of activity on it.
    const svcB = (await harness.pool.query(
      `INSERT INTO services (name, template, owner, status, organization_id) VALUES ('svc-b2', 'api', 'd8b2', 'active', $1) RETURNING id::text AS id`,
      [B.orgId])).rows[0].id;
    await addRepo(B.orgId, ghWait, 'b-corp/secret-repo', instB2, null, null);
    for (let i = 0; i < 5; i += 1) await addEvent(B.orgId, ghWait, { status: 'unmapped', reason: 'repository_not_mapped', installation: instB2 });
    await addEvent(B.orgId, ghWait, { event: 'deployment_status', status: 'unmapped', installation: instB2, facts: { kind: 'deployment_status', environment: 'b-secret-env' } });
    await addEvent(B.orgId, ghWait, { status: 'over_limit', reason: 'monthly_deployment_limit', installation: instB2, facts: { kind: 'workflow_job', job_id: 1, completed_at: new Date().toISOString() } });
    await addAppDeployment(B.orgId, svcB, ghWait, new Date().toISOString());

    // A, waiting for a service: 2 unmapped + 1 not processed yet = 3. Not: a claim hold, 8 days old, legacy, a workflow_run.
    await addEvent(A.orgId, ghWait, { status: 'unmapped', reason: 'repository_not_mapped' });
    await addEvent(A.orgId, ghWait, { event: 'deployment_status', status: 'unmapped', reason: 'repository_not_mapped', facts: { kind: 'deployment_status', environment: 'Production' } });
    await addEvent(A.orgId, ghWait, { status: 'pending' });
    await addEvent(A.orgId, ghWait, { status: 'pending', reason: 'installation_not_claimed' });
    await addEvent(A.orgId, ghWait, { status: 'unmapped', reason: 'repository_not_mapped', ago: '8 days' });
    await addEvent(A.orgId, ghWait, { status: 'ignored', reason: 'legacy_webhook_org' });
    await addEvent(A.orgId, ghWait, { event: 'workflow_run', status: 'unmapped', reason: 'repository_not_mapped' });
    // A, no rule: 2 no_deploy_rule + 1 unmapped = 3; one no_deploy_rule 8 days old is not counted.
    await addEvent(A.orgId, ghNoRule, { status: 'ignored', reason: 'no_deploy_rule', facts: { kind: 'workflow_job', workflow_name: 'Deploy', job_name: 'deploy' } });
    await addEvent(A.orgId, ghNoRule, { status: 'ignored', reason: 'no_deploy_rule', facts: { kind: 'workflow_job', workflow_name: 'Release', job_name: 'release' } });
    await addEvent(A.orgId, ghNoRule, { status: 'unmapped', reason: 'repository_not_mapped' });
    await addEvent(A.orgId, ghNoRule, { status: 'ignored', reason: 'no_deploy_rule', ago: '8 days' });
    await addEvent(A.orgId, ghNoRule, { event: 'deployment_status', status: 'ignored', reason: 'no_deploy_rule', facts: { kind: 'deployment_status', environment: 'production' } });
    await addEvent(A.orgId, ghNoRule, { event: 'deployment', status: 'processed', facts: { kind: 'deployment', environment: 'staging' } });
    await addEvent(A.orgId, ghNoRule, { event: 'deployment', status: 'processed', facts: { kind: 'deployment', environment: 'PRODUCTION' }, ago: '2 hours' });
    await addEvent(A.orgId, ghNoRule, { event: 'deployment', status: 'processed', facts: { kind: 'deployment', environment: 'old-env' }, ago: '40 days' });
    // A, recording: an unmapped event is not "held" once service and rule exist.
    await addEvent(A.orgId, ghRec, { status: 'unmapped', reason: 'repository_not_mapped' });
    // Over the limit this month: job 11 twice (one deployment), job 12; job 13 last month; job 14 recorded since.
    const now = new Date().toISOString();
    const lastMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 15)).toISOString();
    for (const [jobId, at] of [[11, now], [11, now], [12, now], [13, lastMonth], [14, now]] as const) {
      await addEvent(A.orgId, ghRec, { status: 'over_limit', reason: 'monthly_deployment_limit', facts: { kind: 'workflow_job', job_id: jobId, completed_at: at } });
    }
    await addAppDeployment(A.orgId, svcRec, ghRec, '2026-01-02T03:04:05.000Z', { github_job_id: 14 });
    await addAppDeployment(A.orgId, svcRec, ghRec, '2026-01-01T00:00:00.000Z');
  });

  afterAll(async () => {
    await harness.pool.query('DELETE FROM deployments WHERE deployed_by = $1 AND organization_id = ANY($2::uuid[])', ['d8b2', [A.orgId, B.orgId]]);
    await harness.pool.query('DELETE FROM pipeline_events WHERE installation_id = ANY($1::bigint[])', [[inst, instB2]]);
    await harness.pool.query('DELETE FROM pipeline_repositories WHERE installation_id = ANY($1::bigint[])', [[inst, instB2]]);
    await harness.pool.query('DELETE FROM github_installations WHERE installation_id = ANY($1::bigint[])', [[inst, instB2]]);
    await harness.pool.query("DELETE FROM services WHERE name IN ('svc-rec', 'svc-b2') AND organization_id = ANY($1::uuid[])", [[A.orgId, B.orgId]]);
  });

  it('GET /repositories: held, seen, last deployment and over-limit, from this organization only; held_event_days 7', async () => {
    const res = await harness.sendAs(A.orgId, A.viewer, 'GET', '/integrations/github/repositories');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.held_event_days).toBe(7);
    const byId = new Map(body.data.repositories.map((r: { id: string }) => [r.id, r]));
    expect(byId.get(rowWait)).toMatchObject({
      held_events: 3, environments_seen: ['Production'], jobs_seen: [], last_deployment_at: null, over_limit_this_month: 0,
    });
    expect(byId.get(rowNoRule)).toMatchObject({ held_events: 4 });
    const noRule = byId.get(rowNoRule) as { environments_seen: string[]; jobs_seen: unknown[] };
    // Distinct without case, newest spelling first; 40-day-old names are not "seen".
    expect([...noRule.environments_seen].sort()).toEqual(['production', 'staging']);
    expect(noRule.jobs_seen).toEqual(expect.arrayContaining([{ workflow_name: 'Deploy', job_name: 'deploy' }, { workflow_name: 'Release', job_name: 'release' }]));
    expect(noRule.jobs_seen).toHaveLength(2);
    expect(byId.get(rowRec)).toMatchObject({ held_events: 0, over_limit_this_month: 2, last_deployment_at: '2026-01-02T03:04:05.000Z' });
    // Nothing of B's: no names, no counts, no row.
    expect(JSON.stringify(body)).not.toMatch(/b-secret-env|b-corp|secret-repo/);
  });

  it('B reads its own numbers for the same GitHub repository id', async () => {
    const body = await (await harness.sendAs(B.orgId, B.viewer, 'GET', '/integrations/github/repositories')).json();
    const row = body.data.repositories.find((r: { github_repo_id: string }) => r.github_repo_id === String(ghWait));
    expect(row).toMatchObject({ full_name: 'b-corp/secret-repo', held_events: 6, environments_seen: ['b-secret-env'], over_limit_this_month: 1 });
    expect(row.last_deployment_at).not.toBeNull();
  });

  it('R5: the role is the current membership, not the token claim: an admin claim on a member membership is refused for both PUTs', async () => {
    for (const [path, body] of [
      [`/integrations/github/repositories/${rowWait}/service`, { service_id: serviceA }],
      [`/integrations/github/repositories/${rowWait}/deploy-rule`, { mode: 'none' }],
    ] as const) {
      const res = await harness.sendAs(A.orgId, A.member, 'PUT', path, body, 'admin');
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ ...ADMIN_REFUSAL, current: 'member' });
    }
    const row = (await harness.pool.query('SELECT service_id, deploy_rule FROM pipeline_repositories WHERE id = $1', [rowWait])).rows[0];
    expect(row).toEqual({ service_id: null, deploy_rule: null });
  });

  it('PUT deploy-rule with one environment: stored trimmed, other fields as before; another organization\'s repository -> 404', async () => {
    const res = await harness.sendAs(A.orgId, A.admin, 'PUT', `/integrations/github/repositories/${rowNoRule}/deploy-rule`,
      { mode: 'github_deployments', environment_name: ' staging ' });
    expect(res.status).toBe(200);
    const stored = { v: 1, mode: 'github_deployments', environment_name: 'staging', environment_map: {}, aws_region: null };
    expect((await res.json()).data.deploy_rule).toEqual(stored);
    expect((await harness.pool.query('SELECT deploy_rule FROM pipeline_repositories WHERE id = $1', [rowNoRule])).rows[0].deploy_rule).toEqual(stored);
    const listed = (await (await harness.sendAs(A.orgId, A.viewer, 'GET', '/integrations/github/repositories')).json())
      .data.repositories.find((r: { id: string }) => r.id === rowNoRule);
    expect(listed.held_events).toBe(0);
    const bRow = (await harness.pool.query('SELECT id::text AS id FROM pipeline_repositories WHERE organization_id = $1 AND github_repo_id = $2', [B.orgId, ghWait])).rows[0].id;
    expect((await harness.sendAs(A.orgId, A.admin, 'PUT', `/integrations/github/repositories/${bRow}/deploy-rule`, { mode: 'github_deployments', environment_name: 'x' })).status).toBe(404);
    expect((await harness.pool.query('SELECT deploy_rule FROM pipeline_repositories WHERE id = $1', [bRow])).rows[0].deploy_rule).toBeNull();
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
