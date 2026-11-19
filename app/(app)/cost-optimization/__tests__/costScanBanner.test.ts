/**
 * Exact banner, empty-state and toast copy for every scan state, as approved
 * by the founder on 2026-11-02 (pr2-step1.md §1c and §1g), with PR 3's C1-C5
 * (pr3-step1.md §5.3, founder decisions 2026-11-03: parts with a 0 count are
 * omitted) replacing the hidden-finding wording. The five PR 1 strings must
 * stay byte-identical.
 */
import { describe, it, expect } from 'vitest'
import { CheckCircle2, Info } from 'lucide-react'
import { analyzeToast, BANNER_SOURCE_LABEL, bannerContent, INTERRUPTED_MESSAGE, PARTIAL_MESSAGE, type BannerContext } from '../costScanBanner'
import { deriveCostScanState, type CostScanState } from '../costScanState'
import { LEGACY_RUN, PRODUCTION_HIDDEN, PRODUCTION_RESOLVED_ONLY, checks, run } from './fixtures'
import type { CostAnalysisRun } from '@/lib/services/cost-recommendations.service'

const stateOf = (r: CostAnalysisRun): CostScanState =>
  deriveCostScanState({ connection: { data: 'connected', isError: false }, runs: { data: [r], isError: false }, jobs: { data: [], isError: false }, isAnalyzing: false })

/** /hidden and /stats answered: `still` still detected, `unconfirmed` not confirmed, `open` ACTIVE. */
const ready = (still = 0, unconfirmed = 0, open = 0): BannerContext => ({ hidden: { stillDetected: still, notConfirmed: unconfirmed }, open })
const banner = (r: CostAnalysisRun, ctx: BannerContext = ready()) => bannerContent(stateOf(r), ctx)
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

  it('5 new findings, with R and C4 (the resolved part from /hidden), Review it', () => {
    expect(banner(run({ detected_count: 6, new_count: 2, refreshed_count: 3, persisted_count: 5, suppressed_resolved_count: 1 }), ready(1, 0, 5))).toEqual({
      tone: 'findings',
      title: 'Analysis complete',
      description: '2 new opportunities found. 3 found earlier are still open. 1 finding you resolved was found again.',
      review: true,
      dismissible: true,
    })
  })
  it('5 singular, no R or H', () => {
    expect(banner(run({ detected_count: 1, new_count: 1, persisted_count: 1 }), ready(0, 0, 1))).toEqual({
      tone: 'findings', title: 'Analysis complete', description: '1 new opportunity found.', dismissible: true,
    })
  })
  it('5b purple: none new, some still open', () => {
    expect(banner(run({ detected_count: 1, refreshed_count: 1, persisted_count: 1 }), ready(0, 0, 1))).toEqual({
      tone: 'findings', title: 'Analysis complete', description: 'No new opportunities. 1 found earlier is still open.', dismissible: true,
    })
    expect(banner(run({ detected_count: 4, refreshed_count: 2, persisted_count: 2, suppressed_dismissed_count: 2 }), ready(0, 0, 2)).description).toBe(
      'No new opportunities. 2 found earlier are still open. 2 findings you dismissed were found again and are still hidden.'
    )
  })

  it('BLUE (tidy mock): a resolved finding found again, nothing else new; Review it', () => {
    expect(banner(run({ detected_count: 1, suppressed_resolved_count: 1 }), ready(1))).toEqual({
      tone: 'info',
      icon: Info,
      title: 'Analysis complete · 1 finding you resolved was found again.',
      description: 'nothing new besides this',
      review: true,
      dismissible: true,
    })
    expect(banner(run({ detected_count: 2, suppressed_resolved_count: 2 }), ready(2)).title).toBe('Analysis complete · 2 findings you resolved were found again.')
  })
  it('BLUE with a dismissed one too: C3 joins the sub-line', () => {
    expect(banner(PRODUCTION_HIDDEN, ready(1)).description).toBe('nothing new besides this · 1 finding you dismissed was found again and is still hidden.')
  })
  it('BLUE follows /hidden, not the run: a still-detected finding from an earlier run still shows', () => {
    expect(banner(run(), ready(1))).toMatchObject({ tone: 'info', title: 'Analysis complete · 1 finding you resolved was found again.', review: true })
  })

  it('GREEN (tidy mock): finished, nothing open, nothing still detected, nothing unconfirmed', () => {
    expect(banner(run())).toEqual({
      tone: 'success',
      icon: CheckCircle2,
      title: 'Analysis complete · nothing new to review.',
      description: 'all 9 active checks ran',
      dismissible: true,
    })
    // Found-again dismissed findings stay hidden: still nothing to review.
    expect(banner(run({ detected_count: 2, suppressed_dismissed_count: 2 }))).toMatchObject({
      tone: 'success', description: 'all 9 active checks ran · 2 findings you dismissed were found again and are still hidden.',
    })
  })
  it('never green with something open, still detected or unconfirmed', () => {
    expect(banner(run(), ready(0, 0, 1)).tone).not.toBe('success')
    expect(banner(run(), ready(1, 0, 0)).tone).not.toBe('success')
    expect(banner(run(), ready(0, 1, 0)).tone).not.toBe('success')
  })
  it('never green while /hidden or /stats is unknown: loading waits, a failure is not green', () => {
    expect(banner(run(), { hidden: 'loading', open: 0 })).toMatchObject({ loading: true })
    expect(banner(run(), { hidden: ready().hidden, open: 'loading' })).toMatchObject({ loading: true })
    expect(banner(run(), { hidden: 'error', open: 0 })).toEqual({
      tone: 'info', title: 'Analysis complete', description: "All 9 checks ran and nothing was flagged. These checks don't cover every possible AWS saving.", dismissible: true,
    })
    expect(banner(run(), { hidden: ready().hidden, open: 'error' }).tone).toBe('info')
  })
  it('never green for an unknown resource, a failed check, a partial or a legacy run', () => {
    expect(banner(run({ unknown_resource_count: 1 })).tone).toBe('info')
    expect(banner(run({ checks: checks(1) })).tone).not.toBe('success')
    expect(banner(run({ run_state: 'partial', status: 'failed', checks: checks(1) })).tone).toBe('warning')
    expect(banner(LEGACY_RUN).tone).toBe('neutral')
  })

  it('TRUTH FIX: the run counted resolved findings found again but /hidden confirms none: no "found again", no Review it', () => {
    for (const ctx of [ready(0, 2), ready(0, 0), { hidden: 'error' as const, open: 0 }]) {
      const b = banner(PRODUCTION_RESOLVED_ONLY, ctx)
      expect(b).toMatchObject({ tone: 'info', title: 'Analysis complete', description: 'Nothing new to review.' })
      expect(`${b.title} ${b.description}`).not.toMatch(/found again/)
      expect(b.review).toBeUndefined()
    }
    // The founder's case: 1 counted found again by the run, 1 not confirmed by /hidden.
    expect(banner(run({ detected_count: 1, suppressed_resolved_count: 1 }), ready(0, 1)).description).toBe('Nothing new to review.')
  })
  it('6 dismissed only, plural (C1 + C3)', () => {
    expect(banner(run({ detected_count: 2, suppressed_dismissed_count: 2, unknown_resource_count: 1 })).description).toBe(
      'Nothing new to review. 2 findings you dismissed were found again and are still hidden.'
    )
  })
  it('C1 no longer says resolved findings "are still hidden" (a reopen would contradict it)', () => {
    expect(banner(PRODUCTION_RESOLVED_ONLY, ready(2)).description).not.toMatch(/still hidden/)
  })
  it('something open that the run did not report (a reopen since): "No new opportunities.", never "nothing to review"', () => {
    expect(banner(run({ detected_count: 1, suppressed_resolved_count: 1, unknown_resource_count: 1 }), ready(0, 0, 1)).description).toBe('No new opportunities.')
  })
  it('6b blue: not fully checked', () => {
    expect(banner(run({ unknown_resource_count: 3 }))).toEqual({ tone: 'info', title: 'Analysis complete', description: "Nothing was flagged, but 3 resources couldn't be fully checked.", dismissible: true })
    expect(banner(run({ unknown_resource_count: 1 })).description).toBe("Nothing was flagged, but 1 resource couldn't be fully checked.")
  })
  it('7b legacy (LIVE)', () => expect(banner(LEGACY_RUN)).toEqual({ tone: 'neutral', title: 'Analysis complete', description: 'Per-check results are not yet recorded.', dismissible: true }))
  it('completed_other: neutral, headline only, no new wording', () => expect(banner(run({ detected_count: 1, duplicate_count: 1 }))).toEqual({ tone: 'neutral', title: 'Analysis complete', dismissible: true }))
  it('8 amber partial, with N and C4 (resolved part from /hidden); never dismissible', () => {
    expect(banner(run({ run_state: 'partial', status: 'failed', checks: checks(1), detected_count: 3, new_count: 2, persisted_count: 2, suppressed_resolved_count: 1 }), ready(1, 0, 2))).toEqual({
      tone: 'warning',
      title: 'Analysis partly complete',
      description: "Some cost checks didn't complete, so these results may be incomplete. 2 new opportunities found. 1 finding you resolved was found again.",
      review: true,
    })
    expect(banner(run({ run_state: 'partial', status: 'failed', checks: checks(1), suppressed_resolved_count: 1 }), ready(0, 1)).description).toBe(PARTIAL_MESSAGE)
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
    expect(bannerContent(bare('status_unavailable')).dismissible).toBeUndefined()
  })
  it('the banner names the run "Scheduled analysis" or "Analysis you ran"', () => {
    expect(BANNER_SOURCE_LABEL).toEqual({ scheduled: 'Scheduled analysis', manual: 'Analysis you ran' })
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
    // /hidden agrees with the run here: its still-detected count equals the run's suppressedResolved.
    expect(analyzeToast(result, result.counts?.suppressedResolved ?? 0)).toEqual({ kind, text })
  })
  it('green only for clean: never with hidden findings, unknowns or missing counts', () => {
    expect(analyzeToast({ runState: 'completed', counts: counts({ detected: 1, suppressedDismissed: 1 }), unknownResourceCount: 0 }, 0).kind).not.toBe('success')
    expect(analyzeToast({ runState: 'completed', counts: counts({}), unknownResourceCount: null }, 0).kind).not.toBe('success')
    expect(analyzeToast({ runState: undefined, counts: counts({}), unknownResourceCount: 0 }, 0).kind).not.toBe('success')
    // A still-detected finding per /hidden is never "nothing flagged" in green.
    expect(analyzeToast({ runState: 'completed', counts: counts({}), unknownResourceCount: 0 }, 1)).toEqual({ kind: 'info', text: 'Analysis complete: nothing new. 1 resolved found again.' })
  })
  it('never "0 found" when findings were detected but hidden', () => {
    expect(analyzeToast({ runState: 'completed', counts: counts({ detected: 2, suppressedResolved: 2 }), unknownResourceCount: 0 }, 2).text).not.toMatch(/\b0\b/)
    expect(analyzeToast({ runState: 'completed', counts: counts({ detected: 2, suppressedResolved: 2 }), unknownResourceCount: 0 }, 0).text).not.toMatch(/\b0\b/)
  })
})

describe('founder ruling 8: the toast uses the same still-detected count as the banner (/hidden)', () => {
  const counts = (c: Partial<Record<'detected' | 'new' | 'refreshed' | 'suppressedResolved' | 'suppressedDismissed' | 'duplicate' | 'persisted', number>>) => ({
    detected: 0, new: 0, refreshed: 0, suppressedResolved: 0, suppressedDismissed: 0, duplicate: 0, persisted: 0, ...c,
  })
  const ran = (c: Parameters<typeof counts>[0]) => ({ runState: 'completed' as const, counts: counts(c), unknownResourceCount: 0 })

  it('the run counted 1 resolved found again, /hidden confirms none: no "resolved found again"', () => {
    expect(analyzeToast(ran({ detected: 1, suppressedResolved: 1 }), 0)).toEqual({ kind: 'info', text: 'Analysis complete: nothing new.' })
  })
  it('/hidden did not answer (null): no "resolved found again", the dismissed part stays', () => {
    expect(analyzeToast(ran({ detected: 1, suppressedResolved: 1 }), null)).toEqual({ kind: 'info', text: 'Analysis complete: nothing new.' })
    expect(analyzeToast(ran({ detected: 2, suppressedResolved: 1, suppressedDismissed: 1 }), null)).toEqual({ kind: 'info', text: 'Analysis complete: nothing new. 1 dismissed found again.' })
  })
  it('the count is /hidden\'s, not the run\'s', () => {
    expect(analyzeToast(ran({ detected: 3, suppressedResolved: 3 }), 2).text).toBe('Analysis complete: nothing new. 2 resolved found again.')
  })
  it('toast and banner give the same number for the same /hidden answer', () => {
    for (const still of [0, 1, 2]) {
      const r = run({ detected_count: 2, suppressed_resolved_count: 2 })
      const b = bannerContent(stateOf(r), ready(still))
      const t = analyzeToast(ran({ detected: 2, suppressedResolved: 2 }), still)
      const inBanner = `${b.title} ${b.description ?? ''}`.match(/(\d+) findings? you resolved/)?.[1] ?? '0'
      const inToast = t.text.match(/(\d+) resolved found again/)?.[1] ?? '0'
      expect(inToast).toBe(inBanner)
      expect(inToast).toBe(String(still))
    }
  })
})
