/**
 * /infrastructure KPI cards and System Score presentation.
 *
 * - The resource counts come from /api/services/stats, where "healthy" means
 *   "not stopped or failed and no high-severity finding" -- real mode says so
 *   instead of "Healthy · Running normally".
 * - The Critical Issues card's "1 cost inefficiency · 1 reliability risk"
 *   breakdown is demo copy and never appears for a real account.
 * - A failed stats request is unknown, not 0.
 * - The System Score (a readiness composite) is not presented as measured
 *   uptime or performance.
 *
 * Same mocking harness as infrastructure-canonical-status.test.tsx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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

const mockServicesStats = vi.fn()
vi.mock('@/lib/services/aws-services.service', () => ({
  default: {
    getStats: () => mockServicesStats(),
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
            components: { cost: component(95, 'good'), security: component(90, 'good'), observability: component(88, 'good') },
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

/** The KPI card whose uppercase label is `label`. */
function kpiCard(label: string) {
  return screen.getByText(label, { selector: 'p' }).parentElement as HTMLElement
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('devcontrol_demo_mode', 'false')
  localStorage.setItem('accessToken', 'fake-token')
  mockIntelligence(92, 'Healthy')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('/infrastructure KPI cards -- real mode', () => {
  it('never shows the demo "1 cost inefficiency · 1 reliability risk" breakdown', async () => {
    mockServicesStats.mockResolvedValue({ total: 3, healthy: 2, needs_attention: 1 })
    renderPage()

    await waitFor(() => expect(kpiCard('Critical Issues').textContent).toContain('1'))
    expect(document.body.textContent).not.toMatch(/1 cost inefficiency · 1 reliability risk/)
    expect(kpiCard('Critical Issues').textContent).toMatch(/Stopped, failed, or with a high-severity finding/)
  })

  it('labels the count as "no flagged issues", not "Healthy · Running normally"', async () => {
    mockServicesStats.mockResolvedValue({ total: 3, healthy: 2, needs_attention: 1 })
    renderPage()

    await waitFor(() => expect(kpiCard('No Flagged Issues').textContent).toContain('2'))
    expect(screen.queryByText('Running normally')).not.toBeInTheDocument()
  })

  it('a failed stats request is "—", not 0', async () => {
    mockServicesStats.mockRejectedValue(new Error('500'))
    renderPage()

    await waitFor(() => expect(mockServicesStats).toHaveBeenCalled())
    await waitFor(() => expect(kpiCard('No Flagged Issues').textContent).toContain('—'))
    expect(kpiCard('Critical Issues').textContent).toContain('—')
    expect(kpiCard('No Flagged Issues').textContent).not.toMatch(/\b0\b/)
  })
})

describe('/infrastructure System Score -- a readiness score, not measured health', () => {
  it('states what the score is based on next to its status', async () => {
    mockServicesStats.mockResolvedValue({ total: 0, healthy: 0, needs_attention: 0 })
    renderPage()

    const basis = await screen.findByTestId('system-score-basis')
    expect(basis.textContent).toMatch(/readiness/i)
    expect(basis.textContent).toMatch(/not measured uptime or performance/i)
  })
})
