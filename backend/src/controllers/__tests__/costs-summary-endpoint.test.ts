/**
 * The Costs page's spend and month-over-month figures (GET
 * /api/platform/costs/summary) come from the shared cost evidence path
 * (gatherCostContext() -> spendSection()/monthOverMonthSection()), not from
 * getMonthlySpendWithFallback():
 *   - any finite Cost Explorer result -- $0, a net credit, a sub-dollar
 *     amount -- stays 'actual' billing data, unrounded to whole dollars;
 *   - a Cost Explorer failure falls back to the inventory estimate labeled
 *     'estimated' (a monthly run-rate), or to no figure at all -- never $0;
 *   - the comparison is a real change (including a real 0%), or
 *     unavailable / error with no figures -- never 0%.
 * GET /api/platform/costs/trend no longer reports a Cost Explorer failure as
 * a successful empty series.
 *
 * No DB and no AWS: the pool is a fixture routed by table name, and the Cost
 * Explorer calls are mocked. Figures here are fixtures, not production data.
 */
import { Pool } from 'pg';
import { Request, Response } from 'express';
import { StatsController } from '../stats.controller';
import awsCostService, { CostTrendPoint } from '../../services/aws-cost.service';

const ORG_ID = '00000000-0000-0000-0000-0000000000c5';
const FETCHED_AT = '2026-09-27T09:00:00.000Z';

/** Fixture pool: a completed discovery run, a connected account, and the given inventory estimate rows. */
function fixturePool(estimate: { total: string | null; estimated: string; resources: string } | 'throws' = { total: null, estimated: '0', resources: '0' }): Pool {
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('resource_discovery_jobs')) {
      return { rows: [{ status: 'completed', completed_at: '2026-09-27T08:00:00.000Z' }] };
    }
    if (sql.includes('aws_accounts')) return { rows: [{ account_id: '111122223333', region: 'us-east-1' }] };
    if (sql.includes('aws_resources')) {
      if (estimate === 'throws') throw new Error('relation "aws_resources" does not exist');
      return { rows: [{ total: estimate.total, estimated_resources: estimate.estimated, total_resources: estimate.resources }] };
    }
    throw new Error(`unexpected query in fixture: ${sql}`);
  });
  return { query } as unknown as Pool;
}

function mockReqRes(organizationId: string | null = ORG_ID, query: Record<string, string> = {}) {
  const req = { user: organizationId ? { organizationId } : undefined, query } as unknown as Request;
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { json, status } as unknown as Response;
  return { req, res, json, status };
}

function mockMonthlyCost(total: number) {
  jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockResolvedValue({
    total,
    byService: [{ service: 'Amazon Elastic Compute Cloud - Compute', amount: total }],
    period: { start: '2026-09-01', end: '2026-09-28' },
    fetchedAt: FETCHED_AT,
  });
}

function isoDate(year: number, monthIndex: number, day: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Daily trend fixture (UTC, like the comparison): every day of this month so
 * far at `current` -- including today and yesterday, which the comparison
 * leaves out as still being reported -- and every day of last month at
 * `previous` (or its first `previousDays`).
 */
function dailyTrend(current: number, previous: number, previousDays?: number): CostTrendPoint[] {
  const now = new Date();
  const y = now.getUTCFullYear(), m = now.getUTCMonth(), today = now.getUTCDate();
  const lastM = m === 0 ? 11 : m - 1, lastY = m === 0 ? y - 1 : y;
  const daysInLast = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const point = (date: string, total: number): CostTrendPoint => ({ date, compute: total, storage: 0, database: 0, network: 0, other: 0, total });
  const points: CostTrendPoint[] = [];
  for (let d = 1; d <= (previousDays ?? daysInLast); d++) points.push(point(isoDate(lastY, lastM, d), previous));
  for (let d = 1; d <= today; d++) points.push(point(isoDate(y, m, d), current));
  return points;
}

async function summary(pool: Pool = fixturePool()) {
  const controller = new StatsController(pool);
  const { req, res, json, status } = mockReqRes();
  await controller.getCostSummary(req, res);
  expect(status).not.toHaveBeenCalled();
  const body = json.mock.calls[0][0];
  expect(body.success).toBe(true);
  return body.data;
}

/** Pins Date (only) to a UTC instant; the default is mid-month, so a comparison exists. */
function setClock(iso: string) {
  jest.setSystemTime(new Date(iso));
}
beforeAll(() => {
  jest.useFakeTimers({ now: new Date('2026-10-15T12:00:00.000Z'), doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance'] });
});
afterAll(() => jest.useRealTimers());

beforeEach(() => {
  setClock('2026-10-15T12:00:00.000Z');
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(awsCostService, 'getCostTrendFetchedAt').mockReturnValue(FETCHED_AT);
});
afterEach(() => jest.restoreAllMocks());

describe('GET /api/platform/costs/summary -- spend keeps its provenance', () => {
  it('a real $0 Cost Explorer month is actual billing data, not an inventory estimate', async () => {
    mockMonthlyCost(0);
    jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue(dailyTrend(0, 0));
    const pool = fixturePool({ total: '500', estimated: '3', resources: '3' });

    const { spend } = await summary(pool);

    expect(spend.state).toBe('available');
    expect(spend.provenance).toBe('actual');
    expect(spend.source).toBe('AWS Cost Explorer');
    expect(spend.data.amount).toBe(0);
    expect(spend.data.basis).toBe('billed_month_to_date');
    // The inventory estimate was never consulted.
    expect((pool.query as jest.Mock).mock.calls.some(([sql]) => String(sql).includes('aws_resources'))).toBe(false);
  });

  it('a net-credit (negative) Cost Explorer month stays actual and negative -- not $0, not an estimate', async () => {
    mockMonthlyCost(-12.34);
    jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue(dailyTrend(1, 1));

    const { spend } = await summary(fixturePool({ total: '500', estimated: '3', resources: '3' }));

    expect(spend.provenance).toBe('actual');
    expect(spend.data.amount).toBe(-12.34);
  });

  it('a sub-dollar Cost Explorer month keeps its cents', async () => {
    mockMonthlyCost(0.42);
    jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue(dailyTrend(0.02, 0.02));

    const { spend } = await summary();

    expect(spend.provenance).toBe('actual');
    expect(spend.data.amount).toBe(0.42);
  });

  it('a Cost Explorer failure with an inventory estimate is labeled estimated (a monthly run-rate), never AWS billing', async () => {
    jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockRejectedValue(new Error('AccessDeniedException'));
    const trend = jest.spyOn(awsCostService, 'fetchCostTrend');

    const { spend, monthOverMonth } = await summary(fixturePool({ total: '42.5', estimated: '2', resources: '2' }));

    expect(spend.state).toBe('available');
    expect(spend.provenance).toBe('estimated');
    expect(spend.source).toBe('DevControl inventory cost estimate');
    expect(spend.data.basis).toBe('estimated_monthly_run_rate');
    expect(spend.data.amount).toBe(42.5);
    expect(spend.coverage).toMatch(/AWS Cost Explorer is could not be retrieved/i);
    // No billed period to compare, so no comparison -- not 0%.
    expect(monthOverMonth.state).toBe('unavailable');
    expect(monthOverMonth.data).toBeNull();
    expect(trend).not.toHaveBeenCalled();
  });

  it('a Cost Explorer failure with no inventory estimate is no figure at all -- not $0', async () => {
    jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockRejectedValue(new Error('ThrottlingException'));

    const { spend } = await summary(fixturePool({ total: null, estimated: '0', resources: '4' }));

    expect(spend.state).toBe('error');
    expect(spend.provenance).toBeNull();
    expect(spend.data).toBeNull();
  });

  it('no connected account and no inventory is unavailable -- not $0', async () => {
    jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockRejectedValue(new Error(`AWS_NOT_CONNECTED: org ${ORG_ID}`));

    const { spend, monthOverMonth } = await summary();

    expect(spend.state).toBe('unavailable');
    expect(spend.data).toBeNull();
    expect(monthOverMonth.state).toBe('unavailable');
    expect(monthOverMonth.data).toBeNull();
  });

  it('a failed estimate query after a Cost Explorer failure is error, and the raw DB text never reaches the response', async () => {
    jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockRejectedValue(new Error('AccessDeniedException'));

    const data = await summary(fixturePool('throws'));

    expect(data.spend.state).toBe('error');
    expect(data.spend.data).toBeNull();
    expect(JSON.stringify(data)).not.toMatch(/relation|does not exist|AccessDenied/);
  });
});

describe('GET /api/platform/costs/summary -- month-over-month is a real change or no change figure at all', () => {
  it('a genuine 0% change is an available comparison with changePercent 0', async () => {
    mockMonthlyCost(30);
    jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue(dailyTrend(1, 1));

    const { monthOverMonth } = await summary();

    expect(monthOverMonth.state).toBe('available');
    expect(monthOverMonth.provenance).toBe('derived');
    expect(monthOverMonth.data.changePercent).toBe(0);
    expect(monthOverMonth.data.changeAmount).toBe(0);
  });

  it('a positive change carries its real percentage', async () => {
    mockMonthlyCost(30);
    jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue(dailyTrend(1.5, 1));

    const { monthOverMonth } = await summary();

    expect(monthOverMonth.data.changePercent).toBe(50);
    expect(monthOverMonth.data.changeAmount).toBeGreaterThan(0);
  });

  it('a negative change carries its real percentage', async () => {
    mockMonthlyCost(30);
    jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue(dailyTrend(0.75, 1));

    const { monthOverMonth } = await summary();

    expect(monthOverMonth.data.changePercent).toBe(-25);
    expect(monthOverMonth.data.changeAmount).toBeLessThan(0);
  });

  it('too little daily history is unavailable with no figures -- not 0%', async () => {
    mockMonthlyCost(30);
    jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue(dailyTrend(1, 1, 0));

    const { monthOverMonth } = await summary();

    expect(monthOverMonth.state).toBe('unavailable');
    expect(monthOverMonth.data).toBeNull();
    expect(monthOverMonth.reason).toMatch(/cannot be calculated: AWS Cost Explorer daily trend: not available/);
  });

  it('a failed daily trend request is error with no figures -- not 0%', async () => {
    mockMonthlyCost(30);
    jest.spyOn(awsCostService, 'fetchCostTrend').mockRejectedValue(new Error('ThrottlingException'));

    const { spend, monthOverMonth } = await summary();

    expect(spend.provenance).toBe('actual');
    expect(monthOverMonth.state).toBe('error');
    expect(monthOverMonth.data).toBeNull();
  });
});

describe('GET /api/platform/costs/summary -- the comparison uses finished days only (UTC)', () => {
  /** A trend where every day is $1 except the provisional days (today, yesterday), which are $100 -- so any leak shows. */
  function trendWithProvisionalSpike(): CostTrendPoint[] {
    const now = new Date();
    const provisional = new Set([0, 1].map((back) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - back)).toISOString().slice(0, 10)));
    return dailyTrend(1, 1).map((p) => (provisional.has(p.date) ? { ...p, compute: 100, total: 100 } : p));
  }

  it.each([
    ['Oct 1', '2026-10-01T12:00:00.000Z', '2026-09-29'],
    ['Oct 2', '2026-10-02T12:00:00.000Z', '2026-09-30'],
  ])('%s: no comparison, no percentage -- no day of this month has finished reporting', async (_label, now, finishedThrough) => {
    setClock(now);
    mockMonthlyCost(0.19);
    jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue(trendWithProvisionalSpike());

    const { spend, monthOverMonth } = await summary();

    expect(monthOverMonth.state).toBe('unavailable');
    expect(monthOverMonth.data).toBeNull();
    expect(JSON.stringify(monthOverMonth)).not.toMatch(/changePercent|%/);
    expect(spend.data.amount).toBe(0.19);
    expect(spend.data.finishedThrough).toBe(finishedThrough);
  });

  it('Oct 3: Oct 1 vs Sep 1 only', async () => {
    setClock('2026-10-03T12:00:00.000Z');
    mockMonthlyCost(0.5);
    jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue(trendWithProvisionalSpike());

    const { spend, monthOverMonth } = await summary();

    expect(monthOverMonth.data.currentWindow).toEqual({ start: '2026-10-01', end: '2026-10-01' });
    expect(monthOverMonth.data.previousWindow).toEqual({ start: '2026-09-01', end: '2026-09-01' });
    expect(monthOverMonth.data.currentWindowTotal).toBe(1);
    expect(monthOverMonth.data.previousWindowTotal).toBe(1);
    expect(monthOverMonth.data.changePercent).toBe(0);
    expect(monthOverMonth.data.currentWindowIncludesToday).toBe(false);
    expect(spend.data.finishedThrough).toBe('2026-10-01');
  });

  it('Oct 15: Oct 1-13 vs Sep 1-13; the Spend amount is still the full month-to-date actual', async () => {
    mockMonthlyCost(42.37);
    jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue(trendWithProvisionalSpike());

    const { spend, monthOverMonth } = await summary();

    expect(monthOverMonth.data.currentWindow).toEqual({ start: '2026-10-01', end: '2026-10-13' });
    expect(monthOverMonth.data.previousWindow).toEqual({ start: '2026-09-01', end: '2026-09-13' });
    expect(monthOverMonth.data.currentWindowTotal).toBe(13);
    expect(monthOverMonth.data.previousWindowTotal).toBe(13);
    expect(spend.provenance).toBe('actual');
    expect(spend.data.amount).toBe(42.37);
    expect(spend.data.finishedThrough).toBe('2026-10-13');
  });

  it('Mar 31: Mar 1-29 vs Feb 1-28 -- the previous window is capped at February\'s last day', async () => {
    setClock('2027-03-31T12:00:00.000Z');
    mockMonthlyCost(10);
    jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue(dailyTrend(1, 1));

    const { monthOverMonth } = await summary();

    expect(monthOverMonth.data.currentWindow).toEqual({ start: '2027-03-01', end: '2027-03-29' });
    expect(monthOverMonth.data.previousWindow).toEqual({ start: '2027-02-01', end: '2027-02-28' });
    expect(monthOverMonth.data.currentWindowTotal).toBe(29);
    expect(monthOverMonth.data.previousWindowTotal).toBe(28);
  });

  it('Mar 30: Mar 1-28 vs Feb 1-28 -- not capped', async () => {
    setClock('2027-03-30T12:00:00.000Z');
    mockMonthlyCost(10);
    jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue(dailyTrend(1, 1));

    const { monthOverMonth } = await summary();

    expect(monthOverMonth.data.currentWindow).toEqual({ start: '2027-03-01', end: '2027-03-28' });
    expect(monthOverMonth.data.previousWindow).toEqual({ start: '2027-02-01', end: '2027-02-28' });
  });

  it('uses the UTC date, not the server\'s local date: Oct 3 01:00 UTC is still Oct 2 in New York, and compares Oct 1 vs Sep 1', async () => {
    const originalTz = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      setClock('2026-10-03T01:00:00.000Z');
      expect(new Date().getDate()).toBe(2); // local evening of the previous day
      mockMonthlyCost(0.5);
      jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue(dailyTrend(1, 1));

      const { spend, monthOverMonth } = await summary();

      expect(monthOverMonth.data.currentWindow).toEqual({ start: '2026-10-01', end: '2026-10-01' });
      expect(monthOverMonth.data.previousWindow).toEqual({ start: '2026-09-01', end: '2026-09-01' });
      expect(spend.data.finishedThrough).toBe('2026-10-01');
    } finally {
      process.env.TZ = originalTz;
    }
  });

  it('an inventory estimate has no finishedThrough', async () => {
    jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockRejectedValue(new Error('AWS_NOT_CONNECTED'));
    const { spend } = await summary(fixturePool({ total: '25.00', estimated: '3', resources: '3' }));

    expect(spend.provenance).toBe('estimated');
    expect(spend.data.finishedThrough).toBeNull();
  });
});

describe('GET /api/platform/costs/summary -- request handling', () => {
  it('requires an organization', async () => {
    const controller = new StatsController(fixturePool());
    const { req, res, json, status } = mockReqRes(null);

    await controller.getCostSummary(req, res);

    expect(status).toHaveBeenCalledWith(401);
    expect(json.mock.calls[0][0].success).toBe(false);
  });

  it('queries only the authenticated organization', async () => {
    const spy = jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockResolvedValue({
      total: 1, byService: [], period: { start: '2026-09-01', end: '2026-09-28' }, fetchedAt: FETCHED_AT,
    });
    jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue([]);
    const pool = fixturePool();

    await summary(pool);

    expect(spy).toHaveBeenCalledWith(ORG_ID);
    for (const [, params] of (pool.query as jest.Mock).mock.calls) expect(params).toEqual([ORG_ID]);
  });

  it('an unexpected failure returns a generic error, not the raw message', async () => {
    const controller = new StatsController(fixturePool());
    jest.spyOn((controller as any).costContext, 'gatherCostContext').mockRejectedValue(new Error('relation "x" does not exist'));
    const { req, res, json, status } = mockReqRes();

    await controller.getCostSummary(req, res);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ success: false, error: 'Failed to load cost summary' });
  });
});

describe('GET /api/platform/costs/trend -- a failure is not an empty success', () => {
  it('a Cost Explorer failure is a 502, not { success: true, data: [] }', async () => {
    jest.spyOn(awsCostService, 'fetchCostTrend').mockRejectedValue(new Error('ThrottlingException: rate exceeded'));
    const { req, res, json, status } = mockReqRes(ORG_ID, { range: '30d' });

    await new StatsController(fixturePool()).getCostTrend(req, res);

    expect(status).toHaveBeenCalledWith(502);
    expect(json.mock.calls[0][0]).toEqual({ success: false, error: 'The AWS Cost Explorer trend could not be retrieved' });
  });

  it('no connected account is still an honest empty series', async () => {
    jest.spyOn(awsCostService, 'fetchCostTrend').mockRejectedValue(new Error(`AWS_NOT_CONNECTED: org ${ORG_ID}`));
    const { req, res, json, status } = mockReqRes(ORG_ID, { range: '30d' });

    await new StatsController(fixturePool()).getCostTrend(req, res);

    expect(status).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith({ success: true, data: [] });
  });

  it('a successful series is returned unchanged, including real $0 and sub-dollar days', async () => {
    const points = dailyTrend(0.37, 0);
    jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue(points);
    const { req, res, json } = mockReqRes(ORG_ID, { range: '90d' });

    await new StatsController(fixturePool()).getCostTrend(req, res);

    expect(json).toHaveBeenCalledWith({ success: true, data: points });
  });
});
