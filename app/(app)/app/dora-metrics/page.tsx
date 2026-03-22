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
  const isDemoActive = demoMode;
  const totalDeployments = demoMode ? 847 : 0;

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
          <h1 style={{
            fontSize: '1.7rem', fontWeight: 700,
            color: '#0F172A', letterSpacing: '-0.025em',
            marginBottom: '6px', lineHeight: 1.2,
          }}>
            Engineering Performance
          </h1>
          <p style={{
            fontSize: '14px', color: '#475569',
            lineHeight: 1.5, maxWidth: '520px',
            marginBottom: '6px',
          }}>
            DORA metrics benchmarked against industry standards. Updated automatically from your
            deployment pipeline.
          </p>
          <div style={{
            fontSize: '12px', color: '#94A3B8',
            display: 'flex', alignItems: 'center',
            gap: '6px',
          }}>
            <span style={{
              width: '6px', height: '6px',
              borderRadius: '50%',
              background: '#059669',
              display: 'inline-block',
            }} />
            Based on {totalDeployments} deployments ·{' '}
            Last updated {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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

      {/* ── AI INSIGHT STRIP (demo mode only) ── */}
      {isDemoActive && (
        <div style={{
          background: '#FFFFFF',
          border: '1px solid #F1F5F9',
          borderRadius: '16px',
          padding: '18px 24px',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '16px',
        }}>
          <div style={{
            width: '36px', height: '36px',
            background: '#7C3AED',
            borderRadius: '10px',
            display: 'flex', alignItems: 'center',
            justifyContent: 'center',
            fontSize: '15px', flexShrink: 0,
          }}>✨</div>
          <div>
            <p style={{
              fontSize: '10px', fontWeight: 700,
              color: '#7C3AED',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              marginBottom: '4px',
            }}>
              AI Performance Insight
            </p>
            <p style={{
              fontSize: '14px', color: '#1E293B',
              lineHeight: 1.65, margin: 0,
            }}>
              Your team is performing at{' '}
              <strong>Elite tier</strong> across 3 of 4 DORA metrics. Change Failure Rate at 1.2%
              is your strongest signal — top 5% globally. Lead time improved 18% this quarter.
              Consider addressing{' '}
              <strong>payment-processor</strong> which is dragging deployment frequency below team
              average.
            </p>
          </div>
        </div>
      )}

      {/* ── ELITE TIER BANNER (demo mode only) ── */}
      {isDemoActive && (
        <div style={{
          background: 'linear-gradient(135deg, #1a0533 0%, #2d1057 50%, #1a0533 100%)',
          borderRadius: '16px',
          padding: '24px 32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            <div style={{
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: '10px',
              padding: '10px 18px',
            }}>
              <p style={{
                fontSize: '10px', fontWeight: 700,
                color: 'rgba(255,255,255,0.5)',
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                margin: '0 0 3px',
              }}>
                Overall Tier
              </p>
              <p style={{
                fontSize: '1.5rem', fontWeight: 700,
                color: 'white', margin: 0,
                letterSpacing: '-0.02em',
              }}>
                Elite
              </p>
            </div>
            <div>
              <p style={{
                fontSize: '1rem', fontWeight: 600,
                color: 'white', margin: '0 0 4px',
              }}>
                Performing at Elite level
              </p>
              <p style={{
                fontSize: '13px',
                color: 'rgba(255,255,255,0.6)',
                margin: '0 0 10px',
              }}>
                Top 8% of engineering teams globally · 90-day rolling average
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{
                  fontSize: '11px',
                  color: 'rgba(255,255,255,0.4)',
                  whiteSpace: 'nowrap',
                }}>
                  Industry percentile
                </span>
                <div style={{
                  width: '120px', height: '4px',
                  background: 'rgba(255,255,255,0.15)',
                  borderRadius: '2px',
                }}>
                  <div style={{
                    width: '92%', height: '100%',
                    background: '#A78BFA',
                    borderRadius: '2px',
                  }} />
                </div>
                <span style={{
                  fontSize: '11px',
                  color: 'rgba(255,255,255,0.7)',
                  whiteSpace: 'nowrap',
                }}>
                  92nd
                </span>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '32px' }}>
            {[
              { val: '↑ 18%',  label: 'Lead time improvement' },
              { val: '847',    label: 'Deployments tracked'   },
              { val: '6 svcs', label: 'Active services'       },
            ].map(({ val, label }) => (
              <div key={label} style={{ textAlign: 'right' }}>
                <p style={{
                  fontSize: '1.2rem', fontWeight: 700,
                  color: 'white', margin: '0 0 3px',
                  letterSpacing: '-0.02em',
                }}>
                  {val}
                </p>
                <p style={{
                  fontSize: '11px',
                  color: 'rgba(255,255,255,0.5)',
                  margin: 0,
                }}>
                  {label}
                </p>
              </div>
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
              change: isDemoActive ? '+0.8' : null,
              changeGood: true,
            },
            {
              label: 'Lead Time for Changes',
              metric: metrics.leadTime,
              icon: Clock,
              formatVal: (v: number) => `${v.toFixed(1)} hrs`,
              change: isDemoActive ? '−0.6 hrs' : null,
              changeGood: true,
            },
            {
              label: 'Change Failure Rate',
              metric: metrics.changeFailureRate,
              icon: AlertTriangle,
              formatVal: (v: number) => `${v.toFixed(1)}%`,
              change: isDemoActive ? '−0.3%' : null,
              changeGood: true,
            },
            {
              label: 'Mean Time to Recovery',
              metric: metrics.mttr,
              icon: Timer,
              formatVal: (v: number) => `${Math.round(v)} min`,
              change: isDemoActive ? '−22 min' : null,
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
                  {metric.description && (
                    <div style={{
                      fontSize: '11px',
                      color: '#94A3B8',
                      marginTop: '10px',
                      paddingTop: '10px',
                      borderTop: '1px solid #F1F5F9',
                    }}>
                      {metric.description}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ── BENCHMARK TABLE ── */}
      {metrics && (
        <Card>
          <CardHeader>
            <div style={{
              fontSize: '0.68rem', fontWeight: 700,
              color: '#475569', textTransform: 'uppercase',
              letterSpacing: '0.1em', marginBottom: '4px',
            }}>
              Industry Benchmarks
            </div>
            <CardTitle style={{ fontSize: '15px' }}>
              Where you stand vs. industry
            </CardTitle>
            <CardDescription>
              Based on the 2024 DORA State of DevOps Report · 33,000+ professionals globally
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tier</TableHead>
                  <TableHead>Deploy Frequency</TableHead>
                  <TableHead>Lead Time</TableHead>
                  <TableHead>Change Failure Rate</TableHead>
                  <TableHead>MTTR</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[
                  {
                    tier: 'Elite',
                    color: '#059669', bg: '#ECFDF5',
                    df: '>1/day', lt: '<1 hour',
                    cfr: '<5%', mttr: '<1 hour',
                    current: metrics.deploymentFrequency.benchmark === 'elite' && (isDemoActive || totalDeployments > 0),
                    demoDF: '4.2/day', demoLT: '1.8 hrs',
                    demoCFR: '1.2%', demoMTTR: '14 min',
                  },
                  {
                    tier: 'High',
                    color: '#2563EB', bg: '#EFF6FF',
                    df: '>1/week', lt: '<1 week',
                    cfr: '<10%', mttr: '<1 day',
                    current: metrics.deploymentFrequency.benchmark === 'high' && (isDemoActive || totalDeployments > 0),
                    demoDF: '', demoLT: '', demoCFR: '', demoMTTR: '',
                  },
                  {
                    tier: 'Medium',
                    color: '#D97706', bg: '#FFFBEB',
                    df: '>1/month', lt: '<1 month',
                    cfr: '<15%', mttr: '<1 week',
                    current: metrics.deploymentFrequency.benchmark === 'medium' && (isDemoActive || totalDeployments > 0),
                    demoDF: '', demoLT: '', demoCFR: '', demoMTTR: '',
                  },
                  {
                    tier: 'Low',
                    color: '#DC2626', bg: '#FEF2F2',
                    df: '<1/month', lt: '>1 month',
                    cfr: '>15%', mttr: '>1 week',
                    current: metrics.deploymentFrequency.benchmark === 'low' && (isDemoActive || totalDeployments > 0),
                    demoDF: '', demoLT: '', demoCFR: '', demoMTTR: '',
                  },
                ].map((row) => (
                  <TableRow
                    key={row.tier}
                    style={{
                      background: row.current ? '#F5F3FF' : undefined,
                      fontWeight: row.current ? 600 : undefined,
                    }}
                  >
                    <TableCell>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {row.current && (
                          <span style={{
                            width: '6px', height: '6px',
                            borderRadius: '50%',
                            background: '#7C3AED',
                            display: 'inline-block',
                            flexShrink: 0,
                          }} />
                        )}
                        <span style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: '99px',
                          background: row.bg,
                          color: row.color,
                        }}>
                          {row.tier}{row.current ? ' ← You' : ''}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell style={{ color: row.current ? row.color : undefined }}>
                      {row.current && isDemoActive && row.demoDF ? row.demoDF : row.df}
                    </TableCell>
                    <TableCell style={{ color: row.current ? row.color : undefined }}>
                      {row.current && isDemoActive && row.demoLT ? row.demoLT : row.lt}
                    </TableCell>
                    <TableCell style={{ color: row.current ? row.color : undefined }}>
                      {row.current && isDemoActive && row.demoCFR ? row.demoCFR : row.cfr}
                    </TableCell>
                    <TableCell style={{ color: row.current ? row.color : undefined }}>
                      {row.current && isDemoActive && row.demoMTTR ? row.demoMTTR : row.mttr}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
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
                        ⚠ Needs attention
                      </span>
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
              color: '#7C3AED', textTransform: 'uppercase',
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
