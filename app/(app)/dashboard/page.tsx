'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useDemoMode } from '@/components/demo/demo-mode-toggle'
import { useSalesDemo } from '@/lib/demo/sales-demo-data'
import { DEMO_LAST_SYNCED } from '@/lib/demo/demo-timestamps'
import { DashboardHero } from '@/components/dashboard/dashboard-hero'
import { DashboardUnconnectedPreview } from '@/components/dashboard/dashboard-unconnected-preview'
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
import { computeAwsConnectionState } from './dashboardAwsConnection'
import { computeDashboardSpendCard } from './dashboardSpendCard'
import { computeSecurityEvidence, computeSecurityHealthKpi, resourceComplianceLine, resourceIssueCount, SECURITY_STATUS_BADGE, securityKpiCaption, securityScopeCaption } from './securityHealthKpi'
import { costComponentCaption, INFRASTRUCTURE_POSTURE_LABEL, postureCompositionCaption, postureStatusLabel } from '@/lib/infrastructure-posture'
import { EvidenceSection } from '@/components/dashboard/evidence-info'
import { PostureEvidence } from '@/components/dashboard/posture-evidence'
import { ResourceChecksSection } from '@/components/dashboard/resource-checks-section'
import { toneFillClass } from '@/components/dashboard/evidence-badge'
import type { PlatformDashboardStats, CostRecommendation, CostSummary } from '@/lib/types'
import { useWebSocket } from '@/lib/hooks/useWebSocket'
import { toast } from 'sonner'
import { annualizeMonthly, formatSavingsCents } from '@/lib/utils'
import { deriveAnalysisStatus, pickLatestAnalysis } from '../cost-optimization/costOptimizationStatus'
import { roundCents } from '../costs/cost-display'
import type { OpportunityEvaluationState } from '@/components/dashboard/savings-opportunities'
import { useAuth } from '@/lib/contexts/auth-context'
import { useCurrentRole } from '@/lib/hooks/use-current-role'
import { DollarSign, ShieldCheck, Gauge, Wifi, WifiOff } from 'lucide-react'

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

const DEMO_TOP_RISK = 'Lambda invocation spike on payment-processor (+178%) — review before it affects downstream services.'

export default function DashboardPage() {
  const { organization } = useAuth()
  const { socket, isConnected } = useWebSocket()
  const queryClient = useQueryClient()
  const demoMode = useDemoMode()
  const { enabled: salesDemoMode } = useSalesDemo()
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
  // connection state never act on "no stats" before the stats could be fetched.
  const statsLoading = statsQueryLoading || (!isDemoActive && !organization?.id)

  // The spend KPI's figure and month-over-month comparison, as evidence sections
  // (actual Cost Explorer / inventory estimate / unavailable / error) -- the same
  // endpoint the Costs page reads. `stats` above still drives the AWS connection
  // gates and the connection state; this never feeds them.
  const { data: costSummary, isLoading: costSummaryQueryLoading, isError: costSummaryError } = useQuery<CostSummary>({
    queryKey: ['platform-cost-summary', organization?.id],
    queryFn: platformStatsService.getCostSummary,
    staleTime: 4 * 60 * 60 * 1000, gcTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false, refetchOnMount: false, retry: false,
    enabled: !isDemoActive && !!organization?.id,
  })
  const costSummaryLoading = costSummaryQueryLoading || (!isDemoActive && !organization?.id)

  const { data: systemHealth } = useQuery({
    queryKey: ['system-health'],
    queryFn: () => monitoringService.getSystemHealth(),
    staleTime: 60_000, refetchInterval: 300_000,
    refetchOnWindowFocus: false, refetchOnMount: false, retry: false,
    enabled: !isDemoActive,
  })

  // Same authoritative cost_recommendations boundary /costs and /cost-optimization
  // already consume, via costRecommendationsService -- no independent fetch/transform.
  const { data: costRecsRaw = [], isLoading: costRecsLoading, isError: costRecsFailed } = useQuery<CostRecommendation[]>({
    queryKey: ['cost-recommendations', organization?.id],
    queryFn: () => costRecommendationsService.getAll({ status: 'ACTIVE' }),
    staleTime: 60_000, refetchInterval: 300_000,
    refetchOnWindowFocus: false, refetchOnMount: false, retry: false,
    enabled: !isDemoActive && !!organization?.id,
  })

  // Server-computed aggregate (same SUM /costs and /costs/efficiency use via
  // getStats()) rather than a client-side reduce over costRecsRaw.
  const { data: costRecStats, isError: costRecStatsFailed } = useQuery({
    queryKey: ['cost-recommendations-stats', organization?.id],
    queryFn: costRecommendationsService.getStats,
    staleTime: 60_000, refetchInterval: 300_000,
    refetchOnWindowFocus: false, refetchOnMount: false, retry: false,
    enabled: !isDemoActive && !!organization?.id,
  })

  // Cost analysis runs both manually (cost_analysis_runs) and inside the
  // scheduled discovery job (resource_discovery_jobs.cost_analysis_completed).
  // Both histories feed pickLatestAnalysis() + deriveAnalysisStatus() below --
  // the same evaluation state /costs and /cost-optimization show.
  const { data: analysisRuns, isLoading: analysisRunsLoading, isError: analysisRunsFailed } = useQuery({
    queryKey: ['cost-analysis-runs', organization?.id],
    queryFn: () => costRecommendationsService.getAnalysisRuns(5),
    staleTime: 60_000, refetchInterval: 300_000,
    refetchOnWindowFocus: false, refetchOnMount: false, retry: false,
    enabled: !isDemoActive && !!organization?.id,
  })
  const { data: discoveryJobs, isLoading: discoveryJobsLoading, isError: discoveryJobsFailed } = useQuery({
    queryKey: ['discovery-jobs', organization?.id],
    queryFn: () => awsResourcesService.getDiscoveryJobs(5),
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
      queryClient.invalidateQueries({ queryKey: ['platform-cost-summary'] })
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

  // Demo-only: real mode's spend trend comes from spendCard below.
  const costChange      = DEMO_DASHBOARD_STATS.costChange
  // The estimated monthly savings (the same getStats() total every savings
  // surface reads), rounded to cents once. Every dashboard savings figure is
  // shown at cent precision (formatSavingsCents) and the annual figure is this
  // same cent-rounded monthly amount x 12, so the two always visibly agree
  // ($5.17/month -> $62.04/year). A real sub-$1 saving stays > 0.
  const monthlySavings = isDemoActive ? 1922 : roundCents(costRecStats?.totalPotentialSavings ?? 0)
  const annualSavings = roundCents(annualizeMonthly(monthlySavings))

  const { data: awsAccounts, isError: awsAccountsError } = useQuery<unknown[]>({
    queryKey: ['aws-accounts', organization?.id],
    queryFn: async () => {
      const token = document.cookie.split(';').find(c => c.trim().startsWith('auth-token='))?.split('=')[1] || localStorage.getItem('accessToken')
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'}/api/aws/accounts`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include'
      })
      // A failed request is an error, not an organization with no accounts.
      if (!res.ok) throw new Error('The AWS accounts could not be retrieved')
      const json = await res.json()
      if (!Array.isArray(json?.data)) throw new Error('The AWS accounts response was not a list')
      return json.data
    },
    // One retry, so a single transient failure is not reported as "couldn't check".
    staleTime: 30000, retry: 1,
    enabled: !!organization?.id,
  })

  // connected / unconnected / unknown / loading. A failed accounts request with
  // no earlier result is "unknown", never "unconnected". (A failed background
  // refetch keeps the last successful list.)
  const awsConnection = computeAwsConnectionState({
    isDemoActive,
    awsAccounts,
    awsAccountsFailed: awsAccountsError && awsAccounts === undefined,
    statsLoading,
    stats,
  })
  const isAwsConnected = awsConnection === 'connected'
  // Only an owner can connect AWS. The role is the access token's claim (display
  // only); until it is known, or if it is absent, the non-owner version is shown.
  const isOwner = useCurrentRole() === 'owner'
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

  const { data: costTrend = [], isLoading: costTrendLoading, isError: costTrendError } = useQuery<Array<{ date: string; compute: number; storage: number; database: number; network: number; other: number; total: number }>>({
    queryKey: ['cost-trend', costDateRange, organization?.id],
    queryFn: async () => {
      const token = document.cookie.split(';').find(c => c.trim().startsWith('auth-token='))?.split('=')[1] || localStorage.getItem('accessToken')
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'}/api/platform/costs/trend?range=${costDateRange}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
      })
      // A failed request is an error, not an empty (zero-spend) series.
      if (!res.ok) throw new Error('The AWS Cost Explorer trend could not be retrieved')
      const json = await res.json()
      return json.data ?? []
    },
    // Cost Explorer is billed per API call and this data doesn't change minute-to-minute —
    // cache aggressively per range so switching 7d/30d/90d/6mo/1yr tabs reuses prior fetches.
    staleTime: 4 * 60 * 60 * 1000, gcTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false, refetchOnMount: false, retry: false,
    enabled: !isDemoActive && hasBillingData && !!organization?.id,
  })

  // Real mode: the backend's month-to-date vs same-days-last-month comparison, never
  // computed here from whichever trend range is selected.
  const spendCard = isDemoActive ? null : computeDashboardSpendCard({ costSummary, isLoading: costSummaryLoading, isError: costSummaryError })

  // Real-data-only, like every other computed-metric feature on this dashboard — no
  // demo-mode fabrication. The backend gathers its own cost evidence through the shared
  // AI Chat cost-context path (per-org cached Cost Explorer results); nothing is sent from here.
  // Only for a connected organization: the backend generates the summary with a
  // model call even when every source is unavailable, so an organization with
  // nothing connected would be billed for a summary of nothing.
  const { data: aiSummaryData, isLoading: aiSummaryLoading } = useAISummary(organization?.id, !isDemoActive && isAwsConnected)

  // Canonical System Intelligence score for the Infrastructure Posture KPI --
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
    ? 'CIS AWS · PCI-DSS · NIST 800-53 · Security Hub-backed'
    : customFrameworks.length > 0
      ? `${customFrameworks.length} framework${customFrameworks.length !== 1 ? 's' : ''} configured`
      : 'No custom frameworks yet'

  const costDeltaColor = costChange > 0 ? 'var(--text-danger)' : costChange < 0 ? 'var(--text-success)' : 'var(--text-warning)'

  const systemStatusLabel = isDemoActive ? 'healthy' : systemHealth?.status === 'operational' ? 'healthy' : systemHealth?.status === 'disrupted' ? 'down' : systemHealth?.status === 'degraded' ? 'degraded' : 'unknown'

  // systemHealth is DevControl's own /health check (API + database), not the
  // customer's AWS -- each state's one caption says so. "Responding" is only
  // claimed when that check reports operational; the other states keep their
  // existing wording.
  const systemStatusConfig = {
    healthy:  { color: 'var(--text-success)', dot: 'var(--fill-success)', value: 'Operational', caption: 'API and database responding · not your AWS resources' },
    degraded: { color: 'var(--text-warning)', dot: 'var(--fill-warning)', value: 'Degraded', caption: "DevControl's own services are degraded. Not a status of your AWS resources." },
    down:     { color: 'var(--text-danger)', dot: 'var(--fill-danger)', value: 'Not responding', caption: "DevControl's API is not responding normally. Not a status of your AWS resources." },
    unknown:  { color: 'var(--text-secondary)', dot: 'var(--text-secondary)', value: 'Checking', caption: "Checking DevControl's own service status." },
  } as const
  const statusConf = systemStatusConfig[systemStatusLabel as keyof typeof systemStatusConfig] || systemStatusConfig.unknown

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
          savingsLabel: matches.length === 0 ? `${formatSavingsCents(0)}/mo` : total != null ? `${formatSavingsCents(roundCents(total))}/mo` : '—',
          priorityBadge: priorityBadgeFor(matches[0]?.severity),
        }
      })

  // One evaluation-state signal for all categories: the shared
  // pickLatestAnalysis() + deriveAnalysisStatus() over both the scheduled
  // (discovery job) and manual analysis histories -- the same state /costs and
  // /cost-optimization show, not a second derivation. A completed analysis does
  // NOT mean every detector succeeded (per-detector outcomes are not persisted
  // yet), so it only qualifies a zero count; a card with an active
  // recommendation shows it whatever this says. A failed request is
  // 'unavailable', never "not evaluated" or a zero.
  const analysisStatus = deriveAnalysisStatus({
    awsConnected: isAwsConnected,
    latestAnalysis: pickLatestAnalysis({ latestDiscoveryJob: discoveryJobs?.[0], latestAnalysisRun: analysisRuns?.[0] }),
    activeCount: costRecStats?.activeRecommendations ?? 0,
    totalEverCount: costRecStats?.totalRecommendations ?? 0,
  })
  const opportunityEvaluationState: OpportunityEvaluationState = isDemoActive
    ? 'evaluated'
    : (analysisRunsFailed && !analysisRuns) || (discoveryJobsFailed && !discoveryJobs) || costRecsFailed
      ? 'unavailable'
      : !organization?.id || analysisRunsLoading || discoveryJobsLoading || costRecsLoading || analysisStatus === 'loading'
        ? 'loading'
        : analysisStatus === 'in_progress' ? 'in_progress'
        : analysisStatus === 'failed' ? 'failed'
        : analysisStatus.startsWith('completed') ? 'evaluated'
        : 'not_evaluated'

  // Single authoritative active-opportunity count, shared by the Recommended Action
  // CTA and Cost-Saving Opportunities' "View all (N)" -- the server-computed
  // aggregate (costRecStats.activeRecommendations). When that request fails there
  // is no count (null), never one rebuilt from the capped recommendations list.
  const DEMO_OPPORTUNITY_COUNT = 3
  const activeOpportunityCount: number | null = isDemoActive
    ? DEMO_OPPORTUNITY_COUNT
    : costRecStatsFailed && !costRecStats ? null : (costRecStats?.activeRecommendations ?? null)

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
  // No summary (disabled, failed, or not yet returned) is 'unavailable', never "no risks".
  const topRiskStatus = isDemoActive ? 'identified' as const : (aiSummaryData?.topRiskStatus ?? 'unavailable')

  // Infrastructure Posture reads the canonical System Intelligence score
  // directly (same computation, same shared 2-minute cache the Infrastructure
  // page reads via GET /api/observability/intelligence -- see
  // useSystemIntelligence / system-intelligence.service.ts's 30/40/30
  // weighting) instead of an LLM-generated copy of it (aiSummaryData.
  // overallHealth.score), and never falls back to a locally-computed
  // approximation. When the canonical score isn't ready yet, this shows the
  // same "Calculating…" state below as before -- never an invented number.
  const displayedHealthScore = isDemoActive ? 87 : (systemIntelligence?.system_score ?? null)

  // Badge is the canonical status from the same System Intelligence response
  // (scoreToStatus: >=85 Healthy, >=70 Stable, >=50 Degraded, else At Risk) --
  // never a locally-invented tier. Only its display words change (see
  // postureStatusLabel): the composite is a posture score, so it is never shown
  // as "Healthy"/"Degraded". 'Pending' (not ready) and a null score render no
  // badge. Demo keeps its fixed 87, which is 'Healthy' under the same thresholds.
  const displayedHealthStatus = isDemoActive ? 'Healthy' : (systemIntelligence?.status ?? null)
  const postureBadgeLabel = postureStatusLabel(displayedHealthStatus)
  const infraHealthBadge = displayedHealthScore === null || postureBadgeLabel === null ? undefined
    : displayedHealthStatus === 'Healthy' ? { label: postureBadgeLabel, direction: 'up' as const, color: 'var(--text-success)' }
    : displayedHealthStatus === 'Stable' ? { label: postureBadgeLabel, direction: 'flat' as const, color: 'var(--text-success)' }
    : displayedHealthStatus === 'Degraded' ? { label: postureBadgeLabel, direction: 'flat' as const, color: 'var(--text-warning)' }
    : { label: postureBadgeLabel, direction: 'down' as const, color: 'var(--text-danger)' }

  // The backend's composite_state, read as-is: the frontend never derives it.
  const postureIsPartial = !isDemoActive && displayedHealthScore !== null && systemIntelligence?.composite_state === 'partial'
  const postureValue = displayedHealthScore !== null
    ? String(displayedHealthScore)
    : (!isDemoActive && (systemIntelligenceLoading || !organization?.id)) ? 'Calculating…' : '—'

  // One resource compliance input set for the Security Posture panel and Key
  // Findings, both read through resourceComplianceLine().
  const resourceComplianceInputs = {
    complianceBreakdown: resourceComplianceBreakdown,
    complianceCountsReported: !!resourceStats?.compliance_stats?.by_severity,
    resourceScanCompleted: resourceStats?.scan_completed,
    resourceComplianceError,
  }
  const securityEvidence = computeSecurityEvidence({
    isDemoActive,
    isLoading: securityFindingsLoading,
    findingCounts: accountFindingStats?.bySeverity,
    findingsError,
    ...resourceComplianceInputs,
    securityComponent: systemIntelligence?.components?.security,
  })

  // One face caption per card/tile, each from data already loaded here;
  // null (omitted) whenever its data is loading, failed, or absent.
  const resourceIssues = resourceIssueCount({ bySeverity: resourceStats?.compliance_stats?.by_severity, resourceComplianceError })
  const securityCaption = securityKpiCaption({
    isDemoActive,
    isLoading: securityFindingsLoading,
    findingCounts: accountFindingStats?.bySeverity,
    findingsError,
    resourceIssues,
    resourceScanCompleted: resourceStats?.scan_completed,
    resourceComplianceError,
  })
  const postureCaption = isDemoActive || displayedHealthScore === null ? null : postureCompositionCaption(systemIntelligence?.components)
  const postureTileCaptions = {
    cost: costComponentCaption(systemIntelligence?.components?.cost),
    security: securityFindingsLoading ? null : securityScopeCaption({ findingCounts: accountFindingStats?.bySeverity, findingsError, resourceIssues }),
  }

  const orgName = isDemoActive ? 'WayUP Technology' : (organization?.displayName || organization?.name || 'your organization')

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 max-w-[1400px] mx-auto min-h-screen bg-[var(--surface-1)]">

      <DashboardHero
        awsConnection={awsConnection}
        canConnectAws={isOwner}
        orgName={orgName}
        lastSynced={isDemoActive ? DEMO_LAST_SYNCED : null}
      />

      {/* Only when AWS is known to be unconnected -- never while loading or unknown. */}
      {awsConnection === 'unconnected' && <DashboardUnconnectedPreview canConnectAws={isOwner} />}
      {awsConnection === 'unknown' && (
        <p className="text-[13px] text-[var(--text-secondary)] mb-6" data-testid="aws-connection-line" data-state="unknown">
          Couldn&apos;t check your AWS connection. Refresh to try again.
        </p>
      )}

      {statsLoading ? null : isAwsConnected && (
        <>
          {showRecommendationSections && (
            <RecommendedActionCard
              opportunityCount={activeOpportunityCount ?? 0}
              savingsLabel={monthlySavings > 0 ? `${formatSavingsCents(monthlySavings)}/month` : null}
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

          {/* ── SECTION 1: KPI ROW ── */}
          {/* Equal heights come from the grid's stretch, not fixed pixel heights. */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-6" data-testid="kpi-row">
            <DashboardMetricCard
              icon={DollarSign}
              iconColor="var(--text-success)"
              iconBackground="var(--bg-success)"
              label={spendCard ? spendCard.label : 'Monthly Spend'}
              value={spendCard ? spendCard.value : currencyFormatter.format(DEMO_DASHBOARD_STATS.monthlyAwsCost)}
              badges={
                spendCard
                  ? (spendCard.trend ? [{ label: spendCard.trend.label, color: spendCard.trend.color, direction: spendCard.trend.direction, testId: 'spend-change' }] : undefined)
                  : [{ label: `${costChange > 0 ? '+' : ''}${Math.abs(costChange)}% vs last 30 days`, color: costDeltaColor, direction: costChange > 0 ? 'up' : costChange < 0 ? 'down' : 'flat' }]
              }
              caption={spendCard?.caption}
              sparkline={hasBillingData || isDemoActive ? (isDemoActive ? generateCostBreakdownData().map((_, i) => ({ value: 8000 + i * 900 })) : costTrend.map(d => ({ value: d.total }))) : undefined}
              info={spendCard?.evidence ? {
                align: 'start',
                content: (
                  <>
                    <EvidenceSection heading="Source">
                      <p className="m-0">{spendCard.evidence.source}</p>
                    </EvidenceSection>
                    <EvidenceSection heading="Comparison">
                      <p className="m-0">{spendCard.evidence.comparison}</p>
                    </EvidenceSection>
                  </>
                ),
              } : undefined}
              link={{ href: '/costs', label: 'Open costs' }}
            />

            <DashboardMetricCard
              icon={ShieldCheck}
              iconColor="var(--text-accent)"
              iconBackground="var(--bg-accent)"
              label="Security Posture"
              value={securityKpi.value}
              valueSuffix={securityKpi.score === null ? undefined : '/ 100'}
              badges={securityKpi.badge ? [{ label: securityKpi.badge.label, color: securityKpi.badge.color, direction: securityKpi.badge.direction, testId: 'security-status' }] : undefined}
              caption={securityCaption}
              progress={securityKpi.score === null || !securityKpi.badge ? undefined : {
                value: securityKpi.score,
                fillClassName: toneFillClass(securityKpi.badge.color),
                ariaValueText: `${securityKpi.score} of 100, ${securityKpi.badge.label}`,
              }}
              info={isDemoActive ? undefined : {
                content: (
                  <>
                    <EvidenceSection heading="Active findings">
                      <ul className="list-none m-0 p-0">
                        {securityEvidence.findings.map((line) => <li key={line}>{line}</li>)}
                        {securityEvidence.resourceCompliance && <li>{securityEvidence.resourceCompliance}</li>}
                      </ul>
                    </EvidenceSection>
                    {securityEvidence.evaluation && (
                      <EvidenceSection heading="Evaluation">
                        <p className="m-0">{securityEvidence.evaluation}</p>
                      </EvidenceSection>
                    )}
                  </>
                ),
              }}
              link={{ href: '/security', label: 'Open security findings' }}
            />

            <DashboardMetricCard
              icon={Gauge}
              iconColor="var(--text-accent)"
              iconBackground="var(--bg-accent)"
              label={INFRASTRUCTURE_POSTURE_LABEL}
              value={postureValue}
              valueSuffix={displayedHealthScore === null ? undefined : '/ 100'}
              badges={[
                ...(infraHealthBadge ? [{ label: infraHealthBadge.label, color: infraHealthBadge.color, direction: infraHealthBadge.direction, testId: 'posture-status' }] : []),
                ...(postureIsPartial ? [{ label: 'Partial', color: 'var(--text-secondary)', testId: 'posture-partial' }] : []),
              ]}
              caption={postureCaption}
              progress={displayedHealthScore === null || !infraHealthBadge ? undefined : {
                value: displayedHealthScore,
                fillClassName: toneFillClass(infraHealthBadge.color),
                ariaValueText: `${displayedHealthScore} of 100, ${infraHealthBadge.label}${postureIsPartial ? ', partial' : ''}`,
              }}
              info={{
                content: <PostureEvidence components={isDemoActive ? undefined : systemIntelligence?.components} statusBadge={SECURITY_STATUS_BADGE} />,
              }}
              link={{ href: '/infrastructure', label: 'Open infrastructure' }}
            />
          </div>

          {/* ── SECTION 2: TOP RISK + DEVCONTROL SYSTEM HEALTH ── */}
          <InfrastructureIntelligence
            topRisk={topRisk}
            topRiskStatus={topRiskStatus}
            aiSummaryLoading={!isDemoActive && aiSummaryLoading}
            systemStatus={{ value: statusConf.value, caption: statusConf.caption, operational: systemStatusLabel === 'healthy', color: statusConf.color, dotColor: statusConf.dot }}
          />

          {/* ── SECTION 3: INFRASTRUCTURE POSTURE ── */}
          {/* Same already-fetched systemIntelligence as the Infrastructure Posture KPI -- no second query. */}
          <SystemIntelligenceCard
            isDemoActive={isDemoActive}
            components={systemIntelligence?.components}
            isLoading={!isDemoActive && (systemIntelligenceLoading || !organization?.id)}
            statusBadge={SECURITY_STATUS_BADGE}
            captions={postureTileCaptions}
            compositeState={systemIntelligence?.composite_state ?? null}
          />

          {/* ── RESOURCE CHECKS ── */}
          {/* Canonical /api/cloudwatch/metrics results, requested only once scrolled into view.
              Watched only after everything above has loaded: their loading skeletons are
              shorter, and would otherwise pull this section into view on page load. */}
          <ResourceChecksSection
            isDemoActive={isDemoActive}
            organizationId={organization?.id}
            aboveLoaded={!costSummaryLoading && !securityFindingsLoading && !systemIntelligenceLoading && !aiSummaryLoading}
          />

          {/* ── AWS COST TRENDS + SECURITY KEY FINDINGS ── */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mb-6">
            <div className="lg:col-span-3">
              <CostTrendsCard
                isDemoActive={isDemoActive}
                hasBillingData={hasBillingData}
                costTrend={costTrend}
                costTrendLoading={costTrendLoading}
                costTrendError={costTrendError}
                demoBreakdownData={generateCostBreakdownData()}
                demoTotalCost={DEMO_DASHBOARD_STATS.monthlyAwsCost}
                dateRange={costDateRange}
                onDateRangeChange={setCostDateRange}
              />
            </div>
            <div className="lg:col-span-2">
              <SecurityComplianceSummary
                findingCounts={isDemoActive ? { critical: 1, high: 3, medium: 5, low: 0 } : (accountFindingStats?.bySeverity ?? null)}
                riskDataLoading={securityFindingsLoading}
                resourceComplianceStatus={resourceComplianceLine(resourceComplianceInputs)}
                soc2Subtext={soc2Subtext}
                soc2Loading={!isDemoActive && soc2Loading}
                customFrameworksSubtext={customFrameworksSubtext}
                customFrameworksLoading={!isDemoActive && customFrameworksLoading}
                findingsError={findingsError}
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
                  monthlySavingsLabel={monthlySavings > 0 ? formatSavingsCents(monthlySavings) : null}
                  annualSavingsLabel={monthlySavings > 0 ? formatSavingsCents(annualSavings) : null}
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
              {isConnected ? 'Live update channel connected' : 'Live update channel reconnecting…'} · each data source refreshes on its own schedule
            </span>
          </div>
        </>
      )}
    </div>
  )
}
