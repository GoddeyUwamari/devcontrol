/**
 * Focused coverage for the first_insight_generated and first_value_viewed
 * funnel events, repointed onto CostRecommendationsController -- the
 * authoritative, customer-facing cost_recommendations flow (PR 1 of the
 * DevControl cost-intelligence consolidation). These events previously lived
 * on OptimizationController (cost_optimizations), a table with no reachable
 * frontend read path; see that file's history for the removed tests.
 *
 * Real Postgres for the analytics_events assertions; the scanner/repository
 * layers are mocked (same pattern as this repo's Stripe controller tests --
 * spy on the network/DB-touching collaborator, let the controller's own
 * logic run for real).
 */
import { Request, Response } from 'express';
import { Pool } from 'pg';
import { CostRecommendationsController } from '../cost-recommendations.controller';
import { CostRecommendationsRepository } from '../../repositories/cost-recommendations.repository';
import costOptimizationService from '../../services/cost-optimization.service';
import type { CostRecommendation, RecommendationStats } from '../../types';

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
const createdUserIds: string[] = [];

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function insertOrg(): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $3, 'free', 'free')
     RETURNING id`,
    [`Cost Recs Funnel Org ${suffix}`, `cost-recs-funnel-org-${suffix}`, `Cost Recs Funnel Org ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

// analytics_events.user_id is a real FK to users(id) -- a made-up string
// fails the uuid cast entirely, so every test needs a real users row.
async function insertUser(): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Cost Recs Funnel User') RETURNING id`,
    [`cost-recs-funnel-${suffix}@example.com`]
  );
  createdUserIds.push(rows[0].id);
  return rows[0].id as string;
}

async function fetchEvents(orgId: string, eventName: string) {
  const { rows } = await pool.query(
    `SELECT * FROM analytics_events WHERE organization_id = $1 AND event_name = $2 ORDER BY created_at ASC`,
    [orgId, eventName]
  );
  return rows;
}

function fakeRecommendation(overrides: Partial<CostRecommendation> = {}): CostRecommendation {
  return {
    id: `rec-${uniqueSuffix()}`,
    resource_id: `i-${uniqueSuffix()}`,
    resource_name: 'test-instance',
    resource_type: 'EC2',
    issue: 'Idle Instance',
    description: 'This EC2 instance has averaged 2.4% CPU utilization over the past 7 days.',
    potential_savings: 8.5,
    severity: 'LOW',
    status: 'ACTIVE',
    aws_region: 'us-east-1',
    metadata: {},
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function fakeStats(totalPotentialSavings: number): RecommendationStats {
  return {
    total_recommendations: totalPotentialSavings > 0 ? 1 : 0,
    active_recommendations: totalPotentialSavings > 0 ? 1 : 0,
    total_potential_savings: totalPotentialSavings,
    by_severity: { high: 0, medium: 0, low: totalPotentialSavings > 0 ? 1 : 0 },
  };
}

function mockReqRes(organizationId: string, userId: string, query: any = {}) {
  const req = { user: { organizationId, userId }, query, params: {}, body: {} } as unknown as Request;
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { json, status } as unknown as Response;
  return { req, res, json, status };
}

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  if (createdUserIds.length > 0) {
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds]);
  }
  await pool.end();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('CostRecommendationsController.analyze -> first_insight_generated', () => {
  it('emits first_insight_generated exactly once, even across repeated/retried scans', async () => {
    const orgId = await insertOrg();
    const userId = await insertUser();
    const controller = new CostRecommendationsController();

    jest.spyOn(costOptimizationService, 'analyzeAllResources').mockResolvedValue({
      observations: [
        { issue: 'Idle Instance', success: true, recommendations: [{ resource_id: 'i-abc', resource_type: 'EC2', issue: 'Idle Instance', potential_savings: 8.5, severity: 'LOW' } as any] },
        { issue: 'Oversized Instance', success: true, recommendations: [] },
        { issue: 'Unused Elastic IP', success: true, recommendations: [] },
      ],
      riRecommendations: [],
    });
    jest.spyOn(CostRecommendationsRepository.prototype, 'reconcileActiveRecommendations').mockResolvedValue({ insertedCount: 1 });
    jest.spyOn(CostRecommendationsRepository.prototype, 'deleteActiveByIssue').mockResolvedValue(0);
    jest.spyOn(CostRecommendationsRepository.prototype, 'createBulk').mockResolvedValue(0);
    jest.spyOn(CostRecommendationsRepository.prototype, 'getStats').mockResolvedValue(fakeStats(8.5));

    const first = mockReqRes(orgId, userId);
    await controller.analyze(first.req, first.res);
    expect(first.res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

    const second = mockReqRes(orgId, userId);
    await controller.analyze(second.req, second.res);

    const rows = await fetchEvents(orgId, 'first_insight_generated');
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(userId);
    expect(rows[0].properties).toEqual({ recommendationCount: 1, totalMonthlySavings: 8.5 });
  });

  it('does not emit when the scan finds no recommendations at all', async () => {
    const orgId = await insertOrg();
    const controller = new CostRecommendationsController();

    jest.spyOn(costOptimizationService, 'analyzeAllResources').mockResolvedValue({ observations: [], riRecommendations: [] });
    jest.spyOn(CostRecommendationsRepository.prototype, 'reconcileActiveRecommendations').mockResolvedValue({ insertedCount: 0 });
    jest.spyOn(CostRecommendationsRepository.prototype, 'deleteActiveByIssue').mockResolvedValue(0);
    jest.spyOn(CostRecommendationsRepository.prototype, 'createBulk').mockResolvedValue(0);
    jest.spyOn(CostRecommendationsRepository.prototype, 'getStats').mockResolvedValue(fakeStats(0));

    const { req, res } = mockReqRes(orgId, await insertUser());
    await controller.analyze(req, res);

    const rows = await fetchEvents(orgId, 'first_insight_generated');
    expect(rows).toHaveLength(0);
  });
});

describe('CostRecommendationsController.getAll -> first_value_viewed', () => {
  it('emits first_value_viewed exactly once despite repeated ACTIVE reads (page refreshes)', async () => {
    const orgId = await insertOrg();
    const userId = await insertUser();
    const controller = new CostRecommendationsController();

    // Real pg NUMERIC columns come back as strings -- assert the handler
    // coerces correctly rather than assuming a JS number.
    jest.spyOn(CostRecommendationsRepository.prototype, 'findAll')
      .mockResolvedValue([fakeRecommendation({ potential_savings: '75.00' as any })]);

    const first = mockReqRes(orgId, userId, { status: 'ACTIVE' });
    await controller.getAll(first.req, first.res);

    const second = mockReqRes(orgId, userId, { status: 'ACTIVE' });
    await controller.getAll(second.req, second.res);

    const third = mockReqRes(orgId, userId, { status: 'ACTIVE' });
    await controller.getAll(third.req, third.res);

    const rows = await fetchEvents(orgId, 'first_value_viewed');
    expect(rows).toHaveLength(1);
    expect(rows[0].properties).toEqual({ totalMonthlySavings: 75 });
  });

  it('does not emit when there is no real dollar value to see yet', async () => {
    const orgId = await insertOrg();
    const controller = new CostRecommendationsController();

    jest.spyOn(CostRecommendationsRepository.prototype, 'findAll').mockResolvedValue([]);

    const { req, res } = mockReqRes(orgId, await insertUser(), { status: 'ACTIVE' });
    await controller.getAll(req, res);

    const rows = await fetchEvents(orgId, 'first_value_viewed');
    expect(rows).toHaveLength(0);
  });

  it('does not emit on an unfiltered/non-ACTIVE read, even with historical savings present', async () => {
    const orgId = await insertOrg();
    const controller = new CostRecommendationsController();

    jest.spyOn(CostRecommendationsRepository.prototype, 'findAll')
      .mockResolvedValue([fakeRecommendation({ status: 'RESOLVED', potential_savings: 8.5 })]);

    // No status filter -- this is not the ACTIVE-scoped call the real
    // Cost Optimization page/Dashboard make, so it must not count as
    // "the customer saw active value."
    const { req, res } = mockReqRes(orgId, await insertUser(), {});
    await controller.getAll(req, res);

    const rows = await fetchEvents(orgId, 'first_value_viewed');
    expect(rows).toHaveLength(0);
  });
});

describe('Organization isolation for both events', () => {
  it('does not leak first_value_viewed across organizations', async () => {
    const orgA = await insertOrg();
    const orgB = await insertOrg();
    const controller = new CostRecommendationsController();

    jest.spyOn(CostRecommendationsRepository.prototype, 'findAll')
      .mockResolvedValue([fakeRecommendation({ potential_savings: 10 })]);

    const { req, res } = mockReqRes(orgA, await insertUser(), { status: 'ACTIVE' });
    await controller.getAll(req, res);

    expect(await fetchEvents(orgA, 'first_value_viewed')).toHaveLength(1);
    expect(await fetchEvents(orgB, 'first_value_viewed')).toHaveLength(0);
  });
});
