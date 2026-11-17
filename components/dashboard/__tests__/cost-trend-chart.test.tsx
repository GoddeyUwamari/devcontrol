/**
 * Covers the Dashboard's "AWS Cost Trends defaults to 7 Days" fix.
 * CostTrendChart itself is a fully controlled component (dateRange/onDateRangeChange
 * come from the parent's state) -- this proves the range tabs correctly reflect
 * whichever range is passed in, and that 30/90 Days remain clickable and wire back
 * to the parent via onDateRangeChange, regardless of which tab starts active.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CostTrendChart } from '../cost-trend-chart'

const sampleData = [
  { date: '2026-08-01', compute: 10, storage: 5, database: 2, network: 1, other: 1, total: 19 },
  { date: '2026-08-02', compute: 12, storage: 5, database: 2, network: 1, other: 1, total: 21 },
]

describe('CostTrendChart -- date range tabs', () => {
  it('marks "7 Days" as the active tab when dateRange="7d" (the dashboard\'s new default)', () => {
    render(
      <CostTrendChart data={sampleData} dateRange="7d" onDateRangeChange={() => {}} />
    )

    const sevenDays = screen.getByRole('button', { name: '7 Days' })
    const thirtyDays = screen.getByRole('button', { name: '30 Days' })
    const ninetyDays = screen.getByRole('button', { name: '90 Days' })

    expect(sevenDays.className).toMatch(/shadow-sm/)
    expect(thirtyDays.className).not.toMatch(/shadow-sm/)
    expect(ninetyDays.className).not.toMatch(/shadow-sm/)
  })

  it('30 Days and 90 Days remain clickable and report the selection back to the parent', () => {
    const onDateRangeChange = vi.fn()
    render(
      <CostTrendChart data={sampleData} dateRange="7d" onDateRangeChange={onDateRangeChange} />
    )

    fireEvent.click(screen.getByRole('button', { name: '30 Days' }))
    expect(onDateRangeChange).toHaveBeenCalledWith('30d')

    fireEvent.click(screen.getByRole('button', { name: '90 Days' }))
    expect(onDateRangeChange).toHaveBeenCalledWith('90d')
  })
})

describe('CostTrendChart -- basis', () => {
  it('says its totals are after credits and refunds, floored at $0 (never "excluded")', () => {
    render(<CostTrendChart data={sampleData} dateRange="7d" onDateRangeChange={() => {}} />)
    expect(screen.getByText(/^Daily cost breakdown .* · After credits and refunds; amounts below \$0 count as \$0$/)).toBeInTheDocument()
    expect(screen.queryByText(/excluded/i)).toBeNull()
  })

  it.each(['6mo', '1yr'] as const)('%s: monthly Cost Explorer buckets are called monthly, not daily', (range) => {
    render(<CostTrendChart data={sampleData} dateRange={range} onDateRangeChange={() => {}} />)
    expect(screen.getByText(/^Monthly cost breakdown by service( category)? · After credits and refunds; amounts below \$0 count as \$0$/)).toBeInTheDocument()
    expect(screen.queryByText(/Daily cost breakdown/)).toBeNull()
  })
})

describe('periods AWS Cost Explorer has not reported yet (DAY1-D14)', () => {
  const point = (date: string, total: number, lineItems: number, provisional: boolean) =>
    ({ date, compute: total, storage: 0, database: 0, network: 0, other: 0, total, lineItems, provisional })

  // The 7-day view draws the 7 full UTC days ending yesterday: Nov 25 .. Dec 1 at this clock.
  const DEC2 = new Date('2026-12-02T12:00:00Z')

  it('daily: says unreported days are hatched, with no amount (round 2: drawn as a placeholder, never $0)', () => {
    render(<CostTrendChart data={[point('2026-11-30', 13.3, 2, true), point('2026-12-01', 0, 0, true)]} dateRange="7d" onDateRangeChange={() => {}} now={DEC2} />)
    expect(screen.getByTestId('cost-trend-not-reported')).toHaveTextContent("Hatched days: AWS Cost Explorer hasn't reported them yet, so they have no amount (not $0)")
    expect(screen.getByTestId('cost-trend-not-reported-legend')).toHaveTextContent('Not reported yet')
  })

  it('monthly on Dec 1: "December: no billed days yet"', () => {
    render(<CostTrendChart data={[point('2026-11-01', 399, 2, true), point('2026-12-01', 0, 0, true)]} dateRange="6mo" onDateRangeChange={() => {}} />)
    expect(screen.getByTestId('cost-trend-not-reported')).toHaveTextContent('December: no billed days yet')
  })

  it('unreported days are not $0 days for the spike check', () => {
    // Reported days $40, $40, $70 average $50: $70 is no spike. Counting two
    // unreported days as $0 would make the average $30 and flag $70 as one.
    const data = [point('2026-11-27', 40, 2, false), point('2026-11-28', 40, 2, false), point('2026-11-29', 70, 2, false), point('2026-11-30', 0, 0, true), point('2026-12-01', 0, 0, true)]
    render(<CostTrendChart data={data} dateRange="7d" onDateRangeChange={() => {}} now={DEC2} />)
    expect(screen.getByTestId('cost-trend-not-reported')).toBeInTheDocument()
    expect(screen.queryByText(/unexpected AWS bill increase/)).toBeNull()
  })

  it('points without the flags: no note', () => {
    render(<CostTrendChart data={[{ date: '2026-12-01', compute: 0, storage: 0, database: 0, network: 0, other: 0, total: 0 }]} dateRange="7d" onDateRangeChange={() => {}} now={DEC2} />)
    expect(screen.queryByTestId('cost-trend-not-reported')).toBeNull()
  })
})
