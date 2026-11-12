/**
 * Synthetic weekly-summary fixtures C1-C5 (weekly-email audit, current-email.html).
 * Every organization, person, figure and URL here is made up: example.test
 * domains, placeholder ids, no account ids, ARNs or External IDs.
 *
 *   C1  connected, normal week, Visibility plan; the 3 open recommendations
 *       have no supported dollar estimate (2 S3 upper bounds totalling $310
 *       + an EC2 Reserved Instance finding with no figure)
 *   C2  connected, normal week, Optimization Engine plan; 3 estimated findings
 *   C3  no AWS account connected, never scanned, no deployments
 *   C4  connected, but Cost Explorer is refused and the latest scan failed;
 *       an older scan completed (24 resources, 18 priced)
 *   C5  connected, AWS credits cover usage: every Cost Explorer day nets to $0
 *
 * C1, C4 and C5 are on Visibility, so the posture score and the DORA
 * figures are left out, as the repository does below Optimization Engine.
 */
import { Pool } from 'pg';
import awsCostService from '../../services/aws-cost.service';
import { collectSection, notConnected } from '../../services/ai-context-contract';
import {
  WeeklySummaryRepository,
  weeklySummaryPeriod,
  type WeeklyAwsConnection,
  type WeeklyDORAMetrics,
  type WeeklyEvidence,
  type WeeklyRecommendationEvidence,
  type WeeklySecurityEvidence,
} from '../../repositories/weekly-summary.repository';

export const FIXTURE_NOW = new Date('2026-11-16T09:00:00.000Z');
export const FIXTURE_ORG = '0f000000-0000-4000-8000-0000000000c1';
export const FIXTURE_IDS = ['C1', 'C2', 'C3', 'C4', 'C5'] as const;
export type FixtureId = (typeof FIXTURE_IDS)[number];

export const FIXTURE_ORG_NAME = 'Example Org (synthetic)';
export const FIXTURE_URLS = {
  frontendUrl: 'https://app.example.test',
  unsubscribeUrl: 'https://api.example.test/api/user/preferences/unsubscribe?token=v1.SYNTHETIC-USER.0000000000.SYNTHETIC-MAC',
};

type Trend = () => Promise<unknown>;

/** Daily trend points over the 30d range ending today; `amountFor` undefined = day not returned. */
function trendDays(amountFor: (day: string) => number | undefined) {
  const points = [];
  const end = Date.parse('2026-11-16T00:00:00Z');
  for (let t = end - 30 * 86_400_000; t <= end; t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    const total = amountFor(day);
    if (total !== undefined) points.push({ date: day, compute: total, storage: 0, database: 0, network: 0, other: 0, total });
  }
  return points;
}

/** $1,234.56 for Nov 9-15 and $1,184.80 for Nov 2-8. */
const NORMAL_WEEK: Trend = async () => trendDays(day => {
  if (day >= '2026-11-09' && day <= '2026-11-15') return day === '2026-11-15' ? 178.56 : 176;
  if (day >= '2026-11-02' && day <= '2026-11-08') return day === '2026-11-08' ? 170.8 : 169;
  return 150;
});
const CREDITS_COVER_USAGE: Trend = async () => trendDays(() => 0);
const NOT_CONNECTED: Trend = async () => { throw new Error('AWS_NOT_CONNECTED: synthetic org has no eligible AWS account'); };
const REFUSED: Trend = async () => { throw new Error('AccessDenied: synthetic refusal'); };

interface FixtureSpec {
  awsConnection: WeeklyAwsConnection;
  trend: Trend;
  inventory: { total_resources: string; priced_resources: string; total_cost: string };
  security: { state: 'available'; data: WeeklySecurityEvidence } | { state: 'unavailable'; reason: string };
  delivery: WeeklyDORAMetrics;
  recommendations: WeeklyRecommendationEvidence;
}

const NONE_OPEN: WeeklyRecommendationEvidence = {
  active: 0, estimatedMonthlySavings: 0, estimatedFindings: 0, ceilingByResourceType: {}, unestimatedFindings: 0,
};
const NO_INVENTORY = { total_resources: '0', priced_resources: '0', total_cost: '0' };
const NO_DEPLOYMENTS: WeeklyDORAMetrics = { deploymentCount: 0, successfulDeployments: 0, failedDeployments: 0 };
const SIX_DEPLOYMENTS: WeeklyDORAMetrics = { deploymentCount: 6, successfulDeployments: 4, failedDeployments: 2 };

export const FIXTURES: Record<FixtureId, FixtureSpec> = {
  C1: {
    awsConnection: 'connected',
    trend: NORMAL_WEEK,
    inventory: NO_INVENTORY,
    security: { state: 'available', data: { accountLevelFindings: 2, resourceComplianceIssues: 5 } },
    delivery: SIX_DEPLOYMENTS,
    recommendations: { active: 3, estimatedMonthlySavings: 0, estimatedFindings: 0, ceilingByResourceType: { S3: 310 }, unestimatedFindings: 1 },
  },
  C2: {
    awsConnection: 'connected',
    trend: NORMAL_WEEK,
    inventory: NO_INVENTORY,
    security: { state: 'available', data: { score: 72, accountLevelFindings: 2, resourceComplianceIssues: 5 } },
    delivery: { ...SIX_DEPLOYMENTS, deploymentFrequency: '0.57 per day', changeFailureRate: 33.3 },
    recommendations: { active: 3, estimatedMonthlySavings: 845, estimatedFindings: 3, ceilingByResourceType: {}, unestimatedFindings: 0 },
  },
  C3: {
    awsConnection: 'not_connected',
    trend: NOT_CONNECTED,
    inventory: NO_INVENTORY,
    security: { state: 'unavailable', reason: 'the security posture score is still preliminary' },
    delivery: NO_DEPLOYMENTS,
    recommendations: NONE_OPEN,
  },
  C4: {
    awsConnection: 'connected',
    trend: REFUSED,
    inventory: { total_resources: '24', priced_resources: '18', total_cost: '412.5' },
    security: { state: 'available', data: { accountLevelFindings: 1, resourceComplianceIssues: 4 } },
    delivery: NO_DEPLOYMENTS,
    recommendations: { active: 2, estimatedMonthlySavings: 120, estimatedFindings: 2, ceilingByResourceType: {}, unestimatedFindings: 0 },
  },
  C5: {
    awsConnection: 'connected',
    trend: CREDITS_COVER_USAGE,
    inventory: NO_INVENTORY,
    security: { state: 'available', data: { accountLevelFindings: 0, resourceComplianceIssues: 0 } },
    delivery: NO_DEPLOYMENTS,
    recommendations: NONE_OPEN,
  },
};

/**
 * The fixture's evidence, through the real getWeeklySpendSections() and
 * getWeeklyAlerts(); awsCostService must be jest-mocked by the caller. A
 * not-connected fixture gets the not_connected security and savings sections
 * gatherWeeklyEvidence() builds.
 */
export async function fixtureEvidence(id: FixtureId): Promise<WeeklyEvidence> {
  const spec = FIXTURES[id];
  const repository = new WeeklySummaryRepository({} as Pool);
  const period = weeklySummaryPeriod(FIXTURE_NOW);
  const fetchCostTrend = awsCostService.fetchCostTrend as jest.Mock;
  fetchCostTrend.mockReset();
  fetchCostTrend.mockImplementation(spec.trend);
  const inventoryClient = { query: jest.fn(async () => ({ rows: [spec.inventory] })) } as any;
  const spend = await repository.getWeeklySpendSections(FIXTURE_ORG, period, inventoryClient);
  const off = spec.awsConnection === 'not_connected';
  const SECURITY = 'DevControl security posture score and configuration checks';
  const RECOMMENDATIONS = 'DevControl cost recommendations';
  return {
    period,
    awsConnection: spec.awsConnection,
    ...spend,
    alerts: await repository.getWeeklyAlerts(FIXTURE_ORG, period),
    delivery: await collectSection<WeeklyDORAMetrics>({ source: 'DevControl deployment records' }, async () => ({ state: 'available', data: spec.delivery })),
    security: off
      ? notConnected<WeeklySecurityEvidence>({ source: SECURITY }, 'no AWS account is connected')
      : await collectSection<WeeklySecurityEvidence>({ source: SECURITY }, async () => spec.security),
    recommendations: off
      ? notConnected<WeeklyRecommendationEvidence>({ source: RECOMMENDATIONS }, 'no AWS account is connected')
      : await collectSection<WeeklyRecommendationEvidence>({ source: RECOMMENDATIONS }, async () => ({ state: 'available', data: spec.recommendations })),
  };
}
