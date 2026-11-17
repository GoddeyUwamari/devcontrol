/**
 * Accessibility and forced dark mode for the Services redesign (PR 3b,
 * pr3-step1.md §I.6, §I.7): structural checks on every state fixture (axe-core
 * isn't a declared dependency, so the rules that matter here are written out:
 * names, references, unique ids, list structure, decorative icons; contrast is
 * checked in the screenshots, not in jsdom), the table's header scopes and the global
 * subheading, the group disclosures, the scan hint, decorative dots; and the
 * page rendered under a forced `.dark` root, with every redesign surface on
 * the theme tokens and every ink paired with a dark: value. No theme switch
 * exists; dark mode is only forced here.
 */
process.env.TZ = 'UTC'

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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

/** A control's name, simply: aria-label, aria-labelledby, its label element, or its own visible text. */
function nameOf(el: Element): string {
  const label = el.getAttribute('aria-label')
  if (label) return label
  const by = el.getAttribute('aria-labelledby')
  if (by) return by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ')
  if (el.id) { const l = document.querySelector(`label[for="${el.id}"]`); if (l?.textContent) return l.textContent }
  const wrapping = el.closest('label')
  if (wrapping?.textContent) return wrapping.textContent
  const clone = el.cloneNode(true) as Element
  for (const hidden of clone.querySelectorAll('[aria-hidden="true"]')) hidden.remove()
  return clone.textContent ?? ''
}

/** The checks axe would make that apply to this page, as a list of problems. */
function problems(root: HTMLElement): string[] {
  const out: string[] = []
  const ids = new Map<string, number>()
  for (const el of root.querySelectorAll('[id]')) ids.set(el.id, (ids.get(el.id) ?? 0) + 1)
  for (const [id, n] of ids) if (n > 1) out.push(`duplicate id ${id}`)
  for (const el of root.querySelectorAll('[aria-describedby], [aria-labelledby], [aria-controls]')) {
    for (const attr of ['aria-describedby', 'aria-labelledby', 'aria-controls']) {
      for (const ref of (el.getAttribute(attr) ?? '').split(/\s+/).filter(Boolean)) if (!document.getElementById(ref)) out.push(`${attr} → missing #${ref}`)
    }
  }
  for (const el of root.querySelectorAll('button, a[href], summary, select, input')) {
    if (!nameOf(el).trim()) out.push(`no accessible name: ${el.outerHTML.slice(0, 80)}`)
  }
  for (const list of root.querySelectorAll('ul, ol')) {
    for (const child of list.children) if (child.tagName !== 'LI') out.push(`list child ${child.tagName} in ${list.getAttribute('aria-label') ?? list.className}`)
  }
  for (const svg of root.querySelectorAll('svg')) if (svg.getAttribute('aria-hidden') !== 'true') out.push(`svg not aria-hidden in ${svg.parentElement?.outerHTML.slice(0, 60)}`)
  for (const th of root.querySelectorAll('th')) if (!th.getAttribute('scope')) out.push(`th without scope: ${th.textContent}`)
  const headings = [...root.querySelectorAll('h1, h2, h3, h4')].map((h) => Number(h.tagName[1]))
  headings.forEach((level, i) => { if (i > 0 && level > headings[i - 1] + 1) out.push(`heading level skips to h${level}`) })
  return out
}

// Whole-page renders are slow on a cold worker: a wider budget than the 5 s default.
describe('structural a11y checks', { timeout: 20_000 }, () => {
  it.each(Object.keys(STATES))('%s: no problems in the redesign', async (name) => {
    const { container } = await show(STATES[name]())
    const scope = container.querySelector('[data-services-redesign]') as HTMLElement
    expect(scope).not.toBeNull()
    expect(problems(scope)).toEqual([])
  })

  it('the checker finds each kind of problem (self-check)', () => {
    const div = document.createElement('div')
    div.innerHTML = '<p id="a"></p><p id="a"></p><button aria-describedby="nope"></button><ul><p>x</p></ul><svg></svg><table><tr><th>t</th></tr></table><h2>a</h2><h4>b</h4>'
    document.body.appendChild(div)
    const found = problems(div).join('\n')
    for (const kind of ['duplicate id a', 'missing #nope', 'no accessible name', 'list child P', 'svg not aria-hidden', 'th without scope', 'skips to h4']) expect(found).toContain(kind)
    div.remove()
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
