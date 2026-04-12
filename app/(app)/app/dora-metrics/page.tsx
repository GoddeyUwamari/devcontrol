'use client';

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/contexts/auth-context';
import { TrendingUp, Activity, Clock, AlertTriangle, Timer, ArrowRight, Sparkles, FileText, Download } from 'lucide-react';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { doraMetricsService } from '@/lib/services/dora-metrics.service';
import { DORAMetricsFilters, DateRangeOption, BenchmarkLevel, TrendDirection, DORAMetric, Service, Team } from '@/lib/types';
import { useDemoMode } from '@/components/demo/demo-mode-toggle';
import { useSalesDemo } from '@/lib/demo/sales-demo-data';

function generateTrendData(baseValue: number, variance: number = 0.2) {
  return Array.from({ length: 30 }, (_, i) => ({ day: i + 1, value: Math.max(0, baseValue + (Math.random() - 0.5) * variance * baseValue) }));
}

function exportToCSV(metrics: any, dateRange: string) {
  const csvData = [['Metric', 'Value', 'Unit', 'Benchmark', 'Trend'], ['Deployment Frequency', metrics.deploymentFrequency.value.toFixed(2), metrics.deploymentFrequency.unit, metrics.deploymentFrequency.benchmark, metrics.deploymentFrequency.trend], ['Lead Time for Changes', metrics.leadTime.value.toFixed(2), metrics.leadTime.unit, metrics.leadTime.benchmark, metrics.leadTime.trend], ['Change Failure Rate', metrics.changeFailureRate.value.toFixed(2), metrics.changeFailureRate.unit, metrics.changeFailureRate.benchmark, metrics.changeFailureRate.trend], ['Mean Time to Recovery', metrics.mttr.value.toFixed(2), metrics.mttr.unit, metrics.mttr.benchmark, metrics.mttr.trend]];
  const csv = csvData.map(row => row.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `dora-metrics-${dateRange}-${new Date().toISOString().split('T')[0]}.csv`; a.click(); URL.revokeObjectURL(url);
}

function exportToPDF() { window.print(); }

const DEMO_DORA_METRICS = {
  deploymentFrequency: { value: 4.2, unit: 'per day', benchmark: 'elite' as BenchmarkLevel, trend: 'improving' as TrendDirection, description: 'Deployments per day across all services', changeFromPrevious: +0.8 },
  leadTime: { value: 1.8, unit: 'hours', benchmark: 'elite' as BenchmarkLevel, trend: 'improving' as TrendDirection, description: 'Time from commit to production deployment', changeFromPrevious: -0.6 },
  changeFailureRate: { value: 1.2, unit: '%', benchmark: 'elite' as BenchmarkLevel, trend: 'improving' as TrendDirection, description: 'Percentage of deployments causing incidents', changeFromPrevious: -0.3 },
  mttr: { value: 14, unit: 'minutes', benchmark: 'elite' as BenchmarkLevel, trend: 'improving' as TrendDirection, description: 'Mean time to restore service after incident', changeFromPrevious: -22 },
};

const DEMO_SERVICE_BREAKDOWN = [
  { name: 'api-gateway',          env: 'production', deployFreq: '6.1/d', leadTime: '0.9h', cfr: '0.8%', mttr: '8m',  tier: 'elite' },
  { name: 'auth-service',         env: 'production', deployFreq: '5.3/d', leadTime: '1.2h', cfr: '1.1%', mttr: '12m', tier: 'elite' },
  { name: 'notification-service', env: 'production', deployFreq: '3.8/d', leadTime: '2.1h', cfr: '1.8%', mttr: '18m', tier: 'elite' },
  { name: 'analytics-worker',     env: 'production', deployFreq: '2.4/d', leadTime: '3.4h', cfr: '2.2%', mttr: '24m', tier: 'high'  },
  { name: 'data-pipeline',        env: 'production', deployFreq: '1.9/d', leadTime: '4.1h', cfr: '3.1%', mttr: '31m', tier: 'high'  },
  { name: 'payment-processor',    env: 'production', deployFreq: '0.8/d', leadTime: '6.2h', cfr: '4.8%', mttr: '52m', tier: 'medium', attention: true },
];

const BENCHMARK_API = 'http://localhost:8080/api/dora/benchmarks';
interface CustomBenchmark { metric_name: string; target_value: number; target_unit: string; performance_label: string; }

const METRIC_CONFIGS = [
  { metricKey: 'deployment_frequency', label: 'Deployment Frequency',   unit: 'per day',    unitLabel: 'deployments/day', higherBetter: true,  industryElite: 1,  placeholder: 'e.g. 2',  hint: 'Teams performing above this threshold are classified Elite.' },
  { metricKey: 'lead_time',            label: 'Lead Time for Changes',  unit: 'hours',      unitLabel: 'hours',           higherBetter: false, industryElite: 24, placeholder: 'e.g. 4',  hint: 'Teams recovering faster than this threshold are classified Elite.' },
  { metricKey: 'change_failure_rate',  label: 'Change Failure Rate',    unit: 'percentage', unitLabel: '%',               higherBetter: false, industryElite: 15, placeholder: 'e.g. 5',  hint: 'Teams with a failure rate below this threshold are classified Elite.' },
  { metricKey: 'recovery_time',        label: 'Mean Time to Recovery',  unit: 'minutes',    unitLabel: 'minutes',         higherBetter: false, industryElite: 60, placeholder: 'e.g. 30', hint: 'Teams recovering faster than this threshold are classified Elite.' },
] as const;

const tierStyle = (tier: string) => {
  if (tier === 'elite')  return { color: '#059669', bg: '#ECFDF5' }
  if (tier === 'high')   return { color: '#2563EB', bg: '#EFF6FF' }
  if (tier === 'medium') return { color: '#D97706', bg: '#FFFBEB' }
  return { color: '#DC2626', bg: '#FEF2F2' }
}

export default function DORAMetricsPage() {
  const [dateRange, setDateRange] = useState<DateRangeOption>('30d');
  const [selectedService, setSelectedService] = useState<string>('all');
  const [selectedTeam, setSelectedTeam] = useState<string>('all');
  const [selectedEnvironment, setSelectedEnvironment] = useState<string>('all');
  const [editingMetric, setEditingMetric] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [editLabel, setEditLabel] = useState<string>('Elite');
  const [saveError, setSaveError] = useState<string | null>(null);

  const { organization } = useAuth();
  const isEnterprise = organization?.subscriptionTier === 'enterprise';
  const queryClient = useQueryClient();
  const demoMode = useDemoMode();
  const salesDemoMode = useSalesDemo((state) => state.enabled);
  const isDemoActive = demoMode || salesDemoMode;

  const { data: servicesData } = useQuery<{ success: boolean; data: Service[] }>({ queryKey: ['services'], queryFn: async () => { const r = await fetch('http://localhost:8080/api/services'); return r.json(); } });
  const { data: teamsData } = useQuery<{ success: boolean; data: Team[] }>({ queryKey: ['teams'], queryFn: async () => { const r = await fetch('http://localhost:8080/api/teams'); return r.json(); } });
  const { data: metricsData, isLoading, error, refetch } = useQuery({ queryKey: ['dora-metrics', dateRange, selectedService, selectedTeam, selectedEnvironment], queryFn: async () => { const filters: DORAMetricsFilters = { dateRange }; if (selectedService !== 'all') filters.serviceId = selectedService; if (selectedTeam !== 'all') filters.teamId = selectedTeam; if (selectedEnvironment !== 'all') filters.environment = selectedEnvironment; return doraMetricsService.getDORAMetrics(filters); } });
  const { data: benchmarksData, refetch: refetchBenchmarks } = useQuery<{ success: boolean; data: CustomBenchmark[] }>({ queryKey: ['dora-benchmarks'], queryFn: async () => { const r = await fetch(BENCHMARK_API); return r.json(); } });

  const benchmarksMap: Record<string, CustomBenchmark> = (benchmarksData?.data || []).reduce((acc, b) => ({ ...acc, [b.metric_name]: b }), {});

  const saveBenchmark = useCallback(async (metricKey: string, value: string, label: string) => {
    setSaveError(null);
    const parsed = parseFloat(value);
    if (isNaN(parsed) || parsed <= 0) { setSaveError('Please enter a valid positive number.'); return; }
    try {
      const res = await fetch(BENCHMARK_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ metric_name: metricKey, target_value: parsed, performance_label: label || 'Elite' }) });
      if (!res.ok) throw new Error('Save failed');
      await refetchBenchmarks(); queryClient.invalidateQueries({ queryKey: ['dora-metrics'] }); setEditingMetric(null);
    } catch { setSaveError('Failed to save. Please try again.'); }
  }, [refetchBenchmarks, queryClient]);

  const resetBenchmark = useCallback(async (metricKey: string) => {
    setSaveError(null);
    try { await fetch(`${BENCHMARK_API}/${metricKey}`, { method: 'DELETE' }); await refetchBenchmarks(); queryClient.invalidateQueries({ queryKey: ['dora-metrics'] }); }
    catch { setSaveError('Failed to reset. Please try again.'); }
  }, [refetchBenchmarks, queryClient]);

  const metrics = demoMode ? DEMO_DORA_METRICS : (metricsData?.data ?? null);
  const totalDeployments = isDemoActive ? 847 : 0;
  const dataState: 'inactive' | 'insufficient' | 'active' = !isDemoActive && totalDeployments === 0 ? 'inactive' : !isDemoActive && totalDeployments < 5 ? 'insufficient' : 'active';
  const dataStateLabel = dataState === 'inactive' ? 'Pipeline inactive — no delivery activity in selected period' : dataState === 'insufficient' ? 'Insufficient data for benchmarking — fewer than 5 deployments detected' : `Based on ${totalDeployments} deployments`;
  const dataStateColor = dataState === 'inactive' ? '#DC2626' : dataState === 'insufficient' ? '#D97706' : '#059669';
  const services = servicesData?.data;
  const teams = teamsData?.data;

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 max-w-[1400px] mx-auto flex flex-col gap-6">

      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[10px] font-bold text-violet-600 uppercase tracking-widest mb-1.5">DevOps</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mb-1.5 leading-tight">Engineering Intelligence</h1>
          <p className="text-sm text-slate-500 leading-relaxed mb-2 max-w-lg">DORA metrics benchmarked against industry standards · updated automatically from your deployment pipeline.</p>
          <div className="flex items-center gap-1.5 text-xs" style={{ color: dataStateColor }}>
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dataStateColor }} />
            {dataStateLabel} · Last updated {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => metrics && exportToCSV(metrics, dateRange)} className="flex items-center gap-1.5 bg-white border border-slate-200 text-slate-500 px-3.5 py-2 rounded-lg text-xs font-medium cursor-pointer hover:bg-slate-50 transition-colors whitespace-nowrap">
            <FileText size={13} /> Export CSV
          </button>
          <button onClick={exportToPDF} className="flex items-center gap-1.5 bg-white border border-slate-200 text-slate-500 px-3.5 py-2 rounded-lg text-xs font-medium cursor-pointer hover:bg-slate-50 transition-colors whitespace-nowrap">
            <Download size={13} /> Download PDF
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="bg-white border border-slate-100 rounded-xl px-4 sm:px-5 py-3 overflow-x-auto">
        <div className="flex items-center gap-3" style={{ minWidth: 'max-content' }}>
          <span className="text-xs font-semibold text-slate-500">Period</span>
          <div className="flex bg-slate-50 border border-slate-100 rounded-lg p-0.5 gap-0.5">
            {(['7d', '30d', '90d'] as const).map(r => (
              <button key={r} onClick={() => setDateRange(r)} className={`px-3.5 py-1.5 rounded-md text-xs font-medium border-none cursor-pointer transition-all ${dateRange === r ? 'bg-white text-slate-900 shadow-sm' : 'bg-transparent text-slate-500'}`}>{r}</button>
            ))}
          </div>
          <div className="w-px h-5 bg-slate-200" />
          <span className="text-xs font-semibold text-slate-500">Service</span>
          <div style={{ width: '140px' }}>
            <Select value={selectedService} onValueChange={setSelectedService}>
              <SelectTrigger className="w-full h-8 text-xs"><SelectValue placeholder="All Services" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Services</SelectItem>
                {services?.map((s: Service) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <span className="text-xs font-semibold text-slate-500">Team</span>
          <div style={{ width: '120px' }}>
            <Select value={selectedTeam} onValueChange={setSelectedTeam}>
              <SelectTrigger className="w-full h-8 text-xs"><SelectValue placeholder="All Teams" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Teams</SelectItem>
                {teams?.map((t: Team) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Engineering Intelligence Strip */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
          {(isDemoActive || dataState === 'active') ? (
            <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-5 flex-wrap">
              {/* Score ring */}
              <div className="flex items-center gap-3">
                <div className="relative w-12 h-12 shrink-0">
                  <svg width="54" height="54" viewBox="0 0 54 54">
                    <circle cx="27" cy="27" r="23" fill="none" stroke="#F1F5F9" strokeWidth="5"/>
                    <circle cx="27" cy="27" r="23" fill="none" stroke={isDemoActive ? '#059669' : '#D97706'} strokeWidth="5" strokeDasharray="144.5" strokeDashoffset={isDemoActive ? 12 : 58} strokeLinecap="round" transform="rotate(-90 27 27)"/>
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold" style={{ color: isDemoActive ? '#059669' : '#D97706' }}>{isDemoActive ? '92nd' : 'N/A'}</span>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Engineering Score</p>
                  <p className="text-sm font-bold text-slate-900 mb-0.5">{isDemoActive ? 'Elite Tier — Top 8%' : 'Calculating...'}</p>
                  <p className="text-[10px] text-slate-400">{isDemoActive ? '92nd percentile vs SaaS teams · 33,000+ data points' : `${totalDeployments} deployments · ${dateRange} window`}</p>
                </div>
              </div>
              <div className="hidden sm:block w-px h-10 bg-slate-200 shrink-0" />
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Performance Drivers</p>
                <div className="flex flex-col gap-0.5">
                  {isDemoActive ? (<>
                    <p className="text-xs text-green-600 font-semibold">● Change Failure Rate 1.2% — top 5% globally</p>
                    <p className="text-xs text-green-600 font-medium">● Lead time improved 18% this quarter</p>
                    <p className="text-xs text-amber-500 font-medium">● Payment Processor constraining deploy frequency</p>
                  </>) : (<>
                    <p className="text-xs text-slate-400 font-medium">● Benchmarking active for this period</p>
                  </>)}
                </div>
              </div>
              <div className="hidden sm:block w-px h-10 bg-slate-200 shrink-0" />
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Business Impact</p>
                <p className="text-xs font-semibold text-slate-900 mb-0.5">{isDemoActive ? 'Delivery velocity at Elite — feature release cadence strong' : 'Impact analysis requires more deployment data'}</p>
                <p className="text-[10px] font-semibold text-green-600">{isDemoActive ? `Operational risk: LOW · high confidence, based on 847 deployments` : 'Connect deployment pipeline to enable impact analysis'}</p>
              </div>
              <div className="hidden sm:block w-px h-10 bg-slate-200 shrink-0" />
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">To Stay Elite</p>
                <p className="text-xs font-semibold text-amber-500 mb-0.5">{isDemoActive ? '1 service lagging' : 'Insufficient baseline'}</p>
                <p className="text-[10px] text-slate-400">{isDemoActive ? 'Maintain ≥3.5 deploys/day · <5% failure rate' : '+1.6 deploys/day required to reach top 10%'}</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-4">
              <div className="w-11 h-11 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center shrink-0">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900 mb-0.5">{dataState === 'inactive' ? 'Pipeline Inactive' : 'Insufficient Data for Benchmarking'}</p>
                <p className="text-xs text-slate-400">{dataState === 'inactive' ? 'No deployment activity detected. Connect your CI/CD pipeline to begin tracking.' : `Only ${totalDeployments} deployment${totalDeployments !== 1 ? 's' : ''} detected — minimum 5 required.`}</p>
              </div>
            </div>
          )}
          <a href="/ai-reports" className="text-[11px] font-bold text-violet-600 no-underline flex items-center gap-1 whitespace-nowrap shrink-0 self-start lg:self-auto">Full report <ArrowRight size={10} /></a>
        </div>
      </div>

      {/* Decision Intelligence */}
      {(isDemoActive || dataState === 'active') && (
        <div className="bg-white rounded-xl border border-slate-100 px-4 sm:px-5 py-4 flex items-start gap-3.5">
          <div className="w-7 h-7 rounded-lg bg-violet-600 flex items-center justify-center shrink-0"><Sparkles size={12} className="text-white" /></div>
          <div className="flex-1">
            <p className="text-[10px] font-bold text-violet-600 uppercase tracking-widest mb-1">Decision Intelligence</p>
            <p className="text-sm text-slate-700 leading-relaxed">
              {isDemoActive ? (<>Team performing at <strong className="text-green-600">Elite tier</strong> across 3 of 4 DORA metrics — 92nd percentile vs SaaS teams. Primary constraint: <strong className="text-red-600">Payment Processor</strong> — 0.8 deploys/day vs team average 3.8/day.<span className="block mt-1 text-xs text-slate-400">Contributing factors: low deployment throughput · high lead time (6.2h) · likely CI queue time or manual approval gating.</span><span className="block mt-1 text-xs text-slate-500 font-semibold">Recommended: investigate CI queue time and remove manual approval gates in Payment Processor pipeline.</span></>) : (<>{totalDeployments} deployments analyzed in the selected period. Connect more services to your deployment pipeline to enable full cross-metric synthesis and gap analysis.<span className="block mt-1 text-xs text-slate-400">Cross-metric synthesis and causal analysis available with more deployment data.</span></>)}
            </p>
          </div>
          {isDemoActive && <a href="/deployments" className="text-[11px] font-bold text-red-600 no-underline shrink-0 flex items-center gap-1 whitespace-nowrap">Resolve bottleneck <ArrowRight size={10} /></a>}
        </div>
      )}

      {/* Performance Positioning */}
      {(isDemoActive || dataState === 'active') && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Performance Positioning</p>
              <p className="text-xs text-slate-500">Where you stand vs. industry · 2024 DORA State of DevOps Report · 33,000+ professionals</p>
            </div>
            {isDemoActive && (
              <div className="text-right shrink-0">
                <span className="text-xs font-bold text-green-600 bg-green-50 px-2.5 py-1 rounded-full">92nd Percentile</span>
                <p className="text-[10px] text-slate-400 mt-1">8 pts below top decile · +1.6 deploys/day to reach top 10%</p>
              </div>
            )}
          </div>
          {isDemoActive && (
            <div className="mb-5">
              <div className="flex justify-between mb-1.5">
                {['Low', 'Medium', 'High', 'Elite'].map((l, i) => <span key={l} className={`text-[11px] ${i === 0 ? 'text-red-600' : i === 1 ? 'text-amber-500' : i === 2 ? 'text-blue-600' : 'text-green-600'}`}>{l}</span>)}
              </div>
              <div className="h-2 bg-slate-100 rounded-full relative">
                <div className="absolute left-0 top-0 w-[15%] h-full bg-red-100 rounded-l-full" />
                <div className="absolute left-[15%] top-0 w-[25%] h-full bg-amber-100" />
                <div className="absolute left-[40%] top-0 w-[30%] h-full bg-blue-100" />
                <div className="absolute left-[70%] top-0 w-[30%] h-full bg-green-100 rounded-r-full" />
                <div className="absolute w-4 h-4 bg-green-600 border-[3px] border-white rounded-full shadow-md" style={{ left: '91%', top: '50%', transform: 'translate(-50%,-50%)' }} />
              </div>
              <p className="text-[11px] font-bold text-green-600 mt-2 text-right pr-[4%]">← You are here (92nd percentile)</p>
            </div>
          )}
          {/* Benchmark table */}
          <div className="border border-slate-100 rounded-xl overflow-hidden">
            <div className="grid bg-slate-50" style={{ gridTemplateColumns: '110px 1fr 1fr 1fr 1fr' }}>
              {['Tier', 'Deploy Freq', 'Lead Time', 'Failure Rate', 'MTTR'].map(h => (
                <div key={h} className="px-3 py-2.5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">{h}</div>
              ))}
            </div>
            {[
              { tier: 'Elite', ts: tierStyle('elite'), df: isDemoActive ? '4.2/day' : '>1/day', lt: isDemoActive ? '1.8 hrs' : '<1 hour', cfr: isDemoActive ? '1.2%' : '<5%', mttr: isDemoActive ? '14 min' : '<1 hour', isYou: isDemoActive },
              { tier: 'High',   ts: tierStyle('high'),   df: '>1/week',  lt: '<1 week',  cfr: '<10%', mttr: '<1 day',  isYou: false },
              { tier: 'Medium', ts: tierStyle('medium'), df: '>1/month', lt: '<1 month', cfr: '<15%', mttr: '<1 week', isYou: false },
              { tier: 'Low',    ts: tierStyle('low'),    df: '<1/month', lt: '>1 month', cfr: '>15%', mttr: '>1 week', isYou: false },
            ].map(row => (
              <div key={row.tier} className={`grid border-t border-slate-100 ${row.isYou ? 'bg-green-50' : 'bg-white'}`} style={{ gridTemplateColumns: '110px 1fr 1fr 1fr 1fr' }}>
                <div className="px-3 py-2.5 flex items-center gap-1.5">
                  {row.isYou && <span className="w-1.5 h-1.5 rounded-full bg-violet-600 shrink-0" />}
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: row.ts.bg, color: row.ts.color }}>{row.tier}{row.isYou ? ' ← You' : ''}</span>
                </div>
                {[row.df, row.lt, row.cfr, row.mttr].map((val, i) => (
                  <div key={i} className="px-3 py-2.5 text-xs" style={{ fontWeight: row.isYou ? 700 : 400, color: row.isYou ? row.ts.color : '#475569' }}>{val}</div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Loading state */}
      {isLoading && !isDemoActive && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}><CardHeader><Skeleton className="h-4 w-32" /></CardHeader><CardContent><Skeleton className="h-10 w-24 mb-2" /><Skeleton className="h-4 w-full" /></CardContent></Card>
          ))}
        </div>
      )}

      {/* 4 KPI cards */}
      {metrics && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Deployment Frequency', metric: metrics.deploymentFrequency, icon: TrendingUp, formatVal: (v: number) => `${v.toFixed(1)}/day`, change: isDemoActive ? '+0.8 deploys/day · pipeline throughput increasing' : null },
            { label: 'Lead Time for Changes', metric: metrics.leadTime,           icon: Clock,       formatVal: (v: number) => `${v.toFixed(1)} hrs`,  change: isDemoActive ? '−0.6 hrs · CI queue time reducing' : null },
            { label: 'Change Failure Rate',   metric: metrics.changeFailureRate,  icon: AlertTriangle, formatVal: (v: number) => `${v.toFixed(1)}%`,  change: isDemoActive ? '−0.3% · test coverage improving' : null },
            { label: 'Mean Time to Recovery', metric: metrics.mttr,               icon: Timer,       formatVal: (v: number) => `${Math.round(v)} min`, change: isDemoActive ? '−22 min · incident response process maturing' : null },
          ].map(({ label, metric, icon: Icon, formatVal, change }) => {
            const ts = tierStyle(metric.benchmark)
            const trendData = generateTrendData(metric.value)
            return (
              <Card key={label} style={{ borderTop: `3px solid ${ts.color}`, overflow: 'hidden' }}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</CardTitle>
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: ts.bg, color: ts.color, border: `1px solid ${ts.color}30` }}>{metric.benchmark.charAt(0).toUpperCase() + metric.benchmark.slice(1)}</span>
                      {(metric as DORAMetric).isCustomBenchmark && <span className="text-[9px] font-semibold text-violet-600 bg-violet-50 rounded px-1.5 py-0.5 whitespace-nowrap">Custom benchmark</span>}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight leading-none mb-1.5">{formatVal(metric.value)}</div>
                  {change && <div className="text-xs font-medium text-green-600 mb-3 flex items-center gap-1">↑ {change} vs last period</div>}
                  <div className="h-10">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={trendData}>
                        <Area type="monotone" dataKey="value" stroke={ts.color} fill={ts.color} fillOpacity={0.15} strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="text-[11px] text-slate-300 mt-2.5 pt-2.5 border-t border-slate-50">
                    {metric.benchmark === 'elite' ? 'Exceeds Elite benchmark — no immediate action required' : metric.benchmark === 'high' ? 'Above industry median — monitor for regression' : metric.benchmark === 'medium' ? 'Below Elite threshold — review pipeline constraints' : dataState === 'inactive' ? 'Pipeline inactive — no activity detected in this period' : dataState === 'insufficient' ? 'Insufficient data — fewer than 5 deployments' : metric.description}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Service Breakdown */}
      {isDemoActive && (
        <Card>
          <CardHeader>
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Service Breakdown</div>
            <CardTitle className="text-sm flex flex-wrap items-center gap-2">
              Performance by service · last 90 days
              <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded">1 service needs attention</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="hidden sm:grid pb-2 border-b border-slate-100 text-[10px] font-bold text-slate-300 uppercase tracking-widest" style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 80px', gap: '12px' }}>
              <span>Service</span><span className="text-right">Deploy Freq</span><span className="text-right">Lead Time</span><span className="text-right">Failure Rate</span><span className="text-right">MTTR</span><span className="text-center">Tier</span>
            </div>
            {DEMO_SERVICE_BREAKDOWN.map(svc => {
              const ts = tierStyle(svc.tier)
              return (
                <div key={svc.name} className={`py-3 border-b border-slate-50 last:border-0 ${svc.attention ? 'bg-amber-50 rounded-xl px-3 -mx-3' : ''}`}>
                  {/* Desktop row */}
                  <div className="hidden sm:grid items-center" style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 80px', gap: '12px' }}>
                    <div>
                      <span className="text-sm font-semibold text-slate-700">{svc.name}</span>
                      <span className="text-[11px] text-slate-300 ml-1.5">{svc.env}</span>
                      {svc.attention && <span className="text-[10px] font-semibold text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded ml-1.5">⚠ Pipeline bottleneck</span>}
                      {svc.attention && <div className="mt-1 text-[11px] text-amber-600 font-semibold">Primary bottleneck · affects ~22% of deployments · upstream dependency for 3 critical services</div>}
                    </div>
                    {[svc.deployFreq, svc.leadTime, svc.cfr, svc.mttr].map((val, i) => (
                      <div key={i} className="text-right text-sm font-semibold" style={{ color: svc.attention ? '#D97706' : '#0F172A' }}>{val}</div>
                    ))}
                    <div className="text-center"><span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: ts.bg, color: ts.color }}>{svc.tier.charAt(0).toUpperCase() + svc.tier.slice(1)}</span></div>
                  </div>
                  {/* Mobile card */}
                  <div className="sm:hidden">
                    <div className="flex items-start justify-between mb-1.5">
                      <div>
                        <span className="text-sm font-semibold text-slate-700">{svc.name}</span>
                        <span className="text-[11px] text-slate-300 ml-1.5">{svc.env}</span>
                        {svc.attention && <span className="text-[10px] font-semibold text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded ml-1.5">⚠ Bottleneck</span>}
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0" style={{ background: ts.bg, color: ts.color }}>{svc.tier.charAt(0).toUpperCase() + svc.tier.slice(1)}</span>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                      <span>{svc.deployFreq}</span><span>{svc.leadTime}</span><span>{svc.cfr}</span><span>{svc.mttr}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      {/* Benchmark Settings */}
      <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden">
        <div className="px-5 sm:px-6 py-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Enterprise · Custom Benchmarks</div>
            <p className="text-sm font-semibold text-slate-900 mb-1">Benchmark Settings</p>
            <p className="text-xs text-slate-500">Override industry-standard DORA thresholds with targets specific to your organization.</p>
          </div>
          {isEnterprise && <span className="text-[11px] font-semibold text-green-600 bg-green-50 border border-green-200 rounded-full px-3 py-1 whitespace-nowrap self-start">Enterprise Active</span>}
        </div>
        {!isEnterprise ? (
          <div className="p-10 sm:p-16 text-center bg-slate-50">
            <div className="w-11 h-11 bg-slate-100 rounded-xl flex items-center justify-center text-xl mx-auto mb-4">🔒</div>
            <p className="text-sm font-semibold text-slate-900 mb-1.5">Custom DORA Benchmarking</p>
            <p className="text-xs text-slate-500 leading-relaxed mb-5 max-w-sm mx-auto">Set custom performance thresholds per metric so your team is measured against your own standards, not just industry averages. Available on the Enterprise plan.</p>
            <a href="/settings/billing" className="inline-block bg-violet-600 hover:bg-violet-700 text-white px-5 py-2.5 rounded-lg text-xs font-semibold no-underline transition-colors">Upgrade to Enterprise →</a>
          </div>
        ) : (
          <div>
            {saveError && <div className="px-5 py-2.5 bg-red-50 border-b border-red-100 text-xs text-red-600">{saveError}</div>}
            {METRIC_CONFIGS.map(cfg => {
              const custom = benchmarksMap[cfg.metricKey]
              const isEditing = editingMetric === cfg.metricKey
              const hasCustom = !!custom
              return (
                <div key={cfg.metricKey} className="px-5 py-4 border-b border-slate-50 flex flex-wrap items-center gap-4">
                  <div className="flex-1 min-w-36">
                    <div className="text-sm font-semibold text-slate-900 mb-0.5">{cfg.label}</div>
                    <div className="text-[11px] text-slate-400">Unit: {cfg.unitLabel}</div>
                  </div>
                  <div className="flex-1 min-w-48">
                    {hasCustom ? (
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-900">{custom.target_value} {cfg.unitLabel}</span>
                        <span className="text-[10px] font-bold text-violet-600 bg-violet-50 rounded px-1.5 py-0.5">Custom</span>
                        <span className="text-[11px] text-slate-400">label: "{custom.performance_label}"</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-400">Industry default: {cfg.industryElite} {cfg.unitLabel}</span>
                        <span className="text-[10px] font-semibold text-slate-400 bg-slate-100 rounded px-1.5 py-0.5">Standard</span>
                      </div>
                    )}
                    {!isEditing && <div className="text-[11px] text-slate-400 mt-0.5">{cfg.hint}</div>}
                  </div>
                  {isEditing ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex items-center gap-1.5">
                        <input type="number" min="0" step="any" value={editValue} onChange={e => setEditValue(e.target.value)} placeholder={cfg.placeholder} className="w-20 px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-900 outline-none focus:border-violet-500 transition-colors" />
                        <span className="text-xs text-slate-400">{cfg.unitLabel}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-slate-400">Top label:</span>
                        <input type="text" value={editLabel} onChange={e => setEditLabel(e.target.value)} placeholder="Elite" maxLength={30} className="w-20 px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-900 outline-none focus:border-violet-500 transition-colors" />
                      </div>
                      <button onClick={() => saveBenchmark(cfg.metricKey, editValue, editLabel)} className="px-3.5 py-1.5 bg-violet-600 hover:bg-violet-700 text-white border-none rounded-lg text-xs font-semibold cursor-pointer transition-colors">Save</button>
                      <button onClick={() => { setEditingMetric(null); setSaveError(null); }} className="px-3 py-1.5 bg-transparent text-slate-500 border border-slate-200 rounded-lg text-xs font-medium cursor-pointer hover:bg-slate-50 transition-colors">Cancel</button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button onClick={() => { setEditingMetric(cfg.metricKey); setEditValue(custom ? String(custom.target_value) : ''); setEditLabel(custom?.performance_label || 'Elite'); setSaveError(null); }} className="px-3.5 py-1.5 bg-transparent text-slate-500 border border-slate-200 rounded-lg text-xs font-medium cursor-pointer hover:bg-slate-50 transition-colors">{hasCustom ? 'Edit' : 'Set Custom'}</button>
                      {hasCustom && <button onClick={() => resetBenchmark(cfg.metricKey)} className="px-3 py-1.5 bg-transparent text-red-600 border border-red-200 rounded-lg text-xs font-medium cursor-pointer hover:bg-red-50 transition-colors">Reset to Default</button>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Error state */}
      {error && !isDemoActive && (
        <Card style={{ borderColor: '#DC2626' }}>
          <CardContent className="p-6">
            <p className="text-sm text-red-600">Failed to load metrics. <button onClick={() => refetch()} className="text-violet-600 ml-2 bg-transparent border-none cursor-pointer font-semibold text-sm">Retry →</button></p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}