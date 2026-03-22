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
import { optimizationService } from '@/lib/services/optimization.service'
import type { CostRecommendation, RecommendationSeverity } from '@/lib/types'
import { useDemoMode } from '@/components/demo/demo-mode-toggle'
import { useSalesDemo } from '@/lib/demo/sales-demo-data'

type SeverityFilter = 'all' | RecommendationSeverity

// Extended type to carry confidence from both demo and real API
type RecWithConfidence = CostRecommendation & { confidence?: number }

// FIX 1: Enriched demo dataset
const DEMO_RECOMMENDATIONS = [
  {
    id: '1',
    severity: 'high',
    type: 'EC2',
    region: 'us-east-1',
    title: 'Oversized Instance',
    resource: 'prod-api-server-01',
    description: 'EC2 instance running at 8% average CPU over 14 days. Downsizing from m5.xlarge to m5.large would save $127/mo with no performance impact.',
    savings: 127.00,
    confidence: 94,
  },
  {
    id: '2',
    severity: 'high',
    type: 'RDS',
    region: 'us-east-1',
    title: 'Idle RDS Instance',
    resource: 'rds-analytics-staging',
    description: 'RDS instance has had 0 connections in the past 21 days. Stopping this staging instance would save $189/mo.',
    savings: 189.00,
    confidence: 97,
  },
  {
    id: '3',
    severity: 'medium',
    type: 'EBS',
    region: 'us-west-2',
    title: 'Unattached EBS Volumes',
    resource: '3 unattached volumes',
    description: '3 EBS volumes are not attached to any instance and have not been accessed in 30+ days. Deleting or snapshotting would save $67/mo.',
    savings: 67.00,
    confidence: 99,
  },
  {
    id: '4',
    severity: 'medium',
    type: 'Lambda',
    region: 'us-east-1',
    title: 'Over-provisioned Lambda Memory',
    resource: 'notification-handler-fn',
    description: 'Lambda function uses 12% of its 1024MB memory allocation. Reducing to 256MB would save $34/mo with identical performance.',
    savings: 34.00,
    confidence: 91,
  },
  {
    id: '5',
    severity: 'medium',
    type: 'EC2',
    region: 'eu-west-1',
    title: 'Old Snapshots',
    resource: '12 snapshots older than 90 days',
    description: '12 EC2 snapshots older than 90 days are consuming 2.3TB of storage. Cleanup would save $52/mo.',
    savings: 52.00,
    confidence: 88,
  },
  {
    id: '6',
    severity: 'low',
    type: 'EC2',
    region: 'us-east-1',
    title: 'Unused Elastic IPs',
    resource: '2 unassociated Elastic IPs',
    description: '2 Elastic IP addresses are allocated but not associated with any running instance.',
    savings: 14.40,
    confidence: 100,
  },
  {
    id: '7',
    severity: 'low',
    type: 'Load Balancer',
    region: 'us-west-2',
    title: 'Idle Load Balancer',
    resource: 'alb-staging-frontend',
    description: 'Application Load Balancer has had 0 healthy targets for 18 days. Deleting it would save $16/mo.',
    savings: 16.43,
    confidence: 92,
  },
]

const DEMO_STATS = {
  totalSavings: 500.83,
  activeIssues: 7,
  critical: 0,
  warnings: 2,
}

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

// Normalize DEMO_RECOMMENDATIONS into RecWithConfidence at module level
// so useState can use it as a stable initializer
const DEMO_RECS_NORMALIZED: RecWithConfidence[] = DEMO_RECOMMENDATIONS.map(d => ({
  id: d.id,
  resourceId: d.id,
  resourceName: d.resource,
  resourceType: d.type,
  issue: d.title,
  description: d.description,
  potentialSavings: d.savings,
  severity: d.severity.toUpperCase() as RecommendationSeverity,
  status: 'ACTIVE' as const,
  awsRegion: d.region,
  confidence: d.confidence,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}))

export default function RecommendationsPage() {
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  // ISSUE 1+2: mutable local state for demo recommendations so dismiss/resolve work without API calls
  const [localDemoRecs, setLocalDemoRecs] = useState<RecWithConfidence[]>(DEMO_RECS_NORMALIZED)
  const queryClient = useQueryClient()

  const demoMode = useDemoMode()
  const salesDemoMode = useSalesDemo((state) => state.enabled)
  const isDemoActive = demoMode || salesDemoMode

  // Fetch stats (real mode only)
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['cost-recommendations-stats'],
    queryFn: costRecommendationsService.getStats,
    enabled: !isDemoActive,
  })

  // Fetch recommendations (real mode only)
  const { data: allRecommendations = [], isLoading, error, refetch } = useQuery({
    queryKey: ['cost-recommendations'],
    queryFn: () => costRecommendationsService.getAll({ status: 'ACTIVE' }),
    enabled: !isDemoActive,
  })

  // FIX 3: Wire Analyze Costs to POST /api/optimizations/scan
  const handleAnalyze = async () => {
    if (isDemoActive) return
    try {
      setIsAnalyzing(true)
      const result = await optimizationService.scan()
      await Promise.all([
        refetch(),
        queryClient.invalidateQueries({ queryKey: ['cost-recommendations-stats'] }),
      ])
      toast.success(`Analysis complete — ${result.summary.totalRecommendations} recommendations found`)
    } catch {
      toast.error('Analysis failed — try again')
    } finally {
      setIsAnalyzing(false)
    }
  }

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

  // ISSUE 2: demo mode removes from local state; real mode calls API
  const handleResolve = (id: string) => {
    if (isDemoActive) {
      setLocalDemoRecs(prev => prev.filter(r => r.id !== id))
      toast.success('Recommendation marked as resolved')
      return
    }
    resolveMutation.mutate(id)
  }

  const handleDismiss = (id: string) => {
    if (isDemoActive) {
      setLocalDemoRecs(prev => prev.filter(r => r.id !== id))
      toast.success('Recommendation dismissed')
      return
    }
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

  // ISSUE 1: use localDemoRecs (mutable state) for demo mode
  const baseRecommendations: RecWithConfidence[] = isDemoActive
    ? localDemoRecs
    : (allRecommendations as RecWithConfidence[])

  const recommendations =
    severityFilter === 'all'
      ? baseRecommendations
      : baseRecommendations.filter((r) => r.severity === severityFilter)

  const showStatsLoading = !isDemoActive && statsLoading
  const showListLoading  = !isDemoActive && isLoading
  const showError        = !isDemoActive && !!error

  return (
    <div className="space-y-6 px-4 md:px-6 lg:px-8 py-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Cost Optimization</h1>
          <p className="text-muted-foreground mt-2">
            AI-powered recommendations to reduce your AWS costs
          </p>
        </div>
        {/* FIX 3: Analyze Costs wired to /api/optimizations/scan */}
        <Button
          onClick={handleAnalyze}
          disabled={isAnalyzing || isDemoActive}
          className="gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${isAnalyzing ? 'animate-spin' : ''}`} />
          {isAnalyzing ? 'Analyzing...' : 'Analyze Costs'}
        </Button>
      </div>

      {/* Stats Cards */}
      {showStatsLoading ? (
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
                {formatCurrency(isDemoActive ? DEMO_STATS.totalSavings : (stats?.totalPotentialSavings || 0))}
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
              <div className="text-2xl font-bold">
                {isDemoActive ? DEMO_STATS.activeIssues : (stats?.activeRecommendations || 0)}
              </div>
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
                {isDemoActive ? DEMO_STATS.critical : (stats?.bySeverity.high || 0)}
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
                {isDemoActive ? DEMO_STATS.warnings : (stats?.bySeverity.medium || 0)}
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
      {showListLoading ? (
        <RecommendationsSkeleton />
      ) : showError ? (
        <ErrorState message={(error as Error).message} onRetry={() => refetch()} />
      ) : recommendations.length === 0 ? (
        <EmptyState onAnalyze={handleAnalyze} isAnalyzing={isAnalyzing} />
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
                <p className="text-sm text-muted-foreground mb-1">{rec.description}</p>
                {/* FIX 4: Confidence badge */}
                {rec.confidence != null && (
                  <p style={{ fontSize: '0.75rem', color: '#6B7280', marginBottom: '16px' }}>
                    {rec.confidence}% confidence
                  </p>
                )}
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
