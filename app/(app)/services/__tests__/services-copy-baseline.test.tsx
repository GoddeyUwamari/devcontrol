/**
 * Services copy (light-lane PR), pinned through the real ServicesPage with
 * NEXT_PUBLIC_SERVICES_V2=true and synthetic data: the header and the AWS
 * status line (with and without region coverage, M6), every PHASE 2 / Coming
 * soon tag with the text around it, the Owner cells of Your services, and the
 * Needs attention tile. Each region is dumped as text lines into
 * __fixtures__/services-copy/. A change in any of them shows up as a diff of
 * those files. To regenerate after an approved change:
 *   SERVICES_COPY_FIXTURES=write npx vitest run services-copy-baseline
 *
 * Fixed clock (Date only): 2026-10-22T15:00:00Z, TZ UTC. Synthetic data only.
 */
process.env.TZ = 'UTC'

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { cleanup, screen, within } from '@testing-library/react'
import type { ServicesCoverage } from '@/lib/services/aws-services.service'
import { emptyPage, prodCoverage, renderPage, STATS } from './m6-fixtures'

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

const registered = vi.hoisted(() => ({ data: [] as unknown[] }))
vi.mock('@/lib/hooks/use-registered-services', () => ({
  useRegisteredServices: () => ({ isPending: false, isError: false, isSuccess: true, data: registered.data, refetch: () => {} }),
}))

const mockGetStats = vi.fn()
const mockGetCoverage = vi.fn()
vi.mock('@/lib/services/aws-services.service', () => ({
  default: {
    getServices: async (req: any = {}) => emptyPage(req.limit ?? 50),
    getStats: () => mockGetStats(),
    getCoverage: () => mockGetCoverage(),
    discoverServices: vi.fn(),
  },
}))
vi.mock('@/lib/services/aws-accounts.service', () => ({ default: { getAccountsAndConnection: async () => ({ accounts: [{ id: 'acct-1' }], connection: 'connected' }) } }))
vi.mock('@/lib/services/platform-stats.service', () => ({
  platformStatsService: {
    getCostSummary: async () => ({
      spend: { state: 'available', source: 'cost_explorer', provenance: 'actual', asOf: null, coverage: null, reason: null,
        data: { amount: 4321.5, basis: 'billed_month_to_date', lastDayInProgress: true, finishedThrough: '2026-10-21' } },
      monthOverMonth: { state: 'unavailable', source: 'x', provenance: null, asOf: null, coverage: null, reason: null, data: null },
    }),
  },
}))

const DIR = path.join(__dirname, '__fixtures__', 'services-copy')
const WRITE = process.env.SERVICES_COPY_FIXTURES === 'write'

function pin(name: string, value: unknown): void {
  const file = path.join(DIR, name)
  const body = `${JSON.stringify(value, null, 2)}\n`
  if (WRITE) {
    fs.mkdirSync(DIR, { recursive: true })
    fs.writeFileSync(file, body)
  }
  expect(body).toBe(fs.readFileSync(file, 'utf8'))
}

// ── Synthetic inputs ──

const NOW = Date.parse('2026-10-22T15:00:00Z')
const at = (h: number) => new Date(NOW - h * 3600_000).toISOString()

const SERVICE = (id: string, owner: string) => ({
  id, name: `svc-${id}`, owner, teamId: null, teamName: 'platform', githubUrl: null, createdAt: '2026-10-01T12:00:00Z',
})
/** An automation identity, a real owner, a blank owner, and a near-miss that is not on the list. */
const REGISTERED = [
  SERVICE('webhook', 'github-actions@webhook'),
  SERVICE('person', 'alice@example.com'),
  SERVICE('blank', ''),
  SERVICE('near', 'GitHub-Actions@webhook'),
]

const COVERAGE: Record<string, () => ServicesCoverage> = {
  finished: () => prodCoverage(NOW),
  running: () => prodCoverage(NOW, {}, {
    scan_in_progress: { since: at(0.2) },
    last_scan: { status: 'running', started_at: at(0.2), completed_at: null, warnings: [] },
  }),
  failed: () => prodCoverage(NOW, {}, {
    last_scan: { status: 'failed', started_at: at(1.1), completed_at: at(1), warnings: [] },
  }),
  none: () => prodCoverage(NOW, {}, {
    last_completed_scan: null, last_successful_scan_at: null, last_scan: null,
  }),
  'not connected': () => ({
    account: { connected: false, status: null, home_region: null },
    scope: { home_region: null, s3: { in_last_scan: false, regions: [] }, cloudfront: { in_last_scan: false, count: 0 }, enabled_regions: { known: false, count: null } },
    region_status: [], scan_in_progress: null, last_completed_scan: null, last_successful_scan_at: null, last_scan: null,
    resource_types: null, tags_unknown_by_type: {}, regions: [], total: 0,
  }),
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
  vi.stubEnv('NEXT_PUBLIC_SERVICES_V2', 'true')
  registered.data = REGISTERED
  mockGetStats.mockResolvedValue(STATS)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

// ── Dumps ──

/** One entry per element child, its text with runs of space collapsed. */
const lines = (el: Element) => [...el.children].map((c) => (c.textContent ?? '').replace(/\s+/g, ' ').trim())

/** The h1's column: title, subtitle and whatever sits under them. */
function header(): string[] {
  return lines(screen.getByRole('heading', { level: 1 }).parentElement!)
}

/** The first row of the coverage card: connection, region headline, scan time, link. */
function statusLine(): string[] {
  const card = screen.getByRole('region', { name: 'Account and scan coverage' })
  return lines(card.firstElementChild!)
}

async function settledPage(coverage: ServicesCoverage, m6: boolean) {
  vi.stubEnv('NEXT_PUBLIC_SERVICES_COVERAGE_M6', m6 ? 'true' : 'false')
  mockGetCoverage.mockResolvedValue(coverage)
  renderPage()
  // Coverage, stats and the cost summary have all arrived.
  await screen.findByRole('region', { name: 'Account and scan coverage' })
  await within(screen.getByRole('region', { name: 'Summary' })).findByText('$4,321.50')
  if (coverage.account.connected) await screen.findAllByText(/AWS account connected/)
  else await screen.findAllByText('No AWS account connected')
}

describe('baseline: Services header and AWS status line', () => {
  it('every scan state, with and without region coverage (M6)', async () => {
    const out: Record<string, { header: string[]; statusLine: string[] }> = {}
    for (const m6 of [false, true]) {
      for (const [state, make] of Object.entries(COVERAGE)) {
        await settledPage(make(), m6)
        out[`${state}, M6 ${m6 ? 'on' : 'off'}`] = { header: header(), statusLine: statusLine() }
        cleanup()
      }
    }
    pin('header-status-line.json', out)
  })
})

describe('baseline: PHASE 2 tags, owner cells and the Needs attention tile', () => {
  it('the page with an unmapped inventory and four registered services', async () => {
    await settledPage(COVERAGE.finished(), false)
    await screen.findByText('svc-webhook')
    const tags = [...document.querySelectorAll('span.bg-violet-100')].map((tag) => ({
      tag: tag.textContent,
      uppercase: tag.classList.contains('uppercase'),
      context: (tag.parentElement?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    }))
    pin('phase-tags.json', tags)

    const table = within(screen.getByRole('region', { name: 'Your services' })).getByRole('table')
    const owners = within(table).getAllByRole('row').slice(1).map((row) => {
      const cells = within(row).getAllByRole('cell')
      return { service: cells[0].textContent, owner: cells[1].textContent }
    })
    pin('owner-cells.json', owners)
  })

  it('Needs attention tile: N = 7, 1 and 0', async () => {
    const out: Record<string, string[]> = {}
    for (const healthy of [7, 1, 0]) {
      mockGetStats.mockResolvedValue({ ...STATS, total: healthy + 2, healthy, needs_attention: 2, attention_by_severity: { critical: 0, high: 2, medium: 0, low: 0 } })
      await settledPage(COVERAGE.finished(), false)
      const tile = screen.getByRole('heading', { level: 2, name: 'Needs attention' }).parentElement!
      out[`healthy ${healthy}`] = lines(tile)
      cleanup()
    }
    pin('needs-attention-tile.json', out)
  })
})
