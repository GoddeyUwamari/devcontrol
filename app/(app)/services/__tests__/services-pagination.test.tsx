/**
 * /services shows the server's pages and the server's counts.
 *
 *   - Each section's count is the server's total for the filtered set, not the
 *     number of rows on the page; a section with more than one page has a pager
 *     that asks the server for the next page.
 *   - "Needs attention" asks the server for only those resources; the other
 *     section is not requested.
 *   - /stats is organization-wide: a filter or search change does not refetch it.
 *   - A failed list request is shown as an error, never as an empty list.
 *   - Every query is keyed by organization: a response for the previous
 *     organization that arrives after the switch is never shown.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ServicesPage from '../page'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/services',
}))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => false }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: (selector: any) => selector({ enabled: false }) }))
vi.mock('@/lib/hooks/use-plan', () => ({ usePlan: () => ({ tier: 'pro', isPro: true }) }))

// The signed-in organization, read at render time, so a test can switch it.
let currentOrg = 'org-a'
vi.mock('@/lib/contexts/auth-context', () => ({
  useAuth: () => ({ organization: { id: currentOrg, name: currentOrg } }),
}))

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

function row(id: string, needsAttention: boolean, name = `svc-${id}`) {
  return {
    id, name, environment: 'production', region: 'us-east-1', type: 'ec2',
    status: needsAttention ? 'warning' : 'healthy', uptime: null, monthly_cost: null,
    needs_attention: needsAttention, priority_severity: needsAttention ? 'medium' : null,
    reason: needsAttention ? 'Resource is stopped or degraded' : null, last_deployed: null, metadata: {},
  }
}

/** A server page: `rows` are this page's; total and counts are for the whole set. */
function serverPage(rows: any[], page: number, total: number, counts: { needs_attention: number; no_flagged_issues: number }, limit = 50) {
  const totalPages = Math.ceil(total / limit)
  return { services: rows, pagination: { page, limit, total, total_pages: totalPages, has_more: page < totalPages }, counts }
}

const STATS = { total: 420, healthy: 300, needs_attention: 120, avg_uptime: null, aws_accounts_connected: 1 }
const COUNTS = { needs_attention: 120, no_flagged_issues: 300 }

// 120 resources need attention and 300 don't; the server pages them 50 at a time.
function serveLargeInventory() {
  mockGetServices.mockImplementation(async (req: any) => {
    const needs = req.needs_attention === true
    const total = needs ? COUNTS.needs_attention : COUNTS.no_flagged_issues
    const first = (req.page - 1) * 50
    const rows = Array.from({ length: Math.min(50, total - first) }, (_, i) => {
      const n = String(first + i + 1).padStart(3, '0')
      return row(`${needs ? 'n' : 'h'}${n}`, needs, `${needs ? 'risk' : 'ok'}-${n}`)
    })
    return serverPage(rows, req.page, total, COUNTS)
  })
}

function renderPage(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const ui = () => <QueryClientProvider client={client}><ServicesPage /></QueryClientProvider>
  const view = render(ui())
  return { ...view, rerenderPage: () => view.rerender(ui()) }
}

async function openSelect(index: number) {
  fireEvent.pointerDown(screen.getAllByRole('combobox')[index], { button: 0, ctrlKey: false, pointerType: 'mouse' })
  return (await screen.findAllByRole('option')).map((o) => o.textContent)
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

beforeEach(() => {
  vi.clearAllMocks()
  currentOrg = 'org-a'
  mockGetAccounts.mockResolvedValue([{ id: 'acct-1' }])
  mockGetStats.mockResolvedValue(STATS)
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {}
})

describe('/services -- section counts and pages come from the server', () => {
  it('"Needs Attention · N" is the server total, not the rows on the page', async () => {
    serveLargeInventory()
    renderPage()

    expect(await screen.findByText('Needs Attention · 120')).toBeInTheDocument()
    expect(screen.getAllByText(/^risk-\d{3}$/)).toHaveLength(50)
    expect(screen.getByText('300 resources with no flagged issues')).toBeInTheDocument()
    expect(mockGetServices).toHaveBeenCalledWith(expect.objectContaining({ needs_attention: true, page: 1, limit: 50 }))
    expect(mockGetServices).toHaveBeenCalledWith(expect.objectContaining({ needs_attention: false, page: 1, limit: 50 }))
  })

  it('the pager shows the server range and asks the server for the next page', async () => {
    serveLargeInventory()
    renderPage()

    const pager = await screen.findByRole('navigation', { name: 'Needs attention pages' })
    expect(within(pager).getByText('Showing 1–50 of 120')).toBeInTheDocument()
    expect(within(pager).getByText('Page 1 of 3')).toBeInTheDocument()
    expect(within(pager).getByRole('button', { name: 'Previous' })).toBeDisabled()

    fireEvent.click(within(pager).getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('risk-051')).toBeInTheDocument()
    expect(mockGetServices).toHaveBeenCalledWith(expect.objectContaining({ needs_attention: true, page: 2 }))
    expect(screen.queryByText('risk-001')).not.toBeInTheDocument()
    expect(screen.getByText('Showing 51–100 of 120')).toBeInTheDocument()
    // Still the server's total, on every page.
    expect(screen.getByText('Needs Attention · 120')).toBeInTheDocument()
  })

  it('the no-flagged-issues section pages too, once expanded', async () => {
    serveLargeInventory()
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: /300 resources with no flagged issues/ }))
    const pager = screen.getByRole('navigation', { name: 'No flagged issues pages' })
    expect(within(pager).getByText('Page 1 of 6')).toBeInTheDocument()
    fireEvent.click(within(pager).getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('ok-051')).toBeInTheDocument()
    expect(mockGetServices).toHaveBeenCalledWith(expect.objectContaining({ needs_attention: false, page: 2 }))
  })

  it('a filter change starts again at page 1', async () => {
    serveLargeInventory()
    renderPage()

    fireEvent.click(within(await screen.findByRole('navigation', { name: 'Needs attention pages' })).getByRole('button', { name: 'Next' }))
    await screen.findByText('risk-051')
    await openSelect(0)
    fireEvent.click(screen.getByRole('option', { name: 'EBS' }))

    await waitFor(() => expect(mockGetServices).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'ebs', page: 1 })))
    expect(mockGetServices).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ebs', page: 2 }))
    // Section counts follow the filters, and say so.
    expect(await screen.findAllByText(/matching current filters/)).not.toHaveLength(0)
  })

  it('"Needs attention" asks only for those resources', async () => {
    serveLargeInventory()
    renderPage()
    await screen.findByText('Needs Attention · 120')
    mockGetServices.mockClear()

    fireEvent.click(screen.getByRole('button', { name: /^Needs attention/ }))
    await waitFor(() => expect(screen.queryByText(/resources with no flagged issues/)).not.toBeInTheDocument())
    expect(mockGetServices.mock.calls.every(([req]) => req.needs_attention === true)).toBe(true)
    expect(screen.getByText('Needs Attention · 120')).toBeInTheDocument()
  })
})

describe('/services -- /stats is fetched once, not per filter', () => {
  it('changing the type filter or the search does not call /stats again', async () => {
    serveLargeInventory()
    renderPage()
    await screen.findByText('Needs Attention · 120')
    expect(mockGetStats).toHaveBeenCalledTimes(1)

    await openSelect(0)
    fireEvent.click(screen.getByRole('option', { name: 'EBS' }))
    await waitFor(() => expect(mockGetServices).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'ebs' })))
    fireEvent.change(screen.getByPlaceholderText(/^Search/), { target: { value: 'api' } })
    await waitFor(() => expect(mockGetServices).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'api' })), { timeout: 2000 })

    expect(mockGetStats).toHaveBeenCalledTimes(1)
    // The organization-wide numbers stay on screen.
    expect(screen.getAllByText('120 of 420 at risk').length).toBeGreaterThan(0)
  })
})

describe('/services -- a failed list is an error, not an empty list', () => {
  it('says the list could not be loaded, and shows no empty state', async () => {
    mockGetServices.mockRejectedValue(new Error('500'))
    renderPage()

    expect(await screen.findByText('The resource list could not be loaded')).toBeInTheDocument()
    expect(screen.getByText('Failed to load resources.')).toBeInTheDocument()
    expect(screen.queryByText(/No resources match|No resources discovered yet|Nothing needs attention|No AWS account connected/)).not.toBeInTheDocument()

    serveLargeInventory()
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }))
    expect(await screen.findByText('Needs Attention · 120')).toBeInTheDocument()
  })

  it('a failed /stats shows no number, not a zero', async () => {
    serveLargeInventory()
    mockGetStats.mockRejectedValue(new Error('500'))
    renderPage()
    await screen.findByText('Needs Attention · 120')

    const card = screen.getByText('AWS resources').parentElement!
    expect(card).toHaveTextContent('—')
    expect(card).not.toHaveTextContent(/\b0\b/)
  })
})

describe('/services -- the "Needs attention" chip count is organization-wide or absent', () => {
  const chip = () => screen.getByRole('button', { name: /^Needs attention/ })

  it('shows (—), not the filtered list count, when /stats failed and a filter is active', async () => {
    serveLargeInventory()
    mockGetStats.mockRejectedValue(new Error('500'))
    renderPage()
    await screen.findByText('Needs Attention · 120')

    await openSelect(0)
    fireEvent.click(screen.getByRole('option', { name: 'EBS' }))
    await waitFor(() => expect(mockGetServices).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'ebs' })))
    await screen.findAllByText(/matching current filters/)

    expect(chip()).toHaveTextContent(/^Needs attention \(—\)$/)
    expect(chip()).toHaveAttribute('title', 'The count across every resource in this organization is not available right now')
  })

  it('shows (—) while /stats is loading, then the organization-wide count', async () => {
    serveLargeInventory()
    const stats = deferred<any>()
    mockGetStats.mockReturnValue(stats.promise)
    renderPage()
    await screen.findByText('Needs Attention · 120')
    expect(chip()).toHaveTextContent(/^Needs attention \(—\)$/)

    await act(async () => { stats.resolve({ ...STATS, needs_attention: 7 }); await Promise.resolve() })
    await waitFor(() => expect(chip()).toHaveTextContent(/^Needs attention \(7\)$/))
    expect(chip()).toHaveAttribute('title', 'Count across every resource in this organization, before search and filters')
  })
})

describe('/services -- organization switch', () => {
  it('after organization A has loaded, switching to B shows none of A\'s rows while B\'s answer is held back', async () => {
    const heldB = deferred<any>()
    mockGetServices.mockImplementation(async (req: any) => {
      if (currentOrg === 'org-b') return heldB.promise
      return req.needs_attention
        ? serverPage([row('a1', true, 'org-a-at-risk')], 1, 1, { needs_attention: 1, no_flagged_issues: 1 })
        : serverPage([row('a2', false, 'org-a-fine')], 1, 1, { needs_attention: 1, no_flagged_issues: 1 })
    })

    const { rerenderPage } = renderPage()
    // Organization A fully loaded: its rows are on screen.
    expect(await screen.findByText('org-a-at-risk')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /1 resource with no flagged issues/ }))
    expect(screen.getByText('org-a-fine')).toBeInTheDocument()

    currentOrg = 'org-b'
    rerenderPage()
    await waitFor(() => expect(mockGetServices).toHaveBeenCalledWith(expect.objectContaining({ needs_attention: true })))

    // B's request is still open: the list is loading, and nothing of A's remains.
    expect(await screen.findByText('Loading resources…')).toBeInTheDocument()
    expect(screen.queryByText('org-a-at-risk')).not.toBeInTheDocument()
    expect(screen.queryByText('org-a-fine')).not.toBeInTheDocument()
    expect(screen.queryByText(/Needs Attention · /)).not.toBeInTheDocument()
  })


  it('a response for the previous organization that arrives after the switch is never shown', async () => {
    const lateList = deferred<any>()
    const lateStats = deferred<any>()
    // Like the backend, each request answers for the organization signed in when it is made.
    mockGetServices.mockImplementation(async (req: any) => {
      if (currentOrg === 'org-a') return lateList.promise
      return req.needs_attention
        ? serverPage([row('b1', true, 'org-b-at-risk')], 1, 1, { needs_attention: 1, no_flagged_issues: 0 })
        : serverPage([], 1, 0, { needs_attention: 1, no_flagged_issues: 0 })
    })
    mockGetStats.mockImplementation(async () => (currentOrg === 'org-a'
      ? lateStats.promise
      : { total: 1, healthy: 0, needs_attention: 1, avg_uptime: null, aws_accounts_connected: 1 }))

    const { rerenderPage } = renderPage()
    await waitFor(() => expect(mockGetServices).toHaveBeenCalled())

    currentOrg = 'org-b'
    rerenderPage()
    expect(await screen.findByText('org-b-at-risk')).toBeInTheDocument()

    // Organization A's requests answer only now.
    await act(async () => {
      lateList.resolve(serverPage([row('a1', true, 'org-a-at-risk')], 1, 777, { needs_attention: 777, no_flagged_issues: 0 }))
      lateStats.resolve({ total: 999, healthy: 222, needs_attention: 777, avg_uptime: null, aws_accounts_connected: 1 })
      await Promise.resolve()
    })

    expect(screen.queryByText('org-a-at-risk')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/777|999/)
    expect(screen.getByText('org-b-at-risk')).toBeInTheDocument()
    expect(screen.getByText('Needs Attention · 1')).toBeInTheDocument()
  })
})
