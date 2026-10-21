/**
 * Multi-region plan M4c: a failed, truncated, timed-out or partial read never
 * deletes, terminates, resolves or ends anything.
 *
 *   P-1  a resource a detector listed but could not evaluate keeps its ACTIVE
 *        recommendation and its open occurrence; the others reconcile normally.
 *   P-2  detectors read every page; a listing cut off at its page limit is no answer.
 *   P-3  Reserved Instance replacement is one transaction.
 *   P-4  orphan flags are written by one statement.
 *   AC-3 G2-G5, G8: incomplete listings, page errors and timeouts in discovery and
 *        in the detectors never authorize a cleanup (G1/G6/G7 unit and static
 *        checks: utils/__tests__/awsCallPolicy.listing.test.ts).
 *   §6.2 region predicates on the networking sweep (F10), the home-listed cost
 *        issues (F12) and RI (F13); S3 lifecycle and DynamoDB stay unrestricted.
 *   §6.4 warnings written to resource_discovery_jobs.warnings, legacy codes still in
 *        error_message; readers prefer the column and fall back.
 *   Two organizations with identical identifiers never touch each other's rows.
 *
 * Real Postgres for the persisted state; AWS clients are fakes (no AWS call is
 * made). Placeholders only: the documented example account ID.
 */
import { Pool } from 'pg';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { S3Client } from '@aws-sdk/client-s3';
import { EC2Client } from '@aws-sdk/client-ec2';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { ApplicationAutoScalingClient } from '@aws-sdk/client-application-auto-scaling';
import { ResourceExplorer2Client, Resource as REResource } from '@aws-sdk/client-resource-explorer-2';
import { AWSResourceDiscoveryService } from '../awsResourceDiscovery';
import { AWSClientFactory } from '../aws-client-factory.service';
import { stubScanSource } from './helpers/scan-source';
import costOptimizationService, { DetectorObservation } from '../cost-optimization.service';
import { CostRecommendationsRepository } from '../../repositories/cost-recommendations.repository';
import { AccountSecurityFindingsRepository } from '../../repositories/account-security-findings.repository';
import { AWSResourcesRepository } from '../../repositories/awsResources.repository';
import { OrphanedResourceDetectorService } from '../orphanedResourceDetector';
import { DEFAULT_AWS_CALL_POLICY, MAX_LISTING_PAGES } from '../../utils/awsCallPolicy';
import {
  DISCOVERY_WARNING_LISTING_TRUNCATED,
  DISCOVERY_WARNING_TRUNCATED_INDEX,
  discoveryWarningsColumn,
  joinDiscoveryMessage,
  jobWarnings,
} from '../discovery-warnings';
import {
  ISSUE_DYNAMODB_CAPACITY,
  ISSUE_DYNAMODB_ON_DEMAND_VS_PROVISIONED,
  ISSUE_EC2_IDLE_INSTANCE,
  ISSUE_EC2_RESERVED_INSTANCE_OPPORTUNITY,
  ISSUE_LAMBDA_LOW_USAGE,
  ISSUE_S3_LIFECYCLE_OPTIMIZATION,
} from '../../config/optimization-rules';
import type { CreateRecommendationRequest } from '../../types';
import * as dynamoTableUtil from '../dynamodb-table.util';
import * as dynamoAutoscalingUtil from '../dynamodb-autoscaling.util';
import * as capacityAnalysisUtil from '../dynamodb-capacity-analysis.util';
import { checkAwsBackupRecoveryPoints } from '../aws-backup-evidence.util';
import { ensureSharedFixtureTable } from '../../routes/__tests__/shared-fixture-tables';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'platform_portal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});
const createdOrgIds: string[] = [];
const ACCOUNT_ID = '123456789012';
const HOME = 'us-east-1';
const OTHER = 'eu-west-1';
const repository = new CostRecommendationsRepository();
const findingsRepository = new AccountSecurityFindingsRepository();
const LAMBDA_CONFIG = { ruleId: 'lambda_low_usage', parameterId: 'max_invocations', value: 10, source: 'default' };
const EC2_CONFIG = { ruleId: 'ec2_idle', parameterId: 'cpu_threshold_percent', value: 5, source: 'default' };
const QUICK_POLICY = { ...DEFAULT_AWS_CALL_POLICY, timeoutMs: 25, sleep: async () => {} };

const awsError = (name: string) => Object.assign(new Error(name), { name });
const hang = () => new Promise<never>(() => {});
type Send = (command: { constructor: { name: string }; input?: any }) => Promise<any>;

function withMockedSend<T extends { send: (...args: any[]) => any }>(client: T, send: Send): T {
  (client as any).send = jest.fn(send);
  return client;
}

/** A fake client answering by command name; anything unlisted fails at once. */
function fake(answers: Record<string, (input: any) => any>) {
  return {
    send: jest.fn(async (command: { constructor: { name: string }; input?: any }) => {
      const answer = answers[command.constructor.name];
      if (!answer) throw awsError(`Unexpected${command.constructor.name}`);
      return answer(command.input ?? {});
    }),
  };
}

async function insertOrg(tier: 'free' | 'starter' = 'free'): Promise<string> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
    [`M4c Org ${suffix}`, `m4c-org-${suffix}`, `M4c Org ${suffix}`, tier]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

interface SeedRec {
  resourceId: string;
  issue: string;
  status?: 'ACTIVE' | 'RESOLVED' | 'DISMISSED';
  region?: string | null;
}

async function seedRec(orgId: string, rec: SeedRec): Promise<void> {
  await pool.query(
    `INSERT INTO cost_recommendations (organization_id, resource_id, resource_name, resource_type, issue, severity, aws_region, status)
     VALUES ($1, $2, $2, 'EC2', $3, 'LOW', $4, $5)`,
    [orgId, rec.resourceId, rec.issue, rec.region === undefined ? HOME : rec.region, rec.status ?? 'ACTIVE']
  );
}

async function recs(orgId: string): Promise<Array<{ resource_id: string; issue: string; status: string; aws_region: string | null; ended: boolean }>> {
  const { rows } = await pool.query(
    `SELECT resource_id, issue, status, aws_region, occurrence_ended_at IS NOT NULL AS ended
       FROM cost_recommendations WHERE organization_id = $1 ORDER BY issue, resource_id, status`,
    [orgId]
  );
  return rows;
}

function finding(resourceId: string, issue: string, region = HOME): CreateRecommendationRequest {
  return {
    resource_id: resourceId,
    resource_name: resourceId,
    resource_type: 'EC2',
    issue,
    description: 'test',
    potential_savings: 1,
    severity: 'LOW',
    aws_region: region,
    metadata: {},
  };
}

function observation(overrides: Partial<DetectorObservation>): DetectorObservation {
  return { issue: ISSUE_EC2_IDLE_INSTANCE, success: true, recommendations: [], ...overrides };
}

async function seedResource(orgId: string, row: { arn: string; type: string; region?: string; missing?: number; orphaned?: boolean; savings?: number }): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO aws_resources
       (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status, missing_scan_count, is_orphaned, orphaned_monthly_savings)
     VALUES ($1, $2, $2, $2, $3, $4, 'active', $5, $6, $7) RETURNING id`,
    [orgId, row.arn, row.type, row.region ?? HOME, row.missing ?? 0, row.orphaned ?? false, row.savings ?? 0]
  );
  return rows[0].id;
}

async function resourceRow(orgId: string, arn: string) {
  const { rows } = await pool.query(
    `SELECT status, missing_scan_count, is_orphaned, orphaned_monthly_savings::float AS savings
       FROM aws_resources WHERE organization_id = $1 AND resource_arn = $2`,
    [orgId, arn]
  );
  return rows[0];
}

async function latestJob(orgId: string) {
  const { rows } = await pool.query(
    `SELECT status, error_message, warnings FROM resource_discovery_jobs WHERE organization_id = $1 ORDER BY started_at DESC LIMIT 1`,
    [orgId]
  );
  return rows[0];
}

function emptyResourceExplorer(): ResourceExplorer2Client {
  return withMockedSend(new ResourceExplorer2Client({ region: HOME }), async () => ({ Resources: [], Count: { TotalResources: 0, Complete: true } }));
}

function mockAwsClients(overrides: Record<string, unknown> = {}) {
  stubScanSource();
  return jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue({
    enabled: true,
    region: HOME,
    accountId: ACCOUNT_ID,
    costExplorer: {}, ec2: {}, rds: {}, s3: {}, s3Control: {}, cloudWatch: {}, lambda: {}, ecs: {}, elb: {}, eks: {}, dynamodb: {},
    cloudFront: {}, apiGateway: {}, elastiCache: {}, sqs: {}, sns: {}, iam: {}, resourceExplorer: emptyResourceExplorer(), backup: {},
    getDynamoDBClientForRegion: () => ({}), getApplicationAutoScalingClientForRegion: () => ({}), getCloudWatchClientForRegion: () => ({}),
    ...overrides,
  } as any);
}

/** Discovery's own cost step, stubbed: these tests look at the inventory and the job row. */
function mockCostStep() {
  jest.spyOn(costOptimizationService, 'analyzeAllResources').mockResolvedValue({ observations: [], riRecommendations: [], riSucceeded: false });
}

beforeAll(async () => {
  await ensureSharedFixtureTable(pool, 'aws_accounts');
});

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  (costOptimizationService as any).callPolicy = DEFAULT_AWS_CALL_POLICY;
});

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM cost_recommendations WHERE organization_id = ANY($1)', [createdOrgIds]);
    await pool.query('DELETE FROM account_security_findings WHERE organization_id = ANY($1)', [createdOrgIds]);
    await pool.query('DELETE FROM aws_resources WHERE organization_id = ANY($1)', [createdOrgIds]);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});

// ---------------------------------------------------------------------------
describe('P-1: a resource the detector could not evaluate keeps its recommendation', () => {
  it('reconcile keeps the ACTIVE row and the open occurrence of an unknown resource; the rest reconcile', async () => {
    const orgId = await insertOrg();
    await seedRec(orgId, { resourceId: 'i-unknown', issue: ISSUE_EC2_IDLE_INSTANCE });
    await seedRec(orgId, { resourceId: 'i-unknown-dismissed', issue: ISSUE_EC2_IDLE_INSTANCE, status: 'DISMISSED' });
    await seedRec(orgId, { resourceId: 'i-gone', issue: ISSUE_EC2_IDLE_INSTANCE });
    await seedRec(orgId, { resourceId: 'i-gone-dismissed', issue: ISSUE_EC2_IDLE_INSTANCE, status: 'DISMISSED' });

    await repository.reconcileActiveRecommendations(
      orgId,
      [observation({ unknownResourceIds: ['i-unknown', 'i-unknown-dismissed'] })],
      { homeRegion: HOME }
    );

    expect(await recs(orgId)).toEqual([
      { resource_id: 'i-gone-dismissed', issue: ISSUE_EC2_IDLE_INSTANCE, status: 'DISMISSED', aws_region: HOME, ended: true },
      { resource_id: 'i-unknown', issue: ISSUE_EC2_IDLE_INSTANCE, status: 'ACTIVE', aws_region: HOME, ended: false },
      { resource_id: 'i-unknown-dismissed', issue: ISSUE_EC2_IDLE_INSTANCE, status: 'DISMISSED', aws_region: HOME, ended: false },
    ]);
  });

  it('idle EC2: an instance without enough CPU datapoints is unknown, not "no longer idle"', async () => {
    const launched = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const ec2 = withMockedSend(new EC2Client({ region: HOME }), async () => ({
      Reservations: [{ Instances: [{ InstanceId: 'i-quiet', LaunchTime: launched, InstanceType: 't3.micro' }] }],
    }));
    const cw = withMockedSend(new CloudWatchClient({ region: HOME }), async () => ({ Datapoints: [] }));

    const result = await (costOptimizationService as any).detectIdleEC2Instances(ec2, cw, EC2_CONFIG, HOME);

    expect(result).toEqual({ success: true, issues: [], unknownResourceIds: ['i-quiet'] });
  });

  it('S3 lifecycle: a bucket whose region, lifecycle or size cannot be read is unknown', async () => {
    const s3 = withMockedSend(new S3Client({ region: HOME }), async (command) => {
      const bucket = command.input?.Bucket;
      switch (command.constructor.name) {
        case 'ListBucketsCommand': return { Buckets: [{ Name: 'no-region' }, { Name: 'no-lifecycle-read' }, { Name: 'no-size' }] };
        case 'GetBucketLocationCommand':
          if (bucket === 'no-region') throw awsError('AccessDenied');
          return {};
        case 'GetBucketLifecycleConfigurationCommand':
          if (bucket === 'no-lifecycle-read') throw awsError('AccessDenied');
          throw awsError('NoSuchLifecycleConfiguration');
        default: throw awsError('Unexpected');
      }
    });
    const cw = withMockedSend(new CloudWatchClient({ region: HOME }), async () => ({ Datapoints: [] }));

    const result = await (costOptimizationService as any).detectS3LifecycleOptimization(s3, cw);

    expect(result.success).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.unknownResourceIds).toEqual(['no-region', 'no-lifecycle-read', 'no-size']);
  });

  it('low-usage Lambda: a function whose usage cannot be read is unknown', async () => {
    const lambda = withMockedSend(new LambdaClient({ region: HOME }), async () => ({ Functions: [{ FunctionName: 'fn-unread' }] }));
    const cw = withMockedSend(new CloudWatchClient({ region: HOME }), async () => { throw awsError('ThrottlingException'); });

    const result = await (costOptimizationService as any).detectLowUsageLambdaFunctions('org', lambda, cw, LAMBDA_CONFIG, HOME);

    expect(result).toEqual({ success: true, issues: [], unknownResourceIds: ['fn-unread'] });
  });

  it('DynamoDB (both detectors): a table whose live DescribeTable fails is unknown', async () => {
    const orgId = await insertOrg();
    const created = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
    await pool.query(
      `INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status, metadata)
       VALUES ($1, $2, 'table-unread', 'table-unread', 'dynamodb', $3, 'unknown', $4)`,
      [
        orgId,
        `arn:aws:dynamodb:${OTHER}:${ACCOUNT_ID}:table/table-unread`,
        OTHER,
        JSON.stringify({ billing_mode: 'PROVISIONED', autoscaling_state: 'AUTOSCALING_DISABLED', creation_date_time: created }),
      ]
    );
    const failing = <T extends { send: (...args: any[]) => any }>(client: T) => withMockedSend(client, async () => { throw awsError('AccessDeniedException'); });
    const clients = {
      getDynamoDBClientForRegion: (region: string) => failing(new DynamoDBClient({ region })),
      getApplicationAutoScalingClientForRegion: (region: string) => failing(new ApplicationAutoScalingClient({ region })),
      getCloudWatchClientForRegion: (region: string) => failing(new CloudWatchClient({ region })),
    };

    for (const detector of ['detectDynamoDBCapacityOptimization', 'detectDynamoDBOnDemandVsProvisionedOptimization']) {
      const result = await (costOptimizationService as any)[detector](orgId, clients);
      expect(result).toEqual({ success: true, issues: [], unknownResourceIds: ['table-unread'] });
    }
  });

  it('end to end: a scan that cannot read one function keeps that function\'s recommendations, and still reconciles another', async () => {
    const orgId = await insertOrg();
    await seedRec(orgId, { resourceId: 'fn-unread', issue: ISSUE_LAMBDA_LOW_USAGE });
    await seedRec(orgId, { resourceId: 'fn-unread', issue: ISSUE_LAMBDA_LOW_USAGE, status: 'DISMISSED' });
    await seedRec(orgId, { resourceId: 'fn-deleted', issue: ISSUE_LAMBDA_LOW_USAGE });
    mockAwsClients({
      lambda: fake({ ListFunctionsCommand: () => ({ Functions: [{ FunctionName: 'fn-unread' }] }) }),
      cloudWatch: fake({}),
    });

    const analysis = await costOptimizationService.analyzeAllResources(orgId);
    const lambdaObservation = analysis.observations.find((o) => o.issue === ISSUE_LAMBDA_LOW_USAGE)!;
    expect(lambdaObservation).toMatchObject({ success: true, recommendations: [], unknownResourceIds: ['fn-unread'] });
    expect(analysis.homeRegion).toBe(HOME);

    await repository.reconcileActiveRecommendations(orgId, analysis.observations, { homeRegion: analysis.homeRegion! });

    expect((await recs(orgId)).filter((r) => r.issue === ISSUE_LAMBDA_LOW_USAGE)).toEqual([
      { resource_id: 'fn-unread', issue: ISSUE_LAMBDA_LOW_USAGE, status: 'ACTIVE', aws_region: HOME, ended: false },
      { resource_id: 'fn-unread', issue: ISSUE_LAMBDA_LOW_USAGE, status: 'DISMISSED', aws_region: HOME, ended: false },
    ]);
  });
});

// ---------------------------------------------------------------------------
describe('P-2 / AC-3: the detectors read every page, and a cut-off listing is no answer', () => {
  it('G1: low-usage Lambda: a function only on page 2 gets its recommendation', async () => {
    const lambda = withMockedSend(new LambdaClient({ region: HOME }), async (command) =>
      command.input?.Marker === 'page-2'
        ? { Functions: [{ FunctionName: 'fn-page-2', MemorySize: 128 }] }
        : { Functions: [{ FunctionName: 'fn-page-1', MemorySize: 128 }], NextMarker: 'page-2' }
    );
    const cw = withMockedSend(new CloudWatchClient({ region: HOME }), async () => ({ Datapoints: [] }));

    const result = await (costOptimizationService as any).detectLowUsageLambdaFunctions('org', lambda, cw, LAMBDA_CONFIG, HOME);

    expect(result.success).toBe(true);
    expect(result.issues.map((i: any) => i.resourceId)).toEqual(['fn-page-1', 'fn-page-2']);
  });

  it('G1: S3 lifecycle: a bucket only on page 2 is evaluated', async () => {
    const GB = 1024 ** 3;
    const s3 = withMockedSend(new S3Client({ region: HOME }), async (command) => {
      switch (command.constructor.name) {
        case 'ListBucketsCommand':
          return command.input?.ContinuationToken ? { Buckets: [{ Name: 'bucket-page-2' }] } : { Buckets: [], ContinuationToken: 'page-2' };
        case 'GetBucketLocationCommand': return {};
        default: throw awsError('NoSuchLifecycleConfiguration');
      }
    });
    const cw = withMockedSend(new CloudWatchClient({ region: HOME }), async () => ({ Datapoints: [{ Average: 10 * GB, Timestamp: new Date() }] }));

    const result = await (costOptimizationService as any).detectS3LifecycleOptimization(s3, cw);

    expect(result.issues.map((i: any) => i.resourceId)).toEqual(['bucket-page-2']);
  });

  const endless = (items: Record<string, unknown>, tokenField: string) => async () => ({ ...items, [tokenField]: 'more' });

  it.each([
    ['idle EC2', (s: any) => s.detectIdleEC2Instances(withMockedSend(new EC2Client({ region: HOME }), endless({ Reservations: [] }, 'NextToken')), {}, EC2_CONFIG, HOME)],
    ['unattached EBS', (s: any) => s.detectUnattachedEBSVolumes(withMockedSend(new EC2Client({ region: HOME }), endless({ Volumes: [] }, 'NextToken')), HOME)],
    ['gp2 to gp3', (s: any) => s.detectGp2ToGp3Migrations(withMockedSend(new EC2Client({ region: HOME }), endless({ Volumes: [] }, 'NextToken')), HOME)],
    ['S3 lifecycle', (s: any) => s.detectS3LifecycleOptimization(withMockedSend(new S3Client({ region: HOME }), endless({ Buckets: [] }, 'ContinuationToken')), {})],
    ['low-usage Lambda', (s: any) => s.detectLowUsageLambdaFunctions('org', withMockedSend(new LambdaClient({ region: HOME }), endless({ Functions: [] }, 'NextMarker')), {}, LAMBDA_CONFIG, HOME)],
    ['Reserved Instances', (s: any) => s.detectReservedInstanceOpportunities(withMockedSend(new EC2Client({ region: HOME }), endless({ Reservations: [] }, 'NextToken')), HOME)],
  ])('G2: %s: a listing that never ends stops at its page limit and is not a success', async (_name, run) => {
    const result = await run(costOptimizationService as any);
    expect(result).toEqual({ success: false, issues: [] });
  });

  it('G2: a cut-off Lambda listing deletes no stored recommendation (end to end)', async () => {
    const orgId = await insertOrg();
    await seedRec(orgId, { resourceId: 'fn-past-the-limit', issue: ISSUE_LAMBDA_LOW_USAGE });
    mockAwsClients({ lambda: fake({ ListFunctionsCommand: () => ({ Functions: [], NextMarker: 'more' }) }), cloudWatch: fake({}) });

    const analysis = await costOptimizationService.analyzeAllResources(orgId);
    expect(analysis.observations.find((o) => o.issue === ISSUE_LAMBDA_LOW_USAGE)!.success).toBe(false);
    await repository.reconcileActiveRecommendations(orgId, analysis.observations, { homeRegion: HOME });

    expect((await recs(orgId)).filter((r) => r.issue === ISSUE_LAMBDA_LOW_USAGE)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
describe('AC-3 G4: detector calls time out under the call policy', () => {
  it('G4/G6: every detector call that never answers times out; the analysis ends and nothing is a success', async () => {
    const orgId = await insertOrg();
    (costOptimizationService as any).callPolicy = QUICK_POLICY;
    const hanging = () => ({ send: jest.fn(hang) });
    mockAwsClients({
      ec2: hanging(), s3: hanging(), lambda: hanging(), cloudWatch: hanging(),
      getS3ClientForRegion: hanging, getCloudWatchClientForRegion: hanging,
      getDynamoDBClientForRegion: hanging, getApplicationAutoScalingClientForRegion: hanging,
    });

    const analysis = await costOptimizationService.analyzeAllResources(orgId);

    expect(analysis.riSucceeded).toBe(false);
    for (const o of analysis.observations) {
      // The retired oversized-RDS category always reports an empty, successful answer;
      // the DynamoDB detectors read the (empty) inventory and make no AWS call.
      if (o.success) expect(o.recommendations).toEqual([]);
    }
    const failed = analysis.observations.filter((o) => !o.success).map((o) => o.issue).sort();
    expect(failed).toHaveLength(6);
  });

  it('G4: a per-resource call that never answers makes that resource unknown; the others reconcile', async () => {
    const orgId = await insertOrg();
    await seedRec(orgId, { resourceId: 'fn-slow', issue: ISSUE_LAMBDA_LOW_USAGE });
    await seedRec(orgId, { resourceId: 'fn-gone', issue: ISSUE_LAMBDA_LOW_USAGE });
    (costOptimizationService as any).callPolicy = QUICK_POLICY;
    mockAwsClients({
      lambda: fake({ ListFunctionsCommand: () => ({ Functions: [{ FunctionName: 'fn-slow' }] }) }),
      cloudWatch: { send: jest.fn(hang) },
    });

    const analysis = await costOptimizationService.analyzeAllResources(orgId);
    await repository.reconcileActiveRecommendations(orgId, analysis.observations, { homeRegion: HOME });

    expect((await recs(orgId)).filter((r) => r.issue === ISSUE_LAMBDA_LOW_USAGE).map((r) => r.resource_id)).toEqual(['fn-slow']);
  });
});

// ---------------------------------------------------------------------------
describe('AC-3 G2/G3/G5/G8: discovery never reconciles a source that did not answer completely', () => {
  const EBS_ARN = `arn:aws:ec2:${HOME}:*:volume/vol-0123456789abcdef0`;
  const BUCKET_ARN = 'arn:aws:s3:::m4c-stored-bucket';

  function ec2(volumes: (input: any) => any) {
    return fake({
      DescribeInstancesCommand: () => ({ Reservations: [] }),
      DescribeVolumesCommand: volumes,
      DescribeSecurityGroupsCommand: () => ({ SecurityGroups: [] }),
    });
  }

  it('control: a complete EBS listing without the volume terminates it (it was missing once already)', async () => {
    const orgId = await insertOrg();
    await seedResource(orgId, { arn: EBS_ARN, type: 'ebs', missing: 1 });
    mockAwsClients({ ec2: ec2(() => ({ Volumes: [] })) });
    mockCostStep();

    await new AWSResourceDiscoveryService(pool).discoverAllResources(orgId);

    expect(await resourceRow(orgId, EBS_ARN)).toMatchObject({ status: 'terminated', missing_scan_count: 2 });
  });

  it('G2: an EBS listing cut off at its page limit terminates nothing; the warning is in the column only', async () => {
    const orgId = await insertOrg();
    await seedResource(orgId, { arn: EBS_ARN, type: 'ebs', missing: 1 });
    const client = ec2(() => ({ Volumes: [], NextToken: 'more' }));
    mockAwsClients({ ec2: client });
    mockCostStep();

    const result = await new AWSResourceDiscoveryService(pool).discoverAllResources(orgId);

    expect(client.send.mock.calls.filter(([c]: any[]) => c.constructor.name === 'DescribeVolumesCommand')).toHaveLength(MAX_LISTING_PAGES);
    expect(await resourceRow(orgId, EBS_ARN)).toMatchObject({ status: 'active', missing_scan_count: 1 });
    expect(result.warnings).toContain(DISCOVERY_WARNING_LISTING_TRUNCATED);
    const job = await latestJob(orgId);
    expect(job.warnings).toEqual([DISCOVERY_WARNING_LISTING_TRUNCATED]);
    expect(job.error_message ?? '').not.toContain(DISCOVERY_WARNING_LISTING_TRUNCATED);
  });

  it.each([
    ['a generic error', awsError('InternalError')],
    ['throttling, after the retries', awsError('RequestLimitExceeded')],
    ['a denial', awsError('UnauthorizedOperation')],
  ])('G3: an EBS listing whose page 2 fails with %s terminates nothing and is recorded', async (_name, error) => {
    const orgId = await insertOrg();
    await seedResource(orgId, { arn: EBS_ARN, type: 'ebs', missing: 1 });
    mockAwsClients({ ec2: ec2((input) => { if (input.NextToken) throw error; return { Volumes: [], NextToken: 'page-2' }; }) });
    mockCostStep();
    const service = new AWSResourceDiscoveryService(pool);
    (service as any).callPolicy = QUICK_POLICY;

    const result = await service.discoverAllResources(orgId);

    expect(await resourceRow(orgId, EBS_ARN)).toMatchObject({ status: 'active', missing_scan_count: 1 });
    expect(result.errors.some((e) => e.startsWith('EBS: '))).toBe(true);
  });

  it('G5: an EBS listing that never answers times out and terminates nothing', async () => {
    const orgId = await insertOrg();
    await seedResource(orgId, { arn: EBS_ARN, type: 'ebs', missing: 1 });
    mockAwsClients({ ec2: { send: jest.fn(hang) }, s3: { send: jest.fn(hang) }, iam: { send: jest.fn(hang) }, resourceExplorer: { send: jest.fn(hang) } });
    mockCostStep();
    const service = new AWSResourceDiscoveryService(pool);
    (service as any).callPolicy = QUICK_POLICY;

    const result = await service.discoverAllResources(orgId);

    expect(await resourceRow(orgId, EBS_ARN)).toMatchObject({ status: 'active', missing_scan_count: 1 });
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringMatching(/^EBS: AWS call exceeded/), expect.stringMatching(/^Resource Explorer: /)]));
  });

  it('G2: an S3 listing cut off at its page limit reconciles no bucket', async () => {
    const orgId = await insertOrg();
    await seedResource(orgId, { arn: BUCKET_ARN, type: 's3', missing: 1 });
    mockAwsClients({ s3: fake({ ListBucketsCommand: () => ({ Buckets: [], ContinuationToken: 'more' }) }) });
    mockCostStep();

    await new AWSResourceDiscoveryService(pool).discoverAllResources(orgId);

    expect(await resourceRow(orgId, BUCKET_ARN)).toMatchObject({ status: 'active', missing_scan_count: 1 });
  });

  it('G8: a Resource Explorer search reaching 1,000 results over several pages reconciles nothing; the warning is in both places', async () => {
    const orgId = await insertOrg();
    const instanceArn = `arn:aws:ec2:${HOME}:*:instance/i-0123456789abcdef0`;
    await seedResource(orgId, { arn: instanceArn, type: 'ec2', missing: 1 });
    const page = (n: number): REResource[] =>
      Array.from({ length: 100 }, (_, i) => ({ Arn: `arn:aws:sns:${HOME}:${ACCOUNT_ID}:topic-${n}-${i}`, Region: HOME, Service: 'sns', ResourceType: 'sns:topic', Properties: [] }));
    const explorer = withMockedSend(new ResourceExplorer2Client({ region: HOME }), async (command) => {
      const n = Number(command.input?.NextToken ?? 0);
      return { Resources: page(n), Count: { TotalResources: 1000, Complete: true }, ...(n < 9 ? { NextToken: String(n + 1) } : {}) };
    });
    mockAwsClients({ resourceExplorer: explorer });
    mockCostStep();

    await new AWSResourceDiscoveryService(pool).discoverAllResources(orgId);

    expect(await resourceRow(orgId, instanceArn)).toMatchObject({ status: 'active', missing_scan_count: 1 });
    const job = await latestJob(orgId);
    expect(job.warnings).toEqual([DISCOVERY_WARNING_TRUNCATED_INDEX]);
    expect(job.error_message.split('; ')).toContain(DISCOVERY_WARNING_TRUNCATED_INDEX);
  });

  it('a run with no warning stores NULL in the column', async () => {
    const orgId = await insertOrg();
    mockAwsClients();
    mockCostStep();

    await new AWSResourceDiscoveryService(pool).discoverAllResources(orgId);

    expect((await latestJob(orgId)).warnings).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('P-3: Reserved Instance replacement is one transaction', () => {
  it('control: a replacement that succeeds swaps the old row for the new one', async () => {
    const orgId = await insertOrg();
    await seedRec(orgId, { resourceId: 'ri-opportunity-old', issue: ISSUE_EC2_RESERVED_INSTANCE_OPPORTUNITY });

    await repository.replaceReservedInstanceRecommendations(orgId, { homeRegion: HOME }, [finding('ri-opportunity-new', ISSUE_EC2_RESERVED_INSTANCE_OPPORTUNITY)]);

    expect((await recs(orgId)).map((r) => r.resource_id)).toEqual(['ri-opportunity-new']);
  });

  it('an insert that fails after the delete leaves the stored RI rows exactly as they were', async () => {
    const orgId = await insertOrg();
    await seedRec(orgId, { resourceId: 'ri-opportunity-old', issue: ISSUE_EC2_RESERVED_INSTANCE_OPPORTUNITY });
    const broken = { ...finding('ri-opportunity-broken', ISSUE_EC2_RESERVED_INSTANCE_OPPORTUNITY), severity: 'NOT-A-SEVERITY' as any };

    await expect(
      repository.replaceReservedInstanceRecommendations(orgId, { homeRegion: HOME }, [finding('ri-opportunity-new', ISSUE_EC2_RESERVED_INSTANCE_OPPORTUNITY), broken])
    ).rejects.toThrow();

    expect(await recs(orgId)).toEqual([
      { resource_id: 'ri-opportunity-old', issue: ISSUE_EC2_RESERVED_INSTANCE_OPPORTUNITY, status: 'ACTIVE', aws_region: HOME, ended: false },
    ]);
  });
});

// ---------------------------------------------------------------------------
describe('P-4: orphan flags are written by one statement', () => {
  it('control: the flags follow the detector, and another organization\'s flags are untouched', async () => {
    const orgId = await insertOrg();
    const otherOrgId = await insertOrg();
    const a = await seedResource(orgId, { arn: 'arn:aws:s3:::m4c-a', type: 's3', orphaned: false });
    await seedResource(orgId, { arn: 'arn:aws:s3:::m4c-b', type: 's3', orphaned: true, savings: 3 });
    await seedResource(otherOrgId, { arn: 'arn:aws:s3:::m4c-b', type: 's3', orphaned: true, savings: 3 });
    jest.spyOn(OrphanedResourceDetectorService.prototype, 'detectOrphaned').mockResolvedValue([{ resource: { id: a }, potential_savings: 7 } as any]);
    mockAwsClients();
    mockCostStep();

    await new AWSResourceDiscoveryService(pool).discoverAllResources(orgId);

    expect(await resourceRow(orgId, 'arn:aws:s3:::m4c-a')).toMatchObject({ is_orphaned: true, savings: 7 });
    expect(await resourceRow(orgId, 'arn:aws:s3:::m4c-b')).toMatchObject({ is_orphaned: false, savings: 0 });
    expect(await resourceRow(otherOrgId, 'arn:aws:s3:::m4c-b')).toMatchObject({ is_orphaned: true, savings: 3 });
  });

  it('a write that fails leaves every flag as it was (no org-wide reset first)', async () => {
    const orgId = await insertOrg();
    const a = await seedResource(orgId, { arn: 'arn:aws:s3:::m4c-a', type: 's3', orphaned: true, savings: 5 });
    await seedResource(orgId, { arn: 'arn:aws:s3:::m4c-b', type: 's3', orphaned: true, savings: 3 });
    // The first id is not a valid row id, so writing the flags fails.
    jest.spyOn(OrphanedResourceDetectorService.prototype, 'detectOrphaned').mockResolvedValue([
      { resource: { id: 'not-a-uuid' }, potential_savings: 1 } as any,
      { resource: { id: a }, potential_savings: 5 } as any,
    ]);
    mockAwsClients();
    mockCostStep();

    const result = await new AWSResourceDiscoveryService(pool).discoverAllResources(orgId);

    expect(result.errors.some((e) => e.startsWith('Orphaned detection: '))).toBe(true);
    expect(await resourceRow(orgId, 'arn:aws:s3:::m4c-a')).toMatchObject({ is_orphaned: true, savings: 5 });
    expect(await resourceRow(orgId, 'arn:aws:s3:::m4c-b')).toMatchObject({ is_orphaned: true, savings: 3 });
  });
});

// ---------------------------------------------------------------------------
describe('§6.2 region predicates', () => {
  it('F12: home-listed issues reconcile in the home region (and rows with no region) only; S3 lifecycle and DynamoDB stay unrestricted', async () => {
    const orgId = await insertOrg();
    await seedRec(orgId, { resourceId: 'i-home', issue: ISSUE_EC2_IDLE_INSTANCE });
    await seedRec(orgId, { resourceId: 'i-no-region', issue: ISSUE_EC2_IDLE_INSTANCE, region: null });
    await seedRec(orgId, { resourceId: 'i-other', issue: ISSUE_EC2_IDLE_INSTANCE, region: OTHER });
    await seedRec(orgId, { resourceId: 'i-other-dismissed', issue: ISSUE_EC2_IDLE_INSTANCE, region: OTHER, status: 'DISMISSED' });
    await seedRec(orgId, { resourceId: 'bucket-other', issue: ISSUE_S3_LIFECYCLE_OPTIMIZATION, region: OTHER });
    await seedRec(orgId, { resourceId: 'table-other', issue: ISSUE_DYNAMODB_CAPACITY, region: OTHER });

    await repository.reconcileActiveRecommendations(
      orgId,
      [observation({}), observation({ issue: ISSUE_S3_LIFECYCLE_OPTIMIZATION }), observation({ issue: ISSUE_DYNAMODB_CAPACITY })],
      { homeRegion: HOME }
    );

    expect(await recs(orgId)).toEqual([
      { resource_id: 'i-other', issue: ISSUE_EC2_IDLE_INSTANCE, status: 'ACTIVE', aws_region: OTHER, ended: false },
      { resource_id: 'i-other-dismissed', issue: ISSUE_EC2_IDLE_INSTANCE, status: 'DISMISSED', aws_region: OTHER, ended: false },
    ]);
  });

  it('F12 without a scope keeps the earlier organization-wide behaviour', async () => {
    const orgId = await insertOrg();
    await seedRec(orgId, { resourceId: 'i-other', issue: ISSUE_EC2_IDLE_INSTANCE, region: OTHER });

    await repository.reconcileActiveRecommendations(orgId, [observation({})]);

    expect(await recs(orgId)).toEqual([]);
  });

  it('F13: RI replacement leaves another region\'s RI rows alone', async () => {
    const orgId = await insertOrg();
    await seedRec(orgId, { resourceId: 'ri-opportunity-home', issue: ISSUE_EC2_RESERVED_INSTANCE_OPPORTUNITY });
    await seedRec(orgId, { resourceId: 'ri-opportunity-none', issue: ISSUE_EC2_RESERVED_INSTANCE_OPPORTUNITY, region: null });
    await seedRec(orgId, { resourceId: 'ri-opportunity-other', issue: ISSUE_EC2_RESERVED_INSTANCE_OPPORTUNITY, region: OTHER });

    await repository.replaceReservedInstanceRecommendations(orgId, { homeRegion: HOME }, []);

    expect((await recs(orgId)).map((r) => r.resource_id)).toEqual(['ri-opportunity-other']);
  });

  it('F10: the networking sweep resolves home-region and region-less findings only; IAM is unrestricted', async () => {
    const orgId = await insertOrg();
    const insert = (key: string, category: 'networking' | 'iam', region: string | null) =>
      pool.query(
        `INSERT INTO account_security_findings
           (organization_id, finding_key, category, severity, title, recommendation, resource_identifier, region, last_seen_at)
         VALUES ($1, $2::varchar, $3, 'high', $2::text, 'fix', $2::text, $4, NOW() - interval '1 day')`,
        [orgId, key, category, region]
      );
    await insert('net-home', 'networking', HOME);
    await insert('net-none', 'networking', null);
    await insert('net-other', 'networking', OTHER);
    await insert('iam-user', 'iam', null);

    await findingsRepository.reconcileScan(orgId, new Date(), [], ['networking', 'iam'], HOME);

    const { rows } = await pool.query(
      `SELECT finding_key, status FROM account_security_findings WHERE organization_id = $1 ORDER BY finding_key`,
      [orgId]
    );
    expect(rows).toEqual([
      { finding_key: 'iam-user', status: 'resolved' },
      { finding_key: 'net-home', status: 'resolved' },
      { finding_key: 'net-none', status: 'resolved' },
      { finding_key: 'net-other', status: 'active' },
    ]);
  });
});

// ---------------------------------------------------------------------------
describe('§6.4 warnings column', () => {
  it('error_message carries only the legacy codes; the column carries every code, once', () => {
    expect(joinDiscoveryMessage(['EC2: x'], [DISCOVERY_WARNING_TRUNCATED_INDEX, DISCOVERY_WARNING_LISTING_TRUNCATED])).toBe(
      `EC2: x; ${DISCOVERY_WARNING_TRUNCATED_INDEX}`
    );
    expect(joinDiscoveryMessage([], [DISCOVERY_WARNING_LISTING_TRUNCATED])).toBeNull();
    expect(discoveryWarningsColumn([DISCOVERY_WARNING_LISTING_TRUNCATED, DISCOVERY_WARNING_LISTING_TRUNCATED])).toBe(
      JSON.stringify([DISCOVERY_WARNING_LISTING_TRUNCATED])
    );
    expect(discoveryWarningsColumn([])).toBeNull();
  });

  it('readers take the column when set (known codes only) and fall back to error_message', () => {
    expect(jobWarnings([DISCOVERY_WARNING_LISTING_TRUNCATED, 'free text', 42], `x; ${DISCOVERY_WARNING_TRUNCATED_INDEX}`)).toEqual([
      DISCOVERY_WARNING_LISTING_TRUNCATED,
    ]);
    expect(jobWarnings(null, `x; ${DISCOVERY_WARNING_TRUNCATED_INDEX}`)).toEqual([DISCOVERY_WARNING_TRUNCATED_INDEX]);
    expect(jobWarnings(undefined, null)).toEqual([]);
  });

  it('GET /discovery/jobs reads both storage locations; error_message never shows a code', async () => {
    const orgId = await insertOrg();
    const insertJob = (started: string, errorMessage: string | null, warnings: string | null) =>
      pool.query(
        `INSERT INTO resource_discovery_jobs (organization_id, status, started_at, created_at, error_message, warnings)
         VALUES ($1, 'completed', $2::timestamptz, $2::timestamptz, $3, $4::jsonb)`,
        [orgId, started, errorMessage, warnings]
      );
    await insertJob('2026-01-01T00:00:00Z', `EC2: x; ${DISCOVERY_WARNING_TRUNCATED_INDEX}`, null);
    await insertJob('2026-01-02T00:00:00Z', DISCOVERY_WARNING_TRUNCATED_INDEX, JSON.stringify([DISCOVERY_WARNING_TRUNCATED_INDEX, DISCOVERY_WARNING_LISTING_TRUNCATED]));
    await pool.query("SELECT set_config('app.current_organization_id', $1, false)", [orgId]);

    const jobs = await new AWSResourcesRepository(pool).getDiscoveryJobs(orgId);

    expect(jobs.map((j: any) => ({ error_message: j.error_message, warnings: j.warnings }))).toEqual([
      { error_message: null, warnings: [DISCOVERY_WARNING_TRUNCATED_INDEX, DISCOVERY_WARNING_LISTING_TRUNCATED] },
      { error_message: 'EC2: x', warnings: [DISCOVERY_WARNING_TRUNCATED_INDEX] },
    ]);
  });
});

// ---------------------------------------------------------------------------
describe('two organizations with the same identifiers', () => {
  it("one organization's reconcile, RI replacement and findings sweep never touch the other's rows", async () => {
    const orgA = await insertOrg();
    const orgB = await insertOrg();
    for (const orgId of [orgA, orgB]) {
      await seedRec(orgId, { resourceId: 'i-same', issue: ISSUE_EC2_IDLE_INSTANCE });
      await seedRec(orgId, { resourceId: 'i-same-dismissed', issue: ISSUE_EC2_IDLE_INSTANCE, status: 'DISMISSED' });
      await seedRec(orgId, { resourceId: 'ri-opportunity-same', issue: ISSUE_EC2_RESERVED_INSTANCE_OPPORTUNITY });
      await pool.query(
        `INSERT INTO account_security_findings
           (organization_id, finding_key, category, severity, title, recommendation, resource_identifier, region, last_seen_at)
         VALUES ($1, 'same-key', 'networking', 'high', 't', 'r', 'sg', $2, NOW() - interval '1 day')`,
        [orgId, HOME]
      );
    }
    const before = await recs(orgB);

    await repository.reconcileActiveRecommendations(orgA, [observation({})], { homeRegion: HOME });
    await repository.replaceReservedInstanceRecommendations(orgA, { homeRegion: HOME }, []);
    await findingsRepository.reconcileScan(orgA, new Date(), [], ['networking', 'iam'], HOME);

    expect((await recs(orgA)).map((r) => [r.resource_id, r.status, r.ended])).toEqual([['i-same-dismissed', 'DISMISSED', true]]);
    expect(await recs(orgB)).toEqual(before);
    const { rows } = await pool.query(`SELECT status FROM account_security_findings WHERE organization_id = $1`, [orgB]);
    expect(rows).toEqual([{ status: 'active' }]);
  });
});

// ---------------------------------------------------------------------------
// Review round 1 (F1-F4).

/** A detector's issue as the request discovery and Analyze reconcile with. */
function toRequest(issue: any): CreateRecommendationRequest {
  return {
    resource_id: issue.resourceId,
    resource_name: issue.resourceName,
    resource_type: issue.resourceType,
    issue: issue.issue,
    description: issue.description,
    potential_savings: issue.potentialSavings,
    severity: issue.severity,
    aws_region: issue.awsRegion,
    metadata: issue.metadata,
  };
}

/** Runs one detector result through the reconcile, as a scan does. */
async function reconcileResult(orgId: string, issue: string, result: { success: boolean; issues: any[]; unknownResourceIds?: string[] }) {
  await repository.reconcileActiveRecommendations(
    orgId,
    [{ issue, success: result.success, recommendations: result.issues.map(toRequest), unknownResourceIds: result.unknownResourceIds }],
    { homeRegion: HOME }
  );
}

describe('F1: DynamoDB detectors treat too little data as unknown, never as "no issue"', () => {
  const TABLE = 'table-gated';
  const old = new Date(Date.now() - 400 * 24 * 3600 * 1000).toISOString();
  const liveConfig = {
    billing_mode: 'PROVISIONED', table_status: 'ACTIVE', creation_date_time: old,
    provisioned_read_capacity: 500, provisioned_write_capacity: 200, table_class: 'STANDARD',
    last_increase_date_time: old, last_decrease_date_time: old,
  };
  const clients = {
    getDynamoDBClientForRegion: () => ({}),
    getApplicationAutoScalingClientForRegion: () => ({}),
    getCloudWatchClientForRegion: () => ({}),
  };
  const capacity = (overrides: Record<string, unknown> = {}) => ({
    totalIntervals: 720, validUtilizationIntervals: 700, lowUtilizationIntervals: 700, lowUtilizationPercentage: 100,
    highestHourlyAverageUtilizationPercent: 5, highestHourlyAverageThroughputPerSecond: 10,
    throttleValidIntervals: 700, throttleConfirmedIntervals: 0, ...overrides,
  });
  const mode = (overrides: Record<string, unknown> = {}) => ({
    totalIntervals: 720, validConsumedIntervals: 700, validProvisionedIntervals: 700, validUtilizationIntervals: 700,
    averageUtilizationPercent: 10, highestObservedHourlyAverageThroughputPerSecond: 50, percentIntervalsBelowPeakFraction: 60,
    sumConsumedRequestUnits: 1000, sumProvisionedCapacityUnitHours: 350_000, throttleValidIntervals: 700, throttleConfirmedIntervals: 0,
    ...overrides,
  });
  const CAPACITY = { detector: 'detectDynamoDBCapacityOptimization', issue: ISSUE_DYNAMODB_CAPACITY, analyze: 'analyzeDynamoDBCapacityDimension' } as const;
  const MODE = { detector: 'detectDynamoDBOnDemandVsProvisionedOptimization', issue: ISSUE_DYNAMODB_ON_DEMAND_VS_PROVISIONED, analyze: 'analyzeDynamoDBModeComparisonDimension' } as const;
  type Detector = typeof CAPACITY | typeof MODE;

  async function seedTable(orgId: string) {
    await pool.query(
      `INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status, metadata)
       VALUES ($1, $2, $3, $3, 'dynamodb', $4, 'unknown', $5)`,
      [orgId, `arn:aws:dynamodb:${HOME}:${ACCOUNT_ID}:table/${TABLE}`, TABLE, HOME,
        JSON.stringify({ billing_mode: 'PROVISIONED', autoscaling_state: 'AUTOSCALING_DISABLED', creation_date_time: old })]
    );
  }

  /** The table's live reads succeed; each dimension's analysis is `analysis`. */
  function stubLive(detector: Detector, analysis: Record<string, unknown>) {
    jest.spyOn(dynamoTableUtil, 'describeDynamoDBTable').mockResolvedValue({ status: 'described', config: liveConfig } as any);
    jest.spyOn(dynamoAutoscalingUtil, 'describeDynamoDBAutoscaling').mockResolvedValue({
      status: 'described', config: { autoscaling_state: 'AUTOSCALING_DISABLED', read_capacity_autoscaled: false, write_capacity_autoscaled: false },
    } as any);
    jest.spyOn(capacityAnalysisUtil, 'fetchDynamoDBCapacityMetrics').mockResolvedValue({ status: 'fetched', series: {} } as any);
    jest.spyOn(capacityAnalysisUtil, detector.analyze).mockReturnValue(analysis as any);
  }

  async function scan(orgId: string, detector: Detector, analysis: Record<string, unknown>) {
    stubLive(detector, analysis);
    const result = await (costOptimizationService as any)[detector.detector](orgId, clients);
    await reconcileResult(orgId, detector.issue, result);
    return result;
  }

  it.each([
    ['capacity: fewer valid utilization intervals than the floor', CAPACITY, capacity({ validUtilizationIntervals: 100 }), capacity()],
    ['capacity: no throttle data at all', CAPACITY, capacity({ throttleValidIntervals: 0 }), capacity()],
    ['mode comparison: a series below the data-completeness floor', MODE, mode({ validConsumedIntervals: 100 }), mode()],
  ])('%s: the table is unknown; its rows stay; with enough data later, no fresh ACTIVE row replaces the dismissal', async (_name, detector, insufficient, sufficient) => {
    const orgId = await insertOrg();
    await seedTable(orgId);
    await seedRec(orgId, { resourceId: TABLE, issue: detector.issue });
    await seedRec(orgId, { resourceId: TABLE, issue: detector.issue, status: 'DISMISSED' });

    const first = await scan(orgId, detector, insufficient);
    expect(first).toEqual({ success: true, issues: [], unknownResourceIds: [TABLE] });
    expect(await recs(orgId)).toEqual([
      { resource_id: TABLE, issue: detector.issue, status: 'ACTIVE', aws_region: HOME, ended: false },
      { resource_id: TABLE, issue: detector.issue, status: 'DISMISSED', aws_region: HOME, ended: false },
    ]);

    // Enough data, and the condition holds: the detector reports the table again,
    // and the open dismissal still suppresses a new ACTIVE row.
    const second = await scan(orgId, detector, sufficient);
    expect(second.issues.map((i: any) => i.resourceId)).toEqual([TABLE]);
    expect(await recs(orgId)).toEqual([
      { resource_id: TABLE, issue: detector.issue, status: 'DISMISSED', aws_region: HOME, ended: false },
    ]);
  });

  it.each([
    ['capacity: the low-utilization share is under the threshold', capacity({ lowUtilizationPercentage: 50 })],
    ['capacity: throttling was observed', capacity({ throttleConfirmedIntervals: 3 })],
    ['capacity: throttling observed even with too few valid intervals', capacity({ validUtilizationIntervals: 100, throttleConfirmedIntervals: 3 })],
  ])('control, known: %s ends the occurrence and removes the ACTIVE row', async (_name, analysis) => {
    const orgId = await insertOrg();
    await seedTable(orgId);
    await seedRec(orgId, { resourceId: TABLE, issue: ISSUE_DYNAMODB_CAPACITY });
    await seedRec(orgId, { resourceId: TABLE, issue: ISSUE_DYNAMODB_CAPACITY, status: 'DISMISSED' });

    const result = await scan(orgId, CAPACITY, analysis);

    expect(result).toEqual({ success: true, issues: [], unknownResourceIds: [] });
    expect(await recs(orgId)).toEqual([
      { resource_id: TABLE, issue: ISSUE_DYNAMODB_CAPACITY, status: 'DISMISSED', aws_region: HOME, ended: true },
    ]);
  });
});

describe('F2: idle EC2 without a full-window run is unknown', () => {
  const now = Date.now();
  it.each([
    ['restarted inside the window (stop/start)', new Date(now - 24 * 3600 * 1000)],
    ['no LaunchTime reported', undefined],
  ])('%s: a dismissed idle occurrence and an ACTIVE row are kept', async (_name, launchTime) => {
    const orgId = await insertOrg();
    await seedRec(orgId, { resourceId: 'i-1234567890abcdef0', issue: ISSUE_EC2_IDLE_INSTANCE });
    await seedRec(orgId, { resourceId: 'i-1234567890abcdef0', issue: ISSUE_EC2_IDLE_INSTANCE, status: 'DISMISSED' });
    const ec2 = withMockedSend(new EC2Client({ region: HOME }), async () => ({
      Reservations: [{ Instances: [{ InstanceId: 'i-1234567890abcdef0', LaunchTime: launchTime, InstanceType: 't3.micro' }] }],
    }));
    const cw = withMockedSend(new CloudWatchClient({ region: HOME }), async () => { throw awsError('NotCalled'); });

    const result = await (costOptimizationService as any).detectIdleEC2Instances(ec2, cw, EC2_CONFIG, HOME);
    expect(result).toEqual({ success: true, issues: [], unknownResourceIds: ['i-1234567890abcdef0'] });
    await reconcileResult(orgId, ISSUE_EC2_IDLE_INSTANCE, result);

    expect(await recs(orgId)).toEqual([
      { resource_id: 'i-1234567890abcdef0', issue: ISSUE_EC2_IDLE_INSTANCE, status: 'ACTIVE', aws_region: HOME, ended: false },
      { resource_id: 'i-1234567890abcdef0', issue: ISSUE_EC2_IDLE_INSTANCE, status: 'DISMISSED', aws_region: HOME, ended: false },
    ]);
  });
});

describe('F3: the per-resource pagers are bounded; the limit or a page error is unknown', () => {
  const endlessCloudWatch = () => withMockedSend(new CloudWatchClient({ region: HOME }), async () => ({ MetricDataResults: [], NextToken: 'more' }));

  it('DynamoDB metrics: a GetMetricData that never ends stops at the limit and is unavailable, not a series', async () => {
    const cw = endlessCloudWatch();
    const result = await capacityAnalysisUtil.fetchDynamoDBCapacityMetrics(cw, 'table-x');
    expect(result.status).toBe('unavailable');
    expect((cw.send as jest.Mock).mock.calls).toHaveLength(MAX_LISTING_PAGES);
  });

  it('DynamoDB metrics: a page that fails is unavailable', async () => {
    const cw = withMockedSend(new CloudWatchClient({ region: HOME }), async (command) => {
      if (command.input?.NextToken) throw awsError('ThrottlingException');
      return { MetricDataResults: [], NextToken: 'page-2' };
    });
    expect((await capacityAnalysisUtil.fetchDynamoDBCapacityMetrics(cw, 'table-x')).status).toBe('unavailable');
  });

  it('DynamoDB metrics control: a complete two-page answer is fetched', async () => {
    const cw = withMockedSend(new CloudWatchClient({ region: HOME }), async (command) =>
      command.input?.NextToken ? { MetricDataResults: [] } : { MetricDataResults: [], NextToken: 'page-2' }
    );
    expect((await capacityAnalysisUtil.fetchDynamoDBCapacityMetrics(cw, 'table-x')).status).toBe('fetched');
  });

  it('AWS Backup: recovery points that never end are unknown (null), never "no backup"', async () => {
    const backup = { send: jest.fn(async () => ({ RecoveryPoints: [{ Status: 'EXPIRED' }], NextToken: 'more' })) };
    expect(await checkAwsBackupRecoveryPoints(backup as any, 'arn:aws:ec2:us-east-1:123456789012:instance/i-1234567890abcdef0')).toBeNull();
    expect(backup.send).toHaveBeenCalledTimes(MAX_LISTING_PAGES);
  });

  it('AWS Backup: a page that fails is unknown; a qualifying point on page 2 is a backup; a complete listing without one is not', async () => {
    const arn = 'arn:aws:ec2:us-east-1:123456789012:instance/i-1234567890abcdef0';
    const failing = { send: jest.fn(async (command: any) => { if (command.input.NextToken) throw awsError('ServiceUnavailable'); return { RecoveryPoints: [], NextToken: 'p2' }; }) };
    expect(await checkAwsBackupRecoveryPoints(failing as any, arn)).toBeNull();
    const second = { send: jest.fn(async (command: any) => (command.input.NextToken ? { RecoveryPoints: [{ Status: 'COMPLETED' }], NextToken: 'p3' } : { RecoveryPoints: [], NextToken: 'p2' })) };
    expect(await checkAwsBackupRecoveryPoints(second as any, arn)).toBe(true);
    expect(second.send).toHaveBeenCalledTimes(2);
    const none = { send: jest.fn(async () => ({ RecoveryPoints: [{ Status: 'EXPIRED' }] })) };
    expect(await checkAwsBackupRecoveryPoints(none as any, arn)).toBe(false);
  });
});

describe('F4: createBulk and the RI replacement share one INSERT', () => {
  it('both write the same row for the same recommendation', async () => {
    const viaBulk = await insertOrg();
    const viaReplace = await insertOrg();
    const rec = { ...finding('ri-opportunity-m5.large', ISSUE_EC2_RESERVED_INSTANCE_OPPORTUNITY), potential_savings: 12.5, severity: 'MEDIUM' as const, metadata: { instance_type: 'm5.large' } };

    await repository.createBulk([rec], viaBulk);
    await repository.replaceReservedInstanceRecommendations(viaReplace, { homeRegion: HOME }, [rec]);

    const row = async (orgId: string) => (await pool.query(
      `SELECT resource_id, resource_name, resource_type, issue, description, potential_savings, severity, aws_region, metadata, status,
              occurrence_ended_at, resolved_at
         FROM cost_recommendations WHERE organization_id = $1`,
      [orgId]
    )).rows;
    const bulkRows = await row(viaBulk);
    expect(bulkRows).toHaveLength(1);
    expect(await row(viaReplace)).toEqual(bulkRows);
  });

  it('the repository has one INSERT for unconditional ACTIVE rows (static)', () => {
    const fs = jest.requireActual('fs') as typeof import('fs');
    const path = jest.requireActual('path') as typeof import('path');
    const text = fs.readFileSync(path.join(__dirname, '..', '..', 'repositories', 'cost-recommendations.repository.ts'), 'utf8');
    expect(text.match(/VALUES \(\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8, \$9, \$10\)\s+ON CONFLICT/g)).toHaveLength(1);
  });
});
