/**
 * /services must not call anything "healthy" that it has not measured. Its
 * counts come from /api/services/stats, where "healthy" means "not stopped or
 * failed and no high-severity finding" -- DevControl has no uptime or
 * performance monitoring for services -- and zero services or a failed request
 * must never read as all-healthy.
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

const mockGetServices = vi.fn()
const mockGetStats = vi.fn()
vi.mock('@/lib/services/aws-services.service', () => ({
  default: {
    getServices: (...args: unknown[]) => mockGetServices(...args),
    getStats: () => mockGetStats(),
    discoverServices: vi.fn(),
  },
}))

const mockGetAccounts = vi.fn()
vi.mock('@/lib/services/aws-accounts.service', () => ({
  default: { getAccounts: () => mockGetAccounts() },
}))

const HEALTH_CLAIMS = /all healthy|all systems healthy|system is healthy|services healthy|no impact detected|operating within thresholds|real[- ]?time/i

function service(id: string, needsAttention = false) {
  return {
    id, name: `svc-${id}`, environment: 'production', region: 'us-east-1', type: 'ec2',
    status: needsAttention ? 'warning' : 'healthy', uptime: null, monthly_cost: 10,
    needs_attention: needsAttention, priority_severity: needsAttention ? 'medium' : null, reason: needsAttention ? 'Resource is stopped or degraded' : null,
    lastDeployed: null,
  }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><ServicesPage /></QueryClientProvider>)
}

async function settled() {
  await waitFor(() => expect(mockGetStats).toHaveBeenCalled())
  await waitFor(() => expect(screen.queryByText('Loading services…')).not.toBeInTheDocument())
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetAccounts.mockResolvedValue([{ id: 'acct-1' }])
})

describe('/services -- no services discovered', () => {
  it('says so, and claims nothing about health', async () => {
    mockGetServices.mockResolvedValue([])
    mockGetStats.mockResolvedValue({ total: 0, healthy: 0, needs_attention: 0, avg_uptime: null })
    renderPage()
    await settled()

    expect((await screen.findAllByText('No services discovered')).length).toBeGreaterThan(0)
    expect(screen.getByText('No services have been discovered for this organization yet.')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(HEALTH_CLAIMS)
  })
})

describe('/services -- failed request', () => {
  it('is unavailable, not all-healthy', async () => {
    mockGetServices.mockRejectedValue(new Error('500'))
    mockGetStats.mockRejectedValue(new Error('500'))
    renderPage()
    await settled()

    expect((await screen.findAllByText('Service data unavailable')).length).toBeGreaterThan(0)
    expect(screen.getByText('Service data could not be retrieved.')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(HEALTH_CLAIMS)
  })
})

describe('/services -- services present', () => {
  it('none flagged reads as "no flagged issues", not healthy', async () => {
    mockGetServices.mockResolvedValue([service('1'), service('2')])
    mockGetStats.mockResolvedValue({ total: 2, healthy: 2, needs_attention: 0, avg_uptime: null })
    renderPage()
    await settled()

    expect((await screen.findAllByText('No services flagged')).length).toBeGreaterThan(0)
    expect(screen.getByText('No flagged issues across 2 services.')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(HEALTH_CLAIMS)
  })

  it('flagged services are still surfaced with their count', async () => {
    mockGetServices.mockResolvedValue([service('1'), service('2', true)])
    mockGetStats.mockResolvedValue({ total: 2, healthy: 1, needs_attention: 1, avg_uptime: null })
    renderPage()
    await settled()

    expect((await screen.findAllByText('1 of 2 at risk')).length).toBeGreaterThan(0)
    expect(screen.getByText(/1 service flagged for review/)).toBeInTheDocument()
  })
})
