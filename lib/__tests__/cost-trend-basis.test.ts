/**
 * DAY1-D14: a trend period AWS Cost Explorer has not reported yet (provisional,
 * no line items) is "not reported yet", never a measured $0; points from a
 * backend that predates the flags are never treated that way. Synthetic data.
 */
import { describe, it, expect } from 'vitest'
import { isNotReportedYet, NOT_REPORTED_DAYS_NOTE, unreportedTrendNote } from '../cost-trend-basis'

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
