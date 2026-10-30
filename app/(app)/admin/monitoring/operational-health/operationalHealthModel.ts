/**
 * What the Operational Health page shows, from the responses as the backend
 * sent them. Pure: no requests, no React. Nothing is inferred from a missing
 * value: a source that didn't load is "—" with a reason, never 0.
 *
 * Founder decisions (o1-step1.md, Oct 29):
 *   D2  measured = passing + needs attention + failing + check unknown;
 *       neutral (stopped, no activity, not enough traffic) and outside scope
 *       are never measured, never passing and never set a tone.
 *   D3  banner, first match wins: not connected, several accounts, issues
 *       detected, a source failed, telemetry missing, nothing measured,
 *       then green (D2 rule) or, when discovery can't be confirmed complete,
 *       a neutral "can't confirm".
 *   D8  Free plan: types its discovery skips say "Not included in your plan".
 *   D12 "No <type> found" only when inventory_capped is exactly false.
 */
import { PLAN_DISPLAY_NAME } from '@/lib/plan/plan-names'
import type { AlarmsData, Breakdown, PlanInfo, ResourcesData, ResourcesOk, SloState, Source } from './observabilityTypes'
import {
  FREE_DISCOVERED_TYPES,
  MEASURED_BY,
  MONITOR_GROUPS,
  NOT_MEASURED_TYPES,
  PAGE_COPY,
  PAGE_HREF,
  STATE_LABEL,
  TYPE_LABEL,
  TYPE_ORDER,
  TYPE_PLURAL,
  type MonitorRowDef,
} from './operationalHealthCopy'

export type Tone = 'danger' | 'warning' | 'success' | 'neutral'

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`
const n = (v: number) => v.toLocaleString()

/** An ok answer with the OB2.1 fields; an older backend's ok answer (without them) counts as a source that didn't load. */
const resourcesOk = (s: Source<ResourcesData>): ResourcesOk | null =>
  s.state === 'ok' && s.data.status === 'ok' && s.data.fleet_summary && s.data.type_breakdown ? s.data : null
const alarmsOk = (s: Source<AlarmsData>) => (s.state === 'ok' && s.data.status === 'ok' ? s.data : null)

/** "at least N" when the backend says the count is a lower bound. */
const atLeast = (value: number, complete: boolean) => (complete ? n(value) : `at least ${n(value)}`)

// ---------------------------------------------------------------- header

export interface HeaderView {
  pill: { tone: Tone; text: string } | null
  lastCheck: string | null
  incomplete: boolean
  region: string | null
}

/** "today, 5:15 PM EDT", or "Oct 28, 2026, 5:15 PM EDT" on another day; local time with its zone. */
export function formatCheckTime(iso: string, now: Date = new Date()): string | null {
  const at = new Date(iso)
  if (isNaN(at.getTime())) return null
  const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(at)
  const sameDay = at.toDateString() === now.toDateString()
  if (sameDay) return `today, ${time}`
  const day = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(at)
  return `${day}, ${time}`
}

/** "just now", "12 min ago", "3 h ago", "2 d ago". */
export function relativeTime(at: Date, now: Date = new Date()): string {
  const seconds = Math.floor((now.getTime() - at.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`
  return `${Math.floor(seconds / 86400)} d ago`
}

export function regionOf(resources: Source<ResourcesData>, alarms: Source<AlarmsData>): string | null {
  const r = resourcesOk(resources)
  if (r) return r.region
  if (alarms.state === 'ok' && alarms.data.region) return alarms.data.region
  return null
}

export function headerView(resources: Source<ResourcesData>, alarms: Source<AlarmsData>, now?: Date): HeaderView {
  const region = regionOf(resources, alarms)
  if (resources.state === 'loading') return { pill: null, lastCheck: null, incomplete: false, region }
  if (resources.state === 'error') return { pill: { tone: 'warning', text: "Couldn't check" }, lastCheck: null, incomplete: false, region }
  const data = resources.data
  if (data.status === 'ok' && !resourcesOk(resources)) return { pill: { tone: 'warning', text: "Couldn't check" }, lastCheck: null, incomplete: false, region }
  if (data.status === 'not_connected') return { pill: { tone: 'neutral', text: 'AWS not connected' }, lastCheck: null, incomplete: false, region }
  if (data.status === 'multiple_accounts') return { pill: { tone: 'neutral', text: 'More than one AWS account' }, lastCheck: null, incomplete: false, region }
  if (data.status !== 'ok') {
    return {
      pill: data.reason === 'connection_failed' ? { tone: 'danger', text: "Couldn't connect to AWS" } : { tone: 'warning', text: "Couldn't check" },
      lastCheck: null,
      incomplete: false,
      region,
    }
  }
  const at = data.checked_at ? formatCheckTime(data.checked_at, now) : null
  return {
    pill: { tone: 'success', text: 'CloudWatch connected' },
    lastCheck: at ? `Last successful check ${at}` : 'No complete check yet',
    incomplete: data.collection === 'partial',
    region,
  }
}

// ---------------------------------------------------------------- banner

export interface BannerView {
  kind: 'not_connected' | 'multiple_accounts' | 'issues' | 'source_failed' | 'telemetry_missing' | 'nothing_measured' | 'green' | 'unconfirmed'
  tone: Tone
  headline: string
  lines: string[]
  action: { kind: 'retry' } | { kind: 'link'; label: string; href: string } | null
}

function scopeExtras(f: Breakdown): string {
  const parts: string[] = []
  if (f.neutral > 0) parts.push(`${plural(f.neutral, 'stopped or idle resource isn’t', 'stopped or idle resources aren’t')} counted.`)
  if (f.outside_scope > 0) parts.push(`${plural(f.outside_scope, 'resource', 'resources')} outside this account or region ${f.outside_scope === 1 ? 'isn’t' : 'aren’t'} checked.`)
  return parts.join(' ')
}

/** Null while either source is still on its first load. */
export function bannerView(resources: Source<ResourcesData>, alarms: Source<AlarmsData>): BannerView | null {
  if (resources.state === 'loading' || alarms.state === 'loading') return null

  if (resources.state === 'ok' && resources.data.status === 'not_connected') {
    return {
      kind: 'not_connected',
      tone: 'neutral',
      headline: "CloudWatch isn't connected yet",
      lines: ['Connect your AWS account to start health checks.'],
      action: { kind: 'link', label: 'Connect AWS →', href: PAGE_HREF.connectAws },
    }
  }
  if (resources.state === 'ok' && resources.data.status === 'multiple_accounts') {
    return {
      kind: 'multiple_accounts',
      tone: 'neutral',
      headline: 'More than one AWS account is connected.',
      lines: ['This page checks one account, so nothing is shown yet.'],
      action: null,
    }
  }

  const r = resourcesOk(resources)
  const a = alarmsOk(alarms)
  const f = r?.fleet_summary ?? null
  const resourcesFailed = !r
  // Past the not-connected and several-accounts banners, any alarms answer that isn't ok (not_connected and
  // multiple_accounts included: the two requests disagreed), a partial sweep, or an in-ALARM list that didn't
  // complete is a source that didn't fully load (F1).
  const sourceFailed = resourcesFailed || !a || r?.collection === 'partial' || a.in_alarm_complete === false

  // Issues: a known problem beats missing data.
  const attention = f ? f.failing + f.needs_attention : 0
  const firing = a ? a.in_alarm.length : 0
  if (attention > 0 || firing > 0) {
    const parts: string[] = []
    if (f && f.failing > 0) parts.push(`${n(f.failing)} failing`)
    if (f && f.needs_attention > 0) parts.push(`${n(f.needs_attention)} ${f.needs_attention === 1 ? 'needs' : 'need'} attention`)
    if (a && firing > 0) parts.push(`${atLeast(firing, a.in_alarm_complete)} CloudWatch ${firing === 1 && a.in_alarm_complete ? 'alarm' : 'alarms'} in ALARM`)
    const lines = [parts.join(' · ')]
    if (sourceFailed) lines.push("Some checks couldn't load, so there may be more.")
    return {
      kind: 'issues',
      tone: f && f.failing > 0 ? 'danger' : 'warning',
      headline: attention > 0 ? `${plural(attention, 'resource needs', 'resources need')} attention` : `${atLeast(firing, a!.in_alarm_complete)} CloudWatch ${firing === 1 && a!.in_alarm_complete ? 'alarm is' : 'alarms are'} in ALARM`,
      lines,
      action: sourceFailed ? { kind: 'retry' } : null,
    }
  }

  if (sourceFailed) {
    const lines = ['Results below may be incomplete.']
    if (resources.state === 'ok' && resources.data.status === 'failed' && resources.data.reason === 'connection_failed') {
      lines.unshift("DevControl couldn't connect to your AWS account.")
    } else if (resources.state === 'error' && resources.kind === 'unavailable') {
      lines.unshift("DevControl couldn't reach AWS right now.")
    }
    return { kind: 'source_failed', tone: 'warning', headline: "Some checks couldn't load", lines, action: { kind: 'retry' } }
  }

  // From here both sources loaded completely.
  const fleet = f as Breakdown
  if (fleet.measured > 0 && (fleet.reporting < fleet.measured || fleet.check_unknown > 0)) {
    return {
      kind: 'telemetry_missing',
      tone: 'warning',
      headline:
        fleet.reporting < fleet.measured
          ? `${n(fleet.reporting)} of ${n(fleet.measured)} measured resources reporting telemetry`
          : `${plural(fleet.check_unknown, 'measured resource has', 'measured resources have')} no check result`,
      lines: ["Checks can't confirm the others are healthy. They're never counted as passing."],
      action: null,
    }
  }

  if (fleet.measured === 0) {
    return {
      kind: 'nothing_measured',
      tone: 'neutral',
      headline: 'Nothing measured yet',
      lines: [['No resource in this account and region has a check result yet.', scopeExtras(fleet)].filter(Boolean).join(' ')],
      action: null,
    }
  }

  // Every measured resource passes and no alarm is in ALARM. Green only when
  // discovery is known to be complete (inventory_capped exactly false).
  if (r!.inventory_capped !== false) {
    return {
      kind: 'unconfirmed',
      tone: 'neutral',
      headline: "We can't confirm every resource was found",
      lines: [`${n(fleet.passing)} of ${n(fleet.measured)} measured resources are passing, but resource discovery didn't finish or was capped.`],
      action: null,
    }
  }
  return {
    kind: 'green',
    tone: 'success',
    headline: 'No issues detected in measured checks',
    lines: [
      [
        `${n(fleet.passing)} of ${n(fleet.measured)} measured resources are passing, and no CloudWatch alarms are in ALARM.`,
        scopeExtras(fleet),
        'Some resource types and signals aren’t measured yet; see "What we monitor".',
      ]
        .filter(Boolean)
        .join(' '),
    ],
    action: null,
  }
}

// ---------------------------------------------------------------- tiles

export interface Segment {
  key: string
  value: number
  tone: Tone
}

export type CountTile =
  | { state: 'loading' }
  | { state: 'unavailable'; reason: string; retry: boolean }
  | { state: 'none'; note: string | null }
  | { state: 'ok'; value: number; of: number; segments: Segment[]; legend: string; note: string | null }

export type AlarmsTile =
  | { state: 'loading' }
  | { state: 'unavailable'; reason: string; detail: string | null; retry: boolean }
  | { state: 'ok'; inAlarm: string; configured: string; region: string }

export type RegionTile = { state: 'loading' } | { state: 'ok'; region: string } | { state: 'unavailable'; reason: string; retry: boolean }

export interface TilesView {
  checks: CountTile
  telemetry: CountTile
  alarms: AlarmsTile
  region: RegionTile
}

const notMeasuredText = (f: Breakdown) => `Not measured: ${plural(f.not_measured, 'resource', 'resources')} (not counted)`

function unavailableFor(resources: Source<ResourcesData>): CountTile | null {
  if (resources.state === 'loading') return { state: 'loading' }
  if (resources.state === 'error') return { state: 'unavailable', reason: PAGE_COPY.checksError, retry: true }
  const d = resources.data
  if (d.status === 'not_connected') return { state: 'unavailable', reason: 'AWS isn’t connected.', retry: false }
  if (d.status === 'multiple_accounts') return { state: 'unavailable', reason: 'More than one AWS account is connected.', retry: false }
  if (d.status === 'failed') return { state: 'unavailable', reason: PAGE_COPY.checksError, retry: true }
  return null
}

export function tilesView(resources: Source<ResourcesData>, alarms: Source<AlarmsData>): TilesView {
  const blocked = unavailableFor(resources)
  const f = resourcesOk(resources)?.fleet_summary
  let checks: CountTile
  let telemetry: CountTile
  if (blocked || !f) {
    checks = blocked ?? { state: 'unavailable', reason: PAGE_COPY.checksError, retry: true }
    telemetry = checks
  } else if (f.measured === 0) {
    checks = { state: 'none', note: null }
    telemetry = { state: 'none', note: notMeasuredText(f) }
  } else {
    checks = {
      state: 'ok',
      value: f.passing,
      of: f.measured,
      segments: [
        { key: 'passing', value: f.passing, tone: 'success' },
        { key: 'needs_attention', value: f.needs_attention, tone: 'warning' },
        { key: 'failing', value: f.failing, tone: 'danger' },
        { key: 'check_unknown', value: f.check_unknown, tone: 'neutral' },
      ],
      legend: [`Passing ${n(f.passing)}`, `Needs attention ${n(f.needs_attention)}`, `Failing ${n(f.failing)}`, ...(f.check_unknown > 0 ? [`Can't be checked ${n(f.check_unknown)}`] : [])].join(' · '),
      note: null,
    }
    telemetry = {
      state: 'ok',
      value: f.reporting,
      of: f.measured,
      segments: [
        { key: 'reporting', value: f.reporting, tone: 'success' },
        { key: 'no_telemetry', value: f.no_telemetry, tone: 'warning' },
        { key: 'unknown', value: f.unknown, tone: 'neutral' },
      ],
      legend: `Reporting ${n(f.reporting)} · No telemetry ${n(f.no_telemetry)} · Unknown ${n(f.unknown)}`,
      note: notMeasuredText(f),
    }
  }

  let alarmsTile: AlarmsTile
  if (alarms.state === 'loading') alarmsTile = { state: 'loading' }
  else if (alarms.state === 'error') alarmsTile = { state: 'unavailable', reason: PAGE_COPY.alarmsError, detail: null, retry: true }
  else if (alarms.data.status === 'error') {
    const reason = alarms.data.reason
    // Retry only when resources disagree (the two requests raced an account change, F1).
    const resourcesAgree = resources.state === 'ok' && resources.data.status === reason
    alarmsTile =
      reason === 'not_connected'
        ? { state: 'unavailable', reason: 'AWS isn’t connected.', detail: null, retry: !resourcesAgree }
        : reason === 'multiple_accounts'
          ? { state: 'unavailable', reason: 'More than one AWS account is connected.', detail: null, retry: !resourcesAgree }
          : {
              state: 'unavailable',
              reason: PAGE_COPY.alarmsError,
              detail: reason === 'access_denied' ? "DevControl's role isn't allowed to read alarms." : reason === 'throttled' ? 'AWS limited the request rate. Try again shortly.' : null,
              retry: true,
            }
  } else {
    const d = alarms.data
    alarmsTile = { state: 'ok', inAlarm: atLeast(d.in_alarm.length, d.in_alarm_complete), configured: atLeast(d.configured_count, d.configured_count_complete), region: d.region }
  }

  // F4: no region is "—" with the same reason as the other tiles.
  const regionName = regionOf(resources, alarms)
  const regionTile: RegionTile = regionName
    ? { state: 'ok', region: regionName }
    : resources.state === 'loading'
      ? { state: 'loading' }
      : blocked && blocked.state === 'unavailable'
        ? { state: 'unavailable', reason: blocked.reason, retry: blocked.retry }
        : { state: 'unavailable', reason: PAGE_COPY.checksError, retry: true }

  return { checks, telemetry, alarms: alarmsTile, region: regionTile }
}


// ---------------------------------------------------------------- by resource type

export interface TypeCard {
  type: string
  title: string
  pill: { tone: Tone; text: string }
  detail: string | null
  measuredBy: string | null
}

/** Worst state first: failing, needs attention, can't be checked, passing. Text carries the meaning. */
function typeCard(type: string, b: Breakdown): TypeCard {
  const title = `${TYPE_LABEL[type] ?? type} · ${n(b.count)}`
  const details: string[] = []
  if (b.failing > 0) details.push(`${n(b.failing)} failing`)
  if (b.needs_attention > 0) details.push(`${n(b.needs_attention)} ${b.needs_attention === 1 ? 'needs' : 'need'} attention`)
  if (b.check_unknown > 0) details.push(`${n(b.check_unknown)} can't be checked`)
  if (b.stopped > 0) details.push(`${n(b.stopped)} stopped`)
  if (b.no_activity + b.not_enough_traffic > 0) details.push(`${n(b.no_activity + b.not_enough_traffic)} no activity`)
  if (b.not_measured > 0) details.push(`${n(b.not_measured)} not measured`)
  if (b.outside_scope > 0) details.push(`${n(b.outside_scope)} outside this account or region`)
  const measuredBy = MEASURED_BY[type] ?? null

  if (NOT_MEASURED_TYPES.has(type) || b.not_measured === b.count) {
    return { type, title, pill: { tone: 'neutral', text: STATE_LABEL.not_measured }, detail: null, measuredBy: null }
  }
  if (b.measured === 0) {
    return { type, title, pill: { tone: 'neutral', text: 'None measured' }, detail: details.join(' · ') || null, measuredBy }
  }
  const tone: Tone = b.failing > 0 ? 'danger' : b.needs_attention > 0 ? 'warning' : b.check_unknown > 0 ? 'neutral' : 'success'
  return { type, title, pill: { tone, text: `${n(b.passing)} of ${n(b.measured)} passing` }, detail: details.join(' · ') || null, measuredBy }
}

export function typeCards(resources: Source<ResourcesData>): TypeCard[] | null {
  const r = resourcesOk(resources)
  if (!r) return null
  const types = Object.keys(r.type_breakdown).filter((t) => r.type_breakdown[t].count > 0)
  types.sort((x, y) => (TYPE_ORDER.indexOf(x) + 1 || 99) - (TYPE_ORDER.indexOf(y) + 1 || 99))
  return types.map((t) => typeCard(t, r.type_breakdown[t]))
}

// ---------------------------------------------------------------- what we monitor

export type MonitorState =
  | 'monitored'
  | 'none_found'
  | 'not_measured'
  | 'no_activity'
  | 'couldnt_check'
  | 'none_set'
  | 'not_in_plan'
  | 'checking'
  | 'on_plan'

export interface MonitorRow {
  key: string
  label: string
  state: MonitorState
  stateText: string
  reason: string | null
  link: { label: string; href: string } | null
  retry: 'slo' | 'alarms' | null
}

export interface MonitorGroup {
  title: string
  rows: MonitorRow[]
}

function typeRow(type: string, resources: Source<ResourcesData>, plan: PlanInfo): MonitorRow {
  const key = `type:${type}`
  const signals = MEASURED_BY[type]
  const label = signals ? `${TYPE_LABEL[type]}: ${signals}` : TYPE_LABEL[type]
  const row = (state: MonitorState, stateText: string, reason: string | null = null): MonitorRow => ({ key, label, state, stateText, reason, link: null, retry: null })

  if (NOT_MEASURED_TYPES.has(type)) return row('not_measured', STATE_LABEL.not_measured)
  // F2: a type the Free plan doesn't discover depends on the plan; until it's known, never "No … found".
  if (!FREE_DISCOVERED_TYPES.has(type)) {
    if (plan.status === 'loading') return row('checking', STATE_LABEL.checking)
    if (plan.status === 'error') return row('couldnt_check', STATE_LABEL.couldnt_check, "Your plan couldn't be loaded.")
    if (plan.tier === 'free') return row('not_in_plan', STATE_LABEL.not_in_plan)
  }

  if (resources.state === 'loading') return row('checking', STATE_LABEL.checking)
  const r = resourcesOk(resources)
  if (!r) {
    const reason =
      resources.state === 'ok' && resources.data.status === 'not_connected'
        ? 'AWS isn’t connected.'
        : resources.state === 'ok' && resources.data.status === 'multiple_accounts'
          ? 'More than one AWS account is connected.'
          : "Resource checks couldn't load."
    return row('couldnt_check', STATE_LABEL.couldnt_check, reason)
  }

  const b = r.type_breakdown[type]
  if (!b || b.count === 0) {
    if (r.inventory_capped === false) return row('none_found', STATE_LABEL.none_found(TYPE_PLURAL[type] ?? type))
    return row('couldnt_check', STATE_LABEL.couldnt_check, "Discovery didn't finish, so we can't say none exist.")
  }
  if (b.not_measured === b.count) return row('not_measured', STATE_LABEL.not_measured)
  if (b.measured > 0) {
    // F5: from check results, not telemetry. Couldn't check only when every measured check failed or was denied.
    if (b.check_failed === b.measured) return row('couldnt_check', STATE_LABEL.couldnt_check, 'The checks failed or were denied.')
    if (b.passing + b.needs_attention + b.failing === 0) return row('monitored', STATE_LABEL.monitored, 'No check result yet.')
    return row('monitored', STATE_LABEL.monitored)
  }
  if (b.no_activity + b.not_enough_traffic > 0 && b.stopped === 0) return row('no_activity', STATE_LABEL.no_activity)
  if (b.stopped > 0) return row('monitored', STATE_LABEL.monitored)
  return row('couldnt_check', STATE_LABEL.couldnt_check, 'Found only outside the checked account or region.')
}

function alarmsRow(alarms: Source<AlarmsData>): MonitorRow {
  const base = { key: 'alarms', label: 'CloudWatch alarms', link: null }
  if (alarms.state === 'loading') return { ...base, state: 'checking', stateText: STATE_LABEL.checking, reason: null, retry: null }
  if (alarms.state === 'error') return { ...base, state: 'couldnt_check', stateText: STATE_LABEL.couldnt_check, reason: "Alarms couldn't be read.", retry: 'alarms' }
  const d = alarms.data
  if (d.status === 'error') {
    const reason =
      d.reason === 'not_connected'
        ? 'AWS isn’t connected.'
        : d.reason === 'multiple_accounts'
          ? 'More than one AWS account is connected.'
          : d.reason === 'access_denied'
            ? "DevControl's role isn't allowed to read alarms."
            : d.reason === 'throttled'
              ? 'AWS limited the request rate.'
              : "Alarms couldn't be read."
    const retry = d.reason === 'not_connected' || d.reason === 'multiple_accounts' ? null : ('alarms' as const)
    return { ...base, state: 'couldnt_check', stateText: STATE_LABEL.couldnt_check, reason, retry }
  }
  if (d.configured_count === 0 && d.configured_count_complete) return { ...base, state: 'none_set', stateText: STATE_LABEL.none_set, reason: null, retry: null }
  return { ...base, state: 'monitored', stateText: STATE_LABEL.monitored, reason: null, retry: null }
}

export function sloRow(slo: SloState, seePlans: { label: string; href: string }): MonitorRow {
  const base = { key: 'slos', label: 'Service level objectives' }
  switch (slo.state) {
    case 'loading':
      return { ...base, state: 'checking', stateText: STATE_LABEL.checking, reason: null, link: null, retry: null }
    case 'plan_required':
      return { ...base, state: 'on_plan', stateText: `On ${PLAN_DISPLAY_NAME.enterprise}`, reason: null, link: { label: `${seePlans.label} →`, href: seePlans.href }, retry: null }
    case 'plan_error':
      return { ...base, state: 'couldnt_check', stateText: STATE_LABEL.couldnt_check, reason: "Your plan couldn't be loaded.", link: null, retry: null }
    case 'none':
      return { ...base, state: 'none_set', stateText: STATE_LABEL.none_set, reason: null, link: { label: PAGE_COPY.setUpSlos, href: PAGE_HREF.sloReport }, retry: null }
    case 'error':
      return { ...base, state: 'couldnt_check', stateText: STATE_LABEL.couldnt_check, reason: "SLOs couldn't be evaluated.", link: null, retry: 'slo' }
    case 'ok': {
      const parts = [`${n(slo.count)} set`, `${n(slo.breached)} at risk`]
      if (slo.unevaluated > 0) parts.push(`${n(slo.unevaluated)} couldn't be evaluated`)
      return { ...base, state: 'monitored', stateText: STATE_LABEL.monitored, reason: parts.join(' · '), link: null, retry: null }
    }
  }
}

function staticNotMeasured(label: string): MonitorRow {
  return { key: `static:${label}`, label, state: 'not_measured', stateText: STATE_LABEL.not_measured, reason: null, link: null, retry: null }
}

export function monitorView(
  resources: Source<ResourcesData>,
  alarms: Source<AlarmsData>,
  slo: SloState,
  plan: PlanInfo,
  seePlans: { label: string; href: string }
): { groups: MonitorGroup[]; planNote: boolean } {
  const rowFor = (def: MonitorRowDef): MonitorRow => {
    switch (def.kind) {
      case 'type':
        return typeRow(def.type, resources, plan)
      case 'static_not_measured':
        return staticNotMeasured(def.label)
      case 'alarms':
        return alarmsRow(alarms)
      case 'slos':
        return sloRow(slo, seePlans)
    }
  }
  return {
    groups: MONITOR_GROUPS.map((g) => ({ title: g.title, rows: g.rows.map(rowFor) })),
    planNote: plan.status === 'known' && plan.tier === 'free',
  }
}

/** The SLO row's state from the plan and the evaluation result (O1 §2.5). */
export function sloStateFor(
  plan: PlanInfo,
  result: { state: 'idle' } | { state: 'loading' } | { state: 'ok'; statuses: string[] } | { state: 'plan_required' } | { state: 'error' }
): SloState {
  if (plan.status === 'loading') return { state: 'loading' }
  if (plan.status === 'error') return { state: 'plan_error' }
  if (plan.tier !== 'enterprise') return { state: 'plan_required' }
  switch (result.state) {
    case 'idle':
    case 'loading':
      return { state: 'loading' }
    case 'plan_required':
      return { state: 'plan_required' }
    case 'error':
      return { state: 'error' }
    case 'ok': {
      if (result.statuses.length === 0) return { state: 'none' }
      const healthy = result.statuses.filter((s) => s === 'healthy').length
      const breached = result.statuses.filter((s) => s === 'breached').length
      return { state: 'ok', count: result.statuses.length, breached, unevaluated: result.statuses.length - healthy - breached }
    }
  }
}
