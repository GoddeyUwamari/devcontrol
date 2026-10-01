/**
 * /infrastructure KPI cards, Infrastructure Posture, and resource table presentation.
 *
 * - The resource counts come from /api/services/stats, where "healthy" means
 *   "not stopped or failed and no high-severity finding" -- real mode says so
 *   instead of "Healthy · Running normally".
 * - The Critical Issues card's "1 cost inefficiency · 1 reliability risk"
 *   breakdown is demo copy and never appears for a real account.
 * - A failed stats request is unknown, not 0.
 * - Infrastructure Posture (the cost/security/alert-coverage composite) is not
 *   presented as measured uptime, performance, or resource health.
 * - Resource rows show their discovered AWS lifecycle state, never an invented
 *   "Healthy" / "Critical" verdict or error-rate claim.
 *
 * Same mocking harness as infrastructure-canonical-status.test.tsx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import InfrastructurePage from '../page'
import { infrastructureService } from '@/lib/services/infrastructure.service'

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

describe('/infrastructure Infrastructure Posture -- a posture composite, not measured health', () => {
  it('states what the score is built from next to its status', async () => {
    mockServicesStats.mockResolvedValue({ total: 0, healthy: 0, needs_attention: 0 })
    renderPage()

    const basis = await screen.findByTestId('system-score-basis')
    expect(basis.textContent).toMatch(/composite of cost, security, and alert coverage/i)
    expect(basis.textContent).toMatch(/not a measure of uptime, performance, or resource health/i)
  })

  it('is labeled Infrastructure Posture with Cost / Security / Alert Coverage components -- never System Score, Observability, or Healthy', async () => {
    mockServicesStats.mockResolvedValue({ total: 0, healthy: 0, needs_attention: 0 })
    renderPage()

    await screen.findByTestId('system-score-basis')
    expect(screen.getByText('Infrastructure Posture')).toBeInTheDocument()
    expect(screen.getByText('Strong')).toBeInTheDocument() // canonical 'Healthy' (92), display word only
    for (const label of ['Cost', 'Security', 'Alert Coverage']) expect(screen.getByText(label)).toBeInTheDocument()
    expect(screen.getByText('88%')).toBeInTheDocument() // alert coverage is a percentage, not /100
    for (const old of ['System Score', 'Observability', 'Healthy']) expect(screen.queryByText(old)).not.toBeInTheDocument()
  })
})

describe('/infrastructure subtitle', () => {
  it('makes no real-time claim', async () => {
    mockServicesStats.mockResolvedValue({ total: 0, healthy: 0, needs_attention: 0 })
    renderPage()

    const subtitle = await screen.findByText(/Visibility into cost, health, and risk/)
    expect(subtitle.textContent).not.toMatch(/real[- ]?time/i)
  })
})

describe('/infrastructure Infrastructure Posture -- partial composite', () => {
  const OBS_REASON = 'Measures EC2 alert coverage only (0 of 1 in-scope resources covered); monitoring coverage, signal freshness, response setup, and ALB/Lambda alert coverage are not supported yet.'
  const REASON = `Alert Coverage: ${OBS_REASON}`
  const COST_REASON = 'Insufficient spend data to assess cost efficiency. Spend based on inventory estimate, not AWS Cost Explorer billing. Anomaly checks not yet active.'

  it('a partial composite shows a visible "Partial" label with the backend composite reason, and marks only Alert Coverage partial', async () => {
    mockIntelligence(51, 'Degraded', { composite_state: 'partial', composite_reason: REASON, observabilityState: 'partial', observabilityReason: OBS_REASON })
    mockServicesStats.mockResolvedValue({ total: 0, healthy: 0, needs_attention: 0 })
    renderPage()

    const partial = await screen.findByTestId('system-score-partial')
    expect(partial.textContent).toBe(`Partial · ${REASON}`)
    expect(screen.getByTestId('observability-partial').textContent).toBe('Partial')
    expect(screen.queryByTestId('cost-partial')).not.toBeInTheDocument()
  })

  it('cost partial: the Cost chip is marked Partial and the composite reason names Cost with every cost limitation, score unchanged', async () => {
    const both = `Cost: ${COST_REASON} ${REASON}`
    mockIntelligence(51, 'Degraded', { composite_state: 'partial', composite_reason: both, costState: 'partial', costReason: COST_REASON, observabilityState: 'partial', observabilityReason: OBS_REASON })
    mockServicesStats.mockResolvedValue({ total: 0, healthy: 0, needs_attention: 0 })
    renderPage()

    const partial = await screen.findByTestId('system-score-partial')
    expect(partial.textContent).toBe(`Partial · ${both}`)
    expect(partial.textContent).not.toBe(`Partial · ${OBS_REASON}`)
    expect(screen.getByTestId('cost-partial').textContent).toBe('Partial')
    expect(screen.getByTestId('observability-partial').textContent).toBe('Partial')
    expect(screen.queryByTestId('security-partial')).not.toBeInTheDocument()
    expect(screen.getByText('95/100')).toBeInTheDocument()
  })

  it('an available composite shows no partial label', async () => {
    mockServicesStats.mockResolvedValue({ total: 0, healthy: 0, needs_attention: 0 })
    renderPage()

    await screen.findByTestId('system-score-basis')
    expect(screen.queryByTestId('system-score-partial')).not.toBeInTheDocument()
    expect(screen.queryByTestId('observability-partial')).not.toBeInTheDocument()
    expect(screen.queryByTestId('cost-partial')).not.toBeInTheDocument()
  })
})

describe('/infrastructure resource table -- lifecycle state, not invented health', () => {
  const resource = (id: string, status: string, costPerMonth: number) => ({
    id, serviceId: `svc-${id}`, serviceName: `service-${id}`, resourceType: 'ec2', awsId: `i-${id}`, awsRegion: 'us-east-1',
    status, costPerMonth, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
  })

  it('shows "running" / "stopped" as-is -- never "Healthy", "Critical", or an error-rate / downtime claim', async () => {
    vi.mocked(infrastructureService.getAll).mockResolvedValue([resource('a', 'running', 20), resource('b', 'stopped', 20)] as never)
    mockServicesStats.mockResolvedValue({ total: 2, healthy: 1, needs_attention: 1 })
    renderPage()

    await waitFor(() => expect(screen.getAllByText('running').length).toBeGreaterThan(0))
    expect(screen.getAllByText('stopped').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Not running · AWS lifecycle state: stopped/).length).toBeGreaterThan(0)
    expect(screen.queryByText('Healthy', { selector: 'span' })).not.toBeInTheDocument()
    expect(screen.queryByText('Critical', { selector: 'span' })).not.toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/elevated error rate|potential downtime/)
  })
})
