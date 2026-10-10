/**
 * The Dashboard's spend KPI in real mode, from the same evidence sections the
 * Costs page reads (GET /api/platform/costs/summary: gatherCostContext() ->
 * spendSection() / monthOverMonthSection()). Actual Cost Explorer spend
 * (including $0, credits, and sub-dollar amounts), an inventory estimate, and
 * a missing figure each read differently -- none becomes $0, "Syncing…", or a
 * flat trend.
 *
 * Deliberately independent of /api/platform/stats/dashboard's monthlyAwsCost,
 * which still drives the AWS connection gates (computeDashboardAwsGates) and
 * the connection state (computeAwsConnectionState) unchanged.
 *
 * Lives in its own module (not exported from page.tsx) because Next.js's App
 * Router only permits a fixed set of named exports from a page file.
 */
import type { CostSummary } from '@/lib/types'
import { describeComparisonWindows, describeMonthOverMonth, describeSpend, LATEST_DAYS_REPORTING, MOM_BASIS_LABEL, noFinishedDayThisMonth } from '../costs/cost-display'
import { TREND_TOTALS_NOTE } from '@/lib/cost-trend-basis'

export interface DashboardSpendCard {
  label: string
  value: string
  /** Only when a real comparison exists; never a flat line for a missing one. */
  trend?: { direction: 'up' | 'down' | 'flat'; label: string; color: string }
  /** The one concise basis line on the card face; null while loading. */
  caption: string | null
  /** The info panel's full wording: provenance and comparison basis. null while loading. */
  evidence: { source: string; comparison: string } | null
}

/**
 * Day one of the month: the spend section's period is a single day and that
 * day is still being billed, so no day of this month has finished billing.
 */
function hasNoBilledDays(section: CostSummary['spend'] | undefined): boolean {
  const period = section?.period
  if (section?.provenance !== 'actual' || !section.data?.lastDayInProgress || period?.kind !== 'range') return false
  const [y, m, d] = period.start.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10) === period.endExclusive
}

/**
 * The face caption, from the same evidence fields describeSpend reads. The
 * month-over-month window's own "includes today" note stays in the panel, so
 * the still-billing day is mentioned once on the face.
 */
function spendFaceCaption(section: CostSummary['spend'] | undefined, spend: ReturnType<typeof describeSpend>, noBilledDays: boolean, noFinishedDay: boolean): string {
  if (spend.provenance === 'estimated') {
    return `Estimated from inventory · not AWS billed spend${section?.state === 'partial' ? ' · some resources have no estimate' : ''}`
  }
  if (spend.provenance !== 'actual' || !section?.data) return spend.sub
  const notes = ['Actual · AWS Cost Explorer']
  if (section.data.amount < 0) notes.push('net of credits')
  if (noBilledDays) notes.push('no billed days yet this month')
  else if (noFinishedDay) notes.push(LATEST_DAYS_REPORTING)
  else if (section.data.lastDayInProgress) notes.push('today still billing')
  if (section.state === 'partial') notes.push('partial data')
  return notes.join(' · ')
}

export function computeDashboardSpendCard(params: {
  costSummary: CostSummary | undefined
  isLoading: boolean
  isError: boolean
}): DashboardSpendCard {
  const { costSummary, isLoading, isError } = params
  const status = { isLoading, isError }
  const spend = describeSpend(costSummary?.spend, status)
  const noFinishedDay = noFinishedDayThisMonth(costSummary?.spend)
  const mom = describeMonthOverMonth(costSummary?.monthOverMonth, status, { noFinishedDay })

  if (isLoading) return { label: spend.label, value: spend.value, caption: null, evidence: null }

  const noBilledDays = hasNoBilledDays(costSummary?.spend)
  const caption = spendFaceCaption(costSummary?.spend, spend, noBilledDays, noFinishedDay)
  let trend: DashboardSpendCard['trend']
  let comparison: string
  if (noBilledDays) {
    // Today's partial day against a fully billed day last month is not a comparison.
    comparison = 'No comparison until a day of this month has finished billing'
  } else if (noFinishedDay && mom.direction === null) {
    // Days of this month are billed, but AWS Cost Explorer is still reporting them.
    comparison = 'No comparison until a day of this month has finished reporting · AWS Cost Explorer is still reporting the latest days'
  } else if (mom.direction !== null) {
    // A window that includes today compares against a day Cost Explorer is
    // still billing, so its direction is not yet a verdict: neutral, never the
    // "improvement" green. Otherwise the same thresholds as before: rising
    // spend on a bill of $100+ is a danger color.
    const color = mom.includesToday
      ? 'var(--text-secondary)'
      : mom.direction === 'up'
        ? ((spend.amount ?? 0) >= 100 ? 'var(--text-danger)' : 'var(--text-warning)')
        : mom.direction === 'down' ? 'var(--text-success)' : 'var(--text-warning)'
    trend = {
      direction: mom.direction,
      label: mom.changePercent !== null
        ? `${mom.value} vs same days last month`
        : `${mom.value} vs same days last month (% change undefined: last month was $0)`,
      color,
    }
    const windows = costSummary?.monthOverMonth.data ? ` · ${describeComparisonWindows(costSummary.monthOverMonth.data)}` : ''
    // Built from the floored daily trend (credits/refunds excluded), unlike the net month-to-date figure above it.
    comparison = `${MOM_BASIS_LABEL}${windows} · ${TREND_TOTALS_NOTE}${mom.includesToday ? ' · the current window ends today, which is still being billed' : ''}`
  } else {
    const failed = isError || costSummary?.monthOverMonth.state === 'error'
    comparison = failed ? 'Month-over-month could not be retrieved' : 'Month-over-month not available'
  }
  return { label: spend.label, value: spend.value, trend, caption, evidence: { source: spend.sub, comparison } }
}
