/**
 * The one backend truth about the current UTC month's AWS Cost Explorer
 * month-to-date figure (day1-step1.md, "Shared contract"): which reporting
 * period it is, whether Cost Explorer has reported anything for it yet, and
 * whether its amount may be used as a number. Every month-to-date consumer
 * (cost summary, Dashboard, Costs, Services, Infrastructure, AI summary, AI
 * chat, AI reports, Ask AI) reads this instead of inferring a state from the
 * amount, so "nothing reported yet" never becomes $0.
 *
 * The state is decided by evidence first, with the calendar only as a guard:
 *   - Cost Explorer's month result has no SERVICE line items (or no result at
 *     all for the month while the previous month's is there) AND no day of the
 *     month is past Cost Explorer's reporting lag  -> no_billed_days_yet
 *   - it has line items AND no day is past the lag  -> latest_days_updating
 *   - at least one day of the month is past the lag -> month_to_date
 *     (any amount: a real $0 with no line items, or a net credit)
 *   - Cost Explorer gave no usable result           -> unavailable
 * ResultByTime.Estimated is recorded (ceEstimated) but never decides the
 * state: its day-level meaning is not documented.
 *
 * Pure: no AWS, database or clock reads beyond the `now` it is given.
 */

/**
 * Cost Explorer keeps filling in a day's charges for 24-48 hours, so today and
 * yesterday (UTC, Cost Explorer's own day boundary) are provisional.
 */
export const PROVISIONAL_COST_DAYS = 2;

/** The last UTC day whose Cost Explorer charges are treated as finished: today (UTC) minus PROVISIONAL_COST_DAYS. */
export function costFinishedThrough(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - PROVISIONAL_COST_DAYS)).toISOString().slice(0, 10);
}

/** The day before an exclusive YYYY-MM-DD end (calendar dates, UTC). */
function dayBefore(endExclusive: string): string {
  const [y, m, d] = endExclusive.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/**
 * The known states. The set is open: a consumer MUST treat a value it does not
 * know as "amount not usable" and show `reason.text`. Reserved for later:
 * 'closed' (a finalized previous month), 'stale', 'restated'.
 */
export type CostMonthStateValue =
  | 'no_billed_days_yet'
  | 'latest_days_updating'
  | 'month_to_date'
  | 'unavailable';

export type CostMonthReasonCode =
  | 'no_line_items_yet'
  | 'no_current_month_result'
  | 'cost_explorer_failed'
  | 'cost_metric_missing'
  | 'not_connected'
  | 'estimate_only';

export interface CostMonthPeriod {
  /** 'YYYY-MM' of the UTC calendar month. */
  month: string;
  /** First day of the month (YYYY-MM-DD). */
  start: string;
  /** Cost Explorer's exclusive End: tomorrow (UTC). */
  endExclusive: string;
  calendar: 'UTC';
}

export interface CostMonthState {
  version: 1;
  state: CostMonthStateValue;
  period: CostMonthPeriod;
  /** USD, net UnblendedCost after credits and refunds (no floor). null unless amountUsable. */
  amount: number | null;
  amountUsable: boolean;
  costBasis: 'unblended_net_after_credits';
  /** Cost Explorer SERVICE groups in the month result: the evidence for "nothing reported". */
  lineItems: number;
  /** Calendar rule: today (UTC) minus PROVISIONAL_COST_DAYS. */
  finishedThrough: string;
  /**
   * Evidence: the last UTC day of this month with at least one Cost Explorer
   * line item (from the daily trend). null = none this month, or not
   * determined (the caller had no daily trend).
   */
  billedThrough: string | null;
  /** ResultByTime.Estimated of the month result, recorded only. null = not returned. */
  ceEstimated: boolean | null;
  /** When Cost Explorer answered. */
  asOf: string | null;
  reason: { code: CostMonthReasonCode; text: string } | null;
  /** The previous UTC month's net total from the same request; null when Cost Explorer gave none. */
  previousMonth: {
    month: string;
    start: string;
    endExclusive: string;
    amount: number;
    /** That month's last day is still inside Cost Explorer's reporting lag. */
    latestDaysUpdating: boolean;
  } | null;
}

/** The current UTC month's identity for a month-to-date window (start = the 1st). */
export function costMonthPeriod(period: { start: string; end: string }): CostMonthPeriod {
  return { month: period.start.slice(0, 7), start: period.start, endExclusive: period.end, calendar: 'UTC' };
}

export interface CostMonthEvidence {
  /** The month-to-date window (start = the 1st of the UTC month, end = tomorrow, exclusive). */
  period: { start: string; end: string };
  /** Net total of the month result's line items; 0 when there are none. */
  total: number;
  lineItems: number;
  /** Whether Cost Explorer returned a result for the current month at all. */
  currentMonthResult: 'present' | 'absent';
  ceEstimated: boolean | null;
  asOf: string | null;
  previousMonth: { period: { start: string; end: string }; total: number } | null;
}

const NO_LINE_ITEMS_TEXT = 'AWS Cost Explorer has not reported any charges for this UTC month yet';

/**
 * Whether a Cost Explorer answer for the current month can be used at all:
 * a month with no result is only "nothing reported yet" while no day of the
 * month is past the reporting lag and the previous month's result is there
 * (Cost Explorer answered). Anything else is not a month the code can trust.
 */
export function absentCurrentMonthIsNoDataYet(period: { start: string }, previousMonthPresent: boolean, now: Date): boolean {
  return previousMonthPresent && costFinishedThrough(now) < period.start;
}

export function deriveCostMonthState(e: CostMonthEvidence, now: Date): CostMonthState {
  const finishedThrough = costFinishedThrough(now);
  const noFinishedDay = finishedThrough < e.period.start;
  const hasCharges = e.currentMonthResult === 'present' && (e.lineItems > 0 || e.total !== 0);

  const state: CostMonthStateValue = !noFinishedDay
    ? 'month_to_date'
    : hasCharges ? 'latest_days_updating' : 'no_billed_days_yet';
  const amountUsable = state !== 'no_billed_days_yet';

  return {
    version: 1,
    state,
    period: costMonthPeriod(e.period),
    amount: amountUsable ? e.total : null,
    amountUsable,
    costBasis: 'unblended_net_after_credits',
    lineItems: e.lineItems,
    finishedThrough,
    billedThrough: null,
    ceEstimated: e.ceEstimated,
    asOf: e.asOf,
    reason: state === 'no_billed_days_yet'
      ? { code: e.currentMonthResult === 'absent' ? 'no_current_month_result' : 'no_line_items_yet', text: NO_LINE_ITEMS_TEXT }
      : null,
    previousMonth: e.previousMonth
      ? {
          month: e.previousMonth.period.start.slice(0, 7),
          start: e.previousMonth.period.start,
          endExclusive: e.previousMonth.period.end,
          amount: e.previousMonth.total,
          latestDaysUpdating: finishedThrough < dayBefore(e.previousMonth.period.end),
        }
      : null,
  };
}

/** No usable Cost Explorer figure for the month: why, in a code and in words. */
export function unavailableCostMonthState(
  period: { start: string; end: string },
  reason: { code: CostMonthReasonCode; text: string },
  now: Date
): CostMonthState {
  return {
    version: 1,
    state: 'unavailable',
    period: costMonthPeriod(period),
    amount: null,
    amountUsable: false,
    costBasis: 'unblended_net_after_credits',
    lineItems: 0,
    finishedThrough: costFinishedThrough(now),
    billedThrough: null,
    ceEstimated: null,
    asOf: null,
    reason,
    previousMonth: null,
  };
}

/**
 * Adds the evidence-based billedThrough: the last day inside the month's
 * period on which the daily trend has at least one Cost Explorer line item.
 * Points without a lineItems count fall back to their byService breakdown.
 */
export function withBilledThrough(
  state: CostMonthState,
  daily: ReadonlyArray<{ date: string; lineItems?: number; byService?: unknown[] }> | null
): CostMonthState {
  if (!daily) return state;
  let last: string | null = null;
  for (const point of daily) {
    const day = point.date.slice(0, 10);
    if (day < state.period.start || day >= state.period.endExclusive) continue;
    const items = point.lineItems ?? point.byService?.length ?? 0;
    if (items > 0 && (last === null || day > last)) last = day;
  }
  return { ...state, billedThrough: last };
}

/** The month as a reader writes it, from 'YYYY-MM': "December 2026". */
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function monthName(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** "December 1, 2026" from 'YYYY-MM-DD'. */
export function longDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${d}, ${y}`;
}

/** "December" from 'YYYY-MM'. */
export function monthOnly(month: string): string {
  return MONTH_NAMES[Number(month.split('-')[1]) - 1];
}

/** The period in words: "December 1, 2026", or "December 1–2, 2026". */
export function periodWords(period: CostMonthPeriod): string {
  const [y, m, d] = period.start.split('-').map(Number);
  const lastDay = Number(lastDayOf(period).split('-')[2]);
  return d === lastDay ? `${MONTH_NAMES[m - 1]} ${d}, ${y}` : `${MONTH_NAMES[m - 1]} ${d}–${lastDay}, ${y}`;
}

/** The inclusive last day of the state's period. */
export function lastDayOf(period: CostMonthPeriod): string {
  return dayBefore(period.endExclusive);
}

/**
 * A Cost Explorer group's amount for the metric the cost queries request,
 * or a CostMetricMissingError when the group does not carry it: a missing
 * amount is never read as $0 (DAY1-D17).
 */
export const COST_METRIC_KEY = 'UnblendedCost';

export class CostMetricMissingError extends Error {
  readonly code = 'cost_metric_missing' as const;
  constructor() {
    super(`COST_METRIC_MISSING: a Cost Explorer result has no ${COST_METRIC_KEY} amount; the result was not used`);
    this.name = 'CostMetricMissingError';
  }
}

export function isCostMetricMissingError(error: unknown): error is CostMetricMissingError {
  return error instanceof CostMetricMissingError || (error as { code?: unknown } | null)?.code === 'cost_metric_missing';
}

export function costMetricAmount(group: { Metrics?: Record<string, { Amount?: string } | undefined> }): number {
  const raw = group.Metrics?.[COST_METRIC_KEY]?.Amount;
  const amount = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  if (!Number.isFinite(amount)) throw new CostMetricMissingError();
  return amount;
}
