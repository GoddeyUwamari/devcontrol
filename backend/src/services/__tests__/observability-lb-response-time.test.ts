/**
 * O3b: the load balancer response-time block and the table's request total
 * (observability-lb-response-time.ts). Pure, no AWS and no database. Placeholders only.
 */
import { buildLbResponseTime, failedLbResponseTime, isChartEligible, LbRowInput, requestsTableMetric, requestTotal } from '../observability-lb-response-time'
import type { ObservabilityRow, ResourceEvidence } from '../observability-states'
import type { BatchSeriesResult, QueryOutcome } from '../cloudwatch-metric-batch.util'

const SWEEP_AT = new Date('2026-10-30T14:00:00.000Z')
const WINDOW = { range: '1h', windowStart: new Date('2026-10-30T13:00:00.000Z'), windowEnd: SWEEP_AT, periodSeconds: 300, sweepAt: SWEEP_AT }

function row(name: string, over: Partial<ObservabilityRow> = {}, avgMs: number | null = 120): ObservabilityRow {
  return {
    resource_id: name,
    resource_type: 'load-balancer',
    name,
    region: 'us-east-1',
    check_status: 'passing',
    unknown_reason: null,
    telemetry: 'reporting',
    activity: 'active',
    status_detail: null,
    last_seen: null,
    last_seen_source: null,
    metrics: avgMs === null ? [] : [{ label: 'Avg latency', value: avgMs, unit: 'ms', statistic: 'Average', window: '1h' }],
    ...over,
  }
}

type Q = Partial<Record<'latencySec' | 'requestSum' | 'errorSum' | 'elb5xxSum', QueryOutcome>>

function ev(queries: Q, requestSum: number | null = null): ResourceEvidence {
  // The current-window queries the sweep records for an ALB (cloudWatchEvidence skips the previous window).
  const full: Record<string, QueryOutcome> = { latencySec: 'complete', requestSum: 'complete', errorSum: 'empty', elb5xxSum: 'empty', ...queries }
  return { kind: 'cloudwatch', queries: full, values: { requestSum }, newestDatapointAt: null }
}

const at = (iso: string) => new Date(iso)
const series = (pairs: Array<[string, number]>): BatchSeriesResult => ({ timestamps: pairs.map(([t]) => at(t)), values: pairs.map(([, v]) => v) })
const SERIES = series([
  ['2026-10-30T13:10:00.000Z', 0.13],
  ['2026-10-30T13:00:00.000Z', 0.1],
])

interface Lb {
  name: string | null
  id: string
  row?: Partial<ObservabilityRow>
  avgMs?: number | null
  evidence?: ResourceEvidence | undefined
  series?: BatchSeriesResult | null
}

function build(lbs: Lb[]) {
  const rows: LbRowInput[] = lbs.map((l) => ({ row: row(l.name ?? l.id, l.row, l.avgMs === undefined ? 120 : l.avgMs), sortName: l.name, dbId: l.id }))
  const evidence = new Map<string, ResourceEvidence>()
  const latencySeries = new Map<string, BatchSeriesResult | null>()
  for (const l of lbs) {
    if (l.evidence) evidence.set(l.id, l.evidence)
    latencySeries.set(l.id, l.series === undefined ? SERIES : l.series)
  }
  return buildLbResponseTime({ ...WINDOW, rows, evidence, latencySeries })
}

describe('series states', () => {
  it('complete latency → ok; points as returned, ascending, rounded ms; value is the row\'s Avg latency', () => {
    const block = build([{ name: 'example-alb', id: 'a', evidence: ev({}, 500) }])
    expect(block.state).toBe('ok')
    expect(block.charted).toEqual({
      resource_id: 'example-alb',
      name: 'example-alb',
      value_ms: 120,
      points: [
        { t: '2026-10-30T13:00:00.000Z', ms: 100 },
        { t: '2026-10-30T13:10:00.000Z', ms: 130 },
      ],
    })
  })

  it('a gap stays a gap: the missing 13:05 slot is not sent, never filled with 0', () => {
    const block = build([{ name: 'example-alb', id: 'a', evidence: ev({}, 500) }])
    expect(block.charted!.points.map((p) => p.t)).toEqual(['2026-10-30T13:00:00.000Z', '2026-10-30T13:10:00.000Z'])
    expect(block.charted!.points.some((p) => p.ms === 0)).toBe(false)
  })

  it('completed empty latency → no_data, no chart, never 0 ms', () => {
    const block = build([{ name: 'example-alb', id: 'a', avgMs: null, evidence: ev({ latencySec: 'empty' }, 0), series: null }])
    expect(block.state).toBe('no_data')
    expect(block.charted).toBeNull()
  })

  it.each(['access_denied', 'throttled', 'query_failed'] as const)('latency %s → failed, no chart', (outcome) => {
    const block = build([{ name: 'example-alb', id: 'a', evidence: ev({ latencySec: outcome }, 500) }])
    expect(block.state).toBe('failed')
    expect(block.charted).toBeNull()
    expect(block.collection).toBe('partial')
    expect(block.checked_at).toBeNull()
  })

  it('a partial series (PartialData → query_failed, values still stored) is never charted', () => {
    const block = build([{ name: 'example-alb', id: 'a', evidence: ev({ latencySec: 'query_failed' }, 500), series: SERIES }])
    expect(block.charted).toBeNull()
    expect(block.state).toBe('failed')
  })

  it('no evidence at all (the type block failed) → failed, partial', () => {
    const block = build([{ name: 'example-alb', id: 'a', row: { check_status: 'unknown', unknown_reason: 'query_failed' }, avgMs: null, evidence: undefined, series: null }])
    expect(block).toMatchObject({ state: 'failed', eligible_count: 1, collection: 'partial', checked_at: null, charted: null })
  })

  it('no eligible load balancer → none', () => {
    expect(build([])).toMatchObject({ state: 'none', eligible_count: 0, charted: null, collection: 'complete' })
  })
})

describe('eligibility', () => {
  it('NLB/GWLB (not_measured), out of scope and not_supported rows are never counted or charted', () => {
    const block = build([
      { name: 'nlb', id: 'n', row: { check_status: 'not_measured', telemetry: 'unknown', activity: null }, avgMs: null, evidence: undefined, series: null },
      { name: 'eu-alb', id: 'r', row: { check_status: 'unknown', unknown_reason: 'outside_region' }, evidence: ev({}, 9000) },
      { name: 'other-alb', id: 'o', row: { check_status: 'unknown', unknown_reason: 'outside_account' }, evidence: ev({}, 9000) },
      { name: 'odd-arn', id: 's', row: { check_status: 'unknown', unknown_reason: 'not_supported' }, evidence: undefined, series: null },
      { name: 'example-alb', id: 'a', evidence: ev({}, 5) },
    ])
    expect(block.eligible_count).toBe(1)
    expect(block.charted!.name).toBe('example-alb')
    expect(block.collection).toBe('complete')
  })

  it('only NLBs → none (never a chart, never healthy)', () => {
    const block = build([{ name: 'nlb', id: 'n', row: { check_status: 'not_measured' }, avgMs: null, evidence: undefined, series: null }])
    expect(block).toMatchObject({ state: 'none', eligible_count: 0, charted: null })
  })

  it('isChartEligible: other resource types never qualify', () => {
    expect(isChartEligible(row('web', { resource_type: 'ec2' }))).toBe(false)
    expect(isChartEligible(row('alb'))).toBe(true)
  })
})

describe('selection order (decision 8)', () => {
  it('most requests first', () => {
    const block = build([
      { name: 'a-alb', id: '1', evidence: ev({}, 5) },
      { name: 'b-alb', id: '2', evidence: ev({}, 9) },
      { name: 'c-alb', id: '3', evidence: ev({}, 7) },
    ])
    expect(block.charted!.name).toBe('b-alb')
    expect(block.eligible_count).toBe(3)
    expect(block.selection_complete).toBe(true)
  })

  it('a completed-empty RequestCount is 0 requests; a failed one ranks after it, never as 0', () => {
    const block = build([
      { name: 'a-failed', id: '1', evidence: ev({ requestSum: 'throttled' }) },
      { name: 'b-zero', id: '2', evidence: ev({ requestSum: 'empty' }) },
    ])
    expect(block.charted!.name).toBe('b-zero')
    expect(block.selection_complete).toBe(false)
    expect(block.collection).toBe('partial')
    expect(block.checked_at).toBeNull()
  })

  it('response-time data first: the busiest ALB without a chartable series is skipped', () => {
    const block = build([
      { name: 'busy', id: '1', evidence: ev({ latencySec: 'query_failed' }, 100000) },
      { name: 'quiet', id: '2', evidence: ev({}, 10) },
    ])
    expect(block.state).toBe('ok')
    expect(block.charted!.name).toBe('quiet')
    expect(block.collection).toBe('partial')
  })

  it('ties: name A–Z case-insensitively, null names last, then id', () => {
    const block = (lbs: Lb[]) => build(lbs).charted!.resource_id
    expect(block([{ name: 'Zeta', id: '1', evidence: ev({}, 5) }, { name: 'alpha', id: '2', evidence: ev({}, 5) }])).toBe('alpha')
    expect(block([{ name: null, id: '1', evidence: ev({}, 5) }, { name: 'zz', id: '2', evidence: ev({}, 5) }])).toBe('zz')
    expect(block([{ name: 'same', id: 'b', row: { resource_id: 'second' }, evidence: ev({}, 5) }, { name: 'same', id: 'a', row: { resource_id: 'first' }, evidence: ev({}, 5) }])).toBe('first')
  })

  it('the same input in any order gives the same choice', () => {
    const lbs: Lb[] = [
      { name: 'a', id: '1', evidence: ev({}, 3) },
      { name: 'b', id: '2', evidence: ev({}, 8) },
      { name: 'c', id: '3', evidence: ev({}, 8) },
      { name: 'd', id: '4', evidence: ev({ requestSum: 'access_denied' }) },
    ]
    const picks = [lbs, [...lbs].reverse(), [lbs[2], lbs[0], lbs[3], lbs[1]]].map((l) => build(l).charted!.name)
    expect(new Set(picks)).toEqual(new Set(['b']))
  })
})

describe('cap, collection and checked_at', () => {
  it('20 eligible → one charted, eligible_count 20 (never presented as the whole account)', () => {
    const lbs: Lb[] = Array.from({ length: 20 }, (_, i) => ({ name: `alb-${String(i).padStart(2, '0')}`, id: String(i), evidence: ev({}, i * 10) }))
    const block = build(lbs)
    expect(block.eligible_count).toBe(20)
    expect(block.charted!.name).toBe('alb-19')
  })

  it('every eligible query completed → checked_at is the sweep time', () => {
    const block = build([{ name: 'a', id: '1', evidence: ev({}, 3) }, { name: 'b', id: '2', evidence: ev({ latencySec: 'empty' }, 0), avgMs: null, series: null }])
    expect(block.collection).toBe('complete')
    expect(block.checked_at).toBe(SWEEP_AT.toISOString())
  })

  it.each(['errorSum', 'elb5xxSum'] as const)('a failed %s on another ALB → partial, no checked_at (the chart still shows)', (key) => {
    const block = build([{ name: 'a', id: '1', evidence: ev({}, 3) }, { name: 'b', id: '2', evidence: ev({ [key]: 'query_failed' }, 1) }])
    expect(block.state).toBe('ok')
    expect(block.collection).toBe('partial')
    expect(block.checked_at).toBeNull()
  })

  it('the window is the one passed in, never recomputed', () => {
    expect(build([{ name: 'a', id: '1', evidence: ev({}, 3) }])).toMatchObject({
      range: '1h',
      window_start: '2026-10-30T13:00:00.000Z',
      window_end: '2026-10-30T14:00:00.000Z',
      period_seconds: 300,
      statistic: 'Average',
      unit: 'ms',
    })
  })

  it('failedLbResponseTime: failed, no counts, no chart, no checked_at', () => {
    expect(failedLbResponseTime(WINDOW)).toEqual({
      range: '1h',
      window_start: '2026-10-30T13:00:00.000Z',
      window_end: '2026-10-30T14:00:00.000Z',
      period_seconds: 300,
      statistic: 'Average',
      unit: 'ms',
      eligible_count: null,
      selection_complete: false,
      collection: 'partial',
      checked_at: null,
      state: 'failed',
      charted: null,
    })
  })
})

describe('request total for the table (decision 5b)', () => {
  it('completed → the sum; completed empty → 0; failed → nothing', () => {
    expect(requestTotal(ev({}, 12000))).toBe(12000)
    expect(requestTotal(ev({ requestSum: 'empty' }))).toBe(0)
    for (const outcome of ['access_denied', 'throttled', 'query_failed'] as const) expect(requestTotal(ev({ requestSum: outcome }, 5))).toBeNull()
    expect(requestTotal(undefined)).toBeNull()
  })

  it('requestsTableMetric: Requests (Sum, range) for an in-scope ALB with a completed count only', () => {
    expect(requestsTableMetric(row('a'), ev({}, 12000), '1h')).toEqual([{ label: 'Requests', value: 12000, statistic: 'Sum', window: '1h' }])
    expect(requestsTableMetric(row('a'), ev({ requestSum: 'empty' }), '24h')).toEqual([{ label: 'Requests', value: 0, statistic: 'Sum', window: '24h' }])
    expect(requestsTableMetric(row('a'), ev({ requestSum: 'query_failed' }, 5), '1h')).toEqual([])
    expect(requestsTableMetric(row('a', { check_status: 'not_measured' }), ev({}, 5), '1h')).toEqual([])
    expect(requestsTableMetric(row('a', { unknown_reason: 'outside_region', check_status: 'unknown' }), ev({}, 5), '1h')).toEqual([])
    expect(requestsTableMetric(row('a'), undefined, '1h')).toEqual([])
  })
})
