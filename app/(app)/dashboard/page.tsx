'use client'

import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { TrendingUp, TrendingDown, Users, Layers, Rocket, DollarSign, AlertCircle } from 'lucide-react'
import { OnboardingProgress } from '@/components/onboarding/progress-indicator'
import { useOnboardingStage } from '@/lib/stores/onboarding-store'
import { useDemoMode } from '@/components/demo/demo-mode-toggle'
import { useSalesDemo } from '@/lib/demo/sales-demo-data'
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
import { ValuePropCards } from '@/components/dashboard/ValuePropCards'
import { IntegrationShowcase } from '@/components/dashboard/IntegrationShowcase'
import { Testimonials } from '@/components/dashboard/Testimonials'
import { TrustIndicators } from '@/components/dashboard/TrustIndicators'
import { FinalCTA } from '@/components/dashboard/FinalCTA'
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

export default function DashboardPage() {
  const { socket, isConnected } = useWebSocket();
  const queryClient = useQueryClient();
  const demoMode = useDemoMode();
  const salesDemoMode = useSalesDemo((state) => state.enabled);
  const createServiceStage = useOnboardingStage('create_service');

  // Fetch platform dashboard stats
  const { data: stats, isLoading: statsLoading, error: statsError, refetch: refetchStats } = useQuery<PlatformDashboardStats>({
    queryKey: ['platform-dashboard-stats'],
    queryFn: platformStatsService.getDashboardStats,
  });

  // Fetch recent deployments
  const { data: deployments = [], isLoading: deploymentsLoading, error: deploymentsError, refetch: refetchDeployments } = useQuery<Deployment[]>({
    queryKey: ['recent-deployments'],
    queryFn: async () => {
      const allDeployments = await deploymentsService.getAll();
      return allDeployments.slice(0, 5); // Get latest 5
    },
  });

  // Check if it's a completely empty state (no services and step not completed) OR demo mode
  const isCompletelyEmpty = demoMode || (
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

        {/* 3. Quick Wins - Immediate benefits */}
        <section className="px-4 py-8 md:py-12 bg-white">
          <div className="mx-auto max-w-7xl">
            <QuickWins />
          </div>
        </section>

        {/* 4. Platform Preview - Visual showcase */}
        <section className="px-4">
          <PlatformPreview />
        </section>

        {/* 5. Key Features Grid - Enhanced with details */}
        <section className="px-4 py-8 md:py-12 bg-white">
          <div className="mx-auto max-w-7xl">
            <ValuePropCards />
          </div>
        </section>

        {/* 6. Integration Showcase */}
        <section className="px-4">
          <div className="mx-auto max-w-7xl">
            <IntegrationShowcase />
          </div>
        </section>

        {/* 7. Social Proof - Enhanced testimonials */}
        <section className="px-4">
          <div className="mx-auto max-w-7xl">
            <Testimonials />
          </div>
        </section>

        {/* 8. Trust Indicators - Security & compliance */}
        <section className="px-4">
          <div className="mx-auto max-w-7xl">
            <TrustIndicators />
          </div>
        </section>

        {/* 9. Final CTA - Enhanced conversion section */}
        <section>
          <FinalCTA />
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Onboarding Progress Banner - Only on Dashboard */}
      <OnboardingProgress />

      <div className="px-4 md:px-6 lg:px-8">
        {/* Page Title */}
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-2">
            {salesDemoMode
              ? 'Sales Demo View - Showcasing 26x ROI and Elite Tier Performance'
              : "Welcome back! Here's an overview of your billing analytics."}
          </p>
        {/* WebSocket Connection Status */}
        {isConnected && (
          <div className="mt-2 flex items-center gap-2 text-xs text-green-600">
            <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
            Live updates enabled
          </div>
        )}
        {salesDemoMode && (
          <div className="mt-2 flex items-center gap-2 text-xs text-purple-600 font-semibold">
            <div className="h-2 w-2 rounded-full bg-purple-500 animate-pulse" />
            Sales Demo Mode Active - Using realistic demo data
          </div>
        )}
      </div>

      {/* Sales Demo Mode: ROI Hero Section */}
      {salesDemoMode && (
        <ROIHero demoMode={salesDemoMode} />
      )}

      {/* Regular Metrics Grid (shown in both modes) */}
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
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="Total Services"
            value={stats?.totalServices ?? 0}
            change={stats?.servicesChange ?? 0}
            icon={Layers}
            loading={statsLoading}
          />
          <MetricCard
            title="Active Deployments"
            value={stats?.activeDeployments ?? 0}
            change={stats?.deploymentsChange ?? 0}
            icon={Rocket}
            loading={statsLoading}
          />
          <MetricCard
            title="Monthly AWS Cost"
            value={stats ? formatCurrency(stats.monthlyAwsCost) : '$0.00'}
            change={stats?.costChange ?? 0}
            icon={DollarSign}
            loading={statsLoading}
          />
          <MetricCard
            title="Teams"
            value={stats?.totalTeams ?? 0}
            change={stats?.teamsChange ?? 0}
            icon={Users}
            loading={statsLoading}
          />
        </div>
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
            <div className="flex flex-col items-center justify-center p-8 space-y-4">
              <Rocket className="h-12 w-12 text-muted-foreground" />
              <div className="text-center space-y-2">
                <p className="font-medium text-foreground">No deployments yet</p>
                <p className="text-sm text-muted-foreground">
                  Create a service and deploy it to see your deployment history here.
                </p>
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
                  Join hundreds of engineering teams using DevControl to save money,
                  ship faster, and reduce risk.
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