/**
 * O2 table block (observability-table.ts): order before paging (D1), the
 * deterministic tiebreaks, search, filters (D3), facets over the searched rows,
 * the page clamp, and the table parameters' validation. Pure: no database.
 */
import {
  compareTableRows,
  InvalidTableQueryError,
  parseTableQuery,
  TABLE_PAGE_SIZE,
  TABLE_QUERY_MAX_LENGTH,
  tableGroupOf,
  tableOf,
} from '../observability-table'
import type { ObservabilitySnapshotRow } from '../cloudwatch.service'
import type { CheckStatus, UnknownReason } from '../observability-states'

let seq = 0
function row(name: string, type: string, check_status: CheckStatus, unknown_reason: UnknownReason | null = null, extra: { id?: string; dbId?: string } = {}): ObservabilitySnapshotRow {
  seq += 1
  return {
    row: {
      resource_id: extra.id ?? `${name}-id`,
      resource_type: type,
      name,
      region: 'us-east-1',
      check_status,
      unknown_reason,
      telemetry: 'unknown',
      activity: null,
      status_detail: null,
      last_seen: null,
      last_seen_source: null,
      metrics: [],
    },
    sortName: name,
    dbId: extra.dbId ?? `00000000-0000-0000-0000-${String(seq).padStart(12, '0')}`,
  }
}

const q = (over: Partial<{ q: string; filter: string; page: number }> = {}) => ({ q: '', filter: 'all', page: 1, ...over })
const names = (rows: Array<{ name: string }>) => rows.map((r) => r.name)

/** One row per state the contract defines, in snapshot (type) order, not table order. */
function everyState(): ObservabilitySnapshotRow[] {
  return [
    row('m-passing', 'ec2', 'passing'),
    row('m-stopped', 'ec2', 'stopped'),
    row('m-denied', 'ec2', 'unknown', 'access_denied'),
    row('m-other-region', 'ec2', 'unknown', 'outside_region'),
    row('m-other-account', 'ec2', 'unknown', 'outside_account'),
    row('m-attention', 'load-balancer', 'needs_attention'),
    row('m-thin', 'load-balancer', 'unknown', 'not_enough_traffic'),
    row('m-nlb', 'load-balancer', 'not_measured'),
    row('m-db-failing', 'rds', 'failing'),
    row('m-no-telemetry', 'rds', 'unknown', 'no_telemetry'),
    row('m-idle', 'lambda', 'unknown', 'no_activity'),
    row('m-throttled', 'dynamodb', 'unknown', 'throttled'),
    row('m-query-failed', 'ecs', 'unknown', 'query_failed'),
    row('m-unsupported', 'eks', 'unknown', 'not_supported'),
    row('m-bucket', 's3', 'not_measured'),
  ]
}

describe('table order (D1)', () => {
  it('(T1) every state lands in its group, groups in the approved order', () => {
    const t = tableOf(everyState(), q())
    expect(t.rows.map((r) => tableGroupOf(r))).toEqual([1, 2, 3, 4, 4, 4, 4, 5, 6, 6, 7, 8, 8, 9, 9])
    expect(names(t.rows)).toEqual([
      'm-db-failing',
      'm-attention',
      'm-no-telemetry',
      'm-denied',
      'm-query-failed',
      'm-throttled',
      'm-unsupported',
      'm-passing',
      'm-idle',
      'm-thin',
      'm-stopped',
      'm-other-account',
      'm-other-region',
      'm-bucket',
      'm-nlb',
    ])
  })

  it('(T2) outside region and outside account come after stopped and before not measured', () => {
    expect(tableGroupOf({ check_status: 'stopped', unknown_reason: null })).toBe(7)
    expect(tableGroupOf({ check_status: 'unknown', unknown_reason: 'outside_region' })).toBe(8)
    expect(tableGroupOf({ check_status: 'unknown', unknown_reason: 'outside_account' })).toBe(8)
    expect(tableGroupOf({ check_status: 'not_measured', unknown_reason: null })).toBe(9)
  })

  it('(T3) no telemetry is its own group, ahead of the other unknowns', () => {
    expect(tableGroupOf({ check_status: 'unknown', unknown_reason: 'no_telemetry' })).toBe(3)
    for (const reason of ['access_denied', 'throttled', 'query_failed', 'not_supported'] as UnknownReason[]) {
      expect(tableGroupOf({ check_status: 'unknown', unknown_reason: reason })).toBe(4)
    }
  })

  it('(T4) A-Z inside a group ignores case; exact name, type, id and database id break ties', () => {
    const rows = [
      row('zeta', 'ec2', 'passing'),
      row('Omega', 'ec2', 'passing'),
      row('Alpha', 'ec2', 'passing'),
      row('alpha', 'ec2', 'passing'),
      row('beta', 'lambda', 'passing'),
      row('beta', 'ec2', 'passing'),
      row('gamma', 'ec2', 'passing', null, { id: 'i-2' }),
      row('gamma', 'ec2', 'passing', null, { id: 'i-1' }),
      row('delta', 'ec2', 'passing', null, { id: 'same', dbId: 'b' }),
      row('delta', 'ec2', 'passing', null, { id: 'same', dbId: 'a' }),
    ]
    const t = tableOf(rows, q())
    expect(t.rows.map((r) => `${r.name}/${r.resource_type}/${r.resource_id}`)).toEqual([
      'Alpha/ec2/Alpha-id',
      'alpha/ec2/alpha-id',
      'beta/ec2/beta-id',
      'beta/lambda/beta-id',
      'delta/ec2/same',
      'delta/ec2/same',
      'gamma/ec2/i-1',
      'gamma/ec2/i-2',
      // Case-sensitive order would put "Omega" before every lower-case name.
      'Omega/ec2/Omega-id',
      'zeta/ec2/zeta-id',
    ])
    // The two "delta" rows differ only by database id: a before b, whatever the input order.
    const reversed = [...rows].reverse()
    expect([...reversed].sort(compareTableRows).map((r) => r.dbId)).toEqual([...rows].sort(compareTableRows).map((r) => r.dbId))
    const deltas = [...rows].sort(compareTableRows).filter((r) => r.row.name === 'delta')
    expect(deltas.map((r) => r.dbId)).toEqual(['a', 'b'])
  })

  it('(T5) the order is sorted before paging: a failing row last in the snapshot is first on page 1', () => {
    const rows = Array.from({ length: 56 }, (_, i) => row(`ok-${String(i).padStart(2, '0')}`, 'ec2', 'passing'))
    rows.push(row('zz-failing', 's3', 'failing'))
    const first = tableOf(rows, q({ page: 1 }))
    expect(first.rows[0].name).toBe('zz-failing')
    expect(first.rows).toHaveLength(TABLE_PAGE_SIZE)
  })
})

describe('paging', () => {
  const fleet = () => Array.from({ length: 57 }, (_, i) => row(`r-${String(i).padStart(2, '0')}`, i % 2 ? 'ec2' : 'lambda', i % 5 === 0 ? 'failing' : 'passing'))

  it('(T6) pages 1-3 of 57: 25/25/7 rows, no row twice, all rows once; repeat calls are identical', () => {
    const rows = fleet()
    const pages = [1, 2, 3].map((page) => tableOf(rows, q({ page })))
    expect(pages.map((p) => p.rows.length)).toEqual([25, 25, 7])
    expect(pages.map((p) => [p.query.page, p.pages, p.total])).toEqual([
      [1, 3, 57],
      [2, 3, 57],
      [3, 3, 57],
    ])
    const seen = pages.flatMap((p) => names(p.rows))
    expect(new Set(seen).size).toBe(57)
    expect(JSON.stringify(tableOf(rows, q({ page: 2 })))).toBe(JSON.stringify(pages[1]))
    expect(JSON.stringify(tableOf([...rows].reverse(), q({ page: 2 })))).toBe(JSON.stringify(pages[1]))
  })

  it('(T7) a page past the end is clamped to the last page; nothing matching is page 1 of 0', () => {
    const t = tableOf(fleet(), q({ page: 9 }))
    expect([t.query.page, t.pages, t.rows.length]).toEqual([3, 3, 7])
    const none = tableOf(fleet(), q({ q: 'no-such-resource', page: 4 }))
    expect([none.query.page, none.pages, none.total, none.rows]).toEqual([1, 0, 0, []])
  })

  it('(T8) the echo carries the page size and the order', () => {
    expect(tableOf(fleet(), q({ q: 'r-1', filter: 'ec2' })).query).toEqual({ q: 'r-1', filter: 'ec2', page: 1, page_size: 25, order: 'status' })
  })
})

describe('search, filters and facets', () => {
  const fleet = () => [
    row('Web-A', 'ec2', 'failing', null, { id: 'i-1234567890abcdef0' }),
    row('web-b', 'ec2', 'passing'),
    row('api', 'lambda', 'needs_attention'),
    row('worker', 'lambda', 'unknown', 'no_telemetry', { id: 'fn-web-worker' }),
    row('logs', 's3', 'not_measured'),
  ]

  it('(T9) q matches name or resource id, case-insensitively', () => {
    expect(names(tableOf(fleet(), q({ q: 'WEB' })).rows)).toEqual(['Web-A', 'worker', 'web-b'])
    expect(names(tableOf(fleet(), q({ q: 'abcdef0' })).rows)).toEqual(['Web-A'])
  })

  it('(T10) attention = failing + needs_attention only (D3); a type filter shows that type only', () => {
    expect(names(tableOf(fleet(), q({ filter: 'attention' })).rows)).toEqual(['Web-A', 'api'])
    expect(names(tableOf(fleet(), q({ filter: 'lambda' })).rows)).toEqual(['api', 'worker'])
    expect(tableOf(fleet(), q({ filter: 'rds' })).total).toBe(0)
  })

  it('(T11) facets count the q-matched rows before the filter', () => {
    const all = tableOf(fleet(), q())
    expect(all.facets).toEqual({ all: 5, attention: 2, types: { ec2: 2, lambda: 2, s3: 1 } })
    const filtered = tableOf(fleet(), q({ filter: 'lambda' }))
    expect(filtered.facets).toEqual(all.facets)
    expect(filtered.total).toBe(2)
    const searched = tableOf(fleet(), q({ q: 'web', filter: 'ec2' }))
    expect(searched.facets).toEqual({ all: 3, attention: 1, types: { ec2: 2, lambda: 1 } })
    expect(searched.total).toBe(2)
  })
})

describe('parseTableQuery', () => {
  it('(T12) null without table=1, so nothing else is read', () => {
    expect(parseTableQuery({})).toBeNull()
    expect(parseTableQuery({ table: '0', q: 'x'.repeat(500), filter: 'bogus', page: '0' })).toBeNull()
    expect(parseTableQuery({ table: 'true' })).toBeNull()
  })

  it('(T13) defaults, trimming and the accepted values', () => {
    expect(parseTableQuery({ table: '1' })).toEqual({ q: '', filter: 'all', page: 1 })
    expect(parseTableQuery({ table: '1', q: '  web  ', filter: 'attention', page: '3' })).toEqual({ q: 'web', filter: 'attention', page: 3 })
    expect(parseTableQuery({ table: '1', filter: 'load-balancer' })?.filter).toBe('load-balancer')
    expect(parseTableQuery({ table: '1', q: 'x'.repeat(TABLE_QUERY_MAX_LENGTH) })?.q).toHaveLength(TABLE_QUERY_MAX_LENGTH)
  })

  it.each([
    ['q too long', { q: 'x'.repeat(TABLE_QUERY_MAX_LENGTH + 1) }],
    ['q repeated', { q: ['a', 'b'] }],
    ['unknown filter', { filter: 'bogus' }],
    ['prototype key as filter', { filter: 'toString' }],
    ['page 0', { page: '0' }],
    ['page 1.5', { page: '1.5' }],
    ['page abc', { page: 'abc' }],
    ['page -1', { page: '-1' }],
    ['page huge', { page: '9999999999' }],
  ])('(T14) %s is rejected', (_label, extra) => {
    expect(() => parseTableQuery({ table: '1', ...extra })).toThrow(InvalidTableQueryError)
  })
})
