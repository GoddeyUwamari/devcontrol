/**
 * Synthetic cost summaries with the backend's month state (cost-month-state.ts),
 * for page and helper tests around the first days of a UTC month. Not real data.
 */
import type { CostMonthState, CostSummary } from '@/lib/types'

type MonthStateValue = 'no_billed_days_yet' | 'latest_days_updating' | 'month_to_date'

const NO_MOM: CostSummary['monthOverMonth'] = {
  state: 'unavailable', source: 'DevControl month-over-month comparison', provenance: null, asOf: null, coverage: null,
  reason: 'no day of this month has finished reporting in AWS Cost Explorer yet', data: null,
}

/**
 * A billed month-to-date summary as GET /api/platform/costs/summary sends it.
 * `endExclusive`: tomorrow (UTC) of the moment it represents.
 */
export function billedSummary(o: {
  state: MonthStateValue
  endExclusive: string
  amount: number
  finishedThrough: string
  billedThrough?: string | null
  topServices?: Array<{ service: string; amount: number; sharePercent: number | null }>
  previous?: { amount: number; latestDaysUpdating: boolean } | null
}): CostSummary {
  const usable = o.state !== 'no_billed_days_yet'
  const previousMonth = o.previous === null ? null : { start: '2026-11-01', endExclusive: '2026-12-01', amount: o.previous?.amount ?? 399, latestDaysUpdating: o.previous?.latestDaysUpdating ?? true }
  const monthState: CostMonthState = {
    version: 1,
    state: o.state,
    period: { month: '2026-12', start: '2026-12-01', endExclusive: o.endExclusive, calendar: 'UTC' },
    amount: usable ? o.amount : null,
    amountUsable: usable,
    costBasis: 'unblended_net_after_credits',
    lineItems: o.topServices?.length ?? (o.amount !== 0 ? 1 : 0),
    finishedThrough: o.finishedThrough,
    billedThrough: o.billedThrough ?? null,
    ceEstimated: true,
    asOf: `${o.endExclusive.slice(0, 8)}${String(Number(o.endExclusive.slice(8, 10)) - 1).padStart(2, '0')}T00:30:00.000Z`,
    reason: usable ? null : { code: 'no_line_items_yet', text: 'AWS Cost Explorer has not reported any charges for this UTC month yet' },
    previousMonth: previousMonth ? { month: '2026-11', ...previousMonth } : null,
  }
  return {
    spend: {
      state: 'available', source: 'AWS Cost Explorer', provenance: 'actual', asOf: monthState.asOf,
      period: { kind: 'range', start: '2026-12-01', endExclusive: o.endExclusive }, coverage: null, reason: null,
      data: {
        amount: usable ? o.amount : null, basis: 'billed_month_to_date', lastDayInProgress: true, finishedThrough: o.finishedThrough,
        topServices: o.topServices ?? [], previousMonth: previousMonth ? { start: previousMonth.start, endExclusive: previousMonth.endExclusive, amount: previousMonth.amount } : null,
        monthState,
      },
    } as CostSummary['spend'],
    monthOverMonth: NO_MOM,
  }
}

export const EC2 = { service: 'Amazon Elastic Compute Cloud - Compute', amount: 13.3, sharePercent: 100 }

/** Dec 1, 00:30 UTC: nothing reported for December yet. */
export const DAY1_NONE = billedSummary({ state: 'no_billed_days_yet', endExclusive: '2026-12-02', amount: 0, finishedThrough: '2026-11-29' })
/** Dec 1, 18:00 UTC: Dec 1 already has a charge. */
export const DAY1_CHARGE = billedSummary({ state: 'latest_days_updating', endExclusive: '2026-12-02', amount: 13.3, finishedThrough: '2026-11-29', billedThrough: '2026-12-01', topServices: [EC2] })
/** Dec 2: Dec 1 has a charge. */
export const DAY2_CHARGE = billedSummary({ state: 'latest_days_updating', endExclusive: '2026-12-03', amount: 13.3, finishedThrough: '2026-11-30', billedThrough: '2026-12-01', topServices: [EC2], previous: { amount: 399, latestDaysUpdating: false } })
/** Dec 3: Dec 1 has finished; Cost Explorer has line items through Dec 2. */
export const DAY3 = billedSummary({ state: 'month_to_date', endExclusive: '2026-12-04', amount: 26.6, finishedThrough: '2026-12-01', billedThrough: '2026-12-02', topServices: [{ ...EC2, amount: 26.6 }], previous: { amount: 399, latestDaysUpdating: false } })
