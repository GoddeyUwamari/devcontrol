'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Server, AlertCircle, Database, HardDrive, Cloud, Zap, Globe, Network, RefreshCw, TrendingDown } from 'lucide-react'
import { toast } from 'sonner'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Breadcrumb } from '@/components/navigation/breadcrumb'
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
import { infrastructureService } from '@/lib/services/infrastructure.service'
import { costRecommendationsService } from '@/lib/services/cost-recommendations.service'
import type { InfrastructureResource, ResourceType, ResourceStatus } from '@/lib/types'

type ResourceFilter = 'all' | ResourceType

const resourceIcons: Record<ResourceType, typeof Server> = {
  ec2: Server,
  rds: Database,
  s3: HardDrive,
  vpc: Network,
  lambda: Zap,
  cloudfront: Globe,
  elb: Cloud,
}

function TableSkeleton() {
  return (
    <div className="border rounded-lg">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Service</TableHead>
            <TableHead>Resource Type</TableHead>
            <TableHead>AWS ID</TableHead>
            <TableHead>Region</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Monthly Cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[...Array(5)].map((_, i) => (
            <TableRow key={i}>
              <TableCell><Skeleton className="h-4 w-32" /></TableCell>
              <TableCell><Skeleton className="h-6 w-24" /></TableCell>
              <TableCell><Skeleton className="h-4 w-40" /></TableCell>
              <TableCell><Skeleton className="h-4 w-20" /></TableCell>
              <TableCell><Skeleton className="h-6 w-20" /></TableCell>
              <TableCell><Skeleton className="h-4 w-16" /></TableCell>
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
        <h3 className="text-lg font-semibold text-red-900">Error Loading Infrastructure</h3>
        <p className="text-sm text-red-700 mt-1">{message}</p>
      </div>
      <Button onClick={onRetry} variant="outline">
        Try Again
      </Button>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center p-12 space-y-4 border rounded-lg">
      <Server className="h-12 w-12 text-muted-foreground" />
      <div className="text-center">
        <h3 className="text-lg font-semibold">No infrastructure resources found</h3>
        <p className="text-sm text-muted-foreground mt-1">
          AWS resources will appear here when services are deployed
        </p>
      </div>
    </div>
  )
}

export default function InfrastructurePage() {
  const [resourceFilter, setResourceFilter] = useState<ResourceFilter>('all')
  const queryClient = useQueryClient()

  const { data: resources = [], isLoading, error, refetch } = useQuery({
    queryKey: ['infrastructure', resourceFilter],
    queryFn: async () => {
      const allResources = await infrastructureService.getAll()
      // Filter out metadata records (AWS_COST_TOTAL) that aren't actual resources
      const actualResources = allResources.filter(r => (r.resourceType as string) !== 'AWS_COST_TOTAL')
      return resourceFilter === 'all'
        ? actualResources
        : actualResources.filter(r => r.resourceType === resourceFilter)
    },
  })

  // Get all resources including metadata to find AWS_COST_TOTAL for last sync timestamp
  const { data: allResourcesWithMeta = [] } = useQuery({
    queryKey: ['infrastructure-all'],
    queryFn: () => infrastructureService.getAll(),
  })

  // Get active recommendations count
  const { data: recommendationsCount = 0 } = useQuery({
    queryKey: ['cost-recommendations-count'],
    queryFn: costRecommendationsService.getActiveCount,
  })

  const totalMonthlyCost = resources.reduce((sum, r) => sum + r.costPerMonth, 0)

  // Sync AWS mutation
  const syncMutation = useMutation({
    mutationFn: infrastructureService.syncAWS,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['infrastructure'] })
      queryClient.invalidateQueries({ queryKey: ['infrastructure-all'] })
      queryClient.invalidateQueries({ queryKey: ['cost-recommendations-count'] })
      toast.success(`AWS resources synced successfully. Total cost: $${data.totalCost.toFixed(2)}`)
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to sync AWS resources')
    },
  })

  const handleSyncAWS = () => {
    syncMutation.mutate()
  }

  // Calculate last synced timestamp
  const getLastSyncedText = () => {
    const awsCostRecord = allResourcesWithMeta.find(r => (r.resourceType as string) === 'AWS_COST_TOTAL')
    if (!awsCostRecord?.updatedAt) return 'Never synced'

    const lastSynced = new Date(awsCostRecord.updatedAt)
    const now = new Date()
    const diffMinutes = Math.floor((now.getTime() - lastSynced.getTime()) / (1000 * 60))

    if (diffMinutes < 1) return 'Just now'
    if (diffMinutes < 60) return `${diffMinutes} ${diffMinutes === 1 ? 'minute' : 'minutes'} ago`

    const diffHours = Math.floor(diffMinutes / 60)
    if (diffHours < 24) return `${diffHours} ${diffHours === 1 ? 'hour' : 'hours'} ago`

    const diffDays = Math.floor(diffHours / 24)
    return `${diffDays} ${diffDays === 1 ? 'day' : 'days'} ago`
  }

  const getStatusBadge = (status: ResourceStatus) => {
    const variants = {
      running: 'bg-green-100 text-green-700 border-green-200',
      stopped: 'bg-gray-100 text-gray-700 border-gray-200',
      terminated: 'bg-red-100 text-red-700 border-red-200',
      pending: 'bg-blue-100 text-blue-700 border-blue-200',
    }
    return (
      <Badge className={`${variants[status]} border`}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    )
  }

  const getResourceTypeBadge = (resourceType: ResourceType) => {
    const Icon = resourceIcons[resourceType]
    return (
      <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-blue-50 border border-blue-200">
        <Icon className="h-4 w-4 text-blue-700" />
        <span className="text-sm font-medium text-blue-700 uppercase">{resourceType}</span>
      </div>
    )
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(amount)
  }

  return (
    <div className="space-y-6 px-4 md:px-6 lg:px-8 py-6">
      <Breadcrumb
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Infrastructure', current: true },
        ]}
      />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Infrastructure Resources</h1>
          <p className="text-muted-foreground mt-2">
            Monitor AWS resources and track monthly costs
          </p>
        </div>
        <div className="flex items-center gap-3">
          {recommendationsCount > 0 && (
            <Link href="/infrastructure/recommendations">
              <Button variant="outline" className="gap-2 relative">
                <TrendingDown className="h-4 w-4" />
                Cost Optimization
                <Badge className="ml-1 bg-orange-500 text-white hover:bg-orange-600">
                  {recommendationsCount}
                </Badge>
              </Button>
            </Link>
          )}
          <div className="flex flex-col items-end gap-2">
            <Button
              onClick={handleSyncAWS}
              disabled={syncMutation.isPending}
              className="gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
              {syncMutation.isPending ? 'Syncing...' : 'Sync AWS'}
            </Button>
            <p className="text-xs text-muted-foreground">
              Last synced: {getLastSyncedText()}
            </p>
          </div>
        </div>
      </div>

      {/* Cost Summary Card */}
      <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Server className="h-5 w-5 text-blue-600" />
            Total Monthly Cost
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-4xl font-bold text-blue-900">
            {formatCurrency(totalMonthlyCost)}
          </div>
          <p className="text-sm text-blue-700 mt-1">
            {resources.length} {resources.length === 1 ? 'resource' : 'resources'} tracked
          </p>
        </CardContent>
      </Card>

      <div className="flex items-center gap-4">
        <Select value={resourceFilter} onValueChange={(value: ResourceFilter) => setResourceFilter(value)}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Filter by type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Resources</SelectItem>
            <SelectItem value="ec2">EC2 Instances</SelectItem>
            <SelectItem value="rds">RDS Databases</SelectItem>
            <SelectItem value="s3">S3 Buckets</SelectItem>
            <SelectItem value="vpc">VPCs</SelectItem>
            <SelectItem value="lambda">Lambda Functions</SelectItem>
            <SelectItem value="cloudfront">CloudFront</SelectItem>
            <SelectItem value="elb">Load Balancers</SelectItem>
          </SelectContent>
        </Select>

        <div className="text-sm text-muted-foreground">
          {resources.length} {resources.length === 1 ? 'resource' : 'resources'}
        </div>
      </div>

      {isLoading ? (
        <TableSkeleton />
      ) : error ? (
        <ErrorState
          message={(error as Error).message}
          onRetry={() => refetch()}
        />
      ) : resources.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service</TableHead>
                <TableHead>Resource Type</TableHead>
                <TableHead>AWS ID</TableHead>
                <TableHead>Region</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Monthly Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {resources.map((resource) => (
                <TableRow key={resource.id} className="cursor-pointer hover:bg-muted/50">
                  <TableCell className="font-medium">
                    {resource.serviceName || resource.serviceId?.substring(0, 8) || 'N/A'}
                  </TableCell>
                  <TableCell>{getResourceTypeBadge(resource.resourceType)}</TableCell>
                  <TableCell className="font-mono text-sm">{resource.awsId}</TableCell>
                  <TableCell className="text-sm font-mono">{resource.awsRegion}</TableCell>
                  <TableCell>{getStatusBadge(resource.status)}</TableCell>
                  <TableCell className="font-semibold">
                    {formatCurrency(resource.costPerMonth)}
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
