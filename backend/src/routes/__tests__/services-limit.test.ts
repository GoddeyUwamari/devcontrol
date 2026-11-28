/**
 * The services limit (service-limits stage-a + Addendum 1, founder rulings).
 *
 * Policy under test:
 *   - POST /api/services creates a NEW service only while the organization is
 *     below its services limit: every services row counts, whatever its status
 *     (FQ1). The limit is resolved as entitlementOf decides: a billing hold or a
 *     terminal subscription gives the Free limit; otherwise the stored
 *     max_services, else the plan default; -1 = unlimited.
 *   - The check runs inside the creating transaction, under a per-organization
 *     advisory lock taken FIRST, in its own namespace ('services_quota:'), so
 *     two creations for the last slot cannot both succeed, and a refusal or an
 *     error leaves nothing.
 *   - The refusal is 402 RESOURCE_LIMIT_REACHED with the approved message (C9):
 *     plan names, never an internal tier id.
 *   - Only creation is limited: reading, updating and deleting existing
 *     services work at and over the limit.
 *   - The demo workspace is refused (403 not_available_in_demo), as on the
 *     GitHub routes (FQ6).
 *   - The legacy GitHub Actions webhook's auto-create (GITHUB_WEBHOOK_ORG_ID
 *     only) is exempt (FQ3) -- but POST /api/services is limited for that
 *     organization like any other.
 *   - GET /api/services/limit reports what POST will decide.
 *
 * Real routes over an in-process HTTP server against live Postgres; only
 * authService.verifyToken (the caller) is stubbed, plus, where named, the demo
 * lookup and a barrier that holds a creation at its insert. Every name, slug
 * and email here is generated.
 */
import crypto, { randomUUID } from 'crypto';
import express from 'express';
import http from 'http';
import { Pool, PoolClient } from 'pg';
import servicesRoutes from '../services.routes';
import { errorHandler } from '../../middleware/error-handler';
import { authService } from '../../services/auth.service';
import { ServicesRepository } from '../../repositories/services.repository';
import * as demo from '../../demo/demo-workspace';
import { pool as appPool } from '../../config/database';
import {
  SERVICES_QUOTA_LOCK_SQL,
  TIER_LIMITS,
  serviceCapacityOf,
} from '../../middleware/subscription.middleware';
import { QUOTA_LOCK_SQL } from '../../services/github-app/record';

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

const WEBHOOK_SECRET = 'services-limit-test-secret';
const WEBHOOK_ORG_ID = randomUUID();

const pool = new Pool(dbConfig());
const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

interface OrgOptions {
  id?: string;
  tier?: string;
  /** undefined = NULL (the plan default applies). */
  maxServices?: number | null;
  status?: string | null;
  subscriptionId?: string | null;
}

async function insertOrg(options: OrgOptions = {}): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (id, name, slug, display_name, subscription_tier, max_services, subscription_status, stripe_subscription_id)
     VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $2, $4, $5, $6, $7) RETURNING id`,
    [options.id ?? null, `Services Limit ${suffix}`, `services-limit-${suffix}`, options.tier ?? 'free',
     options.maxServices ?? null, options.status ?? null, options.subscriptionId ?? null]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function member(orgId: string, role: string): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Services Limit User') RETURNING id`,
    [`services-limit-${role}-${uniqueSuffix()}@example.com`]
  );
  const userId = rows[0].id as string;
  createdUserIds.push(userId);
  await pool.query(
    `INSERT INTO organization_memberships (organization_id, user_id, role, joined_at, is_active)
     VALUES ($1, $2, $3, NOW(), true)`,
    [orgId, userId, role]
  );
  return userId;
}

async function insertTeam(orgId: string): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO teams (name, owner, organization_id) VALUES ($1, 'owner@example.com', $2) RETURNING id`,
    [`services-limit-team-${uniqueSuffix()}`, orgId]
  );
  return rows[0].id as string;
}

/** `n` existing services, written directly (as before any limit existed). */
async function fill(orgId: string, n: number, status = 'active'): Promise<string[]> {
  if (n === 0) return [];
  const { rows } = await pool.query(
    `INSERT INTO services (name, template, owner, status, organization_id)
     SELECT 'services-limit-existing-' || g || '-' || $3::text, 'api', 'owner@example.com', $2, $1
       FROM generate_series(1, $4::int) AS g
     RETURNING id`,
    [orgId, status, uniqueSuffix(), n]
  );
  return rows.map((r) => r.id as string);
}

async function count(orgId: string): Promise<number> {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM services WHERE organization_id = $1', [orgId]);
  return rows[0].n;
}

interface Workspace { orgId: string; teamId: string; owner: string; admin: string; member: string; viewer: string }

async function workspace(options: OrgOptions = {}, existing = 0): Promise<Workspace> {
  const orgId = await insertOrg(options);
  const ws = {
    orgId,
    teamId: await insertTeam(orgId),
    owner: await member(orgId, 'owner'),
    admin: await member(orgId, 'admin'),
    member: await member(orgId, 'member'),
    viewer: await member(orgId, 'viewer'),
  };
  await fill(orgId, existing);
  return ws;
}

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  process.env.GITHUB_WEBHOOK_ORG_ID = WEBHOOK_ORG_ID;
  process.env.GITHUB_WEBHOOK_SECRET = WEBHOOK_SECRET;
  // Loaded after the environment is set: the router reads its organization at module load.
  const githubWebhookRoutes = (await import('../github-webhook.routes')).default;

  const app = express();
  app.use('/api/webhooks/github', express.raw({ type: 'application/json' }));
  app.use('/api/webhooks/github', githubWebhookRoutes);
  app.use(express.json());
  app.use('/api/services', servicesRoutes);
  app.use(errorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}/api`;
});

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.query('DELETE FROM deployments WHERE organization_id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM services WHERE organization_id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM teams WHERE organization_id = ANY($1)', [createdOrgIds]);
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

/**
 * One request as `userId` in `orgId` (the token's role claim is 'owner'; the
 * decision comes from the current membership). The verifyToken stub is keyed
 * by the bearer token, so concurrent requests keep their own caller.
 */
const callers = new Map<string, { userId: string; orgId: string }>();
function send(userId: string, orgId: string, method: string, path: string, body?: unknown) {
  const token = `t-${userId}`;
  callers.set(token, { userId, orgId });
  if (!jest.isMockFunction(authService.verifyToken)) {
    jest.spyOn(authService, 'verifyToken').mockImplementation(((t: string) => {
      const caller = callers.get(t);
      if (!caller) throw new Error('unknown test token');
      return { userId: caller.userId, email: 'services-limit-caller@example.com', organizationId: caller.orgId, role: 'owner', type: 'access' };
    }) as unknown as typeof authService.verifyToken);
  }
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function create(ws: Workspace, as: string = ws.admin, extra: Record<string, unknown> = {}) {
  return send(as, ws.orgId, 'POST', '/services', {
    name: `services-limit-new-${uniqueSuffix()}`, template: 'api', owner: 'owner@example.com', team_id: ws.teamId, ...extra,
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- response bodies are asserted field by field
async function json(res: Response): Promise<any> {
  return res.json();
}

const INTERNAL_TIER_ID = /\b(free|starter|pro|enterprise)\b/;

function webhookDelivery(repoName: string) {
  const body = JSON.stringify({
    action: 'completed',
    workflow_job: {
      id: Math.floor(Math.random() * 1e12),
      run_id: Math.floor(Math.random() * 1e12),
      name: 'deploy-backend',
      conclusion: 'success',
      completed_at: new Date().toISOString(),
      head_sha: 'abc123',
      html_url: 'https://example.com/run',
    },
    repository: { name: repoName },
    sender: { login: 'services-limit' },
  });
  const signature = 'sha256=' + crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
  return fetch(`${baseUrl}/webhooks/github`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-GitHub-Event': 'workflow_job', 'X-Hub-Signature-256': signature },
    body,
  });
}

// ─── Plan limits ─────────────────────────────────────────────────────────────

describe('each plan\'s services limit (FQ4: no values change)', () => {
  it('TIER_LIMITS: Visibility 5, Cost Control 20, Optimization Engine 100, Revenue Protection unlimited', () => {
    expect([TIER_LIMITS.free.maxServices, TIER_LIMITS.starter.maxServices, TIER_LIMITS.pro.maxServices, TIER_LIMITS.enterprise.maxServices])
      .toEqual([5, 20, 100, -1]);
  });

  it.each([
    ['free', 5, 'Visibility'],
    ['starter', 20, 'Cost Control'],
    ['pro', 100, 'Optimization Engine'],
  ] as const)('%s (plan default, max_services NULL): the last slot is created, the next is refused', async (tier, limit, plan) => {
    const ws = await workspace({ tier }, limit - 1);
    expect((await create(ws)).status).toBe(201);
    expect(await count(ws.orgId)).toBe(limit);

    const refused = await create(ws);
    expect(refused.status).toBe(402);
    const body = await json(refused);
    expect(body.details).toMatchObject({ resourceType: 'services', currentUsage: limit, maxLimit: limit, plan });
    expect(await count(ws.orgId)).toBe(limit);
  });

  it('Revenue Protection (enterprise, NULL): unlimited, also past every other plan\'s limit', async () => {
    const ws = await workspace({ tier: 'enterprise' }, 101);
    expect((await create(ws)).status).toBe(201);
    expect(await count(ws.orgId)).toBe(102);
  });

  it('a stored -1 is unlimited whatever the plan', async () => {
    const ws = await workspace({ tier: 'free', maxServices: -1 }, 6);
    expect((await create(ws)).status).toBe(201);
  });
});

// ─── Below, exactly at, above ────────────────────────────────────────────────

describe('below, exactly at and above the limit (Visibility, 5)', () => {
  it('below: 4 existing -> 201, and the service is in the caller\'s organization', async () => {
    const ws = await workspace({ tier: 'free' }, 4);
    const res = await create(ws);
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.data.organization_id).toBe(ws.orgId);
    expect(await count(ws.orgId)).toBe(5);
  });

  it('exactly at: 5 existing -> 402 RESOURCE_LIMIT_REACHED with the approved message (C9), and nothing written', async () => {
    const ws = await workspace({ tier: 'free' }, 5);
    const res = await create(ws);
    expect(res.status).toBe(402);
    expect(await json(res)).toEqual({
      success: false,
      error: "Your Visibility plan includes 5 services, and this workspace has 5. Existing services aren't affected.",
      code: 'RESOURCE_LIMIT_REACHED',
      details: { resourceType: 'services', currentUsage: 5, maxLimit: 5, plan: 'Visibility' },
      upgrade: { available: true, url: '/settings/billing/upgrade' },
    });
    expect(await count(ws.orgId)).toBe(5);
  });

  it('no team (onboarding D5): the last slot is created with no team, the next is refused with the same 402, nothing written', async () => {
    const ws = await workspace({ tier: 'free' }, 4);
    const created = await create(ws, ws.admin, { team_id: undefined });
    expect(created.status).toBe(201);
    expect((await json(created)).data).toMatchObject({ team_id: null, organization_id: ws.orgId });
    expect(await count(ws.orgId)).toBe(5);

    for (const team_id of [undefined, null, '']) {
      const res = await create(ws, ws.admin, { team_id });
      expect(res.status).toBe(402);
      expect(await json(res)).toMatchObject({
        success: false,
        error: "Your Visibility plan includes 5 services, and this workspace has 5. Existing services aren't affected.",
        code: 'RESOURCE_LIMIT_REACHED',
      });
    }
    expect(await count(ws.orgId)).toBe(5);
  });

  it('above (e.g. after a downgrade): 7 existing -> 402 naming 7; the 7 are untouched', async () => {
    const ws = await workspace({ tier: 'free' }, 7);
    const before = (await pool.query('SELECT id, name, status, updated_at FROM services WHERE organization_id = $1 ORDER BY id', [ws.orgId])).rows;
    const res = await create(ws);
    expect(res.status).toBe(402);
    expect((await json(res)).error).toBe("Your Visibility plan includes 5 services, and this workspace has 7. Existing services aren't affected.");
    const after = (await pool.query('SELECT id, name, status, updated_at FROM services WHERE organization_id = $1 ORDER BY id', [ws.orgId])).rows;
    expect(after).toEqual(before);
  });

  it('every row counts, whatever its status (FQ1): 3 active + 2 archived = at the limit', async () => {
    const orgId = await insertOrg({ tier: 'free' });
    const ws = { orgId, teamId: await insertTeam(orgId), owner: '', admin: await member(orgId, 'admin'), member: '', viewer: '' };
    await fill(orgId, 3, 'active');
    await fill(orgId, 1, 'archived');
    await fill(orgId, 1, 'inactive');
    expect((await create(ws)).status).toBe(402);
  });

  it('the backend decides with no UI involved: a direct POST without any prior GET /limit is refused the same way', async () => {
    const ws = await workspace({ tier: 'starter' }, 20);
    const res = await create(ws, ws.owner, { organization_id: randomUUID() });
    expect(res.status).toBe(402);
    expect(await count(ws.orgId)).toBe(20);
  });
});

// ─── Concurrency and atomicity ───────────────────────────────────────────────

describe('the last slot goes to exactly one creation (lock first, then count, then insert, one transaction)', () => {
  /**
   * Holds every creation that reaches its INSERT until two have arrived or
   * 1.5 s have passed. With the lock, the second creation is still waiting for
   * the lock (it never counted), so the first goes on after 1.5 s. Without
   * the lock -- or with the count outside the locked transaction -- both have
   * counted 4 by the time they meet here, and both would insert.
   */
  function barrierAtInsert() {
    const original = ServicesRepository.prototype.create;
    let arrived = 0;
    jest.spyOn(ServicesRepository.prototype, 'create').mockImplementation(async function (this: ServicesRepository, ...args) {
      arrived += 1;
      const deadline = Date.now() + 1500;
      while (arrived < 2 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
      return original.apply(this, args);
    });
    return () => arrived;
  }

  it('two concurrent creations for the last slot: one 201, one 402; 5 rows', async () => {
    const ws = await workspace({ tier: 'free' }, 4);
    const reachedInsert = barrierAtInsert();
    const [a, b] = await Promise.all([create(ws, ws.admin), create(ws, ws.owner)]);
    expect([a.status, b.status].sort()).toEqual([201, 402]);
    expect(reachedInsert()).toBe(1);
    expect(await count(ws.orgId)).toBe(5);
  });

  it('six concurrent creations with one slot left: exactly one is created', async () => {
    const ws = await workspace({ tier: 'free' }, 4);
    const results = await Promise.all(Array.from({ length: 6 }, () => create(ws)));
    expect(results.map((r) => r.status).sort()).toEqual([201, 402, 402, 402, 402, 402]);
    expect(await count(ws.orgId)).toBe(5);
  });

  it('an error after the insert rolls the whole creation back: 500, nothing left', async () => {
    const ws = await workspace({ tier: 'free' }, 2);
    const original = ServicesRepository.prototype.create;
    jest.spyOn(ServicesRepository.prototype, 'create').mockImplementation(async function (this: ServicesRepository, ...args) {
      await original.apply(this, args);
      throw new Error('boom after insert');
    });
    const res = await create(ws);
    expect(res.status).toBe(500);
    expect(await count(ws.orgId)).toBe(2);
  });

  it('a team of another organization is still 404 below the limit, and writes nothing', async () => {
    const ws = await workspace({ tier: 'free' }, 1);
    const other = await insertOrg({ tier: 'free' });
    const res = await create(ws, ws.admin, { team_id: await insertTeam(other) });
    expect(res.status).toBe(404);
    expect(await count(ws.orgId)).toBe(1);
    expect(await count(other)).toBe(0);
  });

  it('no team (onboarding D5): two concurrent creations for the last slot, one 201, one 402; 5 rows', async () => {
    const ws = await workspace({ tier: 'free' }, 4);
    const reachedInsert = barrierAtInsert();
    const [a, b] = await Promise.all([create(ws, ws.admin, { team_id: undefined }), create(ws, ws.owner, { team_id: '' })]);
    expect([a.status, b.status].sort()).toEqual([201, 402]);
    expect(reachedInsert()).toBe(1);
    expect(await count(ws.orgId)).toBe(5);
  });

  describe('the lock: its own namespace, taken before anything else', () => {
    async function holding<T>(sql: string, orgId: string, fn: () => Promise<T>): Promise<T> {
      const client: PoolClient = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql, [orgId]);
        return await fn();
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
      }
    }

    it('the key is services_quota:<org>, distinct from the D8a quota lock and the seat lock', () => {
      expect(SERVICES_QUOTA_LOCK_SQL).toBe("SELECT pg_advisory_xact_lock(hashtextextended('services_quota:' || $1::text, 0))");
      expect(SERVICES_QUOTA_LOCK_SQL).not.toBe(QUOTA_LOCK_SQL);
      expect(QUOTA_LOCK_SQL).toContain("'deployments_quota:'");
    });

    it.each([
      ['the D8a deployments quota lock', QUOTA_LOCK_SQL],
      ['the seat lock', "SELECT pg_advisory_xact_lock(hashtextextended('organization_memberships:' || $1::text, 0))"],
    ])('%s held by another session does not block a creation', async (_label, sql) => {
      const ws = await workspace({ tier: 'free' }, 0);
      const status = await holding(sql, ws.orgId, async () => (await create(ws)).status);
      expect(status).toBe(201);
    });

    it('the services lock held by another session: the creation waits (nothing counted or written), then completes', async () => {
      const ws = await workspace({ tier: 'free' }, 0);
      let settled = false;
      let pending: Promise<Response> | undefined;
      await holding(SERVICES_QUOTA_LOCK_SQL, ws.orgId, async () => {
        pending = create(ws).then((r) => { settled = true; return r; });
        await new Promise((r) => setTimeout(r, 400));
        expect(settled).toBe(false);
        expect(await count(ws.orgId)).toBe(0);
      });
      expect((await pending!).status).toBe(201);
    });
  });
});

// ─── Tenant isolation ────────────────────────────────────────────────────────

describe('tenant isolation', () => {
  it('one organization at its limit never limits another; each counts only its own rows', async () => {
    const a = await workspace({ tier: 'free' }, 5);
    const b = await workspace({ tier: 'free' }, 4);
    const c = await workspace({ tier: 'free' }, 0);
    await fill(c.orgId, 0);
    expect((await create(a)).status).toBe(402);
    expect((await create(b)).status).toBe(201);
    expect((await create(c)).status).toBe(201);
    expect([await count(a.orgId), await count(b.orgId), await count(c.orgId)]).toEqual([5, 5, 1]);
  });

  it('a body naming another organization changes nothing: the caller\'s own limit applies, the row lands in the caller\'s organization', async () => {
    const full = await workspace({ tier: 'free' }, 5);
    const roomy = await workspace({ tier: 'free' }, 0);
    expect((await create(full, full.admin, { organization_id: roomy.orgId })).status).toBe(402);
    const res = await create(roomy, roomy.admin, { organization_id: full.orgId });
    expect(res.status).toBe(201);
    expect([await count(full.orgId), await count(roomy.orgId)]).toEqual([5, 1]);
  });
});

// ─── Only creation is limited ────────────────────────────────────────────────

describe('over the limit after a downgrade: new creation blocked, existing services untouched and manageable', () => {
  it('Optimization Engine with 30 services downgraded to Visibility (the Stripe tier rewrite): 402; read, update and delete all work', async () => {
    const ws = await workspace({ tier: 'pro', maxServices: 100 }, 30);
    expect((await create(ws)).status).toBe(201);
    // As stripe.service.ts writes a tier change: the tier and its limits from TIER_LIMITS.
    await pool.query(`UPDATE organizations SET subscription_tier = 'free', max_services = $2 WHERE id = $1`, [ws.orgId, TIER_LIMITS.free.maxServices]);

    expect((await create(ws)).status).toBe(402);
    const registered = await json(await send(ws.viewer, ws.orgId, 'GET', '/services/registered'));
    expect(registered.total).toBe(31);

    const [first, second] = (await pool.query('SELECT id FROM services WHERE organization_id = $1 ORDER BY id LIMIT 2', [ws.orgId])).rows.map((r) => r.id);
    expect((await send(ws.viewer, ws.orgId, 'GET', `/services/${first}`)).status).toBe(200);
    expect((await send(ws.admin, ws.orgId, 'PUT', `/services/${first}`, { description: 'still managed' })).status).toBe(200);
    expect((await send(ws.admin, ws.orgId, 'DELETE', `/services/${second}`)).status).toBe(200);
    expect(await count(ws.orgId)).toBe(30);
    expect((await create(ws)).status).toBe(402);
  });

  it('edits at the limit are allowed: rename, describe, archive and re-activate; the count never moves', async () => {
    const ws = await workspace({ tier: 'free' }, 5);
    const [id] = (await pool.query('SELECT id FROM services WHERE organization_id = $1 LIMIT 1', [ws.orgId])).rows.map((r) => r.id);
    for (const body of [{ name: `renamed-${uniqueSuffix()}` }, { description: 'at the limit' }, { status: 'archived' }, { status: 'active' }]) {
      const res = await send(ws.admin, ws.orgId, 'PUT', `/services/${id}`, body);
      expect(res.status).toBe(200);
    }
    expect(await count(ws.orgId)).toBe(5);
  });
});

// ─── Holds and terminal subscriptions ────────────────────────────────────────

describe('billing holds and terminal subscriptions give the Free limit (entitlementOf), whatever the stored max_services', () => {
  async function heldPro(state: { status?: string | null; lifecycle?: string; graceEndsAt?: string | null }): Promise<Workspace> {
    const ws = await workspace({ tier: 'pro', maxServices: 100, status: state.status ?? 'active', subscriptionId: `sub_test_${uniqueSuffix()}` }, 5);
    if (state.lifecycle) {
      await pool.query(
        `UPDATE organizations SET billing_lifecycle_state = $2, payment_failed_at = NOW() - interval '9 days',
                grace_period_ends_at = $3::timestamptz WHERE id = $1`,
        [ws.orgId, state.lifecycle, state.graceEndsAt ?? null]
      );
    }
    return ws;
  }

  it.each([
    ['restricted', { lifecycle: 'restricted' }, 'BILLING_RESTRICTED'],
    ['grace period ended', { status: 'past_due', lifecycle: 'grace_period', graceEndsAt: new Date(Date.now() - 86_400_000).toISOString() }, 'BILLING_RESTRICTED'],
    ['unpaid, no grace running', { status: 'unpaid' }, 'BILLING_RESTRICTED'],
    ['paused', { status: 'paused' }, 'SUBSCRIPTION_INACTIVE'],
    ['incomplete', { status: 'incomplete' }, 'SUBSCRIPTION_INACTIVE'],
    ['canceled (terminal)', { status: 'canceled' }, undefined],
    ['incomplete_expired (terminal)', { status: 'incomplete_expired' }, undefined],
  ] as const)('%s: 5 existing on a stored Optimization Engine (100) -> 402 at the Free 5', async (_label, state, reason) => {
    const ws = await heldPro(state);
    const res = await create(ws);
    expect(res.status).toBe(402);
    const body = await json(res);
    expect(body.details.maxLimit).toBe(5);
    expect(body.details.plan).toBe('Visibility');
    expect(body.details.reason).toBe(reason);
    expect(await count(ws.orgId)).toBe(5);
  });

  it.each([
    ['grace period still running', { status: 'past_due', lifecycle: 'grace_period', graceEndsAt: new Date(Date.now() + 86_400_000).toISOString() }],
    ['past_due', { status: 'past_due' }],
    ['trialing', { status: 'trialing' }],
    ['active', { status: 'active' }],
  ] as const)('%s keeps the stored limit (100): 201', async (_label, state) => {
    const ws = await heldPro(state);
    expect((await create(ws)).status).toBe(201);
  });

  it('a trialing Cost Control workspace has Cost Control\'s 20', async () => {
    const ws = await workspace({ tier: 'starter', maxServices: 20, status: 'trialing', subscriptionId: `sub_test_${uniqueSuffix()}` }, 19);
    expect((await create(ws)).status).toBe(201);
    expect((await create(ws)).status).toBe(402);
  });
});

describe('precedence (unchanged): the stored max_services, else the plan default', () => {
  it.each([
    ['NULL -> the plan default 5', null, 5],
    ['0 -> the plan default 5', 0, 5],
    ['10 (the column default) -> 10', 10, 10],
    ['999 -> 999', 999, 999],
  ] as const)('Visibility with max_services %s', async (_label, stored, limit) => {
    const orgId = await insertOrg({ tier: 'free', maxServices: stored });
    expect((await serviceCapacityOf(pool, orgId)).limit).toBe(limit);
  });
});

// ─── The demo workspace ──────────────────────────────────────────────────────

describe('the demo workspace creates no services (FQ6)', () => {
  it('403 not_available_in_demo, as the GitHub routes answer; nothing written; below its limit', async () => {
    const ws = await workspace({ tier: 'pro' }, 0);
    jest.spyOn(demo, 'isDemoOrganization').mockResolvedValue(true);
    const res = await create(ws);
    expect(res.status).toBe(403);
    expect(await json(res)).toEqual({ success: false, error: 'not_available_in_demo' });
    expect(await count(ws.orgId)).toBe(0);
  });

  it('no team (onboarding D5) is refused the same way: 403, nothing written', async () => {
    const ws = await workspace({ tier: 'pro' }, 0);
    jest.spyOn(demo, 'isDemoOrganization').mockResolvedValue(true);
    const res = await create(ws, ws.admin, { team_id: undefined });
    expect(res.status).toBe(403);
    expect(await json(res)).toEqual({ success: false, error: 'not_available_in_demo' });
    expect(await count(ws.orgId)).toBe(0);
  });

  it('the demo status is read for the caller\'s own organization, from the database (a real non-demo row creates)', async () => {
    const ws = await workspace({ tier: 'free' }, 0);
    const spy = jest.spyOn(demo, 'isDemoOrganization');
    expect((await create(ws)).status).toBe(201);
    expect(spy).toHaveBeenCalledWith(expect.anything(), ws.orgId);
  });

  it('a demo status that cannot be read fails closed: 500, nothing written', async () => {
    const ws = await workspace({ tier: 'free' }, 0);
    jest.spyOn(demo, 'isDemoOrganization').mockRejectedValue(new demo.DemoOrganizationLookupError('unreadable'));
    expect((await create(ws)).status).toBe(500);
    expect(await count(ws.orgId)).toBe(0);
  });

  it('the role is still checked first: a member gets the role 403, not the demo answer', async () => {
    const ws = await workspace({ tier: 'free' }, 0);
    jest.spyOn(demo, 'isDemoOrganization').mockResolvedValue(true);
    const res = await create(ws, ws.member);
    expect(res.status).toBe(403);
    expect((await json(res)).error).toBe('Only an organization owner or admin can manage services');
  });
});

describe('the role is checked before the limit: no usage reaches other roles', () => {
  it.each(['member', 'viewer'] as const)('%s at the limit: 403, no count in the answer', async (role) => {
    const ws = await workspace({ tier: 'free' }, 5);
    const res = await create(ws, ws[role]);
    expect(res.status).toBe(403);
    expect(JSON.stringify(await json(res))).not.toMatch(/\b5\b/);
  });
});

// ─── The legacy webhook exemption ────────────────────────────────────────────

describe('the legacy GitHub Actions webhook auto-create is exempt (FQ3, until D8c retires it)', () => {
  it('GITHUB_WEBHOOK_ORG_ID at its limit: an unknown repository still gets its service; POST /api/services is still refused for that organization', async () => {
    const ws = await workspace({ id: WEBHOOK_ORG_ID, tier: 'free' }, 5);
    const repoName = `services-limit-repo-${uniqueSuffix()}`;
    const delivered = await webhookDelivery(repoName);
    expect(delivered.status).toBeLessThan(300);
    expect(await count(ws.orgId)).toBe(6);
    const { rows } = await pool.query('SELECT owner FROM services WHERE organization_id = $1 AND name = $2', [ws.orgId, repoName]);
    expect(rows).toEqual([{ owner: 'github-actions@webhook' }]);

    const res = await create(ws);
    expect(res.status).toBe(402);
    expect((await json(res)).details.currentUsage).toBe(6);
  });
});

// ─── The 402 message ─────────────────────────────────────────────────────────

describe('the 402 message names plans, never internal tier ids (C9)', () => {
  it.each([
    ['free', 5, 'Visibility'],
    ['starter', 20, 'Cost Control'],
    ['pro', 100, 'Optimization Engine'],
  ] as const)('%s', async (tier, limit, plan) => {
    const ws = await workspace({ tier, maxServices: limit }, limit);
    const body = await json(await create(ws));
    expect(body.code).toBe('RESOURCE_LIMIT_REACHED');
    expect(body.error).toBe(`Your ${plan} plan includes ${limit} services, and this workspace has ${limit}. Existing services aren't affected.`);
    expect(JSON.stringify(body)).not.toMatch(INTERNAL_TIER_ID);
  });

  it('a managed plan (no subscription, paid tier) is offered no upgrade; the top plan with a stored cap neither', async () => {
    const managed = await workspace({ tier: 'starter', maxServices: 20 }, 20);
    expect((await json(await create(managed))).upgrade).toEqual({ available: false, url: '/settings/billing/upgrade' });
    const top = await workspace({ tier: 'enterprise', maxServices: 3 }, 3);
    const body = await json(await create(top));
    expect(body.upgrade.available).toBe(false);
    expect(body.error).toBe("Your Revenue Protection plan includes 3 services, and this workspace has 3. Existing services aren't affected.");
  });

  it('a stored tier the catalog does not know: "Your plan", never the id', async () => {
    const ws = await workspace({ tier: 'legacy_gold', maxServices: 2 }, 2);
    const body = await json(await create(ws));
    expect(body.error).toBe("Your plan includes 2 services, and this workspace has 2. Existing services aren't affected.");
    expect(body.details.plan).toBeNull();
    expect(JSON.stringify(body)).not.toContain('legacy_gold');
  });
});

// ─── GET /api/services/limit ─────────────────────────────────────────────────

describe('GET /api/services/limit reports what POST decides', () => {
  it('below, at, unlimited, held; any member may read it', async () => {
    const below = await workspace({ tier: 'free' }, 2);
    expect((await json(await send(below.viewer, below.orgId, 'GET', '/services/limit'))).limit).toEqual({
      used: 2, max: 5, plan: 'Visibility', freePlan: 'Visibility', reached: false, upgradeAvailable: true, reason: null,
      message: "Your Visibility plan includes 5 services, and this workspace has 2. Existing services aren't affected.",
    });

    const at = await workspace({ tier: 'starter', maxServices: 20 }, 20);
    const atLimit = (await json(await send(at.member, at.orgId, 'GET', '/services/limit'))).limit;
    expect(atLimit).toMatchObject({ used: 20, max: 20, plan: 'Cost Control', reached: true, upgradeAvailable: false });
    expect((await create(at)).status).toBe(402);

    const unlimited = await workspace({ tier: 'enterprise' }, 7);
    expect((await json(await send(unlimited.viewer, unlimited.orgId, 'GET', '/services/limit'))).limit).toMatchObject({
      used: 7, max: null, plan: 'Revenue Protection', reached: false, message: null,
    });

    const held = await workspace({ tier: 'pro', maxServices: 100, status: 'paused', subscriptionId: `sub_test_${uniqueSuffix()}` }, 5);
    expect((await json(await send(held.viewer, held.orgId, 'GET', '/services/limit'))).limit).toMatchObject({
      used: 5, max: 5, plan: 'Visibility', reached: true, reason: 'SUBSCRIPTION_INACTIVE',
    });
  });

  it('is never refused by the limit itself, and is scoped to the caller\'s organization', async () => {
    const full = await workspace({ tier: 'free' }, 9);
    const other = await workspace({ tier: 'free' }, 1);
    expect((await json(await send(full.viewer, full.orgId, 'GET', '/services/limit'))).limit.used).toBe(9);
    expect((await json(await send(other.viewer, other.orgId, 'GET', '/services/limit'))).limit.used).toBe(1);
  });

  it('is not taken for a service id (declared before /:id)', async () => {
    const ws = await workspace({ tier: 'free' }, 0);
    expect((await send(ws.viewer, ws.orgId, 'GET', '/services/limit')).status).toBe(200);
  });
});
