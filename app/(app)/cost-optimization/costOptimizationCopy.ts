/**
 * The Cost Optimization tidy's page strings (founder-approved mock, Nov 19).
 * Every count is passed in from the data (/stats, /hidden, the latest run, the
 * Optimization Rule Registry); nothing here is a literal number.
 * The banner's strings live in costScanBanner.ts, the hidden findings' in
 * hiddenFindingsCopy.ts.
 */

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many)

/** Under the Active opportunities KPI when some resolved findings are still detected. */
export const stillDetectedKpiNote = (count: number) => `+ ${count} still detected (below)`

/**
 * The empty state (nothing open) after a run that completed every check and
 * found nothing new (light-lane layout, founder ruling 5, Nov 20). Replaces
 * the tidy's emptyAllChecks; shown only under the same condition.
 */
export const NOTHING_TO_ACT_ON = 'Nothing to act on right now'
export const nothingToActOnBody = (checks: number) =>
  `Your resources passed all ${checks} active check${plural(checks, '', 's')} in the last analysis. DevControl runs the checks again on a schedule and lists anything new here.`
/**
 * The same empty state when the run couldn't fully check some resources (C2, founder ruling 2, Nov 24):
 * "passed all N active checks" would not be true, so it says what was and wasn't checked, then keeps the
 * schedule sentence (founder ruling, Nov 24). `unchecked` is the run record's unknown_resource_count.
 */
export const nothingFoundSomeUncheckedBody = (unchecked: number) =>
  `No opportunities found in the resources DevControl could check. ${unchecked} resource${plural(unchecked, '', 's')} couldn't be fully checked. DevControl runs the checks again on a schedule and lists anything new here.`
export const SEE_WHATS_CHECKED = "See what's checked"
export const VIEW_COSTS = 'View costs →'

// ── Light-lane layout (Nov 20): header, summary cards, opportunities, Summary, How DevControl checks ──

/** The header's "Last analysis …" line: the run's source in brackets. */
export const LAST_ANALYSIS = 'Last analysis'
export const LAST_ANALYSIS_SOURCE: Record<'scheduled' | 'manual', string> = { scheduled: 'scheduled', manual: 'manual' }

export const OPEN_OPPORTUNITIES = 'Open opportunities'
export const ESTIMATED_MONTHLY_SAVINGS = 'Estimated monthly savings'
export const COVERAGE = 'Coverage'

/**
 * The Coverage card (scan result banner PR, founder-locked Nov 23): "AWS cost optimization · 11 active checks",
 * with the live services underneath. Both computed from the Optimization Rule Registry; the catalog's
 * total (planned rules included) is never shown.
 */
export const COVERAGE_SCOPE = 'AWS cost optimization'
export const coverageCardLine = (active: number) => `${COVERAGE_SCOPE} · ${active} active check${plural(active, '', 's')}`
/** The services under it, by display name: "EC2 · EBS · RDS · S3 · Lambda · DynamoDB". */
export const serviceNamesLine = (names: readonly string[]) => names.join(' · ')

/** The savings card when every open figure is an upper bound (founder ruling 4): never a firm total. */
export const upperBoundOnly = (amount: string) => `Up to ${amount}/mo · upper bound only`
export const NO_FIRM_ESTIMATE = 'No firm estimate yet.'

export const opportunitiesHeading = (count: number) => `Opportunities (${count})`
export const ALL = 'All'
export const SEVERITY_FILTER_LABEL = 'Filter opportunities by severity'
/** `severity` is the chip's label: "High", "Medium" or "Low". */
export const noFilterMatches = (severity: string) => `No ${severity}-severity opportunities in this list.`

/** An opportunity card's savings line for an upper bound (beside "Up to $X/mo"). */
export const UPPER_BOUND = 'upper bound'
export const found = (date: string) => `Found ${date}`

export const SUMMARY = 'Summary'
/** Summary bullet: open findings by severity, all from /stats. */
export function summaryOpen(open: number, high: number, medium: number, low: number): string {
  if (open === 0) return 'No open opportunities.'
  return `${open} open opportunit${plural(open, 'y', 'ies')}: ${high} High, ${medium} Medium, ${low} Low.`
}
/** Summary bullet: the firm total, with any upper bound kept apart from it. */
export function summaryFirmSavings(firm: string, ceiling: string | null): string {
  const first = `${firm}/mo in firm estimates.`
  return ceiling ? `${first} Up to ${ceiling}/mo more is an upper bound only, not included.` : first
}
export const summaryUpperBoundOnly = (ceiling: string) => `No firm estimate yet. Up to ${ceiling}/mo is an upper bound only.`
export const SUMMARY_NO_ESTIMATE = 'No dollar estimate yet for the open opportunities.'
/** Summary bullet: the latest run's new_count (scan.counts.new). */
export const summaryNew = (count: number) => (count === 0 ? 'Nothing new since the last analysis.' : `${count} new since the last analysis.`)

export const HOW_DEVCONTROL_CHECKS = 'How DevControl checks'
export const NO_CRITICAL_TIER = 'Only High/Medium/Low severities are currently supported — there is no Critical tier in the underlying data.'

/** The legacy (7b) caveat's second sentence: the checks are now listed in the rail, not below the card. */
export const LEGACY_CHECKS_CAVEAT = 'This list does not confirm that nothing can be saved: DevControl does not yet record whether each listed check completed with enough data.'

export const HOW_EACH_CHECK_WORKS = 'How each check works'

export const activeChecksNote = (count: number) =>
  `${count} active check${plural(count, '', 's')} today — not every possible AWS cost optimization.`

/** Founder ruling 6 (Stage A Q6 text): "11 active checks across EC2 · EBS · … ." (`names`: the services with an active check). */
export const coverageLine = (active: number, names: readonly string[]) =>
  `${active} active check${plural(active, '', 's')} across ${serviceNamesLine(names)}.`

export const plannedToggle = (count: number) => `Planned / Coming soon (${count})`

/**
 * Multi-region flag-on prep N6 (founder, Nov 19): where the cost checks run, for an organization with
 * multi-region scanning switched on (`multi_region` in the coverage response) only; null otherwise,
 * so a switched-off page is unchanged. The region is the server's `multi_region.savings_regions`
 * (the home region, docs/SERVICES_COVERAGE_MULTI_REGION.md §11), never a literal. S3 lifecycle reads
 * each bucket in its own region (cost-optimization.service.ts detectS3LifecycleOptimization).
 */
export function costChecksRegionLine(multiRegion: { savings_regions: readonly string[] } | null | undefined): string | null {
  const home = multiRegion?.savings_regions?.[0]
  return home ? `Cost checks run in your home region, ${home}. S3 lifecycle checks cover buckets in every region.` : null
}
