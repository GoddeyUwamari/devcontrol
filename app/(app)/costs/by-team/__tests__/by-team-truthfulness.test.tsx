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
 *     Cost Explorer data, an estimated run-rate (never "spend") otherwise --
 *     read from the cost summary with its month state, so the first days of a
 *     UTC month are never $0.00 (DAY1-D12).
 * Demo mode keeps its illustrative breakdown.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
// The page reads the organization for its org- and UTC-day-keyed cost caches (DAY1-D10).
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ organization: { id: 'org-test', name: 'Org Test' }, user: { id: 'u' } }) }))
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const demo = vi.hoisted(() => ({ on: false }))
const getCostSummary = vi.hoisted(() => vi.fn())
const getCosts = vi.hoisted(() => vi.fn())

vi.mock('@/lib/hooks/use-plan', () => ({
  usePlan: () => ({ status: 'known', isKnown: true, isFree: false, isStarter: true, isPro: true, isEnterprise: false, tier: 'pro', canAccess: () => true }),
}))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => demo.on }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: () => ({ enabled: false }) }))
vi.mock('@/lib/services/platform-stats.service', () => ({ platformStatsService: { getCostSummary } }))
vi.mock('@/lib/services/infrastructure.service', () => ({ infrastructureService: { getCosts } }))
vi.mock('@/lib/services/aws-accounts.service', () => ({ default: { getAccountsAndConnection: async () => { const accounts = await ([{ id: 'acct-1' }]); return { accounts, connection: accounts.length > 0 ? 'connected' : 'not_connected' } } } }))

import CostsByTeamPage from '../page'
import { DAY1_NONE, DAY2_CHARGE } from '../../__tests__/month-state-fixtures'

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <CostsByTeamPage />
    </QueryClientProvider>
  )
}

/** A cost summary whose spend is Cost Explorer (actual) or the inventory estimate. */
function stats(amount: number, provenance: 'actual' | 'estimated') {
  const actual = provenance === 'actual'
  return {
    spend: {
      state: 'available', source: actual ? 'AWS Cost Explorer' : 'DevControl inventory cost estimate', provenance, asOf: '2026-11-12T09:00:00.000Z', coverage: null, reason: null,
      period: actual ? { kind: 'range', start: '2026-11-01', endExclusive: '2026-11-13' } : { kind: 'point_in_time' },
      data: { amount, basis: actual ? 'billed_month_to_date' : 'estimated_monthly_run_rate', lastDayInProgress: false, finishedThrough: actual ? '2026-11-10' : null },
    },
    monthOverMonth: { state: 'unavailable', source: 'x', provenance: null, asOf: null, coverage: null, reason: 'fixture', data: null },
  }
}

beforeEach(() => {
  demo.on = false
  getCostSummary.mockReset()
  getCosts.mockReset()
  getCosts.mockResolvedValue({ data: { total_monthly_cost: 0, by_team: [{ team_name: 'Team A', cost: 0 }], by_service: [], by_resource_type: [] } })
})

describe('/costs/by-team -- real mode', () => {
  it('shows no per-team amounts, never requests the former breakdown, and says attribution is not available', async () => {
    getCostSummary.mockResolvedValue(stats(1234.5, 'actual'))
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
    getCostSummary.mockResolvedValue(stats(1234.5, 'actual'))
    renderPage()
    const card = await screen.findByTestId('by-team-spend-card')
    await waitFor(() => expect(card.textContent).toContain('$1,234.50'))
    expect(card.textContent).toContain('Month-to-Date Spend')
    expect(card.textContent).toContain('Actual · AWS Cost Explorer')
  })

  it('never labels an inventory estimate as spend', async () => {
    getCostSummary.mockResolvedValue(stats(412.5, 'estimated'))
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
    getCostSummary.mockResolvedValue(stats(0, 'estimated'))
    renderPage()
    const card = await screen.findByTestId('by-team-spend-card')
    await waitFor(() => expect(card.textContent).toContain('Not available · no AWS Cost Explorer spend or inventory estimate'))
    expect(card.textContent).toContain('—')
    expect(card.textContent).not.toMatch(/\$0/)
  })

  it('Dec 1 (UTC), nothing reported yet: no billed days yet, never $0.00', async () => {
    getCostSummary.mockResolvedValue(DAY1_NONE)
    renderPage()
    const card = await screen.findByTestId('by-team-spend-card')
    await waitFor(() => expect(card.textContent).toContain('Dec 1 (UTC) · AWS Cost Explorer · no billed days yet this month'))
    expect(card.textContent).toContain('—')
    expect(card.textContent).not.toContain('$0')
  })

  it('Dec 2 (UTC) with a charge: the amount, its UTC period, and that the latest days are still updating', async () => {
    getCostSummary.mockResolvedValue(DAY2_CHARGE)
    renderPage()
    const card = await screen.findByTestId('by-team-spend-card')
    await waitFor(() => expect(card.textContent).toContain('$13.30'))
    expect(card.textContent).toContain('Dec 1–2 (UTC) · Actual · AWS Cost Explorer · latest days still updating')
  })

  it('a failed stats request shows no figure, not $0', async () => {
    getCostSummary.mockRejectedValue(new Error('down'))
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
    expect(getCostSummary).not.toHaveBeenCalled()
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
