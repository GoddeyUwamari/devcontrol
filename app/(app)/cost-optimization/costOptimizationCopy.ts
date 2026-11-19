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
 * found nothing new. The second sentence only when there are resolved or
 * dismissed findings below to point to.
 */
export function emptyAllChecks(checks: number, hasDecided: boolean): string {
  // "listed under What DevControl checks" (founder ruling 5): true on a phone, where the rail sits below.
  const first = `The latest analysis ran all ${checks} active check${plural(checks, '', 's')} (listed under What DevControl checks) and found nothing new.`
  return hasDecided ? `${first} Findings you resolved or dismissed are below.` : first
}

/** The legacy (7b) caveat's second sentence: the checks are now listed in the rail, not below the card. */
export const LEGACY_CHECKS_CAVEAT = 'This list does not confirm that nothing can be saved: DevControl does not yet record whether each listed check completed with enough data.'

export const HOW_EACH_CHECK_WORKS = 'How each check works'

export const activeChecksNote = (count: number) =>
  `${count} active check${plural(count, '', 's')} today — not every possible AWS cost optimization.`

/** `services`: the AWS services with at least one active check. */
export const coverageLine = (active: number, total: number, services: number) =>
  `${active} of ${total} checks active across ${services} AWS service${plural(services, '', 's')}.`

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
