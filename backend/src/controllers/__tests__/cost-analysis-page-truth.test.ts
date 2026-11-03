/**
 * PR 2 (page truth), the manual Analyze path: a lost lease answers the approved
 * "interrupted" text, and every successful exit logs exactly one outcome line
 * with no organization, account or resource identifier. Real Postgres; only
 * the AWS-touching analyzeAllResources() is mocked. Placeholder IDs only.
 */
import { Request, Response } from 'express';
import { Pool } from 'pg';
import { CostRecommendationsController } from '../cost-recommendations.controller';
import costOptimizationService from '../../services/cost-optimization.service';
import { LeaseLostError } from '../../services/scan-lease';
import { SCAN_BUSY_MESSAGE } from '../../services/scan-session';
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

const INTERRUPTED = 'The analysis was interrupted before it finished. Run it again.';
const RESOURCE_ID = 'i-1234567890abcdef0';

async function insertOrg(): Promise<string> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $3, 'free', 'free') RETURNING id`,
    [`Page Truth Org ${suffix}`, `page-truth-org-${suffix}`, `Page Truth Org ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  await connectPlaceholderAccount(pool, rows[0].id);
  return rows[0].id;
}

async function analyze(organizationId: string) {
  const req = { user: { organizationId, userId: 'test-user' }, query: {}, params: {}, body: {} } as unknown as Request;
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { json, status } as unknown as Response;
  await new CostRecommendationsController().analyze(req, res);
  return { json, status };
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

function mockAnalysis(observations: DetectorObservation[], riSucceeded = true) {
  return jest.spyOn(costOptimizationService, 'analyzeAllResources').mockResolvedValue({
    observations,
    riRecommendations: [],
    riSucceeded,
    homeRegion: 'us-east-1',
  });
}

const outcomeLines = (spy: jest.SpyInstance) =>
  spy.mock.calls.map((call) => call.map(String).join(' ')).filter((line) => line.startsWith('[CostAnalysis]'));

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

describe('a lost lease on Analyze', () => {
  it('answers 409 with the approved interrupted text, never the "scan already running" text', async () => {
    const orgId = await insertOrg();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(costOptimizationService, 'analyzeAllResources').mockRejectedValue(
      new LeaseLostError('lease_lost', { table: 'job_leases', organizationId: orgId, jobName: 'placeholder' })
    );

    const { json, status } = await analyze(orgId);

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({ success: false, error: INTERRUPTED });
    expect(JSON.stringify(json.mock.calls)).not.toContain(SCAN_BUSY_MESSAGE);
    expect(JSON.stringify(json.mock.calls)).not.toContain(orgId);
  });
});

describe('the manual success log', () => {
  it('a completed run logs exactly one outcome line: run ID and counts, no organization, account or resource ID', async () => {
    const orgId = await insertOrg();
    mockAnalysis([{ issue: 'Idle Instance', success: true, recommendations: [finding(RESOURCE_ID)] }]);
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    const { json } = await analyze(orgId);

    expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    const lines = outcomeLines(log);
    expect(lines).toHaveLength(1);
    const { rows } = await pool.query(`SELECT id FROM cost_analysis_runs WHERE organization_id = $1`, [orgId]);
    expect(lines[0]).toBe(
      `[CostAnalysis] Manual run ${rows[0].id} completed: detected 1, persisted 1, suppressed 0, failed checks 0, unknown resources 0`
    );
    for (const identifier of [orgId, RESOURCE_ID, PLACEHOLDER_ACCOUNT_ROW.account_id!]) expect(lines[0]).not.toContain(identifier);
  });

  it('a partial run logs exactly one outcome line saying partial', async () => {
    const orgId = await insertOrg();
    mockAnalysis([
      { issue: 'Idle Instance', success: true, recommendations: [] },
      { issue: 'Unused Elastic IP', success: false, recommendations: [] },
    ]);
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    await analyze(orgId);

    const lines = outcomeLines(log);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[CostAnalysis\] Manual run [0-9a-f-]{36} partial: detected 0, persisted 0, suppressed 0, failed checks 1, unknown resources 0$/);
  });

  it('a failed run logs no success line, only its one existing error line', async () => {
    const orgId = await insertOrg();
    mockAnalysis([{ issue: 'Idle Instance', success: false, recommendations: [] }], false);
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await analyze(orgId);

    expect(outcomeLines(log)).toHaveLength(0);
    expect(error.mock.calls.filter((call) => call[0] === 'Error analyzing AWS resources:')).toHaveLength(1);
  });
});
