/**
 * F1: NEXT_PUBLIC_INFRA_OVERVIEW_V2 is on only for exactly 'true'.
 * F3: with it off, the V2 module is never loaded: importing it throws here,
 * and the legacy page still renders (infra-overview-plan.md §8).
 * The flag-off render and requests themselves are pinned byte for byte by
 * overview-flag-off.test.tsx.
 */
const m = vi.hoisted(() => {
  process.env.TZ = 'UTC'
  vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-10-23T15:00:00Z') })
  return { demo: false }
})

import { describe, it, expect, vi, afterEach } from 'vitest'
import { screen } from '@testing-library/react'
import { isInfraOverviewV2Enabled } from '../infraOverviewV2Flag'
import { renderInfrastructure, settled } from './overview-harness'

vi.mock('../overview/InfrastructureOverviewV2', () => { throw new Error('V2 module loaded') })
vi.mock('next/navigation', () => ({ useSearchParams: () => ({ get: () => null }), useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))
vi.mock('@/lib/hooks/use-plan', () => ({ usePlan: () => ({ isFree: false, isStarter: true, isPro: true, tier: 'pro' }) }))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => m.demo }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: (selector: (s: { enabled: boolean }) => unknown) => selector({ enabled: false }) }))
vi.mock('@/lib/services/infrastructure.service', () => ({ infrastructureService: { getAll: vi.fn().mockResolvedValue([]) } }))
vi.mock('@/lib/services/cost-recommendations.service', () => ({
  costRecommendationsService: { getAll: vi.fn().mockResolvedValue([]), getStats: vi.fn().mockResolvedValue({ totalPotentialSavings: 0 }), getActiveCount: vi.fn().mockResolvedValue(0) },
}))
vi.mock('@/lib/services/platform-stats.service', () => ({ platformStatsService: { getDashboardStats: vi.fn().mockResolvedValue({ monthlyAwsCost: 0 }) } }))
vi.mock('@/lib/services/aws-services.service', () => ({ default: { getStats: vi.fn().mockResolvedValue({ total: 0, healthy: 0, needs_attention: 0 }), discoverServices: vi.fn() } }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

global.fetch = vi.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch
afterEach(() => { vi.unstubAllEnvs(); m.demo = false })

describe('F1 isInfraOverviewV2Enabled', () => {
  it.each([undefined, '', 'false', '1', 'TRUE', 'True', 'yes', ' true', 'true '])('is off for %j', (value) => {
    vi.stubEnv('NEXT_PUBLIC_INFRA_OVERVIEW_V2', value as string)
    expect(isInfraOverviewV2Enabled()).toBe(false)
  })
  it("is on only for 'true'", () => {
    vi.stubEnv('NEXT_PUBLIC_INFRA_OVERVIEW_V2', 'true')
    expect(isInfraOverviewV2Enabled()).toBe(true)
  })
})

describe('F3 flag off never loads the V2 module', () => {
  it('the mock is live: importing the V2 module throws in this file', async () => {
    // Vitest wraps the factory's error ('V2 module loaded') in its own message.
    await expect(import('../overview/InfrastructureOverviewV2')).rejects.toThrow(/error when mocking a module/)
  })
  it.each([['unset', undefined], ['false', 'false']])('flag %s: the legacy page renders', async (_, value) => {
    vi.stubEnv('NEXT_PUBLIC_INFRA_OVERVIEW_V2', value as string)
    const { client } = renderInfrastructure()
    expect(await screen.findByRole('heading', { level: 1, name: 'AWS System Intelligence' })).toBeInTheDocument()
    await settled(client)
  })
  it('flag off, demo mode: the legacy page renders', async () => {
    m.demo = true
    renderInfrastructure()
    expect(await screen.findByText(/resources \(demo data\)/)).toBeInTheDocument()
  })
})
