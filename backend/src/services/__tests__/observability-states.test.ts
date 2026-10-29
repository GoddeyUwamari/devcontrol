/**
 * OB2: observabilityRowFor() / typeSummaryOf() -- every state of the
 * observability contract and its precedence, from a legacy evaluated row,
 * the inventory row and the evidence of how its queries ended. Pure: no AWS,
 * no database. Placeholders only.
 */
import {
  EvaluatedRowView,
  InventoryView,
  ResourceEvidence,
  RowContext,
  accountIdOfResourceArn,
  aggregateOutcome,
  checkCompleted,
  checkObserved,
  observabilityRowFor,
  typeSummaryOf,
} from '../observability-states'

const ACCOUNT = '123456789012'
const OTHER = '111122223333'
const SWEEP = new Date('2026-10-28T10:00:00.000Z')
const T1 = new Date('2026-10-28T09:55:00.000Z')
const T0 = new Date('2026-10-27T18:20:00.000Z')

const ctx = (over: Partial<RowContext> = {}): RowContext => ({
  accountId: ACCOUNT,
  region: 'us-east-1',
  rangeLabel: '1h',
  sweepAt: SWEEP,
  blockFailed: false,
  stored: undefined,
  ...over,
})

const inv = (type: string, over: Partial<InventoryView> = {}): InventoryView => ({
  id: '00000000-0000-4000-8000-000000000001',
  resource_id: 'i-1234567890abcdef0',
  resource_name: 'web-1',
  resource_type: type,
  resource_arn: `arn:aws:ec2:us-east-1:${ACCOUNT}:instance/i-1234567890abcdef0`,
  region: 'us-east-1',
  status: 'running',
  metadata: null,
  ...over,
})

const row = (status: EvaluatedRowView['status'], over: Partial<EvaluatedRowView> = {}): EvaluatedRowView => ({
  status,
  responseTimeMs: null,
  metrics: [],
  ...over,
})

const cw = (queries: ResourceEvidence['queries'], over: Partial<ResourceEvidence> = {}): ResourceEvidence => ({
  kind: 'cloudwatch',
  queries,
  newestDatapointAt: Object.values(queries).includes('complete') ? T1 : null,
  ...over,
})

const ec2Ok = cw({ statusCheckFailed: 'complete', cpu: 'complete' })

describe('observabilityRowFor: check_status', () => {
  it('(S1) passing: EC2 checks returned, reporting, last_seen is the newest datapoint', () => {
    const r = observabilityRowFor(inv('ec2'), row('healthy', { metrics: [{ label: 'CPU', value: 12.4, unit: '%' }] }), ec2Ok, ctx())
    expect(r).toMatchObject({ check_status: 'passing', unknown_reason: null, telemetry: 'reporting', activity: null, last_seen: T1.toISOString(), last_seen_source: 'datapoint' })
    expect(r.metrics).toEqual([{ label: 'CPU', value: 12.4, unit: '%', statistic: 'Average', window: '1h' }])
  })

  it('(S2) needs_attention: degraded ALB', () => {
    const r = observabilityRowFor(
      inv('load-balancer', { metadata: { type: 'application' } }),
      row('degraded', { responseTimeMs: 740 }),
      cw(
        { latencySec: 'complete', requestSum: 'complete', errorSum: 'empty', elb5xxSum: 'empty' },
        { activity: { key: 'requestSum', value: 120 }, values: { latencySec: 0.74, requestSum: 120, errorSum: null, elb5xxSum: null } }
      ),
      ctx()
    )
    expect(r).toMatchObject({ check_status: 'needs_attention', unknown_reason: null, activity: 'active' })
  })

  it('(S3) failing: impaired EBS, point in time, metric window "current", last_seen from the observation', () => {
    const r = observabilityRowFor(
      inv('ebs'),
      row('critical', { metrics: [{ label: 'Status check events', value: 1 }] }),
      { kind: 'point_in_time', queries: { describe: 'complete' }, newestDatapointAt: null },
      ctx()
    )
    expect(r).toMatchObject({ check_status: 'failing', telemetry: 'reporting', last_seen: SWEEP.toISOString(), last_seen_source: 'observation' })
    expect(r.metrics).toEqual([{ label: 'Status check events', value: 1, statistic: null, window: 'current' }])
  })

  it('(S4) stopped: a stopped EC2 instance with no datapoints is stopped, never failing', () => {
    for (const status of ['stopped', 'stopping', 'shutting-down']) {
      const r = observabilityRowFor(inv('ec2', { status }), row('down'), cw({ statusCheckFailed: 'empty', cpu: 'empty' }), ctx())
      expect(r).toMatchObject({ check_status: 'stopped', unknown_reason: null, telemetry: 'no_telemetry' })
    }
  })

  it('(S4b) a disabled CloudFront distribution and a stopped Aurora cluster are stopped (evidence.stopped)', () => {
    const cf = observabilityRowFor(inv('cloudfront', { region: 'global' }), row('down'), cw({ totalErrorRate: 'empty' }, { stopped: true }), ctx())
    expect(cf.check_status).toBe('stopped')
    const aurora = observabilityRowFor(inv('aurora'), row('down'), cw({ describe: 'complete', cpu: 'empty' }, { stopped: true }), ctx())
    expect(aurora.check_status).toBe('stopped')
  })

  it('(S5) access denied is unknown/access_denied -- never passing and never no_telemetry', () => {
    const r = observabilityRowFor(inv('ec2'), row('unknown'), cw({ statusCheckFailed: 'access_denied', cpu: 'complete' }), ctx())
    expect(r).toMatchObject({ check_status: 'unknown', unknown_reason: 'access_denied', telemetry: 'unknown' })
    // Even when the legacy evaluator called the row healthy from the query that did complete.
    const healthy = observabilityRowFor(inv('ec2'), row('healthy'), cw({ statusCheckFailed: 'access_denied', cpu: 'complete' }), ctx())
    expect(healthy.check_status).toBe('unknown')
    expect(healthy.telemetry).not.toBe('no_telemetry')
  })

  it('(S6/S7) throttled and failed queries are unknown with that reason', () => {
    expect(observabilityRowFor(inv('ec2'), row('unknown'), cw({ statusCheckFailed: 'throttled', cpu: 'throttled' }), ctx())).toMatchObject({
      check_status: 'unknown',
      unknown_reason: 'throttled',
      telemetry: 'unknown',
    })
    expect(observabilityRowFor(inv('ec2'), row('unknown'), cw({ statusCheckFailed: 'query_failed', cpu: 'empty' }), ctx())).toMatchObject({
      check_status: 'unknown',
      unknown_reason: 'query_failed',
      telemetry: 'unknown',
    })
  })

  it('(S8) every query completed with zero datapoints: no_telemetry (a completed query, not a failure)', () => {
    const r = observabilityRowFor(inv('ec2'), row('unknown'), cw({ statusCheckFailed: 'empty', cpu: 'empty' }), ctx())
    expect(r).toMatchObject({ check_status: 'unknown', unknown_reason: 'no_telemetry', telemetry: 'no_telemetry' })
  })

  it('(S9, D3) idle Lambda: Invocations completed with zero -> unknown/no_activity, activity no_activity, never passing', () => {
    const r = observabilityRowFor(
      inv('lambda'),
      row('unknown'),
      cw({ invocations: 'empty', errors: 'empty', duration: 'empty' }, { activity: { key: 'invocations', value: null } }),
      ctx()
    )
    expect(r).toMatchObject({ check_status: 'unknown', unknown_reason: 'no_activity', activity: 'no_activity', telemetry: 'no_telemetry' })
  })

  it('(S9b, D3, review F2) a completed activity query at zero is unknown/no_activity even when the evaluator says healthy', () => {
    const lambda = observabilityRowFor(
      inv('lambda'),
      row('healthy'),
      cw({ invocations: 'complete', errors: 'complete', duration: 'empty' }, { activity: { key: 'invocations', value: 0 } }),
      ctx()
    )
    expect(lambda).toMatchObject({ check_status: 'unknown', unknown_reason: 'no_activity', activity: 'no_activity' })
    const alb = observabilityRowFor(
      inv('load-balancer', { metadata: { type: 'application' } }),
      row('healthy', { responseTimeMs: 20 }),
      cw({ latencySec: 'complete', requestSum: 'complete', errorSum: 'empty' }, { activity: { key: 'requestSum', value: 0 } }),
      ctx()
    )
    expect(alb).toMatchObject({ check_status: 'unknown', unknown_reason: 'no_activity', activity: 'no_activity' })
    // Counted in "other", never in passing.
    expect(typeSummaryOf([lambda, alb])).toEqual({
      lambda: { count: 1, passing: 0, needs_attention: 0, failing: 0, other: 1 },
      'load-balancer': { count: 1, passing: 0, needs_attention: 0, failing: 0, other: 1 },
    })
    // A real failure verdict is not hidden by inactivity.
    const failed = observabilityRowFor(
      inv('lambda', { status: 'Failed' }),
      row('down'),
      cw({ invocations: 'empty', errors: 'empty', duration: 'empty' }, { activity: { key: 'invocations', value: null } }),
      ctx()
    )
    expect(failed.check_status).toBe('failing')
  })

  it('(review F5) a Lambda function AWS reports Inactive is unknown/no_activity, not failing', () => {
    const inactive = observabilityRowFor(
      inv('lambda', { status: 'Inactive' }),
      row('down'),
      cw({ invocations: 'empty', errors: 'empty', duration: 'empty' }, { activity: { key: 'invocations', value: null } }),
      ctx()
    )
    expect(inactive).toMatchObject({ check_status: 'unknown', unknown_reason: 'no_activity', activity: 'no_activity' })
    // A failed query still says so, before inactivity.
    const denied = observabilityRowFor(
      inv('lambda', { status: 'Inactive' }),
      row('down'),
      cw({ invocations: 'access_denied', errors: 'empty', duration: 'empty' }, { activity: { key: 'invocations', value: null } }),
      ctx()
    )
    expect(denied).toMatchObject({ check_status: 'unknown', unknown_reason: 'access_denied' })
  })

  it('(review F8) a check that recorded no query is unknown/query_failed, never passing, never a completed collection', () => {
    expect(aggregateOutcome([])).toBe('query_failed')
    const nothing = cw({}, { newestDatapointAt: null })
    const r = observabilityRowFor(inv('ec2'), row('healthy'), nothing, ctx())
    expect(r).toMatchObject({ check_status: 'unknown', unknown_reason: 'query_failed', telemetry: 'unknown', last_seen: null })
    expect(checkCompleted(nothing, ctx())).toBe(false)
    expect(checkObserved(nothing, ctx())).toBe(false)
    expect(typeSummaryOf([r]).ec2).toEqual({ count: 1, passing: 0, needs_attention: 0, failing: 0, other: 1 })
    // A resource no query could be built for (marked unsupported) stays not_supported.
    const unbuildable = { kind: 'point_in_time' as const, queries: {}, newestDatapointAt: null, unsupported: true }
    expect(observabilityRowFor(inv('ecs'), row('unknown'), unbuildable, ctx())).toMatchObject({ check_status: 'unknown', unknown_reason: 'not_supported' })
  })

  it('(S10) a throttled activity query never gives no_activity', () => {
    const r = observabilityRowFor(
      inv('lambda'),
      row('unknown'),
      cw({ invocations: 'throttled', errors: 'empty', duration: 'empty' }, { activity: { key: 'invocations', value: null } }),
      ctx()
    )
    expect(r).toMatchObject({ check_status: 'unknown', unknown_reason: 'throttled', activity: null })
  })

  // OB3: the legacy target-only "Error rate" is replaced here by the 5xx metrics (ELB +
  // target 5xx), shown only when both 5xx queries completed.
  it('(S11) ALB 5xx metrics are shown only when the 5xx queries completed; the legacy Error rate never is', () => {
    const lb = inv('load-balancer', { metadata: { type: 'application' } })
    const legacy = row('healthy', { responseTimeMs: 120, metrics: [{ label: 'Requests/min', value: 2 }, { label: 'Error rate', value: 0, unit: '%' }] })
    const values = { latencySec: 0.12, requestSum: 120, errorSum: null, elb5xxSum: null }
    const completed = observabilityRowFor(lb, legacy, cw({ latencySec: 'complete', requestSum: 'complete', errorSum: 'empty', elb5xxSum: 'empty' }, { values }), ctx())
    expect(completed.metrics.map((m) => m.label)).toEqual(['Avg latency', 'Requests/min', '5xx errors', '5xx rate'])
    const denied = observabilityRowFor(lb, legacy, cw({ latencySec: 'complete', requestSum: 'complete', errorSum: 'access_denied', elb5xxSum: 'empty' }, { values }), ctx())
    expect(denied.check_status).toBe('unknown')
    expect(denied.metrics.map((m) => m.label)).toEqual(['Avg latency', 'Requests/min'])
  })

  it('(S12) a resource whose recorded region differs from the queried one is unknown/outside_region', () => {
    const r = observabilityRowFor(inv('ec2', { region: 'eu-west-1' }), row('healthy'), ec2Ok, ctx())
    expect(r).toMatchObject({ check_status: 'unknown', unknown_reason: 'outside_region', telemetry: 'unknown', last_seen: null, metrics: [] })
  })

  it('(S12b, D1) a resource whose ARN account differs from the connected account is unknown/outside_account', () => {
    const r = observabilityRowFor(
      inv('ec2', { resource_arn: `arn:aws:ec2:us-east-1:${OTHER}:instance/i-1234567890abcdef0` }),
      row('healthy'),
      ec2Ok,
      ctx()
    )
    expect(r).toMatchObject({ check_status: 'unknown', unknown_reason: 'outside_account', telemetry: 'unknown', last_seen: null })
    expect(accountIdOfResourceArn('arn:aws:s3:::logs-bucket')).toBeNull()
  })

  // OB3: RDS instances are measured; only an Aurora member instance (its cluster row
  // measures it, R4) stays not_measured.
  it('(S13) an Aurora member RDS instance is not_measured (stopped when its inventory says stopped); NLB, API Gateway and S3 are not_measured', () => {
    const auroraMember = { metadata: { engine: 'aurora-postgresql' } }
    expect(observabilityRowFor(inv('rds', { status: 'available', ...auroraMember }), row('healthy'), undefined, ctx())).toMatchObject({
      check_status: 'not_measured',
      unknown_reason: null,
      telemetry: 'unknown',
    })
    expect(observabilityRowFor(inv('rds', { status: 'stopped', ...auroraMember }), row('down'), undefined, ctx()).check_status).toBe('stopped')
    expect(observabilityRowFor(inv('load-balancer', { metadata: { type: 'network' } }), undefined, undefined, ctx()).check_status).toBe('not_measured')
    expect(observabilityRowFor(inv('api-gateway'), undefined, undefined, ctx()).check_status).toBe('not_measured')
    expect(observabilityRowFor(inv('s3', { region: null }), undefined, undefined, ctx()).check_status).toBe('not_measured')
  })

  it('(S14) an evaluated type with no row (dimension unresolvable) is unknown/not_supported; so is an unsupported resource', () => {
    expect(observabilityRowFor(inv('load-balancer', { metadata: { type: 'application' } }), undefined, undefined, ctx())).toMatchObject({
      check_status: 'unknown',
      unknown_reason: 'not_supported',
    })
    const ecs = observabilityRowFor(inv('ecs'), row('unknown'), { kind: 'point_in_time', queries: { describe: 'complete' }, newestDatapointAt: null, unsupported: true }, ctx())
    expect(ecs).toMatchObject({ check_status: 'unknown', unknown_reason: 'not_supported', telemetry: 'unknown' })
  })

  it('(S15) a failed type block makes its rows unknown/query_failed, but leaves not-measured rows not_measured', () => {
    expect(observabilityRowFor(inv('ec2'), undefined, undefined, ctx({ blockFailed: true }))).toMatchObject({ check_status: 'unknown', unknown_reason: 'query_failed' })
    expect(observabilityRowFor(inv('load-balancer', { metadata: { type: 'network' } }), undefined, undefined, ctx({ blockFailed: true })).check_status).toBe('not_measured')
  })

  it('(S16) unknown_reason is null for every state other than unknown', () => {
    const rows = [
      observabilityRowFor(inv('ec2'), row('healthy'), ec2Ok, ctx()),
      observabilityRowFor(inv('ec2'), row('degraded'), ec2Ok, ctx()),
      observabilityRowFor(inv('ec2'), row('critical'), ec2Ok, ctx()),
      observabilityRowFor(inv('ec2', { status: 'stopped' }), row('down'), cw({ statusCheckFailed: 'empty', cpu: 'empty' }), ctx()),
      observabilityRowFor(inv('rds', { metadata: { engine: 'aurora-mysql' } }), row('healthy'), undefined, ctx()),
    ]
    expect(rows.map((r) => r.check_status)).toEqual(['passing', 'needs_attention', 'failing', 'stopped', 'not_measured'])
    for (const r of rows) expect(r.unknown_reason).toBeNull()
  })

  it('(S17) metric labels carry statistic and window: the range for CloudWatch values, "current" for point in time', () => {
    const lambda = observabilityRowFor(
      inv('lambda'),
      row('healthy', { responseTimeMs: 35, metrics: [{ label: 'Invocations', value: 10 }] }),
      cw({ invocations: 'complete', errors: 'empty', duration: 'complete' }, { activity: { key: 'invocations', value: 10 } }),
      ctx({ rangeLabel: '24h' })
    )
    expect(lambda.metrics).toEqual([
      { label: 'Avg duration', value: 35, unit: 'ms', statistic: 'Average', window: '24h' },
      { label: 'Invocations', value: 10, statistic: 'Sum', window: '24h' },
    ])
    const ecs = observabilityRowFor(
      inv('ecs'),
      row('healthy', { metrics: [{ label: 'Running', value: 2 }] }),
      { kind: 'point_in_time', queries: { describe: 'complete' }, newestDatapointAt: null },
      ctx()
    )
    expect(ecs.metrics).toEqual([{ label: 'Running', value: 2, statistic: null, window: 'current' }])
  })
})

describe('observabilityRowFor: last_seen', () => {
  it('(L2) keeps the stored datapoint when this window has none, while telemetry reports this window', () => {
    const r = observabilityRowFor(inv('ec2'), row('unknown'), cw({ statusCheckFailed: 'empty', cpu: 'empty' }), ctx({ stored: { lastDatapointAt: T0, lastSuccessfulCheckAt: T0 } }))
    expect(r).toMatchObject({ last_seen: T0.toISOString(), last_seen_source: 'datapoint', telemetry: 'no_telemetry' })
  })

  it('(L4/L5) the newer of stored and in-window wins; with nothing stored the window alone; with neither null', () => {
    expect(observabilityRowFor(inv('ec2'), row('healthy'), ec2Ok, ctx({ stored: { lastDatapointAt: T0, lastSuccessfulCheckAt: null } })).last_seen).toBe(T1.toISOString())
    expect(observabilityRowFor(inv('ec2'), row('healthy'), ec2Ok, ctx({ stored: undefined })).last_seen).toBe(T1.toISOString())
    const none = observabilityRowFor(inv('ec2'), row('unknown'), cw({ statusCheckFailed: 'empty', cpu: 'empty' }), ctx())
    expect(none).toMatchObject({ last_seen: null, last_seen_source: null })
  })

  it('(review F4) an EBS volume AWS returned no verdict for never shows "now": stored observation or null', () => {
    const noVerdict = { kind: 'point_in_time' as const, queries: { describe: 'empty' as const }, newestDatapointAt: null }
    const fresh = observabilityRowFor(inv('ebs'), row('unknown'), noVerdict, ctx())
    expect(fresh).toMatchObject({ check_status: 'unknown', unknown_reason: 'no_telemetry', telemetry: 'no_telemetry', last_seen: null, last_seen_source: null })
    const stored = observabilityRowFor(inv('ebs'), row('unknown'), noVerdict, ctx({ stored: { lastDatapointAt: null, lastSuccessfulCheckAt: T0 } }))
    expect(stored.last_seen).toBe(T0.toISOString())
    expect(checkObserved(noVerdict, ctx())).toBe(false)
    // A verdict is an observation made by this sweep.
    expect(checkObserved({ ...noVerdict, queries: { describe: 'complete' } }, ctx())).toBe(true)
  })

  it('a point-in-time check that failed shows the last successful observation, not this sweep', () => {
    const r = observabilityRowFor(
      inv('ebs'),
      row('unknown'),
      { kind: 'point_in_time', queries: { describe: 'access_denied' }, newestDatapointAt: null },
      ctx({ stored: { lastDatapointAt: null, lastSuccessfulCheckAt: T0 } })
    )
    expect(r).toMatchObject({ check_status: 'unknown', unknown_reason: 'access_denied', last_seen: T0.toISOString(), last_seen_source: 'observation' })
  })
})

describe('typeSummaryOf', () => {
  it('(P1) count = passing + needs_attention + failing + other per type; unknown, stopped, not_measured are other, never passing', () => {
    const rows = [
      observabilityRowFor(inv('ec2'), row('healthy'), ec2Ok, ctx()),
      observabilityRowFor(inv('ec2'), row('degraded'), ec2Ok, ctx()),
      observabilityRowFor(inv('ec2'), row('critical'), ec2Ok, ctx()),
      observabilityRowFor(inv('ec2', { status: 'stopped' }), row('down'), cw({ statusCheckFailed: 'empty', cpu: 'empty' }), ctx()),
      observabilityRowFor(inv('ec2'), row('healthy'), cw({ statusCheckFailed: 'access_denied', cpu: 'complete' }), ctx()),
      observabilityRowFor(inv('ec2'), row('unknown'), cw({ statusCheckFailed: 'empty', cpu: 'empty' }), ctx()),
      observabilityRowFor(inv('rds'), row('healthy'), undefined, ctx()),
    ]
    const summary = typeSummaryOf(rows)
    expect(summary).toEqual({
      ec2: { count: 6, passing: 1, needs_attention: 1, failing: 1, other: 3 },
      rds: { count: 1, passing: 0, needs_attention: 0, failing: 0, other: 1 },
    })
    for (const s of Object.values(summary)) expect(s.passing + s.needs_attention + s.failing + s.other).toBe(s.count)
  })
})
