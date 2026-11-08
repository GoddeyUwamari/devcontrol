/**
 * Billing safety PR B, at the routes, against Postgres:
 *
 *   B3. The organization responses the UI loads (GET /api/auth/me,
 *       GET /api/organizations, login, organization creation) report
 *       `effectiveTier` and `entitlementHold` from the one decision
 *       (entitlementOf), and the real plan gate decides the same.
 *   B4. A 402 TIER_REQUIRED carries details.reason only when the stored plan
 *       would include the feature, the effective one does not, and a billing
 *       hold is why.
 *   BS-Q10. The rate limiter, /usage, scheduled reports and AWS discovery's
 *       resource types follow the effective tier, not the stored one.
 *       (/usage through its controller: its api_usage table is not in the
 *       CI schema.)
 *   Cross-org: one organization's hold never reaches another.
 *
 * Real routes, authentication and plan middleware (role-gate-harness.ts).
 * No Stripe call: these rows are written directly. Subscription ids are test
 * placeholders. Expected tiers and reasons are written out.
 */
jest.mock('../../services/onboardingEvents', () => ({ emitOnboardingEvent: jest.fn() }));

import bcrypt from 'bcrypt';
import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import authRoutes from '../auth.routes';
import organizationsRoutes from '../organizations.routes';
import doraMetricsRoutes from '../dora-metrics.routes';
import { UsageController } from '../../controllers/usage.controller';
import { pool as appPool } from '../../config/database';
import { authService } from '../../services/auth.service';
import { authenticateToken } from '../../middleware/auth.middleware';
import { requireEnterprise } from '../../middleware/subscription.middleware';
import { apiRateLimiter } from '../../middleware/rateLimiter';
import { ScheduledReportsService } from '../../services/scheduled-reports.service';
import { AWSResourceDiscoveryService } from '../../services/awsResourceDiscovery';
import { RoleGateOrg, createRoleGateHarness } from './role-gate-harness';

const PASSWORD = 'Entitlement-Test-Password-1';
const harness = createRoleGateHarness('billing-entitlement');
const { pool, sendAs } = harness;

let counter = 0;
const placeholderSubscription = () => `sub_test_entitlement_${Date.now()}_${++counter}`;

interface OrgState {
  tier: string;
  /** null: no recorded subscription (hand-provisioned). */
  subscription: boolean;
  status: string | null;
  billing?: 'healthy' | 'grace_period' | 'restricted';
  graceEndsInMs?: number;
}

async function setState(orgId: string, state: OrgState): Promise<void> {
  await pool.query(
    `UPDATE organizations
        SET subscription_tier = $1, subscription_status = $2, stripe_subscription_id = $3,
            billing_lifecycle_state = $4, grace_period_ends_at = $5
      WHERE id = $6`,
    [
      state.tier,
      state.status,
      state.subscription ? placeholderSubscription() : null,
      state.billing ?? 'healthy',
      state.graceEndsInMs === undefined ? null : new Date(Date.now() + state.graceEndsInMs),
      orgId,
    ]
  );
}

// name -> [state, effective tier, hold]
const CASES: Record<string, [OrgState, string, string | null]> = {
  'pro, active': [{ tier: 'pro', subscription: true, status: 'active' }, 'pro', null],
  'pro, trialing': [{ tier: 'pro', subscription: true, status: 'trialing' }, 'pro', null],
  'pro, past_due, no grace recorded': [{ tier: 'pro', subscription: true, status: 'past_due' }, 'pro', null],
  'pro, past_due, grace running': [{ tier: 'pro', subscription: true, status: 'past_due', billing: 'grace_period', graceEndsInMs: 3_600_000 }, 'pro', null],
  'pro, past_due, grace ended': [{ tier: 'pro', subscription: true, status: 'past_due', billing: 'grace_period', graceEndsInMs: -60_000 }, 'free', 'payment'],
  'pro, unpaid, grace running': [{ tier: 'pro', subscription: true, status: 'unpaid', billing: 'grace_period', graceEndsInMs: 3_600_000 }, 'pro', null],
  'pro, unpaid, no grace': [{ tier: 'pro', subscription: true, status: 'unpaid' }, 'free', 'payment'],
  'pro, unpaid, restricted': [{ tier: 'pro', subscription: true, status: 'unpaid', billing: 'restricted' }, 'free', 'payment'],
  'pro, incomplete': [{ tier: 'pro', subscription: true, status: 'incomplete' }, 'free', 'subscription_inactive'],
  'pro, paused': [{ tier: 'pro', subscription: true, status: 'paused' }, 'free', 'subscription_inactive'],
  'pro, canceled (paid tier left by a late event)': [{ tier: 'pro', subscription: true, status: 'canceled' }, 'free', null],
  'pro, incomplete_expired': [{ tier: 'pro', subscription: true, status: 'incomplete_expired' }, 'free', null],
  'pro, unrecognised status': [{ tier: 'pro', subscription: true, status: 'some_future_status' }, 'pro', null],
  'starter, restricted': [{ tier: 'starter', subscription: true, status: 'active', billing: 'restricted' }, 'free', 'payment'],
  'enterprise, unpaid, no grace': [{ tier: 'enterprise', subscription: true, status: 'unpaid' }, 'free', 'payment'],
  // The three hand-provisioned paid organizations in production: no subscription.
  'hand-provisioned enterprise + active': [{ tier: 'enterprise', subscription: false, status: 'active' }, 'enterprise', null],
  'hand-provisioned enterprise + free': [{ tier: 'enterprise', subscription: false, status: 'free' }, 'enterprise', null],
  'hand-provisioned pro + free': [{ tier: 'pro', subscription: false, status: 'free' }, 'pro', null],
  'free, no subscription': [{ tier: 'free', subscription: false, status: 'free' }, 'free', null],
};
const NAMES = Object.keys(CASES);

let org: RoleGateOrg;
let other: RoleGateOrg;

beforeAll(async () => {
  org = await harness.buildOrg();
  other = await harness.buildOrg();
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, org.owner]);
  await harness.listen((app) => {
    app.use('/api/auth', authRoutes);
    app.use('/api/organizations', organizationsRoutes);
    app.use('/api/metrics/dora', doraMetricsRoutes);
    app.get('/api/test-gates/enterprise', authenticateToken, requireEnterprise, (_req, res) => {
      res.json({ success: true });
    });
  });
});

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await harness.close(async (orgIds, userIds) => {
    await pool.query('DELETE FROM sessions WHERE user_id = ANY($1)', [userIds]);
    // Organizations created through POST /organizations by the suite's owner.
    const created = await pool.query(
      `SELECT organization_id FROM organization_memberships
        WHERE user_id = ANY($1) AND NOT (organization_id = ANY($2))`,
      [userIds, orgIds]
    );
    const extra = created.rows.map((r) => r.organization_id);
    if (extra.length > 0) {
      await pool.query('DELETE FROM organization_memberships WHERE organization_id = ANY($1)', [extra]);
      await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [extra]);
    }
  });
});

// ─── B3: effectiveTier + entitlementHold ─────────────────────────────────────

describe('B3/B4: effectiveTier and entitlementHold on the organization responses', () => {
  it.each(NAMES)('%s: GET /api/auth/me', async (name) => {
    const [state, effective, hold] = CASES[name];
    await setState(org.orgId, state);
    const res = await sendAs(org.orgId, org.owner, 'GET', '/auth/me');
    expect(res.status).toBe(200);
    const orgs = (await res.json()).data.organizations;
    expect(orgs[0]).toMatchObject({ id: org.orgId, subscriptionTier: state.tier, effectiveTier: effective, entitlementHold: hold });
  });

  it.each(NAMES)('%s: GET /api/organizations', async (name) => {
    const [state, effective, hold] = CASES[name];
    await setState(org.orgId, state);
    const res = await sendAs(org.orgId, org.owner, 'GET', '/organizations');
    expect(res.status).toBe(200);
    const row = (await res.json()).data.find((o: any) => o.id === org.orgId);
    expect(row).toMatchObject({ subscriptionTier: state.tier, effectiveTier: effective, entitlementHold: hold });
  });

  it.each(NAMES)('%s: login', async (name) => {
    const [state, effective, hold] = CASES[name];
    await setState(org.orgId, state);
    const login = await authService.login(org.emails.owner, PASSWORD);
    expect(login.organization).toMatchObject({ id: org.orgId, subscriptionTier: state.tier, effectiveTier: effective, entitlementHold: hold });
  });

  it('organization creation reports a new organization as free with no hold', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const res = await sendAs(org.orgId, org.owner, 'POST', '/organizations', {
      name: `Entitlement Created ${suffix}`,
      slug: `entitlement-created-${suffix}`,
      displayName: `Entitlement Created ${suffix}`,
    });
    expect(res.status).toBeLessThan(300);
    const created = (await res.json()).data;
    expect(created).toMatchObject({ subscriptionTier: 'free', effectiveTier: 'free', entitlementHold: null });
  });

  it.each(NAMES)('%s: the real Pro gate (GET /api/metrics/dora) decides what effectiveTier says', async (name) => {
    const [state, effective] = CASES[name];
    await setState(org.orgId, state);
    const res = await sendAs(org.orgId, org.owner, 'GET', '/metrics/dora');
    const allowed = effective === 'pro' || effective === 'enterprise';
    expect(res.status).toBe(allowed ? 200 : 402);
  });

  it('reading never rewrites the stored tier or the subscription columns', async () => {
    await setState(org.orgId, CASES['pro, unpaid, no grace'][0]);
    const before = await pool.query('SELECT subscription_tier, subscription_status, stripe_subscription_id FROM organizations WHERE id = $1', [org.orgId]);
    await sendAs(org.orgId, org.owner, 'GET', '/auth/me');
    await sendAs(org.orgId, org.owner, 'GET', '/metrics/dora');
    const after = await pool.query('SELECT subscription_tier, subscription_status, stripe_subscription_id FROM organizations WHERE id = $1', [org.orgId]);
    expect(after.rows[0]).toEqual(before.rows[0]);
  });
});

// ─── B4: the 402 reason ──────────────────────────────────────────────────────

describe('B4: details.reason on 402 TIER_REQUIRED only when paying would unlock the feature', () => {
  // [case, route, reason or null (no reason key at all)]
  const REFUSALS: Array<[string, string, string | null]> = [
    ['pro, unpaid, no grace', '/metrics/dora', 'BILLING_RESTRICTED'],
    ['pro, unpaid, restricted', '/metrics/dora', 'BILLING_RESTRICTED'],
    ['pro, past_due, grace ended', '/metrics/dora', 'BILLING_RESTRICTED'],
    ['pro, incomplete', '/metrics/dora', 'SUBSCRIPTION_INACTIVE'],
    ['pro, paused', '/metrics/dora', 'SUBSCRIPTION_INACTIVE'],
    ['enterprise, unpaid, no grace', '/test-gates/enterprise', 'BILLING_RESTRICTED'],
    // Paying would not unlock these: the plan itself is too low, or the
    // subscription has ended.
    ['starter, restricted', '/metrics/dora', null],
    ['pro, unpaid, no grace', '/test-gates/enterprise', null],
    ['pro, active', '/test-gates/enterprise', null],
    ['pro, canceled (paid tier left by a late event)', '/metrics/dora', null],
    ['pro, incomplete_expired', '/metrics/dora', null],
    ['free, no subscription', '/metrics/dora', null],
    ['hand-provisioned pro + free', '/test-gates/enterprise', null],
  ];

  it.each(REFUSALS)('%s on %s: reason %s', async (name, route, reason) => {
    await setState(org.orgId, CASES[name][0]);
    const res = await sendAs(org.orgId, org.owner, 'GET', route);
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.code).toBe('TIER_REQUIRED');
    expect(body.details.currentTier).toBe(CASES[name][1]);
    if (reason === null) expect(body.details).not.toHaveProperty('reason');
    else expect(body.details.reason).toBe(reason);
  });

  it('the stored plan is never named in the 402 for a hold (currentTier is the enforced tier)', async () => {
    await setState(org.orgId, CASES['enterprise, unpaid, no grace'][0]);
    const body = await (await sendAs(org.orgId, org.owner, 'GET', '/test-gates/enterprise')).json();
    expect(body.details).toMatchObject({ currentTier: 'free', requiredTier: 'enterprise', reason: 'BILLING_RESTRICTED' });
  });
});

// ─── Cross-org isolation ─────────────────────────────────────────────────────

describe('cross-organization isolation', () => {
  it("one organization's hold never reaches another's responses or gates", async () => {
    await setState(org.orgId, CASES['pro, unpaid, no grace'][0]);
    await setState(other.orgId, CASES['pro, active'][0]);
    const otherMe = await (await sendAs(other.orgId, other.owner, 'GET', '/auth/me')).json();
    expect(otherMe.data.organizations.find((o: any) => o.id === other.orgId)).toMatchObject({ effectiveTier: 'pro', entitlementHold: null });
    expect((await sendAs(other.orgId, other.owner, 'GET', '/metrics/dora')).status).toBe(200);
    expect((await sendAs(org.orgId, org.owner, 'GET', '/metrics/dora')).status).toBe(402);
  });

  it("a held organization's members get its 402; a healthy organization's members never get a reason", async () => {
    await setState(org.orgId, CASES['pro, incomplete'][0]);
    await setState(other.orgId, CASES['starter, restricted'][0]);
    const held = await (await sendAs(org.orgId, org.member, 'GET', '/metrics/dora', undefined, 'member')).json();
    expect(held.details.reason).toBe('SUBSCRIPTION_INACTIVE');
    const low = await (await sendAs(other.orgId, other.member, 'GET', '/metrics/dora', undefined, 'member')).json();
    expect(low.details).not.toHaveProperty('reason');
  });
});

// ─── BS-Q10: the four stored-tier paths ──────────────────────────────────────

const HELD_ENTERPRISE: OrgState = { tier: 'enterprise', subscription: true, status: 'unpaid' };
const ACTIVE_ENTERPRISE: OrgState = { tier: 'enterprise', subscription: true, status: 'active' };
const HAND_ENTERPRISE: OrgState = { tier: 'enterprise', subscription: false, status: 'active' };

describe('BS-Q10: the rate limiter uses the effective tier', () => {
  let server: http.Server;
  let base = '';
  beforeAll(async () => {
    const app = express();
    app.use((req, _res, next) => {
      (req as any).user = { organizationId: String(req.headers['x-test-org']) };
      next();
    });
    app.use(apiRateLimiter);
    app.get('/ping', (_req, res) => { res.json({ ok: true }); });
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  // The limiter caches a tier per organization for 5 minutes, so each case
  // uses an organization it has not seen.
  it.each([
    ['held Revenue Protection (unpaid, no grace)', HELD_ENTERPRISE, '500'],
    ['active Revenue Protection', ACTIVE_ENTERPRISE, '20000'],
    ['hand-provisioned Revenue Protection (no subscription)', HAND_ENTERPRISE, '20000'],
  ])('%s', async (_label, state, limit) => {
    const fresh = await harness.buildOrg();
    await setState(fresh.orgId, state);
    const res = await fetch(`${base}/ping`, { headers: { 'x-test-org': fresh.orgId } });
    expect(res.status).toBe(200);
    expect(res.headers.get('ratelimit-limit')).toBe(limit);
  });
});

describe('BS-Q10: the usage controller (GET /api/usage/api-requests) reports the effective tier\'s limits', () => {
  // The api_usage table is not in the CI schema, so only its request-count
  // query is answered here (no usage this hour); the organization lookup is
  // the real one, against Postgres.
  const usagePool = {
    query: (text: string, values?: unknown[]) =>
      /FROM api_usage/.test(text) ? Promise.resolve({ rows: [] }) : appPool.query(text, values),
  } as unknown as typeof appPool;

  it.each([
    ['held Revenue Protection (unpaid, no grace)', HELD_ENTERPRISE, 500, 20],
    ['Revenue Protection, incomplete', { tier: 'enterprise', subscription: true, status: 'incomplete' } as OrgState, 500, 20],
    ['active Revenue Protection', ACTIVE_ENTERPRISE, 20000, null],
    ['hand-provisioned Revenue Protection (no subscription)', HAND_ENTERPRISE, 20000, null],
  ])('%s', async (_label, state, limit, resourceLimit) => {
    await setState(org.orgId, state);
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    await new UsageController(usagePool).getApiRequests(
      { user: { organizationId: org.orgId } } as any,
      { json, status } as any
    );
    expect(status).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith({ success: true, data: { requestsThisHour: 0, limit, resourceLimit } });
  });
});

describe('BS-Q10 / B-1: scheduled reports follow the effective tier; a billing hold skips runs', () => {
  // Real schedule rows. Report generation and delivery are stubbed (not under
  // test); everything the schedule records is read back from Postgres.
  let counterReports = 0;
  async function insertSchedule(): Promise<any> {
    const { rows } = await pool.query(
      `INSERT INTO scheduled_reports (organization_id, name, report_type, schedule_type, schedule_time, timezone,
                                      delivery_email, email_recipients, format, enabled, next_run_at)
       VALUES ($1, $2, 'cost_summary', 'daily', '09:00:00', 'UTC', true, ARRAY['reports@example.com'], 'csv', true,
               NOW() - interval '1 hour')
       RETURNING *`,
      [org.orgId, `Entitlement schedule ${Date.now()}-${++counterReports}`]
    );
    return rows[0];
  }
  const scheduleRow = async (id: string) =>
    (await pool.query(
      `SELECT enabled, last_run_status, last_run_error, last_run_at, run_count, next_run_at,
              (SELECT count(*)::int FROM scheduled_report_executions e WHERE e.scheduled_report_id = r.id) AS executions
         FROM scheduled_reports r WHERE id = $1`,
      [id]
    )).rows[0];

  function stubGeneration(service: ScheduledReportsService) {
    const generate = jest.spyOn(service as any, 'generateReport').mockResolvedValue({ recordsProcessed: 0, fileSizeBytes: 0 });
    jest.spyOn(service as any, 'deliverReport').mockResolvedValue({ emailSuccess: true, slackSuccess: false });
    return generate;
  }

  async function run(state: OrgState, report?: any) {
    await setState(org.orgId, state);
    const schedule = report ?? (await insertSchedule());
    const service = new ScheduledReportsService(appPool);
    const generate = stubGeneration(service);
    const expectedNext: Date | null = service.calculateNextRun(schedule);
    await (service as any).executeReport(schedule);
    return { schedule, generate, expectedNext, row: await scheduleRow(schedule.id) };
  }

  it.each([
    ['payment hold (unpaid, no grace)', HELD_ENTERPRISE, 'payment'],
    ['inactive hold (paused)', { tier: 'enterprise', subscription: true, status: 'paused' } as OrgState, 'subscription_inactive'],
  ])('%s: not generated, still enabled, no run recorded, next run advanced, skip logged with ids and the hold only', async (_label, state, hold) => {
    const { schedule, generate, expectedNext, row } = await run(state);
    expect(generate).not.toHaveBeenCalled();
    expect(row).toMatchObject({ enabled: true, last_run_status: null, last_run_error: null, last_run_at: null, run_count: 0, executions: 0 });
    expect(expectedNext).not.toBeNull();
    expect(new Date(row.next_run_at).getTime()).toBe(expectedNext!.getTime());
    expect(new Date(row.next_run_at).getTime()).toBeGreaterThan(Date.now());

    const lines = (console.log as jest.Mock).mock.calls.map((c) => c.join(' ')).filter((l) => l.includes('Skipped report'));
    expect(lines).toEqual([`[ScheduledReports] Skipped report ${schedule.id} for organization ${org.orgId}: billing hold ${hold}`]);
    const subscriptionId = (await pool.query('SELECT stripe_subscription_id FROM organizations WHERE id = $1', [org.orgId])).rows[0].stripe_subscription_id;
    expect(lines[0]).not.toContain(subscriptionId);
  });

  it('resumes by itself once the hold clears: the same schedule runs on its next due time', async () => {
    const held = await run(HELD_ENTERPRISE);
    expect(held.generate).not.toHaveBeenCalled();
    expect(held.row.enabled).toBe(true);
    // The hold clears; the schedule's next run comes due.
    await pool.query(`UPDATE scheduled_reports SET next_run_at = NOW() - interval '1 minute' WHERE id = $1`, [held.schedule.id]);
    const schedule = (await pool.query('SELECT * FROM scheduled_reports WHERE id = $1', [held.schedule.id])).rows[0];
    const resumed = await run(ACTIVE_ENTERPRISE, schedule);
    expect(resumed.generate).toHaveBeenCalledTimes(1);
    expect(resumed.row).toMatchObject({ enabled: true, last_run_status: 'success', run_count: 1, executions: 1 });
  });

  it.each([
    ['a real downgrade to Optimization Engine (active)', { tier: 'pro', subscription: true, status: 'active' } as OrgState],
    ['a canceled Revenue Protection subscription (no hold: terminal)', { tier: 'enterprise', subscription: true, status: 'canceled' } as OrgState],
    ['free', { tier: 'free', subscription: false, status: 'free' } as OrgState],
  ])('%s: not generated and disabled, as before', async (_label, state) => {
    const { generate, row } = await run(state);
    expect(generate).not.toHaveBeenCalled();
    expect(row).toMatchObject({ enabled: false, run_count: 0, executions: 0 });
  });

  it.each([
    ['active Revenue Protection', ACTIVE_ENTERPRISE],
    ['hand-provisioned Revenue Protection (no subscription)', HAND_ENTERPRISE],
  ])('%s: generated', async (_label, state) => {
    const { generate, row } = await run(state);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(row).toMatchObject({ enabled: true, last_run_status: 'success' });
  });
});

describe('BS-Q10: AWS discovery discovers the effective tier\'s resource types', () => {
  const FREE_TYPES = ['ec2', 'ebs', 'rds', 's3'];

  async function allowedTypes(state: OrgState): Promise<string[]> {
    await setState(org.orgId, state);
    const discovery = new AWSResourceDiscoveryService(appPool);
    const tier = await (discovery as any).getOrganizationTier(org.orgId);
    return (discovery as any).getAllowedResourceTypes(tier);
  }

  it('held Revenue Protection (unpaid, no grace): the free types only', async () => {
    expect(await allowedTypes(HELD_ENTERPRISE)).toEqual(FREE_TYPES);
  });

  it('Revenue Protection, incomplete: the free types only', async () => {
    expect(await allowedTypes({ tier: 'enterprise', subscription: true, status: 'incomplete' })).toEqual(FREE_TYPES);
  });

  it('active Revenue Protection: more than the free types', async () => {
    const types = await allowedTypes(ACTIVE_ENTERPRISE);
    expect(types.length).toBeGreaterThan(FREE_TYPES.length);
    expect(types).toEqual(expect.arrayContaining(['lambda', 'eks']));
  });

  it('hand-provisioned Revenue Protection (no subscription): more than the free types', async () => {
    expect((await allowedTypes(HAND_ENTERPRISE)).length).toBeGreaterThan(FREE_TYPES.length);
  });
});
