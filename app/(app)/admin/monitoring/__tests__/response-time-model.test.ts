/**
 * O3b: the load balancer response-time chart model (responseTimeModel.ts) and the
 * table's "5xx X% of N requests" (resourceTableModel.ts lbFiveXxText / keyMetricText).
 * - a missing period is a null the line breaks at: never 0, never joined, never made up;
 * - the chart only for an ok block with points, for the answer's own range;
 * - caption exactly Board D's, with the load balancer's name and the range;
 * - the text alternative reads a run of missing periods as one range (review M1);
 * - "of N requests" only from the row's own Requests; counts when 5xx > N or N = 0.
 */
import { describe, it, expect, vi } from 'vitest'
import { chartData, periodRangeLabel, responseTimeView } from '../operational-health/responseTimeModel'
import { keyMetricText, lbFiveXxText } from '../operational-health/resourceTableModel'
import type { LbResponseTime, ObservabilityMetric, ObservabilityRow, ResourcesData, Source } from '../operational-health/observabilityTypes'

vi.hoisted(() => {
  process.env.TZ = 'UTC'
})

const MIN = 60_000
const START = Date.parse('2026-10-30T13:00:00.000Z')
const END = Date.parse('2026-10-30T14:00:00.000Z')
const iso = (minutes: number) => new Date(START + minutes * MIN).toISOString()
const pts = (...pairs: Array<[number, number]>) => pairs.map(([m, ms]) => ({ t: iso(m), ms }))
const values = (d: ReturnType<typeof chartData>) => d.map((x) => [(x.t - START) / MIN, x.ms])

describe('chartData: gaps stay gaps', () => {
  it('every period present: no null, nothing added', () => {
    const d = chartData(pts(...Array.from({ length: 12 }, (_, i) => [i * 5, 100 + i] as [number, number])), START, END, 5 * MIN)
    expect(d).toHaveLength(12)
    expect(d.every((x) => x.ms !== null)).toBe(true)
  })

  it('a missing middle period → one null between, never 0', () => {
    const d = chartData(pts([0, 100], [5, 120], [15, 150]), START, END, 5 * MIN)
    expect(values(d).slice(0, 4)).toEqual([[0, 100], [5, 120], [10, null], [15, 150]])
    expect(d.some((x) => x.ms === 0)).toBe(false)
  })

  it('several missing periods → still one break (no value invented in between)', () => {
    expect(values(chartData(pts([0, 100], [40, 110], [55, 120]), START, END, 5 * MIN))).toEqual([[0, 100], [5, null], [40, 110], [45, null], [55, 120]])
  })

  it('a missing first period (window start rounded down to the minute) and a missing last period', () => {
    const start = START + 23_000 // 13:00:23 → CloudWatch's first period starts 13:00:00
    expect(values(chartData(pts([5, 100], [10, 110]), start, END, 5 * MIN))).toEqual([[0, null], [5, 100], [10, 110], [15, null]])
    expect(values(chartData(pts([0, 100], [55, 110]), start, END, 5 * MIN))[0]).toEqual([0, 100])
  })

  it('unsorted input is sorted; a point between two gaps is marked isolated (drawn as a dot)', () => {
    const d = chartData(pts([30, 130], [0, 100], [5, 105]), START, END, 5 * MIN)
    expect(values(d)).toEqual([[0, 100], [5, 105], [10, null], [30, 130], [35, null]])
    expect(d.map((x) => x.isolated)).toEqual([false, false, false, true, false])
  })

  it('nothing to draw → []', () => {
    expect(chartData([], START, END, 5 * MIN)).toEqual([])
    expect(chartData(pts([0, 100]), START, END, 0)).toEqual([])
  })
})

const block = (over: Partial<LbResponseTime> = {}): LbResponseTime => ({
  range: '1h',
  window_start: new Date(START).toISOString(),
  window_end: new Date(END).toISOString(),
  period_seconds: 300,
  statistic: 'Average',
  unit: 'ms',
  eligible_count: 3,
  selection_complete: true,
  collection: 'complete',
  checked_at: new Date(END).toISOString(),
  state: 'ok',
  charted: { resource_id: 'example-alb', name: 'example-alb', value_ms: 1234, points: pts([0, 100], [5, 120], [15, 150]) },
  ...over,
})

const okSource = (lb: LbResponseTime | undefined, range = '1h'): Source<ResourcesData> =>
  ({ state: 'ok', data: { status: 'ok', region: 'us-east-1', range, lb_response_time: lb } as unknown as ResourcesData })

const summaryOf = (points: Array<[number, number]>, over: Partial<LbResponseTime> = {}) =>
  responseTimeView(okSource(block({ charted: { resource_id: 'a', name: 'a', value_ms: 100, points: pts(...points) }, ...over })))!.summary.map((s) => s.text)

describe('the text alternative: missing periods (review M1)', () => {
  it('a run of four missing periods is one range line, first to last missing period', () => {
    expect(summaryOf([[0, 100], [5, 120], [30, 150], [55, 160]])).toEqual([
      'Oct 30, 1:00 PM UTC: 100 ms',
      'Oct 30, 1:05 PM UTC: 120 ms',
      'Oct 30, 1:10–1:25 PM UTC: no data',
      'Oct 30, 1:30 PM UTC: 150 ms',
      'Oct 30, 1:35–1:50 PM UTC: no data',
      'Oct 30, 1:55 PM UTC: 160 ms',
    ])
  })

  it('a single missing period stays one time', () => {
    expect(summaryOf([[0, 100], [10, 110], [55, 120]])).toContain('Oct 30, 1:05 PM UTC: no data')
  })

  it('leading and trailing runs are ranges too, bounded by the window', () => {
    expect(summaryOf([[20, 100], [30, 110]])).toEqual([
      'Oct 30, 1:00–1:15 PM UTC: no data',
      'Oct 30, 1:20 PM UTC: 100 ms',
      'Oct 30, 1:25 PM UTC: no data',
      'Oct 30, 1:30 PM UTC: 110 ms',
      'Oct 30, 1:35–1:55 PM UTC: no data',
    ])
  })

  it('every missing period is accounted for: the ranges cover exactly the periods with no point', () => {
    const present = [0, 5, 30, 55]
    const missing = Array.from({ length: 12 }, (_, i) => i * 5).filter((m) => !present.includes(m))
    const d = chartData(pts(...present.map((m) => [m, 100] as [number, number])), START, END, 5 * MIN)
    const covered = d.filter((x) => x.ms === null).flatMap((x) => {
      const out: number[] = []
      for (let t = x.t; t <= (x.until ?? x.t); t += 5 * MIN) out.push((t - START) / MIN)
      return out
    })
    expect(covered).toEqual(missing)
  })

  it('a range across AM/PM or midnight names both ends in full', () => {
    expect(periodRangeLabel(Date.parse('2026-10-30T11:50:00Z'), Date.parse('2026-10-30T12:10:00Z'))).toBe('Oct 30, 11:50 AM–12:10 PM UTC')
    expect(periodRangeLabel(Date.parse('2026-10-30T20:00:00Z'), Date.parse('2026-10-31T04:00:00Z'))).toBe('Oct 30, 8:00 PM UTC – Oct 31, 4:00 AM UTC')
  })

  it('the chart line still gets one null per run (the drawing is unchanged)', () => {
    const d = chartData(pts([0, 100], [5, 120], [30, 150], [55, 160]), START, END, 5 * MIN)
    expect(d.map((x) => x.ms)).toEqual([100, 120, null, 150, null, 160])
  })
})

describe('responseTimeView', () => {
  it('ok: name, value as the row shows it, caption exactly per Board D, data with the gap, the queried window', () => {
    const v = responseTimeView(okSource(block()))!
    expect(v.name).toBe('example-alb')
    expect(v.valueText).toBe('1,234 ms')
    expect(v.caption).toBe('From example-alb · 1h · Average, as CloudWatch reports it')
    expect(v.domain).toEqual([START, END])
    expect(v.data.map((d) => d.ms)).toEqual([100, 120, null, 150, null])
    expect(v.multiDay).toBe(false)
  })

  it('the screen-reader summary reads a gap as "no data", never 0 ms', () => {
    const v = responseTimeView(okSource(block()))!
    expect(v.summary.map((s) => s.text)).toEqual([
      'Oct 30, 1:00 PM UTC: 100 ms',
      'Oct 30, 1:05 PM UTC: 120 ms',
      'Oct 30, 1:10 PM UTC: no data',
      'Oct 30, 1:15 PM UTC: 150 ms',
      'Oct 30, 1:20–1:55 PM UTC: no data',
    ])
    expect(v.summary.some((s) => s.text.endsWith(' 0 ms'))).toBe(false)
  })

  it.each([
    ['loading', { state: 'loading' } as Source<ResourcesData>],
    ['request failed', { state: 'error', kind: 'failed' } as Source<ResourcesData>],
    ['not connected', { state: 'ok', data: { status: 'not_connected', region: null, account_count: 0 } } as Source<ResourcesData>],
    ['block absent', okSource(undefined)],
    ['none', okSource(block({ state: 'none', charted: null, eligible_count: 0 }))],
    ['no_data', okSource(block({ state: 'no_data', charted: null }))],
    ['failed', okSource(block({ state: 'failed', charted: null, collection: 'partial', checked_at: null }))],
    ['ok without points', okSource(block({ charted: { resource_id: 'a', name: 'a', value_ms: 1, points: [] } }))],
    ['another range than the answer', okSource(block({ range: '24h' }), '1h')],
    ['unreadable window', okSource(block({ window_start: 'not-a-date' }))],
  ])('%s → no chart (never an empty one)', (_name, source) => {
    expect(responseTimeView(source)).toBeNull()
  })

  it('7d labels ticks by day; the caption follows the selected range', () => {
    const week = block({ range: '7d', window_start: new Date(END - 7 * 24 * 60 * MIN).toISOString(), period_seconds: 14400, charted: { resource_id: 'a', name: 'busy-alb', value_ms: 90, points: [{ t: new Date(END - 4 * 60 * MIN).toISOString(), ms: 90 }] } })
    const v = responseTimeView(okSource(week, '7d'))!
    expect(v.multiDay).toBe(true)
    expect(v.caption).toBe('From busy-alb · 7d · Average, as CloudWatch reports it')
  })
})

// ------------------------------------------------------------------ "5xx X% of N requests"

const m = (label: string, value: number, over: Partial<ObservabilityMetric> = {}): ObservabilityMetric => ({ label, value, statistic: 'Sum', window: '1h', ...over })
const latency = m('Avg latency', 123, { unit: 'ms', statistic: 'Average' })
const lbRow = (metrics: ObservabilityMetric[], over: Partial<ObservabilityRow> = {}): ObservabilityRow => ({
  resource_id: 'example-alb',
  resource_type: 'load-balancer',
  name: 'example-alb',
  region: 'us-east-1',
  check_status: 'passing',
  unknown_reason: null,
  telemetry: 'reporting',
  activity: 'active',
  status_detail: null,
  last_seen: null,
  last_seen_source: null,
  metrics,
  ...over,
})

describe('the load balancer key metric', () => {
  it('judged rate + Requests → "5xx X% of N requests (over 1h)" · response', () => {
    const row = lbRow([latency, m('5xx errors', 30), m('5xx rate', 0.33, { unit: '%' }), m('Requests', 9000)])
    expect(keyMetricText(row)).toBe('5xx 0.33% of 9,000 requests (over 1h) · Response 123 ms (1h average)')
  })

  it('numerator is target + ELB 5xx as sent (5xx errors), denominator the Requests sum, not Requests/min', () => {
    const row = lbRow([latency, m('Requests/min', 150), m('5xx errors', 30), m('5xx rate', 0.33, { unit: '%' }), m('Requests', 9000)])
    expect(lbFiveXxText(row)).toBe('5xx 0.33% of 9,000 requests (over 1h)')
  })

  it('no Requests (failed or not sent) → exactly the O2 text, never "of — requests" and never "of 0"', () => {
    const row = lbRow([latency, m('5xx errors', 2), m('5xx rate', 0.4, { unit: '%' })])
    expect(keyMetricText(row)).toBe('5xx 0.4% (over 1h) · Response 123 ms (1h average)')
    expect(lbFiveXxText(row)).toBeNull()
  })

  it('5xx greater than N → counts, not a percentage (decision 4)', () => {
    const row = lbRow([m('5xx errors', 150), m('5xx rate', 3000, { unit: '%' }), m('Requests', 5)], { check_status: 'failing' })
    expect(keyMetricText(row)).toBe('150 5xx, 5 requests routed to targets (over 1h)')
  })

  it('5xx equal to N is still a percentage', () => {
    expect(lbFiveXxText(lbRow([m('5xx errors', 200), m('5xx rate', 100, { unit: '%' }), m('Requests', 200)], { check_status: 'failing' }))).toBe('5xx 100% of 200 requests (over 1h)')
  })

  it('zero requests, failing by count → "[n] 5xx, 0 requests routed to targets (over <range>)" (decision 6)', () => {
    const row = lbRow([latency, m('5xx errors', 150, { window: '24h' }), m('Requests', 0, { window: '24h' })], { check_status: 'failing' })
    expect(keyMetricText(row)).toBe('150 5xx, 0 requests routed to targets (over 24h) · Response 123 ms (1h average)')
  })

  it('zero requests but not judged (not enough traffic / no activity) → no 5xx part', () => {
    const notEnough = lbRow([m('5xx errors', 5), m('Requests', 0)], { check_status: 'unknown', unknown_reason: 'not_enough_traffic' })
    expect(lbFiveXxText(notEnough)).toBeNull()
    expect(keyMetricText(notEnough)).toBeNull()
    const idle = lbRow([m('5xx errors', 0), m('Requests', 0)], { check_status: 'unknown', unknown_reason: 'no_activity' })
    expect(keyMetricText(idle)).toBeNull()
  })

  it('one request reads "1 request"', () => {
    expect(lbFiveXxText(lbRow([m('5xx errors', 100), m('5xx rate', 10000, { unit: '%' }), m('Requests', 1)], { check_status: 'failing' }))).toBe('100 5xx, 1 request routed to targets (over 1h)')
  })

  it('other types are unchanged (CloudFront 5xx rate keeps its own text)', () => {
    const cdn = lbRow([m('5xx rate', 0.1, { unit: '%', statistic: 'Average' }), m('Requests', 10)], { resource_type: 'cloudfront' })
    expect(keyMetricText(cdn)).toBe('5xx 0.1% (1h average)')
  })
})
