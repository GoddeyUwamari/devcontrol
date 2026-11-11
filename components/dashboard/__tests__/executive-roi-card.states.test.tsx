/**
 * CAT-3 (§4.1, CAT-D11, C3-D1): one explicit line per situation, and never a
 * "nothing to save" conclusion from an empty list (a completed scan does not
 * record whether each check succeeded).
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ExecutiveRoiCard } from '../executive-roi-card'
import type { OpportunityEvaluationState } from '../savings-opportunities'

// Same pattern as no-unsupported-no-opportunities.test.tsx.
const NO_OPPORTUNITIES_CLAIM = /no (active )?(cost[- ])?(saving|optimi[sz]ation)s? ?(opportunit|found|detected|identified)|no savings|nothing to optimi|no waste/i

type Props = Parameters<typeof ExecutiveRoiCard>[0]
const BASE: Props = { monthlySavingsLabel: null, annualSavingsLabel: null, isDemoActive: false }

function renderCard(props: Partial<Props>) {
  const view = render(<ExecutiveRoiCard {...BASE} {...props} />)
  const card = view.container.firstElementChild as HTMLElement
  return { ...view, card, text: () => card.textContent ?? '' }
}

function expectCommon(text: string) {
  expect(screen.getByRole('heading', { name: 'Estimated savings' })).toBeInTheDocument()
  expect(screen.getByText('View findings →').closest('a')!.getAttribute('href')).toBe('/cost-optimization')
  expect(text).not.toMatch(NO_OPPORTUNITIES_CLAIM)
  expect(text).not.toMatch(/Executive ROI|realized|View report/)
}

const stateLine = () => screen.getAllByTestId('roi-state')

describe('one line per situation', () => {
  it('demo: the sample figure, labelled as a sample', () => {
    const { text } = renderCard({ isDemoActive: true, monthlySavingsLabel: '$1,922.00', annualSavingsLabel: '$23,064.00' })
    expect(text()).toContain('Estimated monthly savings (sample)')
    expect(text()).toContain('$1,922.00')
    expectCommon(text())
  })

  it('stats loading: "Loading…", no figure', () => {
    const { text } = renderCard({ statsLoading: true, evaluationState: 'evaluated', activeCount: null })
    expect(stateLine()).toHaveLength(1)
    expect(text()).toContain('Loading…')
    expect(text()).not.toMatch(/\$\d/)
    expectCommon(text())
  })

  it('stats request failed: "Savings couldn’t be loaded." with a Retry that calls back', () => {
    const onRetry = vi.fn()
    const { text } = renderCard({ statsFailed: true, evaluationState: 'evaluated', activeCount: null, onRetry })
    expect(stateLine()).toHaveLength(1)
    expect(text()).toContain('Savings couldn’t be loaded.')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    expectCommon(text())
  })

  it('another request failed (unavailable): the same line', () => {
    const { text } = renderCard({ evaluationState: 'unavailable', activeCount: 0, onRetry: vi.fn() })
    expect(text()).toContain('Savings couldn’t be loaded.')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expectCommon(text())
  })

  it.each<[OpportunityEvaluationState, string]>([
    ['not_evaluated', 'Shown after your first cost analysis finishes.'],
    ['in_progress', 'Cost analysis in progress. Savings appear when it finishes.'],
    ['loading', 'Loading…'],
  ])('no active finding, analysis %s: "%s"', (evaluationState, line) => {
    const { text } = renderCard({ evaluationState, activeCount: 0 })
    expect(stateLine()).toHaveLength(1)
    expect(text()).toContain(line)
    expectCommon(text())
  })

  it('last analysis failed: says so and links to Cost Optimization', () => {
    const { text } = renderCard({ evaluationState: 'failed', activeCount: 0 })
    expect(text()).toContain('The last cost analysis didn’t finish.')
    expect(screen.getByText('See Cost Optimization →').closest('a')!.getAttribute('href')).toBe('/cost-optimization')
    expectCommon(text())
  })

  it('evaluated with nothing flagged: a fact about the run, not a conclusion (C3-D1)', () => {
    const { text } = renderCard({ evaluationState: 'evaluated', activeCount: 0 })
    expect(text()).toContain('Nothing flagged in the last cost analysis.')
    expect(screen.getByText('See results by check →').closest('a')!.getAttribute('href')).toBe('/cost-optimization')
    expectCommon(text())
  })

  it('findings without a dollar figure: counts them and says none has an estimate', () => {
    const { text, unmount } = renderCard({ evaluationState: 'evaluated', activeCount: 3 })
    expect(text()).toContain('3 findings found; none has a dollar estimate yet.')
    expectCommon(text())
    unmount()
    renderCard({ evaluationState: 'evaluated', activeCount: 1 })
    expect(screen.getByText('1 finding found; none has a dollar estimate yet.')).toBeInTheDocument()
  })

  it('findings whose only figure is the S3 lifecycle ceiling: shown as an upper bound', () => {
    const { text } = renderCard({ evaluationState: 'evaluated', activeCount: 2, ceilingLabel: '$12.00' })
    expect(text()).toContain('Up to $12.00/month · S3 lifecycle, upper bound')
    expectCommon(text())
  })

  it('an estimate: the figure, its annual figure, and no state line', () => {
    const { text } = renderCard({ monthlySavingsLabel: '$94.50', annualSavingsLabel: '$1,134.00', evaluationState: 'evaluated', activeCount: 2 })
    expect(screen.queryByTestId('roi-state')).toBeNull()
    expect(text()).toContain('Estimated monthly savings')
    expect(text()).not.toContain('(sample)')
    expect(text()).toContain('$94.50')
    expect(text()).toContain('Potential annual savings')
    expect(text()).toContain('(estimated)')
    expect(text()).not.toContain('S3 lifecycle')
    expectCommon(text())
  })

  it('an estimate and a ceiling: the ceiling is shown apart, never added', () => {
    const { text } = renderCard({ monthlySavingsLabel: '$94.50', annualSavingsLabel: '$1,134.00', ceilingLabel: '$12.00', evaluationState: 'evaluated', activeCount: 2 })
    expect(text()).toContain('$94.50')
    expect(text()).toContain('Plus up to $12.00/month from S3 lifecycle (upper bound)')
    expect(text()).not.toContain('$106.50')
    expectCommon(text())
  })
})

describe('precedence', () => {
  it('an active finding wins over a "not evaluated" analysis state', () => {
    const { text } = renderCard({ evaluationState: 'not_evaluated', activeCount: 2 })
    expect(text()).toContain('2 findings found; none has a dollar estimate yet.')
    expect(text()).not.toContain('Shown after your first cost analysis finishes.')
  })

  it('a failed stats request wins over the analysis state (no count is known)', () => {
    const { text } = renderCard({ statsFailed: true, evaluationState: 'evaluated', activeCount: null })
    expect(text()).not.toContain('Nothing flagged')
  })
})
