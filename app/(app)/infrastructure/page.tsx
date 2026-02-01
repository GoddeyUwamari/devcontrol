'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Server, AlertCircle, Database, HardDrive, Cloud, Zap, Globe, Network, RefreshCw, TrendingDown, Shield } from 'lucide-react'
import { toast } from 'sonner'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { InfrastructureStatsPreview } from '@/components/infrastructure/InfrastructureStatsPreview'
import { InfrastructureSetupSteps } from '@/components/infrastructure/InfrastructureSetupSteps'
import { InfrastructurePreview } from '@/components/infrastructure/InfrastructurePreview'
import { InfrastructureValueProps } from '@/components/infrastructure/InfrastructureValueProps'
import { InfrastructureIntegrationOptions } from '@/components/infrastructure/InfrastructureIntegrationOptions'
import { CostOptimizationPreview } from '@/components/infrastructure/CostOptimizationPreview'
import { ResourceTypePreview } from '@/components/infrastructure/ResourceTypePreview'
import { InfrastructureUseCases } from '@/components/infrastructure/InfrastructureUseCases'
import { InfrastructureFAQ } from '@/components/infrastructure/InfrastructureFAQ'
import { InfrastructureSecurityBadges } from '@/components/infrastructure/InfrastructureSecurityBadges'
import { InfrastructureTrustSection } from '@/components/infrastructure/InfrastructureTrustSection'
// REMOVED: Fake testimonials - legal compliance
// import { InfrastructureTestimonials } from '@/components/infrastructure/InfrastructureTestimonials'
import { InfrastructureMetricsBanner } from '@/components/infrastructure/InfrastructureMetricsBanner'
import { InfrastructureComparison } from '@/components/infrastructure/InfrastructureComparison'
import { RiskScoreCard } from '@/components/dashboard/risk-score-card'
import { useRiskScoreTrend } from '@/lib/hooks/useRiskScore'

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
    <div className="space-y-16">
      {/* Section 1: Stats Preview with Scenarios */}
      <InfrastructureStatsPreview />

      {/* Section 2: Metrics Banner */}
      <InfrastructureMetricsBanner />

      {/* Section 3: Security & Trust */}
      <InfrastructureSecurityBadges />

      {/* Section 4: Setup Steps */}
      <InfrastructureSetupSteps />

      {/* Section 5: Dashboard Preview */}
      <InfrastructurePreview />

      {/* Section 6: Value Props with ROI */}
      <InfrastructureValueProps />

      {/* REMOVED: Section 7: Testimonials - fake testimonials removed for legal compliance */}

      {/* Mid-Page CTA */}
      <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-lg border border-blue-500 p-10 text-center">
        <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
          Start Your Free 14-Day Trial
        </h2>
        <p className="text-lg text-blue-100 mb-8 max-w-2xl mx-auto">
          See your actual AWS costs and savings opportunities in minutes
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4 mb-6">
          <Button size="lg" variant="secondary" className="px-8 py-6 text-base font-semibold bg-white text-blue-600 hover:bg-blue-50">
            Connect AWS Account
          </Button>
          <Button size="lg" variant="outline" className="px-8 py-6 text-base font-semibold border-white text-white hover:bg-white/10">
            Schedule Demo
          </Button>
        </div>
        {/* Trust Elements */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 text-sm text-blue-100">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            <span>Read-only access to your AWS account</span>
          </div>
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            <span>3-minute setup</span>
          </div>
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            <span>Enterprise-grade security</span>
          </div>
        </div>
      </div>

      {/* Section 8: Comparison Table */}
      <InfrastructureComparison />

      {/* Section 9: Trust Section (customer logos) */}
      <InfrastructureTrustSection />

      {/* Section 10: Integration Options */}
      <InfrastructureIntegrationOptions />

      {/* Section 11: Cost Optimization */}
      <CostOptimizationPreview />

      {/* Section 12: Resource Types */}
      <ResourceTypePreview />

      {/* Section 13: Use Cases */}
      <InfrastructureUseCases />

      {/* Section 14: FAQ */}
      <InfrastructureFAQ />

      {/* Final CTA Footer */}
      <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg border border-blue-200 p-12 text-center">
        <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
          Ready to Optimize Your AWS Infrastructure?
        </h2>
        <p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto">
          Start optimizing your AWS infrastructure with complete cost visibility and control
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4 mb-6">
          <Button size="lg" className="px-8 py-6 text-base font-semibold">
            Start Free 14-Day Trial
          </Button>
          <Button size="lg" variant="outline" className="px-8 py-6 text-base font-semibold">
            Schedule Demo
          </Button>
        </div>
        {/* Trust Elements */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            <span>No credit card required</span>
          </div>
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            <span>Cancel anytime</span>
          </div>
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            <span>14-day free trial</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function InfrastructurePage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()

  // Initialize from URL params
  const [resourceFilter, setResourceFilter] = useState<ResourceFilter>(
    (searchParams.get('resourceType') as ResourceFilter) || 'all'
  )

  // Sync URL params to state
  useEffect(() => {
    const urlType = searchParams.get('resourceType') as ResourceFilter
    if (urlType && urlType !== resourceFilter) {
      setResourceFilter(urlType)
    }
  }, [searchParams])

  // Update URL when filter changes
  const handleFilterChange = (filter: ResourceFilter) => {
    setResourceFilter(filter)

    const params = new URLSearchParams(searchParams.toString())
    if (filter === 'all') {
      params.delete('resourceType')
    } else {
      params.set('resourceType', filter)
    }

    const queryString = params.toString()
    router.push(`/infrastructure${queryString ? `?${queryString}` : ''}`)
  }

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

  // Get risk score data
  const { data: riskScoreData, isLoading: riskScoreLoading } = useRiskScoreTrend('30d')

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">AWS Infrastructure</h1>
          <p className="text-base text-muted-foreground mt-2">
            Complete visibility and cost optimization for your AWS resources
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

      {/* Summary Cards Grid */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Cost Summary Card */}
        <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200">
          <CardHeader>
            <CardTitle className="text-xl flex items-center gap-2">
              <Server className="h-6 w-6 text-blue-600" />
              Total Monthly Infrastructure Cost
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl md:text-5xl font-bold text-blue-900">
              {formatCurrency(totalMonthlyCost)}
            </div>
            <p className="text-sm text-blue-700 mt-2">
              {resources.length} {resources.length === 1 ? 'resource' : 'resources'} actively tracked
            </p>
          </CardContent>
        </Card>

        {/* Risk Score Card */}
        <RiskScoreCard
          data={riskScoreData ?? null}
          isLoading={riskScoreLoading}
        />
      </div>

      <div className="flex items-center gap-4">
        <Select value={resourceFilter} onValueChange={handleFilterChange}>
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
