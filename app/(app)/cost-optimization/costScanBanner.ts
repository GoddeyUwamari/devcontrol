import type { LucideIcon } from 'lucide-react'
import { AlertTriangle, CheckCircle2, CloudOff, Clock, Info } from 'lucide-react'
import type { AnalysisResult } from '@/lib/types'
import type { ScanBannerTone } from '@/components/ui/scan-status-banner'
import type { AnalysisSource } from './costOptimizationStatus'
import type { CostScanCounts, CostScanState } from './costScanState'

/**
 * Every banner and toast string for the Cost Optimization scan state, exactly
 * as approved by the founder on 2026-11-02 (pr2-step1.md §1c and §1g), with
 * PR 3's C1-C5 (pr3-step1.md §5.3, founder decisions 2026-11-03) replacing
 * the hidden-finding wording.
 */

export const SOURCE_LABEL: Record<AnalysisSource, string> = {
  scheduled: 'Scheduled analysis',
  manual: 'Manual cost analysis',
}

// Approved in PR 1 (step2-plan.md), used here exactly.
export const PARTIAL_MESSAGE = "Some cost checks didn't complete, so these results may be incomplete."
export const INTERRUPTED_MESSAGE = 'The analysis was interrupted before it finished. Run it again.'

export const FAILED_FALLBACK = 'The most recent analysis did not complete.'
export const STATUS_UNAVAILABLE_TITLE = "Couldn't load analysis status"
export const STATUS_UNAVAILABLE_DESCRIPTION = "This doesn't mean nothing was found. Try again."
export const UNAVAILABLE = 'Unavailable'
export const STATS_UNAVAILABLE_NOTE = "Totals couldn't load. This doesn't mean there are no savings."
export const TRY_AGAIN = 'Try again'

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many)

export function newFound(count: number): string {
  return `${count} new opportunit${plural(count, 'y', 'ies')} found.`
}

/** Sentence R. */
export function stillOpen(count: number): string {
  return `${count} found earlier ${plural(count, 'is', 'are')} still open.`
}

/** C2: resolved findings the run found again (omitted when 0). */
export function resolvedFoundAgain(count: number): string | null {
  if (count <= 0) return null
  return `${count} finding${plural(count, '', 's')} you resolved ${plural(count, 'was', 'were')} found again.`
}

/** C3: dismissed findings the run found again (omitted when 0). */
export function dismissedFoundAgain(count: number): string | null {
  if (count <= 0) return null
  return `${count} finding${plural(count, '', 's')} you dismissed ${plural(count, 'was', 'were')} found again and ${plural(count, 'is', 'are')} still hidden.`
}

/**
 * C4 (replaces sentence H): C2 and/or C3, each only when its count isn't 0.
 * `resolved` is /hidden's still-detected count, never the run's own
 * suppressed_resolved_count (the truth fix below).
 */
export function hiddenFoundAgain(resolved: number, dismissed: number): string | null {
  return join(resolvedFoundAgain(resolved), dismissedFoundAgain(dismissed)) || null
}

function join(...sentences: (string | false | null | undefined)[]): string {
  return sentences.filter(Boolean).join(' ')
}

/** Sub-line parts, GitHub-banner style: "a · b". */
function parts(...items: (string | false | null | undefined)[]): string {
  return items.filter(Boolean).join(' · ')
}

/**
 * The banner's sub-line names the run this way (tidy mock): "Scheduled
 * analysis, about 2 hours ago" or "Analysis you ran, 5 minutes ago". The Last
 * analysis card keeps SOURCE_LABEL.
 */
export const BANNER_SOURCE_LABEL: Record<AnalysisSource, string> = {
  scheduled: 'Scheduled analysis',
  manual: 'Analysis you ran',
}

// Tidy mock (founder-approved, Nov 19).
export const NOTHING_NEW_TITLE = 'Analysis complete · nothing new to review.'
export const allChecksRan = (count: number) => `all ${count} active check${plural(count, '', 's')} ran`
export const foundAgainTitle = (count: number) => `Analysis complete · ${resolvedFoundAgain(count)}`
export const NOTHING_NEW_BESIDES = 'nothing new besides this'
export const REVIEW_IT = 'Review it'
export const DISMISS_BANNER = 'Dismiss'

/**
 * What the page knows beyond the run itself. A resolved finding "found again"
 * is /hidden's judgement only (detection.state = still_detected, summed in
 * summary.stillDetected.count): the same number the Still detected group
 * shows, so the banner, the group and C12 never give one finding two states.
 */
export interface BannerContext {
  hidden: { stillDetected: number; notConfirmed: number } | 'loading' | 'error'
  /** Open (ACTIVE) findings, from /stats. */
  open: number | 'loading' | 'error'
}

export const UNKNOWN_CONTEXT: BannerContext = { hidden: 'loading', open: 'loading' }

export interface BannerContent {
  tone: ScanBannerTone
  title: string
  description?: string
  icon?: LucideIcon
  busy?: boolean
  loading?: boolean
  retry?: boolean
  /** A "Review it" action that scrolls to the Still detected group. */
  review?: boolean
  /** A × closes it until the result changes. Never for a warning, failure or unknown status. */
  dismissible?: boolean
}

const UNCHECKED = (unknown: number) => `Nothing was flagged, but ${unknown} resource${plural(unknown, '', 's')} couldn't be fully checked.`
const CLEAN_RUN = (checks: number) => `All ${checks} checks ran and nothing was flagged. These checks don't cover every possible AWS saving.`

/**
 * A completed run with recorded counts. Green only when the run finished every
 * check with nothing unknown, nothing is open, nothing is still detected and
 * no resolved finding is left unconfirmed; blue when a resolved finding was
 * found again and nothing else is new.
 */
function completedBanner(c: CostScanCounts, ctx: BannerContext): BannerContent {
  const hidden = typeof ctx.hidden === 'object' ? ctx.hidden : null
  const again = hidden?.stillDetected ?? 0
  const dismissedAgain = dismissedFoundAgain(c.hiddenDismissed)
  const review = again > 0 || undefined
  if (c.new > 0) {
    return { tone: 'findings', title: 'Analysis complete', description: join(newFound(c.new), c.refreshed > 0 && stillOpen(c.refreshed), hiddenFoundAgain(again, c.hiddenDismissed)), review, dismissible: true }
  }
  if (c.refreshed > 0) {
    return { tone: 'findings', title: 'Analysis complete', description: join(`No new opportunities. ${stillOpen(c.refreshed)}`, hiddenFoundAgain(again, c.hiddenDismissed)), review, dismissible: true }
  }
  if (again > 0) {
    return { tone: 'info', icon: Info, title: foundAgainTitle(again), description: parts(NOTHING_NEW_BESIDES, dismissedAgain), review: true, dismissible: true }
  }
  // Nothing is claimed green or "nothing to review" until /hidden and /stats have answered.
  if (ctx.hidden === 'loading' || ctx.open === 'loading') return { tone: 'neutral', title: '', loading: true }
  if (hidden && hidden.notConfirmed === 0 && ctx.open === 0 && c.allChecksComplete && c.unknown === 0) {
    return { tone: 'success', icon: CheckCircle2, title: NOTHING_NEW_TITLE, description: parts(allChecksRan(c.checksTotal), dismissedAgain), dismissible: true }
  }
  if (c.detected === 0 && c.unknown > 0) return { tone: 'info', title: 'Analysis complete', description: UNCHECKED(c.unknown), dismissible: true }
  if (c.detected === 0 && c.unknown === 0 && c.allChecksComplete) {
    // The run was clean, but the page can't say "nothing to review" (/hidden or /stats failed, something is open, or unconfirmed).
    return { tone: 'info', title: 'Analysis complete', description: CLEAN_RUN(c.checksTotal), dismissible: true }
  }
  if (c.detected > 0) {
    // Everything detected was hidden (or a duplicate). C1, with the resolved part only when /hidden confirms it (above).
    return { tone: 'info', title: 'Analysis complete', description: join(typeof ctx.open === 'number' && ctx.open > 0 ? 'No new opportunities.' : 'Nothing new to review.', dismissedAgain), dismissible: true }
  }
  return { tone: 'neutral', title: 'Analysis complete', dismissible: true }
}

export function bannerContent(s: CostScanState, ctx: BannerContext = UNKNOWN_CONTEXT): BannerContent {
  const sourceLower = s.source ? SOURCE_LABEL[s.source].toLowerCase() : 'analysis'
  switch (s.key) {
    case 'loading':
      return { tone: 'neutral', title: '', loading: true }
    case 'status_unavailable':
      return { tone: 'neutral', icon: AlertTriangle, title: STATUS_UNAVAILABLE_TITLE, description: STATUS_UNAVAILABLE_DESCRIPTION, retry: true }
    case 'not_connected':
      return { tone: 'neutral', icon: CloudOff, title: 'AWS not connected', description: 'Connect an AWS account to run cost analysis.' }
    case 'never_analyzed':
      return { tone: 'neutral', icon: Clock, title: 'Never analyzed', description: 'AWS is connected, but no cost analysis has completed yet.' }
    case 'running':
      return { tone: 'neutral', busy: true, title: 'Analysis in progress', description: 'DevControl is currently checking your account.' }
    case 'completed_new':
    case 'completed_open':
    case 'completed_hidden':
    case 'completed_unchecked':
    case 'completed_clean':
      return s.counts ? completedBanner(s.counts, ctx) : { tone: 'neutral', title: 'Analysis complete', dismissible: true }
    case 'completed_other':
      return { tone: 'neutral', title: 'Analysis complete', dismissible: true }
    case 'completed_unrecorded':
      return { tone: 'neutral', title: 'Analysis complete', description: 'Per-check results are not yet recorded.', dismissible: true }
    case 'partial': {
      const c = s.counts
      const again = typeof ctx.hidden === 'object' ? ctx.hidden.stillDetected : 0
      return {
        tone: 'warning',
        title: 'Analysis partly complete',
        description: join(PARTIAL_MESSAGE, c && c.new > 0 && newFound(c.new), hiddenFoundAgain(again, c ? c.hiddenDismissed : 0)),
        review: again > 0 || undefined,
      }
    }
    case 'failed':
      return { tone: 'danger', title: `Last ${sourceLower} failed`, description: s.errorMessage || FAILED_FALLBACK }
    case 'interrupted':
      return { tone: 'danger', title: `Last ${sourceLower} was interrupted`, description: INTERRUPTED_MESSAGE }
  }
}

export type ToastKind = 'success' | 'info' | 'warning'

/** The toast after a successful "Run cost analysis" response: from its run state and counts, never recommendationsFound. */
export function analyzeToast(result: Pick<AnalysisResult, 'runState' | 'counts' | 'unknownResourceCount'>): { kind: ToastKind; text: string } {
  if (result.runState === 'partial') return { kind: 'warning', text: PARTIAL_MESSAGE }
  const c = result.counts
  if (!c) return { kind: 'info', text: 'Analysis complete.' }
  const hidden = c.suppressedResolved + c.suppressedDismissed
  const unknown = result.unknownResourceCount
  if (c.new > 0) return { kind: 'info', text: `Analysis complete: ${c.new} new opportunit${plural(c.new, 'y', 'ies')}.` }
  if (c.persisted > 0) return { kind: 'info', text: 'Analysis complete: no new opportunities.' }
  if (hidden > 0) {
    // C5: only the non-zero parts.
    const parts = [
      c.suppressedResolved > 0 && `${c.suppressedResolved} resolved found again`,
      c.suppressedDismissed > 0 && `${c.suppressedDismissed} dismissed found again`,
    ].filter(Boolean)
    return { kind: 'info', text: `Analysis complete: nothing new. ${parts.join(', ')}.` }
  }
  if (c.detected === 0 && typeof unknown === 'number' && unknown > 0) {
    return { kind: 'info', text: `Analysis complete: nothing flagged, ${unknown} resource${plural(unknown, '', 's')} not fully checked.` }
  }
  if (c.detected === 0 && unknown === 0 && result.runState === 'completed') return { kind: 'success', text: 'Analysis complete: nothing flagged.' }
  return { kind: 'info', text: 'Analysis complete.' }
}
