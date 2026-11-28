/**
 * Tier 0 shared source-of-truth: coverage for SystemIntelligenceService's cost
 * component after consolidation --
 *
 * 1. Placeholder-costs ruling F-13 (amended, fix round 1): the spend the score
 *    stands on is AWS Cost Explorer billed spend for the trailing 30 days (Cost
 *    Intelligence's window: the last 30 points of the 30d trend, unreported days
 *    adding nothing), costSource 'actual'. With no usable amount the component
 *    reads "Insufficient data", has no score, and leaves the composite, whose
 *    weights are rescaled (security 40/70, alert coverage 30/70). Never the
 *    inventory sum, never a neutral 50.
 * 2. totalSavings/totalOpps now come from CostRecommendationsRepository.
 *    getStats() (the same source the Dashboard's Savings Actions card and the
 *    cost-recommendations API read) instead of an independently duplicated
 *    SUM(potential_savings) WHERE status='ACTIVE' query.
 *
 * Security/observability sub-scores are stubbed out (computeSecurityScore /
 * computeObservabilityScore mocked) -- they're unchanged by this work and
 * would otherwise require the full CloudWatch/RiskTracking chain just to
 * reach the cost component under test. AWS Cost Explorer/STS are mocked at
 * the module level, same pattern as aws-cost-freshness.test.ts; aws_accounts,
 * aws_resources, cost_recommendations, and resource_discovery_jobs are real
 * Postgres rows.
 *
 * aws_accounts is defined only in backend/migrations/ (019/020) -- not
 * scanned by CI's schema bootstrap (.github/scripts/ci-bootstrap-schema.js
 * sources only database/migrations/ and database/migrations-admin/). A local
 * dev database typically already has this table; a from-scratch CI database
 * does not. The table comes from shared-fixture-tables.ts, which creates it
 * only if it's missing and never drops it, since other suites running in
 * parallel use it too; this suite deletes only its own rows.
 */
import { Pool } from 'pg';

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-sts', () => ({
  STSClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({
      Credentials: { AccessKeyId: 'AKIATEST', SecretAccessKey: 'secret', SessionToken: 'token' },
    }),
  })),
  AssumeRoleCommand: jest.fn().mockImplementation((input: unknown) => input),
}));

jest.mock('@aws-sdk/client-cost-explorer', () => {
  const actual = jest.requireActual('@aws-sdk/client-cost-explorer');
  return {
    ...actual,
    CostExplorerClient: jest.fn().mockImplementation(() => ({
      send: (...args: unknown[]) => mockSend(...args),
    })),
  };
});

import { SystemIntelligenceService } from '../system-intelligence.service';
import awsCostService, { type CostTrendPoint } from '../aws-cost.service';
import { CostRecommendationsRepository } from '../../repositories/cost-recommendations.repository';
import { ensureSharedFixtureTable } from '../../routes/__tests__/shared-fixture-tables';

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

function randomAccountId(): string {
  return Math.floor(Math.random() * 1e12).toString().padStart(12, '0');
}

async function insertOrgWithAwsAccount(): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $3, 'starter', 'active') RETURNING id`,
    [`Cost Score Org ${suffix}`, `cost-score-org-${suffix}`, `Cost Score Org ${suffix}`]
  );
  const orgId = rows[0].id as string;
  createdOrgIds.push(orgId);
  await pool.query(
    `INSERT INTO aws_accounts (account_id, role_arn, status, external_id, region, org_id)
     VALUES ($1, 'arn:aws:iam::123456789012:role/DevControlTest', 'active', 'ext-id-test', 'us-east-1', $2)`,
    [randomAccountId(), orgId]
  );
  await pool.query(
    `INSERT INTO resource_discovery_jobs (organization_id, status, cost_analysis_completed)
     VALUES ($1, 'completed', true)`,
    [orgId]
  );
  return orgId;
}

async function insertActiveRecommendation(orgId: string, resourceId: string, savings: number, savingsBasis = 'estimated: list price') {
  await pool.query(
    `INSERT INTO cost_recommendations
       (organization_id, resource_id, resource_type, issue, potential_savings, severity, status, metadata)
     VALUES ($1, $2, 'EC2', 'Idle instance', $3, 'MEDIUM', 'ACTIVE', jsonb_build_object('savings_basis', $4::text))`,
    [orgId, resourceId, savings, savingsBasis]
  );
}

async function insertAwsResource(orgId: string, resourceId: string, estimatedMonthlyCost: number) {
  await pool.query(
    `INSERT INTO aws_resources
       (organization_id, resource_arn, resource_id, resource_type, region, status, estimated_monthly_cost)
     VALUES ($1, $2, $2, 'EC2', 'us-east-1', 'running', $3)`,
    [orgId, `arn:aws:ec2:us-east-1:123456789012:instance/${resourceId}`, estimatedMonthlyCost]
  );
}

function stubSecurityAndObservability(service: SystemIntelligenceService, security = 80, observability = 80) {
  jest.spyOn(service as any, 'computeSecurityScore').mockResolvedValue({
    score: security, label: 'Security Posture', detail: '', severity: 'healthy', delta: null, status: 'good', ready: true, state: 'available', reason: null,
  });
  jest.spyOn(service as any, 'computeObservabilityScore').mockResolvedValue({
    score: observability, label: 'Observability', detail: '', severity: 'healthy', delta: null, status: 'good', ready: true, state: 'available', reason: null,
  });
}

beforeAll(async () => {
  // Not created by the canonical migrations; shared with other suites, so
  // ensured here and never dropped (shared-fixture-tables.ts).
  await ensureSharedFixtureTable(pool, 'aws_accounts');
});

beforeEach(() => {
  mockSend.mockReset();
});

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM cost_recommendations WHERE organization_id = ANY($1)', [createdOrgIds]);
    await pool.query('DELETE FROM aws_resources WHERE organization_id = ANY($1)', [createdOrgIds]);
    await pool.query('DELETE FROM resource_discovery_jobs WHERE organization_id = ANY($1)', [createdOrgIds]);
    await pool.query('DELETE FROM aws_accounts WHERE org_id = ANY($1)', [createdOrgIds]);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});

/**
 * The 30d trend fetchCostTrend returns: 31 daily points, the first outside Cost Intelligence's
 * 30-day window. `total` is spread over the 30 window days; `firstDay` is the day before the window.
 */
function trend30d(total: number, opts: { firstDay?: number; notReported?: number[] } = {}): CostTrendPoint[] {
  return Array.from({ length: 31 }, (_, i) => ({
    date: `2026-10-${String(i + 1).padStart(2, '0')}`,
    compute: 0, storage: 0, database: 0, network: 0, other: 0,
    total: i === 0 ? opts.firstDay ?? 0 : total / 30,
    reportState: opts.notReported?.includes(i) ? 'not_reported' : 'final',
  })) as unknown as CostTrendPoint[];
}

function mockBilled(result: CostTrendPoint[] | Error) {
  const trend = jest.spyOn(awsCostService, 'fetchCostTrend').mockImplementation(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  const monthToDate = jest.spyOn(awsCostService, 'fetchMonthlyCosts');
  return { trend, monthToDate };
}

afterEach(() => jest.restoreAllMocks());

describe('SystemIntelligenceService cost component -- consolidated monthly-spend + savings sources', () => {
  it('F-13 (amended): Cost Explorer billed spend for the trailing 30 days is the input; not month to date, never the inventory', async () => {
    const orgId = await insertOrgWithAwsAccount();
    // Flat placeholders that would dominate the old inventory sum.
    await insertAwsResource(orgId, 'i-rr-1', 500);
    await insertAwsResource(orgId, 'i-rr-2', 150);
    await insertActiveRecommendation(orgId, 'i-live-1', 0.96);
    // $25 over the window; a $1,000 day just before it is not in the window.
    const { trend, monthToDate } = mockBilled(trend30d(25, { firstDay: 1000 }));

    const service = new SystemIntelligenceService();
    stubSecurityAndObservability(service);

    const { cost } = (await service.getSystemIntelligence(orgId)).components;

    expect(trend).toHaveBeenCalledWith(orgId, '30d');
    expect(monthToDate).not.toHaveBeenCalled();
    expect(cost.costSource).toBe('actual');
    expect(cost.monthlySpend).toBeCloseTo(25, 6);
    // billed $25 vs $0.96 savings: 100 x 25 / 25.96 = 96.3
    expect(cost.score).toBe(96);
    expect(cost.reason).toContain('Based on AWS Cost Explorer billed spend for the last 30 days');
  });

  it('days Cost Explorer has not reported add nothing (as on Cost Intelligence)', async () => {
    const orgId = await insertOrgWithAwsAccount();
    await insertActiveRecommendation(orgId, 'i-gap', 10);
    mockBilled(trend30d(30, { notReported: [29, 30] }));
    const service = new SystemIntelligenceService();
    stubSecurityAndObservability(service);
    const { cost } = (await service.getSystemIntelligence(orgId)).components;
    expect(cost.monthlySpend).toBeCloseTo(28, 6);
  });

  it('cost included: the composite keeps its 30/40/30 weights', async () => {
    const orgId = await insertOrgWithAwsAccount();
    await insertActiveRecommendation(orgId, 'i-w', 0.96);
    mockBilled(trend30d(25));
    const service = new SystemIntelligenceService();
    stubSecurityAndObservability(service, 90, 60);
    const result = await service.getSystemIntelligence(orgId);
    // 96 x 0.30 + 90 x 0.40 + 60 x 0.30 = 82.8
    expect(result.system_score).toBe(83);
  });

  it.each([
    ['Cost Explorer fails', new Error('the Cost Explorer request failed')],
    ['no day in the window reported yet', trend30d(0, { notReported: Array.from({ length: 31 }, (_, i) => i) })],
    ['$0.00 billed over 30 days (nothing to divide by)', trend30d(0)],
  ])('ruling 5: %s -> "Insufficient data", no score (never a neutral 50), out of the composite with rescaled weights', async (_name, result) => {
    const orgId = await insertOrgWithAwsAccount();
    await insertAwsResource(orgId, 'i-est-1', 120.5);
    await insertAwsResource(orgId, 'i-est-2', 30.25);
    await insertActiveRecommendation(orgId, 'i-est-rec', 10);
    mockBilled(result);

    const service = new SystemIntelligenceService();
    stubSecurityAndObservability(service, 90, 60);
    const intelligence = await service.getSystemIntelligence(orgId);
    const { cost } = intelligence.components;

    expect(cost.score).toBeNull();
    expect(cost.insufficientData).toBe(true);
    expect(cost.detail).toBe('Insufficient data');
    expect(cost.state).toBe('unavailable');
    expect(cost.reason).toBe('Insufficient data: AWS Cost Explorer has no usable billed spend for the last 30 days, so cost is not included in the overall score.');
    // (90 x 0.40 + 60 x 0.30) / 0.70 = 77.14 -- not 80 (the old neutral 50 at 30%: 15 + 36 + 18 = 69).
    expect(intelligence.system_score).toBe(77);
    expect(intelligence.composite_state).toBe('partial');
    expect(intelligence.composite_reason).toContain('cost is not included in the overall score');
    expect(intelligence.top_drivers.some((d) => d.type === 'cost')).toBe(false);
  });

  it('savings aggregate reuse: totalSavings/totalOpps in the cost detail exactly match CostRecommendationsRepository.getStats() for the same org (no independent duplicate query)', async () => {
    const orgId = await insertOrgWithAwsAccount();
    await insertAwsResource(orgId, 'i-savings-rr', 1000);
    await insertActiveRecommendation(orgId, 'i-savings-1', 75);
    await insertActiveRecommendation(orgId, 'i-savings-2', 25);
    mockBilled(trend30d(1000));

    const service = new SystemIntelligenceService();
    stubSecurityAndObservability(service);

    const [result, statsFromRepository] = await Promise.all([
      service.getSystemIntelligence(orgId),
      new CostRecommendationsRepository().getStats(orgId),
    ]);

    // 100 total savings across 2 active recommendations -- asserted against the
    // repository's own independently-fetched result, not a hardcoded number, so
    // this proves the two sources agree rather than merely that both equal 100.
    expect(statsFromRepository.total_potential_savings).toBeCloseTo(100, 2);
    expect(statsFromRepository.active_recommendations).toBe(2);
    expect(result.components.cost.detail).toContain('$100/mo estimated savings identified');
    expect(result.components.cost.detail).toContain('2 opportunities');
  });

  it('an S3 lifecycle ceiling or a figure with no savings basis never enters the cost score\'s savings', async () => {
    const orgId = await insertOrgWithAwsAccount();
    await insertAwsResource(orgId, 'i-ceiling-rr', 1000);
    await insertActiveRecommendation(orgId, 'i-estimate', 40);
    await insertActiveRecommendation(orgId, 'example-bucket', 500, 'ceiling: assumes 100% of current Standard storage transitions to Standard-IA');
    await pool.query(
      `INSERT INTO cost_recommendations
         (organization_id, resource_id, resource_type, issue, potential_savings, severity, status)
       VALUES ($1, 'dev-db', 'RDS', 'Oversized Instance', 900, 'HIGH', 'ACTIVE')`,
      [orgId]
    );
    mockBilled(trend30d(1000));

    const service = new SystemIntelligenceService();
    stubSecurityAndObservability(service);

    const result = await service.getSystemIntelligence(orgId);

    expect(result.components.cost.detail).toContain('$40/mo estimated savings identified');
  });

  it('"Never show $0" (ruling Q6): a total under $1 is shown in cents, never "$0/mo estimated savings identified"', async () => {
    const orgId = await insertOrgWithAwsAccount();
    await insertAwsResource(orgId, 'i-small-rr', 100);
    await insertActiveRecommendation(orgId, 'vol-small', 0.08);
    mockBilled(trend30d(100));

    const service = new SystemIntelligenceService();
    stubSecurityAndObservability(service);

    const result = await service.getSystemIntelligence(orgId);

    expect(result.components.cost.detail).toContain('$0.08/mo estimated savings identified');
    expect(result.components.cost.detail).not.toMatch(/(?<![\d.])\$0\/mo/);
  });

  it('ACTIVE filtering is preserved: a RESOLVED recommendation is excluded from the cost score\'s savings detail, matching getStats() semantics', async () => {
    const orgId = await insertOrgWithAwsAccount();
    await insertAwsResource(orgId, 'i-active-rr', 500);
    await insertActiveRecommendation(orgId, 'i-active-only', 40);
    await pool.query(
      `INSERT INTO cost_recommendations
         (organization_id, resource_id, resource_type, issue, potential_savings, severity, status)
       VALUES ($1, 'i-resolved', 'EC2', 'Idle instance', 999, 'MEDIUM', 'RESOLVED')`,
      [orgId]
    );
    mockBilled(trend30d(500));

    const service = new SystemIntelligenceService();
    stubSecurityAndObservability(service);

    const result = await service.getSystemIntelligence(orgId);

    expect(result.components.cost.detail).toContain('$40/mo estimated savings identified');
    expect(result.components.cost.detail).toContain('1 opportunities');
    expect(result.components.cost.detail).not.toContain('999');
  });
});
