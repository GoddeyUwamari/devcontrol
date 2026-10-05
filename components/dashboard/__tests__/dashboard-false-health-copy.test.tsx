/**
 * Dashboard copy that claimed more than the data supports:
 *   - "Real-time" in the hero and footer (sources refresh on schedules; the
 *     socket only relays a few events),
 *   - a Cost Trends "Export" that only showed a success toast.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DashboardHero } from '../dashboard-hero'
import { CostTrendsCard } from '../cost-trends-card'

const trendPoint = { date: '2026-09-26', compute: 1, storage: 1, database: 1, network: 1, other: 1, total: 5 }

function costTrendsCard(isDemoActive: boolean) {
  return render(
    <CostTrendsCard
      isDemoActive={isDemoActive}
      hasBillingData
      costTrend={[trendPoint]}
      costTrendLoading={false}
      demoBreakdownData={[{ name: 'Compute', value: 100, change: 0, color: '#000' }]}
      demoTotalCost={100}
      dateRange="30d"
      onDateRangeChange={() => {}}
    />
  )
}

describe('Dashboard hero', () => {
  it.each(['connected', 'unconnected', 'unknown', 'loading'] as const)('makes no "real-time" claim (AWS: %s)', (awsConnection) => {
    const { container } = render(<DashboardHero awsConnection={awsConnection} canConnectAws orgName="Org" lastSynced={null} />)
    expect(container.textContent).not.toMatch(/real[- ]?time/i)
  })
})

describe('Cost Trends card', () => {
  it.each([true, false])('offers no Export action that does not export (demo: %s)', (demo) => {
    costTrendsCard(demo)
    expect(screen.queryByRole('button', { name: /export/i })).not.toBeInTheDocument()
  })
})

describe('Dashboard page source', () => {
  const source = readFileSync(join(__dirname, '..', '..', '..', 'app', '(app)', 'dashboard', 'page.tsx'), 'utf-8')

  it('has no "Real-time monitoring" footer claim', () => {
    expect(source).not.toMatch(/Real-time monitoring/i)
  })

  it('has no toast-only cost export', () => {
    expect(source).not.toMatch(/Exporting cost data/)
    expect(source).not.toMatch(/onExport=/)
  })
})
