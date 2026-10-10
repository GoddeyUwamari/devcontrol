/**
 * /costs/efficiency, rendered against fixture API responses: a failed request
 * is never shown as a successful empty result or as $0.
 *   - Spend breakdown: a failed trend request reads as a failure; a successful
 *     empty one keeps the existing "no data yet" state.
 *   - Total Spend: the evidence-aware month-to-date figure (actual / estimate /
 *     unavailable / error), not /stats/dashboard's fallback value.
 *   - No fabricated "0% vs previous" deltas in real mode.
 *   - Inventory-derived figures say they are estimates; failures read "—".
 *   - Anomalies: no absence claim in real mode (no detector is connected).
 *   - The trend stays cached under ['cost-trend', '6mo'], distinct from the
 *     Costs page's ['costs-page', 'cost-trend', range].
 * All figures are test fixtures, not production data.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { CostSummary } from '@/lib/types'
import EfficiencyPage from '../page'

vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a> }))
vi.mock('@/lib/hooks/use-plan', () => ({ usePlan: () => ({ canAccess: true }) }))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => false }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: () => ({ enabled: false }) }))

const mockGetCostSummary = vi.fn()
const mockGetDashboardStats = vi.fn()
vi.mock('@/lib/services/platform-stats.service', () => ({
  platformStatsService: { getCostSummary: () => mockGetCostSummary(), getDashboardStats: () => mockGetDashboardStats() },
}))
const mockGetAllResources = vi.fn()
vi.mock('@/lib/services/infrastructure.service', () => ({ infrastructureService: { getAll: () => mockGetAllResources() } }))
const mockGetStats = vi.fn()
vi.mock('@/lib/services/cost-recommendations.service', () => ({ costRecommendationsService: { getStats: () => mockGetStats() } }))
const mockGetAnomalies = vi.fn()
vi.mock('@/lib/services/anomaly.service', () => ({ anomalyService: { getAnomalies: () => mockGetAnomalies() } }))

const actual = (amount: number): CostSummary => ({
  spend: {
    state: 'available', source: 'AWS Cost Explorer', provenance: 'actual', asOf: null, coverage: null, reason: null,
    data: { amount, basis: 'billed_month_to_date', lastDayInProgress: false },
  },
  monthOverMonth: { state: 'unavailable', source: 'x', provenance: null, asOf: null, coverage: null, reason: 'fixture', data: null },
})

function trendFetch(ok: boolean, data: unknown[] = []) {
  return vi.fn().mockResolvedValue({ ok, json: async () => (ok ? { success: true, data } : { success: false }) })
}

let client: QueryClient
function renderPage() {
  return render(<QueryClientProvider client={client}><EfficiencyPage /></QueryClientProvider>)
}
/** The KPI card whose label is `label`. */
async function kpi(label: string) {
  const el = await screen.findByText(label)
  return el.parentElement as HTMLElement
}

beforeEach(() => {
  vi.clearAllMocks()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  mockGetCostSummary.mockResolvedValue(actual(0))
  mockGetDashboardStats.mockResolvedValue({ monthlyAwsCost: 100, costSource: 'estimated' })
  mockGetAllResources.mockResolvedValue([
    { id: 'r1', resourceType: 'ec2', status: 'running', costPerMonth: 10, awsRegion: 'us-east-1' },
    { id: 'r2', resourceType: 'ec2', status: 'stopped', costPerMonth: 0.5, awsRegion: 'us-east-1' },
  ])
  mockGetStats.mockResolvedValue({ totalPotentialSavings: 0.96, activeRecommendations: 1 })
  mockGetAnomalies.mockResolvedValue({ anomalies: [] })
  vi.stubGlobal('fetch', trendFetch(true, [
    { date: '2026-08-01', compute: 0.21, storage: 0.1, database: 0, network: 0, other: 0, total: 0.31 },
    { date: '2026-09-01', compute: 0.3, storage: 0.1, database: 0, network: 0, other: 0, total: 0.4 },
  ]))
})
afterEach(() => vi.unstubAllGlobals())

describe('spend breakdown: a failure is not "no data"', () => {
  it('says its totals exclude credits and refunds', async () => {
    renderPage()
    expect(await screen.findByText('Monthly cost by service · Last 6 months · Credits/refunds excluded')).toBeInTheDocument()
  })

  it('a failed trend request reads as a failure', async () => {
    vi.stubGlobal('fetch', trendFetch(false))
    renderPage()

    expect(await screen.findByText('The spend trend could not be retrieved from AWS Cost Explorer.')).toBeInTheDocument()
    expect(screen.queryByText('No cost trend data available yet')).not.toBeInTheDocument()
  })

  it('a successful empty trend keeps the existing empty state', async () => {
    vi.stubGlobal('fetch', trendFetch(true, []))
    renderPage()

    expect(await screen.findByText('No cost trend data available yet')).toBeInTheDocument()
    expect(screen.queryByText(/could not be retrieved from AWS Cost Explorer/)).not.toBeInTheDocument()
  })

  it("stays under ['cost-trend', '6mo'], never the Costs page's key", async () => {
    renderPage()

    await waitFor(() => expect(client.getQueryData(['cost-trend', '6mo'])).toBeDefined())
    expect(client.getQueryCache().findAll({ queryKey: ['costs-page'] })).toEqual([])
  })
})

describe('Total Spend keeps its provenance', () => {
  it('actual $0 is $0.00 from AWS Cost Explorer -- not the legacy fallback figure', async () => {
    renderPage()

    const card = await kpi('Month-to-Date Spend')
    await waitFor(() => expect(card.textContent).toContain('$0.00'))
    expect(card.textContent).toMatch(/Actual · AWS Cost Explorer/)
    expect(document.body.textContent).not.toContain('$100')
    expect(mockGetDashboardStats).not.toHaveBeenCalled()
  })

  it('a net credit stays negative', async () => {
    mockGetCostSummary.mockResolvedValue(actual(-12.34))
    renderPage()

    const card = await kpi('Month-to-Date Spend')
    await waitFor(() => expect(card.textContent).toContain('-$12.34'))
  })

  it('an inventory estimate is labeled estimated', async () => {
    mockGetCostSummary.mockResolvedValue({
      ...actual(0),
      spend: {
        state: 'available', source: 'DevControl inventory cost estimate', provenance: 'estimated', asOf: null, coverage: null, reason: null,
        data: { amount: 42.5, basis: 'estimated_monthly_run_rate', lastDayInProgress: false },
      },
    })
    renderPage()

    const card = await kpi('Estimated Monthly Run-Rate')
    expect(card.textContent).toContain('$42.50/mo')
    expect(card.textContent).toMatch(/not AWS billed spend/)
  })

  it('a failed summary request is "—", never $0', async () => {
    mockGetCostSummary.mockRejectedValue(new Error('HTTP 500'))
    renderPage()

    const card = await kpi('Month-to-Date Spend')
    await waitFor(() => expect(card.textContent).toMatch(/Could not be retrieved/))
    expect(card.textContent).toContain('—')
    expect(card.textContent).not.toMatch(/\$0/)
  })
})

describe('other KPI cards', () => {
  it('no fabricated "0% vs previous" deltas in real mode', async () => {
    renderPage()

    await kpi('Month-to-Date Spend')
    expect(screen.queryByText('vs previous')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/0% vs previous/)
  })

  it('inventory-derived figures say they are estimates, keeping cents', async () => {
    renderPage()

    const perResource = await kpi('Cost Per Resource')
    await waitFor(() => expect(perResource.textContent).toContain('$5.25'))
    expect(perResource.textContent).toMatch(/Estimate from resource inventory/)
    const idle = await kpi('Idle Resource Cost')
    expect(idle.textContent).toContain('$0.50')
    expect(idle.textContent).toMatch(/Estimate from resource inventory/)
  })

  it('failed resource and savings requests read "—" and "Could not be retrieved", never $0', async () => {
    mockGetAllResources.mockRejectedValue(new Error('HTTP 500'))
    mockGetStats.mockRejectedValue(new Error('HTTP 500'))
    renderPage()

    for (const label of ['Cost Per Resource', 'Idle Resource Cost', 'Est. Savings Opportunity']) {
      const card = await kpi(label)
      await waitFor(() => expect(card.textContent).toMatch(/Could not be retrieved/))
      expect(card.textContent).not.toMatch(/\$0/)
    }
  })

  it('a successful empty anomalies response makes no absence claim', async () => {
    mockGetAnomalies.mockResolvedValue({ anomalies: [] })
    renderPage()

    expect(await screen.findByText('Cost anomaly detection is not currently available.')).toBeInTheDocument()
    expect(screen.queryByText('No cost anomalies detected')).not.toBeInTheDocument()
    expect(screen.queryByText('Anomalies could not be retrieved.')).not.toBeInTheDocument()
  })

  it('a failed anomalies request is not "No cost anomalies detected"', async () => {
    mockGetAnomalies.mockRejectedValue(new Error('HTTP 500'))
    renderPage()

    expect(await screen.findByText('Anomalies could not be retrieved.')).toBeInTheDocument()
    expect(screen.queryByText('No cost anomalies detected')).not.toBeInTheDocument()
  })
})
