/**
 * Coverage for the manual "Run cost analysis" run-tracking gap fix:
 * POST /api/cost-recommendations/analyze previously left no server-side
 * trace of when it ran or whether it succeeded, unlike the scheduled
 * discovery cron (resource_discovery_jobs). This tests the new
 * cost_analysis_runs table + CostAnalysisRunsRepository +
 * CostRecommendationsController.analyze()'s run-tracking wrapper +
 * GET /api/cost-recommendations/analysis-runs.
 *
 * Same pattern as cost-recommendations-funnel-events.test.ts: real Postgres
 * throughout (including the real, unmocked advisory-lock-guarded
 * reconcileActiveRecommendations() for the concurrency test), with only the
 * AWS-SDK-touching costOptimizationService.analyzeAllResources() mocked.
 */
import { Request, Response } from 'express';
import { Pool } from 'pg';
import { CostRecommendationsController } from '../cost-recommendations.controller';
import { CostRecommendationsRepository } from '../../repositories/cost-recommendations.repository';
import costOptimizationService from '../../services/cost-optimization.service';
import type { RecommendationStats } from '../../types';

function dbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };
}

const pool = new Pool(dbConfig());
const createdOrgIds: string[] = [];

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function insertOrg(): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $3, 'free', 'free')
     RETURNING id`,
    [`Cost Analysis Run Org ${suffix}`, `cost-analysis-run-org-${suffix}`, `Cost Analysis Run Org ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function fetchRuns(orgId: string) {
  const { rows } = await pool.query(
    `SELECT * FROM cost_analysis_runs WHERE organization_id = $1 ORDER BY created_at ASC`,
    [orgId]
  );
  return rows;
}

async function discoveryJobCount(orgId: string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM resource_discovery_jobs WHERE organization_id = $1`,
    [orgId]
  );
  return rows[0].count;
}

function fakeStats(totalPotentialSavings: number, activeRecommendations = 1): RecommendationStats {
  return {
    total_recommendations: activeRecommendations,
    active_recommendations: activeRecommendations,
    total_potential_savings: totalPotentialSavings,
    by_severity: { high: 0, medium: 0, low: activeRecommendations },
  };
}

function mockReqRes(organizationId: string, query: any = {}) {
  const req = { user: { organizationId, userId: 'test-user' }, query, params: {}, body: {} } as unknown as Request;
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { json, status } as unknown as Response;
  return { req, res, json, status };
}

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('CostRecommendationsController.analyze -> cost_analysis_runs tracking', () => {
  it('1. persists correct completion metadata on success', async () => {
    const orgId = await insertOrg();
    const controller = new CostRecommendationsController();

    jest.spyOn(costOptimizationService, 'analyzeAllResources').mockResolvedValue({
      observations: [
        { issue: 'Idle Instance', success: true, recommendations: [] },
        { issue: 'Oversized Instance', success: true, recommendations: [] },
        { issue: 'Unused Elastic IP', success: true, recommendations: [] },
      ],
      riRecommendations: [],
    });
    jest.spyOn(CostRecommendationsRepository.prototype, 'reconcileActiveRecommendations').mockResolvedValue({ insertedCount: 3 });
    jest.spyOn(CostRecommendationsRepository.prototype, 'deleteActiveByIssue').mockResolvedValue(0);
    jest.spyOn(CostRecommendationsRepository.prototype, 'createBulk').mockResolvedValue(0);
    jest.spyOn(CostRecommendationsRepository.prototype, 'getStats').mockResolvedValue(fakeStats(42.5, 3));

    const { req, res } = mockReqRes(orgId);
    await controller.analyze(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

    const runs = await fetchRuns(orgId);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('completed');
    expect(runs[0].recommendations_found).toBe(3);
    expect(parseFloat(runs[0].total_potential_savings)).toBe(42.5);
    expect(runs[0].completed_at).not.toBeNull();
    expect(runs[0].error_message).toBeNull();
  });

  it('2. persists correct failure state when analyzeAllResources() throws, without marking it completed', async () => {
    const orgId = await insertOrg();
    const controller = new CostRecommendationsController();

    jest.spyOn(costOptimizationService, 'analyzeAllResources').mockRejectedValue(new Error('AWS_NOT_CONNECTED: org has not connected an AWS account'));

    const { req, res } = mockReqRes(orgId);
    await controller.analyze(req, res);

    // Existing HTTP error-response behavior is unchanged by this change.
    expect(res.status).toHaveBeenCalledWith(400);

    const runs = await fetchRuns(orgId);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('failed');
    expect(runs[0].completed_at).not.toBeNull();
    expect(runs[0].recommendations_found).toBeNull();
    expect(runs[0].total_potential_savings).toBeNull();
    // Full raw error preserved server-side for diagnostics.
    expect(runs[0].error_message).toContain('AWS_NOT_CONNECTED');
  });

  it('3. does not write a resource_discovery_jobs row -- manual analysis is never mislabeled as resource discovery', async () => {
    const orgId = await insertOrg();
    const controller = new CostRecommendationsController();

    jest.spyOn(costOptimizationService, 'analyzeAllResources').mockResolvedValue({ observations: [], riRecommendations: [] });
    jest.spyOn(CostRecommendationsRepository.prototype, 'reconcileActiveRecommendations').mockResolvedValue({ insertedCount: 0 });
    jest.spyOn(CostRecommendationsRepository.prototype, 'deleteActiveByIssue').mockResolvedValue(0);
    jest.spyOn(CostRecommendationsRepository.prototype, 'createBulk').mockResolvedValue(0);
    jest.spyOn(CostRecommendationsRepository.prototype, 'getStats').mockResolvedValue(fakeStats(0, 0));

    expect(await discoveryJobCount(orgId)).toBe(0);

    const { req, res } = mockReqRes(orgId);
    await controller.analyze(req, res);

    expect(await discoveryJobCount(orgId)).toBe(0);
    expect((await fetchRuns(orgId))).toHaveLength(1);
  });

  it('6. two concurrent manual analyses for the same org each get their own honest, real run record (real advisory lock, not mocked)', async () => {
    const orgId = await insertOrg();
    const controllerA = new CostRecommendationsController();
    const controllerB = new CostRecommendationsController();

    jest.spyOn(costOptimizationService, 'analyzeAllResources').mockResolvedValue({
      observations: [
        { issue: 'Idle Instance', success: true, recommendations: [{ resource_id: `i-${uniqueSuffix()}`, resource_name: 'x', resource_type: 'EC2', issue: 'Idle Instance', description: 'x', potential_savings: 10, severity: 'LOW', aws_region: 'us-east-1', metadata: {} }] },
        { issue: 'Oversized Instance', success: true, recommendations: [] },
        { issue: 'Unused Elastic IP', success: true, recommendations: [] },
      ],
      riRecommendations: [],
    });
    // reconcileActiveRecommendations, deleteActiveByIssue, createBulk, getStats
    // all run FOR REAL here (unmocked) -- this is what proves the existing
    // per-org pg_advisory_lock still safely serializes two concurrent manual
    // requests, not just two mocked calls.

    const first = mockReqRes(orgId);
    const second = mockReqRes(orgId);

    await Promise.all([
      controllerA.analyze(first.req, first.res),
      controllerB.analyze(second.req, second.res),
    ]);

    expect(first.res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(second.res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

    const runs = await fetchRuns(orgId);
    expect(runs).toHaveLength(2);
    expect(runs.every((r) => r.status === 'completed')).toBe(true);

    // Real reconciliation ran twice with identical findings -- the second
    // call's insert is suppressed by idx_cost_recommendations_active_identity's
    // ON CONFLICT DO NOTHING, so exactly one ACTIVE row survives, not two --
    // the same real safety property cost-recommendations-occurrence-lifecycle
    // .test.ts already covers, now proven to hold with the run-tracking wrapper
    // around it too.
    const { rows: activeRows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM cost_recommendations WHERE organization_id = $1 AND status = 'ACTIVE'`,
      [orgId]
    );
    expect(activeRows[0].count).toBe(1);
  });
});

describe('CostRecommendationsController.getAnalysisRuns', () => {
  it('returns a sanitized error message, never the raw stored error', async () => {
    const orgId = await insertOrg();
    const controller = new CostRecommendationsController();

    jest.spyOn(costOptimizationService, 'analyzeAllResources').mockRejectedValue(
      new Error('AccessDenied: arn:aws:iam::123456789012:role/secret-role is not authorized to perform: ec2:DescribeInstances')
    );

    const { req: analyzeReq, res: analyzeRes } = mockReqRes(orgId);
    await controller.analyze(analyzeReq, analyzeRes);

    // Confirm the raw, sensitive detail really did land in the DB column
    // (server-side diagnostics still work)...
    const runs = await fetchRuns(orgId);
    expect(runs[0].error_message).toContain('arn:aws:iam::123456789012');

    // ...but the read endpoint the frontend calls never echoes it back.
    const { req: listReq, res: listRes, json } = mockReqRes(orgId);
    await controller.getAnalysisRuns(listReq, listRes);

    expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    const responseBody = json.mock.calls[0][0];
    const returnedRun = responseBody.data[0];
    expect(returnedRun.status).toBe('failed');
    expect(JSON.stringify(returnedRun)).not.toContain('arn:aws:iam');
    expect(JSON.stringify(returnedRun)).not.toContain('123456789012');
    expect(returnedRun.error_message).toBe('The analysis did not complete due to an unexpected error.');
  });

  it('orders latest-first and scopes strictly to the requesting organization', async () => {
    const orgA = await insertOrg();
    const orgB = await insertOrg();
    const controller = new CostRecommendationsController();

    jest.spyOn(costOptimizationService, 'analyzeAllResources').mockResolvedValue({ observations: [], riRecommendations: [] });
    jest.spyOn(CostRecommendationsRepository.prototype, 'reconcileActiveRecommendations').mockResolvedValue({ insertedCount: 0 });
    jest.spyOn(CostRecommendationsRepository.prototype, 'deleteActiveByIssue').mockResolvedValue(0);
    jest.spyOn(CostRecommendationsRepository.prototype, 'createBulk').mockResolvedValue(0);
    jest.spyOn(CostRecommendationsRepository.prototype, 'getStats').mockResolvedValue(fakeStats(0, 0));

    await controller.analyze(mockReqRes(orgA).req, mockReqRes(orgA).res);
    await new Promise((r) => setTimeout(r, 10));
    await controller.analyze(mockReqRes(orgA).req, mockReqRes(orgA).res);
    await controller.analyze(mockReqRes(orgB).req, mockReqRes(orgB).res);

    const { req, res, json } = mockReqRes(orgA);
    await controller.getAnalysisRuns(req, res);
    const data = json.mock.calls[0][0].data;

    expect(data).toHaveLength(2);
    expect(new Date(data[0].created_at).getTime()).toBeGreaterThanOrEqual(new Date(data[1].created_at).getTime());
  });
});
