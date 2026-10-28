/**
 * The one date formatter for the Security and Compliance pages (founder answer Q8, Oct 27): server times are UTC,
 * shown in the viewer's local time, no seconds, the year only when it isn't the current one.
 *
 * - "today, 2:00 PM", "yesterday, 2:00 PM", otherwise "Oct 27, 2:00 AM" ("Oct 27, 2025, 2:00 AM" in another year).
 * - Display only: staleness, the poll ceiling and polling keep comparing the raw timestamps.
 * - `timeZone` is for tests and callers that must pin a zone; left out, it is the viewer's.
 */

const ZONE = /(Z|[+-]\d{2}:?\d{2})$/i
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/** A server timestamp in ms. One without a zone is UTC (the server's zone), never the viewer's; null if unusable. */
export function parseServerTime(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || value.trim() === '') return null
  const text = value.trim()
  const iso = DATE_ONLY.test(text) || ZONE.test(text) ? text : `${text.replace(' ', 'T')}Z`
  const at = Date.parse(iso)
  return Number.isFinite(at) ? at : null
}

// Newer ICU puts a narrow no-break space before AM/PM.
const clean = (text: string) => text.replace(/[  ]/g, ' ')

/** The local calendar day as YYYY-MM-DD. */
function dayKey(at: number, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
}

function yearOf(at: number, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric' }).format(at)
}

/** "Oct 27", or "Oct 27, 2025" outside the current year, in local time; null for a missing or invalid time. */
export function formatLocalDay(value: string | number | null | undefined, now: number, timeZone?: string): string | null {
  const at = parseServerTime(value)
  if (at === null) return null
  const sameYear = yearOf(at, timeZone) === yearOf(now, timeZone)
  return new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) }).format(at)
}

/** "today, 2:00 PM", "yesterday, 2:00 PM" or "Oct 27, 2:00 AM", in local time; null for a missing or invalid time. */
export function formatLocalWhen(value: string | number | null | undefined, now: number, timeZone?: string): string | null {
  const at = parseServerTime(value)
  if (at === null) return null
  const time = clean(new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(at))
  const today = dayKey(now, timeZone)
  const [y, m, d] = today.split('-').map(Number)
  // The day before today's calendar date (noon UTC keeps the arithmetic off any zone's midnight).
  const yesterday = new Date(Date.UTC(y, m - 1, d - 1, 12)).toISOString().slice(0, 10)
  const day = dayKey(at, timeZone)
  if (day === today) return `today, ${time}`
  if (day === yesterday) return `yesterday, ${time}`
  return `${formatLocalDay(at, now, timeZone)}, ${time}`
}
