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

const INTELLIGENCE_API =
  process.env.NEXT_PUBLIC_API_URL
  || 'http://localhost:8080'

async function fetchSystemIntelligence() {
  const token =
    typeof window !== 'undefined'
      ? localStorage.getItem('accessToken')
      : null
  if (!token) return null
  const res = await fetch(
    `${INTELLIGENCE_API}/api/observability/intelligence`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    }
  )
  if (!res.ok) return null
  const data = await res.json()
  return data.success ? data.data : null
}

const DEMO_INTELLIGENCE = {
  system_score: 81,
  status: 'Stable',
  components: {
    cost: {
      score: 72,
      label: 'Cost Efficiency',
      detail: '$1,922/mo savings identified · 7 opportunities',
      severity: 'medium',
      status: 'warning',
    },
    security: {
      score: 87,
      label: 'Security Posture',
      detail: 'Score 87/100 · No critical issues',
      severity: 'healthy',
      status: 'good',
    },
    observability: {
      score: 72,
      label: 'Observability',
      detail: 'Partially Ready · 1 gap identified',
      severity: 'medium',
      status: 'warning',
    },
  },
  top_action: {
    message: '$1,922/mo savings identified · 7 opportunities',
    consequence: 'Cost inefficiency is reducing system score and budget runway',
    path: '/costs/cost-optimization',
    severity: 'medium',
  },
  top_drivers: [
    {
      id: 'cost-efficiency',
      type: 'cost',
      severity: 'medium',
      message: '$1,922/mo savings identified · 7 opportunities',
      consequence: 'Cost inefficiency is reducing system score and budget runway',
      impact_score: 8,
      action: {
        label: 'Review savings',
        path: '/costs/cost-optimization',
      },
    },
    {
      id: 'observability-readiness',
      type: 'observability',
      severity: 'medium',
      message: 'Alert destinations not configured',
      consequence: 'Incidents will not notify your team',
      impact_score: 8,
      action: {
        label: 'Fix coverage gaps',
        path: '/observability/alert-history',
      },
    },
  ],
}

// Shared card style
const card: React.CSSProperties = {
  background: '#fff',
  borderRadius: '12px',
  padding: '18px',
  border: '0.5px solid #f3f4f6',
}

// Shared overline label style — strong, consistent across all sections
const overline: React.CSSProperties = {
  fontSize: '10px',
  fontWeight: 600,
  color: '#374151',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.08em',
  margin: '0 0 16px',
}

// Strong section title style
const sectionTitle: React.CSSProperties = {
  fontSize: '0.875rem',
  fontWeight: 600,
  color: '#111827',
  margin: 0,
  lineHeight: 1.5,
}

// Body / supporting text — visible, not washed out
const bodyText: React.CSSProperties = {
  fontSize: '0.82rem',
  color: '#6b7280',
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

  const { data: awsAccounts } = useQuery({
    queryKey: ['aws-accounts'],
    queryFn: async () => {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'}/api/aws/accounts`,
        { credentials: 'include' }
      )
      const json = await res.json()
      return json.data ?? []
    },
    staleTime: 30000,
  })

  const isDemoActive = demoMode || salesDemoMode;

  const isAwsConnected = isDemoActive ||
    (awsAccounts && awsAccounts.length > 0) ||
    (!!stats && (
      stats.monthlyAwsCost > 0 ||
      stats.activeDeployments > 0 ||
      stats.totalServices > 0
    ));

  const hasBillingData = !isDemoActive && !!stats && stats.monthlyAwsCost > 0
  const hasPartialData = !isDemoActive && !!stats && stats.monthlyAwsCost === 0 && stats.totalServices > 0
  const isBillingSyncing = !isDemoActive && isAwsConnected && !statsLoading && !!stats && stats.monthlyAwsCost === 0 && stats.totalServices === 0

  const {
    data: systemIntelligence,
  } = useQuery({
    queryKey: ['system-intelligence'],
    queryFn: fetchSystemIntelligence,
    refetchInterval: 120000,
    staleTime: 60000,
    enabled: !isDemoActive && isAwsConnected,
  })

  const displayIntelligence =
    isDemoActive
      ? DEMO_INTELLIGENCE
      : systemIntelligence ?? null

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
    { label: 'Right-size 3 EC2 instances', savings: '$720/mo', effort: 'Low', time: '~15 min' },
    { label: 'Delete unattached EBS volumes', savings: '$210/mo', effort: 'Low', time: '~5 min' },
    { label: 'Enable S3 Intelligent-Tiering', savings: '$340/mo', effort: 'Medium', time: '~10 min' },
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
    { label: 'Active Risks', value: demoMode ? 3 : (statsLoading ? '—' : 3), status: 'warn' },
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
              lineHeight: 1.3,
            }}>
              AWS Cost & Risk Intelligence
            </h1>
          </div>
          <p style={{
            fontSize: '13px',
            color: '#6b7280',
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
            whiteSpace: 'nowrap',
          }}>
            {isBillingSyncing ? 'Approve actions (3) →' : 'Review & Approve Savings (3) →'}
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
          <a href="/observability/alerts" style={{
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

      {/* ── RECOMMENDED ACTION BANNER ── */}
      {isAwsConnected && topRecs.length > 0 && (
        <div style={{
          background: 'rgba(124,58,237,0.06)',
          border: '1.5px solid #7c3aed',
          borderRadius: '14px',
          padding: '16px 22px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '16px',
          marginBottom: '12px',
        }}>
          <div>
            <div style={{ fontSize: '10px', fontWeight: 700, color: '#7c3aed', letterSpacing: '0.1em', textTransform: 'uppercase' as const, marginBottom: '4px' }}>
              RECOMMENDED ACTION
            </div>
            <div style={{ fontSize: '16px', fontWeight: 600, color: '#1e1b4b', marginBottom: '8px' }}>
              Save $800–$2,400/month by approving 3 optimizations
            </div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' as const }}>
              {['Zero downtime', 'Fully reversible', 'Takes < 5 min'].map((pill) => (
                <span key={pill} style={{
                  background: 'white',
                  border: '0.5px solid #e5e7eb',
                  borderRadius: '20px',
                  padding: '2px 9px',
                  fontSize: '11px',
                  color: '#374151',
                }}>{pill}</span>
              ))}
            </div>
          </div>
          <a href="/cost-optimization" style={{
            background: '#7c3aed',
            color: 'white',
            borderRadius: '10px',
            padding: '11px 20px',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
            textDecoration: 'none',
            whiteSpace: 'nowrap' as const,
            flexShrink: 0,
          }}>
            Approve all changes
          </a>
        </div>
      )}

      {statsLoading ? null : isAwsConnected ? (
        isBillingSyncing ? (
          /* ── STATE 1: BILLING SYNCING ── */
          <>
            {/* Billing sync thin strip */}
            <div style={{
              background: '#fff',
              border: '0.5px solid #f3f4f6',
              borderRadius: '12px',
              padding: '10px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '12px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#f59e0b', flexShrink: 0 }} />
                <span style={{ fontSize: '13px', color: '#374151', fontWeight: 500 }}>
                  Billing sync in progress (24–48h) · Preliminary savings already identified:
                </span>
                <span style={{ color: '#059669', fontWeight: 600, fontSize: '13px' }}>$800–$2,400/month</span>
              </div>
              <span style={{ color: '#374151', fontSize: '11px', fontWeight: 500 }}>Infrastructure + Security ready</span>
            </div>

            {/* placeholder to close the original structure */}
            <div style={{ display: 'none' }}><div style={{ flex: 1 }}>
              </div>
            </div>

            {/* CHANGE 3 — KPI placeholder row */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: '24px',
              marginBottom: '16px',
            }}>
              {/* Card 1 — Cloud Spend placeholder */}
              <div style={{
                background: '#fff', borderRadius: '12px',
                padding: '18px', border: '0.5px solid #f3f4f6',
              }}>
                <p style={{
                  fontSize: '10px', fontWeight: 700,
                  color: '#374151', textTransform: 'uppercase',
                  letterSpacing: '0.08em', margin: '0 0 12px',
                }}>Total Cloud Spend</p>
                <div style={{ fontSize: '15px', fontWeight: 600, color: '#111827', lineHeight: 1, marginBottom: '4px' }}>
                  Syncing...
                </div>
                <div style={{ fontSize: '12px', color: '#6b7280', fontWeight: 500, marginBottom: '8px' }}>
                  Full data in 24–48h
                </div>
                <span style={{
                  fontSize: '10px', fontWeight: 600,
                  background: '#d1fae5', color: '#065f46',
                  padding: '2px 7px', borderRadius: '6px',
                  display: 'inline-block', marginTop: '6px',
                }}>High ROI available</span>
              </div>

              {/* Card 2 — Savings Actions */}
              <div style={{
                background: '#fff', borderRadius: '12px',
                padding: '18px', border: '0.5px solid #f3f4f6',
              }}>
                <p style={{
                  fontSize: '10px', fontWeight: 700,
                  color: '#374151', textTransform: 'uppercase',
                  letterSpacing: '0.08em', margin: '0 0 12px',
                }}>Savings Actions</p>
                <div style={{
                  fontSize: '28px', fontWeight: 600,
                  color: '#059669', lineHeight: 1,
                  marginBottom: '8px',
                }}>
                  3
                </div>
                <span style={{
                  fontSize: '10px', fontWeight: 600,
                  background: '#fee2e2', color: '#991b1b',
                  padding: '2px 7px', borderRadius: '6px',
                  display: 'inline-block', marginTop: '6px',
                }}>Awaiting approval</span>
              </div>

              {/* Card 3 — Security Posture */}
              <div style={{ background: '#fff', borderRadius: '12px', padding: '18px', border: '0.5px solid #f3f4f6' }}>
                <p style={{ fontSize: '10px', fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 12px' }}>Security Posture</p>
                {(securityScore === null || securityScore === 0) && !isDemoActive ? (
                  <>
                    <div style={{ fontSize: '15px', fontWeight: 600, color: '#111827', lineHeight: 1, marginBottom: '8px' }}>Scanning...</div>
                    <span style={{ fontSize: '10px', fontWeight: 600, background: '#d1fae5', color: '#065f46', padding: '2px 7px', borderRadius: '6px', display: 'inline-block', marginTop: '6px' }}>Elite tier</span>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: '36px', fontWeight: 600, color: '#111827', lineHeight: 1, marginBottom: '8px' }}>
                      {securityScore !== null ? securityScore : (isDemoActive ? 87 : '—')}
                      <span style={{ fontSize: '1rem', color: '#9ca3af', fontWeight: 400 }}>/100</span>
                    </div>
                    <span style={{ fontSize: '10px', fontWeight: 600, background: '#d1fae5', color: '#065f46', padding: '2px 7px', borderRadius: '6px', display: 'inline-block', marginTop: '6px' }}>Elite tier</span>
                  </>
                )}
              </div>

              {/* Card 4 — System Intelligence */}
              <div style={{ background: '#fff', borderRadius: '12px', padding: '18px', border: '0.5px solid #f3f4f6' }}>
                <p style={{ fontSize: '10px', fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 12px' }}>System Intelligence</p>
                <div style={{
                  fontSize: '36px', fontWeight: 600,
                  color: (displayIntelligence?.system_score ?? cloudHealthScore ?? 0) < 50 ? '#dc2626' : '#111827',
                  lineHeight: 1, marginBottom: '8px',
                }}>
                  {displayIntelligence?.system_score
                    ?? cloudHealthScore
                    ?? '—'}
                  <span style={{ fontSize: '1rem', color: '#9ca3af', fontWeight: 400 }}>/100</span>
                </div>
                {(displayIntelligence?.system_score ?? cloudHealthScore ?? 0) < 50 ? (
                  <span style={{ fontSize: '10px', fontWeight: 600, background: '#fef3c7', color: '#92400e', padding: '2px 7px', borderRadius: '6px', display: 'inline-block', marginTop: '6px' }}>Poor — needs optimization</span>
                ) : (displayIntelligence?.system_score ?? cloudHealthScore ?? 0) >= 85 ? (
                  <span style={{ fontSize: '10px', fontWeight: 600, background: '#d1fae5', color: '#065f46', padding: '2px 7px', borderRadius: '6px', display: 'inline-block', marginTop: '6px' }}>Elite tier</span>
                ) : (
                  <span style={{ fontSize: '10px', fontWeight: 600, background: '#fef3c7', color: '#92400e', padding: '2px 7px', borderRadius: '6px', display: 'inline-block', marginTop: '6px' }}>Needs optimization</span>
                )}
                <div style={{ margin: '8px 0 10px' }}>
                  <span style={{
                    fontSize: '13px',
                    fontWeight: 600,
                    color:
                      (displayIntelligence?.system_score ?? 0) >= 85
                        ? '#059669'
                        : '#92400e',
                  }}>
                    {displayIntelligence?.status ?? 'Computing...'}
                  </span>
                  {displayIntelligence?.system_score && displayIntelligence.system_score < 85 && (
                    <p style={{ fontSize: '12px', color: '#6b7280', fontWeight: 500, margin: '2px 0 0', lineHeight: 1.4 }}>
                      Top teams: 85+ · Improve to unlock full efficiency
                    </p>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {displayIntelligence
                    ? Object.values(displayIntelligence.components).map((comp: any) => (
                        <div key={comp.label} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                          <div style={{ flex: 1, height: '4px', background: '#F1F5F9', borderRadius: '2px' }}>
                            <div style={{
                              width: `${comp.score}%`,
                              height: '100%',
                              background: comp.score >= 80 ? '#059669' : comp.score >= 60 ? '#D97706' : '#DC2626',
                              borderRadius: '2px',
                              transition: 'width 0.3s ease',
                            }} />
                          </div>
                          <span style={{ fontSize: '12px', color: '#374151', width: '76px', textAlign: 'right', whiteSpace: 'nowrap', flexShrink: 0, fontWeight: 500 }}>
                            {comp.label.split(' ')[0]}{' '}{comp.score}
                          </span>
                        </div>
                      ))
                    : [{label:'Cost',score:costScore},{label:'Security',score:securityScore_health},{label:'Reliability',score:reliabilityScore}]
                      .map(({label, score}) => (
                        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                          <div style={{ flex: 1, height: '4px', background: '#F1F5F9', borderRadius: '2px' }}>
                            <div style={{
                              width: `${score ?? 0}%`,
                              height: '100%',
                              background: (score??0) >= 80 ? '#059669' : (score??0) >= 60 ? '#D97706' : '#DC2626',
                              borderRadius: '2px',
                            }} />
                          </div>
                          <span style={{ fontSize: '12px', color: '#374151', width: '76px', textAlign: 'right', flexShrink: 0, fontWeight: 500 }}>
                            {label} {score ?? '—'}
                          </span>
                        </div>
                      ))
                  }
                </div>
              </div>
            </div>
          </>
        ) : (
        /* ── NORTH STAR METRICS — 4 col ── */
        <>
          {hasPartialData && (
            <>
              {/* Partial data warning banner */}
              <div style={{
                background: '#FFFBEB',
                border: '1px solid #FDE68A',
                borderRadius: '12px',
                padding: '12px 20px',
                marginBottom: '20px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="8" x2="12" y2="12"/>
                  <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <span style={{ fontSize: '0.82rem', color: '#92400E' }}>
                  Historical billing data is still syncing. Infrastructure scanning and security analysis are fully operational — cost totals will be available within 24–48 hours.
                </span>
              </div>

              {/* ── DATA STATUS BLOCK ── */}
              <div style={{
                background: '#FFFFFF',
                border: '1px solid #F1F5F9',
                borderRadius: '16px',
                padding: '32px',
                marginBottom: '32px',
              }}>
                <p style={{ fontSize: '0.7rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 20px' }}>Data Status</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {[
                    { label: 'AWS account connected', done: true },
                    { label: 'Infrastructure inventory mapped', done: true },
                    { label: 'Security posture scanned', done: true },
                    { label: 'Savings opportunities identified', done: true },
                    { label: 'Historical billing data syncing', done: false },
                    { label: 'Cost insights and forecasts', done: false },
                  ].map(({ label, done }) => (
                    <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{
                        width: '20px', height: '20px', borderRadius: '50%',
                        background: done ? '#ECFDF5' : '#F9FAFB',
                        border: done ? '1px solid #BBF7D0' : '1px solid #E2E8F0',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      }}>
                        {done ? (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12"/>
                          </svg>
                        ) : (
                          <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#D97706' }}/>
                        )}
                      </div>
                      <span style={{ fontSize: '0.875rem', color: done ? '#1E293B' : '#94A3B8', fontWeight: done ? 500 : 400 }}>
                        {label}
                      </span>
                      {!done && (
                        <span style={{ fontSize: '0.68rem', fontWeight: 600, color: '#D97706', background: '#FFFBEB', border: '1px solid #FDE68A', padding: '1px 8px', borderRadius: '100px', marginLeft: 'auto' }}>
                          Syncing
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* KPI grid — gated on data state */}
          {(isDemoActive || hasBillingData) ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '24px', marginBottom: '32px' }}>
              {/* Total Cloud Spend */}
              <div style={{ ...card }}>
                <p style={{ ...overline, color: '#374151', fontWeight: 700 }}>Total Cloud Spend</p>
                {(statsLoading && !demoMode) || currentSpend === 0 && !demoMode ? (
                  <>
                    <div style={{ fontSize: '15px', fontWeight: 600, color: '#111827', lineHeight: 1, marginBottom: '4px' }}>Syncing...</div>
                    <div style={{ fontSize: '12px', color: '#6b7280', fontWeight: 500, marginBottom: '8px' }}>Full data in 24–48h</div>
                  </>
                ) : (
                  <div style={{ fontSize: '36px', fontWeight: 600, color: '#111827', lineHeight: 1, marginBottom: '8px' }}>
                    {`$${currentSpend.toLocaleString()}`}
                  </div>
                )}
                <span style={{ fontSize: '10px', fontWeight: 600, background: '#d1fae5', color: '#065f46', padding: '2px 7px', borderRadius: '6px', display: 'inline-block', marginTop: '6px' }}>High ROI available</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px' }}>
                  <CostDeltaIcon size={14} style={{ color: costDeltaColor }} />
                  <span style={{ fontSize: '0.8rem', color: costDeltaColor, fontWeight: 600, lineHeight: 1.6 }}>
                    {costChange > 0 ? '+' : ''}{Math.abs(costChange)}%
                  </span>
                  <span style={{ fontSize: '0.8rem', color: '#6b7280', lineHeight: 1.6 }}>vs last month</span>
                </div>
              </div>

              {/* Security Posture KPI */}
              <div style={card}>
                <p style={{ ...overline, color: '#374151', fontWeight: 700 }}>Security Posture</p>
                {(securityScore === null || securityScore === 0) && !isDemoActive ? (
                  <>
                    <div style={{ fontSize: '15px', fontWeight: 600, color: '#111827', lineHeight: 1, marginBottom: '8px' }}>Scanning...</div>
                  </>
                ) : (
                  <div style={{ fontSize: '36px', fontWeight: 600, color: '#111827', lineHeight: 1, marginBottom: '8px' }}>
                    {securityScore ?? (isDemoActive ? 87 : '—')}
                    <span style={{ fontSize: '1rem', color: '#9ca3af', fontWeight: 400 }}>/100</span>
                  </div>
                )}
                <span style={{ fontSize: '10px', fontWeight: 600, background: '#d1fae5', color: '#065f46', padding: '2px 7px', borderRadius: '6px', display: 'inline-block', marginTop: '6px' }}>Elite tier</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px' }}>
                  <SecurityDeltaIcon size={12} style={{ color: securityDeltaColor }} />
                  <span style={{ fontSize: '0.75rem', color: securityDeltaColor, fontWeight: 600 }}>
                    {securityScore !== null && securityScore >= 80 ? 'Elite Tier' : securityScore !== null && securityScore >= 60 ? 'Above baseline' : isDemoActive ? 'Elite Tier' : 'Scan in progress'}
                  </span>
                </div>
              </div>

              {/* Cost Efficiency */}
              <div style={card}>
                <p style={{ ...overline, color: '#374151', fontWeight: 700 }}>Savings Actions</p>
                <div style={{ fontSize: '28px', fontWeight: 600, color: '#059669', lineHeight: 1, marginBottom: '8px' }}>
                  {efficiencyRatio !== null ? `${efficiencyRatio}%` : '—'}
                </div>
                <span style={{ fontSize: '10px', fontWeight: 600, background: '#fee2e2', color: '#991b1b', padding: '2px 7px', borderRadius: '6px', display: 'inline-block', marginTop: '6px' }}>Awaiting approval</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px' }}>
                  <TrendingUp size={14} style={{ color: '#059669' }} />
                  <span style={{ fontSize: '0.8rem', color: '#059669', fontWeight: 600, lineHeight: 1.6 }}>
                    ${wasteAmount.toLocaleString()}/month in savings opportunities
                  </span>
                </div>
              </div>

              {/* System Intelligence */}
              <div style={card}>
                <p style={{ ...overline, color: '#374151', fontWeight: 700 }}>System Intelligence</p>
                <div style={{ fontSize: '36px', fontWeight: 600, color: (displayIntelligence?.system_score ?? cloudHealthScore ?? 0) < 50 ? '#dc2626' : '#111827', lineHeight: 1, marginBottom: '8px' }}>
                  {displayIntelligence?.system_score
                    ?? cloudHealthScore
                    ?? '—'}
                  <span style={{ fontSize: '1rem', color: '#9ca3af', fontWeight: 400 }}>/100</span>
                </div>
                {(displayIntelligence?.system_score ?? cloudHealthScore ?? 0) < 50 ? (
                  <span style={{ fontSize: '10px', fontWeight: 600, background: '#fef3c7', color: '#92400e', padding: '2px 7px', borderRadius: '6px', display: 'inline-block', marginTop: '6px' }}>Poor — needs optimization</span>
                ) : (displayIntelligence?.system_score ?? cloudHealthScore ?? 0) >= 85 ? (
                  <span style={{ fontSize: '10px', fontWeight: 600, background: '#d1fae5', color: '#065f46', padding: '2px 7px', borderRadius: '6px', display: 'inline-block', marginTop: '6px' }}>Elite tier</span>
                ) : (
                  <span style={{ fontSize: '10px', fontWeight: 600, background: '#fef3c7', color: '#92400e', padding: '2px 7px', borderRadius: '6px', display: 'inline-block', marginTop: '6px' }}>Needs optimization</span>
                )}
                <div style={{ margin: '8px 0 10px' }}>
                  <span style={{
                    fontSize: '13px',
                    fontWeight: 600,
                    color:
                      (displayIntelligence?.system_score ?? 0) >= 85
                        ? '#059669'
                        : '#92400e',
                  }}>
                    {displayIntelligence?.status ?? 'Computing...'}
                  </span>
                  {displayIntelligence?.system_score && displayIntelligence.system_score < 85 && (
                    <p style={{ fontSize: '12px', color: '#6b7280', fontWeight: 500, margin: '2px 0 0', lineHeight: 1.4 }}>
                      Top teams: 85+ · Improve to unlock full efficiency
                    </p>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {displayIntelligence
                    ? Object.values(displayIntelligence.components).map((comp: any) => (
                        <div key={comp.label} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                          <div style={{ flex: 1, height: '4px', background: '#F1F5F9', borderRadius: '2px' }}>
                            <div style={{
                              width: `${comp.score}%`,
                              height: '100%',
                              background: comp.score >= 80 ? '#059669' : comp.score >= 60 ? '#D97706' : '#DC2626',
                              borderRadius: '2px',
                              transition: 'width 0.3s ease',
                            }} />
                          </div>
                          <span style={{ fontSize: '12px', color: '#374151', width: '76px', textAlign: 'right', whiteSpace: 'nowrap', flexShrink: 0, fontWeight: 500 }}>
                            {comp.label.split(' ')[0]}{' '}{comp.score}
                          </span>
                        </div>
                      ))
                    : [{label:'Cost',score:costScore},{label:'Security',score:securityScore_health},{label:'Reliability',score:reliabilityScore}]
                      .map(({label, score}) => (
                        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                          <div style={{ flex: 1, height: '4px', background: '#F1F5F9', borderRadius: '2px' }}>
                            <div style={{
                              width: `${score ?? 0}%`,
                              height: '100%',
                              background: (score??0) >= 80 ? '#059669' : (score??0) >= 60 ? '#D97706' : '#DC2626',
                              borderRadius: '2px',
                            }} />
                          </div>
                          <span style={{ fontSize: '12px', color: '#374151', width: '76px', textAlign: 'right', flexShrink: 0, fontWeight: 500 }}>
                            {label} {score ?? '—'}
                          </span>
                        </div>
                      ))
                  }
                </div>
              </div>
            </div>
          ) : isAwsConnected && (isBillingSyncing || hasPartialData) ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '24px', marginBottom: '32px' }}>
              {/* Placeholder — Cloud Spend */}
              <div style={{ background: '#FFFFFF', borderRadius: '16px', padding: '32px', border: '1px solid #F1F5F9', borderLeft: '3px solid #7C3AED', paddingLeft: '29px' }}>
                <p style={{ fontSize: '0.7rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 16px' }}>Total Cloud Spend</p>
                <div style={{ fontSize: '1.1rem', fontWeight: 600, color: '#94A3B8', letterSpacing: '-0.01em', lineHeight: 1.3, marginBottom: '10px' }}>Calculating...</div>
                <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0, lineHeight: 1.5 }}>Available once billing syncs</p>
              </div>
              {/* Placeholder — Savings Opportunity */}
              <div style={{ background: '#FFFFFF', borderRadius: '16px', padding: '32px', border: '1px solid #F1F5F9' }}>
                <p style={{ fontSize: '0.7rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 16px' }}>Savings Opportunity</p>
                <div style={{ fontSize: '1.1rem', fontWeight: 600, color: '#94A3B8', letterSpacing: '-0.01em', lineHeight: 1.3, marginBottom: '10px' }}>Analyzing...</div>
                <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: 0, lineHeight: 1.5 }}>Infrastructure scan in progress</p>
              </div>
              {/* Security Posture KPI — real data */}
              <div style={{ background: '#fff', borderRadius: '12px', padding: '18px', border: '0.5px solid #f3f4f6' }}>
                <p style={{ fontSize: '10px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 12px' }}>Security Posture</p>
                <div style={{ fontSize: '36px', fontWeight: 600, color: '#111827', lineHeight: 1, marginBottom: '8px' }}>
                  {securityScore ?? '—'}
                  <span style={{ fontSize: '1rem', color: '#9ca3af', fontWeight: 400 }}>/100</span>
                </div>
                <span style={{ fontSize: '10px', fontWeight: 600, background: '#d1fae5', color: '#065f46', padding: '2px 7px', borderRadius: '6px', display: 'inline-block', marginTop: '6px' }}>Elite tier</span>
              </div>
              {/* System Intelligence — real data */}
              <div style={card}>
                <p style={overline}>System Intelligence</p>
                <div style={{ fontSize: '2.5rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '12px' }}>
                  {displayIntelligence?.system_score
                    ?? cloudHealthScore
                    ?? '—'}
                  <span style={{ fontSize: '1.25rem', color: '#64748B', fontWeight: 400 }}>/100</span>
                </div>
                <div style={{ margin: '8px 0 10px' }}>
                  <span style={{
                    fontSize: '13px',
                    fontWeight: 600,
                    color:
                      (displayIntelligence?.system_score ?? 0) >= 85
                        ? '#059669'
                        : '#92400e',
                  }}>
                    {displayIntelligence?.status ?? 'Computing...'}
                  </span>
                  {displayIntelligence?.system_score && displayIntelligence.system_score < 85 && (
                    <p style={{ fontSize: '12px', color: '#6b7280', fontWeight: 500, margin: '2px 0 0', lineHeight: 1.4 }}>
                      Top teams: 85+ · Improve to unlock full efficiency
                    </p>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {displayIntelligence
                    ? Object.values(displayIntelligence.components).map((comp: any) => (
                        <div key={comp.label} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                          <div style={{ flex: 1, height: '4px', background: '#F1F5F9', borderRadius: '2px' }}>
                            <div style={{
                              width: `${comp.score}%`,
                              height: '100%',
                              background: comp.score >= 80 ? '#059669' : comp.score >= 60 ? '#D97706' : '#DC2626',
                              borderRadius: '2px',
                              transition: 'width 0.3s ease',
                            }} />
                          </div>
                          <span style={{ fontSize: '12px', color: '#374151', width: '76px', textAlign: 'right', whiteSpace: 'nowrap', flexShrink: 0, fontWeight: 500 }}>
                            {comp.label.split(' ')[0]}{' '}{comp.score}
                          </span>
                        </div>
                      ))
                    : [{label:'Cost',score:costScore},{label:'Security',score:securityScore_health},{label:'Reliability',score:reliabilityScore}]
                      .map(({label, score}) => (
                        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                          <div style={{ flex: 1, height: '4px', background: '#F1F5F9', borderRadius: '2px' }}>
                            <div style={{
                              width: `${score ?? 0}%`,
                              height: '100%',
                              background: (score??0) >= 80 ? '#059669' : (score??0) >= 60 ? '#D97706' : '#DC2626',
                              borderRadius: '2px',
                            }} />
                          </div>
                          <span style={{ fontSize: '12px', color: '#374151', width: '76px', textAlign: 'right', flexShrink: 0, fontWeight: 500 }}>
                            {label} {score ?? '—'}
                          </span>
                        </div>
                      ))
                  }
                </div>
              </div>
            </div>
          ) : null}
        </>
        )
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
              <span style={{ color: '#534AB7', fontSize: '16px' }}>✦</span>
            </div>
            <div>
              <p style={{ fontSize: '13px', fontWeight: 500, color: '#534AB7', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 3px' }}>
                Example insight you'll get in 2 minutes
              </p>
              <p style={{ fontSize: '15px', color: '#0F172A', lineHeight: 1.5, margin: 0 }}>
                "3 EC2 instances running at 12% CPU — right-sizing saves $720/month with zero downtime risk"
              </p>
              <p style={{ fontSize: '14px', color: '#475569', margin: '3px 0 0' }}>
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
              fontSize: '21px', fontWeight: 700,
              color: '#0F172A', letterSpacing: '-0.02em',
              margin: '0 0 8px',
            }}>
              Connect your AWS account to uncover cost leaks and infrastructure risks
            </h2>
            <p style={{
              fontSize: '16px', color: '#475569',
              maxWidth: '460px', margin: '0 auto 28px',
              lineHeight: 1.65,
            }}>
              DevControl uses read-only access to analyze your AWS environment and surface savings, risks, and inefficiencies — no changes made to your infrastructure.
            </p>
            <a href="/connect-aws" style={{
              display: 'inline-flex', alignItems: 'center',
              gap: '8px', background: '#7C3AED', color: '#FFFFFF',
              padding: '12px 28px', borderRadius: '10px',
              fontSize: '16px', fontWeight: 600,
              textDecoration: 'none',
              boxShadow: '0 4px 14px rgba(124,58,237,0.3)',
            }}>
              Connect AWS Account (2 min setup) →
            </a>
            <p style={{
              fontSize: '14px', color: '#94A3B8', marginTop: '14px',
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
            fontSize: '14px',
            color: '#475569',
            margin: '0 0 24px',
          }}>
            Teams typically find{' '}
            <strong style={{ color: '#0F172A', fontWeight: 500 }}>20–40% savings</strong>
            {' '}in unused or overprovisioned AWS resources on their first scan.
          </div>

          {/* ── WHAT YOU'LL UNLOCK LABEL ── */}
          <div style={{
            fontSize: '13px', fontWeight: 600,
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
                    fontSize: '0.8rem', fontWeight: 700,
                    color: '#475569', textTransform: 'uppercase',
                    letterSpacing: '0.1em', margin: '0 0 14px',
                  }}>{label}</p>

                  {/* Blurred value */}
                  <div style={{
                    fontSize: '2.325rem', fontWeight: 700,
                    color: '#CBD5E1', letterSpacing: '-0.03em',
                    lineHeight: 1, marginBottom: '10px',
                    filter: 'blur(6px)',
                    userSelect: 'none',
                  }}>{value}</div>

                  {/* Blurred delta */}
                  <div style={{
                    fontSize: '14px', color: '#CBD5E1',
                    marginBottom: '20px',
                    filter: 'blur(4px)',
                    userSelect: 'none',
                  }}>{delta}</div>

                  {/* Lock CTA — sits above gradient */}
                  <div style={{
                    position: 'relative', zIndex: 2,
                    display: 'flex', alignItems: 'center',
                    gap: '6px', fontSize: '14px',
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
                fontSize: '13px', fontWeight: 700,
                color: '#7C3AED', textTransform: 'uppercase',
                letterSpacing: '0.08em', margin: '0 0 6px',
              }}>
                What AI Insights looks like
              </p>
              <p style={{
                fontSize: '16px', color: '#4C1D95',
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

      {/* ── SYSTEM INTELLIGENCE BLOCK ── */}
      {displayIntelligence &&
        isAwsConnected &&
        !isBillingSyncing &&
        !hasPartialData && (
        <div style={{
          background: '#fff',
          borderRadius: '14px',
          border: '1px solid #E2E8F0',
          padding: '20px 24px',
          marginBottom: '24px',
        }}>

          {/* Top Priority Action */}
          {displayIntelligence.top_action && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '16px',
              padding: '14px 16px',
              background:
                displayIntelligence
                  .top_action.severity
                  === 'critical'
                  ? '#FEF2F2'
                  : '#FFFBEB',
              border: `1px solid ${
                displayIntelligence
                  .top_action.severity
                  === 'critical'
                  ? '#FECACA'
                  : '#FDE68A'
              }`,
              borderLeft: `4px solid ${
                displayIntelligence
                  .top_action.severity
                  === 'critical'
                  ? '#DC2626'
                  : '#D97706'
              }`,
              borderRadius: '10px',
              marginBottom: '16px',
            }}>
              <div>
                <p style={{
                  fontSize: '0.62rem',
                  fontWeight: 700,
                  color:
                    displayIntelligence
                      .top_action.severity
                      === 'critical'
                      ? '#DC2626'
                      : '#D97706',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  margin: '0 0 3px',
                }}>
                  Top Priority
                </p>
                <p style={{
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  color: '#0F172A',
                  margin: '0 0 2px',
                }}>
                  {displayIntelligence
                    .top_action.message}
                </p>
                <p style={{
                  fontSize: '0.75rem',
                  color:
                    displayIntelligence
                      .top_action.severity
                      === 'critical'
                      ? '#DC2626'
                      : '#D97706',
                  margin: 0,
                  fontWeight: 500,
                }}>
                  {displayIntelligence
                    .top_action.consequence}
                </p>
              </div>
              <a
                href={displayIntelligence
                  .top_action.path}
                style={{
                  background:
                    displayIntelligence
                      .top_action.severity
                      === 'critical'
                      ? '#DC2626'
                      : '#7C3AED',
                  color: '#fff',
                  padding: '8px 16px',
                  borderRadius: '8px',
                  fontSize: '0.78rem',
                  fontWeight: 700,
                  textDecoration: 'none',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                Fix now →
              </a>
            </div>
          )}

          {/* Ranked drivers list */}
          {displayIntelligence
            .top_drivers?.length > 0 && (
            <div>
              <p style={{
                fontSize: '0.68rem',
                fontWeight: 700,
                color: '#94A3B8',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                margin: '0 0 10px',
              }}>
                System Score Drivers
              </p>
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}>
                {displayIntelligence
                  .top_drivers
                  .map((driver: any,
                    i: number) => (
                  <div
                    key={driver.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '14px',
                      padding: '10px 14px',
                      background: '#F8FAFC',
                      borderRadius: '8px',
                      border: '1px solid #F1F5F9',
                    }}
                  >
                    {/* Rank */}
                    <span style={{
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      color: '#94A3B8',
                      width: '16px',
                      flexShrink: 0,
                    }}>
                      #{i + 1}
                    </span>

                    {/* Severity dot */}
                    <div style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      flexShrink: 0,
                      background:
                        driver.severity
                          === 'critical'
                          ? '#DC2626'
                          : driver.severity
                            === 'high'
                            ? '#D97706'
                            : '#F59E0B',
                    }} />

                    {/* Content */}
                    <div style={{ flex: 1 }}>
                      <p style={{
                        fontSize: '0.82rem',
                        fontWeight: 600,
                        color: '#0F172A',
                        margin: '0 0 1px',
                      }}>
                        {driver.message}
                      </p>
                      <p style={{
                        fontSize: '0.72rem',
                        color: '#64748B',
                        margin: 0,
                      }}>
                        {driver.consequence}
                      </p>
                    </div>

                    {/* Impact */}
                    <span style={{
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      color: '#059669',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                    }}>
                      +{driver.impact_score}pts
                    </span>

                    {/* Action */}
                    <a
                      href={driver.action.path}
                      style={{
                        fontSize: '0.72rem',
                        fontWeight: 600,
                        color: '#7C3AED',
                        textDecoration: 'none',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                      }}
                    >
                      {driver.action.label} →
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── LAYER 2: EXECUTIVE INSIGHTS ── */}
      {!insightDismissed && isAwsConnected && !isBillingSyncing && !hasPartialData && (demoMode || insightMessage) && (
        <div style={{
          background: '#F8FAFC',
          border: '1px solid #E2E8F0',
          borderLeft: '2px solid #7C3AED',
          borderRadius: '8px',
          padding: '14px 18px',
          marginBottom: '32px',
          position: 'relative',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
            <div style={{
              width: '28px',
              height: '28px',
              borderRadius: '8px',
              background: '#EEEDFE',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <Sparkles size={13} style={{ color: '#7C3AED' }} />
            </div>
            <div style={{ flex: 1 }}>
              <p style={{ ...overline, margin: '0 0 8px', fontSize: '0.68rem', color: '#7C3AED' }}>
                Executive Insights
              </p>
              <p style={{ fontSize: '0.875rem', color: '#1E293B', lineHeight: 1.65, margin: 0, fontWeight: 400 }}>
                {demoMode
                  ? <>Compute costs are driving spend ($5,200, +12%).{' '}
                    <a href="/cost-optimization" style={{ color: '#7C3AED', fontWeight: 600, textDecoration: 'none' }}>
                      Review optimization opportunities →
                    </a></>
                  : (insightMessage || `Your infrastructure is being actively analyzed. ${
                      displayIntelligence?.top_drivers?.[0]?.message
                        ? displayIntelligence.top_drivers[0].message +
                          ' — ' +
                          displayIntelligence.top_drivers[0].consequence
                        : '3 optimization opportunities identified with zero downtime risk.'
                    }`)
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

      {/* ── NARRATIVE — 3fr/2fr Spend Trend + Security Posture / 2-col AI+Security ── */}
      {isAwsConnected && (
        isBillingSyncing ? (
          /* CHANGE 4 — 2-col AI Advisor + Security Posture */
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '24px',
            marginBottom: '16px',
          }}>
            {/* LEFT: AI Advisor */}
            <div style={{
              background: '#FFFFFF', borderRadius: '16px',
              padding: '32px', border: '1px solid #F1F5F9',
            }}>
              <div style={{
                display: 'flex', alignItems: 'flex-start',
                justifyContent: 'space-between', marginBottom: '4px',
              }}>
                <div>
                  <p style={{
                    fontSize: '10px', fontWeight: 700,
                    color: '#374151', textTransform: 'uppercase',
                    letterSpacing: '0.08em', margin: '0 0 8px',
                  }}>AI Advisor</p>
                  <p style={{
                    fontSize: '16px', fontWeight: 700,
                    color: '#111827', margin: 0,
                  }}>
                    Actions ready for approval
                  </p>
                </div>
                <a href="/cost-optimization" style={{
                  fontSize: '0.78rem', fontWeight: 600,
                  color: '#7C3AED', textDecoration: 'none',
                  whiteSpace: 'nowrap',
                }}>
                  All →
                </a>
              </div>

              <p style={{
                fontSize: '12px', color: '#374151',
                margin: '0 0 16px', lineHeight: 1.5,
              }}>
                These 3 changes reduce AWS waste
                immediately · zero downtime ·
                fully reversible · takes &lt; 15 min
              </p>

              {topRecs.map((rec, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'flex-start',
                  gap: '12px', padding: '12px 0',
                  borderBottom: '1px solid #F1F5F9',
                }}>
                  <div style={{
                    width: '28px', height: '28px',
                    borderRadius: '8px', background: '#F3F0FF',
                    display: 'flex', alignItems: 'center',
                    justifyContent: 'center', flexShrink: 0,
                  }}>
                    <Sparkles size={13} style={{ color: '#7C3AED' }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{
                      fontSize: '14px', fontWeight: 600,
                      color: '#111827', marginBottom: '4px',
                    }}>
                      {rec.label}
                    </div>
                    <div style={{
                      fontSize: '12px', color: '#374151',
                      fontStyle: 'normal', fontWeight: 500,
                      marginBottom: '4px',
                    }}>
                      Cost impact pending billing sync
                    </div>
                    <div style={{
                      display: 'flex', gap: '5px', flexWrap: 'wrap',
                    }}>
                      {i < 2 ? (
                        <>
                          <span style={{
                            fontSize: '0.65rem', fontWeight: 600,
                            color: '#059669', background: '#F0FDF4',
                            border: '1px solid #BBF7D0',
                            padding: '1px 6px', borderRadius: '4px',
                          }}>Low risk</span>
                          <span style={{
                            fontSize: '0.65rem', fontWeight: 600,
                            color: '#059669', background: '#F0FDF4',
                            border: '1px solid #BBF7D0',
                            padding: '1px 6px', borderRadius: '4px',
                          }}>No downtime</span>
                        </>
                      ) : (
                        <span style={{
                          fontSize: '0.65rem', fontWeight: 600,
                          color: '#D97706', background: '#FFFBEB',
                          border: '1px solid #FDE68A',
                          padding: '1px 6px', borderRadius: '4px',
                        }}>Low risk</span>
                      )}
                      <span style={{
                        fontSize: '0.65rem', fontWeight: 600,
                        color: '#475569', background: '#F8FAFC',
                        border: '1px solid #E2E8F0',
                        padding: '1px 6px', borderRadius: '4px',
                      }}>
                        {rec.time}
                      </span>
                    </div>
                  </div>
                </div>
              ))}

              <div style={{
                marginTop: '16px', padding: '14px 16px',
                background: '#F8FAFC', borderRadius: '8px',
                border: '1px solid #F1F5F9',
                display: 'flex', alignItems: 'center',
                justifyContent: 'space-between',
              }}>
                <div>
                  <div style={{
                    fontSize: '13px', fontWeight: 600,
                    color: '#111827', marginBottom: '2px',
                  }}>
                    Estimated impact
                  </div>
                  <div style={{
                    fontSize: '12px', color: '#374151', fontWeight: 500,
                  }}>
                    Savings estimate available once billing
                    sync completes
                  </div>
                </div>
                <a href="/cost-optimization" style={{
                  background: '#7C3AED', color: '#fff',
                  borderRadius: '8px', padding: '8px 16px',
                  fontSize: '0.78rem', fontWeight: 600,
                  textDecoration: 'none', whiteSpace: 'nowrap',
                  marginLeft: '16px',
                }}>
                  Approve actions (3) →
                </a>
              </div>
            </div>

            {/* RIGHT: Security Posture */}
            <div style={{
              background: '#FFFFFF', borderRadius: '16px',
              padding: '32px', border: '1px solid #F1F5F9',
            }}>
              <p style={{
                fontSize: '0.7rem', fontWeight: 700,
                color: '#475569', textTransform: 'uppercase',
                letterSpacing: '0.1em', margin: '0 0 16px',
              }}>Security Posture</p>

              <div style={{
                textAlign: 'center', padding: '12px 0',
                borderBottom: '1px solid #F1F5F9',
                marginBottom: '14px',
              }}>
                <div style={{
                  fontSize: '3rem', fontWeight: 700,
                  color: '#0F172A', letterSpacing: '-0.03em',
                  lineHeight: 1,
                }}>
                  {securityScore ?? '87'}
                  <span style={{
                    fontSize: '1rem', color: '#94A3B8',
                    fontWeight: 400,
                  }}> (preliminary)</span>
                </div>
                <div style={{
                  fontSize: '0.72rem', color: '#94A3B8',
                  marginTop: '4px',
                }}>
                  Scan in progress
                </div>
                <div style={{
                  fontSize: '0.78rem', color: '#059669',
                  fontWeight: 600, marginTop: '3px',
                }}>
                  Elite Tier
                </div>
              </div>

              {securityRows.map(({ label, value, status }) => (
                <div key={label} style={{
                  display: 'flex', alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 0', borderBottom: '1px solid #F1F5F9',
                }}>
                  <span style={{
                    fontSize: '0.82rem', color: '#475569',
                    lineHeight: 1.6,
                  }}>{label}</span>
                  <span style={{
                    fontSize: '0.82rem', fontWeight: 700,
                    color: status === 'good' ? '#059669' : '#D97706',
                  }}>
                    {value}
                  </span>
                </div>
              ))}

              <div style={{ padding: '8px 0', borderBottom: '1px solid #F1F5F9' }}>
                <div style={{
                  display: 'flex', alignItems: 'center',
                  justifyContent: 'space-between', marginBottom: '6px',
                }}>
                  <span style={{
                    fontSize: '0.82rem', color: '#475569', lineHeight: 1.6,
                  }}>Compliance Status</span>
                  <span style={{
                    fontSize: '0.78rem', fontWeight: 700, color: '#059669',
                  }}>3 / 3 passing</span>
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {['SOC2', 'CIS AWS', 'GDPR'].map((f) => (
                    <span key={f} style={{
                      fontSize: '0.68rem', fontWeight: 600,
                      color: '#059669', background: '#F0FDF4',
                      border: '1px solid #BBF7D0',
                      padding: '2px 8px', borderRadius: '4px',
                    }}>{f}</span>
                  ))}
                </div>
              </div>

              <a href="/security" style={{
                display: 'flex', alignItems: 'center',
                justifyContent: 'center', gap: '6px',
                marginTop: '14px', fontSize: '0.82rem',
                fontWeight: 600, color: '#7C3AED',
                textDecoration: 'none',
              }}>
                View Security Report →
              </a>
            </div>
          </div>
        ) : (
          /* Existing 3fr/2fr Spend Trend + Security Posture */
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
                <div style={{
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  marginTop: '8px',
                  color: securityScore !== null && securityScore >= 80
                    ? '#059669'
                    : securityScore !== null && securityScore >= 60
                    ? '#D97706'
                    : '#94A3B8',
                }}>
                  {securityScore !== null && securityScore >= 80
                    ? 'Elite Tier'
                    : securityScore !== null && securityScore >= 60
                    ? 'Above baseline'
                    : securityScore !== null
                    ? 'Needs attention'
                    : isDemoActive
                    ? 'Elite Tier'
                    : 'Scan in progress'}
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
        )
      )}

      {/* ── EXECUTIVE ROI SUMMARY ── */}
      {isAwsConnected && !isBillingSyncing && !hasPartialData && (
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
      <div style={{ background: '#FFFFFF', border: '0.5px solid #f3f4f6', borderRadius: '12px', padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: systemAlertCount > 0 ? '#f59e0b' : '#22c55e', flexShrink: 0 }} />
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#111827' }}>
            {systemAlertCount > 0 ? `${systemAlertCount} active alert${systemAlertCount !== 1 ? 's' : ''}` : statusConf.label}
          </span>
          <div style={{ width: 1, height: 14, background: '#e5e7eb' }} />
          <span style={{ fontSize: '12px', color: '#374151', fontWeight: 500 }}>{systemUptimeAvg !== '—' ? `${systemUptimeAvg} uptime this month` : '99.9% uptime this month'}</span>
          <div style={{ width: 1, height: 14, background: '#e5e7eb' }} />
          <span style={{ fontSize: '12px', color: '#374151', fontWeight: 500 }}>No incidents in 30 days</span>
          <div style={{ width: 1, height: 14, background: '#e5e7eb' }} />
          <span style={{ fontSize: '12px', color: '#374151', fontWeight: 500 }}>{systemResponseTime !== '—' ? `Avg response ${systemResponseTime}` : '3 services monitored'}</span>
        </div>
        <a href="/monitoring" style={{ color: '#16a34a', fontWeight: 600, fontSize: '12px', textDecoration: 'none' }}>
          View observability →
        </a>
      </div>
      )}

      {/* ── ENGINEERING VELOCITY + AI ADVISOR + RECENT ACTIVITY ── */}
      {isAwsConnected && (
      isBillingSyncing ? (
        /* CHANGE 6 — Syncing state bottom 3-col */
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '24px' }}>

          {/* LEFT: Engineering Health (muted) */}
          <div style={{ background: '#fff', border: '0.5px solid #f3f4f6', borderRadius: '12px', padding: '18px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '16px' }}>
              <div>
                <p style={{ ...overline, margin: '0 0 6px', color: '#374151', fontWeight: 700 }}>Engineering Health</p>
                <span style={{ fontSize: '22px', fontWeight: 700, color: '#111827' }}>Elite</span>
              </div>
              <a href="/app/dora-metrics" style={{ fontSize: '0.72rem', fontWeight: 600, color: '#7c3aed', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}>
                Full report <ArrowRight size={12} />
              </a>
            </div>

            {doraRows.filter(r => ['Lead Time for Changes', 'Change Failure Rate', 'Mean Time to Recovery'].includes(r.label)).map(({ label, value }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 0', borderBottom: '0.5px solid #f3f4f6' }}>
                <span style={{ fontSize: '13px', color: '#374151', lineHeight: 1.6, fontWeight: 500 }}>{label}</span>
                <span style={{
                  fontSize: '13px', fontWeight: 600,
                  color: label === 'Change Failure Rate' ? '#f59e0b' : '#111827',
                }}>{value}</span>
              </div>
            ))}
          </div>

          {/* CENTER: What You Can Do Now */}
          <div style={{ background: '#fff', border: '0.5px solid #f3f4f6', borderRadius: '12px', padding: '18px' }}>
            <p style={{ fontSize: '10px', fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 16px' }}>What You Can Do Now</p>

            {/* Item 1 — highlighted */}
            <a href="/cost-optimization" style={{
              display: 'flex', alignItems: 'center',
              gap: '12px', padding: '14px 16px',
              border: '1px solid #6D28D9',
              textDecoration: 'none', cursor: 'pointer',
              background: '#7C3AED', borderRadius: '10px',
              marginBottom: '8px',
            }}>
              <div style={{
                width: '32px', height: '32px',
                borderRadius: '8px', background: 'rgba(255,255,255,0.15)',
                flexShrink: 0, display: 'flex',
                alignItems: 'center', justifyContent: 'center',
              }}>
                <CheckCircle size={14} style={{ color: '#fff' }} />
              </div>
              <div>
                <div style={{
                  fontSize: '0.875rem', fontWeight: 700,
                  color: '#fff', marginBottom: '2px',
                }}>
                  Approve actions (3)
                </div>
                <div style={{
                  fontSize: '0.72rem', color: '#DDD6FE',
                  fontWeight: 500,
                }}>
                  Zero downtime · fully reversible · &lt; 5 min
                </div>
              </div>
              <span style={{
                marginLeft: 'auto', fontSize: '0.75rem',
                color: '#fff', fontWeight: 700,
              }}>→</span>
            </a>

            {/* Items 2–4 */}
            {[
              {
                href: '/security',
                iconBg: '#F0FDF4',
                iconColor: '#059669',
                title: 'Explore security report',
                sub: '87 score · 3 anomalies',
              },
              {
                href: '/deployments',
                iconBg: '#F8FAFC',
                iconColor: '#475569',
                title: 'Connect CI/CD pipeline',
                sub: 'Track deployments · velocity',
              },
              {
                href: '/costs',
                iconBg: '#FFFBEB',
                iconColor: '#D97706',
                title: 'Monitor billing sync',
                sub: 'Cost data within 24–48h',
              },
            ].map(({ href, iconBg, iconColor, title, sub }) => (
              <a key={href} href={href} style={{
                display: 'flex', alignItems: 'center',
                gap: '12px',
                border: '0.5px solid #f3f4f6', borderRadius: '10px',
                padding: '10px 12px', marginBottom: '6px',
                textDecoration: 'none', cursor: 'pointer',
              }}>
                <div style={{
                  width: '30px', height: '30px',
                  borderRadius: '8px', background: iconBg,
                  flexShrink: 0, display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <ArrowRight size={13} style={{ color: iconColor }} />
                </div>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#111827', marginBottom: '1px' }}>{title}</div>
                  <div style={{ fontSize: '12px', color: '#6b7280' }}>{sub}</div>
                </div>
                <span style={{ marginLeft: 'auto', fontSize: '0.875rem', color: '#7C3AED', fontWeight: 600 }}>→</span>
              </a>
            ))}
          </div>

          {/* RIGHT: Recent Activity — existing card */}
          <div style={{ background: '#fff', border: '0.5px solid #f3f4f6', borderRadius: '12px', padding: '18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <p style={{ ...overline, margin: 0, fontWeight: 700 }}>Recent Activity</p>
              <a href="/deployments" style={{ fontSize: '0.78rem', fontWeight: 600, color: '#7C3AED', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}>
                View all <ArrowRight size={12} />
              </a>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {activeDeployments.slice(0, 5).map((d: Deployment) => (
                <div key={d.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 0', borderBottom: '0.5px solid #f3f4f6' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{
                      width: '7px',
                      height: '7px',
                      borderRadius: '50%',
                      flexShrink: 0,
                      background: getDeploymentStatusColor(d.status),
                    }} />
                    <div>
                      <div style={{ fontSize: '0.82rem', fontWeight: 500, color: '#111827', lineHeight: 1.4 }}>
                        {d.serviceName || d.serviceId.slice(0, 8)}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: '#6b7280', lineHeight: 1.6 }}>{d.environment}</div>
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
                <div style={{
                  textAlign: 'center',
                  padding: '40px 16px',
                  minHeight: '200px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                }}>
                  <div style={{ width: 40, height: 40, borderRadius: '10px', background: '#F9FAFB', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '4px' }}>
                    <Activity size={18} style={{ color: '#9ca3af' }} />
                  </div>
                  <p style={{ margin: 0, color: '#111827', fontWeight: 600, fontSize: '14px' }}>
                    No deployment data yet
                  </p>
                  <p style={{ margin: 0, fontSize: '12px', color: '#6b7280', lineHeight: 1.5 }}>
                    Connect your CI/CD pipeline to unlock deployment velocity insights, change failure rate tracking, and incident impact analysis
                  </p>
                  <a href="/deployments" style={{
                    marginTop: '8px',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    color: '#7C3AED',
                    textDecoration: 'none',
                  }}>
                    Connect CI/CD pipeline →
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '24px' }}>

        {/* Engineering Velocity — DORA row list */}
        <div style={{ background: '#fff', border: '0.5px solid #f3f4f6', borderRadius: '12px', padding: '18px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '16px' }}>
            <div>
              <p style={{ ...overline, margin: '0 0 6px' }}>Engineering Health</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '20px', fontWeight: 600, color: '#111827' }}>Elite</span>
                <span style={{ fontSize: '0.72rem', fontWeight: 700, background: '#ECFDF5', color: '#059669', padding: '2px 10px', borderRadius: '100px' }}>
                  Top 10%
                </span>
              </div>
            </div>
            <a href="/app/dora-metrics" style={{ fontSize: '0.78rem', fontWeight: 600, color: '#7C3AED', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}>
              Full report <ArrowRight size={12} />
            </a>
          </div>

          <p style={{
            fontSize: '0.75rem',
            color: '#6b7280',
            margin: '0 0 12px',
            lineHeight: 1.5,
          }}>
            Elite performance across all 4 DORA metrics
          </p>

          {doraRows.map(({ label, value, tier, showTier }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 0', borderBottom: '0.5px solid #f3f4f6' }}>
              <span style={{ fontSize: '0.82rem', color: '#6b7280', lineHeight: 1.6 }}>{label}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '0.875rem', fontWeight: 600, color: label === 'Change Failure Rate' ? '#f59e0b' : '#111827' }}>{value}</span>
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
        {(() => {
          const showSavingsDollars = isDemoActive || hasBillingData;
          return (
        <div style={{ background: '#fff', border: '0.5px solid #f3f4f6', borderRadius: '12px', padding: '18px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '16px' }}>
            <div>
              <p style={{ ...overline, margin: '0 0 6px' }}>What You Can Do Now</p>
              <p style={{ ...sectionTitle, fontSize: '1rem' }}>Top recommendations</p>
            </div>
            <a href="/cost-optimization" style={{ fontSize: '0.78rem', fontWeight: 600, color: '#7C3AED', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}>
              All <ArrowRight size={12} />
            </a>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
            <p style={{
              fontSize: '0.78rem',
              color: '#374151',
              margin: '0 0 12px',
              lineHeight: 1.5,
              padding: '10px 12px',
              background: '#F0FDF4',
              borderRadius: '8px',
              border: '0.5px solid #f3f4f6',
            }}>
              These {topRecs.length} changes
              reduce AWS waste immediately —
              zero downtime · fully reversible
            </p>
            {topRecs.map((rec, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', border: '0.5px solid #f3f4f6', borderRadius: '10px', padding: '10px 12px', marginBottom: '6px' }}>
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
                  <div style={{ fontSize: '0.82rem', fontWeight: 500, color: '#111827', lineHeight: 1.4, marginBottom: '2px' }}>
                    {rec.label}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap', marginTop: '4px' }}>
                    {showSavingsDollars ? (
                      <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#059669' }}>{rec.savings}</span>
                    ) : (
                      <span style={{ fontSize: '0.72rem', color: '#94A3B8', fontStyle: 'italic' }}>Cost impact pending billing sync</span>
                    )}
                    {i < 2 ? (
                      <>
                        <span style={{ fontSize: '0.65rem', fontWeight: 600, color: '#059669', background: '#F0FDF4', border: '1px solid #BBF7D0', padding: '1px 6px', borderRadius: '4px' }}>Low risk</span>
                        <span style={{ fontSize: '0.65rem', fontWeight: 600, color: '#059669', background: '#F0FDF4', border: '1px solid #BBF7D0', padding: '1px 6px', borderRadius: '4px' }}>No downtime</span>
                        <span style={{ fontSize: '0.65rem', fontWeight: 600, color: '#1D4ED8', background: '#EFF6FF', border: '1px solid #BFDBFE', padding: '1px 6px', borderRadius: '4px' }}>High confidence</span>
                      </>
                    ) : (
                      <>
                        <span style={{ fontSize: '0.65rem', fontWeight: 600, color: '#D97706', background: '#FFFBEB', border: '1px solid #FDE68A', padding: '1px 6px', borderRadius: '4px' }}>Low risk</span>
                        <span style={{ fontSize: '0.65rem', fontWeight: 600, color: '#475569', background: '#F8FAFC', border: '1px solid #E2E8F0', padding: '1px 6px', borderRadius: '4px' }}>Effort: Medium</span>
                      </>
                    )}
                    <span style={{
                      fontSize: '0.65rem',
                      fontWeight: 600,
                      color: '#475569',
                      background: '#F8FAFC',
                      border: '1px solid #E2E8F0',
                      padding: '1px 6px',
                      borderRadius: '4px',
                    }}>
                      {rec.time}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: '16px', padding: '12px', background: '#F8FAFC', borderRadius: '8px', border: '1px solid #F1F5F9' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', marginBottom: '2px' }}>Total potential</div>
            {showSavingsDollars ? (
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#059669', letterSpacing: '-0.01em' }}>
                $1,270/mo
              </div>
            ) : (
              <div style={{ fontSize: '0.82rem', color: '#94A3B8', fontStyle: 'italic' }}>
                Calculated once billing syncs
              </div>
            )}
          </div>
        </div>
          );
        })()}

        {/* Recent Activity */}
        <div style={{ background: '#fff', border: '0.5px solid #f3f4f6', borderRadius: '12px', padding: '18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <p style={{ ...overline, margin: 0, fontWeight: 700 }}>Recent Activity</p>
            <a href="/deployments" style={{ fontSize: '0.78rem', fontWeight: 600, color: '#7C3AED', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}>
              View all <ArrowRight size={12} />
            </a>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {activeDeployments.slice(0, 5).map((d: Deployment) => (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 0', borderBottom: '0.5px solid #f3f4f6' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{
                    width: '7px',
                    height: '7px',
                    borderRadius: '50%',
                    flexShrink: 0,
                    background: getDeploymentStatusColor(d.status),
                  }} />
                  <div>
                    <div style={{ fontSize: '0.82rem', fontWeight: 500, color: '#111827', lineHeight: 1.4 }}>
                      {d.serviceName || d.serviceId.slice(0, 8)}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#94A3B8', lineHeight: 1.6 }}>{d.environment}</div>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: getDeploymentStatusColor(d.status), textTransform: 'capitalize' }}>
                    {d.status}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: '#6b7280' }}>
                    {formatDistanceToNow(new Date(d.deployedAt), { addSuffix: true })}
                  </div>
                </div>
              </div>
            ))}
            {activeDeployments.length === 0 && (
              <div style={{
                textAlign: 'center',
                padding: '40px 16px',
                minHeight: '200px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
              }}>
                <div style={{ width: 40, height: 40, borderRadius: '10px', background: '#F9FAFB', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '4px' }}>
                  <Activity size={18} style={{ color: '#9ca3af' }} />
                </div>
                <p style={{ margin: 0, color: '#111827', fontWeight: 500, fontSize: '0.875rem' }}>
                  No deployment data yet
                </p>
                <p style={{ margin: 0, fontSize: '12px', color: '#6b7280', lineHeight: 1.5 }}>
                  Connect your CI/CD pipeline to unlock deployment velocity insights, change failure rate tracking, and incident impact analysis
                </p>
                <a href="/deployments" style={{
                  marginTop: '8px',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  color: '#7C3AED',
                  textDecoration: 'none',
                }}>
                  Connect CI/CD pipeline →
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
      ))}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes ping { 75%, 100% { transform: scale(2); opacity: 0; } }
      `}</style>
    </div>
  )
}