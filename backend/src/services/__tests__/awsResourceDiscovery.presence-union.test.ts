/**
 * Multi-region plan M4c, Q6: the Resource Explorer reconcile counts a resource as
 * present when this scan's own listing returned it, even if the index does not have
 * it yet (index lag). Before, such an instance was counted missing, terminated after
 * two scans, and revived by the next upsert.
 *
 * Real Postgres for the persisted state; AWS clients are fakes (no AWS call is made).
 */
import { Pool } from 'pg';
import { ResourceExplorer2Client } from '@aws-sdk/client-resource-explorer-2';
import { AWSResourceDiscoveryService } from '../awsResourceDiscovery';
import { AWSClientFactory } from '../aws-client-factory.service';
import { connectPlaceholderAccount, removePlaceholderAccounts, stubScanSource } from './helpers/scan-source';
import costOptimizationService from '../cost-optimization.service';
import { ensureSharedFixtureTable } from '../../routes/__tests__/shared-fixture-tables';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'platform_portal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});
const createdOrgIds: string[] = [];
const INSTANCE_ID = 'i-1234567890abcdef0';
const INSTANCE_ARN = `arn:aws:ec2:us-east-1:*:instance/${INSTANCE_ID}`;

async function insertOrgWithInstanceMissingOnce(): Promise<string> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $3, 'free', 'active') RETURNING id`,
    [`Presence Union Org ${suffix}`, `presence-union-org-${suffix}`, `Presence Union Org ${suffix}`]
  );
  const orgId = rows[0].id as string;
  createdOrgIds.push(orgId);
  // A scan leases this account and its fences check it (multi-region plan M4b).
  await connectPlaceholderAccount(pool, orgId);
  await pool.query(
    `INSERT INTO aws_resources
       (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status, missing_scan_count)
     VALUES ($1, $2, $3, $3, 'ec2', 'us-east-1', 'running', 1)`,
    [orgId, INSTANCE_ARN, INSTANCE_ID]
  );
  return orgId;
}

function mockAwsClients(instances: Array<{ InstanceId: string }>) {
  stubScanSource();
  const ec2 = {
    send: jest.fn(async (command: { constructor: { name: string } }) => {
      switch (command.constructor.name) {
        case 'DescribeInstancesCommand': return { Reservations: [{ Instances: instances.map((i) => ({ ...i, State: { Name: 'running' } })) }] };
        case 'DescribeVolumesCommand': return { Volumes: [] };
        case 'DescribeSecurityGroupsCommand': return { SecurityGroups: [] };
        default: throw Object.assign(new Error('Unexpected'), { name: 'Unexpected' });
      }
    }),
  };
  // The index has not caught up: a complete, empty search.
  const resourceExplorer = new ResourceExplorer2Client({ region: 'us-east-1' });
  (resourceExplorer as any).send = jest.fn(async () => ({ Resources: [], Count: { TotalResources: 0, Complete: true } }));
  jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue({
    enabled: true, region: 'us-east-1', accountId: '123456789012',
    costExplorer: {}, ec2, rds: {}, s3: {}, s3Control: {}, cloudWatch: {}, lambda: {}, ecs: {}, elb: {}, eks: {}, dynamodb: {},
    cloudFront: {}, apiGateway: {}, elastiCache: {}, sqs: {}, sns: {}, iam: {}, resourceExplorer, backup: {},
    getDynamoDBClientForRegion: () => ({}), getApplicationAutoScalingClientForRegion: () => ({}), getCloudWatchClientForRegion: () => ({}),
  } as any);
  jest.spyOn(costOptimizationService, 'analyzeAllResources').mockResolvedValue({ observations: [], riRecommendations: [], riSucceeded: false });
}

async function instanceRow(orgId: string) {
  const { rows } = await pool.query(
    `SELECT status, missing_scan_count FROM aws_resources WHERE organization_id = $1 AND resource_arn = $2`,
    [orgId, INSTANCE_ARN]
  );
  return rows[0];
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
});

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM aws_resources WHERE organization_id = ANY($1)', [createdOrgIds]);
    await removePlaceholderAccounts(pool, createdOrgIds);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});

describe('Resource Explorer reconcile: presence from this scan\'s own listings', () => {
  it('an instance the own listing returned is present, though the index does not have it yet', async () => {
    const orgId = await insertOrgWithInstanceMissingOnce();
    mockAwsClients([{ InstanceId: INSTANCE_ID }]);

    await new AWSResourceDiscoveryService(pool).discoverAllResources(orgId);

    expect(await instanceRow(orgId)).toEqual({ status: 'running', missing_scan_count: 0 });
  });

  it('control: an instance neither the listing nor the index returned is still counted missing and terminated', async () => {
    const orgId = await insertOrgWithInstanceMissingOnce();
    mockAwsClients([]);

    await new AWSResourceDiscoveryService(pool).discoverAllResources(orgId);

    expect(await instanceRow(orgId)).toEqual({ status: 'terminated', missing_scan_count: 2 });
  });
});
