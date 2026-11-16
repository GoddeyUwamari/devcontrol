/**
 * The Costs page's Spend Trend points (DAY1-D14, DAY1-D15, trend-lag-build.md):
 * each label is the UTC calendar date AWS Cost Explorer reports, never shifted
 * into the browser's time zone. The backend's reportState decides how a
 * period is drawn:
 *   - final: on the `actual` line;
 *   - updating: on the lighter `updating` line (with the last final point
 *     before it, so the two lines join), its amount "so far";
 *   - not_reported: on neither line (a gap), never drawn as $0.
 */
import { isNotReportedYet, isStillUpdating, NOT_REPORTED_TOOLTIP, stillUpdatingTooltip, type CostReportState } from '@/lib/cost-trend-basis'
import { formatUsd, roundCents } from './cost-display'

export interface TrendPointInput {
  date: string
  total: number
  lineItems?: number
  reportState?: CostReportState
  provisional?: boolean
}

export interface CostsTrendRow {
  date: string
  /** Final periods (and, for a backend without reportState, every reported one). */
  actual: number | null
  /** Periods Cost Explorer is still updating, plus the final point just before them. */
  updating: number | null
  forecast: null
  /** 'not_reported' and 'updating' rows carry their state for the tooltip; a final row has 'final'. */
  reportState: CostReportState
  /** The period's amount (so far), or null when it is not reported yet. */
  total: number | null
}

/** "Dec 1" for a YYYY-MM-DD (or ISO) date, read as a UTC calendar date. */
export function utcChartLabel(date: string): string {
  return new Date(`${date.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export function costsTrendChartData(points: ReadonlyArray<TrendPointInput>): CostsTrendRow[] {
  const rows: CostsTrendRow[] = points.map((p) => {
    const state: CostReportState = isNotReportedYet(p) ? 'not_reported' : isStillUpdating(p) ? 'updating' : 'final'
    const amount = state === 'not_reported' ? null : roundCents(p.total)
    return {
      date: utcChartLabel(p.date),
      actual: state === 'final' ? amount : null,
      updating: state === 'updating' ? amount : null,
      forecast: null,
      reportState: state,
      total: amount,
    }
  })
  // Join the lighter line to the final line: a final point right before an updating one is on both.
  rows.forEach((row, i) => {
    const next = rows[i + 1]
    if (row.reportState === 'final' && next?.reportState === 'updating') row.updating = row.actual
  })
  return rows
}

/**
 * The tooltip's lines for one row: a not-reported period has no amount (never
 * $0.00); an updating one gives its amount so far; a final one its amount per
 * unit, as before.
 */
export function costsTrendTooltipLines(row: Pick<CostsTrendRow, 'reportState' | 'total'> | undefined, unit: 'day' | 'month'): string[] {
  if (!row) return []
  if (row.reportState === 'not_reported' || row.total === null) return [NOT_REPORTED_TOOLTIP]
  if (row.reportState === 'updating') return [stillUpdatingTooltip(formatUsd(row.total))]
  return [`Actual Spend: ${formatUsd(row.total)}/${unit}`]
}
