/**
 * The approved Current -> Proposed strings (day1-step1.md) on every
 * month-to-date surface, from cost summaries carrying the backend's month
 * state. Synthetic data only.
 */
import { describe, it, expect } from 'vitest'
import type { CostSummary } from '@/lib/types'
import { computeDashboardSpendCard } from '../dashboard/dashboardSpendCard'
import { describeSpend, previousMonthLine } from '../costs/cost-display'
import { describeServicesSpend } from '../services/SummaryTiles'
import { costByService, describeOverview } from '../infrastructure/overview/overviewModel'
import { inputs, ready, NOW } from '../infrastructure/__tests__/overview-fixtures'
import { DAY1_CHARGE, DAY1_NONE, DAY2_CHARGE, DAY3, billedSummary } from '../costs/__tests__/month-state-fixtures'

const ok = { isLoading: false, isError: false }
const card = (s: CostSummary) => computeDashboardSpendCard({ costSummary: s, ...ok })
const infraTile = (s: CostSummary) => describeOverview(inputs({ costSummary: ready(s) }), NOW).tiles!.spend

describe('Dec 1 (UTC), no billed days yet: no surface shows $0', () => {
  it('Dashboard card: unchanged reference wording', () => {
    expect(card(DAY1_NONE)).toMatchObject({
      value: '—',
      caption: 'Dec 1 (UTC) · Actual · AWS Cost Explorer · no billed days yet this month',
      previousMonth: 'November (UTC): $399.00 · latest days still updating',
    })
  })

  it('Costs month-to-date (and Efficiency, By team, legacy Infrastructure: the same helper)', () => {
    expect(describeSpend(DAY1_NONE.spend, ok)).toMatchObject({ value: '—', sub: 'Dec 1 (UTC) · AWS Cost Explorer · no billed days yet this month', amount: null })
    expect(previousMonthLine(DAY1_NONE.spend)).toBe('November (UTC): $399.00 · latest days still updating')
  })

  it('Services tile', () => {
    expect(describeServicesSpend({ loading: false, error: false, summary: DAY1_NONE })).toEqual({
      kind: 'no_billed_days', notes: ['whole account', 'from Cost Explorer', 'no billed days yet this month'],
    })
  })

  it('Infrastructure tile (unchanged) and Cost by AWS service (no empty table)', () => {
    expect(infraTile(DAY1_NONE)).toMatchObject({ value: '—', captions: [['whole account · billed, from Cost Explorer · no billed days yet this month'], expect.anything()] })
    expect(costByService(ready(DAY1_NONE))).toEqual({
      status: 'unavailable', sub: null, rows: [],
      unavailable: 'No billed days yet this month (Dec 1, UTC). Services appear here once AWS Cost Explorer reports them.',
    })
  })

  it('nothing anywhere renders a dollar figure for December', () => {
    const all = JSON.stringify([card(DAY1_NONE), describeSpend(DAY1_NONE.spend, ok), describeServicesSpend({ loading: false, error: false, summary: DAY1_NONE }), infraTile(DAY1_NONE), costByService(ready(DAY1_NONE))])
    expect(all).not.toMatch(/\$0\.00/)
    expect(all).not.toMatch(/billed through Nov/)
  })
})

describe('Dec 1 (UTC) with a charge already reported (DAY1-D6)', () => {
  it('the amount with "latest days still updating", never "no billed days" beside a number', () => {
    expect(card(DAY1_CHARGE)).toMatchObject({ value: '$13.30', caption: 'Dec 1 (UTC) · Actual · AWS Cost Explorer · latest days still updating' })
    expect(infraTile(DAY1_CHARGE)).toMatchObject({ value: '$13.30', captions: [['whole account · billed, from Cost Explorer · latest days still updating'], expect.anything()] })
    expect(JSON.stringify(card(DAY1_CHARGE))).not.toMatch(/no billed days/)
  })
})

describe('Dec 2 (UTC) with charges: latest days still updating', () => {
  it('Costs month-to-date', () => {
    expect(describeSpend(DAY2_CHARGE.spend, ok)).toMatchObject({ value: '$13.30', sub: 'Dec 1–2 (UTC) · Actual · AWS Cost Explorer · latest days still updating' })
    // November is past the reporting lag now.
    expect(previousMonthLine(DAY2_CHARGE.spend)).toBe('November (UTC): $399.00')
  })

  it('Services caption: no "billed through Nov 30"', () => {
    expect(describeServicesSpend({ loading: false, error: false, summary: DAY2_CHARGE })).toEqual({
      kind: 'billed', value: '$13.30', notes: ['whole account', 'billed, from Cost Explorer', 'latest days still updating'],
    })
  })

  it('Cost by AWS service: billed, no previous-month date', () => {
    expect(costByService(ready(DAY2_CHARGE)).sub).toBe('This month, billed')
  })

  it('Dec 2 with nothing reported yet: still no billed days yet', () => {
    const none = billedSummary({ state: 'no_billed_days_yet', endExclusive: '2026-12-03', amount: 0, finishedThrough: '2026-11-30', previous: { amount: 399, latestDaysUpdating: false } })
    expect(describeSpend(none.spend, ok)).toMatchObject({ value: '—', sub: 'Dec 1–2 (UTC) · AWS Cost Explorer · no billed days yet this month' })
    expect(costByService(ready(none)).unavailable).toBe('No billed days yet this month (Dec 1–2, UTC). Services appear here once AWS Cost Explorer reports them.')
  })
})

describe('Dec 3 (UTC): month to date, same reporting month identity', () => {
  it('Costs month-to-date: period label added, existing "today\'s spend still being billed" kept (DAY1-D9)', () => {
    expect(describeSpend(DAY3.spend, ok)).toMatchObject({ value: '$26.60', sub: "Dec 1–3 (UTC) · Actual · AWS Cost Explorer · today's spend still being billed" })
    expect(previousMonthLine(DAY3.spend)).toBeNull()
  })

  it('Services: "billed through" from Cost Explorer evidence (Dec 2), not the calendar (Dec 1)', () => {
    expect(describeServicesSpend({ loading: false, error: false, summary: DAY3 })).toEqual({
      kind: 'billed', value: '$26.60', notes: ['whole account', 'billed, from Cost Explorer', 'billed through Dec 2'],
    })
    expect(costByService(ready(DAY3)).sub).toBe('This month, billed · billed through Dec 2')
  })

  it('Dashboard card keeps the existing day-3 wording', () => {
    expect(card(DAY3)).toMatchObject({ value: '$26.60', caption: 'Dec 1–3 (UTC) · Actual · AWS Cost Explorer · today still billing', previousMonth: null })
  })
})

describe('a month state this code does not know is never shown as a number', () => {
  it('reads as not available, with the backend reason', () => {
    const s = billedSummary({ state: 'month_to_date', endExclusive: '2026-12-16', amount: 50, finishedThrough: '2026-12-13' })
    const future = { ...s, spend: { ...s.spend, data: { ...s.spend.data!, monthState: { ...s.spend.data!.monthState!, state: 'restated', amountUsable: false, amount: null, reason: { code: 'restated', text: 'Cost Explorer is restating this month' } } } } } as CostSummary
    expect(describeSpend(future.spend, ok)).toMatchObject({ value: '—', sub: 'Cost Explorer is restating this month' })
    expect(describeServicesSpend({ loading: false, error: false, summary: future })).toEqual({ kind: 'unavailable' })
  })
})
