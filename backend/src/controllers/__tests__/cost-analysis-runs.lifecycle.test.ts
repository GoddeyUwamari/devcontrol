/**
 * The manual path's run record: run states, reconciling counts, lease-aware
 * recovery, and what GET /analysis-runs tells existing and new readers. Real
 * Postgres; only the AWS-touching analyzeAllResources() is mocked.
 */
import { Request, Response } from 'express';
import { Pool } from 'pg';
import { CostRecommendationsController } from '../cost-recommendations.controller';
import { CostRecommendationsRepository } from '../../repositories/cost-recommendations.repository';
import { CostAnalysisRunsRepository, QUEUED_RUN_TIMEOUT_SECONDS } from '../../repositories/cost-analysis-runs.repository';
import costOptimizationService from '../../services/cost-optimization.service';
import * as scanSession from '../../services/scan-session';
import { acquireScanLease, releaseLease } from '../../services/scan-lease';
import { LeaseLostError } from '../../services/scan-lease';
import { connectPlaceholderAccount, PLACEHOLDER_ACCOUNT_ROW, removePlaceholderAccounts } from '../../services/__tests__/helpers/scan-source';
import type { DetectorObservation } from '../../services/cost-optimization.service';
import type { CreateRecommendationRequest } from '../../types';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'platform_portal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});
const createdOrgIds: string[] = [];
const runs = new CostAnalysisRunsRepository();

async function insertOrg(): Promise<string> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $3, 'free', 'free') RETURNING id`,
    [`Run Lifecycle Org ${suffix}`, `run-lifecycle-org-${suffix}`, `Run Lifecycle Org ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  await connectPlaceholderAccount(pool, rows[0].id);
  return rows[0].id;
}

function mockReqRes(organizationId: string, query: Record<string, string> = {}) {
  const req = { user: { organizationId, userId: 'test-user' }, query, params: {}, body: {} } as unknown as Request;
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { json, status } as unknown as Response;
  return { req, res, json, status };
}

const fetchRuns = async (orgId: string) =>
  (await pool.query(`SELECT * FROM cost_analysis_runs WHERE organization_id = $1 ORDER BY created_at ASC`, [orgId])).rows;

const finding = (id: string): CreateRecommendationRequest => ({
  resource_id: id,
  resource_name: id,
  resource_type: 'EC2',
  issue: 'Idle Instance',
  description: 'placeholder',
  potential_savings: 1,
  severity: 'LOW',
  aws_region: 'us-east-1',
  metadata: { savings_basis: 'estimated: placeholder' },
});

function mockAnalysis(observations: DetectorObservation[], riSucceeded = true) {
  return jest.spyOn(costOptimizationService, 'analyzeAllResources').mockResolvedValue({
    observations,
    riRecommendations: [],
    riSucceeded,
    homeRegion: 'us-east-1',
  });
}

const retiredRds: DetectorObservation = { issue: 'Oversized Instance', success: true, recommendations: [] };

async function analyze(orgId: string) {
  const call = mockReqRes(orgId);
  await new CostRecommendationsController().analyze(call.req, call.res);
  return call;
}

async function list(orgId: string, query: Record<string, string> = {}) {
  const call = mockReqRes(orgId, query);
  await new CostRecommendationsController().getAnalysisRuns(call.req, call.res);
  return call.json.mock.calls[0][0].data;
}

async function holdLease(orgId: string) {
  return scanSession.onTaggedConnection(pool, orgId, (client) =>
    acquireScanLease(client, { organizationId: orgId, awsAccountId: PLACEHOLDER_ACCOUNT_ROW.account_id!, scanKind: scanSession.SCAN_KIND_DISCOVERY }, 'other-worker')
  );
}

afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await removePlaceholderAccounts(pool, createdOrgIds);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});

describe('run states', () => {
  it('completed: records source, counts and checks', async () => {
    const orgId = await insertOrg();
    mockAnalysis([{ issue: 'Idle Instance', success: true, recommendations: [finding('i-a')] }, retiredRds]);
    const { res } = await analyze(orgId);
    const [run] = await fetchRuns(orgId);

    expect(run).toMatchObject({
      status: 'completed', source: 'manual', detected_count: 1, new_count: 1, refreshed_count: 0,
      suppressed_resolved_count: 0, suppressed_dismissed_count: 0, duplicate_count: 0, persisted_count: 1,
      failed_detector_count: 0, unknown_resource_count: 0, recommendations_found: 1,
    });
    expect(run.checks.map((c: any) => c.issue)).toEqual(['Idle Instance', 'Reserved Instance Opportunity']);
    expect(run.lease_acquired_at).not.toBeNull();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ recommendationsFound: 1, runState: 'completed', counts: expect.objectContaining({ detected: 1 }) }),
    }));
  });

  it('partial: some detectors failed; the response says so', async () => {
    const orgId = await insertOrg();
    mockAnalysis([{ issue: 'Idle Instance', success: true, recommendations: [] }, { issue: 'Unused Elastic IP', success: false, recommendations: [] }, retiredRds]);
    const { json } = await analyze(orgId);
    const [run] = await fetchRuns(orgId);
    expect(run).toMatchObject({ status: 'partial', failed_detector_count: 1 });
    expect(json.mock.calls[0][0].data.runState).toBe('partial');
  });

  it('failed: every real detector failed, and no success or "found 0" is reported', async () => {
    const orgId = await insertOrg();
    mockAnalysis([{ issue: 'Idle Instance', success: false, recommendations: [] }, retiredRds], false);
    const { status, json } = await analyze(orgId);
    const [run] = await fetchRuns(orgId);

    expect(run).toMatchObject({ status: 'failed', failed_detector_count: 2, detected_count: 0 });
    expect(run.checks).toHaveLength(2);
    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledTimes(1);
    expect(json).toHaveBeenCalledWith({ success: false, error: 'None of the cost checks could complete. Try again.' });
  });

  it('failed: analysis without the scan lease saved nothing, so it does not report success', async () => {
    const orgId = await insertOrg();
    jest.spyOn(scanSession, 'leaseAccountFor').mockResolvedValue(null);
    mockAnalysis([{ issue: 'Idle Instance', success: true, recommendations: [finding('i-a')] }, retiredRds]);
    const { status, json } = await analyze(orgId);
    const [run] = await fetchRuns(orgId);

    expect(run).toMatchObject({ status: 'failed', detected_count: null, persisted_count: null });
    expect(run.error_message).toContain('COST_RESULTS_NOT_SAVED');
    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith({ success: false, error: 'The analysis ran, but its results could not be saved. Try again.' });
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS count FROM cost_recommendations WHERE organization_id = $1`, [orgId]);
    expect(rows[0].count).toBe(0);
    expect((await list(orgId))[0].error_message).toBe('The analysis ran, but its results could not be saved. Try again.');
  });

  it('interrupted: a lease lost mid-run is not a failure of the analysis', async () => {
    const orgId = await insertOrg();
    jest.spyOn(costOptimizationService, 'analyzeAllResources').mockRejectedValue(new LeaseLostError('lease_lost', { table: 'job_leases', organizationId: orgId, jobName: 'placeholder' }));
    const { status } = await analyze(orgId);
    const [run] = await fetchRuns(orgId);
    expect(run.status).toBe('interrupted');
    expect(status).toHaveBeenCalledWith(409);
  });

  it('counts that are not known stay NULL, never 0', async () => {
    const orgId = await insertOrg();
    mockAnalysis([{ issue: 'Idle Instance', success: true, recommendations: [] }, retiredRds]);
    jest.spyOn(CostRecommendationsRepository.prototype, 'reconcileActiveRecommendations').mockResolvedValue({ insertedCount: 0 });
    await analyze(orgId);
    expect((await fetchRuns(orgId))[0]).toMatchObject({ status: 'completed', detected_count: null, persisted_count: null, suppressed_resolved_count: null, failed_detector_count: 0 });
  });

  it('a run write failure never fails the analysis', async () => {
    const orgId = await insertOrg();
    mockAnalysis([{ issue: 'Idle Instance', success: true, recommendations: [] }, retiredRds]);
    jest.spyOn(CostAnalysisRunsRepository.prototype, 'markFinished').mockRejectedValue(new Error('write failed'));
    const { res } = await analyze(orgId);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});

describe('markFinished', () => {
  it('refuses a run in which no detector completed', async () => {
    const orgId = await insertOrg();
    const run = await runs.create(orgId);
    await expect(
      runs.markFinished(run.id, orgId, {
        recommendationsFound: 0,
        totalPotentialSavings: 0,
        summary: { state: 'failed', checks: [], failedDetectorCount: 1, unknownResourceCount: 0 },
        counts: null,
      })
    ).rejects.toThrow('cannot be marked finished');
  });

  it('does not overwrite a row recovery already closed', async () => {
    const orgId = await insertOrg();
    const run = await runs.create(orgId);
    await runs.markInterrupted(run.id, orgId);
    await runs.markFinished(run.id, orgId, {
      recommendationsFound: 1,
      totalPotentialSavings: 1,
      summary: { state: 'completed', checks: [], failedDetectorCount: 0, unknownResourceCount: 0 },
      counts: null,
    });
    expect((await fetchRuns(orgId))[0].status).toBe('interrupted');
  });
});

describe('recoverInterrupted', () => {
  const recover = (orgId: string, at: Date) => runs.recoverInterrupted(orgId, at);

  it('closes a run whose lease predates the new one', async () => {
    const orgId = await insertOrg();
    const run = await runs.create(orgId);
    await runs.markLeaseAcquired(run.id, orgId, new Date(Date.now() - 60_000));
    expect(await recover(orgId, new Date())).toBe(1);
    expect((await fetchRuns(orgId))[0]).toMatchObject({ status: 'interrupted' });
    expect((await fetchRuns(orgId))[0].completed_at).not.toBeNull();
  });

  it('leaves a queued manual run alone', async () => {
    const orgId = await insertOrg();
    await runs.create(orgId);
    expect(await recover(orgId, new Date())).toBe(0);
    expect((await fetchRuns(orgId))[0].status).toBe('running');
  });

  it('closes a run with no lease only past the timeout', async () => {
    const orgId = await insertOrg();
    const run = await runs.create(orgId);
    await pool.query(`UPDATE cost_analysis_runs SET created_at = NOW() - make_interval(secs => $1) WHERE id = $2`, [QUEUED_RUN_TIMEOUT_SECONDS - 60, run.id]);
    expect(await recover(orgId, new Date())).toBe(0);
    await pool.query(`UPDATE cost_analysis_runs SET created_at = NOW() - make_interval(secs => $1) WHERE id = $2`, [QUEUED_RUN_TIMEOUT_SECONDS + 60, run.id]);
    expect(await recover(orgId, new Date())).toBe(1);
  });

  it('never closes the run that holds the new lease, however old', async () => {
    const orgId = await insertOrg();
    const run = await runs.create(orgId);
    const acquiredAt = new Date();
    await runs.markLeaseAcquired(run.id, orgId, acquiredAt);
    await pool.query(`UPDATE cost_analysis_runs SET created_at = NOW() - INTERVAL '2 days' WHERE id = $1`, [run.id]);
    expect(await recover(orgId, acquiredAt)).toBe(0);
  });

  it('a real Analyze closes a dead worker\'s run after taking the lease, and a concurrent queued run survives', async () => {
    const orgId = await insertOrg();
    const dead = await runs.create(orgId);
    await runs.markLeaseAcquired(dead.id, orgId, new Date(Date.now() - 60_000));
    const queued = await runs.create(orgId);
    mockAnalysis([{ issue: 'Idle Instance', success: true, recommendations: [] }, retiredRds]);

    await analyze(orgId);

    const rows = await fetchRuns(orgId);
    expect(rows.find((r) => r.id === dead.id).status).toBe('interrupted');
    expect(rows.find((r) => r.id === queued.id).status).toBe('running');
  });
});

describe('GET /analysis-runs', () => {
  it('defaults to manual rows; ?source=all adds discovery rows', async () => {
    const orgId = await insertOrg();
    await runs.create(orgId);
    await runs.create(orgId, { source: 'discovery' });
    expect((await list(orgId)).map((r: any) => r.source)).toEqual(['manual']);
    expect((await list(orgId, { source: 'all' })).map((r: any) => r.source).sort()).toEqual(['discovery', 'manual']);
    expect((await list(orgId, { source: 'nonsense' })).map((r: any) => r.source)).toEqual(['manual']);
  });

  it('existing readers see partial and interrupted as a run that did not complete', async () => {
    const orgId = await insertOrg();
    mockAnalysis([{ issue: 'Idle Instance', success: true, recommendations: [] }, { issue: 'Unused Elastic IP', success: false, recommendations: [] }, retiredRds]);
    await analyze(orgId);
    const [partial] = await list(orgId);
    expect(partial).toMatchObject({ status: 'failed', run_state: 'partial', error_message: 'Some cost checks did not complete.' });

    const run = await runs.create(orgId);
    await runs.markInterrupted(run.id, orgId);
    const [interrupted] = await list(orgId);
    expect(interrupted).toMatchObject({ status: 'failed', run_state: 'interrupted', error_message: 'The analysis was interrupted before it finished.' });
  });

  it('a row from before this change keeps NULL counts, never 0', async () => {
    const orgId = await insertOrg();
    await pool.query(`INSERT INTO cost_analysis_runs (organization_id, status, recommendations_found, completed_at) VALUES ($1, 'completed', 0, NOW())`, [orgId]);
    const [run] = await list(orgId);
    expect(run).toMatchObject({ status: 'completed', run_state: 'completed', source: 'manual', detected_count: null, persisted_count: null, suppressed_resolved_count: null, checks: null });
  });

  it('read-time: a run that took a lease reads running while one is held, interrupted once none is, and nothing is written', async () => {
    const orgId = await insertOrg();
    const run = await runs.create(orgId);
    await runs.markLeaseAcquired(run.id, orgId, new Date());

    const lease = await holdLease(orgId);
    expect((await list(orgId))[0]).toMatchObject({ run_state: 'running', status: 'running' });

    await scanSession.onTaggedConnection(pool, orgId, (client) => releaseLease(client, lease!));
    expect((await list(orgId))[0]).toMatchObject({ run_state: 'interrupted', status: 'failed' });
    expect((await fetchRuns(orgId))[0].status).toBe('running');
  });

  it('read-time: a queued run reads running until the timeout', async () => {
    const orgId = await insertOrg();
    const run = await runs.create(orgId);
    expect((await list(orgId))[0].run_state).toBe('running');
    await pool.query(`UPDATE cost_analysis_runs SET created_at = NOW() - make_interval(secs => $1) WHERE id = $2`, [QUEUED_RUN_TIMEOUT_SECONDS + 60, run.id]);
    expect((await list(orgId))[0].run_state).toBe('interrupted');
  });

  it('never returns raw error text or the lease fields', async () => {
    const orgId = await insertOrg();
    jest.spyOn(costOptimizationService, 'analyzeAllResources').mockRejectedValue(new Error('AccessDenied: arn:aws:iam::123456789012:role/placeholder'));
    await analyze(orgId);
    const [run] = await list(orgId);
    expect(JSON.stringify(run)).not.toContain('arn:aws');
    expect(run).not.toHaveProperty('lease_acquired_at');
  });
});
