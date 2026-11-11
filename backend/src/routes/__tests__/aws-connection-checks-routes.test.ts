/**
 * AWS connect PR D1a over the real routes (real authenticate middleware, real
 * RLS wiring, real database), with STS, the probes, the IAM policy compare and
 * the background discovery stubbed:
 *
 *   POST /api/aws/accounts
 *     - an organization with ANY aws_accounts row gets 409 ALREADY_CONNECTED (B1)
 *       before any AWS call, External ID read or probe (D1-D14); a database
 *       failure there is 500 CONNECT_STATE_UNAVAILABLE; a row inserted after
 *       the pre-check still makes the INSERT answer 409;
 *     - a new connection's first health (ok) and role ID baseline are written in
 *       the INSERT's own transaction; the probes and the policy compare are saved
 *       and returned as `checks`, and `permissionCheck` is kept; a checks write
 *       that fails never fails the connect.
 *   GET /api/aws/accounts/checks: the saved results after a "reload" (a fresh app
 *     instance), fixed verdicts and dates only: never the role ID, a policy
 *     document, an External ID or a role ARN; `checkAgain` for the owner only.
 *   GET /api/aws/accounts: connection.health.
 *   POST /api/aws/accounts/check-again (owner only, B4): 409 when not connected;
 *     429 CHECK_COOLDOWN across two app instances on one database (B5); 409 when
 *     the organization's slot is busy; a refused AssumeRole is recorded as failing
 *     (B7); AWS unavailable (B8); a success saves everything, re-baselines the
 *     role ID, clears role_replaced_at and writes an audit row with no External
 *     ID or ARN; a connection replaced mid-check is 409 CONNECTION_CHANGED (B6)
 *     with nothing saved.
 *
 * Placeholders only.
 */
import express from 'express';
import http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';
import awsRoutes, {
  ALREADY_CONNECTED_MESSAGE,
  CHECK_AGAIN_FORBIDDEN_MESSAGE,
  CHECK_AGAIN_MESSAGES,
  connectTestHooks,
  resetConnectTestHooks,
} from '../aws.routes';
import { authService } from '../../services/auth.service';
import { AWSResourceDiscoveryService } from '../../services/awsResourceDiscovery';
import * as externalIds from '../../repositories/aws-external-id.repository';
import * as checksRepository from '../../repositories/aws-connection-checks.repository';
import { withConnectionChange } from '../../services/aws-connection-fence';
import { ConnectCheckSlots } from '../../services/connect-check-slots';
import { pool as appPool, requestContext } from '../../config/database';
import { ensureSharedFixtureTable } from './shared-fixture-tables';
import type { RoleCheckPolicy } from '../../services/connect-role-check';
import type { ProbeClients } from '../../services/connect-permission-check';
import { DISCOVERY_FAILED_MESSAGE } from '../../services/discovery-job-messages';

const mockStsSend = jest.fn();
jest.mock('@aws-sdk/client-sts', () => ({
  STSClient: jest.fn().mockImplementation(() => ({ send: (...args: unknown[]) => mockStsSend(...args) })),
  AssumeRoleCommand: jest.fn().mockImplementation((input: unknown) => input),
}));

const PLATFORM_ACCOUNT_ID = '123456789012';
const ROLE_ID = 'AROAEXAMPLEROLEID0001';
const NEW_ROLE_ID = 'AROAEXAMPLEROLEID0002';

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

type Who = { orgId: string; userId: string };
let current: Who;

async function insertUser(orgId: string, role: 'owner' | 'member'): Promise<string> {
  const suffix = uniqueSuffix();
  const userId = (await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'D1 Checks') RETURNING id`, [`d1-checks-${suffix}@example.com`])).rows[0].id as string;
  createdUserIds.push(userId);
  await pool.query(`INSERT INTO organization_memberships (organization_id, user_id, role, joined_at, is_active) VALUES ($1, $2, $3, NOW(), true)`, [orgId, userId, role]);
  return userId;
}
async function insertOrg(): Promise<Who> {
  const suffix = uniqueSuffix();
  const orgId = (await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status) VALUES ($1, $2, $1, 'free', 'free') RETURNING id`,
    [`D1 Checks ${suffix}`, `d1-checks-${suffix}`])).rows[0].id as string;
  createdOrgIds.push(orgId);
  const who = { orgId, userId: await insertUser(orgId, 'owner') };
  current = who;
  return who;
}
/**
 * A second copy of the routes and everything they load (an isolated module registry): its own
 * process-local state (slots, any cache), as another server process would have; only the database is
 * shared. A cooldown kept in memory would not be seen by it.
 */
type Isolated = {
  routes: typeof import('../aws.routes');
  auth: typeof import('../../services/auth.service');
  discovery: typeof import('../../services/awsResourceDiscovery');
  pool: Pool;
};
let isolated: Isolated;
jest.isolateModules(() => {
  isolated = {
    /* eslint-disable @typescript-eslint/no-require-imports */
    routes: require('../aws.routes'),
    auth: require('../../services/auth.service'),
    discovery: require('../../services/awsResourceDiscovery'),
    pool: require('../../config/database').pool,
    /* eslint-enable @typescript-eslint/no-require-imports */
  };
});
const allHooks = () => [connectTestHooks, isolated.routes.connectTestHooks];

function actAs(who: Who, role: 'owner' | 'member' = 'owner') {
  current = who;
  const claims = { userId: who.userId, email: 'd1@example.com', organizationId: who.orgId, role, type: 'access' } as any;
  jest.spyOn(authService, 'verifyToken').mockReturnValue(claims);
  jest.spyOn(isolated.auth.authService, 'verifyToken').mockReturnValue(claims);
}

function instantPolicy(): RoleCheckPolicy {
  let clock = 0;
  return { maxElapsedMs: 20_000, attemptTimeoutMs: 5_000, baseDelayMs: 1_000, maxDelayMs: 8_000, random: () => 0.999999, now: () => clock, sleep: async (ms: number) => { clock += ms; } };
}
function probeClients(): ProbeClients & { calls: () => number } {
  const sends: jest.Mock[] = [];
  const make = (region?: boolean) => {
    const send = jest.fn(() => Promise.resolve(region ? { Regions: [{ RegionName: 'us-east-1', OptInStatus: 'opt-in-not-required' }] } : {}));
    sends.push(send);
    return { send };
  };
  const clients = { ec2: make(true), s3: make(), lambda: make(), cloudWatch: make(), costExplorer: make(), resourceExplorer: make() } as unknown as ProbeClients;
  return Object.assign(clients, { calls: () => sends.reduce((n, s) => n + s.mock.calls.length, 0) });
}
/** A fake IAM client: SecurityAudit + ViewOnlyAccess attached, no inline policy. */
function fakeIam() {
  return {
    send: jest.fn(async (command: any) => {
      const name = command?.constructor?.name;
      if (name === 'ListAttachedRolePoliciesCommand') {
        return { AttachedPolicies: [{ PolicyArn: 'arn:aws:iam::aws:policy/SecurityAudit' }, { PolicyArn: 'arn:aws:iam::aws:policy/job-function/ViewOnlyAccess' }], IsTruncated: false };
      }
      if (name === 'ListRolePoliciesCommand') return { PolicyNames: [], IsTruncated: false };
      throw new Error('unexpected IAM command');
    }),
  };
}
const stsOk = (roleId = ROLE_ID) => ({
  Credentials: { AccessKeyId: 'ASIAEXAMPLE', SecretAccessKey: 'secret-example', SessionToken: 'token-example', Expiration: new Date(Date.now() + 900e3) },
  AssumedRoleUser: { AssumedRoleId: `${roleId}:devcontrol-validation`, Arn: 'arn:aws:sts::123456789012:assumed-role/DevControlRole/devcontrol-validation' },
});
const awsError = (name: string, status = 400) => Object.assign(new Error(`${name} placeholder`), { name, $metadata: { httpStatusCode: status } });

/** An express app with the routes; each is a separate "instance" (its own process-local state where any exists). */
async function startApp(routes: express.Router): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.use('/api/aws', routes);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  return {
    url: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api/aws`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

let app1: Awaited<ReturnType<typeof startApp>>;
let app2: Awaited<ReturnType<typeof startApp>>;
const savedPlatformAccountId = process.env.AWS_ACCOUNT_ID;
let probes: ReturnType<typeof probeClients>;
let iam: ReturnType<typeof fakeIam>;

beforeAll(async () => {
  process.env.AWS_ACCOUNT_ID = PLATFORM_ACCOUNT_ID;
  await ensureSharedFixtureTable(pool, 'aws_accounts');
  await ensureSharedFixtureTable(pool, 'aws_connect_sessions');
  app1 = await startApp(awsRoutes);
  app2 = await startApp(isolated.routes.default);
});

afterAll(async () => {
  if (savedPlatformAccountId === undefined) delete process.env.AWS_ACCOUNT_ID;
  else process.env.AWS_ACCOUNT_ID = savedPlatformAccountId;
  await app1.close();
  await app2.close();
  await pool.query('DELETE FROM audit_logs WHERE organization_id = ANY($1)', [createdOrgIds]);
  for (const table of ['aws_accounts', 'aws_connect_sessions']) await pool.query(`DELETE FROM ${table} WHERE org_id = ANY($1)`, [createdOrgIds]);
  await pool.query('DELETE FROM organization_memberships WHERE organization_id = ANY($1) OR user_id = ANY($2)', [createdOrgIds, createdUserIds]);
  await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds]);
  await pool.end();
  await appPool.end();
  await isolated.pool.end();
});

beforeEach(() => {
  mockStsSend.mockReset();
  mockStsSend.mockResolvedValue(stsOk());
  for (const service of [AWSResourceDiscoveryService, isolated.discovery.AWSResourceDiscoveryService]) {
    jest.spyOn(service.prototype, 'discoverAllResources').mockResolvedValue({
      job_id: 'stub-job', resources_discovered: 0, resources_updated: 0, resources_deleted: 0, errors: [], warnings: [],
    } as any);
  }
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  probes = probeClients();
  iam = fakeIam();
  for (const hooks of allHooks()) {
    hooks.roleCheckPolicy = instantPolicy();
    hooks.probeClients = probes;
    hooks.iam = iam;
  }
});
afterEach(() => {
  resetConnectTestHooks();
  isolated.routes.resetConnectTestHooks();
  jest.restoreAllMocks();
});

const auth = { Authorization: 'Bearer test-token' };
async function call(method: 'GET' | 'POST', route: string, body?: unknown, base = app1.url) {
  actAsCurrentIfUnset();
  const res = await fetch(`${base}${route}`, {
    method, headers: { ...auth, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, headers: res.headers, body: (await res.json()) as any };
}
function actAsCurrentIfUnset() {
  if (!jest.isMockFunction(authService.verifyToken)) actAs(current);
}
const connect = (roleArn: string, base?: string) => call('POST', '/accounts', { roleArn }, base);
const checks = (base?: string) => call('GET', '/accounts/checks', undefined, base);
const checkAgain = (base?: string) => call('POST', '/accounts/check-again', {}, base);
const checksRow = async (orgId: string) => (await pool.query(`SELECT * FROM aws_connection_checks WHERE organization_id = $1`, [orgId])).rows[0] ?? null;
const connectionOf = async (orgId: string) => (await pool.query(`SELECT id::text AS id, role_arn, account_id, region FROM aws_accounts WHERE org_id = $1`, [orgId])).rows[0];

async function connected(): Promise<Who & { accountId: string }> {
  const who = await insertOrg();
  actAs(who);
  const accountId = uniqueAccountId();
  const res = await connect(roleArnFor(accountId));
  expect(res.status).toBe(201);
  return { ...who, accountId };
}

describe('POST /api/aws/accounts: already connected is refused before AWS (D1-D14)', () => {
  it.each([['active'], ['disconnected'], [null]])('an organization with a %s aws_accounts row: 409 B1, no STS, no External ID, no probe', async (status) => {
    const who = await insertOrg();
    actAs(who);
    const accountId = uniqueAccountId();
    await pool.query(`INSERT INTO aws_accounts (org_id, role_arn, account_id, external_id, region, status) VALUES ($1, $2, $3, 'placeholder-external-id', 'us-east-1', $4)`,
      [who.orgId, roleArnFor(accountId), accountId, status]);
    const resolve = jest.spyOn(externalIds, 'resolveOrganizationExternalId');
    const res = await connect(roleArnFor(uniqueAccountId()));
    expect(res).toMatchObject({ status: 409, body: { success: false, code: 'ALREADY_CONNECTED', message: ALREADY_CONNECTED_MESSAGE } });
    expect(mockStsSend).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    expect(probes.calls()).toBe(0);
    expect(iam.send).not.toHaveBeenCalled();
  });

  it('a database failure reading the state: 500 CONNECT_STATE_UNAVAILABLE, no STS', async () => {
    const who = await insertOrg();
    actAs(who);
    // pool.query runs on the request's tagged client (config/database.ts): fail that one statement there.
    const getStore = requestContext.getStore.bind(requestContext);
    jest.spyOn(requestContext, 'getStore').mockImplementation(() => {
      const real = getStore();
      if (!real) return real;
      return new Proxy(real, {
        get(target, prop, receiver) {
          if (prop !== 'query') return Reflect.get(target, prop, receiver);
          return (text: unknown, ...rest: unknown[]) =>
            typeof text === 'string' && text.startsWith('SELECT 1 FROM aws_accounts WHERE org_id')
              ? Promise.reject(Object.assign(new Error('connection terminated'), { code: '57P01' }))
              : (target.query as any)(text, ...rest);
        },
      });
    });
    const res = await connect(roleArnFor(uniqueAccountId()));
    expect(res).toMatchObject({ status: 500, body: { code: 'CONNECT_STATE_UNAVAILABLE' } });
    expect(mockStsSend).not.toHaveBeenCalled();
  });

  it('a row inserted after the pre-check (a race): the INSERT still answers 409 B1', async () => {
    const who = await insertOrg();
    actAs(who);
    mockStsSend.mockImplementation(async () => {
      const accountId = uniqueAccountId();
      await pool.query(`INSERT INTO aws_accounts (org_id, role_arn, account_id, external_id, region, status) VALUES ($1, $2, $3, 'placeholder-external-id', 'us-east-1', 'active')`,
        [who.orgId, roleArnFor(accountId), accountId]);
      return stsOk();
    });
    const res = await connect(roleArnFor(uniqueAccountId()));
    expect(res).toMatchObject({ status: 409, body: { code: 'ALREADY_CONNECTED', message: ALREADY_CONNECTED_MESSAGE } });
  });

  it('the pre-check predicate and the INSERT conflict target are changed together (C-2 must keep the pair)', () => {
    const source = fs.readFileSync(path.join(__dirname, '../aws.routes.ts'), 'utf8');
    expect(source).toContain('`SELECT 1 FROM aws_accounts WHERE org_id = $1 LIMIT 1`');
    expect(source).toMatch(/INSERT INTO aws_accounts[\s\S]*?ON CONFLICT \(org_id\) DO NOTHING/);
  });
});

describe('POST /api/aws/accounts: the new connection\'s checks are saved', () => {
  it('health ok and the role ID baseline in the INSERT\'s own transaction; probes and policy compare saved and returned', async () => {
    const who = await insertOrg();
    actAs(who);
    const seenInTransaction: Array<{ accounts: number; checks: number }> = [];
    const apply = checksRepository.applyAssumeOutcome;
    jest.spyOn(checksRepository, 'applyAssumeOutcome').mockImplementation(async (...args) => {
      const out = await apply(...args);
      // From another connection, neither row is visible yet: one uncommitted transaction holds both.
      seenInTransaction.push((await pool.query(
        `SELECT (SELECT count(*)::int FROM aws_accounts WHERE org_id = $1) AS accounts, (SELECT count(*)::int FROM aws_connection_checks WHERE organization_id = $1) AS checks`, [who.orgId])).rows[0]);
      return out;
    });
    const res = await connect(roleArnFor(uniqueAccountId()));
    expect(res.status).toBe(201);
    expect(seenInTransaction).toEqual([{ accounts: 0, checks: 0 }]);
    const row = await checksRow(who.orgId);
    expect(row).toMatchObject({
      health_state: 'ok', last_attempt_result: 'ok', role_unique_id: ROLE_ID, role_unique_id_source: 'connect',
      permission_trigger: 'connect', policy_trigger: 'connect', policy_contract_version: 1,
    });
    expect(row.permission_results).toHaveLength(6);
    expect(row.policy_result).toMatchObject({ unreadable: false, securityAudit: 'attached', viewOnlyAccess: 'attached', readExtras: 'missing' });
    expect(res.body.permissionCheck.checks).toHaveLength(6);
    expect(res.body.checks).toMatchObject({ health: { state: 'ok' }, permissionCheck: { trigger: 'connect' }, policyCheck: { trigger: 'connect', securityAudit: 'attached' } });
    expect(JSON.stringify(res.body.checks)).not.toMatch(/AROA|placeholder-external-id|arn:aws:iam::\d{12}:role/);
  });

  it('a checks write that fails (table missing) never fails the connect', async () => {
    const who = await insertOrg();
    actAs(who);
    jest.spyOn(checksRepository, 'applyAssumeOutcome').mockRejectedValue(Object.assign(new Error('relation does not exist'), { code: '42P01' }));
    jest.spyOn(checksRepository, 'saveCheckResults').mockRejectedValue(Object.assign(new Error('relation does not exist'), { code: '42P01' }));
    const res = await connect(roleArnFor(uniqueAccountId()));
    expect(res.status).toBe(201);
    expect(res.body.checks).toBeNull();
    expect(res.body.permissionCheck.checks).toHaveLength(6);
    expect(await connectionOf(who.orgId)).toBeDefined();
  });
});

describe('GET /api/aws/accounts/checks and connection.health', () => {
  it('after a reload (another app instance): the saved results; never the role ID; checkAgain for the owner only', async () => {
    const who = await connected();
    const owner = await checks(app2.url);
    expect(owner.status).toBe(200);
    expect(owner.headers.get('cache-control')).toBe('private, no-store');
    expect(owner.body.data).toMatchObject({
      health: { state: 'ok', lastResult: 'ok' },
      roleReplacedAt: null,
      permissionCheck: { trigger: 'connect' },
      policyCheck: { securityAudit: 'attached' },
      refusedSources: null,
      checkAgain: { availableAt: null },
    });
    expect(owner.body.data.permissionCheck.checks).toHaveLength(6);
    expect(JSON.stringify(owner.body)).not.toMatch(/AROA|role_unique_id|roleUniqueId|placeholder-external-id|arn:aws:iam::\d{12}:role|PolicyDocument/);

    const memberId = await insertUser(who.orgId, 'member');
    actAs({ orgId: who.orgId, userId: memberId }, 'member');
    const member = await checks();
    expect(member.status).toBe(200);
    expect(member.body.data.checkAgain).toBeUndefined();
    expect(member.body.data.health.state).toBe('ok');

    const accounts = await call('GET', '/accounts');
    expect(accounts.body.connection).toEqual({ state: 'connected', health: { state: 'ok', since: expect.any(String) } });
  });

  it('not connected: 409 NOT_CONNECTED; connection has no health', async () => {
    await insertOrg();
    actAs(current);
    expect((await checks()).status).toBe(409);
    expect((await call('GET', '/accounts')).body.connection).toEqual({ state: 'not_connected' });
  });

  it('a pre-D1 connection with no checks row: not checked yet', async () => {
    const who = await insertOrg();
    actAs(who);
    const accountId = uniqueAccountId();
    await pool.query(`INSERT INTO aws_accounts (org_id, role_arn, account_id, external_id, region, status) VALUES ($1, $2, $3, 'placeholder-external-id', 'us-east-1', 'active')`,
      [who.orgId, roleArnFor(accountId), accountId]);
    const res = await checks();
    expect(res.body.data).toMatchObject({ health: { state: 'not_checked_yet' }, permissionCheck: null, policyCheck: null, refusedSources: null });
  });
});

describe('POST /api/aws/accounts/check-again', () => {
  it('a member: 403 B4, no AWS call', async () => {
    const who = await connected();
    mockStsSend.mockClear();
    const memberId = await insertUser(who.orgId, 'member');
    actAs({ orgId: who.orgId, userId: memberId }, 'member');
    expect(await checkAgain()).toMatchObject({ status: 403, body: { message: CHECK_AGAIN_FORBIDDEN_MESSAGE } });
    expect(mockStsSend).not.toHaveBeenCalled();
  });

  it('not connected: 409 NOT_CONNECTED', async () => {
    await insertOrg();
    actAs(current);
    expect(await checkAgain()).toMatchObject({ status: 409, body: { code: 'NOT_CONNECTED' } });
  });

  it('success: everything saved, the role ID re-baselined, role_replaced_at cleared, an audit row with no External ID or ARN', async () => {
    const who = await connected();
    await pool.query(`UPDATE aws_connection_checks SET role_replaced_at = now() WHERE organization_id = $1`, [who.orgId]);
    mockStsSend.mockReset();
    mockStsSend.mockResolvedValue(stsOk(NEW_ROLE_ID));
    const res = await checkAgain();
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ health: { state: 'ok' }, roleReplacedAt: null, permissionCheck: { trigger: 'check_again' }, policyCheck: { trigger: 'check_again' }, checkAgain: { availableAt: expect.any(String) } });
    expect(mockStsSend.mock.calls[0][0]).toMatchObject({ RoleSessionName: 'devcontrol-check', ExternalId: expect.any(String) });
    expect(await checksRow(who.orgId)).toMatchObject({ role_unique_id: NEW_ROLE_ID, role_unique_id_source: 'check_again', role_replaced_at: null, permission_trigger: 'check_again' });
    const audit = (await pool.query(`SELECT action, resource_type, resource_id, metadata, changes FROM audit_logs WHERE organization_id = $1 AND action = 'aws_account.checked'`, [who.orgId])).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ resource_type: 'aws_account', resource_id: null });
    expect(JSON.stringify(audit[0])).not.toMatch(/placeholder|external|arn:aws|AROA/i);
    expect(JSON.stringify(res.body)).not.toMatch(/AROA|arn:aws:iam::\d{12}:role/);
  });

  it('a second Check again within 5 minutes, on another app instance: 429 CHECK_COOLDOWN (B5) before any AWS call', async () => {
    await connected();
    expect((await checkAgain(app1.url)).status).toBe(200);
    mockStsSend.mockClear();
    const second = await checkAgain(app2.url);
    expect(second.status).toBe(429);
    expect(second.body).toMatchObject({ code: 'CHECK_COOLDOWN', availableAt: expect.any(String) });
    expect(second.body.message).toMatch(/^DevControl checked this connection a few minutes ago\. Try again after \d{2}:\d{2} UTC\.$/);
    expect(Number(second.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(mockStsSend).not.toHaveBeenCalled();
    expect(CHECK_AGAIN_MESSAGES.cooldown('12:00 UTC')).toBe('DevControl checked this connection a few minutes ago. Try again after 12:00 UTC.');
  });

  it('the organization\'s check slot busy (a connect or check in flight): 409 CONNECT_CHECK_IN_PROGRESS', async () => {
    const who = await connected();
    const slots = new ConnectCheckSlots();
    const held = slots.tryAcquire(who.orgId);
    connectTestHooks.slots = slots;
    expect(await checkAgain()).toMatchObject({ status: 409, body: { code: 'CONNECT_CHECK_IN_PROGRESS' } });
    if (held.ok) held.slot.release();
  });

  it('the role refused: health failing and B7; probes not run', async () => {
    const who = await connected();
    mockStsSend.mockReset();
    mockStsSend.mockRejectedValue(awsError('AccessDenied', 403));
    const before = probes.calls();
    const res = await checkAgain();
    expect(res).toMatchObject({ status: 422, body: { code: 'ROLE_NOT_ASSUMABLE', message: CHECK_AGAIN_MESSAGES.roleRefused } });
    expect(res.body.message).toBe("DevControl couldn't assume your role. Its health on this page now shows the failure.");
    expect(probes.calls()).toBe(before);
    expect(await checksRow(who.orgId)).toMatchObject({ health_state: 'failing', last_attempt_result: 'role_refused', consecutive_role_failures: 1 });
    expect((await checks()).body.data.health).toMatchObject({ state: 'failing', failingSince: expect.any(String) });
  });

  it('AWS unavailable: B8, the attempt recorded, the state unchanged', async () => {
    const who = await connected();
    mockStsSend.mockReset();
    mockStsSend.mockRejectedValue(awsError('InternalFailure', 500));
    const res = await checkAgain();
    expect(res).toMatchObject({ status: 503, body: { code: 'AWS_UNAVAILABLE', message: "AWS didn't respond while we checked your role. Nothing was changed. Please try again in a minute." } });
    expect(await checksRow(who.orgId)).toMatchObject({ health_state: 'ok', last_attempt_result: 'aws_unavailable' });
  });

  it('the connection replaced while checking: 409 CONNECTION_CHANGED (B6), nothing saved for either connection', async () => {
    const who = await connected();
    const before = await checksRow(who.orgId);
    const old = await connectionOf(who.orgId);
    mockStsSend.mockReset();
    mockStsSend.mockImplementation(async () => {
      await withConnectionChange(pool, who.orgId, async (c) => {
        await c.query(`DELETE FROM aws_accounts WHERE id = $1`, [old.id]);
        const accountId = uniqueAccountId();
        await c.query(`INSERT INTO aws_accounts (org_id, role_arn, account_id, external_id, region, status) VALUES ($1, $2, $3, 'placeholder-external-id', 'us-east-1', 'active')`,
          [who.orgId, roleArnFor(accountId), accountId]);
      });
      return stsOk(NEW_ROLE_ID);
    });
    const res = await checkAgain();
    expect(res).toMatchObject({ status: 409, body: { code: 'CONNECTION_CHANGED', message: 'Your AWS connection changed while DevControl was checking it. Nothing was saved. Refresh the page.' } });
    const after = await pool.query(`SELECT aws_account_id::text AS id, role_unique_id, permission_trigger, last_attempt_at FROM aws_connection_checks WHERE organization_id = $1`, [who.orgId]);
    // The old connection's row (no foreign key in the test schema) is exactly as before; the new one has none.
    expect(after.rows).toEqual([{ id: old.id, role_unique_id: before.role_unique_id, permission_trigger: 'connect', last_attempt_at: before.last_attempt_at }]);
  });
});

describe('copy', () => {
  it('B2 is the failed-discovery text', () => {
    expect(DISCOVERY_FAILED_MESSAGE).toBe('Discovery could not complete. Check the AWS connection on the Connect AWS page, then try again.');
    expect(ALREADY_CONNECTED_MESSAGE).toBe('This organization already has a connected AWS account. To disconnect or change accounts, contact us.');
  });
});
