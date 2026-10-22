/**
 * Region coverage (multi-region M6), pure: the counts ("checked", "with
 * gaps", "not scanned yet"), every state's wording, the legend of only the
 * states present, the S3/CloudFront footer, the Phase 1 fallback when the M5c
 * keys are missing, and that no raw error text or consecutive_failures ever
 * reaches the view. Fixtures follow the real production response of Oct 22.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RegionCoverage, ServicesCoverage } from '@/lib/services/aws-services.service'
import { DELETION_DETECTION_PAUSED_TEXT, DISCOVERY_WARNING_TRUNCATED_INDEX } from '@/components/aws/discovery-warning-notice'
import { describeCoverage, DISCOVERY_WARNING_LISTING_TRUNCATED, LISTING_TRUNCATED_TEXT } from '../coverage'
import {
  describeRegionCoverage, footerText, formatExact, formatWhen, hasRegionCoverage, latestAttempt, regionCounts, richText,
  REGION_COPY, SCAN_INTERVAL_TEXT, type RegionCoverageView,
} from '../regionCoverage'
import { notCheckedLines, NOT_CHECKED_COPY } from '../notChecked'

const NOW = Date.parse('2026-10-22T15:00:00Z')
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString()
const TZ = 'UTC'

const OTHER_REGIONS = [
  'ap-northeast-1', 'ap-northeast-2', 'ap-northeast-3', 'ap-south-1', 'ap-southeast-1', 'ap-southeast-2', 'ca-central-1',
  'eu-central-1', 'eu-north-1', 'eu-west-1', 'eu-west-2', 'eu-west-3', 'sa-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
]

function region(name: string, o: Partial<RegionCoverage> = {}): RegionCoverage {
  return { region: name, home: false, status: 'never_scanned', last_scan_finished_at: null, last_success_at: null, last_error_code: null, consecutive_failures: 0, stale: false, ...o }
}

const HOME_OK = region('us-east-1', { home: true, status: 'ok', last_scan_finished_at: hoursAgo(2), last_success_at: hoursAgo(2) })

/** The production response of Oct 22: us-east-1 home ok, 16 regions never scanned, 3 S3 buckets in us-east-1, no CloudFront. */
function prod(o: Partial<ServicesCoverage> = {}, home: RegionCoverage = HOME_OK, others: RegionCoverage[] = OTHER_REGIONS.map((r) => region(r))): ServicesCoverage {
  const done = hoursAgo(2)
  return {
    account: { connected: true, status: 'active', home_region: home.region },
    scope: {
      home_region: { region: home.region, count: 9 },
      s3: { in_last_scan: true, regions: [{ region: home.region, count: 3 }] },
      cloudfront: { in_last_scan: true, count: 0 },
      enabled_regions: { known: true, count: 1 + others.length, listed_at: done, stale: false },
    },
    region_status: [home, ...others],
    scan_in_progress: null,
    last_completed_scan: { started_at: hoursAgo(2.1), completed_at: done, resource_types: ['ec2', 'ebs', 'rds', 's3', 'lambda', 'cloudfront'], warnings: [] },
    last_successful_scan_at: done,
    last_scan: { status: 'completed', started_at: hoursAgo(2.1), completed_at: done, warnings: [] },
    resource_types: ['ec2', 'ebs', 'rds', 's3', 'lambda', 'cloudfront'],
    tags_unknown_by_type: {},
    regions: [{ region: home.region, count: 9 }],
    total: 9,
    ...o,
  }
}

function view(c: ServicesCoverage, warnings: readonly string[] = []): RegionCoverageView {
  const v = describeRegionCoverage(c, NOW, warnings)
  if (!v) throw new Error('expected a region coverage view')
  return v
}
const notes = (v: RegionCoverageView) => v.notes.map((n) => richText(n.parts, NOW, TZ))
const chips = (v: RegionCoverageView) => v.chips.map((c) => `${c.region} ${c.note}`)
const legend = (v: RegionCoverageView) => v.legend.map((l) => l.label)
const row = (v: RegionCoverageView, key: string) => v.rows.find((r) => r.key === key)!
const details = (v: RegionCoverageView, key: string) => richText(row(v, key).details, NOW, TZ)

describe('V1 today (the production response of Oct 22)', () => {
  const v = view(prod())
  it('headline, sub-line and scan line', () => {
    expect(v.headline).toBe('1 of 17 enabled regions checked')
    expect(v.headlineSub).toBe('· us-east-1 (home), plus S3 in every region and CloudFront (global)')
    expect(richText(v.scanLine, NOW, TZ)).toBe('Last scan finished today, 1:00 PM')
    expect(v.scanRunning).toBe(false)
  })
  it('chips: the home region and one grouped chip; no CloudFront or S3 chip at 0', () => {
    expect(chips(v)).toEqual(['us-east-1 9 · home · complete', '16 other regions not scanned yet'])
  })
  it('legend has only the states present', () => {
    expect(legend(v)).toEqual(['Complete', 'Not scanned yet'])
  })
  it('the info note, with the S3 exemption', () => {
    expect(notes(v)).toEqual([
      "Only us-east-1 is scanned today. The other 16 enabled regions aren't scanned yet, so resources there, other than S3 buckets, don't appear here or in any count. S3 and CloudFront are checked everywhere.",
    ])
  })
  it('rows: home first, then one row for all 16 never-scanned regions, every name listed', () => {
    expect(v.rows.map((r) => [r.label, r.status])).toEqual([['us-east-1', 'Complete'], ['16 other regions', 'Not scanned yet']])
    expect(row(v, 'not-scanned').regions).toEqual(OTHER_REGIONS)
    expect(row(v, 'not-scanned').sublabel).toBe('enabled in this account')
    expect(details(v, 'not-scanned')).toBe("Multi-region scanning is rolling out. Resources in these regions, other than S3 buckets, don't appear on this page or in any count yet.")
    expect(row(v, 'not-scanned').lastSuccess).toBe('—')
    expect(row(v, 'region-us-east-1').lastSuccess).toEqual({ iso: HOME_OK.last_success_at })
  })
  it('footer from the data', () => {
    expect(v.footer).toBe('S3 and CloudFront are checked in every region on each scan: 3 S3 buckets found, all in us-east-1; no CloudFront distributions.')
    expect(v.listNote).toBeNull()
  })
  it('the home region comes from the data (eu-west-1)', () => {
    const home = region('eu-west-1', { ...HOME_OK, region: 'eu-west-1' })
    const w = view(prod({}, home, OTHER_REGIONS.filter((r) => r !== 'eu-west-1').concat('us-east-1').sort().map((r) => region(r))))
    expect(w.headlineSub).toBe('· eu-west-1 (home), plus S3 in every region and CloudFront (global)')
    expect(chips(w)[0]).toBe('eu-west-1 9 · home · complete')
    expect(JSON.stringify(w)).not.toMatch(/"us-east-1 \(home\)|Only us-east-1/)
  })
})

describe('V2 scan in progress', () => {
  const v = view(prod({ scan_in_progress: { since: hoursAgo(0.25) }, last_scan: { status: 'running', started_at: hoursAgo(0.25), completed_at: null, warnings: [] } }))
  it('Scanning on the home chip and row; the scan line says since when and from which results', () => {
    expect(v.scanRunning).toBe(true)
    expect(chips(v)[0]).toBe('us-east-1 9 · home · scanning')
    expect(row(v, 'region-us-east-1').status).toBe('Scanning')
    expect(details(v, 'region-us-east-1')).toBe(REGION_COPY.scanningDetail)
    expect(richText(v.scanLine, NOW, TZ)).toBe('Scan in progress since today, 2:45 PM · showing results from today, 1:00 PM')
    expect(legend(v)).toEqual(['Scanning', 'Not scanned yet'])
  })
  it('no completed scan yet', () => {
    const w = view(prod({ scan_in_progress: { since: hoursAgo(0.25) }, last_completed_scan: null, last_successful_scan_at: null }))
    expect(richText(w.scanLine, NOW, TZ)).toBe('Scan in progress since today, 2:45 PM · no completed scan yet')
  })
})

describe('V3 the latest attempt did not finish (from last_scan, not the region row)', () => {
  it('failed: the home row keeps its status; the note gives both times', () => {
    const v = view(prod({ last_scan: { status: 'failed', started_at: hoursAgo(1.2), completed_at: hoursAgo(1), warnings: [] } }))
    expect(chips(v)[0]).toBe('us-east-1 9 · home · complete')
    expect(notes(v)[0]).toBe("The latest scan, at today, 2:00 PM, didn't finish. Results shown are from the last successful scan at today, 1:00 PM.")
    expect(v.headline).toBe('1 of 17 enabled regions checked')
  })
  it('a running job with no held lease is abandoned at once (no one-hour rule)', () => {
    const c = prod({ last_scan: { status: 'running', started_at: hoursAgo(5 / 60), completed_at: null, warnings: [] } })
    expect(latestAttempt(c)).toBe('unfinished')
    expect(notes(view(c))[0]).toBe("The latest scan, at today, 2:55 PM, didn't finish. Results shown are from the last successful scan at today, 1:00 PM.")
  })
  it('no scan ever completed', () => {
    const v = view(prod({ last_scan: { status: 'failed', started_at: null, completed_at: null, warnings: [] }, last_completed_scan: null, last_successful_scan_at: null }))
    expect(notes(v)[0]).toBe("The latest scan didn't finish. No scan has completed yet.")
  })
  it("What we didn't check follows the same rule under M6", () => {
    const c = prod({ last_scan: { status: 'running', started_at: hoursAgo(5 / 60), completed_at: null, warnings: [] } })
    expect(notCheckedLines(c, undefined, NOW, [], true).map((l) => l.text)).toContain(NOT_CHECKED_COPY.lastScanFailed)
    // Phase 1 (no lease rule): a 5-minute-old running job still reads as in progress.
    expect(notCheckedLines(c, undefined, NOW, [], false).map((l) => l.text)).not.toContain(NOT_CHECKED_COPY.lastScanFailed)
    const running = prod({ scan_in_progress: { since: hoursAgo(2) }, last_scan: { status: 'running', started_at: hoursAgo(2), completed_at: null, warnings: [] } })
    expect(notCheckedLines(running, undefined, NOW, [], true).map((l) => l.text)).not.toContain(NOT_CHECKED_COPY.lastScanFailed)
  })
})

describe('V4 out of date: only the API flag', () => {
  it('Out of date, still checked, the note gives the last scan time', () => {
    const v = view(prod({}, { ...HOME_OK, stale: true, last_scan_finished_at: hoursAgo(20), last_success_at: hoursAgo(20) }))
    expect(chips(v)[0]).toBe('us-east-1 9 · home · out of date')
    expect(v.headline).toBe('1 of 17 enabled regions checked')
    expect(legend(v)).toEqual(['Out of date', 'Not scanned yet'])
    expect(notes(v)[0]).toBe(`These results may be out of date. us-east-1 was last scanned yesterday, 7:00 PM; ${SCAN_INTERVAL_TEXT}.`)
    expect(details(v, 'region-us-east-1')).toBe('Last scanned yesterday, 7:00 PM. Not scanned since; results may be out of date.')
  })
  it('a 1-minute-old row flagged stale is out of date; a 3-day-old row not flagged is not', () => {
    expect(chips(view(prod({}, { ...HOME_OK, stale: true, last_scan_finished_at: hoursAgo(1 / 60) })))[0]).toMatch(/out of date/)
    const old = view(prod({}, { ...HOME_OK, stale: false, last_scan_finished_at: hoursAgo(72), last_success_at: hoursAgo(72) }))
    expect(chips(old)[0]).toBe('us-east-1 9 · home · complete')
    expect(JSON.stringify(old)).not.toMatch(/out of date/i)
  })
})

describe('V5 partial', () => {
  const partial = (code: string | null, lastSuccess: string | null = hoursAgo(30)) =>
    view(prod({}, { ...HOME_OK, status: 'partial', last_error_code: code, last_success_at: lastSuccess }))
  it.each([
    [DISCOVERY_WARNING_TRUNCATED_INDEX, 'us-east-1 was only partly scanned: its resource index has more than 1,000 items, so some resources there may be missing and deleted ones may still be listed until a complete scan.'],
    [DISCOVERY_WARNING_LISTING_TRUNCATED, 'us-east-1 was only partly scanned: some listings stopped at their page limit, so some resources there may be missing and deleted ones may still be listed until a complete scan.'],
    [null, 'us-east-1 was only partly scanned: some resources there may be missing and deleted ones may still be listed until a complete scan.'],
    ['some_future_code', 'us-east-1 was only partly scanned: some resources there may be missing and deleted ones may still be listed until a complete scan.'],
  ])('code %s', (code, text) => {
    const v = partial(code)
    expect(notes(v)).toContain(text)
    expect(v.headline).toBe('1 of 17 enabled regions checked · 1 with gaps')
    expect(chips(v)[0]).toBe('us-east-1 9 · home · partial')
    expect(legend(v)).toEqual(['Partial', 'Not scanned yet'])
    expect(JSON.stringify(v)).not.toMatch(/New resources are shown/)
  })
  it('no complete scan yet: the column says so and the details give the partial scan time', () => {
    const v = partial(DISCOVERY_WARNING_TRUNCATED_INDEX, null)
    expect(row(v, 'region-us-east-1').lastSuccess).toBe('No complete scan yet')
    expect(details(v, 'region-us-east-1')).toBe('Only partly scanned: its resource index has more than 1,000 items, so some resources here may be missing and deleted ones may still be listed until a complete scan. Last partly scanned today, 1:00 PM.')
  })
  describe('Q8: the same truncation is said exactly once in the card', () => {
    const job = (warnings: string[]) => ({ last_scan: { status: 'completed', started_at: hoursAgo(2.1), completed_at: hoursAgo(2), warnings } })
    const once = (v: RegionCoverageView, pattern: RegExp) => notes(v).filter((n) => pattern.test(n)).length

    it.each([
      [DISCOVERY_WARNING_TRUNCATED_INDEX, /1,000/],
      [DISCOVERY_WARNING_LISTING_TRUNCATED, /page limit|cut off/],
    ])('%s: the region note only, the job note dropped', (code, pattern) => {
      // From the job row and from this tab's discovery run alike.
      for (const v of [view(prod(job([code]), { ...HOME_OK, status: 'partial', last_error_code: code })), view(prod({}, { ...HOME_OK, status: 'partial', last_error_code: code }), [code])]) {
        expect(once(v, pattern)).toBe(1)
        expect(notes(v).filter((n) => n.startsWith('us-east-1 was only partly scanned'))).toHaveLength(1)
        expect(notes(v)).not.toContain(code === DISCOVERY_WARNING_TRUNCATED_INDEX ? DELETION_DETECTION_PAUSED_TEXT : LISTING_TRUNCATED_TEXT)
      }
    })

    it('a different code on the job keeps its note', () => {
      const v = view(prod(job([DISCOVERY_WARNING_LISTING_TRUNCATED]), { ...HOME_OK, status: 'partial', last_error_code: DISCOVERY_WARNING_TRUNCATED_INDEX }))
      expect(notes(v)).toContain(LISTING_TRUNCATED_TEXT)
      expect(once(v, /1,000/)).toBe(1)
    })

    it('kept when the home region is not partial, or partial with no code', () => {
      expect(notes(view(prod(job([DISCOVERY_WARNING_TRUNCATED_INDEX]))))).toContain(DELETION_DETECTION_PAUSED_TEXT)
      expect(notes(view(prod(job([DISCOVERY_WARNING_TRUNCATED_INDEX]), { ...HOME_OK, status: 'partial', last_error_code: null })))).toContain(DELETION_DETECTION_PAUSED_TEXT)
      expect(notes(view(prod({}, HOME_OK), [DISCOVERY_WARNING_LISTING_TRUNCATED]))).toContain(LISTING_TRUNCATED_TEXT)
    })

    it("Phase 1 and What we didn't check keep the job note", () => {
      const c = prod(job([DISCOVERY_WARNING_TRUNCATED_INDEX]), { ...HOME_OK, status: 'partial', last_error_code: DISCOVERY_WARNING_TRUNCATED_INDEX })
      expect(describeCoverage(c, NOW).notes.map((n) => n.body)).toContain(DELETION_DETECTION_PAUSED_TEXT)
      expect(notCheckedLines(c, undefined, NOW, [], true).map((l) => l.text)).toContain(DELETION_DETECTION_PAUSED_TEXT)
    })
  })
})

describe('V6/V7 denied, timed out, failed: checked, with gaps', () => {
  it.each([
    ['denied', "us-east-1 9 · home · couldn't check some types", "Some resource types in us-east-1 couldn't be checked because of permissions. Other results may still be available."],
    ['timed_out', 'us-east-1 9 · home · timed out', "Some resource types in us-east-1 couldn't be checked because AWS didn't respond in time. Other results may still be available."],
    ['failed', 'us-east-1 9 · home · scan error', "Some resource types in us-east-1 couldn't be checked because the scan ran into an error. Other results may still be available."],
  ] as const)('%s', (status, chip, note) => {
    const v = view(prod({}, { ...HOME_OK, status, last_success_at: hoursAgo(30) }))
    expect(v.headline).toBe('1 of 17 enabled regions checked · 1 with gaps')
    expect(chips(v)[0]).toBe(chip)
    expect(notes(v)).toContain(note)
    expect(details(v, 'region-us-east-1')).toBe(`${note.replace('in us-east-1', 'in this region')} ${REGION_COPY.foundEarlier}`)
    expect(legend(v)).toEqual(["Couldn't check some types", 'Not scanned yet'])
    expect(JSON.stringify(v)).not.toMatch(/(region|us-east-1) (is |was )?(inaccessible|denied)|access to (the|this) region/i)
  })
})

describe('V8 region list not known', () => {
  const unknown = (o: Partial<ServicesCoverage> = {}) => prod({ region_status: [], ...o, scope: { ...prod().scope, enabled_regions: { known: false, count: null, listed_at: null, stale: false } } })
  it('no "N of M"; the other regions are not listed yet', () => {
    const v = view(unknown())
    expect(v.headline).toBe('us-east-1 checked')
    expect(v.headlineSub).toBe('· plus S3 in every region and CloudFront (global)')
    expect(chips(v)).toEqual(['us-east-1 9 · home · complete', 'Other regions not listed yet'])
    expect(notes(v)).toEqual(["We haven't read this account's region list yet. It's read during each scan."])
    expect(details(v, 'not-listed')).toBe("We haven't read this account's region list yet. It's read during each scan.")
    expect(legend(v)).toEqual(['Complete', 'Not listed yet'])
    expect(v.counts.enabled).toBeNull()
    expect(JSON.stringify(v)).not.toMatch(/\d+ of \d+|read on the next scan/)
  })
  it('home state from the jobs: scanning, unfinished, never scanned', () => {
    expect(chips(view(unknown({ scan_in_progress: { since: hoursAgo(0.1) } })))[0]).toBe('us-east-1 9 · home · scanning')
    const failed = view(unknown({ last_scan: { status: 'failed', started_at: hoursAgo(1), completed_at: hoursAgo(1), warnings: [] } }))
    expect(chips(failed)[0]).toBe("us-east-1 9 · home · last scan didn't finish")
    const never = view(unknown({ last_scan: null, last_completed_scan: null, last_successful_scan_at: null }))
    expect(never.headline).toBe('us-east-1: not scanned yet')
    expect(never.headlineSub).toBeNull()
    expect(chips(never)[0]).toBe('us-east-1 home · not scanned yet')
  })
})

describe('V9 mixed: home ok, us-west-2 ok, eu-west-1 denied, 14 never scanned', () => {
  const others = OTHER_REGIONS.map((r) => r === 'us-west-2' ? region(r, { status: 'ok', last_scan_finished_at: hoursAgo(2), last_success_at: hoursAgo(2) })
    : r === 'eu-west-1' ? region(r, { status: 'denied', last_scan_finished_at: hoursAgo(2) }) : region(r))
  const v = view(prod({}, HOME_OK, others))
  it('counts every finished region as checked and the denied one as a gap', () => {
    expect(v.counts).toEqual({ enabled: 17, checked: 3, withGaps: 1, notScannedYet: 14, other: 0 })
    expect(v.headline).toBe('3 of 17 enabled regions checked · 1 with gaps')
    expect(v.headlineSub).toBe('· including us-east-1 (home), plus S3 in every region and CloudFront (global)')
  })
  it('grouped chips, rows in API order, legend of the present states', () => {
    expect(chips(v)).toEqual(['us-east-1 9 · home · complete', "1 region couldn't check some types", '1 region complete', '14 other regions not scanned yet'])
    expect(v.rows.map((r) => r.label)).toEqual(['us-east-1', 'eu-west-1', 'us-west-2', '14 other regions'])
    expect(legend(v)).toEqual(['Complete', "Couldn't check some types", 'Not scanned yet'])
    expect(notes(v)).toContain("Some resource types in eu-west-1 couldn't be checked because of permissions. Other results may still be available.")
    expect(notes(v).some((n) => n.startsWith('Only us-east-1'))).toBe(false)
  })
})

describe('V10–V12 fall back to Phase 1', () => {
  it.each(['region_status', 'scan_in_progress', 'last_completed_scan'] as const)('without %s', (key) => {
    const c = prod() as any
    delete c[key]
    expect(hasRegionCoverage(c)).toBe(false)
    expect(describeRegionCoverage(c, NOW)).toBeNull()
  })
  it('without every M5c key (an older backend)', () => {
    const c = prod() as any
    delete c.region_status; delete c.scan_in_progress; delete c.last_completed_scan
    c.scope.enabled_regions = { known: false, count: null }
    expect(describeRegionCoverage(c, NOW)).toBeNull()
  })
  it('a known list with no home entry, or two', () => {
    expect(describeRegionCoverage(prod({}, { ...HOME_OK, home: false }), NOW)).toBeNull()
    const two = prod()
    two.region_status![1] = { ...two.region_status![1], home: true }
    expect(describeRegionCoverage(two, NOW)).toBeNull()
  })
  it('no connected account', () => {
    expect(describeRegionCoverage(prod({ account: { connected: false, status: null, home_region: null } }), NOW)).toBeNull()
  })
})

describe('V13 the S3 / CloudFront footer and claims', () => {
  it('hidden when in_last_scan is false', () => {
    const c = prod()
    c.scope.s3.in_last_scan = false
    c.scope.cloudfront.in_last_scan = false
    const v = view(c)
    expect(v.footer).toBeNull()
    expect(v.headlineSub).toBe('· us-east-1 (home)')
    expect(notes(v)[0]).not.toMatch(/checked everywhere/)
  })
  it('needs the type in the last completed scan too', () => {
    expect(footerText(prod({ last_completed_scan: null }))).toBeNull()
    const c = prod()
    c.last_completed_scan!.resource_types = ['ec2', 's3']
    expect(footerText(c)).toBe('S3 is checked in every region on each scan: 3 S3 buckets found, all in us-east-1.')
    expect(view(c).headlineSub).toBe('· us-east-1 (home), plus S3 in every region')
  })
  it('CloudFront only', () => {
    const c = prod()
    c.scope.s3.in_last_scan = false
    c.scope.cloudfront.count = 2
    expect(footerText(c)).toBe('CloudFront (global) is checked on each scan: 2 CloudFront distributions.')
  })
  it('counts and regions from the data', () => {
    const c = prod()
    c.scope.s3.regions = [{ region: 'us-east-1', count: 1 }]
    c.scope.cloudfront.count = 1
    expect(footerText(c)).toBe('S3 and CloudFront are checked in every region on each scan: 1 S3 bucket found, in us-east-1; 1 CloudFront distribution.')
    c.scope.s3.regions = [{ region: 'us-east-1', count: 3 }, { region: 'eu-west-1', count: 2 }, { region: 'us-west-2', count: 3 }, { region: null, count: 1 }]
    expect(footerText(c)).toBe('S3 and CloudFront are checked in every region on each scan: 9 S3 buckets found in 4 regions: us-east-1 3, us-west-2 3, eu-west-1 2, an unknown region 1; 1 CloudFront distribution.')
    c.scope.s3.regions = []
    expect(footerText(c)).toMatch(/: no S3 buckets found; /)
  })
  it('CloudFront and S3-in-other-regions chips only when their count is above 0', () => {
    const c = prod()
    c.scope.cloudfront.count = 4
    c.scope.s3.regions = [{ region: 'us-east-1', count: 3 }, { region: 'us-west-2', count: 5 }]
    expect(chips(view(c)).slice(-2)).toEqual(['global 4 · CloudFront', 'S3 in other regions 5'])
    expect(view(c).legend.map((l) => l.key)).toEqual(['complete', 'not_scanned'])
  })
})

describe('V14 count definitions', () => {
  it.each([
    ['ok', { checked: 1, withGaps: 0, notScannedYet: 0, other: 0 }],
    ['partial', { checked: 1, withGaps: 1, notScannedYet: 0, other: 0 }],
    ['failed', { checked: 1, withGaps: 1, notScannedYet: 0, other: 0 }],
    ['denied', { checked: 1, withGaps: 1, notScannedYet: 0, other: 0 }],
    ['timed_out', { checked: 1, withGaps: 1, notScannedYet: 0, other: 0 }],
    ['never_scanned', { checked: 0, withGaps: 0, notScannedYet: 1, other: 0 }],
    ['skipped_locked', { checked: 0, withGaps: 0, notScannedYet: 0, other: 1 }],
    ['not_enabled', { checked: 0, withGaps: 0, notScannedYet: 0, other: 1 }],
    ['something_new', { checked: 0, withGaps: 0, notScannedYet: 0, other: 1 }],
  ])('%s', (status, expected) => {
    const c = prod({}, { ...HOME_OK, status: status as any }, [])
    expect(regionCounts(c)).toEqual({ enabled: 1, ...expected })
  })
  it('stale still counts as checked', () => {
    expect(regionCounts(prod({}, { ...HOME_OK, stale: true })).checked).toBe(1)
  })
  it('the denominator is enabled_regions.count, never the number of rows', () => {
    const c = prod()
    c.scope.enabled_regions.count = 20
    expect(view(c).headline).toBe('1 of 20 enabled regions checked')
  })
  it('an unknown status is never checked and shows "Status not available"', () => {
    const v = view(prod({}, { ...HOME_OK, status: 'skipped_locked' as any }))
    expect(v.headline).toBe('0 of 17 enabled regions checked')
    expect(chips(v)[0]).toBe('us-east-1 home · status not available')
    expect(legend(v)).toEqual(['Not scanned yet', 'Status not available'])
  })
})

describe('V15 never-scanned regions are never described as empty or healthy', () => {
  it('nothing derived from them says 0, empty, healthy or complete', () => {
    const v = view(prod())
    const parts = [...v.chips.filter((c) => c.key === 'not-scanned').map((c) => `${c.region} ${c.note}`), JSON.stringify(row(v, 'not-scanned'))]
    for (const text of parts) expect(text).not.toMatch(/\b0\b|no resources|empty|healthy|complete/i)
    const homeNever = view(prod({}, { ...HOME_OK, status: 'never_scanned', last_scan_finished_at: null, last_success_at: null }))
    expect(homeNever.headline).toBe('0 of 17 enabled regions checked')
    expect(chips(homeNever)[0]).toBe('us-east-1 home · not scanned yet')
  })
})

describe('V16 no raw error text, no consecutive_failures', () => {
  it('neither reaches the view', () => {
    const others = OTHER_REGIONS.map((r) => region(r, r === 'eu-west-1'
      ? { status: 'denied', consecutive_failures: 7, last_error_code: 'AccessDenied: arn:aws:iam::123456789012:role/x' }
      : { consecutive_failures: 5 }))
    const c = prod({}, { ...HOME_OK, status: 'failed', consecutive_failures: 9, last_error_code: 'AccessDenied' }, others)
    ;(c.region_status![0] as any).last_error_message = 'User: arn:aws:sts::123456789012:assumed-role/x is not authorized'
    const text = JSON.stringify(view(c))
    expect(text).not.toMatch(/consecutive|in a row|AccessDenied|arn:aws|123456789012|not authorized|\b[579] (failures|times)/)
  })
})

describe('V18 times', () => {
  it('today / yesterday / older, in the given time zone', () => {
    expect(formatWhen('2026-10-22T09:05:00Z', NOW, 'UTC')).toBe('today, 9:05 AM')
    expect(formatWhen('2026-10-21T23:59:00Z', NOW, 'UTC')).toBe('yesterday, 11:59 PM')
    expect(formatWhen('2026-10-20T08:00:00Z', NOW, 'UTC')).toBe('Oct 20, 2026, 8:00 AM')
    expect(formatWhen('2026-10-24T08:00:00Z', NOW, 'UTC')).toBe('Oct 24, 2026, 8:00 AM')
  })
  it('the local calendar day decides (UTC today can be yesterday in Los Angeles)', () => {
    const now = Date.parse('2026-10-22T05:00:00Z') // 10:00 PM on Oct 21 in Los Angeles
    expect(formatWhen('2026-10-22T01:00:00Z', now, 'UTC')).toBe('today, 1:00 AM')
    expect(formatWhen('2026-10-22T01:00:00Z', now, 'America/Los_Angeles')).toBe('today, 6:00 PM')
    expect(formatWhen('2026-10-21T01:00:00Z', now, 'America/Los_Angeles')).toBe('yesterday, 6:00 PM')
    expect(formatWhen('2026-10-21T01:00:00Z', now, 'UTC')).toBe('yesterday, 1:00 AM')
  })
  it('the exact time', () => {
    expect(formatExact('2026-10-22T13:00:07Z', 'UTC')).toBe('Thursday, October 22, 2026 at 1:00:07 PM UTC')
  })
})

describe('V19 the scan interval in the copy matches the backend schedule', () => {
  it("'0 */6 * * *' in resourceDiscovery.job.ts", () => {
    const job = readFileSync(join(process.cwd(), 'backend/src/jobs/resourceDiscovery.job.ts'), 'utf8')
    expect(job).toContain("'0 */6 * * *'")
    expect(SCAN_INTERVAL_TEXT).toBe('scans normally run every 6 hours')
  })
})

describe('V20 the region list stale line', () => {
  it('only when the API marks the list stale', () => {
    const c = prod()
    expect(view(c).listNote).toBeNull()
    c.scope.enabled_regions = { ...c.scope.enabled_regions, stale: true, listed_at: hoursAgo(50) }
    expect(richText(view(c).listNote!, NOW, TZ)).toBe('The region list was last read Oct 20, 2026, 1:00 PM.')
  })
})
