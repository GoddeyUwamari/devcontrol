import { describe, expect, it } from 'vitest'
import { HEALTH_FAILING_HELP } from '../connectAwsCopy'
import { PARTIAL_MESSAGE } from '../../cost-optimization/costScanBanner'
import { ANALYSIS_PARTIAL_NOTE, CONNECTION_FAILING_HELP } from '../../../../backend/src/config/weekly-email-copy'

// The weekly summary email repeats the Connect AWS page's failing-connection help (WE-2).
describe('weekly summary email: connection help text', () => {
  it('is the Connect AWS page text, word for word', () => {
    expect(CONNECTION_FAILING_HELP).toBe(HEALTH_FAILING_HELP)
  })
})

// ...and the Cost Optimization page's partial-analysis sentence (WE-2 review H-1).
describe('weekly summary email: partial cost analysis sentence', () => {
  it('is the Cost Optimization page text, word for word', () => {
    expect(ANALYSIS_PARTIAL_NOTE).toBe(PARTIAL_MESSAGE)
  })
})
