/**
 * The Dashboard's spend KPI in real mode, from the same evidence sections the
 * Costs page reads (GET /api/platform/costs/summary: gatherCostContext() ->
 * spendSection() / monthOverMonthSection()). Actual Cost Explorer spend
 * (including $0, credits, and sub-dollar amounts), an inventory estimate, and
 * a missing figure each read differently -- none becomes $0, "Syncing…", or a
 * flat trend.
 *
 * Deliberately independent of /api/platform/stats/dashboard's monthlyAwsCost,
 * which still drives the AWS connection gates and the /connect-aws redirect
 * (computeDashboardAwsGates) unchanged.
 *
 * Lives in its own module (not exported from page.tsx) because Next.js's App
 * Router only permits a fixed set of named exports from a page file.
 */
import type { CostSummary } from '@/lib/types'
import { describeMonthOverMonth, describeSpend, MOM_BASIS_LABEL, TODAY_STILL_BILLING } from '../costs/cost-display'

export interface DashboardSpendCard {
  label: string
  value: string
  /** Only when a real comparison exists; never a flat line for a missing one. */
  trend?: { direction: 'up' | 'down' | 'flat'; label: string; color: string }
  /** Provenance and comparison-basis lines under the value. */
  captions: string[]
}

export function computeDashboardSpendCard(params: {
  costSummary: CostSummary | undefined
  isLoading: boolean
  isError: boolean
}): DashboardSpendCard {
  const { costSummary, isLoading, isError } = params
  const status = { isLoading, isError }
  const spend = describeSpend(costSummary?.spend, status)
  const mom = describeMonthOverMonth(costSummary?.monthOverMonth, status)

  if (isLoading) return { label: spend.label, value: spend.value, captions: [] }

  const captions = [spend.sub]
  let trend: DashboardSpendCard['trend']
  if (mom.direction !== null) {
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
    captions.push(`${MOM_BASIS_LABEL}${mom.includesToday ? ` · ${TODAY_STILL_BILLING}` : ''}`)
  } else {
    const failed = isError || costSummary?.monthOverMonth.state === 'error'
    captions.push(failed ? 'Month-over-month could not be retrieved' : 'Month-over-month not available')
  }
  return { label: spend.label, value: spend.value, trend, captions }
}
