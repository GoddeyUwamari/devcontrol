/**
 * Multi-region plan M5b (m5-plan.md §13) inside a discovery scan: the home
 * region's scan status, written once after every home-region listing has
 * finished, in one fenced write (F18).
 *
 *  - each status from the scan's real source outcomes (incl. mixed outcomes and
 *    partial with each truncation code); the security-group scan, S3 and
 *    CloudFront never count and never write a row (Q-B);
 *  - Q-E: a Resource Explorer search whose results failed to store makes the
 *    status failed, and nothing else: the job row (no warning, M4c's exact
 *    text) and the reconcile calls are pinned to fixed values, and the flag's
 *    references are counted;
 *  - fail-soft: no home row, or an ordinary failed write, is logged once and the
 *    scan is unchanged; a lost lease or an ambiguous account still stops it, and
 *    a scan that stops before its outcomes are known writes no status.
 *
 * Real Postgres for every lease, job, inventory and region row; AWS clients are
 * fakes (no AWS call is made). Fixture: a real DescribeRegions response, region
 * fields only. Placeholders only.
 */
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { ResourceExplorer2Client } from '@aws-sdk/client-resource-explorer-2';
import { AWSResourceDiscoveryService } from '../awsResourceDiscovery';
import { AWSClientFactory } from '../aws-client-factory.service';
import costOptimizationService from '../cost-optimization.service';
import { HeldLease, LeaseHeartbeat, LeaseLostError, acquireScanLease, isLeaseLost } from '../scan-lease';
import * as regionScanStatus from '../region-scan-status';
import { DISCOVERY_LEASE_LOST_MESSAGE, LeaseTiming, SCAN_KIND_DISCOVERY, onTaggedConnection } from '../scan-session';
import { AwsCallTimeoutError } from '../../utils/awsCallPolicy';
import { DISCOVERY_WARNING_LISTING_TRUNCATED, DISCOVERY_WARNING_TRUNCATED_INDEX } from '../discovery-warnings';
import * as foundation from '../../repositories/multi-region-foundation.repository';
import { RE_RECONCILED_TYPES } from '../resourceExplorer.service';
import { AwsAccountAmbiguousError, isAwsAccountAmbiguous } from '../../repositories/aws-accounts.repository';
import { PLACEHOLDER_ACCOUNT_ROW, connectPlaceholderAccount, removePlaceholderAccounts, stubScanSource } from './helpers/scan-source';

const dbConfig = () => ({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'platform_portal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});
const pool = new Pool(dbConfig());
const pool2 = new Pool(dbConfig());
const ACCOUNT = PLACEHOLDER_ACCOUNT_ROW.account_id!;
const HOME = 'us-east-1';
const BUCKET_REGION = 'eu-west-1';
const VPC_ARN = `arn:aws:ec2:${HOME}:${ACCOUNT}:vpc/vpc-00000001`;
const FAST: LeaseTiming = { heartbeat: { intervalMs: 200 }, pollMs: 50, acquireLockTimeoutMs: 15_000 };
const createdOrgIds: string[] = [];

const FIXTURE: { Regions: Array<{ RegionName: string; OptInStatus: string }> } = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures/describe-regions.json'), 'utf8')
);
const realResponse = () => ({ Regions: FIXTURE.Regions.map((r) => ({ ...r })) });

async function insertOrg(tier: 'free' | 'starter' = 'free'): Promise<string> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
    [`M5b Region Org ${suffix}`, `m5b-region-org-${suffix}`, `M5b Region Org ${suffix}`, tier]
  );
  createdOrgIds.push(rows[0].id);
  await connectPlaceholderAccount(pool, rows[0].id);
  return rows[0].id;
}

function service(timing: LeaseTiming = FAST): AWSResourceDiscoveryService {
  const s = new AWSResourceDiscoveryService(pool);
  (s as any).leaseTiming = timing;
  return s;
}

type Answer = (input: any) => any;
const throwing = (error: Error): Answer => () => {
  throw error;
};
const denied = () => Object.assign(new Error(`User: arn:aws:sts::${ACCOUNT}:assumed-role/devcontrol-readonly/s is not authorized`), { name: 'UnauthorizedOperation' });

/** A fake client answering by command name; anything unlisted fails at once. */
function fake(answers: Record<string, Answer>) {
  const calls: Array<{ name: string; input: any }> = [];
  return {
    calls,
    send: jest.fn(async (command: { constructor: { name: string }; input?: any }) => {
      calls.push({ name: command.constructor.name, input: command.input });
      const answer = answers[command.constructor.name];
      if (!answer) throw Object.assign(new Error(`Unexpected ${command.constructor.name}`), { name: 'Unexpected' });
      return answer(command.input ?? {});
    }),
  };
}

function explorer(page: () => any): ResourceExplorer2Client {
  const client = new ResourceExplorer2Client({ region: HOME });
  (client as any).send = jest.fn(async () => page());
  return client;
}

interface Answers {
  ec2?: Record<string, Answer>;
  rds?: Record<string, Answer>;
  s3?: Record<string, Answer>;
  lambda?: Record<string, Answer>;
  elb?: Record<string, Answer>;
  cloudFront?: Record<string, Answer>;
  resourceExplorer?: () => any;
}

/** Every listing answers empty and complete unless `answers` says otherwise. */
function mockAwsClients(answers: Answers = {}, home = HOME) {
  stubScanSource();
  const ec2 = fake({
    DescribeRegionsCommand: () => realResponse(),
    DescribeInstancesCommand: () => ({ Reservations: [] }),
    DescribeVolumesCommand: () => ({ Volumes: [] }),
    DescribeSecurityGroupsCommand: () => ({ SecurityGroups: [] }),
    ...answers.ec2,
  });
  const rds = fake({ DescribeDBInstancesCommand: () => ({ DBInstances: [] }), ...answers.rds });
  const s3 = fake({ ListBucketsCommand: () => ({ Buckets: [] }), ...answers.s3 });
  const lambda = fake({ ListFunctionsCommand: () => ({ Functions: [] }), ...answers.lambda });
  const elb = fake({ DescribeLoadBalancersCommand: () => ({ LoadBalancers: [] }), ...answers.elb });
  const cloudFront = fake({ ListDistributionsCommand: () => ({ DistributionList: { Items: [] } }), ...answers.cloudFront });
  const iam = fake({ ListUsersCommand: () => ({ Users: [] }) });
  jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue({
    enabled: true, region: home, accountId: ACCOUNT,
    costExplorer: {}, ec2, rds, s3, s3Control: {}, cloudWatch: {}, lambda, ecs: {}, elb, eks: {}, dynamodb: {},
    cloudFront, apiGateway: {}, elastiCache: {}, sqs: {}, sns: {}, iam, backup: {},
    resourceExplorer: explorer(answers.resourceExplorer ?? (() => ({ Resources: [], Count: { TotalResources: 0, Complete: true } }))),
    getDynamoDBClientForRegion: () => ({}), getApplicationAutoScalingClientForRegion: () => ({}), getCloudWatchClientForRegion: () => ({}),
    getS3ClientForRegion: () => s3,
  } as any);
  jest.spyOn(costOptimizationService, 'analyzeAllResources').mockResolvedValue({ observations: [], riRecommendations: [], riSucceeded: false, homeRegion: home });
  return { ec2, rds, s3, lambda, elb, cloudFront, iam };
}

async function regionRows(orgId: string): Promise<Record<string, any>> {
  const { rows } = await pool.query(`SELECT * FROM aws_account_regions WHERE organization_id = $1 ORDER BY region`, [orgId]);
  return Object.fromEntries(rows.map((row) => [row.region, row]));
}

const SCAN_COLUMNS = [
  'last_scan_started_at', 'last_scan_finished_at', 'last_success_at', 'last_scan_status', 'last_error_code', 'last_error_message', 'consecutive_failures',
];
const UNSCANNED = {
  last_scan_started_at: null, last_scan_finished_at: null, last_success_at: null, last_scan_status: 'never_scanned',
  last_error_code: null, last_error_message: null, consecutive_failures: 0,
};
const scanColumns = (row: any) => Object.fromEntries(SCAN_COLUMNS.map((c) => [c, row?.[c]]));

/** Everything a scan leaves behind that the status write must not change, without ids and times. */
async function scanFootprint(orgId: string, result: any) {
  const job = (
    await pool.query(
      `SELECT status, error_message, to_jsonb(j) -> 'warnings' AS warnings, resources_discovered, resources_updated, resources_deleted,
              compliance_scan_completed, cost_analysis_completed, resource_types, regions, completed_at IS NOT NULL AS completed
         FROM resource_discovery_jobs j WHERE organization_id = $1`,
      [orgId]
    )
  ).rows;
  const resources = (
    await pool.query(`SELECT resource_arn, resource_type, region, status, missing_scan_count FROM aws_resources WHERE organization_id = $1 ORDER BY resource_arn`, [orgId])
  ).rows;
  const lease = (await pool.query(`SELECT scan_kind, aws_account_id, released_at IS NOT NULL AS released FROM aws_scan_leases WHERE organization_id = $1`, [orgId]))
    .rows;
  return { job, resources, lease, result: { ...result, job_id: undefined } };
}

const warnLines = () => (console.warn as jest.Mock).mock.calls.map((args) => args.map(String).join(' '));
const statusLines = () => warnLines().filter((line) => line.includes('region_status_'));

function quietConsole() {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
}

/** A second scan in the same test: fresh mocks. */
function resetMocks() {
  jest.restoreAllMocks();
  quietConsole();
}

beforeEach(quietConsole);
afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    for (const table of [
      'soc2_evidence_observations', 'soc2_control_evaluations', 'account_security_findings', 'cost_recommendations', 'cost_analysis_runs',
      'framework_evaluation_runs', 'aws_resources', 'resource_discovery_jobs', 'aws_scan_leases', 'job_leases', 'aws_account_regions',
    ]) {
      await pool.query(`DELETE FROM ${table} WHERE organization_id = ANY($1)`, [createdOrgIds]).catch(() => undefined);
    }
    await removePlaceholderAccounts(pool, createdOrgIds);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
  await pool2.end();
}, 30_000);

/** Status cases as [label, status, code, answers], so a test's name shows the expected status. */
function withStatusFirst(cases: Array<[string, Answers, string, string | null]>): Array<[string, string, string | null, Answers]> {
  return cases.map(([label, answers, status, errorCode]) => [label, status, errorCode, answers]);
}

// ---------------------------------------------------------------------------
describe('a scan records its home region\'s status from its listings', () => {
  it('every listing complete: ok, last_success_at set, started at the job\'s start; no other region is touched; one write per scan', async () => {
    const orgId = await insertOrg();
    mockAwsClients();
    const writeSpy = jest.spyOn(foundation, 'recordHomeRegionScanStatus');
    const result = await service().discoverAllResources(orgId);

    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy.mock.calls[0][2]).toEqual({ region: HOME, jobId: result.job_id, result: { status: 'ok', errorCode: null } });
    expect(writeSpy.mock.calls[0][1].key).toMatchObject({ table: 'aws_scan_leases', organizationId: orgId, awsAccountId: ACCOUNT });

    const rows = await regionRows(orgId);
    const job = (await pool.query(`SELECT started_at, completed_at FROM resource_discovery_jobs WHERE id = $1`, [result.job_id])).rows[0];
    expect(rows[HOME]).toMatchObject({ last_scan_status: 'ok', last_error_code: null, consecutive_failures: 0 });
    expect(rows[HOME].last_scan_started_at).toEqual(job.started_at);
    expect(rows[HOME].last_success_at).toEqual(rows[HOME].last_scan_finished_at);
    expect(rows[HOME].last_scan_finished_at.getTime()).toBeLessThanOrEqual(job.completed_at.getTime());
    for (const [region, row] of Object.entries(rows)) if (region !== HOME) expect(scanColumns(row)).toEqual(UNSCANNED);
    expect(rows.global).toBeUndefined();
    expect(statusLines()).toEqual([]);
  });

  it.each(
    withStatusFirst([
    ['EC2 denied', { ec2: { DescribeInstancesCommand: throwing(denied()) } }, 'denied', null],
    ['RDS timed out', { rds: { DescribeDBInstancesCommand: throwing(new AwsCallTimeoutError(15_000)) } }, 'timed_out', null],
    ['RDS failed', { rds: { DescribeDBInstancesCommand: throwing(Object.assign(new Error('boom'), { name: 'InternalError' })) } }, 'failed', null],
    ['the Resource Explorer search failed', { resourceExplorer: () => { throw Object.assign(new Error('no index'), { name: 'ResourceNotFoundException' }); } }, 'failed', null],
    ['the Resource Explorer search denied (recorded failed, Q-F)', { resourceExplorer: () => { throw denied(); } }, 'failed', null],
    ['the Resource Explorer search cut off', { resourceExplorer: () => ({ Resources: [], Count: { TotalResources: 1000, Complete: false } }) }, 'partial', DISCOVERY_WARNING_TRUNCATED_INDEX],
    ['the EBS listing at its page limit', { ec2: { DescribeVolumesCommand: () => ({ Volumes: [], NextToken: 'more' }) } }, 'partial', DISCOVERY_WARNING_LISTING_TRUNCATED],
    [
      'both cut off',
      { ec2: { DescribeVolumesCommand: () => ({ Volumes: [], NextToken: 'more' }) }, resourceExplorer: () => ({ Resources: [], Count: { TotalResources: 1000, Complete: false } }) },
      'partial',
      DISCOVERY_WARNING_TRUNCATED_INDEX,
    ],
    [
      'mixed: EC2 denied, RDS failed, EBS cut off, the rest complete',
      {
        ec2: { DescribeInstancesCommand: throwing(denied()), DescribeVolumesCommand: () => ({ Volumes: [], NextToken: 'more' }) },
        rds: { DescribeDBInstancesCommand: throwing(new Error('boom')) },
      },
      'denied',
      null,
    ],
    [
      'mixed: RDS timed out, EC2 failed, the rest complete',
      { ec2: { DescribeInstancesCommand: throwing(new Error('boom')) }, rds: { DescribeDBInstancesCommand: throwing(new AwsCallTimeoutError(15_000)) } },
      'timed_out',
      null,
    ],
    ['mixed: RDS failed, the Resource Explorer search cut off', { rds: { DescribeDBInstancesCommand: throwing(new Error('boom')) }, resourceExplorer: () => ({ Resources: [], Count: { TotalResources: 1000, Complete: false } }) }, 'failed', null],
    ])
  )('%s -> %s %s', async (_label, status, errorCode, answers) => {
    const orgId = await insertOrg();
    mockAwsClients(answers);
    await service().discoverAllResources(orgId);
    const home = (await regionRows(orgId))[HOME];
    expect(home).toMatchObject({ last_scan_status: status, last_error_code: errorCode, last_success_at: null });
    expect(home.consecutive_failures).toBe(status === 'partial' ? 0 : 1);
    expect(statusLines()).toEqual([]);
  }, 30_000);

  it('a failure after an ok scan keeps the ok scan\'s last_success_at; partial keeps it too; the next ok moves it', async () => {
    const orgId = await insertOrg();
    mockAwsClients();
    await service().discoverAllResources(orgId);
    const okAt = (await regionRows(orgId))[HOME].last_success_at;
    expect(okAt).toBeInstanceOf(Date);

    resetMocks();
    mockAwsClients({ ec2: { DescribeInstancesCommand: throwing(denied()) } });
    await service().discoverAllResources(orgId);
    expect((await regionRows(orgId))[HOME]).toMatchObject({ last_scan_status: 'denied', last_success_at: okAt, consecutive_failures: 1 });

    resetMocks();
    mockAwsClients({ resourceExplorer: () => ({ Resources: [], Count: { TotalResources: 1000, Complete: false } }) });
    await service().discoverAllResources(orgId);
    expect((await regionRows(orgId))[HOME]).toMatchObject({ last_scan_status: 'partial', last_success_at: okAt, consecutive_failures: 1 });

    resetMocks();
    mockAwsClients();
    await service().discoverAllResources(orgId);
    const home = (await regionRows(orgId))[HOME];
    expect(home).toMatchObject({ last_scan_status: 'ok', consecutive_failures: 0 });
    expect(home.last_success_at.getTime()).toBeGreaterThan(okAt.getTime());
  }, 30_000);

  it('a home region other than us-east-1 (eu-west-1): the status lands on that row; us-east-1 stays unscanned', async () => {
    const orgId = await insertOrg();
    await pool.query(`UPDATE aws_accounts SET region = $2 WHERE org_id = $1`, [orgId, BUCKET_REGION]);
    mockAwsClients({}, BUCKET_REGION);
    const writeSpy = jest.spyOn(foundation, 'recordHomeRegionScanStatus');
    const result = await service().discoverAllResources(orgId);

    expect(writeSpy.mock.calls.map((call) => call[2].region)).toEqual([BUCKET_REGION]);
    const job = (await pool.query(`SELECT status, regions FROM resource_discovery_jobs WHERE id = $1`, [result.job_id])).rows[0];
    expect(job).toEqual({ status: 'completed', regions: [BUCKET_REGION] });
    const rows = await regionRows(orgId);
    expect(rows[BUCKET_REGION]).toMatchObject({ last_scan_status: 'ok', last_error_code: null });
    expect(rows[BUCKET_REGION].last_success_at).toBeInstanceOf(Date);
    expect(scanColumns(rows[HOME])).toEqual(UNSCANNED);
    for (const [region, row] of Object.entries(rows)) if (region !== BUCKET_REGION) expect(scanColumns(row)).toEqual(UNSCANNED);
  });

  it('the list columns are not changed by the status write', async () => {
    const orgId = await insertOrg();
    mockAwsClients();
    let listed: Record<string, any> = {};
    const realWrite = foundation.recordHomeRegionScanStatus;
    jest.spyOn(foundation, 'recordHomeRegionScanStatus').mockImplementation(async (client, lease, scan) => {
      listed = await regionRows(orgId);
      return realWrite(client, lease, scan);
    });
    await service().discoverAllResources(orgId);
    const after = await regionRows(orgId);
    const withoutScan = (row: any) => {
      const rest = { ...row };
      for (const c of [...SCAN_COLUMNS, 'updated_at']) delete rest[c];
      return rest;
    };
    expect(Object.keys(after)).toEqual(Object.keys(listed));
    for (const region of Object.keys(after)) expect(withoutScan(after[region])).toEqual(withoutScan(listed[region]));
    for (const region of Object.keys(after)) if (region !== HOME) expect(after[region]).toEqual(listed[region]);
  });
});

// ---------------------------------------------------------------------------
describe('what never counts and never writes a row (Q-B, S3, CloudFront)', () => {
  it('Q-B the security-group scan failing does not change the status: ok', async () => {
    const orgId = await insertOrg();
    mockAwsClients({ ec2: { DescribeSecurityGroupsCommand: throwing(denied()) } });
    await service().discoverAllResources(orgId);
    expect((await regionRows(orgId))[HOME]).toMatchObject({ last_scan_status: 'ok', last_error_code: null });
  });

  it('S3: a bucket in another region never marks that region scanned; a failed S3 listing does not change the home status', async () => {
    const orgId = await insertOrg();
    mockAwsClients({
      s3: {
        ListBucketsCommand: () => ({ Buckets: [{ Name: 'placeholder-bucket', CreationDate: new Date('2026-01-01T00:00:00Z') }] }),
        GetBucketLocationCommand: () => ({ LocationConstraint: BUCKET_REGION }),
      },
    });
    await service().discoverAllResources(orgId);
    const bucket = (await pool.query(`SELECT region FROM aws_resources WHERE organization_id = $1 AND resource_type = 's3'`, [orgId])).rows;
    expect(bucket).toEqual([{ region: BUCKET_REGION }]);
    const rows = await regionRows(orgId);
    expect(scanColumns(rows[BUCKET_REGION])).toEqual(UNSCANNED);
    expect(rows[HOME].last_scan_status).toBe('ok');

    resetMocks();
    const other = await insertOrg();
    mockAwsClients({ s3: { ListBucketsCommand: throwing(denied()) } });
    await service().discoverAllResources(other);
    expect((await regionRows(other))[HOME]).toMatchObject({ last_scan_status: 'ok', last_error_code: null });
  });

  it('S3 and CloudFront with no region list: no row is created by anything', async () => {
    const orgId = await insertOrg('starter');
    mockAwsClients({
      ec2: { DescribeRegionsCommand: throwing(denied()) },
      s3: {
        ListBucketsCommand: () => ({ Buckets: [{ Name: 'placeholder-bucket', CreationDate: new Date('2026-01-01T00:00:00Z') }] }),
        GetBucketLocationCommand: () => ({ LocationConstraint: BUCKET_REGION }),
      },
    });
    await service().discoverAllResources(orgId);
    expect(await regionRows(orgId)).toEqual({});
  });

  it('CloudFront (global) failing does not change the home status, and no global row is attempted', async () => {
    const orgId = await insertOrg('starter');
    mockAwsClients({ cloudFront: { ListDistributionsCommand: throwing(denied()) } });
    const writeSpy = jest.spyOn(foundation, 'recordHomeRegionScanStatus');
    await service().discoverAllResources(orgId);
    expect(writeSpy.mock.calls.map((call) => call[2].region)).toEqual([HOME]);
    const rows = await regionRows(orgId);
    expect(rows[HOME]).toMatchObject({ last_scan_status: 'ok', last_error_code: null });
    expect(rows.global).toBeUndefined();
  });

  it('starter tier: Lambda or load-balancer denied counts (they are home-region listings)', async () => {
    const orgId = await insertOrg('starter');
    mockAwsClients({ lambda: { ListFunctionsCommand: throwing(denied()) } });
    await service().discoverAllResources(orgId);
    expect((await regionRows(orgId))[HOME].last_scan_status).toBe('denied');

    resetMocks();
    const other = await insertOrg('starter');
    mockAwsClients({ elb: { DescribeLoadBalancersCommand: throwing(new AwsCallTimeoutError(15_000)) } });
    await service().discoverAllResources(other);
    expect((await regionRows(other))[HOME].last_scan_status).toBe('timed_out');
  });
});

// ---------------------------------------------------------------------------
describe('Q-E: Resource Explorer results that failed to store', () => {
  /** M4c's own job text for this failure (awsResourceDiscovery.ts, the generic upsert's catch). */
  const M4C_STORE_FAILURE_MESSAGE = 'Resource Explorer inventory: could not store';

  it('the status is failed, and the job is exactly what M4c makes of it: no warning, the M4c text, the same reconciles', async () => {
    const orgId = await insertOrg('starter');
    mockAwsClients({
      resourceExplorer: () => ({
        Resources: [{ Arn: VPC_ARN, Region: HOME, Service: 'ec2', CfnResourceType: 'AWS::EC2::VPC', Properties: [] }],
        Count: { TotalResources: 1, Complete: true },
      }),
    });
    const svc = service();
    jest.spyOn(svc as any, 'upsertGenericResource').mockRejectedValue(Object.assign(new Error('could not store'), { name: 'StoreError' }));
    const reconciliation = (svc as any).reconciliation;
    const realReconcile = reconciliation.reconcile.bind(reconciliation);
    const reconcileCalls: unknown[] = [];
    jest.spyOn(reconciliation, 'reconcile').mockImplementation(async (...args: any[]) => {
      const [, , region, present, types] = args;
      reconcileCalls.push({ region, present: [...present].sort(), types: [...types].sort() });
      return realReconcile(...args);
    });

    const result = await svc.discoverAllResources(orgId);

    // Fixed values, not a comparison with a second run: a leak of the flag into the job shows here.
    expect(result.errors).toEqual([M4C_STORE_FAILURE_MESSAGE]);
    expect(result.warnings).toEqual([]);
    const job = (
      await pool.query(`SELECT status, error_message, to_jsonb(j) -> 'warnings' AS warnings FROM resource_discovery_jobs j WHERE id = $1`, [result.job_id])
    ).rows[0];
    expect(job).toEqual({ status: 'failed', error_message: M4C_STORE_FAILURE_MESSAGE, warnings: null }); // null = no warning (discoveryWarningsColumn)
    // The search was complete, so M4c still reconciles from it (presence incl. the VPC), then S3, CloudFront and EBS.
    expect(reconcileCalls).toEqual([
      { region: HOME, present: [VPC_ARN], types: [...RE_RECONCILED_TYPES].sort() },
      { region: null, present: [], types: ['s3'] },
      { region: null, present: [], types: ['cloudfront'] },
      { region: HOME, present: [], types: ['ebs'] },
    ]);
    expect((await regionRows(orgId))[HOME]).toMatchObject({ last_scan_status: 'failed', last_error_code: null, last_success_at: null });
  }, 30_000);

  it('static: the status-only Resource Explorer outcome is referenced exactly 3 times (declared, Q-E, the status write\'s input)', () => {
    const discovery = fs
      .readFileSync(path.join(__dirname, '..', 'awsResourceDiscovery.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const lines = discovery.split('\n').filter((line) => /\bresourceExplorerOutcome\b/.test(line)).map((line) => line.trim());
    expect(discovery.match(/\bresourceExplorerOutcome\b/g)).toHaveLength(3);
    expect(lines).toEqual([
      'const resourceExplorerOutcome: SourceOutcome = {',
      "resourceExplorerOutcome.status = 'failed';",
      'await this.recordHomeRegionStatus(client, scan, jobId, awsClients.region, organizationId, [...ownOutcomes, resourceExplorerOutcome]);',
    ]);
  });
});

// ---------------------------------------------------------------------------
describe('fail-soft: the status write never changes the scan', () => {
  async function baseline() {
    const orgId = await insertOrg();
    mockAwsClients();
    const result = await service().discoverAllResources(orgId);
    return scanFootprint(orgId, result);
  }

  it('Q-D no home row (the region list was never stored): nothing written, logged once, the scan identical', async () => {
    const expected = await baseline();
    resetMocks();
    const orgId = await insertOrg();
    mockAwsClients({ ec2: { DescribeRegionsCommand: throwing(denied()) } });
    const result = await service().discoverAllResources(orgId);

    expect(await scanFootprint(orgId, result)).toEqual(expected);
    expect(await regionRows(orgId)).toEqual({});
    const lines = statusLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('region_status_not_recorded');
    expect(lines[0]).not.toContain('arn:');
    expect(lines[0]).not.toContain(ACCOUNT);
  });

  it('an ordinary failed write: logged once (fixed text, no ARN, account id or database text), nothing written, the scan identical', async () => {
    const expected = await baseline();
    resetMocks();
    const orgId = await insertOrg();
    mockAwsClients();
    // The real write, made to fail inside its fenced transaction after the fence has
    // passed: a code the column's CHECK refuses. No lease is involved.
    const realWrite = foundation.recordHomeRegionScanStatus;
    const write = jest.spyOn(foundation, 'recordHomeRegionScanStatus').mockImplementation((client, lease, scan) =>
      realWrite(client, lease, { ...scan, result: { status: 'ok', errorCode: `not a code arn:aws:iam::${ACCOUNT}:root` } })
    );
    const result = await service().discoverAllResources(orgId);

    expect(write).toHaveBeenCalledTimes(1);
    expect(await scanFootprint(orgId, result)).toEqual(expected);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(scanColumns((await regionRows(orgId))[HOME])).toEqual(UNSCANNED);
    const lines = statusLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('region_status_write_failed');
    for (const text of ['arn:', ACCOUNT, 'violates', 'check constraint', 'aws_account_regions']) expect(lines[0]).not.toContain(text);
  });
});

// ---------------------------------------------------------------------------
describe('the lease: never caught, never an ok', () => {
  /** Waits until the scan's lease has expired by the database clock, then takes it as another worker. */
  async function takeOver(orgId: string): Promise<HeldLease | null> {
    const deadline = Date.now() + 15_000;
    while ((await pool.query(`SELECT expires_at <= clock_timestamp() AS e FROM aws_scan_leases WHERE organization_id = $1`, [orgId])).rows[0].e !== true) {
      if (Date.now() > deadline) throw new Error('the lease did not expire');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return onTaggedConnection(pool2, orgId, (db) => acquireScanLease(db, { organizationId: orgId, awsAccountId: ACCOUNT, scanKind: SCAN_KIND_DISCOVERY }, 'other-worker'));
  }
  const SHORT: LeaseTiming = { ...FAST, ttlSeconds: 2, heartbeat: { intervalMs: 60_000 } };

  it('a lease lost while a listing runs (before the outcomes are known): no status, the scan stops as today', async () => {
    const orgId = await insertOrg();
    let other: HeldLease | null = null;
    mockAwsClients({
      rds: {
        DescribeDBInstancesCommand: async () => {
          other = await takeOver(orgId);
          return { DBInstances: [] };
        },
      },
    });
    const writeSpy = jest.spyOn(foundation, 'recordHomeRegionScanStatus');
    const error = await service(SHORT).discoverAllResources(orgId).catch((err) => err);

    expect(other).not.toBeNull();
    expect(isLeaseLost(error)).toBe(true);
    expect(writeSpy).not.toHaveBeenCalled();
    expect(scanColumns((await regionRows(orgId))[HOME])).toEqual(UNSCANNED);
    const job = (await pool.query(`SELECT status, error_message FROM resource_discovery_jobs WHERE organization_id = $1`, [orgId])).rows;
    expect(job).toEqual([{ status: 'failed', error_message: DISCOVERY_LEASE_LOST_MESSAGE }]);
    expect(statusLines()).toEqual([]);
  }, 30_000);

  it('a stale token at the status write itself: not caught, nothing written, the scan stops with the lease-lost text', async () => {
    const orgId = await insertOrg();
    mockAwsClients();
    const realWrite = foundation.recordHomeRegionScanStatus;
    let other: HeldLease | null = null;
    jest.spyOn(foundation, 'recordHomeRegionScanStatus').mockImplementation(async (client, lease, scan) => {
      other = await takeOver(orgId);
      return realWrite(client, lease, scan);
    });
    const error = await service(SHORT).discoverAllResources(orgId).catch((err) => err);

    expect(other).not.toBeNull();
    expect(isLeaseLost(error)).toBe(true);
    expect(scanColumns((await regionRows(orgId))[HOME])).toEqual(UNSCANNED);
    const job = (await pool.query(`SELECT status, error_message FROM resource_discovery_jobs WHERE organization_id = $1`, [orgId])).rows;
    expect(job).toEqual([{ status: 'failed', error_message: DISCOVERY_LEASE_LOST_MESSAGE }]);
    expect(statusLines()).toEqual([]);
  }, 30_000);

  it('the account row now names another account at the status write: not caught, nothing written, the scan stops', async () => {
    // (A second eligible account: the next test, and the repository's F2 test.)
    const orgId = await insertOrg();
    mockAwsClients();
    const realWrite = foundation.recordHomeRegionScanStatus;
    jest.spyOn(foundation, 'recordHomeRegionScanStatus').mockImplementation(async (client, lease, scan) => {
      await pool.query(`UPDATE aws_accounts SET role_arn = 'arn:aws:iam::111122223333:role/devcontrol-readonly' WHERE org_id = $1`, [orgId]);
      return realWrite(client, lease, scan);
    });
    const error = await service().discoverAllResources(orgId).catch((err) => err);

    expect(isLeaseLost(error)).toBe(true);
    expect(scanColumns((await regionRows(orgId))[HOME])).toEqual(UNSCANNED);
    expect(statusLines()).toEqual([]);
  }, 30_000);

  it('the session already knows its lease is lost while the database lease is still valid: the scan stops before the status write (R11 N1)', async () => {
    // P2-4's scan.checkpoint() just before F18 (awsResourceDiscovery.ts recordHomeRegionStatus):
    // the fence alone would still pass here, because the database lease has not expired.
    const orgId = await insertOrg();
    mockAwsClients();
    let armedAt: Date | undefined;
    let token: string | undefined;
    const realStatus = regionScanStatus.homeRegionScanStatus;
    jest.spyOn(regionScanStatus, 'homeRegionScanStatus').mockImplementation((outcomes) => {
      const result = realStatus(outcomes);
      armedAt = new Date();
      return result;
    });
    const realCheckpoint = LeaseHeartbeat.prototype.checkpoint;
    jest.spyOn(LeaseHeartbeat.prototype, 'checkpoint').mockImplementation(function (this: LeaseHeartbeat) {
      if (!armedAt) return realCheckpoint.call(this);
      // As the heartbeat does after MAX_CONSECUTIVE_RENEW_ERRORS failed renewals.
      const lease = (this as unknown as { lease: HeldLease }).lease;
      token = lease.fencingToken;
      throw new LeaseLostError('lease_lost', lease.key);
    });
    const writeSpy = jest.spyOn(foundation, 'recordHomeRegionScanStatus');
    const error = await service().discoverAllResources(orgId).catch((err) => err);

    expect(armedAt).toBeDefined();
    expect(isLeaseLost(error)).toBe(true);
    expect(writeSpy).not.toHaveBeenCalled();
    expect(scanColumns((await regionRows(orgId))[HOME])).toEqual(UNSCANNED);
    const job = (await pool.query(`SELECT status, error_message FROM resource_discovery_jobs WHERE organization_id = $1`, [orgId])).rows;
    expect(job).toEqual([{ status: 'failed', error_message: DISCOVERY_LEASE_LOST_MESSAGE }]);
    expect(statusLines()).toEqual([]);
    // The database lease was still this scan's and still valid when the session stopped:
    // no other worker took it, and it was released (by this scan) before it expired.
    const lease = (await pool.query(
      `SELECT fencing_token::text AS token, released_at, expires_at FROM aws_scan_leases WHERE organization_id = $1`, [orgId]
    )).rows;
    expect(lease).toHaveLength(1);
    expect(lease[0].token).toBe(token);
    expect(lease[0].released_at).not.toBeNull();
    expect(lease[0].released_at.getTime()).toBeGreaterThanOrEqual(armedAt!.getTime() - 1000);
    expect(lease[0].expires_at.getTime()).toBeGreaterThan(lease[0].released_at.getTime());
  }, 30_000);

  it('an ambiguous account at the status write: not caught (not fail-soft), nothing written, the scan stops', async () => {
    const orgId = await insertOrg();
    mockAwsClients();
    jest.spyOn(foundation, 'recordHomeRegionScanStatus').mockRejectedValue(new AwsAccountAmbiguousError(orgId, 2));
    const error = await service().discoverAllResources(orgId).catch((err) => err);

    expect(isAwsAccountAmbiguous(error)).toBe(true);
    expect(scanColumns((await regionRows(orgId))[HOME])).toEqual(UNSCANNED);
    expect(statusLines()).toEqual([]);
    const job = (await pool.query(`SELECT status FROM resource_discovery_jobs WHERE organization_id = $1`, [orgId])).rows;
    expect(job).toEqual([{ status: 'failed' }]);
  }, 30_000);
});
