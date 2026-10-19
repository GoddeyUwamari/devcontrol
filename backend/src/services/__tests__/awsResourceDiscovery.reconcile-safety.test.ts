/**
 * Discovery never reconciles, deletes or replaces from an answer that may be
 * incomplete, and reads S3 in each bucket's own region (multi-region plan, PR M1):
 *
 *   - a Resource Explorer search that may have been cut off (Count.Complete
 *     false, or the 1,000-result limit reached) upserts what it returned but
 *     moves no row's missing_scan_count; the job still completes, with the
 *     deletion_detection_paused_truncated_index warning, and every "last
 *     refreshed" reader advances;
 *   - a failed Lambda, load balancer or CloudFront listing is recorded as a
 *     discovery error instead of passing as an empty account, and a failed
 *     CloudFront listing never reconciles CloudFront rows;
 *   - a bucket whose GetBucketLocation fails is still present (never counted
 *     missing), but no new row is written with a guessed region;
 *   - Reserved Instance recommendations are replaced only when the RI check
 *     completed, in the scheduled scan and in the manual analyze alike;
 *   - an S3 row's security evaluation uses a client for the bucket's region,
 *     and a row stored with the legacy 'EU' location is corrected to eu-west-1.
 *
 * Real Postgres for the persisted state. AWSClientFactory is mocked; every AWS
 * phase not under test fails fast inside its own try/catch, as in
 * awsResourceDiscovery.s3-security.test.ts. No real AWS call is made.
 */
import { Request, Response } from 'express';
import { Pool } from 'pg';
import { ResourceExplorer2Client, Resource as REResource } from '@aws-sdk/client-resource-explorer-2';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { ElasticLoadBalancingV2Client } from '@aws-sdk/client-elastic-load-balancing-v2';
import { CloudFrontClient } from '@aws-sdk/client-cloudfront';
import { AWSResourceDiscoveryService } from '../awsResourceDiscovery';
import { AWSClientFactory } from '../aws-client-factory.service';
import { ComplianceScannerService } from '../complianceScanner';
import { ResourceExplorerService, SEARCH_RESULT_LIMIT } from '../resourceExplorer.service';
import costOptimizationService from '../cost-optimization.service';
import { CostRecommendationsRepository } from '../../repositories/cost-recommendations.repository';
import { CostRecommendationsController } from '../../controllers/cost-recommendations.controller';
import { ISSUE_EC2_RESERVED_INSTANCE_OPPORTUNITY } from '../../config/optimization-rules';
import { DISCOVERY_WARNING_TRUNCATED_INDEX } from '../discovery-warnings';
import { AWSResourcesRepository } from '../../repositories/awsResources.repository';
import { ServicesIntelligenceRepository } from '../../repositories/services-intelligence.repository';
import { AIChatContextRepository } from '../../repositories/ai-chat-context.repository';
import { ActivityFeedService } from '../activity-feed.service';
import { ensureSharedFixtureTable } from '../../routes/__tests__/shared-fixture-tables';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'platform_portal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});
const createdOrgIds: string[] = [];
const ACCOUNT_ID = '111122223333';
const INSTANCE_ID = 'i-1234567890abcdef0';
const INSTANCE_ARN = `arn:aws:ec2:us-east-1:*:instance/${INSTANCE_ID}`;

function withMockedSend<T extends { send: (...args: any[]) => any }>(client: T, send: jest.Mock): T {
  (client as any).send = send;
  return client;
}

const awsError = (name: string) => Object.assign(new Error(name), { name });

async function insertOrg(tier: 'free' | 'starter' = 'free'): Promise<string> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
    [`Reconcile Safety Org ${suffix}`, `reconcile-safety-org-${suffix}`, `Reconcile Safety Org ${suffix}`, tier]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

/** An EC2 row already missing from one scan: one more absence terminates it. */
async function insertInstanceMissingOnce(orgId: string): Promise<void> {
  await pool.query(
    `INSERT INTO aws_resources
       (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status, missing_scan_count)
     VALUES ($1, $2, $3, $3, 'ec2', 'us-east-1', 'running', 1)`,
    [orgId, INSTANCE_ARN, INSTANCE_ID]
  );
}

async function instanceRow(orgId: string) {
  const { rows } = await pool.query(
    `SELECT status, missing_scan_count FROM aws_resources WHERE organization_id = $1 AND resource_arn = $2`,
    [orgId, INSTANCE_ARN]
  );
  return rows[0];
}

async function latestJob(orgId: string) {
  const { rows } = await pool.query(
    `SELECT status, error_message FROM resource_discovery_jobs WHERE organization_id = $1 ORDER BY started_at DESC LIMIT 1`,
    [orgId]
  );
  return rows[0];
}

function vpc(n: number): REResource {
  return { Arn: `arn:aws:ec2:us-east-1:${ACCOUNT_ID}:vpc/vpc-0000000${n}`, Region: 'us-east-1', Service: 'ec2', CfnResourceType: 'AWS::EC2::VPC', Properties: [] };
}

function resourceExplorer(page: { Resources: REResource[]; Count?: { TotalResources?: number; Complete?: boolean } }) {
  return withMockedSend(new ResourceExplorer2Client({ region: 'us-east-1' }), jest.fn().mockResolvedValue(page));
}

function mockAwsClients(overrides: Record<string, unknown> = {}) {
  return jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue({
    enabled: true,
    region: 'us-east-1',
    accountId: ACCOUNT_ID,
    costExplorer: {}, ec2: {}, rds: {}, s3: {}, s3Control: {}, cloudWatch: {}, lambda: {}, ecs: {}, elb: {}, eks: {}, dynamodb: {},
    cloudFront: {}, apiGateway: {}, elastiCache: {}, sqs: {}, sns: {}, iam: {}, resourceExplorer: {},
    getDynamoDBClientForRegion: () => ({}), getApplicationAutoScalingClientForRegion: () => ({}), getCloudWatchClientForRegion: () => ({}),
    ...overrides,
  } as any);
}

function mockCostAnalysis() {
  jest.spyOn(costOptimizationService, 'analyzeAllResources').mockResolvedValue({ observations: [], riRecommendations: [], riSucceeded: true });
  jest.spyOn(CostRecommendationsRepository.prototype, 'reconcileActiveRecommendations').mockResolvedValue({ insertedCount: 0 });
  jest.spyOn(CostRecommendationsRepository.prototype, 'deleteActiveByIssue').mockResolvedValue(0);
  jest.spyOn(CostRecommendationsRepository.prototype, 'createBulk').mockResolvedValue(0);
}

// One "last refreshed" reader, ServicesIntelligenceRepository, reads aws_accounts.
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
});

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM cost_recommendations WHERE organization_id = ANY($1)', [createdOrgIds]);
    await pool.query('DELETE FROM aws_resources WHERE organization_id = ANY($1)', [createdOrgIds]);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});

describe('ResourceExplorerService.search: completeness', () => {
  const explorer = new ResourceExplorerService();

  it('is complete when AWS says the count is exhaustive and the result is under the limit', async () => {
    const result = await explorer.search(resourceExplorer({ Resources: [vpc(1)], Count: { TotalResources: 1, Complete: true } }), 'us-east-1');
    expect(result).toMatchObject({ success: true, complete: true });
  });

  it('is incomplete when AWS reports the count as not exhaustive', async () => {
    const result = await explorer.search(resourceExplorer({ Resources: [vpc(1)], Count: { TotalResources: 1000, Complete: false } }), 'us-east-1');
    expect(result).toMatchObject({ success: true, complete: false });
  });

  it('is incomplete when the result reaches the 1,000-result limit, whatever the count says', async () => {
    const resources = Array.from({ length: SEARCH_RESULT_LIMIT }, (_, i) => ({ ...vpc(1), Arn: `arn:aws:sns:us-east-1:${ACCOUNT_ID}:topic-${i}` }));
    const result = await explorer.search(resourceExplorer({ Resources: resources }), 'us-east-1');
    expect(result).toMatchObject({ success: true, complete: false });
  });
});

describe('discovery: a Resource Explorer search that may be truncated never reconciles', () => {
  it('upserts what the search returned, leaves missing_scan_count and status alone, and records why', async () => {
    // A tier whose types include vpc, so the returned resource is upserted.
    const orgId = await insertOrg('starter');
    await insertInstanceMissingOnce(orgId);
    mockAwsClients({ resourceExplorer: resourceExplorer({ Resources: [vpc(1)], Count: { TotalResources: 1000, Complete: false } }) });
    mockCostAnalysis();

    const result = await new AWSResourceDiscoveryService(pool).discoverAllResources(orgId);

    expect(await instanceRow(orgId)).toEqual({ status: 'running', missing_scan_count: 1 });
    const { rows: vpcs } = await pool.query(
      `SELECT 1 FROM aws_resources WHERE organization_id = $1 AND resource_arn = $2`,
      [orgId, vpc(1).Arn]
    );
    expect(vpcs).toHaveLength(1);
    expect(result.warnings).toEqual([DISCOVERY_WARNING_TRUNCATED_INDEX]);
    expect(result.errors.some((error) => error.startsWith('Resource Explorer: '))).toBe(false);
    expect((await latestJob(orgId)).error_message.split('; ')).toContain(DISCOVERY_WARNING_TRUNCATED_INDEX);
  });

  it('otherwise clean: the job completes with the warning, nothing is terminated, and every "last refreshed" reader advances', async () => {
    const orgId = await insertOrg();
    await insertInstanceMissingOnce(orgId);
    // An earlier completed run, so "advances" is observable.
    const earlier = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO resource_discovery_jobs (organization_id, status, started_at, completed_at, created_at)
       VALUES ($1, 'completed', $2, $2, $2)`,
      [orgId, earlier]
    );
    // Every other step of the scan succeeds, finding nothing.
    for (const method of ['discoverEC2Instances', 'discoverEBSVolumes', 'discoverRDSDatabases', 'discoverS3Buckets']) {
      jest.spyOn(AWSResourceDiscoveryService.prototype as any, method).mockResolvedValue([]);
    }
    jest.spyOn(ComplianceScannerService.prototype, 'checkSecurityGroups').mockResolvedValue({ category: 'networking', complete: true, issues: [] } as any);
    jest.spyOn(ComplianceScannerService.prototype, 'checkIAMSecurity').mockResolvedValue({ category: 'iam', complete: true, issues: [] } as any);
    mockAwsClients({ resourceExplorer: resourceExplorer({ Resources: [vpc(1)], Count: { TotalResources: 1000, Complete: false } }) });
    mockCostAnalysis();

    const result = await new AWSResourceDiscoveryService(pool).discoverAllResources(orgId);

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([DISCOVERY_WARNING_TRUNCATED_INDEX]);
    expect(result.resources_deleted).toBe(0);
    expect(await instanceRow(orgId)).toEqual({ status: 'running', missing_scan_count: 1 });

    const { rows: [job] } = await pool.query(
      `SELECT status, error_message, completed_at FROM resource_discovery_jobs
        WHERE organization_id = $1 ORDER BY started_at DESC LIMIT 1`,
      [orgId]
    );
    expect(job.status).toBe('completed');
    expect(job.error_message).toBe(DISCOVERY_WARNING_TRUNCATED_INDEX);
    expect(job.completed_at.getTime()).toBeGreaterThan(earlier.getTime());

    // GET /api/aws-resources/discovery/jobs: a structured warning, no error.
    const [listed] = await new AWSResourcesRepository(pool).getDiscoveryJobs(orgId, 1);
    expect(listed).toMatchObject({ status: 'completed', error_message: null, warnings: [DISCOVERY_WARNING_TRUNCATED_INDEX] });

    // Services intelligence's inventory_refreshed_at.
    const intelligence = await new ServicesIntelligenceRepository().readWith(pool, orgId);
    expect(new Date(intelligence.inventoryRefreshedAt!).getTime()).toBe(job.completed_at.getTime());
    // The AI chat's last successful scan.
    const freshness = await (new AIChatContextRepository(pool) as any).getDiscoveryFreshness(orgId);
    expect(freshness).toMatchObject({ state: 'available', data: { completedAt: job.completed_at.toISOString() } });
    // The activity feed's latest sync event.
    const [latestSync] = await (new ActivityFeedService() as any).getSyncEvents(pool, orgId);
    expect(latestSync.timestamp).toBe(job.completed_at.toISOString());
  });

  it('control: the same absence in a complete search terminates the row', async () => {
    const orgId = await insertOrg();
    await insertInstanceMissingOnce(orgId);
    mockAwsClients({ resourceExplorer: resourceExplorer({ Resources: [vpc(1)], Count: { TotalResources: 1, Complete: true } }) });
    mockCostAnalysis();

    await new AWSResourceDiscoveryService(pool).discoverAllResources(orgId);

    expect(await instanceRow(orgId)).toEqual({ status: 'terminated', missing_scan_count: 2 });
  });
});

const DISTRIBUTION_ARN = 'arn:aws:cloudfront::111122223333:distribution/EDFDVBD6EXAMPLE';

async function cloudFrontRow(orgId: string) {
  const { rows } = await pool.query(
    `SELECT status, missing_scan_count FROM aws_resources WHERE organization_id = $1 AND resource_arn = $2`,
    [orgId, DISTRIBUTION_ARN]
  );
  return rows[0];
}

describe('discovery: a failed CloudFront listing never reconciles CloudFront rows', () => {
  async function insertDistribution(orgId: string): Promise<void> {
    await pool.query(
      `INSERT INTO aws_resources
         (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status, missing_scan_count)
       VALUES ($1, $2, 'EDFDVBD6EXAMPLE', 'EDFDVBD6EXAMPLE', 'cloudfront', 'global', 'active', 0)`,
      [orgId, DISTRIBUTION_ARN]
    );
  }

  it.each([
    ['the first page fails', () => jest.fn().mockRejectedValue(awsError('AccessDenied'))],
    [
      'a later page fails',
      () =>
        jest.fn()
          .mockResolvedValueOnce({ DistributionList: { Items: [], IsTruncated: true, NextMarker: 'page-2' } })
          .mockRejectedValueOnce(awsError('ThrottlingException')),
    ],
    [
      'a page claims more but gives no marker',
      () => jest.fn().mockResolvedValue({ DistributionList: { Items: [], IsTruncated: true } }),
    ],
  ])('%s, twice in a row: nothing terminated, missing_scan_count unchanged, each failure recorded', async (_label, send) => {
    const orgId = await insertOrg('starter');
    await insertDistribution(orgId);
    mockCostAnalysis();

    for (let run = 0; run < 2; run++) {
      mockAwsClients({ cloudFront: withMockedSend(new CloudFrontClient({ region: 'us-east-1' }), send()) });
      await new AWSResourceDiscoveryService(pool).discoverAllResources(orgId);

      const job = await latestJob(orgId);
      expect(job.status).toBe('failed');
      expect(job.error_message.split('; ').some((segment: string) => segment.startsWith('CloudFront: '))).toBe(true);
      expect(job.error_message).not.toContain('CloudFront reconciliation');
    }

    expect(await cloudFrontRow(orgId)).toEqual({ status: 'active', missing_scan_count: 0 });
  });

  it('control: two complete listings without it terminate it', async () => {
    const orgId = await insertOrg('starter');
    await insertDistribution(orgId);
    mockCostAnalysis();

    for (let run = 0; run < 2; run++) {
      mockAwsClients({
        cloudFront: withMockedSend(new CloudFrontClient({ region: 'us-east-1' }), jest.fn().mockResolvedValue({ DistributionList: { Items: [] } })),
      });
      await new AWSResourceDiscoveryService(pool).discoverAllResources(orgId);
    }

    expect(await cloudFrontRow(orgId)).toEqual({ status: 'terminated', missing_scan_count: 2 });
  });
});

describe('discovery: a bucket whose region cannot be read', () => {
  it('stays present when already stored, and is not written with a guessed region when new', async () => {
    const orgId = await insertOrg();
    await pool.query(
      `INSERT INTO aws_resources
         (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status, missing_scan_count)
       VALUES ($1, 'arn:aws:s3:::stored-bucket', 'stored-bucket', 'stored-bucket', 's3', 'ap-southeast-2', 'not_applicable', 1)`,
      [orgId]
    );
    const home = {
      send: jest.fn(async (command: { constructor: { name: string } }) => {
        switch (command.constructor.name) {
          case 'ListBucketsCommand': return { Buckets: [{ Name: 'stored-bucket' }, { Name: 'new-bucket' }] };
          case 'GetBucketLocationCommand': throw awsError('AccessDenied');
          default: throw awsError('AccessDenied');
        }
      }),
    };
    mockAwsClients({ s3: home, resourceExplorer: resourceExplorer({ Resources: [], Count: { TotalResources: 0, Complete: true } }) });
    mockCostAnalysis();

    await new AWSResourceDiscoveryService(pool).discoverAllResources(orgId);

    const { rows } = await pool.query(
      `SELECT resource_id, region, status, missing_scan_count FROM aws_resources
        WHERE organization_id = $1 AND resource_type = 's3' ORDER BY resource_id`,
      [orgId]
    );
    // Listed, so present (its missing count resets); its stored region is kept.
    // The new bucket has no row: its region would have been a guess.
    expect(rows).toEqual([{ resource_id: 'stored-bucket', region: 'ap-southeast-2', status: 'not_applicable', missing_scan_count: 0 }]);
  });
});

describe('discovery: a failed Lambda or load balancer listing is a recorded failure, not an empty account', () => {
  it('records both failures on the job', async () => {
    const orgId = await insertOrg('starter');
    mockAwsClients({
      lambda: withMockedSend(new LambdaClient({ region: 'us-east-1' }), jest.fn().mockRejectedValue(awsError('ServiceUnavailableException'))),
      elb: withMockedSend(new ElasticLoadBalancingV2Client({ region: 'us-east-1' }), jest.fn().mockRejectedValue(awsError('AccessDenied'))),
    });
    mockCostAnalysis();

    await new AWSResourceDiscoveryService(pool).discoverAllResources(orgId);

    const job = await latestJob(orgId);
    expect(job.status).toBe('failed');
    expect(job.error_message).toContain('Lambda: ServiceUnavailableException');
    expect(job.error_message).toContain('Load Balancer: AccessDenied');
  });
});

async function insertActiveRiRecommendation(orgId: string): Promise<void> {
  await pool.query(
    `INSERT INTO cost_recommendations (organization_id, resource_id, resource_name, resource_type, issue, severity, aws_region, status)
     VALUES ($1, 'ri-opportunity-m5.large', '2 uncovered × m5.large', 'EC2', $2, 'LOW', 'us-east-1', 'ACTIVE')`,
    [orgId, ISSUE_EC2_RESERVED_INSTANCE_OPPORTUNITY]
  );
}

async function activeRiCount(orgId: string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM cost_recommendations WHERE organization_id = $1 AND issue = $2 AND status = 'ACTIVE'`,
    [orgId, ISSUE_EC2_RESERVED_INSTANCE_OPPORTUNITY]
  );
  return rows[0].count;
}

describe('Reserved Instance recommendations are replaced only when the RI check completed', () => {
  it('scheduled scan: a failed RI check leaves the stored RI recommendation ACTIVE', async () => {
    const orgId = await insertOrg();
    await insertActiveRiRecommendation(orgId);
    // Real cost analysis: every detector's EC2 call fails (the client has no send).
    mockAwsClients({ resourceExplorer: resourceExplorer({ Resources: [], Count: { TotalResources: 0, Complete: true } }) });

    await new AWSResourceDiscoveryService(pool).discoverAllResources(orgId);

    expect(await activeRiCount(orgId)).toBe(1);
  });

  it('scheduled scan control: a completed RI check that finds nothing removes it', async () => {
    const orgId = await insertOrg();
    await insertActiveRiRecommendation(orgId);
    mockAwsClients({ resourceExplorer: resourceExplorer({ Resources: [], Count: { TotalResources: 0, Complete: true } }) });
    jest.spyOn(costOptimizationService as any, 'detectReservedInstanceOpportunities').mockResolvedValue({ success: true, issues: [] });

    await new AWSResourceDiscoveryService(pool).discoverAllResources(orgId);

    expect(await activeRiCount(orgId)).toBe(0);
  });

  it.each([
    [false, 1],
    [true, 0],
  ])('manual analyze: riSucceeded=%p leaves %p ACTIVE RI recommendation(s)', async (riSucceeded, expected) => {
    const orgId = await insertOrg();
    await insertActiveRiRecommendation(orgId);
    jest.spyOn(costOptimizationService, 'analyzeAllResources').mockResolvedValue({ observations: [], riRecommendations: [], riSucceeded });
    const json = jest.fn();
    const req = { user: { organizationId: orgId, userId: 'test-user' }, query: {}, params: {}, body: {} } as unknown as Request;
    const res = { json, status: jest.fn().mockReturnValue({ json }) } as unknown as Response;

    await new CostRecommendationsController().analyze(req, res);

    expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(await activeRiCount(orgId)).toBe(expected);
  });
});

describe("discovery: S3 is evaluated in each bucket's own region", () => {
  it("corrects a stored 'EU' region to eu-west-1 and evaluates the bucket with the eu-west-1 client", async () => {
    const orgId = await insertOrg();
    await pool.query(
      `INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status)
       VALUES ($1, 'arn:aws:s3:::legacy-eu-bucket', 'legacy-eu-bucket', 'legacy-eu-bucket', 's3', 'EU', 'active')`,
      [orgId]
    );
    const home = {
      send: jest.fn(async (command: { constructor: { name: string } }) => {
        switch (command.constructor.name) {
          case 'ListBucketsCommand': return { Buckets: [{ Name: 'legacy-eu-bucket' }] };
          case 'GetBucketLocationCommand': return { LocationConstraint: 'EU' };
          default: throw awsError('PermanentRedirect');
        }
      }),
    };
    const euWest1 = { send: jest.fn(async () => { throw awsError('AccessDenied'); }) };
    const regionsAsked: string[] = [];
    mockAwsClients({
      s3: home,
      getS3ClientForRegion: (region: string) => { regionsAsked.push(region); return euWest1; },
      resourceExplorer: resourceExplorer({ Resources: [], Count: { TotalResources: 0, Complete: true } }),
    });
    mockCostAnalysis();
    const evaluateSpy = jest.spyOn(ComplianceScannerService.prototype, 'evaluateS3Security');

    await new AWSResourceDiscoveryService(pool).discoverAllResources(orgId);

    const { rows } = await pool.query(
      `SELECT region FROM aws_resources WHERE organization_id = $1 AND resource_id = 'legacy-eu-bucket'`,
      [orgId]
    );
    expect(rows).toEqual([{ region: 'eu-west-1' }]);
    expect(evaluateSpy).toHaveBeenCalledTimes(1);
    // The eu-west-1 client, with discovery's call policy around its send.
    expect(Object.getPrototypeOf(evaluateSpy.mock.calls[0][1])).toBe(euWest1);
    expect(new Set(regionsAsked)).toEqual(new Set(['eu-west-1']));
    // The home client was asked only to list buckets and locate this one.
    expect(home.send.mock.calls.map(([command]) => command.constructor.name).sort()).toEqual(['GetBucketLocationCommand', 'ListBucketsCommand']);
  });
});
