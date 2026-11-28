/**
 * AWSCostService (PR-MONEY, dashboard-step1.md §A.1, §B):
 *   - every cache entry is keyed by the period it answers, so an entry
 *     fetched for October never answers a request made after 00:00 UTC on
 *     Nov 1 (month to date and trend);
 *   - the month to date and the previous month come from ONE MONTHLY
 *     GetCostAndUsage request, split by each result's own TimePeriod; a
 *     response without the current month is an error, never a $0 month;
 *   - every NextPageToken page is read and merged; a failed page fails the
 *     whole read and nothing is cached; a response that never stops paging is
 *     refused;
 *   - getMonthlySpendWithFallback: any successful Cost Explorer result is
 *     'actual' ($0 and net-negative included); only a failure is 'estimated'.
 * Cost Explorer, STS and the database are stubs (no AWS or database call).
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

import type { Pool } from 'pg';
import { AWSCostService, MAX_COST_EXPLORER_PAGES, monthlyCostsRequestPeriodUtc } from '../aws-cost.service';
import { ACCOUNT_ROW, ceLedgerResponse, type CeInput } from '../../controllers/__tests__/dashboard-money-fixtures';

const ORG = ACCOUNT_ROW.org_id;
type Sent = { input: CeInput };
const inputs = () => mockCostExplorerSend.mock.calls.map(([c]) => (c as Sent).input);

let service: AWSCostService;
let poolQuery: jest.Mock;

function at(iso: string): void {
  jest.setSystemTime(new Date(iso));
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask'] });
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  mockCostExplorerSend.mockReset();
  mockCostExplorerSend.mockImplementation(async (command: Sent) => ceLedgerResponse(command.input));
  // Inventory rows for the run-rate fallback: one defensibly priced gp2 volume (880 GB x $0.10 =
  // $88) and an ECS service whose stored $9 is a flat placeholder (never summed, F-5).
  poolQuery = jest.fn(async (sql: string) => (/aws_resources/.test(sql) ? { rows: INVENTORY_ROWS } : { rows: [ACCOUNT_ROW] }));
  // A fresh instance per test: its caches are per instance.
  service = new AWSCostService({ query: poolQuery } as unknown as Pool);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const INVENTORY_ROWS = [
  { resource_type: 'ebs', region: 'us-east-1', status: 'in-use', metadata: { volume_type: 'gp2', size_gb: 880 }, stored_monthly_cost: '88.00', last_synced_at: null },
  { resource_type: 'ecs', region: 'us-east-1', status: 'active', metadata: {}, stored_monthly_cost: '9.00', last_synced_at: null },
];

describe('rollover: 2026-10-31T23:59Z vs 2026-11-01T00:37Z (Oct 31 8:37 PM EDT)', () => {
  it('month to date: the October entry never answers the November request', async () => {
    at('2026-10-31T23:59:00Z');
    const october = await service.fetchMonthlyCosts(ORG);
    expect(october.period).toEqual({ start: '2026-10-01', end: '2026-11-01' });
    expect(october.total).toBeCloseTo(13.3 * 31, 6);

    at('2026-11-01T00:37:00Z');
    const november = await service.fetchMonthlyCosts(ORG);
    expect(november.period).toEqual({ start: '2026-11-01', end: '2026-11-02' });
    expect(november.total).toBe(0);
    expect(november.byService).toEqual([]);
    expect(november.previousMonth).toEqual({ period: { start: '2026-10-01', end: '2026-11-01' }, total: expect.closeTo(13.3 * 31, 6) });
    expect(inputs().map((i) => i.TimePeriod)).toEqual([
      { Start: '2026-09-01', End: '2026-11-01' },
      { Start: '2026-10-01', End: '2026-11-02' },
    ]);
  });

  it('month to date: within the same UTC day and TTL, the entry is reused (no second request)', async () => {
    at('2026-11-01T00:37:00Z');
    await service.fetchMonthlyCosts(ORG);
    at('2026-11-01T03:00:00Z');
    await service.fetchMonthlyCosts(ORG);
    expect(mockCostExplorerSend).toHaveBeenCalledTimes(1);
  });

  it('trend: a range resolves to a new period after midnight UTC and is fetched again', async () => {
    at('2026-10-31T23:59:00Z');
    await service.fetchCostTrend(ORG, '7d');
    at('2026-11-01T00:37:00Z');
    await service.fetchCostTrend(ORG, '7d');
    // 7d is served from the 30d series (today-bar TB-D1), and 30d from the 90d
    // request (CE-2): today-90 .. today.
    expect(inputs().map((i) => i.TimePeriod)).toEqual([
      { Start: '2026-08-02', End: '2026-11-01' },
      { Start: '2026-08-03', End: '2026-11-02' },
    ]);
    expect(await service.getCostTrendFetchedAt(ORG, '7d')).toBe('2026-11-01T00:37:00.000Z');
  });

  it('trend: 7d after 30d (or 30d after 7d) is the same cached request, no second Cost Explorer call', async () => {
    at('2026-11-16T11:30:00Z');
    const thirty = await service.fetchCostTrend(ORG, '30d');
    const seven = await service.fetchCostTrend(ORG, '7d');
    expect(mockCostExplorerSend).toHaveBeenCalledTimes(1);
    expect(seven.map((p) => p.date)).toEqual(thirty.slice(-8).map((p) => p.date));
    expect(seven[0].date).toBe('2026-11-09');
    expect(seven[7].date).toBe('2026-11-16');
    expect(await service.getCostTrendFetchedAt(ORG, '7d')).toBe(await service.getCostTrendFetchedAt(ORG, '30d'));
  });

  it('expired entries for past periods are dropped when a new one is stored', async () => {
    at('2026-10-31T19:00:00Z');
    await service.fetchMonthlyCosts(ORG);
    at('2026-11-01T00:37:00Z');
    await service.fetchMonthlyCosts(ORG);
    const cache = (service as unknown as { monthlyCostCache: Map<string, unknown> }).monthlyCostCache;
    expect(cache.size).toBe(1);
    expect([...cache.keys()][0]).toContain('2026-11-02');
  });
});

describe('one Cost Explorer request for the previous month and the month to date', () => {
  it('mid-month: one MONTHLY send, split by TimePeriod', async () => {
    at('2026-11-12T12:00:00Z');
    mockCostExplorerSend.mockImplementation(async (command: Sent) => ceLedgerResponse(command.input, '2026-11-11'));
    const costs = await service.fetchMonthlyCosts(ORG);
    expect(mockCostExplorerSend).toHaveBeenCalledTimes(1);
    // Metrics is the value the service has always sent (the SDK's Metric.UNBLENDED_COST);
    // unchanged here, see dashboard-step1.md PR-MONEY build, "unverified".
    expect(inputs()[0]).toMatchObject({ TimePeriod: { Start: '2026-10-01', End: '2026-11-13' }, Granularity: 'MONTHLY', Metrics: ['UNBLENDED_COST'], GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }] });
    expect(costs.period).toEqual({ start: '2026-11-01', end: '2026-11-13' });
    expect(costs.total).toBeCloseTo(13.3 * 11, 6);
    expect(costs.previousMonth).toEqual({ period: { start: '2026-10-01', end: '2026-11-01' }, total: expect.closeTo(13.3 * 31, 6) });
  });

  it('January: the previous month is December of the previous year', () => {
    expect(monthlyCostsRequestPeriodUtc(new Date('2027-01-01T05:00:00Z'))).toEqual({
      start: '2026-12-01', end: '2027-01-02', monthToDate: { start: '2027-01-01', end: '2027-01-02' },
    });
  });

  it('a response with no result for the current month is an error, not $0, and is not cached', async () => {
    at('2026-11-12T12:00:00Z');
    mockCostExplorerSend.mockImplementation(async (command: Sent) => {
      const r = ceLedgerResponse(command.input, '2026-11-11');
      return { ...r, ResultsByTime: r.ResultsByTime.filter((x) => x.TimePeriod.Start !== '2026-11-01') };
    });
    await expect(service.fetchMonthlyCosts(ORG)).rejects.toThrow('no result for the current month');
    mockCostExplorerSend.mockImplementation(async (command: Sent) => ceLedgerResponse(command.input, '2026-11-11'));
    await expect(service.fetchMonthlyCosts(ORG)).resolves.toMatchObject({ period: { start: '2026-11-01' } });
    expect(mockCostExplorerSend).toHaveBeenCalledTimes(2);
  });

  it('no previous-month result: previousMonth is null, the month to date stands', async () => {
    at('2026-11-12T12:00:00Z');
    mockCostExplorerSend.mockImplementation(async (command: Sent) => {
      const r = ceLedgerResponse(command.input, '2026-11-11');
      return { ...r, ResultsByTime: r.ResultsByTime.filter((x) => x.TimePeriod.Start !== '2026-10-01') };
    });
    const costs = await service.fetchMonthlyCosts(ORG);
    expect(costs.previousMonth).toBeNull();
    expect(costs.total).toBeCloseTo(13.3 * 11, 6);
  });
});

describe('pagination', () => {
  /** Splits each result's groups across two pages, as Cost Explorer may. */
  function twoPages(command: Sent, dataThrough: string) {
    const full = ceLedgerResponse(command.input, dataThrough);
    if (!command.input.NextPageToken) {
      return { ...full, ResultsByTime: full.ResultsByTime.map((r) => ({ ...r, Groups: r.Groups.slice(0, 1) })), NextPageToken: 'page-2' };
    }
    return { ...full, ResultsByTime: full.ResultsByTime.map((r) => ({ ...r, Groups: r.Groups.slice(1) })) };
  }

  it('month to date: both pages are read and their groups merged per period', async () => {
    at('2026-11-12T12:00:00Z');
    mockCostExplorerSend.mockImplementation(async (command: Sent) => twoPages(command, '2026-11-11'));
    const costs = await service.fetchMonthlyCosts(ORG);
    expect(inputs().map((i) => i.NextPageToken)).toEqual([undefined, 'page-2']);
    expect(costs.byService.map((s) => s.service)).toEqual(['Amazon Elastic Compute Cloud - Compute', 'Amazon Simple Storage Service']);
    expect(costs.total).toBeCloseTo(13.3 * 11, 6);
    expect(costs.previousMonth?.total).toBeCloseTo(13.3 * 31, 6);
  });

  it('trend: both pages are read; each day carries every service once', async () => {
    at('2026-11-12T12:00:00Z');
    mockCostExplorerSend.mockImplementation(async (command: Sent) => twoPages(command, '2026-11-11'));
    const points = await service.fetchCostTrend(ORG, '7d');
    expect(mockCostExplorerSend).toHaveBeenCalledTimes(2);
    expect(points).toHaveLength(8);
    const billedDay = points.find((p) => p.date === '2026-11-10')!;
    expect(billedDay.byService).toHaveLength(2);
    expect(billedDay.total).toBeCloseTo(13.3, 6);
  });

  it('a failed second page fails the whole read, and nothing partial is cached', async () => {
    at('2026-11-12T12:00:00Z');
    mockCostExplorerSend.mockImplementation(async (command: Sent) => {
      if (command.input.NextPageToken) throw new Error('ThrottlingException');
      return twoPages(command, '2026-11-11');
    });
    await expect(service.fetchMonthlyCosts(ORG)).rejects.toThrow('ThrottlingException');
    await expect(service.fetchCostTrend(ORG, '7d')).rejects.toThrow('ThrottlingException');
    mockCostExplorerSend.mockImplementation(async (command: Sent) => twoPages(command, '2026-11-11'));
    await expect(service.fetchMonthlyCosts(ORG)).resolves.toMatchObject({ total: expect.closeTo(13.3 * 11, 6) });
    await expect(service.fetchCostTrend(ORG, '7d')).resolves.toHaveLength(8);
  });

  it(`a response that never stops paging is refused after ${MAX_COST_EXPLORER_PAGES} pages`, async () => {
    at('2026-11-12T12:00:00Z');
    mockCostExplorerSend.mockImplementation(async (command: Sent) => ({ ...ceLedgerResponse(command.input, '2026-11-11'), NextPageToken: 'again' }));
    await expect(service.fetchMonthlyCosts(ORG)).rejects.toThrow(`more than ${MAX_COST_EXPLORER_PAGES} pages`);
    expect(mockCostExplorerSend).toHaveBeenCalledTimes(MAX_COST_EXPLORER_PAGES);
  });
});

describe('getMonthlySpendWithFallback: any Cost Explorer success is actual', () => {
  it('no charges reported yet ($0) is actual, not the inventory estimate', async () => {
    at('2026-11-01T00:37:00Z');
    await expect(service.getMonthlySpendWithFallback(ORG)).resolves.toEqual({ amount: 0, source: 'actual' });
  });

  it('a net-negative (credit) month is actual', async () => {
    at('2026-11-12T12:00:00Z');
    mockCostExplorerSend.mockImplementation(async (command: Sent) => {
      const r = ceLedgerResponse(command.input, '2026-11-11');
      return { ...r, ResultsByTime: r.ResultsByTime.map((x) => ({ ...x, Groups: [{ Keys: ['Amazon Elastic Compute Cloud - Compute'], Metrics: { UnblendedCost: { Amount: '-4.10', Unit: 'USD' } } }] })) };
    });
    await expect(service.getMonthlySpendWithFallback(ORG)).resolves.toEqual({ amount: -4.1, source: 'actual' });
  });

  it('only a failed Cost Explorer read falls back to the inventory estimate', async () => {
    at('2026-11-12T12:00:00Z');
    mockCostExplorerSend.mockRejectedValue(new Error('AccessDeniedException'));
    await expect(service.getMonthlySpendWithFallback(ORG)).resolves.toEqual({ amount: 88, source: 'estimated', estimateCoverage: { pricedResources: 1, totalResources: 2, excludedResources: 0 } });
  });
});

describe('the month state (day1-step1.md, cost-month-state.ts)', () => {
  it('2026-12-01T00:30Z, nothing reported: monthState no_billed_days_yet with a null amount', async () => {
    at('2026-12-01T00:30:00Z');
    mockCostExplorerSend.mockImplementation(async (command: Sent) => ceLedgerResponse(command.input, '2026-11-30'));
    const costs = await service.fetchMonthlyCosts(ORG);
    expect(costs.total).toBe(0);
    expect(costs.monthState).toMatchObject({
      state: 'no_billed_days_yet', amount: null, amountUsable: false, lineItems: 0,
      period: { month: '2026-12', start: '2026-12-01', endExclusive: '2026-12-02', calendar: 'UTC' },
      asOf: costs.fetchedAt, previousMonth: { month: '2026-11', amount: expect.closeTo(13.3 * 30, 6) },
    });
  });

  it('day 1, Cost Explorer leaves out the empty month but answers the previous one: no billed days yet, not an error', async () => {
    at('2026-12-01T00:30:00Z');
    mockCostExplorerSend.mockImplementation(async (command: Sent) => {
      const r = ceLedgerResponse(command.input, '2026-11-30');
      return { ...r, ResultsByTime: r.ResultsByTime.filter((x) => x.TimePeriod.Start !== '2026-12-01') };
    });
    const costs = await service.fetchMonthlyCosts(ORG);
    expect(costs.monthState).toMatchObject({ state: 'no_billed_days_yet', amount: null, reason: { code: 'no_current_month_result' } });
  });

  it('day 1, Cost Explorer answers neither month: an error, never $0', async () => {
    at('2026-12-01T00:30:00Z');
    mockCostExplorerSend.mockImplementation(async (command: Sent) => ({ ...ceLedgerResponse(command.input, '2026-11-30'), ResultsByTime: [] }));
    await expect(service.fetchMonthlyCosts(ORG)).rejects.toThrow('no result for the current month');
  });

  it('day 3: month to date, and the month state never outlives its UTC day (the cache key rolls)', async () => {
    at('2026-12-02T23:59:00Z');
    mockCostExplorerSend.mockImplementation(async (command: Sent) => ceLedgerResponse(command.input, '2026-12-01'));
    expect((await service.fetchMonthlyCosts(ORG)).monthState?.state).toBe('latest_days_updating');
    at('2026-12-03T00:01:00Z');
    expect((await service.fetchMonthlyCosts(ORG)).monthState).toMatchObject({ state: 'month_to_date', amount: expect.closeTo(13.3, 6) });
    expect(mockCostExplorerSend).toHaveBeenCalledTimes(2);
  });

  it('trend points carry lineItems, reportState and provisional: an unreported day is not a measured $0', async () => {
    at('2026-12-03T00:30:00Z');
    mockCostExplorerSend.mockImplementation(async (command: Sent) => ceLedgerResponse(command.input, '2026-12-01'));
    const points = await service.fetchCostTrend(ORG, '7d');
    const byDate = Object.fromEntries(points.map((p) => [p.date, { lineItems: p.lineItems, reportState: p.reportState, provisional: p.provisional }]));
    // trend-lag-build.md: Dec 1 is the last day with line items and inside today-3 .. today, so it is
    // still updating (the 2-day calendar rule called it finished); the days after it are not reported.
    // The synthetic ledger marks Nov 30 onward Estimated: recorded only (R-1), so Nov 29-30 are final.
    expect(byDate['2026-11-29']).toEqual({ lineItems: 2, reportState: 'final', provisional: false });
    expect(byDate['2026-11-30']).toEqual({ lineItems: 2, reportState: 'final', provisional: false });
    expect(byDate['2026-12-01']).toEqual({ lineItems: 2, reportState: 'updating', provisional: true });
    expect(byDate['2026-12-02']).toEqual({ lineItems: 0, reportState: 'not_reported', provisional: true });
    expect(byDate['2026-12-03']).toEqual({ lineItems: 0, reportState: 'not_reported', provisional: true });
  });

  it('6mo on day 1: the current month point has no line items and is provisional', async () => {
    at('2026-12-01T00:30:00Z');
    mockCostExplorerSend.mockImplementation(async (command: Sent) => ceLedgerResponse(command.input, '2026-11-30'));
    const points = await service.fetchCostTrend(ORG, '6mo');
    expect(points.at(-1)).toMatchObject({ date: '2026-12-01', lineItems: 0, provisional: true });
    expect(points.at(-2)).toMatchObject({ date: '2026-11-01', lineItems: 2, provisional: true });
    expect(points.at(-3)).toMatchObject({ date: '2026-10-01', provisional: false });
  });
});

describe('a Cost Explorer group without the requested metric is never $0 (DAY1-D17)', () => {
  const renamedMetric = (command: Sent) => {
    const r = ceLedgerResponse(command.input, '2026-11-11');
    return { ...r, ResultsByTime: r.ResultsByTime.map((x) => ({ ...x, Groups: x.Groups.map((g) => ({ ...g, Metrics: { UNBLENDED_COST: g.Metrics.UnblendedCost } })) })) };
  };

  it('month to date: the read fails with cost_metric_missing, and nothing is cached', async () => {
    at('2026-11-12T12:00:00Z');
    mockCostExplorerSend.mockImplementation(async (command: Sent) => renamedMetric(command));
    await expect(service.fetchMonthlyCosts(ORG)).rejects.toMatchObject({ code: 'cost_metric_missing' });
    mockCostExplorerSend.mockImplementation(async (command: Sent) => ceLedgerResponse(command.input, '2026-11-11'));
    await expect(service.fetchMonthlyCosts(ORG)).resolves.toMatchObject({ total: expect.closeTo(13.3 * 11, 6) });
  });

  it('trend: the read fails with cost_metric_missing', async () => {
    at('2026-11-12T12:00:00Z');
    mockCostExplorerSend.mockImplementation(async (command: Sent) => renamedMetric(command));
    await expect(service.fetchCostTrend(ORG, '7d')).rejects.toMatchObject({ code: 'cost_metric_missing' });
  });

  it('getMonthlySpendWithFallback: falls back to the estimate, never "$0 actual"', async () => {
    at('2026-11-12T12:00:00Z');
    mockCostExplorerSend.mockImplementation(async (command: Sent) => renamedMetric(command));
    await expect(service.getMonthlySpendWithFallback(ORG)).resolves.toEqual({ amount: 88, source: 'estimated', estimateCoverage: { pricedResources: 1, totalResources: 2, excludedResources: 0 } });
  });
});
