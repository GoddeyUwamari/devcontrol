/**
 * PR2 empty states, the Services redesign (the live path: NEXT_PUBLIC_SERVICES_V2 + _REDESIGN): with no AWS
 * account connected (the server's connection state) the header keeps Deployments and shows an outlined
 * "Connect AWS account" in place of Scan now; the KPI tiles are label and "—" (Services keeps its real
 * "0 registered"); no card-level "Connect an AWS account" links, "— resources with no flagged issues" or
 * "Resource status: No resources discovered"; no All resources, attention or ownership from an earlier
 * connection; the shared NotConnectedCard and Your services with + Add Service. The subtitle is the new one in
 * both states. "Failed to load resources." has Try again. Until the connection check answers, grey blocks only.
 * Synthetic data only.
 */
process.env.TZ = 'UTC'

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ServicesPage from '../page'
import { R_NOW, redesignStats, scanOf, tab1 } from './redesign-fixtures'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/services',
}))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => false }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: (selector: any) => selector({ enabled: false }) }))
vi.mock('@/lib/hooks/use-plan', () => ({ usePlan: () => ({ tier: 'pro', isPro: true }) }))
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ organization: { id: 'org-test', name: 'Org Test' } }) }))
vi.mock('@/lib/hooks/use-current-role', () => ({ useCurrentRole: () => 'owner' }))
vi.mock('@/lib/hooks/use-registered-services', () => ({
  useRegisteredServices: () => ({ isPending: false, isError: false, isSuccess: true, data: [], refetch: vi.fn() }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))
const acct = vi.hoisted(() => ({ connection: 'not_connected' as string, pending: false }))
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
vi.mock('@/lib/services/aws-accounts.service', () => ({
  default: {
    getAccountsAndConnection: () => (acct.pending
      ? new Promise(() => {})
      : Promise.resolve({ accounts: acct.connection === 'connected' ? [{ id: 'acct-1' }] : [], connection: acct.connection })),
  },
}))
vi.mock('@/lib/services/platform-stats.service', () => ({
  platformStatsService: {
    getCostSummary: async () => ({
      spend: { state: 'unavailable', source: 'cost_explorer', provenance: null, asOf: null, coverage: null, reason: 'no account', data: null },
      monthOverMonth: { state: 'unavailable', source: 'x', provenance: null, asOf: null, coverage: null, reason: null, data: null },
    }),
  },
}))

const NEW_SUBTITLE = "Know what's running, what needs attention, and who owns it."
const UNMEASURED_TILES = ['Needs attention', 'Unowned', 'Resources', 'AWS spend, month to date']

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><ServicesPage /></QueryClientProvider>)
}
const tile = (label: string) => screen.getByRole('heading', { level: 2, name: label }).parentElement as HTMLElement

/** Connected: tab 1's one row set. Not connected: the same stored rows, left from an earlier connection. */
function serve(connected: boolean) {
  const scan = scanOf(tab1())
  acct.connection = connected ? 'connected' : 'not_connected'
  mockGetCoverage.mockResolvedValue(connected ? scan.coverage : { ...scan.coverage, account: { connected: false, status: null, home_region: null } })
  mockGetStats.mockResolvedValue(connected ? scan.stats : redesignStats())
  mockGetServices.mockImplementation(async (req: any = {}) => scan.list(req))
  return scan
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: R_NOW })
  vi.stubEnv('NEXT_PUBLIC_SERVICES_V2', 'true')
  vi.stubEnv('NEXT_PUBLIC_SERVICES_REDESIGN', 'true')
  vi.stubEnv('NEXT_PUBLIC_SERVICES_COVERAGE_M6', 'false')
  acct.pending = false
  mockGetServices.mockReset(); mockGetStats.mockReset(); mockGetCoverage.mockReset()
})
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers() })

describe('PR2: Services (redesign) with no AWS account connected', () => {
  it('header: new subtitle, Deployments stays, outlined Connect AWS account in place of Scan now', async () => {
    serve(false)
    renderPage()
    const button = await screen.findByTestId('connect-aws-header-button')
    expect(button).toHaveAttribute('href', '/connect-aws')
    expect(button).toHaveTextContent('Connect AWS account')
    expect(screen.getByText(NEW_SUBTITLE)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Deployments/ })).toHaveAttribute('href', '/deployments')
    expect(screen.queryByRole('button', { name: /Scan now|Scanning/ })).toBeNull()
    expect(screen.queryByTestId('services-scan-line')).toBeNull()
  })

  it('tiles: "—" with nothing under them; Services keeps its real "0 registered"', async () => {
    serve(false)
    renderPage()
    await screen.findByTestId('not-connected-card')
    await waitFor(() => expect(tile('Services')).toHaveTextContent('0registered'))
    for (const label of UNMEASURED_TILES) {
      const t = tile(label)
      expect(t.textContent).toBe(`${label}—`)
      expect(within(t).queryByRole('link')).toBeNull()
    }
    expect(screen.queryByRole('link', { name: 'Connect an AWS account' })).toBeNull()
    expect(screen.queryByText(/resources? with no flagged issues/)).toBeNull()
    expect(screen.queryByText(/Cost data not available yet/)).toBeNull()
  })

  it('the shared card and Your services; no coverage strip, All resources, attention or ownership', async () => {
    serve(false)
    const { container } = renderPage()
    const card = await screen.findByTestId('not-connected-card')
    expect(card.textContent).toBe('No AWS account connectedConnect AWS account')
    expect(within(card).getByRole('link', { name: 'Connect AWS account' })).toHaveAttribute('href', '/connect-aws')
    expect(screen.getByRole('heading', { name: /Your services/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Add Service/ })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Account and scan coverage' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'All resources' })).toBeNull()
    expect(screen.queryByTestId('organising-line')).toBeNull()
    expect(container.textContent).not.toMatch(/Resource status|No resources discovered|What needs attention|previous connection/)
    expect(screen.getAllByText('No AWS account connected')).toHaveLength(1)
  })

  it('connection loading: grey blocks only under the title and subtitle (Deployments stays)', async () => {
    serve(false)
    acct.pending = true
    renderPage()
    expect(await screen.findByTestId('connection-loading')).toBeInTheDocument()
    // Its own tile row: 5 blocks.
    expect(screen.getByTestId('connection-loading-tiles').children).toHaveLength(5)
    expect(screen.getByTestId('header-action-loading')).toBeInTheDocument()
    expect(screen.getByText(NEW_SUBTITLE)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Summary' })).toBeNull()
    expect(screen.queryByTestId('not-connected-card')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('PR2: Services (redesign) connected is unchanged, with the new subtitle', () => {
  it('Scan now, the coverage card, the tiles\' numbers and captions, All resources; no card', async () => {
    serve(true)
    renderPage()
    await screen.findByTestId('organising-line')
    expect(screen.getByText(NEW_SUBTITLE)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Scan now/ })).toBeInTheDocument()
    await waitFor(() => expect(tile('Resources')).not.toHaveTextContent('…'))
    expect(tile('Needs attention')).toHaveTextContent(/resources? with no flagged issues/)
    expect(screen.getByRole('region', { name: 'All resources' })).toBeInTheDocument()
    expect(screen.queryByTestId('not-connected-card')).toBeNull()
    expect(screen.queryByTestId('connect-aws-header-button')).toBeNull()
  })
})

describe('PR2: "Failed to load resources." has Try again', () => {
  it('connected, /stats failed: Try again asks again and the banner goes once it answers', async () => {
    const scan = serve(true)
    mockGetStats.mockRejectedValueOnce(new Error('500'))
    renderPage()
    const banner = (await screen.findByText('Failed to load resources.')).parentElement as HTMLElement
    const calls = mockGetStats.mock.calls.length
    mockGetStats.mockResolvedValue(scan.stats)
    fireEvent.click(within(banner).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(mockGetStats.mock.calls.length).toBeGreaterThan(calls))
    await waitFor(() => expect(screen.queryByText('Failed to load resources.')).toBeNull())
  })
})
