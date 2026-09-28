/**
 * How the Costs page words its spend, month-over-month, and savings figures.
 * Every figure keeps its evidence state: a real $0 / 0% is shown as such,
 * while an unavailable or failed figure is shown as missing -- never as $0,
 * 0%, "flat", or "no spend". States come from the backend's evidence
 * sections (GET /api/platform/costs/summary); nothing is inferred here from a
 * value.
 */
import type { ContextSection, CostMonthOverMonthEvidence, CostSpendEvidence } from '@/lib/types'
import { annualizeMonthly, formatSavingsCurrency } from '@/lib/utils'

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Cents precision, so a real sub-dollar amount never reads as "$0"; negatives (credits) keep their sign. */
export function formatUsd(amount: number): string {
  return USD.format(amount)
}

/** A change amount with an explicit sign: "+$3.20", "-$1.05", "$0.00". */
export function formatSignedUsd(amount: number): string {
  return amount > 0 ? `+${formatUsd(amount)}` : formatUsd(amount)
}

/** Whole cents -- never whole-dollar rounding, which hides sub-dollar spend. */
export function roundCents(amount: number): number {
  return Math.round(amount * 100) / 100
}

interface QueryStatus {
  isLoading: boolean
  /** The request itself failed (no section came back). */
  isError: boolean
}

export interface SpendDisplay {
  label: string
  value: string
  sub: string
  /** The amount, only when there is one. */
  amount: number | null
  provenance: 'actual' | 'estimated' | null
}

export function describeSpend(section: ContextSection<CostSpendEvidence> | undefined, { isLoading, isError }: QueryStatus): SpendDisplay {
  const missing = (sub: string): SpendDisplay => ({ label: 'Month-to-Date Spend', value: '—', sub, amount: null, provenance: null })
  if (isLoading) return missing('Loading…')
  if (isError || !section || section.state === 'error') return missing('Could not be retrieved')
  if ((section.state !== 'available' && section.state !== 'partial') || !section.data) {
    return missing('Not available · no AWS Cost Explorer data or inventory estimate')
  }

  const { amount, basis, lastDayInProgress } = section.data
  if (section.provenance === 'estimated' || basis === 'estimated_monthly_run_rate') {
    return {
      label: 'Estimated Monthly Spend',
      value: `${formatUsd(amount)}/mo`,
      sub: `Estimate from resource inventory · not AWS billed spend (Cost Explorer unavailable)${section.state === 'partial' ? ' · some resources have no estimate' : ''}`,
      amount,
      provenance: 'estimated',
    }
  }

  const notes = ['Actual · AWS Cost Explorer']
  if (amount < 0) notes.push('net of credits')
  if (lastDayInProgress) notes.push(TODAY_STILL_BILLING)
  if (section.state === 'partial') notes.push('partial data')
  return { label: 'Month-to-Date Spend', value: formatUsd(amount), sub: notes.join(' · '), amount, provenance: 'actual' }
}

/**
 * What the month-over-month figure compares. It is fixed: month to date vs
 * the same days of last month (the backend's comparison over a 90-day Cost
 * Explorer trend) -- it does not follow the Costs page's 7D/30D/3M/6M/1Y
 * chart range.
 */
export const MOM_BASIS_LABEL = 'Month to date vs same days last month · not the selected range'

/** Reuses the month-to-date spend disclosure wording (describeSpend). */
export const TODAY_STILL_BILLING = "today's spend still being billed"

export interface MonthOverMonthDisplay {
  value: string
  sub: string
  /** The real percentage change, only when one exists (0 is a real, flat change). */
  changePercent: number | null
  direction: 'up' | 'down' | 'flat' | null
  /** The comparison's current window ends today, which Cost Explorer is still billing. */
  includesToday: boolean
}

/**
 * The month-over-month KPI. Always month to date vs the same days last month
 * (see MOM_BASIS_LABEL), independent of the selected chart range.
 */
export function describeMonthOverMonth(
  section: ContextSection<CostMonthOverMonthEvidence> | undefined,
  { isLoading, isError }: QueryStatus
): MonthOverMonthDisplay {
  const missing = (sub: string): MonthOverMonthDisplay => ({ value: '—', sub, changePercent: null, direction: null, includesToday: false })
  if (isLoading) return missing('Loading…')
  if (isError || !section || section.state === 'error') return missing('Comparison could not be retrieved')
  if ((section.state !== 'available' && section.state !== 'partial') || !section.data) {
    return missing('Comparison not available · not enough comparable AWS Cost Explorer data')
  }

  const { changePercent, changeAmount, previousWindowTotal, currentWindowIncludesToday } = section.data
  const partial = `${section.state === 'partial' ? ' · partial data' : ''}${currentWindowIncludesToday ? ` · ${TODAY_STILL_BILLING}` : ''}`
  const direction = changeAmount > 0 ? 'up' : changeAmount < 0 ? 'down' : 'flat'

  // The same days last month totalled $0: a percentage is undefined, so the dollar change is shown instead.
  if (changePercent === null) {
    return {
      value: formatSignedUsd(changeAmount),
      sub: `vs ${formatUsd(previousWindowTotal)} in the same days last month · % change undefined${partial}`,
      changePercent: null,
      direction,
      includesToday: currentWindowIncludesToday,
    }
  }

  const sub = changePercent > 0
    ? 'Spend up vs the same days last month'
    : changePercent < 0
      ? 'Spend down vs the same days last month'
      : 'Spend flat vs the same days last month'
  return {
    value: `${changePercent > 0 ? '+' : ''}${changePercent}%`,
    sub: `${sub}${partial}`,
    changePercent,
    direction: changePercent > 0 ? 'up' : changePercent < 0 ? 'down' : 'flat',
    includesToday: currentWindowIncludesToday,
  }
}

/**
 * The savings KPI's secondary line. The annual figure is the monthly
 * recommendation estimate x 12 -- an annualized estimate, not realized,
 * billed, or guaranteed savings. It is deliberately not expressed as a
 * percentage of current spend: the estimate is a monthly run-rate over the
 * resource inventory, while current spend is Cost Explorer's month-to-date
 * billing scope, so the ratio would mix periods and scopes.
 */
export function describeAnnualizedSavings(monthlyEstimate: number): string {
  return `${formatSavingsCurrency(annualizeMonthly(monthlyEstimate))}/yr annualized estimate (monthly estimate × 12)`
}
