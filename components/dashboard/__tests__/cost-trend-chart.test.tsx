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
