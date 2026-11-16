/**
 * DAY1-D14: a trend period AWS Cost Explorer has not reported yet (provisional,
 * no line items) is "not reported yet", never a measured $0; points from a
 * backend that predates the flags are never treated that way. Synthetic data.
 */
import { describe, it, expect } from 'vitest'
import { isNotReportedYet, isStillUpdating, NOT_REPORTED_DAYS_NOTE, NOT_REPORTED_TOOLTIP, STILL_UPDATING_LEGEND, stillUpdatingTooltip, unreportedTrendNote } from '../cost-trend-basis'
import { LATEST_DAYS_REPORTING } from '../../app/(app)/costs/cost-display'

describe('isNotReportedYet', () => {
  it('only a provisional period with no line items', () => {
    expect(isNotReportedYet({ provisional: true, lineItems: 0 })).toBe(true)
    expect(isNotReportedYet({ provisional: true, lineItems: 2 })).toBe(false)
    expect(isNotReportedYet({ provisional: false, lineItems: 0 })).toBe(false)
    expect(isNotReportedYet({})).toBe(false)
    expect(isNotReportedYet({ provisional: true })).toBe(false)
  })
})

describe('unreportedTrendNote', () => {
  const day = (date: string, lineItems: number, provisional: boolean) => ({ date, lineItems, provisional })

  it('daily: days not drawn', () => {
    expect(unreportedTrendNote([day('2026-11-30', 2, true), day('2026-12-01', 0, true)], 'day')).toBe(NOT_REPORTED_DAYS_NOTE)
    expect(NOT_REPORTED_DAYS_NOTE).toBe("Days AWS Cost Explorer hasn't reported yet are not drawn")
  })

  it('monthly on Dec 1: "December: no billed days yet"', () => {
    expect(unreportedTrendNote([day('2026-11-01', 2, true), day('2026-12-01', 0, true)], 'month')).toBe('December: no billed days yet')
  })

  it('nothing unreported: no note', () => {
    expect(unreportedTrendNote([day('2026-12-01', 2, true), day('2026-12-02', 1, true)], 'day')).toBeNull()
    expect(unreportedTrendNote([{ date: '2026-12-01' }], 'month')).toBeNull()
  })
})

describe('reportState (trend-lag-build.md): the backend decides, the frontend only reads it', () => {
  it('not_reported is a gap whatever provisional/lineItems say; final and updating are drawn', () => {
    expect(isNotReportedYet({ reportState: 'not_reported', lineItems: 0, provisional: true })).toBe(true)
    expect(isNotReportedYet({ reportState: 'final', lineItems: 0, provisional: true })).toBe(false)
    expect(isNotReportedYet({ reportState: 'updating', lineItems: 0, provisional: true })).toBe(false)
  })

  it('only reportState updating is still updating (no calendar inference, no fallback from provisional)', () => {
    expect(isStillUpdating({ reportState: 'updating' })).toBe(true)
    expect(isStillUpdating({ reportState: 'final' })).toBe(false)
    expect(isStillUpdating({ reportState: 'not_reported' })).toBe(false)
    expect(isStillUpdating({ provisional: true, lineItems: 8 })).toBe(false)
  })

  it('the approved strings, exactly', () => {
    expect(NOT_REPORTED_TOOLTIP).toBe('Not reported yet by AWS Cost Explorer')
    expect(stillUpdatingTooltip('$0.06')).toBe('Still updating · $0.06 so far. AWS Cost Explorer may still add charges.')
    expect(STILL_UPDATING_LEGEND).toBe('Latest days still updating')
    // DAY1-D7: one string for the concept, capitalized for a legend.
    expect(STILL_UPDATING_LEGEND).toBe(LATEST_DAYS_REPORTING.charAt(0).toUpperCase() + LATEST_DAYS_REPORTING.slice(1))
  })

  it('the not-drawn note follows reportState', () => {
    expect(unreportedTrendNote([{ date: '2026-11-13', reportState: 'updating' }, { date: '2026-11-14', reportState: 'not_reported' }], 'day')).toBe(NOT_REPORTED_DAYS_NOTE)
    expect(unreportedTrendNote([{ date: '2026-11-13', reportState: 'updating' }], 'day')).toBeNull()
  })
})
