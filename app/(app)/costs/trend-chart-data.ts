/**
 * The Costs page's Spend Trend points (DAY1-D14, DAY1-D15): each label is
 * the UTC calendar date AWS Cost Explorer reports, never shifted into the
 * browser's time zone, and a period Cost Explorer has not reported yet is
 * left out of the line (null), never drawn as $0.
 */
import { isNotReportedYet } from '@/lib/cost-trend-basis'
import { roundCents } from './cost-display'

export interface TrendPointInput {
  date: string
  total: number
  lineItems?: number
  provisional?: boolean
}

/** "Dec 1" for a YYYY-MM-DD (or ISO) date, read as a UTC calendar date. */
export function utcChartLabel(date: string): string {
  return new Date(`${date.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export function costsTrendChartData(points: ReadonlyArray<TrendPointInput>): { date: string; actual: number | null; forecast: number | null }[] {
  return points.map((p) => ({
    date: utcChartLabel(p.date),
    actual: isNotReportedYet(p) ? null : roundCents(p.total),
    forecast: null,
  }))
}
