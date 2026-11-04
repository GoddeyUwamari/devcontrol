/**
 * Exact banner, empty-state and toast copy for every scan state, as approved
 * by the founder on 2026-11-02 (pr2-step1.md §1c and §1g), with PR 3's C1-C5
 * (pr3-step1.md §5.3, founder decisions 2026-11-03: parts with a 0 count are
 * omitted) replacing the hidden-finding wording. The five PR 1 strings must
 * stay byte-identical.
 */
import { describe, it, expect } from 'vitest'
import { analyzeToast, bannerContent, INTERRUPTED_MESSAGE, PARTIAL_MESSAGE } from '../costScanBanner'
import { deriveCostScanState, type CostScanState } from '../costScanState'
import { LEGACY_RUN, PRODUCTION_HIDDEN, PRODUCTION_RESOLVED_ONLY, checks, run } from './fixtures'
import type { CostAnalysisRun } from '@/lib/services/cost-recommendations.service'

const stateOf = (r: CostAnalysisRun): CostScanState =>
  deriveCostScanState({ accounts: { data: [{}], isError: false }, runs: { data: [r], isError: false }, jobs: { data: [], isError: false }, isAnalyzing: false })

const banner = (r: CostAnalysisRun) => bannerContent(stateOf(r))
const bare = (key: CostScanState['key']): CostScanState => ({ key, source: null, completedAt: null, errorMessage: null, counts: null })

describe('approved PR 1 copy, byte-identical', () => {
  it('partial and interrupted', () => {
    expect(PARTIAL_MESSAGE).toBe("Some cost checks didn't complete, so these results may be incomplete.")
    expect(INTERRUPTED_MESSAGE).toBe('The analysis was interrupted before it finished. Run it again.')
  })
  it('failed run messages pass through exactly', () => {
    for (const message of ["The analysis ran, but its results couldn't be saved. Try again.", 'None of the cost checks could complete. Try again.']) {
      expect(banner(run({ run_state: 'failed', status: 'failed', error_message: message })).description).toBe(message)
    }
  })
})

describe('banner content per state', () => {
  it('2 not connected (LIVE)', () => expect(bannerContent(bare('not_connected'))).toMatchObject({ tone: 'neutral', title: 'AWS not connected', description: 'Connect an AWS account to run cost analysis.' }))
  it('3 never analyzed (LIVE)', () => expect(bannerContent(bare('never_analyzed'))).toMatchObject({ tone: 'neutral', title: 'Never analyzed', description: 'AWS is connected, but no cost analysis has completed yet.' }))
  it('4 running (LIVE)', () => expect(bannerContent(bare('running'))).toMatchObject({ tone: 'neutral', busy: true, title: 'Analysis in progress', description: 'DevControl is currently checking your account.' }))
  it('1 loading', () => expect(bannerContent(bare('loading'))).toMatchObject({ tone: 'neutral', loading: true }))

  it('5 new findings, with R and C4 (resolved part only)', () => {
    expect(banner(run({ detected_count: 6, new_count: 2, refreshed_count: 3, persisted_count: 5, suppressed_resolved_count: 1 }))).toEqual({
      tone: 'findings',
      title: 'Analysis complete',
      description: '2 new opportunities found. 3 found earlier are still open. 1 finding you resolved was found again.',
    })
  })
  it('5 singular, no R or H', () => {
    expect(banner(run({ detected_count: 1, new_count: 1, persisted_count: 1 })).description).toBe('1 new opportunity found.')
  })
  it('5b purple: none new, some still open', () => {
    expect(banner(run({ detected_count: 1, refreshed_count: 1, persisted_count: 1 }))).toEqual({
      tone: 'findings', title: 'Analysis complete', description: 'No new opportunities. 1 found earlier is still open.',
    })
    expect(banner(run({ detected_count: 4, refreshed_count: 2, persisted_count: 2, suppressed_dismissed_count: 2 })).description).toBe(
      'No new opportunities. 2 found earlier are still open. 2 findings you dismissed were found again and are still hidden.'
    )
  })
  it('6 blue: C1 with both parts', () => {
    expect(banner(PRODUCTION_HIDDEN)).toEqual({
      tone: 'info',
      title: 'Analysis complete',
      description: 'Nothing new to review. 1 finding you resolved was found again. 1 finding you dismissed was found again and is still hidden.',
    })
  })
  it('6 production today (2 resolved, 0 dismissed): the 0 part is omitted', () => {
    expect(banner(PRODUCTION_RESOLVED_ONLY).description).toBe('Nothing new to review. 2 findings you resolved were found again.')
    expect(banner(PRODUCTION_RESOLVED_ONLY).description).not.toMatch(/\b0\b|dismissed/)
  })
  it('6 dismissed only, plural', () => {
    expect(banner(run({ detected_count: 2, suppressed_dismissed_count: 2 })).description).toBe(
      'Nothing new to review. 2 findings you dismissed were found again and are still hidden.'
    )
  })
  it('6 singular', () => {
    expect(banner(run({ detected_count: 1, suppressed_resolved_count: 1 })).description).toBe(
      'Nothing new to review. 1 finding you resolved was found again.'
    )
  })
  it('C1 no longer says resolved findings "are still hidden" (a reopen would contradict it)', () => {
    expect(banner(PRODUCTION_RESOLVED_ONLY).description).not.toMatch(/still hidden/)
  })
  it('6b blue: not fully checked', () => {
    expect(banner(run({ unknown_resource_count: 3 }))).toEqual({ tone: 'info', title: 'Analysis complete', description: "Nothing was flagged, but 3 resources couldn't be fully checked." })
    expect(banner(run({ unknown_resource_count: 1 })).description).toBe("Nothing was flagged, but 1 resource couldn't be fully checked.")
  })
  it('7 green: the only success tone', () => {
    expect(banner(run())).toEqual({
      tone: 'success',
      title: 'Analysis complete',
      description: "All 9 checks ran and nothing was flagged. These checks don't cover every possible AWS saving.",
    })
  })
  it('7b legacy (LIVE)', () => expect(banner(LEGACY_RUN)).toEqual({ tone: 'neutral', title: 'Analysis complete', description: 'Per-check results are not yet recorded.' }))
  it('completed_other: neutral, headline only, no new wording', () => expect(banner(run({ detected_count: 1, duplicate_count: 1 }))).toEqual({ tone: 'neutral', title: 'Analysis complete' }))
  it('8 amber partial, with N and C4', () => {
    expect(banner(run({ run_state: 'partial', status: 'failed', checks: checks(1), detected_count: 3, new_count: 2, persisted_count: 2, suppressed_resolved_count: 1 }))).toEqual({
      tone: 'warning',
      title: 'Analysis partly complete',
      description: "Some cost checks didn't complete, so these results may be incomplete. 2 new opportunities found. 1 finding you resolved was found again.",
    })
    expect(banner(run({ run_state: 'partial', status: 'failed', checks: checks(1) })).description).toBe(PARTIAL_MESSAGE)
  })
  it('9 red failed: manual label, fallback for unknown text', () => {
    expect(banner(run({ run_state: 'failed', status: 'failed', error_message: 'Failed to analyze AWS resources: AccessDenied' }))).toEqual({
      tone: 'danger', title: 'Last manual cost analysis failed', description: 'The most recent analysis did not complete.',
    })
  })
  it('10 red interrupted', () => {
    expect(banner(run({ run_state: 'interrupted', status: 'failed' }))).toEqual({
      tone: 'danger', title: 'Last manual cost analysis was interrupted', description: 'The analysis was interrupted before it finished. Run it again.',
    })
    expect(banner(run({ run_state: 'interrupted', status: 'failed', source: 'discovery' })).title).toBe('Last scheduled analysis was interrupted')
  })
  it('11 scheduled cost step threw', () => {
    expect(banner(run({ run_state: 'failed', status: 'failed', source: 'discovery', error_message: 'The analysis did not complete due to an unexpected error.' }))).toEqual({
      tone: 'danger', title: 'Last scheduled analysis failed', description: 'The analysis did not complete due to an unexpected error.',
    })
  })
  it('13/14 status unavailable', () => {
    expect(bannerContent(bare('status_unavailable'))).toMatchObject({
      tone: 'neutral', title: "Couldn't load analysis status", description: "This doesn't mean nothing was found. Try again.", retry: true,
    })
  })
})

describe('analyzeToast: from run state and counts, never recommendationsFound', () => {
  const counts = (c: Partial<Record<'detected' | 'new' | 'refreshed' | 'suppressedResolved' | 'suppressedDismissed' | 'duplicate' | 'persisted', number>>) => ({
    detected: 0, new: 0, refreshed: 0, suppressedResolved: 0, suppressedDismissed: 0, duplicate: 0, persisted: 0, ...c,
  })
  it.each([
    ['new', { runState: 'completed' as const, counts: counts({ detected: 2, new: 2, persisted: 2 }), unknownResourceCount: 0 }, 'info', 'Analysis complete: 2 new opportunities.'],
    ['new singular', { runState: 'completed' as const, counts: counts({ detected: 1, new: 1, persisted: 1 }), unknownResourceCount: 0 }, 'info', 'Analysis complete: 1 new opportunity.'],
    ['none new', { runState: 'completed' as const, counts: counts({ detected: 1, refreshed: 1, persisted: 1 }), unknownResourceCount: 0 }, 'info', 'Analysis complete: no new opportunities.'],
    ['hidden, both parts (C5)', { runState: 'completed' as const, counts: counts({ detected: 2, suppressedResolved: 1, suppressedDismissed: 1 }), unknownResourceCount: 0 }, 'info', 'Analysis complete: nothing new. 1 resolved found again, 1 dismissed found again.'],
    ['hidden, production today (C5, 0 dismissed omitted)', { runState: 'completed' as const, counts: counts({ detected: 2, suppressedResolved: 2 }), unknownResourceCount: 0 }, 'info', 'Analysis complete: nothing new. 2 resolved found again.'],
    ['hidden, dismissed only (C5, 0 resolved omitted)', { runState: 'completed' as const, counts: counts({ detected: 3, suppressedDismissed: 3 }), unknownResourceCount: 0 }, 'info', 'Analysis complete: nothing new. 3 dismissed found again.'],
    ['unknown', { runState: 'completed' as const, counts: counts({}), unknownResourceCount: 2 }, 'info', 'Analysis complete: nothing flagged, 2 resources not fully checked.'],
    ['unknown singular', { runState: 'completed' as const, counts: counts({}), unknownResourceCount: 1 }, 'info', 'Analysis complete: nothing flagged, 1 resource not fully checked.'],
    ['clean', { runState: 'completed' as const, counts: counts({}), unknownResourceCount: 0 }, 'success', 'Analysis complete: nothing flagged.'],
    ['counts null', { runState: 'completed' as const, counts: null, unknownResourceCount: 0 }, 'info', 'Analysis complete.'],
    ['older backend', { runState: undefined, counts: undefined, unknownResourceCount: undefined }, 'info', 'Analysis complete.'],
    ['partial', { runState: 'partial' as const, counts: counts({ detected: 2, new: 2, persisted: 2 }), unknownResourceCount: 0 }, 'warning', PARTIAL_MESSAGE],
  ])('%s', (_label, result, kind, text) => {
    expect(analyzeToast(result)).toEqual({ kind, text })
  })
  it('green only for clean: never with hidden findings, unknowns or missing counts', () => {
    expect(analyzeToast({ runState: 'completed', counts: counts({ detected: 1, suppressedDismissed: 1 }), unknownResourceCount: 0 }).kind).not.toBe('success')
    expect(analyzeToast({ runState: 'completed', counts: counts({}), unknownResourceCount: null }).kind).not.toBe('success')
    expect(analyzeToast({ runState: undefined, counts: counts({}), unknownResourceCount: 0 }).kind).not.toBe('success')
  })
  it('never "0 found" when findings were detected but hidden', () => {
    expect(analyzeToast({ runState: 'completed', counts: counts({ detected: 2, suppressedResolved: 2 }), unknownResourceCount: 0 }).text).not.toMatch(/\b0\b/)
  })
})
