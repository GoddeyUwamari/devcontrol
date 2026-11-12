/**
 * WE-1 review H-1, end to end on the database: open cost_recommendations rows
 * go through the REAL CostRecommendationsRepository.getActiveSavingsBreakdown(),
 * the real composeWeeklySummary() and the real HTML template and text part.
 * A gate-blocked DynamoDB capacity-mode comparison is stored at $0 with a
 * "comparison:" (estimate-class) basis; it is a finding with no dollar
 * estimate, never "$0/month", and the email matches what the dashboard's
 * savings card shows for the same rows (getStats: no total above $0, so
 * "N finding(s) found; none has a dollar estimate yet.").
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
import { collectSection } from '../../services/ai-context-contract';
import { composeWeeklySummary, WEEKLY_SECTION_TITLES } from '../../services/weekly-summary-content';
import { WeeklyAISummaryJob } from '../../jobs/weekly-ai-summary.job';
import { FIXTURE_ORG_NAME, FIXTURE_URLS, fixtureEvidence } from '../../jobs/__tests__/weekly-email-fixtures';
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

/** The org's rows through the real breakdown, composer and renderer; the rest of the email is fixture C2. */
async function renderFromDatabase(orgId: string) {
  const breakdown = await repository.getActiveSavingsBreakdown(orgId);
  const evidence = {
    ...(await fixtureEvidence('C2')),
    recommendations: await collectSection<WeeklyRecommendationEvidence>(
      { source: 'DevControl cost recommendations' },
      async () => ({ state: 'available', data: breakdown })
    ),
  };
  const data = job.buildTemplateData({
    userName: 'Alex',
    content: composeWeeklySummary(evidence, { organizationName: FIXTURE_ORG_NAME }),
    ...FIXTURE_URLS,
  });
  data.year = 2026;
  const { html, text } = job.renderEmail(data);
  const lines = text.split('\n');
  const titles = Object.values(WEEKLY_SECTION_TITLES);
  const savings: string[] = [];
  for (let i = lines.indexOf(WEEKLY_SECTION_TITLES.savings) + 1; i < lines.length && lines[i] !== '' && !titles.includes(lines[i]); i++) {
    savings.push(lines[i]);
  }
  return { html, text, savings };
}

it('the blocked-row basis copied here is the one the detector writes', () => {
  const service = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'cost-optimization.service.ts'), 'utf8');
  expect(service).toContain("'comparison:on_demand_vs_provisioned_observed_workload — modeled cost difference only; does not meet '");
  expect(service).toContain("'DevControl\\'s confidence policy for a recommendation this cycle (see metadata.recommendation.blocked_reasons)'");
  expect(service).toMatch(/const potentialSavings = recommendationGate\.recommend \? Math\.max\(0, modeledCostDifference\) : 0;/);
});

describe('weekly email savings from database rows (WE-1 review H-1)', () => {
  it('one gate-blocked DynamoDB comparison: no "$0/month"; the dashboard\'s "none has a dollar estimate yet" state', async () => {
    const orgId = await insertOrg();
    await repository.createBulk([blockedComparison('table-a')], orgId);

    const { html, text, savings } = await renderFromDatabase(orgId);
    expect(savings).toEqual([
      '1 open finding; none has a dollar estimate yet.',
      'See Cost Optimization: https://app.example.test/cost-optimization',
    ]);
    for (const out of [html, text]) {
      expect(out).not.toMatch(/\$0\/month/);
      expect(out).not.toMatch(/Estimated savings:/);
    }

    // The dashboard card reads getStats for the same rows: a figure only when the total is above $0,
    // otherwise "1 finding found; none has a dollar estimate yet." (executive-roi-card.tsx).
    const stats = await repository.getStats(orgId);
    expect(stats.total_potential_savings).toBe(0);
    expect(stats.potential_savings_ceiling).toBe(0);
    expect(stats.active_recommendations).toBe(1);
  });

  it('a $845 estimate plus two blocked comparisons: "across 1 open finding", the other two have no estimate', async () => {
    const orgId = await insertOrg();
    await repository.createBulk([
      rec({ potential_savings: 845, metadata: { savings_basis: 'estimated: list price' } }),
      blockedComparison('table-b'),
      blockedComparison('table-c'),
    ], orgId);

    const { html, text, savings } = await renderFromDatabase(orgId);
    expect(savings).toEqual([
      'Estimated savings: $845/month across 1 open finding. This is a DevControl estimate, not realized savings.',
      '2 more open findings have no dollar estimate yet.',
      'See Cost Optimization: https://app.example.test/cost-optimization',
    ]);
    expect(html).toContain('Estimated savings: <strong>$845/month</strong> across 1 open finding.');
    expect(text).not.toMatch(/\$0\/month/);
    expect((await repository.getStats(orgId)).total_potential_savings).toBe(845);
  });
});
