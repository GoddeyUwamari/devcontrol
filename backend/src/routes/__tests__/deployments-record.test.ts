/**
 * D2: POST /api/deployments records a deployment that already happened.
 *
 * Policy under test:
 *   - status is optional. Omitted, the row is 'deploying' (as before D2).
 *     'success' / 'failed' record a finished deployment. Any other value is
 *     400 and nothing is written.
 *   - The service must already exist in the caller's organization, by id or
 *     by name. An unknown id or name, and another organization's service,
 *     are all 400 "Choose an existing service." -- no service is created, no
 *     deployment row is written.
 *   - deployed_by is the signed-in user's email (from the current
 *     membership, not the JWT claim, not the body). deployed_at is the
 *     server's now: a deployed_at in the body is ignored. metadata is
 *     { source: 'manual' }: a metadata object in the body is ignored.
 *   - owner, admin and member may record; a viewer gets 403 and nothing is
 *     written.
 *   - A finished record is announced as deployment:completed, never as
 *     deployment:started.
 *   - The GitHub webhook path is unchanged (source 'github_actions').
 *   - Downstream: a manual success / failed row is counted by Deployment
 *     History (GET /api/deployments, /stats) and by the DORA repository and
 *     service exactly as the webhook's rows are.
 *
 * Real routes over an in-process HTTP server against live Postgres. The test
 * role is not subject to RLS, so the organization checks pass only because of
 * the predicates in the statements. Only authService.verifyToken is stubbed.
 */
import crypto, { randomUUID } from 'crypto';
import express from 'express';
import http from 'http';
import { Pool } from 'pg';
import deploymentsRoutes from '../deployments.routes';
import { errorHandler } from '../../middleware/error-handler';
import { authService } from '../../services/auth.service';
import { DORAMetricsRepository } from '../../repositories/dora-metrics.repository';
import { DeploymentsRepository } from '../../repositories/deployments.repository';
import { DORAMetricsService } from '../../services/dora-metrics.service';
import { pool as appPool } from '../../config/database';

jest.mock('../../services/onboardingEvents', () => ({ emitOnboardingEvent: jest.fn() }));

function dbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };
}

const WEBHOOK_SECRET = 'deployments-record-test-secret';
// The webhook reads its organization once, at module load.
const WEBHOOK_ORG_ID = randomUUID();
const JWT_EMAIL = 'jwt-claim-not-trusted@example.com';

const pool = new Pool(dbConfig());
const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

type Role = 'owner' | 'admin' | 'member' | 'viewer';
interface Org {
  orgId: string;
  serviceId: string;
  serviceName: string;
  users: Record<Role, { id: string; email: string }>;
}

async function buildOrg(id?: string): Promise<Org> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (id, name, slug, display_name, subscription_tier, subscription_status)
     VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $2, 'enterprise', 'active') RETURNING id`,
    [id ?? null, `Deploy Record ${suffix}`, `deploy-record-${suffix}`]
  );
  const orgId = rows[0].id as string;
  createdOrgIds.push(orgId);

  const users = {} as Org['users'];
  for (const role of ['owner', 'admin', 'member', 'viewer'] as Role[]) {
    const email = `deploy-record-${role}-${uniqueSuffix()}@example.com`;
    const u = await pool.query(
      `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Deploy Record User') RETURNING id`,
      [email]
    );
    createdUserIds.push(u.rows[0].id);
    await pool.query(
      `INSERT INTO organization_memberships (organization_id, user_id, role, joined_at, is_active)
       VALUES ($1, $2, $3, NOW(), true)`,
      [orgId, u.rows[0].id, role]
    );
    users[role] = { id: u.rows[0].id, email };
  }

  const serviceName = `deploy-record-svc-${uniqueSuffix()}`;
  const serviceId = await insertService(orgId, serviceName);
  return { orgId, serviceId, serviceName, users };
}

async function insertService(orgId: string, name: string): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO services (name, template, owner, status, organization_id)
     VALUES ($1, 'api', 'owner@example.com', 'active', $2) RETURNING id`,
    [name, orgId]
  );
  return rows[0].id as string;
}

async function deploymentRows(orgId: string) {
  const { rows } = await pool.query(
    'SELECT * FROM deployments WHERE organization_id = $1 ORDER BY created_at, id',
    [orgId]
  );
  return rows;
}

async function servicesIn(orgId: string): Promise<string[]> {
  const { rows } = await pool.query('SELECT name FROM services WHERE organization_id = $1 ORDER BY name', [orgId]);
  return rows.map((r) => r.name);
}

async function servicesNamed(name: string): Promise<number> {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM services WHERE LOWER(name) = LOWER($1)', [name]);
  return rows[0].n;
}

let server: http.Server;
let baseUrl: string;
const emitToOrganization = jest.fn();
let orgA: Org;
let orgB: Org;

beforeAll(async () => {
  process.env.GITHUB_WEBHOOK_ORG_ID = WEBHOOK_ORG_ID;
  process.env.GITHUB_WEBHOOK_SECRET = WEBHOOK_SECRET;
  // Imported after the env is set: the router reads its organization when it loads.
  const githubWebhookRoutes = (await import('../github-webhook.routes')).default;

  orgA = await buildOrg();
  orgB = await buildOrg();

  const app = express();
  app.set('wsServer', { emitToOrganization });
  app.use('/api/webhooks/github', express.raw({ type: 'application/json' }));
  app.use('/api/webhooks/github', githubWebhookRoutes);
  app.use(express.json());
  app.use('/api/deployments', deploymentsRoutes);
  app.use(errorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}/api`;
});

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  emitToOrganization.mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.query('DELETE FROM deployments WHERE organization_id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM services WHERE organization_id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM audit_logs WHERE organization_id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM analytics_events WHERE organization_id = ANY($1)', [createdOrgIds]);
  await pool.query(
    'DELETE FROM organization_memberships WHERE organization_id = ANY($1) OR user_id = ANY($2)',
    [createdOrgIds, createdUserIds]
  );
  await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds]);
  await pool.end();
  await appPool.end();
});

/** A request as `role` in `org`. The JWT role claim is 'owner' and the email claim is a decoy: both must be ignored. */
async function send(org: Org, role: Role, method: string, path: string, body?: unknown) {
  jest.spyOn(authService, 'verifyToken').mockReturnValue({
    userId: org.users[role].id,
    email: JWT_EMAIL,
    organizationId: org.orgId,
    role: 'owner',
    type: 'access',
  } as unknown as ReturnType<typeof authService.verifyToken>);
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

const record = (org: Org, body: Record<string, unknown>, role: Role = 'member') =>
  send(org, role, 'POST', '/deployments', { environment: 'production', ...body });

function webhookDelivery(repoName: string, conclusion: 'success' | 'failure') {
  const body = JSON.stringify({
    action: 'completed',
    workflow_job: {
      id: Math.floor(Math.random() * 1e12),
      run_id: Math.floor(Math.random() * 1e12),
      name: 'deploy-backend',
      conclusion,
      completed_at: new Date().toISOString(),
      head_sha: 'abc123',
      html_url: 'https://example.com/run',
    },
    repository: { name: repoName },
    sender: { login: 'deploy-record-bot' },
  });
  const signature = 'sha256=' + crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
  return fetch(`${baseUrl}/webhooks/github`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-GitHub-Event': 'workflow_job', 'X-Hub-Signature-256': signature },
    body,
  });
}

const HOUR = 3_600_000;

// ─── status ──────────────────────────────────────────────────────────────────

describe('status', () => {
  it("omitted: the row is 'deploying', as before D2, and is announced as started", async () => {
    const org = await buildOrg();
    const res = await record(org, { service_id: org.serviceId });
    expect(res.status).toBe(201);

    const rows = await deploymentRows(org.orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('deploying');
    expect(emitToOrganization.mock.calls.map((c) => c[1])).toEqual(['deployment:started']);
  });

  it.each(['success', 'failed'] as const)('%s: a finished row with that status, announced as completed (never started)', async (status) => {
    const org = await buildOrg();
    const res = await record(org, { service_id: org.serviceId, status });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe(status);

    const rows = await deploymentRows(org.orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status, service_id: org.serviceId, environment: 'production' });

    expect(emitToOrganization).toHaveBeenCalledTimes(1);
    const [orgId, event, payload] = emitToOrganization.mock.calls[0];
    expect(orgId).toBe(org.orgId);
    expect(event).toBe('deployment:completed');
    expect(payload).toMatchObject({ deploymentId: rows[0].id, serviceName: org.serviceName, status });
  });

  it.each(['deploying', 'running', 'stopped', 'SUCCESS', 'failure', '', 1, null])(
    'any other value (%p) is 400 with the status message and writes nothing',
    async (status) => {
      const org = await buildOrg();
      const res = await record(org, { service_id: org.serviceId, status });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ success: false, error: "Invalid status: use 'success' or 'failed'." });
      expect(await deploymentRows(org.orgId)).toEqual([]);
      expect(emitToOrganization).not.toHaveBeenCalled();
    }
  );
});

// ─── who may record ──────────────────────────────────────────────────────────

describe('permissions are unchanged', () => {
  it.each(['owner', 'admin', 'member'] as const)('%s may record', async (role) => {
    const org = await buildOrg();
    const res = await record(org, { service_id: org.serviceId, status: 'success' }, role);
    expect(res.status).toBe(201);
    expect(await deploymentRows(org.orgId)).toHaveLength(1);
  });

  it('a viewer gets 403 (even with an owner role claim) and nothing is written', async () => {
    const org = await buildOrg();
    const res = await record(org, { service_id: org.serviceId, status: 'success' }, 'viewer');
    expect(res.status).toBe(403);
    expect(await deploymentRows(org.orgId)).toEqual([]);
    expect(await servicesIn(org.orgId)).toEqual([org.serviceName]);
  });
});

// ─── the service must already exist ──────────────────────────────────────────

describe('the service must exist in the caller\'s organization', () => {
  it('by id, and by name case-insensitively: recorded against that service, no second service', async () => {
    const org = await buildOrg();
    expect((await record(org, { service_id: org.serviceId, status: 'success' })).status).toBe(201);
    expect((await record(org, { serviceName: org.serviceName.toUpperCase(), status: 'failed' })).status).toBe(201);
    expect((await record(org, { service_name: org.serviceName, status: 'success' })).status).toBe(201);

    expect((await deploymentRows(org.orgId)).map((r) => r.service_id)).toEqual([org.serviceId, org.serviceId, org.serviceId]);
    expect(await servicesNamed(org.serviceName)).toBe(1);
  });

  const unknown: [string, () => Record<string, unknown>][] = [
    ['an unknown name', () => ({ serviceName: `deploy-record-typo-${uniqueSuffix()}` })],
    ['an unknown name (service_name)', () => ({ service_name: `deploy-record-typo-${uniqueSuffix()}` })],
    ['an unknown service_id', () => ({ service_id: randomUUID() })],
    ["another organization's service_id", () => ({ service_id: orgB.serviceId })],
    ["another organization's service name", () => ({ serviceName: orgB.serviceName })],
  ];

  it.each(unknown)('%s: 400 "Choose an existing service.", no service created, no row, no event', async (_label, body) => {
    const org = await buildOrg();
    const payload = body();
    const orgBServicesBefore = await servicesIn(orgB.orgId);
    const orgBRowsBefore = (await deploymentRows(orgB.orgId)).length;

    for (const status of [undefined, 'success', 'failed']) {
      const res = await record(org, { ...payload, ...(status ? { status } : {}) });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ success: false, error: 'Choose an existing service.' });
    }

    expect(await servicesIn(org.orgId)).toEqual([org.serviceName]);
    expect(await deploymentRows(org.orgId)).toEqual([]);
    const name = (payload.serviceName ?? payload.service_name) as string | undefined;
    if (name && name !== orgB.serviceName) expect(await servicesNamed(name)).toBe(0);
    expect(await servicesIn(orgB.orgId)).toEqual(orgBServicesBefore);
    expect(await deploymentRows(orgB.orgId)).toHaveLength(orgBRowsBefore);
    expect(emitToOrganization).not.toHaveBeenCalled();
  });

  it('no service at all: 400 "Choose a service." and nothing written', async () => {
    const org = await buildOrg();
    const res = await record(org, { status: 'success' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'Choose a service.' });
    expect(await deploymentRows(org.orgId)).toEqual([]);
  });
});

// ─── who and when: decided by the server ─────────────────────────────────────

describe('provenance is set by the server', () => {
  it('deployed_by is the signed-in user\'s email from the membership: a body deployed_by and the JWT email claim are ignored', async () => {
    const org = await buildOrg();
    const res = await record(org, { service_id: org.serviceId, status: 'success', deployed_by: 'someone-else@example.com' }, 'admin');
    expect(res.status).toBe(201);
    const [row] = await deploymentRows(org.orgId);
    expect(row.deployed_by).toBe(org.users.admin.email);
    expect(row.deployed_by).not.toBe(JWT_EMAIL);
  });

  it('with status omitted, deployed_by is still the signed-in user (never "platform-portal")', async () => {
    const org = await buildOrg();
    await record(org, { service_id: org.serviceId, deployed_by: 'platform-portal' });
    const [row] = await deploymentRows(org.orgId);
    expect(row.deployed_by).toBe(org.users.member.email);
  });

  it('deployed_at is the server\'s now: a past or future deployed_at in the body is ignored (not rejected)', async () => {
    const org = await buildOrg();
    for (const deployed_at of ['2001-01-01T00:00:00.000Z', new Date(Date.now() + 30 * 24 * HOUR).toISOString()]) {
      const res = await record(org, { service_id: org.serviceId, status: 'success', deployed_at, deployedAt: deployed_at, created_at: deployed_at });
      expect(res.status).toBe(201);
    }
    for (const row of await deploymentRows(org.orgId)) {
      expect(Math.abs(Date.now() - new Date(row.deployed_at).getTime())).toBeLessThan(HOUR);
      expect(Math.abs(Date.now() - new Date(row.created_at).getTime())).toBeLessThan(HOUR);
    }
  });

  it("metadata is { source: 'manual' }: a body metadata (even one posing as the webhook) is ignored", async () => {
    const org = await buildOrg();
    const res = await record(org, {
      service_id: org.serviceId,
      status: 'failed',
      metadata: { source: 'github_actions', github_job_id: 42 },
      organization_id: orgB.orgId,
    });
    expect(res.status).toBe(201);
    const [row] = await deploymentRows(org.orgId);
    expect(row.metadata).toEqual({ source: 'manual' });
    expect(row.organization_id).toBe(org.orgId);
  });

  it('a 500 never returns internal error text', async () => {
    const org = await buildOrg();
    // A NUL byte passes the body schema but Postgres refuses it in the
    // service lookup ("invalid byte sequence for encoding UTF8: 0x00"): a
    // real database error reaching the handler's catch.
    const res = await record(org, { serviceName: 'bad\u0000name', status: 'success' });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'The deployment could not be recorded.' });
    expect(await deploymentRows(org.orgId)).toEqual([]);
  });

  it("a 500 from the controller's insert says the same, with no internal text", async () => {
    const org = await buildOrg();
    // The lookup succeeds (by id); the NUL byte in version only reaches
    // Postgres in the INSERT's jsonb resources, which refuses \u0000: the
    // controller's own catch, not the route's.
    const res = await record(org, { service_id: org.serviceId, status: 'success', version: 'a\u0000b' });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'The deployment could not be recorded.' });
    expect(JSON.stringify(res.body)).not.toMatch(/unicode|jsonb|0x00|\\u0000|failed to create|syntax|postgres/i);
    expect(console.error).toHaveBeenCalledWith('Error creating deployment:', expect.anything());
    expect(await deploymentRows(org.orgId)).toEqual([]);
    expect(emitToOrganization).not.toHaveBeenCalled();
  });
});

// ─── two organization checks, each pinned ────────────────────────────────────

describe("the route's own lookup is scoped to the caller's organization", () => {
  // The INSERT re-checks the service's organization too, so a foreign service
  // gets the same 400 with either check alone. This pins the route's check:
  // another organization's service is refused before any insert is tried.
  it.each([
    ['service_id', () => ({ service_id: orgB.serviceId })],
    ['serviceName', () => ({ serviceName: orgB.serviceName })],
  ] as const)("another organization's service by %s never reaches the insert", async (_label, body) => {
    const insert = jest.spyOn(DeploymentsRepository.prototype, 'create');
    const org = await buildOrg();

    const res = await record(org, { ...body(), status: 'success' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'Choose an existing service.' });
    expect(insert).not.toHaveBeenCalled();

    // The spy is live: an own service does reach the insert.
    expect((await record(org, { service_id: org.serviceId, status: 'success' })).status).toBe(201);
    expect(insert).toHaveBeenCalledTimes(1);
  });
});

// ─── webhook unchanged, and finished-record equivalence ──────────────────────

describe('the webhook path is unchanged, and manual rows are counted as webhook rows are', () => {
  let manual: Org;
  let webhook: Org;

  beforeAll(async () => {
    manual = await buildOrg();
    webhook = await buildOrg(WEBHOOK_ORG_ID);

    for (const status of ['success', 'success', 'failed'] as const) {
      expect((await record(manual, { service_id: manual.serviceId, status })).status).toBe(201);
    }
    for (const conclusion of ['success', 'success', 'failure'] as const) {
      expect((await webhookDelivery(webhook.serviceName, conclusion)).status).toBe(201);
    }
  });

  it("webhook rows keep source 'github_actions', the sender login and their job metadata", async () => {
    const rows = await deploymentRows(webhook.orgId);
    expect(rows.map((r) => r.status).sort()).toEqual(['failed', 'success', 'success']);
    for (const row of rows) {
      expect(row.deployed_by).toBe('deploy-record-bot');
      expect(row.metadata).toMatchObject({ source: 'github_actions', workflow_name: 'deploy-backend' });
      expect(typeof row.metadata.github_job_id).toBe('number');
      expect(row.service_id).toBe(webhook.serviceId);
    }
    expect(await servicesIn(webhook.orgId)).toEqual([webhook.serviceName]);
  });

  it('manual rows differ from webhook rows only in provenance (deployed_by, metadata.source)', async () => {
    const shape = (r: any) => ({ status: r.status, environment: r.environment, aws_region: r.aws_region, cost_estimate: r.cost_estimate });
    const m = (await deploymentRows(manual.orgId)).map(shape).sort((a, b) => a.status.localeCompare(b.status));
    const w = (await deploymentRows(webhook.orgId)).map(shape).sort((a, b) => a.status.localeCompare(b.status));
    expect(m).toEqual(w);
  });

  it('Deployment History: the log and /stats count them the same', async () => {
    for (const org of [manual, webhook]) {
      const list = await send(org, 'viewer', 'GET', '/deployments?date_range=30d');
      expect(list.status).toBe(200);
      expect(list.body.total).toBe(3);
      expect(list.body.data.map((d: any) => d.status).sort()).toEqual(['failed', 'success', 'success']);

      for (const query of ['', '?environment=production', '?date_range=7d']) {
        const stats = (await send(org, 'viewer', 'GET', `/deployments/stats${query}`)).body.stats;
        expect(stats).toMatchObject({ total: 3, success: 2, failed: 1, in_progress: 0, no_completion_recorded: 0, unknown: 0 });
        expect(['success', 'failed']).toContain(stats.last_deployment.status);
      }
    }
  });

  // Through DORAMetricsService.getComprehensiveMetrics only (the DORA API's own
  // entry point, which reads the repository): D4 replaces the repository's
  // per-metric queries, and this must hold before and after it.
  it('DORA (service over the repository) counts them the same, for all environments and for production', async () => {
    const service = new DORAMetricsService(new DORAMetricsRepository(appPool), appPool);
    const results = [];
    for (const org of [manual, webhook]) {
      const all = await service.getComprehensiveMetrics({ organizationId: org.orgId, dateRange: '30d' });
      const production = await service.getComprehensiveMetrics({ organizationId: org.orgId, dateRange: '30d', environment: 'production' });
      results.push({
        deployments: all.deployments,
        frequency: all.deploymentFrequency.tracked ? all.deploymentFrequency.value : 'untracked',
        rate: all.changeFailureRate.tracked ? all.changeFailureRate.value : 'untracked',
        production: production.deployments,
      });
    }
    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toMatchObject({
      deployments: { successful: 2, failed: 1, finished: 3 },
      production: { successful: 2, failed: 1, finished: 3 },
    });
  });
});
