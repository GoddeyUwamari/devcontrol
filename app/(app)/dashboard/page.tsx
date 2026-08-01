'use client'

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { OnboardingProgress } from '@/components/onboarding/progress-indicator'
import { useDemoMode } from '@/components/demo/demo-mode-toggle'
import { useSalesDemo } from '@/lib/demo/sales-demo-data'
import { LastSynced } from '@/components/ui/last-synced'
import { SyncStatusBanner } from '@/components/ui/sync-status-banner'
import { DEMO_LAST_SYNCED } from '@/lib/demo/demo-timestamps'
import { EngineeringVelocity } from '@/components/dashboard/engineering-velocity'
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
import { QuickActions } from '@/components/dashboard/quick-actions'
import { AIInsightCard } from '@/components/ai/AIInsightCard'
import { useAIInsights } from '@/lib/hooks/useAIInsights'
import { useAISummary } from '@/lib/hooks/useAISummary'
import { useActivityFeed } from '@/lib/hooks/useActivityFeed'
import type { ActivityEventType } from '@/lib/services/activity-feed.service'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { platformStatsService } from '@/lib/services/platform-stats.service'
import { monitoringService } from '@/lib/services/monitoring.service'
import type { PlatformDashboardStats } from '@/lib/types'
import { useWebSocket } from '@/lib/hooks/useWebSocket'
import { toast } from 'sonner'
import { formatDistanceToNow } from 'date-fns'
import { annualizeMonthly } from '@/lib/utils'
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

// Month-over-month cost delta, derived from the already-fetched costTrend daily series
// (no new API call). Compares this month's spend-to-date against the same number of
// days into last month, calendar-string-parsed to avoid UTC/local timezone day-shift.
// Only returns a value when both windows have enough real daily coverage to trust the
// comparison — otherwise null, so the caller can hide the line rather than fabricate it.
function computeMonthOverMonthCostChange(
  costTrend: Array<{ date: string; total: number }>
): number | null {
  if (!costTrend || costTrend.length === 0) return null

  const now = new Date()
  const curYear = now.getFullYear()
  const curMonth = now.getMonth()
  const dayOfMonth = now.getDate()
  const lastMonth = curMonth === 0 ? 11 : curMonth - 1
  const lastMonthYear = curMonth === 0 ? curYear - 1 : curYear

  let currentSum = 0, currentDays = 0
  let lastSum = 0, lastDays = 0

  for (const entry of costTrend) {
    const [y, m, d] = entry.date.split('-').map(Number)
    const month = m - 1
    if (y === curYear && month === curMonth && d <= dayOfMonth) {
      currentSum += entry.total
      currentDays++
    } else if (y === lastMonthYear && month === lastMonth && d <= dayOfMonth) {
      lastSum += entry.total
      lastDays++
    }
  }

  const minDays = Math.max(1, Math.floor(dayOfMonth * 0.8))
  if (currentDays < minDays || lastDays < minDays || lastSum <= 0) return null

  return Math.round(((currentSum - lastSum) / lastSum) * 1000) / 10
}

// Bolds dollar amounts, percentages, and X/100 scores embedded in AI summary text
// for visual scanning, without touching surrounding words. Split on a single
// capturing group so matches land at odd indices in the result array.
const KEY_NUMBER_PATTERN = /(\$\d{1,3}(?:,\d{3})*(?:\.\d+)?(?:\/(?:month|mo|year|yr))?|\d+(?:\.\d+)?%|\b\d{1,3}\/100\b)/g

function boldKeyNumbers(text: string): ReactNode {
  return text.split(KEY_NUMBER_PATTERN).map((part, i) => (i % 2 === 1 ? <strong key={i}>{part}</strong> : part))
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
  const { user, organization, isLoading: authLoading } = useAuth()
  const { socket, isConnected } = useWebSocket()
  const queryClient = useQueryClient()
  const demoMode = useDemoMode()
  const { enabled: salesDemoMode } = useSalesDemo()
  const router = useRouter()

  const lastWsUpdateRef = useRef<Record<string, number>>({})

  const [dismissedInsights, setDismissedInsights] = useState<string[]>([])
  const [costDateRange, setCostDateRange] = useState<'7d' | '30d' | '90d' | '6mo' | '1yr'>('90d')
  const [riskScoreDateRange, setRiskScoreDateRange] = useState<DateRange>('30d')
  const [lastSynced] = useState<Date>(demoMode ? DEMO_LAST_SYNCED : new Date())
  const [insightDismissed, setInsightDismissed] = useState(false)

  const { data: riskScoreData, isLoading: riskScoreLoading } = useRiskScoreTrend(riskScoreDateRange, !demoMode && !salesDemoMode)

  const { data: stats, isLoading: statsLoading, error: statsError } = useQuery<PlatformDashboardStats>({
    queryKey: ['platform-dashboard-stats'],
    queryFn: platformStatsService.getDashboardStats,
    // AWS cost data changes slowly — long staleTime/gcTime avoids re-hitting Cost Explorer
    // (billed per API call) on every render/tab-switch.
    staleTime: 4 * 60 * 60 * 1000, gcTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false, refetchOnMount: false, retry: false,
    enabled: !demoMode && !salesDemoMode,
  })

  const costAnalysisData = stats ? {
    previousCost: stats.monthlyAwsCost * 0.95,
    currentCost: stats.monthlyAwsCost,
    percentageIncrease: stats.costChange ?? 0,
    topSpenders: demoMode ? generateCostBreakdownData().slice(0, 3).map(item => ({ service: item.name, cost: item.value, change: item.change })) : [],
    timeRange: 'last 30 days',
  } : null

  const { data: aiInsight, isLoading: aiInsightLoading } = useAIInsights(costAnalysisData, {
    enabled: !demoMode && !!stats,
    onSuccess: (data) => console.log('[Dashboard] AI Insights loaded:', data.cached ? 'from cache' : 'fresh'),
    onError: (error) => console.error('[Dashboard] AI Insights error:', error),
  })

  const { data: systemHealth } = useQuery({
    queryKey: ['system-health'],
    queryFn: () => monitoringService.getSystemHealth(),
    staleTime: 60_000, refetchInterval: 300_000,
    refetchOnWindowFocus: false, refetchOnMount: false, retry: false,
    enabled: !demoMode && !salesDemoMode,
  })

  const { data: costRecsRaw = [] } = useQuery<Array<{ id: string; issue: string; potential_savings?: number; status?: string; severity?: 'LOW' | 'MEDIUM' | 'HIGH'; resource_type?: string }>>({
    queryKey: ['cost-recommendations'],
    queryFn: async () => {
      const token = document.cookie.split(';').find(c => c.trim().startsWith('auth-token='))?.split('=')[1] || localStorage.getItem('accessToken')
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'}/api/cost-recommendations?status=ACTIVE`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
      })
      if (!res.ok) return []
      const json = await res.json()
      return json.data ?? []
    },
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
      if (data.totalCost > 0) {
        toast.info('AWS costs updated', { description: `New total: $${data.totalCost.toFixed(2)}` })
      }
      queryClient.invalidateQueries({ queryKey: ['platform-dashboard-stats'] })
      queryClient.invalidateQueries({ queryKey: ['system-intelligence'] })
      queryClient.invalidateQueries({ queryKey: ['ai-summary'] })
      queryClient.invalidateQueries({ queryKey: ['activity-feed'] })
    })
    socket.on('alert:created', (data) => {
      if (!shouldUpdate('alert:created')) return
      toast.error(`New ${data.severity} Alert`, { description: data.message })
      queryClient.invalidateQueries({ queryKey: ['platform-dashboard-stats'] })
      queryClient.invalidateQueries({ queryKey: ['system-intelligence'] })
      queryClient.invalidateQueries({ queryKey: ['ai-summary'] })
      queryClient.invalidateQueries({ queryKey: ['activity-feed'] })
    })
    socket.on('deployment:started', (data) => {
      if (!shouldUpdate('deployment:started')) return
      toast.info(`Deployment started: ${data.serviceName}`, { description: `Environment: ${data.environment} | By: ${data.deployedBy}` })
      queryClient.invalidateQueries({ queryKey: ['platform-dashboard-stats'] })
      queryClient.invalidateQueries({ queryKey: ['system-intelligence'] })
      queryClient.invalidateQueries({ queryKey: ['ai-summary'] })
      queryClient.invalidateQueries({ queryKey: ['activity-feed'] })
    })
    socket.on('deployment:completed', (data) => {
      if (!shouldUpdate('deployment:completed')) return
      const isSuccess = data.status === 'success'
      toast[isSuccess ? 'success' : 'error'](`Deployment ${isSuccess ? 'succeeded' : 'failed'}: ${data.serviceName}`, { description: isSuccess ? `Duration: ${data.duration}` : 'Check logs for details' })
      queryClient.invalidateQueries({ queryKey: ['platform-dashboard-stats'] })
      queryClient.invalidateQueries({ queryKey: ['system-intelligence'] })
      queryClient.invalidateQueries({ queryKey: ['ai-summary'] })
      queryClient.invalidateQueries({ queryKey: ['activity-feed'] })
    })
    socket.on('service:health', (data) => {
      if (!shouldUpdate('service:health')) return
      if (data.status !== 'healthy') toast.warning(`Service ${data.serviceName} is ${data.status}`, { description: `Health score: ${data.healthScore}%` })
      queryClient.invalidateQueries({ queryKey: ['platform-dashboard-stats'] })
      queryClient.invalidateQueries({ queryKey: ['system-intelligence'] })
      queryClient.invalidateQueries({ queryKey: ['ai-summary'] })
      queryClient.invalidateQueries({ queryKey: ['activity-feed'] })
    })
    return () => {
      socket.off('metrics:costs'); socket.off('alert:created')
      socket.off('deployment:started'); socket.off('deployment:completed'); socket.off('service:health')
    }
  }, [socket, queryClient])

  const insightMessage = demoMode
    ? 'Lambda function costs increased 23% due to higher invocation count — enable reserved concurrency and consider Graviton2 for up to $540/year savings.'
    : (aiInsight?.rootCause || aiInsight?.recommendation || null)

  const currentSpend    = demoMode ? DEMO_DASHBOARD_STATS.monthlyAwsCost : (stats?.monthlyAwsCost ?? 0)
  const costChange      = demoMode ? DEMO_DASHBOARD_STATS.costChange : (stats?.costChange ?? 0)
  const securityScore   = demoMode ? 87 : (riskScoreData?.current.score ?? null)
  // Raw (unrounded) monthly waste — kept separately so the annual projection can
  // round once after multiplying, matching costs/page.tsx and cost-optimization/page.tsx,
  // instead of rounding the monthly figure first and compounding the rounding error.
  const wasteAmountRaw  = demoMode ? 1922 : costRecsRaw.reduce((sum, r) => sum + (Number(r.potential_savings) || 0), 0)
  const wasteAmount     = Math.round(wasteAmountRaw)
  const efficiencyRatio = demoMode
    ? Math.round(((12847 - wasteAmount) / 12847) * 100)
    : currentSpend > 0 ? Math.round(((currentSpend - wasteAmount) / currentSpend) * 100) : null

  const { data: awsAccounts } = useQuery({
    queryKey: ['aws-accounts'],
    queryFn: async () => {
      const token = document.cookie.split(';').find(c => c.trim().startsWith('auth-token='))?.split('=')[1] || localStorage.getItem('accessToken')
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'}/api/aws/accounts`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include'
      })
      const json = await res.json(); return json.data ?? []
    },
    staleTime: 30000,
  })

  const isDemoActive    = demoMode || salesDemoMode
  // Real accounts: compliance + orphaned-resource scanning haven't run yet (backend stub),
  // so the score can't be presented as a confident, final tier. Demo data is always final.
  const securityIsPreliminary = !isDemoActive && (riskScoreData?.current?.isPreliminary ?? true)
  const securityTierLabel = isDemoActive
    ? 'Elite Tier'
    : securityScore === null ? 'Scan in progress'
    : securityIsPreliminary ? 'Preliminary — full scan pending'
    : securityScore >= 80 ? 'Elite Tier'
    : securityScore >= 60 ? 'Above baseline'
    : 'Needs attention'
  const securityTierColor = isDemoActive ? '#059669'
    : securityScore === null ? '#94A3B8'
    : securityIsPreliminary ? '#D97706'
    : securityScore >= 80 ? '#059669'
    : securityScore >= 60 ? '#D97706'
    : '#DC2626'
  const securityShowEliteBadge = isDemoActive || (!securityIsPreliminary && securityScore !== null && securityScore >= 85)
  // Compact severity breakdown for the Security Posture card — only renders when the
  // backend has real counts to show; never fabricates a value when data is absent.
  const securityBreakdown = (() => {
    const counts = riskScoreData?.current?.complianceIssueCounts
    if (!counts) return null
    const parts: string[] = []
    if (counts.critical > 0) parts.push(`${counts.critical} Critical`)
    if (counts.high > 0) parts.push(`${counts.high} High`)
    if (counts.medium > 0) parts.push(`${counts.medium} Medium`)
    if (counts.low > 0) parts.push(`${counts.low} Low`)
    return parts.length > 0 ? parts.join(' · ') : null
  })()
  const isAwsConnected  = isDemoActive || (awsAccounts && awsAccounts.length > 0) || (!!stats && (stats.monthlyAwsCost > 0 || stats.activeDeployments > 0 || stats.totalServices > 0))
  const hasBillingData   = !isDemoActive && !!stats && (stats.costSource === 'actual' || stats.monthlyAwsCost > 0)
  const hasServicesOnly  = !isDemoActive && !!stats && stats.totalServices > 0 && !hasBillingData
  const isBillingSyncing = !isDemoActive && isAwsConnected && !statsLoading && !!stats && stats.totalServices === 0 && !hasBillingData

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

  const { data: costTrend = [], isLoading: costTrendLoading } = useQuery<Array<{ date: string; compute: number; storage: number; database: number; network: number; other: number; total: number }>>({
    queryKey: ['cost-trend', costDateRange],
    queryFn: async () => {
      const token = document.cookie.split(';').find(c => c.trim().startsWith('auth-token='))?.split('=')[1] || localStorage.getItem('accessToken')
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'}/api/platform/costs/trend?range=${costDateRange}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
      })
      if (!res.ok) return []
      const json = await res.json()
      return json.data ?? []
    },
    // Cost Explorer is billed per API call and this data doesn't change minute-to-minute —
    // cache aggressively per range so switching 7d/30d/90d/6mo/1yr tabs reuses prior fetches
    // instead of re-hitting AWS each time.
    staleTime: 4 * 60 * 60 * 1000, gcTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false, refetchOnMount: false, retry: false,
    enabled: !isDemoActive && hasBillingData,
  })

  const monthOverMonthCostChange = isDemoActive ? null : computeMonthOverMonthCostChange(costTrend)
  const mtdCostDeltaColor = monthOverMonthCostChange !== null
    ? (monthOverMonthCostChange > 0 ? (currentSpend >= 100 ? '#DC2626' : '#D97706') : monthOverMonthCostChange < 0 ? '#059669' : '#D97706')
    : '#D97706'
  const MtdCostDeltaIcon = monthOverMonthCostChange !== null
    ? (monthOverMonthCostChange > 0 ? TrendingUp : monthOverMonthCostChange < 0 ? TrendingDown : Minus)
    : Minus

  // Real-data-only, like every other computed-metric feature on this dashboard — no
  // demo-mode fabrication. costDeltaPct reuses the already-computed value above so the
  // backend doesn't need a second, separately-billed Cost Explorer call to reference spend trend.
  const { data: aiSummaryData, isLoading: aiSummaryLoading, isError: aiSummaryError } = useAISummary(
    organization?.id,
    monthOverMonthCostChange,
    !isDemoActive && hasBillingData
  )

  // Real-data-only, hidden in demo mode — same pattern as AI Summary.
  const { data: activityFeedData, isLoading: activityFeedLoading, isError: activityFeedError } = useActivityFeed(
    organization?.id,
    !isDemoActive
  )

  const activityDotColor = (type: ActivityEventType): string => {
    switch (type) {
      case 'sync': return '#059669'
      case 'optimization': return '#D97706'
      case 'security':
      case 'anomaly': return '#DC2626'
      case 'score': return '#2563EB'
      default: return '#94A3B8'
    }
  }

  // Reusable Recent Activity card — reconstructed from real data (sync, cost
  // optimization, security findings, score changes, anomalies), not deployments.
  // Hidden in demo mode; used at both Recent Activity render sites in this file.
  const RecentActivityCard = () => {
    if (isDemoActive) return null
    const severityBadge = (severity?: string) => {
      const s = severity?.toLowerCase()
      if (s === 'high') return { color: 'var(--text-danger)', bg: 'var(--bg-danger)', label: 'High' }
      if (s === 'medium') return { color: 'var(--text-warning)', bg: 'var(--bg-warning)', label: 'Medium' }
      if (s === 'low') return { color: 'var(--text-secondary)', bg: 'var(--surface-1)', label: 'Low' }
      return null
    }
    return (
      <div className="bg-[var(--surface-2)] border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-semibold text-foreground">Recent activity</p>
        </div>
        {activityFeedLoading ? (
          <div className="flex flex-col gap-3 py-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : activityFeedError || !activityFeedData || activityFeedData.length === 0 ? (
          <div className="text-center py-10 flex flex-col items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-[var(--surface-1)] flex items-center justify-center mb-1"><i className="ti ti-activity text-[18px] text-[var(--text-secondary)]" /></div>
            <p className="text-sm font-semibold text-foreground">No activity yet</p>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">Activity will appear here once resources sync, findings are detected, or scores update</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Category</TableHead>
                <TableHead className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Finding</TableHead>
                <TableHead className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Severity</TableHead>
                <TableHead className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider text-right">Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activityFeedData.map((event, i) => {
                const badge = severityBadge(event.severity)
                return (
                  <TableRow key={`${event.type}-${event.timestamp}-${i}`}>
                    <TableCell className="whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full shrink-0" style={{ background: activityDotColor(event.type) }} />
                        <span className="text-xs font-medium text-[var(--text-secondary)] capitalize">{event.type}</span>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-0 w-full">
                      <div className="line-clamp-2 text-sm text-foreground leading-snug" title={event.message}>{event.message}</div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {badge ? (
                        <span className="text-xs font-semibold px-1.5 py-0.5 rounded" style={{ color: badge.color, background: badge.bg }}>{badge.label}</span>
                      ) : (
                        <span className="text-xs text-[var(--text-secondary)]">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-[var(--text-secondary)] whitespace-nowrap text-right">{formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>
    )
  }

  const costDeltaColor  = costChange > 0 ? '#DC2626' : costChange < 0 ? '#059669' : '#D97706'
  const CostDeltaIcon   = costChange > 0 ? TrendingUp : costChange < 0 ? TrendingDown : Minus
  const SecurityDeltaIcon  = isDemoActive ? TrendingUp : securityIsPreliminary ? Minus : (securityScore !== null && securityScore > 0) ? (securityScore >= 80 ? TrendingUp : TrendingDown) : Minus
  const efficiencyDeltaColor = efficiencyRatio !== null ? efficiencyRatio >= 90 ? '#059669' : efficiencyRatio >= 75 ? '#D97706' : '#DC2626' : '#D97706'
  const EfficiencyDeltaIcon  = efficiencyRatio !== null ? efficiencyRatio >= 90 ? TrendingUp : efficiencyRatio >= 75 ? Minus : TrendingDown : Minus

  const costScore           = isDemoActive ? 82 : (efficiencyRatio ?? null)
  const securityScore_health = isDemoActive ? 87 : (securityScore ?? null)
  const reliabilityScore    = isDemoActive ? 91 : (systemHealth?.healthPercentage ?? (stats ? null : 0))
  const systemStatusLabel   = isDemoActive ? 'healthy' : systemHealth?.status === 'operational' ? 'healthy' : systemHealth?.status === 'disrupted' ? 'down' : systemHealth?.status === 'degraded' ? 'degraded' : 'unknown'
  const avgServiceResponseTime = systemHealth?.services?.length
    ? Math.round(systemHealth.services.reduce((sum, s) => sum + s.responseTime, 0) / systemHealth.services.length)
    : null
  const systemResponseTime  = isDemoActive ? '145ms' : (avgServiceResponseTime != null ? `${avgServiceResponseTime}ms` : '—')
  const systemAlertCount    = isDemoActive ? 2 : 0
  const systemUptimeAvg     = isDemoActive ? '99.4%' : (systemHealth?.healthPercentage != null ? `${systemHealth.healthPercentage}%` : '—')

  const systemStatusConfig = {
    healthy:  { color: 'var(--text-success)', bg: 'var(--bg-success)', border: 'var(--border-success)', dot: 'var(--fill-success)', label: 'All systems operational' },
    degraded: { color: 'var(--text-warning)', bg: 'var(--bg-warning)', border: 'var(--border-warning)', dot: 'var(--fill-warning)', label: 'Degraded performance detected' },
    down:     { color: 'var(--text-danger)', bg: 'var(--bg-danger)', border: 'var(--border-danger)', dot: 'var(--fill-danger)', label: 'System outage detected' },
    unknown:  { color: 'var(--text-secondary)', bg: 'var(--surface-1)', border: 'var(--border)', dot: 'var(--text-secondary)', label: 'Status pending' },
  }
  const statusConf = systemStatusConfig[systemStatusLabel as keyof typeof systemStatusConfig] || systemStatusConfig.unknown

  const _healthComponents = ([costScore, securityScore_health, reliabilityScore] as (number | null)[]).filter((s): s is number => s !== null)
  const cloudHealthScore = _healthComponents.length > 0 ? Math.round(_healthComponents.reduce((a, b) => a + b, 0) / _healthComponents.length) : null
  const topRecs: { label: string; savings: string; effort?: string; time?: string; severity?: 'LOW' | 'MEDIUM' | 'HIGH' }[] = isDemoActive
    ? [
        { label: 'Right-size 3 EC2 instances',        savings: '$720/mo', effort: 'Low',    time: '~15 min' },
        { label: 'Delete unattached EBS volumes',     savings: '$210/mo', effort: 'Low',    time: '~5 min'  },
        { label: 'Enable S3 Intelligent-Tiering',     savings: '$340/mo', effort: 'Medium', time: '~10 min' },
      ]
    : costRecsRaw.slice(0, 5).map(r => ({
        label:    r.issue || 'Can reduce monthly AWS spend',
        savings:  r.potential_savings != null ? `$${Math.round(r.potential_savings).toLocaleString()}/mo` : '',
        severity: r.severity,
      }))
  // ROI badge for the Savings Actions KPI card: High if the aggregate opportunity is
  // sizeable or the top recommendation is flagged high-severity — both already-computed
  // fields, no new data source.
  const savingsROI = wasteAmount > 50 || topRecs[0]?.severity === 'HIGH' ? 'High' : 'Medium'
  const criticalAlerts = demoMode ? DEMO_DASHBOARD_STATS.criticalAlerts : 0

  // Cost-saving opportunity counts, grouped by resource type from the already-fetched
  // cost recommendations — no new fetch. The real /api/cost-recommendations data only
  // ever tags resource_type as EC2/RDS/EIP today; EBS detection isn't wired to this
  // endpoint yet, so that bucket is honestly 0 for real orgs until it is.
  const idleEC2Count = isDemoActive ? 3 : costRecsRaw.filter(r => r.resource_type === 'EC2').length
  const unattachedEBSCount = isDemoActive ? 2 : costRecsRaw.filter(r => r.resource_type === 'EBS').length
  const overprovisionedRDSCount = isDemoActive ? 1 : costRecsRaw.filter(r => r.resource_type === 'RDS').length

  const doraRows: { label: string; value: string; tier: 'Elite' | 'High'; showTier?: boolean }[] = [
    { label: 'Deployment Frequency',  value: demoMode ? '4.2/day' : '—', tier: 'Elite', showTier: demoMode },
    { label: 'Lead Time for Changes', value: isDemoActive ? '2.4 hours' : '—', tier: 'Elite', showTier: isDemoActive },
    { label: 'Change Failure Rate',   value: isDemoActive ? '8.3%' : '—',      tier: 'High',  showTier: isDemoActive },
    { label: 'Mean Time to Recovery', value: isDemoActive ? '36 min' : '—',    tier: 'Elite', showTier: isDemoActive },
  ]

  const securityRows: { label: string; value: string | number; status: 'good' | 'warn' | 'neutral' }[] = [
    { label: 'May expose production resources to unauthorized access', value: isDemoActive ? 0 : '—',                          status: isDemoActive ? 'good' : 'neutral' },
    { label: 'Compliance Frameworks',    value: isDemoActive ? '4/4' : '—',                    status: 'good' },
    { label: 'Active Risks',             value: demoMode ? 3 : '—',                             status: 'warn' },
  ]

  // Real severity-derived risk badge for a recommendation (no fabricated risk/effort/time claims)
  const RiskBadge = ({ severity }: { severity?: 'LOW' | 'MEDIUM' | 'HIGH' }) => {
    if (!severity) return null
    const styles = {
      LOW:    'text-emerald-700 bg-emerald-50 border-emerald-200',
      MEDIUM: 'text-amber-700 bg-amber-50 border-amber-200',
      HIGH:   'text-red-700 bg-red-50 border-red-200',
    }
    const labels = { LOW: 'Low risk', MEDIUM: 'Medium risk', HIGH: 'High risk' }
    return <span className={`text-xs font-semibold px-1.5 py-0.5 rounded border ${styles[severity]}`}>{labels[severity]}</span>
  }

  // Reusable inline component for intelligence score bars
  const IntelScoreBars = ({ intel }: { intel: typeof DEMO_INTELLIGENCE | null }) => (
    <div className="flex flex-col gap-1.5">
      {intel
        ? Object.values(intel.components).map((comp: any) => (
            <div key={comp.label} className="flex items-center gap-1.5 mb-0.5">
              <div className="flex-1 h-1.5 rounded-full bg-[var(--surface-1)]">
                <div className="h-full rounded-full transition-all" style={{ width: `${comp.score}%`, background: comp.score >= 80 ? 'var(--fill-success)' : comp.score >= 60 ? 'var(--fill-warning)' : 'var(--fill-danger)' }} />
              </div>
              <span className="text-xs text-[var(--text-secondary)] w-24 text-right whitespace-nowrap shrink-0 font-medium">{comp.label.split(' ')[0]} {comp.score}</span>
            </div>
          ))
        : [{ label: 'Cost', score: costScore }, { label: 'Security', score: securityScore_health }, { label: 'Observability', score: reliabilityScore }].map(({ label, score }) => (
            <div key={label} className="flex items-center gap-1.5 mb-0.5">
              <div className="flex-1 h-1.5 rounded-full bg-[var(--surface-1)]">
                <div className="h-full rounded-full" style={{ width: `${score ?? 0}%`, background: (score ?? 0) >= 80 ? 'var(--fill-success)' : (score ?? 0) >= 60 ? 'var(--fill-warning)' : 'var(--fill-danger)' }} />
              </div>
              <span className="text-xs text-[var(--text-secondary)] w-24 text-right shrink-0 font-medium">{label} {score ?? '—'}</span>
            </div>
          ))
      }
    </div>
  )

  // Reusable System Intelligence KPI card content
  const IntelKPICard = ({ hero = false }: { hero?: boolean } = {}) => {
    const notReady = !isDemoActive && (displayIntelligence == null || displayIntelligence.system_score == null)
    const intelLabelClass = hero
      ? 'text-sm font-semibold text-foreground mb-3'
      : 'text-xs text-[var(--text-secondary)] font-medium mb-3'
    if (notReady) {
      return (
        <>
          <p className={intelLabelClass}>System intelligence</p>
          <div className="text-base font-medium text-foreground leading-none mb-2">Calculating...</div>
        </>
      )
    }
    const score = displayIntelligence?.system_score ?? cloudHealthScore ?? 0
    const chipLabel = score < 50 ? 'Poor — needs optimization' : score >= 85 ? 'Elite tier' : 'Needs optimization'
    const chipTextVar = score < 50 || (score < 85 && score > 0) ? 'var(--text-warning)' : 'var(--text-success)'
    const chipBgVar = score < 50 || (score < 85 && score > 0) ? 'var(--bg-warning)' : 'var(--bg-success)'
    return (
      <>
        <p className={intelLabelClass}>System intelligence</p>
        <div className="text-3xl font-semibold leading-none mb-2" style={{ color: score < 50 ? 'var(--text-danger)' : 'var(--foreground)' }}>
          {score || '—'}<span className="text-base text-[var(--text-secondary)] font-normal">/100</span>
        </div>
        <span className="text-xs font-semibold px-1.5 py-0.5 rounded inline-block mt-1.5" style={{ color: chipTextVar, background: chipBgVar }}>{chipLabel}</span>
        <div className="my-2">
          <span className="text-sm font-semibold" style={{ color: (displayIntelligence?.system_score ?? 0) >= 85 ? 'var(--text-success)' : 'var(--text-warning)' }}>
            {displayIntelligence?.status ?? 'Computing...'}
          </span>
          {displayIntelligence?.system_score && displayIntelligence.system_score < 85 && (
            <p className="text-xs text-[var(--text-secondary)] mt-0.5 leading-snug">Top teams: 85+ · Improve to unlock full efficiency</p>
          )}
        </div>
        <IntelScoreBars intel={displayIntelligence} />
      </>
    )
  }

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 max-w-[1400px] mx-auto min-h-screen bg-[var(--surface-1)]">

      {/* ── HEADER ROW ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-10">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight leading-snug mb-1">
            AWS cost, security and infrastructure intelligence
          </h1>
          <p className="text-xs text-[var(--text-secondary)] font-medium leading-relaxed mb-1">
            Real-time visibility into cost waste, security posture, and infrastructure efficiency — across your entire AWS environment.
          </p>
          <p className="text-xs text-[var(--text-secondary)] font-medium leading-relaxed">
            {isAwsConnected
              ? `${isDemoActive ? 'WayUP Technology' : (organization?.displayName || organization?.name || 'Your organization')} · Last synced ${formatDistanceToNow(lastSynced, { addSuffix: true })}`
              : 'Connect your AWS account to get started · Setup takes 2 minutes'}
          </p>
        </div>
        {isAwsConnected && (
          <a href="/cost-optimization" className="inline-flex items-center gap-1.5 bg-[var(--text-accent)] text-white px-6 py-2.5 rounded-lg text-sm font-semibold no-underline whitespace-nowrap shrink-0">
            {isBillingSyncing ? `Review Savings (${topRecs.length}) →` : `Review Savings (${topRecs.length}) →`}
          </a>
        )}
      </div>

      {/* ── RISK ALERT BANNER ── */}
      {(demoMode || salesDemoMode || criticalAlerts > 0) && (
        <div className="flex items-center gap-3.5 bg-[var(--bg-warning)] border border-[var(--border-warning)] rounded-xl px-5 py-3.5 mb-7">
          <div className="w-8 h-8 rounded-lg bg-[var(--surface-2)] flex items-center justify-center shrink-0">
            <i className="ti ti-alert-circle text-[16px]" style={{ color: 'var(--text-warning)' }} />
          </div>
          <div className="flex-1">
            <span className="text-sm font-semibold" style={{ color: 'var(--text-warning)' }}>
              {criticalAlerts} critical alert{criticalAlerts !== 1 ? 's' : ''} require your attention
            </span>
            <span className="text-[13px] ml-2" style={{ color: 'var(--text-warning)' }}>
              · Lambda invocation spike on payment-processor (+178%), CPU overload on production-worker
            </span>
          </div>
          <a href="/observability/alerts" className="text-xs font-semibold no-underline flex items-center gap-1 shrink-0" style={{ color: 'var(--text-warning)' }}>
            View alerts <i className="ti ti-arrow-right text-[12px]" />
          </a>
        </div>
      )}

      {/* ── RECOMMENDED ACTION BANNER ── */}
      {isAwsConnected && topRecs.length > 0 && (
        <div className="bg-[var(--bg-accent)] border-2 border-[var(--border-accent)] rounded-2xl px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-3">
          <div>
            <div className="text-xs font-bold tracking-widest uppercase mb-1" style={{ color: 'var(--text-accent)' }}>Recommended action</div>
            <div className="text-base font-semibold text-foreground mb-2">
              {isDemoActive
                ? '$800–$2,400/month in identified savings · 3 optimizations to review'
                : `$${wasteAmount.toLocaleString()}/month in identified savings · ${topRecs.length} optimization${topRecs.length !== 1 ? 's' : ''} to review`}
            </div>
            {isDemoActive && (
              <div className="flex gap-1.5 flex-wrap">
                {['Zero downtime', 'Fully reversible', 'Takes < 5 min'].map((pill) => (
                  <span key={pill} className="bg-[var(--surface-2)] border border-border rounded-full px-2.5 py-0.5 text-xs text-[var(--text-secondary)]">{pill}</span>
                ))}
              </div>
            )}
          </div>
          <a href="/cost-optimization" className="bg-[var(--text-accent)] text-white rounded-xl px-5 py-2.5 text-[13px] font-semibold no-underline whitespace-nowrap shrink-0">
            Review all
          </a>
        </div>
      )}
      {isAwsConnected && topRecs.length === 0 && !isDemoActive && (
        <div className="bg-[var(--bg-accent)] border-2 border-[var(--border-accent)] rounded-2xl px-5 py-4 mb-3">
          <div className="text-xs font-bold tracking-widest uppercase mb-1" style={{ color: 'var(--text-accent)' }}>Recommended action</div>
          <div className="text-base font-semibold text-[var(--text-secondary)]">
            No optimization opportunities identified · Your infrastructure is running efficiently
          </div>
        </div>
      )}

      {/* ── MAIN CONTENT ── */}
      {statsLoading ? null : isAwsConnected ? (
        isBillingSyncing ? (
          <>
            {/* Billing sync strip */}
            <div className="bg-[var(--surface-2)] border border-border rounded-xl px-4 py-2.5 flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-2 h-2 rounded-full shrink-0" style={{ background: 'var(--fill-warning)' }} />
                <span className="text-[13px] text-foreground font-medium">
                  Billing sync in progress (24–48h) · Preliminary savings already identified:
                </span>
                <span className="font-semibold text-[13px]" style={{ color: 'var(--text-success)' }}>{wasteAmount > 0 ? `$${wasteAmount.toLocaleString()}/month` : 'calculating...'}</span>
              </div>
              <span className="text-xs text-[var(--text-secondary)] font-medium">Infrastructure + security ready</span>
            </div>

            {/* KPI placeholder row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-4">
              {/* Monthly spend */}
              <div className="bg-[var(--surface-2)] rounded-xl p-4 border border-border">
                <p className="text-xs text-[var(--text-secondary)] font-medium mb-3">Last month's spend</p>
                <div className="text-base font-medium text-foreground leading-none mb-1">Syncing...</div>
                <div className="text-xs text-[var(--text-secondary)] font-medium mb-2">Full data in 24–48h</div>
                {wasteAmount > 0 && (
                  <span className="text-xs font-semibold bg-[var(--bg-success)] text-[var(--text-success)] px-1.5 py-0.5 rounded inline-block mt-1.5">High ROI available</span>
                )}
              </div>
              {/* Urgent actions */}
              <div className="bg-[var(--surface-2)] rounded-xl p-4 border border-border">
                <p className="text-xs text-[var(--text-secondary)] font-medium mb-3">Urgent actions</p>
                <div className="text-2xl font-medium leading-none mb-2" style={{ color: 'var(--text-success)' }}>{topRecs.length}</div>
                {topRecs.length > 0 && (
                  <span className="text-xs font-semibold bg-[var(--bg-danger)] text-[var(--text-danger)] px-1.5 py-0.5 rounded inline-block mt-1.5">Awaiting approval</span>
                )}
              </div>
              {/* Security health */}
              <div className="bg-[var(--surface-2)] rounded-xl p-4 border border-border">
                <p className="text-xs text-[var(--text-secondary)] font-medium mb-3">Security health</p>
                {(securityScore === null || securityScore === 0) && !isDemoActive ? (
                  <>
                    <div className="text-base font-medium text-foreground leading-none mb-2">Scanning...</div>
                  </>
                ) : (
                  <>
                    <div className="text-2xl font-medium text-foreground leading-none mb-2">
                      {securityScore ?? (isDemoActive ? 87 : '—')}<span className="text-base text-[var(--text-secondary)] font-normal">/100</span>
                    </div>
                    {securityShowEliteBadge && (
                      <span className="text-xs font-semibold bg-[var(--bg-success)] text-[var(--text-success)] px-1.5 py-0.5 rounded inline-block mt-1.5">Elite tier</span>
                    )}
                    {securityScore !== null && securityIsPreliminary && (
                      <span className="text-xs font-semibold bg-[var(--bg-warning)] text-[var(--text-warning)] px-1.5 py-0.5 rounded inline-block mt-1.5">Preliminary</span>
                    )}
                  </>
                )}
              </div>
              {/* System Intelligence */}
              <div className="bg-[var(--surface-2)] rounded-xl p-4 border border-border">
                <IntelKPICard />
              </div>
            </div>
          </>
        ) : (
          <>
            {hasServicesOnly && (
              <>
                <div className="bg-[var(--bg-warning)] border border-[var(--border-warning)] rounded-xl px-5 py-3 mb-5 flex items-center gap-3">
                  <i className="ti ti-alert-circle text-[16px]" style={{ color: 'var(--text-warning)' }} />
                  <span className="text-[13px]" style={{ color: 'var(--text-warning)' }}>
                    Historical billing data is still syncing. Infrastructure scanning and security analysis are fully operational — cost totals will be available within 24–48 hours.
                  </span>
                </div>
                <div className="bg-[var(--surface-2)] border border-border rounded-2xl p-8 mb-8">
                  <p className="text-xs text-[var(--text-secondary)] font-medium uppercase tracking-widest mb-5">Data status</p>
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
                        <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0" style={{ background: done ? 'var(--bg-success)' : 'var(--surface-1)', border: `1px solid ${done ? 'var(--border-success)' : 'var(--border)'}` }}>
                          {done ? (
                            <i className="ti ti-check text-xs" style={{ color: 'var(--text-success)' }} />
                          ) : (
                            <div className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--fill-warning)' }} />
                          )}
                        </div>
                        <span className={`text-sm ${done ? 'text-foreground font-medium' : 'text-[var(--text-secondary)]'}`}>{label}</span>
                        {!done && <span className="ml-auto text-xs font-semibold px-2 py-0.5 rounded-full" style={{ color: 'var(--text-warning)', background: 'var(--bg-warning)', border: '1px solid var(--border-warning)' }}>Syncing</span>}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* KPI grid — gated on data state */}
            {(isDemoActive || hasBillingData) ? (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
                  {/* Monthly spend */}
                  <div className="bg-[var(--surface-2)] rounded-xl p-4 border border-border">
                    <p className="text-xs text-[var(--text-secondary)] font-medium mb-3">Last month's spend</p>
                    {(statsLoading && !demoMode) || (currentSpend === 0 && !demoMode) ? (
                      <>
                        <div className="text-base font-medium text-foreground leading-none mb-1">Syncing...</div>
                        <div className="text-xs text-[var(--text-secondary)] font-medium mb-2">Full data in 24–48h</div>
                      </>
                    ) : (
                      <div className="text-2xl font-medium text-foreground leading-none mb-2">${currentSpend.toLocaleString()}</div>
                    )}
                    {wasteAmount > 0 && (
                      <span className="text-xs font-semibold bg-[var(--bg-success)] text-[var(--text-success)] px-1.5 py-0.5 rounded inline-block mt-1.5">High ROI available</span>
                    )}
                    {isDemoActive && (
                      <div className="flex items-center gap-1.5 mt-2">
                        <i className={`ti ti-${CostDeltaIcon === TrendingUp ? 'trending-up' : CostDeltaIcon === TrendingDown ? 'trending-down' : 'minus'} text-[14px]`} style={{ color: costDeltaColor }} />
                        <span className="text-[13px] font-semibold" style={{ color: costDeltaColor }}>{costChange > 0 ? '+' : ''}{Math.abs(costChange)}%</span>
                        <span className="text-[13px] text-[var(--text-secondary)]">vs last month</span>
                      </div>
                    )}
                    {!isDemoActive && monthOverMonthCostChange !== null && (
                      <div className="flex items-center gap-1.5 mt-2">
                        <i className={`ti ti-${MtdCostDeltaIcon === TrendingUp ? 'trending-up' : MtdCostDeltaIcon === TrendingDown ? 'trending-down' : 'minus'} text-[14px]`} style={{ color: mtdCostDeltaColor }} />
                        <span className="text-[13px] font-semibold" style={{ color: mtdCostDeltaColor }}>{monthOverMonthCostChange > 0 ? '+' : ''}{monthOverMonthCostChange}%</span>
                        <span className="text-[13px] text-[var(--text-secondary)]">vs last month</span>
                      </div>
                    )}
                  </div>

                  {/* Security health */}
                  <div className="bg-[var(--surface-2)] rounded-xl p-4 border border-border">
                    <p className="text-xs text-[var(--text-secondary)] font-medium mb-3">Security health</p>
                    {(securityScore === null || securityScore === 0) && !isDemoActive ? (
                      <div className="text-base font-medium text-foreground leading-none mb-2">Scanning...</div>
                    ) : (
                      <div className="text-2xl font-medium text-foreground leading-none mb-2">
                        {securityScore ?? (isDemoActive ? 87 : '—')}<span className="text-base text-[var(--text-secondary)] font-normal">/100</span>
                      </div>
                    )}
                    {securityShowEliteBadge && (
                      <span className="text-xs font-semibold bg-[var(--bg-success)] text-[var(--text-success)] px-1.5 py-0.5 rounded inline-block mt-1.5">Elite tier</span>
                    )}
                    <div className="flex items-center gap-1.5 mt-2">
                      <i className={`ti ti-${SecurityDeltaIcon === TrendingUp ? 'trending-up' : SecurityDeltaIcon === TrendingDown ? 'trending-down' : 'minus'} text-[12px]`} style={{ color: securityTierColor }} />
                      <span className="text-xs font-semibold" style={{ color: securityTierColor }}>
                        {securityTierLabel}
                      </span>
                    </div>
                    {securityBreakdown && (
                      <p className="text-xs text-[var(--text-secondary)] mt-1">{securityBreakdown}</p>
                    )}
                  </div>

                  {/* Urgent actions */}
                  <div className="bg-[var(--surface-2)] rounded-xl p-4 border border-border">
                    <p className="text-xs text-[var(--text-secondary)] font-medium mb-3">Urgent actions</p>
                    <div className="text-2xl font-medium leading-none mb-2" style={{ color: 'var(--text-success)' }}>
                      {topRecs.length > 0 ? `${topRecs.length} Opportunit${topRecs.length !== 1 ? 'ies' : 'y'}` : '0'}
                    </div>
                    {wasteAmount <= 0 && (
                      <div className="text-xs text-[var(--text-secondary)] font-medium mb-2">No opportunities identified yet</div>
                    )}
                    {topRecs.length > 0 && (
                      <>
                        <span className="text-xs font-semibold bg-[var(--bg-danger)] text-[var(--text-danger)] px-1.5 py-0.5 rounded inline-block mt-1.5">Awaiting approval</span>
                        <span className="text-xs font-semibold bg-[var(--bg-success)] text-[var(--text-success)] px-1.5 py-0.5 rounded inline-block mt-1.5 ml-1.5">ROI: {savingsROI}</span>
                      </>
                    )}
                    <div className="flex items-center gap-1.5 mt-2">
                      <i className="ti ti-trending-up text-[14px]" style={{ color: 'var(--text-success)' }} />
                      <span className="text-[13px] font-semibold" style={{ color: 'var(--text-success)' }}>Potential savings: ${wasteAmount.toLocaleString()}/month</span>
                    </div>
                  </div>
                </div>

                {/* System summary — 4-part scannable breakdown of the real numbers above,
                    generated server-side as structured fields (not parsed from prose).
                    Skeleton while generating; renders nothing on error or when there's no
                    real data to summarize (never a fabricated placeholder or an error state). */}
                {!aiSummaryError && (aiSummaryLoading || (
                  aiSummaryData && (
                    aiSummaryData.overallHealth?.score != null ||
                    aiSummaryData.overallHealth?.context ||
                    aiSummaryData.topRisk ||
                    aiSummaryData.cloudSpend ||
                    aiSummaryData.systemStatus
                  )
                )) && (
                  <div className="bg-[var(--surface-1)] rounded-xl p-6 border border-border mb-4">
                    <p className="text-base text-[var(--text-accent)] font-bold mb-3">Infrastructure Intelligence Summary</p>
                    {aiSummaryLoading ? (
                      <div className="flex flex-col gap-2">
                        <Skeleton className="h-3.5 w-full" />
                        <Skeleton className="h-3.5 w-5/6" />
                        <Skeleton className="h-3.5 w-2/3" />
                      </div>
                    ) : (
                      <ul className="flex flex-col gap-2 text-sm text-foreground leading-relaxed break-words list-none">
                        <li>
                          <strong>Overall Health:</strong>{' '}
                          {aiSummaryData?.overallHealth?.score != null ? (
                            <>
                              <strong>{aiSummaryData.overallHealth.score}/100</strong>
                              {aiSummaryData.overallHealth.context ? <> — {boldKeyNumbers(aiSummaryData.overallHealth.context)}</> : null}
                            </>
                          ) : aiSummaryData?.overallHealth?.context ? (
                            boldKeyNumbers(aiSummaryData.overallHealth.context)
                          ) : (
                            'Not yet available'
                          )}
                        </li>
                        <li>
                          <strong>Top Risk:</strong>{' '}
                          {aiSummaryData?.topRisk ? boldKeyNumbers(aiSummaryData.topRisk) : 'No urgent risks identified'}
                        </li>
                        <li>
                          <strong>Cloud Spend:</strong>{' '}
                          {aiSummaryData?.cloudSpend ? boldKeyNumbers(aiSummaryData.cloudSpend) : 'No spend data available'}
                        </li>
                        <li>
                          <strong>System Status:</strong>{' '}
                          {aiSummaryData?.systemStatus ? boldKeyNumbers(aiSummaryData.systemStatus) : 'Nominal — 0 active outages'}
                        </li>
                      </ul>
                    )}
                  </div>
                )}
              </>
            ) : isAwsConnected && (isBillingSyncing || hasServicesOnly) ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                <div className="bg-[var(--surface-2)] rounded-2xl p-8 border border-border border-l-[3px]" style={{ borderLeftColor: 'var(--border-accent)' }}>
                  <p className="text-xs text-[var(--text-secondary)] font-medium mb-4">Last month's spend</p>
                  <div className="text-lg font-medium text-[var(--text-secondary)] leading-snug mb-2">Calculating...</div>
                  <p className="text-xs text-[var(--text-secondary)]">Available once billing syncs</p>
                </div>
                <div className="bg-[var(--surface-2)] rounded-2xl p-8 border border-border">
                  <p className="text-xs text-[var(--text-secondary)] font-medium mb-4">Savings opportunity</p>
                  <div className="text-lg font-medium text-[var(--text-secondary)] leading-snug mb-2">Analyzing...</div>
                  <p className="text-xs text-[var(--text-secondary)]">Infrastructure scan in progress</p>
                </div>
                <div className="bg-[var(--surface-2)] rounded-xl p-4 border border-border">
                  <p className="text-xs text-[var(--text-secondary)] font-medium mb-3">Security health</p>
                  {(securityScore === null || securityScore === 0) && !isDemoActive ? (
                    <div className="text-base font-medium text-foreground leading-none mb-2">Scanning...</div>
                  ) : (
                    <>
                      <div className="text-2xl font-medium text-foreground leading-none mb-2">
                        {securityScore ?? '—'}<span className="text-base text-[var(--text-secondary)] font-normal">/100</span>
                      </div>
                      {securityShowEliteBadge && (
                        <span className="text-xs font-semibold bg-[var(--bg-success)] text-[var(--text-success)] px-1.5 py-0.5 rounded inline-block mt-1.5">Elite tier</span>
                      )}
                      {securityScore !== null && securityIsPreliminary && (
                        <span className="text-xs font-semibold bg-[var(--bg-warning)] text-[var(--text-warning)] px-1.5 py-0.5 rounded inline-block mt-1.5">Preliminary</span>
                      )}
                    </>
                  )}
                </div>
                <div className="bg-[var(--surface-2)] rounded-xl p-4 border border-border">
                  <IntelKPICard />
                </div>
              </div>
            ) : null}
          </>
        )
      ) : null}

      {/* ── SYSTEM INTELLIGENCE + HIGHEST PRIORITY ACTION ── */}
      {displayIntelligence && isAwsConnected && !isBillingSyncing && !hasServicesOnly && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* System Intelligence */}
          <div className="bg-[var(--surface-2)] rounded-xl p-6 border border-border">
            <IntelKPICard hero />
          </div>

          {/* Highest Priority Action */}
          {displayIntelligence.top_action && (
            <div
              className="flex flex-col gap-4 px-5 py-5 rounded-xl"
              style={{
                background: displayIntelligence.top_action.severity === 'critical' ? 'var(--bg-danger)' : 'var(--bg-warning)',
                border: `1px solid ${displayIntelligence.top_action.severity === 'critical' ? 'var(--border-danger)' : 'var(--border-warning)'}`,
              }}
            >
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold uppercase tracking-wider mb-0.5" style={{ color: displayIntelligence.top_action.severity === 'critical' ? 'var(--text-danger)' : 'var(--text-warning)' }}>Highest priority action</p>
                <p className="text-sm font-semibold text-foreground mb-0.5">{displayIntelligence.top_drivers?.[0]?.action?.label ?? displayIntelligence.top_action.message}</p>
                <p className="text-xs font-medium" style={{ color: displayIntelligence.top_action.severity === 'critical' ? 'var(--text-danger)' : 'var(--text-warning)' }}>{displayIntelligence.top_action.consequence}</p>
                <p className="text-xs font-semibold text-[var(--text-secondary)] mt-1">
                  Business risk: {displayIntelligence.top_action.severity === 'critical' || displayIntelligence.top_action.severity === 'high' ? 'High' : displayIntelligence.top_action.severity === 'medium' ? 'Medium' : 'Low'}
                </p>
              </div>
              <a href={displayIntelligence.top_action.path} className="text-white px-4 py-2 rounded-lg text-xs font-bold no-underline whitespace-nowrap shrink-0 self-start" style={{ background: displayIntelligence.top_action.severity === 'critical' ? 'var(--text-danger)' : 'var(--text-accent)' }}>
                Review →
              </a>
            </div>
          )}
        </div>
      )}

      {/* ── EXECUTIVE INSIGHTS ── */}
      {!insightDismissed && isAwsConnected && !isBillingSyncing && !hasServicesOnly && (demoMode || insightMessage) && (
        <div className="bg-[var(--surface-1)] border border-border border-l-2 rounded-lg px-4 py-3.5 mb-8 relative" style={{ borderLeftColor: 'var(--border-accent)' }}>
          <div className="flex items-start gap-4">
            <div className="w-7 h-7 rounded-lg shrink-0 flex items-center justify-center" style={{ background: 'var(--bg-accent)' }}>
              <i className="ti ti-sparkles text-[13px]" style={{ color: 'var(--text-accent)' }} />
            </div>
            <div className="flex-1">
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-accent)' }}>Executive insights</p>
              <p className="text-sm text-foreground leading-relaxed">
                {demoMode
                  ? <>Compute costs are driving spend ($5,200, +12%).{' '}<a href="/cost-optimization" className="font-semibold no-underline" style={{ color: 'var(--text-accent)' }}>Review optimization opportunities →</a></>
                  : (insightMessage || `Your infrastructure is being actively analyzed. ${displayIntelligence?.top_drivers?.[0]?.message ? displayIntelligence.top_drivers[0].message + ' — ' + displayIntelligence.top_drivers[0].consequence : topRecs.length > 0 ? `${topRecs.length} optimization opportunit${topRecs.length !== 1 ? 'ies' : 'y'} identified.` : 'No insights available yet.'}`)}
              </p>
            </div>
            <button onClick={() => setInsightDismissed(true)} className="bg-transparent border-none cursor-pointer text-[var(--text-secondary)] p-1 shrink-0 leading-none">
              <i className="ti ti-x text-[16px]" />
            </button>
          </div>
        </div>
      )}

      {/* ── AWS COST TRENDS + SECURITY SCORE DRIVERS ── */}
      {isAwsConnected && (
        isBillingSyncing ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-4">
            {/* AI Advisor */}
            {topRecs.length > 0 ? <div className="bg-[var(--surface-2)] rounded-2xl p-8 border border-border">
              <div className="flex items-start justify-between mb-1">
                <div>
                  <p className="text-xs text-[var(--text-secondary)] font-medium mb-2">AI advisor</p>
                  <p className="text-sm font-semibold text-foreground">Actions ready for approval</p>
                </div>
                <a href="/cost-optimization" className="text-xs font-semibold no-underline whitespace-nowrap" style={{ color: 'var(--text-accent)' }}>All →</a>
              </div>
              {topRecs.length > 0 && (
                <p className="text-xs text-foreground mb-4 leading-relaxed">
                  {isDemoActive
                    ? <>These {topRecs.length} changes reduce AWS waste immediately · zero downtime · fully reversible · takes &lt; 15 min</>
                    : <>These {topRecs.length} changes may reduce AWS waste — review each recommendation</>}
                </p>
              )}
              {topRecs.map((rec, i) => (
                <div key={i} className="flex items-start gap-3 py-3 border-b border-border">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--bg-accent)' }}><i className="ti ti-sparkles text-[13px]" style={{ color: 'var(--text-accent)' }} /></div>
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-foreground mb-1">{rec.label}</div>
                    <div className="text-xs text-[var(--text-secondary)] font-medium mb-1">Cost impact pending billing sync</div>
                    <div className="flex gap-1.5 flex-wrap">
                      {isDemoActive ? (
                        <>
                          {i < 2 ? (
                            <><span className="text-xs font-semibold text-[var(--text-success)] bg-[var(--bg-success)] border border-[var(--border-success)] px-1.5 py-0.5 rounded">Low risk</span><span className="text-xs font-semibold text-[var(--text-success)] bg-[var(--bg-success)] border border-[var(--border-success)] px-1.5 py-0.5 rounded">No downtime</span></>
                          ) : (
                            <span className="text-xs font-semibold text-[var(--text-warning)] bg-[var(--bg-warning)] border border-[var(--border-warning)] px-1.5 py-0.5 rounded">Low risk</span>
                          )}
                          <span className="text-xs font-semibold text-[var(--text-secondary)] bg-[var(--surface-1)] border border-border px-1.5 py-0.5 rounded">{rec.time}</span>
                        </>
                      ) : (
                        <RiskBadge severity={rec.severity} />
                      )}
                    </div>
                  </div>
                </div>
              ))}
              <div className="mt-4 p-3.5 bg-[var(--surface-1)] rounded-lg border border-border flex items-center justify-between">
                <div>
                  <div className="text-[13px] font-semibold text-foreground mb-0.5">Estimated impact</div>
                  <div className="text-xs text-[var(--text-secondary)] font-medium">Savings estimate available once billing sync completes</div>
                </div>
                <a href="/cost-optimization" className="text-white rounded-lg px-4 py-2 text-xs font-semibold no-underline whitespace-nowrap ml-4" style={{ background: 'var(--text-accent)' }}>Approve actions ({topRecs.length}) →</a>
              </div>
            </div> : <div className="bg-[var(--surface-2)] rounded-2xl p-8 border border-border">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="text-xs text-[var(--text-secondary)] font-medium mb-2">AI advisor</p>
                  <p className="text-sm font-semibold text-foreground">Infrastructure analysis in progress</p>
                </div>
                <a href="/cost-optimization" className="text-xs font-semibold no-underline whitespace-nowrap" style={{ color: 'var(--text-accent)' }}>All →</a>
              </div>
              <div className="flex flex-col items-center justify-center py-8 gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'var(--bg-accent)' }}>
                  <i className="ti ti-sparkles text-[18px]" style={{ color: 'var(--text-accent)' }} />
                </div>
                <p className="text-sm font-semibold text-foreground text-center">Scanning your AWS environment</p>
                <p className="text-xs text-[var(--text-secondary)] text-center leading-relaxed max-w-[220px]">Cost optimization opportunities will appear here once billing sync completes in 24–48h</p>
                <a href="/infrastructure" className="mt-1 text-[13px] font-semibold no-underline" style={{ color: 'var(--text-accent)' }}>View infrastructure →</a>
              </div>
            </div>}

            {/* Security Score Drivers */}
            <div className="bg-[var(--surface-2)] rounded-2xl p-8 border border-border">
              <p className="text-sm font-semibold text-foreground mb-4">Security score drivers</p>
              <div className="text-center py-3 border-b border-border mb-3.5">
                {(securityScore === null || securityScore === 0) && !isDemoActive ? (
                  <div className="text-base font-semibold text-foreground leading-none">Scanning...</div>
                ) : (
                  <div className="text-4xl font-semibold text-foreground tracking-tight leading-none">{securityScore ?? (isDemoActive ? '87' : '—')}<span className="text-base text-[var(--text-secondary)] font-normal">/100</span></div>
                )}
                {securityScore !== null && (
                  <div className="text-xs font-semibold mt-1" style={{ color: securityTierColor }}>{securityTierLabel}</div>
                )}
              </div>
              {securityRows.map(({ label, value, status }) => (
                <div key={label} className="flex items-center justify-between py-2 border-b border-border">
                  <span className="text-[12px] text-[var(--text-secondary)]">{label}</span>
                  <span className="text-[13px] font-bold" style={{ color: status === 'good' ? 'var(--text-success)' : status === 'neutral' ? 'var(--text-secondary)' : 'var(--text-warning)' }}>{value}</span>
                </div>
              ))}
              <div className="py-2 border-b border-border">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[12px] text-[var(--text-secondary)]">Compliance status</span>
                  {isDemoActive
                    ? <span className="text-xs font-bold" style={{ color: 'var(--text-success)' }}>3 / 3 passing</span>
                    : <span className="text-xs font-medium text-[var(--text-secondary)]">Run compliance scan</span>}
                </div>
                {isDemoActive && (
                  <div className="flex gap-1.5">
                    {['SOC2', 'CIS AWS', 'GDPR'].map((f) => (
                      <span key={f} className="text-xs font-semibold text-[var(--text-success)] bg-[var(--bg-success)] border border-[var(--border-success)] px-2 py-0.5 rounded">{f}</span>
                    ))}
                  </div>
                )}
              </div>
              <a href="/security" className="flex items-center justify-center gap-1.5 mt-3.5 text-[13px] font-semibold no-underline" style={{ color: 'var(--text-accent)' }}>View security report →</a>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mb-8">
            {/* AWS Cost Trends — 3fr */}
            <div className="lg:col-span-3 bg-[var(--surface-2)] rounded-xl p-4 border border-border">
              {/* CostBreakdownBarList (demo) has no title of its own, so it still needs
                  this label; CostTrendChart (live) and the syncing placeholder below
                  both render their own heading, so the label would just duplicate it. */}
              <div className={`flex items-start justify-between ${isDemoActive ? 'mb-6' : 'mb-2 justify-end'}`}>
                {isDemoActive && (
                  <div>
                    <p className="text-sm font-semibold text-foreground mb-1">AWS cost trends</p>
                    <p className="text-sm font-semibold text-foreground">Infrastructure cost over time</p>
                  </div>
                )}
                <a href="/costs" className="text-[var(--text-secondary)]"><i className="ti ti-dots text-[16px]" /></a>
              </div>
              {isDemoActive ? (
                <CostBreakdownBarList
                  data={generateCostBreakdownData()}
                  totalCost={DEMO_DASHBOARD_STATS.monthlyAwsCost}
                  isLoading={false}
                  dateRange={costDateRange}
                  onDateRangeChange={setCostDateRange}
                  onExport={() => { toast.success('Exporting cost data...') }}
                />
              ) : hasBillingData ? (
                <CostTrendChart
                  data={costTrend}
                  isLoading={costTrendLoading}
                  dateRange={costDateRange}
                  onDateRangeChange={setCostDateRange}
                  onExport={() => { toast.success('Exporting cost data...') }}
                />
              ) : (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-[var(--surface-1)]">
                    <i className="ti ti-currency-dollar text-[18px] text-[var(--text-secondary)]" />
                  </div>
                  <p className="text-sm font-semibold text-foreground">Cost data syncing</p>
                  <p className="text-xs text-[var(--text-secondary)] text-center leading-relaxed max-w-[220px]">Billing data available within 24–48h of connecting your AWS account</p>
                </div>
              )}
            </div>

            {/* Security Score Drivers — 2fr */}
            <div className="lg:col-span-2 bg-[var(--surface-2)] rounded-xl p-4 border border-border">
              <p className="text-sm font-semibold text-foreground mb-4">Security score drivers</p>
              {displayIntelligence?.top_drivers?.length > 0 && (
                <div className="flex flex-col gap-2 mb-4">
                  {displayIntelligence.top_drivers.map((driver: any, i: number) => (
                    <div key={driver.id} className="flex items-start gap-2.5 px-3 py-2.5 bg-[var(--surface-1)] rounded-lg border border-border">
                      <span className="text-xs font-bold text-[var(--text-secondary)] w-4 shrink-0 mt-0.5">#{i + 1}</span>
                      <div className="w-2 h-2 rounded-full shrink-0 mt-1.5" style={{ background: driver.severity === 'critical' ? 'var(--text-danger)' : driver.severity === 'high' ? 'var(--text-warning)' : 'var(--fill-warning)' }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold text-foreground mb-0.5">{driver.message}</p>
                        <p className="text-xs text-[var(--text-secondary)]">{driver.consequence}</p>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-xs font-bold whitespace-nowrap" style={{ color: 'var(--text-success)' }}>+{driver.impact_score}pts</span>
                          <a href={driver.action.path} className="text-xs font-semibold no-underline whitespace-nowrap" style={{ color: 'var(--text-accent)' }}>{driver.action.label} →</a>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="text-center py-5 border-y border-border mb-5">
                {(securityScore === null || securityScore === 0) && !isDemoActive ? (
                  <div className="text-base font-semibold text-foreground leading-none">Scanning...</div>
                ) : (
                  <>
                    <div className="text-4xl font-semibold text-foreground tracking-tight leading-none">{securityScore ?? (isDemoActive ? '87' : '—')}</div>
                    <div className="text-sm font-semibold mt-2" style={{ color: securityTierColor }}>
                      {securityTierLabel}
                    </div>
                  </>
                )}
              </div>
              {securityRows.map(({ label, value, status }) => (
                <div key={label} className="flex items-center justify-between py-2.5 border-b border-border">
                  <span className="text-[12px] text-[var(--text-secondary)]">{label}</span>
                  <span className="text-[13px] font-bold" style={{ color: status === 'good' ? 'var(--text-success)' : status === 'neutral' ? 'var(--text-secondary)' : 'var(--text-warning)' }}>{value}</span>
                </div>
              ))}
              <div className="py-3 border-b border-border">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[12px] text-[var(--text-secondary)]">Compliance status</span>
                  {isDemoActive
                    ? <span className="text-xs font-bold" style={{ color: 'var(--text-success)' }}>3 / 3 passing</span>
                    : <span className="text-xs font-medium text-[var(--text-secondary)]">Run compliance scan</span>}
                </div>
                {isDemoActive && (
                  <div className="flex gap-1.5 flex-wrap">
                    {['SOC2', 'CIS AWS', 'GDPR'].map((framework) => (
                      <span key={framework} className="text-xs font-semibold text-[var(--text-success)] bg-[var(--bg-success)] border border-[var(--border-success)] px-2 py-0.5 rounded">{framework}</span>
                    ))}
                  </div>
                )}
              </div>
              <a href="/security" className="flex items-center justify-center gap-1.5 mt-5 text-[13px] font-semibold no-underline" style={{ color: 'var(--text-accent)' }}>
                View security report <i className="ti ti-arrow-right text-[13px]" />
              </a>
            </div>
          </div>
        )
      )}

      {/* ── COST-SAVING OPPORTUNITIES ── */}
      {isAwsConnected && !isBillingSyncing && !hasServicesOnly && (isDemoActive || hasBillingData) && (
        <div className="mb-8">
          <p className="text-sm font-semibold text-foreground mb-4">Cost-saving opportunities</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {[
              { title: 'Idle EC2', description: 'Instances with sustained low utilization', count: idleEC2Count },
              { title: 'Unattached EBS', description: 'Volumes not attached to any instance', count: unattachedEBSCount },
              { title: 'Overprovisioned RDS', description: 'Database instances sized above actual load', count: overprovisionedRDSCount },
            ].map(({ title, description, count }) => (
              <div key={title} className="bg-[var(--surface-2)] rounded-xl p-4 border border-border">
                <div className="flex items-start justify-between mb-3">
                  <p className="text-xs text-[var(--text-secondary)] font-medium">{title}</p>
                  <span
                    className="text-xs font-semibold px-1.5 py-0.5 rounded whitespace-nowrap"
                    style={{
                      color: count === 0 ? 'var(--text-success)' : 'var(--text-warning)',
                      background: count === 0 ? 'var(--bg-success)' : 'var(--bg-warning)',
                    }}
                  >
                    {count} detected
                  </span>
                </div>
                <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── EXECUTIVE ROI SUMMARY ── */}
      {isAwsConnected && !isBillingSyncing && !hasServicesOnly && (
        <div className="bg-[var(--surface-2)] rounded-xl p-4 border border-border mb-8">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
            <div>
              <p className="text-sm font-semibold text-foreground mb-1">Executive ROI summary</p>
              <p className="text-lg font-semibold text-foreground">
                {isDemoActive || wasteAmount > 0 ? (
                  <>
                    DEVCONTROL has saved {isDemoActive ? 'WayUP Technology' : (organization?.displayName || organization?.name || 'your organization')}{' '}
                    <span style={{ color: 'var(--text-success)' }}>${Math.round(annualizeMonthly(wasteAmountRaw)).toLocaleString()}</span> annualised
                  </>
                ) : (
                  <>Your infrastructure is currently optimized — no cost-saving opportunities detected for {organization?.displayName || organization?.name || 'your organization'}</>
                )}
              </p>
            </div>
            <div className="flex gap-2.5 shrink-0">
              {(isDemoActive || wasteAmount > 0) && (
                <a href="/cost-optimization" className="text-white px-6 py-2.5 rounded-lg text-sm font-semibold no-underline whitespace-nowrap" style={{ background: 'var(--text-accent)' }}>Review savings</a>
              )}
              <a href="/costs" className="bg-transparent text-[var(--text-secondary)] px-4 py-2.5 rounded-lg text-sm font-medium no-underline border border-border whitespace-nowrap">View full report</a>
            </div>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
            {[
              { label: 'Monthly savings',         value: wasteAmount > 0 ? `$${wasteAmount.toLocaleString()}` : '—',            sub: wasteAmount > 0 ? 'AI-identified waste' : 'No opportunities identified yet',    color: wasteAmount > 0 ? 'var(--text-success)' : 'var(--text-secondary)' },
              { label: 'Annual projection',        value: wasteAmount > 0 ? `$${Math.round(annualizeMonthly(wasteAmountRaw)).toLocaleString()}` : '—',     sub: wasteAmount > 0 ? 'At current run rate' : 'No opportunities identified yet',    color: wasteAmount > 0 ? 'var(--text-success)' : 'var(--text-secondary)' },
              { label: 'Avg. ROI payback',         value: isDemoActive ? '< 15 min' : '—',                                      sub: isDemoActive ? 'Zero-risk changes only' : 'Not yet available',                  color: isDemoActive ? 'var(--text-accent)' : 'var(--text-secondary)' },
              { label: 'Can reduce monthly spend',     value: `${topRecs.length}`,                                                 sub: 'Ready to action',                                                               color: 'var(--text-warning)' },
            ].map(({ label, value, sub, color }) => (
              <div key={label} className="px-4 py-4 bg-[var(--surface-1)] rounded-xl border border-border">
                <p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-secondary)] mb-2">{label}</p>
                <div className="text-2xl font-semibold tracking-tight leading-none mb-1" style={{ color }}>{value}</div>
                <div className="text-xs text-[var(--text-secondary)]">{sub}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── SYSTEM STATUS BAR ── */}
      {isAwsConnected && (
        <div
          className="rounded-xl px-4 py-3.5 flex items-center justify-between mb-5 border"
          style={{ background: statusConf.bg, borderColor: statusConf.border }}
        >
          <div className="flex items-center gap-2.5 flex-wrap">
            <div className="w-2 h-2 rounded-full shrink-0" style={{ background: systemAlertCount > 0 ? 'var(--fill-warning)' : statusConf.dot }} />
            <span className="text-[13px] font-semibold" style={{ color: statusConf.color }}>{systemAlertCount > 0 ? `${systemAlertCount} active alert${systemAlertCount !== 1 ? 's' : ''}` : statusConf.label}</span>
            <div className="hidden sm:block w-px h-3.5 bg-border" />
            <span className="hidden sm:block text-xs font-medium" style={{ color: statusConf.color }}>{systemUptimeAvg !== '—' && systemUptimeAvg !== '0%' ? `${systemUptimeAvg} uptime this month` : systemUptimeAvg === '0%' ? 'Pending data' : isDemoActive ? '99.9% uptime this month' : 'Uptime data pending'}</span>
            <div className="hidden sm:block w-px h-3.5 bg-border" />
            {isDemoActive && systemStatusLabel !== 'down' && <span className="hidden sm:block text-xs font-medium" style={{ color: statusConf.color }}>No incidents in 30 days</span>}
            <div className="hidden sm:block w-px h-3.5 bg-border" />
            <span className="hidden sm:block text-xs font-medium" style={{ color: statusConf.color }}>{systemResponseTime !== '—' ? `Avg response ${systemResponseTime}` : isDemoActive ? '3 services monitored' : (systemHealth?.totalServices ? `${systemHealth.totalServices} services monitored` : 'Monitoring pending')}</span>
          </div>
          <a href="/monitoring" className="font-semibold text-xs no-underline" style={{ color: statusConf.color }}>View observability →</a>
        </div>
      )}

      {/* ── ENGINEERING HEALTH + AI ADVISOR ── */}
      {isAwsConnected && (
        isBillingSyncing ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {/* Engineering Health */}
            <div className="bg-[var(--surface-2)] border border-border rounded-xl p-4">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="text-sm font-semibold text-foreground mb-1.5">Engineering health</p>
                  <span className="text-xl font-semibold text-foreground">{isDemoActive ? 'Elite' : '—'}</span>
                </div>
                <a href="/app/dora-metrics" className="text-xs font-semibold no-underline flex items-center gap-1" style={{ color: 'var(--text-accent)' }}>Full report <i className="ti ti-arrow-right text-[12px]" /></a>
              </div>
              {isDemoActive ? (
                doraRows.filter(r => ['Lead Time for Changes', 'Change Failure Rate', 'Mean Time to Recovery'].includes(r.label)).map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between py-2.5 border-b border-border">
                    <span className="text-[13px] text-[var(--text-secondary)] font-medium">{label}</span>
                    <span className="text-[13px] font-semibold" style={{ color: label === 'Change Failure Rate' ? 'var(--text-warning)' : 'var(--foreground)' }}>{value}</span>
                  </div>
                ))
              ) : (
                <div className="py-2">
                  <p className="text-xs text-[var(--text-secondary)] mb-3 leading-relaxed">Connect CI/CD pipeline to see DORA metrics</p>
                  <a href="/deployments" className="text-xs font-semibold no-underline flex items-center gap-1" style={{ color: 'var(--text-accent)' }}>Connect CI/CD <i className="ti ti-arrow-right text-[12px]" /></a>
                </div>
              )}
            </div>

            {/* What You Can Do Now */}
            <div className="bg-[var(--surface-2)] border border-border rounded-xl p-4">
              <p className="text-xs text-[var(--text-secondary)] font-medium mb-4">What you can do now</p>
              <a href="/cost-optimization" className="flex items-center gap-3 px-4 py-3.5 border rounded-xl mb-2 no-underline" style={{ background: 'var(--text-accent)', borderColor: 'var(--border-accent)' }}>
                <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center shrink-0"><i className="ti ti-circle-check text-[14px] text-white" /></div>
                <div>
                  <div className="text-sm font-bold text-white mb-0.5">Approve actions ({topRecs.length})</div>
                  <div className="text-xs text-white/80 font-medium">Zero downtime · fully reversible · &lt; 5 min</div>
                </div>
                <span className="ml-auto text-sm text-white font-bold">→</span>
              </a>
              {[
                { href: '/security',    tokenBg: 'var(--bg-success)', tokenColor: 'var(--text-success)', title: 'Explore security report',   sub: securityScore !== null ? `${securityScore} score` : 'Run security scan'          },
                { href: '/deployments', tokenBg: 'var(--surface-1)', tokenColor: 'var(--text-secondary)', title: 'Connect CI/CD pipeline',     sub: 'Track deployments · velocity'   },
                { href: '/costs',       tokenBg: 'var(--bg-warning)', tokenColor: 'var(--text-warning)', title: 'Monitor billing sync',       sub: 'Cost data within 24–48h'         },
              ].map(({ href, tokenBg, tokenColor, title, sub }) => (
                <a key={href} href={href} className="flex items-center gap-3 border border-border rounded-xl px-3 py-2.5 mb-1.5 no-underline">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: tokenBg }}><i className="ti ti-arrow-right text-[13px]" style={{ color: tokenColor }} /></div>
                  <div>
                    <div className="text-[13px] font-semibold text-foreground mb-0.5">{title}</div>
                    <div className="text-xs text-[var(--text-secondary)]">{sub}</div>
                  </div>
                  <span className="ml-auto text-sm font-semibold" style={{ color: 'var(--text-accent)' }}>→</span>
                </a>
              ))}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {/* Engineering Health */}
            <div className="bg-[var(--surface-2)] border border-border rounded-xl p-4">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="text-sm font-semibold text-foreground mb-1.5">Engineering health</p>
                  <div className="flex items-center gap-2">
                    <span className="text-xl font-semibold text-foreground">{isDemoActive ? 'Elite' : '—'}</span>
                    {isDemoActive && <span className="text-xs font-bold px-2.5 py-0.5 rounded-full" style={{ background: 'var(--bg-success)', color: 'var(--text-success)' }}>Top 10%</span>}
                  </div>
                </div>
                <a href="/app/dora-metrics" className="text-xs font-semibold no-underline flex items-center gap-1" style={{ color: 'var(--text-accent)' }}>Full report <i className="ti ti-arrow-right text-[12px]" /></a>
              </div>
              <p className="text-xs text-[var(--text-secondary)] mb-3 leading-relaxed">{isDemoActive ? 'Elite performance across all 4 DORA metrics' : 'Connect CI/CD pipeline to see DORA metrics'}</p>
              {isDemoActive ? (
                doraRows.map(({ label, value, tier, showTier }) => (
                  <div key={label} className="flex items-center justify-between py-2.5 border-b border-border">
                    <span className="text-[13px] text-[var(--text-secondary)]">{label}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold" style={{ color: label === 'Change Failure Rate' ? 'var(--text-warning)' : 'var(--foreground)' }}>{value}</span>
                      {(showTier === undefined || showTier) && (
                        <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ color: tier === 'Elite' ? 'var(--text-success)' : 'var(--text-warning)', background: tier === 'Elite' ? 'var(--bg-success)' : 'var(--bg-warning)' }}>{tier}</span>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <a href="/deployments" className="text-xs font-semibold no-underline flex items-center gap-1" style={{ color: 'var(--text-accent)' }}>Connect CI/CD <i className="ti ti-arrow-right text-[12px]" /></a>
              )}
            </div>

            {/* AI Advisor Feed */}
            {(() => {
              const showSavingsDollars = isDemoActive || hasBillingData
              return (
                <div className="bg-[var(--surface-2)] border border-border rounded-xl p-4">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <p className="text-xs text-[var(--text-secondary)] font-medium mb-1.5">What you can do now</p>
                      <p className="text-sm font-semibold text-foreground">Top recommendations</p>
                    </div>
                    <a href="/cost-optimization" className="text-xs font-semibold no-underline flex items-center gap-1" style={{ color: 'var(--text-accent)' }}>All <i className="ti ti-arrow-right text-[12px]" /></a>
                  </div>
                  <p className="text-xs text-foreground mb-3 leading-relaxed px-3 py-2.5 rounded-lg border border-border" style={{ background: 'var(--bg-success)' }}>
                    {isDemoActive
                      ? <>These {topRecs.length} changes reduce AWS waste immediately — zero downtime · fully reversible</>
                      : <>These {topRecs.length} changes may reduce AWS waste — review each recommendation</>}
                  </p>
                  {topRecs.map((rec, i) => (
                    <div key={i} className="flex items-start gap-3 border border-border rounded-xl px-3 py-2.5 mb-1.5">
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--bg-accent)' }}><i className="ti ti-sparkles text-[13px]" style={{ color: 'var(--text-accent)' }} /></div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium text-foreground leading-snug mb-0.5">{rec.label}</div>
                        <div className="flex items-center gap-1.5 flex-wrap mt-1">
                          {showSavingsDollars
                            ? <span className="text-xs font-bold" style={{ color: 'var(--text-success)' }}>{rec.savings}</span>
                            : <span className="text-xs text-[var(--text-secondary)] italic">Cost impact pending billing sync</span>}
                          {isDemoActive ? (
                            <>
                              {i < 2 ? (
                                <><span className="text-xs font-semibold px-1.5 py-0.5 rounded" style={{ color: 'var(--text-success)', background: 'var(--bg-success)', border: '1px solid var(--border-success)' }}>Low risk</span><span className="text-xs font-semibold px-1.5 py-0.5 rounded" style={{ color: 'var(--text-success)', background: 'var(--bg-success)', border: '1px solid var(--border-success)' }}>No downtime</span><span className="text-xs font-semibold px-1.5 py-0.5 rounded" style={{ color: 'var(--text-accent)', background: 'var(--bg-accent)', border: '1px solid var(--border-accent)' }}>High confidence</span></>
                              ) : (
                                <><span className="text-xs font-semibold px-1.5 py-0.5 rounded" style={{ color: 'var(--text-warning)', background: 'var(--bg-warning)', border: '1px solid var(--border-warning)' }}>Low risk</span><span className="text-xs font-semibold text-[var(--text-secondary)] bg-[var(--surface-1)] border border-border px-1.5 py-0.5 rounded">Effort: Medium</span></>
                              )}
                              <span className="text-xs font-semibold text-[var(--text-secondary)] bg-[var(--surface-1)] border border-border px-1.5 py-0.5 rounded">{rec.time}</span>
                            </>
                          ) : (
                            <RiskBadge severity={rec.severity} />
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  <div className="mt-4 p-3 bg-[var(--surface-1)] rounded-lg border border-border">
                    <div className="text-xs font-semibold text-[var(--text-secondary)] mb-0.5">Total potential</div>
                    {showSavingsDollars
                      ? (wasteAmount > 0
                          ? <div className="text-lg font-bold tracking-tight" style={{ color: 'var(--text-success)' }}>${wasteAmount.toLocaleString()}/mo</div>
                          : <div className="text-[13px] text-[var(--text-secondary)] italic">{isDemoActive ? 'Calculating...' : 'No savings opportunities identified yet'}</div>)
                      : <div className="text-[13px] text-[var(--text-secondary)] italic">Calculated once billing syncs</div>}
                  </div>
                </div>
              )
            })()}
          </div>
        )
      )}

      {/* ── RECENT ACTIVITY ── */}
      {isAwsConnected && <RecentActivityCard />}

      {/* ── FOOTER CONNECTION STATUS ── */}
      {isAwsConnected && (
        <div className="flex items-center gap-2 mt-6 mb-2">
          <div className="h-2 w-2 rounded-full" style={{ background: isConnected ? 'var(--fill-success)' : 'var(--fill-danger)' }} />
          <span className="text-xs text-[var(--text-secondary)]">{isConnected ? 'Connected' : 'Reconnecting...'}</span>
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes ping { 75%, 100% { transform: scale(2); opacity: 0; } }
      `}</style>
    </div>
  )
}