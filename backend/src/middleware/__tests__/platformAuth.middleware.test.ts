/**
 * Coverage for requirePlatformStaff (platformAuth.middleware.ts) -- the new
 * TRUE platform-level authorization boundary, distinct from and independent
 * of rbac.middleware.ts's requireOwner/requireAdmin.
 *
 * The single most important thing this suite proves: tenant role
 * (organization_memberships.role, surfaced as req.user.role) has NO bearing
 * on the outcome -- only an active platform_staff row does. Same pattern as
 * the other live-DB middleware suite in this backend
 * (subscription-limits.middleware.test.ts): real Postgres for the actual
 * authorization semantics, Request/Response/next are plain mocks since no
 * HTTP server is involved.
 */
import { Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import { pool as appPool } from '../../config/database';
import { requirePlatformStaff } from '../platformAuth.middleware';

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

async function insertOrg(): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $3, 'free', 'free')
     RETURNING id`,
    [`Platform Auth Org ${suffix}`, `platform-auth-org-${suffix}`, `Platform Auth Org ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function insertUser(): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Platform Auth Test User') RETURNING id`,
    [`platform-auth-${suffix}@example.com`]
  );
  createdUserIds.push(rows[0].id);
  return rows[0].id as string;
}

async function insertMembership(orgId: string, userId: string, role: string): Promise<void> {
  await pool.query(
    `INSERT INTO organization_memberships (organization_id, user_id, role, is_active, joined_at)
     VALUES ($1, $2, $3, true, NOW())`,
    [orgId, userId, role]
  );
}

async function grantStaff(userId: string, status: 'active' | 'revoked' = 'active'): Promise<void> {
  await pool.query(
    `INSERT INTO platform_staff (user_id, status, added_at, revoked_at)
     VALUES ($1, $2, NOW(), $3)
     ON CONFLICT (user_id) DO UPDATE SET status = $2, revoked_at = $3, updated_at = NOW()`,
    [userId, status, status === 'revoked' ? new Date() : null]
  );
}

async function setStaffStatus(userId: string, status: 'active' | 'revoked'): Promise<void> {
  await pool.query(
    `UPDATE platform_staff SET status = $2::varchar, revoked_at = CASE WHEN $3::varchar = 'revoked' THEN NOW() ELSE NULL END, updated_at = NOW()
     WHERE user_id = $1`,
    [userId, status, status]
  );
}

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await pool.query('DELETE FROM platform_staff WHERE user_id = ANY($1)', [createdUserIds]);
  }
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  if (createdUserIds.length > 0) {
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds]);
  }
  await pool.end();
  await appPool.end();
});

function mockReq(user?: { userId: string; organizationId: string; role: string; email?: string }): Request {
  return { user: user ? { email: 'test@example.com', ...user } : undefined } as unknown as Request;
}

function mockRes(): Response & { statusCode?: number; body?: any } {
  const res: any = {};
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn((body: any) => {
    res.body = body;
    return res;
  });
  return res;
}

describe('requirePlatformStaff', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('Test 1 -- unauthenticated request is rejected with 401', async () => {
    const req = mockReq(undefined);
    const res = mockRes();
    const next = jest.fn();

    await requirePlatformStaff(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('Test 2 -- normal tenant member (no platform_staff record) is rejected with 403', async () => {
    const orgId = await insertOrg();
    const userId = await insertUser();
    await insertMembership(orgId, userId, 'member');

    const req = mockReq({ userId, organizationId: orgId, role: 'member' });
    const res = mockRes();
    const next = jest.fn();

    await requirePlatformStaff(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('Test 3 -- tenant admin (no platform_staff record) is rejected with 403 -- tenant admin != platform staff', async () => {
    const orgId = await insertOrg();
    const userId = await insertUser();
    await insertMembership(orgId, userId, 'admin');

    const req = mockReq({ userId, organizationId: orgId, role: 'admin' });
    const res = mockRes();
    const next = jest.fn();

    await requirePlatformStaff(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('Test 4 -- tenant owner (no platform_staff record) is rejected with 403', async () => {
    const orgId = await insertOrg();
    const userId = await insertUser();
    await insertMembership(orgId, userId, 'owner');

    const req = mockReq({ userId, organizationId: orgId, role: 'owner' });
    const res = mockRes();
    const next = jest.fn();

    await requirePlatformStaff(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('Test 5 -- active platform staff is allowed through', async () => {
    const orgId = await insertOrg();
    const userId = await insertUser();
    await insertMembership(orgId, userId, 'member');
    await grantStaff(userId, 'active');

    const req = mockReq({ userId, organizationId: orgId, role: 'member' });
    const res = mockRes();
    const next = jest.fn();

    await requirePlatformStaff(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('Test 6 -- revoked platform staff is rejected with 403', async () => {
    const orgId = await insertOrg();
    const userId = await insertUser();
    await insertMembership(orgId, userId, 'member');
    await grantStaff(userId, 'revoked');

    const req = mockReq({ userId, organizationId: orgId, role: 'member' });
    const res = mockRes();
    const next = jest.fn();

    await requirePlatformStaff(req, res, next);

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('security regression -- 403 response body is identical for never-staff vs. revoked-staff (no history leakage)', async () => {
    const orgId = await insertOrg();
    const neverStaffUserId = await insertUser();
    const revokedStaffUserId = await insertUser();
    await insertMembership(orgId, neverStaffUserId, 'member');
    await insertMembership(orgId, revokedStaffUserId, 'member');
    await grantStaff(revokedStaffUserId, 'revoked');

    const neverStaffRes = mockRes();
    await requirePlatformStaff(
      mockReq({ userId: neverStaffUserId, organizationId: orgId, role: 'member' }),
      neverStaffRes,
      jest.fn()
    );

    const revokedStaffRes = mockRes();
    await requirePlatformStaff(
      mockReq({ userId: revokedStaffUserId, organizationId: orgId, role: 'member' }),
      revokedStaffRes,
      jest.fn()
    );

    // Both must be rejected the same way -- a caller must never be able to
    // distinguish "was revoked" from "was never staff" from the response.
    expect(neverStaffRes.statusCode).toBe(403);
    expect(revokedStaffRes.statusCode).toBe(403);
    expect(neverStaffRes.statusCode).toBe(revokedStaffRes.statusCode);
    expect(neverStaffRes.body).toEqual(revokedStaffRes.body);
  });

  it('Test 7 -- organization independence: platform access does not depend on tenant role', async () => {
    // Lowest-privilege tenant role (viewer), yet still platform staff.
    const orgId = await insertOrg();
    const userId = await insertUser();
    await insertMembership(orgId, userId, 'viewer');
    await grantStaff(userId, 'active');

    const req = mockReq({ userId, organizationId: orgId, role: 'viewer' });
    const res = mockRes();
    const next = jest.fn();

    await requirePlatformStaff(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('Test 8 -- immediate revocation: active -> revoked takes effect on the very next request, no JWT regeneration', async () => {
    const orgId = await insertOrg();
    const userId = await insertUser();
    await insertMembership(orgId, userId, 'member');
    await grantStaff(userId, 'active');

    const req = mockReq({ userId, organizationId: orgId, role: 'member' });

    const firstRes = mockRes();
    const firstNext = jest.fn();
    await requirePlatformStaff(req, firstRes, firstNext);
    expect(firstNext).toHaveBeenCalledTimes(1);

    // Same req.user object (same "token") -- only the DB row changes.
    await setStaffStatus(userId, 'revoked');

    const secondRes = mockRes();
    const secondNext = jest.fn();
    await requirePlatformStaff(req, secondRes, secondNext);

    expect(secondRes.statusCode).toBe(403);
    expect(secondNext).not.toHaveBeenCalled();
  });

  it('Multi-org test -- platform authorization is independent of which organization is active in the request', async () => {
    const orgA = await insertOrg();
    const orgB = await insertOrg();
    const userId = await insertUser();
    // Same user, two organizations, two different tenant roles.
    await insertMembership(orgA, userId, 'owner');
    await insertMembership(orgB, userId, 'viewer');
    await grantStaff(userId, 'active');

    // req.user reflects whichever org happened to be embedded in this
    // request's JWT (here, orgB with the lowest role) -- must not matter.
    const reqWithOrgB = mockReq({ userId, organizationId: orgB, role: 'viewer' });
    const resB = mockRes();
    const nextB = jest.fn();
    await requirePlatformStaff(reqWithOrgB, resB, nextB);
    expect(nextB).toHaveBeenCalledTimes(1);

    // And with orgA active instead -- same user, same platform_staff row,
    // same outcome, proving the decision never consulted
    // organization_memberships at all.
    const reqWithOrgA = mockReq({ userId, organizationId: orgA, role: 'owner' });
    const resA = mockRes();
    const nextA = jest.fn();
    await requirePlatformStaff(reqWithOrgA, resA, nextA);
    expect(nextA).toHaveBeenCalledTimes(1);
  });

  it('fails closed: a database error rejects the request rather than granting access', async () => {
    const orgId = await insertOrg();
    const userId = await insertUser();
    await insertMembership(orgId, userId, 'member');
    await grantStaff(userId, 'active');

    // appPool is a Proxy (config/database.ts) whose `query` getter returns a
    // fresh closure on every read, so spying on it directly doesn't behave
    // like an ordinary jest.spyOn target. Spy on the real, shared
    // `Pool.prototype.query` it ultimately delegates to instead --
    // `mockRejectedValueOnce` intercepts exactly the single next call made
    // by any Pool instance in this process, which is the middleware's own
    // query immediately below (nothing else runs concurrently in this
    // synchronous test).
    (jest.spyOn(Pool.prototype, 'query') as unknown as jest.Mock).mockRejectedValueOnce(new Error('simulated DB failure'));

    const req = mockReq({ userId, organizationId: orgId, role: 'member' });
    const res = mockRes();
    const next = jest.fn();

    await requirePlatformStaff(req, res, next);

    expect(res.statusCode).toBe(500);
    expect(next).not.toHaveBeenCalled();
  });
});
