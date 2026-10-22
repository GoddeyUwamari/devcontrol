/**
 * The region coverage the coverage card and the Region coverage panel show
 * (multi-region M6), from the M5c keys of GET /api/services/coverage. Pure, so
 * every count and wording rule is tested without rendering. Behind
 * NEXT_PUBLIC_SERVICES_COVERAGE_M6 (servicesCoverageM6Flag.ts).
 *
 * describeRegionCoverage returns null when the response lacks the M5c keys (an
 * older backend), has no connected account, or has a region list without
 * exactly one home region; the page then shows the Phase 1 strip
 * (coverage.ts), which this module does not change.
 *
 * Rules (m6-plan.md §2, §14):
 * - "checked" = enabled regions whose latest status is ok, partial, failed,
 *   denied or timed_out; "with gaps" = partial, failed, denied or timed_out.
 *   never_scanned is "not scanned yet": never counted and never described as
 *   empty or healthy. Any other status is in no group.
 * - The denominator is enabled_regions.count, and only when the list is known.
 * - "Out of date" comes only from the API's stale flag; nothing here compares
 *   times. Stale regions still count as checked.
 * - Whether the latest scan worked comes from last_scan and scan_in_progress,
 *   never from a region row (a scan that stops early leaves the row as it was).
 * - consecutive_failures is never shown, and last_error_code only through the
 *   fixed sentences below.
 */
import type { RegionCoverage, ServicesCoverage } from '@/lib/services/aws-services.service'
import { DISCOVERY_WARNING_TRUNCATED_INDEX } from '@/components/aws/discovery-warning-notice'
import { DISCOVERY_WARNING_LISTING_TRUNCATED, shownWarnings, warningNotes } from './coverage'

// ── Counts ──

export const CHECKED_STATUSES: readonly string[] = ['ok', 'partial', 'failed', 'denied', 'timed_out']
export const GAP_STATUSES: readonly string[] = ['partial', 'failed', 'denied', 'timed_out']
export const NOT_SCANNED_YET_STATUSES: readonly string[] = ['never_scanned']

export interface RegionCounts {
  /** enabled_regions.count when the list is known; null otherwise (no "N of M"). */
  enabled: number | null
  /** ok, partial, failed, denied or timed_out (stale ones included). */
  checked: number
  /** partial, failed, denied or timed_out: a subset of checked. */
  withGaps: number
  /** never_scanned. */
  notScannedYet: number
  /** Any other status. Never counted as checked. */
  other: number
}

export function regionCounts(coverage: ServicesCoverage): RegionCounts {
  const { known, count } = coverage.scope.enabled_regions
  const rows = known ? coverage.region_status ?? [] : []
  const counts: RegionCounts = { enabled: known && typeof count === 'number' ? count : null, checked: 0, withGaps: 0, notScannedYet: 0, other: 0 }
  for (const row of rows) {
    if (CHECKED_STATUSES.includes(row.status)) {
      counts.checked += 1
      if (GAP_STATUSES.includes(row.status)) counts.withGaps += 1
    } else if (NOT_SCANNED_YET_STATUSES.includes(row.status)) {
      counts.notScannedYet += 1
    } else {
      counts.other += 1
    }
  }
  return counts
}

/**
 * Whether the response carries the M5c keys this module needs: all of them,
 * and, with a known list, exactly one home region (M5c never makes one up).
 */
export function hasRegionCoverage(coverage: ServicesCoverage): boolean {
  if (!Array.isArray(coverage.region_status)) return false
  if (!('scan_in_progress' in coverage) || !('last_completed_scan' in coverage)) return false
  const { known, count } = coverage.scope.enabled_regions
  if (typeof known !== 'boolean') return false
  if (!known) return true
  return typeof count === 'number' && coverage.region_status.filter((r) => r.home).length === 1
}

/** The latest attempt, from the newest job and the scan lease (M5c §3.3), never from a region row. */
export type LatestAttempt = 'running' | 'unfinished' | 'completed' | 'none'

export function latestAttempt(coverage: ServicesCoverage): LatestAttempt {
  if (coverage.scan_in_progress) return 'running'
  const last = coverage.last_scan
  if (!last) return 'none'
  // A running or pending job with no held lease was abandoned.
  if (last.status === 'failed' || last.status === 'running' || last.status === 'pending') return 'unfinished'
  return last.status === 'completed' ? 'completed' : 'none'
}

/** The Phase 1 job-warning note (coverage.ts warningNotes) for each partial code. */
const WARNING_NOTE_KEY: Record<string, string> = {
  [DISCOVERY_WARNING_TRUNCATED_INDEX]: 'deletion-paused',
  [DISCOVERY_WARNING_LISTING_TRUNCATED]: 'listing-truncated',
}

// ── Times ──

function clean(text: string): string {
  // Newer ICU puts a narrow no-break space before AM/PM.
  return text.replace(/[  ]/g, ' ')
}

function dayKey(ms: number, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms)
}

/** "today, 4:12 PM", "yesterday, 9:03 PM", or "Oct 19, 2026, 4:12 PM", in local time. */
export function formatWhen(iso: string, now: number, timeZone?: string): string {
  const at = Date.parse(iso)
  const day = dayKey(at, timeZone)
  const [y, m, d] = dayKey(now, timeZone).split('-').map(Number)
  const yesterday = dayKey(Date.UTC(y, m - 1, d - 1, 12), 'UTC')
  const time = clean(new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(at))
  if (day === dayKey(now, timeZone)) return `today, ${time}`
  if (day === yesterday) return `yesterday, ${time}`
  return clean(new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(at))
}

/** The exact time, for the hover/focus tooltip: "Thursday, October 22, 2026 at 4:12:07 PM UTC". */
export function formatExact(iso: string, timeZone?: string): string {
  return clean(new Intl.DateTimeFormat('en-US', { timeZone, dateStyle: 'full', timeStyle: 'long' }).format(Date.parse(iso)))
}

/** Text with times in it; each time is rendered with its exact value on hover and focus. */
export type RichPart = string | { iso: string }
export type Rich = RichPart[]

export function richText(parts: Rich, now: number, timeZone?: string): string {
  return parts.map((p) => (typeof p === 'string' ? p : formatWhen(p.iso, now, timeZone))).join('')
}

// ── Copy ──

/** Scans run every 6 hours (backend/src/jobs/resourceDiscovery.job.ts cron '0 *\/6 * * *', pinned by a test). */
export const SCAN_INTERVAL_TEXT = 'scans normally run every 6 hours'

export const REGION_COPY = {
  partialByCode: {
    [DISCOVERY_WARNING_TRUNCATED_INDEX]: 'its resource index has more than 1,000 items, so some resources there may be missing and deleted ones may still be listed until a complete scan.',
    [DISCOVERY_WARNING_LISTING_TRUNCATED]: 'some listings stopped at their page limit, so some resources there may be missing and deleted ones may still be listed until a complete scan.',
  } as Record<string, string>,
  partialGeneric: 'some resources there may be missing and deleted ones may still be listed until a complete scan.',
  denied: 'because of permissions.',
  timedOut: "because AWS didn't respond in time.",
  failed: 'because the scan ran into an error.',
  otherResults: 'Other results may still be available.',
  foundEarlier: 'Resources found earlier stay listed until a complete scan.',
  groupDetail: "Multi-region scanning is rolling out. Resources in these regions, other than S3 buckets, don't appear on this page or in any count yet.",
  notListed: "We haven't read this account's region list yet. It's read during each scan.",
  unavailable: "We can't show a status for this region yet.",
  scanningDetail: 'Results shown are from the last successful scan.',
  unfinishedDetail: "The latest scan didn't finish. Results shown are from an earlier scan.",
}

// ── View ──

export type RegionState =
  | 'complete' | 'partial' | 'scanning' | 'out_of_date'
  | 'denied' | 'timed_out' | 'failed'
  | 'unfinished' | 'not_scanned' | 'not_listed' | 'unavailable'

const STATUS_LABEL: Record<RegionState, string> = {
  complete: 'Complete',
  partial: 'Partial',
  scanning: 'Scanning',
  out_of_date: 'Out of date',
  denied: "Couldn't check some types",
  timed_out: 'Timed out',
  failed: 'Scan error',
  unfinished: "Last scan didn't finish",
  not_scanned: 'Not scanned yet',
  not_listed: 'Not listed yet',
  unavailable: 'Status not available',
}

const CHIP_NOTE: Record<RegionState, string> = {
  complete: 'complete',
  partial: 'partial',
  scanning: 'scanning',
  out_of_date: 'out of date',
  denied: "couldn't check some types",
  timed_out: 'timed out',
  failed: 'scan error',
  unfinished: "last scan didn't finish",
  not_scanned: 'not scanned yet',
  not_listed: 'not listed yet',
  unavailable: 'status not available',
}

export type LegendKey = 'complete' | 'partial' | 'scanning' | 'out_of_date' | 'gaps' | 'unfinished' | 'not_scanned' | 'not_listed' | 'unavailable'

export const LEGEND: Record<LegendKey, { label: string; text: string }> = {
  complete: { label: 'Complete', text: 'the last scan of this region finished with nothing missed' },
  partial: { label: 'Partial', text: 'some listings were cut off; see the details' },
  scanning: { label: 'Scanning', text: 'a scan is running; counts may change when it finishes' },
  out_of_date: { label: 'Out of date', text: 'no scan has reached this region recently' },
  gaps: { label: "Couldn't check some types", text: "some resource types weren't checked on the last scan" },
  unfinished: { label: "Last scan didn't finish", text: 'results are from an earlier scan' },
  not_scanned: { label: 'Not scanned yet', text: 'enabled in this account, not scanned yet' },
  not_listed: { label: 'Not listed yet', text: "the region list hasn't been read" },
  unavailable: { label: 'Status not available', text: "we can't show a status yet" },
}
const LEGEND_ORDER: LegendKey[] = ['complete', 'partial', 'scanning', 'out_of_date', 'gaps', 'unfinished', 'not_scanned', 'not_listed', 'unavailable']

function legendKey(state: RegionState): LegendKey {
  return state === 'denied' || state === 'timed_out' || state === 'failed' ? 'gaps' : state
}

export interface RegionChip {
  key: string
  state: RegionState | 'global'
  region: string
  note: string
}

export interface RegionNote {
  key: string
  tone: 'info' | 'warn'
  title?: string
  parts: Rich
}

export interface RegionRow {
  key: string
  /** A region name, or a group label ("16 other regions"). */
  label: string
  home: boolean
  /** The regions of a grouped row, in API order. */
  regions?: string[]
  /** "enabled in this account" on the never-scanned group. */
  sublabel?: string
  state: RegionState
  status: string
  /** "Last full scan": the region's last scan with nothing missed (ok), or the text shown instead. */
  lastSuccess: { iso: string } | string
  details: Rich
}

export interface RegionCoverageView {
  headline: string
  headlineSub: string | null
  scanLine: Rich
  scanRunning: boolean
  chips: RegionChip[]
  legend: { key: LegendKey; label: string; text: string }[]
  notes: RegionNote[]
  rows: RegionRow[]
  footer: string | null
  /** "The region list was last read …", only when the API marks the list stale. */
  listNote: Rich | null
  counts: RegionCounts
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many
}

/** S3 / CloudFront are claimed only when in the newest scan's scope AND in the last completed scan (Q5). */
function claimed(coverage: ServicesCoverage): { s3: boolean; cloudfront: boolean } {
  const types = coverage.last_completed_scan?.resource_types ?? []
  return {
    s3: coverage.scope.s3.in_last_scan && types.includes('s3'),
    cloudfront: coverage.scope.cloudfront.in_last_scan && types.includes('cloudfront'),
  }
}

function plusParts(c: { s3: boolean; cloudfront: boolean }): string {
  const parts = [c.s3 ? 'S3 in every region' : null, c.cloudfront ? 'CloudFront (global)' : null].filter(Boolean)
  return parts.length === 0 ? '' : `, plus ${parts.join(' and ')}`
}

function s3Found(coverage: ServicesCoverage): string {
  const byRegion = new Map<string, number>()
  for (const r of coverage.scope.s3.regions) {
    if (r.count <= 0) continue
    const name = r.region ?? 'an unknown region'
    byRegion.set(name, (byRegion.get(name) ?? 0) + r.count)
  }
  const total = [...byRegion.values()].reduce((a, b) => a + b, 0)
  if (total === 0) return 'no S3 buckets found'
  const regions = [...byRegion.entries()].sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1))
  if (regions.length === 1) return total === 1 ? `1 S3 bucket found, in ${regions[0][0]}` : `${total} S3 buckets found, all in ${regions[0][0]}`
  return `${total} S3 buckets found in ${regions.length} regions: ${regions.map(([r, n]) => `${r} ${n}`).join(', ')}`
}

function cloudfrontFound(count: number): string {
  return count === 0 ? 'no CloudFront distributions' : count === 1 ? '1 CloudFront distribution' : `${count} CloudFront distributions`
}

export function footerText(coverage: ServicesCoverage): string | null {
  const c = claimed(coverage)
  if (c.s3 && c.cloudfront) return `S3 and CloudFront are checked in every region on each scan: ${s3Found(coverage)}; ${cloudfrontFound(coverage.scope.cloudfront.count)}.`
  if (c.s3) return `S3 is checked in every region on each scan: ${s3Found(coverage)}.`
  if (c.cloudfront) return `CloudFront (global) is checked on each scan: ${cloudfrontFound(coverage.scope.cloudfront.count)}.`
  return null
}

/** The display state of a region row; scanning applies to the home region only. */
function rowState(row: RegionCoverage, scanning: boolean): RegionState {
  if (scanning) return 'scanning'
  if (row.stale) return 'out_of_date'
  switch (row.status) {
    case 'ok': return 'complete'
    case 'partial': return 'partial'
    case 'denied': return 'denied'
    case 'timed_out': return 'timed_out'
    case 'failed': return 'failed'
    case 'never_scanned': return 'not_scanned'
    default: return 'unavailable'
  }
}

function partialText(code: string | null): string {
  return (code && REGION_COPY.partialByCode[code]) || REGION_COPY.partialGeneric
}

/** The sentence about a region's latest written status ({region} given: the card note; null: the panel). */
function statusSentence(row: RegionCoverage, region: string | null): string | null {
  const subject = region ?? 'this region'
  switch (row.status) {
    case 'partial':
      return region ? `${region} was only partly scanned: ${partialText(row.last_error_code)}` : `Only partly scanned: ${partialText(row.last_error_code).replace('there', 'here')}`
    case 'denied': return `Some resource types in ${subject} couldn't be checked ${REGION_COPY.denied} ${REGION_COPY.otherResults}`
    case 'timed_out': return `Some resource types in ${subject} couldn't be checked ${REGION_COPY.timedOut} ${REGION_COPY.otherResults}`
    case 'failed': return `Some resource types in ${subject} couldn't be checked ${REGION_COPY.failed} ${REGION_COPY.otherResults}`
    default: return null
  }
}

function rowDetails(row: RegionCoverage, state: RegionState): Rich {
  const parts: Rich = []
  const add = (...p: Rich) => { if (parts.length > 0) parts.push(' '); parts.push(...p) }
  if (state === 'scanning') add(REGION_COPY.scanningDetail)
  if (row.stale && row.last_scan_finished_at) add('Last scanned ', { iso: row.last_scan_finished_at }, '. Not scanned since; results may be out of date.')
  const sentence = statusSentence(row, null)
  if (sentence) add(sentence)
  if (row.status === 'denied' || row.status === 'timed_out' || row.status === 'failed') add(REGION_COPY.foundEarlier)
  if (row.status === 'partial' && !row.last_success_at && row.last_scan_finished_at) add('Last partly scanned ', { iso: row.last_scan_finished_at }, '.')
  if (state === 'unavailable') add(REGION_COPY.unavailable)
  return parts
}

function lastSuccessCell(row: RegionCoverage): RegionRow['lastSuccess'] {
  if (row.last_success_at) return { iso: row.last_success_at }
  return row.status === 'partial' ? 'No complete scan yet' : '—'
}

export function describeRegionCoverage(coverage: ServicesCoverage, now: number, inTabWarnings: readonly string[] = []): RegionCoverageView | null {
  const home = coverage.account.connected ? coverage.scope.home_region : null
  if (!home || !hasRegionCoverage(coverage)) return null

  const known = coverage.scope.enabled_regions.known
  const counts = regionCounts(coverage)
  const attempt = latestAttempt(coverage)
  const running = attempt === 'running'
  const lastSuccessIso = coverage.last_completed_scan?.completed_at ?? coverage.last_successful_scan_at
  const scope = claimed(coverage)
  const jobWarnings = shownWarnings(coverage.last_scan?.warnings ?? [])

  // ── Scan line ──
  const scanLine: Rich = running
    ? ['Scan in progress since ', { iso: coverage.scan_in_progress!.since }, ...(lastSuccessIso ? [' · showing results from ', { iso: lastSuccessIso }] : [' · no completed scan yet'])]
    : lastSuccessIso ? ['Last scan finished ', { iso: lastSuccessIso }] : ['No successful scan yet']

  const chips: RegionChip[] = []
  const rows: RegionRow[] = []
  const notes: RegionNote[] = []

  // ── Latest attempt (from last_scan, §14.1) ──
  if (attempt === 'unfinished') {
    const last = coverage.last_scan!
    const at = last.completed_at ?? last.started_at
    notes.push({
      key: 'latest-unfinished', tone: 'warn',
      parts: [
        ...(at ? ['The latest scan, at ', { iso: at }, ", didn't finish."] : ["The latest scan didn't finish."]),
        ...(lastSuccessIso ? [' Results shown are from the last successful scan at ', { iso: lastSuccessIso }, '.'] : [' No scan has completed yet.']),
      ],
    })
  }

  let headline: string
  let headlineSub: string | null

  if (known) {
    const regions = coverage.region_status!
    const homeRow = regions.find((r) => r.home)!
    const others = regions.filter((r) => !r.home)
    const notScanned = others.filter((r) => NOT_SCANNED_YET_STATUSES.includes(r.status))
    const listed = others.filter((r) => !NOT_SCANNED_YET_STATUSES.includes(r.status))

    headline = `${counts.checked} of ${counts.enabled} enabled regions checked${counts.withGaps > 0 ? ` · ${counts.withGaps} with gaps` : ''}`
    const otherChecked = others.some((r) => CHECKED_STATUSES.includes(r.status))
    headlineSub = `· ${otherChecked ? 'including ' : ''}${home.region} (home)${plusParts(scope)}`

    // Home chip and row.
    const homeState = rowState(homeRow, running)
    chips.push({ key: 'home', state: homeState, region: home.region, note: homeState === 'not_scanned' || homeState === 'unavailable' ? `home · ${CHIP_NOTE[homeState]}` : `${home.count} · home · ${CHIP_NOTE[homeState]}` })
    rows.push({ key: `region-${homeRow.region}`, label: homeRow.region, home: true, state: homeState, status: STATUS_LABEL[homeState], lastSuccess: lastSuccessCell(homeRow), details: rowDetails(homeRow, homeState) })

    // Other regions with a status: one row each; chips grouped by state.
    const groups = new Map<RegionState, number>()
    for (const r of listed) {
      const state = rowState(r, false)
      groups.set(state, (groups.get(state) ?? 0) + 1)
      rows.push({ key: `region-${r.region}`, label: r.region, home: false, state, status: STATUS_LABEL[state], lastSuccess: lastSuccessCell(r), details: rowDetails(r, state) })
    }
    for (const [state, n] of groups) {
      chips.push({ key: `group-${state}`, state, region: `${n} ${plural(n, 'region', 'regions')}`, note: CHIP_NOTE[state] })
    }

    // The never-scanned regions: one chip, one row, no count of resources.
    if (notScanned.length > 0) {
      const n = notScanned.length
      const label = `${n} other ${plural(n, 'region', 'regions')}`
      chips.push({ key: 'not-scanned', state: 'not_scanned', region: label, note: CHIP_NOTE.not_scanned })
      rows.push({ key: 'not-scanned', label, home: false, regions: notScanned.map((r) => r.region), sublabel: 'enabled in this account', state: 'not_scanned', status: STATUS_LABEL.not_scanned, lastSuccess: '—', details: [REGION_COPY.groupDetail] })
    }

    // Region notes: out of date, then the status sentence, home first.
    for (const r of [homeRow, ...listed]) {
      if (r.stale && r.last_scan_finished_at) {
        notes.push({ key: `stale-${r.region}`, tone: 'warn', parts: ['These results may be out of date. ', `${r.region} was last scanned `, { iso: r.last_scan_finished_at }, `; ${SCAN_INTERVAL_TEXT}.`] })
      }
      const sentence = statusSentence(r, r.region)
      if (sentence) notes.push({ key: `status-${r.region}`, tone: 'warn', parts: [sentence] })
    }

    // Today: every other region is not scanned yet.
    if (others.length > 0 && listed.length === 0) {
      const n = others.length
      const types = [scope.s3 ? 'S3' : null, scope.cloudfront ? 'CloudFront' : null].filter(Boolean) as string[]
      const everywhere = types.length === 0 ? '' : ` ${types.join(' and ')} ${types.length === 1 ? 'is' : 'are'} checked everywhere.`
      const rest = n === 1
        ? "The other enabled region isn't scanned yet, so resources there, other than S3 buckets, don't appear here or in any count."
        : `The other ${n} enabled regions aren't scanned yet, so resources there, other than S3 buckets, don't appear here or in any count.`
      notes.push({ key: 'home-only', tone: 'info', parts: [`Only ${home.region} is scanned today. ${rest}${everywhere}`] })
    }
  } else {
    // No region list: no region rows exist, so the home state comes from the jobs.
    const lastSuccess = coverage.last_successful_scan_at
    headline = lastSuccess ? `${home.region} checked`
      : running ? `${home.region}: first scan in progress`
      : attempt === 'unfinished' ? `${home.region}: last scan failed`
      : `${home.region}: not scanned yet`
    const plus = lastSuccess ? plusParts(scope) : ''
    headlineSub = plus ? `· ${plus.slice(2)}` : null

    const homeState: RegionState = running ? 'scanning'
      : attempt === 'unfinished' ? 'unfinished'
      : attempt === 'completed' ? (jobWarnings.length > 0 ? 'partial' : 'complete')
      : 'not_scanned'
    chips.push({ key: 'home', state: homeState, region: home.region, note: homeState === 'not_scanned' ? `home · ${CHIP_NOTE.not_scanned}` : `${home.count} · home · ${CHIP_NOTE[homeState]}` })
    rows.push({
      key: `region-${home.region}`, label: home.region, home: true, state: homeState, status: STATUS_LABEL[homeState],
      lastSuccess: lastSuccess ? { iso: lastSuccess } : '—',
      details: homeState === 'scanning' ? [REGION_COPY.scanningDetail] : homeState === 'unfinished' ? [REGION_COPY.unfinishedDetail] : [],
    })
    chips.push({ key: 'not-listed', state: 'not_listed', region: 'Other regions', note: CHIP_NOTE.not_listed })
    rows.push({ key: 'not-listed', label: 'Other regions', home: false, state: 'not_listed', status: STATUS_LABEL.not_listed, lastSuccess: '—', details: [REGION_COPY.notListed] })
    notes.push({ key: 'not-listed', tone: 'info', parts: [REGION_COPY.notListed] })
  }

  // Stored inventory outside the scanned regions, only when there is some (Q6).
  const { cloudfront, s3 } = coverage.scope
  if (cloudfront.count > 0) chips.push({ key: 'global', state: 'global', region: 'global', note: `${cloudfront.count} · CloudFront` })
  const s3Elsewhere = s3.regions.filter((r) => r.region !== home.region).reduce((n, r) => n + r.count, 0)
  if (s3Elsewhere > 0) chips.push({ key: 's3', state: 'global', region: 'S3 in other regions', note: `${s3Elsewhere}` })

  // The job's warnings keep their Phase 1 notes, except the one the home
  // region's partial note already says (same truncation code, Q8).
  const homeStatus = known ? coverage.region_status!.find((r) => r.home) : undefined
  const saidByHome = homeStatus?.status === 'partial' && homeStatus.last_error_code ? WARNING_NOTE_KEY[homeStatus.last_error_code] : undefined
  for (const note of warningNotes(jobWarnings, inTabWarnings)) {
    if (note.key === saidByHome) continue
    notes.push({ key: `warning-${note.key}`, tone: note.tone, title: note.title, parts: [note.body] })
  }

  const present = new Set<LegendKey>()
  for (const s of [...chips.map((c) => c.state), ...rows.map((r) => r.state)]) if (s !== 'global') present.add(legendKey(s))
  const legend = LEGEND_ORDER.filter((k) => present.has(k)).map((key) => ({ key, ...LEGEND[key] }))

  const { stale: listStale, listed_at: listedAt } = coverage.scope.enabled_regions
  const listNote: Rich | null = known && listStale === true && listedAt ? ['The region list was last read ', { iso: listedAt }, '.'] : null

  return { headline, headlineSub, scanLine, scanRunning: running, chips, legend, notes, rows, footer: footerText(coverage), listNote, counts }
}
