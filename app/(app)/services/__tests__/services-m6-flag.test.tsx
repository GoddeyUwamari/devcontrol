/**
 * NEXT_PUBLIC_SERVICES_COVERAGE_M6 (multi-region M6): on only for exactly
 * 'true'. Off, the page renders exactly as before M6 whatever the backend
 * sends: the M5c keys change nothing in the DOM. On, a backend without the
 * M5c keys (older than M5c) and demo mode still render the Phase 1 strip,
 * byte for byte. The flag does nothing while NEXT_PUBLIC_SERVICES_V2 is off.
 *
 * `flag-off.snap.html` was written by the code before M6 (origin/main
 * 4c006a1) for the same fixtures and is compared byte for byte.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import type { ServicesCoverage } from '@/lib/services/aws-services.service'
import { billed, emptyPage, normalizeIds, prodCoverage, renderPage, STATS, withoutM5c } from './m6-fixtures'
import { isServicesCoverageM6Enabled } from '../servicesCoverageM6Flag'

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
vi.mock('@/lib/services/aws-accounts.service', () => ({ default: { getAccounts: async () => [{ id: 'acct-1' }] } }))
vi.mock('@/lib/services/platform-stats.service', () => ({ platformStatsService: { getCostSummary: async () => billed() } }))

// A fixed clock, so "48 min ago" and "today" read the same in every render.
const NOW = Date.parse('2026-10-22T15:00:00Z')
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString()

beforeEach(() => {
  vi.clearAllMocks()
  demoMode = false
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
  vi.stubEnv('NEXT_PUBLIC_SERVICES_V2', 'true')
  mockGetServices.mockImplementation(async (req: any = {}) => emptyPage(req.limit ?? 50))
  mockGetStats.mockResolvedValue(STATS)
})
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers() })

/** The states whose Phase 1 rendering is pinned. */
const FIXTURES: Record<string, () => ServicesCoverage> = {
  today: () => prodCoverage(NOW),
  running: () => prodCoverage(NOW, {}, { scan_in_progress: { since: hoursAgo(0.25) }, last_scan: { status: 'running', started_at: hoursAgo(0.25), completed_at: null, warnings: [] } }),
  // A 5-minute-old running job with no held lease: Phase 1 still says "in progress" (its one-hour rule).
  abandoned: () => prodCoverage(NOW, {}, { last_scan: { status: 'running', started_at: hoursAgo(5 / 60), completed_at: null, warnings: [] } }),
  failed: () => prodCoverage(NOW, { status: 'denied' }, { last_scan: { status: 'failed', started_at: hoursAgo(1.2), completed_at: hoursAgo(1), warnings: [] } }),
}

async function html(coverage: ServicesCoverage): Promise<string> {
  mockGetCoverage.mockResolvedValue(coverage)
  const { container, unmount } = renderPage()
  await screen.findByRole('region', { name: 'Account and scan coverage' })
  await waitFor(() => expect(screen.queryByText(/Loading scan coverage…|Loading resources…/)).toBeNull())
  await screen.findByText(/What we didn.t check/)
  const out = normalizeIds(container.innerHTML)
  unmount()
  return out
}

describe('isServicesCoverageM6Enabled', () => {
  it.each([undefined, '', 'false', '1', 'TRUE', 'yes', ' true'])('is off for %j', (value) => {
    vi.stubEnv('NEXT_PUBLIC_SERVICES_COVERAGE_M6', value as string)
    expect(isServicesCoverageM6Enabled()).toBe(false)
  })
  it("is on only for 'true'", () => {
    vi.stubEnv('NEXT_PUBLIC_SERVICES_COVERAGE_M6', 'true')
    expect(isServicesCoverageM6Enabled()).toBe(true)
  })
})

describe('flag off: the page before M6, byte for byte', () => {
  it.each(Object.keys(FIXTURES))('%s: identical to the pre-M6 render, with or without the M5c keys', async (name) => {
    vi.stubEnv('NEXT_PUBLIC_SERVICES_COVERAGE_M6', 'false')
    const full = await html(FIXTURES[name]())
    const phase1 = await html(withoutM5c(FIXTURES[name]()))
    expect(full).toBe(phase1)
    expect(full).not.toMatch(/Region coverage|enabled regions checked|Scan running/)
    await expect(full).toMatchFileSnapshot(`./__snapshots__/m6-flag-off.${name}.html`)
  })

  it('unset is the same as false', async () => {
    vi.stubEnv('NEXT_PUBLIC_SERVICES_COVERAGE_M6', undefined as unknown as string)
    const unset = await html(FIXTURES.today())
    vi.stubEnv('NEXT_PUBLIC_SERVICES_COVERAGE_M6', 'false')
    expect(unset).toBe(await html(FIXTURES.today()))
  })
})

describe('flag on', () => {
  it.each(Object.keys(FIXTURES))('%s, older backend (no M5c keys): identical to flag off', async (name) => {
    vi.stubEnv('NEXT_PUBLIC_SERVICES_COVERAGE_M6', 'false')
    const off = await html(withoutM5c(FIXTURES[name]()))
    vi.stubEnv('NEXT_PUBLIC_SERVICES_COVERAGE_M6', 'true')
    expect(await html(withoutM5c(FIXTURES[name]()))).toBe(off)
  })

  it('demo mode stays Phase 1 (identical to flag off)', async () => {
    demoMode = true
    vi.stubEnv('NEXT_PUBLIC_SERVICES_COVERAGE_M6', 'false')
    const { container: off, unmount } = renderPage()
    await screen.findByText(/SAMPLE DATA/)
    const offHtml = normalizeIds(off.innerHTML)
    unmount()
    vi.stubEnv('NEXT_PUBLIC_SERVICES_COVERAGE_M6', 'true')
    const { container: on } = renderPage()
    await screen.findByText(/SAMPLE DATA/)
    expect(normalizeIds(on.innerHTML)).toBe(offHtml)
    expect(mockGetCoverage).not.toHaveBeenCalled()
  })

  it('does nothing while NEXT_PUBLIC_SERVICES_V2 is off', async () => {
    vi.stubEnv('NEXT_PUBLIC_SERVICES_V2', 'false')
    vi.stubEnv('NEXT_PUBLIC_SERVICES_COVERAGE_M6', 'true')
    mockGetCoverage.mockResolvedValue(FIXTURES.today())
    renderPage()
    await waitFor(() => expect(mockGetStats).toHaveBeenCalled())
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Services$/)
    expect(mockGetCoverage).not.toHaveBeenCalled()
    expect(document.getElementById('region-coverage')).toBeNull()
  })

  it('renders the region coverage for the same response', async () => {
    vi.stubEnv('NEXT_PUBLIC_SERVICES_COVERAGE_M6', 'true')
    const on = await html(FIXTURES.today())
    expect(on).toMatch(/1 of 17 enabled regions checked/)
    expect(on).toMatch(/id="region-coverage"/)
  })
})
