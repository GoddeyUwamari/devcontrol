/**
 * The shared month state (cost-month-state.ts, day1-step1.md "Shared
 * contract"): evidence decides the state, the calendar only guards it, a
 * month with nothing reported is never an amount, and a Cost Explorer group
 * without the requested metric is never $0 (DAY1-D17). Pure: no AWS call.
 */
import {
  absentCurrentMonthIsNoDataYet,
  costFinishedThrough,
  costMetricAmount,
  CostMetricMissingError,
  deriveCostMonthState,
  isCostMetricMissingError,
  unavailableCostMonthState,
  withBilledThrough,
  type CostMonthEvidence,
} from '../cost-month-state';

const NOVEMBER = { period: { start: '2026-11-01', end: '2026-12-01' }, total: 399 };

function evidence(o: Partial<CostMonthEvidence> & { end: string }): CostMonthEvidence {
  return {
    period: { start: '2026-12-01', end: o.end },
    total: 0,
    lineItems: 0,
    currentMonthResult: 'present',
    ceEstimated: true,
    asOf: '2026-12-01T00:30:00.000Z',
    previousMonth: NOVEMBER,
    ...o,
  };
}

const at = (iso: string) => new Date(iso);

describe('deriveCostMonthState', () => {
  it('Dec 1 00:30Z, no line items: no billed days yet; the amount is null, never 0', () => {
    const s = deriveCostMonthState(evidence({ end: '2026-12-02' }), at('2026-12-01T00:30:00Z'));
    expect(s).toMatchObject({
      version: 1,
      state: 'no_billed_days_yet',
      period: { month: '2026-12', start: '2026-12-01', endExclusive: '2026-12-02', calendar: 'UTC' },
      amount: null,
      amountUsable: false,
      costBasis: 'unblended_net_after_credits',
      lineItems: 0,
      finishedThrough: '2026-11-29',
      billedThrough: null,
      ceEstimated: true,
      reason: { code: 'no_line_items_yet' },
      previousMonth: { month: '2026-11', start: '2026-11-01', endExclusive: '2026-12-01', amount: 399, latestDaysUpdating: true },
    });
  });

  it('Dec 1 with a charge already reported: latest days updating, the amount is usable', () => {
    const s = deriveCostMonthState(evidence({ end: '2026-12-02', total: 13.3, lineItems: 2 }), at('2026-12-01T18:00:00Z'));
    expect(s).toMatchObject({ state: 'latest_days_updating', amount: 13.3, amountUsable: true, reason: null });
  });

  it('Dec 2, nothing reported: still no billed days yet (evidence, not the calendar)', () => {
    const s = deriveCostMonthState(evidence({ end: '2026-12-03' }), at('2026-12-02T00:30:00Z'));
    expect(s).toMatchObject({ state: 'no_billed_days_yet', amount: null, finishedThrough: '2026-11-30' });
    // November's last day is now past the reporting lag.
    expect(s.previousMonth?.latestDaysUpdating).toBe(false);
  });

  it('Dec 2 with charges: latest days updating', () => {
    expect(deriveCostMonthState(evidence({ end: '2026-12-03', total: 13.3, lineItems: 2 }), at('2026-12-02T18:00:00Z')).state).toBe('latest_days_updating');
  });

  it('Dec 3: a day of the month has finished -> month to date', () => {
    const s = deriveCostMonthState(evidence({ end: '2026-12-04', total: 26.6, lineItems: 2 }), at('2026-12-03T00:30:00Z'));
    expect(s).toMatchObject({ state: 'month_to_date', amount: 26.6, amountUsable: true, finishedThrough: '2026-12-01' });
  });

  it('mid-month with no line items: a real, measured $0 (month to date, amount 0)', () => {
    const s = deriveCostMonthState({ ...evidence({ end: '2026-12-16' }), period: { start: '2026-12-01', end: '2026-12-16' } }, at('2026-12-15T12:00:00Z'));
    expect(s).toMatchObject({ state: 'month_to_date', amount: 0, amountUsable: true, lineItems: 0 });
  });

  it('a net-credit month is month to date with its negative amount', () => {
    expect(deriveCostMonthState(evidence({ end: '2026-12-16', total: -4.1, lineItems: 1 }), at('2026-12-15T12:00:00Z'))).toMatchObject({ state: 'month_to_date', amount: -4.1 });
  });

  it('a net-zero day 1 with line items is still a report (latest days updating, amount 0 usable)', () => {
    expect(deriveCostMonthState(evidence({ end: '2026-12-02', total: 0, lineItems: 1 }), at('2026-12-01T18:00:00Z'))).toMatchObject({ state: 'latest_days_updating', amount: 0, amountUsable: true });
  });

  it('no result for the month at all (Cost Explorer left it out): no billed days yet, its own reason code', () => {
    expect(deriveCostMonthState(evidence({ end: '2026-12-02', currentMonthResult: 'absent' }), at('2026-12-01T00:30:00Z')).reason?.code).toBe('no_current_month_result');
  });

  it('no previous month: previousMonth is null', () => {
    expect(deriveCostMonthState(evidence({ end: '2026-12-02', previousMonth: null }), at('2026-12-01T00:30:00Z')).previousMonth).toBeNull();
  });

  it('January: the period identity is the new year', () => {
    const s = deriveCostMonthState({ ...evidence({ end: '2027-01-02' }), period: { start: '2027-01-01', end: '2027-01-02' } }, at('2027-01-01T05:00:00Z'));
    expect(s.period.month).toBe('2027-01');
    expect(s.state).toBe('no_billed_days_yet');
  });
});

describe('absentCurrentMonthIsNoDataYet', () => {
  it('only while no day of the month is past the lag and the previous month was answered', () => {
    expect(absentCurrentMonthIsNoDataYet({ start: '2026-12-01' }, true, at('2026-12-01T00:30:00Z'))).toBe(true);
    expect(absentCurrentMonthIsNoDataYet({ start: '2026-12-01' }, true, at('2026-12-02T23:59:00Z'))).toBe(true);
    expect(absentCurrentMonthIsNoDataYet({ start: '2026-12-01' }, false, at('2026-12-01T00:30:00Z'))).toBe(false);
    expect(absentCurrentMonthIsNoDataYet({ start: '2026-12-01' }, true, at('2026-12-03T00:00:00Z'))).toBe(false);
  });
});

describe('costFinishedThrough', () => {
  it('is today (UTC) minus two days, whatever the server time zone', () => {
    expect(costFinishedThrough(at('2026-12-01T00:00:00Z'))).toBe('2026-11-29');
    expect(costFinishedThrough(at('2026-12-03T23:59:59Z'))).toBe('2026-12-01');
  });
});

describe('withBilledThrough', () => {
  const base = deriveCostMonthState(evidence({ end: '2026-12-04', total: 26.6, lineItems: 2 }), at('2026-12-03T00:30:00Z'));

  it('the last day of this month with a Cost Explorer line item', () => {
    const daily = [
      { date: '2026-11-30', lineItems: 2 },
      { date: '2026-12-01', lineItems: 2 },
      { date: '2026-12-02', lineItems: 1 },
      { date: '2026-12-03', lineItems: 0 },
    ];
    expect(withBilledThrough(base, daily).billedThrough).toBe('2026-12-02');
  });

  it('never a day of the previous month; null when this month has none', () => {
    expect(withBilledThrough(base, [{ date: '2026-11-30', lineItems: 2 }, { date: '2026-12-01', lineItems: 0 }]).billedThrough).toBeNull();
  });

  it('points from before lineItems existed fall back to their byService breakdown', () => {
    expect(withBilledThrough(base, [{ date: '2026-12-01', byService: [{}] }]).billedThrough).toBe('2026-12-01');
  });

  it('no daily trend: the state is unchanged (billedThrough stays null)', () => {
    expect(withBilledThrough(base, null)).toBe(base);
  });
});

describe('unavailableCostMonthState', () => {
  it('carries the period, a reason code and no amount', () => {
    expect(unavailableCostMonthState({ start: '2026-12-01', end: '2026-12-02' }, { code: 'cost_metric_missing', text: 'x' }, at('2026-12-01T00:30:00Z'))).toMatchObject({
      state: 'unavailable', amount: null, amountUsable: false, reason: { code: 'cost_metric_missing' }, period: { month: '2026-12' },
    });
  });
});

describe('costMetricAmount (DAY1-D17)', () => {
  it('reads UnblendedCost, negative included', () => {
    expect(costMetricAmount({ Metrics: { UnblendedCost: { Amount: '12.63' } } })).toBe(12.63);
    expect(costMetricAmount({ Metrics: { UnblendedCost: { Amount: '-4.10' } } })).toBe(-4.1);
    expect(costMetricAmount({ Metrics: { UnblendedCost: { Amount: '0' } } })).toBe(0);
  });

  it.each([
    ['no Metrics', {}],
    ['another metric key', { Metrics: { UNBLENDED_COST: { Amount: '12.63' } } }],
    ['no Amount', { Metrics: { UnblendedCost: {} } }],
    ['an empty Amount', { Metrics: { UnblendedCost: { Amount: '' } } }],
    ['a non-numeric Amount', { Metrics: { UnblendedCost: { Amount: 'n/a' } } }],
  ])('%s: throws cost_metric_missing, never 0', (_name, group) => {
    let thrown: unknown;
    try { costMetricAmount(group as never); } catch (e) { thrown = e; }
    expect(thrown).toBeInstanceOf(CostMetricMissingError);
    expect(isCostMetricMissingError(thrown)).toBe(true);
    expect((thrown as CostMetricMissingError).code).toBe('cost_metric_missing');
  });
});
