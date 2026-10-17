/**
 * /services must not call anything "healthy" that it has not measured, and
 * must not show claims it has no data for. Its counts come from
 * /api/services/stats, where "healthy" means "not stopped or failed and no
 * high-severity finding" -- DevControl has no uptime or performance
 * monitoring for services -- and zero resources or a failed request must
 * never read as all-healthy.
 *
 * Until services are mapped the page lists AWS resources, so it says
 * "resources". Removed for having no data behind them, in real and demo mode:
 * the "AI Insight" template, Business Impact, "Driven by" / average uptime,
 * the estimated Monthly Cost and row costs, the Status Page tile, "Full
 * report" and the /anomalies calls to action.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ServicesPage from '../page'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/services',
}))
let demoMode = false
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => demoMode }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: (selector: any) => selector({ enabled: false }) }))
vi.mock('@/lib/hooks/use-plan', () => ({ usePlan: () => ({ tier: 'pro', isPro: true }) }))

const mockGetServices = vi.fn()
const mockGetStats = vi.fn()
vi.mock('@/lib/services/aws-services.service', () => ({
  default: {
    getServices: (...args: unknown[]) => mockGetServices(...args),
    getStats: () => mockGetStats(),
    discoverServices: vi.fn(),
  },
}))

const mockGetAccounts = vi.fn()
vi.mock('@/lib/services/aws-accounts.service', () => ({
  default: { getAccounts: () => mockGetAccounts() },
}))

const HEALTH_CLAIMS = /all healthy|all systems healthy|system is healthy|services healthy|no impact detected|operating within thresholds|real[- ]?time/i

// Every claim removed from this page. If any of them comes back, these fail.
const CUT_CLAIMS = new RegExp([
  'Services Intelligence', 'AI Insight', 'Business Impact', 'Driven by', 'Average uptime',
  'Monthly Cost', 'Based on instance type pricing', 'not live billing data', 'Estimated',
  'Status Page', 'Live system status', 'Full report', 'Resolve now', 'Resolve before impact',
  'Resolve At-Risk', 'Registered across all environments', 'Add Manually',
  "What's Costing You Money", 'instantly',
  // Free-tier discovery never scans CloudFront, so the caption makes no claim about it.
  'plus S3 and CloudFront', 'S3 and CloudFront',
].join('|'), 'i')

// Links that went to pages with nothing about these resources, or to no page.
// /dependencies shows generated numbers in real mode, so this page does not link to it.
const CUT_LINKS = /^\/(anomalies|ai-reports|status|dependencies)\b|^\/services\/(?!new$)/

function resource(id: string, opts: { needsAttention?: boolean; environment?: string | null; type?: string; name?: string } = {}) {
  const needsAttention = opts.needsAttention ?? false
  return {
    id, name: opts.name ?? `svc-${id}`, environment: opts.environment === undefined ? 'production' : opts.environment,
    region: 'us-east-1', type: opts.type ?? 'ec2',
    status: needsAttention ? 'warning' : 'healthy', uptime: null, monthly_cost: 10,
    needs_attention: needsAttention, priority_severity: needsAttention ? 'medium' : null, reason: needsAttention ? 'Resource is stopped or degraded' : null,
    lastDeployed: null,
  }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><ServicesPage /></QueryClientProvider>)
}

async function settled() {
  await waitFor(() => expect(mockGetStats).toHaveBeenCalled())
  await waitFor(() => expect(screen.queryByText('Loading resources…')).not.toBeInTheDocument())
  await waitFor(() => expect(mockGetAccounts).toHaveBeenCalled())
}

function expectNoCutClaims() {
  expect(document.body.textContent).not.toMatch(CUT_CLAIMS)
  const hrefs = Array.from(document.querySelectorAll('a')).map((a) => a.getAttribute('href') ?? '')
  expect(hrefs.filter((h) => CUT_LINKS.test(h))).toEqual([])
}

async function openSelect(index: number) {
  fireEvent.pointerDown(screen.getAllByRole('combobox')[index], { button: 0, ctrlKey: false, pointerType: 'mouse' })
  return (await screen.findAllByRole('option')).map((o) => o.textContent)
}

beforeEach(() => {
  vi.clearAllMocks()
  demoMode = false
  mockGetAccounts.mockResolvedValue([{ id: 'acct-1' }])
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {}
})

describe('/services -- title and the resource count', () => {
  it('is titled Services and counts discovered AWS resources, not registered services', async () => {
    mockGetServices.mockResolvedValue([resource('1')])
    mockGetStats.mockResolvedValue({ total: 1, healthy: 1, needs_attention: 0, avg_uptime: null })
    renderPage()
    await settled()

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Services$/)
    expect(screen.getByText('Until services are mapped, this page lists the AWS resources discovered in your connected account and any flagged issues.')).toBeInTheDocument()
    expect(screen.getByText('AWS resources')).toBeInTheDocument()
    expect(screen.getByText('One connected account; not every region is scanned')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Search 1 resource…')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Deployments/ })).toHaveAttribute('href', '/deployments')
    expect(screen.queryByText('Dependencies')).not.toBeInTheDocument()
    expectNoCutClaims()
  })
})

describe('/services -- no AWS account connected', () => {
  it('says so plainly and offers only to connect', async () => {
    mockGetAccounts.mockResolvedValue([])
    mockGetServices.mockResolvedValue([])
    mockGetStats.mockResolvedValue({ total: 0, healthy: 0, needs_attention: 0, avg_uptime: null })
    renderPage()
    await settled()

    expect(await screen.findByText('No AWS account connected')).toBeInTheDocument()
    expect(screen.getByText('Connect an AWS account with read-only access. DevControl lists the resources it discovers here.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Connect AWS account' })).toHaveAttribute('href', '/connect-aws')
    expectNoCutClaims()
  })
})

describe('/services -- no resources discovered', () => {
  it('says so, and claims nothing about health', async () => {
    mockGetServices.mockResolvedValue([])
    mockGetStats.mockResolvedValue({ total: 0, healthy: 0, needs_attention: 0, avg_uptime: null })
    renderPage()
    await settled()

    expect((await screen.findAllByText('No resources discovered')).length).toBeGreaterThan(0)
    expect(await screen.findByText('No resources discovered yet')).toBeInTheDocument()
    expect(screen.getByText('Run Auto Discover to scan your connected account.')).toBeInTheDocument()
    expect(screen.queryByText(/clear filters/)).not.toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(HEALTH_CLAIMS)
    expectNoCutClaims()
  })
})

describe('/services -- failed request', () => {
  it('is unavailable, not all-healthy', async () => {
    mockGetServices.mockRejectedValue(new Error('500'))
    mockGetStats.mockRejectedValue(new Error('500'))
    renderPage()
    await settled()

    expect((await screen.findAllByText('Resource data unavailable')).length).toBeGreaterThan(0)
    expect(screen.getByText('Failed to load resources.')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(HEALTH_CLAIMS)
    expectNoCutClaims()
  })
})

describe('/services -- resources present', () => {
  it('none flagged reads as "no flagged issues", not healthy', async () => {
    mockGetServices.mockResolvedValue([resource('1'), resource('2')])
    mockGetStats.mockResolvedValue({ total: 2, healthy: 2, needs_attention: 0, avg_uptime: null })
    renderPage()
    await settled()

    expect((await screen.findAllByText('No resources flagged')).length).toBeGreaterThan(0)
    expect(screen.getByText('2 resources with no flagged issues')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(HEALTH_CLAIMS)
    expectNoCutClaims()
  })

  it('flagged resources are still surfaced with their count', async () => {
    mockGetServices.mockResolvedValue([resource('1'), resource('2', { needsAttention: true })])
    mockGetStats.mockResolvedValue({ total: 2, healthy: 1, needs_attention: 1, avg_uptime: null })
    renderPage()
    await settled()

    expect((await screen.findAllByText('1 of 2 at risk')).length).toBeGreaterThan(0)
    expect(screen.getByText('1 flagged for review')).toBeInTheDocument()
    expectNoCutClaims()
  })

  it('rows show the name as stored, "Untagged" for no environment, no cost and no link', async () => {
    mockGetServices.mockResolvedValue([
      resource('1', { name: 'i-1234567890abcdef0', environment: null }),
      resource('2', { name: 'checkout-api-prod', environment: 'Production' }),
      resource('3', { name: 'data-volume', environment: null, type: 'ebs', needsAttention: true }),
    ])
    mockGetStats.mockResolvedValue({ total: 3, healthy: 2, needs_attention: 1, avg_uptime: null })
    renderPage()
    await settled()
    fireEvent.click(await screen.findByRole('button', { name: /2 resources with no flagged issues/ }))

    expect(screen.getByText('i-1234567890abcdef0')).toBeInTheDocument()
    expect(screen.getByText('checkout-api-prod')).toBeInTheDocument()
    expect(screen.getByText('data-volume')).toBeInTheDocument()
    expect(screen.getAllByText('Untagged')).toHaveLength(2)
    expect(screen.getAllByText('Production').some((el) => el.tagName === 'SPAN')).toBe(true)
    expect(screen.getByText('EBS')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/\$\d/)
    expect(screen.queryByRole('link', { name: /View/ })).not.toBeInTheDocument()
    expectNoCutClaims()
  })

  it('needs-attention rows tied on severity sort by name, not cost', async () => {
    mockGetServices.mockResolvedValue([
      { ...resource('1', { name: 'zeta', needsAttention: true }), monthly_cost: 900 },
      { ...resource('2', { name: 'alpha', needsAttention: true }), monthly_cost: 1 },
    ])
    mockGetStats.mockResolvedValue({ total: 2, healthy: 0, needs_attention: 2, avg_uptime: null })
    renderPage()
    await settled()

    const alpha = await screen.findByText('alpha')
    const zeta = screen.getByText('zeta')
    expect(alpha.compareDocumentPosition(zeta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('/services -- filters', () => {
  it('the type filter offers EBS and asks the API for it', async () => {
    mockGetServices.mockResolvedValue([resource('1')])
    mockGetStats.mockResolvedValue({ total: 1, healthy: 1, needs_attention: 0, avg_uptime: null })
    renderPage()
    await settled()

    expect(await openSelect(0)).toContain('EBS')
    fireEvent.click(screen.getByRole('option', { name: 'EBS' }))
    await waitFor(() => expect(mockGetServices).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'ebs' })))
  })

  it('the environment filter offers Untagged and asks the API for it', async () => {
    mockGetServices.mockResolvedValue([resource('1')])
    mockGetStats.mockResolvedValue({ total: 1, healthy: 1, needs_attention: 0, avg_uptime: null })
    renderPage()
    await settled()

    expect(await openSelect(1)).toEqual(['All environments', 'Production', 'Staging', 'Untagged'])
    fireEvent.click(screen.getByRole('option', { name: 'Untagged' }))
    await waitFor(() => expect(mockGetServices).toHaveBeenLastCalledWith(expect.objectContaining({ env: 'untagged' })))
  })
})

describe('/services -- demo mode', () => {
  it('the removed claims are gone in demo mode too', async () => {
    demoMode = true
    renderPage()
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(/^Services$/)
    expectNoCutClaims()
  })
})
