/**
 * The shared formatter (founder answer Q8 and brief addition 3): server times are UTC and are shown in the
 * viewer's local time. Run in New York, where a UTC date read as UTC lands on the wrong day around midnight.
 */
const NOW = vi.hoisted(() => {
  process.env.TZ = 'America/New_York'
  return Date.parse('2026-10-27T03:30:00Z') // Oct 26, 11:30 PM in New York; already Oct 27 in UTC
})

import { describe, it, expect, vi } from 'vitest'
import { formatLocalDay, formatLocalWhen, parseServerTime } from '@/lib/utils/localTime'

describe('formatLocalWhen in New York', () => {
  it('the zone is really New York here', () => {
    expect(new Date(NOW).getDate()).toBe(26)
  })
  it('"today" is the viewer\'s day, not the UTC day', () => {
    // 02:00 UTC on Oct 27 is 10:00 PM on Oct 26 here: today, not "Oct 27, 2:00 AM".
    expect(formatLocalWhen('2026-10-27T02:00:00Z', NOW)).toBe('today, 10:00 PM')
  })
  it('"yesterday" across local midnight', () => {
    expect(formatLocalWhen('2026-10-26T02:00:00Z', NOW)).toBe('yesterday, 10:00 PM')
    expect(formatLocalWhen('2026-10-25T04:30:00Z', NOW)).toBe('yesterday, 12:30 AM')
  })
  it('older days: "Oct 24, 11:00 PM", no seconds and no year in the current year', () => {
    expect(formatLocalWhen('2026-10-25T03:00:00Z', NOW)).toBe('Oct 24, 11:00 PM')
    expect(formatLocalWhen('2026-10-25T03:00:45Z', NOW)).toBe('Oct 24, 11:00 PM')
  })
  it('a time after local midnight but still "today" in UTC is tomorrow here, with its own date', () => {
    expect(formatLocalWhen('2026-10-27T04:30:00Z', NOW)).toBe('Oct 27, 12:30 AM')
  })
  it('the year appears only outside the viewer\'s current year', () => {
    expect(formatLocalWhen('2025-12-31T23:30:00Z', NOW)).toBe('Dec 31, 2025, 6:30 PM')
    // New Year's Eve in New York is already Jan 1 in UTC: the local year decides.
    const newYearsEve = Date.parse('2027-01-01T03:00:00Z') // Dec 31, 2026, 10 PM here
    expect(formatLocalWhen('2027-01-01T01:00:00Z', newYearsEve)).toBe('today, 8:00 PM')
    expect(formatLocalWhen('2026-12-31T04:00:00Z', newYearsEve)).toBe('yesterday, 11:00 PM')
    expect(formatLocalWhen('2027-01-01T06:00:00Z', newYearsEve)).toBe('Jan 1, 2027, 1:00 AM')
  })
  it('a pinned zone overrides the viewer\'s', () => {
    expect(formatLocalWhen('2026-10-27T02:00:00Z', NOW, 'UTC')).toBe('today, 2:00 AM')
  })
  it('missing or invalid times are null, never "Invalid Date"', () => {
    expect(formatLocalWhen(null, NOW)).toBeNull()
    expect(formatLocalWhen('', NOW)).toBeNull()
    expect(formatLocalWhen('not a date', NOW)).toBeNull()
  })
})

describe('formatLocalDay in New York', () => {
  it('the local day, with the year only outside the current year', () => {
    expect(formatLocalDay('2026-10-27T02:00:00Z', NOW)).toBe('Oct 26')
    expect(formatLocalDay('2025-10-27T12:00:00Z', NOW)).toBe('Oct 27, 2025')
    expect(formatLocalDay(undefined, NOW)).toBeNull()
  })
})

describe('parseServerTime', () => {
  it('a time with no zone is UTC, never the viewer\'s zone', () => {
    expect(parseServerTime('2026-10-27T02:00:00')).toBe(Date.parse('2026-10-27T02:00:00Z'))
    expect(parseServerTime('2026-10-27 02:00:00')).toBe(Date.parse('2026-10-27T02:00:00Z'))
    expect(formatLocalWhen('2026-10-27T02:00:00', NOW)).toBe('today, 10:00 PM')
  })
  it('an explicit zone is kept', () => {
    expect(parseServerTime('2026-10-27T02:00:00+02:00')).toBe(Date.parse('2026-10-27T00:00:00Z'))
    expect(parseServerTime('2026-10-27T02:00:00.000Z')).toBe(Date.parse('2026-10-27T02:00:00Z'))
  })
  it('numbers pass through; junk is null', () => {
    expect(parseServerTime(NOW)).toBe(NOW)
    expect(parseServerTime(Number.NaN)).toBeNull()
    expect(parseServerTime('2026-13-45T99:00:00Z')).toBeNull()
  })
})
