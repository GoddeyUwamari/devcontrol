/**
 * Cost Optimization "connected" (AWS connect PR B): only the server's
 * connection state decides it. A finished run and recommendations left from an
 * earlier connection never make the page read as connected. Fixture data only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import CostOptimizationPage from '../page'
import { run } from './fixtures'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => false }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: (selector: any) => selector({ enabled: false }) }))

const svc = vi.hoisted(() => ({ getConnection: vi.fn() }))
vi.mock('@/lib/services/cost-recommendations.service', () => ({
  costRecommendationsService: {
    getAll: async () => [],
    getStats: async () => ({
      totalRecommendations: 4, activeRecommendations: 4, totalPotentialSavings: 120, potentialSavingsByResourceType: {},
      potentialSavingsCeiling: 0, potentialSavingsCeilingByResourceType: {}, bySeverity: { high: 1, medium: 2, low: 1 },
    }),
    getOptimizationRules: async () => ({ rules: [], summary: { totalRules: 0, implementedCount: 0, plannedCount: 0, services: [] } }),
    // A completed run with findings, from an earlier connection.
    getAnalysisRuns: async () => [run({ detected_count: 4, new_count: 4, persisted_count: 4 })],
    getHidden: async () => ({ latestRun: null, summary: { resolved: 0, dismissed: 0, stillDetected: { count: 0, estimatedMonthlySavings: 0, ceilingMonthlySavings: 0, ceilingByResourceType: {} }, notConfirmed: 0 }, items: [] }),
    analyze: vi.fn(),
  },
}))
vi.mock('@/lib/services/aws-accounts.service', () => ({ default: { getAccountsAndConnection: async () => {
    // FAIL and PENDING are answered here, not by the spy: a spy that itself returns a
    // rejected or never-settling promise is reported by vitest as the test's own error.
    const r = await svc.getConnection()
    if (r === 'FAIL') throw new Error('500')
    if (r === 'PENDING') return new Promise(() => {})
    return r
  } } }))
vi.mock('@/lib/services/aws-resources.service', () => ({ awsResourcesService: { getDiscoveryJobs: async () => [] } }))

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><CostOptimizationPage /></QueryClientProvider>)
}

const banner = () => screen.getByTestId('scan-status-banner')
const NOT_CONNECTED = 'Connect AWS to check for savings'

beforeEach(() => svc.getConnection.mockReset())

describe('Cost Optimization: connected comes from the server connection state only', () => {
  it.each([
    ['stale data, server not connected', { accounts: [], connection: 'not_connected' }],
    ['a row that is no longer active, with stale data', { accounts: [{ id: 'a', status: 'disconnected' }], connection: 'not_connected' }],
  ])('%s: not connected, whatever the stored run says', async (_label, answer) => {
    svc.getConnection.mockResolvedValue(answer)
    renderPage()
    await waitFor(() => expect(screen.getAllByText(NOT_CONNECTED).length).toBeGreaterThan(0))
    // The stored run's findings are not presented as this connection's result.
    expect(banner()).not.toHaveAttribute('data-tone', 'findings')
  })

  it.each([
    ['error', () => svc.getConnection.mockResolvedValue('FAIL')],
    ['ambiguous', () => svc.getConnection.mockResolvedValue({ accounts: [], connection: 'ambiguous' })],
  ])('%s: status unavailable, never connected and never "Connect AWS"', async (_label, arrange) => {
    arrange()
    renderPage()
    await waitFor(() => expect(within(banner()).getByText("Couldn't load analysis status")).toBeInTheDocument())
    expect(screen.queryByText(NOT_CONNECTED)).not.toBeInTheDocument()
  })

  it('loading: neither connected nor not connected', async () => {
    svc.getConnection.mockResolvedValue('PENDING')
    renderPage()
    await waitFor(() => expect(banner()).toBeInTheDocument())
    await waitFor(() => expect(svc.getConnection).toHaveBeenCalled())
    expect(screen.queryByText(NOT_CONNECTED)).not.toBeInTheDocument()
    expect(banner()).not.toHaveAttribute('data-tone', 'findings')
  })

  it('connected: the stored run is shown', async () => {
    svc.getConnection.mockResolvedValue({ accounts: [{ id: 'a', status: 'active' }], connection: 'connected' })
    renderPage()
    await waitFor(() => expect(banner()).toHaveAttribute('data-tone', 'findings'))
    expect(screen.queryByText(NOT_CONNECTED)).not.toBeInTheDocument()
  })
})
