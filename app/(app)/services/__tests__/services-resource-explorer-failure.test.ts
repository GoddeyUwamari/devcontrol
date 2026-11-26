/**
 * Region-access PR (b): a Resource Explorer call failed in a region whose own listings all
 * completed. The region is Partial (never "Couldn't check"), with the founder-approved
 * sentence of its code (Nov 25):
 *
 *   resource_explorer_denied     "AWS refused DevControl's access to Resource Explorer in {r}, …"
 *   resource_explorer_failed     "Resource Explorer ran into an error in {r}, … The next scan tries again."
 *   resource_explorer_throttled  "AWS was busy and limited our Resource Explorer requests in {r}, …" (B5)
 *
 * Without the flag the home region's job warning gets the same sentence with {r} = home, and
 * the Q2 case (a core listing's code won) surfaces through the existing approved
 * "Resource Explorer wasn't available…" note (region_warnings_unattributed).
 */
import { describe, it, expect } from 'vitest'
import {
  DISCOVERY_WARNING_RESOURCE_EXPLORER_DENIED,
  DISCOVERY_WARNING_RESOURCE_EXPLORER_FAILED,
  DISCOVERY_WARNING_RESOURCE_EXPLORER_THROTTLED,
  UNKNOWN_WARNING_TEXT,
  homeRegionWarnings,
  resourceExplorerDeniedText,
  resourceExplorerFailedText,
  resourceExplorerFailureText,
  resourceExplorerThrottledText,
  warningNotes,
} from '../coverage'
import { REDESIGN_COPY, failureCode, homeOnlyStatus, latestScanNotChecked, partialText, regionRow } from '../redesignModel'
import { mrRegion } from './redesign-fixtures'
import type { MultiRegionCoverage, RegionCoverage, ServicesCoverage } from '@/lib/services/aws-services.service'

const DENIED = "AWS refused DevControl's access to Resource Explorer in eu-west-1, so some resource types (such as ECS, VPC and DynamoDB) weren't listed. Everything else was checked."
const FAILED = "Resource Explorer ran into an error in eu-west-1, so some resource types (such as ECS, VPC and DynamoDB) weren't listed this time. Everything else was checked. The next scan tries again."
const THROTTLED = "AWS was busy and limited our Resource Explorer requests in eu-west-1, so some resource types (such as ECS, VPC and DynamoDB) weren't listed this time. Everything else was checked. The next scan tries again."

const CASES: [string, string][] = [
  [DISCOVERY_WARNING_RESOURCE_EXPLORER_DENIED, DENIED],
  [DISCOVERY_WARNING_RESOURCE_EXPLORER_FAILED, FAILED],
  [DISCOVERY_WARNING_RESOURCE_EXPLORER_THROTTLED, THROTTLED],
]

describe('the approved sentences (exact)', () => {
  it('each code has its own sentence, naming the region', () => {
    expect(resourceExplorerDeniedText('eu-west-1')).toBe(DENIED)
    expect(resourceExplorerFailedText('eu-west-1')).toBe(FAILED)
    expect(resourceExplorerThrottledText('eu-west-1')).toBe(THROTTLED)
  })

  it('the codes are the backend\'s three', () => {
    expect([DISCOVERY_WARNING_RESOURCE_EXPLORER_DENIED, DISCOVERY_WARNING_RESOURCE_EXPLORER_THROTTLED, DISCOVERY_WARNING_RESOURCE_EXPLORER_FAILED])
      .toEqual(['resource_explorer_denied', 'resource_explorer_throttled', 'resource_explorer_failed'])
  })

  it('any other code has none', () => {
    for (const code of ['resource_explorer_no_view', 'resource_explorer_no_index', 'discovery_listing_truncated', 'access_denied', 'resource_explorer_listresources', null]) {
      expect(resourceExplorerFailureText(code, 'eu-west-1')).toBeNull()
    }
  })
})

describe('the Services region row (flag on): Partial, never "Couldn\'t check"', () => {
  it.each(CASES)('%s -> Partial with its sentence; not a failure; not in "Not checked"', (code, sentence) => {
    const r = mrRegion('eu-west-1', { status: 'partial', error_code: code, state: 'checked_with_warnings', last_success_at: null })
    const row = regionRow(r)
    expect(row.status?.key).toBe('partial')
    expect(row.status?.label).toBe('Partial')
    expect(row.details).toBe(sentence)
    expect(failureCode(r)).toBeNull()
    expect(latestScanNotChecked({ regions: [r] } as unknown as MultiRegionCoverage)).toEqual([])
    expect(partialText(code, 'eu-west-1')).toBe(sentence)
  })

  it('no default view is unchanged (stored ok, its own sentence)', () => {
    const row = regionRow(mrRegion('eu-west-1', { status: 'ok', error_code: 'resource_explorer_no_view', state: 'checked_with_warnings' }))
    expect(row.status?.label).toBe('Partial')
    expect(row.details).toBe("Resource Explorer has no default view in eu-west-1, so some resource types (such as ECS, VPC and DynamoDB) weren't listed. Everything else was checked.")
  })

  it('a core refusal is still "Couldn\'t check: access denied"', () => {
    const row = regionRow(mrRegion('eu-west-1', { status: 'denied', error_code: 'access_denied', state: 'denied', resources: null, resources_from: null, last_success_at: null }))
    expect(row.status?.key).toBe('couldnt')
    expect(row.status?.label).toBe("Couldn't check: access denied")
  })

  it('the existing approved note text is the one the Q2 case reaches (unchanged)', () => {
    expect(REDESIGN_COPY.unattributed).toBe("Resource Explorer wasn't available in at least one region on the last scan, so some resource types may be missing there.")
  })
})

describe('the home region without the flag', () => {
  it('a partial home row reads Partial (homeOnlyStatus)', () => {
    expect(homeOnlyStatus({ region: 'us-east-1', home: true, status: 'partial', last_error_code: DISCOVERY_WARNING_RESOURCE_EXPLORER_DENIED } as unknown as RegionCoverage, false).status?.label).toBe('Partial')
  })

  it.each(CASES)('job warning %s: its own sentence with the home region, never the generic line', (code, sentence) => {
    expect(warningNotes([code], [], 'eu-west-1').map((n) => n.body)).toEqual([sentence])
  })

  it('without a home region the code is not described (the generic line), as for the other Resource Explorer codes', () => {
    expect(warningNotes([DISCOVERY_WARNING_RESOURCE_EXPLORER_DENIED], []).map((n) => n.body)).toEqual([UNKNOWN_WARNING_TEXT])
  })
})

describe('homeRegionWarnings (flag on): a Resource Explorer failure code is the home region\'s only when its own row carries it', () => {
  const coverage = (homeCode: string | null) => ({ multi_region: { regions: [{ region: 'us-east-1', home: true, error_code: homeCode }, { region: 'eu-west-1', home: false, error_code: DISCOVERY_WARNING_RESOURCE_EXPLORER_DENIED }] } }) as unknown as ServicesCoverage

  it('another region\'s code is not the home region\'s', () => {
    expect(homeRegionWarnings(coverage(null), [DISCOVERY_WARNING_RESOURCE_EXPLORER_DENIED, 'scan_deadline'])).toEqual(['scan_deadline'])
  })

  it('the home row\'s own code is kept', () => {
    expect(homeRegionWarnings(coverage(DISCOVERY_WARNING_RESOURCE_EXPLORER_THROTTLED), [DISCOVERY_WARNING_RESOURCE_EXPLORER_THROTTLED])).toEqual([DISCOVERY_WARNING_RESOURCE_EXPLORER_THROTTLED])
  })
})
