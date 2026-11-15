/**
 * Day-1 month boundary, frontend side (day1-step1.md): what each money
 * surface shows for the backend's pinned cost summaries around 00:00 UTC on
 * the first of a month (backend/src/controllers/__tests__/__fixtures__/day1-month/,
 * cases in day1-month-baseline.test.ts), pinned in __fixtures__/day1-month/.
 * A change in any of them shows up as a diff of those files. To regenerate
 * after an approved change:
 *   DAY1_MONTH_FIXTURES=write npx vitest run day1-month-baseline
 *
 * Each surface is the helper its page calls with that payload:
 *   Dashboard card       computeDashboardSpendCard   (dashboard/page.tsx)
 *   Costs MTD card       describeSpend               (costs/page.tsx; Costs › Efficiency Total Spend calls the same)
 *   Costs › By team      the by-team spend helper    (costs/by-team/page.tsx)
 *   Services tile        describeServicesSpend       (services/SummaryTiles.tsx)
 *   Infrastructure       describeOverview tiles.spend + costByService (infrastructure/overview/overviewModel.ts)
 * Synthetic data only.
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import type { CostSummary } from '@/lib/types'
import { computeDashboardSpendCard } from '../dashboard/dashboardSpendCard'
import { describeSpend, describeStatsSpend } from '../costs/cost-display'
import { describeServicesSpend } from '../services/SummaryTiles'
import { costByService, describeOverview } from '../infrastructure/overview/overviewModel'
import { inputs, ready, NOW } from '../infrastructure/__tests__/overview-fixtures'

const BACKEND = path.resolve(__dirname, '../../../backend/src/controllers/__tests__/__fixtures__/day1-month')
const DIR = path.join(__dirname, '__fixtures__', 'day1-month')
const WRITE = process.env.DAY1_MONTH_FIXTURES === 'write'
const CASES = ['d1_0030', 'd1_absent', 'd1_charge', 'd2_none', 'd2_charge', 'd3', 'd3_metric_key'] as const
const ready_ = { isLoading: false, isError: false }

/** The cost summary response for a case, or undefined when the endpoint answered with an error. */
function summary(name: string): CostSummary | undefined {
  const body = JSON.parse(fs.readFileSync(path.join(BACKEND, `${name}.summary.json`), 'utf8'))
  return body.success ? body.data : undefined
}

function pin(name: string, value: unknown): void {
  const file = path.join(DIR, name)
  const body = `${JSON.stringify(value, null, 2)}\n`
  if (WRITE) {
    fs.mkdirSync(DIR, { recursive: true })
    fs.writeFileSync(file, body)
  }
  expect(body).toBe(fs.readFileSync(file, 'utf8'))
}

/**
 * Costs › By team as the page computes it. At the baseline it reads
 * GET /api/platform/stats/dashboard, whose figure is the same Cost Explorer
 * total (getMonthlySpendWithFallback: any success is 'actual').
 */
function byTeam(s: CostSummary | undefined) {
  const spend = s?.spend
  const stats = spend?.provenance === 'actual' && spend.data
    ? { monthlyAwsCost: spend.data.amount ?? 0, costSource: 'actual' as const }
    : { monthlyAwsCost: 0, costSource: 'estimated' as const }
  return describeStatsSpend(stats, ready_)
}

describe.each(CASES)('%s', (name) => {
  it('every month-to-date surface', () => {
    const s = summary(name)
    const isError = s === undefined
    const overview = describeOverview(inputs({ costSummary: isError ? { status: 'error' } : ready(s) }), NOW)
    pin(`${name}.views.json`, {
      dashboardCard: computeDashboardSpendCard({ costSummary: s, isLoading: false, isError }),
      costsMonthToDate: describeSpend(s?.spend, { isLoading: false, isError }),
      byTeam: byTeam(s),
      servicesTile: describeServicesSpend({ loading: false, error: isError, summary: s }),
      infrastructureSpendTile: overview.tiles?.spend ?? null,
      infrastructureCostByService: costByService(isError ? { status: 'error' } : ready(s!)),
    })
  })
})
