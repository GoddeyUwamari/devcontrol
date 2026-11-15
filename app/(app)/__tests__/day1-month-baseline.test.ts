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
 *   Costs › By team      describeSpend               (costs/by-team/page.tsx; the stats endpoint before DAY1-D12)
 *   Services tile        describeServicesSpend       (services/SummaryTiles.tsx)
 *   Infrastructure       describeOverview tiles.spend + costByService (infrastructure/overview/overviewModel.ts)
 * Synthetic data only.
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import type { CostSummary } from '@/lib/types'
import { computeDashboardSpendCard } from '../dashboard/dashboardSpendCard'
import { describeSpend } from '../costs/cost-display'
import { describeServicesSpend } from '../services/SummaryTiles'
import { costByService, describeOverview } from '../infrastructure/overview/overviewModel'
import { inputs, ready, NOW } from '../infrastructure/__tests__/overview-fixtures'

const BACKEND = path.resolve(__dirname, '../../../backend/src/controllers/__tests__/__fixtures__/day1-month')
const DIR = path.join(__dirname, '__fixtures__', 'day1-month')
const WRITE = process.env.DAY1_MONTH_FIXTURES === 'write'
const CASES = ['d1_0030', 'd1_absent', 'd1_charge', 'd2_none', 'd2_charge', 'd3', 'd3_metric_key'] as const

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

/** Costs › By team as the page computes it: the cost summary, like Costs (DAY1-D12). */
function byTeam(s: CostSummary | undefined, isError: boolean) {
  return describeSpend(s?.spend, { isLoading: false, isError })
}

describe.each(CASES)('%s', (name) => {
  it('every month-to-date surface', () => {
    const s = summary(name)
    const isError = s === undefined
    const overview = describeOverview(inputs({ costSummary: isError ? { status: 'error' } : ready(s) }), NOW)
    pin(`${name}.views.json`, {
      dashboardCard: computeDashboardSpendCard({ costSummary: s, isLoading: false, isError }),
      costsMonthToDate: describeSpend(s?.spend, { isLoading: false, isError }),
      byTeam: byTeam(s, isError),
      servicesTile: describeServicesSpend({ loading: false, error: isError, summary: s }),
      infrastructureSpendTile: overview.tiles?.spend ?? null,
      infrastructureCostByService: costByService(isError ? { status: 'error' } : ready(s!)),
    })
  })
})
