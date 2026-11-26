/**
 * What the coverage strip and the Resources tile say, from GET
 * /api/services/coverage (multi-region stage M6: the home region, S3 buckets in
 * every region, CloudFront as global). Pure, so every wording rule is tested
 * without rendering.
 *
 * Rules the strip keeps (S1-B review):
 * - Counts are never summed across chips: the home-region count includes S3
 *   buckets stored there. Totals come from coverage.total / regions.
 * - in_last_scan means "in the newest scan's scope". S3 and CloudFront are
 *   claimed as scanned only when that newest scan completed; the API does not
 *   give an older completed scan's scope, so otherwise they are not claimed.
 * - The last scan is the organization's newest job, which can predate a
 *   reconnect: nothing calls it "this account's scan".
 * - A 'running' or 'pending' job started more than an hour ago, or with no start
 *   time, is not in progress: it was abandoned and reads as a failed scan, next
 *   to the last successful scan's time.
 * - No enabled-region count (unknown until multi-region M5) and no IAM claim.
 */
import type { ServicesCoverage } from '@/lib/services/aws-services.service'
import { DELETION_DETECTION_PAUSED_TEXT, DISCOVERY_WARNING_TRUNCATED_INDEX } from '@/components/aws/discovery-warning-notice'

/** A discovery listing stopped at its page limit (backend/src/services/discovery-warnings.ts). */
export const DISCOVERY_WARNING_LISTING_TRUNCATED = 'discovery_listing_truncated'

export const LISTING_TRUNCATED_TEXT = 'Some resource listings were cut off, so removed resources may still be listed until the next full scan.'

/**
 * The scan made no Resource Explorer search in a region: it has no index
 * (resource_explorer_no_index), or no default view the role can use
 * (resource_explorer_no_view). Backend: discovery-warnings.ts (multi-region PR 1).
 */
export const DISCOVERY_WARNING_RESOURCE_EXPLORER_NO_INDEX = 'resource_explorer_no_index'
export const DISCOVERY_WARNING_RESOURCE_EXPLORER_NO_VIEW = 'resource_explorer_no_view'
/**
 * Region-access PR (b): a Resource Explorer call failed in a region whose own listings all
 * completed (backend discovery-warnings.ts): the region is Partial, never "couldn't check".
 */
export const DISCOVERY_WARNING_RESOURCE_EXPLORER_DENIED = 'resource_explorer_denied'
export const DISCOVERY_WARNING_RESOURCE_EXPLORER_THROTTLED = 'resource_explorer_throttled'
export const DISCOVERY_WARNING_RESOURCE_EXPLORER_FAILED = 'resource_explorer_failed'
const RESOURCE_EXPLORER_FAILURE_WARNINGS = [
  DISCOVERY_WARNING_RESOURCE_EXPLORER_DENIED,
  DISCOVERY_WARNING_RESOURCE_EXPLORER_THROTTLED,
  DISCOVERY_WARNING_RESOURCE_EXPLORER_FAILED,
]
/** Every region-scoped Resource Explorer code: no index, no default view, and (PR (b)) a failed call. */
const RESOURCE_EXPLORER_OFF_WARNINGS = [DISCOVERY_WARNING_RESOURCE_EXPLORER_NO_INDEX, DISCOVERY_WARNING_RESOURCE_EXPLORER_NO_VIEW, ...RESOURCE_EXPLORER_FAILURE_WARNINGS]

/** Founder-approved copy (Nov 14) for resource_explorer_no_index; `region` is the home region. */
export function resourceExplorerOffText(region: string): string {
  return `Resource Explorer isn't turned on in ${region}, so some resource types (such as ECS, VPC and DynamoDB) weren't listed. Everything else was checked.`
}

/** Founder-approved copy (Nov 14) for resource_explorer_no_view; `region` is the home region. */
export function resourceExplorerNoViewText(region: string): string {
  return `Resource Explorer has no default view in ${region}, so some resource types (such as ECS, VPC and DynamoDB) weren't listed. Everything else was checked.`
}

/** Founder-approved copy (Nov 25, region-access PR (b)) for resource_explorer_denied; `region` is the region it came from. */
export function resourceExplorerDeniedText(region: string): string {
  return `AWS refused DevControl's access to Resource Explorer in ${region}, so some resource types (such as ECS, VPC and DynamoDB) weren't listed. Everything else was checked.`
}

/** Founder-approved copy (Nov 25, region-access PR (b)) for resource_explorer_failed (a call timeout included). */
export function resourceExplorerFailedText(region: string): string {
  return `Resource Explorer ran into an error in ${region}, so some resource types (such as ECS, VPC and DynamoDB) weren't listed this time. Everything else was checked. The next scan tries again.`
}

/** Founder-approved copy (Nov 25, region-access PR (b), B5 throttling hint) for resource_explorer_throttled. */
export function resourceExplorerThrottledText(region: string): string {
  return `AWS was busy and limited our Resource Explorer requests in ${region}, so some resource types (such as ECS, VPC and DynamoDB) weren't listed this time. Everything else was checked. The next scan tries again.`
}

/** The approved sentence of a failed Resource Explorer call's code, or null for any other code. */
export function resourceExplorerFailureText(code: string | null, region: string): string | null {
  switch (code) {
    case DISCOVERY_WARNING_RESOURCE_EXPLORER_DENIED: return resourceExplorerDeniedText(region)
    case DISCOVERY_WARNING_RESOURCE_EXPLORER_THROTTLED: return resourceExplorerThrottledText(region)
    case DISCOVERY_WARNING_RESOURCE_EXPLORER_FAILED: return resourceExplorerFailedText(region)
    default: return null
  }
}

const KNOWN_WARNINGS = [DISCOVERY_WARNING_TRUNCATED_INDEX, DISCOVERY_WARNING_LISTING_TRUNCATED]

/**
 * Codes the backend records for itself (backend/src/services/discovery-warnings.ts,
 * "Internal: no page renders it"): ignored everywhere on this page, so they never
 * make a scan Partial or add the generic warning line. scan_lease_lost: another
 * scan took over the lease (multi-region M4b). connection_changed: the AWS
 * connection changed while the scan ran (AWS connect PR B); its job row carries
 * the approved interrupted text.
 */
export const INTERNAL_WARNINGS: readonly string[] = ['scan_lease_lost', 'connection_changed']

/** The warnings this page describes: every code except the internal ones. */
export function shownWarnings(codes: readonly string[]): string[] {
  return codes.filter((code) => !INTERNAL_WARNINGS.includes(code))
}

/** A job started longer ago than this is no longer treated as in progress. */
export const STALE_SCAN_MS = 60 * 60 * 1000

type LastScan = ServicesCoverage['last_scan']

export function isScanInProgress(lastScan: LastScan, now: number): boolean {
  if (!lastScan || (lastScan.status !== 'running' && lastScan.status !== 'pending')) return false
  const started = lastScan.started_at ? Date.parse(lastScan.started_at) : NaN
  if (!Number.isFinite(started)) return false
  return now - started < STALE_SCAN_MS
}

export function timeAgo(iso: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

export function formatScanTime(iso: string, now: number): string {
  const at = new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  return `${at} (${timeAgo(iso, now)})`
}

/**
 * Whether the scope fields describe a completed scan: only when the newest scan
 * completed. A running, failed or abandoned newest scan's scope is never claimed.
 */
export function scopeIsCompleted(coverage: ServicesCoverage): boolean {
  return coverage.last_scan?.status === 'completed'
}

/** "S3 buckets in every region" / "CloudFront (global)", for the parts in the last completed scan's scope. */
function scopeParts(coverage: ServicesCoverage, s3: string, cloudfront: string): string[] {
  if (!scopeIsCompleted(coverage)) return []
  const parts: string[] = []
  if (coverage.scope.s3.in_last_scan) parts.push(s3)
  if (coverage.scope.cloudfront.in_last_scan) parts.push(cloudfront)
  return parts
}

function plus(parts: string[]): string {
  return parts.length === 0 ? '' : `, plus ${parts.join(' and ')}`
}

export interface CoverageChip {
  key: string
  state: 'complete' | 'partial' | 'failed' | 'scanning' | 'global' | 'off'
  region: string
  note: string
}

export interface CoverageNote {
  key: string
  tone: 'info' | 'warn'
  title?: string
  body: string
}

export interface CoverageView {
  connected: boolean
  /** Bold headline; null when no account is connected. */
  headline: string | null
  headlineSub: string | null
  lastScan: string | null
  /** The last scan failed: the line is shown in the failed tone. */
  lastScanFailed: boolean
  chips: CoverageChip[]
  notes: CoverageNote[]
}

export const HOME_REGION_ONLY_NOTE = {
  title: 'Only your home region is scanned today.',
  body: "Resources in your other enabled regions don't appear on this page and aren't in any count until multi-region scanning reaches your account.",
}

export const UNKNOWN_WARNING_TEXT = 'The last scan reported a warning that this page cannot describe yet.'

/**
 * The strip's notes from the last scan's warnings (persisted, so they show on
 * every visit) plus warnings from a discovery run in this tab. Known codes have
 * their own copy; any other code gets one generic line.
 *
 * `homeRegion`: the account's home region, which the Resource Explorer sentence
 * names. Without it those two codes are not described, and get the generic line.
 */
export function warningNotes(persisted: readonly string[], inTab: readonly string[], homeRegion?: string | null): CoverageNote[] {
  const codes = new Set(shownWarnings([...persisted, ...inTab]))
  const notes: CoverageNote[] = []
  const known = homeRegion ? [...KNOWN_WARNINGS, ...RESOURCE_EXPLORER_OFF_WARNINGS] : KNOWN_WARNINGS
  if (codes.has(DISCOVERY_WARNING_TRUNCATED_INDEX)) {
    notes.push({ key: 'deletion-paused', tone: 'warn', body: DELETION_DETECTION_PAUSED_TEXT })
  }
  if (codes.has(DISCOVERY_WARNING_LISTING_TRUNCATED)) {
    notes.push({ key: 'listing-truncated', tone: 'warn', body: LISTING_TRUNCATED_TEXT })
  }
  // Each Resource Explorer code its own sentence (both, when a scan reported both).
  if (homeRegion && codes.has(DISCOVERY_WARNING_RESOURCE_EXPLORER_NO_INDEX)) {
    notes.push({ key: 'resource-explorer-off', tone: 'warn', body: resourceExplorerOffText(homeRegion) })
  }
  if (homeRegion && codes.has(DISCOVERY_WARNING_RESOURCE_EXPLORER_NO_VIEW)) {
    notes.push({ key: 'resource-explorer-no-view', tone: 'warn', body: resourceExplorerNoViewText(homeRegion) })
  }
  // Region-access PR (b): a failed Resource Explorer call in the home region, its own sentence.
  for (const code of RESOURCE_EXPLORER_FAILURE_WARNINGS) {
    if (homeRegion && codes.has(code)) notes.push({ key: code.replace(/_/g, '-'), tone: 'warn', body: resourceExplorerFailureText(code, homeRegion)! })
  }
  if ([...codes].some((code) => !known.includes(code))) {
    notes.push({ key: 'unknown-warning', tone: 'warn', body: UNKNOWN_WARNING_TEXT })
  }
  return notes
}

/**
 * The scan warning codes that describe the home region (Nov 21 founder ruling: one home-region state on
 * Connect AWS, Infrastructure and Services). Flag off, the job scanned the home region only, so its codes
 * are the home region's: unchanged. Flagged, last_scan.warnings holds every scanned region's codes in one
 * list (the scanner shares one warnings array across regions), so a Resource Explorer code is the home
 * region's only when its own row carries it (multi_region.regions[home].error_code, RR-M2), as the Services
 * coverage card reads it. Every other code is kept as it is.
 */
export function homeRegionWarnings(coverage: ServicesCoverage, codes: readonly string[]): string[] {
  const mr = coverage.multi_region
  if (!mr) return [...codes]
  const homeCode = mr.regions.find((r) => r.home)?.error_code ?? null
  return codes.filter((code) => !RESOURCE_EXPLORER_OFF_WARNINGS.includes(code) || code === homeCode)
}

/**
 * The home-region chip. Each state means one thing:
 * - scanning: a scan started within the hour is running;
 * - failed: the last scan failed (it may have refreshed part of the inventory),
 *   or was abandoned: a running or pending job older than an hour (what
 *   multi-region M4b's recovery records for those rows);
 * - partial: the last scan finished with any warning, known or not;
 * - complete: the last scan finished with no warning;
 * - off: no scan yet.
 */
function homeChip(
  home: { region: string; count: number }, last: LastScan, inProgress: boolean, lastFailed: boolean, warnings: readonly string[],
  // PR 3d-1 (N1): the shared home-region check; undefined keeps the Phase 1 rule (the Services strip).
  check?: { kind: 'checked' | 'partial' | 'couldnt' | 'not_scanned'; label: string } | null,
): CoverageChip {
  const chip = (state: CoverageChip['state'], note: string): CoverageChip => ({ key: 'home', state, region: home.region, note })
  if (inProgress) return chip('scanning', `${home.count} · home · scan in progress`)
  // PR 3d-2 (3d-1 leftover): with the shared scan state (Connect AWS), failed and abandoned are one state,
  // which Services words "didn't finish" (D3). The Phase 1 strip (no check passed) keeps "last scan failed".
  if (lastFailed) return chip('failed', `${home.count} · home · ${check === undefined ? 'last scan failed' : "last scan didn't finish"}`)
  // The Services card's failure label, e.g. "couldn't check: scan error"; "partial" as the Services card's Partial.
  if (check?.kind === 'couldnt') return chip('failed', `${home.count} · home · ${check.label.charAt(0).toLowerCase()}${check.label.slice(1)}`)
  if (check?.kind === 'partial') return chip('partial', `${home.count} · home · partial`)
  if (last?.status === 'completed') {
    // PR 3d-1 M-1: the home region changed and the new one isn't scanned yet: the Services card's
    // "Not scanned yet" (first letter lower-case, as above), never "complete".
    if (check?.kind === 'not_scanned') return chip('off', `${home.count} · home · ${check.label.charAt(0).toLowerCase()}${check.label.slice(1)}`)
    return warnings.length > 0
      ? chip('partial', `${home.count} · home · partial`)
      : chip('complete', `${home.count} · home · complete`)
  }
  return chip('off', 'home · not scanned')
}

/** A running or pending job that is no longer in progress was abandoned. */
export function isScanAbandoned(lastScan: LastScan, now: number): boolean {
  return !!lastScan && (lastScan.status === 'running' || lastScan.status === 'pending') && !isScanInProgress(lastScan, now)
}

/**
 * `scan` (PR 3d-1, Connect AWS): the shared scan state (servicesTruth scanState). With it, in progress
 * and failed come from that state (the lease and the server's status, no 60-minute rule) and the
 * last-scan line is its text; `scan.home` (servicesTruth homeRegionCheck) decides the home chip after a
 * finished scan, so a home region that couldn't be checked never reads "complete" (founder ruling N1).
 * Without it (the Services page's Phase 1 strip) nothing changes.
 */
export function describeCoverage(
  coverage: ServicesCoverage, now: number, inTabWarnings: readonly string[] = [],
  scan?: { state: 'finished' | 'running' | 'failed' | 'none'; text: string; home?: { kind: 'checked' | 'partial' | 'couldnt' | 'not_scanned'; label: string } | null },
): CoverageView {
  const home = coverage.account.connected ? coverage.scope.home_region : null
  if (!home) {
    return { connected: false, headline: null, headlineSub: null, lastScan: null, lastScanFailed: false, chips: [], notes: warningNotes([], inTabWarnings) }
  }

  const last = coverage.last_scan
  const inProgress = scan ? scan.state === 'running' : isScanInProgress(last, now)
  const lastSuccess = coverage.last_successful_scan_at
  const abandoned = scan ? false : isScanAbandoned(last, now)
  const lastFailed = scan ? scan.state === 'failed' : last?.status === 'failed' || abandoned
  // "scanned" only after a successful scan; S3/CloudFront only from a completed newest scan (scopeParts).
  // PR 3d-1 N12 (founder ruling, Nov 18): with the shared home-region check, the headline says Services'
  // "{home} couldn't be checked" exactly when the home chip below says "couldn't check" (same check, same
  // precedence: not while a scan runs, not after one that didn't finish); the rest is unchanged.
  const homeCouldnt = !inProgress && !lastFailed && scan?.home?.kind === 'couldnt'
  // PR 3d-1 M-1: a home region never scanned (changed since the last successful scan) is never "scanned":
  // the headline takes the existing no-success variants ("{home}: not scanned yet", or "first scan in
  // progress" while the cell below says "scan in progress"). A scan that didn't finish is the 3d-2 case
  // below: with the shared scan state the headline says "{home}: last scan didn't finish", like the cell;
  // only the Phase 1 strip (no shared state) still says "{home}: last scan failed".
  const homeScanned = !!lastSuccess && scan?.home?.kind !== 'not_scanned'
  // PR 3d-2 (founder ruling, Nov 19): with the shared scan state, wherever the home cell says "last scan
  // didn't finish" (a scan that didn't finish, and none running), the headline says
  // "{home}: last scan didn't finish" (the existing "{home}: …" pattern). The Phase 1 strip is unchanged.
  const didntFinish = !!scan && !inProgress && lastFailed
  const headline = didntFinish
    ? `${home.region}: last scan didn't finish`
    : homeScanned
    ? `${home.region} ${homeCouldnt ? "couldn't be checked" : 'scanned'}${plus(scopeParts(coverage, 'S3 buckets in every region', 'CloudFront (global)'))}`
    : inProgress ? `${home.region}: first scan in progress`
    : lastFailed ? `${home.region}: last scan failed`
    : `${home.region}: not scanned yet`

  let lastScan: string
  if (scan) {
    lastScan = scan.text
  } else if (inProgress) {
    lastScan = `Scan in progress, started ${formatScanTime(last!.started_at!, now)}`
      + (lastSuccess ? ` · last successful scan ${formatScanTime(lastSuccess, now)}` : '')
  } else {
    // An abandoned job has no failure time: only that it failed is said.
    const failedAt = last?.status === 'failed' ? last.completed_at ?? last.started_at : null
    const failed = lastFailed ? `Last scan failed${failedAt ? ` ${formatScanTime(failedAt, now)}` : ''} · ` : ''
    lastScan = failed + (lastSuccess ? `Last successful scan ${formatScanTime(lastSuccess, now)}` : 'No successful scan yet')
  }

  // With the shared scan state (Connect AWS), only the warnings that describe the home region (homeRegionWarnings).
  const warnings = shownWarnings(scan ? homeRegionWarnings(coverage, last?.warnings ?? []) : last?.warnings ?? [])
  const chips: CoverageChip[] = [homeChip(home, last, inProgress, lastFailed, warnings, scan ? scan.home ?? null : undefined)]
  // Stored counts are always shown; the scope (in or not in the last scan) only from a completed one.
  const { cloudfront, s3 } = coverage.scope
  const completed = scopeIsCompleted(coverage)
  if ((completed && cloudfront.in_last_scan) || cloudfront.count > 0) {
    chips.push({ key: 'global', state: 'global', region: 'global', note: `${cloudfront.count} · CloudFront${completed && !cloudfront.in_last_scan ? ' · not in the last scan' : ''}` })
  }
  const s3Elsewhere = s3.regions.filter((r) => r.region !== home.region).reduce((n, r) => n + r.count, 0)
  if ((completed && s3.in_last_scan) || s3Elsewhere > 0) {
    chips.push({ key: 's3', state: 'global', region: 'S3 in other regions', note: `${s3Elsewhere}${completed && !s3.in_last_scan ? ' · not in the last scan' : ''}` })
  }
  chips.push({ key: 'other', state: 'off', region: 'other regions', note: 'not scanned' })

  return {
    connected: true,
    headline,
    headlineSub: '· other regions not scanned yet',
    lastScan,
    lastScanFailed: lastFailed,
    chips,
    notes: [{ key: 'home-only', tone: 'info', ...HOME_REGION_ONLY_NOTE }, ...warningNotes(warnings, inTabWarnings, home.region)],
  }
}

/**
 * Why the inventory counts would be 0 without anything having been found:
 * no AWS account is connected, or the connected one was never scanned. Only
 * when /stats has no resources at all; a stored inventory (from an earlier
 * connection or scan) is still counted as it is. null otherwise, including
 * while coverage is unknown.
 */
export function inventoryGap(coverage: ServicesCoverage | undefined, total: number | undefined): 'no-account' | 'not-scanned' | null {
  if (!coverage || total !== 0) return null
  if (!coverage.account.connected) return 'no-account'
  if (!coverage.last_scan && !coverage.last_successful_scan_at) return 'not-scanned'
  return null
}

/** The Resources tile caption: the scope the count covers. null when not known. */
export function resourcesScopeCaption(coverage: ServicesCoverage | undefined): string | null {
  const home = coverage?.account.connected ? coverage.scope.home_region : null
  if (!coverage || !home) return null
  return `in ${home.region}${plus(scopeParts(coverage, 'S3 in every region', 'CloudFront'))}`
}
