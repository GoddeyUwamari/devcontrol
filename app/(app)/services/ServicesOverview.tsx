'use client'

import { useEffect, useRef, useState } from 'react'
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
import { AllResourcesTable, type AllResourcesState } from './AllResourcesTable'
import { NotCheckedCard } from './NotCheckedCard'
import { type AllResourcesFilters, DEFAULT_FILTERS, allResourcesRequest, demoAllResourcesPage } from './allResources'
import { isServicesCoverageM6Enabled } from './servicesCoverageM6Flag'
import { describeRegionCoverage } from './regionCoverage'
import { RegionCoveragePanel } from './RegionCoveragePanel'

/** While a scan is running, coverage is read again this often (M6 only). */
export const SCAN_RUNNING_REFETCH_MS = 60_000

/** "Failed to load resources." (E9): the same banner as the current page's. */
function LoadErrorBanner() {
  return (
    <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-3 mb-5">
      <p className="text-sm text-red-600 m-0">Failed to load resources.</p>
    </div>
  )
}

/**
 * The redesigned Services page (Phase 1): header, coverage strip, summary
 * tiles, What needs attention, Your services, the Unowned card (S1-C), All
 * resources and What we didn't check (S1-D). Behind NEXT_PUBLIC_SERVICES_V2
 * (servicesV2Flag.ts); with it on, All resources replaces the current page's
 * resource list.
 *
 * Every query is keyed by organization and disabled until it is known, and
 * none runs in demo mode, which renders the placeholder fixture instead.
 */
export function ServicesOverview({
  orgId, realMode, demo, stats, statusHeadline, discovery, banners, pageError, knownNoAccount, onFiltersChange,
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
  /** The upgrade prompt, kept above the coverage strip (Q3). */
  banners: React.ReactNode
  /** The page's load error (stats or discovery), shown as E9 with the list's own. */
  pageError: boolean
  /** The organization is known to have no AWS account: a failed list is then not an error (as before). */
  knownNoAccount: boolean
  /** A filter or organization change (the page clears the discovery error, as before). Must be stable. */
  onFiltersChange: () => void
}) {
  // Region coverage (multi-region M6), behind NEXT_PUBLIC_SERVICES_COVERAGE_M6.
  const m6 = isServicesCoverageM6Enabled()
  const coverageQuery = useQuery<ServicesCoverage>({
    queryKey: ['services-coverage', orgId],
    queryFn: () => awsServicesService.getCoverage(),
    enabled: realMode, retry: false, refetchOnWindowFocus: false,
    // M6: read again every minute only while a scan is running, and not while the tab is hidden.
    ...(m6 ? {
      refetchInterval: (query: { state: { data?: ServicesCoverage } }) => (query.state.data?.scan_in_progress ? SCAN_RUNNING_REFETCH_MS : false),
      refetchIntervalInBackground: false,
    } : {}),
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

  // ── All resources: filters, paging and the list query ──
  const [filters, setFilters] = useState<AllResourcesFilters>(DEFAULT_FILTERS)
  const [searchInput, setSearchInput] = useState('')
  // The search is committed 400 ms after typing stops, so a request never
  // carries a stale term (as the current list).
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.search === searchInput ? f : { ...f, search: searchInput })), 400)
    return () => clearTimeout(t)
  }, [searchInput])
  const applyFilters = (next: AllResourcesFilters) => { setSearchInput(next.search); setFilters(next) }

  // A new organization or filter starts at page 1 in the same render, so no
  // request is made for a stale page.
  const filtersKey = JSON.stringify([orgId, filters])
  const [paging, setPaging] = useState({ key: filtersKey, page: 1 })
  const listPage = paging.key === filtersKey ? paging.page : 1
  const goToPage = (page: number) => setPaging({ key: filtersKey, page })
  useEffect(() => { onFiltersChange() }, [filtersKey, onFiltersChange])

  const listQuery = useQuery<AWSServicesPage>({
    queryKey: ['services-list', orgId, 'all-resources', filtersKey, listPage],
    queryFn: () => awsServicesService.getServices(allResourcesRequest(filters, listPage)),
    enabled: realMode, retry: false, refetchOnWindowFocus: false,
    // Turning a page keeps the current rows until the next page arrives; any other change starts from loading.
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[3] === filtersKey ? previous : undefined),
  })
  // A page past the end (the inventory shrank after a discovery) goes back to the last page.
  useEffect(() => {
    const p = listQuery.data?.pagination
    if (p && p.page > 1 && p.page > p.total_pages) goToPage(Math.max(1, p.total_pages))
  })

  const listState: AllResourcesState = demo
    ? { status: 'ready', page: demoAllResourcesPage(demo.services, filters, listPage), dimmed: false }
    : listQuery.data ? { status: 'ready', page: listQuery.data, dimmed: listQuery.isPlaceholderData }
    : listQuery.isError ? { status: 'error', retry: () => listQuery.refetch() }
    : { status: 'loading' }
  const listFailed = !demo && listQuery.isError && !knownNoAccount

  // The controls above that open the list: each sets its filters and scrolls to it.
  const listRef = useRef<HTMLDivElement>(null)
  const teamSelectRef = useRef<HTMLSelectElement>(null)
  const showList = (change: Partial<AllResourcesFilters>) => {
    applyFilters({ ...DEFAULT_FILTERS, ...change })
    listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const openTeamFilter = () => {
    const select = teamSelectRef.current
    if (!select) return
    select.scrollIntoView({ behavior: 'smooth', block: 'center' })
    select.focus()
    try { select.showPicker?.() } catch { /* not allowed or not supported: focus is enough */ }
  }

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

  // Times in the region coverage are read against the time the page mounted.
  const [mountedAt] = useState(() => Date.now())
  const regionView = m6 && !demo && coverageState.status === 'ready'
    ? describeRegionCoverage(coverageState.coverage, mountedAt, discovery.warnings)
    : null
  const scanRunning = regionView?.scanRunning ?? false

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
        scanRunning={scanRunning}
      />
      {banners}
      {(pageError || listFailed) && <LoadErrorBanner />}
      <CoverageStrip
        state={coverageState}
        statusHeadline={!stats.loading && listFailed ? 'Resource data unavailable' : statusHeadline}
        inTabWarnings={discovery.warnings}
        storedResources={!stats.loading && (statsData?.total ?? 0) > 0}
        regionView={regionView}
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
        onShowUnowned={() => showList({ show: 'unowned' })}
      />
      {!noResources && (
        <AttentionTable state={attentionState} totalResources={statsData?.total} onViewAll={() => showList({ show: 'needs_attention' })} onShowAll={() => showList({})} />
      )}
      <YourServices state={registeredState} mappedToService={statsData?.mapped_to_service} totalResources={statsData?.total} />
      {!noResources && statsData && !stats.loading && (
        <UnownedCard stats={statsData} onShowUnowned={() => showList({ show: 'unowned' })} onOpenTeamFilter={openTeamFilter} />
      )}
      <div ref={listRef} className="scroll-mt-4">
        <AllResourcesTable
          state={listState}
          filters={filters}
          searchInput={searchInput}
          onSearchInput={setSearchInput}
          onFilters={(change) => applyFilters({ ...filters, search: searchInput, ...change })}
          onClearFilters={() => applyFilters(DEFAULT_FILTERS)}
          onPage={goToPage}
          stats={stats}
          coverage={coverageState.status === 'ready' ? coverageState.coverage : undefined}
          knownNoAccount={knownNoAccount}
          teamSelectRef={teamSelectRef}
          isDiscovering={discovery.isDiscovering}
          onAutoDiscover={discovery.onAutoDiscover}
          scanRunning={scanRunning}
        />
      </div>
      {regionView && <RegionCoveragePanel view={regionView} now={mountedAt} />}
      {coverageState.status === 'ready' && (
        <NotCheckedCard coverage={coverageState.coverage} stats={statsData} inTabWarnings={discovery.warnings} leaseRule={!!regionView} />
      )}
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
