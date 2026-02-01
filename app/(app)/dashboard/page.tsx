'use client'

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { TrendingUp, TrendingDown, Users, Layers, Rocket, DollarSign, AlertCircle, Server, Shield, Activity, Database, Plus, Zap } from 'lucide-react'
import { OnboardingProgress } from '@/components/onboarding/progress-indicator'
import { useOnboardingStage } from '@/lib/stores/onboarding-store'
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
import { WelcomeHero } from '@/components/dashboard/WelcomeHero'
import { TrustedByLogos } from '@/components/dashboard/TrustedByLogos'
import { QuickWins } from '@/components/dashboard/QuickWins'
import { PlatformPreview } from '@/components/dashboard/PlatformPreview'
import { IntegrationShowcase } from '@/components/dashboard/IntegrationShowcase'
// REMOVED: Fake testimonials - legal compliance
// import { Testimonials } from '@/components/dashboard/Testimonials'
import { TrustIndicators } from '@/components/dashboard/TrustIndicators'
import { FinalCTA } from '@/components/dashboard/FinalCTA'
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
import { subDays, format } from 'date-fns'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/contexts/auth-context'
import { SectionHeader } from '@/components/dashboard/section-header'

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
          <div className="h-8 w-8 rounded-md bg-[#635BFF]/10 flex items-center justify-center">
            <Icon className="h-4 w-4 text-[#635BFF]" />
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
      <Button onClick={onRetry} variant="outline" className="border-[#635BFF] text-[#635BFF] hover:bg-[#635BFF] hover:text-white">
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
  const createServiceStage = useOnboardingStage('create_service');
  const router = useRouter();
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

  // Check if it's a completely empty state (no services and step not completed) - but NOT when demo mode is on
  const isCompletelyEmpty = !demoMode && (
    !statsLoading &&
    (stats?.totalServices === 0 || !stats) &&
    (deployments.length === 0) &&
    !createServiceStage?.completed
  );

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

  // Show high-converting empty state for first-time users
  if (isCompletelyEmpty) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-white to-gray-50">
        {/* 1. Hero Section - Clean, Weglot-inspired design */}
        <section>
          <WelcomeHero />
        </section>

        {/* 2. Social Proof - Trusted by logos */}
        <section>
          <TrustedByLogos />
        </section>

        {/* 3. Platform Preview - Feature showcase */}
        <section className="px-4">
          <PlatformPreview />
        </section>

        {/* 4. Quick Wins - Immediate benefits */}
        <section className="px-4 py-8 md:py-12 bg-white">
          <div className="mx-auto max-w-7xl">
            <QuickWins />
          </div>
        </section>

        {/* 5. Integration Showcase */}
        <section className="px-4">
          <div className="mx-auto max-w-7xl">
            <IntegrationShowcase />
          </div>
        </section>

        {/* REMOVED: 6. Social Proof - fake testimonials removed for legal compliance */}

        {/* 7. Trust Indicators - Security & compliance */}
        <section className="px-4">
          <div className="mx-auto max-w-7xl">
            <TrustIndicators />
          </div>
        </section>

        {/* 8. Final CTA - Enhanced conversion section */}
        <section>
          <FinalCTA />
        </section>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-8 md:space-y-12 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Onboarding Progress Banner - Only on Dashboard */}
      <OnboardingProgress />

      {/* Demo Mode Indicator */}
      {demoMode && !salesDemoMode && (
        <div className="bg-purple-600 text-white px-4 py-3 text-center font-medium rounded-lg">
          <div className="flex items-center justify-center gap-2">
            <Activity className="w-4 h-4 animate-pulse" />
            <span>Demo Mode Active - Showing sample data for empty states</span>
          </div>
        </div>
      )}

      <div>
        {/* Page Header - Personalized greeting with actions */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-6">
          <div className="space-y-1">
            {/* Personalized Greeting */}
            {authLoading ? (
              <Skeleton className="h-7 w-48 mb-2" />
            ) : (
              <p className="text-sm font-medium text-muted-foreground">
                {getGreeting()}, {user?.fullName?.split(' ')[0] || user?.email?.split('@')[0] || 'there'}
              </p>
            )}
            <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
            <p className="text-muted-foreground">
              {salesDemoMode
                ? 'Sales Demo View - Showcasing 26x ROI and Elite Tier Performance'
                : 'Your infrastructure at a glance'}
            </p>
            {/* Status indicators */}
            <div className="flex items-center gap-4 pt-1">
              {isConnected && (
                <div className="flex items-center gap-1.5 text-xs text-green-600">
                  <div className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                  Live updates
                </div>
              )}
              {salesDemoMode && (
                <div className="flex items-center gap-1.5 text-xs text-purple-600 font-medium">
                  <div className="h-1.5 w-1.5 rounded-full bg-purple-500 animate-pulse" />
                  Sales Demo
                </div>
              )}
            </div>
          </div>

          {/* Header Actions */}
          <div className="flex items-center gap-3 flex-shrink-0">
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

        {/* Sync Status Banner */}
        <SyncStatusBanner
          lastSynced={lastSynced}
          status={syncStatus}
          onRetry={handleRefreshDashboard}
        />

      {/* Sales Demo Mode: ROI Hero Section */}
      {salesDemoMode && (
        <ROIHero demoMode={salesDemoMode} />
      )}

      {/* Key Metrics Section */}
      <SectionHeader
        title="Key Metrics"
        description="Real-time overview of your infrastructure"
        showDivider={false}
        className="mb-6 lg:mb-8"
      />

      {statsError ? (
        <Card>
          <CardContent className="pt-6">
            <ErrorState
              message={(statsError as Error).message}
              onRetry={() => refetchStats()}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:gap-8 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          {/* Primary Metrics - Reduced from 6 to 4 */}
          <HeroMetricCard
            title="AWS Monthly Spend"
            value={stats ? formatCurrency(stats.monthlyAwsCost) : '$0.00'}
            trend={{
              value: Math.abs(stats?.costChange ?? 0),
              direction: (stats?.costChange ?? 0) >= 0 ? 'up' : 'down',
              label: 'vs last month',
            }}
            icon={DollarSign}
            loading={statsLoading}
            iconColor="text-green-600"
            iconBgColor="bg-green-100"
            status={{
              label: stats?.monthlyAwsCost && stats.monthlyAwsCost < 1500 ? 'On budget' : 'Over budget',
              variant: stats?.monthlyAwsCost && stats.monthlyAwsCost < 1500 ? 'success' : 'warning',
            }}
            trendInverted={true}
            href="/app/infrastructure"
            sparklineData={[800, 950, 1100, 1050, 1200, 1150, stats?.monthlyAwsCost ?? 1247]}
          />
          <HeroMetricCard
            title="Security Score"
            value={riskScoreData ? `${riskScoreData.current.score}/100` : '—/100'}
            trend={{
              value: Math.abs(riskScoreData?.trendPercentage ?? 0),
              direction: riskScoreData?.trend === 'improving' ? 'up' : riskScoreData?.trend === 'declining' ? 'down' : 'up',
              label: 'this period',
            }}
            icon={Shield}
            loading={riskScoreLoading}
            iconColor="text-blue-600"
            iconBgColor="bg-blue-100"
            status={{
              label: riskScoreData?.current.grade ? `Grade ${riskScoreData.current.grade}` : 'No data',
              variant: riskScoreData?.current.grade === 'A' || riskScoreData?.current.grade === 'B' ? 'success' : riskScoreData?.current.grade === 'C' ? 'warning' : 'destructive',
            }}
            href="/compliance"
            sparklineData={riskScoreData?.history?.slice(-7).map(h => h.score) ?? []}
          />
          <HeroMetricCard
            title="Active Services"
            value={stats?.totalServices ?? 0}
            trend={{
              value: Math.abs(stats?.servicesChange ?? 0),
              direction: (stats?.servicesChange ?? 0) >= 0 ? 'up' : 'down',
              label: 'this week',
            }}
            icon={Layers}
            loading={statsLoading}
            iconColor="text-blue-600"
            iconBgColor="bg-blue-100"
            status={{
              label: `${stats?.activeDeployments ?? 0} healthy`,
              variant: 'success',
            }}
            href="/app/services"
            sparklineData={[4, 5, 4, 6, 5, 7, stats?.totalServices ?? 8]}
          />
          <HeroMetricCard
            title="Active Alerts"
            value={0}
            trend={{
              value: 100,
              direction: 'down',
              label: 'resolved',
            }}
            icon={AlertCircle}
            loading={statsLoading}
            iconColor="text-blue-600"
            iconBgColor="bg-blue-100"
            status={{
              label: 'All clear',
              variant: 'success',
            }}
            href="/app/admin/alerts"
            sparklineData={[5, 4, 3, 2, 1, 1, 0]}
            trendInverted={true}
          />
        </div>
      )}

      {/* AI-Powered Cost Insights - Prominent placement after Key Metrics */}
      {/* DEBUG: Force show card - remove conditions temporarily */}
      {console.log('=== AI INSIGHT DEBUG ===', { aiInsight, aiInsightLoading, demoMode, statsError })}
      {!statsError && (
        <div className="mt-6">
          <AIInsightCard
            rootCause={aiInsight?.rootCause || 'Lambda function costs increased 23% due to higher invocation count from new marketing campaign traffic'}
            recommendation={aiInsight?.recommendation || 'Enable reserved concurrency for predictable workloads and consider Graviton2 instances for 20% cost savings'}
            estimatedSavings={aiInsight?.estimatedSavings ?? 540}
            confidence={aiInsight?.confidence || 'high'}
            isLoading={aiInsightLoading && !aiInsight}
            cached={aiInsight?.cached}
            cacheAge={aiInsight?.cacheAge}
            onViewDetails={() => {
              toast.info('Detailed cost analysis', {
                description: 'Navigate to Cost Optimization for more insights'
              });
              router.push('/app/cost-optimization');
            }}
          />
        </div>
      )}

      {/* Trends & Analytics Section */}
      <SectionHeader
        title="Trends & Analytics"
        description="Track costs and security posture over time"
        className="mb-6 lg:mb-8"
      />

      {/* Cost Breakdown BarList */}
      {!statsError && (
        <CostBreakdownBarList
          data={generateCostBreakdownData()}
          totalCost={generateCostBreakdownData().reduce((sum, item) => sum + item.value, 0)}
          isLoading={statsLoading}
          dateRange={costDateRange}
          onDateRangeChange={setCostDateRange}
          onExport={() => {
            toast.success('Exporting cost data...');
          }}
        />
      )}

      {/* Risk Score Trend Chart */}
      {!statsError && (
        <RiskScoreTrendChart
          data={riskScoreData ?? null}
          isLoading={riskScoreLoading}
          dateRange={riskScoreDateRange}
          onDateRangeChange={setRiskScoreDateRange}
        />
      )}

      {/* Insights & Activity Section */}
      <SectionHeader
        title="Insights & Activity"
        description="Recommendations and recent deployments"
        className="mb-6 lg:mb-8"
      />

      {/* Quick Insights */}
      {!statsError && (
        <QuickInsights
          insights={generateDemoInsights().filter(insight => !dismissedInsights.includes(insight.id))}
          onDismiss={(id) => setDismissedInsights([...dismissedInsights, id])}
        />
      )}

      {/* Recent Deployments Table */}
      {deploymentsLoading ? (
        <TableSkeleton />
      ) : deploymentsError ? (
        <Card>
          <CardHeader>
            <CardTitle>Recent Deployments</CardTitle>
          </CardHeader>
          <CardContent>
            <ErrorState
              message={(deploymentsError as Error).message}
              onRetry={() => refetchDeployments()}
            />
          </CardContent>
        </Card>
      ) : !deployments || deployments.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Recent Deployments</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center py-12 px-4">
              {/* Icon */}
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-blue-100 dark:bg-blue-900/20 flex items-center justify-center">
                <Rocket className="w-8 h-8 text-blue-600 dark:text-blue-400" />
              </div>

              {/* Title */}
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
                No deployments yet
              </h3>

              {/* Description */}
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-6 max-w-md mx-auto">
                Create your first service and deploy it to start tracking deployment history,
                performance metrics, and rollback capabilities.
              </p>

              {/* Primary CTA */}
              <Button
                size="lg"
                className="mb-6"
                onClick={() => router.push('/app/services')}
              >
                <Plus className="w-4 h-4 mr-2" />
                Create First Service
              </Button>

              {/* What You'll Get - 3 Benefits */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-2xl mx-auto mt-6">
                <div className="flex flex-col items-center gap-2 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                  <div className="w-8 h-8 rounded-full bg-green-100 dark:bg-green-900/20 flex items-center justify-center">
                    <Zap className="w-4 h-4 text-green-600 dark:text-green-400" />
                  </div>
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    Automated Rollbacks
                  </div>
                  <div className="text-xs text-gray-600 dark:text-gray-400 text-center">
                    Instantly revert on failures
                  </div>
                </div>

                <div className="flex flex-col items-center gap-2 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                  <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/20 flex items-center justify-center">
                    <Activity className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    Real-Time Logs
                  </div>
                  <div className="text-xs text-gray-600 dark:text-gray-400 text-center">
                    Watch deployments live
                  </div>
                </div>

                <div className="flex flex-col items-center gap-2 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                  <div className="w-8 h-8 rounded-full bg-purple-100 dark:bg-purple-900/20 flex items-center justify-center">
                    <TrendingUp className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    Performance Metrics
                  </div>
                  <div className="text-xs text-gray-600 dark:text-gray-400 text-center">
                    Track DORA metrics
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Recent Deployments</CardTitle>
            <p className="text-sm text-muted-foreground">
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
                {deployments.map((deployment) => (
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
                    <TableCell className="text-muted-foreground">
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
      )}

      {/* Infrastructure Health Section */}
      <SectionHeader
        title="Infrastructure Health"
        description="Service status and recent activity"
        className="mb-6 lg:mb-8"
      />

      {/* Two Column Layout: Service Health + Activity Feed */}
      {!statsError && (
        <div className="grid gap-8 lg:gap-12 lg:grid-cols-3">
          {/* Service Health - Takes 2 columns */}
          <div className="lg:col-span-2">
            <ServiceHealthGrid
              services={generateDemoServices()}
              isLoading={statsLoading}
              onServiceClick={(service) => {
                toast.info(`Viewing details for ${service.name}`);
              }}
            />
          </div>

          {/* Activity Feed - Takes 1 column */}
          <div className="lg:col-span-1">
            <ActivityFeed
              activities={generateDemoActivities()}
              isLoading={statsLoading}
              showFilter={true}
              onActivityClick={(activity) => {
                toast.info(`Viewing activity: ${activity.title}`);
              }}
            />
          </div>
        </div>
      )}

      {/* Performance & Optimization Section */}
      <SectionHeader
        title="Performance & Optimization"
        description="Engineering metrics and cost savings opportunities"
        className="mb-6 lg:mb-8"
      />

      {/* DORA Metrics */}
      {!statsError && (
        <DORAMetricsMini
          isLoading={statsLoading}
          onLearnMore={() => {
            window.open('https://cloud.google.com/blog/products/devops-sre/using-the-four-keys-to-measure-your-devops-performance', '_blank');
          }}
          onViewDetails={() => {
            router.push('/app/metrics/dora');
          }}
        />
      )}

      {/* Two Column Layout: Resource Distribution + Cost Optimization */}
      {!statsError && (
        <div className="grid gap-8 lg:gap-12 lg:grid-cols-2">
          <ResourceDistributionChart
            isLoading={statsLoading}
            onSegmentClick={(resource) => {
              toast.info(`Viewing ${resource.name}`);
            }}
          />
          <CostOptimizationCard
            opportunities={generateDemoCostOpportunities()}
            isLoading={statsLoading}
            currentSpend={stats?.monthlyAwsCost ?? 1247}
            onViewAll={() => {
              router.push('/app/cost-optimization');
            }}
          />
        </div>
      )}

      {/* Sales Demo Mode: Business Value Components */}
      {salesDemoMode && (
        <>
          {/* Row 1: Engineering Velocity + Cost Optimization */}
          <div className="grid gap-6 md:grid-cols-2">
            <EngineeringVelocity demoMode={salesDemoMode} />
            <CostOptimizationWins demoMode={salesDemoMode} />
          </div>

          {/* Row 2: Time Saved + Security Posture */}
          <div className="grid gap-6 md:grid-cols-2">
            <TimeSaved demoMode={salesDemoMode} />
            <SecurityPosture demoMode={salesDemoMode} />
          </div>

          {/* Row 3: Before/After Transformation (Full Width) */}
          <BeforeAfterTransformation demoMode={salesDemoMode} />

          {/* Row 4: Competitive Benchmarking (Full Width) */}
          <CompetitiveBenchmarking demoMode={salesDemoMode} />

          {/* CTA Section */}
          <Card className="border-2 border-[#635BFF] bg-gradient-to-r from-[#635BFF]/5 to-purple-50">
            <CardContent className="py-8">
              <div className="text-center space-y-4">
                <h3 className="text-2xl font-bold text-[#635BFF]">
                  Ready to achieve these results?
                </h3>
                <p className="text-muted-foreground max-w-2xl mx-auto">
                  Start optimizing your AWS infrastructure today. Average teams
                  save $2,400/month with complete cost visibility.
                </p>
                <div className="flex items-center justify-center gap-4 pt-4">
                  <Button size="lg" className="bg-[#635BFF] hover:bg-[#4f46e5]">
                    Start 14-Day Free Trial →
                  </Button>
                  <Button size="lg" variant="outline">
                    Schedule Demo Call
                  </Button>
                </div>
                <div className="flex items-center justify-center gap-6 text-sm text-muted-foreground pt-2">
                  <span className="flex items-center gap-1">
                    ✅ No credit card required
                  </span>
                  <span className="flex items-center gap-1">
                    ✅ Full feature access
                  </span>
                  <span className="flex items-center gap-1">
                    ✅ Setup assistance included
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}
      </div>
    </div>
  )
}