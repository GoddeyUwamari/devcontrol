/**
 * /infrastructure Top Actions label each cost figure by its savings_basis: an
 * estimate is "save $X/mo" and counts toward "Est. savings", an S3 ceiling is
 * "up to $X/mo" and is kept out of it, and a figure with no basis is "no dollar
 * estimate" (never "$0/mo"). Same mocking harness as
 * infrastructure-kpi-truthfulness.test.tsx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
// The page reads the organization for its org- and UTC-day-keyed cost caches (DAY1-D10).
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ organization: { id: 'org-test', name: 'Org Test' }, user: { id: 'u' } }) }))
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import InfrastructurePage from '../page'
import { expectNoMoneyZero, NO_FIGURE_RECS, STATS_NONE_OPEN, STATS_OPEN_NO_FIGURE } from '@/lib/__tests__/support/no-money-zero'
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

const rec = (id: string, issue: string, potentialSavings: number, metadata: Record<string, unknown>) => ({
  id, resourceId: id, resourceName: id, resourceType: 'S3', issue, potentialSavings, severity: 'LOW', status: 'ACTIVE', awsRegion: 'us-east-1', metadata, createdAt: '', updatedAt: '',
})

const header = () => screen.getByText(/recommended changes ready/)

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

    // Only the estimate counts toward the header total; the ceiling stays on its own row. Ruling Q4: the header
    // counts all three changes and names how many are priced next to the total.
    await waitFor(() => expect(header()).toHaveTextContent('Ranked by impact · 3 recommended changes ready · $12/mo recoverable from 1 priced change'))
    // Ranked by the counted estimate, not the raw figure: the estimate is action 01.
    const ranked = ['Unattached EBS Volume', 'S3 Lifecycle Optimization', 'Reserved Instance Opportunity'].map((t) => screen.getByText(t, { selector: 'p' }))
    expect(ranked[0].compareDocumentPosition(ranked[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(ranked[1].compareDocumentPosition(ranked[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('C1b: a priced idle RDS action is a compact "save $X/mo" and counts toward Est. savings; no Cost Optimization explanation here', async () => {
    mockServicesStats.mockResolvedValue({ total: 1, healthy: 1, needs_attention: 0 })
    vi.mocked(costRecommendationsService.getAll).mockResolvedValue([
      { ...rec('placeholder-db-1', 'Idle RDS Instance', 52.56, { rule_version: 2, savings_basis: 'estimated: the us-east-1 on-demand list price for db.t3.medium PostgreSQL Single-AZ instance hours ($0.072/hour, 730 hours); storage, Provisioned IOPS, backups and snapshots are not included and are still billed while the instance is stopped; no reservation or discount applied; not billed cost', price_region: 'us-east-1', price_instance_class: 'db.t3.medium', price_engine_label: 'PostgreSQL', price_deployment: 'Single-AZ' }), resourceType: 'RDS', severity: 'MEDIUM' },
    ] as never)
    renderPage()
    const action = (await screen.findByText('Idle RDS Instance', { selector: 'p' })) as HTMLElement
    expect(action).toHaveTextContent('Idle RDS Instance — save $53/mo')
    await waitFor(() => expect(header()).toHaveTextContent('1 recommended changes ready · $53/mo recoverable from 1 priced change'))
    expect(document.body.textContent).not.toMatch(/Estimated from the|instance hours only|restarts a stopped database/)
  })

  it('PR 4 S2: a default-price action reads "(price unknown)" and still counts as an estimate; a genuine $50 list price does not', async () => {
    mockServicesStats.mockResolvedValue({ total: 2, healthy: 2, needs_attention: 0 })
    vi.mocked(costRecommendationsService.getAll).mockResolvedValue([
      { ...rec('i-default', 'Idle Instance (default)', 50, { savings_basis: 'estimated: list price', price_source: 'default_unlisted_type' }), resourceType: 'EC2' },
      { ...rec('i-listed', 'Idle Instance (listed)', 50, { savings_basis: 'estimated: list price', price_source: 'list_table' }), resourceType: 'EC2' },
    ] as never)
    renderPage()

    const action = async (title: string) => (await screen.findByText(title, { selector: 'p' })) as HTMLElement
    expect(await action('Idle Instance (default)')).toHaveTextContent('Idle Instance (default) — save $50/mo (price unknown)')
    expect(await action('Idle Instance (listed)')).toHaveTextContent(/^Idle Instance \(listed\) — save \$50\/mo$/)
    // Totals unchanged (decision D4): the default still counts as an estimate.
    await waitFor(() => expect(header()).toHaveTextContent('2 recommended changes ready · $100/mo recoverable from 2 priced changes'))
  })

  // ─── "Never show $0", ruling Q4 ──────────────────────────────────────────

  it('Q4: K priced of N total -- every change is counted, the total names only the priced ones', async () => {
    mockServicesStats.mockResolvedValue({ total: 3, healthy: 3, needs_attention: 0 })
    vi.mocked(costRecommendationsService.getAll).mockResolvedValue([
      rec('vol-1', 'Unattached EBS Volume', 12.4, { savings_basis: 'estimated: list price' }),
      { ...rec('fn-1', 'Low-Usage Lambda Function', 0, { savings_basis: 'estimated: lambda list price' }), resourceType: 'Lambda' },
      { ...rec('tbl-1', 'DynamoDB Capacity Mode Comparison', 0, { savings_basis: 'comparison: blocked by the gate' }), resourceType: 'DynamoDB' },
    ] as never)
    renderPage()
    await waitFor(() => expect(header()).toHaveTextContent(/^Ranked by impact · 3 recommended changes ready · \$12\/mo recoverable from 1 priced change$/))
    const action = async (title: string) => (await screen.findByText(title, { selector: 'p' })) as HTMLElement
    expect(await action('Low-Usage Lambda Function')).toHaveTextContent(/— no dollar estimate$/)
    expect(await action('DynamoDB Capacity Mode Comparison')).toHaveTextContent(/— no dollar estimate$/)
    expect(document.body.textContent).not.toMatch(/save \$0|up to \$0|\$0\/mo/)
  })

  it('Q4: no priced change -- the count stays and no amount is printed', async () => {
    mockServicesStats.mockResolvedValue({ total: 2, healthy: 2, needs_attention: 0 })
    vi.mocked(costRecommendationsService.getAll).mockResolvedValue([
      { ...rec('db-1', 'Idle RDS Instance', 0, {}), resourceType: 'RDS' },
      { ...rec('lg-1', 'Unused CloudWatch Log Group', 0, {}), resourceType: 'CloudWatch' },
    ] as never)
    renderPage()
    await waitFor(() => expect(header()).toHaveTextContent(/^Ranked by impact · 2 recommended changes ready$/))
    expect(header().textContent).not.toMatch(/\$|recoverable/)
  })

  it('a recorded sub-cent amount reads "less than $0.01/mo" and is never counted as priced or summed', async () => {
    mockServicesStats.mockResolvedValue({ total: 2, healthy: 2, needs_attention: 0 })
    vi.mocked(costRecommendationsService.getAll).mockResolvedValue([
      { ...rec('fn-1', 'Low-Usage Lambda Function', 0, { savings_basis: 'estimated: lambda list price', savings_unrounded_usd: 0.0012 }), resourceType: 'Lambda' },
      { ...rec('fn-2', 'Low-Usage Lambda Function (stored zero)', 0, { savings_basis: 'estimated: lambda list price' }), resourceType: 'Lambda' },
    ] as never)
    renderPage()
    const action = async (title: string) => (await screen.findByText(title, { selector: 'p' })) as HTMLElement
    expect(await action('Low-Usage Lambda Function')).toHaveTextContent(/— less than \$0\.01\/mo$/)
    expect(await action('Low-Usage Lambda Function (stored zero)')).toHaveTextContent(/— no dollar estimate$/)
    await waitFor(() => expect(header()).toHaveTextContent(/^Ranked by impact · 2 recommended changes ready$/))
  })

  it.each([
    ['open findings, none with a figure', () => vi.mocked(costRecommendationsService.getStats).mockResolvedValue(STATS_OPEN_NO_FIGURE as never), 'No dollar estimate', 'No dollar estimate yet for the open opportunities.'],
    ['nothing open after findings were recorded', () => vi.mocked(costRecommendationsService.getStats).mockResolvedValue(STATS_NONE_OPEN as never), 'None found', 'No open opportunities'],
    ['stats error', () => vi.mocked(costRecommendationsService.getStats).mockRejectedValue(new Error('500')), '—', ''],
  ])('Q4 Recoverable Savings, %s: %s in grey, no money zero', async (_name, setup, value, line) => {
    setup()
    mockServicesStats.mockResolvedValue({ total: 6, healthy: 6, needs_attention: 0 })
    vi.mocked(costRecommendationsService.getAll).mockResolvedValue(NO_FIGURE_RECS as never)
    renderPage()
    await waitFor(() => expect(screen.getByTestId('recoverable-savings-value')).toHaveTextContent(new RegExp(`^${value}$`)))
    const card = screen.getByTestId('recoverable-savings-value').parentElement as HTMLElement
    expect(screen.getByTestId('recoverable-savings-value').className).not.toMatch(/green/)
    if (line) expect(card).toHaveTextContent(line)
    expect(screen.queryByText(/Review opportunities/)).toBeNull()
    await waitFor(() => expect(header()).toHaveTextContent(/^Ranked by impact · 3 recommended changes ready$/))
    // Ruling Q4: "active waste" only with a figure.
    await screen.findByText('Real top action')
    expect(screen.queryByTestId('intel-active-waste')).toBeNull()
    expectNoMoneyZero(document.body.textContent)
  })

  it('Q4 active waste with a figure: "$X/mo active waste" from the /stats total', async () => {
    vi.mocked(costRecommendationsService.getStats).mockResolvedValue({ ...STATS_OPEN_NO_FIGURE, totalPotentialSavings: 0.08, estimatedFindings: 1 } as never)
    vi.mocked(costRecommendationsService.getAll).mockResolvedValue([] as never)
    mockServicesStats.mockResolvedValue({ total: 1, healthy: 1, needs_attention: 0 })
    renderPage()
    expect(await screen.findByTestId('intel-active-waste')).toHaveTextContent(/^\$0\.08\/mo active waste$/)
    expect(screen.getByTestId('recoverable-savings-value')).toHaveTextContent(/^\$0\.08$/)
  })
})
