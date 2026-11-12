/**
 * gatherWeeklyEvidence() for the email's plan gate and connection state
 * (WE-1): the posture score only with PLAN_ENTITLEMENTS.riskScore (left out
 * below it and when the plan can't be read), and no security or savings read
 * at all when the organization has no AWS connection; and the organization
 * name lookup (null when unreadable). Every source is stubbed;
 * no database, no AWS. Synthetic ids only.
 */
jest.mock('../../middleware/subscription.middleware', () => ({
  organizationHasEntitlement: jest.fn(),
}));
jest.mock('../aws-accounts.repository', () => ({
  ...jest.requireActual('../aws-accounts.repository'),
  hasEligibleAwsAccount: jest.fn(),
}));
jest.mock('../../services/aws-cost.service', () => ({
  ...jest.requireActual('../../services/aws-cost.service'),
  __esModule: true,
  default: {
    fetchCostTrend: jest.fn(async () => []),
    getCostTrendFetchedAt: jest.fn(async () => null),
  },
}));

import { Pool } from 'pg';
import { organizationHasEntitlement } from '../../middleware/subscription.middleware';
import { hasEligibleAwsAccount } from '../aws-accounts.repository';
import { WeeklySummaryRepository } from '../weekly-summary.repository';

const ORG = '0f000000-0000-4000-8000-0000000000c2';
const NOW = new Date('2026-11-16T09:00:00.000Z');
const entitled = organizationHasEntitlement as jest.Mock;
const eligible = hasEligibleAwsAccount as jest.Mock;

function setup() {
  const client = { query: jest.fn(async () => ({ rows: [{ total_resources: '0', priced_resources: '0', total_cost: '0' }] })) } as any;
  const repository = new WeeklySummaryRepository({} as Pool);
  const risk = jest.spyOn((repository as any).riskTrackingService, 'getCurrentRiskScore').mockResolvedValue({
    isPreliminary: false, score: 72, complianceIssueCounts: { critical: 1, high: 2, medium: 3, low: 1 },
  });
  const findings = jest.spyOn((repository as any).accountFindingsRepository, 'getActive').mockResolvedValue([{}, {}]);
  const savings = jest.spyOn((repository as any).costRecommendationsRepository, 'getActiveSavingsBreakdown').mockResolvedValue({
    active: 3, estimatedMonthlySavings: 0, estimatedFindings: 0, ceilingByResourceType: { S3: 310 }, unestimatedFindings: 1,
  });
  jest.spyOn(repository, 'getWeeklyDeliveryOnPlan').mockResolvedValue({ deploymentCount: 0, successfulDeployments: 0, failedDeployments: 0 });
  return { repository, client, risk, findings, savings };
}

beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

beforeEach(() => {
  entitled.mockReset();
  eligible.mockReset().mockResolvedValue(true);
});

describe('weekly evidence: posture score plan gate', () => {
  it('on Optimization Engine (riskScore) the score is there', async () => {
    entitled.mockImplementation(async (_org: string, entitlement: string) => entitlement === 'riskScore');
    const { repository, client } = setup();
    const e = await repository.gatherWeeklyEvidence(ORG, NOW, client);
    expect(entitled).toHaveBeenCalledWith(ORG, 'riskScore', client);
    expect(e.security.data).toEqual({ score: 72, accountLevelFindings: 2, resourceComplianceIssues: 5 });
  });

  it('below it the score key is left out; the finding counts stay', async () => {
    entitled.mockResolvedValue(false);
    const { repository, client } = setup();
    const e = await repository.gatherWeeklyEvidence(ORG, NOW, client);
    expect(e.security.data).toEqual({ accountLevelFindings: 2, resourceComplianceIssues: 5 });
    expect(Object.keys(e.security.data!)).not.toContain('score');
  });

  it('when the plan cannot be read, the score is left out (never shown by default)', async () => {
    entitled.mockRejectedValue(new Error('synthetic plan lookup failure'));
    const { repository, client } = setup();
    const e = await repository.gatherWeeklyEvidence(ORG, NOW, client);
    expect(e.security.state).toBe('available');
    expect(Object.keys(e.security.data!)).not.toContain('score');
  });
});

describe('weekly evidence: AWS connection', () => {
  it('connected: savings come from the active-findings breakdown', async () => {
    entitled.mockResolvedValue(true);
    const { repository, client, savings } = setup();
    const e = await repository.gatherWeeklyEvidence(ORG, NOW, client);
    expect(e.awsConnection).toBe('connected');
    expect(savings).toHaveBeenCalledWith(ORG);
    expect(e.recommendations.data).toEqual({ active: 3, estimatedMonthlySavings: 0, estimatedFindings: 0, ceilingByResourceType: { S3: 310 }, unestimatedFindings: 1 });
  });

  it('not connected: security and savings are not_connected and never read', async () => {
    eligible.mockResolvedValue(false);
    const { repository, client, risk, findings, savings } = setup();
    const e = await repository.gatherWeeklyEvidence(ORG, NOW, client);
    expect(eligible).toHaveBeenCalledWith(client, ORG);
    expect(e.awsConnection).toBe('not_connected');
    expect(e.security.state).toBe('not_connected');
    expect(e.recommendations.state).toBe('not_connected');
    expect(risk).not.toHaveBeenCalled();
    expect(findings).not.toHaveBeenCalled();
    expect(savings).not.toHaveBeenCalled();
  });

  it('a failed connection read is "unknown" -- nothing is worded as not connected, sections are read', async () => {
    eligible.mockRejectedValue(new Error('synthetic read failure'));
    entitled.mockResolvedValue(true);
    const { repository, client, risk } = setup();
    const e = await repository.gatherWeeklyEvidence(ORG, NOW, client);
    expect(e.awsConnection).toBe('unknown');
    expect(e.security.state).toBe('available');
    expect(risk).toHaveBeenCalled();
  });
});

describe('getOrganizationName (WE-1 review L-4)', () => {
  const withQuery = (query: jest.Mock) => new WeeklySummaryRepository({ query } as unknown as Pool);

  it('the name when it can be read; null (no invented name) when there is no row, no name, or the read fails', async () => {
    expect(await withQuery(jest.fn(async () => ({ rows: [{ name: 'Example Org (synthetic)' }] }))).getOrganizationName(ORG)).toBe('Example Org (synthetic)');
    expect(await withQuery(jest.fn(async () => ({ rows: [] }))).getOrganizationName(ORG)).toBeNull();
    expect(await withQuery(jest.fn(async () => ({ rows: [{ name: '' }] }))).getOrganizationName(ORG)).toBeNull();
    expect(await withQuery(jest.fn(async () => { throw new Error('synthetic read failure'); })).getOrganizationName(ORG)).toBeNull();
  });
});
