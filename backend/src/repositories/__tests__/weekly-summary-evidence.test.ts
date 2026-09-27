/**
 * Weekly Summary cost evidence: WeeklySummaryRepository.getWeeklySpendSections()
 * against a mocked Cost Explorer trend (AWSCostService.fetchCostTrend) and a
 * fake DB client for the inventory estimate. The property under test is the
 * evidence state -- actual vs estimated vs unavailable vs error, complete vs
 * partial -- and the complete-day windows, not Cost Explorer itself.
 *
 * `now` is fixed at Monday 2026-09-28 09:00 UTC (the cron's slot), so:
 *   current window  = 2026-09-21 .. 2026-09-27 (7 complete UTC days)
 *   previous window = 2026-09-14 .. 2026-09-20
 *   today (2026-09-28) is still being billed and must never be counted.
 */
jest.mock('../../services/aws-cost.service', () => ({
  ...jest.requireActual('../../services/aws-cost.service'),
  __esModule: true,
  default: {
    fetchCostTrend: jest.fn(),
    getCostTrendFetchedAt: jest.fn(() => '2026-09-28T08:55:00.000Z'),
  },
}));

import { Pool } from 'pg';
import awsCostService from '../../services/aws-cost.service';
import { WeeklySummaryRepository, weeklySummaryPeriod, WEEKLY_ALERTS_NOT_SUPPORTED_REASON } from '../weekly-summary.repository';

const fetchCostTrend = awsCostService.fetchCostTrend as jest.Mock;
const NOW = new Date('2026-09-28T09:00:00.000Z');
const ORG = '11111111-1111-4111-8111-111111111111';

/** One trend point per day from 2026-08-29 through today, `total` per day from `amountFor`. */
function trend(amountFor: (day: string) => number | undefined) {
  const points = [];
  for (let t = Date.parse('2026-08-29T00:00:00Z'); t <= Date.parse('2026-09-28T00:00:00Z'); t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    const total = amountFor(day);
    if (total === undefined) continue;
    points.push({ date: day, compute: total, storage: 0, database: 0, network: 0, other: 0, total });
  }
  return points;
}

function fakeClient(inventoryRow: Record<string, string> | Error) {
  const query = jest.fn(async () => {
    if (inventoryRow instanceof Error) throw inventoryRow;
    return { rows: [inventoryRow] };
  });
  return { query } as any;
}

const repository = new WeeklySummaryRepository({} as Pool);
const period = weeklySummaryPeriod(NOW);

beforeEach(() => {
  fetchCostTrend.mockReset();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  (console.error as jest.Mock).mockRestore?.();
});

describe('weeklySummaryPeriod', () => {
  it('uses the last 7 complete UTC days and excludes the current, still-billing day', () => {
    expect(period.cost).toEqual({ start: '2026-09-21', endExclusive: '2026-09-28' });
    expect(period.previousCost).toEqual({ start: '2026-09-14', endExclusive: '2026-09-21' });
  });

  it('never produces a future date', () => {
    const late = weeklySummaryPeriod(new Date('2026-09-28T23:59:59.000Z'));
    expect(late.cost.endExclusive).toBe('2026-09-28');
    expect(Date.parse(late.delivery.end)).toBeLessThanOrEqual(Date.parse('2026-09-28T23:59:59.000Z'));
  });
});

describe('WeeklySummaryRepository.getWeeklySpendSections', () => {
  it('A/F: actual non-zero spend stays actual and sums only complete days -- today is never counted', async () => {
    // $10/day everywhere, but today (partial) carries a huge value that must be excluded.
    fetchCostTrend.mockResolvedValue(trend(day => (day === '2026-09-28' ? 9999 : day >= '2026-09-21' ? 20 : 10)));
    const client = fakeClient({});

    const s = await repository.getWeeklySpendSections(ORG, period, client);

    expect(s.currentWeekSpend.state).toBe('available');
    expect(s.currentWeekSpend.provenance).toBe('actual');
    expect(s.currentWeekSpend.data).toEqual({ amount: 140, basis: 'gross_daily_charges_before_credits' });
    expect(s.currentWeekSpend.period).toEqual({ kind: 'range', start: '2026-09-21', endExclusive: '2026-09-28' });
    expect(s.previousWeekSpend.data?.amount).toBe(70);
    expect(s.weekOverWeek.state).toBe('available');
    expect(s.weekOverWeek.provenance).toBe('derived');
    expect(s.weekOverWeek.data).toEqual({ currentTotal: 140, previousTotal: 70, changeAmount: 70, changePercent: 100 });
    // Cost Explorer had evidence: the inventory estimate is never consulted.
    expect(s.inventoryEstimate).toBeNull();
    expect(client.query).not.toHaveBeenCalled();
  });

  it('B: a real $0 Cost Explorer week stays actual $0 -- not unavailable, not an inventory estimate', async () => {
    fetchCostTrend.mockResolvedValue(trend(() => 0));
    const client = fakeClient({ total_resources: '5', priced_resources: '5', total_cost: '300' });

    const s = await repository.getWeeklySpendSections(ORG, period, client);

    expect(s.currentWeekSpend.state).toBe('available');
    expect(s.currentWeekSpend.provenance).toBe('actual');
    expect(s.currentWeekSpend.data?.amount).toBe(0);
    expect(s.inventoryEstimate).toBeNull();
    expect(client.query).not.toHaveBeenCalled();
    // previous week is $0 too: a percentage is undefined, never "0%".
    expect(s.weekOverWeek.data?.changePercent).toBeNull();
  });

  it('C: weekly figures carry the gross-before-credits basis of the floored trend series', async () => {
    fetchCostTrend.mockResolvedValue(trend(() => 3));
    const s = await repository.getWeeklySpendSections(ORG, period, fakeClient({}));
    expect(s.currentWeekSpend.data?.basis).toBe('gross_daily_charges_before_credits');
    expect(s.weekOverWeek.coverage).toMatch(/gross daily charges before credits/);
  });

  it('D: a Cost Explorer failure with no inventory estimate is error/unavailable -- never $0', async () => {
    fetchCostTrend.mockRejectedValue(new Error('ThrottlingException: rate exceeded'));
    const client = fakeClient({ total_resources: '0', priced_resources: '0', total_cost: '0' });

    const s = await repository.getWeeklySpendSections(ORG, period, client);

    expect(s.currentWeekSpend.state).toBe('error');
    expect(s.currentWeekSpend.data).toBeNull();
    expect(s.weekOverWeek.state).toBe('error');
    expect(s.weekOverWeek.data).toBeNull();
    expect(s.inventoryEstimate?.state).toBe('unavailable');
    expect(s.inventoryEstimate?.data).toBeNull();
    // The raw AWS error never reaches the customer-facing reason.
    expect(s.currentWeekSpend.reason).not.toMatch(/Throttling/);
  });

  it('D: no AWS connection is unavailable (not an error, not $0)', async () => {
    fetchCostTrend.mockRejectedValue(new Error(`AWS_NOT_CONNECTED: org ${ORG} has not connected an AWS account`));
    const s = await repository.getWeeklySpendSections(ORG, period, fakeClient({ total_resources: '0', priced_resources: '0', total_cost: '0' }));
    expect(s.currentWeekSpend.state).toBe('unavailable');
    expect(s.currentWeekSpend.reason).toBe('no AWS account is connected');
    expect(s.currentWeekSpend.data).toBeNull();
  });

  it('D: an empty Cost Explorer response is unavailable with 0 of 7 days, never a $0 week', async () => {
    fetchCostTrend.mockResolvedValue([]);
    const s = await repository.getWeeklySpendSections(ORG, period, fakeClient({ total_resources: '0', priced_resources: '0', total_cost: '0' }));
    expect(s.currentWeekSpend.state).toBe('unavailable');
    expect(s.currentWeekSpend.completeness).toMatchObject({ expected: 7, received: 0 });
    expect(s.currentWeekSpend.data).toBeNull();
  });

  it('E: the inventory fallback is an estimated, point-in-time run-rate -- never actual spend for the week', async () => {
    fetchCostTrend.mockRejectedValue(new Error('AWS_NOT_CONNECTED: no account'));
    const client = fakeClient({ total_resources: '10', priced_resources: '8', total_cost: '412.5' });

    const s = await repository.getWeeklySpendSections(ORG, period, client);

    expect(s.inventoryEstimate?.provenance).toBe('estimated');
    expect(s.inventoryEstimate?.period).toEqual({ kind: 'point_in_time' });
    expect(s.inventoryEstimate?.state).toBe('partial'); // 8 of 10 resources priced
    expect(s.inventoryEstimate?.data).toEqual({ monthlyRunRate: 412.5, pricedResources: 8, totalResources: 10 });
    // No week-over-week from an estimate.
    expect(s.weekOverWeek.data).toBeNull();
  });

  it('F: missing Cost Explorer days make the week partial, name the missing days, and qualify the comparison', async () => {
    fetchCostTrend.mockResolvedValue(trend(day => (day === '2026-09-25' || day === '2026-09-26' ? undefined : 10)));
    const s = await repository.getWeeklySpendSections(ORG, period, fakeClient({}));

    expect(s.currentWeekSpend.state).toBe('partial');
    expect(s.currentWeekSpend.completeness).toEqual({
      unit: 'days of daily Cost Explorer data',
      expected: 7,
      received: 5,
      missing: ['2026-09-25', '2026-09-26'],
    });
    expect(s.currentWeekSpend.data?.amount).toBe(50); // no synthetic fill for the missing days
    expect(s.weekOverWeek.state).toBe('partial');
  });

  it('P: queries only the requesting organization', async () => {
    fetchCostTrend.mockRejectedValue(new Error('AWS_NOT_CONNECTED: no account'));
    const client = fakeClient({ total_resources: '1', priced_resources: '1', total_cost: '5' });

    await repository.getWeeklySpendSections(ORG, period, client);

    expect(fetchCostTrend).toHaveBeenCalledWith(ORG, '30d');
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('organization_id = $1'), [ORG]);
  });
});

describe('WeeklySummaryRepository.getWeeklyAlerts', () => {
  it('J: alert counts are not_supported (alert_history is not org-attributed) -- never a count of 0', () => {
    const alerts = repository.getWeeklyAlerts();
    expect(alerts.state).toBe('not_supported');
    expect(alerts.data).toBeNull();
    expect(alerts.reason).toBe(WEEKLY_ALERTS_NOT_SUPPORTED_REASON);
  });
});
