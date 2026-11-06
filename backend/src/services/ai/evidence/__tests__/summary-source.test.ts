/**
 * AI truth PR 1 review L4, fixed in PR 2: the Dashboard summary records who
 * wrote it (ai_written / facts_only / ai_unavailable) and is never shown as
 * fresh AI output when it isn't; and the summary cache misses whenever a
 * loaded section's state, data, asOf, reason or untrusted text changes --
 * tested directly, not through one regeneration test. No database or model.
 */
import { collectSection, type ContextSection } from '../../../ai-context-contract';
import { AISummaryService, type DashboardSections } from '../../../ai-summary.service';
import { AIInsightsService, type SummarySource } from '../../../ai-insights.service';
import type { EvidenceBundle, ProviderResult } from '../types';

const ORG = '00000000-0000-4000-8000-0000000000d4';
const FIELDS = { overallHealth: { score: 80, context: 'steady' }, topRisk: 'model text', cloudSpend: 'model text', systemStatus: 'model text' };

async function available<T>(source: string, data: T, extra: Partial<ContextSection<T>> = {}): Promise<ContextSection<T>> {
  const s = await collectSection<T>({ source }, async () => ({ state: 'available', data }));
  return { ...s, ...extra };
}

function result(id: string, section: ContextSection<unknown>, mode: ProviderResult['mode'] = 'loaded', fingerprint: 'full' | 'state_and_data' = 'full'): ProviderResult {
  return { id, version: 1, title: id, topics: ['ops'], priority: 1, fingerprint, section, selected: mode !== 'header', mode };
}

interface World {
  findings: ContextSection<unknown>;
  alarms: ContextSection<unknown>;
  telemetry: ContextSection<unknown>;
}

async function world(): Promise<World> {
  return {
    findings: await available('DevControl cost findings', { active: 2 }, { asOf: '2026-11-06T06:00:00.000Z', reason: 'r1' }),
    alarms: await available('Amazon CloudWatch alarms', { inAlarmCount: 0, inAlarmComplete: true, configuredCount: 3, configuredCountComplete: true, outcome: 'none_found', items: [] }, {
      asOf: '2026-11-06T11:59:00.000Z', scope: { kind: 'aws_account_region', connectedAccountId: null, region: 'us-east-1' },
    }),
    telemetry: await available('CPU', { cpuPercent: 3 }, { asOf: '2026-11-06T11:58:00.000Z' }),
  };
}

let current: World;
let summarize: jest.SpyInstance;

async function sectionsFor(w: World): Promise<DashboardSections> {
  const none = (source: string) => collectSection<never>({ source }, async () => ({ state: 'unavailable', reason: 'not set up in this test' }));
  return {
    systemScore: await none('DevControl System Intelligence score') as never,
    securityPosture: await none('DevControl security posture score') as never,
    accountFindings: await none('DevControl account-level security findings (security groups, IAM)') as never,
    securityEvaluation: await none('DevControl security evaluation runs') as never,
    recommendations: await none('DevControl cost recommendations') as never,
    spend: await none('AWS Cost Explorer') as never,
    monthOverMonth: await none('DevControl month-over-month comparison') as never,
    monitoring: w.alarms as never,
  };
}

function bundleFor(w: World): EvidenceBundle {
  return {
    organizationId: ORG, retrievedAt: new Date().toISOString(), topics: [], budget: { totalTokens: 6000, usedTokens: 0 },
    results: [
      result('cost.findings', w.findings),
      result('ops.cloudwatch_alarms', w.alarms, 'loaded', 'state_and_data'),
      result('telemetry.cpu', w.telemetry, 'header'),
    ],
  };
}

function useModel(source: SummarySource) {
  summarize.mockResolvedValue({ fields: source === 'ai_written' ? FIELDS : null, source });
}

beforeEach(async () => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  current = await world();
  jest.spyOn(AISummaryService.prototype, 'gatherEvidence').mockImplementation(async () => ({ sections: await sectionsFor(current), evidence: bundleFor(current) }));
  summarize = jest.spyOn(AIInsightsService.prototype, 'summarizeDashboard');
  useModel('ai_written');
});
afterEach(() => jest.restoreAllMocks());

describe('who wrote the summary (L4)', () => {
  it('ai_written: the model\'s prose, with aiGeneratedAt equal to the time it was written', async () => {
    const r = await new AISummaryService().getSummary(ORG);
    expect(r.summarySource).toBe('ai_written');
    expect(r.aiGeneratedAt).toBe(r.generatedAt);
    expect(r.overallHealth.context).toBe('steady');
  });

  it.each(['facts_only', 'ai_unavailable'] as const)('%s: deterministic fields only, aiGeneratedAt null -- also on a cache hit later', async (source) => {
    useModel(source);
    const service = new AISummaryService();
    const first = await service.getSummary(ORG);
    expect(first).toMatchObject({ summarySource: source, aiGeneratedAt: null, overallHealth: { score: null, context: null }, cloudSpend: null });

    const later = await service.getSummary(ORG);
    expect(summarize).toHaveBeenCalledTimes(1); // served from the cache...
    expect(later).toMatchObject({ summarySource: source, aiGeneratedAt: null, generatedAt: first.generatedAt }); // ...and never presented as fresh AI output
  });

  it('a whole-summary failure is ai_unavailable and not cached', async () => {
    (AISummaryService.prototype.gatherEvidence as jest.Mock).mockRejectedValueOnce(new Error('boom'));
    const r = await new AISummaryService().getSummary(ORG);
    expect(r).toMatchObject({ summarySource: 'ai_unavailable', aiGeneratedAt: null, topRiskStatus: 'unavailable' });
  });

  it('System Status is never the model\'s, and is recomputed on every request, cache hit or not', async () => {
    const service = new AISummaryService();
    const first = await service.getSummary(ORG);
    expect(first.systemStatus).toBe('No CloudWatch alarms are in ALARM in us-east-1 as of 2026-11-06T11:59:00.000Z. See Operational Health for details.');
    current.alarms = { ...current.alarms, asOf: '2026-11-06T12:00:00.000Z' }; // a live re-read: same state and data
    const second = await service.getSummary(ORG);
    expect(summarize).toHaveBeenCalledTimes(1);
    expect(second.systemStatus).toBe('No CloudWatch alarms are in ALARM in us-east-1 as of 2026-11-06T12:00:00.000Z. See Operational Health for details.');
  });
});

describe('the summary cache misses on any change in a loaded section (direct invalidation, L4)', () => {
  const changes: Array<[string, (w: World) => void, boolean]> = [
    ['nothing', () => undefined, false],
    ['a loaded section\'s state', (w) => { w.findings = { ...w.findings, state: 'partial' }; }, true],
    ['a loaded section\'s data', (w) => { w.findings = { ...w.findings, data: { active: 3 } }; }, true],
    ['a loaded section\'s asOf', (w) => { w.findings = { ...w.findings, asOf: '2026-11-06T07:00:00.000Z' }; }, true],
    ['a loaded section\'s reason', (w) => { w.findings = { ...w.findings, reason: 'r2' }; }, true],
    ['a loaded section\'s untrusted text', (w) => { w.findings = { ...w.findings, untrusted: [{ field: 'c1 resource name', text: 'renamed' }] }; }, true],
    ['only the retrievedAt of a section', (w) => { w.findings = { ...w.findings, retrievedAt: '2030-01-01T00:00:00.000Z' }; }, false],
    ['only the asOf of a live (state_and_data) section', (w) => { w.alarms = { ...w.alarms, asOf: '2026-11-06T12:00:30.000Z' }; }, false],
    ['a live section\'s data', (w) => { w.alarms = { ...w.alarms, data: { ...(w.alarms.data as object), inAlarmCount: 1, outcome: 'found' } }; }, true],
    ['a header-only section\'s data', (w) => { w.telemetry = { ...w.telemetry, data: { cpuPercent: 99 }, asOf: '2026-11-06T12:00:00.000Z' }; }, false],
    ['a header-only section\'s state', (w) => { w.telemetry = { ...w.telemetry, state: 'error', data: null }; }, true],
  ];

  it.each(changes)('%s -> regenerated: %s', async (_label, change, regenerates) => {
    const service = new AISummaryService();
    await service.getSummary(ORG);
    change(current);
    await service.getSummary(ORG);
    expect(summarize).toHaveBeenCalledTimes(regenerates ? 2 : 1);
  });

  it('is per organization: another organization never hits this one\'s entry', async () => {
    const service = new AISummaryService();
    await service.getSummary(ORG);
    await service.getSummary('00000000-0000-4000-8000-0000000000e5');
    expect(summarize).toHaveBeenCalledTimes(2);
  });
});
