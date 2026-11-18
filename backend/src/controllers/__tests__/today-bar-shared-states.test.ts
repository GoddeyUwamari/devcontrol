/**
 * Today bar (review-logs/day1/today-bar-build.md): the 7-day cost trend is
 * the 30-day series' last 8 days (TB-D1), so both views carry the same
 * per-day report state, and a day with no Cost Explorer data is a gap in both
 * (trend-lag round 2 L-2), never a $0 bar.
 *
 * Six ledgers at 2026-11-18 15:00 UTC (today = Nov 18), each through the real
 * route (StatsController.getCostTrend -> AWSCostService), Cost Explorer, STS
 * and the database stubbed:
 *   partial    charges every day; today's are partial      -> today updating
 *   absent     charges through Nov 17; none today          -> today not reported
 *   zero       charges through Nov 17; today's groups $0   -> today updating, a real $0
 *   stopped3   last charge Nov 14 (no data 4 days)         -> Nov 14 updating, Nov 15-18 not reported
 *   stopped10  last charge Nov 8 (no data 10 days)         -> every 7d day not reported (was final $0)
 *   quiet      no charges in 30 days                       -> every day final $0, today included (TB-D2 is the chart's)
 *
 * Each 7d response is pinned in __fixtures__/today-bar/ for the frontend tests
 * and screenshots; rewrite them with
 *   TODAY_BAR_FIXTURES=write npx jest today-bar-shared-states
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
import awsCostService, { sevenDayTrendFrom, type CostTrendPoint, type CostTrendRange } from '../../services/aws-cost.service';
import { StatsController } from '../stats.controller';
import { ACCOUNT_ROW, type CeInput } from './dashboard-money-fixtures';
import * as database from '../../config/database';

const ambientPool = database.pool as unknown as { query: jest.Mock };
const ORG = ACCOUNT_ROW.org_id;
const DIR = path.join(__dirname, '__fixtures__', 'today-bar');
const WRITE = process.env.TODAY_BAR_FIXTURES === 'write';
const NOW = '2026-11-18T15:00:00.000Z';
const TODAY = '2026-11-18';

const addDays = (day: string, n: number) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

/** A full day's charges; a partial day is a fraction of it. */
const FULL_DAY: Array<[string, number]> = [
  ['Amazon Elastic Compute Cloud - Compute', 1.2],
  ['Amazon Simple Storage Service', 0.3],
  ['AmazonCloudWatch', 0.05],
];

type Ledger = (day: string) => Array<[string, number]>;
const through = (last: string): Ledger => (day) => (day <= last ? FULL_DAY : []);

const LEDGERS: Record<string, Ledger> = {
  partial: (day) => (day < TODAY ? FULL_DAY : FULL_DAY.map(([s, a]) => [s, Math.round(a * 0.14 * 100) / 100] as [string, number])),
  absent: through('2026-11-17'),
  zero: (day) => (day < TODAY ? FULL_DAY : FULL_DAY.map(([s]) => [s, 0] as [string, number])),
  stopped3: through('2026-11-14'),
  stopped10: through('2026-11-08'),
  quiet: () => [],
};

function ceResponse(input: CeInput, ledger: Ledger) {
  const { Start, End } = input.TimePeriod;
  if (input.Granularity !== 'DAILY') throw new Error('daily ranges only in this test');
  const results = [];
  for (let d = Start; d < End; d = addDays(d, 1)) {
    results.push({
      TimePeriod: { Start: d, End: addDays(d, 1) },
      Total: {},
      Groups: ledger(d).map(([service, amount]) => ({ Keys: [service], Metrics: { UnblendedCost: { Amount: String(amount), Unit: 'USD' } } })),
      Estimated: true,
    });
  }
  return { ResultsByTime: results, DimensionValueAttributes: [], GroupDefinitions: [{ Type: 'DIMENSION', Key: 'SERVICE' }] };
}

function useLedger(name: keyof typeof LEDGERS): void {
  for (const key of ['costTrendCache', 'costTrendInFlight']) {
    ((awsCostService as unknown as Record<string, Map<string, unknown>>)[key]).clear();
  }
  jest.setSystemTime(new Date(NOW));
  mockCostExplorerSend.mockImplementation(async (command: { input: CeInput }) => ceResponse(command.input, LEDGERS[name]));
}

async function trendEndpoint(range: CostTrendRange): Promise<{ success: boolean; data: CostTrendPoint[] }> {
  const json = jest.fn();
  await new StatsController({ query: ambientPool.query } as unknown as Pool)
    .getCostTrend({ user: { organizationId: ORG }, query: { range } } as never, { json, status: jest.fn(() => ({ json })) } as never);
  return json.mock.calls[0][0];
}

const statesOf = (points: CostTrendPoint[]) => Object.fromEntries(points.map((p) => [p.date, p.reportState]));

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask'] });
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  mockCostExplorerSend.mockReset();
  ambientPool.query.mockReset();
  ambientPool.query.mockImplementation(async () => ({ rows: [ACCOUNT_ROW] }));
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const WEEK = ['2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17', TODAY];

const EXPECTED: Record<keyof typeof LEDGERS, Record<string, string>> = {
  partial: { ...Object.fromEntries(WEEK.map((d) => [d, 'final'])), [TODAY]: 'updating' },
  absent: { ...Object.fromEntries(WEEK.map((d) => [d, 'final'])), '2026-11-17': 'updating', [TODAY]: 'not_reported' },
  zero: { ...Object.fromEntries(WEEK.map((d) => [d, 'final'])), [TODAY]: 'updating' },
  stopped3: {
    '2026-11-11': 'final', '2026-11-12': 'final', '2026-11-13': 'final', '2026-11-14': 'updating',
    '2026-11-15': 'not_reported', '2026-11-16': 'not_reported', '2026-11-17': 'not_reported', [TODAY]: 'not_reported',
  },
  stopped10: Object.fromEntries(WEEK.map((d) => [d, 'not_reported'])),
  quiet: Object.fromEntries(WEEK.map((d) => [d, 'final'])),
};

describe.each(Object.keys(LEDGERS) as Array<keyof typeof LEDGERS>)('%s', (name) => {
  it('7d is today-7 .. today with the expected states', async () => {
    useLedger(name);
    const { success, data } = await trendEndpoint('7d');
    expect(success).toBe(true);
    expect(data.map((p) => p.date)).toEqual(WEEK);
    expect(statesOf(data)).toEqual(EXPECTED[name]);
  });

  it('7d and 30d carry the same state and amounts on every shared day (one Cost Explorer request)', async () => {
    useLedger(name);
    const seven = (await trendEndpoint('7d')).data;
    const thirty = (await trendEndpoint('30d')).data;
    expect(mockCostExplorerSend).toHaveBeenCalledTimes(1);
    const byDay = new Map(thirty.map((p) => [p.date, p]));
    for (const p of seven) {
      const t = byDay.get(p.date)!;
      expect([p.date, p.reportState, p.total, p.lineItems, p.provisional]).toEqual([t.date, t.reportState, t.total, t.lineItems, t.provisional]);
    }
  });

  it('pins its 7d response (read by the frontend today-bar tests and screenshots)', async () => {
    useLedger(name);
    const body = `${JSON.stringify(await trendEndpoint('7d'), null, 2)}\n`;
    const file = path.join(DIR, `trend-7d-${name}.json`);
    if (WRITE) {
      fs.mkdirSync(DIR, { recursive: true });
      fs.writeFileSync(file, body);
    }
    expect(body).toBe(fs.readFileSync(file, 'utf8'));
  });
});

describe('the cases the round-2 L-2 split got wrong', () => {
  it('stopped10: no day is a $0 final bar in 7d; the 30d view has the same gaps and real $0 days before today-7', async () => {
    useLedger('stopped10');
    const seven = (await trendEndpoint('7d')).data;
    expect(seven.some((p) => p.reportState === 'final')).toBe(false);
    const thirty = (await trendEndpoint('30d')).data;
    expect(statesOf(thirty.filter((p) => p.date > '2026-11-08' && p.date < '2026-11-11'))).toEqual({ '2026-11-09': 'final', '2026-11-10': 'final' });
  });

  it('zero: today has line items that sum to $0, so it is reported ($0 so far), not a gap', async () => {
    useLedger('zero');
    const today = (await trendEndpoint('7d')).data.find((p) => p.date === TODAY)!;
    expect(today).toMatchObject({ reportState: 'updating', total: 0, lineItems: 3 });
  });

  it('the cached 30d points are never changed by serving 7d (copies; only byServiceDisplay recomputed)', async () => {
    useLedger('partial');
    const thirty = (await trendEndpoint('30d')).data;
    const before = JSON.stringify(thirty);
    await trendEndpoint('7d');
    expect(JSON.stringify((await trendEndpoint('30d')).data)).toBe(before);
  });
});

describe('sevenDayTrendFrom', () => {
  const point = (date: string, service: string, amount: number): CostTrendPoint => ({
    date, compute: 0, storage: 0, database: 0, network: 0, other: amount, total: amount, byService: [{ service, amount }], lineItems: 1, reportState: 'final',
  });

  it('empty in, empty out; fewer than 8 points are all kept', () => {
    expect(sevenDayTrendFrom([])).toEqual([]);
    expect(sevenDayTrendFrom([point('2026-11-17', 'AWS Glue', 1), point('2026-11-18', 'AWS Glue', 1)]).map((p) => p.date)).toEqual(['2026-11-17', '2026-11-18']);
  });

  it('the last 8 days by date across a month boundary, top services over those days only (TB-D7)', () => {
    const series: CostTrendPoint[] = [];
    // A big service only in the oldest days, which leave the 7d window.
    for (let d = '2026-11-20'; d <= '2026-11-24'; d = addDays(d, 1)) series.push(point(d, 'Amazon Redshift', 500));
    for (let d = '2026-11-25'; d <= '2026-12-02'; d = addDays(d, 1)) series.push(point(d, 'AWS Glue', 1));
    const seven = sevenDayTrendFrom(series);
    expect(seven.map((p) => p.date)).toEqual(['2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02']);
    expect(seven[0].byServiceDisplay!.map((s) => s.service)).toEqual(['Glue']);
    // Copies: the series it was given (the cached 30d points) is not changed.
    expect(series.every((p) => p.byServiceDisplay === undefined)).toBe(true);
  });
});
