/**
 * "Never show $0" (founder rulings 2026-11-26, review-logs/never-zero/stage-a.md
 * Addendum 1): the one row rule (savingsFigure / formatSavingsFigure), the one
 * total rule (describeSavingsTotal) and the plain-amount rule (formatPlainSavings)
 * in lib/savings-basis.ts, in every state. Parity with the backend mirror is in
 * savings-figure-parity.test.ts.
 */
import { describe, expect, it } from 'vitest'
import {
  describeSavingsTotal,
  formatPlainSavings,
  formatRecommendationSavings,
  formatSavingsFigure,
  isPricedFigure,
  LESS_THAN_ONE_CENT,
  NO_DOLLAR_ESTIMATE,
  NONE_FOUND,
  NONE_FOUND_PARTIAL,
  NONE_YET,
  rankBySavings,
  recordedSubCentAmount,
  SAVINGS_UNROUNDED_FIELD,
  savingsFigure,
  type SavingsTotalInput,
} from '../savings-basis'
import { formatSavingsCents, formatSavingsCurrency } from '../utils'

const EST = 'estimated: list price'
const CEIL = 'ceiling: assumes 100% transitions'
const CMP = 'comparison: on_demand_vs_provisioned'
const row = (potentialSavings: number | string | null, basis?: unknown, extra: Record<string, unknown> = {}) =>
  ({ potentialSavings: potentialSavings as number, metadata: { ...(basis === undefined ? {} : { savings_basis: basis }), ...extra } })

/** A money zero in rendered text: "$0", "$0.0", "$0.00" (not "$0.01", not "<$0.01"), or a bare "0/mo". */
const MONEY_ZERO = /(?<![<\d.,])\$0(?:\.0{1,2})?(?![.\d])|(?<![\d.$])0\/mo\b/

describe('savingsFigure: the one row rule', () => {
  it('a figure only for an estimate or ceiling basis AND a finite stored figure above $0', () => {
    expect(savingsFigure(row(12.4, EST))).toEqual({ kind: 'estimate', amount: 12.4, subCent: false })
    expect(savingsFigure(row(12.4, CMP))).toEqual({ kind: 'estimate', amount: 12.4, subCent: false })
    expect(savingsFigure(row(41.27, CEIL))).toEqual({ kind: 'ceiling', amount: 41.27, subCent: false })
    expect(savingsFigure(row('0.01', EST))).toEqual({ kind: 'estimate', amount: 0.01, subCent: false })
    expect(savingsFigure(row(0.996, EST))).toEqual({ kind: 'estimate', amount: 0.996, subCent: false })
  })

  it('no basis, or a basis with a figure of 0, NaN, negative, missing or not a number, is no figure', () => {
    for (const basis of [undefined, null, '', 'guess: x', 42]) expect(savingsFigure(row(12, basis))).toEqual({ kind: 'none' })
    for (const basis of [EST, CMP, CEIL]) {
      for (const figure of [0, '0.00', Number.NaN, -0.5, null, '', 'abc', Number.POSITIVE_INFINITY]) {
        expect(savingsFigure(row(figure, basis))).toEqual({ kind: 'none' })
      }
    }
    expect(savingsFigure({ potentialSavings: 5 })).toEqual({ kind: 'none' })
    expect(savingsFigure({ potentialSavings: 5, metadata: null })).toEqual({ kind: 'none' })
  })

  it('safeguard Q2: sub-cent only from a recorded unrounded amount (0 < x < $0.01) on a stored 0, never inferred', () => {
    expect(SAVINGS_UNROUNDED_FIELD).toBe('savings_unrounded_usd')
    expect(savingsFigure(row(0, EST, { savings_unrounded_usd: 0.0012 }))).toEqual({ kind: 'estimate', amount: 0.0012, subCent: true })
    expect(savingsFigure(row('0.00', CEIL, { savings_unrounded_usd: 0.004 }))).toEqual({ kind: 'ceiling', amount: 0.004, subCent: true })
    // A stored zero without the field, or with a field that isn't a genuine positive sub-cent number: no figure.
    for (const field of [undefined, 0, -0.001, 0.01, 0.02, '0.003', null, Number.NaN]) {
      expect(savingsFigure(row(0, EST, field === undefined ? {} : { savings_unrounded_usd: field }))).toEqual({ kind: 'none' })
    }
    // No basis (gated or unpriced) is never sub-cent, whatever the field says.
    expect(savingsFigure(row(0, undefined, { savings_unrounded_usd: 0.003 }))).toEqual({ kind: 'none' })
    // A stored figure above $0 wins over the field; a missing stored figure is never turned into one.
    expect(savingsFigure(row(0.01, EST, { savings_unrounded_usd: 0.003 }))).toEqual({ kind: 'estimate', amount: 0.01, subCent: false })
    expect(savingsFigure(row(null, EST, { savings_unrounded_usd: 0.003 }))).toEqual({ kind: 'none' })
    expect(recordedSubCentAmount(null)).toBeNull()
  })

  it('isPricedFigure: only a stored figure above $0 is priced (what totals and "K priced" counts include)', () => {
    expect(isPricedFigure(savingsFigure(row(1, EST)))).toBe(true)
    expect(isPricedFigure(savingsFigure(row(1, CEIL)))).toBe(true)
    expect(isPricedFigure(savingsFigure(row(0, EST, { savings_unrounded_usd: 0.002 })))).toBe(false)
    expect(isPricedFigure(savingsFigure(row(0, EST)))).toBe(false)
  })
})

describe('formatSavingsFigure / formatRecommendationSavings: never "$0"', () => {
  it('each kind in its own words', () => {
    expect(formatSavingsFigure({ kind: 'estimate', amount: 12.4, subCent: false }, formatSavingsCents)).toBe('$12.40/mo')
    expect(formatSavingsFigure({ kind: 'ceiling', amount: 41.27, subCent: false }, formatSavingsCurrency)).toBe('Up to $41/mo')
    expect(formatSavingsFigure({ kind: 'estimate', amount: 0.004, subCent: true }, formatSavingsCurrency)).toBe('Less than $0.01/mo')
    // Ceiling: the saving is at most the bound, so under a cent too; surfaces keep their own upper-bound marker.
    expect(formatSavingsFigure({ kind: 'ceiling', amount: 0.004, subCent: true }, formatSavingsCurrency)).toBe('Less than $0.01/mo')
    expect(formatSavingsFigure({ kind: 'none' }, formatSavingsCurrency)).toBe(NO_DOLLAR_ESTIMATE)
    expect(formatSavingsFigure({ kind: 'estimate', amount: 0.004, subCent: true }, formatSavingsCents, '/month')).toBe('Less than $0.01/month')
    expect(LESS_THAN_ONE_CENT).toBe('Less than $0.01')
  })

  it('the no-figure fixtures (rds_idle, cloudwatch_unused_logs, gated DynamoDB, Lambda/S3 without a recorded amount) never read as money zero', () => {
    const noFigure = [
      row(0), // rds_idle unpriced, cloudwatch_unused_logs, RI, NAT/EBS-snapshot unpriced: no basis
      row(0, CMP), // gated DynamoDB comparison
      row(0, EST), // Lambda stored 0.00, no recorded amount
      row(0, CEIL), // small S3 bucket stored 0.00, no recorded amount
      row(0, EST, { savings_unrounded_usd: 0 }), // zero invocations
    ]
    for (const rec of noFigure) {
      for (const format of [formatSavingsCurrency, formatSavingsCents]) {
        const text = formatRecommendationSavings(rec, format)
        expect(text).toBe(NO_DOLLAR_ESTIMATE)
        expect(text).not.toMatch(MONEY_ZERO)
      }
    }
  })
})

const stats = (o: Partial<SavingsTotalInput> = {}): SavingsTotalInput => ({
  totalPotentialSavings: 0, estimatedFindings: 0, potentialSavingsCeiling: 0, potentialSavingsCeilingByResourceType: {}, activeRecommendations: 0, ...o,
})

describe('describeSavingsTotal: the one total rule', () => {
  it('firm: the estimate total with its upper bounds on their own lines; green only at $1 or more as displayed', () => {
    const firm = describeSavingsTotal(stats({ totalPotentialSavings: 53.4, estimatedFindings: 2, activeRecommendations: 3, potentialSavingsCeiling: 4, potentialSavingsCeilingByResourceType: { S3: 4 } }))
    expect(firm).toEqual({ kind: 'firm', amount: '$53', value: '$53/mo', strong: true, lines: ['Plus up to $4/mo if S3 data qualifies for Standard-IA (upper bound, not included above)'] })
    expect(describeSavingsTotal(stats({ totalPotentialSavings: 0.5, estimatedFindings: 1, activeRecommendations: 1 }))).toMatchObject({ kind: 'firm', value: '$0.50/mo', strong: false })
    // Positive estimates whose cent-rounded total is 0: "<$0.01", never "$0".
    expect(describeSavingsTotal(stats({ totalPotentialSavings: 0, estimatedFindings: 2, activeRecommendations: 2 }))).toMatchObject({ kind: 'firm', amount: '<$0.01', strong: false })
    // The surface's own formatter.
    expect(describeSavingsTotal(stats({ totalPotentialSavings: 12.3, estimatedFindings: 1, activeRecommendations: 1 }), { format: formatSavingsCents })).toMatchObject({ amount: '$12.30' })
  })

  it('upper bound only, no estimate, none found (partial or not), unavailable', () => {
    expect(describeSavingsTotal(stats({ activeRecommendations: 1, potentialSavingsCeiling: 7, potentialSavingsCeilingByResourceType: { S3: 7 } })))
      .toEqual({ kind: 'upper_bound_only', value: 'Up to $7/mo · upper bound only', lines: ['No firm estimate yet.'] })
    expect(describeSavingsTotal(stats({ activeRecommendations: 4 }))).toEqual({ kind: 'no_estimate', value: NO_DOLLAR_ESTIMATE, lines: ['No dollar estimate yet for the open opportunities.'] })
    expect(describeSavingsTotal(stats())).toEqual({ kind: 'none_found', value: NONE_FOUND, lines: ['No open opportunities after the latest analysis'] })
    expect(describeSavingsTotal(stats(), { partialRun: true })).toEqual({ kind: 'none_found', value: NONE_FOUND_PARTIAL, lines: ["Some checks couldn't run in the latest analysis"] })
    for (const input of [null, undefined, stats({ totalPotentialSavings: null, activeRecommendations: 2 }), stats({ totalPotentialSavings: Number.NaN })]) {
      expect(describeSavingsTotal(input)).toEqual({ kind: 'unavailable', value: '—', lines: [] })
    }
  })

  it('never "$0" in any kind', () => {
    const inputs = [stats(), stats({ activeRecommendations: 3 }), stats({ totalPotentialSavings: 0, estimatedFindings: 1, activeRecommendations: 1 }), null]
    for (const input of inputs) {
      for (const format of [formatSavingsCurrency, formatSavingsCents]) {
        const total = describeSavingsTotal(input, { format })
        expect([total.value, ...total.lines].join(' | ')).not.toMatch(MONEY_ZERO)
      }
    }
  })
})

describe('formatPlainSavings (Remediation, ruling Q5)', () => {
  it('above $0 a figure, otherwise "No dollar estimate"', () => {
    expect(formatPlainSavings(42)).toBe('$42/mo')
    expect(formatPlainSavings('12.50', (v) => `$${v.toFixed(2)}`)).toBe('$12.50/mo')
    for (const v of [0, '0', '0.00', null, undefined, Number.NaN, -1, 'abc']) expect(formatPlainSavings(v)).toBe(NO_DOLLAR_ESTIMATE)
    expect(NONE_YET).toBe('None yet')
  })
})

describe('rankBySavings on the row rule', () => {
  it('a basis with a figure not above $0 ranks with the no-figure rows, after every priced one', () => {
    const lam = row(0, EST)
    const ddb = row(0, CMP)
    const est = row(3, EST)
    const ceil = row(50, CEIL)
    const sub = row(0, EST, { savings_unrounded_usd: 0.002 })
    const none = row(9)
    expect(rankBySavings([lam, none, ceil, sub, ddb, est])).toEqual([est, sub, ceil, lam, none, ddb])
  })
})
