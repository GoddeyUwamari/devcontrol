'use client';

import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Loader2,
  RefreshCw,
  CheckCircle,
  XCircle,
  CloudOff,
  Clock,
  AlertTriangle,
  Server,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { costRecommendationsService } from '@/lib/services/cost-recommendations.service';
import awsAccountsService from '@/lib/services/aws-accounts.service';
import { awsResourcesService } from '@/lib/services/aws-resources.service';
import type { CostRecommendation, RecommendationSeverity } from '@/lib/types';
import type { OptimizationRuleCatalog } from '@/lib/services/cost-recommendations.service';
import { useDemoMode } from '@/components/demo/demo-mode-toggle';
import { useCurrentRole } from '@/lib/hooks/use-current-role';
import { useSalesDemo } from '@/lib/demo/sales-demo-data';
import { annualizeMonthly, cn, formatSavingsCurrency } from '@/lib/utils';
import { PAGE_SUBTITLE_CLASS, PAGE_TITLE_CLASS } from '@/components/ui/typography';
import { DEFAULT_PRICE_DISCLOSURE, describeCeilings, formatRecommendationSavings, isDefaultPriceEstimate, savingsBasisKind } from '@/lib/savings-basis';
import { LOW_ACTIVITY_STORAGE_NOTE, displayIssue, isLowActivityFinding, lowActivityListPriceBasis, lowActivitySavingsHeadline } from '@/lib/finding-display';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { SeverityBadge } from '@/components/ui/severity-badge';
import { Skeleton } from '@/components/ui/skeleton';
import { DiscoveryWarningNotice } from '@/components/aws/discovery-warning-notice';
import { ScanStatusBanner } from '@/components/ui/scan-status-banner';
import { analyzeFailureMessage } from './costOptimizationStatus';
import { deriveCostScanState, runsRefetchInterval } from './costScanState';
import {
  SOURCE_LABEL,
  STATS_UNAVAILABLE_NOTE,
  TRY_AGAIN,
  UNAVAILABLE,
  analyzeToast,
  bannerContent,
} from './costScanBanner';
import { ReviewList, StillDetectedSlot, type HiddenView } from './HiddenFindings';
import {
  ALREADY_REOPENED,
  DISMISSED_TOAST,
  DISMISS_FAILED_TOAST,
  REOPENED_ACTIVE,
  REOPENED_PENDING,
  REOPEN_FAILED,
  checksLine,
} from './hiddenFindingsCopy';

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
  const { data: ruleCatalog = EMPTY_RULE_CATALOG } = useQuery({
    queryKey: ['optimization-rules'],
    queryFn: costRecommendationsService.getOptimizationRules,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    enabled: !isDemoActive,
  });
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
  // States with their own empty-state card (LIVE copy). The still-detected group
  // replaces only the plain "No active recommendations to review" card, never these.
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

  const handleScan = async () => {
    setIsAnalyzing(true);
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
      const message = analyzeToast(result);
      toast[message.kind](message.text);
    } catch (err: unknown) {
      toast.error(analyzeFailureMessage(err));
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
  const banner = bannerContent(scan);
  const bannerMeta = scan.completedAt && scan.source && (scan.key === 'failed' || scan.key === 'partial' || scan.key === 'interrupted' || scan.key.startsWith('completed'))
    ? `${SOURCE_LABEL[scan.source]}, ${formatDistanceToNow(new Date(scan.completedAt), { addSuffix: true })}`
    : undefined;
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
  // Upper bounds (S3 lifecycle, DynamoDB capacity), one line per type, never added to the total.
  // Rendered only when the monthly figure is available (below), so a failed stats fetch shows none.
  const ceilingLines = describeCeilings(stats?.potentialSavingsCeilingByResourceType ?? {}, formatWholeDollars);
  const annualSavings = monthlySavings === null ? null : annualizeMonthly(monthlySavings);
  const bySeverity = statsAvailable ? stats.bySeverity : null;

  const canRunScan = !isAnalyzing && !isDemoActive && awsConnected !== false;
  const listedActiveCount = activeCount ?? recommendations.length;
  const hiddenCount = activeCount === null ? 0 : Math.max(0, activeCount - recommendations.length);
  // E1: the checks as one small left-aligned line (replaces the centred list).
  // The check list is hidden while /hidden has failed (no conclusion), or when the catalog has no checks.
  const checksVisible = hiddenView.status !== 'error' && implementedRules.length > 0;
  const checksNote = implementedRules.length > 0 ? (
    <p className="text-label font-normal text-ink-muted mt-4" data-testid="checks-line">{checksLine(implementedRules.map((rule) => rule.name))}</p>
  ) : null;

  return (
    <div className="min-h-screen bg-gray-50 px-4 pt-page-top pb-6 sm:px-6 sm:pb-8 lg:px-14 lg:pb-10 max-w-[1320px] mx-auto">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-8">
        <div>
          <h1 className={cn(PAGE_TITLE_CLASS, 'mb-2')}>Cost Optimization</h1>
          <p className={cn(PAGE_SUBTITLE_CLASS, 'max-w-lg')}>
            DevControl identifies potential AWS cost-saving opportunities by checking your connected account
            against the categories below. Figures are estimated potential savings, not realized or billed savings.
          </p>
        </div>
        {!isDemoActive && awsConnected === false ? (
          <a
            href="/connect-aws"
            className="inline-flex items-center gap-2 text-white text-ui font-semibold px-5 py-2.5 rounded-lg bg-violet-700 hover:bg-violet-800 whitespace-nowrap no-underline transition-colors"
          >
            Connect AWS
          </a>
        ) : (
          <Button size="lg" onClick={handleScan} disabled={!canRunScan} className="whitespace-nowrap shrink-0">
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
          {/* ── LATEST ANALYSIS: the scan result, above the KPIs (founder decision, Nov 2) ── */}
          <ScanStatusBanner
            className="mb-6"
            tone={banner.tone}
            title={banner.title}
            description={banner.description}
            icon={banner.icon}
            busy={banner.busy}
            loading={banner.loading}
            meta={bannerMeta}
            action={banner.retry ? { label: TRY_AGAIN, onClick: retryStatus } : undefined}
          />

          {/* ── KPI AREA ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <Card>
              <CardContent className="px-5">
                <p className="text-label font-semibold text-ink-muted uppercase tracking-wide mb-2">Active Opportunities</p>
                {statsLoading ? <Skeleton className="h-8 w-14" /> : activeCount === null ? (
                  <p className="text-section text-ink-muted">{UNAVAILABLE}</p>
                ) : (
                  <p className={cn('text-kpi tabular-nums', activeCount === 0 ? ZERO_CLASS : 'text-slate-900')}>{activeCount}</p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="px-5">
                <p className="text-label font-semibold text-ink-muted uppercase tracking-wide mb-2">Estimated Monthly Savings</p>
                {statsLoading ? <Skeleton className="h-8 w-24" /> : monthlySavings === null ? (
                  <p className="text-section text-ink-muted">{UNAVAILABLE}</p>
                ) : (
                  <>
                    <p className={cn('text-kpi tabular-nums', monthlySavings === 0 ? ZERO_CLASS : 'text-ink-success')}>{formatWholeDollars(monthlySavings)}<span className="text-ui font-semibold text-ink-muted">/mo</span></p>
                    {ceilingLines.map((line) => (
                      <p key={line} className="text-meta text-ink-muted mt-1">{line}</p>
                    ))}
                  </>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="px-5">
                <p className="text-label font-semibold text-ink-muted uppercase tracking-wide mb-2">Estimated Annual Savings</p>
                {statsLoading ? <Skeleton className="h-8 w-24" /> : annualSavings === null ? (
                  <p className="text-section text-ink-muted">{UNAVAILABLE}</p>
                ) : (
                  <p className={cn('text-kpi tabular-nums', annualSavings === 0 ? ZERO_CLASS : 'text-ink-success')}>{formatWholeDollars(annualSavings)}<span className="text-ui font-semibold text-ink-muted">/yr</span></p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="px-5">
                <p className="text-label font-semibold text-ink-muted uppercase tracking-wide mb-2">Last Analysis</p>
                {scan.key === 'loading' ? <Skeleton className="h-6 w-20" /> : scan.key === 'status_unavailable' ? (
                  <p className="text-section text-ink-muted">{UNAVAILABLE}</p>
                ) : scan.key === 'not_connected' ? (
                  <p className="text-section text-ink-muted">—</p>
                ) : scan.key === 'never_analyzed' ? (
                  <p className="text-section text-ink-muted">Never</p>
                ) : scan.key === 'running' ? (
                  <p className="text-section text-violet-600">Running…</p>
                ) : scan.completedAt && scan.source ? (
                  <>
                    <p className="text-section text-slate-900 leading-tight">{formatDistanceToNow(new Date(scan.completedAt), { addSuffix: true })}</p>
                    <p className="text-label font-normal text-ink-muted mt-0.5">{SOURCE_LABEL[scan.source]}</p>
                  </>
                ) : (
                  <p className="text-section text-ink-muted">—</p>
                )}
              </CardContent>
            </Card>
          </div>

          {statsError && (
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <p className="text-label font-normal text-ink-muted">{STATS_UNAVAILABLE_NOTE}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => refetchStats()}>{TRY_AGAIN}</Button>
            </div>
          )}

          {/* ── STILL DETECTED: hidden findings the latest analysis found again (PR 3b) ── */}
          <StillDetectedSlot view={hiddenView} actions={hiddenActions} onRetry={() => hiddenQuery.refetch()} retrying={hiddenQuery.isFetching} />

          {/* ── TRUST / DISCLAIMER ── */}
          <p className="text-label font-normal text-ink-muted leading-relaxed mb-6 max-w-3xl">
            Savings figures are estimated potential savings based on DevControl&apos;s recommendation methodology, not confirmed AWS billing savings.
            Resolving or dismissing a recommendation records your decision — it does not itself confirm the underlying AWS change was made.
          </p>

          {/* The latest scheduled discovery's warnings: unchanged, and not scan status. */}
          <DiscoveryWarningNotice warnings={discoveryJobs?.[0]?.warnings} className="mb-6" />

          {/* ── OPPORTUNITIES / EMPTY STATE ── */}
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 size={24} className="animate-spin text-violet-600" />
            </div>
          ) : error ? (
            <div className="bg-white border border-red-100 rounded-2xl p-12 text-center">
              {/* Fixed text: never the request error's own message (transport text such as "Request failed with status code 500"). */}
              <p className="text-ui font-semibold text-slate-900 mb-4">Couldn&apos;t load recommendations. Try again.</p>
              <button onClick={() => refetch()} className="bg-violet-700 hover:bg-violet-800 text-white text-label font-semibold px-5 py-2.5 rounded-lg border-none cursor-pointer transition-colors">
                Try again
              </button>
            </div>
          ) : recommendations.length === 0 && scan.key === 'loading' ? (
            // The status isn't known yet: no empty-state conclusion until it is.
            <div className="flex items-center justify-center h-64" data-testid="scan-status-loading">
              <Loader2 size={24} className="animate-spin text-violet-600" />
            </div>
          ) : recommendations.length === 0 && stillDetectedCount !== null && stillDetectedCount > 0 && !STATUS_CARD_KEYS.includes(scan.key) ? (
            // Still-detected findings take the empty card's place: the group above shows them.
            null
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
              ) : (
                // Nothing active and nothing still detected. The banner states the
                // run's result once; this card doesn't repeat it (founder fix, PR 3b).
                // A run from before per-check results were recorded keeps its LIVE caveat.
                <>
                  <Clock size={28} className="text-slate-400 mb-3" aria-hidden="true" />
                  <p className="text-ui font-semibold text-slate-900">No active recommendations to review</p>
                  {scan.key === 'completed_unrecorded' && (totalEverCount > 0 || checksVisible) && (
                    <p className="text-ui text-ink-muted mt-2" data-testid="legacy-caveat">
                      {totalEverCount > 0 ? `Previously identified items have been resolved or dismissed.${checksVisible ? ' ' : ''}` : ''}
                      {/* "each check below" only when the check list is actually shown below. */}
                      {checksVisible && 'This list does not confirm that nothing can be saved: DevControl does not yet record whether each check below completed with enough data.'}
                    </p>
                  )}
                </>
              )}
              {/* A failed /hidden request: the LIVE headline only, no conclusion and no check list. */}
              {checksVisible ? checksNote : null}
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-6 items-start">
              <div className="flex flex-col gap-3">
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                  <p className="text-ui font-semibold text-slate-900">
                    {hiddenCount > 0 ? `Showing ${recommendations.length} of ${activeCount} active opportunities` : `${listedActiveCount} active opportunit${listedActiveCount !== 1 ? 'ies' : 'y'}`}
                  </p>
                  {hiddenCount > 0 && (
                    <p className="text-label font-normal text-ink-muted">Sorted by highest potential savings first</p>
                  )}
                </div>

                {recommendations.map((rec) => (
                  <div key={rec.id} className="bg-white rounded-xl p-5 sm:p-6 border border-slate-200">
                    <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4 items-start">
                      <div>
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <span className="text-ui font-semibold text-slate-900">{displayIssue(rec) || '—'}</span>
                          {rec.severity && <SeverityBadge {...severityToBadge(rec.severity)} />}
                          <span className="text-label font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-ink-muted">{rec.status || '—'}</span>
                        </div>
                        {rec.description && <p className="text-meta text-ink-muted leading-relaxed mb-2.5">{rec.description}</p>}
                        <div className="flex flex-wrap gap-1.5">
                          <span className="bg-slate-100 text-ink-muted text-label font-medium px-2 py-0.5 rounded-full">{rec.resourceId || '—'}</span>
                          {rec.resourceName && <span className="bg-slate-100 text-ink-muted text-label font-medium px-2 py-0.5 rounded-full">{rec.resourceName}</span>}
                          {rec.resourceType && <span className="bg-slate-100 text-ink-muted text-label font-medium px-2 py-0.5 rounded-full">{rec.resourceType}</span>}
                          {rec.awsRegion && <span className="bg-slate-100 text-ink-muted text-label font-medium px-2 py-0.5 rounded-full">{rec.awsRegion}</span>}
                        </div>
                      </div>
                      <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-start gap-3">
                        <div className="text-right">
                          <p className="text-section tabular-nums text-ink-success whitespace-nowrap">
                            {isLowActivityFinding(rec)
                              ? lowActivitySavingsHeadline(rec.potentialSavings, formatSavingsCurrency)
                              : formatRecommendationSavings(rec, formatSavingsCurrency)}
                          </p>
                          {isSavingsCeiling(rec) && (
                            <p className="text-label text-ink-muted font-medium">Estimated ceiling, not an expected saving</p>
                          )}
                          {isDefaultPriceEstimate(rec) && (
                            <p className="text-label text-ink-muted font-medium max-w-[16rem]" data-testid="default-price-disclosure">{DEFAULT_PRICE_DISCLOSURE}</p>
                          )}
                          {isLowActivityFinding(rec) && (
                            <p className="text-label text-ink-muted font-medium max-w-[16rem]" data-testid="low-activity-savings-basis">
                              {!isDefaultPriceEstimate(rec) && typeof rec.metadata?.instance_type === 'string'
                                ? lowActivityListPriceBasis(rec.metadata.instance_type)
                                : LOW_ACTIVITY_STORAGE_NOTE}
                            </p>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => resolveMutation.mutate(rec.id)}
                            disabled={pendingMutation(rec.id)}
                            className="flex items-center gap-1 bg-green-600 hover:bg-green-700 text-white px-3.5 py-1.5 rounded-lg text-label font-semibold border-none cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            <CheckCircle size={12} /> Resolve
                          </button>
                          <button
                            onClick={() => dismissMutation.mutate(rec.id)}
                            disabled={pendingMutation(rec.id)}
                            className="flex items-center gap-1 bg-transparent text-ink-muted px-3 py-1.5 rounded-lg text-label font-medium border border-slate-200 hover:bg-slate-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            <XCircle size={12} /> Dismiss
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* ── SIDEBAR: severity breakdown + what devcontrol checks ── */}
              <div className="flex flex-col gap-4">
                <Card>
                  <CardHeader className="px-5 pb-0"><h2 className="text-ui font-semibold text-slate-900">Severity breakdown</h2></CardHeader>
                  <CardContent className="px-5">
                    <div className="flex flex-col gap-2.5">
                      {([
                        { key: 'high', label: 'High', count: bySeverity ? bySeverity.high : null, color: 'bg-red-500' },
                        { key: 'medium', label: 'Medium', count: bySeverity ? bySeverity.medium : null, color: 'bg-amber-500' },
                        { key: 'low', label: 'Low', count: bySeverity ? bySeverity.low : null, color: 'bg-slate-400' },
                      ] as const).map((row) => {
                        // Stats unavailable: "—", never 0.
                        const total = bySeverity ? bySeverity.high + bySeverity.medium + bySeverity.low : 0;
                        const pct = row.count !== null && total > 0 ? (row.count / total) * 100 : 0;
                        return (
                          <div key={row.key}>
                            <div className="flex items-center justify-between text-meta mb-1">
                              <span className="font-medium text-slate-600">{row.label}</span>
                              <span className="font-semibold text-slate-900 tabular-nums">{row.count ?? '—'}</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                              <div className={cn('h-full rounded-full', row.color)} style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-label font-normal text-ink-muted mt-3 leading-relaxed">
                      Only High/Medium/Low severities are currently supported — there is no Critical tier in the underlying data.
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="px-5 pb-0"><h2 className="text-ui font-semibold text-slate-900">What DevControl checks</h2></CardHeader>
                  <CardContent className="px-5">
                    <div className="flex flex-col gap-3">
                      {implementedRules.map((rule) => (
                        <div key={rule.id} className="flex items-start gap-2">
                          <Server size={13} className="text-slate-400 mt-0.5 shrink-0" />
                          <div>
                            <p className="text-label font-semibold text-slate-700">{rule.name}</p>
                            <p className="text-label font-normal text-ink-muted leading-snug">{rule.detail}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="text-label font-normal text-ink-muted mt-3 leading-relaxed border-t border-slate-100 pt-3">
                      {implementedRules.length} active check{implementedRules.length !== 1 ? 's' : ''} today — not a complete list of every possible AWS cost optimization.
                    </p>
                  </CardContent>
                </Card>

                {/* ── COVERAGE / PLANNED ──
                    Registry-derived, never a hardcoded "every rule active"
                    claim: an implementedCount below totalRules is expected
                    and disclosed, not hidden. See config/optimization-rules.ts. */}
                {ruleCatalog.summary.totalRules > 0 && (
                  <Card>
                    <CardHeader className="px-5 pb-0"><h2 className="text-ui font-semibold text-slate-900">Coverage</h2></CardHeader>
                    <CardContent className="px-5">
                      <p className="text-label font-normal text-ink-muted leading-relaxed mb-3">
                        {ruleCatalog.summary.implementedCount} of {ruleCatalog.summary.totalRules} registered checks are active today, across {ruleCatalog.summary.services.length} AWS services DevControl has rules for.
                      </p>
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {ruleCatalog.summary.services.map((s) => (
                          <span
                            key={s.service}
                            className={cn(
                              'text-label font-medium px-2 py-0.5 rounded-full',
                              s.implementedCount > 0 ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-ink-muted'
                            )}
                          >
                            {s.service}
                          </span>
                        ))}
                      </div>
                      {plannedRules.length > 0 && (
                        <>
                          <p className="text-label font-semibold text-ink-muted uppercase tracking-wide border-t border-slate-100 pt-3 mb-2">
                            Planned / coming soon
                          </p>
                          <div className="flex flex-col gap-1.5">
                            {plannedRules.map((rule) => (
                              <p key={rule.id} className="text-label font-normal text-ink-muted leading-snug">
                                {rule.service} — {rule.name}
                              </p>
                            ))}
                          </div>
                        </>
                      )}
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          )}

          {/* ── REVIEW: every resolved and dismissed finding, collapsed (PR 3b). Absent while /hidden is loading or failed (C27 above). ── */}
          {hiddenView.status === 'ready' && <ReviewList data={hiddenView.data} actions={hiddenActions} />}
        </>
      )}
    </div>
  );
}
