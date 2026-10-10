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

/** Billed spend from AWS Cost Explorer. Only an 'actual' figure carries this label. */
export const ACTUAL_SPEND_LABEL = 'Month-to-Date Spend'
/**
 * An inventory estimate. Deliberately not called "spend": it is a modeled
 * run-rate from list prices, not what AWS billed.
 */
export const ESTIMATED_RUN_RATE_LABEL = 'Estimated Monthly Run-Rate'
const ESTIMATE_SUB = 'Estimate from resource inventory · not AWS billed spend'
/**
 * Shown instead of an estimate of $0 or less. An inventory estimate is a sum of
 * per-resource list-price estimates, so $0 means nothing was estimated (no
 * resources discovered, or none with a price) -- not that the account costs
 * nothing. On the stats endpoint it also stands in for Cost Explorer failing,
 * no connected account, a real $0 month, and net credits, which it cannot tell
 * apart. Either way there is no figure to show.
 */
export const NO_SPEND_FIGURE_SUB = 'Not available · no AWS Cost Explorer spend or inventory estimate'

/**
 * Whether GET /api/platform/stats/dashboard's figure is worth showing: Cost
 * Explorer data, or an estimate above $0. The backend sends 'actual' only for a
 * Cost Explorer total above $0 and otherwise falls back to the inventory
 * estimate (AWSCostService.getMonthlySpendWithFallback). The Dashboard's
 * hasBillingData gate and describeStatsSpend both read this.
 */
export function statsHasSpendFigure(stats: { monthlyAwsCost: number; costSource?: 'actual' | 'estimated' }): boolean {
  return stats.costSource === 'actual' || stats.monthlyAwsCost > 0
}

export function describeSpend(section: ContextSection<CostSpendEvidence> | undefined, { isLoading, isError }: QueryStatus): SpendDisplay {
  const missing = (sub: string): SpendDisplay => ({ label: ACTUAL_SPEND_LABEL, value: '—', sub, amount: null, provenance: null })
  if (isLoading) return missing('Loading…')
  if (isError || !section || section.state === 'error') return missing('Could not be retrieved')
  if ((section.state !== 'available' && section.state !== 'partial') || !section.data) {
    return missing('Not available · no AWS Cost Explorer data or inventory estimate')
  }

  const { amount, basis, lastDayInProgress } = section.data
  if (section.provenance === 'estimated' || basis === 'estimated_monthly_run_rate') {
    if (!(amount > 0)) return missing(NO_SPEND_FIGURE_SUB)
    return {
      label: ESTIMATED_RUN_RATE_LABEL,
      value: `${formatUsd(amount)}/mo`,
      sub: `${ESTIMATE_SUB} (Cost Explorer unavailable)${section.state === 'partial' ? ' · some resources have no estimate' : ''}`,
      amount,
      provenance: 'estimated',
    }
  }

  const notes = ['Actual · AWS Cost Explorer']
  if (amount < 0) notes.push('net of credits')
  if (lastDayInProgress) notes.push(TODAY_STILL_BILLING)
  if (section.state === 'partial') notes.push('partial data')
  return { label: ACTUAL_SPEND_LABEL, value: formatUsd(amount), sub: notes.join(' · '), amount, provenance: 'actual' }
}

/**
 * The same wording for GET /api/platform/stats/dashboard's figure
 * (monthlyAwsCost + costSource), which the by-team and /infrastructure cards
 * read. costSource decides the label: an 'estimated' amount (the inventory
 * run-rate the backend falls back to) is never called spend.
 */
export function describeStatsSpend(
  stats: { monthlyAwsCost: number; costSource?: 'actual' | 'estimated' } | undefined,
  { isLoading, isError }: QueryStatus
): SpendDisplay {
  const missing = (sub: string): SpendDisplay => ({ label: ACTUAL_SPEND_LABEL, value: '—', sub, amount: null, provenance: null })
  if (isLoading) return missing('Loading…')
  if (isError || !stats || !Number.isFinite(stats.monthlyAwsCost)) return missing('Could not be retrieved')
  const amount = stats.monthlyAwsCost
  if (!statsHasSpendFigure(stats)) return missing(NO_SPEND_FIGURE_SUB)
  if (stats.costSource === 'actual') {
    return { label: ACTUAL_SPEND_LABEL, value: formatUsd(amount), sub: 'Actual · AWS Cost Explorer', amount, provenance: 'actual' }
  }
  // 'estimated', or a response that does not say: never presented as billed spend.
  return { label: ESTIMATED_RUN_RATE_LABEL, value: `${formatUsd(amount)}/mo`, sub: ESTIMATE_SUB, amount, provenance: 'estimated' }
}

/**
 * What the month-over-month figure compares. It is fixed: this month's
 * finished days vs the same days of last month (the backend's comparison over
 * a 90-day Cost Explorer trend; the latest days, which Cost Explorer is still
 * reporting, are left out) -- it does not follow the Costs page's
 * 7D/30D/3M/6M/1Y chart range.
 */
export const MOM_BASIS_LABEL = 'Finished days this month vs same days last month · not the selected range'

/** No day of this month has finished reporting in AWS Cost Explorer yet. */
export const LATEST_DAYS_REPORTING = 'latest days still being reported'

/**
 * Billed spend whose finished-through day is still in the previous month: no
 * day of this month has finished reporting, so there is nothing to compare.
 */
export function noFinishedDayThisMonth(section: ContextSection<CostSpendEvidence> | undefined): boolean {
  const finishedThrough = section?.data?.finishedThrough
  const period = section?.period
  return section?.provenance === 'actual' && typeof finishedThrough === 'string' && period?.kind === 'range' && finishedThrough < period.start
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Oct 1–13" for an inclusive YYYY-MM-DD window within one month; "Oct 1" for a single day. */
function formatDayWindow(window: { start: string; end: string }): string {
  const [, m, startDay] = window.start.split('-').map(Number)
  const endDay = Number(window.end.split('-')[2])
  return startDay === endDay ? `${MONTH_ABBR[m - 1]} ${startDay}` : `${MONTH_ABBR[m - 1]} ${startDay}–${endDay}`
}

/**
 * "Oct 1–13 vs Sep 1–13" from the comparison's own windows. When the previous
 * month is shorter than the current window, its window stops at that month's
 * last day, and this says so.
 */
export function describeComparisonWindows(data: Pick<CostMonthOverMonthEvidence, 'currentWindow' | 'previousWindow'>): string {
  const text = `${formatDayWindow(data.currentWindow)} vs ${formatDayWindow(data.previousWindow)}`
  const currentDays = Number(data.currentWindow.end.split('-')[2])
  const previousDays = Number(data.previousWindow.end.split('-')[2])
  if (previousDays >= currentDays) return text
  const previousMonth = MONTH_ABBR[Number(data.previousWindow.start.split('-')[1]) - 1]
  return `${text} (${previousMonth} has only ${previousDays} days)`
}

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
 * The month-over-month KPI. Always this month's finished days vs the same days
 * last month (see MOM_BASIS_LABEL), independent of the selected chart range.
 * `noFinishedDay` (from the spend section, noFinishedDayThisMonth) says why a
 * comparison is missing early in the month.
 */
export function describeMonthOverMonth(
  section: ContextSection<CostMonthOverMonthEvidence> | undefined,
  { isLoading, isError }: QueryStatus,
  { noFinishedDay = false }: { noFinishedDay?: boolean } = {}
): MonthOverMonthDisplay {
  const missing = (sub: string): MonthOverMonthDisplay => ({ value: '—', sub, changePercent: null, direction: null, includesToday: false })
  if (isLoading) return missing('Loading…')
  if (isError || !section || section.state === 'error') return missing('Comparison could not be retrieved')
  if ((section.state !== 'available' && section.state !== 'partial') || !section.data) {
    return missing(noFinishedDay
      ? `No comparison yet · ${LATEST_DAYS_REPORTING}`
      : 'Comparison not available · not enough comparable AWS Cost Explorer data')
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
