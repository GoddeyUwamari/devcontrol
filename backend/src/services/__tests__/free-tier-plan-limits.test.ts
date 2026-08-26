/**
 * Live-Postgres coverage for Phase 1 of the entitlement foundation: proves
 * both organization-creation paths --
 *   - OrganizationService.createOrganization()
 *   - AuthService.register()
 * -- persist the approved Free-plan limits (maxUsers=1, maxServices=5,
 * maxDeploymentsPerMonth=10, maxResources=20) by reading TIER_LIMITS.free
 * (see subscription.middleware.ts), rather than from independent hard-coded
 * literals or the organizations table's schema defaults (max_services=10,
 * max_users=5, max_deployments_per_month=50 -- see database/migrations/
 * 004_add_multi_tenancy.sql), which no longer match the approved Free plan.
 *
 * Also proves:
 *  - the two creation paths can never drift apart (both produce identical
 *    stored values for a fresh Free org),
 *  - TIER_LIMITS' Starter/Pro/Enterprise entries were left untouched,
 *  - PR #8's removal of inviteUser()'s duplicate limit check still holds
 *    with the new Free maxUsers=1, including the NULL-fallback edge case
 *    that only became observable once Free's fallback value dropped to 1.
 *
 * Same pattern as organization-invitation-lifecycle.test.ts and
 * auth-organization-email-flows.test.ts: real Postgres for the actual
 * column/default semantics, jest.spyOn the shared emailService singleton so
 * Resend itself is never exercised, Request/Response/next are plain mocks
 * for the one middleware-level test since no HTTP server is involved.
 */

import { Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import { organizationService } from '../organization.service';
import { authService } from '../auth.service';
import { emailService } from '../email.service';
import { TIER_LIMITS, checkResourceLimit, getResourceUsage } from '../../middleware/subscription.middleware';

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

async function insertOwnerUser(): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'not-a-real-hash', 'Fixture Owner') RETURNING id`,
    [`fixture-owner-${uniqueSuffix()}@example.com`]
  );
  createdUserIds.push(rows[0].id);
  return rows[0].id as string;
}

// Direct fixture insert (bypassing both creation paths) -- only used for the
// NULL max_users edge case, which neither creation path can produce on its
// own (both always write an explicit numeric value).
async function insertOrgWithExplicitMaxUsers(maxUsers: number | null): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, max_services, max_users)
     VALUES ($1, $2, $3, 'free', 5, $4) RETURNING id`,
    [`Fixture Org ${suffix}`, `fixture-org-${suffix}`, `Fixture Org Display ${suffix}`, maxUsers]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function insertActiveMember(organizationId: string): Promise<string> {
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

async function fetchOrgRow(organizationId: string) {
  const { rows } = await pool.query(
    `SELECT subscription_tier, max_services, max_users, max_deployments_per_month
     FROM organizations WHERE id = $1`,
    [organizationId]
  );
  return rows[0];
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

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await pool.query(
    'DELETE FROM organization_memberships WHERE organization_id = ANY($1) OR user_id = ANY($2)',
    [createdOrgIds, createdUserIds]
  );
  await pool.query('DELETE FROM sessions WHERE user_id = ANY($1) OR organization_id = ANY($2)', [
    createdUserIds,
    createdOrgIds,
  ]);
  await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds]);
  await pool.end();
});

describe('OrganizationService.createOrganization() -- Free-tier limits', () => {
  it('persists max_users=1, max_services=5, max_deployments_per_month=10 on the organizations row', async () => {
    const ownerId = await insertOwnerUser();
    const suffix = uniqueSuffix();

    const org = await organizationService.createOrganization({
      name: `Plan Limits Org ${suffix}`,
      slug: `plan-limits-org-${suffix}`,
      displayName: `Plan Limits Org ${suffix}`,
      createdBy: ownerId,
    });
    createdOrgIds.push(org.id);

    const row = await fetchOrgRow(org.id);
    expect(row.subscription_tier).toBe('free');
    expect(row.max_users).toBe(1);
    expect(row.max_services).toBe(5);
    expect(row.max_deployments_per_month).toBe(10);
    // Explicitly not the schema default (50) -- see database/migrations/
    // 004_add_multi_tenancy.sql. The application-level Free value must win.
    expect(row.max_deployments_per_month).not.toBe(50);
  });

  it('getResourceUsage() reports maxResources=20 alongside the persisted limits', async () => {
    const ownerId = await insertOwnerUser();
    const suffix = uniqueSuffix();

    const org = await organizationService.createOrganization({
      name: `Resource Limits Org ${suffix}`,
      slug: `resource-limits-org-${suffix}`,
      displayName: `Resource Limits Org ${suffix}`,
      createdBy: ownerId,
    });
    createdOrgIds.push(org.id);

    const { tier, limits } = await getResourceUsage(org.id);
    expect(tier).toBe('free');
    expect(limits).toEqual({
      maxServices: 5,
      maxUsers: 1,
      maxDeploymentsPerMonth: 10,
      maxResources: 20,
    });
  });
});

describe('AuthService.register() -- Free-tier limits', () => {
  it('persists max_users=1, max_services=5, max_deployments_per_month=10 for the personal workspace', async () => {
    jest.spyOn(emailService, 'sendVerificationEmail').mockResolvedValue(true);

    const email = `plan-limits-register-${uniqueSuffix()}@example.com`;
    const result = await authService.register({
      email,
      password: 'Sup3rSecret!1',
      fullName: 'Plan Limits Register User',
    });
    createdUserIds.push(result.user.id);
    createdOrgIds.push(result.organization.id);

    const row = await fetchOrgRow(result.organization.id);
    expect(row.subscription_tier).toBe('free');
    expect(row.max_users).toBe(1);
    expect(row.max_services).toBe(5);
    expect(row.max_deployments_per_month).toBe(10);
    expect(row.max_deployments_per_month).not.toBe(50);
  });

  it('getResourceUsage() reports maxResources=20 alongside the persisted limits', async () => {
    jest.spyOn(emailService, 'sendVerificationEmail').mockResolvedValue(true);

    const email = `resource-limits-register-${uniqueSuffix()}@example.com`;
    const result = await authService.register({
      email,
      password: 'Sup3rSecret!1',
      fullName: 'Resource Limits Register User',
    });
    createdUserIds.push(result.user.id);
    createdOrgIds.push(result.organization.id);

    const { tier, limits } = await getResourceUsage(result.organization.id);
    expect(tier).toBe('free');
    expect(limits).toEqual({
      maxServices: 5,
      maxUsers: 1,
      maxDeploymentsPerMonth: 10,
      maxResources: 20,
    });
  });
});

describe('No duplicate Free-plan definition across creation paths', () => {
  it('createOrganization() and register() persist identical Free-tier limits for a new organization', async () => {
    jest.spyOn(emailService, 'sendVerificationEmail').mockResolvedValue(true);

    const ownerId = await insertOwnerUser();
    const suffix = uniqueSuffix();

    const orgFromService = await organizationService.createOrganization({
      name: `Dup Check Org ${suffix}`,
      slug: `dup-check-org-${suffix}`,
      displayName: `Dup Check Org ${suffix}`,
      createdBy: ownerId,
    });
    createdOrgIds.push(orgFromService.id);

    const registerResult = await authService.register({
      email: `dup-check-register-${suffix}@example.com`,
      password: 'Sup3rSecret!1',
      fullName: 'Dup Check Register User',
    });
    createdUserIds.push(registerResult.user.id);
    createdOrgIds.push(registerResult.organization.id);

    const rowA = await fetchOrgRow(orgFromService.id);
    const rowB = await fetchOrgRow(registerResult.organization.id);

    expect(rowA.max_services).toBe(rowB.max_services);
    expect(rowA.max_users).toBe(rowB.max_users);
    expect(rowA.max_deployments_per_month).toBe(rowB.max_deployments_per_month);
  });
});

describe('TIER_LIMITS -- Starter/Pro/Enterprise regression guard', () => {
  it('retains their pre-Phase-1 configured values, untouched by the Free-tier change', () => {
    expect(TIER_LIMITS.starter).toEqual({
      maxServices: 20,
      maxUsers: 5,
      maxDeploymentsPerMonth: 50,
      maxResources: 60,
      features: ['basic_dashboard', 'manual_deployments', 'cost_analytics', 'alerts'],
    });
    expect(TIER_LIMITS.pro).toEqual({
      maxServices: 100,
      maxUsers: 10,
      maxDeploymentsPerMonth: 500,
      maxResources: 500,
      features: [
        'basic_dashboard',
        'manual_deployments',
        'cost_analytics',
        'alerts',
        'advanced_analytics',
        'api_access',
        'custom_integrations',
      ],
    });
    expect(TIER_LIMITS.enterprise).toEqual({
      maxServices: -1,
      maxUsers: -1,
      maxDeploymentsPerMonth: -1,
      maxResources: -1,
      features: [
        'basic_dashboard',
        'manual_deployments',
        'cost_analytics',
        'alerts',
        'advanced_analytics',
        'api_access',
        'custom_integrations',
        'sso',
        'audit_logs',
        'dedicated_support',
        'sla',
      ],
    });
  });
});

describe('PR #8 compatibility -- checkResourceLimit() remains the sole enforcement authority with Free maxUsers=1', () => {
  it('a real Free org from createOrganization() (owner already fills the maxUsers=1 quota) rejects a second invite with 402', async () => {
    const ownerId = await insertOwnerUser();
    const suffix = uniqueSuffix();
    const org = await organizationService.createOrganization({
      name: `Invite Limit Org ${suffix}`,
      slug: `invite-limit-org-${suffix}`,
      displayName: `Invite Limit Org ${suffix}`,
      createdBy: ownerId,
    });
    createdOrgIds.push(org.id);

    const { req, res, next, status, json } = mockReqResNext(org.id);
    await checkResourceLimit('users', 1)(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(402);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, code: 'RESOURCE_LIMIT_REACHED' })
    );
  });

  it('inviteUser() itself does not reintroduce a duplicate limit check -- it still succeeds even though the org is already at its Free maxUsers=1 capacity', async () => {
    jest.spyOn(emailService, 'sendInvitationEmail').mockResolvedValue(true);

    const ownerId = await insertOwnerUser();
    const suffix = uniqueSuffix();
    const org = await organizationService.createOrganization({
      name: `Invite NoDup Org ${suffix}`,
      slug: `invite-nodup-org-${suffix}`,
      displayName: `Invite NoDup Org ${suffix}`,
      createdBy: ownerId,
    });
    createdOrgIds.push(org.id);

    const result = await organizationService.inviteUser(org.id, {
      email: `invite-nodup-${suffix}@example.com`,
      role: 'member',
      invitedBy: ownerId,
    });

    expect(result.invitationToken).toBeTruthy();
  });

  it('NULL max_users on a Free-tier org now falls back to TIER_LIMITS.free.maxUsers=1 and rejects at capacity (new edge case introduced by lowering Free from 3 to 1)', async () => {
    const orgId = await insertOrgWithExplicitMaxUsers(null);
    await insertActiveMember(orgId); // 1 active member; NULL fallback is now free's maxUsers=1

    const { req, res, next, status, json } = mockReqResNext(orgId);
    await checkResourceLimit('users', 1)(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(402);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, code: 'RESOURCE_LIMIT_REACHED' })
    );
  });
});
