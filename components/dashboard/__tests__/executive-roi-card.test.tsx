/**
 * Estimated savings card heading and link (CAT-3, CAT-D11: was "Executive ROI
 * Summary" / "View report →" to /costs). Per-state lines are pinned in
 * executive-roi-card.states.test.tsx.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ExecutiveRoiCard } from '../executive-roi-card'

describe('ExecutiveRoiCard heading', () => {
  it('renders "Estimated savings" as the card heading and links to the findings', () => {
    render(<ExecutiveRoiCard monthlySavingsLabel={null} annualSavingsLabel={null} isDemoActive={false} />)
    expect(screen.getByRole('heading', { name: 'Estimated savings' })).toBeInTheDocument()
    expect(screen.queryByText(/Executive ROI/)).toBeNull()
    expect(screen.getByText('View findings →').closest('a')!.getAttribute('href')).toBe('/cost-optimization')
  })
})
