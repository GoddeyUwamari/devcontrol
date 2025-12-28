'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  TrendingDown,
  AlertCircle,
  CheckCircle,
  XCircle,
  RefreshCw,
  Server,
  DollarSign,
  AlertTriangle,
  Info,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Breadcrumb } from '@/components/navigation/breadcrumb'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { costRecommendationsService } from '@/lib/services/cost-recommendations.service'
import type { CostRecommendation, RecommendationSeverity } from '@/lib/types'

type SeverityFilter = 'all' | RecommendationSeverity

function StatsSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-4">
      {[...Array(4)].map((_, i) => (
        <Card key={i}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <Skeleton className="h-4 w-24" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-3 w-32 mt-2" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function RecommendationsSkeleton() {
  return (
    <div className="space-y-4">
      {[...Array(3)].map((_, i) => (
        <Card key={i}>
          <CardHeader>
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-4 w-96 mt-2" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-4 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center p-12 space-y-4 border rounded-lg bg-red-50">
      <AlertCircle className="h-8 w-8 text-red-600" />
      <div className="text-center">
        <h3 className="text-lg font-semibold text-red-900">Error Loading Recommendations</h3>
        <p className="text-sm text-red-700 mt-1">{message}</p>
      </div>
      <Button onClick={onRetry} variant="outline">
        Try Again
      </Button>
    </div>
  )
}

function EmptyState({ onAnalyze, isAnalyzing }: { onAnalyze: () => void; isAnalyzing: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center p-12 space-y-4 border rounded-lg">
      <TrendingDown className="h-12 w-12 text-muted-foreground" />
      <div className="text-center">
        <h3 className="text-lg font-semibold">No Cost Recommendations</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Run an analysis to find cost optimization opportunities
        </p>
      </div>
      <Button onClick={onAnalyze} disabled={isAnalyzing} className="gap-2">
        <RefreshCw className={`h-4 w-4 ${isAnalyzing ? 'animate-spin' : ''}`} />
        {isAnalyzing ? 'Analyzing...' : 'Analyze AWS Resources'}
      </Button>
    </div>
  )
}

export default function RecommendationsPage() {
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all')
  const queryClient = useQueryClient()

  // Fetch stats
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['cost-recommendations-stats'],
    queryFn: costRecommendationsService.getStats,
  })

  // Fetch recommendations
  const { data: allRecommendations = [], isLoading, error, refetch } = useQuery({
    queryKey: ['cost-recommendations'],
    queryFn: () => costRecommendationsService.getAll({ status: 'ACTIVE' }),
  })

  // Filter by severity
  const recommendations =
    severityFilter === 'all'
      ? allRecommendations
      : allRecommendations.filter((r) => r.severity === severityFilter)

  // Analyze mutation
  const analyzeMutation = useMutation({
    mutationFn: costRecommendationsService.analyze,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['cost-recommendations'] })
      queryClient.invalidateQueries({ queryKey: ['cost-recommendations-stats'] })
      toast.success(
        `Analysis complete! Found ${data.recommendationsFound} recommendations with potential savings of $${data.totalPotentialSavings.toFixed(2)}/month`
      )
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to analyze AWS resources')
    },
  })

  // Resolve mutation
  const resolveMutation = useMutation({
    mutationFn: costRecommendationsService.resolve,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cost-recommendations'] })
      queryClient.invalidateQueries({ queryKey: ['cost-recommendations-stats'] })
      toast.success('Recommendation marked as resolved')
    },
    onError: () => {
      toast.error('Failed to resolve recommendation')
    },
  })

  // Dismiss mutation
  const dismissMutation = useMutation({
    mutationFn: costRecommendationsService.dismiss,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cost-recommendations'] })
      queryClient.invalidateQueries({ queryKey: ['cost-recommendations-stats'] })
      toast.success('Recommendation dismissed')
    },
    onError: () => {
      toast.error('Failed to dismiss recommendation')
    },
  })

  const handleAnalyze = () => {
    analyzeMutation.mutate()
  }

  const handleResolve = (id: string) => {
    resolveMutation.mutate(id)
  }

  const handleDismiss = (id: string) => {
    dismissMutation.mutate(id)
  }

  const getSeverityColor = (severity: RecommendationSeverity) => {
    switch (severity) {
      case 'HIGH':
        return 'bg-red-100 text-red-700 border-red-200'
      case 'MEDIUM':
        return 'bg-yellow-100 text-yellow-700 border-yellow-200'
      case 'LOW':
        return 'bg-blue-100 text-blue-700 border-blue-200'
    }
  }

  const getSeverityIcon = (severity: RecommendationSeverity) => {
    switch (severity) {
      case 'HIGH':
        return <AlertCircle className="h-4 w-4" />
      case 'MEDIUM':
        return <AlertTriangle className="h-4 w-4" />
      case 'LOW':
        return <Info className="h-4 w-4" />
    }
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
          { label: 'Infrastructure', href: '/infrastructure' },
          { label: 'Cost Recommendations', current: true },
        ]}
      />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Cost Optimization</h1>
          <p className="text-muted-foreground mt-2">
            AI-powered recommendations to reduce your AWS costs
          </p>
        </div>
        <Button
          onClick={handleAnalyze}
          disabled={analyzeMutation.isPending}
          className="gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${analyzeMutation.isPending ? 'animate-spin' : ''}`} />
          {analyzeMutation.isPending ? 'Analyzing...' : 'Analyze Costs'}
        </Button>
      </div>

      {/* Stats Cards */}
      {statsLoading ? (
        <StatsSkeleton />
      ) : (
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Savings</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                {formatCurrency(stats?.totalPotentialSavings || 0)}
              </div>
              <p className="text-xs text-muted-foreground">potential monthly savings</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Issues</CardTitle>
              <Server className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats?.activeRecommendations || 0}</div>
              <p className="text-xs text-muted-foreground">recommendations</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Critical</CardTitle>
              <AlertCircle className="h-4 w-4 text-red-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">
                {stats?.bySeverity.high || 0}
              </div>
              <p className="text-xs text-muted-foreground">high severity issues</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Warnings</CardTitle>
              <AlertTriangle className="h-4 w-4 text-yellow-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-yellow-600">
                {stats?.bySeverity.medium || 0}
              </div>
              <p className="text-xs text-muted-foreground">medium severity issues</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filter */}
      <div className="flex items-center gap-4">
        <Select
          value={severityFilter}
          onValueChange={(value: SeverityFilter) => setSeverityFilter(value)}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Filter by severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Severities</SelectItem>
            <SelectItem value="HIGH">High Severity</SelectItem>
            <SelectItem value="MEDIUM">Medium Severity</SelectItem>
            <SelectItem value="LOW">Low Severity</SelectItem>
          </SelectContent>
        </Select>

        <div className="text-sm text-muted-foreground">
          {recommendations.length} {recommendations.length === 1 ? 'recommendation' : 'recommendations'}
        </div>
      </div>

      {/* Recommendations List */}
      {isLoading ? (
        <RecommendationsSkeleton />
      ) : error ? (
        <ErrorState message={(error as Error).message} onRetry={() => refetch()} />
      ) : recommendations.length === 0 ? (
        <EmptyState onAnalyze={handleAnalyze} isAnalyzing={analyzeMutation.isPending} />
      ) : (
        <div className="space-y-4">
          {recommendations.map((rec) => (
            <Card key={rec.id} className="border-l-4" style={{
              borderLeftColor: rec.severity === 'HIGH' ? '#dc2626' : rec.severity === 'MEDIUM' ? '#ca8a04' : '#2563eb'
            }}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2">
                      <Badge className={`${getSeverityColor(rec.severity)} border gap-1`}>
                        {getSeverityIcon(rec.severity)}
                        {rec.severity}
                      </Badge>
                      <Badge variant="outline">{rec.resourceType}</Badge>
                      {rec.awsRegion && (
                        <span className="text-xs text-muted-foreground">{rec.awsRegion}</span>
                      )}
                    </div>
                    <h3 className="text-lg font-semibold">
                      {rec.issue}
                      {rec.resourceName && (
                        <span className="text-sm font-normal text-muted-foreground ml-2">
                          • {rec.resourceName}
                        </span>
                      )}
                    </h3>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-green-600">
                      {formatCurrency(rec.potentialSavings)}
                    </div>
                    <div className="text-xs text-muted-foreground">per month</div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">{rec.description}</p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => handleResolve(rec.id)}
                    disabled={resolveMutation.isPending}
                    className="gap-2"
                  >
                    <CheckCircle className="h-4 w-4" />
                    Mark as Resolved
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleDismiss(rec.id)}
                    disabled={dismissMutation.isPending}
                    className="gap-2"
                  >
                    <XCircle className="h-4 w-4" />
                    Dismiss
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
