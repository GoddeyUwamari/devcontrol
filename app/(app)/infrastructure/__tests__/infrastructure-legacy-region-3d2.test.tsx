/**
 * PR 3d-2 (D10): legacy /infrastructure Top Actions print each recommendation's own region and leave the
 * segment out without one; the old `?? 'us-east-1'` fallback named a region the response never sent.
 * Same mocking harness as infrastructure-savings-basis.test.tsx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
// The page reads the organization for its org- and UTC-day-keyed cost caches (DAY1-D10).
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ organization: { id: 'org-test', name: 'Org Test' }, user: { id: 'u' } }) }))
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import InfrastructurePage from '../page'
import { costRecommendationsService } from '@/lib/services/cost-recommendations.service'

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: () => null }),
}))

vi.mock('@/lib/hooks/use-plan', () => ({
  usePlan: () => ({ isFree: false, isStarter: true, isPro: true, isEnterprise: false, tier: 'pro', canAccess: () => true, lacksEntitlement: () => false }),
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

const component = (score: number, status: 'good' | 'warning' | 'risk') => ({ score, status, detail: '', label: '', severity: 'medium', delta: null, ready: true, state: 'available', reason: null as string | null })

function mockIntelligence(system_score: number | null, status: string, extra: { composite_state?: string | null; composite_reason?: string | null; costState?: string; costReason?: string | null; observabilityState?: string; observabilityReason?: string | null } = {}) {
  global.fetch = vi.fn().mockImplementation((url: string) => {
    if (url.includes('/api/observability/intelligence')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            system_score,
            status,
            composite_state: extra.composite_state ?? 'available',
            composite_reason: extra.composite_reason ?? null,
            components: { cost: { ...component(95, 'good'), state: extra.costState ?? 'available', reason: extra.costReason ?? null }, security: component(90, 'good'), observability: { ...component(88, 'good'), state: extra.observabilityState ?? 'available', reason: extra.observabilityReason ?? null } },
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

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('devcontrol_demo_mode', 'false')
  localStorage.setItem('accessToken', 'fake-token')
  mockIntelligence(92, 'Healthy')
})

afterEach(() => {
  vi.restoreAllMocks()
})

const rec = (id: string, awsRegion: string | null) => ({
  id, resourceId: id, resourceName: id, resourceType: 'EBS', issue: `Unattached volume ${id}`, potentialSavings: 12, severity: 'LOW',
  status: 'ACTIVE', awsRegion, metadata: { savings_basis: 'estimated: list price' }, createdAt: '', updatedAt: '',
})

describe('D10: legacy Infrastructure Top Actions', () => {
  it('the recommendation\'s own region, or no region segment; never a us-east-1 fallback', async () => {
    mockServicesStats.mockResolvedValue({ total: 2, healthy: 2, needs_attention: 0 })
    vi.mocked(costRecommendationsService.getAll).mockResolvedValue([rec('vol-eu', 'eu-west-1'), rec('vol-none', null)] as never)
    renderPage()
    expect(await screen.findByText('vol-eu · eu-west-1 · cost leakage active')).toBeInTheDocument()
    expect(await screen.findByText('vol-none · cost leakage active')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('vol-none · us-east-1')
  })
})
