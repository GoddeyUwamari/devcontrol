/**
 * The Resource checks table (O2), from the resources response as the backend
 * sent it (GET /api/observability/resources?table=1). Pure: no requests, no
 * React. The order, search, filters, counts and paging are the server's; this
 * only words each row and picks the table's state. A status is never inferred:
 * every label and reason restates check_status, unknown_reason, status_detail
 * or telemetry, and a key metric is shown only when the row carries it.
 *
 * Founder decisions (o2-step1.md, Oct 29):
 *   D1  order: failing, needs attention, no telemetry, unknown, passing, not
 *       enough traffic / no activity, stopped, outside region / account, not
 *       measured (server-side, before paging).
 *   D3  "Needs attention" filter = failing + needs attention.
 *   D5  only API fields in Key metric, with their statistic/window labels.
 *   D7  no Core service badge. D8 no row link.
 */
import type { ObservabilityMetric, ObservabilityRow, ResourcesData, ResourcesOk, Source, TableBlock, TableQuery } from './observabilityTypes'
import { formatCheckTime, type Tone } from './operationalHealthModel'
import { KEY_METRICS, ROW_REASON, ROW_STATUS, TABLE_COPY, TYPE_LABEL, TYPE_NAME, TYPE_ORDER } from './operationalHealthCopy'

export const FIRST_PAGE: TableQuery = { q: '', filter: 'all', page: 1 }

// ---------------------------------------------------------------- one row

export interface StatusView {
  label: string
  reason: string | null
  tone: Tone
}

/** Label, reason line and tone for a row. `range` and `region` are the response's own. */
export function statusView(row: ObservabilityRow, range: string, region: string): StatusView {
  const detail = row.status_detail
  switch (row.check_status) {
    case 'failing':
      return { label: ROW_STATUS.failing, reason: detail ? ROW_REASON.status(detail) : null, tone: 'danger' }
    case 'needs_attention':
      return { label: ROW_STATUS.needs_attention, reason: detail ? ROW_REASON.status(detail) : null, tone: 'warning' }
    case 'passing':
      return { label: ROW_STATUS.passing, reason: null, tone: 'success' }
    case 'stopped':
      return { label: ROW_STATUS.stopped, reason: detail ? `${ROW_REASON.stopped} · ${ROW_REASON.status(detail)}` : ROW_REASON.stopped, tone: 'neutral' }
    case 'not_measured':
      return { label: ROW_STATUS.not_measured, reason: ROW_REASON.notMeasured, tone: 'neutral' }
    case 'unknown':
      switch (row.unknown_reason) {
        case 'no_telemetry':
          return {
            label: ROW_STATUS.no_telemetry,
            // RDS (R3): one required metric empty while the others reported.
            reason: row.telemetry === 'reporting' ? ROW_REASON.requiredMetricEmpty(range) : ROW_REASON.noTelemetry(range),
            tone: 'warning',
          }
        case 'access_denied':
        case 'throttled':
        case 'query_failed':
          return { label: ROW_STATUS.unknown, reason: ROW_REASON[row.unknown_reason], tone: 'warning' }
        case 'not_supported':
          return { label: ROW_STATUS.unknown, reason: detail ? ROW_REASON.notSupportedIn(detail) : ROW_REASON.notSupported, tone: 'warning' }
        case 'not_enough_traffic':
          return { label: ROW_STATUS.not_enough_traffic, reason: ROW_REASON.notEnoughTraffic(range), tone: 'neutral' }
        case 'no_activity':
          return {
            label: ROW_STATUS.no_activity,
            reason:
              row.resource_type === 'lambda'
                ? ROW_REASON.noInvocations(range)
                : row.resource_type === 'load-balancer'
                  ? ROW_REASON.noRequests(range)
                  : ROW_REASON.noActivity(range),
            tone: 'neutral',
          }
        case 'outside_region':
          return { label: ROW_STATUS.unknown, reason: ROW_REASON.outsideRegion(row.region, region), tone: 'neutral' }
        case 'outside_account':
          return { label: ROW_STATUS.unknown, reason: ROW_REASON.outsideAccount, tone: 'neutral' }
      }
  }
  // A pair this page doesn't know (unreachable with today's contract): never a guess.
  return { label: ROW_STATUS.unknown, reason: ROW_REASON.unrecognised, tone: 'warning' }
}

const formatValue = (m: ObservabilityMetric) => {
  const value = m.value.toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (!m.unit) return value
  return m.unit.startsWith('%') ? `${value}${m.unit}` : `${value} ${m.unit}`
}

/** "(1h average)", "(1h sum)", "(current)"; a value with no statistic over the range is "(1h)". */
export function metricWindow(m: ObservabilityMetric): string {
  if (m.window === 'current') return '(current)'
  return m.statistic ? `(${m.window} ${m.statistic.toLowerCase()})` : `(${m.window})`
}

const find = (row: ObservabilityRow, label: string, unit?: string) =>
  row.metrics.find((m) => m.label === label && (unit === undefined || m.unit === unit))

/** The type's key metrics that the row carries, joined; null when it carries none of them. */
export function keyMetricText(row: ObservabilityRow): string | null {
  const parts: string[] = []
  for (const def of KEY_METRICS[row.resource_type] ?? []) {
    let metric: ObservabilityMetric | undefined
    let name: string
    if ('first' in def) {
      const hit = def.first.map((d) => ({ d, m: find(row, d.label) })).find((x) => x.m)
      if (!hit) continue
      metric = hit.m
      name = hit.d.name
    } else {
      metric = find(row, def.label, def.unit)
      name = def.name
      if (metric && def.positive && metric.value <= 0) continue
    }
    if (metric) parts.push(`${name} ${formatValue(metric)} ${metricWindow(metric)}`)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

export interface LastSeenView {
  iso: string
  relative: string
  local: string
  /** Last datapoint (CloudWatch) or last status check (point-in-time types), decision D6. */
  title: string
}

/** "3 min ago" over "today, 5:12 PM EDT"; null when never seen. */
export function lastSeenView(iso: string | null, source: ObservabilityRow['last_seen_source'], now: Date = new Date()): LastSeenView | null {
  if (!iso) return null
  const local = formatCheckTime(iso, now)
  if (!local) return null
  const seconds = Math.floor((now.getTime() - new Date(iso).getTime()) / 1000)
  const relative =
    seconds < 60
      ? 'just now'
      : seconds < 3600
        ? `${Math.floor(seconds / 60)} min ago`
        : seconds < 86400
          ? `${Math.floor(seconds / 3600)} h ago`
          : `${Math.floor(seconds / 86400)} d ago`
  return { iso, relative, local, title: source === 'observation' ? TABLE_COPY.lastStatusCheck : TABLE_COPY.lastDatapoint }
}

export interface RowView {
  key: string
  name: string
  /** Null when the name is the ID (no name was discovered), so it isn't shown twice. */
  id: string | null
  type: string
  status: StatusView
  metric: string | null
  lastSeen: LastSeenView | null
}

export function rowView(row: ObservabilityRow, index: number, range: string, region: string, now?: Date): RowView {
  return {
    key: `${row.resource_type}:${row.resource_id}:${index}`,
    name: row.name,
    id: row.name === row.resource_id ? null : row.resource_id,
    type: TYPE_NAME[row.resource_type] ?? row.resource_type,
    status: statusView(row, range, region),
    metric: keyMetricText(row),
    lastSeen: lastSeenView(row.last_seen, row.last_seen_source, now),
  }
}

// ---------------------------------------------------------------- the table

export interface FilterButton {
  filter: string
  label: string
  count: number
  pressed: boolean
}

export type TableBody =
  | { kind: 'rows'; rows: RowView[]; footer: string; page: number; pages: number }
  | { kind: 'empty_inventory'; text: string }
  | { kind: 'no_match'; text: string; clearSearch: boolean; showAll: boolean }

export type TableView =
  /** filters: the previous answer's buttons (same range) while another query loads; null on a first load. */
  | { state: 'loading'; filters: FilterButton[] | null }
  | { state: 'error' }
  | { state: 'notice'; text: string }
  | { state: 'ok'; filters: FilterButton[]; captions: string[]; body: TableBody }

const filterLabel = (filter: string) => (filter === 'attention' ? TABLE_COPY.attention : (TYPE_LABEL[filter] ?? filter))

/** All, Needs attention, then each type with matches (the pressed one even at 0). */
export function filterButtons(facets: TableBlock['facets'], pressed: string): FilterButton[] {
  const types = [...TYPE_ORDER, ...Object.keys(facets.types).filter((t) => !TYPE_ORDER.includes(t))]
  return [
    { filter: 'all', label: TABLE_COPY.all, count: facets.all, pressed: pressed === 'all' },
    { filter: 'attention', label: TABLE_COPY.attention, count: facets.attention, pressed: pressed === 'attention' },
    ...types
      .filter((t) => (facets.types[t] ?? 0) > 0 || t === pressed)
      .map((t) => ({ filter: t, label: filterLabel(t), count: facets.types[t] ?? 0, pressed: t === pressed })),
  ]
}

const resources = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'resource' : 'resources'}`

/**
 * The table's state for the resources answer and the table query it answered.
 * Anything but an ok answer carrying a table block for that query is an error,
 * never an empty table. `previous` is the latest answer for the same range
 * (another table query): while the new one loads, its filter buttons stay.
 */
export function tableView(source: Source<ResourcesData>, requested: TableQuery, now?: Date, previous?: Source<ResourcesData>): TableView {
  if (source.state === 'loading') {
    const prev = previous?.state === 'ok' && previous.data.status === 'ok' ? previous.data.table : undefined
    return { state: 'loading', filters: prev ? filterButtons(prev.facets, requested.filter) : null }
  }
  if (source.state === 'error') return { state: 'error' }
  const data = source.data
  if (data.status === 'not_connected') return { state: 'notice', text: TABLE_COPY.notConnected }
  if (data.status === 'multiple_accounts') return { state: 'notice', text: TABLE_COPY.multipleAccounts }
  if (data.status !== 'ok') return { state: 'error' }
  const ok: ResourcesOk = data
  const table = ok.table
  if (!table || table.query.q !== requested.q || table.query.filter !== requested.filter) return { state: 'error' }

  const captions: string[] = []
  if (ok.inventory_capped !== false) captions.push(TABLE_COPY.incomplete)
  if (ok.collection === 'partial') captions.push(TABLE_COPY.partial)
  const filters = filterButtons(table.facets, table.query.filter)

  if (table.facets.all === 0 && !table.query.q) {
    const text = ok.inventory_capped === false ? TABLE_COPY.emptyIn(ok.region) : TABLE_COPY.emptyIncomplete
    return { state: 'ok', filters, captions, body: { kind: 'empty_inventory', text } }
  }
  if (table.total === 0) {
    const q = table.query.q
    const filtered = table.query.filter !== 'all'
    const parts = [q ? `“${q}”` : null, filtered ? `the “${filterLabel(table.query.filter)}” filter` : null].filter(Boolean).join(' and ')
    return { state: 'ok', filters, captions, body: { kind: 'no_match', text: `No resources match ${parts}.`, clearSearch: !!q, showAll: filtered } }
  }

  const first = (table.query.page - 1) * table.query.page_size + 1
  const last = first + table.rows.length - 1
  const shown = first === last ? `${first.toLocaleString()}` : `${first.toLocaleString()}–${last.toLocaleString()}`
  return {
    state: 'ok',
    filters,
    captions,
    body: {
      kind: 'rows',
      rows: table.rows.map((r, i) => rowView(r, i, ok.range, ok.region, now)),
      footer: `Showing ${shown} of ${resources(table.total)} · most urgent first`,
      page: table.query.page,
      pages: table.pages,
    },
  }
}
