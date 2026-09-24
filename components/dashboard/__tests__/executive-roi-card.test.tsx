/**
 * Executive ROI Summary card heading (terminology: "Executive ROI" ->
 * "Executive ROI Summary"). Display copy only -- props, the details link, and
 * the savings figures are unchanged.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ExecutiveRoiCard } from '../executive-roi-card'

describe('ExecutiveRoiCard heading', () => {
  it('renders "Executive ROI Summary" as the card heading', () => {
    render(<ExecutiveRoiCard monthlySavingsLabel={null} annualSavingsLabel={null} isDemoActive={false} />)
    expect(screen.getByRole('heading', { name: 'Executive ROI Summary' })).toBeInTheDocument()
    expect(screen.getByText('View report →').closest('a')!.getAttribute('href')).toBe('/costs')
  })
})
