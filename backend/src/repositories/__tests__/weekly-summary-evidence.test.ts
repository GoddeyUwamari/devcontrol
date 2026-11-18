/**
 * Weekly Summary reads for the executive brief (brief-build.md), against
 * mocked sources: the Cost Explorer trend (AWSCostService.fetchCostTrend),
 * the Cost Optimization page's hidden-findings read, the security sources and
 * the connection-checks row. The property under test is what each read
 * passes on -- the trend points' own report states and per-service amounts,
 * the page's still-detected numbers, the Security page's open count, the
 * last successful check -- and that a failure stays a failure, never 0.
 *
 * `now` is fixed at Monday 2026-09-28 09:00 UTC (the cron's slot), so the cost
 * window is 2026-09-21 .. 2026-09-27 and today is never counted.
 */
jest.mock('../../services/aws-cost.service', () => ({
  ...jest.requireActual('../../services/aws-cost.service'),
  __esModule: true,
  default: {
    fetchCostTrend: jest.fn(),
    getCostTrendFetchedAt: jest.fn(() => '2026-09-28T08:55:00.000Z'),
  },
}));

import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';
import awsCostService from '../../services/aws-cost.service';
import { WeeklySummaryRepository, weeklySummaryPeriod } from '../weekly-summary.repository';
import { CostRecommendationsRepository, type HiddenFinding } from '../cost-recommendations.repository';
import { AccountSecurityFindingsRepository } from '../account-security-findings.repository';
import { RiskTrackingService } from '../../services/risk-tracking.service';
import * as subscription from '../../middleware/subscription.middleware';

const fetchCostTrend = awsCostService.fetchCostTrend as jest.Mock;
const NOW = new Date('2026-09-28T09:00:00.000Z');
const ORG = '11111111-1111-4111-8111-111111111111';

const repository = new WeeklySummaryRepository({} as Pool);

beforeEach(() => {
  fetchCostTrend.mockReset();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('weeklySummaryPeriod', () => {
  it('uses the last 7 complete UTC days and excludes the current, still-billing day', () => {
    const p = weeklySummaryPeriod(NOW);
    expect(p.cost).toEqual({ start: '2026-09-21', endExclusive: '2026-09-28' });
    expect(p.previousCost).toEqual({ start: '2026-09-14', endExclusive: '2026-09-21' });
  });

  it('never produces a future date', () => {
    const p = weeklySummaryPeriod(new Date('2026-09-28T23:59:59.999Z'));
    expect(p.cost.endExclusive <= '2026-09-28').toBe(true);
  });
});

describe('WeeklySummaryRepository.getCostTrendSection', () => {
  const point = (date: string, total: number, extra: Record<string, unknown> = {}) =>
    ({ date, compute: total, storage: 0, database: 0, network: 0, other: 0, total, ...extra });

  it("passes each point's own reportState and per-service amounts on, unchanged and unclassified", async () => {
    fetchCostTrend.mockResolvedValue([
      point('2026-09-26', 5, { reportState: 'final', byService: [{ service: 'AmazonCloudWatch', amount: 5 }] }),
      point('2026-09-27', 1, { reportState: 'updating', byService: [{ service: 'AmazonCloudWatch', amount: 1 }] }),
      point('2026-09-28', 0, { reportState: 'not_reported', byService: [] }),
    ]);
    const s = await repository.getCostTrendSection(ORG);
    expect(fetchCostTrend).toHaveBeenCalledWith(ORG, '30d');
    expect(s.state).toBe('available');
    expect(s.asOf).toBe('2026-09-28T08:55:00.000Z');
    expect(s.data!.days).toEqual([
      { date: '2026-09-26', total: 5, reportState: 'final', byService: [{ service: 'AmazonCloudWatch', amount: 5 }] },
      { date: '2026-09-27', total: 1, reportState: 'updating', byService: [{ service: 'AmazonCloudWatch', amount: 1 }] },
      { date: '2026-09-28', total: 0, reportState: 'not_reported', byService: [] },
    ]);
  });

  it('a point with no state or no per-service data (an older cached shape) says so: null, never a guess', async () => {
    fetchCostTrend.mockResolvedValue([point('2026-09-27T00:00:00Z', 3)]);
    const s = await repository.getCostTrendSection(ORG);
    expect(s.data!.days).toEqual([{ date: '2026-09-27', total: 3, reportState: null, byService: null }]);
  });

  it('a Cost Explorer failure is an error section -- never $0', async () => {
    fetchCostTrend.mockRejectedValue(new Error('AccessDeniedException'));
    const s = await repository.getCostTrendSection(ORG);
    expect(s.state).toBe('error');
    expect(s.data).toBeNull();
  });

  it('no AWS connection is not_connected; an empty response is unavailable', async () => {
    fetchCostTrend.mockRejectedValue(new Error('AWS_NOT_CONNECTED: none'));
    expect((await repository.getCostTrendSection(ORG)).state).toBe('not_connected');
    fetchCostTrend.mockResolvedValue([]);
    expect((await repository.getCostTrendSection(ORG)).state).toBe('unavailable');
  });
});

describe('WeeklySummaryRepository.getStillDetectedSection', () => {
  const item = (over: Partial<HiddenFinding> & { state: 'still_detected' | 'not_confirmed'; savings: number | null }): HiddenFinding => ({
    id: 'x', decision: 'RESOLVED', decidedAt: '2026-09-20T00:00:00.000Z', decidedBy: null, decisionCount: 1,
    issue: 'Unattached EBS Volume', issueLabel: 'Unattached EBS volume', resourceId: 'vol-0abc', resourceName: null,
    resourceType: 'EBS', awsRegion: 'us-east-1',
    detection: { state: over.state, reason: null, lastDetectedAt: null, potentialSavings: over.savings, savingsBasis: null, priceSource: null, severity: null, description: null },
    ...over,
  });

  it("reads the Cost Optimization page's own getHiddenFindings() summary, and names the largest still-detected one", async () => {
    const spy = jest.spyOn(CostRecommendationsRepository.prototype, 'getHiddenFindings').mockResolvedValue({
      latestRun: null,
      summary: { resolved: 3, dismissed: 1, stillDetected: { count: 2, estimatedMonthlySavings: 7.5, ceilingMonthlySavings: 12, ceilingByResourceType: { S3: 12 } }, notConfirmed: 1 },
      items: [
        item({ id: 'a', state: 'still_detected', savings: 2.5, resourceName: 'small', decidedAt: '2026-09-25T00:00:00.000Z' }),
        item({ id: 'b', state: 'still_detected', savings: 5, resourceName: 'large', awsRegion: null }),
        item({ id: 'c', state: 'not_confirmed', savings: 100, resourceName: 'unconfirmed' }),
        item({ id: 'd', state: 'still_detected', savings: 900, resourceName: 'dismissed', decision: 'DISMISSED' }),
      ],
    });
    const s = await repository.getStillDetectedSection(ORG);
    expect(spy).toHaveBeenCalledWith(ORG);
    expect(s.data).toEqual({
      count: 2,
      estimatedMonthlySavings: 7.5,
      ceilingMonthlySavings: 12,
      example: { check: 'Unattached EBS volume', resource: 'large', region: null, resolvedAt: '2026-09-20T00:00:00.000Z' },
    });
  });

  it('a failed read is an error section, never 0 still detected', async () => {
    jest.spyOn(CostRecommendationsRepository.prototype, 'getHiddenFindings').mockRejectedValue(new Error('boom'));
    const s = await repository.getStillDetectedSection(ORG);
    expect(s.state).toBe('error');
    expect(s.data).toBeNull();
  });

  it('the email never re-implements "still detected": nothing in it imports the freshness rule', () => {
    const files = [
      path.join(__dirname, '../weekly-summary.repository.ts'),
      ...fs.readdirSync(path.join(__dirname, '../../services/weekly-brief')).filter(f => f.endsWith('.ts')).map(f => path.join(__dirname, '../../services/weekly-brief', f)),
    ];
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      expect(source).not.toMatch(/cost-finding-freshness|judgeFreshness/);
    }
  });
});

describe('security: open = the Security page definition (founder Q5)', () => {
  const finding = (derived: string) => ({ derived_status: derived } as never);

  it('account-level open = active or acknowledged; dismissed and accepted risk are not open; the resource count is unchanged', async () => {
    jest.spyOn(RiskTrackingService.prototype, 'getCurrentRiskScore').mockResolvedValue({
      score: 80, isPreliminary: false, complianceIssueCounts: { critical: 1, high: 3, medium: 4, low: 2 },
    } as never);
    jest.spyOn(AccountSecurityFindingsRepository.prototype, 'getActive').mockResolvedValue(
      [finding('active'), finding('acknowledged'), finding('dismissed'), finding('accepted_risk')]
    );
    jest.spyOn(subscription, 'organizationHasEntitlement').mockResolvedValue(true);
    jest.spyOn(repository, 'getAwsConnection').mockResolvedValue('connected');
    const client = { query: jest.fn(async () => ({ rows: [] })) } as never;
    const e = await repository.gatherWeeklyEvidence(ORG, NOW, client);
    // 10 combined = 4 status-active account rows + 6 resource issues.
    expect(e.security.data).toEqual({ score: 80, accountLevelFindings: 2, resourceComplianceIssues: 6 });
  });
});
