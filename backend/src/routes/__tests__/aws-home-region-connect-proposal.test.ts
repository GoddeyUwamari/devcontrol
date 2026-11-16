/**
 * Home region HR-1 item 3: the proposal made at connect (home-region-proposal.ts),
 * over the real POST /api/aws/accounts route (real authenticate middleware, real
 * database), with STS, the probes, the IAM compare, the background scan and Cost
 * Explorer stubbed:
 *
 *   - ONE GetCostAndUsage request: the connected account only (LINKED_ACCOUNT from
 *     the role ARN), usage charges only (RECORD_TYPE = Usage), MONTHLY,
 *     UnblendedCost, grouped by REGION, the last 30 full UTC days;
 *   - the evaluated proposal is stored once for the new connection row (proposed /
 *     no_signal / unavailable) and reads back on GET /api/aws/accounts;
 *   - the home region itself is never changed by it (T6);
 *   - a refused or failing Cost Explorer stores unavailable and logs the error NAME
 *     only, never AWS's message; a failed save never fails the connect;
 *   - no proposal (and no request) when a suite stubs the probes and no Cost
 *     Explorer, or when the connect is refused (409) before any AWS call.
 *
 * Placeholders only.
 */
import express from 'express';
import http from 'http';
import { Pool } from 'pg';
import { GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';
import awsRoutes, { connectTestHooks, resetConnectTestHooks } from '../aws.routes';
import { authService } from '../../services/auth.service';
import { AWSResourceDiscoveryService } from '../../services/awsResourceDiscovery';
import * as checksRepository from '../../repositories/aws-connection-checks.repository';
import { pool as appPool } from '../../config/database';
import { ensureSharedFixtureTable } from './shared-fixture-tables';
import type { RoleCheckPolicy } from '../../services/connect-role-check';
import type { ProbeClients } from '../../services/connect-permission-check';
import { proposalPeriod } from '../../services/home-region-proposal';

const mockStsSend = jest.fn();
jest.mock('@aws-sdk/client-sts', () => ({
  STSClient: jest.fn().mockImplementation(() => ({ send: (...args: unknown[]) => mockStsSend(...args) })),
  AssumeRoleCommand: jest.fn().mockImplementation((input: unknown) => input),
}));

const PLATFORM_ACCOUNT_ID = '123456789012';
const ROLE_ID = 'AROAEXAMPLEROLEID0001';
const AWS_MESSAGE = 'User: arn:aws:sts::111122223333:assumed-role/DevControlRole/devcontrol-validation is not authorized to perform: ce:GetCostAndUsage';

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

async function ownerOrg(): Promise<{ orgId: string; userId: string }> {
  const suffix = uniqueSuffix();
  const orgId = (await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status) VALUES ($1, $2, $1, 'free', 'free') RETURNING id`,
    [`HR Connect ${suffix}`, `hr-connect-${suffix}`])).rows[0].id as string;
  createdOrgIds.push(orgId);
  const userId = (await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'HR Connect') RETURNING id`, [`hr-connect-${suffix}@example.com`])).rows[0].id as string;
  createdUserIds.push(userId);
  await pool.query(`INSERT INTO organization_memberships (organization_id, user_id, role, joined_at, is_active) VALUES ($1, $2, 'owner', NOW(), true)`, [orgId, userId]);
  jest.spyOn(authService, 'verifyToken').mockReturnValue({ userId, email: 'hr@example.com', organizationId: orgId, role: 'owner', type: 'access' } as any);
  return { orgId, userId };
}

function instantPolicy(): RoleCheckPolicy {
  let clock = 0;
  return { maxElapsedMs: 20_000, attemptTimeoutMs: 5_000, baseDelayMs: 1_000, maxDelayMs: 8_000, random: () => 0.999999, now: () => clock, sleep: async (ms: number) => { clock += ms; } };
}
function probeClients(): ProbeClients {
  const make = (region?: boolean) => ({ send: jest.fn(() => Promise.resolve(region ? { Regions: [{ RegionName: 'us-east-1', OptInStatus: 'opt-in-not-required' }] } : {})) });
  return { ec2: make(true), s3: make(), lambda: make(), cloudWatch: make(), costExplorer: make(), resourceExplorer: make() } as unknown as ProbeClients;
}
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
const stsOk = () => ({
  Credentials: { AccessKeyId: 'ASIAEXAMPLE', SecretAccessKey: 'secret-example', SessionToken: 'token-example', Expiration: new Date(Date.now() + 900e3) },
  AssumedRoleUser: { AssumedRoleId: `${ROLE_ID}:devcontrol-validation`, Arn: 'arn:aws:sts::123456789012:assumed-role/DevControlRole/devcontrol-validation' },
});

/** A Cost Explorer double: one page with these region amounts (strings, as Cost Explorer sends them). */
function costExplorer(groups: Record<string, string> | Error) {
  return {
    send: jest.fn(async (command: GetCostAndUsageCommand, _options?: { abortSignal?: AbortSignal }) => {
      expect(command).toBeInstanceOf(GetCostAndUsageCommand);
      if (groups instanceof Error) throw groups;
      return {
        $metadata: {},
        ResultsByTime: [{ Groups: Object.entries(groups).map(([region, amount]) => ({ Keys: [region], Metrics: { UnblendedCost: { Amount: amount, Unit: 'USD' } } })) }],
      };
    }),
  };
}

let server: http.Server;
let baseUrl = '';
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
  await pool.query('DELETE FROM audit_logs WHERE organization_id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM aws_connection_checks WHERE organization_id = ANY($1)', [createdOrgIds]);
  for (const table of ['aws_accounts', 'aws_connect_sessions']) await pool.query(`DELETE FROM ${table} WHERE org_id = ANY($1)`, [createdOrgIds]);
  await pool.query('DELETE FROM organization_memberships WHERE organization_id = ANY($1) OR user_id = ANY($2)', [createdOrgIds, createdUserIds]);
  await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds]);
  await pool.end();
  await appPool.end();
});

beforeEach(() => {
  mockStsSend.mockReset();
  mockStsSend.mockResolvedValue(stsOk());
  jest.spyOn(AWSResourceDiscoveryService.prototype, 'discoverAllResources').mockResolvedValue({
    job_id: 'stub-job', resources_discovered: 0, resources_updated: 0, resources_deleted: 0, errors: [], warnings: [],
  } as any);
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  connectTestHooks.roleCheckPolicy = instantPolicy();
  connectTestHooks.probeClients = probeClients();
  connectTestHooks.iam = fakeIam();
});
afterEach(() => {
  resetConnectTestHooks();
  jest.restoreAllMocks();
});

async function call(method: 'GET' | 'POST', route: string, body?: unknown) {
  const res = await fetch(`${baseUrl}${route}`, {
    method, headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}
const proposalRow = async (orgId: string) => (await pool.query(
  `SELECT home_region_proposal_state AS state, home_region_proposal AS proposal, home_region_proposed_at IS NOT NULL AS evaluated,
          home_region_decided_at AS decided
     FROM aws_connection_checks WHERE organization_id = $1`, [orgId])).rows[0] ?? null;
const regionOf = async (orgId: string) => (await pool.query(`SELECT region FROM aws_accounts WHERE org_id = $1`, [orgId])).rows[0]?.region;

describe('POST /api/aws/accounts: the home-region proposal (HR-D5, HR-D6)', () => {
  it('a clear leader: one request, exactly shaped; proposed is stored once; the home region is not changed', async () => {
    const { orgId } = await ownerOrg();
    const accountId = uniqueAccountId();
    const ce = costExplorer({ 'us-west-2': '1284.10', 'eu-west-1': '120.33', 'us-east-2': '78.40', 'us-east-1': '45.92', global: '900.00', NoRegion: '12.00' });
    connectTestHooks.costExplorer = ce;
    const before = Date.now();
    const res = await call('POST', '/accounts', { roleArn: roleArnFor(accountId) });
    expect(res.status).toBe(201);

    expect(ce.send).toHaveBeenCalledTimes(1);
    const input = (ce.send.mock.calls[0][0] as GetCostAndUsageCommand).input;
    const period = proposalPeriod(new Date(before));
    expect(input).toEqual({
      TimePeriod: { Start: period.start, End: period.end },
      Granularity: 'MONTHLY',
      Metrics: ['UNBLENDED_COST'],
      GroupBy: [{ Type: 'DIMENSION', Key: 'REGION' }],
      Filter: {
        And: [
          { Dimensions: { Key: 'LINKED_ACCOUNT', Values: [accountId] } },
          { Dimensions: { Key: 'RECORD_TYPE', Values: ['Usage'] } },
        ],
      },
    });
    expect(ce.send.mock.calls[0][1]?.abortSignal).toBeDefined();

    expect(await proposalRow(orgId)).toEqual({
      state: 'proposed',
      evaluated: true,
      decided: null,
      proposal: {
        rule_version: 2,
        basis: 'cost_explorer_30d_usage',
        period,
        region: 'us-west-2',
        current: 'us-east-1',
        outcome: 'proposed',
        total_amount: 1528.75,
        top: [
          { region: 'us-west-2', share: 84, amount: 1284.1 },
          { region: 'eu-west-1', share: 7.9, amount: 120.33 },
          { region: 'us-east-2', share: 5.1, amount: 78.4 },
          { region: 'us-east-1', share: 3, amount: 45.92 },
        ],
        other_regions: null,
        current_share: 3,
        current_amount: 45.92,
        non_region_amount: 912,
      },
    });
    expect(await regionOf(orgId)).toBe('us-east-1');
    // No region list is stored until the first scan: the GET says waiting, not proposed.
    const accounts = await call('GET', '/accounts');
    expect(accounts.body.home_region_proposal).toEqual({
      state: 'waiting',
      region: 'us-west-2',
      period,
      shares: [
        { region: 'us-west-2', share: 84, amount: 1284.1 },
        { region: 'eu-west-1', share: 7.9, amount: 120.33 },
        { region: 'us-east-2', share: 5.1, amount: 78.4 },
        { region: 'us-east-1', share: 3, amount: 45.92 },
      ],
      other_regions: null,
      current: { region: 'us-east-1', share: 3, amount: 45.92 },
      non_region_amount: 912,
    });
  });

  it('a near tie (split spend): split is stored with the top regions, nothing is selected, the home region stays', async () => {
    const { orgId } = await ownerOrg();
    connectTestHooks.costExplorer = costExplorer({ 'us-west-2': '100', 'eu-west-1': '90', 'us-east-1': '1' });
    expect((await call('POST', '/accounts', { roleArn: roleArnFor(uniqueAccountId()) })).status).toBe(201);
    const row = await proposalRow(orgId);
    expect(row).toMatchObject({ state: 'split', evaluated: true, decided: null, proposal: { region: null, outcome: 'near_tie' } });
    expect(row.proposal.top.map((t: { region: string }) => t.region)).toEqual(['us-west-2', 'eu-west-1', 'us-east-1']);
    expect(await regionOf(orgId)).toBe('us-east-1');
    // No region list yet: nothing to choose from until the first scan stores one.
    expect((await call('GET', '/accounts')).body.home_region_proposal).toMatchObject({ state: 'split_waiting', region: null });
  });

  it('the current home region leads: no_signal, no prompt, the home region stays', async () => {
    const { orgId } = await ownerOrg();
    connectTestHooks.costExplorer = costExplorer({ 'us-east-1': '100', 'us-west-2': '95' });
    expect((await call('POST', '/accounts', { roleArn: roleArnFor(uniqueAccountId()) })).status).toBe(201);
    expect(await proposalRow(orgId)).toMatchObject({ state: 'no_signal', proposal: { region: null } });
    expect(await regionOf(orgId)).toBe('us-east-1');
    expect((await call('GET', '/accounts')).body.home_region_proposal).toMatchObject({ state: 'no_signal', region: null });
  });

  it.each([
    ['throttled', Object.assign(new Error('Rate exceeded'), { name: 'ThrottlingException' })],
    ['an empty answer', null],
  ])('%s: no prompt (unavailable or no_signal), never split', async (_name, answer) => {
    const { orgId } = await ownerOrg();
    connectTestHooks.costExplorer = answer instanceof Error ? costExplorer(answer) : costExplorer({});
    expect((await call('POST', '/accounts', { roleArn: roleArnFor(uniqueAccountId()) })).status).toBe(201);
    expect(['unavailable', 'no_signal']).toContain((await proposalRow(orgId)).state);
  });

  it('Cost Explorer refused: unavailable is stored; the log names the error only, never AWS\'s message; the connect succeeds', async () => {
    const { orgId } = await ownerOrg();
    connectTestHooks.costExplorer = costExplorer(Object.assign(new Error(AWS_MESSAGE), { name: 'AccessDeniedException' }));
    const res = await call('POST', '/accounts', { roleArn: roleArnFor(uniqueAccountId()) });
    expect(res.status).toBe(201);
    expect(await proposalRow(orgId)).toEqual({ state: 'unavailable', evaluated: true, decided: null, proposal: null });
    const logged = [console.warn, console.error, console.log].flatMap((fn) => (fn as jest.Mock).mock.calls.map((args) => args.map(String).join(' ')));
    expect(logged.some((line) => line.includes('[HomeRegion] proposal unavailable') && line.includes('denied, AccessDeniedException'))).toBe(true);
    expect(logged.join('\n')).not.toContain('not authorized');
    expect(logged.join('\n')).not.toContain('111122223333');
  });

  it('a failed proposal save never fails the connect, and the checks are still saved', async () => {
    const { orgId } = await ownerOrg();
    connectTestHooks.costExplorer = costExplorer({ 'us-west-2': '100' });
    jest.spyOn(checksRepository, 'saveHomeRegionProposal').mockRejectedValue(Object.assign(new Error('boom'), { name: 'BoomError' }));
    const res = await call('POST', '/accounts', { roleArn: roleArnFor(uniqueAccountId()) });
    expect(res.status).toBe(201);
    expect(res.body.checks).not.toBeNull();
    expect((await proposalRow(orgId))?.state ?? null).toBeNull();
  });

  it('probes stubbed and no Cost Explorer set: no request, no proposal', async () => {
    const { orgId } = await ownerOrg();
    const probes = connectTestHooks.probeClients as any;
    expect((await call('POST', '/accounts', { roleArn: roleArnFor(uniqueAccountId()) })).status).toBe(201);
    expect((await proposalRow(orgId))?.state ?? null).toBeNull();
    expect(probes.costExplorer.send).toHaveBeenCalledTimes(1); // the permission probe's own request only
  });

  it('an organization already connected is refused before any AWS call: no Cost Explorer request, the stored proposal untouched', async () => {
    const { orgId } = await ownerOrg();
    const first = costExplorer({ 'us-west-2': '100' });
    connectTestHooks.costExplorer = first;
    expect((await call('POST', '/accounts', { roleArn: roleArnFor(uniqueAccountId()) })).status).toBe(201);
    const stored = await proposalRow(orgId);
    const second = costExplorer({ 'eu-west-1': '500' });
    connectTestHooks.costExplorer = second;
    expect((await call('POST', '/accounts', { roleArn: roleArnFor(uniqueAccountId()) })).status).toBe(409);
    expect(second.send).not.toHaveBeenCalled();
    expect(await proposalRow(orgId)).toEqual(stored);
  });

  it('a proposal is saved once per connection row: a second save for the same row changes nothing', async () => {
    const { orgId } = await ownerOrg();
    connectTestHooks.costExplorer = costExplorer({ 'us-west-2': '100' });
    expect((await call('POST', '/accounts', { roleArn: roleArnFor(uniqueAccountId()) })).status).toBe(201);
    const account = (await pool.query(`SELECT id, org_id, account_id, role_arn, region FROM aws_accounts WHERE org_id = $1`, [orgId])).rows[0];
    const { awsConnectionIdentity } = await import('../../repositories/aws-accounts.repository');
    const saved = await checksRepository.saveHomeRegionProposal(orgId, awsConnectionIdentity(account), account.id, { state: 'unavailable', proposal: null, at: new Date() }, pool);
    expect(saved).toBe(false);
    expect((await proposalRow(orgId)).state).toBe('proposed');
  });
});
