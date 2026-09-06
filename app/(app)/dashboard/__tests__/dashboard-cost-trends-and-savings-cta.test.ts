/**
 * Covers three Dashboard fixes:
 *  1. The AWS Cost Trends chart now defaults to 7 Days instead of 90 Days, so a
 *     historical spike doesn't flatten the y-axis for recent data.
 *  2. The "Review Savings (N) -> " CTA is hidden when there are zero
 *     recommendations, instead of always rendering as a full-weight primary
 *     button pointing at an empty list (redundant with the "No active
 *     cost-saving opportunities identified" banner already shown below it).
 *  3. When shown (count > 0), the CTA now renders directly below the
 *     "Recommended Action" card instead of in the page header, keeping it
 *     visually associated with the card it acts on.
 *
 * Dashboard is a ~1500-line component wired to many hooks/services (useAuth,
 * useWebSocket, useRouter, demo mode, AI insights, activity feed, etc.);
 * rendering it in a unit test would require mocking all of that, disproportionate
 * to what this fix needs to prove. Following the precedent in
 * dashboard-recommendation-summary.test.ts, this reads the page source directly
 * to guard the specific structural change, and CostTrendChart's own render
 * behavior is covered separately in components/dashboard/__tests__/cost-trend-chart.test.tsx.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(__dirname, '../page.tsx'), 'utf-8')

describe('Dashboard: AWS Cost Trends default range', () => {
  it('initializes costDateRange to 7 Days, not 90 Days', () => {
    expect(source).toMatch(
      /useState<'7d' \| '30d' \| '90d' \| '6mo' \| '1yr'>\('7d'\)/
    )
    expect(source).not.toMatch(
      /useState<'7d' \| '30d' \| '90d' \| '6mo' \| '1yr'>\('90d'\)/
    )
  })

  it('still passes the same live-controlled dateRange/onDateRangeChange pair to CostTrendChart (tabs stay switchable)', () => {
    expect(source).toMatch(/dateRange=\{costDateRange\}/)
    expect(source).toMatch(/onDateRangeChange=\{setCostDateRange\}/)
  })
})

describe('Dashboard: "Review Savings" CTA zero-state and position', () => {
  const headerRow = source.slice(
    source.indexOf('── HEADER ROW ──'),
    source.indexOf('── RISK ALERT BANNER ──')
  )
  const recommendedActionSection = source.slice(
    source.indexOf('── RECOMMENDED ACTION BANNER ──'),
    source.indexOf('── MAIN CONTENT ──')
  )

  it('no longer renders the CTA in the header row', () => {
    expect(headerRow).not.toMatch(/Review Savings/)
  })

  it('renders the CTA guarded by the same zero-count condition as before (hidden when count is 0)', () => {
    expect(recommendedActionSection).toMatch(/\{isAwsConnected && topRecs\.length > 0 && \(\s*<div className="flex justify-end mb-3">\s*<a href="\/cost-optimization"[^]*?Review Savings/)
  })

  it('leaves the CTA label/markup for the count > 0 case untouched', () => {
    expect(source).toMatch(/Review Savings \(\$\{topRecs\.length\}\) →/)
  })

  it('places the CTA after (below) the Recommended Action card, before the summary/main content', () => {
    const cardIndex = recommendedActionSection.indexOf('Review all')
    const ctaIndex = recommendedActionSection.indexOf('Review Savings')
    expect(cardIndex).toBeGreaterThan(-1)
    expect(ctaIndex).toBeGreaterThan(cardIndex)
  })
})
