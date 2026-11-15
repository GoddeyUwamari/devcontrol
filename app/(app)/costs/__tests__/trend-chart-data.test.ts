/**
 * DAY1-D14/D15: the Costs Spend Trend never draws an unreported period as $0,
 * and its labels are UTC calendar dates in every browser time zone (this file
 * runs with TZ=America/New_York, where a UTC-midnight date read as local time
 * would be the day before). Synthetic data only.
 */
process.env.TZ = 'America/New_York'
import { describe, it, expect } from 'vitest'
import { costsTrendChartData, utcChartLabel } from '../trend-chart-data'

describe('labels are the UTC calendar date', () => {
  it('Dec 1 stays Dec 1 west of UTC (it was "Nov 30")', () => {
    expect(new Date('2026-12-01').getDate()).toBe(30) // the browser-local reading this guards against
    expect(utcChartLabel('2026-12-01')).toBe('Dec 1')
    expect(utcChartLabel('2026-12-01T00:00:00.000Z')).toBe('Dec 1')
  })
})

describe('Dec 1 (UTC), 30D', () => {
  it('reported days are drawn; Dec 1 (provisional, no line items) is a gap, not $0', () => {
    const data = costsTrendChartData([
      { date: '2026-11-29', total: 13.3, lineItems: 2, provisional: false },
      { date: '2026-11-30', total: 13.3, lineItems: 2, provisional: true },
      { date: '2026-12-01', total: 0, lineItems: 0, provisional: true },
    ])
    expect(data).toEqual([
      { date: 'Nov 29', actual: 13.3, forecast: null },
      { date: 'Nov 30', actual: 13.3, forecast: null },
      { date: 'Dec 1', actual: null, forecast: null },
    ])
  })

  it('a finished day with no charges is a real $0 (drawn)', () => {
    expect(costsTrendChartData([{ date: '2026-11-15', total: 0, lineItems: 0, provisional: false }])[0].actual).toBe(0)
  })

  it('points from a backend without the flags are drawn as before', () => {
    expect(costsTrendChartData([{ date: '2026-12-01', total: 0 }])[0].actual).toBe(0)
  })
})
