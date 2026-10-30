/**
 * Operational Health (O1) page: requests and rendering.
 * - one /resources and one /alarms per mount, range change, Refresh and poll; Refresh alone bypasses
 *   the resources cache; never a legacy /api/cloudwatch/* or /api/prometheus/* request;
 * - a response for an older range or an earlier cycle never overwrites a newer one; no overlapping cycles;
 * - 60 s poll, paused while the tab is hidden; becoming visible refreshes once, then the poll resumes (D14);
 * - unmount aborts and stops polling;
 * - SLOs: one request per page load, Enterprise only (D13);
 * - every plan gets the page (no gate); rendered states, "—" never 0.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent, within } from '@testing-library/react'
import OperationalHealthV2 from '../operational-health/OperationalHealthV2'

type Call = { path: string; signal?: AbortSignal; resolve: (v: unknown) => void; reject: (e: unknown) => void }

const m = vi.hoisted(() => ({
  calls: [] as Array<{ path: string; signal?: AbortSignal; resolve: (v: unknown) => void; reject: (e: unknown) => void }>,
  plan: { status: 'known', tier: 'pro' } as { status: string; tier: string },
  visibility: 'visible' as 'visible' | 'hidden',
  // When set, an aborted request still answers later (its response was already on the wire).
  ignoreAbort: false,
}))

vi.mock('@/lib/api', () => {
  const get = (path: string, config?: { signal?: AbortSignal }) =>
    new Promise((resolve, reject) => {
      m.calls.push({ path, signal: config?.signal, resolve, reject })
      if (!m.ignoreAbort) config?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('canceled'), { name: 'CanceledError' })))
    })
  const api = { get, post: get, put: get, delete: get, patch: get }
  return {
    default: api,
    api,
    handleApiResponse: (response: { data: { success: boolean; data: unknown } }) => {
      if (!response.data.success) throw new Error('API request failed')
      return response.data.data
    },
  }
})
vi.mock('@/lib/hooks/use-plan', () => ({ usePlan: () => ({ status: m.plan.status, tier: m.plan.tier, isKnown: m.plan.status === 'known' }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const ZERO = { count: 0, measured: 0, passing: 0, needs_attention: 0, failing: 0, check_unknown: 0, check_failed: 0, neutral: 0, stopped: 0, no_activity: 0, not_enough_traffic: 0, not_measured: 0, outside_scope: 0, reporting: 0, no_telemetry: 0, unknown: 0 }
const EC2 = { ...ZERO, count: 2, measured: 2, passing: 2, reporting: 2 }

const resourcesOk = (range = '1h', over: Record<string, unknown> = {}) => ({
  status: 'ok', region: 'us-east-1', account_count: 1, multiple_accounts: false, range, collection: 'complete',
  checked_at: '2026-10-29T14:59:00.000Z', captured_at: '2026-10-29T14:59:00.000Z', inventory_capped: false, inventory_capped_reasons: [],
  type_summary: { ec2: { count: 2, passing: 2, needs_attention: 0, failing: 0, other: 0 } },
  type_breakdown: { ec2: EC2 }, fleet_summary: EC2, resources: [], pagination: { shown: 0, total: 2, has_more: false, cursor: null },
  ...over,
})
const ALARMS_OK = { status: 'ok', reason: null, checked_at: '2026-10-29T14:59:00.000Z', region: 'us-east-1', in_alarm: [], in_alarm_complete: true, configured_count: 3, configured_count_complete: true, truncated: false }

const ok = (data: unknown) => ({ data: { success: true, data } })
const httpError = (status: number) => Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data: {} } })

const paths = () => m.calls.map((c) => c.path)
const resourceCalls = () => m.calls.filter((c) => c.path.startsWith('/api/observability/resources'))
const alarmCalls = () => m.calls.filter((c) => c.path === '/api/observability/alarms')
const sloCalls = () => m.calls.filter((c) => c.path === '/api/slos/evaluate')

async function flush() {
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve() })
}

/** Answers the latest unanswered call for a path prefix. */
async function answer(prefix: string, value: unknown, fail = false) {
  const call = [...m.calls].reverse().find((c) => c.path.startsWith(prefix) && !(c as Call & { done?: boolean }).done) as (Call & { done?: boolean }) | undefined
  if (!call) throw new Error(`no pending call for ${prefix}; calls: ${paths().join(', ')}`)
  call.done = true
  if (fail) call.reject(value)
  else call.resolve(value)
  await flush()
}

/** Answers both page requests of the current cycle. */
async function settle(resources: unknown = resourcesOk(), alarms: unknown = ALARMS_OK) {
  await answer('/api/observability/resources', ok(resources))
  await answer('/api/observability/alarms', ok(alarms))
}

async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
  await flush()
}

function setVisibility(v: 'visible' | 'hidden') {
  m.visibility = v
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], now: Date.parse('2026-10-29T15:00:00Z') })
  m.calls.length = 0
  m.plan = { status: 'known', tier: 'pro' }
  m.visibility = 'visible'
  m.ignoreAbort = false
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => m.visibility })
  global.fetch = vi.fn(() => Promise.reject(new Error('the page must not use fetch'))) as unknown as typeof fetch
})
afterEach(() => {
  vi.useRealTimers()
})

describe('requests', () => {
  it('mount: one resources (1h, 25 rows) and one alarms request; no legacy route, no SLO request below Enterprise', async () => {
    render(<OperationalHealthV2 />)
    await flush()
    expect(paths().sort()).toEqual(['/api/observability/alarms', '/api/observability/resources?range=1h&pageSize=25&table=1&filter=all&page=1'])
    await settle()
    expect(global.fetch).not.toHaveBeenCalled()
    expect(paths().some((p) => p.startsWith('/api/cloudwatch') || p.startsWith('/api/prometheus') || p.startsWith('/api/alerts'))).toBe(false)
  })

  it('a range change: one new pair for the new range; the range-dependent tiles go back to loading', async () => {
    render(<OperationalHealthV2 />)
    await flush()
    await settle()
    expect(screen.getByTestId('tile-checks')).not.toHaveAttribute('aria-busy')
    fireEvent.click(screen.getByRole('button', { name: 'Last 7d' }))
    await flush()
    expect(resourceCalls().map((c) => c.path)).toEqual(['/api/observability/resources?range=1h&pageSize=25&table=1&filter=all&page=1', '/api/observability/resources?range=7d&pageSize=25&table=1&filter=all&page=1'])
    expect(alarmCalls()).toHaveLength(2)
    expect(screen.getByTestId('tile-checks')).toHaveAttribute('aria-busy', 'true')
  })

  it('an older range’s late response never overwrites the newer one', async () => {
    render(<OperationalHealthV2 />)
    await flush()
    const first = resourceCalls()[0]
    fireEvent.click(screen.getByRole('button', { name: 'Last 7d' }))
    await flush()
    // The 1h cycle was aborted; its signal says so.
    expect(first.signal?.aborted).toBe(true)
    // Even if the 1h response arrived anyway, it is not applied.
    first.resolve(ok(resourcesOk('1h', { fleet_summary: { ...EC2, failing: 2, passing: 0 } })))
    await flush()
    expect(screen.getByTestId('tile-checks')).toHaveAttribute('aria-busy', 'true')
    await settle(resourcesOk('7d'))
    expect(within(screen.getByTestId('tile-checks')).getByText('measured passing', { exact: false })).toBeInTheDocument()
    expect(screen.getByTestId('health-banner')).toHaveAttribute('data-kind', 'green')
  })

  it('1h → 7d → 1h: the first 1h cycle’s answer, arriving after the latest one, is dropped', async () => {
    m.ignoreAbort = true
    render(<OperationalHealthV2 />)
    await flush()
    const first = resourceCalls()[0]
    fireEvent.click(screen.getByRole('button', { name: 'Last 7d' }))
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Last 1h' }))
    await flush()
    expect(resourceCalls()).toHaveLength(3)
    expect(first.signal?.aborted).toBe(true)
    await settle()
    expect(screen.getByTestId('health-banner')).toHaveAttribute('data-kind', 'green')
    // Same range as the latest cycle, so only the cycle guard can drop it.
    first.resolve(ok(resourcesOk('1h', { fleet_summary: { ...EC2, failing: 2, passing: 0 } })))
    await flush()
    expect(screen.getByTestId('health-banner')).toHaveAttribute('data-kind', 'green')
    expect(screen.getByTestId('tile-checks')).toHaveTextContent('2 of 2 measured passing')
  })

  it('a response whose range differs from the one asked for is never shown under it', async () => {
    render(<OperationalHealthV2 />)
    await flush()
    await settle(resourcesOk('24h'))
    expect(within(screen.getByTestId('tile-checks')).getByText("Couldn't load checks.")).toBeInTheDocument()
  })

  it('Refresh: resources with refresh=true, alarms unchanged; disabled while a cycle runs (no overlap)', async () => {
    render(<OperationalHealthV2 />)
    await flush()
    const refresh = screen.getByRole('button', { name: 'Refresh' })
    expect(refresh).toBeDisabled()
    await settle()
    expect(refresh).not.toBeDisabled()
    fireEvent.click(refresh)
    await flush()
    expect(resourceCalls().at(-1)!.path).toBe('/api/observability/resources?range=1h&pageSize=25&table=1&filter=all&page=1&refresh=true')
    expect(alarmCalls().at(-1)!.path).toBe('/api/observability/alarms')
    expect(refresh).toBeDisabled()
  })

  it('while a poll is in flight Refresh does nothing; a range change replaces the poll and its late answer is dropped', async () => {
    render(<OperationalHealthV2 />)
    await flush()
    await settle()
    await advance(60_000)
    const poll = resourceCalls().at(-1)!
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await flush()
    expect(resourceCalls()).toHaveLength(2)
    expect(poll.signal?.aborted).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Last 3h' }))
    await flush()
    expect(poll.signal?.aborted).toBe(true)
    poll.resolve(ok(resourcesOk('1h', { fleet_summary: { ...EC2, failing: 2, passing: 0 } })))
    await flush()
    expect(screen.getByTestId('tile-checks')).toHaveAttribute('aria-busy', 'true')
    await settle(resourcesOk('3h'))
    expect(screen.getByTestId('health-banner')).toHaveAttribute('data-kind', 'green')
  })

  it('polls every 60 s after a cycle settles, and never starts one while another is in flight', async () => {
    render(<OperationalHealthV2 />)
    await flush()
    await settle()
    await advance(59_000)
    expect(resourceCalls()).toHaveLength(1)
    await advance(1_000)
    expect(resourceCalls()).toHaveLength(2)
    expect(resourceCalls()[1].path).toBe('/api/observability/resources?range=1h&pageSize=25&table=1&filter=all&page=1')
    // Still in flight: no second poll however long it takes.
    await advance(180_000)
    expect(resourceCalls()).toHaveLength(2)
    expect(alarmCalls()).toHaveLength(2)
    await settle()
    await advance(60_000)
    expect(resourceCalls()).toHaveLength(3)
  })

  it('D14: no polling while hidden; becoming visible refreshes once at once, then the poll resumes', async () => {
    render(<OperationalHealthV2 />)
    await flush()
    await settle()
    setVisibility('hidden')
    await advance(600_000)
    expect(resourceCalls()).toHaveLength(1)
    setVisibility('visible')
    await flush()
    expect(resourceCalls()).toHaveLength(2)
    expect(alarmCalls()).toHaveLength(2)
    await settle()
    await advance(60_000)
    expect(resourceCalls()).toHaveLength(3)
  })

  it('D14: a cycle that settles while hidden schedules no poll', async () => {
    render(<OperationalHealthV2 />)
    await flush()
    setVisibility('hidden')
    await settle()
    await advance(600_000)
    expect(resourceCalls()).toHaveLength(1)
  })

  it('unmount aborts the cycle and stops polling', async () => {
    const { unmount } = render(<OperationalHealthV2 />)
    await flush()
    await settle()
    await advance(60_000)
    const inFlight = resourceCalls().at(-1)!
    unmount()
    expect(inFlight.signal?.aborted).toBe(true)
    await advance(600_000)
    expect(resourceCalls()).toHaveLength(2)
  })
})

describe('SLOs (D13)', () => {
  it('Enterprise: one request per page load, not on the poll or Refresh', async () => {
    m.plan = { status: 'known', tier: 'enterprise' }
    render(<OperationalHealthV2 />)
    await flush()
    expect(sloCalls()).toHaveLength(1)
    await answer('/api/slos/evaluate', ok([{ evaluation: { status: 'healthy' } }, { evaluation: { status: 'breached' } }]))
    await settle()
    for (let i = 0; i < 3; i++) {
      await advance(60_000)
      await settle()
    }
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await flush()
    await settle()
    expect(sloCalls()).toHaveLength(1)
    expect(screen.getByTestId('monitor-slos')).toHaveTextContent('2 set · 1 at risk')
  })

  it('Enterprise, the evaluation fails: Couldn’t check and Retry, never 0', async () => {
    m.plan = { status: 'known', tier: 'enterprise' }
    render(<OperationalHealthV2 />)
    await flush()
    await answer('/api/slos/evaluate', httpError(500), true)
    const row = screen.getByTestId('monitor-slos')
    expect(row).toHaveTextContent("Couldn't check")
    expect(row.textContent).not.toMatch(/\b0\b/)
    fireEvent.click(within(row).getByRole('button', { name: 'Retry' }))
    await flush()
    expect(sloCalls()).toHaveLength(2)
  })

  it('Enterprise, but the server says TIER_REQUIRED: On Revenue Protection', async () => {
    m.plan = { status: 'known', tier: 'enterprise' }
    render(<OperationalHealthV2 />)
    await flush()
    await answer('/api/slos/evaluate', Object.assign(new Error('402'), { response: { status: 402, data: { code: 'TIER_REQUIRED', details: { requiredTier: 'enterprise' }, upgrade: { url: '/x' } } } }), true)
    expect(screen.getByTestId('monitor-slos')).toHaveTextContent('On Revenue Protection')
  })

  it.each(['free', 'starter', 'pro'])('%s: On Revenue Protection with no SLO request', async (tier) => {
    m.plan = { status: 'known', tier }
    render(<OperationalHealthV2 />)
    await flush()
    await settle()
    expect(sloCalls()).toHaveLength(0)
    expect(screen.getByTestId('monitor-slos')).toHaveTextContent('On Revenue Protection')
  })

  it('plan still loading: no SLO request yet', async () => {
    m.plan = { status: 'loading', tier: 'free' }
    render(<OperationalHealthV2 />)
    await flush()
    expect(sloCalls()).toHaveLength(0)
    expect(screen.getByTestId('monitor-slos')).toHaveTextContent('Checking…')
  })
})

describe('rendering', () => {
  it.each(['free', 'starter', 'pro', 'enterprise'])('the page is on every plan (%s): no upgrade gate, the same page requests', async (tier) => {
    m.plan = { status: 'known', tier }
    render(<OperationalHealthV2 />)
    await flush()
    expect(screen.getByRole('heading', { level: 1, name: 'Operational Health' })).toBeInTheDocument()
    expect(resourceCalls()).toHaveLength(1)
    expect(alarmCalls()).toHaveLength(1)
    await settle()
    expect(screen.getByTestId('health-banner')).toHaveAttribute('data-kind', 'green')
    expect(screen.queryByTestId('health-plan-note') !== null).toBe(tier === 'free')
  })

  it('connected and healthy: header, green banner with its scope, tiles, type card, console links', async () => {
    render(<OperationalHealthV2 />)
    await flush()
    await settle()
    expect(screen.getByTestId('health-pill')).toHaveTextContent('CloudWatch connected')
    expect(screen.getByTestId('health-last-check')).toHaveTextContent(/^Last successful check today, /)
    expect(screen.getByTestId('health-banner')).toHaveTextContent('2 of 2 measured resources are passing')
    expect(screen.getByTestId('tile-checks')).toHaveTextContent('2 of 2 measured passing')
    expect(screen.getByTestId('tile-alarms')).toHaveTextContent('0in ALARM3configured')
    expect(screen.getByTestId('tile-region')).toHaveTextContent('us-east-1')
    expect(screen.getByTestId('type-card-ec2')).toHaveTextContent('EC2 · 2')
    expect(screen.getByRole('link', { name: 'Open in CloudWatch ↗' })).toHaveAttribute('href', 'https://console.aws.amazon.com/cloudwatch/home?region=us-east-1')
    expect(screen.getByRole('link', { name: 'View alarms in CloudWatch ↗' })).toHaveAttribute('href', 'https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#alarmsV2:')
    expect(screen.getByRole('link', { name: 'Costs →' })).toHaveAttribute('href', '/costs')
  })

  it('resources fail (503) and alarms fail: every data tile is "—" with a reason, never 0', async () => {
    render(<OperationalHealthV2 />)
    await flush()
    await answer('/api/observability/resources', httpError(503), true)
    await answer('/api/observability/alarms', httpError(500), true)
    for (const id of ['tile-checks', 'tile-telemetry', 'tile-alarms', 'tile-region']) {
      const tile = screen.getByTestId(id)
      expect(within(tile).getByTestId('tile-dash')).toBeInTheDocument()
      expect(tile.textContent).not.toMatch(/\b0\b/)
    }
    expect(screen.getByTestId('tile-alarms')).toHaveTextContent("Couldn't read CloudWatch alarms.")
    expect(screen.getByTestId('health-banner')).toHaveAttribute('data-kind', 'source_failed')
    expect(screen.getByTestId('health-banner')).toHaveTextContent("DevControl couldn't reach AWS right now.")
    expect(screen.queryByRole('link', { name: 'Open in CloudWatch ↗' })).toBeNull()
  })

  it('not connected: Connect AWS, no console link', async () => {
    render(<OperationalHealthV2 />)
    await flush()
    await settle(
      { status: 'not_connected', account_count: 0, multiple_accounts: false, region: null, checked_at: null, type_summary: null, resources: null, pagination: null },
      { ...ALARMS_OK, status: 'error', reason: 'not_connected', region: null, in_alarm: null, in_alarm_complete: null, configured_count: null, configured_count_complete: null, truncated: null }
    )
    expect(screen.getByTestId('health-banner')).toHaveAttribute('data-kind', 'not_connected')
    expect(screen.getByRole('link', { name: 'Connect AWS →' })).toHaveAttribute('href', '/connect-aws')
    expect(screen.queryByRole('link', { name: 'Open in CloudWatch ↗' })).toBeNull()
  })

  it('Retry in the banner runs a cache-bypassing cycle', async () => {
    render(<OperationalHealthV2 />)
    await flush()
    await settle(resourcesOk('1h', { collection: 'partial' }))
    fireEvent.click(within(screen.getByTestId('health-banner')).getByRole('button', { name: 'Retry' }))
    await flush()
    expect(resourceCalls().at(-1)!.path).toContain('refresh=true')
  })

  it('Retry on the alarms tile and row re-requests /alarms only (no resources sweep)', async () => {
    render(<OperationalHealthV2 />)
    await flush()
    await answer('/api/observability/resources', ok(resourcesOk()))
    await answer('/api/observability/alarms', httpError(500), true)
    const before = resourceCalls().length
    fireEvent.click(within(screen.getByTestId('tile-alarms')).getByRole('button', { name: 'Retry' }))
    await flush()
    expect(resourceCalls()).toHaveLength(before)
    expect(alarmCalls()).toHaveLength(2)
    await answer('/api/observability/alarms', httpError(500), true)
    fireEvent.click(within(screen.getByTestId('monitor-alarms')).getByRole('button', { name: 'Retry' }))
    await flush()
    expect(resourceCalls()).toHaveLength(before)
    expect(alarmCalls()).toHaveLength(3)
    await answer('/api/observability/alarms', ok(ALARMS_OK))
    expect(screen.getByTestId('tile-alarms')).toHaveTextContent('0in ALARM3configured')
    expect(screen.getByTestId('health-banner')).toHaveAttribute('data-kind', 'green')
  })

  it('an alarms retry is superseded by a cycle that starts after it', async () => {
    m.ignoreAbort = true
    render(<OperationalHealthV2 />)
    await flush()
    await answer('/api/observability/resources', ok(resourcesOk()))
    await answer('/api/observability/alarms', httpError(500), true)
    fireEvent.click(within(screen.getByTestId('tile-alarms')).getByRole('button', { name: 'Retry' }))
    await flush()
    const retry = alarmCalls().at(-1)!
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await flush()
    expect(retry.signal?.aborted).toBe(true)
    await settle()
    // The retry's late answer (2 in ALARM) must not replace the newer cycle's.
    retry.resolve(ok({ ...ALARMS_OK, in_alarm: [{}, {}] }))
    await flush()
    expect(screen.getByTestId('health-banner')).toHaveAttribute('data-kind', 'green')
  })

  it('F3: an older backend’s ok answer (no fleet_summary / type_breakdown) renders the source-failed state', async () => {
    render(<OperationalHealthV2 />)
    await flush()
    const old: Record<string, unknown> = resourcesOk()
    delete old.fleet_summary
    delete old.type_breakdown
    await settle(old)
    expect(screen.getByTestId('health-banner')).toHaveAttribute('data-kind', 'source_failed')
    expect(within(screen.getByTestId('tile-checks')).getByText("Couldn't load checks.")).toBeInTheDocument()
  })

  it('stopped resources only: never red or amber', async () => {
    render(<OperationalHealthV2 />)
    await flush()
    const stopped = { ...ZERO, count: 2, neutral: 2, stopped: 2 }
    await settle(resourcesOk('1h', { type_breakdown: { ec2: stopped }, fleet_summary: stopped }))
    const banner = screen.getByTestId('health-banner')
    expect(banner).toHaveAttribute('data-kind', 'nothing_measured')
    expect(banner).toHaveAttribute('data-tone', 'neutral')
  })
})
