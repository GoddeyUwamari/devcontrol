import { formatDistance } from 'date-fns'

/**
 * How far in the browser's future a System Intelligence `computed_at` may be
 * and still be read as "now". It matches the display's own resolution:
 * date-fns renders any difference under ~30s as "less than a minute", so
 * treating up to 30s ahead as now only corrects the tense ("in less than a
 * minute" -> "less than a minute ago"), never the magnitude shown. Normal
 * server/browser clock skew is well under a second (measured ~275ms in
 * production); anything further ahead can't be explained by it and is
 * treated as invalid rather than presented as fresh.
 */
export const CLOCK_SKEW_TOLERANCE_MS = 30_000

/**
 * Relative "calculated … ago" text for a System Intelligence `computed_at` --
 * the time the result was calculated, never a future event. Pure: the caller
 * passes the current time, so every render re-interprets the timestamp
 * against a fresh `now`.
 *
 * Returns null (render nothing) for a missing, non-string, empty, or
 * unparseable value, or a timestamp more than CLOCK_SKEW_TOLERANCE_MS ahead
 * of `now`. Deliberately not lib/utils' getRelativeTime, which reads any
 * future timestamp -- however far ahead -- as "just now".
 */
export function formatCalculatedAgo(computedAt: unknown, now: Date): string | null {
  if (typeof computedAt !== 'string') return null

  const timestamp = new Date(computedAt)
  if (Number.isNaN(timestamp.getTime())) return null

  const aheadMs = timestamp.getTime() - now.getTime()
  if (aheadMs > CLOCK_SKEW_TOLERANCE_MS) return null

  return formatDistance(aheadMs > 0 ? now : timestamp, now, { addSuffix: true })
}
