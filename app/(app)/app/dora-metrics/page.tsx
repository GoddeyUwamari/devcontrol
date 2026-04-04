'use client';

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/contexts/auth-context';
import {
  TrendingUp,
  Activity,
  Clock,
  AlertTriangle,
  Timer,
  ArrowUp,
  ArrowDown,
  Minus,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  Download,
  FileText,
  ExternalLink,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import { AreaChart, Area, ResponsiveContainer, Tooltip } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { doraMetricsService } from '@/lib/services/dora-metrics.service';
import {
  DORAMetricsFilters,
  DateRangeOption,
  BenchmarkLevel,
  TrendDirection,
  DORAMetric,
  Service,
  Team,
} from '@/lib/types';
import { useDemoMode } from '@/components/demo/demo-mode-toggle';
import { useSalesDemo } from '@/lib/demo/sales-demo-data';

// Helper function to generate mock 30-day trend data
// TODO: Replace with real API data when available
function generateTrendData(baseValue: number, variance: number = 0.2) {
  return Array.from({ length: 30 }, (_, i) => ({
    day: i + 1,
    value: Math.max(0, baseValue + (Math.random() - 0.5) * variance * baseValue),
  }));
}

// Helper function to export metrics to CSV
function exportToCSV(metrics: any, dateRange: string) {
  const csvData = [
    ['Metric', 'Value', 'Unit', 'Benchmark', 'Trend'],
    [
      'Deployment Frequency',
      metrics.deploymentFrequency.value.toFixed(2),
      metrics.deploymentFrequency.unit,
      metrics.deploymentFrequency.benchmark,
      metrics.deploymentFrequency.trend,
    ],
    [
      'Lead Time for Changes',
      metrics.leadTime.value.toFixed(2),
      metrics.leadTime.unit,
      metrics.leadTime.benchmark,
      metrics.leadTime.trend,
    ],
    [
      'Change Failure Rate',
      metrics.changeFailureRate.value.toFixed(2),
      metrics.changeFailureRate.unit,
      metrics.changeFailureRate.benchmark,
      metrics.changeFailureRate.trend,
    ],
    [
      'Mean Time to Recovery',
      metrics.mttr.value.toFixed(2),
      metrics.mttr.unit,
      metrics.mttr.benchmark,
      metrics.mttr.trend,
    ],
  ];

  const csv = csvData.map((row) => row.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dora-metrics-${dateRange}-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Helper function to export to PDF (using browser print)
function exportToPDF() {
  window.print();
}

// ── DEMO DATA ──────────────────────────────────────────────────────────────

const DEMO_DORA_METRICS = {
  deploymentFrequency: {
    value: 4.2,
    unit: 'per day',
    benchmark: 'elite' as BenchmarkLevel,
    trend: 'improving' as TrendDirection,
    description: 'Deployments per day across all services',
    changeFromPrevious: +0.8,
  },
  leadTime: {
    value: 1.8,
    unit: 'hours',
    benchmark: 'elite' as BenchmarkLevel,
    trend: 'improving' as TrendDirection,
    description: 'Time from commit to production deployment',
    changeFromPrevious: -0.6,
  },
  changeFailureRate: {
    value: 1.2,
    unit: '%',
    benchmark: 'elite' as BenchmarkLevel,
    trend: 'improving' as TrendDirection,
    description: 'Percentage of deployments causing incidents',
    changeFromPrevious: -0.3,
  },
  mttr: {
    value: 14,
    unit: 'minutes',
    benchmark: 'elite' as BenchmarkLevel,
    trend: 'improving' as TrendDirection,
    description: 'Mean time to restore service after incident',
    changeFromPrevious: -22,
  },
};

const DEMO_SERVICE_BREAKDOWN = [
  { name: 'api-gateway',          env: 'production', deployFreq: '6.1/d', leadTime: '0.9h', cfr: '0.8%', mttr: '8m',  tier: 'elite' },
  { name: 'auth-service',         env: 'production', deployFreq: '5.3/d', leadTime: '1.2h', cfr: '1.1%', mttr: '12m', tier: 'elite' },
  { name: 'notification-service', env: 'production', deployFreq: '3.8/d', leadTime: '2.1h', cfr: '1.8%', mttr: '18m', tier: 'elite' },
  { name: 'analytics-worker',     env: 'production', deployFreq: '2.4/d', leadTime: '3.4h', cfr: '2.2%', mttr: '24m', tier: 'high'  },
  { name: 'data-pipeline',        env: 'production', deployFreq: '1.9/d', leadTime: '4.1h', cfr: '3.1%', mttr: '31m', tier: 'high'  },
  { name: 'payment-processor',    env: 'production', deployFreq: '0.8/d', leadTime: '6.2h', cfr: '4.8%', mttr: '52m', tier: 'medium', attention: true },
];

// ── BENCHMARK CONFIG ────────────────────────────────────────────────────────

const BENCHMARK_API = 'http://localhost:8080/api/dora/benchmarks';

interface CustomBenchmark {
  metric_name: string;
  target_value: number;
  target_unit: string;
  performance_label: string;
}

const METRIC_CONFIGS = [
  {
    metricKey: 'deployment_frequency',
    label: 'Deployment Frequency',
    unit: 'per day',
    unitLabel: 'deployments/day',
    higherBetter: true,
    industryElite: 1,
    placeholder: 'e.g. 2',
    hint: 'Teams performing above this threshold are classified Elite.',
  },
  {
    metricKey: 'lead_time',
    label: 'Lead Time for Changes',
    unit: 'hours',
    unitLabel: 'hours',
    higherBetter: false,
    industryElite: 24,
    placeholder: 'e.g. 4',
    hint: 'Teams recovering faster than this threshold are classified Elite.',
  },
  {
    metricKey: 'change_failure_rate',
    label: 'Change Failure Rate',
    unit: 'percentage',
    unitLabel: '%',
    higherBetter: false,
    industryElite: 15,
    placeholder: 'e.g. 5',
    hint: 'Teams with a failure rate below this threshold are classified Elite.',
  },
  {
    metricKey: 'recovery_time',
    label: 'Mean Time to Recovery',
    unit: 'minutes',
    unitLabel: 'minutes',
    higherBetter: false,
    industryElite: 60,
    placeholder: 'e.g. 30',
    hint: 'Teams recovering faster than this threshold are classified Elite.',
  },
] as const;

// ── PAGE COMPONENT ─────────────────────────────────────────────────────────

export default function DORAMetricsPage() {
  const [dateRange, setDateRange] = useState<DateRangeOption>('30d');
  const [selectedService, setSelectedService] = useState<string>('all');
  const [selectedTeam, setSelectedTeam] = useState<string>('all');
  const [selectedEnvironment, setSelectedEnvironment] = useState<string>('all');

  // Benchmark settings state
  const [editingMetric, setEditingMetric] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [editLabel, setEditLabel] = useState<string>('Elite');
  const [saveError, setSaveError] = useState<string | null>(null);

  const { organization } = useAuth();
  const isEnterprise = organization?.subscriptionTier === 'enterprise';
  const queryClient = useQueryClient();

  const demoMode = useDemoMode();
  const salesDemoMode = useSalesDemo((state) => state.enabled);

  // Fetch services for filter dropdown
  const { data: servicesData } = useQuery<{ success: boolean; data: Service[] }>({
    queryKey: ['services'],
    queryFn: async () => {
      const response = await fetch('http://localhost:8080/api/services');
      return response.json();
    },
  });

  // Fetch teams for filter dropdown
  const { data: teamsData } = useQuery<{ success: boolean; data: Team[] }>({
    queryKey: ['teams'],
    queryFn: async () => {
      const response = await fetch('http://localhost:8080/api/teams');
      return response.json();
    },
  });

  // Fetch DORA metrics
  const {
    data: metricsData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['dora-metrics', dateRange, selectedService, selectedTeam, selectedEnvironment],
    queryFn: async () => {
      const filters: DORAMetricsFilters = {
        dateRange,
      };

      if (selectedService && selectedService !== 'all') filters.serviceId = selectedService;
      if (selectedTeam && selectedTeam !== 'all') filters.teamId = selectedTeam;
      if (selectedEnvironment && selectedEnvironment !== 'all') filters.environment = selectedEnvironment;

      return doraMetricsService.getDORAMetrics(filters);
    },
  });

  // Fetch custom benchmarks (enterprise only, but always fetch — gating in UI)
  const { data: benchmarksData, refetch: refetchBenchmarks } = useQuery<{ success: boolean; data: CustomBenchmark[] }>({
    queryKey: ['dora-benchmarks'],
    queryFn: async () => {
      const res = await fetch(BENCHMARK_API);
      return res.json();
    },
  });

  const benchmarksMap: Record<string, CustomBenchmark> = (benchmarksData?.data || []).reduce(
    (acc, b) => ({ ...acc, [b.metric_name]: b }),
    {}
  );

  // Save a custom benchmark
  const saveBenchmark = useCallback(async (metricKey: string, value: string, label: string) => {
    setSaveError(null);
    const parsed = parseFloat(value);
    if (isNaN(parsed) || parsed <= 0) {
      setSaveError('Please enter a valid positive number.');
      return;
    }
    try {
      const res = await fetch(BENCHMARK_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metric_name: metricKey,
          target_value: parsed,
          performance_label: label || 'Elite',
        }),
      });
      if (!res.ok) throw new Error('Save failed');
      await refetchBenchmarks();
      queryClient.invalidateQueries({ queryKey: ['dora-metrics'] });
      setEditingMetric(null);
    } catch {
      setSaveError('Failed to save. Please try again.');
    }
  }, [refetchBenchmarks, queryClient]);

  // Reset a metric to industry standard
  const resetBenchmark = useCallback(async (metricKey: string) => {
    setSaveError(null);
    try {
      await fetch(`${BENCHMARK_API}/${metricKey}`, { method: 'DELETE' });
      await refetchBenchmarks();
      queryClient.invalidateQueries({ queryKey: ['dora-metrics'] });
    } catch {
      setSaveError('Failed to reset. Please try again.');
    }
  }, [refetchBenchmarks, queryClient]);

  const metrics = demoMode ? DEMO_DORA_METRICS : (metricsData?.data ?? null);
  const isDemoActive = demoMode || salesDemoMode;
  const totalDeployments = isDemoActive ? 847 : 0;

  const dataState: 'inactive' | 'insufficient' | 'active' =
    !isDemoActive && totalDeployments === 0
      ? 'inactive'
      : !isDemoActive && totalDeployments < 5
        ? 'insufficient'
        : 'active';

  const dataStateLabel =
    dataState === 'inactive'      ? 'Pipeline inactive — no delivery activity in selected period'
    : dataState === 'insufficient' ? 'Insufficient data for benchmarking — fewer than 5 deployments detected'
    : `Based on ${totalDeployments} deployments`;

  const dataStateColor =
    dataState === 'inactive'      ? '#DC2626'
    : dataState === 'insufficient' ? '#D97706'
    : '#059669';

  const healthyCount = 0;

  const services = servicesData?.data;
  const teams = teamsData?.data;

  return (
    <div style={{
      padding: '40px 56px 80px',
      maxWidth: '1400px',
      margin: '0 auto',
      display: 'flex',
      flexDirection: 'column',
      gap: '24px',
    }}>

      {/* ── PAGE HEADER ── */}
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        marginBottom: '4px',
      }}>
        <div>
          <p style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#7C3AED', margin: '0 0 6px' }}>
            DevOps
          </p>
          <h1 style={{
            fontSize: '1.7rem', fontWeight: 700,
            color: '#0F172A', letterSpacing: '-0.025em',
            marginBottom: '6px', lineHeight: 1.2,
          }}>
            Engineering Intelligence
          </h1>
          <p style={{
            fontSize: '14px', color: '#475569',
            lineHeight: 1.5, maxWidth: '520px',
            marginBottom: '6px',
          }}>
            DORA metrics benchmarked against industry standards · updated automatically from your deployment pipeline.
          </p>
          <div style={{ fontSize: '12px', color: dataStateColor, display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: dataStateColor, display: 'inline-block' }} />
            {dataStateLabel} · Last updated {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <Button
            variant="outline" size="sm"
            onClick={() => metrics && exportToCSV(metrics, dateRange)}
          >
            <FileText className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
          <Button
            variant="outline" size="sm"
            onClick={exportToPDF}
          >
            <Download className="w-4 h-4 mr-2" />
            Download PDF
          </Button>
        </div>
      </div>

      {/* ── COMPACT FILTER BAR ── */}
      <div style={{
        background: '#FFFFFF',
        border: '1px solid #F1F5F9',
        borderRadius: '12px',
        padding: '12px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        flexWrap: 'wrap',
      }}>
        <span style={{
          fontSize: '12px', fontWeight: 600,
          color: '#475569', whiteSpace: 'nowrap',
        }}>
          Period
        </span>
        <div style={{
          display: 'flex', gap: '3px',
          background: '#F8FAFC',
          border: '1px solid #F1F5F9',
          borderRadius: '8px', padding: '3px',
        }}>
          {(['7d', '30d', '90d'] as const).map((r) => (
            <button
              key={r}
              onClick={() => setDateRange(r)}
              style={{
                padding: '5px 14px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 500,
                border: 'none',
                cursor: 'pointer',
                background: dateRange === r ? '#FFFFFF' : 'transparent',
                color: dateRange === r ? '#0F172A' : '#475569',
                boxShadow: dateRange === r ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
              }}
            >
              {r}
            </button>
          ))}
        </div>
        <div style={{ width: '1px', height: '20px', background: '#E2E8F0' }} />
        <span style={{ fontSize: '12px', fontWeight: 600, color: '#475569' }}>
          Service
        </span>
        <Select value={selectedService} onValueChange={setSelectedService}>
          <SelectTrigger style={{ width: '140px', height: '32px', fontSize: '13px' }}>
            <SelectValue placeholder="All Services" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Services</SelectItem>
            {services?.map((s: Service) => (
              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span style={{ fontSize: '12px', fontWeight: 600, color: '#475569' }}>
          Team
        </span>
        <Select value={selectedTeam} onValueChange={setSelectedTeam}>
          <SelectTrigger style={{ width: '120px', height: '32px', fontSize: '13px' }}>
            <SelectValue placeholder="All Teams" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Teams</SelectItem>
            {teams?.map((t: Team) => (
              <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* ENGINEERING INTELLIGENCE STRIP */}
      <div style={{
        background: '#fff', borderRadius: '10px', border: '1px solid #E2E8F0',
        padding: '20px 24px', marginBottom: '0',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: '16px',
      }}>
        {(isDemoActive || dataState === 'active') ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>

            {/* Percentile ring */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ position: 'relative', width: '54px', height: '54px', flexShrink: 0 }}>
                <svg width="54" height="54" viewBox="0 0 54 54">
                  <circle cx="27" cy="27" r="23" fill="none" stroke="#F1F5F9" strokeWidth="5"/>
                  <circle cx="27" cy="27" r="23" fill="none"
                    stroke={isDemoActive ? '#059669' : '#D97706'}
                    strokeWidth="5"
                    strokeDasharray="144.5"
                    strokeDashoffset={isDemoActive ? 12 : 58}
                    strokeLinecap="round"
                    transform="rotate(-90 27 27)"/>
                </svg>
                <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700, color: isDemoActive ? '#059669' : '#D97706' }}>
                  {isDemoActive ? '92nd' : 'N/A'}
                </span>
              </div>
              <div>
                <p style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#64748B', margin: '0 0 4px' }}>Engineering Score</p>
                <p style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0F172A', margin: '0 0 3px' }}>
                  {isDemoActive ? 'Elite Tier — Top 8%' : 'Calculating...'}
                </p>
                <p style={{ fontSize: '0.68rem', color: '#64748B', margin: 0 }}>
                  {isDemoActive
                    ? '92nd percentile vs SaaS teams · 33,000+ data points'
                    : `${totalDeployments} deployments · ${dateRange} window`
                  }
                </p>
              </div>
            </div>

            <div style={{ width: '1px', height: '44px', background: '#E2E8F0', flexShrink: 0 }} />

            {/* Performance drivers */}
            <div>
              <p style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#64748B', margin: '0 0 6px' }}>Performance Drivers</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                {isDemoActive ? (
                  <>
                    <p style={{ fontSize: '0.75rem', color: '#059669', fontWeight: 600, margin: 0 }}>● Change Failure Rate 1.2% — top 5% globally</p>
                    <p style={{ fontSize: '0.75rem', color: '#059669', fontWeight: 500, margin: 0 }}>● Lead time improved 18% this quarter</p>
                    <p style={{ fontSize: '0.75rem', color: '#D97706', fontWeight: 500, margin: 0 }}>● Payment Processor constraining deploy frequency</p>
                  </>
                ) : (
                  <>
                    <p style={{ fontSize: '0.75rem', color: '#64748B', fontWeight: 500, margin: 0 }}>● {healthyCount ?? 0} services with sufficient deployment data</p>
                    <p style={{ fontSize: '0.75rem', color: '#64748B', fontWeight: 500, margin: 0 }}>● Benchmarking active for this period</p>
                  </>
                )}
              </div>
            </div>

            <div style={{ width: '1px', height: '44px', background: '#E2E8F0', flexShrink: 0 }} />

            {/* Business impact */}
            <div>
              <p style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#64748B', margin: '0 0 4px' }}>Business Impact</p>
              <p style={{ fontSize: '0.82rem', fontWeight: 600, color: '#0F172A', margin: '0 0 3px' }}>
                {isDemoActive ? 'Delivery velocity at Elite — feature release cadence strong' : 'Impact analysis requires more deployment data'}
              </p>
              <p style={{ fontSize: '0.68rem', fontWeight: 600, color: '#059669', margin: 0 }}>
                {isDemoActive
                  ? `Operational risk: LOW · high confidence, based on ${isDemoActive ? 847 : totalDeployments} deployments`
                  : 'Connect deployment pipeline to enable impact analysis'
                }
              </p>
            </div>

            <div style={{ width: '1px', height: '44px', background: '#E2E8F0', flexShrink: 0 }} />

            {/* To stay elite / gap */}
            <div>
              <p style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#64748B', margin: '0 0 4px' }}>To Stay Elite</p>
              <p style={{ fontSize: '0.82rem', fontWeight: 600, color: '#D97706', margin: '0 0 3px' }}>
                {isDemoActive ? '1 service lagging' : 'Insufficient baseline'}
              </p>
              <p style={{ fontSize: '0.68rem', color: '#64748B', margin: 0 }}>
                {isDemoActive
                  ? 'Maintain ≥3.5 deploys/day · <5% failure rate'
                  : '+1.6 deploys/day required to reach top 10%'
                }
              </p>
            </div>

          </div>
        ) : (
          /* Inactive / insufficient state */
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ width: '44px', height: '44px', borderRadius: '10px', background: '#F8FAFC', border: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            </div>
            <div>
              <p style={{ fontSize: '0.85rem', fontWeight: 600, color: '#0F172A', margin: '0 0 3px' }}>
                {dataState === 'inactive' ? 'Pipeline Inactive' : 'Insufficient Data for Benchmarking'}
              </p>
              <p style={{ fontSize: '0.75rem', color: '#64748B', margin: 0 }}>
                {dataState === 'inactive'
                  ? 'No deployment activity detected in the selected period. Connect your CI/CD pipeline to begin tracking.'
                  : `Only ${totalDeployments} deployment${totalDeployments !== 1 ? 's' : ''} detected — minimum 5 required for reliable benchmarking.`
                }
              </p>
            </div>
          </div>
        )}
        <a href="/ai-reports" style={{ fontSize: '11px', fontWeight: 700, color: '#7C3AED', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap', flexShrink: 0 }}>
          Full report <ArrowRight size={11} />
        </a>
      </div>

      {/* DECISION INTELLIGENCE */}
      {(isDemoActive || dataState === 'active') && (
        <div style={{
          background: '#fff', borderRadius: '12px', padding: '14px 20px',
          border: '1px solid #E2E8F0',
          display: 'flex', alignItems: 'flex-start', gap: '14px',
        }}>
          <div style={{ width: '28px', height: '28px', borderRadius: '7px', background: '#7C3AED', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Sparkles size={12} style={{ color: '#fff' }} />
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: '0.65rem', fontWeight: 700, color: '#7C3AED', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 4px' }}>Decision Intelligence</p>
            <p style={{ fontSize: '0.84rem', color: '#1E293B', margin: 0, lineHeight: 1.7 }}>
              {isDemoActive ? (
                <>
                  Team performing at <strong style={{ color: '#059669' }}>Elite tier</strong> across 3 of 4 DORA metrics — 92nd percentile vs SaaS teams. Primary constraint: <strong style={{ color: '#DC2626' }}>Payment Processor</strong> (high confidence) — 0.8 deploys/day vs team average 3.8/day.
                  <span style={{ display: 'block', marginTop: '4px', fontSize: '0.78rem', color: '#64748B' }}>
                    Contributing factors: low deployment throughput · high lead time (6.2h) · likely CI queue time or manual approval gating. Resolving this bottleneck could increase overall frequency by ~18% and maintain Elite standing.
                  </span>
                  <span style={{ display: 'block', marginTop: '4px', fontSize: '0.78rem', color: '#475569', fontWeight: 600 }}>
                    Recommended: investigate CI queue time and remove manual approval gates in Payment Processor pipeline.
                  </span>
                </>
              ) : (
                <>
                  {totalDeployments} deployments analyzed in the selected period.
                  {metrics?.deploymentFrequency?.benchmark === 'elite'
                    ? <> Team is performing at <strong style={{ color: '#059669' }}>Elite tier</strong> — maintain current deployment cadence and failure rate targets.</>
                    : <> Connect more services to your deployment pipeline to enable full cross-metric synthesis and gap analysis.</>
                  }
                  <span style={{ display: 'block', marginTop: '4px', fontSize: '0.78rem', color: '#64748B' }}>
                    Cross-metric synthesis and causal analysis available with more deployment data.
                  </span>
                </>
              )}
            </p>
          </div>
          {isDemoActive && (
            <a href="/deployments" style={{ fontSize: '11px', fontWeight: 700, color: '#DC2626', textDecoration: 'none', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
              Resolve bottleneck <ArrowRight size={11} />
            </a>
          )}
        </div>
      )}

      {/* PERFORMANCE POSITIONING */}
      {(isDemoActive || dataState === 'active') && (
        <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid #E2E8F0', padding: '20px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <div>
              <p style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#64748B', margin: '0 0 3px' }}>Performance Positioning</p>
              <p style={{ fontSize: '0.8rem', color: '#475569', margin: 0 }}>
                Where you stand vs. industry · 2024 DORA State of DevOps Report · 33,000+ professionals
              </p>
            </div>
            {isDemoActive && (
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#059669', background: '#ECFDF5', padding: '3px 10px', borderRadius: '100px' }}>92nd Percentile</span>
                <p style={{ fontSize: '10px', color: '#64748B', margin: '4px 0 0', textAlign: 'right' }}>8 pts below top decile · +1.6 deploys/day to reach top 10%</p>
              </div>
            )}
          </div>

          {/* Positioning bar */}
          {isDemoActive && (
            <div style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ fontSize: '11px', color: '#DC2626' }}>Low</span>
                <span style={{ fontSize: '11px', color: '#D97706' }}>Medium</span>
                <span style={{ fontSize: '11px', color: '#2563EB' }}>High</span>
                <span style={{ fontSize: '11px', color: '#059669' }}>Elite</span>
              </div>
              <div style={{ height: '8px', background: '#F1F5F9', borderRadius: '100px', position: 'relative' }}>
                <div style={{ position: 'absolute', left: 0, top: 0, width: '15%', height: '100%', background: '#FEE2E2', borderRadius: '100px 0 0 100px' }} />
                <div style={{ position: 'absolute', left: '15%', top: 0, width: '25%', height: '100%', background: '#FEF3C7' }} />
                <div style={{ position: 'absolute', left: '40%', top: 0, width: '30%', height: '100%', background: '#DBEAFE' }} />
                <div style={{ position: 'absolute', left: '70%', top: 0, width: '30%', height: '100%', background: '#D1FAE5', borderRadius: '0 100px 100px 0' }} />
                <div style={{ position: 'absolute', left: '91%', top: '50%', transform: 'translate(-50%,-50%)', width: '16px', height: '16px', background: '#059669', border: '3px solid #fff', borderRadius: '50%', boxShadow: '0 0 0 2px #059669' }} />
              </div>
              <p style={{ fontSize: '11px', fontWeight: 700, color: '#059669', margin: '8px 0 0', textAlign: 'right', paddingRight: '4%' }}>← You are here (92nd percentile)</p>
            </div>
          )}

          {/* Benchmark table — inline, no shadcn Table */}
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr 1fr 1fr', gap: 0, border: '1px solid #F1F5F9', borderRadius: '8px', overflow: 'hidden' }}>
            {['Tier', 'Deploy Freq', 'Lead Time', 'Failure Rate', 'MTTR'].map(h => (
              <div key={h} style={{ padding: '9px 12px', background: '#F8FAFC', fontSize: '10px', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</div>
            ))}
            {[
              {
                tier: 'Elite', tierColor: '#059669', tierBg: '#ECFDF5',
                df: isDemoActive ? '4.2/day' : '>1/day',
                lt: isDemoActive ? '1.8 hrs' : '<1 hour',
                cfr: isDemoActive ? '1.2%' : '<5%',
                mttr: isDemoActive ? '14 min' : '<1 hour',
                isYou: isDemoActive,
              },
              { tier: 'High', tierColor: '#1E40AF', tierBg: '#EFF6FF', df: '>1/week', lt: '<1 week', cfr: '<10%', mttr: '<1 day', isYou: false },
              { tier: 'Medium', tierColor: '#92400E', tierBg: '#FEF3C7', df: '>1/month', lt: '<1 month', cfr: '<15%', mttr: '<1 week', isYou: false },
              { tier: 'Low', tierColor: '#991B1B', tierBg: '#FEE2E2', df: '<1/month', lt: '>1 month', cfr: '>15%', mttr: '>1 week', isYou: false },
            ].map(row => (
              <>
                <div key={`${row.tier}-tier`} style={{ padding: '10px 12px', background: row.isYou ? '#F0FDF4' : '#fff', borderTop: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {row.isYou && <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#7C3AED', display: 'inline-block', flexShrink: 0 }} />}
                  <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '100px', background: row.tierBg, color: row.tierColor }}>
                    {row.tier}{row.isYou ? ' ← You' : ''}
                  </span>
                </div>
                {[row.df, row.lt, row.cfr, row.mttr].map((val, i) => (
                  <div key={`${row.tier}-${i}`} style={{ padding: '10px 12px', background: row.isYou ? '#F0FDF4' : '#fff', borderTop: '1px solid #F1F5F9', fontSize: row.isYou ? '13px' : '12px', fontWeight: row.isYou ? 700 : 400, color: row.isYou ? row.tierColor : '#475569' }}>{val}</div>
                ))}
              </>
            ))}
          </div>
        </div>
      )}

      {/* ── LOADING STATE ── */}
      {isLoading && !isDemoActive && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '20px',
        }}>
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-4 w-32" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-10 w-24 mb-2" />
                <Skeleton className="h-4 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ── 4 KPI CARDS ── */}
      {metrics && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '20px',
        }}>
          {[
            {
              label: 'Deployment Frequency',
              metric: metrics.deploymentFrequency,
              icon: TrendingUp,
              formatVal: (v: number) => `${v.toFixed(1)}/day`,
              change: isDemoActive ? '+0.8 deploys/day · pipeline throughput increasing' : null,
              changeGood: true,
            },
            {
              label: 'Lead Time for Changes',
              metric: metrics.leadTime,
              icon: Clock,
              formatVal: (v: number) => `${v.toFixed(1)} hrs`,
              change: isDemoActive ? '−0.6 hrs · CI queue time reducing' : null,
              changeGood: true,
            },
            {
              label: 'Change Failure Rate',
              metric: metrics.changeFailureRate,
              icon: AlertTriangle,
              formatVal: (v: number) => `${v.toFixed(1)}%`,
              change: isDemoActive ? '−0.3% · test coverage improving' : null,
              changeGood: true,
            },
            {
              label: 'Mean Time to Recovery',
              metric: metrics.mttr,
              icon: Timer,
              formatVal: (v: number) => `${Math.round(v)} min`,
              change: isDemoActive ? '−22 min · incident response process maturing' : null,
              changeGood: true,
            },
          ].map(({ label, metric, icon: Icon, formatVal, change, changeGood }) => {
            const tierColor =
              metric.benchmark === 'elite'  ? '#059669' :
              metric.benchmark === 'high'   ? '#2563EB' :
              metric.benchmark === 'medium' ? '#D97706' :
              '#DC2626';
            const tierBg =
              metric.benchmark === 'elite'  ? '#ECFDF5' :
              metric.benchmark === 'high'   ? '#EFF6FF' :
              metric.benchmark === 'medium' ? '#FFFBEB' :
              '#FEF2F2';
            const tierLabel =
              metric.benchmark === 'elite'  ? 'Elite'  :
              metric.benchmark === 'high'   ? 'High'   :
              metric.benchmark === 'medium' ? 'Medium' :
              'Low';
            const trendData = generateTrendData(metric.value);

            return (
              <Card key={label} style={{ borderTop: `3px solid ${tierColor}`, overflow: 'hidden' }}>
                <CardHeader style={{ paddingBottom: '8px' }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}>
                    <CardTitle style={{
                      fontSize: '0.68rem',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.1em',
                      color: '#475569',
                    }}>
                      {label}
                    </CardTitle>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px' }}>
                      <span style={{
                        fontSize: '10px',
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: '99px',
                        background: tierBg,
                        color: tierColor,
                        border: `1px solid ${tierColor}30`,
                      }}>
                        {tierLabel}
                      </span>
                      {(metric as DORAMetric).isCustomBenchmark && (
                        <span style={{
                          fontSize: '9px',
                          fontWeight: 600,
                          color: '#7C3AED',
                          background: 'rgba(124,58,237,0.07)',
                          borderRadius: '4px',
                          padding: '1px 5px',
                          whiteSpace: 'nowrap',
                        }}>
                          Custom benchmark
                        </span>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div style={{
                    fontSize: '2.2rem',
                    fontWeight: 700,
                    color: '#0F172A',
                    letterSpacing: '-0.04em',
                    lineHeight: 1,
                    marginBottom: '6px',
                  }}>
                    {formatVal(metric.value)}
                  </div>
                  {change && (
                    <div style={{
                      fontSize: '12px',
                      fontWeight: 500,
                      color: changeGood ? '#059669' : '#DC2626',
                      marginBottom: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}>
                      {changeGood ? '↑' : '↓'} {change} vs last period
                    </div>
                  )}
                  {/* Sparkline */}
                  <div style={{ height: '40px' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={trendData}>
                        <Area
                          type="monotone"
                          dataKey="value"
                          stroke={tierColor}
                          fill={tierColor}
                          fillOpacity={0.15}
                          strokeWidth={2}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  <div style={{ fontSize: '11px', color: '#94A3B8', marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #F1F5F9' }}>
                    {metric.benchmark === 'elite'
                      ? `Exceeds Elite benchmark — no immediate action required`
                      : metric.benchmark === 'high'
                        ? `Above industry median — monitor for regression`
                        : metric.benchmark === 'medium'
                          ? `Below Elite threshold — review pipeline constraints`
                          : dataState === 'inactive'
                            ? 'Pipeline inactive — no activity detected in this period'
                            : dataState === 'insufficient'
                              ? 'Insufficient data — fewer than 5 deployments for reliable benchmarking'
                              : metric.description
                    }
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ── SERVICE BREAKDOWN (demo mode only) ── */}
      {isDemoActive && (
        <Card>
          <CardHeader>
            <div style={{
              fontSize: '0.68rem', fontWeight: 700,
              color: '#475569', textTransform: 'uppercase',
              letterSpacing: '0.1em', marginBottom: '4px',
            }}>
              Service Breakdown
            </div>
            <CardTitle style={{ fontSize: '15px' }}>
              Performance by service · last 90 days
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#D97706', background: '#FEF3C7', padding: '2px 8px', borderRadius: '4px', marginLeft: '8px' }}>
                1 service needs attention
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Table header */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 90px',
              gap: '12px',
              padding: '0 0 10px',
              borderBottom: '1px solid #F1F5F9',
              fontSize: '10px', fontWeight: 700,
              color: '#94A3B8',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}>
              <span>Service</span>
              <span style={{ textAlign: 'right' }}>Deploy Freq</span>
              <span style={{ textAlign: 'right' }}>Lead Time</span>
              <span style={{ textAlign: 'right' }}>Failure Rate</span>
              <span style={{ textAlign: 'right' }}>MTTR</span>
              <span style={{ textAlign: 'center' }}>Tier</span>
            </div>
            {/* Service rows */}
            {DEMO_SERVICE_BREAKDOWN.map((svc) => {
              const tierColor =
                svc.tier === 'elite' ? '#059669' :
                svc.tier === 'high'  ? '#2563EB' :
                '#D97706';
              const tierBg =
                svc.tier === 'elite' ? '#ECFDF5' :
                svc.tier === 'high'  ? '#EFF6FF' :
                '#FFFBEB';
              return (
                <div
                  key={svc.name}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 90px',
                    gap: '12px',
                    padding: svc.attention ? '12px' : '12px 0',
                    borderBottom: '1px solid #F1F5F9',
                    alignItems: 'center',
                    background: svc.attention ? '#FFFBEB' : undefined,
                    borderRadius: svc.attention ? '8px' : undefined,
                  }}
                >
                  <div>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: '#1E293B' }}>
                      {svc.name}
                    </span>
                    <span style={{ fontSize: '11px', color: '#94A3B8', marginLeft: '6px' }}>
                      {svc.env}
                    </span>
                    {svc.attention && (
                      <span style={{
                        fontSize: '10px',
                        fontWeight: 600,
                        color: '#D97706',
                        background: '#FEF3C7',
                        padding: '1px 6px',
                        borderRadius: '4px',
                        marginLeft: '6px',
                      }}>
                        ⚠ Pipeline bottleneck
                      </span>
                    )}
                    {svc.attention && (
                      <div style={{ marginTop: '4px', fontSize: '11px', color: '#D97706', fontWeight: 600 }}>
                        Primary bottleneck · affects ~22% of deployments · upstream dependency for 3 critical services
                      </div>
                    )}
                  </div>
                  {[svc.deployFreq, svc.leadTime, svc.cfr, svc.mttr].map((val, i) => (
                    <div key={i} style={{
                      textAlign: 'right',
                      fontSize: '13px',
                      fontWeight: 600,
                      color: svc.attention ? '#D97706' : '#0F172A',
                    }}>
                      {val}
                    </div>
                  ))}
                  <div style={{ textAlign: 'center' }}>
                    <span style={{
                      fontSize: '10px',
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: '99px',
                      background: tierBg,
                      color: tierColor,
                    }}>
                      {svc.tier.charAt(0).toUpperCase() + svc.tier.slice(1)}
                    </span>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* ── BENCHMARK SETTINGS (Enterprise only) ── */}
      <div style={{
        background: '#FFFFFF',
        border: '1px solid #F1F5F9',
        borderRadius: '16px',
        overflow: 'hidden',
      }}>
        {/* Section header */}
        <div style={{
          padding: '20px 24px',
          borderBottom: '1px solid #F1F5F9',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
        }}>
          <div>
            <div style={{
              fontSize: '0.68rem', fontWeight: 700,
              color: '#64748B', textTransform: 'uppercase',
              letterSpacing: '0.1em', marginBottom: '4px',
            }}>
              Enterprise · Custom Benchmarks
            </div>
            <p style={{ fontSize: '15px', fontWeight: 600, color: '#0F172A', margin: '0 0 4px' }}>
              Benchmark Settings
            </p>
            <p style={{ fontSize: '13px', color: '#64748B', margin: 0 }}>
              Override industry-standard DORA thresholds with targets specific to your organization.
            </p>
          </div>
          {isEnterprise && (
            <span style={{
              fontSize: '11px', fontWeight: 600,
              color: '#059669', background: '#ECFDF5',
              border: '1px solid #D1FAE5',
              borderRadius: '99px', padding: '4px 12px',
              whiteSpace: 'nowrap',
            }}>
              Enterprise Active
            </span>
          )}
        </div>

        {/* Locked state for non-enterprise */}
        {!isEnterprise ? (
          <div style={{
            padding: '56px 24px',
            textAlign: 'center',
            background: '#F8FAFC',
          }}>
            <div style={{
              width: '44px', height: '44px',
              background: '#F1F5F9',
              borderRadius: '12px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '20px',
              margin: '0 auto 16px',
            }}>
              🔒
            </div>
            <p style={{
              fontSize: '14px', fontWeight: 600,
              color: '#0F172A', margin: '0 0 6px',
            }}>
              Custom DORA Benchmarking
            </p>
            <p style={{
              fontSize: '13px', color: '#64748B',
              margin: '0 0 20px', maxWidth: '380px',
              marginLeft: 'auto', marginRight: 'auto',
              lineHeight: 1.6,
            }}>
              Set custom performance thresholds per metric so your team is measured
              against your own standards, not just industry averages.
              Available on the Enterprise plan.
            </p>
            <a
              href="/settings/billing"
              style={{
                display: 'inline-block',
                padding: '9px 20px',
                background: '#7C3AED',
                color: '#fff',
                borderRadius: '8px',
                fontSize: '13px', fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              Upgrade to Enterprise →
            </a>
          </div>
        ) : (
          /* Benchmark rows */
          <div>
            {saveError && (
              <div style={{
                padding: '10px 24px',
                background: '#FEF2F2',
                borderBottom: '1px solid #FECACA',
                fontSize: '13px', color: '#DC2626',
              }}>
                {saveError}
              </div>
            )}
            {METRIC_CONFIGS.map((cfg) => {
              const custom = benchmarksMap[cfg.metricKey];
              const isEditing = editingMetric === cfg.metricKey;
              const hasCustom = !!custom;

              return (
                <div
                  key={cfg.metricKey}
                  style={{
                    padding: '16px 24px',
                    borderBottom: '1px solid #F8FAFC',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px',
                    flexWrap: 'wrap',
                  }}
                >
                  {/* Metric name */}
                  <div style={{ flex: '1 1 180px', minWidth: '150px' }}>
                    <div style={{
                      fontSize: '13px', fontWeight: 600,
                      color: '#0F172A', marginBottom: '2px',
                    }}>
                      {cfg.label}
                    </div>
                    <div style={{ fontSize: '11px', color: '#94A3B8' }}>
                      Unit: {cfg.unitLabel}
                    </div>
                  </div>

                  {/* Current benchmark display */}
                  <div style={{ flex: '1 1 200px' }}>
                    {hasCustom ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{
                          fontSize: '13px', fontWeight: 700, color: '#0F172A',
                        }}>
                          {custom.target_value} {cfg.unitLabel}
                        </span>
                        <span style={{
                          fontSize: '10px', fontWeight: 700,
                          color: '#7C3AED', background: 'rgba(124,58,237,0.08)',
                          borderRadius: '4px', padding: '1px 6px',
                        }}>
                          Custom
                        </span>
                        <span style={{ fontSize: '11px', color: '#64748B' }}>
                          label: &ldquo;{custom.performance_label}&rdquo;
                        </span>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '13px', color: '#64748B' }}>
                          Industry default: {cfg.industryElite} {cfg.unitLabel}
                        </span>
                        <span style={{
                          fontSize: '10px', fontWeight: 600,
                          color: '#94A3B8', background: '#F1F5F9',
                          borderRadius: '4px', padding: '1px 6px',
                        }}>
                          Standard
                        </span>
                      </div>
                    )}
                    {!isEditing && (
                      <div style={{ fontSize: '11px', color: '#94A3B8', marginTop: '2px' }}>
                        {cfg.hint}
                      </div>
                    )}
                  </div>

                  {/* Inline edit form */}
                  {isEditing ? (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      flex: '1 1 320px', flexWrap: 'wrap',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          placeholder={cfg.placeholder}
                          style={{
                            width: '88px',
                            padding: '6px 10px',
                            border: '1px solid #E2E8F0',
                            borderRadius: '7px',
                            fontSize: '13px',
                            color: '#0F172A',
                            outline: 'none',
                          }}
                        />
                        <span style={{ fontSize: '12px', color: '#64748B' }}>
                          {cfg.unitLabel}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span style={{ fontSize: '11px', color: '#94A3B8' }}>Top label:</span>
                        <input
                          type="text"
                          value={editLabel}
                          onChange={(e) => setEditLabel(e.target.value)}
                          placeholder="Elite"
                          maxLength={30}
                          style={{
                            width: '80px',
                            padding: '6px 10px',
                            border: '1px solid #E2E8F0',
                            borderRadius: '7px',
                            fontSize: '13px',
                            color: '#0F172A',
                            outline: 'none',
                          }}
                        />
                      </div>
                      <button
                        onClick={() => saveBenchmark(cfg.metricKey, editValue, editLabel)}
                        style={{
                          padding: '6px 14px',
                          background: '#7C3AED', color: '#fff',
                          border: 'none', borderRadius: '7px',
                          fontSize: '12px', fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Save
                      </button>
                      <button
                        onClick={() => { setEditingMetric(null); setSaveError(null); }}
                        style={{
                          padding: '6px 12px',
                          background: 'transparent', color: '#64748B',
                          border: '1px solid #E2E8F0', borderRadius: '7px',
                          fontSize: '12px', fontWeight: 500,
                          cursor: 'pointer',
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    /* Action buttons */
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <button
                        onClick={() => {
                          setEditingMetric(cfg.metricKey);
                          setEditValue(custom ? String(custom.target_value) : '');
                          setEditLabel(custom?.performance_label || 'Elite');
                          setSaveError(null);
                        }}
                        style={{
                          padding: '6px 14px',
                          background: 'transparent', color: '#475569',
                          border: '1px solid #E2E8F0', borderRadius: '7px',
                          fontSize: '12px', fontWeight: 500,
                          cursor: 'pointer',
                        }}
                      >
                        {hasCustom ? 'Edit' : 'Set Custom'}
                      </button>
                      {hasCustom && (
                        <button
                          onClick={() => resetBenchmark(cfg.metricKey)}
                          style={{
                            padding: '6px 12px',
                            background: 'transparent', color: '#DC2626',
                            border: '1px solid #FECACA', borderRadius: '7px',
                            fontSize: '12px', fontWeight: 500,
                            cursor: 'pointer',
                          }}
                        >
                          Reset to Default
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── ERROR STATE ── */}
      {error && !isDemoActive && (
        <Card style={{ borderColor: '#DC2626' }}>
          <CardContent style={{ padding: '24px' }}>
            <p style={{ color: '#DC2626', fontSize: '14px' }}>
              Failed to load metrics.
              <button
                onClick={() => refetch()}
                style={{
                  color: '#7C3AED',
                  marginLeft: '8px',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '14px',
                }}
              >
                Retry →
              </button>
            </p>
          </CardContent>
        </Card>
      )}

    </div>
  );
}
