/**
 * The binding truth rule for spend (dashboard-step1.md, PR-MONEY): a measured
 * $0, no data yet, unavailable, and not connected are four different states and
 * never render the same way -- on the Dashboard spend card and on the
 * Infrastructure "Spend this month" tile. Plus the card's UTC period prefix and
 * the previous-month line shown only while no day of the month has finished.
 * Synthetic sections only.
 */
import { describe, it, expect } from 'vitest'
import type { CostSummary } from '@/lib/types'
import { computeDashboardSpendCard } from '../dashboardSpendCard'
import { describeOverview } from '../../infrastructure/overview/overviewModel'
import { inputs, ready, NOW } from '../../infrastructure/__tests__/overview-fixtures'

type Spend = CostSummary['spend']
const NO_MOM: CostSummary['monthOverMonth'] = { state: 'unavailable', source: 'DevControl month-over-month comparison', provenance: null, asOf: null, coverage: null, reason: 'fixture', data: null }
const EC2 = { service: 'Amazon Elastic Compute Cloud - Compute', amount: 4.2, sharePercent: 100 }

function billed(o: { start: string; endExclusive: string; amount: number; finishedThrough: string; topServices?: typeof EC2[]; previousMonth?: { start: string; endExclusive: string; amount: number } | null }): Spend {
  return {
    state: 'available', source: 'AWS Cost Explorer', provenance: 'actual', asOf: `${o.endExclusive}T00:00:00.000Z`,
    period: { kind: 'range', start: o.start, endExclusive: o.endExclusive }, coverage: null, reason: null,
    data: {
      amount: o.amount, basis: 'billed_month_to_date', lastDayInProgress: true, finishedThrough: o.finishedThrough,
      topServices: o.topServices ?? [], previousMonth: o.previousMonth ?? null,
    },
  } as Spend
}
const OCTOBER = { start: '2026-10-01', endExclusive: '2026-11-01', amount: 412.3 }

const STATES = {
  // Nov 12: finished days exist and Cost Explorer reported nothing -- a real $0.
  measuredZero: billed({ start: '2026-11-01', endExclusive: '2026-11-13', amount: 0, finishedThrough: '2026-11-10', previousMonth: OCTOBER }),
  // Nov 1, 00:37 UTC: no charge reported yet.
  noDataYet: billed({ start: '2026-11-01', endExclusive: '2026-11-02', amount: 0, finishedThrough: '2026-10-30', previousMonth: OCTOBER }),
  unavailable: { state: 'error', source: 'AWS Cost Explorer', provenance: null, asOf: null, coverage: null, reason: 'the Cost Explorer request failed', data: null } as unknown as Spend,
  notConnected: { state: 'unavailable', source: 'AWS Cost Explorer', provenance: null, asOf: null, coverage: null, reason: 'no AWS Cost Explorer result (no connected AWS account) and no inventory estimate', data: null } as unknown as Spend,
}

const card = (spend: Spend) => computeDashboardSpendCard({ costSummary: { spend, monthOverMonth: NO_MOM }, isLoading: false, isError: false })
const tile = (spend: Spend) => describeOverview(inputs({ costSummary: ready({ spend, monthOverMonth: NO_MOM }) }), NOW).tiles!.spend

describe('four spend states never render the same way', () => {
  it('Dashboard card', () => {
    expect(card(STATES.measuredZero)).toMatchObject({ value: '$0.00', caption: 'Nov 1–12 (UTC) · Actual · AWS Cost Explorer · today still billing', previousMonth: null })
    expect(card(STATES.noDataYet)).toMatchObject({ value: '—', caption: 'Nov 1 (UTC) · Actual · AWS Cost Explorer · no billed days yet this month', previousMonth: 'October (UTC): $412.30 · latest days still updating' })
    expect(card(STATES.unavailable)).toMatchObject({ value: '—', caption: 'Could not be retrieved', previousMonth: null })
    expect(card(STATES.notConnected)).toMatchObject({ value: '—', caption: 'Not available · no AWS Cost Explorer data or inventory estimate', previousMonth: null })
    const faces = Object.values(STATES).map((s) => { const c = card(s); return `${c.value} | ${c.caption}` })
    expect(new Set(faces).size).toBe(4)
  })

  it('Infrastructure "Spend this month"', () => {
    expect(tile(STATES.measuredZero)).toMatchObject({ value: '$0.00', captions: [['whole account · billed, from Cost Explorer · billed through Nov 10'], expect.anything()] })
    expect(tile(STATES.noDataYet)).toMatchObject({ value: '—', captions: [['whole account · billed, from Cost Explorer · no billed days yet this month'], expect.anything()] })
    const faces = Object.values(STATES).map((s) => JSON.stringify(tile(s)))
    expect(new Set(faces).size).toBe(4)
  })
})

describe('no data yet is only the first days of a month with nothing reported', () => {
  it('a charge already reported on Nov 1 is shown as is', () => {
    const s = billed({ start: '2026-11-01', endExclusive: '2026-11-02', amount: 4.2, finishedThrough: '2026-10-30', topServices: [EC2], previousMonth: OCTOBER })
    expect(card(s).value).toBe('$4.20')
    expect(tile(s).value).toBe('$4.20')
  })

  it('Nov 2 (no finished day yet, nothing reported): "—", latest days still being reported; October is finished, so no "still updating"', () => {
    const s = billed({ start: '2026-11-01', endExclusive: '2026-11-03', amount: 0, finishedThrough: '2026-10-31', previousMonth: OCTOBER })
    expect(card(s)).toMatchObject({ value: '—', caption: 'Nov 1–2 (UTC) · Actual · AWS Cost Explorer · latest days still being reported', previousMonth: 'October (UTC): $412.30' })
    expect(tile(s)).toMatchObject({ value: '—', captions: [['whole account · billed, from Cost Explorer · latest days still being reported'], expect.anything()] })
  })

  it('Nov 3 (Nov 1 finished): the previous-month line is gone', () => {
    const s = billed({ start: '2026-11-01', endExclusive: '2026-11-04', amount: 4.2, finishedThrough: '2026-11-01', topServices: [EC2], previousMonth: OCTOBER })
    expect(card(s).previousMonth).toBeNull()
  })

  it('a backend without previousMonth: no line, nothing invented', () => {
    const s = billed({ start: '2026-11-01', endExclusive: '2026-11-02', amount: 0, finishedThrough: '2026-10-30', previousMonth: null })
    expect(card(s).previousMonth).toBeNull()
  })

  it('an estimate gets no period prefix and no previous-month line', () => {
    const s = { state: 'available', source: 'DevControl inventory cost estimate', provenance: 'estimated', asOf: null, period: { kind: 'point_in_time' }, coverage: null, reason: null, data: { amount: 88, basis: 'estimated_monthly_run_rate', lastDayInProgress: false } } as unknown as Spend
    expect(card(s)).toMatchObject({ value: '$88.00/mo', caption: 'Estimated from inventory · not AWS billed spend', previousMonth: null })
  })
})
