/**
 * Home region HR-1, T1 and T6.
 *
 * T1, a home region other than us-east-1, end to end through a discovery scan
 * (multi-region flag off): the region list is read and recorded with the
 * us-west-2 clients, the regional listings run in us-west-2 only, the home
 * region's status row is us-west-2's, the job names us-west-2, the cost pass runs
 * on the us-west-2 scan context and its reconcile is limited to us-west-2 (an
 * old us-east-1 row is not this scan's to touch: the change endpoint removes
 * those, D.2). Covered elsewhere for a non-us-east-1 home and not repeated here:
 * STS pinned to us-east-1 (scan-context.test.ts, HR-D10), the coverage API's
 * home_region (services-coverage.test.ts), alarms after a home region change
 * (cloudwatch-alarms.service.test.ts), the AI inventory scope
 * (ai-chat-cost-context-contract.test.ts).
 *
 * T6, no scan path writes the home region: a full scan with the flag off AND on
 * leaves the aws_accounts row byte-identical; statically, the only statements in
 * the application that write aws_accounts are the connect INSERT and the home
 * region change's UPDATE of `region` alone.
 *
 * Real Postgres; AWS clients are fakes (no AWS call is made). Placeholders only.
 */
import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';
import { AWSResourceDiscoveryService } from '../awsResourceDiscovery';
import { AWSClientFactory } from '../aws-client-factory.service';
import costOptimizationService from '../cost-optimization.service';
import { LeaseTiming, isScanAlreadyRunning } from '../scan-session';
import { DEFAULT_AWS_CALL_POLICY } from '../../utils/awsCallPolicy';
import { ISSUE_EC2_IDLE_INSTANCE } from '../../config/optimization-rules';
import { ACTIVE_INDEX, PLACEHOLDER_ACCOUNT_ROW, connectPlaceholderAccount, refreshPlaceholderAccount, removePlaceholderAccounts, stubScanSource } from './helpers/scan-source';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'platform_portal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});
const ACCOUNT = PLACEHOLDER_ACCOUNT_ROW.account_id!;
const HOME = 'us-west-2';
const FAST: LeaseTiming = { heartbeat: { intervalMs: 200 }, pollMs: 50, acquireLockTimeoutMs: 15_000 };
const createdOrgIds: string[] = [];

const REGION_LIST = {
  Regions: [
    { RegionName: 'us-east-1', OptInStatus: 'opt-in-not-required' },
    { RegionName: 'us-west-2', OptInStatus: 'opt-in-not-required' },
    { RegionName: 'eu-west-1', OptInStatus: 'opt-in-not-required' },
  ],
};

interface Call { region: string; client: string; command: string }

function fake(log: Call[], region: string, client: string, answers: Record<string, (input: any) => any>) {
  return {
    send: jest.fn(async (command: { constructor: { name: string }; input?: any }) => {
      log.push({ region, client, command: command.constructor.name });
      const answer = answers[command.constructor.name];
      if (!answer) throw Object.assign(new Error(`Unexpected ${command.constructor.name}`), { name: 'Unexpected' });
      return answer(command.input ?? {});
    }),
  };
}

function regionClients(log: Call[], region: string): any {
  const cloudWatch = fake(log, region, 'cloudwatch', { GetMetricStatisticsCommand: () => ({ Datapoints: [] }) });
  return {
    enabled: true,
    region,
    accountId: ACCOUNT,
    costExplorer: {},
    ec2: fake(log, region, 'ec2', {
      DescribeRegionsCommand: () => REGION_LIST,
      DescribeInstancesCommand: () => ({ Reservations: [] }),
      DescribeVolumesCommand: () => ({ Volumes: [] }),
      DescribeSecurityGroupsCommand: () => ({ SecurityGroups: [] }),
    }),
    rds: fake(log, region, 'rds', { DescribeDBInstancesCommand: () => ({ DBInstances: [] }), DescribeDBClustersCommand: () => ({ DBClusters: [] }) }),
    s3: fake(log, region, 's3', { ListBucketsCommand: () => ({ Buckets: [] }) }),
    s3Control: {},
    cloudWatch,
    lambda: fake(log, region, 'lambda', { ListFunctionsCommand: () => ({ Functions: [] }) }),
    ecs: {},
    elb: fake(log, region, 'elbv2', { DescribeLoadBalancersCommand: () => ({ LoadBalancers: [] }) }),
    eks: {},
    dynamodb: {},
    cloudFront: fake(log, 'us-east-1', 'cloudfront', { ListDistributionsCommand: () => ({ DistributionList: { Items: [] } }) }),
    apiGateway: {},
    elastiCache: {},
    sqs: {},
    sns: {},
    iam: fake(log, 'us-east-1', 'iam', { ListUsersCommand: () => ({ Users: [] }) }),
    backup: fake(log, region, 'backup', { ListRecoveryPointsByResourceCommand: () => ({ RecoveryPoints: [] }) }),
    securityHub: {},
    resourceExplorer: fake(log, region, 'resource-explorer-2', {
      GetIndexCommand: () => ACTIVE_INDEX,
      SearchCommand: () => ({ Resources: [], Count: { TotalResources: 0, Complete: true } }),
    }),
    getDynamoDBClientForRegion: () => ({}),
    getApplicationAutoScalingClientForRegion: () => ({}),
    getCloudWatchClientForRegion: () => cloudWatch,
    getS3ClientForRegion: () => ({}),
  };
}

const idle = (resourceId: string) => ({
  resource_id: resourceId, resource_name: resourceId, resource_type: 'EC2', issue: ISSUE_EC2_IDLE_INSTANCE,
  description: 'placeholder', potential_savings: 5, severity: 'LOW' as const, aws_region: HOME, metadata: {},
});

/** Fake AWS for a scan of `home`; the cost pass answers one idle instance in the home region. */
function mockAws(home: string) {
  stubScanSource();
  const log: Call[] = [];
  jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue(regionClients(log, home));
  jest.spyOn(AWSClientFactory, 'buildClients').mockImplementation((region: string) => regionClients(log, region));
  const cost = jest.spyOn(costOptimizationService, 'analyzeAllResources').mockResolvedValue({
    observations: [{ issue: ISSUE_EC2_IDLE_INSTANCE, success: true, recommendations: [idle('i-hr-b2')] }],
    riRecommendations: [],
    riSucceeded: false,
    homeRegion: home,
  } as any);
  return { log, cost };
}

async function insertOrg({ flag = false } = {}): Promise<string> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status) VALUES ($1, $2, $1, 'starter', 'active') RETURNING id`,
    [`HR Scan ${suffix}`, `hr-scan-${suffix}`]
  );
  const orgId = rows[0].id;
  createdOrgIds.push(orgId);
  await connectPlaceholderAccount(pool, orgId);
  // The account's home region is us-west-2, as after a change.
  await pool.query(`UPDATE aws_accounts SET region = $2 WHERE org_id = $1`, [orgId, HOME]);
  await refreshPlaceholderAccount(pool, orgId);
  if (flag) {
    await pool.query(
      `INSERT INTO organization_feature_flags (organization_id, flag, enabled, set_by, note) VALUES ($1, 'multi_region_discovery', true, 'test', 'test')`, [orgId]);
  }
  return orgId;
}

function service(): AWSResourceDiscoveryService {
  const svc = new AWSResourceDiscoveryService(pool);
  (svc as any).leaseTiming = FAST;
  (svc as any).callPolicy = { ...DEFAULT_AWS_CALL_POLICY, sleep: async () => undefined };
  (svc as any).multiRegionTiming = { regionPool: 3, regionDeadlineMs: 60_000, scanBudgetMs: 60 * 60_000, scanDeadlineMs: 2 * 60 * 60_000, now: Date.now };
  return svc;
}

/** Every column of the account row, as text: the byte-identity T6 compares. */
const accountRow = async (orgId: string) => (await pool.query(`SELECT to_jsonb(a)::text AS row FROM aws_accounts a WHERE org_id = $1`, [orgId])).rows[0].row;

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());
afterAll(async () => {
  for (const table of ['cost_recommendations', 'aws_resources', 'aws_account_regions', 'resource_discovery_jobs', 'organization_feature_flags', 'account_security_findings', 'cost_analysis_runs', 'aws_scan_leases']) {
    await pool.query(`DELETE FROM ${table} WHERE organization_id = ANY($1)`, [createdOrgIds]).catch(() => undefined);
  }
  await removePlaceholderAccounts(pool, createdOrgIds);
  await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  await pool.end();
});

describe('T1: a us-west-2 home region, end to end through a scan (flag off)', () => {
  it('lists, records and reconciles in us-west-2 only; the cost pass runs on the us-west-2 context and touches only us-west-2 rows', async () => {
    const orgId = await insertOrg();
    await pool.query(
      `INSERT INTO cost_recommendations (organization_id, resource_id, resource_name, resource_type, issue, description, potential_savings, severity, aws_region, metadata)
       VALUES ($1, 'i-hr-a1', 'x', 'EC2', $2, 'placeholder', 1, 'LOW', 'us-east-1', '{}'),
              ($1, 'i-hr-b1', 'x', 'EC2', $2, 'placeholder', 1, 'LOW', 'us-west-2', '{}')`,
      [orgId, ISSUE_EC2_IDLE_INSTANCE]
    );
    const { log, cost } = mockAws(HOME);

    const result = await service().discoverAllResources(orgId);
    expect(result.errors).toEqual([]);

    // Regional calls in us-west-2 only (CloudFront and IAM are global, us-east-1 by design).
    const regional = log.filter((c) => !['cloudfront', 'iam'].includes(c.client));
    expect(new Set(regional.map((c) => c.region))).toEqual(new Set([HOME]));
    expect(regional.filter((c) => c.command === 'DescribeRegionsCommand')).toHaveLength(1);
    expect(regional.some((c) => c.command === 'DescribeInstancesCommand')).toBe(true);

    const job = (await pool.query(`SELECT status, regions FROM resource_discovery_jobs WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 1`, [orgId])).rows[0];
    expect(job).toEqual({ status: 'completed', regions: [HOME] });
    const regions = (await pool.query(
      `SELECT region, enabled, last_scan_status FROM aws_account_regions WHERE organization_id = $1 AND aws_account_id = $2 ORDER BY region`, [orgId, ACCOUNT])).rows;
    expect(regions).toEqual([
      { region: 'eu-west-1', enabled: true, last_scan_status: 'never_scanned' },
      { region: 'us-east-1', enabled: true, last_scan_status: 'never_scanned' },
      { region: 'us-west-2', enabled: true, last_scan_status: 'ok' },
    ]);

    expect(cost).toHaveBeenCalledTimes(1);
    expect((cost.mock.calls[0][1] as any).region).toBe(HOME);
    const recs = (await pool.query(
      `SELECT resource_id, aws_region FROM cost_recommendations WHERE organization_id = $1 AND status = 'ACTIVE' ORDER BY resource_id`, [orgId])).rows;
    expect(recs).toEqual([
      // The old us-east-1 row is not this scan's to end (the change endpoint removes such rows).
      { resource_id: 'i-hr-a1', aws_region: 'us-east-1' },
      // us-west-2: the scan's answer replaced its old row.
      { resource_id: 'i-hr-b2', aws_region: HOME },
    ]);
  });
});

describe('the lease outcome a caller can wait for (review L-6)', () => {
  it("a scan that takes the lease says 'started' once, before it ends", async () => {
    const orgId = await insertOrg();
    mockAws(HOME);
    const outcomes: string[] = [];
    await service().discoverAllResources(orgId, { onLeaseOutcome: (o) => outcomes.push(o) });
    expect(outcomes).toEqual(['started']);
  });

  it("a scan that finds the lease held says 'skipped' and rejects with ScanAlreadyRunningError, writing nothing", async () => {
    const orgId = await insertOrg();
    mockAws(HOME);
    await pool.query(
      `INSERT INTO aws_scan_leases (organization_id, aws_account_id, scan_kind, holder, acquired_at, heartbeat_at, expires_at)
       VALUES ($1, $2, 'discovery', 'other-worker', NOW(), NOW(), NOW() + interval '1 hour')`,
      [orgId, ACCOUNT]
    );
    const outcomes: string[] = [];
    const error = await service().discoverAllResources(orgId, { onLeaseOutcome: (o) => outcomes.push(o) }).catch((e) => e);
    expect(isScanAlreadyRunning(error)).toBe(true);
    expect(outcomes).toEqual(['skipped']);
    expect((await pool.query(`SELECT count(*)::int AS n FROM resource_discovery_jobs WHERE organization_id = $1`, [orgId])).rows[0].n).toBe(0);
  });
});

describe('T6: no scan path writes the home region', () => {
  it.each([[false], [true]])('a full scan with multi_region_discovery %s leaves the aws_accounts row byte-identical', async (flag) => {
    const orgId = await insertOrg({ flag });
    const before = await accountRow(orgId);
    mockAws(HOME);
    await service().discoverAllResources(orgId);
    expect(await accountRow(orgId)).toBe(before);
    expect(JSON.parse(before).region).toBe(HOME);
  });

  it('statically: the only application statements that write aws_accounts are the connect INSERT and the change\'s UPDATE of region alone', () => {
    const SRC = path.join(__dirname, '../..');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__' && entry.name !== 'node_modules') walk(full);
        } else if (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) files.push(full);
      }
    };
    walk(SRC);
    const writers: string[] = [];
    for (const file of files) {
      // Code only: block and line comments are removed (a comment may name a statement).
      const text = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
      for (const m of text.matchAll(/\b(UPDATE\s+aws_accounts|INSERT\s+INTO\s+aws_accounts|DELETE\s+FROM\s+aws_accounts|TRUNCATE\s+(TABLE\s+)?aws_accounts|ALTER\s+TABLE\s+aws_accounts)\b[^`]*/gi)) {
        writers.push(`${path.relative(SRC, file)}: ${m[0].replace(/\s+/g, ' ').trim().slice(0, 60)}`);
      }
    }
    expect(writers.sort()).toEqual([
      'routes/aws.routes.ts: INSERT INTO aws_accounts (org_id, role_arn, account_id, nick',
      'services/home-region.service.ts: UPDATE aws_accounts SET region = $4 WHERE id = $1 AND org_id',
    ]);
    // The proposal code never writes the account row.
    expect(fs.readFileSync(path.join(SRC, 'services/home-region-proposal.ts'), 'utf8')).not.toMatch(/aws_accounts/i);
  });
});
