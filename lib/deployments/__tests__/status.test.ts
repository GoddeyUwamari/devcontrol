/**
 * Deployment status mapping, change-failure-rate maths and the summary text.
 *
 * The CI deploy webhook records 'success' / 'failed'; the page used to
 * recognise only 'running', so every successful deployment was shown as
 * "Stopped" with a 0% success rate. Statuses are now shown as recorded, and
 * anything unrecognised is Unknown -- never "Stopped", never another state.
 */
import { describe, it, expect } from 'vitest'
import {
  IN_PROGRESS_MAX_AGE_HOURS,
  anyRecordedCost,
  changeFailureRate,
  classifyDeploymentStatus,
  deploymentStatusDisplay,
  deploymentSummaryText,
  formatChangeFailureRate,
  formatRecordedCost,
  pageNumbers,
  recordedCost,
  summarizeDeployments,
  type DeploymentStats,
} from '../status'
import { doraCsvRows } from '../dora-display'

const NOW = new Date('2026-01-15T12:00:00.000Z')
const hoursBefore = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString()

describe('deploymentStatusDisplay', () => {
  it("shows what the webhook recorded: 'success' is Succeeded, 'failed' is Failed", () => {
    expect(deploymentStatusDisplay('success', hoursBefore(900), NOW)).toMatchObject({ outcome: 'success', label: 'Succeeded' })
    expect(deploymentStatusDisplay('failed', hoursBefore(900), NOW)).toMatchObject({ outcome: 'failed', label: 'Failed' })
  })

  it("shows a recent 'deploying' row as In progress", () => {
    expect(deploymentStatusDisplay('deploying', hoursBefore(0.5), NOW)).toMatchObject({ outcome: 'in_progress', label: 'In progress' })
    expect(classifyDeploymentStatus('deploying', hoursBefore(IN_PROGRESS_MAX_AGE_HOURS - 0.01), NOW)).toBe('in_progress')
  })

  it("shows an older 'deploying' row as No completion recorded, not as still in progress", () => {
    expect(deploymentStatusDisplay('deploying', hoursBefore(IN_PROGRESS_MAX_AGE_HOURS), NOW))
      .toMatchObject({ outcome: 'no_completion_recorded', label: 'No completion recorded' })
    expect(classifyDeploymentStatus('deploying', hoursBefore(24 * 40), NOW)).toBe('no_completion_recorded')
    expect(classifyDeploymentStatus('deploying', null, NOW)).toBe('no_completion_recorded')
    expect(classifyDeploymentStatus('deploying', 'not-a-date', NOW)).toBe('no_completion_recorded')
  })

  it.each(['running', 'stopped', 'cancelled', 'timed_out', 'SUCCESS', 'succeeded', '', null, undefined, 42])(
    'shows an unrecognised status (%p) as Unknown',
    (status) => {
      const display = deploymentStatusDisplay(status, hoursBefore(0), NOW)
      expect(display).toMatchObject({ outcome: 'unknown', label: 'Unknown' })
    }
  )

  it('never produces the label "Stopped" or "Running" for any input', () => {
    const inputs = ['success', 'failed', 'deploying', 'running', 'stopped', 'anything', null, undefined]
    const labels = inputs.flatMap(s => [hoursBefore(0), hoursBefore(100), null].map(c => deploymentStatusDisplay(s, c, NOW).label))
    expect(labels).not.toContain('Stopped')
    expect(labels).not.toContain('Running')
  })
})

describe('changeFailureRate', () => {
  it('is failed / (success + failed), to one decimal place', () => {
    expect(changeFailureRate(3, 1)).toBe(25)
    expect(changeFailureRate(198, 2)).toBe(1)
    expect(changeFailureRate(2, 1)).toBe(33.3)
    expect(changeFailureRate(0, 5)).toBe(100)
  })

  it('is a real 0 when deployments finished and none failed, and null when nothing finished', () => {
    expect(changeFailureRate(7, 0)).toBe(0)
    expect(changeFailureRate(0, 0)).toBeNull()
  })

  it('formats null as a dash, never as 0%', () => {
    expect(formatChangeFailureRate(null)).toBe('—')
    expect(formatChangeFailureRate(undefined)).toBe('—')
    expect(formatChangeFailureRate(0)).toBe('0%')
    expect(formatChangeFailureRate(33.3)).toBe('33.3%')
  })
})

describe('summarizeDeployments', () => {
  const row = (status: string, hoursAgo: number) => ({
    status, createdAt: hoursBefore(hoursAgo), deployedAt: hoursBefore(hoursAgo),
  })

  it('keeps unfinished and unknown rows out of the rate, and windowed rows out of the counts', () => {
    const stats = summarizeDeployments([
      row('success', 1), row('success', 30), row('success', 50), row('failed', 70),
      row('deploying', 1), row('deploying', 10), row('running', 5), row('stopped', 5),
      row('failed', 24 * 45), // outside the 30-day window
    ], 30, NOW)

    expect(stats).toMatchObject({
      window_days: 30, total: 8, success: 3, failed: 1, in_progress: 1, no_completion_recorded: 1, unknown: 2,
      change_failure_rate: 25,
    })
    expect(stats.last_deployment).toEqual({ status: 'success', deployed_at: hoursBefore(1) })
  })

  it('has no rate and no last deployment when nothing finished', () => {
    const stats = summarizeDeployments([row('deploying', 1), row('running', 2)], 30, NOW)
    expect(stats.change_failure_rate).toBeNull()
    expect(stats.last_deployment).toBeNull()
  })
})

describe('deploymentSummaryText', () => {
  const base: DeploymentStats = {
    window_days: 30, total: 0, success: 0, failed: 0, in_progress: 0, no_completion_recorded: 0, unknown: 0,
    change_failure_rate: null, organization_has_deployments: true, last_deployment: null,
  }

  it('is built from the real counts', () => {
    expect(deploymentSummaryText({ ...base, total: 200, success: 198, failed: 2, change_failure_rate: 1 }))
      .toBe('198 of 200 finished deployments in the last 30 days succeeded and 2 failed (change failure rate 1%).')
  })

  it('mentions unfinished and unrecognised rows separately from the finished ones', () => {
    expect(deploymentSummaryText({
      ...base, window_days: 7, total: 6, success: 1, failed: 0, in_progress: 1, no_completion_recorded: 2, unknown: 2, change_failure_rate: 0,
    })).toBe(
      '1 of 1 finished deployment in the last 7 days succeeded and 0 failed (change failure rate 0%). ' +
      '1 is in progress. 2 have no completion recorded. 2 have an unrecognised status.'
    )
  })

  it('says so when nothing was recorded or nothing finished -- no rate is claimed', () => {
    expect(deploymentSummaryText(base)).toBe('No deployments were recorded in the last 30 days.')
    expect(deploymentSummaryText({ ...base, total: 2, in_progress: 2 }))
      .toBe('No deployments finished in the last 30 days. 2 are in progress.')
  })

  it('never uses the old "running successfully" wording', () => {
    const text = deploymentSummaryText({ ...base, total: 50, success: 50, change_failure_rate: 0 })
    expect(text).not.toMatch(/running|success rate/i)
  })
})

describe('doraCsvRows', () => {
  it('exports untracked metrics as "Not tracked" with the reason and no value, and has no trend column', () => {
    const rows = doraCsvRows({
      deploymentFrequency: { tracked: true, value: 0.2, unit: 'per day', benchmark: 'high', description: '6 successful deployments in 30 days' },
      leadTime: { tracked: false, reason: 'no change timestamp' },
      changeFailureRate: { tracked: true, value: null, unit: 'percentage', benchmark: null, description: 'No finished deployments in this period' },
      mttr: { tracked: false, reason: 'no incident records' },
    })

    expect(rows[0]).toEqual(['Metric', 'Value', 'Unit', 'Benchmark', 'Note'])
    expect(rows[1]).toEqual(['Deployment Frequency', '0.20', 'per day', 'high', '6 successful deployments in 30 days'])
    expect(rows[2]).toEqual(['Lead Time for Changes', 'Not tracked', '', '', 'no change timestamp'])
    expect(rows[3]).toEqual(['Change Failure Rate', '', 'percentage', '', 'No finished deployments in this period'])
    expect(rows[4]).toEqual(['Mean Time to Recovery', 'Not tracked', '', '', 'no incident records'])
  })
})

describe('recorded cost', () => {
  it('NULL, the legacy default 0.00 and anything unparseable are "not recorded"', () => {
    for (const value of [null, undefined, '', 0, '0', '0.00', 'abc', NaN, -5]) {
      expect(recordedCost(value)).toBeNull()
      expect(formatRecordedCost(value)).toBe('—')
    }
  })

  it('a positive amount is a recorded cost, as a number or as the API\'s decimal string', () => {
    expect(recordedCost(12.5)).toBe(12.5)
    expect(recordedCost('245.50')).toBe(245.5)
    expect(formatRecordedCost('245.50')).toBe('$245.50')
    expect(formatRecordedCost(0.01)).toBe('$0.01')
  })

  it('never formats to "$0.00"', () => {
    for (const value of [null, 0, '0.00', '0', undefined]) expect(formatRecordedCost(value)).not.toContain('$')
  })

  it('a column is worth showing only when a row in view has a recorded cost', () => {
    expect(anyRecordedCost([])).toBe(false)
    expect(anyRecordedCost([{ costEstimate: null }, { costEstimate: 0 }, {}])).toBe(false)
    expect(anyRecordedCost([{ costEstimate: null }, { costEstimate: 3 }])).toBe(true)
  })
})

describe('pageNumbers', () => {
  it('lists every page when there are few', () => {
    expect(pageNumbers(1, 1)).toEqual([1])
    expect(pageNumbers(2, 3)).toEqual([1, 2, 3])
    expect(pageNumbers(1, 3)).toEqual([1, 2, 3])
  })

  it('keeps the first, the last and the neighbours of the current page, with gaps between', () => {
    expect(pageNumbers(1, 40)).toEqual([1, 2, 'gap', 40])
    expect(pageNumbers(20, 40)).toEqual([1, 'gap', 19, 20, 21, 'gap', 40])
    expect(pageNumbers(40, 40)).toEqual([1, 'gap', 39, 40])
  })

  it('fills a gap of exactly one page with that page', () => {
    expect(pageNumbers(3, 40)).toEqual([1, 2, 3, 4, 'gap', 40])
    expect(pageNumbers(4, 40)).toEqual([1, 2, 3, 4, 5, 'gap', 40])
    expect(pageNumbers(1, 4)).toEqual([1, 2, 3, 4])
  })
})

describe('summarizeDeployments — whether anything is recorded', () => {
  it('reports no deployments only for an empty list', () => {
    expect(summarizeDeployments([], 30, NOW).organization_has_deployments).toBe(false)
    expect(summarizeDeployments([
      { status: 'deploying', createdAt: hoursBefore(24 * 400), deployedAt: hoursBefore(24 * 400) },
    ], 30, NOW).organization_has_deployments).toBe(true)
  })
})
