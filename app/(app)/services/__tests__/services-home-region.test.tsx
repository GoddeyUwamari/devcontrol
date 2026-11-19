/**
 * The Services home-region UI (multi-region PR 3c, mock v2.1 tabs 9–12), rendered
 * through the real page with the redesign flag on. Every state's coverage,
 * /stats and list come from ONE row set (scanOf). TZ UTC, fixed clock.
 *
 *   tab 9   proposal banner (owner, member, scan running), placement
 *   tab 10  split-spend banner (owner, member, nothing pre-selected, no lead bar,
 *           every other state renders nothing, dismiss 409 NO_OPEN_PROPOSAL)
 *   tab 11  the change dialog: a11y (role, modal, label, focus trap, Escape,
 *           Cancel), options, What changes, every PUT error code, no optimistic
 *           update, success lines, invalidation of the five queries
 *   tab 12  former home (flag off): row, note, tile, attention cell, filter, V2-47
 *   I.4     owner and member: the controls only with can_change_home_region
 *   axe     every new state, the phone list, the open dialog and tooltip
 */
process.env.TZ = 'UTC'

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import axe from 'axe-core'
import ServicesPage from '../page'
import { HomeRegionRequestError } from '@/lib/services/aws-accounts.service'
import { R_NOW, scanOf, tab5, type Scan } from './redesign-fixtures'
import { accountsAnswer, preview, previewFor, proposal, split, splitSeven, tab12Scan } from './home-region-fixtures'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/services',
}))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => false }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: (selector: any) => selector({ enabled: false }) }))
vi.mock('@/lib/hooks/use-plan', () => ({ usePlan: () => ({ tier: 'pro', isPro: true }) }))
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ organization: { id: 'org-test', name: 'Org Test' } }) }))
// The JWT role claim says owner for everyone here: only can_change_home_region (the membership) may decide.
vi.mock('@/lib/hooks/use-current-role', () => ({ useCurrentRole: () => 'owner' }))
vi.mock('@/lib/hooks/use-registered-services', () => ({
  useRegisteredServices: () => ({ isPending: false, isError: false, isSuccess: true, data: [], refetch: vi.fn() }),
}))
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
const mockAccounts = vi.fn()
const mockPreview = vi.fn()
const mockChange = vi.fn()
const mockDismiss = vi.fn()
vi.mock('@/lib/services/aws-accounts.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/aws-accounts.service')>()
  return {
    ...actual,
    default: {
      getAccountsAndConnection: () => mockAccounts(),
      getHomeRegionPreview: (region?: string) => mockPreview(region),
      changeHomeRegion: (region: string) => mockChange(region),
      dismissHomeRegionProposal: () => mockDismiss(),
    },
  }
})
vi.mock('@/lib/services/platform-stats.service', () => ({ platformStatsService: { getCostSummary: async () => { throw new Error('n/a') } } }))

// ── Rendering ──

let client: QueryClient
let invalidate: ReturnType<typeof vi.spyOn>

function serveScan(scan: Scan) {
  mockGetCoverage.mockResolvedValue(scan.coverage)
  mockGetStats.mockResolvedValue(scan.stats)
  mockGetServices.mockImplementation(async (req: any = {}) => scan.list(req))
}

async function show(coverageOrScan: unknown, accounts = accountsAnswer()) {
  const scan = (coverageOrScan as Scan).list ? coverageOrScan as Scan : scanOf(coverageOrScan)
  serveScan(scan)
  mockAccounts.mockResolvedValue(accounts)
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  invalidate = vi.spyOn(client, 'invalidateQueries')
  const view = render(<QueryClientProvider client={client}><ServicesPage /></QueryClientProvider>)
  await screen.findByTestId('organising-line')
  await waitFor(() => expect(screen.queryByText(/Loading/)).toBeNull())
  return Object.assign(view, { scan })
}

const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
const banner = () => screen.queryByTestId('home-region-banner')
const dialog = () => screen.queryByRole('dialog')
const homeLine = () => text(screen.getByTestId('home-line'))
const scopeOf = (container: HTMLElement) => container.querySelector('[data-services-redesign]') as HTMLElement
const FIVE = ['services-aws-accounts', 'services-coverage', 'services-stats', 'services-attention', 'services-list']
const invalidatedKeys = () => invalidate.mock.calls.map((c: any[]) => c[0]?.queryKey?.[0])

/** tab5 with a scan running (coverage.scan_in_progress set). */
function scanning(): Scan {
  const c = tab5()
  c.scan_in_progress = { since: '2026-11-15T16:00:00.000Z' }
  return scanOf(c)
}

/** Defer a promise by hand. */
function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

/** Open the dialog from Change and pick `region`; wait for its preview. */
async function openAndPick(region: string, target = previewFor(region)) {
  mockPreview.mockImplementation(async (r?: string) => (r === undefined ? preview({ multiRegion: target.multi_region }) : r === region ? target : previewFor(r)))
  fireEvent.click(await screen.findByTestId('change-home-region'))
  const d = await screen.findByRole('dialog')
  const select = within(d).getByLabelText('Home region') as HTMLSelectElement
  await waitFor(() => expect(select).toBeEnabled())
  fireEvent.change(select, { target: { value: region } })
  await within(d).findByTestId('what-changes')
  return d
}

if (typeof document.elementFromPoint !== 'function') document.elementFromPoint = () => null
async function axeViolations(context: Element): Promise<string[]> {
  const result = await axe.run(context, { rules: { 'color-contrast': { enabled: false } } })
  const line = (kind: string) => (v: axe.Result) => v.nodes.map((n) => `${kind} ${v.id} (${v.impact}): ${n.target.join(' ')}`)
  return [...result.violations.flatMap(line('violation')), ...result.incomplete.flatMap(line('incomplete'))]
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'], now: R_NOW })
  vi.stubEnv('NEXT_PUBLIC_SERVICES_V2', 'true')
  vi.stubEnv('NEXT_PUBLIC_SERVICES_REDESIGN', 'true')
  vi.stubEnv('NEXT_PUBLIC_SERVICES_COVERAGE_M6', 'false')
})
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers() })

// ── Tab 9 ──

describe('tab 9: proposal banner (flag off)', () => {
  it('owner: title, body, bars, buttons, footnote; neutral surface, the proposal bar led', async () => {
    await show(tab5(), accountsAnswer({ proposal: proposal() }))
    const b = await screen.findByTestId('home-region-banner')
    expect(b.getAttribute('data-kind')).toBe('proposal')
    expect(text(within(b).getByRole('heading'))).toBe('Your AWS costs point to us-west-2 as your home region.')
    expect(b.textContent).toContain("84% of this account's regional AWS spend in the last 30 days was in us-west-2; us-east-1 (your home region now) had 3%. Your home region is where DevControl checks cost savings, Operational Health and Security Hub, and the one region it scans for resources (S3 and CloudFront are checked everywhere).")
    const bars = [...within(b).getByRole('list', { name: 'Regional usage charges, last 30 days' }).querySelectorAll('li')]
    expect(bars.map(text)).toEqual(['us-west-284%$1,284.10', 'eu-west-17.9%$120.33', 'us-east-25.1%$78.40', 'us-east-1 (home now)3%$45.92'])
    expect(bars.map((li) => li.getAttribute('data-lead'))).toEqual(['true', null, null, null])
    expect(within(b).getByRole('button', { name: 'Use us-west-2' })).toBeEnabled()
    expect(within(b).getByRole('button', { name: 'Keep us-east-1' })).toBeEnabled()
    expect(text(screen.getByTestId('home-region-footnote'))).toBe("Based on AWS Cost Explorer usage charges for account 111122223333, Oct 17 – Nov 15, 2026. Credits, refunds and tax aren't included. You can change your home region at any time on the Services page.")
    expect(b.className).toMatch(/\bbg-card\b/)
    expect(b.className).not.toMatch(/violet/)
  })

  it('placement: the scan banner, then the home-region banner, then the five cards', async () => {
    const c = tab5()
    await show(c, accountsAnswer({ proposal: proposal() }))
    mockDiscover.mockResolvedValue({ message: 'x', warnings: [], errors: [], discovered: 1, updated: 2, jobId: 'job-1' })
    fireEvent.click(screen.getByRole('button', { name: 'Scan now' }))
    const scanBanner = await screen.findByTestId('scan-banner')
    const home = screen.getByTestId('home-region-banner')
    const tiles = screen.getByTestId('attention-scope')
    const card = document.getElementById('region-coverage')!
    expect(scanBanner.compareDocumentPosition(home) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(home.compareDocumentPosition(tiles) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(tiles.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('a scan running: both buttons disabled, described by HR-S5', async () => {
    const c = tab5()
    c.scan_in_progress = { since: '2026-11-15T16:00:00.000Z' }
    await show(c, accountsAnswer({ proposal: proposal() }))
    const b = await screen.findByTestId('home-region-banner')
    for (const name of ['Use us-west-2', 'Keep us-east-1']) {
      const btn = within(b).getByRole('button', { name })
      expect(btn).toBeDisabled()
      expect(text(document.getElementById(btn.getAttribute('aria-describedby')!))).toBe('You can switch when the current scan finishes.')
    }
  })

  it('member: the banner without buttons, the HR-S15 line, no Change', async () => {
    await show(tab5(), accountsAnswer({ proposal: proposal(), canChange: false }))
    const b = await screen.findByTestId('home-region-banner')
    expect(within(b).queryAllByRole('button')).toEqual([])
    expect(text(screen.getByTestId('home-region-member-line'))).toBe('Only an organization owner can change the home region.')
    expect(screen.queryByTestId('change-home-region')).toBeNull()
  })

  it('"Use us-west-2" opens the dialog with us-west-2 pre-selected (a proposal)', async () => {
    await show(tab5(), accountsAnswer({ proposal: proposal() }))
    mockPreview.mockImplementation(async (r?: string) => (r === undefined ? preview() : previewFor(r)))
    fireEvent.click(within(await screen.findByTestId('home-region-banner')).getByRole('button', { name: 'Use us-west-2' }))
    const d = await screen.findByRole('dialog')
    expect(text(within(d).getByRole('heading', { level: 2 }))).toBe('Change home region')
    await waitFor(() => expect((within(d).getByLabelText('Home region') as HTMLSelectElement).value).toBe('us-west-2'))
    await waitFor(() => expect(within(d).getByRole('button', { name: 'Change to us-west-2' })).toBeEnabled())
    expect(mockPreview).toHaveBeenCalledWith('us-west-2')
    expect(within(d).getByLabelText('Home region').textContent).toContain('us-west-2 · $1,284.10 in the last 30 days')
  })

  it('"Keep us-east-1" dismisses on the server, invalidates the five queries, and the banner goes', async () => {
    await show(tab5(), accountsAnswer({ proposal: proposal() }))
    mockDismiss.mockResolvedValue(undefined)
    mockAccounts.mockResolvedValue(accountsAnswer({ proposal: proposal({ state: 'dismissed' }) }))
    fireEvent.click(within(await screen.findByTestId('home-region-banner')).getByRole('button', { name: 'Keep us-east-1' }))
    await waitFor(() => expect(banner()).toBeNull())
    expect(mockDismiss).toHaveBeenCalledTimes(1)
    expect(mockChange).not.toHaveBeenCalled()
    for (const key of FIVE) expect(invalidatedKeys()).toContain(key)
  })
})

// ── Tab 10 ──

describe('tab 10: split spend', () => {
  it('owner: V2-1/V2-2/V2-5/V2-3, neutral bars (none led), Choose + Keep', async () => {
    await show(tab5(), accountsAnswer({ proposal: split() }))
    const b = await screen.findByTestId('home-region-banner')
    expect(b.getAttribute('data-kind')).toBe('split')
    expect(text(within(b).getByRole('heading'))).toBe('Your AWS spend is distributed across multiple regions.')
    expect(b.textContent).toContain("We couldn't identify one clear home region from your last 30 days of regional AWS spend. Choose where DevControl should run cost savings, Operational Health and Security Hub checks.")
    expect(b.textContent).toContain('Your selection controls home-region-only checks. It does not enable multi-region discovery.')
    expect(text(screen.getByTestId('home-region-footnote'))).toBe("Based on AWS Cost Explorer usage charges for account 111122223333, Oct 17 – Nov 15, 2026. Credits, refunds and tax aren't included.")
    const bars = [...within(b).getByTestId('spend-bars').querySelectorAll('li')]
    expect(bars.map(text)).toEqual(['us-west-245%$1,215.40', 'us-east-240%$1,080.36', 'us-east-1 (home now)15%$405.13'])
    expect(bars.every((li) => li.getAttribute('data-lead') === null)).toBe(true)
    expect(b.textContent).not.toMatch(/suggest|recommend/i)
    expect(within(b).getByRole('button', { name: 'Choose your home region' })).toBeEnabled()
    expect(within(b).getByRole('button', { name: 'Keep us-east-1' })).toBeEnabled()
  })

  it('"Choose your home region": the dialog with NOTHING selected; confirm disabled until a pick', async () => {
    await show(tab5(), accountsAnswer({ proposal: split() }))
    mockPreview.mockImplementation(async (r?: string) => (r === undefined ? preview() : previewFor(r)))
    fireEvent.click(within(await screen.findByTestId('home-region-banner')).getByRole('button', { name: 'Choose your home region' }))
    const d = await screen.findByRole('dialog')
    expect(text(within(d).getByRole('heading', { level: 2 }))).toBe('Choose your home region')
    const select = within(d).getByLabelText('Home region') as HTMLSelectElement
    await waitFor(() => expect(select).toBeEnabled())
    expect(select.value).toBe('')
    expect([...select.options].map((o) => o.textContent)).toEqual([
      'Select a region', 'ap-northeast-1', 'eu-west-1', 'us-east-1 (current)',
      'us-east-2 · $1,080.36 in the last 30 days', 'us-west-2 · $1,215.40 in the last 30 days',
    ])
    expect(d.textContent).toContain('“What changes” appears once a region is selected.')
    expect(within(d).getByRole('button', { name: 'Change home region' })).toBeDisabled()
    expect(mockPreview).toHaveBeenCalledTimes(1)
    expect(mockPreview).toHaveBeenCalledWith(undefined)
    fireEvent.change(select, { target: { value: 'us-east-2' } })
    await waitFor(() => expect(within(d).getByRole('button', { name: 'Change to us-east-2' })).toBeEnabled())
  })

  it.each([
    ['running', true],
    ['not running', false],
  ])('a scan %s (L-7): Choose and Keep disabled with the HR-S5 hint only while it runs', async (_name, running) => {
    const c = tab5()
    if (running) c.scan_in_progress = { since: '2026-11-15T16:00:00.000Z' }
    await show(c, accountsAnswer({ proposal: split() }))
    const b = await screen.findByTestId('home-region-banner')
    expect(b.getAttribute('data-kind')).toBe('split')
    for (const name of ['Choose your home region', 'Keep us-east-1']) {
      const btn = within(b).getByRole('button', { name })
      if (running) {
        expect(btn).toBeDisabled()
        expect(text(document.getElementById(btn.getAttribute('aria-describedby')!))).toBe('You can switch when the current scan finishes.')
      } else {
        expect(btn).toBeEnabled()
        expect(btn).not.toHaveAttribute('aria-describedby')
      }
    }
    expect(b.textContent?.includes('You can switch when the current scan finishes.')).toBe(running)
    if (running) {
      fireEvent.click(within(b).getByRole('button', { name: 'Choose your home region' }))
      fireEvent.click(within(b).getByRole('button', { name: 'Keep us-east-1' }))
      await act(async () => {})
      expect(dialog()).toBeNull()
      expect(mockDismiss).not.toHaveBeenCalled()
    }
  })

  it('member: V2-8, no buttons', async () => {
    await show(tab5(), accountsAnswer({ proposal: split(), canChange: false }))
    const b = await screen.findByTestId('home-region-banner')
    expect(within(b).queryAllByRole('button')).toEqual([])
    expect(text(screen.getByTestId('home-region-member-line'))).toBe('Only an organization owner can choose the home region.')
  })

  it('more than 5 regions: "Other regions (2)" last', async () => {
    await show(tab5(), accountsAnswer({ proposal: splitSeven() }))
    const bars = [...within(await screen.findByTestId('home-region-banner')).getByTestId('spend-bars').querySelectorAll('li')]
    expect(text(bars.at(-1)!)).toBe('Other regions (2)7.3%$292.00')
  })

  it.each(['split_waiting', 'waiting', 'not_applicable', 'accepted', 'dismissed', 'superseded', 'no_signal', 'unavailable'] as const)('state %s → no banner (split-looking shares or not)', async (state) => {
    await show(tab5(), accountsAnswer({ proposal: split({ state }) }))
    await waitFor(() => expect(mockAccounts).toHaveBeenCalled())
    await act(async () => {})
    expect(banner()).toBeNull()
  })

  it('Keep → 409 NO_OPEN_PROPOSAL: refetch and hide', async () => {
    await show(tab5(), accountsAnswer({ proposal: split() }))
    mockDismiss.mockRejectedValue(new HomeRegionRequestError('NO_OPEN_PROPOSAL'))
    const before = mockAccounts.mock.calls.length
    fireEvent.click(within(await screen.findByTestId('home-region-banner')).getByRole('button', { name: 'Keep us-east-1' }))
    await waitFor(() => expect(banner()).toBeNull())
    await waitFor(() => expect(mockAccounts.mock.calls.length).toBeGreaterThan(before))
    expect(invalidatedKeys()).toContain('services-aws-accounts')
  })

  it.each(['HOME_REGION_PROPOSAL_FAILED', 'HOME_REGION_PROPOSAL_UNAVAILABLE', 'CONNECTION_CHANGED', 'HOME_REGION_OWNER_ONLY', null])(
    'Keep → %s (not NO_OPEN_PROPOSAL): the founder line in role=alert; the banner stays, refetched; buttons work again (decision f)', async (code) => {
      await show(tab5(), accountsAnswer({ proposal: split() }))
      mockDismiss.mockRejectedValue(new HomeRegionRequestError(code))
      const before = mockAccounts.mock.calls.length
      fireEvent.click(within(await screen.findByTestId('home-region-banner')).getByRole('button', { name: 'Keep us-east-1' }))
      const alert = await within(banner()!).findByRole('alert')
      expect(text(alert)).toBe("Your choice couldn't be saved. Nothing was changed. Try again.")
      await waitFor(() => expect(mockAccounts.mock.calls.length).toBeGreaterThan(before))
      for (const key of FIVE) expect(invalidatedKeys()).toContain(key)
      await waitFor(() => expect(within(banner()!).getByRole('button', { name: 'Keep us-east-1' })).toBeEnabled())
      // A retry that succeeds clears it and hides the banner.
      mockDismiss.mockResolvedValue(undefined)
      mockAccounts.mockResolvedValue(accountsAnswer({ proposal: split({ state: 'dismissed' }) }))
      fireEvent.click(within(banner()!).getByRole('button', { name: 'Keep us-east-1' }))
      await waitFor(() => expect(banner()).toBeNull())
    })

  it('Keep → 409 NO_OPEN_PROPOSAL shows no error line', async () => {
    await show(tab5(), accountsAnswer({ proposal: split() }))
    mockDismiss.mockRejectedValue(new HomeRegionRequestError('NO_OPEN_PROPOSAL'))
    fireEvent.click(within(await screen.findByTestId('home-region-banner')).getByRole('button', { name: 'Keep us-east-1' }))
    await waitFor(() => expect(banner()).toBeNull())
    expect(screen.queryByTestId('home-region-keep-error')).toBeNull()
  })
})

// ── Tab 11 + I.4 ──

describe('tab 11: the change dialog', () => {
  it('Change: owner only, after HR-S8', async () => {
    await show(tab5())
    const change = await screen.findByTestId('change-home-region')
    expect(text(change)).toBe('Change')
    expect(change).toHaveAccessibleName('Change home region')
    expect(screen.getByTestId('home-line').compareDocumentPosition(change) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it.each([
    ['can_change_home_region false', accountsAnswer({ canChange: false })],
    ['an older server (no home-region keys)', { ...accountsAnswer(), homeRegion: undefined }],
  ])('no Change, no dialog: %s', async (_name, answer) => {
    await show(tab5(), answer as any)
    await waitFor(() => expect(mockAccounts).toHaveBeenCalled())
    await act(async () => {})
    expect(screen.queryByTestId('change-home-region')).toBeNull()
    expect(dialog()).toBeNull()
    expect(mockPreview).not.toHaveBeenCalled()
  })

  it('a11y: role=dialog, aria-modal, labelled by its title; focus moves in and is trapped; Escape closes and returns focus', async () => {
    await show(tab5())
    mockPreview.mockImplementation(async (r?: string) => (r === undefined ? preview() : previewFor(r)))
    const change = await screen.findByTestId('change-home-region')
    change.focus()
    fireEvent.click(change)
    const d = await screen.findByRole('dialog')
    expect(d).toHaveAttribute('aria-modal', 'true')
    expect(d).toHaveAccessibleName('Change home region')
    expect(d.contains(document.activeElement)).toBe(true)
    const focusables = [...d.querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled])')]
    const last = focusables.at(-1)!
    last.focus()
    fireEvent.keyDown(d, { key: 'Tab' })
    expect(document.activeElement).toBe(focusables[0])
    fireEvent.keyDown(d, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
    fireEvent.keyDown(d, { key: 'Escape' })
    await waitFor(() => expect(dialog()).toBeNull())
    expect(document.activeElement).toBe(screen.getByTestId('change-home-region'))
  })

  it('Cancel and Close close it; nothing is sent', async () => {
    await show(tab5())
    mockPreview.mockImplementation(async () => preview())
    for (const name of ['Cancel', 'Close']) {
      fireEvent.click(await screen.findByTestId('change-home-region'))
      fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name }))
      await waitFor(() => expect(dialog()).toBeNull())
    }
    expect(mockChange).not.toHaveBeenCalled()
  })

  it('from Change: nothing selected; options by name without amounts (no open prompt); flag-off intro', async () => {
    await show(tab5())
    mockPreview.mockImplementation(async () => preview())
    fireEvent.click(await screen.findByTestId('change-home-region'))
    const d = await screen.findByRole('dialog')
    const select = within(d).getByLabelText('Home region') as HTMLSelectElement
    await waitFor(() => expect(select).toBeEnabled())
    expect(select.value).toBe('')
    expect([...select.options].map((o) => [o.textContent, o.disabled])).toEqual([
      ['Select a region', true], ['ap-northeast-1', false], ['eu-west-1', false], ['us-east-1 (current)', true], ['us-east-2', false], ['us-west-2', false],
    ])
    expect(d.textContent).toContain("Your home region is where DevControl checks cost savings, Operational Health and Security Hub. It's also the one region scanned for resources, apart from S3 and CloudFront.")
    expect(d.textContent).toContain('Only regions enabled in this AWS account are listed.')
  })

  it('What changes (flag off): scan, cost, kept resources, Security Hub, V2-5 last', async () => {
    await show(tab5())
    const d = await openAndPick('us-west-2')
    expect([...within(d).getByTestId('what-changes').querySelectorAll('li')].map(text)).toEqual([
      'A scan of us-west-2 starts right away.',
      '3 cost findings in us-east-1 leave your savings total. They come back if you switch back.',
      'The 4 resources already found in us-east-1 stay listed, marked “no longer scanned”.',
      'Security Hub findings from us-west-2 appear after your next sync.',
      'Your selection controls home-region-only checks. It does not enable multi-region discovery.',
    ])
  })

  it('What changes (multi-region on): no "stay listed" line (resources_kept_in_old_region null), intro without the bracket', async () => {
    await show(tab5())
    const d = await openAndPick('us-west-2', previewFor('us-west-2', { multiRegion: true }))
    expect(within(d).getByTestId('what-changes').textContent).not.toContain('stay listed')
    expect(d.textContent).not.toContain("It's also the one region scanned")
  })

  it('a preview refusal (a scan started meanwhile): the HR-S15 text, confirm disabled', async () => {
    await show(tab5())
    mockPreview.mockImplementation(async (r?: string) => (r === undefined ? preview() : previewFor(r, { refusal: 'scan_in_progress' })))
    fireEvent.click(await screen.findByTestId('change-home-region'))
    const d = await screen.findByRole('dialog')
    const select = within(d).getByLabelText('Home region')
    await waitFor(() => expect(select).toBeEnabled())
    fireEvent.change(select, { target: { value: 'us-west-2' } })
    expect(text(await within(d).findByRole('alert'))).toBe('A scan is running. You can change the home region when it finishes.')
    expect(within(d).getByRole('button', { name: 'Change to us-west-2' })).toBeDisabled()
  })

  it.each([
    [true, 'Home region changed to us-west-2. A scan has started.'],
    [false, 'Home region changed to us-west-2. The next scan will check it.'],
  ])('success, scan_started %s: the line, the dialog closes, the five queries invalidated', async (scanStarted, line) => {
    await show(tab5())
    const d = await openAndPick('us-west-2')
    mockChange.mockResolvedValue({ from: 'us-east-1', to: 'us-west-2', source: 'manual', cost_findings_removed: { total: 3, by_issue: {} }, scan_started: scanStarted })
    fireEvent.click(within(d).getByRole('button', { name: 'Change to us-west-2' }))
    expect(text(await screen.findByTestId('home-region-changed'))).toBe(line)
    expect(screen.getByTestId('home-region-changed')).toHaveAttribute('role', 'status')
    expect(dialog()).toBeNull()
    expect(mockChange).toHaveBeenCalledWith('us-west-2')
    for (const key of FIVE) expect(invalidatedKeys()).toContain(key)
  })

  it('no optimistic update: the home line changes only after the server answered, from the refetched coverage', async () => {
    const before = tab5()
    await show(before)
    expect(homeLine()).toContain('us-east-1')
    const d = await openAndPick('us-west-2')
    const put = deferred<any>()
    mockChange.mockReturnValue(put.promise)
    fireEvent.click(within(d).getByRole('button', { name: 'Change to us-west-2' }))
    await act(async () => {})
    expect(homeLine()).toContain('us-east-1')
    expect(invalidate).not.toHaveBeenCalled()
    const after = tab5()
    after.account.home_region = 'us-west-2'
    after.scope.home_region = { region: 'us-west-2', count: 1 }
    after.region_status = after.region_status.map((r: any) => ({ ...r, home: r.region === 'us-west-2' }))
    serveScan(scanOf(after))
    await act(async () => put.resolve({ from: 'us-east-1', to: 'us-west-2', source: 'manual', cost_findings_removed: { total: 0, by_issue: {} }, scan_started: true }))
    await waitFor(() => expect(homeLine()).toContain('us-west-2'))
  })

  it.each([
    ['SCAN_IN_PROGRESS', 'A scan is running. You can change the home region when it finishes.'],
    ['REGION_NOT_ENABLED', "us-west-2 isn't enabled in this AWS account."],
    ['HOME_REGION_OWNER_ONLY', 'Only an organization owner can change the home region.'],
    ['INVALID_REGION', "The home region couldn't be changed. Nothing was changed. Try again."],
    ['HOME_REGION_UNCHANGED', "The home region couldn't be changed. Nothing was changed. Try again."],
    ['AWS_NOT_CONNECTED', "The home region couldn't be changed. Nothing was changed. Try again."],
    ['AWS_ACCOUNT_AMBIGUOUS', "The home region couldn't be changed. Nothing was changed. Try again."],
    ['REGION_LIST_UNKNOWN', "The home region couldn't be changed. Nothing was changed. Try again."],
    ['REGION_EXCLUDED', "The home region couldn't be changed. Nothing was changed. Try again."],
    ['CONNECTION_CHANGED', "The home region couldn't be changed. Nothing was changed. Try again."],
    ['HOME_REGION_CHANGE_BUSY', "The home region couldn't be changed. Nothing was changed. Try again."],
    ['HOME_REGION_CHANGE_FAILED', "The home region couldn't be changed. Nothing was changed. Try again."],
    [null, "The home region couldn't be changed. Nothing was changed. Try again."],
  ])('PUT refused with %s: its text in role=alert; home region kept; the five queries refetched (L-3); confirm enabled for a retry (L-2), held while a scan runs for SCAN_IN_PROGRESS', async (code, message) => {
    await show(tab5())
    const d = await openAndPick('us-west-2')
    mockChange.mockRejectedValue(new HomeRegionRequestError(code))
    // SCAN_IN_PROGRESS: the refetched coverage agrees a scan is running.
    if (code === 'SCAN_IN_PROGRESS') serveScan(scanning())
    const coverageCalls = mockGetCoverage.mock.calls.length
    const accountCalls = mockAccounts.mock.calls.length
    fireEvent.click(within(d).getByRole('button', { name: 'Change to us-west-2' }))
    const alert = await within(d).findByRole('alert')
    expect(text(alert)).toBe(message)
    expect(dialog()).not.toBeNull()
    expect(homeLine()).toContain('us-east-1')
    expect(screen.queryByTestId('home-region-changed')).toBeNull()
    await waitFor(() => expect(mockGetCoverage.mock.calls.length).toBeGreaterThan(coverageCalls))
    await waitFor(() => expect(mockAccounts.mock.calls.length).toBeGreaterThan(accountCalls))
    expect(invalidatedKeys().slice().sort()).toEqual([...FIVE].sort())
    for (const key of FIVE) expect(invalidate.mock.calls.find((c: any[]) => c[0]?.queryKey?.[0] === key)![0].queryKey).toEqual([key, 'org-test'])
    if (code === 'SCAN_IN_PROGRESS') {
      await screen.findAllByText(/Scan in progress since/)
      await act(async () => {})
      expect(within(d).getByRole('button', { name: 'Change to us-west-2' })).toBeDisabled()
      expect(text(within(d).getByRole('alert'))).toBe(message)
    } else {
      await waitFor(() => expect(within(d).getByRole('button', { name: 'Change to us-west-2' })).toBeEnabled())
    }
  })

  it('SCAN_IN_PROGRESS while the scan runs (founder): confirm held under the HR-S15 text; a coverage refetch showing the scan ended re-enables it and the text goes', async () => {
    await show(tab5())
    const d = await openAndPick('us-west-2')
    mockChange.mockRejectedValueOnce(new HomeRegionRequestError('SCAN_IN_PROGRESS'))
    serveScan(scanning())
    const coverageCalls = mockGetCoverage.mock.calls.length
    fireEvent.click(within(d).getByRole('button', { name: 'Change to us-west-2' }))
    await waitFor(() => expect(mockGetCoverage.mock.calls.length).toBeGreaterThan(coverageCalls))
    // The refetched coverage has landed on the page (its scan line), so this is the held phase.
    await screen.findAllByText(/Scan in progress since/)
    await act(async () => {})
    const confirm = within(d).getByRole('button', { name: 'Change to us-west-2' })
    expect(confirm).toBeDisabled()
    expect(text(within(d).getByRole('alert'))).toBe('A scan is running. You can change the home region when it finishes.')
    // A click while held sends nothing.
    fireEvent.click(confirm)
    await act(async () => {})
    expect(mockChange).toHaveBeenCalledTimes(1)
    // The page's next coverage read (its every-minute poll during a scan) says the scan ended.
    serveScan(scanOf(tab5()))
    await act(async () => { await client.refetchQueries({ queryKey: ['services-coverage', 'org-test'] }) })
    await waitFor(() => expect(confirm).toBeEnabled())
    expect(within(d).queryByRole('alert')).toBeNull()
    expect((within(d).getByLabelText('Home region') as HTMLSelectElement).value).toBe('us-west-2')
    // Retry the same region, no re-pick.
    mockChange.mockResolvedValueOnce({ from: 'us-east-1', to: 'us-west-2', source: 'manual', cost_findings_removed: { total: 0, by_issue: {} }, scan_started: true })
    fireEvent.click(confirm)
    expect(text(await screen.findByTestId('home-region-changed'))).toBe('Home region changed to us-west-2. A scan has started.')
    expect(mockChange.mock.calls.map((c) => c[0])).toEqual(['us-west-2', 'us-west-2'])
  })

  it('SCAN_IN_PROGRESS: held until the refetch lands even though the cached coverage shows no scan; enabled once it shows the scan already ended', async () => {
    await show(tab5())
    const d = await openAndPick('us-west-2')
    mockChange.mockRejectedValueOnce(new HomeRegionRequestError('SCAN_IN_PROGRESS'))
    const cov = deferred<Scan['coverage']>()
    mockGetCoverage.mockReturnValueOnce(cov.promise)
    fireEvent.click(within(d).getByRole('button', { name: 'Change to us-west-2' }))
    expect(text(await within(d).findByRole('alert'))).toBe('A scan is running. You can change the home region when it finishes.')
    await act(async () => {})
    const confirm = within(d).getByRole('button', { name: 'Change to us-west-2' })
    expect(confirm).toBeDisabled()
    await act(async () => cov.resolve(scanOf(tab5()).coverage))
    await waitFor(() => expect(confirm).toBeEnabled())
    expect(within(d).queryByRole('alert')).toBeNull()
  })

  it('other failures keep the L-2 retry even while a scan runs', async () => {
    await show(tab5())
    const d = await openAndPick('us-west-2')
    mockChange.mockRejectedValueOnce(new HomeRegionRequestError('HOME_REGION_CHANGE_BUSY'))
    serveScan(scanning())
    fireEvent.click(within(d).getByRole('button', { name: 'Change to us-west-2' }))
    expect(text(await within(d).findByRole('alert'))).toBe("The home region couldn't be changed. Nothing was changed. Try again.")
    await screen.findAllByText(/Scan in progress since/)
    await waitFor(() => expect(within(d).getByRole('button', { name: 'Change to us-west-2' })).toBeEnabled())
  })

  it('L-3: a failed change refetches stats, attention and the list too (a change whose response was lost)', async () => {
    await show(tab5())
    const d = await openAndPick('us-west-2')
    mockChange.mockRejectedValue(new HomeRegionRequestError(null))
    const statsCalls = mockGetStats.mock.calls.length
    const listCalls = mockGetServices.mock.calls.length
    fireEvent.click(within(d).getByRole('button', { name: 'Change to us-west-2' }))
    await within(d).findByRole('alert')
    await waitFor(() => expect(mockGetStats.mock.calls.length).toBeGreaterThan(statsCalls))
    await waitFor(() => expect(mockGetServices.mock.calls.length).toBeGreaterThan(listCalls))
    for (const key of FIVE) expect(invalidatedKeys()).toContain(key)
  })

  it('L-2: after a failure the SAME region can be tried again without a re-pick; the retry clears the error, then succeeds', async () => {
    await show(tab5())
    const d = await openAndPick('us-west-2')
    const select = within(d).getByLabelText('Home region') as HTMLSelectElement
    mockChange.mockRejectedValueOnce(new HomeRegionRequestError('HOME_REGION_CHANGE_BUSY'))
    fireEvent.click(within(d).getByRole('button', { name: 'Change to us-west-2' }))
    expect(text(await within(d).findByRole('alert'))).toBe("The home region couldn't be changed. Nothing was changed. Try again.")
    const confirm = within(d).getByRole('button', { name: 'Change to us-west-2' })
    await waitFor(() => expect(confirm).toBeEnabled())
    expect(select.value).toBe('us-west-2')
    // Retry with no change event: the error clears as soon as Confirm is pressed.
    const put = deferred<any>()
    mockChange.mockReturnValueOnce(put.promise)
    fireEvent.click(confirm)
    await waitFor(() => expect(within(d).queryByRole('alert')).toBeNull())
    expect(confirm).toBeDisabled() // in flight
    expect(mockChange).toHaveBeenCalledTimes(2)
    expect(mockChange.mock.calls.map((c) => c[0])).toEqual(['us-west-2', 'us-west-2'])
    await act(async () => put.resolve({ from: 'us-east-1', to: 'us-west-2', source: 'manual', cost_findings_removed: { total: 0, by_issue: {} }, scan_started: true }))
    expect(text(await screen.findByTestId('home-region-changed'))).toBe('Home region changed to us-west-2. A scan has started.')
    expect(dialog()).toBeNull()
  })

  it('L-2: a retry that fails again shows the error again, and the confirm stays usable', async () => {
    await show(tab5())
    const d = await openAndPick('us-west-2')
    mockChange.mockRejectedValueOnce(new HomeRegionRequestError(null)).mockRejectedValueOnce(new HomeRegionRequestError('REGION_NOT_ENABLED'))
    fireEvent.click(within(d).getByRole('button', { name: 'Change to us-west-2' }))
    expect(text(await within(d).findByRole('alert'))).toBe("The home region couldn't be changed. Nothing was changed. Try again.")
    await waitFor(() => expect(within(d).getByRole('button', { name: 'Change to us-west-2' })).toBeEnabled())
    fireEvent.click(within(d).getByRole('button', { name: 'Change to us-west-2' }))
    await waitFor(() => expect(text(within(d).getByRole('alert'))).toBe("us-west-2 isn't enabled in this AWS account."))
    await waitFor(() => expect(within(d).getByRole('button', { name: 'Change to us-west-2' })).toBeEnabled())
    expect(mockChange).toHaveBeenCalledTimes(2)
  })
})

// ── Tab 12 ──

describe('tab 12: former home (flag off)', () => {
  it('row: "former home" chip, No longer scanned, V2-45, V2-46; the line counts the home only; HR-S18; legend', async () => {
    await show(tab12Scan())
    expect(text(screen.getByTestId('organising-line'))).toBe('1 of 4 regions checked · us-west-2')
    const table = document.querySelector('[data-layout="table"]')!
    expect([...table.querySelectorAll('tbody > tr')].map((tr) => tr.getAttribute('data-row'))).toEqual(['region-us-west-2', 'region-us-east-1', 'not-scanned', 'not-enabled', 'global-heading', 'cloudfront'])
    const cells = [...table.querySelector('tr[data-row="region-us-east-1"]')!.children].map(text)
    expect(cells).toEqual([
      'us-east-1former home', '62 S3 buckets checked today · 4 from earlier scans', 'No longer scanned', expect.stringMatching(/^yesterday, 9:02 AM/),
      'Not scanned since your home region moved. S3 buckets here are still checked on every scan.',
    ])
    expect(document.querySelector('[data-row="region-us-east-1"] [data-status]')!.getAttribute('data-status')).toBe('no_longer')
    expect(text(document.querySelector('[data-note="former-home"]'))).toBe("4 resources in us-east-1 are from earlier scans. us-east-1 hasn't been scanned since your home region moved to us-west-2 on Nov 14.")
    const legend = [...screen.getByRole('list', { name: 'Status legend' }).querySelectorAll('li')].map(text)
    expect(legend).toContain("No longer scanned: your former home region; it isn't scanned while multi-region scanning is off")
  })

  it('tile V2-21, attention HR-S19, filter HR-S17, What we didn\'t check V2-47', async () => {
    const { scan } = await show(tab12Scan())
    expect(text(screen.getByTestId('resources-earlier'))).toBe('4 in us-east-1 from earlier scans')
    const attention = screen.getByRole('heading', { name: 'What needs attention' }).closest('section')!
    await waitFor(() => expect(within(attention).getAllByTestId('former-home-checked')).toHaveLength(1))
    const cell = within(attention).getByTestId('former-home-checked').closest('td')!
    expect(text(cell)).toBe('us-east-1 · last checked Nov 14')
    const options = [...(screen.getByLabelText('Region') as HTMLSelectElement).options].map((o) => o.textContent)
    expect(options).toContain('us-east-1, no longer scanned (6)')
    expect(options).toContain('us-west-2, home (5)')
    const nc = screen.getByTestId('not-checked')
    expect(nc.textContent).toContain("us-east-1 hasn't been scanned since Nov 14, except for S3 buckets.")
    expect(text(nc.querySelector('summary'))).toMatch(/^Not checked: other enabled regions \(S3 only\) · us-east-1 since Nov 14 · /)
    // One row set: the Resources tile is /stats total, and card regions + CloudFront + the listed bucket agree with it.
    expect(scan.stats.total).toBe(14)
  })

  it('the phone list carries the same row (relative time only, the exact time behind the tap tooltip)', async () => {
    await show(tab12Scan())
    const li = document.querySelector('[data-layout="stacked"] [data-row="region-us-east-1"]')!
    expect(li.textContent).toContain('former home')
    expect(li.textContent).toContain('No longer scanned')
    const time = within(li as HTMLElement).getByRole('button')
    expect(text(time)).toBe('yesterday, 9:02 AM')
    // The exact time is only in the role=tooltip the button describes, closed until a tap/hover/focus.
    const tip = document.getElementById(time.getAttribute('aria-describedby')!)!
    expect(tip).toHaveAttribute('role', 'tooltip')
    expect(tip).toHaveAttribute('data-open', 'false')
    const visible = li.cloneNode(true) as HTMLElement
    visible.querySelector('[role="tooltip"]')!.remove()
    expect(visible.textContent).not.toMatch(/2026 at|GMT|UTC/)
  })
})

// ── axe on every new state ──

describe('axe-core on the new states (phone list and open dialog/tooltip included)', { timeout: 30_000 }, () => {
  it.each([
    ['tab 9 owner', () => show(tab5(), accountsAnswer({ proposal: proposal() }))],
    ['tab 9 member', () => show(tab5(), accountsAnswer({ proposal: proposal(), canChange: false }))],
    ['tab 9 scan running', () => { const c = tab5(); c.scan_in_progress = { since: '2026-11-15T16:00:00.000Z' }; return show(c, accountsAnswer({ proposal: proposal() })) }],
    ['tab 10 owner', () => show(tab5(), accountsAnswer({ proposal: splitSeven() }))],
    ['tab 10 member', () => show(tab5(), accountsAnswer({ proposal: split(), canChange: false }))],
    ['tab 10 scan running (L-7)', () => { const c = tab5(); c.scan_in_progress = { since: '2026-11-15T16:00:00.000Z' }; return show(c, accountsAnswer({ proposal: split() })) }],
    ['tab 12', () => show(tab12Scan())],
  ])('%s', async (_name, run) => {
    const { container } = await run()
    expect(await axeViolations(scopeOf(container))).toEqual([])
  })

  it('tab 11: the open dialog with What changes, then with an error', async () => {
    const { container } = await show(tab5())
    const d = await openAndPick('us-west-2')
    expect(await axeViolations(scopeOf(container))).toEqual([])
    mockChange.mockRejectedValue(new HomeRegionRequestError('HOME_REGION_CHANGE_BUSY'))
    fireEvent.click(within(d).getByRole('button', { name: 'Change to us-west-2' }))
    await within(d).findByRole('alert')
    await waitFor(() => expect(within(d).getByRole('button', { name: 'Change to us-west-2' })).toBeEnabled())
    expect(await axeViolations(scopeOf(container))).toEqual([])
  })

  it('tab 11: the dialog held after SCAN_IN_PROGRESS while the scan runs', async () => {
    const { container } = await show(tab5())
    const d = await openAndPick('us-west-2')
    mockChange.mockRejectedValue(new HomeRegionRequestError('SCAN_IN_PROGRESS'))
    serveScan(scanning())
    fireEvent.click(within(d).getByRole('button', { name: 'Change to us-west-2' }))
    await within(d).findByRole('alert')
    await screen.findAllByText(/Scan in progress since/)
    await act(async () => {})
    expect(within(d).getByRole('button', { name: 'Change to us-west-2' })).toBeDisabled()
    expect(await axeViolations(scopeOf(container))).toEqual([])
  })

  it('tab 12 phone list with the former home\'s tap tooltip open', async () => {
    await show(tab12Scan())
    const list = document.querySelector('[data-layout="stacked"]') as HTMLElement
    const time = within(list.querySelector('[data-row="region-us-east-1"]') as HTMLElement).getByRole('button')
    fireEvent.click(time)
    expect(document.getElementById(time.getAttribute('aria-describedby')!)).toHaveAttribute('data-open', 'true')
    expect(await axeViolations(list)).toEqual([])
  })

  it('tab 10 with the Keep failure line (decision f)', async () => {
    const { container } = await show(tab5(), accountsAnswer({ proposal: split() }))
    mockDismiss.mockRejectedValue(new HomeRegionRequestError('HOME_REGION_PROPOSAL_FAILED'))
    fireEvent.click(within(await screen.findByTestId('home-region-banner')).getByRole('button', { name: 'Keep us-east-1' }))
    await screen.findByTestId('home-region-keep-error')
    expect(await axeViolations(scopeOf(container))).toEqual([])
  })

  it('the success line', async () => {
    const { container } = await show(tab5())
    const d = await openAndPick('us-west-2')
    mockChange.mockResolvedValue({ from: 'us-east-1', to: 'us-west-2', source: 'manual', cost_findings_removed: { total: 0, by_issue: {} }, scan_started: true })
    fireEvent.click(within(d).getByRole('button', { name: 'Change to us-west-2' }))
    await screen.findByTestId('home-region-changed')
    expect(await axeViolations(scopeOf(container))).toEqual([])
  })
})

// PR 3d-2 (founder ruling, Nov 19): "proposed" with missing data shows no banner here, and Connect AWS shows
// no suggestion line for the same answer (connect-home-region-3d2.test.tsx); both use homeRegionPromptShows.
describe('3d-2: proposed with missing data', () => {
  it.each([
    ['no region', proposal({ region: null })],
    ['no share for its region', proposal({ shares: proposal().shares.filter((s) => s.region !== 'us-west-2') })],
    ['no current share', proposal({ current: null })],
  ] as const)('%s → no banner', async (_name, p) => {
    await show(tab5(), accountsAnswer({ proposal: p }))
    await waitFor(() => expect(mockAccounts).toHaveBeenCalled())
    await act(async () => {})
    expect(banner()).toBeNull()
  })
})
