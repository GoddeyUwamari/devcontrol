/**
 * Cost trend reporting lag (trend-lag-build.md): each trend point's report
 * state comes from Cost Explorer's own evidence, not a calendar rule.
 *
 * The fixture __fixtures__/trend-lag/trend-7d-2026-11-16.json is a byte-for-byte
 * copy of production GET /api/platform/costs/trend?range=7d at 2026-11-16
 * ~11:30 UTC (review-logs/day1/evidence/, SHA-256 8b34ac10…3635; no account
 * IDs in it). The Cost Explorer stub below answers with exactly its per-day
 * SERVICE groups. Days before Nov 9 (needed by the 30d/90d/6mo ranges and the
 * month-over-month windows) are SYNTHETIC: Nov 9's real groups repeated.
 *
 * What the old rule (today minus PROVISIONAL_COST_DAYS = 2) did with it:
 * Nov 13 (8 line items, ~1 hour of EC2) and Nov 14 (no line items) were final,
 * so Nov 14 was drawn as $0.00 and both fed the month-over-month window.
 *
 * Writes __fixtures__/trend-lag/trend-7d-2026-11-16.new.json (what the new
 * backend returns for the same Cost Explorer data) for the frontend tests:
 *   TREND_LAG_FIXTURES=write npx jest trend-lag-real-evidence
 * Cost Explorer, STS and the database are stubs: no AWS, database or model call.
 */
const mockCostExplorerSend = jest.fn();

jest.mock('@aws-sdk/client-sts', () => ({
  ...jest.requireActual('@aws-sdk/client-sts'),
  STSClient: class {
    send = jest.fn(async () => ({ Credentials: { AccessKeyId: 'ASIATESTTEMP', SecretAccessKey: 'test-secret', SessionToken: 'test-session' } }));
  },
}));
jest.mock('@aws-sdk/client-cost-explorer', () => ({
  ...jest.requireActual('@aws-sdk/client-cost-explorer'),
  CostExplorerClient: class {
    send = (...args: unknown[]) => mockCostExplorerSend(...args);
  },
}));
jest.mock('../../config/database', () => ({ pool: { query: jest.fn() } }));

import * as fs from 'fs';
import * as path from 'path';
import type { Pool } from 'pg';
import awsCostService, { type CostTrendPoint, type CostTrendRange } from '../../services/aws-cost.service';
import { StatsController } from '../stats.controller';
import { AIChatContextRepository } from '../../repositories/ai-chat-context.repository';
import { AIChatService } from '../../services/ai-chat.service';
import { AISummaryService } from '../../services/ai-summary.service';
import { AIReportGeneratorService } from '../../services/ai-report-generator.service';
import { NLQueryExecutorService } from '../../services/nl-query-executor.service';
import { collectSection } from '../../services/ai-context-contract';
import { monthOverMonthSection, spendSection } from '../../services/cost-context-sections';
import { costFinishedThrough } from '../../services/cost-month-state';
import { ACCOUNT_ROW, type CeInput } from './dashboard-money-fixtures';
import * as database from '../../config/database';

const ambientPool = database.pool as unknown as { query: jest.Mock };
const ORG = ACCOUNT_ROW.org_id;
const DIR = path.join(__dirname, '__fixtures__', 'trend-lag');
const WRITE = process.env.TREND_LAG_FIXTURES === 'write';
const NOW = '2026-11-16T11:30:00.000Z';

interface EvidencePoint { date: string; total: number; lineItems: number; provisional: boolean; byService: { service: string; amount: number }[] }
const REAL: EvidencePoint[] = JSON.parse(fs.readFileSync(path.join(DIR, 'trend-7d-2026-11-16.json'), 'utf8')).data;
const REAL_BY_DAY = new Map(REAL.map((p) => [p.date, p]));
const FIRST_REAL = REAL[0].date; // 2026-11-09

const addDays = (day: string, n: number) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const nextMonthStart = (day: string) => {
  const [y, m] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
};

interface Ledger {
  /** Days after this have no groups (Cost Explorer has not reported them). Default: the evidence as captured. */
  through?: string;
  /** Days with no groups at all, whatever `through` says (a genuinely $0 account: every day). */
  empty?: (day: string) => boolean;
  /** ResultByTime.Estimated per result Start; undefined leaves the field out, as the evidence's response did not show it. */
  estimated?: (start: string, granularity: string) => boolean | undefined;
}

/** A day's SERVICE amounts: the real ones Nov 9-16, Nov 9's before that (synthetic), none past `through`. */
function servicesFor(day: string, ledger: Ledger): { service: string; amount: number }[] {
  if (ledger.empty?.(day)) return [];
  if (ledger.through !== undefined) {
    if (day > ledger.through) return [];
    const real = REAL_BY_DAY.get(day);
    return real && real.lineItems > 0 ? real.byService : REAL[0].byService;
  }
  if (day < FIRST_REAL) return REAL[0].byService;
  return REAL_BY_DAY.get(day)?.byService ?? [];
}

const group = (service: string, amount: number) => ({ Keys: [service], Metrics: { UnblendedCost: { Amount: String(amount), Unit: 'USD' } } });

function ceResponse(input: CeInput, ledger: Ledger) {
  const { Start, End } = input.TimePeriod;
  const results: Array<Record<string, unknown>> = [];
  const push = (s: string, e: string, groups: ReturnType<typeof group>[]) => {
    const est = ledger.estimated?.(s, input.Granularity);
    results.push({ TimePeriod: { Start: s, End: e }, Total: {}, Groups: groups, ...(est === undefined ? {} : { Estimated: est }) });
  };
  if (input.Granularity === 'DAILY') {
    for (let d = Start; d < End; d = addDays(d, 1)) push(d, addDays(d, 1), servicesFor(d, ledger).map((s) => group(s.service, s.amount)));
  } else {
    for (let s = Start; s < End; s = nextMonthStart(s)) {
      const e = nextMonthStart(s) < End ? nextMonthStart(s) : End;
      const sums = new Map<string, number>();
      for (let d = s; d < e; d = addDays(d, 1)) for (const x of servicesFor(d, ledger)) sums.set(x.service, (sums.get(x.service) ?? 0) + x.amount);
      push(s, e, [...sums].map(([service, amount]) => group(service, amount)));
    }
  }
  return { ResultsByTime: results, DimensionValueAttributes: [], GroupDefinitions: [{ Type: 'DIMENSION', Key: 'SERVICE' }] };
}

function clearCostCaches(): void {
  for (const key of ['monthlyCostCache', 'monthlyCostInFlight', 'costTrendCache', 'costTrendInFlight']) {
    ((awsCostService as unknown as Record<string, Map<string, unknown>>)[key]).clear();
  }
}

function useLedger(at: string, ledger: Ledger = {}): void {
  clearCostCaches();
  jest.setSystemTime(new Date(at));
  mockCostExplorerSend.mockImplementation(async (command: { input: CeInput }) => ceResponse(command.input, ledger));
}

const controller = () => new StatsController({ query: ambientPool.query } as unknown as Pool);

async function trendEndpoint(range: CostTrendRange): Promise<{ success: boolean; data: CostTrendPoint[] }> {
  const json = jest.fn();
  await controller().getCostTrend({ user: { organizationId: ORG }, query: { range } } as never, { json, status: jest.fn(() => ({ json })) } as never);
  return json.mock.calls[0][0];
}

async function costSummary(): Promise<any> {
  const json = jest.fn();
  await controller().getCostSummary({ user: { organizationId: ORG } } as never, { json, status: jest.fn(() => ({ json })) } as never);
  return json.mock.calls[0][0];
}

const byDate = (points: CostTrendPoint[]) => Object.fromEntries(points.map((p) => [p.date, p]));
const statesOf = (points: CostTrendPoint[], from: string) =>
  Object.fromEntries(points.filter((p) => p.date >= from).map((p) => [p.date, p.reportState]));
const sumTotals = (points: CostTrendPoint[], from: string, through: string) =>
  points.filter((p) => p.date >= from && p.date <= through).reduce((s, p) => s + p.total, 0);

const EVIDENCE_STATES = {
  '2026-11-09': 'final', '2026-11-10': 'final', '2026-11-11': 'final', '2026-11-12': 'final',
  '2026-11-13': 'updating',
  '2026-11-14': 'not_reported', '2026-11-15': 'not_reported', '2026-11-16': 'not_reported',
};

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask'] });
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  mockCostExplorerSend.mockReset();
  ambientPool.query.mockReset();
  ambientPool.query.mockImplementation(async (sql: string) => (/aws_resources/.test(sql) ? { rows: [{ total_resources: '0', estimated_resources: '0', total: null }] } : { rows: [ACCOUNT_ROW] }));
  jest.spyOn(AIChatContextRepository.prototype, 'gatherInventoryBasis').mockImplementation(async () => ({
    discovery: await collectSection<{ completedAt: string }>({ source: 'DevControl resource discovery runs' }, async () => ({
      state: 'available', data: { completedAt: '2026-11-16T06:00:00.000Z' }, asOf: '2026-11-16T06:00:00.000Z',
    })),
    account: await collectSection<{ accountId: string | null; region: string | null }>({ source: 'DevControl connected AWS account record' }, async () => ({
      state: 'available', data: { accountId: '123456789012', region: 'us-east-1' },
    })),
    inventoryScope: { kind: 'resource_inventory', connectedAccountId: '123456789012', discoveryRegion: 'us-east-1' },
  }));
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('the real 7d evidence (2026-11-16 ~11:30 UTC)', () => {
  it('the stub reproduces the evidence: same days, line items and totals', async () => {
    useLedger(NOW);
    const { data } = await trendEndpoint('7d');
    expect(data.map((p) => p.date)).toEqual(REAL.map((p) => p.date));
    for (const real of REAL) {
      const p = byDate(data)[real.date];
      expect(p.lineItems).toBe(real.lineItems);
      expect(p.total).toBeCloseTo(real.total, 9);
    }
  });

  it('Nov 9-12 final, Nov 13 updating, Nov 14-16 not reported; provisional derived from it; Estimated not sent -> null', async () => {
    useLedger(NOW);
    const { data } = await trendEndpoint('7d');
    expect(statesOf(data, FIRST_REAL)).toEqual(EVIDENCE_STATES);
    expect(data.map((p) => p.provisional)).toEqual([false, false, false, false, true, true, true, true]);
    expect(data.every((p) => p.estimated === null)).toBe(true);
  });

  it('the calendar rule would have called Nov 13 and Nov 14 finished: the new states do not', async () => {
    useLedger(NOW);
    expect(costFinishedThrough(new Date(NOW))).toBe('2026-11-14');
    const p = byDate((await trendEndpoint('7d')).data);
    // The production defect: Nov 13 a partial "final" low day, Nov 14 a "$0.00" final day.
    expect(p['2026-11-13'].reportState).not.toBe('final');
    expect(p['2026-11-14'].reportState).toBe('not_reported');
    expect(p['2026-11-14'].provisional).toBe(true);
  });

  it('pins what the new backend returns for this data (read by the frontend tests)', async () => {
    useLedger(NOW);
    const body = `${JSON.stringify(await trendEndpoint('7d'), null, 2)}\n`;
    const file = path.join(DIR, 'trend-7d-2026-11-16.new.json');
    if (WRITE) fs.writeFileSync(file, body);
    expect(body).toBe(fs.readFileSync(file, 'utf8'));
  });

  it.each(['30d', '90d'] as const)('%s: the same states for Nov 9-16; every earlier day is final', async (range) => {
    useLedger(NOW);
    const { data } = await trendEndpoint(range);
    expect(statesOf(data, FIRST_REAL)).toEqual(EVIDENCE_STATES);
    expect(data.filter((p) => p.date < FIRST_REAL).every((p) => p.reportState === 'final' && p.provisional === false)).toBe(true);
    expect(data.filter((p) => p.reportState === 'not_reported').map((p) => p.date)).toEqual(['2026-11-14', '2026-11-15', '2026-11-16']);
  });

  it('6mo: November (line items, still within the window) is updating; earlier months final; no month not reported', async () => {
    useLedger(NOW);
    const { data } = await trendEndpoint('6mo');
    expect(data.map((p) => [p.date, p.reportState])).toEqual([
      ['2026-06-01', 'final'], ['2026-07-01', 'final'], ['2026-08-01', 'final'],
      ['2026-09-01', 'final'], ['2026-10-01', 'final'], ['2026-11-01', 'updating'],
    ]);
  });
});

describe('month-over-month compares final days only (rule 5)', () => {
  it('real evidence: Nov 1-12 vs Oct 1-12; Nov 13 (updating) and Nov 14-16 (not reported) are on neither side', async () => {
    useLedger(NOW);
    const summary = await costSummary();
    const mom = summary.data.monthOverMonth;
    expect(mom.state).toBe('available');
    expect(mom.data.currentWindow).toEqual({ start: '2026-11-01', end: '2026-11-12' });
    expect(mom.data.previousWindow).toEqual({ start: '2026-10-01', end: '2026-10-12' });

    useLedger(NOW);
    const ninety = (await trendEndpoint('90d')).data;
    const cents = (x: number) => Math.round(x * 100) / 100;
    expect(mom.data.currentWindowTotal).toBe(cents(sumTotals(ninety, '2026-11-01', '2026-11-12')));
    expect(mom.data.previousWindowTotal).toBe(cents(sumTotals(ninety, '2026-10-01', '2026-10-12')));
    // What the calendar window (through Nov 14) would have added.
    expect(mom.data.currentWindowTotal).not.toBe(cents(sumTotals(ninety, '2026-11-01', '2026-11-14')));
    expect(mom.data.currentWindowIncludesToday).toBe(false);
  });

  it('pins the cost summary for this data (read by the frontend caption and month-over-month tests)', async () => {
    useLedger(NOW);
    const body = `${JSON.stringify(await costSummary(), null, 2)}\n`;
    const file = path.join(DIR, 'summary-2026-11-16.new.json');
    if (WRITE) fs.writeFileSync(file, body);
    expect(body).toBe(fs.readFileSync(file, 'utf8'));
  });

  it('the AI paths read the same comparison (spend + month-over-month sections)', async () => {
    useLedger(NOW);
    const { costs } = await new AIChatContextRepository({ query: ambientPool.query } as unknown as Pool).gatherCostContext(ORG);
    expect(costs.comparison.currentWindow).toEqual({ start: '2026-11-01', end: '2026-11-12' });
    const mom = await monthOverMonthSection(costs);
    expect(mom.data).toMatchObject({ currentWindow: { end: '2026-11-12' }, previousWindow: { end: '2026-10-12' } });
  });

  it('Estimated = true on an older day (Nov 5): that day is updating and the windows stop before it on both sides', async () => {
    useLedger(NOW, { estimated: (s, g) => (g === 'DAILY' && s === '2026-11-05' ? true : undefined) });
    const { data } = await trendEndpoint('30d');
    expect(byDate(data)['2026-11-05']).toMatchObject({ reportState: 'updating', estimated: true, provisional: true });
    expect(byDate(data)['2026-11-04']).toMatchObject({ reportState: 'final', estimated: null });
    useLedger(NOW, { estimated: (s, g) => (g === 'DAILY' && s === '2026-11-05' ? true : undefined) });
    const mom = (await costSummary()).data.monthOverMonth;
    expect(mom.data.currentWindow).toEqual({ start: '2026-11-01', end: '2026-11-04' });
    expect(mom.data.previousWindow).toEqual({ start: '2026-10-01', end: '2026-10-04' });
  });

  it('an updating day in the previous month (Oct 3, Estimated) is excluded on both sides too', async () => {
    useLedger(NOW, { estimated: (s, g) => (g === 'DAILY' && s === '2026-10-03' ? true : undefined) });
    const mom = (await costSummary()).data.monthOverMonth;
    expect(mom.data.currentWindow).toEqual({ start: '2026-11-01', end: '2026-11-02' });
    expect(mom.data.previousWindow).toEqual({ start: '2026-10-01', end: '2026-10-02' });
  });
});

describe('the month state carries the per-day evidence; amounts unchanged (rule 6)', () => {
  it('real evidence: reportDays 12 final / 1 updating / 3 not reported; state and month-to-date amount as before', async () => {
    useLedger(NOW);
    const spend = (await costSummary()).data.spend;
    expect(spend.data.monthState).toMatchObject({
      state: 'month_to_date',
      billedThrough: '2026-11-13',
      reportDays: { final: 12, updating: 1, notReported: 3 },
      previousMonth: { month: '2026-10', latestDaysUpdating: false },
    });
    useLedger(NOW);
    const ninety = (await trendEndpoint('90d')).data;
    // The monthly result's own total (cents), not a sum of the trend: unchanged by this build.
    expect(spend.data.amount).toBe(Math.round(sumTotals(ninety, '2026-11-01', '2026-11-16') * 100) / 100);
  });

  it('every AI path says the latest days are still updating, never that only the current day is being billed', async () => {
    useLedger(NOW);
    const out = await aiSurfaces();
    const latest = /latest days are still updating in AWS Cost Explorer/i;
    expect(out.summaryFacts.some((l) => latest.test(l))).toBe(true);
    expect(out.reportSentence).toMatch(latest);
    expect(out.chatContext.some((l) => latest.test(l))).toBe(true);
    expect(JSON.stringify(out.askAi)).toMatch(latest);
    expect(out.summaryFacts.join('\n')).not.toMatch(/current day is still being billed/);
    expect(out.reportSentence).not.toMatch(/current day is still being billed/);
  });
});

describe('edge cases', () => {
  it('a genuinely $0 account (no line items on any day) keeps real $0 days: all final, never not_reported', async () => {
    useLedger(NOW, { empty: () => true });
    for (const range of ['7d', '30d', '6mo'] as const) {
      useLedger(NOW, { empty: () => true });
      const { data } = await trendEndpoint(range);
      expect(data.length).toBeGreaterThan(0);
      expect(data.every((p) => p.reportState === 'final' && p.provisional === false && p.total === 0 && p.lineItems === 0)).toBe(true);
    }
    useLedger(NOW, { empty: () => true });
    const summary = await costSummary();
    // Day-1 behavior for a $0 account: the comparison stops at the calendar guard (today minus 2).
    expect(summary.data.monthOverMonth.data).toMatchObject({
      currentWindow: { start: '2026-11-01', end: '2026-11-14' }, currentWindowTotal: 0, previousWindowTotal: 0, changePercent: null,
    });
    expect(summary.data.spend.data.monthState.reportDays).toEqual({ final: 16, updating: 0, notReported: 0 });
  });

  it('today has line items: today is updating, yesterday final, nothing not reported', async () => {
    useLedger(NOW, { through: '2026-11-16' });
    const { data } = await trendEndpoint('7d');
    expect(statesOf(data, '2026-11-14')).toEqual({ '2026-11-14': 'final', '2026-11-15': 'final', '2026-11-16': 'updating' });
    expect(data.some((p) => p.reportState === 'not_reported')).toBe(false);
  });

  it('the most recent day with line items 4 days back is final (outside today-3 .. today); the days after it are not reported', async () => {
    useLedger(NOW, { through: '2026-11-12' });
    const { data } = await trendEndpoint('7d');
    expect(statesOf(data, '2026-11-11')).toEqual({
      '2026-11-11': 'final', '2026-11-12': 'final',
      '2026-11-13': 'not_reported', '2026-11-14': 'not_reported', '2026-11-15': 'not_reported', '2026-11-16': 'not_reported',
    });
  });
});

describe('month boundary (Dec 1-3): Day-1 behavior kept', () => {
  it('Dec 1 00:30, nothing for December: no billed days yet; no comparison; Dec 1 a gap, Nov 30 still updating', async () => {
    useLedger('2026-12-01T00:30:00.000Z', { through: '2026-11-30' });
    const summary = await costSummary();
    expect(summary.data.spend.data.monthState).toMatchObject({ state: 'no_billed_days_yet', amount: null, reportDays: { final: 0, updating: 0, notReported: 1 } });
    expect(summary.data.monthOverMonth.state).toBe('unavailable');
    // The same section as Day-1's pinned d1_0030 summary.
    expect(summary.data.monthOverMonth.reason).toBe('cannot be calculated: AWS Cost Explorer daily trend: not available');
    useLedger('2026-12-01T00:30:00.000Z', { through: '2026-11-30' });
    const { costs } = await new AIChatContextRepository({ query: ambientPool.query } as unknown as Pool).gatherCostContext(ORG);
    expect(costs.comparison.note).toMatch(/^no day of this month has finished reporting/);
    useLedger('2026-12-01T00:30:00.000Z', { through: '2026-11-30' });
    const p = byDate((await trendEndpoint('7d')).data);
    expect([p['2026-11-29'].reportState, p['2026-11-30'].reportState, p['2026-12-01'].reportState]).toEqual(['final', 'updating', 'not_reported']);
    useLedger('2026-12-01T00:30:00.000Z', { through: '2026-11-30' });
    const months = (await trendEndpoint('6mo')).data;
    expect(months.slice(-2).map((m) => [m.date, m.reportState, m.provisional])).toEqual([['2026-11-01', 'updating', true], ['2026-12-01', 'not_reported', true]]);
  });

  it('Dec 2 18:00, Dec 1 has charges: latest days still updating; no comparison', async () => {
    useLedger('2026-12-02T18:00:00.000Z', { through: '2026-12-01' });
    const summary = await costSummary();
    expect(summary.data.spend.data.monthState).toMatchObject({ state: 'latest_days_updating', reportDays: { final: 0, updating: 1, notReported: 1 } });
    expect(summary.data.monthOverMonth.state).toBe('unavailable');
  });

  it('Dec 3 00:30, Dec 1-2 charged: month to date; Dec 1 vs Nov 1 as on Day-1; Dec 2 updating', async () => {
    useLedger('2026-12-03T00:30:00.000Z', { through: '2026-12-02' });
    const summary = await costSummary();
    expect(summary.data.spend.data.monthState).toMatchObject({ state: 'month_to_date', reportDays: { final: 1, updating: 1, notReported: 1 } });
    expect(summary.data.monthOverMonth.data).toMatchObject({ currentWindow: { start: '2026-12-01', end: '2026-12-01' }, previousWindow: { start: '2026-11-01', end: '2026-11-01' } });
  });
});

/** Every AI surface's cost output (as day1-month-baseline.test.ts reads them). */
async function aiSurfaces() {
  const unavailable = { state: 'unavailable', data: null, reason: 'fixture', source: 'fixture', provenance: null, asOf: null, coverage: null };
  const pool = { query: ambientPool.query } as unknown as Pool;
  const { costs } = await new AIChatContextRepository(pool).gatherCostContext(ORG);
  const spend = await spendSection(costs);
  const mom = await monthOverMonthSection(costs);
  const sections = new Proxy({ spend, monthOverMonth: mom } as Record<string, unknown>, { get: (t, k: string) => (k in t ? t[k] : unavailable) });
  const summaryFacts: string[] = new AISummaryService().buildFactLines(sections as never).filter((l: string) => /spend|month-over-month|Month-over-month/i.test(l));
  const chat = new AIChatService(pool) as unknown as { formatCostSection: (c: unknown) => string };
  const reportSentence: string = (new AIReportGeneratorService(pool) as unknown as { spendSentence: (s: unknown) => string }).spendSentence(spend);
  const askAi = await (new NLQueryExecutorService(pool) as unknown as { queryCosts: (o: string) => Promise<unknown> }).queryCosts(ORG);
  return { summaryFacts, chatContext: chat.formatCostSection(costs).split('\n'), reportSentence, askAi };
}
