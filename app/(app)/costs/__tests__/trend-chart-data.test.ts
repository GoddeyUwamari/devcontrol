/**
 * DAY1-D14/D15 + trend-lag-build.md: the Costs Spend Trend never draws an
 * unreported period as $0, draws a still-updating period on its own lighter
 * line, and its labels are UTC calendar dates in every browser time zone (this
 * file runs with TZ=America/New_York, where a UTC-midnight date read as local
 * time would be the day before).
 *
 * The "real evidence" cases read the backend's pinned output for production's
 * 2026-11-16 7d trend (backend/src/controllers/__tests__/__fixtures__/trend-lag/
 * trend-7d-2026-11-16.new.json, written by trend-lag-real-evidence.test.ts from
 * the verbatim production response). The rest are synthetic.
 */
process.env.TZ = 'America/New_York'
import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { costsTrendChartData, costsTrendTooltipLines, utcChartLabel, type TrendPointInput } from '../trend-chart-data'

const REAL: TrendPointInput[] = JSON.parse(fs.readFileSync(
  path.resolve(__dirname, '../../../../backend/src/controllers/__tests__/__fixtures__/trend-lag/trend-7d-2026-11-16.new.json'), 'utf8',
)).data

describe('labels are the UTC calendar date', () => {
  it('Dec 1 stays Dec 1 west of UTC (it was "Nov 30")', () => {
    expect(new Date('2026-12-01').getDate()).toBe(30) // the browser-local reading this guards against
    expect(utcChartLabel('2026-12-01')).toBe('Dec 1')
    expect(utcChartLabel('2026-12-01T00:00:00.000Z')).toBe('Dec 1')
  })
})

describe('real evidence, 2026-11-16 7d', () => {
  const rows = costsTrendChartData(REAL)

  it('Nov 9-12 on the final line, Nov 13 on the lighter line (joined at Nov 12), Nov 14-16 on neither', () => {
    expect(rows.map((r) => [r.date, r.actual, r.updating, r.reportState])).toEqual([
      ['Nov 9', 0.58, null, 'final'],
      ['Nov 10', 0.61, null, 'final'],
      ['Nov 11', 0.77, null, 'final'],
      ['Nov 12', 0.83, 0.83, 'final'],
      ['Nov 13', null, 0.06, 'updating'],
      ['Nov 14', null, null, 'not_reported'],
      ['Nov 15', null, null, 'not_reported'],
      ['Nov 16', null, null, 'not_reported'],
    ])
  })

  it('tooltips: the approved strings; no amount and never $0.00 for a day not reported', () => {
    const tip = (label: string) => costsTrendTooltipLines(rows.find((r) => r.date === label), 'day')
    expect(tip('Nov 12')).toEqual(['Actual Spend: $0.83/day'])
    expect(tip('Nov 13')).toEqual(['Still updating · $0.06 so far. AWS Cost Explorer may still add charges.'])
    for (const d of ['Nov 14', 'Nov 15', 'Nov 16']) {
      expect(tip(d)).toEqual(['Not reported yet by AWS Cost Explorer'])
      expect(tip(d).join(' ')).not.toMatch(/\$/)
    }
  })
})

describe('Dec 1 (UTC), 30D', () => {
  it('reported days are drawn; Dec 1 (not reported) is a gap, not $0', () => {
    const data = costsTrendChartData([
      { date: '2026-11-29', total: 13.3, lineItems: 2, reportState: 'final', provisional: false },
      { date: '2026-11-30', total: 13.3, lineItems: 2, reportState: 'updating', provisional: true },
      { date: '2026-12-01', total: 0, lineItems: 0, reportState: 'not_reported', provisional: true },
    ])
    expect(data).toEqual([
      { date: 'Nov 29', actual: 13.3, updating: 13.3, forecast: null, reportState: 'final', total: 13.3 },
      { date: 'Nov 30', actual: null, updating: 13.3, forecast: null, reportState: 'updating', total: 13.3 },
      { date: 'Dec 1', actual: null, updating: null, forecast: null, reportState: 'not_reported', total: null },
    ])
  })

  it('a final day with no charges is a real $0 (drawn), and its tooltip says $0.00', () => {
    const [row] = costsTrendChartData([{ date: '2026-11-15', total: 0, lineItems: 0, reportState: 'final', provisional: false }])
    expect(row.actual).toBe(0)
    expect(costsTrendTooltipLines(row, 'day')).toEqual(['Actual Spend: $0.00/day'])
  })

  it('a backend without reportState: provisional + no line items is still a gap; everything else final as before', () => {
    expect(costsTrendChartData([{ date: '2026-12-01', total: 0, lineItems: 0, provisional: true }])[0]).toMatchObject({ actual: null, reportState: 'not_reported' })
    expect(costsTrendChartData([{ date: '2026-11-30', total: 13.3, lineItems: 2, provisional: true }])[0]).toMatchObject({ actual: 13.3, updating: null, reportState: 'final' })
    expect(costsTrendChartData([{ date: '2026-12-01', total: 0 }])[0].actual).toBe(0)
  })

  it('monthly: the tooltip says per month', () => {
    const [row] = costsTrendChartData([{ date: '2026-11-01', total: 399, lineItems: 2, reportState: 'updating' }])
    expect(costsTrendTooltipLines(row, 'month')).toEqual(['Still updating · $399.00 so far. AWS Cost Explorer may still add charges.'])
  })
})
