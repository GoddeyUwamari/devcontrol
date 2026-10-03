/**
 * authenticate: authorization against current organization membership.
 *
 * Drives real routes and a small probe router over HTTP against live
 * Postgres, with real signed tokens. The token identifies the caller and
 * their organization; what they may do -- whether they get in at all, the
 * role every gate sees, and whether the connection is ever tagged for RLS --
 * must come from their current membership row.
 */
import express, { Request, Response } from 'express';
import http from 'http';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { Pool, PoolClient } from 'pg';
import authRoutes from '../../routes/auth.routes';
import organizationRoutes from '../../routes/organizations.routes';
import { authenticate, AUTH_UNAVAILABLE_CODE, MEMBERSHIP_REVOKED_CODE } from '../auth.middleware';
import { requireAdmin, requireOwner } from '../rbac.middleware';
import { authService } from '../../services/auth.service';
import { emailService } from '../../services/email.service';
import { organizationService } from '../../services/organization.service';
import * as organizationAuthorization from '../../services/organization-authorization';
import { getCurrentMembership } from '../../services/organization-authorization';
import { pool as appPool } from '../../config/database';

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
const jwtSecret: string = (authService as any).jwtSecret;

const REVOKED_BODY = {
  success: false,
  error: 'Organization membership is not active',
  code: MEMBERSHIP_REVOKED_CODE,
};

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function insertOrg(): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, max_services, max_users)
     VALUES ($1, $2, $3, 'pro', 10, 20) RETURNING id`,
    [`CurrentMembership ${suffix}`, `current-membership-${suffix}`, `CurrentMembership ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function insertUser(label = 'user'): Promise<{ id: string; email: string }> {
  const email = `current-membership-${label}-${uniqueSuffix()}@example.com`;
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, $2, 'Current Membership User') RETURNING id`,
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

/** An org with an owner (who performs membership changes) plus one `role` member. */
async function setup(role = 'admin') {
  const orgId = await insertOrg();
  const owner = await insertUser('owner');
  await addMembership(orgId, owner.id, 'owner');
  const user = await insertUser(role);
  await addMembership(orgId, user.id, role);
  return { orgId, ownerId: owner.id, user };
}

/** A real, signed access token carrying exactly these claims. */
function accessToken(userId: string, organizationId: unknown, role = 'owner', extra: object = {}): string {
  return jwt.sign(
    { userId, email: 'claimed@example.com', organizationId, role, type: 'access', ...extra },
    jwtSecret,
    { expiresIn: '1h', jwtid: randomUUID() }
  );
}

async function call(token: string | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed, text };
}

/**
 * Records, in order, every SQL statement run on any connection the app pool
 * checks out (restored before it returns to the pool).
 */
function recordAppSql(): string[] {
  const statements: string[] = [];
  const text = (q: unknown) => (typeof q === 'string' ? q : (q as { text?: string } | null)?.text ?? String(q));
  const realConnect = appPool.connect.bind(appPool) as () => Promise<PoolClient>;
  jest.spyOn(appPool, 'connect').mockImplementation((async () => {
    const client = await realConnect();
    const clientQuery = client.query;
    const clientRelease = client.release;
    client.query = ((q: unknown, ...rest: unknown[]) => {
      statements.push(text(q));
      return (clientQuery as (...args: unknown[]) => unknown).call(client, q, ...rest);
    }) as typeof client.query;
    client.release = ((err?: Error | boolean) => {
      client.query = clientQuery;
      client.release = clientRelease;
      return clientRelease.call(client, err);
    }) as typeof client.release;
    return client;
  }) as unknown as typeof appPool.connect);
  return statements;
}

const isTenantTag = (statement: string) => /set_config\('app\.current_organization_id'/.test(statement);
const isMembershipLookup = (statement: string) => /FROM organization_memberships/i.test(statement);

let probeHandlerCalls = 0;
let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  passwordHash = await bcrypt.hash(PASSWORD, 4);
  const probe = express.Router();
  probe.get('/whoami', authenticate, async (req: Request, res: Response) => {
    probeHandlerCalls += 1;
    const { rows } = await appPool.query(
      "SELECT current_setting('app.current_organization_id', true) AS tag"
    );
    res.json({ user: req.user, organizationId: req.organizationId, tag: rows[0].tag });
  });
  probe.get('/admin', authenticate, requireAdmin, (_req: Request, res: Response) => {
    res.json({ ok: true });
  });
  probe.get('/owner', authenticate, requireOwner, (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/organizations', organizationRoutes);
  app.use('/probe', probe);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

beforeEach(() => {
  probeHandlerCalls = 0;
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
  await pool.query('DELETE FROM audit_logs WHERE organization_id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM organization_invitations WHERE organization_id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds]);
  await pool.end();
  await appPool.end();
});

// ─── Active member ──────────────────────────────────────────────────────────

describe('active member', () => {
  it('is let through with their current role, email, and organization context', async () => {
    const { orgId, user } = await setup('viewer');
    // The claim says owner; only the membership row counts.
    const res = await call(accessToken(user.id, orgId, 'owner'), 'GET', '/probe/whoami');

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ userId: user.id, email: user.email, organizationId: orgId, role: 'viewer' });
    expect(res.body.organizationId).toBe(orgId);
    expect(res.body.tag).toBe(orgId);
  });

  it('a token issued at login works unchanged', async () => {
    const { orgId, user } = await setup('member');
    const { accessToken: token } = await authService.login(user.email, PASSWORD);

    const res = await call(token, 'GET', '/probe/whoami');
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('member');
    expect(res.body.tag).toBe(orgId);
  });
});

// ─── Removed member ─────────────────────────────────────────────────────────

describe('removed member', () => {
  it('is refused with 401 MEMBERSHIP_REVOKED, and nothing downstream runs', async () => {
    const { orgId, ownerId, user } = await setup('admin');
    const token = accessToken(user.id, orgId, 'admin');
    expect((await call(token, 'GET', '/probe/whoami')).status).toBe(200);

    await organizationService.removeUser(orgId, ownerId, user.id);
    probeHandlerCalls = 0;
    const sql = recordAppSql();

    const res = await call(token, 'GET', '/probe/whoami');
    expect(res.status).toBe(401);
    expect(res.body).toEqual(REVOKED_BODY);
    expect(probeHandlerCalls).toBe(0);
    // The caller's membership was checked, and the connection was never
    // tagged for the organization nor used to meter usage.
    expect(sql.some(isMembershipLookup)).toBe(true);
    expect(sql.some(isTenantTag)).toBe(false);
    expect(sql.some((statement) => /api_usage/i.test(statement))).toBe(false);
  });

  it('cannot use a real organization route either', async () => {
    const { orgId, ownerId, user } = await setup('admin');
    const token = accessToken(user.id, orgId, 'admin');
    await organizationService.removeUser(orgId, ownerId, user.id);

    const members = await call(token, 'GET', `/api/organizations/${orgId}/members`);
    expect(members.status).toBe(401);
    expect(members.body).toEqual(REVOKED_BODY);
    expect(members.text).not.toContain(ownerId);

    const update = await call(token, 'PATCH', `/api/organizations/${orgId}`, { name: 'Taken over' });
    expect(update.status).toBe(401);
    const { rows } = await pool.query('SELECT name FROM organizations WHERE id = $1', [orgId]);
    expect(rows[0].name).not.toBe('Taken over');
  });

  const lostAuthorization: Array<[string, (ctx: { orgId: string; userId: string }) => Promise<unknown>]> = [
    ['membership deactivated', ({ orgId, userId }) =>
      pool.query('UPDATE organization_memberships SET is_active = false WHERE organization_id = $1 AND user_id = $2', [orgId, userId])],
    ['membership reverted to a pending invitation', ({ orgId, userId }) =>
      pool.query(`UPDATE organization_memberships SET invitation_token = $3 WHERE organization_id = $1 AND user_id = $2`, [orgId, userId, `tok-${uniqueSuffix()}`])],
    ['stored role outside the known set', ({ orgId, userId }) =>
      pool.query(`UPDATE organization_memberships SET role = 'superowner' WHERE organization_id = $1 AND user_id = $2`, [orgId, userId])],
    ['user deactivated', ({ userId }) => pool.query('UPDATE users SET is_active = false WHERE id = $1', [userId])],
    ['user soft-deleted', ({ userId }) => pool.query('UPDATE users SET deleted_at = NOW() WHERE id = $1', [userId])],
    ['organization deactivated', ({ orgId }) => pool.query('UPDATE organizations SET is_active = false WHERE id = $1', [orgId])],
    ['organization soft-deleted', ({ orgId }) => pool.query('UPDATE organizations SET deleted_at = NOW() WHERE id = $1', [orgId])],
  ];

  it.each(lostAuthorization)('%s: same 401, same body', async (_label, revoke) => {
    const { orgId, user } = await setup('admin');
    await revoke({ orgId, userId: user.id });

    const res = await call(accessToken(user.id, orgId, 'owner'), 'GET', '/probe/whoami');
    expect(res.status).toBe(401);
    expect(res.body).toEqual(REVOKED_BODY);
    expect(probeHandlerCalls).toBe(0);
  });
});

// ─── Demotion and promotion ─────────────────────────────────────────────────

describe('demoted member', () => {
  it('loses elevated access on the next request, keeps lower-role access, and is not logged out', async () => {
    const { orgId, ownerId, user } = await setup('admin');
    const token = accessToken(user.id, orgId, 'admin');
    expect((await call(token, 'GET', '/probe/admin')).status).toBe(200);

    await organizationService.updateUserRole(orgId, ownerId, user.id, 'viewer');

    const admin = await call(token, 'GET', '/probe/admin');
    expect(admin.status).toBe(403);
    expect(admin.body.current).toBe('viewer');

    const update = await call(token, 'PATCH', `/api/organizations/${orgId}`, { name: 'Demoted rename' });
    expect(update.status).toBe(403);
    const { rows } = await pool.query('SELECT name FROM organizations WHERE id = $1', [orgId]);
    expect(rows[0].name).not.toBe('Demoted rename');

    const members = await call(token, 'GET', `/api/organizations/${orgId}/members`);
    expect(members.status).toBe(200);
    const whoami = await call(token, 'GET', '/probe/whoami');
    expect(whoami.status).toBe(200);
    expect(whoami.body.user.role).toBe('viewer');
  });

  it('a demoted owner loses owner-only routes immediately', async () => {
    const { orgId, ownerId, user } = await setup('owner');
    const token = accessToken(user.id, orgId, 'owner');
    expect((await call(token, 'GET', '/probe/owner')).status).toBe(200);

    await organizationService.updateUserRole(orgId, ownerId, user.id, 'admin');
    expect((await call(token, 'GET', '/probe/owner')).status).toBe(403);
    expect((await call(token, 'GET', '/probe/admin')).status).toBe(200);
  });
});

describe('promoted member', () => {
  it('gains the new role on the next request with the same token', async () => {
    const { orgId, ownerId, user } = await setup('viewer');
    const token = accessToken(user.id, orgId, 'viewer');
    expect((await call(token, 'GET', '/probe/admin')).status).toBe(403);

    await organizationService.updateUserRole(orgId, ownerId, user.id, 'admin');

    expect((await call(token, 'GET', '/probe/admin')).status).toBe(200);
    const update = await call(token, 'PATCH', `/api/organizations/${orgId}`, { displayName: 'Promoted rename' });
    expect(update.status).toBe(200);
  });
});

// ─── Multiple organizations ─────────────────────────────────────────────────

describe('user in two organizations, removed from one', () => {
  it('loses the removed organization only; refresh never switches organizations', async () => {
    // B is joined first, so it is also the organization login picks.
    const orgB = await insertOrg();
    const ownerB = await insertUser('owner-b');
    await addMembership(orgB, ownerB.id, 'owner');
    const orgA = await insertOrg();
    const ownerA = await insertUser('owner-a');
    await addMembership(orgA, ownerA.id, 'owner');
    const user = await insertUser('both');
    await addMembership(orgB, user.id, 'member');
    await addMembership(orgA, user.id, 'admin');

    const sessionA = await authService.generateTokenPair({ userId: user.id, email: user.email, organizationId: orgA, role: 'admin' });
    const sessionB = await authService.generateTokenPair({ userId: user.id, email: user.email, organizationId: orgB, role: 'member' });

    await organizationService.removeUser(orgA, ownerA.id, user.id);

    const a = await call(sessionA.accessToken, 'GET', '/probe/whoami');
    expect(a.status).toBe(401);
    expect(a.body).toEqual(REVOKED_BODY);
    const meA = await call(sessionA.accessToken, 'GET', '/api/auth/me');
    expect(meA.status).toBe(401);
    expect(meA.body).toEqual(REVOKED_BODY);
    expect((await call(null, 'POST', '/api/auth/refresh', { refreshToken: sessionA.refreshToken })).status).toBe(401);

    const b = await call(sessionB.accessToken, 'GET', '/probe/whoami');
    expect(b.status).toBe(200);
    expect(b.body.tag).toBe(orgB);
    expect(b.body.user.role).toBe('member');
    const refreshedB = await call(null, 'POST', '/api/auth/refresh', { refreshToken: sessionB.refreshToken });
    expect(refreshedB.status).toBe(200);
    expect((jwt.verify(refreshedB.body.data.accessToken, jwtSecret) as any).organizationId).toBe(orgB);

    const login = await authService.login(user.email, PASSWORD);
    expect(login.organization.id).toBe(orgB);
  });

  it('there is no organization-switch endpoint that could re-scope a token', async () => {
    const { orgId, user } = await setup('member');
    const res = await call(accessToken(user.id, orgId, 'member'), 'POST', '/api/organizations/switch', { organizationId: orgId });
    expect(res.status).toBe(404);
  });
});

// ─── Tenant context ordering and isolation ──────────────────────────────────

describe('tenant context', () => {
  it('membership is checked on an untagged connection, before the tenant tag is set', async () => {
    const { orgId, user } = await setup('member');
    const tagsSeenByLookup: Array<string | null> = [];
    const realLookup = organizationAuthorization.getCurrentMembership;
    jest.spyOn(organizationAuthorization, 'getCurrentMembership').mockImplementation(async (executor, organizationId, userId) => {
      const { rows } = await executor.query("SELECT current_setting('app.current_organization_id', true) AS tag");
      tagsSeenByLookup.push(rows[0].tag);
      return realLookup(executor, organizationId, userId);
    });
    const sql = recordAppSql();

    const res = await call(accessToken(user.id, orgId, 'member'), 'GET', '/probe/whoami');
    expect(res.status).toBe(200);
    expect(res.body.tag).toBe(orgId);

    expect(tagsSeenByLookup).toHaveLength(1);
    expect(tagsSeenByLookup[0] ?? '').toBe('');
    const lookupAt = sql.findIndex(isMembershipLookup);
    const tagAt = sql.findIndex(isTenantTag);
    expect(lookupAt).toBeGreaterThan(-1);
    expect(tagAt).toBeGreaterThan(lookupAt);
  });

  it('a token for an organization the user never belonged to is refused', async () => {
    const a = await setup('owner');
    const b = await setup('owner');
    const res = await call(accessToken(a.user.id, b.orgId, 'owner'), 'GET', '/probe/whoami');
    expect(res.status).toBe(401);
    expect(res.body).toEqual(REVOKED_BODY);

    const unknown = await call(accessToken(a.user.id, randomUUID(), 'owner'), 'GET', '/probe/whoami');
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual(REVOKED_BODY);
    expect(probeHandlerCalls).toBe(0);
  });
});

describe('getCurrentMembership matches only the exact user in the exact organization', () => {
  it('never returns another user\'s or another organization\'s row', async () => {
    const orgA = await insertOrg();
    const orgB = await insertOrg();
    const u = await insertUser('u');
    const v = await insertUser('v');
    const w = await insertUser('w');
    await addMembership(orgA, u.id, 'admin');
    await addMembership(orgA, v.id, 'owner');
    await addMembership(orgB, w.id, 'owner');
    // u also has a pending invitation to B.
    await pool.query(
      `INSERT INTO organization_memberships (organization_id, user_id, role, joined_at, is_active, invitation_token)
       VALUES ($1, $2, 'owner', NOW(), true, $3)`,
      [orgB, u.id, `tok-${uniqueSuffix()}`]
    );

    expect(await getCurrentMembership(pool, orgA, u.id)).toEqual({ role: 'admin', email: u.email });
    expect(await getCurrentMembership(pool, orgA, v.id)).toEqual({ role: 'owner', email: v.email });
    expect(await getCurrentMembership(pool, orgB, u.id)).toBeNull(); // pending only
    expect(await getCurrentMembership(pool, orgA, w.id)).toBeNull(); // member elsewhere
    expect(await getCurrentMembership(pool, orgB, v.id)).toBeNull();
    expect(await getCurrentMembership(pool, u.id, orgA)).toBeNull(); // ids swapped
    expect(await getCurrentMembership(pool, orgA, randomUUID())).toBeNull();
    expect(await getCurrentMembership(pool, randomUUID(), u.id)).toBeNull();
  });
});

// ─── Token validation (unchanged) ───────────────────────────────────────────

describe('token validation', () => {
  it('a refresh token is not accepted as an access token', async () => {
    const { orgId, user } = await setup('member');
    const { refreshToken } = await authService.generateTokenPair({ userId: user.id, email: user.email, organizationId: orgId, role: 'member' });
    const res = await call(refreshToken, 'GET', '/probe/whoami');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid token type');
  });

  it.each([
    ['a malformed organization id', (userId: string) => accessToken(userId, 'not-a-uuid')],
    ['no organization id', (userId: string) => accessToken(userId, undefined)],
    ['a malformed user id', () => accessToken('user-1', randomUUID())],
  ])('%s is an invalid token, rejected before any database work', async (_label, makeToken) => {
    const { user } = await setup('member');
    const connect = jest.spyOn(appPool, 'connect');
    const res = await call(makeToken(user.id), 'GET', '/probe/whoami');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ success: false, error: 'Invalid authentication token' });
    expect(connect).not.toHaveBeenCalled();
  });

  it('an expired token still reports TOKEN_EXPIRED', async () => {
    const { orgId, user } = await setup('member');
    const expired = jwt.sign(
      { userId: user.id, email: user.email, organizationId: orgId, role: 'member', type: 'access' },
      jwtSecret,
      { expiresIn: -10 }
    );
    const res = await call(expired, 'GET', '/probe/whoami');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('TOKEN_EXPIRED');
  });

  it('no token is still a 401', async () => {
    expect((await call(null, 'GET', '/probe/whoami')).status).toBe(401);
  });
});

// ─── Infrastructure failures ────────────────────────────────────────────────

describe('when membership cannot be checked', () => {
  it('a connection failure is a 503 AUTH_UNAVAILABLE, not a 401', async () => {
    const { orgId, user } = await setup('member');
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(appPool, 'connect').mockRejectedValue(new Error('timeout exceeded when trying to connect') as never);

    const res = await call(accessToken(user.id, orgId), 'GET', '/probe/whoami');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ success: false, error: 'Authentication temporarily unavailable', code: AUTH_UNAVAILABLE_CODE });
    expect(probeHandlerCalls).toBe(0);
  });

  it('a failed lookup is a 503 that leaks no database text, and the connection is discarded', async () => {
    const { orgId, user } = await setup('member');
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest
      .spyOn(organizationAuthorization, 'getCurrentMembership')
      .mockRejectedValue(new Error('relation "organization_memberships" does not exist'));
    const sql = recordAppSql();

    const res = await call(accessToken(user.id, orgId), 'GET', '/probe/whoami');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe(AUTH_UNAVAILABLE_CODE);
    expect(res.text).not.toMatch(/relation|organization_memberships/);
    expect(sql.some(isTenantTag)).toBe(false);
    expect(probeHandlerCalls).toBe(0);
  });
});

// ─── Routes that must keep working (none is exempt) ─────────────────────────

describe('auth and onboarding routes', () => {
  it('/me answers for a current member and refuses a lost organization', async () => {
    const { orgId, ownerId, user } = await setup('member');
    const token = accessToken(user.id, orgId, 'member');
    const me = await call(token, 'GET', '/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data.organizations.map((o: any) => o.id)).toContain(orgId);

    await organizationService.removeUser(orgId, ownerId, user.id);
    const after = await call(token, 'GET', '/api/auth/me');
    expect(after.status).toBe(401);
    expect(after.body).toEqual(REVOKED_BODY);
  });

  it('refresh still works for a valid session and still rejects a removed membership', async () => {
    const { orgId, ownerId, user } = await setup('member');
    const first = await authService.generateTokenPair({ userId: user.id, email: user.email, organizationId: orgId, role: 'member' });
    const refreshed = await call(null, 'POST', '/api/auth/refresh', { refreshToken: first.refreshToken });
    expect(refreshed.status).toBe(200);
    expect((await call(refreshed.body.data.accessToken, 'GET', '/probe/whoami')).status).toBe(200);

    await organizationService.removeUser(orgId, ownerId, user.id);
    const rejected = await call(null, 'POST', '/api/auth/refresh', { refreshToken: refreshed.body.data.refreshToken });
    expect(rejected.status).toBe(401);
  });

  it('logout revokes the session for a current member; a removed member is refused like any other route', async () => {
    const { orgId, ownerId, user } = await setup('member');
    const session = await authService.generateTokenPair({ userId: user.id, email: user.email, organizationId: orgId, role: 'member' });
    const out = await call(session.accessToken, 'POST', '/api/auth/logout');
    expect(out.status).toBe(200);
    expect((await call(null, 'POST', '/api/auth/refresh', { refreshToken: session.refreshToken })).status).toBe(401);

    const second = await authService.generateTokenPair({ userId: user.id, email: user.email, organizationId: orgId, role: 'member' });
    await organizationService.removeUser(orgId, ownerId, user.id);
    const refused = await call(second.accessToken, 'POST', '/api/auth/logout');
    expect(refused.status).toBe(401);
    expect(refused.body).toEqual(REVOKED_BODY);
  });

  it('a member of one organization can accept an invitation to another', async () => {
    const home = await setup('member');
    const target = await setup('admin');
    const ownerToken = accessToken(target.ownerId, target.orgId, 'owner');
    const invite = await call(ownerToken, 'POST', `/api/organizations/${target.orgId}/invite`, {
      email: home.user.email,
      role: 'viewer',
    });
    expect(invite.status).toBe(200);
    const { rows } = await pool.query(
      'SELECT invitation_token FROM organization_memberships WHERE organization_id = $1 AND user_id = $2',
      [target.orgId, home.user.id]
    );

    const accepted = await call(accessToken(home.user.id, home.orgId, 'member'), 'POST', '/api/organizations/accept-invitation', {
      invitationToken: rows[0].invitation_token,
    });
    expect(accepted.status).toBe(200);
    expect(await getCurrentMembership(pool, target.orgId, home.user.id)).toEqual({ role: 'viewer', email: home.user.email });
  });

  it('a current member can create an organization', async () => {
    const { orgId, user } = await setup('member');
    const res = await call(accessToken(user.id, orgId, 'member'), 'POST', '/api/organizations', {
      name: `Created ${uniqueSuffix()}`,
      slug: `created-${uniqueSuffix()}`,
      displayName: 'Created Organization',
    });
    expect(res.status).toBe(201);
    createdOrgIds.push(res.body.data.id);
  });
});

// ─── Caller disconnects during authentication ───────────────────────────────

describe('caller disconnects while membership is being checked', () => {
  it('nothing more runs on the released connection, and the next request keeps its own tag', async () => {
    const { orgId, user } = await setup('member');
    const otherOrgId = randomUUID();

    type Recorded = { client: PoolClient; text: string; params: unknown[] };
    const statements: Recorded[] = [];
    const restore: Array<() => void> = [];
    let releasedClient: PoolClient | null = null;
    let onRelease!: () => void;
    const releasedSignal = new Promise<void>((resolve) => { onRelease = resolve; });

    const realConnect = appPool.connect.bind(appPool) as () => Promise<PoolClient>;
    jest.spyOn(appPool, 'connect').mockImplementation((async () => {
      const client = await realConnect();
      const clientQuery = client.query;
      const clientRelease = client.release;
      client.query = ((q: unknown, ...rest: unknown[]) => {
        const text = typeof q === 'string' ? q : (q as { text?: string }).text ?? String(q);
        statements.push({ client, text, params: (rest[0] as unknown[]) ?? [] });
        return (clientQuery as (...args: unknown[]) => unknown).call(client, q, ...rest);
      }) as typeof client.query;
      client.release = ((err?: Error | boolean) => {
        client.release = clientRelease;
        releasedClient = client;
        onRelease();
        return clientRelease.call(client, err);
      }) as typeof client.release;
      restore.push(() => { client.query = clientQuery; });
      return client;
    }) as unknown as typeof appPool.connect);

    // The lookup finishes only once the caller is gone and another request
    // holds the same connection.
    let openLookup!: () => void;
    const lookupGate = new Promise<void>((resolve) => { openLookup = resolve; });
    const realLookup = organizationAuthorization.getCurrentMembership;
    jest.spyOn(organizationAuthorization, 'getCurrentMembership').mockImplementation(async (executor, organizationId, userId) => {
      const result = await realLookup(executor, organizationId, userId);
      await lookupGate;
      return result;
    });

    let other: PoolClient | null = null;
    try {
      const abort = new AbortController();
      const request = fetch(`${baseUrl}/probe/whoami`, {
        headers: { Authorization: `Bearer ${accessToken(user.id, orgId, 'member')}` },
        signal: abort.signal,
      }).catch(() => 'aborted');
      while (!statements.some((s) => isMembershipLookup(s.text))) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      abort.abort();
      await request;
      await releasedSignal;

      // The next checkout gets the same connection and tags it for its own org.
      other = await realConnect();
      expect(other).toBe(releasedClient);
      await other.query("SELECT set_config('app.current_organization_id', $1, false)", [otherOrgId]);

      openLookup();
      // Let authenticate finish whatever it would still do.
      await new Promise((resolve) => setTimeout(resolve, 200));

      const lateTags = statements.filter((s) => isTenantTag(s.text) && s.params[0] === orgId);
      expect(lateTags).toEqual([]);
      expect(statements.some((s) => /api_usage/i.test(s.text))).toBe(false);
      expect(probeHandlerCalls).toBe(0);
      const { rows } = await other.query("SELECT current_setting('app.current_organization_id', true) AS tag");
      expect(rows[0].tag).toBe(otherOrgId);
    } finally {
      restore.forEach((undo) => undo());
      if (other) {
        await other.query("SELECT set_config('app.current_organization_id', '', false)");
        other.release();
      }
    }
  });
});
