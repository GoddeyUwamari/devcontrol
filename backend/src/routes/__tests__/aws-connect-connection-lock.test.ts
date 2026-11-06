/**
 * AWS connect PR B, over the real route (real authenticate middleware, real
 * RLS-context wiring, real database), with STS, the permission probes and the
 * background discovery kickoff stubbed:
 *   - POST /api/aws/accounts takes the organization's connection lock
 *     EXCLUSIVE in the INSERT's transaction: it waits for an in-flight
 *     shared-locked (fenced) write, and every write fenced after it sees the
 *     new connection;
 *   - GET /api/aws/accounts `connection`: the server's own connection state,
 *     never a credential, External ID, role ARN or row id.
 * Placeholders only.
 */
import express from 'express';
import http from 'http';
import { Pool } from 'pg';
import awsRoutes, { connectTestHooks, resetConnectTestHooks } from '../aws.routes';
import { authService } from '../../services/auth.service';
import { AWSResourceDiscoveryService } from '../../services/awsResourceDiscovery';
import * as accountsRepository from '../../repositories/aws-accounts.repository';
import { AWS_CONNECTION_LOCK_KEY_SQL, ConnectionChangedError, assertConnectionUnchanged, currentConnectionIdentity, lockConnectionShared } from '../../services/aws-connection-fence';
import { ensureSharedFixtureTable } from './shared-fixture-tables';
import type { RoleCheckPolicy } from '../../services/connect-role-check';
import type { ProbeClients } from '../../services/connect-permission-check';

const mockStsSend = jest.fn();
jest.mock('@aws-sdk/client-sts', () => ({
  STSClient: jest.fn().mockImplementation(() => ({ send: (...args: unknown[]) => mockStsSend(...args) })),
  AssumeRoleCommand: jest.fn().mockImplementation((input: unknown) => input),
}));

const PLATFORM_ACCOUNT_ID = '123456789012';

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

const uniqueSuffix = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const uniqueAccountId = () => String(100000000000 + Math.floor(Math.random() * 899999999999));
const roleArnFor = (accountId: string) => `arn:aws:iam::${accountId}:role/DevControlRole`;

async function insertOwner(): Promise<string> {
  const suffix = uniqueSuffix();
  const org = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $1, 'free', 'free') RETURNING id`,
    [`Connection Lock ${suffix}`, `connection-lock-${suffix}`]
  );
  const orgId = org.rows[0].id as string;
  createdOrgIds.push(orgId);
  const user = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Connection Lock') RETURNING id`,
    [`connection-lock-${suffix}@example.com`]
  );
  const userId = user.rows[0].id as string;
  createdUserIds.push(userId);
  await pool.query(
    `INSERT INTO organization_memberships (organization_id, user_id, role, joined_at, is_active) VALUES ($1, $2, 'owner', NOW(), true)`,
    [orgId, userId]
  );
  jest.spyOn(authService, 'verifyToken').mockReturnValue({
    userId, email: 'connection-lock@example.com', organizationId: orgId, role: 'owner', type: 'access',
  } as any);
  return orgId;
}

function instantPolicy(): RoleCheckPolicy {
  let clock = 0;
  return {
    maxElapsedMs: 20_000, attemptTimeoutMs: 5_000, baseDelayMs: 1_000, maxDelayMs: 8_000,
    random: () => 0.999999, now: () => clock, sleep: async (ms: number) => { clock += ms; },
  };
}

function probeClients(): ProbeClients {
  const make = (region?: boolean) => ({
    send: jest.fn(() => Promise.resolve(region ? { Regions: [{ RegionName: 'us-east-1', OptInStatus: 'opt-in-not-required' }] } : {})),
  });
  return {
    ec2: make(true), s3: make(), lambda: make(), cloudWatch: make(), costExplorer: make(), resourceExplorer: make(),
  } as unknown as ProbeClients;
}

let server: http.Server;
let baseUrl: string;
const savedPlatformAccountId = process.env.AWS_ACCOUNT_ID;

beforeAll(async () => {
  process.env.AWS_ACCOUNT_ID = PLATFORM_ACCOUNT_ID;
  await ensureSharedFixtureTable(pool, 'aws_accounts');
  await ensureSharedFixtureTable(pool, 'aws_connect_sessions');
  const app = express();
  app.use(express.json());
  app.use('/api/aws', awsRoutes);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api/aws`;
});

afterAll(async () => {
  if (savedPlatformAccountId === undefined) delete process.env.AWS_ACCOUNT_ID;
  else process.env.AWS_ACCOUNT_ID = savedPlatformAccountId;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const table of ['aws_accounts', 'aws_connect_sessions']) {
    await pool.query(`DELETE FROM ${table} WHERE org_id = ANY($1)`, [createdOrgIds]);
  }
  await pool.query('DELETE FROM organization_memberships WHERE organization_id = ANY($1) OR user_id = ANY($2)', [createdOrgIds, createdUserIds]);
  await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds]);
  await pool.end();
});

beforeEach(() => {
  mockStsSend.mockReset();
  mockStsSend.mockResolvedValue({ Credentials: { AccessKeyId: 'ASIAEXAMPLE', SecretAccessKey: 'secret-example', SessionToken: 'token-example' } });
  jest.spyOn(AWSResourceDiscoveryService.prototype, 'discoverAllResources').mockResolvedValue({
    job_id: 'stub-job', resources_discovered: 0, resources_updated: 0, resources_deleted: 0, errors: [], warnings: [],
  } as any);
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  connectTestHooks.roleCheckPolicy = instantPolicy();
  connectTestHooks.probeClients = probeClients();
});

afterEach(() => {
  resetConnectTestHooks();
  jest.restoreAllMocks();
});

const auth = { Authorization: 'Bearer test-token' };
async function connect(roleArn: string) {
  const res = await fetch(`${baseUrl}/accounts`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ roleArn }),
  });
  return { status: res.status, body: (await res.json()) as any };
}
async function getAccounts() {
  const res = await fetch(`${baseUrl}/accounts`, { headers: auth });
  return { status: res.status, body: (await res.json()) as any };
}

/** Whether some session is waiting for this organization's connection lock. */
async function waitingForConnectionLock(orgId: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT EXISTS (
       SELECT 1 FROM pg_locks l
        WHERE l.locktype = 'advisory' AND NOT l.granted
          AND ((l.classid::bigint << 32) | l.objid::bigint) = (SELECT ${AWS_CONNECTION_LOCK_KEY_SQL})
     ) AS waiting`,
    [orgId]
  );
  return rows[0].waiting === true;
}

async function until(condition: () => Promise<boolean>, what: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('POST /api/aws/accounts takes the connection lock exclusive', () => {
  it('waits for an in-flight shared-locked write, then commits; a write fenced after it sees the new connection', async () => {
    const orgId = await insertOwner();
    const accountId = uniqueAccountId();

    // A write already in flight holding the shared connection lock (no connection is
    // never a pass for a fence since AWS connect PR C, so it takes the lock itself).
    const writer = await pool.connect();
    let pending: Promise<{ status: number; body: any }>;
    const started = Date.now();
    let heldMs: number;
    try {
      await writer.query('BEGIN');
      await lockConnectionShared(writer, orgId);

      let settled = false;
      pending = connect(roleArnFor(accountId)).then((result) => {
        settled = true;
        return result;
      });
      await until(() => waitingForConnectionLock(orgId), 'connect to wait for the connection lock');
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(settled).toBe(false);
      // While connect waits, the in-flight write still sees "no connection" and commits as such.
      expect(await currentConnectionIdentity(writer, orgId)).toBeNull();
      heldMs = Date.now() - started;
      await writer.query('COMMIT');
    } finally {
      // Always end the writer, so a failing run never leaves a transaction (and the pool) open.
      await writer.query('ROLLBACK').catch(() => undefined);
      writer.release();
    }

    const result = await pending!;
    expect(result.status).toBe(201);
    expect(Date.now() - started).toBeGreaterThanOrEqual(heldMs!);

    // A write that starts after connect committed sees the new connection, not "none".
    const identity = await currentConnectionIdentity(pool, orgId);
    expect(identity).not.toBeNull();
    const after = await pool.connect();
    try {
      await after.query('BEGIN');
      await expect(assertConnectionUnchanged(after, orgId, null)).rejects.toBeInstanceOf(ConnectionChangedError);
      await after.query('ROLLBACK');
      await after.query('BEGIN');
      await assertConnectionUnchanged(after, orgId, identity);
      await after.query('ROLLBACK');
    } finally {
      after.release();
    }
  }, 30_000);

  it('a shared holder blocks connect only until it commits; with none, connect does not wait', async () => {
    const orgId = await insertOwner();
    const started = Date.now();
    expect((await connect(roleArnFor(uniqueAccountId()))).status).toBe(201);
    expect(await waitingForConnectionLock(orgId)).toBe(false);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('a lock wait past its limit saves nothing and answers the existing SAVE_FAILED text', async () => {
    const orgId = await insertOwner();
    const fence = await import('../../services/aws-connection-fence');
    const real = fence.withConnectionChange;
    jest.spyOn(fence, 'withConnectionChange').mockImplementation((p, o, fn) => real(p, o, fn, { lockTimeoutMs: 200 }));
    const holder = await pool.connect();
    await holder.query('BEGIN');
    await lockConnectionShared(holder, orgId);
    try {
      const result = await connect(roleArnFor(uniqueAccountId()));
      expect(result.status).toBe(500);
      expect(result.body).toEqual({ success: false, code: 'SAVE_FAILED', message: 'Account validated but could not be saved. Please try again.' });
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
    }
    expect(await currentConnectionIdentity(pool, orgId)).toBeNull();
  }, 30_000);
});

describe('GET /api/aws/accounts `connection`: the server connection state only', () => {
  it('not_connected with no row, connected with one active row', async () => {
    const orgId = await insertOwner();
    expect((await getAccounts()).body.connection).toEqual({ state: 'not_connected' });
    await pool.query(
      `INSERT INTO aws_accounts (org_id, role_arn, account_id, external_id, status, connected_at) VALUES ($1, $2, $3, 'ext-placeholder', 'active', NOW())`,
      [orgId, roleArnFor(uniqueAccountId()), uniqueAccountId()]
    );
    const body = (await getAccounts()).body;
    // Exactly the state: no credential, External ID, role ARN or row id in it.
    expect(body.connection).toEqual({ state: 'connected' });
    expect(JSON.stringify(body.connection)).not.toMatch(/ext-placeholder|arn:|role/i);
  });

  it('a row that exists but is not active is not a connection (disconnected, stale data)', async () => {
    const orgId = await insertOwner();
    await pool.query(
      `INSERT INTO aws_accounts (org_id, role_arn, account_id, external_id, status, connected_at) VALUES ($1, $2, $3, 'ext-placeholder', 'disconnected', NOW())`,
      [orgId, roleArnFor(uniqueAccountId()), uniqueAccountId()]
    );
    const body = (await getAccounts()).body;
    expect(body.data).toHaveLength(1);
    expect(body.connection).toEqual({ state: 'not_connected' });
  });

  it('more than one eligible row is ambiguous, never connected', async () => {
    const orgId = await insertOwner();
    jest.spyOn(accountsRepository, 'findEligibleAwsAccount').mockRejectedValue(new accountsRepository.AwsAccountAmbiguousError(orgId, 2));
    expect((await getAccounts()).body.connection).toEqual({ state: 'ambiguous' });
  });
});
