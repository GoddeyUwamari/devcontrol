/**
 * Services & Ownership's truth for the other pages (PR 3d-1). Infrastructure,
 * Security, the Dashboard and Connect AWS read scan state and region coverage
 * from here, so they say what the Services page says, from the same server
 * fields, with the same rules. Pure: no React, no fetch, no Date.now().
 *
 * Founder decisions (3d step 1, Nov 18):
 * - D3 (a): one scan state, exactly Services' header rule (redesignScanLine).
 *   Flagged (`multi_region` present) reads `coverage_status` / `progress`;
 *   flag off reads latestAttempt() and the `scan_in_progress` lease. Failed and
 *   abandoned are both "didn't finish". No time heuristic.
 * - D6 (a): region coverage from the server fields Services uses
 *   (`home_only_coverage` flag off, `multi_region.scan` flagged) and in
 *   Services' words. Nothing here counts `region_status` rows as "checked"
 *   (the old M6 regionCounts() did, counting failures and a former home).
 *
 * Every string below is a Services string or is built from one; nothing here
 * names a region that the response did not send.
 */
import type { MultiRegionCoverage, ServicesCoverage } from '@/lib/services/aws-services.service'
import { formatLocalWhen } from '@/lib/utils/localTime'
import { lastCompletedScanIso } from '@/lib/scan-time'
import {
  FAILURE_LABEL, LAST_SCAN_FINISHED, dayText, failureCode, formerHomeOf, homeOnlyStatus, homeRegionOf,
  latestScanNotChecked, multiRegionOf, organisingLine, redesignScanLine, scanIsRunning,
  type RedesignScanLine, type RedesignScanState,
} from './redesignModel'

export { homeRegionOf, scanIsRunning }

// ── Scan state (D3) ──

export type ScanStateKind = RedesignScanState
export type ScanState = RedesignScanLine

/**
 * The scan state and its line, exactly as the Services header shows it:
 * - running: "Scan in progress since {t} · {d} of {n} regions done" (flagged),
 *   "Scan in progress since {t} · showing results from {last}" or
 *   "… · no scan has finished yet" (flag off);
 * - failed (failed or abandoned): "Last scan: {at} · didn't finish";
 * - finished: "Last scan finished {when}";
 * - none: "No scan has finished yet."
 * Partial is not a scan state: a finished scan with partial regions is
 * "finished", and the region coverage line says "partly checked".
 */
export function scanState(c: ServicesCoverage, now: number): ScanState {
  return redesignScanLine(c, now)
}

/** The first time in a scan-state line: its instant and the words the line prints for it. */
export interface ScanStateTime { iso: string; text: string }

/**
 * The time the scan-state line names first (finished: the last finished scan; didn't finish: that
 * attempt; running: when it started), with the exact words scanState printed for it, so a page can
 * keep its focusable exact-time tooltip (ScanTime) without changing the line. null when the line
 * names no time, or when the words aren't found in the line (never guessed).
 */
export function scanStateTime(c: ServicesCoverage, now: number): ScanStateTime | null {
  const s = scanState(c, now)
  const mr = multiRegionOf(c)
  const iso = s.state === 'finished' ? lastCompletedScanIso(c)
    : s.state === 'failed' ? (mr ? mr.scan?.completed_at ?? mr.scan?.started_at : c.last_scan?.completed_at ?? c.last_scan?.started_at)
    : s.state === 'running' ? (mr ? mr.scan?.started_at ?? mr.progress?.scan_started_at : c.scan_in_progress?.since)
    : null
  if (!iso) return null
  const when = formatLocalWhen(iso, now)
  if (!when) return null
  // The running line prints a time started today without "today, " (redesignScanLine sinceText).
  const text = s.state === 'running' && when.startsWith('today, ') ? when.slice('today, '.length) : when
  return s.text.includes(text) ? { iso, text } : null
}

/** The scan-state line as text parts around its first time (for RichText); the plain line when it names none. */
export function scanStateParts(c: ServicesCoverage, now: number): (string | { iso: string; text: string })[] {
  const { text } = scanState(c, now)
  const time = scanStateTime(c, now)
  if (!time) return [text]
  const at = text.indexOf(time.text)
  return [text.slice(0, at), time, text.slice(at + time.text.length)].filter((p) => p !== '')
}

/** "last scan finished today, 6:02 PM" (the Dashboard's freshness row); null with no finished scan. */
export function lastScanFinishedPhrase(c: ServicesCoverage, now: number): string | null {
  const when = formatLocalWhen(lastCompletedScanIso(c), now)
  if (!when) return null
  return `${LAST_SCAN_FINISHED.charAt(0).toLowerCase()}${LAST_SCAN_FINISHED.slice(1)} ${when}`
}

// ── Region coverage (D6) ──

/**
 * Services' organising line: "1 of 17 regions checked · us-east-1",
 * "0 of 17 regions checked · us-east-1 · us-east-1 couldn't be checked",
 * "Last scan failed after checking 3 of 4 regions · …" (RR-L2), and so on.
 */
export function coverageLine(c: ServicesCoverage): string {
  return organisingLine(c).text
}

/** The region-list-not-read part, unchanged from the Infrastructure and Security pages. */
export const REGION_LIST_NOT_READ_PART = 'other regions (region list not read yet)'

export type RegionGapKey =
  | 'home-couldnt' | 'home-not-scanned' | 'former-home' | 'not-scanned' | 'earlier'
  | 'not-checked-by-scan' | 'still-running'

/**
 * One kind of region the last results don't count as checked, in Services'
 * words. `short` is the item form; `long` is the line form ("What we
 * checked"). `notScanned` (3d-1 founder ruling, Nov 18): its item under
 * "Not scanned yet: …" ("16 regions"), only for a region that has never been
 * scanned (a former home region was scanned, so it is a segment of its own:
 * "{former} not scanned since {day}"). `home`: it is about the home region.
 */
export interface RegionGap { key: RegionGapKey; short: string; long: string; home: boolean; notScanned?: string }

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)
const num = (n: number) => n.toLocaleString('en-US')
const regionsWord = (n: number) => plural(n, 'region', 'regions')
const same = (key: RegionGapKey, text: string, home = false): RegionGap => ({ key, short: text, long: text, home })

/**
 * The regions that aren't checked, by kind, from the same fields and rules as
 * the Services coverage card. null when no region list is known (the caller
 * says "region list not read yet").
 *
 * Flag off (home_only_coverage, panel rows of homeOnlyRows):
 * - the home region, when G8 doesn't count it: "{home} couldn't be checked"
 *   (failed, denied, timed out: the organising line's rule) or
 *   "{home} not scanned yet";
 * - the former home region: "{r} not scanned since {day}" (founder ruling, Nov 18; it was scanned,
 *   so never "not scanned yet") / "{r} hasn't been scanned since {day}, except for S3 buckets." (V2-47);
 * - never-scanned regions: "{n} regions not scanned yet" (the group row);
 * - any other non-home region keeps an earlier result:
 *   "{n} regions from an earlier scan".
 * Flagged (multi_region.scan):
 * - while a scan runs: "{n} regions couldn't be checked" (done in this scan,
 *   not checked) and "{n} regions still running or waiting";
 * - otherwise the scan banner's rule: "{r} couldn't be checked" for one named
 *   region, else "{k} regions couldn't be checked" (k = total − checked);
 * - no scan yet: "{n} regions not scanned yet".
 */
export function regionGaps(c: ServicesCoverage, now: number): RegionGap[] | null {
  const mr = multiRegionOf(c)
  return mr ? flaggedGaps(mr) : homeOnlyGaps(c, now)
}

function homeOnlyGaps(c: ServicesCoverage, now: number): RegionGap[] | null {
  const h = c.home_only_coverage
  const home = homeRegionOf(c)
  const list = c.scope.enabled_regions.known ? c.region_status ?? [] : []
  if (!h || !home || list.length === 0) return null
  const gaps: RegionGap[] = []
  const homeRow = list.find((r) => r.home)
  if (h.regions_checked === 0 && homeRow) {
    if (['failed', 'denied', 'timed_out'].includes(homeRow.status)) gaps.push(same('home-couldnt', `${home} couldn't be checked`, true))
    else if (homeRow.status === 'never_scanned') gaps.push({ ...same('home-not-scanned', `${home} not scanned yet`, true), notScanned: home })
  }
  const former = formerHomeOf(c)
  const others = list.filter((r) => !r.home)
  if (former && others.some((r) => r.region === former.region)) {
    const day = dayText(former.changedAt, now)
    gaps.push({ key: 'former-home', short: `${former.region} not scanned since ${day}`, long: `${former.region} hasn't been scanned since ${day}, except for S3 buckets.`, home: false })
  }
  const rest = others.filter((r) => r.region !== former?.region)
  const notScanned = rest.filter((r) => r.status === 'never_scanned').length
  if (notScanned > 0) gaps.push({ ...same('not-scanned', `${num(notScanned)} ${regionsWord(notScanned)} not scanned yet`), notScanned: `${num(notScanned)} ${regionsWord(notScanned)}` })
  const earlier = rest.length - notScanned
  if (earlier > 0) gaps.push(same('earlier', `${num(earlier)} ${regionsWord(earlier)} from an earlier scan`))
  return gaps
}

function flaggedGaps(mr: MultiRegionCoverage): RegionGap[] | null {
  if (mr.regions.length === 0) return null
  const s = mr.scan
  const gaps: RegionGap[] = []
  if (!s || mr.coverage_status === 'unavailable') {
    const n = mr.regions.filter((r) => r.state === 'not_started' && r.scan_state !== 'waiting').length
    if (n > 0) gaps.push({ ...same('not-scanned', `${num(n)} ${regionsWord(n)} not scanned yet`), notScanned: `${num(n)} ${regionsWord(n)}` })
    return gaps
  }
  if (mr.coverage_status === 'in_progress') {
    const p = mr.progress
    const failedSoFar = p ? Math.max(0, p.regions_done - s.regions_checked) : 0
    const left = p ? p.regions_running + p.regions_waiting : 0
    if (failedSoFar > 0) gaps.push(same('not-checked-by-scan', `${num(failedSoFar)} ${regionsWord(failedSoFar)} couldn't be checked`))
    if (left > 0) gaps.push(same('still-running', `${num(left)} ${regionsWord(left)} still running or waiting`))
    return gaps
  }
  const k = Math.max(0, s.regions_total - s.regions_checked)
  if (k > 0) {
    const named = latestScanNotChecked(mr)
    gaps.push(same('not-checked-by-scan', k === 1 && named.length === 1 ? `${named[0].region} couldn't be checked` : `${num(k)} ${regionsWord(k)} couldn't be checked`))
  }
  return gaps
}

/**
 * The "what isn't checked" line on Infrastructure and Security (3d-1 founder ruling, Nov 18), `last`
 * being the page's own last item ("IAM roles and policies"):
 * - "Not scanned yet: 16 regions · IAM roles and policies";
 * - with the home region not counted as checked, Services' segment first:
 *   "us-east-1 couldn't be checked · Not scanned yet: 16 regions · IAM roles and policies";
 * - a former home region is its own segment: "us-east-1 not scanned since Nov 14 · Not scanned yet: 2 regions · …";
 * - any other region that is neither checked nor unscanned (an earlier scan's result; flagged:
 *   couldn't be checked, still running or waiting) is a segment before it, in Services' words;
 * - with no unscanned region the clause keeps the existing "Not checked yet: {last}";
 * - with no region list: "Not checked yet: other regions (region list not read yet) · {last}" (unchanged).
 */
export function notCheckedLine(c: ServicesCoverage, now: number, last: string): string {
  const gaps = regionGaps(c, now)
  if (!gaps) return `Not checked yet: ${[REGION_LIST_NOT_READ_PART, last].join(' · ')}`
  const before = gaps.filter((g) => g.notScanned === undefined).map((g) => g.short)
  const unscanned = gaps.filter((g) => g.notScanned !== undefined).map((g) => g.notScanned!)
  const clause = unscanned.length > 0 ? `Not scanned yet: ${[...unscanned, last].join(' · ')}` : `Not checked yet: ${last}`
  return [...before, clause].join(' · ')
}

// ── The home region's last check ──

export interface HomeRegionCheck { kind: 'checked' | 'partial' | 'couldnt'; label: string }

export const HOME_CHECKED = 'Checked'
export const HOME_PARTLY_CHECKED = 'Partly checked'

/**
 * The home region's last result in the Services coverage card's words:
 * "Checked", "Partly checked" (Partial), or the card's failure label
 * ("Couldn't check: access denied", …). Flagged: the home row's `state`
 * when it has a result; otherwise (and flag off) its last recorded status,
 * mapped as the Services card maps it. null when nothing says.
 */
export function homeRegionCheck(c: ServicesCoverage): HomeRegionCheck | null {
  const mr = multiRegionOf(c)
  const homeRegion = mr?.regions.find((r) => r.home)
  if (homeRegion) {
    const code = failureCode(homeRegion)
    if (code) return { kind: 'couldnt', label: FAILURE_LABEL[code] }
    if (homeRegion.state === 'checked') return { kind: 'checked', label: HOME_CHECKED }
    if (homeRegion.state === 'checked_with_warnings') return { kind: 'partial', label: HOME_PARTLY_CHECKED }
  }
  const row = (c.region_status ?? []).find((r) => r.home)
  if (!row) return null
  const { status, code } = homeOnlyStatus(row, false)
  if (code) return { kind: 'couldnt', label: FAILURE_LABEL[code] }
  if (status?.key === 'partial') return { kind: 'partial', label: HOME_PARTLY_CHECKED }
  if (status?.key === 'complete') return { kind: 'checked', label: HOME_CHECKED }
  return null
}
