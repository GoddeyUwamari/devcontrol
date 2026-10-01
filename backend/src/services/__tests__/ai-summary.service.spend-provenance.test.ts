/**
 * Dashboard AI summary truthfulness: every input is its own ContextSection,
 * and missing evidence is stated as missing.
 *
 * Previously: spend came from getMonthlySpendWithFallback() (a real $0 or
 * net-credit Cost Explorer month fell back to the inventory estimate, and any
 * spend <= 0 was dropped), the month-over-month change was a client-supplied
 * query parameter, "No critical outages are currently active." was asserted
 * from a disabled anomaly source, and one failed source blanked the summary.
 *
 * Every dependency is mocked at the prototype level; assertions are on the
 * actual prompt handed to AIInsightsService.generateStructuredDashboardSummary()
 * and on the returned fields.
 */
import { AISummaryService, SYSTEM_STATUS_UNAVAILABLE } from '../ai-summary.service';
import { SystemIntelligenceService, SystemIntelligenceResult } from '../system-intelligence.service';
import { RiskTrackingService } from '../risk-tracking.service';
import { AccountSecurityFindingsRepository } from '../../repositories/account-security-findings.repository';
import { CostRecommendationsRepository } from '../../repositories/cost-recommendations.repository';
import { AIChatContextRepository } from '../../repositories/ai-chat-context.repository';
import { AIInsightsService } from '../ai-insights.service';
import { AISummaryController } from '../../controllers/ai-summary.controller';
import { COMPARISON_BASIS, type ChatContext } from '../ai-chat.service';
import { collectSection, type CostExplorerScope, type InventoryScope } from '../ai-context-contract';

const ORG = '11111111-1111-1111-1111-111111111111';
const CE_SCOPE: CostExplorerScope = { kind: 'cost_explorer', connectedAccountId: '111122223333', linkedAccountFilter: 'none', consolidatedBilling: 'unknown', regions: 'all' };
const INVENTORY_SCOPE: InventoryScope = { kind: 'resource_inventory', connectedAccountId: '111122223333', discoveryRegion: 'us-east-1' };

function unavailableComparison(): ChatContext['costs']['comparison'] {
  return {
    state: 'unavailable', note: 'not enough daily Cost Explorer data to compare', currentWindow: null, previousWindow: null,
    currentWindowTotal: null, previousWindowTotal: null, changeAmount: null, changePercent: null, coverage: null,
    currentWindowIncludesToday: false, asOf: null, basis: COMPARISON_BASIS,
  };
}

function actualCosts(amount: number, comparison = unavailableComparison()): ChatContext['costs'] {
  return {
    state: 'available', source: 'actual', current: amount, asOf: '2026-09-26T06:00:00.000Z',
    period: { start: '2026-09-01', endExclusive: '2026-09-27' }, scope: CE_SCOPE, topSpenders: [],
    costExplorer: { state: 'available', reason: null }, estimateCoverage: null, comparison,
  };
}

function estimatedCosts(amount: number): ChatContext['costs'] {
  return {
    state: 'available', source: 'estimated', current: amount, asOf: '2026-09-26T05:00:00.000Z', period: null, scope: INVENTORY_SCOPE,
    topSpenders: null, costExplorer: { state: 'unavailable', reason: 'no connected AWS account' },
    estimateCoverage: { estimatedResources: 5, totalResources: 5 }, comparison: unavailableComparison(),
  };
}

function noCosts(): ChatContext['costs'] {
  return {
    state: 'error', source: 'unavailable', current: null, asOf: null, period: null, scope: null, topSpenders: null,
    costExplorer: { state: 'error', reason: 'the Cost Explorer request failed' }, estimateCoverage: null, comparison: unavailableComparison(),
  };
}

function intelligence(): SystemIntelligenceResult {
  const componentBase = { label: '', detail: '', severity: 'healthy' as const, delta: null, status: 'good' as const, ready: true, state: 'available' as const, reason: null };
  return {
    system_score: 80,
    composite_state: 'available',
    composite_reason: null,
    status: 'Healthy',
    components: {
      cost: { ...componentBase, score: 80, label: 'Cost Efficiency' },
      security: { ...componentBase, score: 80, label: 'Security Posture' },
      observability: { ...componentBase, score: 80, label: 'Observability', state: 'available', reason: null },
    },
    top_action: null,
    top_drivers: [],
    computed_at: new Date().toISOString(),
  };
}

const MODEL_FIELDS = { overallHealth: { score: 80, context: 'x' }, topRisk: 'No risks at all', cloudSpend: 'Spend is $0', systemStatus: 'No critical outages are currently active.' };

function mockDependencies(opts: {
  costs?: ChatContext['costs'];
  findings?: Array<{ title: string; severity: string }> | Error;
  combined?: number;
  preliminary?: boolean;
  recommendations?: { active: number; savings: number } | Error;
  model?: typeof MODEL_FIELDS | null;
  intelligence?: SystemIntelligenceResult;
} = {}) {
  jest.spyOn(SystemIntelligenceService.prototype, 'getSystemIntelligence').mockResolvedValue(opts.intelligence ?? intelligence());
  jest.spyOn(RiskTrackingService.prototype, 'getCurrentRiskScore').mockResolvedValue({
    score: 72,
    isPreliminary: opts.preliminary ?? false,
    complianceIssueCounts: { critical: 0, high: opts.combined ?? 0, medium: 0, low: 0 },
  } as any);
  const getActive = jest.spyOn(AccountSecurityFindingsRepository.prototype, 'getActive');
  if (opts.findings instanceof Error) getActive.mockRejectedValue(opts.findings);
  else getActive.mockResolvedValue((opts.findings ?? []) as any);
  const getStats = jest.spyOn(CostRecommendationsRepository.prototype, 'getStats');
  if (opts.recommendations instanceof Error) getStats.mockRejectedValue(opts.recommendations);
  else getStats.mockResolvedValue({
    total_recommendations: 0, active_recommendations: opts.recommendations?.active ?? 0,
    total_potential_savings: opts.recommendations?.savings ?? 0, potential_savings_by_resource_type: {}, by_severity: { high: 0, medium: 0, low: 0 },
  });
  jest.spyOn(AIChatContextRepository.prototype, 'gatherCostContext').mockImplementation(async () => {
    const discovery = await collectSection<{ completedAt: string }>({ source: 'DevControl resource discovery runs' }, async () => ({ state: 'available', data: { completedAt: '2026-09-26T05:00:00.000Z' } }));
    const account = await collectSection<{ accountId: string | null; region: string | null }>({ source: 'DevControl connected AWS account record' }, async () => ({ state: 'available', data: { accountId: '111122223333', region: 'us-east-1' } }));
    return { discovery, account, inventoryScope: INVENTORY_SCOPE, costs: opts.costs ?? actualCosts(1000) };
  });
  return jest.spyOn(AIInsightsService.prototype, 'generateStructuredDashboardSummary')
    .mockResolvedValue(opts.model === undefined ? MODEL_FIELDS : opts.model);
}

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

async function run(opts: Parameters<typeof mockDependencies>[0] = {}) {
  const generate = mockDependencies(opts);
  const result = await new AISummaryService().getSummary(ORG);
  const prompt: string = generate.mock.calls[0]?.[0] ?? '';
  return { result, prompt, generate };
}

describe('Dashboard AI summary -- cost evidence (AI Chat cost path, not getMonthlySpendWithFallback)', () => {
  it('a real $0 Cost Explorer month stays actual billed spend -- not dropped, not an estimate', async () => {
    const { prompt } = await run({ costs: actualCosts(0) });
    expect(prompt).toContain('AWS Cost Explorer month-to-date billed spend (2026-09-01 through 2026-09-26) is $0.00; the current day is still being billed.');
    expect(prompt).not.toMatch(/Estimated current monthly cloud spend/);
  });

  it('a net-credit month stays actual, with its negative amount', async () => {
    const { prompt } = await run({ costs: actualCosts(-3.21) });
    expect(prompt).toContain('is -$3.21 (net negative: credits and refunds exceed charges)');
  });

  it('an inventory estimate is labeled as an estimate', async () => {
    const { prompt } = await run({ costs: estimatedCosts(3200) });
    expect(prompt).toContain('Estimated current monthly cloud spend is approximately $3,200.00 (based on discovered resource pricing, not live billing data).');
    expect(prompt).not.toMatch(/AWS Cost Explorer month-to-date billed spend/);
  });

  it('missing spend is stated as not available -- never $0', async () => {
    const { prompt } = await run({ costs: noCosts() });
    expect(prompt).toMatch(/Cloud spend: not available \(AWS Cost Explorer could not be retrieved\)\. Do not describe spend as \$0 or unchanged\./);
    expect(prompt).not.toMatch(/spend[^\n]* is \$0/i);
  });

  it('month-over-month change comes from the server-side comparison, and is stated as missing when unavailable', async () => {
    const withComparison = await run({
      costs: actualCosts(120, {
        state: 'available', note: null,
        currentWindow: { start: '2026-09-01', end: '2026-09-26' }, previousWindow: { start: '2026-08-01', end: '2026-08-26' },
        currentWindowTotal: 120, previousWindowTotal: 100, changeAmount: 20, changePercent: 20,
        coverage: { currentDays: 26, previousDays: 26, expectedCurrentDays: 26, expectedPreviousDays: 26 },
        currentWindowIncludesToday: true, asOf: null, basis: COMPARISON_BASIS,
      }),
    });
    expect(withComparison.prompt).toContain('Month-to-date spend vs the same days last month: up 20.0% ($120.00 vs $100.00, daily charges with credits excluded; the current day is still being billed).');

    jest.restoreAllMocks();
    const without = await run();
    expect(without.prompt).toMatch(/Month-over-month change: not available \([^)]*\)\. Do not describe spend as up, down, flat, or unchanged\./);
  });
});

describe('Dashboard AI summary -- monitoring, security, recommendations', () => {
  it('unevaluated outage evidence can never produce "no outages"', async () => {
    const { prompt, result } = await run();
    expect(prompt).not.toMatch(/No critical outages/);
    expect(prompt).toMatch(/Outage and incident status: not available — DevControl does not currently evaluate outages, incidents, or anomalies\. Do not state or imply that there are no outages/);
    // The model returned "No critical outages are currently active." -- it is replaced.
    expect(result.systemStatus).toBe(SYSTEM_STATUS_UNAVAILABLE);
  });

  it('failed security evidence is not "no risks": the fact says not available and topRisk is unavailable', async () => {
    const { prompt, result } = await run({ findings: new Error('relation "account_security_findings" does not exist') });
    expect(prompt).toMatch(/Security findings: not available \(DevControl account-level security findings \(security groups, IAM\) could not be retrieved\)\. Do not state or imply that there are no security findings or risks\./);
    expect(prompt).not.toMatch(/relation/);
    expect(result).toMatchObject({ topRisk: null, topRiskStatus: 'unavailable' });
    expect(JSON.stringify(result)).not.toContain('No risks at all');
  });

  it('a preliminary risk score is unavailable, not "no risks"', async () => {
    const { result } = await run({ preliminary: true });
    expect(result).toMatchObject({ topRisk: null, topRiskStatus: 'unavailable' });
  });

  it('"none_identified" only when both security sources were evaluated and are empty -- model text is not used', async () => {
    const { result } = await run({ findings: [], combined: 0 });
    expect(result).toMatchObject({ topRisk: null, topRiskStatus: 'none_identified' });
  });

  it('an identified risk is always the finding itself -- model text can never replace it', async () => {
    // The model returns topRisk "No risks at all" alongside a critical finding.
    const identified = await run({ findings: [{ title: 'SSH open to the internet', severity: 'critical' }], combined: 1 });
    expect(identified.prompt).toContain('Top active finding: "SSH open to the internet" (severity: critical).');
    expect(identified.result).toMatchObject({ topRisk: 'SSH open to the internet (critical severity)', topRiskStatus: 'identified' });
    expect(JSON.stringify(identified.result)).not.toContain('No risks at all');

    jest.restoreAllMocks();
    const noModel = await run({ findings: [{ title: 'SSH open to the internet', severity: 'critical' }], combined: 1, model: null });
    expect(noModel.result).toMatchObject({ topRisk: 'SSH open to the internet (critical severity)', topRiskStatus: 'identified', systemStatus: SYSTEM_STATUS_UNAVAILABLE });
  });

  it('with no findings, a model-invented risk is never shown', async () => {
    const { result } = await run({ findings: [], combined: 0, model: { ...MODEL_FIELDS, topRisk: 'SSH exposure detected' } });
    expect(result).toMatchObject({ topRisk: null, topRiskStatus: 'none_identified' });
    expect(JSON.stringify(result)).not.toContain('SSH exposure detected');
  });

  it('failed recommendation evidence is stated as not available, never as zero opportunities', async () => {
    const { prompt } = await run({ recommendations: new Error('timeout') });
    expect(prompt).toContain('Cost recommendations: not available (DevControl cost recommendations could not be retrieved).');
    expect(prompt).not.toMatch(/0 active cost optimization|no (cost )?optimi[sz]ation/i);
  });

  it('recommendation savings stay estimates', async () => {
    const { prompt } = await run({ recommendations: { active: 2, savings: 120 } });
    expect(prompt).toMatch(/2 active cost optimizations have estimated potential savings of approximately \$120[^\n]*\/month \(a DevControl estimate, not realized savings\)\./);
  });

  it('one failed source does not blank the others', async () => {
    const { prompt } = await run({ findings: new Error('x'), recommendations: new Error('y') });
    expect(prompt).toContain('Composite System Intelligence score: 80/100');
    expect(prompt).toContain('AWS Cost Explorer month-to-date billed spend');
  });
});

describe('Dashboard AI summary -- tenant and caching', () => {
  it('fails closed without an organization id', async () => {
    mockDependencies();
    await expect(new AISummaryService().getSummary('')).rejects.toThrow(/organizationId is required/);
  });

  it('caches per organization on the evidence fingerprint', async () => {
    const generate = mockDependencies();
    const service = new AISummaryService();
    await service.getSummary(ORG);
    await service.getSummary(ORG);
    expect(generate).toHaveBeenCalledTimes(1);
    await service.getSummary('22222222-2222-2222-2222-222222222222');
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('the controller uses the authenticated org and ignores a client-supplied costDeltaPct or organizationId', async () => {
    const getSummary = jest.spyOn(AISummaryService.prototype, 'getSummary').mockResolvedValue({} as any);
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };

    await new AISummaryController().getSummary(
      { user: { organizationId: ORG }, query: { costDeltaPct: '99', organizationId: 'other-org' } } as any,
      res
    );

    expect(getSummary).toHaveBeenCalledWith(ORG);
    expect(getSummary.mock.calls[0]).toHaveLength(1);
  });

  it('the controller returns 401 without an authenticated org', async () => {
    const getSummary = jest.spyOn(AISummaryService.prototype, 'getSummary');
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };

    await new AISummaryController().getSummary({ query: { organizationId: ORG } } as any, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(getSummary).not.toHaveBeenCalled();
  });
});

describe('Dashboard AI summary -- observability and composite state', () => {
  const PARTIAL_REASON = 'Measures EC2 alert coverage only (0 of 1 in-scope resources covered); monitoring coverage, signal freshness, response setup, and ALB/Lambda alert coverage are not supported yet.';

  function partialIntelligence(): SystemIntelligenceResult {
    const base = intelligence();
    return {
      ...base,
      system_score: 51,
      composite_state: 'partial',
      composite_reason: `Alert Coverage: ${PARTIAL_REASON}`,
      components: {
        ...base.components,
        observability: { ...base.components.observability, score: 0, state: 'partial', reason: PARTIAL_REASON },
      },
    };
  }

  it('a partial composite reaches the model as partial, with what observability actually measures', async () => {
    const { prompt } = await run({ intelligence: partialIntelligence() });
    expect(prompt).toContain('Composite System Intelligence score: 51/100 (Cost 80, Security 80, Observability 0, which measures EC2/RDS alert coverage only).');
    expect(prompt).toContain(`This composite is partial and must be described as partial: Alert Coverage: ${PARTIAL_REASON.replace(/\.$/, '')}.`);
  });

  it('the systemScore section itself is partial, not available', async () => {
    mockDependencies({ intelligence: partialIntelligence() });
    const sections = await (new AISummaryService() as any).gatherSections(ORG);
    expect(sections.systemScore.state).toBe('partial');
    expect(sections.systemScore.data.observabilityState).toBe('partial');
    expect(sections.systemScore.reason).toBe(`Alert Coverage: ${PARTIAL_REASON}`);
  });

  it('an observability error leaves no composite: the section is unavailable and no score reaches the model', async () => {
    const base = intelligence();
    const { prompt } = await run({
      intelligence: {
        ...base,
        system_score: null,
        composite_state: null,
        composite_reason: null,
        status: 'Pending',
        components: {
          ...base.components,
          observability: { ...base.components.observability, score: null, ready: false, state: 'error', reason: 'the connected AWS role could not be assumed' },
        },
      },
    });
    expect(prompt).not.toMatch(/Composite System Intelligence score/);
    expect(prompt).not.toMatch(/Observability 0/);
  });

  it('a partial cost component reaches the model under Cost, not attributed to observability', async () => {
    const base = partialIntelligence();
    const COST_REASON = 'Insufficient spend data to assess cost efficiency. Spend based on inventory estimate, not AWS Cost Explorer billing. Anomaly checks not yet active.';
    const compositeReason = `Cost: ${COST_REASON} Alert Coverage: ${PARTIAL_REASON}`;
    const { prompt } = await run({
      intelligence: {
        ...base,
        composite_reason: compositeReason,
        components: { ...base.components, cost: { ...base.components.cost, state: 'partial', reason: COST_REASON } },
      },
    });
    expect(prompt).toContain(`This composite is partial and must be described as partial: ${compositeReason.replace(/\.$/, '')}.`);
    expect(prompt).not.toMatch(/Observability is partial/);
    // A stated limitation, never an anomaly finding.
    expect(prompt).not.toMatch(/anomal(y|ies) (was|were) (detected|found)/i);
  });

  it('a fully available composite carries no partial caveat', async () => {
    const { prompt } = await run();
    expect(prompt).toContain('Composite System Intelligence score: 80/100 (Cost 80, Security 80, Observability 80).');
    expect(prompt).not.toMatch(/composite is partial/);
  });
});
