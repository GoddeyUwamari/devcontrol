import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it, expect } from 'vitest'
import { CHART_TICK, CHART_TOOLTIP } from '../chart-theme'

describe('chart text (D4)', () => {
  it('CHART_TICK is the label size (12 px) in ink-muted (slate-600)', () => {
    expect(CHART_TICK).toEqual({ fontSize: 12, fill: '#475569' })
  })

  it('CHART_TOOLTIP keeps the existing box and puts its text on the meta role (13/18), heading in ink at 600', () => {
    expect(CHART_TOOLTIP.contentStyle).toMatchObject({ fontSize: 13, lineHeight: '18px', border: '1px solid #E2E8F0', padding: '10px 14px' })
    expect(CHART_TOOLTIP.labelStyle).toEqual({ fontWeight: 600, color: '#0F172A', marginBottom: '4px' })
  })

  it("the Dashboard's cost chart takes its axis ticks and Forecast labels from CHART_TICK, with no sizes of its own", () => {
    const source = readFileSync(join(process.cwd(), 'components/dashboard/cost-trend-chart.tsx'), 'utf8')
    // One bar chart since L-7 removed the area-chart fallback: one XAxis, one YAxis,
    // one Forecast line. Each axis element is checked on its own, so an axis that
    // loses CHART_TICK or gets a tick object / size of its own fails here.
    // Trend-lag round 2: the XAxis draws its dates with DateTick (two lines on a
    // phone), which must spread CHART_TICK and set no text style of its own.
    const axes = source.match(/<(XAxis|YAxis)\b[^>]*?\/>/g) ?? []
    expect(axes.map((a) => a.match(/^<(\w+)/)![1])).toEqual(['XAxis', 'YAxis'])
    expect(axes[0]).toMatch(/\btick=\{DateTick\}/)
    expect(axes[1]).toMatch(/\btick=\{CHART_TICK\}/)
    for (const axis of axes) {
      expect(axis).not.toMatch(/tick=\{\{|fontSize/)
    }
    expect(source.match(/tick=\{CHART_TICK\}/g)).toHaveLength(1)
    const dateTickText = source.match(/const DateTick = [\s\S]*?<text\b[^>]*>/)?.[0].match(/<text\b[^>]*>/)?.[0]
    expect(dateTickText).toMatch(/^<text \{\.\.\.CHART_TICK\} /)
    expect(dateTickText).not.toMatch(/\b(fill|fontSize|fontFamily|fontWeight|style|className=\{)/)
    // Nowhere in the file: no font family/weight of its own, and no SVG text element with its own fill/colour/style.
    expect(source).not.toMatch(/fontFamily|fontWeight|font-family|font-weight/)
    const svgText = source.match(/<(text|tspan)\b[^>]*>/g) ?? []
    expect(svgText.length).toBeGreaterThan(0)
    for (const el of svgText) expect(el).not.toMatch(/\b(fill|stroke|color|style)=/)
    expect(source.match(/label=\{\{ value: 'Forecast', position: 'top', \.\.\.CHART_TICK \}\}/g)).toHaveLength(1)
    expect(source).not.toMatch(/fontSize/)
  })
})
