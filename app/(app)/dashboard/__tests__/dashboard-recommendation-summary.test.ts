/**
 * Focused coverage for the Cost Intelligence IA cleanup's Dashboard change:
 * two sections previously rendered the full individual `topRecs` list
 * (effectively embedding a second copy of /cost-optimization's own feed
 * inside Dashboard). Both are now a concise summary + single CTA instead.
 *
 * Dashboard is a ~1500-line component wired to many hooks/services
 * (useAuth, useWebSocket, useRouter, demo mode, AI insights, activity feed,
 * etc.) -- rendering it in a unit test would require mocking all of that,
 * disproportionate to what this fix needs to prove. Instead this asserts
 * the actual structural regression this PR fixes (a per-item `.map` list
 * render) is gone, and that the retained summary/CTA elements are present,
 * by reading the page source directly -- a structural regression guard,
 * not a copy/text-wording check.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(__dirname, '../page.tsx'), 'utf-8')

describe('Dashboard recommendation-list duplication removal', () => {
  it('no longer renders individual topRecs entries as a list', () => {
    expect(source).not.toMatch(/topRecs\.map\(/)
  })

  it('no longer defines the now-dead RiskBadge helper (only used by the removed per-item lists)', () => {
    expect(source).not.toMatch(/const RiskBadge = /)
  })

  it('retains the concise "Recommended action" banner', () => {
    expect(source).toMatch(/Recommended action/)
  })

  it('retains the "Executive ROI summary" section', () => {
    expect(source).toMatch(/Executive ROI summary/)
  })

  it('retains CTAs to the canonical /cost-optimization action surface', () => {
    const ctaCount = (source.match(/href="\/cost-optimization"/g) ?? []).length
    expect(ctaCount).toBeGreaterThan(0)
  })

  it('retains the categorical Cost-saving opportunities breakdown (a summary, not a list of individual recommendations)', () => {
    expect(source).toMatch(/Cost-saving opportunities/)
  })
})
