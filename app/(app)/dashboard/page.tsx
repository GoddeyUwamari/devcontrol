'use client'

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { TrendingUp, TrendingDown, Users, Layers, Rocket, DollarSign, AlertCircle, Server, Shield, Activity, Database, Plus, Zap } from 'lucide-react'
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

// Helper function to get time-based greeting
function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

// Metric Card Component
function MetricCard({
  title,
  value,
  change,
  icon: Icon,
  loading,
}: {
  title: string
  value: string | number
  change: number
  icon: React.ElementType
  loading?: boolean
}) {
  const isPositive = change >= 0

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-8 w-8 rounded" />
          </div>
          <Skeleton className="h-8 w-24 mb-2" />
          <Skeleton className="h-4 w-20" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <div className="h-8 w-8 rounded-md bg-purple-100 flex items-center justify-center">
            <Icon className="h-4 w-4" style={{ color: '#7c3aed' }} />
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-2xl font-bold">{value}</p>
          <div className="flex items-center text-xs">
            {isPositive ? (
              <TrendingUp className="h-3 w-3 text-green-600 mr-1" />
            ) : (
              <TrendingDown className="h-3 w-3 text-red-600 mr-1" />
            )}
            <span className={isPositive ? 'text-green-600' : 'text-red-600'}>
              {isPositive ? '+' : ''}{change}%
            </span>
            <span className="text-muted-foreground ml-1">vs last month</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// Chart Loading Skeleton
function ChartSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-48" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-80 w-full" />
      </CardContent>
    </Card>
  )
}

// Table Loading Skeleton
function TableSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-40" />
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

// Error State Component
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center p-8 space-y-4">
      <div className="h-12 w-12 rounded-full bg-red-100 flex items-center justify-center">
        <AlertCircle className="h-6 w-6 text-red-600" />
      </div>
      <div className="text-center space-y-2">
        <p className="font-medium text-foreground">Failed to load data</p>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
      <Button onClick={onRetry} variant="outline" style={{ borderColor: '#7c3aed', color: '#7c3aed' }} className="hover:bg-purple-50">
        Try Again
      </Button>
    </div>
  )
}

// Empty State Component (deprecated - now using onboarding EmptyState)

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
      forecast: i < -7, // Last 7 days are forecast
    });
  }
  return data;
}

// Helper function to generate cost breakdown data for BarList
function generateCostBreakdownData() {
  return [
    {
      name: 'Compute (EC2, Lambda, ECS)',
      value: 5200,
      change: 12, // +12% vs last month
      color: 'blue' as const
    },
    {
      name: 'Storage (S3, EBS)',
      value: 3800,
      change: -5, // -5% vs last month
      color: 'teal' as const
    },
    {
      name: 'Database (RDS, DynamoDB)',
      value: 2400,
      change: 8,
      color: 'purple' as const
    },
    {
      name: 'Network (Data Transfer)',
      value: 1200,
      change: 3,
      color: 'amber' as const
    },
    {
      name: 'Other Services',
      value: 247,
      change: -2,
      color: 'gray' as const
    },
  ];
}

export default function DashboardPage() {
  const { user, isLoading: authLoading } = useAuth();
  const { socket, isConnected } = useWebSocket();
  const queryClient = useQueryClient();
  const demoMode = useDemoMode();
  const salesDemoMode = useSalesDemo((state) => state.enabled);
  const router = useRouter();

  // Function to exit demo mode
  const handleExitDemoMode = () => {
    localStorage.setItem('devcontrol_demo_mode', 'false');
    window.dispatchEvent(new CustomEvent('demo-mode-changed', { detail: { enabled: false } }));
  };
  const [dismissedInsights, setDismissedInsights] = useState<string[]>([]);
  const [costDateRange, setCostDateRange] = useState<'7d' | '30d' | '90d' | '6mo' | '1yr'>('90d');
  const [riskScoreDateRange, setRiskScoreDateRange] = useState<DateRange>('30d');
  const [lastSynced, setLastSynced] = useState<Date>(demoMode ? DEMO_LAST_SYNCED : new Date());
  const [syncStatus, setSyncStatus] = useState<'syncing' | 'synced' | 'error'>(DEMO_SYNC_STATUS);

  // Fetch risk score trend data
  const { data: riskScoreData, isLoading: riskScoreLoading } = useRiskScoreTrend(riskScoreDateRange);

  // Fetch platform dashboard stats
  const { data: stats, isLoading: statsLoading, error: statsError, refetch: refetchStats } = useQuery<PlatformDashboardStats>({
    queryKey: ['platform-dashboard-stats'],
    queryFn: platformStatsService.getDashboardStats,
  });

  // Fetch AI insights based on cost data (after stats are defined)
  const costAnalysisData = stats ? {
    previousCost: stats.monthlyAwsCost * 0.95, // Simulated previous cost
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
      enabled: !demoMode && !!stats, // Only fetch when not in demo mode and stats are available
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
      return allDeployments.slice(0, 5); // Get latest 5
    },
  });

  // WebSocket event listeners for real-time updates
  useEffect(() => {
    if (!socket) return;

    console.log('📡 Dashboard: Setting up WebSocket listeners...');

    // Listen for AWS cost updates
    socket.on('metrics:costs', (data) => {
      console.log('💰 Costs updated:', data);
      toast.info('AWS costs updated', {
        description: `New total: $${data.totalCost.toFixed(2)}`,
      });
      queryClient.invalidateQueries({ queryKey: ['platform-dashboard-stats'] });
    });

    // Listen for new alerts
    socket.on('alert:created', (data) => {
      console.log('🚨 New alert:', data);
      toast.error(`New ${data.severity} Alert`, {
        description: data.message,
      });
      queryClient.invalidateQueries({ queryKey: ['platform-dashboard-stats'] });
    });

    // Listen for deployment started
    socket.on('deployment:started', (data) => {
      console.log('🚀 Deployment started:', data);
      toast.info(`Deployment started: ${data.serviceName}`, {
        description: `Environment: ${data.environment} | By: ${data.deployedBy}`,
      });
      queryClient.invalidateQueries({ queryKey: ['platform-dashboard-stats'] });
      queryClient.invalidateQueries({ queryKey: ['recent-deployments'] });
    });

    // Listen for deployment completed
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

    // Listen for service health changes
    socket.on('service:health', (data) => {
      console.log('💊 Service health changed:', data);
      if (data.status !== 'healthy') {
        toast.warning(`Service ${data.serviceName} is ${data.status}`, {
          description: `Health score: ${data.healthScore}%`,
        });
      }
      queryClient.invalidateQueries({ queryKey: ['platform-dashboard-stats'] });
    });

    // Cleanup listeners on unmount
    return () => {
      console.log('🧹 Dashboard: Cleaning up WebSocket listeners...');
      socket.off('metrics:costs');
      socket.off('alert:created');
      socket.off('deployment:started');
      socket.off('deployment:completed');
      socket.off('service:health');
    };
  }, [socket, queryClient]);

  // Handle manual refresh
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

  const getDeploymentStatusBadge = (status: DeploymentStatus) => {
    const variants = {
      running: 'bg-green-100 text-green-700 hover:bg-green-100',
      stopped: 'bg-gray-100 text-gray-700 hover:bg-gray-100',
      deploying: 'bg-blue-100 text-blue-700 hover:bg-blue-100',
      failed: 'bg-red-100 text-red-700 hover:bg-red-100',
    }
    return (
      <Badge className={variants[status]} variant="secondary">
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    )
  }

  return (
    <div className="min-h-screen bg-white">
      {/* SECTION 1: HERO HEADER - Centered, Prominent */}
      <section className="relative overflow-hidden border-b border-gray-200">
        {/* Subtle gradient background */}
        <div className="absolute inset-0 bg-gradient-to-b from-purple-50/30 to-white" />

        <div className="relative max-w-7xl mx-auto px-8 py-16 text-center">
          {authLoading ? (
            <Skeleton className="h-12 w-64 mx-auto mb-4" />
          ) : (
            <h2 className="text-4xl font-bold text-gray-900 mb-3">
              {getGreeting()}, {user?.fullName?.split(' ')[0] || user?.email?.split('@')[0] || 'there'} 👋
            </h2>
          )}
          <h1 className="text-5xl md:text-6xl font-extrabold mb-4">
            <span style={{ color: '#7c3aed' }}>Dashboard</span>
          </h1>
          <p className="text-lg text-gray-600 max-w-3xl mx-auto leading-relaxed">
            {salesDemoMode
              ? 'Sales Demo View - Showcasing 26x ROI and Elite Tier Performance'
              : 'Your infrastructure at a glance - Real-time monitoring and insights'}
          </p>

          {/* Status indicators */}
          <div className="flex items-center justify-center gap-6 pt-4">
            {isConnected && (
              <div className="flex items-center gap-2 text-sm text-green-600">
                <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                Live updates
              </div>
            )}
            {salesDemoMode && (
              <div className="flex items-center gap-2 text-sm text-purple-600 font-medium">
                <div className="h-2 w-2 rounded-full bg-purple-500 animate-pulse" />
                Sales Demo Active
              </div>
            )}
            {demoMode && !salesDemoMode && (
              <div className="flex items-center gap-2 text-sm text-purple-600 font-medium">
                <Activity className="w-4 h-4 animate-pulse" />
                Demo Mode Active
              </div>
            )}
          </div>

          {/* Header Actions */}
          <div className="flex items-center justify-center gap-3 mt-6">
            <LastSynced
              timestamp={lastSynced}
              onRefresh={handleRefreshDashboard}
              autoRefresh={true}
            />
            {!statsError && (
              <QuickActions
                actions={[
                  {
                    id: 'add-service',
                    label: 'Add Service',
                    icon: Rocket,
                    onClick: () => router.push('/app/services/new'),
                    variant: 'primary',
                  },
                  {
                    id: 'scan-resources',
                    label: 'Scan AWS Resources',
                    icon: Server,
                    onClick: () => router.push('/app/infrastructure'),
                  },
                  {
                    id: 'configure-alerts',
                    label: 'Configure Alerts',
                    icon: AlertCircle,
                    onClick: () => router.push('/app/admin/alerts'),
                  },
                ]}
              />
            )}
          </div>
        </div>
      </section>

      {/* Demo Mode Banner */}
      {demoMode && !salesDemoMode && (
        <div className="max-w-7xl mx-auto px-8 pt-6">
          <DemoModeBanner onExit={handleExitDemoMode} />
        </div>
      )}

      {/* Onboarding Progress Banner */}
      <div className="max-w-7xl mx-auto px-8 pt-6">
        <OnboardingProgress />
      </div>

      {/* Sync Status Banner */}
      <div className="max-w-7xl mx-auto px-8">
        <SyncStatusBanner
          lastSynced={lastSynced}
          status={syncStatus}
          onRetry={handleRefreshDashboard}
        />
      </div>

      {/* Sales Demo Mode: ROI Hero Section */}
      {salesDemoMode && (
        <div className="max-w-7xl mx-auto px-8 py-8">
          <ROIHero demoMode={salesDemoMode} />
        </div>
      )}

      {/* SECTION 2: KEY METRICS - Clean White Cards */}
      <section className="max-w-7xl mx-auto px-8 py-12">
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Key Metrics</h2>
          <p className="text-base text-gray-600">Real-time overview of your infrastructure</p>
        </div>

        {statsError ? (
          <Card className="bg-white border border-gray-200">
            <CardContent className="pt-6">
              <ErrorState
                message={(statsError as Error).message}
                onRetry={() => refetchStats()}
              />
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* Metric Card 1: AWS Spend */}
            <Card className="bg-white border border-gray-200 rounded-xl p-8 hover:border-purple-400 transition-colors">
              <CardContent className="p-0">
                <div className="flex flex-col items-center text-center">
                  <div className="w-12 h-12 rounded-full bg-purple-100 flex items-center justify-center mb-4">
                    <DollarSign className="w-6 h-6 text-purple-600" />
                  </div>
                  <div className="text-4xl font-bold text-gray-900 mb-2">
                    {demoMode ? formatCurrency(DEMO_DASHBOARD_STATS.monthlyAwsCost) : (stats ? formatCurrency(stats.monthlyAwsCost) : '$0.00')}
                  </div>
                  <div className="text-xs uppercase tracking-wide text-gray-600 font-semibold mb-3">
                    AWS Monthly Spend
                  </div>
                  <div className="flex items-center text-sm text-green-600">
                    <TrendingUp className="w-4 h-4 mr-1" />
                    {Math.abs(demoMode ? DEMO_DASHBOARD_STATS.costChange : (stats?.costChange ?? 0))}% vs last month
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Metric Card 2: Security Score */}
            <Card className="bg-white border border-gray-200 rounded-xl p-8 hover:border-purple-400 transition-colors">
              <CardContent className="p-0">
                <div className="flex flex-col items-center text-center">
                  <div className="w-12 h-12 rounded-full bg-purple-100 flex items-center justify-center mb-4">
                    <Shield className="w-6 h-6 text-purple-600" />
                  </div>
                  <div className="text-4xl font-bold text-gray-900 mb-2">
                    {riskScoreData ? `${riskScoreData.current.score}/100` : '—/100'}
                  </div>
                  <div className="text-xs uppercase tracking-wide text-gray-600 font-semibold mb-3">
                    Security Score
                  </div>
                  <div className="flex items-center text-sm text-green-600">
                    <Shield className="w-4 h-4 mr-1" />
                    Grade {riskScoreData?.current.grade || 'N/A'}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Metric Card 3: Active Services */}
            <Card className="bg-white border border-gray-200 rounded-xl p-8 hover:border-purple-400 transition-colors">
              <CardContent className="p-0">
                <div className="flex flex-col items-center text-center">
                  <div className="w-12 h-12 rounded-full bg-purple-100 flex items-center justify-center mb-4">
                    <Layers className="w-6 h-6 text-purple-600" />
                  </div>
                  <div className="text-4xl font-bold text-gray-900 mb-2">
                    {demoMode ? DEMO_DASHBOARD_STATS.totalServices : (stats?.totalServices ?? 0)}
                  </div>
                  <div className="text-xs uppercase tracking-wide text-gray-600 font-semibold mb-3">
                    Active Services
                  </div>
                  <div className="flex items-center text-sm text-green-600">
                    <Activity className="w-4 h-4 mr-1" />
                    {demoMode ? DEMO_DASHBOARD_STATS.healthyServices : (stats?.activeDeployments ?? 0)} healthy
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Metric Card 4: Active Alerts */}
            <Card className="bg-white border border-gray-200 rounded-xl p-8 hover:border-purple-400 transition-colors">
              <CardContent className="p-0">
                <div className="flex flex-col items-center text-center">
                  <div className="w-12 h-12 rounded-full bg-purple-100 flex items-center justify-center mb-4">
                    <AlertCircle className="w-6 h-6 text-purple-600" />
                  </div>
                  <div className="text-4xl font-bold text-gray-900 mb-2">
                    {demoMode ? (DEMO_DASHBOARD_STATS.criticalAlerts + DEMO_DASHBOARD_STATS.warningAlerts) : 0}
                  </div>
                  <div className="text-xs uppercase tracking-wide text-gray-600 font-semibold mb-3">
                    Active Alerts
                  </div>
                  <div className="flex items-center text-sm text-green-600">
                    <Activity className="w-4 h-4 mr-1" />
                    {demoMode ? `${DEMO_DASHBOARD_STATS.criticalAlerts} critical` : 'All clear'}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </section>

      {/* SECTION 3: AI COST ANALYSIS - Purple Accent Card */}
      {!statsError && (demoMode || (stats && stats.totalServices > 0)) && (
        <section className="max-w-7xl mx-auto px-8 py-8">
          <Card className="bg-white border-l-4 border-l-purple-600 border-t border-r border-b border-gray-200 rounded-lg p-8 shadow-sm">
            <CardContent className="p-0">
              <div className="mb-3">
                <span className="text-xs uppercase tracking-wider text-purple-600 font-bold">
                  ✨ AI COST ANALYSIS
                </span>
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                💡 Cost Insight
              </h3>
              <p className="text-base text-gray-700 leading-relaxed mb-4">
                {aiInsight?.rootCause || 'Lambda function costs increased 23% due to higher invocation count from new marketing campaign traffic'}
              </p>
              <div className="mt-6">
                <h4 className="text-base font-semibold text-gray-900 mb-3">
                  🎯 Recommendation:
                </h4>
                <p className="text-base text-gray-700 leading-relaxed">
                  {aiInsight?.recommendation || 'Enable reserved concurrency for predictable workloads and consider Graviton2 instances for 20% cost savings'}
                </p>
              </div>
              <div className="flex items-center gap-6 mt-6 pt-6 border-t border-gray-200">
                <Button
                  variant="default"
                  className="bg-purple-600 hover:bg-purple-700 text-white"
                  onClick={() => router.push('/app/cost-optimization')}
                >
                  View Optimization Options →
                </Button>
                <div className="text-sm text-gray-500">
                  Confidence: {aiInsight?.confidence || 'high'} | Potential Savings: ${aiInsight?.estimatedSavings ?? 540}/year
                  {aiInsight?.cached && ` | Cached ${aiInsight.cacheAge}`}
                </div>
              </div>
            </CardContent>
          </Card>
        </section>
      )}

      {/* SECTION 4: INSIGHTS & ACTIVITY - Two Column */}
      {!statsError && (demoMode || (stats && stats.totalServices > 0)) && (
        <section className="max-w-7xl mx-auto px-8 py-8">
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Insights & Activity</h2>
            <p className="text-base text-gray-600">Recommendations and recent activity</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Quick Insights */}
            <Card className="bg-gray-50 border border-gray-200 rounded-xl p-6">
              <CardHeader className="p-0 mb-6">
                <CardTitle className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  🔍 Quick Insights
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="space-y-3">
                  {generateDemoInsights()
                    .filter(insight => !dismissedInsights.includes(insight.id))
                    .map((insight) => (
                      <Card
                        key={insight.id}
                        className={`bg-white border-l-4 ${
                          insight.priority === 'high' ? 'border-l-red-500' :
                          insight.priority === 'medium' ? 'border-l-orange-500' :
                          'border-l-blue-500'
                        } border-t border-r border-b border-gray-200 p-4`}
                      >
                        <CardContent className="p-0">
                          <div className="flex items-start gap-3">
                            <span className="text-xl">{insight.icon}</span>
                            <div className="flex-1">
                              <h4 className="font-semibold text-gray-900 text-sm mb-1">
                                {insight.title}
                              </h4>
                              <p className="text-sm text-gray-600">
                                {insight.description}
                              </p>
                            </div>
                            <button
                              onClick={() => setDismissedInsights([...dismissedInsights, insight.id])}
                              className="text-gray-400 hover:text-gray-600"
                            >
                              ×
                            </button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                </div>
              </CardContent>
            </Card>

            {/* Recent Activity */}
            <Card className="bg-gray-50 border border-gray-200 rounded-xl p-6">
              <CardHeader className="p-0 mb-6">
                <CardTitle className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  📋 Recent Activity
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="space-y-3">
                  {generateDemoActivities().slice(0, 5).map((activity) => {
                    // Format timestamp to relative time
                    const timestamp = activity.timestamp instanceof Date
                      ? formatDistanceToNow(activity.timestamp, { addSuffix: true })
                      : activity.timestamp;

                    return (
                      <Card
                        key={activity.id}
                        className="bg-white border border-gray-200 p-4"
                      >
                        <CardContent className="p-0">
                          <div className="text-sm text-gray-900 font-medium mb-1">
                            {activity.title}
                          </div>
                          <div className="text-xs text-gray-500">
                            {timestamp}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                  <button className="text-sm text-purple-600 hover:text-purple-700 font-medium">
                    View All Activity →
                  </button>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>
      )}

      {/* SECTION 5: COST BREAKDOWN */}
      {!statsError && (demoMode || (stats && stats.totalServices > 0)) && (
        <section className="max-w-7xl mx-auto px-8 py-8">
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">💰 AWS Cost Breakdown</h2>
          </div>
          <CostBreakdownBarList
            data={generateCostBreakdownData()}
            totalCost={demoMode ? DEMO_DASHBOARD_STATS.monthlyAwsCost : generateCostBreakdownData().reduce((sum, item) => sum + item.value, 0)}
            isLoading={!demoMode && statsLoading}
            dateRange={costDateRange}
            onDateRangeChange={setCostDateRange}
            onExport={() => {
              toast.success('Exporting cost data...');
            }}
          />
        </section>
      )}

      {/* Risk Score Trend */}
      {!statsError && (demoMode || (stats && stats.totalServices > 0)) && (
        <section className="max-w-7xl mx-auto px-8 py-8">
          <RiskScoreTrendChart
            data={riskScoreData ?? null}
            isLoading={!demoMode && riskScoreLoading}
            dateRange={riskScoreDateRange}
            onDateRangeChange={setRiskScoreDateRange}
          />
        </section>
      )}

      {/* Recent Deployments - Kept as table for now */}
      {!statsError && (demoMode || (deployments && deployments.length > 0)) && (
        <section className="max-w-7xl mx-auto px-8 py-8">
          <Card className="bg-white border border-gray-200">
            <CardHeader>
              <CardTitle>Recent Deployments</CardTitle>
              <p className="text-sm text-gray-600">
                Latest 5 deployments across all services
              </p>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Service</TableHead>
                    <TableHead>Environment</TableHead>
                    <TableHead>Region</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Deployed By</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(demoMode ? DEMO_DEPLOYMENTS : deployments).map((deployment) => (
                    <TableRow key={deployment.id}>
                      <TableCell className="font-medium">
                        {deployment.serviceName || deployment.serviceId.slice(0, 8)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {deployment.environment}
                      </TableCell>
                      <TableCell className="text-sm">{deployment.awsRegion}</TableCell>
                      <TableCell>{getDeploymentStatusBadge(deployment.status)}</TableCell>
                      <TableCell className="text-sm">{deployment.deployedBy}</TableCell>
                      <TableCell className="text-gray-600">
                        {new Date(deployment.deployedAt).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </section>
      )}

      {/* SECTION 6: DORA METRICS - Clean Cards */}
      {!statsError && (demoMode || (stats && stats.totalServices > 0)) && (
        <section className="max-w-7xl mx-auto px-8 py-12 bg-gray-50">
          <div className="mb-8 text-center">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              📊 DevOps Performance (DORA Metrics)
            </h2>
          </div>
          <DORAMetricsMini
            isLoading={!demoMode && statsLoading}
            onLearnMore={() => {
              window.open('https://cloud.google.com/blog/products/devops-sre/using-the-four-keys-to-measure-your-devops-performance', '_blank');
            }}
            onViewDetails={() => {
              router.push('/app/metrics/dora');
            }}
          />
          <p className="text-center text-base text-gray-700 mt-6">
            💡 You're in the <span className="font-bold text-purple-600">TOP 10%</span> (Elite Tier)
          </p>
        </section>
      )}

      {/* Infrastructure Health & Performance */}
      {!statsError && (demoMode || (stats && stats.totalServices > 0)) && (
        <section className="max-w-7xl mx-auto px-8 py-8">
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Infrastructure Health</h2>
            <p className="text-base text-gray-600">Service status and performance metrics</p>
          </div>
          <div className="grid gap-8 lg:gap-12 lg:grid-cols-2">
            <ServiceHealthGrid
              services={generateDemoServices()}
              isLoading={!demoMode && statsLoading}
              onServiceClick={(service) => {
                toast.info(`Viewing details for ${service.name}`);
              }}
            />
            <ResourceDistributionChart
              isLoading={!demoMode && statsLoading}
              onSegmentClick={(resource) => {
                toast.info(`Viewing ${resource.name}`);
              }}
            />
          </div>
        </section>
      )}

      {/* Cost Optimization Opportunities */}
      {!statsError && (demoMode || (stats && stats.totalServices > 0)) && (
        <section className="max-w-7xl mx-auto px-8 py-8">
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              🎯 Cost Optimization Recommendations
            </h2>
          </div>
          <CostOptimizationCard
            opportunities={generateDemoCostOpportunities()}
            isLoading={!demoMode && statsLoading}
            currentSpend={demoMode ? DEMO_DASHBOARD_STATS.monthlyAwsCost : (stats?.monthlyAwsCost ?? 1247)}
            onViewAll={() => {
              router.push('/app/cost-optimization');
            }}
          />
        </section>
      )}

      {/* Sales Demo Mode: Business Value Components */}
      {salesDemoMode && (
        <div className="max-w-7xl mx-auto px-8 py-8">
          {/* Row 1: Engineering Velocity + Cost Optimization */}
          <div className="grid gap-6 md:grid-cols-2 mb-6">
            <EngineeringVelocity demoMode={salesDemoMode} />
            <CostOptimizationWins demoMode={salesDemoMode} />
          </div>

          {/* Row 2: Time Saved + Security Posture */}
          <div className="grid gap-6 md:grid-cols-2 mb-6">
            <TimeSaved demoMode={salesDemoMode} />
            <SecurityPosture demoMode={salesDemoMode} />
          </div>

          {/* Row 3: Before/After Transformation (Full Width) */}
          <div className="mb-6">
            <BeforeAfterTransformation demoMode={salesDemoMode} />
          </div>

          {/* Row 4: Competitive Benchmarking (Full Width) */}
          <div className="mb-6">
            <CompetitiveBenchmarking demoMode={salesDemoMode} />
          </div>
        </div>
      )}

      {/* SECTION 8: HERO CTA - PURPLE GRADIENT */}
      <section className="max-w-7xl mx-auto px-8 py-12 mb-12">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-purple-600 to-purple-800 p-16 text-center shadow-xl">
          {/* Background pattern overlay */}
          <div className="absolute inset-0 opacity-10" style={{
            backgroundImage: 'linear-gradient(to right, rgba(255, 255, 255, 0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(255, 255, 255, 0.05) 1px, transparent 1px)',
            backgroundSize: '20px 20px'
          }} />

          <div className="relative z-10">
            <h2 className="text-4xl md:text-5xl font-extrabold text-white mb-6 leading-tight">
              Ready to achieve these results?
            </h2>
            <p className="text-xl text-purple-100 mb-10 max-w-3xl mx-auto leading-relaxed">
              Start optimizing your AWS infrastructure today with AI-powered
              insights and recommendations.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-8">
              <Button
                size="lg"
                className="bg-white text-purple-600 hover:bg-gray-50 font-bold text-lg px-12 py-6 h-auto rounded-xl shadow-lg hover:shadow-xl transform hover:scale-105 transition-all"
                onClick={() => router.push('/app/infrastructure')}
              >
                Connect Your AWS Account →
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="border-2 border-white text-white hover:bg-white/10 font-bold text-lg px-12 py-6 h-auto rounded-xl"
                onClick={() => router.push('/app/services')}
              >
                Schedule Demo Call
              </Button>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-purple-100">
              <div className="flex items-center gap-2">
                <Activity className="w-5 h-5" />
                <span>No credit card required</span>
              </div>
              <div className="flex items-center gap-2">
                <Activity className="w-5 h-5" />
                <span>Full feature access</span>
              </div>
              <div className="flex items-center gap-2">
                <Activity className="w-5 h-5" />
                <span>Setup assistance included</span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}