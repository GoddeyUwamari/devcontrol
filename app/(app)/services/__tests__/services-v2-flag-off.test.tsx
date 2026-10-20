/**
 * With NEXT_PUBLIC_SERVICES_V2 unset or anything but 'true', /services is
 * today's page: none of the redesign renders and none of its requests
 * (coverage, the attention table, spend) is made. The DOM was also compared
 * byte for byte with main's page for these states when S1-C was written.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ServicesPage from '../page'
import { isServicesV2Enabled } from '../servicesV2Flag'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/services',
}))
let demoMode = false
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => demoMode }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: (selector: any) => selector({ enabled: false }) }))
vi.mock('@/lib/hooks/use-plan', () => ({ usePlan: () => ({ tier: 'pro', isPro: true }) }))
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ organization: { id: 'org-test', name: 'Org Test' } }) }))
vi.mock('../RegisteredServices', () => ({ RegisteredServices: () => <p>OLD REGISTERED SERVICES</p> }))
vi.mock('@/lib/hooks/use-current-role', () => ({ useCurrentRole: () => 'owner' }))

const mockGetServices = vi.fn()
const mockGetStats = vi.fn()
const mockGetCoverage = vi.fn()
vi.mock('@/lib/services/aws-services.service', () => ({
  default: {
    getServices: (...args: unknown[]) => mockGetServices(...args),
    getStats: () => mockGetStats(),
    getCoverage: () => mockGetCoverage(),
    discoverServices: vi.fn(),
  },
}))
vi.mock('@/lib/services/aws-accounts.service', () => ({ default: { getAccounts: async () => [{ id: 'acct-1' }] } }))
const mockGetCostSummary = vi.fn()
vi.mock('@/lib/services/platform-stats.service', () => ({ platformStatsService: { getCostSummary: () => mockGetCostSummary() } }))

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><ServicesPage /></QueryClientProvider>)
}

const REDESIGN_TEXT = /Services & Ownership|need attention\b|previous connection|No owner set|Show all \d|What we found, what needs attention|Account and scan coverage|What needs attention|Your services|No flagged issues: |SAMPLE DATA|Only admins can add services|AWS spend, month to date|resources are unowned|Phase 2/

beforeEach(() => {
  vi.clearAllMocks()
  demoMode = false
  mockGetServices.mockResolvedValue({ services: [], pagination: { page: 1, limit: 50, total: 0, total_pages: 0, has_more: false }, counts: { needs_attention: 0, no_flagged_issues: 0 } })
  mockGetStats.mockResolvedValue({ total: 0, healthy: 0, needs_attention: 0, avg_uptime: null, aws_accounts_connected: 1 })
})
afterEach(() => { vi.unstubAllEnvs() })

describe('NEXT_PUBLIC_SERVICES_V2', () => {
  it.each([undefined, '', 'false', '1', 'TRUE', 'yes'])('is off for %j', (value) => {
    if (value === undefined) vi.stubEnv('NEXT_PUBLIC_SERVICES_V2', undefined as unknown as string)
    else vi.stubEnv('NEXT_PUBLIC_SERVICES_V2', value)
    expect(isServicesV2Enabled()).toBe(false)
  })

  it("is on only for 'true'", () => {
    vi.stubEnv('NEXT_PUBLIC_SERVICES_V2', 'true')
    expect(isServicesV2Enabled()).toBe(true)
  })
})

describe('flag off: today\'s page', () => {
  it('keeps the "Services" heading and "at risk" wording', async () => {
    vi.stubEnv('NEXT_PUBLIC_SERVICES_V2', 'false')
    mockGetStats.mockResolvedValue({ total: 5, healthy: 3, needs_attention: 2, avg_uptime: null, aws_accounts_connected: 0 })
    renderPage()
    await waitFor(() => expect(screen.getAllByText('2 of 5 at risk')).toHaveLength(2))
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Services$/)
    expect(document.body.textContent).not.toMatch(REDESIGN_TEXT)
  })

  it.each([false, true])('renders the current page and none of the redesign (demo %s)', async (demo) => {
    vi.stubEnv('NEXT_PUBLIC_SERVICES_V2', 'false')
    demoMode = demo
    renderPage()
    if (!demo) await waitFor(() => expect(mockGetStats).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByText('Loading resources…')).not.toBeInTheDocument())

    expect(screen.getByText('Until services are mapped, this page lists the AWS resources discovered in your connected account and any flagged issues.')).toBeInTheDocument()
    expect(screen.getByText('Deployment history and tracking')).toBeInTheDocument()
    expect(screen.getByText('OLD REGISTERED SERVICES')).toBeInTheDocument()
    // The status strip renders a phone and a desktop layout.
    expect(screen.getAllByText(demo ? 'Service Health Score' : 'Resource status')).toHaveLength(2)
    expect(screen.getByText('AWS resources')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(REDESIGN_TEXT)
    expect(mockGetCoverage).not.toHaveBeenCalled()
    expect(mockGetCostSummary).not.toHaveBeenCalled()
    expect(mockGetServices.mock.calls.every(([req]: any[]) => req.limit === 50)).toBe(true)
  })
})
