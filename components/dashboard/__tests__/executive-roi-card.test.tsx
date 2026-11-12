/**
 * Estimated savings (CAT-3, CAT-D11: was "Executive ROI Summary" / "View
 * report →" to /costs). Since PR-UI-b (DB-D12 S1) it is no longer its own
 * card: it is the header of Cost-Saving Opportunities, whose heading and
 * "View all →" link (to the same findings) it shares. Per-state lines are
 * pinned in executive-roi-card.states.test.tsx.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EstimatedSavingsSummary } from '../executive-roi-card'
import { SavingsOpportunities } from '../savings-opportunities'

describe('Estimated savings, merged into Cost-Saving Opportunities (S1)', () => {
  it('sits under the Cost-Saving Opportunities heading, which links to the findings; no "Estimated savings" card heading', () => {
    render(<SavingsOpportunities items={[]} evaluationState="evaluated" totalActiveCount={2} summary={<EstimatedSavingsSummary monthlySavingsLabel="$5.17" annualSavingsLabel="$62.04" isDemoActive={false} />} />)
    expect(screen.getByRole('heading', { name: 'Cost-Saving Opportunities' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Estimated savings' })).toBeNull()
    expect(screen.queryByText(/Executive ROI/)).toBeNull()
    expect(screen.getByText('View all (2) →').closest('a')!.getAttribute('href')).toBe('/cost-optimization')
    expect(screen.getByTestId('savings-summary').textContent).toContain('$5.17')
    expect(screen.getByTestId('savings-annual').textContent).toContain('$62.04')
  })
})
