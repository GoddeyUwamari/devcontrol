/**
 * Infrastructure's red card says "critical" only when a Critical finding exists,
 * and gets there by wording, never by dropping a finding from the count.
 */
import { describe, it, expect } from 'vitest'
import { describeAttentionCard } from '../attentionCard'

const counts = (critical: number, high: number, medium = 0, low = 0) => ({ critical, high, medium, low })

describe('describeAttentionCard', () => {
  it('is never titled "Critical Issues"', () => {
    for (const findings of [undefined, null, counts(0, 0), counts(0, 3), counts(2, 0), counts(5, 17, 10, 9)]) {
      expect(describeAttentionCard(findings).label).toBe('Needs Attention')
    }
  })

  it.each([
    [counts(0, 0), 'No high-severity findings'],
    [counts(0, 1), '1 high finding'],
    [counts(0, 3, 5, 9), '3 high findings'],
    [counts(1, 0), '1 critical finding'],
    [counts(2, 0), '2 critical findings'],
    [counts(1, 2), '1 critical · 2 high findings'],
    [counts(5, 17, 10, 9), '5 critical · 17 high findings'],
  ])('%j reads "%s"', (findings, line) => {
    expect(describeAttentionCard(findings).severityLine).toBe(line)
  })

  it('does not use the word "critical" at 0 Critical', () => {
    for (const findings of [counts(0, 0), counts(0, 3, 5, 9), counts(0, 0, 4, 2)]) {
      const card = describeAttentionCard(findings)
      expect(`${card.label} ${card.severityLine} ${card.action}`).not.toMatch(/critical/i)
    }
  })

  it('unknown counts (loading, failed, older backend) give no severity line rather than a guess', () => {
    expect(describeAttentionCard(undefined).severityLine).toBeNull()
    expect(describeAttentionCard(null).severityLine).toBeNull()
  })

  it('"Resolve now" is kept for when there is a Critical finding', () => {
    expect(describeAttentionCard(counts(1, 0)).action).toBe('Resolve now →')
    expect(describeAttentionCard(counts(0, 4)).action).toBe('Review →')
  })
})
