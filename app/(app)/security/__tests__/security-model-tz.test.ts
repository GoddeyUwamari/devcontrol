/**
 * The Security Overview's dates and times are the viewer's local time (founder answer Q8, Oct 27), computed
 * west of UTC, where a time read in UTC lands on the wrong day in the evening. Only the trend's daily labels,
 * which are UTC calendar dates, stay in UTC.
 */
const NOW = vi.hoisted(() => {
  process.env.TZ = 'America/Los_Angeles'
  const now = Date.parse('2026-10-23T03:00:00Z') // Oct 22, 8 PM in Los Angeles
  vi.useFakeTimers({ toFake: ['Date'], now })
  return now
})

import { describe, it, expect, vi } from 'vitest'
import type { RiskScoreTrendResponse } from '@/lib/services/risk-score.service'
import { describeFramework, describeSecurity, formatDay, formatScanWhen, formatTime } from '../overview/securityModel'

describe('local dates west of UTC', () => {
  it('the zone is really Los Angeles here', () => {
    expect(new Date(NOW).getDate()).toBe(22)
  })
  it('formatDay and formatTime are local: 01:00 UTC on Oct 23 is still Oct 22 here', () => {
    expect(formatDay('2026-10-23T01:00:00Z', NOW)).toBe('Oct 22')
    expect(formatTime('2026-10-23T02:00:00Z', NOW)).toBe('today, 7:00 PM')
    expect(formatTime('2026-10-22T02:00:00Z', NOW)).toBe('yesterday, 7:00 PM')
  })
  it('trend labels stay UTC calendar days; framework dates are local', () => {
    const trend = { history: [{ date: '2026-10-21', score: 80 }, { date: '2026-10-23', score: 81 }] } as unknown as RiskScoreTrendResponse
    const view = describeSecurity({
      score: { status: 'loading' }, trend: { status: 'ready', data: trend }, accountFindings: { status: 'loading' },
      resourceFindings: { status: 'loading' }, coverage: { status: 'loading' }, frameworks: { status: 'loading' }, anomalies: { status: 'loading' },
    }, NOW)
    expect(view.trend?.points.map((p) => p.label)).toEqual(['Oct 21', 'Oct 23'])
    const fw = describeFramework(
      { id: 'a', name: 'A' } as never,
      [{ id: 's', framework_id: 'a', status: 'completed', compliant_resources: 9, non_compliant_resources: 1, completed_at: '2026-10-23T01:00:00Z', created_at: '2026-10-23T01:00:00Z', started_at: null } as never],
      NOW,
    )
    expect(fw.text).toBe('Evaluated Oct 22 · 90%')
  })
  it('the header scan time is the viewer\'s LOCAL time, with no zone suffix (founder answers 6 and Q8)', () => {
    // 01:00 UTC on Oct 23 is 6:00 PM on Oct 22 in Los Angeles: "today" here, not Oct 23.
    expect(formatScanWhen('2026-10-23T01:00:00Z', NOW)).toBe('today, 6:00 PM')
    expect(formatScanWhen('2026-10-21T17:30:00Z', NOW)).toBe('yesterday, 10:30 AM')
    expect(formatScanWhen('2026-10-20T17:30:00Z', NOW)).toBe('Oct 20, 10:30 AM')
  })
})
