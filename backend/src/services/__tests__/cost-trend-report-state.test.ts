/**
 * costReportStates (cost-trend-report-state.ts), the per-point rule, on its
 * own. The real production series is in
 * controllers/__tests__/trend-lag-real-evidence.test.ts; these are synthetic.
 */
import { costReportStates, isProvisional, notReportedWindowStart, NOT_REPORTED_WINDOW_DAYS, reportStateCounts, updatingWindowStart, UPDATING_WINDOW_DAYS } from '../cost-trend-report-state';

const NOW = new Date('2026-11-16T11:30:00.000Z');
const day = (lastDay: string, lineItems: number, estimated: boolean | null = null) => ({ lastDay, lineItems, estimated });

describe('costReportStates', () => {
  it('the window is today-3 .. today', () => {
    expect(UPDATING_WINDOW_DAYS).toBe(3);
    expect(updatingWindowStart(NOW)).toBe('2026-11-13');
  });

  it('the production shape: last line-item day (today-3) updating, the days after it not reported, earlier final', () => {
    expect(costReportStates([day('2026-11-12', 8), day('2026-11-13', 8), day('2026-11-14', 0), day('2026-11-15', 0), day('2026-11-16', 0)], NOW))
      .toEqual(['final', 'updating', 'not_reported', 'not_reported', 'not_reported']);
  });

  it('a zero-line-item day BEFORE the last line-item day is a real $0 (final), not a gap', () => {
    expect(costReportStates([day('2026-11-10', 8), day('2026-11-11', 0), day('2026-11-12', 8)], NOW)).toEqual(['final', 'final', 'final']);
  });

  it('no line items anywhere: every day final (real $0), Estimated or not', () => {
    expect(costReportStates([day('2026-11-15', 0), day('2026-11-16', 0)], NOW)).toEqual(['final', 'final']);
    expect(costReportStates([day('2026-11-15', 0, true), day('2026-11-16', 0, true)], NOW)).toEqual(['final', 'final']);
  });

  it('R-1: Estimated = true does not change any state (recorded only)', () => {
    const periods = [day('2026-10-01', 8), day('2026-10-02', 8), day('2026-11-12', 8), day('2026-11-13', 8), day('2026-11-14', 0)];
    const flagged = periods.map((p) => ({ ...p, estimated: true }));
    const without = costReportStates(periods, NOW);
    expect(without).toEqual(['final', 'final', 'final', 'updating', 'not_reported']);
    expect(costReportStates(flagged, NOW)).toEqual(without);
    expect(costReportStates(periods.map((p) => ({ ...p, estimated: false })), NOW)).toEqual(without);
  });

  it('not_reported wins over Estimated: a day with no line items after the last reported one has no amount to update', () => {
    expect(costReportStates([day('2026-11-15', 8), day('2026-11-16', 0, true)], NOW)).toEqual(['updating', 'not_reported']);
  });

  it('M-1: not_reported only within today-7 .. today; last charge Oct 20, today Nov 16 -> Oct 21..Nov 8 real $0, Nov 9..16 not reported', () => {
    expect(NOT_REPORTED_WINDOW_DAYS).toBe(7);
    expect(notReportedWindowStart(NOW)).toBe('2026-11-09');
    const days: string[] = [];
    for (let t = Date.parse('2026-10-15T00:00:00Z'); t <= Date.parse('2026-11-16T00:00:00Z'); t += 86_400_000) days.push(new Date(t).toISOString().slice(0, 10));
    const states = costReportStates(days.map((d) => day(d, d <= '2026-10-20' ? 8 : 0)), NOW);
    const byDay = Object.fromEntries(days.map((d, i) => [d, states[i]]));
    expect(days.filter((d) => d <= '2026-10-20').every((d) => byDay[d] === 'final')).toBe(true);
    expect(days.filter((d) => d >= '2026-10-21' && d <= '2026-11-08').every((d) => byDay[d] === 'final')).toBe(true);
    expect(days.filter((d) => byDay[d] === 'not_reported')).toEqual(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16']);
  });

  it('M-1 monthly: an empty month that ended before today-7 is a real $0; the current empty month is not reported', () => {
    expect(costReportStates([day('2026-09-30', 5), day('2026-10-31', 0), day('2026-11-30', 0)], NOW)).toEqual(['final', 'final', 'not_reported']);
  });

  it('monthly points use the month\'s last day', () => {
    expect(costReportStates([day('2026-10-31', 5), day('2026-11-30', 5)], NOW)).toEqual(['final', 'updating']);
    expect(costReportStates([day('2026-10-31', 5), day('2026-11-30', 0)], new Date('2026-11-02T00:00:00Z'))).toEqual(['updating', 'not_reported']);
  });

  describe('round 2: the last charged day stays updating while a later day within today-7 is not reported', () => {
    const NOV17 = new Date('2026-11-17T03:00:00.000Z');
    /** Every UTC day from `from` through `through`, each with line items through `charged` and none after. */
    const series = (from: string, through: string, charged: string) => {
      const out: ReturnType<typeof day>[] = [];
      for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${through}T00:00:00Z`); t += 86_400_000) {
        const d = new Date(t).toISOString().slice(0, 10);
        out.push(day(d, d <= charged ? 8 : 0));
      }
      return out;
    };

    it('the Nov 17 case: Nov 13 (last line items, today-4) updating, Nov 14-17 not reported, Nov 10-12 final', () => {
      expect(updatingWindowStart(NOV17)).toBe('2026-11-14');
      expect(costReportStates(series('2026-11-10', '2026-11-17', '2026-11-13'), NOV17))
        .toEqual(['final', 'final', 'final', 'updating', 'not_reported', 'not_reported', 'not_reported', 'not_reported']);
    });

    it('normal 1-day and 2-day lag: unchanged (the last charged day is inside today-3 anyway)', () => {
      expect(costReportStates(series('2026-11-13', '2026-11-17', '2026-11-16'), NOV17)).toEqual(['final', 'final', 'final', 'updating', 'not_reported']);
      expect(costReportStates(series('2026-11-13', '2026-11-17', '2026-11-15'), NOV17)).toEqual(['final', 'final', 'updating', 'not_reported', 'not_reported']);
    });

    it('a 6-day lag: the last charge at today-6 is updating, today-5 .. today not reported', () => {
      expect(costReportStates(series('2026-11-09', '2026-11-17', '2026-11-11'), NOV17))
        .toEqual(['final', 'final', 'updating', 'not_reported', 'not_reported', 'not_reported', 'not_reported', 'not_reported', 'not_reported']);
    });

    it('the bound is today-7: a last charge on today-7 is updating, on today-8 final (a stopped account: no updating)', () => {
      expect(notReportedWindowStart(NOV17)).toBe('2026-11-10');
      const at7 = costReportStates(series('2026-11-08', '2026-11-17', '2026-11-10'), NOV17);
      expect(at7.slice(0, 3)).toEqual(['final', 'final', 'updating']);
      expect(at7.slice(3).every((s) => s === 'not_reported')).toBe(true);
      const at8 = costReportStates(series('2026-11-08', '2026-11-17', '2026-11-09'), NOV17);
      expect(at8).not.toContain('updating');
      expect(at8.slice(0, 2)).toEqual(['final', 'final']);
      expect(at8.filter((s) => s === 'not_reported')).toHaveLength(8);
    });

    it('a stopped account (last charge Oct 20, now Nov 17): no updating day; Oct 21..Nov 9 final $0, Nov 10..17 not reported (M-1)', () => {
      const states = costReportStates(series('2026-10-15', '2026-11-17', '2026-10-20'), NOV17);
      expect(states).not.toContain('updating');
      expect(states.filter((s) => s === 'not_reported')).toHaveLength(8);
    });

    it('final days stay final: only the last charged day can be updating, however many empty days follow', () => {
      const states = costReportStates(series('2026-11-10', '2026-11-17', '2026-11-13'), NOV17);
      expect(states.filter((s) => s === 'updating')).toHaveLength(1);
      // A zero day before the last charge is a real $0, still final.
      expect(costReportStates([day('2026-11-11', 8), day('2026-11-12', 0), day('2026-11-13', 8), day('2026-11-14', 0)], NOV17))
        .toEqual(['final', 'final', 'updating', 'not_reported']);
    });

    it('the series ends on the last charged day (nothing later): the today-3 minimum alone decides', () => {
      expect(costReportStates([day('2026-11-12', 8), day('2026-11-13', 8)], NOV17)).toEqual(['final', 'final']);
      expect(costReportStates([day('2026-11-13', 8), day('2026-11-14', 8)], NOV17)).toEqual(['final', 'updating']);
    });

    it('the month boundary: Oct 28 last charged at Nov 2 -> updating with Oct 29..Nov 2 not reported; monthly: October updating while November is empty', () => {
      const NOV2 = new Date('2026-11-02T12:00:00.000Z');
      expect(costReportStates(series('2026-10-26', '2026-11-02', '2026-10-28'), NOV2))
        .toEqual(['final', 'final', 'updating', 'not_reported', 'not_reported', 'not_reported', 'not_reported', 'not_reported']);
      expect(costReportStates([day('2026-09-30', 5), day('2026-10-31', 5), day('2026-11-30', 0)], new Date('2026-11-06T00:00:00Z')))
        .toEqual(['final', 'updating', 'not_reported']);
      // October ended before today-7 (Nov 9 at Nov 16): final, as M-1.
      expect(costReportStates([day('2026-09-30', 5), day('2026-10-31', 5), day('2026-11-30', 0)], NOW)).toEqual(['final', 'final', 'not_reported']);
    });
  });

  it('provisional is true for updating and not_reported only', () => {
    expect([isProvisional('final'), isProvisional('updating'), isProvisional('not_reported')]).toEqual([false, true, true]);
  });
});

describe('reportStateCounts', () => {
  it('counts the days inside [start, endExclusive); null when none carries a state', () => {
    const daily = [
      { date: '2026-10-31', reportState: 'final' as const },
      { date: '2026-11-01', reportState: 'final' as const },
      { date: '2026-11-02', reportState: 'updating' as const },
      { date: '2026-11-03', reportState: 'not_reported' as const },
    ];
    expect(reportStateCounts(daily, '2026-11-01', '2026-11-04')).toEqual({ final: 1, updating: 1, notReported: 1 });
    expect(reportStateCounts([{ date: '2026-11-01' }], '2026-11-01', '2026-11-02')).toBeNull();
  });
});
