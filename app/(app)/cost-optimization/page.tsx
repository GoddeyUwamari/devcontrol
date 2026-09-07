'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Loader2,
  RefreshCw,
  CheckCircle,
  CheckCircle2,
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
import { useSalesDemo } from '@/lib/demo/sales-demo-data';
import { annualizeMonthly, cn } from '@/lib/utils';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { SeverityBadge } from '@/components/ui/severity-badge';
import { Skeleton } from '@/components/ui/skeleton';
import { deriveAnalysisStatus, pickLatestAnalysis, type AnalysisStatusKey, type AnalysisSource, type NormalizedAnalysis } from './costOptimizationStatus';

// Fetching more than this in one page is an edge case; the KPI tile (sourced
// from /stats, not this list) always shows the true total regardless, and
// the list header discloses when it's showing a subset -- see
// "Showing N of Total" below. No backend pagination change was made for
// this; see the implementation report's "known limitation" note.
const RECOMMENDATIONS_FETCH_LIMIT = 100;

function formatSavings(value: number | null | undefined): string {
  return value != null ? `$${Math.round(value).toLocaleString()}/mo` : '—';
}

// A detector may disclose its savings figure as a ceiling (e.g. S3 lifecycle:
// assumes 100% of current Standard storage transitions, no retrieval fees
// netted out) rather than an ordinary expected saving -- see
// backend/src/services/cost-optimization.service.ts's savings_basis metadata.
// The card must not present a ceiling as if it were a plain monthly estimate.
function isSavingsCeiling(rec: CostRecommendation): boolean {
  const basis = rec.metadata?.savings_basis;
  return typeof basis === 'string' && basis.startsWith('ceiling');
}

function formatWholeDollars(value: number): string {
  return `$${Math.round(value).toLocaleString()}`;
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

const SOURCE_LABEL: Record<AnalysisSource, string> = {
  scheduled: 'Scheduled analysis',
  manual: 'Manual cost analysis',
};

function AnalysisStatusBanner({
  status,
  activeCount,
  latestAnalysis,
}: {
  status: AnalysisStatusKey | 'loading';
  activeCount: number;
  latestAnalysis: NormalizedAnalysis | undefined;
}) {
  if (status === 'loading') {
    return <Skeleton className="h-16 w-full rounded-xl" />;
  }

  const relative = latestAnalysis?.completedAt ? formatDistanceToNow(new Date(latestAnalysis.completedAt), { addSuffix: true }) : null;
  const sourceLabel = latestAnalysis ? SOURCE_LABEL[latestAnalysis.source] : null;

  const meta: Record<Exclude<AnalysisStatusKey, never>, { icon: typeof CloudOff; tone: string; label: string; description: string }> = {
    not_connected: {
      icon: CloudOff,
      tone: 'bg-slate-50 border-slate-200 text-slate-600',
      label: 'AWS not connected',
      description: 'Connect an AWS account to run cost analysis.',
    },
    never_analyzed: {
      icon: Clock,
      tone: 'bg-slate-50 border-slate-200 text-slate-600',
      label: 'Never analyzed',
      description: 'AWS is connected, but no cost analysis has completed yet.',
    },
    in_progress: {
      icon: Loader2,
      tone: 'bg-violet-50 border-violet-200 text-violet-700',
      label: 'Analysis in progress',
      description: 'DevControl is currently checking your account.',
    },
    failed: {
      icon: AlertTriangle,
      tone: 'bg-red-50 border-red-200 text-red-700',
      label: `Last ${sourceLabel?.toLowerCase() || 'analysis'} failed`,
      description: latestAnalysis?.errorMessage || 'The most recent analysis did not complete.',
    },
    completed_with_opportunities: {
      icon: CheckCircle2,
      tone: 'bg-amber-50 border-amber-200 text-amber-800',
      label: 'Analysis complete',
      description: `${activeCount} active opportunit${activeCount !== 1 ? 'ies' : 'y'} identified.`,
    },
    completed_clean: {
      icon: CheckCircle2,
      tone: 'bg-green-50 border-green-200 text-green-700',
      label: 'Analysis complete',
      description: 'No active opportunities identified.',
    },
    completed_all_resolved: {
      icon: CheckCircle2,
      tone: 'bg-green-50 border-green-200 text-green-700',
      label: 'Analysis complete',
      description: 'No active opportunities — previously identified items have been resolved or dismissed.',
    },
  };

  const m = meta[status];
  const Icon = m.icon;

  return (
    <div className={cn('flex items-center gap-3.5 rounded-xl border px-4 py-3.5', m.tone)}>
      <div className="w-9 h-9 rounded-lg bg-white/70 flex items-center justify-center shrink-0">
        <Icon size={18} className={status === 'in_progress' ? 'animate-spin' : undefined} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold">{m.label}</p>
        <p className="text-xs opacity-80">{m.description}</p>
      </div>
      {relative && sourceLabel && (status === 'failed' || status.startsWith('completed')) && (
        <span className="text-[11px] font-medium opacity-70 whitespace-nowrap shrink-0">{sourceLabel}, {relative}</span>
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
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['cost-recommendations-stats'],
    queryFn: costRecommendationsService.getStats,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    enabled: !isDemoActive,
  });

  // Real AWS-connection signal, same endpoint/service the Dashboard uses to
  // compute isAwsConnected.
  const { data: awsAccounts } = useQuery({
    queryKey: ['aws-accounts'],
    queryFn: awsAccountsService.getAccounts,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !isDemoActive,
  });

  // Real, persisted scan history -- reflects the 6-hourly automatic
  // discovery+cost-analysis cron (backend/src/jobs/resourceDiscovery.job.ts).
  const { data: discoveryJobs } = useQuery({
    queryKey: ['discovery-jobs', 5],
    queryFn: () => awsResourcesService.getDiscoveryJobs(5),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    enabled: !isDemoActive,
  });

  // Real, persisted manual "Run cost analysis" run history -- the
  // counterpart to discoveryJobs above for the button below, which
  // previously left no server-side trace of its own runs. See
  // database/migrations/202609060900_create_cost_analysis_runs.sql and
  // costOptimizationStatus.ts's pickLatestAnalysis().
  const { data: analysisRuns } = useQuery({
    queryKey: ['cost-analysis-runs', 5],
    queryFn: () => costRecommendationsService.getAnalysisRuns(5),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
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

  const invalidateRecommendationData = () => {
    queryClient.invalidateQueries({ queryKey: ['cost-recommendations'] });
    queryClient.invalidateQueries({ queryKey: ['cost-recommendations-stats'] });
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
      ]);
      toast.success(`Scan complete — ${result.recommendationsFound} opportunit${result.recommendationsFound !== 1 ? 'ies' : 'y'} found`);
    } catch (err: any) {
      toast.error(err?.message || 'Scan failed — try again');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const pendingMutation = (id: string) => resolveMutation.isPending && resolveMutation.variables === id
    || dismissMutation.isPending && dismissMutation.variables === id;

  const awsConnected = awsAccounts === undefined ? undefined : awsAccounts.length > 0;
  const latestAnalysis = pickLatestAnalysis({ latestDiscoveryJob: discoveryJobs?.[0], latestAnalysisRun: analysisRuns?.[0] });
  const activeCount = stats?.activeRecommendations ?? recommendations.length;
  const totalEverCount = stats?.totalRecommendations ?? 0;
  const monthlySavings = stats?.totalPotentialSavings ?? 0;
  const annualSavings = annualizeMonthly(monthlySavings);
  const bySeverity = stats?.bySeverity ?? { high: 0, medium: 0, low: 0 };

  const analysisStatus = deriveAnalysisStatus({ awsConnected, latestAnalysis, activeCount, totalEverCount });
  const canRunScan = !isAnalyzing && !isDemoActive && awsConnected !== false;
  const hiddenCount = Math.max(0, activeCount - recommendations.length);

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 max-w-[1100px] mx-auto">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight mb-2">Cost Optimization</h1>
          <p className="text-xs text-slate-500 font-medium leading-relaxed max-w-lg">
            DevControl identifies potential AWS cost-saving opportunities by checking your connected account
            against the categories below. Figures are estimated potential savings, not realized or billed savings.
          </p>
        </div>
        {!isDemoActive && awsConnected === false ? (
          <a
            href="/connect-aws"
            className="inline-flex items-center gap-2 text-white text-sm font-semibold px-5 py-2.5 rounded-lg bg-violet-700 hover:bg-violet-800 whitespace-nowrap no-underline transition-colors"
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
          <p className="text-sm font-semibold text-slate-900 mb-2">Cost recommendations aren&apos;t shown in demo mode</p>
          <p className="text-sm text-slate-500">Turn off demo mode to see real optimization opportunities for your connected AWS account.</p>
        </div>
      ) : (
        <>
          {/* ── KPI AREA ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <Card>
              <CardContent className="px-5">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Active Opportunities</p>
                {statsLoading ? <Skeleton className="h-8 w-14" /> : <p className="text-3xl font-bold text-slate-900">{activeCount}</p>}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="px-5">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Estimated Monthly Savings</p>
                {statsLoading ? <Skeleton className="h-8 w-24" /> : (
                  <p className="text-3xl font-bold text-green-600">{formatWholeDollars(monthlySavings)}<span className="text-sm font-semibold text-slate-400">/mo</span></p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="px-5">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Estimated Annual Savings</p>
                {statsLoading ? <Skeleton className="h-8 w-24" /> : (
                  <p className="text-3xl font-bold text-green-600">{formatWholeDollars(annualSavings)}<span className="text-sm font-semibold text-slate-400">/yr</span></p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="px-5">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Last Analysis</p>
                {analysisStatus === 'loading' ? <Skeleton className="h-6 w-20" /> : analysisStatus === 'not_connected' ? (
                  <p className="text-lg font-bold text-slate-300">—</p>
                ) : analysisStatus === 'never_analyzed' ? (
                  <p className="text-lg font-bold text-slate-400">Never</p>
                ) : analysisStatus === 'in_progress' ? (
                  <p className="text-lg font-bold text-violet-600">Running…</p>
                ) : latestAnalysis?.completedAt ? (
                  <>
                    <p className="text-lg font-bold text-slate-900 leading-tight">{formatDistanceToNow(new Date(latestAnalysis.completedAt), { addSuffix: true })}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">{SOURCE_LABEL[latestAnalysis.source]}</p>
                  </>
                ) : (
                  <p className="text-lg font-bold text-slate-400">—</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ── TRUST / DISCLAIMER ── */}
          <p className="text-[11px] text-slate-400 leading-relaxed mb-6 max-w-3xl">
            Savings figures are estimated potential savings based on DevControl&apos;s recommendation methodology, not confirmed AWS billing savings.
            Resolving or dismissing a recommendation records your decision — it does not itself confirm the underlying AWS change was made.
          </p>

          {/* ── ANALYSIS STATUS ── */}
          <Card className="mb-6">
            <CardContent className="px-5">
              <AnalysisStatusBanner
                status={analysisStatus}
                activeCount={activeCount}
                latestAnalysis={latestAnalysis}
              />
            </CardContent>
          </Card>

          {/* ── OPPORTUNITIES / EMPTY STATE ── */}
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 size={24} className="animate-spin text-violet-600" />
            </div>
          ) : error ? (
            <div className="bg-white border border-red-100 rounded-2xl p-12 text-center">
              <p className="text-sm font-semibold text-slate-900 mb-2">Couldn&apos;t load recommendations</p>
              <p className="text-sm text-slate-500 mb-4">{(error as Error).message || 'Something went wrong.'}</p>
              <button onClick={() => refetch()} className="bg-violet-700 hover:bg-violet-800 text-white text-xs font-semibold px-5 py-2.5 rounded-lg border-none cursor-pointer transition-colors">
                Try again
              </button>
            </div>
          ) : recommendations.length === 0 ? (
            <div className="bg-white border border-slate-100 rounded-2xl p-12 text-center">
              {analysisStatus === 'not_connected' ? (
                <>
                  <CloudOff size={32} className="text-slate-400 mx-auto mb-3" />
                  <p className="text-sm font-semibold text-slate-900 mb-2">Connect AWS to check for savings</p>
                  <p className="text-sm text-slate-500 mb-6">DevControl needs a connected AWS account before it can look for cost-saving opportunities.</p>
                </>
              ) : analysisStatus === 'never_analyzed' ? (
                <>
                  <Clock size={32} className="text-slate-400 mx-auto mb-3" />
                  <p className="text-sm font-semibold text-slate-900 mb-2">No analysis has run yet</p>
                  <p className="text-sm text-slate-500 mb-6">Run your first cost analysis to check for savings opportunities.</p>
                </>
              ) : analysisStatus === 'in_progress' ? (
                <>
                  <Loader2 size={32} className="text-violet-500 mx-auto mb-3 animate-spin" />
                  <p className="text-sm font-semibold text-slate-900 mb-2">Analysis in progress</p>
                  <p className="text-sm text-slate-500 mb-6">DevControl is currently checking your account. This can take a few minutes.</p>
                </>
              ) : analysisStatus === 'failed' ? (
                <>
                  <AlertTriangle size={32} className="text-red-500 mx-auto mb-3" />
                  <p className="text-sm font-semibold text-slate-900 mb-2">
                    The last {latestAnalysis ? SOURCE_LABEL[latestAnalysis.source].toLowerCase() : 'analysis'} didn&apos;t complete
                  </p>
                  <p className="text-sm text-slate-500 mb-6">{latestAnalysis?.errorMessage || 'Something interrupted the scan before it finished.'}</p>
                </>
              ) : analysisStatus === 'completed_all_resolved' ? (
                <>
                  <CheckCircle2 size={32} className="text-green-600 mx-auto mb-3" />
                  <p className="text-sm font-semibold text-slate-900 mb-2">No active cost-saving opportunities detected</p>
                  <p className="text-sm text-slate-500 mb-6">Previously identified opportunities have all been resolved or dismissed.</p>
                </>
              ) : (
                <>
                  <CheckCircle2 size={32} className="text-green-600 mx-auto mb-3" />
                  <p className="text-sm font-semibold text-slate-900 mb-2">No active cost-saving opportunities detected</p>
                  <p className="text-sm text-slate-500 mb-6">Run a scan to check for new savings opportunities.</p>
                </>
              )}
              <div className="flex flex-col items-center gap-1.5 mb-2">
                {implementedRules.map((rule) => (
                  <span key={rule.id} className="inline-flex items-center gap-1.5 text-xs text-slate-500 font-medium">
                    <CheckCircle2 size={12} className="text-green-600 shrink-0" /> {rule.name}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-6 items-start">
              <div className="flex flex-col gap-3">
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                  <p className="text-sm font-bold text-slate-900">
                    {hiddenCount > 0 ? `Showing ${recommendations.length} of ${activeCount} active opportunities` : `${activeCount} active opportunit${activeCount !== 1 ? 'ies' : 'y'}`}
                  </p>
                  {hiddenCount > 0 && (
                    <p className="text-[11px] text-slate-400">Sorted by highest potential savings first</p>
                  )}
                </div>

                {recommendations.map((rec) => (
                  <div key={rec.id} className="bg-white rounded-xl p-5 sm:p-6 border border-slate-200">
                    <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4 items-start">
                      <div>
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <span className="text-sm font-semibold text-slate-900">{rec.issue || '—'}</span>
                          {rec.severity && <SeverityBadge {...severityToBadge(rec.severity)} />}
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">{rec.status || '—'}</span>
                        </div>
                        {rec.description && <p className="text-xs text-slate-500 leading-relaxed mb-2.5">{rec.description}</p>}
                        <div className="flex flex-wrap gap-1.5">
                          <span className="bg-slate-100 text-slate-500 text-xs font-medium px-2 py-0.5 rounded-full">{rec.resourceId || '—'}</span>
                          {rec.resourceName && <span className="bg-slate-100 text-slate-500 text-xs font-medium px-2 py-0.5 rounded-full">{rec.resourceName}</span>}
                          {rec.resourceType && <span className="bg-slate-100 text-slate-500 text-xs font-medium px-2 py-0.5 rounded-full">{rec.resourceType}</span>}
                          {rec.awsRegion && <span className="bg-slate-100 text-slate-500 text-xs font-medium px-2 py-0.5 rounded-full">{rec.awsRegion}</span>}
                        </div>
                      </div>
                      <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-start gap-3">
                        <div className="text-right">
                          <p className="text-xl sm:text-2xl font-bold text-green-600 whitespace-nowrap">
                            {isSavingsCeiling(rec) ? `Up to ${formatSavings(rec.potentialSavings)}` : formatSavings(rec.potentialSavings)}
                          </p>
                          {isSavingsCeiling(rec) && (
                            <p className="text-[10px] text-slate-400 font-medium">Estimated ceiling, not an expected saving</p>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => resolveMutation.mutate(rec.id)}
                            disabled={pendingMutation(rec.id)}
                            className="flex items-center gap-1 bg-green-600 hover:bg-green-700 text-white px-3.5 py-1.5 rounded-lg text-xs font-bold border-none cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            <CheckCircle size={12} /> Resolve
                          </button>
                          <button
                            onClick={() => dismissMutation.mutate(rec.id)}
                            disabled={pendingMutation(rec.id)}
                            className="flex items-center gap-1 bg-transparent text-slate-500 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 hover:bg-slate-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
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
                  <CardHeader className="px-5 pb-0"><h2 className="text-sm font-bold text-slate-900">Severity breakdown</h2></CardHeader>
                  <CardContent className="px-5">
                    <div className="flex flex-col gap-2.5">
                      {([
                        { key: 'high', label: 'High', count: bySeverity.high, color: 'bg-red-500' },
                        { key: 'medium', label: 'Medium', count: bySeverity.medium, color: 'bg-amber-500' },
                        { key: 'low', label: 'Low', count: bySeverity.low, color: 'bg-slate-400' },
                      ] as const).map((row) => {
                        const total = bySeverity.high + bySeverity.medium + bySeverity.low;
                        const pct = total > 0 ? (row.count / total) * 100 : 0;
                        return (
                          <div key={row.key}>
                            <div className="flex items-center justify-between text-xs mb-1">
                              <span className="font-medium text-slate-600">{row.label}</span>
                              <span className="font-bold text-slate-900">{row.count}</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                              <div className={cn('h-full rounded-full', row.color)} style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-3 leading-relaxed">
                      Only High/Medium/Low severities are currently supported — there is no Critical tier in the underlying data.
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="px-5 pb-0"><h2 className="text-sm font-bold text-slate-900">What DevControl checks</h2></CardHeader>
                  <CardContent className="px-5">
                    <div className="flex flex-col gap-3">
                      {implementedRules.map((rule) => (
                        <div key={rule.id} className="flex items-start gap-2">
                          <Server size={13} className="text-slate-400 mt-0.5 shrink-0" />
                          <div>
                            <p className="text-xs font-semibold text-slate-700">{rule.name}</p>
                            <p className="text-[11px] text-slate-400 leading-snug">{rule.detail}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-3 leading-relaxed border-t border-slate-100 pt-3">
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
                    <CardHeader className="px-5 pb-0"><h2 className="text-sm font-bold text-slate-900">Coverage</h2></CardHeader>
                    <CardContent className="px-5">
                      <p className="text-[11px] text-slate-500 leading-relaxed mb-3">
                        {ruleCatalog.summary.implementedCount} of {ruleCatalog.summary.totalRules} registered checks are active today, across {ruleCatalog.summary.services.length} AWS services DevControl has rules for.
                      </p>
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {ruleCatalog.summary.services.map((s) => (
                          <span
                            key={s.service}
                            className={cn(
                              'text-[11px] font-medium px-2 py-0.5 rounded-full',
                              s.implementedCount > 0 ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'
                            )}
                          >
                            {s.service}
                          </span>
                        ))}
                      </div>
                      {plannedRules.length > 0 && (
                        <>
                          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide border-t border-slate-100 pt-3 mb-2">
                            Planned / coming soon
                          </p>
                          <div className="flex flex-col gap-1.5">
                            {plannedRules.map((rule) => (
                              <p key={rule.id} className="text-[11px] text-slate-400 leading-snug">
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
        </>
      )}
    </div>
  );
}
