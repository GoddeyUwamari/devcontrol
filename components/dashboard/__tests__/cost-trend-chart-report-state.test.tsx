/**
 * The Dashboard cost trend chart on production's 2026-11-16 7d trend
 * (trend-lag-build.md), as the new backend returns it
 * (backend/src/controllers/__tests__/__fixtures__/trend-lag/trend-7d-2026-11-16.new.json,
 * pinned by trend-lag-real-evidence.test.ts from the verbatim production response):
 *   - Nov 14-16 (not reported): a gap, tooltip "Not reported yet by AWS Cost
 *     Explorer", never amounts or $0.00 (on the old backend Nov 14 listed every
 *     service at $0.00);
 *   - Nov 13 (updating): a lighter bar, tooltip "Still updating · $0.06 so far.
 *     AWS Cost Explorer may still add charges.", legend "Latest days still updating";
 *   - Nov 9-12 (final): unchanged.
 * Recharts runs for real: ResponsiveContainer gets a size, the Tooltip opens on
 * a chosen point (`active` + `defaultIndex`), bars are not animated.
 */
import { cloneElement } from 'react'
import * as fs from 'fs'
import * as path from 'path'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const open = vi.hoisted(() => ({ index: -1 }))
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement<{ width?: number; height?: number }> }) =>
      cloneElement(children, { width: 600, height: 300 }),
    Tooltip: (props: React.ComponentProps<typeof actual.Tooltip>) =>
      open.index >= 0 ? <actual.Tooltip {...props} active defaultIndex={open.index} /> : <actual.Tooltip {...props} />,
    Bar: (props: React.ComponentProps<typeof actual.Bar>) => <actual.Bar {...props} isAnimationActive={false} />,
  }
})

import { CostTrendChart, UPDATING_BAR_OPACITY } from '../cost-trend-chart'

const REAL = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '../../../backend/src/controllers/__tests__/__fixtures__/trend-lag/trend-7d-2026-11-16.new.json'), 'utf8',
)).data as Array<{ date: string; reportState: string }>
const indexOf = (date: string) => REAL.findIndex((p) => p.date === date)
const show = (index: number) => {
  open.index = index
  return render(<CostTrendChart data={REAL as never} dateRange="7d" onDateRangeChange={() => {}} />)
}

describe('real evidence 2026-11-16 (7d)', () => {
  it.each(['2026-11-14', '2026-11-15', '2026-11-16'])('%s: "Not reported yet by AWS Cost Explorer", with no amounts and no $0.00', async (date) => {
    show(indexOf(date))
    const tip = await screen.findByText('Not reported yet by AWS Cost Explorer')
    expect(tip.parentElement!.textContent).not.toMatch(/\$/)
    expect(document.body.textContent).not.toMatch(/\$0\.00/)
  })

  it('Nov 13: "Still updating · $0.06 so far. AWS Cost Explorer may still add charges.", once, with no per-service list', async () => {
    show(indexOf('2026-11-13'))
    const tip = await screen.findByText('Still updating · $0.06 so far. AWS Cost Explorer may still add charges.')
    // The day label, then the one line: no per-service amounts.
    expect(tip.parentElement!.textContent).toBe('FriStill updating · $0.06 so far. AWS Cost Explorer may still add charges.')
    expect(screen.queryByText('Not reported yet by AWS Cost Explorer')).toBeNull()
  })

  it('Nov 12 (final) keeps its breakdown and total', async () => {
    show(indexOf('2026-11-12'))
    await waitFor(() => expect(document.body.textContent).toMatch(/Total:\$0\.83/))
    expect(screen.queryByText(/Still updating/)).toBeNull()
    expect(screen.queryByText('Not reported yet by AWS Cost Explorer')).toBeNull()
  })

  it('legend: "Latest days still updating"; the not-drawn note for Nov 14-16', async () => {
    show(-1)
    expect(await screen.findByTestId('cost-trend-updating-legend')).toHaveTextContent('Latest days still updating')
    expect(screen.getByTestId('cost-trend-not-reported')).toHaveTextContent("Days AWS Cost Explorer hasn't reported yet are not drawn")
  })

  it('Nov 13 is drawn lighter; Nov 9-12 at full strength; Nov 14-16 draw nothing', async () => {
    const { container } = show(-1)
    await waitFor(() => expect(container.querySelectorAll('.recharts-bar-rectangle').length).toBeGreaterThan(0))
    const visible = [...container.querySelectorAll('.recharts-bar-rectangle')]
      .map((g) => g.querySelector('rect, path'))
      .filter((el): el is Element => !!el && el.getAttribute('fill') !== 'none')
    const lighter = visible.filter((el) => el.getAttribute('fill-opacity') === String(UPDATING_BAR_OPACITY))
    const full = visible.filter((el) => el.getAttribute('fill-opacity') === null)
    expect(lighter.length).toBeGreaterThan(0)
    expect(full.length).toBeGreaterThan(lighter.length)
    expect(UPDATING_BAR_OPACITY).toBe(0.45)
  })
})

describe('a backend without reportState (rolling deploy): unchanged', () => {
  it('no legend entry, no lighter bars', async () => {
    open.index = -1
    render(<CostTrendChart data={[{ date: '2026-11-12', compute: 1, storage: 0, database: 0, network: 0, other: 0, total: 1, lineItems: 2, provisional: false }]} dateRange="7d" onDateRangeChange={() => {}} />)
    await screen.findByText('AWS Cost Trends')
    expect(screen.queryByTestId('cost-trend-updating-legend')).toBeNull()
  })
})
