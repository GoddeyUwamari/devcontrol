/**
 * Cost trend chart polish (founder screenshot review, 2026-11-21), one test per fix:
 *   1. the five range tabs wrap (beside the title or below it), never clipped or scrolled away;
 *   2. the hover cursor is a faint band behind every day, not recharts' #ccc full-height block;
 *   3. "Latest days still updating" shows only when a lighter segment is painted, and its
 *      swatch is those segments (same fills, same fill-opacity);
 *   4. today-bar review L-1: "no amount" reads the drawn series amounts, not the floored total.
 * The fixtures are the Today bar ones (2026-11-18 15:00 UTC, today = Nov 18).
 * Recharts runs for real: ResponsiveContainer gets a size, the Tooltip opens on
 * a chosen point (`active` + `defaultIndex`), bars are not animated.
 */
import { cloneElement, useEffect } from 'react'
import * as fs from 'fs'
import * as path from 'path'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const open = vi.hoisted(() => ({ index: -1 }))
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  return {
    ...actual,
    ResponsiveContainer: ({ children, onResize }: { children: React.ReactElement<{ width?: number; height?: number }>; onResize?: (w: number, h: number) => void }) => {
      useEffect(() => { onResize?.(600, 300) }, [onResize])
      return cloneElement(children, { width: 600, height: 300 })
    },
    Tooltip: (props: React.ComponentProps<typeof actual.Tooltip>) =>
      open.index >= 0 ? <actual.Tooltip {...props} active defaultIndex={open.index} /> : <actual.Tooltip {...props} />,
    Bar: (props: React.ComponentProps<typeof actual.Bar>) => <actual.Bar {...props} isAnimationActive={false} />,
  }
})

import { CostTrendChart, UPDATING_BAR_OPACITY } from '../cost-trend-chart'

type Point = Record<string, unknown> & { date: string }
const fixture = (name: string): Point[] => JSON.parse(fs.readFileSync(
  path.resolve(__dirname, `../../../backend/src/controllers/__tests__/__fixtures__/today-bar/trend-7d-${name}.json`), 'utf8',
)).data

const NOW = new Date('2026-11-18T15:00:00.000Z')
const TODAY_INDEX = 6
const show = (data: unknown[], index = -1) => {
  open.index = index
  return render(<CostTrendChart data={data as never} dateRange="7d" onDateRangeChange={() => {}} now={NOW} />)
}
/** Painted bar segments drawn lighter, as [fill, fill-opacity]. */
const lighterSegments = (container: HTMLElement) => [...container.querySelectorAll('.recharts-bar-rectangle')]
  .map((g) => g.querySelector('rect, path'))
  .filter((el): el is Element => !!el && el.getAttribute('fill') !== 'none' && el.getAttribute('fill-opacity') === String(UPDATING_BAR_OPACITY))
  .map((el) => [el.getAttribute('fill'), el.getAttribute('fill-opacity')])
const swatchBands = () => [...screen.getByTestId('cost-trend-updating-swatch').querySelectorAll('rect')]
  .map((r) => [r.getAttribute('fill'), r.getAttribute('fill-opacity')])
const unique = (pairs: (string | null)[][]) => [...new Map(pairs.map((p) => [p.join('|'), p])).values()]

describe('cost trend chart polish', () => {
  it('1: all five range tabs in a wrapping group; nothing between them and the card header clips or scrolls', async () => {
    show(fixture('partial'))
    const tabs = await screen.findByTestId('cost-trend-range-tabs')
    expect([...tabs.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['7 Days', '30 Days', '90 Days', '6 Months', '1 Year'])
    expect(tabs.className).toMatch(/\bflex-wrap\b/)
    // The controls row and the title row wrap too, so the tabs move below the title instead of shrinking away.
    expect(tabs.parentElement!.className).toMatch(/\bflex-wrap\b/)
    expect(tabs.parentElement!.parentElement!.className).toMatch(/\bflex-wrap\b/)
    for (let el: HTMLElement | null = tabs; el && el.dataset.slot !== 'card-header'; el = el.parentElement) {
      expect(el.className).not.toMatch(/overflow-(x-|y-)?(auto|hidden|scroll|clip)/)
      expect(el.getAttribute('style') ?? '').not.toMatch(/scrollbar|overflow/)
    }
  })

  it('2: the hover cursor behind Today is the faint band every day gets, not a #ccc block', async () => {
    const { container } = show(fixture('partial'), TODAY_INDEX)
    await screen.findByTestId('cost-trend-today-tooltip')
    const cursor = await waitFor(() => {
      const el = container.querySelector('.recharts-tooltip-cursor')
      expect(el).not.toBeNull()
      return el!
    })
    expect(cursor.getAttribute('fill')).toBe('var(--app-chart-placeholder-fill)')
    expect(container.innerHTML).not.toMatch(/#ccc/i)
  })

  it('3: "Latest days still updating" only with a painted lighter segment; its swatch is those segments', async () => {
    // zero: today updating at $0.00 paints nothing lighter, so no entry.
    const zero = show(fixture('zero'))
    await screen.findByText('Today')
    expect(lighterSegments(zero.container)).toEqual([])
    expect(screen.queryByTestId('cost-trend-updating-legend')).toBeNull()
    zero.unmount()

    // partial (today the only lighter day) and stopped3 (Nov 14, an earlier day): the swatch's
    // bands are the lighter segments' own fills and fill-opacity, bottom (EC2) to top.
    for (const name of ['partial', 'stopped3']) {
      const view = show(fixture(name))
      expect(await screen.findByTestId('cost-trend-updating-legend')).toHaveTextContent('Latest days still updating')
      const painted = unique(lighterSegments(view.container))
      expect(painted).toEqual([['#2a78d6', '0.45'], ['#1baf7a', '0.45'], ['#eb6834', '0.45']])
      expect(swatchBands()).toEqual(painted)
      const ys = [...screen.getByTestId('cost-trend-updating-swatch').querySelectorAll('rect')].map((r) => Number(r.getAttribute('y')))
      expect(ys).toEqual([...ys].sort((a, b) => b - a)) // first series lowest, as stacked
      view.unmount()
    }
  })

  it('4 (L-1): a day whose floored total is 0 but whose drawn EC2 segment is $0.004 has an amount', async () => {
    // Credit netting: the compute category floors at 0, the EC2 service bar keeps its $0.004.
    const data = fixture('quiet').map((p) => (p.date === '2026-11-16'
      ? { ...p, total: 0, compute: 0, lineItems: 2, byServiceDisplay: [{ service: 'EC2', amount: 0.004, color: '#2a78d6' }] }
      : p))
    const { container } = show(data)
    await screen.findByText('Today')
    // The series legend (and its toggle) is there, the y axis has a dollar scale, and the
    // "no charges" line does not sit under a drawn bar.
    const legend = screen.getByTestId('cost-trend-series-legend')
    expect([...legend.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['EC2'])
    await waitFor(() => expect(
      [...container.querySelectorAll('.recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value')].map((t) => t.textContent).filter((t) => t !== '').length,
    ).toBeGreaterThan(1))
    expect(screen.queryByTestId('cost-trend-no-charges')).toBeNull()
  })
})
