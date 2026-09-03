/**
 * Focused coverage for computeDashboardAwsGates -- the pure gating logic
 * behind PR 30's Dashboard fix: the Cost-saving-opportunities and Executive
 * ROI summary sections (driven by cost_recommendations, populated by the
 * fast ~30-120s discovery scan) must no longer wait on hasBillingData/
 * hasServicesOnly (the separate, much slower 24-48h AWS Cost Explorer
 * billing sync). Before this fix, showRecommendationSections' equivalent
 * condition also required !hasServicesOnly, hiding already-available
 * savings data for up to 24-48h.
 */
import { describe, it, expect } from 'vitest'
import { computeDashboardAwsGates } from '../dashboardAwsGates'

describe('computeDashboardAwsGates', () => {
  it('demo mode always shows recommendation sections, regardless of stats', () => {
    const gates = computeDashboardAwsGates({
      isDemoActive: true,
      isAwsConnected: true,
      statsLoading: false,
      stats: undefined,
    })
    expect(gates.showRecommendationSections).toBe(true)
  })

  it('not connected -> recommendation sections stay hidden', () => {
    const gates = computeDashboardAwsGates({
      isDemoActive: false,
      isAwsConnected: false,
      statsLoading: false,
      stats: undefined,
    })
    expect(gates.showRecommendationSections).toBe(false)
  })

  it('earliest phase (0 services discovered yet) -> isBillingSyncing and recommendation sections stay hidden', () => {
    const gates = computeDashboardAwsGates({
      isDemoActive: false,
      isAwsConnected: true,
      statsLoading: false,
      stats: { totalServices: 0, monthlyAwsCost: 0, costSource: undefined },
    })
    expect(gates.isBillingSyncing).toBe(true)
    expect(gates.showRecommendationSections).toBe(false)
  })

  it('services discovered but billing not yet synced (hasServicesOnly) -> recommendation sections ARE shown -- the PR 30 fix', () => {
    const gates = computeDashboardAwsGates({
      isDemoActive: false,
      isAwsConnected: true,
      statsLoading: false,
      stats: { totalServices: 12, monthlyAwsCost: 0, costSource: undefined },
    })
    expect(gates.hasServicesOnly).toBe(true)
    expect(gates.hasBillingData).toBe(false)
    expect(gates.isBillingSyncing).toBe(false)
    // The actual regression this PR fixes: previously gated on !hasServicesOnly,
    // which would have made this false even though cost_recommendations may
    // already be populated at this point.
    expect(gates.showRecommendationSections).toBe(true)
  })

  it('full billing data available -> recommendation sections shown (unchanged prior behavior)', () => {
    const gates = computeDashboardAwsGates({
      isDemoActive: false,
      isAwsConnected: true,
      statsLoading: false,
      stats: { totalServices: 12, monthlyAwsCost: 842.5, costSource: 'actual' },
    })
    expect(gates.hasBillingData).toBe(true)
    expect(gates.showRecommendationSections).toBe(true)
  })

  it('stats still loading (before the first response) -> recommendation sections stay hidden, avoiding a false "no opportunities" flash', () => {
    const gates = computeDashboardAwsGates({
      isDemoActive: false,
      isAwsConnected: true,
      statsLoading: true,
      stats: undefined,
    })
    expect(gates.isBillingSyncing).toBe(false)
    expect(gates.showRecommendationSections).toBe(false)
  })
})
