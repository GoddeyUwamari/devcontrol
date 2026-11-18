import { describe, expect, it } from 'vitest'
import { PARTIAL_MESSAGE } from '../../cost-optimization/costScanBanner'
import { ANALYSIS_PARTIAL_NOTE } from '../../../../backend/src/config/weekly-email-copy'

// The weekly summary email no longer repeats the Connect AWS page's
// failing-connection help (executive brief, founder F3); its connection item
// is the approved Q2 copy, pinned in backend/src/services/weekly-brief tests.

// The Cost Optimization page's partial-analysis sentence (WE-2 review H-1).
describe('weekly summary email: partial cost analysis sentence', () => {
  it('is the Cost Optimization page text, word for word', () => {
    expect(ANALYSIS_PARTIAL_NOTE).toBe(PARTIAL_MESSAGE)
  })
})
