/**
 * S35, the flag-off coverage footer (founder copy fix, PR 3c, page-local): with
 * no S3 bucket outside the home region, the count clause is dropped and the line
 * reads exactly "S3 and CloudFront are checked in every region on each scan.";
 * with n > 0 it is unchanged; the flag-on footer is untouched. TZ UTC.
 */
process.env.TZ = 'UTC'

import { describe, it, expect } from 'vitest'
import { describeCoverageCard } from '../redesignModel'
import { R_NOW, docExample, flaggedCoverage, scanOf, tab5 } from './redesign-fixtures'

describe('S35 flag-off footer (founder copy fix, PR 3c)', () => {
  it('n > 0: unchanged', () => {
    expect(describeCoverageCard(scanOf(tab5()).coverage, R_NOW).footer[0]).toEqual(['S3 and CloudFront are checked in every region on each scan: 3 S3 buckets outside us-east-1.'])
  })

  it('n = 0: the count clause dropped, exactly', () => {
    const cov = tab5()
    cov.scope.s3.regions = [{ region: 'us-east-1', count: 3 }]
    expect(describeCoverageCard(cov, R_NOW).footer[0]).toEqual(['S3 and CloudFront are checked in every region on each scan.'])
  })

  it('flag on: unchanged', () => {
    expect(describeCoverageCard(flaggedCoverage(docExample('all_checked')), R_NOW).footer[0]).toEqual(['S3 and CloudFront are checked on every scan.'])
  })
})
