'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { costRecommendationsService, type CostRunResult } from '@/lib/services/cost-recommendations.service';
import { analyzeFailureMessage } from './costOptimizationStatus';
import { RUNNING_REFETCH_MS } from './costScanState';
import { resultBannerContent } from './costScanBanner';
import type { ScanResultView } from './ScanResultBanner';

/**
 * The scan result banner's lifecycle (founder-locked behaviour, Nov 23, #368), shared by Cost Optimization and
 * Cost Intelligence (Cost Intelligence PR B, ruling Q1). Moved here unchanged from cost-optimization/page.tsx; the
 * only per-page inputs are what each page refreshes after a run and where its banner is rendered.
 *
 * Only for a run THIS user started (Run cost analysis / Optimize Now), keyed to that run: the server returns this
 * user's latest manual run in this organization until it is acknowledged (seen while the tab is visible, or
 * closed), so it shows on the next visit if the run finished after they left, never again once seen (on either
 * page, in any tab or on any device), and a later scheduled run can't replace it. Scheduled runs never reach it.
 */

/** The result banner's query: this user's latest manual run in this organization, until seen or closed. */
export const RUN_RESULT_KEY = ['cost-run-result'] as const;

const tabVisible = () => typeof document === 'undefined' || document.visibilityState === 'visible';

/**
 * What GET my-result answered, and whether this tab was visible for the whole request (review S-1). An answer
 * fetched while the tab was hidden may already be stale: another tab can show and acknowledge the result
 * meanwhile. Such an answer is never shown or acknowledged; the tab asks again once it is visible.
 */
interface MyRunResultAnswer {
  result: CostRunResult | null;
  fetchedVisible: boolean;
}

async function fetchMyRunResult(): Promise<MyRunResultAnswer> {
  const visibleAtStart = tabVisible();
  const result = await costRecommendationsService.getMyRunResult();
  return { result, fetchedVisible: visibleAtStart && tabVisible() };
}

/**
 * The runs acknowledged (seen or closed) in this session, per query client: one page can replace the other in the
 * same commit (Costs ↔ Cost Optimization), before gcTime 0 has dropped the cached answer, so the new page's first
 * render would otherwise show (and acknowledge again) a result the previous page already showed or closed, until
 * the server's fresh answer arrives. A failed acknowledge is removed again, so that result still shows next visit.
 */
const acknowledgedRuns = new WeakMap<QueryClient, Set<string>>();
function acknowledgedIn(client: QueryClient): Set<string> {
  let runs = acknowledgedRuns.get(client);
  if (!runs) {
    runs = new Set<string>();
    acknowledgedRuns.set(client, runs);
  }
  return runs;
}

export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** "See the new opportunity": bring the page's Opportunities section (by its id) into view and focus its heading. */
export function bringSectionIntoView(sectionId: string): void {
  const section = document.getElementById(sectionId);
  if (!section) return;
  section.scrollIntoView?.({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  section.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
}

export interface CostRunResultBannerOptions {
  /** False in demo mode: no request, no banner. */
  enabled: boolean;
  /** Whether the page renders the banner slot now. A result is "seen" (acknowledged) only where it is shown. */
  bannerSlotShown: boolean;
  /** After this page's own run returned: the page's findings, totals and status (awaited before the banner shows). */
  refreshAfterRun: () => Promise<unknown>;
  /** A run this page didn't start (the user left mid-run and came back) finished while they watched. */
  refreshWhenRunEnds: () => Promise<unknown>;
}

export interface CostRunResultBanner {
  /** This page's own run request is in flight. */
  isAnalyzing: boolean;
  /** This page's run is in flight, or the server says this user's latest manual run is still running. */
  runRunning: boolean;
  /** What the banner shows: running, a result until closed, or nothing. */
  resultView: ScanResultView | null;
  /** The banner's ×: acknowledges the run (never shown again), or clears a session-only result. */
  closeResult: () => void;
  /** Starts a manual run (POST /analyze) and shows its result. Also the red banner's Try again. */
  runAnalysis: () => Promise<void>;
}

export function useCostRunResultBanner({ enabled, bannerSlotShown, refreshAfterRun, refreshWhenRunEnds }: CostRunResultBannerOptions): CostRunResultBanner {
  const queryClient = useQueryClient();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  // The pages' refresh lists, read at call time (they close over each page's own queries).
  const refreshAfterRunRef = useRef(refreshAfterRun);
  refreshAfterRunRef.current = refreshAfterRun;
  const refreshWhenRunEndsRef = useRef(refreshWhenRunEnds);
  refreshWhenRunEndsRef.current = refreshWhenRunEnds;

  // gcTime 0: a remount (navigating back, or to the other page) asks the server again, never replays the cache.
  const runResultQuery = useQuery({
    queryKey: RUN_RESULT_KEY,
    queryFn: fetchMyRunResult,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => (query.state.data?.result?.state === 'running' ? RUNNING_REFETCH_MS : false),
    enabled,
  });
  // A result whose run row couldn't be saved (ruling 8): shown for this session only, never acknowledged.
  const [sessionResult, setSessionResult] = useState<CostRunResult | null>(null);
  const [closedRunId, setClosedRunId] = useState<string | null>(null);
  // Runs another mount already acknowledged (this page before a navigation, or the other page): never shown here.
  // A snapshot at mount, so a result this mount shows stays until it is closed.
  const sessionAcknowledged = acknowledgedIn(queryClient);
  const [acknowledgedBeforeMount] = useState(() => new Set(sessionAcknowledged));
  const runResultAnswer = runResultQuery.data;
  const serverResult = runResultAnswer?.result ?? null;
  // Review S-1: a finished result is shown (and so acknowledged) only from an answer fetched while this tab was
  // visible. Once shown here it stays until closed: nothing refetches it while it is on screen.
  const verifiedResult = runResultAnswer?.fetchedVisible ? serverResult : null;
  const shownResult: CostRunResult | null = sessionResult
    ?? (verifiedResult && verifiedResult.state !== 'running' && verifiedResult.id !== closedRunId
      && !(verifiedResult.id && acknowledgedBeforeMount.has(verifiedResult.id)) ? verifiedResult : null);
  const runRunning = isAnalyzing || serverResult?.state === 'running';

  // An answer fetched while hidden (a background tab, or a run that ended while the user was elsewhere) is asked
  // again as soon as the tab is visible, so a result already seen in another tab is never replayed here.
  const answerNeedsVisibleFetch = enabled && runResultAnswer !== undefined && !runResultAnswer.fetchedVisible;
  useEffect(() => {
    if (!answerNeedsVisibleFetch) return undefined;
    const refetchIfVisible = () => {
      if (tabVisible()) void queryClient.refetchQueries({ queryKey: RUN_RESULT_KEY, exact: true });
    };
    refetchIfVisible();
    document.addEventListener('visibilitychange', refetchIfVisible);
    return () => document.removeEventListener('visibilitychange', refetchIfVisible);
  }, [answerNeedsVisibleFetch, queryClient]);

  // Seen = shown while the tab is visible: acknowledged once, so a refresh, another tab or device never replays it.
  // A failed acknowledge leaves it to show again next visit (never lost).
  const acknowledged = useRef(new Set<string>());
  const acknowledge = useCallback((runId: string) => {
    if (acknowledged.current.has(runId)) return;
    acknowledged.current.add(runId);
    sessionAcknowledged.add(runId);
    costRecommendationsService.acknowledgeRunResult(runId).catch(() => {
      acknowledged.current.delete(runId);
      sessionAcknowledged.delete(runId);
    });
  }, [sessionAcknowledged]);

  const closeResult = () => {
    if (sessionResult) setSessionResult(null);
    else if (shownResult?.id) {
      setClosedRunId(shownResult.id);
      acknowledge(shownResult.id);
    }
  };

  // A run this page didn't start (the user left mid-run and came back) finished while they watched: the
  // page's findings, totals and status refresh with it.
  const serverState = serverResult?.state;
  const previousServerState = useRef(serverState);
  useEffect(() => {
    const before = previousServerState.current;
    previousServerState.current = serverState;
    if (before === 'running' && serverState && serverState !== 'running') {
      void refreshWhenRunEndsRef.current();
    }
  }, [serverState, queryClient]);

  const runAnalysis = async () => {
    setIsAnalyzing(true);
    setSessionResult(null);
    try {
      const result = await costRecommendationsService.analyze();
      await refreshAfterRunRef.current();
      // The banner shows the run's own result at once (the same facts GET my-result gives).
      // Seen only if this tab is visible now (S-1); otherwise it is asked again once the tab is visible.
      if (result.result?.id) queryClient.setQueryData<MyRunResultAnswer>(RUN_RESULT_KEY, { result: result.result, fetchedVisible: tabVisible() });
      else if (result.result) setSessionResult(result.result);
      else await queryClient.invalidateQueries({ queryKey: RUN_RESULT_KEY });
    } catch (err: unknown) {
      // The run's own record says what happened (it may even still be running, e.g. after a proxy timeout).
      void queryClient.invalidateQueries({ queryKey: ['cost-analysis-runs'] });
      const recorded = await queryClient
        .fetchQuery({ queryKey: RUN_RESULT_KEY, queryFn: fetchMyRunResult, staleTime: 0 })
        .catch(() => null);
      if (!recorded?.result) {
        // No row (it couldn't be created): this session only, and no claim that the findings are unchanged.
        setSessionResult({
          id: null, state: 'failed', completedAt: null, checksTotal: 0, checksRan: 0, failedChecks: [], services: [],
          newCount: null, openCount: null, stillOpen: null, unknownResourceCount: null, message: analyzeFailureMessage(err), findingsUnchanged: false,
        });
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  const resultView: ScanResultView | null = runRunning
    ? { phase: 'running' }
    : shownResult ? { phase: 'result', content: resultBannerContent(shownResult) } : null;

  // The result banner shows (and so is "seen") only where the page renders it.
  const shownRunId = bannerSlotShown && !runRunning && shownResult?.id ? shownResult.id : null;
  useEffect(() => {
    if (!shownRunId) return undefined;
    const ackIfVisible = () => {
      if (document.visibilityState === 'visible') acknowledge(shownRunId);
    };
    ackIfVisible();
    document.addEventListener('visibilitychange', ackIfVisible);
    return () => document.removeEventListener('visibilitychange', ackIfVisible);
  }, [shownRunId, acknowledge]);

  return { isAnalyzing, runRunning, resultView, closeResult, runAnalysis };
}
