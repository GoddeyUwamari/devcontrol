/**
 * trend-lag-build.md rules 5 and 6 on the page helpers, from the backend's
 * real cost summary for production's 2026-11-16 data
 * (backend/src/controllers/__tests__/__fixtures__/trend-lag/summary-2026-11-16.new.json,
 * pinned by trend-lag-real-evidence.test.ts): Nov 13 updating, Nov 14-16 not
 * reported. The other cases are synthetic (month-state-fixtures).
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import type { CostSummary } from '@/lib/types'
import { computeDashboardSpendCard } from '../../dashboard/dashboardSpendCard'
import { describeMonthOverMonth, describeSpend, LATEST_DAYS_REPORTING, monthHasUnfinishedDays, noFinalDayThisMonth, TODAY_STILL_BILLING } from '../cost-display'
import { billedSummary, DAY3, EC2 } from './month-state-fixtures'

const REAL: CostSummary = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '../../../../backend/src/controllers/__tests__/__fixtures__/trend-lag/summary-2026-11-16.new.json'), 'utf8',
)).data
const ok = { isLoading: false, isError: false }

describe('real evidence 2026-11-16', () => {
  it('the backend summary: Nov 1-12 vs Oct 1-12; month state month_to_date with 12 final / 1 updating / 3 not reported days', () => {
    expect(REAL.monthOverMonth.data).toMatchObject({ currentWindow: { start: '2026-11-01', end: '2026-11-12' }, previousWindow: { start: '2026-10-01', end: '2026-10-12' } })
    expect(REAL.spend.data?.monthState).toMatchObject({ state: 'month_to_date', reportDays: { final: 12, updating: 1, notReported: 3 } })
  })

  it('Dashboard tile: "latest days still updating" (rule 6), never "today still billing"; the comparison names Nov 1–12 vs Oct 1–12 (rule 5)', () => {
    const card = computeDashboardSpendCard({ costSummary: REAL, ...ok })
    expect(card.caption).toBe('Nov 1–16 (UTC) · Actual · AWS Cost Explorer · latest days still updating')
    expect(card.caption).not.toMatch(/today still billing/)
    expect(card.trend).toBeDefined()
    expect(card.evidence!.comparison).toContain('Nov 1–12 vs Oct 1–12')
    expect(card.evidence!.comparison).not.toMatch(/Nov 1–1[3-6]/)
  })

  it('Costs month-to-date card: the same evidence', () => {
    const spend = describeSpend(REAL.spend, ok)
    expect(spend.sub).toBe(`Nov 1–16 (UTC) · Actual · AWS Cost Explorer · ${LATEST_DAYS_REPORTING}`)
    expect(spend.sub).not.toContain(TODAY_STILL_BILLING)
  })

  it('Costs month-over-month KPI: a real comparison (a final day exists), not "No comparison yet"', () => {
    const mom = describeMonthOverMonth(REAL.monthOverMonth, ok, { noFinishedDay: noFinalDayThisMonth(REAL.spend) })
    expect(mom.direction).not.toBeNull()
    expect(mom.includesToday).toBe(false)
  })
})

describe('round 2: the same data at 2026-11-17 (backend summary): Nov 13 still updating, Nov 14-17 not reported', () => {
  const NOV17: CostSummary = JSON.parse(fs.readFileSync(
    path.resolve(__dirname, '../../../../backend/src/controllers/__tests__/__fixtures__/trend-lag/summary-2026-11-17.new.json'), 'utf8',
  )).data

  it('the backend: Nov 1-12 vs Oct 1-12; 12 final / 1 updating / 4 not reported days after a recent charge', () => {
    expect(NOV17.monthOverMonth.data).toMatchObject({ currentWindow: { start: '2026-11-01', end: '2026-11-12' }, previousWindow: { start: '2026-10-01', end: '2026-10-12' } })
    expect(NOV17.spend.data?.monthState?.reportDays).toEqual({ final: 12, updating: 1, notReported: 4, afterRecentCharge: true })
  })

  it('Dashboard tile + Costs card: "latest days still updating"; the comparison names Nov 1–12 vs Oct 1–12, never Nov 1–13', () => {
    const card = computeDashboardSpendCard({ costSummary: NOV17, ...ok })
    expect(card.caption).toBe('Nov 1–17 (UTC) · Actual · AWS Cost Explorer · latest days still updating')
    expect(card.evidence!.comparison).toContain('Nov 1–12 vs Oct 1–12')
    expect(card.evidence!.comparison).not.toMatch(/Nov 1–13/)
    expect(describeSpend(NOV17.spend, ok).sub).toBe(`Nov 1–17 (UTC) · Actual · AWS Cost Explorer · ${LATEST_DAYS_REPORTING}`)
  })

  it('Costs month-over-month KPI: a real comparison over the finished days', () => {
    const mom = describeMonthOverMonth(NOV17.monthOverMonth, ok, { noFinishedDay: noFinalDayThisMonth(NOV17.spend) })
    expect(mom.direction).not.toBeNull()
    expect(mom.includesToday).toBe(false)
  })
})

describe('M-1: an account that stopped spending (backend summary, last charge Oct 20, now Nov 16)', () => {
  const STOPPED: CostSummary = JSON.parse(fs.readFileSync(
    path.resolve(__dirname, '../../../../backend/src/controllers/__tests__/__fixtures__/trend-lag/summary-stopped-2026-11-16.new.json'), 'utf8',
  )).data

  it('the backend says Nov 9-16 are not reported but not after a recent charge', () => {
    expect(STOPPED.spend.data?.monthState?.reportDays).toEqual({ final: 8, updating: 0, notReported: 8, afterRecentCharge: false })
  })

  it('captions never say "latest days still updating" (Dashboard tile, Costs card)', () => {
    expect(monthHasUnfinishedDays(STOPPED.spend)).toBe(false)
    const card = computeDashboardSpendCard({ costSummary: STOPPED, ...ok })
    expect(card.caption).toBe('Nov 1–16 (UTC) · Actual · AWS Cost Explorer · today still billing')
    expect(describeSpend(STOPPED.spend, ok).sub).not.toContain(LATEST_DAYS_REPORTING)
    expect(card.previousMonth).toBeNull()
  })

  it('month-over-month: Nov 1–8 vs Oct 1–8, a real comparison (not "No comparison yet · latest days still updating")', () => {
    expect(noFinalDayThisMonth(STOPPED.spend)).toBe(false)
    const mom = describeMonthOverMonth(STOPPED.monthOverMonth, ok, { noFinishedDay: noFinalDayThisMonth(STOPPED.spend) })
    expect(mom.direction).toBe('down')
    expect(computeDashboardSpendCard({ costSummary: STOPPED, ...ok }).evidence!.comparison).toContain('Nov 1–8 vs Oct 1–8')
  })

  it('synthetic: no final day yet, not-reported days only, no recent charge -> not "No comparison yet · latest days still updating"', () => {
    const s = billedSummary({ state: 'month_to_date', endExclusive: '2026-12-04', amount: 0, finishedThrough: '2026-12-01' })
    const stopped = { ...s, spend: { ...s.spend, data: { ...s.spend.data!, monthState: { ...s.spend.data!.monthState!, reportDays: { final: 0, updating: 0, notReported: 3, afterRecentCharge: false } } } } }
    expect(noFinalDayThisMonth(stopped.spend)).toBe(false)
    expect(monthHasUnfinishedDays(stopped.spend)).toBe(false)
    const recent = { ...stopped, spend: { ...stopped.spend, data: { ...stopped.spend.data, monthState: { ...stopped.spend.data.monthState, reportDays: { final: 0, updating: 0, notReported: 3, afterRecentCharge: true } } } } }
    expect(noFinalDayThisMonth(recent.spend)).toBe(true)
    expect(monthHasUnfinishedDays(recent.spend)).toBe(true)
  })
})

describe('rule 6 helpers (synthetic)', () => {
  const withDays = (s: CostSummary, reportDays: { final: number; updating: number; notReported: number } | null): CostSummary =>
    ({ ...s, spend: { ...s.spend, data: { ...s.spend.data!, monthState: { ...s.spend.data!.monthState!, reportDays } } } })

  it('no per-day evidence (an older backend): Day-1 wording unchanged ("today still billing")', () => {
    expect(monthHasUnfinishedDays(DAY3.spend)).toBe(false)
    expect(computeDashboardSpendCard({ costSummary: DAY3, ...ok }).caption).toBe('Dec 1–3 (UTC) · Actual · AWS Cost Explorer · today still billing')
  })

  it('every day final: "today still billing" stays', () => {
    const s = withDays(DAY3, { final: 3, updating: 0, notReported: 0 })
    expect(monthHasUnfinishedDays(s.spend)).toBe(false)
    expect(describeSpend(s.spend, ok).sub).toContain(TODAY_STILL_BILLING)
  })

  it('an updating or a not-reported day: "latest days still updating"', () => {
    for (const days of [{ final: 1, updating: 1, notReported: 0 }, { final: 2, updating: 0, notReported: 1 }]) {
      const s = withDays(DAY3, days)
      expect(computeDashboardSpendCard({ costSummary: s, ...ok }).caption).toBe('Dec 1–3 (UTC) · Actual · AWS Cost Explorer · latest days still updating')
    }
  })

  it('no final day this month (month_to_date by the calendar, but Dec 1-3 unfinished): "No comparison yet · latest days still updating"', () => {
    const s = withDays(billedSummary({ state: 'month_to_date', endExclusive: '2026-12-04', amount: 26.6, finishedThrough: '2026-12-01', billedThrough: '2026-12-02', topServices: [EC2] }), { final: 0, updating: 2, notReported: 1 })
    expect(noFinalDayThisMonth(s.spend)).toBe(true)
    expect(describeMonthOverMonth(s.monthOverMonth, ok, { noFinishedDay: noFinalDayThisMonth(s.spend) }).sub).toBe(`No comparison yet · ${LATEST_DAYS_REPORTING}`)
    expect(computeDashboardSpendCard({ costSummary: s, ...ok }).evidence!.comparison).toMatch(/^No comparison until a day of this month has finished reporting/)
  })
})
