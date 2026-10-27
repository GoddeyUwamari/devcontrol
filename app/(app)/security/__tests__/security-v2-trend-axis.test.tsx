/**
 * Security V2 F2c fix 4: the score chart's top Y label reads "100", not clipped to "00". jsdom measures no
 * layout, so the chart gets a fixed size and the test checks the geometry recharts lays out: the right-anchored
 * "100" label must end far enough from the chart's left edge to hold three digits at CHART_TICK's font size, and
 * sit far enough below the top edge to hold its own line.
 */
import { cloneElement } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { CHART_TICK } from '@/lib/chart-theme'
import { ScoreTrend } from '../overview/ScoreTrend'

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement<{ width?: number; height?: number }> }) =>
      cloneElement(children, { width: 400, height: 160 }),
  }
})

const TREND = {
  note: null,
  caption: 'caption',
  delta: null,
  points: [{ label: 'Oct 21', score: 89 }, { label: 'Oct 22', score: 87 }, { label: 'Oct 23', score: 86 }],
}

describe('score chart Y axis (F2c fix 4)', () => {
  it('the top label is "100" and has room for all three digits', () => {
    const { container } = render(<ScoreTrend trend={TREND as never} />)
    const yTicks = [...container.querySelectorAll('text.recharts-cartesian-axis-tick-value[orientation="left"]')]
    const labels = yTicks.map((t) => t.textContent)
    expect(labels).toContain('100')
    const top = yTicks.find((t) => t.textContent === '100')!
    expect(top.getAttribute('text-anchor')).toBe('end')
    // A digit at 12px is ~0.6em wide; the label's right end must leave at least three of them inside the chart.
    const right = Number(top.getAttribute('x'))
    expect(right).toBeGreaterThanOrEqual(3 * CHART_TICK.fontSize * 0.6)
    // Vertically centred on its tick: half a line above it must still be inside the chart.
    expect(Number(top.getAttribute('y')) - CHART_TICK.fontSize / 2).toBeGreaterThanOrEqual(0)
  })
})
