/**
 * /infrastructure with NEXT_PUBLIC_INFRA_OVERVIEW_V2 on (infra-overview-plan.md
 * §14.2, §17.11, §18.3, §19.7): what renders, which requests are made, and
 * which are never made. Every service client and the raw fetch are recorded,
 * so a request to /api/observability/* (the CloudWatch-backed endpoints) would
 * show up in every state.
 *
 * The zone is pinned to UTC and Date is frozen before the page module loads;
 * only Date is faked, so React Query and findBy* keep real timers.
 */
const m = vi.hoisted(() => {
  process.env.TZ = 'UTC'
  vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-10-23T15:00:00Z') })
  return {
    log: [] as string[],
    /** Each request with its arguments. */
    calls: [] as { endpoint: string; args: unknown[] }[],
    demo: false,
    salesDemo: false,
    plan: { isFree: false, isStarter: true, isPro: true, tier: 'pro' } as Record<string, unknown>,
    replace: vi.fn(),
    responses: {} as Record<string, () => Promise<unknown>>,
  }
})

/** Each client method stands for one endpoint; every call is logged as "METHOD path". */
const call = vi.hoisted(() => (endpoint: string) => (...args: unknown[]) => {
  m.log.push(endpoint)
  m.calls.push({ endpoint, args })
  const respond = m.responses[endpoint]
  if (!respond) return Promise.reject(new Error(`unexpected request: ${endpoint} ${JSON.stringify(args)}`))
  return respond()
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { screen, within, fireEvent, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { focusManager } from '@tanstack/react-query'
import { footerText } from '../../services/regionCoverage'
import { OVERVIEW_COPY } from '../overview/overviewModel'
import { renderInfrastructure, settled } from './overview-harness'
import {
  NOW, hoursAgo, coverage, noAccountCoverage, STATS, QUIET_STATS, service, attentionPage, ACCOUNT_FINDINGS,
  billedSummary, estimatedSummary, SAVINGS, NO_SAVINGS,
} from './overview-fixtures'


vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: m.replace }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/infrastructure',
}))
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ organization: { id: 'org-test', name: 'Org Test' } }) }))
vi.mock('@/lib/hooks/use-plan', () => ({ usePlan: () => m.plan }))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => m.demo }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: (selector: (s: { enabled: boolean }) => unknown) => selector({ enabled: m.salesDemo }) }))
vi.mock('@/lib/services/aws-services.service', () => ({
  default: {
    getCoverage: call('GET /api/services/coverage'),
    getStats: call('GET /api/services/stats'),
    getServices: call('GET /api/services'),
    discoverServices: call('POST /api/services/discover'),
    getResource: call('GET /api/services/:id'),
  },
}))
vi.mock('@/lib/services/account-security-findings.service', () => ({
  accountSecurityFindingsService: { getActive: call('GET /api/security/account-findings'), getStats: call('GET /api/security/account-findings/stats') },
}))
vi.mock('@/lib/services/platform-stats.service', () => ({
  platformStatsService: { getCostSummary: call('GET /api/platform/costs/summary'), getDashboardStats: call('GET /api/platform/stats/dashboard') },
}))
vi.mock('@/lib/services/cost-recommendations.service', () => ({
  costRecommendationsService: {
    getStats: call('GET /api/cost-recommendations/stats'),
    getAll: call('GET /api/cost-recommendations'),
    getActiveCount: call('GET /api/cost-recommendations/stats (count)'),
  },
}))
vi.mock('@/lib/services/infrastructure.service', () => ({ infrastructureService: { getAll: call('GET /api/infrastructure') } }))
// Anything that reaches the shared API client directly is logged too.
vi.mock('@/lib/api', () => {
  const via = (method: string) => (url: string) => call(`${method} ${url}`)()
  return { default: { get: via('GET'), post: via('POST'), put: via('PUT'), patch: via('PATCH'), delete: via('DELETE') }, handleApiResponse: (r: unknown) => r }
})
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

const V2_ENDPOINTS = [
  'GET /api/services/coverage', 'GET /api/services/stats', 'GET /api/services', 'GET /api/security/account-findings',
  'GET /api/platform/costs/summary', 'GET /api/cost-recommendations/stats', 'GET /api/infrastructure',
]

const ok = (data: unknown) => () => Promise.resolve(data)
const fail = (status = 500) => () => Promise.reject(Object.assign(new Error(String(status)), { response: { status } }))
const never = () => new Promise(() => {})

/** The connected organization: findings in both sources, billed spend, savings. */
function connected() {
  m.responses = {
    'GET /api/services/coverage': ok(coverage()),
    'GET /api/services/stats': ok(STATS),
    'GET /api/services': ok(attentionPage()),
    'GET /api/security/account-findings': ok(ACCOUNT_FINDINGS),
    'GET /api/platform/costs/summary': ok(billedSummary()),
    'GET /api/cost-recommendations/stats': ok(SAVINGS),
    'GET /api/infrastructure': ok([{ id: 'SENTINEL-ROW', serviceName: 'SENTINEL-NAME', costPerMonth: 9876.54 }]),
    'POST /api/services/discover': ok({ discovered: 9, updated: 0, errors: [], warnings: [], message: 'ok' }),
  }
}

/** The states with an AWS account connected (RU-3), each as a response set. */
const CONNECTED_STATES: Record<string, () => void> = {
  ready: () => connected(),
  loading: () => { connected(); for (const k of V2_ENDPOINTS) m.responses[k] = never },
  'coverage loading': () => { connected(); m.responses['GET /api/services/coverage'] = never },
  'coverage error': () => { connected(); m.responses['GET /api/services/coverage'] = fail() },
  'savings error': () => { connected(); m.responses['GET /api/cost-recommendations/stats'] = fail() },
  'savings $0': () => { connected(); m.responses['GET /api/cost-recommendations/stats'] = ok(NO_SAVINGS) },
  'no findings': () => {
    connected()
    m.responses['GET /api/services/stats'] = ok(QUIET_STATS)
    m.responses['GET /api/services'] = ok(attentionPage([]))
    m.responses['GET /api/security/account-findings'] = ok([])
  },
  'cost estimate only': () => { connected(); m.responses['GET /api/platform/costs/summary'] = ok(estimatedSummary()) },
  'cost unavailable': () => { connected(); m.responses['GET /api/platform/costs/summary'] = fail() },
  'everything but coverage failed': () => {
    connected()
    for (const k of V2_ENDPOINTS) if (k !== 'GET /api/services/coverage') m.responses[k] = fail()
  },
}

const noAccount = () => {
  connected()
  m.responses['GET /api/services/coverage'] = ok(noAccountCoverage())
}

const fetchSpy = vi.fn()

beforeEach(() => {
  vi.setSystemTime(NOW)
  m.log.length = 0
  m.calls.length = 0
  m.demo = false
  m.salesDemo = false
  m.plan = { isFree: false, isStarter: true, isPro: true, tier: 'pro' }
  m.replace.mockReset()
  vi.mocked(toast.success).mockReset()
  vi.mocked(toast.error).mockReset()
  vi.stubEnv('NEXT_PUBLIC_INFRA_OVERVIEW_V2', 'true')
  connected()
  localStorage.clear()
  localStorage.setItem('accessToken', 'fake-token')
  fetchSpy.mockReset().mockImplementation((url: string) => {
    m.log.push(`fetch ${new URL(url).pathname}`)
    return Promise.resolve({ ok: false } as Response)
  })
  global.fetch = fetchSpy as unknown as typeof fetch
})
afterEach(() => { vi.unstubAllEnvs() })

async function renderSettled(pending = 0) {
  const r = renderInfrastructure()
  await screen.findByRole('heading', { level: 1, name: 'Infrastructure Overview' })
  await settled(r.client, pending)
  return r
}

const observability = () => m.log.filter((l) => /\/api\/observability\//.test(l))

// ── R1 structure ──

describe('R1 / R6 / a11y structure', () => {
  it('one h1, then the sections in the plan order; no chart', async () => {
    await renderSettled()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    const h2 = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(h2).toEqual([
      'AWS account',
      'Critical-severity findings need review: 1 on resources, 1 account-level · High: 2 on resources, 1 account-level',
      'Summary', 'What needs attention', 'What we checked', 'Cost by AWS service', 'Ownership gaps', 'All 9 resources',
    ])
    expect(document.querySelector('svg[class*="recharts"], canvas')).toBeNull()
    for (const section of document.querySelectorAll('main section')) expect(section.getAttribute('aria-labelledby')).toBeTruthy()
  })
  it('R6 a list on a phone, a table from sm up; no horizontal scroll container', async () => {
    const { container } = await renderSettled()
    const attention = screen.getByRole('region', { name: 'What needs attention' })
    expect(attention.querySelector('table')!.className.split(' ')).toEqual(expect.arrayContaining(['hidden', 'sm:table']))
    expect(attention.querySelector('ul')!.className).toMatch(/sm:hidden/)
    expect(container.innerHTML).not.toMatch(/overflow-x-auto/)
    expect(within(attention).getAllByRole('rowheader').length).toBeGreaterThan(0)
  })
  it('O-SB findings use SeverityBadge colours; cost and status rows the grey variant with their label', async () => {
    await renderSettled()
    const table = screen.getByRole('region', { name: 'What needs attention' }).querySelector('table')!
    const badge = (label: string) => within(table).getAllByText(label)[0]
    expect(badge('Critical').className).toMatch(/bg-red-100/)
    expect(badge('High').className).toMatch(/bg-amber-100/)
    for (const label of ['Cost · ≥ $100/mo est.', 'Failed or terminated', 'Stopped or degraded']) expect(badge(label).className).toMatch(/bg-gray-100/)
    expect(within(table).queryByText(/^(Stopped|Failed)$/)).toBeNull()
  })
  it('R5 a scan time can be focused and carries its exact time', async () => {
    await renderSettled()
    const time = document.querySelector('header time')!
    expect(time.getAttribute('tabindex')).toBe('0')
    expect(time.textContent).toBe('today, 1:00 PM (Friday, October 23, 2026 at 1:00:00 PM UTC)')
  })
})

// ── R2 Review is display only ──

describe('R2 Review', () => {
  it('toggles a detail row with aria-expanded / aria-controls, and makes no request', async () => {
    await renderSettled()
    const table = screen.getByRole('region', { name: 'What needs attention' }).querySelector('table')!
    const button = within(table).getByRole('button', { name: 'Review db-prod' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).not.toHaveAttribute('aria-controls')
    const before = m.log.length
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    const detail = document.getElementById(button.getAttribute('aria-controls')!)!
    expect(detail).toHaveTextContent('What we found')
    expect(detail).toHaveTextContent('Found on the scan that finished')
    expect(detail).toHaveTextContent('Before you change anything')
    expect(detail).toHaveTextContent("DevControl only reads your account and won't change anything.")
    expect(within(detail).getByRole('link', { name: 'Review on the Security page →' })).toHaveAttribute('href', '/security')
    expect(detail).not.toHaveTextContent(/Why it matters|Risk of the fix/)
    // The accessible name follows the visible label (WCAG 2.5.3).
    expect(button).toHaveAccessibleName('Hide db-prod')
    expect(button).toHaveTextContent('Hide')
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).toHaveAccessibleName('Review db-prod')
    expect(button).toHaveTextContent('Review')
    expect(document.getElementById(`${'resource-db-prod'}-detail`)).toBeNull()
    expect(m.log.slice(before)).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })
  it('an account finding shows its recommendation as the next step', async () => {
    await renderSettled()
    const table = screen.getByRole('region', { name: 'What needs attention' }).querySelector('table')!
    fireEvent.click(within(table).getByRole('button', { name: 'Review alice' }))
    expect(table).toHaveTextContent('Enable MFA for alice')
  })
})

// ── R3 polling ──

describe('R3 scan running', () => {
  it('Sync is disabled and says a scan is running; coverage is polled every 60 s only while it runs, never in the background', async () => {
    m.responses['GET /api/services/coverage'] = ok(coverage({ scan_in_progress: { since: hoursAgo(0.25) } }))
    const { client } = await renderSettled()
    const buttons = screen.getAllByRole('button', { name: /Scan running…/ })
    expect(buttons).toHaveLength(2)
    for (const b of buttons) { expect(b).toBeDisabled(); expect(b).toHaveAttribute('aria-describedby', 'infra-scan-running') }
    expect(document.getElementById('infra-scan-running')).toHaveTextContent('A scan is already running for this AWS account.')
    const query = client.getQueryCache().find({ queryKey: ['services-coverage', 'org-test'] })!
    // The observer's options (useQuery's), not the cache entry's QueryOptions type.
    const options = query.options as unknown as { refetchInterval: (q: unknown) => number | false; refetchIntervalInBackground: boolean }
    expect(options.refetchInterval(query)).toBe(60_000)
    expect(options.refetchInterval({ state: { data: coverage() } })).toBe(false)
    expect(options.refetchIntervalInBackground).toBe(false)
  })
})

// ── States ──

describe('R4 states', () => {
  it('S1 no account: the connect card only; no tiles, table, cost or ownership; no Sync', async () => {
    noAccount()
    await renderSettled()
    expect(screen.getByRole('heading', { level: 2, name: 'No AWS account connected' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Connect AWS →' })).toHaveAttribute('href', '/connect-aws')
    for (const name of ['Summary', 'What needs attention', 'Cost by AWS service', 'Ownership gaps']) expect(screen.queryByRole('heading', { name })).toBeNull()
    expect(screen.queryByRole('button', { name: /Sync/ })).toBeNull()
    expect(screen.getByText('Nothing has been checked yet.')).toBeInTheDocument()
  })
  it.each(Object.keys(CONNECTED_STATES))('renders without throwing (%s)', async (state) => {
    CONNECTED_STATES[state]()
    const pending = state === 'loading' ? 7 : state === 'coverage loading' ? 1 : 0
    await renderSettled(pending)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Infrastructure Overview')
    // O-S9 over the page: only the exact approved S3/CloudFront sentence may say "every region".
    const text = (document.body.textContent ?? '').split(footerText(coverage()) ?? '\u0000').join(' ')
    expect(text).not.toMatch(/healthy|all good|secure\b|no issues|real-time|every region|all regions|complete coverage|zero risk|act now|recoverable|nothing to worry|fully/i)
  })
  it('loading: no zeros are printed', async () => {
    CONNECTED_STATES.loading()
    await renderSettled(7)
    const main = document.querySelector('main')!
    expect(main.textContent).not.toMatch(/\$0|\b0 of\b|: 0\b/)
  })
})

// ── N1 / RU-3: the savings link ──

describe('RU-3 the savings tile\'s "Review recommendations →" link', () => {
  it.each(Object.keys(CONNECTED_STATES))('is in the savings tile with an AWS account connected (%s)', async (state) => {
    CONNECTED_STATES[state]()
    const pending = state === 'loading' ? 7 : state === 'coverage loading' ? 1 : 0
    await renderSettled(pending)
    const tile = screen.getByTestId('infra-tile-savings')
    expect(within(tile).getByRole('link', { name: 'Review recommendations →' })).toHaveAttribute('href', '/cost-optimization')
  })
  it('is absent with no AWS account (S1): no savings tile, no link', async () => {
    noAccount()
    await renderSettled()
    expect(screen.queryByTestId('infra-tile-savings')).toBeNull()
    expect(screen.queryByRole('link', { name: /Review recommendations/ })).toBeNull()
  })
})

// ── R7 / R7b / F6: requests ──

describe('R7 / R7b / F6 requests', () => {
  it('a page view makes exactly V1–V7, once each', async () => {
    await renderSettled()
    expect([...m.log].sort()).toEqual([...V2_ENDPOINTS].sort())
  })
  it.each([...Object.keys(CONNECTED_STATES), 'no account'])('never calls /api/observability/* or the legacy-only endpoints (%s)', async (state) => {
    if (state === 'no account') noAccount(); else CONNECTED_STATES[state]()
    const pending = state === 'loading' ? 7 : state === 'coverage loading' ? 1 : 0
    await renderSettled(pending)
    expect(observability()).toEqual([])
    expect(m.log).not.toContain('fetch /api/anomalies')
    expect(m.log).not.toContain('GET /api/platform/stats/dashboard')
    expect(m.log).not.toContain('GET /api/cost-recommendations')
    expect(m.log.filter((l) => l === 'GET /api/cost-recommendations/stats').length).toBeLessThanOrEqual(1)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
  it.each(['demo', 'sales demo'])('%s: the legacy page with its demo data, and no request at all', async (mode) => {
    if (mode === 'demo') m.demo = true; else m.salesDemo = true
    renderInfrastructure()
    await screen.findByText('AWS System Intelligence')
    await waitFor(() => expect(screen.getAllByText(/resources \(demo data\)/).length).toBeGreaterThan(0))
    expect(m.log).toEqual([])
    expect(observability()).toEqual([])
  })
  it('after Sync: still no CloudWatch endpoint (legacy keys are marked stale, not fetched)', async () => {
    await renderSettled()
    fireEvent.click(screen.getAllByRole('button', { name: /Sync now/ })[1])
    await screen.findByText('Sync Complete')
    expect(observability()).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

// ── R8 / SY-1: Sync ──

describe('R8 / SY-1 Sync', () => {
  it('invalidates the V2 keys and the legacy keys', async () => {
    const { client } = await renderSettled()
    const spy = vi.spyOn(client, 'invalidateQueries')
    fireEvent.click(screen.getAllByRole('button', { name: /Sync now/ })[1])
    await screen.findByText('Sync Complete')
    const keys = spy.mock.calls.map(([f]) => JSON.stringify((f as { queryKey: unknown }).queryKey))
    for (const key of [
      ['services-coverage', 'org-test'], ['services-stats', 'org-test'], ['infra-overview-attention', 'org-test'], ['account-security-findings', 'org-test'],
      ['cost-recommendations-stats', 'org-test'], ['infra-overview-limit', 'org-test'],
      ['infrastructure'], ['infrastructure-all'], ['services-stats'], ['cost-recommendations-count'], ['system-intelligence'], ['top-actions'],
      ['platform-dashboard-stats'], ['cost-recommendations-stats'], ['risk-score-trend'], ['risk-score-current'], ['account-security-findings'], ['account-security-findings-stats'],
    ]) expect(keys).toContain(JSON.stringify(key))
    expect(keys).not.toContain(JSON.stringify(['platform-cost-summary', 'org-test']))
    expect(toast.success).toHaveBeenCalledWith('Sync complete — 9 resources discovered')
  })
  it('success: "Sync Complete" (desktop) and "Done" (phone) in green for 3 s, then "Sync now"', async () => {
    await renderSettled()
    fireEvent.click(screen.getAllByRole('button', { name: /Sync now/ })[0])
    const desktop = (await screen.findByText('Sync Complete')).closest('button')!
    const phone = screen.getByText('Done').closest('button')!
    for (const b of [desktop, phone]) expect(b.className).toMatch(/bg-emerald-600/)
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Sync now/ })).toHaveLength(2), { timeout: 4500 })
    expect(screen.queryByText('Sync Complete')).toBeNull()
  }, 10_000)
  it('failure: no green state, the legacy error toast', async () => {
    m.responses['POST /api/services/discover'] = fail()
    await renderSettled()
    fireEvent.click(screen.getAllByRole('button', { name: /Sync now/ })[1])
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Sync failed — check your AWS connection'))
    expect(screen.queryByText('Sync Complete')).toBeNull()
    expect(document.querySelector('.bg-emerald-600')).toBeNull()
  })
})

// ── PB-2 / PB-2b: the resource-limit prompt ──

describe('PB-2 / PB-2b the resource-limit prompt', () => {
  it('a 402 from GET /api/infrastructure shows it', async () => {
    m.responses['GET /api/infrastructure'] = fail(402)
    await renderSettled()
    expect(screen.getByTestId('infra-limit-prompt')).toHaveTextContent("You've reached your resource limit.")
  })
  it('a 402 from Sync shows it', async () => {
    m.responses['POST /api/services/discover'] = fail(402)
    await renderSettled()
    expect(screen.queryByTestId('infra-limit-prompt')).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: /Sync now/ })[1])
    expect(await screen.findByTestId('infra-limit-prompt')).toBeInTheDocument()
  })
  it('200: none; GET /api/infrastructure is read once per mount (not polled) and its body never reaches the page', async () => {
    const { container, client } = await renderSettled()
    expect(screen.queryByTestId('infra-limit-prompt')).toBeNull()
    const options = client.getQueryCache().find({ queryKey: ['infra-overview-limit', 'org-test'] })!.options as { refetchInterval?: unknown }
    expect(options.refetchInterval).toBeUndefined()
    await new Promise((r) => setTimeout(r, 300))
    expect(m.log.filter((l) => l === 'GET /api/infrastructure')).toHaveLength(1)
    expect(container.innerHTML).not.toMatch(/SENTINEL|9876/)
  })
})

// ── O-H1: the hidden cost ──

describe('O-H1 the attention order uses monthly_cost without showing it', () => {
  it('no cost figure in any text or attribute; the order still follows it', async () => {
    m.responses['GET /api/services'] = ok(attentionPage([
      service('cheap', { priority_severity: 'high', attention_cause: 'finding', reason: 'Issue A', monthly_cost: 1234.57 }),
      service('dear', { priority_severity: 'high', attention_cause: 'finding', reason: 'Issue B', monthly_cost: 4321.98 }),
    ]))
    m.responses['GET /api/security/account-findings'] = ok([])
    const { container } = await renderSettled()
    expect(container.innerHTML).not.toMatch(/4321|4,321|1234|1,234/)
    const rows = within(screen.getByRole('region', { name: 'What needs attention' }).querySelector('tbody')!).getAllByRole('rowheader').map((r) => r.textContent)
    expect(rows).toEqual(['Issue B', 'Issue A'])
  })
})

// ── RU-1 / RU-2 / R9: the V2 source ──

describe('RU-1 / RU-2 / R9 V2 source rules', () => {
  const dir = join(process.cwd(), 'app/(app)/infrastructure/overview')
  const sources = readdirSync(dir).filter((f) => /\.tsx?$/.test(f)).map((f) => ({ f, src: readFileSync(join(dir, f), 'utf8') }))
  it('RU-1 no per-resource cost list: not built on, nor re-implementing, largestEstimatedCosts', () => {
    for (const { f, src } of sources) expect(src, f).not.toMatch(/largestEstimatedCosts|barWidth|Largest estimated|costByResource/)
  })
  it('RU-2 no lifecycle rule re-encoded (no raw EBS states, no mapStatus-like switch, no stateLabel copy)', () => {
    for (const { f, src } of sources) {
      expect(src, f).not.toMatch(/'in-use'|'available'|unattached|mapStatus|lifecycleStateLabel|isStoppedOrPendingState|isRunningOrNormalState/)
      expect(src, f).not.toMatch(/case 'stopped'|case 'running'/)
    }
  })
  it('R9 spacing only from the 4/8/12/16/24/32 scale; one violet button per section', () => {
    const spacing = /\b-?(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y|space-x|space-y)-([0-9.]+|\[[^\]]+\])/g
    for (const { f, src } of sources) {
      for (const [, value] of src.matchAll(spacing)) expect(['0', '1', '2', '3', '4', '6', '8'], `${f}: ${value}`).toContain(value)
    }
    const violetButtons = sources.flatMap(({ f, src }) => [...src.matchAll(/bg-violet-700/g)].map(() => f))
    expect(violetButtons.sort()).toEqual(['OverviewFooter.tsx', 'OverviewHeader.tsx', 'PlanBanners.tsx'])
  })
})

// ── PB-1: the banners match the legacy page's ──

describe('PB-1 plan banners and the limit prompt: the same text and links as the legacy page', () => {
  /** The banner holding `text`: its text and its links. */
  async function banner(text: RegExp) {
    const el = (await screen.findByText(text)).closest('div')!
    const box = el.querySelector('a') ? el : el.parentElement!
    return { text: box.textContent, hrefs: [...box.querySelectorAll('a')].map((a) => a.getAttribute('href')) }
  }
  async function both(text: RegExp) {
    vi.stubEnv('NEXT_PUBLIC_INFRA_OVERVIEW_V2', 'false')
    const legacy = renderInfrastructure()
    const off = await banner(text)
    legacy.unmount()
    vi.stubEnv('NEXT_PUBLIC_INFRA_OVERVIEW_V2', 'true')
    renderInfrastructure()
    await screen.findByRole('heading', { level: 1, name: 'Infrastructure Overview' })
    const on = await banner(text)
    return { off, on }
  }
  it('Free plan', async () => {
    m.plan = { isFree: true, isStarter: false, isPro: false, tier: 'free' }
    const { off, on } = await both(/Free plan shows EC2, RDS, and S3 only\./)
    expect(on).toEqual(off)
    expect(on.hrefs).toEqual(['/settings/billing/upgrade'])
  })
  it('Starter plan', async () => {
    m.plan = { isFree: false, isStarter: true, isPro: false, tier: 'starter' }
    const { off, on } = await both(/Starter plan shows 15 resource types\./)
    expect(on).toEqual(off)
  })
  it('the resource-limit prompt (402)', async () => {
    m.responses['GET /api/infrastructure'] = fail(402)
    const { off, on } = await both(/reached your resource limit/)
    expect(on).toEqual(off)
    expect(on.hrefs).toEqual(['/settings/billing/upgrade'])
  })
})

// ── P1-2: never summed, in the page ──

describe('O-K2c never summed, as rendered', () => {
  it('the Open findings tile, the status headline and the attention description never add the two sources', async () => {
    // Resource findings 8, open account findings 4 (sum 12); 23 resources and 2 critical/high account findings in the table (sum 25).
    m.responses['GET /api/services'] = ok(attentionPage(undefined, 23))
    await renderSettled()
    const tile = screen.getByTestId('infra-tile-findings')
    expect(within(tile).getByTestId('infra-findings-resources')).toHaveTextContent(/^On resources8/)
    expect(within(tile).getByTestId('infra-findings-account')).toHaveTextContent(/^Account-level \(security groups, IAM users\)4/)
    const description = screen.getByTestId('infra-attention-description')
    expect(description).toHaveTextContent('23 resources · 2 account-level findings.')
    const status = screen.getByRole('heading', { level: 2, name: /findings need review/ })
    // Text node by text node, so adjacent elements ("Low 1" + "2 dismissed") don't run together into a false "12".
    const words = (el: Element) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      const parts: string[] = []
      while (walker.nextNode()) parts.push(walker.currentNode.textContent ?? '')
      return parts.join(' ')
    }
    for (const el of [tile, description, status]) {
      expect(words(el)).not.toMatch(/\b(12|25)\b/)
      expect(words(el)).not.toMatch(/total|in all|combined|altogether/i)
    }
    const region = screen.getByRole('region', { name: 'What needs attention' })
    expect(words(region)).not.toMatch(/\b25\b|in all|combined/i)
  })
})

// ── P2-1: the empty state says what is known ──

describe('the attention empty state, per source', () => {
  const none = () => { m.responses['GET /api/services'] = ok(attentionPage([])); m.responses['GET /api/security/account-findings'] = ok([]) }
  it('both loaded, nothing found: "Nothing needs review" with its scope', async () => {
    none()
    await renderSettled()
    expect(screen.getByTestId('infra-attention-empty')).toHaveTextContent('Nothing needs review from the last scan.Checked: us-east-1 (1 of 17 enabled regions).')
  })
  it('account findings failed: never "Nothing needs review"', async () => {
    none()
    m.responses['GET /api/security/account-findings'] = fail()
    await renderSettled()
    const region = screen.getByRole('region', { name: 'What needs attention' })
    expect(screen.getByTestId('infra-attention-empty')).toHaveTextContent(OVERVIEW_COPY.attentionEmptyAccountError)
    expect(region.textContent).not.toMatch(/Nothing needs review/)
    expect(within(region).getByRole('alert')).toHaveTextContent(OVERVIEW_COPY.accountFindingsError)
  })
  it('the resource list failed: never "Nothing needs review"; the account rows still show', async () => {
    m.responses['GET /api/services'] = fail()
    await renderSettled()
    const region = screen.getByRole('region', { name: 'What needs attention' })
    expect(region.textContent).not.toMatch(/Nothing needs review/)
    expect(within(region).getAllByRole('alert')[0]).toHaveTextContent(OVERVIEW_COPY.resourcesError)
    expect(within(region.querySelector('table')!).getAllByRole('rowheader').map((r) => r.textContent)).toEqual(['SSH open to the world', 'Console user without MFA'])
  })
  it('the resource list failed and no account findings: says which side is known', async () => {
    m.responses['GET /api/services'] = fail()
    m.responses['GET /api/security/account-findings'] = ok([])
    await renderSettled()
    expect(screen.getByTestId('infra-attention-empty')).toHaveTextContent(OVERVIEW_COPY.attentionEmptyResourceError)
  })
  it('both failed: the error card, nothing else; Retry reads both lists again', async () => {
    m.responses['GET /api/services'] = fail()
    m.responses['GET /api/security/account-findings'] = fail()
    const { client } = await renderSettled()
    const region = screen.getByRole('region', { name: 'What needs attention' })
    expect(within(region).getByRole('alert')).toHaveTextContent(OVERVIEW_COPY.attentionError)
    expect(region.textContent).not.toMatch(/Nothing needs review/)
    const n = m.log.length
    fireEvent.click(within(region).getByRole('button', { name: /Retry/ }))
    await settled(client)
    expect(m.log.slice(n).sort()).toEqual(['GET /api/security/account-findings', 'GET /api/services'])
  })
})

// ── O-AC in the page ──

describe('O-AC the alarm line, as rendered', () => {
  it('exactly the constant and its link: no count, no percent', async () => {
    await renderSettled()
    const line = screen.getByTestId('infra-checked-alarms')
    expect(line.textContent).toBe(`${OVERVIEW_COPY.alarms} ${OVERVIEW_COPY.alarmsLink}`)
    expect((line.textContent ?? '').replace(/\bEC2\b/g, '')).not.toMatch(/[0-9%]/)
    expect(within(line).getByRole('link', { name: OVERVIEW_COPY.alarmsLink })).toHaveAttribute('href', '/observability/alert-history')
  })
})

// ── P2-3: polling, observed ──

describe('polling, observed on a fake clock', () => {
  /** Timers faked from the start (Date included), advancing with real time so the waits still work. */
  async function withFakeClock(run: () => Promise<void>) {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'], shouldAdvanceTime: true, now: NOW })
    try { await run() } finally {
      focusManager.setFocused(undefined)
      vi.useRealTimers()
      vi.useFakeTimers({ toFake: ['Date'], now: NOW })
    }
  }
  it('no scan running: nothing is requested again over 5 minutes', async () => {
    await withFakeClock(async () => {
      const { client } = await renderSettled()
      const n = m.log.length
      await vi.advanceTimersByTimeAsync(5 * 60_000)
      await settled(client)
      expect(m.log.slice(n)).toEqual([])
    })
  })
  it('a scan running: only coverage, once a minute; nothing while the tab is hidden', async () => {
    m.responses['GET /api/services/coverage'] = ok(coverage({ scan_in_progress: { since: hoursAgo(0.25) } }))
    await withFakeClock(async () => {
      const { client } = await renderSettled()
      const n = m.log.length
      await vi.advanceTimersByTimeAsync(5 * 60_000 + 1_000)
      await settled(client)
      expect(m.log.slice(n)).toEqual(Array(5).fill('GET /api/services/coverage'))
      focusManager.setFocused(false)
      const hidden = m.log.length
      await vi.advanceTimersByTimeAsync(3 * 60_000)
      expect(m.log.slice(hidden)).toEqual([])
    })
  })
  it('every V2 query: only coverage has a refetch interval; none refetches on focus', async () => {
    const { client } = await renderSettled()
    const queries = client.getQueryCache().getAll()
    expect(queries.map((q) => q.queryKey[0]).sort()).toEqual([
      'account-security-findings', 'cost-recommendations-stats', 'infra-overview-attention', 'infra-overview-limit',
      'platform-cost-summary', 'services-coverage', 'services-stats',
    ])
    for (const q of queries) {
      const o = q.options as { refetchInterval?: unknown; refetchOnWindowFocus?: unknown }
      if (q.queryKey[0] === 'services-coverage') expect(typeof o.refetchInterval).toBe('function')
      else expect(o.refetchInterval, String(q.queryKey[0])).toBeUndefined()
      expect(o.refetchOnWindowFocus, String(q.queryKey[0])).toBe(false)
    }
  })
  it('account findings are read in full: getActive() with no limit', async () => {
    await renderSettled()
    expect(m.calls.filter((c) => c.endpoint === 'GET /api/security/account-findings').map((c) => c.args)).toEqual([[]])
  })
})

// ── P1-1: share, as rendered ──

describe('cost by service share, as rendered', () => {
  it('one decimal for display; the raw ratio never printed', async () => {
    m.responses['GET /api/platform/costs/summary'] = ok(billedSummary({ amount: 300, top: [
      { service: 'EC2', amount: 100, sharePercent: 100 / 3 },
      { service: 'KMS', amount: 0.12, sharePercent: 0.04 },
    ] }))
    await renderSettled()
    const table = screen.getByRole('region', { name: 'Cost by AWS service' }).querySelector('table')!
    const shares = [...table.querySelectorAll('tbody tr')].map((tr) => tr.lastElementChild!.textContent)
    expect(shares).toEqual(['33.3%', '<0.1%', ''])
    expect(table.textContent).not.toMatch(/33\.33/)
  })
})

// ── P2-7: the reason line wraps on a phone ──

describe('the status reason line', () => {
  it('wraps below sm and is one line from sm up', async () => {
    await renderSettled()
    const classes = screen.getByTestId('infra-status-reason').className.split(' ')
    expect(classes).toContain('break-words')
    expect(classes).toContain('sm:truncate')
    expect(classes).not.toContain('truncate')
  })
})
