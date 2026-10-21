/**
 * The redesigned top half of /services (Phase 1, PR S1-C), rendered with
 * NEXT_PUBLIC_SERVICES_V2=true: header, coverage strip, five tiles, What needs
 * attention, Your services and the Unowned card, from the real APIs only, in
 * every state (loading, error, empty, demo, role variants).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ServicesPage from '../page'
import { DELETION_DETECTION_PAUSED_TEXT, DISCOVERY_WARNING_TRUNCATED_INDEX } from '@/components/aws/discovery-warning-notice'

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
// The current page's registered-services section must not render in the redesign.
vi.mock('../RegisteredServices', () => ({ RegisteredServices: () => <p>OLD REGISTERED SERVICES</p> }))

let role: string | null = 'owner'
vi.mock('@/lib/hooks/use-current-role', () => ({ useCurrentRole: () => role }))

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

// useRegisteredServices is replaced so the test sees whether it may fetch.
const registeredCalls: ({ enabled?: boolean } | undefined)[] = []
let registered: { isPending: boolean; isError: boolean; isSuccess: boolean; data?: any[]; refetch: () => void } = ready([])
function ready(data: any[]) { return { isPending: false, isError: false, isSuccess: true, data, refetch: vi.fn() } }
vi.mock('@/lib/hooks/use-registered-services', () => ({
  useRegisteredServices: (opts?: { enabled?: boolean }) => { registeredCalls.push(opts); return registered },
}))

const NOW = Date.now()
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString()

function row(id: string, o: Partial<Record<string, any>> = {}) {
  const needs = o.needs_attention ?? false
  return {
    id, name: `res-${id}`, type: 'ec2', environment: 'production', region: null, aws_region: 'eu-central-1',
    status: 'healthy', uptime: null, owner: 'owner-a@example.com', team: 'platform', monthly_cost: null,
    last_deployed: minutesAgo(30), last_seen_at: minutesAgo(30), metadata: {},
    priority_severity: needs ? 'high' : null, needs_attention: needs, reason: needs ? 'Idle Instance' : null,
    ownership: 'owned', attention_cause: needs ? 'cost_recommendation' : null,
    ...o,
  }
}

const ATTENTION_ROWS = [
  row('a1', { needs_attention: true, priority_severity: 'critical', reason: 'Security group "example-sg" (sg-0) allows SSH (port 22) from anywhere (0.0.0.0/0)', attention_cause: 'finding', ownership: 'unowned', owner: null, team: null }),
  row('a2', { needs_attention: true, priority_severity: 'high', reason: 'Idle Instance', attention_cause: 'cost_recommendation', owner: null, team: 'data' }),
  row('a3', { needs_attention: true, priority_severity: 'medium', reason: 'Resource is stopped or degraded', attention_cause: 'status', status: 'warning', ownership: 'unknown', owner: null, team: null, type: 's3' }),
]
const OTHER_ROWS = Array.from({ length: 7 }, (_, i) => row(`h${i}`))

function page(rows: any[], total = rows.length, limit = 6) {
  return { services: rows, pagination: { page: 1, limit, total, total_pages: Math.ceil(total / limit), has_more: total > limit }, counts: { needs_attention: total, no_flagged_issues: 0 } }
}

// The attention table asks for 6 rows; the current list below asks for 50.
function serve(attention = ATTENTION_ROWS, rest = OTHER_ROWS) {
  mockGetServices.mockImplementation(async (req: any = {}) => {
    if (req.limit === 6) return page(attention.slice(0, 6), attention.length)
    const selected = req.needs_attention === true ? attention : rest
    return { ...page(selected, selected.length, 50), counts: { needs_attention: attention.length, no_flagged_issues: rest.length } }
  })
}

const STATS = {
  total: 10, healthy: 7, needs_attention: 3, avg_uptime: null, aws_accounts_connected: 1,
  attention_by_severity: { critical: 1, high: 1, medium: 1, low: 0 },
  ownership: { owned: 6, unowned: 2, unknown: 2 },
  unknown_by_type: { s3: 1, cloudfront: 1 },
  regions: [{ region: 'eu-central-1', count: 8 }, { region: 'us-west-2', count: 1 }, { region: 'global', count: 1 }],
  teams: { top: [{ team: 'platform', count: 5 }, { team: 'data', count: 2 }, { team: 'payments', count: 1 }], all: [], total_teams: 3 },
  mapped_to_service: 0,
}

function coverage(o: Record<string, any> = {}) {
  return {
    account: { connected: true, status: 'active', home_region: 'eu-central-1' },
    scope: {
      home_region: { region: 'eu-central-1', count: 8 },
      s3: { in_last_scan: true, regions: [{ region: 'eu-central-1', count: 2 }, { region: 'us-west-2', count: 1 }] },
      cloudfront: { in_last_scan: true, count: 1 },
      enabled_regions: { known: false, count: null },
    },
    last_successful_scan_at: minutesAgo(48),
    last_scan: { status: 'completed', started_at: minutesAgo(50), completed_at: minutesAgo(48), warnings: [] },
    resource_types: ['ec2', 's3', 'cloudfront'], tags_unknown_by_type: {}, regions: STATS.regions, total: 10,
    ...o,
  }
}

function billed(o: Record<string, any> = {}, section: Record<string, any> = {}) {
  return {
    spend: { state: 'available', source: 'cost_explorer', provenance: 'actual', asOf: null, coverage: null, reason: null,
      data: { amount: 4321.5, basis: 'billed_month_to_date', lastDayInProgress: true, finishedThrough: '2026-10-18', ...o }, ...section },
    monthOverMonth: { state: 'unavailable', source: 'x', provenance: null, asOf: null, coverage: null, reason: null, data: null },
  }
}

const REGISTERED = [
  { id: 's1', name: 'checkout-api', owner: 'owner-y@example.com', teamId: 't', teamName: 'payments', githubUrl: 'https://github.com/example-org/checkout-api', createdAt: '2026-09-01T00:00:00Z' },
  { id: 's2', name: 'events', owner: 'owner-d@example.com', teamId: null, teamName: null, githubUrl: null, createdAt: '2026-09-02T00:00:00Z' },
]

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><ServicesPage /></QueryClientProvider>)
}

const strip = () => screen.getByRole('region', { name: 'Account and scan coverage' })
// Each chip as "region | note".
const chipTexts = () => within(strip()).getAllByRole('listitem').map((li) => [...li.querySelectorAll('span')].slice(1).map((s) => s.textContent).join(' | '))
const tiles = () => screen.getByRole('region', { name: 'Summary' })
const tile = (label: string) => within(tiles()).getByRole('heading', { name: label }).parentElement!
const attention = () => screen.getByRole('region', { name: 'What needs attention' })
const yourServices = () => screen.getByRole('region', { name: 'Your services' })

async function settled() {
  await screen.findByText(/^eu-central-1 scanned/)
  await waitFor(() => expect(within(tile('Needs attention')).getByText('3')).toBeInTheDocument())
  await within(attention()).findByRole('table')
  await waitFor(() => expect(screen.queryByText('Loading resources…')).not.toBeInTheDocument())
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_SERVICES_V2', 'true')
  demoMode = false
  role = 'owner'
  registered = ready(REGISTERED)
  registeredCalls.length = 0
  serve()
  mockGetStats.mockResolvedValue(STATS)
  mockGetCoverage.mockResolvedValue(coverage())
  mockGetCostSummary.mockResolvedValue(billed())
  mockGetAccounts.mockResolvedValue([{ id: 'acct-1' }])
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}
})
afterEach(() => { vi.unstubAllEnvs() })

describe('header', () => {
  it('has the new subtitle, a plain Deployments link, Auto Discover and + Add Service', async () => {
    renderPage()
    await settled()
    // The heading is "Services & Ownership"; the navigation label is not this page's.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Services & Ownership$/)
    expect(screen.getByText("What we found, what needs attention, who owns it, and what we haven't verified yet.")).toBeInTheDocument()
    expect(screen.queryByText(/Until services are mapped/)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Deployments' })).toHaveAttribute('href', '/deployments')
    expect(screen.queryByText('Deployment history and tracking')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Auto Discover/ })).toBeEnabled()
    expect(screen.queryByText('OLD REGISTERED SERVICES')).not.toBeInTheDocument()
    // S1-D: All resources replaces the current resource list.
    expect(screen.queryByPlaceholderText(/^Search \d+ resources?…$/)).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'All resources' })).toBeInTheDocument()
  })

  it('Auto Discover keeps its states and refreshes coverage and the attention table', async () => {
    let finish!: (v: unknown) => void
    mockDiscover.mockReturnValue(new Promise((r) => { finish = r }))
    renderPage()
    await settled()
    const coverageCalls = mockGetCoverage.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: /Auto Discover/ }))
    expect(await screen.findByRole('button', { name: /Scanning\.\.\./ })).toBeDisabled()
    finish({ message: 'Discovery complete — 1 new, 2 updated', warnings: [DISCOVERY_WARNING_TRUNCATED_INDEX], discovered: 1, updated: 2, errors: [] })
    expect(await screen.findByRole('button', { name: /Discovery complete — 1 new, 2 updated/ })).toBeInTheDocument()
    // The in-tab warning shows at once, in the strip.
    expect(within(strip()).getByText(DELETION_DETECTION_PAUSED_TEXT)).toBeInTheDocument()
    await waitFor(() => expect(mockGetCoverage.mock.calls.length).toBeGreaterThan(coverageCalls))
  })
})

describe('+ Add Service role rule (Q10)', () => {
  const addButtons = () => screen.getAllByRole('button', { name: /Add Service/ })

  it.each(['owner', 'admin'])('%s gets links to /services/new', async (r) => {
    role = r
    renderPage()
    await settled()
    const links = screen.getAllByRole('link', { name: /Add Service/ })
    expect(links).toHaveLength(2) // header + Your services
    for (const link of links) expect(link).toHaveAttribute('href', '/services/new')
    expect(screen.queryByText('Only admins can add services')).not.toBeInTheDocument()
  })

  it.each(['member', 'viewer'])('%s sees it disabled with "Only admins can add services"', async (r) => {
    role = r
    renderPage()
    await settled()
    expect(screen.queryByRole('link', { name: /Add Service/ })).not.toBeInTheDocument()
    for (const button of addButtons()) {
      expect(button).toBeDisabled()
      expect(button).toHaveAccessibleDescription('Only admins can add services')
    }
    expect(screen.getAllByText('Only admins can add services')).toHaveLength(2)
  })

  it('is disabled with no message while the role is unknown', async () => {
    role = null
    renderPage()
    await settled()
    expect(screen.queryByRole('link', { name: /Add Service/ })).not.toBeInTheDocument()
    for (const button of addButtons()) expect(button).toBeDisabled()
    expect(screen.queryByText('Only admins can add services')).not.toBeInTheDocument()
  })

  it.each([
    ['owner', 'link'], ['member', 'message'], [null, 'none'],
  ] as const)('the empty-state button follows the same rule (role %s)', async (r, expected) => {
    role = r
    registered = ready([])
    renderPage()
    await settled()
    const card = yourServices()
    expect(within(card).getByText('No services registered yet.')).toBeInTheDocument()
    if (expected === 'link') {
      expect(within(card).getByRole('link', { name: /Add Service/ })).toHaveAttribute('href', '/services/new')
    } else {
      expect(within(card).getByRole('button', { name: /Add Service/ })).toBeDisabled()
      expect(within(card).queryAllByText('Only admins can add services')).toHaveLength(expected === 'message' ? 1 : 0)
    }
  })
})

describe('coverage strip (M6)', () => {
  it('says what was scanned from the data, with the status line and no region count, IAM or coverage link', async () => {
    renderPage()
    await settled()
    const s = strip()
    expect(s).toHaveTextContent('AWS account connected')
    expect(s).toHaveTextContent('eu-central-1 scanned, plus S3 buckets in every region and CloudFront (global) · other regions not scanned yet')
    expect(s).toHaveTextContent(/Last successful scan .*\(48 min ago\)/)
    expect(s).toHaveTextContent('Resource status: 3 of 10 need attention')
    expect(document.body.textContent).not.toMatch(/of 10 at risk/)
    expect(s).not.toHaveTextContent(/IAM|Region coverage|\d+ (other )?(enabled )?regions|this account's scan|Limited/)
    expect(within(s).getByRole('list', { name: 'Scanned regions' })).toHaveTextContent('eu-central-1')
    // Legend: only the states possible at M6.
    expect(within(s).getByLabelText('Region states').querySelectorAll('strong')).toHaveLength(5)
  })

  it('never sums home + S3 + CloudFront: chips show their own counts, the Resources tile shows /stats total', async () => {
    renderPage()
    await settled()
    expect(chipTexts()).toEqual([
      'eu-central-1 | 8 · home · complete',
      'global | 1 · CloudFront',
      'S3 in other regions | 1',
      'other regions | not scanned',
    ])
    expect(within(tile('Resources')).getByText('10')).toBeInTheDocument()
    expect(tiles()).not.toHaveTextContent(/\b(12|11)\b/) // 8 + 2 + 1 + 1 / 8 + 2 + 1
  })

  it('a stale running job (older than an hour) shows as "Last scan failed" in red, never in progress or Complete', async () => {
    mockGetCoverage.mockResolvedValue(coverage({ last_scan: { status: 'running', started_at: minutesAgo(60 * 24 * 12), completed_at: null, warnings: [] } }))
    renderPage()
    await settled()
    // The chips and the scan line, not the legend (which names every state).
    const chipsAndLine = within(strip()).getByRole('list', { name: 'Scanned regions' }).textContent + within(strip()).getByText(/^Last scan failed · /).textContent
    expect(chipsAndLine).not.toMatch(/in progress|Scanning\.\.\.|Scanning…|complete/i)
    expect(screen.getByRole('button', { name: /Auto Discover/ })).not.toHaveTextContent(/Scanning/)
    expect(chipTexts()[0]).toBe('eu-central-1 | 8 · home · last scan failed')
    expect(within(strip()).getAllByRole('listitem')[0].className).toMatch(/red/)
    const line = within(strip()).getByText(/^Last scan failed · Last successful scan .*\(48 min ago\)$/)
    expect(line.className).toMatch(/text-red-700/)
    expect(within(strip()).getByRole('list', { name: 'Scanned regions' })).not.toHaveTextContent(/complete/i)
    expect(screen.queryByText('Failed to load resources.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Auto Discover/ })).toBeEnabled()
  })

  it('a running job started minutes ago is in progress', async () => {
    mockGetCoverage.mockResolvedValue(coverage({ last_scan: { status: 'running', started_at: minutesAgo(3), completed_at: null, warnings: [] } }))
    renderPage()
    await settled()
    expect(strip()).toHaveTextContent(/Scan in progress, started .*\(3 min ago\)/)
    expect(chipTexts()[0]).toBe('eu-central-1 | 8 · home · scan in progress')
    expect(strip()).not.toHaveTextContent(/partial/)
  })

  it('discovery_listing_truncated on a completed scan: Partial with its own copy', async () => {
    mockGetCoverage.mockResolvedValue(coverage({ last_scan: { status: 'completed', started_at: minutesAgo(50), completed_at: minutesAgo(48), warnings: ['discovery_listing_truncated'] } }))
    renderPage()
    await settled()
    expect(chipTexts()[0]).toBe('eu-central-1 | 8 · home · partial')
    expect(within(strip()).getByText('Some resource listings were cut off, so removed resources may still be listed until the next full scan.')).toBeInTheDocument()
    expect(strip()).not.toHaveTextContent(/discovery_listing_truncated|cannot describe yet|1,000 indexed/)
  })

  it.each([
    ['running', { status: 'running', started_at: minutesAgo(4), completed_at: null, warnings: [] }],
    ['failed', { status: 'failed', started_at: minutesAgo(10), completed_at: minutesAgo(9), warnings: [] }],
  ])('pro upgrade with the first pro scan %s: no S3/CloudFront claim in the headline or Resources caption', async (_l, last) => {
    mockGetCoverage.mockResolvedValue(coverage({ last_scan: last }))
    renderPage()
    await settled()
    expect(within(strip()).getByText('eu-central-1 scanned')).toBeInTheDocument()
    expect(strip()).not.toHaveTextContent(/S3 buckets in every region|CloudFront \(global\)/)
    expect(tile('Resources')).toHaveTextContent(/^Resources10in eu-central-1$/)
  })

  it('only scan failed: "{home}: last scan failed"', async () => {
    mockGetCoverage.mockResolvedValue(coverage({ last_successful_scan_at: null, last_scan: { status: 'failed', started_at: minutesAgo(10), completed_at: minutesAgo(9), warnings: [] } }))
    renderPage()
    expect(await within(strip()).findByText('eu-central-1: last scan failed')).toBeInTheDocument()
    expect(strip()).toHaveTextContent(/Last scan failed .*\(9 min ago\) · No successful scan yet/)
    expect(strip()).not.toHaveTextContent(/eu-central-1 scanned/)
  })

  it('a failed last scan shows "Last scan failed" in red, not Partial, and adds no error banner', async () => {
    mockGetCoverage.mockResolvedValue(coverage({ last_scan: { status: 'failed', started_at: minutesAgo(20), completed_at: minutesAgo(19), warnings: [DISCOVERY_WARNING_TRUNCATED_INDEX] } }))
    renderPage()
    await settled()
    expect(chipTexts()[0]).toBe('eu-central-1 | 8 · home · last scan failed')
    const chip = within(strip()).getAllByRole('listitem')[0]
    expect(chip.className).toMatch(/red/)
    const line = within(strip()).getByText(/^Last scan failed .*\(19 min ago\)/)
    expect(line.className).toMatch(/text-red-700/)
    expect(within(strip()).getAllByRole('listitem').map((li) => li.textContent).join()).not.toMatch(/partial/)
    // The persisted warning still shows the existing E4 copy on load.
    expect(within(strip()).getByText(DELETION_DETECTION_PAUSED_TEXT)).toBeInTheDocument()
    // The existing error banner rules are unchanged: a failed scan alone is not a load error.
    expect(screen.queryByText('Failed to load resources.')).not.toBeInTheDocument()
  })

  it('Partial is a finished scan with a warning; the legend has the five states', async () => {
    mockGetCoverage.mockResolvedValue(coverage({ last_scan: { status: 'completed', started_at: minutesAgo(50), completed_at: minutesAgo(48), warnings: [DISCOVERY_WARNING_TRUNCATED_INDEX] } }))
    renderPage()
    await settled()
    expect(chipTexts()[0]).toBe('eu-central-1 | 8 · home · partial')
    const legend = within(strip()).getByLabelText('Region states')
    expect([...legend.querySelectorAll('span')].map((s) => s.textContent)).toEqual([
      'Complete: the last scan finished with no warning',
      'Partial: the last scan finished with a warning, shown below',
      'Last scan failed: some counts may be from an earlier scan',
      'Scan in progress: counts may change when it finishes',
      'Not scanned: not scanned yet',
    ])
  })

  it('no account: no "connected" claim', async () => {
    mockGetCoverage.mockResolvedValue(coverage({ account: { connected: false, status: null, home_region: null }, scope: { home_region: null, s3: { in_last_scan: false, regions: [] }, cloudfront: { in_last_scan: false, count: 0 }, enabled_regions: { known: false, count: null } }, last_scan: null, last_successful_scan_at: null }))
    mockGetAccounts.mockResolvedValue([])
    serve([], [])
    mockGetStats.mockResolvedValue({ ...STATS, total: 0, healthy: 0, needs_attention: 0, aws_accounts_connected: 0, ownership: { owned: 0, unowned: 0, unknown: 0 }, teams: { top: [], all: [], total_teams: 0 } })
    renderPage()
    expect(await within(strip()).findByText('No AWS account connected')).toBeInTheDocument()
    expect(within(strip()).queryByText('AWS account connected')).not.toBeInTheDocument()
    expect(within(strip()).getByRole('link', { name: 'Connect AWS account' })).toHaveAttribute('href', '/connect-aws')
    // No stored resources: the plain no-account wording.
    expect(strip()).not.toHaveTextContent('previous connection')
    // Nothing to attend to or own: the list below says why.
    await waitFor(() => expect(screen.queryByRole('region', { name: 'What needs attention' })).not.toBeInTheDocument())
    expect(screen.queryByRole('region', { name: /unowned/ })).not.toBeInTheDocument()
  })

  it('connected but never scanned', async () => {
    mockGetCoverage.mockResolvedValue(coverage({ last_scan: null, last_successful_scan_at: null, scope: { home_region: { region: 'eu-central-1', count: 0 }, s3: { in_last_scan: false, regions: [] }, cloudfront: { in_last_scan: false, count: 0 }, enabled_regions: { known: false, count: null } } }))
    serve([], [])
    mockGetStats.mockResolvedValue({ ...STATS, total: 0, healthy: 0, needs_attention: 0 })
    renderPage()
    expect(await within(strip()).findByText('eu-central-1: not scanned yet')).toBeInTheDocument()
    expect(strip()).toHaveTextContent('No successful scan yet')
    expect(chipTexts()[0]).toBe('eu-central-1 | home · not scanned')
  })

  it('loading, then an error with Try again, never a connected claim', async () => {
    mockGetCoverage.mockRejectedValue(new Error('409'))
    renderPage()
    expect(within(strip()).getByText('Loading scan coverage…')).toBeInTheDocument()
    expect(await within(strip()).findByText('Scan coverage could not be loaded.')).toBeInTheDocument()
    expect(within(strip()).queryByText('AWS account connected')).not.toBeInTheDocument()
    mockGetCoverage.mockResolvedValue(coverage())
    fireEvent.click(within(strip()).getByRole('button', { name: /Try again/ }))
    expect(await within(strip()).findByText(/^eu-central-1 scanned/)).toBeInTheDocument()
  })
})

describe('tiles', () => {
  it('show /stats numbers, severity split and "No flagged issues: N"', async () => {
    renderPage()
    await settled()
    expect(tile('Needs attention')).toHaveTextContent('31 Critical1 High1 MediumNo flagged issues: 7')
    expect(tile('Unowned')).toHaveTextContent('2')
    // 2 of the 8 resources whose tags were read (owned 6 + unowned 2); unknown is not in it.
    expect(tile('Unowned')).toHaveTextContent('25% of resources whose tags we could read have neither an Owner nor a Team tag')
    expect(tile('Resources')).toHaveTextContent('10in eu-central-1, plus S3 in every region and CloudFront')
    expect(tile('Services')).toHaveTextContent('2registered · resources not mapped to services yet Phase 2')
  })

  it('"…" while loading and "—" when /stats failed, never 0', async () => {
    let fail!: (e: Error) => void
    mockGetStats.mockReturnValue(new Promise((_, rej) => { fail = rej }))
    renderPage()
    expect(within(tile('Needs attention')).getByText('…')).toBeInTheDocument()
    expect(tile('Needs attention')).toHaveTextContent('No flagged issues: …')
    expect(within(tile('Unowned')).getByText('…')).toBeInTheDocument()
    expect(within(tile('Resources')).getByText('…')).toBeInTheDocument()
    fail(new Error('500'))
    await waitFor(() => expect(within(tile('Needs attention')).getByText('—')).toBeInTheDocument())
    expect(tile('Needs attention')).toHaveTextContent('No flagged issues: —')
    expect(within(tile('Unowned')).getByText('—')).toBeInTheDocument()
    expect(within(tile('Resources')).getByText('—')).toBeInTheDocument()
    for (const label of ['Needs attention', 'Unowned', 'Resources']) expect(within(tile(label)).queryByText('0')).not.toBeInTheDocument()
    // E9 stays above the coverage strip.
    const banner = screen.getByText('Failed to load resources.')
    expect(banner.compareDocumentPosition(strip()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('Services: "…" while registered services load, "—" on error', async () => {
    registered = { isPending: true, isError: false, isSuccess: false, refetch: vi.fn() }
    const { unmount } = renderPage()
    expect(within(tile('Services')).getByText('…')).toBeInTheDocument()
    unmount()
    registered = { isPending: false, isError: true, isSuccess: false, refetch: vi.fn() }
    renderPage()
    expect(within(tile('Services')).getByText('—')).toBeInTheDocument()
  })

  it('spend: billed Cost Explorer data with "billed through {date}"', async () => {
    renderPage()
    await settled()
    const t = tile('AWS spend, month to date')
    await waitFor(() => expect(t).toHaveTextContent('$4,321.50'))
    expect(t).toHaveTextContent('whole account · billed, from Cost Explorer · billed through Oct 18 · per service Phase 2')
  })

  it('spend: without finishedThrough the "billed through" part is left out, never guessed', async () => {
    mockGetCostSummary.mockResolvedValue(billed({ finishedThrough: null }))
    renderPage()
    await settled()
    const t = tile('AWS spend, month to date')
    await waitFor(() => expect(t).toHaveTextContent('$4,321.50'))
    expect(t).not.toHaveTextContent('billed through')
  })

  it.each([
    ['an inventory estimate', () => mockGetCostSummary.mockResolvedValue(billed({ basis: 'estimated_monthly_run_rate', amount: 987.65 }, { provenance: 'estimated' }))],
    ['billed_month_to_date with provenance "estimated"', () => mockGetCostSummary.mockResolvedValue(billed({ amount: 987.65 }, { provenance: 'estimated' }))],
    ['billed_month_to_date with provenance "derived"', () => mockGetCostSummary.mockResolvedValue(billed({ amount: 987.65 }, { provenance: 'derived' }))],
    ['billed_month_to_date with no provenance', () => mockGetCostSummary.mockResolvedValue(billed({ amount: 987.65 }, { provenance: null }))],
    ['unavailable', () => mockGetCostSummary.mockResolvedValue(billed({}, { state: 'unavailable', data: null, provenance: null }))],
    ['a section error', () => mockGetCostSummary.mockResolvedValue(billed({}, { state: 'error', data: null }))],
    ['a failed request', () => mockGetCostSummary.mockRejectedValue(new Error('500'))],
  ])('spend: %s reads "Cost data not available yet" + Costs link, no amount', async (_l, arrange) => {
    arrange()
    renderPage()
    await settled()
    const t = tile('AWS spend, month to date')
    await waitFor(() => expect(t).toHaveTextContent('Cost data not available yet'))
    expect(within(t).getByRole('link', { name: 'Costs' })).toHaveAttribute('href', '/costs')
    expect(t).not.toHaveTextContent(/\$|987|4,321|Estimated/)
  })
})

describe('tiles with nothing scanned (no account, or never scanned)', () => {
  const EMPTY_STATS = { ...STATS, total: 0, healthy: 0, needs_attention: 0, aws_accounts_connected: 0,
    attention_by_severity: { critical: 0, high: 0, medium: 0, low: 0 }, ownership: { owned: 0, unowned: 0, unknown: 0 },
    unknown_by_type: {}, regions: [], teams: { top: [], all: [], total_teams: 0 }, mapped_to_service: 0 }
  const NO_SCOPE = { home_region: null, s3: { in_last_scan: false, regions: [] }, cloudfront: { in_last_scan: false, count: 0 }, enabled_regions: { known: false, count: null } }
  const inventoryTiles = ['Needs attention', 'Unowned', 'Resources']

  async function shown() {
    await waitFor(() => expect(within(tile('Resources')).getByText('—')).toBeInTheDocument())
  }

  function expectNoZeroAndNoRed() {
    for (const label of inventoryTiles) {
      expect(within(tile(label)).getByText('—')).toBeInTheDocument()
      expect(within(tile(label)).queryByText('0')).not.toBeInTheDocument()
    }
    expect(tile('Needs attention')).toHaveTextContent('No flagged issues: —')
    expect(tile('Needs attention').className).not.toMatch(/red/)
    expect(within(tiles()).queryByRole('list', { name: 'Needs attention by severity' })).not.toBeInTheDocument()
    expect(tile('Needs attention').querySelector('[class*="text-red"]')).toBeNull()
  }

  it('no account: "—" and "Connect an AWS account", never 0 or red', async () => {
    mockGetCoverage.mockResolvedValue(coverage({ account: { connected: false, status: null, home_region: null }, scope: NO_SCOPE, last_scan: null, last_successful_scan_at: null }))
    mockGetAccounts.mockResolvedValue([])
    serve([], [])
    mockGetStats.mockResolvedValue(EMPTY_STATS)
    renderPage()
    await shown()
    expectNoZeroAndNoRed()
    for (const label of inventoryTiles) {
      expect(within(tile(label)).getByRole('link', { name: 'Connect an AWS account' })).toHaveAttribute('href', '/connect-aws')
    }
    expect(tiles()).not.toHaveTextContent('Not scanned yet')
  })

  it('connected but never scanned: "—" and "Not scanned yet", never 0 or red', async () => {
    mockGetCoverage.mockResolvedValue(coverage({ last_scan: null, last_successful_scan_at: null, scope: { ...NO_SCOPE, home_region: { region: 'eu-central-1', count: 0 } } }))
    serve([], [])
    mockGetStats.mockResolvedValue({ ...EMPTY_STATS, aws_accounts_connected: 1 })
    renderPage()
    await shown()
    expectNoZeroAndNoRed()
    for (const label of inventoryTiles) expect(tile(label)).toHaveTextContent('Not scanned yet')
    expect(within(tiles()).queryByRole('link', { name: 'Connect an AWS account' })).not.toBeInTheDocument()
  })

  it('with 0 resources, the not-mapped footer and tile caption are hidden', async () => {
    mockGetCoverage.mockResolvedValue(coverage({ account: { connected: false, status: null, home_region: null }, scope: NO_SCOPE, last_scan: null, last_successful_scan_at: null }))
    serve([], [])
    mockGetStats.mockResolvedValue(EMPTY_STATS) // mapped_to_service 0, total 0
    renderPage()
    await shown()
    expect(yourServices()).not.toHaveTextContent(/None of the .* resources are mapped/)
    expect(within(yourServices()).queryByRole('button', { name: 'Map resources to services' })).not.toBeInTheDocument()
    expect(tile('Services')).toHaveTextContent('2registered')
    expect(tile('Services')).not.toHaveTextContent('not mapped')
  })

  it('a stored inventory with no account connected is still counted as it is', async () => {
    mockGetCoverage.mockResolvedValue(coverage({ account: { connected: false, status: null, home_region: null }, scope: NO_SCOPE }))
    renderPage()
    await waitFor(() => expect(within(tile('Resources')).getByText('10')).toBeInTheDocument())
    // ...and the strip says where those resources come from.
    expect(strip()).toHaveTextContent('No AWS account connected · showing resources from a previous connection')
    expect(within(strip()).queryByText('AWS account connected')).not.toBeInTheDocument()
    expect(within(tile('Needs attention')).getByText('3')).toBeInTheDocument()
    expect(within(tiles()).queryByRole('link', { name: 'Connect an AWS account' })).not.toBeInTheDocument()
  })

  it('scanned with nothing flagged: a real 0, with no red and no severity chips', async () => {
    serve([], OTHER_ROWS)
    mockGetStats.mockResolvedValue({ ...STATS, needs_attention: 0, healthy: 10, attention_by_severity: { critical: 0, high: 0, medium: 0, low: 0 } })
    renderPage()
    await waitFor(() => expect(within(tile('Needs attention')).getByText('0')).toBeInTheDocument())
    expect(tile('Needs attention').className).not.toMatch(/red/)
    expect(tile('Needs attention').querySelector('[class*="text-red"]')).toBeNull()
    expect(within(tiles()).queryByRole('list', { name: 'Needs attention by severity' })).not.toBeInTheDocument()
    expect(tile('Needs attention')).toHaveTextContent('No flagged issues: 10')
  })

  it('something flagged keeps the red tile and severity chips', async () => {
    renderPage()
    await settled()
    expect(tile('Needs attention').className).toMatch(/border-red/)
    expect(within(tiles()).getByRole('list', { name: 'Needs attention by severity' })).toBeInTheDocument()
  })
})

describe('S1-C visual review', () => {
  const services = (n: number, o: Record<string, any> = {}) => Array.from({ length: n }, (_, i) => ({
    id: `svc-${i + 1}`, name: `service-${String(i + 1).padStart(2, '0')}`, owner: `owner-${i + 1}@example.com`,
    teamId: null, teamName: null, githubUrl: null, createdAt: '2026-09-01T00:00:00Z', ...o,
  }))
  const bodyRows = () => within(yourServices()).getAllByRole('row').slice(1)

  it.each([12, 40])('Your services shows 10 of %i rows, then "Show all N" expands and collapses in place', async (n) => {
    registered = ready(services(n))
    renderPage()
    await settled()
    const requestsBefore = mockGetServices.mock.calls.length
    expect(bodyRows()).toHaveLength(10)
    expect(yourServices()).toHaveTextContent(`${n} registered`)
    expect(within(tile('Services')).getByText(String(n))).toBeInTheDocument()
    const toggle = within(yourServices()).getByRole('button', { name: `Show all ${n}` })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(bodyRows()).toHaveLength(n)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).toHaveTextContent('Show fewer')
    expect(bodyRows().at(-1)).toHaveTextContent(`service-${String(n).padStart(2, '0')}`)
    fireEvent.click(toggle)
    expect(bodyRows()).toHaveLength(10)
    // The Registered column is kept, and nothing was fetched to expand.
    expect(within(yourServices()).getAllByRole('columnheader').map((h) => h.textContent)).toContain('Registered')
    expect(mockGetServices.mock.calls.length).toBe(requestsBefore)
  })

  it('no "Show all" with 10 services or fewer', async () => {
    registered = ready(services(10))
    renderPage()
    await settled()
    expect(bodyRows()).toHaveLength(10)
    expect(within(yourServices()).queryByRole('button', { name: /Show all|Show fewer/ })).not.toBeInTheDocument()
  })

  it.each([['missing', null], ['empty', ''], ['blank', '   ']])('a %s owner reads "No owner set"', async (_l, owner) => {
    registered = ready([...services(1, { owner }), ...services(1).map((s) => ({ ...s, id: 'other', name: 'other' }))])
    renderPage()
    await settled()
    const [first, second] = bodyRows()
    expect(within(first).getAllByRole('cell')[1]).toHaveTextContent(/^No owner set$/)
    expect(within(second).getAllByRole('cell')[1]).toHaveTextContent('owner-1@example.com')
  })

  it('hides only severity chips whose count is 0; the others keep their styling', async () => {
    mockGetStats.mockResolvedValue({ ...STATS, needs_attention: 3, attention_by_severity: { critical: 0, high: 2, medium: 0, low: 1 } })
    renderPage()
    await settled()
    const chips = within(within(tiles()).getByRole('list', { name: 'Needs attention by severity' })).getAllByRole('listitem')
    expect(chips.map((c) => c.textContent)).toEqual(['2 High', '1 Low'])
    expect(chips[0].className).toMatch(/bg-orange-50 text-orange-800/)
    expect(chips[1].className).toMatch(/bg-slate-100 text-slate-700/)
    expect(tile('Needs attention')).not.toHaveTextContent(/0 Critical|0 Medium/)
  })

  it('a connected account never shows the previous-connection wording', async () => {
    renderPage()
    await settled()
    expect(strip()).toHaveTextContent('AWS account connected')
    expect(strip()).not.toHaveTextContent(/No AWS account connected|previous connection/)
  })
})

describe('What needs attention', () => {
  it('lists the server rows with severity, issue, resource, region and owner states', async () => {
    renderPage()
    await settled()
    expect(mockGetServices).toHaveBeenCalledWith({ needs_attention: true, page: 1, limit: 6 })
    const a = attention()
    expect(a).toHaveTextContent('Critical and high findings, high-severity cost recommendations, stopped or failed resources')
    const rows = within(a).getAllByRole('row').slice(1)
    expect(rows.map((r) => within(r).getAllByRole('cell')[2].textContent)).toEqual(['res-a1 EC2', 'res-a2 EC2', 'res-a3 S3'])
    expect(rows[0]).toHaveTextContent('Critical')
    expect(rows[0]).toHaveTextContent('eu-central-1')
    expect(within(rows[0]).getByText('Unowned')).toBeInTheDocument()
    expect(rows[1]).toHaveTextContent('No Owner tag · data')
    expect(rows[2]).toHaveTextContent('Unknown · tags unreadable')
    expect(rows[2]).not.toHaveTextContent('Unowned')
    expect(within(a).getByRole('button', { name: 'View all 3 →' })).toBeInTheDocument()
  })

  it('has no Fix; Review only for cost recommendations, View details otherwise', async () => {
    renderPage()
    await settled()
    expect(screen.queryByRole('button', { name: /Fix/ })).not.toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/\bFix\b/)
    const rows = within(attention()).getAllByRole('row').slice(1)
    expect(within(rows[1]).getByRole('link', { name: /Review/ })).toHaveAttribute('href', '/cost-optimization')
    expect(within(rows[1]).queryByRole('button', { name: /View details/ })).not.toBeInTheDocument()
    for (const r of [rows[0], rows[2]]) {
      expect(within(r).getByRole('button', { name: /View details/ })).toBeInTheDocument()
      expect(within(r).queryByRole('link', { name: /Review/ })).not.toBeInTheDocument()
    }
  })

  it('View details expands the row from list data, with no request', async () => {
    renderPage()
    await settled()
    const calls = mockGetServices.mock.calls.length + mockGetStats.mock.calls.length + mockGetCoverage.mock.calls.length
    const button = within(attention()).getByRole('button', { name: 'View details for res-a3' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    // aria-controls only names a row that is in the DOM.
    expect(button).not.toHaveAttribute('aria-controls')
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    const details = document.getElementById(button.getAttribute('aria-controls')!)!
    expect(details).not.toBeNull()
    expect(details).toHaveTextContent('Resource is stopped or degraded')
    expect(details).toHaveTextContent('Lifecycle state')
    expect(details).toHaveTextContent('Stopped or degraded')
    expect(details).toHaveTextContent('Unknown · tags unreadable')
    expect(details).toHaveTextContent('Last seen')
    expect(details).not.toHaveTextContent(/healthy/i)
    expect(mockGetServices.mock.calls.length + mockGetStats.mock.calls.length + mockGetCoverage.mock.calls.length).toBe(calls)
    fireEvent.click(button)
    expect(button).not.toHaveAttribute('aria-controls')
    expect(document.getElementById(details.id)).toBeNull()
    // Every aria-controls on the page points at an element that exists.
    for (const el of attention().querySelectorAll('[aria-controls]')) expect(document.getElementById(el.getAttribute('aria-controls')!)).not.toBeNull()
  })

  it('"View all N" opens the list below on Needs attention', async () => {
    renderPage()
    await settled()
    fireEvent.click(within(attention()).getByRole('button', { name: 'View all 3 →' }))
    await waitFor(() => expect(mockGetServices).toHaveBeenLastCalledWith({ sort: 'attention', page: 1, limit: 50, needs_attention: true }))
    expect(within(screen.getByRole('region', { name: 'All resources' })).getByLabelText('Show')).toHaveValue('needs_attention')
    await waitFor(() => expect(screen.getByRole('region', { name: 'All resources' })).toHaveTextContent('3 resources matching current filters'))
    expect(screen.queryByText(/resources? with no flagged issues/)).not.toBeInTheDocument()
  })

  it('nothing flagged: the positive empty state', async () => {
    serve([], OTHER_ROWS)
    mockGetStats.mockResolvedValue({ ...STATS, needs_attention: 0, healthy: 10, attention_by_severity: { critical: 0, high: 0, medium: 0, low: 0 } })
    renderPage()
    expect(await within(attention()).findByText('Nothing needs attention right now')).toBeInTheDocument()
    expect(attention()).toHaveTextContent('None of the 10 resources have a flagged issue.')
    expect(within(attention()).getByRole('button', { name: 'Show all resources' })).toBeInTheDocument()
    expect(within(attention()).queryByRole('button', { name: /View all/ })).not.toBeInTheDocument()
  })

  it('loading row, then the error row with the list error copy and Try again', async () => {
    mockGetServices.mockImplementation(async (req: any = {}) => { if (req.limit === 6) throw new Error('500'); return page([], 0, 50) })
    renderPage()
    expect(within(attention()).getByText('Loading resources…')).toBeInTheDocument()
    expect(await within(attention()).findByText('The resource list could not be loaded')).toBeInTheDocument()
    expect(attention()).toHaveTextContent('This is a loading error, not an empty result.')
    serve()
    fireEvent.click(within(attention()).getByRole('button', { name: /Try again/ }))
    expect(await within(attention()).findByRole('table')).toBeInTheDocument()
  })
})

describe('Your services', () => {
  it('keeps the Registered column; team and repository say "No team set" / "No repository set"', async () => {
    renderPage()
    await settled()
    const card = yourServices()
    expect(card).toHaveTextContent('2 registered')
    const headers = within(card).getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toEqual(['Service', 'Owner', 'Team', 'Repository', 'Registered', 'Resources · findings · cost · deploys Phase 2'])
    expect(card).toHaveTextContent('No team set')
    expect(card).toHaveTextContent('No repository set')
    expect(within(card).getByRole('link', { name: 'github.com/example-org/checkout-api' })).toHaveAttribute('href', 'https://github.com/example-org/checkout-api')
    expect(within(card).getAllByText('Not mapped yet')).toHaveLength(2)
    expect(card).toHaveTextContent('None of the 10 resources are mapped to a service yet. Mapping by tag or by hand fills in resources, findings, cost and deploys per service.')
    expect(within(card).getByRole('button', { name: 'Map resources to services' })).toBeDisabled()
  })

  it('hides the not-mapped column and footer once a resource is mapped', async () => {
    mockGetStats.mockResolvedValue({ ...STATS, mapped_to_service: 4 })
    renderPage()
    await settled()
    const card = yourServices()
    expect(within(card).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Service', 'Owner', 'Team', 'Repository', 'Registered'])
    expect(card).not.toHaveTextContent(/Not mapped yet|None of the .* resources are mapped/)
    expect(tile('Services')).not.toHaveTextContent('not mapped')
  })

  it('loading and error keep their copy', async () => {
    registered = { isPending: true, isError: false, isSuccess: false, refetch: vi.fn() }
    const { unmount } = renderPage()
    expect(within(yourServices()).getByText('Loading registered services...')).toBeInTheDocument()
    unmount()
    const refetch = vi.fn()
    registered = { isPending: false, isError: true, isSuccess: false, refetch }
    renderPage()
    expect(within(yourServices()).getByText("Couldn't load registered services.")).toBeInTheDocument()
    fireEvent.click(within(yourServices()).getByRole('button', { name: /Try again/ }))
    expect(refetch).toHaveBeenCalled()
  })
})

describe('Unowned card', () => {
  it('shows the unowned count beside the top 3 teams; Assign owner is Phase 2', async () => {
    renderPage()
    await settled()
    const card = screen.getByRole('region', { name: '2 resources are unowned' })
    const bars = within(card).getByRole('list', { name: 'Resources per team' })
    expect(within(bars).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['platform5', 'data2', 'payments1', 'Unowned2'])
    expect(within(card).getByRole('button', { name: 'Assign owner' })).toBeDisabled()
    expect(card).toHaveTextContent('Phase 2')
  })
})

describe('demo mode (Q6)', () => {
  it('renders the placeholder fixture under SAMPLE DATA with no API calls', async () => {
    demoMode = true
    renderPage()
    expect(screen.getByText('SAMPLE DATA: illustrative, not live AWS inventory.')).toBeInTheDocument()
    expect(strip()).toHaveTextContent('us-east-1 scanned, plus S3 buckets in every region and CloudFront (global) · other regions not scanned yet')
    // Numbers from the fixture rows: 12 resources, 5 need attention.
    expect(within(tile('Resources')).getByText('12')).toBeInTheDocument()
    expect(within(tile('Needs attention')).getByText('5')).toBeInTheDocument()
    expect(tile('Needs attention')).toHaveTextContent('No flagged issues: 7')
    expect(within(attention()).getAllByRole('row')).toHaveLength(6) // header + 5
    expect(within(tile('Services')).getByText('3')).toBeInTheDocument()
    expect(tile('AWS spend, month to date')).toHaveTextContent('$1,234.56')
    // The list below uses the same fixture.
    expect(screen.getByRole('region', { name: 'All resources' })).toHaveTextContent('12 resources')
    expect(document.body.textContent).not.toMatch(/Service Health Score|High confidence|sarah\.chen|mike\.johnson|alex\.wong|emma\.davis|david\.kim|api-gateway|Lambda invocation spike/)
    // Every email address is a placeholder owner-*@example.com.
    const text = document.body.textContent!
    const addresses = text.match(/@[a-z0-9-]+\.[a-z]/gi) ?? [] // not the page's @keyframes
    expect(addresses.length).toBeGreaterThan(0)
    expect((text.match(/owner-[a-z0-9]+@example\.com/g) ?? []).length).toBe(addresses.length)
    expect(mockGetServices).not.toHaveBeenCalled()
    expect(mockGetStats).not.toHaveBeenCalled()
    expect(mockGetCoverage).not.toHaveBeenCalled()
    expect(mockGetCostSummary).not.toHaveBeenCalled()
    expect(mockGetAccounts).not.toHaveBeenCalled()
    expect(registeredCalls.every((o) => o?.enabled === false)).toBe(true)
  })
})

describe('accessibility', () => {
  it('uses real headings, buttons and links, and labelled regions', async () => {
    renderPage()
    await settled()
    for (const name of ['Account and scan coverage', 'Summary', 'What needs attention', 'Your services', '2 resources are unowned']) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument()
    }
    for (const t of ['Needs attention', 'Unowned', 'Resources', 'Services', 'AWS spend, month to date']) {
      expect(within(tiles()).getByRole('heading', { name: t, level: 2 })).toBeInTheDocument()
    }
    // Heading levels never skip: an h1, then h2s, and no h3 before the first h2.
    const levels = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((h) => Number(h.tagName[1]))
    expect(levels[0]).toBe(1)
    levels.forEach((level, i) => { if (i > 0) expect(level).toBeLessThanOrEqual(Math.max(...levels.slice(0, i)) + 1) })
    // Every column header is scoped and every button has an accessible name.
    for (const th of document.querySelectorAll('section th')) expect(th).toHaveAttribute('scope', 'col')
    for (const b of screen.getAllByRole('button')) expect(b).toHaveAccessibleName()
  })
})
