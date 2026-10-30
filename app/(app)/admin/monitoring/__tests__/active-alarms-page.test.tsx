/**
 * Operational Health (O3a): the Active alarms list in the page.
 * - it renders the alarms answer the tile uses: no request of its own (one /alarms per cycle, as in
 *   O1), and Retry in the list or the tile updates both from one answer;
 * - between the tiles and the By-type cards; four columns, no severity; newest first;
 * - an error is "Couldn't read CloudWatch alarms." + Retry, never an empty list; the empty text needs
 *   a complete ok answer; an incomplete list says so with the count the tile shows;
 * - the newest 25 first, "Show all N" for the rest; links open CloudWatch in a new tab.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, act, fireEvent, within } from '@testing-library/react'
import OperationalHealthV2 from '../operational-health/OperationalHealthV2'

type Call = { path: string; signal?: AbortSignal; resolve: (v: unknown) => void; reject: (e: unknown) => void; done?: boolean }

const m = vi.hoisted(() => {
  process.env.TZ = 'UTC'
  return {
    calls: [] as Array<{ path: string; signal?: AbortSignal; resolve: (v: unknown) => void; reject: (e: unknown) => void; done?: boolean }>,
    visibility: 'visible' as 'visible' | 'hidden',
    ignoreAbort: false,
  }
})

vi.mock('@/lib/api', () => {
  const get = (path: string, config?: { signal?: AbortSignal }) =>
    new Promise((resolve, reject) => {
      m.calls.push({ path, signal: config?.signal, resolve, reject })
      if (!m.ignoreAbort) config?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('canceled'), { name: 'CanceledError' })))
    })
  const api = { get, post: get, put: get, delete: get, patch: get }
  return { default: api, api, handleApiResponse: (r: { data: { data: unknown } }) => r.data.data }
})
vi.mock('@/lib/hooks/use-plan', () => ({ usePlan: () => ({ status: 'known', tier: 'pro', isKnown: true }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const ZERO = { count: 0, measured: 0, passing: 0, needs_attention: 0, failing: 0, check_unknown: 0, check_failed: 0, neutral: 0, stopped: 0, no_activity: 0, not_enough_traffic: 0, not_measured: 0, outside_scope: 0, reporting: 0, no_telemetry: 0, unknown: 0 }
const EC2 = { ...ZERO, count: 2, measured: 2, passing: 2, reporting: 2 }

const res = (over: Record<string, unknown> = {}) => ({
  status: 'ok', region: 'us-east-1', account_count: 1, multiple_accounts: false, range: '1h', collection: 'complete',
  checked_at: '2026-10-29T14:59:00.000Z', captured_at: '2026-10-29T14:59:00.000Z', inventory_capped: false, inventory_capped_reasons: [],
  type_summary: { ec2: { count: 2, passing: 2, needs_attention: 0, failing: 0, other: 0 } },
  type_breakdown: { ec2: EC2 }, fleet_summary: EC2, resources: [], pagination: { shown: 0, total: 2, has_more: false, cursor: null },
  table: { query: { q: '', filter: 'all', page: 1, page_size: 25, order: 'status' }, rows: [], total: 0, pages: 0, facets: { all: 0, attention: 0, types: {} } },
  ...over,
})

const alarm = (name: string, over: Record<string, unknown> = {}) => ({
  name, type: 'metric', namespace: 'AWS/EC2', metric: 'CPUUtilization', comparison: 'GreaterThanThreshold', threshold: 80,
  state_since: '2026-10-29T14:48:00.000Z', resource: { type: 'ec2', id: 'i-0123456789abcdef0' }, ...over,
})
const ALARMS_OK = { status: 'ok', reason: null, checked_at: '2026-10-29T14:59:00.000Z', region: 'us-east-1', in_alarm: [] as unknown[], in_alarm_complete: true, configured_count: 3, configured_count_complete: true, truncated: false }
const alarmsWith = (in_alarm: unknown[], over: Record<string, unknown> = {}) => ({ ...ALARMS_OK, in_alarm, ...over })
const ALARMS_DENIED = { ...ALARMS_OK, status: 'error', reason: 'access_denied', in_alarm: null, in_alarm_complete: null, configured_count: null, configured_count_complete: null, truncated: null }

const ok = (data: unknown) => ({ data: { success: true, data } })
const httpError = (status: number) => Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data: {} } })

const resourceCalls = () => m.calls.filter((c) => c.path.startsWith('/api/observability/resources'))
const alarmCalls = () => m.calls.filter((c) => c.path === '/api/observability/alarms')

async function flush() {
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve() })
}

async function answer(prefix: string, value: unknown, fail = false) {
  const c = [...m.calls].reverse().find((x) => x.path.startsWith(prefix) && !x.done) as Call | undefined
  if (!c) throw new Error(`no pending call for ${prefix}; calls: ${m.calls.map((x) => x.path).join(', ')}`)
  c.done = true
  if (fail) c.reject(value)
  else c.resolve(value)
  await flush()
}

async function settle(alarms: unknown = ALARMS_OK, resources: unknown = res()) {
  await answer('/api/observability/resources', ok(resources))
  await answer('/api/observability/alarms', ok(alarms))
}

async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
  await flush()
}

const section = () => screen.getByTestId('active-alarms')
const tile = () => screen.getByTestId('tile-alarms')
const rowNames = () => within(section()).queryAllByRole('rowheader').map((h) => h.textContent?.replace(' ↗', ''))

async function mountSettled(alarms: unknown = ALARMS_OK) {
  render(<OperationalHealthV2 />)
  await flush()
  await settle(alarms)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], now: Date.parse('2026-10-29T15:00:00Z') })
  m.calls.length = 0
  m.visibility = 'visible'
  m.ignoreAbort = false
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => m.visibility })
  global.fetch = vi.fn(() => Promise.reject(new Error('the page must not use fetch'))) as unknown as typeof fetch
})
afterEach(() => {
  vi.useRealTimers()
})

describe('one alarms answer for the tile and the list', () => {
  it('mount: one /alarms request; a poll: one more; a range change: one more', async () => {
    render(<OperationalHealthV2 />)
    await flush()
    expect(alarmCalls()).toHaveLength(1)
    await settle(alarmsWith([alarm('a')]))
    expect(alarmCalls()).toHaveLength(1)
    await advance(60_000)
    expect(alarmCalls()).toHaveLength(2)
    await settle(alarmsWith([alarm('a')]))
    fireEvent.click(screen.getByRole('button', { name: 'Last 7d' }))
    await flush()
    expect(alarmCalls()).toHaveLength(3)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('Retry in the list: /alarms only; the answer reaches the tile and the list together', async () => {
    render(<OperationalHealthV2 />)
    await flush()
    await answer('/api/observability/resources', ok(res()))
    await answer('/api/observability/alarms', httpError(500), true)
    expect(tile()).toHaveTextContent("Couldn't read CloudWatch alarms.")
    expect(screen.getByTestId('alarms-error')).toHaveTextContent("Couldn't read CloudWatch alarms.")
    const before = resourceCalls().length
    fireEvent.click(within(section()).getByRole('button', { name: 'Retry' }))
    await flush()
    expect(resourceCalls()).toHaveLength(before)
    expect(alarmCalls()).toHaveLength(2)
    await answer('/api/observability/alarms', ok(alarmsWith([alarm('a'), alarm('b')])))
    expect(tile()).toHaveTextContent('2in ALARM3configured')
    expect(rowNames()).toEqual(['a', 'b'])
  })

  it('Retry in the tile updates the list too', async () => {
    render(<OperationalHealthV2 />)
    await flush()
    await answer('/api/observability/resources', ok(res()))
    await answer('/api/observability/alarms', httpError(500), true)
    fireEvent.click(within(tile()).getByRole('button', { name: 'Retry' }))
    await flush()
    expect(alarmCalls()).toHaveLength(2)
    await answer('/api/observability/alarms', ok(ALARMS_OK))
    expect(screen.getByTestId('alarms-empty')).toHaveTextContent('No CloudWatch alarms are in ALARM.')
    expect(tile()).toHaveTextContent('0in ALARM')
  })

  it('a list retry superseded by Refresh: its late answer changes neither the tile nor the list', async () => {
    m.ignoreAbort = true
    render(<OperationalHealthV2 />)
    await flush()
    await answer('/api/observability/resources', ok(res()))
    await answer('/api/observability/alarms', httpError(500), true)
    fireEvent.click(within(section()).getByRole('button', { name: 'Retry' }))
    await flush()
    const retry = alarmCalls().at(-1)!
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await flush()
    expect(retry.signal?.aborted).toBe(true)
    await settle()
    retry.resolve(ok(alarmsWith([alarm('late')])))
    await flush()
    expect(screen.getByTestId('alarms-empty')).toBeInTheDocument()
    expect(tile()).toHaveTextContent('0in ALARM')
  })

  it('the list component and its model import no request client', () => {
    const dir = join(__dirname, '../operational-health')
    for (const file of ['ActiveAlarms.tsx', 'alarmsListModel.ts']) {
      const src = readFileSync(join(dir, file), 'utf8')
      expect(src).not.toMatch(/@\/lib\/api|axios|fetch\(|useEffect/)
    }
  })
})

describe('rendering', () => {
  it('sits after the tiles and before the By-type cards', async () => {
    await mountSettled()
    const order = (a: Element, b: Element) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING
    expect(order(tile(), section())).toBeTruthy()
    expect(order(section(), screen.getByText('By resource type'))).toBeTruthy()
  })

  it('four columns, no severity; newest first; composite name only; links open CloudWatch in a new tab', async () => {
    await mountSettled(alarmsWith([
      alarm('older', { state_since: '2026-10-29T12:00:00.000Z' }),
      { name: 'combo', type: 'composite', namespace: null, metric: null, comparison: null, threshold: null, state_since: '2026-10-29T14:59:00.000Z', resource: null },
      alarm('no time', { state_since: null, resource: null }),
    ]))
    const table = within(section()).getByRole('table', { name: /active alarms/i })
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Alarm', 'Metric', 'Resource', 'In ALARM since'])
    expect(section()).not.toHaveTextContent(/severity|critical|warning/i)
    expect(rowNames()).toEqual(['combo', 'older', 'no time'])

    const rows = within(table).getAllByTestId('alarm-row')
    expect(within(rows[0]).getByTestId('alarm-metric')).toHaveTextContent('—Not availableComposite alarm')
    expect(within(rows[1]).getByTestId('alarm-metric')).toHaveTextContent('CPUUtilization > 80AWS/EC2')
    expect(rows[1]).toHaveTextContent('i-0123456789abcdef0 · EC2')
    expect(rows[1]).toHaveTextContent('3 h ago')
    expect(rows[1].querySelector('time')).toHaveAttribute('dateTime', '2026-10-29T12:00:00.000Z')

    const link = within(rows[2]).getByRole('link', { name: 'Open no time in CloudWatch' })
    expect(link).toHaveAttribute('href', 'https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#alarmsV2:alarm/no%20time')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(within(rows[0]).getByRole('link', { name: 'Open combo in CloudWatch' })).toHaveAttribute('href', 'https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#alarmsV2:alarm/combo')
    expect(within(section()).getByRole('link', { name: 'View all in CloudWatch ↗' })).toHaveAttribute('href', 'https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#alarmsV2:')
  })

  it('D8: the newest 25 first; "Show all N" reveals the rest', async () => {
    const many = Array.from({ length: 30 }, (_, i) => alarm(`a${String(i).padStart(2, '0')}`, { state_since: new Date(Date.parse('2026-10-29T14:00:00Z') + i * 60_000).toISOString() }))
    await mountSettled(alarmsWith(many))
    expect(rowNames()).toHaveLength(25)
    expect(rowNames()[0]).toBe('a29')
    expect(rowNames()).not.toContain('a00')
    fireEvent.click(within(section()).getByRole('button', { name: 'Show all 30' }))
    expect(rowNames()).toHaveLength(30)
    expect(rowNames().at(-1)).toBe('a00')
    expect(within(section()).queryByRole('button', { name: /Show all/ })).toBeNull()
  })

  it('the table scrolls inside its own box', async () => {
    await mountSettled(alarmsWith([alarm('a')]))
    expect(screen.getByTestId('alarms-table-scroll')).toHaveClass('overflow-x-auto')
    expect(section()).toHaveClass('min-w-0')
  })
})

describe('states', () => {
  it('loading: skeleton rows, never the empty text', async () => {
    render(<OperationalHealthV2 />)
    await flush()
    expect(within(section()).getAllByTestId('alarm-skeleton-row')).toHaveLength(3)
    expect(section()).not.toHaveTextContent('No CloudWatch alarms are in ALARM.')
  })

  it('error ≠ empty: access denied → message, detail, Retry; no table, no empty text', async () => {
    await mountSettled(ALARMS_DENIED)
    expect(screen.getByTestId('alarms-error')).toHaveTextContent("Couldn't read CloudWatch alarms.DevControl's role isn't allowed to read alarms.Retry")
    expect(within(section()).queryByRole('table')).toBeNull()
    expect(section()).not.toHaveTextContent('No CloudWatch alarms are in ALARM.')
  })

  it('ok with 0 in ALARM → "No CloudWatch alarms are in ALARM."; the tile says 0', async () => {
    await mountSettled(ALARMS_OK)
    expect(screen.getByTestId('alarms-empty')).toHaveTextContent('No CloudWatch alarms are in ALARM.')
    expect(within(section()).queryByRole('table')).toBeNull()
    expect(tile()).toHaveTextContent('0in ALARM')
  })

  it('incomplete list: the partial line and the tile’s "at least N" agree on N', async () => {
    await mountSettled(alarmsWith([alarm('a'), alarm('b')], { in_alarm_complete: false, truncated: true }))
    expect(screen.getByTestId('alarms-partial')).toHaveTextContent("Showing 2 alarms in ALARM. There may be more; this list isn't complete.")
    expect(tile()).toHaveTextContent('at least 2in ALARM')
  })

  it('incomplete list with nothing returned: says the list is incomplete, never the empty text', async () => {
    await mountSettled(alarmsWith([], { in_alarm_complete: false, truncated: true }))
    expect(screen.getByTestId('alarms-incomplete')).toHaveTextContent(
      "CloudWatch didn't return the full list of alarms in ALARM, so DevControl can't say none are firing.",
    )
    expect(section()).not.toHaveTextContent('No CloudWatch alarms are in ALARM.')
    expect(within(section()).queryByRole('table')).toBeNull()
  })

  it('truncated by the configured count only: no partial line', async () => {
    await mountSettled(alarmsWith([alarm('a')], { truncated: true, configured_count_complete: false }))
    expect(within(section()).queryByTestId('alarms-partial')).toBeNull()
    expect(rowNames()).toEqual(['a'])
  })

  it('not connected: one neutral line, no Retry, no table', async () => {
    render(<OperationalHealthV2 />)
    await flush()
    await settle(
      { ...ALARMS_DENIED, reason: 'not_connected', region: null },
      { status: 'not_connected', region: null, account_count: 0 },
    )
    expect(screen.getByTestId('alarms-notice')).toHaveTextContent('Connect AWS to see CloudWatch alarms.')
    expect(within(section()).queryByRole('button', { name: 'Retry' })).toBeNull()
    expect(within(section()).queryByRole('table')).toBeNull()
  })
})
