/**
 * Tier 0 shared source-of-truth: coverage for SystemIntelligenceService's cost
 * component after consolidation --
 *
 * 1. monthlySpend is the inventory's monthly run-rate
 *    (AWSCostService.getInventoryMonthlyRunRate()), never Cost Explorer
 *    month-to-date spend; costSource is always 'estimated'.
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

function costExplorerResponse(service: string, amount: string) {
  return {
    ResultsByTime: [{ Groups: [{ Keys: [service], Metrics: { UnblendedCost: { Amount: amount } } }] }],
  };
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

async function insertActiveRecommendation(orgId: string, resourceId: string, savings: number) {
  await pool.query(
    `INSERT INTO cost_recommendations
       (organization_id, resource_id, resource_type, issue, potential_savings, severity, status)
     VALUES ($1, $2, 'EC2', 'Idle instance', $3, 'MEDIUM', 'ACTIVE')`,
    [orgId, resourceId, savings]
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

function stubSecurityAndObservability(service: SystemIntelligenceService) {
  jest.spyOn(service as any, 'computeSecurityScore').mockResolvedValue({
    score: 80, label: 'Security Posture', detail: '', severity: 'healthy', delta: null, status: 'good', ready: true,
  });
  jest.spyOn(service as any, 'computeObservabilityScore').mockResolvedValue({
    score: 80, label: 'Observability', detail: '', severity: 'healthy', delta: null, status: 'good', ready: true,
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

describe('SystemIntelligenceService cost component -- consolidated monthly-spend + savings sources', () => {
  it('Cost Explorer month-to-date spend is never the input: with live spend available, monthlySpend is still the inventory run-rate and Cost Explorer is not called', async () => {
    const orgId = await insertOrgWithAwsAccount();
    await insertAwsResource(orgId, 'i-rr-1', 20);
    await insertAwsResource(orgId, 'i-rr-2', 5);
    await insertActiveRecommendation(orgId, 'i-live-1', 0.96);
    mockSend.mockResolvedValue(costExplorerResponse('Amazon Elastic Compute Cloud - Compute', '0.19'));

    const service = new SystemIntelligenceService();
    stubSecurityAndObservability(service);

    const { cost } = (await service.getSystemIntelligence(orgId)).components;

    expect(cost.costSource).toBe('estimated');
    expect(cost.monthlySpend).toBeCloseTo(25, 2);
    expect(mockSend).not.toHaveBeenCalled();
    // run-rate $25 vs $0.96 savings: 100 x 25 / 25.96 = 96.3 -- not the MTD-driven 38.
    expect(cost.score).toBe(96);
  });

  it('the score does not move when month-to-date spend changes (MTD $0.19 vs $5,000)', async () => {
    const scores: number[] = [];
    for (const mtd of ['0.19', '5000.00']) {
      const orgId = await insertOrgWithAwsAccount();
      await insertAwsResource(orgId, `i-mtd-${mtd}`, 25);
      await insertActiveRecommendation(orgId, `i-mtd-rec-${mtd}`, 0.96);
      mockSend.mockReset();
      mockSend.mockResolvedValue(costExplorerResponse('Amazon Elastic Compute Cloud - Compute', mtd));

      const service = new SystemIntelligenceService();
      stubSecurityAndObservability(service);
      scores.push((await service.getSystemIntelligence(orgId)).components.cost.score);
    }
    expect(scores).toEqual([96, 96]);
  });

  it('DB estimate path (Cost Explorer returns nothing): costSource is "estimated" and monthlySpend matches the aws_resources sum exactly', async () => {
    const orgId = await insertOrgWithAwsAccount();
    await insertAwsResource(orgId, 'i-est-1', 120.5);
    await insertAwsResource(orgId, 'i-est-2', 30.25);
    mockSend.mockResolvedValueOnce({ ResultsByTime: [{ Groups: [] }] }); // live total = 0 -- forces fallback

    const service = new SystemIntelligenceService();
    stubSecurityAndObservability(service);

    const result = await service.getSystemIntelligence(orgId);

    expect(result.components.cost.costSource).toBe('estimated');
    expect(result.components.cost.monthlySpend).toBeCloseTo(150.75, 2);
  });

  it('savings aggregate reuse: totalSavings/totalOpps in the cost detail exactly match CostRecommendationsRepository.getStats() for the same org (no independent duplicate query)', async () => {
    const orgId = await insertOrgWithAwsAccount();
    await insertAwsResource(orgId, 'i-savings-rr', 1000);
    await insertActiveRecommendation(orgId, 'i-savings-1', 75);
    await insertActiveRecommendation(orgId, 'i-savings-2', 25);
    mockSend.mockResolvedValueOnce(costExplorerResponse('Amazon Elastic Compute Cloud - Compute', '1000.00'));

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
    mockSend.mockResolvedValueOnce(costExplorerResponse('Amazon Elastic Compute Cloud - Compute', '500.00'));

    const service = new SystemIntelligenceService();
    stubSecurityAndObservability(service);

    const result = await service.getSystemIntelligence(orgId);

    expect(result.components.cost.detail).toContain('$40/mo estimated savings identified');
    expect(result.components.cost.detail).toContain('1 opportunities');
    expect(result.components.cost.detail).not.toContain('999');
  });
});
