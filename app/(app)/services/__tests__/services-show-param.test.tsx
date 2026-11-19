/**
 * PR 3d-2 (D7, D4) on the Services page:
 * - `/services?show=needs_attention` (Infrastructure's "View all {n} in Services & Ownership →") opens the
 *   redesign with Needs attention selected: the Show control reads it and the list asks the server for
 *   needs_attention only. Any other value, or none, is ignored (the page as before).
 * - D4: the redesign's What needs attention shows the one shared sentence; the V2 page without the
 *   redesign keeps its text (flag-off unchanged).
 * Same harness as services-redesign-states.test.tsx (tab 5 fixture, one row set). TZ UTC, fixed clock.
 *
 * 3d-2 review L-2: `useSearchParams` below counts its calls (one per render of a reader: ShowFromUrl,
 * ResourceFocus) and has a breaker. After SEARCH_PARAMS_BREAKER calls it reads an empty URL, so a page
 * that re-applies `?show=` on every render (ShowFromUrl without its once-only guard re-renders forever)
 * stops, and the "applied once" test fails on an assertion instead of the worker running out of memory.
 */
process.env.TZ = 'UTC'

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ServicesPage from '../page'
import { R_NOW, scanOf, tab5 } from './redesign-fixtures'

const nav = vi.hoisted(() => ({ search: '', reads: 0, tripped: false }))
/** Far above a settled page's reads (see the L-2 test); a render loop reaches it in one act(). */
const SEARCH_PARAMS_BREAKER = 500
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => {
    nav.reads += 1
    if (nav.reads > SEARCH_PARAMS_BREAKER) nav.tripped = true
    return new URLSearchParams(nav.tripped ? '' : nav.search)
  },
  usePathname: () => '/services',
}))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => false }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: (selector: (s: { enabled: boolean }) => unknown) => selector({ enabled: false }) }))
vi.mock('@/lib/hooks/use-plan', () => ({ usePlan: () => ({ tier: 'pro', isPro: true }) }))
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ organization: { id: 'org-test', name: 'Org Test' } }) }))
vi.mock('@/lib/hooks/use-current-role', () => ({ useCurrentRole: () => 'owner' }))
vi.mock('@/lib/hooks/use-registered-services', () => ({
  useRegisteredServices: () => ({ isPending: false, isError: false, isSuccess: true, data: [], refetch: vi.fn() }),
}))
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
vi.mock('@/lib/services/aws-accounts.service', () => ({ default: { getAccountsAndConnection: async () => ({ accounts: [{ id: 'acct-1' }], connection: 'connected' }) } }))
vi.mock('@/lib/services/platform-stats.service', () => ({
  platformStatsService: { getCostSummary: async () => ({ spend: { state: 'unavailable', source: 'x', provenance: null, asOf: null, coverage: null, reason: null, data: null }, monthOverMonth: { state: 'unavailable', source: 'x', provenance: null, asOf: null, coverage: null, reason: null, data: null } }) },
}))

const SHARED = 'Critical and high findings, cost recommendations estimated at $100/mo or more, and stopped, degraded or failed resources.'
const OLD = 'Critical and high findings, high-severity cost recommendations, stopped or failed resources'

function serve() {
  const scan = scanOf(tab5('ok'))
  mockGetCoverage.mockResolvedValue(scan.coverage)
  mockGetStats.mockResolvedValue(scan.stats)
  mockGetServices.mockImplementation(async (req: Parameters<typeof scan.list>[0] = {}) => scan.list(req))
}

async function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(<QueryClientProvider client={client}><ServicesPage /></QueryClientProvider>)
  await screen.findByRole('heading', { name: 'What needs attention' })
  await waitFor(() => expect(client.isFetching()).toBe(0))
  return view
}

/** The All resources list's Show control (the only one labelled "Show"). */
const showControl = () => screen.getByLabelText('Show') as HTMLSelectElement
/** The All resources list requests (page size > the attention table's 6 rows). */
const listRequests = (): Record<string, unknown>[] => mockGetServices.mock.calls.map((c) => c[0] ?? {}).filter((r: Record<string, unknown>) => r.limit !== 6)
const attentionHeader = () => screen.getByRole('heading', { name: 'What needs attention' }).parentElement!

beforeEach(() => {
  vi.clearAllMocks()
  nav.search = ''
  nav.reads = 0
  nav.tripped = false
  vi.useFakeTimers({ toFake: ['Date'], now: R_NOW })
  vi.stubEnv('NEXT_PUBLIC_SERVICES_V2', 'true')
  vi.stubEnv('NEXT_PUBLIC_SERVICES_REDESIGN', 'true')
  vi.stubEnv('NEXT_PUBLIC_SERVICES_COVERAGE_M6', 'false')
  serve()
})
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers() })

describe('D7: ?show=needs_attention opens Services with Needs attention selected', () => {
  it('?show=needs_attention: the Show control is Needs attention and the list asks for needs_attention only', async () => {
    nav.search = 'show=needs_attention'
    await renderPage()
    await waitFor(() => expect(showControl().value).toBe('needs_attention'))
    await waitFor(() => expect(listRequests().at(-1)).toMatchObject({ needs_attention: true }))
  })

  it('L-2: ?show=needs_attention is applied once: the page settles, no render loop', async () => {
    nav.search = 'show=needs_attention'
    await renderPage()
    await waitFor(() => expect(showControl().value).toBe('needs_attention'))
    const settled = nav.reads
    // Without the once-only guard, every render re-applies the filters and renders again: the reads
    // run up to the breaker inside the first act().
    expect(nav.tripped).toBe(false)
    expect(settled).toBeLessThan(SEARCH_PARAMS_BREAKER / 5)
    // Settled means settled: nothing re-applies it afterwards.
    await waitFor(() => expect(listRequests().at(-1)).toMatchObject({ needs_attention: true }))
    expect(nav.reads).toBe(settled)
  })

  it('L-2: after landing on Needs attention, the user can switch Show back to All and it stays there', async () => {
    nav.search = 'show=needs_attention'
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><ServicesPage /></QueryClientProvider>)
    await waitFor(() => expect(showControl().value).toBe('needs_attention'))
    await waitFor(() => expect(listRequests().at(-1)).toMatchObject({ needs_attention: true }))
    await waitFor(() => expect(client.isFetching()).toBe(0))

    fireEvent.change(showControl(), { target: { value: 'all' } })
    await waitFor(() => expect(listRequests().at(-1)).not.toHaveProperty('needs_attention'))
    await waitFor(() => expect(client.isFetching()).toBe(0))
    // The URL still says needs_attention; the page doesn't put it back.
    expect(nav.search).toBe('show=needs_attention')
    expect(showControl().value).toBe('all')
    expect(listRequests().at(-1)).not.toHaveProperty('needs_attention')
    expect(nav.tripped).toBe(false)
  })

  it.each(['', 'show=unowned', 'show=NEEDS_ATTENTION', 'show=bogus', 'resource=abc'])('negative %j: ignored, the page opens as before (Show = all)', async (search) => {
    nav.search = search
    await renderPage()
    expect(showControl().value).toBe('all')
    expect(listRequests().length).toBeGreaterThan(0)
    for (const r of listRequests()) expect(r).not.toHaveProperty('needs_attention')
  })

  it('negative: with the redesign off the parameter is ignored (flag-off unchanged)', async () => {
    vi.stubEnv('NEXT_PUBLIC_SERVICES_REDESIGN', 'false')
    nav.search = 'show=needs_attention'
    await renderPage()
    expect(showControl().value).toBe('all')
  })
})

describe('D4: the shared needs-attention sentence on Services', () => {
  it('redesign: the founder\'s sentence, not the old one', async () => {
    await renderPage()
    expect(within(attentionHeader()).getByText(SHARED)).toBeInTheDocument()
    expect(within(attentionHeader()).queryByText(OLD)).toBeNull()
  })
  it('negative: the V2 page without the redesign keeps its text byte for byte', async () => {
    vi.stubEnv('NEXT_PUBLIC_SERVICES_REDESIGN', 'false')
    await renderPage()
    expect(within(attentionHeader()).getByText(OLD)).toBeInTheDocument()
    expect(within(attentionHeader()).queryByText(SHARED)).toBeNull()
  })
})
