/**
 * OB3: the observability states for the new checks -- RDS instances (status from
 * discovery; CPU, connections, free storage), Lambda throttles, and the load balancer
 * 5xx rate -- with every threshold tested on both sides of its boundary. Founder
 * decisions R1-R5, T1, L1, L2 (ob3-step1.md). Pure: no AWS, no database. Placeholders only.
 */
import { EvaluatedRowView, InventoryView, ResourceEvidence, RowContext, observabilityRowFor, queryFailed, typeSummaryOf } from '../observability-states'

const ACCOUNT = '123456789012'
const T1 = new Date('2026-10-29T09:55:00.000Z')
const GIB = 1024 ** 3

const ctx = (over: Partial<RowContext> = {}): RowContext => ({
  accountId: ACCOUNT,
  region: 'us-east-1',
  rangeLabel: '1h',
  sweepAt: new Date('2026-10-29T10:00:00.000Z'),
  blockFailed: false,
  stored: undefined,
  ...over,
})

const row = (status: EvaluatedRowView['status'], over: Partial<EvaluatedRowView> = {}): EvaluatedRowView => ({ status, responseTimeMs: null, metrics: [], ...over })

/** Evidence whose outcomes follow the values: a number is complete, null is empty, unless an outcome is given. */
const cw = (values: Record<string, number | null>, outcomes: ResourceEvidence['queries'] = {}, over: Partial<ResourceEvidence> = {}): ResourceEvidence => {
  const queries: ResourceEvidence['queries'] = {}
  for (const [key, value] of Object.entries(values)) queries[key] = outcomes[key] ?? (value === null ? 'empty' : 'complete')
  return { kind: 'cloudwatch', queries, values, newestDatapointAt: Object.values(queries).includes('complete') ? T1 : null, ...over }
}

// ── RDS ────────────────────────────────────────────────────────────────────

const rds = (over: Partial<InventoryView> = {}): InventoryView => ({
  id: '00000000-0000-4000-8000-000000000011',
  resource_id: 'example-db',
  resource_name: 'example-db',
  resource_type: 'rds',
  resource_arn: `arn:aws:rds:us-east-1:${ACCOUNT}:db:example-db`,
  region: 'us-east-1',
  status: 'available',
  metadata: { engine: 'postgres', allocated_storage: 100 },
  ...over,
})

const rdsValues = (over: Record<string, number | null> = {}) => ({ cpu: 20, connections: 4, connectionsMax: 9, freeStorageMin: 50 * GIB, ...over })
const rdsRow = (over: Partial<InventoryView> = {}, values: Record<string, number | null> = rdsValues(), outcomes: ResourceEvidence['queries'] = {}) =>
  observabilityRowFor(rds(over), row(over.status === 'stopped' ? 'down' : 'healthy'), cw(values, outcomes), ctx())

describe('OB3 RDS instance', () => {
  it('(R1) available, every core metric reporting, storage and CPU fine: passing, with labelled metrics', () => {
    const r = rdsRow()
    expect(r).toMatchObject({ check_status: 'passing', unknown_reason: null, telemetry: 'reporting', activity: null, status_detail: null, last_seen: T1.toISOString() })
    expect(r.metrics).toEqual([
      { label: 'CPU', value: 20, unit: '%', statistic: 'Average', window: '1h' },
      { label: 'Connections', value: 4, statistic: 'Average', window: '1h' },
      { label: 'Connections (max)', value: 9, statistic: 'Maximum', window: '1h' },
      { label: 'Free storage', value: 50, unit: 'GiB', statistic: 'Minimum', window: '1h' },
      { label: 'Free storage', value: 50, unit: '% of allocated', statistic: 'Minimum', window: '1h' },
    ])
  })

  it('(R5 boundary) free storage below 10% of allocated needs attention; exactly 10% and above passes', () => {
    expect(rdsRow({}, rdsValues({ freeStorageMin: 10 * GIB - 1 })).check_status).toBe('needs_attention')
    expect(rdsRow({}, rdsValues({ freeStorageMin: 9.99 * GIB })).check_status).toBe('needs_attention')
    expect(rdsRow({}, rdsValues({ freeStorageMin: 10 * GIB })).check_status).toBe('passing')
    expect(rdsRow({}, rdsValues({ freeStorageMin: 10.01 * GIB })).check_status).toBe('passing')
    // Against allocated storage, not a fixed size: 10 GiB free of 50 GiB is 20%.
    expect(rdsRow({ metadata: { engine: 'mysql', allocated_storage: 50 } }, rdsValues({ freeStorageMin: 10 * GIB })).check_status).toBe('passing')
  })

  it('(R2 boundary) average CPU at or above 80% needs attention (never failing); just below passes', () => {
    expect(rdsRow({}, rdsValues({ cpu: 79.99 })).check_status).toBe('passing')
    expect(rdsRow({}, rdsValues({ cpu: 80 })).check_status).toBe('needs_attention')
    expect(rdsRow({}, rdsValues({ cpu: 100 })).check_status).toBe('needs_attention')
  })

  it('(R4) stopped and stopping are stopped, whatever the metrics', () => {
    for (const status of ['stopped', 'stopping']) {
      const r = rdsRow({ status }, { cpu: null, connections: null, connectionsMax: null, freeStorageMin: null })
      expect(r).toMatchObject({ check_status: 'stopped', unknown_reason: null, telemetry: 'no_telemetry' })
    }
  })

  it('(R1) failure states are failing, with the status name', () => {
    for (const status of ['failed', 'storage-full', 'restore-error', 'incompatible-parameters', 'incompatible-network', 'inaccessible-encryption-credentials', 'inaccessible-encryption-credentials-recoverable']) {
      expect(rdsRow({ status })).toMatchObject({ check_status: 'failing', unknown_reason: null, status_detail: status })
    }
  })

  it('(Oct 29 decision) a stopped or failing status from discovery stands when a metric query failed, returned nothing, or the block failed', () => {
    const none = { cpu: null, connections: null, connectionsMax: null, freeStorageMin: null }
    expect(rdsRow({ status: 'storage-full' }, rdsValues({ cpu: null }), { cpu: 'access_denied' })).toMatchObject({ check_status: 'failing', unknown_reason: null, status_detail: 'storage-full', telemetry: 'unknown' })
    expect(rdsRow({ status: 'failed' }, none, { cpu: 'throttled', connections: 'throttled', connectionsMax: 'throttled', freeStorageMin: 'throttled' })).toMatchObject({ check_status: 'failing', status_detail: 'failed' })
    expect(rdsRow({ status: 'incompatible-parameters' }, none)).toMatchObject({ check_status: 'failing', telemetry: 'no_telemetry' })
    expect(rdsRow({ status: 'stopped' }, rdsValues({ freeStorageMin: null }), { freeStorageMin: 'query_failed' })).toMatchObject({ check_status: 'stopped', unknown_reason: null })
    expect(observabilityRowFor(rds({ status: 'stopping' }), undefined, undefined, ctx({ blockFailed: true }))).toMatchObject({ check_status: 'stopped', telemetry: 'unknown' })
    expect(observabilityRowFor(rds({ status: 'restore-error' }), undefined, undefined, ctx({ blockFailed: true }))).toMatchObject({ check_status: 'failing', status_detail: 'restore-error' })
    // Still a failed collection: the query did not complete.
    expect(queryFailed(cw(rdsValues({ cpu: null }), { cpu: 'access_denied' }), { blockFailed: false })).toBe(true)
    // Metrics still decide a serving instance: a failed query there is unknown with its reason.
    expect(rdsRow({ status: 'available' }, rdsValues({ cpu: null }), { cpu: 'access_denied' })).toMatchObject({ check_status: 'unknown', unknown_reason: 'access_denied' })
  })

  it('(R1) the known transitional states need attention, with the status name', () => {
    for (const status of ['modifying', 'rebooting', 'backing-up', 'upgrading', 'maintenance', 'configuring-enhanced-monitoring', 'starting']) {
      expect(rdsRow({ status })).toMatchObject({ check_status: 'needs_attention', unknown_reason: null, status_detail: status })
    }
  })

  it('(R1) an unrecognised status is unknown, never judged by metrics', () => {
    for (const status of ['creating', 'insufficient-capacity', 'some-future-state', 'unknown']) {
      expect(rdsRow({ status })).toMatchObject({ check_status: 'unknown', unknown_reason: 'not_supported', status_detail: status })
    }
  })

  it('(R1 amendment) storage-optimization is judged by its metrics like available, with the status name', () => {
    const status = 'storage-optimization'
    expect(rdsRow({ status })).toMatchObject({ check_status: 'passing', unknown_reason: null, status_detail: status })
    expect(rdsRow({ status }, rdsValues({ freeStorageMin: 9.99 * GIB }))).toMatchObject({ check_status: 'needs_attention', status_detail: status })
    expect(rdsRow({ status }, rdsValues({ cpu: 80 }))).toMatchObject({ check_status: 'needs_attention', status_detail: status })
    expect(rdsRow({ status }, rdsValues({ cpu: null }))).toMatchObject({ check_status: 'unknown', unknown_reason: 'no_telemetry', status_detail: status })
    // available itself carries no status_detail.
    expect(rdsRow().status_detail).toBeNull()
  })

  it('(R3) any core metric with no data is unknown/no_telemetry, never passing', () => {
    for (const key of ['cpu', 'connections', 'connectionsMax', 'freeStorageMin']) {
      expect(rdsRow({}, rdsValues({ [key]: null }))).toMatchObject({ check_status: 'unknown', unknown_reason: 'no_telemetry', telemetry: 'reporting' })
    }
    const none = rdsRow({}, { cpu: null, connections: null, connectionsMax: null, freeStorageMin: null })
    expect(none).toMatchObject({ check_status: 'unknown', unknown_reason: 'no_telemetry', telemetry: 'no_telemetry' })
    expect(none.metrics).toEqual([])
  })

  it('a failed core query is unknown with its reason, never no_telemetry and never passing', () => {
    expect(rdsRow({}, rdsValues({ freeStorageMin: null }), { freeStorageMin: 'access_denied' })).toMatchObject({ check_status: 'unknown', unknown_reason: 'access_denied', telemetry: 'unknown' })
    expect(rdsRow({}, rdsValues({ cpu: null }), { cpu: 'throttled' })).toMatchObject({ check_status: 'unknown', unknown_reason: 'throttled' })
    expect(rdsRow({}, rdsValues({ connections: null }), { connections: 'query_failed' })).toMatchObject({ check_status: 'unknown', unknown_reason: 'query_failed' })
  })

  it('missing allocated storage is unknown/not_supported: free space alone is never judged', () => {
    expect(rdsRow({ metadata: { engine: 'postgres' } })).toMatchObject({ check_status: 'unknown', unknown_reason: 'not_supported' })
    expect(rdsRow({ metadata: { engine: 'postgres' } }).metrics.map((m) => m.unit)).not.toContain('% of allocated')
  })

  it('(R4) an Aurora member instance is not_measured and has no metrics', () => {
    const r = observabilityRowFor(rds({ metadata: { engine: 'aurora-postgresql', allocated_storage: 1 } }), row('healthy'), undefined, ctx())
    expect(r).toMatchObject({ check_status: 'not_measured', unknown_reason: null, telemetry: 'unknown', metrics: [] })
  })
})

// ── Lambda throttles ───────────────────────────────────────────────────────

const fn = (over: Partial<InventoryView> = {}): InventoryView => ({
  id: '00000000-0000-4000-8000-000000000012',
  resource_id: 'example-fn',
  resource_name: 'example-fn',
  resource_type: 'lambda',
  resource_arn: `arn:aws:lambda:us-east-1:${ACCOUNT}:function:example-fn`,
  region: 'us-east-1',
  status: 'Active',
  metadata: null,
  ...over,
})
const lambdaRow = (values: Record<string, number | null>, outcomes: ResourceEvidence['queries'] = {}, status: EvaluatedRowView['status'] = 'healthy', inv: Partial<InventoryView> = {}) =>
  observabilityRowFor(fn(inv), row(status), cw(values, outcomes, { activity: { key: 'invocations', value: values.invocations ?? null } }), ctx())

describe('OB3 Lambda throttles', () => {
  it('(F1) no throttles (a completed query with no datapoints) changes nothing; shown as 0, Sum over the range', () => {
    const r = lambdaRow({ invocations: 100, errors: 1, duration: 20, throttles: null })
    expect(r.check_status).toBe('passing')
    expect(r.metrics).toContainEqual({ label: 'Throttles', value: 0, statistic: 'Sum', window: '1h' })
  })

  it('(T1) any throttling needs attention; one throttle is enough', () => {
    expect(lambdaRow({ invocations: 100, errors: 0, duration: 20, throttles: 1 }).check_status).toBe('needs_attention')
    expect(lambdaRow({ invocations: 100, errors: 0, duration: 20, throttles: 3 }).metrics).toContainEqual({ label: 'Throttles', value: 3, statistic: 'Sum', window: '1h' })
  })

  it('(T1) throttling is checked before idle: a fully throttled function is needs_attention, not no_activity', () => {
    const r = lambdaRow({ invocations: null, errors: null, duration: null, throttles: 5 }, {}, 'unknown')
    expect(r).toMatchObject({ check_status: 'needs_attention', unknown_reason: null, activity: 'no_activity' })
    expect(lambdaRow({ invocations: null, errors: null, duration: null, throttles: 5 }, {}, 'down', { status: 'Inactive' }).check_status).toBe('needs_attention')
  })

  it('a real failure stays failing; a failed throttles query is unknown with its reason, never 0', () => {
    expect(lambdaRow({ invocations: 10, errors: 0, duration: 5, throttles: 4 }, {}, 'down', { status: 'Failed' }).check_status).toBe('failing')
    const denied = lambdaRow({ invocations: 100, errors: 0, duration: 20, throttles: null }, { throttles: 'access_denied' })
    expect(denied).toMatchObject({ check_status: 'unknown', unknown_reason: 'access_denied' })
    expect(denied.metrics.map((m) => m.label)).not.toContain('Throttles')
  })

  it('(D3 kept) idle with no throttles is still unknown/no_activity', () => {
    expect(lambdaRow({ invocations: null, errors: null, duration: null, throttles: null }, {}, 'unknown')).toMatchObject({ check_status: 'unknown', unknown_reason: 'no_activity' })
  })
})

// ── Load balancer 5xx ──────────────────────────────────────────────────────

const alb: InventoryView = {
  id: '00000000-0000-4000-8000-000000000013',
  resource_id: 'example-alb',
  resource_name: 'example-alb',
  resource_type: 'load-balancer',
  resource_arn: `arn:aws:elasticloadbalancing:us-east-1:${ACCOUNT}:loadbalancer/app/example-alb/0123456789abcdef`,
  region: 'us-east-1',
  status: 'active',
  metadata: { type: 'application' },
}
/** requests / ELB 5xx / target 5xx; latency 200 ms (healthy) unless the legacy status says otherwise. */
const lb = (requests: number | null, elb: number | null, target: number | null, legacy: EvaluatedRowView['status'] = 'healthy', outcomes: ResourceEvidence['queries'] = {}) =>
  observabilityRowFor(
    alb,
    row(legacy, { responseTimeMs: legacy === 'unknown' ? null : legacy === 'degraded' ? 740 : 200 }),
    cw({ latencySec: legacy === 'unknown' ? null : legacy === 'degraded' ? 0.74 : 0.2, requestSum: requests, errorSum: target, elb5xxSum: elb }, outcomes, {
      activity: { key: 'requestSum', value: requests },
    }),
    ctx()
  )
const verdict = (r: ReturnType<typeof lb>) => [r.check_status, r.unknown_reason]

describe('OB3 load balancer 5xx', () => {
  it('(B1) fewer than 100 requests (and fewer than 100 5xx): not_enough_traffic, no rate judged or shown', () => {
    const r = lb(99, 0, 50)
    expect(verdict(r)).toEqual(['unknown', 'not_enough_traffic'])
    expect(r.activity).toBe('active')
    expect(r.metrics.map((m) => m.label)).not.toContain('5xx rate')
    expect(r.metrics).toContainEqual({ label: '5xx errors', value: 50, statistic: 'Sum', window: '1h' })
  })

  it('(B2) exactly 100 requests is judged: 1 5xx is 1.00%, passing', () => {
    const r = lb(100, 0, 1)
    expect(verdict(r)).toEqual(['passing', null])
    expect(r.metrics).toContainEqual({ label: '5xx rate', value: 1, unit: '%', statistic: 'Sum', window: '1h' })
  })

  it('(B3-B6) 1% and 5% boundaries: <=1% passing, >1% to 5% needs attention, >5% failing', () => {
    expect(verdict(lb(100, 1, 1))).toEqual(['needs_attention', null]) // 2%
    expect(verdict(lb(100, 0, 5))).toEqual(['needs_attention', null]) // 5.00%
    expect(verdict(lb(100, 3, 3))).toEqual(['failing', null]) // 6%, ELB + target both counted
    expect(verdict(lb(1000, 0, 10))).toEqual(['passing', null]) // 1.0%
    expect(verdict(lb(1000, 0, 11))).toEqual(['needs_attention', null]) // 1.1%
    expect(verdict(lb(1000, 0, 50))).toEqual(['needs_attention', null]) // 5.0%
    expect(verdict(lb(1000, 0, 51))).toEqual(['failing', null]) // 5.1%
    expect(verdict(lb(100000, 0, 1000))).toEqual(['passing', null]) // exactly 1% at volume
    expect(verdict(lb(100000, 0, 1001))).toEqual(['needs_attention', null])
  })

  it('(B7) 5xx the load balancer itself returned count: ELB-only 6% fails', () => {
    expect(verdict(lb(100, 6, 0))).toEqual(['failing', null])
    expect(lb(100, 6, 0).metrics).toContainEqual({ label: '5xx errors', value: 6, statistic: 'Sum', window: '1h' })
  })

  it('(L1) 100 or more 5xx are judged even with fewer than 100 requests; 99 are not', () => {
    const rejected = lb(5, 100, 0)
    expect(verdict(rejected)).toEqual(['failing', null])
    expect(rejected.activity).toBe('active')
    expect(rejected.metrics).toContainEqual({ label: '5xx rate', value: 2000, unit: '%', statistic: 'Sum', window: '1h' })
    expect(verdict(lb(5, 99, 0))).toEqual(['unknown', 'not_enough_traffic'])
    // Every request rejected before a target: RequestCount completed with nothing, no latency.
    const allRejected = lb(null, 150, null, 'unknown')
    expect(verdict(allRejected)).toEqual(['failing', null])
    expect(allRejected.metrics.map((m) => m.label)).not.toContain('5xx rate')
  })

  it('(D3 kept) no requests and no 5xx: unknown/no_activity', () => {
    expect(lb(null, null, null, 'unknown')).toMatchObject({ check_status: 'unknown', unknown_reason: 'no_activity', activity: 'no_activity' })
    expect(lb(0, null, null)).toMatchObject({ check_status: 'unknown', unknown_reason: 'no_activity', activity: 'no_activity' })
  })

  it('(L2) the worse of the 5xx and latency results', () => {
    expect(verdict(lb(1000, 0, 5, 'degraded'))).toEqual(['needs_attention', null]) // 0.5% 5xx, 740 ms
    expect(verdict(lb(100, 0, 6))).toEqual(['failing', null]) // 6% 5xx, 200 ms
    expect(verdict(lb(100, 0, 6, 'degraded'))).toEqual(['failing', null])
    expect(verdict(lb(1000, 0, 20, 'degraded'))).toEqual(['needs_attention', null])
    // Judgeable traffic but no latency datapoints: nothing to compare, never passing.
    expect(verdict(lb(1000, 0, 0, 'unknown'))).toEqual(['unknown', 'no_telemetry'])
  })

  it('(review fix 1) a 5xx problem stands when the latency query returned nothing or failed; a passing rate does not', () => {
    // 2% 5xx, latency completed empty -> needs_attention (was unknown/no_telemetry).
    expect(verdict(lb(1000, 0, 20, 'unknown'))).toEqual(['needs_attention', null])
    // 6% 5xx, latency denied / throttled -> failing.
    expect(verdict(lb(100, 0, 6, 'unknown', { latencySec: 'access_denied' }))).toEqual(['failing', null])
    expect(lb(100, 0, 6, 'unknown', { latencySec: 'throttled' })).toMatchObject({ check_status: 'failing', telemetry: 'unknown', activity: 'active' })
    expect(verdict(lb(1000, 0, 20, 'unknown', { latencySec: 'query_failed' }))).toEqual(['needs_attention', null])
    // Still a failed collection.
    expect(queryFailed(cw({ latencySec: null, requestSum: 100, errorSum: 6, elb5xxSum: null }, { latencySec: 'access_denied' }), { blockFailed: false })).toBe(true)
    // A passing rate can't outweigh missing latency: unknown with the latency's reason.
    expect(verdict(lb(1000, 0, 5, 'unknown', { latencySec: 'access_denied' }))).toEqual(['unknown', 'access_denied'])
    expect(verdict(lb(1000, 0, 5, 'unknown'))).toEqual(['unknown', 'no_telemetry'])
    // Not judged by the 5xx rule: latency failure decides.
    expect(verdict(lb(99, 0, 0, 'unknown', { latencySec: 'access_denied' }))).toEqual(['unknown', 'access_denied'])
  })

  it('(review fix 2) "5xx rate" is shown only when the row was judged on it', () => {
    const labels = (r: ReturnType<typeof lb>) => r.metrics.map((m) => m.label)
    expect(labels(lb(1000, 0, 5))).toContain('5xx rate') // passing, judged
    expect(labels(lb(1000, 0, 20, 'unknown'))).toContain('5xx rate') // needs_attention stands
    expect(labels(lb(100, 0, 6, 'unknown', { latencySec: 'access_denied' }))).toContain('5xx rate') // failing stands
    expect(labels(lb(1000, 0, 5, 'unknown', { latencySec: 'access_denied' }))).not.toContain('5xx rate') // row unknown
    expect(labels(lb(1000, 0, 5, 'unknown'))).not.toContain('5xx rate') // row unknown/no_telemetry
    expect(labels(lb(99, 0, 0))).not.toContain('5xx rate') // not_enough_traffic
    // The count is still shown whenever its two queries completed.
    expect(labels(lb(1000, 0, 5, 'unknown', { latencySec: 'access_denied' }))).toContain('5xx errors')
  })

  it('any of the three queries incomplete is unknown with its reason, never a rate', () => {
    for (const [key, outcome] of [
      ['elb5xxSum', 'access_denied'],
      ['requestSum', 'throttled'],
      ['errorSum', 'query_failed'],
    ] as const) {
      const r = lb(1000, 0, 0, 'healthy', { [key]: outcome })
      expect(verdict(r)).toEqual(['unknown', outcome])
      expect(r.metrics.map((m) => m.label)).not.toContain('5xx rate')
    }
    // A 5xx query with no recorded outcome measured nothing: query_failed, never "not enough traffic".
    const missing = observabilityRowFor(alb, row('healthy', { responseTimeMs: 200 }), cw({ latencySec: 0.2, requestSum: 1000, errorSum: null }), ctx())
    expect(verdict(missing)).toEqual(['unknown', 'query_failed'])
  })

  it('not_enough_traffic is counted in "other", never passing', () => {
    expect(typeSummaryOf([lb(99, 0, 0), lb(100, 0, 0)])).toEqual({ 'load-balancer': { count: 2, passing: 1, needs_attention: 0, failing: 0, other: 1 } })
  })
})
