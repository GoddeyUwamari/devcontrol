/**
 * formatCalculatedAgo: the /infrastructure "Calculated … ago" line. Server and
 * browser clocks differ slightly (~275ms measured in production), so a freshly
 * computed System Intelligence `computed_at` can sit just ahead of the
 * browser's clock -- which date-fns rendered as "in less than a minute".
 * Pure function, fixed `now`: no timers, no sleeps.
 */
import { describe, it, expect } from 'vitest'
import { formatCalculatedAgo, CLOCK_SKEW_TOLERANCE_MS } from '../calculatedAgo'

const NOW = new Date('2026-09-23T08:12:00.000Z')
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString()

describe('formatCalculatedAgo', () => {
  it('uses the approved 30s clock-skew tolerance', () => {
    expect(CLOCK_SKEW_TOLERANCE_MS).toBe(30_000)
  })

  it.each([
    ['exactly now', 0],
    ['+1ms', 1],
    ['+300ms (the production case)', 300],
    ['+5s', 5_000],
    ['+29.999s', 29_999],
    ['+30s (the tolerance itself)', 30_000],
  ])('%s -> "less than a minute ago", never future tense', (_label, offsetMs) => {
    const result = formatCalculatedAgo(at(offsetMs), NOW)
    expect(result).toBe('less than a minute ago')
    expect(result).not.toMatch(/^in /)
  })

  it.each([
    ['+30.001s', 30_001],
    ['+2 minutes', 2 * 60_000],
    ['+1 day', 24 * 60 * 60_000],
  ])('%s (beyond any plausible clock skew) -> null, not presented as fresh', (_label, offsetMs) => {
    expect(formatCalculatedAgo(at(offsetMs), NOW)).toBeNull()
  })

  it('past timestamps keep date-fns wording', () => {
    expect(formatCalculatedAgo(at(-60_000), NOW)).toBe('1 minute ago')
    expect(formatCalculatedAgo(at(-3 * 60 * 60_000), NOW)).toBe('about 3 hours ago')
    expect(formatCalculatedAgo(at(-2 * 24 * 60 * 60_000), NOW)).toBe('2 days ago')
  })

  it.each([
    ['missing', undefined],
    ['null', null],
    ['empty string', ''],
    ['malformed string', 'not-a-date'],
    ['number', 1758615120000],
    ['Date object', NOW],
    ['object', { computed_at: at(0) }],
  ])('%s -> null (no fabricated timestamp)', (_label, value) => {
    expect(formatCalculatedAgo(value, NOW)).toBeNull()
  })
})
