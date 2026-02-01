'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, FileText, Activity } from 'lucide-react'
import { useDemoMode } from '@/components/demo/demo-mode-toggle'
import { DeploymentIntegrations } from '@/components/deployments/DeploymentIntegrations'
import { DeploymentTimelinePreview } from '@/components/deployments/DeploymentTimelinePreview'
import { DORAMetricsPreview } from '@/components/deployments/DORAMetricsPreview'
import { DeploymentSetupChecklist } from '@/components/deployments/DeploymentSetupChecklist'
import { DeploymentBenefits } from '@/components/deployments/DeploymentBenefits'
import { DeploymentAPIExample } from '@/components/deployments/DeploymentAPIExample'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { deploymentsService } from '@/lib/services/deployments.service'
import type { Deployment, DeploymentEnvironment, DeploymentStatus } from '@/lib/types'
import { useWebSocket } from '@/lib/hooks/useWebSocket'

type EnvironmentFilter = 'all' | DeploymentEnvironment

function TableSkeleton() {
  return (
    <div className="border rounded-lg">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Service</TableHead>
            <TableHead>Environment</TableHead>
            <TableHead>Region</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Cost Estimate</TableHead>
            <TableHead>Deployed By</TableHead>
            <TableHead>Deployed At</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...Array(5)].map((_, i) => (
            <TableRow key={i}>
              <TableCell><Skeleton className="h-4 w-32" /></TableCell>
              <TableCell><Skeleton className="h-6 w-24" /></TableCell>
              <TableCell><Skeleton className="h-4 w-20" /></TableCell>
              <TableCell><Skeleton className="h-6 w-20" /></TableCell>
              <TableCell><Skeleton className="h-4 w-16" /></TableCell>
              <TableCell><Skeleton className="h-4 w-40" /></TableCell>
              <TableCell><Skeleton className="h-4 w-28" /></TableCell>
              <TableCell><Skeleton className="h-8 w-24" /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center p-12 space-y-4 border rounded-lg bg-red-50">
      <AlertCircle className="h-8 w-8 text-red-600" />
      <div className="text-center">
        <h3 className="text-lg font-semibold text-red-900">Error Loading Deployments</h3>
        <p className="text-sm text-red-700 mt-1">{message}</p>
      </div>
      <Button onClick={onRetry} variant="outline">
        Try Again
      </Button>
    </div>
  )
}

// EmptyState component now imported from onboarding

export default function DeploymentsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { socket } = useWebSocket()
  const queryClient = useQueryClient()
  const demoMode = useDemoMode()

  // Initialize from URL params
  const [environmentFilter, setEnvironmentFilter] = useState<EnvironmentFilter>(
    (searchParams.get('environment') as EnvironmentFilter) || 'all'
  )

  // Sync URL params to state
  useEffect(() => {
    const urlEnv = searchParams.get('environment') as EnvironmentFilter
    if (urlEnv && urlEnv !== environmentFilter) {
      setEnvironmentFilter(urlEnv)
    }
  }, [searchParams])

  // Update URL when filter changes
  const handleFilterChange = (filter: EnvironmentFilter) => {
    setEnvironmentFilter(filter)

    const params = new URLSearchParams(searchParams.toString())
    if (filter === 'all') {
      params.delete('environment')
    } else {
      params.set('environment', filter)
    }

    const queryString = params.toString()
    router.push(`/deployments${queryString ? `?${queryString}` : ''}`)
  }

  const { data: deployments = [], isLoading, error, refetch } = useQuery({
    queryKey: ['deployments', environmentFilter],
    queryFn: async () => {
      const allDeployments = await deploymentsService.getAll()
      return environmentFilter === 'all'
        ? allDeployments
        : allDeployments.filter(d => d.environment === environmentFilter)
    },
  })

  // WebSocket event listeners for real-time updates
  useEffect(() => {
    if (!socket) return

    console.log('📡 Deployments: Setting up WebSocket listeners...')

    // Refresh deployments list on any deployment event
    socket.on('deployment:started', () => {
      console.log('🚀 Deployment started - refreshing list')
      queryClient.invalidateQueries({ queryKey: ['deployments'] })
    })

    socket.on('deployment:status', () => {
      console.log('🔄 Deployment status changed - refreshing list')
      queryClient.invalidateQueries({ queryKey: ['deployments'] })
    })

    socket.on('deployment:completed', () => {
      console.log('✅ Deployment completed - refreshing list')
      queryClient.invalidateQueries({ queryKey: ['deployments'] })
    })

    // Cleanup listeners on unmount
    return () => {
      console.log('🧹 Deployments: Cleaning up WebSocket listeners...')
      socket.off('deployment:started')
      socket.off('deployment:status')
      socket.off('deployment:completed')
    }
  }, [socket, queryClient])

  const getStatusBadge = (status: DeploymentStatus) => {
    const variants = {
      running: 'bg-green-100 text-green-700 border-green-200',
      stopped: 'bg-gray-100 text-gray-700 border-gray-200',
      deploying: 'bg-blue-100 text-blue-700 border-blue-200',
      failed: 'bg-red-100 text-red-700 border-red-200',
    }
    return (
      <Badge className={`${variants[status]} border`}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    )
  }

  const getEnvironmentBadge = (environment: DeploymentEnvironment) => {
    const variants = {
      production: 'bg-purple-100 text-purple-700 border-purple-200',
      staging: 'bg-yellow-100 text-yellow-700 border-yellow-200',
      development: 'bg-blue-100 text-blue-700 border-blue-200',
    }
    return (
      <Badge className={`${variants[environment]} border font-medium`}>
        {environment.charAt(0).toUpperCase() + environment.slice(1)}
      </Badge>
    )
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(amount)
  }

  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString)
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date)
  }

  return (
    <div className="space-y-6 px-4 md:px-6 lg:px-8 py-6">
      {/* Demo Mode Indicator */}
      {demoMode && (
        <div className="bg-purple-600 text-white px-4 py-3 rounded-lg text-center font-medium -mx-4 md:-mx-6 lg:-mx-8 -mt-6 mb-6">
          <div className="flex items-center justify-center gap-2">
            <Activity className="w-4 h-4 animate-pulse" />
            <span>Demo Mode Active - Showing sample deployment history</span>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Deployment History</h1>
          <p className="text-muted-foreground mt-2">
            Track all service deployments across environments
          </p>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <Select value={environmentFilter} onValueChange={handleFilterChange}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter by environment" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Environments</SelectItem>
            <SelectItem value="production">Production</SelectItem>
            <SelectItem value="staging">Staging</SelectItem>
            <SelectItem value="development">Development</SelectItem>
          </SelectContent>
        </Select>

        <div className="text-sm text-muted-foreground">
          {deployments.length} {deployments.length === 1 ? 'deployment' : 'deployments'}
        </div>
      </div>

      {isLoading ? (
        <TableSkeleton />
      ) : error ? (
        <ErrorState
          message={(error as Error).message}
          onRetry={() => refetch()}
        />
      ) : (demoMode || deployments.length === 0) ? (
        <div className="space-y-5">
          {/* Section 1: Quick Start */}
          <section className="space-y-3">
            <div className="text-center">
              <h2 className="text-xl font-bold text-gray-900">
                Track Your First Deployment
              </h2>
              <p className="text-sm text-gray-600 mt-1">
                Connect your CI/CD pipeline or use our API
              </p>
            </div>
            <DeploymentIntegrations />
          </section>

          {/* Section 2: Timeline Preview */}
          <section className="space-y-3">
            <div className="text-center">
              <h2 className="text-xl font-bold text-gray-900">
                Preview: Deployment Timeline
              </h2>
              <p className="text-sm text-gray-600 mt-1">
                Here's what your deployment feed will look like
              </p>
            </div>
            <DeploymentTimelinePreview />
          </section>

          {/* Section 3: DORA Metrics */}
          <section className="space-y-3">
            <div className="text-center">
              <h2 className="text-xl font-bold text-gray-900">
                📊 Unlock DORA Metrics
              </h2>
              <p className="text-sm text-gray-600 mt-1">
                Measure and improve your engineering velocity
              </p>
            </div>
            <DORAMetricsPreview />
          </section>

          {/* Section 4: Setup Checklist */}
          <section>
            <DeploymentSetupChecklist />
          </section>

          {/* Section 5: Benefits */}
          <section>
            <DeploymentBenefits />
          </section>

          {/* Section 6: API Example */}
          <section>
            <DeploymentAPIExample />
          </section>

          {/* Tip */}
          <section className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex gap-3">
              <div className="text-2xl">💡</div>
              <div>
                <h3 className="font-semibold text-blue-900 mb-1">Pro Tip</h3>
                <p className="text-sm text-blue-800">
                  Once you have deployments, you'll unlock DORA metrics and performance benchmarks to compare your team against industry standards.
                </p>
              </div>
            </div>
          </section>
        </div>
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service</TableHead>
                <TableHead>Environment</TableHead>
                <TableHead>Region</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Cost Estimate</TableHead>
                <TableHead>Deployed By</TableHead>
                <TableHead>Deployed At</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deployments.map((deployment) => (
                <TableRow key={deployment.id} className="cursor-pointer hover:bg-muted/50">
                  <TableCell className="font-medium">
                    {deployment.serviceName || deployment.serviceId.substring(0, 8)}
                  </TableCell>
                  <TableCell>{getEnvironmentBadge(deployment.environment)}</TableCell>
                  <TableCell className="text-sm font-mono">{deployment.awsRegion}</TableCell>
                  <TableCell>{getStatusBadge(deployment.status)}</TableCell>
                  <TableCell className="font-medium">
                    {formatCurrency(deployment.costEstimate)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {deployment.deployedBy}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDateTime(deployment.deployedAt)}
                  </TableCell>
                  <TableCell>
                    <Link href={`/deployments/${deployment.id}`}>
                      <Button variant="ghost" size="sm">
                        <FileText className="h-4 w-4 mr-2" />
                        View Logs
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
