'use client'

import { useQuery } from '@tanstack/react-query'
import { TrendingUp, TrendingDown, Users, Layers, Rocket, DollarSign, AlertCircle, FileText } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { platformStatsService } from '@/lib/services/platform-stats.service'
import { deploymentsService } from '@/lib/services/deployments.service'
import type { PlatformDashboardStats, Deployment, DeploymentStatus } from '@/lib/types'


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

// Empty State Component
function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center p-8 space-y-4">
      <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
        <FileText className="h-6 w-6 text-muted-foreground" />
      </div>
      <div className="text-center space-y-2">
        <p className="font-medium text-foreground">No data available</p>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  )
}

export default function DashboardPage() {
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
    <div className="space-y-6 px-4 md:px-6 lg:px-8">
      {/* Page Title */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-2">
          Welcome back! Here&apos;s an overview of your billing analytics.
        </p>
      </div>

      {/* Metrics Grid */}
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
            <EmptyState message="No deployments have been created yet." />
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
    </div>
  )
}