/**
 * The coverage strip's wording (stage M6) from GET /api/services/coverage:
 * the home region from the data, S3/CloudFront only when in the last scan's
 * scope, no enabled-region number, no IAM, never "Scanning" from a stale
 * running job, counts never summed across chips.
 */
import { describe, it, expect } from 'vitest'
import type { ServicesCoverage } from '@/lib/services/aws-services.service'
import { DELETION_DETECTION_PAUSED_TEXT, DISCOVERY_WARNING_TRUNCATED_INDEX } from '@/components/aws/discovery-warning-notice'
import { describeCoverage, DISCOVERY_WARNING_LISTING_TRUNCATED, LISTING_TRUNCATED_TEXT, inventoryGap, isScanAbandoned, isScanInProgress, resourcesScopeCaption, STALE_SCAN_MS, UNKNOWN_WARNING_TEXT, HOME_REGION_ONLY_NOTE } from '../coverage'

const NOW = Date.parse('2026-10-20T12:00:00Z')
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString()

function coverageFixture(overrides: Partial<ServicesCoverage> = {}, home = 'eu-central-1'): ServicesCoverage {
  return {
    account: { connected: true, status: 'active', home_region: home },
    scope: {
      home_region: { region: home, count: 40 },
      // 3 S3 buckets in the home region are already in home_region.count.
      s3: { in_last_scan: true, regions: [{ region: home, count: 3 }, { region: 'us-west-2', count: 5 }, { region: 'ap-south-1', count: 2 }] },
      cloudfront: { in_last_scan: true, count: 4 },
      enabled_regions: { known: false, count: null },
    },
    last_successful_scan_at: minutesAgo(48),
    last_scan: { status: 'completed', started_at: minutesAgo(50), completed_at: minutesAgo(48), warnings: [] },
    resource_types: ['ec2', 's3', 'cloudfront'],
    tags_unknown_by_type: {},
    regions: [{ region: home, count: 40 }, { region: 'us-west-2', count: 5 }, { region: 'global', count: 4 }, { region: 'ap-south-1', count: 2 }],
    total: 51,
    ...overrides,
  }
}

describe('describeCoverage', () => {
  it('M6 headline with the home region from the data, and no region count or IAM', () => {
    const view = describeCoverage(coverageFixture(), NOW)
    expect(view.headline).toBe('eu-central-1 scanned, plus S3 buckets in every region and CloudFront (global)')
    expect(view.headlineSub).toBe('· other regions not scanned yet')
    const text = JSON.stringify(view)
    expect(text).not.toMatch(/IAM/)
    expect(text).not.toMatch(/\d+ (other )?(enabled )?regions/)
    expect(text).not.toMatch(/Region coverage/)
    expect(text).not.toMatch(/this account's scan/i)
    expect(view.notes[0]).toMatchObject({ tone: 'info', ...HOME_REGION_ONLY_NOTE })
  })

  it('leaves out S3 and CloudFront when they were not in the last scan (free tier: no CloudFront)', () => {
    const cov = coverageFixture()
    cov.scope.cloudfront = { in_last_scan: false, count: 0 }
    expect(describeCoverage(cov, NOW).headline).toBe('eu-central-1 scanned, plus S3 buckets in every region')
    expect(describeCoverage(cov, NOW).chips.map((c) => c.key)).not.toContain('global')
    cov.scope.s3.in_last_scan = false
    cov.scope.s3.regions = []
    expect(describeCoverage(cov, NOW).headline).toBe('eu-central-1 scanned')
    expect(resourcesScopeCaption(cov)).toBe('in eu-central-1')
  })

  it('never sums counts: the home chip is home_region.count, the S3 chip only other regions', () => {
    const view = describeCoverage(coverageFixture(), NOW)
    const chip = (key: string) => view.chips.find((c) => c.key === key)!
    expect(chip('home').note).toBe('40 · home · complete')
    expect(chip('s3').note).toBe('7')            // 5 + 2, not the 3 in the home region
    expect(chip('global').note).toBe('4 · CloudFront')
    // No chip or line carries 40 + 10 + 4 = 54 or 40 + 3 = 43.
    expect(JSON.stringify(view)).not.toMatch(/\b(54|43|47)\b/)
  })

  it('a failed last scan is its own state, never Partial', () => {
    const failed = coverageFixture({ last_scan: { status: 'failed', started_at: minutesAgo(10), completed_at: minutesAgo(9), warnings: [] } })
    const view = describeCoverage(failed, NOW)
    expect(view.chips[0]).toMatchObject({ state: 'failed', note: '40 · home · last scan failed' })
    expect(view.lastScanFailed).toBe(true)
    expect(view.lastScan).toMatch(/^Last scan failed .*\(9 min ago\) · Last successful scan .*\(48 min ago\)$/)
    expect(JSON.stringify(view.chips)).not.toMatch(/partial/)

    // Failed wins over a deletion-paused warning; the E4 note still shows.
    const failedWarned = coverageFixture({ last_scan: { status: 'failed', started_at: minutesAgo(10), completed_at: minutesAgo(9), warnings: [DISCOVERY_WARNING_TRUNCATED_INDEX] } })
    const fw = describeCoverage(failedWarned, NOW)
    expect(fw.chips[0].state).toBe('failed')
    expect(fw.notes.map((n) => n.body)).toContain(DELETION_DETECTION_PAUSED_TEXT)
  })

  it('a completed scan with ANY warning is Partial, never Complete; each known code has its own copy', () => {
    const done = (warnings: string[]) => coverageFixture({ last_scan: { status: 'completed', started_at: minutesAgo(50), completed_at: minutesAgo(48), warnings } })
    const bodies = (v: ReturnType<typeof describeCoverage>) => v.notes.map((n) => n.body)

    const index = describeCoverage(done([DISCOVERY_WARNING_TRUNCATED_INDEX]), NOW)
    expect(index.chips[0]).toMatchObject({ state: 'partial', note: '40 · home · partial' })
    expect(index.lastScanFailed).toBe(false)
    expect(bodies(index)).toContain(DELETION_DETECTION_PAUSED_TEXT)
    expect(bodies(index)).not.toContain(LISTING_TRUNCATED_TEXT)

    const listing = describeCoverage(done([DISCOVERY_WARNING_LISTING_TRUNCATED]), NOW)
    expect(listing.chips[0]).toMatchObject({ state: 'partial', note: '40 · home · partial' })
    expect(LISTING_TRUNCATED_TEXT).toBe('Some resource listings were cut off, so removed resources may still be listed until the next full scan.')
    expect(bodies(listing)).toContain(LISTING_TRUNCATED_TEXT)
    expect(bodies(listing)).not.toContain(UNKNOWN_WARNING_TEXT)
    expect(bodies(listing)).not.toContain(DELETION_DETECTION_PAUSED_TEXT)
    expect(JSON.stringify(listing)).not.toMatch(/discovery_listing_truncated/)

    const unknown = describeCoverage(done(['some_future_code']), NOW)
    expect(unknown.chips[0]).toMatchObject({ state: 'partial', note: '40 · home · partial' })
    expect(bodies(unknown)).toEqual([HOME_REGION_ONLY_NOTE.body, UNKNOWN_WARNING_TEXT])

    const both = describeCoverage(done([DISCOVERY_WARNING_TRUNCATED_INDEX, DISCOVERY_WARNING_LISTING_TRUNCATED]), NOW)
    expect(bodies(both)).toEqual([HOME_REGION_ONLY_NOTE.body, DELETION_DETECTION_PAUSED_TEXT, LISTING_TRUNCATED_TEXT])

    // No warning: Complete.
    expect(describeCoverage(done([]), NOW).chips[0].state).toBe('complete')
  })

  it('claims S3/CloudFront only from a completed newest scan (pro upgrade: first pro scan running or failed)', () => {
    // An earlier free-tier scan succeeded; the newest (pro) scan plans S3 and CloudFront but has not completed.
    const upgrade = (last: ServicesCoverage['last_scan']) => coverageFixture({ last_scan: last })
    for (const last of [
      { status: 'running', started_at: minutesAgo(4), completed_at: null, warnings: [] },
      { status: 'failed', started_at: minutesAgo(10), completed_at: minutesAgo(9), warnings: [] },
      { status: 'running', started_at: minutesAgo(600), completed_at: null, warnings: [] }, // abandoned
    ] as ServicesCoverage['last_scan'][]) {
      const cov = upgrade(last)
      const view = describeCoverage(cov, NOW)
      expect(view.headline).toBe('eu-central-1 scanned')
      expect(resourcesScopeCaption(cov)).toBe('in eu-central-1')
      expect(JSON.stringify(view)).not.toMatch(/S3 buckets in every region|CloudFront \(global\)|not in the last scan/)
      // Stored counts still show, without a scope claim.
      expect(view.chips.find((c) => c.key === 'global')!.note).toBe('4 · CloudFront')
      expect(view.chips.find((c) => c.key === 's3')!.note).toBe('7')
    }
    // A running scan with nothing stored for CloudFront/S3 elsewhere adds no chip for them.
    const empty = upgrade({ status: 'running', started_at: minutesAgo(4), completed_at: null, warnings: [] })
    empty.scope.cloudfront = { in_last_scan: true, count: 0 }
    empty.scope.s3 = { in_last_scan: true, regions: [] }
    expect(describeCoverage(empty, NOW).chips.map((c) => c.key)).toEqual(['home', 'other'])
  })

  it('only scan failed (no successful scan ever): "{home}: last scan failed"', () => {
    const cov = coverageFixture({ last_successful_scan_at: null, last_scan: { status: 'failed', started_at: minutesAgo(10), completed_at: minutesAgo(9), warnings: [] } })
    const view = describeCoverage(cov, NOW)
    expect(view.headline).toBe('eu-central-1: last scan failed')
    expect(view.lastScan).toMatch(/^Last scan failed .*\(9 min ago\) · No successful scan yet$/)
    expect(resourcesScopeCaption(cov)).toBe('in eu-central-1')
    expect(view.headline).not.toMatch(/ scanned|S3 buckets|CloudFront/)
  })

  it('an unknown warning code gets the generic line, never the raw code', () => {
    // (Its chip is Partial: see above.)
    const cov = coverageFixture({ last_scan: { status: 'completed', started_at: minutesAgo(50), completed_at: minutesAgo(48), warnings: ['some_future_code'] } })
    const view = describeCoverage(cov, NOW)
    expect(view.notes.map((n) => n.body)).toContain(UNKNOWN_WARNING_TEXT)
    expect(JSON.stringify(view.notes)).not.toMatch(/some_future_code/)
  })

  it('a running job started within the hour is in progress', () => {
    const cov = coverageFixture({ last_scan: { status: 'running', started_at: minutesAgo(5), completed_at: null, warnings: [] } })
    const view = describeCoverage(cov, NOW)
    expect(view.lastScan).toMatch(/^Scan in progress, started .*\(5 min ago\) · last successful scan .*\(48 min ago\)$/)
    expect(view.chips[0]).toMatchObject({ state: 'scanning', note: '40 · home · scan in progress' })
    expect(JSON.stringify(view.chips)).not.toMatch(/partial/)
    // Also the first scan, with nothing completed yet.
    const first = describeCoverage(coverageFixture({ last_successful_scan_at: null, last_scan: { status: 'pending', started_at: minutesAgo(1), completed_at: null, warnings: [] } }), NOW)
    expect(first.headline).toBe('eu-central-1: first scan in progress')
    expect(first.chips[0].state).toBe('scanning')
  })

  it('a running job older than an hour was abandoned: "Last scan failed", with the last successful scan, never Complete', () => {
    const stale = coverageFixture({ last_scan: { status: 'running', started_at: minutesAgo(60 * 24 * 9), completed_at: null, warnings: [] } })
    expect(isScanInProgress(stale.last_scan, NOW)).toBe(false)
    expect(isScanAbandoned(stale.last_scan, NOW)).toBe(true)
    const view = describeCoverage(stale, NOW)
    expect(view.chips[0]).toMatchObject({ state: 'failed', note: '40 · home · last scan failed' })
    expect(view.lastScanFailed).toBe(true)
    // No failure time is invented from the start time.
    expect(view.lastScan).toMatch(/^Last scan failed · Last successful scan .*\(48 min ago\)$/)
    expect(JSON.stringify(view)).not.toMatch(/in progress|Scanning\.\.\.|Scanning…|complete/i)
    // The abandoned scan's scope is not claimed.
    expect(view.headline).toBe('eu-central-1 scanned')
    // A stale pending job is abandoned too; with no successful scan ever, it says so.
    const staleOnly = describeCoverage(coverageFixture({ last_successful_scan_at: null, last_scan: { status: 'pending', started_at: minutesAgo(90), completed_at: null, warnings: [] } }), NOW)
    expect(staleOnly.headline).toBe('eu-central-1: last scan failed')
    expect(staleOnly.chips[0]).toMatchObject({ state: 'failed', note: '40 · home · last scan failed' })
    expect(staleOnly.lastScan).toBe('Last scan failed · No successful scan yet')
    // A running job with no start time cannot be shown as in progress either.
    expect(describeCoverage(coverageFixture({ last_scan: { status: 'running', started_at: null, completed_at: null, warnings: [] } }), NOW).chips[0].state).toBe('failed')
    // Completed and failed jobs are never "abandoned".
    expect(isScanAbandoned({ status: 'completed', started_at: minutesAgo(600), completed_at: minutesAgo(590), warnings: [] }, NOW)).toBe(false)
    // The same at exactly the threshold, and for a running job with no start time.
    expect(isScanInProgress({ status: 'running', started_at: new Date(NOW - STALE_SCAN_MS).toISOString(), completed_at: null, warnings: [] }, NOW)).toBe(false)
    expect(isScanInProgress({ status: 'running', started_at: null, completed_at: null, warnings: [] }, NOW)).toBe(false)
  })

  it('never scanned: no "scanned" claim and a Not scanned home chip', () => {
    const cov = coverageFixture({ last_scan: null, last_successful_scan_at: null, resource_types: null })
    cov.scope.s3 = { in_last_scan: false, regions: [] }
    cov.scope.cloudfront = { in_last_scan: false, count: 0 }
    cov.scope.home_region = { region: 'eu-central-1', count: 0 }
    const view = describeCoverage(cov, NOW)
    expect(view.headline).toBe('eu-central-1: not scanned yet')
    expect(view.lastScan).toBe('No successful scan yet')
    expect(view.chips[0]).toMatchObject({ state: 'off', note: 'home · not scanned' })
  })

  it('no account: nothing claimed connected', () => {
    const cov = coverageFixture({ account: { connected: false, status: null, home_region: null } })
    cov.scope.home_region = null
    const view = describeCoverage(cov, NOW)
    expect(view).toMatchObject({ connected: false, headline: null, lastScan: null, chips: [] })
    expect(resourcesScopeCaption(cov)).toBeNull()
  })

  it('inventoryGap: only with no resources, and only for no account or never scanned', () => {
    const noAccount = coverageFixture({ account: { connected: false, status: null, home_region: null } })
    const neverScanned = coverageFixture({ last_scan: null, last_successful_scan_at: null })
    expect(inventoryGap(noAccount, 0)).toBe('no-account')
    expect(inventoryGap(neverScanned, 0)).toBe('not-scanned')
    // A stored inventory is counted as it is; a scan that ran and found nothing is a real 0.
    expect(inventoryGap(noAccount, 5)).toBeNull()
    expect(inventoryGap(coverageFixture(), 0)).toBeNull()
    expect(inventoryGap(coverageFixture({ last_successful_scan_at: null, last_scan: { status: 'failed', started_at: minutesAgo(5), completed_at: minutesAgo(4), warnings: [] } }), 0)).toBeNull()
    // Unknown coverage or total: nothing is decided.
    expect(inventoryGap(undefined, 0)).toBeNull()
    expect(inventoryGap(noAccount, undefined)).toBeNull()
  })

  it('the Resources tile caption follows the same scope', () => {
    expect(resourcesScopeCaption(coverageFixture())).toBe('in eu-central-1, plus S3 in every region and CloudFront')
  })
})
