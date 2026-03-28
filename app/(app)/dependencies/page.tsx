'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Network, List, Activity, AlertTriangle, Plus, Command, Play, Clock, RefreshCw } from 'lucide-react'
import { useDemoMode } from '@/components/demo/demo-mode-toggle'
import { announceToScreenReader, formatCountForScreenReader } from '@/lib/utils/accessibility'
import { createAppError, AppError } from '@/lib/errors/error-types'
import { retryApiCall } from '@/lib/utils/retry'
import { ErrorDisplay } from '@/components/ui/error-display'
import { OfflineDetector, useOnlineStatus, CachedDataIndicator } from '@/components/ui/offline-detector'
import { DemoModeInlineToggle } from '@/components/demo/DemoModeInlineToggle'
import { DemoModeBanner } from '@/components/demo/DemoModeBanner'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { dependenciesService } from '@/lib/services/dependencies.service'
import { servicesService } from '@/lib/services/services.service'
import { EnhancedEmptyState } from '@/components/dependencies/EnhancedEmptyState'
import { ExportMenu } from '@/components/dependencies/ExportMenu'
import { DependencySearch, type DependencySearchHandle } from '@/components/dependencies/DependencySearch'
import { DependencyFilters, type DependencyFiltersHandle } from '@/components/dependencies/DependencyFilters'
import { FilterSummary } from '@/components/dependencies/FilterSummary'
import { KeyboardShortcutsModal } from '@/components/dependencies/KeyboardShortcutsModal'
import { useDependencySearch } from '@/lib/hooks/use-dependency-search'
import { useDependencyFilters } from '@/lib/hooks/use-dependency-filters'
import { useKeyboardShortcuts } from '@/lib/hooks/use-keyboard-shortcuts'
import { StatCardWithTrend } from '@/components/stats/stat-card-with-trend'
import { DEMO_DEPENDENCY_STATS, generateStatsWithTrends } from '@/lib/demo/demo-trends'
import { DEMO_DEPENDENCIES, DEMO_CIRCULAR_DEPENDENCIES } from '@/lib/demo/demo-dependencies'
import { LastSynced } from '@/components/ui/last-synced'
import { SyncStatusBanner } from '@/components/ui/sync-status-banner'
import { DEMO_LAST_SYNCED, DEMO_SYNC_STATUS } from '@/lib/demo/demo-timestamps'
import { useOnboardingTour } from '@/lib/hooks/use-onboarding-tour'
import { TourButton } from '@/components/onboarding/tour-button'
import { WelcomeModal } from '@/components/onboarding/welcome-modal'
import { SystemStatusBadge } from '@/components/ui/system-status-badge'
import { DataFreshnessIndicator } from '@/components/ui/data-freshness-indicator'
import { SecurityBadge } from '@/components/ui/security-badge'
import { SyncHealthStatus } from '@/components/ui/sync-health-status'
import dynamic from 'next/dynamic'
import type { Node, Edge } from '@xyflow/react'

// Dynamically import React Flow component to avoid SSR issues
const DependencyGraph = dynamic(
  () => import('@/components/dependencies/DependencyGraph').then(mod => mod.DependencyGraph),
  { ssr: false }
)

const DependencyList = dynamic(
  () => import('@/components/dependencies/DependencyList').then(mod => mod.DependencyList),
  { ssr: false }
)

const ImpactAnalysisView = dynamic(
  () => import('@/components/dependencies/ImpactAnalysisView').then(mod => mod.ImpactAnalysisView),
  { ssr: false }
)

const AddDependencyDialog = dynamic(
  () => import('@/components/dependencies/AddDependencyDialog').then(mod => mod.AddDependencyDialog),
  { ssr: false }
)

// --- Intelligence Panel helpers (module-level for stable references) ---

function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

function detectServiceType(id: string): string {
  const l = id.toLowerCase()
  if (l.includes('db') || l.includes('database') || l.includes('postgres') || l.includes('mysql') || l.includes('mongo')) return 'database'
  if (l.includes('queue') || l.includes('kafka') || l.includes('rabbit') || l.includes('sqs')) return 'queue'
  if (l.includes('ui') || l.includes('frontend') || l.includes('web') || l.includes('client')) return 'frontend'
  if (l.includes('gateway') || l.includes('proxy') || l.includes('nginx')) return 'gateway'
  return 'api'
}

function getServiceMetrics(nodeId: string) {
  const h = hashStr(nodeId)
  return {
    latency: 50 + (h % 200),
    errorRate: ((h % 30) / 10).toFixed(1),
    reqVolume: 500 + (h % 5000),
    costPerMonth: 200 + (h % 2000),
    type: detectServiceType(nodeId),
    environment: 'production',
    isOnCriticalPath: nodeId.toLowerCase().includes('payment') || nodeId.toLowerCase().includes('auth') || nodeId.toLowerCase().includes('gateway'),
  }
}

function getAIInsights(_label: string): string[] {
  return [
    'Latency increased 32% over the last 24h',
    'High dependency concentration detected',
    'Failure here would impact customer-facing checkout flow',
  ]
}

function getRecommendations(_label: string): { action: string; impact: string; confidence: number }[] {
  return [
    { action: 'Introduce caching for API responses', impact: '-18% latency', confidence: 87 },
    { action: 'Decouple synchronous Email Queue dependency', impact: '-45ms avg', confidence: 92 },
  ]
}

function getEdgeMetrics(edgeId: string) {
  const h = hashStr(edgeId)
  return {
    reqVolume: 500 + (h % 5000),
    latency: 10 + (h % 80),
    errorRate: ((h % 20) / 10).toFixed(1),
  }
}

const SECTION_HEADER: React.CSSProperties = {
  fontSize: '0.68rem', color: '#475569', fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: '0.06em',
  margin: '0 0 10px', paddingBottom: '6px', borderBottom: '1px solid #F1F5F9',
}

// --- End helpers ---

const DEMO_MODE_KEY = 'devcontrol_demo_mode'
const CACHE_KEY = 'dependencies_cache'
const CACHE_TIMESTAMP_KEY = 'dependencies_cache_timestamp'

export default function DependenciesPage() {
  const router = useRouter()
  const globalDemoMode = useDemoMode()
  const [localDemoMode, setLocalDemoMode] = useState(false)
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null)
  const [alertToast, setAlertToast] = useState<string | null>(null)
  const panelOpen = selectedNode !== null || selectedEdge !== null
  const [activeTab, setActiveTab] = useState('graph')
  const [showShortcuts, setShowShortcuts] = useState(false)
  const graphRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<DependencySearchHandle>(null)
  const exportButtonRef = useRef<HTMLButtonElement>(null)
  const filtersRef = useRef<DependencyFiltersHandle>(null)
  const { startTour } = useOnboardingTour('dependencies-page')

  // Online status
  const isOnline = useOnlineStatus()

  // Error handling state
  const [pageError, setPageError] = useState<AppError | null>(null)
  const [isRetrying, setIsRetrying] = useState(false)
  const [loadingTimeout, setLoadingTimeout] = useState(false)

  // Cached data for graceful degradation
  const [cachedDependencies, setCachedDependencies] = useState<typeof DEMO_DEPENDENCIES>([])
  const [cachedTimestamp, setCachedTimestamp] = useState<Date | null>(null)

  // Sync local state with global demo mode
  useEffect(() => {
    const stored = localStorage.getItem(DEMO_MODE_KEY)
    setLocalDemoMode(stored === 'true' || globalDemoMode)
  }, [globalDemoMode])

  // Combined demo mode state
  const demoMode = localDemoMode || globalDemoMode

  // Initialize timestamps based on demo mode
  const [lastSynced, setLastSynced] = useState<Date>(demoMode ? DEMO_LAST_SYNCED : new Date())
  const [syncStatus, setSyncStatus] = useState<'syncing' | 'synced' | 'error'>(DEMO_SYNC_STATUS)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [syncHealthStatus, setSyncHealthStatus] = useState<'healthy' | 'warning' | 'error'>('healthy')

  // Toggle demo mode function
  const toggleDemoMode = useCallback((enabled: boolean) => {
    setLocalDemoMode(enabled)
    localStorage.setItem(DEMO_MODE_KEY, String(enabled))
    window.dispatchEvent(new CustomEvent('demo-mode-changed', {
      detail: { enabled }
    }))
  }, [])

  // Load cached data on mount
  useEffect(() => {
    try {
      const cached = localStorage.getItem(CACHE_KEY)
      const timestamp = localStorage.getItem(CACHE_TIMESTAMP_KEY)
      if (cached) {
        setCachedDependencies(JSON.parse(cached))
      }
      if (timestamp) {
        setCachedTimestamp(new Date(timestamp))
      }
    } catch (e) {
      console.error('Failed to load cached dependencies:', e)
    }
  }, [])

  // Fetch all dependencies with retry logic
  const {
    data: dependencies = [],
    isLoading,
    error: queryError,
    refetch,
  } = useQuery({
    queryKey: ['dependencies'],
    queryFn: async () => {
      try {
        setPageError(null)
        const data = await retryApiCall(
          () => dependenciesService.getAll(),
          'fetch dependencies'
        )
        return data
      } catch (err) {
        const appError = createAppError(err, 'load dependencies')
        setPageError(appError)
        throw err
      }
    },
    retry: false, // We handle retry ourselves
    staleTime: 30000, // 30 seconds
  })

  // Save dependencies to cache on successful fetch
  useEffect(() => {
    if (dependencies && dependencies.length > 0) {
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(dependencies))
        localStorage.setItem(CACHE_TIMESTAMP_KEY, new Date().toISOString())
        setCachedDependencies(dependencies)
        setCachedTimestamp(new Date())
      } catch (e) {
        console.error('Failed to cache dependencies:', e)
      }
    }
  }, [dependencies])

  // Loading timeout detection
  useEffect(() => {
    if (isLoading) {
      setLoadingTimeout(false)
      const timer = setTimeout(() => {
        setLoadingTimeout(true)
        announceToScreenReader('Loading is taking longer than usual', 'polite')
      }, 15000) // 15 seconds
      return () => clearTimeout(timer)
    } else {
      setLoadingTimeout(false)
    }
  }, [isLoading])

  // Handle query error
  useEffect(() => {
    if (queryError && !pageError) {
      const appError = createAppError(queryError, 'load dependencies')
      setPageError(appError)
    }
  }, [queryError, pageError])

  // Fetch services to check if user has any
  const { data: services = [] } = useQuery({
    queryKey: ['services'],
    queryFn: () => servicesService.getAll(),
  })

  // Fetch circular dependencies
  const {
    data: cycles = [],
    refetch: refetchCycles,
  } = useQuery({
    queryKey: ['dependencies', 'cycles'],
    queryFn: () => dependenciesService.detectCircularDependencies(),
  })

  // Use demo data when in demo mode, fallback to cache when error/offline
  const shouldUseCachedData = !demoMode && (pageError || !isOnline) && cachedDependencies.length > 0
  const displayDependencies = demoMode
    ? DEMO_DEPENDENCIES
    : shouldUseCachedData
    ? cachedDependencies
    : dependencies.length > 0
    ? dependencies
    : DEMO_DEPENDENCIES
  const displayCycles = demoMode ? DEMO_CIRCULAR_DEPENDENCIES : cycles

  const hasDependencies = displayDependencies.length > 0
  const hasServices = services.length > 0 || demoMode

  // Determine if we're showing cached/stale data
  const isShowingCachedData = shouldUseCachedData && cachedTimestamp !== null

  // Search functionality - use displayed dependencies
  const {
    query,
    setQuery,
    results,
    isSearching,
    clearSearch,
    hasActiveSearch,
  } = useDependencySearch(displayDependencies)

  // Filter functionality
  const {
    filters,
    setFilter,
    clearFilters,
    activeFilterCount,
    filteredResults,
  } = useDependencyFilters(results)

  // Map filtered search results back to ServiceDependency type
  const filteredDisplayDependencies = filteredResults
    .map((result) => {
      // Find the original dependency by matching serviceName and dependsOn
      return displayDependencies.find(
        (dep) =>
          (dep.sourceServiceName || dep.sourceServiceId) === result.item.serviceName &&
          (dep.targetServiceName || dep.targetServiceId) === result.item.dependsOn
      )
    })
    .filter((dep): dep is NonNullable<typeof dep> => dep !== undefined)

  // Calculate stats from displayed data (real or demo)
  const stats = {
    total: displayDependencies.length,
    critical: displayDependencies.filter(d => d.isCritical).length,
    byType: {
      runtime: displayDependencies.filter(d => d.dependencyType === 'runtime').length,
      data: displayDependencies.filter(d => d.dependencyType === 'data').length,
      deployment: displayDependencies.filter(d => d.dependencyType === 'deployment').length,
      'shared-lib': displayDependencies.filter(d => d.dependencyType === 'shared-lib').length,
    },
  }

  // Generate stats with trends - use demo stats for consistent display in demo mode
  const statsWithTrends = demoMode
    ? DEMO_DEPENDENCY_STATS
    : generateStatsWithTrends(
        stats.total,
        stats.critical,
        stats.byType.runtime,
        displayCycles.length
      )

  // Setup keyboard shortcuts
  useKeyboardShortcuts({
    onSearch: () => searchRef.current?.focus(),
    onClearSearch: () => searchRef.current?.clear(),
    onShowHelp: () => setShowShortcuts(true),
    onOpenFilters: () => filtersRef.current?.focusFirst(),
    onExport: () => exportButtonRef.current?.click(),
  })

  // Announce dependencies loaded to screen readers
  useEffect(() => {
    if (!isLoading && displayDependencies.length > 0) {
      announceToScreenReader(
        formatCountForScreenReader(displayDependencies.length, 'dependency', 'dependencies') + ' loaded',
        'polite'
      )
    }
  }, [isLoading, displayDependencies.length])

  // Announce filter results to screen readers
  useEffect(() => {
    if (activeFilterCount > 0 || hasActiveSearch) {
      announceToScreenReader(
        `Showing ${formatCountForScreenReader(filteredDisplayDependencies.length, 'result')} of ${displayDependencies.length} dependencies`,
        'polite'
      )
    }
  }, [filteredDisplayDependencies.length, activeFilterCount, hasActiveSearch, displayDependencies.length])

  // Handle view change with screen reader announcement
  const handleViewChange = useCallback((view: string) => {
    setActiveTab(view)
    const viewNames: Record<string, string> = {
      graph: 'Graph View',
      list: 'List View',
      impact: 'Impact Analysis',
    }
    announceToScreenReader(`Switched to ${viewNames[view] || view}`, 'polite')
  }, [])

  // Handle manual refresh
  const handleRefresh = async () => {
    if (!isOnline) {
      announceToScreenReader('Cannot refresh while offline', 'assertive')
      return
    }

    setIsRefreshing(true)
    setSyncStatus('syncing')
    setSyncHealthStatus('healthy')
    setPageError(null)
    announceToScreenReader('Refreshing dependencies', 'polite')

    try {
      await Promise.all([refetch(), refetchCycles()])
      setLastSynced(new Date())
      setSyncStatus('synced')
      setSyncHealthStatus('healthy')
      announceToScreenReader('Dependencies refreshed successfully', 'polite')
    } catch (err) {
      const appError = createAppError(err, 'refresh dependencies')
      setPageError(appError)
      setSyncStatus('error')
      setSyncHealthStatus('error')
      announceToScreenReader('Error refreshing dependencies', 'assertive')
    } finally {
      setIsRefreshing(false)
    }
  }

  // Handle error retry
  const handleRetryError = async () => {
    if (!isOnline) {
      announceToScreenReader('Cannot retry while offline', 'assertive')
      return
    }

    setIsRetrying(true)
    setPageError(null)
    announceToScreenReader('Retrying...', 'polite')

    try {
      await Promise.all([refetch(), refetchCycles()])
      setLastSynced(new Date())
      setSyncStatus('synced')
      setSyncHealthStatus('healthy')
      announceToScreenReader('Successfully loaded dependencies', 'polite')
    } catch (err) {
      const appError = createAppError(err, 'load dependencies')
      setPageError(appError)
      announceToScreenReader('Retry failed', 'assertive')
    } finally {
      setIsRetrying(false)
    }
  }

  // Handle error dismiss
  const handleDismissError = () => {
    setPageError(null)
  }

  // Handle online/offline events
  const handleOnline = useCallback(() => {
    announceToScreenReader('Connection restored. Refreshing data...', 'polite')
    // Auto-refresh when coming back online
    handleRefresh()
  }, [])

  const handleOffline = useCallback(() => {
    announceToScreenReader('Connection lost. Showing cached data.', 'assertive')
  }, [])

  // Close intelligence panel on Escape
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setSelectedNode(null); setSelectedEdge(null) }
    }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [])

  // Enable demo mode function (for empty state)
  const enableDemoMode = () => {
    toggleDemoMode(true)
  }

  // Disable demo mode function
  const disableDemoMode = () => {
    toggleDemoMode(false)
  }

  // Empty State - but NOT when demo mode is on
  if (false) {
    return (
      <div style={{
        padding: '40px 56px 64px',
        maxWidth: '1320px',
        margin: '0 auto',
        minHeight: '100vh',
        background: '#F9FAFB',
        fontFamily: 'Inter, system-ui, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        gap: '24px',
      }}>
        {/* Header */}
        <div>
          <div className="flex items-center justify-between">
            <div>
              <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#0F172A', margin: '0 0 6px', letterSpacing: '-0.02em' }}>
                Service Dependencies
              </h1>
              <p style={{ fontSize: '0.875rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>
                Visualize and manage service dependency relationships
              </p>
            </div>
          </div>
        </div>

        {/* Enhanced Empty State */}
        <EnhancedEmptyState
          onAddDependency={() => setIsAddDialogOpen(true)}
          onEnableDemoMode={enableDemoMode}
          onImport={() => {
            // Future: Handle import functionality
          }}
          hasServices={hasServices}
        />

        {/* Add Dependency Dialog */}
        {hasServices && (
          <AddDependencyDialog
            open={isAddDialogOpen}
            onClose={() => setIsAddDialogOpen(false)}
            onSuccess={() => {
              refetch()
              refetchCycles()
            }}
          />
        )}
      </div>
    )
  }

  return (
    <div style={{
      padding: '40px 56px 64px',
      maxWidth: '1320px',
      margin: '0 auto',
      minHeight: '100vh',
      background: '#F9FAFB',
      fontFamily: 'Inter, system-ui, sans-serif',
      display: 'flex',
      flexDirection: 'column',
      gap: '24px',
    }}>
      {/* Offline Detector */}
      <OfflineDetector onOnline={handleOnline} onOffline={handleOffline} />

      {/* Error Display */}
      {!demoMode && pageError && !isShowingCachedData && (
        <ErrorDisplay
          error={pageError}
          onRetry={pageError.retryable ? handleRetryError : undefined}
          onDismiss={handleDismissError}
          isRetrying={isRetrying}
        />
      )}

      {/* Cached Data Indicator */}
      {isShowingCachedData && cachedTimestamp && (
        <CachedDataIndicator
          lastSyncedAt={cachedTimestamp}
          onRefresh={isOnline ? handleRefresh : undefined}
          isRefreshing={isRefreshing}
        />
      )}

      {/* Loading Timeout Warning */}
      {isLoading && loadingTimeout && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 24px', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '12px' }}>
          <Clock size={32} style={{ color: '#D97706', marginBottom: '16px' }} aria-hidden="true" />
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#92400E', margin: '0 0 8px' }}>
            This is taking longer than usual
          </h3>
          <p style={{ fontSize: '0.875rem', color: '#B45309', textAlign: 'center', margin: '0 0 20px', maxWidth: '400px', lineHeight: 1.6 }}>
            We're still loading your dependencies. This might be due to network conditions. You can wait or try refreshing.
          </p>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#fff', color: '#92400E', border: '1px solid #FDE68A', borderRadius: '8px', padding: '8px 18px', fontSize: '0.875rem', fontWeight: 600, cursor: isRefreshing ? 'not-allowed' : 'pointer' }}
            aria-label={isRefreshing ? 'Refreshing...' : 'Refresh'}
          >
            <RefreshCw size={14} style={{ animation: isRefreshing ? 'spin 1s linear infinite' : 'none' }} aria-hidden="true" />
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      )}

      {/* Header */}
      <div id="dependencies-header" className="space-y-4">
        {/* Title Row */}
        <div className="flex items-start justify-between">
          <div>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#0F172A', margin: '0 0 6px', letterSpacing: '-0.02em' }}>
              Service Dependencies
            </h1>
            <p style={{ fontSize: '0.875rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>
              Visualize and manage service dependency relationships
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Demo Mode Toggle */}
            {!globalDemoMode && (
              <DemoModeInlineToggle
                enabled={demoMode}
                onToggle={toggleDemoMode}
              />
            )}
            <TourButton onStartTour={startTour} variant="icon" />
            <Button
              id="keyboard-shortcuts-button"
              variant="ghost"
              size="sm"
              onClick={() => setShowShortcuts(true)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Show keyboard shortcuts"
              aria-haspopup="dialog"
            >
              <Command className="h-4 w-4 mr-2" aria-hidden="true" />
              Shortcuts
            </Button>
            <div id="export-menu">
              <ExportMenu
                ref={exportButtonRef}
                dependencies={filteredDisplayDependencies}
                cycles={displayCycles}
                graphRef={graphRef}
                activeTab={activeTab}
              />
            </div>
            <Button
              onClick={() => setIsAddDialogOpen(true)}
              aria-label="Add new dependency"
              aria-haspopup="dialog"
            >
              <Plus className="h-4 w-4 mr-2" aria-hidden="true" />
              Add Dependency
            </Button>
          </div>
        </div>

        {/* Trust Indicators Row */}
        <div className="flex items-center gap-3 flex-wrap">
          <SystemStatusBadge />
          <DataFreshnessIndicator
            lastSynced={lastSynced}
            isRefreshing={isRefreshing}
            onRefresh={handleRefresh}
          />
          <SecurityBadge />
          <div className="h-4 w-px bg-border" />
          <div className="text-xs text-muted-foreground flex items-center gap-1.5">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500"></span>
            </span>
            Real-time sync active
          </div>
        </div>

        {/* Sync Health Status (conditional) */}
        <SyncHealthStatus
          status={syncHealthStatus}
          onResolve={handleRefresh}
        />
      </div>

      {/* Demo Mode Banner */}
      {localDemoMode && !globalDemoMode && (
        <DemoModeBanner onExit={disableDemoMode} />
      )}

      {/* Sync Status Banner */}
      <SyncStatusBanner
        lastSynced={lastSynced}
        status={syncStatus}
        onRetry={handleRefresh}
      />

      {/* Stats Cards */}
      <div id="stats-cards" className={`grid gap-4 md:grid-cols-4 ${demoMode ? 'relative' : ''}`}>
        {statsWithTrends.map((stat) => (
          <div
            key={stat.label}
            className={demoMode ? 'ring-2 ring-purple-200 dark:ring-purple-800 rounded-lg' : ''}
          >
            <StatCardWithTrend
              stat={stat}
              loading={isLoading}
              lastUpdated={lastSynced}
            />
          </div>
        ))}
      </div>

      {/* Circular Dependency Alert */}
      {displayCycles.length > 0 && (
        <Alert variant="destructive" role="alert" aria-live="polite">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          <AlertDescription>
            <strong>Warning:</strong> {displayCycles.length} circular dependency cycle{displayCycles.length > 1 ? 's' : ''} detected.
            This can cause deployment issues and runtime failures.
            {' '}
            <button
              onClick={() => handleViewChange('list')}
              className="underline font-semibold"
              aria-label={`View ${displayCycles.length} circular dependency cycles in list view`}
            >
              View details
            </button>
          </AlertDescription>
        </Alert>
      )}

      {/* Search and Filters */}
      <div className="space-y-3">
        <div id="search-bar">
          <DependencySearch
            ref={searchRef}
            query={query}
            onQueryChange={setQuery}
            resultsCount={filteredDisplayDependencies.length}
            totalCount={displayDependencies.length}
            isSearching={isSearching}
            onClear={clearSearch}
            hasActiveFilters={activeFilterCount > 0}
          />
        </div>

        <div id="filter-controls">
          <DependencyFilters
            ref={filtersRef}
            filters={filters}
            onFilterChange={setFilter}
            onClearFilters={clearFilters}
            activeCount={activeFilterCount}
          />
        </div>

        {activeFilterCount > 0 && (
          <FilterSummary filters={filters} onRemoveFilter={setFilter} />
        )}
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={handleViewChange} className="space-y-4">
        <TabsList id="view-tabs" aria-label="Dependency view options">
          <TabsTrigger value="graph" aria-label="Graph View - Visual dependency map">
            <Network className="h-4 w-4 mr-2" aria-hidden="true" />
            Graph View
          </TabsTrigger>
          <TabsTrigger value="list" aria-label="List View - Tabular dependency list">
            <List className="h-4 w-4 mr-2" aria-hidden="true" />
            List View
          </TabsTrigger>
          <TabsTrigger value="impact" aria-label="Impact Analysis - Change impact assessment">
            <Activity className="h-4 w-4 mr-2" aria-hidden="true" />
            Impact Analysis
          </TabsTrigger>
        </TabsList>

        <TabsContent value="graph" className="space-y-4">
          <div
            className={demoMode ? 'relative' : ''}
            style={{ opacity: panelOpen ? 0.6 : 1, transition: 'opacity 0.3s ease', pointerEvents: panelOpen ? 'none' : undefined }}
          >
            {demoMode && (
              <div className="absolute top-3 right-3 z-10">
                <span className="text-xs bg-purple-600 text-white px-3 py-1.5 rounded-full flex items-center gap-1.5 shadow-lg">
                  <Play className="w-3 h-3" />
                  Demo Data
                </span>
              </div>
            )}
            <DependencyGraph
              onRefresh={refetch}
              graphRef={graphRef}
              demoMode={demoMode || displayDependencies === DEMO_DEPENDENCIES}
              onNodeClick={(node) => { setSelectedNode(node); setSelectedEdge(null) }}
              onEdgeClick={(edge) => { setSelectedEdge(edge); setSelectedNode(null) }}
            />
          </div>

          {/* Backdrop */}
          {panelOpen && (
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 49 }}
              onClick={() => { setSelectedNode(null); setSelectedEdge(null) }}
            />
          )}

          {/* Intelligence Panel */}
          {panelOpen && (() => {
            const isNode = selectedNode !== null
            const panelLabel = isNode
              ? String(selectedNode!.data?.label ?? selectedNode!.id)
              : `${selectedEdge!.source} → ${selectedEdge!.target}`
            const metrics = isNode ? getServiceMetrics(selectedNode!.id) : null
            const edgeMetrics = !isNode && selectedEdge ? getEdgeMetrics(selectedEdge.id) : null
            const isCriticalEdge = !isNode && !!(selectedEdge?.data?.isCritical)

            return (
              <div
                style={{
                  position: 'fixed', right: 0, top: 0, height: '100vh', width: '420px',
                  background: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
                  zIndex: 50, overflowY: 'auto',
                  transform: 'translateX(0)', transition: 'transform 0.3s ease',
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Header */}
                <div style={{ padding: '22px 24px 16px', borderBottom: '1px solid #F1F5F9' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                    <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#0F172A', margin: 0, lineHeight: 1.3, flex: 1 }}>
                      {panelLabel}
                    </h2>
                    <button
                      onClick={() => { setSelectedNode(null); setSelectedEdge(null) }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', fontSize: '1.1rem', lineHeight: 1, flexShrink: 0, marginLeft: '8px', padding: '2px' }}
                    >✕</button>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {isNode && metrics && (
                      <>
                        <span style={{ fontSize: '0.68rem', fontWeight: 600, padding: '2px 8px', borderRadius: '4px', background: '#EFF6FF', color: '#3B82F6', textTransform: 'uppercase' as const }}>{metrics.type}</span>
                        <span style={{ fontSize: '0.68rem', fontWeight: 600, padding: '2px 8px', borderRadius: '4px', background: '#F0FDF4', color: '#16A34A', textTransform: 'uppercase' as const }}>{metrics.environment}</span>
                        <span style={{ fontSize: '0.68rem', fontWeight: 600, padding: '2px 8px', borderRadius: '4px', background: '#F0FDF4', color: '#16A34A', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#16A34A', display: 'inline-block' }} />
                          Healthy
                        </span>
                      </>
                    )}
                    {!isNode && (
                      <span style={{ fontSize: '0.68rem', fontWeight: 600, padding: '2px 8px', borderRadius: '4px', background: isCriticalEdge ? '#FEF2F2' : '#F8FAFC', color: isCriticalEdge ? '#EF4444' : '#64748B', textTransform: 'uppercase' as const }}>
                        {isCriticalEdge ? 'Critical' : 'Runtime'} dependency
                      </span>
                    )}
                  </div>
                </div>

                {/* Body */}
                <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  {isNode && metrics ? (
                    <>
                      {/* Key Metrics */}
                      <div>
                        <p style={SECTION_HEADER}>Key Metrics</p>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '8px' }}>
                          {[
                            ['Avg Latency', `${metrics.latency}ms`],
                            ['Error Rate', `${metrics.errorRate}%`],
                            ['Req Volume', `${metrics.reqVolume.toLocaleString()}/m`],
                            ['Cost Impact', `$${metrics.costPerMonth.toLocaleString()}/mo`],
                          ].map(([lbl, val]) => (
                            <div key={lbl} style={{ background: '#F8FAFC', borderRadius: '8px', padding: '10px 6px', textAlign: 'center' }}>
                              <p style={{ fontSize: '0.6rem', color: '#94A3B8', margin: '0 0 4px', fontWeight: 600, textTransform: 'uppercase', lineHeight: 1.2 }}>{lbl}</p>
                              <p style={{ fontSize: '0.82rem', fontWeight: 700, color: '#0F172A', margin: 0 }}>{val}</p>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Critical Path */}
                      {metrics.isOnCriticalPath && (
                        <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '10px', padding: '12px 14px' }}>
                          <p style={{ fontSize: '0.75rem', fontWeight: 700, color: '#92400E', margin: '0 0 6px' }}>⚠️ Critical Path</p>
                          <p style={{ fontSize: '0.77rem', color: '#B45309', margin: '0 0 8px' }}>
                            This service is part of a high-risk execution path
                          </p>
                          <p style={{ fontSize: '0.72rem', color: '#92400E', margin: '0 0 6px', fontFamily: 'monospace', background: '#FEF3C7', padding: '4px 8px', borderRadius: '4px', display: 'inline-block' }}>
                            Auth Service → {panelLabel} → Email Queue
                          </p>
                          <p style={{ fontSize: '0.7rem', color: '#B45309', margin: 0 }}>Combined latency: 340ms · Risk: High</p>
                        </div>
                      )}

                      {/* Upstream */}
                      <div>
                        <p style={SECTION_HEADER}>Upstream Dependencies</p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {[['→ Auth Service', '23ms', '0.3% errors'], ['→ User Database', '45ms', '0.1% errors']].map(([name, lat, err]) => (
                            <div key={name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: '#F8FAFC', borderRadius: '8px' }}>
                              <span style={{ fontSize: '0.8rem', color: '#0F172A', fontWeight: 500 }}>{name}</span>
                              <span style={{ fontSize: '0.72rem', color: '#64748B' }}>{lat} · {err}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Downstream */}
                      <div>
                        <p style={SECTION_HEADER}>Downstream Impact</p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {[['← Email Queue', 'affects: Notifications'], ['← Payment Gateway', 'affects: Checkout flow']].map(([name, affect]) => (
                            <div key={name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: '#F8FAFC', borderRadius: '8px' }}>
                              <span style={{ fontSize: '0.8rem', color: '#0F172A', fontWeight: 500 }}>{name}</span>
                              <span style={{ fontSize: '0.72rem', color: '#64748B' }}>{affect}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* AI Analysis */}
                      <div>
                        <p style={SECTION_HEADER}>AI Analysis</p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {getAIInsights(panelLabel).map((insight, i) => (
                            <div key={i} style={{ borderLeft: '3px solid #7C3AED', paddingLeft: '10px', paddingTop: '2px', paddingBottom: '2px' }}>
                              <p style={{ fontSize: '0.78rem', color: '#475569', margin: 0, fontStyle: 'italic' }}>
                                <span style={{ color: '#7C3AED', marginRight: '4px' }}>✦</span>{insight}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Recommendations */}
                      <div>
                        <p style={SECTION_HEADER}>Recommended Actions</p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {getRecommendations(panelLabel).map((rec, i) => (
                            <div key={i} style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: '10px', padding: '12px' }}>
                              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: '8px' }}>
                                <span style={{ fontSize: '0.9rem' }}>💡</span>
                                <div>
                                  <p style={{ fontSize: '0.78rem', color: '#0F172A', fontWeight: 600, margin: '0 0 2px' }}>{rec.action}</p>
                                  <p style={{ fontSize: '0.72rem', color: '#64748B', margin: 0 }}>Est. impact: {rec.impact}</p>
                                </div>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <div style={{ flex: 1, height: '4px', background: '#F1F5F9', borderRadius: '2px' }}>
                                  <div style={{ width: `${rec.confidence}%`, height: '100%', background: '#7C3AED', borderRadius: '2px' }} />
                                </div>
                                <span style={{ fontSize: '0.68rem', color: '#7C3AED', fontWeight: 600 }}>{rec.confidence}%</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Actions */}
                      <div>
                        <p style={SECTION_HEADER}>Actions</p>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          <button onClick={() => { setSelectedNode(null); router.push('/services') }} style={{ padding: '8px 14px', background: '#7C3AED', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 }}>View Full Service</button>
                          <button onClick={() => { setSelectedNode(null); handleViewChange('impact') }} style={{ padding: '8px 14px', background: '#fff', color: '#475569', border: '1px solid #E2E8F0', borderRadius: '8px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 }}>Analyze Impact</button>
                          <button onClick={() => { const name = String(selectedNode?.data?.label ?? 'this service'); setAlertToast(`Alert added for ${name}`); setTimeout(() => setAlertToast(null), 3000) }} style={{ padding: '8px 14px', background: '#fff', color: '#475569', border: '1px solid #E2E8F0', borderRadius: '8px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 }}>Add Alert</button>
                        </div>
                      </div>
                    </>
                  ) : edgeMetrics ? (
                    <>
                      {/* Edge Metrics */}
                      <div>
                        <p style={SECTION_HEADER}>Connection Metrics</p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {[
                            ['Request Volume', `${edgeMetrics.reqVolume.toLocaleString()} req/min`],
                            ['Latency', `${edgeMetrics.latency}ms avg`],
                            ['Error Rate', `${edgeMetrics.errorRate}%`],
                            ['Failure Impact', isCriticalEdge ? 'Critical' : 'Moderate'],
                          ].map(([k, v]) => (
                            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: '#F8FAFC', borderRadius: '8px' }}>
                              <span style={{ fontSize: '0.8rem', color: '#64748B', fontWeight: 500 }}>{k}</span>
                              <span style={{ fontSize: '0.8rem', color: '#0F172A', fontWeight: 600 }}>{v}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* AI Insight */}
                      <div>
                        <p style={SECTION_HEADER}>AI Insight</p>
                        <div style={{ borderLeft: '3px solid #7C3AED', paddingLeft: '10px' }}>
                          <p style={{ fontSize: '0.78rem', color: '#475569', margin: 0, fontStyle: 'italic' }}>
                            <span style={{ color: '#7C3AED', marginRight: '4px' }}>✦</span>
                            This connection contributes 45% of total request latency in the checkout flow
                          </p>
                        </div>
                      </div>

                      {/* Actions */}
                      <div>
                        <p style={SECTION_HEADER}>Actions</p>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          <button style={{ padding: '8px 14px', background: '#7C3AED', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 }}>View Source Service</button>
                          <button style={{ padding: '8px 14px', background: '#fff', color: '#475569', border: '1px solid #E2E8F0', borderRadius: '8px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 }}>View Target Service</button>
                        </div>
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            )
          })()}
        </TabsContent>

        <TabsContent value="list" className="space-y-4">
          <DependencyList
            dependencies={filteredDisplayDependencies}
            cycles={displayCycles}
            isLoading={isLoading}
            onRefresh={refetch}
            searchQuery={query}
            onClearSearch={clearSearch}
          />
        </TabsContent>

        <TabsContent value="impact" className="space-y-4">
          <ImpactAnalysisView demoMode={demoMode} />
        </TabsContent>
      </Tabs>

      {/* Add Dependency Dialog */}
      <AddDependencyDialog
        open={isAddDialogOpen}
        onClose={() => setIsAddDialogOpen(false)}
        onSuccess={() => {
          refetch()
          refetchCycles()
        }}
      />

      {/* Keyboard Shortcuts Modal */}
      <KeyboardShortcutsModal
        isOpen={showShortcuts}
        onClose={() => setShowShortcuts(false)}
      />

      {/* Welcome Modal */}
      <WelcomeModal />

      {alertToast && (
        <div style={{
          position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
          background: '#0F172A', color: '#fff', padding: '12px 20px',
          borderRadius: '8px', fontSize: '0.875rem', fontWeight: 500,
          zIndex: 100, boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          display: 'flex', alignItems: 'center', gap: '8px'
        }}>
          ✓ {alertToast}
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
