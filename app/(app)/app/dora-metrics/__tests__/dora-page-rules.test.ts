/**
 * The Engineering Intelligence page's display rules (_lib/dora-page.ts), from
 * D4-shaped responses: precision at band bounds (ruling D5-D6), change lines,
 * What changed (§1.2-C), the source line (D5-D1) and the deploying-only count (G).
 */
import { describe, expect, it } from 'vitest'
import {
  displayDecimals,
  doraCsvFilename,
  doraCsvText,
  pointsText,
  failureChangeLine,
  formatMetricValue,
  formatTarget,
  formatUtcDay,
  frequencyChangeLine,
  frequencyFactLine,
  methodSourceSentence,
  sourceLine,
  whatChanged,
  withoutResultCount,
} from '../_lib/dora-page'
import type { DeploymentStats, RecordedDeployment } from '@/lib/deployments/status'
import { API_BANDS, emptyData, founderData, mixedData, PIPELINE_ROW, STATS_BASE } from './d4-fixture'

const DF = API_BANDS.deploymentFrequency
const CFR = API_BANDS.changeFailureRate
const band = (benchmark: 'elite' | 'high' | 'medium' | 'low') => ({ benchmark, isCustomBenchmark: false })
const custom = (benchmark: 'elite' | 'high' | 'medium' | 'low') => ({ benchmark, isCustomBenchmark: true })

describe('precision (D5-D6): one decimal unless it would contradict the level shown', () => {
  it.each([
    // [value, level, expected] -- deployment frequency, bands elite > 1, high 0.14..1, medium 0.03..<0.14
    [3.87, 'elite', '3.9 / day'],
    [1.01, 'elite', '1.01 / day'], // "1.0" would read as High (elite is > 1)
    [1.04, 'elite', '1.04 / day'],
    [1.05, 'elite', '1.1 / day'],
    [1, 'high', '1.0 / day'],
    [0.96, 'high', '1.0 / day'], // 1.0 is still inside High (<= 1)
    [0.14, 'high', '0.14 / day'], // "0.1" would read as Medium
    [0.15, 'high', '0.15 / day'],
    [0.16, 'high', '0.2 / day'],
    [0.13, 'medium', '0.1 / day'],
    [0.03, 'medium', '0.03 / day'], // "0.0" would read as Low
    [0.02, 'low', '0.02 / day'], // non-zero never reads 0.0
    [0.01, 'low', '0.01 / day'],
    [0.05, 'medium', '0.1 / day'],
  ] as const)('frequency %s (%s) → %s', (value, level, text) => {
    expect(formatMetricValue('deploymentFrequency', value, band(level), DF, undefined)).toBe(text)
  })

  it.each([
    // change failure rate, bands elite <= 5, high > 5..10, medium > 10..15, low > 15
    [0, 'elite', '0.0%'], // a real zero stays 0.0
    [0.04, 'elite', '0.04%'], // non-zero never reads 0.0
    [0.01, 'elite', '0.01%'],
    [0.05, 'elite', '0.1%'],
    [4.96, 'elite', '5.0%'],
    [5, 'elite', '5.0%'],
    [5.01, 'high', '5.01%'], // "5.0" would read as Elite
    [5.04, 'high', '5.04%'],
    [5.05, 'high', '5.05%'], // toFixed(1) gives "5.0" (5.05 is stored just below)
    [5.06, 'high', '5.1%'],
    [10.04, 'medium', '10.04%'],
    [15, 'medium', '15.0%'],
    [15.02, 'low', '15.02%'],
    [25, 'low', '25.0%'],
  ] as const)('failure rate %s (%s) → %s', (value, level, text) => {
    expect(formatMetricValue('changeFailureRate', value, band(level), CFR, undefined)).toBe(text)
  })

  it('a non-zero value never reads 0.0, with or without a level or a target', () => {
    expect(formatMetricValue('deploymentFrequency', 0.02, custom('low'), DF, 1)).toBe('0.02 / day')
    expect(formatMetricValue('changeFailureRate', 0.03, custom('elite'), CFR, 2)).toBe('0.03%')
    expect(formatMetricValue('deploymentFrequency', 0.04, band('low'), undefined, undefined)).toBe('0.04 / day')
  })

  it('with a custom target, two decimals only when one would flip "meets" / "misses"', () => {
    expect(formatMetricValue('changeFailureRate', 2.04, custom('high'), CFR, 2)).toBe('2.04%') // misses; "2.0%" would meet ≤ 2
    expect(formatMetricValue('changeFailureRate', 1.96, custom('elite'), CFR, 2)).toBe('2.0%') // meets either way
    expect(formatMetricValue('deploymentFrequency', 1.96, custom('high'), DF, 2)).toBe('1.96 / day') // "2.0" would meet ≥ 2
    expect(formatMetricValue('deploymentFrequency', 2.04, custom('elite'), DF, 2)).toBe('2.0 / day')
  })

  it('reads the bounds from the served bands, not from the component', () => {
    const shifted = { ...DF, levels: DF.levels.map((l) => (l.level === 'elite' ? { ...l, lower: { value: 2, inclusive: false } } : l)) }
    expect(displayDecimals('deploymentFrequency', 2.01, band('elite'), shifted, undefined)).toBe(2)
    expect(displayDecimals('deploymentFrequency', 2.01, band('elite'), DF, undefined)).toBe(1)
  })

  it('target text', () => {
    expect(formatTarget('changeFailureRate', 2)).toBe('≤ 2.0%')
    expect(formatTarget('deploymentFrequency', 5)).toBe('≥ 5.0 / day')
    expect(formatTarget('deploymentFrequency', 0.25)).toBe('≥ 0.25 / day')
  })
})

describe('change lines', () => {
  it('frequency: the relative change the API sent, whole percent', () => {
    expect(frequencyChangeLine(founderData())).toBe('Up 18% vs previous 30 days')
    const down = founderData(); down.change!.deploymentsPerDayPercent = -42.6
    expect(frequencyChangeLine(down)).toBe('Down 43% vs previous 30 days')
    const level = founderData(); level.change!.deploymentsPerDayPercent = 0
    expect(frequencyChangeLine(level)).toBe('Same as previous 30 days')
    const tiny = founderData(); tiny.change!.deploymentsPerDayPercent = 0.4
    expect(frequencyChangeLine(tiny)).toBe('Up 0.4% vs previous 30 days')
  })

  it('frequency without a comparison: no percentage', () => {
    const none = founderData()
    none.change!.deploymentsPerDayPercent = null
    none.previousPeriod!.deploymentsPerDay = null
    expect(frequencyChangeLine(none)).toBe('No finished deploys in the previous 30 days')
    none.previousPeriod!.deploymentsPerDay = 0
    expect(frequencyChangeLine(none)).toBe('None in the previous 30 days')
    expect(frequencyChangeLine(emptyData())).toBeNull()
  })

  it('failure rate: percentage points from the two rates, not the relative %', () => {
    const d = mixedData() // 4.0% vs 2.5%; change.changeFailureRatePercent = 60
    expect(failureChangeLine(d)).toBe('Up 1.5 points vs previous 30 days')
    d.previousPeriod!.changeFailureRate = 6.25
    expect(failureChangeLine(d)).toBe('Down 2.3 points vs previous 30 days') // -2.25, half away from zero
    expect(failureChangeLine(founderData())).toBe('Same as previous 30 days') // 0 vs 0; the API's relative % is null
    d.previousPeriod!.changeFailureRate = null
    expect(failureChangeLine(d)).toBe('No finished deploys in the previous 30 days')
    expect(failureChangeLine(emptyData())).toBeNull()
  })

  it('review L-1: a points change is never "Same" unless the two rates are equal; 0.0 never stands for a change', () => {
    const at = (cur: number, prev: number) => {
      const d = mixedData()
      d.changeFailureRate = { ...d.changeFailureRate, value: cur }
      d.previousPeriod!.changeFailureRate = prev
      return d
    }
    expect(failureChangeLine(at(5.04, 5))).toBe('Up 0.04 points vs previous 30 days') // High now, Elite before
    expect(failureChangeLine(at(5, 5.04))).toBe('Down 0.04 points vs previous 30 days')
    expect(failureChangeLine(at(0.02, 0))).toBe('Up 0.02 points vs previous 30 days')
    expect(failureChangeLine(at(2.65, 2.6))).toBe('Up 0.1 points vs previous 30 days') // exactly 0.05, not 0.0499…
    expect(failureChangeLine(at(2.5, 2.5))).toBe('Same as previous 30 days')
    expect(failureChangeLine(at(0, 0))).toBe('Same as previous 30 days')
    expect(whatChanged(at(5.04, 5))?.[1].headline).toBe('Failure rate up 0.04 points')
    expect(whatChanged(at(0.02, 0))?.[1].headline).toBe('Failure rate up 0.02 points')
    expect(whatChanged(at(4, 4))?.[1].headline).toBe('Failure rate unchanged')
  })

  it('points text: one decimal, two only when one would read 0.0', () => {
    expect(pointsText(0.04)).toBe('0.04')
    expect(pointsText(-0.01)).toBe('0.01')
    expect(pointsText(0.05)).toBe('0.1')
    expect(pointsText(1.5)).toBe('1.5')
    expect(pointsText(-2.25)).toBe('2.3')
    expect(pointsText(12)).toBe('12.0')
  })

  it('fact line keeps the indicative note under 5 finished (D5-D8)', () => {
    const few = founderData(); few.deployments = { successful: 3, failed: 1, finished: 4 }
    expect(frequencyFactLine(few)).toBe('3 successful deploys in 30 days · fewer than 5 finished, so the level is indicative')
    expect(frequencyFactLine(founderData())).toBe('116 successful deploys in 30 days')
  })
})

describe('What changed (§1.2-C)', () => {
  it('founder: deploys up, no failures in either period, busiest day', () => {
    expect(whatChanged(founderData())).toEqual([
      { headline: 'Deploys up 18%', detail: '116 successful in the last 30 days, 98 in the 30 days before.' },
      { headline: 'No failed deploys', detail: 'None in either period.' },
      { headline: 'Busiest day: Nov 11', detail: '7 deploys.' },
    ])
  })

  it('failures, ties and a part day', () => {
    expect(whatChanged(mixedData())).toEqual([
      { headline: 'Deploys up 23%', detail: '48 successful in the last 30 days, 39 in the 30 days before.' },
      { headline: 'Failure rate up 1.5 points', detail: '2 of 50 failed, against 1 of 40 in the 30 days before.' },
      { headline: 'Busiest day: Nov 20', detail: '6 deploys. 1 failed. 2 other days had as many. Counted for the part of that day inside this period.' },
    ])
  })

  it('no failures now, some before; first successful deploys; singular forms', () => {
    const d = mixedData()
    d.deployments = { successful: 1, failed: 0, finished: 1 }
    d.previousPeriod!.deployments = { successful: 0, failed: 3, finished: 3 }
    d.change!.deploymentsPerDayPercent = null
    d.busiestDay = { date: '2026-11-02', total: 1, succeeded: 1, failed: 0, partial: false, tiedDays: 2 }
    expect(whatChanged(d)).toEqual([
      { headline: 'First successful deploys', detail: '1 in the last 30 days, none in the 30 days before.' },
      { headline: 'No failed deploys', detail: '3 in the 30 days before.' },
      { headline: 'Busiest day: Nov 2', detail: '1 deploy. 1 other day had as many.' },
    ])
  })

  it('busiest day is the API field, never recomputed from the daily series', () => {
    const d = founderData()
    d.busiestDay = { date: '2026-10-30', total: 4, succeeded: 4, failed: 0, partial: false, tiedDays: 1 } // daily max is Nov 11 (7)
    expect(whatChanged(d)?.[2]).toEqual({ headline: 'Busiest day: Oct 30', detail: '4 deploys.' })
  })

  it('nothing to compare when either period has no finished deploy', () => {
    expect(whatChanged(emptyData())).toBeNull()
    const noPrev = founderData()
    noPrev.previousPeriod!.deployments = { successful: 0, failed: 0, finished: 0 }
    expect(whatChanged(noPrev)).toBeNull()
  })

  it('formats dates as UTC days', () => {
    expect(formatUtcDay('2026-11-11')).toBe('Nov 11')
    expect(formatUtcDay('2026-01-01')).toBe('Jan 1')
  })
})

describe('source line (D5-D1) and deploying-only (G)', () => {
  const stats = (o: Partial<DeploymentStats> = {}) => ({ ...STATS_BASE, ...o }) as DeploymentStats
  const row = (o: Partial<RecordedDeployment> = {}) => ({ ...PIPELINE_ROW, ...o }) as unknown as RecordedDeployment

  it('names the source of the latest finished record, with the record time', () => {
    const s = sourceLine(stats(), [row({ status: 'deploying', metadata: { source: 'manual' } }), row()])
    expect(s.dot).toBe('solid')
    expect(s.text).toMatch(/^Last record from GitHub Actions \(deploy-backend job\) · Nov 1[89], \d{1,2}:\d{2} [AP]M$/)
    expect(s.kind).toBe('github_actions')
    expect(sourceLine(stats(), [row({ metadata: { source: 'manual' } })]).text).toMatch(/^Last record entered by hand · /)
    expect(sourceLine(stats(), []).text).toMatch(/^Last finished record · /)
  })

  it('hollow dot when the workspace has no deployment at all; nothing when stats are missing', () => {
    expect(sourceLine(stats({ organization_has_deployments: false, last_deployment: null }), [])).toEqual({ dot: 'hollow', text: 'No deployment source connected', kind: 'none' })
    expect(sourceLine(undefined, [row()])).toEqual({ dot: 'none', text: null, kind: null })
    expect(sourceLine(stats({ last_deployment: null }), [row({ status: 'deploying' })]).text).toBe('Deployments recorded, none with a result yet')
  })

  it('Data and method sentence follows the source', () => {
    expect(methodSourceSentence('github_actions', false)).toMatch(/^Records come from your pipeline \(GitHub Actions, via webhook\)/)
    expect(methodSourceSentence('manual', false)).toBe('Records come from deployments recorded by hand on the Deployments page.')
    expect(methodSourceSentence('none', false)).toBe('No records yet. Record a deployment by hand on the Deployments page.')
  })

  it('rows without a result: only unfiltered, only when nothing finished', () => {
    const s = stats({ total: 3, success: 0, in_progress: 1, no_completion_recorded: 2 })
    expect(withoutResultCount(emptyData(), s, false)).toBe(3)
    expect(withoutResultCount(emptyData(), s, true)).toBeNull()
    expect(withoutResultCount(founderData(), s, false)).toBeNull()
    expect(withoutResultCount(emptyData(), stats({ total: 0, success: 0 }), false)).toBeNull()
  })
})

describe('CSV (review L-6)', () => {
  const rows = [['Metric', 'Value', 'Unit', 'Benchmark', 'Note'], ['Deployment frequency', '4.20', 'per day', 'elite', 'x']]
  it('demo data is marked on the first line after the header and in the file name', () => {
    expect(doraCsvText(rows, true).split('\n')).toEqual([
      '"Metric","Value","Unit","Benchmark","Note"',
      '"Demo data · not your workspace","","","",""',
      '"Deployment frequency","4.20","per day","elite","x"',
    ])
    expect(doraCsvFilename('30d', '2026-11-20', true)).toBe('dora-metrics-30d-2026-11-20-demo.csv')
  })
  it('real data carries no demo marker', () => {
    expect(doraCsvText(rows, false)).not.toMatch(/Demo data/)
    expect(doraCsvFilename('30d', '2026-11-20', false)).toBe('dora-metrics-30d-2026-11-20.csv')
  })
})
