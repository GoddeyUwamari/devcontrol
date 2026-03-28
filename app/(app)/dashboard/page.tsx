'use client'

import { useEffect, useRef, useState } from 'react'
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
import { monitoringService } from '@/lib/services/monitoring.service'
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
  monthlyAwsCost: 12847,
  costChange: 8,
  criticalAlerts: 2,
  activeDeployments: 5,
  securityScore: 87,
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
    costEstimate: 423.50,
    deployedBy: 'sarah.chen@company.com',
    deployedAt: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
    createdAt: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
  },
  {
    id: 'demo-deploy-2',
    serviceId: 'svc-payment-processor',
    serviceName: 'payment-processor',
    environment: 'production',
    awsRegion: 'us-east-1',
    status: 'deploying' as DeploymentStatus,
    costEstimate: 891.20,
    deployedBy: 'james.wilson@company.com',
    deployedAt: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    createdAt: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
  },
  {
    id: 'demo-deploy-3',
    serviceId: 'svc-auth-service',
    serviceName: 'auth-service',
    environment: 'staging',
    awsRegion: 'us-west-2',
    status: 'running' as DeploymentStatus,
    costEstimate: 234.80,
    deployedBy: 'sarah.chen@company.com',
    deployedAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
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

const SERVICE_COLORS: Record<string, string> = {
  'Compute (EC2, Lambda, ECS)': '#3B82F6',  // vivid blue
  'Storage (S3, EBS)':          '#06B6D4',  // cyan
  'Database (RDS, DynamoDB)':   '#8B5CF6',  // violet
  'Network (Data Transfer)':    '#F59E0B',  // amber
  'Other Services':             '#94A3B8',  // slate
}

// Helper function to generate cost breakdown data for BarList
function generateCostBreakdownData() {
  return [
    { name: 'Compute (EC2, Lambda, ECS)', value: 5200, change: 12, color: SERVICE_COLORS['Compute (EC2, Lambda, ECS)'] },
    { name: 'Storage (S3, EBS)',           value: 3800, change: -5, color: SERVICE_COLORS['Storage (S3, EBS)'] },
    { name: 'Database (RDS, DynamoDB)',    value: 2400, change:  8, color: SERVICE_COLORS['Database (RDS, DynamoDB)'] },
    { name: 'Network (Data Transfer)',     value: 1200, change:  3, color: SERVICE_COLORS['Network (Data Transfer)'] },
    { name: 'Other Services',             value:  247, change: -2, color: SERVICE_COLORS['Other Services'] },
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

// Shared overline label style — strong, consistent across all sections
const overline: React.CSSProperties = {
  fontSize: '0.7rem',
  fontWeight: 700,
  color: '#475569',       // slate-600 — noticeably darker than before
  textTransform: 'uppercase' as const,
  letterSpacing: '0.1em',
  margin: '0 0 16px',
}

// Strong section title style
const sectionTitle: React.CSSProperties = {
  fontSize: '0.875rem',
  fontWeight: 600,
  color: '#1E293B',       // slate-800 — crisp, not faded
  margin: 0,
  lineHeight: 1.5,
}

// Body / supporting text — visible, not washed out
const bodyText: React.CSSProperties = {
  fontSize: '0.82rem',
  color: '#475569',       // slate-600
  lineHeight: 1.6,
}

export default function DashboardPage() {
  const { user, isLoading: authLoading } = useAuth();
  const { socket, isConnected } = useWebSocket();
  const queryClient = useQueryClient();
  const demoMode = useDemoMode();
  const { enabled: salesDemoMode } = useSalesDemo();
  const router = useRouter();

  const handleExitDemoMode = () => {
    localStorage.setItem('devcontrol_demo_mode', 'false');
    window.dispatchEvent(new CustomEvent('demo-mode-changed', { detail: { enabled: false } }));
  };

  // Debounce ref for WebSocket-driven query invalidations — skip if same event
  // type fired within the last 5 seconds to prevent rapid-fire re-renders.
  const lastWsUpdateRef = useRef<Record<string, number>>({});

  const [dismissedInsights, setDismissedInsights] = useState<string[]>([]);
  const [costDateRange, setCostDateRange] = useState<'7d' | '30d' | '90d' | '6mo' | '1yr'>('90d');
  const [riskScoreDateRange, setRiskScoreDateRange] = useState<DateRange>('30d');
  const [lastSynced, setLastSynced] = useState<Date>(demoMode ? DEMO_LAST_SYNCED : new Date());
  const [syncStatus, setSyncStatus] = useState<'syncing' | 'synced' | 'error'>(DEMO_SYNC_STATUS);
  const [insightDismissed, setInsightDismissed] = useState(false);

  // Fetch risk score trend data
  const { data: riskScoreData, isLoading: riskScoreLoading } = useRiskScoreTrend(riskScoreDateRange, !demoMode && !salesDemoMode);

  // Fetch platform dashboard stats
  const { data: stats, isLoading: statsLoading, error: statsError, refetch: refetchStats } = useQuery<PlatformDashboardStats>({
    queryKey: ['platform-dashboard-stats'],
    queryFn: platformStatsService.getDashboardStats,
    staleTime: 60_000,
    refetchInterval: 300_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: false,
    enabled: !demoMode && !salesDemoMode,
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
    staleTime: 60_000,
    refetchInterval: 300_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: false,
    enabled: !demoMode && !salesDemoMode,
  });

  const { data: systemHealth } = useQuery({
    queryKey: ['system-health'],
    queryFn: () => monitoringService.getSystemHealth(),
    staleTime: 60_000,
    refetchInterval: 300_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: false,
    enabled: !demoMode && !salesDemoMode,
  })

  // WebSocket event listeners for real-time updates
  useEffect(() => {
    if (!socket) return;

    console.log('📡 Dashboard: Setting up WebSocket listeners...');

    const WS_DEBOUNCE_MS = 5_000;
    const shouldUpdate = (key: string) => {
      const now = Date.now();
      if (now - (lastWsUpdateRef.current[key] ?? 0) < WS_DEBOUNCE_MS) return false;
      lastWsUpdateRef.current[key] = now;
      return true;
    };

    socket.on('metrics:costs', (data) => {
      console.log('💰 Costs updated:', data);
      if (!shouldUpdate('metrics:costs')) return;
      toast.info('AWS costs updated', {
        description: `New total: $${data.totalCost.toFixed(2)}`,
      });
      queryClient.invalidateQueries({ queryKey: ['platform-dashboard-stats'] });
    });

    socket.on('alert:created', (data) => {
      console.log('🚨 New alert:', data);
      if (!shouldUpdate('alert:created')) return;
      toast.error(`New ${data.severity} Alert`, {
        description: data.message,
      });
      queryClient.invalidateQueries({ queryKey: ['platform-dashboard-stats'] });
    });

    socket.on('deployment:started', (data) => {
      console.log('🚀 Deployment started:', data);
      if (!shouldUpdate('deployment:started')) return;
      toast.info(`Deployment started: ${data.serviceName}`, {
        description: `Environment: ${data.environment} | By: ${data.deployedBy}`,
      });
      queryClient.invalidateQueries({ queryKey: ['platform-dashboard-stats'] });
      queryClient.invalidateQueries({ queryKey: ['recent-deployments'] });
    });

    socket.on('deployment:completed', (data) => {
      console.log('✅ Deployment completed:', data);
      if (!shouldUpdate('deployment:completed')) return;
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
      if (!shouldUpdate('service:health')) return;
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
  const securityScore = demoMode ? 87 : (riskScoreData?.current.score ?? null);
  const wasteAmount = 1922; // AI-identified; would come from optimization service
  const efficiencyRatio = demoMode
    ? Math.round(((12847 - wasteAmount) / 12847) * 100)  // = 85
    : currentSpend > 0
      ? Math.round(((currentSpend - wasteAmount) / currentSpend) * 100)
      : null;

  const isDemoActive = demoMode || salesDemoMode;

  const isAwsConnected = isDemoActive || (
    !!stats && (
      stats.monthlyAwsCost > 0 ||
      stats.activeDeployments > 0 ||
      stats.totalServices > 0
    )
  );

  // FIX 6 — Semantic delta color helpers
  const costDeltaColor = costChange > 0 ? '#DC2626' : costChange < 0 ? '#059669' : '#D97706';
  const CostDeltaIcon = costChange > 0 ? TrendingUp : costChange < 0 ? TrendingDown : Minus;

  const securityDeltaColor = securityScore !== null && securityScore >= 80 ? '#059669' : isDemoActive ? '#059669' : securityScore !== null ? '#DC2626' : '#94A3B8';
  const SecurityDeltaIcon = securityScore !== null && securityScore >= 80 ? TrendingUp : isDemoActive ? TrendingUp : TrendingDown;

  const efficiencyDeltaColor = efficiencyRatio !== null
    ? efficiencyRatio >= 90 ? '#059669' : efficiencyRatio >= 75 ? '#D97706' : '#DC2626'
    : '#D97706';
  const EfficiencyDeltaIcon = efficiencyRatio !== null
    ? efficiencyRatio >= 90 ? TrendingUp : efficiencyRatio >= 75 ? Minus : TrendingDown
    : Minus;

  // Cloud Health Score derived values
  const costScore = isDemoActive ? 82 : (efficiencyRatio ?? 0);
  const securityScore_health = isDemoActive ? 87 : (securityScore ?? 0);
  const reliabilityScore = isDemoActive
    ? 91
    : systemHealth?.status === 'operational'
      ? 95
      : systemHealth?.status === 'degraded'
        ? 72
        : stats
          ? Math.min(100, 100 - 0)
          : 0
  // System status bar derived values
  const systemStatusLabel = isDemoActive
    ? 'healthy'
    : systemHealth?.status === 'operational'
      ? 'healthy'
      : systemHealth?.status === 'disrupted'
        ? 'down'
        : systemHealth?.status === 'degraded'
          ? 'degraded'
          : 'healthy'

  const systemResponseTime = isDemoActive ? '145ms' : '—'

  const systemAlertCount: number = isDemoActive ? 2 : 0

  const systemUptimeAvg = isDemoActive
    ? '99.4%'
    : (systemHealth?.healthPercentage != null ? `${systemHealth.healthPercentage}%` : '—')

  const systemStatusConfig = {
    healthy:  { color: '#059669', bg: '#F0FDF4', border: '#BBF7D0', dot: '#059669', label: 'All systems operational' },
    degraded: { color: '#D97706', bg: '#FFFBEB', border: '#FDE68A', dot: '#D97706', label: 'Degraded performance detected' },
    down:     { color: '#DC2626', bg: '#FEF2F2', border: '#FECACA', dot: '#DC2626', label: 'System outage detected' },
  }

  const statusConf = systemStatusConfig[systemStatusLabel as keyof typeof systemStatusConfig] || systemStatusConfig.healthy

  const cloudHealthScore = Math.round((costScore + securityScore_health + reliabilityScore) / 3) || null;
  const topRecs = [
    { label: 'Right-size 3 EC2 instances', savings: '$720/mo', effort: 'Low' },
    { label: 'Delete unattached EBS volumes', savings: '$210/mo', effort: 'Low' },
    { label: 'Enable S3 Intelligent-Tiering', savings: '$340/mo', effort: 'Medium' },
  ];
  const criticalAlerts = demoMode ? DEMO_DASHBOARD_STATS.criticalAlerts : 0;

  const doraRows: { label: string; value: string; tier: 'Elite' | 'High'; showTier?: boolean }[] = [
    { label: 'Deployment Frequency', value: demoMode ? '4.2/day' : (stats?.activeDeployments ? `${stats.activeDeployments}/week` : '—'), tier: 'Elite', showTier: demoMode || !!(stats?.activeDeployments) },
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
            <h1 style={{
              fontSize: '1.75rem',
              fontWeight: 700,
              color: '#0F172A',
              margin: 0,
              letterSpacing: '-0.02em',
            }}>
              Find AWS Waste, Security Risks, and Performance Bottlenecks — in Minutes
            </h1>
          </div>
          <p style={{
            fontSize: '0.875rem',
            color: '#475569',
            margin: 0,
            lineHeight: 1.6,
          }}>
            {isAwsConnected
              ? `WayUP Technology · Last synced ${formatDistanceToNow(lastSynced, { addSuffix: true })}`
              : 'Connect your AWS account to get started · Setup takes 2 minutes'}
          </p>
        </div>
        {isAwsConnected && (
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
        )}
      </div>

      {/* ── RISK ALERT BANNER ── */}
      {(demoMode || salesDemoMode || criticalAlerts > 0) && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '14px',
          background: '#FFF7ED',
          border: '1px solid #FED7AA',
          borderRadius: '12px',
          padding: '14px 20px',
          marginBottom: '28px',
        }}>
          <div style={{
            width: '32px',
            height: '32px',
            borderRadius: '8px',
            background: '#FEF3C7',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}>
            <AlertCircle size={16} style={{ color: '#D97706' }} />
          </div>
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#92400E' }}>
              {criticalAlerts} critical alert{criticalAlerts !== 1 ? 's' : ''} require your attention
            </span>
            <span style={{ fontSize: '0.82rem', color: '#B45309', marginLeft: '8px' }}>
              · Lambda invocation spike on payment-processor (+178%), CPU overload on production-worker
            </span>
          </div>
          <a href="/security" style={{
            fontSize: '0.78rem',
            fontWeight: 600,
            color: '#D97706',
            textDecoration: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            flexShrink: 0,
          }}>
            View alerts <ArrowRight size={12} />
          </a>
        </div>
      )}

      {statsLoading ? null : isAwsConnected ? (
        /* ── NORTH STAR METRICS — 4 col ── */
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '24px',
          marginBottom: '32px',
        }}>

          {/* Total Cloud Spend */}
          <div style={card}>
            <p style={overline}>Total Cloud Spend</p>
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

          {/* Security Posture */}
          <div style={card}>
            <p style={overline}>Security Posture</p>
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

          {/* Efficiency Ratio */}
          <div style={card}>
            <p style={overline}>Infrastructure Efficiency</p>
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

          {/* Cloud Health Score */}
          <div style={card}>
            <p style={overline}>Cloud Health Score</p>
            <div style={{ fontSize: '2.5rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '12px' }}>
              {cloudHealthScore || '—'}
              <span style={{ fontSize: '1.25rem', color: '#64748B', fontWeight: 400 }}>/100</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {[
                { label: 'Cost', score: costScore },
                { label: 'Security', score: securityScore_health },
                { label: 'Reliability', score: reliabilityScore },
              ].map(({ label, score }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{ flex: 1, height: '4px', background: '#F1F5F9', borderRadius: '2px' }}>
                    <div style={{
                      width: `${score ?? 0}%`,
                      height: '100%',
                      background: (score ?? 0) >= 80 ? '#059669' : (score ?? 0) >= 60 ? '#D97706' : '#DC2626',
                      borderRadius: '2px',
                    }} />
                  </div>
                  <span style={{ fontSize: '0.7rem', color: '#64748B', width: '60px', textAlign: 'right' }}>
                    {label} {score ?? '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        /* ── UNCONNECTED STATE ── */
        <div>

          {/* ── AI INSIGHT BANNER ── */}
          <div style={{
            border: '0.5px solid #E2E8F0',
            borderLeft: '2px solid #534AB7',
            borderRadius: '8px',
            padding: '12px 16px',
            marginBottom: '24px',
            display: 'flex',
            gap: '10px',
          }}>
            <div style={{ width: '28px', height: '28px', background: '#EEEDFE', borderRadius: '6px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ color: '#534AB7', fontSize: '14px' }}>✦</span>
            </div>
            <div>
              <p style={{ fontSize: '11px', fontWeight: 500, color: '#534AB7', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 3px' }}>
                Example insight you'll get in 2 minutes
              </p>
              <p style={{ fontSize: '13px', color: '#0F172A', lineHeight: 1.5, margin: 0 }}>
                "3 EC2 instances running at 12% CPU — right-sizing saves $720/month with zero downtime risk"
              </p>
              <p style={{ fontSize: '12px', color: '#475569', margin: '3px 0 0' }}>
                DevControl surfaces insights like this automatically, updated daily.
              </p>
            </div>
          </div>

          {/* ── CONNECT CARD ── */}
          <div style={{
            background: '#FFFFFF',
            borderRadius: '16px',
            border: '1px solid #E2E8F0',
            padding: '48px 40px',
            textAlign: 'center',
            marginBottom: '24px',
          }}>
            <div style={{
              width: '52px', height: '52px',
              background: '#F5F3FF', borderRadius: '14px',
              display: 'flex', alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 20px', fontSize: '24px',
            }}>☁️</div>
            <h2 style={{
              fontSize: '1.2rem', fontWeight: 700,
              color: '#0F172A', letterSpacing: '-0.02em',
              margin: '0 0 8px',
            }}>
              Connect your AWS account to uncover cost leaks and infrastructure risks
            </h2>
            <p style={{
              fontSize: '14px', color: '#475569',
              maxWidth: '460px', margin: '0 auto 28px',
              lineHeight: 1.65,
            }}>
              DevControl uses read-only access to analyze your AWS environment and surface savings, risks, and inefficiencies — no changes made to your infrastructure.
            </p>
            <a href="/connect-aws" style={{
              display: 'inline-flex', alignItems: 'center',
              gap: '8px', background: '#7C3AED', color: '#FFFFFF',
              padding: '12px 28px', borderRadius: '10px',
              fontSize: '14px', fontWeight: 600,
              textDecoration: 'none',
              boxShadow: '0 4px 14px rgba(124,58,237,0.3)',
            }}>
              Connect AWS Account (2 min setup) →
            </a>
            <p style={{
              fontSize: '12px', color: '#94A3B8', marginTop: '14px',
            }}>
              ✓ Read-only IAM role&nbsp;&nbsp;✓ No credentials stored&nbsp;&nbsp;✓ No changes to infrastructure&nbsp;&nbsp;✓ Cancel anytime
            </p>
          </div>

          {/* ── SOCIAL PROOF ── */}
          <div style={{
            background: '#F8FAFC',
            borderRadius: '8px',
            padding: '12px 16px',
            textAlign: 'center',
            fontSize: '12px',
            color: '#475569',
            margin: '0 0 24px',
          }}>
            Teams typically find{' '}
            <strong style={{ color: '#0F172A', fontWeight: 500 }}>20–40% savings</strong>
            {' '}in unused or overprovisioned AWS resources on their first scan.
          </div>

          {/* ── WHAT YOU'LL UNLOCK LABEL ── */}
          <div style={{
            fontSize: '11px', fontWeight: 600,
            color: '#475569', letterSpacing: '0.06em',
            textTransform: 'uppercase', marginBottom: '12px',
          }}>
            What you'll unlock
          </div>

          {/* ── PREVIEW KPI GRID ── */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '20px', marginBottom: '24px',
          }}>
            {[
              { label: 'Total Cloud Spend',         value: '$12,480/mo', delta: '↑ +8% vs last month' },
              { label: 'Potential Savings',          value: '$3,200/mo',  delta: '↓ Identified waste' },
              { label: 'Security Posture',           value: '74 / 100',   delta: '↑ Stable · Above benchmark' },
              { label: 'Resources Underutilized',    value: '42%',        delta: '— Right-size to save' },
            ].map(({ label, value, delta }) => (
              <a
                key={label}
                href="/connect-aws"
                style={{ textDecoration: 'none' }}
              >
                <div style={{
                  background: '#FFFFFF',
                  borderRadius: '16px',
                  border: '1px solid #F1F5F9',
                  padding: '24px',
                  position: 'relative',
                  overflow: 'hidden',
                  cursor: 'pointer',
                  transition: 'border-color 0.15s, box-shadow 0.15s',
                }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = '#DDD6FE';
                    e.currentTarget.style.boxShadow = '0 4px 16px rgba(124,58,237,0.08)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = '#F1F5F9';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  {/* Gradient overlay — fades bottom to white */}
                  <div style={{
                    position: 'absolute', inset: 0,
                    background: 'linear-gradient(to bottom, transparent 35%, rgba(255,255,255,0.97) 75%)',
                    pointerEvents: 'none', zIndex: 1,
                  }} />

                  <p style={{
                    fontSize: '0.68rem', fontWeight: 700,
                    color: '#475569', textTransform: 'uppercase',
                    letterSpacing: '0.1em', margin: '0 0 14px',
                  }}>{label}</p>

                  {/* Blurred value */}
                  <div style={{
                    fontSize: '2.2rem', fontWeight: 700,
                    color: '#CBD5E1', letterSpacing: '-0.03em',
                    lineHeight: 1, marginBottom: '10px',
                    filter: 'blur(6px)',
                    userSelect: 'none',
                  }}>{value}</div>

                  {/* Blurred delta */}
                  <div style={{
                    fontSize: '12px', color: '#CBD5E1',
                    marginBottom: '20px',
                    filter: 'blur(4px)',
                    userSelect: 'none',
                  }}>{delta}</div>

                  {/* Lock CTA — sits above gradient */}
                  <div style={{
                    position: 'relative', zIndex: 2,
                    display: 'flex', alignItems: 'center',
                    gap: '6px', fontSize: '12px',
                    fontWeight: 600, color: '#7C3AED',
                  }}>
                    <span>🔒</span> <span style={{ color: '#534AB7' }}>Connect to unlock</span>
                  </div>
                </div>
              </a>
            ))}
          </div>

          {/* ── AI INSIGHT TEASER ── */}
          <div style={{
            background: '#F5F3FF',
            border: '1px solid #DDD6FE',
            borderRadius: '16px',
            padding: '24px 28px',
            display: 'flex', gap: '18px',
            alignItems: 'flex-start',
          }}>
            <div style={{
              width: '38px', height: '38px',
              background: '#7C3AED', borderRadius: '10px',
              display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: '16px',
              flexShrink: 0,
            }}>✨</div>
            <div>
              <p style={{
                fontSize: '11px', fontWeight: 700,
                color: '#7C3AED', textTransform: 'uppercase',
                letterSpacing: '0.08em', margin: '0 0 6px',
              }}>
                What AI Insights looks like
              </p>
              <p style={{
                fontSize: '14px', color: '#4C1D95',
                lineHeight: 1.65, margin: 0,
              }}>
                After connecting, DevControl's AI will surface insights like:{' '}
                <strong style={{ fontWeight: 600 }}>
                  "3 EC2 instances running at 12% CPU — right-sizing saves $720/month with zero downtime risk."
                </strong>{' '}
                You'll get this analysis automatically, updated daily.
              </p>
            </div>
          </div>

        </div>
      )}

      {/* ── LAYER 2: EXECUTIVE INSIGHTS ── */}
      {!insightDismissed && isAwsConnected && (demoMode || insightMessage) && (
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
              <p style={{ ...overline, margin: '0 0 8px', color: '#7C3AED' }}>
                Executive Insights
              </p>
              <p style={{ fontSize: '0.975rem', color: '#1E293B', lineHeight: 1.7, margin: 0, fontWeight: 400 }}>
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

      {/* ── NARRATIVE — 3fr/2fr Spend Trend + Security Posture ── */}
      {isAwsConnected && (
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: '24px', marginBottom: '32px' }}>

        {/* Spend Trend */}
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '24px' }}>
            <div>
              <p style={overline}>Spend Trend</p>
              <p style={sectionTitle}>Infrastructure cost over time</p>
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
          <p style={overline}>Security Posture</p>

          {/* Large score */}
          <div style={{ textAlign: 'center', padding: '20px 0', borderBottom: '1px solid #F1F5F9', marginBottom: '20px' }}>
            <div style={{ fontSize: '4rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.03em', lineHeight: 1 }}>
              {securityScore ?? '87'}
            </div>
            <div style={{ fontSize: '0.875rem', color: securityDeltaColor, fontWeight: 600, marginTop: '8px' }}>
              {riskScoreData?.current.grade ? `Grade ${riskScoreData.current.grade} · ` : ''}
              {securityScore !== null && securityScore >= 80 ? 'Stable · Elite Tier' : securityScore !== null ? 'Below threshold' : isDemoActive ? 'Stable · Elite Tier' : 'No data yet'}
            </div>
          </div>

          {/* Risk detail rows */}
          {securityRows.map(({ label, value, status }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #F1F5F9' }}>
              <span style={bodyText}>{label}</span>
              <span style={{ fontSize: '0.82rem', fontWeight: 700, color: status === 'good' ? '#059669' : '#D97706' }}>
                {value}
              </span>
            </div>
          ))}

          {/* ── NEW: Compliance Status row ── */}
          <div style={{ padding: '12px 0', borderBottom: '1px solid #F1F5F9' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={bodyText}>Compliance Status</span>
              <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#059669' }}>3 / 3 passing</span>
            </div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {['SOC2', 'CIS AWS', 'GDPR'].map((framework) => (
                <span key={framework} style={{
                  fontSize: '0.68rem',
                  fontWeight: 600,
                  color: '#059669',
                  background: '#F0FDF4',
                  border: '1px solid #BBF7D0',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  letterSpacing: '0.02em',
                }}>
                  {framework}
                </span>
              ))}
            </div>
          </div>

          <a href="/security" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', marginTop: '20px', fontSize: '0.82rem', fontWeight: 600, color: '#7C3AED', textDecoration: 'none' }}>
            View Security Report <ArrowRight size={13} />
          </a>
        </div>
      </div>
      )}

      {/* ── EXECUTIVE ROI SUMMARY ── */}
      {isAwsConnected && (
      <div style={{ ...card, marginBottom: '32px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '24px' }}>
          <div>
            <p style={overline}>Executive ROI Summary</p>
            <p style={{ fontSize: '1.05rem', fontWeight: 600, color: '#0F172A', margin: 0 }}>
              DEVCONTROL has saved WayUP Technology{' '}
              <span style={{ color: '#059669' }}>${(wasteAmount * 12).toLocaleString()}</span> annualised
            </p>
          </div>
          <div style={{ display: 'flex', gap: '10px', flexShrink: 0 }}>
            <a href="/cost-optimization" style={{
              background: '#7C3AED',
              color: '#fff',
              padding: '10px 24px',
              borderRadius: '8px',
              fontSize: '0.875rem',
              fontWeight: 600,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}>
              Approve Savings
            </a>
            <a href="/costs" style={{
              background: 'transparent',
              color: '#475569',
              padding: '10px 18px',
              borderRadius: '8px',
              fontSize: '0.875rem',
              fontWeight: 500,
              textDecoration: 'none',
              border: '1px solid #E2E8F0',
              whiteSpace: 'nowrap',
            }}>
              View Full Report
            </a>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px' }}>
          {[
            { label: 'Monthly Savings', value: `$${wasteAmount.toLocaleString()}`, sub: 'AI-identified waste', color: '#059669' },
            { label: 'Annual Projection', value: `$${(wasteAmount * 12).toLocaleString()}`, sub: 'At current run rate', color: '#059669' },
            { label: 'Avg. ROI Payback', value: '< 15 min', sub: 'Zero-risk changes only', color: '#7C3AED' },
            { label: 'Open Recommendations', value: `${topRecs.length}`, sub: 'Ready to action', color: '#D97706' },
          ].map(({ label, value, sub, color }) => (
            <div key={label} style={{ padding: '16px', background: '#F8FAFC', borderRadius: '10px', border: '1px solid #F1F5F9' }}>
              <p style={{ ...overline, margin: '0 0 8px', fontSize: '0.65rem' }}>{label}</p>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color, letterSpacing: '-0.02em', lineHeight: 1, marginBottom: '4px' }}>
                {value}
              </div>
              <div style={{ fontSize: '0.72rem', color: '#94A3B8' }}>{sub}</div>
            </div>
          ))}
        </div>
      </div>
      )}

      {/* ── SYSTEM STATUS BAR ── */}
      {isAwsConnected && (
      <a href="/monitoring" style={{ textDecoration: 'none', display: 'block', marginBottom: '24px' }}>
        <div style={{
          background: statusConf.bg,
          border: `1px solid ${statusConf.border}`,
          borderRadius: '12px',
          padding: '14px 24px',
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          transition: 'all 0.15s',
        }}
          onMouseEnter={e => { e.currentTarget.style.boxShadow = `0 4px 16px ${statusConf.dot}18` }}
          onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none' }}
        >
          {/* Pulsing status dot */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: statusConf.dot }} />
            {systemStatusLabel !== 'healthy' && (
              <div style={{
                position: 'absolute', inset: '-3px',
                borderRadius: '50%',
                border: `2px solid ${statusConf.dot}`,
                opacity: 0.4,
                animation: 'ping 1.5s cubic-bezier(0,0,0.2,1) infinite',
              }} />
            )}
          </div>

          {/* Status label */}
          <span style={{ fontSize: '0.875rem', fontWeight: 600, color: statusConf.color }}>
            {statusConf.label}
          </span>

          {/* Divider */}
          <div style={{ width: '1px', height: '16px', background: statusConf.border, flexShrink: 0 }} />

          {/* Metrics */}
          <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
            <span style={{ fontSize: '0.82rem', color: statusConf.color }}>
              Avg response <strong>{systemResponseTime}</strong>
            </span>
            <span style={{ fontSize: '0.82rem', color: statusConf.color }}>
              Uptime <strong>{systemUptimeAvg}</strong>
            </span>
            {systemAlertCount > 0 && (
              <span style={{ fontSize: '0.75rem', fontWeight: 700, background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA', padding: '2px 10px', borderRadius: '100px' }}>
                {systemAlertCount} alert{systemAlertCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {/* Right side — link */}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 600, color: statusConf.color }}>
              View observability
            </span>
            <ArrowRight size={13} style={{ color: statusConf.color }} />
          </div>
        </div>
      </a>
      )}

      {/* ── ENGINEERING VELOCITY + AI ADVISOR + RECENT ACTIVITY ── */}
      {isAwsConnected && (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '24px' }}>

        {/* Engineering Velocity — DORA row list */}
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '24px' }}>
            <div>
              <p style={overline}>Engineering Velocity</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.02em' }}>Elite</span>
                <span style={{ fontSize: '0.72rem', fontWeight: 700, background: '#ECFDF5', color: '#059669', padding: '2px 10px', borderRadius: '100px' }}>
                  Top 10%
                </span>
              </div>
            </div>
            <a href="/app/dora-metrics" style={{ fontSize: '0.78rem', fontWeight: 600, color: '#7C3AED', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}>
              Full report <ArrowRight size={12} />
            </a>
          </div>

          {doraRows.map(({ label, value, tier, showTier }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid #F1F5F9' }}>
              <span style={bodyText}>{label}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A' }}>{value}</span>
                {(showTier === undefined || showTier) && (
                  <span style={{
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    color: tier === 'Elite' ? '#059669' : '#D97706',
                    background: tier === 'Elite' ? '#ECFDF5' : '#FFFBEB',
                    padding: '2px 8px',
                    borderRadius: '100px',
                  }}>
                    {tier}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* AI Advisor Feed */}
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '24px' }}>
            <div>
              <p style={overline}>AI Advisor</p>
              <p style={{ ...sectionTitle, fontSize: '1rem' }}>Top recommendations</p>
            </div>
            <a href="/cost-optimization" style={{ fontSize: '0.78rem', fontWeight: 600, color: '#7C3AED', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}>
              All <ArrowRight size={12} />
            </a>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
            {topRecs.map((rec, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '12px 0', borderBottom: '1px solid #F1F5F9' }}>
                <div style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '8px',
                  background: '#F3F0FF',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <Sparkles size={13} style={{ color: '#7C3AED' }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#1E293B', lineHeight: 1.4, marginBottom: '2px' }}>
                    {rec.label}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#059669' }}>{rec.savings}</span>
                    <span style={{ fontSize: '0.68rem', color: '#94A3B8' }}>·</span>
                    <span style={{ fontSize: '0.68rem', color: '#94A3B8' }}>Effort: {rec.effort}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: '16px', padding: '12px', background: '#F8FAFC', borderRadius: '8px', border: '1px solid #F1F5F9' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', marginBottom: '2px' }}>Total potential</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#059669', letterSpacing: '-0.01em' }}>
              ${topRecs.reduce((sum, r) => sum + parseInt(r.savings.replace(/[^0-9]/g, '')), 0).toLocaleString()}/mo
            </div>
          </div>
        </div>

        {/* Recent Activity */}
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
            <p style={{ ...overline, margin: 0 }}>Recent Activity</p>
            <a href="/deployments" style={{ fontSize: '0.78rem', fontWeight: 600, color: '#7C3AED', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}>
              View all <ArrowRight size={12} />
            </a>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {activeDeployments.slice(0, 5).map((d: Deployment) => (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid #F1F5F9' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{
                    width: '7px',
                    height: '7px',
                    borderRadius: '50%',
                    flexShrink: 0,
                    background: getDeploymentStatusColor(d.status),
                  }} />
                  <div>
                    <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#1E293B', lineHeight: 1.4 }}>
                      {d.serviceName || d.serviceId.slice(0, 8)}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#94A3B8', lineHeight: 1.6 }}>{d.environment}</div>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: getDeploymentStatusColor(d.status), textTransform: 'capitalize' }}>
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
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes ping { 75%, 100% { transform: scale(2); opacity: 0; } }
      `}</style>
    </div>
  )
}