/**
 * "Never show $0": the page's row rule (lib/savings-basis.ts savingsFigure)
 * and the backend's (backend/src/services/estimated-savings.ts savingsFigure,
 * used by the activity feed) agree on every row, and both agree with the
 * backend's own count definition (countSavingsFindings: an estimate counts
 * only when it adds more than $0). This test fails if the two sides diverge.
 */
import { describe, expect, it } from 'vitest'
import { LESS_THAN_ONE_CENT, SAVINGS_UNROUNDED_FIELD, isPricedFigure, savingsFigure } from '../savings-basis'
import {
  countSavingsFindings,
  LESS_THAN_ONE_CENT as BACKEND_LESS_THAN_ONE_CENT,
  SAVINGS_UNROUNDED_FIELD as BACKEND_SAVINGS_UNROUNDED_FIELD,
  savingsFigure as backendSavingsFigure,
} from '../../backend/src/services/estimated-savings'

const BASES: unknown[] = [undefined, null, '', 42, 'guess: x', 'estimated: list price', 'comparison: x', 'ceiling: x', 'scenario: x']
const FIGURES: (number | string | null)[] = [null, 0, '0', '0.00', -0.5, Number.NaN, 0.004, 0.01, '0.01', 0.996, 12.4, '41.27', '', 'abc']
const FIELDS: unknown[] = [undefined, 0, 0.0012, 0.0049, 0.01, -0.001, '0.003', null]

const cases = BASES.flatMap((basis) => FIGURES.flatMap((figure) => FIELDS.map((field) => ({ basis, figure, field }))))
const metadataOf = ({ basis, field }: { basis: unknown; field: unknown }) => ({
  ...(basis === undefined ? {} : { savings_basis: basis }),
  ...(field === undefined ? {} : { [SAVINGS_UNROUNDED_FIELD]: field }),
})

describe('page and backend apply one row rule', () => {
  it('the same field name and wording on both sides', () => {
    expect(BACKEND_SAVINGS_UNROUNDED_FIELD).toBe(SAVINGS_UNROUNDED_FIELD)
    // The page starts its row text with it; the backend puts it mid-sentence.
    expect(BACKEND_LESS_THAN_ONE_CENT).toBe(LESS_THAN_ONE_CENT.charAt(0).toLowerCase() + LESS_THAN_ONE_CENT.slice(1))
  })

  it.each(cases.map((c) => [JSON.stringify(c), c] as const))('savingsFigure %s', (_label, c) => {
    const metadata = metadataOf(c)
    const page = savingsFigure({ potentialSavings: c.figure, metadata })
    const backend = backendSavingsFigure({ potential_savings: c.figure, metadata })
    expect(backend).toEqual(page)
  })

  it.each(cases.map((c) => [JSON.stringify(c), c] as const))('an estimate is priced exactly when countSavingsFindings counts it: %s', (_label, c) => {
    const metadata = metadataOf(c)
    const page = savingsFigure({ potentialSavings: c.figure, metadata })
    const counted = countSavingsFindings([{ resource_type: 'X', potential_savings: c.figure as never, metadata: metadata as never }]).estimatedFindings === 1
    // A numeric string the backend's parseFloat would read but the page wouldn't ("12abc") is not in FIGURES.
    expect(counted).toBe(page.kind === 'estimate' && isPricedFigure(page))
  })
})
