/**
 * A completed cost scan does not yet record whether each check succeeded or
 * had enough data, so an empty recommendation list is not evidence that
 * nothing can be saved. These cards must draw no "no opportunities"
 * conclusion from it -- while real findings stay visible and their savings
 * stay labeled as estimates.
 */
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { RecommendedActionCard } from '../recommended-action-card'
import { SavingsOpportunities } from '../savings-opportunities'
import { ExecutiveRoiCard } from '../executive-roi-card'

const NO_OPPORTUNITIES_CLAIM = /no (active )?(cost[- ])?(saving|optimi[sz]ation)s? ?(opportunit|found|detected|identified)|no savings|nothing to optimi|no waste/i

describe('dashboard cards with nothing active draw no "no opportunities" conclusion', () => {
  it('RecommendedActionCard renders nothing at all', () => {
    const { container } = render(<RecommendedActionCard opportunityCount={0} savingsLabel={null} ctaHref="/cost-optimization" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('SavingsOpportunities, evaluated with no categories, makes no claim', () => {
    const { container } = render(<SavingsOpportunities items={[]} evaluationState="evaluated" totalActiveCount={0} />)
    expect(container.textContent).not.toMatch(NO_OPPORTUNITIES_CLAIM)
  })

  it('ExecutiveRoiCard with no savings figure makes no claim', () => {
    const { container } = render(<ExecutiveRoiCard monthlySavingsLabel={null} annualSavingsLabel={null} isDemoActive={false} />)
    expect(container.textContent).not.toMatch(NO_OPPORTUNITIES_CLAIM)
  })
})

describe('real findings stay visible, with savings labeled as estimates', () => {
  it('RecommendedActionCard shows the count, an estimated savings label, and the CTA', () => {
    const { container } = render(<RecommendedActionCard opportunityCount={3} savingsLabel="$94.50/mo" ctaHref="/cost-optimization" />)
    expect(container.textContent).toContain('3 optimization opportunities identified')
    expect(container.textContent).toContain('Estimated potential savings: $94.50/mo')
    expect(container.textContent).toContain('Review Savings (3)')
  })

  it('SavingsOpportunities shows a category with an active finding', () => {
    const { container } = render(
      <SavingsOpportunities
        items={[{ type: 'EC2', title: 'Review EC2 instances', description: 'Idle-instance candidates (low average CPU) and Reserved Instance coverage estimates', count: 1, savingsLabel: '$70.00/mo' }]}
        evaluationState="evaluated"
        totalActiveCount={1}
      />
    )
    expect(container.textContent).toContain('Review EC2 instances')
    expect(container.textContent).toContain('$70.00/mo')
    expect(container.textContent).not.toMatch(/right-?siz/i)
  })

  it('ExecutiveRoiCard labels its figure as estimated', () => {
    const { container } = render(<ExecutiveRoiCard monthlySavingsLabel="$94.50" annualSavingsLabel="$1,134" isDemoActive={false} />)
    expect(container.textContent).toContain('Estimated monthly savings')
    expect(container.textContent).toContain('(estimated)')
  })
})
