/**
 * Coverage for GET /api/onboarding/metrics and GET /api/onboarding/funnel
 * (backend/src/routes/onboarding.routes.ts).
 *
 * Confirmed issue: both routes were gated by requireAdmin (rbac.middleware.ts),
 * a per-organization role every self-service customer automatically holds for
 * their own org (owner/admin). onboardingService.getMetrics()/getFunnelMetrics()
 * are platform-wide aggregate queries (across every organization, not scoped to
 * the caller's) -- so any customer's own org admin/owner could reach an
 * endpoint meant to expose platform-wide business metrics. Fixed by switching
 * to requirePlatformStaff (platformAuth.middleware.ts), the same true
 * platform-staff check already used by /api/admin/activation-funnel.
 *
 * This suite proves the authorization boundary only -- it does NOT assert on
 * the returned metrics values. These two endpoints have a separate, unfixed
 * RLS-blinding correctness bug (see activationFunnel.service.ts's doc comment);
 * fixing that is explicitly out of scope here, per the "do not redesign
 * analytics" instruction for this change. /api/admin/activation-funnel remains
 * the correct source of truth for platform-wide funnel measurement.
 */
import express from 'express';
import http from 'http';
import { Pool } from 'pg';
import onboardingRoutes from '../onboarding.routes';
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
    [`Onboarding ${label} ${suffix}`, `onboarding-${label}-${suffix}`, `Onboarding ${label} ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function insertUser(): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Onboarding Metrics Test User') RETURNING id`,
    [`onboarding-metrics-${suffix}@example.com`]
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

/** Marks the row `trigger_initialize_onboarding` auto-created for this org as
 * completed. GET /api/onboarding/metrics's query (unfixed, out of scope for
 * this authorization change) divides by COUNT(*) FILTER (WHERE completed_at
 * IS NOT NULL) with no zero-guard -- without at least one genuinely-completed
 * org anywhere in the database, that query 500s on a real division-by-zero,
 * unrelated to the authorization behavior this suite actually verifies. */
async function markOnboardingCompleted(orgId: string): Promise<void> {
  await pool.query(
    `UPDATE onboarding_progress SET current_stage = 'completed', completed_at = NOW() WHERE organization_id = $1`,
    [orgId]
  );
}

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/onboarding', onboardingRoutes);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}/api/onboarding`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (createdOrgIds.length > 0) {
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
    email: 'onboarding-metrics-caller@example.com',
    organizationId: orgId,
    role,
    type: 'access',
  } as any);
}

function callEndpoint(path: '/metrics' | '/funnel', token = 'test-token') {
  return fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
}

describe.each(['/metrics', '/funnel'] as const)('GET /api/onboarding%s', (path) => {
  it('unauthenticated request is rejected with 401', async () => {
    const response = await fetch(`${baseUrl}${path}`);
    expect(response.status).toBe(401);
  });

  it('authenticated tenant admin with no platform_staff record is rejected with 403', async () => {
    const orgId = await insertOrg(`caller-admin${path}`);
    const userId = await insertUser();
    stubAuth(userId, orgId, 'admin');

    const response = await callEndpoint(path);
    expect(response.status).toBe(403);
  });

  it('authenticated tenant owner with no platform_staff record is rejected with 403 -- tenant role alone must never grant access', async () => {
    const orgId = await insertOrg(`caller-owner${path}`);
    const userId = await insertUser();
    stubAuth(userId, orgId, 'owner');

    const response = await callEndpoint(path);
    expect(response.status).toBe(403);
  });

  it('active platform staff is allowed through (200), regardless of tenant role', async () => {
    const orgId = await insertOrg(`caller-staff${path}`);
    const userId = await insertUser();
    // Lowest tenant role on purpose -- proves the grant, not the role, is
    // what admits this request.
    stubAuth(userId, orgId, 'member');
    await grantPlatformStaff(userId, 'active');
    await markOnboardingCompleted(orgId);

    const response = await callEndpoint(path);
    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.success).toBe(true);
  });

  it('revoked platform staff is rejected with 403', async () => {
    const orgId = await insertOrg(`caller-revoked${path}`);
    const userId = await insertUser();
    stubAuth(userId, orgId, 'owner');
    await grantPlatformStaff(userId, 'revoked');

    const response = await callEndpoint(path);
    expect(response.status).toBe(403);
  });
});
