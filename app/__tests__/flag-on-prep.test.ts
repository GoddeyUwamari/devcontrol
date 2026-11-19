/**
 * Multi-region flag-on prep (Stage B, founder rulings Nov 19): what one organization sees with
 * multi-region scanning switched ON (`multi_region` present) vs OFF, for the model-level items:
 *   2 Security caption (N2) and checked label (N3);
 *   3 Infrastructure inventory line (Services coverage line, N4) and security-groups line (N5);
 *   5 RR-L2: the never-scanned regions are the Services card's own rows (home apart);
 *   6 Cost Optimization's home-region line (N6), switched-on only;
 *   4 the busy / cut request classifier, and its text equal to the server's.
 * Every expectation is a literal. Switched-off cases pin today's text (unchanged).
 * Item 1 (Connect) and item 4's page behaviour are rendered in their pages' own suites.
 */
process.env.TZ = 'UTC'

import * as fs from 'fs'
import * as path from 'path'
import { describe, it, expect } from 'vitest'
import type { ServicesCoverage } from '@/lib/services/aws-services.service'
import type { RiskScore } from '@/lib/services/risk-score.service'
import { SCAN_BUSY_TEXT, scanInterruption } from '@/lib/scan-busy'
import { R_NOW, flaggedCoverage, mrRegion, tab5, tab8 } from '../(app)/services/__tests__/redesign-fixtures'
import { describeCoverageCard } from '../(app)/services/redesignModel'
import { notCheckedLine, regionGaps } from '../(app)/services/servicesTruth'
import { describeSecurity, securityCheckedLines, type SecurityInputs } from '../(app)/security/overview/securityModel'
import { describeOverview } from '../(app)/infrastructure/overview/overviewModel'
import { inputs as overviewInputs } from '../(app)/infrastructure/__tests__/overview-fixtures'
import { costChecksRegionLine } from '../(app)/cost-optimization/costOptimizationCopy'

const ROOT = path.resolve(__dirname, '../..')
const IAM = 'IAM roles and policies'
const ready = <T,>(data: T) => ({ status: 'ready' as const, data })

/** A home region and three others, none ever scanned; no job yet (the switch just turned on, no scan ever). */
function neverScanned(region: string, home = false): any {
  return mrRegion(region, {
    home, status: 'never_scanned', last_scan_finished_at: null, last_success_at: null,
    result_of: null, state: 'not_started', resources: null, resources_from: null,
  })
}
const REGIONS = ['eu-west-1', 'eu-central-1', 'ap-south-1']

function mr(o: Record<string, unknown>): any {
  return {
    home_region: 'us-east-1', savings_regions: ['us-east-1'], not_enabled_regions: [], progress: null,
    regions_checked: { enabled: 4, complete: 0, partial: 0, not_checked: 0, not_reached: 0, never_scanned: 0, by_state: {} },
    region_warnings: [], region_warnings_complete: true, region_warnings_unattributed: [], ...o,
  }
}

/** Switched on, nothing scanned yet. */
function noScanYet(): ServicesCoverage {
  return flaggedCoverage(mr({ scan: null, coverage_status: 'unavailable', regions: [neverScanned('us-east-1', true), ...REGIONS.map((r) => neverScanned(r))] }), { lastCompletedAt: null })
}

const SCAN = { id: 'job-1', status: 'completed', started_at: '2026-11-15T10:00:00.000Z', completed_at: '2026-11-15T10:01:00.000Z' }

/** The transition window: the newest job is the last home-only scan (home checked by it); the rest never scanned. */
function transition(): ServicesCoverage {
  return flaggedCoverage(mr({
    scan: { ...SCAN, regions_total: 4, regions_checked: 1, regions_with_resources: 1, regions_empty: 0, regions_zero_with_warnings: 0 },
    coverage_status: 'completed_with_regions_not_checked',
    regions: [mrRegion('us-east-1', { home: true, resources: 5 }), ...REGIONS.map((r) => neverScanned(r))],
  }))
}

/** A finished flagged scan: home checked, eu-west-1 failed in it, two regions never scanned (not reached ever). */
function finishedWithFailure(): ServicesCoverage {
  return flaggedCoverage(mr({
    scan: { ...SCAN, regions_total: 4, regions_checked: 1, regions_with_resources: 1, regions_empty: 0, regions_zero_with_warnings: 0 },
    coverage_status: 'completed_with_regions_not_checked',
    regions: [
      mrRegion('us-east-1', { home: true, resources: 5 }),
      mrRegion('eu-west-1', { status: 'failed', error_code: 'error', state: 'failed', last_success_at: null, resources: null, resources_from: null }),
      neverScanned('eu-central-1'), neverScanned('ap-south-1'),
    ],
  }))
}

describe('item 5 (RR-L2): never-scanned regions are the Services card rows, home apart', () => {
  it('switched on, no scan yet: the home region is its own gap and the group is the card\'s 3', () => {
    const c = noScanYet()
    const card = describeCoverageCard(c, R_NOW)
    // The card itself: the home row apart, "3 regions not scanned yet" grouped.
    expect(card.rows.map((r: any) => r.label)).toEqual(['us-east-1', '3 regions not scanned yet'])
    expect(regionGaps(c, R_NOW)!.map((g) => [g.short, g.home, g.notScanned])).toEqual([
      ['us-east-1 not scanned yet', true, 'us-east-1'],
      ['3 regions not scanned yet', false, '3 regions'],
    ])
    expect(notCheckedLine(c, R_NOW, IAM)).toBe(`Not scanned yet: us-east-1 · 3 regions · ${IAM}`)
  })
  it('transition window (newest job = the last home-only scan): "not scanned yet", never "couldn\'t be checked"', () => {
    const c = transition()
    expect(regionGaps(c, R_NOW)!.map((g) => g.short)).toEqual(['3 regions not scanned yet'])
    expect(notCheckedLine(c, R_NOW, IAM)).toBe(`Not scanned yet: 3 regions · ${IAM}`)
  })
  it('a finished scan: the region it failed is named; never-scanned regions stay "not scanned yet"', () => {
    const c = finishedWithFailure()
    expect(regionGaps(c, R_NOW)!.map((g) => g.short)).toEqual(["eu-west-1 couldn't be checked", '2 regions not scanned yet'])
    expect(notCheckedLine(c, R_NOW, IAM)).toBe(`eu-west-1 couldn't be checked · Not scanned yet: 2 regions · ${IAM}`)
  })
  it('Infrastructure and Security list the card\'s group, never the home region in it', () => {
    const c = noScanYet()
    const infra = describeOverview(overviewInputs({ coverage: ready(c) }), R_NOW).checked.filter((l) => l.key.startsWith('other-regions')).map((l) => l.parts.join(''))
    expect(infra).toEqual(['3 regions not scanned yet'])
    const sec = securityCheckedLines(ready(c), R_NOW).filter((l) => l.key.startsWith('other-regions')).map((l) => l.label)
    expect(sec).toEqual(['3 regions not scanned yet'])
  })
  it('switched off: unchanged', () => {
    expect(notCheckedLine(tab5('ok'), R_NOW, IAM)).toBe(`Not scanned yet: 3 regions · ${IAM}`)
  })
})

const SCORE = {
  score: 86, grade: 'B', color: '', factors: { encryption: 0, publicAccess: 0, backup: 0, compliance: 0, resourceManagement: 0 },
  complianceIssueCounts: { critical: 0, high: 0, medium: 0, low: 0 }, accountFindingsCounts: { critical: 0, high: 0, medium: 0, low: 0 },
  resourceComplianceCounts: { critical: 0, high: 0, medium: 0, low: 0 }, frameworksAtRisk: [], isPreliminary: false,
} as unknown as RiskScore

function security(c: ServicesCoverage) {
  const i: SecurityInputs = {
    score: ready(SCORE), trend: ready({ data: [] } as any), accountFindings: ready([]),
    resourceFindings: ready({ kind: 'full', resources: [] } as any), coverage: ready(c),
    frameworks: ready({ frameworks: [], scans: [], scansLimit: 50 }), anomalies: ready({ active: 0 }),
  }
  return describeSecurity(i, R_NOW)
}

describe('item 2 (S6): Security', () => {
  it('switched on: the caption names no single region (N2) and security groups are each region checked (N3)', () => {
    const c = tab8()
    expect(security(c).tiles.score.caption).toBe('From the last scan: resources and security groups in each region it checked, S3 buckets in all regions, IAM users.')
    const noS3 = tab8(); noS3.scope.s3.in_last_scan = false
    expect(security(noS3).tiles.score.caption).toBe('From the last scan: resources and security groups in each region it checked, IAM users.')
    expect(securityCheckedLines(ready(c), R_NOW).find((l) => l.key === 'security-groups')!.label).toBe('Security groups (each region checked)')
  })
  it('switched off: unchanged', () => {
    const c = tab5('ok')
    expect(security(c).tiles.score.caption).toBe('From the last scan: resources in us-east-1 and S3 buckets in all regions, security groups in us-east-1, IAM users.')
    expect(securityCheckedLines(ready(c), R_NOW).find((l) => l.key === 'security-groups')!.label).toBe('Security groups (us-east-1)')
  })
})

describe('item 3 (I5): Infrastructure "What we checked"', () => {
  const line = (c: ServicesCoverage, key: string) => describeOverview(overviewInputs({ coverage: ready(c) }), R_NOW).checked.find((l) => l.key === key)
  it('switched on: the inventory line carries the Services coverage line, and security groups each region (N5)', () => {
    const inv = line(transition(), 'inventory')!
    expect(inv.parts.join('')).toBe('Resource inventory (EC2, S3, CloudFront, Lambda) · 1 of 4 regions checked · 1 with resources · 3 not checked')
    expect(inv.tone).toBe('warn')
    expect(line(transition(), 'security-groups')!.parts.join('')).toBe('Security groups: checked in each region the scan covers')
  })
  it('switched on, no finished scan: no region named (N4)', () => {
    expect(line(noScanYet(), 'inventory')!.parts.join('')).toBe('Resource inventory: Not checked yet (no scan has finished)')
    expect(line(noScanYet(), 'security-groups')).toBeUndefined()
  })
  it('switched off: unchanged', () => {
    expect(line(tab5('ok'), 'inventory')!.parts.join('')).toMatch(/ · us-east-1: Checked$/)
    expect(line(tab5('ok'), 'security-groups')!.parts.join('')).toBe('Security groups (us-east-1): checked during each scan')
  })
})

describe('item 6 (X6): Cost Optimization home-region line (N6)', () => {
  it('switched on: the server\'s savings region, two sentences', () => {
    expect(costChecksRegionLine(tab8().multi_region)).toBe('Cost checks run in your home region, us-east-1. S3 lifecycle checks cover buckets in every region.')
    expect(costChecksRegionLine({ savings_regions: ['eu-central-1'] })).toBe('Cost checks run in your home region, eu-central-1. S3 lifecycle checks cover buckets in every region.')
  })
  it('switched off (no multi_region) or no savings region: nothing', () => {
    expect(costChecksRegionLine(tab5('ok').multi_region)).toBeNull()
    expect(costChecksRegionLine(undefined)).toBeNull()
    expect(costChecksRegionLine({ savings_regions: [] })).toBeNull()
  })
})

describe('item 4: busy and cut scan requests', () => {
  it('the busy text is the server\'s SCAN_BUSY_MESSAGE, word for word', () => {
    const backend = fs.readFileSync(path.join(ROOT, 'backend/src/services/scan-session.ts'), 'utf8')
    expect(backend).toContain(`export const SCAN_BUSY_MESSAGE = '${SCAN_BUSY_TEXT}';`)
  })
  it('classifies 409 busy, 504 and no response; nothing else', () => {
    expect(scanInterruption({ response: { status: 409, data: { success: false, error: SCAN_BUSY_TEXT } } })).toBe('busy')
    expect(scanInterruption({ response: { status: 504 } })).toBe('cut')
    expect(scanInterruption({ request: {}, message: 'Network Error' })).toBe('cut')
    // Other 409s (no account, ambiguous account) and every other status keep their own handling.
    expect(scanInterruption({ response: { status: 409, data: { error: 'aws_not_connected' } } })).toBeNull()
    for (const status of [402, 403, 429, 500, 503]) expect(scanInterruption({ response: { status } })).toBeNull()
    expect(scanInterruption(new Error('x'))).toBeNull()
    expect(scanInterruption(null)).toBeNull()
  })
})
