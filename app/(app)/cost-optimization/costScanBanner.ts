import type { LucideIcon } from 'lucide-react'
import { AlertTriangle, CloudOff, Clock } from 'lucide-react'
import type { AnalysisResult } from '@/lib/types'
import type { ScanBannerTone } from '@/components/ui/scan-status-banner'
import type { AnalysisSource } from './costOptimizationStatus'
import type { CostScanCounts, CostScanState } from './costScanState'

/**
 * Every banner and toast string for the Cost Optimization scan state, exactly
 * as approved by the founder on 2026-11-02 (pr2-step1.md §1c and §1g).
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

/** Sentence H. */
export function stillHidden(count: number): string {
  return `${count} finding${plural(count, '', 's')} you resolved or dismissed earlier ${plural(count, 'is', 'are')} still hidden.`
}

function join(...sentences: (string | false | null | undefined)[]): string {
  return sentences.filter(Boolean).join(' ')
}

/** The sub-text a completed or partial run's counts give; also used by the empty state. */
function completedDescription(key: CostScanState['key'], c: CostScanCounts | null): string | null {
  if (!c) return null
  switch (key) {
    case 'completed_new':
      return join(newFound(c.new), c.refreshed > 0 && stillOpen(c.refreshed), c.hidden > 0 && stillHidden(c.hidden))
    case 'completed_open':
      return join(`No new opportunities. ${stillOpen(c.refreshed)}`, c.hidden > 0 && stillHidden(c.hidden))
    case 'completed_hidden':
      return `Nothing new to review. ${c.hidden} finding${plural(c.hidden, '', 's')} you resolved or dismissed earlier ${plural(c.hidden, 'was', 'were')} found again and ${plural(c.hidden, 'is', 'are')} still hidden.`
    case 'completed_unchecked':
      return `Nothing was flagged, but ${c.unknown} resource${plural(c.unknown, '', 's')} couldn't be fully checked.`
    case 'completed_clean':
      return `All ${c.checksTotal} checks ran and nothing was flagged. These checks don't cover every possible AWS saving.`
    default:
      return null
  }
}

export interface BannerContent {
  tone: ScanBannerTone
  title: string
  description?: string
  icon?: LucideIcon
  busy?: boolean
  loading?: boolean
  retry?: boolean
}

export function bannerContent(s: CostScanState): BannerContent {
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
      return { tone: 'findings', title: 'Analysis complete', description: completedDescription(s.key, s.counts) ?? undefined }
    case 'completed_hidden':
    case 'completed_unchecked':
      return { tone: 'info', title: 'Analysis complete', description: completedDescription(s.key, s.counts) ?? undefined }
    case 'completed_clean':
      return { tone: 'success', title: 'Analysis complete', description: completedDescription(s.key, s.counts) ?? undefined }
    case 'completed_unrecorded':
      return { tone: 'neutral', title: 'Analysis complete', description: 'Per-check results are not yet recorded.' }
    case 'completed_other':
      return { tone: 'neutral', title: 'Analysis complete' }
    case 'partial': {
      const c = s.counts
      return {
        tone: 'warning',
        title: 'Analysis partly complete',
        description: join(PARTIAL_MESSAGE, c && c.new > 0 && newFound(c.new), c && c.hidden > 0 && stillHidden(c.hidden)),
      }
    }
    case 'failed':
      return { tone: 'danger', title: `Last ${sourceLower} failed`, description: s.errorMessage || FAILED_FALLBACK }
    case 'interrupted':
      return { tone: 'danger', title: `Last ${sourceLower} was interrupted`, description: INTERRUPTED_MESSAGE }
  }
}

/** The empty-state sub-text for the run-derived states that have no older empty-state copy. */
export function emptyStateDescription(s: CostScanState): string | null {
  if (s.key === 'partial' || s.key === 'interrupted') return bannerContent(s).description ?? null
  return completedDescription(s.key, s.counts)
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
  if (hidden > 0) return { kind: 'info', text: `Analysis complete: nothing new, ${hidden} still hidden.` }
  if (c.detected === 0 && typeof unknown === 'number' && unknown > 0) {
    return { kind: 'info', text: `Analysis complete: nothing flagged, ${unknown} resource${plural(unknown, '', 's')} not fully checked.` }
  }
  if (c.detected === 0 && unknown === 0 && result.runState === 'completed') return { kind: 'success', text: 'Analysis complete: nothing flagged.' }
  return { kind: 'info', text: 'Analysis complete.' }
}
