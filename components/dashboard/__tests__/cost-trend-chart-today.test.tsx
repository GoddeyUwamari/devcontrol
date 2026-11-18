/**
 * Today bar (review-logs/day1/today-bar-build.md): the Dashboard's 7-day cost
 * trend ends TODAY. The fixtures are the backend's own 7d responses at
 * 2026-11-18 15:00 UTC (today = Nov 18), pinned by
 * backend/src/controllers/__tests__/today-bar-shared-states.test.ts:
 *   partial    today updating $0.22     -> lighter bar, "Today · $0.22 so far · still updating" (T2)
 *   absent     today not reported       -> hatched, "Today · not reported yet" (T3)
 *   zero       today updating $0.00     -> no visible bar, tooltip reachable by keyboard (TB-D3)
 *   quiet      today final $0           -> never a finished day: "Today · $0.00 so far" (TB-D2)
 *   stopped3   no data Nov 15-18        -> Nov 14 updating, Nov 15-18 hatched
 *   stopped10  no data for 10 days      -> every bar hatched, never a $0 bar (T5)
 * Recharts runs for real: ResponsiveContainer gets a size, the Tooltip opens on
 * a chosen point (`active` + `defaultIndex`), bars are not animated.
 */
import { cloneElement, useEffect } from 'react'
import * as fs from 'fs'
import * as path from 'path'
import { describe, it, expect, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

const open = vi.hoisted(() => ({ index: -1 }))
const size = vi.hoisted(() => ({ width: 600 }))
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  return {
    ...actual,
    ResponsiveContainer: ({ children, onResize }: { children: React.ReactElement<{ width?: number; height?: number }>; onResize?: (w: number, h: number) => void }) => {
      useEffect(() => { onResize?.(size.width, 300) }, [onResize])
      return cloneElement(children, { width: size.width, height: 300 })
    },
    Tooltip: (props: React.ComponentProps<typeof actual.Tooltip>) =>
      open.index >= 0 ? <actual.Tooltip {...props} active defaultIndex={open.index} /> : <actual.Tooltip {...props} />,
    Bar: (props: React.ComponentProps<typeof actual.Bar>) => <actual.Bar {...props} isAnimationActive={false} />,
  }
})

import { CostTrendChart, UPDATING_BAR_OPACITY } from '../cost-trend-chart'

type Point = { date: string; reportState: string; total: number; lineItems: number; compute: number; storage: number; database: number; network: number; other: number }
const fixture = (name: string): Point[] => JSON.parse(fs.readFileSync(
  path.resolve(__dirname, `../../../backend/src/controllers/__tests__/__fixtures__/today-bar/trend-7d-${name}.json`), 'utf8',
)).data

const NOW = new Date('2026-11-18T15:00:00.000Z')
const DRAWN = ['2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18']
const LABELS = ['Nov 12', 'Nov 13', 'Nov 14', 'Nov 15', 'Nov 16', 'Nov 17', 'Today']
const TODAY_INDEX = 6

const show = (data: unknown[], index = -1, range: '7d' | '30d' = '7d') => {
  open.index = index
  return render(<CostTrendChart data={data as never} dateRange={range} onDateRangeChange={() => {}} now={NOW} />)
}
const tickLabels = (container: HTMLElement) =>
  [...container.querySelectorAll('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value')].map((t) => t.textContent)
/** Painted bar segments, with their fill-opacity (null = full strength). */
const painted = (container: HTMLElement) => [...container.querySelectorAll('.recharts-bar-rectangle')]
  .map((g) => g.querySelector('rect, path'))
  .filter((el): el is Element => !!el && el.getAttribute('fill') !== 'none')
const todayTooltip = async () => (await screen.findByTestId('cost-trend-today-tooltip')).textContent

describe('every fixture: the 7 UTC days ending today, the last labelled "Today" (T1)', () => {
  it.each(['partial', 'absent', 'zero', 'quiet', 'stopped3', 'stopped10'])('%s', async (name) => {
    const data = fixture(name)
    expect(data.map((p) => p.date)).toEqual(['2026-11-11', ...DRAWN]) // the backend's today-7 .. today
    const { container } = show(data)
    await screen.findByText('Nov 12')
    expect(tickLabels(container)).toEqual(LABELS)
  })
})

describe('partial: today still updating (T2)', () => {
  it('tooltip "Today · $0.22 so far · still updating", one line, no per-service list', async () => {
    show(fixture('partial'), TODAY_INDEX)
    expect(await todayTooltip()).toBe('Today · $0.22 so far · still updating')
    expect(screen.queryByText(/Total:/)).toBeNull()
  })

  it('today is drawn lighter; Nov 12-17 at full strength; the "Latest days still updating" legend', async () => {
    const { container } = show(fixture('partial'))
    expect(await screen.findByTestId('cost-trend-updating-legend')).toHaveTextContent('Latest days still updating')
    const segments = painted(container)
    const lighter = segments.filter((el) => el.getAttribute('fill-opacity') === String(UPDATING_BAR_OPACITY))
    // Three services: today's three segments are the lighter ones, every other day's are full.
    expect(lighter).toHaveLength(3)
    expect(segments.length - lighter.length).toBe(18)
  })

  it('T4: Nov 17 (final) keeps its breakdown and total', async () => {
    show(fixture('partial'), DRAWN.indexOf('2026-11-17'))
    await waitFor(() => expect(document.body.textContent).toMatch(/Total:\$1\.55/))
    expect(screen.queryByTestId('cost-trend-today-tooltip')).toBeNull()
  })
})

describe('absent: today not reported (T3)', () => {
  it('today is a hatched placeholder, tooltip "Today · not reported yet", no amount', async () => {
    show(fixture('absent'), TODAY_INDEX)
    expect(await todayTooltip()).toBe('Today · not reported yet')
    expect(screen.getAllByTestId('cost-trend-not-reported-placeholder')).toHaveLength(1)
  })

  it('T4: Nov 17, the last day with line items, keeps the round-2 updating tooltip', async () => {
    show(fixture('absent'), DRAWN.indexOf('2026-11-17'))
    const tip = await screen.findByText('Still updating · $1.55 so far. AWS Cost Explorer may still add charges.')
    expect(tip.parentElement!.textContent).toBe('Nov 17Still updating · $1.55 so far. AWS Cost Explorer may still add charges.')
  })
})

describe('zero: today reported at $0.00 so far (TB-D3)', () => {
  it('no placeholder (it is reported) and no painted segment for today; tooltip "Today · $0.00 so far · still updating"', async () => {
    const { container } = show(fixture('zero'), TODAY_INDEX)
    expect(await todayTooltip()).toBe('Today · $0.00 so far · still updating')
    expect(screen.queryByTestId('cost-trend-not-reported-placeholder')).toBeNull()
    expect(painted(container).filter((el) => el.getAttribute('fill-opacity') === String(UPDATING_BAR_OPACITY))).toHaveLength(0)
  })

  it('the zero-height bar is reachable from the keyboard: focus the chart, arrow right to Today', async () => {
    const { container } = show(fixture('zero'))
    await screen.findByText('Nov 12')
    const surface = container.querySelector('.recharts-surface') as SVGElement
    expect(surface.getAttribute('tabindex')).toBe('0')
    act(() => surface.focus())
    for (let i = 0; i < TODAY_INDEX; i++) fireEvent.keyDown(surface, { key: 'ArrowRight' })
    expect(await todayTooltip()).toBe('Today · $0.00 so far · still updating')
  })
})

describe('quiet: the backend calls today final $0 (no charges in 30 days): never a finished day (TB-D2)', () => {
  it('tooltip "Today · $0.00 so far", never the finished-day breakdown', async () => {
    show(fixture('quiet'), TODAY_INDEX)
    expect(await todayTooltip()).toBe('Today · $0.00 so far')
    expect(screen.queryByText(/Total:/)).toBeNull()
  })

  it('an earlier final $0 day keeps the ordinary breakdown (a real $0)', async () => {
    show(fixture('quiet'), DRAWN.indexOf('2026-11-16'))
    await waitFor(() => expect(document.body.textContent).toMatch(/Total:\$0\.00/))
    expect(screen.queryByTestId('cost-trend-today-tooltip')).toBeNull()
  })

  it('today with an amount and a final state (a backend without the today rule) is drawn lighter, with the legend', async () => {
    const data = fixture('quiet').map((p) => (p.date === '2026-11-18' ? { ...p, compute: 4, total: 4, lineItems: 1 } : p))
    const { container } = show(data)
    expect(await screen.findByTestId('cost-trend-updating-legend')).toBeInTheDocument()
    expect(painted(container).map((el) => el.getAttribute('fill-opacity'))).toEqual([String(UPDATING_BAR_OPACITY)])
  })
})

describe('stopped accounts: a day with no Cost Explorer data is a gap, never a $0 bar (T5)', () => {
  it('stopped10: all 7 days hatched, nothing painted, today "Today · not reported yet"', async () => {
    const { container } = show(fixture('stopped10'), TODAY_INDEX)
    expect(await todayTooltip()).toBe('Today · not reported yet')
    expect(screen.getAllByTestId('cost-trend-not-reported-placeholder')).toHaveLength(7)
    expect(painted(container)).toHaveLength(0)
  })

  it('stopped3: Nov 14 updating (lighter), Nov 15-18 hatched, Nov 12-13 final', async () => {
    const { container } = show(fixture('stopped3'), DRAWN.indexOf('2026-11-14'))
    await screen.findByText('Still updating · $1.55 so far. AWS Cost Explorer may still add charges.')
    expect(screen.getAllByTestId('cost-trend-not-reported-placeholder')).toHaveLength(4)
    const segments = painted(container)
    expect(segments.filter((el) => el.getAttribute('fill-opacity') === String(UPDATING_BAR_OPACITY))).toHaveLength(3)
    expect(segments).toHaveLength(9)
  })
})

describe('the 7-day and 30-day views draw the same per-day states (T5)', () => {
  // The chart only reads each point's reportState: given the same points, both views hatch the
  // same days and say the same about today. (That the backend gives both views the same states
  // is today-bar-shared-states.test.ts.) The 30d view draws all 8 points; 7d leaves out today-7.
  it.each(['partial', 'absent', 'stopped3', 'stopped10'])('%s', async (name) => {
    const data = fixture(name)
    const notReported = (points: Point[]) => points.filter((p) => p.reportState === 'not_reported').length

    const seven = show(data, TODAY_INDEX)
    const todaySeven = await todayTooltip()
    expect(screen.queryAllByTestId('cost-trend-not-reported-placeholder')).toHaveLength(notReported(data.slice(1)))
    seven.unmount()

    const thirty = show(data, data.length - 1, '30d')
    expect(await todayTooltip()).toBe(todaySeven)
    expect(screen.queryAllByTestId('cost-trend-not-reported-placeholder')).toHaveLength(notReported(data))
    // The 30-day axis keeps its dates (its layout is unchanged).
    expect(tickLabels(thirty.container)).not.toContain('Today')
  })
})

describe('the spike average leaves today out (never a finished day)', () => {
  it('six $1 days and a final $100 today: no spike banner', async () => {
    const data = DRAWN.map((date) => ({ date, compute: date === '2026-11-18' ? 100 : 1, storage: 0, database: 0, network: 0, other: 0, total: date === '2026-11-18' ? 100 : 1, lineItems: 1, reportState: 'final' }))
    show(data)
    await screen.findByText('Today')
    expect(screen.queryByText(/May cause unexpected AWS bill increase/)).toBeNull()
  })
})

describe('390 px phone: every date kept, "Today" on one line (T6, TB-D4)', () => {
  it('Nov 12-17 as "Nov" over the day, then "Today"', async () => {
    size.width = 310
    const { container } = show(fixture('partial'))
    await screen.findByText('Today')
    const ticks = [...container.querySelectorAll('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value')]
    expect(ticks.map((t) => [...t.querySelectorAll('tspan')].map((x) => x.textContent))).toEqual([
      ['Nov', '12'], ['Nov', '13'], ['Nov', '14'], ['Nov', '15'], ['Nov', '16'], ['Nov', '17'], ['Today'],
    ])
    size.width = 600
  })
})
