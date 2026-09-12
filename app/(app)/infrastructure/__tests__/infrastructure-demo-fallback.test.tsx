/**
 * Regression coverage for the Infrastructure page "System Intelligence" demo-data
 * fallback fix.
 *
 * Confirmed issue: `intel` was computed as
 * `isDemoActive ? DEMO_INTELLIGENCE : (systemIntelligence ?? DEMO_INTELLIGENCE)` —
 * any real-account condition that left `systemIntelligence` null or undefined
 * (loading, missing auth token, a non-OK API response, or a thrown fetch error)
 * silently rendered the hardcoded DEMO_INTELLIGENCE object (system_score 73,
 * "$2,039/mo savings identified", "11 alarms configured", "Over-provisioned
 * compute + unused storage") as if it were that customer's own analysis, with no
 * loading state and no demo indicator.
 *
 * Fixed by making `intel` genuinely null for a real, not-ready account and gating
 * the entire detailed strip behind `intelReady`, mirroring the Dashboard page's
 * pre-existing, correct `systemIntelligence ?? null` pattern. A real account now
 * gets an honest "Calculating…" (loading) or "Not yet available" (settled empty/
 * error) placeholder instead.
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

vi.mock('@/lib/services/aws-services.service', () => ({
  default: {
    getStats: vi.fn().mockResolvedValue({ total: 0, healthy: 0, needs_attention: 0 }),
    discoverServices: vi.fn(),
  },
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <InfrastructurePage />
    </QueryClientProvider>
  )
}

const DEMO_TOP_ACTION_TEXT = 'Over-provisioned compute + unused storage'

describe('Infrastructure page — System Intelligence demo-data fallback safety', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('devcontrol_demo_mode', 'false')
    localStorage.setItem('accessToken', 'fake-token')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('never renders demo intelligence when the real-account intelligence API errors', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/observability/intelligence')) {
        return Promise.resolve({ ok: false } as Response)
      }
      if (url.includes('/api/anomalies')) {
        return Promise.resolve({ ok: true, json: async () => ({ anomalies: [] }) } as Response)
      }
      return Promise.resolve({ ok: false } as Response)
    }) as unknown as typeof fetch

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Not yet available')).toBeInTheDocument()
    })
    expect(screen.getByTestId('intel-not-ready')).toBeInTheDocument()

    expect(screen.queryByText(DEMO_TOP_ACTION_TEXT)).not.toBeInTheDocument()
    expect(screen.queryByText('Partially Optimized')).not.toBeInTheDocument()
    expect(screen.queryByText('87/100')).not.toBeInTheDocument()
  })

  it('never renders demo intelligence while the real-account intelligence query is loading', () => {
    global.fetch = vi.fn().mockImplementation(() => new Promise(() => {})) as unknown as typeof fetch

    renderPage()

    expect(screen.getByTestId('intel-not-ready')).toBeInTheDocument()
    expect(screen.getByText('Calculating…')).toBeInTheDocument()
    expect(screen.queryByText(DEMO_TOP_ACTION_TEXT)).not.toBeInTheDocument()
  })

  it('still renders demo intelligence in demo mode (legitimate sales-demo functionality preserved)', async () => {
    localStorage.setItem('devcontrol_demo_mode', 'true')
    global.fetch = vi.fn().mockImplementation(() => Promise.resolve({ ok: false } as Response)) as unknown as typeof fetch

    renderPage()

    await waitFor(() => {
      expect(screen.getByText(DEMO_TOP_ACTION_TEXT)).toBeInTheDocument()
    })
    expect(screen.queryByTestId('intel-not-ready')).not.toBeInTheDocument()
  })
})
