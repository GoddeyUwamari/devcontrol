'use client'

import { useQuery } from '@tanstack/react-query'
import awsServicesService, { type AWSServicesPage, type ServicesCoverage } from '@/lib/services/aws-services.service'
import { platformStatsService } from '@/lib/services/platform-stats.service'
import { useRegisteredServices } from '@/lib/hooks/use-registered-services'
import type { CostSummary } from '@/lib/types'
import { ServicesHeader } from './ServicesHeader'
import { CoverageStrip, type CoverageState } from './CoverageStrip'
import { SummaryTiles, type StatsState } from './SummaryTiles'
import { AttentionTable, ATTENTION_ROWS, type AttentionState } from './AttentionTable'
import { YourServices, type YourServicesState } from './YourServices'
import { UnownedCard } from './UnownedCard'
import { SAMPLE_DATA_BANNER, type ServicesDemoFixture } from './demo-fixture'

/**
 * The top half of the redesigned Services page (Phase 1, PR S1-C): header,
 * coverage strip, summary tiles, What needs attention, Your services and the
 * Unowned card. Behind NEXT_PUBLIC_SERVICES_V2 (servicesV2Flag.ts); the
 * resource list below it is still the current page's until S1-D.
 *
 * Every query is keyed by organization and disabled until it is known, and
 * none runs in demo mode, which renders the placeholder fixture instead.
 */
export function ServicesOverview({
  orgId, realMode, demo, stats, statusHeadline, discovery, banners, onViewAllAttention, onShowAllResources,
}: {
  orgId: string | null
  realMode: boolean
  /** The placeholder fixture in demo or sales-demo mode; null otherwise. */
  demo: ServicesDemoFixture | null
  stats: StatsState
  statusHeadline: string
  discovery: {
    isDiscovering: boolean
    discoveryComplete: boolean
    discoveryMsg: string | null
    warnings: readonly string[]
    onAutoDiscover: () => void
  }
  /** The upgrade prompt and the load-error banner, kept above the coverage strip (Q3). */
  banners: React.ReactNode
  onViewAllAttention: () => void
  onShowAllResources: () => void
}) {
  const coverageQuery = useQuery<ServicesCoverage>({
    queryKey: ['services-coverage', orgId],
    queryFn: () => awsServicesService.getCoverage(),
    enabled: realMode, retry: false, refetchOnWindowFocus: false,
  })
  const attentionQuery = useQuery<AWSServicesPage>({
    queryKey: ['services-attention', orgId],
    queryFn: () => awsServicesService.getServices({ needs_attention: true, page: 1, limit: ATTENTION_ROWS }),
    enabled: realMode, retry: false, refetchOnWindowFocus: false,
  })
  // The same query (and cache entry) as the Dashboard's spend card.
  const costQuery = useQuery<CostSummary>({
    queryKey: ['platform-cost-summary', orgId],
    queryFn: platformStatsService.getCostSummary,
    enabled: realMode, retry: false, refetchOnWindowFocus: false,
  })
  const registeredQuery = useRegisteredServices({ enabled: !demo })

  // A query that can't run yet (organization unknown) reads as loading, never as empty.
  const coverageState: CoverageState = demo ? { status: 'ready', coverage: demo.coverage }
    : coverageQuery.data ? { status: 'ready', coverage: coverageQuery.data }
    : coverageQuery.isError ? { status: 'error', retry: () => coverageQuery.refetch() }
    : { status: 'loading' }

  const attentionState: AttentionState = demo
    ? { status: 'ready', page: demoPage(demo) }
    : attentionQuery.data ? { status: 'ready', page: attentionQuery.data }
    : attentionQuery.isError ? { status: 'error', retry: () => attentionQuery.refetch() }
    : { status: 'loading' }

  const registeredState: YourServicesState = demo ? { status: 'ready', services: demo.registered }
    : registeredQuery.isError ? { status: 'error', retry: () => registeredQuery.refetch() }
    : registeredQuery.isSuccess ? { status: 'ready', services: registeredQuery.data }
    : { status: 'loading' }

  const spend = demo
    ? { loading: false, error: false, summary: demo.costSummary }
    : { loading: !orgId || costQuery.isPending, error: costQuery.isError, summary: costQuery.data }

  const statsData = stats.stats
  // With no resources at all, the list below says why (no account, nothing
  // discovered); the attention and unowned cards have nothing to show.
  const noResources = !stats.loading && statsData?.total === 0

  return (
    <>
      {demo && (
        <div role="note" className="mb-4 rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-2 text-xs text-yellow-950">
          <strong>{SAMPLE_DATA_BANNER}</strong> Placeholder names only.
        </div>
      )}
      <ServicesHeader
        isDiscovering={discovery.isDiscovering}
        discoveryComplete={discovery.discoveryComplete}
        discoveryMsg={discovery.discoveryMsg}
        onAutoDiscover={discovery.onAutoDiscover}
      />
      {banners}
      <CoverageStrip
        state={coverageState}
        statusHeadline={statusHeadline}
        inTabWarnings={discovery.warnings}
        storedResources={!stats.loading && (statsData?.total ?? 0) > 0}
      />
      <SummaryTiles
        stats={stats}
        coverage={coverageState.status === 'ready' ? coverageState.coverage : undefined}
        registered={{
          loading: registeredState.status === 'loading',
          error: registeredState.status === 'error',
          count: registeredState.status === 'ready' ? registeredState.services.length : undefined,
        }}
        spend={spend}
      />
      {!noResources && (
        <AttentionTable state={attentionState} totalResources={statsData?.total} onViewAll={onViewAllAttention} onShowAll={onShowAllResources} />
      )}
      <YourServices state={registeredState} mappedToService={statsData?.mapped_to_service} totalResources={statsData?.total} />
      {!noResources && statsData && !stats.loading && <UnownedCard stats={statsData} />}
    </>
  )
}

function demoPage(demo: ServicesDemoFixture): AWSServicesPage {
  const total = demo.attention.length
  return {
    services: demo.attention.slice(0, ATTENTION_ROWS),
    pagination: { page: 1, limit: ATTENTION_ROWS, total, total_pages: Math.max(1, Math.ceil(total / ATTENTION_ROWS)), has_more: total > ATTENTION_ROWS },
    counts: { needs_attention: total, no_flagged_issues: demo.services.length - total },
  }
}
