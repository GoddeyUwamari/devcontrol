/**
 * Shared set-up for the M6 page tests: the services the page calls, mocked
 * per test, and coverage responses shaped like production's of Oct 22.
 * vi.mock calls stay in each test file (they are hoisted per file).
 */
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { RegionCoverage, ServicesCoverage } from '@/lib/services/aws-services.service'
import ServicesPage from '../page'

export const OTHER_REGIONS = [
  'ap-northeast-1', 'ap-northeast-2', 'ap-northeast-3', 'ap-south-1', 'ap-southeast-1', 'ap-southeast-2', 'ca-central-1',
  'eu-central-1', 'eu-north-1', 'eu-west-1', 'eu-west-2', 'eu-west-3', 'sa-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
]

export function region(name: string, o: Partial<RegionCoverage> = {}): RegionCoverage {
  return { region: name, home: false, status: 'never_scanned', last_scan_finished_at: null, last_success_at: null, last_error_code: null, consecutive_failures: 0, stale: false, ...o }
}

/** Production's response of Oct 22, with times relative to `now`. */
export function prodCoverage(now: number, homePatch: Partial<RegionCoverage> = {}, o: Partial<ServicesCoverage> = {}, others = OTHER_REGIONS.map((r) => region(r))): ServicesCoverage {
  const at = (h: number) => new Date(now - h * 3600_000).toISOString()
  const done = at(2)
  const home = region('us-east-1', { home: true, status: 'ok', last_scan_finished_at: done, last_success_at: done, ...homePatch })
  return {
    account: { connected: true, status: 'active', home_region: 'us-east-1' },
    scope: {
      home_region: { region: 'us-east-1', count: 9 },
      s3: { in_last_scan: true, regions: [{ region: 'us-east-1', count: 3 }] },
      cloudfront: { in_last_scan: true, count: 0 },
      enabled_regions: { known: true, count: 1 + others.length, listed_at: done, stale: false },
    },
    region_status: [home, ...others],
    scan_in_progress: null,
    last_completed_scan: { started_at: at(2.1), completed_at: done, resource_types: ['ec2', 'ebs', 'rds', 's3', 'lambda', 'cloudfront'], warnings: [] },
    last_successful_scan_at: done,
    last_scan: { status: 'completed', started_at: at(2.1), completed_at: done, warnings: [] },
    resource_types: ['ec2', 'ebs', 'rds', 's3', 'lambda', 'cloudfront'],
    tags_unknown_by_type: {},
    regions: [{ region: 'us-east-1', count: 9 }],
    total: 9,
    ...o,
  }
}

/** The same response as a backend before M5c sends it (Phase 1 keys only). */
export function withoutM5c(c: ServicesCoverage): ServicesCoverage {
  const { region_status, scan_in_progress, last_completed_scan, ...rest } = c
  void region_status; void scan_in_progress; void last_completed_scan
  return { ...rest, scope: { ...rest.scope, enabled_regions: { known: false, count: null } } }
}

export const STATS = {
  total: 9, healthy: 9, needs_attention: 0, avg_uptime: null, aws_accounts_connected: 1,
  attention_by_severity: { critical: 0, high: 0, medium: 0, low: 0 },
  ownership: { owned: 6, unowned: 3, unknown: 0 },
  unknown_by_type: {},
  regions: [{ region: 'us-east-1', count: 9 }],
  teams: { top: [{ team: 'platform', count: 6 }], all: [{ team: 'platform', count: 6 }], total_teams: 1 },
  mapped_to_service: 0,
}

export function emptyPage(limit = 50) {
  return { services: [], pagination: { page: 1, limit, total: 0, total_pages: 0, has_more: false }, counts: { needs_attention: 0, no_flagged_issues: 0 } }
}

export function billed() {
  return {
    spend: { state: 'available', source: 'cost_explorer', provenance: 'actual', asOf: null, coverage: null, reason: null,
      data: { amount: 4321.5, basis: 'billed_month_to_date', lastDayInProgress: true, finishedThrough: '2026-10-21' } },
    monthOverMonth: { state: 'unavailable', source: 'x', provenance: null, asOf: null, coverage: null, reason: null, data: null },
  }
}

export function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><ServicesPage /></QueryClientProvider>)
}

/** React's useId values differ between two separate renders; everything else must not. */
export function normalizeIds(html: string): string {
  return html.replace(/«r[0-9a-z]+»|:r[0-9a-z]+:|_r_[0-9a-z]+_/g, 'ID')
}
