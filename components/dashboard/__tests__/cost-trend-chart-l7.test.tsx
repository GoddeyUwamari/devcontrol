/**
 * Review L-7: the Dashboard cost trend chart never draws a period AWS Cost
 * Explorer has not reported yet at $0. Data without a per-service breakdown
 * (an older cached response, or a range with no breakdown at all) used to fall
 * back to an AreaChart whose line went down to 0 at that point; it is now the
 * same stacked bars as the per-service view, where the point is a gap.
 * jsdom gives ResponsiveContainer no size, so it is given one here, bars are
 * drawn without animation, and the real Recharts SVG is inspected. Synthetic
 * data only.
 */
import { cloneElement } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement<{ width?: number; height?: number }> }) =>
      cloneElement(children, { width: 600, height: 300 }),
    // The bar animation never advances in jsdom (every bar would stay at height 0).
    Bar: (props: React.ComponentProps<typeof actual.Bar>) => <actual.Bar {...props} isAnimationActive={false} />,
  }
})

import { CostTrendChart } from '../cost-trend-chart'

// The 7-day view draws the 7 UTC days ending today: Nov 26 .. Dec 2 at this clock (today-bar T1).
const DEC2 = new Date('2026-12-02T12:00:00Z')

const point = (date: string, compute: number, lineItems: number, provisional: boolean) =>
  ({ date, compute, storage: 0, database: 0, network: 0, other: 0, total: compute, lineItems, provisional })

/** A bar segment that paints something: a path, or a rect with a size and a fill. */
function painted(el: Element | null): boolean {
  if (!el) return false
  if (el.tagName.toLowerCase() === 'path') return (el.getAttribute('d') ?? '').trim() !== ''
  return Number(el.getAttribute('height')) > 0 && Number(el.getAttribute('width')) > 0 && el.getAttribute('fill') !== 'none'
}

/** For each Bar series, whether the segment at each data index paints anything. */
function paintedByIndex(container: HTMLElement): boolean[][] {
  return Array.from(container.querySelectorAll('.recharts-bar')).map((bar) =>
    Array.from(bar.querySelectorAll('.recharts-bar-rectangle')).map((g) => Array.from(g.children).some(painted))
  )
}

describe('cost trend chart: no $0 for an unreported period without a service breakdown (L-7)', () => {
  it.each(['7d', '6mo'] as const)('%s: category data draws stacked bars, and the unreported point paints nothing', (range) => {
    const { container } = render(
      <CostTrendChart data={[point('2026-11-30', 13.3, 2, true), point('2026-12-01', 0, 0, true)]} dateRange={range} onDateRangeChange={() => {}} now={DEC2} />
    )
    expect(container.querySelector('.recharts-area')).toBeNull()
    expect(container.querySelector('.recharts-area-curve')).toBeNull()

    const bars = paintedByIndex(container)
    expect(bars).toHaveLength(5) // compute, storage, database, network, other
    // The reported point is drawn (its compute segment)...
    expect(bars.some((series) => series[0] === true)).toBe(true)
    // ...and the unreported point is a gap in every series.
    expect(bars.map((series) => series[1] ?? false)).toEqual([false, false, false, false, false])
  })

  it('category data keeps its five category series in the bars, not only the total', () => {
    const data = [
      { date: '2026-11-29', compute: 5, storage: 3, database: 0, network: 0, other: 0, total: 8, lineItems: 2, provisional: false },
      point('2026-12-01', 0, 0, true),
    ]
    const { container } = render(<CostTrendChart data={data} dateRange="7d" onDateRangeChange={() => {}} now={DEC2} />)
    const bars = paintedByIndex(container)
    expect(bars.map((series) => series[0])).toEqual([true, true, false, false, false])
  })
})
