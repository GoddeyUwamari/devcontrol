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

/** The backend's per-point report state (cost-trend-report-state.ts). */
export type CostReportState = 'final' | 'updating' | 'not_reported'

/** The trend point fields this module reads. */
export interface TrendReportFields {
  reportState?: CostReportState | (string & {})
  provisional?: boolean
  lineItems?: number
}

/**
 * A trend period AWS Cost Explorer has not reported yet: the backend's
 * reportState 'not_reported' (a period after the series' last one with line
 * items). Its 0 is "nothing reported yet", never a measured $0, so a chart
 * leaves it out (DAY1-D14). A backend that predates reportState: still inside
 * the reporting lag (`provisional`) with no line item at all. Points from a
 * backend that predates both flags are never treated as unreported.
 */
export function isNotReportedYet(point: TrendReportFields): boolean {
  if (point.reportState !== undefined) return point.reportState === 'not_reported'
  return point.provisional === true && point.lineItems === 0
}

/**
 * A trend period AWS Cost Explorer is still updating (reportState
 * 'updating'): drawn lighter, its amount is "so far". Only the backend's
 * reportState says so; nothing is inferred from the calendar here.
 */
export function isStillUpdating(point: TrendReportFields): boolean {
  return point.reportState === 'updating'
}

/** The tooltip for a period Cost Explorer has not reported yet: no amounts, never $0.00. */
export const NOT_REPORTED_TOOLTIP = 'Not reported yet by AWS Cost Explorer'

/** The tooltip for a period Cost Explorer is still updating, with its amount so far (already formatted). */
export function stillUpdatingTooltip(amountSoFar: string): string {
  return `Still updating · ${amountSoFar} so far. AWS Cost Explorer may still add charges.`
}

/** The legend entry for the lighter, still-updating bars (DAY1-D7's string, capitalized). */
export const STILL_UPDATING_LEGEND = 'Latest days still updating'

/** Shown under a daily trend that leaves out days Cost Explorer has not reported yet. */
export const NOT_REPORTED_DAYS_NOTE = "Days AWS Cost Explorer hasn't reported yet are not drawn"

const MONTH_NAME = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/**
 * The note for a trend's unreported periods, or null when there are none:
 * daily trends say days are not drawn; a monthly trend names the month with
 * no billed days yet ("December: no billed days yet").
 */
export function unreportedTrendNote(points: ReadonlyArray<{ date: string } & TrendReportFields>, unit: 'day' | 'month'): string | null {
  const unreported = points.filter(isNotReportedYet)
  if (unreported.length === 0) return null
  if (unit === 'day') return NOT_REPORTED_DAYS_NOTE
  const last = unreported[unreported.length - 1]
  return `${MONTH_NAME[Number(last.date.slice(5, 7)) - 1]}: no billed days yet`
}
