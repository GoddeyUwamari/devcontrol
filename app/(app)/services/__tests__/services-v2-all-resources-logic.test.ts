/**
 * S1-D pure rules: each All resources filter → the exact GET /api/services
 * params; filter-miss titles; the demo list; and each "What we didn't check"
 * line appearing only in its condition.
 */
import { describe, it, expect } from 'vitest'
import type { AWSService, AWSServicesStats, ServicesCoverage } from '@/lib/services/aws-services.service'
import { DELETION_DETECTION_PAUSED_TEXT, DISCOVERY_WARNING_TRUNCATED_INDEX } from '@/components/aws/discovery-warning-notice'
import {
  DEFAULT_FILTERS, allResourcesRequest, countsAreNarrowed, demoAllResourcesPage, filterMissTitle, hasActiveFilter,
  isPositiveEmpty, regionOptionLabel, showsNoFlaggedLine, type AllResourcesFilters,
} from '../allResources'
import { NOT_CHECKED_COPY, notCheckedLines, unknownTagsText } from '../notChecked'
import { DISCOVERY_WARNING_LISTING_TRUNCATED, INTERNAL_WARNINGS, LISTING_TRUNCATED_TEXT, UNKNOWN_WARNING_TEXT, describeCoverage, shownWarnings } from '../coverage'
import { servicesDemoFixture } from '../demo-fixture'

const f = (change: Partial<AllResourcesFilters> = {}): AllResourcesFilters => ({ ...DEFAULT_FILTERS, ...change })

describe('allResourcesRequest: filter → exact params', () => {
  it('default: attention order, page and limit only', () => {
    expect(allResourcesRequest(f(), 1)).toEqual({ sort: 'attention', page: 1, limit: 50 })
    expect(allResourcesRequest(f(), 3)).toEqual({ sort: 'attention', page: 3, limit: 50 })
  })

  it('search sends search_tags=true, trimmed; a blank search sends neither', () => {
    expect(allResourcesRequest(f({ search: '  team:data ' }), 1)).toEqual({ sort: 'attention', page: 1, limit: 50, search: 'team:data', search_tags: true })
    expect(allResourcesRequest(f({ search: '   ' }), 1)).toEqual({ sort: 'attention', page: 1, limit: 50 })
  })

  it('type and region', () => {
    expect(allResourcesRequest(f({ type: 's3' }), 1)).toMatchObject({ type: 's3' })
    expect(allResourcesRequest(f({ region: 'global' }), 1)).toMatchObject({ region: 'global' })
    expect(allResourcesRequest(f({ type: 'all', region: 'all' }), 1)).not.toHaveProperty('type')
    expect(allResourcesRequest(f({ type: 'all', region: 'all' }), 1)).not.toHaveProperty('region')
  })

  it('Untagged sends tags_known=true; other environments do not', () => {
    expect(allResourcesRequest(f({ env: 'untagged' }), 1)).toEqual({ sort: 'attention', page: 1, limit: 50, env: 'untagged', tags_known: true })
    expect(allResourcesRequest(f({ env: 'production' }), 1)).toEqual({ sort: 'attention', page: 1, limit: 50, env: 'production' })
    expect(allResourcesRequest(f({ env: 'staging' }), 1)).not.toHaveProperty('tags_known')
  })

  it('"Everyone" (and a blank team) sends no team; a team is sent trimmed', () => {
    expect(allResourcesRequest(f({ team: '' }), 1)).not.toHaveProperty('team')
    expect(allResourcesRequest(f({ team: '   ' }), 1)).not.toHaveProperty('team')
    expect(allResourcesRequest(f({ team: ' Platform ' }), 1)).toMatchObject({ team: 'Platform' })
  })

  it('Show: needs attention / unowned / owner unknown', () => {
    expect(allResourcesRequest(f({ show: 'needs_attention' }), 1)).toEqual({ sort: 'attention', page: 1, limit: 50, needs_attention: true })
    expect(allResourcesRequest(f({ show: 'unowned' }), 1)).toEqual({ sort: 'attention', page: 1, limit: 50, ownership: 'unowned' })
    expect(allResourcesRequest(f({ show: 'unknown' }), 1)).toEqual({ sort: 'attention', page: 1, limit: 50, ownership: 'unknown' })
    expect(allResourcesRequest(f({ show: 'all' }), 1)).not.toHaveProperty('ownership')
  })
})

describe('titles and flags', () => {
  it('filter-miss titles follow the existing pattern, Show first', () => {
    expect(filterMissTitle(f({ show: 'needs_attention', type: 's3' }))).toBe('No resources that need attention match these filters')
    expect(filterMissTitle(f({ show: 'unowned' }))).toBe('No unowned resources match these filters')
    expect(filterMissTitle(f({ show: 'unknown' }))).toBe('No resources with unknown owner match these filters')
    expect(filterMissTitle(f({ type: 'cloudfront' }))).toBe('No CloudFront resources found')
    expect(filterMissTitle(f({ region: 'eu-west-1' }))).toBe('No resources in eu-west-1')
    expect(filterMissTitle(f({ team: 'payments' }))).toBe('No resources owned by payments')
    expect(filterMissTitle(f({ search: 'abc' }))).toBe('No resources match "abc"')
    expect(filterMissTitle(f({ env: 'staging' }))).toBe('No staging resources found')
    expect(filterMissTitle(f())).toBe('No resources match these filters')
  })

  it('narrowing, positive empty, active filter', () => {
    expect(hasActiveFilter(f())).toBe(false)
    expect(countsAreNarrowed(f({ show: 'needs_attention' }))).toBe(false)
    expect(countsAreNarrowed(f({ show: 'unowned' }))).toBe(true)
    expect(countsAreNarrowed(f({ team: 'data' }))).toBe(true)
    expect(isPositiveEmpty(f({ show: 'needs_attention' }))).toBe(true)
    expect(isPositiveEmpty(f({ show: 'needs_attention', env: 'production' }))).toBe(false)
  })

  it('the "no flagged issues" line is hidden only in the needs-only view', () => {
    expect(showsNoFlaggedLine(f())).toBe(true)
    expect(showsNoFlaggedLine(f({ show: 'unowned' }))).toBe(true)
    expect(showsNoFlaggedLine(f({ show: 'needs_attention' }))).toBe(false)
    expect(showsNoFlaggedLine(f({ show: 'needs_attention', type: 's3' }))).toBe(false)
    // Any filter, Show = Needs attention included, makes the header "matching current filters".
    expect(hasActiveFilter(f({ show: 'needs_attention' }))).toBe(true)
  })

  it('region options say what the region holds', () => {
    expect(regionOptionLabel('us-east-1', 8, 'us-east-1')).toBe('us-east-1, home (8)')
    expect(regionOptionLabel('global', 2, 'us-east-1')).toBe('global, CloudFront (2)')
    expect(regionOptionLabel('eu-west-1', 1, 'us-east-1')).toBe('eu-west-1 (1)')
  })
})

describe('demo list (no request)', () => {
  const demo = servicesDemoFixture(Date.parse('2026-10-21T12:00:00Z'))
  const rows: AWSService[] = demo.services

  it('applies the filters as the API does and agrees with the fixture stats', () => {
    expect(demoAllResourcesPage(rows, f(), 1).pagination.total).toBe(demo.stats.total)
    expect(demoAllResourcesPage(rows, f({ show: 'needs_attention' }), 1).pagination.total).toBe(demo.stats.needs_attention)
    expect(demoAllResourcesPage(rows, f({ show: 'unowned' }), 1).pagination.total).toBe(demo.stats.ownership!.unowned)
    expect(demoAllResourcesPage(rows, f({ show: 'unknown' }), 1).pagination.total).toBe(demo.stats.ownership!.unknown)
    expect(demoAllResourcesPage(rows, f({ team: 'PLATFORM' }), 1).pagination.total).toBe(demo.stats.teams!.all.find((t) => t.team === 'platform')!.count)
    // Untagged leaves out the tags-unreadable rows (tags_known=true).
    const untagged = demoAllResourcesPage(rows, f({ env: 'untagged' }), 1).services
    expect(untagged.every((r) => r.environment === null && r.ownership !== 'unknown')).toBe(true)
  })

  it('attention order: needs-attention rows by severity first, then the rest by name', () => {
    const names = demoAllResourcesPage(rows, f(), 1).services.map((r) => r.name)
    expect(names.slice(0, demo.attention.length)).toEqual(demo.attention.map((r) => r.name))
  })
})

const NOW = Date.parse('2026-10-21T12:00:00Z')
const ago = (m: number) => new Date(NOW - m * 60_000).toISOString()

function cov(o: Partial<ServicesCoverage> = {}): ServicesCoverage {
  return {
    account: { connected: true, status: 'active', home_region: 'us-east-1' },
    scope: {
      home_region: { region: 'us-east-1', count: 10 },
      s3: { in_last_scan: true, regions: [{ region: 'us-west-2', count: 2 }] },
      cloudfront: { in_last_scan: false, count: 0 },
      enabled_regions: { known: false, count: null },
    },
    last_successful_scan_at: ago(30),
    last_scan: { status: 'completed', started_at: ago(32), completed_at: ago(30), warnings: [] },
    resource_types: ['ec2', 'ebs', 'rds', 's3'],
    tags_unknown_by_type: {},
    regions: [],
    total: 12,
    ...o,
  }
}
const stats = (unknown = 0, byType: Record<string, number> = {}) => ({ total: 12, healthy: 12, needs_attention: 0, avg_uptime: null, ownership: { owned: 12 - unknown, unowned: 0, unknown }, unknown_by_type: byType }) as AWSServicesStats
const keys = (c: ServicesCoverage, s?: AWSServicesStats, inTab: string[] = []) => notCheckedLines(c, s, NOW, inTab).map((l) => l.key)
const text = (c: ServicesCoverage, key: string, s?: AWSServicesStats) => notCheckedLines(c, s, NOW).find((l) => l.key === key)?.text

describe("What we didn't check: each line only in its condition", () => {
  it('free plan, completed clean scan: regions (S3 exception), IAM, its 4 types; nothing else', () => {
    expect(keys(cov(), stats())).toEqual(['regions', 'iam', 'types'])
    expect(text(cov(), 'regions')).toBe(NOT_CHECKED_COPY.otherRegionsExceptS3)
    expect(text(cov(), 'types')).toBe('We inventory these types: EC2, EBS, RDS and S3. Other AWS resource types are not inventoried.')
    // No region count anywhere (enabled_regions.known is false).
    expect(JSON.stringify(notCheckedLines(cov(), stats(), NOW))).not.toMatch(/\d+ (other )?(enabled )?regions/)
  })

  it('the S3 exception and the types only from a completed newest scan', () => {
    for (const last of [
      { status: 'running', started_at: ago(5), completed_at: null, warnings: [] },
      { status: 'failed', started_at: ago(5), completed_at: ago(4), warnings: [] },
      { status: 'running', started_at: ago(600), completed_at: null, warnings: [] },
    ]) {
      const c = cov({ last_scan: last })
      expect(text(c, 'regions')).toBe(NOT_CHECKED_COPY.otherRegions)
      expect(keys(c, stats())).not.toContain('types')
    }
    const noS3 = cov(); noS3.scope.s3 = { in_last_scan: false, regions: [] }
    expect(text(noS3, 'regions')).toBe(NOT_CHECKED_COPY.otherRegions)
  })

  it('CloudFront tags line only when CloudFront rows exist', () => {
    expect(keys(cov(), stats())).not.toContain('cloudfront-tags')
    const c = cov(); c.scope.cloudfront = { in_last_scan: true, count: 3 }
    expect(text(c, 'cloudfront-tags')).toBe(NOT_CHECKED_COPY.cloudfrontTags)
  })

  it('tags-unreadable line only with unknown > 0, by type, not counted as Unowned', () => {
    expect(keys(cov(), stats(0))).not.toContain('tags-unknown')
    expect(text(cov(), 'tags-unknown', stats(5, { s3: 2, cloudfront: 3 }))).toBe(
      "5 resources: tags couldn't be read, so their owner is unknown, not missing. They are not counted as Unowned. By type: CloudFront 3, S3 2.")
    expect(unknownTagsText(1, undefined)).toBe("1 resource: tags couldn't be read, so its owner is unknown, not missing. It is not counted as Unowned.")
  })

  it("the last scan's warnings with the approved copy, each only when reported", () => {
    const warned = (w: string[]) => cov({ last_scan: { status: 'completed', started_at: ago(32), completed_at: ago(30), warnings: w } })
    const texts = (c: ServicesCoverage) => notCheckedLines(c, stats(), NOW).map((l) => l.text)
    expect(texts(warned([DISCOVERY_WARNING_TRUNCATED_INDEX]))).toContain(DELETION_DETECTION_PAUSED_TEXT)
    expect(texts(warned([DISCOVERY_WARNING_LISTING_TRUNCATED]))).toContain(LISTING_TRUNCATED_TEXT)
    expect(texts(warned(['future_code']))).toContain(UNKNOWN_WARNING_TEXT)
    expect(texts(cov())).not.toEqual(expect.arrayContaining([DELETION_DETECTION_PAUSED_TEXT]))
    expect(texts(cov()).some((t) => [DELETION_DETECTION_PAUSED_TEXT, LISTING_TRUNCATED_TEXT, UNKNOWN_WARNING_TEXT].includes(t))).toBe(false)
  })

  it('internal codes (scan_lease_lost) are ignored: no line, no Partial chip; other codes still count', () => {
    expect(INTERNAL_WARNINGS).toEqual(['scan_lease_lost'])
    expect(shownWarnings(['scan_lease_lost', 'future_code'])).toEqual(['future_code'])
    const done = (w: string[]) => cov({ last_scan: { status: 'completed', started_at: ago(32), completed_at: ago(30), warnings: w } })
    // Persisted on the last scan, or reported by a run in this tab: neither adds a line.
    expect(keys(done(['scan_lease_lost']), stats())).toEqual(keys(cov(), stats()))
    expect(keys(cov(), stats(), ['scan_lease_lost'])).toEqual(keys(cov(), stats()))
    const strip = describeCoverage(done(['scan_lease_lost']), NOW, ['scan_lease_lost'])
    expect(strip.chips[0]).toMatchObject({ state: 'complete' })
    expect(strip.notes.map((n) => n.key)).toEqual(['home-only'])
    expect(JSON.stringify(strip)).not.toMatch(/scan_lease_lost/)
    // With a real warning beside it, that warning still makes the scan Partial.
    const both = describeCoverage(done(['scan_lease_lost', DISCOVERY_WARNING_TRUNCATED_INDEX]), NOW)
    expect(both.chips[0]).toMatchObject({ state: 'partial' })
    expect(both.notes.map((n) => n.key)).toEqual(['home-only', 'deletion-paused'])
    expect(keys(done(['scan_lease_lost', 'future_code']), stats())).toContain('warning-unknown-warning')
  })

  it('last scan failed (or abandoned) / never scanned, each only in its case', () => {
    expect(keys(cov({ last_scan: { status: 'failed', started_at: ago(5), completed_at: ago(4), warnings: [] } }))).toContain('last-scan-failed')
    expect(keys(cov({ last_scan: { status: 'running', started_at: ago(600), completed_at: null, warnings: [] } }))).toContain('last-scan-failed')
    expect(keys(cov({ last_scan: { status: 'running', started_at: ago(5), completed_at: null, warnings: [] } }))).not.toContain('last-scan-failed')
    expect(keys(cov())).not.toContain('last-scan-failed')
    const never = cov({ last_scan: null, last_successful_scan_at: null, resource_types: null })
    expect(keys(never)).toEqual(['regions', 'iam', 'never-scanned'])
    expect(text(never, 'never-scanned')).toBe(NOT_CHECKED_COPY.neverScanned)
    expect(keys(cov())).not.toContain('never-scanned')
  })

  it('no account: no regions line (nothing is scanned); IAM and stored-resource facts whenever inventory is shown', () => {
    const none = cov({ account: { connected: false, status: null, home_region: null }, last_scan: null, last_successful_scan_at: null })
    none.scope.home_region = null
    const empty = { ...stats(0), total: 0 } as AWSServicesStats
    expect(keys(none, empty)).toEqual([])
    expect(keys(none, undefined)).toEqual([])
    // Stored resources from a previous connection: inventory is shown, so IAM applies.
    expect(keys(none, stats(0))).toEqual(['iam'])
    expect(keys(none, stats(2, { s3: 2 }))).toEqual(['iam', 'tags-unknown'])
  })

  it('IAM shows whenever the page shows inventory, including connected with nothing found yet', () => {
    expect(keys(cov(), stats())).toContain('iam')
    expect(keys(cov({ last_scan: null, last_successful_scan_at: null, resource_types: null }), { ...stats(0), total: 0 } as AWSServicesStats)).toContain('iam')
  })
})
