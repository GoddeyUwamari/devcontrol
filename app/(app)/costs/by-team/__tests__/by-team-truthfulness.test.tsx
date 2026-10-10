/**
 * /costs/by-team in real mode.
 *
 * DevControl does not yet allocate the AWS bill to teams or services. The page
 * formerly summed infrastructure_resources (which discovery never fills) per
 * team, so every team read $0 next to a real total labeled "Total Monthly
 * Spend" -- even when that total was an inventory estimate. Now:
 *   - no team, service, or resource-type amounts are shown, and the former
 *     breakdown endpoint is not requested;
 *   - the page says attribution is not available yet;
 *   - the one figure shown is labeled by its source: month-to-date spend for
 *     Cost Explorer data, an estimated run-rate (never "spend") otherwise.
 * Demo mode keeps its illustrative breakdown.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const demo = vi.hoisted(() => ({ on: false }))
const getDashboardStats = vi.hoisted(() => vi.fn())
const getCosts = vi.hoisted(() => vi.fn())

vi.mock('@/lib/hooks/use-plan', () => ({
  usePlan: () => ({ isFree: false, isStarter: true, isPro: true, isEnterprise: false, tier: 'pro', canAccess: () => true }),
}))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => demo.on }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: () => ({ enabled: false }) }))
vi.mock('@/lib/services/platform-stats.service', () => ({ platformStatsService: { getDashboardStats } }))
vi.mock('@/lib/services/infrastructure.service', () => ({ infrastructureService: { getCosts } }))
vi.mock('@/lib/services/aws-accounts.service', () => ({ default: { getAccounts: vi.fn().mockResolvedValue([{ id: 'acct-1' }]) } }))

import CostsByTeamPage from '../page'

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <CostsByTeamPage />
    </QueryClientProvider>
  )
}

function stats(monthlyAwsCost: number, costSource?: 'actual' | 'estimated') {
  return { totalServices: 0, servicesChange: 0, activeDeployments: 0, deploymentsChange: 0, monthlyAwsCost, costChange: 0, totalTeams: 3, teamsChange: 0, costSource }
}

beforeEach(() => {
  demo.on = false
  getDashboardStats.mockReset()
  getCosts.mockReset()
  getCosts.mockResolvedValue({ data: { total_monthly_cost: 0, by_team: [{ team_name: 'Team A', cost: 0 }], by_service: [], by_resource_type: [] } })
})

describe('/costs/by-team -- real mode', () => {
  it('shows no per-team amounts, never requests the former breakdown, and says attribution is not available', async () => {
    getDashboardStats.mockResolvedValue(stats(1234.5, 'actual'))
    renderPage()
    await screen.findByTestId('by-team-attribution-unavailable')
    expect(screen.getByText('Cost attribution by team and service is not available yet')).toBeTruthy()
    expect(screen.queryByText('By Team')).toBeNull()
    expect(screen.queryByText('Teams Tracked')).toBeNull()
    expect(screen.queryByText('Top Spender')).toBeNull()
    expect(screen.queryByText('Team A')).toBeNull()
    expect(screen.queryByText('Export CSV')).toBeNull()
    expect(screen.queryByTestId('by-team-demo-badge')).toBeNull()
    expect(getCosts).not.toHaveBeenCalled()
  })

  it('labels Cost Explorer spend as month-to-date spend', async () => {
    getDashboardStats.mockResolvedValue(stats(1234.5, 'actual'))
    renderPage()
    const card = await screen.findByTestId('by-team-spend-card')
    await waitFor(() => expect(card.textContent).toContain('$1,234.50'))
    expect(card.textContent).toContain('Month-to-Date Spend')
    expect(card.textContent).toContain('Actual · AWS Cost Explorer')
  })

  it('never labels an inventory estimate as spend', async () => {
    getDashboardStats.mockResolvedValue(stats(412.5, 'estimated'))
    renderPage()
    const card = await screen.findByTestId('by-team-spend-card')
    await waitFor(() => expect(card.textContent).toContain('$412.50/mo'))
    expect(card.textContent).toContain('Estimated Monthly Run-Rate')
    expect(card.textContent).toContain('not AWS billed spend')
    expect(card.textContent).not.toMatch(/Month-to-Date Spend|Total Monthly Spend/)
    expect(screen.queryByText('Total Monthly Spend')).toBeNull()
    expect(screen.queryByText('Annual Projection')).toBeNull()
  })

  it('an estimate of $0 (Cost Explorer fallback with nothing estimated) shows no figure, not $0.00/mo', async () => {
    getDashboardStats.mockResolvedValue(stats(0, 'estimated'))
    renderPage()
    const card = await screen.findByTestId('by-team-spend-card')
    await waitFor(() => expect(card.textContent).toContain('Not available · no AWS Cost Explorer spend or inventory estimate'))
    expect(card.textContent).toContain('—')
    expect(card.textContent).not.toMatch(/\$0/)
  })

  it('a failed stats request shows no figure, not $0', async () => {
    getDashboardStats.mockRejectedValue(new Error('down'))
    renderPage()
    const card = await screen.findByTestId('by-team-spend-card')
    await waitFor(() => expect(card.textContent).toContain('Could not be retrieved'))
    expect(card.textContent).toContain('—')
    expect(card.textContent).not.toContain('$0')
  })
})

describe('/costs/by-team -- demo mode', () => {
  it('keeps the illustrative breakdown', async () => {
    demo.on = true
    renderPage()
    expect(await screen.findByText('By Team')).toBeTruthy()
    expect(screen.getByText('Teams Tracked')).toBeTruthy()
    expect(screen.queryByTestId('by-team-attribution-unavailable')).toBeNull()
    expect(getDashboardStats).not.toHaveBeenCalled()
  })

  it('labels the sample KPI cards and the sample breakdown "Demo data" on screen', async () => {
    demo.on = true
    renderPage()
    await screen.findByText('By Team')
    const badges = screen.getAllByTestId('by-team-demo-badge')
    expect(badges).toHaveLength(2)
    for (const b of badges) expect(b.textContent).toBe('Demo data')
    // One sits before the KPI cards, the other inside the breakdown panel.
    const kpi = screen.getByText('Teams Tracked')
    expect(badges[0].compareDocumentPosition(kpi) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(badges[1].closest('.p-6')?.textContent).toContain('Breakdown')
  })
})
