/**
 * NEXT_PUBLIC_SERVICES_REDESIGN off (anything but exactly 'true'): today's V2
 * page, byte for byte, whatever the backend sends (the PR 2 `multi_region`
 * key, the PR 3a keys `not_enabled_regions`, `home_only_coverage` and
 * `/stats.attention_scope`) and whatever NEXT_PUBLIC_SERVICES_COVERAGE_M6 says.
 *
 * `__snapshots__/redesign-flag-off.*.html` were written by the code BEFORE
 * PR 3b (origin/main eda85b22, this file's first commit) and must not change.
 * Unlike the M6 snapshots, the header scan line stays in: it must not change
 * either. The zone is pinned to UTC and the clock is fixed (Date only), so the
 * rendered times are the same on every machine and in CI.
 */
process.env.TZ = 'UTC'

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import type { ServicesCoverage } from '@/lib/services/aws-services.service'
import { billed, emptyPage, normalizeIds, prodCoverage, renderPage, STATS } from './m6-fixtures'
import { docExample } from './redesign-fixtures'

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
  useRegisteredServices: () => ({
    isPending: false, isError: false, isSuccess: true, refetch: vi.fn(),
    data: [{ id: 'svc-1', name: 'example-api', owner: 'owner-a@example.com', teamId: null, teamName: 'platform', githubUrl: null, createdAt: '2026-10-01T12:00:00.000Z' }],
  }),
}))
const mockGetServices = vi.fn()
const mockGetStats = vi.fn()
const mockGetCoverage = vi.fn()
const mockDiscover = vi.fn()
vi.mock('@/lib/services/aws-services.service', () => ({
  default: {
    getServices: (...args: unknown[]) => mockGetServices(...args),
    getStats: () => mockGetStats(),
    getCoverage: () => mockGetCoverage(),
    discoverServices: () => mockDiscover(),
  },
}))
vi.mock('@/lib/services/aws-accounts.service', () => ({ default: { getAccountsAndConnection: async () => ({ accounts: [{ id: 'acct-1' }], connection: 'connected' }) } }))
vi.mock('@/lib/services/platform-stats.service', () => ({ platformStatsService: { getCostSummary: async () => billed() } }))

const NOW = Date.parse('2026-10-22T15:00:00Z')
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString()

/** /stats with something in every tile and card, plus the PR 3a key. */
const STATS_FULL = {
  ...STATS,
  healthy: 7, needs_attention: 2,
  attention_by_severity: { critical: 1, high: 1, medium: 0, low: 0 },
  ownership: { owned: 5, unowned: 3, unknown: 1 },
  unknown_by_type: { cloudfront: 1 },
  attention_scope: { regions: 1, global: 0 },
}

/** A flagged organization's response: PR 2 + PR 3a keys on top of the M6 keys. */
function flaggedOrg(example: string, o: Partial<ServicesCoverage> = {}): ServicesCoverage {
  return { ...prodCoverage(NOW, {}, o), multi_region: docExample(example), not_enabled_regions: ['ap-east-1'] } as ServicesCoverage
}
/** An unflagged organization's response after PR 3a. */
function unflaggedOrg(): ServicesCoverage {
  return { ...prodCoverage(NOW), not_enabled_regions: ['ap-east-1'], home_only_coverage: { regions_total: 17, regions_checked: 1 } } as ServicesCoverage
}
const running = { scan_in_progress: { since: hoursAgo(0.25) }, last_scan: { status: 'running', started_at: hoursAgo(0.25), completed_at: null, warnings: [] } }

const STATES: Record<string, { m6: boolean; coverage: () => ServicesCoverage }> = {
  'm6-off.today': { m6: false, coverage: () => prodCoverage(NOW) },
  'm6-off.flagged-org': { m6: false, coverage: () => flaggedOrg('all_checked') },
  'm6-on.today': { m6: true, coverage: () => prodCoverage(NOW) },
  'm6-on.flagged-org': { m6: true, coverage: () => flaggedOrg('all_checked') },
  'm6-on.flagged-org-failed': { m6: true, coverage: () => flaggedOrg('regional_failure') },
  'm6-on.flagged-org-running': { m6: true, coverage: () => flaggedOrg('in_progress', running as Partial<ServicesCoverage>) },
  'm6-on.unflagged-org': { m6: true, coverage: () => unflaggedOrg() },
}

/** Flag values that must all read as off. */
const OFF_VALUES: (string | undefined)[] = [undefined, '', 'false', '1', 'TRUE', ' true', 'yes']

function stubRedesign(value: string | undefined) {
  vi.stubEnv('NEXT_PUBLIC_SERVICES_REDESIGN', value as string)
}

async function html(): Promise<string> {
  const { container, unmount } = renderPage()
  await screen.findByRole('region', { name: 'Account and scan coverage' })
  await waitFor(() => expect(screen.queryByText(/Loading scan coverage…|Loading resources…|Loading registered services/)).toBeNull())
  await screen.findByText(/What we didn.t check/)
  const out = normalizeIds(container.innerHTML)
  unmount()
  return out
}

beforeEach(() => {
  vi.clearAllMocks()
  demoMode = false
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
  vi.stubEnv('NEXT_PUBLIC_SERVICES_V2', 'true')
  mockGetServices.mockImplementation(async (req: any = {}) => emptyPage(req.limit ?? 50))
  mockGetStats.mockResolvedValue(STATS_FULL)
})
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers() })

describe('redesign flag off: the V2 page before PR 3b, byte for byte', () => {
  it.each(Object.keys(STATES))('%s', async (name) => {
    const state = STATES[name]
    vi.stubEnv('NEXT_PUBLIC_SERVICES_COVERAGE_M6', state.m6 ? 'true' : 'false')
    mockGetCoverage.mockImplementation(async () => state.coverage())
    const renders: string[] = []
    for (const value of OFF_VALUES) {
      stubRedesign(value)
      renders.push(await html())
    }
    for (const r of renders) expect(r).toBe(renders[0])
    await expect(renders[0]).toMatchFileSnapshot(`./__snapshots__/redesign-flag-off.${name}.html`)
  })

  it.each([false, true])('demo mode (M6 %s)', async (m6) => {
    demoMode = true
    vi.stubEnv('NEXT_PUBLIC_SERVICES_COVERAGE_M6', m6 ? 'true' : 'false')
    const renders: string[] = []
    for (const value of OFF_VALUES) {
      stubRedesign(value)
      const { container, unmount } = renderPage()
      await screen.findByText(/SAMPLE DATA/)
      await screen.findByText(/What we didn.t check/)
      renders.push(normalizeIds(container.innerHTML))
      unmount()
    }
    for (const r of renders) expect(r).toBe(renders[0])
    expect(mockGetCoverage).not.toHaveBeenCalled()
    await expect(renders[0]).toMatchFileSnapshot(`./__snapshots__/redesign-flag-off.demo-m6-${m6 ? 'on' : 'off'}.html`)
  })

  it('after Auto Discover (the button label and the refreshed page)', async () => {
    vi.stubEnv('NEXT_PUBLIC_SERVICES_COVERAGE_M6', 'true')
    stubRedesign('false')
    mockGetCoverage.mockImplementation(async () => flaggedOrg('all_checked'))
    mockDiscover.mockResolvedValue({ message: 'Discovery complete — 1 new, 2 updated', warnings: [], discovered: 1, updated: 2, errors: [], jobId: '00000000-0000-4000-8000-00000000a001' })
    const { container } = renderPage()
    await screen.findByText(/What we didn.t check/)
    const calls = mockGetCoverage.mock.calls.length
    fireEvent.click(screen.getAllByRole('button', { name: /Auto Discover/ })[0])
    await screen.findByRole('button', { name: /Discovery complete — 1 new, 2 updated/ })
    await waitFor(() => expect(mockGetCoverage.mock.calls.length).toBeGreaterThan(calls))
    await waitFor(() => expect(screen.queryByText(/Loading/)).toBeNull())
    await expect(normalizeIds(container.innerHTML)).toMatchFileSnapshot('./__snapshots__/redesign-flag-off.after-discover.html')
  })

  it.each([false, true])('the legacy page (V2 off), demo %s, whatever the redesign flag', async (demo) => {
    demoMode = demo
    vi.stubEnv('NEXT_PUBLIC_SERVICES_V2', 'false')
    mockGetCoverage.mockImplementation(async () => flaggedOrg('all_checked'))
    const renders: string[] = []
    for (const value of [...OFF_VALUES, 'true']) {
      stubRedesign(value)
      const { container, unmount } = renderPage()
      if (!demo) await waitFor(() => expect(mockGetStats).toHaveBeenCalled())
      await waitFor(() => expect(screen.queryByText(/Loading/)).toBeNull())
      renders.push(normalizeIds(container.innerHTML))
      unmount()
    }
    for (const r of renders) expect(r).toBe(renders[0])
    await expect(renders[0]).toMatchFileSnapshot(`./__snapshots__/redesign-flag-off.legacy-demo-${demo ? 'on' : 'off'}.html`)
  })

  it('the redesign flag does nothing while NEXT_PUBLIC_SERVICES_V2 is off', async () => {
    vi.stubEnv('NEXT_PUBLIC_SERVICES_V2', 'false')
    vi.stubEnv('NEXT_PUBLIC_SERVICES_COVERAGE_M6', 'true')
    stubRedesign('true')
    mockGetCoverage.mockImplementation(async () => flaggedOrg('all_checked'))
    renderPage()
    await waitFor(() => expect(mockGetStats).toHaveBeenCalled())
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Services$/)
    expect(mockGetCoverage).not.toHaveBeenCalled()
    expect(document.body.textContent).not.toMatch(/Scan now|Region coverage/)
  })
})
