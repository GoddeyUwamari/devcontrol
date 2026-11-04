/**
 * PR A connect hardening, over the real route (real authenticate middleware,
 * real RLS-context wiring, real database), with STS, the permission probes and
 * the background discovery kickoff stubbed:
 *   - one stable External ID per organization, shown by connect-init and sent
 *     by POST, with no connect session needed;
 *   - a database failure answered with a safe 500 instead of a hung request;
 *   - the role check's retry and its error codes, never leaking AWS text or
 *     the External ID;
 *   - the post-connect permission check: a warning in the 201, never a block.
 */
import express from 'express';
import http from 'http';
import { Pool } from 'pg';
import awsRoutes, { connectTestHooks, resetConnectTestHooks, ROLE_CHECK_RESPONSES, CONNECT_STATE_UNAVAILABLE_MESSAGE } from '../aws.routes';
import { authService } from '../../services/auth.service';
import { AWSResourceDiscoveryService } from '../../services/awsResourceDiscovery';
import * as externalIdRepository from '../../repositories/aws-external-id.repository';
import { ensureSharedFixtureTable } from './shared-fixture-tables';
import type { RoleCheckPolicy } from '../../services/connect-role-check';
import type { ProbeClients } from '../../services/connect-permission-check';

const mockStsSend = jest.fn();
jest.mock('@aws-sdk/client-sts', () => ({
  STSClient: jest.fn().mockImplementation(() => ({ send: (...args: unknown[]) => mockStsSend(...args) })),
  AssumeRoleCommand: jest.fn().mockImplementation((input: unknown) => input),
}));

const PLATFORM_ACCOUNT_ID = '123456789012';
const AWS_MESSAGE = `User: arn:aws:sts::${PLATFORM_ACCOUNT_ID}:assumed-role/platform/i-1234567890abcdef0 is not authorized to perform: sts:AssumeRole`;

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
function uniqueAccountId(): string {
  return String(100000000000 + Math.floor(Math.random() * 899999999999));
}

async function insertOwner(): Promise<{ orgId: string; userId: string }> {
  const suffix = uniqueSuffix();
  const org = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $1, 'free', 'free') RETURNING id`,
    [`Connect Hardening ${suffix}`, `connect-hardening-${suffix}`]
  );
  const orgId = org.rows[0].id as string;
  createdOrgIds.push(orgId);
  const user = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Connect Hardening') RETURNING id`,
    [`connect-hardening-${suffix}@example.com`]
  );
  const userId = user.rows[0].id as string;
  createdUserIds.push(userId);
  await pool.query(
    `INSERT INTO organization_memberships (organization_id, user_id, role, joined_at, is_active)
     VALUES ($1, $2, 'owner', NOW(), true)`,
    [orgId, userId]
  );
  jest.spyOn(authService, 'verifyToken').mockReturnValue({
    userId, email: 'connect-hardening@example.com', organizationId: orgId, role: 'owner', type: 'access',
  } as any);
  return { orgId, userId };
}

function awsError(name: string, status?: number): Error {
  const error = new Error(AWS_MESSAGE) as Error & Record<string, unknown>;
  error.name = name;
  error.$metadata = { httpStatusCode: status ?? 400, requestId: 'req-test' };
  return error;
}

/** Retries with no real waiting: sleep advances a fake clock. */
function instantPolicy(): RoleCheckPolicy {
  let clock = 0;
  return {
    maxElapsedMs: 20_000, attemptTimeoutMs: 5_000, baseDelayMs: 1_000, maxDelayMs: 8_000,
    random: () => 0.999999, now: () => clock, sleep: async (ms: number) => { clock += ms; },
  };
}

const CREDENTIALS = { AccessKeyId: 'ASIAEXAMPLE', SecretAccessKey: 'secret-example', SessionToken: 'token-example' };

function probeClients(denied: Array<keyof ProbeClients> = []): ProbeClients {
  // DescribeRegions answers with the home region enabled, as AWS does.
  const success = (key: keyof ProbeClients) => key === 'ec2'
    ? { Regions: [{ RegionName: 'us-east-1', OptInStatus: 'opt-in-not-required', Endpoint: 'ec2.us-east-1.amazonaws.com' }] }
    : {};
  const make = (key: keyof ProbeClients) => ({
    send: jest.fn(denied.includes(key) ? () => Promise.reject(awsError('AccessDenied', 403)) : () => Promise.resolve(success(key))),
  });
  return {
    ec2: make('ec2'), s3: make('s3'), lambda: make('lambda'),
    cloudWatch: make('cloudWatch'), costExplorer: make('costExplorer'), resourceExplorer: make('resourceExplorer'),
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
  jest.spyOn(AWSResourceDiscoveryService.prototype, 'discoverAllResources').mockResolvedValue({
    job_id: 'stub-job', resources_discovered: 0, resources_updated: 0, resources_deleted: 0, errors: [], warnings: [],
  } as any);
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  connectTestHooks.roleCheckPolicy = instantPolicy();
  connectTestHooks.probeClients = probeClients();
});

afterEach(() => {
  resetConnectTestHooks();
  jest.restoreAllMocks();
});

const auth = { Authorization: 'Bearer test-token' };
async function connectInit() {
  const res = await fetch(`${baseUrl}/accounts/connect-init`, { headers: auth });
  return { status: res.status, body: await res.json() as any, cacheControl: res.headers.get('cache-control') };
}
async function connect(roleArn: string) {
  const res = await fetch(`${baseUrl}/accounts`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ roleArn }),
  });
  return { status: res.status, body: await res.json() as any, text: '' };
}
const roleArnFor = (accountId: string) => `arn:aws:iam::${accountId}:role/DevControlRole`;

describe('connect-init: one stable External ID per organization', () => {
  it('returns the same External ID on every visit, owner-only and not cached, and the trust policy names it', async () => {
    await insertOwner();
    const first = await connectInit();
    expect(first.status).toBe(200);
    expect(first.cacheControl).toBe('private, no-store');
    const externalId = first.body.data.externalId;
    expect(externalId).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(first.body.data.trustPolicy.Statement[0].Condition.StringEquals['sts:ExternalId']).toBe(externalId);
    for (let i = 0; i < 3; i++) expect((await connectInit()).body.data.externalId).toBe(externalId);
  });

  it('keeps the value after any amount of time: no expiry is consulted', async () => {
    const { orgId } = await insertOwner();
    const first = (await connectInit()).body.data.externalId;
    await pool.query(`UPDATE aws_connect_sessions SET expires_at = NOW() - INTERVAL '30 days' WHERE org_id = $1`, [orgId]);
    expect((await connectInit()).body.data.externalId).toBe(first);
  });

  it('an organization connected by the previous release shows the value its connection already trusts', async () => {
    const { orgId } = await insertOwner();
    const accountId = uniqueAccountId();
    await pool.query(
      `INSERT INTO aws_accounts (org_id, role_arn, account_id, external_id, status, connected_at) VALUES ($1, $2, $3, 'Trusted_By_Aws-001', 'active', NOW())`,
      [orgId, roleArnFor(accountId), accountId]
    );
    expect((await connectInit()).body.data.externalId).toBe('Trusted_By_Aws-001');
  });

  it('a database failure is a safe 500, never a hang', async () => {
    await insertOwner();
    jest.spyOn(externalIdRepository, 'resolveOrganizationExternalId').mockRejectedValue(new Error('connection terminated'));
    const res = await connectInit();
    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Failed to initialise connect session.');
  });
});

describe('POST /accounts: uses the stable External ID', () => {
  it('connects with no connect session at all, sending and storing the value connect-init showed', async () => {
    const { orgId } = await insertOwner();
    const externalId = (await connectInit()).body.data.externalId;
    await pool.query(`DELETE FROM aws_connect_sessions WHERE org_id = $1`, [orgId]);
    mockStsSend.mockResolvedValue({ Credentials: CREDENTIALS });

    const accountId = uniqueAccountId();
    const res = await connect(roleArnFor(accountId));
    expect(res.status).toBe(201);
    expect(mockStsSend).toHaveBeenCalledTimes(1);
    expect(mockStsSend.mock.calls[0][0]).toMatchObject({ RoleArn: roleArnFor(accountId), ExternalId: externalId, RoleSessionName: 'devcontrol-validation' });
    const stored = await pool.query(`SELECT external_id FROM aws_accounts WHERE org_id = $1`, [orgId]);
    expect(stored.rows[0].external_id).toBe(externalId);
  });

  it('a database failure reading the External ID is a safe 500 with a code, and no AWS call is made', async () => {
    await insertOwner();
    jest.spyOn(externalIdRepository, 'resolveOrganizationExternalId').mockRejectedValue(new Error('connection terminated'));
    const res = await connect(roleArnFor(uniqueAccountId()));
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, code: 'CONNECT_STATE_UNAVAILABLE', message: CONNECT_STATE_UNAVAILABLE_MESSAGE });
    expect(mockStsSend).not.toHaveBeenCalled();
  });

  it('a malformed ARN or a wrong role name is refused before any AWS call', async () => {
    await insertOwner();
    const malformed = await connect('arn:aws:iam::12345:role/DevControlRole');
    expect(malformed.status).toBe(400);
    expect(malformed.body.code).toBe('ROLE_ARN_MALFORMED');
    const prefix = await connect(`arn:aws:iam::${uniqueAccountId()}:role/OtherRole`);
    expect(prefix.status).toBe(422);
    expect(prefix.body.code).toBe('ROLE_NAME_PREFIX');
    expect(prefix.body.message).toContain("IAM roles can't be renamed, so create a new role with a matching name, then paste its ARN.");
    expect(mockStsSend).not.toHaveBeenCalled();
  });
});

describe('POST /accounts: role check retry and error codes', () => {
  it('IAM propagation: AccessDenied twice, then success, connects', async () => {
    await insertOwner();
    mockStsSend
      .mockRejectedValueOnce(awsError('AccessDenied', 403))
      .mockRejectedValueOnce(awsError('AccessDenied', 403))
      .mockResolvedValueOnce({ Credentials: CREDENTIALS });
    const res = await connect(roleArnFor(uniqueAccountId()));
    expect(res.status).toBe(201);
    expect(mockStsSend).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['AccessDenied on every attempt', 'AccessDenied', 403, 'role_not_assumable', 5],
    ['throttling on every attempt', 'Throttling', 400, 'aws_unavailable', 5],
    ['NoSuchEntity (never retried)', 'NoSuchEntity', 404, 'role_not_found', 1],
    ['a validation error (never retried)', 'ValidationError', 400, 'role_check_failed', 1],
  ] as const)('%s: fixed status, code and message, nothing saved, nothing leaked', async (_label, name, status, failure, calls) => {
    const { orgId } = await insertOwner();
    const externalId = (await connectInit()).body.data.externalId;
    mockStsSend.mockRejectedValue(awsError(name, status));
    const res = await connect(roleArnFor(uniqueAccountId()));
    const expected = ROLE_CHECK_RESPONSES[failure];
    expect(res.status).toBe(expected.status);
    expect(res.body).toEqual({ success: false, code: expected.code, message: expected.message });
    expect(mockStsSend).toHaveBeenCalledTimes(calls);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(externalId);
    expect(body).not.toContain('not authorized');
    expect(body).not.toContain('req-test');
    const saved = await pool.query(`SELECT 1 FROM aws_accounts WHERE org_id = $1`, [orgId]);
    expect(saved.rows).toHaveLength(0);
  });

  it("the platform's own credentials failing is a 503 and is never retried", async () => {
    await insertOwner();
    mockStsSend.mockRejectedValue(Object.assign(new Error('Could not load credentials from any providers'), { name: 'CredentialsProviderError' }));
    const res = await connect(roleArnFor(uniqueAccountId()));
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('PLATFORM_AWS_UNAVAILABLE');
    expect(mockStsSend).toHaveBeenCalledTimes(1);
  });

  it('stops retrying once the client disconnects', async () => {
    await insertOwner();
    // Real (short) waits so the client can go away mid-retry.
    connectTestHooks.roleCheckPolicy = {
      maxElapsedMs: 10_000, attemptTimeoutMs: 1_000, baseDelayMs: 100, maxDelayMs: 100,
      random: () => 0.999999, now: Date.now,
      sleep: (ms, signal) => new Promise((resolve) => {
        const t = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
      }),
    };
    mockStsSend.mockRejectedValue(awsError('AccessDenied', 403));
    const controller = new AbortController();
    const request = fetch(`${baseUrl}/accounts`, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ roleArn: roleArnFor(uniqueAccountId()) }), signal: controller.signal,
    }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 250));
    controller.abort();
    await request;
    await new Promise((r) => setTimeout(r, 150));
    const callsAfterAbort = mockStsSend.mock.calls.length;
    await new Promise((r) => setTimeout(r, 600));
    expect(mockStsSend.mock.calls.length).toBe(callsAfterAbort);
    expect(callsAfterAbort).toBeLessThan(10);
  });
});

describe('POST /accounts: permission check (warns, never blocks)', () => {
  it('a denied operation is reported in the 201 and the connection is saved', async () => {
    const { orgId } = await insertOwner();
    connectTestHooks.probeClients = probeClients(['s3', 'costExplorer']);
    mockStsSend.mockResolvedValue({ Credentials: CREDENTIALS });
    const res = await connect(roleArnFor(uniqueAccountId()));
    expect(res.status).toBe(201);
    expect(res.body.permissionCheck.checks).toEqual([
      { action: 'ec2:DescribeRegions', status: 'verified' },
      { action: 's3:ListAllMyBuckets', status: 'denied' },
      { action: 'lambda:ListFunctions', status: 'verified' },
      { action: 'cloudwatch:GetMetricData', status: 'verified' },
      { action: 'ce:GetCostAndUsage', status: 'denied' },
      { action: 'resource-explorer-2:Search', status: 'verified' },
    ]);
    expect(JSON.stringify(res.body.permissionCheck)).not.toContain('not authorized');
    const saved = await pool.query(`SELECT status FROM aws_accounts WHERE org_id = $1`, [orgId]);
    expect(saved.rows[0].status).toBe('active');
  });

  it('a successful AssumeRole without credentials is never reported as verified permissions', async () => {
    await insertOwner();
    resetConnectTestHooks();
    connectTestHooks.roleCheckPolicy = instantPolicy();
    mockStsSend.mockResolvedValue({});
    const res = await connect(roleArnFor(uniqueAccountId()));
    expect(res.status).toBe(201);
    expect(res.body.permissionCheck.checks.every((c: any) => c.status === 'not_verified')).toBe(true);
  });

  it('an already-connected organization gets 409 and no permission probes run', async () => {
    await insertOwner();
    const clients = probeClients();
    connectTestHooks.probeClients = clients;
    mockStsSend.mockResolvedValue({ Credentials: CREDENTIALS });
    expect((await connect(roleArnFor(uniqueAccountId()))).status).toBe(201);
    (clients.ec2.send as jest.Mock).mockClear();
    const second = await connect(roleArnFor(uniqueAccountId()));
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('ALREADY_CONNECTED');
    expect(clients.ec2.send).not.toHaveBeenCalled();
  });
});
