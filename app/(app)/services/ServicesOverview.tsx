'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import awsServicesService, { type AWSServicesPage, type ServicesCoverage } from '@/lib/services/aws-services.service'
import { useRegisteredServices } from '@/lib/hooks/use-registered-services'
import { useCostSummary } from '@/lib/hooks/useCostSummary'
import { ServicesHeader } from './ServicesHeader'
import { scanLine } from '../security/overview/securityModel'
import { CoverageStrip, type CoverageState } from './CoverageStrip'
import { SummaryTiles, type StatsState } from './SummaryTiles'
import { AttentionTable, ATTENTION_ROWS, type AttentionState } from './AttentionTable'
import { YourServices, type YourServicesState } from './YourServices'
import { UnownedCard } from './UnownedCard'
import { SAMPLE_DATA_BANNER, type ServicesDemoFixture } from '@/lib/demo/services-demo-fixture'
import { AllResourcesTable, type AllResourcesState } from './AllResourcesTable'
import { NotCheckedCard } from './NotCheckedCard'
import { type AllResourcesFilters, DEFAULT_FILTERS, allResourcesRequest, demoAllResourcesPage } from './allResources'
import { isServicesCoverageM6Enabled } from './servicesCoverageM6Flag'
import { describeRegionCoverage } from './regionCoverage'
import { RegionCoveragePanel } from './RegionCoveragePanel'
import { useNowEachLocalDay } from './useNowEachLocalDay'
import { isServicesRedesignEnabled } from './servicesRedesignFlag'
import {
  SHOW_PARAM, attentionScopeCaption, describeCoverageCard, describeNotChecked, formerHomeOf, redesignScanLine, resourcesCaptions, scanBanner,
  scanIsRunning, type DiscoverOutcome,
} from './redesignModel'
import { RedesignHeader } from './RedesignHeader'
import { ScanBanner } from './ScanBanner'
import { RegionCoverageCard } from './RegionCoverageCard'
import { NotCheckedLine } from './NotCheckedLine'
import { useHomeRegion } from './useHomeRegion'
import { ConnectAwsHeaderButton, HeaderActionLoading, NotConnectedCard, NotConnectedLoading } from '@/components/aws/not-connected'

/** While a scan is running, coverage is read again this often (M6 only). */
export const SCAN_RUNNING_REFETCH_MS = 60_000

/** "Failed to load resources." (E9): the same banner as the current page's, with Try again (PR2). */
function LoadErrorBanner({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 bg-red-50 border border-red-200 rounded-xl px-5 py-3 mb-5">
      <p className="text-ui text-ink-danger m-0">Failed to load resources.</p>
      <button type="button" onClick={onRetry} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 text-label text-ink-danger hover:bg-red-100 sm:min-h-9">
        <RefreshCw size={12} aria-hidden="true" /> Try again
      </button>
    </div>
  )
}

/**
 * PR 3d-2 (D7): `/services?show=needs_attention` (Infrastructure's "View all {n} in Services & Ownership →")
 * opens the page with Needs attention selected. Read once per mount; any other value, or none, is ignored.
 * Its own component, in a Suspense boundary, as ResourceFocus (useSearchParams).
 */
function ShowFromUrl({ onNeedsAttention }: { onNeedsAttention: () => void }) {
  const show = useSearchParams()?.get(SHOW_PARAM) ?? null
  const done = useRef(false)
  useEffect(() => {
    if (done.current) return
    done.current = true
    if (show === 'needs_attention') onNeedsAttention()
  }, [show, onNeedsAttention])
  return null
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
  connectionLoading = false, onRetryLoad,
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
    /**
     * The last Scan now in this tab, set once the page re-read coverage after
     * it (the redesign's scan banner); null before one, or while one runs.
     */
    outcome?: DiscoverOutcome | null
  }
  /** The upgrade prompt, kept above the coverage strip (Q3). */
  banners: React.ReactNode
  /** The page's load error (stats or discovery), shown as E9 with the list's own. */
  pageError: boolean
  /** The organization is known to have no AWS account: a failed list is then not an error (as before). */
  knownNoAccount: boolean
  /** A filter or organization change (the page clears the discovery error, as before). Must be stable. */
  onFiltersChange: () => void
  /** The server's connection check has not answered yet (PR2, redesign only: grey blocks until it does). */
  connectionLoading?: boolean
  /** "Try again" on Failed to load resources: the page's own reads (stats, discovery error); the list and coverage are re-read here. */
  onRetryLoad?: () => void
}) {
  // Region coverage (multi-region M6), behind NEXT_PUBLIC_SERVICES_COVERAGE_M6.
  const m6 = isServicesCoverageM6Enabled()
  // The Services redesign (PR 3b), behind its own flag: always the M6 / multi_region data path.
  const redesign = isServicesRedesignEnabled()
  const coverageQuery = useQuery<ServicesCoverage>({
    queryKey: ['services-coverage', orgId],
    queryFn: () => awsServicesService.getCoverage(),
    enabled: realMode, retry: false, refetchOnWindowFocus: false,
    // M6: read again every minute only while a scan is running, and not while the tab is hidden.
    // The redesign also while its own Scan now runs, so the progress line appears.
    ...(m6 || redesign ? {
      refetchInterval: (query: { state: { data?: ServicesCoverage } }) => (query.state.data?.scan_in_progress || (redesign && discovery.isDiscovering) ? SCAN_RUNNING_REFETCH_MS : false),
      refetchIntervalInBackground: false,
    } : {}),
  })
  const attentionQuery = useQuery<AWSServicesPage>({
    queryKey: ['services-attention', orgId],
    queryFn: () => awsServicesService.getServices({ needs_attention: true, page: 1, limit: ATTENTION_ROWS }),
    enabled: realMode, retry: false, refetchOnWindowFocus: false,
  })
  // The same query (and cache entry) as the Dashboard's spend card, keyed by
  // organization and UTC day (DAY1-D10).
  const costQuery = useCostSummary(orgId, { enabled: realMode, retry: false, refetchOnWindowFocus: false })
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

  // "today" / "yesterday" in the region coverage, read again after each local midnight.
  const now = useNowEachLocalDay((m6 || redesign) && !demo)
  // The redesign's scan banner, dismissed for this visit (component state only).
  const scanNowRef = useRef<HTMLButtonElement>(null)
  const [dismissedOutcome, setDismissedOutcome] = useState<DiscoverOutcome | null>(null)
  const regionView = m6 && !demo && coverageState.status === 'ready'
    ? describeRegionCoverage(coverageState.coverage, now, discovery.warnings)
    : null
  const scanRunning = regionView?.scanRunning ?? false
  // The header's "Last scan" line (Security's and the Dashboard's wording), for a connected account only.
  const scan = coverageState.status === 'ready' && coverageState.coverage.account.connected
    ? scanLine({ status: 'ready', data: coverageState.coverage }, now)
    : null

  // PR 3c: the home-region banner, dialog and Change (redesign only; nothing in demo mode).
  const homeRegion = useHomeRegion({ orgId, realMode: realMode && redesign, coverage: redesign && !demo && coverageState.status === 'ready' ? coverageState.coverage : undefined })

  const statsData = stats.stats
  // With no resources at all, the list below says why (no account, nothing
  // discovered); the attention and unowned cards have nothing to show.
  const noResources = !stats.loading && statsData?.total === 0
  const retryLoad = () => {
    onRetryLoad?.()
    if (listQuery.isError) listQuery.refetch()
    if (coverageQuery.isError) coverageQuery.refetch()
  }

  if (redesign) {
    const coverage = coverageState.status === 'ready' ? coverageState.coverage : undefined
    const connected = !!coverage?.account.connected
    const outcome = discovery.outcome ?? null
    // A failed re-read can't tell which scan it was: the counts only, no tone.
    const banner = !outcome || outcome === dismissedOutcome ? null
      : coverageQuery.isError ? { tone: 'neutral' as const, text: 'Scan finished', counts: `${outcome.discovered.toLocaleString('en-US')} new · ${outcome.updated.toLocaleString('en-US')} updated` }
      : coverage ? scanBanner(coverage, outcome) : null
    const captions = resourcesCaptions(coverage)
    // PR2 empty states: the server's connection state (the page's accounts check), never the row count.
    // Until it answers, grey blocks only; a failed check is today's page, unchanged. Not in demo mode.
    const pageLoading = !demo && connectionLoading
    const notConnected = !demo && knownNoAccount
    return (
      <div data-services-redesign="">
        {/* PR 3d-2 (D7): ?show=needs_attention selects Needs attention; renders nothing. */}
        <Suspense fallback={null}><ShowFromUrl onNeedsAttention={() => applyFilters({ ...DEFAULT_FILTERS, show: 'needs_attention' })} /></Suspense>
        {demo && (
          <div role="note" className="mb-4 rounded-lg border border-[var(--border-warning)] bg-[var(--bg-warning)] px-4 py-2 text-meta text-ink-warning-strong dark:text-amber-300">
            <strong>{SAMPLE_DATA_BANNER}</strong> Placeholder names only.
          </div>
        )}
        <RedesignHeader
          ref={scanNowRef}
          scan={coverage && connected && !notConnected ? redesignScanLine(coverage, now) : null}
          isDiscovering={discovery.isDiscovering}
          scanRunning={scanIsRunning(coverage)}
          onScanNow={discovery.onAutoDiscover}
          altAction={pageLoading ? <HeaderActionLoading /> : notConnected ? <ConnectAwsHeaderButton /> : undefined}
        />
        {pageLoading ? <NotConnectedLoading tiles={5} /> : notConnected ? (<>
          {(pageError || listFailed) && <LoadErrorBanner onRetry={retryLoad} />}
          <SummaryTiles
            stats={stats}
            coverage={coverage}
            registered={{
              loading: registeredState.status === 'loading',
              error: registeredState.status === 'error',
              count: registeredState.status === 'ready' ? registeredState.services.length : undefined,
            }}
            spend={spend}
            redesign={{ attentionScope: null, resourcesScope: null, resourcesEarlier: null }}
            notConnected
          />
          <NotConnectedCard className="mb-6" />
          <YourServices state={registeredState} mappedToService={statsData?.mapped_to_service} totalResources={statsData?.total} redesign />
        </>) : (<>
        {banner && (
          <ScanBanner view={banner} onDismiss={() => { setDismissedOutcome(outcome); scanNowRef.current?.focus() }} />
        )}
        {/* PR 3c: the scan banner, then the home-region banner, then the five cards. */}
        {homeRegion.bannerNode}
        {homeRegion.dialogNode}
        {banners}
        {(pageError || listFailed) && <LoadErrorBanner onRetry={retryLoad} />}
        <SummaryTiles
          stats={stats}
          coverage={coverage}
          registered={{
            loading: registeredState.status === 'loading',
            error: registeredState.status === 'error',
            count: registeredState.status === 'ready' ? registeredState.services.length : undefined,
          }}
          spend={spend}
          onShowUnowned={() => showList({ show: 'unowned' })}
          redesign={{ attentionScope: attentionScopeCaption(statsData), resourcesScope: captions.scope, resourcesEarlier: captions.earlier }}
        />
        {coverage && connected ? (
          <RegionCoverageCard view={describeCoverageCard(coverage, now)} now={now} onChangeHomeRegion={demo ? null : homeRegion.onChange} />
        ) : (
          // Loading, error and no connected account: today's states, unchanged.
          <CoverageStrip
            state={coverageState}
            statusHeadline={!stats.loading && listFailed ? 'Resource data unavailable' : statusHeadline}
            inTabWarnings={discovery.warnings}
            storedResources={!stats.loading && (statsData?.total ?? 0) > 0}
          />
        )}
        {!noResources && (
          <AttentionTable
            state={attentionState} totalResources={statsData?.total}
            onViewAll={() => showList({ show: 'needs_attention' })} onShowAll={() => showList({})}
            redesign={{ needsAttention: stats.loading || stats.unavailable ? undefined : statsData?.needs_attention, formerHome: formerHomeOf(coverage), now }}
          />
        )}
        <YourServices state={registeredState} mappedToService={statsData?.mapped_to_service} totalResources={statsData?.total} redesign />
        {!noResources && statsData && !stats.loading && (
          <UnownedCard stats={statsData} onShowUnowned={() => showList({ show: 'unowned' })} onOpenTeamFilter={openTeamFilter} redesign />
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
            coverage={coverage}
            knownNoAccount={knownNoAccount}
            teamSelectRef={teamSelectRef}
            isDiscovering={discovery.isDiscovering}
            onAutoDiscover={discovery.onAutoDiscover}
            scanRunning={scanIsRunning(coverage)}
            redesign
          />
        </div>
        {coverage && <NotCheckedLine view={describeNotChecked(coverage, statsData, now, discovery.warnings)} />}
        </>)}
      </div>
    )
  }

  return (
    <>
      {demo && (
        <div role="note" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-meta text-ink-warning-strong">
          <strong>{SAMPLE_DATA_BANNER}</strong> Placeholder names only.
        </div>
      )}
      <ServicesHeader
        isDiscovering={discovery.isDiscovering}
        discoveryComplete={discovery.discoveryComplete}
        discoveryMsg={discovery.discoveryMsg}
        onAutoDiscover={discovery.onAutoDiscover}
        scanRunning={scanRunning}
        scan={scan}
      />
      {banners}
      {(pageError || listFailed) && <LoadErrorBanner onRetry={retryLoad} />}
      <CoverageStrip
        state={coverageState}
        statusHeadline={!stats.loading && listFailed ? 'Resource data unavailable' : statusHeadline}
        inTabWarnings={discovery.warnings}
        storedResources={!stats.loading && (statsData?.total ?? 0) > 0}
        regionView={regionView}
        now={regionView ? now : undefined}
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
      {regionView && <RegionCoveragePanel view={regionView} now={now} />}
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
