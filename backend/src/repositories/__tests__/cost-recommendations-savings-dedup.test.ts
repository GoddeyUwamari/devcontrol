/**
 * Live-DB coverage for CostRecommendationsRepository.getStats()'s estimated
 * savings aggregate: the canonical total every surface reads (dashboard,
 * Cost Optimization, System Intelligence, AI summary, weekly email) must not
 * count the same instance's cost twice across an idle-instance finding and a
 * Reserved Instance opportunity. Runs against the local Postgres, like
 * cost-recommendations-occurrence-lifecycle.test.ts.
 */
import { Pool } from 'pg';
import { CostRecommendationsRepository } from '../cost-recommendations.repository';
import type { CreateRecommendationRequest } from '../../types';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'platform_portal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});
const repository = new CostRecommendationsRepository();
const createdOrgIds: string[] = [];

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
        metadata: { savings_claim: { kind: 'full_resource_cost', resource_ids: ['i-a'] } },
      }),
      rec({
        resource_id: 'ri-opportunity-m5.large',
        issue: 'Reserved Instance Opportunity',
        potential_savings: 49,
        metadata: { savings_claim: { kind: 'fleet_discount', resource_ids: ['i-a', 'i-b'], per_resource_savings: 24.5, counted_resources: 2 } },
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
      rec({ potential_savings: 70, metadata: { savings_claim: { kind: 'full_resource_cost', resource_ids: ['i-a'] } } }),
      rec({ resource_id: 'vol-1', resource_type: 'EBS', issue: 'Unattached EBS Volume', potential_savings: 12.4 }),
    ], orgId);

    const stats = await repository.getStats(orgId);

    expect(stats.total_potential_savings).toBe(82.4);
    expect(stats.potential_savings_by_resource_type).toEqual({ EC2: 70, EBS: 12.4 });
  });

  it('an organization with no active recommendations has a total of 0 and no per-type entries', async () => {
    const orgId = await insertOrg();

    const stats = await repository.getStats(orgId);

    expect(stats.total_potential_savings).toBe(0);
    expect(stats.potential_savings_by_resource_type).toEqual({});
  });
});
