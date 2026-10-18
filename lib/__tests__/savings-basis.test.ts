import { describe, expect, it } from 'vitest'
import { describeCeilings, formatRecommendationSavings, NO_DOLLAR_ESTIMATE, rankBySavings, savingsBasisKind } from '../savings-basis'
import { formatSavingsCents, formatSavingsCurrency } from '../utils'

const rec = (potentialSavings: number, savings_basis?: unknown) => ({ potentialSavings, metadata: savings_basis === undefined ? {} : { savings_basis } })

describe('savingsBasisKind', () => {
  it('recognises exactly the prefixes the backend detectors write', () => {
    expect(savingsBasisKind(rec(1, 'estimated: list price'))).toBe('estimate')
    expect(savingsBasisKind(rec(1, 'scenario:highest_observed_hourly_average — x'))).toBe('ceiling')
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

  it('a Reserved Instance coverage gap (potential_savings 0, no basis) reads "No dollar estimate"', () => {
    const ri = { potentialSavings: 0, metadata: { instance_type: 'm5.large', uncovered_count: 2, coverage_basis: 'Reserved Instances of the same instance type only; Savings Plans are not accounted for' } }
    expect(formatRecommendationSavings(ri, formatSavingsCents)).toBe('No dollar estimate')
    expect(formatRecommendationSavings(ri, formatSavingsCurrency)).not.toMatch(/\$/)
  })
})

describe('describeCeilings', () => {
  it('one line per type, S3 then DynamoDB then others, each saying what it assumes; zero amounts are skipped', () => {
    expect(describeCeilings({ Other: 5, DynamoDB: 20, S3: 41.27, EBS: 0 }, formatSavingsCurrency)).toEqual([
      'Plus up to $41/mo if S3 data qualifies for Standard-IA (upper bound, not included above)',
      'Plus up to $20/mo if DynamoDB provisioned capacity were cut to its observed peak (upper bound, not included above)',
      'Plus up to $5/mo from Other upper-bound figures (not included above)',
    ])
    expect(describeCeilings({}, formatSavingsCurrency)).toEqual([])
  })
})

describe('rankBySavings', () => {
  it('estimates first, then ceilings, then no basis -- each largest first; a bigger ceiling never outranks an estimate', () => {
    const recs = [
      { id: 'ceiling-big', ...rec(500, 'ceiling: x') },
      { id: 'none-big', ...rec(900) },
      { id: 'estimate-small', ...rec(3.6, 'estimated: x') },
      { id: 'estimate-big', ...rec(70, 'estimated: x') },
      { id: 'ceiling-small', ...rec(41, 'ceiling: x') },
      { id: 'comparison', ...rec(20, 'comparison: x') },
    ]
    expect(rankBySavings(recs).map((r) => r.id)).toEqual(['estimate-big', 'comparison', 'estimate-small', 'ceiling-big', 'ceiling-small', 'none-big'])
    expect(recs[0].id).toBe('ceiling-big') // input not mutated
  })
})
