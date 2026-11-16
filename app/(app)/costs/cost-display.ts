/**
 * How the Costs page words its spend, month-over-month, and savings figures.
 * Every figure keeps its evidence state: a real $0 / 0% is shown as such,
 * while an unavailable or failed figure is shown as missing -- never as $0,
 * 0%, "flat", or "no spend". States come from the backend's evidence
 * sections (GET /api/platform/costs/summary); nothing is inferred here from a
 * value. The month-to-date figure's state comes from the backend's month state
 * (spend.data.monthState, cost-month-state.ts): "no billed days yet" is never
 * shown as $0.
 */
import type { ContextSection, CostMonthOverMonthEvidence, CostMonthState, CostSpendEvidence } from '@/lib/types'
import { annualizeMonthly, formatSavingsCurrency, formatUsdCents } from '@/lib/utils'

/** Cents precision, so a real sub-dollar amount never reads as "$0"; negatives (credits) keep their sign. */
export function formatUsd(amount: number): string {
  return formatUsdCents(amount)
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
 * nothing. On the stats endpoint it also stands in for Cost Explorer failing
 * or no connected account, which it cannot tell apart. Either way there is no
 * figure to show.
 */
export const NO_SPEND_FIGURE_SUB = 'Not available · no AWS Cost Explorer spend or inventory estimate'

/**
 * Whether GET /api/platform/stats/dashboard's figure is worth showing: Cost
 * Explorer data, or an estimate above $0. The backend sends 'actual' for any
 * successful Cost Explorer result (including $0 and a net-negative credit
 * month) and falls back to the inventory estimate only when Cost Explorer
 * fails (AWSCostService.getMonthlySpendWithFallback). The Dashboard's
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
    if (amount === null || !(amount > 0)) return missing(NO_SPEND_FIGURE_SUB)
    return {
      label: ESTIMATED_RUN_RATE_LABEL,
      value: `${formatUsd(amount)}/mo`,
      sub: `${ESTIMATE_SUB} (Cost Explorer unavailable)${section.state === 'partial' ? ' · some resources have no estimate' : ''}`,
      amount,
      provenance: 'estimated',
    }
  }

  // Billed spend: its UTC period first, then what the month's state says.
  const period = spendPeriodLabel(section)
  const state = monthStateOf(section)
  if (state === 'no_billed_days_yet') {
    return {
      label: ACTUAL_SPEND_LABEL, value: '—',
      sub: [...(period ? [period] : []), 'AWS Cost Explorer', NO_BILLED_DAYS_YET].join(' · '),
      amount: null, provenance: 'actual',
    }
  }
  if (amount === null || state === null || !KNOWN_USABLE_STATES.has(state)) {
    return missing(section.data.monthState?.reason?.text ?? 'Not available · no usable AWS Cost Explorer amount')
  }
  const notes = [...(period ? [period] : []), 'Actual · AWS Cost Explorer']
  if (amount < 0) notes.push('net of credits')
  if (monthHasUnfinishedDays(section)) notes.push(LATEST_DAYS_REPORTING)
  else if (lastDayInProgress) notes.push(TODAY_STILL_BILLING)
  if (section.state === 'partial') notes.push('partial data')
  return { label: ACTUAL_SPEND_LABEL, value: formatUsd(amount), sub: notes.join(' · '), amount, provenance: 'actual' }
}

/** The month states whose amount may be shown as a number. */
const KNOWN_USABLE_STATES: ReadonlySet<string> = new Set(['latest_days_updating', 'month_to_date'])

/** The no-billed-days wording, shared by every surface. */
export const NO_BILLED_DAYS_YET = 'no billed days yet this month'

/**
 * The current UTC month's state for billed spend: the backend's
 * spend.data.monthState when it sends one (cost-month-state.ts). A response
 * from a backend that predates it falls back to the earlier inference from
 * the period (FAR-4: removed one release after the month state ships). A state
 * this code does not know is returned as is; callers treat it as not usable.
 * null for anything that is not billed spend.
 */
export function monthStateOf(section: ContextSection<CostSpendEvidence> | undefined): string | null {
  const data = section?.data
  if (section?.provenance !== 'actual' || !data || data.basis !== 'billed_month_to_date') return null
  if (data.monthState) return data.monthState.state
  if (data.amount === null) return 'unavailable'
  if (!legacyNoBilledDays(section) && !legacyNoFinishedDay(section)) return 'month_to_date'
  const charges = data.amount !== 0 || (data.topServices?.length ?? 0) > 0
  return charges ? 'latest_days_updating' : 'no_billed_days_yet'
}

/**
 * The evidence-based billed-through day, only when it lies inside the
 * month-to-date period: never a calendar rule, never a day of another month
 * (DAY1-D8). null when the backend sends none.
 */
export function billedThroughInPeriod(section: ContextSection<CostSpendEvidence> | undefined): string | null {
  const month = section?.data?.monthState
  const through = month?.billedThrough
  if (!month || !through) return null
  return through >= month.period.start && through < month.period.endExclusive ? through : null
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

/** The latest days of this month are still updating in AWS Cost Explorer (one string everywhere, DAY1-D7). */
export const LATEST_DAYS_REPORTING = 'latest days still updating'

/** Pre-month-state inference (FAR-4 fallback): the finished-through day is still in the previous month. */
function legacyNoFinishedDay(section: ContextSection<CostSpendEvidence> | undefined): boolean {
  const finishedThrough = section?.data?.finishedThrough
  const period = section?.period
  return section?.provenance === 'actual' && typeof finishedThrough === 'string' && period?.kind === 'range' && finishedThrough < period.start
}

/** Pre-month-state inference (FAR-4 fallback): the period is one day that is still being billed. */
function legacyNoBilledDays(section: ContextSection<CostSpendEvidence> | undefined): boolean {
  const period = section?.period
  if (section?.provenance !== 'actual' || !section.data?.lastDayInProgress || period?.kind !== 'range') return false
  const [y, m, d] = period.start.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10) === period.endExclusive
}

/**
 * No day of this month has finished reporting in AWS Cost Explorer yet: the
 * month's state is no_billed_days_yet or latest_days_updating, so there is
 * nothing to compare.
 */
export function noFinishedDayThisMonth(section: ContextSection<CostSpendEvidence> | undefined): boolean {
  const state = monthStateOf(section)
  return state === 'no_billed_days_yet' || state === 'latest_days_updating'
}

/**
 * Rule 6 (trend-lag-build.md): the month's state is latest_days_updating, or
 * the backend's per-day evidence (monthState.reportDays) has a day of this
 * month that AWS Cost Explorer is still updating or has not reported yet. Then
 * a caption says "latest days still updating", never "today still billing".
 */
export function monthHasUnfinishedDays(section: ContextSection<CostSpendEvidence> | undefined): boolean {
  if (monthStateOf(section) === 'latest_days_updating') return true
  return unfinishedReportDays(section?.data?.monthState?.reportDays)
}

/**
 * An updating day, or a not-reported day after a recent charge. A
 * long-stopped account's not-reported days (afterRecentCharge false, review
 * M-1) are not "still updating". A backend without the flag counts them.
 */
function unfinishedReportDays(days: CostMonthState['reportDays']): boolean {
  if (!days) return false
  return days.updating > 0 || (days.notReported > 0 && days.afterRecentCharge !== false)
}

/**
 * No day of this month is final yet: noFinishedDayThisMonth (the month's
 * state), or the per-day evidence has days of this month and none of them is
 * final. The month-over-month comparison needs a final day (rule 5).
 */
export function noFinalDayThisMonth(section: ContextSection<CostSpendEvidence> | undefined): boolean {
  if (noFinishedDayThisMonth(section)) return true
  const days = section?.data?.monthState?.reportDays
  return !!days && days.final === 0 && unfinishedReportDays(days)
}

/** AWS Cost Explorer has no billed days for this month yet (the month's state). */
export function noBilledDaysThisMonth(section: ContextSection<CostSpendEvidence> | undefined): boolean {
  return monthStateOf(section) === 'no_billed_days_yet'
}

/**
 * AWS Cost Explorer has reported nothing for this month yet: "no data yet",
 * not a measured $0, so it is shown as "—", never "$0.00". A real $0 (a month
 * with a finished day and no charges) is month_to_date and shown as $0.00.
 */
export function noChargesReportedYet(section: ContextSection<CostSpendEvidence> | undefined): boolean {
  return noBilledDaysThisMonth(section)
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_NAME = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** The day before an exclusive YYYY-MM-DD end (calendar dates, UTC). */
function dayBefore(endExclusive: string): string {
  const [y, m, d] = endExclusive.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10)
}

/** "Nov 1–12 (UTC)", or "Nov 1 (UTC)" for one day: billed spend's own period; null for anything else. */
export function spendPeriodLabel(section: ContextSection<CostSpendEvidence> | undefined): string | null {
  const period = section?.period
  if (section?.provenance !== 'actual' || period?.kind !== 'range') return null
  return `${formatDayWindow({ start: period.start, end: dayBefore(period.endExclusive) })} (UTC)`
}

/**
 * "October (UTC): $412.37 · latest days still updating": the previous month's
 * net Cost Explorer total, only while no day of this month has finished (the
 * month-to-date figure has nothing to show yet). The "latest days" note only
 * while that month's last day is still inside Cost Explorer's reporting window.
 */
export function previousMonthLine(section: ContextSection<CostSpendEvidence> | undefined): string | null {
  if (section?.provenance !== 'actual' || !noFinishedDayThisMonth(section)) return null
  const fromState = section.data?.monthState?.previousMonth
  const previous = fromState
    ? { start: fromState.start, endExclusive: fromState.endExclusive, amount: fromState.amount }
    : section.data?.previousMonth
  if (!previous) return null
  const month = MONTH_NAME[Number(previous.start.split('-')[1]) - 1]
  const finishedThrough = section.data?.finishedThrough
  const stillUpdating = fromState
    ? fromState.latestDaysUpdating
    : typeof finishedThrough !== 'string' || finishedThrough < dayBefore(previous.endExclusive)
  return `${month} (UTC): ${formatUsd(previous.amount)}${stillUpdating ? ` · ${LATEST_DAYS_REPORTING}` : ''}`
}

/** "Dec 1" or "Dec 1–2": the billed month-to-date period's days, without the year. */
export function spendDaysLabel(section: ContextSection<CostSpendEvidence> | undefined): string | null {
  const period = section?.period
  if (section?.provenance !== 'actual' || period?.kind !== 'range') return null
  return formatDayWindow({ start: period.start, end: dayBefore(period.endExclusive) })
}

/** "Dec 2" for a YYYY-MM-DD day (UTC calendar date). */
export function shortDay(day: string): string {
  const [, m, d] = day.split('-').map(Number)
  return `${MONTH_ABBR[m - 1]} ${d}`
}

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
