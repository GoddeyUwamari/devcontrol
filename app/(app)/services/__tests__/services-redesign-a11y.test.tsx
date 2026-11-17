/**
 * Accessibility and forced dark mode for the Services redesign (PR 3b,
 * pr3-step1.md §I.6, §I.7): axe-core (a devDependency, pr3b-review F3) on
 * every state fixture, the open Unknown tooltip, the banner, demo mode and the
 * phone list on its own (with its tap-open time), each also run through the
 * written-out structural checks below (names, references, unique ids, list
 * structure, decorative icons); colour contrast can't be computed in jsdom and
 * is checked in the screenshots. Then the table's header scopes and the global
 * subheading, the group disclosures, decorative dots; and the page rendered
 * under a forced `.dark` root, with every redesign surface on the theme tokens
 * and every ink paired with a dark: value. No theme switch exists; dark mode
 * is only forced here.
 */
process.env.TZ = 'UTC'

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import axe from 'axe-core'
import ServicesPage from '../page'
import { R_NOW, STATE_FIXTURES, docExample, flaggedCoverage, mrRegion, scanOf, tab1 } from './redesign-fixtures'

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
const mockGetCoverage = vi.fn()
const mockGetStats = vi.fn()
const mockGetServices = vi.fn()
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
/** The doc examples the state fixtures don't already draw, plus two variants. */
const STATES: Record<string, () => unknown> = {
  all_checked: () => flaggedCoverage(docExample('all_checked'), { cloudfront: 2 }),
  in_progress: emptyAndWaiting,
  regional_failure: failing,
  not_enabled: () => flaggedCoverage(docExample('not_enabled')),
  latest_scan_failed: () => flaggedCoverage(docExample('latest_scan_failed')),
  empty_regions: () => flaggedCoverage(docExample('empty_regions')),
  budget_incomplete: () => flaggedCoverage(docExample('budget_incomplete')),
  unattributed_warning: () => flaggedCoverage(docExample('unattributed_warning')),
}

async function show(coverage: unknown) {
  const scan = scanOf(coverage)
  mockGetCoverage.mockResolvedValue(scan.coverage)
  mockGetStats.mockResolvedValue(scan.stats)
  mockGetServices.mockImplementation(async (req: any = {}) => scan.list(req))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(<QueryClientProvider client={client}><ServicesPage /></QueryClientProvider>)
  await screen.findByTestId('organising-line')
  await waitFor(() => expect(screen.queryByText(/Loading/)).toBeNull())
  await waitFor(() => expect(screen.queryByText('Loading resources…')).toBeNull())
  return Object.assign(view, { scan })
}

const scopeOf = (container: HTMLElement) => container.querySelector('[data-services-redesign]') as HTMLElement

// jsdom has no layout, so it has no document.elementFromPoint; axe's modal
// check calls it, and without it aria-hidden-focus errors into "incomplete"
// instead of running. Nothing is ever drawn on top here, so null is the truth.
if (typeof document.elementFromPoint !== 'function') document.elementFromPoint = () => null

/**
 * axe-core's violations in `context`, every rule of the standard set except
 * colour contrast (jsdom has no layout or computed colours; contrast is
 * checked in the screenshots). One line per rule and node. An "incomplete"
 * result (a rule that errored or couldn't decide) counts too, so no rule is
 * skipped silently.
 */
async function axeViolations(context: Element): Promise<string[]> {
  const result = await axe.run(context, { rules: { 'color-contrast': { enabled: false } } })
  const line = (kind: string) => (v: axe.Result) => v.nodes.map((n) => `${kind} ${v.id} (${v.impact}): ${n.target.join(' ')} · ${n.failureSummary?.split('\n')[1]?.trim() ?? ''}`)
  return [...result.violations.flatMap(line('violation')), ...result.incomplete.flatMap(line('incomplete'))]
}

beforeEach(() => {
  vi.clearAllMocks()
  demoMode = false
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

// Whole-page renders (and axe over them) are slow on a cold worker: a wider budget than the 5 s default.
describe('axe-core and the structural checks on every state', { timeout: 30_000 }, () => {
  it.each(Object.keys(STATE_FIXTURES))('state fixture %s: no axe violation, no structural problem', async (name) => {
    const { container } = await show(STATE_FIXTURES[name]())
    const scope = scopeOf(container)
    expect(scope).not.toBeNull()
    expect(await axeViolations(scope)).toEqual([])
    expect(problems(scope)).toEqual([])
  })

  it.each(Object.keys(STATES))('doc example %s: no axe violation, no structural problem', async (name) => {
    const { container } = await show(STATES[name]())
    expect(await axeViolations(scopeOf(container))).toEqual([])
    expect(problems(scopeOf(container))).toEqual([])
  })

  it('t14: the Unknown · tags unreadable tooltip open', async () => {
    const { container } = await show(tab1())
    const attention = screen.getByRole('heading', { name: 'What needs attention' }).closest('section')!
    const tip = within(attention).getAllByRole('button', { name: /Unknown · tags unreadable/ })[0]
    fireEvent.focus(tip)
    expect(document.getElementById(tip.getAttribute('aria-describedby')!)).toHaveAttribute('data-open', 'true')
    expect(await axeViolations(scopeOf(container))).toEqual([])
    expect(problems(scopeOf(container))).toEqual([])
  })

  it('t01 with the scan banner after Scan now', async () => {
    const c = tab1()
    const { container } = await show(c)
    mockDiscover.mockResolvedValue({ message: 'x', warnings: [], errors: [], discovered: 4, updated: 12, jobId: c.multi_region.scan.id })
    fireEvent.click(screen.getByRole('button', { name: 'Scan now' }))
    await screen.findByTestId('scan-banner')
    expect(await axeViolations(scopeOf(container))).toEqual([])
    expect(problems(scopeOf(container))).toEqual([])
  })

  it.each(['t01-all-checked', 't05-single-region-flag-off', 't13-codes'])('the phone list of %s on its own, with a tap-open time open', async (name) => {
    await show(STATE_FIXTURES[name]())
    const list = document.querySelector('[data-layout="stacked"]') as HTMLElement
    const time = within(list).queryAllByRole('button').find((b) => b.querySelector('time'))
    if (time) {
      fireEvent.click(time)
      expect(document.getElementById(time.getAttribute('aria-describedby')!)).toHaveAttribute('data-open', 'true')
    }
    expect(await axeViolations(list)).toEqual([])
    expect(problems(list)).toEqual([])
  })

  it('demo mode', async () => {
    demoMode = true
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { container } = render(<QueryClientProvider client={client}><ServicesPage /></QueryClientProvider>)
    await screen.findByTestId('organising-line')
    expect(await axeViolations(scopeOf(container))).toEqual([])
    expect(problems(scopeOf(container))).toEqual([])
  })

  it('axe finds a violation in a broken fragment (self-check)', async () => {
    const div = document.createElement('div')
    div.innerHTML = '<button></button><ul><p>x</p></ul><span aria-hidden="true"><button type="button">x</button></span><div role="buton">x</div>'
    document.body.appendChild(div)
    const found = (await axeViolations(div)).join('\n')
    for (const rule of ['violation button-name', 'violation list', 'violation aria-hidden-focus', 'violation aria-roles']) expect(found).toContain(rule)
    expect(found).not.toContain('incomplete')
    div.remove()
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
