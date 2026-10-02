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

function spend(amount: number, provenance: 'actual' | 'estimated' = 'actual', lastDayInProgress = false, period: CostSummary['spend']['period'] = { kind: 'range', start: '2026-09-01', endExclusive: '2026-09-28' }): CostSummary['spend'] {
  return {
    state: 'available', source: provenance === 'actual' ? 'AWS Cost Explorer' : 'DevControl inventory cost estimate', provenance, asOf: null, coverage: null, reason: null,
    period: provenance === 'actual' ? period : { kind: 'point_in_time' },
    data: { amount, basis: provenance === 'actual' ? 'billed_month_to_date' : 'estimated_monthly_run_rate', lastDayInProgress },
  }
}
function missing<T>(state: 'unavailable' | 'error'): { state: typeof state; source: string; provenance: null; asOf: null; coverage: null; reason: string; data: T | null } {
  return { state, source: 'fixture', provenance: null, asOf: null, coverage: null, reason: 'fixture', data: null }
}
function mom(changePercent: number | null, changeAmount: number, previousWindowTotal = 10, includesToday = true): CostSummary['monthOverMonth'] {
  return {
    state: 'available', source: 'DevControl month-over-month comparison', provenance: 'derived', asOf: null, coverage: null, reason: null,
    data: {
      currentWindow: { start: '2026-09-01', end: '2026-09-27' }, previousWindow: { start: '2026-08-01', end: '2026-08-27' },
      currentWindowTotal: previousWindowTotal + changeAmount, previousWindowTotal, changeAmount, changePercent, currentWindowIncludesToday: includesToday,
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
    expect(c.caption).toBe('Actual · AWS Cost Explorer')
    expect(c.evidence?.source).toMatch(/^Actual · AWS Cost Explorer/)
  })

  it('a net credit stays negative and actual', () => {
    const c = card({ spend: spend(-12.34), monthOverMonth: mom(0, 0) })
    expect(c.value).toBe('-$12.34')
    expect(c.caption).toBe('Actual · AWS Cost Explorer · net of credits')
  })

  it('a sub-dollar month keeps its cents', () => {
    expect(card({ spend: spend(0.42), monthOverMonth: mom(0, 0) }).value).toBe('$0.42')
  })

  it('an inventory estimate is labeled estimated, never AWS billed spend', () => {
    const c = card({ spend: spend(42.5, 'estimated'), monthOverMonth: missing('unavailable') as CostSummary['monthOverMonth'] })
    expect(c.label).toBe('Estimated Monthly Spend')
    expect(c.value).toBe('$42.50/mo')
    expect(c.caption).toBe('Estimated from inventory · not AWS billed spend')
    expect(c.caption).not.toMatch(/Actual|Cost Explorer ·/)
    expect(c.evidence?.source).toMatch(/^Estimate from resource inventory · not AWS billed spend/)
  })

  it('unavailable, error, and a failed request are "—" -- never $0', () => {
    const unavailable = card({ spend: missing('unavailable') as CostSummary['spend'], monthOverMonth: missing('unavailable') as CostSummary['monthOverMonth'] })
    expect(unavailable.value).toBe('—')
    expect(unavailable.caption).toMatch(/^Not available/)

    const error = card({ spend: missing('error') as CostSummary['spend'], monthOverMonth: missing('error') as CostSummary['monthOverMonth'] })
    expect(error.value).toBe('—')
    expect(error.caption).toBe('Could not be retrieved')

    const failed = computeDashboardSpendCard({ costSummary: undefined, isLoading: false, isError: true })
    expect(failed.value).toBe('—')
    expect(failed.caption).toBe('Could not be retrieved')
    expect(failed.evidence).toEqual({ source: 'Could not be retrieved', comparison: 'Month-over-month could not be retrieved' })
    for (const c of [unavailable, error, failed]) expect(c.value).not.toMatch(/\$/)
  })

  it('loading shows no figure and no claim', () => {
    const c = computeDashboardSpendCard({ costSummary: undefined, isLoading: true, isError: false })
    expect(c.value).toBe('—')
    expect(c.trend).toBeUndefined()
    expect(c.caption).toBeNull()
    expect(c.evidence).toBeNull()
  })
})

describe('Dashboard spend face caption: one line, still-billing said once', () => {
  it('today still billing: one short note on the face; the panel keeps the full spend and comparison wording', () => {
    const c = card({ spend: spend(123.45, 'actual', true), monthOverMonth: mom(-7, -0.7) })
    expect(c.caption).toBe('Actual · AWS Cost Explorer · today still billing')
    expect(c.caption!.match(/billing|billed/g)).toHaveLength(1)
    expect(c.caption).not.toMatch(/not the selected range|still being billed/)
    expect(c.evidence).toEqual({
      source: "Actual · AWS Cost Explorer · today's spend still being billed",
      comparison: 'Finished days this month vs same days last month · not the selected range · Sep 1–27 vs Aug 1–27 · the current window ends today, which is still being billed',
    })
  })

  it('partial Cost Explorer data is on the face', () => {
    const c = card({ spend: { ...spend(5, 'actual', true), state: 'partial' }, monthOverMonth: mom(0, 0) })
    expect(c.caption).toBe('Actual · AWS Cost Explorer · today still billing · partial data')
  })

  it('day 1 (a one-day period still being billed): "no billed days yet this month" and no percentage', () => {
    const day1 = spend(0.37, 'actual', true, { kind: 'range', start: '2026-10-01', endExclusive: '2026-10-02' })
    const c = card({ spend: day1, monthOverMonth: mom(-80, -8) })
    expect(c.value).toBe('$0.37')
    expect(c.caption).toBe('Actual · AWS Cost Explorer · no billed days yet this month')
    expect(c.trend).toBeUndefined()
    expect(c.evidence?.comparison).toBe('No comparison until a day of this month has finished billing')
    expect(JSON.stringify(c)).not.toMatch(/\d%/)
  })

  it('a one-day period whose day has finished billing is not "no billed days"', () => {
    const c = card({ spend: spend(4, 'actual', false, { kind: 'range', start: '2026-10-01', endExclusive: '2026-10-02' }), monthOverMonth: mom(10, 1, 10, false) })
    expect(c.caption).toBe('Actual · AWS Cost Explorer')
    expect(c.trend?.label).toBe('+10% vs same days last month')
  })

  it('no period on the section: never inferred as day 1', () => {
    const c = card({ spend: spend(4, 'actual', true, null), monthOverMonth: mom(10, 1) })
    expect(c.caption).toBe('Actual · AWS Cost Explorer · today still billing')
    expect(c.trend).toBeDefined()
  })
})

describe('Dashboard month-over-month trend', () => {
  it('a real 0% is a flat 0% trend, with its basis, windows, and (from an older backend) the still-billing note', () => {
    const c = card({ spend: spend(10), monthOverMonth: mom(0, 0) })
    expect(c.trend).toEqual({ direction: 'flat', label: '0% vs same days last month', color: 'var(--text-secondary)' })
    expect(c.evidence?.comparison).toBe('Finished days this month vs same days last month · not the selected range · Sep 1–27 vs Aug 1–27 · the current window ends today, which is still being billed')
  })

  it('positive and negative changes show their real percentages (a fully billed window keeps its direction color)', () => {
    expect(card({ spend: spend(150), monthOverMonth: mom(12.5, 1.25, 10, false) }).trend).toEqual({ direction: 'up', label: '+12.5% vs same days last month', color: 'var(--text-danger)' })
    expect(card({ spend: spend(20), monthOverMonth: mom(12.5, 1.25, 10, false) }).trend?.color).toBe('var(--text-warning)')
    expect(card({ spend: spend(20), monthOverMonth: mom(-8.3, -0.83, 10, false) }).trend).toEqual({ direction: 'down', label: '-8.3% vs same days last month', color: 'var(--text-success)' })
  })

  it('a window that includes today (still being billed) is neutral in every direction -- never "improvement" green', () => {
    for (const [pct, amt] of [[-8.3, -0.83], [12.5, 1.25], [0, 0]] as const) {
      const c = card({ spend: spend(150), monthOverMonth: mom(pct, amt) })
      expect(c.trend?.color).toBe('var(--text-secondary)')
      expect(c.evidence?.comparison).toMatch(/still being billed$/)
    }
    expect(card({ spend: spend(150), monthOverMonth: mom(null, 3.2, 0) }).trend?.color).toBe('var(--text-secondary)')
  })

  it('unavailable and error comparisons show no trend at all -- never 0% or flat', () => {
    const unavailable = card({ spend: spend(10), monthOverMonth: missing('unavailable') as CostSummary['monthOverMonth'] })
    expect(unavailable.trend).toBeUndefined()
    expect(unavailable.evidence?.comparison).toBe('Month-over-month not available')

    const error = card({ spend: spend(10), monthOverMonth: missing('error') as CostSummary['monthOverMonth'] })
    expect(error.trend).toBeUndefined()
    expect(error.evidence?.comparison).toBe('Month-over-month could not be retrieved')

    for (const c of [unavailable, error]) expect(`${c.caption} ${c.evidence?.comparison}`).not.toMatch(FLAT_OR_ZERO_CLAIM)
  })

  it('previous period $0: the dollar change, and no fabricated percentage', () => {
    const c = card({ spend: spend(3.2), monthOverMonth: mom(null, 3.2, 0) })
    expect(c.trend?.label).toBe('+$3.20 vs same days last month (% change undefined: last month was $0)')
    expect(c.trend?.label).not.toMatch(/\d%/)
  })
})

describe('Dashboard spend comparison: finished days only (backend finishedThrough)', () => {
  const withFinished = (s: CostSummary['spend'], finishedThrough: string | null): CostSummary['spend'] => ({ ...s, data: { ...s.data!, finishedThrough } })
  const windows = (current: [string, string], previous: [string, string]): CostSummary['monthOverMonth'] => {
    const m = mom(0, 0, 10, false)
    return { ...m, data: { ...m.data!, currentWindow: { start: current[0], end: current[1] }, previousWindow: { start: previous[0], end: previous[1] } } }
  }

  it('Oct 2: days are billed but none has finished reporting -- "latest days still being reported", no percentage', () => {
    const oct2 = withFinished(spend(0.19, 'actual', true, { kind: 'range', start: '2026-10-01', endExclusive: '2026-10-03' }), '2026-09-30')
    const c = card({ spend: oct2, monthOverMonth: missing('unavailable') as CostSummary['monthOverMonth'] })
    expect(c.value).toBe('$0.19')
    expect(c.caption).toBe('Actual · AWS Cost Explorer · latest days still being reported')
    expect(c.trend).toBeUndefined()
    expect(c.evidence?.comparison).toBe('No comparison until a day of this month has finished reporting · AWS Cost Explorer is still reporting the latest days')
    expect(JSON.stringify(c)).not.toMatch(/\d%/)
  })

  it('Oct 1 keeps the existing day-1 wording', () => {
    const oct1 = withFinished(spend(0.05, 'actual', true, { kind: 'range', start: '2026-10-01', endExclusive: '2026-10-02' }), '2026-09-29')
    const c = card({ spend: oct1, monthOverMonth: missing('unavailable') as CostSummary['monthOverMonth'] })
    expect(c.caption).toBe('Actual · AWS Cost Explorer · no billed days yet this month')
    expect(c.evidence?.comparison).toBe('No comparison until a day of this month has finished billing')
  })

  it('Oct 3: the panel names the one-day windows, "Oct 1 vs Sep 1"', () => {
    const oct3 = withFinished(spend(0.5, 'actual', true, { kind: 'range', start: '2026-10-01', endExclusive: '2026-10-04' }), '2026-10-01')
    const c = card({ spend: oct3, monthOverMonth: windows(['2026-10-01', '2026-10-01'], ['2026-09-01', '2026-09-01']) })
    expect(c.caption).toBe('Actual · AWS Cost Explorer · today still billing')
    expect(c.trend?.label).toBe('0% vs same days last month')
    expect(c.evidence?.comparison).toBe('Finished days this month vs same days last month · not the selected range · Oct 1 vs Sep 1')
  })

  it('Oct 15: "Oct 1–13 vs Sep 1–13"', () => {
    const c = card({ spend: withFinished(spend(42), '2026-10-13'), monthOverMonth: windows(['2026-10-01', '2026-10-13'], ['2026-09-01', '2026-09-13']) })
    expect(c.evidence?.comparison).toBe('Finished days this month vs same days last month · not the selected range · Oct 1–13 vs Sep 1–13')
  })

  it('Mar 31: the capped previous window is disclosed', () => {
    const c = card({ spend: withFinished(spend(42), '2027-03-29'), monthOverMonth: windows(['2027-03-01', '2027-03-29'], ['2027-02-01', '2027-02-28']) })
    expect(c.evidence?.comparison).toBe('Finished days this month vs same days last month · not the selected range · Mar 1–29 vs Feb 1–28 (Feb has only 28 days)')
  })

  it('a response without finishedThrough (older backend) never claims days are still being reported', () => {
    const c = card({ spend: spend(0.19, 'actual', true, { kind: 'range', start: '2026-10-01', endExclusive: '2026-10-03' }), monthOverMonth: missing('unavailable') as CostSummary['monthOverMonth'] })
    expect(c.caption).toBe('Actual · AWS Cost Explorer · today still billing')
    expect(c.evidence?.comparison).toBe('Month-over-month not available')
  })
})
