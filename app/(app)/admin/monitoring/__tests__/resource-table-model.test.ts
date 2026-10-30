/**
 * Resource checks table model (O2): every row state's label, reason and tone
 * (States board B, decisions D1/D4), key metrics only from what the row carries
 * (D5), Last seen, and the table's states (loading, error, notices, empty,
 * no match, rows) from the resources answer. The zone is pinned (UTC) before anything loads.
 */
import { describe, it, expect, vi } from 'vitest'
import type { ObservabilityMetric, ObservabilityRow, ResourcesData, Source, TableBlock } from '../operational-health/observabilityTypes'
import { filterButtons, keyMetricText, lastSeenView, metricWindow, rowView, statusView, tableView, FIRST_PAGE } from '../operational-health/resourceTableModel'

vi.hoisted(() => {
  process.env.TZ = 'UTC'
})

const NOW = new Date('2026-10-29T15:00:00Z')

const row = (over: Partial<ObservabilityRow> = {}): ObservabilityRow => ({
  resource_id: 'i-1234567890abcdef0',
  resource_type: 'ec2',
  name: 'web-1',
  region: 'us-east-1',
  check_status: 'passing',
  unknown_reason: null,
  telemetry: 'reporting',
  activity: null,
  status_detail: null,
  last_seen: null,
  last_seen_source: null,
  metrics: [],
  ...over,
})
const metric = (label: string, value: number, over: Partial<ObservabilityMetric> = {}): ObservabilityMetric => ({ label, value, statistic: 'Average', window: '1h', ...over })

describe('statusView: every state (States board B)', () => {
  const cases: Array<[string, Partial<ObservabilityRow>, string, string | null, string]> = [
    ['failing', { check_status: 'failing' }, 'Failing', null, 'danger'],
    ['failing with RDS status', { resource_type: 'rds', check_status: 'failing', status_detail: 'storage-full' }, 'Failing', 'Status: storage-full', 'danger'],
    ['needs attention', { check_status: 'needs_attention' }, 'Needs attention', null, 'warning'],
    ['RDS transitional', { resource_type: 'rds', check_status: 'needs_attention', status_detail: 'modifying' }, 'Needs attention', 'Status: modifying', 'warning'],
    ['RDS configuring-*', { resource_type: 'rds', check_status: 'needs_attention', status_detail: 'configuring-enhanced-monitoring' }, 'Needs attention', 'Status: configuring-enhanced-monitoring', 'warning'],
    ['no telemetry', { check_status: 'unknown', unknown_reason: 'no_telemetry', telemetry: 'no_telemetry' }, 'No telemetry', 'No telemetry in the last 1h', 'warning'],
    ['RDS required metric empty (R3)', { resource_type: 'rds', check_status: 'unknown', unknown_reason: 'no_telemetry', telemetry: 'reporting' }, 'No telemetry', 'A required metric had no data in the last 1h', 'warning'],
    ['access denied', { check_status: 'unknown', unknown_reason: 'access_denied', telemetry: 'unknown' }, 'Unknown', "Couldn't check: access denied", 'warning'],
    ['throttled', { check_status: 'unknown', unknown_reason: 'throttled', telemetry: 'unknown' }, 'Unknown', "Couldn't check: AWS throttled the request", 'warning'],
    ['query failed', { check_status: 'unknown', unknown_reason: 'query_failed', telemetry: 'unknown' }, 'Unknown', "Couldn't check: the query failed", 'warning'],
    ['not supported, with status', { resource_type: 'rds', check_status: 'unknown', unknown_reason: 'not_supported', status_detail: 'creating' }, 'Unknown', "Can't be judged in status: creating", 'warning'],
    ['not supported', { check_status: 'unknown', unknown_reason: 'not_supported' }, 'Unknown', "This resource can't be evaluated by its check yet", 'warning'],
    ['passing', { check_status: 'passing' }, 'Passing', null, 'success'],
    ['not enough traffic', { resource_type: 'load-balancer', check_status: 'unknown', unknown_reason: 'not_enough_traffic' }, 'Not enough traffic', 'Too few requests in the last 1h to judge the 5xx rate', 'neutral'],
    ['idle Lambda', { resource_type: 'lambda', check_status: 'unknown', unknown_reason: 'no_activity', activity: 'no_activity' }, 'No activity', 'No invocations in the last 1h', 'neutral'],
    ['idle load balancer', { resource_type: 'load-balancer', check_status: 'unknown', unknown_reason: 'no_activity', activity: 'no_activity' }, 'No activity', 'No requests in the last 1h', 'neutral'],
    ['stopped', { check_status: 'stopped' }, 'Stopped', 'Not checked while stopped', 'neutral'],
    ['stopping RDS', { resource_type: 'rds', check_status: 'stopped', status_detail: 'stopping' }, 'Stopped', 'Not checked while stopped · Status: stopping', 'neutral'],
    ['outside region', { check_status: 'unknown', unknown_reason: 'outside_region', region: 'eu-west-1' }, 'Unknown', 'In eu-west-1, outside us-east-1; not checked yet', 'neutral'],
    ['outside region, no region stored', { check_status: 'unknown', unknown_reason: 'outside_region', region: null }, 'Unknown', 'In another region, outside us-east-1; not checked yet', 'neutral'],
    ['outside account', { check_status: 'unknown', unknown_reason: 'outside_account' }, 'Unknown', 'In another AWS account; not checked here', 'neutral'],
    ['not measured', { resource_type: 's3', check_status: 'not_measured' }, 'Not measured yet', 'Listed so you can see it exists; not counted in coverage', 'neutral'],
  ]
  it.each(cases)('%s', (_name, over, label, reason, tone) => {
    expect(statusView(row(over), '1h', 'us-east-1')).toEqual({ label, reason, tone })
  })

  it('the range named is the response’s own', () => {
    expect(statusView(row({ check_status: 'unknown', unknown_reason: 'no_telemetry', telemetry: 'no_telemetry' }), '7d', 'us-east-1').reason).toBe('No telemetry in the last 7d')
  })

  it('a pair the page does not know is "Unknown / Status not recognised", never a guess', () => {
    expect(statusView(row({ check_status: 'bogus' as never }), '1h', 'us-east-1')).toEqual({ label: 'Unknown', reason: 'Status not recognised', tone: 'warning' })
    expect(statusView(row({ check_status: 'unknown', unknown_reason: 'bogus' as never }), '1h', 'us-east-1').reason).toBe('Status not recognised')
  })

  it('no telemetry, unknown, no activity, not enough traffic, stopped and not measured all read differently', () => {
    const texts = [
      row({ check_status: 'unknown', unknown_reason: 'no_telemetry', telemetry: 'no_telemetry' }),
      row({ check_status: 'unknown', unknown_reason: 'query_failed' }),
      row({ resource_type: 'lambda', check_status: 'unknown', unknown_reason: 'no_activity' }),
      row({ resource_type: 'load-balancer', check_status: 'unknown', unknown_reason: 'not_enough_traffic' }),
      row({ check_status: 'stopped' }),
      row({ check_status: 'not_measured' }),
      row({ check_status: 'unknown', unknown_reason: 'outside_region', region: 'eu-west-1' }),
    ].map((r) => JSON.stringify(statusView(r, '1h', 'us-east-1')))
    expect(new Set(texts).size).toBe(texts.length)
  })
})

describe('keyMetricText: only what the row carries (D5)', () => {
  it('statistic and window labels', () => {
    expect(metricWindow(metric('CPU', 3, { statistic: 'Average' }))).toBe('(1h average)')
    expect(metricWindow(metric('Errors', 3, { statistic: 'Sum', window: '24h' }))).toBe('(24h sum)')
    expect(metricWindow(metric('Free storage', 3, { statistic: 'Minimum' }))).toBe('(1h minimum)')
    expect(metricWindow(metric('Replica lag', 3, { statistic: 'Maximum' }))).toBe('(1h maximum)')
    expect(metricWindow(metric('Running', 2, { statistic: null, window: 'current' }))).toBe('(current)')
    expect(metricWindow(metric('Requests/min', 2, { statistic: null }))).toBe('(1h)')
  })

  it('EC2: CPU only; never a status-check result (the API sends none)', () => {
    const text = keyMetricText(row({ metrics: [metric('CPU', 3.1, { unit: '%' })] }))
    expect(text).toBe('CPU 3.1% (1h average)')
    expect(keyMetricText(row({ check_status: 'failing', metrics: [] }))).toBeNull()
  })

  it('load balancer: 5xx rate when sent, else the 5xx count; then response time; never a request count', () => {
    const lb = (metrics: ObservabilityMetric[]) => keyMetricText(row({ resource_type: 'load-balancer', metrics }))
    const latency = metric('Avg latency', 120, { unit: 'ms' })
    const requests = metric('Requests/min', 40, { statistic: 'Sum' })
    expect(lb([metric('5xx errors', 2, { statistic: 'Sum' }), metric('5xx rate', 0.4, { unit: '%', statistic: 'Sum' }), latency, requests])).toBe(
      '5xx 0.4% (1h sum) · Response 120 ms (1h average)'
    )
    expect(lb([metric('5xx errors', 2, { statistic: 'Sum' }), latency, requests])).toBe('5xx errors 2 (1h sum) · Response 120 ms (1h average)')
    expect(lb([requests])).toBeNull()
  })

  it('RDS: CPU and free storage as % of allocated, not GiB; connections are not key metrics', () => {
    const text = keyMetricText(
      row({
        resource_type: 'rds',
        metrics: [
          metric('Connections', 4),
          metric('CPU', 12, { unit: '%' }),
          metric('Free storage', 80.5, { unit: 'GiB', statistic: 'Minimum' }),
          metric('Free storage', 41.2, { unit: '% of allocated', statistic: 'Minimum' }),
        ],
      })
    )
    expect(text).toBe('CPU 12% (1h average) · Free storage 41.2% of allocated (1h minimum)')
  })

  it('Lambda: duration and errors; throttles only above 0; no error %', () => {
    const fn = (throttles: number) =>
      keyMetricText(
        row({
          resource_type: 'lambda',
          metrics: [metric('Avg duration', 85, { unit: 'ms' }), metric('Invocations', 100, { statistic: 'Sum' }), metric('Errors', 2, { statistic: 'Sum' }), metric('Throttles', throttles, { statistic: 'Sum' })],
        })
      )
    expect(fn(0)).toBe('Duration 85 ms (1h average) · Errors 2 (1h sum)')
    expect(fn(3)).toBe('Duration 85 ms (1h average) · Errors 2 (1h sum) · Throttles 3 (1h sum)')
  })

  it.each([
    ['dynamodb', [metric('System errors', 0, { statistic: 'Sum' }), metric('Throttled', 1, { statistic: 'Sum' })], 'System errors 0 (1h sum) · Throttled 1 (1h sum)'],
    ['ecs', [metric('Running', 2, { statistic: null, window: 'current' }), metric('Desired', 2, { statistic: null, window: 'current' }), metric('Pending', 0, { statistic: null, window: 'current' })], 'Running 2 (current) · Desired 2 (current)'],
    ['eks', [metric('Health issues', 0, { statistic: null, window: 'current' })], 'Health issues 0 (current)'],
    ['ebs', [metric('Status check events', 0, { statistic: null, window: 'current' })], 'Status check events 0 (current)'],
    ['cloudfront', [metric('4xx rate', 1.2, { unit: '%' }), metric('5xx rate', 0.1, { unit: '%' })], '5xx 0.1% (1h average) · 4xx 1.2% (1h average)'],
    ['aurora', [metric('CPU', 20, { unit: '%' }), metric('Replica lag', 12, { unit: 'ms', statistic: 'Maximum' })], 'CPU 20% (1h average) · Replica lag 12 ms (1h maximum)'],
    ['s3', [], null],
    ['api-gateway', [], null],
  ] as const)('%s', (type, metrics, expected) => {
    expect(keyMetricText(row({ resource_type: type, metrics: [...metrics] }))).toBe(expected)
  })
})

describe('Last seen and the row', () => {
  it('relative over local time with the zone; null is never seen', () => {
    expect(lastSeenView('2026-10-29T14:57:00Z', 'datapoint', NOW)).toEqual({ iso: '2026-10-29T14:57:00Z', relative: '3 min ago', local: 'today, 2:57 PM UTC', title: 'Last datapoint' })
    expect(lastSeenView('2026-10-29T12:00:00Z', 'observation', NOW)?.title).toBe('Last status check')
    expect(lastSeenView('2026-10-29T12:00:00Z', 'observation', NOW)?.relative).toBe('3 h ago')
    expect(lastSeenView('2026-10-27T15:00:00Z', 'datapoint', NOW)?.relative).toBe('2 d ago')
    expect(lastSeenView('2026-10-29T14:59:30Z', 'datapoint', NOW)?.relative).toBe('just now')
    expect(lastSeenView(null, null, NOW)).toBeNull()
  })

  it('the ID is shown under the name, once when the name is the ID; type is singular', () => {
    expect(rowView(row(), 0, '1h', 'us-east-1', NOW)).toMatchObject({ name: 'web-1', id: 'i-1234567890abcdef0', type: 'EC2' })
    expect(rowView(row({ name: 'i-1234567890abcdef0' }), 0, '1h', 'us-east-1', NOW).id).toBeNull()
    expect(rowView(row({ resource_type: 'load-balancer', resource_id: 'example-alb', name: 'app-alb' }), 0, '1h', 'us-east-1', NOW).type).toBe('Load balancer')
  })

  it('no badge and no link: the row view carries neither (D7, D8)', () => {
    expect(Object.keys(rowView(row(), 0, '1h', 'us-east-1', NOW)).sort()).toEqual(['id', 'key', 'lastSeen', 'metric', 'name', 'status', 'type'])
  })
})

describe('tableView', () => {
  const ZERO = { count: 0, measured: 0, passing: 0, needs_attention: 0, failing: 0, check_unknown: 0, check_failed: 0, neutral: 0, stopped: 0, no_activity: 0, not_enough_traffic: 0, not_measured: 0, outside_scope: 0, reporting: 0, no_telemetry: 0, unknown: 0 }
  const block = (over: Partial<TableBlock> = {}, query: Partial<TableBlock['query']> = {}): TableBlock => ({
    query: { q: '', filter: 'all', page: 1, page_size: 25, order: 'status', ...query },
    rows: [row()],
    total: 1,
    pages: 1,
    facets: { all: 1, attention: 0, types: { ec2: 1 } },
    ...over,
  })
  const ok = (table: TableBlock | undefined, over: Record<string, unknown> = {}): Source<ResourcesData> => ({
    state: 'ok',
    data: {
      status: 'ok', region: 'us-east-1', account_count: 1, multiple_accounts: false, range: '1h', collection: 'complete', checked_at: null,
      captured_at: '2026-10-29T15:00:00Z', inventory_capped: false, inventory_capped_reasons: [], type_breakdown: {}, fleet_summary: ZERO, table, ...over,
    } as ResourcesData,
  })

  it('loading, request error and a failed sweep: never an empty table', () => {
    expect(tableView({ state: 'loading' }, FIRST_PAGE)).toEqual({ state: 'loading', filters: null })
    expect(tableView({ state: 'error', kind: 'failed' }, FIRST_PAGE)).toEqual({ state: 'error' })
    expect(tableView({ state: 'error', kind: 'unavailable' }, FIRST_PAGE)).toEqual({ state: 'error' })
    expect(tableView({ state: 'ok', data: { status: 'failed', reason: 'query_failed', region: null, account_count: 1 } }, FIRST_PAGE)).toEqual({ state: 'error' })
  })

  it('an ok answer without a table, or answering another q or filter, is an error', () => {
    expect(tableView(ok(undefined), FIRST_PAGE)).toEqual({ state: 'error' })
    expect(tableView(ok(block({}, { q: 'web' })), FIRST_PAGE)).toEqual({ state: 'error' })
    expect(tableView(ok(block({}, { filter: 'ec2' })), FIRST_PAGE)).toEqual({ state: 'error' })
  })

  it('not connected and several accounts: one neutral line, as the banner says (D11)', () => {
    expect(tableView({ state: 'ok', data: { status: 'not_connected', region: null, account_count: 0 } }, FIRST_PAGE)).toEqual({ state: 'notice', text: 'Connect AWS to see resource checks.' })
    expect(tableView({ state: 'ok', data: { status: 'multiple_accounts', region: null, account_count: 2 } }, FIRST_PAGE)).toEqual({
      state: 'notice',
      text: 'More than one AWS account is connected, so nothing is shown yet.',
    })
  })

  it('no resources: "No resources found" only when discovery finished (inventory_capped false)', () => {
    const empty = block({ rows: [], total: 0, pages: 0, facets: { all: 0, attention: 0, types: {} } })
    const body = (capped: boolean | null) => {
      const v = tableView(ok(empty, { inventory_capped: capped }), FIRST_PAGE)
      return v.state === 'ok' ? v.body : null
    }
    expect(body(false)).toEqual({ kind: 'empty_inventory', text: 'No resources found in us-east-1.' })
    expect(body(true)).toEqual({ kind: 'empty_inventory', text: "No resources found yet. Discovery didn't finish, so some may be missing." })
    expect(body(null)).toEqual({ kind: 'empty_inventory', text: "No resources found yet. Discovery didn't finish, so some may be missing." })
  })

  it('no match for a search, a filter, or both, with the way back', () => {
    const none = (q: string, filter: string) => {
      const v = tableView(ok(block({ rows: [], total: 0, pages: 0, facets: { all: q ? 0 : 3, attention: 0, types: q ? {} : { ec2: 3 } } }, { q, filter })), { q, filter, page: 1 })
      return v.state === 'ok' ? v.body : null
    }
    expect(none('zzz', 'all')).toEqual({ kind: 'no_match', text: 'No resources match “zzz”.', clearSearch: true, showAll: false })
    expect(none('', 'attention')).toEqual({ kind: 'no_match', text: 'No resources match the “Needs attention” filter.', clearSearch: false, showAll: true })
    expect(none('zzz', 'lambda')).toEqual({ kind: 'no_match', text: 'No resources match “zzz” and the “Lambda” filter.', clearSearch: true, showAll: true })
  })

  it('rows: footer from the server’s page and total; captions for incomplete discovery and partial collection', () => {
    const rows = Array.from({ length: 25 }, (_, i) => row({ name: `r-${i}`, resource_id: `id-${i}` }))
    const v = tableView(ok(block({ rows, total: 57, pages: 3 }, { page: 2 }), { inventory_capped: null, collection: 'partial' }), { q: '', filter: 'all', page: 2 }, NOW)
    expect(v.state).toBe('ok')
    if (v.state !== 'ok' || v.body.kind !== 'rows') throw new Error('rows expected')
    expect(v.body.footer).toBe('Showing 26–50 of 57 resources · most urgent first')
    expect([v.body.page, v.body.pages, v.body.rows.length]).toEqual([2, 3, 25])
    expect(v.captions).toEqual(["This list may be incomplete: discovery didn't finish.", "Some checks didn't complete; those rows say why."])

    const one = tableView(ok(block()), FIRST_PAGE)
    if (one.state !== 'ok' || one.body.kind !== 'rows') throw new Error('rows expected')
    expect(one.body.footer).toBe('Showing 1 of 1 resource · most urgent first')
    expect(one.captions).toEqual([])
  })

  it('while another query loads, the previous answer’s filter buttons stay, with the new filter pressed', () => {
    const v = tableView({ state: 'loading' }, { q: '', filter: 'ec2', page: 1 }, NOW, ok(block()))
    expect(v).toEqual({
      state: 'loading',
      filters: [
        { filter: 'all', label: 'All', count: 1, pressed: false },
        { filter: 'attention', label: 'Needs attention', count: 0, pressed: false },
        { filter: 'ec2', label: 'EC2', count: 1, pressed: true },
      ],
    })
    expect(tableView({ state: 'loading' }, FIRST_PAGE, NOW, { state: 'error', kind: 'failed' })).toEqual({ state: 'loading', filters: null })
  })

  it('a clamped page is shown as the server applied it', () => {
    const v = tableView(ok(block({ total: 26, pages: 2 }, { page: 2 })), { q: '', filter: 'all', page: 5 })
    if (v.state !== 'ok' || v.body.kind !== 'rows') throw new Error('rows expected')
    expect([v.body.page, v.body.footer]).toEqual([2, 'Showing 26 of 26 resources · most urgent first'])
  })

  it('filter buttons: All, Needs attention (even at 0), then types with matches in the page’s type order; the pressed one stays', () => {
    expect(filterButtons({ all: 5, attention: 0, types: { lambda: 2, ec2: 3 } }, 'all')).toEqual([
      { filter: 'all', label: 'All', count: 5, pressed: true },
      { filter: 'attention', label: 'Needs attention', count: 0, pressed: false },
      { filter: 'ec2', label: 'EC2', count: 3, pressed: false },
      { filter: 'lambda', label: 'Lambda', count: 2, pressed: false },
    ])
    expect(filterButtons({ all: 0, attention: 0, types: {} }, 'rds').map((b) => [b.filter, b.count, b.pressed])).toEqual([
      ['all', 0, false],
      ['attention', 0, false],
      ['rds', 0, true],
    ])
    expect(filterButtons({ all: 1, attention: 0, types: { 'new-type': 1 } }, 'all').map((b) => b.label)).toEqual(['All', 'Needs attention', 'new-type'])
  })
})
