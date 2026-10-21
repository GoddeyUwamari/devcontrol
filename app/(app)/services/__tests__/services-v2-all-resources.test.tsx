/**
 * The redesigned /services with NEXT_PUBLIC_SERVICES_V2=true, PR S1-D: All
 * resources replaces the current list (server-side filters and paging with
 * S1-A's params), the controls S1-C deferred open it, and "What we didn't
 * check" shows only the lines that apply. Nothing else from S1-C is removed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ServicesPage from '../page'
import { DELETION_DETECTION_PAUSED_TEXT, DISCOVERY_WARNING_TRUNCATED_INDEX } from '@/components/aws/discovery-warning-notice'
import { NOT_CHECKED_COPY } from '../notChecked'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/services',
}))
let demoMode = false
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => demoMode }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: (selector: any) => selector({ enabled: false }) }))
vi.mock('@/lib/hooks/use-plan', () => ({ usePlan: () => ({ tier: 'pro', isPro: true }) }))
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ organization: { id: 'org-test', name: 'Org Test' } }) }))
vi.mock('../RegisteredServices', () => ({ RegisteredServices: () => <p>OLD REGISTERED SERVICES</p> }))
vi.mock('@/lib/hooks/use-current-role', () => ({ useCurrentRole: () => 'owner' }))

const mockGetServices = vi.fn()
const mockGetStats = vi.fn()
const mockGetCoverage = vi.fn()
const mockDiscover = vi.fn()
vi.mock('@/lib/services/aws-services.service', () => ({
  default: {
    getServices: (...args: unknown[]) => mockGetServices(...args),
    getStats: () => mockGetStats(),
    getCoverage: () => mockGetCoverage(),
    discoverServices: () => mockDiscover(),
  },
}))
const mockGetAccounts = vi.fn()
vi.mock('@/lib/services/aws-accounts.service', () => ({ default: { getAccounts: () => mockGetAccounts() } }))
const mockGetCostSummary = vi.fn()
vi.mock('@/lib/services/platform-stats.service', () => ({ platformStatsService: { getCostSummary: () => mockGetCostSummary() } }))
let registeredEnabled: (boolean | undefined)[] = []
vi.mock('@/lib/hooks/use-registered-services', () => ({
  useRegisteredServices: (opts?: { enabled?: boolean }) => { registeredEnabled.push(opts?.enabled); return { isPending: false, isError: false, isSuccess: true, data: [], refetch: vi.fn() } },
}))

const NOW = Date.now()
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString()

function row(id: string, o: Record<string, any> = {}) {
  const needs = o.needs_attention ?? false
  return {
    id, name: `res-${id}`, type: 'ec2', environment: 'production', region: null, aws_region: 'us-east-1',
    status: 'healthy', uptime: null, owner: 'owner-a@example.com', team: 'platform', monthly_cost: null,
    last_deployed: minutesAgo(30), last_seen_at: minutesAgo(30), metadata: {},
    priority_severity: needs ? 'high' : null, needs_attention: needs, reason: needs ? 'Idle Instance' : null,
    ownership: 'owned', attention_cause: needs ? 'cost_recommendation' : null,
    ...o,
  }
}

const BASE_ROWS = [
  row('a1', { needs_attention: true, priority_severity: 'critical', reason: 'Resource in a failed or terminated state', attention_cause: 'status', status: 'critical' }),
  row('u1', { ownership: 'unowned', owner: null, team: null, environment: null }),
  row('t1', { owner: null, team: 'data', type: 's3', aws_region: 'us-west-2' }),
  row('k1', { ownership: 'unknown', owner: null, team: null, type: 'cloudfront', aws_region: 'global' }),
  row('o1'),
]
let ROWS: any[] = BASE_ROWS

// GET /api/services as the route answers it, over ROWS: filters, attention order, paging, counts.
function serve() {
  mockGetServices.mockImplementation(async (req: any = {}) => {
    const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
    let rows = ROWS.filter((r) =>
      (!req.type || r.type === req.type) && (!req.region || r.aws_region === req.region)
      && (!req.ownership || r.ownership === req.ownership)
      && (!req.team || (r.ownership !== 'unknown' && r.team?.toLowerCase() === req.team.toLowerCase()))
      && (!req.env || (req.env === 'untagged' ? r.environment === null && (!req.tags_known || r.ownership !== 'unknown') : r.environment === req.env))
      && (!req.search || r.name.includes(req.search)))
    const needs = rows.filter((r) => r.needs_attention)
    const counts = { needs_attention: needs.length, no_flagged_issues: rows.length - needs.length }
    if (req.needs_attention === true) rows = needs
    rows = rows.slice().sort((a, b) => ((a.needs_attention ? rank[a.priority_severity] : 4) - (b.needs_attention ? rank[b.priority_severity] : 4)) || a.name.localeCompare(b.name))
    const page = req.page ?? 1, limit = req.limit ?? 50
    return { services: rows.slice((page - 1) * limit, page * limit), pagination: { page, limit, total: rows.length, total_pages: Math.ceil(rows.length / limit), has_more: page * limit < rows.length }, counts }
  })
}

const STATS = {
  total: 5, healthy: 4, needs_attention: 1, avg_uptime: null, aws_accounts_connected: 1,
  attention_by_severity: { critical: 1, high: 0, medium: 0, low: 0 },
  ownership: { owned: 3, unowned: 1, unknown: 1 },
  unknown_by_type: { cloudfront: 1 },
  regions: [{ region: 'us-east-1', count: 3 }, { region: 'global', count: 1 }, { region: 'us-west-2', count: 1 }],
  teams: { top: [{ team: 'platform', count: 2 }, { team: 'data', count: 1 }], all: [{ team: 'platform', count: 2 }, { team: 'data', count: 1 }], total_teams: 2 },
  mapped_to_service: 0,
}

function coverage(o: Record<string, any> = {}) {
  return {
    account: { connected: true, status: 'active', home_region: 'us-east-1' },
    scope: {
      home_region: { region: 'us-east-1', count: 3 },
      s3: { in_last_scan: true, regions: [{ region: 'us-west-2', count: 1 }] },
      cloudfront: { in_last_scan: true, count: 1 },
      enabled_regions: { known: false, count: null },
    },
    last_successful_scan_at: minutesAgo(48),
    last_scan: { status: 'completed', started_at: minutesAgo(50), completed_at: minutesAgo(48), warnings: [] },
    resource_types: ['ec2', 's3', 'cloudfront'], tags_unknown_by_type: { cloudfront: 1 }, regions: STATS.regions, total: 5,
    ...o,
  }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><ServicesPage /></QueryClientProvider>)
}

const list = () => screen.getByRole('region', { name: 'All resources' })
const table = () => within(list()).getByRole('table')
const bodyRows = () => within(table()).getAllByRole('row').slice(1)
const notChecked = () => screen.getByRole('region', { name: "What we didn't check" })
/** The All resources requests (the attention table asks for 6 rows). */
const listCalls = () => mockGetServices.mock.calls.map(([req]) => req).filter((req: any) => req.limit !== 6)
const lastListCall = () => listCalls().at(-1)

async function settled() {
  await within(list()).findByRole('table')
  await waitFor(() => expect(screen.queryByText('Loading resources…')).not.toBeInTheDocument())
}

function choose(label: string, value: string) {
  fireEvent.change(within(list()).getByLabelText(label), { target: { value } })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_SERVICES_V2', 'true')
  demoMode = false
  ROWS = BASE_ROWS
  registeredEnabled = []
  serve()
  mockGetStats.mockResolvedValue(STATS)
  mockGetCoverage.mockResolvedValue(coverage())
  mockGetCostSummary.mockRejectedValue(new Error('n/a'))
  mockGetAccounts.mockResolvedValue([{ id: 'acct-1' }])
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}
})
afterEach(() => { vi.unstubAllEnvs() })

describe('flag on: All resources replaces the current list; nothing else is removed', () => {
  it('the old list is gone and every S1-C section is still there', async () => {
    renderPage()
    await settled()
    expect(screen.queryByPlaceholderText(/^Search \d+ resources?…$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Needs Attention · /)).not.toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/at-risk|at risk/)
    // The current list's two-section requests are never made.
    expect(mockGetServices.mock.calls.every(([req]: any[]) => req.limit === 6 || req.sort === 'attention')).toBe(true)
    for (const name of ['Account and scan coverage', 'Summary', 'What needs attention', 'Your services', '1 resource is unowned', 'All resources', "What we didn't check"]) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument()
    }
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Services & Ownership')
  })

  it('default request: attention order, page 1, 50 rows, nothing else', async () => {
    renderPage()
    await settled()
    expect(listCalls()).toEqual([{ sort: 'attention', page: 1, limit: 50 }])
  })
})

describe('table', () => {
  it('has the eight columns, ownership labels, "None flagged", Untagged and Last seen', async () => {
    renderPage()
    await settled()
    expect(within(table()).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Resource', 'Type', 'Region', 'Environment', 'Owner', 'Team', 'Issue', 'Last seen'])
    for (const th of within(table()).getAllByRole('columnheader')) expect(th).toHaveAttribute('scope', 'col')
    const rows = bodyRows()
    const byName = (n: string) => rows.find((r) => r.textContent!.includes(n))!
    expect(rows[0]).toHaveTextContent('res-a1') // attention order
    expect(byName('res-a1')).toHaveTextContent('Critical')
    expect(byName('res-a1')).toHaveTextContent('Resource in a failed or terminated state')
    expect(byName('res-o1')).toHaveTextContent('None flagged')
    expect(within(byName('res-u1')).getByText('Unowned')).toBeInTheDocument()
    expect(byName('res-u1')).toHaveTextContent('Untagged')
    // The team is in its own column, so the Owner cell says only "No Owner tag".
    const cells = (n: string) => within(byName(n)).getAllByRole('cell').map((c) => c.textContent)
    expect(cells('res-t1')[4]).toBe('No Owner tag')
    expect(cells('res-t1')[5]).toBe('data')
    expect(byName('res-t1')).not.toHaveTextContent('No Owner tag · data')
    // An owned row's Owner cell is the owner only; the team is in the Team column.
    expect(cells('res-o1')[4]).toBe('owner-a@example.com')
    expect(cells('res-o1')[5]).toBe('platform')
    expect(cells('res-a1')[4]).toBe('owner-a@example.com')
    // The attention table (no Team column) keeps "owner · team"; its "No Owner tag · {team}" is covered in services-v2-top-half.
    const attentionRow = within(screen.getByRole('region', { name: 'What needs attention' })).getAllByRole('row')[1]
    expect(within(attentionRow).getAllByRole('cell')[4]).toHaveTextContent(/^owner-a@example\.com · platform$/)
    expect(byName('res-k1')).toHaveTextContent('Unknown · tags unreadable')
    expect(byName('res-k1')).toHaveTextContent('global')
    expect(byName('res-o1')).toHaveTextContent('30 min ago')
  })

  it('one layout per cell: "View details" on its own line under the name; chip and issue text in one line box', async () => {
    renderPage()
    await settled()
    const first = bodyRows()[0]
    const [resource, , , , , , issue] = within(first).getAllByRole('cell')
    const button = within(resource).getByRole('button', { name: /View details/ })
    const name = within(resource).getByText('res-a1')
    // The name and the button are separate children of one column container.
    expect(button.parentElement).toBe(name.parentElement)
    expect(button.parentElement!.className).toMatch(/flex-col/)
    // The chip and the text share one paragraph (text flows after the chip).
    const paragraph = within(issue).getByText('Resource in a failed or terminated state', { exact: false })
    expect(paragraph.tagName).toBe('P')
    expect(within(paragraph).getByText('Critical')).toBeInTheDocument()
    for (const row of bodyRows().filter((r) => !r.textContent!.includes('None flagged'))) {
      expect(within(row).getAllByRole('cell')[6].querySelectorAll('p')).toHaveLength(1)
    }
  })

  it('the six filters sit in one even grid; the Production chip and Group by in the row below', async () => {
    renderPage()
    await settled()
    const grid = within(list()).getByTestId('all-resources-filters')
    expect(grid.className).toMatch(/grid-cols-1 .*sm:grid-cols-2 .*md:grid-cols-3 .*xl:grid-cols-6/)
    expect([...grid.children].map((c) => c.textContent!.split(/\n| /)[0])).toHaveLength(6)
    expect(within(grid).queryByRole('button', { name: 'Production' })).not.toBeInTheDocument()
    expect(within(list()).getByRole('button', { name: 'Production' })).toBeInTheDocument()
  })

  it('View details expands in place from list data, with no request', async () => {
    renderPage()
    await settled()
    const before = mockGetServices.mock.calls.length
    const button = within(list()).getByRole('button', { name: 'View details for res-k1' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).not.toHaveAttribute('aria-controls')
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    const details = document.getElementById(button.getAttribute('aria-controls')!)!
    expect(details).toHaveTextContent('Ownership')
    expect(details).toHaveTextContent('Unknown · tags unreadable')
    expect(mockGetServices.mock.calls.length).toBe(before)
    fireEvent.click(button)
    expect(document.getElementById(details.id)).toBeNull()
  })

  it('header counts and the "no flagged issues" line, "matching current filters" when narrowed', async () => {
    renderPage()
    await settled()
    expect(list()).toHaveTextContent('5 resources in us-east-1, plus S3 in every region and CloudFront')
    expect(list()).toHaveTextContent('· 4 resources with no flagged issues')
    expect(list()).not.toHaveTextContent('matching current filters')
    choose('Owner / team', 'platform')
    await waitFor(() => expect(list()).toHaveTextContent('2 resources matching current filters'))
    expect(list()).toHaveTextContent('· 1 resource with no flagged issues matching current filters')
    // Show = Needs attention alone is a filter too: never the inventory-scope wording, and no "no flagged issues" line.
    choose('Owner / team', '')
    choose('Show', 'needs_attention')
    await waitFor(() => expect(list()).toHaveTextContent('1 resource matching current filters'))
    expect(list()).not.toHaveTextContent('in us-east-1')
    expect(list()).not.toHaveTextContent(/with no flagged issues/)
    // A filter that narrows the counts keeps the line, with "matching current filters".
    choose('Show', 'unowned')
    await waitFor(() => expect(list()).toHaveTextContent('· 1 resource with no flagged issues matching current filters'))
    expect(list()).toHaveTextContent('1 resource matching current filters')
  })

  it('a row whose tags could not be read shows "—" for Environment, not "Untagged", in both tables', async () => {
    ROWS = [...BASE_ROWS, row('k2', { ownership: 'unknown', owner: null, team: null, environment: null, needs_attention: true, priority_severity: 'low', reason: 'Resource in a failed or terminated state', attention_cause: 'status', status: 'critical' })]
    renderPage()
    await settled()
    const k2 = bodyRows().find((r) => r.textContent!.includes('res-k2'))!
    expect(within(k2).getAllByRole('cell')[3]).toHaveTextContent(/^—$/)
    const u1 = bodyRows().find((r) => r.textContent!.includes('res-u1'))!
    expect(within(u1).getAllByRole('cell')[3]).toHaveTextContent(/^Untagged$/)
    const envValue = (scope: HTMLElement) => within(scope).getByText('Environment', { selector: 'dt' }).nextElementSibling
    fireEvent.click(within(list()).getByRole('button', { name: 'View details for res-k2' }))
    expect(envValue(list())).toHaveTextContent(/^—$/)
    const attention = screen.getByRole('region', { name: 'What needs attention' })
    fireEvent.click(await within(attention).findByRole('button', { name: /View details for res-k2/ }))
    expect(envValue(attention)).toHaveTextContent(/^—$/)
  })

  it('Group by: Resource active, Service disabled with the Phase 2 tag', async () => {
    renderPage()
    await settled()
    const group = within(list()).getByRole('group', { name: 'Group by' })
    expect(within(group).getByRole('button', { name: 'Resource' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(group).getByRole('button', { name: 'Service' })).toBeDisabled()
    expect(group).toHaveTextContent('Phase 2')
  })
})

describe('filters → exact query params', () => {
  it('Search (debounced) sends search + search_tags=true; placeholder "Name, ID or tag"', async () => {
    renderPage()
    await settled()
    const input = within(list()).getByLabelText('Search')
    expect(input).toHaveAttribute('placeholder', 'Name, ID or tag')
    expect(input).toHaveAttribute('maxLength', '200')
    fireEvent.change(input, { target: { value: 'res-o' } })
    await waitFor(() => expect(lastListCall()).toEqual({ sort: 'attention', page: 1, limit: 50, search: 'res-o', search_tags: true }))
    await waitFor(() => expect(bodyRows()).toHaveLength(1))
  })

  it.each([
    ['Type', 's3', { type: 's3' }],
    ['Region', 'global', { region: 'global' }],
    ['Environment', 'staging', { env: 'staging' }],
    ['Environment', 'untagged', { env: 'untagged', tags_known: true }],
    ['Owner / team', 'data', { team: 'data' }],
    ['Show', 'needs_attention', { needs_attention: true }],
    ['Show', 'unowned', { ownership: 'unowned' }],
    ['Show', 'unknown', { ownership: 'unknown' }],
  ])('%s = %s', async (label, value, params) => {
    renderPage()
    await settled()
    choose(label, value)
    await waitFor(() => expect(lastListCall()).toEqual({ sort: 'attention', page: 1, limit: 50, ...params }))
  })

  it('"Everyone" sends no team, never an empty one', async () => {
    renderPage()
    await settled()
    choose('Owner / team', 'data')
    await waitFor(() => expect(lastListCall()).toMatchObject({ team: 'data' }))
    choose('Owner / team', '')
    await waitFor(() => expect(lastListCall()).toEqual({ sort: 'attention', page: 1, limit: 50 }))
    expect(listCalls().every((req: any) => req.team !== '')).toBe(true)
    expect(within(list()).getByLabelText('Owner / team')).toHaveDisplayValue('Everyone')
  })

  it('the Production chip is a one-click Environment = production, shown in the select', async () => {
    renderPage()
    await settled()
    const chip = within(list()).getByRole('button', { name: 'Production' })
    expect(chip).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(chip)
    await waitFor(() => expect(lastListCall()).toEqual({ sort: 'attention', page: 1, limit: 50, env: 'production' }))
    expect(chip).toHaveAttribute('aria-pressed', 'true')
    expect(within(list()).getByLabelText('Environment')).toHaveValue('production')
    fireEvent.click(chip)
    await waitFor(() => expect(lastListCall()).toEqual({ sort: 'attention', page: 1, limit: 50 }))
    choose('Environment', 'production')
    await waitFor(() => expect(chip).toHaveAttribute('aria-pressed', 'true'))
  })

  it('Show options carry /stats counts; Region options say what each region holds', async () => {
    renderPage()
    await settled()
    const show = within(list()).getByLabelText('Show') as HTMLSelectElement
    await waitFor(() => expect([...show.options].map((o) => o.text)).toEqual(['All', 'Needs attention (1)', 'Unowned (1)', 'Owner unknown (1)']))
    const region = within(list()).getByLabelText('Region') as HTMLSelectElement
    expect([...region.options].map((o) => o.text)).toEqual(['All scanned regions', 'us-east-1, home (3)', 'global, CloudFront (1)', 'us-west-2 (1)'])
    const team = within(list()).getByLabelText('Owner / team') as HTMLSelectElement
    expect([...team.options].map((o) => o.text)).toEqual(['Everyone', 'platform (2)', 'data (1)'])
  })

  it('teams not listed: "1 more team not listed" (singular), disabled', async () => {
    mockGetStats.mockResolvedValue({ ...STATS, teams: { top: [{ team: 'platform', count: 2 }], all: [{ team: 'platform', count: 2 }], total_teams: 2 } })
    renderPage()
    await settled()
    const team = within(list()).getByLabelText('Owner / team') as HTMLSelectElement
    await waitFor(() => expect([...team.options].map((o) => o.text)).toEqual(['Everyone', 'platform (2)', '1 more team not listed']))
    expect(team.options[2].disabled).toBe(true)
  })

  it('Show counts read "—" when /stats failed, never 0', async () => {
    mockGetStats.mockRejectedValue(new Error('500'))
    renderPage()
    await settled()
    const show = within(list()).getByLabelText('Show') as HTMLSelectElement
    await waitFor(() => expect([...show.options].map((o) => o.text)).toEqual(['All', 'Needs attention (—)', 'Unowned (—)', 'Owner unknown (—)']))
  })

  it('every filter has a label', async () => {
    renderPage()
    await settled()
    for (const label of ['Search', 'Type', 'Region', 'Environment', 'Owner / team', 'Show']) {
      expect(within(list()).getByLabelText(label)).toBeInTheDocument()
    }
    // The table scrolls in its own focusable box.
    expect(within(list()).getByRole('region', { name: 'All resources table' })).toHaveAttribute('tabIndex', '0')
  })
})

describe('pagination', () => {
  beforeEach(() => { ROWS = Array.from({ length: 120 }, (_, i) => row(`p${String(i).padStart(3, '0')}`)) })

  it('"Showing X–Y of N", Previous/Next, "Page a of b"; a filter change goes back to page 1', async () => {
    mockGetStats.mockResolvedValue({ ...STATS, total: 120, healthy: 120, needs_attention: 0 })
    renderPage()
    await settled()
    const pager = within(list()).getByRole('navigation', { name: 'All resources pages' })
    expect(pager).toHaveTextContent('Showing 1–50 of 120')
    expect(pager).toHaveTextContent('Page 1 of 3')
    expect(within(pager).getByRole('button', { name: 'Previous' })).toBeDisabled()
    fireEvent.click(within(pager).getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(lastListCall()).toEqual({ sort: 'attention', page: 2, limit: 50 }))
    await waitFor(() => expect(within(list()).getByRole('navigation', { name: 'All resources pages' })).toHaveTextContent('Showing 51–100 of 120'))
    fireEvent.click(within(list()).getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(within(list()).getByRole('navigation', { name: 'All resources pages' })).toHaveTextContent('Page 3 of 3'))
    expect(within(list()).getByRole('button', { name: 'Next' })).toBeDisabled()
    choose('Type', 'ec2')
    await waitFor(() => expect(lastListCall()).toEqual({ sort: 'attention', page: 1, limit: 50, type: 'ec2' }))
  })

  it('a page past the end (the list shrank) drops to the last page with a single request', async () => {
    mockGetStats.mockResolvedValue({ ...STATS, total: 120, healthy: 120, needs_attention: 0 })
    mockDiscover.mockResolvedValue({ message: 'Done', warnings: [] })
    renderPage()
    await settled()
    const pager = () => within(list()).getByRole('navigation', { name: 'All resources pages' })
    fireEvent.click(within(pager()).getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(pager()).toHaveTextContent('Page 2 of 3'))
    fireEvent.click(within(pager()).getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(pager()).toHaveTextContent('Page 3 of 3'))
    // A discovery shrinks the inventory to 60: page 3 no longer exists.
    ROWS = ROWS.slice(0, 60)
    const before = listCalls().length
    fireEvent.click(screen.getAllByRole('button', { name: /Auto Discover/ })[0])
    await waitFor(() => expect(pager()).toHaveTextContent('Page 2 of 2'))
    expect(pager()).toHaveTextContent('Showing 51–60 of 60')
    expect(bodyRows()).toHaveLength(10)
    await new Promise((r) => setTimeout(r, 50))
    const after = listCalls().slice(before)
    // Page 3 refetched once (it said total_pages 2), then exactly one request for page 2; no loop.
    expect(after.filter((req: any) => req.page === 3)).toHaveLength(1)
    expect(after.filter((req: any) => req.page === 2)).toHaveLength(1)
    expect(after.filter((req: any) => req.page === 1)).toHaveLength(0)
  })
})

describe('the controls S1-C deferred', () => {
  it('Unowned tile "Show them" → Show = Unowned', async () => {
    renderPage()
    await settled()
    fireEvent.click(within(screen.getByRole('region', { name: 'Summary' })).getByRole('button', { name: 'Show them' }))
    await waitFor(() => expect(lastListCall()).toEqual({ sort: 'attention', page: 1, limit: 50, ownership: 'unowned' }))
    expect(within(list()).getByLabelText('Show')).toHaveValue('unowned')
  })

  it('Unowned card "Show the N" → Show = Unowned, clearing other filters', async () => {
    renderPage()
    await settled()
    choose('Type', 's3')
    await waitFor(() => expect(lastListCall()).toMatchObject({ type: 's3' }))
    fireEvent.click(within(screen.getByRole('region', { name: '1 resource is unowned' })).getByRole('button', { name: 'Show the 1' }))
    await waitFor(() => expect(lastListCall()).toEqual({ sort: 'attention', page: 1, limit: 50, ownership: 'unowned' }))
    expect(within(list()).getByLabelText('Type')).toHaveValue('all')
  })

  it('"all teams" opens the Owner / team filter (focus moves to it)', async () => {
    renderPage()
    await settled()
    fireEvent.click(within(screen.getByRole('region', { name: '1 resource is unowned' })).getByRole('button', { name: 'all teams' }))
    expect(within(list()).getByLabelText('Owner / team')).toHaveFocus()
  })

  it('"all teams" is hidden when there are no teams', async () => {
    mockGetStats.mockResolvedValue({ ...STATS, teams: { top: [], all: [], total_teams: 0 } })
    renderPage()
    await settled()
    const card = await screen.findByRole('region', { name: '1 resource is unowned' })
    expect(within(card).queryByRole('button', { name: 'all teams' })).not.toBeInTheDocument()
    expect(card).toHaveTextContent('Resources per team (Team tag)')
  })

  it('"View all N" → Show = Needs attention', async () => {
    renderPage()
    await settled()
    fireEvent.click(within(screen.getByRole('region', { name: 'What needs attention' })).getByRole('button', { name: 'View all 1 →' }))
    await waitFor(() => expect(lastListCall()).toEqual({ sort: 'attention', page: 1, limit: 50, needs_attention: true }))
    expect(within(list()).getByLabelText('Show')).toHaveValue('needs_attention')
  })
})

describe('empty and error states', () => {
  const none = { account: { connected: false, status: null, home_region: null }, scope: { home_region: null, s3: { in_last_scan: false, regions: [] }, cloudfront: { in_last_scan: false, count: 0 }, enabled_regions: { known: false, count: null } }, last_scan: null, last_successful_scan_at: null }
  const EMPTY = { ...STATS, total: 0, healthy: 0, needs_attention: 0, ownership: { owned: 0, unowned: 0, unknown: 0 }, unknown_by_type: {}, regions: [], teams: { top: [], all: [], total_teams: 0 } }

  it('no account and no resources: E28', async () => {
    ROWS = []
    mockGetCoverage.mockResolvedValue(coverage(none))
    mockGetStats.mockResolvedValue(EMPTY)
    renderPage()
    expect(await within(list()).findByText('No AWS account connected')).toBeInTheDocument()
    expect(within(list()).getByRole('link', { name: 'Connect AWS account' })).toHaveAttribute('href', '/connect-aws')
  })

  it('no account while coverage failed: E28 from the accounts check (coverage wins when it loads)', async () => {
    ROWS = []
    mockGetCoverage.mockRejectedValue(new Error('500'))
    mockGetAccounts.mockResolvedValue([])
    mockGetStats.mockResolvedValue(EMPTY)
    renderPage()
    expect(await within(list()).findByText('No AWS account connected')).toBeInTheDocument()
    expect(within(list()).queryByText('No resources discovered yet')).not.toBeInTheDocument()
  })

  it('coverage says connected: E29 even when the accounts check says none', async () => {
    ROWS = []
    mockGetCoverage.mockResolvedValue(coverage({ last_scan: null, last_successful_scan_at: null }))
    mockGetAccounts.mockResolvedValue([])
    mockGetStats.mockResolvedValue(EMPTY)
    renderPage()
    expect(await within(list()).findByText('No resources discovered yet')).toBeInTheDocument()
    expect(within(list()).queryByText('No AWS account connected')).not.toBeInTheDocument()
  })

  it.each([
    ['connected, nothing discovered', () => coverage({ last_scan: null, last_successful_scan_at: null }), 'No resources discovered yet', 'No AWS account connected'],
    ['no account', () => coverage(none), 'No AWS account connected', 'No resources discovered yet'],
  ])('/stats total 0 (%s): any filter shows the no-filter state, never "see all 0 resources"', async (_, cov, shown, notShown) => {
    ROWS = []
    mockGetCoverage.mockResolvedValue(cov())
    mockGetStats.mockResolvedValue(EMPTY)
    renderPage()
    expect(await within(list()).findByText(shown)).toBeInTheDocument()
    for (const [label, value] of [['Show', 'needs_attention'], ['Type', 's3'], ['Show', 'unowned']]) {
      choose(label, value)
      await waitFor(() => expect(lastListCall()).toMatchObject(label === 'Type' ? { type: value } : value === 'unowned' ? { ownership: 'unowned' } : { needs_attention: true }))
      expect(await within(list()).findByText(shown)).toBeInTheDocument()
      expect(within(list()).queryByText(notShown)).not.toBeInTheDocument()
      expect(list()).not.toHaveTextContent(/see all 0|Clear filter|match these filters|Nothing needs attention right now/)
    }
  })

  it('connected, nothing discovered: E29 with Auto Discover', async () => {
    ROWS = []
    mockGetCoverage.mockResolvedValue(coverage({ last_scan: null, last_successful_scan_at: null }))
    mockGetStats.mockResolvedValue(EMPTY)
    renderPage()
    expect(await within(list()).findByText('No resources discovered yet')).toBeInTheDocument()
    expect(within(list()).getByRole('button', { name: /Auto Discover/ })).toBeEnabled()
  })

  it('stored resources with no account: listed as they are', async () => {
    mockGetCoverage.mockResolvedValue(coverage(none))
    renderPage()
    await settled()
    expect(bodyRows()).toHaveLength(5)
    expect(screen.getByRole('region', { name: 'Account and scan coverage' })).toHaveTextContent('showing resources from a previous connection')
  })

  it.each([
    ['Show', 'unowned', 'Type', 's3', 'No unowned resources match these filters'],
    ['Region', 'us-west-2', 'Type', 'ec2', 'No EC2 resources found'],
    ['Owner / team', 'data', 'Region', 'global', 'No resources in global'],
  ])('filter miss (%s=%s, %s=%s): "%s" + Clear filter', async (l1, v1, l2, v2, title) => {
    renderPage()
    await settled()
    choose(l1, v1)
    choose(l2, v2)
    expect(await within(list()).findByText(title)).toBeInTheDocument()
    expect(list()).toHaveTextContent('Try a different resource type, or clear filters to see all 5 resources.')
    fireEvent.click(within(list()).getByRole('button', { name: 'Clear filter' }))
    await waitFor(() => expect(lastListCall()).toEqual({ sort: 'attention', page: 1, limit: 50 }))
  })

  it('Show = Needs attention with nothing flagged: the positive empty state', async () => {
    ROWS = BASE_ROWS.filter((r) => !r.needs_attention)
    mockGetStats.mockResolvedValue({ ...STATS, total: 4, healthy: 4, needs_attention: 0 })
    renderPage()
    await settled()
    choose('Show', 'needs_attention')
    expect(await within(list()).findByText('Nothing needs attention right now')).toBeInTheDocument()
    expect(list()).toHaveTextContent('None of the 4 resources have a flagged issue.')
    fireEvent.click(within(list()).getByRole('button', { name: 'Show all resources' }))
    await waitFor(() => expect(lastListCall()).toEqual({ sort: 'attention', page: 1, limit: 50 }))
  })

  it.each([
    ['failed', () => mockGetStats.mockRejectedValue(new Error('500'))],
    ['loading', () => mockGetStats.mockReturnValue(new Promise(() => {}))],
  ])('/stats %s: no count in the filter-miss text, and the positive empty state is not a filter miss', async (_, setStats) => {
    setStats()
    renderPage()
    await settled()
    choose('Type', 'rds')
    expect(await within(list()).findByText('No RDS resources found')).toBeInTheDocument()
    expect(list()).toHaveTextContent('Try a different resource type, or clear filters to see all resources.')
    expect(list()).not.toHaveTextContent(/see all \d/)
    fireEvent.click(within(list()).getByRole('button', { name: 'Clear filter' }))
    await settled()
    ROWS = BASE_ROWS.filter((r) => !r.needs_attention)
    choose('Show', 'needs_attention')
    expect(await within(list()).findByText('Nothing needs attention right now')).toBeInTheDocument()
    expect(list()).not.toHaveTextContent('None of the')
    expect(list()).not.toHaveTextContent('No resources that need attention match these filters')
    expect(within(list()).getByRole('button', { name: 'Show all resources' })).toBeInTheDocument()
  })

  it('a failed list: E27 with Try again, the E9 banner and "Resource data unavailable"', async () => {
    mockGetServices.mockImplementation(async (req: any) => { if (req.limit === 6) return { services: [], pagination: { page: 1, limit: 6, total: 0, total_pages: 0, has_more: false }, counts: { needs_attention: 0, no_flagged_issues: 0 } }; throw new Error('500') })
    renderPage()
    expect(await within(list()).findByText('The resource list could not be loaded')).toBeInTheDocument()
    expect(list()).toHaveTextContent('This is a loading error, not an empty result.')
    expect(screen.getByText('Failed to load resources.')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('region', { name: 'Account and scan coverage' })).toHaveTextContent('Resource status: Resource data unavailable'))
    serve()
    fireEvent.click(within(list()).getByRole('button', { name: /Try again/ }))
    await settled()
    expect(screen.queryByText('Failed to load resources.')).not.toBeInTheDocument()
  })

  it('a discovery error clears on the next filter change, as before', async () => {
    mockDiscover.mockRejectedValue(new Error('boom'))
    renderPage()
    await settled()
    fireEvent.click(screen.getAllByRole('button', { name: /Auto Discover/ })[0])
    expect(await screen.findByText('Failed to load resources.')).toBeInTheDocument()
    choose('Type', 's3')
    await waitFor(() => expect(screen.queryByText('Failed to load resources.')).not.toBeInTheDocument())
  })
})

describe("What we didn't check", () => {
  const lines = () => [...notChecked().querySelectorAll('li')].map((li) => li.getAttribute('data-line'))

  it('shows only the lines that apply, from coverage + stats', async () => {
    renderPage()
    await settled()
    await waitFor(() => expect(lines()).toEqual(['regions', 'iam', 'cloudfront-tags', 'tags-unknown', 'types']))
    expect(notChecked()).toHaveTextContent(NOT_CHECKED_COPY.otherRegionsExceptS3)
    expect(notChecked()).toHaveTextContent('We inventory these types: EC2, S3 and CloudFront. Other AWS resource types are not inventoried.')
    expect(notChecked()).toHaveTextContent("1 resource: tags couldn't be read, so its owner is unknown, not missing. It is not counted as Unowned. By type: CloudFront 1.")
    expect(notChecked()).not.toHaveTextContent(/\d+ (other )?(enabled )?regions/)
  })

  it('a warning and a failed last scan add their lines; the types are not claimed', async () => {
    mockGetCoverage.mockResolvedValue(coverage({ last_scan: { status: 'failed', started_at: minutesAgo(9), completed_at: minutesAgo(8), warnings: [DISCOVERY_WARNING_TRUNCATED_INDEX] } }))
    renderPage()
    await settled()
    await waitFor(() => expect(lines()).toEqual(['regions', 'iam', 'cloudfront-tags', 'tags-unknown', 'warning-deletion-paused', 'last-scan-failed']))
    expect(notChecked()).toHaveTextContent(DELETION_DETECTION_PAUSED_TEXT)
    expect(notChecked()).toHaveTextContent(NOT_CHECKED_COPY.lastScanFailed)
    expect(notChecked()).toHaveTextContent(NOT_CHECKED_COPY.otherRegions)
  })
})

describe('internal warning codes', () => {
  it('scan_lease_lost on the last scan: no Partial chip and no generic line, in the strip or "What we didn\'t check"', async () => {
    mockGetCoverage.mockResolvedValue(coverage({ last_scan: { status: 'completed', started_at: minutesAgo(50), completed_at: minutesAgo(48), warnings: ['scan_lease_lost'] } }))
    renderPage()
    await settled()
    const strip = screen.getByRole('region', { name: 'Account and scan coverage' })
    const chips = await within(strip).findByRole('list', { name: 'Scanned regions' })
    await waitFor(() => expect(chips).toHaveTextContent('home · complete'))
    expect(chips).not.toHaveTextContent(/partial/i)
    expect(strip).not.toHaveTextContent('cannot describe yet')
    expect(notChecked()).not.toHaveTextContent('cannot describe yet')
    expect([...notChecked().querySelectorAll('li')].map((li) => li.getAttribute('data-line'))).toEqual(['regions', 'iam', 'cloudfront-tags', 'tags-unknown', 'types'])
  })
})

describe('demo mode', () => {
  it('lists the fixture, filters it client-side, and makes no request', async () => {
    demoMode = true
    renderPage()
    await within(list()).findByRole('table')
    expect(list()).toHaveTextContent('12 resources in us-east-1, plus S3 in every region and CloudFront')
    choose('Show', 'unowned')
    await waitFor(() => expect(list()).toHaveTextContent('3 resources matching current filters'))
    expect(mockGetServices).not.toHaveBeenCalled()
    expect(mockGetStats).not.toHaveBeenCalled()
    expect(mockGetCoverage).not.toHaveBeenCalled()
    expect(registeredEnabled.every((e) => e === false)).toBe(true)
    expect(notChecked()).toBeInTheDocument()
  })
})
