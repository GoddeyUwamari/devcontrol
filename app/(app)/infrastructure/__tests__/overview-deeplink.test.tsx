/**
 * The command palette's /infrastructure?resource=<id> (infra-overview-plan.md
 * §17.4). Flag on: sent on to /services?resource=<same id> with
 * router.replace, before any V2 request. Flag off: no redirect (the legacy
 * scroll and highlight are pinned by overview-flag-off.test.tsx's
 * resource-param snapshot). The zone is pinned and Date frozen before the page loads.
 */
const m = vi.hoisted(() => {
  process.env.TZ = 'UTC'
  vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-10-23T15:00:00Z') })
  return { param: null as string | null, demo: false, replace: vi.fn(), push: vi.fn(), log: [] as string[] }
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderInfrastructure } from './overview-harness'

const logged = vi.hoisted(() => (name: string, value: unknown = []) => () => { m.log.push(name); return Promise.resolve(value) })

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(m.param === null ? '' : `resource=${encodeURIComponent(m.param)}`),
  useRouter: () => ({ push: m.push, replace: m.replace }),
}))
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ organization: { id: 'org-test' } }) }))
vi.mock('@/lib/hooks/use-plan', () => ({ usePlan: () => ({ isFree: false, isStarter: true, isPro: true, tier: 'pro' }) }))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => m.demo }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: (selector: (s: { enabled: boolean }) => unknown) => selector({ enabled: false }) }))
vi.mock('@/lib/services/aws-services.service', () => ({
  default: {
    getCoverage: logged('coverage', null), getStats: logged('stats', { total: 0, healthy: 0, needs_attention: 0 }),
    getServices: logged('services'), discoverServices: logged('discover'),
  },
}))
vi.mock('@/lib/services/account-security-findings.service', () => ({ accountSecurityFindingsService: { getActive: logged('account-findings') } }))
vi.mock('@/lib/services/platform-stats.service', () => ({ platformStatsService: { getCostSummary: logged('cost-summary', null), getDashboardStats: logged('dashboard', { monthlyAwsCost: 0 }) } }))
vi.mock('@/lib/services/cost-recommendations.service', () => ({
  costRecommendationsService: { getStats: logged('recs-stats', { totalPotentialSavings: 0 }), getAll: logged('recs'), getActiveCount: logged('recs-count', 0) },
}))
vi.mock('@/lib/services/infrastructure.service', () => ({ infrastructureService: { getAll: logged('infrastructure') } }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const UUID = '550e8400-e29b-41d4-a716-446655440000'

beforeEach(() => {
  m.param = null
  m.demo = false
  m.replace.mockReset()
  m.push.mockReset()
  m.log.length = 0
  vi.stubEnv('NEXT_PUBLIC_INFRA_OVERVIEW_V2', 'true')
  Element.prototype.scrollIntoView = vi.fn()
  global.fetch = vi.fn().mockImplementation((url: string) => { m.log.push(`fetch ${url}`); return Promise.resolve({ ok: false }) }) as unknown as typeof fetch
})
afterEach(() => { vi.unstubAllEnvs() })

describe('DL-1 / DL-7 flag on: sent on to Services', () => {
  it('DL-1 router.replace once, with the same id, before any V2 request; never push', async () => {
    m.param = UUID
    const { container } = renderInfrastructure()
    await waitFor(() => expect(m.replace).toHaveBeenCalledTimes(1))
    expect(m.replace).toHaveBeenCalledWith(`/services?resource=${UUID}`)
    expect(m.push).not.toHaveBeenCalled()
    expect(m.log).toEqual([])
    expect(container.querySelector('main')).toBeNull()
  })
  it.each(['a&b=c', 'x#y', 'a/b', '100%', 'sp ace'])('DL-7 %j is encoded once in the redirect', async (id) => {
    m.param = id
    renderInfrastructure()
    await waitFor(() => expect(m.replace).toHaveBeenCalledTimes(1))
    const target = m.replace.mock.calls[0][0] as string
    expect(target).toBe(`/services?resource=${encodeURIComponent(id)}`)
    expect(new URL(target, 'https://x').searchParams.get('resource')).toBe(id)
  })
  it('no parameter: no redirect, the overview renders', async () => {
    renderInfrastructure()
    expect(await screen.findByRole('heading', { level: 1, name: 'Infrastructure Overview' })).toBeInTheDocument()
    expect(m.replace).not.toHaveBeenCalled()
  })
  it('demo: no redirect; the legacy page (which handles ?resource itself)', async () => {
    m.demo = true
    m.param = 'r1'
    renderInfrastructure()
    expect(await screen.findByText(/resources \(demo data\)/)).toBeInTheDocument()
    expect(m.replace).not.toHaveBeenCalled()
  })
})

describe('DL-2 flag off', () => {
  it('no redirect: the legacy page', async () => {
    vi.stubEnv('NEXT_PUBLIC_INFRA_OVERVIEW_V2', 'false')
    m.param = UUID
    renderInfrastructure()
    expect(await screen.findByRole('heading', { level: 1, name: 'AWS System Intelligence' })).toBeInTheDocument()
    expect(m.replace).not.toHaveBeenCalled()
  })
})
