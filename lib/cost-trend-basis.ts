/**
 * The basis of every figure built from GET /api/platform/costs/trend. The
 * backend reads Cost Explorer UnblendedCost by service with no record-type
 * filter, so credits and refunds are already netted into each service. It then
 * floors each cost category (and, in the per-service chart view, each service)
 * at $0 per period (AWSCostService queryCostTrend): a credit larger than its
 * bucket's charges in that period counts only down to $0, so a trend or
 * forecast total can be higher than the bill. Month-to-date spend
 * (GET /api/platform/costs/summary) is Cost Explorer's own net total, with no
 * floor.
 */
export const TREND_TOTALS_NOTE = 'After credits and refunds; amounts below $0 count as $0'

/**
 * A trend period AWS Cost Explorer has not reported yet: still inside its
 * reporting lag (`provisional`, AWSCostService queryCostTrend) and no line
 * item at all. Its 0 is "nothing reported yet", never a measured $0, so a chart
 * leaves it out (DAY1-D14). Points from a backend that predates the flags are
 * never treated as unreported.
 */
export function isNotReportedYet(point: { provisional?: boolean; lineItems?: number }): boolean {
  return point.provisional === true && point.lineItems === 0
}

/** Shown under a daily trend that leaves out days Cost Explorer has not reported yet. */
export const NOT_REPORTED_DAYS_NOTE = "Days AWS Cost Explorer hasn't reported yet are not drawn"

const MONTH_NAME = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/**
 * The note for a trend's unreported periods, or null when there are none:
 * daily trends say days are not drawn; a monthly trend names the month with
 * no billed days yet ("December: no billed days yet").
 */
export function unreportedTrendNote(points: ReadonlyArray<{ date: string; provisional?: boolean; lineItems?: number }>, unit: 'day' | 'month'): string | null {
  const unreported = points.filter(isNotReportedYet)
  if (unreported.length === 0) return null
  if (unit === 'day') return NOT_REPORTED_DAYS_NOTE
  const last = unreported[unreported.length - 1]
  return `${MONTH_NAME[Number(last.date.slice(5, 7)) - 1]}: no billed days yet`
}
