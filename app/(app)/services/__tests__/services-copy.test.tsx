/**
 * Services copy (light-lane PR):
 * - "Last scan: <time>" on its own line under the subtitle, from the shared
 *   scanLine (Security's and the Dashboard's source, format and running /
 *   failed / none wording); the AWS status line keeps connection and region only;
 * - "PHASE 2" → "Coming soon" everywhere on the page;
 * - a known automation owner ('github-actions@webhook') reads "No owner set";
 *   a real owner reads as before; the stored owner is untouched;
 * - "N resources with no flagged issues" / "1 resource with no flagged issues".
 * Fixed clock (Date only): 2026-10-22T15:00:00Z, TZ UTC. Synthetic data only.
 */
process.env.TZ = 'UTC'

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { cleanup, render, screen, within } from '@testing-library/react'
import type { ServicesCoverage } from '@/lib/services/aws-services.service'
import type { RegisteredService } from '@/lib/types'
import { scanLine } from '../../security/overview/securityModel'
import { emptyPage, prodCoverage, renderPage, STATS } from './m6-fixtures'
import { AUTOMATION_OWNERS, isAutomationOwner, NO_OWNER_SET, serviceOwnerLabel } from '../ownership'
import { noFlaggedIssuesCaption, SummaryTiles } from '../SummaryTiles'
import { YourServices } from '../YourServices'
import { RegisteredServices } from '../RegisteredServices'

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

const mockGetCoverage = vi.fn()
const mockGetStats = vi.fn()
vi.mock('@/lib/services/aws-services.service', () => ({
  default: {
    getServices: async (req: any = {}) => emptyPage(req.limit ?? 50),
    getStats: () => mockGetStats(),
    getCoverage: () => mockGetCoverage(),
    discoverServices: vi.fn(),
  },
}))
vi.mock('@/lib/services/aws-accounts.service', () => ({ default: { getAccountsAndConnection: async () => ({ accounts: [{ id: 'acct-1' }], connection: 'connected' }) } }))
vi.mock('@/lib/services/platform-stats.service', () => ({ platformStatsService: { getCostSummary: async () => { throw new Error('not needed') } } }))

const NOW = Date.parse('2026-10-22T15:00:00Z')
const at = (h: number) => new Date(NOW - h * 3600_000).toISOString()

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
  vi.stubEnv('NEXT_PUBLIC_SERVICES_V2', 'true')
  registered.data = []
  mockGetStats.mockResolvedValue(STATS)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

// ── Last scan ──

const COVERAGE: Record<string, () => ServicesCoverage> = {
  finished: () => prodCoverage(NOW),
  running: () => prodCoverage(NOW, {}, { scan_in_progress: { since: at(0.2) }, last_scan: { status: 'running', started_at: at(0.2), completed_at: null, warnings: [] } }),
  failed: () => prodCoverage(NOW, {}, { last_scan: { status: 'failed', started_at: at(1.1), completed_at: at(1), warnings: [] } }),
  none: () => prodCoverage(NOW, {}, { last_completed_scan: null, last_successful_scan_at: null, last_scan: null }),
}
const EXPECTED: Record<string, [string, string]> = {
  finished: ['finished', 'Last scan: today, 1:00 PM'],
  running: ['running', 'Scan running…'],
  failed: ['failed', 'Last scan failed: today, 2:00 PM'],
  none: ['none', 'No scan has finished yet.'],
}

async function page(coverage: ServicesCoverage, m6: boolean) {
  vi.stubEnv('NEXT_PUBLIC_SERVICES_COVERAGE_M6', m6 ? 'true' : 'false')
  mockGetCoverage.mockResolvedValue(coverage)
  renderPage()
  await screen.findAllByText(/AWS account connected/)
}

const strip = () => screen.getByRole('region', { name: 'Account and scan coverage' })

describe('the header "Last scan" line', () => {
  for (const m6 of [false, true]) {
    it.each(Object.keys(COVERAGE))(`%s (M6 ${m6 ? 'on' : 'off'}): its own line directly under the subtitle; the status line has no scan time`, async (state) => {
      const coverage = COVERAGE[state]()
      await page(coverage, m6)
      const line = await screen.findByTestId('services-scan-line')
      const [kind, text] = EXPECTED[state]
      expect(line).toHaveTextContent(new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))
      expect(line).toHaveAttribute('data-state', kind)
      // Same text as Security's and the Dashboard's line for the same response.
      expect(line.textContent).toBe(scanLine({ status: 'ready', data: coverage }, NOW)!.text)
      // Placement: the title column, right after the subtitle, on its own line.
      const column = screen.getByRole('heading', { level: 1 }).parentElement!
      expect([...column.children].map((c) => c.tagName)).toEqual(['H1', 'P', 'P'])
      expect(column.children[1]).toHaveTextContent("What we found, what needs attention, who owns it, and what we haven't verified yet.")
      expect(column.children[2]).toBe(line)
      // The status line: connection and region info only.
      const status = strip().firstElementChild!
      expect(status).toHaveTextContent('AWS account connected')
      expect(status).not.toHaveTextContent(/Last (successful )?scan|Scan in progress|No successful scan|finished|today|\bago\b/)
      expect(within(strip()).queryByRole('status')).toBeNull()
    })
  }

  it('no AWS account connected: no scan line', async () => {
    vi.stubEnv('NEXT_PUBLIC_SERVICES_COVERAGE_M6', 'false')
    mockGetCoverage.mockResolvedValue({ ...prodCoverage(NOW), account: { connected: false, status: null, home_region: null }, scope: { home_region: null, s3: { in_last_scan: false, regions: [] }, cloudfront: { in_last_scan: false, count: 0 }, enabled_regions: { known: false, count: null } } })
    renderPage()
    await screen.findAllByText('No AWS account connected')
    expect(screen.queryByTestId('services-scan-line')).toBeNull()
  })

  it('coverage loading or failed: no scan line', async () => {
    vi.stubEnv('NEXT_PUBLIC_SERVICES_COVERAGE_M6', 'false')
    mockGetCoverage.mockRejectedValue(new Error('synthetic'))
    renderPage()
    expect(screen.queryByTestId('services-scan-line')).toBeNull()
    await screen.findByText('Scan coverage could not be loaded.')
    expect(screen.queryByTestId('services-scan-line')).toBeNull()
  })
})

// ── PHASE 2 → Coming soon ──

describe('no "PHASE 2" left', () => {
  it('rendered page: every tag reads "Coming soon", in sentence case', async () => {
    registered.data = [SERVICE('person', 'alice@example.com')]
    await page(COVERAGE.finished(), false)
    await screen.findByText('Map resources to services')
    expect(document.body.textContent).not.toMatch(/phase\s*2/i)
    const tags = [...document.querySelectorAll('span.bg-violet-100')]
    // Five here (the spend tile's "per service" tag needs billed spend, which this file's mock does not send); all six are in the baseline's phase-tags.json.
    expect(tags).toHaveLength(5)
    for (const tag of tags) {
      expect(tag.textContent).toBe('Coming soon')
      expect(tag.className).not.toMatch(/\buppercase\b/)
    }
  })

  it('source: no Services file says Phase 2 or imports PhaseTwoTag', () => {
    const dir = path.join(__dirname, '..')
    const files = fs.readdirSync(dir).filter((f) => /\.(tsx?|ts)$/.test(f))
    expect(files).toContain('ComingSoonTag.tsx')
    expect(files).not.toContain('PhaseTwoTag.tsx')
    for (const f of files) expect(`${f}: ${fs.readFileSync(path.join(dir, f), 'utf8')}`).not.toMatch(/Phase\s*2|PhaseTwo/i)
  })
})

// ── Owner ──

const SERVICE = (id: string, owner: string): RegisteredService => ({
  id, name: `svc-${id}`, owner, teamId: null, teamName: 'platform', githubUrl: null, createdAt: '2026-10-01T12:00:00Z',
})

describe('service owner display', () => {
  it('the list is explicit: exactly github-actions@webhook', () => {
    expect(AUTOMATION_OWNERS).toEqual(['github-actions@webhook'])
  })

  it.each([
    ['github-actions@webhook', null],
    ['  github-actions@webhook ', null],
    ['', null],
    ['   ', null],
    ['alice@example.com', 'alice@example.com'],
    // No pattern guessing: near misses are real values.
    ['GitHub-Actions@webhook', 'GitHub-Actions@webhook'],
    ['github-actions@webhook.example', 'github-actions@webhook.example'],
    ['ci-bot@webhook', 'ci-bot@webhook'],
    ['github-actions', 'github-actions'],
  ])('%j → %j', (owner, label) => {
    expect(serviceOwnerLabel(owner)).toBe(label)
    expect(isAutomationOwner(owner)).toBe(owner.trim() === 'github-actions@webhook')
  })

  it('Your services: the automation owner reads "No owner set", a real owner as today; the stored value is untouched', () => {
    const services = [SERVICE('webhook', 'github-actions@webhook'), SERVICE('person', 'alice@example.com'), SERVICE('near', 'GitHub-Actions@webhook')]
    const before = JSON.stringify(services)
    render(<YourServices state={{ status: 'ready', services }} mappedToService={undefined} totalResources={undefined} />)
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1)
    expect(rows.map((r) => within(r).getAllByRole('cell')[1].textContent)).toEqual([NO_OWNER_SET, 'alice@example.com', 'GitHub-Actions@webhook'])
    expect(JSON.stringify(services)).toBe(before)
    expect(services[0].owner).toBe('github-actions@webhook')
  })

  it('the legacy registered-services table (flag off) applies the same list; other values as before', async () => {
    registered.data = [SERVICE('webhook', 'github-actions@webhook'), SERVICE('person', 'alice@example.com'), SERVICE('blank', '')]
    render(<RegisteredServices />)
    const rows = within(await screen.findByRole('table')).getAllByRole('row').slice(1)
    expect(rows.map((r) => within(r).getAllByRole('cell')[1].textContent)).toEqual([NO_OWNER_SET, 'alice@example.com', ''])
  })
})

// ── Needs attention caption ──

describe('Needs attention caption', () => {
  it.each([
    ['7', '7 resources with no flagged issues'],
    ['1', '1 resource with no flagged issues'],
    ['0', '0 resources with no flagged issues'],
    ['1,234', '1,234 resources with no flagged issues'],
    ['…', '… resources with no flagged issues'],
    ['—', '— resources with no flagged issues'],
  ])('%s → %s', (shown, caption) => {
    expect(noFlaggedIssuesCaption(shown)).toBe(caption)
  })

  it.each([[1, '1 resource with no flagged issues'], [12, '12 resources with no flagged issues']])('rendered tile, %i', (healthy, caption) => {
    render(
      <SummaryTiles
        stats={{ loading: false, unavailable: false, stats: { ...STATS, total: healthy + 2, healthy, needs_attention: 2 } as any }}
        coverage={prodCoverage(NOW)}
        registered={{ loading: false, error: false, count: 0 }}
        spend={{ loading: false, error: true, summary: undefined }}
      />,
    )
    const tile = screen.getByRole('heading', { level: 2, name: 'Needs attention' }).parentElement!
    expect(tile).toHaveTextContent(caption)
    expect(tile).not.toHaveTextContent(/No flagged issues:/)
    cleanup()
  })
})
