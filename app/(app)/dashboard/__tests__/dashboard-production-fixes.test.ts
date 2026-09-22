/**
 * Focused coverage for the production-review fix pass: authoritative
 * opportunity count reconciliation, EC2/EBS/RDS/S3 category truthfulness,
 * evaluated-zero vs not-yet-evaluated wording, Top Risk duplicate-text
 * prevention, precise currency formatting, and provider tile state
 * presentation.
 *
 * Same source-reading approach as the sibling dashboard test files (see
 * their own doc comments for why): Dashboard/these components are wired to
 * many hooks/services, so mounting the full tree is disproportionate to
 * what these fixes need proven. These are structural regression guards.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const pageSource = readFileSync(join(__dirname, '../page.tsx'), 'utf-8')
const savingsOpportunitiesSource = readFileSync(join(__dirname, '../../../../components/dashboard/savings-opportunities.tsx'), 'utf-8')
const infrastructureIntelligenceSource = readFileSync(join(__dirname, '../../../../components/dashboard/infrastructure-intelligence.tsx'), 'utf-8')
const cloudProviderStatusSource = readFileSync(join(__dirname, '../../../../components/dashboard/cloud-provider-status.tsx'), 'utf-8')
const recentActivityCardSource = readFileSync(join(__dirname, '../../../../components/dashboard/recent-activity-card.tsx'), 'utf-8')

describe('Cost-saving opportunity reconciliation', () => {
  it('uses ONE authoritative count (costRecStats.activeRecommendations) for the opportunity total, not topRecs.length as a population proxy', () => {
    expect(pageSource).toMatch(/const activeOpportunityCount = isDemoActive \? topRecs\.length : \(costRecStats\?\.activeRecommendations \?\? topRecs\.length\)/)
  })

  it('RecommendedActionCard and SavingsOpportunities both receive the same authoritative count, not two independently-derived numbers', () => {
    expect(pageSource).toMatch(/<RecommendedActionCard[^]*?opportunityCount=\{activeOpportunityCount\}/)
    expect(pageSource).toMatch(/<SavingsOpportunities[^]*?totalActiveCount=\{activeOpportunityCount\}/)
  })

  it('supports EC2, EBS, RDS, and S3 as real categories, all derived from costRecsRaw filtering (none hardcoded as permanently unsupported)', () => {
    expect(pageSource).toMatch(/OPPORTUNITY_CATEGORIES[^]*?type: 'EC2'[^]*?type: 'EBS'[^]*?type: 'RDS'[^]*?type: 'S3'/)
    expect(pageSource).toMatch(/OPPORTUNITY_CATEGORIES\.map\(\(cat\) => \{[^]*?costRecsRaw\.filter\(\(r\) => r\.resourceType === cat\.type\)/)
  })

  it('the category list is structured as data (not one hand-written variable per type), so a new supported type is a one-line addition', () => {
    // A per-type variable pattern (ec2Opportunities/ebsOpportunities/...) would
    // indicate the old, non-extensible structure has regressed back in.
    expect(pageSource).not.toMatch(/const ec2Opportunities\s*=/)
    expect(pageSource).not.toMatch(/const ebsOpportunities\s*=/)
    expect(pageSource).not.toMatch(/const rdsOpportunities\s*=/)
  })

  it('evaluation state is derived from cost_analysis_runs (a completed run), not merely from a zero filtered count', () => {
    expect(pageSource).toMatch(/analysisRuns\?\.some\(\(r\) => r\.status === 'completed'\)/)
    expect(pageSource).toMatch(/opportunityEvaluationState/)
  })

  it('SavingsOpportunities only ever shows "Not currently evaluated" when evaluationState is not_evaluated, never merely because a category count is 0', () => {
    expect(savingsOpportunitiesSource).toMatch(/not_evaluated:\s*'Not currently evaluated'/)
    // The truthful-zero render path must be reachable independently of count.
    expect(savingsOpportunitiesSource).toMatch(/evaluationState === 'evaluated'[^]*?countPhrase\(count\)/)
  })

  it('a genuinely evaluated, zero-result category renders a real zero ("0 detected"), not the unevaluated message', () => {
    expect(savingsOpportunitiesSource).toMatch(/function countPhrase\(count: number\): string \{\s*if \(count === 0\) return '0 detected'/)
  })

  it('"View all (N)" reads the same authoritative totalActiveCount prop, never re-summing only the 4 known categories', () => {
    expect(savingsOpportunitiesSource).not.toMatch(/items\.reduce\(/)
    expect(savingsOpportunitiesSource).toMatch(/View all \(\{totalActiveCount\}\)/)
  })
})

describe('Top Risk: no duplicated sentence', () => {
  it('splits headline from a genuinely distinct remainder, and omits the description when there is none (never repeats topRisk verbatim in both slots)', () => {
    expect(infrastructureIntelligenceSource).toMatch(/function splitRiskText/)
    expect(infrastructureIntelligenceSource).not.toMatch(/description=\{\s*topRisk \?\? '/)
  })
})

describe('Security score: historical activity framing', () => {
  it('score-type activity events are labeled as a historical snapshot, distinct from the live current-score KPI', () => {
    expect(recentActivityCardSource).toMatch(/event\.type === 'score' \? 'Historical snapshot'/)
  })

  it('does not alter the real message or timestamp fields -- only the subtitle framing', () => {
    expect(recentActivityCardSource).toMatch(/\{event\.message\}/)
    expect(recentActivityCardSource).toMatch(/formatDistanceToNow\(new Date\(event\.timestamp\)/)
  })
})

describe('Overall Health / Infrastructure Health: canonical System Intelligence source, no client-side alternate scoring', () => {
  it('sources the KPI from useSystemIntelligence (the same canonical, cached System Intelligence result the Infrastructure page reads), not from the AI-summary narrative', () => {
    expect(pageSource).toMatch(/import \{ useSystemIntelligence \} from '@\/lib\/hooks\/useSystemIntelligence'/)
    expect(pageSource).toMatch(/const \{ data: systemIntelligence \} = useSystemIntelligence\(organization\?\.id, !isDemoActive\)/)
    expect(pageSource).toMatch(/const displayedHealthScore = isDemoActive \? 87 : \(systemIntelligence\?\.system_score \?\? null\)/)
  })

  it('never reads the LLM-mediated aiSummaryData.overallHealth.score as the KPI value', () => {
    expect(pageSource).not.toMatch(/displayedHealthScore[^\n]*aiSummaryData\?\.overallHealth/)
    expect(pageSource).not.toMatch(/const backendHealthScore/)
  })

  it('no client-side health averaging remains (cloudHealthScore / _healthComponents and their cost/security/reliability sub-score inputs are gone)', () => {
    expect(pageSource).not.toMatch(/cloudHealthScore/)
    expect(pageSource).not.toMatch(/_healthComponents/)
    expect(pageSource).not.toMatch(/const reliabilityScore/)
  })

  it('shows "Calculating…" rather than an invented score when the canonical System Intelligence result is unavailable', () => {
    expect(pageSource).toMatch(/value=\{displayedHealthScore === null \? 'Calculating…'/)
  })

  it('InfrastructureIntelligence.overallHealth (a required prop on that component, unmodified in this commit) still receives the canonical displayedHealthScore, with context explicitly null rather than a revived displayedHealthContext narrative', () => {
    expect(pageSource).toMatch(/overallHealth=\{\{ score: displayedHealthScore, context: null \}\}/)
    expect(pageSource).not.toMatch(/displayedHealthContext/)
  })
})

describe('Currency formatting: precise 2-decimal display', () => {
  it('Monthly Spend and Cloud Spend both use the precise Intl.NumberFormat currency formatter, not a rounding .toLocaleString()', () => {
    expect(pageSource).toMatch(/const currencyFormatter = new Intl\.NumberFormat\('en-US', \{ style: 'currency', currency: 'USD' \}\)/)
    expect(pageSource).toMatch(/currencyFormatter\.format\(currentSpend\)/)
    expect(infrastructureIntelligenceSource).toMatch(/const currencyFormatter = new Intl\.NumberFormat\('en-US', \{ style: 'currency', currency: 'USD' \}\)/)
    expect(infrastructureIntelligenceSource).toMatch(/currencyFormatter\.format\(cloudSpend\.amount\)/)
  })

  it('no longer uses a bare toLocaleString() for these currency displays (which drops cents/rounds)', () => {
    expect(pageSource).not.toMatch(/\$\{currentSpend\.toLocaleString\(\)\}/)
    expect(infrastructureIntelligenceSource).not.toMatch(/\$\{cloudSpend\.amount\.toLocaleString\(\)\}/)
  })
})

describe('Infrastructure Intelligence "View details": no misleading destination', () => {
  it('does not link to the narrower /observability/alerts page as if it represented the whole section', () => {
    expect(infrastructureIntelligenceSource).not.toMatch(/detailsHref\??:/)
    expect(infrastructureIntelligenceSource).not.toMatch(/href=\{?["'`]\/observability\/alerts/)
    expect(infrastructureIntelligenceSource).not.toMatch(/<a\b/)
  })
})

describe('Cloud provider tiles: reusable connected/unavailable variants', () => {
  it('defines exactly two reusable variants rather than one-off AWS-specific styling', () => {
    expect(cloudProviderStatusSource).toMatch(/type TileVariant = 'connected' \| 'unavailable'/)
    expect(cloudProviderStatusSource).toMatch(/const TILE_VARIANTS: Record<TileVariant/)
  })

  it('AWS state still comes from the real awsConnected prop; GCP/Azure remain hardcoded unavailable', () => {
    expect(cloudProviderStatusSource).toMatch(/variant: awsConnected \? 'connected' : 'unavailable'/)
    expect(cloudProviderStatusSource).toMatch(/\{ name: 'Google Cloud', short: 'GCP', variant: 'unavailable' \}/)
    expect(cloudProviderStatusSource).toMatch(/\{ name: 'Azure', short: 'Azure', variant: 'unavailable' \}/)
  })

  it('never renders "Connected" for GCP or Azure under any awsConnected value', () => {
    // The "Connected" caption is only reachable via variant === 'connected',
    // and GCP/Azure's variant is unconditionally 'unavailable' (confirmed
    // above), so they can never reach this branch regardless of awsConnected.
    expect(cloudProviderStatusSource).toMatch(/provider\.variant === 'connected' \? 'Connected'/)
  })

  it('label text uses solid --foreground/--text-secondary colors, never a colored label directly on a pale tint (the prior low-contrast treatment)', () => {
    expect(cloudProviderStatusSource).not.toMatch(/tileColor:\s*'#F59E0B'/)
    expect(cloudProviderStatusSource).toMatch(/labelColor: 'var\(--foreground\)'/)
  })
})
