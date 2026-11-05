/**
 * /services "connected" (AWS connect PR B): only the server's connection state
 * (GET /api/aws/accounts `connection`) decides it. Resources left from an
 * earlier connection (the stats total) no longer make the page read as
 * connected, a failed check is never "not connected", and nothing is claimed
 * while the check is still loading.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ServicesPage from '../page'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/services',
}))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => false }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: (selector: any) => selector({ enabled: false }) }))
vi.mock('@/lib/hooks/use-plan', () => ({ usePlan: () => ({ tier: 'pro', isPro: true }) }))
vi.mock('../RegisteredServices', () => ({ RegisteredServices: () => null }))
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ organization: { id: 'org-test', name: 'Org Test' } }) }))

const mockGetServices = vi.fn()
const mockGetStats = vi.fn()
vi.mock('@/lib/services/aws-services.service', () => ({
  default: {
    getServices: (...args: unknown[]) => mockGetServices(...args),
    getStats: () => mockGetStats(),
    discoverServices: vi.fn(),
  },
}))

const mockConnection = vi.fn()
vi.mock('@/lib/services/aws-accounts.service', () => ({
  default: { getAccountsAndConnection: async () => {
    // FAIL and PENDING are answered here, not by the spy: a spy that itself returns a
    // rejected or never-settling promise is reported by vitest as the test's own error.
    const r = await mockConnection()
    if (r === 'FAIL') throw new Error('500')
    if (r === 'PENDING') return new Promise(() => {})
    return r
  } },
}))

const NOT_CONNECTED = 'No AWS account connected'
const UNKNOWN = "Couldn't check your AWS connection. Refresh to try again."
const NOTHING_DISCOVERED = 'No resources discovered yet'

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><ServicesPage /></QueryClientProvider>)
}

/** An empty list, but a stats total left from an earlier connection (stale AWS-derived data). */
function staleInventory(total: number) {
  mockGetServices.mockResolvedValue({
    services: [],
    pagination: { page: 1, limit: 50, total: 0, total_pages: 0, has_more: false },
    counts: { needs_attention: 0, no_flagged_issues: 0 },
  })
  mockGetStats.mockResolvedValue({ total, healthy: total, needs_attention: 0, avg_uptime: null })
}

beforeEach(() => {
  vi.clearAllMocks()
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}
})

describe('/services: connected comes from the server connection state only', () => {
  it('stale data: resources from an earlier connection, server says not connected -> not connected', async () => {
    staleInventory(7)
    mockConnection.mockResolvedValue({ accounts: [], connection: 'not_connected' })
    renderPage()
    expect(await screen.findByText(NOT_CONNECTED)).toBeInTheDocument()
    expect(screen.queryByText(NOTHING_DISCOVERED)).not.toBeInTheDocument()
  })

  it('disconnected: a row that is no longer active, with stale resources -> not connected', async () => {
    staleInventory(3)
    mockConnection.mockResolvedValue({ accounts: [{ id: 'acct-1', status: 'disconnected' }], connection: 'not_connected' })
    renderPage()
    expect(await screen.findByText(NOT_CONNECTED)).toBeInTheDocument()
  })

  it('error: a failed check is never "not connected", and stale resources never make it connected', async () => {
    staleInventory(5)
    mockConnection.mockResolvedValue('FAIL')
    renderPage()
    expect(await screen.findByTestId('services-connection-unknown')).toHaveTextContent(UNKNOWN)
    expect(screen.queryByText(NOT_CONNECTED)).not.toBeInTheDocument()
    expect(screen.queryByText(NOTHING_DISCOVERED)).not.toBeInTheDocument()
  })

  it('ambiguous: more than one active connection reads as unknown', async () => {
    staleInventory(0)
    mockConnection.mockResolvedValue({ accounts: [], connection: 'ambiguous' })
    renderPage()
    expect(await screen.findByTestId('services-connection-unknown')).toHaveTextContent(UNKNOWN)
    expect(screen.queryByText(NOT_CONNECTED)).not.toBeInTheDocument()
  })

  it('loading: claims neither state while the check has not answered', async () => {
    staleInventory(4)
    mockConnection.mockResolvedValue('PENDING')
    renderPage()
    await waitFor(() => expect(mockGetStats).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByText('Loading resources…')).toBeInTheDocument())
    expect(screen.queryByText(NOT_CONNECTED)).not.toBeInTheDocument()
    expect(screen.queryByText(NOTHING_DISCOVERED)).not.toBeInTheDocument()
    expect(screen.queryByTestId('services-connection-unknown')).not.toBeInTheDocument()
  })

  it('connected: the server reports one active connection -> connected, nothing discovered yet', async () => {
    staleInventory(0)
    mockConnection.mockResolvedValue({ accounts: [{ id: 'acct-1', status: 'active' }], connection: 'connected' })
    renderPage()
    expect(await screen.findByText(NOTHING_DISCOVERED)).toBeInTheDocument()
    expect(screen.queryByText(NOT_CONNECTED)).not.toBeInTheDocument()
  })
})
