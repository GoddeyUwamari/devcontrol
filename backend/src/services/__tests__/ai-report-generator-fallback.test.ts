/**
 * AI Reports truthfulness: every report source is its own ContextSection, and
 * nothing is fabricated to fill a gap.
 *
 * Previously fetchReportData() invented a previous cost (current * 0.9), a
 * previous security score (current - 5), a 3% resource change, a 2.0h
 * lead-time default, and fixed severities per compliance category; labeled the
 * inventory list-price estimate as "spending"; and reported alert counts from
 * a source with no organization-scoped rows as "0 alerts". This suite pins the
 * evidence-grounded replacement.
 *
 * No DB, AWS, or model access: repositories are mocked at the prototype level,
 * the pool is a fake whose query() answers the two SQL reads the service runs
 * itself, and the Anthropic SDK is mocked.
 */
const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ messages: { create: mockCreate } })),
}));

import { AIReportGeneratorService, ReportData } from '../ai-report-generator.service';
import { AIChatContextRepository } from '../../repositories/ai-chat-context.repository';
import { AWSResourcesRepository } from '../../repositories/awsResources.repository';
import { CostRecommendationsRepository } from '../../repositories/cost-recommendations.repository';
import { COMPARISON_BASIS, type ChatContext } from '../ai-chat.service';
import { collectSection, type CostExplorerScope, type InventoryScope } from '../ai-context-contract';

const ORG = '11111111-1111-1111-1111-111111111111';
const CE_SCOPE: CostExplorerScope = { kind: 'cost_explorer', connectedAccountId: '111122223333', linkedAccountFilter: 'none', consolidatedBilling: 'unknown', regions: 'all' };
const INVENTORY_SCOPE: InventoryScope = { kind: 'resource_inventory', connectedAccountId: '111122223333', discoveryRegion: 'us-east-1' };
const RANGE = { from: '2026-09-19', to: '2026-09-26' };

function unavailableComparison(note = 'not enough daily Cost Explorer data to compare'): ChatContext['costs']['comparison'] {
  return {
    state: 'unavailable', note, currentWindow: null, previousWindow: null, currentWindowTotal: null, previousWindowTotal: null,
    changeAmount: null, changePercent: null, coverage: null, currentWindowIncludesToday: false, finishedThrough: null, asOf: null, basis: COMPARISON_BASIS,
  };
}

const AVAILABLE_COMPARISON: ChatContext['costs']['comparison'] = {
  state: 'available', note: null,
  currentWindow: { start: '2026-09-01', end: '2026-09-26' }, previousWindow: { start: '2026-08-01', end: '2026-08-26' },
  currentWindowTotal: 120, previousWindowTotal: 100, changeAmount: 20, changePercent: 20,
  coverage: { currentDays: 26, previousDays: 26, expectedCurrentDays: 26, expectedPreviousDays: 26 },
  currentWindowIncludesToday: true, finishedThrough: null, asOf: '2026-09-26T06:00:00.000Z', basis: COMPARISON_BASIS,
};

function actualCosts(amount: number, comparison = unavailableComparison()): ChatContext['costs'] {
  return {
    state: 'available', source: 'actual', current: amount, asOf: '2026-09-26T06:00:00.000Z',
    period: { start: '2026-09-01', endExclusive: '2026-09-27' }, scope: CE_SCOPE,
    topSpenders: [{ service: 'Amazon EC2', cost: amount, percentage: amount > 0 ? 100 : null }],
    costExplorer: { state: 'available', reason: null }, estimateCoverage: null, comparison,
  };
}

function estimatedCosts(amount: number, estimated: number, total: number): ChatContext['costs'] {
  return {
    state: estimated < total ? 'partial' : 'available', source: 'estimated', current: amount, asOf: '2026-09-26T05:00:00.000Z',
    period: null, scope: INVENTORY_SCOPE, topSpenders: null,
    costExplorer: { state: 'unavailable', reason: 'no connected AWS account' },
    estimateCoverage: { estimatedResources: estimated, totalResources: total },
    comparison: unavailableComparison('no Cost Explorer data for the current period, so there is nothing to compare'),
  };
}

function noCosts(state: 'error' | 'unavailable'): ChatContext['costs'] {
  return {
    state, source: 'unavailable', current: null, asOf: null, period: null, scope: null, topSpenders: null,
    costExplorer: { state, reason: state === 'error' ? 'the Cost Explorer request failed' : 'no connected AWS account' },
    estimateCoverage: null, comparison: unavailableComparison(),
  };
}

async function basis(discoveryState: 'available' | 'unavailable' = 'available') {
  const discovery = await collectSection<{ completedAt: string }>({ source: 'DevControl resource discovery runs' }, async () =>
    discoveryState === 'available'
      ? { state: 'available', data: { completedAt: '2026-09-26T05:00:00.000Z' }, asOf: '2026-09-26T05:00:00.000Z' }
      : { state: 'unavailable', reason: 'no discovery run has ever run for this account' });
  const account = await collectSection<{ accountId: string | null; region: string | null }>({ source: 'DevControl connected AWS account record' }, async () => ({
    state: 'available', data: { accountId: '111122223333', region: 'us-east-1' },
  }));
  return { discovery, account, inventoryScope: INVENTORY_SCOPE };
}

type Deployment = { service_id: string; status: string; deployed_at: string };

function fakePool(deployments: Deployment[] = []) {
  return {
    query: jest.fn(async (sql: string) => {
      if (/FROM deployments/.test(sql)) return { rows: deployments };
      if (/estimated_monthly_cost > 0/.test(sql)) return { rows: [{ resource_id: 'i-1', resource_type: 'ec2', estimated_monthly_cost: '42.50', resource_name: 'web' }] };
      throw new Error(`unexpected query: ${sql}`);
    }),
  } as any;
}

function mockSources(opts: {
  costs?: ChatContext['costs'];
  discovery?: 'available' | 'unavailable';
  issues?: Array<{ resource_type: string; issues: Array<{ severity: string; category: string }> }>;
  statsFails?: boolean;
  recommendations?: Array<{ resource_id: string; resource_type: string; issue: string; potential_savings: number }>;
} = {}) {
  jest.spyOn(AIChatContextRepository.prototype, 'gatherCostContext').mockImplementation(async () => ({
    ...(await basis(opts.discovery)),
    costs: opts.costs ?? actualCosts(14.83),
  }));
  jest.spyOn(AIChatContextRepository.prototype, 'gatherInventoryBasis').mockImplementation(() => basis(opts.discovery));
  const getStats = jest.spyOn(AWSResourcesRepository.prototype, 'getStats');
  if (opts.statsFails) {
    getStats.mockRejectedValue(new Error('relation "aws_resources" does not exist at character 21'));
  } else {
    getStats.mockResolvedValue({ total_resources: 12, by_type: { ec2: 4, s3: 8 } } as any);
  }
  jest.spyOn(AWSResourcesRepository.prototype, 'getComplianceIssues').mockResolvedValue((opts.issues ?? []) as any);
  jest.spyOn(CostRecommendationsRepository.prototype, 'findAll').mockResolvedValue((opts.recommendations ?? []) as any);
}

const ORIGINAL_ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  delete process.env.ANTHROPIC_API_KEY;
  mockCreate.mockReset();
});

afterEach(() => jest.restoreAllMocks());

afterAll(() => {
  if (ORIGINAL_ANTHROPIC_API_KEY !== undefined) process.env.ANTHROPIC_API_KEY = ORIGINAL_ANTHROPIC_API_KEY;
});

async function evidence(opts: Parameters<typeof mockSources>[0] = {}, deployments: Deployment[] = [], reportType = 'weekly_summary'): Promise<ReportData> {
  mockSources(opts);
  return new AIReportGeneratorService(fakePool(deployments)).fetchReportData(ORG, RANGE, reportType);
}

describe('AI Reports evidence -- cost', () => {
  it('a real $0 Cost Explorer month stays actual billed spend, not an estimate', async () => {
    const { sections } = await evidence({ costs: actualCosts(0) });
    expect(sections.spend).toMatchObject({ state: 'available', provenance: 'actual', scope: CE_SCOPE, data: { amount: 0, basis: 'billed_month_to_date' } });
  });

  it('a net-credit Cost Explorer month stays actual, with its negative amount', async () => {
    const { sections } = await evidence({ costs: actualCosts(-3.21) });
    expect(sections.spend).toMatchObject({ state: 'available', provenance: 'actual', data: { amount: -3.21 } });
  });

  it('the inventory estimate is labeled estimated, with inventory scope and incomplete coverage kept', async () => {
    const { sections } = await evidence({ costs: estimatedCosts(3200, 8, 10) });
    expect(sections.spend).toMatchObject({
      state: 'partial', provenance: 'estimated', scope: INVENTORY_SCOPE, period: { kind: 'point_in_time' },
      data: { amount: 3200, basis: 'estimated_monthly_run_rate', topServices: null },
      completeness: { expected: 10, received: 8 },
    });
  });

  it('no previous cost is fabricated: without comparison evidence the comparison is unavailable with no data', async () => {
    const { sections } = await evidence({ costs: actualCosts(1000) });
    expect(sections.monthOverMonth).toMatchObject({ state: 'unavailable', data: null, provenance: null });
    expect(JSON.stringify(sections)).not.toMatch(/"previous":900|"previousCost"/);
  });

  it('a real comparison is derived from the Cost Explorer daily trend, never labeled actual', async () => {
    const { sections } = await evidence({ costs: actualCosts(1000, AVAILABLE_COMPARISON) });
    expect(sections.monthOverMonth).toMatchObject({
      state: 'available', provenance: 'derived',
      data: { currentWindowTotal: 120, previousWindowTotal: 100, changeAmount: 20, changePercent: 20, currentWindowIncludesToday: true },
    });
    expect(sections.monthOverMonth!.derivedFrom).toEqual([expect.objectContaining({ source: 'AWS Cost Explorer daily trend', provenance: 'actual' })]);
  });

  it('missing cost data is unavailable or error -- never $0', async () => {
    for (const state of ['unavailable', 'error'] as const) {
      const { sections } = await evidence({ costs: noCosts(state) });
      expect(sections.spend).toMatchObject({ state, data: null, provenance: null });
    }
  });
});

describe('AI Reports evidence -- security, resources, alerts', () => {
  it('there is no security score and no previous score -- both are explicitly not supported', async () => {
    const { sections } = await evidence();
    expect(sections.securityScore).toMatchObject({ state: 'not_supported', data: null });
    expect(sections.securityHistory).toMatchObject({ state: 'not_supported', data: null });
    expect(JSON.stringify(sections)).not.toMatch(/previousScore/);
  });

  it('finding severities and resource types come from the findings themselves, not a hard-coded category table', async () => {
    const { sections } = await evidence({
      issues: [
        { resource_type: 's3', issues: [{ severity: 'low', category: 'encryption' }, { severity: 'medium', category: 'tagging' }] },
        { resource_type: 'rds', issues: [{ severity: 'high', category: 'backups' }] },
      ],
    });
    expect(sections.securityFindings).toMatchObject({
      state: 'available',
      data: {
        resourcesEvaluated: 12, resourcesWithFindings: 2,
        findingsBySeverity: { critical: 0, high: 1, medium: 1, low: 1 },
      },
    });
    const encryption = sections.securityFindings!.data!.byCategory.find(c => c.category === 'encryption');
    // Previously every encryption finding was reported as 'critical' on 'mixed' resources.
    expect(encryption).toEqual({ category: 'encryption', findings: 1, highestSeverity: 'low', resourceTypes: ['s3'] });
  });

  it('no findings before discovery has completed is unavailable, not "no issues"', async () => {
    const { sections } = await evidence({ discovery: 'unavailable' });
    expect(sections.securityFindings).toMatchObject({ state: 'unavailable', data: null });
  });

  it('resource change over the period is not supported -- no invented growth', async () => {
    const { sections } = await evidence();
    expect(sections.resourceChange).toMatchObject({ state: 'not_supported', data: null });
    expect(sections.resourceInventory).toMatchObject({ state: 'available', data: { total: 12 } });
  });

  it('alerts are not supported -- never "0 alerts"', async () => {
    const { sections } = await evidence();
    expect(sections.alerts).toMatchObject({ state: 'not_supported', data: null });
  });

  it('a failed inventory read is an error section with a safe reason, and other sections are unaffected', async () => {
    const { sections } = await evidence({ statsFails: true });
    expect(sections.resourceInventory).toMatchObject({ state: 'error', data: null });
    expect(sections.securityFindings).toMatchObject({ state: 'error', data: null });
    expect(sections.spend).toMatchObject({ state: 'available' });
    expect(JSON.stringify(sections)).not.toMatch(/relation|character 21/);
  });

  it('recommendation savings stay estimates', async () => {
    const { sections } = await evidence({
      recommendations: [
        { resource_id: 'vol-1', resource_type: 'ebs', issue: 'Unused EBS volume', potential_savings: 42 },
        { resource_id: 'i-9', resource_type: 'ec2', issue: 'Oversized instance', potential_savings: 300 },
      ],
    });
    expect(sections.idleResourceRecommendations).toMatchObject({
      state: 'available', provenance: 'estimated',
      data: { items: [{ resourceId: 'vol-1', estimatedMonthlySavings: 42 }], totalEstimatedMonthlySavings: 42 },
    });
  });
});

describe('AI Reports evidence -- deployments', () => {
  it('no lead-time default: with no repeat successful deployment, time between deployments is unavailable', async () => {
    const { sections } = await evidence({}, [
      { service_id: 'svc-1', status: 'success', deployed_at: '2026-09-20T10:00:00Z' },
      { service_id: 'svc-2', status: 'failed', deployed_at: '2026-09-21T10:00:00Z' },
    ]);
    expect(sections.timeBetweenDeployments).toMatchObject({ state: 'unavailable', data: null });
    expect(sections.deployments).toMatchObject({ state: 'available', provenance: 'actual', data: { total: 2, successful: 1, failed: 1 } });
    expect(sections.deliveryRates).toMatchObject({ provenance: 'derived', data: { successRatePercent: 50, changeFailureRatePercent: 50 } });
  });

  it('time between successful deployments is derived from the records and never called lead time', async () => {
    const { sections } = await evidence({}, [
      { service_id: 'svc-1', status: 'success', deployed_at: '2026-09-20T10:00:00Z' },
      { service_id: 'svc-1', status: 'success', deployed_at: '2026-09-20T13:00:00Z' },
    ]);
    expect(sections.timeBetweenDeployments).toMatchObject({ state: 'available', provenance: 'derived', data: { averageHours: 3, intervalsMeasured: 1, servicesMeasured: 1 } });
  });

  it('no deployments recorded gives null rates, not 0%', async () => {
    const { sections } = await evidence({}, []);
    expect(sections.deployments).toMatchObject({ data: { total: 0 } });
    expect(sections.deliveryRates).toMatchObject({ data: { successRatePercent: null, changeFailureRatePercent: null } });
  });
});

describe('AI Reports prompt grounding', () => {
  it('model input carries each section as evidence: unavailable is not zero, estimates stay estimated', async () => {
    const data = await evidence({ costs: estimatedCosts(3200, 10, 10) });
    const prompt = new AIReportGeneratorService(fakePool()).buildUserPrompt(data, 'weekly_summary');

    expect(prompt).toContain('"provenance":"estimated"');
    expect(prompt).toContain('"basis":"estimated_monthly_run_rate"');
    expect(prompt).toMatch(/### Month-over-month cost comparison\n\{"contractVersion":1,"state":"unavailable"[^\n]*"evidencePresent":false/);
    expect(prompt).toMatch(/### Alerts\n[^\n]*"state":"not_supported"/);
    expect(prompt).toMatch(/never say there were no alerts, zero alerts/);
    expect(prompt).toMatch(/never describe it as zero, none, empty, unchanged, flat, or "no findings"/);
    expect(prompt).toMatch(/Never state a previous-period cost, a trend, or a percentage change unless/);
    expect(prompt).toMatch(/never call it lead time/);
  });

  it('never asks for rightsizing, Reserved Instance, or Savings Plan recommendations', async () => {
    const service = new AIReportGeneratorService(fakePool());
    for (const type of ['cost_analysis', 'security_insights', 'infrastructure_health', 'executive_summary', 'weekly_summary']) {
      const system: string = (service as any).buildSystemPrompt(type);
      expect(system).not.toMatch(/Reserved Instance candidates|rightsizing opportunities|SLA/i);
    }
    const data = await evidence();
    expect(service.buildUserPrompt(data, 'cost_analysis')).toMatch(/Do not recommend rightsizing, Reserved Instances, or Savings Plans unless a supplied recommendation says so/);
  });

  it('a model-invented estimatedSavings is dropped; one copied from the evidence is kept', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    mockCreate.mockResolvedValue({
      content: [{
        type: 'text',
        text: JSON.stringify({
          summary: 's', keyHighlights: [], executiveSummary: 'e',
          topRecommendations: [
            { title: 'Buy Savings Plans', impact: 'high', description: 'x', estimatedSavings: 999, effort: 'low' },
            { title: 'Delete unused volume', impact: 'low', description: 'x', estimatedSavings: 42, effort: 'low' },
          ],
        }),
      }],
    });
    const data = await evidence({ recommendations: [{ resource_id: 'vol-1', resource_type: 'ebs', issue: 'Unused EBS volume', potential_savings: 42 }] });

    const { report, wasFallback } = await new AIReportGeneratorService(fakePool()).generateWeeklyReport(data);

    expect(wasFallback).toBe(false);
    expect(report.topRecommendations[0]).not.toHaveProperty('estimatedSavings');
    expect(report.topRecommendations[1].estimatedSavings).toBe(42);
  });
});

describe('AI Reports deterministic fallback', () => {
  it('is flagged as a fallback', async () => {
    const data = await evidence();
    const { wasFallback } = await new AIReportGeneratorService(fakePool()).generateWeeklyReport(data);
    expect(wasFallback).toBe(true);
  });

  it('states missing evidence as missing: no "$0", no "0 alerts", no invented trend, score, or lead time', async () => {
    const data = await evidence({ costs: noCosts('unavailable') });
    const { report } = await new AIReportGeneratorService(fakePool()).generateWeeklyReport(data);
    const text = JSON.stringify(report);

    expect(text).toContain('Cloud spend is not available');
    expect(text).toContain('Alert counts are not available');
    expect(text).not.toMatch(/\$0(\.00)?\b/);
    expect(text).not.toMatch(/\b0 alerts|no alerts|0 critical alerts/i);
    expect(text).not.toMatch(/Security score is|\/100/);
    expect(text).not.toMatch(/lead time is|Average lead time/i);
    expect(text).not.toMatch(/increased by|decreased by|growth of/i);
    expect(text).not.toMatch(/Reserved Instances|Savings Plans/);
  });

  it('labels the inventory estimate as an estimate, never as spending', async () => {
    const data = await evidence({ costs: estimatedCosts(3200, 10, 10) });
    const { report } = await new AIReportGeneratorService(fakePool()).generateWeeklyReport(data);

    expect(report.costAnalysis!.overview).toContain('DevControl estimates the monthly run-rate of discovered resources at $3,200.00 (a list-price estimate, not AWS billing data)');
    expect(JSON.stringify(report)).not.toMatch(/AWS spending|Cloud Spending/i);
  });

  it('a $0 actual month is reported as $0.00 of billed spend, not as unavailable or an estimate', async () => {
    const data = await evidence({ costs: actualCosts(0) });
    const { report } = await new AIReportGeneratorService(fakePool()).generateWeeklyReport(data);

    expect(report.costAnalysis!.overview).toMatch(/^AWS Cost Explorer shows \$0\.00 of billed spend month-to-date/);
  });

  it('recommendation savings are described as estimates, and an empty list draws no "no savings" conclusion', async () => {
    const withRecs = await evidence({ recommendations: [{ resource_id: 'vol-1', resource_type: 'ebs', issue: 'Unused EBS volume', potential_savings: 42 }] });
    const { report } = await new AIReportGeneratorService(fakePool()).generateWeeklyReport(withRecs);
    expect(report.executiveSummary).toContain('Estimated potential savings of $42.00/month from idle or unused resources (a DevControl estimate, not realized savings).');
    expect(report.topRecommendations.find(r => r.title === 'Review idle or unused resources')?.estimatedSavings).toBe(42);

    jest.restoreAllMocks();
    const empty = await evidence();
    const { report: emptyReport } = await new AIReportGeneratorService(fakePool()).generateWeeklyReport(empty);
    expect(JSON.stringify(emptyReport)).not.toMatch(/no (cost[- ])?(optimi[sz]ation|saving)s? (opportunit|found|identified)|nothing to optimi|no savings|well-optimized/i);
  });

  it('only issues supported by findings are emitted -- no hard-coded "critical" claims', async () => {
    const data = await evidence({ issues: [{ resource_type: 's3', issues: [{ severity: 'low', category: 'encryption' }] }] });
    const { report } = await new AIReportGeneratorService(fakePool()).generateWeeklyReport(data);

    expect(report.securityAnalysis!.topRisks).toBe('encryption: 1 findings (highest severity: low; resource types: s3)');
    expect(report.topRecommendations.some(r => /critical/i.test(r.title))).toBe(false);
  });
});

describe('AI Reports tenant identity', () => {
  it('fails closed without an organization id', async () => {
    mockSources();
    const service = new AIReportGeneratorService(fakePool());
    await expect(service.fetchReportData('', RANGE)).rejects.toThrow(/organizationId is required/);
    await expect(service.fetchReportData(undefined as any, RANGE)).rejects.toThrow(/organizationId is required/);
  });
});
