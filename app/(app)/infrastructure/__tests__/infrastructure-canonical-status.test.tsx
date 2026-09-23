/**
 * The Infrastructure page's "System Score" status shows the canonical overall
 * System Intelligence status (backend scoreToStatus: Healthy / Stable /
 * Degraded / At Risk, or Pending when not ready). It previously compared the
 * status against the component-level good/warning/critical vocabulary, which
 * never matched, so every ready production score read "Calculating".
 *
 * Same mocking harness as infrastructure-demo-fallback.test.tsx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import InfrastructurePage from '../page'

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: () => null }),
}))

vi.mock('@/lib/hooks/use-plan', () => ({
  usePlan: () => ({ isFree: false, isStarter: true, isPro: true, isEnterprise: false, tier: 'pro', canAccess: () => true }),
}))

vi.mock('@/lib/services/infrastructure.service', () => ({
  infrastructureService: { getAll: vi.fn().mockResolvedValue([]) },
}))

vi.mock('@/lib/services/cost-recommendations.service', () => ({
  costRecommendationsService: {
    getAll: vi.fn().mockResolvedValue([]),
    getStats: vi.fn().mockResolvedValue({ totalPotentialSavings: 0 }),
    getActiveCount: vi.fn().mockResolvedValue(0),
  },
}))

vi.mock('@/lib/services/platform-stats.service', () => ({
  platformStatsService: {
    getDashboardStats: vi.fn().mockResolvedValue({ monthlyAwsCost: 0, activeDeployments: 0, totalServices: 0 }),
  },
}))

vi.mock('@/lib/services/aws-services.service', () => ({
  default: {
    getStats: vi.fn().mockResolvedValue({ total: 0, healthy: 0, needs_attention: 0 }),
    discoverServices: vi.fn(),
  },
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const component = (score: number, status: 'good' | 'warning' | 'risk') => ({ score, status, detail: '', label: '', severity: 'medium', delta: null, ready: true })

function mockIntelligence(system_score: number | null, status: string) {
  global.fetch = vi.fn().mockImplementation((url: string) => {
    if (url.includes('/api/observability/intelligence')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            system_score,
            status,
            components: { cost: component(95, 'good'), security: component(57, 'risk'), observability: component(55, 'risk') },
            top_action: { message: 'Real top action', consequence: '', path: '/costs', severity: 'high' },
            top_drivers: [],
            computed_at: '2026-09-23T00:00:00.000Z',
          },
        }),
      } as Response)
    }
    if (url.includes('/api/anomalies')) {
      return Promise.resolve({ ok: true, json: async () => ({ anomalies: [] }) } as Response)
    }
    return Promise.resolve({ ok: false } as Response)
  }) as unknown as typeof fetch
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <InfrastructurePage />
    </QueryClientProvider>
  )
}

const statusLine = () => screen.getByText('System Score').nextElementSibling?.textContent

describe('Infrastructure page -- canonical System Intelligence status', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('devcontrol_demo_mode', 'false')
    localStorage.setItem('accessToken', 'fake-token')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    [92, 'Healthy'],
    [75, 'Stable'],
    [68, 'Degraded'],
    [40, 'At Risk'],
  ])('real mode: score %i with canonical status "%s" shows that status, not "Calculating"', async (score, status) => {
    mockIntelligence(score, status)
    renderPage()

    // The loading placeholder also carries a "System Score" label -- wait for
    // the real, ready strip instead.
    await waitFor(() => expect(screen.queryByTestId('intel-not-ready')).not.toBeInTheDocument())
    expect(statusLine()).toBe(status)
    expect(screen.getByText(String(score))).toBeInTheDocument()
  })

  it('real mode: a Pending (not-ready) result shows the honest not-ready placeholder, never a status', async () => {
    mockIntelligence(null, 'Pending')
    renderPage()

    await waitFor(() => expect(screen.getByText('Not yet available')).toBeInTheDocument())
    // The System Score block is the not-ready placeholder, not the ready strip.
    // ("Healthy" etc. also appear elsewhere on the page as resource filters.)
    expect(screen.getByTestId('intel-not-ready')).toBeInTheDocument()
    expect(statusLine()).toBe('Not yet available')
    expect(screen.queryByText('Primary Issue')).not.toBeInTheDocument()
  })

  it('demo mode: the demo score of 73 is shown as "Stable" (canonical thresholds), not "Partially Optimized"', async () => {
    localStorage.setItem('devcontrol_demo_mode', 'true')
    global.fetch = vi.fn().mockImplementation(() => Promise.resolve({ ok: false } as Response)) as unknown as typeof fetch
    renderPage()

    await waitFor(() => expect(screen.queryByTestId('intel-not-ready')).not.toBeInTheDocument())
    expect(statusLine()).toBe('Stable')
    expect(screen.queryByText('Partially Optimized')).not.toBeInTheDocument()
  })

  it('the obsolete good/warning/critical comparisons for the overall status are gone', () => {
    const source = readFileSync(join(__dirname, '../page.tsx'), 'utf-8')
    expect(source).not.toMatch(/intel\?\.status === '(good|warning|critical)'/)
    expect(source).not.toMatch(/Partially Optimized/)
    expect(source).toMatch(/system_score: 73, status: 'Stable'/)
  })
})
