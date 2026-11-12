/**
 * Live-DB coverage for CostRecommendationsRepository.getStats()'s estimated
 * savings aggregate: the canonical total every surface reads (dashboard,
 * Cost Optimization, System Intelligence, AI summary, weekly email) must not
 * count the same instance's cost twice across an idle-instance finding and a
 * Reserved Instance opportunity, and an S3 lifecycle ceiling (an upper bound)
 * is never summed into it. Runs against the local Postgres, like
 * cost-recommendations-occurrence-lifecycle.test.ts.
 */
import { Pool } from 'pg';
import { CostRecommendationsRepository } from '../cost-recommendations.repository';
import type { CreateRecommendationRequest } from '../../types';
import { ISSUE_DYNAMODB_ON_DEMAND_VS_PROVISIONED } from '../../config/optimization-rules';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'platform_portal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});
const repository = new CostRecommendationsRepository();
const createdOrgIds: string[] = [];
const ESTIMATED = 'estimated: list price';

async function insertOrg(): Promise<string> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $3, 'free', 'free')
     RETURNING id`,
    [`Savings Dedup Org ${suffix}`, `savings-dedup-org-${suffix}`, `Savings Dedup Org ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

function rec(overrides: Partial<CreateRecommendationRequest>): CreateRecommendationRequest {
  return {
    resource_id: 'i-a',
    resource_name: 'i-a',
    resource_type: 'EC2',
    issue: 'Idle Instance',
    description: 'test',
    potential_savings: 0,
    severity: 'LOW',
    aws_region: 'us-east-1',
    metadata: {},
    ...overrides,
  };
}

/**
 * What detectDynamoDBOnDemandVsProvisionedOptimization() stores when its
 * confidence gate blocks the recommendation: potential_savings 0 and the
 * blocked savings_basis (copied from cost-optimization.service.ts).
 */
const BLOCKED_COMPARISON_BASIS =
  'comparison:on_demand_vs_provisioned_observed_workload — modeled cost difference only; does not meet ' +
  'DevControl\'s confidence policy for a recommendation this cycle (see metadata.recommendation.blocked_reasons)';
function blockedComparison(table: string): CreateRecommendationRequest {
  return rec({
    resource_id: table,
    resource_name: table,
    resource_type: 'DynamoDB',
    issue: ISSUE_DYNAMODB_ON_DEMAND_VS_PROVISIONED,
    potential_savings: 0,
    metadata: {
      savings_basis: BLOCKED_COMPARISON_BASIS,
      recommendation: { recommended: false, blocked_reasons: ['synthetic: modeled advantage below the policy minimum'] },
    },
  });
}

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});

describe('getStats -- estimated potential savings aggregate', () => {
  it('does not double-count an instance that is both an idle candidate and in an RI opportunity pool', async () => {
    const orgId = await insertOrg();
    await repository.createBulk([
      rec({
        potential_savings: 70,
        metadata: { savings_basis: ESTIMATED, savings_claim: { kind: 'full_resource_cost', resource_ids: ['i-a'] } },
      }),
      rec({
        resource_id: 'ri-opportunity-m5.large',
        issue: 'Reserved Instance Opportunity',
        potential_savings: 49,
        metadata: { savings_basis: ESTIMATED, savings_claim: { kind: 'fleet_discount', resource_ids: ['i-a', 'i-b'], per_resource_savings: 24.5, counted_resources: 2 } },
      }),
    ], orgId);

    const stats = await repository.getStats(orgId);

    expect(stats.active_recommendations).toBe(2); // both categories stay visible
    expect(stats.total_potential_savings).toBe(94.5); // not 119
    expect(stats.potential_savings_by_resource_type).toEqual({ EC2: 94.5 });
  });

  it('distinct resources across types aggregate to their plain sum', async () => {
    const orgId = await insertOrg();
    await repository.createBulk([
      rec({ potential_savings: 70, metadata: { savings_basis: ESTIMATED, savings_claim: { kind: 'full_resource_cost', resource_ids: ['i-a'] } } }),
      rec({ resource_id: 'vol-1', resource_type: 'EBS', issue: 'Unattached EBS Volume', potential_savings: 12.4, metadata: { savings_basis: ESTIMATED } }),
    ], orgId);

    const stats = await repository.getStats(orgId);

    expect(stats.total_potential_savings).toBe(82.4);
    expect(stats.potential_savings_by_resource_type).toEqual({ EC2: 70, EBS: 12.4 });
  });

  it('an S3 lifecycle ceiling is excluded from the total and exposed as potential_savings_ceiling', async () => {
    const orgId = await insertOrg();
    await repository.createBulk([
      rec({ resource_id: 'vol-1', resource_type: 'EBS', issue: 'Unattached EBS Volume', potential_savings: 12.4, metadata: { savings_basis: ESTIMATED } }),
      rec({
        resource_id: 'example-bucket', resource_type: 'S3', issue: 'S3 Lifecycle Optimization', potential_savings: 41.27,
        metadata: { savings_basis: 'ceiling: assumes 100% of current Standard storage transitions to Standard-IA; does not net out Standard-IA retrieval fees' },
      }),
    ], orgId);

    const stats = await repository.getStats(orgId);

    expect(stats.active_recommendations).toBe(2);
    expect(stats.total_potential_savings).toBe(12.4);
    expect(stats.potential_savings_by_resource_type).toEqual({ EBS: 12.4 });
    expect(stats.potential_savings_ceiling).toBe(41.27);
    expect(stats.potential_savings_ceiling_by_resource_type).toEqual({ S3: 41.27 });
  });

  it('a figure with no savings_basis (e.g. a legacy row) is counted in neither total, but stays an active recommendation', async () => {
    const orgId = await insertOrg();
    await repository.createBulk([
      rec({ resource_id: 'dev-db', resource_type: 'RDS', issue: 'Oversized Instance', potential_savings: 98, metadata: {} }),
    ], orgId);

    const stats = await repository.getStats(orgId);

    expect(stats.active_recommendations).toBe(1);
    expect(stats.total_potential_savings).toBe(0);
    expect(stats.potential_savings_ceiling).toBe(0);
  });

  it('an organization with no active recommendations has a total of 0 and no per-type entries', async () => {
    const orgId = await insertOrg();

    const stats = await repository.getStats(orgId);

    expect(stats.total_potential_savings).toBe(0);
    expect(stats.potential_savings_by_resource_type).toEqual({});
    expect(stats.potential_savings_ceiling).toBe(0);
    expect(stats.potential_savings_ceiling_by_resource_type).toEqual({});
  });
});

describe('getActiveSavingsBreakdown -- the weekly email savings states (WE-1)', () => {
  it('splits open findings into estimates, upper bounds and no figure; the estimate total matches getStats', async () => {
    const orgId = await insertOrg();
    await repository.createBulk([
      rec({ resource_id: 'vol-a', resource_type: 'EBS', issue: 'Unattached Volume', potential_savings: 12.5, metadata: { savings_basis: ESTIMATED } }),
      rec({ resource_id: 'bucket-a', resource_type: 'S3', issue: 'Lifecycle', potential_savings: 300, metadata: { savings_basis: 'ceiling: all Standard data qualifies' } }),
      rec({ resource_id: 'ri-a', issue: 'Reserved Instance Opportunity', potential_savings: 0, metadata: {} }),
    ], orgId);

    const b = await repository.getActiveSavingsBreakdown(orgId);
    expect(b).toEqual({
      active: 3,
      estimatedMonthlySavings: 12.5,
      estimatedFindings: 1,
      ceilingByResourceType: { S3: 300 },
      unestimatedFindings: 1,
    });
    expect(b.estimatedMonthlySavings).toBe((await repository.getStats(orgId)).total_potential_savings);
  });

  it('only upper bounds and unpriced findings: the estimate total is 0 with no estimated finding -- never a "$0" estimate', async () => {
    const orgId = await insertOrg();
    await repository.createBulk([
      rec({ resource_id: 'bucket-b', resource_type: 'S3', issue: 'Lifecycle', potential_savings: 310, metadata: { savings_basis: 'ceiling: all Standard data qualifies' } }),
      rec({ resource_id: 'ri-b', issue: 'Reserved Instance Opportunity', potential_savings: 0, metadata: {} }),
    ], orgId);

    const b = await repository.getActiveSavingsBreakdown(orgId);
    expect(b.estimatedFindings).toBe(0);
    expect(b.ceilingByResourceType).toEqual({ S3: 310 });
    expect(b.unestimatedFindings).toBe(1);
  });

  // WE-1 review H-1: an estimate row stored at $0 is not an estimated finding.
  it('a gate-blocked DynamoDB comparison ($0, comparison: basis) is a finding with no dollar estimate', async () => {
    const orgId = await insertOrg();
    await repository.createBulk([blockedComparison('table-a')], orgId);

    expect(await repository.getActiveSavingsBreakdown(orgId)).toEqual({
      active: 1, estimatedMonthlySavings: 0, estimatedFindings: 0, ceilingByResourceType: {}, unestimatedFindings: 1,
    });
  });

  it('an estimate plus two blocked comparisons: the estimate counts once, the blocked rows have no figure', async () => {
    const orgId = await insertOrg();
    await repository.createBulk([
      rec({ resource_id: 'db-a', resource_type: 'RDS', issue: 'Idle Database', potential_savings: 845, metadata: { savings_basis: ESTIMATED } }),
      blockedComparison('table-b'),
      blockedComparison('table-c'),
    ], orgId);

    const b = await repository.getActiveSavingsBreakdown(orgId);
    expect(b).toEqual({
      active: 3, estimatedMonthlySavings: 845, estimatedFindings: 1, ceilingByResourceType: {}, unestimatedFindings: 2,
    });
    expect(b.estimatedMonthlySavings).toBe((await repository.getStats(orgId)).total_potential_savings);
  });

  it('a fleet discount whose whole pool is already claimed adds $0, so it is not an estimated finding', async () => {
    const orgId = await insertOrg();
    await repository.createBulk([
      rec({ potential_savings: 70, metadata: { savings_basis: ESTIMATED, savings_claim: { kind: 'full_resource_cost', resource_ids: ['i-a'] } } }),
      rec({
        resource_id: 'ri-opportunity-m5.large',
        issue: 'Reserved Instance Opportunity',
        potential_savings: 24.5,
        metadata: { savings_basis: ESTIMATED, savings_claim: { kind: 'fleet_discount', resource_ids: ['i-a'], per_resource_savings: 24.5, counted_resources: 1 } },
      }),
    ], orgId);

    expect(await repository.getActiveSavingsBreakdown(orgId)).toEqual({
      active: 2, estimatedMonthlySavings: 70, estimatedFindings: 1, ceilingByResourceType: {}, unestimatedFindings: 1,
    });
  });

  // PR-ICONS-b: /stats returns the email's own counts, so the Dashboard's savings
  // header ("across N open findings", "K more ... no dollar estimate") matches the email.
  it('getStats returns the same estimated and unestimated finding counts as the weekly email breakdown', async () => {
    const orgId = await insertOrg();
    await repository.createBulk([
      rec({ potential_savings: 70, metadata: { savings_basis: ESTIMATED, savings_claim: { kind: 'full_resource_cost', resource_ids: ['i-a'] } } }),
      rec({
        resource_id: 'ri-opportunity-m5.large',
        issue: 'Reserved Instance Opportunity',
        potential_savings: 24.5,
        metadata: { savings_basis: ESTIMATED, savings_claim: { kind: 'fleet_discount', resource_ids: ['i-a'], per_resource_savings: 24.5, counted_resources: 1 } },
      }),
      rec({ resource_id: 'vol-a', resource_type: 'EBS', issue: 'Unattached Volume', potential_savings: 12.5, metadata: { savings_basis: ESTIMATED } }),
      rec({ resource_id: 'bucket-a', resource_type: 'S3', issue: 'Lifecycle', potential_savings: 300, metadata: { savings_basis: 'ceiling: all Standard data qualifies' } }),
      blockedComparison('table-d'),
    ], orgId);

    const [b, stats] = [await repository.getActiveSavingsBreakdown(orgId), await repository.getStats(orgId)];
    expect(b).toEqual({ active: 5, estimatedMonthlySavings: 82.5, estimatedFindings: 2, ceilingByResourceType: { S3: 300 }, unestimatedFindings: 2 });
    expect(stats.estimated_findings).toBe(b.estimatedFindings);
    expect(stats.unestimated_findings).toBe(b.unestimatedFindings);
    expect(stats.total_potential_savings).toBe(b.estimatedMonthlySavings);
  });

  it('getStats counts are 0 with no open findings', async () => {
    const orgId = await insertOrg();
    const stats = await repository.getStats(orgId);
    expect(stats.estimated_findings).toBe(0);
    expect(stats.unestimated_findings).toBe(0);
  });

  it('no open findings', async () => {
    const orgId = await insertOrg();
    expect(await repository.getActiveSavingsBreakdown(orgId)).toEqual({
      active: 0, estimatedMonthlySavings: 0, estimatedFindings: 0, ceilingByResourceType: {}, unestimatedFindings: 0,
    });
  });
});
