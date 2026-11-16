/**
 * How far AWS Cost Explorer has reported each trend period, from evidence
 * (trend-lag-build.md). One backend truth per point; every page and AI path
 * only reads it.
 *
 *   not_reported  a period AFTER the last period with at least one Cost
 *                 Explorer line item, when the series has line items on some
 *                 earlier period. Cost Explorer has not reported it yet: it is
 *                 a gap, never $0.00. A series with no line items at all has
 *                 no not_reported periods (its $0 periods are real).
 *   updating      the most recent period with line items, when its last day is
 *                 within the last UPDATING_WINDOW_DAYS UTC days of today; or
 *                 any period whose Cost Explorer result has Estimated = true.
 *                 Its amount is "so far": Cost Explorer may still add charges.
 *   final         everything else.
 *
 * Production evidence (GET trend?range=7d, 2026-11-16 ~11:30 UTC): Nov 13 had
 * 8 line items but ~1 hour of EC2 compute, and Nov 14 had none, while the old
 * calendar rule (today minus PROVISIONAL_COST_DAYS) called both finished. Cost
 * Explorer lagged ~3 days, so the window counts today minus 3 as recent.
 *
 * Pure: no AWS, database or clock reads beyond the `now` it is given.
 */

export type CostReportState = 'final' | 'updating' | 'not_reported';

/**
 * The most recent period with line items is "updating" while its last day is
 * on or after today (UTC) minus this many days: today-3 .. today.
 */
export const UPDATING_WINDOW_DAYS = 3;

export interface ReportStateInput {
  /** The period's last UTC day (YYYY-MM-DD): the day itself for a daily point, the month's last day for a monthly one. */
  lastDay: string;
  /** Cost Explorer SERVICE groups in the period. */
  lineItems: number;
  /** ResultByTime.Estimated; null when Cost Explorer did not send it. */
  estimated: boolean | null;
}

/** today (UTC) minus UPDATING_WINDOW_DAYS, as YYYY-MM-DD. */
export function updatingWindowStart(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - UPDATING_WINDOW_DAYS)).toISOString().slice(0, 10);
}

/**
 * Each period's report state, in the order given (periods in time order, as
 * Cost Explorer returns them).
 */
export function costReportStates(periods: ReadonlyArray<ReportStateInput>, now: Date): CostReportState[] {
  let lastWithLineItems = -1;
  periods.forEach((p, i) => {
    if (p.lineItems > 0) lastWithLineItems = i;
  });
  const recentFrom = updatingWindowStart(now);
  return periods.map((p, i) => {
    if (lastWithLineItems >= 0 && i > lastWithLineItems) return 'not_reported';
    if (p.estimated === true) return 'updating';
    if (i === lastWithLineItems && p.lastDay >= recentFrom) return 'updating';
    return 'final';
  });
}

/** `provisional`, kept for older consumers: true unless the period is final. */
export function isProvisional(state: CostReportState): boolean {
  return state !== 'final';
}

/**
 * Counts of the report states of the trend's days inside [start, endExclusive)
 * (YYYY-MM-DD). null when no point there carries a report state (an older
 * backend's cached points), so a caller can tell "not determined" from "none".
 */
export function reportStateCounts(
  daily: ReadonlyArray<{ date: string; reportState?: CostReportState }>,
  start: string,
  endExclusive: string
): { final: number; updating: number; notReported: number } | null {
  let seen = false;
  const counts = { final: 0, updating: 0, notReported: 0 };
  for (const point of daily) {
    const day = point.date.slice(0, 10);
    if (day < start || day >= endExclusive || point.reportState === undefined) continue;
    seen = true;
    if (point.reportState === 'final') counts.final++;
    else if (point.reportState === 'updating') counts.updating++;
    else counts.notReported++;
  }
  return seen ? counts : null;
}
