/**
 * The Dashboard spend KPI (computeDashboardSpendCard) in real mode: each cost
 * evidence state reads distinctly, and a missing figure or comparison never
 * becomes $0, "Syncing…", or a flat trend. Sections are fixtures shaped like
 * GET /api/platform/costs/summary responses, not production data.
 */
import { describe, it, expect } from 'vitest'
import type { CostSummary } from '@/lib/types'
import { computeDashboardSpendCard } from '../dashboardSpendCard'

const ready = { isLoading: false, isError: false }

function spend(amount: number, provenance: 'actual' | 'estimated' = 'actual'): CostSummary['spend'] {
  return {
    state: 'available', source: provenance === 'actual' ? 'AWS Cost Explorer' : 'DevControl inventory cost estimate', provenance, asOf: null, coverage: null, reason: null,
    data: { amount, basis: provenance === 'actual' ? 'billed_month_to_date' : 'estimated_monthly_run_rate', lastDayInProgress: false },
  }
}
function missing<T>(state: 'unavailable' | 'error'): { state: typeof state; source: string; provenance: null; asOf: null; coverage: null; reason: string; data: T | null } {
  return { state, source: 'fixture', provenance: null, asOf: null, coverage: null, reason: 'fixture', data: null }
}
function mom(changePercent: number | null, changeAmount: number, previousWindowTotal = 10): CostSummary['monthOverMonth'] {
  return {
    state: 'available', source: 'DevControl month-over-month comparison', provenance: 'derived', asOf: null, coverage: null, reason: null,
    data: {
      currentWindow: { start: '2026-09-01', end: '2026-09-27' }, previousWindow: { start: '2026-08-01', end: '2026-08-27' },
      currentWindowTotal: previousWindowTotal + changeAmount, previousWindowTotal, changeAmount, changePercent, currentWindowIncludesToday: true,
    },
  }
}
const card = (costSummary: CostSummary) => computeDashboardSpendCard({ costSummary, ...ready })
const FLAT_OR_ZERO_CLAIM = /flat|stable|no change|unchanged|syncing/i

describe('Dashboard spend figure keeps its provenance', () => {
  it('actual $0 is actual $0.00 -- not "Syncing…", not an estimate', () => {
    const c = card({ spend: spend(0), monthOverMonth: mom(0, 0) })
    expect(c.label).toBe('Month-to-Date Spend')
    expect(c.value).toBe('$0.00')
    expect(c.captions[0]).toMatch(/^Actual · AWS Cost Explorer/)
  })

  it('a net credit stays negative and actual', () => {
    const c = card({ spend: spend(-12.34), monthOverMonth: mom(0, 0) })
    expect(c.value).toBe('-$12.34')
    expect(c.captions[0]).toMatch(/net of credits/)
  })

  it('a sub-dollar month keeps its cents', () => {
    expect(card({ spend: spend(0.42), monthOverMonth: mom(0, 0) }).value).toBe('$0.42')
  })

  it('an inventory estimate is labeled estimated, never AWS billed spend', () => {
    const c = card({ spend: spend(42.5, 'estimated'), monthOverMonth: missing('unavailable') as CostSummary['monthOverMonth'] })
    expect(c.label).toBe('Estimated Monthly Spend')
    expect(c.value).toBe('$42.50/mo')
    expect(c.captions[0]).toMatch(/not AWS billed spend/)
  })

  it('unavailable, error, and a failed request are "—" -- never $0', () => {
    const unavailable = card({ spend: missing('unavailable') as CostSummary['spend'], monthOverMonth: missing('unavailable') as CostSummary['monthOverMonth'] })
    expect(unavailable.value).toBe('—')
    expect(unavailable.captions[0]).toMatch(/Not available/)

    const error = card({ spend: missing('error') as CostSummary['spend'], monthOverMonth: missing('error') as CostSummary['monthOverMonth'] })
    expect(error.value).toBe('—')
    expect(error.captions[0]).toBe('Could not be retrieved')

    const failed = computeDashboardSpendCard({ costSummary: undefined, isLoading: false, isError: true })
    expect(failed.value).toBe('—')
    expect(failed.captions).toEqual(['Could not be retrieved', 'Month-over-month could not be retrieved'])
    for (const c of [unavailable, error, failed]) expect(c.value).not.toMatch(/\$/)
  })

  it('loading shows no figure and no claim', () => {
    const c = computeDashboardSpendCard({ costSummary: undefined, isLoading: true, isError: false })
    expect(c.value).toBe('—')
    expect(c.trend).toBeUndefined()
    expect(c.captions).toEqual([])
  })
})

describe('Dashboard month-over-month trend', () => {
  it('a real 0% is a flat 0% trend, with its MTD basis and the still-billing note', () => {
    const c = card({ spend: spend(10), monthOverMonth: mom(0, 0) })
    expect(c.trend).toEqual({ direction: 'flat', label: '0% vs same days last month', color: 'var(--text-warning)' })
    expect(c.captions).toContain("Month to date vs same days last month · not the selected range · today's spend still being billed")
  })

  it('positive and negative changes show their real percentages', () => {
    expect(card({ spend: spend(150), monthOverMonth: mom(12.5, 1.25) }).trend).toEqual({ direction: 'up', label: '+12.5% vs same days last month', color: 'var(--text-danger)' })
    expect(card({ spend: spend(20), monthOverMonth: mom(12.5, 1.25) }).trend?.color).toBe('var(--text-warning)')
    expect(card({ spend: spend(20), monthOverMonth: mom(-8.3, -0.83) }).trend).toEqual({ direction: 'down', label: '-8.3% vs same days last month', color: 'var(--text-success)' })
  })

  it('unavailable and error comparisons show no trend at all -- never 0% or flat', () => {
    const unavailable = card({ spend: spend(10), monthOverMonth: missing('unavailable') as CostSummary['monthOverMonth'] })
    expect(unavailable.trend).toBeUndefined()
    expect(unavailable.captions).toContain('Month-over-month not available')

    const error = card({ spend: spend(10), monthOverMonth: missing('error') as CostSummary['monthOverMonth'] })
    expect(error.trend).toBeUndefined()
    expect(error.captions).toContain('Month-over-month could not be retrieved')

    for (const c of [unavailable, error]) expect(c.captions.join(' ')).not.toMatch(FLAT_OR_ZERO_CLAIM)
  })

  it('previous period $0: the dollar change, and no fabricated percentage', () => {
    const c = card({ spend: spend(3.2), monthOverMonth: mom(null, 3.2, 0) })
    expect(c.trend?.label).toBe('+$3.20 vs same days last month (% change undefined: last month was $0)')
    expect(c.trend?.label).not.toMatch(/\d%/)
  })
})
