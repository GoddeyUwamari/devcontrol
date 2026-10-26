import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it, expect } from 'vitest'
import { CHART_TICK } from '../chart-theme'

describe('chart text (D4)', () => {
  it('CHART_TICK is the label size (12 px) in ink-muted (slate-600)', () => {
    expect(CHART_TICK).toEqual({ fontSize: 12, fill: '#475569' })
  })

  it("the Dashboard's cost chart takes its axis ticks and Forecast labels from CHART_TICK, with no sizes of its own", () => {
    const source = readFileSync(join(process.cwd(), 'components/dashboard/cost-trend-chart.tsx'), 'utf8')
    expect(source.match(/tick=\{CHART_TICK\}/g)).toHaveLength(4)
    expect(source.match(/label=\{\{ value: 'Forecast', position: 'top', \.\.\.CHART_TICK \}\}/g)).toHaveLength(2)
    expect(source).not.toMatch(/fontSize/)
  })
})
