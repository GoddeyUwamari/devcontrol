/**
 * Tier 0 shared source-of-truth: coverage for AISummaryService's spend fact
 * line, which previously stated "Current monthly cloud spend is $X." with no
 * indication of whether X came from live Cost Explorer or the DB estimate
 * fallback. ComponentScore.cost now carries costSource ('actual'|'estimated'
 * -- see system-intelligence.service.ts / AWSCostService.
 * getMonthlySpendWithFallback), and buildSummary() must branch on it so an
 * estimated figure is never narrated as if it were an observed fact.
 *
 * Every AISummaryService dependency is mocked at the prototype level (same
 * convention as cloudwatch.service.cache.test.ts / system-intelligence.
 * service.cost-score.test.ts) so this proves only buildSummary()'s own fact-
 * line/prompt generation, not the full DB/AWS chain each dependency itself
 * pulls from. The assertion is on the actual prompt text handed to
 * AIInsightsService.generateStructuredDashboardSummary() -- the real
 * truthfulness surface -- not on the mocked LLM response.
 */
import { AISummaryService } from '../ai-summary.service';
import { SystemIntelligenceService, SystemIntelligenceResult } from '../system-intelligence.service';
import { RiskTrackingService } from '../risk-tracking.service';
import { AccountSecurityFindingsRepository } from '../../repositories/account-security-findings.repository';
import { CostRecommendationsRepository } from '../../repositories/cost-recommendations.repository';
import { AIInsightsService } from '../ai-insights.service';

function intelligenceFixture(monthlySpend: number, costSource: 'actual' | 'estimated'): SystemIntelligenceResult {
  const componentBase = { label: '', detail: '', severity: 'healthy' as const, delta: null, status: 'good' as const, ready: true };
  return {
    system_score: 80,
    status: 'Healthy',
    components: {
      cost: { ...componentBase, score: 80, label: 'Cost Efficiency', monthlySpend, costSource },
      security: { ...componentBase, score: 80, label: 'Security Posture' },
      observability: { ...componentBase, score: 80, label: 'Observability' },
    },
    top_action: null,
    top_drivers: [],
    computed_at: new Date().toISOString(),
  };
}

function mockCommonDependencies() {
  jest.spyOn(RiskTrackingService.prototype, 'getCurrentRiskScore').mockResolvedValue({
    score: 0,
    isPreliminary: true, // skips the compliance-issue-counts fact line entirely -- not under test here
    complianceIssueCounts: { critical: 0, high: 0, medium: 0, low: 0 },
  } as any);
  jest.spyOn(AccountSecurityFindingsRepository.prototype, 'getActive').mockResolvedValue([]);
  jest.spyOn(CostRecommendationsRepository.prototype, 'getStats').mockResolvedValue({
    total_recommendations: 0,
    active_recommendations: 0,
    total_potential_savings: 0,
    by_severity: { high: 0, medium: 0, low: 0 },
  });
  jest.spyOn(AISummaryService.prototype as any, 'getLatestScanCompletedAt').mockResolvedValue(null);
  jest.spyOn(AISummaryService.prototype as any, 'getCriticalAnomalyCount').mockResolvedValue(0);
}

describe('AISummaryService spend fact line -- actual vs estimated provenance', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('actual (live Cost Explorer) spend keeps the existing unqualified wording', async () => {
    mockCommonDependencies();
    jest.spyOn(SystemIntelligenceService.prototype, 'getSystemIntelligence')
      .mockResolvedValue(intelligenceFixture(5000, 'actual'));
    const generateSpy = jest.spyOn(AIInsightsService.prototype, 'generateStructuredDashboardSummary')
      .mockResolvedValue({ overallHealth: { score: null, context: null }, topRisk: null, cloudSpend: null, systemStatus: null });

    const service = new AISummaryService();
    await service.getSummary('org-1', null);

    expect(generateSpy).toHaveBeenCalledTimes(1);
    const prompt = generateSpy.mock.calls[0][0];
    expect(prompt).toMatch(/Current monthly cloud spend is \$5,000\./);
    // Scoped to the fact line itself, not the whole prompt -- the shared
    // instruction preamble legitimately mentions "estimated" as a general
    // concept (see the clarifying-qualifier instruction), independent of
    // this fact's own costSource.
    expect(prompt).not.toMatch(/Estimated current monthly cloud spend/);
    expect(prompt).not.toMatch(/approximately \$5,000/);
  });

  it('estimated (DB fallback) spend explicitly says so, and never uses the unqualified "actual" wording', async () => {
    mockCommonDependencies();
    jest.spyOn(SystemIntelligenceService.prototype, 'getSystemIntelligence')
      .mockResolvedValue(intelligenceFixture(3200, 'estimated'));
    const generateSpy = jest.spyOn(AIInsightsService.prototype, 'generateStructuredDashboardSummary')
      .mockResolvedValue({ overallHealth: { score: null, context: null }, topRisk: null, cloudSpend: null, systemStatus: null });

    const service = new AISummaryService();
    await service.getSummary('org-1', null);

    expect(generateSpy).toHaveBeenCalledTimes(1);
    const prompt = generateSpy.mock.calls[0][0];
    expect(prompt).toMatch(/Estimated current monthly cloud spend is approximately \$3,200/);
    expect(prompt).toMatch(/not live billing data/);
    expect(prompt).not.toMatch(/Current monthly cloud spend is \$3,200\./);
  });

  it('the prompt instructs the model to preserve an "estimated"/"approximately" qualifier rather than drop it', async () => {
    mockCommonDependencies();
    jest.spyOn(SystemIntelligenceService.prototype, 'getSystemIntelligence')
      .mockResolvedValue(intelligenceFixture(3200, 'estimated'));
    const generateSpy = jest.spyOn(AIInsightsService.prototype, 'generateStructuredDashboardSummary')
      .mockResolvedValue({ overallHealth: { score: null, context: null }, topRisk: null, cloudSpend: null, systemStatus: null });

    const service = new AISummaryService();
    await service.getSummary('org-1', null);

    const prompt = generateSpy.mock.calls[0][0];
    expect(prompt).toMatch(/never drop it or state an\s+estimated figure as if it were confirmed/);
  });

  it('unrelated fact lines (critical outage status) are unchanged by the provenance branch', async () => {
    mockCommonDependencies();
    jest.spyOn(SystemIntelligenceService.prototype, 'getSystemIntelligence')
      .mockResolvedValue(intelligenceFixture(1000, 'actual'));
    const generateSpy = jest.spyOn(AIInsightsService.prototype, 'generateStructuredDashboardSummary')
      .mockResolvedValue({ overallHealth: { score: null, context: null }, topRisk: null, cloudSpend: null, systemStatus: null });

    const service = new AISummaryService();
    await service.getSummary('org-1', null);

    const prompt = generateSpy.mock.calls[0][0];
    expect(prompt).toMatch(/No critical outages are currently active\./);
  });
});
