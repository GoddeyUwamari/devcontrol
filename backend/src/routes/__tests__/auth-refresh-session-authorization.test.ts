/**
 * POST /api/auth/refresh -- session and current-membership authorization.
 *
 * Drives the real /api/auth routes over HTTP against live Postgres, with
 * sessions created by the real AuthService (generateTokenPair / login), so
 * the stored session rows, token hashes and membership lookups are the
 * production ones. Nothing in the auth path is stubbed.
 *
 * Policy under test (AuthService.refreshAccessToken):
 *   - the refresh token only locates a session; the session's user and
 *     organization come from the stored session row
 *   - role and email in newly issued tokens come from the CURRENT
 *     membership/user rows, never from the presented token
 *   - no active accepted membership, inactive/deleted user, or inactive
 *     organization -> rejected, and that session is revoked
 *   - each refresh token can be exchanged once
 *   - every post-verification rejection returns the same response
 */
import express from 'express';
import http from 'http';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import authRoutes from '../auth.routes';
import { authService, AuthService, SESSION_REVOKED_MESSAGE } from '../../services/auth.service';
import { organizationService } from '../../services/organization.service';
import { encryptionService } from '../../services/encryption.service';

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

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function insertOrg(): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, max_services, max_users)
     VALUES ($1, $2, $3, 'pro', 10, 20) RETURNING id`,
    [`RefreshAuthz ${suffix}`, `refresh-authz-${suffix}`, `RefreshAuthz ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function insertUser(label = 'user'): Promise<{ id: string; email: string }> {
  const email = `refresh-authz-${label}-${uniqueSuffix()}@example.com`;
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, $2, 'Refresh Authz User') RETURNING id`,
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

/** An org with an owner plus one user holding `role`, and a session for that user. */
async function setup(role = 'admin') {
  const orgId = await insertOrg();
  const owner = await insertUser('owner');
  await addMembership(orgId, owner.id, 'owner');
  const user = await insertUser(role);
  await addMembership(orgId, user.id, role);
  const tokens = await authService.generateTokenPair({
    userId: user.id,
    email: user.email,
    organizationId: orgId,
    role,
  });
  return { orgId, ownerId: owner.id, user, tokens };
}

async function refresh(refreshToken: unknown) {
  const res = await fetch(`${baseUrl}/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  return { status: res.status, body: (await res.json()) as any };
}

function claims(token: string): any {
  return jwt.verify(token, jwtSecret);
}

async function sessionRow(refreshToken: string) {
  const { rows } = await pool.query(
    `SELECT s.is_active, s.revoked_at
     FROM sessions s
     WHERE s.user_id = $1 AND s.organization_id = $2
     ORDER BY s.created_at DESC LIMIT 1`,
    [claims(refreshToken).userId, claims(refreshToken).organizationId]
  );
  return rows[0];
}

function expectRejected(result: { status: number; body: any }) {
  expect(result.status).toBe(401);
  expect(result.body.success).toBe(false);
  expect(result.body.data).toBeUndefined();
}

/** Same response for every rejection after the token itself verifies. */
function expectSessionRejected(result: { status: number; body: any }) {
  expectRejected(result);
  expect(result.body).toEqual({ success: false, error: SESSION_REVOKED_MESSAGE });
}

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  passwordHash = await bcrypt.hash(PASSWORD, 4);
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}/api/auth`;
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

describe('valid refresh', () => {
  it('an active member refreshes; new tokens carry current identity and role', async () => {
    const { orgId, user, tokens } = await setup('member');

    const result = await refresh(tokens.refreshToken);

    expect(result.status).toBe(200);
    const access = claims(result.body.data.accessToken);
    const next = claims(result.body.data.refreshToken);
    for (const c of [access, next]) {
      expect(c).toMatchObject({ userId: user.id, email: user.email, organizationId: orgId, role: 'member' });
    }
    expect(access.type).toBe('access');
    expect(next.type).toBe('refresh');
  });

  it('a session issued by login refreshes', async () => {
    const orgId = await insertOrg();
    const user = await insertUser('login');
    await addMembership(orgId, user.id, 'viewer');
    const login = await authService.login(user.email, PASSWORD);

    const result = await refresh(login.refreshToken);

    expect(result.status).toBe(200);
    expect(claims(result.body.data.accessToken)).toMatchObject({ organizationId: orgId, role: 'viewer' });
  });

  it('the rotated token keeps refreshing; the one it replaced does not', async () => {
    const { tokens } = await setup('member');

    const first = await refresh(tokens.refreshToken);
    expect(first.status).toBe(200);
    const second = await refresh(first.body.data.refreshToken);
    expect(second.status).toBe(200);

    expectSessionRejected(await refresh(tokens.refreshToken));
  });

  it('concurrent use of one refresh token succeeds at most once', async () => {
    const { tokens } = await setup('member');

    const results = await Promise.all(Array.from({ length: 5 }, () => refresh(tokens.refreshToken)));

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    for (const r of results.filter((r) => r.status !== 200)) {
      expectSessionRejected(r);
    }
  });
});

describe('role changes are reflected at refresh', () => {
  it.each([
    ['admin', 'viewer'],
    ['admin', 'member'],
    ['viewer', 'admin'],
    ['member', 'owner'],
  ])('%s -> %s: refreshed tokens carry the current role', async (from, to) => {
    const { orgId, user, tokens } = await setup(from);
    await pool.query(
      'UPDATE organization_memberships SET role = $1 WHERE organization_id = $2 AND user_id = $3',
      [to, orgId, user.id]
    );

    const result = await refresh(tokens.refreshToken);

    expect(result.status).toBe(200);
    expect(claims(result.body.data.accessToken).role).toBe(to);
    expect(claims(result.body.data.refreshToken).role).toBe(to);
  });

  it('a demotion through OrganizationService.updateUserRole is reflected', async () => {
    const { orgId, ownerId, user, tokens } = await setup('admin');
    await organizationService.updateUserRole(orgId, ownerId, user.id, 'viewer');

    const result = await refresh(tokens.refreshToken);

    expect(result.status).toBe(200);
    expect(claims(result.body.data.accessToken).role).toBe('viewer');
  });

  it('a role claim altered in a re-signed token does not survive refresh', async () => {
    const { tokens } = await setup('viewer');
    const tampered = jwt.sign({ ...claims(tokens.refreshToken), role: 'owner' }, jwtSecret);

    // Different token -> different hash -> no session.
    expectSessionRejected(await refresh(tampered));
  });

  it('the current email is used, not the one in the token', async () => {
    const { user, tokens } = await setup('member');
    const newEmail = `refresh-authz-renamed-${uniqueSuffix()}@example.com`;
    await pool.query('UPDATE users SET email = $1 WHERE id = $2', [newEmail, user.id]);

    const result = await refresh(tokens.refreshToken);

    expect(result.status).toBe(200);
    expect(claims(result.body.data.accessToken).email).toBe(newEmail);
  });
});

describe('loss of authorization rejects and revokes the session', () => {
  it('membership deactivated', async () => {
    const { orgId, user, tokens } = await setup('admin');
    await pool.query(
      'UPDATE organization_memberships SET is_active = false WHERE organization_id = $1 AND user_id = $2',
      [orgId, user.id]
    );

    expectSessionRejected(await refresh(tokens.refreshToken));
    expect(await sessionRow(tokens.refreshToken)).toMatchObject({ is_active: false });
    expect((await sessionRow(tokens.refreshToken)).revoked_at).not.toBeNull();

    // Reactivating the membership does not revive the revoked session.
    await pool.query(
      'UPDATE organization_memberships SET is_active = true WHERE organization_id = $1 AND user_id = $2',
      [orgId, user.id]
    );
    expectSessionRejected(await refresh(tokens.refreshToken));
  });

  it('membership removed through OrganizationService.removeUser', async () => {
    const { orgId, ownerId, user, tokens } = await setup('member');
    await organizationService.removeUser(orgId, ownerId, user.id);

    expectSessionRejected(await refresh(tokens.refreshToken));
    expect(await sessionRow(tokens.refreshToken)).toMatchObject({ is_active: false });
  });

  it('membership reverted to a pending invitation', async () => {
    const { orgId, user, tokens } = await setup('member');
    await pool.query(
      `UPDATE organization_memberships
       SET invitation_token = $1, invitation_expires_at = NOW() + interval '1 day'
       WHERE organization_id = $2 AND user_id = $3`,
      [`pending-${uniqueSuffix()}`, orgId, user.id]
    );

    expectSessionRejected(await refresh(tokens.refreshToken));
  });

  it('user deactivated', async () => {
    const { user, tokens } = await setup('owner');
    await pool.query('UPDATE users SET is_active = false WHERE id = $1', [user.id]);

    expectSessionRejected(await refresh(tokens.refreshToken));
    expect(await sessionRow(tokens.refreshToken)).toMatchObject({ is_active: false });
  });

  it('user soft-deleted', async () => {
    const { user, tokens } = await setup('member');
    await pool.query('UPDATE users SET deleted_at = NOW() WHERE id = $1', [user.id]);

    expectSessionRejected(await refresh(tokens.refreshToken));
  });

  it('organization deactivated', async () => {
    const { orgId, tokens } = await setup('member');
    await pool.query('UPDATE organizations SET is_active = false WHERE id = $1', [orgId]);

    expectSessionRejected(await refresh(tokens.refreshToken));
  });

  it('organization soft-deleted', async () => {
    const { orgId, tokens } = await setup('member');
    await pool.query('UPDATE organizations SET deleted_at = NOW() WHERE id = $1', [orgId]);

    expectSessionRejected(await refresh(tokens.refreshToken));
  });
});

describe('tenant isolation', () => {
  it('a membership elsewhere does not keep a session alive in the organization it was lost in', async () => {
    const { orgId, user, tokens } = await setup('admin');
    const otherOrgId = await insertOrg();
    await addMembership(otherOrgId, user.id, 'owner');
    await pool.query(
      'DELETE FROM organization_memberships WHERE organization_id = $1 AND user_id = $2',
      [orgId, user.id]
    );

    expectSessionRejected(await refresh(tokens.refreshToken));
  });

  it('never inherits a role from another organization', async () => {
    const { orgId, user, tokens } = await setup('viewer');
    const otherOrgId = await insertOrg();
    await addMembership(otherOrgId, user.id, 'owner');

    const result = await refresh(tokens.refreshToken);

    expect(result.status).toBe(200);
    expect(claims(result.body.data.accessToken)).toMatchObject({ organizationId: orgId, role: 'viewer' });
  });

  it('an organization claim re-signed to another org the user belongs to is rejected', async () => {
    const { user, tokens } = await setup('viewer');
    const otherOrgId = await insertOrg();
    await addMembership(otherOrgId, user.id, 'owner');
    const switched = jwt.sign(
      { ...claims(tokens.refreshToken), organizationId: otherOrgId, role: 'owner' },
      jwtSecret
    );

    expectSessionRejected(await refresh(switched));
  });

  it('a session whose stored organization disagrees with the token is rejected and revoked', async () => {
    const { user, tokens } = await setup('member');
    const otherOrgId = await insertOrg();
    await addMembership(otherOrgId, user.id, 'owner');
    await pool.query('UPDATE sessions SET organization_id = $1 WHERE user_id = $2', [otherOrgId, user.id]);

    expectSessionRejected(await refresh(tokens.refreshToken));
    const { rows } = await pool.query('SELECT is_active FROM sessions WHERE user_id = $1', [user.id]);
    expect(rows.every((r) => r.is_active === false)).toBe(true);
  });

  it("another user's identity cannot be claimed", async () => {
    const { tokens } = await setup('member');
    const { user: victim } = await setup('owner');
    const forged = jwt.sign({ ...claims(tokens.refreshToken), userId: victim.id }, jwtSecret);

    expectSessionRejected(await refresh(forged));
  });
});

describe('token validity', () => {
  it('an expired refresh token is rejected', async () => {
    const { tokens } = await setup('member');
    const { exp, iat, ...rest } = claims(tokens.refreshToken);
    const expired = jwt.sign({ ...rest, exp: Math.floor(Date.now() / 1000) - 60 }, jwtSecret);

    const result = await refresh(expired);
    expectRejected(result);
    expect(result.body.error).toBe('Token has expired');
  });

  it('a session past its stored refresh expiry is rejected even if the JWT has not expired', async () => {
    const { user, tokens } = await setup('member');
    await pool.query(
      "UPDATE sessions SET refresh_token_expires_at = NOW() - interval '1 minute' WHERE user_id = $1",
      [user.id]
    );

    expectSessionRejected(await refresh(tokens.refreshToken));
  });

  it.each([
    ['malformed', 'not-a-jwt'],
    ['empty-ish', ' '],
  ])('a %s token is rejected', async (_label, token) => {
    expectRejected(await refresh(token));
  });

  it('a token with a tampered signature is rejected', async () => {
    const { tokens } = await setup('member');
    const [h, p, s] = tokens.refreshToken.split('.');
    const tampered = `${h}.${p}.${s.slice(0, -2)}${s.endsWith('AA') ? 'BB' : 'AA'}`;

    const result = await refresh(tampered);
    expectRejected(result);
    expect(result.body.error).toBe('Invalid token');
  });

  it('a token signed with another secret is rejected', async () => {
    const { tokens } = await setup('member');
    const { exp, iat, ...rest } = claims(tokens.refreshToken);

    expectRejected(await refresh(jwt.sign(rest, 'not-the-server-secret', { expiresIn: '1h' })));
  });

  it('an access token cannot be used to refresh', async () => {
    const { tokens } = await setup('member');

    const result = await refresh(tokens.accessToken);
    expectRejected(result);
    expect(result.body.error).toBe('Invalid token type');
  });

  it('a missing refresh token is a 400', async () => {
    const result = await refresh(undefined);
    expect(result.status).toBe(400);
  });
});

describe('logout and multiple sessions', () => {
  it('a logged-out session cannot refresh', async () => {
    const { tokens } = await setup('member');
    await authService.logout(tokens.accessToken);

    expectSessionRejected(await refresh(tokens.refreshToken));
  });

  it('logging out one session leaves the user\'s other sessions usable', async () => {
    const { orgId, user, tokens } = await setup('member');
    const second = await authService.generateTokenPair({
      userId: user.id,
      email: user.email,
      organizationId: orgId,
      role: 'member',
    });
    await authService.logout(tokens.accessToken);

    expectSessionRejected(await refresh(tokens.refreshToken));
    expect((await refresh(second.refreshToken)).status).toBe(200);
  });

  it('losing one organization revokes only that organization\'s session', async () => {
    const { orgId, user, tokens } = await setup('member');
    const otherOrgId = await insertOrg();
    await addMembership(otherOrgId, user.id, 'admin');
    const otherTokens = await authService.generateTokenPair({
      userId: user.id,
      email: user.email,
      organizationId: otherOrgId,
      role: 'admin',
    });
    await pool.query(
      'DELETE FROM organization_memberships WHERE organization_id = $1 AND user_id = $2',
      [orgId, user.id]
    );

    expectSessionRejected(await refresh(tokens.refreshToken));
    const other = await refresh(otherTokens.refreshToken);
    expect(other.status).toBe(200);
    expect(claims(other.body.data.accessToken)).toMatchObject({ organizationId: otherOrgId, role: 'admin' });
  });

  it("revoking one user's session does not affect another user in the same organization", async () => {
    const { orgId, user, tokens } = await setup('member');
    const colleague = await insertUser('colleague');
    await addMembership(orgId, colleague.id, 'member');
    const colleagueTokens = await authService.generateTokenPair({
      userId: colleague.id,
      email: colleague.email,
      organizationId: orgId,
      role: 'member',
    });
    await pool.query(
      'UPDATE organization_memberships SET is_active = false WHERE organization_id = $1 AND user_id = $2',
      [orgId, user.id]
    );

    expectSessionRejected(await refresh(tokens.refreshToken));
    expect((await refresh(colleagueTokens.refreshToken)).status).toBe(200);
  });
});

describe('tokens issued before jti was added', () => {
  it('a refresh token without jti still refreshes, and the new tokens carry a jti', async () => {
    const orgId = await insertOrg();
    const user = await insertUser('legacy');
    await addMembership(orgId, user.id, 'member');

    // Token format and session row as issued before tokens carried a jti.
    const legacyClaims = { userId: user.id, email: user.email, organizationId: orgId, role: 'member' };
    const legacyAccess = jwt.sign({ ...legacyClaims, type: 'access' }, jwtSecret, { expiresIn: '7d' });
    const legacyRefresh = jwt.sign({ ...legacyClaims, type: 'refresh' }, jwtSecret, { expiresIn: '30d' });
    expect(claims(legacyRefresh).jti).toBeUndefined();
    await pool.query(
      `INSERT INTO sessions (user_id, organization_id, access_token_hash, refresh_token_hash,
                             access_token_expires_at, refresh_token_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        user.id,
        orgId,
        encryptionService.hash(legacyAccess),
        encryptionService.hash(legacyRefresh),
        new Date(claims(legacyAccess).exp * 1000),
        new Date(claims(legacyRefresh).exp * 1000),
      ]
    );

    const result = await refresh(legacyRefresh);

    expect(result.status).toBe(200);
    const access = claims(result.body.data.accessToken);
    const next = claims(result.body.data.refreshToken);
    expect(access).toMatchObject({ ...legacyClaims, type: 'access' });
    expect(next).toMatchObject({ ...legacyClaims, type: 'refresh' });
    expect(typeof access.jti).toBe('string');
    expect(typeof next.jti).toBe('string');
    expect(access.jti).not.toBe(next.jti);

    // The rotated (new-format) token keeps working; the legacy one is spent.
    expect((await refresh(result.body.data.refreshToken)).status).toBe(200);
    expectSessionRejected(await refresh(legacyRefresh));
  });
});

describe('absolute session lifetime (30 days from session creation)', () => {
  async function ageSession(userId: string, interval: string): Promise<void> {
    await pool.query(`UPDATE sessions SET created_at = NOW() - $1::interval WHERE user_id = $2`, [
      interval,
      userId,
    ]);
  }

  async function sessionDeadlineSeconds(userId: string): Promise<number> {
    const { rows } = await pool.query(
      `SELECT EXTRACT(EPOCH FROM created_at + interval '30 days')::bigint AS deadline
       FROM sessions WHERE user_id = $1`,
      [userId]
    );
    return Number(rows[0].deadline);
  }

  it('refresh fails once the session is older than 30 days', async () => {
    const { user, tokens } = await setup('member');
    await ageSession(user.id, '30 days 1 minute');

    expectSessionRejected(await refresh(tokens.refreshToken));
  });

  it('a refresh near the cap gets a token expiring no later than created_at + 30 days', async () => {
    const { user, tokens } = await setup('member');
    await ageSession(user.id, '29 days 23 hours');
    const deadline = await sessionDeadlineSeconds(user.id);

    const result = await refresh(tokens.refreshToken);

    expect(result.status).toBe(200);
    const exp = claims(result.body.data.refreshToken).exp;
    expect(exp).toBeLessThanOrEqual(deadline);
    // Roughly the hour that is left, not a fresh 30 days.
    expect(exp - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(60 * 60);

    const { rows } = await pool.query(
      'SELECT EXTRACT(EPOCH FROM refresh_token_expires_at)::bigint AS exp FROM sessions WHERE user_id = $1',
      [user.id]
    );
    expect(Number(rows[0].exp)).toBeLessThanOrEqual(deadline);
  });

  it('repeated refreshes do not slide the session past the cap', async () => {
    const { user, tokens } = await setup('member');
    await ageSession(user.id, '10 days');
    const deadline = await sessionDeadlineSeconds(user.id);

    let current = tokens.refreshToken;
    for (let i = 0; i < 3; i++) {
      const result = await refresh(current);
      expect(result.status).toBe(200);
      current = result.body.data.refreshToken;
      expect(claims(current).exp).toBeLessThanOrEqual(deadline);
    }
  });

  it('a fresh login starts a new 30-day window', async () => {
    const orgId = await insertOrg();
    const user = await insertUser('relogin');
    await addMembership(orgId, user.id, 'member');
    const first = await authService.login(user.email, PASSWORD);
    await ageSession(user.id, '30 days 1 minute');
    expectSessionRejected(await refresh(first.refreshToken));

    const second = await authService.login(user.email, PASSWORD);
    const result = await refresh(second.refreshToken);

    expect(result.status).toBe(200);
    const remaining = claims(result.body.data.refreshToken).exp - Math.floor(Date.now() / 1000);
    expect(remaining).toBeGreaterThan(29 * 24 * 60 * 60);
    expect(remaining).toBeLessThanOrEqual(30 * 24 * 60 * 60);
  });
});

describe('error responses', () => {
  it('an unexpected internal error is reported generically', async () => {
    const { tokens } = await setup('member');
    jest
      .spyOn(AuthService.prototype as any, 'getSessionAuthorization')
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED 10.0.0.5:5432'));

    const result = await refresh(tokens.refreshToken);

    expectRejected(result);
    expect(result.body.error).toBe('Token refresh failed');
    expect(JSON.stringify(result.body)).not.toContain('10.0.0.5');
  });
});
