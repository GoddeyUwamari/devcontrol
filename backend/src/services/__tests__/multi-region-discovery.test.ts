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
import { GetMetricDataCommand, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { DescribeInstancesCommand } from '@aws-sdk/client-ec2';
import { AWSResourceDiscoveryService, MultiRegionTiming } from '../awsResourceDiscovery';
import * as regionRunModule from '../region-run';
import { AWSClientFactory } from '../aws-client-factory.service';
import costOptimizationService from '../cost-optimization.service';
import { DISCOVERY_INTERRUPTED_MESSAGE, LeaseTiming } from '../scan-session';
import { isLeaseLost } from '../scan-lease';
import { DEFAULT_AWS_CALL_POLICY } from '../../utils/awsCallPolicy';
import { OrphanedResourceDetectorService } from '../orphanedResourceDetector';
import { ComplianceScannerService } from '../complianceScanner';
import { DISCOVERY_FAILED_MESSAGE } from '../discovery-job-messages';
import { CostRecommendationsRepository } from '../../repositories/cost-recommendations.repository';
import { ObservabilityReadinessService, evaluateDiscoveryGate } from '../observability-readiness.service';
import * as foundation from '../../repositories/multi-region-foundation.repository';
import { ACTIVE_INDEX, DEFAULT_VIEW, PLACEHOLDER_ACCOUNT_ROW, connectPlaceholderAccount, isGetIndex, removePlaceholderAccounts, stubScanSource } from './helpers/scan-source';

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
  s3?: Record<string, Answer>;
  iam?: Record<string, Answer>;
  lambda?: Record<string, Answer>;
  elb?: Record<string, Answer>;
  cloudwatch?: Record<string, Answer>;
  autoscaling?: Record<string, Answer>;
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
      // '*': the answer to any command not named (a test's slow client).
      const answer = answers[command.constructor.name] ?? answers['*'];
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
    GetDefaultViewCommand: () => DEFAULT_VIEW,
    SearchCommand: () => ({ Resources: [], Count: { TotalResources: 0, Complete: true } }),
    ...answers.explorer,
  }, f);
  const cloudWatch = fake(log, region, 'cloudwatch', { GetMetricStatisticsCommand: () => ({ Datapoints: [] }), ...answers.cloudwatch }, f);
  const dynamodb = fake(log, region, 'dynamodb', { ...answers.dynamodb }, f);
  // Only a test that answers Auto Scaling gets a client that records calls; otherwise the
  // empty object every earlier test was written against.
  const autoscaling = answers.autoscaling ? fake(log, region, 'application-autoscaling', answers.autoscaling, f) : {};
  return {
    enabled: true,
    region,
    accountId: ACCOUNT,
    costExplorer: {},
    ec2,
    rds: fake(log, region, 'rds', { DescribeDBInstancesCommand: () => ({ DBInstances: [] }), DescribeDBClustersCommand: () => ({ DBClusters: [] }), ...answers.rds }, f),
    s3: fake(log, region, 's3', { ListBucketsCommand: () => ({ Buckets: [] }), ...answers.s3 }),
    s3Control: {},
    cloudWatch,
    lambda: fake(log, region, 'lambda', { ListFunctionsCommand: () => ({ Functions: [] }), ...answers.lambda }, f),
    ecs: {},
    elb: fake(log, region, 'elbv2', { DescribeLoadBalancersCommand: () => ({ LoadBalancers: [] }), ...answers.elb }, f),
    eks: {},
    dynamodb: {},
    cloudFront: fake(log, 'us-east-1', 'cloudfront', { ListDistributionsCommand: () => ({ DistributionList: { Items: [] } }) }),
    apiGateway: {},
    elastiCache: {},
    sqs: {},
    sns: {},
    iam: fake(log, 'us-east-1', 'iam', { ListUsersCommand: () => ({ Users: [] }), ...answers.iam }),
    backup: fake(log, region, 'backup', { ListRecoveryPointsByResourceCommand: () => ({ RecoveryPoints: [] }), ...answers.backup }, f),
    securityHub: {},
    resourceExplorer: explorer,
    getDynamoDBClientForRegion: () => dynamodb,
    getApplicationAutoScalingClientForRegion: () => autoscaling,
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
  (svc as any).multiRegionTiming = {
    regionPool: 3,
    regionDeadlineMs: 60_000,
    scanBudgetMs: 60 * 60_000,
    scanDeadlineMs: 2 * 60 * 60_000,
    now: Date.now,
    ...timing,
  };
  return svc;
}

/**
 * Gives `region` alone a `ms` deadline (never longer than the one the scan would give it). The
 * other regions keep the service's (60 s by default): a real-clock deadline as short as 200 ms
 * can also pass in a healthy region on a loaded CI runner, which then shows timed_out.
 * Restored by the afterEach restoreAllMocks.
 */
function shortDeadlineIn(region: string, ms: number): void {
  const RealRegionRun = regionRunModule.RegionRun;
  jest.spyOn(regionRunModule, 'RegionRun').mockImplementation(
    (name: string, options: regionRunModule.RegionRunOptions) =>
      new RealRegionRun(name, name === region ? { ...options, deadlineMs: Math.min(options.deadlineMs, ms) } : options)
  );
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
          'calls', 'cost_pass_get_metric_data_metrics', 'cost_pass_get_metric_statistics_requests', 'diagnostic', 'duration_ms', 'event',
          'get_metric_data_metrics', 'get_metric_statistics_requests', 'listings', 'organization_id', 'outcome', 'reason', 'region',
          'resource_pool', 'throttles',
        ].sort()
      );
      // Five own listings, the Resource Explorer search and (PR 1b, M-4) the security groups.
      expect(line).toMatchObject({ organization_id: orgId, outcome: 'ok', reason: null, diagnostic: null, listings: 7 });
      // The organization's id is checked by value above; every other field must carry
      // no 12-digit run (an AWS account ID). (A random UUID's last group can be twelve
      // digits, about 1 in 280: checking the whole line made this test flaky.)
      const text = JSON.stringify({ ...line, organization_id: undefined });
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
    // The AWS text that named the policy is never stored (region-access PR 1: only the
    // diagnostic of the Resource Explorer call that failed with the region's code).
    const name = (error() as Error).name;
    expect(rows[EU].last_error_message).toBe(`resource-explorer:GetIndex:${name}`);
    expect(rows[EU].last_error_message).not.toMatch(/arn:|[0-9]{12}|not authorized|service control|validate|boom/);
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

    shortDeadlineIn(EU, 200);
    await service().discoverAllResources(orgId);

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

  // Review S-1: the tests above get their short deadline from shortDeadlineIn, so this one pins that the
  // configured regionDeadlineMs reaches every region's run (awsResourceDiscovery.ts, the RegionRun built
  // per region). The scan deadline (2 h) is longer, so the min() picks the configured 45 s for each.
  it('the configured regionDeadlineMs is the deadline of every region run', async () => {
    const orgId = await insertOrg();
    mockAws();
    const RealRegionRun = regionRunModule.RegionRun;
    const deadlines: Record<string, number> = {};
    jest.spyOn(regionRunModule, 'RegionRun').mockImplementation((name: string, options: regionRunModule.RegionRunOptions) => {
      deadlines[name] = options.deadlineMs;
      return new RealRegionRun(name, options);
    });

    await service({ regionDeadlineMs: 45_000 }).discoverAllResources(orgId);

    expect(deadlines).toEqual(Object.fromEntries(SCAN_ORDER.map((region) => [region, 45_000])));
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
    shortDeadlineIn(EU, 300);
    const svc = service();
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
    // The production default: one region database step at a time (REGION_DB_STEP_CONNECTIONS).
    const svc = service({ regionPool: 2 });

    // The home region's EBS reconcile is held, before it takes a step connection,
    // until ap-south-1 has finished (its Resource Explorer termination counted, its
    // status written). With `terminated += await this.reconcileEbs(ctx)` the home
    // region would already have read the total, and ap-south-1's count would be lost.
    // (PR 1b: the hold used to sit inside the reconcile's database step; with one step
    // at a time that waited for ap-south-1's status step, which waited for the slot.
    // No production step waits for another region: see StepLimiter.)
    let apFinished!: () => void;
    const apDone = new Promise<void>((resolve) => (apFinished = resolve));
    const realWrite = foundation.recordRegionScanStatus;
    jest.spyOn(foundation, 'recordRegionScanStatus').mockImplementation(async (client, lease, scan) => {
      const written = await realWrite(client, lease, scan);
      if (scan.region === 'ap-south-1') apFinished();
      return written;
    });
    const realReconcileEbs = (svc as any).reconcileEbs.bind(svc);
    jest.spyOn(svc as any, 'reconcileEbs').mockImplementation(async (ctx: any) => {
      if (ctx.region === HOME) await apDone;
      return realReconcileEbs(ctx);
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

    // The scan deadline (PR 1b) is set past the clock's jump: this test is the budget's alone.
    const result = await service({ regionPool: 2, scanBudgetMs: 30 * 60_000, scanDeadlineMs: 3 * 60 * 60_000, now: () => now }).discoverAllResources(orgId);

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

  it('flag on: a region with no index gets no Search, the warning, an ok status (its code: the warning, PR 2 RR-M2); the job completes', async () => {
    const orgId = await insertOrg();
    const { log } = mockAws({ [EU]: { explorer: noIndex } });
    await service().discoverAllResources(orgId);
    expect(log.filter((call) => call.region === EU && call.command === 'SearchCommand')).toEqual([]);
    expect(log.filter((call) => call.region === EU && call.command === 'GetIndexCommand')).toHaveLength(1);
    // PR 2 (RR-M2): the warning is recorded as that region's code; the status stays ok.
    expect((await regionRows(orgId))[EU]).toMatchObject({ last_scan_status: 'ok', last_error_code: 'resource_explorer_no_index', consecutive_failures: 0 });
    expect((await regionRows(orgId))[HOME]).toMatchObject({ last_scan_status: 'ok', last_error_code: null });
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
    // PR 2 (RR-M2): the warning is recorded as that region's code; the status stays ok.
    expect((await regionRows(orgId))[EU]).toMatchObject({ last_scan_status: 'ok', last_error_code: 'resource_explorer_no_view' });
    for (const command of ['DescribeInstancesCommand', 'DescribeVolumesCommand', 'DescribeDBInstancesCommand', 'ListFunctionsCommand', 'DescribeLoadBalancersCommand']) {
      expect(log.filter((call) => call.region === EU && call.command === command)).toHaveLength(1);
    }
    expect(await job(orgId)).toEqual({ status: 'completed', error_message: null, warnings: ['resource_explorer_no_view'], regions: SCAN_ORDER });
    expect(await resource(orgId, queueArn(EU))).toMatchObject({ status: 'active', missing_scan_count: 0 });
    expect(regionLogLines().find((line) => line.region === EU)).toMatchObject({ outcome: 'ok', reason: 'resource_explorer_no_view' });
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

  /** GetIndex itself refused with 401 (not the Search): the "no view" rule (M-3) must not apply. */
  const getIndex401 = {
    GetIndexCommand: () => {
      throw Object.assign(new Error('placeholder unauthorized'), { name: 'UnauthorizedException', $metadata: { httpStatusCode: 401 } });
    },
  };

  it('RR-L1 flag off: a GetIndex refused with 401 still fails the source and the job as before (never read as "no view")', async () => {
    const orgId = await insertOrg({ flag: false });
    await seedResource(orgId, queueArn(HOME), 'sqs', HOME);
    const { log } = mockAws({ [HOME]: { explorer: getIndex401 } });
    const result = await service().discoverAllResources(orgId);
    const latest = await job(orgId);
    expect(latest.status).toBe('failed');
    expect(latest.error_message).toBe('Resource Explorer: placeholder unauthorized');
    expect(latest.warnings).toBeNull();
    expect(result.warnings).not.toContain('resource_explorer_no_view');
    // No Search after a failed GetIndex, nothing reconciled.
    expect(log.filter((call) => call.command === 'SearchCommand')).toEqual([]);
    expect(await resource(orgId, queueArn(HOME))).toMatchObject({ status: 'active', missing_scan_count: 0 });
    expect((await regionRows(orgId))[HOME].last_scan_status).toBe('failed');
  }, 30_000);

  it('RR-L1 flag on: a GetIndex refused with 401 in eu-west-1 is that region\'s failure (failed, error), not "no view"; the job completes', async () => {
    const orgId = await insertOrg();
    await seedResource(orgId, queueArn(EU), 'sqs', EU);
    mockAws({ [EU]: { explorer: getIndex401 } });
    const result = await service().discoverAllResources(orgId);
    expect((await regionRows(orgId))[EU]).toMatchObject({ last_scan_status: 'failed', last_error_code: 'error' });
    expect(await job(orgId)).toEqual({ status: 'completed', error_message: null, warnings: ['region_incomplete'], regions: SCAN_ORDER });
    expect(result.warnings).not.toContain('resource_explorer_no_view');
    expect(await resource(orgId, queueArn(EU))).toMatchObject({ status: 'active', missing_scan_count: 0 });
  }, 60_000);

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

  const jobCompliance = async (orgId: string) =>
    (
      await pool.query(
        `SELECT status, error_message, compliance_scan_completed, to_jsonb(j) -> 'warnings' AS warnings FROM resource_discovery_jobs j WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [orgId]
      )
    ).rows[0];

  it.each([
    ['AccessDenied', 'denied', 'access_denied', () => accessDenied()],
    ['a service control policy', 'denied', 'access_denied_scp', () => scpDenied()],
    ['any other error', 'failed', 'error', () => awsError('InternalError', 'boom')],
  ])('M-4: a NON-home security-group failure (%s) is that region\'s: its status %s %s, region_incomplete; the job\'s compliance stays complete', async (_label, regionStatus, code, error) => {
    const orgId = await insertOrg();
    await seedFinding(orgId, 'k-eu', EU);
    await seedFinding(orgId, 'k-home', HOME);
    await seedFinding(orgId, 'k-unregioned', null);
    mockAws({ [EU]: { ec2: { DescribeSecurityGroupsCommand: () => { throw error(); } } } });

    const result = await service().discoverAllResources(orgId);

    expect(await jobCompliance(orgId)).toEqual({ status: 'completed', error_message: null, compliance_scan_completed: true, warnings: ['region_incomplete'] });
    expect(result.errors).toEqual([]);
    const rows = await regionRows(orgId);
    expect(rows[EU]).toMatchObject({ last_scan_status: regionStatus, last_error_code: code, consecutive_failures: 1 });
    for (const region of SCAN_ORDER.filter((r) => r !== EU)) expect(rows[region]).toMatchObject({ last_scan_status: 'ok', last_error_code: null });
    // eu-west-1's networking findings were not reconciled; the home region's and the no-region ones were.
    expect(await status(orgId, 'k-eu')).toBe('active');
    expect(await status(orgId, 'k-home')).toBe('resolved');
    expect(await status(orgId, 'k-unregioned')).toBe('resolved');
    expect(regionLogLines().find((line) => line.region === EU)).toMatchObject({ outcome: regionStatus, reason: code });
  }, 60_000);

  it('M-4: a non-home security-group listing cut off at its page limit -> that region partial (discovery_listing_truncated); compliance complete', async () => {
    const orgId = await insertOrg();
    await seedFinding(orgId, 'k-eu', EU);
    // Every page says there is another: listAllPages stops at its page limit.
    mockAws({ [EU]: { ec2: { DescribeSecurityGroupsCommand: () => ({ SecurityGroups: [], NextToken: 'more' }) } } });
    await service().discoverAllResources(orgId);
    expect(await jobCompliance(orgId)).toMatchObject({ status: 'completed', compliance_scan_completed: true, warnings: ['discovery_listing_truncated'] });
    expect((await regionRows(orgId))[EU]).toMatchObject({ last_scan_status: 'partial', last_error_code: 'discovery_listing_truncated' });
    expect(await status(orgId, 'k-eu')).toBe('active');
  }, 60_000);

  it('M-4: a HOME security-group failure keeps today\'s behaviour: compliance_scan_completed false, the home status ok, no job error', async () => {
    const orgId = await insertOrg();
    await seedFinding(orgId, 'k-home', HOME);
    await seedFinding(orgId, 'k-eu', EU);
    mockAws({ [HOME]: { ec2: { DescribeSecurityGroupsCommand: () => { throw accessDenied(); } } } });

    const result = await service().discoverAllResources(orgId);

    expect(await jobCompliance(orgId)).toEqual({ status: 'completed', error_message: null, compliance_scan_completed: false, warnings: null });
    expect(result.errors).toEqual([]);
    const rows = await regionRows(orgId);
    for (const region of SCAN_ORDER) expect(rows[region]).toMatchObject({ last_scan_status: 'ok', last_error_code: null });
    expect(await status(orgId, 'k-home')).toBe('active');
    expect(await status(orgId, 'k-eu')).toBe('resolved');
  }, 60_000);

  it('M-4: every region\'s security groups are read inside its own run (its deadline): a region past its deadline before them reads none', async () => {
    const orgId = await insertOrg();
    await seedFinding(orgId, 'k-eu', EU);
    mockAws({ [EU]: { rds: { DescribeDBInstancesCommand: () => new Promise(() => undefined) } } });
    const groups = jest.spyOn(ComplianceScannerService.prototype, 'checkSecurityGroups');
    shortDeadlineIn(EU, 200);
    await service().discoverAllResources(orgId);
    expect(groups.mock.calls.map((call) => call[1]).sort()).toEqual(SCAN_ORDER.filter((r) => r !== EU).sort());
    expect((await regionRows(orgId))[EU]).toMatchObject({ last_scan_status: 'timed_out', last_error_code: 'region_deadline' });
    expect(await status(orgId, 'k-eu')).toBe('active');
    expect(await jobCompliance(orgId)).toMatchObject({ status: 'completed', compliance_scan_completed: true });
  }, 60_000);

  // PR 1b review RV-L2 (the reviewer's probe): the home SG outcome is kept out of the
  // region's outcome list (awsResourceDiscovery.ts `...(home ? [] : [groups.outcome])`),
  // which is what keeps a home truncation from adding discovery_listing_truncated to the
  // job. Mutant M4e (the home outcome added to the list) must fail here.
  it('RV-L2: a HOME security-group listing cut off at its page limit keeps today\'s behaviour: no discovery_listing_truncated warning, every region ok, compliance false', async () => {
    const orgId = await insertOrg();
    await seedFinding(orgId, 'k-home', HOME);
    mockAws({ [HOME]: { ec2: { DescribeSecurityGroupsCommand: () => ({ SecurityGroups: [], NextToken: 'more' }) } } });
    const result = await service().discoverAllResources(orgId);
    expect(await jobCompliance(orgId)).toEqual({ status: 'completed', error_message: null, compliance_scan_completed: false, warnings: null });
    expect(result.warnings ?? []).toEqual([]);
    const rows = await regionRows(orgId);
    for (const region of SCAN_ORDER) expect(rows[region]).toMatchObject({ last_scan_status: 'ok', last_error_code: null });
    // A listing cut off is not complete: the home region's networking findings are not resolved.
    expect(await status(orgId, 'k-home')).toBe('active');
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

// ---------------------------------------------------------------------------
describe('M-1 (PR 1b): a region worker holds no database connection while it waits on AWS', () => {
  /** Connections of the test's pool checked out right now (the service scans on the same pool). */
  const checkedOut = () => pool.totalCount - pool.idleCount;
  const until = async (condition: () => boolean, timeoutMs = 20_000) => {
    const started = Date.now();
    while (!condition()) {
      if (Date.now() - started > timeoutMs) throw new Error('condition not reached');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };

  it('during a slow AWS call in eu-west-1, the only connection out is the scan\'s own; every step connection is returned', async () => {
    const orgId = await insertOrg();
    let euWaiting!: () => void;
    const euCalled = new Promise<void>((resolve) => (euWaiting = resolve));
    let releaseEu!: () => void;
    const euReleased = new Promise<void>((resolve) => (releaseEu = resolve));
    mockAws({
      [EU]: {
        ec2: {
          // eu-west-1's instance listing (after its fence probe) answers only when released.
          DescribeInstancesCommand: async () => {
            euWaiting();
            await euReleased;
            return { Reservations: [{ Instances: [{ InstanceId: INSTANCE, InstanceType: 't3.micro', State: { Name: 'running' } }] }] };
          },
        },
      },
    });
    const svc = service();
    // No heartbeat renewal (its own short checkout) during the measurement.
    (svc as any).leaseTiming = { ...FAST, heartbeat: { intervalMs: 60 * 60_000 } };
    const stepRegions: string[] = [];
    // A region has finished once its status-write step has returned its connection.
    const statusWritten = new Set<string>();
    const finished = new Set<string>();
    const realWrite = foundation.recordRegionScanStatus;
    jest.spyOn(foundation, 'recordRegionScanStatus').mockImplementation(async (client, lease, scan) => {
      const written = await realWrite(client, lease, scan);
      statusWritten.add(scan.region);
      return written;
    });
    const realStep = (svc as any).regionDbStep.bind(svc);
    jest.spyOn(svc as any, 'regionDbStep').mockImplementation(async (org: any, region: any, fn: any) => {
      stepRegions.push(region);
      const result = await realStep(org, region, fn);
      // realStep resolves after its connection was untagged and released.
      if (statusWritten.has(region)) finished.add(region);
      return result;
    });

    const scanning = svc.discoverAllResources(orgId);
    await euCalled;
    // Every other region has finished: eu-west-1 is the only region running.
    await until(() => SCAN_ORDER.filter((region) => region !== EU).every((region) => finished.has(region)));
    expect(checkedOut()).toBe(1);
    // eu-west-1 did use the database before its AWS call (its fence probe), on a step connection.
    expect(stepRegions.filter((region) => region === EU)).toEqual([EU]);
    releaseEu();
    const result = await scanning;

    expect(result.errors).toEqual([]);
    expect(await resource(orgId, euInstanceArn)).toMatchObject({ region: EU, status: 'running' });
    expect((await regionRows(orgId))[EU]).toMatchObject({ last_scan_status: 'ok' });
    // After the scan every connection is back.
    expect(checkedOut()).toBe(0);
  }, 60_000);

  it('the regions\' step connections take turns: never more than REGION_DB_STEP_CONNECTIONS (1) at once', async () => {
    const orgId = await insertOrg();
    const instances = {
      DescribeInstancesCommand: () => ({
        Reservations: [{ Instances: [{ InstanceId: INSTANCE, InstanceType: 't3.micro', State: { Name: 'running' } }] }],
      }),
    };
    mockAws(Object.fromEntries(SCAN_ORDER.map((region) => [region, { ec2: instances }])));
    const svc = service({ regionPool: 3 });
    let inStep = 0;
    let most = 0;
    let total = 0;
    const realStep = (svc as any).regionDbStep.bind(svc);
    jest.spyOn(svc as any, 'regionDbStep').mockImplementation(async (org: any, region: any, fn: any) => {
      inStep++;
      total++;
      most = Math.max(most, inStep);
      try {
        // Held a little, so overlapping steps would be seen.
        return await realStep(org, region, async (client: any) => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          return fn(client);
        });
      } finally {
        inStep--;
      }
    });
    await svc.discoverAllResources(orgId);
    expect(total).toBeGreaterThanOrEqual(SCAN_ORDER.length * 3);
    expect(most).toBe(1);
  }, 60_000);

  // PR 1b review RV-L4: the security-group findings write checks out its own connection
  // inside AccountSecurityFindingsRepository.reconcileScan, not through regionDbStep, so
  // the "take turns" count above cannot see it. Here every StepLimiter step is marked
  // (an AsyncLocalStorage of the test's own), and each region's reconcileScan must run
  // inside one. Control V1 (the write called outside the limiter, `(step) => step()`)
  // must fail here.
  it('RV-L4: every region\'s security-group findings write runs inside a region database step (the step limiter)', async () => {
    const orgId = await insertOrg();
    mockAws();
    const { AsyncLocalStorage } = await import('async_hooks');
    const { StepLimiter } = await import('../region-run');
    const { AccountSecurityFindingsRepository } = await import('../../repositories/account-security-findings.repository');
    const marked = new AsyncLocalStorage<true>();
    const realRun = StepLimiter.prototype.run;
    jest.spyOn(StepLimiter.prototype, 'run').mockImplementation(function (this: InstanceType<typeof StepLimiter>, step: () => Promise<unknown>) {
      return realRun.call(this, () => marked.run(true, step));
    } as any);
    const { inRegionRun } = await import('../region-log-context');
    const insideStep: Array<[string | null | undefined, boolean]> = [];
    let outsideRegions = 0;
    const realReconcile = AccountSecurityFindingsRepository.prototype.reconcileScan;
    jest.spyOn(AccountSecurityFindingsRepository.prototype, 'reconcileScan').mockImplementation(function (this: any, ...args: any[]) {
      // The region worker sets the region log context (L-3); the IAM write after the
      // regions runs outside any region run, and outside the limiter by design.
      if (inRegionRun()) insideStep.push([args[4], marked.getStore() === true]);
      else outsideRegions++;
      return (realReconcile as any).apply(this, args);
    } as any);

    await service().discoverAllResources(orgId);

    // One write per region, each region's own, each inside a step.
    expect(insideStep.map(([region]) => region).sort()).toEqual([...SCAN_ORDER].sort());
    expect(insideStep.filter(([, inside]) => !inside)).toEqual([]);
    // And the IAM write, once, after the regions.
    expect(outsideRegions).toBe(1);
  }, 60_000);

  it.each([
    ['its fence probe', 1],
    ['its EC2 upsert', 2],
  ])('no connection for eu-west-1 (%s): that region is failed (error), the others ok, the job completes', async (_label, failOnCall) => {
    const orgId = await insertOrg();
    mockAws({
      [EU]: {
        ec2: {
          DescribeInstancesCommand: () => ({ Reservations: [{ Instances: [{ InstanceId: INSTANCE, InstanceType: 't3.micro', State: { Name: 'running' } }] }] }),
        },
      },
    });
    const svc = service();
    const realStep = (svc as any).regionDbStep.bind(svc);
    let euCalls = 0;
    jest.spyOn(svc as any, 'regionDbStep').mockImplementation((org: any, region: any, fn: any) => {
      if (region === EU && ++euCalls === failOnCall) return Promise.reject(new Error('timeout exceeded when trying to connect'));
      return realStep(org, region, fn);
    });

    const result = await svc.discoverAllResources(orgId);

    const rows = await regionRows(orgId);
    expect(rows[EU]).toMatchObject({ last_scan_status: 'failed', last_error_code: 'error' });
    for (const region of SCAN_ORDER.filter((r) => r !== EU)) expect(rows[region]).toMatchObject({ last_scan_status: 'ok' });
    expect(await job(orgId)).toEqual({ status: 'completed', error_message: null, warnings: ['region_incomplete'], regions: SCAN_ORDER });
    expect(result.errors).toEqual([]);
  }, 60_000);
});

// ---------------------------------------------------------------------------
describe('M-2 (PR 1b): the whole-scan deadline bounds the steps after the regions', () => {
  const DEADLINE_MIN = 50;
  /** A call that answers only when its region's or the scan's deadline aborts it. */
  const never = () => new Promise(() => undefined);
  const jobRow = async (orgId: string) =>
    (
      await pool.query(
        `SELECT status, error_message, compliance_scan_completed, cost_analysis_completed, to_jsonb(j) -> 'warnings' AS warnings, regions
           FROM resource_discovery_jobs j WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [orgId]
      )
    ).rows[0];
  const deadlineLog = () =>
    (console.warn as jest.Mock).mock.calls.map((args) => String(args[0])).filter((line) => line.includes('scan_deadline: org'));
  const euInstance = {
    DescribeInstancesCommand: () => ({ Reservations: [{ Instances: [{ InstanceId: INSTANCE, InstanceType: 't3.micro', State: { Name: 'running' } }] }] }),
  };
  /** The regions' results that must survive whatever happens after them. */
  async function expectRegionResultsKept(orgId: string) {
    expect(await resource(orgId, euInstanceArn)).toMatchObject({ region: EU, status: 'running' });
    const rows = await regionRows(orgId);
    for (const region of SCAN_ORDER) expect(rows[region]).toMatchObject({ last_scan_status: 'ok', last_error_code: null });
  }

  it('the deadline has passed before the first step after the regions: none starts; the job completes with scan_deadline; the regions\' results stay', async () => {
    const orgId = await insertOrg();
    let now = 1_000_000;
    mockAws({ [EU]: { ec2: euInstance } });
    // When the last region's status is written, 51 minutes have passed by the scan's
    // clock: every region finished in time, and the deadline passed before the first
    // step after them.
    const realWrite = foundation.recordRegionScanStatus;
    let written = 0;
    jest.spyOn(foundation, 'recordRegionScanStatus').mockImplementation(async (client, lease, scan) => {
      const result = await realWrite(client, lease, scan);
      if (++written === SCAN_ORDER.length) now += (DEADLINE_MIN + 1) * 60_000;
      return result;
    });
    const iam = jest.spyOn(ComplianceScannerService.prototype, 'checkIAMSecurity');
    const orphans = jest.spyOn(OrphanedResourceDetectorService.prototype, 'detectOrphaned');
    const evaluate = jest.spyOn(ComplianceScannerService.prototype, 'evaluateResource');
    const svc = service({ regionPool: 5, scanBudgetMs: 30 * 60_000, scanDeadlineMs: DEADLINE_MIN * 60_000, now: () => now });

    const result = await svc.discoverAllResources(orgId);

    expect(await jobRow(orgId)).toEqual({
      status: 'completed', error_message: null, compliance_scan_completed: false, cost_analysis_completed: false,
      warnings: ['scan_deadline'], regions: SCAN_ORDER,
    });
    expect(result).toMatchObject({ errors: [], warnings: ['scan_deadline'] });
    await expectRegionResultsKept(orgId);
    // Not one post-region step started.
    expect(evaluate).not.toHaveBeenCalled();
    expect(iam).not.toHaveBeenCalled();
    expect(orphans).not.toHaveBeenCalled();
    expect(costOptimizationService.analyzeAllResources).not.toHaveBeenCalled();
    expect((await pool.query(`SELECT count(*)::int AS n FROM cost_analysis_runs WHERE organization_id = $1`, [orgId])).rows[0].n).toBe(0);
    expect(deadlineLog()).toEqual([expect.stringContaining('not started: compliance, iam, orphans, cost; stopped: none')]);
    // PR 2 review M-4: read back through the coverage API, scan_deadline stays the scan's
    // (last_scan.warnings), never a region's; every region was checked by the scan.
    const { readServicesCoverage } = await import('../../routes/services-coverage.routes');
    const coverage = await readServicesCoverage({ query: (text: string, values?: unknown[]) => pool.query(text, values as any[]) }, orgId);
    expect(coverage.last_scan!.warnings).toEqual(['scan_deadline']);
    expect(coverage.multi_region!.region_warnings).toEqual([]);
    expect(coverage.multi_region!.regions.every((r) => r.state === 'checked')).toBe(true);
    expect(coverage.multi_region!.coverage_status).toBe('all_checked');
    // Item 7: the cost pass never ran, so the home line says so (null), not 0.
    expect(regionLogLines().find((line) => line.region === HOME)).toMatchObject({ cost_pass_get_metric_data_metrics: null, cost_pass_get_metric_statistics_requests: null });
  }, 60_000);

  it('a step that started but cannot finish (compliance: every bucket call hangs) is stopped at the deadline; nothing of it is stored; the job completes', async () => {
    const orgId = await insertOrg();
    const bucketArn = 'arn:aws:s3:::placeholder-bucket';
    await seedResource(orgId, bucketArn, 's3', HOME);
    await pool.query(
      `UPDATE aws_resources SET compliance_issues = '[{"issue":"placeholder earlier finding","severity":"low","category":"tagging","recommendation":"x"}]'::jsonb
        WHERE organization_id = $1 AND resource_arn = $2`,
      [orgId, bucketArn]
    );
    const before = (await pool.query(`SELECT compliance_issues FROM aws_resources WHERE organization_id = $1 AND resource_arn = $2`, [orgId, bucketArn])).rows[0];
    mockAws({ [HOME]: { s3: { '*': never } }, [EU]: { ec2: euInstance } });
    const iam = jest.spyOn(ComplianceScannerService.prototype, 'checkIAMSecurity');

    const started = Date.now();
    await service({ scanDeadlineMs: 3_000 }).discoverAllResources(orgId);

    expect(Date.now() - started).toBeLessThan(20_000);
    expect(await jobRow(orgId)).toMatchObject({
      status: 'completed', error_message: null, compliance_scan_completed: false, cost_analysis_completed: false, warnings: ['scan_deadline'],
    });
    await expectRegionResultsKept(orgId);
    // The bucket's stored findings were not rewritten by a check that did not finish.
    expect((await pool.query(`SELECT compliance_issues FROM aws_resources WHERE organization_id = $1 AND resource_arn = $2`, [orgId, bucketArn])).rows[0]).toEqual(before);
    // Its framework run is closed as failed, not left running.
    expect((await pool.query(`SELECT status FROM framework_evaluation_runs WHERE organization_id = $1`, [orgId])).rows.map((r) => r.status)).not.toContain('running');
    expect(iam).not.toHaveBeenCalled();
    expect(deadlineLog()).toEqual([expect.stringContaining('not started: iam, orphans, cost; stopped: compliance')]);
  }, 60_000);

  // PR 1b review RV-L3: the deadline passes INSIDE compliance's per-resource loop (its
  // S3 reads are done). The loop checks the deadline every 25 resources (with its
  // checkpoint), so the resources it had evaluated keep the results committed for them
  // (one fenced commit each, "its stored results stand", as for any mid-loop failure);
  // the stop falls between two resources, so no resource is left half-written, and
  // nothing after the stop is written. Control V2 (the in-loop check removed) must fail.
  it('RV-L3: the deadline passes inside compliance\'s per-resource loop: results already committed for earlier resources stay; none for the resources after the stop; the job completes', async () => {
    const orgId = await insertOrg();
    // Rows in a region no scan lists (not reconciled by anyone), so exactly these are evaluated.
    const OUTSIDE = 'sa-east-1';
    const MARKER = '[{"issue":"placeholder earlier finding","severity":"low","category":"tagging","recommendation":"x"}]';
    const COUNT = 60;
    for (let i = 0; i < COUNT; i++) {
      await seedResource(orgId, `arn:aws:sqs:${OUTSIDE}:${ACCOUNT}:placeholder-queue-${i}`, 'sqs', OUTSIDE);
    }
    await pool.query(`UPDATE aws_resources SET compliance_issues = $2::jsonb WHERE organization_id = $1`, [orgId, MARKER]);
    // No region lists anything: the 60 rows are the whole inventory the loop evaluates.
    mockAws();
    let now = 1_000_000;
    const realEvaluate = ComplianceScannerService.prototype.evaluateResource;
    let evaluated = 0;
    jest.spyOn(ComplianceScannerService.prototype, 'evaluateResource').mockImplementation(function (this: any, ...args: any[]) {
      // Between the loop's check at 25 resources and its check at 50: the deadline passes.
      if (++evaluated === 30) now += (DEADLINE_MIN + 1) * 60_000;
      return (realEvaluate as any).apply(this, args);
    } as any);
    const iam = jest.spyOn(ComplianceScannerService.prototype, 'checkIAMSecurity');
    const svc = service({ regionPool: 5, scanBudgetMs: 30 * 60_000, scanDeadlineMs: DEADLINE_MIN * 60_000, now: () => now });

    await svc.discoverAllResources(orgId);

    // The loop stopped at its check after the 50th resource: 50 evaluated, none after.
    const { rows } = await pool.query(
      `SELECT count(*) FILTER (WHERE compliance_issues = $2::jsonb)::int AS untouched,
              count(*) FILTER (WHERE compliance_issues <> $2::jsonb)::int AS rewritten
         FROM aws_resources WHERE organization_id = $1 AND status <> 'terminated'`,
      [orgId, MARKER]
    );
    expect(evaluated).toBe(50);
    expect(rows[0]).toEqual({ rewritten: 50, untouched: COUNT - 50 });
    expect(await jobRow(orgId)).toMatchObject({
      status: 'completed', error_message: null, compliance_scan_completed: false, cost_analysis_completed: false, warnings: ['scan_deadline'],
    });
    // The framework run is closed as failed, not left running.
    expect((await pool.query(`SELECT status FROM framework_evaluation_runs WHERE organization_id = $1`, [orgId])).rows.map((r) => r.status)).not.toContain('running');
    expect(iam).not.toHaveBeenCalled();
    expect(deadlineLog()).toEqual([expect.stringContaining('not started: iam, orphans, cost; stopped: compliance')]);
    const regions = await regionRows(orgId);
    for (const region of SCAN_ORDER) expect(regions[region]).toMatchObject({ last_scan_status: 'ok', last_error_code: null });
  }, 60_000);

  it('the cost analysis started but cannot finish: its calls get the deadline\'s signal; nothing it found is stored; its run is interrupted; compliance stays complete', async () => {
    const orgId = await insertOrg();
    mockAws({ [EU]: { ec2: euInstance } });
    let signal: AbortSignal | undefined;
    (costOptimizationService.analyzeAllResources as jest.Mock).mockImplementation(async (_org: string, _ctx: unknown, options: { signal?: AbortSignal } = {}) => {
      signal = options.signal;
      await new Promise((resolve) => options.signal!.addEventListener('abort', resolve));
      return { observations: [], riRecommendations: [], riSucceeded: true, homeRegion: HOME };
    });
    const reconcile = jest.spyOn(CostRecommendationsRepository.prototype, 'reconcileActiveRecommendations');
    const replaceRi = jest.spyOn(CostRecommendationsRepository.prototype, 'replaceReservedInstanceRecommendations');

    await service({ scanDeadlineMs: 3_000 }).discoverAllResources(orgId);

    expect(signal).toBeInstanceOf(AbortSignal);
    expect(reconcile).not.toHaveBeenCalled();
    expect(replaceRi).not.toHaveBeenCalled();
    expect(await jobRow(orgId)).toMatchObject({
      status: 'completed', error_message: null, compliance_scan_completed: true, cost_analysis_completed: false, warnings: ['scan_deadline'],
    });
    expect((await pool.query(`SELECT status FROM cost_analysis_runs WHERE organization_id = $1`, [orgId])).rows).toEqual([{ status: 'interrupted' }]);
    await expectRegionResultsKept(orgId);
    expect(deadlineLog()).toEqual([expect.stringContaining('not started: none; stopped: cost')]);
  }, 60_000);

  it('lease not lost: a hanging step after the regions (IAM) with the lease\'s age limit close behind the deadline: the deadline wins; the job completes and the lease is released', async () => {
    const orgId = await insertOrg();
    mockAws({ [HOME]: { iam: { ListUsersCommand: never } }, [EU]: { ec2: euInstance } });
    const svc = service({ scanDeadlineMs: 3_000 });
    // The lease ages out 6 s after acquisition (the database clock): without the
    // deadline, the hanging IAM call would outlive it and the job would read
    // "another scan took over".
    (svc as any).leaseTiming = { ...FAST, heartbeat: { intervalMs: 200, maxAgeSeconds: 6 } };

    const result = await svc.discoverAllResources(orgId);

    expect(result.errors).toEqual([]);
    const row = await jobRow(orgId);
    expect(row).toMatchObject({ status: 'completed', error_message: null, compliance_scan_completed: false, cost_analysis_completed: false, warnings: ['scan_deadline'] });
    expect(row.warnings).not.toContain('scan_lease_lost');
    const lease = (await pool.query(`SELECT released_at FROM aws_scan_leases WHERE organization_id = $1`, [orgId])).rows;
    expect(lease).toHaveLength(1);
    expect(lease[0].released_at).not.toBeNull();
    await expectRegionResultsKept(orgId);
    expect(deadlineLog()).toEqual([expect.stringContaining('not started: orphans, cost; stopped: iam')]);
  }, 60_000);

  it('a region never runs past the scan deadline: with its full 10 minutes left but the scan deadline 2 s away, it stops at the scan deadline (region_deadline)', async () => {
    const orgId = await insertOrg();
    await seedResource(orgId, queueArn(EU), 'sqs', EU);
    // eu-west-1's RDS listing never answers; its own deadline is a minute away.
    mockAws({ [EU]: { rds: { DescribeDBInstancesCommand: never } } });
    const started = Date.now();
    await service({ regionDeadlineMs: 60_000, scanDeadlineMs: 2_000 }).discoverAllResources(orgId);
    // Stopped at the scan deadline, not after its region deadline.
    expect(Date.now() - started).toBeLessThan(20_000);
    expect((await regionRows(orgId))[EU]).toMatchObject({ last_scan_status: 'timed_out', last_error_code: 'region_deadline' });
    expect(await resource(orgId, queueArn(EU))).toMatchObject({ status: 'active', missing_scan_count: 0 });
    expect(await jobRow(orgId)).toMatchObject({ status: 'completed', error_message: null, warnings: ['region_incomplete', 'scan_deadline'] });
  }, 30_000);

  it('the outcomes stay distinct in one scan: region failure, region_deadline, scan_budget and the post-region timeout each recorded as itself; the job completes', async () => {
    const orgId = await insertOrg();
    let now = 1_000_000;
    const answers = {
      // home: its volume listing hangs until its own deadline (200 ms, real time). (EBS,
      // so no EC2/RDS readiness text, R1, joins the job's error text.)
      [HOME]: { ec2: { DescribeVolumesCommand: never } },
      // ap-south-1: refused.
      'ap-south-1': { fail: () => accessDenied() },
      [EU]: { ec2: euInstance },
    };
    const { log, built } = mockAws(answers);
    // eu-west-1, the third region to start (pool 3), gets its clients after home and
    // ap-south-1 have started theirs: at that moment the scan's clock passes both the
    // budget (no more region starts) and the scan deadline (no step after the regions).
    built.mockImplementation((region: string) => {
      if (region === EU) now += (DEADLINE_MIN + 1) * 60_000;
      return regionClients(log, region, (answers as Record<string, RegionAnswers>)[region]);
    });
    shortDeadlineIn(HOME, 200);
    const svc = service({ regionPool: 3, scanBudgetMs: 30 * 60_000, scanDeadlineMs: DEADLINE_MIN * 60_000, now: () => now });

    const result = await svc.discoverAllResources(orgId);

    const rows = await regionRows(orgId);
    expect(rows[HOME]).toMatchObject({ last_scan_status: 'timed_out', last_error_code: 'region_deadline' });
    expect(rows['ap-south-1']).toMatchObject({ last_scan_status: 'denied', last_error_code: 'access_denied' });
    expect(rows[EU]).toMatchObject({ last_scan_status: 'ok', last_error_code: null });
    for (const region of ['me-central-1', 'us-west-2']) expect(rows[region]).toMatchObject({ last_scan_status: 'timed_out', last_error_code: 'scan_budget' });
    // A region's failure, its deadline and the budget are the regions'; the post-region
    // timeout is the job's warning: none is a job failure, and no lease was lost.
    // (R1, PR 1: the home region's RDS listing, not reached before its deadline, is in the
    // error text for the readiness gate; the job is still completed.)
    const homeRds = 'RDS: REGION_DEADLINE: region us-east-1 ran past its deadline';
    expect(await jobRow(orgId)).toEqual({
      status: 'completed', error_message: homeRds, compliance_scan_completed: false, cost_analysis_completed: false,
      warnings: ['scan_budget', 'region_incomplete', 'scan_deadline'], regions: [HOME, 'ap-south-1', EU],
    });
    expect(result.errors).toEqual([homeRds]);
    expect(await resource(orgId, euInstanceArn)).toMatchObject({ region: EU, status: 'running' });
    // The other two outcomes keep their own record (tests above): a lost lease or a
    // changed connection fails the job with DISCOVERY_INTERRUPTED_MESSAGE / the lease-lost
    // text ("the fence probe at a region boundary"), and a scan with no region checked
    // fails with DISCOVERY_FAILED_MESSAGE ("every region fails").
    expect(DISCOVERY_FAILED_MESSAGE).not.toEqual(DISCOVERY_INTERRUPTED_MESSAGE);
  }, 60_000);
});

// ---------------------------------------------------------------------------
describe('PR 1b item 7: the cost pass\'s own CloudWatch counts are in the home region\'s log line', () => {
  it('the home line (written after the cost pass) carries its GetMetricData metrics and GetMetricStatistics requests; every other region 0', async () => {
    const orgId = await insertOrg();
    const { cost } = mockAws();
    const order: string[] = [];
    cost.mockImplementation(async (_org: string, _ctx: unknown, options: { onCall?: (command: unknown) => void } = {}) => {
      order.push('cost pass');
      // What the cost pass's wrapped clients report for each call (utils/awsCallPolicy.ts onCall).
      options.onCall!(new GetMetricDataCommand({ MetricDataQueries: [{ Id: 'a' }, { Id: 'b' }, { Id: 'c' }] as any, StartTime: new Date(), EndTime: new Date() }));
      options.onCall!(new GetMetricDataCommand({ MetricDataQueries: [{ Id: 'd' }] as any, StartTime: new Date(), EndTime: new Date() }));
      options.onCall!(new GetMetricStatisticsCommand({} as any));
      options.onCall!(new DescribeInstancesCommand({}));
      return { observations: [], riRecommendations: [], riSucceeded: true, homeRegion: HOME };
    });
    (console.log as jest.Mock).mockImplementation((line: unknown) => {
      if (String(line).startsWith('{"event":"discovery_region_scan"')) order.push(JSON.parse(String(line)).region);
    });

    await service().discoverAllResources(orgId);

    const lines = regionLogLines();
    expect(lines.filter((line) => line.region === HOME)).toHaveLength(1);
    expect(lines.find((line) => line.region === HOME)).toMatchObject({ cost_pass_get_metric_data_metrics: 4, cost_pass_get_metric_statistics_requests: 1 });
    for (const line of lines.filter((l) => l.region !== HOME)) {
      expect(line).toMatchObject({ cost_pass_get_metric_data_metrics: 0, cost_pass_get_metric_statistics_requests: 0 });
    }
    // The home line comes after the cost pass; every other region's line before it.
    expect(order[order.length - 1]).toBe(HOME);
    expect(order.indexOf('cost pass')).toBe(order.length - 2);
  }, 60_000);

  it('a scan that stops before its cost pass (a lost lease) still writes the home line, with no cost counts', async () => {
    const orgId = await insertOrg();
    mockAws();
    // The organization's AWS connection changes once the regions are done: the next
    // fenced write after them stops the scan, before the cost pass.
    const realWrite = foundation.recordRegionScanStatus;
    let written = 0;
    jest.spyOn(foundation, 'recordRegionScanStatus').mockImplementation(async (client, lease, scan) => {
      const result = await realWrite(client, lease, scan);
      if (++written === SCAN_ORDER.length) {
        await pool.query(`UPDATE aws_accounts SET role_arn = 'arn:aws:iam::111122223333:role/devcontrol-readonly' WHERE org_id = $1`, [orgId]);
      }
      return result;
    });
    const error = await service().discoverAllResources(orgId).catch((err) => err);
    expect(isLeaseLost(error)).toBe(true);
    expect(costOptimizationService.analyzeAllResources).not.toHaveBeenCalled();
    const home = regionLogLines().filter((line) => line.region === HOME);
    expect(home).toHaveLength(1);
    expect(home[0]).toMatchObject({ outcome: 'ok', cost_pass_get_metric_data_metrics: null, cost_pass_get_metric_statistics_requests: null });
  }, 60_000);

  it('flag off: the cost pass is called exactly as before (two arguments) and no region line is written', async () => {
    const orgId = await insertOrg({ flag: false });
    const { cost } = mockAws();
    await service().discoverAllResources(orgId);
    expect(cost).toHaveBeenCalledTimes(1);
    expect(cost.mock.calls[0]).toHaveLength(2);
    expect(regionLogLines()).toEqual([]);
  }, 30_000);
});

// ---------------------------------------------------------------------------
describe('PR 1b L-3: a region run\'s logs carry no AWS message, account ID or resource name', () => {
  const TABLE = 'placeholder-secret-table';
  const allLogs = () =>
    [console.log, console.error, console.warn].flatMap((fn) => (fn as jest.Mock).mock.calls.map((args) => args.map((a: unknown) => (typeof a === 'string' ? a : JSON.stringify(a ?? null))).join(' ')));
  const answers = (region: string) => ({
    [region]: {
      // A Search refused by an organization policy: AWS's text names the role's ARN (with the account ID).
      explorer: { SearchCommand: () => { throw scpDenied(); } },
    },
    // ap-south-1: a table its search found, whose DescribeTable is refused; its security groups refused too.
    'ap-south-1': {
      explorer: {
        SearchCommand: () => ({
          Resources: [{ Arn: `arn:aws:dynamodb:ap-south-1:${ACCOUNT}:table/${TABLE}`, Region: 'ap-south-1', Service: 'dynamodb', CfnResourceType: 'AWS::DynamoDB::Table', Properties: [] }],
          Count: { TotalResources: 1, Complete: true },
        }),
      },
      dynamodb: { DescribeTableCommand: () => { throw accessDenied(); } },
      ec2: { DescribeSecurityGroupsCommand: () => { throw scpDenied(); } },
      backup: { ListRecoveryPointsByResourceCommand: () => { throw scpDenied(); } },
    },
  });

  it('flag on: refusals in eu-west-1 and ap-south-1 (Search, DescribeTable, security groups) are logged by error name only', async () => {
    const orgId = await insertOrg();
    mockAws(answers(EU));
    await service().discoverAllResources(orgId);
    const logs = allLogs().join('\n');
    expect(logs).toContain('AccessDeniedException');
    expect(logs).not.toContain(ACCOUNT);
    expect(logs).not.toContain('assumed-role');
    expect(logs).not.toContain(TABLE);
    expect(logs).not.toContain('service control policy');
  }, 60_000);

  // PR 1b review RV-L5: every log site L-3 made region-safe, each provoked in eu-west-1
  // (a non-home region run) with an AWS error whose text names the role's ARN (the account
  // ID) and an organization policy, and a resource with a name. The site's own line must
  // be logged (so the case really reaches it), must carry the safe text, and must carry
  // neither the AWS text nor the resource name. Control V4 (the AWS Backup failure line
  // logs the ARN and AWS's text again inside a region run) must fail here.
  describe('RV-L5: every L-3 log site, one at a time', () => {
    const FN = 'placeholder-secret-fn';
    const CLUSTER = 'placeholder-secret-cluster';
    const SG = 'sg-0123456789abcdef0';
    const VOLUME = 'vol-0cccccccccccccccc';
    /** A refusal whose name is not an AccessDenied one: the "any other failure" branches. */
    const otherFailure = () => awsError('InternalFailure', scpDenied().message);
    const instanceWith = (extra: Record<string, unknown> = {}) => ({
      DescribeInstancesCommand: () => ({
        Reservations: [{ Instances: [{ InstanceId: INSTANCE, InstanceType: 't3.micro', State: { Name: 'running' }, ...extra }] }],
      }),
    });
    const found = (arn: string, service: string, cfn: string) => ({
      SearchCommand: () => ({
        Resources: [{ Arn: arn, Region: EU, Service: service, CfnResourceType: cfn, Properties: [] }],
        Count: { TotalResources: 1, Complete: true },
      }),
    });
    const tableArn = `arn:aws:dynamodb:${EU}:${ACCOUNT}:table/${TABLE}`;
    const clusterArn = `arn:aws:rds:${EU}:${ACCOUNT}:cluster:${CLUSTER}`;
    const provisionedTable = {
      DescribeTableCommand: () => ({
        Table: { TableName: TABLE, TableStatus: 'ACTIVE', BillingModeSummary: { BillingMode: 'PROVISIONED' }, ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 } },
      }),
    };

    const sites: Array<{ site: string; line: RegExp; safe: string; secret: string; eu: RegionAnswers }> = [
      {
        site: 'Resource Explorer Search failure (resourceExplorer.service.ts)',
        line: /^\[ResourceExplorer\] Search failed for region eu-west-1:/,
        safe: 'AccessDeniedException',
        secret: 'assumed-role',
        eu: { explorer: { SearchCommand: () => { throw scpDenied(); } } },
      },
      {
        site: 'checkSecurityGroups (complianceScanner.ts)',
        line: /^\[Compliance\] checkSecurityGroups failed/,
        safe: 'AccessDeniedException',
        secret: 'assumed-role',
        eu: { ec2: { DescribeSecurityGroupsCommand: () => { throw scpDenied(); } } },
      },
      {
        site: 'DynamoDB DescribeTable',
        line: /^\[Discovery\] DynamoDB DescribeTable unavailable for a table \(eu-west-1\): unavailable/,
        safe: 'a table',
        secret: TABLE,
        eu: { explorer: found(tableArn, 'dynamodb', 'AWS::DynamoDB::Table'), dynamodb: { DescribeTableCommand: () => { throw scpDenied(); } } },
      },
      {
        site: 'Application Auto Scaling DescribeScalableTargets',
        line: /^\[Discovery\] Application Auto Scaling DescribeScalableTargets unavailable for a table \(eu-west-1\): unavailable/,
        safe: 'a table',
        secret: TABLE,
        eu: {
          explorer: found(tableArn, 'dynamodb', 'AWS::DynamoDB::Table'),
          dynamodb: provisionedTable,
          autoscaling: { DescribeScalableTargetsCommand: () => { throw scpDenied(); } },
        },
      },
      {
        site: 'Aurora enrichment unavailable',
        line: /^\[Discovery\] Aurora cluster enrichment unavailable this cycle: AccessDeniedException/,
        safe: 'AccessDeniedException',
        secret: 'assumed-role',
        eu: { explorer: found(clusterArn, 'rds', 'AWS::RDS::DBCluster'), rds: { DescribeDBClustersCommand: () => { throw scpDenied(); } } },
      },
      {
        site: 'Aurora reclassification (an ARN)',
        line: /^\[Discovery\] Reclassifying a DB cluster out of 'aurora'/,
        safe: 'a DB cluster',
        secret: CLUSTER,
        eu: {
          explorer: found(clusterArn, 'rds', 'AWS::RDS::DBCluster'),
          rds: { DescribeDBClustersCommand: () => ({ DBClusters: [{ DBClusterIdentifier: CLUSTER, Engine: 'mysql', Status: 'available' }] }) },
        },
      },
      {
        site: 'DescribeVolumes (instance volume encryption)',
        line: /^\[Discovery\] DescribeVolumes failed for 1 volume\(s\):/,
        safe: 'AccessDeniedException',
        secret: 'assumed-role',
        eu: {
          ec2: {
            ...instanceWith({ BlockDeviceMappings: [{ DeviceName: '/dev/xvda', Ebs: { VolumeId: VOLUME } }] }),
            // Only the instance's volume lookup is refused; the EBS listing itself answers.
            DescribeVolumesCommand: (input: any) => {
              if (input?.VolumeIds) throw scpDenied();
              return { Volumes: [] };
            },
          },
        },
      },
      {
        site: 'DescribeSecurityGroups (instance exposure)',
        line: /^\[Discovery\] DescribeSecurityGroups failed in eu-west-1; instance exposure recorded as unknown:/,
        safe: 'AccessDeniedException',
        secret: 'assumed-role',
        eu: { ec2: { ...instanceWith({ SecurityGroups: [{ GroupId: SG }] }), DescribeSecurityGroupsCommand: () => { throw scpDenied(); } } },
      },
      {
        site: 'Lambda listing',
        line: /^\[Lambda Discovery\] Error:/,
        safe: 'AccessDeniedException',
        secret: 'assumed-role',
        eu: { lambda: { ListFunctionsCommand: () => { throw scpDenied(); } } },
      },
      {
        site: 'Load balancer listing',
        line: /^\[Load Balancer Discovery\] Error:/,
        safe: 'AccessDeniedException',
        secret: 'assumed-role',
        eu: { elb: { DescribeLoadBalancersCommand: () => { throw scpDenied(); } } },
      },
      {
        site: 'Lambda usage (a function name)',
        line: /^Error fetching CloudWatch usage for Lambda function in this region:/,
        safe: 'AccessDeniedException',
        secret: FN,
        eu: {
          lambda: { ListFunctionsCommand: () => ({ Functions: [{ FunctionName: FN, FunctionArn: `arn:aws:lambda:${EU}:${ACCOUNT}:function:${FN}`, Runtime: 'nodejs20.x', MemorySize: 128 }] }) },
          cloudwatch: { GetMetricStatisticsCommand: () => { throw scpDenied(); } },
        },
      },
      {
        site: 'AWS Backup: access denied (an ARN)',
        line: /^\[AWS Backup\] Access denied checking recovery points for a resource/,
        safe: 'AccessDeniedException',
        secret: INSTANCE,
        eu: { ec2: instanceWith(), backup: { ListRecoveryPointsByResourceCommand: () => { throw scpDenied(); } } },
      },
      {
        site: 'AWS Backup: any other failure (an ARN)',
        line: /^\[AWS Backup\] Failed to check recovery points for a resource:/,
        safe: 'InternalFailure',
        secret: INSTANCE,
        eu: { ec2: instanceWith(), backup: { ListRecoveryPointsByResourceCommand: () => { throw otherFailure(); } } },
      },
      {
        site: 'AWS Backup: page limit (an ARN)',
        line: /^\[AWS Backup\] Recovery points for a resource not fully read \(page limit\)/,
        safe: 'a resource',
        secret: INSTANCE,
        eu: { ec2: instanceWith(), backup: { ListRecoveryPointsByResourceCommand: () => ({ RecoveryPoints: [], NextToken: 'more' }) } },
      },
    ];

    it.each(sites)('$site: logged by its safe text, with no AWS message and no resource name', async ({ line, safe, secret, eu }) => {
      const orgId = await insertOrg();
      mockAws({ [EU]: eu });
      await service().discoverAllResources(orgId);
      const all = [console.log, console.error, console.warn].flatMap((fn) =>
        (fn as jest.Mock).mock.calls.map((args) => args.map((a: unknown) => (typeof a === 'string' ? a : JSON.stringify(a ?? null))).join(' '))
      );
      const siteLines = all.filter((text) => line.test(text));
      // The case reached its site (in eu-west-1's run).
      expect(siteLines.length).toBeGreaterThan(0);
      for (const text of siteLines) {
        expect(text).toContain(safe);
        expect(text).not.toContain(secret);
        expect(text).not.toContain(ACCOUNT);
        expect(text).not.toContain('service control policy');
      }
      // And no line of the scan carries the account ID or AWS's refusal text.
      const logs = all.join('\n');
      expect(logs).not.toContain(ACCOUNT);
      expect(logs).not.toContain('assumed-role');
    }, 60_000);
  });

  it('flag off: the same home Search refusal is logged with AWS\'s text, exactly as before (logs unchanged without the flag)', async () => {
    const orgId = await insertOrg({ flag: false });
    mockAws(answers(HOME));
    await service().discoverAllResources(orgId);
    const searchLine = (console.error as jest.Mock).mock.calls.find((args) => String(args[0]).startsWith('[ResourceExplorer] Search failed for region us-east-1'));
    expect(searchLine).toEqual([`[ResourceExplorer] Search failed for region us-east-1:`, scpDenied().message]);
  }, 30_000);
});

// ---------------------------------------------------------------------------
describe('PR 1b L-4: a home region whose listings never ran still blocks EC2 and RDS readiness', () => {
  const notListed = 'EC2: the home region was not listed on this scan; RDS: the home region was not listed on this scan';
  const gate = (row: { status: string; error_message: string | null }) => (type: 'ec2' | 'rds') =>
    evaluateDiscoveryGate(
      { id: 'j', status: row.status as 'completed' | 'failed', startedAt: new Date(), completedAt: new Date(), resourceTypes: ['ec2', 'rds'], errorMessage: row.error_message },
      type
    ).kind;

  it('home failed before its listings (no connection for its fence probe): fixed EC2/RDS segments; both types blocked; the job completes', async () => {
    const orgId = await insertOrg();
    mockAws();
    const svc = service();
    const realStep = (svc as any).regionDbStep.bind(svc);
    let homeCalls = 0;
    jest.spyOn(svc as any, 'regionDbStep').mockImplementation((org: any, region: any, fn: any) => {
      if (region === HOME && ++homeCalls === 1) return Promise.reject(new Error('timeout exceeded when trying to connect'));
      return realStep(org, region, fn);
    });

    const result = await svc.discoverAllResources(orgId);

    const row = await job(orgId);
    expect(row).toMatchObject({ status: 'completed', error_message: notListed, warnings: ['region_incomplete'] });
    expect(result.errors).toEqual(notListed.split('; '));
    expect((await regionRows(orgId))[HOME]).toMatchObject({ last_scan_status: 'failed', last_error_code: 'error' });
    expect(gate(row)('ec2')).toBe('error');
    expect(gate(row)('rds')).toBe('error');
  }, 60_000);

  it('home never started (the budget was spent before any region): the same fixed segments, beside the failed-scan text', async () => {
    const orgId = await insertOrg();
    mockAws();
    await service({ scanBudgetMs: 0 }).discoverAllResources(orgId);
    const row = await job(orgId);
    expect(row.status).toBe('failed');
    expect(row.error_message).toBe(`${DISCOVERY_FAILED_MESSAGE}; ${notListed}`);
    expect((await regionRows(orgId))[HOME]).toMatchObject({ last_scan_status: 'timed_out', last_error_code: 'scan_budget' });
  }, 60_000);

  it('control: a home region whose listings ran (even past its deadline) keeps its own listing errors, never the fixed text', async () => {
    const orgId = await insertOrg();
    mockAws({ [HOME]: { ec2: { DescribeVolumesCommand: () => new Promise(() => undefined) } } });
    shortDeadlineIn(HOME, 200);
    await service().discoverAllResources(orgId);
    const row = await job(orgId);
    expect(row.error_message).not.toContain('not listed');
    expect(row.error_message).toBe('RDS: REGION_DEADLINE: region us-east-1 ran past its deadline');
  }, 60_000);
});

// ---------------------------------------------------------------------------
describe('PR 2: what a scan records for the coverage API (RR-M2 and scan progress)', () => {
  /** The coverage API's read, on this suite's (superuser) pool: the route's own code. */
  async function coverage(orgId: string) {
    const { readServicesCoverage } = await import('../../routes/services-coverage.routes');
    return readServicesCoverage({ query: (text: string, values?: unknown[]) => pool.query(text, values as any[]) }, orgId);
  }
  const noIndex = { GetIndexCommand: () => { throw awsError('ResourceNotFoundException', 'no index'); } };
  const noView = {
    SearchCommand: () => {
      throw Object.assign(new Error('placeholder unauthorized'), { name: 'UnauthorizedException', $metadata: { httpStatusCode: 401 } });
    },
  };

  it('RR-M2: each Resource Explorer warning is recorded on the region it came from; the coverage API names that region, never the home region', async () => {
    const orgId = await insertOrg();
    mockAws({
      [EU]: { explorer: noIndex },
      'ap-south-1': { explorer: noView },
      // No index AND an EC2 listing cut off: the region is partial, and its one code column
      // holds the truncation; the API must not claim it named every region.
      'me-central-1': { explorer: noIndex, ec2: { DescribeInstancesCommand: () => ({ Reservations: [], NextToken: 'more' }) } },
    });
    await service().discoverAllResources(orgId);

    const rows = await regionRows(orgId);
    expect(rows[HOME]).toMatchObject({ last_scan_status: 'ok', last_error_code: null });
    expect(rows[EU]).toMatchObject({ last_scan_status: 'ok', last_error_code: 'resource_explorer_no_index' });
    expect(rows['ap-south-1']).toMatchObject({ last_scan_status: 'ok', last_error_code: 'resource_explorer_no_view' });
    expect(rows['me-central-1']).toMatchObject({ last_scan_status: 'partial', last_error_code: 'discovery_listing_truncated' });
    expect([...(await job(orgId)).warnings].sort()).toEqual(['discovery_listing_truncated', 'resource_explorer_no_index', 'resource_explorer_no_view']);

    const mr = (await coverage(orgId)).multi_region!;
    expect(mr.region_warnings).toEqual([
      { code: 'resource_explorer_no_view', region: 'ap-south-1' },
      { code: 'resource_explorer_no_index', region: EU },
      { code: 'discovery_listing_truncated', region: 'me-central-1' },
    ]);
    expect(mr.region_warnings_complete).toBe(false);
    expect(mr.region_warnings.some((w) => w.region === HOME)).toBe(false);
  }, 60_000);

  it('RR-M2: a region that failed keeps its own failure code (a Resource Explorer warning never replaces it)', async () => {
    const orgId = await insertOrg();
    mockAws({ [EU]: { explorer: noIndex, rds: { DescribeDBInstancesCommand: () => { throw accessDenied(); } } } });
    await service().discoverAllResources(orgId);
    expect((await regionRows(orgId))[EU]).toMatchObject({ last_scan_status: 'denied', last_error_code: 'access_denied' });
  }, 60_000);

  it('progress from a real scan (one region at a time): home done, ap-south-1 running, the other three waiting; earlier results shown for them', async () => {
    const orgId = await insertOrg();
    // ap-south-1's earlier result: one instance stored before this scan.
    await seedResource(orgId, `arn:aws:ec2:ap-south-1:*:instance/${INSTANCE}`, 'ec2', 'ap-south-1');
    await pool.query(`UPDATE aws_resources SET first_discovered_at = now() - interval '2 days' WHERE organization_id = $1`, [orgId]);
    let apCalled!: () => void;
    const apWaiting = new Promise<void>((resolve) => (apCalled = resolve));
    let releaseAp!: () => void;
    const apReleased = new Promise<void>((resolve) => (releaseAp = resolve));
    mockAws({
      'ap-south-1': {
        ec2: {
          DescribeInstancesCommand: async () => {
            apCalled();
            await apReleased;
            return { Reservations: [] };
          },
        },
      },
    });
    const scanning = service({ regionPool: 1 }).discoverAllResources(orgId);
    await apWaiting;

    const during = (await coverage(orgId)).multi_region!;
    expect(during.progress).toMatchObject({ regions_total: 5, regions_done: 1, regions_running: 1, regions_waiting: 3 });
    expect(during.coverage_status).toBe('in_progress');
    expect(during.scan).toMatchObject({ status: 'running', regions_total: 5, regions_checked: 1 });
    expect(during.regions.map((r) => r.state)).toEqual(['checked', 'in_progress', 'not_started', 'not_started', 'not_started']);
    const state = Object.fromEntries(during.regions.map((r) => [r.region, [r.scan_state, r.result_of]]));
    expect(state).toEqual({
      [HOME]: ['done', 'running_scan'],
      'ap-south-1': ['running', null],
      [EU]: ['waiting', null],
      'me-central-1': ['waiting', null],
      'us-west-2': ['waiting', null],
    });
    // Never scanned before this scan: no result yet, so no count (never a 0).
    expect(during.regions.find((r) => r.region === 'ap-south-1')!.resources).toBeNull();
    // The job's started regions so far.
    expect((await job(orgId)).regions).toEqual([HOME, 'ap-south-1']);

    releaseAp();
    await scanning;
    const after = (await coverage(orgId)).multi_region!;
    expect(after.progress).toBeNull();
    expect(after.regions.map((r) => [r.region, r.scan_state, r.result_of])).toEqual(
      [HOME, ...SCAN_ORDER.filter((r) => r !== HOME).sort()].map((region) => [region, null, 'latest_scan'])
    );
    // Review M-1: the completed scan wrote a checked result for every region it covers.
    expect(after.coverage_status).toBe('all_checked');
    expect(after.scan).toMatchObject({ status: 'completed', regions_total: 5, regions_checked: 5 });
    // At its end the job lists the regions it started, as before PR 2.
    expect((await job(orgId)).regions).toEqual(SCAN_ORDER);
  }, 60_000);

  it('a second scan: a region waiting shows its earlier result and count, not what the running scan has written', async () => {
    const orgId = await insertOrg();
    mockAws({ [EU]: { ec2: { DescribeInstancesCommand: () => ({ Reservations: [{ Instances: [{ InstanceId: INSTANCE, InstanceType: 't3.micro', State: { Name: 'running' } }] }] }) } } });
    await service().discoverAllResources(orgId);
    expect((await coverage(orgId)).multi_region!.regions.find((r) => r.region === EU)).toMatchObject({ status: 'ok', resources: 1 });
    jest.restoreAllMocks();
    quietConsole();

    // Second scan, one region at a time, held at home's EC2 listing: every other region waits.
    let homeCalled!: () => void;
    const homeWaiting = new Promise<void>((resolve) => (homeCalled = resolve));
    let releaseHome!: () => void;
    const homeReleased = new Promise<void>((resolve) => (releaseHome = resolve));
    mockAws({
      [HOME]: { ec2: { DescribeInstancesCommand: async () => { homeCalled(); await homeReleased; return { Reservations: [] }; } } },
      [EU]: { ec2: { DescribeInstancesCommand: () => ({ Reservations: [] }) } },
    });
    const scanning = service({ regionPool: 1 }).discoverAllResources(orgId);
    await homeWaiting;
    const during = (await coverage(orgId)).multi_region!;
    expect(during.progress).toMatchObject({ regions_total: 5, regions_done: 0, regions_running: 1, regions_waiting: 4 });
    expect(during.regions.find((r) => r.region === EU)).toMatchObject({ scan_state: 'waiting', result_of: 'earlier_scan', status: 'ok', resources: 1 });
    releaseHome();
    await scanning;
  }, 60_000);

  it('before any region starts (the S3 listing runs first): every region waiting, none running', async () => {
    const orgId = await insertOrg();
    let s3Called!: () => void;
    const s3Waiting = new Promise<void>((resolve) => (s3Called = resolve));
    let releaseS3!: () => void;
    const s3Released = new Promise<void>((resolve) => (releaseS3 = resolve));
    mockAws({ [HOME]: { s3: { ListBucketsCommand: async () => { s3Called(); await s3Released; return { Buckets: [] }; } } } });
    const scanning = service().discoverAllResources(orgId);
    await s3Waiting;
    // The scan's region list is read during the scan (M5a): stored before S3 runs.
    const during = (await coverage(orgId)).multi_region!;
    expect(during.progress).toMatchObject({ regions_total: 5, regions_done: 0, regions_running: 0, regions_waiting: 5 });
    expect((await job(orgId)).regions).toEqual([]);
    releaseS3();
    await scanning;
    expect((await job(orgId)).regions).toEqual(SCAN_ORDER);
  }, 60_000);

  it('flag off: the job\'s regions are written as before (the home region, at open and at the end); no multi_region key', async () => {
    const orgId = await insertOrg({ flag: false });
    let s3Called!: () => void;
    const s3Waiting = new Promise<void>((resolve) => (s3Called = resolve));
    let releaseS3!: () => void;
    const s3Released = new Promise<void>((resolve) => (releaseS3 = resolve));
    mockAws({ [HOME]: { s3: { ListBucketsCommand: async () => { s3Called(); await s3Released; return { Buckets: [] }; } } } });
    const scanning = service().discoverAllResources(orgId);
    await s3Waiting;
    expect((await job(orgId)).regions).toEqual([HOME]);
    expect(await coverage(orgId)).not.toHaveProperty('multi_region');
    releaseS3();
    await scanning;
    expect((await job(orgId)).regions).toEqual([HOME]);
  }, 30_000);
});

// ---------------------------------------------------------------------------
describe('region-access PR 1: an explicit default view before every Search, and the diagnostic', () => {
  const VIEW = DEFAULT_VIEW.ViewArn;
  /** A Search refusal as AWS words it: the message carries the role ARN and account ID. */
  const searchRefused = () =>
    Object.assign(
      new Error(`User: arn:aws:sts::${ACCOUNT}:assumed-role/devcontrol-readonly/s is not authorized to perform: resource-explorer-2:Search on resource: *`),
      { name: 'AccessDeniedException', $metadata: { httpStatusCode: 403 } }
    );
  /** Index ACTIVE, GetDefaultView answering 200 with no ViewArn: the founder's eu-central-1. */
  const noDefaultView = { GetDefaultViewCommand: () => ({}) };
  const viewRefused = { GetDefaultViewCommand: () => { throw searchRefused(); } };
  const indexRefused = { GetIndexCommand: () => { throw searchRefused(); } };

  /** A Search answer that records each Search's input. */
  function recordingSearch(inputs: unknown[], resources: unknown[] = []) {
    return {
      SearchCommand: (input: unknown) => {
        inputs.push(input);
        return { Resources: resources, Count: { TotalResources: resources.length, Complete: true } };
      },
    };
  }
  const queueResource = (region: string) => ({ Arn: queueArn(region), Region: region, Service: 'sqs', CfnResourceType: 'AWS::SQS::Queue', Properties: [{ Name: 'tags', Data: [] }] });
  const loggedText = () =>
    JSON.stringify([...(console.error as jest.Mock).mock.calls, ...(console.warn as jest.Mock).mock.calls, ...(console.log as jest.Mock).mock.calls]);
  const reLines = () =>
    [...(console.error as jest.Mock).mock.calls, ...(console.warn as jest.Mock).mock.calls]
      .map((args) => args.map(String).join(' '))
      .filter((line) => /Resource ?Explorer/.test(line));

  it('flag on: index + default view: every Search is sent WITH that ViewArn after GetDefaultView; resources inventoried; region ok, message NULL', async () => {
    const orgId = await insertOrg();
    const inputs: unknown[] = [];
    const { log } = mockAws({ [EU]: { explorer: recordingSearch(inputs, [queueResource(EU)]) } });
    await service().discoverAllResources(orgId);
    expect(inputs).toEqual([{ ViewArn: VIEW, QueryString: '' }]);
    const eu = log.filter((call) => call.region === EU && call.client === 'resource-explorer-2').map((call) => call.command);
    expect(eu).toEqual(['GetIndexCommand', 'GetDefaultViewCommand', 'SearchCommand']);
    expect(log.filter((call) => call.command === 'SearchCommand')).toHaveLength(SCAN_ORDER.length);
    expect(log.filter((call) => call.command === 'GetDefaultViewCommand')).toHaveLength(SCAN_ORDER.length);
    expect(await resource(orgId, queueArn(EU))).toMatchObject({ region: EU, missing_scan_count: 0 });
    expect((await regionRows(orgId))[EU]).toMatchObject({ last_scan_status: 'ok', last_error_code: null, last_error_message: null });
  }, 60_000);

  it('flag off: index + default view: the home Search is sent WITH the ViewArn; resources inventoried; the job completes', async () => {
    const orgId = await insertOrg({ flag: false });
    const inputs: unknown[] = [];
    mockAws({ [HOME]: { explorer: recordingSearch(inputs, [queueResource(HOME)]) } });
    await service().discoverAllResources(orgId);
    expect(inputs).toEqual([{ ViewArn: VIEW, QueryString: '' }]);
    expect(await resource(orgId, queueArn(HOME))).toMatchObject({ region: HOME, missing_scan_count: 0 });
    expect(await job(orgId)).toEqual({ status: 'completed', error_message: null, warnings: null, regions: [HOME] });
  }, 30_000);

  it('flag on: index + no default view: no Search there, the existing no-view warning and code, region ok (NOT denied); the job completes', async () => {
    const orgId = await insertOrg();
    await seedResource(orgId, queueArn(EU), 'sqs', EU);
    const { log } = mockAws({ [EU]: { explorer: noDefaultView } });
    await service().discoverAllResources(orgId);
    expect(log.filter((call) => call.region === EU && call.command === 'SearchCommand')).toEqual([]);
    expect((await regionRows(orgId))[EU]).toMatchObject({
      last_scan_status: 'ok', last_error_code: 'resource_explorer_no_view', last_error_message: null, consecutive_failures: 0,
    });
    for (const command of ['DescribeInstancesCommand', 'DescribeVolumesCommand', 'DescribeDBInstancesCommand', 'ListFunctionsCommand', 'DescribeLoadBalancersCommand']) {
      expect(log.filter((call) => call.region === EU && call.command === command)).toHaveLength(1);
    }
    expect(await job(orgId)).toEqual({ status: 'completed', error_message: null, warnings: ['resource_explorer_no_view'], regions: SCAN_ORDER });
    expect(await resource(orgId, queueArn(EU))).toMatchObject({ status: 'active', missing_scan_count: 0 });
    expect(regionLogLines().find((line) => line.region === EU)).toMatchObject({ outcome: 'ok', reason: 'resource_explorer_no_view', diagnostic: null });
  }, 60_000);

  it('flag off: home index + no default view: no Search, the warning, home ok, the scan completes (not failed)', async () => {
    const orgId = await insertOrg({ flag: false });
    await seedResource(orgId, queueArn(HOME), 'sqs', HOME);
    const { log } = mockAws({ [HOME]: { explorer: noDefaultView } });
    const result = await service().discoverAllResources(orgId);
    expect(log.filter((call) => call.command === 'SearchCommand')).toEqual([]);
    expect(log.filter((call) => call.command === 'GetDefaultViewCommand')).toHaveLength(1);
    expect((await regionRows(orgId))[HOME]).toMatchObject({ last_scan_status: 'ok', last_error_code: null, last_error_message: null });
    expect(await job(orgId)).toEqual({ status: 'completed', error_message: null, warnings: ['resource_explorer_no_view'], regions: [HOME] });
    expect(result.errors).toEqual([]);
    expect(await resource(orgId, queueArn(HOME))).toMatchObject({ status: 'active', missing_scan_count: 0 });
  }, 30_000);

  it('flag on: index + default view + Search 403: still denied/access_denied (a real refusal); message = the diagnostic only; nothing reconciled', async () => {
    const orgId = await insertOrg();
    await seedResource(orgId, queueArn(EU), 'sqs', EU);
    const inputs: unknown[] = [];
    mockAws({ [EU]: { explorer: { SearchCommand: (input: unknown) => { inputs.push(input); throw searchRefused(); } } } });
    await service().discoverAllResources(orgId);
    expect(inputs).toEqual([{ ViewArn: VIEW, QueryString: '' }]);
    const row = (await regionRows(orgId))[EU];
    expect(row).toMatchObject({ last_scan_status: 'denied', last_error_code: 'access_denied', last_error_message: 'resource-explorer:Search:AccessDeniedException' });
    expect(row.last_error_message).not.toMatch(/[0-9]{12}|arn:|not authorized/);
    expect(regionLogLines().find((line) => line.region === EU)).toMatchObject({ outcome: 'denied', reason: 'access_denied', diagnostic: 'resource-explorer:Search:AccessDeniedException' });
    expect(reLines()).toContain(
      '❌ [Discovery] Resource Explorer search failed, skipping generic inventory + reconciliation: eu-west-1 (access_denied, resource-explorer:Search:AccessDeniedException)'
    );
    // Inside the region run nothing logs the AWS text or the account ID.
    expect(reLines().join('\n')).not.toMatch(new RegExp(`${ACCOUNT}|not authorized`));
    expect(await resource(orgId, queueArn(EU))).toMatchObject({ status: 'active', missing_scan_count: 0 });
  }, 60_000);

  it('flag off: home Search 403 with the view: the source is denied and the job fails, as before; no code, so no message', async () => {
    const orgId = await insertOrg({ flag: false });
    mockAws({ [HOME]: { explorer: { SearchCommand: () => { throw searchRefused(); } } } });
    await service().discoverAllResources(orgId);
    expect((await job(orgId)).status).toBe('failed');
    expect((await regionRows(orgId))[HOME]).toMatchObject({ last_scan_status: 'denied', last_error_code: null, last_error_message: null });
  }, 30_000);

  it('flag on: GetDefaultView refused (403) is classified by the existing rule (denied), never "no view"; no Search; message names GetDefaultView', async () => {
    const orgId = await insertOrg();
    const { log } = mockAws({ [EU]: { explorer: viewRefused } });
    const result = await service().discoverAllResources(orgId);
    expect(log.filter((call) => call.region === EU && call.command === 'SearchCommand')).toEqual([]);
    expect((await regionRows(orgId))[EU]).toMatchObject({
      last_scan_status: 'denied', last_error_code: 'access_denied', last_error_message: 'resource-explorer:GetDefaultView:AccessDeniedException',
    });
    expect(result.warnings).not.toContain('resource_explorer_no_view');
  }, 60_000);

  it('flag on: GetDefaultView throttled is that region\'s timed_out/throttled, not "no view"', async () => {
    const orgId = await insertOrg();
    mockAws({ [EU]: { explorer: { GetDefaultViewCommand: () => { throw awsError('ThrottlingException', 'Rate exceeded'); } } } });
    const result = await service().discoverAllResources(orgId);
    expect((await regionRows(orgId))[EU]).toMatchObject({
      last_scan_status: 'timed_out', last_error_code: 'throttled', last_error_message: 'resource-explorer:GetDefaultView:ThrottlingException',
    });
    expect(result.warnings).not.toContain('resource_explorer_no_view');
  }, 60_000);

  it('flag off: home GetDefaultView refused fails the source and the job as a failed Search does (never "no view")', async () => {
    const orgId = await insertOrg({ flag: false });
    const { log } = mockAws({ [HOME]: { explorer: viewRefused } });
    const result = await service().discoverAllResources(orgId);
    expect(log.filter((call) => call.command === 'SearchCommand')).toEqual([]);
    expect((await job(orgId)).status).toBe('failed');
    expect((await regionRows(orgId))[HOME].last_scan_status).toBe('denied');
    expect(result.warnings).not.toContain('resource_explorer_no_view');
  }, 30_000);

  it('flag on: GetIndex refused: message names GetIndex; neither GetDefaultView nor Search is called', async () => {
    const orgId = await insertOrg();
    const { log } = mockAws({ [EU]: { explorer: indexRefused } });
    await service().discoverAllResources(orgId);
    expect(log.filter((call) => call.region === EU && call.client === 'resource-explorer-2').map((call) => call.command)).toEqual(['GetIndexCommand']);
    expect((await regionRows(orgId))[EU]).toMatchObject({
      last_scan_status: 'denied', last_error_code: 'access_denied', last_error_message: 'resource-explorer:GetIndex:AccessDeniedException',
    });
  }, 60_000);

  it('no index: unchanged (no GetDefaultView, no Search, the no-index warning), flag on and off', async () => {
    const noIndex = { GetIndexCommand: () => { throw awsError('ResourceNotFoundException', 'no index'); } };
    for (const flag of [true, false]) {
      const orgId = await insertOrg({ flag });
      const region = flag ? EU : HOME;
      const { log } = mockAws({ [region]: { explorer: noIndex } });
      await service().discoverAllResources(orgId);
      expect(log.filter((call) => call.region === region && call.client === 'resource-explorer-2').map((call) => call.command)).toEqual(['GetIndexCommand']);
      expect((await job(orgId)).warnings).toEqual(['resource_explorer_no_index']);
      jest.restoreAllMocks();
      quietConsole();
    }
  }, 60_000);

  it('last_error_message is cleared by the next successful scan of the region', async () => {
    const orgId = await insertOrg();
    mockAws({ [EU]: { explorer: { SearchCommand: () => { throw searchRefused(); } } } });
    await service().discoverAllResources(orgId);
    expect((await regionRows(orgId))[EU].last_error_message).toBe('resource-explorer:Search:AccessDeniedException');
    jest.restoreAllMocks();
    quietConsole();
    mockAws();
    await service().discoverAllResources(orgId);
    expect((await regionRows(orgId))[EU]).toMatchObject({ last_scan_status: 'ok', last_error_code: null, last_error_message: null });
  }, 90_000);

  it('no row of any region ever holds AWS text, an ARN or a 12-digit number in last_error_message', async () => {
    const orgId = await insertOrg();
    mockAws({
      [EU]: { explorer: { SearchCommand: () => { throw searchRefused(); } } },
      'ap-south-1': { explorer: viewRefused },
      'us-west-2': { explorer: indexRefused },
      'me-central-1': { ec2: { DescribeInstancesCommand: () => { throw accessDenied(); } } },
    });
    await service().discoverAllResources(orgId);
    const rows = Object.values(await regionRows(orgId));
    for (const row of rows) {
      if (row.last_error_message !== null) expect(row.last_error_message).toMatch(/^resource-explorer:(GetIndex|GetDefaultView|Search):[A-Za-z]+$/);
    }
    expect(rows.filter((row) => row.last_error_message !== null)).toHaveLength(3);
    // A listing refusal has no known call: its code, no message.
    expect((await regionRows(orgId))['me-central-1']).toMatchObject({ last_scan_status: 'denied', last_error_code: 'access_denied', last_error_message: null });
    expect(loggedText()).not.toContain('resource-explorer:Search:User');
  }, 90_000);
});
