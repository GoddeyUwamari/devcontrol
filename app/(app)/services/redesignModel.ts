/**
 * What the Services redesign (multi-region PR 3b, mock v2.2) says, from GET
 * /api/services/coverage and /stats only. Pure, so every string and count rule
 * is tested without rendering. Behind NEXT_PUBLIC_SERVICES_REDESIGN.
 *
 * Rules (pr3-step1.md, the PR 3b brief):
 * - A flagged organization is told apart only by `coverage.multi_region` being
 *   present (server truth). Nothing here holds a region list or names a region:
 *   every region comes from the response.
 * - Coverage semantics are the server's: `state`, `scan.regions_*`,
 *   `regions[].empty`, `not_enabled_regions`, `home_only_coverage`,
 *   `region_warnings_unattributed`, `/stats.attention_scope`. Counts here are
 *   only tallies of one server field (a region with resources, earlier-scan
 *   counts) or arithmetic on two server totals.
 * - `resources: null` renders "—", never 0. The Resources tile is /stats
 *   `total`; the region column is never summed into a total.
 * - CloudFront is global: never a region, never in a denominator.
 */
import type { AWSServicesStats, MultiRegionCoverage, MultiRegionRegion, RegionCoverage, ServicesCoverage } from '@/lib/services/aws-services.service'
import { formatLocalDay, formatLocalWhen } from '@/lib/utils/localTime'
import { lastCompletedScanIso } from '@/lib/scan-time'
import { DISCOVERY_WARNING_TRUNCATED_INDEX } from '@/components/aws/discovery-warning-notice'
import {
  DISCOVERY_WARNING_LISTING_TRUNCATED, DISCOVERY_WARNING_RESOURCE_EXPLORER_NO_INDEX, DISCOVERY_WARNING_RESOURCE_EXPLORER_NO_VIEW,
  resourceExplorerNoViewText, resourceExplorerOffText, resourcesScopeCaption, shownWarnings,
} from './coverage'
import { formatWhen, latestAttempt, type Rich } from './regionCoverage'
import { notCheckedLines, type NotCheckedLine } from './notChecked'

// ── Copy (exact strings; founder-approved, mock v2.1/v2.2 and the PR 3b brief) ──

export const REDESIGN_COPY = {
  scanNow: 'Scan now',
  scanning: 'Scanning…',
  noScanYet: 'No scan has finished yet.',
  regionListUnread: "We haven't read this account's region list yet. It's read during each scan.",
  homeLine: (home: string) => `Cost savings, Operational Health and Security Hub run in your home region, ${home}, only.`,
  coverageHeading: 'Region coverage',
  connected: 'AWS account connected',
  globalHeading: 'Global resources (not a region)',
  footerMulti: 'S3 and CloudFront are checked on every scan.',
  /** S35 flag off with no S3 bucket outside the home region (founder copy fix, PR 3c): no count clause. */
  footerOffNone: 'S3 and CloudFront are checked in every region on each scan.',
  formerHomeChip: 'former home',
  noLongerScanned: 'No longer scanned',
  formerHomeDetails: 'Not scanned since your home region moved. S3 buckets here are still checked on every scan.',
  listRead: 'The region list was last read ',
  fromEarlier: 'from an earlier scan',
  neverScanned: 'never scanned',
  emptyDetails: 'Each scanned completely; nothing found.',
  scanningDetails: 'Results shown are from the last scan that finished.',
  waitingDetails: 'Queued in this scan. Earlier results shown.',
  waitingNeverDetails: "Queued in this scan. It hasn't been scanned before.",
  notScannedDetails: "Not scanned yet. Resources here, other than S3 buckets, aren't in any count.",
  notEnabledDetails: "Opt-in regions this account hasn't enabled. Nothing to scan.",
  notEnabledOpen: 'If you enable one in AWS, the next scan includes it.',
  optIn: 'opt-in, enabled',
  scanDeadline: "The scan reached its time limit after checking the regions, so some later checks (IAM security, compliance, unused-resource and cost-savings checks) didn't run or didn't finish. Region results are kept; the next scan runs them again.",
  unattributed: "Resource Explorer wasn't available in at least one region on the last scan, so some resource types may be missing there.",
  comingSoon: 'service mapping and owner assignment. Map resources to services and assign owners to see findings, cost, spend and deploys per service.',
  unknownTooltip: "We couldn't read this resource's tags, so we don't know who owns it. \"No owner tag\" is different: we read the tags and found neither an Owner nor a Team tag.",
  notCheckedEnd: 'So nothing on this page looks more complete than it is.',
  emptyListAction: 'Run Scan now to scan your connected account.',
  dismiss: 'Dismiss',
} as const

// ── Shared with the other pages (PR 3d-2: wording and links), through servicesTruth.ts ──

/**
 * D4 (founder, Nov 18): what "needs attention" counts, one sentence for the Services redesign's
 * What needs attention and Infrastructure's. The rule itself is the server's (attentionOf).
 */
export const ATTENTION_DEFINITION = 'Critical and high findings, cost recommendations estimated at $100/mo or more, and stopped, degraded or failed resources.'

/** D7: the one URL parameter Services reads; `?show=needs_attention` opens it with Needs attention selected. */
export const SHOW_PARAM = 'show'
export const NEEDS_ATTENTION_HREF = '/services?show=needs_attention'

/** D7/D8/D9: the Region coverage card (its id, RegionCoverageCard.tsx) and the one label for links to it. */
export const REGION_COVERAGE_HREF = '/services#region-coverage'
export const REGION_COVERAGE_LINK = 'Region coverage →'

/** The failure codes a region row can show (doc §5: one per state + error_code). */
export type FailureCode =
  | 'access_denied' | 'access_denied_scp' | 'throttled' | 'call_timeout' | 'error'
  | 'region_not_ready' | 'region_deadline' | 'scan_budget'

/** Status labels (tab 13). */
export const FAILURE_LABEL: Record<FailureCode, string> = {
  access_denied: "Couldn't check: access denied",
  access_denied_scp: "Couldn't check: blocked by a policy",
  throttled: "Couldn't check: AWS was busy",
  call_timeout: "Couldn't check: AWS didn't respond",
  error: "Couldn't check: scan error",
  region_not_ready: 'Not ready yet',
  region_deadline: 'Not finished: time limit',
  scan_budget: 'Not reached',
}

/** Short Details (APPROVED, exact). */
export const SHORT_DETAILS: Record<FailureCode, string> = {
  access_denied: 'AWS refused our read role. Earlier results stay listed.',
  access_denied_scp: 'An organization policy may block access. Earlier results stay listed.',
  throttled: 'AWS was busy. Try again with Scan now.',
  call_timeout: "AWS didn't respond in time. Try again with Scan now.",
  error: 'The scan ran into an error. Try again with Scan now.',
  region_not_ready: "AWS isn't ready here yet. The next scan tries again.",
  region_deadline: 'Took longer than the time limit. The next scan tries again.',
  scan_budget: 'The scan ran out of time before this region. The next scan tries again.',
}

/** "What we didn't check" reason lines (APPROVED, exact). */
export function reasonLine(code: FailureCode, region: string): string {
  switch (code) {
    case 'access_denied': return `${region} couldn't be checked on the last scan (access denied).`
    case 'access_denied_scp': return `${region} couldn't be checked on the last scan (blocked by a policy).`
    case 'throttled': return `${region} couldn't be checked on the last scan (AWS was busy).`
    case 'call_timeout': return `${region} couldn't be checked on the last scan (AWS didn't respond).`
    case 'error': return `${region} couldn't be checked on the last scan (scan error).`
    case 'region_not_ready': return `${region} wasn't checked on the last scan (AWS wasn't ready there yet).`
    case 'region_deadline': return `${region} wasn't finished on the last scan (time limit for one region).`
    case 'scan_budget': return `${region} wasn't reached on the last scan (the scan ran out of time).`
  }
}

/** The region note in the coverage card (tab 13 texts; throttled: the V2-31 note of tab 3). */
export function regionNoteText(code: FailureCode, region: string, earlier: number | null): string {
  switch (code) {
    case 'access_denied': return `AWS refused our read role in ${region}. Resources found there earlier stay listed until a complete scan.`
    case 'access_denied_scp': return `AWS denied access to ${region} (an organization policy may block it). Resources found there earlier stay listed.`
    case 'throttled': return `AWS was busy and slowed our requests in ${region}, so it couldn't be checked on the last scan. Try again with Scan now.`
      + (earlier !== null ? ` The ${earlier.toLocaleString('en-US')} ${earlier === 1 ? 'resource found there earlier stays' : 'resources found there earlier stay'} listed until a complete scan.` : '')
    case 'call_timeout': return `AWS didn't respond in time in ${region}. Try again with Scan now. Resources found there earlier stay listed.`
    case 'error': return `The scan ran into an error in ${region}. Try again with Scan now. If it keeps happening, contact support.`
    case 'region_not_ready': return `${region} is enabled, but AWS isn't ready to answer there yet. The next scan tries again.`
    case 'region_deadline': return `${region} took longer than the time limit for one region, so it wasn't finished. The next scan tries again. Resources found there earlier stay listed.`
    case 'scan_budget': return `The scan reached its overall time limit before it got to ${region}. The next scan tries again.`
  }
}

/** A partial region's Details (RE-1, RE-2, S15), {r} = the region that raised it (RR-M2). */
export function partialText(code: string | null, region: string): string {
  switch (code) {
    case DISCOVERY_WARNING_RESOURCE_EXPLORER_NO_INDEX: return resourceExplorerOffText(region)
    case DISCOVERY_WARNING_RESOURCE_EXPLORER_NO_VIEW: return resourceExplorerNoViewText(region)
    case DISCOVERY_WARNING_LISTING_TRUNCATED: return `${region} was only partly scanned: some listings stopped at their page limit, so some resources there may be missing and deleted ones may still be listed until a complete scan.`
    case DISCOVERY_WARNING_TRUNCATED_INDEX: return `${region} was only partly scanned: its resource index has more than 1,000 items, so some resources there may be missing and deleted ones may still be listed until a complete scan.`
    default: return `${region} was only partly scanned: some resources there may be missing and deleted ones may still be listed until a complete scan.`
  }
}

/** The failure code of a region row, from its `state` and `error_code` (doc §5); null when it isn't a failure. */
export function failureCode(r: Pick<MultiRegionRegion, 'state' | 'error_code'>): FailureCode | null {
  switch (r.state) {
    case 'failed': return r.error_code === 'throttled' || r.error_code === 'call_timeout' ? r.error_code : 'error'
    case 'denied': return r.error_code === 'access_denied_scp' ? 'access_denied_scp' : 'access_denied'
    case 'not_ready': return 'region_not_ready'
    case 'not_checked_deadline': return 'region_deadline'
    case 'not_checked_budget': return 'scan_budget'
    default: return null
  }
}

// ── Small helpers ──

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)
const num = (n: number) => n.toLocaleString('en-US')
const seg = (parts: (string | null | false)[]) => parts.filter(Boolean).join(' · ')
/** A count segment, left out when 0 (V2-11). */
const count = (n: number | null | undefined, words: string) => (typeof n === 'number' && n > 0 ? `${num(n)} ${words}` : null)
const regionsWord = (t: number) => plural(t, 'region', 'regions')

/** Multi-region mode: the server sent `multi_region` (the organization is flagged). */
export function multiRegionOf(c: ServicesCoverage): MultiRegionCoverage | null {
  return c.multi_region ?? null
}

/** The home region: `multi_region.home_region` when flagged, otherwise the account's. */
export function homeRegionOf(c: ServicesCoverage): string | null {
  return c.multi_region?.home_region ?? c.account.home_region ?? c.scope.home_region?.region ?? null
}

/**
 * PR 3c: the former home region of an UNFLAGGED organization (multi_region
 * absent), from the coverage response's own keys (HR-1 previous_home_region /
 * home_region_changed_at, G2b previous_home_region_resources). It is not
 * scanned (only the home region is), so it is never "checked". Null when
 * flagged (the old home is still scanned there) or never changed.
 */
export interface FormerHome { region: string; changedAt: string; earlier: number | null }
export function formerHomeOf(c: ServicesCoverage | undefined): FormerHome | null {
  if (!c || c.multi_region) return null
  const a = c.account
  if (!a.connected || !a.previous_home_region || !a.home_region_changed_at || a.previous_home_region === homeRegionOf(c)) return null
  return {
    region: a.previous_home_region,
    changedAt: a.home_region_changed_at,
    earlier: typeof a.previous_home_region_resources === 'number' ? a.previous_home_region_resources : null,
  }
}

/**
 * A date with no time (HR-S18, HR-S19, V2-47): the app's shared helper
 * (lib/utils/localTime formatLocalDay, founder decision g): "Nov 16", with the
 * year only outside the current one ("Nov 16, 2025"), in local time.
 */
export function dayText(iso: string, now: number): string {
  return formatLocalDay(iso, now) ?? iso
}

// ── Header scan line (Services only; Security and the Dashboard keep scanLine) ──

/** The finished-scan label (V2-82), shared with the other pages through servicesTruth.ts (PR 3d-1). */
export const LAST_SCAN_FINISHED = 'Last scan finished'

export type RedesignScanState = 'finished' | 'running' | 'failed' | 'none'
export interface RedesignScanLine { state: RedesignScanState; text: string }

/** The instant a scan line names first, and the exact words the line prints for it. */
export interface ScanLineTime { iso: string; text: string }

/** "4:31 PM" when it started today; otherwise the full local time ("yesterday, 11:58 PM"). */
function sinceText(iso: string, now: number): string {
  const when = formatLocalWhen(iso, now)
  if (!when) return iso
  return when.startsWith('today, ') ? when.slice('today, '.length) : when
}

/** The header line and the time it names (null when it names none, or the time couldn't be formatted). */
function scanLineAndTime(c: ServicesCoverage, now: number): RedesignScanLine & { time: ScanLineTime | null } {
  const mr = multiRegionOf(c)
  const lastIso = lastCompletedScanIso(c)
  const lastDone = formatLocalWhen(lastIso, now)
  const since = (iso: string): ScanLineTime | null => (formatLocalWhen(iso, now) ? { iso, text: sinceText(iso, now) } : null)
  if (mr) {
    if (mr.coverage_status === 'in_progress' && mr.progress) {
      const started = mr.scan?.started_at ?? mr.progress.scan_started_at
      return { state: 'running', text: `Scan in progress since ${sinceText(started, now)} · ${num(mr.progress.regions_done)} of ${num(mr.progress.regions_total)} ${regionsWord(mr.progress.regions_total)} done`, time: since(started) }
    }
    if (mr.coverage_status === 'latest_scan_failed' && mr.scan) {
      const atIso = mr.scan.completed_at ?? mr.scan.started_at
      const at = formatLocalWhen(atIso, now)
      if (at) return { state: 'failed', text: `Last scan: ${at} · didn't finish`, time: { iso: atIso!, text: at } }
    }
  } else {
    const attempt = latestAttempt(c)
    if (attempt === 'running' && c.scan_in_progress) {
      return { state: 'running', text: `Scan in progress since ${sinceText(c.scan_in_progress.since, now)}${lastDone ? ` · showing results from ${lastDone}` : ' · no scan has finished yet'}`, time: since(c.scan_in_progress.since) }
    }
    if (attempt === 'unfinished' && c.last_scan) {
      const atIso = c.last_scan.completed_at ?? c.last_scan.started_at
      const at = formatLocalWhen(atIso, now)
      if (at) return { state: 'failed', text: `Last scan: ${at} · didn't finish`, time: { iso: atIso!, text: at } }
    }
  }
  return lastDone
    ? { state: 'finished', text: `${LAST_SCAN_FINISHED} ${lastDone}`, time: { iso: lastIso!, text: lastDone } }
    : { state: 'none', text: REDESIGN_COPY.noScanYet, time: null }
}

export function redesignScanLine(c: ServicesCoverage, now: number): RedesignScanLine {
  const { state, text } = scanLineAndTime(c, now)
  return { state, text }
}

/**
 * The time the header line names first (finished: the last finished scan; didn't finish: that attempt;
 * running: when it started), with the exact words the line prints for it: the same instant
 * redesignScanLine formats, never picked again (PR 3d-2, 3d-1 review RR-L1). null when the line names none.
 */
export function redesignScanLineTime(c: ServicesCoverage, now: number): ScanLineTime | null {
  return scanLineAndTime(c, now).time
}

/** "Scan now" is disabled while a scan holds the account's lease. */
export function scanIsRunning(c: ServicesCoverage | undefined): boolean {
  return !!c?.scan_in_progress || c?.multi_region?.coverage_status === 'in_progress'
}

// ── Scan-result banner ──

export interface DiscoverOutcome { jobId: string | null; discovered: number; updated: number }
export type BannerTone = 'success' | 'warning' | 'danger' | 'neutral'
export interface BannerView { tone: BannerTone; text: string; counts: string | null }

/** The regions of the latest scan that weren't checked, in server order. */
export function latestScanNotChecked(mr: MultiRegionCoverage): { region: string; code: FailureCode; resources: number | null; from: MultiRegionRegion['resources_from'] }[] {
  const out: { region: string; code: FailureCode; resources: number | null; from: MultiRegionRegion['resources_from'] }[] = []
  for (const r of mr.regions) {
    if (r.result_of !== 'latest_scan') continue
    const code = failureCode(r)
    if (code) out.push({ region: r.region, code, resources: r.resources, from: r.resources_from })
  }
  return out
}

/**
 * The scan banner's "who couldn't be checked" (flagged): "{r} couldn't be checked" when one named region
 * wasn't checked, else "{k} regions couldn't be checked" (k = total − checked). Shared with servicesTruth.ts
 * (PR 3d-1 H-1), so the other pages say what this banner says.
 */
export function scanNotCheckedWho(mr: MultiRegionCoverage, scan: { regions_total: number; regions_checked: number }): { k: number; text: string } {
  const k = Math.max(0, scan.regions_total - scan.regions_checked)
  const named = latestScanNotChecked(mr)
  return { k, text: k === 1 && named.length === 1 ? `${named[0].region} couldn't be checked` : `${num(k)} ${regionsWord(k)} couldn't be checked` }
}

/**
 * The one-line banner after a Scan now in this tab. `coverage` must be the
 * response read AFTER the discover call returned. Flagged: a tone only when
 * the scan it describes is the one Scan now ran (scan.id = jobId); absent
 * while a scan runs. Unflagged: the home-only "N of M" (G8).
 */
export function scanBanner(c: ServicesCoverage, outcome: DiscoverOutcome): BannerView | null {
  const counts = `${num(outcome.discovered)} new · ${num(outcome.updated)} updated`
  const neutral: BannerView = { tone: 'neutral', text: 'Scan finished', counts }
  const mr = multiRegionOf(c)
  if (mr) {
    if (mr.coverage_status === 'in_progress') return null
    if (!mr.scan || !outcome.jobId || mr.scan.id !== outcome.jobId) return neutral
    const { regions_checked: checked, regions_total: total } = mr.scan
    const of = `${num(checked)} of ${num(total)} ${regionsWord(total)} checked`
    switch (mr.coverage_status) {
      case 'all_checked':
        return { tone: 'success', text: `Scan finished · ${of}`, counts }
      case 'completed_with_regions_not_checked':
        return { tone: 'warning', text: `Scan finished · ${of} · ${scanNotCheckedWho(mr, mr.scan).text}`, counts }
      case 'latest_scan_failed':
        return { tone: 'danger', text: `Scan failed · it checked ${num(checked)} of ${num(total)} ${regionsWord(total)}, then stopped before finishing · try Scan now again`, counts: null }
      default:
        return neutral
    }
  }
  if (c.scan_in_progress) return null
  const home = homeRegionOf(c)
  const h = c.home_only_coverage
  if (!h || !home) return neutral
  const of = `Scan finished · ${num(h.regions_checked)} of ${num(h.regions_total)} ${regionsWord(h.regions_total)} checked`
  return h.regions_checked >= 1
    ? { tone: 'success', text: of, counts }
    : { tone: 'warning', text: `${of} · ${home} couldn't be checked`, counts }
}

// ── Organising line ──

export interface OrganisingLine { text: string; failed: boolean }

/**
 * Flagged, while a scan runs: regions done in this scan but not checked ("not checked"), and regions still
 * running or waiting. Shared with servicesTruth.ts (PR 3d-1 H-1).
 */
export function scanSoFar(p: MultiRegionCoverage['progress'], regionsChecked: number): { failedSoFar: number; left: number } {
  return { failedSoFar: p ? Math.max(0, p.regions_done - regionsChecked) : 0, left: p ? p.regions_running + p.regions_waiting : 0 }
}

/**
 * Flag off (G8 + RR-L2): the home region couldn't be checked: G8 counts no region as checked and the home
 * region's last status is failed, denied or timed out. The organising line's rule, shared with
 * servicesTruth.ts (PR 3d-1 H-1).
 */
export function homeCouldntBeChecked(c: ServicesCoverage): boolean {
  const h = c.home_only_coverage
  const homeRow = (c.region_status ?? []).find((r) => r.home)
  return !!h && h.regions_checked === 0 && !!homeRow && ['failed', 'denied', 'timed_out'].includes(homeRow.status)
}

export function organisingLine(c: ServicesCoverage): OrganisingLine {
  const mr = multiRegionOf(c)
  if (mr) {
    const s = mr.scan
    if (!s) return { text: REDESIGN_COPY.noScanYet, failed: false }
    const split = [count(s.regions_with_resources, 'with resources'), count(s.regions_empty, 'empty'), count(s.regions_zero_with_warnings, 'partly checked')]
    switch (mr.coverage_status) {
      case 'in_progress': {
        const p = mr.progress
        const total = p?.regions_total ?? s.regions_total
        const { failedSoFar, left } = scanSoFar(p, s.regions_checked)
        return {
          text: seg([`Scanning: ${num(s.regions_checked)} of ${num(total)} ${regionsWord(total)} checked so far`, ...split, count(failedSoFar, 'not checked'), count(left, 'still running or waiting')]),
          failed: false,
        }
      }
      case 'latest_scan_failed':
        // RR-L2: checked can equal total here; the failure always leads the line.
        return { text: seg([`Last scan failed after checking ${num(s.regions_checked)} of ${num(s.regions_total)} ${regionsWord(s.regions_total)}`, ...split]), failed: true }
      case 'all_checked':
      case 'completed_with_regions_not_checked':
        return {
          text: seg([`${num(s.regions_checked)} of ${num(s.regions_total)} ${regionsWord(s.regions_total)} checked`, ...split, count(Math.max(0, s.regions_total - s.regions_checked), 'not checked')]),
          failed: false,
        }
      default:
        return { text: mr.regions.length === 0 ? REDESIGN_COPY.regionListUnread : REDESIGN_COPY.noScanYet, failed: false }
    }
  }
  const h = c.home_only_coverage
  const home = homeRegionOf(c)
  if (!h || !home) {
    return { text: c.scope.enabled_regions.known ? REDESIGN_COPY.noScanYet : REDESIGN_COPY.regionListUnread, failed: false }
  }
  if (!c.last_scan && !c.last_successful_scan_at) return { text: REDESIGN_COPY.noScanYet, failed: false }
  // PR 3d-2 (N11): the home region is named once: "0 of 17 regions checked · us-east-1 couldn't be checked".
  const couldnt = homeCouldntBeChecked(c)
  return { text: seg([`${num(h.regions_checked)} of ${num(h.regions_total)} ${regionsWord(h.regions_total)} checked`, couldnt ? `${home} couldn't be checked` : home]), failed: false }
}

// ── Coverage card: notes, panel rows, legend, footer ──

export type StatusKey = 'complete' | 'partial' | 'scanning' | 'waiting' | 'couldnt' | 'notdone' | 'not_scanned' | 'no_longer' | 'not_enabled'
export interface RowStatus { key: StatusKey; label: string }

export const LEGEND_TEXT: Record<StatusKey, { label: string; text: string }> = {
  complete: { label: 'Complete', text: 'the last scan of this region finished with nothing missed' },
  partial: { label: 'Partial', text: 'some resource types or listings were missed; see the details' },
  scanning: { label: 'Scanning', text: 'a scan is running; counts may change when it finishes' },
  waiting: { label: 'Waiting', text: 'queued in the running scan; earlier results shown' },
  couldnt: { label: "Couldn't check", text: "the last scan couldn't check this region; results from an earlier scan stay listed" },
  notdone: { label: 'Not ready / not reached / not finished', text: "the last scan didn't check this region; the next scan tries again" },
  not_scanned: { label: 'Not scanned yet', text: 'enabled in this account, not scanned yet' },
  no_longer: { label: 'No longer scanned', text: "your former home region; it isn't scanned while multi-region scanning is off" },
  not_enabled: { label: 'Not enabled', text: "an opt-in region this account hasn't enabled; nothing to scan" },
}
const LEGEND_ORDER: StatusKey[] = ['complete', 'partial', 'scanning', 'waiting', 'couldnt', 'notdone', 'not_scanned', 'no_longer', 'not_enabled']

const STATUS = (key: StatusKey, label = LEGEND_TEXT[key].label): RowStatus => ({ key, label })

export type NoteTone = 'info' | 'warn' | 'danger'
export interface CardNote { key: string; tone: NoteTone; parts: Rich }

export interface PanelRow {
  key: string
  kind: 'region' | 'group'
  /** A region name (monospace), or a group label. */
  label: string
  home?: boolean
  /** PR 3c: the former home region (flag off): the "former home" chip. */
  formerHome?: boolean
  sublabel?: string
  /** A group's regions, behind "Show regions". */
  regions?: string[]
  regionsLabel?: string
  muted?: boolean
  /** null renders "—" (never 0). */
  resources: number | null
  resourcesNote?: string
  status: RowStatus | null
  /** "Last full scan": one time, a range (text), or null for "—". */
  lastFull: { iso: string } | string | null
  details: string | null
  /** Shown under Details once the group is open (S33b). */
  detailsWhenOpen?: string
}

export interface GlobalRow { key: 'cloudfront'; label: string; resources: number; status: RowStatus | null; lastFull: { iso: string } | null }

export interface CoverageCardView {
  multiRegion: boolean
  line: OrganisingLine
  homeLine: string | null
  notes: CardNote[]
  rows: PanelRow[]
  global: GlobalRow | null
  legend: { key: StatusKey; label: string; text: string }[]
  footer: Rich[]
}

function earlierNote(r: { resources_from: MultiRegionRegion['resources_from'] }): string | undefined {
  return r.resources_from === 'earlier_success' ? REDESIGN_COPY.fromEarlier : undefined
}

/** "today, 4:31–4:36 PM": one group's last full scans, from the earliest to the latest; null when none. */
export function timeRange(isos: (string | null)[], now: number): { iso: string } | string | null {
  const times = isos.filter((x): x is string => !!x).map((x) => Date.parse(x)).filter(Number.isFinite).sort((a, b) => a - b)
  if (times.length === 0) return null
  const [lo, hi] = [times[0], times[times.length - 1]]
  if (lo === hi) return { iso: new Date(lo).toISOString() }
  const a = formatWhen(new Date(lo).toISOString(), now)
  const b = formatWhen(new Date(hi).toISOString(), now)
  const day = (s: string) => s.slice(0, s.lastIndexOf(', '))
  if (day(a) === day(b)) {
    const range = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).formatRange(lo, hi)
    return `${day(a)}, ${range.replace(/[   ]/g, ' ').replace(/\s*–\s*/, '–')}`
  }
  return `${a} – ${b}`
}

function groupRow(key: string, label: string, list: MultiRegionRegion[], status: RowStatus, details: string, now: number, ariaLabel: string): PanelRow {
  const counts = list.map((r) => r.resources).filter((n): n is number => typeof n === 'number')
  const earlier = list.some((r) => r.resources_from === 'earlier_success')
  return {
    key, kind: 'group', label, regions: list.map((r) => r.region), regionsLabel: ariaLabel,
    resources: counts.length > 0 ? counts.reduce((a, b) => a + b, 0) : null,
    resourcesNote: earlier && counts.length > 0 ? REDESIGN_COPY.fromEarlier : undefined,
    status, lastFull: timeRange(list.map((r) => r.last_success_at), now), details,
  }
}

function s3ListedIn(c: ServicesCoverage, regions: string[]): number {
  return c.scope.s3.regions.filter((r) => r.region !== null && regions.includes(r.region)).reduce((n, r) => n + r.count, 0)
}

function notScannedGroup(c: ServicesCoverage, regions: string[]): PanelRow {
  const n = regions.length
  const s3 = s3ListedIn(c, regions)
  return {
    key: 'not-scanned', kind: 'group', label: `${n} ${regionsWord(n)} not scanned yet`, regions, regionsLabel: 'Regions not scanned yet',
    resources: null, resourcesNote: s3 > 0 ? `${num(s3)} S3 ${plural(s3, 'bucket', 'buckets')} listed` : undefined,
    status: STATUS('not_scanned'), lastFull: null, details: REDESIGN_COPY.notScannedDetails,
  }
}

function notEnabledGroup(regions: string[]): PanelRow | null {
  if (regions.length === 0) return null
  return {
    key: 'not-enabled', kind: 'group', label: `Not enabled in this account (${regions.length})`, regions, regionsLabel: 'Regions not enabled', muted: true,
    resources: null, status: STATUS('not_enabled'), lastFull: null, details: REDESIGN_COPY.notEnabledDetails, detailsWhenOpen: REDESIGN_COPY.notEnabledOpen,
  }
}

/** One region of `multi_region.regions` as a row of its own. Exported for servicesTruth.ts (PR 3d-1 H-1: the home region's check). */
export function regionRow(r: MultiRegionRegion): PanelRow {
  const base = {
    key: `region-${r.region}`, kind: 'region' as const, label: r.region, home: r.home, sublabel: r.opt_in ? REDESIGN_COPY.optIn : undefined,
    resources: r.resources, resourcesNote: earlierNote(r), lastFull: r.last_success_at ? { iso: r.last_success_at } : null,
  }
  const code = failureCode(r)
  if (code) {
    return { ...base, status: STATUS(code === 'region_not_ready' || code === 'region_deadline' || code === 'scan_budget' ? 'notdone' : 'couldnt', FAILURE_LABEL[code]), details: SHORT_DETAILS[code] }
  }
  switch (r.state) {
    case 'checked': return { ...base, status: STATUS('complete'), details: null }
    case 'checked_with_warnings': return { ...base, status: STATUS('partial'), details: partialText(r.error_code, r.region) }
    case 'in_progress':
      return r.result_of === null
        ? { ...base, resourcesNote: REDESIGN_COPY.neverScanned, status: STATUS('scanning'), details: null }
        : { ...base, status: STATUS('scanning'), details: REDESIGN_COPY.scanningDetails }
    case 'not_started':
      if (r.scan_state === 'waiting') {
        return r.result_of === null
          ? { ...base, resourcesNote: REDESIGN_COPY.neverScanned, status: STATUS('waiting'), details: REDESIGN_COPY.waitingNeverDetails }
          : { ...base, status: STATUS('waiting'), details: REDESIGN_COPY.waitingDetails }
      }
      return { ...base, status: STATUS('not_scanned'), details: REDESIGN_COPY.notScannedDetails }
    default:
      return { ...base, status: null, details: null }
  }
}

/** The panel's rows for a flagged organization: individual rows, then the collapsed groups, then never-scanned rows, then not enabled. */
export function multiRegionRows(c: ServicesCoverage, mr: MultiRegionCoverage, now: number): PanelRow[] {
  const own: MultiRegionRegion[] = []
  const neverScanned: MultiRegionRegion[] = []
  const empty: MultiRegionRegion[] = []
  const scanning: MultiRegionRegion[] = []
  const waiting: MultiRegionRegion[] = []
  const notScanned: MultiRegionRegion[] = []
  for (const r of mr.regions) {
    if (r.state === 'excluded') continue
    if (r.home) { own.push(r); continue }
    if (r.state === 'checked' && r.empty) { empty.push(r); continue }
    if (r.state === 'in_progress' || (r.state === 'not_started' && r.scan_state === 'waiting')) {
      if (r.result_of === null) { neverScanned.push(r); continue }
      if (r.resources === 0) { (r.state === 'in_progress' ? scanning : waiting).push(r); continue }
      own.push(r); continue
    }
    if (r.state === 'not_started') { notScanned.push(r); continue }
    own.push(r)
  }
  const rows: PanelRow[] = own.map(regionRow)
  if (empty.length > 0) rows.push(groupRow('empty', `${empty.length} ${regionsWord(empty.length)} checked · no resources`, empty, STATUS('complete'), REDESIGN_COPY.emptyDetails, now, 'Regions checked, no resources'))
  if (scanning.length > 0) rows.push(groupRow('scanning', `${scanning.length} ${regionsWord(scanning.length)} scanning`, scanning, STATUS('scanning'), REDESIGN_COPY.scanningDetails, now, 'Regions scanning'))
  if (waiting.length > 0) rows.push(groupRow('waiting', `${waiting.length} ${regionsWord(waiting.length)} waiting`, waiting, STATUS('waiting'), REDESIGN_COPY.waitingDetails, now, 'Regions waiting'))
  rows.push(...neverScanned.map(regionRow))
  if (notScanned.length > 0) rows.push(notScannedGroup(c, notScanned.map((r) => r.region)))
  const notEnabled = notEnabledGroup(mr.not_enabled_regions)
  if (notEnabled) rows.push(notEnabled)
  return rows
}

/** A home-only (unflagged) region_status row's status, from its last recorded status. Exported for servicesTruth.ts (PR 3d-1). */
export function homeOnlyStatus(r: RegionCoverage, running: boolean): { status: RowStatus | null; code: FailureCode | null } {
  if (running && r.home) return { status: STATUS('scanning'), code: null }
  switch (r.status) {
    case 'ok': return { status: STATUS('complete'), code: null }
    case 'partial': return { status: STATUS('partial'), code: null }
    case 'failed': return { status: STATUS('couldnt', FAILURE_LABEL.error), code: 'error' }
    case 'denied': return { status: STATUS('couldnt', FAILURE_LABEL.access_denied), code: 'access_denied' }
    case 'timed_out': return { status: STATUS('couldnt', FAILURE_LABEL.call_timeout), code: 'call_timeout' }
    case 'never_scanned': return { status: STATUS('not_scanned'), code: null }
    default: return { status: null, code: null }
  }
}

function storedCount(c: ServicesCoverage, region: string): number {
  return c.regions.find((r) => r.region === region)?.count ?? 0
}

/** The region rows an unflagged organization's panel lists: `region_status`, once the region list is known. */
export function homeOnlyRegionList(c: ServicesCoverage): RegionCoverage[] {
  return c.scope.enabled_regions.known ? c.region_status ?? [] : []
}

/**
 * The panel's rows for an unflagged organization (home region only; G7 for not enabled). Exported for
 * servicesTruth.ts (PR 3d-1 H-1): the other pages' region lines are built from these rows.
 */
export function homeOnlyRows(c: ServicesCoverage, home: string, now: number): PanelRow[] {
  const running = !!c.scan_in_progress
  const list = homeOnlyRegionList(c)
  const rows: PanelRow[] = []
  const notScanned: string[] = []
  const former = formerHomeOf(c)
  let formerRow: PanelRow | null = null
  if (list.length === 0) {
    // No region list yet: the home region from the jobs alone.
    const attempt = latestAttempt(c)
    const completed = attempt === 'completed'
    const warned = shownWarnings(c.last_scan?.warnings ?? []).length > 0
    rows.push({
      key: `region-${home}`, kind: 'region', label: home, home: true,
      resources: c.last_successful_scan_at ? c.scope.home_region?.count ?? 0 : null,
      status: running ? STATUS('scanning') : completed ? STATUS(warned ? 'partial' : 'complete') : null,
      lastFull: c.last_completed_scan?.completed_at && !warned ? { iso: c.last_completed_scan.completed_at } : null,
      details: running ? REDESIGN_COPY.scanningDetails : null,
    })
  }
  for (const r of list) {
    if (former && !r.home && r.region === former.region) { formerRow = formerHomeRow(c, r, former, now); continue }
    if (!r.home && r.status === 'never_scanned') { notScanned.push(r.region); continue }
    const { status, code } = homeOnlyStatus(r, running)
    const ok = r.status === 'ok' || r.status === 'partial'
    const hasEarlier = !!r.last_success_at
    rows.push({
      key: `region-${r.region}`, kind: 'region', label: r.region, home: r.home,
      resources: ok || hasEarlier ? storedCount(c, r.region) : null,
      resourcesNote: (!ok && hasEarlier) || (!r.home && hasEarlier) ? REDESIGN_COPY.fromEarlier : undefined,
      status, lastFull: r.last_success_at ? { iso: r.last_success_at } : null,
      details: running && r.home ? REDESIGN_COPY.scanningDetails
        : r.status === 'partial' ? partialText(r.last_error_code, r.region)
        : code ? SHORT_DETAILS[code] : null,
    })
  }
  // The former home sits right after the home row (mock tab 12).
  if (formerRow) rows.splice(rows.length > 0 && rows[0].home ? 1 : 0, 0, formerRow)
  if (notScanned.length > 0) rows.push(notScannedGroup(c, notScanned))
  const notEnabled = notEnabledGroup(c.not_enabled_regions ?? [])
  if (notEnabled) rows.push(notEnabled)
  return rows
}

/**
 * The former home row (flag off, PR 3c): "former home" chip, "No longer
 * scanned" (never a checked status, whatever its old result), V2-45 and V2-46.
 * Resources: the stored count of the region (coverage `regions`, as every row);
 * V2-45 names the S3 buckets checked by the last completed scan (only when S3
 * was in it) and the G2b count from earlier scans. A 0 segment is left out.
 */
function formerHomeRow(c: ServicesCoverage, r: RegionCoverage, former: FormerHome, now: number): PanelRow {
  const s3 = c.scope.s3.regions.find((x) => x.region === former.region)?.count ?? 0
  const done = c.last_completed_scan?.completed_at ?? null
  const when = done ? formatWhen(done, now) : ''
  const day = when.includes(', ') ? when.slice(0, when.lastIndexOf(', ')) : when
  const note = seg([
    claimed(c).s3 && s3 > 0 && day && `${num(s3)} S3 ${plural(s3, 'bucket', 'buckets')} checked ${day}`,
    former.earlier !== null && former.earlier > 0 && `${num(former.earlier)} from earlier scans`,
  ])
  return {
    key: `region-${r.region}`, kind: 'region', label: r.region, formerHome: true,
    resources: storedCount(c, r.region), resourcesNote: note || undefined,
    status: STATUS('no_longer'), lastFull: r.last_success_at ? { iso: r.last_success_at } : null,
    details: REDESIGN_COPY.formerHomeDetails,
  }
}

/** S3 / CloudFront are claimed only when in the newest scan's scope AND in the last completed scan (M6 Q5). */
function claimed(c: ServicesCoverage): { s3: boolean; cloudfront: boolean } {
  const types = c.last_completed_scan?.resource_types ?? []
  return { s3: c.scope.s3.in_last_scan && types.includes('s3'), cloudfront: c.scope.cloudfront.in_last_scan && types.includes('cloudfront') }
}

/** "CloudFront · 3 distributions" under "Global resources (not a region)"; outside every region count. */
function globalRow(c: ServicesCoverage): GlobalRow | null {
  const n = c.scope.cloudfront.count
  if (n <= 0) return null
  const done = claimed(c).cloudfront && c.last_completed_scan?.completed_at
  return {
    key: 'cloudfront', label: `CloudFront · ${num(n)} ${plural(n, 'distribution', 'distributions')}`, resources: n,
    status: done ? STATUS('complete') : null, lastFull: done ? { iso: c.last_completed_scan!.completed_at } : null,
  }
}

function notesOf(c: ServicesCoverage, mr: MultiRegionCoverage | null, now: number): CardNote[] {
  const notes: CardNote[] = []
  const lastDone = c.last_completed_scan?.completed_at ?? null
  if (mr) {
    if (mr.coverage_status === 'in_progress' && mr.progress && lastDone) {
      const r = mr.progress.regions_running + mr.progress.regions_waiting
      if (r > 0) notes.push({ key: 'progress', tone: 'info', parts: [`Counts for the ${num(r)} ${regionsWord(r)} still running or waiting come from the scan that finished `, { iso: lastDone }, ', and may change when this scan finishes.'] })
    }
    if (mr.coverage_status === 'latest_scan_failed' && mr.scan) {
      const at = mr.scan.completed_at ?? mr.scan.started_at
      notes.push({ key: 'latest-failed', tone: 'danger', parts: failedNote(at, lastDone) })
    }
    for (const f of latestScanNotChecked(mr)) {
      notes.push({ key: `region-${f.region}`, tone: 'warn', parts: [regionNoteText(f.code, f.region, f.from === 'earlier_success' ? f.resources : null)] })
    }
    if (shownWarnings(c.last_scan?.warnings ?? []).includes('scan_deadline')) notes.push({ key: 'scan-deadline', tone: 'warn', parts: [REDESIGN_COPY.scanDeadline] })
    if (mr.region_warnings_unattributed.length > 0) notes.push({ key: 'unattributed', tone: 'warn', parts: [REDESIGN_COPY.unattributed] })
    for (const r of mr.regions) {
      if (r.stale && r.last_scan_finished_at && (r.state === 'checked' || r.state === 'checked_with_warnings') && r.result_of !== 'running_scan') {
        notes.push({ key: `stale-${r.region}`, tone: 'warn', parts: ['These results may be out of date. ', `${r.region} was last scanned `, { iso: r.last_scan_finished_at }, '; scans normally run every 6 hours.'] })
      }
    }
  } else {
    if (latestAttempt(c) === 'unfinished' && c.last_scan) {
      notes.push({ key: 'latest-failed', tone: 'danger', parts: failedNote(c.last_scan.completed_at ?? c.last_scan.started_at, lastDone) })
    }
    // HR-S18 (PR 3c): the former home's resources from earlier scans, only when there are some.
    const former = formerHomeOf(c)
    const home = homeRegionOf(c)
    if (former && home && former.earlier !== null && former.earlier > 0) {
      const n = former.earlier
      notes.push({
        key: 'former-home', tone: 'info',
        parts: [`${num(n)} ${plural(n, 'resource', 'resources')} in ${former.region} ${plural(n, 'is', 'are')} from earlier scans. ${former.region} hasn't been scanned since your home region moved to ${home} on ${dayText(former.changedAt, now)}.`],
      })
    }
  }
  return notes
}

/** S17. Without a scan that finished, the last clause is left out. */
function failedNote(at: string | null, lastDone: string | null): Rich {
  const head: Rich = at ? ['The most recent scan attempt, at ', { iso: at }, ", didn't finish."] : ["The most recent scan attempt didn't finish."]
  return [...head, ' Region results below are from the last check of each region', ...(lastDone ? ['; other results are from the scan that finished at ', { iso: lastDone }, '.'] : ['.'])]
}

export function describeCoverageCard(c: ServicesCoverage, now: number): CoverageCardView {
  const mr = multiRegionOf(c)
  const home = homeRegionOf(c)
  const rows = mr ? multiRegionRows(c, mr, now) : home ? homeOnlyRows(c, home, now) : []
  const global = globalRow(c)
  const present = new Set<StatusKey>()
  for (const r of rows) if (r.status) present.add(r.status.key)
  if (global?.status) present.add(global.status.key)
  const footer: Rich[] = []
  const scope = claimed(c)
  if (mr) {
    footer.push([REDESIGN_COPY.footerMulti])
  } else if (home && scope.s3) {
    const outside = c.scope.s3.regions.filter((r) => r.region !== home).reduce((n, r) => n + r.count, 0)
    // Founder copy fix (PR 3c): with no bucket outside the home region, no count clause.
    footer.push([outside > 0
      ? `S3 and CloudFront are checked in every region on each scan: ${num(outside)} S3 ${plural(outside, 'bucket', 'buckets')} outside ${home}.`
      : REDESIGN_COPY.footerOffNone])
  }
  const { listed_at: listedAt, stale } = c.scope.enabled_regions
  if (listedAt && (stale === true || mr?.regions.some((r) => r.opt_in))) footer.push([REDESIGN_COPY.listRead, { iso: listedAt }, '.'])
  return {
    multiRegion: !!mr,
    line: organisingLine(c),
    homeLine: home ? REDESIGN_COPY.homeLine(home) : null,
    notes: notesOf(c, mr, now),
    rows,
    global,
    legend: LEGEND_ORDER.filter((k) => present.has(k)).map((key) => ({ key, ...LEGEND_TEXT[key] })),
    footer,
  }
}

// ── Tiles ──

/** V2-20: "in 2 regions", "in 1 region", "in 2 regions, plus 1 global (CloudFront)", "1 global (CloudFront)". */
export function attentionScopeCaption(stats: AWSServicesStats | undefined): string | null {
  const s = stats?.attention_scope
  if (!s || !(stats!.needs_attention > 0)) return null
  const global = s.global > 0 ? `${num(s.global)} global (CloudFront)` : null
  if (s.regions > 0) return `in ${num(s.regions)} ${regionsWord(s.regions)}${global ? `, plus ${global}` : ''}`
  return global
}

/** The Resources tile's captions: S21 / S21b and V2-21 for a flagged organization; today's caption otherwise. */
export function resourcesCaptions(c: ServicesCoverage | undefined): { scope: string | null; earlier: string | null } {
  const mr = c ? multiRegionOf(c) : null
  if (!c || !mr) {
    // V2-21 flag off (PR 3c): the former home's resources from earlier scans (G2b), when there are some.
    const former = formerHomeOf(c)
    const k = former?.earlier ?? 0
    return { scope: resourcesScopeCaption(c), earlier: former && k > 0 ? `${num(k)} in ${former.region} from earlier scans` : null }
  }
  const withResources = mr.regions.filter((r) => (r.resources ?? 0) > 0)
  const cf = c.scope.cloudfront.count
  const plusGlobal = cf > 0 ? `, plus ${num(cf)} global (CloudFront)` : ''
  const scope = withResources.length === 1 ? `in ${withResources[0].region}${plusGlobal}`
    : withResources.length > 1 ? `in ${num(withResources.length)} regions${plusGlobal}`
    : cf > 0 ? `${num(cf)} global (CloudFront)` : null
  const k = mr.regions.filter((r) => r.resources_from === 'earlier_success').reduce((n, r) => n + (r.resources ?? 0), 0)
  const earlier = k > 0 ? `${num(k)} from an earlier scan${mr.coverage_status === 'in_progress' ? '; may change when the scan finishes' : ''}` : null
  return { scope, earlier }
}

/** All resources' subtitle after the count: nothing for a flagged organization (S23 "{n} resources"), today's scope otherwise. */
export function allResourcesScope(c: ServicesCoverage | undefined): string | null {
  return c && multiRegionOf(c) ? null : resourcesScopeCaption(c)
}

// ── What we didn't check (option b) ──

/** V2-47 (PR 3c, flag off): "{r} hasn't been scanned since {day}, except for S3 buckets." Shared with servicesTruth.ts (PR 3d-1 H-1). */
export function formerHomeLine(former: FormerHome, now: number): string {
  return `${former.region} hasn't been scanned since ${dayText(former.changedAt, now)}, except for S3 buckets.`
}

export interface NotCheckedView { summary: string | null; lines: NotCheckedLine[] }

/** The closed line when no line has a short form (CURRENT heading). */
export const NOT_CHECKED_HEADING = "What we didn't check"

const SHORT_ITEM: Record<string, (line: NotCheckedLine, stats: AWSServicesStats | undefined) => string | null> = {
  'last-scan-failed': () => "the last scan didn't finish",
  regions: (line) => (line.text.includes('except for S3') ? 'other enabled regions (S3 only)' : 'other enabled regions'),
  iam: () => 'IAM',
  'cloudfront-tags': () => 'CloudFront tags',
  'tags-unknown': (_l, stats) => {
    const n = stats?.ownership?.unknown ?? 0
    return `${num(n)} ${n === 1 ? "resource's" : "resources'"} tags`
  },
  types: () => 'other resource types',
}
const LINE_ORDER = ['last-scan-failed', 'regions', 'iam', 'cloudfront-tags', 'tags-unknown']

/**
 * Option b (Q5): "Not checked: {items ·} …." with the full lines behind
 * Details. Flagged: the region lines of the latest scan come first, there is
 * no "other enabled regions" line (they are scanned), and the job's warning
 * codes are not repeated here (the coverage card carries them, by region).
 */
export function describeNotChecked(c: ServicesCoverage, stats: AWSServicesStats | undefined, now: number, inTabWarnings: readonly string[]): NotCheckedView {
  const mr = multiRegionOf(c)
  const base = notCheckedLines(c, stats, now, mr ? [] : inTabWarnings, true, true)
    .filter((l) => !(mr && (l.key === 'regions' || l.key.startsWith('warning-'))))
  const regionLines: (NotCheckedLine & { short: string })[] = mr
    ? latestScanNotChecked(mr).map((f) => ({ key: `region-${f.region}`, text: reasonLine(f.code, f.region), short: `${f.region} on the last scan` }))
    : []
  const rank = (key: string) => {
    const i = LINE_ORDER.indexOf(key)
    return i >= 0 ? i : LINE_ORDER.length
  }
  const ordered = [...base].sort((a, b) => rank(a.key) - rank(b.key))
  // V2-47 (PR 3c, flag off): the former home region, right after the "other enabled regions" line.
  const former = formerHomeOf(c)
  if (former) {
    const at = ordered.findIndex((l) => l.key === 'regions')
    ordered.splice(at >= 0 ? at + 1 : 0, 0, { key: 'former-home', text: formerHomeLine(former, now) })
  }
  const lines: NotCheckedLine[] = [...regionLines.map(({ key, text }) => ({ key, text })), ...ordered]
  if (lines.length === 0) return { summary: null, lines }
  const items = [
    ...regionLines.map((l) => l.short),
    ...ordered.map((l) => (l.key === 'former-home' && former ? `${former.region} since ${dayText(former.changedAt, now)}` : SHORT_ITEM[l.key]?.(l, stats) ?? null)).filter((x): x is string => !!x),
  ]
  return { summary: items.length > 0 ? `Not checked: ${items.join(' · ')}.` : NOT_CHECKED_HEADING, lines }
}
