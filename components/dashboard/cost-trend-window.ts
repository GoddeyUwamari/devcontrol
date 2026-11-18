/**
 * Which trend points the Dashboard cost trend draws, and how its x-axis reads.
 *
 * The backend's 7d range is DAILY today-7 .. today: the 30d series' last 8
 * days (AWSCostService.fetchCostTrend, today-bar TB-D1), so every day carries
 * the 30-day view's report state. The 7-day view draws the 7 UTC days ending
 * TODAY: today-6 .. today, the last bar labelled "Today" (founder option b,
 * 2026-11-18: Cost Explorer can report a partial current day). Today is never
 * drawn as a finished day (cost-trend-chart.tsx). Each point keeps its own
 * report state, which the backend decided over the whole series
 * (cost-trend-report-state.ts): choosing which days to draw never changes one.
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

/** The 7 UTC days ending today: today-6 .. today (YYYY-MM-DD, oldest first). */
export function sevenUtcDaysEndingToday(now: Date): string[] {
  const today = utcDayOf(now)
  return Array.from({ length: SEVEN_DAY_BARS }, (_, i) => addUtcDays(today, i - (SEVEN_DAY_BARS - 1)))
}

/** The points of `points` that fall on the 7 UTC days ending today, in their order. */
export function sevenDayPoints<T extends { date: string }>(points: ReadonlyArray<T>, now: Date): T[] {
  const days = new Set(sevenUtcDaysEndingToday(now))
  return points.filter((p) => days.has(p.date.slice(0, 10)))
}

/** The 7-day view's x-axis label for today's bar (T1). */
export const TODAY_LABEL = 'Today'

/** Whether a daily point is today (UTC, Cost Explorer's day boundary). */
export function isUtcToday(date: string, now: Date): boolean {
  return date.slice(0, 10) === utcDayOf(now)
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
