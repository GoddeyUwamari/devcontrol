/**
 * Active alarms list model (O3a): the order (newest state_since first, no time
 * last, name A–Z, then type and API index), each column only from what the API
 * sent (composite alarms name only, no severity), "In ALARM since", the
 * per-alarm console link (region + encoded name only; none when unsafe), and the
 * section's states: an error is never an empty list, and the partial line keys
 * on in_alarm_complete, not truncated. The zone is pinned (UTC) before anything loads.
 */
import { describe, it, expect, vi } from 'vitest'
import type { AlarmsData, InAlarmItem, ResourcesData, Source } from '../operational-health/observabilityTypes'
import { alarmConsoleHref, alarmsListView, metricView, resourceText, sinceView, sortAlarms } from '../operational-health/alarmsListModel'

vi.hoisted(() => {
  process.env.TZ = 'UTC'
})

const NOW = new Date('2026-10-29T15:00:00Z')

const item = (over: Partial<InAlarmItem> = {}): InAlarmItem => ({
  name: 'cpu-high',
  type: 'metric',
  namespace: 'AWS/EC2',
  metric: 'CPUUtilization',
  comparison: 'GreaterThanThreshold',
  threshold: 80,
  state_since: '2026-10-29T14:48:00.000Z',
  resource: { type: 'ec2', id: 'i-0123456789abcdef0' },
  ...over,
})
const composite = (over: Partial<InAlarmItem> = {}): InAlarmItem =>
  item({ type: 'composite', namespace: null, metric: null, comparison: null, threshold: null, resource: null, ...over })

const okAlarms = (in_alarm: InAlarmItem[], over: Record<string, unknown> = {}): Source<AlarmsData> => ({
  state: 'ok',
  data: { status: 'ok', reason: null, checked_at: '2026-10-29T14:59:00.000Z', region: 'us-east-1', in_alarm, in_alarm_complete: true, configured_count: 3, configured_count_complete: true, truncated: false, ...over } as AlarmsData,
})
const errAlarms = (reason: string, region: string | null = 'us-east-1'): Source<AlarmsData> => ({
  state: 'ok',
  data: { status: 'error', reason, checked_at: '2026-10-29T14:59:00.000Z', region, in_alarm: null, in_alarm_complete: null, configured_count: null, configured_count_complete: null, truncated: null } as AlarmsData,
})
const resOk: Source<ResourcesData> = { state: 'ok', data: { status: 'ok', region: 'us-east-1' } as ResourcesData }
const resStatus = (status: string): Source<ResourcesData> => ({ state: 'ok', data: { status, region: null, account_count: 0 } as ResourcesData })

const names = (items: InAlarmItem[]) => sortAlarms(items).map(({ item: i }) => `${i.name}/${i.type}`)

describe('order', () => {
  const set = [
    item({ name: 'old', state_since: '2026-10-29T10:00:00Z' }),
    item({ name: 'no-time', state_since: null }),
    composite({ name: 'newest', state_since: '2026-10-29T14:59:00Z' }),
    item({ name: 'beta', state_since: '2026-10-29T12:00:00Z' }),
    item({ name: 'Alpha', state_since: '2026-10-29T12:00:00Z' }),
    item({ name: 'bad-time', state_since: 'not-a-date' }),
    item({ name: 'alpha', state_since: '2026-10-29T12:00:00Z' }),
    composite({ name: 'same', state_since: '2026-10-29T11:00:00Z' }),
    item({ name: 'same', state_since: '2026-10-29T11:00:00Z' }),
  ]
  const expected = ['newest/composite', 'Alpha/metric', 'alpha/metric', 'beta/metric', 'same/metric', 'same/composite', 'old/metric', 'bad-time/metric', 'no-time/metric']

  it('newest state_since first; no or unparseable time last; ties by name case-insensitively, raw name, then metric before composite', () => {
    expect(names(set)).toEqual(expected)
  })

  it('the API’s array order never matters (every rotation and the reverse give the same order)', () => {
    for (let k = 0; k < set.length; k++) expect(names([...set.slice(k), ...set.slice(0, k)])).toEqual(expected)
    expect(names([...set].reverse())).toEqual(expected)
  })

  it('identical alarms keep their API order (the index is the last tiebreak), and the input is not mutated', () => {
    const a = item({ name: 'x', state_since: null })
    const b = item({ name: 'x', state_since: null })
    const input = [b, a]
    const sorted = sortAlarms(input)
    expect(sorted.map((s) => s.index)).toEqual([0, 1])
    expect(input[0]).toBe(b)
  })
})

describe('Metric column', () => {
  it.each([
    ['GreaterThanThreshold', 'CPUUtilization > 80'],
    ['GreaterThanOrEqualToThreshold', 'CPUUtilization ≥ 80'],
    ['LessThanThreshold', 'CPUUtilization < 80'],
    ['LessThanOrEqualToThreshold', 'CPUUtilization ≤ 80'],
  ])('%s → %s, with the namespace beside it', (comparison, text) => {
    expect(metricView(item({ comparison }))).toEqual({ text, namespace: 'AWS/EC2', composite: false })
  })

  it.each([
    ['LessThanLowerOrGreaterThanUpperThreshold', 'CPUUtilization outside the band'],
    ['LessThanLowerThreshold', 'CPUUtilization below the band'],
    ['GreaterThanUpperThreshold', 'CPUUtilization above the band'],
  ])('anomaly band %s → %s (no number)', (comparison, text) => {
    expect(metricView(item({ comparison, threshold: null })).text).toBe(text)
  })

  it('an unrecognised operator is shown as the API sent it', () => {
    expect(metricView(item({ comparison: 'SomeNewOperator' })).text).toBe('CPUUtilization SomeNewOperator 80')
  })

  it.each([
    [0, 'Errors > 0'],
    [-5, 'Errors > -5'],
    [0.25, 'Errors > 0.25'],
    [1500000, 'Errors > 1,500,000'],
    [0.000123, 'Errors > 0.000123'],
  ])('threshold %s printed exactly, no unit', (threshold, text) => {
    expect(metricView(item({ metric: 'Errors', threshold })).text).toBe(text)
  })

  it('D5: a metric alarm without a metric name shows "—" for it, never "metric math"', () => {
    const v = metricView(item({ metric: null, namespace: null }))
    expect(v).toEqual({ text: '— > 80', namespace: null, composite: false })
    expect(JSON.stringify(v)).not.toMatch(/math/i)
  })

  it('missing comparison → the metric alone; a non-band operator without a threshold → no number', () => {
    expect(metricView(item({ comparison: null })).text).toBe('CPUUtilization 80')
    expect(metricView(item({ threshold: null })).text).toBe('CPUUtilization >')
    expect(metricView(item({ metric: null, namespace: null, comparison: null, threshold: null })).text).toBeNull()
  })

  it('D4: a composite alarm shows its name only: no metric, operator, threshold or namespace, even if fields leaked through', () => {
    const v = metricView(composite({ comparison: 'GreaterThanThreshold', threshold: 0, metric: 'X', namespace: 'AWS/EC2' }))
    expect(v).toEqual({ text: null, namespace: null, composite: true })
  })
})

describe('Resource and In ALARM since', () => {
  it('resource: id · singular type; unknown type as sent; none → null', () => {
    expect(resourceText(item())).toBe('i-0123456789abcdef0 · EC2')
    expect(resourceText(item({ resource: { type: 'load-balancer', id: 'app/web/0123456789abcdef' } }))).toBe('app/web/0123456789abcdef · Load balancer')
    expect(resourceText(item({ resource: { type: 'something-new', id: 'x-1' } }))).toBe('x-1 · something-new')
    expect(resourceText(item({ resource: null }))).toBeNull()
    expect(resourceText(composite())).toBeNull()
  })

  it.each([
    ['2026-10-29T14:59:30Z', 'just now', 'today, 2:59 PM UTC'],
    ['2026-10-29T14:48:00Z', '12 min ago', 'today, 2:48 PM UTC'],
    ['2026-10-29T12:00:00Z', '3 h ago', 'today, 12:00 PM UTC'],
    ['2026-10-27T15:00:00Z', '2 d ago', 'Oct 27, 2026, 3:00 PM UTC'],
  ])('%s → %s over %s', (iso, relative, local) => {
    expect(sinceView(iso, NOW)).toEqual({ iso, relative, local })
  })

  it('no time or an unparseable one → null ("—")', () => {
    expect(sinceView(null, NOW)).toBeNull()
    expect(sinceView('not-a-date', NOW)).toBeNull()
  })
})

describe('console links (D2)', () => {
  const BASE = 'https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#alarmsV2:alarm/'

  it('region and encoded name only', () => {
    expect(alarmConsoleHref('us-east-1', 'cpu high')).toBe(`${BASE}cpu%20high`)
    expect(alarmConsoleHref('eu-west-2', 'x')).toBe('https://console.aws.amazon.com/cloudwatch/home?region=eu-west-2#alarmsV2:alarm/x')
  })

  it.each([
    ['web/api 5xx', 'web%2Fapi%205xx'],
    ['a#b?c', 'a%23b%3Fc'],
    ['100% & more', '100%25%20%26%20more'],
    ['café', 'caf%C3%A9'],
  ])('encodes %s', (name, encoded) => {
    expect(alarmConsoleHref('us-east-1', name)).toBe(`${BASE}${encoded}`)
  })

  it('never carries anything else from the alarm (resource id, namespace)', () => {
    const view = alarmsListView(okAlarms([item({ name: 'n' })]), resOk, NOW)
    const href = view.state === 'rows' ? view.rows[0].href : null
    expect(href).toBe(`${BASE}n`)
    expect(href).not.toContain('i-0123456789abcdef0')
    expect(href).not.toContain('AWS')
  })

  it.each([
    ['no region', null, 'x'],
    ['China', 'cn-north-1', 'x'],
    ['GovCloud', 'us-gov-west-1', 'x'],
    ['isolated', 'us-isob-east-1', 'x'],
    ['upper case', 'US-EAST-1', 'x'],
    ['path in region', 'us-east-1/../x', 'x'],
    ['empty name', 'us-east-1', ''],
    ['newline', 'us-east-1', 'a\nb'],
    ['256 characters', 'us-east-1', 'a'.repeat(256)],
    ['lone surrogate', 'us-east-1', 'a\uD800b'],
  ])('no link: %s', (_, region, name) => {
    expect(alarmConsoleHref(region, name)).toBeNull()
  })

  it('a 255-character name still links; a composite alarm links too', () => {
    expect(alarmConsoleHref('us-east-1', 'a'.repeat(255))).not.toBeNull()
    const view = alarmsListView(okAlarms([composite({ name: 'combo' })]), resOk, NOW)
    expect(view.state === 'rows' && view.rows[0].href).toBe(`${BASE}combo`)
  })
})

describe('section states', () => {
  it('loading: never the empty text', () => {
    expect(alarmsListView({ state: 'loading' }, resOk)).toEqual({ state: 'loading', sectionHref: null })
  })

  it('request failed: error, no detail, never empty', () => {
    expect(alarmsListView({ state: 'error', kind: 'failed' }, resOk)).toEqual({ state: 'error', detail: null, sectionHref: null })
    expect(alarmsListView({ state: 'error', kind: 'unavailable' }, resOk).state).toBe('error')
  })

  it.each([
    ['access_denied', "DevControl's role isn't allowed to read alarms."],
    ['throttled', 'AWS limited the request rate. Try again shortly.'],
    ['failed', null],
  ])('API error %s: error with its detail and the CloudWatch link for the region', (reason, detail) => {
    expect(alarmsListView(errAlarms(reason), resOk)).toEqual({ state: 'error', detail, sectionHref: 'https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#alarmsV2:' })
  })

  it.each([
    ['not_connected', 'Connect AWS to see CloudWatch alarms.'],
    ['multiple_accounts', 'More than one AWS account is connected, so no alarms are shown yet.'],
  ])('D7 %s: one neutral line; Retry only when resources disagree', (reason, text) => {
    expect(alarmsListView(errAlarms(reason, null), resStatus(reason))).toEqual({ state: 'notice', text, retry: false, sectionHref: null })
    expect(alarmsListView(errAlarms(reason, null), resOk)).toEqual({ state: 'notice', text, retry: true, sectionHref: null })
  })

  it('ok, 0 in ALARM, complete → empty', () => {
    expect(alarmsListView(okAlarms([]), resOk).state).toBe('empty')
  })

  it('ok, 0 in ALARM, incomplete (or the flag missing) → never empty', () => {
    expect(alarmsListView(okAlarms([], { in_alarm_complete: false, truncated: true }), resOk).state).toBe('incomplete_empty')
    expect(alarmsListView(okAlarms([], { in_alarm_complete: null }), resOk).state).toBe('incomplete_empty')
  })

  it('ok without a list → error, never empty', () => {
    expect(alarmsListView(okAlarms([], { in_alarm: null }), resOk).state).toBe('error')
  })

  it('D3: truncated only by the configured count → rows, no partial line', () => {
    const view = alarmsListView(okAlarms([item()], { truncated: true, in_alarm_complete: true, configured_count_complete: false }), resOk, NOW)
    expect(view.state === 'rows' && view.partial).toBeNull()
  })

  it('D3: in_alarm incomplete → "Showing N" with the count received, never a cap or "first"', () => {
    const view = alarmsListView(okAlarms([item({ name: 'a' }), item({ name: 'b' }), item({ name: 'c' })], { truncated: true, in_alarm_complete: false }), resOk, NOW)
    expect(view.state).toBe('rows')
    const partial = view.state === 'rows' ? view.partial : null
    expect(partial).toBe("Showing 3 alarms in ALARM. There may be more; this list isn't complete.")
    expect(partial).not.toMatch(/500|first|latest|recent/i)
    expect(alarmsListView(okAlarms([item()], { in_alarm_complete: false }), resOk, NOW)).toMatchObject({ partial: "Showing 1 alarm in ALARM. There may be more; this list isn't complete." })
  })

  it('rows are sorted and fully worded; an empty name has no link', () => {
    const view = alarmsListView(okAlarms([item({ name: 'older', state_since: '2026-10-29T12:00:00Z' }), composite({ name: 'newer', state_since: '2026-10-29T14:48:00Z' }), item({ name: '', state_since: null })]), resOk, NOW)
    expect(view.state).toBe('rows')
    if (view.state !== 'rows') return
    expect(view.rows.map((r) => r.name)).toEqual(['newer', 'older', null])
    expect(view.rows[2].href).toBeNull()
    expect(view.rows[0]).toMatchObject({ metric: { composite: true, text: null }, resource: null, since: { relative: '12 min ago' } })
  })

  it('the section link needs a console region', () => {
    expect(alarmsListView(okAlarms([], { region: 'cn-north-1' }), resOk).sectionHref).toBeNull()
  })
})
