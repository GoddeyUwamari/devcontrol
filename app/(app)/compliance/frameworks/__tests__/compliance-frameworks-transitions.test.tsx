/**
 * Security V2 F3b, brief addition 4: the Compliance page through each transition, with every timer fake (the
 * shared polling: 5 s for a minute, then 15 s; paused in a hidden tab). A 402, 500 or network failure on any
 * read during a flow never turns into an empty state.
 */
const m = vi.hoisted(() => {
  process.env.TZ = 'UTC'
  return {
    h: { log: [] as string[], routes: {} as Record<string, unknown>, posts: [] as { path: string; body: unknown }[] },
  }
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import ComplianceFrameworksPage from '../page'
import { SCANS_PATH, failWith, framework, newClient, ok, renderWith, scan, type Harness, type Route } from '../../../security/__tests__/security-v2-fixtures'

vi.mock('@/lib/api', async () => (await import('../../../security/__tests__/security-v2-fixtures')).apiModule(m.h as never))
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ organization: { id: 'org-1' } }) }))
vi.mock('@/lib/hooks/use-current-role', () => ({ useCurrentRole: () => 'member' }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => false }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: () => ({ enabled: false }) }))
vi.mock('@/lib/hooks/useSecurityHub', () => ({
  useSecurityHub: () => ({ capability: null, cis: null, pci: null, nist: null, loading: false, error: null, syncing: false, triggerSync: vi.fn(), refetch: vi.fn() }),
}))
vi.mock('@/lib/hooks/useSoc2Readiness', () => ({ useSoc2Readiness: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }) }))

const h = m.h as unknown as Required<Harness>
const SEC = 1000
const MIN = 60 * SEC
const DAY = 86_400_000
const FRAMEWORKS = 'GET /api/compliance-frameworks'
const SCANS = `GET ${SCANS_PATH}`
const START = 'POST /api/compliance-frameworks/fw-1/scan'
const A = framework('fw-1', 'Example baseline')
/** A completed run with its own counts (3 of 4 → 75%), to tell a new result from the old 90%. */
const done = (id: string, msAgo: number) => ({ ...scan(id, 'fw-1', 'completed', '0.00', msAgo), compliant_resources: 3, non_compliant_resources: 1 })
const running = (id: string, msAgo: number) => scan(id, 'fw-1', 'running', null, msAgo)
const failed = (id: string, msAgo: number) => scan(id, 'fw-1', 'failed', null, msAgo)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'], now: Date.parse('2026-10-23T15:00:00Z') })
  h.log.length = 0
  h.posts.length = 0
  h.routes = { [FRAMEWORKS]: ok([A]) }
})

/** Moves fake time, then 50 ms more in small steps so every answer and render that falls due settles. */
const advance = async (ms: number) => {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
  for (let i = 0; i < 5; i++) await act(async () => { await vi.advanceTimersByTimeAsync(10) })
}
const reads = () => h.log.filter((l) => l === SCANS).length
const list = (scans: unknown[] | Route) => { h.routes[SCANS] = Array.isArray(scans) ? ok(scans) : scans }
const score = () => screen.getAllByTestId('compliance-tile')[0]
const historyTexts = () => screen.queryAllByTestId('evaluation-history-row').map((r) => r.textContent)
const row = () => screen.getByTestId('compliance-custom-framework')
const body = () => document.body.textContent ?? ''

async function show(scans: unknown[]) {
  list(scans)
  renderWith(newClient(), <ComplianceFrameworksPage />)
  await advance(0)
  await advance(0)
  expect(reads()).toBe(1)
}

/** No empty state may appear while a flow is under way (D7). */
function expectNoEmptyState() {
  for (const text of ['No frameworks yet', 'No active compliance evaluations', 'Not yet evaluated']) expect(body()).not.toContain(text)
}

/** Clicks a start control; the next read of the list answers `next`. */
async function start(button: HTMLElement, next: unknown[]) {
  list(next)
  fireEvent.click(button)
  await advance(0)
  await advance(0)
}

describe('transitions', () => {
  it('current → running → current: the old 90% is hidden while running; the new result replaces it', async () => {
    h.routes[START] = ok({ scanId: 's-new' })
    await show([scan('s-1', 'fw-1', 'completed', '0.00', 2 * DAY)])
    expect(score()).toHaveTextContent('90%')
    await start(within(row()).getByRole('button', { name: 'Run Scan' }), [running('s-new', 0), scan('s-1', 'fw-1', 'completed', '0.00', 2 * DAY)])
    expect(score()).toHaveTextContent('No score is shown as current.')
    expect(score()).not.toHaveTextContent('90%')
    expect(historyTexts()[0]).toContain('Example baseline · Running · started today, 3:00 PM')
    list([done('s-new', 0), scan('s-1', 'fw-1', 'completed', '0.00', 2 * DAY)])
    await advance(5 * SEC)
    expect(score()).toHaveTextContent('75%')
    expect(historyTexts()[0]).toContain('Example baseline · Completed today, 3:00 PM · 75%')
    const settledReads = reads()
    await advance(MIN)
    expect(reads()).toBe(settledReads)
  })

  it('current → running → failed: no score is current, and the failure is in the history', async () => {
    h.routes[START] = ok({ scanId: 's-new' })
    await show([scan('s-1', 'fw-1', 'completed', '0.00', 2 * DAY)])
    await start(within(row()).getByRole('button', { name: 'Run Scan' }), [running('s-new', 0), scan('s-1', 'fw-1', 'completed', '0.00', 2 * DAY)])
    list([failed('s-new', 0), scan('s-1', 'fw-1', 'completed', '0.00', 2 * DAY)])
    await advance(5 * SEC)
    expect(score()).toHaveTextContent('No score is shown as current.')
    expect(score().textContent).not.toMatch(/\d%/)
    expect(historyTexts()[0]).toContain('Example baseline · Failed today, 3:00 PM')
  })

  it('stale → running → current: the banner\'s "Re-evaluate now" starts it; the banner goes and the new score shows', async () => {
    h.routes[START] = ok({ scanId: 's-new' })
    await show([scan('s-1', 'fw-1', 'completed', '0.00', 8 * DAY)])
    const banner = screen.getByTestId('compliance-stale-banner')
    await start(within(banner).getByRole('button', { name: 'Re-evaluate now' }), [running('s-new', 0), scan('s-1', 'fw-1', 'completed', '0.00', 8 * DAY)])
    expect(h.posts.map((p) => p.path)).toEqual(['/api/compliance-frameworks/fw-1/scan'])
    expect(screen.queryByTestId('compliance-stale-banner')).toBeNull()
    expect(score()).toHaveTextContent('No score is shown as current.')
    list([done('s-new', 0), scan('s-1', 'fw-1', 'completed', '0.00', 8 * DAY)])
    await advance(5 * SEC)
    expect(score()).toHaveTextContent('75%')
    expect(score()).not.toHaveTextContent('out of date')
    expect(screen.queryByTestId('compliance-stale-banner')).toBeNull()
  })

  it('failed → retry → current: the failed row\'s "Try again" retries it', async () => {
    h.routes[START] = ok({ scanId: 's-new' })
    await show([failed('s-2', DAY), scan('s-1', 'fw-1', 'completed', '0.00', 2 * DAY)])
    expect(score()).toHaveTextContent('No score is shown as current.')
    const failedRow = screen.getAllByTestId('evaluation-history-row')[0]
    expect(failedRow).toHaveAttribute('data-status', 'failed')
    await start(within(failedRow).getByRole('button', { name: 'Try again' }), [running('s-new', 0), failed('s-2', DAY), scan('s-1', 'fw-1', 'completed', '0.00', 2 * DAY)])
    expect(historyTexts()[0]).toContain('Running')
    list([done('s-new', 0), failed('s-2', DAY), scan('s-1', 'fw-1', 'completed', '0.00', 2 * DAY)])
    await advance(5 * SEC)
    expect(score()).toHaveTextContent('75%')
    expect(historyTexts().map((t) => t!.split(' · ')[1].split(' ')[0])).toEqual(['Completed', 'Failed', 'Completed'])
  })

  it('never evaluated → running: still "Not yet evaluated" on the tiles, Running in the history', async () => {
    h.routes[START] = ok({ scanId: 's-new' })
    await show([])
    expect(score()).toHaveTextContent('Not yet evaluated')
    expect(body()).toContain('No active compliance evaluations')
    await start(within(row()).getByRole('button', { name: 'Run Scan' }), [running('s-new', 0)])
    expect(score()).toHaveTextContent('Not yet evaluated')
    expect(historyTexts()).toEqual([expect.stringContaining('Example baseline · Running · started today, 3:00 PM')])
    expect(body()).not.toContain('No active compliance evaluations')
  })

  it('a 409 SCAN_IN_PROGRESS mid-flow is Running, never an error', async () => {
    h.routes[START] = failWith(409, 'SCAN_IN_PROGRESS')
    await show([scan('s-1', 'fw-1', 'completed', '0.00', 2 * DAY)])
    await start(within(row()).getByRole('button', { name: 'Run Scan' }), [running('s-other', 30 * SEC), scan('s-1', 'fw-1', 'completed', '0.00', 2 * DAY)])
    expect(score()).toHaveTextContent('No score is shown as current.')
    expect(body()).not.toContain("Couldn't start")
  })
})

describe('errors during a flow never become an empty state (D7)', () => {
  it.each([
    ['500', failWith(500, 'Failed to fetch scans') as Route],
    ['402', failWith(402, 'TIER_REQUIRED') as Route],
    ['a network error', { status: 0 } as Route],
  ])('a %s on a poll keeps the last known state; the next good read moves on', async (_, failure) => {
    h.routes[START] = ok({ scanId: 's-new' })
    await show([scan('s-1', 'fw-1', 'completed', '0.00', 2 * DAY)])
    await start(within(row()).getByRole('button', { name: 'Run Scan' }), [running('s-new', 0), scan('s-1', 'fw-1', 'completed', '0.00', 2 * DAY)])
    list(failure)
    await advance(5 * SEC)
    expectNoEmptyState()
    expect(score()).toHaveTextContent('No score is shown as current.')
    expect(historyTexts()[0]).toContain('Running')
    expect(body()).not.toContain('Failed to fetch scans')
    list([done('s-new', 0), scan('s-1', 'fw-1', 'completed', '0.00', 2 * DAY)])
    await advance(5 * SEC)
    expect(score()).toHaveTextContent('75%')
  })

  it('a failed start never empties the page', async () => {
    h.routes[START] = failWith(500, 'Failed to execute scan')
    await show([scan('s-1', 'fw-1', 'completed', '0.00', 2 * DAY)])
    await start(within(row()).getByRole('button', { name: 'Run Scan' }), [scan('s-1', 'fw-1', 'completed', '0.00', 2 * DAY)])
    expectNoEmptyState()
    expect(score()).toHaveTextContent('90%')
    expect(within(row()).getByRole('alert')).toHaveTextContent("Couldn't start the evaluation. Try again.")
  })
})

/** React Query reads document.visibilityState for "focused"; this is what a browser does. */
function setVisibility(state: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  window.dispatchEvent(new Event('visibilitychange'))
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('a hidden tab', () => {
  afterEach(() => setVisibility('visible'))

  it('hidden → visible: polling pauses while hidden and resumes when visible', async () => {
    await show([running('s-run', 10 * SEC), scan('s-1', 'fw-1', 'completed', '0.00', 2 * DAY)])
    await advance(5 * SEC)
    expect(reads()).toBe(2)
    setVisibility('hidden')
    await advance(MIN)
    expect(reads()).toBe(2)
    setVisibility('visible')
    list([done('s-run', 0), scan('s-1', 'fw-1', 'completed', '0.00', 2 * DAY)])
    await advance(15 * SEC)
    expect(reads()).toBe(3)
    expect(score()).toHaveTextContent('75%')
  })
})
