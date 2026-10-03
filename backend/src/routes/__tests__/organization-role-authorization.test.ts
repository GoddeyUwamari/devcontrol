/**
 * Role assignment + invitation authorization (PR #140).
 *
 * Drives the real /api/organizations routes over HTTP -- authenticate ->
 * requireOwnOrg -> requireAdmin -> controller -> OrganizationService --
 * against live Postgres. Only authService.verifyToken is stubbed, to choose
 * the caller; everything the caller is ALLOWED to do must come from their
 * current organization_memberships row, which is why several cases give
 * the caller a JWT role claim that is deliberately higher than their real
 * membership (a stale or otherwise untrustworthy claim must not authorize).
 *
 * Policy under test (organization-authorization.ts):
 *   owner  -> may manage owner/admin/member/viewer
 *   admin  -> may manage member/viewer only; may invite member/viewer only
 *   member / viewer -> may not manage memberships
 *   nobody -> may change or remove their own membership here
 *   no action may leave an organization without an owner
 */
import express from 'express';
import http from 'http';
import bcrypt from 'bcrypt';
import { Pool } from 'pg';
import organizationRoutes from '../organizations.routes';
import { authService } from '../../services/auth.service';
import { emailService } from '../../services/email.service';
import { organizationService } from '../../services/organization.service';

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
const PASSWORD = 'Sup3rSecret!1';
let passwordHash: string;

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function insertOrg(maxUsers = 20): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, max_services, max_users)
     VALUES ($1, $2, $3, 'pro', 10, $4) RETURNING id`,
    [`RoleAuthz ${suffix}`, `role-authz-${suffix}`, `RoleAuthz ${suffix}`, maxUsers]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function insertUser(label = 'user'): Promise<{ id: string; email: string }> {
  const email = `role-authz-${label}-${uniqueSuffix()}@example.com`;
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, $2, 'Role Authz User') RETURNING id`,
    [email, passwordHash]
  );
  createdUserIds.push(rows[0].id);
  return { id: rows[0].id as string, email };
}

async function addMembership(orgId: string, userId: string, role: string): Promise<void> {
  await pool.query(
    `INSERT INTO organization_memberships (organization_id, user_id, role, joined_at, is_active)
     VALUES ($1, $2, $3, NOW(), true)`,
    [orgId, userId, role]
  );
}

async function member(orgId: string, role: string): Promise<string> {
  const user = await insertUser(role);
  await addMembership(orgId, user.id, role);
  return user.id;
}

/** One org with an active member of every role (plus a second owner and admin). */
async function buildOrg(maxUsers = 20) {
  const orgId = await insertOrg(maxUsers);
  return {
    orgId,
    owner: await member(orgId, 'owner'),
    owner2: await member(orgId, 'owner'),
    admin: await member(orgId, 'admin'),
    admin2: await member(orgId, 'admin'),
    member: await member(orgId, 'member'),
    viewer: await member(orgId, 'viewer'),
  };
}

async function roleOf(orgId: string, userId: string): Promise<string | null> {
  const { rows } = await pool.query(
    'SELECT role FROM organization_memberships WHERE organization_id = $1 AND user_id = $2',
    [orgId, userId]
  );
  return rows[0]?.role ?? null;
}

async function membershipRow(orgId: string, userId: string) {
  const { rows } = await pool.query(
    `SELECT role, is_active, invitation_token, joined_at FROM organization_memberships
     WHERE organization_id = $1 AND user_id = $2`,
    [orgId, userId]
  );
  return rows[0] ?? null;
}

async function activeOwnerCount(orgId: string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM organization_memberships
     WHERE organization_id = $1 AND role = 'owner' AND is_active = true AND invitation_token IS NULL`,
    [orgId]
  );
  return rows[0].n;
}

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  passwordHash = await bcrypt.hash(PASSWORD, 4);
  const app = express();
  app.use(express.json());
  app.use('/api/organizations', organizationRoutes);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}/api/organizations`;
});

beforeEach(() => {
  jest.spyOn(emailService, 'sendInvitationEmail').mockResolvedValue(true as any);
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
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

/**
 * Every request is authenticated as `callerId` in `orgId`. `jwtRole` is the
 * role CLAIM in the token -- defaults to 'owner' so the coarse route gate
 * (requireAdmin) lets the request through and the service's own check against
 * the caller's real membership is what's being tested. Pass the real role to
 * test the route gate instead.
 */
function as(callerId: string, orgId: string, jwtRole = 'owner') {
  const stub = () =>
    jest.spyOn(authService, 'verifyToken').mockReturnValue({
      userId: callerId,
      email: 'role-authz-caller@example.com',
      organizationId: orgId,
      role: jwtRole,
      type: 'access',
    } as any);
  const send = (method: string, path: string, body?: unknown) => {
    stub();
    return fetch(`${baseUrl}${path}`, {
      method,
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  };
  return {
    setRole: (targetId: string, role: unknown, extra: Record<string, unknown> = {}) =>
      send('PATCH', `/${orgId}/members/${targetId}/role`, { role, ...extra }),
    remove: (targetId: string) => send('DELETE', `/${orgId}/members/${targetId}`),
    invite: (email: string, role: unknown) => send('POST', `/${orgId}/invite`, { email, role }),
    accept: (invitationToken: string) => send('POST', '/accept-invitation', { invitationToken }),
  };
}

// ─── Role changes ───────────────────────────────────────────────────────────

describe('PATCH /:id/members/:userId/role -- owner', () => {
  it.each(['owner', 'admin', 'member', 'viewer'])('owner may assign %s', async (role) => {
    const org = await buildOrg();
    const res = await as(org.owner, org.orgId).setRole(org.member, role);
    expect(res.status).toBe(200);
    expect(await roleOf(org.orgId, org.member)).toBe(role);
  });

  it('owner may demote another owner while an owner remains', async () => {
    const org = await buildOrg();
    const res = await as(org.owner, org.orgId).setRole(org.owner2, 'admin');
    expect(res.status).toBe(200);
    expect(await roleOf(org.orgId, org.owner2)).toBe('admin');
    expect(await activeOwnerCount(org.orgId)).toBe(1);
  });

  it('owner may not change their own role (no self-demotion)', async () => {
    const org = await buildOrg();
    const res = await as(org.owner, org.orgId).setRole(org.owner, 'member');
    expect(res.status).toBe(403);
    expect(await roleOf(org.orgId, org.owner)).toBe('owner');
  });
});

describe('PATCH /:id/members/:userId/role -- admin', () => {
  it('admin may move member <-> viewer', async () => {
    const org = await buildOrg();
    expect((await as(org.admin, org.orgId, 'admin').setRole(org.member, 'viewer')).status).toBe(200);
    expect(await roleOf(org.orgId, org.member)).toBe('viewer');
    expect((await as(org.admin, org.orgId, 'admin').setRole(org.viewer, 'member')).status).toBe(200);
    expect(await roleOf(org.orgId, org.viewer)).toBe('member');
  });

  it.each(['admin', 'owner'])('admin may not promote a member to %s', async (role) => {
    const org = await buildOrg();
    const res = await as(org.admin, org.orgId, 'admin').setRole(org.member, role);
    expect(res.status).toBe(403);
    expect(await roleOf(org.orgId, org.member)).toBe('member');
  });

  it('admin may not modify an owner', async () => {
    const org = await buildOrg();
    const res = await as(org.admin, org.orgId, 'admin').setRole(org.owner, 'member');
    expect(res.status).toBe(403);
    expect(await roleOf(org.orgId, org.owner)).toBe('owner');
  });

  it('admin may not modify a peer admin', async () => {
    const org = await buildOrg();
    const res = await as(org.admin, org.orgId, 'admin').setRole(org.admin2, 'viewer');
    expect(res.status).toBe(403);
    expect(await roleOf(org.orgId, org.admin2)).toBe('admin');
  });

  it('admin may not self-promote', async () => {
    const org = await buildOrg();
    const res = await as(org.admin, org.orgId, 'admin').setRole(org.admin, 'owner');
    expect(res.status).toBe(403);
    expect(await roleOf(org.orgId, org.admin)).toBe('admin');
  });

  it('admin may not assign an arbitrary role', async () => {
    const org = await buildOrg();
    const res = await as(org.admin, org.orgId, 'admin').setRole(org.member, 'superadmin');
    expect(res.status).toBe(400);
    expect(await roleOf(org.orgId, org.member)).toBe('member');
  });
});

describe.each(['member', 'viewer'] as const)('PATCH /:id/members/:userId/role -- %s', (callerRole) => {
  it(`${callerRole} is refused by the route gate with a truthful token`, async () => {
    const org = await buildOrg();
    const caller = org[callerRole];
    const other = callerRole === 'member' ? org.viewer : org.member;
    const res = await as(caller, org.orgId, callerRole).setRole(other, 'viewer');
    expect(res.status).toBe(403);
  });

  it(`${callerRole} holding a stale/elevated owner claim still cannot assign roles`, async () => {
    const org = await buildOrg();
    const caller = org[callerRole];
    const other = callerRole === 'member' ? org.viewer : org.member;
    const before = await roleOf(org.orgId, other);
    const res = await as(caller, org.orgId, 'owner').setRole(other, 'admin');
    expect(res.status).toBe(403);
    expect(await roleOf(org.orgId, other)).toBe(before);
  });

  it(`${callerRole} cannot self-promote, even with an owner claim`, async () => {
    const org = await buildOrg();
    const caller = org[callerRole];
    const res = await as(caller, org.orgId, 'owner').setRole(caller, 'owner');
    expect(res.status).toBe(403);
    expect(await roleOf(org.orgId, caller)).toBe(callerRole);
  });
});

describe('PATCH /:id/members/:userId/role -- invalid input and identity', () => {
  it.each([
    ['unknown role', 'superuser'],
    ['wrong case', 'Owner'],
    ['padded', ' owner '],
    ['array', ['owner']],
    ['object', { role: 'owner' }],
    ['number', 1],
  ])('rejects %s with 400 and changes nothing', async (_label, role) => {
    const org = await buildOrg();
    const res = await as(org.owner, org.orgId).setRole(org.member, role);
    expect(res.status).toBe(400);
    expect(await roleOf(org.orgId, org.member)).toBe('member');
  });

  it('rejects an empty role with 400', async () => {
    const org = await buildOrg();
    const res = await as(org.owner, org.orgId).setRole(org.member, '');
    expect(res.status).toBe(400);
    expect(await roleOf(org.orgId, org.member)).toBe('member');
  });

  it('body-supplied caller identity/role is ignored -- the caller is the token user', async () => {
    const org = await buildOrg();
    const res = await as(org.member, org.orgId, 'owner').setRole(org.member, 'owner', {
      userId: org.owner,
      actorUserId: org.owner,
      callerRole: 'owner',
    });
    expect(res.status).toBe(403);
    expect(await roleOf(org.orgId, org.member)).toBe('member');
  });

  it('an owner of another organization cannot act on this one', async () => {
    const org = await buildOrg();
    const other = await buildOrg();
    jest.spyOn(authService, 'verifyToken').mockReturnValue({
      userId: other.owner,
      email: 'role-authz-caller@example.com',
      organizationId: other.orgId,
      role: 'owner',
      type: 'access',
    } as any);
    const res = await fetch(`${baseUrl}/${org.orgId}/members/${org.member}/role`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'owner' }),
    });
    expect(res.status).toBe(404);
    expect(await roleOf(org.orgId, org.member)).toBe('member');
  });

  it('a caller whose membership was deactivated cannot act', async () => {
    const org = await buildOrg();
    await pool.query(
      'UPDATE organization_memberships SET is_active = false WHERE organization_id = $1 AND user_id = $2',
      [org.orgId, org.owner2]
    );
    const res = await as(org.owner2, org.orgId).setRole(org.member, 'admin');
    // Refused by authenticate itself: no active membership, no request.
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code?: string }).code).toBe('MEMBERSHIP_REVOKED');
    expect(await roleOf(org.orgId, org.member)).toBe('member');
  });
});

// ─── Removal ────────────────────────────────────────────────────────────────

describe('DELETE /:id/members/:userId', () => {
  it('owner may remove an admin; admin may remove member and viewer', async () => {
    const org = await buildOrg();
    expect((await as(org.owner, org.orgId).remove(org.admin2)).status).toBe(200);
    expect(await roleOf(org.orgId, org.admin2)).toBeNull();
    expect((await as(org.admin, org.orgId, 'admin').remove(org.member)).status).toBe(200);
    expect((await as(org.admin, org.orgId, 'admin').remove(org.viewer)).status).toBe(200);
  });

  it.each(['owner', 'admin2'] as const)('admin may not remove %s', async (target) => {
    const org = await buildOrg();
    const res = await as(org.admin, org.orgId, 'admin').remove(org[target]);
    expect(res.status).toBe(403);
    expect(await roleOf(org.orgId, org[target])).not.toBeNull();
  });

  it('member with an elevated claim may not remove anyone', async () => {
    const org = await buildOrg();
    const res = await as(org.member, org.orgId, 'owner').remove(org.viewer);
    expect(res.status).toBe(403);
    expect(await roleOf(org.orgId, org.viewer)).toBe('viewer');
  });

  it('nobody may remove their own membership here', async () => {
    const org = await buildOrg();
    const res = await as(org.owner, org.orgId).remove(org.owner);
    expect(res.status).toBe(403);
    expect(await roleOf(org.orgId, org.owner)).toBe('owner');
  });

  it('removing a non-member is a 404', async () => {
    const org = await buildOrg();
    const stranger = await insertUser('stranger');
    const res = await as(org.owner, org.orgId).remove(stranger.id);
    expect(res.status).toBe(404);
  });
});

// ─── Last-owner protection ──────────────────────────────────────────────────

describe('last-owner protection', () => {
  it('two owners demoting each other concurrently leave exactly one owner', async () => {
    const org = await buildOrg();
    const [a, b] = await Promise.all([
      as(org.owner, org.orgId).setRole(org.owner2, 'member'),
      as(org.owner2, org.orgId).setRole(org.owner, 'member'),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 403]);
    expect(await activeOwnerCount(org.orgId)).toBe(1);
  });

  it('two owners removing each other concurrently leave exactly one owner', async () => {
    const org = await buildOrg();
    const [a, b] = await Promise.all([
      as(org.owner, org.orgId).remove(org.owner2),
      as(org.owner2, org.orgId).remove(org.owner),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 403]);
    expect(await activeOwnerCount(org.orgId)).toBe(1);
  });
});

// ─── Invitations ────────────────────────────────────────────────────────────

async function pendingInviteToken(orgId: string, userId: string): Promise<string> {
  const row = await membershipRow(orgId, userId);
  return row.invitation_token;
}

describe('POST /:id/invite', () => {
  it('owner may invite an existing user as admin; the row is PENDING, not active', async () => {
    const org = await buildOrg();
    const invitee = await insertUser('invitee');
    const res = await as(org.owner, org.orgId).invite(invitee.email, 'admin');
    expect(res.status).toBe(200);
    const row = await membershipRow(org.orgId, invitee.id);
    expect(row.role).toBe('admin');
    expect(row.is_active).toBe(false);
    expect(row.invitation_token).toBeTruthy();
    expect(row.joined_at).toBeNull();
  });

  it('admin may invite member and viewer', async () => {
    const org = await buildOrg();
    for (const role of ['member', 'viewer']) {
      const invitee = await insertUser(`invitee-${role}`);
      const res = await as(org.admin, org.orgId, 'admin').invite(invitee.email, role);
      expect(res.status).toBe(200);
    }
  });

  it('admin may not invite an admin', async () => {
    const org = await buildOrg();
    const invitee = await insertUser('invitee');
    const res = await as(org.admin, org.orgId, 'admin').invite(invitee.email, 'admin');
    expect(res.status).toBe(403);
    expect(await membershipRow(org.orgId, invitee.id)).toBeNull();
  });

  it.each(['owner', 'superuser', ''])('invitation role %p is rejected (owners are made by promotion)', async (role) => {
    const org = await buildOrg();
    const invitee = await insertUser('invitee');
    const res = await as(org.owner, org.orgId).invite(invitee.email, role);
    expect(res.status).toBe(400);
    expect(await membershipRow(org.orgId, invitee.id)).toBeNull();
  });

  it('member (truthful token) is refused by the route gate', async () => {
    const org = await buildOrg();
    const invitee = await insertUser('invitee');
    const res = await as(org.member, org.orgId, 'member').invite(invitee.email, 'viewer');
    expect(res.status).toBe(403);
  });

  it('member with a stale admin claim is refused by the service', async () => {
    const org = await buildOrg();
    const invitee = await insertUser('invitee');
    const res = await as(org.member, org.orgId, 'admin').invite(invitee.email, 'viewer');
    expect(res.status).toBe(403);
    expect(await membershipRow(org.orgId, invitee.id)).toBeNull();
  });

  it('inviting an existing member is refused and does not alter their role', async () => {
    const org = await buildOrg();
    const { rows } = await pool.query('SELECT email FROM users WHERE id = $1', [org.admin2]);
    const res = await as(org.owner, org.orgId).invite(rows[0].email, 'viewer');
    expect(res.status).toBe(400);
    expect(await roleOf(org.orgId, org.admin2)).toBe('admin');
    expect((await membershipRow(org.orgId, org.admin2)).is_active).toBe(true);
  });
});

describe('pending invitation is not an active membership', () => {
  it('is excluded from the invitee\'s organizations, login, and cannot authorize actions', async () => {
    const org = await buildOrg();
    const invitee = await insertUser('invitee');
    expect((await as(org.owner, org.orgId).invite(invitee.email, 'admin')).status).toBe(200);

    const orgs = await organizationService.getUserOrganizations(invitee.id);
    expect(orgs.map((o: any) => o.id)).not.toContain(org.orgId);

    // Their only membership is pending -> password login has no org to issue a token for.
    await expect(authService.login(invitee.email, PASSWORD)).rejects.toThrow(
      'User is not a member of any organization'
    );

    // A pending admin can't exercise admin authority, whatever their token says:
    // a pending invitation is not a membership, so authenticate refuses it.
    const res = await as(invitee.id, org.orgId, 'admin').setRole(org.member, 'viewer');
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code?: string }).code).toBe('MEMBERSHIP_REVOKED');
  });
});

describe('POST /accept-invitation', () => {
  it('authorized invitation is accepted and becomes an active membership', async () => {
    const org = await buildOrg();
    const invitee = await insertUser('invitee');
    const home = await insertOrg();
    await addMembership(home, invitee.id, 'owner');
    await as(org.owner, org.orgId).invite(invitee.email, 'admin');
    const token = await pendingInviteToken(org.orgId, invitee.id);

    const res = await as(invitee.id, home).accept(token);
    expect(res.status).toBe(200);
    const row = await membershipRow(org.orgId, invitee.id);
    expect(row).toMatchObject({ role: 'admin', is_active: true, invitation_token: null });
    expect(row.joined_at).not.toBeNull();
  });

  it.each(['owner', 'superuser'])('a stored role tampered to %p is rejected at acceptance', async (tampered) => {
    const org = await buildOrg();
    const invitee = await insertUser('invitee');
    const home = await insertOrg();
    await addMembership(home, invitee.id, 'owner');
    await as(org.owner, org.orgId).invite(invitee.email, 'member');
    await pool.query(
      'UPDATE organization_memberships SET role = $1 WHERE organization_id = $2 AND user_id = $3',
      [tampered, org.orgId, invitee.id]
    );
    const token = await pendingInviteToken(org.orgId, invitee.id);

    const res = await as(invitee.id, home).accept(token);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await membershipRow(org.orgId, invitee.id)).is_active).toBe(false);
  });

  it('an admin invitation is void once its owner-inviter is demoted', async () => {
    const org = await buildOrg();
    const invitee = await insertUser('invitee');
    const home = await insertOrg();
    await addMembership(home, invitee.id, 'owner');
    await as(org.owner2, org.orgId).invite(invitee.email, 'admin');
    expect((await as(org.owner, org.orgId).setRole(org.owner2, 'member')).status).toBe(200);
    const token = await pendingInviteToken(org.orgId, invitee.id);

    const res = await as(invitee.id, home).accept(token);
    expect(res.status).toBe(403);
    expect((await membershipRow(org.orgId, invitee.id)).is_active).toBe(false);
  });

  it('an invitation is void once its inviter is removed', async () => {
    const org = await buildOrg();
    const invitee = await insertUser('invitee');
    const home = await insertOrg();
    await addMembership(home, invitee.id, 'owner');
    await as(org.admin2, org.orgId, 'admin').invite(invitee.email, 'viewer');
    expect((await as(org.owner, org.orgId).remove(org.admin2)).status).toBe(200);
    const token = await pendingInviteToken(org.orgId, invitee.id);

    const res = await as(invitee.id, home).accept(token);
    expect(res.status).toBe(403);
  });

  it('standalone (not-yet-registered) invitation: stored role tampered to owner is rejected', async () => {
    const org = await buildOrg();
    const email = `role-authz-future-${uniqueSuffix()}@example.com`;
    expect((await as(org.owner, org.orgId).invite(email, 'member')).status).toBe(200);
    await pool.query(
      `UPDATE organization_invitations SET role = 'owner' WHERE organization_id = $1 AND lower(email) = $2`,
      [org.orgId, email]
    );
    const { rows } = await pool.query(
      'SELECT invitation_token FROM organization_invitations WHERE organization_id = $1 AND lower(email) = $2',
      [org.orgId, email]
    );
    const registered = await pool.query(
      `INSERT INTO users (email, password_hash, full_name) VALUES ($1, $2, 'Later') RETURNING id`,
      [email, passwordHash]
    );
    createdUserIds.push(registered.rows[0].id);
    const home = await insertOrg();
    await addMembership(home, registered.rows[0].id, 'owner');

    const res = await as(registered.rows[0].id, home).accept(rows[0].invitation_token);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await membershipRow(org.orgId, registered.rows[0].id)).toBeNull();
  });

  it('seat limit is checked against the organization being JOINED', async () => {
    // Target org: 6 active members, limit 7.
    const org = await buildOrg(7);
    const invitee = await insertUser('invitee');
    // Invitee's own org is nearly empty, so the old (caller-org) check would pass.
    const home = await insertOrg(20);
    await addMembership(home, invitee.id, 'owner');
    expect((await as(org.owner, org.orgId).invite(invitee.email, 'member')).status).toBe(200);
    // The last seat is taken before the invitee accepts.
    await member(org.orgId, 'viewer');
    const token = await pendingInviteToken(org.orgId, invitee.id);

    const res = await as(invitee.id, home).accept(token);
    expect(res.status).toBe(402);
    expect(((await res.json()) as { code?: string }).code).toBe('RESOURCE_LIMIT_REACHED');
    expect((await membershipRow(org.orgId, invitee.id)).is_active).toBe(false);
  });

  it('a full home organization does not block joining a target with free seats', async () => {
    const org = await buildOrg(20);
    const invitee = await insertUser('invitee');
    const home = await insertOrg(1);
    await addMembership(home, invitee.id, 'owner');
    await as(org.owner, org.orgId).invite(invitee.email, 'member');
    const token = await pendingInviteToken(org.orgId, invitee.id);

    const res = await as(invitee.id, home).accept(token);
    expect(res.status).toBe(200);
  });
});
