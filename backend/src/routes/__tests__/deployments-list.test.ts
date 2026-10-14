/**
 * GET /api/deployments (the paginated deployment log) and the body
 * POST /api/deployments accepts.
 *
 * Policy under test:
 *   - One organization's deployments, newest first, in a stable order
 *     (deployed_at DESC NULLS LAST, then id), one page at a time. Page size is
 *     25 (default), 50 or 100; anything else is refused, never coerced.
 *   - The environment filter and the 7/30/90-day window are applied by the
 *     server, and the total is counted with the same filters -- so it equals
 *     what GET /api/deployments/stats counts for them.
 *   - Another organization's deployments never appear, in a page or a total.
 *   - A created deployment's organization comes from the authenticated
 *     request only. organization_id, status, deployed_at and metadata in the
 *     body are dropped; an absent cost is stored as NULL, never 0.00.
 *
 * Real routes over an in-process HTTP server against live Postgres. The test
 * role is not subject to RLS, so the isolation assertions pass only because
 * of the organization predicate in the statements themselves. Only
 * authService.verifyToken (to choose the caller) is stubbed.
 */
import express from 'express';
import http from 'http';
import { Pool } from 'pg';
import deploymentsRoutes from '../deployments.routes';
import { DeploymentsController } from '../../controllers/deployments.controller';
import { errorHandler } from '../../middleware/error-handler';
import { authService } from '../../services/auth.service';
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

const pool = new Pool(dbConfig());
const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function buildOrg(role = 'member'): Promise<{ orgId: string; userId: string; serviceId: string; role: string }> {
  const suffix = uniqueSuffix();
  const org = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $1, 'enterprise', 'active') RETURNING id`,
    [`Deploy List ${suffix}`, `deploy-list-${suffix}`]
  );
  const orgId = org.rows[0].id as string;
  createdOrgIds.push(orgId);

  const user = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Deploy List User') RETURNING id`,
    [`deploy-list-${suffix}@example.com`]
  );
  const userId = user.rows[0].id as string;
  createdUserIds.push(userId);
  await pool.query(
    `INSERT INTO organization_memberships (organization_id, user_id, role, joined_at, is_active)
     VALUES ($1, $2, $3, NOW(), true)`,
    [orgId, userId, role]
  );

  const service = await pool.query(
    `INSERT INTO services (name, template, owner, status, organization_id)
     VALUES ($1, 'api', 'owner@example.com', 'active', $2) RETURNING id`,
    [`deploy-list-svc-${suffix}`, orgId]
  );
  return { orgId, userId, serviceId: service.rows[0].id as string, role };
}

type Org = Awaited<ReturnType<typeof buildOrg>>;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(Date.now() - ms);

async function insertDeployment(
  org: Org,
  opts: { status?: string; deployedAt?: Date | null; environment?: string; cost?: number | null } = {}
): Promise<string> {
  const deployedAt = opts.deployedAt === undefined ? ago(HOUR) : opts.deployedAt;
  const { rows } = await pool.query(
    `INSERT INTO deployments
       (service_id, environment, aws_region, status, cost_estimate, deployed_by, deployed_at, organization_id)
     VALUES ($1, $2, 'us-east-1', $3, $4, 'github-actions', $5, $6) RETURNING id`,
    [org.serviceId, opts.environment ?? 'production', opts.status ?? 'success', opts.cost ?? null, deployedAt, org.orgId]
  );
  return rows[0].id as string;
}

/** `count` deployments one minute apart, the newest `startMinutesAgo` minutes ago. */
async function insertSeries(org: Org, count: number, environment = 'production', startMinutesAgo = 10): Promise<void> {
  await pool.query(
    `INSERT INTO deployments (service_id, environment, aws_region, status, deployed_by, deployed_at, organization_id)
     SELECT $1, $2, 'us-east-1', 'success', 'github-actions', NOW() - make_interval(mins => $4 + n), $3
       FROM generate_series(0, $5 - 1) AS n`,
    [org.serviceId, environment, org.orgId, startMinutesAgo, count]
  );
}

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/deployments', deploymentsRoutes);
  app.use(errorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}/api`;
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
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

function actAs(org: Org): void {
  jest.spyOn(authService, 'verifyToken').mockReturnValue({
    userId: org.userId,
    email: 'deploy-list-caller@example.com',
    organizationId: org.orgId,
    role: org.role,
    type: 'access',
  } as unknown as ReturnType<typeof authService.verifyToken>);
}

async function list(org: Org, query = ''): Promise<{ status: number; body: any }> {
  actAs(org);
  const res = await fetch(`${baseUrl}/deployments${query}`, { headers: { Authorization: 'Bearer test-token' } });
  return { status: res.status, body: await res.json() };
}

async function stats(org: Org, query = ''): Promise<any> {
  actAs(org);
  const res = await fetch(`${baseUrl}/deployments/stats${query}`, { headers: { Authorization: 'Bearer test-token' } });
  return ((await res.json()) as any).stats;
}

async function create(org: Org, body: Record<string, unknown>): Promise<{ status: number; body: any }> {
  actAs(org);
  const res = await fetch(`${baseUrl}/deployments`, {
    method: 'POST',
    headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

const ids = (body: any): string[] => body.data.map((d: any) => d.id);

describe('GET /api/deployments — pages', () => {
  it('defaults to the 25 newest, and reports the page and the total', async () => {
    const org = await buildOrg();
    await insertSeries(org, 30);

    const { status, body } = await list(org);
    expect(status).toBe(200);
    expect(body.data).toHaveLength(25);
    expect(body.total).toBe(30);
    expect(body.pagination).toEqual({ limit: 25, offset: 0, total: 30 });
    const times = body.data.map((d: any) => Date.parse(d.deployed_at));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('the last page holds the remainder, and the pages neither overlap nor skip a row', async () => {
    const org = await buildOrg();
    await insertSeries(org, 30);

    const first = await list(org, '?limit=25&offset=0');
    const last = await list(org, '?limit=25&offset=25');
    expect(last.body.data).toHaveLength(5);
    expect(last.body.pagination).toEqual({ limit: 25, offset: 25, total: 30 });

    const all = [...ids(first.body), ...ids(last.body)];
    expect(new Set(all).size).toBe(30);
    expect(all).toEqual(ids((await list(org, '?limit=50')).body));
  });

  it('a page past the end is empty, with the real total -- not an error', async () => {
    const org = await buildOrg();
    await insertSeries(org, 3);

    const { status, body } = await list(org, '?offset=50');
    expect(status).toBe(200);
    expect(body.data).toEqual([]);
    expect(body.total).toBe(3);
  });

  it('accepts 50 and 100 as page sizes', async () => {
    const org = await buildOrg();
    await insertSeries(org, 120);

    expect((await list(org, '?limit=50')).body.data).toHaveLength(50);
    const hundred = await list(org, '?limit=100&offset=100');
    expect(hundred.body.data).toHaveLength(20);
    expect(hundred.body.total).toBe(120);
  });

  it('rows with the same deployed_at keep one order across pages (id breaks the tie)', async () => {
    const org = await buildOrg();
    const at = ago(2 * HOUR);
    await pool.query(
      `INSERT INTO deployments (service_id, environment, aws_region, status, deployed_by, deployed_at, organization_id)
       SELECT $1, 'production', 'us-east-1', 'success', 'github-actions', $3, $2 FROM generate_series(1, 60)`,
      [org.serviceId, org.orgId, at]
    );

    const pages = [
      await list(org, '?limit=25&offset=0'),
      await list(org, '?limit=25&offset=25'),
      await list(org, '?limit=25&offset=50'),
    ];
    const seen = pages.flatMap(p => ids(p.body));
    expect(seen).toHaveLength(60);
    expect(new Set(seen).size).toBe(60);
    expect(seen).toEqual([...seen].sort().reverse());
  });

  it('a deployment with no deployed_at sorts last, never first', async () => {
    const org = await buildOrg();
    const undated = await insertDeployment(org, { deployedAt: null });
    const old = await insertDeployment(org, { deployedAt: ago(300 * DAY) });
    const recent = await insertDeployment(org, { deployedAt: ago(HOUR) });

    expect(ids((await list(org)).body)).toEqual([recent, old, undated]);
    // It is in no window: there is no date to place it by.
    const windowed = await list(org, '?date_range=90d');
    expect(ids(windowed.body)).toEqual([recent]);
    expect(windowed.body.total).toBe(1);
  });
});

describe('GET /api/deployments — filters, window and total', () => {
  it('applies the environment filter and the window together, and counts the total with both', async () => {
    const org = await buildOrg();
    await insertSeries(org, 30, 'staging');                       // recent staging
    await insertSeries(org, 4, 'production');                     // recent production
    for (let i = 0; i < 3; i++) await insertDeployment(org, { environment: 'staging', deployedAt: ago(20 * DAY) });
    for (let i = 0; i < 2; i++) await insertDeployment(org, { environment: 'staging', deployedAt: ago(60 * DAY) });
    await insertDeployment(org, { environment: 'staging', deployedAt: ago(200 * DAY) });

    const seven = await list(org, '?environment=staging&date_range=7d');
    expect(seven.body.total).toBe(30);
    expect(seven.body.data).toHaveLength(25);
    expect(seven.body.data.every((d: any) => d.environment === 'staging')).toBe(true);

    const second = await list(org, '?environment=staging&date_range=7d&offset=25');
    expect(second.body.data).toHaveLength(5);

    expect((await list(org, '?environment=staging&date_range=30d')).body.total).toBe(33);
    expect((await list(org, '?environment=staging&date_range=90d')).body.total).toBe(35);
    expect((await list(org, '?environment=staging')).body.total).toBe(36);
    expect((await list(org, '?date_range=7d')).body.total).toBe(34);
    expect((await list(org, '?environment=all&date_range=7d')).body.total).toBe(34);
    expect((await list(org)).body.total).toBe(40);
  });

  it('the total equals what the stats endpoint counts for the same filters', async () => {
    const org = await buildOrg();
    await insertDeployment(org, { status: 'success', environment: 'production', deployedAt: ago(2 * DAY) });
    await insertDeployment(org, { status: 'failed', environment: 'production', deployedAt: ago(10 * DAY) });
    await insertDeployment(org, { status: 'deploying', environment: 'staging', deployedAt: ago(3 * DAY) });
    await insertDeployment(org, { status: 'running', environment: 'staging', deployedAt: ago(50 * DAY) });
    await insertDeployment(org, { status: 'success', environment: 'development', deployedAt: ago(120 * DAY) });

    for (const query of [
      '?date_range=7d', '?date_range=30d', '?date_range=90d',
      '?environment=production&date_range=7d', '?environment=staging&date_range=30d',
      '?environment=staging&date_range=90d', '?environment=development&date_range=90d',
    ]) {
      const listed = await list(org, query);
      expect({ query, total: listed.body.total }).toEqual({ query, total: (await stats(org, query)).total });
      expect(listed.body.data).toHaveLength(listed.body.total);
    }
  });

  it('a filter that matches nothing gives an empty page and a zero total', async () => {
    const org = await buildOrg();
    await insertDeployment(org, { environment: 'production' });

    const { status, body } = await list(org, '?environment=staging&date_range=7d');
    expect(status).toBe(200);
    expect(body.data).toEqual([]);
    expect(body.pagination).toEqual({ limit: 25, offset: 0, total: 0 });
  });
});

describe('GET /api/deployments — organization scope', () => {
  it("never returns or counts another organization's deployments, on any page or filter", async () => {
    const orgA = await buildOrg();
    const orgB = await buildOrg();
    await insertSeries(orgA, 3, 'production');
    await insertSeries(orgB, 40, 'production', 1); // more, and more recent
    await insertSeries(orgB, 5, 'staging', 1);

    for (const query of ['', '?limit=100', '?offset=2', '?environment=production&date_range=7d', '?date_range=90d']) {
      const { body } = await list(orgA, query);
      expect(body.total).toBe(3);
      expect(body.data.every((d: any) => d.organization_id === orgA.orgId)).toBe(true);
    }
    expect((await list(orgA, '?environment=staging')).body).toMatchObject({ data: [], total: 0 });
    expect((await list(orgA, `?service_id=${orgB.serviceId}`)).body).toMatchObject({ data: [], total: 0 });

    const empty = await buildOrg();
    expect((await list(empty)).body).toMatchObject({ data: [], total: 0 });
  });

  it('refuses a request with no organization without running any query', async () => {
    const querySpy = jest.spyOn(Pool.prototype, 'query');
    const connectSpy = jest.spyOn(Pool.prototype, 'connect');
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();
    const controller = new DeploymentsController();

    await controller.getAll({ query: {} } as any, { status, json } as any);
    await controller.getAll({ query: {}, organizationId: '', user: {} } as any, { status, json } as any);

    expect(status).toHaveBeenNthCalledWith(1, 401);
    expect(status).toHaveBeenNthCalledWith(2, 401);
    expect(json).toHaveBeenCalledWith({ success: false, error: 'Unauthorized - organization context required' });
    expect(querySpy).not.toHaveBeenCalled();
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it('refuses an unauthenticated request', async () => {
    const res = await fetch(`${baseUrl}/deployments`);
    expect(res.status).toBe(401);
  });
});

describe('GET /api/deployments — invalid parameters', () => {
  it.each([
    ['limit=abc', 'Invalid limit. Must be one of: 25, 50, 100'],
    ['limit=10', 'Invalid limit. Must be one of: 25, 50, 100'],
    ['limit=101', 'Invalid limit. Must be one of: 25, 50, 100'],
    ['limit=100000', 'Invalid limit. Must be one of: 25, 50, 100'],
    ['limit=-25', 'Invalid limit. Must be one of: 25, 50, 100'],
    ['limit=25.0', 'Invalid limit. Must be one of: 25, 50, 100'],
    ['limit=', 'Invalid limit. Must be one of: 25, 50, 100'],
    ['limit=25&limit=50', 'Invalid limit'],
    ['offset=-1', 'Invalid offset. Must be a non-negative integer'],
    ['offset=abc', 'Invalid offset. Must be a non-negative integer'],
    ['offset=1.5', 'Invalid offset. Must be a non-negative integer'],
    ['offset=99999999999999999999', 'Invalid offset. Must be a non-negative integer'],
    ['environment=prod', 'Invalid environment. Must be one of: development, staging, production'],
    ['date_range=365d', 'Invalid date_range. Must be one of: 7d, 30d, 90d'],
    ['date_range=', 'Invalid date_range. Must be one of: 7d, 30d, 90d'],
    ['service_id=not-a-uuid', 'Invalid service_id. Must be a UUID'],
  ])('rejects ?%s with 400', async (query, error) => {
    const org = await buildOrg();
    await insertSeries(org, 2);

    const { status, body } = await list(org, `?${query}`);
    expect(status).toBe(400);
    expect(body).toEqual({ success: false, error });
  });
});

describe('POST /api/deployments — the body cannot choose the organization', () => {
  it("ignores a body organization_id: the deployment is created in the caller's organization, never the named one", async () => {
    const caller = await buildOrg();
    const victim = await buildOrg();

    const res = await create(caller, {
      service_id: caller.serviceId,
      environment: 'production',
      organization_id: victim.orgId,
      organizationId: victim.orgId,
    });

    expect(res.status).toBe(201);
    expect(res.body.data.organization_id).toBe(caller.orgId);
    const { rows } = await pool.query(
      'SELECT organization_id FROM deployments WHERE organization_id = ANY($1)',
      [[caller.orgId, victim.orgId]]
    );
    expect(rows).toEqual([{ organization_id: caller.orgId }]);
  });

  it("cannot attach a deployment to another organization's service, with or without a body organization_id", async () => {
    const caller = await buildOrg();
    const victim = await buildOrg();

    for (const extra of [{}, { organization_id: victim.orgId }]) {
      const res = await create(caller, { service_id: victim.serviceId, environment: 'production', ...extra });
      expect(res.status).toBe(404);
    }
    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM deployments WHERE service_id = $1 OR organization_id = $2',
      [victim.serviceId, victim.orgId]
    );
    expect(rows[0].n).toBe(0);
  });

  it('drops status, deployed_at, metadata and unknown fields; an absent cost is stored as NULL', async () => {
    const org = await buildOrg();

    const res = await create(org, {
      service_id: org.serviceId,
      environment: 'staging',
      region: 'eu-west-1',
      version: '1.2.3',
      status: 'success',
      deployed_at: '2001-01-01T00:00:00.000Z',
      metadata: { source: 'github_actions', github_job_id: 1 },
      id: '11111111-1111-4111-8111-111111111111',
      created_at: '2001-01-01T00:00:00.000Z',
    });

    expect(res.status).toBe(201);
    const { rows } = await pool.query('SELECT * FROM deployments WHERE organization_id = $1', [org.orgId]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'deploying',
      environment: 'staging',
      aws_region: 'eu-west-1',
      deployed_by: 'platform-portal',
      cost_estimate: null,
      metadata: {},
      resources: { version: '1.2.3' },
    });
    expect(rows[0].id).not.toBe('11111111-1111-4111-8111-111111111111');
    expect(Date.now() - new Date(rows[0].deployed_at).getTime()).toBeLessThan(HOUR);
    expect(Date.now() - new Date(rows[0].created_at).getTime()).toBeLessThan(HOUR);
  });

  it('stores a cost only when one is given; zero is not a recorded cost', async () => {
    const org = await buildOrg();

    expect((await create(org, { service_id: org.serviceId, environment: 'production', cost_estimate: 12.5 })).status).toBe(201);
    expect((await create(org, { service_id: org.serviceId, environment: 'staging', cost_estimate: 0 })).status).toBe(201);

    const { rows } = await pool.query(
      'SELECT environment, cost_estimate FROM deployments WHERE organization_id = $1 ORDER BY environment',
      [org.orgId]
    );
    expect(rows).toEqual([
      { environment: 'production', cost_estimate: '12.50' },
      { environment: 'staging', cost_estimate: null },
    ]);
  });

  it.each([
    ['an unknown environment', { environment: 'prod' }],
    ['no environment', {}],
    ['a service_id that is not a UUID', { environment: 'production', service_id: 'abc' }],
    ['a negative cost', { environment: 'production', cost_estimate: -1 }],
    ['a cost that is not a number', { environment: 'production', cost_estimate: '12' }],
    ['a malformed region', { environment: 'production', region: 'virginia' }],
  ])('rejects %s with 400 and creates nothing', async (_name, body) => {
    const org = await buildOrg();

    const res = await create(org, { service_id: org.serviceId, ...body });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM deployments WHERE organization_id = $1', [org.orgId]);
    expect(rows[0].n).toBe(0);
  });
});
