/**
 * Which trend points the Dashboard cost trend draws, and how its x-axis reads
 * (trend-lag round 2, founder-approved 2026-11-17).
 *
 * The backend's 7d range is DAILY today-7 .. today (AWSCostService
 * trendPeriodUtc). Today is never a full day, so the 7-day view draws exactly
 * the 7 full UTC days ending yesterday: today-7 .. today-1. Each point keeps
 * its own report state, which the backend decided over the whole series
 * (cost-trend-report-state.ts): leaving today out never changes another day.
 */

/** Bars in the 7-day view. */
export const SEVEN_DAY_BARS = 7

/** YYYY-MM-DD (UTC) of `d`. */
export function utcDayOf(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addUtcDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/** The 7 full UTC days ending yesterday: today-7 .. today-1 (YYYY-MM-DD, oldest first). */
export function sevenFullUtcDays(now: Date): string[] {
  const today = utcDayOf(now)
  return Array.from({ length: SEVEN_DAY_BARS }, (_, i) => addUtcDays(today, i - SEVEN_DAY_BARS))
}

/** The points of `points` that fall on the 7 full UTC days ending yesterday, in their order. */
export function sevenDayPoints<T extends { date: string }>(points: ReadonlyArray<T>, now: Date): T[] {
  const days = new Set(sevenFullUtcDays(now))
  return points.filter((p) => days.has(p.date.slice(0, 10)))
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * An x-axis / tooltip label: a date for every daily view ("Nov 10", never a
 * weekday), the month for the monthly views ("Nov 2026"). Read from the
 * YYYY-MM-DD itself, so the viewer's time zone never shifts the day.
 */
export function trendDateLabel(date: string, monthly: boolean): string {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number)
  if (!y || !m || (!monthly && !d)) return date
  return monthly ? `${MONTHS[m - 1]} ${y}` : `${MONTHS[m - 1]} ${d}`
}

/**
 * The x-axis tick interval: 0 (every label, never skipped) on the 7-day view;
 * the 30/90-day and monthly views may skip labels to fit ('preserveEnd').
 */
export function xAxisInterval(range: '7d' | '30d' | '90d' | '6mo' | '1yr'): 0 | 'preserveEnd' {
  return range === '7d' ? 0 : 'preserveEnd'
}
