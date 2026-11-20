'use client';

import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Download } from 'lucide-react';
import { usePlan } from '@/lib/hooks/use-plan';
import { PLAN_ENTITLEMENTS } from '@/lib/plan/entitlements';
import { PlanLoadingState, WorkspaceLoadError } from '@/components/plan/plan-status';
import { PlanRequiredNotice } from '@/components/plan/plan-required-notice';
import { PAGE_SUBTITLE_CLASS, PAGE_TITLE_CLASS } from '@/components/ui/typography';
import { Skeleton } from '@/components/ui/skeleton';
import api from '@/lib/api';
import { doraMetricsService, type DORAMetricsData } from '@/lib/services/dora-metrics.service';
import { deploymentsService } from '@/lib/services/deployments.service';
import { doraCsvRows } from '@/lib/deployments/dora-display';
import { servicesService } from '@/lib/services/services.service';
import { teamsService } from '@/lib/services/teams.service';
import type { DORAMetricsFilters, DateRangeOption, Service, Team } from '@/lib/types';
import { useDemoMode } from '@/components/demo/demo-mode-toggle';
import { useSalesDemo } from '@/lib/demo/sales-demo-data';
import {
  COPY,
  doraCsvFilename,
  doraCsvText,
  methodSourceSentence,
  sourceLine,
  whatChanged,
  withoutResultCount,
  withoutResultSentence,
  type SourceInfo,
} from './_lib/dora-page';
import { DEMO_DORA_RESPONSE } from './_lib/demo-fixture';
import { Filters, NoDataBanner, SourceLine } from './_components/HeaderParts';
import { MetricCards, type TargetValues } from './_components/MetricCards';
import { DailyChart } from './_components/DailyChart';
import { WhatChanged } from './_components/WhatChanged';
import { PerformanceLevels } from './_components/PerformanceLevels';
import { LockedTargets, YourTargets, type CustomBenchmark } from './_components/YourTargets';
import { DataAndMethod } from './_components/DataAndMethod';

function exportToCSV(metrics: DORAMetricsData, dateRange: string, demo: boolean) {
  const csv = doraCsvText(doraCsvRows(metrics), demo);
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = doraCsvFilename(dateRange, new Date().toISOString().split('T')[0], demo); a.click(); URL.revokeObjectURL(url);
}

function exportToPDF() { window.print(); }

const BENCHMARK_API = '/api/dora/benchmarks';
/** The newest rows of the deployment log: the latest finished one names the record source (ruling D5-D1). */
const LATEST_ROWS = 25;

const PAGE = 'px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 max-w-[1400px] mx-auto flex flex-col gap-6';
const EXPORT_BUTTON = 'flex items-center justify-center gap-1.5 bg-white border border-slate-200 text-ink-muted px-3.5 min-h-11 sm:min-h-9 rounded-lg text-label cursor-pointer hover:bg-slate-50 transition-colors whitespace-nowrap';

export default function DORAMetricsPage() {
  const [dateRange, setDateRange] = useState<DateRangeOption>('30d');
  const [selectedService, setSelectedService] = useState<string>('all');
  const [selectedTeam, setSelectedTeam] = useState<string>('all');
  const [saveError, setSaveError] = useState<string | null>(null);

  // DORA metrics, and custom targets (reads included), are each on their own
  // plan (PLAN_ENTITLEMENTS); neither is asked for below it.
  const plan = usePlan();
  const doraOnPlan = plan.hasEntitlement('doraMetrics');
  const isEnterprise = plan.hasEntitlement('doraCustomBenchmarks');
  const queryClient = useQueryClient();
  const demoMode = useDemoMode();
  const salesDemoMode = useSalesDemo((state) => state.enabled);
  const isDemoActive = demoMode || salesDemoMode;
  const live = doraOnPlan && !isDemoActive;

  const { data: services } = useQuery<Service[]>({ queryKey: ['services'], queryFn: () => servicesService.getAll() });
  const { data: teams } = useQuery<Team[]>({ queryKey: ['teams'], queryFn: teamsService.getAll });
  // The one metrics query: every card, the chart, What changed and Performance levels read this response.
  const { data: metricsData, isLoading, error, refetch } = useQuery({
    queryKey: ['dora-metrics', dateRange, selectedService, selectedTeam],
    queryFn: async () => {
      const filters: DORAMetricsFilters = { dateRange };
      if (selectedService !== 'all') filters.serviceId = selectedService;
      if (selectedTeam !== 'all') filters.teamId = selectedTeam;
      return doraMetricsService.getDORAMetrics(filters);
    },
    enabled: live,
  });
  // Workspace-wide facts the DORA response doesn't carry: whether any record exists, the last record's
  // time, and rows recorded without a result (d5-build.md §1.2-A, G).
  const { data: stats } = useQuery({
    queryKey: ['dora-deployment-stats', dateRange],
    queryFn: async () => (await deploymentsService.getStats({ dateRange })) ?? null,
    enabled: live,
  });
  const { data: latestRows } = useQuery({
    queryKey: ['dora-latest-records'],
    queryFn: () => deploymentsService.getAll({ limit: LATEST_ROWS }),
    enabled: live,
  });
  const { data: benchmarksData, refetch: refetchBenchmarks } = useQuery<{ success: boolean; data: CustomBenchmark[] }>({
    queryKey: ['dora-benchmarks'],
    queryFn: async () => { const r = await api.get<{ success: boolean; data: CustomBenchmark[] }>(BENCHMARK_API); return r.data; },
    enabled: isEnterprise && !isDemoActive,
  });
  const benchmarks = isDemoActive ? [] : (benchmarksData?.data ?? []);

  const saveBenchmark = useCallback(async (metricKey: string, value: string, label: string) => {
    setSaveError(null);
    const parsed = parseFloat(value);
    if (isNaN(parsed) || parsed <= 0) { setSaveError('Please enter a valid positive number.'); return false; }
    try {
      await api.post(BENCHMARK_API, { metric_name: metricKey, target_value: parsed, performance_label: label || 'Elite' });
      await refetchBenchmarks(); queryClient.invalidateQueries({ queryKey: ['dora-metrics'] });
      return true;
    } catch { setSaveError('Failed to save. Please try again.'); return false; }
  }, [refetchBenchmarks, queryClient]);

  const resetBenchmark = useCallback(async (metricKey: string) => {
    setSaveError(null);
    try { await api.delete(`${BENCHMARK_API}/${metricKey}`); await refetchBenchmarks(); queryClient.invalidateQueries({ queryKey: ['dora-metrics'] }); }
    catch { setSaveError('Failed to reset. Please try again.'); }
  }, [refetchBenchmarks, queryClient]);

  const data: DORAMetricsData | null = isDemoActive ? DEMO_DORA_RESPONSE : (metricsData?.data ?? null);
  const finished = data?.deployments.finished ?? 0;
  const loadFailed = !isDemoActive && !isLoading && (error != null || (metricsData != null && !metricsData.data));
  const exportDisabled = !data || finished === 0;
  const filtered = selectedService !== 'all' || selectedTeam !== 'all';

  const source: SourceInfo = isDemoActive
    ? { dot: 'solid', text: COPY.demoSource, kind: null }
    : sourceLine(stats, latestRows);
  const showBanner = !isDemoActive && data != null && finished === 0 && stats?.organization_has_deployments === false;
  const withoutResult = data && !isDemoActive ? withoutResultCount(data, stats, filtered) : null;
  const targets: TargetValues = {};
  for (const b of benchmarks) {
    if (b.metric_name === 'deployment_frequency') targets.deploymentFrequency = Number(b.target_value);
    if (b.metric_name === 'change_failure_rate') targets.changeFailureRate = Number(b.target_value);
  }

  if (!isDemoActive) {
    if (plan.status === 'loading') return <PlanLoadingState />;
    if (plan.status === 'error') return <WorkspaceLoadError onRetry={plan.retry} />;
    if (!doraOnPlan) {
      return (
        <div className={PAGE}>
          <div>
            <h1 className={`${PAGE_TITLE_CLASS} mb-1.5`}>{COPY.title}</h1>
            <p className={`${PAGE_SUBTITLE_CLASS} mb-2 max-w-xl`}>{COPY.subtitle}</p>
          </div>
          <div className="bg-white border border-slate-100 rounded-2xl p-6 sm:p-10">
            <PlanRequiredNotice requiredTier={PLAN_ENTITLEMENTS.doraMetrics} testId="dora-plan-required" />
          </div>
        </div>
      );
    }
  }

  return (
    <div className={PAGE}>

      {/* Header: title, subtitle and source line; period, filters and exports on the right */}
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <h1 className={PAGE_TITLE_CLASS}>{COPY.title}</h1>
          <p className={`${PAGE_SUBTITLE_CLASS} mt-1.5 max-w-xl`}>{COPY.subtitle}</p>
          <SourceLine source={source} />
        </div>
        <div className="flex flex-col sm:flex-row sm:flex-wrap xl:flex-nowrap sm:items-center gap-2 xl:shrink-0" data-testid="dora-controls">
          <Filters
            dateRange={dateRange} onDateRange={setDateRange}
            serviceId={selectedService} onService={setSelectedService}
            teamId={selectedTeam} onTeam={setSelectedTeam}
            services={services} teams={teams}
          />
          <div className="grid grid-cols-2 sm:flex gap-2 w-full sm:w-auto">
            <button type="button" disabled={exportDisabled} onClick={() => data && exportToCSV(data, dateRange, isDemoActive)} className={`${EXPORT_BUTTON} disabled:opacity-50 disabled:cursor-not-allowed`}>
              <FileText size={13} aria-hidden="true" /> Export CSV
            </button>
            <button type="button" disabled={exportDisabled} onClick={exportToPDF} className={`${EXPORT_BUTTON} disabled:opacity-50 disabled:cursor-not-allowed`}>
              <Download size={13} aria-hidden="true" /> Download PDF
            </button>
          </div>
        </div>
      </div>

      {showBanner && <NoDataBanner />}

      {/* Loading */}
      {!isDemoActive && isLoading && (
        <div className="flex flex-col gap-4" data-testid="dora-loading" aria-busy="true">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className={`bg-white border border-slate-200 rounded-xl p-4 sm:p-5 ${i < 2 ? 'col-span-2 sm:col-span-1' : 'col-span-1'}`}>
                <Skeleton className="h-3 w-28 mb-4" /><Skeleton className="h-8 w-24 mb-3" /><Skeleton className="h-3 w-full" />
              </div>
            ))}
          </div>
          <div className="grid lg:grid-cols-3 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-5 lg:col-span-2"><Skeleton className="h-4 w-48 mb-4" /><Skeleton className="h-[200px] w-full" /></div>
            <div className="bg-white border border-slate-200 rounded-xl p-5"><Skeleton className="h-4 w-28 mb-4" /><Skeleton className="h-3 w-full mb-2" /><Skeleton className="h-3 w-3/4" /></div>
          </div>
        </div>
      )}

      {/* Error */}
      {loadFailed && (
        <div className="bg-white border border-red-200 rounded-xl p-5 sm:p-6" role="alert" data-testid="dora-error">
          <p className="text-ui text-ink-danger">
            {COPY.loadError}{' '}
            <button type="button" onClick={() => refetch()} className="text-ink-accent ml-1 bg-transparent border-none cursor-pointer font-semibold text-ui min-h-11 sm:min-h-0">Retry →</button>
          </p>
        </div>
      )}

      {data && (
        <>
          <MetricCards data={data} targets={targets} />

          <div className="grid lg:grid-cols-3 gap-4">
            {data.daily && (
              <DailyChart daily={data.daily} days={data.period.days} showFullReport={isDemoActive || finished >= 5} />
            )}
            <WhatChanged
              items={whatChanged(data)}
              emptyText={withoutResult != null ? withoutResultSentence(withoutResult) : COPY.whatChangedEmpty}
            />
          </div>
        </>
      )}

      {(data || loadFailed) && (
        <div className="grid lg:grid-cols-3 gap-4">
          {data && <PerformanceLevels data={data} hasTarget={targets.deploymentFrequency !== undefined || targets.changeFailureRate !== undefined || data.deploymentFrequency.isCustomBenchmark || data.changeFailureRate.isCustomBenchmark} />}
          {isEnterprise ? (
            <YourTargets
              benchmarks={benchmarks}
              bands={data?.bands}
              readOnly={isDemoActive}
              saveError={saveError}
              onSave={saveBenchmark}
              onReset={resetBenchmark}
              onClearError={() => setSaveError(null)}
            />
          ) : (
            <LockedTargets />
          )}
          <DataAndMethod
            sourceSentence={methodSourceSentence(source.kind, isDemoActive)}
            bandsDescription={data?.bands?.description ?? COPY.bandsFallbackDescription}
          />
        </div>
      )}
    </div>
  );
}
