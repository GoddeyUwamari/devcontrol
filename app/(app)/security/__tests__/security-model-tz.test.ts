/**
 * The Security Overview's dates are UTC regardless of the viewer's zone: the
 * same values as security-model.test.ts, computed west of UTC, where a UTC date
 * read as local time shifts back a day.
 */
const NOW = vi.hoisted(() => {
  process.env.TZ = 'America/Los_Angeles'
  const now = Date.parse('2026-10-23T03:00:00Z') // Oct 22, 8 PM in Los Angeles
  vi.useFakeTimers({ toFake: ['Date'], now })
  return now
})

import { describe, it, expect, vi } from 'vitest'
import type { RiskScoreTrendResponse } from '@/lib/services/risk-score.service'
import { describeFramework, describeSecurity, formatDay, formatTime } from '../overview/securityModel'

describe('UTC dates west of UTC', () => {
  it('the zone is really Los Angeles here', () => {
    expect(new Date(NOW).getDate()).toBe(22)
  })
  it('formatDay and formatTime stay in UTC', () => {
    expect(formatDay('2026-10-21', NOW)).toBe('Oct 21')
    expect(formatDay('2026-10-23T01:00:00Z', NOW)).toBe('Oct 23')
    expect(formatTime('2026-10-23T02:00:00Z', NOW)).toBe('today, 2:00 AM UTC')
  })
  it('trend labels and framework dates stay in UTC', () => {
    const trend = { history: [{ date: '2026-10-21', score: 80 }, { date: '2026-10-23', score: 81 }] } as unknown as RiskScoreTrendResponse
    const view = describeSecurity({
      score: { status: 'loading' }, trend: { status: 'ready', data: trend }, accountFindings: { status: 'loading' },
      resourceFindings: { status: 'loading' }, coverage: { status: 'loading' }, frameworks: { status: 'loading' }, anomalies: { status: 'loading' },
    }, NOW)
    expect(view.trend?.points.map((p) => p.label)).toEqual(['Oct 21', 'Oct 23'])
    const fw = describeFramework(
      { id: 'a', name: 'A' } as never,
      [{ id: 's', framework_id: 'a', status: 'completed', compliance_score: 90, completed_at: '2026-10-23T01:00:00Z', created_at: '2026-10-23T01:00:00Z', started_at: null } as never],
      NOW,
    )
    expect(fw.text).toBe('Evaluated Oct 23 · 90%')
  })
})
