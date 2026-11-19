/**
 * PR 3d-1 parity: Infrastructure, Security, the Dashboard and Connect AWS say
 * what the Services & Ownership page says, from the same coverage response,
 * for every case the founder listed (3d-1 brief, TESTS):
 *   home ok / home failed / denied / timed out / former home with an old ok /
 *   flagged latest_scan_failed / an abandoned job / partial / a scan running
 *   past 60 minutes with the lease held,
 * plus the flagged in-progress line that stays dormant until an organization
 * is flagged (brief item 7).
 *
 * The fixtures are the Services page's own (redesign-fixtures tab5 / tab8 /
 * tab2, home-region-fixtures tab12Coverage). Variants of tab5 change the home
 * region's status and set home_only_coverage by the server's G8 rule (doc
 * §15.2: 1 only when the current home's last status is ok or partial).
 *
 * Each case pins the Services values as literals (so a wrong shared rule
 * fails here, not only on one page), then checks every page's line equals them.
 *
 * Review fix round (3d1-review.md): H-1 ties Infrastructure's and Security's
 * region lines to the Services coverage card's own rows and banner, so a
 * Services rule change moves them too; H-2 / M-1 add the "new home region not
 * scanned yet" state (contract §15.2 former_home_ok).
 */
process.env.TZ = 'UTC'

import { describe, it, expect } from 'vitest'
import type { ServicesCoverage } from '@/lib/services/aws-services.service'
import { R_NOW, tab2, tab3Throttled, tab5, tab8 } from '../(app)/services/__tests__/redesign-fixtures'
import { tab12Coverage } from '../(app)/services/__tests__/home-region-fixtures'
import { describeCoverageCard, describeNotChecked, homeRegionOf, multiRegionOf, organisingLine, redesignScanLine, scanBanner } from '../(app)/services/redesignModel'
import { richText } from '../(app)/services/regionCoverage'
import { describeCoverage } from '../(app)/services/coverage'
import { homeRegionCheck, regionGaps, scanIsRunning, scanState } from '../(app)/services/servicesTruth'
import { describeOverview } from '../(app)/infrastructure/overview/overviewModel'
import { attentionPage, inputs, ready } from '../(app)/infrastructure/__tests__/overview-fixtures'
import { headerScanLine, notCheckedText, securityCheckedLines } from '../(app)/security/overview/securityModel'
import { dataFreshnessSegments, headerStatusLine } from '../(app)/dashboard/dashboardFreshness'

const NOW = R_NOW // 2026-11-15 16:30 UTC

/** tab5 with the home region's last status changed, and home_only_coverage by the server's rule. */
function homeStatus(status: string): ServicesCoverage {
  const c = tab5('ok')
  c.region_status[0].status = status
  c.home_only_coverage = { regions_total: 4, regions_checked: status === 'ok' || status === 'partial' ? 1 : 0 }
  return c
}

/** A running job with no lease: abandoned (the scanner's recovery hasn't marked it yet). */
function abandoned(): ServicesCoverage {
  const c = tab5('ok')
  c.last_scan = { status: 'running', started_at: '2026-11-15T12:00:00.000Z', completed_at: null, warnings: [] }
  return c
}

/** A scan running for 3.5 hours that still holds the lease: in progress (never "failed" by age). */
function longRunning(): ServicesCoverage {
  const c = tab5('ok')
  c.scan_in_progress = { since: '2026-11-15T13:00:00.000Z' }
  c.last_scan = { status: 'running', started_at: '2026-11-15T13:00:00.000Z', completed_at: null, warnings: [] }
  return c
}

/**
 * H-2 / M-1: the owner changed the home region (PR 3c) to us-west-2 and no scan has finished since, so the
 * new home's last status is never_scanned and G8 counts nothing (contract §15.2 former_home_ok: "us-west-2
 * has not been scanned yet"). The former home us-east-1 keeps its old ok.
 */
function newHomeNotScanned(): ServicesCoverage {
  const c = tab12Coverage()
  c.region_status[0] = { ...c.region_status[0], status: 'never_scanned', last_scan_finished_at: null, last_success_at: null }
  c.home_only_coverage = { regions_total: 4, regions_checked: 0 }
  return c
}

interface Expected {
  /** The Services header line (redesignScanLine) and state. */
  scan: { state: string; text: string }
  /** The Services coverage card's organising line. */
  line: string
  /** The "what isn't checked" line on Infrastructure and Security (founder ruling Nov 18: "Not scanned yet: …"). */
  notChecked: string
  /** Connect's home row "Last scan" cell, after "{count} · home · " (N1: never "complete" unless the home was checked). */
  connectHome: string
  /** Connect's headline above the table (N12: "{home} couldn't be checked" exactly when the cell says "couldn't check"). */
  connectHeadline: string
  /** The other-regions lines ("What we checked" on Infrastructure and Security). */
  otherRegions: string[]
  /** Infrastructure's inventory line's ending (the home region's result). */
  /** Infrastructure's inventory line ends with this. Flagged (flag-on prep I5): "· " + the Services coverage line. */
  inventory: string
  /** The last finished scan, as the Dashboard's freshness row prints it (default today, 10:20 AM). */
  finished?: string
}

const IAM = 'IAM roles and policies'
const FINISHED = 'Last scan finished today, 10:20 AM'

const CASES: Record<string, { coverage: () => ServicesCoverage; expected: Expected }> = {
  'home ok': {
    coverage: () => tab5('ok'),
    expected: {
      scan: { state: 'finished', text: FINISHED }, line: '1 of 4 regions checked · us-east-1',
      notChecked: `Not scanned yet: 3 regions · ${IAM}`, otherRegions: ['3 regions not scanned yet'], inventory: 'us-east-1: Checked', connectHome: 'complete', connectHeadline: 'us-east-1 scanned, plus S3 buckets in every region and CloudFront (global)',
    },
  },
  'home failed': {
    coverage: () => tab5('failed'),
    expected: {
      scan: { state: 'finished', text: FINISHED }, line: "0 of 4 regions checked · us-east-1 couldn't be checked",
      notChecked: `us-east-1 couldn't be checked · Not scanned yet: 3 regions · ${IAM}`, otherRegions: ['3 regions not scanned yet'], inventory: "us-east-1: Couldn't check: scan error", connectHome: "couldn't check: scan error", connectHeadline: "us-east-1 couldn't be checked, plus S3 buckets in every region and CloudFront (global)",
    },
  },
  'home denied': {
    coverage: () => homeStatus('denied'),
    expected: {
      scan: { state: 'finished', text: FINISHED }, line: "0 of 4 regions checked · us-east-1 couldn't be checked",
      notChecked: `us-east-1 couldn't be checked · Not scanned yet: 3 regions · ${IAM}`, otherRegions: ['3 regions not scanned yet'], inventory: "us-east-1: Couldn't check: access denied", connectHome: "couldn't check: access denied", connectHeadline: "us-east-1 couldn't be checked, plus S3 buckets in every region and CloudFront (global)",
    },
  },
  'home timed out': {
    coverage: () => homeStatus('timed_out'),
    expected: {
      scan: { state: 'finished', text: FINISHED }, line: "0 of 4 regions checked · us-east-1 couldn't be checked",
      notChecked: `us-east-1 couldn't be checked · Not scanned yet: 3 regions · ${IAM}`, otherRegions: ['3 regions not scanned yet'], inventory: "us-east-1: Couldn't check: AWS didn't respond", connectHome: "couldn't check: AWS didn't respond", connectHeadline: "us-east-1 couldn't be checked, plus S3 buckets in every region and CloudFront (global)",
    },
  },
  'home partial': {
    coverage: () => homeStatus('partial'),
    expected: {
      scan: { state: 'finished', text: FINISHED }, line: '1 of 4 regions checked · us-east-1',
      notChecked: `Not scanned yet: 3 regions · ${IAM}`, otherRegions: ['3 regions not scanned yet'], inventory: 'us-east-1: Partly checked', connectHome: 'partial', connectHeadline: 'us-east-1 scanned, plus S3 buckets in every region and CloudFront (global)',
    },
  },
  'former home with an old ok': {
    coverage: () => tab12Coverage(),
    expected: {
      scan: { state: 'finished', text: FINISHED }, line: '1 of 4 regions checked · us-west-2',
      notChecked: `us-east-1 not scanned since Nov 14 · Not scanned yet: 2 regions · ${IAM}`, connectHome: 'complete', connectHeadline: 'us-west-2 scanned, plus S3 buckets in every region and CloudFront (global)',
      otherRegions: ["us-east-1 hasn't been scanned since Nov 14, except for S3 buckets.", '2 regions not scanned yet'], inventory: 'us-west-2: Checked',
    },
  },
  'new home not scanned yet (former_home_ok)': {
    coverage: newHomeNotScanned,
    expected: {
      scan: { state: 'finished', text: FINISHED }, line: '0 of 4 regions checked · us-west-2',
      notChecked: `us-east-1 not scanned since Nov 14 · Not scanned yet: us-west-2 · 2 regions · ${IAM}`,
      otherRegions: ["us-east-1 hasn't been scanned since Nov 14, except for S3 buckets.", '2 regions not scanned yet'],
      inventory: 'us-west-2: Not scanned yet', connectHome: 'not scanned yet', connectHeadline: 'us-west-2: not scanned yet',
    },
  },
  'flagged latest_scan_failed (RR-L2)': {
    coverage: () => tab8(),
    expected: {
      scan: { state: 'failed', text: "Last scan: today, 10:21 AM · didn't finish" }, line: 'Last scan failed after checking 1 of 2 regions · 1 with resources',
      notChecked: `1 region couldn't be checked · Not checked yet: ${IAM}`, otherRegions: ["1 region couldn't be checked"], inventory: '· Last scan failed after checking 1 of 2 regions · 1 with resources', finished: 'today, 4:20 AM', connectHome: "last scan didn't finish", connectHeadline: "us-east-1: last scan didn't finish",
    },
  },
  'abandoned job': {
    coverage: abandoned,
    expected: {
      scan: { state: 'failed', text: "Last scan: today, 12:00 PM · didn't finish" }, line: '1 of 4 regions checked · us-east-1',
      notChecked: `Not scanned yet: 3 regions · ${IAM}`, otherRegions: ['3 regions not scanned yet'], inventory: 'us-east-1: Checked', connectHome: "last scan didn't finish", connectHeadline: "us-east-1: last scan didn't finish",
    },
  },
  'in progress past 60 minutes, lease held': {
    coverage: longRunning,
    expected: {
      scan: { state: 'running', text: 'Scan in progress since 1:00 PM · showing results from today, 10:20 AM' }, line: '1 of 4 regions checked · us-east-1',
      notChecked: `Not scanned yet: 3 regions · ${IAM}`, otherRegions: ['3 regions not scanned yet'], inventory: 'us-east-1: Checked', connectHome: 'scan in progress', connectHeadline: 'us-east-1 scanned',
    },
  },
  'flagged in progress (dormant region progress, item 7)': {
    coverage: () => tab2(),
    expected: {
      scan: { state: 'running', text: 'Scan in progress since 10:00 AM · 1 of 4 regions done' },
      line: 'Scanning: 1 of 4 regions checked so far · 1 with resources · 3 still running or waiting',
      notChecked: `3 regions still running or waiting · Not checked yet: ${IAM}`, otherRegions: ['3 regions still running or waiting'], inventory: '· Scanning: 1 of 4 regions checked so far · 1 with resources · 3 still running or waiting', finished: 'today, 4:20 AM', connectHome: 'scan in progress', connectHeadline: 'us-east-1 scanned',
    },
  },
}

describe.each(Object.entries(CASES))('%s', (_name, { coverage, expected }) => {
  const c = coverage()

  it('the Services page itself says the expected values (pinned literals)', () => {
    expect(redesignScanLine(c, NOW)).toEqual(expected.scan)
    expect(organisingLine(c).text).toBe(expected.line)
    expect(scanState(c, NOW)).toEqual(expected.scan)
    expect((regionGaps(c, NOW) ?? []).filter((g) => !g.home).map((g) => g.long)).toEqual(expected.otherRegions)
  })

  it('Infrastructure: header, strip, Not checked yet, What we checked and the empty-state scope', () => {
    const v = describeOverview(inputs({ coverage: ready(c), attention: ready(attentionPage([])), accountFindings: ready([]) }), NOW)
    // The header prints the parts, with the scan time as its own focusable element; the words are the same.
    expect(richText(v.header.lastScan!, NOW)).toBe(expected.scan.text)
    expect(v.header.scanRunning).toBe(scanIsRunning(c))
    expect(v.account!.items.find((i) => i.term === 'Regions checked')!.value).toBe(expected.line)
    expect(v.status.notChecked).toBe(expected.notChecked)
    const inventory = v.checked.find((l) => l.key === 'inventory')!.parts.join('')
    expect(inventory.endsWith(expected.inventory)).toBe(true)
    expect(v.checked.filter((l) => l.key.startsWith('other-regions')).map((l) => l.parts.join(''))).toEqual(expected.otherRegions)
    expect(v.attention).toMatchObject({ status: 'ready', empty: { scope: expected.line.endsWith('.') ? expected.line : `${expected.line}.` } })
    // Nothing on the page says the old helper's words.
    expect(JSON.stringify(v)).not.toMatch(/with gaps|Checked with gaps|Other enabled regions: Not checked \(/)
  })

  it('Security: header, Not checked yet banner and the other-regions lines', () => {
    expect(headerScanLine({ status: 'ready', data: c }, NOW)).toEqual(expected.scan)
    expect(notCheckedText({ status: 'ready', data: c }, NOW)).toBe(expected.notChecked)
    const other = securityCheckedLines({ status: 'ready', data: c }, NOW).filter((l) => l.key.startsWith('other-regions'))
    expect(other.map((l) => [l.label, l.status])).toEqual(expected.otherRegions.map((t) => [t, 'not_checked']))
  })

  it('Dashboard: header and freshness', () => {
    expect(headerStatusLine({ coverage: c, previousLoginAt: null, now: NOW })).toBe(expected.scan.text)
    const resources = dataFreshnessSegments({ costSummary: undefined, costSummaryError: false, coverage: c, cloudwatchCapturedAt: null, serviceCheckedAt: null, now: NOW })
      .find((s) => s.key === 'resources')!
    // "last scan finished {when}", the cadence only when the latest attempt didn't fail (DB-D10).
    expect(resources.text).toBe(`last scan finished ${expected.finished ?? 'today, 10:20 AM'}${expected.scan.state === 'failed' ? '' : ' · every 6 hours'}`)
  })

  it('Connect AWS: the Discovery line is the Services scan line; running and failed follow the same state', () => {
    const v = describeCoverage(c, NOW, [], { ...scanState(c, NOW), home: homeRegionCheck(c) })
    expect(v.lastScan).toBe(expected.scan.text)
    expect(v.lastScanFailed).toBe(expected.scan.state === 'failed')
    expect(v.chips[0].state === 'scanning').toBe(expected.scan.state === 'running')
  })

  // N1 (founder ruling, Nov 18): the home row's "Last scan" cell follows the shared scan state and home-region check.
  it('Connect AWS: the home row\'s Last scan cell; "complete" only when the home region was checked', () => {
    const v = describeCoverage(c, NOW, [], { ...scanState(c, NOW), home: homeRegionCheck(c) })
    expect(v.chips[0].note).toBe(`${c.scope.home_region!.count} · home · ${expected.connectHome}`)
    if (expected.connectHome === 'complete') expect(homeRegionCheck(c)?.kind).toBe('checked')
  })

  // N12 (founder ruling, Nov 18): the headline above the table follows the same check as the cell below it.
  it('Connect AWS: the headline agrees with the home cell; never "{home} scanned" when the home couldn\'t be checked', () => {
    const v = describeCoverage(c, NOW, [], { ...scanState(c, NOW), home: homeRegionCheck(c) })
    expect(v.headline).toBe(expected.connectHeadline)
    const home = c.scope.home_region!.region
    if (expected.connectHome.startsWith("couldn't check")) {
      expect(v.headline!.startsWith(`${home} couldn't be checked`)).toBe(true)
      expect(v.headline).not.toContain(`${home} scanned`)
    } else {
      expect(v.headline).not.toContain("couldn't be checked")
    }
    // 3d-2 founder ruling (Nov 19): wherever the cell says "didn't finish", the headline says
    // "{home}: last scan didn't finish", and only there.
    expect(v.chips[0].note.endsWith("last scan didn't finish")).toBe(expected.connectHome === "last scan didn't finish")
    expect(v.headline === `${home}: last scan didn't finish`).toBe(expected.connectHome === "last scan didn't finish")
  })
})

describe('N12: the headline keeps the home chip\'s precedence', () => {
  it('home failed, then a new scan running with the lease: the cell says "scan in progress" and the headline never "couldn\'t be checked"', () => {
    const c = tab5('failed')
    c.scan_in_progress = { since: '2026-11-15T16:00:00.000Z' }
    c.last_scan = { status: 'running', started_at: '2026-11-15T16:00:00.000Z', completed_at: null, warnings: [] }
    const v = describeCoverage(c, NOW, [], { ...scanState(c, NOW), home: homeRegionCheck(c) })
    expect(homeRegionCheck(c)?.kind).toBe('couldnt')
    expect(v.chips[0].note).toBe('9 · home · scan in progress')
    expect(v.headline).toBe('us-east-1 scanned')
  })
})

describe('R5: Connect no longer reads a long scan as failed', () => {
  it('a scan running 3.5 hours with the lease is in progress on Connect; the Phase 1 rule (still used by the Services strip) says failed', () => {
    const c = longRunning()
    const shared = describeCoverage(c, NOW, [], scanState(c, NOW))
    expect(shared.chips[0]).toMatchObject({ state: 'scanning' })
    // The newest job is still running, so its scope is not claimed (scopeIsCompleted): no "plus …".
    expect(shared.headline).toBe('us-east-1 scanned')
    // The Services page's Phase 1 strip keeps its rule (no scan state given): unchanged.
    expect(describeCoverage(c, NOW).chips[0]).toMatchObject({ state: 'failed' })
  })
})

// M-1: with the home region changed and the new one not scanned yet, nothing on any page says it was checked.
describe('M-1: a new home region not scanned yet is never "checked", "complete" or "scanned"', () => {
  const describeIt = (c: ServicesCoverage) => describeCoverage(c, NOW, [], { ...scanState(c, NOW), home: homeRegionCheck(c) })

  it('the home check is the Services card row\'s "Not scanned yet"', () => {
    const c = newHomeNotScanned()
    expect(homeRegionCheck(c)).toEqual({ kind: 'not_scanned', label: 'Not scanned yet' })
    expect(describeCoverageCard(c, NOW).rows.find((r) => r.home)!.status).toEqual({ key: 'not_scanned', label: 'Not scanned yet' })
  })

  it('Infrastructure, Security and Connect never say the new home was checked', () => {
    const c = newHomeNotScanned()
    const infra = describeOverview(inputs({ coverage: ready(c), attention: ready(attentionPage([])), accountFindings: ready([]) }), NOW)
    expect(JSON.stringify(infra)).not.toMatch(/us-west-2: Checked|us-west-2: Partly checked/)
    expect(notCheckedText({ status: 'ready', data: c }, NOW)).toContain('Not scanned yet: us-west-2')
    const v = describeIt(c)
    expect(v.chips[0]).toEqual({ key: 'home', state: 'off', region: 'us-west-2', note: '5 · home · not scanned yet' })
    expect(v.headline).toBe('us-west-2: not scanned yet')
    expect(JSON.stringify(v)).not.toMatch(/complete|us-west-2 scanned/)
  })

  it('a scan running for the new home: the cell says "scan in progress", the headline the existing "first scan in progress"', () => {
    const c = newHomeNotScanned()
    c.scan_in_progress = { since: '2026-11-15T16:00:00.000Z' }
    c.last_scan = { status: 'running', started_at: '2026-11-15T16:00:00.000Z', completed_at: null, warnings: [] }
    const v = describeIt(c)
    expect(v.chips[0].note).toBe('5 · home · scan in progress')
    expect(v.headline).toBe('us-west-2: first scan in progress')
  })

  it('the scan after the change didn\'t finish: the cell and the headline say "didn\'t finish" (3d-2 rulings)', () => {
    const c = newHomeNotScanned()
    c.last_scan = { status: 'failed', started_at: '2026-11-15T12:00:00.000Z', completed_at: '2026-11-15T12:05:00.000Z', warnings: [] }
    const v = describeIt(c)
    expect(v.chips[0].note).toBe("5 · home · last scan didn't finish")
    expect(v.headline).toBe("us-west-2: last scan didn't finish")
  })

  it('the Services Phase 1 strip (no shared scan state) is unchanged', () => {
    const v = describeCoverage(newHomeNotScanned(), NOW)
    expect(v.chips[0].note).toBe('5 · home · complete')
    expect(v.headline).toBe('us-west-2 scanned, plus S3 buckets in every region and CloudFront (global)')
  })
})

// H-1: Infrastructure's and Security's region lines are built from the Services coverage card's own rows
// (flag off) and its banner / organising-line counts (flagged), so a change to a Services rule moves them too.
const IAM_ITEM = 'IAM roles and policies'
const regions = (n: number) => `${n} ${n === 1 ? 'region' : 'regions'}`
const FLAG_OFF = Object.entries(CASES).filter(([, k]) => !multiRegionOf(k.coverage()))

describe.each(FLAG_OFF)('H-1 %s: the region lines are the Services card\'s rows', (_name, { coverage }) => {
  const c = coverage()
  const card = describeCoverageCard(c, NOW)
  const home = homeRegionOf(c)!
  const homeRow = card.rows.find((r) => r.home)!
  const formerRow = card.rows.find((r) => r.formerHome)
  const group = card.rows.find((r) => r.key === 'not-scanned')
  const earlier = card.rows.filter((r) => r.kind === 'region' && !r.home && !r.formerHome)
  // The former home in Services' own "What we didn't check" words (V2-47).
  const formerLine = describeNotChecked(c, undefined, NOW, []).lines.find((l) => l.key === 'former-home')?.text
  const security = () => securityCheckedLines({ status: 'ready', data: c }, NOW).filter((l) => l.key.startsWith('other-regions')).map((l) => l.label)
  const infra = () => describeOverview(inputs({ coverage: ready(c), attention: ready(attentionPage([])), accountFindings: ready([]) }), NOW)

  it('"What we checked": the card\'s former-home row (Services\' V2-47 line), its not-scanned group label, its earlier-result rows', () => {
    expect(!!formerRow).toBe(!!formerLine)
    const fromCard = [
      ...(formerRow ? [formerLine!] : []),
      ...(group ? [group.label] : []),
      ...(earlier.length > 0 ? [`${regions(earlier.length)} from an earlier scan`] : []),
    ]
    expect(security()).toEqual(fromCard)
    expect(infra().checked.filter((l) => l.key.startsWith('other-regions')).map((l) => l.parts.join(''))).toEqual(fromCard)
  })

  it('"Not checked yet": the organising line\'s home segment, the former-home row, then the card\'s not-scanned home row and group', () => {
    const since = formerLine?.match(/^(\S+) hasn't been scanned since (.+), except for S3 buckets\.$/)
    const before = [
      ...(card.line.text.endsWith(`· ${home} couldn't be checked`) ? [`${home} couldn't be checked`] : []),
      ...(formerRow ? [`${formerRow.label} not scanned since ${since![2]}`] : []),
      ...(earlier.length > 0 ? [`${regions(earlier.length)} from an earlier scan`] : []),
    ]
    const unscanned = [...(homeRow.status?.key === 'not_scanned' ? [home] : []), ...(group ? [regions(group.regions!.length)] : [])]
    const expected = [...before, unscanned.length > 0 ? `Not scanned yet: ${[...unscanned, IAM_ITEM].join(' · ')}` : `Not checked yet: ${IAM_ITEM}`].join(' · ')
    expect(notCheckedText({ status: 'ready', data: c }, NOW)).toBe(expected)
    expect(infra().status.notChecked).toBe(expected)
  })

  it('Infrastructure\'s inventory line ends with the card\'s home row status (Complete reads "Checked", Partial "Partly checked")', () => {
    const status = homeRow.status!
    // While a scan runs the card shows "Scanning"; the inventory line keeps the last result (the case's literal).
    if (status.key === 'scanning') return
    const words = status.key === 'complete' ? 'Checked' : status.key === 'partial' ? 'Partly checked' : status.label
    expect(infra().checked.find((l) => l.key === 'inventory')!.parts.join('').endsWith(`${home}: ${words}`)).toBe(true)
  })
})

describe('H-1 flagged: the region lines follow the Services banner and organising line', () => {
  it('completed with a region not checked (tab 3): Security and Infrastructure say the banner\'s "who"', () => {
    const c = tab3Throttled()
    const banner = scanBanner(c, { jobId: c.multi_region.scan.id, discovered: 0, updated: 0 })!
    expect(banner.text).toBe("Scan finished · 2 of 3 regions checked · ap-south-1 couldn't be checked")
    const who = banner.text.split(' · ').pop()!
    expect(securityCheckedLines({ status: 'ready', data: c }, NOW).filter((l) => l.key.startsWith('other-regions')).map((l) => l.label)).toEqual([who])
    expect(notCheckedText({ status: 'ready', data: c }, NOW)).toBe(`${who} · Not checked yet: ${IAM_ITEM}`)
    const v = describeOverview(inputs({ coverage: ready(c), attention: ready(attentionPage([])), accountFindings: ready([]) }), NOW)
    expect(v.status.notChecked).toBe(`${who} · Not checked yet: ${IAM_ITEM}`)
  })

  it('in progress (tab 2): the "still running or waiting" count is the organising line\'s', () => {
    const c = tab2()
    const left = Number(organisingLine(c).text.match(/(\d+) still running or waiting/)![1])
    expect(left).toBe(3)
    expect(securityCheckedLines({ status: 'ready', data: c }, NOW).filter((l) => l.key.startsWith('other-regions')).map((l) => l.label))
      .toEqual([`${regions(left)} still running or waiting`])
  })
})
