'use client';

import { useCallback, useRef, useState, type MouseEvent } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Loader2,
  RefreshCw,
  CheckCircle,
  CheckCircle2,
  ChevronDown,
  XCircle,
  CloudOff,
  Clock,
  AlertTriangle,
  Server,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { costRecommendationsService } from '@/lib/services/cost-recommendations.service';
import awsAccountsService from '@/lib/services/aws-accounts.service';
import awsServicesService from '@/lib/services/aws-services.service';
import { awsResourcesService } from '@/lib/services/aws-resources.service';
import type { CostRecommendation, RecommendationSeverity } from '@/lib/types';
import type { HiddenFindings, OptimizationRuleCatalog } from '@/lib/services/cost-recommendations.service';
import { useDemoMode } from '@/components/demo/demo-mode-toggle';
import { useCurrentRole } from '@/lib/hooks/use-current-role';
import { useSalesDemo } from '@/lib/demo/sales-demo-data';
import { cn, formatSavingsCurrency, formatSavingsTotal } from '@/lib/utils';
import { PAGE_SUBTITLE_CLASS, PAGE_TITLE_CLASS } from '@/components/ui/typography';
import { DEFAULT_PRICE_DISCLOSURE, describeCeilings, formatRecommendationSavings, isDefaultPriceEstimate, rankBySavings, savingsBasisKind } from '@/lib/savings-basis';
import { LOW_ACTIVITY_STORAGE_NOTE, displayIssue, isLowActivityFinding, lowActivityListPriceBasis, lowActivitySavingsHeadline } from '@/lib/finding-display';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { SeverityBadge } from '@/components/ui/severity-badge';
import { Skeleton } from '@/components/ui/skeleton';
import { DiscoveryWarningNotice } from '@/components/aws/discovery-warning-notice';
import { analyzeFailureMessage } from './costOptimizationStatus';
import { deriveCostScanState, runsRefetchInterval } from './costScanState';
import {
  BANNER_SOURCE_LABEL,
  SOURCE_LABEL,
  STATS_UNAVAILABLE_NOTE,
  TRY_AGAIN,
  UNAVAILABLE,
  analyzeToast,
  bannerContent,
} from './costScanBanner';
import { CostAnalysisBanner, RunResultBanner, type RunResult } from './CostAnalysisBanner';
import { ReviewList, StillDetectedSlot, scrollToStillDetected, type HiddenView } from './HiddenFindings';
import {
  ALREADY_REOPENED,
  DISMISSED_TOAST,
  DISMISS_FAILED_TOAST,
  REOPENED_ACTIVE,
  REOPENED_PENDING,
  REOPEN_FAILED,
} from './hiddenFindingsCopy';
import {
  ALL,
  COVERAGE,
  ESTIMATED_MONTHLY_SAVINGS,
  HOW_DEVCONTROL_CHECKS,
  HOW_EACH_CHECK_WORKS,
  LAST_ANALYSIS,
  LAST_ANALYSIS_SOURCE,
  LEGACY_CHECKS_CAVEAT,
  NOTHING_TO_ACT_ON,
  NO_CRITICAL_TIER,
  NO_FIRM_ESTIMATE,
  OPEN_OPPORTUNITIES,
  SEE_WHATS_CHECKED,
  SEVERITY_FILTER_LABEL,
  SUMMARY,
  SUMMARY_NO_ESTIMATE,
  UPPER_BOUND,
  VIEW_COSTS,
  activeChecksNote,
  checksHeaderLine,
  costChecksRegionLine,
  coverageCardLine,
  coverageLine,
  found,
  noFilterMatches,
  nothingToActOnBody,
  opportunitiesHeading,
  plannedToggle,
  stillDetectedKpiNote,
  summaryFirmSavings,
  summaryNew,
  summaryOpen,
  summaryUpperBoundOnly,
  upperBoundOnly,
} from './costOptimizationCopy';

// Fetching more than this in one page is an edge case; the KPI tile (sourced
// from /stats, not this list) always shows the true total regardless, and
// the list header discloses when it's showing a subset -- see
// "Showing N of Total" below. No backend pagination change was made for
// this; see the implementation report's "known limitation" note.
const RECOMMENDATIONS_FETCH_LIMIT = 100;

// A detector may disclose its savings figure as a ceiling (e.g. S3 lifecycle:
// assumes 100% of current Standard storage transitions, no retrieval fees
// netted out) rather than an ordinary expected saving -- see
// backend/src/services/cost-optimization.service.ts's savings_basis metadata.
// The card must not present a ceiling as if it were a plain monthly estimate,
// nor a figure with no savings basis as any dollar amount.
function isSavingsCeiling(rec: CostRecommendation): boolean {
  return savingsBasisKind(rec) === 'ceiling';
}

// Despite the name (kept for call-site stability), this now shows 2 decimal
// places for a genuine sub-$1 amount rather than rounding it to "$0" -- see
// formatSavingsCurrency() in lib/utils.ts.
function formatWholeDollars(value: number): string {
  return formatSavingsCurrency(value);
}

function severityToBadge(sev: RecommendationSeverity): { severity: 'high' | 'medium' | 'low'; label: string } {
  return { severity: sev.toLowerCase() as 'high' | 'medium' | 'low', label: sev.charAt(0) + sev.slice(1).toLowerCase() };
}

// Fallback used only while the registry query hasn't resolved yet or fails --
// never the authoritative list. The Optimization Rule Registry
// (backend/src/config/optimization-rules.ts, served via
// GET /api/cost-recommendations/optimization-rules) is now the single source
// of truth for which checks are implemented vs planned; the frontend no
// longer maintains its own list.
const EMPTY_RULE_CATALOG: OptimizationRuleCatalog = {
  rules: [],
  summary: { totalRules: 0, implementedCount: 0, plannedCount: 0, services: [] },
};

// Zero on this page reads as muted, never green (founder decision 5: slate-500 for contrast).
const ZERO_CLASS = 'text-slate-500';

// High, Medium, Low: the open card's chips, the filter chips and the checks header, counts always from /stats.
// Only these three exist (no Critical tier in the data).
type SeverityKey = 'high' | 'medium' | 'low';
const SEVERITY_ROWS: readonly { key: SeverityKey; label: string; color: string }[] = [
  { key: 'high', label: 'High', color: 'bg-red-500' },
  { key: 'medium', label: 'Medium', color: 'bg-amber-500' },
  { key: 'low', label: 'Low', color: 'bg-slate-400' },
];

/** The id of the How DevControl checks section: the empty state's "See what's checked" opens it. */
const CHECKS_ANCHOR = 'how-devcontrol-checks';

/** "Nov 18, 2026" from a recommendation's createdAt; nothing for a missing or unreadable date. */
function foundDate(iso: string | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : format(date, 'MMM d, yyyy');
}

/**
 * One card's figure, labelled by its basis (lib/savings-basis): an estimate in dark text, an upper bound as
 * "Up to $X/mo" with "upper bound" in grey, no basis as "No dollar estimate" in grey.
 */
function OpportunitySavings({ rec }: { rec: CostRecommendation }) {
  const kind = savingsBasisKind(rec);
  return (
    <div className="sm:text-right" data-testid="opportunity-savings">
      <p className={cn('text-section tabular-nums sm:whitespace-nowrap', kind === 'estimate' ? 'text-slate-900' : 'text-ink-muted')}>
        {isLowActivityFinding(rec)
          ? lowActivitySavingsHeadline(rec.potentialSavings, formatSavingsCurrency, savingsBasisKind(rec))
          : formatRecommendationSavings(rec, formatSavingsCurrency)}
      </p>
      {isSavingsCeiling(rec) && (
        <p className="text-label text-ink-muted font-medium">{UPPER_BOUND}</p>
      )}
      {isDefaultPriceEstimate(rec) && (
        <p className="text-label text-ink-muted font-medium sm:max-w-[16rem] sm:ml-auto" data-testid="default-price-disclosure">{DEFAULT_PRICE_DISCLOSURE}</p>
      )}
      {isLowActivityFinding(rec) && (
        <p className="text-label text-ink-muted font-medium sm:max-w-[16rem] sm:ml-auto" data-testid="low-activity-savings-basis">
          {!isDefaultPriceEstimate(rec) && typeof rec.metadata?.instance_type === 'string'
            ? lowActivityListPriceBasis(rec.metadata.instance_type)
            : LOW_ACTIVITY_STORAGE_NOTE}
        </p>
      )}
    </div>
  );
}

export default function CostOptimizationPage() {
  const queryClient = useQueryClient();
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const demoMode = useDemoMode();
  const salesDemoMode = useSalesDemo((state) => state.enabled);
  const isDemoActive = demoMode || salesDemoMode;

  // Same data source and gating as the dashboard's Savings Actions card
  // (app/(app)/dashboard/page.tsx queryKey ['cost-recommendations']): real
  // cost_recommendations only, disabled during demo mode, no fabricated fallback.
  const { data: recommendations = [], isLoading, error, refetch } = useQuery<CostRecommendation[]>({
    queryKey: ['cost-recommendations', 'ACTIVE', RECOMMENDATIONS_FETCH_LIMIT],
    queryFn: () => costRecommendationsService.getAll({ status: 'ACTIVE', limit: RECOMMENDATIONS_FETCH_LIMIT }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    enabled: !isDemoActive,
  });

  // Server-derived totals -- same endpoint the Dashboard uses
  // (queryKey ['cost-recommendations-stats']) -- instead of re-deriving
  // totals by reducing the (now potentially-truncated) list above.
  const { data: stats, isLoading: statsLoading, isError: statsError, refetch: refetchStats } = useQuery({
    queryKey: ['cost-recommendations-stats'],
    queryFn: costRecommendationsService.getStats,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    enabled: !isDemoActive,
  });

  // Real AWS-connection signal, same endpoint/service the Dashboard uses to
  // compute isAwsConnected.
  const { data: awsAccounts, isError: accountsError, refetch: refetchAccounts } = useQuery({
    queryKey: ['aws-accounts'],
    queryFn: awsAccountsService.getAccountsAndConnection,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !isDemoActive,
  });

  // The latest scheduled discovery's warnings (DiscoveryWarningNotice). The scan
  // status never reads a job's status or error text: only an organization with
  // no cost analysis run at all falls back to its cost_analysis_completed flag
  // (costScanState.ts).
  const { data: discoveryJobs, isError: jobsError, refetch: refetchJobs } = useQuery({
    queryKey: ['discovery-jobs', 5],
    queryFn: () => awsResourcesService.getDiscoveryJobs(5),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    enabled: !isDemoActive,
  });

  // Every cost analysis, manual and scheduled: the page's only scan status
  // source (founder decision 10). Its own key: the Costs page caches the
  // manual-only list under ['cost-analysis-runs', 5]. Polls while a run is running.
  const { data: analysisRuns, isError: runsError, refetch: refetchRuns } = useQuery({
    queryKey: ['cost-analysis-runs', 'all', 5],
    queryFn: () => costRecommendationsService.getAnalysisRuns(5, 'all'),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => runsRefetchInterval(query.state.data),
    enabled: !isDemoActive,
  });

  // The Optimization Rule Registry catalog -- authoritative source for which
  // checks are implemented vs planned. This is code-defined backend metadata,
  // not org-scoped AWS data, so it changes rarely; a long staleTime avoids
  // needless refetches.
  const { data: ruleCatalog = EMPTY_RULE_CATALOG, isLoading: rulesLoading, isError: rulesError } = useQuery({
    queryKey: ['optimization-rules'],
    queryFn: costRecommendationsService.getOptimizationRules,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    enabled: !isDemoActive,
  });
  // Multi-region flag-on prep (X6): the coverage response, only to know whether multi-region scanning is
  // switched on for this organization (`multi_region`) and its savings region. Nothing renders without it.
  const { data: servicesCoverage } = useQuery({
    queryKey: ['services-coverage'],
    queryFn: () => awsServicesService.getCoverage(),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
    enabled: !isDemoActive,
  });
  const checksRegionLine = costChecksRegionLine(servicesCoverage?.multi_region);
  const implementedRules = ruleCatalog.rules.filter((rule) => rule.status === 'implemented');
  const plannedRules = ruleCatalog.rules.filter((rule) => rule.status === 'planned');

  // Resolved and dismissed findings, one per finding, with the backend's
  // still-detected judgement (PR 3a). Rendered as returned; a failed request
  // is never shown as empty, even when an earlier response is cached.
  const hiddenQuery = useQuery({
    queryKey: ['cost-recommendations-hidden'],
    queryFn: costRecommendationsService.getHidden,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    enabled: !isDemoActive,
  });
  const hiddenView: HiddenView = hiddenQuery.isError
    ? { status: 'error' }
    : hiddenQuery.data === undefined
      ? { status: 'loading' }
      : { status: 'ready', data: hiddenQuery.data };
  const stillDetectedCount = hiddenView.status === 'ready' ? hiddenView.data.summary.stillDetected.count : null;
  // States with their own empty-state card (LIVE copy): shown at once, without waiting
  // for /hidden. The plain empty state waits for /hidden (it may point to findings below).
  const STATUS_CARD_KEYS: readonly string[] = ['not_connected', 'never_analyzed', 'running', 'failed', 'completed_unrecorded'];

  const role = useCurrentRole();

  // After any decision: the list, totals and hidden groups refetch together so
  // they agree. ['cost-recommendations'] is a prefix of the list keys only;
  // the other keys (this page's hidden and stats, Costs' active list,
  // Infrastructure's count) are named one by one.
  const invalidateRecommendationData = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['cost-recommendations'] }),
    queryClient.invalidateQueries({ queryKey: ['cost-recommendations-stats'] }),
    queryClient.invalidateQueries({ queryKey: ['cost-recommendations-hidden'] }),
    queryClient.invalidateQueries({ queryKey: ['cost-recommendations-active'] }),
    queryClient.invalidateQueries({ queryKey: ['cost-recommendations-count'] }),
  ]);

  // Reopen and dismiss on hidden findings. One action per finding at a time:
  // the ref blocks a second submission before React re-renders, and the
  // buttons stay disabled until the refresh after it has finished.
  const inFlight = useRef(new Set<string>());
  const [pendingHiddenIds, setPendingHiddenIds] = useState<ReadonlySet<string>>(new Set());
  const runHiddenAction = async (id: string, action: 'reopen' | 'dismiss') => {
    if (inFlight.current.has(id)) return;
    inFlight.current.add(id);
    setPendingHiddenIds(new Set(inFlight.current));
    try {
      try {
        if (action === 'reopen') {
          const result = await costRecommendationsService.reopen(id);
          if (!result.reopened) toast.info(ALREADY_REOPENED);
          else toast.success(result.activeNow ? REOPENED_ACTIVE : REOPENED_PENDING);
        } else {
          await costRecommendationsService.dismiss(id);
          toast.success(DISMISSED_TOAST);
        }
      } catch {
        toast.error(action === 'reopen' ? REOPEN_FAILED : DISMISS_FAILED_TOAST);
      }
      await invalidateRecommendationData();
    } finally {
      inFlight.current.delete(id);
      setPendingHiddenIds(new Set(inFlight.current));
    }
  };
  const hiddenActions = {
    role,
    pendingIds: pendingHiddenIds,
    onReopen: (id: string) => { void runHiddenAction(id, 'reopen'); },
    onDismiss: (id: string) => { void runHiddenAction(id, 'dismiss'); },
  };

  const resolveMutation = useMutation({
    mutationFn: costRecommendationsService.resolve,
    onSuccess: () => {
      invalidateRecommendationData();
      toast.success('Recommendation marked as resolved');
    },
    onError: () => toast.error('Failed to resolve recommendation'),
  });

  const dismissMutation = useMutation({
    mutationFn: costRecommendationsService.dismiss,
    onSuccess: () => {
      invalidateRecommendationData();
      toast.success('Recommendation dismissed');
    },
    onError: () => toast.error('Failed to dismiss recommendation'),
  });

  // "Run cost analysis": its progress and result in the top banner slot (light-lane layout, founder ruling 1),
  // in place of the Latest analysis banner until closed or auto-hidden. Never a toast.
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const runId = useRef(0);
  const closeRunResult = useCallback(() => setRunResult(null), []);

  const handleScan = async () => {
    const id = ++runId.current;
    setIsAnalyzing(true);
    setRunResult({ phase: 'running', id });
    try {
      const result = await costRecommendationsService.analyze();
      await Promise.all([
        refetch(),
        queryClient.invalidateQueries({ queryKey: ['cost-recommendations-stats'] }),
        // The backend now records this run in cost_analysis_runs -- refresh
        // so "Last Analysis" reflects it immediately instead of only the
        // next 60s staleTime refetch.
        queryClient.invalidateQueries({ queryKey: ['cost-analysis-runs'] }),
        // The run records which hidden findings it found again.
        queryClient.invalidateQueries({ queryKey: ['cost-recommendations-hidden'] }),
      ]);
      // The result's "resolved found again" is /hidden's still-detected count, refetched above:
      // the same number the banner and the Still detected group show (founder ruling 8).
      // A failed refetch is unknown (null), never the previous answer.
      const hiddenState = queryClient.getQueryState<HiddenFindings>(['cost-recommendations-hidden']);
      const stillDetectedNow = hiddenState?.status === 'success' && hiddenState.data ? hiddenState.data.summary.stillDetected.count : null;
      // The banner's text and colour are analyzeToast()'s (founder ruling 7): the same honest details the toast gave.
      const message = analyzeToast(result, stillDetectedNow);
      setRunResult({ phase: 'finished', id, kind: message.kind, text: message.text });
    } catch (err: unknown) {
      setRunResult({ phase: 'failed', id, message: analyzeFailureMessage(err) });
      // The backend recorded this attempt too: the status must not keep showing the previous one.
      await queryClient.invalidateQueries({ queryKey: ['cost-analysis-runs'] });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const pendingMutation = (id: string) => resolveMutation.isPending && resolveMutation.variables === id
    || dismissMutation.isPending && dismissMutation.variables === id;

  // The server's connection state, never the row count: undefined (not known) while
  // loading, on a failed check, or with more than one active connection.
  const connectionState = awsAccounts?.connection;
  const awsConnected = connectionState === 'connected' ? true : connectionState === 'not_connected' ? false : undefined;
  const scan = deriveCostScanState({
    connection: { data: connectionState, isError: accountsError },
    runs: { data: analysisRuns, isError: runsError },
    jobs: { data: discoveryJobs, isError: jobsError },
    isAnalyzing,
  });
  const retryStatus = () => {
    if (accountsError) refetchAccounts();
    if (runsError) refetchRuns();
    if (jobsError) refetchJobs();
  };

  // A failed stats fetch is never shown as 0 or $0 (pr2-step1.md state 12).
  const statsAvailable = stats !== undefined && !statsError;
  const activeCount = statsAvailable ? stats.activeRecommendations : null;
  const totalEverCount = statsAvailable ? stats.totalRecommendations : 0;
  const monthlySavings = statsAvailable ? stats.totalPotentialSavings : null;
  // Findings with a positive estimate: a cent-rounded total of 0 with some behind it reads "<$0.01" (formatSavingsTotal).
  const estimatedFindings = statsAvailable ? stats.estimatedFindings : null;
  // Upper bounds (S3 lifecycle, DynamoDB capacity), one line per type, never added to the total.
  // Rendered only when the monthly figure is available (below), so a failed stats fetch shows none.
  const ceilingLines = describeCeilings(stats?.potentialSavingsCeilingByResourceType ?? {}, formatWholeDollars);
  const monthlyLabel = monthlySavings === null ? null : formatSavingsTotal(monthlySavings, estimatedFindings);
  const bySeverity = statsAvailable ? stats.bySeverity : null;

  // The banner states a resolved finding "found again" only from /hidden's judgement, the
  // same count the Still detected group and C12 read, so one finding never gets two states.
  const banner = bannerContent(scan, {
    hidden: hiddenView.status === 'ready'
      ? { stillDetected: hiddenView.data.summary.stillDetected.count, notConfirmed: hiddenView.data.summary.notConfirmed }
      : hiddenView.status,
    open: activeCount !== null ? activeCount : statsLoading ? 'loading' : 'error',
  });
  const bannerMeta = scan.completedAt && scan.source && (scan.key === 'failed' || scan.key === 'partial' || scan.key === 'interrupted' || scan.key.startsWith('completed'))
    ? `${BANNER_SOURCE_LABEL[scan.source]}, ${formatDistanceToNow(new Date(scan.completedAt), { addSuffix: true })}`
    : undefined;

  const canRunScan = !isAnalyzing && !isDemoActive && awsConnected !== false;
  const listedActiveCount = activeCount ?? recommendations.length;
  const hiddenCount = activeCount === null ? 0 : Math.max(0, activeCount - recommendations.length);
  // The legacy caveat names "each listed check" only when the rail lists them, and not while /hidden has failed (no conclusion).
  const checksVisible = hiddenView.status !== 'error' && implementedRules.length > 0;
  // The "Nothing to act on" empty state: only for a completed run that recorded every check as complete and found nothing new.
  const runCounts = scan.key.startsWith('completed') ? scan.counts : null;
  const ranAllChecks = runCounts !== null && runCounts.allChecksComplete && runCounts.new === 0;
  // Coverage counts the services with at least one active check, so "across N services" is true of the active ones.
  const activeServices = ruleCatalog.summary.services.filter((s) => s.implementedCount > 0);
  const catalogLoaded = ruleCatalog.summary.totalRules > 0;

  // High / Medium / Low from /stats; null (shown as "—", never 0) when stats are unavailable.
  const severityCounts = bySeverity ? { high: bySeverity.high, medium: bySeverity.medium, low: bySeverity.low } : null;
  const severityLine = SEVERITY_ROWS.map((row) => `${row.label} ${severityCounts ? severityCounts[row.key] : '—'}`).join(' · ');

  // Upper bounds are never added to the firm total; with no firm figure at all, the card says so (founder ruling 4).
  const ceilingTotal = statsAvailable ? stats.potentialSavingsCeiling : 0;
  // formatSavingsCurrency: whole dollars from $1, cents below, "<$0.01" under a cent; never "$0" for a positive bound.
  const ceilingLabel = ceilingTotal > 0 ? formatSavingsCurrency(ceilingTotal) : null;
  const upperBoundOnlySavings = monthlyLabel === '$0' && ceilingLabel !== null;

  // Opportunities: firm estimates first, then upper bounds, then no basis, each largest first (rankBySavings,
  // the Costs and Infrastructure pages' order). The severity filter only narrows the loaded list.
  const [severityFilter, setSeverityFilter] = useState<'all' | SeverityKey>('all');
  const visibleRecommendations = rankBySavings(recommendations)
    .filter((rec) => severityFilter === 'all' || rec.severity?.toLowerCase() === severityFilter);
  // A recommendation's check and service: the registry rule with the same issue (a lookup, not a calculation).
  const ruleByIssue = new Map(implementedRules.flatMap((rule) => (rule.issue ? [[rule.issue, rule] as const] : [])));

  // Summary: only open counts by severity, firm vs upper-bound savings and the latest run's new count (ruling 8).
  const summaryLines: string[] = [];
  if (activeCount !== null && severityCounts) {
    summaryLines.push(summaryOpen(activeCount, severityCounts.high, severityCounts.medium, severityCounts.low));
  }
  if (monthlyLabel !== null && activeCount !== null && activeCount > 0) {
    if (monthlyLabel !== '$0') summaryLines.push(summaryFirmSavings(monthlyLabel, ceilingLabel));
    else if (ceilingLabel !== null) summaryLines.push(summaryUpperBoundOnly(ceilingLabel));
    else summaryLines.push(SUMMARY_NO_ESTIMATE);
  }
  if (scan.counts) summaryLines.push(summaryNew(scan.counts.new));

  // "See what's checked": open the How DevControl checks section and bring it into view.
  const openChecks = (event: MouseEvent<HTMLAnchorElement>) => {
    const section = document.getElementById(CHECKS_ANCHOR) as HTMLDetailsElement | null;
    if (!section) return;
    event.preventDefault();
    section.open = true;
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    section.scrollIntoView?.({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    section.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true });
  };

  return (
    <div className="min-h-screen bg-gray-50 px-4 pt-page-top pb-6 sm:px-6 sm:pb-8 lg:px-14 lg:pb-10 max-w-[1320px] mx-auto">
      {/* ── TOP BANNER SLOT: the Run cost analysis result while it shows, otherwise the latest analysis. Never both. ── */}
      {!isDemoActive && (runResult ? (
        <RunResultBanner className="mb-6" result={runResult} onClose={closeRunResult} />
      ) : (
        <CostAnalysisBanner
          className="mb-6"
          content={banner}
          meta={bannerMeta}
          resultKey={`${scan.key}|${scan.completedAt ?? ''}`}
          onRetry={retryStatus}
          onReview={scrollToStillDetected}
        />
      ))}

      {/* ── HEADER: title, purpose, last analysis, Run cost analysis ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-6">
        <div className="min-w-0">
          <h1 className={cn(PAGE_TITLE_CLASS, 'mb-2')}>Cost Optimization</h1>
          <p className={cn(PAGE_SUBTITLE_CLASS, 'max-w-lg')}>
            DevControl identifies potential AWS cost-saving opportunities by checking your connected account
            against the categories below. Figures are estimated potential savings, not realized or billed savings.
          </p>
          {!isDemoActive && (
            <p className="text-meta text-ink-muted mt-2 flex flex-wrap items-center gap-x-1.5" data-testid="last-analysis">
              <span>{LAST_ANALYSIS}</span>
              {scan.key === 'loading' ? <Skeleton className="h-4 w-28" /> : scan.key === 'status_unavailable' ? (
                <span>{UNAVAILABLE}</span>
              ) : scan.key === 'not_connected' ? (
                <span>—</span>
              ) : scan.key === 'never_analyzed' ? (
                <span>Never</span>
              ) : scan.key === 'running' ? (
                <span>Running…</span>
              ) : scan.completedAt && scan.source ? (
                <span>{formatDistanceToNow(new Date(scan.completedAt), { addSuffix: true })} ({LAST_ANALYSIS_SOURCE[scan.source]})</span>
              ) : (
                <span>—</span>
              )}
            </p>
          )}
        </div>
        {!isDemoActive && awsConnected === false ? (
          <a
            href="/connect-aws"
            className="inline-flex min-h-11 w-full sm:w-auto items-center justify-center gap-2 text-white text-ui font-semibold px-5 py-2.5 rounded-lg bg-violet-700 hover:bg-violet-800 whitespace-nowrap no-underline transition-colors"
          >
            Connect AWS
          </a>
        ) : (
          <Button size="lg" onClick={handleScan} disabled={!canRunScan} className="min-h-11 w-full sm:w-auto whitespace-nowrap shrink-0">
            {isAnalyzing ? <><Loader2 size={16} className="mr-1.5 animate-spin" /> Scanning...</> : <><RefreshCw size={16} className="mr-1.5" /> Run cost analysis</>}
          </Button>
        )}
      </div>

      {isDemoActive ? (
        <div className="bg-white border border-slate-100 rounded-2xl p-12 text-center">
          <p className="text-ui font-semibold text-slate-900 mb-2">Cost recommendations aren&apos;t shown in demo mode</p>
          <p className="text-ui text-ink-muted">Turn off demo mode to see real optimization opportunities for your connected AWS account.</p>
        </div>
      ) : (
        <>
          {/* ── SUMMARY CARDS: three equal; on a phone Open + Coverage side by side, savings full width below ── */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4" data-testid="summary-cards">
            <Card className="order-1">
              <CardContent className="px-5">
                <p className="text-label font-semibold text-ink-muted uppercase tracking-wide mb-2">{OPEN_OPPORTUNITIES}</p>
                {statsLoading ? <Skeleton className="h-8 w-14" /> : activeCount === null ? (
                  <p className="text-section text-ink-muted">{UNAVAILABLE}</p>
                ) : (
                  <p className={cn('text-kpi tabular-nums', activeCount === 0 ? ZERO_CLASS : 'text-slate-900')}>{activeCount}</p>
                )}
                {!statsLoading && (
                  <ul className="flex flex-wrap gap-x-3 gap-y-1 list-none m-0 p-0 mt-2" data-testid="severity-chips" aria-label="Open opportunities by severity">
                    {SEVERITY_ROWS.map((row) => (
                      // Stats unavailable: "—", never 0.
                      <li key={row.key} className="inline-flex items-center gap-1.5 text-meta text-slate-700">
                        <span className={cn('h-2 w-2 rounded-full shrink-0', row.color)} aria-hidden="true" />
                        {row.label} <span className="font-semibold text-slate-900 tabular-nums">{severityCounts ? severityCounts[row.key] : '—'}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {/* Still-detected findings are not in this count (they come from /hidden, never /stats). */}
                {stillDetectedCount !== null && stillDetectedCount > 0 && (
                  <p className="text-meta text-ink-muted mt-1" data-testid="kpi-still-detected">{stillDetectedKpiNote(stillDetectedCount)}</p>
                )}
              </CardContent>
            </Card>
            <Card className="order-3 col-span-2 md:order-2 md:col-span-1">
              <CardContent className="px-5">
                <p className="text-label font-semibold text-ink-muted uppercase tracking-wide mb-2">{ESTIMATED_MONTHLY_SAVINGS}</p>
                {statsLoading ? <Skeleton className="h-8 w-24" /> : monthlyLabel === null ? (
                  <p className="text-section text-ink-muted">{UNAVAILABLE}</p>
                ) : upperBoundOnlySavings ? (
                  // Every open figure is an upper bound: grey, never a firm total (founder ruling 4).
                  <>
                    <p className="text-section tabular-nums text-ink-muted" data-testid="savings-upper-bound-only">{upperBoundOnly(ceilingLabel)}</p>
                    <p className="text-meta text-ink-muted mt-1">{NO_FIRM_ESTIMATE}</p>
                  </>
                ) : (
                  <>
                    <p className={cn('text-kpi tabular-nums', monthlyLabel === '$0' ? ZERO_CLASS : 'text-ink-success')}>{monthlyLabel}<span className="text-ui font-semibold text-ink-muted">/mo</span></p>
                    {ceilingLines.map((line) => (
                      <p key={line} className="text-meta text-ink-muted mt-1">{line}</p>
                    ))}
                  </>
                )}
              </CardContent>
            </Card>
            <Card className="order-2 md:order-3">
              <CardContent className="px-5">
                <p className="text-label font-semibold text-ink-muted uppercase tracking-wide mb-2">{COVERAGE}</p>
                {rulesLoading ? <Skeleton className="h-6 w-28" /> : rulesError || !catalogLoaded ? (
                  <p className="text-section text-ink-muted">{UNAVAILABLE}</p>
                ) : (
                  <p className="text-section text-slate-900 tabular-nums" data-testid="coverage-card-line">
                    {/* Each part kept whole, so a narrow card breaks between them, never inside one. */}
                    {coverageCardLine(ruleCatalog.summary.implementedCount, ruleCatalog.summary.totalRules, activeServices.length).split(' · ').map((part, index, parts) => (
                      <span key={part}>{index > 0 && ' '}<span className="whitespace-nowrap">{part}{index < parts.length - 1 && ' ·'}</span></span>
                    ))}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          {statsError && (
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <p className="text-label font-normal text-ink-muted">{STATS_UNAVAILABLE_NOTE}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => refetchStats()} className="max-sm:min-h-11">{TRY_AGAIN}</Button>
            </div>
          )}

          {/* ── TRUST / DISCLAIMER ── */}
          <p className="text-label font-normal text-ink-muted leading-relaxed mb-6 max-w-3xl">
            Savings figures are estimated potential savings based on DevControl&apos;s recommendation methodology, not confirmed AWS billing savings.
            Resolving or dismissing a recommendation records your decision — it does not itself confirm the underlying AWS change was made.
          </p>

          {/* The latest scheduled discovery's warnings: unchanged, and not scan status. */}
          <DiscoveryWarningNotice warnings={discoveryJobs?.[0]?.warnings} className="mb-6" />

          {/* ── OPPORTUNITIES / EMPTY STATE ── */}
          {/* 2fr / 1fr: opportunities on the left, the Summary on the right; stacked on a phone. */}
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-6 items-start">
            <div className="flex flex-col gap-6 min-w-0" data-testid="findings-column">
              {isLoading ? (
                <div className="flex items-center justify-center h-64">
                  <Loader2 size={24} className="animate-spin text-violet-600" />
                </div>
              ) : error ? (
                <div className="bg-white border border-red-100 rounded-2xl p-12 text-center">
                  {/* Fixed text: never the request error's own message (transport text such as "Request failed with status code 500"). */}
                  <p className="text-ui font-semibold text-slate-900 mb-4">Couldn&apos;t load recommendations. Try again.</p>
                  <button onClick={() => refetch()} className="min-h-11 bg-violet-700 hover:bg-violet-800 text-white text-label font-semibold px-5 py-2.5 rounded-lg border-none cursor-pointer transition-colors">
                    Try again
                  </button>
                </div>
              ) : recommendations.length === 0 && scan.key === 'loading' ? (
                // The status isn't known yet: no empty-state conclusion until it is.
                <div className="flex items-center justify-center h-64" data-testid="scan-status-loading">
                  <Loader2 size={24} className="animate-spin text-violet-600" />
                </div>
              ) : recommendations.length === 0 && hiddenView.status === 'loading' && !STATUS_CARD_KEYS.includes(scan.key) ? (
                // Whether anything is still detected isn't known yet: no empty-state conclusion until it is.
                <div className="flex items-center justify-center h-64" data-testid="hidden-status-loading">
                  <Loader2 size={24} className="animate-spin text-violet-600" />
                </div>
              ) : recommendations.length === 0 ? (
                <div className="bg-white border border-slate-100 rounded-2xl p-6 sm:p-8 text-left" data-testid="empty-state">
                  {scan.key === 'not_connected' ? (
                    <>
                      <CloudOff size={28} className="text-slate-400 mb-3" aria-hidden="true" />
                      <p className="text-ui font-semibold text-slate-900 mb-2">Connect AWS to check for savings</p>
                      <p className="text-ui text-ink-muted">DevControl needs a connected AWS account before it can look for cost-saving opportunities.</p>
                    </>
                  ) : scan.key === 'never_analyzed' ? (
                    <>
                      <Clock size={28} className="text-slate-400 mb-3" aria-hidden="true" />
                      <p className="text-ui font-semibold text-slate-900 mb-2">No analysis has run yet</p>
                      <p className="text-ui text-ink-muted">Run your first cost analysis to check for savings opportunities.</p>
                    </>
                  ) : scan.key === 'running' ? (
                    <>
                      <Loader2 size={28} className="text-violet-500 mb-3 animate-spin" aria-hidden="true" />
                      <p className="text-ui font-semibold text-slate-900 mb-2">Analysis in progress</p>
                      <p className="text-ui text-ink-muted">DevControl is currently checking your account. This can take a few minutes.</p>
                    </>
                  ) : scan.key === 'failed' ? (
                    <>
                      <AlertTriangle size={28} className="text-red-500 mb-3" aria-hidden="true" />
                      <p className="text-ui font-semibold text-slate-900 mb-2">
                        The last {scan.source ? SOURCE_LABEL[scan.source].toLowerCase() : 'analysis'} didn&apos;t complete
                      </p>
                      <p className="text-ui text-ink-muted">{scan.errorMessage || 'Something interrupted the scan before it finished.'}</p>
                    </>
                  ) : ranAllChecks ? (
                    // The run completed every check and found nothing new (founder ruling 5). Still-detected
                    // findings show below it, in their own group.
                    <div data-testid="empty-all-checks">
                      <CheckCircle2 size={28} className="text-green-700 mb-3" aria-hidden="true" />
                      <h2 className="text-ui font-semibold text-slate-900 mb-2">{NOTHING_TO_ACT_ON}</h2>
                      <p className="text-ui text-ink-muted">{nothingToActOnBody(runCounts.checksTotal)}</p>
                      <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3">
                        {catalogLoaded && (
                          <a href={`#${CHECKS_ANCHOR}`} onClick={openChecks} className="inline-flex min-h-11 items-center text-ui font-semibold text-violet-700 hover:text-violet-800">
                            {SEE_WHATS_CHECKED}
                          </a>
                        )}
                        <Link href="/costs" className="inline-flex min-h-11 items-center text-ui font-semibold text-violet-700 hover:text-violet-800">
                          {VIEW_COSTS}
                        </Link>
                      </div>
                    </div>
                  ) : (
                    // Nothing open. The banner states the run's result once; this card doesn't repeat it
                    // (founder fix, PR 3b). Still-detected findings show below it, in their own group.
                    <>
                      <Clock size={28} className="text-slate-400 mb-3" aria-hidden="true" />
                      <p className="text-ui font-semibold text-slate-900">No active recommendations to review</p>
                      {/* A run from before per-check results were recorded keeps its LIVE caveat. */}
                      {scan.key === 'completed_unrecorded' && (totalEverCount > 0 || checksVisible) && (
                        <p className="text-ui text-ink-muted mt-2" data-testid="legacy-caveat">
                          {totalEverCount > 0 ? `Previously identified items have been resolved or dismissed.${checksVisible ? ' ' : ''}` : ''}
                          {/* "each listed check" only when the checks section lists them. */}
                          {checksVisible && LEGACY_CHECKS_CAVEAT}
                        </p>
                      )}
                    </>
                  )}
                </div>
              ) : (
                <section className="flex flex-col gap-3" aria-labelledby="opportunities-heading" data-testid="opportunities">
                  <div className="flex items-baseline justify-between gap-3 flex-wrap">
                    <h2 id="opportunities-heading" className="text-ui font-semibold text-slate-900">{opportunitiesHeading(listedActiveCount)}</h2>
                    {hiddenCount > 0 && (
                      <p className="text-label font-normal text-ink-muted">
                        {`Showing ${recommendations.length} of ${activeCount} active opportunities`} · Sorted by highest potential savings first
                      </p>
                    )}
                  </div>

                  {/* Severity filter: All · High · Medium · Low with /stats counts; scrolls sideways on a phone, never wraps. */}
                  <div role="group" aria-label={SEVERITY_FILTER_LABEL} className="-mx-4 flex flex-nowrap gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0" data-testid="severity-filter">
                    {([{ key: 'all', label: ALL, count: activeCount }, ...SEVERITY_ROWS.map((row) => ({ key: row.key, label: row.label, count: severityCounts ? severityCounts[row.key] : null }))] as const).map((chip) => (
                      <button
                        key={chip.key}
                        type="button"
                        aria-pressed={severityFilter === chip.key}
                        onClick={() => setSeverityFilter(chip.key)}
                        className={cn(
                          'inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-label font-semibold whitespace-nowrap transition-colors sm:min-h-9',
                          severityFilter === chip.key ? 'border-violet-700 bg-violet-700 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
                        )}
                      >
                        {chip.label}
                        <span className="tabular-nums">{chip.count ?? '—'}</span>
                      </button>
                    ))}
                  </div>

                  {visibleRecommendations.length === 0 ? (
                    <p className="text-meta text-ink-muted" data-testid="filter-empty">{noFilterMatches(SEVERITY_ROWS.find((row) => row.key === severityFilter)?.label ?? severityFilter)}</p>
                  ) : visibleRecommendations.map((rec) => {
                    const rule = ruleByIssue.get(rec.issue);
                    const service = rule?.service ?? rec.resourceType;
                    const foundOn = foundDate(rec.createdAt);
                    const meta = [foundOn && found(foundOn), rule?.name].filter(Boolean).join(' · ');
                    return (
                      <article key={rec.id} className="bg-white rounded-xl p-4 sm:p-5 border border-slate-200 min-w-0" data-testid="opportunity-card">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          {rec.severity && <SeverityBadge {...severityToBadge(rec.severity)} />}
                          {service && <span className="bg-slate-100 text-ink-muted text-label font-medium px-2 py-0.5 rounded-full" data-testid="service-chip">{service}</span>}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 items-start">
                          <div className="min-w-0">
                            <h3 className="text-ui font-semibold text-slate-900">{displayIssue(rec) || '—'}</h3>
                            <p className="font-mono text-meta text-ink-muted break-all mt-0.5" data-testid="resource-region">
                              {[rec.resourceName, rec.resourceId || '—', rec.awsRegion].filter(Boolean).map((part, index) => (
                                <span key={index}>{index > 0 && ' · '}<span>{part}</span></span>
                              ))}
                            </p>
                            {rec.description && <p className="text-meta text-ink-muted leading-relaxed mt-2">{rec.description}</p>}
                          </div>
                          <OpportunitySavings rec={rec} />
                        </div>
                        <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
                          <p className="text-label font-normal text-ink-muted" data-testid="opportunity-meta">{meta}</p>
                          <div className="flex gap-2">
                            <button
                              onClick={() => dismissMutation.mutate(rec.id)}
                              disabled={pendingMutation(rec.id)}
                              className="flex min-h-11 items-center gap-1 bg-transparent text-ink-muted px-3 py-1.5 rounded-lg text-label font-medium border border-slate-200 hover:bg-slate-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed sm:min-h-9"
                            >
                              <XCircle size={12} /> Dismiss
                            </button>
                            <button
                              onClick={() => resolveMutation.mutate(rec.id)}
                              disabled={pendingMutation(rec.id)}
                              className="flex min-h-11 items-center gap-1 bg-green-600 hover:bg-green-700 text-white px-3.5 py-1.5 rounded-lg text-label font-semibold border-none cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-not-allowed sm:min-h-9"
                            >
                              <CheckCircle size={12} /> Resolve
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </section>
              )}

              {/* ── STILL DETECTED: resolved findings the latest analysis found again (PR 3b), never collapsed ── */}
              <StillDetectedSlot view={hiddenView} actions={hiddenActions} onRetry={() => hiddenQuery.refetch()} retrying={hiddenQuery.isFetching} />
            </div>

            {/* ── SUMMARY: sentences from /stats and the latest run only ── */}
            <div className="flex flex-col gap-4 min-w-0" data-testid="summary-column">
              <Card data-testid="summary-card">
                <CardHeader className="px-5 pb-0"><h2 className="text-ui font-semibold text-slate-900">{SUMMARY}</h2></CardHeader>
                <CardContent className="px-5">
                  {statsLoading ? <Skeleton className="h-16 w-full" /> : summaryLines.length === 0 ? (
                    <p className="text-meta text-ink-muted">{STATS_UNAVAILABLE_NOTE}</p>
                  ) : (
                    <ul className="flex flex-col gap-2 list-disc pl-5 m-0" data-testid="summary-lines">
                      {summaryLines.map((line) => <li key={line} className="text-meta text-slate-700">{line}</li>)}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

          {/* ── HOW DEVCONTROL CHECKS: full width, closed by default. Registry-derived, never a hardcoded "every rule
              active" claim: an implementedCount below totalRules is expected and disclosed (config/optimization-rules.ts). ── */}
          {catalogLoaded && (
            <details id={CHECKS_ANCHOR} className="group mt-6 bg-white border border-slate-200 rounded-xl scroll-mt-24" data-testid="checks-section">
              <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 [&::-webkit-details-marker]:hidden">
                <span className="text-ui font-semibold text-slate-900">{HOW_DEVCONTROL_CHECKS}</span>
                {/* Phone: the counts wrap onto their own line under the title, the chevron stays beside the title. */}
                <ChevronDown size={16} className="ml-auto shrink-0 text-ink-muted transition-transform group-open:rotate-180 sm:order-last sm:ml-0" aria-hidden="true" />
                <span className="text-meta text-ink-muted tabular-nums basis-full min-w-0 sm:basis-auto sm:flex-1" data-testid="checks-summary-line">
                  {checksHeaderLine(ruleCatalog.summary.implementedCount, ruleCatalog.summary.totalRules, activeServices.length)} · {severityLine}
                </span>
              </summary>
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-6 border-t border-slate-100 px-5 py-5">
                {implementedRules.length > 0 ? (
                  <div className="min-w-0" data-testid="checks-card">
                    <ul className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-1.5 list-none m-0 p-0" data-testid="check-names">
                      {implementedRules.map((rule) => (
                        <li key={rule.id} className="flex items-start gap-2 text-label font-semibold text-slate-700">
                          <Server size={13} className="text-slate-400 mt-0.5 shrink-0" aria-hidden="true" />
                          <span className="min-w-0">{rule.name}</span>
                        </li>
                      ))}
                    </ul>
                    {checksRegionLine && (
                      <p className="text-label font-normal text-ink-muted mt-3 leading-relaxed" data-testid="checks-region-line">{checksRegionLine}</p>
                    )}
                    <details className="mt-3" data-testid="how-checks-work">
                      <summary className="cursor-pointer text-label font-semibold text-violet-700 max-sm:py-3.5">{HOW_EACH_CHECK_WORKS}</summary>
                      <div className="flex flex-col gap-3 mt-2">
                        {implementedRules.map((rule) => (
                          <div key={rule.id}>
                            <p className="text-label font-semibold text-slate-700">{rule.name}</p>
                            <p className="text-label font-normal text-ink-muted leading-snug">{rule.detail}</p>
                          </div>
                        ))}
                      </div>
                    </details>
                    <p className="text-label font-normal text-ink-muted mt-3 leading-relaxed border-t border-slate-100 pt-3" data-testid="checks-count-note">
                      {activeChecksNote(implementedRules.length)}
                    </p>
                  </div>
                ) : <div />}
                <div className="min-w-0" data-testid="coverage-card">
                  <p className="text-label font-normal text-ink-muted leading-relaxed mb-3" data-testid="coverage-line">
                    {coverageLine(ruleCatalog.summary.implementedCount, ruleCatalog.summary.totalRules, activeServices.length)}
                  </p>
                  {activeServices.length > 0 && (
                    <div className="flex flex-wrap gap-1.5" data-testid="coverage-services">
                      {activeServices.map((s) => (
                        <span key={s.service} className="text-label font-medium px-2 py-0.5 rounded-full bg-green-50 text-green-700">{s.service}</span>
                      ))}
                    </div>
                  )}
                  {plannedRules.length > 0 && (
                    <details className="mt-3 border-t border-slate-100 pt-3" data-testid="planned-checks">
                      <summary className="cursor-pointer text-label font-semibold text-violet-700 max-sm:py-3.5">{plannedToggle(plannedRules.length)}</summary>
                      <div className="flex flex-col gap-1.5 mt-2">
                        {plannedRules.map((rule) => (
                          <p key={rule.id} className="text-label font-normal text-ink-muted leading-snug">
                            {rule.service} — {rule.name}
                          </p>
                        ))}
                      </div>
                    </details>
                  )}
                  <p className="text-label font-normal text-ink-muted mt-3 leading-relaxed border-t border-slate-100 pt-3" data-testid="no-critical-note">
                    {NO_CRITICAL_TIER}
                  </p>
                </div>
              </div>
            </details>
          )}

          {/* ── RESOLVED AND DISMISSED: every decided finding, collapsed (PR 3b), at the bottom. Absent while /hidden is loading or failed. ── */}
          {hiddenView.status === 'ready' && (
            <div className="mt-6">
              <ReviewList data={hiddenView.data} actions={hiddenActions} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
