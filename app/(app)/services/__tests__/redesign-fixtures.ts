/**
 * Fixtures for the Services redesign tests (PR 3b): the real `multi_region`
 * examples of docs/SERVICES_COVERAGE_MULTI_REGION.md (each one is a recorded
 * route answer, compared with the route by the backend examples test), read
 * from the doc at test time, and small builders on top of them. Synthetic
 * data only.
 */
import * as fs from 'fs'
import * as path from 'path'

const DOC = path.join(process.cwd(), 'docs', 'SERVICES_COVERAGE_MULTI_REGION.md')

/** Every `<!-- example: name -->` block of the doc, parsed. */
export function docExamples(): Record<string, any> {
  const text = fs.readFileSync(DOC, 'utf8')
  const out: Record<string, any> = {}
  for (const m of text.matchAll(/<!-- example: (\w+) -->\n```json\n([\s\S]*?)\n```/g)) out[m[1]] = JSON.parse(m[2])
  return out
}

/** One doc example, deep-copied so a test can change it. */
export function docExample(name: string): any {
  const ex = docExamples()[name]
  if (!ex) throw new Error(`no doc example ${name}`)
  return structuredClone(ex)
}

/** The render tests' clock: the doc examples' day, 4:30 PM UTC (TZ is pinned to UTC). */
export const R_NOW = Date.parse('2026-11-15T16:30:00Z')

/** Every region of an example made fresh (the doc's fixed past instants read stale). */
export function fresh(mr: any): any {
  for (const r of mr.regions) r.stale = false
  return mr
}

/**
 * A flagged organization's whole coverage response around a `multi_region`
 * block: the M5c keys agree with it (home, enabled list, last scans, stored
 * counts per region), CloudFront has `cloudfront` distributions.
 */
export function flaggedCoverage(mrIn: any, o: { cloudfront?: number; s3?: { region: string; count: number }[]; listedAt?: string; lastCompletedAt?: string | null; warnings?: string[] } = {}): any {
  const mr = mrIn
  const home = mr.home_region
  const s = mr.scan
  const lastCompletedAt = o.lastCompletedAt !== undefined ? o.lastCompletedAt
    : s?.status === 'completed' ? s.completed_at : '2026-11-15T04:20:00.000Z'
  const counts = mr.regions.filter((r: any) => (r.resources ?? 0) > 0).map((r: any) => ({ region: r.region, count: r.resources }))
  const cloudfront = o.cloudfront ?? 0
  return {
    account: { connected: true, status: 'active', home_region: home },
    scope: {
      home_region: { region: home, count: mr.regions.find((r: any) => r.home)?.resources ?? 0 },
      s3: { in_last_scan: true, regions: o.s3 ?? [{ region: home, count: 1 }] },
      cloudfront: { in_last_scan: true, count: cloudfront },
      enabled_regions: { known: true, count: mr.regions.length, listed_at: o.listedAt ?? '2026-11-15T10:00:30.000Z', stale: false },
    },
    region_status: mr.regions.map((r: any) => ({ region: r.region, home: r.home, status: r.status, last_scan_finished_at: r.last_scan_finished_at, last_success_at: r.last_success_at, last_error_code: null, consecutive_failures: 0, stale: false })),
    scan_in_progress: mr.coverage_status === 'in_progress' ? { since: s.started_at } : null,
    last_completed_scan: lastCompletedAt ? { started_at: '2026-11-15T04:00:00.000Z', completed_at: lastCompletedAt, resource_types: ['ec2', 's3', 'cloudfront', 'lambda'], warnings: [] } : null,
    last_successful_scan_at: lastCompletedAt,
    last_scan: s ? { status: s.status, started_at: s.started_at, completed_at: s.completed_at, warnings: o.warnings ?? [] } : null,
    resource_types: ['ec2', 's3', 'cloudfront', 'lambda'],
    tags_unknown_by_type: {},
    regions: [...counts, ...(cloudfront > 0 ? [{ region: 'global', count: cloudfront }] : [])],
    total: counts.reduce((n: number, r: any) => n + r.count, 0) + cloudfront,
    multi_region: fresh(mr),
    not_enabled_regions: mr.not_enabled_regions,
  }
}

/** One region row of `multi_region`, checked by the latest scan unless overridden. */
export function mrRegion(region: string, o: Record<string, unknown> = {}): any {
  return {
    region, home: false, opt_in: false, status: 'ok', error_code: null,
    last_scan_finished_at: '2026-11-15T10:03:00.000Z', last_success_at: '2026-11-15T10:03:00.000Z', stale: false,
    result_of: 'latest_scan', scan_state: null, state: 'checked', resources: 1, resources_from: 'last_result', empty: false,
    ...o,
  }
}

/**
 * /stats with fixed numbers, NOT derived from any row set: for the model's
 * unit tests and the deliberately mismatched render control (the Resources
 * tile is /stats total, never the region column summed: N9). Every rendered
 * state takes its /stats from `scanOf()` instead, so its numbers reconcile.
 */
export function redesignStats(o: Record<string, unknown> = {}): any {
  return {
    total: 12, healthy: 9, needs_attention: 3, avg_uptime: null, aws_accounts_connected: 1,
    attention_by_severity: { critical: 1, high: 1, medium: 1, low: 0 },
    ownership: { owned: 7, unowned: 3, unknown: 2 },
    unknown_by_type: { cloudfront: 2 },
    regions: [{ region: 'us-east-1', count: 9 }],
    teams: { top: [{ team: 'platform', count: 5 }, { team: 'data', count: 2 }], all: [{ team: 'platform', count: 5 }, { team: 'data', count: 2 }], total_teams: 2 },
    mapped_to_service: 0,
    attention_scope: { regions: 2, global: 0 },
    ...o,
  }
}

// ── One scan, one row set (pr3b-review F1) ──

/** A resource row as GET /api/services returns it. */
export function resourceRow(id: string, o: Record<string, unknown> = {}): any {
  return {
    id, name: `example-${id}`, type: 'ec2', environment: 'production', region: null, aws_region: 'us-east-1', status: 'healthy', uptime: null,
    owner: 'owner-a@example.com', team: 'platform', monthly_cost: null, last_deployed: null, last_seen_at: '2026-11-15T10:03:00.000Z', metadata: {},
    priority_severity: null, needs_attention: false, reason: null, ownership: 'owned', attention_cause: null, ...o,
  }
}

const ROW_TYPES = ['rds', 'ec2', 'lambda', 'sqs'] as const
const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }

function countBy<T>(items: T[], key: (item: T) => string): [string, number][] {
  const counts = new Map<string, number>()
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1)
  return [...counts]
}

/** One state's answers, all from one row set. */
export interface Scan {
  coverage: any
  stats: any
  /** Every stored resource row. */
  services: any[]
  /** GET /api/services for one request: its filters, the attention order, one page, counts over the filtered set. */
  list: (req?: any) => any
}

/**
 * One scan's whole answer from ONE row set (pr3b-review F1). The stored rows
 * are made from the coverage response's per-region counts (`regions`, which
 * `flaggedCoverage` takes from the `multi_region` rows' non-null resources,
 * earlier results included) and its CloudFront count; then /stats (total,
 * ownership, severities, attention_scope, regions, teams), every list page,
 * and the coverage keys that count rows (`total`, `regions`,
 * `scope.home_region.count`, `scope.s3.regions`, `tags_unknown_by_type`) are
 * derived from those rows. So the Resources tile (/stats total), the All
 * resources list and the region column + CloudFront agree. S3 buckets per
 * region come from the input's `scope.s3.regions` (the last rows of the region).
 *
 * Rows: the first row of the first region is a critical finding, the first row
 * of the second region a medium status issue, the first CloudFront
 * distribution a high finding; every second row of a region is unowned (no
 * Owner or Team tag); CloudFront's tags are unreadable (ownership unknown).
 */
export function scanOf(coverageIn: any): Scan {
  const coverage = structuredClone(coverageIn)
  const s3In = new Map<string, number>((coverage.scope?.s3?.regions ?? []).map((r: any) => [r.region, r.count]))
  const regional = (coverage.regions as { region: string; count: number }[]).filter((r) => r.region !== 'global')
  const services: any[] = []
  regional.forEach(({ region, count }, ri) => {
    const s3 = Math.min(s3In.get(region) ?? 0, count)
    for (let k = 0; k < count; k++) {
      const type = k >= count - s3 ? 's3' : ROW_TYPES[k % ROW_TYPES.length]
      const owned = k % 2 === 0
      const attention = k !== 0 ? null
        : ri === 0 ? { priority_severity: 'critical', reason: 'Publicly accessible database', attention_cause: 'finding', status: 'healthy' }
        : ri === 1 ? { priority_severity: 'medium', reason: 'Resource is stopped or degraded', attention_cause: 'status', status: 'warning' }
        : null
      services.push(resourceRow(`${region}-${k + 1}`, {
        type, aws_region: region,
        status: attention?.status ?? (type === 's3' || type === 'sqs' ? 'unknown' : 'healthy'),
        ownership: owned ? 'owned' : 'unowned',
        owner: owned ? 'owner-a@example.com' : null,
        team: owned ? (services.filter((s) => s.ownership === 'owned').length % 2 === 0 ? 'platform' : 'data') : null,
        ...(attention ? { needs_attention: true, priority_severity: attention.priority_severity, reason: attention.reason, attention_cause: attention.attention_cause } : {}),
      }))
    }
  })
  const cloudfront = coverage.scope?.cloudfront?.count ?? 0
  for (let k = 0; k < cloudfront; k++) {
    services.push(resourceRow(`cdn-${k + 1}`, {
      type: 'cloudfront', aws_region: 'global', status: 'unknown', ownership: 'unknown', owner: null, team: null,
      ...(k === 0 ? { needs_attention: true, priority_severity: 'high', reason: 'Open to the internet', attention_cause: 'finding' } : {}),
    }))
  }

  const attention = services.filter((s) => s.needs_attention)
  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 } as Record<string, number>
  for (const s of attention) bySeverity[s.priority_severity]++
  const ownership = { owned: 0, unowned: 0, unknown: 0 } as Record<string, number>
  for (const s of services) ownership[s.ownership]++
  const unknownByType = Object.fromEntries(countBy(services.filter((s) => s.ownership === 'unknown'), (s) => s.type))
  const byRegion = countBy(services, (s) => s.aws_region).map(([region, count]) => ({ region, count }))
  const teams = countBy(services.filter((s) => s.ownership === 'owned' && s.team), (s) => s.team)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([team, count]) => ({ team, count }))
  const stats = {
    total: services.length,
    healthy: services.length - attention.length,
    needs_attention: attention.length,
    avg_uptime: null,
    aws_accounts_connected: 1,
    attention_by_severity: bySeverity,
    ownership,
    unknown_by_type: unknownByType,
    regions: byRegion,
    teams: { top: teams.slice(0, 3), all: teams, total_teams: teams.length },
    mapped_to_service: 0,
    attention_scope: {
      regions: new Set(attention.filter((s) => s.aws_region !== 'global').map((s) => s.aws_region)).size,
      global: attention.filter((s) => s.aws_region === 'global').length,
    },
  }

  const home = coverage.account?.home_region
  coverage.total = services.length
  coverage.regions = byRegion
  if (coverage.scope?.home_region) coverage.scope.home_region.count = services.filter((s) => s.aws_region === home).length
  if (coverage.scope?.s3) coverage.scope.s3.regions = countBy(services.filter((s) => s.type === 's3'), (s) => s.aws_region).map(([region, count]) => ({ region, count }))
  coverage.tags_unknown_by_type = unknownByType

  const ordered = [...services].sort((a, b) =>
    (a.needs_attention === b.needs_attention ? 0 : a.needs_attention ? -1 : 1)
    || (SEVERITY_RANK[a.priority_severity] ?? 9) - (SEVERITY_RANK[b.priority_severity] ?? 9)
    || a.name.localeCompare(b.name, 'en'))
  function list(req: any = {}) {
    const base = ordered.filter((s) => (!req.ownership || s.ownership === req.ownership) && (!req.type || s.type === req.type) && (!req.region || s.aws_region === req.region))
    const rows = req.needs_attention === undefined ? base : base.filter((s) => s.needs_attention === req.needs_attention)
    const limit = req.limit ?? 50
    const pageNo = req.page ?? 1
    const needs = base.filter((s) => s.needs_attention).length
    return {
      services: rows.slice((pageNo - 1) * limit, pageNo * limit),
      pagination: { page: pageNo, limit, total: rows.length, total_pages: Math.max(1, Math.ceil(rows.length / limit)), has_more: pageNo * limit < rows.length },
      counts: { needs_attention: needs, no_flagged_issues: base.length - needs },
    }
  }
  return { coverage, stats, services, list }
}

// ── The mock tabs' fixtures (states test and screenshots) ──

/** Tab 1: all checked; three regions with resources, two empty, two not enabled, CloudFront global. */
export function tab1(): any {
  const mr = docExample('all_checked')
  const [home, , euWest] = mr.regions
  mr.regions = [home, mrRegion('ap-south-1', { resources: 1 }), mrRegion('eu-north-1', { resources: 0, empty: true }), euWest, mrRegion('sa-east-1', { resources: 0, empty: true })]
  mr.not_enabled_regions = ['af-south-1', 'ap-east-1']
  mr.region_warnings = []
  Object.assign(mr.scan, { regions_total: 5, regions_checked: 5, regions_with_resources: 3, regions_empty: 2, regions_zero_with_warnings: 0 })
  return flaggedCoverage(mr, { cloudfront: 2 })
}

/** Tab 3 as drawn: ap-south-1 throttled with 31 earlier resources, eu-west-1 partial (Resource Explorer). */
export function tab3Throttled(): any {
  const mr = docExample('all_checked')
  mr.coverage_status = 'completed_with_regions_not_checked'
  mr.regions = [
    mr.regions[0],
    mrRegion('ap-south-1', { status: 'timed_out', error_code: 'throttled', state: 'failed', resources: 31, resources_from: 'earlier_success', last_success_at: '2026-11-14T22:12:00.000Z' }),
    mrRegion('eu-west-1', { error_code: 'resource_explorer_no_index', state: 'checked_with_warnings', resources: 96 }),
  ]
  Object.assign(mr.scan, { regions_total: 3, regions_checked: 2, regions_with_resources: 2, regions_empty: 0, regions_zero_with_warnings: 0 })
  return flaggedCoverage(mr, { cloudfront: 3 })
}

/** Tab 5: an unflagged organization (home region only), PR 3a keys. */
export function tab5(homeStatus: 'ok' | 'failed' = 'ok'): any {
  const others = ['ap-south-1', 'eu-west-1', 'us-west-2']
  const done = '2026-11-15T10:20:00.000Z'
  return {
    account: { connected: true, status: 'active', home_region: 'us-east-1' },
    scope: {
      home_region: { region: 'us-east-1', count: 9 },
      s3: { in_last_scan: true, regions: [{ region: 'us-east-1', count: 3 }, { region: 'eu-west-1', count: 2 }, { region: 'us-west-2', count: 1 }] },
      cloudfront: { in_last_scan: true, count: 2 },
      enabled_regions: { known: true, count: 4, listed_at: done, stale: false },
    },
    region_status: [
      { region: 'us-east-1', home: true, status: homeStatus, last_scan_finished_at: done, last_success_at: homeStatus === 'ok' ? done : '2026-11-14T10:20:00.000Z', last_error_code: null, consecutive_failures: 0, stale: false },
      ...others.map((r) => ({ region: r, home: false, status: 'never_scanned', last_scan_finished_at: null, last_success_at: null, last_error_code: null, consecutive_failures: 0, stale: false })),
    ],
    scan_in_progress: null,
    last_completed_scan: { started_at: '2026-11-15T10:00:00.000Z', completed_at: done, resource_types: ['ec2', 's3', 'cloudfront'], warnings: [] },
    last_successful_scan_at: done,
    last_scan: { status: 'completed', started_at: '2026-11-15T10:00:00.000Z', completed_at: done, warnings: [] },
    resource_types: ['ec2', 's3', 'cloudfront'],
    tags_unknown_by_type: {},
    regions: [{ region: 'us-east-1', count: 9 }, { region: 'eu-west-1', count: 2 }, { region: 'us-west-2', count: 1 }, { region: 'global', count: 2 }],
    total: 14,
    not_enabled_regions: ['ap-east-1'],
    home_only_coverage: { regions_total: 4, regions_checked: homeStatus === 'ok' ? 1 : 0 },
  }
}

/** Tab 2: a scan in progress (doc in_progress). */
export function tab2(): any {
  return flaggedCoverage(docExample('in_progress'))
}

/** Tab 3, doc regional_failure: SCP denial, denial with an earlier success, not ready (opt-in). */
export function tab3Regional(): any {
  return flaggedCoverage(docExample('regional_failure'))
}

/** Tab 4: an opt-in region enabled, three not enabled (doc not_enabled). */
export function tab4(): any {
  return flaggedCoverage(docExample('not_enabled'))
}

/** Tab 6: "1 of 1" (doc single_region) with two CloudFront distributions. */
export function tab6(): any {
  return flaggedCoverage(docExample('single_region'), { cloudfront: 2 })
}

/** Tab 7: home region eu-central-1 (doc home_not_us_east_1). */
export function tab7(): any {
  return flaggedCoverage(docExample('home_not_us_east_1'))
}

/** Tab 8: the latest scan failed (doc latest_scan_failed). */
export function tab8(): any {
  return flaggedCoverage(docExample('latest_scan_failed'))
}

/**
 * pr3b-review L-1: the latest scan failed, and ap-south-1 (which that scan
 * never reached) was denied in an EARLIER scan. Its row keeps that older state
 * (`result_of: 'earlier_scan'`), but it is not "not checked on the last scan".
 */
export function tab8EarlierDenied(): any {
  const mr = docExample('latest_scan_failed')
  mr.regions.splice(1, 0, mrRegion('ap-south-1', {
    status: 'denied', error_code: 'access_denied', state: 'denied', result_of: 'earlier_scan',
    resources: 3, resources_from: 'earlier_success', last_scan_finished_at: '2026-11-15T04:03:00.000Z', last_success_at: '2026-11-14T04:00:00.000Z',
  }))
  mr.scan.regions_total = 3
  return flaggedCoverage(mr)
}

/** Tab 13's regions that couldn't be checked: [region, state, error_code]. */
export const TAB13_FAILED: [string, string, string][] = [
  ['ap-east-2', 'denied', 'access_denied'],
  ['ap-south-1', 'denied', 'access_denied_scp'],
  ['ca-central-1', 'failed', 'throttled'],
  ['eu-north-1', 'failed', 'call_timeout'],
  ['eu-south-1', 'failed', 'error'],
  ['eu-west-2', 'not_ready', 'region_not_ready'],
  ['eu-west-3', 'not_checked_deadline', 'region_deadline'],
  ['sa-east-1', 'not_checked_budget', 'scan_budget'],
]
/** Tab 13's partly checked regions: [region, error_code]. */
export const TAB13_PARTIAL: [string, string][] = [
  ['us-east-2', 'resource_explorer_no_view'],
  ['us-west-1', 'discovery_listing_truncated'],
  ['us-west-2', 'deletion_detection_paused_truncated_index'],
]

/** Tab 13: every failure code, three partial codes, and the scan_deadline warning (V2-37). */
export function tab13(): any {
  const mr = docExample('all_checked')
  mr.coverage_status = 'completed_with_regions_not_checked'
  mr.regions = [
    mr.regions[0],
    ...TAB13_FAILED.map(([r, state, code]) => mrRegion(r, { state, error_code: code, status: state === 'failed' || state === 'not_ready' ? 'failed' : state === 'denied' ? 'denied' : 'timed_out', resources: null, resources_from: null, last_success_at: null })),
    ...TAB13_PARTIAL.map(([r, code]) => mrRegion(r, { state: 'checked_with_warnings', error_code: code, status: code.startsWith('resource') ? 'ok' : 'partial', resources: 2 })),
  ].sort((a: any, b: any) => (a.home ? -1 : b.home ? 1 : a.region < b.region ? -1 : 1))
  Object.assign(mr.scan, { regions_total: 12, regions_checked: 4, regions_with_resources: 4, regions_empty: 0, regions_zero_with_warnings: 0 })
  return flaggedCoverage(mr, { warnings: ['scan_deadline'] })
}

/**
 * Every rendered state, by screenshot name: the coverage response each one
 * starts from. Render it through `scanOf()` so /stats and the list agree.
 */
export const STATE_FIXTURES: Record<string, () => any> = {
  't01-all-checked': tab1,
  't02-in-progress': tab2,
  't03-one-failed': tab3Throttled,
  't03b-regional-failure': tab3Regional,
  't04-opt-in': tab4,
  't05-single-region-flag-off': () => tab5(),
  't05b-single-region-home-failed': () => tab5('failed'),
  't06-one-of-one': tab6,
  't07-home-eu-central-1': tab7,
  't08-latest-failed': tab8,
  't08b-earlier-denied': tab8EarlierDenied,
  't13-codes': tab13,
}
