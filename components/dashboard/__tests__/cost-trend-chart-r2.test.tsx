/**
 * Trend-lag round 2 on the Dashboard cost trend chart, from the backend's real
 * output for production's data one day later
 * (backend/src/controllers/__tests__/__fixtures__/trend-lag/trend-7d-2026-11-17.new.json,
 * pinned by trend-lag-real-evidence.test.ts; today = 2026-11-17 UTC):
 *   - the 7-day view is exactly 7 bars, the full UTC days ending yesterday
 *     (Nov 10-16), every label shown as a date ("Nov 10"), today (Nov 17) not drawn;
 *   - Nov 13 (the last day with line items, still updating) is drawn lighter, not final;
 *   - Nov 14-16 (not reported) are a light hatched placeholder from the
 *     --app-chart-placeholder-* tokens, with the "Not reported yet by AWS Cost
 *     Explorer" tooltip and no amount.
 * Recharts runs for real: ResponsiveContainer gets a size, the Tooltip opens on
 * a chosen point (`active` + `defaultIndex`), bars are not animated.
 */
import { cloneElement, useEffect } from 'react'
import * as fs from 'fs'
import * as path from 'path'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const open = vi.hoisted(() => ({ index: -1 }))
const size = vi.hoisted(() => ({ width: 600 }))
/** Every `interval` the chart hands its X axis (trend-lag r2 review L-1). */
const axis = vi.hoisted(() => ({ intervals: [] as unknown[] }))
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  return {
    ...actual,
    // A sized chart that reports its width, as the real container does once measured.
    ResponsiveContainer: ({ children, onResize }: { children: React.ReactElement<{ width?: number; height?: number }>; onResize?: (w: number, h: number) => void }) => {
      useEffect(() => { onResize?.(size.width, 300) }, [onResize])
      return cloneElement(children, { width: size.width, height: 300 })
    },
    Tooltip: (props: React.ComponentProps<typeof actual.Tooltip>) =>
      open.index >= 0 ? <actual.Tooltip {...props} active defaultIndex={open.index} /> : <actual.Tooltip {...props} />,
    Bar: (props: React.ComponentProps<typeof actual.Bar>) => <actual.Bar {...props} isAnimationActive={false} />,
    XAxis: (props: React.ComponentProps<typeof actual.XAxis>) => {
      axis.intervals.push(props.interval)
      return <actual.XAxis {...props} />
    },
  }
})

import { CostTrendChart, UPDATING_BAR_OPACITY } from '../cost-trend-chart'
import { sevenDayPoints, sevenFullUtcDays, trendDateLabel, xAxisInterval } from '../cost-trend-window'

const NOV17_BODY = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '../../../backend/src/controllers/__tests__/__fixtures__/trend-lag/trend-7d-2026-11-17.new.json'), 'utf8',
))
const NOV17 = NOV17_BODY.data as Array<{ date: string; reportState: string; total: number }>
const NOW = new Date('2026-11-17T03:00:00.000Z')
const DAYS = ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16']

const show = (index = -1, range: '7d' | '30d' | '90d' | '6mo' | '1yr' = '7d', data: unknown[] = NOV17) => {
  open.index = index
  return render(<CostTrendChart data={data as never} dateRange={range} onDateRangeChange={() => {}} now={NOW} />)
}
const tickLabels = (container: HTMLElement) =>
  [...container.querySelectorAll('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value')].map((t) => t.textContent)

describe('the fixture is the backend at Nov 17 for production\'s data', () => {
  it('Nov 10-12 final, Nov 13 updating, Nov 14-17 not reported', () => {
    expect(NOV17.map((p) => [p.date, p.reportState])).toEqual([
      ['2026-11-10', 'final'], ['2026-11-11', 'final'], ['2026-11-12', 'final'], ['2026-11-13', 'updating'],
      ['2026-11-14', 'not_reported'], ['2026-11-15', 'not_reported'], ['2026-11-16', 'not_reported'], ['2026-11-17', 'not_reported'],
    ])
  })
})

describe('7-day view: exactly the 7 full UTC days ending yesterday', () => {
  it('7 bars Nov 10-16, every label shown as a date, today (Nov 17) not drawn', async () => {
    const { container } = show()
    await screen.findByText('Nov 10')
    expect(tickLabels(container)).toEqual(['Nov 10', 'Nov 11', 'Nov 12', 'Nov 13', 'Nov 14', 'Nov 15', 'Nov 16'])
    expect(container.textContent).not.toMatch(/Nov 17|\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/)
  })

  it('the window helper: today-7 .. today-1 in UTC, also across a month boundary and at 23:59 / 00:00 UTC', () => {
    expect(sevenFullUtcDays(NOW)).toEqual(DAYS)
    expect(sevenFullUtcDays(new Date('2026-11-17T23:59:59.999Z'))).toEqual(DAYS)
    expect(sevenFullUtcDays(new Date('2026-11-18T00:00:00.000Z'))[6]).toBe('2026-11-17')
    expect(sevenFullUtcDays(new Date('2026-12-02T12:00:00.000Z'))).toEqual(['2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29', '2026-11-30', '2026-12-01'])
    expect(sevenDayPoints(NOV17, NOW).map((p) => p.date)).toEqual(DAYS)
  })

  it('7 days never skips a label (interval 0); 30/90 days and months may (preserveEnd)', () => {
    // jsdom cannot measure text, so recharts never skips there: the choice itself is pinned here.
    expect(xAxisInterval('7d')).toBe(0)
    expect((['30d', '90d', '6mo', '1yr'] as const).map(xAxisInterval)).toEqual(['preserveEnd', 'preserveEnd', 'preserveEnd', 'preserveEnd'])
  })

  it('labels are read from the date itself (no time-zone shift): "Nov 10", months "Nov 2026"', () => {
    expect(trendDateLabel('2026-11-10', false)).toBe('Nov 10')
    expect(trendDateLabel('2026-12-01', false)).toBe('Dec 1')
    expect(trendDateLabel('2026-11-01', true)).toBe('Nov 2026')
  })
})

describe('7 days on a phone: two-line dates instead of overlapping or skipped labels', () => {
  it('a 310 px chart (390 px phone): every date shown as "Nov" over "10"; a 600 px chart: one line', async () => {
    size.width = 310
    const { container, unmount } = show()
    await screen.findByText('10')
    const ticks = [...container.querySelectorAll('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value')]
    expect(ticks.map((t) => [...t.querySelectorAll('tspan')].map((x) => x.textContent))).toEqual(DAYS.map((d) => ['Nov', String(Number(d.slice(8)))]))
    unmount()
    size.width = 600
    const wide = show()
    await screen.findByText('Nov 10')
    expect(tickLabels(wide.container)).toEqual(DAYS.map((d) => trendDateLabel(d, false)))
  })
})

describe('Nov 13 (last day with line items, today-4): still updating, not final', () => {
  it('tooltip "Still updating · $0.06 so far. …" under the label "Nov 13"', async () => {
    show(DAYS.indexOf('2026-11-13'))
    const tip = await screen.findByText('Still updating · $0.06 so far. AWS Cost Explorer may still add charges.')
    expect(tip.parentElement!.textContent).toBe('Nov 13Still updating · $0.06 so far. AWS Cost Explorer may still add charges.')
  })

  it('drawn lighter, with the "Latest days still updating" legend entry', async () => {
    const { container } = show()
    expect(await screen.findByTestId('cost-trend-updating-legend')).toHaveTextContent('Latest days still updating')
    const lighter = [...container.querySelectorAll('.recharts-bar-rectangle')]
      .map((g) => g.querySelector('rect, path'))
      .filter((el) => el && el.getAttribute('fill') !== 'none' && el.getAttribute('fill-opacity') === String(UPDATING_BAR_OPACITY))
    expect(lighter.length).toBeGreaterThan(0)
  })
})

describe('Nov 14-16 (not reported): a light hatched placeholder', () => {
  it('three placeholders, one per not-reported day, filled with the token hatch', async () => {
    const { container } = show()
    await screen.findByText('Nov 10')
    const placeholders = screen.getAllByTestId('cost-trend-not-reported-placeholder')
    expect(placeholders).toHaveLength(3)
    const fill = placeholders[0].getAttribute('fill')!
    expect(fill).toMatch(/^url\(#cost-trend-hatch-[A-Za-z0-9_-]+\)$/)
    expect(placeholders.every((p) => p.getAttribute('fill') === fill && Number(p.getAttribute('height')) > 0)).toBe(true)
    // The pattern draws with the theme tokens (light + dark in globals.css), not fixed colours.
    const pattern = container.querySelector(`pattern${fill.slice(4, -1)}`)!
    expect(pattern.innerHTML).toContain('var(--app-chart-placeholder-fill)')
    expect(pattern.innerHTML).toContain('var(--app-chart-placeholder-hatch)')
  })

  it('the placeholders sit over Nov 14, 15 and 16, right of every drawn bar', async () => {
    const { container } = show()
    await screen.findByText('Nov 10')
    const ticks = [...container.querySelectorAll('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value')]
    const tickX = Object.fromEntries(ticks.map((t) => [t.textContent, Number(t.getAttribute('x'))]))
    const centres = screen.getAllByTestId('cost-trend-not-reported-placeholder')
      .map((p) => Number(p.getAttribute('x')) + Number(p.getAttribute('width')) / 2)
    expect(centres.map((c) => Math.round(c))).toEqual(['Nov 14', 'Nov 15', 'Nov 16'].map((d) => Math.round(tickX[d])))
  })

  it.each(['2026-11-14', '2026-11-15', '2026-11-16'])('%s tooltip: "Not reported yet by AWS Cost Explorer", no amount', async (date) => {
    show(DAYS.indexOf(date))
    const tip = await screen.findByText('Not reported yet by AWS Cost Explorer')
    expect(tip.parentElement!.textContent).toBe(`${trendDateLabel(date, false)}Not reported yet by AWS Cost Explorer`)
  })

  it('legend "Not reported yet" and the hatched note', async () => {
    show()
    expect(await screen.findByTestId('cost-trend-not-reported-legend')).toHaveTextContent('Not reported yet')
    expect(screen.getByTestId('cost-trend-not-reported')).toHaveTextContent("Hatched days: AWS Cost Explorer hasn't reported them yet, so they have no amount (not $0)")
  })

  it('no placeholder and no legend entry when every day is reported', async () => {
    show(-1, '7d', NOV17.map((p) => ({ ...p, reportState: 'final', lineItems: 8 })))
    await screen.findByText('Nov 10')
    expect(screen.queryByTestId('cost-trend-not-reported-placeholder')).toBeNull()
    expect(screen.queryByTestId('cost-trend-not-reported-legend')).toBeNull()
  })
})

describe('30/90 days and months: dates, labels may skip', () => {
  const daily = (n: number) => Array.from({ length: n }, (_, i) => {
    const date = new Date(Date.UTC(2026, 9, 19 + i)).toISOString().slice(0, 10)
    return { date, compute: 1, storage: 0, database: 0, network: 0, other: 0, total: 1, lineItems: 1, reportState: date === '2026-11-17' ? 'not_reported' : 'final' }
  })

  it('30 days: every shown label is a date ("Nov 10"), and the not-reported day is hatched', async () => {
    const { container } = show(-1, '30d', daily(30))
    await screen.findAllByTestId('cost-trend-not-reported-placeholder')
    const labels = tickLabels(container)
    expect(labels.length).toBeGreaterThan(1)
    expect(labels.every((l) => /^[A-Z][a-z]{2} \d{1,2}$/.test(l ?? ''))).toBe(true)
  })

  it('6 months: month labels, and a not-reported month is hatched too', async () => {
    const months = ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01'].map((date, i) => ({
      date, compute: 10, storage: 0, database: 0, network: 0, other: 0, total: 10, lineItems: i < 5 ? 5 : 0, reportState: i < 5 ? 'final' : 'not_reported',
    }))
    const { container } = show(-1, '6mo', months)
    expect(await screen.findAllByTestId('cost-trend-not-reported-placeholder')).toHaveLength(1)
    expect(tickLabels(container)).toContain('Jun 2026')
  })
})

// Trend-lag round 2 review L-1: jsdom never skips labels, so the label tests
// above pass whatever interval the chart asks for. This pins that the chart
// hands its X axis exactly the never-skip helper's interval for every range
// (a chart that passed interval="preserveEnd" directly fails the 7d case).
describe('L-1: the X axis gets xAxisInterval(range)', () => {
  it.each(['7d', '30d', '90d', '6mo', '1yr'] as const)('%s', async (range) => {
    axis.intervals.length = 0
    show(-1, range)
    await vi.waitFor(() => expect(axis.intervals.length).toBeGreaterThan(0))
    expect(new Set(axis.intervals)).toEqual(new Set([xAxisInterval(range)]))
  })

  it('the helper never skips a 7-day label', () => {
    expect(xAxisInterval('7d')).toBe(0)
  })
})
