/**
 * Regression coverage for the gp2->gp3 "$0/mo" investigation: a genuine
 * sub-dollar potential_savings value (e.g. $0.16 on a small EBS volume) was
 * being displayed as "$0/mo" because every savings-display call site
 * rounded to whole dollars before formatting. formatSavingsCurrency() is
 * the single shared fix -- see lib/utils.ts for the full rationale.
 */
import { describe, it, expect } from 'vitest'
import { formatSavingsCurrency, annualizeMonthly } from '../utils'

describe('formatSavingsCurrency', () => {
  it('renders null as an em dash (missing/unavailable, never a fabricated zero)', () => {
    expect(formatSavingsCurrency(null)).toBe('—')
  })

  it('renders undefined as an em dash', () => {
    expect(formatSavingsCurrency(undefined)).toBe('—')
  })

  it('renders a genuine zero as "$0", distinct from missing data', () => {
    expect(formatSavingsCurrency(0)).toBe('$0')
  })

  it('renders a genuine sub-dollar saving at 2 decimal places instead of collapsing to $0', () => {
    expect(formatSavingsCurrency(0.01)).toBe('$0.01')
    expect(formatSavingsCurrency(0.16)).toBe('$0.16')
    expect(formatSavingsCurrency(0.99)).toBe('$0.99')
  })

  it('rounds to a whole dollar once the amount reaches $1', () => {
    expect(formatSavingsCurrency(1)).toBe('$1')
  })

  it('still rounds larger values to whole dollars, unchanged from prior behavior', () => {
    expect(formatSavingsCurrency(12.34)).toBe('$12')
    expect(formatSavingsCurrency(1234.56)).toBe('$1,235')
  })

  it('composes with annualizeMonthly() using the same rounding rule -- no separate annualized methodology', () => {
    expect(formatSavingsCurrency(annualizeMonthly(0.16))).toBe('$2')
  })
})
