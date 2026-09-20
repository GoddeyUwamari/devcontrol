/**
 * Focused coverage for the Cost Intelligence IA cleanup, translated to the
 * post-redesign component structure: the dashboard must never render a
 * second, per-item copy of /cost-optimization's own recommendation feed —
 * only a concise summary + single CTA.
 *
 * Dashboard is wired to many hooks/services -- rendering it in a unit test
 * would require mocking all of that, disproportionate to what this fix
 * needs to prove. Instead this reads page/component source directly, a
 * structural regression guard, not a copy/text-wording check.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const pageSource = readFileSync(join(__dirname, '../page.tsx'), 'utf-8')
const savingsOpportunitiesSource = readFileSync(join(__dirname, '../../../../components/dashboard/savings-opportunities.tsx'), 'utf-8')

describe('Dashboard recommendation-list duplication removal', () => {
  it('no longer renders individual topRecs entries as a list', () => {
    expect(pageSource).not.toMatch(/topRecs\.map\(/)
  })

  it('no longer defines the now-dead RiskBadge helper', () => {
    expect(pageSource).not.toMatch(/const RiskBadge = /)
  })

  it('retains the concise "Recommended action" card', () => {
    expect(pageSource).toMatch(/<RecommendedActionCard\b/)
  })

  it('retains the "Executive ROI" section', () => {
    expect(pageSource).toMatch(/<ExecutiveRoiCard\b/)
  })

  it('retains CTAs to the canonical /cost-optimization action surface', () => {
    const ctaCount = (pageSource.match(/href="\/cost-optimization"/g) ?? []).length
      + (readFileSync(join(__dirname, '../../../../components/dashboard/recommended-action-card.tsx'), 'utf-8').match(/href=\{ctaHref\}/g) ?? []).length
      + (readFileSync(join(__dirname, '../../../../components/dashboard/savings-opportunities.tsx'), 'utf-8').match(/detailsHref = '\/cost-optimization'/g) ?? []).length
    expect(ctaCount).toBeGreaterThan(0)
  })

  it('retains the categorical Cost-Saving Opportunities breakdown (a summary, not a list of individual recommendations)', () => {
    expect(pageSource).toMatch(/<SavingsOpportunities\b/)
    expect(savingsOpportunitiesSource).toMatch(/Cost-Saving Opportunities/)
  })
})

describe('Dashboard: EBS is a real, filtered category (not hardcoded unsupported)', () => {
  // Superseded by dashboard-production-fixes.test.ts's "cost-saving opportunity
  // reconciliation" suite, which covers this in depth (EC2/EBS/RDS/S3 all
  // derived from costRecsRaw, evaluation-state-driven wording). This one
  // guard stays here as a quick structural regression check.
  it('EBS is filtered from costRecsRaw like every other category, not a hardcoded null/unsupported stub', () => {
    expect(pageSource).not.toMatch(/count:\s*null,\s*savingsLabel:\s*null,\s*badge:\s*undefined/)
    expect(pageSource).toMatch(/OPPORTUNITY_CATEGORIES[^]*?type:\s*'EBS'/)
  })
})
