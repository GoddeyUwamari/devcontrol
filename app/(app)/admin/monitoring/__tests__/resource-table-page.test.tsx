/**
 * Operational Health (O2): the Resource checks table in the page.
 * - every resources request carries the table query (table=1, q, filter, page); paging, filters and the
 *   debounced search go to the server; the poll, Refresh and a range change keep the search and filter
 *   (a range change starts at page 1); a page the server clamped is adopted without another request;
 * - a late answer for an older query, or an answer for another q/filter, never shows;
 * - "Couldn't load resource checks." + Retry for every answer that isn't a table, never an empty table;
 * - real table semantics; the search input keeps its value and focus across a poll; the table scrolls
 *   inside its own box.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent, within } from '@testing-library/react'
import OperationalHealthV2 from '../operational-health/OperationalHealthV2'
import { SEARCH_DEBOUNCE_MS } from '../operational-health/ResourceTable'

type Call = { path: string; signal?: AbortSignal; resolve: (v: unknown) => void; reject: (e: unknown) => void; done?: boolean }

const m = vi.hoisted(() => {
  process.env.TZ = 'UTC'
  return {
    calls: [] as Array<{ path: string; signal?: AbortSignal; resolve: (v: unknown) => void; reject: (e: unknown) => void; done?: boolean }>,
    visibility: 'visible' as 'visible' | 'hidden',
    // When set, an aborted request still answers later (its response was already on the wire).
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
const FLEET = { ...ZERO, count: 30, measured: 30, passing: 29, failing: 1, reporting: 30 }

const rowOf = (name: string, over: Record<string, unknown> = {}) => ({
  resource_id: `id-${name}`,
  resource_type: 'ec2',
  name,
  region: 'us-east-1',
  check_status: 'passing',
  unknown_reason: null,
  telemetry: 'reporting',
  activity: null,
  status_detail: null,
  last_seen: '2026-10-29T14:57:00.000Z',
  last_seen_source: 'datapoint',
  metrics: [{ label: 'CPU', value: 3.1, unit: '%', statistic: 'Average', window: '1h' }],
  ...over,
})

interface TableOpts {
  q?: string
  filter?: string
  page?: number
  total?: number
  rows?: unknown[]
  facets?: { all: number; attention: number; types: Record<string, number> }
}

/** A resources answer carrying the table block for the query given. */
function res(opts: TableOpts = {}, range = '1h', over: Record<string, unknown> = {}) {
  const total = opts.total ?? 30
  const page = opts.page ?? 1
  const pages = Math.ceil(total / 25)
  const count = Math.max(0, Math.min(25, total - (page - 1) * 25))
  return {
    status: 'ok', region: 'us-east-1', account_count: 1, multiple_accounts: false, range, collection: 'complete',
    checked_at: '2026-10-29T14:59:00.000Z', captured_at: '2026-10-29T14:59:00.000Z', inventory_capped: false, inventory_capped_reasons: [],
    type_summary: { ec2: { count: 30, passing: 29, needs_attention: 0, failing: 1, other: 0 } },
    type_breakdown: { ec2: FLEET }, fleet_summary: FLEET, resources: [], pagination: { shown: 0, total: 30, has_more: true, cursor: 'x' },
    table: {
      query: { q: opts.q ?? '', filter: opts.filter ?? 'all', page, page_size: 25, order: 'status' },
      rows: opts.rows ?? Array.from({ length: count }, (_, i) => rowOf(`p${page}-r${String(i).padStart(2, '0')}`)),
      total,
      pages,
      facets: opts.facets ?? { all: 30, attention: 1, types: { ec2: 20, lambda: 10 } },
    },
    ...over,
  }
}
const ALARMS_OK = { status: 'ok', reason: null, checked_at: '2026-10-29T14:59:00.000Z', region: 'us-east-1', in_alarm: [], in_alarm_complete: true, configured_count: 3, configured_count_complete: true, truncated: false }

const ok = (data: unknown) => ({ data: { success: true, data } })
const httpError = (status: number) => Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data: {} } })

const resourceCalls = () => m.calls.filter((c) => c.path.startsWith('/api/observability/resources'))
const lastResourcePath = () => resourceCalls()[resourceCalls().length - 1].path
const params = (path: string) => Object.fromEntries(new URL(path, 'https://x').searchParams)

async function flush() {
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve() })
}

/** Answers the latest unanswered call for a path prefix (or the call given). */
async function answer(prefix: string, value: unknown, fail = false, call?: Call) {
  const c = call ?? ([...m.calls].reverse().find((x) => x.path.startsWith(prefix) && !x.done) as Call | undefined)
  if (!c) throw new Error(`no pending call for ${prefix}; calls: ${m.calls.map((x) => x.path).join(', ')}`)
  c.done = true
  if (fail) c.reject(value)
  else c.resolve(value)
  await flush()
}

async function settle(resources: unknown = res(), alarms: unknown = ALARMS_OK) {
  await answer('/api/observability/resources', ok(resources))
  const pendingAlarms = m.calls.find((c) => c.path === '/api/observability/alarms' && !c.done)
  if (pendingAlarms) await answer('/api/observability/alarms', ok(alarms))
}

async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
  await flush()
}

const table = () => screen.getByTestId('resource-table')
const rowNames = () => within(table()).queryAllByRole('rowheader').map((h) => within(h).getAllByText(/./)[0].textContent)

async function mountSettled(resources: unknown = res()) {
  render(<OperationalHealthV2 />)
  await flush()
  await settle(resources)
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

describe('requests', () => {
  it('the first request asks for page 1 of the table, unfiltered', async () => {
    render(<OperationalHealthV2 />)
    await flush()
    expect(lastResourcePath()).toBe('/api/observability/resources?range=1h&pageSize=25&table=1&filter=all&page=1')
    await settle()
    expect(m.calls.some((c) => c.path.startsWith('/api/cloudwatch') || c.path.startsWith('/api/prometheus'))).toBe(false)
  })

  it('Next and Previous ask the server for the page; disabled at the ends', async () => {
    await mountSettled()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await flush()
    expect(params(lastResourcePath())).toMatchObject({ table: '1', filter: 'all', page: '2' })
    await settle(res({ page: 2 }))
    expect(screen.getByTestId('table-footer')).toHaveTextContent('Showing 26–30 of 30 resources · most urgent first')
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
    await flush()
    expect(params(lastResourcePath()).page).toBe('1')
  })

  it('a filter asks for page 1 of that filter; its counts are the server’s', async () => {
    await mountSettled()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await flush()
    await settle(res({ page: 2 }))
    expect(screen.getByRole('button', { name: 'Needs attention, 1' })).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Lambda, 10' }))
    await flush()
    expect(params(lastResourcePath())).toMatchObject({ filter: 'lambda', page: '1' })
    // While it loads, the buttons stay, with Lambda pressed.
    expect(screen.getByRole('button', { name: 'Lambda, 10' })).toHaveAttribute('aria-pressed', 'true')
    await settle(res({ filter: 'lambda', total: 10 }))
    expect(screen.getByTestId('table-footer')).toHaveTextContent('Showing 1–10 of 10 resources')
  })

  it('search is debounced: one request after typing settles, at page 1, trimmed', async () => {
    await mountSettled()
    const before = resourceCalls().length
    const input = screen.getByRole('searchbox', { name: 'Search resources' })
    fireEvent.change(input, { target: { value: 'w' } })
    await advance(100)
    fireEvent.change(input, { target: { value: 'we' } })
    await advance(100)
    fireEvent.change(input, { target: { value: ' web ' } })
    await advance(SEARCH_DEBOUNCE_MS - 1)
    expect(resourceCalls()).toHaveLength(before)
    await advance(1)
    expect(resourceCalls()).toHaveLength(before + 1)
    expect(params(lastResourcePath())).toMatchObject({ q: 'web', filter: 'all', page: '1' })
  })

  it('the poll, Refresh and becoming visible keep the search, filter and page', async () => {
    await mountSettled()
    fireEvent.click(screen.getByRole('button', { name: 'EC2, 20' }))
    await flush()
    await settle(res({ filter: 'ec2', total: 40, facets: { all: 50, attention: 1, types: { ec2: 40, lambda: 10 } } }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await flush()
    await settle(res({ filter: 'ec2', total: 40, page: 2, facets: { all: 50, attention: 1, types: { ec2: 40, lambda: 10 } } }))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'p2' } })
    await advance(SEARCH_DEBOUNCE_MS)
    await settle(res({ q: 'p2', filter: 'ec2', total: 30, page: 1 }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await flush()
    await settle(res({ q: 'p2', filter: 'ec2', total: 30, page: 2 }))
    const expected = { q: 'p2', filter: 'ec2', page: '2', table: '1' }

    await advance(60_000)
    expect(params(lastResourcePath())).toMatchObject(expected)
    expect(params(lastResourcePath()).refresh).toBeUndefined()
    await settle(res({ q: 'p2', filter: 'ec2', total: 30, page: 2 }))
    expect(rowNames()[0]).toBe('p2-r00')

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await flush()
    expect(params(lastResourcePath())).toMatchObject({ ...expected, refresh: 'true' })
    await settle(res({ q: 'p2', filter: 'ec2', total: 30, page: 2 }))

    m.visibility = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    m.visibility = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    await flush()
    expect(params(lastResourcePath())).toMatchObject(expected)
  })

  it('a range change keeps the search and filter and starts at page 1', async () => {
    await mountSettled()
    fireEvent.click(screen.getByRole('button', { name: 'EC2, 20' }))
    await flush()
    await settle(res({ filter: 'ec2', total: 40 }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await flush()
    await settle(res({ filter: 'ec2', total: 40, page: 2 }))
    fireEvent.click(screen.getByRole('button', { name: 'Last 7d' }))
    await flush()
    expect(params(lastResourcePath())).toMatchObject({ range: '7d', filter: 'ec2', page: '1' })
    // Exactly one request for the change (not one for the range and one for the page).
    expect(resourceCalls().filter((c) => params(c.path).range === '7d')).toHaveLength(1)
  })

  it('a page the server clamped is adopted without another request', async () => {
    await mountSettled(res({ total: 60 }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await flush()
    await settle(res({ total: 60, page: 2 }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await flush()
    expect(params(lastResourcePath()).page).toBe('3')
    const before = resourceCalls().length
    // Meanwhile the fleet shrank: page 3 no longer exists, the server answers page 2.
    await settle(res({ total: 40, page: 2 }))
    expect(resourceCalls()).toHaveLength(before)
    expect(screen.getByTestId('table-footer')).toHaveTextContent('Showing 26–40 of 40 resources')
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    // The adopted page is the page from now on: the poll asks for it.
    await advance(60_000)
    expect(params(lastResourcePath()).page).toBe('2')
    await settle(res({ total: 40, page: 2 }))
    // And going back to a page asked for before still asks for it.
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
    await flush()
    expect(params(lastResourcePath()).page).toBe('1')
  })
})

describe('stale answers', () => {
  it('a late answer for an older search never overwrites the newer one', async () => {
    await mountSettled()
    m.ignoreAbort = true
    const input = screen.getByRole('searchbox')
    fireEvent.change(input, { target: { value: 'old' } })
    await advance(SEARCH_DEBOUNCE_MS)
    const older = resourceCalls()[resourceCalls().length - 1] as Call
    fireEvent.change(input, { target: { value: 'new' } })
    await advance(SEARCH_DEBOUNCE_MS)
    expect(params(lastResourcePath()).q).toBe('new')
    await answer('/api/observability/resources', ok(res({ q: 'new', total: 1, rows: [rowOf('newest')], facets: { all: 1, attention: 0, types: { ec2: 1 } } })))
    await answer('', ok(res({ q: 'old', total: 1, rows: [rowOf('stale')], facets: { all: 1, attention: 0, types: { ec2: 1 } } })), false, older)
    expect(rowNames()).toEqual(['newest'])
  })

  it('an answer for another search or filter than asked is an error, never shown as this one', async () => {
    render(<OperationalHealthV2 />)
    await flush()
    await settle(res({ q: 'something-else' }))
    expect(screen.getByTestId('table-error')).toHaveTextContent("Couldn't load resource checks.")
    expect(within(table()).queryAllByTestId('resource-row')).toHaveLength(0)
  })
})

describe('rendering', () => {
  it('real table semantics: caption, five column headers, a row header per resource', async () => {
    await mountSettled(res({ total: 2, rows: [rowOf('web-1', { check_status: 'failing' }), rowOf('web-2')] }))
    const t = within(table()).getByRole('table', { name: 'Resource checks, most urgent first' })
    expect(within(t).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Resource', 'Type', 'Status', 'Key metric', 'Last seen'])
    expect(rowNames()).toEqual(['web-1', 'web-2'])
    const first = within(t).getAllByTestId('resource-row')[0]
    expect(first).toHaveTextContent('web-1')
    expect(first).toHaveTextContent('id-web-1')
    expect(first).toHaveTextContent('Failing')
    expect(within(first).getByTestId('row-status')).toHaveAttribute('data-tone', 'danger')
    expect(first).toHaveTextContent('CPU 3.1% (1h average)')
    expect(first).toHaveTextContent('3 min ago')
    expect(first).toHaveTextContent('today, 2:57 PM UTC')
    // No badge, no row link (D7, D8).
    expect(table()).not.toHaveTextContent(/core service/i)
    expect(within(t).queryAllByRole('link')).toHaveLength(0)
  })

  it('never seen and no key metric are "—", with a screen-reader word', async () => {
    await mountSettled(res({ total: 1, rows: [rowOf('bucket', { resource_type: 's3', check_status: 'not_measured', last_seen: null, last_seen_source: null, metrics: [] })] }))
    const r = within(table()).getAllByTestId('resource-row')[0]
    expect(r).toHaveTextContent('Not measured yet')
    expect(r).toHaveTextContent('Listed so you can see it exists; not counted in coverage')
    expect(within(r).getAllByText('Not available')).toHaveLength(2)
  })

  it('the footer is a live region; the table scrolls inside its own box', async () => {
    await mountSettled()
    expect(screen.getByTestId('table-footer')).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByTestId('resource-table-scroll')).toHaveClass('overflow-x-auto')
    expect(within(table()).getByRole('table')).toHaveClass('min-w-[640px]')
    expect(table()).toHaveClass('min-w-0')
  })

  it('the search input keeps its value and focus across a poll', async () => {
    await mountSettled()
    const input = screen.getByRole('searchbox') as HTMLInputElement
    input.focus()
    fireEvent.change(input, { target: { value: 'p1' } })
    await advance(SEARCH_DEBOUNCE_MS)
    // Still mounted while the search loads.
    expect(screen.getByRole('searchbox')).toBe(input)
    await settle(res({ q: 'p1' }))
    await advance(60_000)
    await settle(res({ q: 'p1' }))
    expect(screen.getByRole('searchbox')).toBe(input)
    expect(input.value).toBe('p1')
    expect(document.activeElement).toBe(input)
  })

  it('no match: the message and Clear search, which asks again at once', async () => {
    await mountSettled()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } })
    await advance(SEARCH_DEBOUNCE_MS)
    await settle(res({ q: 'zzz', total: 0, rows: [], facets: { all: 0, attention: 0, types: {} } }))
    expect(screen.getByTestId('table-no-match')).toHaveTextContent('No resources match “zzz”.')
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    await flush()
    expect(params(lastResourcePath()).q).toBeUndefined()
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('')
  })

  it('incomplete discovery: the caption line, and never "No resources found in" for an empty list', async () => {
    await mountSettled(res({ total: 0, rows: [], facets: { all: 0, attention: 0, types: {} } }, '1h', { inventory_capped: null }))
    expect(screen.getByTestId('table-caption')).toHaveTextContent("This list may be incomplete: discovery didn't finish.")
    expect(screen.getByTestId('table-empty')).toHaveTextContent("No resources found yet. Discovery didn't finish, so some may be missing.")
  })
})

describe('error and notices', () => {
  it.each([
    ['HTTP 503', httpError(503)],
    ['HTTP 500', httpError(500)],
  ])('%s: "Couldn\'t load resource checks." + Retry, no rows and no count; Retry bypasses the cache', async (_label, err) => {
    render(<OperationalHealthV2 />)
    await flush()
    await answer('/api/observability/resources', err, true)
    await answer('/api/observability/alarms', ok(ALARMS_OK))
    const box = screen.getByTestId('table-error')
    expect(box).toHaveTextContent("Couldn't load resource checks.")
    expect(within(table()).queryByRole('table')).toBeNull()
    expect(within(table()).queryByRole('searchbox')).toBeNull()
    expect(table().textContent).not.toMatch(/\d/)
    fireEvent.click(within(box).getByRole('button', { name: 'Retry' }))
    await flush()
    expect(params(lastResourcePath())).toMatchObject({ refresh: 'true', table: '1' })
  })

  it('a failed sweep, or an ok answer without a table (an older backend), is the error state', async () => {
    render(<OperationalHealthV2 />)
    await flush()
    await settle({ status: 'failed', reason: 'query_failed', region: null, account_count: 1 })
    expect(screen.getByTestId('table-error')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await flush()
    const noTable = res()
    delete (noTable as { table?: unknown }).table
    await settle(noTable)
    expect(screen.getByTestId('table-error')).toBeInTheDocument()
  })

  it('a poll that fails after a success replaces the rows with the error state', async () => {
    await mountSettled()
    expect(within(table()).getAllByTestId('resource-row').length).toBeGreaterThan(0)
    await advance(60_000)
    await answer('/api/observability/resources', httpError(500), true)
    await answer('/api/observability/alarms', ok(ALARMS_OK))
    expect(within(table()).queryAllByTestId('resource-row')).toHaveLength(0)
    expect(screen.getByTestId('table-error')).toBeInTheDocument()
  })

  it.each([
    ['not_connected', 'Connect AWS to see resource checks.'],
    ['multiple_accounts', 'More than one AWS account is connected, so nothing is shown yet.'],
  ])('%s: one neutral line, no Retry in the table', async (status, text) => {
    render(<OperationalHealthV2 />)
    await flush()
    await settle({ status, region: null, account_count: status === 'not_connected' ? 0 : 2 })
    expect(screen.getByTestId('table-notice')).toHaveTextContent(text)
    expect(within(table()).queryByRole('button', { name: 'Retry' })).toBeNull()
    expect(within(table()).queryByRole('table')).toBeNull()
  })
})
