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
import { budgetBandOf, dataTokens } from '../budget';
import { collectEvidence, EvidenceRegistry } from '../registry';
import { createEvidenceBasis, type BasisSources } from '../basis';
import { AISummaryService, SUMMARY_EVIDENCE_BUDGET_TOKENS, SUMMARY_FACT_PROVIDERS, SUMMARY_PROVIDERS } from '../../../ai-summary.service';
import { AIInsightsService } from '../../../ai-insights.service';
import { AIReportGeneratorService } from '../../../ai-report-generator.service';
import { AIChatService, type ChatContext } from '../../../ai-chat.service';
import { chatCosts, evidenceBundle } from '../../../__tests__/chat-context-fixtures';
import { CHAT_FORMATTED_PROVIDERS, COMPARISON_BASIS } from '../../../ai-chat.service';

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
      activeIdleEstimates: items.filter((i) => i.issue.startsWith('Idle')).length,
      items,
    },
    untrusted: items.map((i) => ({ field: `${i.ref} resource name`, text: `fixture-web-server-${i.ref}` })),
  }));
}

/**
 * Every provider stubbed: cost.findings returns `n` findings, any provider in
 * `extra` returns its section, the rest are not_built.
 */
function stubProviders(n: number, extra: Record<string, () => Promise<ContextSection<unknown>>> = {}) {
  for (const p of defaultEvidenceRegistry().list()) {
    jest.spyOn(p, 'collect').mockImplementation(async () =>
      (extra[p.id] ? extra[p.id]() : p.id === 'cost.findings' ? costFindingsSection(n) : notBuilt({ source: p.source }, 'stubbed in this test')) as never);
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
    // All 25 are idle, so the 5 listed are the top 5 of 25 (re-review 2 M3).
    expect(generated.costAnalysis?.recommendations).toEqual([
      'Review the top 5 of 25 recommendations for idle or unused resources (estimated potential savings of $72.50/month for these 5; a DevControl estimate, not realized savings).',
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
      // The prompt header lists the omitted state with its meaning.
      expect(prompt).toContain('/ not_built / omitted; omitted means the section had data but it was not included in this answer because of its size, never that it is zero, none, or not available), whether');
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

// ---------------------------------------------------------------------------
// Re-review 2 (H2, I5, M3, L8): realistic organization data through the real
// summary code. Every status/fact section is filled into the budget before the
// list sections, so no status fact is ever "omitted".
// ---------------------------------------------------------------------------

const ACCOUNT = '123456789012';
/** The 17 regions AWS enables by default. */
const DEFAULT_REGIONS = [
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2', 'ap-south-1', 'ap-northeast-1', 'ap-northeast-2', 'ap-northeast-3',
  'ap-southeast-1', 'ap-southeast-2', 'ca-central-1', 'eu-central-1', 'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-north-1', 'sa-east-1',
];
const SCANNED_AT = '2026-11-07T06:10:00.000Z';

/** Realistic sections for every summary provider except cost.findings (sized by `n`). */
function realisticSummarySections(): Record<string, () => Promise<ContextSection<unknown>>> {
  const now = () => new Date().toISOString();
  const section = <T>(meta: Parameters<typeof collectSection<T>>[0], data: T, extra: Record<string, unknown> = {}) =>
    () => collectSection<T>(meta, async () => ({ state: 'available', asOf: SCANNED_AT, data, ...extra })) as Promise<ContextSection<unknown>>;
  return {
    'connection.scope': section({ source: 'DevControl AWS connection', classification: 'configured', scope: { kind: 'account_level', connectedAccountId: ACCOUNT } },
      { connected: true, connectedAccountId: ACCOUNT, connectionStatus: 'connected', homeRegion: 'us-east-1', accountsRead: 1 }),
    'coverage.regions': section({
      source: 'DevControl region coverage', classification: 'measured',
      scope: { kind: 'aws_account_regions', connectedAccountId: ACCOUNT, homeRegion: 'us-east-1', regions: DEFAULT_REGIONS.map((region, i) => ({ region, status: i === 0 ? 'succeeded' : 'never_scanned' })) },
    }, {
      homeRegion: 'us-east-1',
      scanScope: { homeRegionTypes: 'all inventoried types', s3: 'account-wide', cloudfront: 'global' },
      enabledRegions: { known: true, count: 17, listedAt: SCANNED_AT },
      scanInProgress: false,
      lastSuccessfulScanAt: SCANNED_AT,
      items: DEFAULT_REGIONS.map((region, i) => ({ ref: `g${i + 1}`, region, home: i === 0, status: i === 0 ? 'succeeded' : 'never_scanned', lastScanFinishedAt: i === 0 ? SCANNED_AT : null, lastSuccessAt: i === 0 ? SCANNED_AT : null, lastErrorCode: null, stale: false })),
    }),
    'system.intelligence': section({ source: 'DevControl System Intelligence', classification: 'calculated' },
      { score: 72, cost: 80, security: 64, observability: 70, observabilityState: 'available' }),
    'security.posture_counts': section({ source: 'DevControl security posture', classification: 'calculated' },
      { score: 64, combinedFindings: 9, urgentFindings: 4, accountUrgentFindings: 2 }),
    'security.top_risk': section({ source: 'DevControl account security findings', classification: 'measured' },
      { count: 3, top: { ref: 'top', severity: 'high' }, reviewedUrgent: 0 },
      { untrusted: [{ field: 'top title', text: 'Security group sg-0a1b2c3d allows SSH from 0.0.0.0/0' }] }),
    'security.evaluation_status': section({ source: 'DevControl security evaluation runs (resource checks, security groups, IAM)', classification: 'measured' }, { current: true }),
    'security.config_checks': section({ source: 'DevControl configuration checks', classification: 'measured' }, {
      outcome: 'found', resourcesEvaluated: 48, resourcesWithFindings: 6,
      findingsBySeverity: { critical: 0, high: 2, medium: 3, low: 1 },
      byCategory: [
        { category: 'encryption', findings: 3, highestSeverity: 'high', resourceTypes: ['S3', 'EBS'] },
        { category: 'backups', findings: 2, highestSeverity: 'medium', resourceTypes: ['RDS'] },
        { category: 'tagging', findings: 1, highestSeverity: 'low', resourceTypes: ['EC2'] },
      ],
    }),
    'security.risk_score': section({ source: 'DevControl risk score', classification: 'calculated' }, {
      score: 68, grade: 'C', factors: { compliance: 70, exposure: 62, encryption: 75 }, trend: 'stable', trendPoints: 30,
      items: Array.from({ length: 30 }, (_, i) => ({ ref: `h${i + 1}`, date: `2026-10-${String(i + 1).padStart(2, '0')}`, score: 66 + (i % 4) })),
    }),
    'compliance.framework_evaluations': section({ source: 'DevControl framework evaluations', classification: 'measured' }, {
      outcome: 'found',
      items: ['cis-aws-1.5', 'soc2', 'hipaa'].map((framework, i) => ({
        ref: `w${i + 1}`, framework, applicability: 'enabled', runStatus: 'complete', finishedAt: SCANNED_AT, aged: false, running: false, lastAttemptFailed: false,
        checksByState: { failed: 4 + i, passed: 30 - i, unable_to_evaluate: 2 }, failedBySeverity: { high: 1, medium: 2 + i, low: 1 }, staleChecks: 0,
      })),
    }),
    'cost.spend': section({ source: 'AWS Cost Explorer', classification: 'billed', period: { kind: 'range', start: '2026-11-01', endExclusive: '2026-11-08' } }, {
      amount: 1843.27, basis: 'billed_month_to_date', lastDayInProgress: true, finishedThrough: '2026-11-05',
      topServices: [
        { service: 'Amazon Elastic Compute Cloud - Compute', amount: 812.4, sharePercent: 44.1 },
        { service: 'Amazon Relational Database Service', amount: 401.88, sharePercent: 21.8 },
        { service: 'Amazon Simple Storage Service', amount: 188.02, sharePercent: 10.2 },
        { service: 'Amazon CloudFront', amount: 97.5, sharePercent: 5.3 },
        { service: 'AWS Lambda', amount: 41.12, sharePercent: 2.2 },
      ],
    }),
    'cost.month_over_month': section({ source: 'DevControl month-over-month comparison', classification: 'billed' }, {
      currentWindow: { start: '2026-11-01', end: '2026-11-05' }, previousWindow: { start: '2026-10-01', end: '2026-10-05' },
      currentWindowTotal: 1320.55, previousWindowTotal: 1288.1, changeAmount: 32.45, changePercent: 2.5, currentWindowIncludesToday: false, basis: 'finished days only',
    }),
    // A current alarm read (the provider's freshness rule): 2 alarms in ALARM.
    'ops.cloudwatch_alarms': () => collectSection({ source: 'Amazon CloudWatch alarms', classification: 'measured', scope: { kind: 'aws_account_region', connectedAccountId: ACCOUNT, region: 'us-east-1' } }, async () => ({
      state: 'available' as const, asOf: now(),
      data: {
        outcome: 'found', inAlarmCount: 2, inAlarmComplete: true, configuredCount: 14, configuredCountComplete: true,
        items: [
          { ref: 'a1', type: 'metric', namespace: 'AWS/EC2', metric: 'CPUUtilization', comparison: 'GreaterThanThreshold', threshold: 80, inAlarmSince: SCANNED_AT, resourceType: 'EC2' },
          { ref: 'a2', type: 'metric', namespace: 'AWS/RDS', metric: 'FreeStorageSpace', comparison: 'LessThanThreshold', threshold: 5_000_000_000, inAlarmSince: SCANNED_AT, resourceType: 'RDS' },
        ],
      },
      untrusted: [{ field: 'a1 name', text: 'prod-web-high-cpu' }, { field: 'a2 name', text: 'prod-db-low-storage' }],
    })) as Promise<ContextSection<unknown>>,
  };
}

/** The summary providers a consumer formats as a fact line (status sections): never omitted. */
const SUMMARY_STATUS = SUMMARY_PROVIDERS.filter((id) => budgetBandOf(defaultEvidenceRegistry().list().find((p) => p.id === id)) === 'fact');

async function summaryRun() {
  let prompt = '';
  jest.spyOn(AIInsightsService.prototype, 'summarizeDashboard').mockImplementation(async (p: string) => {
    prompt = p;
    return { fields: null, source: 'facts_only' };
  });
  const result = await new AISummaryService().getSummary(ORG);
  const bundle = await collectEvidence(defaultEvidenceRegistry(), { organizationId: ORG, consumer: 'test', select: { providerIds: [...SUMMARY_PROVIDERS] }, budgetTokens: SUMMARY_EVIDENCE_BUDGET_TOKENS });
  return { prompt, result, bundle };
}

describe('re-review 2 H2: status sections are filled before lists in one budget', () => {
  it('every section a consumer formats as a fact line is in the fact band; the large lists are in the list band', () => {
    const band = (id: string) => budgetBandOf(defaultEvidenceRegistry().list().find((p) => p.id === id));
    for (const id of [...SUMMARY_FACT_PROVIDERS, ...CHAT_FORMATTED_PROVIDERS, 'security.top_risk', 'security.evaluation_status', 'system.intelligence', 'ops.cloudwatch_alarms']) {
      expect([id, band(id)]).toEqual([id, 'fact']);
    }
    for (const id of ['cost.findings', 'coverage.regions']) expect([id, band(id)]).toEqual([id, 'list']);
  });

  it('realistic data (17 regions, 2 alarms in ALARM, 25 cost findings): System Status, Top Risk, the security and health lines are present', async () => {
    stubProviders(25, realisticSummarySections());
    const { prompt, result, bundle } = await summaryRun();
    const lines = prompt.split('\n');
    const line = (start: string) => lines.find((l) => l.startsWith(start)) ?? '(missing)';
    const omitted = bundle.results.filter((r) => r.section.state === 'omitted').map((r) => r.id);
    console.info([
      '[H2 guard, 25 findings]',
      `systemStatus: ${result.systemStatus}`,
      `topRisk: ${result.topRisk} (${result.topRiskStatus})`,
      `fact: ${line('- Composite System Intelligence score')}`,
      `fact: ${line('- Security posture score')}`,
      `fact: ${line('- Top active finding')}`,
      `fact: ${line('- 25 active cost optimizations')}`,
      `budget: used ${bundle.budget.usedTokens} of ${bundle.budget.totalTokens}; modes ${bundle.results.filter((r) => r.selected).map((r) => `${r.id}=${r.mode}`).join(', ')}`,
      `omitted: ${omitted.join(', ') || '(none)'}`,
    ].join('\n'));

    expect(result.systemStatus).toMatch(/^2 CloudWatch alarms are in ALARM in us-east-1 as of \S+\. See Operational Health for details\.$/);
    expect(result.topRiskStatus).toBe('identified');
    expect(result.topRisk).toBe('Security group sg-0a1b2c3d allows SSH from 0.0.0.0/0 (high severity)');
    expect(line('- Composite System Intelligence score')).toMatch(/^- Composite System Intelligence score: 72\/100/);
    expect(line('- Security posture score')).toMatch(/^- Security posture score: 64\/100/);
    expect(line('- 25 active cost optimizations')).not.toBe('(missing)');
    // Lists may be shortened or left out; no fact line is.
    expect(prompt).not.toMatch(/^- (Security findings|Cost recommendations|Cloud spend|Month-over-month change): not included/m);
    for (const id of SUMMARY_STATUS) {
      const r = bundle.results.find((x) => x.id === id)!;
      expect([id, r.section.state]).toEqual([id, 'available']);
    }
    expect(bundle.budget.usedTokens).toBeLessThanOrEqual(SUMMARY_EVIDENCE_BUDGET_TOKENS);
  });

  it('0 to 25 cost findings: no status section is omitted at any size', async () => {
    const rows: string[] = [];
    for (let n = 0; n <= 25; n += 1) {
      jest.restoreAllMocks();
      jest.spyOn(console, 'log').mockImplementation(() => undefined);
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      stubProviders(n, realisticSummarySections());
      const { prompt, result, bundle } = await summaryRun();
      // The cost list is shortened before it is cut: the summary's cost line keeps its counts.
      expect([n, /Cost recommendations: not included in this answer/.test(prompt)]).toEqual([n, false]);
      const statusOmitted = SUMMARY_STATUS.filter((id) => bundle.results.find((r) => r.id === id)!.section.state !== 'available');
      const findings = bundle.results.find((r) => r.id === 'cost.findings')!;
      rows.push(`n=${n}: status not available ${statusOmitted.join(',') || 'none'}; cost.findings ${findings.mode}${findings.section.truncation ? ` ${findings.section.truncation.kept}/${findings.section.truncation.total}` : ''}; topRisk ${result.topRiskStatus}; used ${bundle.budget.usedTokens}`);
      expect([n, statusOmitted]).toEqual([n, []]);
      expect([n, (result.systemStatus ?? "").startsWith('2 CloudWatch alarms are in ALARM')]).toEqual([n, true]);
      expect([n, result.topRiskStatus]).toEqual([n, 'identified']);
      expect(bundle.budget.usedTokens).toBeLessThanOrEqual(SUMMARY_EVIDENCE_BUDGET_TOKENS);
    }
    console.info(`[H2 guard, 0-25 findings]\n${rows.join('\n')}`);
  });
});

describe('re-review 2 L8 / I5: a section without data is never cut by the total budget, and respects it', () => {
  it('a no-data section after the budget is spent keeps its state and reason, and the total is not exceeded', async () => {
    const big = {
      id: 'test.big', version: 1, title: 'Big', source: 'big source', dataSourceIds: ['S4'], topics: ['inventory' as const], priority: 1 as const, maxTokens: 100_000,
      collect: async () => collectSection<string[]>({ source: 'big source' }, async () => ({ state: 'available', data: Array.from({ length: 200 }, (_, i) => `entry-${i}`) })),
    };
    const none = {
      id: 'test.none', version: 1, title: 'None', source: 'none source', dataSourceIds: ['S4'], topics: ['inventory' as const], priority: 2 as const, maxTokens: 100_000,
      collect: async () => collectSection<string[]>({ source: 'none source' }, async () => ({ state: 'unavailable', reason: 'not set up for this account' })),
    };
    const registry = new EvidenceRegistry().register(big).register(none);
    const fail = async () => { throw new Error('unused'); };
    const basis = createEvidenceBasis(ORG, { context: { gatherInventoryBasis: fail, collectCosts: fail, getServices: fail, getResourceData: fail, getDORAMetrics: fail }, resources: { getStats: fail }, accountFindings: { getActive: fail }, costRecommendations: { findAll: fail }, coverage: fail } as unknown as BasisSources);
    // The lines alone (2 x 60) exceed this budget, so every block is over it.
    const bundle = await collectEvidence(registry, { organizationId: ORG, consumer: 'test', select: { providerIds: ['test.big', 'test.none'] }, budgetTokens: 100, basis });
    expect(bundle.results.find((r) => r.id === 'test.big')!.section).toMatchObject({ state: 'omitted', truncation: { by: 'total_budget' } });
    expect(bundle.results.find((r) => r.id === 'test.none')!.section).toMatchObject({ state: 'unavailable', reason: 'not set up for this account', truncation: null });
    expect(bundle.budget.usedTokens).toBe(120); // the two lines only: the no-data block is not added over the total
  });
});

describe('re-review 2 M3: the report idle figures say when they are a top-N subset', () => {
  /** 25 findings, highest savings first: 13 idle worth $494/month in total, 12 rightsizing ones in between. */
  function mixedItems(): CostFindingItem[] {
    const idle = Array.from({ length: 13 }, (_, i) => 50 - 2 * i); // 50, 48, ... 26: $494
    const other = [60, 49, 47, 45, 43, 41, 39, 37, 35, 33, 31, 29];
    const all = [...idle.map((v) => ({ v, idle: true })), ...other.map((v) => ({ v, idle: false }))].sort((a, b) => b.v - a.v);
    return all.map((x, i) => ({
      ...findingItems(25)[i],
      resourceType: x.idle ? 'EC2' : 'RDS',
      issue: x.idle ? 'Idle EC2 Instance' : 'Oversized RDS Instance',
      estimatedMonthlySavings: x.v,
      cpuEvidence: x.idle ? findingItems(1)[0].cpuEvidence : null,
    }));
  }

  it('25 findings, 13 idle worth $494/month: "the top 5 of 13 recommendations for idle or unused resources", savings for those 5', async () => {
    const items = mixedItems();
    expect(items.filter((i) => i.issue.startsWith('Idle')).reduce((sum, i) => sum + i.estimatedMonthlySavings, 0)).toBe(494);
    stubProviders(25, {
      'cost.findings': () => collectSection<CostFindingsEvidence>({ source: 'DevControl cost findings', classification: 'estimated' }, async () => ({
        state: 'available', asOf: SCANNED_AT,
        data: { outcome: 'found', lifecycle: { active: 25, resolved: 0, dismissed: 0 }, activeBySeverity: { high: 0, medium: 25, low: 0 }, totalEstimatedMonthlySavings: items.reduce((s, i) => s + i.estimatedMonthlySavings, 0), totalSavingsCeiling: 0, activeIdleEstimates: 13, items },
      })) as Promise<ContextSection<unknown>>,
    });
    const { data, generated } = await report();
    console.info(`[M3] report fallback: ${JSON.stringify(generated.costAnalysis?.recommendations)} | highlight: ${generated.keyHighlights.find((h) => h.includes('idle'))} | top: ${JSON.stringify(generated.topRecommendations.find((r) => r.title === 'Review idle or unused resources'))}`);
    expect(data.sections.idleResourceRecommendations).toMatchObject({ state: 'available', data: { activeIdle: 13, totalEstimatedMonthlySavings: 230 } });
    expect(generated.costAnalysis?.recommendations).toEqual([
      'Review the top 5 of 13 recommendations for idle or unused resources (estimated potential savings of $230.00/month for these 5; a DevControl estimate, not realized savings).',
    ]);
    expect(generated.keyHighlights).toContain('Estimated potential savings of $230.00/month from the top 5 of 13 recommendations for idle or unused resources (a DevControl estimate, not realized savings).');
    expect(generated.topRecommendations.find((r) => r.title === 'Review idle or unused resources')).toMatchObject({
      description: 'The top 5 of 13 recommendations flag idle or unused resources; the savings figure covers these 5. Savings are DevControl estimates, not realized savings.',
      estimatedSavings: 230,
    });
  });
});
