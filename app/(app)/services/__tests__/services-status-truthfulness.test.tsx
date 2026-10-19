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
// The registered-services section has its own test (registered-services.test.tsx).
vi.mock('../RegisteredServices', () => ({ RegisteredServices: () => null }))
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ organization: { id: 'org-test', name: 'Org Test' } }) }))

const mockGetServices = vi.fn()
const mockGetStats = vi.fn()
const mockDiscover = vi.fn()
vi.mock('@/lib/services/aws-services.service', () => ({
  default: {
    getServices: (...args: unknown[]) => mockGetServices(...args),
    getStats: () => mockGetStats(),
    discoverServices: () => mockDiscover(),
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
// This page does not link to /dependencies either.
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

// Answers getServices the way GET /api/services does: needs_attention splits the
// rows, the page is cut from the split, and every count covers all of them.
function serveList(rows: any[]) {
  mockGetServices.mockImplementation(async (req: any = {}) => {
    const needs = rows.filter((r) => r.needs_attention)
    const selected = req.needs_attention === true ? needs : req.needs_attention === false ? rows.filter((r) => !r.needs_attention) : rows
    const page = req.page ?? 1
    const limit = req.limit ?? 50
    return {
      services: selected.slice((page - 1) * limit, page * limit),
      pagination: { page, limit, total: selected.length, total_pages: Math.ceil(selected.length / limit), has_more: page * limit < selected.length },
      counts: { needs_attention: needs.length, no_flagged_issues: rows.length - needs.length },
    }
  })
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
    serveList([resource('1')])
    mockGetStats.mockResolvedValue({ total: 1, healthy: 1, needs_attention: 0, avg_uptime: null, aws_accounts_connected: 1 })
    renderPage()
    await settled()

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Services$/)
    expect(screen.getByText('Until services are mapped, this page lists the AWS resources discovered in your connected account and any flagged issues.')).toBeInTheDocument()
    expect(screen.getByText('AWS resources')).toBeInTheDocument()
    expect(screen.getByText('1 AWS account connected; not every region is scanned')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Search 1 resource…')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Deployments/ })).toHaveAttribute('href', '/deployments')
    expect(screen.queryByText('Dependencies')).not.toBeInTheDocument()
    expectNoCutClaims()
  })
})

describe('/services -- the connected-account caption comes from the backend', () => {
  const card = () => screen.getByText('AWS resources').parentElement!

  it('says no account is connected when resources remain but the backend counts none', async () => {
    // Inventory left from an earlier connection: resources, no account.
    mockGetAccounts.mockResolvedValue([])
    serveList([resource('1'), resource('2')])
    mockGetStats.mockResolvedValue({ total: 2, healthy: 2, needs_attention: 0, avg_uptime: null, aws_accounts_connected: 0 })
    renderPage()
    await settled()

    expect(card()).toHaveTextContent('No AWS account connected')
    expect(card()).not.toHaveTextContent(/One connected account|1 AWS account connected|region/)
  })

  it('counts more than one account if the backend reports more', async () => {
    serveList([resource('1')])
    mockGetStats.mockResolvedValue({ total: 1, healthy: 1, needs_attention: 0, avg_uptime: null, aws_accounts_connected: 2 })
    renderPage()
    await settled()

    expect(card()).toHaveTextContent('2 AWS accounts connected; not every region is scanned')
  })

  it.each([
    ['a backend that does not report it', () => mockGetStats.mockResolvedValue({ total: 1, healthy: 1, needs_attention: 0, avg_uptime: null })],
    ['a failed stats request', () => mockGetStats.mockRejectedValue(new Error('500'))],
  ])('claims nothing about accounts for %s', async (_label, arrange) => {
    serveList([resource('1')])
    arrange()
    renderPage()
    await settled()

    expect(card()).not.toHaveTextContent(/account/i)
  })
})

describe('/services -- no AWS account connected', () => {
  it('says so plainly and offers only to connect', async () => {
    mockGetAccounts.mockResolvedValue([])
    serveList([])
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
    serveList([])
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
    serveList([resource('1'), resource('2')])
    mockGetStats.mockResolvedValue({ total: 2, healthy: 2, needs_attention: 0, avg_uptime: null })
    renderPage()
    await settled()

    expect((await screen.findAllByText('No resources flagged')).length).toBeGreaterThan(0)
    expect(screen.getByText('2 resources with no flagged issues')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(HEALTH_CLAIMS)
    expectNoCutClaims()
  })

  it('flagged resources are still surfaced with their count', async () => {
    serveList([resource('1'), resource('2', { needsAttention: true })])
    mockGetStats.mockResolvedValue({ total: 2, healthy: 1, needs_attention: 1, avg_uptime: null })
    renderPage()
    await settled()

    expect((await screen.findAllByText('1 of 2 at risk')).length).toBeGreaterThan(0)
    expect(screen.getByText('1 flagged for review')).toBeInTheDocument()
    // The status strip renders a mobile and a desktop layout; both say the same.
    expect(screen.getAllByText('Flagged for review')).toHaveLength(2)
    expect(screen.queryByText(/Require/)).not.toBeInTheDocument()
    expectNoCutClaims()
  })

  it('rows show the name as stored, "Untagged" for no environment, no cost and no link', async () => {
    serveList([
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

  it('styles the environment badge by meaning, whatever the case of the tag value', async () => {
    serveList([
      resource('1', { name: 'a', environment: 'production' }),
      resource('2', { name: 'b', environment: 'Production' }),
      resource('3', { name: 'c', environment: 'PRODUCTION' }),
      resource('4', { name: 'd', environment: 'Staging' }),
      resource('5', { name: 'e', environment: null }),
    ])
    mockGetStats.mockResolvedValue({ total: 5, healthy: 5, needs_attention: 0, avg_uptime: null })
    renderPage()
    await settled()
    fireEvent.click(await screen.findByRole('button', { name: /5 resources with no flagged issues/ }))

    const badge = (text: string) => screen.getAllByText(text).find((el) => el.tagName === 'SPAN')!
    for (const text of ['production', 'Production', 'PRODUCTION']) {
      expect(badge(text)).toHaveStyle({ color: '#059669', background: '#F0FDF4' })
    }
    expect(badge('Staging')).toHaveStyle({ color: '#D97706' })
    expect(badge('Untagged')).toHaveStyle({ color: '#64748B' })
  })

  it('needs-attention rows tied on severity sort by name, not cost', async () => {
    serveList([
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

describe('/services -- discovery refused by the plan limit', () => {
  it('names the AWS resource limit and links to the upgrade page, nothing more', async () => {
    serveList([resource('1')])
    mockGetStats.mockResolvedValue({ total: 1, healthy: 1, needs_attention: 0, avg_uptime: null })
    mockDiscover.mockRejectedValue(Object.assign(new Error('402'), { response: { status: 402 } }))
    renderPage()
    await settled()

    fireEvent.click(screen.getByRole('button', { name: /Auto Discover/ }))
    const link = await screen.findByRole('link', { name: 'Upgrade plan' })
    const banner = link.parentElement!
    expectNoCutClaims()
    expect(link).toHaveAttribute('href', '/settings/billing/upgrade')
    expect(banner.textContent).toBe("⚠️You've reached the AWS resource limit on the pro plan. Upgrade to discover more resources.Upgrade plan")
  })
})

describe('/services -- discovery warnings', () => {
  const PAUSED = 'Deletion detection is paused for some resource types: your inventory exceeds 1,000 indexed resources.'
  const discovered = (warnings: string[]) => ({ discovered: 0, updated: 1, errors: [], warnings, message: 'Discovery complete — 0 new, 1 updated' })

  it('shows the deletion-detection notice when the run reports a truncated index', async () => {
    mockGetServices.mockResolvedValue([resource('1')])
    mockGetStats.mockResolvedValue({ total: 1, healthy: 1, needs_attention: 0, avg_uptime: null })
    mockDiscover.mockResolvedValue(discovered(['deletion_detection_paused_truncated_index']))
    renderPage()
    await settled()

    fireEvent.click(screen.getByRole('button', { name: /Auto Discover/ }))

    expect(await screen.findByText(PAUSED)).toBeInTheDocument()
    expectNoCutClaims()
  })

  it('shows no notice when the run reports no warning', async () => {
    mockGetServices.mockResolvedValue([resource('1')])
    mockGetStats.mockResolvedValue({ total: 1, healthy: 1, needs_attention: 0, avg_uptime: null })
    mockDiscover.mockResolvedValue(discovered([]))
    renderPage()
    await settled()

    fireEvent.click(screen.getByRole('button', { name: /Auto Discover/ }))

    expect(await screen.findByText('Discovery complete — 0 new, 1 updated')).toBeInTheDocument()
    expect(screen.queryByText(PAUSED)).not.toBeInTheDocument()
  })
})

describe('/services -- filters', () => {
  it('the type filter offers EBS and asks the API for it', async () => {
    serveList([resource('1')])
    mockGetStats.mockResolvedValue({ total: 1, healthy: 1, needs_attention: 0, avg_uptime: null })
    renderPage()
    await settled()

    expect(await openSelect(0)).toContain('EBS')
    fireEvent.click(screen.getByRole('option', { name: 'EBS' }))
    await waitFor(() => expect(mockGetServices).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'ebs' })))
  })

  it('the environment filter offers Untagged and asks the API for it', async () => {
    serveList([resource('1')])
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
