/**
 * The Costs page's figure wording keeps each evidence state distinct: a real
 * 0% / $0 is shown as such, a missing or failed figure is shown as missing
 * (never 0%, "flat", or $0), and estimates say they are estimates. Sections
 * here are fixtures shaped like GET /api/platform/costs/summary responses.
 */
import { describe, it, expect } from 'vitest'
import type { ContextSection, CostMonthOverMonthEvidence, CostSpendEvidence } from '@/lib/types'
import { describeAnnualizedSavings, describeComparisonWindows, describeMonthOverMonth, describeSpend, formatUsd, noFinishedDayThisMonth } from '../cost-display'

const ready = { isLoading: false, isError: false }

function momSection(changePercent: number | null, changeAmount: number, state: 'available' | 'partial' = 'available'): ContextSection<CostMonthOverMonthEvidence> {
  return {
    state, source: 'DevControl month-over-month comparison', provenance: 'derived', asOf: null, coverage: null, reason: null,
    data: {
      currentWindow: { start: '2026-09-01', end: '2026-09-27' },
      previousWindow: { start: '2026-08-01', end: '2026-08-27' },
      currentWindowTotal: 100 + changeAmount,
      previousWindowTotal: changePercent === null ? 0 : 100,
      changeAmount,
      changePercent,
      currentWindowIncludesToday: true,
    },
  }
}

function noData<T>(state: 'unavailable' | 'error' | 'not_supported'): ContextSection<T> {
  return { state, source: 'x', provenance: null, asOf: null, coverage: null, reason: 'fixture reason', data: null }
}

function spendSection(amount: number, provenance: 'actual' | 'estimated', state: 'available' | 'partial' = 'available'): ContextSection<CostSpendEvidence> {
  return {
    state, source: provenance === 'actual' ? 'AWS Cost Explorer' : 'DevControl inventory cost estimate', provenance,
    asOf: '2026-09-27T09:00:00.000Z', coverage: null, reason: null,
    data: { amount, basis: provenance === 'actual' ? 'billed_month_to_date' : 'estimated_monthly_run_rate', lastDayInProgress: false },
  }
}

const FLAT_OR_ZERO = /flat|stable|no change|unchanged|^0%$|^\+?0%/i

describe('month-over-month', () => {
  it('a genuine 0% change is shown as 0% and flat', () => {
    const d = describeMonthOverMonth(momSection(0, 0), ready)
    expect(d.value).toBe('0%')
    expect(d.sub).toMatch(/flat/i)
    expect(d.changePercent).toBe(0)
    expect(d.direction).toBe('flat')
  })

  it('a positive change shows its real percentage', () => {
    const d = describeMonthOverMonth(momSection(12.5, 12.5), ready)
    expect(d.value).toBe('+12.5%')
    expect(d.sub).toMatch(/up/i)
    expect(d.changePercent).toBe(12.5)
    expect(d.direction).toBe('up')
  })

  it('a negative change shows its real percentage', () => {
    const d = describeMonthOverMonth(momSection(-8.3, -8.3), ready)
    expect(d.value).toBe('-8.3%')
    expect(d.sub).toMatch(/down/i)
    expect(d.changePercent).toBe(-8.3)
    expect(d.direction).toBe('down')
  })

  it('an unavailable comparison is shown as not available -- not 0%, not flat', () => {
    for (const state of ['unavailable', 'not_supported'] as const) {
      const d = describeMonthOverMonth(noData(state), ready)
      expect(d.value).toBe('—')
      expect(d.value).not.toMatch(FLAT_OR_ZERO)
      expect(d.sub).toMatch(/not available/i)
      expect(d.sub).not.toMatch(/flat|stable|no change|unchanged/i)
      expect(d.changePercent).toBeNull()
      expect(d.direction).toBeNull()
    }
  })

  it('a failed comparison, or a failed request, is shown as an error -- not 0%, not flat', () => {
    for (const d of [
      describeMonthOverMonth(noData('error'), ready),
      describeMonthOverMonth(undefined, { isLoading: false, isError: true }),
    ]) {
      expect(d.value).toBe('—')
      expect(d.sub).toMatch(/could not be retrieved/i)
      expect(d.sub).not.toMatch(/flat|stable|no change|unchanged/i)
      expect(d.changePercent).toBeNull()
    }
  })

  it('loading is not a comparison', () => {
    const d = describeMonthOverMonth(undefined, { isLoading: true, isError: false })
    expect(d.value).toBe('—')
    expect(d.changePercent).toBeNull()
  })

  it('an undefined percentage (the same days last month were $0) shows the dollar change, not 0%', () => {
    const d = describeMonthOverMonth(momSection(null, 3.2), ready)
    expect(d.value).toBe('+$3.20')
    expect(d.sub).toMatch(/% change undefined/)
    expect(d.changePercent).toBeNull()
  })

  it('discloses that the current window includes today, still being billed', () => {
    const d = describeMonthOverMonth(momSection(12.5, 12.5), ready)
    expect(d.sub).toBe("Spend up vs the same days last month · today's spend still being billed")
    expect(d.includesToday).toBe(true)
    expect(describeMonthOverMonth(noData('unavailable'), ready).includesToday).toBe(false)
  })

  it('a partial comparison says so', () => {
    expect(describeMonthOverMonth(momSection(4, 4, 'partial'), ready).sub).toMatch(/partial data/)
  })
})

describe('month-to-date spend', () => {
  it('a real $0 Cost Explorer month is shown as actual $0.00', () => {
    const d = describeSpend(spendSection(0, 'actual'), ready)
    expect(d.value).toBe('$0.00')
    expect(d.sub).toMatch(/^Actual · AWS Cost Explorer/)
    expect(d.provenance).toBe('actual')
  })

  it('a net-credit month keeps its sign and says it is net of credits', () => {
    const d = describeSpend(spendSection(-12.34, 'actual'), ready)
    expect(d.value).toBe('-$12.34')
    expect(d.sub).toMatch(/net of credits/)
  })

  it('a sub-dollar month keeps its cents', () => {
    expect(describeSpend(spendSection(0.42, 'actual'), ready).value).toBe('$0.42')
  })

  it('an inventory estimate is labeled an estimate and never AWS billed spend', () => {
    const d = describeSpend(spendSection(42.5, 'estimated'), ready)
    expect(d.label).toBe('Estimated Monthly Spend')
    expect(d.value).toBe('$42.50/mo')
    expect(d.sub).toMatch(/not AWS billed spend/)
    expect(d.sub).not.toMatch(/^Actual|Live from AWS/)
    expect(d.provenance).toBe('estimated')
  })

  it('unavailable and error are missing figures -- never $0', () => {
    const unavailable = describeSpend(noData('unavailable'), ready)
    expect(unavailable.value).toBe('—')
    expect(unavailable.sub).toMatch(/not available/i)
    expect(unavailable.amount).toBeNull()

    for (const d of [describeSpend(noData('error'), ready), describeSpend(undefined, { isLoading: false, isError: true })]) {
      expect(d.value).toBe('—')
      expect(d.sub).toMatch(/could not be retrieved/i)
      expect(d.amount).toBeNull()
    }
  })
})

describe('annualized savings wording', () => {
  it('says the annual figure is an annualized estimate derived from the monthly estimate', () => {
    const text = describeAnnualizedSavings(0.96)
    expect(text).toBe('$12/yr annualized estimate (monthly estimate × 12)')
  })

  it('never implies realized, actual, billed, or guaranteed savings, and carries no "% of current spend"', () => {
    const text = describeAnnualizedSavings(1)
    expect(text).toMatch(/annualized estimate/)
    expect(text).not.toMatch(/realized|actual|billed|guaranteed|saved|% of current spend/i)
  })
})

describe('formatUsd', () => {
  it('keeps cents and sign', () => {
    expect(formatUsd(0)).toBe('$0.00')
    expect(formatUsd(0.004)).toBe('$0.00')
    expect(formatUsd(0.05)).toBe('$0.05')
    expect(formatUsd(-3.5)).toBe('-$3.50')
    expect(formatUsd(1234.5)).toBe('$1,234.50')
  })
})

describe('finished-day comparison wording', () => {
  const billed = (start: string, endExclusive: string, finishedThrough?: string | null): ContextSection<CostSpendEvidence> => ({
    state: 'available', source: 'AWS Cost Explorer', provenance: 'actual', asOf: null, coverage: null, reason: null,
    period: { kind: 'range', start, endExclusive },
    data: { amount: 1, basis: 'billed_month_to_date', lastDayInProgress: true, ...(finishedThrough === undefined ? {} : { finishedThrough }) },
  })

  it('noFinishedDayThisMonth: only when finishedThrough is before the period start', () => {
    expect(noFinishedDayThisMonth(billed('2026-10-01', '2026-10-03', '2026-09-30'))).toBe(true)
    expect(noFinishedDayThisMonth(billed('2026-10-01', '2026-10-04', '2026-10-01'))).toBe(false)
    expect(noFinishedDayThisMonth(billed('2026-10-01', '2026-10-03'))).toBe(false)
    expect(noFinishedDayThisMonth(billed('2026-10-01', '2026-10-03', null))).toBe(false)
    expect(noFinishedDayThisMonth(undefined)).toBe(false)
  })

  it('the KPI says why there is no comparison yet, without a percentage', () => {
    const unavailable = { state: 'unavailable', source: 'x', provenance: null, asOf: null, coverage: null, reason: 'x', data: null } as ContextSection<CostMonthOverMonthEvidence>
    expect(describeMonthOverMonth(unavailable, { isLoading: false, isError: false }, { noFinishedDay: true })).toMatchObject({ value: '—', sub: 'No comparison yet · latest days still being reported', changePercent: null })
    expect(describeMonthOverMonth(unavailable, { isLoading: false, isError: false }).sub).toBe('Comparison not available · not enough comparable AWS Cost Explorer data')
  })

  it('describeComparisonWindows', () => {
    expect(describeComparisonWindows({ currentWindow: { start: '2026-10-01', end: '2026-10-01' }, previousWindow: { start: '2026-09-01', end: '2026-09-01' } })).toBe('Oct 1 vs Sep 1')
    expect(describeComparisonWindows({ currentWindow: { start: '2026-10-01', end: '2026-10-13' }, previousWindow: { start: '2026-09-01', end: '2026-09-13' } })).toBe('Oct 1–13 vs Sep 1–13')
    expect(describeComparisonWindows({ currentWindow: { start: '2027-03-01', end: '2027-03-28' }, previousWindow: { start: '2027-02-01', end: '2027-02-28' } })).toBe('Mar 1–28 vs Feb 1–28')
    expect(describeComparisonWindows({ currentWindow: { start: '2027-03-01', end: '2027-03-29' }, previousWindow: { start: '2027-02-01', end: '2027-02-28' } })).toBe('Mar 1–29 vs Feb 1–28 (Feb has only 28 days)')
  })
})
