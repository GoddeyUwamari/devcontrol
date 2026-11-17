/**
 * Accessibility and forced dark mode for the Services redesign (PR 3b,
 * pr3-step1.md §I.6, §I.7): axe on every state fixture (contrast is checked in
 * the screenshots, not in jsdom), the table's header scopes and the global
 * subheading, the group disclosures, the scan hint, decorative dots; and the
 * page rendered under a forced `.dark` root, with every redesign surface on
 * the theme tokens and every ink paired with a dark: value. No theme switch
 * exists; dark mode is only forced here.
 */
process.env.TZ = 'UTC'

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import axe from 'axe-core'
import ServicesPage from '../page'
import { R_NOW, docExample, flaggedCoverage, mrRegion, redesignStats } from './redesign-fixtures'

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
const mockGetCoverage = vi.fn()
const mockGetStats = vi.fn()
vi.mock('@/lib/services/aws-services.service', () => ({
  default: {
    getServices: async (req: any = {}) => ({
      services: [{
        id: 'u1', name: 'example-cdn', type: 'cloudfront', environment: 'production', region: null, aws_region: 'global', status: 'unknown', uptime: null,
        owner: null, team: null, monthly_cost: null, last_deployed: null, last_seen_at: null, metadata: {}, priority_severity: 'high', needs_attention: true,
        reason: 'Open to the internet', ownership: 'unknown', attention_cause: 'finding',
      }],
      pagination: { page: 1, limit: req.limit ?? 50, total: 1, total_pages: 1, has_more: false }, counts: { needs_attention: 1, no_flagged_issues: 0 },
    }),
    getStats: () => mockGetStats(),
    getCoverage: () => mockGetCoverage(),
    discoverServices: vi.fn(),
  },
}))
vi.mock('@/lib/services/aws-accounts.service', () => ({ default: { getAccountsAndConnection: async () => ({ accounts: [{ id: 'acct-1' }], connection: 'connected' }) } }))
vi.mock('@/lib/services/platform-stats.service', () => ({ platformStatsService: { getCostSummary: async () => { throw new Error('n/a') } } }))

function failing() {
  const mr = docExample('regional_failure')
  return flaggedCoverage(mr, { cloudfront: 2 })
}
function emptyAndWaiting() {
  const mr = docExample('in_progress')
  mr.regions.push(mrRegion('sa-east-1', { result_of: 'earlier_scan', scan_state: 'waiting', state: 'not_started', resources: 0, resources_from: 'earlier_success' }))
  return flaggedCoverage(mr, { cloudfront: 1 })
}
const STATES: Record<string, () => unknown> = {
  all_checked: () => flaggedCoverage(docExample('all_checked'), { cloudfront: 2 }),
  in_progress: emptyAndWaiting,
  regional_failure: failing,
  not_enabled: () => flaggedCoverage(docExample('not_enabled')),
  latest_scan_failed: () => flaggedCoverage(docExample('latest_scan_failed')),
  empty_regions: () => flaggedCoverage(docExample('empty_regions')),
}

async function show(coverage: unknown) {
  mockGetCoverage.mockResolvedValue(coverage)
  mockGetStats.mockResolvedValue(redesignStats({ needs_attention: 1 }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(<QueryClientProvider client={client}><ServicesPage /></QueryClientProvider>)
  await screen.findByTestId('organising-line')
  await waitFor(() => expect(screen.queryByText(/Loading/)).toBeNull())
  return view
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'], now: R_NOW })
  vi.stubEnv('NEXT_PUBLIC_SERVICES_V2', 'true')
  vi.stubEnv('NEXT_PUBLIC_SERVICES_REDESIGN', 'true')
})
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); document.documentElement.classList.remove('dark') })

describe('axe', () => {
  it.each(Object.keys(STATES))('%s: no violations in the redesign', async (name) => {
    const { container } = await show(STATES[name]())
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } })
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
  })
})

describe('structure', () => {
  it('table: column and row headers, the global subheading as a colgroup header, a caption', async () => {
    await show(STATES.all_checked())
    const table = document.querySelector('[data-layout="table"] table')!
    expect(table.querySelector('caption')?.textContent).toBe('Scan status of each enabled region')
    expect([...table.querySelectorAll('thead th')].map((th) => th.getAttribute('scope'))).toEqual(['col', 'col', 'col', 'col', 'col'])
    for (const tr of table.querySelectorAll('tbody tr')) expect(tr.firstElementChild!.tagName).toBe('TH')
    const sub = table.querySelector('tr[data-row="global-heading"] th')!
    expect(sub.getAttribute('scope')).toBe('colgroup')
    expect(sub.textContent).toBe('Global resources (not a region)')
  })

  it('group disclosures are native details/summary, labelled Show regions / Hide regions, with a labelled list', async () => {
    await show(STATES.in_progress())
    const group = document.querySelector('[data-layout="table"] tr[data-row="waiting"]')!
    const d = group.querySelector('details')!
    expect(d.querySelector('summary')!.textContent).toBe('Show regions')
    await act(async () => { d.open = true; d.dispatchEvent(new Event('toggle')) })
    expect(d.querySelector('summary')!.textContent).toBe('Hide regions')
    expect(d.querySelector('ul')!.getAttribute('aria-label')).toBe('Regions waiting')
  })

  it('every status dot and the failed line\'s dot are aria-hidden; the text carries the meaning', async () => {
    await show(STATES.latest_scan_failed())
    for (const dot of document.querySelectorAll('[data-status] > span:first-child, [data-testid="organising-line"] > span')) {
      expect(dot.getAttribute('aria-hidden')).toBe('true')
    }
    expect(screen.getByTestId('organising-line').textContent).toMatch(/^Last scan failed/)
  })
})

describe('forced dark mode (no theme switch)', () => {
  it('every redesign surface is on the theme tokens and every ink has a dark: value', async () => {
    document.documentElement.classList.add('dark')
    await show(STATES.regional_failure())
    const card = document.getElementById('region-coverage')!
    expect(card.className).toMatch(/\bbg-card\b/)
    expect(card.className).toMatch(/\bborder-border\b/)
    const header = screen.getByTestId('services-scan-line').closest('div')!.parentElement!
    for (const root of [card, screen.getByTestId('not-checked'), header]) {
      for (const el of [root, ...root.querySelectorAll('*')]) {
        const cls = el.getAttribute('class') ?? ''
        expect(cls, cls).not.toMatch(/(?<![\w:-])bg-white(?![\w-])/)
        expect(cls, cls).not.toMatch(/(?<![\w:-])text-(?:slate|gray)-\d+/)
        // The title and subtitle are the app's shared PAGE_* classes; everything the redesign adds pairs its ink.
        if (root !== header || el.closest('[data-testid="services-scan-line"], button, a')) {
          if (/(?<![\w:-])text-ink(?:-[a-z-]+)?(?![\w-])/.test(cls)) expect(cls, cls).toMatch(/\bdark:text-/)
        }
      }
    }
    const notes = [...card.querySelectorAll('[data-note]')]
    expect(notes.length).toBeGreaterThan(0)
    for (const n of notes) expect(n.className).toMatch(/bg-\[var\(--bg-(?:warning|danger)\)\]|bg-muted/)
  })
})
