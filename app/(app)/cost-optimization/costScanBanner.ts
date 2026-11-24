import type { CheckFailureReason, CostRunResult } from '@/lib/services/cost-recommendations.service'
import type { ScanBannerTone } from '@/components/ui/scan-status-banner'
import type { AnalysisSource } from './costOptimizationStatus'
import type { CostScanState } from './costScanState'

/**
 * Cost Optimization's scan strings. The page has ONE banner: the result of a
 * "Run cost analysis" run the current user started (founder-locked behaviour,
 * Nov 23, with the Stage A rulings 1-9). Scheduled runs never produce a
 * banner; their failures and gaps show on the "Last analysis" line instead.
 * Every number comes from the run's own record (CostRunResult); nothing here
 * is a literal count.
 */

export const SOURCE_LABEL: Record<AnalysisSource, string> = {
  scheduled: 'Scheduled analysis',
  manual: 'Manual cost analysis',
}

/**
 * The weekly summary email's partial-analysis sentence is pinned to this text
 * (connect-aws/__tests__/weekly-email-health-copy.test.ts). The page itself no
 * longer shows it: a run with gaps is the amber result banner or the Last
 * analysis line.
 */
export const PARTIAL_MESSAGE = "Some cost checks didn't complete, so these results may be incomplete."

export const STATUS_UNAVAILABLE_TITLE = "Couldn't load analysis status"
export const UNAVAILABLE = 'Unavailable'
export const STATS_UNAVAILABLE_NOTE = "Totals couldn't load. This doesn't mean there are no savings."
export const TRY_AGAIN = 'Try again'
export const DISMISS_BANNER = 'Dismiss'

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many)

// ── The result banner ──

export const RUN_RUNNING = 'Cost analysis running. This can take a few minutes.'
export const RESULT_COMPLETE_TITLE = 'Cost analysis complete'
export const RESULT_GAPS_TITLE = 'Cost analysis completed with gaps'
export const RESULT_FAILED_TITLE = "Cost analysis didn't finish"
export const GAPS_UP_TO_DATE = 'Findings from the completed checks are up to date.'
/** Founder ruling 4: only for a failure known to happen before anything was written (the server says which). */
export const FINDINGS_UNCHANGED = "Your existing findings haven't changed."
export const RESULT_FAILED_FALLBACK = "The analysis didn't complete."
export const NO_NEW_OPPORTUNITIES = 'No new opportunities'
export const NO_OPPORTUNITIES_FOUND = 'No opportunities found'

/** Founder ruling 3. */
export const FAILURE_REASON_TEXT: Record<CheckFailureReason, string> = {
  permissions: 'missing permissions',
  rate_limited: 'AWS rate limiting',
  timeout: 'a timeout',
  too_many_resources: 'too many resources to list',
  error: 'an unexpected error',
}
const REASON_ORDER: readonly CheckFailureReason[] = ['permissions', 'rate_limited', 'timeout', 'too_many_resources', 'error']

export const seeNewOpportunities = (count: number) => `See the new ${plural(count, 'opportunity', 'opportunities')}`

/** "EC2, EBS and RDS": commas, so the names don't run into the sub-line's " · " parts. */
export function serviceList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** "<M> checks run across EC2, EBS and RDS" (no "across" when no service is known). */
export function checksRunPart(checks: number, services: readonly string[]): string {
  const run = `${checks} check${plural(checks, '', 's')} run`
  return services.length > 0 ? `${run} across ${serviceList(services)}` : run
}

/**
 * Founder ruling 2: one clause per reason, largest count first, at most two,
 * then "and other reasons". `failed` is the run's failed-check count (for a
 * run recorded before reasons existed, the only thing known).
 */
export function couldntRunSentence(failedChecks: CostRunResult['failedChecks'], failed: number): string {
  const groups = [...failedChecks]
    .filter((group) => group.count > 0)
    .sort((a, b) => b.count - a.count || REASON_ORDER.indexOf(a.reason) - REASON_ORDER.indexOf(b.reason))
  const lead = (count: number) => `${count} check${plural(count, '', 's')} couldn't run`
  if (groups.length === 0) return `${lead(failed)}.`
  const [first, second] = groups
  const firstClause = `${lead(first.count)} because of ${FAILURE_REASON_TEXT[first.reason]}`
  if (groups.length === 1) return `${firstClause}.`
  const secondClause = `${second.count} because of ${FAILURE_REASON_TEXT[second.reason]}`
  if (groups.length === 2) return `${firstClause} and ${secondClause}.`
  return `${firstClause}, ${secondClause}, and other reasons.`
}

/** Founder ruling 9: the banner has its own Try again button, so the reason's trailing "Try again." goes (banner only). */
export function withoutTrailingTryAgain(message: string): string {
  return message.replace(/\s*(Try again|Run it again)\.\s*$/, '').trim()
}

export interface ResultBannerContent {
  tone: ScanBannerTone
  title: string
  description: string
  /** "See the new opportunity" / "…opportunities": scrolls to Opportunities. */
  link?: string
  /** Try again: starts a new manual run. */
  retry?: boolean
}

/** The finished run's banner: green, amber or red, from the run's own results (never hard-coded counts). */
export function resultBannerContent(result: CostRunResult): ResultBannerContent {
  if (result.state === 'failed' || result.state === 'interrupted') {
    const reason = withoutTrailingTryAgain(result.message || RESULT_FAILED_FALLBACK)
    const sentence = /[.!?]$/.test(reason) ? reason : `${reason}.`
    return {
      tone: 'danger',
      title: RESULT_FAILED_TITLE,
      description: result.findingsUnchanged ? `${sentence} ${FINDINGS_UNCHANGED}` : sentence,
      retry: true,
    }
  }
  if (result.state === 'partial') {
    const failed = Math.max(0, result.checksTotal - result.checksRan)
    return {
      tone: 'warning',
      title: RESULT_GAPS_TITLE,
      description: `${result.checksRan} of ${result.checksTotal} check${plural(result.checksTotal, '', 's')} ran. ${couldntRunSentence(result.failedChecks, failed)} ${GAPS_UP_TO_DATE}`,
    }
  }
  // completed (every check ran). A count the run didn't record is left out, never shown as 0.
  const parts = [checksRunPart(result.checksRan, result.services)]
  const { newCount, stillOpen, openCount } = result
  if (newCount !== null && newCount > 0) {
    parts.push(`${newCount} new opportunit${plural(newCount, 'y', 'ies')} found`)
    if (stillOpen !== null && stillOpen > 0) parts.push(`${stillOpen} still open from earlier`)
  } else if (newCount === 0) {
    if (openCount === 0) parts.push(NO_OPPORTUNITIES_FOUND)
    else {
      parts.push(NO_NEW_OPPORTUNITIES)
      if (stillOpen !== null && stillOpen > 0) parts.push(`${stillOpen} still open from earlier`)
    }
  }
  return {
    tone: 'success',
    title: RESULT_COMPLETE_TITLE,
    description: parts.join(' · '),
    ...(newCount !== null && newCount > 0 ? { link: seeNewOpportunities(newCount) } : {}),
  }
}

// ── The "Last analysis" line (founder ruling 1a): a scheduled run's failure or gaps, never a banner ──

/** "· 2 checks couldn't run" for a run with gaps, "· didn't finish" for a failed or interrupted one; null otherwise. */
export function lastAnalysisProblem(scan: Pick<CostScanState, 'key' | 'failedChecks'>): string | null {
  if (scan.key === 'failed' || scan.key === 'interrupted') return "didn't finish"
  if (scan.key === 'partial') {
    const n = scan.failedChecks
    return n !== null && n > 0 ? `${n} check${plural(n, '', 's')} couldn't run` : "some checks couldn't run"
  }
  return null
}

// ── The Run cost analysis button (item 5) ──
export const RUN_COST_ANALYSIS = 'Run cost analysis'
export const RUNNING_ANALYSIS = 'Running analysis…'
