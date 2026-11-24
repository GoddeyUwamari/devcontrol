/**
 * The Services redesign (PR 3b, mock v2.2), one render per mock state (tabs
 * 1–8, 13, 14; 9–12 are PR 3c), each built from the doc's real `multi_region`
 * examples (docs/SERVICES_COVERAGE_MULTI_REGION.md, read at test time) plus
 * small fixtures. Every string is compared exactly. TZ UTC, fixed clock.
 */
process.env.TZ = 'UTC'

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ServicesPage from '../page'
import {
  R_NOW, STATE_FIXTURES, TAB13_FAILED, TAB13_PARTIAL, docExample, flaggedCoverage, mrRegion, redesignStats, scanOf,
  tab1, tab13, tab3Throttled, tab5, tab8EarlierDenied,
} from './redesign-fixtures'

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
vi.mock('@/lib/hooks/use-current-role', () => ({ useCurrentRole: () => 'owner' }))
vi.mock('@/lib/hooks/use-registered-services', () => ({
  useRegisteredServices: () => ({ isPending: false, isError: false, isSuccess: true, data: [], refetch: vi.fn() }),
}))
const toastWarning = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: toastWarning } }))
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
vi.mock('@/lib/services/aws-accounts.service', () => ({ default: { getAccountsAndConnection: async () => ({ accounts: [{ id: 'acct-1' }], connection: 'connected' }) } }))
vi.mock('@/lib/services/platform-stats.service', () => ({
  platformStatsService: {
    getCostSummary: async () => ({
      spend: { state: 'available', source: 'cost_explorer', provenance: 'actual', asOf: null, coverage: null, reason: null, data: { amount: 4321.5, basis: 'billed_month_to_date', lastDayInProgress: true, finishedThrough: '2026-11-14' } },
      monthOverMonth: { state: 'unavailable', source: 'x', provenance: null, asOf: null, coverage: null, reason: null, data: null },
    }),
  },
}))

// ── Rendering ──

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><ServicesPage /></QueryClientProvider>)
}

/** One state, rendered from one row set (scanOf: coverage, /stats and the list agree). `stats` overrides /stats only for the deliberate-mismatch control. */
function serve(coverage: unknown, stats?: unknown) {
  const scan = scanOf(coverage)
  mockGetCoverage.mockResolvedValue(scan.coverage)
  mockGetStats.mockResolvedValue(stats ?? scan.stats)
  mockGetServices.mockImplementation(async (req: any = {}) => scan.list(req))
  return scan
}

async function show(coverage: unknown, stats?: unknown) {
  const scan = serve(coverage, stats)
  const view = renderPage()
  await screen.findByTestId('organising-line')
  await waitFor(() => expect(screen.queryByText(/Loading/)).toBeNull())
  return Object.assign(view, { scan })
}

const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
const orgLine = () => text(screen.getByTestId('organising-line'))
const homeLine = () => text(screen.getByTestId('home-line'))
const headerLine = () => text(screen.getByTestId('services-scan-line'))
const table = () => document.querySelector('[data-layout="table"]')!
const stacked = () => document.querySelector('[data-layout="stacked"]')!
/** The table rows' keys, in order. */
const rowKeys = () => [...table().querySelectorAll('tbody > tr')].map((tr) => tr.getAttribute('data-row'))
function cells(key: string): string[] {
  const tr = table().querySelector(`tr[data-row="${key}"]`)
  if (!tr) throw new Error(`no row ${key}`)
  return [...tr.children].map((c) => text(c))
}
const notes = () => [...document.querySelectorAll('[data-note]')].map((n) => [n.getAttribute('data-note'), text(n)])
const legend = () => [...screen.getByRole('list', { name: 'Status legend' }).querySelectorAll('li')].map((li) => text(li))
const notChecked = () => screen.getByTestId('not-checked')

async function scanNow(outcome: { jobId: string | null; discovered?: number; updated?: number }, after?: unknown) {
  if (after !== undefined) serve(after)
  mockDiscover.mockResolvedValue({ message: 'x', warnings: [], errors: [], discovered: outcome.discovered ?? 4, updated: outcome.updated ?? 12, jobId: outcome.jobId ?? undefined })
  fireEvent.click(screen.getByRole('button', { name: 'Scan now' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Scan now' })).toBeEnabled())
}

beforeEach(() => {
  vi.clearAllMocks()
  demoMode = false
  vi.useFakeTimers({ toFake: ['Date'], now: R_NOW })
  vi.stubEnv('NEXT_PUBLIC_SERVICES_V2', 'true')
  vi.stubEnv('NEXT_PUBLIC_SERVICES_REDESIGN', 'true')
  vi.stubEnv('NEXT_PUBLIC_SERVICES_COVERAGE_M6', 'false')
})
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers() })

// ── Fixtures per tab ──

// ── Tab 1 ──

describe('tab 1: all regions checked', () => {
  it('header, organising line, home line, panel, legend, footer', async () => {
    await show(tab1())
    expect(headerLine()).toBe('Last scan finished today, 10:20 AM')
    expect(orgLine()).toBe('5 of 5 regions checked · 3 with resources · 2 empty')
    expect(homeLine()).toBe('Cost savings, Operational Health and Security Hub run in your home region, us-east-1, only.')
    expect(rowKeys()).toEqual(['region-us-east-1', 'region-ap-south-1', 'region-eu-west-1', 'empty', 'not-enabled', 'global-heading', 'cloudfront'])
    expect(cells('region-us-east-1')).toEqual(['us-east-1Home', '4', 'Complete', expect.stringMatching(/^today, 10:03 AM/), '—'])
    expect(cells('empty')).toEqual(['2 regions checked · no resourcesShow regionseu-north-1sa-east-1', '0', 'Complete', expect.stringMatching(/^today, 10:03 AM/), 'Each scanned completely; nothing found.'])
    expect(cells('not-enabled')).toEqual(['Not enabled in this account (2)Show regionsaf-south-1ap-east-1', '—', 'Not enabled', '—', "Opt-in regions this account hasn't enabled. Nothing to scan."])
    expect(cells('global-heading')).toEqual(['Global resources (not a region)'])
    expect(cells('cloudfront')).toEqual(['CloudFront · 2 distributions', '2', 'Complete', expect.stringMatching(/^today, 10:20 AM/), '—'])
    expect(legend()).toEqual([
      'Complete: the last scan of this region finished with nothing missed',
      "Not enabled: an opt-in region this account hasn't enabled; nothing to scan",
    ])
    expect(text(document.querySelector('[data-line="footer-0"]'))).toBe('S3 and CloudFront are checked on every scan.')
    expect(document.querySelector('[data-line="footer-1"]')).toBeNull()
    expect(notes()).toEqual([])
  })

  it('the five summary cards sit above Region coverage, then attention, services, ownership, resources, not checked', async () => {
    const { container } = await show(tab1())
    const order = ['Summary', 'Region coverage', 'What needs attention', 'Your services', 'resources have no owner tag', 'All resources']
    const positions = order.map((name) => {
      const el = name === 'Summary' ? screen.getByRole('region', { name }) : screen.getByRole('heading', { name: new RegExp(name) })
      return [...container.querySelectorAll('*')].indexOf(el)
    })
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    const all = [...container.querySelectorAll('*')]
    expect(all.indexOf(notChecked())).toBeGreaterThan(positions[positions.length - 1])
    expect(all.indexOf(screen.getByTestId('services-scan-line'))).toBeLessThan(positions[0])
  })

  it('tiles: attention scope, Resources from /stats total with S21, Services and spend without Coming soon', async () => {
    await show(tab1())
    const tiles = screen.getByRole('region', { name: 'Summary' })
    expect(text(within(tiles).getByTestId('attention-scope'))).toBe('in 2 regions, plus 1 global (CloudFront)')
    const resources = within(tiles).getByRole('heading', { name: 'Resources' }).parentElement!
    expect(text(resources)).toBe('Resources9in 3 regions, plus 2 global (CloudFront)')
    expect(text(within(tiles).getByRole('heading', { name: 'Services' }).parentElement!)).toBe('Services0registered')
    expect(text(within(tiles).getByRole('heading', { name: 'AWS spend, month to date' }).parentElement!)).toMatch(/whole account · billed, from Cost Explorer/)
    expect(text(tiles)).not.toMatch(/Coming soon|per service/)
  })

  // In-app polish: label only. The count, the line under it and Show them are unchanged.
  it('the Unowned tile is labelled "No owner tag", with the same count, caption and Show them', async () => {
    await show(tab1())
    const tiles = screen.getByRole('region', { name: 'Summary' })
    expect(within(tiles).queryByRole('heading', { name: 'Unowned' })).toBeNull()
    const tile = within(tiles).getByRole('heading', { level: 2, name: 'No owner tag' }).parentElement!
    expect(text(tile)).toBe('No owner tag3' + '43% of resources whose tags we could read have neither an Owner nor a Team tag · Show them')
    expect(within(tile).getByRole('button', { name: 'Show them' })).toBeInTheDocument()
  })

  it('green banner after Scan now (scan.id = jobId), muted counts; dismiss returns focus to Scan now', async () => {
    const c = tab1()
    await show(c)
    expect(screen.queryByTestId('scan-banner')).toBeNull()
    await scanNow({ jobId: c.multi_region.scan.id })
    const banner = await screen.findByTestId('scan-banner')
    expect(banner).toHaveAttribute('data-tone', 'success')
    expect(banner).toHaveAttribute('role', 'status')
    expect(text(banner.querySelector('p'))).toBe('Scan finished · 5 of 5 regions checked · 4 new · 12 updated')
    expect(text(banner.querySelector('p > span'))).toBe('· 4 new · 12 updated')
    fireEvent.click(within(banner).getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByTestId('scan-banner')).toBeNull()
    expect(screen.getByRole('button', { name: 'Scan now' })).toHaveFocus()
  })

  it('attention heading S7, the Unknown tooltip, All resources "{n} resources", What we didn\'t check (option b)', async () => {
    await show(tab1())
    expect(text(screen.getByTestId('attention-count'))).toBe('3 resources need attention')
    const list = screen.getByRole('heading', { name: 'All resources' }).parentElement!
    expect(text(list)).toMatch(/^All resources9 resources/)
    expect(text(list)).not.toMatch(/in us-east-1|plus S3/)
    expect(text(notChecked().querySelector('summary'))).toBe("Not checked: IAM · CloudFront tags · 2 resources' tags · other resource types. Details")
    expect([...notChecked().querySelectorAll('li')].map((li) => li.getAttribute('data-line'))).toEqual(['iam', 'cloudfront-tags', 'tags-unknown', 'types'])
    expect(text(notChecked().querySelector('p'))).toBe('So nothing on this page looks more complete than it is.')
  })
})

// ── Tab 2 ──

describe('tab 2: scan in progress', () => {
  it('header, disabled Scanning… with S41, organising line, N1, rows, tile V2-21, no banner', async () => {
    const mr = docExample('in_progress')
    await show(flaggedCoverage(mr))
    expect(headerLine()).toBe('Scan in progress since 10:00 AM · 1 of 4 regions done')
    const button = screen.getByRole('button', { name: 'Scanning…' })
    expect(button).toBeDisabled()
    expect(button).toHaveAccessibleDescription('A scan is already running for this AWS account.')
    expect(screen.getByText('A scan is already running for this AWS account.')).toBeVisible()
    expect(orgLine()).toBe('Scanning: 1 of 4 regions checked so far · 1 with resources · 3 still running or waiting')
    expect(notes()).toEqual([['progress', 'Counts for the 3 regions still running or waiting come from the scan that finished today, 4:20 AM (Sunday, November 15, 2026 at 4:20:00 AM UTC), and may change when this scan finishes.']])
    expect(rowKeys()).toEqual(['region-us-east-1', 'region-eu-west-1', 'waiting', 'region-us-west-2'])
    expect(cells('region-eu-west-1')).toEqual(['eu-west-1', '2from an earlier scan', 'Scanning', expect.stringMatching(/^today, 4:03 AM/), 'Results shown are from the last scan that finished.'])
    expect(cells('waiting')).toEqual(['1 region waitingShow regionsap-south-1', '0from an earlier scan', 'Waiting', expect.stringMatching(/^today, 4:03 AM/), 'Queued in this scan. Earlier results shown.'])
    expect(cells('region-us-west-2')).toEqual(['us-west-2', '—never scanned', 'Waiting', '—', "Queued in this scan. It hasn't been scanned before."])
    expect(legend().map((l) => l.split(':')[0])).toEqual(['Complete', 'Scanning', 'Waiting'])
    expect(text(screen.getByTestId('resources-earlier'))).toBe('2 from an earlier scan; may change when the scan finishes')
    expect(screen.queryByTestId('scan-banner')).toBeNull()
  })

  it('no banner while a scan runs, even right after Scan now', async () => {
    const before = tab1()
    await show(before)
    const running = flaggedCoverage(docExample('in_progress'))
    await act(async () => {
      mockGetCoverage.mockResolvedValue(running)
      mockDiscover.mockResolvedValue({ message: 'x', warnings: [], errors: [], discovered: 1, updated: 1, jobId: running.multi_region.scan.id })
      fireEvent.click(screen.getByRole('button', { name: 'Scan now' }))
    })
    await screen.findByRole('button', { name: 'Scanning…' })
    await waitFor(() => expect(orgLine()).toMatch(/^Scanning: /))
    expect(screen.queryByTestId('scan-banner')).toBeNull()
  })
})

// ── Tab 3 ──

describe('tab 3: regions not checked', () => {
  it('as drawn: throttled ap-south-1 with its earlier 31, partial eu-west-1 (raising region), amber banner', async () => {
    const c = tab3Throttled()
    await show(c)
    expect(orgLine()).toBe('2 of 3 regions checked · 2 with resources · 1 not checked')
    expect(notes()).toEqual([['region-ap-south-1', "AWS was busy and slowed our requests in ap-south-1, so it couldn't be checked on the last scan. Try again with Scan now. The 31 resources found there earlier stay listed until a complete scan."]])
    expect(cells('region-ap-south-1')).toEqual(['ap-south-1', '31from an earlier scan', "Couldn't check: AWS was busy", expect.stringMatching(/^yesterday, 10:12 PM/), 'AWS was busy. Try again with Scan now.'])
    expect(cells('region-eu-west-1')).toEqual(['eu-west-1', '96', 'Partial', expect.stringMatching(/^today, 10:03 AM/), "Resource Explorer isn't turned on in eu-west-1, so some resource types (such as ECS, VPC and DynamoDB) weren't listed. Everything else was checked."])
    expect(legend().map((l) => l.split(':')[0])).toEqual(['Complete', 'Partial', "Couldn't check"])
    expect(text(screen.getByTestId('resources-earlier'))).toBe('31 from an earlier scan')
    await scanNow({ jobId: c.multi_region.scan.id })
    const banner = await screen.findByTestId('scan-banner')
    expect(banner).toHaveAttribute('data-tone', 'warning')
    expect(text(banner.querySelector('p'))).toBe("Scan finished · 2 of 3 regions checked · ap-south-1 couldn't be checked · 4 new · 12 updated")
    expect(text(notChecked().querySelector('summary'))).toBe("Not checked: ap-south-1 on the last scan · IAM · CloudFront tags · 3 resources' tags · other resource types. Details")
    expect(text(notChecked().querySelector('[data-line="region-ap-south-1"]'))).toBe("ap-south-1 couldn't be checked on the last scan (AWS was busy).")
  })

  it('doc regional_failure: SCP denial, denial with an earlier success, not ready (opt-in); "3 regions couldn\'t be checked"', async () => {
    const c = flaggedCoverage(docExample('regional_failure'))
    await show(c)
    expect(orgLine()).toBe('1 of 4 regions checked · 1 with resources · 3 not checked')
    expect(cells('region-ap-south-1')).toEqual(['ap-south-1', '3from an earlier scan', "Couldn't check: access denied", expect.stringMatching(/^yesterday, 4:00 AM/), 'AWS refused our read role. Earlier results stay listed.'])
    expect(cells('region-eu-west-1')).toEqual(['eu-west-1', '—', "Couldn't check: blocked by a policy", '—', 'An organization policy may block access. Earlier results stay listed.'])
    expect(cells('region-me-central-1')).toEqual(['me-central-1 · opt-in, enabled', '—', 'Not ready yet', '—', "AWS isn't ready here yet. The next scan tries again."])
    expect(notes().map(([k]) => k)).toEqual(['region-ap-south-1', 'region-eu-west-1', 'region-me-central-1'])
    expect(legend().map((l) => l.split(':')[0])).toEqual(['Complete', "Couldn't check", 'Not ready / not reached / not finished'])
    await scanNow({ jobId: c.multi_region.scan.id })
    expect(text((await screen.findByTestId('scan-banner')).querySelector('p'))).toBe("Scan finished · 1 of 4 regions checked · 3 regions couldn't be checked · 4 new · 12 updated")
  })
})

// ── Tab 4 ──

describe('tab 4: opt-in regions', () => {
  it('"opt-in, enabled", the closed not-enabled group (S33b when open), S20 footer', async () => {
    await show(flaggedCoverage(docExample('not_enabled')))
    expect(orgLine()).toBe('2 of 2 regions checked · 2 with resources')
    expect(cells('region-me-central-1')[0]).toBe('me-central-1 · opt-in, enabled')
    const group = table().querySelector('tr[data-row="not-enabled"]')!
    expect(cells('not-enabled')).toEqual(['Not enabled in this account (3)Show regionsaf-south-1ap-east-1me-south-1', '—', 'Not enabled', '—', "Opt-in regions this account hasn't enabled. Nothing to scan."])
    const details = group.querySelector('details')!
    expect(details.open).toBe(false)
    await act(async () => { details.open = true; details.dispatchEvent(new Event('toggle')) })
    expect(cells('not-enabled')).toEqual(['Not enabled in this account (3)Hide regionsaf-south-1ap-east-1me-south-1', '—', 'Not enabled', '—', "Opt-in regions this account hasn't enabled. Nothing to scan.If you enable one in AWS, the next scan includes it."])
    expect(within(group as HTMLElement).getByRole('list', { name: 'Regions not enabled' })).toBeInTheDocument()
    expect(text(document.querySelector('[data-line="footer-1"]'))).toMatch(/^The region list was last read today, 10:00 AM/)
  })
})

// ── Tab 5 ──

describe('tab 5: single-region account (multi-region off for the organization)', () => {
  it('S1 from home_only_coverage, the not-scanned group with S3, not enabled from G7, flag-off footer and captions', async () => {
    await show(tab5())
    expect(headerLine()).toBe('Last scan finished today, 10:20 AM')
    expect(orgLine()).toBe('1 of 4 regions checked · us-east-1')
    expect(homeLine()).toBe('Cost savings, Operational Health and Security Hub run in your home region, us-east-1, only.')
    expect(rowKeys()).toEqual(['region-us-east-1', 'not-scanned', 'not-enabled', 'global-heading', 'cloudfront'])
    expect(cells('region-us-east-1')).toEqual(['us-east-1Home', '9', 'Complete', expect.stringMatching(/^today, 10:20 AM/), '—'])
    expect(cells('not-scanned')).toEqual(['3 regions not scanned yetShow regionsap-south-1eu-west-1us-west-2', '—3 S3 buckets listed', 'Not scanned yet', '—', "Not scanned yet. Resources here, other than S3 buckets, aren't in any count."])
    expect(cells('not-enabled')[0]).toBe('Not enabled in this account (1)Show regionsap-east-1')
    expect(text(document.querySelector('[data-line="footer-0"]'))).toBe('S3 and CloudFront are checked in every region on each scan: 3 S3 buckets outside us-east-1.')
    expect(legend().map((l) => l.split(':')[0])).toEqual(['Complete', 'Not scanned yet', 'Not enabled'])
    const tiles = screen.getByRole('region', { name: 'Summary' })
    expect(text(within(tiles).getByRole('heading', { name: 'Resources' }).parentElement!)).toBe('Resources14in us-east-1, plus S3 in every region and CloudFront')
    expect(text(screen.getByRole('heading', { name: 'All resources' }).parentElement!)).toMatch(/^All resources14 resources in us-east-1, plus S3 in every region and CloudFront/)
    expect(text(notChecked().querySelector('summary'))).toBe("Not checked: other enabled regions (S3 only) · IAM · CloudFront tags · 2 resources' tags · other resource types. Details")
    expect(document.body.textContent).not.toMatch(/with resources|empty ·|partly checked|from an earlier scan/)
  })

  it('green banner from the home-only N of M; amber "· {home} couldn\'t be checked" when the home region failed', async () => {
    await show(tab5())
    await scanNow({ jobId: null, discovered: 1, updated: 2 })
    let banner = await screen.findByTestId('scan-banner')
    expect(banner).toHaveAttribute('data-tone', 'success')
    expect(text(banner.querySelector('p'))).toBe('Scan finished · 1 of 4 regions checked · 1 new · 2 updated')
    await scanNow({ jobId: null, discovered: 0, updated: 0 }, tab5('failed'))
    await waitFor(() => expect(screen.getByTestId('scan-banner')).toHaveAttribute('data-tone', 'warning'))
    banner = screen.getByTestId('scan-banner')
    expect(text(banner.querySelector('p'))).toBe("Scan finished · 0 of 4 regions checked · us-east-1 couldn't be checked · 0 new · 0 updated")
    expect(orgLine()).toBe("0 of 4 regions checked · us-east-1 couldn't be checked")
    expect(cells('region-us-east-1')).toEqual(['us-east-1Home', '9from an earlier scan', "Couldn't check: scan error", expect.stringMatching(/^yesterday, 10:20 AM/), 'The scan ran into an error. Try again with Scan now.'])
  })
})

describe('tab 5: an unflagged organization whose home region moved (3c draws the former home)', () => {
  it('"N of M" is home_only_coverage only: the former home\'s old ok never counts as checked', async () => {
    const c = tab5()
    c.account.home_region = 'us-west-2'
    c.scope.home_region = { region: 'us-west-2', count: 0 }
    c.region_status = [
      { region: 'us-west-2', home: true, status: 'never_scanned', last_scan_finished_at: null, last_success_at: null, last_error_code: null, consecutive_failures: 0, stale: false },
      { ...c.region_status[0], home: false },
      ...c.region_status.slice(1).filter((r: any) => r.region !== 'us-west-2'),
    ]
    c.home_only_coverage = { regions_total: 4, regions_checked: 0 }
    await show(c)
    expect(orgLine()).toBe('0 of 4 regions checked · us-west-2')
    expect(homeLine()).toBe('Cost savings, Operational Health and Security Hub run in your home region, us-west-2, only.')
    expect(cells('region-us-west-2')).toEqual(['us-west-2Home', '—', 'Not scanned yet', '—', '—'])
    expect(cells('region-us-east-1')).toEqual(['us-east-1', '9from an earlier scan', 'Complete', expect.stringMatching(/^today, 10:20 AM/), '—'])
  })
})

// ── Tab 6 ──

describe('tab 6: "1 of 1"', () => {
  it('singular wording, zero segments left out, S21b, no not-enabled group', async () => {
    const c = flaggedCoverage(docExample('single_region'), { cloudfront: 2 })
    await show(c)
    expect(orgLine()).toBe('1 of 1 region checked · 1 with resources')
    expect(rowKeys()).toEqual(['region-eu-west-1', 'global-heading', 'cloudfront'])
    expect(homeLine()).toBe('Cost savings, Operational Health and Security Hub run in your home region, eu-west-1, only.')
    const tiles = screen.getByRole('region', { name: 'Summary' })
    expect(text(within(tiles).getByRole('heading', { name: 'Resources' }).parentElement!)).toBe('Resources5in eu-west-1, plus 2 global (CloudFront)')
    await scanNow({ jobId: c.multi_region.scan.id, discovered: 0, updated: 3 })
    expect(text((await screen.findByTestId('scan-banner')).querySelector('p'))).toBe('Scan finished · 1 of 1 region checked · 0 new · 3 updated')
  })
})

// ── Tab 7 ──

describe('tab 7: home region eu-central-1', () => {
  it('home first with the badge, from the data; us-east-1 is just another (empty) region', async () => {
    await show(flaggedCoverage(docExample('home_not_us_east_1')))
    expect(rowKeys()).toEqual(['region-eu-central-1', 'empty'])
    expect(cells('region-eu-central-1')[0]).toBe('eu-central-1Home')
    expect(cells('empty')[0]).toBe('1 region checked · no resourcesShow regionsus-east-1')
    expect(homeLine()).toBe('Cost savings, Operational Health and Security Hub run in your home region, eu-central-1, only.')
    expect(orgLine()).toBe('2 of 2 regions checked · 1 with resources · 1 empty')
  })
})

// ── Tab 8 ──

describe('tab 8: the latest scan failed', () => {
  it('"didn\'t finish" header, red-dot organising line, S17, red banner, "the last scan didn\'t finish"', async () => {
    const c = flaggedCoverage(docExample('latest_scan_failed'))
    await show(c)
    expect(headerLine()).toBe("Last scan: today, 10:21 AM · didn't finish")
    expect(screen.getByTestId('services-scan-line')).toHaveAttribute('data-state', 'failed')
    expect(orgLine()).toBe('Last scan failed after checking 1 of 2 regions · 1 with resources')
    expect(screen.getByTestId('organising-line')).toHaveAttribute('data-failed', 'true')
    expect(screen.getByTestId('organising-line').querySelector('[aria-hidden="true"]')).not.toBeNull()
    expect(notes()).toEqual([['latest-failed', "The most recent scan attempt, at today, 10:21 AM (Sunday, November 15, 2026 at 10:21:00 AM UTC), didn't finish. Region results below are from the last check of each region; other results are from the scan that finished at today, 4:20 AM (Sunday, November 15, 2026 at 4:20:00 AM UTC)."]])
    expect(cells('region-eu-west-1')).toEqual(['eu-west-1', '2', 'Complete', expect.stringMatching(/^today, 4:03 AM/), '—'])
    await scanNow({ jobId: c.multi_region.scan.id })
    const banner = await screen.findByTestId('scan-banner')
    expect(banner).toHaveAttribute('data-tone', 'danger')
    expect(text(banner.querySelector('p'))).toBe('Scan failed · it checked 1 of 2 regions, then stopped before finishing · try Scan now again')
    expect(text(notChecked().querySelector('summary'))).toMatch(/^Not checked: the last scan didn't finish · IAM/)
    expect(text(notChecked().querySelector('[data-line="last-scan-failed"]'))).toBe('The last scan did not finish cleanly; some counts may be from an earlier scan.')
  })

  it('RR-L2: every region checked, then failed: never "N of N regions checked" without the failure', async () => {
    const mr = docExample('latest_scan_failed')
    mr.regions[1].result_of = 'latest_scan'
    Object.assign(mr.scan, { regions_checked: 2, regions_with_resources: 2 })
    const c = flaggedCoverage(mr)
    await show(c)
    expect(orgLine()).toBe('Last scan failed after checking 2 of 2 regions · 2 with resources')
    await scanNow({ jobId: c.multi_region.scan.id })
    expect(text((await screen.findByTestId('scan-banner')).querySelector('p'))).toBe('Scan failed · it checked 2 of 2 regions, then stopped before finishing · try Scan now again')
    expect(document.body.textContent).not.toMatch(/2 of 2 regions? checked/)
  })
})

// ── Tab 13 ──

describe('tab 13: warning and failure texts', () => {
  const CODES: [string, string, string, string, string, string][] = [
    // [region, state, error_code, label, short details, note]
    ['ap-east-2', 'denied', 'access_denied', "Couldn't check: access denied", 'AWS refused our read role. Earlier results stay listed.', 'AWS refused our read role in ap-east-2. Resources found there earlier stay listed until a complete scan.'],
    ['ap-south-1', 'denied', 'access_denied_scp', "Couldn't check: blocked by a policy", 'An organization policy may block access. Earlier results stay listed.', 'AWS denied access to ap-south-1 (an organization policy may block it). Resources found there earlier stay listed.'],
    ['ca-central-1', 'failed', 'throttled', "Couldn't check: AWS was busy", 'AWS was busy. Try again with Scan now.', "AWS was busy and slowed our requests in ca-central-1, so it couldn't be checked on the last scan. Try again with Scan now."],
    ['eu-north-1', 'failed', 'call_timeout', "Couldn't check: AWS didn't respond", "AWS didn't respond in time. Try again with Scan now.", "AWS didn't respond in time in eu-north-1. Try again with Scan now. Resources found there earlier stay listed."],
    ['eu-south-1', 'failed', 'error', "Couldn't check: scan error", 'The scan ran into an error. Try again with Scan now.', 'The scan ran into an error in eu-south-1. Try again with Scan now. If it keeps happening, contact support.'],
    ['eu-west-2', 'not_ready', 'region_not_ready', 'Not ready yet', "AWS isn't ready here yet. The next scan tries again.", "eu-west-2 is enabled, but AWS isn't ready to answer there yet. The next scan tries again."],
    ['eu-west-3', 'not_checked_deadline', 'region_deadline', 'Not finished: time limit', 'Took longer than the time limit. The next scan tries again.', "eu-west-3 took longer than the time limit for one region, so it wasn't finished. The next scan tries again. Resources found there earlier stay listed."],
    ['sa-east-1', 'not_checked_budget', 'scan_budget', 'Not reached', 'The scan ran out of time before this region. The next scan tries again.', 'The scan reached its overall time limit before it got to sa-east-1. The next scan tries again.'],
  ]
  const REASONS = [
    "ap-east-2 couldn't be checked on the last scan (access denied).",
    "ap-south-1 couldn't be checked on the last scan (blocked by a policy).",
    "ca-central-1 couldn't be checked on the last scan (AWS was busy).",
    "eu-north-1 couldn't be checked on the last scan (AWS didn't respond).",
    "eu-south-1 couldn't be checked on the last scan (scan error).",
    "eu-west-2 wasn't checked on the last scan (AWS wasn't ready there yet).",
    "eu-west-3 wasn't finished on the last scan (time limit for one region).",
    "sa-east-1 wasn't reached on the last scan (the scan ran out of time).",
  ]
  const PARTIAL: [string, string, string][] = [
    ['us-east-2', 'resource_explorer_no_view', "Resource Explorer has no default view in us-east-2, so some resource types (such as ECS, VPC and DynamoDB) weren't listed. Everything else was checked."],
    ['us-west-1', 'discovery_listing_truncated', 'us-west-1 was only partly scanned: some listings stopped at their page limit, so some resources there may be missing and deleted ones may still be listed until a complete scan.'],
    ['us-west-2', 'deletion_detection_paused_truncated_index', 'us-west-2 was only partly scanned: its resource index has more than 1,000 items, so some resources there may be missing and deleted ones may still be listed until a complete scan.'],
  ]
  const codes = tab13
  it('the text table covers exactly the fixture\'s regions', () => {
    expect(CODES.map(([r, state, code]) => [r, state, code])).toEqual(TAB13_FAILED)
    expect(PARTIAL.map(([r, code]) => [r, code])).toEqual(TAB13_PARTIAL)
  })

  it.each(CODES)('%s %s/%s: label, short Details, note, reason line', async (region, _state, _code, label, short, note) => {
    await show(codes())
    expect(cells(`region-${region}`)).toEqual([region, '—', label, '—', short])
    expect(notes()).toContainEqual([`region-${region}`, note])
  })

  it('every reason line, in region order, in What we didn\'t check; the partial texts name their own region', async () => {
    await show(codes())
    const lines = [...notChecked().querySelectorAll('li')].map((li) => text(li))
    expect(lines.slice(0, 8)).toEqual(REASONS)
    for (const [region, , details] of PARTIAL) expect(cells(`region-${region}`)).toEqual([region, '2', 'Partial', expect.stringMatching(/^today/), details])
    expect(orgLine()).toBe('4 of 12 regions checked · 4 with resources · 8 not checked')
  })

  it('V2-37 for scan_deadline; V2-38 only when region_warnings_unattributed is non-empty', async () => {
    await show(codes())
    expect(notes()).toContainEqual(['scan-deadline', "The scan reached its time limit after checking the regions, so some later checks (IAM security, compliance, unused-resource and cost-savings checks) didn't run or didn't finish. Region results are kept; the next scan runs them again."])
    expect(notes().map(([k]) => k)).not.toContain('unattributed')
  })

  it('doc unattributed_warning: V2-38, and "partly checked" for the zero-resource partial region', async () => {
    await show(flaggedCoverage(docExample('unattributed_warning')))
    expect(notes()).toEqual([['unattributed', "Resource Explorer wasn't available in at least one region on the last scan, so some resource types may be missing there."]])
    expect(orgLine()).toBe('3 of 3 regions checked · 2 with resources · 1 partly checked')
    expect(cells('region-ap-south-1')).toEqual(['ap-south-1', '0', 'Partial', expect.stringMatching(/^today/), "Resource Explorer has no default view in ap-south-1, so some resource types (such as ECS, VPC and DynamoDB) weren't listed. Everything else was checked."])
  })
})

// ── Tab 14 ──

describe('tab 14: Coming soon, ownership, the Unknown tooltip', () => {
  it('one Coming soon line (exact), no disabled fake buttons, + Add Service once, team bars neutral', async () => {
    await show(tab1())
    expect(document.body.textContent!.match(/Coming soon/g)).toHaveLength(1)
    expect(text(screen.getByTestId('coming-soon-line'))).toBe('Coming soon: service mapping and owner assignment. Map resources to services and assign owners to see findings, cost, spend and deploys per service.')
    for (const name of [/Assign owner/, /Map resources to services/, /^Service$/, /Group by/]) expect(screen.queryByRole('button', { name })).toBeNull()
    expect(screen.queryByRole('group', { name: 'Group by' })).toBeNull()
    expect(screen.getAllByText('Add Service')).toHaveLength(1)
    expect(screen.queryByText(/Auto Discover|Discovery complete|Region coverage →/)).toBeNull()
    const own = screen.getByRole('heading', { name: '3 resources have no owner tag' }).closest('section')!
    expect(text(own)).toMatch(/They have neither an Owner nor a Team tag, so nobody is on the hook for them\. A resource with only a Team tag counts as owned by that team\./)
    const fills = [...own.querySelectorAll('ul[aria-label="Resources per team"] [aria-hidden="true"], ul[aria-label="Resources per team"] [aria-hidden="true"] > div')].map((el) => el.className)
    expect(fills.length).toBeGreaterThan(0)
    for (const cls of fills) expect(cls).not.toMatch(/violet/)
  })

  // In-app polish (founder rulings 2026-11-24): the redesign names the metric "No owner tag" everywhere; labels only.
  it('"No owner tag" names the metric: Show filter, card heading and bar, row chips, details, not-checked line', async () => {
    await show(tab1())
    expect(document.body.textContent).not.toMatch(/Unowned|unowned/)
    // Show filter: the label changes, the value and the /stats count do not.
    const list = screen.getByRole('heading', { name: 'All resources' }).closest('section')!
    const select = within(list).getByLabelText('Show') as HTMLSelectElement
    const option = [...select.options].find((o) => o.value === 'unowned')!
    expect(option.text).toBe('No owner tag (3)')
    // Card: heading with the count, the same explanation, and the bar row named like the tile.
    const own = screen.getByRole('heading', { name: '3 resources have no owner tag' }).closest('section')!
    expect(within(own).getByRole('list', { name: 'Resources per team' }).lastElementChild).toHaveTextContent(/^No owner tag3$/)
    expect(within(own).getByRole('button', { name: 'Show the 3' })).toBeInTheDocument()
    // Row chips in All resources and in What needs attention, same orange chip.
    const chips = within(list).getAllByText('No owner tag')
    expect(chips).toHaveLength(3)
    for (const chip of chips) expect(chip).toHaveClass('bg-orange-50', 'text-orange-900')
    // The expanded row says the same.
    const unownedRow = chips[0].closest('tr')!
    fireEvent.click(within(unownedRow).getByRole('button', { name: /View details/ }))
    const details = unownedRow.nextElementSibling!
    const field = (term: string) => [...details.querySelectorAll('dt')].find((dt) => dt.textContent === term)!.nextElementSibling!.textContent
    expect(field('Owner')).toBe('No owner tag')
    expect(field('Ownership')).toBe('No owner tag')
    // The not-checked line names the label in quotes; the rest of the sentence is unchanged.
    const line = notChecked().querySelector('li[data-line="tags-unknown"]')!
    expect(text(line)).toBe("2 resources: tags couldn't be read, so their owner is unknown, not missing. They are not counted under \"No owner tag\". By type: CloudFront 2.")
  })

  it('Unknown · tags unreadable explains itself on focus, hover and tap; Escape closes; Unowned is plain', async () => {
    await show(tab1())
    const attention = screen.getByRole('heading', { name: 'What needs attention' }).closest('section')!
    const tip = within(attention).getAllByRole('button', { name: /Unknown · tags unreadable/ })[0]
    expect(tip).toHaveAccessibleDescription("We couldn't read this resource's tags, so we don't know who owns it. \"No owner tag\" is different: we read the tags and found neither an Owner nor a Team tag.")
    const body = document.getElementById(tip.getAttribute('aria-describedby')!)!
    expect(body).toHaveAttribute('role', 'tooltip')
    expect(body).toHaveAttribute('data-open', 'false')
    fireEvent.focus(tip)
    expect(body).toHaveAttribute('data-open', 'true')
    fireEvent.keyDown(tip, { key: 'Escape' })
    expect(body).toHaveAttribute('data-open', 'false')
    fireEvent.mouseEnter(tip.parentElement!)
    expect(body).toHaveAttribute('data-open', 'true')
    fireEvent.mouseLeave(tip.parentElement!)
    fireEvent.click(tip)
    expect(body).toHaveAttribute('data-open', 'true')
    const list = screen.getByRole('heading', { name: 'All resources' }).closest('section')!
    // One per CloudFront distribution: their tags are the unreadable ones (/stats ownership.unknown = 2).
    expect(within(list).getAllByRole('button', { name: /Unknown · tags unreadable/ })).toHaveLength(2)
  })
})

// ── Rules across states ──

describe('reconciliation and truth rules', () => {
  it('with + empty + partly = checked; checked + not checked (+ running/waiting) = total; CloudFront outside the total', async () => {
    const cases = [tab1(), tab3Throttled(), flaggedCoverage(docExample('empty_regions'), { cloudfront: 3 }), flaggedCoverage(docExample('in_progress'), { cloudfront: 1 }), flaggedCoverage(docExample('budget_incomplete'))]
    for (const c of cases) {
      const { unmount } = await show(c)
      const line = orgLine()
      const n = (re: RegExp) => Number(line.match(re)?.[1] ?? 0)
      const [, checked, total] = line.match(/(\d+) of (\d+) regions? checked/)!.map(Number)
      expect(n(/(\d+) with resources/) + n(/(\d+) empty/) + n(/(\d+) partly checked/)).toBe(checked)
      expect(checked + n(/(\d+) not checked/) + n(/(\d+) still running or waiting/)).toBe(total)
      expect(total).toBe(c.multi_region.scan.regions_total)
      if (c.scope.cloudfront.count > 0) expect(rowKeys().slice(-2)).toEqual(['global-heading', 'cloudfront'])
      unmount()
    }
  })

  it('DELIBERATE MISMATCH (N9 control, not a state fixture): the Resources tile is /stats total, never the column summed (RR-L3: a partial-then-failed region reads —)', async () => {
    const mr = docExample('all_checked')
    mr.coverage_status = 'completed_with_regions_not_checked'
    mr.regions[1] = mrRegion('ap-south-1', { status: 'failed', error_code: 'error', state: 'failed', resources: null, resources_from: null, last_success_at: null })
    Object.assign(mr.scan, { regions_checked: 2, regions_with_resources: 2 })
    await show(flaggedCoverage(mr, { cloudfront: 3 }), redesignStats({ total: 41 }))
    expect(cells('region-ap-south-1')[1]).toBe('—')
    const tiles = screen.getByRole('region', { name: 'Summary' })
    expect(text(within(tiles).getByRole('heading', { name: 'Resources' }).parentElement!)).toMatch(/^Resources41in 2 regions, plus 3 global \(CloudFront\)/)
  })

  it('null renders "—", never 0; a 0 only where a successful check (or an earlier one) backs it', async () => {
    await show(flaggedCoverage(docExample('budget_incomplete')))
    expect(cells('region-ap-south-1').slice(1, 3)).toEqual(['—', 'Not reached'])
    expect(cells('region-us-west-2').slice(1, 3)).toEqual(['—', 'Not reached'])
    for (const tr of table().querySelectorAll('tbody > tr')) {
      const key = tr.getAttribute('data-row')
      if (key === 'region-ap-south-1' || key === 'region-us-west-2') expect(text(tr.children[1])).not.toMatch(/^0/)
    }
  })

  it('a banner tone only when the scan described is the one Scan now ran; another scan id shows the muted counts only', async () => {
    const c = tab1()
    await show(c)
    await scanNow({ jobId: 'another-job' })
    const banner = await screen.findByTestId('scan-banner')
    expect(banner).toHaveAttribute('data-tone', 'neutral')
    expect(text(banner.querySelector('p'))).toBe('Scan finished · 4 new · 12 updated')
  })

  it('the phone list carries the same rows, then the global subheading and CloudFront last', async () => {
    await show(tab1())
    const items = [...stacked().children].map((li) => li.getAttribute('data-row'))
    expect(items).toEqual(['region-us-east-1', 'region-ap-south-1', 'region-eu-west-1', 'empty', 'not-enabled', 'global-heading', 'cloudfront'])
    expect(text(stacked().querySelector('[data-row="cloudfront"]'))).toMatch(/^CloudFront · 2 distributionsResources2StatusComplete/)
  })
})

// ── pr3b-review F1: one row set per state ──

/** The leading count of a Resources cell ("31from an earlier scan" → 31); "—" (null) adds nothing. */
const leading = (cell: string) => Number(cell.match(/^([\d,]+)/)?.[1].replace(/,/g, '') ?? 0)
/** An unflagged organization's not-scanned group lists its S3 buckets under the "—". */
const s3Listed = (cell: string) => Number(cell.match(/([\d,]+) S3 buckets? listed/)?.[1].replace(/,/g, '') ?? 0)
const tileValue = () => Number(text(within(screen.getByRole('region', { name: 'Summary' })).getByRole('heading', { name: 'Resources' }).parentElement!).match(/^Resources([\d,]+)/)![1].replace(/,/g, ''))

describe('F1: every state fixture reconciles (one row set: coverage, /stats and the list)', () => {
  it.each(Object.keys(STATE_FIXTURES))('%s: Resources card = region rows + CloudFront; the list total = the card', async (name) => {
    const { scan } = await show(STATE_FIXTURES[name]())
    const tile = tileValue()
    expect(tile).toBe(scan.services.length)
    // The table: every region and group row (group sums included), then the CloudFront row.
    let rows = 0
    for (const tr of table().querySelectorAll('tbody > tr')) {
      if (tr.getAttribute('data-row') === 'global-heading') continue
      const cell = text(tr.children[1])
      rows += leading(cell) + s3Listed(cell)
    }
    expect(rows).toBe(tile)
    // The phone list carries the same numbers.
    let phone = 0
    for (const li of stacked().children) {
      const dd = li.querySelector('dl > dd')
      if (dd) phone += leading(text(dd)) + s3Listed(text(dd))
    }
    expect(phone).toBe(tile)
    // All resources: its heading count and the pager both say the card's number.
    const list = screen.getByRole('heading', { name: 'All resources' }).closest('section')!
    expect(text(list)).toMatch(new RegExp(`^All resources${tile.toLocaleString('en-US')} resources?`))
    await waitFor(() => expect(text(list)).toContain(`Showing 1–${Math.min(50, tile)} of ${tile}`))
  })
})

// ── pr3b-review L-1: result_of = latest_scan ──

describe('L-1: a region that failed in an EARLIER scan is not "not checked" on the latest scan', () => {
  it('latest_scan_failed + ap-south-1 denied earlier: its row keeps the old state, but no note, no reason line, no banner name', async () => {
    const c = tab8EarlierDenied()
    await show(c)
    expect(orgLine()).toBe('Last scan failed after checking 1 of 3 regions · 1 with resources')
    expect(cells('region-ap-south-1').slice(0, 3)).toEqual(['ap-south-1', '3from an earlier scan', "Couldn't check: access denied"])
    expect(notes().map(([k]) => k)).toEqual(['latest-failed'])
    expect(notChecked().querySelector('[data-line="region-ap-south-1"]')).toBeNull()
    expect(text(notChecked())).not.toMatch(/ap-south-1/)
    await scanNow({ jobId: c.multi_region.scan.id })
    const banner = await screen.findByTestId('scan-banner')
    expect(text(banner.querySelector('p'))).toBe('Scan failed · it checked 1 of 3 regions, then stopped before finishing · try Scan now again')
    expect(document.body.textContent).not.toMatch(/ap-south-1 couldn't be checked/)
  })
})

// ── pr3b-review F2: phone rows ──

describe('F2: phone rows show the relative time only; the exact time opens on tap or focus', () => {
  it('no exact time is visible in the stacked list; each time is a button described by its exact time', async () => {
    await show(tab1())
    const list = stacked() as HTMLElement
    const visible = list.cloneNode(true) as Element
    for (const tip of visible.querySelectorAll('[role="tooltip"]')) tip.remove()
    expect(text(visible)).not.toMatch(/2026 at|UTC|November/)
    for (const tip of list.querySelectorAll('[role="tooltip"]')) {
      expect(tip).toHaveAttribute('data-open', 'false')
      expect(tip.className).toMatch(/(?<![\w:-])hidden(?![\w-])/)
    }
    const times = within(list).getAllByRole('button', { name: 'today, 10:03 AM' })
    expect(times.length).toBeGreaterThan(0)
    const time = times[0]
    expect(time).toHaveAccessibleDescription('Sunday, November 15, 2026 at 10:03:00 AM UTC')
    expect(time.querySelector('time')).toHaveAttribute('dateTime', '2026-11-15T10:03:00.000Z')
    const tip = document.getElementById(time.getAttribute('aria-describedby')!)!
    expect(tip).toHaveAttribute('role', 'tooltip')
    fireEvent.click(time)
    expect(tip).toHaveAttribute('data-open', 'true')
    expect(tip.className).toMatch(/(?<![\w:-])block(?![\w-])/)
    fireEvent.keyDown(time, { key: 'Escape' })
    expect(tip).toHaveAttribute('data-open', 'false')
    fireEvent.focus(time)
    expect(tip).toHaveAttribute('data-open', 'true')
    fireEvent.blur(time)
    expect(tip).toHaveAttribute('data-open', 'false')
    fireEvent.mouseEnter(time.parentElement!)
    expect(tip).toHaveAttribute('data-open', 'true')
  })

  it('the desktop table keeps its hover/focus tooltip time (no tap button)', async () => {
    await show(tab1())
    const time = table().querySelector('tr[data-row="region-us-east-1"] time')!
    expect(time.closest('button')).toBeNull()
    expect(time).toHaveAttribute('tabindex', '0')
    expect(text(time)).toBe('today, 10:03 AM (Sunday, November 15, 2026 at 10:03:00 AM UTC)')
  })
})

describe('demo mode', () => {
  it('renders the redesign from the placeholder multi_region block, with no request', async () => {
    demoMode = true
    renderPage()
    await screen.findByTestId('organising-line')
    expect(screen.getByText(/SAMPLE DATA/)).toBeInTheDocument()
    expect(orgLine()).toBe('3 of 3 regions checked · 3 with resources')
    expect(rowKeys()).toEqual(['region-us-east-1', 'region-eu-west-1', 'region-us-west-2', 'global-heading', 'cloudfront'])
    expect(mockGetCoverage).not.toHaveBeenCalled()
    expect(mockGetStats).not.toHaveBeenCalled()
  })
})

// ── Multi-region flag-on prep, item 4 (founder ruling Nov 19, every organization) ──

describe('Scan now busy or cut: never "Failed to load resources."', () => {
  const BUSY = 'A scan is already running for this AWS account. Try again in a few minutes.'
  const reject = (status: number | null, data?: unknown) => Object.assign(new Error('x'), status === null ? { request: {} } : { response: { status, data } })
  it.each([
    ['409 busy', reject(409, { success: false, error: BUSY })],
    ['504 (nginx cut the request)', reject(504)],
    ['no response', reject(null)],
  ] as const)('%s while a scan runs: coverage re-read, the scan in progress shown, Scan now disabled', async (_n, error) => {
    await show(tab1())
    mockGetCoverage.mockResolvedValue(flaggedCoverage(docExample('in_progress')))
    mockDiscover.mockRejectedValue(error)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Scan now' })) })
    await waitFor(() => expect(orgLine()).toMatch(/^Scanning: /))
    expect(screen.getByRole('button', { name: 'Scanning…' })).toBeDisabled()
    expect(screen.queryByText('Failed to load resources.')).toBeNull()
  })
  it('a 504 with no scan running after it keeps the existing error state', async () => {
    await show(tab1())
    mockDiscover.mockRejectedValue(reject(504))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Scan now' })) })
    expect(await screen.findByText('Failed to load resources.')).toBeInTheDocument()
  })
  // Review L-1: the server said busy, but the lease was released before the re-read. The page used to do
  // nothing at all; it shows the server's busy message, and no "in progress" state (the coverage says idle).
  it('a 409 busy with no scan running after the re-read: the busy message, the page stays idle', async () => {
    toastWarning.mockReset()
    await show(tab1())
    const reads = mockGetCoverage.mock.calls.length
    mockDiscover.mockRejectedValue(reject(409, { success: false, error: BUSY }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Scan now' })) })
    await waitFor(() => expect(toastWarning).toHaveBeenCalledWith(BUSY))
    expect(mockGetCoverage.mock.calls.length).toBeGreaterThan(reads)
    expect(screen.getByRole('button', { name: 'Scan now' })).toBeEnabled()
    expect(orgLine()).not.toMatch(/^Scanning/)
    expect(screen.queryByText('Failed to load resources.')).toBeNull()
  })
  // Review L-2: network down. The request got no response and the coverage re-read fails too: nothing
  // says a scan is running, so it is the normal failure, never the busy message.
  it('no response and the coverage re-read fails: the existing error state, never busy', async () => {
    toastWarning.mockReset()
    await show(tab1())
    const reads = mockGetCoverage.mock.calls.length
    mockGetCoverage.mockRejectedValue(reject(null))
    mockDiscover.mockRejectedValue(reject(null))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Scan now' })) })
    expect(await screen.findByText('Failed to load resources.')).toBeInTheDocument()
    expect(mockGetCoverage.mock.calls.length).toBeGreaterThan(reads)
    expect(toastWarning).not.toHaveBeenCalled()
  })
})
