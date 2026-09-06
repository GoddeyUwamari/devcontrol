/**
 * Coverage for AIChatContextRepository's cost-provenance and discovery-
 * freshness metadata: gatherContext() must distinguish actual/estimated/
 * unavailable cost data (mirroring stats.controller.ts's own Dashboard
 * fallback logic, not a new definition), and must surface the latest
 * *completed* discovery run's timestamp -- never a fabricated one, and
 * never one taken from a still-running or failed job.
 *
 * awsCostService.fetchMonthlyCosts/fetchCostTrend are mocked (no real AWS
 * call); aws_resources and resource_discovery_jobs rows are real Postgres,
 * same pattern as every other repository test in this backend.
 */
import { Pool } from 'pg';
import { AIChatContextRepository } from '../ai-chat-context.repository';
import awsCostService from '../../services/aws-cost.service';

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
const contextRepo = new AIChatContextRepository(pool);
const createdOrgIds: string[] = [];

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function insertOrg(): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $3, 'starter', 'active') RETURNING id`,
    [`Context Provenance Org ${suffix}`, `context-provenance-org-${suffix}`, `Context Provenance Org ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function insertDiscoveryJob(
  organizationId: string,
  status: 'completed' | 'running' | 'failed',
  completedAt: Date | null
): Promise<void> {
  await pool.query(
    `INSERT INTO resource_discovery_jobs (organization_id, status, started_at, completed_at, resource_types, regions)
     VALUES ($1, $2, NOW(), $3, ARRAY['ec2'], ARRAY['us-east-1'])`,
    [organizationId, status, completedAt]
  );
}

async function insertAwsResourceWithEstimate(organizationId: string, estimatedMonthlyCost: number): Promise<void> {
  await pool.query(
    `INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_type, region, status, estimated_monthly_cost)
     VALUES ($1, $2, $3, 'ec2', 'us-east-1', 'running', $4)`,
    [organizationId, `arn:aws:ec2:us-east-1:123456789012:instance/i-${uniqueSuffix()}`, `i-${uniqueSuffix()}`, estimatedMonthlyCost]
  );
}

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM resource_discovery_jobs WHERE organization_id = ANY($1)', [createdOrgIds]);
    await pool.query('DELETE FROM aws_resources WHERE organization_id = ANY($1)', [createdOrgIds]);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('AIChatContextRepository -- discovery freshness', () => {
  it('a completed discovery job\'s completed_at is surfaced as resourceDataAsOf', async () => {
    const orgId = await insertOrg();
    const completedAt = new Date('2026-09-06T05:00:00.000Z');
    await insertDiscoveryJob(orgId, 'completed', completedAt);
    jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockRejectedValue(new Error('AWS_NOT_CONNECTED'));
    jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue([]);

    const context = await contextRepo.gatherContext(orgId);

    expect(context.resourceDataAsOf).toBe(completedAt.toISOString());
  });

  it('a still-running (not yet completed) job does not produce a resourceDataAsOf timestamp', async () => {
    const orgId = await insertOrg();
    await insertDiscoveryJob(orgId, 'running', null);
    jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockRejectedValue(new Error('AWS_NOT_CONNECTED'));
    jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue([]);

    const context = await contextRepo.gatherContext(orgId);

    expect(context.resourceDataAsOf).toBeNull();
  });

  it('a failed job does not produce a resourceDataAsOf timestamp', async () => {
    const orgId = await insertOrg();
    await insertDiscoveryJob(orgId, 'failed', null);
    jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockRejectedValue(new Error('AWS_NOT_CONNECTED'));
    jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue([]);

    const context = await contextRepo.gatherContext(orgId);

    expect(context.resourceDataAsOf).toBeNull();
  });

  it('no discovery job at all yields null, never a fabricated timestamp', async () => {
    const orgId = await insertOrg();
    jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockRejectedValue(new Error('AWS_NOT_CONNECTED'));
    jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue([]);

    const context = await contextRepo.gatherContext(orgId);

    expect(context.resourceDataAsOf).toBeNull();
  });
});

describe('AIChatContextRepository -- cost provenance (actual / estimated / unavailable)', () => {
  it('a real positive Cost Explorer total is reported as source "actual" with its own fetchedAt', async () => {
    const orgId = await insertOrg();
    const fetchedAt = '2026-09-06T09:30:00.000Z';
    jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockResolvedValue({
      total: 250.5,
      byService: [{ service: 'Amazon Elastic Compute Cloud - Compute', amount: 250.5 }],
      period: { start: '2026-09-01', end: '2026-09-07' },
      fetchedAt,
    });
    jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue([]);

    const context = await contextRepo.gatherContext(orgId);

    expect(context.costs.source).toBe('actual');
    expect(context.costs.asOf).toBe(fetchedAt);
    expect(context.costs.current).toBe(251); // rounded
  });

  it('Cost Explorer failing, with a usable aws_resources estimate present, falls back to source "estimated" using discovery freshness as its asOf', async () => {
    const orgId = await insertOrg();
    const completedAt = new Date('2026-09-06T04:00:00.000Z');
    await insertDiscoveryJob(orgId, 'completed', completedAt);
    await insertAwsResourceWithEstimate(orgId, 42);
    jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockRejectedValue(new Error('AWS_NOT_CONNECTED: no account'));
    jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue([]);

    const context = await contextRepo.gatherContext(orgId);

    expect(context.costs.source).toBe('estimated');
    expect(context.costs.current).toBe(42);
    expect(context.costs.asOf).toBe(completedAt.toISOString());
  });

  it('Cost Explorer failing AND no usable estimate produces source "unavailable" -- never a bare $0 masquerading as confirmed spend', async () => {
    const orgId = await insertOrg();
    jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockRejectedValue(new Error('AWS_NOT_CONNECTED: no account'));
    jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue([]);

    const context = await contextRepo.gatherContext(orgId);

    expect(context.costs.source).toBe('unavailable');
    expect(context.costs.current).toBe(0);
    expect(context.costs.asOf).toBeNull();
  });

  it('Cost Explorer returning a real zero total (genuinely no spend) is treated the same as unreachable -- falls through to the estimate/unavailable path, not labeled "actual"', async () => {
    const orgId = await insertOrg();
    jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockResolvedValue({
      total: 0,
      byService: [],
      period: { start: '2026-09-01', end: '2026-09-07' },
      fetchedAt: '2026-09-06T09:30:00.000Z',
    });
    jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue([]);

    const context = await contextRepo.gatherContext(orgId);

    // Matches stats.controller.ts's own getDashboardStats() semantics exactly:
    // total > 0 is the only condition that counts as 'actual'.
    expect(context.costs.source).not.toBe('actual');
  });
});
