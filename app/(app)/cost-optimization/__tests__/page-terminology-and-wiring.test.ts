/**
 * Guards the Phase 3 production implementation of Cost Optimization against
 * regressing on two things the approved product contract explicitly called
 * out: (1) forbidden/required terminology, and (2) Resolve/Dismiss staying
 * real mutations rather than becoming mock/no-op buttons (as they briefly
 * were in the Phase 2 design-review prototype at
 * app/(app)/cost-optimization-mock/page.tsx, which this page must not
 * depend on).
 *
 * Follows the source-reading convention established in
 * app/(app)/dashboard/__tests__/dashboard-recommendation-summary.test.ts --
 * this page is wired to several live queries/mutations, so a full render
 * would require mocking react-query + multiple services, disproportionate
 * to what this guard needs to prove.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(__dirname, '../page.tsx'), 'utf-8')

describe('Cost Optimization page: forbidden terminology', () => {
  const forbidden = [
    'Savings Realized',
    'Actual Savings',
    'Guaranteed Savings',
    'Resources Audited',
    'Resources Optimized',
    'Fully Optimized',
    'fully optimized',
  ]

  it.each(forbidden)('never uses the phrase "%s"', (phrase) => {
    expect(source).not.toContain(phrase)
  })

  // "Critical" appears once, deliberately, in a footnote explaining that no
  // Critical tier exists in the schema (mirrors the same disclosure pattern
  // in app/(app)/costs/efficiency/page.tsx) -- the guard here is that it's
  // never used AS a severity value/label, not that the word is absent.
  it('never uses "Critical" as a severity bucket label or value', () => {
    expect(source).not.toMatch(/label:\s*['"]Critical['"]/)
    expect(source).not.toMatch(/severity:\s*['"]Critical['"]/)
    expect(source).not.toMatch(/key:\s*['"]critical['"]/)
  })
})

describe('Cost Optimization page: required terminology', () => {
  it('labels the KPIs with the approved wording', () => {
    expect(source).toMatch(/Active Opportunities/)
    expect(source).toMatch(/Estimated Monthly Savings/)
    expect(source).toMatch(/Estimated Annual Savings/)
    expect(source).toMatch(/Last Analysis/)
  })

  it('uses the exact required empty-state copy for a clean scan', () => {
    expect(source).toMatch(/No active cost-saving opportunities detected/)
  })

  it('discloses when the visible list is a subset of the true active count', () => {
    expect(source).toMatch(/Showing \$\{recommendations\.length\} of \$\{activeCount\}/)
  })

  it('states the "What DevControl checks" list is not exhaustive', () => {
    expect(source).toMatch(/not a complete list of every possible AWS cost optimization/)
  })

  it('carries a concise trust disclaimer distinguishing estimated from realized savings', () => {
    expect(source).toMatch(/estimated potential savings/i)
    expect(source).toMatch(/does not itself confirm/i)
  })
})

describe('Cost Optimization page: ceiling-basis savings are never presented as an ordinary estimate', () => {
  // A detector can disclose its savings figure as a ceiling (e.g. S3
  // lifecycle: assumes 100% of current Standard storage transitions, no
  // retrieval fees netted out -- see cost-optimization.service.ts's
  // savings_basis metadata). The card must say "Up to $X/mo", not present it
  // as a plain expected monthly saving.
  it('detects ceiling-basis recommendations from the metadata.savings_basis contract, not resourceType/issue guessing', () => {
    expect(source).toMatch(/rec\.metadata\?\.savings_basis/)
    expect(source).toMatch(/basis\.startsWith\(['"]ceiling['"]\)/)
  })

  it('renders ceiling-basis savings as "Up to $X/mo" rather than an unqualified figure', () => {
    expect(source).toMatch(/Up to \$\{formatSavings\(rec\.potentialSavings\)\}/)
  })

  it('discloses the ceiling nature of the figure near the amount, not just in the page-wide disclaimer', () => {
    expect(source).toMatch(/Estimated ceiling, not an expected saving/)
  })
})

describe('Cost Optimization page: severity breakdown stays schema-accurate', () => {
  it('only renders High/Medium/Low severity rows', () => {
    const severityBlock = source.slice(source.indexOf('Severity breakdown'), source.indexOf('What DevControl checks'))
    expect(severityBlock).toMatch(/'High'/)
    expect(severityBlock).toMatch(/'Medium'/)
    expect(severityBlock).toMatch(/'Low'/)
    expect(severityBlock).not.toMatch(/label:\s*['"]Critical['"]/)
  })

  it('derives severity counts from real stats, not a hardcoded object', () => {
    expect(source).toMatch(/bySeverity\.high/)
    expect(source).toMatch(/bySeverity\.medium/)
    expect(source).toMatch(/bySeverity\.low/)
    expect(source).not.toMatch(/bySeverity\s*=\s*\{\s*high:\s*\d/)
  })
})

describe('Cost Optimization page: Resolve/Dismiss remain real actions', () => {
  it('Resolve calls the real resolve mutation, not a mock toast', () => {
    expect(source).toMatch(/resolveMutation\.mutate\(rec\.id\)/)
    expect(source).toMatch(/mutationFn:\s*costRecommendationsService\.resolve/)
  })

  it('Dismiss calls the real dismiss mutation, not a mock toast', () => {
    expect(source).toMatch(/dismissMutation\.mutate\(rec\.id\)/)
    expect(source).toMatch(/mutationFn:\s*costRecommendationsService\.dismiss/)
  })

  it('does not import anything from the Phase 2 design-review prototype route', () => {
    expect(source).not.toMatch(/cost-optimization-mock/)
  })

  it('invalidates the server-derived stats query after Resolve/Dismiss/analyze, not just the list query', () => {
    expect(source).toMatch(/queryKey:\s*\['cost-recommendations-stats'\]/)
  })
})

describe('Cost Optimization page: real data sources, not client-side re-aggregation', () => {
  it('sources KPI totals from the stats endpoint', () => {
    expect(source).toMatch(/queryFn:\s*costRecommendationsService\.getStats/)
    expect(source).not.toMatch(/recommendations\.reduce\(/)
  })

  it('derives AWS-connection state from the real accounts endpoint', () => {
    expect(source).toMatch(/awsAccountsService\.getAccounts/)
  })

  it('derives analysis freshness from the real discovery-jobs endpoint', () => {
    expect(source).toMatch(/awsResourcesService\.getDiscoveryJobs/)
  })

  it('also sources the manual "Run cost analysis" run history, not just the scheduled discovery cron', () => {
    expect(source).toMatch(/costRecommendationsService\.getAnalysisRuns/)
  })
})

describe('Cost Optimization page: optimization checks come from the backend rule registry, not a hardcoded list', () => {
  it('no longer defines its own authoritative SCAN_CHECKS list', () => {
    expect(source).not.toMatch(/const SCAN_CHECKS/)
  })

  it('fetches the rule catalog from the real registry endpoint', () => {
    expect(source).toMatch(/queryFn:\s*costRecommendationsService\.getOptimizationRules/)
    expect(source).toMatch(/queryKey:\s*\['optimization-rules'\]/)
  })

  it('derives the "what DevControl checks" list from fetched rules, not a literal array', () => {
    expect(source).toMatch(/implementedRules\.map/)
  })

  it('never claims full/complete coverage of the registered rule catalog', () => {
    expect(source).not.toMatch(/30\/30/)
    expect(source).not.toMatch(/all 30/i)
    expect(source).not.toMatch(/fully optimized/i)
  })

  it('discloses coverage as a fraction of the registry total, not a fixed literal count', () => {
    expect(source).toMatch(/ruleCatalog\.summary\.implementedCount/)
    expect(source).toMatch(/ruleCatalog\.summary\.totalRules/)
  })
})

describe('Cost Optimization page: manual analysis is never mislabeled as scheduled discovery', () => {
  it('merges both sources through pickLatestAnalysis rather than assuming the discovery job is authoritative', () => {
    expect(source).toMatch(/pickLatestAnalysis\(/)
  })

  it('labels "Last Analysis" and the status banner by real source, not a hardcoded "via scheduled scan" caption', () => {
    expect(source).not.toMatch(/via scheduled scan/)
    expect(source).toMatch(/SOURCE_LABEL/)
    expect(source).toMatch(/scheduled:\s*'Scheduled analysis'/)
    expect(source).toMatch(/manual:\s*'Manual cost analysis'/)
  })

  it('refreshes the manual run history after a manual scan completes', () => {
    expect(source).toMatch(/queryKey:\s*\['cost-analysis-runs'\]/)
  })
})
