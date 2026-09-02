/**
 * Focused coverage for the first_insight_generated and first_value_viewed
 * funnel events added to OptimizationController. Real Postgres for the
 * analytics_events assertions; the scanner/AI/repository layers are mocked
 * (same pattern as this repo's Stripe controller tests -- spy on the
 * network/DB-touching collaborator, let the controller's own logic run for
 * real).
 */
import { Request, Response } from 'express';
import { Pool } from 'pg';
import { OptimizationController } from '../optimization.controller';
import { OptimizationScannerService } from '../../services/optimization-scanner.service';
import { OptimizationAIService } from '../../services/optimization-ai.service';
import { OptimizationRepository } from '../../repositories/optimization.repository';
import type { OptimizationRecommendation, OptimizationSummary } from '../../types/optimization.types';

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
    [`Optimization Funnel Org ${suffix}`, `optimization-funnel-org-${suffix}`, `Optimization Funnel Org ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

// analytics_events.user_id is a real FK to users(id) -- a made-up string
// fails the uuid cast entirely, so every test needs a real users row.
async function insertUser(): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Optimization Funnel User') RETURNING id`,
    [`optimization-funnel-${suffix}@example.com`]
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

function fakeRecommendation(orgId: string, monthlySavings: number): OptimizationRecommendation {
  return {
    id: `rec-${uniqueSuffix()}`,
    organizationId: orgId,
    type: 'idle_resource',
    resourceId: `i-${uniqueSuffix()}`,
    resourceType: 'ec2',
    resourceName: 'test-instance',
    region: 'us-east-1',
    currentCost: 100,
    optimizedCost: 100 - monthlySavings,
    monthlySavings,
    annualSavings: monthlySavings * 12,
    risk: 'safe',
    effort: 'low',
    confidence: 90,
    priority: 5,
    title: 'Idle instance',
    description: 'Idle instance detected',
    reasoning: 'Low utilization',
    action: 'Stop the instance',
    status: 'pending',
    detectedAt: new Date(),
  };
}

function fakeSummary(totalMonthlySavings: number): OptimizationSummary {
  return {
    totalRecommendations: totalMonthlySavings > 0 ? 1 : 0,
    totalMonthlySavings,
    totalAnnualSavings: totalMonthlySavings * 12,
    byType: {} as any,
    byRisk: {} as any,
    byStatus: {} as any,
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

describe('OptimizationController.scan -> first_insight_generated', () => {
  it('emits first_insight_generated exactly once, even across repeated/retried scans', async () => {
    const orgId = await insertOrg();
    const userId = await insertUser();
    const controller = new OptimizationController(pool);

    jest.spyOn(OptimizationScannerService.prototype, 'scanOrganization')
      .mockResolvedValue([fakeRecommendation(orgId, 50)]);
    jest.spyOn(OptimizationAIService.prototype, 'prioritizeRecommendations')
      .mockImplementation(async (recs) => recs);
    jest.spyOn(OptimizationRepository.prototype, 'saveRecommendations').mockResolvedValue(undefined);
    jest.spyOn(OptimizationRepository.prototype, 'getSummary').mockResolvedValue(fakeSummary(50));

    const first = mockReqRes(orgId, userId);
    await controller.scan(first.req, first.res);
    expect(first.res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

    const second = mockReqRes(orgId, userId);
    await controller.scan(second.req, second.res);

    const rows = await fetchEvents(orgId, 'first_insight_generated');
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(userId);
    expect(rows[0].properties).toEqual({ recommendationCount: 1, totalMonthlySavings: 50 });
  });

  it('does not emit when the scan finds no recommendations at all', async () => {
    const orgId = await insertOrg();
    const controller = new OptimizationController(pool);

    jest.spyOn(OptimizationScannerService.prototype, 'scanOrganization').mockResolvedValue([]);
    jest.spyOn(OptimizationAIService.prototype, 'prioritizeRecommendations')
      .mockImplementation(async (recs) => recs);
    jest.spyOn(OptimizationRepository.prototype, 'saveRecommendations').mockResolvedValue(undefined);
    jest.spyOn(OptimizationRepository.prototype, 'getSummary').mockResolvedValue(fakeSummary(0));

    const { req, res } = mockReqRes(orgId, await insertUser());
    await controller.scan(req, res);

    const rows = await fetchEvents(orgId, 'first_insight_generated');
    expect(rows).toHaveLength(0);
  });
});

describe('OptimizationController.getRecommendations -> first_value_viewed', () => {
  it('emits first_value_viewed exactly once despite repeated reads (page refreshes)', async () => {
    const orgId = await insertOrg();
    const userId = await insertUser();
    const controller = new OptimizationController(pool);

    jest.spyOn(OptimizationRepository.prototype, 'getRecommendations')
      .mockResolvedValue([fakeRecommendation(orgId, 75)]);
    jest.spyOn(OptimizationRepository.prototype, 'getSummary').mockResolvedValue(fakeSummary(75));

    const first = mockReqRes(orgId, userId);
    await controller.getRecommendations(first.req, first.res);

    const second = mockReqRes(orgId, userId);
    await controller.getRecommendations(second.req, second.res);

    const third = mockReqRes(orgId, userId);
    await controller.getRecommendations(third.req, third.res);

    const rows = await fetchEvents(orgId, 'first_value_viewed');
    expect(rows).toHaveLength(1);
    expect(rows[0].properties).toEqual({ totalMonthlySavings: 75 });
  });

  it('does not emit when there is no real dollar value to see yet', async () => {
    const orgId = await insertOrg();
    const controller = new OptimizationController(pool);

    jest.spyOn(OptimizationRepository.prototype, 'getRecommendations').mockResolvedValue([]);
    jest.spyOn(OptimizationRepository.prototype, 'getSummary').mockResolvedValue(fakeSummary(0));

    const { req, res } = mockReqRes(orgId, await insertUser());
    await controller.getRecommendations(req, res);

    const rows = await fetchEvents(orgId, 'first_value_viewed');
    expect(rows).toHaveLength(0);
  });
});
