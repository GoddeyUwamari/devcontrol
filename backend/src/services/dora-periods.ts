/**
 * Period arithmetic for GET /api/metrics/dora. Pure functions, no database,
 * no clock: every function takes the request's one captured `now` (or the
 * windows derived from it) as an argument.
 *
 * Windows are rolling and half-open, N × 24 h long, computed in epoch
 * milliseconds (so they are exact whatever the host time zone or DST):
 *   current  = [now − N×24h,  now)
 *   previous = [now − 2N×24h, now − N×24h)
 * previous.endAt === current.startAt, so a deployment is in at most one.
 *
 * Daily series: one entry per UTC calendar day (00:00:00.000Z up to, not
 * including, the next 00:00:00.000Z) that shares at least one millisecond with
 * the current window, ascending. That is N + 1 days, the first and last
 * clipped (`partial: true`), except when `now` is exactly 00:00:00.000Z: then
 * the window is N whole UTC days and no day is partial.
 */

export const DAY_MS = 86_400_000;

export interface PeriodWindow {
  /** Inclusive. */
  startAt: Date;
  /** Exclusive. */
  endAt: Date;
  days: number;
}

export interface DailyCountRow {
  /** UTC date, YYYY-MM-DD. */
  day: string;
  succeeded: number;
  failed: number;
}

export interface DoraDailyEntry {
  /** UTC date, YYYY-MM-DD. */
  date: string;
  succeeded: number;
  failed: number;
  /** succeeded + failed (finished). */
  total: number;
  /** True when only part of this UTC day is inside the window (first and last day). */
  partial: boolean;
}

export interface DoraBusiestDay {
  date: string;
  /** Finished deployments that day: succeeded + failed. */
  total: number;
  succeeded: number;
  failed: number;
  partial: boolean;
  /** How many days in the series share this maximum total (>= 1). */
  tiedDays: number;
}

export function rollingWindows(now: Date, days: number): { current: PeriodWindow; previous: PeriodWindow } {
  const endMs = now.getTime();
  if (!Number.isFinite(endMs)) throw new Error('rollingWindows: now is not a valid date');
  if (!Number.isInteger(days) || days <= 0) throw new Error('rollingWindows: days must be a positive integer');
  const span = days * DAY_MS;
  return {
    current: { startAt: new Date(endMs - span), endAt: new Date(endMs), days },
    previous: { startAt: new Date(endMs - 2 * span), endAt: new Date(endMs - span), days },
  };
}

/** YYYY-MM-DD of the UTC day containing `ms`. */
export function utcDateString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function utcMidnight(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

/** First and last UTC dates the window touches (the last millisecond inside it is endAt − 1). */
export function windowDateRange(window: PeriodWindow): { start: string; end: string } {
  return {
    start: utcDateString(window.startAt.getTime()),
    end: utcDateString(window.endAt.getTime() - 1),
  };
}

/** Every UTC day that intersects the window, ascending, with its partial flag. */
export function utcDaysInWindow(window: PeriodWindow): Array<{ date: string; partial: boolean }> {
  const startMs = window.startAt.getTime();
  const endMs = window.endAt.getTime();
  const out: Array<{ date: string; partial: boolean }> = [];
  for (let dayStart = utcMidnight(startMs); dayStart < endMs; dayStart += DAY_MS) {
    const covered = Math.min(dayStart + DAY_MS, endMs) - Math.max(dayStart, startMs);
    out.push({ date: utcDateString(dayStart), partial: covered < DAY_MS });
  }
  return out;
}

/**
 * The zero-filled daily series of the window from the grouped database rows.
 * A row whose date is outside the window is a programming error (the query is
 * bounded by the same window) and throws rather than being dropped silently.
 */
export function buildDailySeries(window: PeriodWindow, rows: readonly DailyCountRow[]): DoraDailyEntry[] {
  const series = utcDaysInWindow(window).map(({ date, partial }) => ({
    date, succeeded: 0, failed: 0, total: 0, partial,
  }));
  const byDate = new Map(series.map((entry) => [entry.date, entry]));
  for (const row of rows) {
    const entry = byDate.get(row.day);
    if (!entry) throw new Error(`buildDailySeries: ${row.day} is outside the window`);
    entry.succeeded += row.succeeded;
    entry.failed += row.failed;
    entry.total = entry.succeeded + entry.failed;
  }
  return series;
}

/**
 * The day with the most finished deployments. Ties go to the most recent tied
 * day, with tiedDays counting every day at the maximum. Null when nothing
 * finished. Depends only on the series' dates, never on row order.
 */
export function pickBusiestDay(daily: readonly DoraDailyEntry[]): DoraBusiestDay | null {
  let best: DoraDailyEntry | null = null;
  let tiedDays = 0;
  for (const entry of daily) {
    if (entry.total <= 0) continue;
    if (!best || entry.total > best.total) {
      best = entry;
      tiedDays = 1;
    } else if (entry.total === best.total) {
      tiedDays += 1;
      if (entry.date > best.date) best = entry;
    }
  }
  if (!best) return null;
  return {
    date: best.date,
    total: best.total,
    succeeded: best.succeeded,
    failed: best.failed,
    partial: best.partial,
    tiedDays,
  };
}

/** Round half away from zero to `dp` places; never returns -0. */
export function roundTo(value: number, dp: number): number {
  const factor = 10 ** dp;
  const rounded = Math.sign(value) * Math.round(Math.abs(value) * factor) / factor;
  return rounded === 0 ? 0 : rounded;
}

/**
 * Relative change from `previous` to `current` in percent, one decimal.
 * Null unless previous > 0: there is nothing to compare against.
 */
export function relativeChangePercent(current: number, previous: number): number | null {
  if (!(previous > 0) || !Number.isFinite(current)) return null;
  return roundTo(((current - previous) / previous) * 100, 1);
}
