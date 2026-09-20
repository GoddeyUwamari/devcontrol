/**
 * Focused coverage for the Cost Intelligence IA cleanup, translated to the
 * post-redesign component structure: the dashboard must never render a
 * second, per-item copy of /cost-optimization's own recommendation feed —
 * only a concise summary + single CTA. Also guards the EBS truthfulness
 * fix: since the real cost-recommendations backend doesn't tag EBS
 * resources yet, real mode must never claim active EBS detection coverage.
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

describe('Dashboard: truthful EBS detection state (real mode)', () => {
  it('real-mode EBS opportunities have no savingsLabel/count (not a fabricated dollar figure or 0), since the recommendation backend does not tag EBS resources yet', () => {
    expect(pageSource).toMatch(/const ebsOpportunities = isDemoActive[^]*?: \{ count: null, savingsLabel: null, badge: undefined \}/)
  })

  it('SavingsOpportunities renders "Not currently evaluated" rather than a fabricated figure when savingsLabel is null', () => {
    expect(savingsOpportunitiesSource).toMatch(/\{savingsLabel \?\? 'Not currently evaluated'\}/)
  })
})
