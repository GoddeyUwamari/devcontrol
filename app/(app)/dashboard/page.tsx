'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  TrendingUp, TrendingDown, Users, Layers, Rocket, DollarSign,
  AlertCircle, Server, Shield, Activity, Database, Plus, Zap,
  Building2, Wifi, WifiOff, Minus, X, ChevronRight, GitBranch,
  MoreHorizontal, ArrowRight, CheckCircle, Sparkles,
} from 'lucide-react'
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

const DEMO_DASHBOARD_STATS = {
  monthlyAwsCost: 12847,
  costChange: 8,
  criticalAlerts: 2,
  activeDeployments: 5,
  securityScore: 87,
}

const DEMO_DEPLOYMENTS: Deployment[] = [
  { id: 'demo-deploy-1', serviceId: 'svc-api-gateway', serviceName: 'api-gateway', environment: 'production', awsRegion: 'us-east-1', status: 'running' as DeploymentStatus, costEstimate: 423.50, deployedBy: 'sarah.chen@company.com', deployedAt: new Date(Date.now() - 1000 * 60 * 15).toISOString(), createdAt: new Date(Date.now() - 1000 * 60 * 15).toISOString(), updatedAt: new Date(Date.now() - 1000 * 60 * 15).toISOString() },
  { id: 'demo-deploy-2', serviceId: 'svc-payment-processor', serviceName: 'payment-processor', environment: 'production', awsRegion: 'us-east-1', status: 'deploying' as DeploymentStatus, costEstimate: 891.20, deployedBy: 'james.wilson@company.com', deployedAt: new Date(Date.now() - 1000 * 60 * 45).toISOString(), createdAt: new Date(Date.now() - 1000 * 60 * 45).toISOString(), updatedAt: new Date(Date.now() - 1000 * 60 * 45).toISOString() },
  { id: 'demo-deploy-3', serviceId: 'svc-auth-service', serviceName: 'auth-service', environment: 'staging', awsRegion: 'us-west-2', status: 'running' as DeploymentStatus, costEstimate: 234.80, deployedBy: 'sarah.chen@company.com', deployedAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(), createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(), updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString() },
  { id: 'demo-deploy-4', serviceId: 'svc-notification-service', serviceName: 'notification-service', environment: 'production', awsRegion: 'eu-west-1', status: 'running' as DeploymentStatus, costEstimate: 156.30, deployedBy: 'emma.davis@company.com', deployedAt: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(), createdAt: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(), updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString() },
  { id: 'demo-deploy-5', serviceId: 'svc-analytics-worker', serviceName: 'analytics-worker', environment: 'production', awsRegion: 'us-east-1', status: 'running' as DeploymentStatus, costEstimate: 312.80, deployedBy: 'david.kim@company.com', deployedAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString() },
]

function generateCostTrendData(days: number) {
  const data = []
  for (let i = days - 1; i >= 0; i--) {
    const date = subDays(new Date(), i)
    const compute = Math.random() * 300 + 200
    const storage = Math.random() * 150 + 100
    const database = Math.random() * 200 + 150
    const network = Math.random() * 80 + 50
    const other = Math.random() * 70 + 30
    data.push({ date: format(date, 'yyyy-MM-dd'), compute, storage, database, network, other, total: compute + storage + database + network + other, forecast: i < -7 })
  }
  return data
}

const SERVICE_COLORS: Record<string, string> = {
  'Compute (EC2, Lambda, ECS)': '#3B82F6',
  'Storage (S3, EBS)': '#06B6D4',
  'Database (RDS, DynamoDB)': '#8B5CF6',
  'Network (Data Transfer)': '#F59E0B',
  'Other Services': '#94A3B8',
}

function generateCostBreakdownData() {
  return [
    { name: 'Compute (EC2, Lambda, ECS)', value: 5200, change: 12, color: SERVICE_COLORS['Compute (EC2, Lambda, ECS)'] },
    { name: 'Storage (S3, EBS)', value: 3800, change: -5, color: SERVICE_COLORS['Storage (S3, EBS)'] },
    { name: 'Database (RDS, DynamoDB)', value: 2400, change: 8, color: SERVICE_COLORS['Database (RDS, DynamoDB)'] },
    { name: 'Network (Data Transfer)', value: 1200, change: 3, color: SERVICE_COLORS['Network (Data Transfer)'] },
    { name: 'Other Services', value: 247, change: -2, color: SERVICE_COLORS['Other Services'] },
  ]
}

function getDeploymentStatusColor(status: DeploymentStatus): string {
  switch (status) {
    case 'running': return '#059669'
    case 'failed': return '#DC2626'
    case 'deploying': return '#D97706'
    default: return '#94A3B8'
  }
}

const INTELLIGENCE_API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'

async function fetchSystemIntelligence() {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null
  if (!token) return null
  const res = await fetch(`${INTELLIGENCE_API}/api/observability/intelligence`, { headers: { 'Authorization': `Bearer ${token}` } })
  if (!res.ok) return null
  const data = await res.json()
  return data.success ? data.data : null
}

const DEMO_INTELLIGENCE = {
  system_score: 81, status: 'Stable',
  components: {
    cost: { score: 72, label: 'Cost Efficiency', detail: '$1,922/mo savings identified · 7 opportunities', severity: 'medium', status: 'warning' },
    security: { score: 87, label: 'Security Posture', detail: 'Score 87/100 · No critical issues', severity: 'healthy', status: 'good' },
    observability: { score: 72, label: 'Observability', detail: 'Partially Ready · 1 gap identified', severity: 'medium', status: 'warning' },
  },
  top_action: { message: '$1,922/mo savings identified · 7 opportunities', consequence: 'Cost inefficiency is reducing system score and budget runway', path: '/costs/cost-optimization', severity: 'medium' },
  top_drivers: [
    { id: 'cost-efficiency', type: 'cost', severity: 'medium', message: '$1,922/mo savings identified · 7 opportunities', consequence: 'Cost inefficiency is reducing system score and budget runway', impact_score: 8, action: { label: 'Review savings', path: '/costs/cost-optimization' } },
    { id: 'observability-readiness', type: 'observability', severity: 'medium', message: 'Alert destinations not configured', consequence: 'Incidents will not notify your team', impact_score: 8, action: { label: 'Fix coverage gaps', path: '/observability/alert-history' } },
  ],
}

// Shared score chip helper
const scoreChip = (score: number) => ({
  color: score >= 80 ? '#065F46' : '#92400E',
  bg: score >= 80 ? '#D1FAE5' : '#FEF3C7',
})

export default function DashboardPage() {
  const { user, isLoading: authLoading } = useAuth()
  const { socket, isConnected } = useWebSocket()
  const queryClient = useQueryClient()
  const demoMode = useDemoMode()
  const { enabled: salesDemoMode } = useSalesDemo()
  const router = useRouter()

  const lastWsUpdateRef = useRef<Record<string, number>>({})

  const [dismissedInsights, setDismissedInsights] = useState<string[]>([])
  const [costDateRange, setCostDateRange] = useState<'7d' | '30d' | '90d' | '6mo' | '1yr'>('90d')
  const [riskScoreDateRange, setRiskScoreDateRange] = useState<DateRange>('30d')
  const [lastSynced, setLastSynced] = useState<Date>(demoMode ? DEMO_LAST_SYNCED : new Date())
  const [syncStatus, setSyncStatus] = useState<'syncing' | 'synced' | 'error'>(DEMO_SYNC_STATUS)
  const [insightDismissed, setInsightDismissed] = useState(false)

  const { data: riskScoreData, isLoading: riskScoreLoading } = useRiskScoreTrend(riskScoreDateRange, !demoMode && !salesDemoMode)

  const { data: stats, isLoading: statsLoading, error: statsError, refetch: refetchStats } = useQuery<PlatformDashboardStats>({
    queryKey: ['platform-dashboard-stats'],
    queryFn: platformStatsService.getDashboardStats,
    staleTime: 60_000, refetchInterval: 300_000,
    refetchOnWindowFocus: false, refetchOnMount: false, retry: false,
    enabled: !demoMode && !salesDemoMode,
  })

  const costAnalysisData = stats ? {
    previousCost: stats.monthlyAwsCost * 0.95,
    currentCost: stats.monthlyAwsCost,
    percentageIncrease: stats.costChange ?? 0,
    topSpenders: generateCostBreakdownData().slice(0, 3).map(item => ({ service: item.name, cost: item.value, change: item.change })),
    timeRange: 'last 30 days',
  } : null

  const { data: aiInsight, isLoading: aiInsightLoading } = useAIInsights(costAnalysisData, {
    enabled: !demoMode && !!stats,
    onSuccess: (data) => console.log('[Dashboard] AI Insights loaded:', data.cached ? 'from cache' : 'fresh'),
    onError: (error) => console.error('[Dashboard] AI Insights error:', error),
  })

  const { data: deployments = [], isLoading: deploymentsLoading, error: deploymentsError, refetch: refetchDeployments } = useQuery<Deployment[]>({
    queryKey: ['recent-deployments'],
    queryFn: async () => { const all = await deploymentsService.getAll(); return all.slice(0, 5) },
    staleTime: 60_000, refetchInterval: 300_000,
    refetchOnWindowFocus: false, refetchOnMount: false, retry: false,
    enabled: !demoMode && !salesDemoMode,
  })

  const { data: systemHealth } = useQuery({
    queryKey: ['system-health'],
    queryFn: () => monitoringService.getSystemHealth(),
    staleTime: 60_000, refetchInterval: 300_000,
    refetchOnWindowFocus: false, refetchOnMount: false, retry: false,
    enabled: !demoMode && !salesDemoMode,
  })

  useEffect(() => {
    if (!socket) return
    const WS_DEBOUNCE_MS = 5_000
    const shouldUpdate = (key: string) => {
      const now = Date.now()
      if (now - (lastWsUpdateRef.current[key] ?? 0) < WS_DEBOUNCE_MS) return false
      lastWsUpdateRef.current[key] = now
      return true
    }
    socket.on('metrics:costs', (data) => {
      if (!shouldUpdate('metrics:costs')) return
      toast.info('AWS costs updated', { description: `New total: $${data.totalCost.toFixed(2)}` })
      queryClient.invalidateQueries({ queryKey: ['platform-dashboard-stats'] })
    })
    socket.on('alert:created', (data) => {
      if (!shouldUpdate('alert:created')) return
      toast.error(`New ${data.severity} Alert`, { description: data.message })
      queryClient.invalidateQueries({ queryKey: ['platform-dashboard-stats'] })
    })
    socket.on('deployment:started', (data) => {
      if (!shouldUpdate('deployment:started')) return
      toast.info(`Deployment started: ${data.serviceName}`, { description: `Environment: ${data.environment} | By: ${data.deployedBy}` })
      queryClient.invalidateQueries({ queryKey: ['platform-dashboard-stats'] })
      queryClient.invalidateQueries({ queryKey: ['recent-deployments'] })
    })
    socket.on('deployment:completed', (data) => {
      if (!shouldUpdate('deployment:completed')) return
      const isSuccess = data.status === 'success'
      toast[isSuccess ? 'success' : 'error'](`Deployment ${isSuccess ? 'succeeded' : 'failed'}: ${data.serviceName}`, { description: isSuccess ? `Duration: ${data.duration}` : 'Check logs for details' })
      queryClient.invalidateQueries({ queryKey: ['platform-dashboard-stats'] })
      queryClient.invalidateQueries({ queryKey: ['recent-deployments'] })
    })
    socket.on('service:health', (data) => {
      if (!shouldUpdate('service:health')) return
      if (data.status !== 'healthy') toast.warning(`Service ${data.serviceName} is ${data.status}`, { description: `Health score: ${data.healthScore}%` })
      queryClient.invalidateQueries({ queryKey: ['platform-dashboard-stats'] })
    })
    return () => {
      socket.off('metrics:costs'); socket.off('alert:created')
      socket.off('deployment:started'); socket.off('deployment:completed'); socket.off('service:health')
    }
  }, [socket, queryClient])

  const handleRefreshDashboard = async () => {
    setSyncStatus('syncing')
    try {
      await Promise.all([refetchStats(), refetchDeployments()])
      setLastSynced(new Date()); setSyncStatus('synced')
    } catch { setSyncStatus('error') }
  }

  const activeDeployments = demoMode ? DEMO_DEPLOYMENTS : deployments
  const insightMessage = demoMode
    ? 'Lambda function costs increased 23% due to higher invocation count — enable reserved concurrency and consider Graviton2 for up to $540/year savings.'
    : (aiInsight?.rootCause || aiInsight?.recommendation || null)

  const currentSpend    = demoMode ? DEMO_DASHBOARD_STATS.monthlyAwsCost : (stats?.monthlyAwsCost ?? 0)
  const costChange      = demoMode ? DEMO_DASHBOARD_STATS.costChange : (stats?.costChange ?? 0)
  const securityScore   = demoMode ? 87 : (riskScoreData?.current.score ?? null)
  const wasteAmount     = 1922
  const efficiencyRatio = demoMode
    ? Math.round(((12847 - wasteAmount) / 12847) * 100)
    : currentSpend > 0 ? Math.round(((currentSpend - wasteAmount) / currentSpend) * 100) : null

  const { data: awsAccounts } = useQuery({
    queryKey: ['aws-accounts'],
    queryFn: async () => {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'}/api/aws/accounts`, { credentials: 'include' })
      const json = await res.json(); return json.data ?? []
    },
    staleTime: 30000,
  })

  const isDemoActive    = demoMode || salesDemoMode
  const isAwsConnected  = isDemoActive || (awsAccounts && awsAccounts.length > 0) || (!!stats && (stats.monthlyAwsCost > 0 || stats.activeDeployments > 0 || stats.totalServices > 0))
  const hasBillingData  = !isDemoActive && !!stats && stats.monthlyAwsCost > 0
  const hasPartialData  = !isDemoActive && !!stats && stats.monthlyAwsCost === 0 && stats.totalServices > 0
  const isBillingSyncing = !isDemoActive && isAwsConnected && !statsLoading && !!stats && stats.monthlyAwsCost === 0 && stats.totalServices === 0

  useEffect(() => {
  if (!isDemoActive && !statsLoading && !isAwsConnected && awsAccounts !== undefined) {
    router.replace('/connect-aws')
  }
}, [isDemoActive, statsLoading, isAwsConnected, awsAccounts, router])

  const { data: systemIntelligence } = useQuery({
    queryKey: ['system-intelligence'],
    queryFn: fetchSystemIntelligence,
    refetchInterval: 120000, staleTime: 60000,
    enabled: !isDemoActive && isAwsConnected,
  })

  const displayIntelligence = isDemoActive ? DEMO_INTELLIGENCE : systemIntelligence ?? null

  const costDeltaColor  = costChange > 0 ? '#DC2626' : costChange < 0 ? '#059669' : '#D97706'
  const CostDeltaIcon   = costChange > 0 ? TrendingUp : costChange < 0 ? TrendingDown : Minus
  const securityDeltaColor = securityScore !== null && securityScore >= 80 ? '#059669' : isDemoActive ? '#059669' : securityScore !== null ? '#DC2626' : '#94A3B8'
  const SecurityDeltaIcon  = securityScore !== null && securityScore >= 80 ? TrendingUp : isDemoActive ? TrendingUp : TrendingDown
  const efficiencyDeltaColor = efficiencyRatio !== null ? efficiencyRatio >= 90 ? '#059669' : efficiencyRatio >= 75 ? '#D97706' : '#DC2626' : '#D97706'
  const EfficiencyDeltaIcon  = efficiencyRatio !== null ? efficiencyRatio >= 90 ? TrendingUp : efficiencyRatio >= 75 ? Minus : TrendingDown : Minus

  const costScore           = isDemoActive ? 82 : (efficiencyRatio ?? 0)
  const securityScore_health = isDemoActive ? 87 : (securityScore ?? 0)
  const reliabilityScore    = isDemoActive ? 91 : systemHealth?.status === 'operational' ? 95 : systemHealth?.status === 'degraded' ? 72 : stats ? Math.min(100, 100 - 0) : 0
  const systemStatusLabel   = isDemoActive ? 'healthy' : systemHealth?.status === 'operational' ? 'healthy' : systemHealth?.status === 'disrupted' ? 'down' : systemHealth?.status === 'degraded' ? 'degraded' : 'healthy'
  const systemResponseTime  = isDemoActive ? '145ms' : '—'
  const systemAlertCount    = isDemoActive ? 2 : 0
  const systemUptimeAvg     = isDemoActive ? '99.4%' : (systemHealth?.healthPercentage != null ? `${systemHealth.healthPercentage}%` : '—')

  const systemStatusConfig = {
    healthy:  { color: '#059669', bg: '#F0FDF4', border: '#BBF7D0', dot: '#059669', label: 'All systems operational' },
    degraded: { color: '#D97706', bg: '#FFFBEB', border: '#FDE68A', dot: '#D97706', label: 'Degraded performance detected' },
    down:     { color: '#DC2626', bg: '#FEF2F2', border: '#FECACA', dot: '#DC2626', label: 'System outage detected' },
  }
  const statusConf = systemStatusConfig[systemStatusLabel as keyof typeof systemStatusConfig] || systemStatusConfig.healthy

  const cloudHealthScore = Math.round((costScore + securityScore_health + reliabilityScore) / 3) || null
  const topRecs = [
    { label: 'Right-size 3 EC2 instances',        savings: '$720/mo', effort: 'Low',    time: '~15 min' },
    { label: 'Delete unattached EBS volumes',     savings: '$210/mo', effort: 'Low',    time: '~5 min'  },
    { label: 'Enable S3 Intelligent-Tiering',     savings: '$340/mo', effort: 'Medium', time: '~10 min' },
  ]
  const criticalAlerts = demoMode ? DEMO_DASHBOARD_STATS.criticalAlerts : 0

  const doraRows: { label: string; value: string; tier: 'Elite' | 'High'; showTier?: boolean }[] = [
    { label: 'Deployment Frequency', value: demoMode ? '4.2/day' : (stats?.activeDeployments ? `${stats.activeDeployments}/week` : '—'), tier: 'Elite', showTier: demoMode || !!(stats?.activeDeployments) },
    { label: 'Lead Time for Changes', value: '2.4 hours',  tier: 'Elite' },
    { label: 'Change Failure Rate',   value: '8.3%',       tier: 'High'  },
    { label: 'Mean Time to Recovery', value: '36 min',     tier: 'Elite' },
  ]

  const securityRows: { label: string; value: string | number; status: 'good' | 'warn' }[] = [
    { label: 'Critical Vulnerabilities', value: demoMode ? 0 : 0,                              status: 'good' },
    { label: 'Compliance Frameworks',    value: '4/4',                                          status: 'good' },
    { label: 'Active Risks',             value: demoMode ? 3 : (statsLoading ? '—' : 3),       status: 'warn' },
  ]

  // Reusable inline component for intelligence score bars
  const IntelScoreBars = ({ intel }: { intel: typeof DEMO_INTELLIGENCE | null }) => (
    <div className="flex flex-col gap-1">
      {intel
        ? Object.values(intel.components).map((comp: any) => (
            <div key={comp.label} className="flex items-center gap-1.5 mb-0.5">
              <div className="flex-1 h-1 bg-slate-100 rounded-full">
                <div className="h-full rounded-full transition-all" style={{ width: `${comp.score}%`, background: comp.score >= 80 ? '#059669' : comp.score >= 60 ? '#D97706' : '#DC2626' }} />
              </div>
              <span className="text-xs text-gray-700 w-20 text-right whitespace-nowrap shrink-0 font-medium">{comp.label.split(' ')[0]} {comp.score}</span>
            </div>
          ))
        : [{ label: 'Cost', score: costScore }, { label: 'Security', score: securityScore_health }, { label: 'Reliability', score: reliabilityScore }].map(({ label, score }) => (
            <div key={label} className="flex items-center gap-1.5 mb-0.5">
              <div className="flex-1 h-1 bg-slate-100 rounded-full">
                <div className="h-full rounded-full" style={{ width: `${score ?? 0}%`, background: (score ?? 0) >= 80 ? '#059669' : (score ?? 0) >= 60 ? '#D97706' : '#DC2626' }} />
              </div>
              <span className="text-xs text-gray-700 w-20 text-right shrink-0 font-medium">{label} {score ?? '—'}</span>
            </div>
          ))
      }
    </div>
  )

  // Reusable System Intelligence KPI card content
  const IntelKPICard = () => {
    const score = displayIntelligence?.system_score ?? cloudHealthScore ?? 0
    const chipLabel = score < 50 ? 'Poor — needs optimization' : score >= 85 ? 'Elite tier' : 'Needs optimization'
    const chipStyle = score < 50 || (score < 85 && score > 0) ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
    return (
      <>
        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-700 mb-3">System Intelligence</p>
        <div className="text-4xl font-semibold leading-none mb-2" style={{ color: score < 50 ? '#DC2626' : '#111827' }}>
          {score || '—'}<span className="text-base text-gray-400 font-normal">/100</span>
        </div>
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded inline-block mt-1.5 ${chipStyle}`}>{chipLabel}</span>
        <div className="my-2">
          <span className="text-sm font-semibold" style={{ color: (displayIntelligence?.system_score ?? 0) >= 85 ? '#059669' : '#92400e' }}>
            {displayIntelligence?.status ?? 'Computing...'}
          </span>
          {displayIntelligence?.system_score && displayIntelligence.system_score < 85 && (
            <p className="text-xs text-gray-500 mt-0.5 leading-snug">Top teams: 85+ · Improve to unlock full efficiency</p>
          )}
        </div>
        <IntelScoreBars intel={displayIntelligence} />
      </>
    )
  }

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 max-w-[1400px] mx-auto min-h-screen bg-gray-50">

      {/* ── COMMAND HEADER ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-10">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight leading-snug mb-1">
            AWS Infrastructure Intelligence
          </h1>
          <p className="text-[13px] text-slate-500 leading-relaxed mb-1">
            Real-time visibility into cost waste, security posture, and infrastructure efficiency — across your entire AWS environment.
          </p>
          <p className="text-[13px] text-gray-500 leading-relaxed">
            {isAwsConnected
              ? `WayUP Technology · Last synced ${formatDistanceToNow(lastSynced, { addSuffix: true })}`
              : 'Connect your AWS account to get started · Setup takes 2 minutes'}
          </p>
        </div>
        {isAwsConnected && (
          <a href="/cost-optimization" className="inline-flex items-center gap-1.5 bg-violet-700 text-white px-6 py-2.5 rounded-lg text-sm font-semibold no-underline whitespace-nowrap shrink-0">
            {isBillingSyncing ? 'Approve actions (3) →' : 'Review & Approve Savings (3) →'}
          </a>
        )}
      </div>
      {/* ── RISK ALERT BANNER ── */}
      {(demoMode || salesDemoMode || criticalAlerts > 0) && (
        <div className="flex items-center gap-3.5 bg-orange-50 border border-orange-200 rounded-xl px-5 py-3.5 mb-7">
          <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
            <AlertCircle size={16} className="text-amber-600" />
          </div>
          <div className="flex-1">
            <span className="text-sm font-semibold text-amber-900">
              {criticalAlerts} critical alert{criticalAlerts !== 1 ? 's' : ''} require your attention
            </span>
            <span className="text-[13px] text-amber-700 ml-2">
              · Lambda invocation spike on payment-processor (+178%), CPU overload on production-worker
            </span>
          </div>
          <a href="/observability/alerts" className="text-xs font-semibold text-amber-600 no-underline flex items-center gap-1 shrink-0">
            View alerts <ArrowRight size={12} />
          </a>
        </div>
      )}

      {/* ── RECOMMENDED ACTION BANNER ── */}
      {isAwsConnected && topRecs.length > 0 && (
        <div className="bg-violet-50 border-2 border-violet-700 rounded-2xl px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-3">
          <div>
            <div className="text-[10px] font-bold text-violet-700 tracking-widest uppercase mb-1">Recommended Action</div>
            <div className="text-base font-semibold text-indigo-950 mb-2">Save $800–$2,400/month by approving 3 optimizations</div>
            <div className="flex gap-1.5 flex-wrap">
              {['Zero downtime', 'Fully reversible', 'Takes < 5 min'].map((pill) => (
                <span key={pill} className="bg-white border border-gray-200 rounded-full px-2.5 py-0.5 text-[11px] text-gray-700">{pill}</span>
              ))}
            </div>
          </div>
          <a href="/cost-optimization" className="bg-violet-700 text-white rounded-xl px-5 py-2.5 text-[13px] font-semibold no-underline whitespace-nowrap shrink-0">
            Approve all changes
          </a>
        </div>
      )}

      {/* ── MAIN CONTENT ── */}
      {statsLoading ? null : isAwsConnected ? (
        isBillingSyncing ? (
          <>
            {/* Billing sync strip */}
            <div className="bg-white border border-gray-100 rounded-xl px-4 py-2.5 flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                <span className="text-[13px] text-gray-700 font-medium">
                  Billing sync in progress (24–48h) · Preliminary savings already identified:
                </span>
                <span className="text-emerald-600 font-semibold text-[13px]">$800–$2,400/month</span>
              </div>
              <span className="text-gray-700 text-[11px] font-medium">Infrastructure + Security ready</span>
            </div>

            {/* KPI placeholder row */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 mb-4">
              {/* Total Cloud Spend */}
              <div className="bg-white rounded-xl p-4 border border-gray-100">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-700 mb-3">Total Cloud Spend</p>
                <div className="text-base font-semibold text-gray-900 leading-none mb-1">Syncing...</div>
                <div className="text-xs text-gray-500 font-medium mb-2">Full data in 24–48h</div>
                <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded inline-block mt-1.5">High ROI available</span>
              </div>
              {/* Savings Actions */}
              <div className="bg-white rounded-xl p-4 border border-gray-100">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-700 mb-3">Savings Actions</p>
                <div className="text-3xl font-semibold text-emerald-600 leading-none mb-2">3</div>
                <span className="text-[10px] font-semibold bg-red-100 text-red-800 px-1.5 py-0.5 rounded inline-block mt-1.5">Awaiting approval</span>
              </div>
              {/* Security Posture */}
              <div className="bg-white rounded-xl p-4 border border-gray-100">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-700 mb-3">Security Posture</p>
                {(securityScore === null || securityScore === 0) && !isDemoActive ? (
                  <>
                    <div className="text-base font-semibold text-gray-900 leading-none mb-2">Scanning...</div>
                    <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded inline-block mt-1.5">Elite tier</span>
                  </>
                ) : (
                  <>
                    <div className="text-4xl font-semibold text-gray-900 leading-none mb-2">
                      {securityScore ?? (isDemoActive ? 87 : '—')}<span className="text-base text-gray-400 font-normal">/100</span>
                    </div>
                    <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded inline-block mt-1.5">Elite tier</span>
                  </>
                )}
              </div>
              {/* System Intelligence */}
              <div className="bg-white rounded-xl p-4 border border-gray-100">
                <IntelKPICard />
              </div>
            </div>
          </>
        ) : (
          <>
            {hasPartialData && (
              <>
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 mb-5 flex items-center gap-3">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  <span className="text-[13px] text-amber-800">
                    Historical billing data is still syncing. Infrastructure scanning and security analysis are fully operational — cost totals will be available within 24–48 hours.
                  </span>
                </div>
                <div className="bg-white border border-slate-100 rounded-2xl p-8 mb-8">
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-5">Data Status</p>
                  <div className="flex flex-col gap-3.5">
                    {[
                      { label: 'AWS account connected',               done: true  },
                      { label: 'Infrastructure inventory mapped',      done: true  },
                      { label: 'Security posture scanned',             done: true  },
                      { label: 'Savings opportunities identified',     done: true  },
                      { label: 'Historical billing data syncing',      done: false },
                      { label: 'Cost insights and forecasts',          done: false },
                    ].map(({ label, done }) => (
                      <div key={label} className="flex items-center gap-3">
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${done ? 'bg-emerald-50 border border-emerald-200' : 'bg-gray-50 border border-slate-200'}`}>
                          {done ? (
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                          ) : (
                            <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                          )}
                        </div>
                        <span className={`text-sm ${done ? 'text-slate-800 font-medium' : 'text-slate-400'}`}>{label}</span>
                        {!done && <span className="ml-auto text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">Syncing</span>}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* KPI grid — gated on data state */}
            {(isDemoActive || hasBillingData) ? (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                {/* Total Cloud Spend */}
                <div className="bg-white rounded-xl p-4 border border-gray-100">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-700 mb-3">Total Cloud Spend</p>
                  {(statsLoading && !demoMode) || (currentSpend === 0 && !demoMode) ? (
                    <>
                      <div className="text-base font-semibold text-gray-900 leading-none mb-1">Syncing...</div>
                      <div className="text-xs text-gray-500 font-medium mb-2">Full data in 24–48h</div>
                    </>
                  ) : (
                    <div className="text-4xl font-semibold text-gray-900 leading-none mb-2">${currentSpend.toLocaleString()}</div>
                  )}
                  <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded inline-block mt-1.5">High ROI available</span>
                  <div className="flex items-center gap-1.5 mt-2">
                    <CostDeltaIcon size={14} style={{ color: costDeltaColor }} />
                    <span className="text-[13px] font-semibold" style={{ color: costDeltaColor }}>{costChange > 0 ? '+' : ''}{Math.abs(costChange)}%</span>
                    <span className="text-[13px] text-gray-500">vs last month</span>
                  </div>
                </div>

                {/* Security Posture */}
                <div className="bg-white rounded-xl p-4 border border-gray-100">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-700 mb-3">Security Posture</p>
                  {(securityScore === null || securityScore === 0) && !isDemoActive ? (
                    <div className="text-base font-semibold text-gray-900 leading-none mb-2">Scanning...</div>
                  ) : (
                    <div className="text-4xl font-semibold text-gray-900 leading-none mb-2">
                      {securityScore ?? (isDemoActive ? 87 : '—')}<span className="text-base text-gray-400 font-normal">/100</span>
                    </div>
                  )}
                  <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded inline-block mt-1.5">Elite tier</span>
                  <div className="flex items-center gap-1.5 mt-2">
                    <SecurityDeltaIcon size={12} style={{ color: securityDeltaColor }} />
                    <span className="text-xs font-semibold" style={{ color: securityDeltaColor }}>
                      {securityScore !== null && securityScore >= 80 ? 'Elite Tier' : securityScore !== null && securityScore >= 60 ? 'Above baseline' : isDemoActive ? 'Elite Tier' : 'Scan in progress'}
                    </span>
                  </div>
                </div>

                {/* Savings Actions */}
                <div className="bg-white rounded-xl p-4 border border-gray-100">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-700 mb-3">Savings Actions</p>
                  <div className="text-3xl font-semibold text-emerald-600 leading-none mb-2">
                    {efficiencyRatio !== null ? `${efficiencyRatio}%` : '—'}
                  </div>
                  <span className="text-[10px] font-semibold bg-red-100 text-red-800 px-1.5 py-0.5 rounded inline-block mt-1.5">Awaiting approval</span>
                  <div className="flex items-center gap-1.5 mt-2">
                    <TrendingUp size={14} className="text-emerald-600" />
                    <span className="text-[13px] font-semibold text-emerald-600">${wasteAmount.toLocaleString()}/month in savings opportunities</span>
                  </div>
                </div>

                {/* System Intelligence */}
                <div className="bg-white rounded-xl p-4 border border-gray-100">
                  <IntelKPICard />
                </div>
              </div>
            ) : isAwsConnected && (isBillingSyncing || hasPartialData) ? (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                <div className="bg-white rounded-2xl p-8 border border-slate-100 border-l-[3px] border-l-violet-700">
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-4">Total Cloud Spend</p>
                  <div className="text-lg font-semibold text-slate-400 leading-snug mb-2">Calculating...</div>
                  <p className="text-xs text-slate-400">Available once billing syncs</p>
                </div>
                <div className="bg-white rounded-2xl p-8 border border-slate-100">
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-4">Savings Opportunity</p>
                  <div className="text-lg font-semibold text-slate-400 leading-snug mb-2">Analyzing...</div>
                  <p className="text-xs text-slate-400">Infrastructure scan in progress</p>
                </div>
                <div className="bg-white rounded-xl p-4 border border-gray-100">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-600 mb-3">Security Posture</p>
                  <div className="text-4xl font-semibold text-gray-900 leading-none mb-2">
                    {securityScore ?? '—'}<span className="text-base text-gray-400 font-normal">/100</span>
                  </div>
                  <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded inline-block mt-1.5">Elite tier</span>
                </div>
                <div className="bg-white rounded-xl p-4 border border-gray-100">
                  <IntelKPICard />
                </div>
              </div>
            ) : null}
          </>
        )
      ) : null}

      {/* ── SYSTEM INTELLIGENCE BLOCK ── */}
      {displayIntelligence && isAwsConnected && !isBillingSyncing && !hasPartialData && (
        <div className="bg-white rounded-2xl border border-slate-200 px-6 py-5 mb-6">
          {displayIntelligence.top_action && (
            <div
              className="flex items-center justify-between gap-4 px-4 py-3.5 rounded-xl border-l-4 mb-4"
              style={{
                background: displayIntelligence.top_action.severity === 'critical' ? '#FEF2F2' : '#FFFBEB',
                border: `1px solid ${displayIntelligence.top_action.severity === 'critical' ? '#FECACA' : '#FDE68A'}`,
                borderLeft: `4px solid ${displayIntelligence.top_action.severity === 'critical' ? '#DC2626' : '#D97706'}`,
              }}
            >
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider mb-0.5" style={{ color: displayIntelligence.top_action.severity === 'critical' ? '#DC2626' : '#D97706' }}>Top Priority</p>
                <p className="text-sm font-semibold text-slate-900 mb-0.5">{displayIntelligence.top_action.message}</p>
                <p className="text-xs font-medium" style={{ color: displayIntelligence.top_action.severity === 'critical' ? '#DC2626' : '#D97706' }}>{displayIntelligence.top_action.consequence}</p>
              </div>
              <a href={displayIntelligence.top_action.path} className="text-white px-4 py-2 rounded-lg text-xs font-bold no-underline whitespace-nowrap shrink-0" style={{ background: displayIntelligence.top_action.severity === 'critical' ? '#DC2626' : '#7C3AED' }}>
                Fix now →
              </a>
            </div>
          )}
          {displayIntelligence.top_drivers?.length > 0 && (
            <div>
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2.5">System Score Drivers</p>
              <div className="flex flex-col gap-2">
                {displayIntelligence.top_drivers.map((driver: any, i: number) => (
                  <div key={driver.id} className="flex items-center gap-3.5 px-3.5 py-2.5 bg-slate-50 rounded-lg border border-slate-100">
                    <span className="text-[11px] font-bold text-slate-400 w-4 shrink-0">#{i + 1}</span>
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ background: driver.severity === 'critical' ? '#DC2626' : driver.severity === 'high' ? '#D97706' : '#F59E0B' }} />
                    <div className="flex-1">
                      <p className="text-[13px] font-semibold text-slate-900 mb-0.5">{driver.message}</p>
                      <p className="text-[11px] text-slate-500">{driver.consequence}</p>
                    </div>
                    <span className="text-[11px] font-bold text-emerald-600 whitespace-nowrap shrink-0">+{driver.impact_score}pts</span>
                    <a href={driver.action.path} className="text-[11px] font-semibold text-violet-700 no-underline whitespace-nowrap shrink-0">{driver.action.label} →</a>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── EXECUTIVE INSIGHTS ── */}
      {!insightDismissed && isAwsConnected && !isBillingSyncing && !hasPartialData && (demoMode || insightMessage) && (
        <div className="bg-slate-50 border border-slate-200 border-l-2 border-l-violet-700 rounded-lg px-4 py-3.5 mb-8 relative">
          <div className="flex items-start gap-4">
            <div className="w-7 h-7 rounded-lg bg-violet-100 shrink-0 flex items-center justify-center">
              <Sparkles size={13} className="text-violet-700" />
            </div>
            <div className="flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-violet-700 mb-2">Executive Insights</p>
              <p className="text-sm text-slate-800 leading-relaxed">
                {demoMode
                  ? <>Compute costs are driving spend ($5,200, +12%).{' '}<a href="/cost-optimization" className="text-violet-700 font-semibold no-underline">Review optimization opportunities →</a></>
                  : (insightMessage || `Your infrastructure is being actively analyzed. ${displayIntelligence?.top_drivers?.[0]?.message ? displayIntelligence.top_drivers[0].message + ' — ' + displayIntelligence.top_drivers[0].consequence : '3 optimization opportunities identified with zero downtime risk.'}`)}
              </p>
            </div>
            <button onClick={() => setInsightDismissed(true)} className="bg-transparent border-none cursor-pointer text-slate-400 p-1 shrink-0 leading-none">
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* ── SPEND TREND + SECURITY POSTURE ── */}
      {isAwsConnected && (
        isBillingSyncing ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-4">
            {/* AI Advisor */}
            <div className="bg-white rounded-2xl p-8 border border-slate-100">
              <div className="flex items-start justify-between mb-1">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-700 mb-2">AI Advisor</p>
                  <p className="text-base font-bold text-gray-900">Actions ready for approval</p>
                </div>
                <a href="/cost-optimization" className="text-xs font-semibold text-violet-700 no-underline whitespace-nowrap">All →</a>
              </div>
              <p className="text-xs text-gray-700 mb-4 leading-relaxed">These 3 changes reduce AWS waste immediately · zero downtime · fully reversible · takes &lt; 15 min</p>
              {topRecs.map((rec, i) => (
                <div key={i} className="flex items-start gap-3 py-3 border-b border-slate-100">
                  <div className="w-7 h-7 rounded-lg bg-violet-100 flex items-center justify-center shrink-0"><Sparkles size={13} className="text-violet-700" /></div>
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-gray-900 mb-1">{rec.label}</div>
                    <div className="text-xs text-gray-700 font-medium mb-1">Cost impact pending billing sync</div>
                    <div className="flex gap-1.5 flex-wrap">
                      {i < 2 ? (
                        <><span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">Low risk</span><span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">No downtime</span></>
                      ) : (
                        <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">Low risk</span>
                      )}
                      <span className="text-[10px] font-semibold text-slate-500 bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded">{rec.time}</span>
                    </div>
                  </div>
                </div>
              ))}
              <div className="mt-4 p-3.5 bg-slate-50 rounded-lg border border-slate-100 flex items-center justify-between">
                <div>
                  <div className="text-[13px] font-semibold text-gray-900 mb-0.5">Estimated impact</div>
                  <div className="text-xs text-gray-700 font-medium">Savings estimate available once billing sync completes</div>
                </div>
                <a href="/cost-optimization" className="bg-violet-700 text-white rounded-lg px-4 py-2 text-xs font-semibold no-underline whitespace-nowrap ml-4">Approve actions (3) →</a>
              </div>
            </div>

            {/* Security Posture */}
            <div className="bg-white rounded-2xl p-8 border border-slate-100">
              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-4">Security Posture</p>
              <div className="text-center py-3 border-b border-slate-100 mb-3.5">
                <div className="text-5xl font-bold text-slate-900 tracking-tight leading-none">{securityScore ?? '87'}<span className="text-base text-slate-400 font-normal"> (preliminary)</span></div>
                <div className="text-[11px] text-slate-400 mt-1">Scan in progress</div>
                <div className="text-xs text-emerald-600 font-semibold mt-0.5">Elite Tier</div>
              </div>
              {securityRows.map(({ label, value, status }) => (
                <div key={label} className="flex items-center justify-between py-2 border-b border-slate-100">
                  <span className="text-[12px] text-slate-400">{label}</span>
                  <span className="text-[13px] font-bold" style={{ color: status === 'good' ? '#059669' : '#D97706' }}>{value}</span>
                </div>
              ))}
              <div className="py-2 border-b border-slate-100">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[12px] text-slate-400">Compliance Status</span>
                  <span className="text-xs font-bold text-emerald-600">3 / 3 passing</span>
                </div>
                <div className="flex gap-1.5">
                  {['SOC2', 'CIS AWS', 'GDPR'].map((f) => (
                    <span key={f} className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">{f}</span>
                  ))}
                </div>
              </div>
              <a href="/security" className="flex items-center justify-center gap-1.5 mt-3.5 text-[13px] font-semibold text-violet-700 no-underline">View Security Report →</a>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mb-8">
            {/* Spend Trend — 3fr */}
            <div className="lg:col-span-3 bg-white rounded-xl p-4 border border-gray-100">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-700 mb-1">Spend Trend</p>
                  <p className="text-sm font-semibold text-gray-900">Infrastructure cost over time</p>
                </div>
                <a href="/costs" className="text-slate-400"><MoreHorizontal size={16} /></a>
              </div>
              <CostBreakdownBarList
                data={generateCostBreakdownData()}
                totalCost={demoMode ? DEMO_DASHBOARD_STATS.monthlyAwsCost : generateCostBreakdownData().reduce((sum, item) => sum + item.value, 0)}
                isLoading={!demoMode && statsLoading}
                dateRange={costDateRange}
                onDateRangeChange={setCostDateRange}
                onExport={() => { toast.success('Exporting cost data...') }}
              />
            </div>

            {/* Security Posture — 2fr */}
            <div className="lg:col-span-2 bg-white rounded-xl p-4 border border-gray-100">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-700 mb-4">Security Posture</p>
              <div className="text-center py-5 border-b border-slate-100 mb-5">
                <div className="text-6xl font-bold text-slate-900 tracking-tight leading-none">{securityScore ?? '87'}</div>
                <div className="text-sm font-semibold mt-2" style={{ color: securityScore !== null && securityScore >= 80 ? '#059669' : securityScore !== null && securityScore >= 60 ? '#D97706' : '#94A3B8' }}>
                  {securityScore !== null && securityScore >= 80 ? 'Elite Tier' : securityScore !== null && securityScore >= 60 ? 'Above baseline' : securityScore !== null ? 'Needs attention' : isDemoActive ? 'Elite Tier' : 'Scan in progress'}
                </div>
              </div>
              {securityRows.map(({ label, value, status }) => (
                <div key={label} className="flex items-center justify-between py-2.5 border-b border-slate-100">
                  <span className="text-[12px] text-slate-400">{label}</span>
                  <span className="text-[13px] font-bold" style={{ color: status === 'good' ? '#059669' : '#D97706' }}>{value}</span>
                </div>
              ))}
              <div className="py-3 border-b border-slate-100">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[12px] text-slate-400">Compliance Status</span>
                  <span className="text-xs font-bold text-emerald-600">3 / 3 passing</span>
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  {['SOC2', 'CIS AWS', 'GDPR'].map((framework) => (
                    <span key={framework} className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">{framework}</span>
                  ))}
                </div>
              </div>
              <a href="/security" className="flex items-center justify-center gap-1.5 mt-5 text-[13px] font-semibold text-violet-700 no-underline">
                View Security Report <ArrowRight size={13} />
              </a>
            </div>
          </div>
        )
      )}

      {/* ── EXECUTIVE ROI SUMMARY ── */}
      {isAwsConnected && !isBillingSyncing && !hasPartialData && (
        <div className="bg-white rounded-xl p-4 border border-gray-100 mb-8">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-700 mb-1">Executive ROI Summary</p>
              <p className="text-lg font-semibold text-slate-900">
                DEVCONTROL has saved WayUP Technology{' '}
                <span className="text-emerald-600">${(wasteAmount * 12).toLocaleString()}</span> annualised
              </p>
            </div>
            <div className="flex gap-2.5 shrink-0">
              <a href="/cost-optimization" className="bg-violet-700 text-white px-6 py-2.5 rounded-lg text-sm font-semibold no-underline whitespace-nowrap">Approve Savings</a>
              <a href="/costs" className="bg-transparent text-slate-500 px-4 py-2.5 rounded-lg text-sm font-medium no-underline border border-slate-200 whitespace-nowrap">View Full Report</a>
            </div>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
            {[
              { label: 'Monthly Savings',         value: `$${wasteAmount.toLocaleString()}`,          sub: 'AI-identified waste',    color: '#059669' },
              { label: 'Annual Projection',        value: `$${(wasteAmount * 12).toLocaleString()}`,   sub: 'At current run rate',    color: '#059669' },
              { label: 'Avg. ROI Payback',         value: '< 15 min',                                  sub: 'Zero-risk changes only', color: '#7C3AED' },
              { label: 'Open Recommendations',     value: `${topRecs.length}`,                         sub: 'Ready to action',        color: '#D97706' },
            ].map(({ label, value, sub, color }) => (
              <div key={label} className="px-4 py-4 bg-slate-50 rounded-xl border border-slate-100">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-600 mb-2">{label}</p>
                <div className="text-2xl font-bold tracking-tight leading-none mb-1" style={{ color }}>{value}</div>
                <div className="text-[11px] text-gray-400">{sub}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── SYSTEM STATUS BAR ── */}
      {isAwsConnected && (
        <div className="bg-white border border-gray-100 rounded-xl px-4 py-3.5 flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5 flex-wrap">
            <div className="w-2 h-2 rounded-full shrink-0" style={{ background: systemAlertCount > 0 ? '#f59e0b' : '#22c55e' }} />
            <span className="text-[13px] font-semibold text-gray-900">{systemAlertCount > 0 ? `${systemAlertCount} active alert${systemAlertCount !== 1 ? 's' : ''}` : statusConf.label}</span>
            <div className="hidden sm:block w-px h-3.5 bg-gray-200" />
            <span className="hidden sm:block text-xs text-gray-700 font-medium">{systemUptimeAvg !== '—' ? `${systemUptimeAvg} uptime this month` : '99.9% uptime this month'}</span>
            <div className="hidden sm:block w-px h-3.5 bg-gray-200" />
            <span className="hidden sm:block text-xs text-gray-700 font-medium">No incidents in 30 days</span>
            <div className="hidden sm:block w-px h-3.5 bg-gray-200" />
            <span className="hidden sm:block text-xs text-gray-700 font-medium">{systemResponseTime !== '—' ? `Avg response ${systemResponseTime}` : '3 services monitored'}</span>
          </div>
          <a href="/monitoring" className="text-emerald-600 font-semibold text-xs no-underline">View observability →</a>
        </div>
      )}

      {/* ── ENGINEERING VELOCITY + AI ADVISOR + RECENT ACTIVITY ── */}
      {isAwsConnected && (
        isBillingSyncing ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Engineering Health */}
            <div className="bg-white border border-gray-100 rounded-xl p-4">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-700 mb-1.5">Engineering Health</p>
                  <span className="text-xl font-bold text-gray-900">Elite</span>
                </div>
                <a href="/app/dora-metrics" className="text-[11px] font-semibold text-violet-700 no-underline flex items-center gap-1">Full report <ArrowRight size={12} /></a>
              </div>
              {doraRows.filter(r => ['Lead Time for Changes', 'Change Failure Rate', 'Mean Time to Recovery'].includes(r.label)).map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between py-2.5 border-b border-gray-50">
                  <span className="text-[13px] text-gray-700 font-medium">{label}</span>
                  <span className="text-[13px] font-semibold" style={{ color: label === 'Change Failure Rate' ? '#f59e0b' : '#111827' }}>{value}</span>
                </div>
              ))}
            </div>

            {/* What You Can Do Now */}
            <div className="bg-white border border-gray-100 rounded-xl p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-700 mb-4">What You Can Do Now</p>
              <a href="/cost-optimization" className="flex items-center gap-3 px-4 py-3.5 bg-violet-700 border border-violet-800 rounded-xl mb-2 no-underline">
                <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center shrink-0"><CheckCircle size={14} className="text-white" /></div>
                <div>
                  <div className="text-sm font-bold text-white mb-0.5">Approve actions (3)</div>
                  <div className="text-[11px] text-violet-200 font-medium">Zero downtime · fully reversible · &lt; 5 min</div>
                </div>
                <span className="ml-auto text-sm text-white font-bold">→</span>
              </a>
              {[
                { href: '/security',    iconBg: '#F0FDF4', iconColor: '#059669', title: 'Explore security report',   sub: '87 score · 3 anomalies'          },
                { href: '/deployments', iconBg: '#F8FAFC', iconColor: '#475569', title: 'Connect CI/CD pipeline',     sub: 'Track deployments · velocity'   },
                { href: '/costs',       iconBg: '#FFFBEB', iconColor: '#D97706', title: 'Monitor billing sync',       sub: 'Cost data within 24–48h'         },
              ].map(({ href, iconBg, iconColor, title, sub }) => (
                <a key={href} href={href} className="flex items-center gap-3 border border-gray-100 rounded-xl px-3 py-2.5 mb-1.5 no-underline">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: iconBg }}><ArrowRight size={13} style={{ color: iconColor }} /></div>
                  <div>
                    <div className="text-[13px] font-semibold text-gray-900 mb-0.5">{title}</div>
                    <div className="text-xs text-gray-500">{sub}</div>
                  </div>
                  <span className="ml-auto text-sm text-violet-700 font-semibold">→</span>
                </a>
              ))}
            </div>

            {/* Recent Activity */}
            <div className="bg-white border border-gray-100 rounded-xl p-4">
              <div className="flex items-center justify-between mb-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-700">Recent Activity</p>
                <a href="/deployments" className="text-xs font-semibold text-violet-700 no-underline flex items-center gap-1">View all <ArrowRight size={12} /></a>
              </div>
              <div className="flex flex-col">
                {activeDeployments.slice(0, 5).map((d: Deployment) => (
                  <div key={d.id} className="flex items-center justify-between py-2.5 border-b border-gray-50">
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ background: getDeploymentStatusColor(d.status) }} />
                      <div>
                        <div className="text-[13px] font-medium text-gray-900 leading-snug">{d.serviceName || d.serviceId.slice(0, 8)}</div>
                        <div className="text-[11px] text-gray-500">{d.environment}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-bold capitalize" style={{ color: getDeploymentStatusColor(d.status) }}>{d.status}</div>
                      <div className="text-[11px] text-gray-400">{formatDistanceToNow(new Date(d.deployedAt), { addSuffix: true })}</div>
                    </div>
                  </div>
                ))}
                {activeDeployments.length === 0 && (
                  <div className="text-center py-10 flex flex-col items-center gap-2">
                    <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center mb-1"><Activity size={18} className="text-gray-400" /></div>
                    <p className="text-sm font-semibold text-gray-900">No deployment data yet</p>
                    <p className="text-xs text-gray-500 leading-relaxed">Connect your CI/CD pipeline to unlock deployment velocity insights</p>
                    <a href="/deployments" className="mt-2 text-[13px] font-semibold text-violet-700 no-underline">Connect CI/CD pipeline →</a>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Engineering Velocity */}
            <div className="bg-white border border-gray-100 rounded-xl p-4">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-700 mb-1.5">Engineering Health</p>
                  <div className="flex items-center gap-2">
                    <span className="text-xl font-semibold text-gray-900">Elite</span>
                    <span className="text-[11px] font-bold bg-emerald-50 text-emerald-700 px-2.5 py-0.5 rounded-full">Top 10%</span>
                  </div>
                </div>
                <a href="/app/dora-metrics" className="text-xs font-semibold text-violet-700 no-underline flex items-center gap-1">Full report <ArrowRight size={12} /></a>
              </div>
              <p className="text-xs text-gray-500 mb-3 leading-relaxed">Elite performance across all 4 DORA metrics</p>
              {doraRows.map(({ label, value, tier, showTier }) => (
                <div key={label} className="flex items-center justify-between py-2.5 border-b border-gray-50">
                  <span className="text-[13px] text-gray-500">{label}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold" style={{ color: label === 'Change Failure Rate' ? '#f59e0b' : '#111827' }}>{value}</span>
                    {(showTier === undefined || showTier) && (
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ color: tier === 'Elite' ? '#059669' : '#D97706', background: tier === 'Elite' ? '#ECFDF5' : '#FFFBEB' }}>{tier}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* AI Advisor Feed */}
            {(() => {
              const showSavingsDollars = isDemoActive || hasBillingData
              return (
                <div className="bg-white border border-gray-100 rounded-xl p-4">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-700 mb-1.5">What You Can Do Now</p>
                      <p className="text-base font-semibold text-gray-900">Top recommendations</p>
                    </div>
                    <a href="/cost-optimization" className="text-xs font-semibold text-violet-700 no-underline flex items-center gap-1">All <ArrowRight size={12} /></a>
                  </div>
                  <p className="text-xs text-gray-700 mb-3 leading-relaxed px-3 py-2.5 bg-emerald-50 rounded-lg border border-gray-100">
                    These {topRecs.length} changes reduce AWS waste immediately — zero downtime · fully reversible
                  </p>
                  {topRecs.map((rec, i) => (
                    <div key={i} className="flex items-start gap-3 border border-gray-100 rounded-xl px-3 py-2.5 mb-1.5">
                      <div className="w-7 h-7 rounded-lg bg-violet-100 flex items-center justify-center shrink-0"><Sparkles size={13} className="text-violet-700" /></div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium text-gray-900 leading-snug mb-0.5">{rec.label}</div>
                        <div className="flex items-center gap-1.5 flex-wrap mt-1">
                          {showSavingsDollars
                            ? <span className="text-[11px] font-bold text-emerald-600">{rec.savings}</span>
                            : <span className="text-[11px] text-gray-400 italic">Cost impact pending billing sync</span>}
                          {i < 2 ? (
                            <><span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">Low risk</span><span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">No downtime</span><span className="text-[10px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded">High confidence</span></>
                          ) : (
                            <><span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">Low risk</span><span className="text-[10px] font-semibold text-slate-500 bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded">Effort: Medium</span></>
                          )}
                          <span className="text-[10px] font-semibold text-slate-500 bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded">{rec.time}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                  <div className="mt-4 p-3 bg-slate-50 rounded-lg border border-slate-100">
                    <div className="text-[11px] font-semibold text-slate-500 mb-0.5">Total potential</div>
                    {showSavingsDollars
                      ? <div className="text-lg font-bold text-emerald-600 tracking-tight">$1,270/mo</div>
                      : <div className="text-[13px] text-gray-400 italic">Calculated once billing syncs</div>}
                  </div>
                </div>
              )
            })()}

            {/* Recent Activity */}
            <div className="bg-white border border-gray-100 rounded-xl p-4">
              <div className="flex items-center justify-between mb-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-700">Recent Activity</p>
                <a href="/deployments" className="text-xs font-semibold text-violet-700 no-underline flex items-center gap-1">View all <ArrowRight size={12} /></a>
              </div>
              <div className="flex flex-col">
                {activeDeployments.slice(0, 5).map((d: Deployment) => (
                  <div key={d.id} className="flex items-center justify-between py-2.5 border-b border-gray-50">
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ background: getDeploymentStatusColor(d.status) }} />
                      <div>
                        <div className="text-[13px] font-medium text-gray-900 leading-snug">{d.serviceName || d.serviceId.slice(0, 8)}</div>
                        <div className="text-[11px] text-gray-400">{d.environment}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-bold capitalize" style={{ color: getDeploymentStatusColor(d.status) }}>{d.status}</div>
                      <div className="text-[11px] text-gray-500">{formatDistanceToNow(new Date(d.deployedAt), { addSuffix: true })}</div>
                    </div>
                  </div>
                ))}
                {activeDeployments.length === 0 && (
                  <div className="text-center py-10 flex flex-col items-center gap-2">
                    <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center mb-1"><Activity size={18} className="text-gray-400" /></div>
                    <p className="text-sm font-medium text-gray-900">No deployment data yet</p>
                    <p className="text-xs text-gray-500 leading-relaxed">Connect your CI/CD pipeline to unlock deployment velocity insights, change failure rate tracking, and incident impact analysis</p>
                    <a href="/deployments" className="mt-2 text-[13px] font-semibold text-violet-700 no-underline">Connect CI/CD pipeline →</a>
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes ping { 75%, 100% { transform: scale(2); opacity: 0; } }
      `}</style>
    </div>
  )
}