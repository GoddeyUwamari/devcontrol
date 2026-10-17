/**
 * /infrastructure Top Actions label each cost figure by its savings_basis: an
 * estimate is "save $X/mo" and counts toward "Est. savings", an S3 ceiling is
 * "up to $X/mo" and is kept out of it, and a figure with no basis is "no dollar
 * estimate" (never "$0/mo"). Same mocking harness as
 * infrastructure-kpi-truthfulness.test.tsx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import InfrastructurePage from '../page'
import { costRecommendationsService } from '@/lib/services/cost-recommendations.service'

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

const rec = (id: string, issue: string, potentialSavings: number, metadata: Record<string, unknown>) => ({
  id, resourceId: id, resourceName: id, resourceType: 'S3', issue, potentialSavings, severity: 'LOW', status: 'ACTIVE', awsRegion: 'us-east-1', metadata, createdAt: '', updatedAt: '',
})

describe('/infrastructure Top Actions -- savings basis', () => {
  it('estimate, ceiling and no-basis actions are labelled apart, and only estimates count toward Est. savings', async () => {
    mockServicesStats.mockResolvedValue({ total: 3, healthy: 3, needs_attention: 0 })
    vi.mocked(costRecommendationsService.getAll).mockResolvedValue([
      rec('example-bucket', 'S3 Lifecycle Optimization', 41.27, { savings_basis: 'ceiling: assumes 100% transitions' }),
      rec('vol-1', 'Unattached EBS Volume', 12.4, { savings_basis: 'estimated: list price' }),
      rec('ri-opportunity-m5.large', 'Reserved Instance Opportunity', 0, {}),
    ] as never)
    renderPage()

    const action = async (title: string) => (await screen.findByText(title, { selector: 'p' })) as HTMLElement
    expect(await action('S3 Lifecycle Optimization')).toHaveTextContent('S3 Lifecycle Optimization — up to $41/mo')
    expect(await action('Unattached EBS Volume')).toHaveTextContent('Unattached EBS Volume — save $12/mo')
    expect(await action('Reserved Instance Opportunity')).toHaveTextContent('Reserved Instance Opportunity — no dollar estimate')
    expect((await action('Reserved Instance Opportunity')).textContent).not.toMatch(/\$0/)

    await waitFor(() => expect(screen.getByText(/Est\. savings:/)).toHaveTextContent(
      'Est. savings: $12/mo · plus up to $41/mo (upper bound, not included)'
    ))
    expect(screen.getByText(/recoverable today/)).toHaveTextContent('$12/mo recoverable today')
  })
})
