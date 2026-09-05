/**
 * Coverage for GET /api/admin/activation-funnel
 * (backend/src/routes/activation-funnel.routes.ts /
 *  backend/src/services/activationFunnel.service.ts).
 *
 * Two things this suite proves, deliberately kept distinct:
 *
 * 1. Authorization: this endpoint is gated by requirePlatformStaff
 *    (platformAuth.middleware.ts), NOT by tenant role. Tenant
 *    member/admin/owner all get 403 with no platform_staff row -- the
 *    critical regression this guards is someone re-adding requireAdmin (or
 *    an equivalent role check) here, which would let any self-service
 *    customer (automatically 'owner' of their own org) see platform-wide
 *    business metrics. Only an active platform_staff row grants access,
 *    regardless of the caller's tenant role or which organization they
 *    belong to.
 *
 * 2. Aggregation: the central risk this endpoint exists to avoid is the one
 *    already found, unfixed, in onboarding.service.ts's getFunnelMetrics():
 *    a "platform-wide" aggregate query that's actually silently scoped to
 *    the calling user's own organization by RLS + the request-scoped
 *    connection proxy (config/database.ts). The aggregation test below
 *    proves the response reflects MULTIPLE organizations distinct from the
 *    calling platform-staff user's own org, which a naively-scoped
 *    implementation could not produce under real RLS enforcement.
 *
 * IMPORTANT CAVEAT ON WHAT THE AGGREGATION TEST CAN PROVE: this suite (like
 * every other test file in this project, and per this project's own
 * documented findings) runs against a local dev Postgres role
 * (DB_USER=postgres, a superuser) that BYPASSES row-level security
 * entirely. That means a naive single-ambient-connection query would ALSO
 * happen to return all organizations' rows locally -- RLS simply doesn't
 * apply to a superuser. That test therefore verifies the aggregation
 * arithmetic/loop logic is correct (a real regression test), but it cannot,
 * by itself, prove the per-organization SET LOCAL app.current_organization_id
 * scoping in activationFunnel.service.ts is what makes production
 * (non-superuser `devcontrol` role, RLS enforced) work correctly -- that
 * guarantee rests on the service never calling the ambient request-scoped
 * `pool.query(...)` delegation path at all (it uses `pool.connect()`
 * directly, per its own module docblock), which is a code-structure
 * property, not something this black-box HTTP test can independently
 * observe under a superuser role.
 */
import express from 'express';
import http from 'http';
import { Pool } from 'pg';
import activationFunnelRoutes from '../activation-funnel.routes';
import { authService } from '../../services/auth.service';

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

async function insertOrg(label: string): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $3, 'free', 'free')
     RETURNING id`,
    [`Funnel ${label} ${suffix}`, `funnel-${label}-${suffix}`, `Funnel ${label} ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function insertUser(): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Funnel Test User') RETURNING id`,
    [`funnel-${suffix}@example.com`]
  );
  createdUserIds.push(rows[0].id);
  return rows[0].id as string;
}

/** Grants (or re-grants) platform_staff status -- same shape as
 * backend/scripts/manage-platform-staff.js's own upsert. */
async function grantPlatformStaff(userId: string, status: 'active' | 'revoked' = 'active'): Promise<void> {
  await pool.query(
    `INSERT INTO platform_staff (user_id, status, added_at, revoked_at)
     VALUES ($1, $2, NOW(), $3)
     ON CONFLICT (user_id) DO UPDATE SET status = $2, revoked_at = $3, updated_at = NOW()`,
    [userId, status, status === 'revoked' ? new Date() : null]
  );
}

/** Raw fixture insert -- bypasses trackFunnelEvent/Once deliberately: this
 * suite tests the READ/aggregation side, not event-emission logic. */
async function insertEvent(
  organizationId: string,
  eventName: string,
  createdAt: Date,
  properties: Record<string, unknown> = {}
): Promise<void> {
  await pool.query(
    `INSERT INTO analytics_events (organization_id, event_name, event_category, properties, created_at)
     VALUES ($1, $2, 'funnel', $3, $4)`,
    [organizationId, eventName, JSON.stringify(properties), createdAt]
  );
}

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/activation-funnel', activationFunnelRoutes);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}/api/admin/activation-funnel`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM analytics_events WHERE organization_id = ANY($1)', [createdOrgIds]);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  if (createdUserIds.length > 0) {
    await pool.query('DELETE FROM platform_staff WHERE user_id = ANY($1)', [createdUserIds]);
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds]);
  }
  await pool.end();
});

afterEach(() => {
  jest.restoreAllMocks();
});

function stubAuth(userId: string, orgId: string, role: string) {
  jest.spyOn(authService, 'verifyToken').mockReturnValue({
    userId,
    email: 'funnel-admin@example.com',
    organizationId: orgId,
    role,
    type: 'access',
  } as any);
}

function getFunnel(token = 'test-token') {
  return fetch(baseUrl, { headers: { Authorization: `Bearer ${token}` } });
}

describe('GET /api/admin/activation-funnel', () => {
  it('Test 1 -- unauthenticated request is rejected with 401', async () => {
    const response = await fetch(baseUrl);
    expect(response.status).toBe(401);
  });

  it('Test 2 -- authenticated tenant member with no platform_staff record is rejected with 403', async () => {
    const orgId = await insertOrg('caller-member');
    const userId = await insertUser();
    stubAuth(userId, orgId, 'member');

    const response = await getFunnel();
    expect(response.status).toBe(403);
  });

  it('Test 3 -- authenticated tenant admin with no platform_staff record is rejected with 403', async () => {
    const orgId = await insertOrg('caller-admin');
    const userId = await insertUser();
    stubAuth(userId, orgId, 'admin');

    const response = await getFunnel();
    expect(response.status).toBe(403);
  });

  it('Test 4 -- authenticated tenant owner with no platform_staff record is rejected with 403 -- tenant role alone must never grant access', async () => {
    const orgId = await insertOrg('caller-owner');
    const userId = await insertUser();
    stubAuth(userId, orgId, 'owner');

    const response = await getFunnel();
    expect(response.status).toBe(403);
  });

  it('Test 5 -- active platform staff is allowed through (200), regardless of tenant role', async () => {
    const orgId = await insertOrg('caller-staff');
    const userId = await insertUser();
    // Lowest tenant role on purpose -- proves the grant, not the role, is
    // what admits this request.
    stubAuth(userId, orgId, 'member');
    await grantPlatformStaff(userId, 'active');

    const response = await getFunnel();
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
  });

  it('Test 6 -- revoked platform staff is rejected with 403', async () => {
    const orgId = await insertOrg('caller-revoked');
    const userId = await insertUser();
    stubAuth(userId, orgId, 'owner');
    await grantPlatformStaff(userId, 'revoked');

    const response = await getFunnel();
    expect(response.status).toBe(403);
  });

  it('Test 7 -- platform staff belonging to an organization unrelated to any aggregated data can still access the platform-wide endpoint', async () => {
    // The staff member's own org contributes zero analytics_events -- their
    // access must not depend on their org being "in" the data at all.
    const staffOwnOrgId = await insertOrg('unrelated-staff-org');
    const userId = await insertUser();
    stubAuth(userId, staffOwnOrgId, 'viewer');
    await grantPlatformStaff(userId, 'active');

    const dataOrgId = await insertOrg('unrelated-data-org');
    await insertEvent(dataOrgId, 'signup_completed', new Date());

    const response = await getFunnel();
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    const signupStage = body.data.stages.find((s: any) => s.event === 'signup_completed');
    expect(signupStage.organizations).toBeGreaterThanOrEqual(1);
  });

  it('security regression -- 403 body is identical across tenant-role denials and revoked-staff denial (no distinguishing information)', async () => {
    const memberOrg = await insertOrg('body-check-member');
    const memberUserId = await insertUser();
    stubAuth(memberUserId, memberOrg, 'member');
    const memberBody = await (await getFunnel()).json();

    const ownerOrg = await insertOrg('body-check-owner');
    const ownerUserId = await insertUser();
    stubAuth(ownerUserId, ownerOrg, 'owner');
    const ownerBody = await (await getFunnel()).json();

    const revokedOrg = await insertOrg('body-check-revoked');
    const revokedUserId = await insertUser();
    stubAuth(revokedUserId, revokedOrg, 'owner');
    await grantPlatformStaff(revokedUserId, 'revoked');
    const revokedBody = await (await getFunnel()).json();

    // Same route-level denial body every time -- a caller must not be able
    // to tell "never staff" apart from "revoked staff" from the response,
    // and the route itself must not introduce a message different from
    // requirePlatformStaff's own.
    expect(memberBody).toEqual({ success: false, error: 'Platform staff authorization required' });
    expect(ownerBody).toEqual(memberBody);
    expect(revokedBody).toEqual(memberBody);
  });

  it('Test 8 -- cross-organization aggregation remains correct for a platform-staff caller (not silently org-scoped)', async () => {
    // Caller's own org has ZERO analytics_events rows. If the endpoint were
    // buggy in the way onboarding.service.ts's getFunnelMetrics() is (using
    // the ambient request-scoped connection instead of an explicit per-org
    // loop), a real-RLS-enforced environment would see only this org's
    // (empty) data. See file-level caveat: this local suite runs under a
    // superuser role that bypasses RLS regardless, so this test verifies the
    // aggregation logic is correct, not that RLS-bypass-avoidance itself is
    // exercised.
    const callerOrgId = await insertOrg('caller');
    const adminUserId = await insertUser();
    // Deliberately the lowest tenant role -- only the platform_staff grant
    // below is what admits this caller now.
    stubAuth(adminUserId, callerOrgId, 'viewer');
    await grantPlatformStaff(adminUserId, 'active');

    const before = await (await getFunnel()).json() as any;
    const stageCountBefore = (event: string) =>
      before.data.stages.find((s: any) => s.event === event).organizations;
    const orgsTotalBefore = before.data.organizationsTotal;
    const activatedBefore = before.data.activated.organizations;
    const subscribedBefore = before.data.subscribed.organizations;
    const startedBefore = before.data.informational.awsConnectionStarted.organizations;
    const stsBefore = before.data.awsConnectionSourceBreakdown.sts;
    const legacyBefore = before.data.awsConnectionSourceBreakdown.legacyAccessKey;

    const now = Date.now();
    const t = (hoursAfterSignup: number) => new Date(now + hoursAfterSignup * 3600_000);

    // Org A: full funnel, STS connection (no `source` property), subscribes.
    const orgA = await insertOrg('org-a');
    await insertEvent(orgA, 'signup_completed', t(0));
    await insertEvent(orgA, 'aws_connection_started', t(0.5));
    await insertEvent(orgA, 'aws_connection_completed', t(1), { accountId: '111111111111' });
    await insertEvent(orgA, 'discovery_completed', t(2), { resourcesDiscovered: 5 });
    await insertEvent(orgA, 'first_insight_generated', t(3), { recommendationCount: 2, totalMonthlySavings: 40 });
    await insertEvent(orgA, 'first_value_viewed', t(4), { totalMonthlySavings: 40 });
    await insertEvent(orgA, 'subscription_activated', t(24), { tier: 'pro' });

    // Org B: connects via legacy access-key path, reaches discovery, no
    // insight yet -- not activated.
    const orgB = await insertOrg('org-b');
    await insertEvent(orgB, 'signup_completed', t(0));
    await insertEvent(orgB, 'aws_connection_started', t(0.5));
    await insertEvent(orgB, 'aws_connection_completed', t(1), { source: 'legacy_access_key' });
    await insertEvent(orgB, 'discovery_completed', t(2), { resourcesDiscovered: 1 });

    // Org C: just signed up.
    const orgC = await insertOrg('org-c');
    await insertEvent(orgC, 'signup_completed', t(0));

    const after = await (await getFunnel()).json() as any;
    const stageCountAfter = (event: string) =>
      after.data.stages.find((s: any) => s.event === event).organizations;

    // This is a live, shared local dev database -- other processes (a
    // running dev server, another concurrent test run) can create
    // organizations/events between the "before" and "after" snapshots. Exact
    // equality would be flaky for reasons unrelated to this endpoint's
    // correctness, so assert the fixtures this test just inserted are AT
    // LEAST fully counted, rather than that nothing else in the world moved.
    // Only +3 (A, B, C): the caller org was created BEFORE the "before"
    // snapshot above, so it's already included in orgsTotalBefore.
    expect(after.data.organizationsTotal).toBeGreaterThanOrEqual(orgsTotalBefore + 3);

    expect(stageCountAfter('signup_completed')).toBeGreaterThanOrEqual(stageCountBefore('signup_completed') + 3);
    expect(stageCountAfter('aws_connection_completed')).toBeGreaterThanOrEqual(
      stageCountBefore('aws_connection_completed') + 2
    );
    expect(stageCountAfter('discovery_completed')).toBeGreaterThanOrEqual(stageCountBefore('discovery_completed') + 2);
    expect(stageCountAfter('first_insight_generated')).toBeGreaterThanOrEqual(
      stageCountBefore('first_insight_generated') + 1
    );
    expect(stageCountAfter('first_value_viewed')).toBeGreaterThanOrEqual(stageCountBefore('first_value_viewed') + 1);

    expect(after.data.activated.organizations).toBeGreaterThanOrEqual(activatedBefore + 1); // at least org A
    expect(after.data.subscribed.organizations).toBeGreaterThanOrEqual(subscribedBefore + 1); // at least org A
    expect(after.data.informational.awsConnectionStarted.organizations).toBeGreaterThanOrEqual(startedBefore + 2); // A + B
    expect(after.data.awsConnectionSourceBreakdown.sts).toBeGreaterThanOrEqual(stsBefore + 1); // at least org A
    expect(after.data.awsConnectionSourceBreakdown.legacyAccessKey).toBeGreaterThanOrEqual(legacyBefore + 1); // at least org B

    // aws_connection_started is informational only -- never a funnel stage.
    expect(after.data.stages.map((s: any) => s.event)).not.toContain('aws_connection_started');
    expect(after.data.stages.map((s: any) => s.event)).not.toContain('subscription_activated');

    // Conversion math is internally consistent with the counts in the same response.
    const signupStage = after.data.stages.find((s: any) => s.event === 'signup_completed');
    const awsStage = after.data.stages.find((s: any) => s.event === 'aws_connection_completed');
    expect(signupStage.conversionFromSignupPct).toBeNull();
    expect(awsStage.conversionFromSignupPct).toBeCloseTo(
      (awsStage.organizations / signupStage.organizations) * 100,
      1
    );
  });
});
