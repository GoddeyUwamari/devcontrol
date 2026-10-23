/**
 * Region coverage on the page (multi-region M6), with NEXT_PUBLIC_SERVICES_V2
 * and NEXT_PUBLIC_SERVICES_COVERAGE_M6 on: the coverage card, the Region
 * coverage panel and its link, Auto Discover while a scan is running, the
 * exact time on hover and keyboard focus, the phone layout, no raw error text
 * anywhere, and the coverage refetch while (and only while) a scan runs.
 */
process.env.TZ = 'UTC'

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { focusManager } from '@tanstack/react-query'
import type { ServicesCoverage } from '@/lib/services/aws-services.service'
import { DELETION_DETECTION_PAUSED_TEXT, DISCOVERY_WARNING_TRUNCATED_INDEX } from '@/components/aws/discovery-warning-notice'
import { billed, emptyPage, OTHER_REGIONS, prodCoverage, region, renderPage, STATS, withoutM5c } from './m6-fixtures'
import { SCAN_RUNNING_REFETCH_MS } from '../ServicesOverview'
import { SCAN_RUNNING_HINT } from '../ServicesHeader'
import { formatWhen } from '../regionCoverage'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/services',
}))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => false }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: (selector: any) => selector({ enabled: false }) }))
vi.mock('@/lib/hooks/use-plan', () => ({ usePlan: () => ({ tier: 'pro', isPro: true }) }))
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ organization: { id: 'org-test', name: 'Org Test' } }) }))
vi.mock('@/lib/hooks/use-current-role', () => ({ useCurrentRole: () => 'owner' }))
vi.mock('@/lib/hooks/use-registered-services', () => ({
  useRegisteredServices: () => ({ isPending: false, isError: false, isSuccess: true, data: [], refetch: vi.fn() }),
}))

const mockGetServices = vi.fn()
const mockGetStats = vi.fn()
const mockGetCoverage = vi.fn()
vi.mock('@/lib/services/aws-services.service', () => ({
  default: {
    getServices: (...args: unknown[]) => mockGetServices(...args),
    getStats: () => mockGetStats(),
    getCoverage: () => mockGetCoverage(),
    discoverServices: vi.fn(),
  },
}))
vi.mock('@/lib/services/aws-accounts.service', () => ({ default: { getAccounts: async () => [{ id: 'acct-1' }] } }))
vi.mock('@/lib/services/platform-stats.service', () => ({ platformStatsService: { getCostSummary: async () => billed() } }))

// A fixed clock on the fixtures' day, so "today" means Oct 22 whatever the
// real date is. Tests that fake timers themselves start from this instant.
const NOW = Date.parse('2026-10-22T15:00:00Z')
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString()

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
  vi.stubEnv('NEXT_PUBLIC_SERVICES_V2', 'true')
  vi.stubEnv('NEXT_PUBLIC_SERVICES_COVERAGE_M6', 'true')
  mockGetServices.mockImplementation(async (req: any = {}) => emptyPage(req.limit ?? 50))
  mockGetStats.mockResolvedValue(STATS)
})
afterEach(() => {
  vi.unstubAllEnvs()
  focusManager.setFocused(undefined)
  vi.useRealTimers()
})

const card = () => screen.getByRole('region', { name: 'Account and scan coverage' })
const panel = () => screen.getByRole('region', { name: 'Region coverage' })
const table = () => panel().querySelector('[data-layout="table"]') as HTMLElement
const stacked = () => panel().querySelector('[data-layout="stacked"]') as HTMLElement

async function show(coverage: ServicesCoverage) {
  mockGetCoverage.mockResolvedValue(coverage)
  const utils = renderPage()
  await screen.findByRole('region', { name: 'Region coverage' })
  return utils
}

describe('R1 the production response of Oct 22', () => {
  it('card: headline, chips, legend, note, and the link to the panel', async () => {
    await show(prodCoverage(NOW))
    const c = card()
    expect(c).toHaveTextContent('1 of 17 enabled regions checked')
    expect(c).toHaveTextContent('· us-east-1 (home), plus S3 in every region and CloudFront (global)')
    const chips = within(within(c).getByRole('list', { name: 'Scanned regions' })).getAllByRole('listitem').map((li) => li.textContent)
    expect(chips).toEqual(['us-east-19 · home · complete', '16 other regionsnot scanned yet'])
    expect([...within(c).getByLabelText('Region states').querySelectorAll('span')].map((s) => s.textContent)).toEqual([
      'Complete: the last scan of this region finished with nothing missed',
      'Not scanned yet: enabled in this account, not scanned yet',
    ])
    expect(within(c).getAllByRole('note').map((n) => n.textContent)).toEqual([
      "Only us-east-1 is scanned today. The other 16 enabled regions aren't scanned yet, so resources there, other than S3 buckets, don't appear here or in any count. S3 and CloudFront are checked everywhere.",
    ])
    const link = within(c).getByRole('link', { name: 'Region coverage' })
    expect(link).toHaveAttribute('href', '#region-coverage')
    expect(document.getElementById('region-coverage')).toBe(panel())
  })

  it('panel: the table, home first, the 16 regions as one row with every name, and the footer', async () => {
    await show(prodCoverage(NOW))
    const t = within(table()).getByRole('table', { name: 'Scan status of each enabled region' })
    expect(within(t).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Region', 'Status', 'Last full scan', 'Details'])
    const rows = within(t).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByRole('rowheader')).toHaveTextContent('us-east-1home')
    expect(rows[0]).toHaveTextContent('Complete')
    expect(within(rows[1]).getByRole('rowheader')).toHaveTextContent('16 other regions · enabled in this account')
    expect(within(within(rows[1]).getByRole('list', { name: 'Regions not scanned yet' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual(OTHER_REGIONS)
    expect(rows[1]).toHaveTextContent('Not scanned yet—Multi-region scanning is rolling out.')
    expect(panel().querySelector('[data-line="footer"]')).toHaveTextContent('S3 and CloudFront are checked in every region on each scan: 3 S3 buckets found, all in us-east-1; no CloudFront distributions.')
  })
})

describe('R2 Auto Discover while a scan is running', () => {
  const running = () => prodCoverage(NOW, {}, { scan_in_progress: { since: hoursAgo(0.25) }, last_scan: { status: 'running', started_at: hoursAgo(0.25), completed_at: null, warnings: [] } })

  it('disabled, "Scan running…", with a description; the empty-state button too', async () => {
    await show(running())
    // The header button and the "No resources discovered yet" one.
    const [header, empty] = screen.getAllByRole('button', { name: /Scan running…/ })
    expect(header).toBeDisabled()
    expect(header).toHaveAccessibleDescription(SCAN_RUNNING_HINT)
    expect(empty).toBeDisabled()
    expect(screen.queryByRole('button', { name: /Auto Discover/ })).toBeNull()
    expect(card()).toHaveTextContent(/Scan in progress since today, .* · showing results from today, /)
    expect(within(table()).getAllByRole('row')[1]).toHaveTextContent('Scanning')
  })

  it('flag off: the same response leaves Auto Discover enabled', async () => {
    vi.stubEnv('NEXT_PUBLIC_SERVICES_COVERAGE_M6', 'false')
    mockGetCoverage.mockResolvedValue(running())
    renderPage()
    await screen.findByText(/Scan in progress, started/)
    expect(screen.getAllByRole('button', { name: /Auto Discover/ })[0]).toBeEnabled()
    expect(screen.queryByText(/Scan running…/)).toBeNull()
    expect(screen.queryByRole('region', { name: 'Region coverage' })).toBeNull()
  })
})

describe('R3 every state renders in the card and the panel', () => {
  const states: [string, () => ServicesCoverage, RegExp, RegExp][] = [
    ['latest attempt failed', () => prodCoverage(NOW, {}, { last_scan: { status: 'failed', started_at: hoursAgo(1.2), completed_at: hoursAgo(1), warnings: [] } }),
      /The most recent scan attempt, at today, .*, didn't finish\. Results shown are from the scan that finished at today, /, /Complete/],
    ['out of date', () => prodCoverage(NOW, { stale: true, last_scan_finished_at: hoursAgo(20), last_success_at: hoursAgo(20) }),
      /These results may be out of date\. us-east-1 was last scanned .*; scans normally run every 6 hours\./, /Out of date/],
    ['partial', () => prodCoverage(NOW, { status: 'partial', last_error_code: DISCOVERY_WARNING_TRUNCATED_INDEX }),
      /us-east-1 was only partly scanned: its resource index has more than 1,000 items/, /Partial/],
    ['denied', () => prodCoverage(NOW, { status: 'denied' }), /Some resource types in us-east-1 couldn't be checked because of permissions\. Other results may still be available\./, /Couldn't check some types/],
    ['timed out', () => prodCoverage(NOW, { status: 'timed_out' }), /because AWS didn't respond in time/, /Timed out/],
    ['failed', () => prodCoverage(NOW, { status: 'failed' }), /because the scan ran into an error/, /Scan error/],
    ['region list not known', () => ({ ...prodCoverage(NOW), region_status: [], scope: { ...prodCoverage(NOW).scope, enabled_regions: { known: false, count: null, listed_at: null, stale: false } } }),
      /We haven't read this account's region list yet\. It's read during each scan\./, /Not listed yet/],
  ]
  it.each(states)('%s', async (_name, make, note, status) => {
    await show(make())
    expect(card()).toHaveTextContent(note)
    expect(table()).toHaveTextContent(status)
  })

  it('mixed: 3 of 17 checked · 1 with gaps', async () => {
    const others = OTHER_REGIONS.map((r) => r === 'us-west-2' ? region(r, { status: 'ok', last_success_at: hoursAgo(2), last_scan_finished_at: hoursAgo(2) })
      : r === 'eu-west-1' ? region(r, { status: 'denied', last_scan_finished_at: hoursAgo(2) }) : region(r))
    await show(prodCoverage(NOW, {}, {}, others))
    expect(card()).toHaveTextContent('3 of 17 enabled regions checked · 1 with gaps')
    expect(within(table()).getAllByRole('rowheader').map((h) => h.textContent)).toEqual(['us-east-1home', 'eu-west-1', 'us-west-2', expect.stringMatching(/^14 other regions/)])
  })
})

describe('R4 no raw error text and no consecutive_failures in the DOM', () => {
  it('none of it is rendered', async () => {
    const others = OTHER_REGIONS.map((r) => region(r, r === 'eu-west-1'
      ? { status: 'denied', consecutive_failures: 5, last_error_code: 'AccessDenied: arn:aws:iam::123456789012:role/x' }
      : { consecutive_failures: 3 }))
    const c = prodCoverage(NOW, { status: 'failed', consecutive_failures: 9, last_error_code: 'AccessDenied' }, {}, others)
    ;(c.region_status![0] as any).last_error_message = 'User: arn:aws:sts::123456789012:assumed-role/x is not authorized'
    await show(c)
    expect(document.body.textContent).not.toMatch(/consecutive|in a row|AccessDenied|arn:aws|123456789012|not authorized|\b[359] (failures|times)/)
  })
})

const exactOf = (iso: string) => new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeStyle: 'long', timeZone: 'UTC' }).format(Date.parse(iso)).replace(/[\u202f\u00a0]/g, ' ')

describe('R5 times: local, with the exact time on hover and keyboard focus', () => {
  it('keyboard focus opens the tooltip (role=tooltip, not the phone layout\'s printed line)', async () => {
    await show(prodCoverage(NOW))
    const time = within(card()).getByText(/^today, /, { selector: 'time' })
    expect(time).toHaveAttribute('tabindex', '0')
    expect(time).toHaveAttribute('dateTime', hoursAgo(2))
    expect(time).not.toHaveAttribute('title')
    expect(screen.queryByRole('tooltip')).toBeNull()
    await act(async () => { fireEvent.focus(time) })
    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip).toHaveTextContent(exactOf(hoursAgo(2)))
    expect(time.getAttribute('aria-describedby')).toBeTruthy()
  })

  it('the exact time is visually hidden text inside <time>, found by a screen-reader query', async () => {
    await show(prodCoverage(NOW))
    const time = within(card()).getByText(/^today, /, { selector: 'time' })
    expect(time).not.toHaveAttribute('aria-label')
    const hidden = within(time).getByText(`(${exactOf(hoursAgo(2))})`)
    expect(hidden).toHaveClass('sr-only')
    expect(hidden.closest('time')).toBe(time)
    // What a screen reader reads for the element: the visible label, then the exact time.
    expect(time.textContent).toBe(`${formatWhen(hoursAgo(2), Date.now())} (${exactOf(hoursAgo(2))})`)
  })
})

describe('R6 phone width', () => {
  it('the stacked layout prints the exact time under each time', async () => {
    await show(prodCoverage(NOW))
    const list = stacked()
    expect(list.className).toContain('sm:hidden')
    expect(table().className).toContain('hidden sm:block')
    const exact = new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeStyle: 'long', timeZone: 'UTC' }).format(Date.parse(hoursAgo(2))).replace(/[  ]/g, ' ')
    expect(list).toHaveTextContent(exact)
    expect(within(list).getAllByRole('term').map((t) => t.textContent)).toEqual(['Status', 'Last full scan', 'Details', 'Status', 'Last full scan', 'Details'])
  })
})

describe('R9 Q8 in the DOM', () => {
  it('the index truncation is said once in the card, and still in What we didn\'t check', async () => {
    await show(prodCoverage(NOW, { status: 'partial', last_error_code: DISCOVERY_WARNING_TRUNCATED_INDEX }, { last_scan: { status: 'completed', started_at: hoursAgo(2.1), completed_at: hoursAgo(2), warnings: [DISCOVERY_WARNING_TRUNCATED_INDEX] } }))
    expect(within(card()).getAllByRole('note').filter((n) => /1,000/.test(n.textContent ?? ''))).toHaveLength(1)
    expect(card()).not.toHaveTextContent(DELETION_DETECTION_PAUSED_TEXT)
    const notChecked = screen.getByRole('region', { name: "What we didn't check" })
    expect(notChecked).toHaveTextContent(DELETION_DETECTION_PAUSED_TEXT)
  })
})

describe('R10 labels', () => {
  it('card: "Last scan finished"; panel: "Last full scan"', async () => {
    await show(prodCoverage(NOW))
    expect(card()).toHaveTextContent(/Last scan finished today, /)
    expect(card()).not.toHaveTextContent(/Last successful scan/)
    expect(panel()).not.toHaveTextContent(/Last successful scan/)
  })
})

describe('R7 footer', () => {
  it('hidden when S3 and CloudFront were not in the last scan', async () => {
    const c = prodCoverage(NOW)
    c.scope.s3.in_last_scan = false
    c.scope.cloudfront.in_last_scan = false
    await show(c)
    expect(panel().querySelector('[data-line="footer"]')).toBeNull()
    expect(document.body.textContent).not.toMatch(/checked in every region on each scan/)
  })
})

describe('R8 coverage refetch while a scan runs (Q11)', () => {
  const running = () => prodCoverage(NOW, {}, { scan_in_progress: { since: hoursAgo(0.1) }, last_scan: { status: 'running', started_at: hoursAgo(0.1), completed_at: null, warnings: [] } })

  it('every minute while scan_in_progress is set; stops once it clears', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockGetCoverage.mockResolvedValueOnce(running()).mockResolvedValueOnce(running()).mockResolvedValue(prodCoverage(NOW))
    renderPage()
    await screen.findAllByRole('button', { name: /Scan running…/ })
    expect(mockGetCoverage).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(SCAN_RUNNING_REFETCH_MS) })
    expect(mockGetCoverage).toHaveBeenCalledTimes(2)
    await act(async () => { await vi.advanceTimersByTimeAsync(SCAN_RUNNING_REFETCH_MS) })
    expect(mockGetCoverage).toHaveBeenCalledTimes(3)
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Auto Discover/ })[0]).toBeEnabled())
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * SCAN_RUNNING_REFETCH_MS) })
    expect(mockGetCoverage).toHaveBeenCalledTimes(3)
  })

  it('not while the tab is hidden', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockGetCoverage.mockResolvedValue(running())
    renderPage()
    await screen.findAllByRole('button', { name: /Scan running…/ })
    act(() => { focusManager.setFocused(false) })
    await act(async () => { await vi.advanceTimersByTimeAsync(3 * SCAN_RUNNING_REFETCH_MS) })
    expect(mockGetCoverage).toHaveBeenCalledTimes(1)
    act(() => { focusManager.setFocused(true) })
    await act(async () => { await vi.advanceTimersByTimeAsync(SCAN_RUNNING_REFETCH_MS) })
    expect(mockGetCoverage).toHaveBeenCalledTimes(2)
  })

  it('never when no scan is running, and never with the flag off', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockGetCoverage.mockResolvedValue(prodCoverage(NOW))
    const first = renderPage()
    await screen.findByRole('region', { name: 'Region coverage' })
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * SCAN_RUNNING_REFETCH_MS) })
    expect(mockGetCoverage).toHaveBeenCalledTimes(1)
    first.unmount()

    vi.stubEnv('NEXT_PUBLIC_SERVICES_COVERAGE_M6', 'false')
    mockGetCoverage.mockClear()
    mockGetCoverage.mockResolvedValue(running())
    renderPage()
    await screen.findByText(/Scan in progress, started/)
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * SCAN_RUNNING_REFETCH_MS) })
    expect(mockGetCoverage).toHaveBeenCalledTimes(1)
  })

  it('stops after unmount', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockGetCoverage.mockResolvedValue(running())
    const { unmount } = renderPage()
    await screen.findAllByRole('button', { name: /Scan running…/ })
    expect(mockGetCoverage).toHaveBeenCalledTimes(1)
    unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(3 * SCAN_RUNNING_REFETCH_MS) })
    expect(mockGetCoverage).toHaveBeenCalledTimes(1)
  })

  it('an older backend (no M5c keys) is never polled', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockGetCoverage.mockResolvedValue(withoutM5c(running()))
    renderPage()
    await screen.findByText(/Scan in progress, started/)
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * SCAN_RUNNING_REFETCH_MS) })
    expect(mockGetCoverage).toHaveBeenCalledTimes(1)
  })
})

describe('R11 a tab left open past midnight (P2-3)', () => {
  it('"today" becomes "yesterday" after local midnight, with no new request', async () => {
    const start = Date.parse('2026-10-22T23:59:00Z') // TZ is UTC in this file
    vi.useFakeTimers({ shouldAdvanceTime: true, now: start })
    mockGetCoverage.mockResolvedValue(prodCoverage(start)) // finished 2 h before: 9:59 PM
    renderPage()
    await screen.findByRole('region', { name: 'Region coverage' })
    expect(card()).toHaveTextContent('Last scan finished today, 9:59 PM')
    expect(within(table()).getAllByRole('row')[1]).toHaveTextContent('today, 9:59 PM')
    await act(async () => { await vi.advanceTimersByTimeAsync(2 * 60_000) })
    expect(card()).toHaveTextContent('Last scan finished yesterday, 9:59 PM')
    expect(within(table()).getAllByRole('row')[1]).toHaveTextContent('yesterday, 9:59 PM')
    expect(mockGetCoverage).toHaveBeenCalledTimes(1)
    // And again the next night.
    await act(async () => { await vi.advanceTimersByTimeAsync(24 * 3600_000) })
    expect(card()).toHaveTextContent('Last scan finished Oct 22, 2026, 9:59 PM')
    expect(mockGetCoverage).toHaveBeenCalledTimes(1)
  })
})
