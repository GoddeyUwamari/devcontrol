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
import type { HomeRegionAccountView } from '@/lib/services/aws-accounts.service'
import { formatLocalWhen } from '@/lib/utils/localTime'
import { lastCompletedScanIso } from '@/lib/scan-time'
import {
  LAST_SCAN_FINISHED, dayText, formerHomeLine, formerHomeOf, homeCouldntBeChecked, homeOnlyRegionList, homeOnlyRows,
  homeOnlyStatus, homeRegionOf, multiRegionOf, multiRegionRows, organisingLine, redesignScanLine, redesignScanLineTime, regionRow,
  scanIsRunning, scanNotCheckedWho, scanSoFar, type RedesignScanLine, type RedesignScanState, type RowStatus, type ScanLineTime,
} from './redesignModel'
import { homeRegionPromptShows } from './homeRegionModel'

// Flag-on prep (Nov 19): multiRegionOf tells a page the organization is switched on (`multi_region` present).
export { homeRegionOf, multiRegionOf, scanIsRunning }
// PR 3d-2 (D4, D7): the shared needs-attention sentence and the links into Services.
export { ATTENTION_DEFINITION, NEEDS_ATTENTION_HREF, REGION_COVERAGE_HREF, REGION_COVERAGE_LINK } from './redesignModel'
// Nov 21 founder ruling: the scan warnings that describe the home region (flagged: a Resource Explorer code only from its own row).
export { homeRegionWarnings } from './coverage'

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
export type ScanStateTime = ScanLineTime

/**
 * The time the scan-state line names first (finished: the last finished scan; didn't finish: that
 * attempt; running: when it started), with the exact words scanState printed for it, so a page can
 * keep its focusable exact-time tooltip (ScanTime) without changing the line. Services' own export
 * (redesignScanLineTime: the instant redesignScanLine formats; PR 3d-2, 3d-1 review RR-L1), never
 * picked here. null when the line names no time.
 */
export function scanStateTime(c: ServicesCoverage, now: number): ScanStateTime | null {
  return redesignScanLineTime(c, now)
}

/** The scan-state line as text parts around its first time (for RichText); the plain line when it names none. */
export function scanStateParts(c: ServicesCoverage, now: number): (string | { iso: string; text: string })[] {
  const { text } = scanState(c, now)
  const time = scanStateTime(c, now)
  if (!time) return [text]
  const at = text.indexOf(time.text)
  if (at < 0) return [text]
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
 * "0 of 17 regions checked · us-east-1 couldn't be checked" (PR 3d-2 N11: the region named once),
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
 * The regions that aren't checked, by kind, from the Services coverage card's
 * own rows and rules (PR 3d-1 H-1: called, never copied). null when no region
 * list is known (the caller says "region list not read yet").
 *
 * Flag off (home_only_coverage; the card's rows, homeOnlyRows):
 * - the home region: "{home} couldn't be checked" by the organising line's
 *   rule (homeCouldntBeChecked), or "{home} not scanned yet" when its last
 *   status is the card's "Not scanned yet" (homeRegionCheck; a home region
 *   changed and not scanned since, the contract's former_home_ok);
 * - the card's former-home row: "{r} not scanned since {day}" (founder ruling, Nov 18; it was
 *   scanned, so never "not scanned yet") / Services' V2-47 line (formerHomeLine);
 * - the card's "{n} regions not scanned yet" group row, its label as it is;
 * - the card's other non-home region rows (an earlier scan's result):
 *   "{n} regions from an earlier scan".
 * Flagged (multi_region.scan):
 * - while a scan runs, the organising line's counts (scanSoFar): "{n} regions
 *   couldn't be checked" and "{n} regions still running or waiting";
 * - otherwise the scan banner's "who" (scanNotCheckedWho);
 * - no scan yet: "{n} regions not scanned yet".
 */
export function regionGaps(c: ServicesCoverage, now: number): RegionGap[] | null {
  const mr = multiRegionOf(c)
  return mr ? flaggedGaps(c, mr, now) : homeOnlyGaps(c, now)
}

function homeOnlyGaps(c: ServicesCoverage, now: number): RegionGap[] | null {
  const home = homeRegionOf(c)
  if (!c.home_only_coverage || !home || homeOnlyRegionList(c).length === 0) return null
  const rows = homeOnlyRows(c, home, now)
  const gaps: RegionGap[] = []
  if (homeCouldntBeChecked(c)) gaps.push(same('home-couldnt', `${home} couldn't be checked`, true))
  else if (homeRegionCheck(c)?.kind === 'not_scanned') gaps.push({ ...same('home-not-scanned', `${home} not scanned yet`, true), notScanned: home })
  const former = formerHomeOf(c)
  const formerRow = rows.find((r) => r.formerHome)
  if (former && formerRow) {
    gaps.push({ key: 'former-home', short: `${formerRow.label} not scanned since ${dayText(former.changedAt, now)}`, long: formerHomeLine(former, now), home: false })
  }
  const group = rows.find((r) => r.kind === 'group' && r.key === 'not-scanned')
  if (group) {
    const n = group.regions?.length ?? 0
    gaps.push({ ...same('not-scanned', group.label), notScanned: `${num(n)} ${regionsWord(n)}` })
  }
  const earlier = rows.filter((r) => r.kind === 'region' && !r.home && !r.formerHome).length
  if (earlier > 0) gaps.push(same('earlier', `${num(earlier)} ${regionsWord(earlier)} from an earlier scan`))
  return gaps
}

/**
 * Flagged. Flag-on prep (3d-1 review RR-L2): the never-scanned regions are the Services card's own
 * rows (multiRegionRows, called, never copied): the home row when it is "Not scanned yet" is its own
 * gap ("{home} not scanned yet", as homeOnlyGaps), and the "{n} regions not scanned yet" group is
 * the card's group, so the home region is never counted in it. A finished scan's "couldn't be
 * checked" leaves those never-scanned regions out (they were never tried: right after the switch,
 * the newest job is the last home-only scan).
 */
function flaggedGaps(c: ServicesCoverage, mr: MultiRegionCoverage, now: number): RegionGap[] | null {
  if (mr.regions.length === 0) return null
  const s = mr.scan
  const gaps: RegionGap[] = []
  if (s && mr.coverage_status === 'in_progress') {
    const { failedSoFar, left } = scanSoFar(mr.progress, s.regions_checked)
    if (failedSoFar > 0) gaps.push(same('not-checked-by-scan', `${num(failedSoFar)} ${regionsWord(failedSoFar)} couldn't be checked`))
    if (left > 0) gaps.push(same('still-running', `${num(left)} ${regionsWord(left)} still running or waiting`))
    return gaps
  }
  const rows = multiRegionRows(c, mr, now)
  const homeRow = rows.find((r) => r.kind === 'region' && r.home && r.status?.key === 'not_scanned')
  const group = rows.find((r) => r.kind === 'group' && r.key === 'not-scanned')
  const grouped = group?.regions?.length ?? 0
  if (s && mr.coverage_status !== 'unavailable') {
    const never = (homeRow ? 1 : 0) + grouped
    const who = scanNotCheckedWho(mr, { regions_total: s.regions_total - never, regions_checked: s.regions_checked })
    if (who.k > 0) gaps.push(same('not-checked-by-scan', who.text))
  }
  if (homeRow) gaps.push({ ...same('home-not-scanned', `${homeRow.label} not scanned yet`, true), notScanned: homeRow.label })
  if (group && grouped > 0) gaps.push({ ...same('not-scanned', group.label), notScanned: `${num(grouped)} ${regionsWord(grouped)}` })
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

export interface HomeRegionCheck { kind: 'checked' | 'partial' | 'couldnt' | 'not_scanned'; label: string }

export const HOME_CHECKED = 'Checked'
export const HOME_PARTLY_CHECKED = 'Partly checked'

/** A Services card row status as the home region's check; null for a status that says nothing about it (scanning, waiting, …). */
function checkOf(status: RowStatus | null): HomeRegionCheck | null {
  switch (status?.key) {
    case 'complete': return { kind: 'checked', label: HOME_CHECKED }
    case 'partial': return { kind: 'partial', label: HOME_PARTLY_CHECKED }
    case 'couldnt':
    case 'notdone': return { kind: 'couldnt', label: status.label }
    case 'not_scanned': return { kind: 'not_scanned', label: status.label }
    default: return null
  }
}

/**
 * The home region's last result in the Services coverage card's words, from the card's own row status
 * (PR 3d-1 H-1: no second mapping): "Checked", "Partly checked" (Partial), the card's failure label
 * ("Couldn't check: access denied", …) or "Not scanned yet" (M-1: a home region changed and not scanned
 * since, never "Checked"). Flagged: the home row's status (regionRow) when it has a result; otherwise
 * (and flag off) its last recorded status (homeOnlyStatus, the card's classifier, without the running
 * scan: a scan in progress doesn't change the last result). null when nothing says.
 */
export function homeRegionCheck(c: ServicesCoverage): HomeRegionCheck | null {
  const homeRegion = multiRegionOf(c)?.regions.find((r) => r.home)
  if (homeRegion) {
    const check = checkOf(regionRow(homeRegion).status)
    if (check && check.kind !== 'not_scanned') return check
  }
  const row = (c.region_status ?? []).find((r) => r.home)
  return row ? checkOf(homeOnlyStatus(row, false).status) : null
}

// ── Home region on Connect AWS (PR 3d-2, D8) ──

/**
 * What Connect AWS shows next to "Home region · {r}", from the same GET /api/aws/accounts keys and
 * coverage response the Services page reads (useHomeRegion):
 * - `change`: "Change in Services & Ownership →", for the owner only (`can_change_home_region`, G9);
 * - `suggestion`: "DevControl has a home-region suggestion for this account. Review it in …", for the
 *   owner only, and only when Services' own banner would show (founder ruling, Nov 19): Services'
 *   visibility check (homeRegionPromptShows) on the server's `home_region_proposal` and the account's
 *   home region, with Services' precondition (coverage read, account connected). Nothing is worked out here.
 * Members, and an older server without the keys, get neither: the value only.
 */
export function connectHomeRegionLinks(
  view: HomeRegionAccountView | null | undefined, coverage: ServicesCoverage | null | undefined,
): { change: boolean; suggestion: boolean } {
  const owner = view?.canChangeHomeRegion === true
  const servicesShowsBanner = !!coverage?.account.connected && homeRegionPromptShows(view?.proposal, homeRegionOf(coverage))
  return { change: owner, suggestion: owner && servicesShowsBanner }
}
