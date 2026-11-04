import { formatDistanceToNow } from 'date-fns'
import type { HiddenFinding, NotConfirmedReason } from '@/lib/services/cost-recommendations.service'

/**
 * Every user-visible string for hidden findings on Cost Optimization: C6-C28
 * as approved by the founder (pr3-step1.md §5.3, decisions 2026-11-03, with
 * the C10 edit), plus E1 and E2 (PR 3b pause, approved 2026-11-04).
 * C1-C5 live in costScanBanner.ts with the rest of the banner copy.
 */

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many)

export const STILL_DETECTED_TITLE = 'Still detected' // C6 (also the item badge)

/** C7 */
export function stillDetectedSubtext(count: number): string {
  const one = count === 1
  return `You marked ${one ? 'this' : 'these'} resolved, but the latest analysis still found ${one ? 'it' : 'them'}. ${one ? "It isn't" : "They aren't"} in the totals above until you reopen ${one ? 'it' : 'them'}.`
}

/** C8 */
export const estimatedIfAddressed = (amount: string) => `Estimated ${amount}/mo if addressed`

/** C9 (only when the ceiling is above 0) */
export const ceilingLine = (amount: string) => `Plus up to ${amount}/mo in estimated ceilings, not expected savings.`

const relative = (iso: string) => formatDistanceToNow(new Date(iso), { addSuffix: true })

/** C10 (resolved) and E2 (dismissed): who decided and when; "person not recorded" when no actor. */
export function decisionMeta(item: Pick<HiddenFinding, 'decision' | 'decidedAt' | 'decidedBy'>): string {
  const verb = item.decision === 'DISMISSED' ? 'Dismissed' : 'Resolved'
  const when = relative(item.decidedAt)
  return item.decidedBy ? `${verb} ${when} by ${item.decidedBy}` : `${verb} ${when} · person not recorded`
}

/** C11: earlier decisions = open decision rows before the latest; shown only when more than 1. */
export function earlierDecisions(decisionCount: number): string | null {
  const earlier = decisionCount - 1
  return earlier > 1 ? `${earlier} earlier decisions on this finding` : null
}

/** C12 */
export const notRecheckedLine = (count: number) =>
  `${count} resolved finding${plural(count, '', 's')} couldn't be re-checked by the latest analysis.`

export const REOPEN = 'Reopen' // C13
export const REOPENED_ACTIVE = "Reopened. It's back in your active recommendations." // C14
export const REOPENED_PENDING = "Reopened. It will appear after the next analysis if it's still detected." // C15
export const ALREADY_REOPENED = 'This finding was already reopened.' // C16
export const REOPEN_FAILED = "Couldn't reopen this finding. Try again." // C17
export const VIEWER_CANT_REOPEN = 'Only members and above can reopen findings.' // C18

/** C19 */
export const reviewToggleLabel = (count: number) => `Resolved and dismissed (${count})`
export const SHOW = 'Show'
export const HIDE = 'Hide'

export const NOT_CONFIRMED = 'Not confirmed' // C20
export const NOT_CONFIRMED_REASON: Record<NotConfirmedReason, string> = {
  not_checked_since: 'No analysis has checked this since your decision.', // C21
  check_failed: "The latest analysis couldn't complete this check.", // C22
  not_fully_checked: "The latest analysis couldn't fully check this resource.", // C23
  analysis_incomplete: "The latest analysis didn't finish.", // C24
}
export const DISMISSED_BADGE = 'Dismissed' // C25
export const REVIEW_EMPTY = 'No resolved or dismissed findings are hidden.' // C26
export const HIDDEN_LOAD_FAILED = "Couldn't load resolved and dismissed findings. Try again." // C27
// C28 reuses the LIVE Dismiss button and its toasts.
export const DISMISS = 'Dismiss'
export const DISMISSED_TOAST = 'Recommendation dismissed'
export const DISMISS_FAILED_TOAST = 'Failed to dismiss recommendation'

/** E1: the check names as one left-aligned line (replaces the centred bullet list). */
export const checksLine = (names: readonly string[]) => `What DevControl checks: ${names.join(', ')}.`
