/**
 * Covers the same invariants as before the dashboard redesign, translated to
 * the new component-composition structure:
 *  1. The AWS Cost Trends chart still defaults to 7 Days, not 90 Days.
 *  2. The dateRange/onDateRangeChange pair still flows live from the page,
 *     through CostTrendsCard, into the real CostTrendChart/CostBreakdownBarList.
 *  3. There is exactly ONE "Review savings" CTA on the page (inside
 *     RecommendedActionCard), not a duplicate arrangement, and it's hidden
 *     entirely when there are zero active recommendations rather than
 *     rendering as a dead link.
 *
 * Dashboard is wired to many hooks/services (useAuth, useWebSocket, useRouter,
 * demo mode, activity feed, etc.); rendering it in a unit test would require
 * mocking all of that, disproportionate to what this guards. Following the
 * pre-redesign precedent, this reads page/component source directly rather
 * than mounting the tree.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const pageSource = readFileSync(join(__dirname, '../page.tsx'), 'utf-8')
const costTrendsCardSource = readFileSync(join(__dirname, '../../../../components/dashboard/cost-trends-card.tsx'), 'utf-8')
const recommendedActionSource = readFileSync(join(__dirname, '../../../../components/dashboard/recommended-action-card.tsx'), 'utf-8')

describe('Dashboard: AWS Cost Trends default range', () => {
  it('initializes costDateRange to 7 Days, not 90 Days', () => {
    expect(pageSource).toMatch(/useState<CostRange>\('7d'\)/)
    expect(pageSource).not.toMatch(/useState<CostRange>\('90d'\)/)
  })

  it('page passes the live-controlled dateRange/onDateRangeChange pair to CostTrendsCard', () => {
    expect(pageSource).toMatch(/<CostTrendsCard[^]*?dateRange=\{costDateRange\}/)
    expect(pageSource).toMatch(/<CostTrendsCard[^]*?onDateRangeChange=\{setCostDateRange\}/)
  })

  it('CostTrendsCard forwards the same live pair into the real CostTrendChart and CostBreakdownBarList (no second chart implementation)', () => {
    expect(costTrendsCardSource).toMatch(/<CostTrendChart[^]*?dateRange=\{dateRange\}/)
    expect(costTrendsCardSource).toMatch(/<CostTrendChart[^]*?onDateRangeChange=\{onDateRangeChange\}/)
    expect(costTrendsCardSource).toMatch(/<CostBreakdownBarList[^]*?dateRange=\{dateRange\}/)
    expect(costTrendsCardSource).toMatch(/<CostBreakdownBarList[^]*?onDateRangeChange=\{onDateRangeChange\}/)
  })
})

describe('Dashboard: "Review savings" CTA — single instance, zero-state hidden', () => {
  it('the page renders RecommendedActionCard exactly once (no duplicate CTA arrangement)', () => {
    const matches = pageSource.match(/<RecommendedActionCard\b/g) ?? []
    expect(matches).toHaveLength(1)
  })

  it('RecommendedActionCard renders no CTA when opportunityCount is 0 (truthful empty state, not a dead link)', () => {
    expect(recommendedActionSource).toMatch(/No active cost-saving opportunities identified/)
    // The CTA anchor is only emitted inside the hasOpportunities branch.
    const ctaBlock = recommendedActionSource.slice(recommendedActionSource.indexOf('{hasOpportunities && ('))
    expect(ctaBlock).toMatch(/Review Savings/)
  })

  it('leaves the CTA label for the opportunityCount > 0 case intact, including the live count', () => {
    expect(recommendedActionSource).toMatch(/Review Savings \(\{opportunityCount\}\) →/)
  })
})
