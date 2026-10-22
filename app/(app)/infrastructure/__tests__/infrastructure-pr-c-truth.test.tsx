/**
 * /infrastructure says only what its data supports:
 * - Top Actions carry no risk, urgency, or impact badge ("Zero Risk", "Review
 *   Impact", "Now", "Today", "Highest Impact", "Act Now"): nothing computes one,
 *   and the order is list position only.
 * - Nothing on this page changes AWS, so no control says "Apply" or "Fix": the
 *   buttons say "Review recommendations" / "Review →" and stay reachable.
 * - An EBS volume shows its own state ("available (unattached)" / "in-use"),
 *   never "running".
 * - Per-resource figures are list-price estimates: "Largest estimated costs (by
 *   resource)", no "Cost by Service", no "Last 30 days", no percentages, and no
 *   S3 placeholder.
 * - There is no Issue column and no $400 "Cost Waste" rule; the lifecycle state is
 *   in the State column.
 *
 * Same mocking harness as infrastructure-kpi-truthfulness.test.tsx. Rows render
 * "Added {date}", so the time zone is pinned (CI runs in UTC).
 */
process.env.TZ = 'UTC'

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import InfrastructurePage from '../page'
import { infrastructureService } from '@/lib/services/infrastructure.service'
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

// Demo mode is switched off in the product (useDemoMode returns false), so the
// demo branches are reached here by mocking the hook.
const demo = vi.hoisted(() => ({ on: false }))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => demo.on }))

function mockFetch(anomalies: unknown[] = []) {
  global.fetch = vi.fn().mockImplementation((url: string) => {
    if (url.includes('/api/anomalies')) {
      return Promise.resolve({ ok: true, json: async () => ({ anomalies }) } as Response)
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

function enableDemo() {
  demo.on = true
}

beforeEach(() => {
  demo.on = false
  localStorage.clear()
  localStorage.setItem('devcontrol_demo_mode', 'false')
  localStorage.setItem('accessToken', 'fake-token')
  mockServicesStats.mockResolvedValue({ total: 0, healthy: 0, needs_attention: 0 })
  vi.mocked(infrastructureService.getAll).mockResolvedValue([] as never)
  vi.mocked(costRecommendationsService.getAll).mockResolvedValue([] as never)
  mockFetch()
})

afterEach(() => {
  vi.restoreAllMocks()
})

const rec = (id: string, issue: string, potentialSavings: number, metadata: Record<string, unknown>) => ({
  id, resourceId: id, resourceName: id, resourceType: 'EBS', issue, potentialSavings, severity: 'LOW', status: 'ACTIVE', awsRegion: 'us-east-1', metadata, createdAt: '', updatedAt: '',
})

const THREE_RECS = [
  rec('vol-a', 'Unattached EBS Volume', 12.4, { savings_basis: 'estimated: list price' }),
  rec('bucket-a', 'S3 Lifecycle Optimization', 41.27, { savings_basis: 'ceiling: assumes 100% transitions' }),
  rec('ri-a', 'Reserved Instance Opportunity', 0, {}),
]

const CRITICAL_ANOMALY = { id: 'anomaly-1', severity: 'critical', title: 'Reliability issue on db', resourceName: 'db-1' }

const resource = (id: string, resourceType: string, status: string | null, costPerMonth: number | null) => ({
  id, serviceId: id, serviceName: `name-${id}`, resourceType, awsId: `aws-${id}`, awsRegion: 'us-east-1',
  status, costPerMonth, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
})

const bodyText = () => document.body.textContent ?? ''

/** The desktop table row's State cell (4th column) and the mobile card, read separately. */
const desktopRow = (id: string) => document.getElementById(`resource-${id}`)!.querySelector('[data-testid="resource-row-desktop"]')!
const desktopState = (id: string) => desktopRow(id).children[3].textContent
const mobileCard = (id: string) => document.getElementById(`resource-${id}`)!.querySelector('[data-testid="resource-card-mobile"]')!
const desktopRowCount = () => screen.queryAllByTestId('resource-row-desktop').length

// ── Item 1: no risk badge ────────────────────────────────────────────────────

describe('Top Actions -- no risk label', () => {
  it('T1.1 cost actions carry no "Zero Risk" (or "Review Impact") badge', async () => {
    vi.mocked(costRecommendationsService.getAll).mockResolvedValue(THREE_RECS as never)
    renderPage()
    await screen.findByText('Unattached EBS Volume', { selector: 'p' })
    expect(bodyText()).not.toMatch(/zero risk/i)
    expect(bodyText()).not.toMatch(/review impact/i)
  })

  it('T1.2 a reliability action carries no "Review Impact" badge', async () => {
    mockFetch([CRITICAL_ANOMALY])
    renderPage()
    await screen.findByText('Reliability issue on db', { selector: 'p' })
    expect(bodyText()).not.toMatch(/review impact/i)
  })

  it('T1.3 demo actions carry no risk badge either', async () => {
    enableDemo()
    renderPage()
    await screen.findByText('Downsize RDS cluster', { selector: 'p' })
    expect(bodyText()).not.toMatch(/zero risk|review impact/i)
  })
})

// ── Item 2: no positional urgency or impact ──────────────────────────────────

describe('Top Actions -- no urgency or impact badge', () => {
  const urgencyBadges = () => [
    screen.queryByText(/^now$/i),
    screen.queryByText(/^today$/i),
    screen.queryByText(/highest impact/i),
    screen.queryByText(/act now/i),
  ]

  it('T2.1 no "Now", "Today", "Highest Impact" or "Act Now" on real actions', async () => {
    vi.mocked(costRecommendationsService.getAll).mockResolvedValue(THREE_RECS as never)
    mockFetch([CRITICAL_ANOMALY])
    renderPage()
    await screen.findByText('Unattached EBS Volume', { selector: 'p' })
    await screen.findByText('Reliability issue on db', { selector: 'p' })
    expect(urgencyBadges()).toEqual([null, null, null, null])
  })

  it('T2.2 no "Act Now" with zero actions', async () => {
    renderPage()
    await screen.findByText('Top Actions')
    await waitFor(() => expect(costRecommendationsService.getAll).toHaveBeenCalled())
    expect(screen.queryByText(/act now/i)).toBeNull()
  })

  it('T2.3 no urgency or impact badge in demo mode', async () => {
    enableDemo()
    renderPage()
    await screen.findByText('Downsize RDS cluster', { selector: 'p' })
    expect(urgencyBadges()).toEqual([null, null, null, null])
  })
})

// ── Item 3: links are labelled as links ──────────────────────────────────────

describe('recommendations links -- "Review", never "Apply" or "Fix"', () => {
  it('T3.1 both header buttons say "Review recommendations" and open /cost-optimization; no "Applies N" caption', async () => {
    vi.mocked(costRecommendationsService.getAll).mockResolvedValue(THREE_RECS as never)
    renderPage()
    await screen.findByText('Unattached EBS Volume', { selector: 'p' })
    const links = screen.getAllByRole('link', { name: /review recommendations/i })
    expect(links).toHaveLength(2)
    for (const link of links) expect(link).toHaveAttribute('href', '/cost-optimization')
    expect(bodyText()).not.toMatch(/apply (recommended )?fixes/i)
    expect(bodyText()).not.toMatch(/applies \d+ recommended/i)
  })

  it('T3.2 the recommendations page stays reachable with zero recommendations', async () => {
    renderPage()
    await screen.findByText('Top Actions')
    expect(screen.getAllByRole('link', { name: /review recommendations/i })).toHaveLength(2)
  })

  it('T3.3 a cost action says "Review →" to /cost-optimization; a reliability action keeps /anomalies; no "Fix →"', async () => {
    vi.mocked(costRecommendationsService.getAll).mockResolvedValue([THREE_RECS[0]] as never)
    mockFetch([CRITICAL_ANOMALY])
    renderPage()
    await screen.findByText('Unattached EBS Volume', { selector: 'p' })
    await screen.findByText('Reliability issue on db', { selector: 'p' })
    // Reliability actions are listed first, then cost actions.
    const hrefs = screen.getAllByRole('link', { name: 'Review →' }).map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual(['/anomalies', '/cost-optimization'])
    expect(screen.queryByText('Fix →')).toBeNull()
  })
})

// ── Item 4: EBS state ────────────────────────────────────────────────────────

describe('resource table -- EBS volume state', () => {
  it('T4.4 an unattached volume shows "available (unattached)", an attached one "in-use"; neither "running"', async () => {
    vi.mocked(infrastructureService.getAll).mockResolvedValue([
      resource('vol-free', 'ebs', 'available', 8), resource('vol-used', 'ebs', 'in-use', 8),
    ] as never)
    mockServicesStats.mockResolvedValue({ total: 2, healthy: 2, needs_attention: 0 })
    renderPage()
    await waitFor(() => expect(document.getElementById('resource-vol-free')).not.toBeNull())
    // Desktop State column and mobile card, each on its own.
    expect(desktopState('vol-free')).toBe('available (unattached)')
    expect(desktopState('vol-used')).toBe('in-use')
    expect(mobileCard('vol-free').textContent).toContain('available (unattached)')
    expect(mobileCard('vol-used').textContent).toContain('in-use')
    for (const id of ['vol-free', 'vol-used']) expect(document.getElementById(`resource-${id}`)!.textContent).not.toContain('running')
    expect(bodyText()).not.toMatch(/Not running/)
  })
})

// ── Item 5: largest estimated costs ──────────────────────────────────────────

describe('largest estimated costs -- labelled as per-resource estimates', () => {
  const ROWS = [resource('vm', 'ec2', 'running', 120), resource('db', 'rds', 'running', 80), resource('bucket', 's3', null, null)]

  it('T5.4 is titled as estimates by resource, with no time window, sentence, percentages, or S3 placeholder', async () => {
    vi.mocked(infrastructureService.getAll).mockResolvedValue(ROWS as never)
    mockServicesStats.mockResolvedValue({ total: 3, healthy: 3, needs_attention: 0 })
    renderPage()
    const section = await screen.findByTestId('largest-estimated-costs')
    expect(section.textContent).toContain('Largest estimated costs (by resource)')
    expect(section.textContent).toContain('Est. monthly · list price')
    expect(section.textContent).toContain('name-vm')
    expect(section.textContent).not.toContain('name-bucket')
    expect(section.textContent).not.toContain('%')
    expect(bodyText()).not.toMatch(/Cost by Service/i)
    expect(bodyText()).not.toMatch(/Last 30 days/)
    expect(bodyText()).not.toMatch(/rightsizing candidate/)
    expect(bodyText()).not.toMatch(/recoverable waste/)
  })

  it('T5.5 the table column is "Est. monthly (list price)" and a not-estimated bucket shows "—"', async () => {
    vi.mocked(infrastructureService.getAll).mockResolvedValue(ROWS as never)
    mockServicesStats.mockResolvedValue({ total: 3, healthy: 3, needs_attention: 0 })
    renderPage()
    await waitFor(() => expect(document.getElementById('resource-bucket')).not.toBeNull())
    expect(screen.getByText('Est. monthly (list price)')).toBeInTheDocument()
    expect(screen.queryByText('Monthly Cost')).toBeNull()
    const notEstimated = document.getElementById('resource-bucket')!.querySelectorAll('[title="Not estimated"]')
    expect(notEstimated.length).toBeGreaterThan(0)
    for (const cell of Array.from(notEstimated)) expect(cell.textContent).toBe('—')
  })

  it('T5.6 the demo section has no percentages and no time window', async () => {
    enableDemo()
    renderPage()
    const section = await screen.findByTestId('largest-estimated-costs')
    expect(section.textContent).not.toContain('%')
    expect(section.textContent).not.toMatch(/Last 30 days/)
  })

  it('T5.9 the mobile card marks its figure as an estimate', async () => {
    vi.mocked(infrastructureService.getAll).mockResolvedValue(ROWS as never)
    mockServicesStats.mockResolvedValue({ total: 3, healthy: 3, needs_attention: 0 })
    renderPage()
    await waitFor(() => expect(document.getElementById('resource-vm')).not.toBeNull())
    expect(document.getElementById('resource-vm')!.textContent).toContain('est. $120.00')
  })
})

// ── Item 6 (light): no Issue column, no $400 rule ────────────────────────────

describe('resource table -- State column, no Issue column, no $400 rule', () => {
  const BUSY = [resource('busy', 'ec2', 'running', 900)]

  it('T6.1 a running instance over $400 shows "running", never "Cost Waste"', async () => {
    vi.mocked(infrastructureService.getAll).mockResolvedValue(BUSY as never)
    mockServicesStats.mockResolvedValue({ total: 1, healthy: 1, needs_attention: 0 })
    renderPage()
    await waitFor(() => expect(document.getElementById('resource-busy')).not.toBeNull())
    expect(desktopState('busy')).toBe('running')
    expect(mobileCard('busy').textContent).toContain('running')
    expect(bodyText()).not.toMatch(/Cost Waste/i)
    expect(bodyText()).not.toMatch(/downsize candidate/)
  })

  it('T6.2 the columns are Resource, Type, AWS ID, State, Region, Est. monthly -- no Issue, no Service', async () => {
    vi.mocked(infrastructureService.getAll).mockResolvedValue(BUSY as never)
    mockServicesStats.mockResolvedValue({ total: 1, healthy: 1, needs_attention: 0 })
    renderPage()
    await waitFor(() => expect(document.getElementById('resource-busy')).not.toBeNull())
    const headers = Array.from(screen.getByText('AWS ID').parentElement!.children).map((el) => el.textContent)
    expect(headers).toEqual(['Resource', 'Type', 'AWS ID', 'State', 'Region', 'Est. monthly (list price)'])
  })

  it('T6.3 the state filter has no "Cost Waste" option, and "Running" keeps a running instance over $400', async () => {
    vi.mocked(infrastructureService.getAll).mockResolvedValue(BUSY as never)
    mockServicesStats.mockResolvedValue({ total: 1, healthy: 1, needs_attention: 0 })
    renderPage()
    await waitFor(() => expect(document.getElementById('resource-busy')).not.toBeNull())
    const select = screen.getByDisplayValue('View by state ▾') as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.textContent)).not.toContain('Cost Waste')
    fireEvent.change(select, { target: { value: 'Healthy' } })
    expect(document.getElementById('resource-busy')).not.toBeNull()
  })
})

// ── Review fixes: the cards and the page's filters agree ─────────────────────

describe('Needs Attention / No Flagged Issues cards and the page filters agree, state by state', () => {
  // Card counts as the backend computes them for one resource with no finding or
  // cost recommendation (services.routes.ts mapStatus, pinned in
  // services.routes.resource-status.test.ts): EBS in-use / available healthy,
  // error critical, creating / deleting warning; EC2 stopped warning.
  const CASES: [string, string, number][] = [
    ['ebs', 'in-use', 0], ['ebs', 'available', 0], ['ebs', 'error', 1], ['ebs', 'creating', 1], ['ebs', 'deleting', 1],
    ['ec2', 'stopped', 1], ['ec2', 'running', 0],
  ]

  const healthyCount = () => Number(screen.getByText('No Flagged Issues').nextElementSibling!.textContent)
  const attentionCount = () => Number(screen.getByTestId('infrastructure-attention-count').textContent)

  it.each(CASES)('T7.1 %s %s: each card count equals the rows its click filter and the "Stopped or pending" filter show', async (type, status, needsAttention) => {
    vi.mocked(infrastructureService.getAll).mockResolvedValue([resource('res', type, status, 8)] as never)
    mockServicesStats.mockResolvedValue({ total: 1, healthy: 1 - needsAttention, needs_attention: needsAttention })
    renderPage()
    await waitFor(() => expect(document.getElementById('resource-res')).not.toBeNull())
    await waitFor(() => expect(attentionCount()).toBe(needsAttention))

    fireEvent.click(screen.getByTestId('infrastructure-attention-label'))
    expect(desktopRowCount()).toBe(attentionCount())

    fireEvent.click(screen.getByText('No Flagged Issues'))
    expect(desktopRowCount()).toBe(healthyCount())

    fireEvent.click(screen.getByText('No Flagged Issues'))
    fireEvent.change(screen.getByDisplayValue('View by state ▾'), { target: { value: 'Reliability Risk' } })
    expect(desktopRowCount()).toBe(attentionCount())
  })

  it('T7.2 Sort: Impact puts an errored volume first, as before; an unattached one is sorted by its estimate', async () => {
    vi.mocked(infrastructureService.getAll).mockResolvedValue([
      resource('big', 'ec2', 'running', 900), resource('broken', 'ebs', 'error', 8), resource('spare', 'ebs', 'available', 8),
    ] as never)
    mockServicesStats.mockResolvedValue({ total: 3, healthy: 2, needs_attention: 1 })
    renderPage()
    await waitFor(() => expect(desktopRowCount()).toBe(3))
    const order = screen.getAllByTestId('resource-row-desktop').map((row) => row.parentElement!.id)
    expect(order).toEqual(['resource-broken', 'resource-big', 'resource-spare'])
  })

  it('T7.3 an attached or unattached volume is never under "Stopped or pending" or the Needs Attention filter', async () => {
    vi.mocked(infrastructureService.getAll).mockResolvedValue([
      resource('spare', 'ebs', 'available', 8), resource('used', 'ebs', 'in-use', 8), resource('halted', 'ec2', 'stopped', 8),
    ] as never)
    mockServicesStats.mockResolvedValue({ total: 3, healthy: 2, needs_attention: 1 })
    renderPage()
    await waitFor(() => expect(desktopRowCount()).toBe(3))
    fireEvent.change(screen.getByDisplayValue('View by state ▾'), { target: { value: 'Reliability Risk' } })
    expect(screen.getAllByTestId('resource-row-desktop').map((row) => row.parentElement!.id)).toEqual(['resource-halted'])
    fireEvent.change(screen.getByDisplayValue('Stopped or pending'), { target: { value: 'all' } })
    fireEvent.click(screen.getByTestId('infrastructure-attention-label'))
    expect(screen.getAllByTestId('resource-row-desktop').map((row) => row.parentElement!.id)).toEqual(['resource-halted'])
  })

  it('T7.4 the demo bucket has no lifecycle state: "—", never "running"', async () => {
    enableDemo()
    renderPage()
    await waitFor(() => expect(document.getElementById('resource-r7')).not.toBeNull())
    expect(desktopState('r7')).toBe('—')
  })
})
