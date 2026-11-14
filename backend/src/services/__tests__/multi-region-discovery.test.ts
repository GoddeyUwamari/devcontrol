/**
 * Multi-region PR 1: a discovery scan with the organization's multi_region_discovery
 * flag on scans every enabled region of the account's own region list, inside the
 * one discovery job (MR-D1), a bounded number of regions at a time.
 *
 * Covered here (Step 1 §11 PR 1 and the PR 1 amendments):
 *   - the regions scanned are the enabled ones of the stored list, home first; a
 *     region the account has not enabled is never called;
 *   - each region's status is written once, at its end, with its reason code;
 *   - failure isolation, one region each: access_denied, access_denied_scp,
 *     region_not_ready, region_deadline, error: the job completes with
 *     region_incomplete, the other regions are ok, nothing in the failed region is
 *     reconciled, and its earlier resources stay;
 *   - the scan budget: regions already running finish, regions never started get
 *     scan_budget, nothing in them is touched, the job completes;
 *   - every region failed: the job fails;
 *   - the throttle breaker lowers the region's pool and never stops it;
 *   - never more regions at once than the region pool;
 *   - Resource Explorer: no Search without an index (flag on AND off), and a row is
 *     reconciled only by its own region's complete search (the aggregator case);
 *   - the global steps (S3, CloudFront, IAM, compliance, orphans, cost) run once;
 *   - the fence probe at a region boundary stops the scan when the connection changes;
 *   - the structured log line per region carries no account ID, ARN or name.
 *
 * Real Postgres; AWS clients are fakes (no AWS call is made). Placeholders only.
 */
import { Pool } from 'pg';
import { AWSResourceDiscoveryService, MultiRegionTiming } from '../awsResourceDiscovery';
import { AWSClientFactory } from '../aws-client-factory.service';
import costOptimizationService from '../cost-optimization.service';
import { DISCOVERY_INTERRUPTED_MESSAGE, LeaseTiming } from '../scan-session';
import { isLeaseLost } from '../scan-lease';
import { DEFAULT_AWS_CALL_POLICY } from '../../utils/awsCallPolicy';
import { OrphanedResourceDetectorService } from '../orphanedResourceDetector';
import { ComplianceScannerService } from '../complianceScanner';
import { DISCOVERY_FAILED_MESSAGE } from '../discovery-job-messages';
import { ObservabilityReadinessService, evaluateDiscoveryGate } from '../observability-readiness.service';
import * as foundation from '../../repositories/multi-region-foundation.repository';
import { ACTIVE_INDEX, PLACEHOLDER_ACCOUNT_ROW, connectPlaceholderAccount, isGetIndex, removePlaceholderAccounts, stubScanSource } from './helpers/scan-source';

const dbConfig = () => ({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'platform_portal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});
const pool = new Pool(dbConfig());
const ACCOUNT = PLACEHOLDER_ACCOUNT_ROW.account_id!;
const HOME = 'us-east-1';
const FAST: LeaseTiming = { heartbeat: { intervalMs: 200 }, pollMs: 50, acquireLockTimeoutMs: 15_000 };
const createdOrgIds: string[] = [];

/** The account's region list: five enabled (one of them an opted-in region), two opt-in regions not enabled. */
const REGION_LIST = {
  Regions: [
    { RegionName: 'us-east-1', OptInStatus: 'opt-in-not-required' },
    { RegionName: 'us-west-2', OptInStatus: 'opt-in-not-required' },
    { RegionName: 'eu-west-1', OptInStatus: 'opt-in-not-required' },
    { RegionName: 'ap-south-1', OptInStatus: 'opt-in-not-required' },
    { RegionName: 'me-central-1', OptInStatus: 'opted-in' },
    { RegionName: 'ap-east-1', OptInStatus: 'not-opted-in' },
    { RegionName: 'me-south-1', OptInStatus: 'not-opted-in' },
  ],
};
const SCAN_ORDER = ['us-east-1', 'ap-south-1', 'eu-west-1', 'me-central-1', 'us-west-2'];
const NOT_ENABLED = ['ap-east-1', 'me-south-1'];
const EU = 'eu-west-1';
const INSTANCE = 'i-0aaaaaaaaaaaaaaaa';
const euInstanceArn = `arn:aws:ec2:${EU}:*:instance/${INSTANCE}`;
const queueArn = (region: string) => `arn:aws:sqs:${region}:${ACCOUNT}:placeholder-queue`;
const euVolumeArn = `arn:aws:ec2:${EU}:*:volume/vol-0cccccccccccccccc`;
const vpcArn = (region: string) => `arn:aws:ec2:${region}:${ACCOUNT}:vpc/vpc-00000001`;

type Answer = (input: any) => any;
interface Call {
  region: string;
  client: string;
  command: string;
}

interface RegionAnswers {
  ec2?: Record<string, Answer>;
  rds?: Record<string, Answer>;
  dynamodb?: Record<string, Answer>;
  explorer?: Record<string, Answer>;
  backup?: Record<string, Answer>;
  /** Every call of the region's clients throws what this returns for the command (nothing: answered). */
  fail?: (command: string) => Error | undefined;
}

const awsError = (name: string, message = `placeholder ${name}`) => Object.assign(new Error(message), { name });
const accessDenied = () =>
  awsError('UnauthorizedOperation', `User: arn:aws:sts::${ACCOUNT}:assumed-role/devcontrol-readonly/s is not authorized to perform this operation`);
const scpDenied = () =>
  awsError(
    'AccessDeniedException',
    `User: arn:aws:sts::${ACCOUNT}:assumed-role/devcontrol-readonly/s is not authorized to perform: ec2:DescribeInstances with an explicit deny in a service control policy`
  );

function fake(log: Call[], region: string, client: string, answers: Record<string, Answer>, fail?: (command: string) => Error | undefined) {
  return {
    send: jest.fn(async (command: { constructor: { name: string }; input?: any }) => {
      log.push({ region, client, command: command.constructor.name });
      const failure = fail?.(command.constructor.name);
      if (failure) throw failure;
      const answer = answers[command.constructor.name];
      if (!answer) throw awsError('Unexpected', `Unexpected ${command.constructor.name}`);
      return answer(command.input ?? {});
    }),
  };
}

function regionClients(log: Call[], region: string, answers: RegionAnswers = {}): any {
  const f = answers.fail;
  const ec2 = fake(log, region, 'ec2', {
    DescribeRegionsCommand: () => REGION_LIST,
    DescribeInstancesCommand: () => ({ Reservations: [] }),
    DescribeVolumesCommand: () => ({ Volumes: [] }),
    DescribeSecurityGroupsCommand: () => ({ SecurityGroups: [] }),
    ...answers.ec2,
  }, f);
  const explorer = fake(log, region, 'resource-explorer-2', {
    GetIndexCommand: () => ACTIVE_INDEX,
    SearchCommand: () => ({ Resources: [], Count: { TotalResources: 0, Complete: true } }),
    ...answers.explorer,
  }, f);
  const cloudWatch = fake(log, region, 'cloudwatch', { GetMetricStatisticsCommand: () => ({ Datapoints: [] }) }, f);
  const dynamodb = fake(log, region, 'dynamodb', { ...answers.dynamodb }, f);
  return {
    enabled: true,
    region,
    accountId: ACCOUNT,
    costExplorer: {},
    ec2,
    rds: fake(log, region, 'rds', { DescribeDBInstancesCommand: () => ({ DBInstances: [] }), DescribeDBClustersCommand: () => ({ DBClusters: [] }), ...answers.rds }, f),
    s3: fake(log, region, 's3', { ListBucketsCommand: () => ({ Buckets: [] }) }),
    s3Control: {},
    cloudWatch,
    lambda: fake(log, region, 'lambda', { ListFunctionsCommand: () => ({ Functions: [] }) }, f),
    ecs: {},
    elb: fake(log, region, 'elbv2', { DescribeLoadBalancersCommand: () => ({ LoadBalancers: [] }) }, f),
    eks: {},
    dynamodb: {},
    cloudFront: fake(log, 'us-east-1', 'cloudfront', { ListDistributionsCommand: () => ({ DistributionList: { Items: [] } }) }),
    apiGateway: {},
    elastiCache: {},
    sqs: {},
    sns: {},
    iam: fake(log, 'us-east-1', 'iam', { ListUsersCommand: () => ({ Users: [] }) }),
    backup: fake(log, region, 'backup', { ListRecoveryPointsByResourceCommand: () => ({ RecoveryPoints: [] }), ...answers.backup }, f),
    securityHub: {},
    resourceExplorer: explorer,
    getDynamoDBClientForRegion: () => dynamodb,
    getApplicationAutoScalingClientForRegion: () => ({}),
    getCloudWatchClientForRegion: () => cloudWatch,
    getS3ClientForRegion: () => ({}),
  };
}

/** Every region's fake clients; `answers` per region. Returns the call log and the spies. */
function mockAws(answers: Record<string, RegionAnswers> = {}) {
  stubScanSource();
  const log: Call[] = [];
  jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue(regionClients(log, HOME, answers[HOME]));
  const built = jest.spyOn(AWSClientFactory, 'buildClients').mockImplementation((region: string) => regionClients(log, region, answers[region]));
  const cost = jest
    .spyOn(costOptimizationService, 'analyzeAllResources')
    .mockResolvedValue({ observations: [], riRecommendations: [], riSucceeded: true, homeRegion: HOME });
  return { log, built, cost };
}

async function insertOrg({ flag = true, tier = 'starter' }: { flag?: boolean; tier?: string } = {}): Promise<string> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
    [`MR Org ${suffix}`, `mr-org-${suffix}`, `MR Org ${suffix}`, tier]
  );
  const orgId = rows[0].id;
  createdOrgIds.push(orgId);
  await connectPlaceholderAccount(pool, orgId);
  if (flag) {
    await pool.query(
      `INSERT INTO organization_feature_flags (organization_id, flag, enabled, set_by, note) VALUES ($1, 'multi_region_discovery', true, 'test', 'test')`,
      [orgId]
    );
  }
  return orgId;
}

function service(timing: Partial<MultiRegionTiming> = {}): AWSResourceDiscoveryService {
  const svc = new AWSResourceDiscoveryService(pool);
  (svc as any).leaseTiming = FAST;
  (svc as any).callPolicy = { ...DEFAULT_AWS_CALL_POLICY, sleep: async () => undefined };
  (svc as any).multiRegionTiming = { regionPool: 3, regionDeadlineMs: 60_000, scanBudgetMs: 60 * 60_000, now: Date.now, ...timing };
  return svc;
}

async function regionRows(orgId: string): Promise<Record<string, any>> {
  const { rows } = await pool.query(`SELECT * FROM aws_account_regions WHERE organization_id = $1 ORDER BY region`, [orgId]);
  return Object.fromEntries(rows.map((row) => [row.region, row]));
}

async function job(orgId: string) {
  return (
    await pool.query(
      `SELECT status, error_message, to_jsonb(j) -> 'warnings' AS warnings, regions FROM resource_discovery_jobs j WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [orgId]
    )
  ).rows[0];
}

async function seedResource(orgId: string, arn: string, type: string, region: string) {
  await pool.query(
    `INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status, missing_scan_count, tags, metadata)
     VALUES ($1, $2, $3, $3, $4, $5, 'active', 0, '{}'::jsonb, '{}'::jsonb)`,
    [orgId, arn, arn.split(/[/:]/).pop(), type, region]
  );
}

async function resource(orgId: string, arn: string) {
  return (await pool.query(`SELECT region, status, missing_scan_count FROM aws_resources WHERE organization_id = $1 AND resource_arn = $2`, [orgId, arn])).rows[0];
}

const regionLogLines = () =>
  (console.log as jest.Mock).mock.calls
    .map((args) => String(args[0]))
    .filter((line) => line.startsWith('{"event":"discovery_region_scan"'))
    .map((line) => JSON.parse(line));

const statusWrites = (spy: jest.SpyInstance) => spy.mock.calls.map((call) => call[2].region).sort();

function quietConsole() {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
}

beforeEach(quietConsole);
afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    for (const table of [
      'soc2_evidence_observations', 'soc2_control_evaluations', 'account_security_findings', 'cost_recommendations', 'cost_analysis_runs',
      'framework_evaluation_runs', 'aws_resources', 'resource_discovery_jobs', 'aws_scan_leases', 'job_leases', 'aws_account_regions',
      'organization_feature_flags',
    ]) {
      await pool.query(`DELETE FROM ${table} WHERE organization_id = ANY($1)`, [createdOrgIds]).catch(() => undefined);
    }
    await removePlaceholderAccounts(pool, createdOrgIds);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
}, 30_000);

// ---------------------------------------------------------------------------
describe('flag on: every enabled region, once each', () => {
  it('scans the enabled regions home first, never a region the account has not enabled; one status write per region; global steps once', async () => {
    const orgId = await insertOrg();
    const { log, built, cost } = mockAws({
      [EU]: {
        ec2: {
          DescribeInstancesCommand: () => ({
            Reservations: [{ Instances: [{ InstanceId: INSTANCE, InstanceType: 't3.micro', State: { Name: 'running' }, Tags: [{ Key: 'Name', Value: 'placeholder-web' }] }] }],
          }),
        },
      },
      'ap-south-1': {
        explorer: {
          SearchCommand: () => ({
            Resources: [{ Arn: vpcArn('ap-south-1'), Region: 'ap-south-1', Service: 'ec2', CfnResourceType: 'AWS::EC2::VPC', Properties: [] }],
            Count: { TotalResources: 1, Complete: true },
          }),
        },
      },
    });
    const statusSpy = jest.spyOn(foundation, 'recordRegionScanStatus');
    const homeSpy = jest.spyOn(foundation, 'recordHomeRegionScanStatus');
    const orphans = jest.spyOn(OrphanedResourceDetectorService.prototype, 'detectOrphaned');
    const groups = jest.spyOn(ComplianceScannerService.prototype, 'checkSecurityGroups');
    const iam = jest.spyOn(ComplianceScannerService.prototype, 'checkIAMSecurity');

    const result = await service().discoverAllResources(orgId);

    // Regions: the enabled ones only, home first.
    expect(built.mock.calls.map((call) => call[0]).sort()).toEqual(SCAN_ORDER.filter((r) => r !== HOME).sort());
    for (const region of NOT_ENABLED) expect(log.filter((call) => call.region === region)).toEqual([]);
    expect(log.filter((call) => call.command === 'DescribeInstancesCommand').map((call) => call.region).sort()).toEqual([...SCAN_ORDER].sort());

    // One status write per enabled region, none through the home-only write.
    expect(statusWrites(statusSpy)).toEqual([...SCAN_ORDER].sort());
    expect(homeSpy).not.toHaveBeenCalled();
    const rows = await regionRows(orgId);
    for (const region of SCAN_ORDER) expect(rows[region]).toMatchObject({ last_scan_status: 'ok', last_error_code: null, consecutive_failures: 0 });
    for (const region of NOT_ENABLED) expect(rows[region]).toMatchObject({ enabled: false, last_scan_status: 'never_scanned', last_scan_started_at: null });

    // The job: completed, no warning, the regions it scanned.
    expect(await job(orgId)).toEqual({ status: 'completed', error_message: null, warnings: null, regions: SCAN_ORDER });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);

    // Each region's resources stored at their own region.
    expect(await resource(orgId, euInstanceArn)).toMatchObject({ region: EU, status: 'running' });
    expect(await resource(orgId, vpcArn('ap-south-1'))).toMatchObject({ region: 'ap-south-1' });

    // Global steps once; security groups once per region.
    const count = (client: string, command: string) => log.filter((call) => call.client === client && call.command === command).length;
    expect(count('s3', 'ListBucketsCommand')).toBe(1);
    expect(count('cloudfront', 'ListDistributionsCommand')).toBe(1);
    expect(count('ec2', 'DescribeRegionsCommand')).toBe(1);
    expect(iam).toHaveBeenCalledTimes(1);
    expect(orphans).toHaveBeenCalledTimes(1);
    expect(cost).toHaveBeenCalledTimes(1);
    expect(groups.mock.calls.map((call) => call[1]).sort()).toEqual([...SCAN_ORDER].sort());

    // A7: one structured line per region, without account IDs, ARNs or names.
    const lines = regionLogLines();
    expect(lines.map((line) => line.region).sort()).toEqual([...SCAN_ORDER].sort());
    for (const line of lines) {
      expect(Object.keys(line).sort()).toEqual(
        [
          'calls', 'duration_ms', 'event', 'get_metric_data_metrics', 'get_metric_statistics_requests', 'listings', 'organization_id',
          'outcome', 'reason', 'region', 'resource_pool', 'throttles',
        ].sort()
      );
      expect(line).toMatchObject({ organization_id: orgId, outcome: 'ok', reason: null, listings: 6 });
      const text = JSON.stringify(line);
      expect(text).not.toMatch(/\d{12}/);
      for (const forbidden of ['arn:', INSTANCE, 'placeholder-web', 'vpc-']) expect(text).not.toContain(forbidden);
    }
  }, 60_000);

  it('the region list was never stored: the home region only', async () => {
    const orgId = await insertOrg();
    const { built } = mockAws({ [HOME]: { ec2: { DescribeRegionsCommand: () => { throw accessDenied(); } } } });
    await service().discoverAllResources(orgId);
    expect(built).not.toHaveBeenCalled();
    expect(await job(orgId)).toMatchObject({ status: 'completed', regions: [HOME] });
  }, 30_000);
});

// ---------------------------------------------------------------------------
describe('failure isolation: one region fails, the scan completes', () => {
  it.each([
    ['AccessDenied', 'denied', 'access_denied', () => accessDenied()],
    ['AccessDenied by a service control policy', 'denied', 'access_denied_scp', () => scpDenied()],
    ['AuthFailure (enabled, not ready yet)', 'failed', 'region_not_ready', () => awsError('AuthFailure', 'AWS was not able to validate the provided access credentials')],
    ['any other error', 'failed', 'error', () => awsError('InternalError', 'boom')],
  ])('%s in eu-west-1 -> %s %s; the other regions ok; nothing in eu-west-1 reconciled', async (_label, status, code, error) => {
    const orgId = await insertOrg();
    await seedResource(orgId, euInstanceArn, 'ec2', EU);
    await seedResource(orgId, queueArn(EU), 'sqs', EU);
    mockAws({ [EU]: { fail: error } });
    const statusSpy = jest.spyOn(foundation, 'recordRegionScanStatus');

    const result = await service().discoverAllResources(orgId);

    const rows = await regionRows(orgId);
    expect(rows[EU]).toMatchObject({ last_scan_status: status, last_error_code: code, last_success_at: null, consecutive_failures: 1 });
    for (const region of SCAN_ORDER.filter((r) => r !== EU)) expect(rows[region]).toMatchObject({ last_scan_status: 'ok', last_error_code: null });
    expect(statusWrites(statusSpy)).toEqual([...SCAN_ORDER].sort());
    expect(await job(orgId)).toEqual({ status: 'completed', error_message: null, warnings: ['region_incomplete'], regions: SCAN_ORDER });
    expect(result.errors).toEqual([]);
    // Earlier resources stay; no reconcile counted them missing.
    expect(await resource(orgId, euInstanceArn)).toMatchObject({ status: 'active', missing_scan_count: 0 });
    expect(await resource(orgId, queueArn(EU))).toMatchObject({ status: 'active', missing_scan_count: 0 });
    // The AWS text that named the policy is never stored.
    expect(rows[EU].last_error_message).toBeNull();
  }, 60_000);

  it('a region past its deadline -> timed_out region_deadline; the other regions go on; nothing in it reconciled', async () => {
    const orgId = await insertOrg();
    await seedResource(orgId, queueArn(EU), 'sqs', EU);
    await seedResource(orgId, euInstanceArn, 'ec2', EU);
    await seedResource(orgId, euVolumeArn, 'ebs', EU);
    // eu-west-1's RDS listing (after its complete EC2 and EBS listings) never answers;
    // its deadline (200 ms here) stops it. The complete EBS listing (without the volume)
    // must still not reconcile: the region did not finish.
    mockAws({ [EU]: { rds: { DescribeDBInstancesCommand: () => new Promise(() => undefined) } } });

    await service({ regionDeadlineMs: 200 }).discoverAllResources(orgId);

    const rows = await regionRows(orgId);
    expect(rows[EU]).toMatchObject({ last_scan_status: 'timed_out', last_error_code: 'region_deadline', consecutive_failures: 1 });
    for (const region of SCAN_ORDER.filter((r) => r !== EU)) expect(rows[region]).toMatchObject({ last_scan_status: 'ok' });
    expect(await job(orgId)).toMatchObject({ status: 'completed', warnings: ['region_incomplete'] });
    // The EC2 listing ran before the deadline (the instance is not in it), yet nothing was reconciled.
    expect(await resource(orgId, euInstanceArn)).toMatchObject({ status: 'active', missing_scan_count: 0 });
    expect(await resource(orgId, queueArn(EU))).toMatchObject({ status: 'active', missing_scan_count: 0 });
    expect(await resource(orgId, euVolumeArn)).toMatchObject({ status: 'active', missing_scan_count: 0 });
    expect(regionLogLines().find((line) => line.region === EU)).toMatchObject({ outcome: 'timed_out', reason: 'region_deadline' });
  }, 60_000);

  it('L-2: a region whose deadline passes AFTER its complete search (during enrichment): no Resource Explorer reconcile', async () => {
    const orgId = await insertOrg();
    // A queue the search no longer returns: a reconcile would count it missing.
    await seedResource(orgId, queueArn(EU), 'sqs', EU);
    const tableArn = `arn:aws:dynamodb:${EU}:${ACCOUNT}:table/placeholder-table`;
    mockAws({
      [EU]: {
        explorer: {
          SearchCommand: () => ({
            Resources: [{ Arn: tableArn, Region: EU, Service: 'dynamodb', CfnResourceType: 'AWS::DynamoDB::Table', Properties: [] }],
            Count: { TotalResources: 1, Complete: true },
          }),
        },
        // The table's enrichment never answers: the deadline (300 ms) passes during it.
        dynamodb: { DescribeTableCommand: () => new Promise(() => undefined) },
      },
    });
    const reconcileRegions: Array<string | null> = [];
    const svc = service({ regionDeadlineMs: 300 });
    const reconciliation = (svc as any).reconciliation;
    const realReconcile = reconciliation.reconcile.bind(reconciliation);
    jest.spyOn(reconciliation, 'reconcile').mockImplementation(async (...args: any[]) => {
      reconcileRegions.push(args[2]);
      return realReconcile(...args);
    });

    await svc.discoverAllResources(orgId);

    // The search was complete and its table stored, but the region did not finish.
    expect(await resource(orgId, tableArn)).toMatchObject({ region: EU });
    expect(reconcileRegions).not.toContain(EU);
    expect(await resource(orgId, queueArn(EU))).toMatchObject({ status: 'active', missing_scan_count: 0 });
    expect((await regionRows(orgId))[EU]).toMatchObject({ last_scan_status: 'timed_out', last_error_code: 'region_deadline' });
    expect(await job(orgId)).toMatchObject({ status: 'completed', warnings: ['region_incomplete'] });
  }, 60_000);

  it('every region fails: the job fails (with the approved text), each region with its own status', async () => {
    const orgId = await insertOrg();
    // Every regional call is refused; the home region's list is still read (before any region is scanned).
    const refuse = (command: string) => (command === 'DescribeRegionsCommand' ? undefined : accessDenied());
    mockAws(Object.fromEntries(SCAN_ORDER.map((region) => [region, { fail: refuse }])));
    const result = await service().discoverAllResources(orgId);
    const rows = await regionRows(orgId);
    for (const region of SCAN_ORDER) expect(rows[region].last_scan_status).toBe('denied');
    const latest = await job(orgId);
    expect(latest.status).toBe('failed');
    expect(latest.error_message).toContain(DISCOVERY_FAILED_MESSAGE);
    expect(latest.warnings).toContain('region_incomplete');
    expect(result.errors).toContain(DISCOVERY_FAILED_MESSAGE);
  }, 60_000);
});

// ---------------------------------------------------------------------------
describe('L-1: the deleted-resources count across concurrent regions', () => {
  it('two regions terminating at the same time are both counted (no lost update)', async () => {
    const orgId = await insertOrg();
    const homeVolume = `arn:aws:ec2:${HOME}:*:volume/vol-0dddddddddddddddd`;
    await seedResource(orgId, homeVolume, 'ebs', HOME);
    await seedResource(orgId, queueArn('ap-south-1'), 'sqs', 'ap-south-1');
    // Each is one absence away from the termination threshold (MISSING_SCAN_THRESHOLD = 2).
    await pool.query(`UPDATE aws_resources SET missing_scan_count = 1 WHERE organization_id = $1`, [orgId]);
    mockAws();
    const svc = service({ regionPool: 2 });

    // ap-south-1 has finished (its Resource Explorer termination counted, its status
    // written) only after the home region's EBS reconcile started, and before it ends.
    let apFinished!: () => void;
    const apDone = new Promise<void>((resolve) => (apFinished = resolve));
    const realWrite = foundation.recordRegionScanStatus;
    jest.spyOn(foundation, 'recordRegionScanStatus').mockImplementation(async (client, lease, scan) => {
      const written = await realWrite(client, lease, scan);
      if (scan.region === 'ap-south-1') apFinished();
      return written;
    });
    const reconciliation = (svc as any).reconciliation;
    const realReconcile = reconciliation.reconcile.bind(reconciliation);
    jest.spyOn(reconciliation, 'reconcile').mockImplementation(async (...args: any[]) => {
      const [, , region, , types] = args;
      if (region === HOME && types.length === 1 && types[0] === 'ebs') await apDone;
      return realReconcile(...args);
    });

    const result = await svc.discoverAllResources(orgId);

    expect(await resource(orgId, homeVolume)).toMatchObject({ status: 'terminated' });
    expect(await resource(orgId, queueArn('ap-south-1'))).toMatchObject({ status: 'terminated' });
    expect(result.resources_deleted).toBe(2);
    const { rows } = await pool.query(`SELECT resources_deleted FROM resource_discovery_jobs WHERE organization_id = $1`, [orgId]);
    expect(rows).toEqual([{ resources_deleted: 2 }]);
  }, 60_000);
});

// ---------------------------------------------------------------------------
describe('the scan budget (A2)', () => {
  it('regions already running finish; regions never started get scan_budget; nothing in them is touched; the job completes', async () => {
    const orgId = await insertOrg();
    await seedResource(orgId, queueArn(EU), 'sqs', EU);
    let now = 1_000_000;
    // The home region's instance listing takes "an hour" by the scan's clock.
    const { built } = mockAws({
      [HOME]: { ec2: { DescribeInstancesCommand: () => { now += 60 * 60_000; return { Reservations: [] }; } } },
    });
    const statusSpy = jest.spyOn(foundation, 'recordRegionScanStatus');

    const result = await service({ regionPool: 2, scanBudgetMs: 45 * 60_000, now: () => now }).discoverAllResources(orgId);

    const rows = await regionRows(orgId);
    // The two running when the budget ran out finished.
    expect(rows[HOME]).toMatchObject({ last_scan_status: 'ok' });
    expect(rows['ap-south-1']).toMatchObject({ last_scan_status: 'ok' });
    // The rest never started.
    for (const region of ['eu-west-1', 'me-central-1', 'us-west-2']) {
      expect(rows[region]).toMatchObject({ last_scan_status: 'timed_out', last_error_code: 'scan_budget', consecutive_failures: 1, last_success_at: null });
      expect(built.mock.calls.map((call) => call[0])).not.toContain(region);
    }
    expect(statusWrites(statusSpy)).toEqual([...SCAN_ORDER].sort());
    expect(await resource(orgId, queueArn(EU))).toMatchObject({ status: 'active', missing_scan_count: 0 });
    expect(await job(orgId)).toEqual({ status: 'completed', error_message: null, warnings: ['scan_budget', 'region_incomplete'], regions: [HOME, 'ap-south-1'] });
    expect(result.warnings).toEqual(['scan_budget', 'region_incomplete']);
    expect(regionLogLines().filter((line) => line.reason === 'scan_budget').map((line) => line.region).sort()).toEqual(['eu-west-1', 'me-central-1', 'us-west-2']);
  }, 60_000);
});

// ---------------------------------------------------------------------------
describe('concurrency (A1)', () => {
  it('never more regions at once than the region pool (3 of 5)', async () => {
    const orgId = await insertOrg();
    let inFlight = 0;
    let most = 0;
    const slowListing = () => async () => {
      inFlight++;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 100));
      inFlight--;
      return { Reservations: [] };
    };
    mockAws(Object.fromEntries(SCAN_ORDER.map((region) => [region, { ec2: { DescribeInstancesCommand: slowListing() } }])));
    await service({ regionPool: 3 }).discoverAllResources(orgId);
    expect(most).toBe(3);
  }, 60_000);

  it('the throttle breaker halves the region\'s pool (8 -> 4 -> 2) and never stops the region', async () => {
    const orgId = await insertOrg();
    const instances = Array.from({ length: 10 }, (_, i) => ({ InstanceId: `i-0${String.fromCharCode(97 + i).repeat(16)}`, State: { Name: 'running' } }));
    mockAws({
      [HOME]: {
        ec2: { DescribeInstancesCommand: () => ({ Reservations: [{ Instances: instances }] }) },
        backup: { ListRecoveryPointsByResourceCommand: () => { throw awsError('ThrottlingException', 'Rate exceeded'); } },
      },
    });
    await service().discoverAllResources(orgId);
    const home = regionLogLines().find((line) => line.region === HOME);
    // Two throttled attempts per instance (DEFAULT_AWS_CALL_POLICY.maxAttempts), ten instances.
    expect(home).toMatchObject({ throttles: 20, resource_pool: 2, outcome: 'ok' });
    expect((await regionRows(orgId))[HOME]).toMatchObject({ last_scan_status: 'ok' });
    const stored = (await pool.query(`SELECT count(*)::int AS n FROM aws_resources WHERE organization_id = $1 AND resource_type = 'ec2'`, [orgId])).rows[0].n;
    expect(stored).toBe(10);
  }, 60_000);
});

// ---------------------------------------------------------------------------
describe('Resource Explorer (A4, A5)', () => {
  const noIndex = { GetIndexCommand: () => { throw awsError('ResourceNotFoundException', 'no index'); } };

  it('flag on: a region with no index gets no Search, the warning, an ok status; the job completes', async () => {
    const orgId = await insertOrg();
    const { log } = mockAws({ [EU]: { explorer: noIndex } });
    await service().discoverAllResources(orgId);
    expect(log.filter((call) => call.region === EU && call.command === 'SearchCommand')).toEqual([]);
    expect(log.filter((call) => call.region === EU && call.command === 'GetIndexCommand')).toHaveLength(1);
    expect((await regionRows(orgId))[EU]).toMatchObject({ last_scan_status: 'ok', last_error_code: null });
    expect(await job(orgId)).toMatchObject({ status: 'completed', error_message: null, warnings: ['resource_explorer_no_index'] });
  }, 60_000);

  it('flag off: the home region with no index gets no Search, the warning, an ok status; the job completes (not failed)', async () => {
    const orgId = await insertOrg({ flag: false });
    const { log, built } = mockAws({ [HOME]: { explorer: noIndex } });
    await service().discoverAllResources(orgId);
    expect(built).not.toHaveBeenCalled();
    expect(log.filter((call) => call.command === 'SearchCommand')).toEqual([]);
    expect((await regionRows(orgId))[HOME]).toMatchObject({ last_scan_status: 'ok', last_error_code: null });
    expect(await job(orgId)).toEqual({ status: 'completed', error_message: null, warnings: ['resource_explorer_no_index'], regions: [HOME] });
  }, 30_000);

  /** An active index, but Search refused with 401: the region has no default view the role can use (review M-3). */
  const noView = {
    SearchCommand: () => {
      throw Object.assign(new Error('placeholder unauthorized'), { name: 'UnauthorizedException', $metadata: { httpStatusCode: 401 } });
    },
  };

  it('M-3 flag on: a Search 401 (no default view) is not a region failure: the warning, an ok status, own listings ran, nothing reconciled; the job completes', async () => {
    const orgId = await insertOrg();
    await seedResource(orgId, queueArn(EU), 'sqs', EU);
    const { log } = mockAws({ [EU]: { explorer: noView } });
    await service().discoverAllResources(orgId);
    expect((await regionRows(orgId))[EU]).toMatchObject({ last_scan_status: 'ok', last_error_code: null });
    for (const command of ['DescribeInstancesCommand', 'DescribeVolumesCommand', 'DescribeDBInstancesCommand', 'ListFunctionsCommand', 'DescribeLoadBalancersCommand']) {
      expect(log.filter((call) => call.region === EU && call.command === command)).toHaveLength(1);
    }
    expect(await job(orgId)).toEqual({ status: 'completed', error_message: null, warnings: ['resource_explorer_no_view'], regions: SCAN_ORDER });
    expect(await resource(orgId, queueArn(EU))).toMatchObject({ status: 'active', missing_scan_count: 0 });
    expect(regionLogLines().find((line) => line.region === EU)).toMatchObject({ outcome: 'ok', reason: null });
  }, 60_000);

  it('M-3 flag off: a home Search 401 (no default view) no longer fails the job: the warning, an ok status, own listings ran', async () => {
    const orgId = await insertOrg({ flag: false });
    await seedResource(orgId, queueArn(HOME), 'sqs', HOME);
    const { log } = mockAws({ [HOME]: { explorer: noView } });
    const result = await service().discoverAllResources(orgId);
    expect(log.filter((call) => call.command === 'DescribeInstancesCommand')).toHaveLength(1);
    expect((await regionRows(orgId))[HOME]).toMatchObject({ last_scan_status: 'ok', last_error_code: null });
    expect(await job(orgId)).toEqual({ status: 'completed', error_message: null, warnings: ['resource_explorer_no_view'], regions: [HOME] });
    expect(result.errors).toEqual([]);
    expect(await resource(orgId, queueArn(HOME))).toMatchObject({ status: 'active', missing_scan_count: 0 });
  }, 30_000);

  it('M-3: only a 401 is "no view"; an AccessDenied Search is still the source\'s failure (flag off: the job fails as before)', async () => {
    const orgId = await insertOrg({ flag: false });
    mockAws({ [HOME]: { explorer: { SearchCommand: () => { throw accessDenied(); } } } });
    await service().discoverAllResources(orgId);
    const latest = await job(orgId);
    expect(latest.status).toBe('failed');
    expect(latest.error_message).toMatch(/^Resource Explorer: /);
    expect((await regionRows(orgId))[HOME]).toMatchObject({ last_scan_status: 'denied' });
  }, 30_000);

  it('flag on and off: every Search follows a GetIndex in the same region', async () => {
    for (const flag of [true, false]) {
      const orgId = await insertOrg({ flag });
      const { log } = mockAws();
      await service().discoverAllResources(orgId);
      const explorerCalls = log.filter((call) => call.client === 'resource-explorer-2');
      for (const [index, call] of explorerCalls.entries()) {
        if (call.command === 'SearchCommand') expect(explorerCalls.slice(0, index).some((c) => c.command === 'GetIndexCommand' && c.region === call.region)).toBe(true);
      }
      expect(explorerCalls.filter((call) => call.command === 'SearchCommand').length).toBe(flag ? SCAN_ORDER.length : 1);
      jest.restoreAllMocks();
      quietConsole();
    }
  }, 60_000);

  /** The home region's index is the aggregator: its search returns eu-west-1's queue too. */
  const aggregator = {
    GetIndexCommand: () => ({ ...ACTIVE_INDEX, Type: 'AGGREGATOR' }),
    SearchCommand: () => ({
      Resources: [
        { Arn: vpcArn(HOME), Region: HOME, Service: 'ec2', CfnResourceType: 'AWS::EC2::VPC', Properties: [] },
        { Arn: queueArn(EU), Region: EU, Service: 'sqs', CfnResourceType: 'AWS::SQS::Queue', Properties: [] },
      ],
      Count: { TotalResources: 2, Complete: true },
    }),
  };

  it('flag on: an aggregator row is reconciled only by its own region\'s complete search', async () => {
    // eu-west-1's own search no longer has the queue: its reconcile counts it missing.
    const orgId = await insertOrg();
    await seedResource(orgId, queueArn(EU), 'sqs', EU);
    mockAws({ [HOME]: { explorer: aggregator } });
    await service().discoverAllResources(orgId);
    expect(await resource(orgId, queueArn(EU))).toMatchObject({ region: EU, missing_scan_count: 1 });
    expect(await resource(orgId, vpcArn(HOME))).toMatchObject({ region: HOME });

    // eu-west-1's own search cut off: nothing in eu-west-1 is reconciled, whatever the home search said.
    const other = await insertOrg();
    await seedResource(other, queueArn(EU), 'sqs', EU);
    jest.restoreAllMocks();
    quietConsole();
    mockAws({
      [HOME]: { explorer: aggregator },
      [EU]: { explorer: { SearchCommand: () => ({ Resources: [], Count: { TotalResources: 1000, Complete: false } }) } },
    });
    await service().discoverAllResources(other);
    expect(await resource(other, queueArn(EU))).toMatchObject({ missing_scan_count: 0 });
  }, 60_000);

  it('flag off: the home aggregator search stores and reconciles nothing of another region (the A4 exception)', async () => {
    const orgId = await insertOrg({ flag: false });
    mockAws({ [HOME]: { explorer: aggregator } });
    await service().discoverAllResources(orgId);
    // Before PR 1 the eu-west-1 queue was stored here, at eu-west-1, and never reconciled.
    expect(await resource(orgId, queueArn(EU))).toBeUndefined();
    expect(await resource(orgId, vpcArn(HOME))).toMatchObject({ region: HOME });

    const seeded = await insertOrg({ flag: false });
    await seedResource(seeded, queueArn(EU), 'sqs', EU);
    jest.restoreAllMocks();
    quietConsole();
    mockAws({ [HOME]: { explorer: { ...aggregator, SearchCommand: () => ({ Resources: [], Count: { TotalResources: 0, Complete: true } }) } } });
    await service().discoverAllResources(seeded);
    // eu-west-1 is not searched without the flag: its row is left exactly as it was.
    expect(await resource(seeded, queueArn(EU))).toMatchObject({ status: 'active', missing_scan_count: 0 });
  }, 60_000);
});

// ---------------------------------------------------------------------------
describe('security groups per region; findings with no region resolved once, with the home region', () => {
  async function seedFinding(orgId: string, key: string, region: string | null) {
    await pool.query(
      `INSERT INTO account_security_findings (organization_id, finding_key, category, severity, title, recommendation, resource_identifier, region, last_seen_at)
       VALUES ($1, $2, 'networking', 'high', 'placeholder', 'placeholder', 'placeholder', $3, now() - interval '1 day')`,
      [orgId, key, region]
    );
  }
  const status = async (orgId: string, key: string) =>
    (await pool.query(`SELECT status FROM account_security_findings WHERE organization_id = $1 AND finding_key = $2`, [orgId, key])).rows[0].status;

  it('the home security-group scan failing leaves no-region findings active, though other regions completed; each region resolves its own', async () => {
    const orgId = await insertOrg();
    await seedFinding(orgId, 'k-unregioned', null);
    await seedFinding(orgId, 'k-home', HOME);
    await seedFinding(orgId, 'k-eu', EU);
    mockAws({ [HOME]: { ec2: { DescribeSecurityGroupsCommand: () => { throw accessDenied(); } } } });
    const result = await service().discoverAllResources(orgId);
    expect(await status(orgId, 'k-unregioned')).toBe('active');
    expect(await status(orgId, 'k-home')).toBe('active');
    expect(await status(orgId, 'k-eu')).toBe('resolved');
    // A region's security-group failure is the region's: not a job error.
    expect(result.errors).toEqual([]);
  }, 60_000);

  it('the home security-group scan complete: no-region findings are resolved', async () => {
    const orgId = await insertOrg();
    await seedFinding(orgId, 'k-unregioned', null);
    mockAws();
    await service().discoverAllResources(orgId);
    expect(await status(orgId, 'k-unregioned')).toBe('resolved');
  }, 60_000);
});

// ---------------------------------------------------------------------------
describe('R1: the home region\'s EC2 and RDS failures still reach the Operational Health readiness gate', () => {
  /** The gate's answer for the organization's latest finished run, read exactly as the service reads it. */
  async function gate(orgId: string) {
    // getGatedRun is private: the same read the readiness service makes.
    const service = new ObservabilityReadinessService() as unknown as { getGatedRun: (id: string) => Promise<Parameters<typeof evaluateDiscoveryGate>[0]> };
    const latest = await service.getGatedRun(orgId);
    const shape = (g: ReturnType<typeof evaluateDiscoveryGate>) => (g.kind === 'usable' ? { kind: 'usable' } : g);
    return { ec2: shape(evaluateDiscoveryGate(latest, 'ec2')), rds: shape(evaluateDiscoveryGate(latest, 'rds')) };
  }
  const refused = () => () => { throw accessDenied(); };
  const segments = (message: string | null) => (message ?? '').split('; ').filter(Boolean);

  it.each([
    ['EC2', { ec2: { DescribeInstancesCommand: refused() } }, { ec2: { kind: 'error', reason: 'EC2 discovery failed in the latest discovery run' }, rds: { kind: 'usable' } }],
    ['RDS', { rds: { DescribeDBInstancesCommand: refused() } }, { ec2: { kind: 'usable' }, rds: { kind: 'error', reason: 'RDS discovery failed in the latest discovery run' } }],
  ])('a home %s failure blocks that type\'s readiness exactly as without the flag; the job still completes', async (type, answers, expected) => {
    const flagOn = await insertOrg();
    mockAws({ [HOME]: answers as RegionAnswers });
    await service().discoverAllResources(flagOn);
    const onJob = await job(flagOn);
    expect(onJob.status).toBe('completed');
    expect(onJob.warnings).toEqual(['region_incomplete']);
    expect(segments(onJob.error_message)).toEqual([expect.stringMatching(new RegExp(`^${type}: `))]);

    jest.restoreAllMocks();
    quietConsole();
    const flagOff = await insertOrg({ flag: false });
    mockAws({ [HOME]: answers as RegionAnswers });
    await service().discoverAllResources(flagOff);
    expect((await job(flagOff)).status).toBe('failed');

    expect(await gate(flagOn)).toEqual(expected);
    expect(await gate(flagOff)).toEqual(await gate(flagOn));
  }, 60_000);

  it('a non-home failure (EC2 and RDS in eu-west-1) is not in the error text and blocks nothing', async () => {
    const orgId = await insertOrg();
    mockAws({ [EU]: { ec2: { DescribeInstancesCommand: refused() }, rds: { DescribeDBInstancesCommand: refused() } } });
    await service().discoverAllResources(orgId);
    expect(await job(orgId)).toMatchObject({ status: 'completed', error_message: null, warnings: ['region_incomplete'] });
    expect((await regionRows(orgId))[EU]).toMatchObject({ last_scan_status: 'denied' });
    expect(await gate(orgId)).toEqual({ ec2: { kind: 'usable' }, rds: { kind: 'usable' } });
  }, 60_000);

  it('only EC2 and RDS: another home listing\'s failure (Lambda) is the region\'s, not in the error text', async () => {
    const orgId = await insertOrg();
    mockAws({ [HOME]: { fail: (command) => (command === 'ListFunctionsCommand' ? accessDenied() : undefined) } });
    await service().discoverAllResources(orgId);
    expect(await job(orgId)).toMatchObject({ status: 'completed', error_message: null, warnings: ['region_incomplete'] });
  }, 60_000);

  it('flag OFF: a completed job never carries an EC2 or RDS segment (the gate change is a no-op without the flag)', async () => {
    // Every failure that leaves a flag-off job completed (a cost failure only), and every
    // EC2/RDS failure (which fails the job): no completed job has an EC2/RDS segment.
    const cases: Array<{ answers: Record<string, RegionAnswers>; cost?: boolean }> = [
      { answers: {} },
      { answers: {}, cost: true },
      { answers: { [HOME]: { ec2: { DescribeInstancesCommand: refused() } } } },
      { answers: { [HOME]: { rds: { DescribeDBInstancesCommand: refused() } } } },
      { answers: { [HOME]: { ec2: { DescribeInstancesCommand: refused() } } }, cost: true },
      { answers: { [HOME]: { fail: (command) => (command === 'ListFunctionsCommand' ? accessDenied() : undefined) } } },
    ];
    const jobs: Array<{ status: string; error_message: string | null }> = [];
    for (const { answers, cost } of cases) {
      const orgId = await insertOrg({ flag: false });
      const mocks = mockAws(answers);
      if (cost) mocks.cost.mockRejectedValue(new Error('cost boom'));
      await service().discoverAllResources(orgId);
      jobs.push(await job(orgId));
      jest.restoreAllMocks();
      quietConsole();
    }
    expect(jobs.map((j) => j.status)).toEqual(['completed', 'completed', 'failed', 'failed', 'failed', 'failed']);
    for (const j of jobs.filter((row) => row.status === 'completed')) {
      expect(segments(j.error_message).filter((segment) => /^(EC2|RDS): /.test(segment))).toEqual([]);
    }
    expect(segments(jobs[1].error_message)).toEqual(['Cost analysis: cost boom']);
  }, 120_000);
});

// ---------------------------------------------------------------------------
describe('the fence probe at a region boundary (A6)', () => {
  it('a changed AWS connection stops the scan before the next region starts; a region finished before keeps its status', async () => {
    const orgId = await insertOrg();
    const { built } = mockAws();
    // Right after ap-south-1 (the second region, pool 1) has written its status, the
    // organization's AWS connection changes: eu-west-1's fence probe must stop the scan.
    const realWrite = foundation.recordRegionScanStatus;
    jest.spyOn(foundation, 'recordRegionScanStatus').mockImplementation(async (client, lease, scan) => {
      const written = await realWrite(client, lease, scan);
      if (scan.region === 'ap-south-1') {
        await pool.query(`UPDATE aws_accounts SET role_arn = 'arn:aws:iam::111122223333:role/devcontrol-readonly' WHERE org_id = $1`, [orgId]);
      }
      return written;
    });
    const error = await service({ regionPool: 1 }).discoverAllResources(orgId).catch((err) => err);

    expect(isLeaseLost(error)).toBe(true);
    // eu-west-1 never got clients: the probe ran before them.
    expect(built.mock.calls.map((call) => call[0])).toEqual(['ap-south-1']);
    const rows = await regionRows(orgId);
    expect(rows[HOME]).toMatchObject({ last_scan_status: 'ok' });
    expect(rows['ap-south-1']).toMatchObject({ last_scan_status: 'ok' });
    for (const region of ['eu-west-1', 'me-central-1', 'us-west-2']) expect(rows[region].last_scan_status).toBe('never_scanned');
    expect(await job(orgId)).toMatchObject({ status: 'failed', error_message: DISCOVERY_INTERRUPTED_MESSAGE });
  }, 60_000);
});
