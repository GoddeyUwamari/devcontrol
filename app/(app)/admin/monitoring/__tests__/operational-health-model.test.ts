/**
 * Operational Health (O1) model: every banner state in founder decision D3's
 * order, the green rule (D2) and each of its blockers, stopped resources never
 * setting a tone, tile errors as "—" (never 0), "at least N", the by-type
 * cards, every "What we monitor" state (D8, D9, D12) and the SLO row (D13).
 */
import { describe, it, expect } from 'vitest'
import {
  bannerView,
  formatCheckTime,
  headerView,
  monitorView,
  sloStateFor,
  tilesView,
  typeCards,
} from '../operational-health/operationalHealthModel'
import type { AlarmsData, Breakdown, PlanInfo, ResourcesData, SloState, Source } from '../operational-health/observabilityTypes'

const ZERO: Breakdown = {
  count: 0, measured: 0, passing: 0, needs_attention: 0, failing: 0, check_unknown: 0, check_failed: 0,
  neutral: 0, stopped: 0, no_activity: 0, not_enough_traffic: 0, not_measured: 0, outside_scope: 0,
  reporting: 0, no_telemetry: 0, unknown: 0,
}

/** A breakdown whose derived totals follow the backend invariants (observability-states.ts). */
function bd(over: Partial<Breakdown>): Breakdown {
  const b = { ...ZERO, ...over }
  b.neutral = b.stopped + b.no_activity + b.not_enough_traffic
  b.measured = b.passing + b.needs_attention + b.failing + b.check_unknown
  if (over.reporting === undefined && over.no_telemetry === undefined && over.unknown === undefined) b.reporting = b.measured
  b.count = b.measured + b.neutral + b.not_measured + b.outside_scope
  return b
}

function sum(types: Record<string, Breakdown>): Breakdown {
  const f = { ...ZERO }
  for (const b of Object.values(types)) for (const k of Object.keys(f) as (keyof Breakdown)[]) f[k] += b[k]
  return f
}

function okResources(types: Record<string, Breakdown>, over: Record<string, unknown> = {}): Source<ResourcesData> {
  return {
    state: 'ok',
    data: {
      status: 'ok', region: 'us-east-1', account_count: 1, multiple_accounts: false, range: '1h', collection: 'complete',
      checked_at: '2026-10-29T14:59:00.000Z', captured_at: '2026-10-29T14:59:00.000Z',
      inventory_capped: false, inventory_capped_reasons: [],
      type_breakdown: types, fleet_summary: sum(types),
      ...over,
    } as ResourcesData,
  }
}

const notOk = (status: 'not_connected' | 'multiple_accounts' | 'failed', reason?: string): Source<ResourcesData> =>
  ({ state: 'ok', data: { status, reason, region: null, account_count: status === 'not_connected' ? 0 : 1 } as ResourcesData })

function okAlarms(inAlarm = 0, configured = 3, over: Record<string, unknown> = {}): Source<AlarmsData> {
  return {
    state: 'ok',
    data: {
      status: 'ok', reason: null, checked_at: '2026-10-29T14:59:00.000Z', region: 'us-east-1',
      in_alarm: Array.from({ length: inAlarm }, (_, i) => ({ name: `alarm-${i}` })), in_alarm_complete: true,
      configured_count: configured, configured_count_complete: true, truncated: false,
      ...over,
    } as AlarmsData,
  }
}

const alarmsError = (reason: string): Source<AlarmsData> => ({
  state: 'ok',
  data: { status: 'error', reason, checked_at: '2026-10-29T14:59:00.000Z', region: null, in_alarm: null, in_alarm_complete: null, configured_count: null, configured_count_complete: null, truncated: null } as AlarmsData,
})

const healthy = () => okResources({ ec2: bd({ passing: 2 }), ebs: bd({ passing: 1 }) })
const loading = { state: 'loading' } as const

describe('banner (D3 order)', () => {
  it('no banner until both sources answered', () => {
    expect(bannerView(loading, okAlarms())).toBeNull()
    expect(bannerView(healthy(), loading)).toBeNull()
  })

  it('not connected: neutral, Connect AWS', () => {
    const b = bannerView(notOk('not_connected'), alarmsError('not_connected'))!
    expect(b).toMatchObject({ kind: 'not_connected', tone: 'neutral', headline: "CloudWatch isn't connected yet", action: { kind: 'link', href: '/connect-aws' } })
  })

  it('several accounts: the D4 wording, no account label', () => {
    const b = bannerView(notOk('multiple_accounts'), alarmsError('multiple_accounts'))!
    expect(b.kind).toBe('multiple_accounts')
    expect([b.headline, ...b.lines].join(' ')).toBe('More than one AWS account is connected. This page checks one account, so nothing is shown yet.')
    expect(b.action).toBeNull()
  })

  it('issues: failing is danger and names the counts', () => {
    const b = bannerView(okResources({ ec2: bd({ passing: 1, failing: 2, needs_attention: 1 }) }), okAlarms(1))!
    expect(b).toMatchObject({ kind: 'issues', tone: 'danger', headline: '3 resources need attention' })
    expect(b.lines[0]).toBe('2 failing · 1 needs attention · 1 CloudWatch alarm in ALARM')
  })

  it('issues: needs attention alone is warning', () => {
    expect(bannerView(okResources({ ec2: bd({ passing: 1, needs_attention: 1 }) }), okAlarms())!).toMatchObject({ kind: 'issues', tone: 'warning' })
  })

  it('issues: an alarm in ALARM alone, with "at least" when the list is incomplete', () => {
    const b = bannerView(healthy(), okAlarms(500, 1000, { in_alarm_complete: false }))!
    expect(b).toMatchObject({ kind: 'issues', tone: 'warning', headline: 'at least 500 CloudWatch alarms are in ALARM' })
  })

  it('issues beat a failed source (a known problem beats missing data), with the source named', () => {
    const b = bannerView(okResources({ ec2: bd({ failing: 1 }) }), alarmsError('failed'))!
    expect(b.kind).toBe('issues')
    expect(b.lines).toContain("Some checks couldn't load, so there may be more.")
    expect(b.action).toEqual({ kind: 'retry' })
  })

  it('an alarm in ALARM is an issue even when resources failed', () => {
    expect(bannerView({ state: 'error', kind: 'failed' }, okAlarms(2))!.kind).toBe('issues')
  })

  it.each([
    ['resources request failed', { state: 'error', kind: 'failed' } as Source<ResourcesData>, okAlarms()],
    ['resources 503', { state: 'error', kind: 'unavailable' } as Source<ResourcesData>, okAlarms()],
    ['resources failed/connection_failed', notOk('failed', 'connection_failed'), okAlarms()],
    ['resources failed/query_failed', notOk('failed', 'query_failed'), okAlarms()],
    ['alarms error', healthy(), alarmsError('access_denied')],
    ['alarms request failed', healthy(), { state: 'error', kind: 'failed' } as Source<AlarmsData>],
    ['collection partial', okResources({ ec2: bd({ passing: 2 }) }, { collection: 'partial' }), okAlarms()],
  ])('a source failed (%s): warning with Retry, never green', (_name, resources, alarms) => {
    const b = bannerView(resources, alarms)!
    expect(b).toMatchObject({ kind: 'source_failed', tone: 'warning', headline: "Some checks couldn't load", action: { kind: 'retry' } })
  })

  it.each(['not_connected', 'multiple_accounts'])('F1: alarms %s with healthy ok resources: a source that didn’t load, never green or "no alarms"', (reason) => {
    const b = bannerView(healthy(), alarmsError(reason))!
    expect(b).toMatchObject({ kind: 'source_failed', tone: 'warning', action: { kind: 'retry' } })
    expect([b.headline, ...b.lines].join(' ')).not.toMatch(/no CloudWatch alarms are in ALARM/)
  })

  it.each(['not_connected', 'multiple_accounts'])('F1: alarms %s with a failing resource: issues, and says more may be missing', (reason) => {
    const b = bannerView(okResources({ ec2: bd({ failing: 1 }) }), alarmsError(reason))!
    expect(b.kind).toBe('issues')
    expect(b.lines).toContain("Some checks couldn't load, so there may be more.")
  })

  it('F3: an ok answer without fleet_summary / type_breakdown (older backend) is a failed source, never a crash', () => {
    const old = { state: 'ok', data: { status: 'ok', region: 'us-east-1', account_count: 1, multiple_accounts: false, range: '1h', collection: 'complete', checked_at: null, captured_at: '2026-10-29T14:59:00.000Z', inventory_capped: false, inventory_capped_reasons: [] } } as unknown as Source<ResourcesData>
    expect(bannerView(old, okAlarms())!.kind).toBe('source_failed')
    expect(typeCards(old)).toBeNull()
    expect(tilesView(old, okAlarms()).checks).toMatchObject({ state: 'unavailable', retry: true })
    expect(headerView(old, okAlarms()).pill).toEqual({ tone: 'warning', text: "Couldn't check" })
    expect(rowOf(monitorView(old, okAlarms(), { state: 'none' }, known('pro'), SEE), 'type:ec2').state).toBe('couldnt_check')
  })

  it('a failed source beats telemetry missing', () => {
    expect(bannerView(okResources({ ec2: bd({ passing: 1, check_unknown: 1, reporting: 1, no_telemetry: 1 }) }, { collection: 'partial' }), okAlarms())!.kind).toBe('source_failed')
  })

  it('telemetry missing: names reporting of measured', () => {
    const b = bannerView(okResources({ rds: bd({ passing: 1, check_unknown: 1, reporting: 1, no_telemetry: 1 }) }), okAlarms())!
    expect(b).toMatchObject({ kind: 'telemetry_missing', tone: 'warning', headline: '1 of 2 measured resources reporting telemetry' })
  })

  it('nothing measured: neutral, never green (only stopped and not-measured rows)', () => {
    const b = bannerView(okResources({ ec2: bd({ stopped: 2 }), s3: bd({ not_measured: 3 }) }), okAlarms())!
    expect(b).toMatchObject({ kind: 'nothing_measured', tone: 'neutral', headline: 'Nothing measured yet' })
  })

  it('green: every measured resource passing, alarms complete with 0 in ALARM, discovery complete; scope named', () => {
    const b = bannerView(healthy(), okAlarms(0, 3))!
    expect(b).toMatchObject({ kind: 'green', tone: 'success', headline: 'No issues detected in measured checks' })
    expect(b.lines[0]).toMatch(/^3 of 3 measured resources are passing, and no CloudWatch alarms are in ALARM\./)
  })

  it('green with exactly one measured resource', () => {
    expect(bannerView(okResources({ ec2: bd({ passing: 1 }) }), okAlarms(0, 0))!.kind).toBe('green')
  })

  it('stopped and idle resources never turn it red or amber, and are not counted as passing', () => {
    const b = bannerView(okResources({ ec2: bd({ passing: 1, stopped: 3 }), lambda: bd({ no_activity: 2 }) }), okAlarms())!
    expect(b.kind).toBe('green')
    expect(b.lines[0]).toContain('1 of 1 measured resources are passing')
    expect(b.lines[0]).toContain('5 stopped or idle resources aren’t counted.')
  })

  it.each([
    ['inventory_capped true', okResources({ ec2: bd({ passing: 2 }) }, { inventory_capped: true }), okAlarms(), 'unconfirmed'],
    ['inventory_capped null', okResources({ ec2: bd({ passing: 2 }) }, { inventory_capped: null }), okAlarms(), 'unconfirmed'],
    ['in_alarm incomplete with 0 listed', healthy(), okAlarms(0, 3, { in_alarm_complete: false }), null],
    ['one measured row has no check result', okResources({ ec2: bd({ passing: 1, check_unknown: 1, reporting: 2 }) }), okAlarms(), 'telemetry_missing'],
    ['zero measured', okResources({}), okAlarms(), 'nothing_measured'],
  ])('green blocked: %s', (_name, resources, alarms, kind) => {
    const b = bannerView(resources, alarms)!
    expect(b.kind).not.toBe('green')
    if (kind) expect(b.kind).toBe(kind)
  })
})

describe('header', () => {
  it('connected: pill, last successful check with a time zone', () => {
    const v = headerView(healthy(), okAlarms(), new Date('2026-10-29T15:00:00Z'))
    expect(v.pill).toEqual({ tone: 'success', text: 'CloudWatch connected' })
    expect(v.lastCheck).toMatch(/^Last successful check today, \d{1,2}:\d{2}\s?[AP]M [A-Z]{2,5}/)
    expect(v.region).toBe('us-east-1')
  })
  it('no complete check yet, and a partial sweep says so', () => {
    const v = headerView(okResources({ ec2: bd({ passing: 1 }) }, { checked_at: null, collection: 'partial' }), okAlarms())
    expect(v.lastCheck).toBe('No complete check yet')
    expect(v.incomplete).toBe(true)
  })
  it('not connected / several accounts / connection failed / unavailable', () => {
    expect(headerView(notOk('not_connected'), alarmsError('not_connected')).pill!.text).toBe('AWS not connected')
    expect(headerView(notOk('multiple_accounts'), alarmsError('multiple_accounts')).pill!.text).toBe('More than one AWS account')
    expect(headerView(notOk('failed', 'connection_failed'), okAlarms()).pill).toEqual({ tone: 'danger', text: "Couldn't connect to AWS" })
    expect(headerView({ state: 'error', kind: 'unavailable' }, okAlarms()).pill!.text).toBe("Couldn't check")
  })
  it('no region from anywhere: no console link (never a guessed default)', () => {
    expect(headerView(notOk('not_connected'), alarmsError('not_connected')).region).toBeNull()
  })
  it('formatCheckTime: another day carries the date; garbage is null', () => {
    expect(formatCheckTime('2026-10-27T10:00:00Z', new Date('2026-10-29T15:00:00Z'))).toMatch(/Oct 27, 2026, /)
    expect(formatCheckTime('not a date')).toBeNull()
  })
})

describe('tiles: error is "—", never 0', () => {
  it('resources ok: counts out of measured, legend and the not-measured line', () => {
    const t = tilesView(okResources({ ec2: bd({ passing: 2, failing: 1, stopped: 1 }), s3: bd({ not_measured: 4 }) }), okAlarms())
    expect(t.checks).toMatchObject({ state: 'ok', value: 2, of: 3, legend: 'Passing 2 · Needs attention 0 · Failing 1' })
    expect(t.telemetry).toMatchObject({ state: 'ok', value: 3, of: 3, legend: 'Reporting 3 · No telemetry 0 · Unknown 0', note: 'Not measured: 4 resources (not counted)' })
  })
  it.each([
    ['request failed', { state: 'error', kind: 'failed' } as Source<ResourcesData>, true],
    ['503', { state: 'error', kind: 'unavailable' } as Source<ResourcesData>, true],
    ['failed', notOk('failed', 'query_failed'), true],
    ['not connected', notOk('not_connected'), false],
    ['several accounts', notOk('multiple_accounts'), false],
  ])('resources %s: checks and telemetry unavailable (retry %s)', (_name, resources, retry) => {
    const t = tilesView(resources, okAlarms())
    expect(t.checks).toMatchObject({ state: 'unavailable', retry })
    expect(t.telemetry).toMatchObject({ state: 'unavailable', retry })
  })
  it('alarms ok with zero is a real 0', () => {
    expect(tilesView(healthy(), okAlarms(0, 0)).alarms).toEqual({ state: 'ok', inAlarm: '0', configured: '0', region: 'us-east-1' })
  })
  it('incomplete counts are "at least N"', () => {
    const t = tilesView(healthy(), okAlarms(500, 1000, { in_alarm_complete: false, configured_count_complete: false, truncated: true }))
    expect(t.alarms).toMatchObject({ inAlarm: 'at least 500', configured: 'at least 1,000' })
  })
  it.each([
    ['access_denied', "DevControl's role isn't allowed to read alarms.", true],
    ['throttled', 'AWS limited the request rate. Try again shortly.', true],
    ['failed', null, true],
  ])('alarms %s: unavailable with the reason and Retry', (reason, detail, retry) => {
    expect(tilesView(healthy(), alarmsError(reason)).alarms).toEqual({ state: 'unavailable', reason: 'Couldn\'t read CloudWatch alarms. The banner can\'t say "no alarms".', detail, retry })
  })
  it('alarms not connected: no Retry when resources agree', () => {
    expect(tilesView(notOk('not_connected'), alarmsError('not_connected')).alarms).toMatchObject({ state: 'unavailable', retry: false })
    expect(tilesView(notOk('multiple_accounts'), alarmsError('multiple_accounts')).alarms).toMatchObject({ state: 'unavailable', retry: false })
  })
  it.each(['not_connected', 'multiple_accounts'])('alarms %s while resources are ok: Retry (the two requests disagreed)', (reason) => {
    expect(tilesView(healthy(), alarmsError(reason)).alarms).toMatchObject({ state: 'unavailable', retry: true })
  })
  it('region from resources, else from alarms', () => {
    expect(tilesView(healthy(), okAlarms()).region).toEqual({ state: 'ok', region: 'us-east-1' })
    expect(tilesView({ state: 'error', kind: 'failed' }, okAlarms()).region).toEqual({ state: 'ok', region: 'us-east-1' })
  })
  it.each([
    ['resources loading', loading, { state: 'loading' }],
    ['resources request failed', { state: 'error', kind: 'failed' } as Source<ResourcesData>, { state: 'unavailable', reason: "Couldn't load checks.", retry: true }],
    ['resources failed', notOk('failed', 'query_failed'), { state: 'unavailable', reason: "Couldn't load checks.", retry: true }],
    ['not connected', notOk('not_connected'), { state: 'unavailable', reason: 'AWS isn’t connected.', retry: false }],
    ['several accounts', notOk('multiple_accounts'), { state: 'unavailable', reason: 'More than one AWS account is connected.', retry: false }],
  ])('F4: no region (%s): "—" always with a reason', (_name, resources, expected) => {
    expect(tilesView(resources as Source<ResourcesData>, alarmsError('failed')).region).toEqual(expected)
  })
})

describe('by resource type', () => {
  it('pill "<n> of <n> passing" coloured by the worst state, with the text naming it', () => {
    const cards = typeCards(okResources({ lambda: bd({ passing: 1, needs_attention: 1 }), ec2: bd({ passing: 2, failing: 1, stopped: 1 }), ebs: bd({ passing: 1 }) }))!
    expect(cards.map((c) => c.type)).toEqual(['ec2', 'lambda', 'ebs'])
    expect(cards[0]).toMatchObject({ title: 'EC2 · 4', pill: { tone: 'danger', text: '2 of 3 passing' }, detail: '1 failing · 1 stopped', measuredBy: 'status checks, CPU' })
    expect(cards[1].pill).toEqual({ tone: 'warning', text: '1 of 2 passing' })
    expect(cards[2].pill).toEqual({ tone: 'success', text: '1 of 1 passing' })
  })
  it('not-measured types say so, and empty types are hidden', () => {
    const cards = typeCards(okResources({ s3: bd({ not_measured: 2 }), rds: ZERO }))!
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({ title: 'S3 · 2', pill: { tone: 'neutral', text: 'Not measured yet' }, measuredBy: null })
  })
  it('no cards when resources did not load', () => {
    expect(typeCards({ state: 'error', kind: 'failed' })).toBeNull()
  })
})

const known = (tier: PlanInfo['tier']): PlanInfo => ({ status: 'known', tier })
const SEE = { label: 'See plans', href: '/settings/billing/upgrade' }
const rowOf = (view: ReturnType<typeof monitorView>, key: string) => view.groups.flatMap((g) => g.rows).find((r) => r.key === key)!

describe('what we monitor', () => {
  const slo: SloState = { state: 'none' }

  it('groups in order, every row has a state', () => {
    const v = monitorView(healthy(), okAlarms(), slo, known('pro'), SEE)
    expect(v.groups.map((g) => g.title)).toEqual(['Compute', 'Storage and databases', 'Traffic', 'Alerting', 'Configuration'])
    expect(v.planNote).toBe(false)
  })
  it('monitored, none found (discovery complete), not measured, static not measured (D9)', () => {
    const v = monitorView(healthy(), okAlarms(), slo, known('pro'), SEE)
    expect(rowOf(v, 'type:ec2')).toMatchObject({ state: 'monitored', label: 'EC2: status checks, CPU' })
    expect(rowOf(v, 'type:lambda')).toMatchObject({ state: 'none_found', stateText: 'No functions found' })
    expect(rowOf(v, 'type:api-gateway').state).toBe('not_measured')
    for (const label of ['ElastiCache', 'SQS', 'SNS']) expect(rowOf(v, `static:${label}`)).toMatchObject({ state: 'not_measured', stateText: 'Not measured yet', reason: null })
  })
  it('D12: discovery not confirmed complete never says "No <type> found"', () => {
    for (const capped of [true, null]) {
      const row = rowOf(monitorView(okResources({ ec2: bd({ passing: 1 }) }, { inventory_capped: capped }), okAlarms(), slo, known('pro'), SEE), 'type:lambda')
      expect(row.state).toBe('couldnt_check')
      expect(row.stateText).not.toMatch(/found/)
    }
  })
  it('D8: Free plan, known: skipped types are "Not included in your plan", plus the plan note', () => {
    const v = monitorView(healthy(), okAlarms(), slo, known('free'), SEE)
    for (const t of ['lambda', 'load-balancer', 'ecs', 'eks', 'dynamodb', 'cloudfront', 'aurora']) expect(rowOf(v, `type:${t}`)).toMatchObject({ state: 'not_in_plan', stateText: 'Not included in your plan' })
    expect(rowOf(v, 'type:ec2').state).toBe('monitored')
    expect(v.planNote).toBe(true)
  })
  it('F2: plan loading: types the Free plan skips say Checking…, never "No … found"; no plan note', () => {
    const v = monitorView(healthy(), okAlarms(), slo, { status: 'loading', tier: 'free' }, SEE)
    expect(v.planNote).toBe(false)
    for (const t of ['lambda', 'load-balancer', 'ecs', 'eks', 'dynamodb', 'cloudfront', 'aurora']) {
      expect(rowOf(v, `type:${t}`)).toMatchObject({ state: 'checking', stateText: 'Checking…' })
    }
    // Types every plan discovers are unaffected.
    expect(rowOf(v, 'type:ec2').state).toBe('monitored')
    expect(rowOf(v, 'type:rds').state).toBe('none_found')
  })
  it('F2: plan failed to load: Couldn’t check with the reason, never "No … found"; no plan note', () => {
    const v = monitorView(healthy(), okAlarms(), slo, { status: 'error', tier: 'free' }, SEE)
    expect(v.planNote).toBe(false)
    for (const t of ['lambda', 'load-balancer', 'ecs', 'eks', 'dynamodb', 'cloudfront', 'aurora']) {
      expect(rowOf(v, `type:${t}`)).toMatchObject({ state: 'couldnt_check', reason: "Your plan couldn't be loaded." })
    }
  })
  it('F2: a known paid plan still says "No … found" when discovery completed', () => {
    for (const tier of ['starter', 'pro', 'enterprise'] as const) {
      expect(rowOf(monitorView(healthy(), okAlarms(), slo, known(tier), SEE), 'type:lambda')).toMatchObject({ state: 'none_found', stateText: 'No functions found' })
    }
  })
  it('no activity, couldn’t check (all queries failed), only outside scope', () => {
    const v = monitorView(
      okResources({ lambda: bd({ no_activity: 2 }), ec2: bd({ check_unknown: 2, check_failed: 2, reporting: 0, unknown: 2 }), rds: bd({ outside_scope: 1 }) }),
      okAlarms(), slo, known('pro'), SEE
    )
    expect(rowOf(v, 'type:lambda').state).toBe('no_activity')
    expect(rowOf(v, 'type:ec2')).toMatchObject({ state: 'couldnt_check', reason: 'The checks failed or were denied.' })
    expect(rowOf(v, 'type:rds').state).toBe('couldnt_check')
  })
  it('F5: Couldn’t check follows check results, not telemetry', () => {
    // Every measured row unknown/no_telemetry: the checks ran; there's no result, nothing failed.
    const noTelemetry = rowOf(monitorView(okResources({ rds: bd({ check_unknown: 2, reporting: 0, no_telemetry: 2 }) }), okAlarms(), slo, known('pro'), SEE), 'type:rds')
    expect(noTelemetry).toMatchObject({ state: 'monitored', reason: 'No check result yet.' })
    // Telemetry unknown but the checks didn't fail (not_supported): not "failed or denied".
    const notSupported = rowOf(monitorView(okResources({ ec2: bd({ check_unknown: 1, reporting: 0, unknown: 1 }) }), okAlarms(), slo, known('pro'), SEE), 'type:ec2')
    expect(notSupported.state).toBe('monitored')
    // Every measured check failed or was denied, whatever the telemetry says.
    const failed = rowOf(monitorView(okResources({ ec2: bd({ check_unknown: 2, check_failed: 2, reporting: 2 }) }), okAlarms(), slo, known('pro'), SEE), 'type:ec2')
    expect(failed).toMatchObject({ state: 'couldnt_check', reason: 'The checks failed or were denied.' })
    // Some failed, some judged: monitored.
    expect(rowOf(monitorView(okResources({ ec2: bd({ passing: 1, check_unknown: 1, check_failed: 1 }) }), okAlarms(), slo, known('pro'), SEE), 'type:ec2').state).toBe('monitored')
  })

  it('resources failed: type rows can’t be checked, with the reason', () => {
    const row = rowOf(monitorView({ state: 'error', kind: 'failed' }, okAlarms(), slo, known('pro'), SEE), 'type:ec2')
    expect(row).toMatchObject({ state: 'couldnt_check', reason: "Resource checks couldn't load." })
  })
  it('alarms: monitored, none set, couldn’t check with Retry (never 0)', () => {
    expect(rowOf(monitorView(healthy(), okAlarms(0, 3), slo, known('pro'), SEE), 'alarms').state).toBe('monitored')
    expect(rowOf(monitorView(healthy(), okAlarms(0, 0), slo, known('pro'), SEE), 'alarms').state).toBe('none_set')
    expect(rowOf(monitorView(healthy(), alarmsError('failed'), slo, known('pro'), SEE), 'alarms')).toMatchObject({ state: 'couldnt_check', retry: 'alarms' })
  })
})

describe('SLO row (D13)', () => {
  const view = (s: SloState) => rowOf(monitorView(healthy(), okAlarms(), s, known('enterprise'), SEE), 'slos')
  it('maps plan and result', () => {
    expect(sloStateFor({ status: 'loading', tier: 'free' }, { state: 'idle' })).toEqual({ state: 'loading' })
    expect(sloStateFor({ status: 'error', tier: 'free' }, { state: 'idle' })).toEqual({ state: 'plan_error' })
    for (const tier of ['free', 'starter', 'pro'] as const) expect(sloStateFor(known(tier), { state: 'idle' })).toEqual({ state: 'plan_required' })
    expect(sloStateFor(known('enterprise'), { state: 'plan_required' })).toEqual({ state: 'plan_required' })
    expect(sloStateFor(known('enterprise'), { state: 'ok', statuses: [] })).toEqual({ state: 'none' })
    expect(sloStateFor(known('enterprise'), { state: 'ok', statuses: ['healthy', 'breached', 'insufficient_data', 'breached'] })).toEqual({ state: 'ok', count: 4, breached: 2, unevaluated: 1 })
    expect(sloStateFor(known('enterprise'), { state: 'error' })).toEqual({ state: 'error' })
  })
  it('renders each state; an error is never 0', () => {
    expect(view({ state: 'plan_required' })).toMatchObject({ stateText: 'On Revenue Protection', link: { label: 'See plans →' } })
    expect(view({ state: 'none' })).toMatchObject({ stateText: 'None set', link: { label: 'Set up SLOs →' } })
    expect(view({ state: 'ok', count: 3, breached: 1, unevaluated: 1 })).toMatchObject({ stateText: 'Monitored', reason: "3 set · 1 at risk · 1 couldn't be evaluated" })
    const err = view({ state: 'error' })
    expect(err).toMatchObject({ stateText: "Couldn't check", retry: 'slo' })
    expect(`${err.stateText} ${err.reason}`).not.toMatch(/\b0\b/)
  })
})
