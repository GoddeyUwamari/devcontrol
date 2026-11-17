/**
 * Fixtures for the Services home-region tests (PR 3c, mock v2.1 tabs 9–12).
 * Every state's coverage goes through `scanOf()` (redesign-fixtures.ts), so its
 * /stats, list and card come from ONE row set (card = rows + CloudFront). The
 * GET /api/aws/accounts bodies follow backend home-region-proposal.ts
 * HomeRegionProposalView exactly (shares as stored: top 5 + other regions =
 * 100%). Placeholder account 111122223333. Synthetic data only.
 */
import type { AwsAccountsAndConnection, HomeRegionPreview, HomeRegionProposalView } from '@/lib/services/aws-accounts.service'
import { scanOf, tab5, type Scan } from './redesign-fixtures'

export const ACCOUNT_ID = '111122223333'
export const PERIOD = { start: '2026-10-17', end: '2026-11-16' }

/** Tab 9: Cost Explorer points clearly to us-west-2 (84%); home us-east-1 had 3%. */
export function proposal(o: Partial<HomeRegionProposalView> = {}): HomeRegionProposalView {
  return {
    state: 'proposed', region: 'us-west-2', period: PERIOD,
    shares: [
      { region: 'us-west-2', share: 84, amount: 1284.1 },
      { region: 'eu-west-1', share: 7.9, amount: 120.33 },
      { region: 'us-east-2', share: 5.1, amount: 78.4 },
      { region: 'us-east-1', share: 3, amount: 45.92 },
    ],
    other_regions: null,
    current: { region: 'us-east-1', share: 3, amount: 45.92 },
    non_region_amount: 12.5,
    ...o,
  }
}

/** Tab 10: split spend (45 / 40 / 15), no region proposed. */
export function split(o: Partial<HomeRegionProposalView> = {}): HomeRegionProposalView {
  return {
    state: 'split', region: null, period: PERIOD,
    shares: [
      { region: 'us-west-2', share: 45, amount: 1215.4 },
      { region: 'us-east-2', share: 40, amount: 1080.36 },
      { region: 'us-east-1', share: 15, amount: 405.13 },
    ],
    other_regions: null,
    current: { region: 'us-east-1', share: 15, amount: 405.13 },
    non_region_amount: null,
    ...o,
  }
}

/** Tab 10, more than 5 regions with spend: "Other regions (2)". */
export function splitSeven(): HomeRegionProposalView {
  return split({
    shares: [
      { region: 'us-west-2', share: 29.6, amount: 1184 },
      { region: 'eu-west-1', share: 27.6, amount: 1104 },
      { region: 'ap-south-1', share: 19.7, amount: 788 },
      { region: 'us-east-2', share: 9.9, amount: 396 },
      { region: 'sa-east-1', share: 5.9, amount: 236 },
    ],
    other_regions: { count: 2, share: 7.3, amount: 292 },
    current: { region: 'us-east-1', share: 3.1, amount: 124 },
  })
}

/** A GET /api/aws/accounts answer as the client parses it. */
export function accountsAnswer(o: { proposal?: HomeRegionProposalView | null; canChange?: boolean; previous?: string | null; changedAt?: string | null } = {}): AwsAccountsAndConnection {
  return {
    accounts: [{ id: 1, org_id: 'org-test', account_id: ACCOUNT_ID, role_arn: `arn:aws:iam::${ACCOUNT_ID}:role/DevControlRole`, nickname: null, region: 'us-east-1', connected_at: '2026-11-14T09:00:00.000Z', status: 'active' }],
    connection: 'connected',
    health: null,
    homeRegion: {
      proposal: o.proposal ?? null,
      previousHomeRegion: o.previous ?? null,
      homeRegionChangedAt: o.changedAt ?? null,
      canChangeHomeRegion: o.canChange ?? true,
    },
  }
}

/** Tab 9 / 10 coverage: the unflagged account of tab 5 (home us-east-1). */
export function tab9Coverage(): any {
  return tab5()
}

/** The dialog's base preview: the stored list (not enabled and excluded regions too), by name. */
export function preview(o: { current?: string; multiRegion?: boolean; scanInProgress?: boolean } = {}): HomeRegionPreview {
  const current = o.current ?? 'us-east-1'
  const rows: Array<[string, 'region_not_enabled' | 'region_excluded' | null]> = [
    ['ap-east-1', 'region_not_enabled'], ['ap-northeast-1', null], ['eu-west-1', null], ['me-south-1', 'region_excluded'],
    ['us-east-1', null], ['us-east-2', null], ['us-west-2', null],
  ]
  return {
    current_home_region: current,
    multi_region: o.multiRegion ?? false,
    scan_in_progress: o.scanInProgress ?? false,
    regions: rows.map(([region, refusal]) => ({ region, opt_in_status: refusal === 'region_not_enabled' ? 'not-opted-in' : 'opt-in-not-required', current: region === current, refusal })),
  }
}

/** The preview for one target region. */
export function previewFor(region: string, o: { costLeaving?: number; kept?: number | null; refusal?: string | null; multiRegion?: boolean } = {}): HomeRegionPreview {
  const base = preview({ multiRegion: o.multiRegion })
  return {
    ...base,
    target: {
      region,
      refusal: o.refusal ?? null,
      cost_findings_leaving: { total: o.costLeaving ?? 3, by_issue: o.costLeaving === 0 ? {} : { ec2_idle_instance: o.costLeaving ?? 3 } },
      resources_kept_in_old_region: o.kept === undefined ? (o.multiRegion ? null : 4) : o.kept,
    },
  }
}

export const CHANGED_AT = '2026-11-14T09:30:00.000Z'
const OLD_SEEN = '2026-11-14T09:02:00.000Z'

/**
 * Tab 12: an unflagged organization whose home region moved from us-east-1 to
 * us-west-2. us-east-1 keeps 6 stored rows: 2 S3 buckets (still checked on
 * every scan) + 4 from earlier scans (previous_home_region_resources = 4, the
 * same rows). us-west-2 has 5 (1 S3), eu-west-1 1 S3 bucket (not scanned yet),
 * CloudFront 2. The former home's region_status row keeps its old `ok`.
 */
export function tab12Coverage(): any {
  const done = '2026-11-15T10:20:00.000Z'
  return {
    account: { connected: true, status: 'active', home_region: 'us-west-2', previous_home_region: 'us-east-1', home_region_changed_at: CHANGED_AT, previous_home_region_resources: 4 },
    scope: {
      home_region: { region: 'us-west-2', count: 5 },
      s3: { in_last_scan: true, regions: [{ region: 'us-east-1', count: 2 }, { region: 'us-west-2', count: 1 }, { region: 'eu-west-1', count: 1 }] },
      cloudfront: { in_last_scan: true, count: 2 },
      enabled_regions: { known: true, count: 4, listed_at: done, stale: false },
    },
    region_status: [
      { region: 'us-west-2', home: true, status: 'ok', last_scan_finished_at: done, last_success_at: done, last_error_code: null, consecutive_failures: 0, stale: false },
      { region: 'ap-south-1', home: false, status: 'never_scanned', last_scan_finished_at: null, last_success_at: null, last_error_code: null, consecutive_failures: 0, stale: false },
      { region: 'eu-west-1', home: false, status: 'never_scanned', last_scan_finished_at: null, last_success_at: null, last_error_code: null, consecutive_failures: 0, stale: false },
      { region: 'us-east-1', home: false, status: 'ok', last_scan_finished_at: OLD_SEEN, last_success_at: OLD_SEEN, last_error_code: null, consecutive_failures: 0, stale: false },
    ],
    scan_in_progress: null,
    last_completed_scan: { started_at: '2026-11-15T10:00:00.000Z', completed_at: done, resource_types: ['ec2', 's3', 'cloudfront'], warnings: [] },
    last_successful_scan_at: done,
    last_scan: { status: 'completed', started_at: '2026-11-15T10:00:00.000Z', completed_at: done, warnings: [] },
    resource_types: ['ec2', 's3', 'cloudfront'],
    tags_unknown_by_type: {},
    // Region order decides scanOf's attention rows: us-east-1's first row has the critical finding (HR-S19).
    regions: [{ region: 'us-east-1', count: 6 }, { region: 'us-west-2', count: 5 }, { region: 'eu-west-1', count: 1 }, { region: 'global', count: 2 }],
    total: 14,
    not_enabled_regions: ['ap-east-1'],
    home_only_coverage: { regions_total: 4, regions_checked: 1 },
  }
}

/** Tab 12 through scanOf, with the former home's non-S3 rows last seen before the change. */
export function tab12Scan(): Scan {
  const scan = scanOf(tab12Coverage())
  for (const s of scan.services) if (s.aws_region === 'us-east-1' && s.type !== 's3') s.last_seen_at = OLD_SEEN
  return scan
}
