/**
 * /infrastructure KPI cards, Infrastructure Posture, and resource table presentation.
 *
 * - The resource counts come from /api/services/stats, where "healthy" means
 *   "not stopped or failed and no high-severity finding" -- real mode says so
 *   instead of "Healthy · Running normally".
 * - The red card's "1 cost inefficiency · 1 reliability risk" breakdown is demo
 *   copy and never appears for a real account.
 * - The red card is titled "Needs Attention" and says "critical" only when a
 *   Critical finding exists; it never hides a finding to get there.
 * - A resource with no lifecycle state shows "—", never "running".
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
import { platformStatsService } from '@/lib/services/platform-stats.service'
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

    await waitFor(() => expect(kpiCard('Needs Attention').textContent).toContain('1'))
    expect(document.body.textContent).not.toMatch(/1 cost inefficiency · 1 reliability risk/)
    expect(kpiCard('Needs Attention').textContent).toMatch(/Stopped, failed, or flagged by a finding or cost recommendation/)
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
    expect(kpiCard('Needs Attention').textContent).toContain('—')
    expect(kpiCard('No Flagged Issues').textContent).not.toMatch(/\b0\b/)
  })
})

describe('/infrastructure red card -- titled by what it counts, and says why', () => {
  const stats = (
    needs_attention: number,
    findings_by_severity?: { critical: number; high: number; medium: number; low: number },
    attention_reasons?: { with_finding: number; with_cost_recommendation: number; stopped_or_degraded: number; failed: number }
  ) => ({ total: 9, healthy: 9 - needs_attention, needs_attention, ...(findings_by_severity ? { findings_by_severity } : {}), ...(attention_reasons ? { attention_reasons } : {}) })
  const why = (with_finding: number, with_cost_recommendation = 0, stopped_or_degraded = 0, failed = 0) =>
    ({ with_finding, with_cost_recommendation, stopped_or_degraded, failed })
  const card = () => screen.getByTestId('infrastructure-attention-label').parentElement as HTMLElement
  const reasonLine = () => screen.getByTestId('infrastructure-attention-reasons').textContent

  it('with 0 Critical findings: the count is unchanged and the card never says "critical"', async () => {
    mockServicesStats.mockResolvedValue(stats(2, { critical: 0, high: 2, medium: 3, low: 9 }, why(2)))
    renderPage()

    await waitFor(() => expect(screen.getByTestId('infrastructure-attention-count').textContent).toBe('2'))
    expect(screen.getByTestId('infrastructure-attention-label').textContent).toBe('Needs Attention')
    expect(reasonLine()).toBe('2 high findings')
    expect(card().textContent).not.toMatch(/critical/i)
    expect(screen.queryByText('Critical Issues')).not.toBeInTheDocument()
  })

  it('names every reason resources are counted: findings, status and cost recommendations', async () => {
    mockServicesStats.mockResolvedValue(stats(4, { critical: 0, high: 2, medium: 3, low: 9 }, why(2, 1, 1)))
    renderPage()

    await waitFor(() => expect(reasonLine()).toBe('2 high findings · 1 stopped or degraded · 1 cost recommendation'))
    expect(screen.getByTestId('infrastructure-attention-count').textContent).toBe('4')
  })

  it('with Critical findings: says how many, beside the High ones', async () => {
    mockServicesStats.mockResolvedValue(stats(3, { critical: 1, high: 2, medium: 0, low: 0 }, why(3)))
    renderPage()

    await waitFor(() => expect(reasonLine()).toBe('1 critical finding · 2 high findings'))
    expect(screen.getByTestId('infrastructure-attention-count').textContent).toBe('3')
  })

  it('a resource counted on status alone: the card says so, never "No high-severity findings" beside a non-zero count', async () => {
    mockServicesStats.mockResolvedValue(stats(1, { critical: 0, high: 0, medium: 4, low: 2 }, why(0, 0, 1)))
    renderPage()

    await waitFor(() => expect(screen.getByTestId('infrastructure-attention-count').textContent).toBe('1'))
    expect(reasonLine()).toBe('1 stopped or degraded')
    expect(card().textContent).not.toMatch(/No high-severity findings/)
    expect(card().textContent).not.toMatch(/critical/i)
  })

  it('a backend that does not send the breakdown: the generic description, and still no "critical"', async () => {
    mockServicesStats.mockResolvedValue(stats(4))
    renderPage()

    await waitFor(() => expect(screen.getByTestId('infrastructure-attention-count').textContent).toBe('4'))
    expect(reasonLine()).toBe('Stopped, failed, or flagged by a finding or cost recommendation')
    expect(card().textContent).not.toMatch(/critical/i)
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
  const COST_REASON = 'Insufficient spend data to assess cost efficiency. Anomaly checks not yet active.'

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

describe('/infrastructure resource table -- no lifecycle status for a type that has none', () => {
  const row = (id: string, resourceType: string, status: string | null) => ({
    id, serviceId: `svc-${id}`, serviceName: `name-${id}`, resourceType, awsId: `aws-${id}`, awsRegion: 'us-east-1',
    status, costPerMonth: 5, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
  })

  it('an S3 bucket, an SNS topic and a VPC show "—": never "running", and never a "Not running" warning', async () => {
    vi.mocked(infrastructureService.getAll).mockResolvedValue(
      [row('bucket', 's3', null), row('topic', 'sns', null), row('network', 'vpc', null)] as never
    )
    mockServicesStats.mockResolvedValue({ total: 3, healthy: 3, needs_attention: 0, findings_by_severity: { critical: 0, high: 0, medium: 0, low: 0 } })
    renderPage()

    await waitFor(() => expect(screen.getAllByText('name-bucket').length).toBeGreaterThan(0))
    expect(screen.queryByText('running')).not.toBeInTheDocument()
    expect(screen.queryByText('pending')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/Not running/)
    for (const id of ['bucket', 'topic', 'network']) {
      expect(document.getElementById(`resource-${id}`)?.textContent).toContain('—')
    }
  })

  it('beside one, an EC2 instance still shows its own state', async () => {
    vi.mocked(infrastructureService.getAll).mockResolvedValue([row('bucket', 's3', null), row('vm', 'ec2', 'running')] as never)
    mockServicesStats.mockResolvedValue({ total: 2, healthy: 2, needs_attention: 0 })
    renderPage()

    await waitFor(() => expect(screen.getAllByText('running').length).toBeGreaterThan(0))
    expect(document.getElementById('resource-vm')?.textContent).toContain('running')
    expect(document.getElementById('resource-bucket')?.textContent).not.toContain('running')
  })
})

describe('/infrastructure spend card -- labeled by its source', () => {
  function mockSpend(monthlyAwsCost: number, costSource: 'actual' | 'estimated', totalPotentialSavings = 0) {
    vi.mocked(platformStatsService.getDashboardStats).mockResolvedValue({
      totalServices: 0, servicesChange: 0, activeDeployments: 0, deploymentsChange: 0,
      monthlyAwsCost, costChange: 0, totalTeams: 0, teamsChange: 0, costSource,
    })
    vi.mocked(costRecommendationsService.getStats).mockResolvedValue({ totalPotentialSavings } as any)
  }

  beforeEach(() => {
    mockServicesStats.mockResolvedValue({ total: 3, healthy: 3, needs_attention: 0, by_region: {} })
  })

  it('Cost Explorer spend is month-to-date spend', async () => {
    mockSpend(1234.5, 'actual')
    renderPage()
    await waitFor(() => expect(screen.getByTestId('infrastructure-spend-value').textContent).toContain('$1,234.50'))
    expect(screen.getByTestId('infrastructure-spend-label').textContent).toBe('Month-to-Date Spend')
  })

  it('an inventory estimate is a run-rate, never spend', async () => {
    mockSpend(412.5, 'estimated')
    renderPage()
    await waitFor(() => expect(screen.getByTestId('infrastructure-spend-value').textContent).toContain('$412.50/mo'))
    expect(screen.getByTestId('infrastructure-spend-label').textContent).toBe('Estimated Monthly Run-Rate')
    expect(document.body.textContent).toContain('not AWS billed spend')
  })

  // The backend never sends 'actual' with $0: Cost Explorer failing, a real $0
  // month, net credits and no account all arrive as an 'estimated' inventory
  // sum, which is $0 when nothing is estimated. That is no figure, not $0.00/mo.
  it('an estimate of $0 (any Cost Explorer fallback with nothing estimated) shows no figure, with the reason', async () => {
    mockSpend(0, 'estimated')
    renderPage()
    // The loading state is also "—", so wait for the reason, not the dash.
    await waitFor(() => expect(document.body.textContent).toContain('Not available · no AWS Cost Explorer spend or inventory estimate'))
    expect(screen.getByTestId('infrastructure-spend-value').textContent).toBe('—')
    expect(screen.getByTestId('infrastructure-spend-value').parentElement!.textContent).not.toMatch(/\$0/)
    expect(document.body.textContent).not.toContain('Syncing from Cost Explorer')
  })

  it('shows no "% of total spend" share of savings in real mode', async () => {
    mockSpend(200, 'actual', 50)
    renderPage()
    await waitFor(() => expect(screen.getByTestId('infrastructure-spend-value').textContent).toContain('$200.00'))
    expect(document.body.textContent).not.toMatch(/% of total spend/)
  })
})
