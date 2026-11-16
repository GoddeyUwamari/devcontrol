/**
 * costReportStates (cost-trend-report-state.ts), the per-point rule, on its
 * own. The real production series is in
 * controllers/__tests__/trend-lag-real-evidence.test.ts; these are synthetic.
 */
import { costReportStates, isProvisional, reportStateCounts, updatingWindowStart, UPDATING_WINDOW_DAYS } from '../cost-trend-report-state';

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

  it('no line items anywhere: every day final (real $0), unless Cost Explorer marks it Estimated', () => {
    expect(costReportStates([day('2026-11-15', 0), day('2026-11-16', 0)], NOW)).toEqual(['final', 'final']);
    expect(costReportStates([day('2026-11-15', 0), day('2026-11-16', 0, true)], NOW)).toEqual(['final', 'updating']);
  });

  it('Estimated = true makes any older day updating; Estimated = false changes nothing', () => {
    expect(costReportStates([day('2026-10-01', 8, true), day('2026-10-02', 8, false), day('2026-11-16', 8)], NOW)).toEqual(['updating', 'final', 'updating']);
  });

  it('not_reported wins over Estimated: a day with no line items after the last reported one has no amount to update', () => {
    expect(costReportStates([day('2026-11-15', 8), day('2026-11-16', 0, true)], NOW)).toEqual(['updating', 'not_reported']);
  });

  it('monthly points use the month\'s last day', () => {
    expect(costReportStates([day('2026-10-31', 5), day('2026-11-30', 5)], NOW)).toEqual(['final', 'updating']);
    expect(costReportStates([day('2026-10-31', 5), day('2026-11-30', 0)], new Date('2026-11-02T00:00:00Z'))).toEqual(['updating', 'not_reported']);
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
