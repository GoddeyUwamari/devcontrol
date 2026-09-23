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

  it('the Infrastructure Health primary KPI card is the only consumer of displayedHealthScore -- Infrastructure Intelligence no longer duplicates it in its own "Overall Health" card', () => {
    const kpiMatch = pageSource.match(/label="Infrastructure Health"[^]*?value=\{displayedHealthScore === null/)
    expect(kpiMatch).not.toBeNull()
    expect(pageSource).not.toMatch(/overallHealth=\{\{ score: displayedHealthScore/)
    expect(infrastructureIntelligenceSource).not.toMatch(/label="Overall Health"/)
  })
})

describe('Infrastructure Intelligence: Overall Health / Cloud Spend duplication removed, System Status links to Monitoring', () => {
  it('no longer renders Overall Health or Cloud Spend cards (they duplicated the primary KPI row above)', () => {
    expect(infrastructureIntelligenceSource).not.toMatch(/label="Overall Health"/)
    expect(infrastructureIntelligenceSource).not.toMatch(/label="Cloud Spend"/)
    expect(infrastructureIntelligenceSource).not.toMatch(/overallHealth:/)
    expect(infrastructureIntelligenceSource).not.toMatch(/cloudSpend:/)
  })

  it('keeps Top Risk and System Status', () => {
    expect(infrastructureIntelligenceSource).toMatch(/label="Top Risk"/)
    expect(infrastructureIntelligenceSource).toMatch(/label="System Status"/)
  })

  it('System Status routes to /admin/monitoring via next/link (not a bare <a>, not an unrelated destination), independent of any other card\'s data', () => {
    expect(infrastructureIntelligenceSource).toMatch(/import Link from 'next\/link'/)
    expect(infrastructureIntelligenceSource).toMatch(/label="System Status"[^]*?href="\/admin\/monitoring"/)
    expect(infrastructureIntelligenceSource).not.toMatch(/<a\b/)
  })

  it('System Status no longer targets /observability -- no page exists there (live 404); /observability/* only has alerts and alert-history', () => {
    expect(infrastructureIntelligenceSource).not.toMatch(/href=["'`]\/observability["'`]/)
  })

  it('the section header still has no "View details" link -- Top Risk (AI-derived, cross-cutting) + System Status still has no single representative page', () => {
    expect(infrastructureIntelligenceSource).not.toMatch(/detailsHref\??:/)
    expect(infrastructureIntelligenceSource).not.toMatch(/href=\{?["'`]\/observability\/alerts/)
  })
})

describe('Currency formatting: precise 2-decimal display', () => {
  it('Monthly Spend uses the precise Intl.NumberFormat currency formatter, not a rounding .toLocaleString()', () => {
    expect(pageSource).toMatch(/const currencyFormatter = new Intl\.NumberFormat\('en-US', \{ style: 'currency', currency: 'USD' \}\)/)
    expect(pageSource).toMatch(/currencyFormatter\.format\(currentSpend\)/)
  })

  it('no longer uses a bare toLocaleString() for the currency display (which drops cents/rounds)', () => {
    expect(pageSource).not.toMatch(/\$\{currentSpend\.toLocaleString\(\)\}/)
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

  it('does not render the "Connected" caption text under the AWS tile (the hero pill is the single source of truth for that text)', () => {
    expect(cloudProviderStatusSource).toMatch(/const visibleCaption = provider\.variant === 'connected' \? '' : caption/)
  })
})

describe('Primary KPI row: all three cards link to their detail pages', () => {
  it('Monthly Spend links to /costs, Security Health links to /security, Infrastructure Health links to /infrastructure', () => {
    expect(pageSource).toMatch(/label="Monthly Spend"[^]*?href="\/costs"/)
    expect(pageSource).toMatch(/label="Security Health"[^]*?href="\/security"/)
    expect(pageSource).toMatch(/label="Infrastructure Health"[^]*?href="\/infrastructure"/)
  })
})

describe('Infrastructure Health badge: canonical System Intelligence status, not a local tier', () => {
  it('reads the badge label from systemIntelligence.status (demo keeps its fixed Healthy)', () => {
    expect(pageSource).toMatch(/const displayedHealthStatus = isDemoActive \? 'Healthy' : \(systemIntelligence\?\.status \?\? null\)/)
    for (const status of ['Healthy', 'Stable', 'Degraded', 'At Risk']) {
      expect(pageSource).toMatch(new RegExp(`displayedHealthStatus === '${status}' \\? \\{ label: '${status}'`))
    }
  })

  it('the old locally-invented thresholds and "Monitor" / "Needs attention" wording are gone', () => {
    expect(pageSource).not.toMatch(/displayedHealthScore >= 80/)
    expect(pageSource).not.toMatch(/displayedHealthScore >= 60/)
    expect(pageSource).not.toMatch(/label: 'Monitor'/)
    expect(pageSource).not.toMatch(/label: 'Needs attention'/)
  })

  it('the KPI value itself is still the canonical system_score (Tier 0 source unchanged)', () => {
    expect(pageSource).toMatch(/const displayedHealthScore = isDemoActive \? 87 : \(systemIntelligence\?\.system_score \?\? null\)/)
    expect(pageSource).toMatch(/trend=\{infraHealthBadge \? \{ direction: infraHealthBadge\.direction, label: infraHealthBadge\.label, color: infraHealthBadge\.color \} : undefined\}/)
  })
})

describe('Recent Activity: unchanged -- no destination exists for "View more"', () => {
  it('has no link, "View more", or "View all" affordance', () => {
    expect(recentActivityCardSource).not.toMatch(/<a\b|href=|View more|View all/)
  })
})

describe('Cost-Saving Opportunities dashboard summary: signal-only, capped, with a real empty state', () => {
  it('once evaluated, only shows categories with an active recommendation (count > 0), capped at 3, never re-defining "real signal" as potential_savings > 0', () => {
    expect(pageSource).toMatch(/opportunityEvaluationState === 'evaluated'\s*\?\s*\[\.\.\.opportunityCategories\]\.filter\(\(cat\) => cat\.count > 0\)/)
    expect(pageSource).toMatch(/\.slice\(0, 3\)/)
    expect(pageSource).not.toMatch(/filter\(\(cat\) => cat\.savingsLabel/)
  })

  it('before a scan completes, the full unfiltered category list is kept (not collapsed to zero cards)', () => {
    expect(pageSource).toMatch(/const dashboardOpportunityCategories = opportunityEvaluationState === 'evaluated'[^]*?: opportunityCategories/)
  })

  it('SavingsOpportunities renders a truthful empty state only when evaluated AND zero categories have signal -- never merely because the visible list is short', () => {
    expect(savingsOpportunitiesSource).toMatch(/const showEmptyState = evaluationState === 'evaluated' && items\.length === 0/)
    expect(savingsOpportunitiesSource).toMatch(/No active cost-saving opportunities identified/)
  })

  it('the summary grid scales its column count with however many cards are actually shown, instead of always reserving a fixed 4-wide layout', () => {
    expect(savingsOpportunitiesSource).toMatch(/GRID_COLS_BY_COUNT/)
    expect(savingsOpportunitiesSource).not.toMatch(/grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4/)
  })

  it('"View all (N)" is never re-derived from the (possibly filtered) visible items -- it stays wired to the page\'s single authoritative totalActiveCount prop', () => {
    expect(pageSource).toMatch(/<SavingsOpportunities[^]*?items=\{dashboardOpportunityCategories\}/)
    expect(pageSource).toMatch(/<SavingsOpportunities[^]*?totalActiveCount=\{activeOpportunityCount\}/)
  })
})
