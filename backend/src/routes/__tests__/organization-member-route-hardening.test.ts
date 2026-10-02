/**
 * Member role-change and removal routes: a malformed :userId is refused with
 * a stable 400 before any query of the member's data (only authentication's
 * own per-request SQL runs), authorization still runs first and
 * is unchanged, a valid id still works end to end (with its audit event), and
 * an unexpected error never reaches the client as raw database text.
 *
 * Real routes, controllers and services over an in-process HTTP server against
 * live Postgres; only authService.verifyToken (to choose the caller) is stubbed.
 */
import express from 'express';
import http from 'http';
import { Pool, DatabaseError } from 'pg';
import organizationRoutes from '../organizations.routes';
import { authService } from '../../services/auth.service';
import { organizationService } from '../../services/organization.service';
import { pool as appPool } from '../../config/database';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'platform_portal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});
const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

const SAFE_INVALID_ID = { success: false, error: 'Validation failed', details: 'userId: Invalid member ID format' };
const MALFORMED_IDS = ['undefined', 'not-a-uuid', "1' OR '1'='1", '12345'];
const DB_TEXT = /uuid|syntax|22P02|SQL|postgres|relation|column/i;

function suffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function buildOrg() {
  const s = suffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, max_services, max_users)
     VALUES ($1, $2, $1, 'enterprise', 10, 50) RETURNING id`,
    [`Member Hardening ${s}`, `member-hardening-${s}`]
  );
  const orgId: string = rows[0].id;
  createdOrgIds.push(orgId);
  const member = async (role: string) => {
    const u = await pool.query(
      `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Member Hardening User') RETURNING id`,
      [`member-hardening-${role}-${suffix()}@example.com`]
    );
    createdUserIds.push(u.rows[0].id);
    await pool.query(
      `INSERT INTO organization_memberships (organization_id, user_id, role, joined_at, is_active) VALUES ($1, $2, $3, NOW(), true)`,
      [orgId, u.rows[0].id, role]
    );
    return u.rows[0].id as string;
  };
  return { orgId, owner: await member('owner'), admin: await member('admin'), member: await member('member') };
}

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/organizations', organizationRoutes);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api`;
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.query('DELETE FROM audit_logs WHERE organization_id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM organization_memberships WHERE organization_id = ANY($1) OR user_id = ANY($2)', [createdOrgIds, createdUserIds]);
  await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds]);
  await pool.end();
});

/** Requests as `userId` in `orgId` with the given JWT role. */
function as(userId: string, orgId: string, jwtRole: string) {
  return async (method: string, path: string, body?: unknown) => {
    jest.spyOn(authService, 'verifyToken').mockReturnValue({
      userId, email: 'member-hardening-caller@example.com', organizationId: orgId, role: jwtRole, type: 'access',
    } as unknown as ReturnType<typeof authService.verifyToken>);
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, text, body: JSON.parse(text) };
  };
}

/**
 * Records every SQL statement run on any connection the app's pool checks out
 * during a request (restored before it returns to the pool). Inside an
 * authenticated request, config/database routes pool.query() to the request's
 * own checked-out client, so this sees those statements too.
 */
function recordAppSql(): string[] {
  const statements: string[] = [];
  const text = (q: unknown) => (typeof q === 'string' ? q : (q as { text?: string } | null)?.text ?? String(q));
  const realConnect = appPool.connect.bind(appPool) as () => Promise<import('pg').PoolClient>;
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

/**
 * Tables the member routes read or write. authenticate() itself runs SQL on
 * every request (the tenant tag, API-usage metering) -- that is not a lookup
 * of the member.
 */
const MEMBER_TABLES = /organization_memberships|\busers\b|audit_logs/i;

async function roleOf(orgId: string, userId: string): Promise<string | null> {
  const { rows } = await pool.query('SELECT role FROM organization_memberships WHERE organization_id = $1 AND user_id = $2', [orgId, userId]);
  return rows[0]?.role ?? null;
}

async function auditRows(orgId: string, action: string) {
  const { rows } = await pool.query(
    `SELECT user_id, resource_type, changes, metadata FROM audit_logs WHERE organization_id = $1 AND action = $2`,
    [orgId, action]
  );
  return rows;
}

describe('malformed :userId', () => {
  it.each(MALFORMED_IDS)('role change with %j: 400, only the safe message, and no membership lookup or mutation', async (bad) => {
    const org = await buildOrg();
    const sql = recordAppSql();
    const service = jest.spyOn(organizationService, 'updateUserRole');

    const res = await as(org.owner, org.orgId, 'owner')('PATCH', `/organizations/${org.orgId}/members/${encodeURIComponent(bad)}/role`, { role: 'viewer' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual(SAFE_INVALID_ID);
    expect(res.text).not.toMatch(DB_TEXT);
    expect(service).not.toHaveBeenCalled();
    // authenticate() ran (its tenant tag is recorded), but nothing touched the member's data.
    expect(sql.some((statement) => statement.includes('app.current_organization_id'))).toBe(true);
    expect(sql.filter((statement) => MEMBER_TABLES.test(statement))).toEqual([]);
    expect(await roleOf(org.orgId, org.member)).toBe('member');
  });

  it.each(MALFORMED_IDS)('removal with %j: 400, only the safe message, and no membership lookup or mutation', async (bad) => {
    const org = await buildOrg();
    const sql = recordAppSql();
    const service = jest.spyOn(organizationService, 'removeUser');

    const res = await as(org.owner, org.orgId, 'owner')('DELETE', `/organizations/${org.orgId}/members/${encodeURIComponent(bad)}`);

    expect(res.status).toBe(400);
    expect(res.body).toEqual(SAFE_INVALID_ID);
    expect(res.text).not.toMatch(DB_TEXT);
    expect(service).not.toHaveBeenCalled();
    // authenticate() ran (its tenant tag is recorded), but nothing touched the member's data.
    expect(sql.some((statement) => statement.includes('app.current_organization_id'))).toBe(true);
    expect(sql.filter((statement) => MEMBER_TABLES.test(statement))).toEqual([]);
  });

  it('authorization still runs first: a non-admin gets 403 and another organization gets 404, malformed id or not', async () => {
    const org = await buildOrg();
    const asMember = as(org.member, org.orgId, 'member');
    expect((await asMember('PATCH', `/organizations/${org.orgId}/members/undefined/role`, { role: 'viewer' })).status).toBe(403);
    expect((await asMember('DELETE', `/organizations/${org.orgId}/members/undefined`)).status).toBe(403);
    const other = await buildOrg();
    expect((await as(org.owner, org.orgId, 'owner')('PATCH', `/organizations/${other.orgId}/members/undefined/role`, { role: 'viewer' })).status).toBe(404);
  });
});

describe('a valid id still works, with its audit event', () => {
  it('role change persists and writes exactly one organization_membership.role_changed event', async () => {
    const org = await buildOrg();
    const res = await as(org.owner, org.orgId, 'owner')('PATCH', `/organizations/${org.orgId}/members/${org.member}/role`, { role: 'viewer' });
    expect(res.status).toBe(200);
    expect(await roleOf(org.orgId, org.member)).toBe('viewer');
    const rows = await auditRows(org.orgId, 'organization_membership.role_changed');
    expect(rows).toEqual([{ user_id: org.owner, resource_type: 'organization_membership', changes: { from: 'member', to: 'viewer' }, metadata: { userId: org.member } }]);
  });

  it('removal deletes the membership and writes exactly one organization_membership.removed event', async () => {
    const org = await buildOrg();
    const res = await as(org.admin, org.orgId, 'admin')('DELETE', `/organizations/${org.orgId}/members/${org.member}`);
    expect(res.status).toBe(200);
    expect(await roleOf(org.orgId, org.member)).toBeNull();
    const rows = await auditRows(org.orgId, 'organization_membership.removed');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: org.admin, metadata: { userId: org.member, role: 'member', pendingInvitation: false } });
  });

  it('existing refusals keep their status and message (unchanged policy)', async () => {
    const org = await buildOrg();
    const self = await as(org.owner, org.orgId, 'owner')('PATCH', `/organizations/${org.orgId}/members/${org.owner}/role`, { role: 'member' });
    expect(self).toMatchObject({ status: 403, body: { success: false, error: 'You cannot change your own role' } });
    const adminOnOwner = await as(org.admin, org.orgId, 'admin')('DELETE', `/organizations/${org.orgId}/members/${org.owner}`);
    expect(adminOnOwner).toMatchObject({ status: 403, body: { success: false, error: 'Insufficient permissions to remove this member' } });
    const notMember = await as(org.owner, org.orgId, 'owner')('PATCH', `/organizations/${org.orgId}/members/${(await buildOrg()).member}/role`, { role: 'viewer' });
    expect(notMember).toMatchObject({ status: 404, body: { success: false, error: 'User is not a member of this organization' } });
  });
});

describe('unexpected errors never reach the client as database text', () => {
  const pgError = () => Object.assign(new DatabaseError('invalid input syntax for type uuid: "x"', 0, 'error'), { code: '22P02' });

  it('role change: a database error becomes a logged, generic 500', async () => {
    const org = await buildOrg();
    jest.spyOn(organizationService, 'updateUserRole').mockRejectedValue(pgError());
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await as(org.owner, org.orgId, 'owner')('PATCH', `/organizations/${org.orgId}/members/${org.member}/role`, { role: 'viewer' });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Failed to update user role' });
    expect(res.text).not.toMatch(DB_TEXT);
    expect(log).toHaveBeenCalledWith('[Organizations] Failed to update user role:', expect.any(DatabaseError));
  });

  it('removal: a database error becomes a logged, generic 500', async () => {
    const org = await buildOrg();
    jest.spyOn(organizationService, 'removeUser').mockRejectedValue(pgError());
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await as(org.owner, org.orgId, 'owner')('DELETE', `/organizations/${org.orgId}/members/${org.member}`);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Failed to remove user' });
    expect(res.text).not.toMatch(DB_TEXT);
    expect(log).toHaveBeenCalledWith('[Organizations] Failed to remove user:', expect.any(DatabaseError));
  });
});
