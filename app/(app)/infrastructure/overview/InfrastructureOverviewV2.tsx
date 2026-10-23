'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import awsServicesService, { type AWSServicesPage, type AWSServicesStats, type ServicesCoverage } from '@/lib/services/aws-services.service'
import { accountSecurityFindingsService, type AccountSecurityFinding } from '@/lib/services/account-security-findings.service'
import { costRecommendationsService } from '@/lib/services/cost-recommendations.service'
import { infrastructureService } from '@/lib/services/infrastructure.service'
import { platformStatsService } from '@/lib/services/platform-stats.service'
import type { CostSummary, RecommendationStats } from '@/lib/types'
import { useAuth } from '@/lib/contexts/auth-context'
import { usePlan } from '@/lib/hooks/use-plan'
import { useDemoMode } from '@/components/demo/demo-mode-toggle'
import { useSalesDemo } from '@/lib/demo/sales-demo-data'
import { DELETION_DETECTION_PAUSED_TEXT, hasDeletionDetectionPaused } from '@/components/aws/discovery-warning-notice'
import { isServicesV2Enabled } from '../../services/servicesV2Flag'
import { isServicesCoverageM6Enabled } from '../../services/servicesCoverageM6Flag'
import { useNowEachLocalDay } from '../../services/useNowEachLocalDay'
import { describeOverview, OVERVIEW_COPY, type Loadable } from './overviewModel'
import { OverviewHeader, type SyncState } from './OverviewHeader'
import { PlanBanners } from './PlanBanners'
import { AccountStrip } from './AccountStrip'
import { StatusLine } from './StatusLine'
import { KpiTiles } from './KpiTiles'
import { AttentionReview } from './AttentionReview'
import { WhatWeChecked } from './WhatWeChecked'
import { CostByService } from './CostByService'
import { OwnershipGaps } from './OwnershipGaps'
import { OverviewFooter } from './OverviewFooter'

/** While a scan is running, coverage is read again this often (as the Services page, M6). */
export const SCAN_RUNNING_REFETCH_MS = 60_000
/** Rows read for the attention table: the API's page cap, so the hidden cost order covers up to 100 (§3.5). */
export const ATTENTION_LIMIT = 100

/** The legacy query keys a Sync invalidates on /infrastructure (INF/page.tsx:323-340), kept so other pages stay right. */
const LEGACY_SYNC_KEYS = [
  ['infrastructure'], ['infrastructure-all'], ['services-stats'], ['cost-recommendations-count'], ['system-intelligence'],
  ['top-actions'], ['platform-dashboard-stats'], ['cost-recommendations-stats'], ['risk-score-trend'], ['risk-score-current'],
  ['account-security-findings'], ['account-security-findings-stats'],
]

const QUERY_OPTIONS = { retry: false, refetchOnWindowFocus: false } as const

function loadable<T>(q: { data?: T; isError: boolean }): Loadable<T> {
  if (q.data !== undefined) return { status: 'ready', data: q.data }
  return q.isError ? { status: 'error' } : { status: 'loading' }
}

const is402 = (error: unknown) => (error as { response?: { status?: number } } | null)?.response?.status === 402

function OverviewBody({ orgId }: { orgId: string | null }) {
  const queryClient = useQueryClient()
  const { isFree, isStarter, isPro } = usePlan()
  const realMode = !!orgId
  const now = useNowEachLocalDay(true)
  const [sync, setSync] = useState<SyncState>('idle')
  const [inTabWarnings, setInTabWarnings] = useState<string[]>([])
  const [syncLimit, setSyncLimit] = useState(false)

  // V1–V6 (§4, §17.10): database reads, except the cost summary, which reads the
  // shared 4-hour Cost Explorer cache. Nothing here calls /api/observability/*.
  const coverageQuery = useQuery<ServicesCoverage>({
    queryKey: ['services-coverage', orgId],
    queryFn: () => awsServicesService.getCoverage(),
    enabled: realMode, ...QUERY_OPTIONS,
    // Read again every minute only while a scan is running, and not while the tab is hidden.
    refetchInterval: (query: { state: { data?: ServicesCoverage } }) => (query.state.data?.scan_in_progress ? SCAN_RUNNING_REFETCH_MS : false),
    refetchIntervalInBackground: false,
  })
  const statsQuery = useQuery<AWSServicesStats>({
    queryKey: ['services-stats', orgId],
    queryFn: () => awsServicesService.getStats(),
    enabled: realMode, ...QUERY_OPTIONS,
  })
  const attentionQuery = useQuery<AWSServicesPage>({
    queryKey: ['infra-overview-attention', orgId],
    queryFn: () => awsServicesService.getServices({ needs_attention: true, page: 1, limit: ATTENTION_LIMIT }),
    enabled: realMode, ...QUERY_OPTIONS,
  })
  const accountFindingsQuery = useQuery<AccountSecurityFinding[]>({
    queryKey: ['account-security-findings', orgId],
    queryFn: () => accountSecurityFindingsService.getActive(),
    enabled: realMode, ...QUERY_OPTIONS,
  })
  // The same query (and cache entry) as the Dashboard's and Services' spend.
  const costQuery = useQuery<CostSummary>({
    queryKey: ['platform-cost-summary', orgId],
    queryFn: platformStatsService.getCostSummary,
    enabled: realMode, ...QUERY_OPTIONS,
  })
  const savingsQuery = useQuery<RecommendationStats>({
    queryKey: ['cost-recommendations-stats', orgId],
    queryFn: () => costRecommendationsService.getStats(),
    enabled: realMode, ...QUERY_OPTIONS,
  })
  // V7 (§17.5, Q-R4): read once per mount only for its 402 (resource limit);
  // the body is never read.
  const limitQuery = useQuery<null>({
    queryKey: ['infra-overview-limit', orgId],
    queryFn: async () => { await infrastructureService.getAll(); return null },
    enabled: realMode, ...QUERY_OPTIONS, refetchOnReconnect: false,
  })
  const limitReached = is402(limitQuery.error) || syncLimit

  const view = describeOverview({
    coverage: loadable(coverageQuery),
    stats: loadable(statsQuery),
    attention: loadable(attentionQuery),
    accountFindings: loadable(accountFindingsQuery),
    costSummary: loadable(costQuery),
    savings: loadable(savingsQuery),
    inTabWarnings,
    regionsLinkAvailable: isServicesV2Enabled() && isServicesCoverageM6Enabled(),
  }, now)

  useEffect(() => {
    if (sync !== 'complete') return
    const t = setTimeout(() => setSync('idle'), 3000)
    return () => clearTimeout(t)
  }, [sync])

  const handleSync = async () => {
    try {
      setSync('syncing')
      const result = await awsServicesService.discoverServices()
      setInTabWarnings(result.warnings ?? [])
      await Promise.all([
        ...[
          ['services-coverage', orgId], ['services-stats', orgId], ['infra-overview-attention', orgId],
          ['account-security-findings', orgId], ['cost-recommendations-stats', orgId], ['infra-overview-limit', orgId],
        ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
        ...LEGACY_SYNC_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      ])
      toast.success(`Sync complete — ${result.discovered} resources discovered`)
      if (hasDeletionDetectionPaused(result.warnings)) toast.warning(DELETION_DETECTION_PAUSED_TEXT)
      setSync('complete')
    } catch (error) {
      if (is402(error)) setSyncLimit(true)
      toast.error('Sync failed — check your AWS connection')
      setSync('idle')
    }
  }

  const connectedish = view.mode !== 'no-account'
  return (
    <main className="mx-auto flex max-w-[1240px] flex-col gap-6 px-4 py-6 sm:px-6">
      <OverviewHeader
        lastScan={view.header.lastScan}
        now={now}
        showSync={view.header.showSync}
        scanRunning={view.header.scanRunning}
        sync={sync}
        onSync={handleSync}
      />
      <PlanBanners limitReached={limitReached} isFree={!!isFree} isStarter={!!isStarter} isPro={!!isPro} />
      {view.mode === 'no-account' ? (
        <section aria-labelledby="infra-connect-heading" className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
          <h2 id="infra-connect-heading" className="m-0 text-base font-bold text-slate-900">{OVERVIEW_COPY.noAccountTitle}</h2>
          <Link href="/connect-aws" className="w-fit text-sm font-semibold text-violet-700 hover:underline">{OVERVIEW_COPY.connectAws}</Link>
        </section>
      ) : (
        <AccountStrip account={view.account} now={now} coverageError={view.mode === 'coverage-error'} onRetry={() => coverageQuery.refetch()} />
      )}
      <StatusLine status={view.status} now={now} />
      {connectedish && view.tiles && <KpiTiles tiles={view.tiles} now={now} />}
      {connectedish && view.attention && <AttentionReview view={view.attention} now={now} onRetry={() => { attentionQuery.refetch(); accountFindingsQuery.refetch() }} />}
      <WhatWeChecked lines={view.checked} now={now} />
      {connectedish && view.costByService && <CostByService view={view.costByService} />}
      {connectedish && view.ownership && <OwnershipGaps ownership={view.ownership} />}
      {connectedish && view.footer && <OverviewFooter total={view.footer.total} />}
    </main>
  )
}

/**
 * The Infrastructure Overview (NEXT_PUBLIC_INFRA_OVERVIEW_V2). Demo and sales
 * demo render the legacy page it is given (Q17). `?resource=<id>` from the
 * command palette is sent on to the same resource on Services & Ownership
 * (§17.4) before anything here is fetched.
 */
function InfrastructureOverview({ demoFallback }: { demoFallback: React.ReactNode }) {
  const demoMode = useDemoMode()
  const salesDemoMode = useSalesDemo((state) => state.enabled)
  const isDemoActive = demoMode || salesDemoMode
  const { organization } = useAuth()
  const router = useRouter()
  const resource = useSearchParams()?.get('resource') ?? null
  const redirect = !isDemoActive && !!resource

  useEffect(() => {
    if (redirect) router.replace(`/services?resource=${encodeURIComponent(resource!)}`)
  }, [redirect, resource, router])

  if (isDemoActive) return <>{demoFallback}</>
  if (redirect) return null
  return <OverviewBody orgId={organization?.id ?? null} />
}

export default function InfrastructureOverviewV2({ demoFallback }: { demoFallback: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="py-8 text-center text-sm text-slate-600">Loading…</div>}>
      <InfrastructureOverview demoFallback={demoFallback} />
    </Suspense>
  )
}
