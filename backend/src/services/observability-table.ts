/**
 * O2: the Resource checks table block of GET /api/observability/resources,
 * sent only with table=1 (founder decision D2). Pure: it slices the same
 * snapshot the rest of the response comes from, so rows, totals and filter
 * counts always describe one snapshot. No AWS, no database.
 *
 * Order, sorted before paging (D1):
 *   1 failing  2 needs_attention  3 unknown/no_telemetry  4 every other unknown
 *   5 passing  6 unknown/not_enough_traffic and unknown/no_activity  7 stopped
 *   8 unknown/outside_region and unknown/outside_account  9 not_measured
 * then name A-Z (case-insensitive, then exact), type order, resource id, and the
 * database id, which is unique: a total order, so two rows never swap between
 * requests on the same snapshot.
 *
 * q matches name or resource id (case-insensitive substring). filter is all,
 * attention (failing + needs_attention, D3) or one resource type. facets count
 * the q-matched rows before the filter, so the buttons say how many each filter
 * would show. The page is clamped to the last page (1 when nothing matches).
 */
import { OBSERVABILITY_TYPE_ORDER, ObservabilitySnapshotRow } from './cloudwatch.service'
import type { ObservabilityRow } from './observability-states'

export const TABLE_PAGE_SIZE = 25
export const TABLE_QUERY_MAX_LENGTH = 100

export interface TableQuery {
  q: string
  filter: string
  page: number
}

export interface TableBlock {
  query: TableQuery & { page_size: number; order: 'status' }
  rows: ObservabilityRow[]
  total: number
  pages: number
  facets: { all: number; attention: number; types: Record<string, number> }
}

export class InvalidTableQueryError extends Error {}

/** The table parameters when table=1 was sent; null otherwise (the response is then unchanged). */
export function parseTableQuery(query: Record<string, unknown>): TableQuery | null {
  if (query.table !== '1') return null

  const rawQ = query.q ?? ''
  if (typeof rawQ !== 'string') throw new InvalidTableQueryError('q must be a string')
  const q = rawQ.trim()
  if (q.length > TABLE_QUERY_MAX_LENGTH) throw new InvalidTableQueryError('q is too long')

  const filter = query.filter ?? 'all'
  if (typeof filter !== 'string' || !(filter === 'all' || filter === 'attention' || Object.prototype.hasOwnProperty.call(OBSERVABILITY_TYPE_ORDER, filter))) {
    throw new InvalidTableQueryError('Unknown filter')
  }

  const rawPage = query.page ?? '1'
  if (typeof rawPage !== 'string' || !/^[1-9]\d{0,8}$/.test(rawPage)) throw new InvalidTableQueryError('page must be a positive integer')

  return { q, filter, page: Number(rawPage) }
}

/** The row's place in the table order (D1). */
export function tableGroupOf(row: Pick<ObservabilityRow, 'check_status' | 'unknown_reason'>): number {
  switch (row.check_status) {
    case 'failing':
      return 1
    case 'needs_attention':
      return 2
    case 'passing':
      return 5
    case 'stopped':
      return 7
    case 'not_measured':
      return 9
    default:
      if (row.unknown_reason === 'no_telemetry') return 3
      if (row.unknown_reason === 'not_enough_traffic' || row.unknown_reason === 'no_activity') return 6
      if (row.unknown_reason === 'outside_region' || row.unknown_reason === 'outside_account') return 8
      return 4
  }
}

const isAttention = (row: ObservabilityRow) => row.check_status === 'failing' || row.check_status === 'needs_attention'

const compareStrings = (a: string, b: string) => (a === b ? 0 : a < b ? -1 : 1)

export function compareTableRows(a: ObservabilitySnapshotRow, b: ObservabilitySnapshotRow): number {
  return (
    tableGroupOf(a.row) - tableGroupOf(b.row) ||
    compareStrings(a.row.name.toLowerCase(), b.row.name.toLowerCase()) ||
    compareStrings(a.row.name, b.row.name) ||
    (OBSERVABILITY_TYPE_ORDER[a.row.resource_type] ?? 99) - (OBSERVABILITY_TYPE_ORDER[b.row.resource_type] ?? 99) ||
    compareStrings(a.row.resource_id, b.row.resource_id) ||
    compareStrings(a.dbId, b.dbId)
  )
}

export function tableOf(rows: ObservabilitySnapshotRow[], query: TableQuery): TableBlock {
  const needle = query.q.toLowerCase()
  const matched = needle
    ? rows.filter((r) => r.row.name.toLowerCase().includes(needle) || r.row.resource_id.toLowerCase().includes(needle))
    : rows

  const facets: TableBlock['facets'] = { all: matched.length, attention: 0, types: {} }
  for (const r of matched) {
    if (isAttention(r.row)) facets.attention += 1
    facets.types[r.row.resource_type] = (facets.types[r.row.resource_type] ?? 0) + 1
  }

  const filtered = matched.filter((r) =>
    query.filter === 'all' ? true : query.filter === 'attention' ? isAttention(r.row) : r.row.resource_type === query.filter
  )
  const sorted = [...filtered].sort(compareTableRows)
  const pages = Math.ceil(sorted.length / TABLE_PAGE_SIZE)
  const page = Math.min(query.page, Math.max(pages, 1))
  const start = (page - 1) * TABLE_PAGE_SIZE

  return {
    query: { q: query.q, filter: query.filter, page, page_size: TABLE_PAGE_SIZE, order: 'status' },
    // O3b: a row's table-only metrics (a load balancer's request total) are added here only.
    rows: sorted.slice(start, start + TABLE_PAGE_SIZE).map((r) => (r.tableMetrics ? { ...r.row, metrics: [...r.row.metrics, ...r.tableMetrics] } : r.row)),
    total: sorted.length,
    pages,
    facets,
  }
}
