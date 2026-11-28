/**
 * PR B1: the month-over-month comparison ("% vs same days last month" on the
 * Dashboard spend tile and Costs page, AI chat, AI summary, AI reports) sums
 * each finished day's real net -- the unclamped Σ byService[].amount
 * (trendPointNet / netTotal) -- never the point's `total` (the sum of $0-floored
 * categories). Only the source of the amounts changed: the date windows, the
 * finished-days-only rule, the coverage threshold and the not-reported /
 * updating handling are as before. A compared day without byService (an older
 * cache entry) makes the comparison unavailable; the clamped total is never
 * used in its place.
 *
 * No DB and no AWS: Cost Explorer calls are mocked and the pool is a fixture.
 * Figures are fixtures, not production data.
 */
import { Pool } from 'pg';
import { Request, Response } from 'express';
import { AIChatContextRepository } from '../ai-chat-context.repository';
import { AIChatService, COMPARISON_BASIS } from '../../services/ai-chat.service';
import { StatsController } from '../../controllers/stats.controller';
import awsCostService, { type CostTrendPoint } from '../../services/aws-cost.service';
import type { CostReportState } from '../../services/cost-trend-report-state';

const ORG_ID = '00000000-0000-0000-0000-0000000000b1';
const NOW = new Date('2026-10-15T12:00:00.000Z'); // finished through Oct 13: Oct 1-13 vs Sep 1-13

const repo = new AIChatContextRepository({} as Pool);
const chat = new AIChatService({} as Pool);
const compare = (points: unknown[]) => (repo as any).computeMonthOverMonthComparison(points, null, NOW);
const formatted = (comparison: unknown, mtd?: number) => (chat as any).formatComparisonSection(comparison, mtd) as string;

type Amounts = Array<[string, number]>;

/** A trend point as queryCostTrend builds it: `total` is the $0-floored figure, byService the real amounts. */
function point(date: string, amounts: Amounts | null, reportState: CostReportState = 'final'): Record<string, unknown> {
  const floored = amounts ? amounts.reduce((s, [, a]) => s + Math.max(0, a), 0) : 0;
  return {
    date, compute: floored, storage: 0, database: 0, network: 0, other: 0, total: floored,
    ...(amounts ? { byService: amounts.map(([service, amount]) => ({ service, amount })) } : {}),
    lineItems: amounts?.length ?? 0, reportState,
  };
}

const iso = (m: number, d: number) => `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Sep 1-30 and Oct 1-15 (Oct 14-15 updating, as the real trend has them). */
function series(oct: (day: number) => Amounts | null, sep: (day: number) => Amounts | null = () => [['AWS Lambda', 8]]) {
  const points: Record<string, unknown>[] = [];
  for (let d = 1; d <= 30; d++) points.push(point(iso(9, d), sep(d)));
  for (let d = 1; d <= 15; d++) points.push(point(iso(10, d), oct(d), d >= 14 ? 'updating' : 'final'));
  return points;
}

describe('B1: the comparison sums the real net of each finished day', () => {
  it('positive-only data behaves exactly as before: $130.00 vs $104.00, +$26.00, +25%', () => {
    const c = compare(series(() => [['AWS Lambda', 10]]));
    expect(c).toMatchObject({
      state: 'available',
      currentWindow: { start: '2026-10-01', end: '2026-10-13' },
      previousWindow: { start: '2026-09-01', end: '2026-09-13' },
      currentWindowTotal: 130, previousWindowTotal: 104, changeAmount: 26, changePercent: 25,
      coverage: { currentDays: 13, previousDays: 13, expectedCurrentDays: 13, expectedPreviousDays: 13 },
      finishedThrough: '2026-10-13', basis: COMPARISON_BASIS,
    });
  });

  it('a negative per-service amount is not lost: +$10 EC2 and a -$2 credit every day is $8/day, $104.00 (not the floored $130.00)', () => {
    const c = compare(series(() => [['Amazon Elastic Compute Cloud - Compute', 10], ['Credits', -2]]));
    expect(c.currentWindowTotal).toBe(104);
    expect(c.previousWindowTotal).toBe(104);
    expect(c.changeAmount).toBe(0);
    expect(c.changePercent).toBe(0);
  });

  it('a mixed positive and negative day contributes its net: Oct 5 is +$10 and -$15 (net -$5), so $115.00', () => {
    const c = compare(series((d) => (d === 5 ? [['Amazon Elastic Compute Cloud - Compute', 10], ['Amazon Simple Storage Service', -15]] : [['AWS Lambda', 10]])));
    expect(c.currentWindowTotal).toBe(115); // 12 x $10 + (-$5); the floored totals would give $130
    expect(c.changeAmount).toBe(11);
    expect(c.changePercent).toBe(10.6); // 1100 / 10400 cents
  });

  it('a previous window that nets below $0 has no percentage, and AI chat says why', () => {
    const c = compare(series(() => [['AWS Lambda', 1]], () => [['AWS Lambda', 1], ['Credits', -3]]));
    expect(c.previousWindowTotal).toBe(-26);
    expect(c.changePercent).toBeNull();
    expect(formatted(c)).toMatch(/percentage undefined: previous window total is below \$0\.00, credits exceeded charges/);
  });

  it('a compared day without byService (an older cache entry) makes the comparison unavailable, never the floored total', () => {
    const c = compare(series((d) => (d === 7 ? null : [['AWS Lambda', 10]])));
    expect(c).toMatchObject({
      state: 'unavailable',
      currentWindowTotal: null, previousWindowTotal: null, changeAmount: null, changePercent: null,
      currentWindow: { start: '2026-10-01', end: '2026-10-13' },
      basis: COMPARISON_BASIS,
    });
    expect(c.note).toMatch(/no per-service amounts/);
    // The same on the previous side.
    expect(compare(series(() => [['AWS Lambda', 10]], (d) => (d === 2 ? null : [['AWS Lambda', 8]]))).state).toBe('unavailable');
  });

  it('a day outside both windows without byService does not matter (Oct 15, still updating)', () => {
    const c = compare(series((d) => (d === 15 ? null : [['AWS Lambda', 10]])));
    expect(c.state).toBe('available');
    expect(c.currentWindowTotal).toBe(130);
  });

  it('updating days keep their semantics: an updating Oct 5 cuts both windows to Oct 1-4 vs Sep 1-4', () => {
    const points = series(() => [['AWS Lambda', 10], ['Credits', -1]]);
    (points.find((p) => p.date === '2026-10-05') as Record<string, unknown>).reportState = 'updating';
    const c = compare(points);
    expect(c.currentWindow).toEqual({ start: '2026-10-01', end: '2026-10-04' });
    expect(c.previousWindow).toEqual({ start: '2026-09-01', end: '2026-09-04' });
    expect(c.currentWindowTotal).toBe(36); // 4 x ($10 - $1)
    expect(c.previousWindowTotal).toBe(32);
  });

  it('not-reported days keep their semantics: a not-reported Sep 3 (no line items) cuts the windows to day 2', () => {
    const points = series(() => [['AWS Lambda', 10]]);
    const sep3 = points.find((p) => p.date === '2026-09-03') as Record<string, unknown>;
    Object.assign(sep3, { reportState: 'not_reported', byService: [], lineItems: 0, total: 0 });
    const c = compare(points);
    expect(c.currentWindow).toEqual({ start: '2026-10-01', end: '2026-10-02' });
    expect(c.currentWindowTotal).toBe(20);
    expect(c.previousWindowTotal).toBe(16);
  });

  it('missing days keep the coverage rule: two missing current days is partial, as before', () => {
    const points = series(() => [['AWS Lambda', 10]]).filter((p) => p.date !== '2026-10-03' && p.date !== '2026-10-04');
    const c = compare(points);
    expect(c.state).toBe('partial');
    expect(c.coverage).toEqual({ currentDays: 11, previousDays: 13, expectedCurrentDays: 13, expectedPreviousDays: 13 });
    expect(c.currentWindowTotal).toBe(110);
  });

  it('no day of this month finished: still no comparison', () => {
    const c = (repo as any).computeMonthOverMonthComparison(series(() => [['AWS Lambda', 10]]), null, new Date('2026-10-02T12:00:00.000Z'));
    expect(c).toMatchObject({ state: 'unavailable', currentWindowTotal: null, changePercent: null });
  });

  it('the basis says the amounts are net and unfloored', () => {
    expect(COMPARISON_BASIS).toMatch(/daily net amounts across all services, after credits and refunds, with nothing floored at zero/);
    expect(COMPARISON_BASIS).not.toMatch(/floored to zero/);
  });
});

describe('B1 through the shared consumers: costs summary (Dashboard, Costs, AI summary, reports) and AI chat', () => {
  beforeAll(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance'] });
  });
  afterAll(() => jest.useRealTimers());
  beforeEach(() => {
    jest.setSystemTime(NOW);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(awsCostService, 'getCostTrendFetchedAt').mockResolvedValue('2026-10-15T09:00:00.000Z');
    jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockResolvedValue({
      total: 120,
      byService: [{ service: 'Amazon Elastic Compute Cloud - Compute', amount: 150 }, { service: 'Credits', amount: -30 }],
      period: { start: '2026-10-01', end: '2026-10-16' },
      fetchedAt: '2026-10-15T09:00:00.000Z',
    });
    // Every October day: +$10 EC2 and a -$2 credit (net $8). September: $8/day, no credit.
    jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue(
      series(() => [['Amazon Elastic Compute Cloud - Compute', 10], ['Credits', -2]]) as unknown as CostTrendPoint[]
    );
  });
  afterEach(() => jest.restoreAllMocks());

  function fixturePool(): Pool {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('resource_discovery_jobs')) return { rows: [{ status: 'completed', completed_at: '2026-10-15T08:00:00.000Z' }] };
      if (sql.includes('aws_accounts')) return { rows: [{ account_id: '111122223333', region: 'us-east-1' }] };
      if (sql.includes('aws_resources')) return { rows: [] };
      throw new Error(`unexpected query in fixture: ${sql}`);
    });
    return { query } as unknown as Pool;
  }

  it('GET /api/platform/costs/summary: monthOverMonth is $104.00 vs $104.00 (net), 0% -- not the floored +25%', async () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const req = { user: { organizationId: ORG_ID }, query: {} } as unknown as Request;
    await new StatsController(fixturePool()).getCostSummary(req, { json, status } as unknown as Response);
    expect(status).not.toHaveBeenCalled();
    const { monthOverMonth } = json.mock.calls[0][0].data;
    expect(monthOverMonth.state).toBe('available');
    expect(monthOverMonth.data).toMatchObject({ currentWindowTotal: 104, previousWindowTotal: 104, changeAmount: 0, changePercent: 0, basis: COMPARISON_BASIS });
  });

  it('AI chat: the comparison it is given sums the net, and its text states the net basis', async () => {
    const costs = await (new AIChatContextRepository(fixturePool()) as any).collectCosts(ORG_ID, null, null, { kind: 'inventory' });
    expect(costs.comparison).toMatchObject({ state: 'available', currentWindowTotal: 104, previousWindowTotal: 104, changePercent: 0 });
    const text = formatted(costs.comparison, 120);
    expect(text).toMatch(/- Current window: 2026-10-01 through 2026-10-13 inclusive .* total \$104\.00/);
    expect(text).toMatch(/- Basis: sum of AWS Cost Explorer daily net amounts across all services/);
    expect(text).not.toMatch(/\$130\.00/);
  });
});
