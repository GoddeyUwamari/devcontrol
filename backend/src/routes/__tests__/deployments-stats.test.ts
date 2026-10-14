/**
 * GET /api/deployments/stats.
 *
 * Policy under test:
 *   - The counts are one organization's, for one window. A request with no
 *     organization is refused before any query runs, and another
 *     organization's deployments never appear.
 *   - Statuses are counted as recorded: 'success' and 'failed' as themselves,
 *     'deploying' as in progress only while recent and otherwise as having no
 *     completion on record, anything else as unknown.
 *   - Change failure rate is failed / (success + failed). Rows that never
 *     finished, or whose status is unrecognised, are in neither side; with
 *     nothing finished the rate is null, not 0.
 *
 * Real route over an in-process HTTP server against live Postgres. The test
 * role is not subject to RLS, so the isolation assertions pass only because
 * of the organization predicate in the statements themselves. Only
 * authService.verifyToken (to choose the caller) is stubbed.
 */
import express from 'express';
import http from 'http';
import { Pool } from 'pg';
import deploymentsRoutes, { deploymentStatsHandler } from '../deployments.routes';
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

async function buildOrg(): Promise<{ orgId: string; userId: string; serviceId: string }> {
  const suffix = uniqueSuffix();
  const org = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $1, 'enterprise', 'active') RETURNING id`,
    [`Deploy Stats ${suffix}`, `deploy-stats-${suffix}`]
  );
  const orgId = org.rows[0].id as string;
  createdOrgIds.push(orgId);

  const user = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Deploy Stats User') RETURNING id`,
    [`deploy-stats-${suffix}@example.com`]
  );
  const userId = user.rows[0].id as string;
  createdUserIds.push(userId);
  await pool.query(
    `INSERT INTO organization_memberships (organization_id, user_id, role, joined_at, is_active)
     VALUES ($1, $2, 'viewer', NOW(), true)`,
    [orgId, userId]
  );

  const service = await pool.query(
    `INSERT INTO services (name, template, owner, status, organization_id)
     VALUES ($1, 'api', 'owner@example.com', 'active', $2) RETURNING id`,
    [`deploy-stats-svc-${suffix}`, orgId]
  );
  return { orgId, userId, serviceId: service.rows[0].id as string };
}

type Org = Awaited<ReturnType<typeof buildOrg>>;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(Date.now() - ms);

async function insertDeployment(
  org: Org,
  status: string,
  opts: { deployedAt?: Date; createdAt?: Date; environment?: string; cost?: number } = {}
): Promise<void> {
  const deployedAt = opts.deployedAt ?? ago(HOUR);
  await pool.query(
    `INSERT INTO deployments
       (service_id, environment, aws_region, status, cost_estimate, deployed_by, deployed_at, created_at, organization_id)
     VALUES ($1, $2, 'us-east-1', $3, $4, 'github-actions', $5, $6, $7)`,
    [org.serviceId, opts.environment ?? 'production', status, opts.cost ?? 0, deployedAt, opts.createdAt ?? deployedAt, org.orgId]
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

async function statsFor(org: Org, query = ''): Promise<{ status: number; body: any }> {
  jest.spyOn(authService, 'verifyToken').mockReturnValue({
    userId: org.userId,
    email: 'deploy-stats-caller@example.com',
    organizationId: org.orgId,
    role: 'viewer',
    type: 'access',
  } as unknown as ReturnType<typeof authService.verifyToken>);
  const res = await fetch(`${baseUrl}/deployments/stats${query}`, {
    headers: { Authorization: 'Bearer test-token' },
  });
  return { status: res.status, body: await res.json() };
}

describe('GET /api/deployments/stats — organization scope', () => {
  it("never includes another organization's deployments, in the counts or as the last deployment", async () => {
    const orgA = await buildOrg();
    const orgB = await buildOrg();

    await insertDeployment(orgA, 'success', { deployedAt: ago(3 * HOUR), cost: 10 });
    await insertDeployment(orgA, 'success', { deployedAt: ago(2 * DAY) });
    await insertDeployment(orgA, 'failed', { deployedAt: ago(5 * DAY) });

    // Org B: more rows, more recent, of every kind.
    for (let i = 0; i < 5; i++) await insertDeployment(orgB, 'failed', { deployedAt: ago(10 * 60_000), cost: 500 });
    await insertDeployment(orgB, 'success', { deployedAt: ago(60_000) });
    await insertDeployment(orgB, 'deploying', { deployedAt: ago(60_000) });
    await insertDeployment(orgB, 'running', { deployedAt: ago(60_000) });

    const a = await statsFor(orgA);
    expect(a.status).toBe(200);
    expect(a.body.stats).toMatchObject({
      window_days: 30,
      total: 3,
      success: 2,
      failed: 1,
      in_progress: 0,
      no_completion_recorded: 0,
      unknown: 0,
      change_failure_rate: 33.3,
      organization_has_deployments: true,
    });
    // No cost is recorded by any writer, so no cost total is reported.
    expect(a.body.stats).not.toHaveProperty('total_cost');
    expect(a.body.stats.last_deployment.status).toBe('success');
    expect(Date.now() - Date.parse(a.body.stats.last_deployment.deployed_at)).toBeGreaterThan(2 * HOUR);

    const b = await statsFor(orgB);
    expect(b.body.stats).toMatchObject({ total: 8, success: 1, failed: 5, in_progress: 1, unknown: 1, change_failure_rate: 83.3 });
  });

  it('an organization with no deployments gets zeros, a null rate and no last deployment -- not another organization\'s', async () => {
    const empty = await buildOrg();
    const busy = await buildOrg();
    await insertDeployment(busy, 'success');
    await insertDeployment(busy, 'failed');

    const { status, body } = await statsFor(empty);
    expect(status).toBe(200);
    expect(body.stats).toEqual({
      window_days: 30,
      total: 0,
      success: 0,
      failed: 0,
      in_progress: 0,
      no_completion_recorded: 0,
      unknown: 0,
      change_failure_rate: null,
      organization_has_deployments: false,
      last_deployment: null,
    });
  });

  it("says whether the organization has any deployment at all, whatever the environment or window -- never from another organization's rows", async () => {
    const org = await buildOrg();
    const other = await buildOrg();
    await insertDeployment(other, 'success', { environment: 'staging' });
    // Only an old, unfinished production row: outside every window, not a
    // "last deployment", and not in staging.
    await insertDeployment(org, 'deploying', { environment: 'production', deployedAt: ago(200 * DAY) });

    const staging = await statsFor(org, '?environment=staging&date_range=7d');
    expect(staging.body.stats).toMatchObject({ total: 0, last_deployment: null, organization_has_deployments: true });

    const none = await buildOrg();
    expect((await statsFor(none, '?environment=staging')).body.stats.organization_has_deployments).toBe(false);
  });

  it('refuses a request with no organization without running any query', async () => {
    // The app pool is a Proxy over a pg Pool; every query it issues outside a
    // request context goes through Pool.prototype.query.
    const querySpy = jest.spyOn(Pool.prototype, 'query');
    const connectSpy = jest.spyOn(Pool.prototype, 'connect');
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();

    await deploymentStatsHandler({ query: {} } as any, { status, json } as any);
    await deploymentStatsHandler({ query: {}, organizationId: '' } as any, { status, json } as any);

    expect(status).toHaveBeenNthCalledWith(1, 401);
    expect(status).toHaveBeenNthCalledWith(2, 401);
    expect(json).toHaveBeenCalledWith({ success: false, error: 'Unauthorized - organization context required' });
    expect(querySpy).not.toHaveBeenCalled();
    expect(connectSpy).not.toHaveBeenCalled();

    // Control: the same spy does see the queries of a scoped request.
    const org = await buildOrg();
    querySpy.mockClear();
    await deploymentStatsHandler({ query: {}, organizationId: org.orgId } as any, { status, json } as any);
    expect(querySpy).toHaveBeenCalled();
  });

  it('refuses an unauthenticated request', async () => {
    const res = await fetch(`${baseUrl}/deployments/stats`);
    expect(res.status).toBe(401);
  });
});

describe('GET /api/deployments/stats — status mapping and rate', () => {
  it("counts 'deploying' as in progress only while recent; older ones have no completion on record; neither enters the rate", async () => {
    const org = await buildOrg();
    await insertDeployment(org, 'success');
    await insertDeployment(org, 'success');
    await insertDeployment(org, 'success');
    await insertDeployment(org, 'failed');
    await insertDeployment(org, 'deploying', { deployedAt: ago(30 * 60_000) });
    await insertDeployment(org, 'deploying', { deployedAt: ago(3 * HOUR) });
    await insertDeployment(org, 'deploying', { deployedAt: ago(6 * DAY) });

    const { body } = await statsFor(org);
    expect(body.stats).toMatchObject({
      total: 7,
      success: 3,
      failed: 1,
      in_progress: 1,
      no_completion_recorded: 2,
      unknown: 0,
      // 1 / (3 + 1): the three unfinished rows are not in the denominator.
      change_failure_rate: 25,
    });
  });

  it("counts legacy and unrecognised statuses as unknown -- never as success, failed or in progress", async () => {
    const org = await buildOrg();
    await insertDeployment(org, 'running');
    await insertDeployment(org, 'stopped');
    await insertDeployment(org, 'cancelled');
    await insertDeployment(org, 'SUCCESS');

    const { body } = await statsFor(org);
    expect(body.stats).toMatchObject({
      total: 4, success: 0, failed: 0, in_progress: 0, no_completion_recorded: 0, unknown: 4,
      change_failure_rate: null,
      last_deployment: null,
    });
  });

  it('reports a real 0 rate when deployments finished and none failed', async () => {
    const org = await buildOrg();
    await insertDeployment(org, 'success');
    await insertDeployment(org, 'success');

    const { body } = await statsFor(org);
    expect(body.stats.change_failure_rate).toBe(0);
  });

  it('the last deployment is the most recent finished one, even when a newer row never finished', async () => {
    const org = await buildOrg();
    await insertDeployment(org, 'success', { deployedAt: ago(4 * DAY) });
    await insertDeployment(org, 'failed', { deployedAt: ago(2 * DAY) });
    await insertDeployment(org, 'deploying', { deployedAt: ago(60_000) });
    await insertDeployment(org, 'running', { deployedAt: ago(30_000) });

    const { body } = await statsFor(org);
    expect(body.stats.last_deployment.status).toBe('failed');
    const age = Date.now() - Date.parse(body.stats.last_deployment.deployed_at);
    expect(age).toBeGreaterThan(2 * DAY - HOUR);
    expect(age).toBeLessThan(2 * DAY + HOUR);
  });
});

describe('GET /api/deployments/stats — last deployment ordering', () => {
  it('a finished row with no deployed_at never outranks a dated one', async () => {
    const org = await buildOrg();
    await insertDeployment(org, 'success', { deployedAt: ago(3 * DAY) });
    await pool.query(
      `INSERT INTO deployments (service_id, environment, aws_region, status, deployed_by, deployed_at, organization_id)
       VALUES ($1, 'production', 'us-east-1', 'failed', 'github-actions', NULL, $2)`,
      [org.serviceId, org.orgId]
    );

    const { body } = await statsFor(org);
    expect(body.stats.last_deployment.status).toBe('success');
    const age = Date.now() - Date.parse(body.stats.last_deployment.deployed_at);
    expect(age).toBeGreaterThan(3 * DAY - HOUR);
    expect(age).toBeLessThan(3 * DAY + HOUR);
  });

  it('when the only finished row has no deployed_at, no last deployment is reported -- not an epoch date', async () => {
    const org = await buildOrg();
    await pool.query(
      `INSERT INTO deployments (service_id, environment, aws_region, status, deployed_by, deployed_at, organization_id)
       VALUES ($1, 'production', 'us-east-1', 'success', 'github-actions', NULL, $2)`,
      [org.serviceId, org.orgId]
    );

    const { status, body } = await statsFor(org);
    expect(status).toBe(200);
    expect(body.stats.last_deployment).toBeNull();
    expect(body.stats.organization_has_deployments).toBe(true);
  });
});

describe('GET /api/deployments/stats — window and filters', () => {
  it('counts only deployments inside the window (default 30 days); the last deployment is not windowed', async () => {
    const org = await buildOrg();
    await insertDeployment(org, 'success', { deployedAt: ago(3 * DAY) });
    await insertDeployment(org, 'failed', { deployedAt: ago(20 * DAY) });
    await insertDeployment(org, 'failed', { deployedAt: ago(60 * DAY) });
    await insertDeployment(org, 'success', { deployedAt: ago(200 * DAY) });

    const seven = await statsFor(org, '?date_range=7d');
    expect(seven.body.stats).toMatchObject({ window_days: 7, total: 1, success: 1, failed: 0, change_failure_rate: 0 });

    const thirty = await statsFor(org);
    expect(thirty.body.stats).toMatchObject({ window_days: 30, total: 2, success: 1, failed: 1, change_failure_rate: 50 });

    const ninety = await statsFor(org, '?date_range=90d');
    expect(ninety.body.stats).toMatchObject({ window_days: 90, total: 3, success: 1, failed: 2, change_failure_rate: 66.7 });
  });

  it('with nothing in the window, the rate is null while the last deployment is still reported', async () => {
    const org = await buildOrg();
    await insertDeployment(org, 'success', { deployedAt: ago(45 * DAY) });

    const { body } = await statsFor(org, '?date_range=7d');
    expect(body.stats).toMatchObject({ total: 0, success: 0, failed: 0, change_failure_rate: null });
    expect(body.stats.last_deployment.status).toBe('success');
  });

  it('filters by environment, for the counts and the last deployment', async () => {
    const org = await buildOrg();
    await insertDeployment(org, 'success', { environment: 'production', deployedAt: ago(2 * DAY) });
    await insertDeployment(org, 'failed', { environment: 'staging', deployedAt: ago(HOUR) });

    const production = await statsFor(org, '?environment=production');
    expect(production.body.stats).toMatchObject({ total: 1, success: 1, failed: 0 });
    expect(production.body.stats.last_deployment.status).toBe('success');

    const all = await statsFor(org, '?environment=all');
    expect(all.body.stats).toMatchObject({ total: 2, success: 1, failed: 1 });
  });

  it('rejects an unsupported window', async () => {
    const org = await buildOrg();
    const { status, body } = await statsFor(org, '?date_range=365d');
    expect(status).toBe(400);
    expect(body).toEqual({ success: false, error: 'Invalid date_range. Must be one of: 7d, 30d, 90d' });
  });
});
