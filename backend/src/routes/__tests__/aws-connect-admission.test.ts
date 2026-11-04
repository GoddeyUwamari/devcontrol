/**
 * Review H1: a connect check (POST /api/aws/accounts) waits on AWS for up to
 * ~25 s, and must never tie up the database pool while it does.
 *   1. The request's pooled connection is released before the first AWS call.
 *   2. Single-flight: one check per AUTHENTICATED organization at a time.
 *   3. A per-process cap on concurrent checks.
 * Over the real route, real authenticate middleware and the real application
 * pool (config/database.ts, max 50); only token verification, STS and the
 * background discovery kickoff are stubbed.
 */
import express from 'express';
import http from 'http';
import { Pool } from 'pg';
import awsRoutes, { connectTestHooks, resetConnectTestHooks, CONNECT_SLOT_RESPONSES } from '../aws.routes';
import { authService } from '../../services/auth.service';
import { AWSResourceDiscoveryService } from '../../services/awsResourceDiscovery';
import { pool as appPool } from '../../config/database';
import { ConnectCheckSlots } from '../../services/connect-check-slots';
import { ensureSharedFixtureTable } from './shared-fixture-tables';
import type { RoleCheckPolicy } from '../../services/connect-role-check';

const mockStsSend = jest.fn();
jest.mock('@aws-sdk/client-sts', () => ({
  STSClient: jest.fn().mockImplementation(() => ({ send: (...args: unknown[]) => mockStsSend(...args) })),
  AssumeRoleCommand: jest.fn().mockImplementation((input: unknown) => input),
}));

jest.setTimeout(60_000);

function dbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };
}

const fixtures = new Pool(dbConfig());
const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];
/** token -> verified claims, so many users can call at once. */
const tokens = new Map<string, { userId: string; organizationId: string }>();

function suffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
function accountId(): string {
  return String(100000000000 + Math.floor(Math.random() * 899999999999));
}

/** An org with one active member of `role`; returns the bearer token for that member. */
async function member(role: 'owner' | 'member'): Promise<{ token: string; orgId: string }> {
  const s = suffix();
  const org = await fixtures.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $1, 'free', 'free') RETURNING id`, [`Admission ${s}`, `admission-${s}`]);
  const orgId = org.rows[0].id as string;
  createdOrgIds.push(orgId);
  const user = await fixtures.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Admission') RETURNING id`, [`admission-${s}@example.com`]);
  const userId = user.rows[0].id as string;
  createdUserIds.push(userId);
  await fixtures.query(
    `INSERT INTO organization_memberships (organization_id, user_id, role, joined_at, is_active) VALUES ($1, $2, $3, NOW(), true)`,
    [orgId, userId, role]);
  const token = `token-${s}`;
  tokens.set(token, { userId, organizationId: orgId });
  return { token, orgId };
}

let server: http.Server;
let baseUrl: string;
const savedPlatformAccountId = process.env.AWS_ACCOUNT_ID;

beforeAll(async () => {
  process.env.AWS_ACCOUNT_ID = '123456789012';
  await ensureSharedFixtureTable(fixtures, 'aws_accounts');
  await ensureSharedFixtureTable(fixtures, 'aws_connect_sessions');
  const app = express();
  app.use(express.json());
  app.use('/api/aws', awsRoutes);
  server = http.createServer(app);
  server.maxConnections = 1000;
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api/aws`;
});

afterAll(async () => {
  if (savedPlatformAccountId === undefined) delete process.env.AWS_ACCOUNT_ID;
  else process.env.AWS_ACCOUNT_ID = savedPlatformAccountId;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const table of ['aws_accounts', 'aws_connect_sessions']) {
    await fixtures.query(`DELETE FROM ${table} WHERE org_id = ANY($1)`, [createdOrgIds]);
  }
  await fixtures.query('DELETE FROM organization_memberships WHERE organization_id = ANY($1) OR user_id = ANY($2)', [createdOrgIds, createdUserIds]);
  await fixtures.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  await fixtures.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds]);
  await fixtures.end();
});

beforeEach(() => {
  mockStsSend.mockReset();
  jest.spyOn(authService, 'verifyToken').mockImplementation((token: string) => {
    const claims = tokens.get(token);
    if (!claims) throw new Error('unknown test token');
    return { ...claims, email: 'admission@example.com', role: 'owner', type: 'access' } as any;
  });
  jest.spyOn(AWSResourceDiscoveryService.prototype, 'discoverAllResources').mockResolvedValue({
    job_id: 'stub-job', resources_discovered: 0, resources_updated: 0, resources_deleted: 0, errors: [], warnings: [],
  } as any);
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  // Fresh admission state per test (the default limit of 5).
  connectTestHooks.slots = new ConnectCheckSlots();
});

afterEach(() => {
  resetConnectTestHooks();
  jest.restoreAllMocks();
});

const roleArn = () => `arn:aws:iam::${accountId()}:role/DevControlRole`;
function connect(token: string, signal?: AbortSignal) {
  return fetch(`${baseUrl}/accounts`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ roleArn: roleArn() }), signal,
  });
}

/** STS calls that stay pending until released: checks in flight inside AWS. */
function gateSts() {
  const waiting: Array<() => void> = [];
  mockStsSend.mockImplementation(() => new Promise((resolve) => waiting.push(() => resolve({}))));
  return {
    get pending() { return waiting.length; },
    openAll() { while (waiting.length) waiting.shift()!(); },
  };
}
/** A policy that never times out the gated attempt. */
const longAttempt: RoleCheckPolicy = {
  maxElapsedMs: 0, attemptTimeoutMs: 30_000, baseDelayMs: 1_000, maxDelayMs: 1_000,
  random: () => 0.5, now: () => 0, sleep: async () => {},
};
async function until(cond: () => boolean, ms = 5_000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('condition not reached');
    await new Promise((r) => setTimeout(r, 10));
  }
}
/** Connections the application pool currently has checked out. */
const checkedOut = () => appPool.totalCount - appPool.idleCount;

describe('H1 layer 1: no pooled connection is held while AWS is called', () => {
  it('while 5 checks wait inside STS, the application pool has no connection checked out', async () => {
    connectTestHooks.roleCheckPolicy = longAttempt;
    const gate = gateSts();
    const owners = await Promise.all(Array.from({ length: 5 }, () => member('owner')));
    const requests = owners.map((o) => connect(o.token));
    try {
      await until(() => gate.pending === 5);
      // Let any in-flight release settle.
      await new Promise((r) => setTimeout(r, 50));
      expect(checkedOut()).toBe(0);
    } finally {
      gate.openAll();
      const responses = await Promise.all(requests);
      expect(responses.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    }
  });

  it('with ~50 checks retrying at once, unrelated authenticated requests still get a connection and succeed', async () => {
    // Raise the per-process cap so ~50 checks really run together (layer 1 on its own).
    connectTestHooks.slots = new ConnectCheckSlots(50);
    connectTestHooks.roleCheckPolicy = {
      maxElapsedMs: 3_000, attemptTimeoutMs: 1_000, baseDelayMs: 100, maxDelayMs: 200,
      random: () => 0.999999, now: Date.now,
      sleep: (ms, signal) => new Promise((resolve) => {
        const t = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
      }),
    };
    mockStsSend.mockRejectedValue(Object.assign(new Error('not authorized'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }));
    const owners = await Promise.all(Array.from({ length: 50 }, () => member('owner')));
    const others = await Promise.all(Array.from({ length: 20 }, () => member('member')));

    const checks = owners.map((o) => connect(o.token));
    // All 50 are past admission and retrying (STS has been called by each).
    await until(() => new Set(mockStsSend.mock.calls.map((c) => (c[0] as { RoleArn: string }).RoleArn)).size === 50, 10_000);
    const stsCallsAtStart = mockStsSend.mock.calls.length;

    // 3 waves of 20 unrelated authenticated requests (each needs a pool connection), during the retries.
    const unrelated: number[] = [];
    for (let wave = 0; wave < 3; wave++) {
      const responses = await Promise.all(others.map((o) => fetch(`${baseUrl}/accounts`, { headers: { Authorization: `Bearer ${o.token}` } })));
      unrelated.push(...responses.map((r) => r.status));
      await new Promise((r) => setTimeout(r, 200));
    }
    // Still retrying while the unrelated requests ran.
    expect(mockStsSend.mock.calls.length).toBeGreaterThan(stsCallsAtStart);
    expect(unrelated).toHaveLength(60);
    expect(unrelated.every((s) => s === 200)).toBe(true);

    const results = await Promise.all(checks);
    expect(results.every((r) => r.status === 422)).toBe(true);
    expect(checkedOut()).toBe(0);
  });
});

describe('H1 layer 2: single-flight per authenticated organization', () => {
  it('a second connect for the same organization while one is running gets 409 and makes no AWS call', async () => {
    connectTestHooks.roleCheckPolicy = longAttempt;
    const gate = gateSts();
    const owner = await member('owner');
    const first = connect(owner.token);
    try {
      await until(() => gate.pending === 1);
      const second = await connect(owner.token);
      expect(second.status).toBe(409);
      expect(await second.json()).toEqual({ success: false, ...stripStatus(CONNECT_SLOT_RESPONSES.org_busy) });
      expect(CONNECT_SLOT_RESPONSES.org_busy.message).toBe('A connection check is already running for this workspace. Try again in a minute.');
      expect(mockStsSend).toHaveBeenCalledTimes(1);
    } finally {
      gate.openAll();
      await first;
    }
  });

  it('is keyed by the token-authenticated organization: a body field naming another org changes nothing', async () => {
    connectTestHooks.roleCheckPolicy = longAttempt;
    const gate = gateSts();
    const a = await member('owner');
    const b = await member('owner');
    const first = connect(a.token);
    try {
      await until(() => gate.pending === 1);
      // Owner B's request claims org A in the body and query: B is still admitted (B's own org).
      const pendingRes = fetch(`${baseUrl}/accounts?organizationId=${a.orgId}`, {
        method: 'POST', headers: { Authorization: `Bearer ${b.token}`, 'Content-Type': 'application/json', 'X-Tenant-ID': a.orgId },
        body: JSON.stringify({ roleArn: roleArn(), organizationId: a.orgId, orgId: a.orgId }),
      });
      // Admitted: B's own check reaches STS while A's is still running.
      await until(() => gate.pending === 2);
      gate.openAll();
      expect((await pendingRes).status).toBe(201);
    } finally {
      gate.openAll();
      await first;
    }
  });

  it('the slot is released after success, after a refusal from AWS, and after the client disconnects', async () => {
    const owner = await member('owner');
    connectTestHooks.roleCheckPolicy = { ...longAttempt, attemptTimeoutMs: 5_000 };
    // refusal from AWS
    mockStsSend.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'ValidationError' }));
    expect((await connect(owner.token)).status).toBe(422);
    // client disconnect mid-check
    const gate = gateSts();
    const controller = new AbortController();
    const dropped = connect(owner.token, controller.signal).catch(() => undefined);
    await until(() => gate.pending === 1);
    controller.abort();
    await dropped;
    gate.openAll();
    await until(() => connectTestHooks.slots!.inFlight === 0);
    // The fake STS ignores the abort, so that check may have saved the connection
    // (the real SDK aborts it): a new owner proves release after a success.
    const other = await member('owner');
    mockStsSend.mockReset();
    mockStsSend.mockResolvedValue({});
    expect((await connect(other.token)).status).toBe(201);
    expect(connectTestHooks.slots!.inFlight).toBe(0);
  });

  it('the slot is released after a database failure too', async () => {
    const owner = await member('owner');
    const repo = await import('../../repositories/aws-external-id.repository');
    jest.spyOn(repo, 'resolveOrganizationExternalId').mockRejectedValueOnce(new Error('connection terminated'));
    expect((await connect(owner.token)).status).toBe(500);
    expect(connectTestHooks.slots!.inFlight).toBe(0);
  });
});

describe('H1 layer 3: per-process cap', () => {
  it('with 5 checks running, a 6th organization gets 503 and makes no AWS call', async () => {
    connectTestHooks.roleCheckPolicy = longAttempt;
    const gate = gateSts();
    const owners = await Promise.all(Array.from({ length: 6 }, () => member('owner')));
    const running = owners.slice(0, 5).map((o) => connect(o.token));
    try {
      await until(() => gate.pending === 5);
      const sixth = await connect(owners[5].token);
      expect(sixth.status).toBe(503);
      expect(await sixth.json()).toEqual({ success: false, ...stripStatus(CONNECT_SLOT_RESPONSES.at_capacity) });
      expect(CONNECT_SLOT_RESPONSES.at_capacity.message).toBe('DevControl is busy checking other connections. Nothing was saved. Try again in a minute.');
      expect(mockStsSend).toHaveBeenCalledTimes(5);
    } finally {
      gate.openAll();
      await Promise.all(running);
    }
    // capacity is back
    mockStsSend.mockResolvedValue({});
    expect((await connect(owners[5].token)).status).toBe(201);
  });

  it('50 simultaneous connects from 50 organizations: exactly 5 admitted, 45 refused with 503', async () => {
    connectTestHooks.roleCheckPolicy = longAttempt;
    const gate = gateSts();
    const owners = await Promise.all(Array.from({ length: 50 }, () => member('owner')));
    const all = owners.map((o) => connect(o.token));
    await until(() => gate.pending === 5);
    // Refusals come back without waiting on AWS.
    await new Promise((r) => setTimeout(r, 300));
    gate.openAll();
    const statuses = (await Promise.all(all)).map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(5);
    expect(statuses.filter((s) => s === 503)).toHaveLength(45);
    expect(mockStsSend).toHaveBeenCalledTimes(5);
  });
});

function stripStatus({ code, message }: { status: number; code: string; message: string }) {
  return { code, message };
}
