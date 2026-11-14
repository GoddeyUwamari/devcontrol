/**
 * Multi-region PR 1, flag OFF: the observable discovery contract, pinned.
 *
 * The per-organization flag multi_region_discovery is off unless a row turns it
 * on (organization_feature_flags). With it off, a scan must keep doing exactly
 * what it did before PR 1: the same regions scanned (the home region, plus S3
 * in every bucket's region and CloudFront globally), the same global work, the
 * same resource writes and reconciliation rules, the same job outcome and
 * warnings. This file records all of that for three scans over fixed fake
 * clients, as one snapshot:
 *
 *   1. a starter-tier scan over every listing (EC2, EBS, RDS, S3 in two regions,
 *      Lambda, a load balancer, CloudFront, Resource Explorer, security groups);
 *   2. the same account a scan later, with an instance and a queue gone, so the
 *      reconciliation increments;
 *   3. a scan whose RDS listing is denied and whose CloudFront listing times out.
 *
 * Recorded per scan: every AWS call (client, region, command, input) as a
 * multiset, the order the scan's steps first reach AWS in, every reconcile()
 * call, the cost analysis calls, and what the
 * scan left in the database (resources, job, region rows, security findings,
 * cost runs). Ids and times are replaced by placeholders; nothing else is.
 *
 * The snapshot was first written against the code BEFORE PR 1 (commit "test:
 * pin the flag-off discovery contract"). Any later difference is a change to the
 * flag-off contract and must be explained where the snapshot changes.
 *
 * Real Postgres; AWS clients are fakes (no AWS call is made). Placeholders only.
 */
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { AWSResourceDiscoveryService } from '../awsResourceDiscovery';
import { AWSClientFactory } from '../aws-client-factory.service';
import costOptimizationService from '../cost-optimization.service';
import { LeaseTiming } from '../scan-session';
import { AwsCallTimeoutError } from '../../utils/awsCallPolicy';
import { connectPlaceholderAccount, removePlaceholderAccounts, stubScanSource, PLACEHOLDER_ACCOUNT_ROW } from './helpers/scan-source';

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
const EU = 'eu-west-1';
const FAST: LeaseTiming = { heartbeat: { intervalMs: 200 }, pollMs: 50, acquireLockTimeoutMs: 15_000 };
const createdOrgIds: string[] = [];

const REGIONS_FIXTURE: { Regions: Array<{ RegionName: string; OptInStatus: string }> } = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures/describe-regions.json'), 'utf8')
);

// Placeholder identifiers only (see config/__tests__/aws-account-id-literals.test.ts).
const INSTANCE_A = 'i-0aaaaaaaaaaaaaaaa';
const INSTANCE_B = 'i-0bbbbbbbbbbbbbbbb';
const VOLUME = 'vol-0cccccccccccccccc';
const GROUP = 'sg-0123456789abcdef0';
const VPC_ARN = `arn:aws:ec2:${HOME}:${ACCOUNT}:vpc/vpc-00000001`;
const QUEUE_ARN = `arn:aws:sqs:${HOME}:${ACCOUNT}:placeholder-queue`;
const FUNCTION_ARN = `arn:aws:lambda:${HOME}:${ACCOUNT}:function:placeholder-fn`;
const DB_ARN = `arn:aws:rds:${HOME}:${ACCOUNT}:db:placeholder-db`;
const LB_ARN = `arn:aws:elasticloadbalancing:${HOME}:${ACCOUNT}:loadbalancer/app/placeholder-lb/0000000000000001`;
const INDEX_ARN = `arn:aws:resource-explorer-2:${HOME}:${ACCOUNT}:index/00000000-0000-4000-8000-00000000000b`;
const LAUNCHED = new Date('2026-01-01T00:00:00Z');

interface Call {
  client: string;
  region: string;
  command: string;
  input: unknown;
}

type Answer = (input: any) => any;

const throwing = (error: Error): Answer => () => {
  throw error;
};
const denied = () =>
  Object.assign(new Error(`User: arn:aws:sts::${ACCOUNT}:assumed-role/devcontrol-readonly/s is not authorized`), { name: 'UnauthorizedOperation' });

/** A fake client answering by command name into one shared, ordered call log; anything unlisted fails at once. */
function fake(log: Call[], client: string, region: string, answers: Record<string, Answer>) {
  return {
    send: jest.fn(async (command: { constructor: { name: string }; input?: any }) => {
      log.push({ client, region, command: command.constructor.name, input: command.input ?? {} });
      const answer = answers[command.constructor.name];
      if (!answer) throw Object.assign(new Error(`Unexpected ${command.constructor.name}`), { name: 'Unexpected' });
      return answer(command.input ?? {});
    }),
  };
}

interface Scenario {
  instances: string[];
  explorerArns: string[];
  rds?: Answer;
  cloudFront?: Answer;
}

const FULL: Scenario = { instances: [INSTANCE_A, INSTANCE_B], explorerArns: [VPC_ARN, QUEUE_ARN, `arn:aws:ec2:${HOME}:${ACCOUNT}:instance/${INSTANCE_A}`] };
const LATER: Scenario = { instances: [INSTANCE_A], explorerArns: [VPC_ARN, `arn:aws:ec2:${HOME}:${ACCOUNT}:instance/${INSTANCE_A}`] };
const FAILING: Scenario = {
  ...FULL,
  rds: throwing(denied()),
  cloudFront: throwing(new AwsCallTimeoutError(15_000)),
};

const CFN_TYPE: Record<string, string> = { vpc: 'AWS::EC2::VPC', sqs: 'AWS::SQS::Queue', instance: 'AWS::EC2::Instance' };

function explorerResource(arn: string) {
  const kind = arn.includes(':sqs:') ? 'sqs' : arn.includes(':vpc/') ? 'vpc' : 'instance';
  return {
    Arn: arn,
    Region: arn.split(':')[3],
    Service: arn.split(':')[2],
    CfnResourceType: CFN_TYPE[kind],
    Properties: [{ Name: 'tags', Data: [{ Key: 'Owner', Value: 'platform' }] }],
  };
}

function instance(id: string) {
  const running = id === INSTANCE_A;
  return {
    InstanceId: id,
    InstanceType: 't3.micro',
    State: { Name: running ? 'running' : 'stopped' },
    LaunchTime: LAUNCHED,
    Placement: { AvailabilityZone: `${HOME}a` },
    VpcId: 'vpc-00000001',
    PublicIpAddress: running ? '192.0.2.10' : undefined,
    SecurityGroups: [{ GroupId: GROUP }],
    BlockDeviceMappings: running ? [{ DeviceName: '/dev/xvda', Ebs: { VolumeId: VOLUME } }] : [],
    Tags: [{ Key: 'Name', Value: `placeholder-${running ? 'web' : 'batch'}` }, { Key: 'Owner', Value: 'platform' }],
  };
}

/** The scan's fake clients for one scenario; every call lands in `log`. */
function mockAwsClients(log: Call[], scenario: Scenario) {
  stubScanSource();
  const ec2 = fake(log, 'ec2', HOME, {
    DescribeRegionsCommand: () => ({ Regions: REGIONS_FIXTURE.Regions.map((r) => ({ ...r })) }),
    DescribeInstancesCommand: () => ({ Reservations: [{ Instances: scenario.instances.map(instance) }] }),
    DescribeVolumesCommand: (input) =>
      input.VolumeIds
        ? { Volumes: [{ VolumeId: VOLUME, Encrypted: true }] }
        : {
            Volumes: [
              {
                VolumeId: VOLUME,
                VolumeType: 'gp2',
                Size: 20,
                State: 'in-use',
                Encrypted: true,
                AvailabilityZone: `${HOME}a`,
                Attachments: [{ InstanceId: INSTANCE_A, State: 'attached' }],
                Tags: [{ Key: 'Owner', Value: 'platform' }],
              },
            ],
          },
    DescribeSecurityGroupsCommand: () => ({
      SecurityGroups: [
        {
          GroupId: GROUP,
          GroupName: 'placeholder-web',
          VpcId: 'vpc-00000001',
          IpPermissions: [{ IpProtocol: 'tcp', FromPort: 22, ToPort: 22, IpRanges: [{ CidrIp: '0.0.0.0/0' }] }],
        },
      ],
    }),
  });
  const rds = fake(log, 'rds', HOME, {
    DescribeDBInstancesCommand:
      scenario.rds ??
      (() => ({
        DBInstances: [
          {
            DBInstanceIdentifier: 'placeholder-db',
            DBInstanceArn: DB_ARN,
            DBInstanceClass: 'db.t3.micro',
            Engine: 'postgres',
            EngineVersion: '15.4',
            DBInstanceStatus: 'available',
            StorageEncrypted: true,
            PubliclyAccessible: false,
            BackupRetentionPeriod: 7,
            TagList: [{ Key: 'Owner', Value: 'data' }],
          },
        ],
      })),
    DescribeDBClustersCommand: () => ({ DBClusters: [] }),
  });
  const s3Answers: Record<string, Answer> = {
    ListBucketsCommand: () => ({
      Buckets: [
        { Name: 'placeholder-bucket-home', CreationDate: LAUNCHED },
        { Name: 'placeholder-bucket-eu', CreationDate: LAUNCHED },
      ],
    }),
    GetBucketLocationCommand: (input) => ({ LocationConstraint: input.Bucket === 'placeholder-bucket-eu' ? EU : undefined }),
    GetBucketTaggingCommand: () => ({ TagSet: [{ Key: 'Owner', Value: 'platform' }] }),
    GetBucketEncryptionCommand: () => ({
      ServerSideEncryptionConfiguration: { Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] },
    }),
  };
  const s3 = fake(log, 's3', HOME, s3Answers);
  const s3Eu = fake(log, 's3', EU, s3Answers);
  const s3Control = fake(log, 's3-control', HOME, {});
  const lambda = fake(log, 'lambda', HOME, {
    ListFunctionsCommand: () => ({
      Functions: [{ FunctionName: 'placeholder-fn', FunctionArn: FUNCTION_ARN, Runtime: 'nodejs20.x', MemorySize: 128, Timeout: 3 }],
    }),
    ListTagsCommand: () => ({ Tags: { Owner: 'platform' } }),
  });
  const cloudWatch = fake(log, 'cloudwatch', HOME, {
    GetMetricStatisticsCommand: (input) => ({ Datapoints: [{ Sum: input.MetricName === 'Invocations' ? 1000 : 50_000, Average: 50 }] }),
  });
  const elb = fake(log, 'elbv2', HOME, {
    DescribeLoadBalancersCommand: () => ({
      LoadBalancers: [{ LoadBalancerArn: LB_ARN, LoadBalancerName: 'placeholder-lb', Type: 'application', Scheme: 'internet-facing', State: { Code: 'active' } }],
    }),
    DescribeTagsCommand: () => ({ TagDescriptions: [{ ResourceArn: LB_ARN, Tags: [{ Key: 'Owner', Value: 'platform' }] }] }),
  });
  const cloudFront = fake(log, 'cloudfront', 'us-east-1', {
    ListDistributionsCommand:
      scenario.cloudFront ??
      (() => ({
        DistributionList: {
          Items: [{ Id: 'E000000000000A', ARN: `arn:aws:cloudfront::${ACCOUNT}:distribution/E000000000000A`, DomainName: 'd000000000000a.cloudfront.net', Status: 'Deployed', Enabled: true }],
        },
      })),
  });
  const iam = fake(log, 'iam', 'us-east-1', { ListUsersCommand: () => ({ Users: [] }) });
  const backup = fake(log, 'backup', HOME, { ListRecoveryPointsByResourceCommand: () => ({ RecoveryPoints: [] }) });
  const resourceExplorer = fake(log, 'resource-explorer-2', HOME, {
    GetIndexCommand: () => ({ Arn: INDEX_ARN, Type: 'LOCAL', State: 'ACTIVE' }),
    SearchCommand: () => ({ Resources: scenario.explorerArns.map(explorerResource), Count: { TotalResources: scenario.explorerArns.length, Complete: true } }),
  });
  const dynamodb = fake(log, 'dynamodb', HOME, {});

  jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue({
    enabled: true,
    region: HOME,
    accountId: ACCOUNT,
    costExplorer: {},
    ec2,
    rds,
    s3,
    s3Control,
    cloudWatch,
    lambda,
    ecs: {},
    elb,
    eks: {},
    dynamodb,
    cloudFront,
    apiGateway: {},
    elastiCache: {},
    sqs: {},
    sns: {},
    iam,
    backup,
    securityHub: {},
    resourceExplorer,
    getDynamoDBClientForRegion: () => dynamodb,
    getApplicationAutoScalingClientForRegion: () => ({}),
    getCloudWatchClientForRegion: () => cloudWatch,
    getS3ClientForRegion: (region: string) => (region === EU ? s3Eu : s3),
  } as any);
  return jest
    .spyOn(costOptimizationService, 'analyzeAllResources')
    .mockResolvedValue({ observations: [], riRecommendations: [], riSucceeded: true, homeRegion: HOME });
}

async function insertOrg(): Promise<string> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $3, 'starter', 'active') RETURNING id`,
    [`MR Contract Org ${suffix}`, `mr-contract-org-${suffix}`, `MR Contract Org ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  await connectPlaceholderAccount(pool, rows[0].id);
  return rows[0].id;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const ISO_TIME = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})/g;

/** Ids and times become placeholders, so the snapshot holds what a scan decides and nothing that differs run to run. */
function normalize(value: unknown, orgId: string): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, v) => (v instanceof Date ? '<time>' : v))
      .split(orgId)
      .join('<org>')
      .replace(UUID, '<uuid>')
      .replace(ISO_TIME, '<time>')
  );
}

async function footprint(orgId: string) {
  const q = async (sql: string) => (await pool.query(sql, [orgId])).rows;
  return {
    resources: await q(
      `SELECT resource_arn, resource_id, resource_name, resource_type, region, status, missing_scan_count, is_encrypted, is_public, has_backup,
              estimated_monthly_cost, tags, metadata, compliance_issues, is_orphaned, orphaned_monthly_savings
         FROM aws_resources WHERE organization_id = $1 ORDER BY resource_arn`
    ),
    jobs: await q(
      `SELECT status, error_message, to_jsonb(j) -> 'warnings' AS warnings, resources_discovered, resources_updated, resources_deleted,
              compliance_scan_completed, cost_analysis_completed, resource_types, regions
         FROM resource_discovery_jobs j WHERE organization_id = $1 ORDER BY created_at`
    ),
    regions: await q(
      `SELECT region, enabled, opt_in_status, last_scan_status, last_error_code, consecutive_failures, last_success_at IS NOT NULL AS succeeded
         FROM aws_account_regions WHERE organization_id = $1 ORDER BY region`
    ),
    findings: await q(
      `SELECT finding_key, category, severity, status, region, resource_identifier FROM account_security_findings WHERE organization_id = $1 ORDER BY finding_key`
    ),
    costRuns: await q(`SELECT status, source FROM cost_analysis_runs WHERE organization_id = $1 ORDER BY created_at`),
    lease: await q(`SELECT scan_kind, aws_account_id, released_at IS NOT NULL AS released FROM aws_scan_leases WHERE organization_id = $1`),
  };
}

/** One scan: its calls, reconciles, cost calls, result and what it left in the database. */
async function recordScan(orgId: string, scenario: Scenario) {
  const log: Call[] = [];
  const cost = mockAwsClients(log, scenario);
  const svc = new AWSResourceDiscoveryService(pool);
  (svc as any).leaseTiming = FAST;
  const reconciliation = (svc as any).reconciliation;
  const realReconcile = reconciliation.reconcile.bind(reconciliation);
  const reconciles: unknown[] = [];
  jest.spyOn(reconciliation, 'reconcile').mockImplementation(async (...args: any[]) => {
    const [, , region, present, types] = args;
    reconciles.push({ region, present: [...present].sort(), types: [...types].sort() });
    return realReconcile(...args);
  });

  const result = await svc.discoverAllResources(orgId);

  const recorded = {
    // Every call with its input, as a multiset: the compliance pass reads its S3 rows
    // without an ORDER BY and evaluates buckets concurrently, so the interleaving of
    // two buckets' calls differs run to run (it did before PR 1 too).
    calls: [...log].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    // The order the scan's steps first reach AWS in, which is deterministic.
    order: [...new Set(log.map((call) => `${call.client}:${call.command}`))],
    reconciles,
    costCalls: cost.mock.calls.map(([org, context]) => ({ org, contextRegion: (context as any)?.region })),
    result: { ...result, job_id: '<job>' },
    database: await footprint(orgId),
  };
  jest.restoreAllMocks();
  quietConsole();
  return normalize(recorded, orgId);
}

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

describe('flag OFF: the discovery contract before multi-region scanning', () => {
  it('a full scan, the same account a scan later, and a scan with failing listings', async () => {
    const orgId = await insertOrg();
    const first = await recordScan(orgId, FULL);
    const later = await recordScan(orgId, LATER);
    const failingOrg = await insertOrg();
    const failing = await recordScan(failingOrg, FAILING);

    expect({ first, later, failing }).toMatchSnapshot();
  }, 60_000);

  it('a flag row that says OFF (enabled = false) records exactly the scan no row records', async () => {
    const withoutRow = await insertOrg();
    const withRow = await insertOrg();
    await pool.query(
      `INSERT INTO organization_feature_flags (organization_id, flag, enabled, set_by, note) VALUES ($1, 'multi_region_discovery', false, 'test', 'test')`,
      [withRow]
    );
    expect(await recordScan(withRow, FULL)).toEqual(await recordScan(withoutRow, FULL));
  }, 60_000);
});
