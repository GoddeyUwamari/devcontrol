/**
 * The Dashboard cost trend chart's tooltip for a period AWS Cost Explorer has
 * not reported yet: the founder-approved string (2026-11-15) "Not reported yet
 * by AWS Cost Explorer", never a $0 breakdown (DAY1-D14). jsdom gives
 * ResponsiveContainer no size, so it is given one here, and the real Recharts
 * Tooltip is opened on a chosen point with `active` + `defaultIndex`: the
 * custom content receives the chart's own payload for that point.
 * Synthetic data only.
 */
import { cloneElement } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const open = vi.hoisted(() => ({ index: 0 }))
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement<{ width?: number; height?: number }> }) =>
      cloneElement(children, { width: 600, height: 300 }),
    Tooltip: (props: React.ComponentProps<typeof actual.Tooltip>) => <actual.Tooltip {...props} active defaultIndex={open.index} />,
  }
})

import { CostTrendChart } from '../cost-trend-chart'

const point = (date: string, total: number, lineItems: number, provisional: boolean) =>
  ({ date, compute: total, storage: 0, database: 0, network: 0, other: 0, total, lineItems, provisional })

describe('cost trend chart tooltip (approved string)', () => {
  it.each([
    ['7d', [point('2026-11-30', 13.3, 2, true), point('2026-12-01', 0, 0, true)]],
    ['6mo', [point('2026-11-01', 399, 2, true), point('2026-12-01', 0, 0, true)]],
  ] as const)('%s: an unreported point says "Not reported yet by AWS Cost Explorer", with no amounts', async (range, data) => {
    open.index = 1
    // 7d draws the 7 UTC days ending today: Nov 26 .. Dec 2 on Dec 2 (today-bar T1).
    render(<CostTrendChart data={[...data]} dateRange={range} onDateRangeChange={() => {}} now={new Date('2026-12-02T12:00:00Z')} />)
    await waitFor(() => expect(screen.getByText('Not reported yet by AWS Cost Explorer')).toBeInTheDocument())
    expect(screen.getByText('Not reported yet by AWS Cost Explorer').parentElement!.textContent).not.toMatch(/\$/)
  })

  it('a reported point keeps its breakdown, not the unreported string', async () => {
    open.index = 0
    render(<CostTrendChart data={[point('2026-11-30', 13.3, 2, true), point('2026-12-01', 0, 0, true)]} dateRange="7d" onDateRangeChange={() => {}} now={new Date('2026-12-02T12:00:00Z')} />)
    await waitFor(() => expect(document.body.textContent).toMatch(/\$13\.30/))
    expect(screen.queryByText('Not reported yet by AWS Cost Explorer')).toBeNull()
  })
})
