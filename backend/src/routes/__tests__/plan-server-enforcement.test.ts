/**
 * The server enforces the plan for tenants (Enterprise), the cost forecast
 * (Pro) and remediation (Enterprise, reads included), reading the plan from
 * the organization's row on every request -- never from the token or the
 * request. A billing-restricted organization, or one whose grace period has
 * ended, is treated as free. The plan is checked before any role gate, and
 * never instead of one. If the plan cannot be read, nothing is served.
 *
 * Tenant and forecast failures answer with a fixed message; what went wrong
 * is logged on the server only.
 *
 * Real routes, real authentication and the real plan middleware against
 * Postgres (role-gate-harness.ts), with the real tenants table. Only the
 * forecast and remediation services are stubbed.
 */
import { Client } from 'pg';
import tenantsRoutes from '../tenants.routes';
import { createForecastRoutes } from '../forecast.routes';
import { createRemediationRoutes } from '../remediation.routes';
import { pool as appPool } from '../../config/database';
import { authService } from '../../services/auth.service';
import { CostForecastService } from '../../services/cost-forecast.service';
import { ForecastAIService } from '../../services/forecast-ai.service';
import { ScenarioPlanningService } from '../../services/scenario-planning.service';
import { RemediationService } from '../../services/remediation.service';
import { ADMIN_REFUSAL, MEMBER_REFUSAL, Role, RoleGateOrg, createRoleGateHarness } from './role-gate-harness';
import { ensureSharedFixtureTable } from './shared-fixture-tables';

// Forced database failures. Every pg client this file creates -- the app's
// pool included -- runs its queries through here; while `failWhen` matches a
// statement, that statement fails with `failError` instead of running.
let failWhen: ((sql: string) => boolean) | null = null;
let failError: Error = new Error('unset');
const clientQuery = Client.prototype.query;
Client.prototype.query = function (this: Client, ...args: unknown[]) {
  const first = args[0] as { text?: unknown } | string;
  const sql = typeof first === 'string' ? first : typeof first?.text === 'string' ? first.text : '';
  if (failWhen && typeof args[args.length - 1] !== 'function' && failWhen(sql)) {
    return Promise.reject(failError);
  }
  return (clientQuery as (...a: unknown[]) => unknown).apply(this, args);
} as unknown as typeof Client.prototype.query;

const harness = createRoleGateHarness('plan-enforcement');
const { pool, sendAs } = harness;

const ID = '00000000-0000-4000-8000-000000000005';
const SENTINEL = 'SENTINEL-DB-TEXT';
const PLAN_LOOKUP = 'SELECT subscription_tier, billing_lifecycle_state, grace_period_ends_at';
const TIER_FAILURE = { success: false, error: 'Failed to verify subscription tier' };

type Tier = 'free' | 'starter' | 'pro' | 'enterprise';
const RANK: Record<Tier, number> = { free: 0, starter: 1, pro: 2, enterprise: 3 };

let org: RoleGateOrg;
let stubs: Record<string, jest.SpyInstance>;

beforeAll(async () => {
  await ensureSharedFixtureTable(pool, 'tenants');
  org = await harness.buildOrg();
  await harness.listen((app) => {
    app.use('/api/tenants', tenantsRoutes);
    // The same factories, mounted at the same paths, as server.ts.
    app.use('/api/forecast', createForecastRoutes(appPool));
    app.use('/api/remediation', createRemediationRoutes(appPool));
  });
});

beforeEach(() => {
  failWhen = null;
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  stubs = {
    forecast: jest.spyOn(CostForecastService.prototype, 'generateForecast').mockResolvedValue({ id: 'f' } as never),
    analyze: jest.spyOn(ForecastAIService.prototype, 'analyzeForecast').mockImplementation(async (f) => f),
    scenario: jest.spyOn(ScenarioPlanningService.prototype, 'generateScenario').mockResolvedValue({ id: 's' } as never),
    list: jest.spyOn(RemediationService.prototype, 'listWorkflows').mockResolvedValue([] as never),
    get: jest.spyOn(RemediationService.prototype, 'getWorkflowWithAudit').mockResolvedValue({ id: ID } as never),
    approve: jest.spyOn(RemediationService.prototype, 'approve').mockResolvedValue({ id: ID } as never),
    create: jest.spyOn(RemediationService.prototype, 'createWorkflow').mockResolvedValue({ id: ID } as never),
  };
});

afterEach(async () => {
  failWhen = null;
  jest.restoreAllMocks();
  await pool.query('DELETE FROM tenants WHERE organization_id = $1', [org.orgId]);
});

afterAll(async () => {
  failWhen = null;
  await harness.close(async (orgIds) => {
    await pool.query('DELETE FROM tenants WHERE organization_id = ANY($1)', [orgIds]);
  });
  Client.prototype.query = clientQuery;
});

// ─── Plan state ──────────────────────────────────────────────────────────────

interface PlanState {
  tier: string;
  billing?: 'healthy' | 'grace_period' | 'restricted';
  graceEndsInMs?: number;
  /** What the middleware should see; null when the tier is unrecognised. */
  effective: Tier | null;
}

const STATES: Record<string, PlanState> = {
  free: { tier: 'free', effective: 'free' },
  starter: { tier: 'starter', effective: 'starter' },
  pro: { tier: 'pro', effective: 'pro' },
  enterprise: { tier: 'enterprise', effective: 'enterprise' },
  'enterprise, restricted': { tier: 'enterprise', billing: 'restricted', effective: 'free' },
  'enterprise, grace period ended': { tier: 'enterprise', billing: 'grace_period', graceEndsInMs: -60_000, effective: 'free' },
  'enterprise, grace period running': { tier: 'enterprise', billing: 'grace_period', graceEndsInMs: 86_400_000, effective: 'enterprise' },
  'unrecognised tier': { tier: 'team', effective: null },
};

async function setPlan(state: PlanState): Promise<void> {
  await pool.query(
    `UPDATE organizations
        SET subscription_tier = $1, billing_lifecycle_state = $2, grace_period_ends_at = $3
      WHERE id = $4`,
    [
      state.tier,
      state.billing ?? 'healthy',
      state.graceEndsInMs === undefined ? null : new Date(Date.now() + state.graceEndsInMs),
      org.orgId,
    ]
  );
}

// ─── Routes ──────────────────────────────────────────────────────────────────

async function insertTenant(name = 'Before'): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO tenants (organization_id, name, email) VALUES ($1, $2, 'tenant@example.com') RETURNING id`,
    [org.orgId, name]
  );
  return rows[0].id;
}

/** Tenant rows of the org as a comparable snapshot. */
async function tenantRows(): Promise<string> {
  const { rows } = await pool.query(
    'SELECT id, name, email, status, plan FROM tenants WHERE organization_id = $1 ORDER BY id',
    [org.orgId]
  );
  return JSON.stringify(rows);
}

interface RouteCase {
  name: string;
  method: string;
  /** Builds the path (and any fixture it needs). */
  route: () => Promise<string>;
  body?: unknown;
  minimum: Tier;
  ok: number;
  /** Roles the route admits on an entitled plan. */
  roles: Role[];
  /** Did the handler act? */
  acted: (before: string) => Promise<boolean>;
}

const ALL: Role[] = ['viewer', 'member', 'admin', 'owner'];
const ADMINS: Role[] = ['admin', 'owner'];
const changed = async (before: string) => (await tenantRows()) !== before;
const called = (stub: string) => async () => stubs[stub].mock.calls.length > 0;

const ROUTES: RouteCase[] = [
  { name: 'GET /api/tenants', method: 'GET', route: async () => '/tenants', minimum: 'enterprise', ok: 200, roles: ALL, acted: async () => false },
  { name: 'GET /api/tenants/stats', method: 'GET', route: async () => '/tenants/stats', minimum: 'enterprise', ok: 200, roles: ALL, acted: async () => false },
  { name: 'POST /api/tenants', method: 'POST', route: async () => '/tenants', body: { name: 'New', email: 'new@example.com' }, minimum: 'enterprise', ok: 201, roles: ADMINS, acted: changed },
  { name: 'PATCH /api/tenants/:id', method: 'PATCH', route: async () => `/tenants/${await insertTenant()}`, body: { name: 'After' }, minimum: 'enterprise', ok: 200, roles: ADMINS, acted: changed },
  { name: 'DELETE /api/tenants/:id', method: 'DELETE', route: async () => `/tenants/${await insertTenant()}`, minimum: 'enterprise', ok: 200, roles: ADMINS, acted: changed },
  { name: 'GET /api/forecast', method: 'GET', route: async () => '/forecast', minimum: 'pro', ok: 200, roles: ALL, acted: called('forecast') },
  { name: 'POST /api/forecast/scenario', method: 'POST', route: async () => '/forecast/scenario', body: { type: 'traffic_2x', params: {} }, minimum: 'pro', ok: 200, roles: ALL, acted: called('scenario') },
  { name: 'GET /api/remediation', method: 'GET', route: async () => '/remediation', minimum: 'enterprise', ok: 200, roles: ALL, acted: called('list') },
  { name: 'GET /api/remediation/:id', method: 'GET', route: async () => `/remediation/${ID}`, minimum: 'enterprise', ok: 200, roles: ALL, acted: called('get') },
];

/** Sends `rc` as `role`, returning the response, its body text and whether the handler acted. */
async function hit(rc: RouteCase, role: Role) {
  const path = await rc.route();
  const before = await tenantRows();
  const response = await sendAs(org.orgId, org[role], rc.method, path, rc.body);
  const text = await response.text();
  return { status: response.status, text, body: JSON.parse(text), acted: await rc.acted(before) };
}

// ─── A. Plan × route ─────────────────────────────────────────────────────────

describe.each(Object.entries(STATES))('plan: %s', (_label, state) => {
  beforeEach(() => setPlan(state));

  it.each(ROUTES.map((rc) => [rc.name, rc] as const))('%s', async (_name, rc) => {
    const result = await hit(rc, 'owner');

    if (state.effective === null) {
      expect(result.status).toBe(500);
      expect(result.body).toEqual(TIER_FAILURE);
      expect(result.acted).toBe(false);
    } else if (RANK[state.effective] >= RANK[rc.minimum]) {
      expect(result.status).toBe(rc.ok);
      expect(result.body.success).toBe(true);
      if (rc.method !== 'GET') expect(result.acted).toBe(true);
    } else {
      expect(result.status).toBe(402);
      expect(result.body).toMatchObject({
        success: false,
        error: 'Subscription tier insufficient',
        code: 'TIER_REQUIRED',
        details: { currentTier: state.effective, requiredTier: rc.minimum },
        // The upgrade link names the plan the route requires.
        upgrade: { url: `/settings/billing?upgrade=${rc.minimum}` },
      });
      expect(result.acted).toBe(false);
    }
  });
});

// ─── B. Roles are unchanged, and the plan comes first ────────────────────────

describe('roles on an entitled plan are exactly as before', () => {
  beforeEach(() => setPlan(STATES.enterprise));

  const cells = ROUTES.flatMap((rc) => ALL.map((role) => [rc.name, role, rc] as const));

  it.each(cells)('%s as %s', async (_name, role, rc) => {
    const result = await hit(rc, role);
    if (rc.roles.includes(role)) {
      expect(result.status).toBe(rc.ok);
    } else {
      expect(result.status).toBe(403);
      expect(result.body).toEqual({ ...ADMIN_REFUSAL, current: role });
      expect(result.acted).toBe(false);
    }
  });

  it('remediation approval is still owner and admin only', async () => {
    const member = await sendAs(org.orgId, org.member, 'POST', `/remediation/${ID}/approve`, {});
    expect(member.status).toBe(403);
    expect(await member.json()).toEqual({
      success: false,
      error: 'Only admins and owners can approve, reject, execute, or roll back remediation workflows.',
    });
    expect(stubs.approve).not.toHaveBeenCalled();

    const admin = await sendAs(org.orgId, org.admin, 'POST', `/remediation/${ID}/approve`, {});
    expect(admin.status).toBe(200);
    expect(stubs.approve).toHaveBeenCalledTimes(1);
  });

  it('creating a remediation draft still refuses a viewer', async () => {
    const response = await sendAs(org.orgId, org.viewer, 'POST', '/remediation', {});
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ...MEMBER_REFUSAL, current: 'viewer' });
    expect(stubs.create).not.toHaveBeenCalled();
  });
});

describe('below the plan, the plan is refused before the role', () => {
  beforeEach(() => setPlan(STATES.pro));

  it.each([
    ['POST /api/tenants as a viewer', 'viewer', 'POST', '/tenants', { name: 'New', email: 'new@example.com' }],
    ['DELETE /api/tenants/:id as a member', 'member', 'DELETE', `/tenants/${ID}`, undefined],
    ['POST /api/remediation as a viewer', 'viewer', 'POST', '/remediation', {}],
    ['POST /api/remediation/:id/approve as a member', 'member', 'POST', `/remediation/${ID}/approve`, {}],
  ] as const)('%s: 402, not 403', async (_name, role, method, route, body) => {
    const before = await tenantRows();
    const response = await sendAs(org.orgId, org[role as Role], method, route, body);
    expect(response.status).toBe(402);
    expect((await response.json()).code).toBe('TIER_REQUIRED');
    expect(await tenantRows()).toBe(before);
    expect(stubs.create).not.toHaveBeenCalled();
    expect(stubs.approve).not.toHaveBeenCalled();
  });
});

// ─── C. The plan comes from the database only ────────────────────────────────

describe('nothing in the token or the request can raise the plan', () => {
  beforeEach(() => setPlan(STATES.free));

  it.each(ROUTES.map((rc) => [rc.name, rc] as const))('%s', async (_name, rc) => {
    jest.spyOn(authService, 'verifyToken').mockReturnValue({
      userId: org.owner,
      email: 'token-claim@example.com',
      organizationId: org.orgId,
      role: 'owner',
      type: 'access',
      subscriptionTier: 'enterprise',
      tier: 'enterprise',
      plan: 'enterprise',
    } as unknown as ReturnType<typeof authService.verifyToken>);
    const path = await rc.route();
    const before = await tenantRows();
    const sep = path.includes('?') ? '&' : '?';
    const response = await fetch(`${harness.url()}${path}${sep}tier=enterprise&subscriptionTier=enterprise`, {
      method: rc.method,
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
        'X-Subscription-Tier': 'enterprise',
      },
      body: rc.method === 'GET' ? undefined : JSON.stringify({ ...(rc.body as object), subscriptionTier: 'enterprise' }),
    });
    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({ code: 'TIER_REQUIRED', details: { currentTier: 'free' } });
    expect(await rc.acted(before)).toBe(false);
  });

  it('a plan change applies on the next request, with the same token', async () => {
    const rc = ROUTES[0];
    expect((await hit(rc, 'owner')).status).toBe(402);
    await setPlan(STATES.enterprise);
    expect((await hit(rc, 'owner')).status).toBe(200);
    await setPlan(STATES.free);
    expect((await hit(rc, 'owner')).status).toBe(402);
  });
});

// ─── D. A plan that cannot be read admits no one ─────────────────────────────

describe('when the plan lookup fails', () => {
  beforeEach(() => setPlan(STATES.enterprise));

  it.each(ROUTES.map((rc) => [rc.name, rc] as const))('%s fails closed with the generic error', async (_name, rc) => {
    const path = await rc.route();
    const before = await tenantRows();
    failError = new Error(`connection lost ${SENTINEL}`);
    failWhen = (sql) => sql.includes(PLAN_LOOKUP);
    const response = await sendAs(org.orgId, org.owner, rc.method, path, rc.body);
    failWhen = null;
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toEqual(TIER_FAILURE);
    expect(text).not.toContain(SENTINEL);
    expect(await rc.acted(before)).toBe(false);
  });
});

// ─── E. Failures answer generically and are logged on the server ─────────────

/** console.error calls flattened to text, to check what was logged. */
function logged(): string {
  return (console.error as unknown as jest.Mock).mock.calls.map((call) => JSON.stringify(call)).join('\n');
}

describe('tenant failures', () => {
  beforeEach(() => setPlan(STATES.enterprise));

  const FAILURES: Array<[string, string, () => Promise<string>, unknown, string, string, string]> = [
    ['GET /api/tenants', 'GET', async () => '/tenants', undefined, 'FROM tenants', 'Failed to load tenants', 'list'],
    ['GET /api/tenants/stats', 'GET', async () => '/tenants/stats', undefined, 'FROM tenants', 'Failed to load tenant stats', 'stats'],
    ['POST /api/tenants', 'POST', async () => '/tenants', { name: 'New', email: 'new@example.com' }, 'INSERT INTO tenants', 'Failed to create tenant', 'create'],
    ['PATCH /api/tenants/:id', 'PATCH', async () => `/tenants/${await insertTenant()}`, { name: 'After' }, 'UPDATE tenants', 'Failed to update tenant', 'update'],
    ['DELETE /api/tenants/:id', 'DELETE', async () => `/tenants/${await insertTenant()}`, undefined, 'DELETE FROM tenants', 'Failed to delete tenant', 'delete'],
  ];

  it.each(FAILURES)('%s answers with a fixed message', async (_name, method, route, body, statement, message, operation) => {
    const path = await route();
    failError = Object.assign(new Error(`relation "tenants" ${SENTINEL}`), {
      code: 'XX000',
      detail: 'Failing row contains (private-tenant@example.com)',
    });
    failWhen = (sql) => sql.includes(statement);
    const response = await sendAs(org.orgId, org.owner, method, path, body);
    failWhen = null;
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ success: false, error: message });
    expect(text).not.toContain(SENTINEL);

    // Logged on the server: what failed, but not the row the error quotes.
    expect(console.error).toHaveBeenCalledWith(`[Tenants] ${operation} error:`, {
      name: 'Error',
      code: 'XX000',
      message: `relation "tenants" ${SENTINEL}`,
    });
    expect(logged()).not.toContain('private-tenant@example.com');
  });

  it('a real database error (name too long) is not returned', async () => {
    const response = await sendAs(org.orgId, org.owner, 'POST', '/tenants', { name: 'x'.repeat(300), email: 'new@example.com' });
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ success: false, error: 'Failed to create tenant' });
    expect(text).not.toMatch(/too long|character varying/);
    expect(logged()).toMatch(/too long/);
  });

  it.each([
    ['POST with an unknown plan', 'POST', false, { name: 'New', email: 'new@example.com', plan: 'gold' }, 'plan must be one of: free, starter, pro, enterprise'],
    ['PATCH with an unknown plan', 'PATCH', true, { plan: 'gold' }, 'plan must be one of: free, starter, pro, enterprise'],
    ['PATCH with an unknown status', 'PATCH', true, { status: 'archived' }, 'status must be one of: active, inactive'],
  ] as const)('%s is a 400 naming the field, and changes nothing', async (_name, method, needsRow, body, message) => {
    const path = needsRow ? `/tenants/${await insertTenant()}` : '/tenants';
    const before = await tenantRows();
    const response = await sendAs(org.orgId, org.owner, method, path, body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: message });
    expect(await tenantRows()).toBe(before);
  });

  it.each([
    ['POST', false, { name: 'New', email: 'new@example.com', plan: 'starter' }],
    ['PATCH', true, { plan: 'pro', status: 'inactive' }],
  ] as const)('%s with valid plan and status values still succeeds', async (method, needsRow, body) => {
    const path = needsRow ? `/tenants/${await insertTenant()}` : '/tenants';
    const response = await sendAs(org.orgId, org.owner, method, path, body);
    expect(response.status).toBe(method === 'POST' ? 201 : 200);
  });
});

describe('forecast failures', () => {
  const AWS_TEXT = `User: arn:aws:iam::123456789012:role/reader is not authorized ${SENTINEL}`;

  beforeEach(() => setPlan(STATES.pro));

  it.each([
    ['GET /api/forecast', 'GET', '/forecast', undefined, 'forecast', 'Failed to generate forecast', 'Error'],
    ['POST /api/forecast/scenario', 'POST', '/forecast/scenario', { type: 'traffic_2x' }, 'scenario', 'Failed to generate scenario', 'Scenario error'],
  ] as const)('%s answers with a fixed message', async (_name, method, route, body, stub, message, label) => {
    stubs[stub].mockRejectedValue(Object.assign(new Error(AWS_TEXT), { name: 'AccessDeniedException' }));
    const response = await sendAs(org.orgId, org.owner, method, route, body);
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ success: false, error: message });
    expect(text).not.toMatch(/arn:|123456789012|SENTINEL/);
    expect(console.error).toHaveBeenCalledWith(`[Forecast Controller] ${label}:`, {
      name: 'AccessDeniedException',
      code: undefined,
      message: AWS_TEXT,
    });
  });

  it('a scenario without a type is a 400 in the usual shape', async () => {
    const response = await sendAs(org.orgId, org.owner, 'POST', '/forecast/scenario', {});
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: 'Scenario type required' });
    expect(stubs.scenario).not.toHaveBeenCalled();
  });
});
