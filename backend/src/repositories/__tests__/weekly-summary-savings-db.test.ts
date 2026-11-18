/**
 * WE-1 review H-1, end to end on the database: open cost_recommendations rows
 * go through the REAL CostRecommendationsRepository.getActiveSavingsBreakdown(),
 * the real facts and rules (executive brief) and the real HTML template and
 * text part. A gate-blocked DynamoDB capacity-mode comparison is stored at $0
 * with a "comparison:" (estimate-class) basis; it is a finding with no dollar
 * estimate, never "$0/mo" (founder Q6/Q7), and the email's figure is the one
 * the Cost Optimization page shows for the same rows (getStats).
 *
 * Runs against the local Postgres, like cost-recommendations-savings-dedup.
 * Every organization, figure and URL is synthetic; nothing is sent.
 */
jest.mock('../../services/aws-cost.service', () => ({
  ...jest.requireActual('../../services/aws-cost.service'),
  __esModule: true,
  default: {
    fetchCostTrend: jest.fn(),
    getCostTrendFetchedAt: jest.fn(async () => '2026-11-16T09:00:00.000Z'),
  },
}));

import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';
import { CostRecommendationsRepository } from '../cost-recommendations.repository';
import { ISSUE_DYNAMODB_ON_DEMAND_VS_PROVISIONED } from '../../config/optimization-rules';
import { composeWeeklyBrief } from '../../services/weekly-brief/rules';
import { weeklyFacts } from '../../services/weekly-brief/facts';
import { WeeklyAISummaryJob } from '../../jobs/weekly-ai-summary.job';
import { FIXTURE_ORG_NAME, FIXTURE_URLS, available, connectedEvidence } from '../../jobs/__tests__/weekly-email-fixtures';
import type { WeeklyRecommendationEvidence } from '../weekly-summary.repository';
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
const originalResendKey = process.env.RESEND_API_KEY;
let job: WeeklyAISummaryJob;

/** What the detector stores when its confidence gate blocks the recommendation (cost-optimization.service.ts). */
const BLOCKED_COMPARISON_BASIS =
  'comparison:on_demand_vs_provisioned_observed_workload — modeled cost difference only; does not meet ' +
  'DevControl\'s confidence policy for a recommendation this cycle (see metadata.recommendation.blocked_reasons)';

beforeAll(() => {
  delete process.env.RESEND_API_KEY;
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  job = new WeeklyAISummaryJob({} as Pool);
});

afterAll(async () => {
  if (originalResendKey) process.env.RESEND_API_KEY = originalResendKey;
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});

async function insertOrg(): Promise<string> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $3, 'free', 'free')
     RETURNING id`,
    [`Weekly Savings Org ${suffix}`, `weekly-savings-org-${suffix}`, `Weekly Savings Org ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

function rec(overrides: Partial<CreateRecommendationRequest>): CreateRecommendationRequest {
  return {
    resource_id: 'db-a',
    resource_name: 'db-a',
    resource_type: 'RDS',
    issue: 'Idle Database',
    description: 'synthetic',
    potential_savings: 0,
    severity: 'LOW',
    aws_region: 'us-east-1',
    metadata: {},
    ...overrides,
  };
}

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

/** The org's rows through the real breakdown, facts, rules and renderer; every other source is a clean connected week. */
async function renderFromDatabase(orgId: string) {
  const breakdown = await repository.getActiveSavingsBreakdown(orgId);
  const brief = composeWeeklyBrief(
    weeklyFacts(connectedEvidence({ recommendations: available<WeeklyRecommendationEvidence>('DevControl cost recommendations', breakdown) })),
    { organizationName: FIXTURE_ORG_NAME, planName: 'Optimization Engine' }
  );
  const data = job.buildTemplateData({ userName: 'Alex', brief, organizationName: FIXTURE_ORG_NAME, ...FIXTURE_URLS });
  data.year = 2026;
  const { html, text } = job.renderEmail(data);
  const cost = brief.attention.find(item => item.title.startsWith('Cost ·'));
  return { html, text, tile: brief.tiles[2], cost };
}

it('the blocked-row basis copied here is the one the detector writes', () => {
  const service = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'cost-optimization.service.ts'), 'utf8');
  expect(service).toContain("'comparison:on_demand_vs_provisioned_observed_workload — modeled cost difference only; does not meet '");
  expect(service).toContain("'DevControl\\'s confidence policy for a recommendation this cycle (see metadata.recommendation.blocked_reasons)'");
  expect(service).toMatch(/const potentialSavings = recommendationGate\.recommend \? Math\.max\(0, modeledCostDifference\) : 0;/);
});

describe('weekly email savings from database rows (WE-1 review H-1)', () => {
  it('one gate-blocked DynamoDB comparison: never "$0/mo"; "1 open · no dollar estimate yet"', async () => {
    const orgId = await insertOrg();
    await repository.createBulk([blockedComparison('table-a')], orgId);

    const { html, text, tile, cost } = await renderFromDatabase(orgId);
    expect(tile).toEqual({ label: 'ESTIMATED SAVINGS', sublabel: 'Open opportunities', value: '1 open · no dollar estimate yet', lines: [] });
    expect(cost).toMatchObject({ title: 'Cost · 1 open opportunity', body: ['1 open opportunity, no dollar estimate yet.'] });
    for (const out of [html, text]) {
      expect(out).not.toMatch(/\$0\/mo/);
    }

    // The dashboard card reads getStats for the same rows: a figure only when the total is above $0,
    // otherwise "1 finding found; none has a dollar estimate yet." (executive-roi-card.tsx).
    const stats = await repository.getStats(orgId);
    expect(stats.total_potential_savings).toBe(0);
    expect(stats.potential_savings_ceiling).toBe(0);
    expect(stats.active_recommendations).toBe(1);
  });

  it('a $845 estimate plus two blocked comparisons: "$845/mo", the other two have no estimate', async () => {
    const orgId = await insertOrg();
    await repository.createBulk([
      rec({ potential_savings: 845, metadata: { savings_basis: 'estimated: list price' } }),
      blockedComparison('table-b'),
      blockedComparison('table-c'),
    ], orgId);

    const { html, text, tile, cost } = await renderFromDatabase(orgId);
    expect(tile.value).toBe('$845/mo');
    expect(cost!.body).toEqual(['3 open opportunities, about $845/mo estimated; 2 have no dollar estimate yet.']);
    expect(html).toContain('>$845/mo</p>');
    expect(text).not.toMatch(/\$0\/mo/);
    expect((await repository.getStats(orgId)).total_potential_savings).toBe(845);
  });
});
