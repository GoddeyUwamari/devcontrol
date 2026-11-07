/**
 * Re-review H1 (AI truth PR 2): an organization with many active cost
 * findings must keep its cost-finding evidence in the Dashboard summary and in
 * AI Reports, and a section the size budget cuts must be stated as "not
 * included in this answer (too large)" by every consumer -- never "no cost
 * findings are available", never "available" with no data.
 *
 * Every provider's collect() is stubbed (cost.findings returns 25 realistic
 * active findings, the others are not_built); everything after that is the
 * real code: collectEvidence, the budget, the summary's gatherEvidence /
 * getSummary, the report's fetchReportData / buildUserPrompt /
 * generateWeeklyReport (no model key: the deterministic fallback). No
 * database, AWS or model.
 */
jest.mock('../../../../config/database', () => {
  const actual = jest.requireActual('../../../../config/database');
  return {
    ...actual,
    pool: {
      // Only the plan read: every organization here is on Enterprise.
      query: jest.fn(async (sql: string) => {
        if (/FROM organizations WHERE id/.test(sql)) return { rows: [{ subscription_tier: 'enterprise', billing_lifecycle_state: null, grace_period_ends_at: null }] };
        throw new Error('no database in this test');
      }),
      connect: jest.fn(async () => { throw new Error('no database in this test'); }),
    },
  };
});

import { collectSection, notBuilt, type ContextSection } from '../../../ai-context-contract';
import { defaultEvidenceRegistry } from '../providers';
import { costFindingsProvider, type CostFindingsEvidence, type CostFindingItem } from '../providers/cost';
import { dataTokens } from '../budget';
import { collectEvidence, EvidenceRegistry } from '../registry';
import { createEvidenceBasis, type BasisSources } from '../basis';
import { AISummaryService } from '../../../ai-summary.service';
import { AIInsightsService } from '../../../ai-insights.service';
import { AIReportGeneratorService } from '../../../ai-report-generator.service';
import { AIChatService, type ChatContext } from '../../../ai-chat.service';
import { chatCosts, evidenceBundle } from '../../../__tests__/chat-context-fixtures';
import { COMPARISON_BASIS } from '../../../ai-chat.service';

const ORG = '00000000-0000-4000-8000-0000000000f6';
const RANGE = { from: '2026-10-31', to: '2026-11-07' };

/** Realistic CostFindingItem shapes: idle EC2 instances with their CPU evidence. */
function findingItems(n: number): CostFindingItem[] {
  return Array.from({ length: n }, (_, i) => ({
    ref: `c${i + 1}`,
    findingId: `00000000-0000-4000-8000-${String(100000000000 + i).slice(-12)}`,
    resourceId: `i-fixture${String(i).padStart(4, '0')}`,
    resourceType: 'EC2',
    issue: 'Idle EC2 Instance',
    severity: 'MEDIUM',
    region: 'us-east-1',
    estimatedMonthlySavings: 12.5 + i,
    savingsBasis: 'estimate',
    priceKnown: true,
    detectedAt: '2026-11-06T06:00:00.000Z',
    cpuEvidence: { averageCpuPercent: 1.25, daysAnalyzed: 7, datapointsObserved: 160, datapointsExpected: 168, windowEnd: '2026-11-06T05:00:00.000Z' },
  }));
}

async function costFindingsSection(n: number): Promise<ContextSection<CostFindingsEvidence>> {
  const items = findingItems(n);
  return collectSection<CostFindingsEvidence>({ source: 'DevControl cost findings', classification: 'estimated' }, async () => ({
    state: 'available',
    asOf: '2026-11-06T06:00:00.000Z',
    data: {
      outcome: 'found',
      lifecycle: { active: n, resolved: 0, dismissed: 0 },
      activeBySeverity: { high: 0, medium: n, low: 0 },
      totalEstimatedMonthlySavings: Math.round(items.reduce((sum, i) => sum + i.estimatedMonthlySavings, 0) * 100) / 100,
      totalSavingsCeiling: 0,
      items,
    },
    untrusted: items.map((i) => ({ field: `${i.ref} resource name`, text: `fixture-web-server-${i.ref}` })),
  }));
}

/** Every provider stubbed: cost.findings returns `n` findings, the rest are not_built. */
function stubProviders(n: number) {
  for (const p of defaultEvidenceRegistry().list()) {
    jest.spyOn(p, 'collect').mockImplementation(async () =>
      (p.id === 'cost.findings' ? costFindingsSection(n) : notBuilt({ source: p.source }, 'stubbed in this test')) as never);
  }
}

beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

async function summaryPrompt(): Promise<string> {
  let prompt = '';
  jest.spyOn(AIInsightsService.prototype, 'summarizeDashboard').mockImplementation(async (p: string) => {
    prompt = p;
    return { fields: null, source: 'facts_only' };
  });
  await new AISummaryService().getSummary(ORG);
  return prompt;
}

async function report() {
  const service = new AIReportGeneratorService({} as never);
  const data = await service.fetchReportData(ORG, RANGE, 'cost_analysis');
  const prompt = service.buildUserPrompt(data, 'cost_analysis');
  const { report: generated } = await service.generateWeeklyReport(data, 'cost_analysis');
  return { data, prompt, generated };
}

describe('H1 part 1: 25 active cost findings keep their evidence', () => {
  it('precondition: 25 realistic findings are over the provider cap, so the budget must shorten them', async () => {
    const section = await costFindingsSection(25);
    expect(dataTokens(section)).toBeGreaterThan(costFindingsProvider.maxTokens);
  });

  it('the summary keeps the savings line, and the list is shortened to its top items', async () => {
    stubProviders(25);
    const prompt = await summaryPrompt();
    const line = prompt.split('\n').find((l) => l.includes('active cost optimizations')) ?? '';
    console.info(`[H1 regression] summary prompt line: ${line}`);
    expect(line).toBe('- 25 active cost optimizations have estimated potential savings of approximately $613/month (a DevControl estimate, not realized savings).');
    expect(prompt).not.toMatch(/no cost findings are available|Cost recommendations: not available/);

    const bundle = await collectEvidence(defaultEvidenceRegistry(), { organizationId: ORG, consumer: 'test', select: { providerIds: ['cost.findings'] }, budgetTokens: 6_000 });
    const findings = bundle.results.find((r) => r.id === 'cost.findings')!;
    expect(findings.mode).toBe('summarised');
    const kept = (findings.section.data as CostFindingsEvidence).items;
    expect(kept.length).toBeLessThan(25);
    expect(kept.map((i) => i.ref)).toEqual(findingItems(kept.length).map((i) => i.ref)); // the top items, in order
    expect(findings.section.truncation).toEqual({ kept: kept.length, total: 25, by: 'provider_cap' });
  });

  it('the report keeps "Review N active recommendations…" and the top recommendation', async () => {
    stubProviders(25);
    const { data, generated } = await report();
    const idle = data.sections.idleResourceRecommendations!;
    console.info(`[H1 regression] report idle recs: ${JSON.stringify({ state: idle.state, items: (idle.data as { items: unknown[] } | null)?.items.length ?? null, truncation: data.evidence!.results.find((r) => r.id === 'cost.findings')!.section.truncation })}`);
    console.info(`[H1 regression] report fallback: ${JSON.stringify(generated.costAnalysis?.recommendations)} ${JSON.stringify(generated.topRecommendations.map((r) => r.title))}`);
    expect(idle.state).toBe('available');
    expect(generated.costAnalysis?.recommendations).toEqual([
      'Review 5 active recommendations for idle or unused resources (estimated potential savings of $72.50/month; a DevControl estimate, not realized savings).',
    ]);
    expect(generated.topRecommendations.map((r) => r.title)).toContain('Review idle or unused resources');
  });
});

describe('H1 part 2: a section cut to its line is "not included in this answer (too large)" everywhere', () => {
  // A cap no list can fit under, so cost.findings is cut to its line.
  function forceCut() {
    const original = costFindingsProvider.maxTokens;
    (costFindingsProvider as { maxTokens: number }).maxTokens = 10;
    return () => { (costFindingsProvider as { maxTokens: number }).maxTokens = original; };
  }

  it('the bundle: state omitted with the fixed reason, no data -- never "available"', async () => {
    stubProviders(25);
    const restore = forceCut();
    try {
      const bundle = await collectEvidence(defaultEvidenceRegistry(), { organizationId: ORG, consumer: 'test', select: { providerIds: ['cost.findings'] }, budgetTokens: 6_000 });
      const findings = bundle.results.find((r) => r.id === 'cost.findings')!;
      expect(findings.mode).toBe('header');
      expect(findings.section).toMatchObject({ state: 'omitted', reason: 'not included in this answer (too large)', data: null, untrusted: [], truncation: { kept: 0, total: 25, by: 'provider_cap' } });
    } finally {
      restore();
    }
  });

  it('the summary', async () => {
    stubProviders(25);
    const restore = forceCut();
    try {
      const prompt = await summaryPrompt();
      expect(prompt).toContain('- Cost recommendations: not included in this answer (too large).');
      expect(prompt).not.toMatch(/no cost findings are available/);
    } finally {
      restore();
    }
  });

  it('the report: its section, its source line and its fallback', async () => {
    stubProviders(25);
    const restore = forceCut();
    try {
      const { data, prompt, generated } = await report();
      expect(data.sections.idleResourceRecommendations).toMatchObject({ state: 'omitted', data: null, reason: 'not included in this answer (too large)' });
      expect(prompt).toMatch(/- \[cost\.findings\] Cost findings \(savings opportunities\): not included in this answer \(too large\)\./);
      expect(prompt).toMatch(/### Active idle\/unused-resource recommendations\n\{[^\n]*"state":"omitted"[^\n]*"data":null\}/);
      expect(generated.costAnalysis?.recommendations).toEqual(['Cost recommendations: not included in this answer (too large).']);
      expect(JSON.stringify(generated)).not.toMatch(/is not available: DevControl cost recommendations is not available/);
    } finally {
      restore();
    }
  });

  it('chat: a section the total budget cut is never shown as "Status: Available"', async () => {
    // test.first fills the total budget first (priority 1); inventory.resource_types (priority 2) is cut.
    const big = (id: string, priority: 1 | 2) => ({
      id, version: 1, title: id, source: `${id} source`, dataSourceIds: ['S4'], topics: ['inventory' as const], priority, maxTokens: 100_000,
      collect: async () => collectSection<string[]>({ source: 'DevControl resource inventory (periodic AWS discovery)' }, async () => ({ state: 'available', data: Array.from({ length: 400 }, (_, i) => `type-${i}`) })),
    });
    const registry = new EvidenceRegistry().register(big('test.first', 1)).register(big('inventory.resource_types', 2));
    const fail = async () => { throw new Error('unused'); };
    const basis = createEvidenceBasis(ORG, { context: { gatherInventoryBasis: fail, collectCosts: fail, getServices: fail, getResourceData: fail, getDORAMetrics: fail }, resources: { getStats: fail }, accountFindings: { getActive: fail }, costRecommendations: { findAll: fail }, coverage: fail } as unknown as BasisSources);
    const bundle = await collectEvidence(registry, { organizationId: ORG, consumer: 'test', select: { providerIds: ['test.first', 'inventory.resource_types'] }, budgetTokens: 2_000, basis });
    const cut = bundle.results.find((r) => r.id === 'inventory.resource_types')!;
    expect(cut.section).toMatchObject({ state: 'omitted', data: null, truncation: { by: 'total_budget' } });

    const none = (source: string) => collectSection<never>({ source }, async () => ({ state: 'unavailable', reason: 'not set up in this test' }));
    const context: ChatContext = {
      discovery: await none('d') as never, account: await none('a') as never,
      services: cut.section as ChatContext['services'],
      costs: chatCosts({ state: 'unavailable', source: 'unavailable', current: null, asOf: null, period: null, scope: null, topSpenders: null, costExplorer: { state: 'unavailable', reason: null }, estimateCoverage: null, comparison: { state: 'unavailable', note: null, currentWindow: null, previousWindow: null, currentWindowTotal: null, previousWindowTotal: null, changeAmount: null, changePercent: null, coverage: null, currentWindowIncludesToday: false, finishedThrough: null, asOf: null, basis: COMPARISON_BASIS } }),
      inventoryScope: { kind: 'resource_inventory', connectedAccountId: null, discoveryRegion: null },
      resources: await none('r') as never, dora: await none('dora') as never,
      evidence: evidenceBundle(),
    };
    const formatted: string = (new AIChatService({} as never) as unknown as { formatContext(c: ChatContext): string }).formatContext(context);
    const services = formatted.slice(formatted.indexOf('Services in use'), formatted.indexOf('Cost data:'));
    expect(services).toMatch(/- Status: Not included in this answer \(too large\)/);
    expect(services).toMatch(/- Data: not included in this answer \(too large\)\./);
    expect(services).not.toMatch(/Status: Available|types:/);
  });
});
