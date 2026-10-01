/**
 * Authorization for the organization's AWS-account binding and its API keys.
 *
 * Policy under test:
 *   - GET /api/aws/accounts/connect-init and POST /api/aws/accounts are
 *     owner-only. POST /api/aws/accounts is the only path that binds an AWS
 *     account (a second POST is the 409 already-connected branch; there is no
 *     separate replace or disconnect route).
 *   - POST /api/keys and DELETE /api/keys/:id are owner/admin only.
 *   - Both are checked against the caller's CURRENT membership via
 *     requireCurrentRole (organization-authorization.ts): an active, accepted
 *     membership, an active non-deleted user, and an active non-deleted
 *     organization -- never the role claim in the JWT.
 *
 * Real routes over an in-process HTTP server against live Postgres. Only
 * authService.verifyToken (to choose the caller and JWT claims), STS, and the
 * background discovery kickoff are stubbed.
 */
import express from 'express';
import http from 'http';
import { Pool } from 'pg';
import awsRoutes from '../aws.routes';
import apiKeysRoutes from '../api-keys.routes';
import { authService } from '../../services/auth.service';
import { AWSResourceDiscoveryService } from '../../services/awsResourceDiscovery';
import { auditEvents, createAuditEventWriter } from '../../services/auditEvents.service';
import { requestContext } from '../../config/database';

jest.mock('@aws-sdk/client-sts', () => ({
  STSClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({}),
  })),
  AssumeRoleCommand: jest.fn().mockImplementation((input: unknown) => input),
}));

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
const fixtureTablesCreated: string[] = [];

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function uniqueAccountId(): string {
  return String(100000000000 + Math.floor(Math.random() * 899999999999));
}

async function tableExists(tableName: string): Promise<boolean> {
  const { rows } = await pool.query('SELECT to_regclass($1) AS reg', [`public.${tableName}`]);
  return rows[0].reg !== null;
}

// aws_accounts, aws_connect_sessions, and api_keys are not created by the
// canonical migrations CI bootstraps (see aws-connection-funnel-event.test.ts
// and .github/scripts/ci-bootstrap-schema.js). Create only what is missing,
// from the same shapes the routes read and write, and drop only what was
// created here.
async function ensureFixtureSchema(): Promise<void> {
  if (!(await tableExists('aws_accounts'))) {
    await pool.query(`
      CREATE TABLE aws_accounts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id UUID NOT NULL,
        role_arn TEXT NOT NULL,
        account_id VARCHAR(32) NOT NULL,
        nickname VARCHAR(255),
        external_id VARCHAR(64),
        region VARCHAR(32) DEFAULT 'us-east-1',
        connected_at TIMESTAMPTZ,
        status VARCHAR(32),
        CONSTRAINT aws_accounts_org_id_key UNIQUE (org_id),
        CONSTRAINT aws_accounts_account_id_key UNIQUE (account_id)
      )
    `);
    fixtureTablesCreated.push('aws_accounts');
  }
  if (!(await tableExists('aws_connect_sessions'))) {
    await pool.query(`
      CREATE TABLE aws_connect_sessions (
        org_id      UUID        PRIMARY KEY,
        external_id VARCHAR(64) NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at  TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '1 hour'
      )
    `);
    fixtureTablesCreated.push('aws_connect_sessions');
  }
  if (!(await tableExists('api_keys'))) {
    // The columns api-keys.routes.ts reads and writes, plus 026's organization_id.
    await pool.query(`
      CREATE TABLE api_keys (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        key_hash TEXT NOT NULL,
        prefix VARCHAR(20) NOT NULL,
        scopes TEXT[] NOT NULL DEFAULT '{}',
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_used_at TIMESTAMPTZ,
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE
      )
    `);
    fixtureTablesCreated.push('api_keys');
  }
}

async function insertOrg(): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $3, 'free', 'free') RETURNING id`,
    [`A3 Authz ${suffix}`, `a3-authz-${suffix}`, `A3 Authz ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function insertUser(label: string): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'A3 Authz User') RETURNING id`,
    [`a3-authz-${label}-${uniqueSuffix()}@example.com`]
  );
  createdUserIds.push(rows[0].id);
  return rows[0].id as string;
}

async function addMembership(orgId: string, userId: string, role: string): Promise<void> {
  await pool.query(
    `INSERT INTO organization_memberships (organization_id, user_id, role, joined_at, is_active)
     VALUES ($1, $2, $3, NOW(), true)`,
    [orgId, userId, role]
  );
}

async function member(orgId: string, role: string): Promise<string> {
  const userId = await insertUser(role);
  await addMembership(orgId, userId, role);
  return userId;
}

async function buildOrg() {
  const orgId = await insertOrg();
  return {
    orgId,
    owner: await member(orgId, 'owner'),
    admin: await member(orgId, 'admin'),
    member: await member(orgId, 'member'),
    viewer: await member(orgId, 'viewer'),
  };
}

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  await ensureFixtureSchema();
  const app = express();
  // Same as server.ts, so req.ip is the client address behind the proxy.
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/api/aws', awsRoutes);
  app.use('/api/keys', apiKeysRoutes);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}/api`;
});

beforeEach(() => {
  jest.spyOn(AWSResourceDiscoveryService.prototype, 'discoverAllResources').mockResolvedValue({
    job_id: 'stub-job',
    resources_discovered: 0,
    resources_updated: 0,
    resources_deleted: 0,
    errors: [],
  } as unknown as Awaited<ReturnType<AWSResourceDiscoveryService['discoverAllResources']>>);
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const table of ['aws_accounts', 'aws_connect_sessions']) {
    await pool.query(`DELETE FROM ${table} WHERE org_id = ANY($1)`, [createdOrgIds]);
  }
  await pool.query('DELETE FROM api_keys WHERE organization_id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM audit_logs WHERE organization_id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM analytics_events WHERE organization_id = ANY($1)', [createdOrgIds]);
  await pool.query(
    'DELETE FROM organization_memberships WHERE organization_id = ANY($1) OR user_id = ANY($2)',
    [createdOrgIds, createdUserIds]
  );
  await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds]);
  for (const table of fixtureTablesCreated) {
    await pool.query(`DROP TABLE IF EXISTS ${table}`);
  }
  await pool.end();
});

/**
 * Requests authenticated as `userId` in `orgId`. `jwtRole` is only the role
 * CLAIM in the token -- it defaults to 'owner' so every test proves the
 * decision comes from the caller's current membership, not the claim.
 */
function as(userId: string, orgId: string | undefined, jwtRole = 'owner') {
  const send = (method: string, path: string, body?: unknown) => {
    jest.spyOn(authService, 'verifyToken').mockReturnValue({
      userId,
      email: 'a3-authz-caller@example.com',
      organizationId: orgId,
      role: jwtRole,
      type: 'access',
    } as unknown as ReturnType<typeof authService.verifyToken>);
    return fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
        'X-Forwarded-For': '203.0.113.60',
        'User-Agent': 'A3AuditTest/1.0',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  };
  return {
    connectInit: () => send('GET', '/aws/accounts/connect-init'),
    connect: (extra: Record<string, unknown> = {}) =>
      send('POST', '/aws/accounts', {
        roleArn: `arn:aws:iam::${uniqueAccountId()}:role/DevControlRole-${uniqueSuffix()}`,
        ...extra,
      }),
    listKeys: () => send('GET', '/keys'),
    createKey: (extra: Record<string, unknown> = {}) => send('POST', '/keys', { name: 'ci', ...extra }),
    revokeKey: (id: string) => send('DELETE', `/keys/${id}`),
  };
}

function unauthenticated(method: string, path: string) {
  return fetch(`${baseUrl}${path}`, { method, headers: { 'Content-Type': 'application/json' } });
}

async function insertConnectSession(orgId: string): Promise<string> {
  const externalId = `ext-${uniqueSuffix()}`;
  await pool.query(
    `INSERT INTO aws_connect_sessions (org_id, external_id, created_at, expires_at)
     VALUES ($1, $2, NOW(), NOW() + interval '1 hour')
     ON CONFLICT (org_id) DO UPDATE SET external_id = EXCLUDED.external_id, expires_at = EXCLUDED.expires_at`,
    [orgId, externalId]
  );
  return externalId;
}

const SESSION_DELETE = /^\s*DELETE FROM aws_connect_sessions\b/i;

/**
 * Holds the route's connect-session DELETE until released, so its timing
 * relative to the response and to other session writes is deterministic. The
 * exported `pool` is a Proxy whose query() runs on the request-scoped client
 * from requestContext, so the hold is applied to that client. `reached`
 * resolves when the DELETE is issued, `settled` once it has run (or failed).
 */
function holdSessionDelete(opts: { releaseAfterMs?: number; fail?: Error } = {}) {
  let markReached!: () => void;
  let release!: () => void;
  let markSettled!: () => void;
  const reached = new Promise<void>((resolve) => (markReached = resolve));
  const released = new Promise<void>((resolve) => (release = resolve));
  const settled = new Promise<void>((resolve) => (markSettled = resolve));
  const getStore = requestContext.getStore.bind(requestContext);
  jest.spyOn(requestContext, 'getStore').mockImplementation(() => {
    const client = getStore();
    if (!client) return client;
    return new Proxy(client, {
      get(target, prop) {
        const value = Reflect.get(target, prop, target);
        if (prop !== 'query') return typeof value === 'function' ? value.bind(target) : value;
        return (...args: unknown[]) => {
          if (typeof args[0] !== 'string' || !SESSION_DELETE.test(args[0])) return value.apply(target, args);
          markReached();
          if (opts.releaseAfterMs !== undefined) setTimeout(release, opts.releaseAfterMs);
          return released
            .then(() => (opts.fail ? Promise.reject(opts.fail) : value.apply(target, args)))
            .finally(markSettled);
        };
      },
    });
  });
  return { reached, settled, release };
}

async function connectSession(orgId: string) {
  const { rows } = await pool.query('SELECT external_id FROM aws_connect_sessions WHERE org_id = $1', [orgId]);
  return rows[0] ?? null;
}

async function awsAccountRow(orgId: string) {
  const { rows } = await pool.query('SELECT org_id, account_id FROM aws_accounts WHERE org_id = $1', [orgId]);
  return rows[0] ?? null;
}

async function auditRows(orgId: string) {
  const { rows } = await pool.query(
    `SELECT organization_id, user_id, action, resource_type, resource_id, ip_address, user_agent, metadata
       FROM audit_logs WHERE organization_id = $1 AND action = 'aws_account.connected'`,
    [orgId]
  );
  return rows;
}

async function insertKey(orgId: string): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO api_keys (name, key_hash, prefix, scopes, status, organization_id)
     VALUES ('fixture', $1, 'dc_live_fixt', ARRAY['read:metrics'], 'active', $2) RETURNING id`,
    [`hash-${uniqueSuffix()}`, orgId]
  );
  return rows[0].id as string;
}

async function keyStatus(id: string): Promise<string | null> {
  const { rows } = await pool.query('SELECT status FROM api_keys WHERE id = $1', [id]);
  return rows[0]?.status ?? null;
}

async function keyCount(orgId: string): Promise<number> {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM api_keys WHERE organization_id = $1', [orgId]);
  return rows[0].n;
}

/** Asserts a denied AWS-binding attempt changed nothing. */
async function expectNoBinding(orgId: string) {
  expect(await awsAccountRow(orgId)).toBeNull();
  expect(await auditRows(orgId)).toHaveLength(0);
}

describe('AWS account connection -- owner only, by current membership', () => {
  it('current owner: connect-init succeeds and POST binds the account', async () => {
    const org = await buildOrg();

    const init = await as(org.owner, org.orgId).connectInit();
    expect(init.status).toBe(200);

    const res = await as(org.owner, org.orgId).connect();
    expect(res.status).toBe(201);
    expect(await awsAccountRow(org.orgId)).not.toBeNull();
  });

  it.each(['admin', 'member', 'viewer'] as const)(
    'current %s is denied connect-init and POST, and nothing is written',
    async (role) => {
      const org = await buildOrg();
      await insertConnectSession(org.orgId);
      const before = await connectSession(org.orgId);

      const init = await as(org[role], org.orgId).connectInit();
      expect(init.status).toBe(403);
      // connect-init must not rotate or create the pending ExternalId.
      expect(await connectSession(org.orgId)).toEqual(before);

      const res = await as(org[role], org.orgId).connect();
      expect(res.status).toBe(403);
      // `message` is the key the connect page shows in its error toast.
      expect(((await res.json()) as { message?: string }).message).toBe(
        'Only an organization owner can connect an AWS account'
      );
      await expectNoBinding(org.orgId);
    }
  );

  it('unauthenticated connect-init and POST are rejected with 401', async () => {
    expect((await unauthenticated('GET', '/aws/accounts/connect-init')).status).toBe(401);
    expect((await unauthenticated('POST', '/aws/accounts')).status).toBe(401);
  });

  it('stale JWT: token says owner, current membership is member -- denied', async () => {
    const org = await buildOrg();
    await insertConnectSession(org.orgId);

    expect((await as(org.member, org.orgId, 'owner').connectInit()).status).toBe(403);
    expect((await as(org.member, org.orgId, 'owner').connect()).status).toBe(403);
    await expectNoBinding(org.orgId);
  });

  it('stale JWT: owner downgraded to member after the token was issued -- denied', async () => {
    const org = await buildOrg();
    await insertConnectSession(org.orgId);
    await pool.query(
      `UPDATE organization_memberships SET role = 'member' WHERE organization_id = $1 AND user_id = $2`,
      [org.orgId, org.owner]
    );

    expect((await as(org.owner, org.orgId, 'owner').connect()).status).toBe(403);
    await expectNoBinding(org.orgId);
  });

  it('stale JWT: token says admin, current membership is viewer -- denied', async () => {
    const org = await buildOrg();
    await insertConnectSession(org.orgId);

    expect((await as(org.viewer, org.orgId, 'admin').connect()).status).toBe(403);
    await expectNoBinding(org.orgId);
  });

  it('owner whose membership is inactive is denied', async () => {
    const org = await buildOrg();
    await insertConnectSession(org.orgId);
    await pool.query(
      'UPDATE organization_memberships SET is_active = false WHERE organization_id = $1 AND user_id = $2',
      [org.orgId, org.owner]
    );

    expect((await as(org.owner, org.orgId).connect()).status).toBe(403);
    await expectNoBinding(org.orgId);
  });

  it('owner with a still-pending (unaccepted) invitation is denied', async () => {
    const org = await buildOrg();
    const invitee = await insertUser('pending-owner');
    await pool.query(
      `INSERT INTO organization_memberships (organization_id, user_id, role, joined_at, is_active, invitation_token)
       VALUES ($1, $2, 'owner', NOW(), true, $3)`,
      [org.orgId, invitee, `tok-${uniqueSuffix()}`]
    );
    await insertConnectSession(org.orgId);

    expect((await as(invitee, org.orgId).connect()).status).toBe(403);
    await expectNoBinding(org.orgId);
  });

  it('owner whose user account is deactivated or soft-deleted is denied', async () => {
    const org = await buildOrg();
    const deleted = await member(org.orgId, 'owner');
    await insertConnectSession(org.orgId);
    await pool.query('UPDATE users SET is_active = false WHERE id = $1', [org.owner]);
    await pool.query('UPDATE users SET deleted_at = NOW() WHERE id = $1', [deleted]);

    expect((await as(org.owner, org.orgId).connect()).status).toBe(403);
    expect((await as(deleted, org.orgId).connect()).status).toBe(403);
    await expectNoBinding(org.orgId);
  });

  it('owner of an inactive or soft-deleted organization is denied', async () => {
    const inactive = await buildOrg();
    const deleted = await buildOrg();
    await insertConnectSession(inactive.orgId);
    await insertConnectSession(deleted.orgId);
    await pool.query('UPDATE organizations SET is_active = false WHERE id = $1', [inactive.orgId]);
    await pool.query('UPDATE organizations SET deleted_at = NOW() WHERE id = $1', [deleted.orgId]);

    expect((await as(inactive.owner, inactive.orgId).connectInit()).status).toBe(403);
    expect((await as(inactive.owner, inactive.orgId).connect()).status).toBe(403);
    expect((await as(deleted.owner, deleted.orgId).connect()).status).toBe(403);
    await expectNoBinding(inactive.orgId);
    await expectNoBinding(deleted.orgId);
  });

  it('a stored role outside the known set is denied', async () => {
    const org = await buildOrg();
    const odd = await member(org.orgId, 'superowner');
    await insertConnectSession(org.orgId);

    expect((await as(odd, org.orgId, 'owner').connect()).status).toBe(403);
    await expectNoBinding(org.orgId);
  });

  it('a user with no membership at all is denied', async () => {
    const org = await buildOrg();
    const outsider = await insertUser('outsider');
    await insertConnectSession(org.orgId);

    expect((await as(outsider, org.orgId).connect()).status).toBe(403);
    await expectNoBinding(org.orgId);
  });

  it('missing organization context in the token is rejected and binds nothing', async () => {
    const org = await buildOrg();
    const res = await as(org.owner, undefined).connect();
    expect([401, 403]).toContain(res.status);
    await expectNoBinding(org.orgId);
  });

  it('cross-org: owner of org A with a token claiming org B is denied for org B', async () => {
    const a = await buildOrg();
    const b = await buildOrg();
    await insertConnectSession(b.orgId);

    expect((await as(a.owner, b.orgId).connectInit()).status).toBe(403);
    expect((await as(a.owner, b.orgId).connect()).status).toBe(403);
    await expectNoBinding(b.orgId);
  });

  it('cross-org: an organization id in the request body never selects the org that is bound', async () => {
    const a = await buildOrg();
    const b = await buildOrg();
    await insertConnectSession(a.orgId);
    await insertConnectSession(b.orgId);

    const res = await as(a.owner, a.orgId).connect({ organizationId: b.orgId, org_id: b.orgId, orgId: b.orgId });
    expect(res.status).toBe(201);
    expect(await awsAccountRow(a.orgId)).not.toBeNull();
    await expectNoBinding(b.orgId);
  });

  it('replacement: once connected, a non-owner is denied before the already-connected check', async () => {
    const org = await buildOrg();
    await insertConnectSession(org.orgId);
    expect((await as(org.owner, org.orgId).connect()).status).toBe(201);

    await insertConnectSession(org.orgId);
    expect((await as(org.admin, org.orgId).connect()).status).toBe(403);
    // The owner still reaches the existing 409 already-connected branch.
    expect((await as(org.owner, org.orgId).connect()).status).toBe(409);
  });
});

describe('AWS account connection -- audit event', () => {
  it('a successful connection records exactly one aws_account.connected event without secrets', async () => {
    const org = await buildOrg();
    const externalId = await insertConnectSession(org.orgId);
    const accountId = uniqueAccountId();
    const roleArn = `arn:aws:iam::${accountId}:role/DevControlRole-${uniqueSuffix()}`;

    const res = await as(org.owner, org.orgId).connect({ roleArn });
    expect(res.status).toBe(201);

    const rows = await auditRows(org.orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organization_id: org.orgId,
      user_id: org.owner,
      action: 'aws_account.connected',
      resource_type: 'aws_account',
      resource_id: null,
      ip_address: '203.0.113.60',
      user_agent: 'A3AuditTest/1.0',
    });
    expect(rows[0].metadata).toEqual({ awsAccountId: accountId });
    const serialized = JSON.stringify(rows[0]);
    expect(serialized).not.toContain(externalId);
    expect(serialized).not.toMatch(/secret|sessionToken|accessKey|externalId/i);
  });

  it('a denied or already-connected attempt records no event', async () => {
    const org = await buildOrg();
    await insertConnectSession(org.orgId);
    expect((await as(org.admin, org.orgId).connect()).status).toBe(403);
    expect(await auditRows(org.orgId)).toHaveLength(0);

    expect((await as(org.owner, org.orgId).connect()).status).toBe(201);
    await insertConnectSession(org.orgId);
    expect((await as(org.owner, org.orgId).connect()).status).toBe(409);
    expect(await auditRows(org.orgId)).toHaveLength(1);
  });
});

describe('AWS account connection -- audit-write failure', () => {
  it('a failed audit write does not fail the connection', async () => {
    const org = await buildOrg();
    await insertConnectSession(org.orgId);
    const failing = createAuditEventWriter({
      connect: () => Promise.reject(new Error('audit database unavailable')),
    } as unknown as Parameters<typeof createAuditEventWriter>[0]);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(auditEvents, 'record').mockImplementation(failing.record);

    expect((await as(org.owner, org.orgId).connect()).status).toBe(201);
    expect(await awsAccountRow(org.orgId)).not.toBeNull();
    expect(await auditRows(org.orgId)).toHaveLength(0);
  });
});

describe('AWS account connection -- connect-session cleanup', () => {
  it('a session created after a successful connect survives, and the next connect returns 409', async () => {
    const org = await buildOrg();
    await insertConnectSession(org.orgId);
    const hold = holdSessionDelete({ releaseAfterMs: 200 });

    expect((await as(org.owner, org.orgId).connect()).status).toBe(201);
    const next = await insertConnectSession(org.orgId);
    await hold.settled;

    expect(await connectSession(org.orgId)).toEqual({ external_id: next });
    expect((await as(org.owner, org.orgId).connect()).status).toBe(409);
  });

  it('the consumed session is removed by the time connect responds', async () => {
    const org = await buildOrg();
    await insertConnectSession(org.orgId);
    holdSessionDelete({ releaseAfterMs: 200 });

    expect((await as(org.owner, org.orgId).connect()).status).toBe(201);
    expect(await connectSession(org.orgId)).toBeNull();
  });

  it('only the consumed session is deleted: one rotated while connect is in flight survives', async () => {
    const org = await buildOrg();
    await insertConnectSession(org.orgId);
    const hold = holdSessionDelete();

    const response = as(org.owner, org.orgId).connect();
    await hold.reached;
    const rotated = await insertConnectSession(org.orgId);
    hold.release();
    expect((await response).status).toBe(201);
    await hold.settled;

    expect(await connectSession(org.orgId)).toEqual({ external_id: rotated });
  });

  it('a failed session delete still returns 201, binds the account, and logs no ExternalId', async () => {
    const org = await buildOrg();
    const externalId = await insertConnectSession(org.orgId);
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    const hold = holdSessionDelete({ releaseAfterMs: 0, fail: new Error('session store unavailable') });

    expect((await as(org.owner, org.orgId).connect()).status).toBe(201);
    await hold.settled;
    expect(await awsAccountRow(org.orgId)).not.toBeNull();

    const logged = JSON.stringify(errorLog.mock.calls);
    expect(logged).toContain(org.orgId);
    expect(logged).toContain('session store unavailable');
    expect(logged).not.toContain(externalId);
  });
});

describe('API keys -- create/revoke limited to owner and admin, by current membership', () => {
  it.each(['owner', 'admin'] as const)('current %s can create and revoke a key', async (role) => {
    const org = await buildOrg();

    const created = await as(org[role], org.orgId).createKey();
    expect(created.status).toBe(201);
    const body = (await created.json()) as { data: { id: string } };
    expect(await keyStatus(body.data.id)).toBe('active');

    const revoked = await as(org[role], org.orgId).revokeKey(body.data.id);
    expect(revoked.status).toBe(200);
    expect(await keyStatus(body.data.id)).toBe('revoked');
  });

  it.each(['member', 'viewer'] as const)('current %s is denied create and revoke', async (role) => {
    const org = await buildOrg();
    const keyId = await insertKey(org.orgId);

    expect((await as(org[role], org.orgId).createKey()).status).toBe(403);
    expect(await keyCount(org.orgId)).toBe(1);

    expect((await as(org[role], org.orgId).revokeKey(keyId)).status).toBe(403);
    expect(await keyStatus(keyId)).toBe('active');
  });

  it('unauthenticated create and revoke are rejected with 401', async () => {
    expect((await unauthenticated('POST', '/keys')).status).toBe(401);
    expect((await unauthenticated('DELETE', '/keys/00000000-0000-0000-0000-000000000000')).status).toBe(401);
  });

  it('stale JWT: token says owner, current membership is member -- create and revoke denied', async () => {
    const org = await buildOrg();
    const keyId = await insertKey(org.orgId);

    expect((await as(org.member, org.orgId, 'owner').createKey()).status).toBe(403);
    expect((await as(org.member, org.orgId, 'owner').revokeKey(keyId)).status).toBe(403);
    expect(await keyStatus(keyId)).toBe('active');
    expect(await keyCount(org.orgId)).toBe(1);
  });

  it('stale JWT: token says admin, current membership is viewer -- denied', async () => {
    const org = await buildOrg();
    const keyId = await insertKey(org.orgId);

    expect((await as(org.viewer, org.orgId, 'admin').createKey()).status).toBe(403);
    expect((await as(org.viewer, org.orgId, 'admin').revokeKey(keyId)).status).toBe(403);
    expect(await keyStatus(keyId)).toBe('active');
  });

  it('inactive membership, deactivated user, and inactive or deleted organization are denied', async () => {
    const org = await buildOrg();
    const inactiveOrg = await buildOrg();
    const deletedOrg = await buildOrg();
    await pool.query(
      'UPDATE organization_memberships SET is_active = false WHERE organization_id = $1 AND user_id = $2',
      [org.orgId, org.admin]
    );
    await pool.query('UPDATE users SET is_active = false WHERE id = $1', [org.owner]);
    await pool.query('UPDATE organizations SET is_active = false WHERE id = $1', [inactiveOrg.orgId]);
    await pool.query('UPDATE organizations SET deleted_at = NOW() WHERE id = $1', [deletedOrg.orgId]);

    expect((await as(org.admin, org.orgId).createKey()).status).toBe(403);
    expect((await as(org.owner, org.orgId).createKey()).status).toBe(403);
    expect((await as(inactiveOrg.owner, inactiveOrg.orgId).createKey()).status).toBe(403);
    expect((await as(deletedOrg.owner, deletedOrg.orgId).createKey()).status).toBe(403);
    expect(await keyCount(org.orgId)).toBe(0);
    expect(await keyCount(inactiveOrg.orgId)).toBe(0);
    expect(await keyCount(deletedOrg.orgId)).toBe(0);
  });

  it("cross-org: an admin of org A cannot revoke org B's key, and learns nothing about it", async () => {
    const a = await buildOrg();
    const b = await buildOrg();
    const bKey = await insertKey(b.orgId);

    const res = await as(a.admin, a.orgId).revokeKey(bKey);
    expect(res.status).toBe(404);
    expect(await keyStatus(bKey)).toBe('active');
  });

  it("cross-org: a token claiming org B from org A's owner is denied", async () => {
    const a = await buildOrg();
    const b = await buildOrg();
    const bKey = await insertKey(b.orgId);

    expect((await as(a.owner, b.orgId).createKey()).status).toBe(403);
    expect((await as(a.owner, b.orgId).revokeKey(bKey)).status).toBe(403);
    expect(await keyStatus(bKey)).toBe('active');
    expect(await keyCount(b.orgId)).toBe(1);
  });

  it('cross-org: an organization id in the request body never selects the key owner', async () => {
    const a = await buildOrg();
    const b = await buildOrg();

    const res = await as(a.admin, a.orgId).createKey({ organization_id: b.orgId, organizationId: b.orgId });
    expect(res.status).toBe(201);
    expect(await keyCount(a.orgId)).toBe(1);
    expect(await keyCount(b.orgId)).toBe(0);
  });

  it('listing keys is unchanged: any current member may list, and no hash or raw key is returned', async () => {
    const org = await buildOrg();
    await insertKey(org.orgId);

    const res = await as(org.viewer, org.orgId, 'viewer').listKeys();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<Record<string, unknown>> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).not.toHaveProperty('key_hash');
    expect(body.data[0]).not.toHaveProperty('raw_key');
  });
});
