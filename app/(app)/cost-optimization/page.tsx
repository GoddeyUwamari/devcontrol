'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, RefreshCw, CheckCircle, CheckCircle2, XCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { costRecommendationsService } from '@/lib/services/cost-recommendations.service';
import type { CostRecommendation, RecommendationSeverity } from '@/lib/types';
import { useDemoMode } from '@/components/demo/demo-mode-toggle';
import { useSalesDemo } from '@/lib/demo/sales-demo-data';
import { annualizeMonthly } from '@/lib/utils';

const severityStyles: Record<RecommendationSeverity, string> = {
  HIGH: 'bg-red-50 text-red-700 border-red-200',
  MEDIUM: 'bg-amber-50 text-amber-700 border-amber-200',
  LOW: 'bg-slate-100 text-slate-600 border-slate-200',
};

function formatSavings(value: number | null | undefined): string {
  return value != null ? `$${Math.round(value).toLocaleString()}/mo` : '—';
}

// The 4 detection categories that actually run in
// costOptimizationService.analyzeAllResources() on the backend.
const SCAN_CHECKS = [
  'Idle EC2 instances',
  'Oversized RDS instances',
  'Unused Elastic IPs',
  'Reserved Instance opportunities',
];

export default function CostOptimizationPage() {
  const queryClient = useQueryClient();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [lastScanAt, setLastScanAt] = useState<Date | null>(null);

  const demoMode = useDemoMode();
  const salesDemoMode = useSalesDemo((state) => state.enabled);
  const isDemoActive = demoMode || salesDemoMode;

  // Same data source and gating as the dashboard's Savings Actions card
  // (app/(app)/dashboard/page.tsx queryKey ['cost-recommendations']): real
  // cost_recommendations only, disabled during demo mode, no fabricated fallback.
  const { data: recommendations = [], isLoading, error, refetch } = useQuery<CostRecommendation[]>({
    queryKey: ['cost-recommendations', 'ACTIVE'],
    queryFn: () => costRecommendationsService.getAll({ status: 'ACTIVE' }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    enabled: !isDemoActive,
  });

  const resolveMutation = useMutation({
    mutationFn: costRecommendationsService.resolve,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cost-recommendations'] });
      toast.success('Recommendation marked as resolved');
    },
    onError: () => toast.error('Failed to resolve recommendation'),
  });

  const dismissMutation = useMutation({
    mutationFn: costRecommendationsService.dismiss,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cost-recommendations'] });
      toast.success('Recommendation dismissed');
    },
    onError: () => toast.error('Failed to dismiss recommendation'),
  });

  const handleScan = async () => {
    setIsAnalyzing(true);
    try {
      const result = await costRecommendationsService.analyze();
      await refetch();
      setLastScanAt(result.timestamp ? new Date(result.timestamp) : new Date());
      toast.success(`Scan complete — ${result.recommendationsFound} opportunit${result.recommendationsFound !== 1 ? 'ies' : 'y'} found`);
    } catch (err: any) {
      toast.error(err?.message || 'Scan failed — try again');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const totalSavings = recommendations.reduce((sum, r) => sum + (r.potentialSavings || 0), 0);
  const pendingMutation = (id: string) => resolveMutation.isPending && resolveMutation.variables === id
    || dismissMutation.isPending && dismissMutation.variables === id;

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 max-w-[1100px] mx-auto">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight mb-2">Cost Optimization</h1>
          <p className="text-xs text-slate-500 font-medium leading-relaxed">Real savings opportunities identified from your connected AWS account.</p>
        </div>
        <div className="flex flex-col items-start sm:items-end gap-1.5">
          <button
            onClick={handleScan}
            disabled={isAnalyzing || isDemoActive}
            className={`inline-flex items-center gap-2 text-white text-sm font-semibold px-5 py-2.5 rounded-lg border-none whitespace-nowrap transition-colors ${isAnalyzing || isDemoActive ? 'bg-violet-400 cursor-not-allowed' : 'bg-violet-700 hover:bg-violet-800 cursor-pointer'}`}
          >
            {isAnalyzing ? <><Loader2 size={14} className="animate-spin" /> Scanning...</> : <><RefreshCw size={14} /> Run scan</>}
          </button>
          {lastScanAt && (
            <p className="text-xs text-slate-500 font-medium">
              Last scan: {formatDistanceToNow(lastScanAt, { addSuffix: true })}
            </p>
          )}
        </div>
      </div>

      {isDemoActive ? (
        <div className="bg-white border border-slate-100 rounded-2xl p-12 text-center">
          <p className="text-sm font-semibold text-slate-900 mb-2">Cost recommendations aren&apos;t shown in demo mode</p>
          <p className="text-sm text-slate-500">Turn off demo mode to see real optimization opportunities for your connected AWS account.</p>
        </div>
      ) : isLoading ? (
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
          <CheckCircle2 size={32} className="text-green-600 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-900 mb-2">No active cost-saving opportunities detected</p>
          <p className="text-sm text-slate-500 mb-6">Run a scan to check for new savings opportunities.</p>
          <div className="flex flex-col items-center gap-1.5 mb-2">
            {SCAN_CHECKS.map((check) => (
              <span key={check} className="inline-flex items-center gap-1.5 text-xs text-slate-500 font-medium">
                <CheckCircle2 size={12} className="text-green-600 shrink-0" /> {check}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl p-6 border border-slate-200 mb-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1">Monthly Savings</p>
                <p className="text-2xl font-bold text-green-600">{formatSavings(totalSavings)}</p>
                {totalSavings > 0 && (
                  <p className="text-xs text-slate-500 mt-1">≈ ${Math.round(annualizeMonthly(totalSavings)).toLocaleString()}/year</p>
                )}
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1">Annual Savings</p>
                <p className="text-2xl font-bold text-green-600">{totalSavings > 0 ? `$${Math.round(annualizeMonthly(totalSavings)).toLocaleString()}/yr` : '—'}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1">Opportunities</p>
                <p className="text-2xl font-bold text-slate-900">{recommendations.length}</p>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {recommendations.map((rec) => (
              <div key={rec.id} className="bg-white rounded-xl p-5 sm:p-6 border border-slate-200">
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4 items-start">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <span className="text-sm font-semibold text-slate-900">{rec.issue || '—'}</span>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${rec.severity ? severityStyles[rec.severity] : severityStyles.LOW}`}>
                        {rec.severity || '—'}
                      </span>
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
                    <p className="text-xl sm:text-2xl font-bold text-green-600 whitespace-nowrap">{formatSavings(rec.potentialSavings)}</p>
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
        </>
      )}
    </div>
  );
}
