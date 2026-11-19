/**
 * Cost Optimization tidy, money rule: the page (lib/utils.ts) and the weekly
 * email (backend/src/utils/formatSavingsCurrency.ts, used by
 * backend/src/services/weekly-brief/format.ts) format savings identically.
 * $0 only for exactly zero; a positive amount under one cent is "<$0.01";
 * a cent-rounded total of 0 with positive estimates behind it is "<$0.01";
 * whole dollars at $1 and above.
 */
import { describe, expect, it } from 'vitest'
import { formatSavingsCurrency, formatSavingsTotal, SUB_CENT } from '../utils'
import {
  formatSavingsCurrency as backendFormatSavingsCurrency,
  formatSavingsTotal as backendFormatSavingsTotal,
  SUB_CENT as BACKEND_SUB_CENT,
} from '../../backend/src/utils/formatSavingsCurrency'
import { formatOpenSavings } from '../../backend/src/services/weekly-brief/format'

const AMOUNTS: (number | null | undefined)[] = [
  null, undefined, 0, 0.0001, 0.004, 0.005, 0.0099, 0.01, 0.011, 0.16, 0.5, 0.99, 0.995, 1, 1.49, 1.5, 12.34, 999.5, 1234.56, -0.5,
]

describe('page and email format every amount the same way', () => {
  it.each(AMOUNTS.map((amount) => [amount]))('formatSavingsCurrency(%s)', (amount) => {
    expect(formatSavingsCurrency(amount)).toBe(backendFormatSavingsCurrency(amount))
  })

  it.each([
    [0, null], [0, 0], [0, 1], [0, 3], [0.004, 1], [0.01, 1], [0.5, 2], [1, 1], [12.34, 4], [null, 2],
  ] as [number | null, number | null][])('formatSavingsTotal(%s, %s)', (total, estimated) => {
    expect(formatSavingsTotal(total, estimated)).toBe(backendFormatSavingsTotal(total, estimated))
  })

  it('one sub-cent string on both sides', () => {
    expect(SUB_CENT).toBe('<$0.01')
    expect(BACKEND_SUB_CENT).toBe(SUB_CENT)
  })
})

describe('the money rule', () => {
  it('$0 only when the value is exactly zero', () => {
    expect(formatSavingsCurrency(0)).toBe('$0')
    expect(formatSavingsCurrency(0.0001)).not.toBe('$0')
  })

  it('a positive amount under one cent is "<$0.01", never "$0.00"', () => {
    expect(formatSavingsCurrency(0.0001)).toBe('<$0.01')
    expect(formatSavingsCurrency(0.004)).toBe('<$0.01')
    expect(formatSavingsCurrency(0.0099)).toBe('<$0.01')
  })

  it('exactly $0.01 is "$0.01"', () => {
    expect(formatSavingsCurrency(0.01)).toBe('$0.01')
    expect(formatSavingsTotal(0.01, 1)).toBe('$0.01')
  })

  it('whole dollars at $1 and above, as before', () => {
    expect(formatSavingsCurrency(1)).toBe('$1')
    expect(formatSavingsCurrency(12.34)).toBe('$12')
    expect(formatSavingsCurrency(1234.56)).toBe('$1,235')
  })

  it('rounded-total edge: 0 with positive estimates behind it is "<$0.01"; with none it is "$0"', () => {
    expect(formatSavingsTotal(0, 2)).toBe('<$0.01')
    expect(formatSavingsTotal(0, 0)).toBe('$0')
    expect(formatSavingsTotal(0, null)).toBe('$0')
    expect(formatSavingsTotal(null, 2)).toBe('—')
  })

  it("the email's open-savings figure is the shared rule plus /mo", () => {
    expect(formatOpenSavings(0, 2)).toBe(`${formatSavingsTotal(0, 2)}/mo`)
    expect(formatOpenSavings(0, 2)).toBe('<$0.01/mo')
    expect(formatOpenSavings(12.34, 2)).toBe(`${formatSavingsTotal(12.34, 2)}/mo`)
    expect(formatOpenSavings(0.004, 1)).toBe('<$0.01/mo')
    expect(formatOpenSavings(0, 0)).toBeNull()
  })
})
