'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, handleApiResponse } from '@/lib/api'
import awsServicesService, { type ServicesCoverage } from '@/lib/services/aws-services.service'
import { accountSecurityFindingsService, type AccountSecurityFinding } from '@/lib/services/account-security-findings.service'
import { awsResourcesService } from '@/lib/services/aws-resources.service'
import { anomalyService } from '@/lib/services/anomaly.service'
import type { ComplianceFramework, ComplianceScan } from '@/lib/services/compliance-frameworks.service'
import { riskScoreService, type RiskScore, type RiskScoreTrendResponse } from '@/lib/services/risk-score.service'
import { useAuth } from '@/lib/contexts/auth-context'
import { useCurrentRole } from '@/lib/hooks/use-current-role'
import { useNowEachLocalDay } from '../../services/useNowEachLocalDay'
import { describeSecurity, type ResourceFindingsSource, type ResourceWithIssues, type SecLoadable } from './securityModel'
import { PAGE_COPY } from './securityCopy'
import { SecurityHeader } from './SecurityHeader'
import { StatusBanner } from './StatusBanner'
import { SecurityTiles } from './SecurityTiles'
import { FindingsList } from './FindingsList'
import { ScoreTrend } from './ScoreTrend'
import { SecurityChecked } from './SecurityChecked'
import { Frameworks } from './Frameworks'
import { BottomLinks } from './BottomLinks'

/**
 * The org's newest scans, all frameworks together, are read with this limit, and the same value is what
 * the model is told was requested (carried item 2): a list shorter than it is the whole history.
 */
export const FRAMEWORK_SCANS_LIMIT = 50
/** Below Pro, the needs-attention list's page cap (plan §9.2 item 5). */
export const ATTENTION_LIMIT = 100
/** While a scan is running, coverage is read again this often (as the Infrastructure Overview). */
export const SCAN_RUNNING_REFETCH_MS = 60_000

const QUERY_OPTIONS = { retry: false, refetchOnWindowFocus: false } as const

const statusOf = (error: unknown) => (error as { response?: { status?: number } } | null)?.response?.status

/** A 402 is "on a higher plan" only where the route is plan-gated; any other failure is an error. */
function loadable<T>(q: { data?: T; isError: boolean; error: unknown }, planGated = false): SecLoadable<T> {
  if (q.data !== undefined) return { status: 'ready', data: q.data }
  if (!q.isError) return { status: 'loading' }
  return planGated && statusOf(q.error) === 402 ? { status: 'plan' } : { status: 'error' }
}

/** Pro reads every resource's current issues; below Pro (402) the needs-attention list instead. */
async function readResourceFindings(): Promise<ResourceFindingsSource> {
  try {
    const resources = await awsResourcesService.getComplianceIssues() as ResourceWithIssues[]
    return { kind: 'full', resources }
  } catch (error) {
    if (statusOf(error) !== 402) throw error
    const page = await awsServicesService.getServices({ needs_attention: true, page: 1, limit: ATTENTION_LIMIT })
    return { kind: 'attention', services: page.services }
  }
}

/** Both framework reads keep their axios error, so a 402 (Enterprise) stays distinguishable from a failure. */
async function readFrameworks() {
  const [frameworks, scans] = await Promise.all([
    api.get('/api/compliance-frameworks').then((r) => handleApiResponse<ComplianceFramework[]>(r)),
    api.get(`/api/compliance-frameworks/scans/list?limit=${FRAMEWORK_SCANS_LIMIT}`).then((r) => handleApiResponse<ComplianceScan[]>(r)),
  ])
  return { frameworks, scans, scansLimit: FRAMEWORK_SCANS_LIMIT }
}

const CAN_SYNC = ['owner', 'admin', 'member']

/**
 * The Security Overview (NEXT_PUBLIC_SECURITY_V2). Database reads only: no /api/observability/* and no
 * AWS call on render. Demo mode never reaches this module (SEC/page.tsx renders the legacy page first).
 */
export default function SecurityOverviewV2() {
  const queryClient = useQueryClient()
  const { organization } = useAuth()
  const orgId = organization?.id ?? null
  const enabled = !!orgId
  const role = useCurrentRole()
  const now = useNowEachLocalDay(true)
  const [syncing, setSyncing] = useState(false)

  const scoreQuery = useQuery<RiskScore>({ queryKey: ['security-v2', orgId, 'score'], queryFn: () => riskScoreService.getCurrent(), enabled, ...QUERY_OPTIONS })
  const trendQuery = useQuery<RiskScoreTrendResponse>({ queryKey: ['security-v2', orgId, 'trend'], queryFn: () => riskScoreService.getTrend('30d'), enabled, ...QUERY_OPTIONS })
  // The same key (and cache entry) as the Infrastructure Overview's account findings.
  const accountQuery = useQuery<AccountSecurityFinding[]>({ queryKey: ['account-security-findings', orgId], queryFn: () => accountSecurityFindingsService.getActive(), enabled, ...QUERY_OPTIONS })
  const resourceQuery = useQuery<ResourceFindingsSource>({ queryKey: ['security-v2', orgId, 'resource-findings'], queryFn: readResourceFindings, enabled, ...QUERY_OPTIONS })
  const coverageQuery = useQuery<ServicesCoverage>({
    queryKey: ['services-coverage', orgId],
    queryFn: () => awsServicesService.getCoverage(),
    enabled, ...QUERY_OPTIONS,
    refetchInterval: (query: { state: { data?: ServicesCoverage } }) => (query.state.data?.scan_in_progress ? SCAN_RUNNING_REFETCH_MS : false),
    refetchIntervalInBackground: false,
  })
  const frameworksQuery = useQuery({ queryKey: ['security-v2', orgId, 'frameworks', FRAMEWORK_SCANS_LIMIT], queryFn: readFrameworks, enabled, ...QUERY_OPTIONS })
  const anomaliesQuery = useQuery<{ active: number }>({ queryKey: ['security-v2', orgId, 'anomaly-stats'], queryFn: () => anomalyService.getStats(), enabled, ...QUERY_OPTIONS })

  const view = describeSecurity({
    score: loadable(scoreQuery, true),
    trend: loadable(trendQuery, true),
    accountFindings: loadable(accountQuery),
    resourceFindings: loadable(resourceQuery),
    coverage: loadable(coverageQuery),
    frameworks: loadable(frameworksQuery, true),
    anomalies: loadable(anomaliesQuery),
  }, now)

  const handleSync = async () => {
    setSyncing(true)
    try {
      const result = await awsServicesService.discoverServices()
      await Promise.all([
        ['security-v2', orgId], ['services-coverage', orgId], ['account-security-findings'], ['account-security-findings-stats'],
        // Not ['system-intelligence']: a refresh of that key could request /api/observability/intelligence.
        ['services-stats'], ['risk-score-current'], ['risk-score-trend'], ['anomaly-stats'],
      ].map((queryKey) => queryClient.invalidateQueries({ queryKey })))
      toast.success(PAGE_COPY.syncComplete(result.discovered))
    } catch (error) {
      const status = statusOf(error)
      toast.error(status === 403 ? PAGE_COPY.syncForbidden
        : status === 402 ? PAGE_COPY.syncLimit
        : status === 429 ? PAGE_COPY.syncRateLimited
        : PAGE_COPY.syncFailed)
    } finally {
      setSyncing(false)
    }
  }

  // Unknown (null on the first render) fails closed: disabled, no reason shown until the role is read.
  const syncBlockedReason = role === null ? null : CAN_SYNC.includes(role) ? null : PAGE_COPY.viewerCantSync

  return (
    <main className="mx-auto flex max-w-[1240px] flex-col gap-6 px-4 py-6 sm:px-6">
      <SecurityHeader
        scan={view.scan}
        syncing={syncing}
        canSync={role !== null && CAN_SYNC.includes(role)}
        blockedReason={syncBlockedReason}
        onSync={handleSync}
      />
      <StatusBanner banner={view.banner} notChecked={view.notChecked} />
      <SecurityTiles
        tiles={view.tiles}
        anomaliesError={anomaliesQuery.isError}
        onRetryScore={() => scoreQuery.refetch()}
        onRetryAnomalies={() => anomaliesQuery.refetch()}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <FindingsList view={view} role={role} orgId={orgId} />
        <div className="flex min-w-0 flex-col gap-6">
          <ScoreTrend trend={view.trend} />
          <SecurityChecked lines={view.checked} />
          <Frameworks view={view.frameworks} />
        </div>
      </div>
      <BottomLinks />
    </main>
  )
}
