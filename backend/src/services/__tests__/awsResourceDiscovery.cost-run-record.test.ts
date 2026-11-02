/**
 * The discovery path's run record, and the rule that a failed cost step never
 * makes discovery itself look failed: other pages read the job's status as
 * discovery's own (activity feed, AI chat freshness, Services, coverage), so a
 * cost failure is carried by cost_analysis_completed and the run record only.
 * Same harness as awsResourceDiscovery.first-insight-funnel.test.ts, but with
 * every non-cost phase left to report nothing wrong: job status is asserted
 * against a baseline scan with the cost step healthy.
 */
import { Pool } from 'pg';
import { AWSResourceDiscoveryService } from '../awsResourceDiscovery';
import { AWSClientFactory } from '../aws-client-factory.service';
import { connectPlaceholderAccount, removePlaceholderAccounts, stubScanSource } from './helpers/scan-source';
import costOptimizationService from '../cost-optimization.service';
import { CostRecommendationsRepository } from '../../repositories/cost-recommendations.repository';
import { CostAnalysisRunsRepository } from '../../repositories/cost-analysis-runs.repository';
import { LeaseLostError } from '../scan-lease';
import type { DetectorObservation } from '../cost-optimization.service';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'platform_portal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});
const createdOrgIds: string[] = [];

async function insertOrg(): Promise<string> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $3, 'free', 'free') RETURNING id`,
    [`Cost Run Record Org ${suffix}`, `cost-run-record-org-${suffix}`, `Cost Run Record Org ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  await connectPlaceholderAccount(pool, rows[0].id);
  return rows[0].id;
}

function mockClients() {
  stubScanSource();
  jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue({
    enabled: true, region: 'us-east-1', costExplorer: {}, ec2: {}, rds: {}, s3: {}, cloudWatch: {}, lambda: {}, ecs: {}, elb: {}, eks: {},
    dynamodb: {}, cloudFront: {}, apiGateway: {}, elastiCache: {}, sqs: {}, sns: {}, iam: {}, resourceExplorer: {},
  } as any);
}

function mockAnalysis(observations: DetectorObservation[], riSucceeded = true) {
  return jest.spyOn(costOptimizationService, 'analyzeAllResources').mockResolvedValue({ observations, riRecommendations: [], riSucceeded, homeRegion: 'us-east-1' });
}

const retiredRds: DetectorObservation = { issue: 'Oversized Instance', success: true, recommendations: [] };
const finding = { resource_id: 'i-1234567890abcdef0', resource_name: 'x', resource_type: 'EC2', issue: 'Idle Instance', description: 'x', potential_savings: 1, severity: 'LOW', aws_region: 'us-east-1', metadata: {} } as any;

const fetchRun = async (orgId: string) =>
  (await pool.query(`SELECT * FROM cost_analysis_runs WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 1`, [orgId])).rows[0];
const fetchJob = async (orgId: string) =>
  (await pool.query(`SELECT * FROM resource_discovery_jobs WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 1`, [orgId])).rows[0];

async function scan(orgId: string) {
  return new AWSResourceDiscoveryService(pool).discoverAllResources(orgId);
}

afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await removePlaceholderAccounts(pool, createdOrgIds);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});

describe('discovery run record', () => {
  it('records a discovery run linked to its job, with the same counts as a manual one', async () => {
    const orgId = await insertOrg();
    mockClients();
    mockAnalysis([{ issue: 'Idle Instance', success: true, recommendations: [finding] }, retiredRds]);

    await scan(orgId);

    const [run, job] = [await fetchRun(orgId), await fetchJob(orgId)];
    expect(run).toMatchObject({ source: 'discovery', status: 'completed', discovery_job_id: job.id, detected_count: 1, persisted_count: 1, recommendations_found: 1 });
    expect(run.lease_acquired_at).not.toBeNull();
    expect(job.cost_analysis_completed).toBe(true);
  });

  it('the production shape: 2 detected, both suppressed, reads 2 detected and 0 persisted', async () => {
    const orgId = await insertOrg();
    mockClients();
    await pool.query(
      `INSERT INTO cost_recommendations (organization_id, resource_id, resource_type, issue, potential_savings, severity, status)
       VALUES ($1, 'i-1234567890abcdef0', 'EC2', 'Idle Instance', 1, 'LOW', 'RESOLVED'),
              ($1, 'placeholder-bucket', 'S3', 'S3 Lifecycle Optimization', 1, 'LOW', 'RESOLVED')`,
      [orgId]
    );
    mockAnalysis([
      { issue: 'Idle Instance', success: true, recommendations: [finding] },
      { issue: 'S3 Lifecycle Optimization', success: true, recommendations: [{ ...finding, resource_id: 'placeholder-bucket', resource_type: 'S3', issue: 'S3 Lifecycle Optimization' }] },
      retiredRds,
    ]);

    await scan(orgId);

    expect(await fetchRun(orgId)).toMatchObject({ status: 'completed', detected_count: 2, suppressed_resolved_count: 2, persisted_count: 0, recommendations_found: 0 });
  });

  it('partial: the cost step still counts as completed, and the job is untouched', async () => {
    const orgId = await insertOrg();
    mockClients();
    mockAnalysis([{ issue: 'Idle Instance', success: true, recommendations: [] }, { issue: 'Unused Elastic IP', success: false, recommendations: [] }, retiredRds]);
    await scan(orgId);
    expect(await fetchRun(orgId)).toMatchObject({ status: 'partial', failed_detector_count: 1 });
    expect((await fetchJob(orgId)).cost_analysis_completed).toBe(true);
  });

  it('a lost lease during the cost step leaves the run interrupted, and stops the scan', async () => {
    const orgId = await insertOrg();
    mockClients();
    jest.spyOn(costOptimizationService, 'analyzeAllResources').mockRejectedValue(new LeaseLostError('lease_lost', { table: 'job_leases', organizationId: orgId, jobName: 'placeholder' }));
    await expect(scan(orgId)).rejects.toBeInstanceOf(LeaseLostError);
    expect((await fetchRun(orgId)).status).toBe('interrupted');
  });

  it('a run write failure never touches the scan', async () => {
    const orgId = await insertOrg();
    mockClients();
    mockAnalysis([{ issue: 'Idle Instance', success: true, recommendations: [] }, retiredRds]);
    jest.spyOn(CostAnalysisRunsRepository.prototype, 'create').mockRejectedValue(new Error('write failed'));
    await expect(scan(orgId)).resolves.toBeDefined();
    expect((await fetchJob(orgId)).cost_analysis_completed).toBe(true);
  });

  it('closes a dead worker\'s run at the start of the scan', async () => {
    const orgId = await insertOrg();
    mockClients();
    mockAnalysis([{ issue: 'Idle Instance', success: true, recommendations: [] }, retiredRds]);
    const runs = new CostAnalysisRunsRepository();
    const dead = await runs.create(orgId);
    await runs.markLeaseAcquired(dead.id, orgId, new Date(Date.now() - 60_000));
    await scan(orgId);
    const { rows } = await pool.query(`SELECT status FROM cost_analysis_runs WHERE id = $1`, [dead.id]);
    expect(rows[0].status).toBe('interrupted');
  });
});

describe('a failed cost step does not make discovery look failed', () => {
  /** The job's status when the only thing that differs is the cost step. */
  async function baselineStatus(): Promise<string> {
    const orgId = await insertOrg();
    mockClients();
    mockAnalysis([{ issue: 'Idle Instance', success: true, recommendations: [] }, retiredRds]);
    await scan(orgId);
    const { status } = await fetchJob(orgId);
    jest.restoreAllMocks();
    return status;
  }

  it('every detector failed: job status unchanged, cost_analysis_completed false, run failed', async () => {
    const expected = await baselineStatus();
    const orgId = await insertOrg();
    mockClients();
    mockAnalysis([{ issue: 'Idle Instance', success: false, recommendations: [] }, retiredRds], false);

    const result = await scan(orgId);

    const job = await fetchJob(orgId);
    expect(job.status).toBe(expected);
    expect(job.cost_analysis_completed).toBe(false);
    expect(job.error_message).toContain('Cost analysis: no check completed');
    expect(result.errors.some((message) => message === 'Cost analysis: no check completed')).toBe(true);
    expect(await fetchRun(orgId)).toMatchObject({ status: 'failed', failed_detector_count: 2 });
  });

  it('the cost step threw: job status unchanged, cost_analysis_completed false, run failed', async () => {
    const expected = await baselineStatus();
    const orgId = await insertOrg();
    mockClients();
    jest.spyOn(costOptimizationService, 'analyzeAllResources').mockRejectedValue(new Error('detector boom'));
    jest.spyOn(CostRecommendationsRepository.prototype, 'getStats');

    await scan(orgId);

    const job = await fetchJob(orgId);
    expect(job.status).toBe(expected);
    expect(job.cost_analysis_completed).toBe(false);
    expect(job.error_message).toContain('Cost analysis: detector boom');
    expect(await fetchRun(orgId)).toMatchObject({ status: 'failed', detected_count: null });
  });
});
