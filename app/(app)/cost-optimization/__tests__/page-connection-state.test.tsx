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

const svc = vi.hoisted(() => ({ getConnection: vi.fn(), acknowledgeRunResult: vi.fn(async (_id: string) => undefined) }))
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
    // A result of a run this user started, waiting to be seen: shown only when connected.
    getMyRunResult: async () => ({
      id: 'run-placeholder', state: 'completed', completedAt: null, checksTotal: 1, checksRan: 1, failedChecks: [], services: ['EC2'],
      newCount: 0, openCount: 4, stillOpen: 4, message: null, findingsUnchanged: false,
    }),
    acknowledgeRunResult: (id: string) => svc.acknowledgeRunResult(id),
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

// PR2: the shared NotConnectedCard's heading.
const NOT_CONNECTED = 'No AWS account connected'

beforeEach(() => { svc.getConnection.mockReset(); svc.acknowledgeRunResult.mockClear() })

describe('Cost Optimization: connected comes from the server connection state only', () => {
  it.each([
    ['stale data, server not connected', { accounts: [], connection: 'not_connected' }],
    ['a row that is no longer active, with stale data', { accounts: [{ id: 'a', status: 'disconnected' }], connection: 'not_connected' }],
  ])('%s: not connected, whatever the stored run says', async (_label, answer) => {
    svc.getConnection.mockResolvedValue(answer)
    renderPage()
    await waitFor(() => expect(screen.getAllByText(NOT_CONNECTED).length).toBeGreaterThan(0))
    // The stored run's findings are not presented as this connection's result: no banner at all (PR2), and an
    // unseen result is not shown, so not acknowledged either.
    expect(screen.queryByTestId('scan-result-banner')).toBeNull()
    expect(svc.acknowledgeRunResult).not.toHaveBeenCalled()
    // Nor its 4 findings or counts (PR2: stale data from an earlier connection is hidden).
    expect(screen.queryByTestId('opportunities')).toBeNull()
    expect(screen.queryByTestId('summary-card')).toBeNull()
  })

  it.each([
    ['error', () => svc.getConnection.mockResolvedValue('FAIL')],
    ['ambiguous', () => svc.getConnection.mockResolvedValue({ accounts: [], connection: 'ambiguous' })],
  ])('%s: status unavailable, never connected and never "Connect AWS"', async (_label, arrange) => {
    arrange()
    renderPage()
    expect(await screen.findByTestId('last-analysis-unavailable')).toHaveTextContent("Couldn't load analysis status.")
    expect(screen.queryByText(NOT_CONNECTED)).not.toBeInTheDocument()
  })

  it('loading: neither connected nor not connected (PR2: grey blocks only, no banner, card or button)', async () => {
    svc.getConnection.mockResolvedValue('PENDING')
    renderPage()
    await waitFor(() => expect(svc.getConnection).toHaveBeenCalled())
    expect(screen.getByTestId('connection-loading')).toBeInTheDocument()
    expect(screen.getByTestId('header-action-loading')).toBeInTheDocument()
    expect(screen.queryByText(NOT_CONNECTED)).not.toBeInTheDocument()
    expect(screen.queryByTestId('scan-result-banner')).toBeNull()
    expect(screen.queryByRole('button', { name: /Run cost analysis/ })).toBeNull()
  })

  it('connected: the stored run is shown', async () => {
    svc.getConnection.mockResolvedValue({ accounts: [{ id: 'a', status: 'active' }], connection: 'connected' })
    renderPage()
    await waitFor(() => expect(screen.getByTestId('last-analysis')).toHaveTextContent(/ ago \(manual\)$/))
    expect(await screen.findByTestId('scan-result-banner')).toHaveAttribute('data-tone', 'success')
    expect(screen.queryByText(NOT_CONNECTED)).not.toBeInTheDocument()
  })
})
