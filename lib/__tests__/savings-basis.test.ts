import { describe, expect, it } from 'vitest'
import { formatRecommendationSavings, NO_DOLLAR_ESTIMATE, savingsBasisKind } from '../savings-basis'
import { formatSavingsCents, formatSavingsCurrency } from '../utils'

const rec = (potentialSavings: number, savings_basis?: unknown) => ({ potentialSavings, metadata: savings_basis === undefined ? {} : { savings_basis } })

describe('savingsBasisKind', () => {
  it('recognises exactly the prefixes the backend detectors write', () => {
    expect(savingsBasisKind(rec(1, 'estimated: list price'))).toBe('estimate')
    expect(savingsBasisKind(rec(1, 'scenario:highest_observed_hourly_average — x'))).toBe('estimate')
    expect(savingsBasisKind(rec(1, 'comparison:on_demand_vs_provisioned_observed_workload — x'))).toBe('estimate')
    expect(savingsBasisKind(rec(1, 'ceiling: assumes 100% transitions'))).toBe('ceiling')
  })

  it('a missing, empty, non-string or unrecognised basis is neither', () => {
    for (const basis of [undefined, null, '', 'ceiling', 'Estimated: x', 'guess: x', 42]) {
      expect(savingsBasisKind(rec(1, basis))).toBeNull()
    }
    expect(savingsBasisKind({})).toBeNull()
    expect(savingsBasisKind({ metadata: null })).toBeNull()
  })
})

describe('formatRecommendationSavings', () => {
  it('an estimate is a plain monthly figure', () => {
    expect(formatRecommendationSavings(rec(12.4, 'estimated: list price'), formatSavingsCents)).toBe('$12.40/mo')
  })

  it('a ceiling reads "Up to $X/mo"', () => {
    expect(formatRecommendationSavings(rec(41.27, 'ceiling: assumes 100% transitions'), formatSavingsCurrency)).toBe('Up to $41/mo')
    expect(formatRecommendationSavings(rec(41.27, 'ceiling: assumes 100% transitions'), formatSavingsCents, '/month')).toBe('Up to $41.27/month')
  })

  it('no savings basis reads "No dollar estimate" -- never "$0.00/mo"', () => {
    expect(formatRecommendationSavings(rec(0), formatSavingsCents)).toBe(NO_DOLLAR_ESTIMATE)
    expect(formatRecommendationSavings(rec(98, 'made up'), formatSavingsCents)).toBe('No dollar estimate')
  })
})
