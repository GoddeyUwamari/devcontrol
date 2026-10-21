/**
 * Multi-region plan M4b: the scan lease at every entry point (§4.6), the heartbeat
 * and checkpoints (§4.2), race-safe recovery (AC-1, R1-R5), and safety across
 * processes and hosts (AC-2: overlap within one process, two pools).
 *
 * Real Postgres for every lease, job and inventory row; AWS clients are fakes (no AWS
 * call is made). "Another worker" is a lease taken on its own connection, the way a
 * scan in another process or on another host takes it. A lease expires only by the
 * database clock, never by editing its row. Placeholders only.
 */
import { Request, Response } from 'express';
import { Pool, PoolClient } from 'pg';
import { ResourceExplorer2Client } from '@aws-sdk/client-resource-explorer-2';
import { AWSResourceDiscoveryService, fatalDiscoveryErrorMessage } from '../awsResourceDiscovery';
import { AWSClientFactory } from '../aws-client-factory.service';
import costOptimizationService from '../cost-optimization.service';
import { CostRecommendationsRepository } from '../../repositories/cost-recommendations.repository';
import { CostRecommendationsController } from '../../controllers/cost-recommendations.controller';
import { ResourceDiscoveryJob } from '../../jobs/resourceDiscovery.job';
import { AWSResourcesRepository } from '../../repositories/awsResources.repository';
import { HeldLease, LeaseHeartbeat, LeaseLostError, acquireScanLease, releaseLease } from '../scan-lease';
import {
  DISCOVERY_INTERRUPTED_MESSAGE,
  DISCOVERY_LEASE_LOST_MESSAGE,
  LeaseSession,
  LeaseTiming,
  SCAN_BUSY_MESSAGE,
  SCAN_KIND_DISCOVERY,
  ScanAlreadyRunningError,
  ScanBusyError,
  UNPARSEABLE_ROLE_ARN_WARNING,
  leaseAccountFor,
  onTaggedConnection,
} from '../scan-session';
import { DISCOVERY_WARNING_SCAN_LEASE_LOST } from '../discovery-warnings';
import { PLACEHOLDER_ACCOUNT_ROW, connectPlaceholderAccount, removePlaceholderAccounts, stubScanSource } from './helpers/scan-source';

const dbConfig = () => ({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'platform_portal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});
const pool = new Pool(dbConfig());
/** A second "host": its own pool, its own service instances. */
const pool2 = new Pool(dbConfig());
const ACCOUNT = PLACEHOLDER_ACCOUNT_ROW.account_id!;
const HOME = 'us-east-1';
const INSTANCE_ARN = `arn:aws:ec2:${HOME}:*:instance/i-1234567890abcdef0`;
const createdOrgIds: string[] = [];
const FAST: LeaseTiming = { heartbeat: { intervalMs: 200 }, pollMs: 50, acquireLockTimeoutMs: 15_000 };

async function insertOrg({ account = true }: { account?: boolean } = {}): Promise<string> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $3, 'free', 'active') RETURNING id`,
    [`M4b Lease Org ${suffix}`, `m4b-lease-org-${suffix}`, `M4b Lease Org ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  if (account) await connectPlaceholderAccount(pool, rows[0].id);
  return rows[0].id;
}

function service(timing: LeaseTiming = FAST, on: Pool = pool): AWSResourceDiscoveryService {
  const s = new AWSResourceDiscoveryService(on);
  (s as any).leaseTiming = timing;
  return s;
}

function gate(): { opened: Promise<void>; open: () => void } {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(condition: () => Promise<boolean>, what: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${what}`);
    await pause(50);
  }
}

/** A fake client answering by command name; anything unlisted fails at once. */
function fake(answers: Record<string, (input: any) => any>) {
  const calls: string[] = [];
  return {
    calls,
    send: jest.fn(async (command: { constructor: { name: string }; input?: any }) => {
      calls.push(command.constructor.name);
      const answer = answers[command.constructor.name];
      if (!answer) throw Object.assign(new Error(`Unexpected ${command.constructor.name}`), { name: 'Unexpected' });
      return answer(command.input ?? {});
    }),
  };
}

/** Resource Explorer that answers a complete, empty search, after `before()` if given. */
function explorer(before?: () => Promise<void>): ResourceExplorer2Client {
  const client = new ResourceExplorer2Client({ region: HOME });
  (client as any).send = jest.fn(async () => {
    if (before) await before();
    return { Resources: [], Count: { TotalResources: 0, Complete: true } };
  });
  return client;
}

interface Clients {
  ec2?: ReturnType<typeof fake>;
  resourceExplorer?: ResourceExplorer2Client;
}

/** Every organization's clients (free tier: EC2, EBS, RDS, S3). Calls are recorded per command. */
function mockAwsClients(overrides: Clients = {}) {
  stubScanSource();
  const ec2 = overrides.ec2 ?? fake({
    DescribeInstancesCommand: () => ({ Reservations: [] }),
    DescribeVolumesCommand: () => ({ Volumes: [] }),
    DescribeSecurityGroupsCommand: () => ({ SecurityGroups: [] }),
  });
  const rds = fake({ DescribeDBInstancesCommand: () => ({ DBInstances: [] }) });
  const s3 = fake({ ListBucketsCommand: () => ({ Buckets: [] }) });
  const iam = fake({ ListUsersCommand: () => ({ Users: [] }) });
  jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue({
    enabled: true, region: HOME, accountId: ACCOUNT,
    costExplorer: {}, ec2, rds, s3, s3Control: {}, cloudWatch: {}, lambda: {}, ecs: {}, elb: {}, eks: {}, dynamodb: {},
    cloudFront: {}, apiGateway: {}, elastiCache: {}, sqs: {}, sns: {}, iam, backup: {},
    resourceExplorer: overrides.resourceExplorer ?? explorer(),
    getDynamoDBClientForRegion: () => ({}), getApplicationAutoScalingClientForRegion: () => ({}), getCloudWatchClientForRegion: () => ({}),
  } as any);
  return { ec2, rds, s3 };
}

function mockCostStep() {
  jest.spyOn(costOptimizationService, 'analyzeAllResources').mockResolvedValue({ observations: [], riRecommendations: [], riSucceeded: false, homeRegion: HOME });
}

async function jobs(orgId: string) {
  const { rows } = await pool.query(
    `SELECT id, status, error_message, to_jsonb(j) -> 'warnings' AS warnings, completed_at IS NOT NULL AS completed
       FROM resource_discovery_jobs j WHERE organization_id = $1 ORDER BY created_at`,
    [orgId]
  );
  return rows;
}

async function leaseRow(orgId: string) {
  return (await pool.query(`SELECT * FROM aws_scan_leases WHERE organization_id = $1`, [orgId])).rows[0];
}

async function seedInstance(orgId: string, missing = 0): Promise<void> {
  await pool.query(
    `INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status, missing_scan_count)
     VALUES ($1, $2, 'i-1234567890abcdef0', 'i-1234567890abcdef0', 'ec2', $3, 'running', $4)`,
    [orgId, INSTANCE_ARN, HOME, missing]
  );
}

async function missingCount(orgId: string): Promise<number> {
  return (await pool.query(`SELECT missing_scan_count FROM aws_resources WHERE organization_id = $1 AND resource_arn = $2`, [orgId, INSTANCE_ARN])).rows[0]
    .missing_scan_count;
}

async function insertJob(orgId: string, status: string, ageMinutes: number): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO resource_discovery_jobs (organization_id, status, started_at, created_at)
     VALUES ($1, $2, NOW() - make_interval(mins => $3), NOW() - make_interval(mins => $3)) RETURNING id`,
    [orgId, status, ageMinutes]
  );
  return rows[0].id;
}

/** Another worker's scan lease, taken on its own connection (another process or host). */
async function otherWorker(orgId: string, ttlSeconds?: number): Promise<HeldLease> {
  const lease = await onTaggedConnection(pool2, orgId, (db) =>
    acquireScanLease(db, { organizationId: orgId, awsAccountId: ACCOUNT, scanKind: SCAN_KIND_DISCOVERY }, 'other-worker', { ttlSeconds })
  );
  expect(lease).not.toBeNull();
  return lease!;
}

async function release(lease: HeldLease): Promise<void> {
  await onTaggedConnection(pool2, lease.key.organizationId, (db) => releaseLease(db, lease));
}

async function untilExpired(orgId: string): Promise<void> {
  await waitFor(
    async () => (await pool.query(`SELECT expires_at <= clock_timestamp() AS expired FROM aws_scan_leases WHERE organization_id = $1`, [orgId])).rows[0]?.expired === true,
    'the lease to expire on the database clock'
  );
}

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    for (const table of [
      'soc2_evidence_observations', 'soc2_control_evaluations', 'account_security_findings', 'cost_recommendations', 'cost_analysis_runs',
      'framework_evaluation_runs', 'aws_resources', 'resource_discovery_jobs', 'aws_scan_leases', 'job_leases',
    ]) {
      await pool.query(`DELETE FROM ${table} WHERE organization_id = ANY($1)`, [createdOrgIds]).catch(() => undefined);
    }
    await removePlaceholderAccounts(pool, createdOrgIds);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
  await pool2.end();
}, 30_000);

// ---------------------------------------------------------------------------
describe('one account, one region: a scan behaves as before, holding its lease', () => {
  it('acquires, links its job, completes and releases; the job row is as before (no new text, no warnings)', async () => {
    const orgId = await insertOrg();
    mockAwsClients();
    mockCostStep();

    const result = await service().discoverAllResources(orgId);

    const [job] = await jobs(orgId);
    expect(job).toMatchObject({ id: result.job_id, status: 'completed', error_message: null, warnings: null, completed: true });
    const lease = await leaseRow(orgId);
    expect(lease).toMatchObject({ aws_account_id: ACCOUNT, scan_kind: 'discovery', job_id: result.job_id });
    expect(lease.released_at).toBeInstanceOf(Date);
  });

  it('the approved texts are exactly as approved', () => {
    expect(SCAN_BUSY_MESSAGE).toBe('A scan is already running for this AWS account. Try again in a few minutes.');
    expect(DISCOVERY_LEASE_LOST_MESSAGE).toBe('Discovery was interrupted because another scan took over. Results will update on the next sync.');
    expect(DISCOVERY_INTERRUPTED_MESSAGE).toBe('Discovery was interrupted before it finished. It will run again on the next sync.');
  });
});

// ---------------------------------------------------------------------------
describe('F4 an AssumeRole failure before the scan lease', () => {
  const assumeRoleFailure = () => Object.assign(new Error('AccessDenied: not authorized to perform sts:AssumeRole'), { name: 'AccessDenied' });

  it('takes the lease of the account the database names, records the failed job row under it, and releases it', async () => {
    const orgId = await insertOrg();
    jest.spyOn(AWSClientFactory, 'createClients').mockRejectedValue(assumeRoleFailure());

    await expect(service().discoverAllResources(orgId)).rejects.toMatchObject({ name: 'AccessDenied' });

    const recorded = await jobs(orgId);
    expect(recorded).toEqual([expect.objectContaining({ status: 'failed', error_message: fatalDiscoveryErrorMessage(assumeRoleFailure()), completed: true })]);
    expect(recorded[0].error_message).not.toContain('AssumeRole');
    const lease = await leaseRow(orgId);
    expect(lease).toMatchObject({ aws_account_id: ACCOUNT, scan_kind: 'discovery', job_id: null });
    expect(lease.released_at).toBeInstanceOf(Date);
  });

  it('another worker holding that lease: nothing is written (no job row) and its lease is untouched', async () => {
    const orgId = await insertOrg();
    const other = await otherWorker(orgId);
    jest.spyOn(AWSClientFactory, 'createClients').mockRejectedValue(assumeRoleFailure());
    try {
      await expect(service().discoverAllResources(orgId)).rejects.toMatchObject({ name: 'AccessDenied' });

      expect(await jobs(orgId)).toEqual([]);
      const row = await leaseRow(orgId);
      expect(row).toMatchObject({ holder: 'other-worker', released_at: null });
      expect(String(row.fencing_token)).toBe(other.fencingToken);
    } finally {
      await release(other);
    }
  });

  it('no account to lease (none connected): the failed job row is recorded as before, and no lease row exists', async () => {
    const orgId = await insertOrg({ account: false });
    jest.spyOn(AWSClientFactory, 'createClients').mockRejectedValue(assumeRoleFailure());

    await expect(service().discoverAllResources(orgId)).rejects.toMatchObject({ name: 'AccessDenied' });

    expect(await jobs(orgId)).toEqual([expect.objectContaining({ status: 'failed', error_message: fatalDiscoveryErrorMessage(assumeRoleFailure()) })]);
    expect(await leaseRow(orgId)).toBeUndefined();
  });
});

describe('F5 an eligible account whose role ARN names no account', () => {
  it('is logged as a warning (server log only, no ARN), nothing is leased, and Analyze writes nothing', async () => {
    const orgId = await insertOrg();
    const unparseable = 'arn:aws:iam::not-an-account:role/devcontrol-readonly';
    await pool.query(`UPDATE aws_accounts SET role_arn = $1 WHERE org_id = $2`, [unparseable, orgId]);
    const warn = console.warn as jest.Mock;

    expect(await leaseAccountFor(pool, orgId)).toBeNull();
    const warnings = warn.mock.calls.map((args) => args.join(' '));
    expect(warnings).toEqual([expect.stringContaining(UNPARSEABLE_ROLE_ARN_WARNING)]);
    expect(warnings[0]).not.toContain(unparseable);
    expect(warnings[0]).not.toContain('not-an-account');

    warn.mockClear();
    jest.spyOn(costOptimizationService, 'analyzeAllResources').mockResolvedValue({
      observations: [{ issue: 'ec2_idle_instance', success: true, recommendations: [] }], riRecommendations: [], riSucceeded: true, homeRegion: HOME,
    } as any);
    const reconcile = jest.spyOn(CostRecommendationsRepository.prototype, 'reconcileActiveRecommendations');
    const replace = jest.spyOn(CostRecommendationsRepository.prototype, 'replaceReservedInstanceRecommendations');
    const json = jest.fn();
    const res = { json, status: jest.fn().mockReturnValue({ json }) } as unknown as Response;
    const controller = new CostRecommendationsController();
    (controller as any).leaseTiming = FAST;
    await controller.analyze({ user: { organizationId: orgId, userId: 'test-user' }, query: {}, params: {}, body: {} } as unknown as Request, res);

    expect(warn.mock.calls.map((args) => args.join(' ')).filter((line) => line.includes(UNPARSEABLE_ROLE_ARN_WARNING))).toHaveLength(1);
    expect(reconcile).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect((await pool.query(`SELECT 1 FROM cost_recommendations WHERE organization_id = $1`, [orgId])).rows).toEqual([]);
    expect(await leaseRow(orgId)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
describe('AC-2: overlapping workers', () => {
  it.each([
    ['in one process (one pool)', () => pool],
    ['on two hosts (two pools, two service instances)', () => pool2],
  ])('L5/H3 same key %s: one scan runs, the other writes nothing; missing_scan_count advances by exactly 1', async (_name, second) => {
    const orgId = await insertOrg();
    await seedInstance(orgId, 0);
    const hold = gate();
    const entered = gate();
    mockAwsClients({ resourceExplorer: explorer(async () => { entered.open(); await hold.opened; }) });
    mockCostStep();

    const first = service().discoverAllResources(orgId);
    try {
      await entered.opened;
      await expect(service(FAST, second()).discoverAllResources(orgId)).rejects.toBeInstanceOf(ScanAlreadyRunningError);
      expect(await jobs(orgId)).toHaveLength(1);
      hold.open();
      await first;

      expect(await jobs(orgId)).toHaveLength(1);
      expect(await missingCount(orgId)).toBe(1);
    } finally {
      // Never leave the gated scan (and its heartbeat) running into the next test.
      hold.open();
      await first.catch(() => undefined);
    }
  }, 30_000);

  it('L6 different keys: two organizations scan at the same time, neither blocks the other', async () => {
    const [a, b] = [await insertOrg(), await insertOrg()];
    const hold = gate();
    let inside = 0;
    mockAwsClients({ resourceExplorer: explorer(async () => { inside++; await hold.opened; }) });
    mockCostStep();

    const runs = [service().discoverAllResources(a), service(FAST, pool2).discoverAllResources(b)];
    try {
      await waitFor(async () => inside === 2, 'both scans to be running at once');
      hold.open();
      await Promise.all(runs);
      expect((await jobs(a)).map((j) => j.status)).toEqual(['completed']);
      expect((await jobs(b)).map((j) => j.status)).toEqual(['completed']);
    } finally {
      hold.open();
      await Promise.allSettled(runs);
    }
  }, 30_000);

  it('L11b two overlapping cron ticks in one process (node-cron noOverlap is false): each organization scanned once; the next cycle within 5 h skips', async () => {
    const orgs = [await insertOrg(), await insertOrg(), await insertOrg()];
    const hold = gate();
    mockAwsClients({ resourceExplorer: explorer(async () => { await hold.opened; }) });
    mockCostStep();
    const job = new ResourceDiscoveryJob(pool);
    (job as any).leaseTiming = FAST;
    (job as any).service.leaseTiming = FAST;
    const list = orgs.map((id) => ({ id, name: id }));

    const ticks = [job.scanOrganizations(list), job.scanOrganizations(list)];
    try {
      await pause(500);
      hold.open();
      const [x, y] = await Promise.all(ticks);

      expect(x.scanned + y.scanned).toBe(3);
      expect(x.locked + y.locked).toBe(3);
      for (const id of orgs) expect(await jobs(id)).toHaveLength(1);
      const again = await job.scanOrganizations(list);
      expect(again).toMatchObject({ scanned: 0, locked: 3 });
    } finally {
      hold.open();
      await Promise.allSettled(ticks);
    }
  }, 60_000);

  it('cron skips (locked) an organization whose scan lease is held, and releases its job lease WITHOUT completing it', async () => {
    const orgId = await insertOrg();
    mockAwsClients();
    mockCostStep();
    const other = await otherWorker(orgId);
    const job = new ResourceDiscoveryJob(pool);
    (job as any).leaseTiming = FAST;
    (job as any).service.leaseTiming = FAST;

    try {
      const summary = await job.scanOrganizations([{ id: orgId, name: orgId }]);

      expect(summary).toMatchObject({ scanned: 0, locked: 1 });
      expect(await jobs(orgId)).toEqual([]);
      const jobLease = (await pool.query(`SELECT released_at, last_completed_at FROM job_leases WHERE organization_id = $1`, [orgId])).rows[0];
      expect(jobLease.released_at).toBeInstanceOf(Date);
      expect(jobLease.last_completed_at).toBeNull();
    } finally {
      await release(other);
    }
  });
});

// ---------------------------------------------------------------------------
describe('§4.6 manual Sync joins a running scan', () => {
  it('waits for the running scan and answers with THAT job\'s totals; no second job row', async () => {
    const orgId = await insertOrg();
    const hold = gate();
    const entered = gate();
    mockAwsClients({ resourceExplorer: explorer(async () => { entered.open(); await hold.opened; }) });
    mockCostStep();

    const running = service().discoverAllResources(orgId);
    let joined: Promise<unknown> | undefined;
    try {
      await entered.opened;
      joined = service(FAST, pool2).discoverOrJoin(orgId);
      await pause(300);
      hold.open();
      const [first, second] = await Promise.all([running, joined]);

      expect(second).toEqual({ ...(first as object), warnings: [] });
      expect(await jobs(orgId)).toHaveLength(1);
    } finally {
      // Never leave the gated scan (and its heartbeat) running into the next test.
      hold.open();
      await Promise.allSettled([running, joined]);
    }
  }, 30_000);

  it('a lease held with no job (a cost Analyze) is waited out, then the Sync runs its own scan', async () => {
    const orgId = await insertOrg();
    mockAwsClients();
    mockCostStep();
    const other = await otherWorker(orgId);
    let released: Promise<void> | undefined;
    const timer = setTimeout(() => (released = release(other)), 300);
    try {
      const result = await service().discoverOrJoin(orgId);

      expect((await jobs(orgId)).map((j) => j.id)).toEqual([result.job_id]);
    } finally {
      clearTimeout(timer);
      await (released ?? release(other));
    }
  }, 30_000);

  it('at the cap: ScanBusyError (answered 409 with the approved text), and nothing is written', async () => {
    const orgId = await insertOrg();
    mockAwsClients();
    mockCostStep();
    const other = await otherWorker(orgId);
    try {
      await expect(service({ ...FAST, capMs: 300 }).discoverOrJoin(orgId)).rejects.toBeInstanceOf(ScanBusyError);
      expect(await jobs(orgId)).toEqual([]);
    } finally {
      await release(other);
    }
  });

  it('the route answers a ScanBusyError with 409 and exactly the approved text (static: the one discover handler)', () => {
    const fs = jest.requireActual('fs') as typeof import('fs');
    const path = jest.requireActual('path') as typeof import('path');
    const text = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'services.routes.ts'), 'utf8');
    expect(text).toMatch(/const result = await discoveryService\.discoverOrJoin\(orgId\);/);
    expect(text).toMatch(/if \(isScanBusy\(err\)\) \{\s*res\.status\(409\)\.json\(\{ success: false, error: SCAN_BUSY_MESSAGE \}\);/);
  });
});

// ---------------------------------------------------------------------------
describe('§4.6 cost Analyze waits for the scan lease, then runs', () => {
  function request(orgId: string) {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const req = { user: { organizationId: orgId, userId: 'test-user' }, query: {}, params: {}, body: {} } as unknown as Request;
    return { req, res: { json, status } as unknown as Response, json, status };
  }

  it('waits while another scan holds the lease, then runs with its own lease (fenced) and releases it', async () => {
    const orgId = await insertOrg();
    const other = await otherWorker(orgId);
    let releasedAt = 0;
    let released: Promise<void> | undefined;
    const timer = setTimeout(() => (released = release(other).then(() => void (releasedAt = Date.now()))), 400);
    let analyzedAt = 0;
    jest.spyOn(costOptimizationService, 'analyzeAllResources').mockImplementation(async () => {
      analyzedAt = Date.now();
      return { observations: [], riRecommendations: [], riSucceeded: true, homeRegion: HOME };
    });
    const reconcile = jest.spyOn(CostRecommendationsRepository.prototype, 'reconcileActiveRecommendations');
    const controller = new CostRecommendationsController();
    (controller as any).leaseTiming = FAST;
    const { req, res, json } = request(orgId);
    try {
      await controller.analyze(req, res);

      expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
      expect(releasedAt).toBeGreaterThan(0);
      expect(analyzedAt).toBeGreaterThanOrEqual(releasedAt);
      const lease = reconcile.mock.calls[0][3];
      expect(lease).toMatchObject({ key: { organizationId: orgId, awsAccountId: ACCOUNT, scanKind: 'discovery' } });
      expect((await leaseRow(orgId)).released_at).toBeInstanceOf(Date);
    } finally {
      clearTimeout(timer);
      await (released ?? release(other));
    }
  }, 30_000);

  it('at the cap: 409 with exactly the approved text; the analysis never ran', async () => {
    const orgId = await insertOrg();
    const other = await otherWorker(orgId);
    const analyze = jest.spyOn(costOptimizationService, 'analyzeAllResources');
    const controller = new CostRecommendationsController();
    (controller as any).leaseTiming = { ...FAST, capMs: 300 };
    const { req, res, json, status } = request(orgId);
    try {
      await controller.analyze(req, res);
    } finally {
      await release(other);
    }

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({ success: false, error: SCAN_BUSY_MESSAGE });
    expect(analyze).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe('§4.2 heartbeat and checkpoints', () => {
  it('a healthy scan longer than its TTL keeps its lease: the heartbeat starts at acquisition and renews', async () => {
    const orgId = await insertOrg();
    await seedInstance(orgId, 0);
    mockAwsClients({ resourceExplorer: explorer(async () => { await pause(2_500); }) });
    mockCostStep();

    await service({ ...FAST, ttlSeconds: 1 }).discoverAllResources(orgId);

    expect((await jobs(orgId)).map((j) => j.status)).toEqual(['completed']);
    expect(await missingCount(orgId)).toBe(1); // the reconcile after the long search committed
  }, 30_000);

  it('a lease taken over mid-scan (after real expiry): the scan writes nothing after the loss and records the approved text + scan_lease_lost', async () => {
    const orgId = await insertOrg();
    let takeover: HeldLease | undefined;
    const ec2 = fake({
      DescribeInstancesCommand: async () => {
        // The scan's lease expires (no renewals) and another worker takes it over.
        await untilExpired(orgId);
        takeover = await otherWorker(orgId);
        return { Reservations: [{ Instances: [{ InstanceId: 'i-1234567890abcdef0', State: { Name: 'running' } }] }] };
      },
      DescribeVolumesCommand: () => ({ Volumes: [] }),
      DescribeSecurityGroupsCommand: () => ({ SecurityGroups: [] }),
    });
    const { s3 } = mockAwsClients({ ec2 });
    mockCostStep();

    await expect(service({ ...FAST, ttlSeconds: 1, heartbeat: { intervalMs: 3_600_000 } }).discoverAllResources(orgId)).rejects.toBeInstanceOf(LeaseLostError);

    expect((await pool.query(`SELECT 1 FROM aws_resources WHERE organization_id = $1`, [orgId])).rows).toEqual([]);
    expect(ec2.calls).not.toContain('DescribeVolumesCommand');
    expect(s3.calls).toEqual([]);
    const [job] = await jobs(orgId);
    expect(job).toMatchObject({ status: 'failed', error_message: DISCOVERY_LEASE_LOST_MESSAGE, warnings: [DISCOVERY_WARNING_SCAN_LEASE_LOST] });
    // The new holder's lease is untouched.
    const row = await leaseRow(orgId);
    expect(row).toMatchObject({ holder: 'other-worker', released_at: null });
    expect(String(row.fencing_token)).toBe(takeover!.fencingToken);
    await release(takeover!);
  }, 30_000);

  it('a lease the heartbeat finds lost (maximum age reached) stops the scan at its next checkpoint: no further AWS call, nothing written', async () => {
    const orgId = await insertOrg();
    const ec2 = fake({
      DescribeInstancesCommand: async () => {
        await pause(2_000); // the heartbeat's renewal is refused for age meanwhile
        return { Reservations: [] };
      },
      DescribeVolumesCommand: () => ({ Volumes: [] }),
      DescribeSecurityGroupsCommand: () => ({ SecurityGroups: [] }),
    });
    const { rds, s3 } = mockAwsClients({ ec2 });
    mockCostStep();

    await expect(
      service({ ...FAST, heartbeat: { intervalMs: 100, maxAgeSeconds: 1 } }).discoverAllResources(orgId)
    ).rejects.toMatchObject({ reason: 'max_age' });

    expect(ec2.calls).not.toContain('DescribeVolumesCommand');
    expect(rds.calls).toEqual([]);
    expect(s3.calls).toEqual([]);
    expect((await jobs(orgId))[0]).toMatchObject({ status: 'failed', error_message: DISCOVERY_LEASE_LOST_MESSAGE });
  }, 30_000);

  it('F2 a lease lost before the EC2 step stops the scan there: no listing call at all, and no errors entry (nor the job row) carries SCAN_LEASE_LOST', async () => {
    const orgId = await insertOrg();
    const search = explorer();
    const { ec2, rds, s3 } = mockAwsClients({ resourceExplorer: search });
    mockCostStep();
    const scan = service({ ...FAST, heartbeat: { intervalMs: 100, maxAgeSeconds: 1 } });
    // After its job is linked and before the EC2 step, the heartbeat finds the lease at its
    // maximum age (the database row is still held, so the link succeeds): the EC2 step's
    // checkpoint is the first to see the loss, inside the step's try.
    const recover = (AWSResourceDiscoveryService.prototype as any).recoverInterruptedJobs;
    jest.spyOn(scan as any, 'recoverInterruptedJobs').mockImplementation(async function (this: unknown, ...args: unknown[]) {
      const recovered = await recover.apply(this, args);
      const session = args[1] as LeaseSession;
      await waitFor(async () => session.lost, 'the heartbeat to refuse the lease for age');
      return recovered;
    });

    const outcome: unknown = await scan.discoverAllResources(orgId).catch((error: unknown) => error);

    // A lost lease is never a step failure. Every step's catch logs exactly the message
    // it adds to `errors` ("EC2: SCAN_LEASE_LOST: ..."), so a step that swallowed the
    // loss shows in the log even though the scan then stops anyway (the Resource
    // Explorer checkpoint, outside any step, would rethrow it): no such entry, here or
    // in a returned result.
    const errors: string[] = (outcome as { errors?: string[] } | undefined)?.errors ?? [];
    expect(errors.filter((entry) => entry.includes('SCAN_LEASE_LOST'))).toEqual([]);
    const logged = (console.error as jest.Mock).mock.calls.map((args) => args.map(String).join(' '));
    expect(logged.filter((line) => line.includes('SCAN_LEASE_LOST'))).toEqual([]);
    expect(outcome).toBeInstanceOf(LeaseLostError);
    expect(outcome).toMatchObject({ reason: 'max_age' });
    expect(ec2.calls).toEqual([]);
    expect(rds.calls).toEqual([]);
    expect(s3.calls).toEqual([]);
    expect((search as any).send).not.toHaveBeenCalled();
    const [job] = await jobs(orgId);
    expect(job).toMatchObject({ status: 'failed', error_message: DISCOVERY_LEASE_LOST_MESSAGE, warnings: [DISCOVERY_WARNING_SCAN_LEASE_LOST] });
    expect(job.error_message).not.toContain('SCAN_LEASE_LOST');
  }, 30_000);
});

// ---------------------------------------------------------------------------
describe('AC-1 race-safe recovery', () => {
  it('R1 a live, heartbeating worker\'s backdated running job is never touched: discovery and cron both refuse', async () => {
    const orgId = await insertOrg();
    const lease = await otherWorker(orgId, 2);
    const heartbeat = new LeaseHeartbeat(pool2, lease, { intervalMs: 300, ttlSeconds: 2 }).start();
    const jobId = await insertJob(orgId, 'running', 3 * 24 * 60);
    mockAwsClients();
    mockCostStep();
    try {
      await pause(2_500); // longer than the TTL: only the heartbeat keeps it
      await expect(service().discoverAllResources(orgId)).rejects.toBeInstanceOf(ScanAlreadyRunningError);
      const job = new ResourceDiscoveryJob(pool);
      (job as any).leaseTiming = FAST;
      (job as any).service.leaseTiming = FAST;
      expect(await job.scanOrganizations([{ id: orgId, name: orgId }])).toMatchObject({ locked: 1, scanned: 0 });
      expect(await jobs(orgId)).toEqual([{ id: jobId, status: 'running', error_message: null, warnings: null, completed: false }]);
    } finally {
      await heartbeat.stopAndRelease();
    }
  }, 30_000);

  it('R2/R3 after real expiry: the next scan takes a greater token and closes the old job with the approved text; the stale worker\'s writes fail the fence; another organization is untouched', async () => {
    const orgId = await insertOrg();
    const otherOrg = await insertOrg();
    const stale = await otherWorker(orgId, 1);
    const oldJob = await insertJob(orgId, 'running', 3 * 24 * 60);
    const pendingJob = await insertJob(orgId, 'pending', 60);
    const otherOrgJob = await insertJob(otherOrg, 'running', 3 * 24 * 60);
    await untilExpired(orgId);
    mockAwsClients();
    mockCostStep();

    const result = await service().discoverAllResources(orgId);

    const lease = await leaseRow(orgId);
    expect(BigInt(lease.fencing_token) > BigInt(stale.fencingToken)).toBe(true);
    const byId = Object.fromEntries((await jobs(orgId)).map((j) => [j.id, j]));
    for (const id of [oldJob, pendingJob]) {
      expect(byId[id]).toMatchObject({ status: 'failed', error_message: DISCOVERY_INTERRUPTED_MESSAGE, completed: true });
    }
    expect(byId[result.job_id]).toMatchObject({ status: 'completed', error_message: null });
    expect((await jobs(otherOrg))[0]).toMatchObject({ id: otherOrgJob, status: 'running', error_message: null });

    // R3: the stale worker resumes; its fenced writes fail and change nothing.
    const client: PoolClient = await pool2.connect();
    try {
      await client.query("SELECT set_config('app.current_organization_id', $1, false)", [orgId]);
      const session = new LeaseSession(pool2, stale, { heartbeat: { intervalMs: 3_600_000 } });
      await expect(
        session.fenced(client, () => client.query(`UPDATE resource_discovery_jobs SET status = 'completed' WHERE id = $1`, [oldJob]))
      ).rejects.toBeInstanceOf(LeaseLostError);
      await session.end();
    } finally {
      client.release();
    }
    expect((await jobs(orgId)).find((j) => j.id === oldJob)).toMatchObject({ status: 'failed' });
  }, 30_000);

  it.each(['COMMIT', 'ROLLBACK'])('R4 recovery does not race the takeover: the next scan waits on the row lock until the old worker\'s fenced transaction ends (%s)', async (ending) => {
    const orgId = await insertOrg();
    const stale = await otherWorker(orgId, 1);
    const oldJob = await insertJob(orgId, 'running', 60);
    const client = await pool2.connect();
    // If the test fails while the old worker's transaction is open, the server may end
    // that session (idle-in-transaction limit); that is expected, not a test error.
    client.on('error', () => undefined);
    const session = new LeaseSession(pool2, stale, { heartbeat: { intervalMs: 3_600_000 } });
    const hold = gate();
    const entered = gate();
    let transaction: Promise<unknown> = Promise.resolve();
    let next: Promise<unknown> | undefined;
    try {
      await client.query("SELECT set_config('app.current_organization_id', $1, false)", [orgId]);
      transaction = session
        .fenced(client, async () => {
          await client.query(`UPDATE resource_discovery_jobs SET error_message = 'old worker wrote this' WHERE id = $1`, [oldJob]);
          entered.open();
          await hold.opened;
          if (ending === 'ROLLBACK') throw new Error('the old worker gives up');
        })
        .catch((error: unknown) => error);
      await entered.opened;
      await untilExpired(orgId);
      mockAwsClients();
      mockCostStep();

      next = service().discoverAllResources(orgId);
      next.catch(() => undefined);
      await waitFor(
        async () =>
          (await pool.query(`SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%INSERT INTO aws_scan_leases%'`)).rows.length > 0,
        'the next scan to wait on the lease row lock',
        8_000 // under the old worker's idle-in-transaction limit (10 s)
      );
      expect((await jobs(orgId))[0]).toMatchObject({ id: oldJob, status: 'running' });
      hold.open();
      await transaction;
      await next;

      const recovered = (await jobs(orgId)).find((j) => j.id === oldJob)!;
      expect(recovered).toMatchObject({ status: 'failed', error_message: DISCOVERY_INTERRUPTED_MESSAGE });
      await expect(session.fenced(client, async () => undefined)).rejects.toBeInstanceOf(LeaseLostError);
    } finally {
      // Always end the old worker's transaction and give its connection back, so a
      // failed assertion leaves no lock and no checked-out connection behind.
      hold.open();
      await transaction;
      if (next) await next.catch(() => undefined);
      await session.end();
      client.release(true);
    }
  }, 30_000);

  it('R5 a stale running row older than the maximum lease age, with no lease row at all: reads never close it; only a scan that acquires the lease does', async () => {
    const orgId = await insertOrg();
    const oldJob = await insertJob(orgId, 'running', 2 * 60);
    expect(await leaseRow(orgId)).toBeUndefined();
    await pool.query("SELECT set_config('app.current_organization_id', $1, false)", [orgId]);
    await new AWSResourcesRepository(pool).getDiscoveryJobs(orgId);
    expect((await jobs(orgId))[0]).toMatchObject({ id: oldJob, status: 'running' });
    mockAwsClients();
    mockCostStep();

    await service().discoverAllResources(orgId);

    expect((await jobs(orgId)).find((j) => j.id === oldJob)).toMatchObject({ status: 'failed', error_message: DISCOVERY_INTERRUPTED_MESSAGE });
  }, 30_000);
});
