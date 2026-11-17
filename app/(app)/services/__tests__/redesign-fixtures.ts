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

/** /stats for the render tests (the PR 3a attention_scope included). */
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
