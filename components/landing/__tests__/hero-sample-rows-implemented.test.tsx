/**
 * The hero's sample panel is labelled "Sample data", but the findings it shows
 * must still be things DevControl actually detects. Before AUDIT-TRUTH-PR3 it
 * showed an "Idle RDS snapshot" row, and no snapshot detector exists.
 *
 * Each rendered row's subtitle must map to a rule in the backend Optimization
 * Rule Registry whose status is 'implemented' (the registry is the single
 * source of truth for which detectors run). A row with no mapping fails, so a
 * new sample row must name a real detector.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HeroSection } from '../HeroSection'
import { OPTIMIZATION_RULES } from '../../../backend/src/config/optimization-rules'

/** Hero row subtitle → registry rule id. */
const SUBTITLE_TO_RULE: Record<string, string> = {
  'Idle EC2 instance': 'ec2_idle',
  'Unattached EBS volume': 'ebs_unattached',
  'gp2 to gp3 upgrade': 'ebs_gp2_to_gp3',
  'Unused Elastic IP': 'ec2_unused_elastic_ip',
}

function renderedSubtitles(): string[] {
  render(<HeroSection />)
  return screen
    .getAllByTestId('hero-sample-panel-row')
    .map((row) => row.querySelectorAll('p')[1]?.textContent?.trim() ?? '')
}

describe('hero sample rows', () => {
  it('every row names a detector that is implemented in the registry', () => {
    const subtitles = renderedSubtitles()
    expect(subtitles.length).toBeGreaterThan(0)
    for (const subtitle of subtitles) {
      const ruleId = SUBTITLE_TO_RULE[subtitle]
      expect(ruleId, `sample row "${subtitle}" maps to no registry rule`).toBeDefined()
      const rule = OPTIMIZATION_RULES.find((r) => r.id === ruleId)
      expect(rule, `registry has no rule "${ruleId}"`).toBeDefined()
      expect(rule!.status, `"${subtitle}" illustrates rule "${ruleId}", which is not implemented`).toBe('implemented')
    }
  })

  it('no longer shows a snapshot or RDS finding (neither detector exists)', () => {
    const subtitles = renderedSubtitles().join(' | ')
    expect(subtitles).not.toMatch(/snapshot/i)
    expect(subtitles).not.toMatch(/RDS/)
  })
})
