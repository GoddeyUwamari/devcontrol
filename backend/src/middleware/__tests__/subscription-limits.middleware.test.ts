/**
 * Live-Postgres coverage for checkResourceLimit()'s interpretation of
 * organizations.max_users -- specifically NULL-falls-back-to-tier-limit and
 * -1-means-unlimited, plus the plain positive-numeric-limit rejection path.
 *
 * This is the route-protection layer for POST /:id/invite. It's the only
 * place these three cases are enforced now that organizationService
 * .inviteUser()'s own duplicate copy of this check (which had no NULL/-1
 * handling at all) has been removed -- see organization-invitation-lifecycle
 * .test.ts's "user-limit edge cases" describe block for the corresponding
 * service-layer regression coverage (those tests only prove inviteUser()
 * itself no longer blocks NULL/-1/normal cases; this file is what actually
 * proves enforcement still exists for a real over-limit organization).
 *
 * Same pattern as the other live-DB suites in this backend: real Postgres
 * for the actual max_users/tier-fallback semantics, Request/Response/next
 * are plain mocks since no HTTP server is involved.
 */

import { Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import { checkResourceLimit } from '../subscription.middleware';

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

async function insertOrg(overrides: { subscription_tier?: string; max_users?: number | null } = {}) {
  const suffix = uniqueSuffix();
  const tier = overrides.subscription_tier ?? 'free';
  const maxUsers = overrides.max_users === undefined ? 5 : overrides.max_users;
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, max_services, max_users)
     VALUES ($1, $2, $3, $4, 10, $5) RETURNING id`,
    [`Fixture Org ${suffix}`, `fixture-org-${suffix}`, `Fixture Org Display ${suffix}`, tier, maxUsers]
  );
  const orgId = rows[0].id as string;
  createdOrgIds.push(orgId);
  return orgId;
}

async function insertActiveMember(organizationId: string) {
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'not-a-real-hash', 'Fixture Member') RETURNING id`,
    [`fixture-member-${uniqueSuffix()}@example.com`]
  );
  const userId = rows[0].id as string;
  createdUserIds.push(userId);

  await pool.query(
    `INSERT INTO organization_memberships (organization_id, user_id, role, joined_at, is_active)
     VALUES ($1, $2, 'member', NOW(), true)`,
    [organizationId, userId]
  );
  return userId;
}

function mockReqResNext(organizationId: string) {
  const req = {
    user: { userId: 'fixture-caller', email: 'caller@example.com', organizationId, role: 'owner' },
    organizationId,
  } as unknown as Request;

  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status } as unknown as Response;

  const next = jest.fn() as unknown as NextFunction;

  return { req, res, status, json, next };
}

afterAll(async () => {
  await pool.query(
    'DELETE FROM organization_memberships WHERE organization_id = ANY($1) OR user_id = ANY($2)',
    [createdOrgIds, createdUserIds]
  );
  await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds]);
  await pool.end();
});

describe('checkResourceLimit(\'users\', 1) -> max_users interpretation', () => {
  it('NULL max_users on an enterprise org falls back to the tier limit and allows the request through', async () => {
    const orgId = await insertOrg({ subscription_tier: 'enterprise', max_users: null });
    await insertActiveMember(orgId); // 1 active member, tier fallback is enterprise's -1 (unlimited)

    const { req, res, next, status } = mockReqResNext(orgId);
    await checkResourceLimit('users', 1)(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });

  it('max_users = -1 is treated as unlimited and allows the request through regardless of member count', async () => {
    const orgId = await insertOrg({ subscription_tier: 'enterprise', max_users: -1 });
    await insertActiveMember(orgId);
    await insertActiveMember(orgId);

    const { req, res, next, status } = mockReqResNext(orgId);
    await checkResourceLimit('users', 1)(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });

  it('a positive numeric max_users under capacity allows the request through', async () => {
    const orgId = await insertOrg({ subscription_tier: 'free', max_users: 5 });
    await insertActiveMember(orgId); // 1 of 5

    const { req, res, next, status } = mockReqResNext(orgId);
    await checkResourceLimit('users', 1)(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });

  it('a positive numeric max_users at capacity is rejected with 402 RESOURCE_LIMIT_REACHED', async () => {
    const orgId = await insertOrg({ subscription_tier: 'free', max_users: 1 });
    await insertActiveMember(orgId); // already at the limit of 1

    const { req, res, next, status, json } = mockReqResNext(orgId);
    await checkResourceLimit('users', 1)(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(402);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        code: 'RESOURCE_LIMIT_REACHED',
      })
    );
  });
});
