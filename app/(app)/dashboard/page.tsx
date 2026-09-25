'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useDemoMode } from '@/components/demo/demo-mode-toggle'
import { useSalesDemo } from '@/lib/demo/sales-demo-data'
import { DEMO_LAST_SYNCED } from '@/lib/demo/demo-timestamps'
import { DashboardHero } from '@/components/dashboard/dashboard-hero'
import { RecommendedActionCard } from '@/components/dashboard/recommended-action-card'
import { DashboardMetricCard } from '@/components/dashboard/dashboard-metric-card'
import { InfrastructureIntelligence } from '@/components/dashboard/infrastructure-intelligence'
import { SystemIntelligenceCard } from '@/components/dashboard/system-intelligence-card'
import { SecurityComplianceSummary } from '@/components/dashboard/security-compliance-summary'
import { CostTrendsCard } from '@/components/dashboard/cost-trends-card'
import { SavingsOpportunities } from '@/components/dashboard/savings-opportunities'
import { ExecutiveRoiCard } from '@/components/dashboard/executive-roi-card'
import { EngineeringHealthCard } from '@/components/dashboard/engineering-health-card'
import { RecentActivityCard } from '@/components/dashboard/recent-activity-card'
import { useSoc2Readiness } from '@/lib/hooks/useSoc2Readiness'
import { useComplianceFrameworks } from '@/lib/hooks/useComplianceFrameworks'
import { useAISummary } from '@/lib/hooks/useAISummary'
import { useSystemIntelligence } from '@/lib/hooks/useSystemIntelligence'
import { useActivityFeed } from '@/lib/hooks/useActivityFeed'
import { accountSecurityFindingsService } from '@/lib/services/account-security-findings.service'
import { awsResourcesService } from '@/lib/services/aws-resources.service'
import { platformStatsService } from '@/lib/services/platform-stats.service'
import { monitoringService } from '@/lib/services/monitoring.service'
import { costRecommendationsService } from '@/lib/services/cost-recommendations.service'
import { computeDashboardAwsGates } from './dashboardAwsGates'
import { computeSecurityHealthKpi, SECURITY_STATUS_BADGE } from './securityHealthKpi'
import type { PlatformDashboardStats, CostRecommendation } from '@/lib/types'
import { useWebSocket } from '@/lib/hooks/useWebSocket'
import { toast } from 'sonner'
import { annualizeMonthly, formatSavingsCurrency } from '@/lib/utils'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/contexts/auth-context'
import { DollarSign, ShieldCheck, HeartPulse, Wifi, WifiOff } from 'lucide-react'

type CostRange = '7d' | '30d' | '90d' | '6mo' | '1yr'

// Precise (always-2-decimal) currency display for exact dollar figures like
// current spend -- same Intl.NumberFormat convention already used for money
// elsewhere in this app (e.g. app/(app)/invoices/page.tsx's formatCurrency).
// Distinct from formatSavingsCurrency, which is deliberately whole-dollar
// above $1 -- appropriate for describing savings opportunities loosely, not
// for a precise "this is your bill" figure.
const currencyFormatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

const DEMO_DASHBOARD_STATS = {
  monthlyAwsCost: 12847,
  costChange: 8,
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

const DEMO_TOP_RISK = 'Lambda invocation spike on payment-processor (+178%) — review before it affects downstream services.'

export default function DashboardPage() {
  const { organization } = useAuth()
  const { socket, isConnected } = useWebSocket()
  const queryClient = useQueryClient()
  const demoMode = useDemoMode()
  const { enabled: salesDemoMode } = useSalesDemo()
  const router = useRouter()
  const isDemoActive = demoMode || salesDemoMode

  const lastWsUpdateRef = useRef<Record<string, number>>({})
  const [costDateRange, setCostDateRange] = useState<CostRange>('7d')

  // Security Key Findings counts come from the same two repository reads the
  // risk score itself is built from (accountFindingsRepository.getStats and
  // resourcesRepository.getStats) via their own org-scoped endpoints, which
  // every plan can read -- not the Pro-gated /api/risk-score/trend, whose 402
  // made lower plans see a false "No open account-level findings" state.
  // Keyed by organization so an in-session org switch (router.refresh() only)
  // can never show the previous organization's cached counts.
  const { data: accountFindingStats, isLoading: accountFindingStatsLoading, isError: accountFindingStatsFailed } = useQuery({
    queryKey: ['account-security-findings-stats', organization?.id],
    queryFn: () => accountSecurityFindingsService.getStats(),
    enabled: !isDemoActive && !!organization?.id,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  })
  const { data: resourceStats, isLoading: resourceStatsLoading, isError: resourceStatsFailed } = useQuery({
    queryKey: ['aws-resources-stats', organization?.id],
    queryFn: () => awsResourcesService.getStats(),
    enabled: !isDemoActive && !!organization?.id,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  })
  // A disabled query (no organization yet) isn't "loading" to TanStack Query --
  // count that as loading too, so the card never flashes a false empty state.
  const securityFindingsLoading = !isDemoActive && (!organization?.id || accountFindingStatsLoading || resourceStatsLoading)
  // A failed request with nothing to show renders "Unavailable", never the empty
  // state. (A failed background refetch keeps showing the last successful data.)
  const findingsError = !isDemoActive && accountFindingStatsFailed && accountFindingStats === undefined
  const resourceComplianceError = !isDemoActive && resourceStatsFailed && resourceStats === undefined

  // Every tenant-data query below is keyed by organization (same pattern as the
  // two queries above) so one organization's cache entry can never be served to
  // another, and disabled until the organization is known.
  const { data: stats, isLoading: statsQueryLoading } = useQuery<PlatformDashboardStats>({
    queryKey: ['platform-dashboard-stats', organization?.id],
    queryFn: platformStatsService.getDashboardStats,
    // AWS cost data changes slowly — long staleTime/gcTime avoids re-hitting Cost Explorer
    // (billed per API call) on every render/tab-switch.
    staleTime: 4 * 60 * 60 * 1000, gcTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false, refetchOnMount: false, retry: false,
    enabled: !isDemoActive && !!organization?.id,
  })
  // Same reasoning as securityFindingsLoading: a query disabled only because the
  // organization isn't known yet still counts as loading, so the AWS gates and the
  // /connect-aws redirect never act on "no stats" before the stats could be fetched.
  const statsLoading = statsQueryLoading || (!isDemoActive && !organization?.id)

  const { data: systemHealth } = useQuery({
    queryKey: ['system-health'],
    queryFn: () => monitoringService.getSystemHealth(),
    staleTime: 60_000, refetchInterval: 300_000,
    refetchOnWindowFocus: false, refetchOnMount: false, retry: false,
    enabled: !isDemoActive,
  })

  // Same authoritative cost_recommendations boundary /costs and /cost-optimization
  // already consume, via costRecommendationsService -- no independent fetch/transform.
  const { data: costRecsRaw = [] } = useQuery<CostRecommendation[]>({
    queryKey: ['cost-recommendations', organization?.id],
    queryFn: () => costRecommendationsService.getAll({ status: 'ACTIVE' }),
    staleTime: 60_000, refetchInterval: 300_000,
    refetchOnWindowFocus: false, refetchOnMount: false, retry: false,
    enabled: !isDemoActive && !!organization?.id,
  })

  // Server-computed aggregate (same SUM /costs and /costs/efficiency use via
  // getStats()) rather than a client-side reduce over costRecsRaw.
  const { data: costRecStats } = useQuery({
    queryKey: ['cost-recommendations-stats', organization?.id],
    queryFn: costRecommendationsService.getStats,
    staleTime: 60_000, refetchInterval: 300_000,
    refetchOnWindowFocus: false, refetchOnMount: false, retry: false,
    enabled: !isDemoActive && !!organization?.id,
  })

  // Real evaluation-state signal: every wired cost-optimization detector
  // (EC2/EBS/RDS/S3/...) runs together inside one scan pass, tracked here --
  // so "has any scan completed" is sufficient to know every category has
  // actually been evaluated at least once, distinguishing a genuine zero
  // result from "never scanned." Same existing endpoint already exposed via
  // costRecommendationsService.getAnalysisRuns(), no backend change.
  const { data: analysisRuns } = useQuery({
    queryKey: ['cost-analysis-runs', organization?.id],
    queryFn: () => costRecommendationsService.getAnalysisRuns(5),
    staleTime: 60_000, refetchInterval: 300_000,
    refetchOnWindowFocus: false, refetchOnMount: false, retry: false,
    enabled: !isDemoActive && !!organization?.id,
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
    const invalidateAll = () => {
      queryClient.invalidateQueries({ queryKey: ['platform-dashboard-stats'] })
      queryClient.invalidateQueries({ queryKey: ['ai-summary'] })
      queryClient.invalidateQueries({ queryKey: ['activity-feed'] })
    }
    socket.on('metrics:costs', (data) => {
      if (!shouldUpdate('metrics:costs')) return
      if (data.totalCost > 0) toast.info('AWS costs updated', { description: `New total: $${data.totalCost.toFixed(2)}` })
      invalidateAll()
    })
    socket.on('alert:created', (data) => {
      if (!shouldUpdate('alert:created')) return
      toast.error(`New ${data.severity} Alert`, { description: data.message })
      invalidateAll()
    })
    socket.on('deployment:started', (data) => {
      if (!shouldUpdate('deployment:started')) return
      toast.info(`Deployment started: ${data.serviceName}`, { description: `Environment: ${data.environment} | By: ${data.deployedBy}` })
      invalidateAll()
    })
    socket.on('deployment:completed', (data) => {
      if (!shouldUpdate('deployment:completed')) return
      const isSuccess = data.status === 'success'
      toast[isSuccess ? 'success' : 'error'](`Deployment ${isSuccess ? 'succeeded' : 'failed'}: ${data.serviceName}`, { description: isSuccess ? `Duration: ${data.duration}` : 'Check logs for details' })
      invalidateAll()
    })
    socket.on('service:health', (data) => {
      if (!shouldUpdate('service:health')) return
      if (data.status !== 'healthy') toast.warning(`Service ${data.serviceName} is ${data.status}`, { description: `Health score: ${data.healthScore}%` })
      invalidateAll()
    })
    return () => {
      socket.off('metrics:costs'); socket.off('alert:created')
      socket.off('deployment:started'); socket.off('deployment:completed'); socket.off('service:health')
    }
  }, [socket, queryClient])

  const currentSpend    = isDemoActive ? DEMO_DASHBOARD_STATS.monthlyAwsCost : (stats?.monthlyAwsCost ?? 0)
  const costChange      = isDemoActive ? DEMO_DASHBOARD_STATS.costChange : (stats?.costChange ?? 0)
  // Raw (unrounded) monthly waste — kept separately so the annual projection can
  // round once after multiplying, matching costs/page.tsx and cost-optimization/page.tsx,
  // instead of rounding the monthly figure first and compounding the rounding error.
  const wasteAmountRaw  = isDemoActive ? 1922 : (costRecStats?.totalPotentialSavings ?? 0)
  // Deliberately NOT Math.round()'d: a genuine sub-$1 saving would round to 0 here,
  // falsifying every `wasteAmount > 0` gate below. Display sites use
  // formatSavingsCurrency(), which handles the sub-$1 case correctly.
  const wasteAmount     = wasteAmountRaw

  const { data: awsAccounts } = useQuery({
    queryKey: ['aws-accounts', organization?.id],
    queryFn: async () => {
      const token = document.cookie.split(';').find(c => c.trim().startsWith('auth-token='))?.split('=')[1] || localStorage.getItem('accessToken')
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'}/api/aws/accounts`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include'
      })
      const json = await res.json(); return json.data ?? []
    },
    staleTime: 30000,
    enabled: !!organization?.id,
  })

  const isAwsConnected = isDemoActive || (awsAccounts && awsAccounts.length > 0) || (!!stats && (stats.monthlyAwsCost > 0 || stats.activeDeployments > 0 || stats.totalServices > 0))
  // Compact severity breakdown for resource compliance — only rendered when the
  // backend has real counts to show; never fabricated when data is absent.
  // Account-level findings now render as individual severity rows in
  // SecurityComplianceSummary instead of one joined string (see findingCounts below).
  const formatSeverityCounts = (counts?: { critical: number; high: number; medium: number; low: number } | null) => {
    if (!counts) return null
    const parts: string[] = []
    if (counts.critical > 0) parts.push(`${counts.critical} Critical`)
    if (counts.high > 0) parts.push(`${counts.high} High`)
    if (counts.medium > 0) parts.push(`${counts.medium} Medium`)
    if (counts.low > 0) parts.push(`${counts.low} Low`)
    return parts.length > 0 ? parts.join(' · ') : null
  }
  const resourceComplianceBreakdown = formatSeverityCounts(resourceStats?.compliance_stats?.by_severity)

  const { hasBillingData, hasServicesOnly, isBillingSyncing, showRecommendationSections } =
    computeDashboardAwsGates({ isDemoActive, isAwsConnected, statsLoading, stats })

  useEffect(() => {
    if (!isDemoActive && !statsLoading && !isAwsConnected && awsAccounts !== undefined) {
      router.replace('/connect-aws')
    }
  }, [isDemoActive, statsLoading, isAwsConnected, awsAccounts, router])

  const { data: costTrend = [], isLoading: costTrendLoading } = useQuery<Array<{ date: string; compute: number; storage: number; database: number; network: number; other: number; total: number }>>({
    queryKey: ['cost-trend', costDateRange, organization?.id],
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
    // cache aggressively per range so switching 7d/30d/90d/6mo/1yr tabs reuses prior fetches.
    staleTime: 4 * 60 * 60 * 1000, gcTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false, refetchOnMount: false, retry: false,
    enabled: !isDemoActive && hasBillingData && !!organization?.id,
  })

  const monthOverMonthCostChange = isDemoActive ? null : computeMonthOverMonthCostChange(costTrend)
  const mtdCostDeltaColor = monthOverMonthCostChange !== null
    ? (monthOverMonthCostChange > 0 ? (currentSpend >= 100 ? 'var(--text-danger)' : 'var(--text-warning)') : monthOverMonthCostChange < 0 ? 'var(--text-success)' : 'var(--text-warning)')
    : 'var(--text-warning)'

  // Real-data-only, like every other computed-metric feature on this dashboard — no
  // demo-mode fabrication. Reuses the already-computed cost delta above so the backend
  // doesn't need a second, separately-billed Cost Explorer call to reference spend trend.
  const { data: aiSummaryData, isLoading: aiSummaryLoading } = useAISummary(organization?.id, monthOverMonthCostChange, !isDemoActive && hasBillingData)

  // Canonical System Intelligence score for the Infrastructure Health KPI --
  // same endpoint/cache the Infrastructure page reads, independent of
  // useAISummary's own narrative pipeline (still used above for Top Risk).
  const { data: systemIntelligence, isLoading: systemIntelligenceLoading } = useSystemIntelligence(organization?.id, !isDemoActive)

  // Security Posture KPI: the canonical System Intelligence security component's
  // own score + status (see computeSecurityHealthKpi) -- not the overall
  // status, and not the Pro-gated /api/risk-score/trend.
  const securityKpi = computeSecurityHealthKpi({
    isDemoActive,
    hasOrganization: !!organization?.id,
    isLoading: systemIntelligenceLoading,
    securityComponent: systemIntelligence?.components?.security,
  })

  // Real-data-only, hidden in demo mode — same pattern as AI Summary.
  const { data: activityFeedData, isLoading: activityFeedLoading, isError: activityFeedError } = useActivityFeed(organization?.id, !isDemoActive)

  // SOC 2 readiness and custom compliance frameworks — same hooks the Security /
  // Compliance pages themselves use, so this card never runs a second, divergent
  // calculation of either.
  const { data: soc2Criteria, isLoading: soc2Loading, error: soc2QueryError } = useSoc2Readiness(isAwsConnected)
  const { frameworks: customFrameworks, loading: customFrameworksLoading, error: customFrameworksFetchError } = useComplianceFrameworks()
  // Same rule as findingsError: without it a failed SOC 2 request reads as
  // "0 of 6 criteria evaluated" and a failed frameworks request as "No custom
  // frameworks yet". (useComplianceFrameworks only reports non-404 HTTP errors.)
  const soc2Error = !isDemoActive && !!soc2QueryError && soc2Criteria === undefined
  const customFrameworksError = !isDemoActive && !!customFrameworksFetchError && customFrameworks.length === 0

  const soc2EvaluatedCount = soc2Criteria?.filter((c) => c.evaluated).length ?? 0
  const soc2Total = soc2Criteria?.length ?? 6
  const soc2Subtext = isAwsConnected ? `${soc2EvaluatedCount} of ${soc2Total} criteria evaluated` : 'Not yet evaluated'
  const customFrameworksSubtext = isDemoActive
    ? '4 frameworks · Security Hub-backed'
    : customFrameworks.length > 0
      ? `${customFrameworks.length} framework${customFrameworks.length !== 1 ? 's' : ''} configured`
      : 'No custom frameworks yet'

  const costDeltaColor = costChange > 0 ? 'var(--text-danger)' : costChange < 0 ? 'var(--text-success)' : 'var(--text-warning)'

  const systemStatusLabel = isDemoActive ? 'healthy' : systemHealth?.status === 'operational' ? 'healthy' : systemHealth?.status === 'disrupted' ? 'down' : systemHealth?.status === 'degraded' ? 'degraded' : 'unknown'

  const systemStatusConfig = {
    healthy:  { color: 'var(--text-success)', background: 'var(--bg-success)', border: 'var(--border-success)', dot: 'var(--fill-success)', label: 'All systems operational' },
    degraded: { color: 'var(--text-warning)', background: 'var(--bg-warning)', border: 'var(--border-warning)', dot: 'var(--fill-warning)', label: 'Degraded performance detected' },
    down:     { color: 'var(--text-danger)', background: 'var(--bg-danger)', border: 'var(--border-danger)', dot: 'var(--fill-danger)', label: 'System outage detected' },
    unknown:  { color: 'var(--text-secondary)', background: 'var(--surface-1)', border: 'var(--border)', dot: 'var(--text-secondary)', label: 'Status pending' },
  } as const
  const statusConf = systemStatusConfig[systemStatusLabel as keyof typeof systemStatusConfig] || systemStatusConfig.unknown

  const topRecs: { label: string; savings: string; severity?: 'LOW' | 'MEDIUM' | 'HIGH' }[] = isDemoActive
    ? [
        { label: 'Right-size 3 EC2 instances',    savings: '$720/mo' },
        { label: 'Delete unattached EBS volumes', savings: '$210/mo' },
        { label: 'Enable S3 Intelligent-Tiering',  savings: '$340/mo' },
      ]
    : costRecsRaw.slice(0, 5).map(r => ({
        label:    r.issue || 'Can reduce monthly AWS spend',
        savings:  r.potentialSavings != null ? `${formatSavingsCurrency(r.potentialSavings)}/mo` : '',
        severity: r.severity,
      }))

  // Cost-saving opportunities, grouped by resource type from the already-fetched cost
  // recommendations — no new fetch. Structured as a list (not one variable per type)
  // so a newly-supported resource type only ever needs one new entry here, never a
  // UI restructure. All four types below ARE real, wired, currently-running detectors
  // in cost-optimization.service.ts (verified directly against the backend source,
  // not assumed) — none is hardcoded as unsupported.
  const priorityBadgeFor = (severity?: 'LOW' | 'MEDIUM' | 'HIGH') =>
    severity === 'HIGH' ? { label: 'High priority', color: 'var(--text-danger)', background: 'var(--bg-danger)' }
    : severity === 'MEDIUM' ? { label: 'Medium priority', color: 'var(--text-warning)', background: 'var(--bg-warning)' }
    : severity === 'LOW' ? { label: 'Low priority', color: 'var(--text-secondary)', background: 'var(--surface-2)' }
    : undefined
  const OPPORTUNITY_CATEGORIES: { type: string; title: string; description: string }[] = [
    // Idle-instance candidates (low 7-day average CPU) and Reserved Instance
    // coverage estimates -- not rightsizing, which DevControl does not do yet.
    { type: 'EC2', title: 'Review EC2 instances', description: 'Idle-instance candidates (low average CPU) and Reserved Instance coverage estimates' },
    { type: 'EBS', title: 'Optimize EBS volumes', description: 'Unattached volumes and gp2-to-gp3 migration opportunities' },
    { type: 'RDS', title: 'Optimize RDS storage', description: 'Database instances sized above actual load' },
    { type: 'S3', title: 'Optimize S3 storage', description: 'Lifecycle and storage-class opportunities' },
  ]
  const opportunityCategories = isDemoActive
    ? [
        { type: 'EC2', title: 'Review EC2 instances', description: 'Idle-instance candidates (low average CPU) and Reserved Instance coverage estimates', count: 2, savingsLabel: '$0.48/mo', priorityBadge: priorityBadgeFor('LOW') },
        { type: 'EBS', title: 'Optimize EBS volumes', description: 'Unattached volumes and gp2-to-gp3 migration opportunities', count: 3, savingsLabel: '$0.32/mo', priorityBadge: priorityBadgeFor('LOW') },
        { type: 'RDS', title: 'Optimize RDS storage', description: 'Database instances sized above actual load', count: 1, savingsLabel: '$0.16/mo', priorityBadge: priorityBadgeFor('MEDIUM') },
        { type: 'S3', title: 'Optimize S3 storage', description: 'Lifecycle and storage-class opportunities', count: 0, savingsLabel: '$0/mo', priorityBadge: undefined },
      ]
    : OPPORTUNITY_CATEGORIES.map((cat) => {
        const matches = costRecsRaw.filter((r) => r.resourceType === cat.type)
        // The server's de-duplicated per-type total, not a client-side sum: two
        // recommendations can draw on the same instance's cost (e.g. idle + RI).
        const total = costRecStats?.potentialSavingsByResourceType?.[cat.type]
        return {
          ...cat,
          count: matches.length,
          savingsLabel: matches.length === 0 ? '$0/mo' : total != null ? `${formatSavingsCurrency(total)}/mo` : '—',
          priorityBadge: priorityBadgeFor(matches[0]?.severity),
        }
      })

  // One evaluation-state signal for all categories. A completed run does NOT
  // mean every detector succeeded -- per-detector outcomes are not persisted
  // yet -- so a zero count is never presented as "nothing found"; the
  // components render no conclusion for it.
  const latestAnalysisRun = analysisRuns?.[0] ?? null
  const opportunityEvaluationState: 'evaluated' | 'not_evaluated' | 'in_progress' = isDemoActive
    ? 'evaluated'
    : latestAnalysisRun?.status === 'running'
      ? 'in_progress'
      : (analysisRuns?.some((r) => r.status === 'completed') ?? false)
        ? 'evaluated'
        : 'not_evaluated'

  // Single authoritative active-opportunity count, shared by the Recommended Action
  // CTA, its "Review Savings (N)" button, and Cost-Saving Opportunities' "View all (N)"
  // -- the server-computed aggregate (costRecStats.activeRecommendations), never
  // topRecs.length (a display-only slice capped at 5) used as a population proxy.
  const activeOpportunityCount = isDemoActive ? topRecs.length : (costRecStats?.activeRecommendations ?? topRecs.length)

  // Dashboard SUMMARY only: show signal, not every category. "Real signal" is an
  // active recommendation existing for that category (count > 0) -- deliberately
  // NOT potential_savings > 0, so a genuine $0-savings active recommendation (e.g.
  // today's S3 case) still counts and still shows. Categories with zero active
  // recommendations are only hidden here; opportunityCategories itself (all 4,
  // full "0 detected"/"Not currently evaluated" states) is untouched and remains
  // the source for the dedicated Cost Optimization page. Only filtered once a scan
  // has actually completed (evaluationState === 'evaluated') -- before that, every
  // category legitimately has count 0 for the unrelated reason that nothing has
  // run yet, which is a "not evaluated" state, not "zero signal", so the full
  // per-category list (each showing its own not-evaluated/in-progress label) is
  // kept instead of collapsing to the empty state below. Capped at 3 so this
  // summary scales with however many categories currently have signal rather than
  // always rendering a fixed grid.
  const dashboardOpportunityCategories = opportunityEvaluationState === 'evaluated'
    ? [...opportunityCategories].filter((cat) => cat.count > 0).sort((a, b) => b.count - a.count).slice(0, 3)
    : opportunityCategories

  // DORA metrics (industry-standard: deployment frequency, lead time, change
  // failure rate, MTTR — the same 4 metrics /app/dora-metrics reports on),
  // not the mockup's generic ops-metric names — this page has no authority
  // to rename what a DORA metric actually is. Demo-only decorative deltas.
  const doraRows: { label: string; value: string; delta?: { direction: 'up' | 'down'; label: string; good: boolean } }[] = [
    { label: 'Deployment Frequency',  value: isDemoActive ? '4.2/day' : '—', delta: isDemoActive ? { direction: 'up', label: '12%', good: true } : undefined },
    { label: 'Lead Time for Changes', value: isDemoActive ? '2.4 hours' : '—', delta: isDemoActive ? { direction: 'down', label: '18%', good: true } : undefined },
    { label: 'Change Failure Rate',   value: isDemoActive ? '8.3%' : '—', delta: isDemoActive ? { direction: 'down', label: '3%', good: true } : undefined },
    { label: 'Mean Time to Recovery', value: isDemoActive ? '36 min' : '—', delta: isDemoActive ? { direction: 'down', label: '22%', good: true } : undefined },
  ]

  const topRisk = isDemoActive ? DEMO_TOP_RISK : (aiSummaryData?.topRisk ?? null)

  // Infrastructure Health reads the canonical System Intelligence score
  // directly (same computation, same shared 2-minute cache the Infrastructure
  // page reads via GET /api/observability/intelligence -- see
  // useSystemIntelligence / system-intelligence.service.ts's 30/40/30
  // weighting) instead of an LLM-generated copy of it (aiSummaryData.
  // overallHealth.score), and never falls back to a locally-computed
  // approximation. When the canonical score isn't ready yet, this shows the
  // same "Calculating…" state below as before -- never an invented number.
  const displayedHealthScore = isDemoActive ? 87 : (systemIntelligence?.system_score ?? null)

  // Badge label is the canonical status from the same System Intelligence
  // response (scoreToStatus: >=85 Healthy, >=70 Stable, >=50 Degraded, else At
  // Risk) -- not a second, locally-invented tier with its own thresholds and
  // wording, which previously showed "Monitor" where the API said "Degraded".
  // 'Pending' (not ready) and a null score render no badge. Demo keeps its
  // fixed 87, which is 'Healthy' under the same thresholds.
  const displayedHealthStatus = isDemoActive ? 'Healthy' : (systemIntelligence?.status ?? null)
  const infraHealthBadge = displayedHealthScore === null ? undefined
    : displayedHealthStatus === 'Healthy' ? { label: 'Healthy', direction: 'up' as const, color: 'var(--text-success)' }
    : displayedHealthStatus === 'Stable' ? { label: 'Stable', direction: 'flat' as const, color: 'var(--text-success)' }
    : displayedHealthStatus === 'Degraded' ? { label: 'Degraded', direction: 'flat' as const, color: 'var(--text-warning)' }
    : displayedHealthStatus === 'At Risk' ? { label: 'At Risk', direction: 'down' as const, color: 'var(--text-danger)' }
    : undefined

  const orgName = isDemoActive ? 'WayUP Technology' : (organization?.displayName || organization?.name || 'your organization')

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 max-w-[1400px] mx-auto min-h-screen bg-[var(--surface-1)]">

      <DashboardHero
        isAwsConnected={isAwsConnected}
        orgName={orgName}
        lastSynced={isDemoActive ? DEMO_LAST_SYNCED : null}
      />

      {statsLoading ? null : isAwsConnected && (
        <>
          {showRecommendationSections && (
            <RecommendedActionCard
              opportunityCount={activeOpportunityCount}
              savingsLabel={wasteAmount > 0 ? `${formatSavingsCurrency(wasteAmount)}/month` : null}
              ctaHref="/cost-optimization"
              isDemoActive={isDemoActive}
            />
          )}

          {(hasServicesOnly || isBillingSyncing) && (
            <div className="bg-[var(--bg-warning)] border border-[var(--border-warning)] rounded-xl px-5 py-3 mb-6 flex items-center gap-3">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: 'var(--fill-warning)' }} />
              <span className="text-[13px]" style={{ color: 'var(--text-warning)' }}>
                {hasServicesOnly
                  ? 'Historical billing data is still syncing. Infrastructure scanning and security analysis are fully operational — cost totals will be available within 24–48 hours.'
                  : 'Billing sync in progress (24–48h) — infrastructure and security data are ready now.'}
              </span>
            </div>
          )}

          {/* ── PRIMARY KPI ROW ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-6">
            <DashboardMetricCard
              icon={DollarSign}
              iconColor="var(--text-success)"
              iconBackground="var(--bg-success)"
              label="Monthly Spend"
              value={(statsLoading && !isDemoActive) || (currentSpend === 0 && !isDemoActive) ? 'Syncing…' : currencyFormatter.format(currentSpend)}
              trend={
                isDemoActive
                  ? { direction: costChange > 0 ? 'up' : costChange < 0 ? 'down' : 'flat', label: `${costChange > 0 ? '+' : ''}${Math.abs(costChange)}% vs last 30 days`, color: costDeltaColor }
                  : monthOverMonthCostChange !== null
                    ? { direction: monthOverMonthCostChange > 0 ? 'up' : monthOverMonthCostChange < 0 ? 'down' : 'flat', label: `${monthOverMonthCostChange > 0 ? '+' : ''}${monthOverMonthCostChange}% vs last month`, color: mtdCostDeltaColor }
                    : undefined
              }
              sparkline={hasBillingData || isDemoActive ? (isDemoActive ? generateCostBreakdownData().map((_, i) => ({ value: 8000 + i * 900 })) : costTrend.map(d => ({ value: d.total }))) : undefined}
              href="/costs"
            />

            <DashboardMetricCard
              icon={ShieldCheck}
              iconColor="var(--text-accent)"
              iconBackground="var(--bg-accent)"
              label="Security Posture"
              value={securityKpi.value}
              valueSuffix={securityKpi.score === null ? undefined : '/100'}
              valueColor={securityKpi.score === null ? undefined : securityKpi.badge?.color}
              trend={securityKpi.badge ? { direction: securityKpi.badge.direction, label: securityKpi.badge.label, color: securityKpi.badge.color } : undefined}
              href="/security"
            />

            <DashboardMetricCard
              icon={HeartPulse}
              iconColor="var(--text-accent)"
              iconBackground="var(--bg-accent)"
              label="Infrastructure Health"
              value={displayedHealthScore === null ? 'Calculating…' : String(displayedHealthScore)}
              valueSuffix={displayedHealthScore === null ? undefined : '/100'}
              trend={infraHealthBadge ? { direction: infraHealthBadge.direction, label: infraHealthBadge.label, color: infraHealthBadge.color } : undefined}
              href="/infrastructure"
            />
          </div>

          <InfrastructureIntelligence
            topRisk={topRisk}
            aiSummaryLoading={!isDemoActive && aiSummaryLoading}
            systemStatus={{ label: statusConf.label, color: statusConf.color, background: statusConf.background, dotColor: statusConf.dot }}
            isLive={isConnected}
          />

          {/* ── PLATFORM EFFICIENCY BREAKDOWN ── */}
          {/* Same already-fetched systemIntelligence as the Infrastructure Health KPI -- no second query. */}
          <SystemIntelligenceCard
            isDemoActive={isDemoActive}
            components={systemIntelligence?.components}
            isLoading={!isDemoActive && (systemIntelligenceLoading || !organization?.id)}
            statusBadge={SECURITY_STATUS_BADGE}
          />

          {/* ── AWS COST TRENDS + SECURITY KEY FINDINGS ── */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mb-6">
            <div className="lg:col-span-3">
              <CostTrendsCard
                isDemoActive={isDemoActive}
                hasBillingData={hasBillingData}
                costTrend={costTrend}
                costTrendLoading={costTrendLoading}
                demoBreakdownData={generateCostBreakdownData()}
                demoTotalCost={DEMO_DASHBOARD_STATS.monthlyAwsCost}
                dateRange={costDateRange}
                onDateRangeChange={setCostDateRange}
                onExport={() => { toast.success('Exporting cost data...') }}
              />
            </div>
            <div className="lg:col-span-2">
              <SecurityComplianceSummary
                findingCounts={isDemoActive ? { critical: 1, high: 3, medium: 5, low: 0 } : (accountFindingStats?.bySeverity ?? null)}
                riskDataLoading={securityFindingsLoading}
                complianceBreakdown={resourceComplianceBreakdown}
                soc2Subtext={soc2Subtext}
                soc2Loading={!isDemoActive && soc2Loading}
                customFrameworksSubtext={customFrameworksSubtext}
                customFrameworksLoading={!isDemoActive && customFrameworksLoading}
                findingsError={findingsError}
                resourceComplianceError={resourceComplianceError}
                soc2Error={soc2Error}
                customFrameworksError={customFrameworksError}
              />
            </div>
          </div>

          {/* ── COST-SAVING OPPORTUNITIES + EXECUTIVE ROI ── */}
          {/* Derived from cost_recommendations, not AWS billing data -- shown as soon as
              the initial discovery scan has run once, independent of hasBillingData/
              hasServicesOnly (the separate, much slower 24-48h Cost Explorer billing
              sync). */}
          {showRecommendationSections && (
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mb-6">
              <div className="lg:col-span-3">
                <SavingsOpportunities
                  items={dashboardOpportunityCategories}
                  evaluationState={opportunityEvaluationState}
                  totalActiveCount={activeOpportunityCount}
                />
              </div>
              <div className="lg:col-span-2">
                <ExecutiveRoiCard
                  monthlySavingsLabel={wasteAmount > 0 ? formatSavingsCurrency(wasteAmount) : null}
                  annualSavingsLabel={wasteAmount > 0 ? formatSavingsCurrency(annualizeMonthly(wasteAmountRaw)) : null}
                  isDemoActive={isDemoActive}
                />
              </div>
            </div>
          )}

          {/* ── ENGINEERING HEALTH + RECENT ACTIVITY ── */}
          {/* RecentActivityCard is legitimately absent in demo mode (real-data-only,
              matching every other real-data-only feature on this dashboard) -- so
              Engineering Health spans the full row there instead of leaving an empty
              second column. Real mode keeps the two-column layout. */}
          {isDemoActive ? (
            <div className="mb-6">
              <EngineeringHealthCard isDemoActive={isDemoActive} doraRows={doraRows} />
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              <EngineeringHealthCard isDemoActive={isDemoActive} doraRows={doraRows} />
              <RecentActivityCard isDemoActive={isDemoActive} data={activityFeedData} isLoading={activityFeedLoading} isError={activityFeedError} />
            </div>
          )}

          {/* ── OPTIONAL LIVE STATUS ── */}
          <div className="flex items-center gap-2 mt-2 mb-2">
            {isConnected ? <Wifi size={13} className="text-[var(--text-secondary)]" /> : <WifiOff size={13} className="text-[var(--text-secondary)]" />}
            <span className="text-xs text-[var(--text-secondary)]">
              {isConnected ? 'Real-time monitoring active' : 'Reconnecting…'} · data updates based on source availability
            </span>
          </div>
        </>
      )}
    </div>
  )
}
