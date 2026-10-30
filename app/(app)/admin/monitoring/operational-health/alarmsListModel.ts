/**
 * The Active alarms list (O3a), from the alarms answer the tiles already read
 * (GET /api/observability/alarms, one request per cycle in
 * useOperationalHealthData). Pure: no requests, no React. Every cell restates
 * a field the API sent; a missing field is "—", never a guess, and there is no
 * severity (CloudWatch alarms have none, B4).
 *
 * Founder decisions (o3a-step1.md, Oct 30):
 *   order  the API's array order means nothing (page order, metric alarms
 *          before composite ones in each page), so the list is sorted here:
 *          newest state_since first, no time last, then name A–Z
 *          (case-insensitive), then raw name, type and the API index.
 *   D2     a console link per alarm from the region and the encoded name
 *          only; no link when either is unsafe.
 *   D3     the partial-list line keys on in_alarm_complete (truncated also
 *          covers the configured count, which doesn't limit this list). The
 *          API sends no limit, so the line names only the count received.
 *   D4/D5  composite alarms: name only. A metric alarm without a metric name
 *          shows "—" for it, never "metric math".
 *   D7     not connected / several accounts: one neutral line.
 */
import type { AlarmsData, InAlarmItem, ResourcesData, Source } from './observabilityTypes'
import { formatCheckTime, relativeTime } from './operationalHealthModel'
import { ALARMS_COPY, BAND_COMPARISONS, COMPARISON_TEXT, PAGE_COPY, TYPE_NAME, alarmsHref, cloudWatchHref } from './operationalHealthCopy'

// ---------------------------------------------------------------- console links

/** A commercial-partition region code; China, GovCloud and isolated regions use other console hosts. */
const REGION_CODE = /^[a-z]{2}(-[a-z]+)+-\d{1,2}$/
const OTHER_PARTITION = /^(cn-|us-gov-|us-iso|eu-iso)/
/** DescribeAlarms names are 1–255 characters. */
const MAX_ALARM_NAME = 255
const CONTROL_CHARACTER = /[\u0000-\u001F\u007F]/

export function isConsoleRegion(region: string | null | undefined): region is string {
  return typeof region === 'string' && REGION_CODE.test(region) && !OTHER_PARTITION.test(region)
}

/** The alarm's page in the CloudWatch console, or null when the region or name can't make a safe URL. */
export function alarmConsoleHref(region: string | null | undefined, name: string | null | undefined): string | null {
  if (!isConsoleRegion(region)) return null
  if (typeof name !== 'string' || name.length === 0 || name.length > MAX_ALARM_NAME || CONTROL_CHARACTER.test(name)) return null
  let encoded: string
  try {
    encoded = encodeURIComponent(name)
  } catch {
    return null // a lone surrogate
  }
  return `${cloudWatchHref(region)}#alarmsV2:alarm/${encoded}`
}

// ---------------------------------------------------------------- order

const timeOf = (iso: string | null): number | null => {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : t
}

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const TYPE_RANK: Record<InAlarmItem['type'], number> = { metric: 0, composite: 1 }

/** Newest state_since first, no time last, then name A–Z (case-insensitive), raw name, type, API index. */
export function compareAlarms(a: { item: InAlarmItem; index: number }, b: { item: InAlarmItem; index: number }): number {
  const ta = timeOf(a.item.state_since)
  const tb = timeOf(b.item.state_since)
  if (ta !== tb) {
    if (ta === null) return 1
    if (tb === null) return -1
    return tb - ta
  }
  return (
    compareText(a.item.name.toLowerCase(), b.item.name.toLowerCase()) ||
    compareText(a.item.name, b.item.name) ||
    TYPE_RANK[a.item.type] - TYPE_RANK[b.item.type] ||
    a.index - b.index
  )
}

/** A sorted copy; the shared answer is never mutated. */
export function sortAlarms(items: InAlarmItem[]): Array<{ item: InAlarmItem; index: number }> {
  return items.map((item, index) => ({ item, index })).sort(compareAlarms)
}

// ---------------------------------------------------------------- one row

export interface MetricView {
  /** "CPUUtilization > 80"; null → "—". Always null for composite alarms. */
  text: string | null
  namespace: string | null
  composite: boolean
}

const formatThreshold = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 20 })

export function metricView(item: InAlarmItem): MetricView {
  if (item.type === 'composite') return { text: null, namespace: null, composite: true }
  const comparison = item.comparison ? COMPARISON_TEXT[item.comparison] ?? item.comparison : null
  const band = item.comparison !== null && BAND_COMPARISONS.has(item.comparison)
  const threshold = !band && typeof item.threshold === 'number' ? formatThreshold(item.threshold) : null
  const text = item.metric === null && comparison === null && threshold === null ? null : [item.metric ?? PAGE_COPY.unavailable, comparison, threshold].filter((p) => p !== null).join(' ')
  return { text, namespace: item.namespace, composite: false }
}

export function resourceText(item: InAlarmItem): string | null {
  const r = item.resource
  if (!r || !r.id) return null
  return `${r.id} · ${TYPE_NAME[r.type] ?? r.type}`
}

export interface SinceView {
  iso: string
  relative: string
  local: string
}

/** "12 min ago" over "today, 5:12 PM EDT"; null when AWS gave no time or it doesn't parse. */
export function sinceView(iso: string | null, now: Date = new Date()): SinceView | null {
  if (timeOf(iso) === null) return null
  const local = formatCheckTime(iso!, now)
  if (!local) return null
  return { iso: iso!, relative: relativeTime(new Date(iso!), now), local }
}

export interface AlarmRowView {
  key: string
  /** Null when the API sent an empty name. */
  name: string | null
  href: string | null
  metric: MetricView
  resource: string | null
  since: SinceView | null
}

export function alarmRowView(item: InAlarmItem, index: number, region: string, now?: Date): AlarmRowView {
  return {
    key: `${item.type}:${item.name}:${index}`,
    name: item.name || null,
    href: alarmConsoleHref(region, item.name),
    metric: metricView(item),
    resource: resourceText(item),
    since: sinceView(item.state_since, now),
  }
}

// ---------------------------------------------------------------- the section

export type AlarmsListView =
  | { state: 'loading'; sectionHref: null }
  | { state: 'error'; detail: string | null; sectionHref: string | null }
  | { state: 'notice'; text: string; retry: boolean; sectionHref: null }
  | { state: 'empty'; sectionHref: string | null }
  | { state: 'incomplete_empty'; sectionHref: string | null }
  | { state: 'rows'; rows: AlarmRowView[]; partial: string | null; sectionHref: string | null }

/**
 * The section's state, from the same alarms answer as the tile. An error is
 * never an empty list, and "No CloudWatch alarms are in ALARM." needs an ok
 * answer whose list is complete.
 */
export function alarmsListView(alarms: Source<AlarmsData>, resources: Source<ResourcesData>, now?: Date): AlarmsListView {
  if (alarms.state === 'loading') return { state: 'loading', sectionHref: null }
  if (alarms.state === 'error') return { state: 'error', detail: null, sectionHref: null }
  const d = alarms.data
  const sectionHref = isConsoleRegion(d.region) ? alarmsHref(d.region) : null
  if (d.status === 'error') {
    if (d.reason === 'not_connected' || d.reason === 'multiple_accounts') {
      // Retry only when resources disagree (the two requests raced an account change), as the tile.
      const resourcesAgree = resources.state === 'ok' && resources.data.status === d.reason
      return { state: 'notice', text: d.reason === 'not_connected' ? ALARMS_COPY.notConnected : ALARMS_COPY.multipleAccounts, retry: !resourcesAgree, sectionHref: null }
    }
    const detail = d.reason === 'access_denied' ? ALARMS_COPY.accessDenied : d.reason === 'throttled' ? ALARMS_COPY.throttled : null
    return { state: 'error', detail, sectionHref }
  }
  if (!Array.isArray(d.in_alarm)) return { state: 'error', detail: null, sectionHref }
  const complete = d.in_alarm_complete === true
  if (d.in_alarm.length === 0) return complete ? { state: 'empty', sectionHref } : { state: 'incomplete_empty', sectionHref }
  const rows = sortAlarms(d.in_alarm).map(({ item, index }) => alarmRowView(item, index, d.region, now))
  return { state: 'rows', rows, partial: complete ? null : ALARMS_COPY.partial(d.in_alarm.length), sectionHref }
}
