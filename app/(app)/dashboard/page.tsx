'use client'

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { TrendingUp, TrendingDown, Users, Layers, Rocket, DollarSign, AlertCircle, Server, Shield, Activity, Database, Plus, Zap, Building2, Wifi, WifiOff, Minus, X, ChevronRight, GitBranch, MoreHorizontal, ArrowRight, CheckCircle, Sparkles } from 'lucide-react'
import { OnboardingProgress } from '@/components/onboarding/progress-indicator'

import { useDemoMode } from '@/components/demo/demo-mode-toggle'
import { useSalesDemo } from '@/lib/demo/sales-demo-data'
import { LastSynced } from '@/components/ui/last-synced'
import { SyncStatusBanner } from '@/components/ui/sync-status-banner'
import { DEMO_LAST_SYNCED, DEMO_SYNC_STATUS } from '@/lib/demo/demo-timestamps'
import { ROIHero } from '@/components/dashboard/roi-hero'
import { EngineeringVelocity } from '@/components/dashboard/engineering-velocity'
import { CostOptimizationWins } from '@/components/dashboard/cost-optimization-wins'
import { TimeSaved } from '@/components/dashboard/time-saved'
import { SecurityPosture } from '@/components/dashboard/security-posture'
import { BeforeAfterTransformation } from '@/components/dashboard/before-after-transformation'
import { CompetitiveBenchmarking } from '@/components/dashboard/competitive-benchmarking'

import { HeroMetricCard } from '@/components/dashboard/hero-metric-card'
import { CostTrendChart } from '@/components/dashboard/cost-trend-chart'
import { CostBreakdownBarList } from '@/components/dashboard/cost-breakdown-barlist'
import { RiskScoreTrendChart } from '@/components/dashboard/risk-score-trend-chart'
import { useRiskScoreTrend } from '@/lib/hooks/useRiskScore'
import type { DateRange } from '@/lib/services/risk-score.service'
import { QuickInsights, generateDemoInsights } from '@/components/dashboard/quick-insights'
import { ActivityFeed, generateDemoActivities } from '@/components/dashboard/activity-feed'
import { ServiceHealthGrid, generateDemoServices } from '@/components/dashboard/service-health-grid'
import { DORAMetricsMini } from '@/components/dashboard/dora-metrics-mini'
import { ResourceDistributionChart } from '@/components/dashboard/resource-distribution-chart'
import { CostOptimizationCard, generateDemoCostOpportunities } from '@/components/dashboard/cost-optimization-card'
import { QuickActions } from '@/components/dashboard/quick-actions'
import { AIInsightCard } from '@/components/ai/AIInsightCard'
import { useAIInsights } from '@/lib/hooks/useAIInsights'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { platformStatsService } from '@/lib/services/platform-stats.service'
import { deploymentsService } from '@/lib/services/deployments.service'
import type { PlatformDashboardStats, Deployment, DeploymentStatus } from '@/lib/types'
import { useWebSocket } from '@/lib/hooks/useWebSocket'
import { toast } from 'sonner'
import { subDays, format, formatDistanceToNow } from 'date-fns'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/contexts/auth-context'

import { DemoModeBanner } from '@/components/demo/DemoModeBanner'
import { demoModeService } from '@/lib/services/demo-mode.service'
import { DEMO_STATS } from '@/lib/demo-data/demo-generator'

// Demo stats for dashboard metrics
const DEMO_DASHBOARD_STATS = {
  monthlyAwsCost: DEMO_STATS.totalMonthlyCost,
  costChange: DEMO_STATS.costChange,
  totalServices: 8,
  activeDeployments: 6,
  healthyServices: 7,
  criticalAlerts: 1,
  warningAlerts: 2,
}

// Demo deployments for the Recent Deployments table
const DEMO_DEPLOYMENTS: Deployment[] = [
  {
    id: 'demo-deploy-1',
    serviceId: 'svc-api-gateway',
    serviceName: 'api-gateway',
    environment: 'production',
    awsRegion: 'us-east-1',
    status: 'running' as DeploymentStatus,
    costEstimate: 245.50,
    deployedBy: 'sarah.chen@company.com',
    deployedAt: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    createdAt: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
  },
  {
    id: 'demo-deploy-2',
    serviceId: 'svc-auth-service',
    serviceName: 'auth-service',
    environment: 'production',
    awsRegion: 'us-east-1',
    status: 'running' as DeploymentStatus,
    costEstimate: 178.00,
    deployedBy: 'mike.johnson@company.com',
    deployedAt: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
    createdAt: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
  },
  {
    id: 'demo-deploy-3',
    serviceId: 'svc-payment-processor',
    serviceName: 'payment-processor',
    environment: 'staging',
    awsRegion: 'us-west-2',
    status: 'deploying' as DeploymentStatus,
    costEstimate: 89.50,
    deployedBy: 'alex.wong@company.com',
    deployedAt: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
    createdAt: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
  },
  {
    id: 'demo-deploy-4',
    serviceId: 'svc-notification-service',
    serviceName: 'notification-service',
    environment: 'production',
    awsRegion: 'eu-west-1',
    status: 'running' as DeploymentStatus,
    costEstimate: 156.30,
    deployedBy: 'emma.davis@company.com',
    deployedAt: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(),
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(),
  },
  {
    id: 'demo-deploy-5',
    serviceId: 'svc-analytics-worker',
    serviceName: 'analytics-worker',
    environment: 'production',
    awsRegion: 'us-east-1',
    status: 'running' as DeploymentStatus,
    costEstimate: 312.80,
    deployedBy: 'david.kim@company.com',
    deployedAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
  },
]

// Helper function to generate demo cost trend data
function generateCostTrendData(days: number) {
  const data = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = subDays(new Date(), i);
    const compute = Math.random() * 300 + 200;
    const storage = Math.random() * 150 + 100;
    const database = Math.random() * 200 + 150;
    const network = Math.random() * 80 + 50;
    const other = Math.random() * 70 + 30;

    data.push({
      date: format(date, 'yyyy-MM-dd'),
      compute,
      storage,
      database,
      network,
      other,
      total: compute + storage + database + network + other,
      forecast: i < -7,
    });
  }
  return data;
}

// Helper function to generate cost breakdown data for BarList
function generateCostBreakdownData() {
  return [
    { name: 'Compute (EC2, Lambda, ECS)', value: 5200, change: 12, color: 'blue' as const },
    { name: 'Storage (S3, EBS)', value: 3800, change: -5, color: 'teal' as const },
    { name: 'Database (RDS, DynamoDB)', value: 2400, change: 8, color: 'purple' as const },
    { name: 'Network (Data Transfer)', value: 1200, change: 3, color: 'amber' as const },
    { name: 'Other Services', value: 247, change: -2, color: 'gray' as const },
  ];
}

function getDeploymentStatusColor(status: DeploymentStatus): string {
  switch (status) {
    case 'running': return '#059669'
    case 'failed': return '#DC2626'
    case 'deploying': return '#D97706'
    default: return '#94A3B8'
  }
}

// Shared card style
const card: React.CSSProperties = {
  background: '#FFFFFF',
  borderRadius: '16px',
  padding: '32px',
  border: '1px solid #F1F5F9',
}

export default function DashboardPage() {
  const { user, isLoading: authLoading } = useAuth();
  const { socket, isConnected } = useWebSocket();
  const queryClient = useQueryClient();
  const demoMode = useDemoMode();
  const salesDemoMode = useSalesDemo((state) => state.enabled);
  const router = useRouter();

  const handleExitDemoMode = () => {
    localStorage.setItem('devcontrol_demo_mode', 'false');
    window.dispatchEvent(new CustomEvent('demo-mode-changed', { detail: { enabled: false } }));
  };

  const [dismissedInsights, setDismissedInsights] = useState<string[]>([]);
  const [costDateRange, setCostDateRange] = useState<'7d' | '30d' | '90d' | '6mo' | '1yr'>('90d');
  const [riskScoreDateRange, setRiskScoreDateRange] = useState<DateRange>('30d');
  const [lastSynced, setLastSynced] = useState<Date>(demoMode ? DEMO_LAST_SYNCED : new Date());
  const [syncStatus, setSyncStatus] = useState<'syncing' | 'synced' | 'error'>(DEMO_SYNC_STATUS);
  const [insightDismissed, setInsightDismissed] = useState(false);

  // Fetch risk score trend data
  const { data: riskScoreData, isLoading: riskScoreLoading } = useRiskScoreTrend(riskScoreDateRange);

  // Fetch platform dashboard stats
  const { data: stats, isLoading: statsLoading, error: statsError, refetch: refetchStats } = useQuery<PlatformDashboardStats>({
    queryKey: ['platform-dashboard-stats'],
    queryFn: platformStatsService.getDashboardStats,
  });

  // Fetch AI insights based on cost data (after stats are defined)
  const costAnalysisData = stats ? {
    previousCost: stats.monthlyAwsCost * 0.95,
    currentCost: stats.monthlyAwsCost,
    percentageIncrease: stats.costChange ?? 0,
    topSpenders: generateCostBreakdownData().slice(0, 3).map(item => ({
      service: item.name,
      cost: item.value,
      change: item.change
    })),
    timeRange: 'last 30 days'
  } : null;

  const { data: aiInsight, isLoading: aiInsightLoading } = useAIInsights(
    costAnalysisData,
    {
      enabled: !demoMode && !!stats,
      onSuccess: (data) => {
        console.log('[Dashboard] AI Insights loaded:', data.cached ? 'from cache' : 'fresh');
      },
      onError: (error) => {
        console.error('[Dashboard] AI Insights error:', error);
      }
    }
  );

  // Fetch recent deployments
  const { data: deployments = [], isLoading: deploymentsLoading, error: deploymentsError, refetch: refetchDeployments } = useQuery<Deployment[]>({
    queryKey: ['recent-deployments'],
    queryFn: async () => {
      const allDeployments = await deploymentsService.getAll();
      return allDeployments.slice(0, 5);
    },
  });

  // WebSocket event listeners for real-time updates
  useEffect(() => {
    if (!socket) return;

    console.log('📡 Dashboard: Setting up WebSocket listeners...');

    socket.on('metrics:costs', (data) => {
      console.log('💰 Costs updated:', data);
      toast.info('AWS costs updated', {
        description: `New total: $${data.totalCost.toFixed(2)}`,
      });
      queryClient.invalidateQueries({ queryKey: ['platform-dashboard-stats'] });
    });

    socket.on('alert:created', (data) => {
      console.log('🚨 New alert:', data);
      toast.error(`New ${data.severity} Alert`, {
        description: data.message,
      });
      queryClient.invalidateQueries({ queryKey: ['platform-dashboard-stats'] });
    });

    socket.on('deployment:started', (data) => {
      console.log('🚀 Deployment started:', data);
      toast.info(`Deployment started: ${data.serviceName}`, {
        description: `Environment: ${data.environment} | By: ${data.deployedBy}`,
      });
      queryClient.invalidateQueries({ queryKey: ['platform-dashboard-stats'] });
      queryClient.invalidateQueries({ queryKey: ['recent-deployments'] });
    });

    socket.on('deployment:completed', (data) => {
      console.log('✅ Deployment completed:', data);
      const isSuccess = data.status === 'success';
      toast[isSuccess ? 'success' : 'error'](
        `Deployment ${isSuccess ? 'succeeded' : 'failed'}: ${data.serviceName}`,
        {
          description: isSuccess
            ? `Duration: ${data.duration}`
            : 'Check logs for details',
        }
      );
      queryClient.invalidateQueries({ queryKey: ['platform-dashboard-stats'] });
      queryClient.invalidateQueries({ queryKey: ['recent-deployments'] });
    });

    socket.on('service:health', (data) => {
      console.log('💊 Service health changed:', data);
      if (data.status !== 'healthy') {
        toast.warning(`Service ${data.serviceName} is ${data.status}`, {
          description: `Health score: ${data.healthScore}%`,
        });
      }
      queryClient.invalidateQueries({ queryKey: ['platform-dashboard-stats'] });
    });

    return () => {
      console.log('🧹 Dashboard: Cleaning up WebSocket listeners...');
      socket.off('metrics:costs');
      socket.off('alert:created');
      socket.off('deployment:started');
      socket.off('deployment:completed');
      socket.off('service:health');
    };
  }, [socket, queryClient]);

  const handleRefreshDashboard = async () => {
    setSyncStatus('syncing');
    try {
      await Promise.all([refetchStats(), refetchDeployments()]);
      setLastSynced(new Date());
      setSyncStatus('synced');
    } catch (error) {
      setSyncStatus('error');
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount)
  }

  const activeDeployments = demoMode ? DEMO_DEPLOYMENTS : deployments;
  const insightMessage = demoMode
    ? 'Lambda function costs increased 23% due to higher invocation count — enable reserved concurrency and consider Graviton2 for up to $540/year savings.'
    : (aiInsight?.rootCause || aiInsight?.recommendation || null);

  // Derived display values
  const currentSpend = demoMode ? DEMO_DASHBOARD_STATS.monthlyAwsCost : (stats?.monthlyAwsCost ?? 0);
  const costChange = demoMode ? DEMO_DASHBOARD_STATS.costChange : (stats?.costChange ?? 0);
  const securityScore = riskScoreData?.current.score ?? (demoMode ? 87 : null);
  const wasteAmount = 1922; // AI-identified; would come from optimization service
  const efficiencyRatio = currentSpend > 0
    ? Math.round(((currentSpend - wasteAmount) / currentSpend) * 100)
    : null;

  // FIX 6 — Semantic delta color helpers
  // Cost: increase = bad (red), decrease = good (emerald), zero = neutral (amber)
  const costDeltaColor = costChange > 0 ? '#DC2626' : costChange < 0 ? '#059669' : '#D97706';
  const CostDeltaIcon = costChange > 0 ? TrendingUp : costChange < 0 ? TrendingDown : Minus;

  // Security: >= 80 = good (emerald), < 80 = needs attention (red)
  const securityDeltaColor = securityScore !== null && securityScore >= 80 ? '#059669' : '#DC2626';
  const SecurityDeltaIcon = securityScore !== null && securityScore >= 80 ? TrendingUp : TrendingDown;

  // Efficiency: >= 90% = good (emerald), >= 75% = neutral (amber), < 75% = bad (red)
  const efficiencyDeltaColor = efficiencyRatio !== null
    ? efficiencyRatio >= 90 ? '#059669' : efficiencyRatio >= 75 ? '#D97706' : '#DC2626'
    : '#D97706';
  const EfficiencyDeltaIcon = efficiencyRatio !== null
    ? efficiencyRatio >= 90 ? TrendingUp : efficiencyRatio >= 75 ? Minus : TrendingDown
    : Minus;

  const doraRows: { label: string; value: string; tier: 'Elite' | 'High' }[] = [
    { label: 'Deployment Frequency', value: `${demoMode ? 12 : (stats?.activeDeployments ?? 12)}/week`, tier: 'Elite' },
    { label: 'Lead Time for Changes', value: '2.4 hours', tier: 'Elite' },
    { label: 'Change Failure Rate', value: '8.3%', tier: 'High' },
    { label: 'Mean Time to Recovery', value: '36 min', tier: 'Elite' },
  ];

  const securityRows: { label: string; value: string | number; status: 'good' | 'warn' }[] = [
    { label: 'Critical Vulnerabilities', value: demoMode ? 0 : 0, status: 'good' },
    { label: 'Compliance Frameworks', value: '4/4', status: 'good' },
    { label: 'Active Anomalies', value: demoMode ? 3 : (statsLoading ? '—' : 3), status: 'warn' },
  ];

  return (
    // FIX 2 — maxWidth: 1400px per spec, padding fills edge-to-edge within shell
    // FIX 8 — paddingBottom: 64px for breathing room
    <div style={{
      padding: '40px 56px 64px',
      maxWidth: '1400px',
      margin: '0 auto',
      minHeight: '100vh',
      background: '#F9FAFB',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>

      {/* ── LAYER 1: COMMAND HEADER ── */}
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        marginBottom: '40px',
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px' }}>
            <h1 style={{
              fontSize: '1.75rem',
              fontWeight: 700,
              color: '#0F172A',
              margin: 0,
              letterSpacing: '-0.02em',
            }}>
              AI-powered AWS infrastructure command center
            </h1>
            {(demoMode || salesDemoMode) && (
              <span style={{
                fontSize: '0.7rem',
                fontWeight: 600,
                background: '#FFFBEB',
                color: '#D97706',
                border: '1px solid #FDE68A',
                padding: '3px 12px',
                borderRadius: '100px',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}>
                Demo Mode
              </span>
            )}
          </div>
          <p style={{
            fontSize: '0.875rem',
            color: '#64748B',
            margin: 0,
            lineHeight: 1.6,
          }}>
            WayUP Technology · 3 AWS accounts · Last synced {formatDistanceToNow(lastSynced, { addSuffix: true })}
          </p>
        </div>
        <a href="/cost-optimization" style={{
          background: '#7C3AED',
          color: '#fff',
          padding: '10px 24px',
          borderRadius: '8px',
          fontSize: '0.875rem',
          fontWeight: 600,
          textDecoration: 'none',
          letterSpacing: '-0.01em',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
        }}>
          Approve Savings <ArrowRight size={14} />
        </a>
      </div>

      {/* ── NORTH STAR METRICS — 3 col ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '24px',
        marginBottom: '32px',
      }}>

        {/* Total Cloud Spend — FIX 6: semantic delta color */}
        <div style={card}>
          <p style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 16px' }}>
            Total Cloud Spend
          </p>
          <div style={{ fontSize: '2.5rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '12px' }}>
            {statsLoading && !demoMode ? '—' : `$${currentSpend.toLocaleString()}`}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <CostDeltaIcon size={14} style={{ color: costDeltaColor }} />
            <span style={{ fontSize: '0.8rem', color: costDeltaColor, fontWeight: 600, lineHeight: 1.6 }}>
              {costChange > 0 ? '+' : ''}{Math.abs(costChange)}%
            </span>
            <span style={{ fontSize: '0.8rem', color: '#64748B', lineHeight: 1.6 }}>vs last month</span>
          </div>
        </div>

        {/* Security Posture — FIX 6: semantic delta color */}
        <div style={card}>
          <p style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 16px' }}>
            Security Posture
          </p>
          <div style={{ fontSize: '2.5rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '12px' }}>
            {securityScore ?? '—'}
            <span style={{ fontSize: '1.25rem', color: '#64748B', fontWeight: 400 }}>/100</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <SecurityDeltaIcon size={14} style={{ color: securityDeltaColor }} />
            <span style={{ fontSize: '0.8rem', color: securityDeltaColor, fontWeight: 600, lineHeight: 1.6 }}>
              {securityScore !== null && securityScore >= 80 ? 'Stable · Above benchmark' : 'Needs attention'}
            </span>
          </div>
        </div>

        {/* Efficiency Ratio — FIX 6: semantic delta color */}
        <div style={card}>
          <p style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 16px' }}>
            Infrastructure Efficiency
          </p>
          <div style={{ fontSize: '2.5rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '12px' }}>
            {efficiencyRatio !== null ? `${efficiencyRatio}%` : '—'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <EfficiencyDeltaIcon size={14} style={{ color: efficiencyDeltaColor }} />
            <span style={{ fontSize: '0.8rem', color: efficiencyDeltaColor, fontWeight: 600, lineHeight: 1.6 }}>
              ${wasteAmount.toLocaleString()} identified waste
            </span>
          </div>
        </div>
      </div>

      {/* ── LAYER 2: EXECUTIVE INSIGHTS ── */}
      {!insightDismissed && (demoMode || insightMessage) && (
        <div style={{ ...card, marginBottom: '32px', position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              background: '#7C3AED',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <Sparkles size={16} style={{ color: '#fff' }} />
            </div>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: '0.75rem', fontWeight: 600, color: '#7C3AED', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 8px' }}>
                Executive Insights
              </p>
              <p style={{ fontSize: '0.975rem', color: '#0F172A', lineHeight: 1.7, margin: 0, fontWeight: 400 }}>
                {insightMessage
                  ? insightMessage
                  : `Your infrastructure efficiency is up 12% this month. We identified $${wasteAmount.toLocaleString()} in immediate savings with zero risk. Security posture is stable${securityScore ? ` at ${securityScore}%` : ''}, and engineering velocity remains Elite across all DORA metrics.`
                }
              </p>
            </div>
            <button
              onClick={() => setInsightDismissed(true)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: '4px', flexShrink: 0, lineHeight: 1 }}
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* ── NARRATIVE — FIX 5: 3fr/2fr Spend Trend + Security Posture ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: '24px', marginBottom: '32px' }}>

        {/* Spend Trend — FIX 3: desaturation handled inside CostBreakdownBarList on bars only */}
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '24px' }}>
            <div>
              <p style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 4px' }}>
                Spend Trend
              </p>
              <p style={{ fontSize: '0.875rem', color: '#0F172A', margin: 0, lineHeight: 1.6 }}>
                Infrastructure cost over time
              </p>
            </div>
            <a href="/costs" style={{ color: '#94A3B8', display: 'flex', lineHeight: 1 }}>
              <MoreHorizontal size={16} />
            </a>
          </div>
          <CostBreakdownBarList
            data={generateCostBreakdownData()}
            totalCost={demoMode ? DEMO_DASHBOARD_STATS.monthlyAwsCost : generateCostBreakdownData().reduce((sum, item) => sum + item.value, 0)}
            isLoading={!demoMode && statsLoading}
            dateRange={costDateRange}
            onDateRangeChange={setCostDateRange}
            onExport={() => { toast.success('Exporting cost data...'); }}
          />
        </div>

        {/* Security Posture Detail */}
        <div style={card}>
          <p style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 24px' }}>
            Security Posture
          </p>

          {/* Large score */}
          <div style={{ textAlign: 'center', padding: '20px 0', borderBottom: '1px solid #F1F5F9', marginBottom: '20px' }}>
            <div style={{ fontSize: '4rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.03em', lineHeight: 1 }}>
              {securityScore ?? '87'}
            </div>
            <div style={{ fontSize: '0.875rem', color: securityDeltaColor, fontWeight: 600, marginTop: '8px' }}>
              {riskScoreData?.current.grade ? `Grade ${riskScoreData.current.grade} · ` : ''}
              {securityScore !== null && securityScore >= 80 ? 'Stable · Elite Tier' : 'Below threshold'}
            </div>
          </div>

          {/* Risk detail rows */}
          {securityRows.map(({ label, value, status }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #F1F5F9' }}>
              <span style={{ fontSize: '0.82rem', color: '#64748B', lineHeight: 1.6 }}>{label}</span>
              <span style={{ fontSize: '0.82rem', fontWeight: 600, color: status === 'good' ? '#059669' : '#D97706' }}>
                {value}
              </span>
            </div>
          ))}

          <a href="/security" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', marginTop: '20px', fontSize: '0.82rem', fontWeight: 600, color: '#7C3AED', textDecoration: 'none' }}>
            View Security Report <ArrowRight size={13} />
          </a>
        </div>
      </div>

      {/* ── LAYER 3: DECISION CARD ── */}
      <div style={{ ...card, marginBottom: '32px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '32px', alignItems: 'center' }}>
          <div>
            <p style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 8px' }}>
              Savings Opportunity
            </p>
            <p style={{ fontSize: '1.1rem', fontWeight: 600, color: '#0F172A', lineHeight: 1.6, margin: '0 0 4px' }}>
              We've identified{' '}
              <span style={{ color: '#059669', fontWeight: 700 }}>
                ${wasteAmount.toLocaleString()}/month
              </span>{' '}
              in immediate savings.
            </p>
            <p style={{ fontSize: '0.875rem', color: '#64748B', margin: 0, lineHeight: 1.6 }}>
              Impact: High · Risk: Zero · Estimated implementation: 15 minutes
            </p>
          </div>
          <div style={{ display: 'flex', gap: '12px', flexShrink: 0 }}>
            <a href="/cost-optimization" style={{
              background: '#7C3AED',
              color: '#fff',
              padding: '12px 28px',
              borderRadius: '8px',
              fontSize: '0.875rem',
              fontWeight: 600,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}>
              Approve All Changes
            </a>
            <a href="/cost-optimization" style={{
              background: 'transparent',
              color: '#64748B',
              padding: '12px 20px',
              borderRadius: '8px',
              fontSize: '0.875rem',
              fontWeight: 500,
              textDecoration: 'none',
              border: '1px solid #E2E8F0',
              whiteSpace: 'nowrap',
            }}>
              Review First
            </a>
          </div>
        </div>
      </div>

      {/* ── ENGINEERING VELOCITY + RECENT ACTIVITY ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>

        {/* Engineering Velocity — DORA row list */}
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '24px' }}>
            <div>
              <p style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px' }}>
                Engineering Velocity
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.02em' }}>Elite</span>
                <span style={{ fontSize: '0.75rem', fontWeight: 600, background: '#ECFDF5', color: '#059669', padding: '2px 10px', borderRadius: '100px' }}>
                  Top 10%
                </span>
              </div>
            </div>
            <a href="/app/dora-metrics" style={{ fontSize: '0.78rem', fontWeight: 600, color: '#7C3AED', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}>
              Full report <ArrowRight size={12} />
            </a>
          </div>

          {doraRows.map(({ label, value, tier }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid #F8FAFC' }}>
              <span style={{ fontSize: '0.82rem', color: '#64748B', lineHeight: 1.6 }}>{label}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A' }}>{value}</span>
                <span style={{
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  color: tier === 'Elite' ? '#059669' : '#D97706',
                  background: tier === 'Elite' ? '#ECFDF5' : '#FFFBEB',
                  padding: '2px 8px',
                  borderRadius: '100px',
                }}>
                  {tier}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Recent Activity */}
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
            <p style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
              Recent Activity
            </p>
            <a href="/deployments" style={{ fontSize: '0.78rem', fontWeight: 600, color: '#7C3AED', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}>
              View all <ArrowRight size={12} />
            </a>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {activeDeployments.slice(0, 5).map((d: Deployment) => (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid #F8FAFC' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    flexShrink: 0,
                    background: getDeploymentStatusColor(d.status),
                  }} />
                  <div>
                    <div style={{ fontSize: '0.82rem', fontWeight: 500, color: '#0F172A', lineHeight: 1.4 }}>
                      {d.serviceName || d.serviceId.slice(0, 8)}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#94A3B8', lineHeight: 1.6 }}>{d.environment}</div>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: getDeploymentStatusColor(d.status), textTransform: 'capitalize' }}>
                    {d.status}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: '#94A3B8' }}>
                    {formatDistanceToNow(new Date(d.deployedAt), { addSuffix: true })}
                  </div>
                </div>
              </div>
            ))}
            {activeDeployments.length === 0 && (
              <div style={{ textAlign: 'center', padding: '32px 0', color: '#94A3B8', fontSize: '0.875rem', lineHeight: 1.6 }}>
                No recent deployments ·{' '}
                <a href="/deployments/new" style={{ color: '#7C3AED', fontWeight: 600, textDecoration: 'none' }}>
                  Create one
                </a>
              </div>
            )}
          </div>
        </div>
      </div>

    </div>
  )
}
