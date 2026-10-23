/**
 * DL-6: without ?resource, /services renders byte for byte as before the
 * resource card (infra-overview-plan.md §17.4), with NEXT_PUBLIC_SERVICES_V2
 * off and on. `__snapshots__/resource-focus-none.*.html` were written by the
 * page before the card existed (4859c7f), run from a separate worktree of
 * that commit. This file imports nothing new, so it runs there unchanged.
 *
 * The zone is pinned to UTC and Date frozen before the page module loads.
 */
const NOW = vi.hoisted(() => {
  process.env.TZ = 'UTC'
  const now = Date.parse('2026-10-22T15:00:00Z')
  vi.useFakeTimers({ toFake: ['Date'], now })
  return now
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { billed, emptyPage, normalizeIds, prodCoverage, renderPage, STATS } from './m6-fixtures'

const mockGetServices = vi.hoisted(() => vi.fn())
const mockGetResource = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
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
vi.mock('@/lib/services/aws-services.service', () => ({
  default: {
    getServices: (...args: unknown[]) => mockGetServices(...args),
    getStats: async () => STATS,
    getCoverage: async () => prodCoverage(NOW),
    discoverServices: vi.fn(),
    getResource: (...args: unknown[]) => mockGetResource(...args),
  },
}))
vi.mock('@/lib/services/aws-accounts.service', () => ({ default: { getAccounts: async () => [{ id: 'acct-1' }] } }))
vi.mock('@/lib/services/platform-stats.service', () => ({ platformStatsService: { getCostSummary: async () => billed() } }))

beforeEach(() => {
  vi.setSystemTime(NOW)
  mockGetServices.mockReset().mockImplementation(async (req: { limit?: number } = {}) => emptyPage(req.limit ?? 50))
  mockGetResource.mockReset()
})
afterEach(() => { vi.unstubAllEnvs() })

describe('DL-6 no ?resource: /services as before', () => {
  it.each(['false', 'true'])('NEXT_PUBLIC_SERVICES_V2=%s', async (flag) => {
    vi.stubEnv('NEXT_PUBLIC_SERVICES_V2', flag)
    const { container } = renderPage()
    await waitFor(() => expect(mockGetServices).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByText(/Loading/)).toBeNull())
    await expect(normalizeIds(container.innerHTML)).toMatchFileSnapshot(`./__snapshots__/resource-focus-none.v2-${flag}.html`)
    expect(mockGetResource).not.toHaveBeenCalled()
  })
})
