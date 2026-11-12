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
  poolQuery = jest.fn(async (sql: string) => (/aws_resources/.test(sql) ? { rows: [{ total: '88.00' }] } : { rows: [ACCOUNT_ROW] }));
  // A fresh instance per test: its caches are per instance.
  service = new AWSCostService({ query: poolQuery } as unknown as Pool);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

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
    expect(inputs().map((i) => i.TimePeriod)).toEqual([
      { Start: '2026-10-24', End: '2026-11-01' },
      { Start: '2026-10-25', End: '2026-11-02' },
    ]);
    expect(await service.getCostTrendFetchedAt(ORG, '7d')).toBe('2026-11-01T00:37:00.000Z');
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
    await expect(service.getMonthlySpendWithFallback(ORG)).resolves.toEqual({ amount: 88, source: 'estimated' });
  });
});
