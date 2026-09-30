/**
 * While demo mode is on, sample data replaces real data app-wide, so its
 * label stays visible: the banner cannot be dismissed, only left by switching
 * back to real data.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DemoBanner } from '../DemoBanner'

let demoMode = false
let salesDemo = false
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => demoMode }))
vi.mock('@/lib/demo/sales-demo-data', () => ({
  useSalesDemo: () => ({ enabled: salesDemo, toggle: vi.fn() }),
}))

beforeEach(() => {
  demoMode = false
  salesDemo = false
})

describe('DemoBanner', () => {
  it.each([
    ['demo mode', true, false, 'Demo Mode active'],
    ['sales demo mode', false, true, 'Sales Demo Mode active'],
  ])('%s: labelled, with no way to dismiss the label', (_label, demo, sales, text) => {
    demoMode = demo
    salesDemo = sales
    render(<DemoBanner />)

    expect(screen.getByTestId('demo-banner')).toBeInTheDocument()
    expect(screen.getByText(text)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /dismiss/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Switch to real data' })).toBeInTheDocument()
    expect(screen.getByTestId('demo-banner').textContent).toMatch(/sample data/i)
  })

  it('renders nothing when demo mode is off', () => {
    const { container } = render(<DemoBanner />)
    expect(container).toBeEmptyDOMElement()
  })
})
