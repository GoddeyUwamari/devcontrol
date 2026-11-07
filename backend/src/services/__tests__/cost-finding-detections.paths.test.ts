/**
 * PR 3a end to end on both cost analysis paths: a hidden finding a successful
 * detector detects is recorded under that analysis's own run, and reads still
 * detected once the run has finished. Real Postgres; only AWS is mocked.
 */
import { Request, Response } from 'express';
import { Pool } from 'pg';
import { ResourceExplorer2Client } from '@aws-sdk/client-resource-explorer-2';
import { CostRecommendationsController } from '../../controllers/cost-recommendations.controller';
import { CostRecommendationsRepository } from '../../repositories/cost-recommendations.repository';
import { AWSResourceDiscoveryService } from '../awsResourceDiscovery';
import { AWSClientFactory } from '../aws-client-factory.service';
import costOptimizationService, { DetectorObservation } from '../cost-optimization.service';
import { connectPlaceholderAccount, removePlaceholderAccounts, stubScanSource } from './helpers/scan-source';
import { ensureSharedFixtureTable } from '../../routes/__tests__/shared-fixture-tables';
import type { CreateRecommendationRequest } from '../../types';
import { lowActivityMetadata } from './helpers/low-activity-fixture';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'platform_portal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});
const repository = new CostRecommendationsRepository();
const createdOrgIds: string[] = [];
const HOME = 'us-east-1';
const IDLE = 'Idle Instance';
const RESOURCE = 'i-1234567890abcdef0';

async function insertOrg(): Promise<string> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $1, 'free', 'active') RETURNING id`,
    [`Detection Paths Org ${suffix}`, `detection-paths-org-${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  await connectPlaceholderAccount(pool, rows[0].id);
  await pool.query(
    `INSERT INTO cost_recommendations (organization_id, resource_id, resource_type, issue, potential_savings, severity, status, aws_region, updated_at)
     VALUES ($1, $2, 'EC2', $3, 1, 'LOW', 'RESOLVED', $4, '2026-09-03T18:54:05Z')`,
    [rows[0].id, RESOURCE, IDLE, HOME]
  );
  return rows[0].id;
}

const finding: CreateRecommendationRequest = {
  resource_id: RESOURCE, resource_name: 'placeholder', resource_type: 'EC2', issue: IDLE, description: 'placeholder',
  potential_savings: 12.5, severity: 'LOW', aws_region: HOME,
  // What the low-activity rule writes (FP PR 2b): only such an Idle detection reads still detected.
  metadata: { ...lowActivityMetadata(), savings_basis: 'estimated: placeholder' },
};
const observations: DetectorObservation[] = [{ issue: IDLE, success: true, recommendations: [finding] }];

function mockDetectors() {
  jest.spyOn(costOptimizationService, 'analyzeAllResources').mockResolvedValue({
    observations, riRecommendations: [], riSucceeded: true, homeRegion: HOME,
  });
}

const detection = async (orgId: string) =>
  (await pool.query('SELECT run_id, outcome FROM cost_finding_detections WHERE organization_id = $1 AND resource_id = $2', [orgId, RESOURCE])).rows[0];
const runsOf = async (orgId: string) =>
  (await pool.query('SELECT id, source, status FROM cost_analysis_runs WHERE organization_id = $1 ORDER BY created_at', [orgId])).rows;

beforeAll(async () => {
  await ensureSharedFixtureTable(pool, 'aws_accounts');
});

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM aws_resources WHERE organization_id = ANY($1)', [createdOrgIds]);
    await removePlaceholderAccounts(pool, createdOrgIds);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});

it('manual Analyze records the detection under its own run, and the finding reads still detected', async () => {
  const orgId = await insertOrg();
  mockDetectors();
  const req = { user: { organizationId: orgId, userId: 'test-user' }, query: {}, params: {}, body: {} } as unknown as Request;
  const json = jest.fn();
  const res = { json, status: jest.fn().mockReturnValue({ json }) } as unknown as Response;

  await new CostRecommendationsController().analyze(req, res);

  const [run] = await runsOf(orgId);
  expect(run).toMatchObject({ source: 'manual', status: 'completed' });
  expect(await detection(orgId)).toEqual({ run_id: run.id, outcome: 'detected' });
  const hidden = await repository.getHiddenFindings(orgId);
  expect(hidden.latestRun?.id).toBe(run.id);
  expect(hidden.items[0].detection.state).toBe('still_detected');
});

it('a scheduled discovery scan records the detection under its own run, and the finding reads still detected', async () => {
  const orgId = await insertOrg();
  stubScanSource();
  const empty = new ResourceExplorer2Client({ region: HOME });
  (empty as any).send = jest.fn(async () => ({ Resources: [], Count: { TotalResources: 0, Complete: true } }));
  jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue({
    enabled: true, region: HOME, accountId: '123456789012',
    costExplorer: {}, ec2: {}, rds: {}, s3: {}, s3Control: {}, cloudWatch: {}, lambda: {}, ecs: {}, elb: {}, eks: {}, dynamodb: {},
    cloudFront: {}, apiGateway: {}, elastiCache: {}, sqs: {}, sns: {}, iam: {}, resourceExplorer: empty, backup: {},
    getDynamoDBClientForRegion: () => ({}), getApplicationAutoScalingClientForRegion: () => ({}), getCloudWatchClientForRegion: () => ({}),
  } as any);
  mockDetectors();

  await new AWSResourceDiscoveryService(pool).discoverAllResources(orgId);

  const [run] = await runsOf(orgId);
  expect(run).toMatchObject({ source: 'discovery', status: 'completed' });
  expect(await detection(orgId)).toEqual({ run_id: run.id, outcome: 'detected' });
  expect((await repository.getHiddenFindings(orgId)).items[0].detection.state).toBe('still_detected');
});
