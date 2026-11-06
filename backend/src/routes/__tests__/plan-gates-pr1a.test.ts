/**
 * Plan gates for DORA metrics, custom DORA benchmarks and Security Hub
 * (PLAN_ENTITLEMENTS, config/plan-entitlements.ts):
 *
 *   - DORA metrics (GET /api/metrics/dora): Pro and above.
 *   - Custom DORA benchmarks (/api/dora/benchmarks, reads included): Enterprise.
 *     Saved benchmarks are applied to DORA results only on Enterprise; below it
 *     they are kept but not applied.
 *   - GET /api/deployments/stats: every plan gets the counts and the last
 *     deployment; change_failure_rate (a DORA metric) only from Pro.
 *   - Security Hub status, sync, and the CIS / PCI DSS / NIST views: Pro and
 *     above, each its own entry. Custom compliance frameworks and SOC 2
 *     customer evidence stay Enterprise.
 *
 * The plan is read from the organization row on every request: a restricted
 * organization, or one whose grace period has ended, is free. The plan is
 * checked before the role, and never instead of it. The expected plans below
 * are written out, not read from PLAN_ENTITLEMENTS, so a change to the table
 * fails this suite.
 *
 * Real routes, real authentication and the real plan middleware against
 * Postgres (role-gate-harness.ts). Only the Security Hub evaluators, the sync,
 * and the custom-framework / customer-evidence reads are stubbed.
 */
import { Client } from 'pg';
import doraMetricsRoutes from '../dora-metrics.routes';
import { createDoraBenchmarksRoutes } from '../dora-benchmarks.routes';
import deploymentsRoutes from '../deployments.routes';
import securityHubRoutes from '../security-hub.routes';
import complianceFrameworksRoutes from '../compliance-frameworks.routes';
import soc2CustomerEvidenceRoutes from '../soc2-customer-evidence.routes';
import { pool as appPool } from '../../config/database';
import { PLAN_ENTITLEMENTS } from '../../config/plan-entitlements';
import { DORAMetricsService } from '../../services/dora-metrics.service';
import { DORAMetricsRepository } from '../../repositories/dora-metrics.repository';
import { SecurityHubSyncService } from '../../services/security-hub-sync.service';
import { SecurityHubComplianceService } from '../../services/security-hub-compliance.service';
import { ComplianceFrameworksRepository } from '../../repositories/compliance-frameworks.repository';
import { Soc2CustomerEvidenceService } from '../../services/soc2-customer-evidence.service';
import { ADMIN_REFUSAL, MEMBER_REFUSAL, Role, RoleGateOrg, createRoleGateHarness } from './role-gate-harness';
import { ensureSharedFixtureTable } from './shared-fixture-tables';

jest.mock('../../services/onboardingEvents', () => ({ emitOnboardingEvent: jest.fn() }));

// Forced database failures, as in plan-server-enforcement.test.ts: while
// `failWhen` matches a statement, it fails instead of running.
let failWhen: ((sql: string) => boolean) | null = null;
const clientQuery = Client.prototype.query;
Client.prototype.query = function (this: Client, ...args: unknown[]) {
  const first = args[0] as { text?: unknown } | string;
  const sql = typeof first === 'string' ? first : typeof first?.text === 'string' ? first.text : '';
  if (failWhen && typeof args[args.length - 1] !== 'function' && failWhen(sql)) {
    return Promise.reject(new Error('forced plan lookup failure'));
  }
  return (clientQuery as (...a: unknown[]) => unknown).apply(this, args);
} as unknown as typeof Client.prototype.query;

const harness = createRoleGateHarness('plan-gates-1a');
const { pool, sendAs } = harness;

const PLAN_LOOKUP = 'SELECT subscription_tier, billing_lifecycle_state, grace_period_ends_at';
const TIER_FAILURE = { success: false, error: 'Failed to verify subscription tier' };

type Tier = 'free' | 'starter' | 'pro' | 'enterprise';
const RANK: Record<Tier, number> = { free: 0, starter: 1, pro: 2, enterprise: 3 };

let org: RoleGateOrg;
let serviceId: string;
let stubs: Record<string, jest.SpyInstance>;

beforeAll(async () => {
  await ensureSharedFixtureTable(pool, 'custom_dora_benchmarks');
  org = await harness.buildOrg();
  const service = await pool.query(
    `INSERT INTO services (name, template, owner, status, organization_id)
     VALUES ($1, 'api', 'owner@example.com', 'active', $2) RETURNING id`,
    [`plan-gates-svc-${Date.now()}`, org.orgId]
  );
  serviceId = service.rows[0].id;
  await harness.listen((app) => {
    // The same routers and factories, mounted at the same paths, as server.ts / routes/index.ts.
    app.use('/api/metrics/dora', doraMetricsRoutes);
    app.use('/api/dora', createDoraBenchmarksRoutes(appPool));
    app.use('/api/deployments', deploymentsRoutes);
    app.use('/api/security-hub', securityHubRoutes);
    app.use('/api/compliance-frameworks', complianceFrameworksRoutes);
    app.use('/api/soc2/customer-evidence', soc2CustomerEvidenceRoutes);
  });
});

beforeEach(() => {
  failWhen = null;
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  const readiness = (framework: string) => ({ framework }) as never;
  stubs = {
    sync: jest.spyOn(SecurityHubSyncService.prototype, 'sync').mockResolvedValue({ status: 'stubbed' } as never),
    cis: jest.spyOn(SecurityHubComplianceService.prototype, 'evaluateCis').mockResolvedValue(readiness('cis')),
    pci: jest.spyOn(SecurityHubComplianceService.prototype, 'evaluatePci').mockResolvedValue(readiness('pci')),
    nist: jest.spyOn(SecurityHubComplianceService.prototype, 'evaluateNist').mockResolvedValue(readiness('nist')),
    frameworks: jest.spyOn(ComplianceFrameworksRepository.prototype, 'findAllFrameworks').mockResolvedValue([] as never),
    evidence: jest.spyOn(Soc2CustomerEvidenceService.prototype, 'listCustomerEvidence').mockResolvedValue([] as never),
  };
});

afterEach(async () => {
  failWhen = null;
  jest.restoreAllMocks();
  await pool.query('DELETE FROM custom_dora_benchmarks WHERE organization_id = $1', [org.orgId]);
  await pool.query('DELETE FROM deployments WHERE organization_id = $1', [org.orgId]);
});

afterAll(async () => {
  failWhen = null;
  await harness.close(async (orgIds) => {
    await pool.query('DELETE FROM custom_dora_benchmarks WHERE organization_id = ANY($1)', [orgIds]);
    await pool.query('DELETE FROM deployments WHERE organization_id = ANY($1)', [orgIds]);
    await pool.query('DELETE FROM services WHERE organization_id = ANY($1)', [orgIds]);
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

// ─── Fixtures ────────────────────────────────────────────────────────────────

async function insertDeployment(status: 'success' | 'failed', hoursAgo = 1): Promise<void> {
  const at = new Date(Date.now() - hoursAgo * 3_600_000);
  await pool.query(
    `INSERT INTO deployments
       (service_id, environment, aws_region, status, cost_estimate, deployed_by, deployed_at, created_at, organization_id)
     VALUES ($1, 'production', 'us-east-1', $2, 0, 'github-actions', $3, $3, $4)`,
    [serviceId, status, at, org.orgId]
  );
}

async function insertBenchmark(metric: string, value: number, unit: string, label = 'Team target'): Promise<void> {
  await pool.query(
    `INSERT INTO custom_dora_benchmarks (organization_id, metric_name, target_value, target_unit, performance_label)
     VALUES ($1, $2, $3, $4, $5)`,
    [org.orgId, metric, value, unit, label]
  );
}

async function benchmarkCount(): Promise<number> {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM custom_dora_benchmarks WHERE organization_id = $1', [org.orgId]);
  return rows[0].n;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

interface RouteCase {
  name: string;
  method: string;
  route: string;
  body?: unknown;
  /** The founder's tier for this surface -- written out, never read from PLAN_ENTITLEMENTS. */
  minimum: Tier;
  /** Set up whatever the route acts on. */
  prepare?: () => Promise<void>;
  /** Did the handler act? Only where the suite can observe it. */
  acted?: () => Promise<boolean>;
}

const called = (stub: string) => async () => stubs[stub].mock.calls.length > 0;

const ROUTES: RouteCase[] = [
  // DORA
  { name: 'GET /api/metrics/dora', method: 'GET', route: '/metrics/dora', minimum: 'pro' },
  { name: 'GET /api/dora/benchmarks', method: 'GET', route: '/dora/benchmarks', minimum: 'enterprise' },
  {
    name: 'POST /api/dora/benchmarks', method: 'POST', route: '/dora/benchmarks', body: { metric_name: 'lead_time', target_value: 4 },
    minimum: 'enterprise', acted: async () => (await benchmarkCount()) === 1,
  },
  {
    name: 'DELETE /api/dora/benchmarks/:metric', method: 'DELETE', route: '/dora/benchmarks/lead_time',
    minimum: 'enterprise', prepare: () => insertBenchmark('lead_time', 4, 'hours'), acted: async () => (await benchmarkCount()) === 0,
  },
  // Security Hub: status, sync, and each standard's view
  { name: 'GET /api/security-hub/capability', method: 'GET', route: '/security-hub/capability', minimum: 'pro' },
  { name: 'POST /api/security-hub/sync', method: 'POST', route: '/security-hub/sync', minimum: 'pro', acted: called('sync') },
  { name: 'GET /api/security-hub/frameworks/cis', method: 'GET', route: '/security-hub/frameworks/cis', minimum: 'pro', acted: called('cis') },
  { name: 'GET /api/security-hub/frameworks/pci', method: 'GET', route: '/security-hub/frameworks/pci', minimum: 'pro', acted: called('pci') },
  { name: 'GET /api/security-hub/frameworks/nist', method: 'GET', route: '/security-hub/frameworks/nist', minimum: 'pro', acted: called('nist') },
  // Unchanged Enterprise surfaces (regression)
  { name: 'GET /api/compliance-frameworks', method: 'GET', route: '/compliance-frameworks', minimum: 'enterprise', acted: called('frameworks') },
  { name: 'GET /api/soc2/customer-evidence', method: 'GET', route: '/soc2/customer-evidence', minimum: 'enterprise', acted: called('evidence') },
];

async function hit(rc: RouteCase, role: Role = 'owner') {
  if (rc.prepare) await rc.prepare();
  const response = await sendAs(org.orgId, org[role], rc.method, `${rc.route}`, rc.body);
  const text = await response.text();
  return { status: response.status, body: JSON.parse(text), acted: rc.acted ? await rc.acted() : null };
}

// ─── A. The table is the founder's matrix ────────────────────────────────────

describe('PLAN_ENTITLEMENTS', () => {
  it('is exactly the agreed plan for each surface', () => {
    expect(PLAN_ENTITLEMENTS).toEqual({
      doraMetrics: 'pro',
      doraCustomBenchmarks: 'enterprise',
      securityHubStatus: 'pro',
      securityHubSync: 'pro',
      securityHubCis: 'pro',
      securityHubPci: 'pro',
      securityHubNist: 'pro',
      // AI truth PR 2: the two existing route gates the AI evidence registry
      // reads, registered at their unchanged tiers (founder decision).
      riskScore: 'pro',
      complianceFrameworks: 'enterprise',
    });
  });
});

// ─── B. Plan × route ─────────────────────────────────────────────────────────

describe.each(Object.entries(STATES))('plan: %s', (_label, state) => {
  beforeEach(() => setPlan(state));

  it.each(ROUTES.map((rc) => [rc.name, rc] as const))('%s', async (_name, rc) => {
    const result = await hit(rc);

    if (state.effective === null) {
      expect(result.status).toBe(500);
      expect(result.body).toEqual(TIER_FAILURE);
      if (rc.acted) expect(result.acted).toBe(false);
    } else if (RANK[state.effective] >= RANK[rc.minimum]) {
      expect(result.status).toBe(200);
      expect(result.body.success).toBe(true);
      if (rc.acted) expect(result.acted).toBe(true);
    } else {
      expect(result.status).toBe(402);
      expect(result.body).toEqual({
        success: false,
        error: 'Subscription tier insufficient',
        code: 'TIER_REQUIRED',
        details: {
          currentTier: state.effective,
          requiredTier: rc.minimum,
          message: `This feature requires a ${rc.minimum} subscription or higher.`,
        },
        upgrade: {
          cta: expect.any(String),
          url: `/settings/billing?upgrade=${rc.minimum}`,
          nextTier: expect.anything(),
        },
      });
      if (rc.acted) expect(result.acted).toBe(false);
    }
  });
});

// ─── C. Roles are unchanged, and the plan comes first ────────────────────────

describe('roles on an entitled plan are exactly as before', () => {
  beforeEach(() => setPlan(STATES.enterprise));

  it('Security Hub sync is still owner and admin only', async () => {
    for (const role of ['viewer', 'member'] as const) {
      const response = await sendAs(org.orgId, org[role], 'POST', '/security-hub/sync');
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ ...ADMIN_REFUSAL, current: role });
    }
    expect(stubs.sync).not.toHaveBeenCalled();
    expect((await sendAs(org.orgId, org.admin, 'POST', '/security-hub/sync')).status).toBe(200);
    expect(stubs.sync).toHaveBeenCalledTimes(1);
  });

  it('saving or resetting a benchmark is still member or above', async () => {
    const save = await sendAs(org.orgId, org.viewer, 'POST', '/dora/benchmarks', { metric_name: 'lead_time', target_value: 4 });
    expect(save.status).toBe(403);
    expect(await save.json()).toEqual({ ...MEMBER_REFUSAL, current: 'viewer' });
    const reset = await sendAs(org.orgId, org.viewer, 'DELETE', '/dora/benchmarks/lead_time');
    expect(reset.status).toBe(403);
    expect(await benchmarkCount()).toBe(0);
  });

  it.each(['viewer', 'member', 'admin', 'owner'] as const)('reads stay open to every role (%s)', async (role) => {
    for (const route of ['/metrics/dora', '/dora/benchmarks', '/security-hub/capability', '/security-hub/frameworks/cis']) {
      expect([route, (await sendAs(org.orgId, org[role], 'GET', route)).status]).toEqual([route, 200]);
    }
  });
});

describe('below the plan, the plan is refused before the role', () => {
  it.each([
    ['free', 'POST /api/security-hub/sync as a member', 'member', 'POST', '/security-hub/sync', undefined],
    ['starter', 'POST /api/security-hub/sync as a viewer', 'viewer', 'POST', '/security-hub/sync', undefined],
    ['pro', 'POST /api/dora/benchmarks as a viewer', 'viewer', 'POST', '/dora/benchmarks', { metric_name: 'lead_time', target_value: 4 }],
    ['pro', 'DELETE /api/dora/benchmarks/:metric as a viewer', 'viewer', 'DELETE', '/dora/benchmarks/lead_time', undefined],
  ] as const)('on %s, %s: 402, not 403', async (tier, _name, role, method, route, body) => {
    await setPlan(STATES[tier]);
    const response = await sendAs(org.orgId, org[role as Role], method, route, body);
    expect(response.status).toBe(402);
    expect((await response.json()).code).toBe('TIER_REQUIRED');
    expect(stubs.sync).not.toHaveBeenCalled();
    expect(await benchmarkCount()).toBe(0);
  });
});

describe('an unknown Security Hub framework', () => {
  it.each(Object.keys(STATES).filter((s) => STATES[s].effective !== null))('is a 400 on %s, and nothing is evaluated', async (label) => {
    await setPlan(STATES[label]);
    const response = await sendAs(org.orgId, org.owner, 'GET', '/security-hub/frameworks/hipaa');
    expect(response.status).toBe(400);
    expect(stubs.cis).not.toHaveBeenCalled();
    expect(stubs.pci).not.toHaveBeenCalled();
    expect(stubs.nist).not.toHaveBeenCalled();
  });
});

describe('the plan comes from the database only', () => {
  it('a plan change applies on the next request, with the same token', async () => {
    await setPlan(STATES.starter);
    expect((await sendAs(org.orgId, org.owner, 'GET', '/metrics/dora')).status).toBe(402);
    await setPlan(STATES.pro);
    expect((await sendAs(org.orgId, org.owner, 'GET', '/metrics/dora')).status).toBe(200);
    await setPlan(STATES.free);
    expect((await sendAs(org.orgId, org.owner, 'GET', '/security-hub/capability')).status).toBe(402);
  });

  it('a plan that cannot be read admits no one', async () => {
    await setPlan(STATES.enterprise);
    failWhen = (sql) => sql.includes(PLAN_LOOKUP);
    for (const route of ['/metrics/dora', '/dora/benchmarks', '/security-hub/capability', '/security-hub/frameworks/pci']) {
      const response = await sendAs(org.orgId, org.owner, 'GET', route);
      expect([route, response.status]).toEqual([route, 500]);
      expect(await response.json()).toEqual(TIER_FAILURE);
    }
    expect(stubs.pci).not.toHaveBeenCalled();
  });
});

// ─── D. Saved benchmarks are applied only on Enterprise ─────────────────────

describe('custom DORA benchmarks in DORA results', () => {
  // 9 succeeded, 1 failed in the window: 0.3/day and a 10% change failure rate.
  // The saved targets would grade both differently from the industry tables.
  beforeEach(async () => {
    for (let i = 0; i < 9; i++) await insertDeployment('success', i + 1);
    await insertDeployment('failed', 12);
    await insertBenchmark('deployment_frequency', 100, 'per_day', 'Team target');
    await insertBenchmark('change_failure_rate', 1, 'percentage', 'Team target');
  });

  const direct = () =>
    new DORAMetricsService(new DORAMetricsRepository(appPool), appPool).getComprehensiveMetrics({ organizationId: org.orgId, dateRange: '30d' });

  it('on Enterprise, GET /api/metrics/dora grades against the saved targets', async () => {
    await setPlan(STATES.enterprise);
    const response = await sendAs(org.orgId, org.owner, 'GET', '/metrics/dora');
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.deploymentFrequency.isCustomBenchmark).toBe(true);
    expect(data.changeFailureRate.isCustomBenchmark).toBe(true);
  });

  it('after a downgrade to Pro, the same request uses the industry benchmarks and the saved rows are kept', async () => {
    await setPlan(STATES.enterprise);
    const before = await (await sendAs(org.orgId, org.owner, 'GET', '/metrics/dora')).json();
    await setPlan(STATES.pro);
    const response = await sendAs(org.orgId, org.owner, 'GET', '/metrics/dora');
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.deploymentFrequency.isCustomBenchmark).toBe(false);
    expect(data.changeFailureRate.isCustomBenchmark).toBe(false);
    // Same measurements; only the grading changed.
    expect(data.deploymentFrequency.value).toBe(before.data.deploymentFrequency.value);
    expect(data.changeFailureRate.value).toBe(before.data.changeFailureRate.value);
    expect(await benchmarkCount()).toBe(2);

    // Back on Enterprise, the kept targets apply again.
    await setPlan(STATES.enterprise);
    const again = await (await sendAs(org.orgId, org.owner, 'GET', '/metrics/dora')).json();
    expect(again.data.deploymentFrequency.isCustomBenchmark).toBe(true);
  });

  it.each(['free', 'starter', 'pro', 'enterprise, restricted', 'enterprise, grace period ended', 'unrecognised tier'])(
    'on %s, the service applies none of them (any caller of DORAMetricsService) and the rows stay',
    async (label) => {
      await setPlan(STATES[label]);
      const metrics = await direct();
      expect(metrics.deploymentFrequency.tracked && metrics.deploymentFrequency.isCustomBenchmark).toBe(false);
      expect(metrics.changeFailureRate.tracked && metrics.changeFailureRate.isCustomBenchmark).toBe(false);
      expect(await benchmarkCount()).toBe(2);
    }
  );

  it('on Enterprise with a running grace period, the service applies them', async () => {
    await setPlan(STATES['enterprise, grace period running']);
    const metrics = await direct();
    expect(metrics.deploymentFrequency.tracked && metrics.deploymentFrequency.isCustomBenchmark).toBe(true);
  });

  it('if the plan cannot be read, the industry benchmarks are used', async () => {
    await setPlan(STATES.enterprise);
    // The service's own pool fails the plan lookup and serves everything else.
    const failingPlanLookup = {
      query: (text: string, values?: unknown[]) =>
        text.includes(PLAN_LOOKUP) ? Promise.reject(new Error('forced plan lookup failure')) : appPool.query(text, values),
    } as unknown as typeof appPool;
    const metrics = await new DORAMetricsService(new DORAMetricsRepository(appPool), failingPlanLookup)
      .getComprehensiveMetrics({ organizationId: org.orgId, dateRange: '30d' });
    expect(metrics.deploymentFrequency.tracked && metrics.deploymentFrequency.isCustomBenchmark).toBe(false);
  });
});

// ─── E. /api/deployments/stats: counts for every plan, the DORA field from Pro ─

describe('GET /api/deployments/stats', () => {
  beforeEach(async () => {
    for (let i = 0; i < 3; i++) await insertDeployment('success', i + 1);
    await insertDeployment('failed', 5);
  });

  const counts = (stats: Record<string, unknown>) => {
    const rest = { ...stats };
    delete rest.change_failure_rate;
    return rest;
  };

  it.each(Object.entries(STATES))('on %s', async (_label, state) => {
    await setPlan(state);
    const response = await sendAs(org.orgId, org.viewer, 'GET', '/deployments/stats');
    // The Deployments page's data is served on every plan.
    expect(response.status).toBe(200);
    const { stats } = await response.json();
    expect(stats).toMatchObject({ window_days: 30, total: 4, success: 3, failed: 1, organization_has_deployments: true });
    expect(stats.last_deployment).toMatchObject({ status: 'success' });

    if (state.effective !== null && RANK[state.effective] >= RANK.pro) {
      expect(stats.change_failure_rate).toBe(25);
    } else {
      expect(stats).not.toHaveProperty('change_failure_rate');
    }
  });

  it('the counts are the same on every plan', async () => {
    await setPlan(STATES.free);
    const free = (await (await sendAs(org.orgId, org.viewer, 'GET', '/deployments/stats')).json()).stats;
    await setPlan(STATES.enterprise);
    const enterprise = (await (await sendAs(org.orgId, org.viewer, 'GET', '/deployments/stats')).json()).stats;
    expect(counts(free)).toEqual(counts(enterprise));
  });

  it('if the plan cannot be read, the counts are still served and the DORA field is left out', async () => {
    await setPlan(STATES.enterprise);
    failWhen = (sql) => sql.includes(PLAN_LOOKUP);
    const response = await sendAs(org.orgId, org.viewer, 'GET', '/deployments/stats');
    expect(response.status).toBe(200);
    const { stats } = await response.json();
    expect(stats.total).toBe(4);
    expect(stats).not.toHaveProperty('change_failure_rate');
  });
});
