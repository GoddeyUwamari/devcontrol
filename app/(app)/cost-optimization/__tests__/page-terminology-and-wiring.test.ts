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

// The page and its tidy copy module (costOptimizationCopy.ts) together: strings moved there in the tidy.
const source = readFileSync(join(__dirname, '../page.tsx'), 'utf-8') + readFileSync(join(__dirname, '../costOptimizationCopy.ts'), 'utf-8')
const bannerCopy = readFileSync(join(__dirname, '../costScanBanner.ts'), 'utf-8')
const scanState = readFileSync(join(__dirname, '../costScanState.ts'), 'utf-8')

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
  it('labels the summary cards and the header line with the approved wording (light-lane layout, Nov 20)', () => {
    expect(source).toMatch(/'Open opportunities'/)
    expect(source).toMatch(/'Estimated monthly savings'/)
    expect(source).toMatch(/export const COVERAGE = 'Coverage'/)
    // "Last analysis" moved from its own card into the header (founder ruling 2), still from the scan state.
    expect(source).toMatch(/'Last analysis'/)
    // The annual card was dropped (founder ruling 2).
    expect(source).not.toMatch(/Estimated Annual Savings/)
  })

  it('a completed scan with nothing active draws no "no opportunities" conclusion -- per-check outcomes are not recorded yet', () => {
    expect(source).not.toMatch(/No active cost-saving opportunities detected/)
    expect(source).not.toMatch(/No active opportunities identified/)
    expect(source).toMatch(/This list does not confirm that nothing can be saved/)
  })

  it('discloses when the visible list is a subset of the true active count', () => {
    expect(source).toMatch(/Showing \$\{recommendations\.length\} of \$\{activeCount\}/)
  })

  it('states the "What DevControl checks" list is not exhaustive', () => {
    // Tidy mock wording (Nov 19): "{n} active checks today — not every possible AWS cost optimization."
    expect(source).toMatch(/today — not every possible AWS cost optimization\./)
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
  it('detects ceiling-basis recommendations from the metadata.savings_basis contract (lib/savings-basis), not resourceType/issue guessing', () => {
    // "Never show $0": the one row rule (savingsFigure) and the shared total (describeSavingsTotal), both from lib/savings-basis.
    expect(source).toMatch(/import \{[^}]*\bdescribeSavingsTotal\b[^}]*\bformatSavingsFigure\b[^}]*\bsavingsFigure\b[^}]*\} from '@\/lib\/savings-basis'/)
    expect(source).toMatch(/savingsFigure\(rec\)\.kind === 'ceiling'/)
  })

  it('renders each card\'s figure through formatSavingsFigure ("Up to $X/mo" for a ceiling, "No dollar estimate" without a figure)', () => {
    // FP PR 2b: a low-activity finding's figure reads "$X/mo if it's no longer needed" (W3), with "Up to" only
    // when its basis isn't an estimate (round 4); every other card goes through formatSavingsFigure ("Never show $0").
    expect(source).toMatch(/const fig = savingsFigure\(rec\);/)
    expect(source).toMatch(/\{isLowActivityFinding\(rec\)\s*\? lowActivitySavingsHeadline\(fig, formatSavingsCurrency\)\s*: formatSavingsFigure\(fig, formatSavingsCurrency\)\}/)
    expect(source).not.toMatch(/formatSavings\(rec\.potentialSavings\)/)
  })

  it('FP PR 2b: the card title is displayIssue(rec) -- "Low-activity instance" only for the new rule\'s findings', () => {
    expect(source).toMatch(/\{displayIssue\(rec\) \|\| '—'\}/)
    expect(source).not.toMatch(/\{rec\.issue \|\| '—'\}/)
    expect(source).toMatch(/import \{[^}]*\bdisplayIssue\b[^}]*\bisLowActivityFinding\b[^}]*\} from '@\/lib\/finding-display'/)
  })

  it('the Estimated Monthly Savings KPI excludes ceilings and states each type\'s upper bound on its own line', () => {
    // describeSavingsTotal's firm kind carries describeCeilings' lines ("Never show $0" moved the rule to lib/savings-basis).
    expect(source).toMatch(/const savingsTotal = describeSavingsTotal\(statsAvailable \? stats : null, \{ partialRun: scan\.key === 'partial', format: formatWholeDollars \}\)/)
    expect(source).toMatch(/\{savingsTotal\.lines\.map\(\(line\) => \(/)
  })

  it('discloses the ceiling nature of the figure near the amount, not just in the page-wide disclaimer', () => {
    // Light-lane layout: "Up to $X/mo" with "upper bound" in grey right under it, on every ceiling card.
    expect(source).toMatch(/\{isSavingsCeiling\(rec\) && \(\s*<p className="text-label text-ink-muted font-medium">\{UPPER_BOUND\}<\/p>/)
    expect(source).toMatch(/export const UPPER_BOUND = 'upper bound'/)
  })
})

describe('Cost Optimization page: severity breakdown stays schema-accurate', () => {
  it('only renders High/Medium/Low severity rows', () => {
    // One list feeds the open card's chips, the filter chips and the checks header.
    const severityBlock = source.slice(source.indexOf('const SEVERITY_ROWS'), source.indexOf('const CHECKS_ANCHOR'))
    expect(severityBlock.length).toBeGreaterThan(0)
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
    expect(source).toMatch(/awsAccountsService\.getAccountsAndConnection/)
  })

  it('reads discovery jobs only for their warnings and the no-run-rows fallback, never their status or error text (decision 10)', () => {
    expect(source).toMatch(/awsResourcesService\.getDiscoveryJobs/)
    expect(source).toMatch(/DiscoveryWarningNotice warnings=\{discoveryJobs\?\.\[0\]\?\.warnings\}/)
    expect(source).not.toMatch(/error_message/)
    expect(scanState).not.toMatch(/\bj(ob)?\.error_message/)
    expect(scanState).not.toMatch(/j(ob)?\.status === 'failed'\s*\?/)
  })

  it('sources scan status from every cost analysis run, manual and scheduled, under its own key', () => {
    expect(source).toMatch(/costRecommendationsService\.getAnalysisRuns\(5, 'all'\)/)
    expect(source).toMatch(/queryKey: \['cost-analysis-runs', 'all', 5\]/)
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
  it('derives the scan state from cost analysis runs (deriveCostScanState), not by merging in the discovery job', () => {
    expect(source).toMatch(/deriveCostScanState\(/)
    expect(source).not.toMatch(/pickLatestAnalysis\(/)
  })

  it('labels "Last Analysis" and the status banner by real source, not a hardcoded "via scheduled scan" caption', () => {
    expect(source).not.toMatch(/via scheduled scan/)
    expect(source).toMatch(/SOURCE_LABEL/)
    expect(bannerCopy).toMatch(/scheduled:\s*'Scheduled analysis'/)
    expect(bannerCopy).toMatch(/manual:\s*'Manual cost analysis'/)
  })

  it('refreshes the manual run history after a manual scan completes', () => {
    expect(source).toMatch(/queryKey:\s*\['cost-analysis-runs'\]/)
  })
})
