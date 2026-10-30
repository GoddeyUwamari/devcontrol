/**
 * Operational Health (O3b): the load balancer response-time chart and the table's
 * "5xx X% of N requests", in the page.
 * - the chart reads the resources answer the rest of the page reads: one /resources
 *   request per cycle, carrying lb_response_time=1, and no other request;
 * - under the Resource checks table, before What we monitor; heading, value and caption
 *   per Board D; the line breaks at gaps (connectNulls off, nulls in its data, linear);
 * - no data, a failure, no load balancer or no block → no chart at all;
 * - a range change shows no chart for the old range.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ReactNode } from 'react'
import { render, screen, act, fireEvent, within } from '@testing-library/react'
import OperationalHealthV2 from '../operational-health/OperationalHealthV2'

const m = vi.hoisted(() => {
  process.env.TZ = 'UTC'
  return {
    calls: [] as Array<{ path: string; signal?: AbortSignal; resolve: (v: unknown) => void; reject: (e: unknown) => void; done?: boolean }>,
    lineProps: [] as Array<Record<string, unknown>>,
    chartData: [] as unknown[][],
  }
})

vi.mock('@/lib/api', () => {
  const get = (path: string, config?: { signal?: AbortSignal }) =>
    new Promise((resolve, reject) => {
      m.calls.push({ path, signal: config?.signal, resolve, reject })
      config?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('canceled'), { name: 'CanceledError' })))
    })
  const api = { get, post: get, put: get, delete: get, patch: get }
  return { default: api, api, handleApiResponse: (r: { data: { data: unknown } }) => r.data.data }
})
vi.mock('@/lib/hooks/use-plan', () => ({ usePlan: () => ({ status: 'known', tier: 'pro', isKnown: true }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
// jsdom has no layout, so recharts would draw nothing: record what the chart is given instead.
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div data-testid="rc-container">{children}</div>,
  LineChart: ({ data, children }: { data: unknown[]; children: ReactNode }) => {
    m.chartData.push(data)
    return <div data-testid="rc-line-chart">{children}</div>
  },
  Line: (props: Record<string, unknown>) => {
    m.lineProps.push(props)
    return <div data-testid="rc-line" />
  },
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
}))

const ZERO = { count: 0, measured: 0, passing: 0, needs_attention: 0, failing: 0, check_unknown: 0, check_failed: 0, neutral: 0, stopped: 0, no_activity: 0, not_enough_traffic: 0, not_measured: 0, outside_scope: 0, reporting: 0, no_telemetry: 0, unknown: 0 }
const LB = { ...ZERO, count: 1, measured: 1, passing: 1, reporting: 1 }

const metric = (label: string, value: number, over: Record<string, unknown> = {}) => ({ label, value, statistic: 'Sum', window: '1h', ...over })
const ALB_ROW = {
  resource_id: 'busy-alb', resource_type: 'load-balancer', name: 'busy-alb', region: 'us-east-1', check_status: 'passing', unknown_reason: null,
  telemetry: 'reporting', activity: 'active', status_detail: null, last_seen: '2026-10-30T13:55:00.000Z', last_seen_source: 'datapoint',
  metrics: [
    metric('Avg latency', 123, { unit: 'ms', statistic: 'Average' }),
    metric('5xx errors', 30),
    metric('5xx rate', 0.33, { unit: '%' }),
    metric('Requests', 9000),
  ],
}

const START = '2026-10-30T13:00:00.000Z'
const END = '2026-10-30T14:00:00.000Z'
const lb = (over: Record<string, unknown> = {}) => ({
  range: '1h', window_start: START, window_end: END, period_seconds: 300, statistic: 'Average', unit: 'ms',
  eligible_count: 3, selection_complete: true, collection: 'complete', checked_at: END, state: 'ok',
  charted: {
    resource_id: 'busy-alb', name: 'busy-alb', value_ms: 123,
    points: [{ t: '2026-10-30T13:00:00.000Z', ms: 100 }, { t: '2026-10-30T13:05:00.000Z', ms: 120 }, { t: '2026-10-30T13:15:00.000Z', ms: 150 }],
  },
  ...over,
})

const res = (over: Record<string, unknown> = {}) => ({
  status: 'ok', region: 'us-east-1', account_count: 1, multiple_accounts: false, range: '1h', collection: 'complete',
  checked_at: END, captured_at: END, inventory_capped: false, inventory_capped_reasons: [],
  type_summary: { 'load-balancer': { count: 1, passing: 1, needs_attention: 0, failing: 0, other: 0 } },
  type_breakdown: { 'load-balancer': LB }, fleet_summary: LB, resources: [], pagination: { shown: 0, total: 1, has_more: false, cursor: null },
  table: { query: { q: '', filter: 'all', page: 1, page_size: 25, order: 'status' }, rows: [ALB_ROW], total: 1, pages: 1, facets: { all: 1, attention: 0, types: { 'load-balancer': 1 } } },
  lb_response_time: lb(),
  ...over,
})
const ALARMS_OK = { status: 'ok', reason: null, checked_at: END, region: 'us-east-1', in_alarm: [], in_alarm_complete: true, configured_count: 0, configured_count_complete: true, truncated: false }
const ok = (data: unknown) => ({ data: { success: true, data } })

const resourceCalls = () => m.calls.filter((c) => c.path.startsWith('/api/observability/resources'))

async function flush() {
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve() })
}

async function answer(prefix: string, value: unknown) {
  const c = [...m.calls].reverse().find((x) => x.path.startsWith(prefix) && !x.done)
  if (!c) throw new Error(`no pending call for ${prefix}`)
  c.done = true
  c.resolve(value)
  await flush()
}

async function mountWith(resources: unknown) {
  render(<OperationalHealthV2 />)
  await flush()
  await answer('/api/observability/resources', ok(resources))
  await answer('/api/observability/alarms', ok(ALARMS_OK))
}

const chart = () => screen.queryByTestId('lb-response-time')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], now: Date.parse('2026-10-30T14:00:30Z') })
  m.calls.length = 0
  m.lineProps.length = 0
  m.chartData.length = 0
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
  global.fetch = vi.fn(() => Promise.reject(new Error('the page must not use fetch'))) as unknown as typeof fetch
})
afterEach(() => {
  vi.useRealTimers()
})

describe('one resources answer', () => {
  it('one /resources request per cycle, carrying lb_response_time=1; no other request', async () => {
    await mountWith(res())
    expect(resourceCalls()).toHaveLength(1)
    expect(new URL(resourceCalls()[0].path, 'http://x').searchParams.get('lb_response_time')).toBe('1')
    expect(m.calls.map((c) => c.path.split('?')[0]).sort()).toEqual(['/api/observability/alarms', '/api/observability/resources'])
  })

  it('the chart component and its model import no request client', () => {
    for (const file of ['ResponseTimeChart.tsx', 'responseTimeModel.ts']) {
      const source = readFileSync(join(__dirname, '..', 'operational-health', file), 'utf8')
      expect(source).not.toMatch(/@\/lib\/api|axios|fetch\(|useEffect/)
    }
  })
})

describe('the chart', () => {
  it('sits under the Resource checks table and before What we monitor', async () => {
    await mountWith(res())
    const order = (a: Element, b: Element) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING
    expect(order(screen.getByTestId('resource-table'), chart()!)).toBeTruthy()
    expect(order(chart()!, screen.getByText('What we monitor'))).toBeTruthy()
  })

  it('heading, value and caption per Board D, naming the load balancer', async () => {
    await mountWith(res())
    expect(within(chart()!).getByRole('heading', { level: 2 })).toHaveTextContent('Load balancer response time (average)')
    expect(screen.getByTestId('lb-response-time-value')).toHaveTextContent('123 ms')
    expect(screen.getByTestId('lb-response-time-caption').textContent).toBe('From busy-alb · 1h · Average, as CloudWatch reports it')
    // No cap line, picker or count of other load balancers (decision 8).
    expect(chart()!.textContent).not.toMatch(/other load balancer|of 3|Showing/i)
  })

  it('the line breaks at the gap: linear, connectNulls off, a null for 13:10, never 0', async () => {
    await mountWith(res())
    const line = m.lineProps.at(-1)!
    expect(line.type).toBe('linear')
    expect(line.connectNulls).toBe(false)
    expect(line.dataKey).toBe('ms')
    const data = m.chartData.at(-1) as Array<{ t: number; ms: number | null }>
    expect(data.map((d) => d.ms)).toEqual([100, 120, null, 150, null])
    expect(data.some((d) => d.ms === 0)).toBe(false)
  })

  it('a text alternative: one line per period, the gap reads "no data"', async () => {
    await mountWith(res())
    const items = within(screen.getByTestId('lb-response-time-summary')).getAllByRole('listitem').map((li) => li.textContent)
    expect(items).toEqual([
      'Oct 30, 1:00 PM UTC: 100 ms',
      'Oct 30, 1:05 PM UTC: 120 ms',
      'Oct 30, 1:10 PM UTC: no data',
      'Oct 30, 1:15 PM UTC: 150 ms',
      'Oct 30, 1:20 PM UTC: no data',
    ])
  })

  it.each([
    ['no_data', { lb_response_time: lb({ state: 'no_data', charted: null }) }],
    ['failed', { lb_response_time: lb({ state: 'failed', charted: null, collection: 'partial', checked_at: null }) }],
    ['none (no load balancer, or only NLB/GWLB)', { lb_response_time: lb({ state: 'none', charted: null, eligible_count: 0 }) }],
    ['block absent', { lb_response_time: undefined }],
  ])('%s → no chart, no empty frame, no text in its place', async (_name, over) => {
    await mountWith(res(over))
    expect(chart()).toBeNull()
    expect(screen.queryByTestId('rc-line-chart')).toBeNull()
    expect(document.body.textContent).not.toMatch(/Load balancer response time/)
  })

  it('a range change: no chart for the old range while the new answer loads, then the new one', async () => {
    await mountWith(res())
    expect(chart()).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Last 24h' }))
    await flush()
    expect(chart()).toBeNull()
    await answer('/api/observability/resources', ok(res({ range: '24h', lb_response_time: lb({ range: '24h', window_start: '2026-10-29T14:00:00.000Z', period_seconds: 3600 }) })))
    expect(screen.getByTestId('lb-response-time-caption').textContent).toBe('From busy-alb · 24h · Average, as CloudWatch reports it')
  })
})

describe('the table key metric', () => {
  it('"5xx X% of N requests" for the load balancer row', async () => {
    await mountWith(res())
    const row = screen.getAllByTestId('resource-row').find((r) => r.textContent?.includes('busy-alb'))!
    expect(row).toHaveTextContent('5xx 0.33% of 9,000 requests (over 1h) · Response 123 ms (1h average)')
  })
})
