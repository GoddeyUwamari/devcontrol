/**
 * The Cost Optimization scan result banner's server side (founder-locked
 * behaviour, Nov 23): a manual run records who started it; GET
 * /analysis-runs/my-result returns ONLY that user's latest manual run in the
 * CURRENT organization until it is acknowledged; POST
 * /analysis-runs/:id/acknowledge is refused for anyone else's run, another
 * organization's run, a scheduled run or a run still going. Real Postgres; only
 * the AWS-touching analyzeAllResources() is mocked. Placeholders only.
 */
import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { Pool } from 'pg';
import { CostRecommendationsController, failedBeforeAnyWrite } from '../cost-recommendations.controller';
import { CostAnalysisRunsRepository } from '../../repositories/cost-analysis-runs.repository';
import costOptimizationService from '../../services/cost-optimization.service';
import { connectPlaceholderAccount, removePlaceholderAccounts } from '../../services/__tests__/helpers/scan-source';
import type { DetectorObservation } from '../../services/cost-optimization.service';
import type { CostRunResult } from '../../services/cost-run-result';
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
     VALUES ($1, $2, $1, 'free', 'free') RETURNING id`,
    [`Result Banner Org ${suffix}`, `result-banner-org-${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  await connectPlaceholderAccount(pool, rows[0].id);
  return rows[0].id;
}

function call(organizationId: string, userId: string, params: Record<string, string> = {}) {
  const req = { user: { organizationId, userId }, query: {}, params, body: {} } as unknown as Request;
  const json = jest.fn();
  const end = jest.fn();
  const status = jest.fn().mockReturnValue({ json, end });
  const res = { json, status } as unknown as Response;
  return { req, res, json, status, end };
}

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
const retiredRds: DetectorObservation = { issue: 'Oversized Instance', success: true, recommendations: [] };

function mockAnalysis(observations: DetectorObservation[], riSucceeded = true) {
  return jest.spyOn(costOptimizationService, 'analyzeAllResources').mockResolvedValue({
    observations,
    riRecommendations: [],
    riSucceeded,
    homeRegion: 'us-east-1',
  });
}

async function analyze(orgId: string, userId: string) {
  const c = call(orgId, userId);
  await new CostRecommendationsController().analyze(c.req, c.res);
  return c;
}

async function myResult(orgId: string, userId: string): Promise<CostRunResult | null> {
  const c = call(orgId, userId);
  await new CostRecommendationsController().getMyRunResult(c.req, c.res);
  expect(c.status).not.toHaveBeenCalled();
  return c.json.mock.calls[0][0].data;
}

async function acknowledge(orgId: string, userId: string, runId: string): Promise<number> {
  const c = call(orgId, userId, { id: runId });
  await new CostRecommendationsController().acknowledgeRunResult(c.req, c.res);
  return c.status.mock.calls[0][0];
}

const rowOf = async (runId: string) => (await pool.query('SELECT * FROM cost_analysis_runs WHERE id = $1', [runId])).rows[0];

/** A finished discovery (scheduled) run, written directly: no lease is needed to set up the row. */
async function scheduledRunCompleted(orgId: string, newCount: number) {
  const run = await runs.create(orgId, { source: 'discovery' });
  await pool.query(
    `UPDATE cost_analysis_runs SET status = 'completed', completed_at = NOW(), new_count = $2, checks = '[]'::jsonb WHERE id = $1`,
    [run.id, newCount]
  );
  return run;
}

afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM cost_recommendations WHERE organization_id = ANY($1)', [createdOrgIds]);
    await pool.query('DELETE FROM cost_analysis_runs WHERE organization_id = ANY($1)', [createdOrgIds]);
    await removePlaceholderAccounts(pool, createdOrgIds);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});

describe('the manual run records its result for the user who started it', () => {
  it('records the initiator and open_count; my-result returns the run with its own counts and services', async () => {
    const orgId = await insertOrg();
    const user = randomUUID();
    mockAnalysis([{ issue: 'Idle Instance', success: true, recommendations: [finding('i-a')] }, retiredRds]);
    const { json } = await analyze(orgId, user);
    const response = json.mock.calls[0][0].data;
    const row = await rowOf(response.runId);
    expect(row).toMatchObject({ initiated_by_user_id: user, result_acknowledged_at: null, open_count: 1, new_count: 1, source: 'manual' });

    const result = await myResult(orgId, user);
    expect(result).toMatchObject({
      id: response.runId, state: 'completed', checksTotal: 2, checksRan: 2, failedChecks: [],
      services: ['EC2'], newCount: 1, openCount: 1, stillOpen: 0, message: null, findingsUnchanged: false,
    });
    // The analyze response carries the same facts (the page shows them at once).
    expect(response.result).toMatchObject({ id: response.runId, state: 'completed', newCount: 1, openCount: 1, stillOpen: 0, services: ['EC2'] });
  });

  it('K still open from earlier = open after the run minus new', async () => {
    const orgId = await insertOrg();
    const user = randomUUID();
    mockAnalysis([{ issue: 'Idle Instance', success: true, recommendations: [finding('i-a'), finding('i-b')] }, retiredRds]);
    await analyze(orgId, user);
    mockAnalysis([{ issue: 'Idle Instance', success: true, recommendations: [finding('i-a'), finding('i-b'), finding('i-c')] }, retiredRds]);
    await analyze(orgId, user);
    expect(await myResult(orgId, user)).toMatchObject({ newCount: 1, openCount: 3, stillOpen: 2 });
  });

  it('a user id that is not a UUID records no initiator and still records the run', async () => {
    const orgId = await insertOrg();
    mockAnalysis([{ issue: 'Idle Instance', success: true, recommendations: [] }, retiredRds]);
    const { json } = await analyze(orgId, 'not-a-uuid');
    const row = await rowOf(json.mock.calls[0][0].data.runId);
    expect(row).toMatchObject({ status: 'completed', initiated_by_user_id: null });
    expect(await myResult(orgId, 'not-a-uuid')).toBeNull();
  });
});

describe('scoping: this user, this organization, manual runs only', () => {
  it('another user in the same organization never sees it, and cannot acknowledge it', async () => {
    const orgId = await insertOrg();
    const owner = randomUUID();
    const other = randomUUID();
    mockAnalysis([{ issue: 'Idle Instance', success: true, recommendations: [] }, retiredRds]);
    const { json } = await analyze(orgId, owner);
    const runId = json.mock.calls[0][0].data.runId;

    expect(await myResult(orgId, other)).toBeNull();
    expect(await acknowledge(orgId, other, runId)).toBe(404);
    expect((await rowOf(runId)).result_acknowledged_at).toBeNull();
    expect((await myResult(orgId, owner))?.id).toBe(runId);
  });

  it('a user in two workspaces never sees workspace A\'s result in B, and cannot acknowledge it from B', async () => {
    const orgA = await insertOrg();
    const orgB = await insertOrg();
    const user = randomUUID();
    mockAnalysis([{ issue: 'Idle Instance', success: true, recommendations: [finding('i-a')] }, retiredRds]);
    const { json } = await analyze(orgA, user);
    const runA = json.mock.calls[0][0].data.runId;

    expect(await myResult(orgB, user)).toBeNull();
    expect(await acknowledge(orgB, user, runA)).toBe(404);
    expect((await rowOf(runA)).result_acknowledged_at).toBeNull();
    expect((await myResult(orgA, user))?.id).toBe(runA);
  });

  it('a later SCHEDULED run neither replaces nor hides the pending manual result', async () => {
    const orgId = await insertOrg();
    const user = randomUUID();
    mockAnalysis([{ issue: 'Idle Instance', success: true, recommendations: [finding('i-a')] }, retiredRds]);
    const { json } = await analyze(orgId, user);
    const runId = json.mock.calls[0][0].data.runId;
    const scheduled = await scheduledRunCompleted(orgId, 7);

    const result = await myResult(orgId, user);
    expect(result).toMatchObject({ id: runId, state: 'completed', newCount: 1 });
    // A scheduled run's result is never acknowledgeable (it is never anyone's banner).
    expect(await acknowledge(orgId, user, scheduled.id)).toBe(404);
  });

  it('a newer manual run by the same user replaces the older unacknowledged one', async () => {
    const orgId = await insertOrg();
    const user = randomUUID();
    mockAnalysis([{ issue: 'Idle Instance', success: true, recommendations: [] }, retiredRds]);
    await analyze(orgId, user);
    const { json } = await analyze(orgId, user);
    expect((await myResult(orgId, user))?.id).toBe(json.mock.calls[0][0].data.runId);
  });
});

describe('lifecycle: seen / dismissed / left mid-run', () => {
  it('acknowledged (seen or closed): never returned again, also after a refresh; idempotent', async () => {
    const orgId = await insertOrg();
    const user = randomUUID();
    mockAnalysis([{ issue: 'Idle Instance', success: true, recommendations: [] }, retiredRds]);
    const { json } = await analyze(orgId, user);
    const runId = json.mock.calls[0][0].data.runId;

    expect(await acknowledge(orgId, user, runId)).toBe(204);
    const first = (await rowOf(runId)).result_acknowledged_at;
    expect(first).not.toBeNull();
    expect(await myResult(orgId, user)).toBeNull();
    // Refresh / reopen: a new read, still nothing. Closing it again keeps the first time.
    expect(await myResult(orgId, user)).toBeNull();
    expect(await acknowledge(orgId, user, runId)).toBe(204);
    expect((await rowOf(runId)).result_acknowledged_at).toEqual(first);
  });

  it('left mid-run: a running run is returned as running and cannot be acknowledged; once finished it is shown', async () => {
    const orgId = await insertOrg();
    const user = randomUUID();
    const run = await runs.create(orgId, { initiatedByUserId: user });
    expect(await myResult(orgId, user)).toMatchObject({ id: run.id, state: 'running' });
    expect(await acknowledge(orgId, user, run.id)).toBe(404);
    expect((await rowOf(run.id)).result_acknowledged_at).toBeNull();

    await pool.query(
      `UPDATE cost_analysis_runs SET status = 'completed', completed_at = NOW(), new_count = 0, open_count = 0,
         checks = '[{"rule_id":"ec2_idle","issue":"Idle Instance","outcome":"complete","detected":0,"unknown":0}]'::jsonb
       WHERE id = $1`,
      [run.id]
    );
    expect(await myResult(orgId, user)).toMatchObject({ id: run.id, state: 'completed', checksRan: 1, newCount: 0, openCount: 0 });
    expect(await acknowledge(orgId, user, run.id)).toBe(204);
    expect(await myResult(orgId, user)).toBeNull();
  });

  it('a run whose worker is gone reads interrupted, and can be acknowledged', async () => {
    const orgId = await insertOrg();
    const user = randomUUID();
    const run = await runs.create(orgId, { initiatedByUserId: user, leaseAcquiredAt: new Date(Date.now() - 60_000) });
    expect(await myResult(orgId, user)).toMatchObject({ id: run.id, state: 'interrupted', findingsUnchanged: false });
    expect(await acknowledge(orgId, user, run.id)).toBe(204);
  });

  it('a malformed run id is a 404, never a database error', async () => {
    const orgId = await insertOrg();
    expect(await acknowledge(orgId, randomUUID(), 'not-a-uuid')).toBe(404);
  });
});

describe('what the result says', () => {
  it('gaps: per-check failure reasons, largest first', async () => {
    const orgId = await insertOrg();
    const user = randomUUID();
    mockAnalysis([
      { issue: 'Idle Instance', success: true, recommendations: [] },
      { issue: 'Unused Elastic IP', success: false, recommendations: [], failureReason: 'timeout' },
      { issue: 'Unattached EBS Volume', success: false, recommendations: [], failureReason: 'permissions' },
      { issue: 'gp2 to gp3 Migration Opportunity', success: false, recommendations: [], failureReason: 'permissions' },
      retiredRds,
    ]);
    await analyze(orgId, user);
    expect(await myResult(orgId, user)).toMatchObject({
      state: 'partial', checksTotal: 5, checksRan: 2,
      failedChecks: [{ reason: 'permissions', count: 2 }, { reason: 'timeout', count: 1 }],
      services: ['EC2'],
    });
  });

  it('no check completed: failed, with the fixed message, and the findings are known unchanged', async () => {
    const orgId = await insertOrg();
    const user = randomUUID();
    mockAnalysis([{ issue: 'Idle Instance', success: false, recommendations: [], failureReason: 'rate_limited' }, retiredRds], false);
    await analyze(orgId, user);
    expect(await myResult(orgId, user)).toMatchObject({
      state: 'failed', message: 'None of the cost checks could complete. Try again.', findingsUnchanged: true,
    });
  });

  it('an unexpected error: failed, the generic message, and NO claim about the findings', async () => {
    const orgId = await insertOrg();
    const user = randomUUID();
    jest.spyOn(costOptimizationService, 'analyzeAllResources').mockRejectedValue(new Error('placeholder failure'));
    await analyze(orgId, user);
    expect(await myResult(orgId, user)).toMatchObject({
      state: 'failed', message: 'The analysis did not complete due to an unexpected error.', findingsUnchanged: false,
    });
  });
});

describe('resource-level gaps (fix round S-2): from the run record\'s unknown_resource_count', () => {
  it('every check ran but some resources could not be evaluated: the count is carried by my-result and the analyze response', async () => {
    const orgId = await insertOrg();
    const user = randomUUID();
    mockAnalysis([
      { issue: 'Idle Instance', success: true, recommendations: [], unknownResourceIds: ['i-0123456789abcdef0', 'i-1234567890abcdef0'] },
      { issue: 'Unattached EBS Volume', success: true, recommendations: [], unknownResourceIds: ['placeholder-volume'] },
      retiredRds,
    ]);
    const { json } = await analyze(orgId, user);
    const response = json.mock.calls[0][0].data;
    expect((await rowOf(response.runId)).unknown_resource_count).toBe(3);
    expect(response.result).toMatchObject({ state: 'completed', checksRan: 3, checksTotal: 3, unknownResourceCount: 3 });
    expect(await myResult(orgId, user)).toMatchObject({ id: response.runId, state: 'completed', unknownResourceCount: 3 });
  });

  it('no resource gaps: 0, never null, for a run that recorded it', async () => {
    const orgId = await insertOrg();
    const user = randomUUID();
    mockAnalysis([{ issue: 'Idle Instance', success: true, recommendations: [] }, retiredRds]);
    await analyze(orgId, user);
    expect(await myResult(orgId, user)).toMatchObject({ state: 'completed', unknownResourceCount: 0 });
  });
});

describe('failedBeforeAnyWrite (founder ruling 4)', () => {
  it.each([
    ['COST_RESULTS_NOT_SAVED: analysis ran without a scan lease; nothing was saved', true],
    ['COST_CHECKS_FAILED: no cost check completed', true],
    ['SCAN_BUSY: a scan was still running after the wait cap', true],
    ['PLATFORM_AWS_CREDENTIALS_UNAVAILABLE: placeholder', true],
    ['AWS_NOT_CONNECTED: placeholder', true],
    ['placeholder failure', false],
    ['AWS Cost Explorer is not enabled', false],
    [null, false],
  ])('%s → %s', (raw, expected) => {
    expect(failedBeforeAnyWrite(raw)).toBe(expected);
  });
});
