/**
 * dora-periods.ts: rolling half-open windows from one `now`, UTC-day daily
 * series with partial flags, busiest day and relative change. Pure; no
 * database and no clock.
 *
 * Every assertion is in UTC terms only, so the file passes under any TZ
 * (it is also run under TZ=America/New_York across a DST change, see d4-build.md).
 */
import {
  buildDailySeries,
  DAY_MS,
  pickBusiestDay,
  relativeChangePercent,
  rollingWindows,
  roundTo,
  utcDaysInWindow,
  windowDateRange,
  type DoraDailyEntry,
} from '../dora-periods';

const at = (iso: string) => new Date(iso);

describe('rollingWindows', () => {
  it.each([7, 30, 90])('%i days: current [now − N×24h, now), previous ends where current starts', (days) => {
    const now = at('2026-11-20T15:30:00.000Z');
    const { current, previous } = rollingWindows(now, days);
    expect(current.endAt.getTime()).toBe(now.getTime());
    expect(now.getTime() - current.startAt.getTime()).toBe(days * DAY_MS);
    expect(previous.endAt.getTime()).toBe(current.startAt.getTime());
    expect(previous.endAt.getTime() - previous.startAt.getTime()).toBe(days * DAY_MS);
    expect(current.days).toBe(days);
    expect(previous.days).toBe(days);
  });

  it('is exact N × 24 h across a DST change (no calendar arithmetic)', () => {
    // US DST ended 2026-11-01; a setDate()-based window on a New York host would be 25 h off.
    const { current } = rollingWindows(at('2026-11-05T12:00:00.000Z'), 7);
    expect(current.startAt.toISOString()).toBe('2026-10-29T12:00:00.000Z');
  });

  it('refuses an invalid now or length', () => {
    expect(() => rollingWindows(new Date('nope'), 7)).toThrow();
    expect(() => rollingWindows(at('2026-11-20T00:00:00Z'), 0)).toThrow();
    expect(() => rollingWindows(at('2026-11-20T00:00:00Z'), 1.5)).toThrow();
  });
});

describe('utcDaysInWindow / windowDateRange', () => {
  it('N + 1 UTC days, ascending, first and last partial', () => {
    const { current } = rollingWindows(at('2026-11-20T15:30:00.000Z'), 7);
    const days = utcDaysInWindow(current);
    expect(days).toHaveLength(8);
    expect(days.map((d) => d.date)).toEqual([
      '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20',
    ]);
    expect(days.map((d) => d.partial)).toEqual([true, false, false, false, false, false, false, true]);
    expect(windowDateRange(current)).toEqual({ start: '2026-11-13', end: '2026-11-20' });
  });

  it.each([7, 30, 90])('%i days → %i + 1 entries for any non-midnight now', (n) => {
    const { current } = rollingWindows(at('2026-03-08T07:00:00.001Z'), n);
    const days = utcDaysInWindow(current);
    expect(days).toHaveLength(n + 1);
    expect(days.filter((d) => d.partial).map((d) => d.date)).toEqual([days[0].date, days[n].date]);
  });

  it('now exactly at 00:00:00.000Z: N whole days, none partial, the empty day of now not included', () => {
    const { current } = rollingWindows(at('2026-11-20T00:00:00.000Z'), 7);
    const days = utcDaysInWindow(current);
    expect(days).toHaveLength(7);
    expect(days[0].date).toBe('2026-11-13');
    expect(days[6].date).toBe('2026-11-19');
    expect(days.every((d) => !d.partial)).toBe(true);
    expect(windowDateRange(current)).toEqual({ start: '2026-11-13', end: '2026-11-19' });
  });

  it('one millisecond after midnight: N + 1 days, the last 1 ms long and partial', () => {
    const { current } = rollingWindows(at('2026-11-20T00:00:00.001Z'), 7);
    const days = utcDaysInWindow(current);
    expect(days).toHaveLength(8);
    expect(days[7]).toEqual({ date: '2026-11-20', partial: true });
    expect(days[0]).toEqual({ date: '2026-11-13', partial: true });
  });
});

describe('buildDailySeries', () => {
  const { current } = rollingWindows(at('2026-11-20T15:30:00.000Z'), 7);

  it('zero-fills, keeps succeeded / failed / total per day, and sums to the rows', () => {
    const rows = [
      { day: '2026-11-13', succeeded: 1, failed: 0 },
      { day: '2026-11-16', succeeded: 0, failed: 2 },
      { day: '2026-11-20', succeeded: 3, failed: 1 },
    ];
    const daily = buildDailySeries(current, rows);
    expect(daily).toHaveLength(8);
    expect(daily[0]).toEqual({ date: '2026-11-13', succeeded: 1, failed: 0, total: 1, partial: true });
    expect(daily[1]).toEqual({ date: '2026-11-14', succeeded: 0, failed: 0, total: 0, partial: false });
    expect(daily[3]).toEqual({ date: '2026-11-16', succeeded: 0, failed: 2, total: 2, partial: false });
    expect(daily[7]).toEqual({ date: '2026-11-20', succeeded: 3, failed: 1, total: 4, partial: true });
    expect(daily.reduce((n, d) => n + d.total, 0)).toBe(7);
  });

  it('does not depend on row order', () => {
    const rows = [
      { day: '2026-11-20', succeeded: 3, failed: 1 },
      { day: '2026-11-13', succeeded: 1, failed: 0 },
    ];
    expect(buildDailySeries(current, rows)).toEqual(buildDailySeries(current, [...rows].reverse()));
  });

  it('throws on a row outside the window instead of dropping it', () => {
    expect(() => buildDailySeries(current, [{ day: '2026-11-12', succeeded: 1, failed: 0 }])).toThrow(/outside the window/);
  });
});

describe('pickBusiestDay', () => {
  const entry = (date: string, succeeded: number, failed: number, partial = false): DoraDailyEntry =>
    ({ date, succeeded, failed, total: succeeded + failed, partial });

  it('null when nothing finished (zero days never win)', () => {
    expect(pickBusiestDay([entry('2026-11-01', 0, 0), entry('2026-11-02', 0, 0)])).toBeNull();
    expect(pickBusiestDay([])).toBeNull();
  });

  it('the day with the most finished (succeeded + failed), not the most successes', () => {
    const busiest = pickBusiestDay([entry('2026-11-01', 3, 0), entry('2026-11-02', 1, 3), entry('2026-11-03', 2, 0)]);
    expect(busiest).toEqual({ date: '2026-11-02', total: 4, succeeded: 1, failed: 3, partial: false, tiedDays: 1 });
  });

  it('ties go to the most recent tied day, with tiedDays counting all of them, whatever the order', () => {
    const series = [entry('2026-11-01', 2, 0), entry('2026-11-02', 1, 0), entry('2026-11-03', 1, 1), entry('2026-11-04', 0, 2), entry('2026-11-05', 1, 0)];
    const expected = { date: '2026-11-04', total: 2, succeeded: 0, failed: 2, partial: false, tiedDays: 3 };
    expect(pickBusiestDay(series)).toEqual(expected);
    expect(pickBusiestDay([...series].reverse())).toEqual(expected);
    expect(pickBusiestDay([series[3], series[0], series[4], series[2], series[1]])).toEqual(expected);
  });

  it('a partial day competes like any other and keeps its flag', () => {
    expect(pickBusiestDay([entry('2026-11-01', 1, 0), entry('2026-11-02', 5, 0, true)])).toMatchObject({ date: '2026-11-02', partial: true });
  });
});

describe('relativeChangePercent / roundTo', () => {
  it('relative change, 1 dp, rounded half away from zero', () => {
    expect(relativeChangePercent(15, 10)).toBe(50);
    expect(relativeChangePercent(5, 10)).toBe(-50);
    expect(relativeChangePercent(0, 10)).toBe(-100);
    expect(relativeChangePercent(2, 3)).toBe(-33.3);
    expect(roundTo(-0.25, 1)).toBe(-0.3);
    expect(roundTo(0.25, 1)).toBe(0.3);
    expect(Object.is(roundTo(-0.01, 1), 0)).toBe(true);
  });

  it('null when the previous value is 0 or missing: never a 0 standing for "no comparison"', () => {
    expect(relativeChangePercent(5, 0)).toBeNull();
    expect(relativeChangePercent(0, 0)).toBeNull();
    expect(relativeChangePercent(5, Number.NaN)).toBeNull();
    expect(relativeChangePercent(5, -1)).toBeNull();
  });
});
