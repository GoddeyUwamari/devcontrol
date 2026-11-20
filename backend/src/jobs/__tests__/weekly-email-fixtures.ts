/**
 * Synthetic weekly-summary fixtures for the executive brief (brief-build.md).
 * Every organization, person, figure and URL here is made up: example.test
 * domains, placeholder ids, no account ids, ARNs or External IDs.
 *
 * Generated on Monday 2026-11-16 09:00 UTC; the cost window is Nov 9-15.
 *
 *   A  attention: connection OK; 4 account + 10 resource findings open;
 *      1 resolved finding detected again + 3 open opportunities; 5 finished
 *      days (Nov 9-13) $2.31 vs $3.12 the same days last week (down 26%),
 *      Nov 14 updating, Nov 15 not reported; 21 deployments, none failed;
 *      Optimization Engine (posture score and change failure rate on plan)
 *   B  clean: as A's connection, spend and delivery, nothing open anywhere,
 *      the latest analysis ran all 7 checks
 *   C  connection broken: failing since Nov 15 06:30, last OK Nov 15 06:00;
 *      this week's scan and analysis didn't finish, the last completed ones
 *      are from Nov 15; Cost Explorer refused; 4 deployments, 1 failed;
 *      Visibility (no score, no rate)
 *   D  no comparison: 3 finished days (Nov 9-11), Nov 12 updating ($0.06 so
 *      far), Nov 13-15 not reported; Cost Explorer returned no points for
 *      Nov 2 and Nov 3, so only 1 of the 3 earlier days is finished; 2 open
 *      findings with no estimate (S3 ceiling $18); no deployment ever
 *   E  no AWS account connected (the separate short layout, founder Q3)
 *   F  as B (clean), but this week's 3 deployments are all 'deploying': none
 *      finished, so never "none failed" and no rate; the clean state holds
 *      (D3-D1); Visibility
 *   G  as A, with 6 deployments: 3 success, 1 failed, 1 'deploying' and 1
 *      with a legacy status ('running'): 4 finished, 2 without a result
 *      (D3-D2); Optimization Engine (rate over the 4 finished)
 *
 * All evidence objects are built here directly (no database, no AWS), so the
 * facts, rules, snapshots and the preview script share them.
 */
import type { ContextSection } from '../../services/ai-context-contract';
import {
  weeklySummaryPeriod,
  type WeeklyAnalysisEvidence,
  type WeeklyConnectionHealth,
  type WeeklyDORAMetrics,
  type WeeklyEvidence,
  type WeeklyRecommendationEvidence,
  type WeeklyRunEvidence,
  type WeeklySecurityEvidence,
  type WeeklyStillDetectedEvidence,
  type WeeklyTrendDay,
} from '../../repositories/weekly-summary.repository';
import { weeklyFacts, type WeeklyFacts } from '../../services/weekly-brief/facts';

export const FIXTURE_NOW = new Date('2026-11-16T09:00:00.000Z');
export const FIXTURE_IDS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const;
export type FixtureId = (typeof FIXTURE_IDS)[number];

export const FIXTURE_ORG_NAME = 'Example Org (synthetic)';
export const FIXTURE_URLS = {
  frontendUrl: 'https://app.example.test',
  unsubscribeUrl: 'https://api.example.test/api/user/preferences/unsubscribe?token=v1.SYNTHETIC-USER.0000000000.SYNTHETIC-MAC',
};

// ── Section builders ─────────────────────────────────────────────────────────

const meta = { provenance: null, asOf: null, scope: null, period: null, completeness: null, coverage: null, derivedFrom: null } as const;

export function available<T>(source: string, data: T, asOf: string | null = null): ContextSection<T> {
  return { ...meta, state: 'available', source, provenance: 'derived', asOf, reason: null, data } as unknown as ContextSection<T>;
}

export function noData<T>(source: string, state: 'error' | 'unavailable' | 'not_connected', reason: string): ContextSection<T> {
  return { ...meta, state, source, reason, data: null } as unknown as ContextSection<T>;
}

// ── Cost Explorer days ───────────────────────────────────────────────────────

type DaySpec = { state: WeeklyTrendDay['reportState']; services: { [service: string]: number | undefined } } | 'missing';

/** The 30-day trend ending today; each day's total = its services (no credits in these fixtures). */
export function trend(spec: (day: string) => DaySpec): WeeklyTrendDay[] {
  const days: WeeklyTrendDay[] = [];
  const end = Date.parse('2026-11-16T00:00:00Z');
  for (let t = end - 30 * 86_400_000; t <= end; t += 86_400_000) {
    const date = new Date(t).toISOString().slice(0, 10);
    const s = spec(date);
    if (s === 'missing') continue;
    const byService = Object.entries(s.services).flatMap(([service, amount]) => (amount === undefined ? [] : [{ service, amount }]));
    days.push({ date, total: Math.round(byService.reduce((sum, x) => sum + x.amount, 0) * 100) / 100, reportState: s.state, byService });
  }
  return days;
}

const EC2 = 'Amazon Elastic Compute Cloud - Compute';
const S3 = 'Amazon Simple Storage Service';
const CW = 'AmazonCloudWatch';
const RDS = 'Amazon Relational Database Service';

/** A's week: Nov 9-13 final $2.31; Nov 14 updating; Nov 15 not reported; Nov 2-6 final $3.12. */
const A_DAYS: Record<string, Record<string, number>> = {
  '2026-11-09': { [EC2]: 0.25, [S3]: 0.1, [CW]: 0.05 },
  '2026-11-10': { [EC2]: 0.3, [S3]: 0.1, [CW]: 0.05 },
  '2026-11-11': { [EC2]: 0.35, [S3]: 0.1, [CW]: 0.05 },
  '2026-11-12': { [EC2]: 0.31, [S3]: 0.1, [CW]: 0.05 },
  '2026-11-13': { [EC2]: 0.35, [S3]: 0.1, [CW]: 0.05 },
  '2026-11-14': { [EC2]: 0.21, [S3]: 0.05 },
  '2026-11-02': { [EC2]: 0.4, [S3]: 0.1, [RDS]: 0.12 },
  '2026-11-03': { [EC2]: 0.4, [S3]: 0.1, [RDS]: 0.12 },
  '2026-11-04': { [EC2]: 0.41, [S3]: 0.1, [RDS]: 0.12 },
  '2026-11-05': { [EC2]: 0.4, [S3]: 0.1, [RDS]: 0.12 },
  '2026-11-06': { [EC2]: 0.41, [S3]: 0.1, [RDS]: 0.12 },
};
const A_TREND = trend(day => {
  if (day === '2026-11-16' || day === '2026-11-15') return { state: 'not_reported', services: {} };
  if (day === '2026-11-14') return { state: 'updating', services: A_DAYS[day] };
  return { state: 'final', services: A_DAYS[day] ?? { [EC2]: 0.5, [S3]: 0.1 } };
});

/** D's week: Nov 9-11 final; Nov 12 updating $0.06; Nov 13-16 not reported; no points for Nov 2-3. */
const D_TREND = trend(day => {
  if (day === '2026-11-02' || day === '2026-11-03') return 'missing';
  if (day >= '2026-11-13') return { state: 'not_reported', services: {} };
  if (day === '2026-11-12') return { state: 'updating', services: { [EC2]: 0.06 } };
  if (day >= '2026-11-09') return { state: 'final', services: { [EC2]: 0.6, [S3]: 0.12, [CW]: 0.03 } };
  return { state: 'final', services: { [EC2]: 0.55, [S3]: 0.12 } };
});

// ── Other sources ────────────────────────────────────────────────────────────

export const HEALTH_OK: WeeklyConnectionHealth = {
  state: 'ok', lastResult: 'ok', checkedAt: '2026-11-16T06:02:00.000Z', failingSince: null, lostAt: null, lastOkAt: '2026-11-16T06:02:00.000Z',
};
export const HEALTH_FAILING: WeeklyConnectionHealth = {
  state: 'failing', lastResult: 'failing', checkedAt: '2026-11-16T06:01:00.000Z', failingSince: '2026-11-15T06:30:00.000Z', lostAt: null, lastOkAt: '2026-11-15T06:00:00.000Z',
};
export const SCAN_COMPLETED: WeeklyRunEvidence = {
  latest: { state: 'completed', at: '2026-11-16T06:14:00.000Z', startedAt: '2026-11-16T06:00:00.000Z' },
  lastCompleted: { at: '2026-11-16T06:14:00.000Z' },
};
export const SCAN_DID_NOT_FINISH: WeeklyRunEvidence = {
  latest: { state: 'did_not_finish', at: '2026-11-16T06:14:00.000Z', startedAt: '2026-11-16T06:00:00.000Z' },
  lastCompleted: { at: '2026-11-15T06:10:00.000Z' },
};
export const ANALYSIS_COMPLETED: WeeklyAnalysisEvidence = {
  latest: { state: 'completed', at: '2026-11-16T06:20:00.000Z', startedAt: '2026-11-16T06:14:00.000Z' },
  lastCompleted: { at: '2026-11-16T06:20:00.000Z' },
  latestChecks: { total: 7, complete: 7 },
};
export const ANALYSIS_DID_NOT_FINISH: WeeklyAnalysisEvidence = {
  latest: { state: 'did_not_finish', at: '2026-11-16T06:15:00.000Z', startedAt: '2026-11-16T06:14:00.000Z' },
  lastCompleted: { at: '2026-11-15T06:20:00.000Z' },
  latestChecks: null,
};

export const NONE_OPEN: WeeklyRecommendationEvidence = {
  active: 0, estimatedMonthlySavings: 0, estimatedFindings: 0, ceilingByResourceType: {}, unestimatedFindings: 0,
};
export const NONE_STILL_DETECTED: WeeklyStillDetectedEvidence = { count: 0, estimatedMonthlySavings: 0, ceilingMonthlySavings: 0, example: null };
const ONE_STILL_DETECTED: WeeklyStillDetectedEvidence = {
  count: 1,
  estimatedMonthlySavings: 3.6,
  ceilingMonthlySavings: 0,
  example: { check: 'Unattached EBS volume', resource: 'build-cache-volume', region: 'us-east-1', resolvedAt: '2026-11-12T15:04:00.000Z' },
};

const PRO_21: WeeklyDORAMetrics = { deploymentCount: 21, successfulDeployments: 21, failedDeployments: 0, deploymentFrequency: '3 per day', changeFailureRate: 0 };

interface FixtureSpec {
  plan: string;
  evidence: () => WeeklyEvidence;
}

const PERIOD = weeklySummaryPeriod(FIXTURE_NOW);
const TREND_ASOF = '2026-11-16T08:40:00.000Z';
const src = {
  health: 'DevControl AWS connection health',
  scan: 'DevControl discovery scans',
  analysis: 'DevControl cost analysis runs',
  history: 'DevControl deployment records (all time)',
  trend: 'AWS Cost Explorer daily trend',
  delivery: 'DevControl deployment records',
  security: 'DevControl security posture score and configuration checks',
  recommendations: 'DevControl cost recommendations',
  still: 'DevControl resolved cost findings still detected',
};

/** A connected organization's evidence, every source available unless overridden. */
export function connectedEvidence(over: Partial<WeeklyEvidence> = {}): WeeklyEvidence {
  return {
    period: PERIOD,
    awsConnection: 'connected',
    connectionHealth: available(src.health, HEALTH_OK),
    scan: available(src.scan, SCAN_COMPLETED),
    costAnalysis: available(src.analysis, ANALYSIS_COMPLETED),
    deploymentHistory: available(src.history, { anyRecorded: true }),
    costTrend: available(src.trend, { days: A_TREND }, TREND_ASOF),
    delivery: available(src.delivery, PRO_21),
    security: available<WeeklySecurityEvidence>(src.security, { score: 92, accountLevelFindings: 0, resourceComplianceIssues: 0 }),
    recommendations: available(src.recommendations, NONE_OPEN),
    stillDetected: available(src.still, NONE_STILL_DETECTED),
    ...over,
  };
}

export const SOURCES = src;

export const FIXTURES: Record<FixtureId, FixtureSpec> = {
  A: {
    plan: 'Optimization Engine',
    evidence: () => connectedEvidence({
      security: available<WeeklySecurityEvidence>(src.security, { score: 72, accountLevelFindings: 4, resourceComplianceIssues: 10 }),
      recommendations: available(src.recommendations, { active: 3, estimatedMonthlySavings: 42, estimatedFindings: 2, ceilingByResourceType: { S3: 18 }, unestimatedFindings: 1 }),
      stillDetected: available(src.still, ONE_STILL_DETECTED),
    }),
  },
  B: {
    plan: 'Optimization Engine',
    evidence: () => connectedEvidence(),
  },
  C: {
    plan: 'Visibility',
    evidence: () => connectedEvidence({
      connectionHealth: available(src.health, HEALTH_FAILING),
      scan: available(src.scan, SCAN_DID_NOT_FINISH),
      costAnalysis: available(src.analysis, ANALYSIS_DID_NOT_FINISH),
      costTrend: noData(src.trend, 'error', 'AccessDenied'),
      security: available<WeeklySecurityEvidence>(src.security, { accountLevelFindings: 2, resourceComplianceIssues: 3 }),
      recommendations: available(src.recommendations, { active: 2, estimatedMonthlySavings: 120, estimatedFindings: 2, ceilingByResourceType: {}, unestimatedFindings: 0 }),
      delivery: available<WeeklyDORAMetrics>(src.delivery, { deploymentCount: 4, successfulDeployments: 3, failedDeployments: 1 }),
    }),
  },
  D: {
    plan: 'Visibility',
    evidence: () => connectedEvidence({
      costTrend: available(src.trend, { days: D_TREND }, TREND_ASOF),
      security: available<WeeklySecurityEvidence>(src.security, { accountLevelFindings: 1, resourceComplianceIssues: 0 }),
      recommendations: available(src.recommendations, { active: 2, estimatedMonthlySavings: 0, estimatedFindings: 0, ceilingByResourceType: { S3: 18 }, unestimatedFindings: 1 }),
      delivery: available<WeeklyDORAMetrics>(src.delivery, { deploymentCount: 0, successfulDeployments: 0, failedDeployments: 0 }),
      deploymentHistory: available(src.history, { anyRecorded: false }),
    }),
  },
  E: {
    plan: 'Visibility',
    evidence: () => ({
      period: PERIOD,
      awsConnection: 'not_connected',
      connectionHealth: null,
      scan: null,
      costAnalysis: null,
      deploymentHistory: available(src.history, { anyRecorded: false }),
      costTrend: noData(src.trend, 'not_connected', 'no AWS account is connected'),
      delivery: available<WeeklyDORAMetrics>(src.delivery, { deploymentCount: 0, successfulDeployments: 0, failedDeployments: 0 }),
      security: noData(src.security, 'not_connected', 'no AWS account is connected'),
      recommendations: noData(src.recommendations, 'not_connected', 'no AWS account is connected'),
      stillDetected: noData(src.still, 'not_connected', 'no AWS account is connected'),
    }),
  },
  F: {
    plan: 'Visibility',
    evidence: () => connectedEvidence({
      // Below the plan: no posture score (as C).
      security: available<WeeklySecurityEvidence>(src.security, { accountLevelFindings: 0, resourceComplianceIssues: 0 }),
      // 3 rows recorded, all 'deploying': the repository counts them in the total only.
      delivery: available<WeeklyDORAMetrics>(src.delivery, { deploymentCount: 3, successfulDeployments: 0, failedDeployments: 0 }),
    }),
  },
  G: {
    plan: 'Optimization Engine',
    evidence: () => connectedEvidence({
      security: available<WeeklySecurityEvidence>(src.security, { score: 72, accountLevelFindings: 4, resourceComplianceIssues: 10 }),
      recommendations: available(src.recommendations, { active: 3, estimatedMonthlySavings: 42, estimatedFindings: 2, ceilingByResourceType: { S3: 18 }, unestimatedFindings: 1 }),
      stillDetected: available(src.still, ONE_STILL_DETECTED),
      // 3 success + 1 failed + 1 'deploying' + 1 'running' (legacy): rate over the 4 finished.
      delivery: available<WeeklyDORAMetrics>(src.delivery, { deploymentCount: 6, successfulDeployments: 3, failedDeployments: 1, deploymentFrequency: '0.43 per day', changeFailureRate: 25 }),
    }),
  },
};

export function fixtureEvidence(id: FixtureId): WeeklyEvidence {
  return FIXTURES[id].evidence();
}

export function fixtureFacts(id: FixtureId): WeeklyFacts {
  return weeklyFacts(fixtureEvidence(id));
}
