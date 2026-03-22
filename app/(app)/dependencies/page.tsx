'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
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

const DEMO_MODE_KEY = 'devcontrol_demo_mode'
const CACHE_KEY = 'dependencies_cache'
const CACHE_TIMESTAMP_KEY = 'dependencies_cache_timestamp'

export default function DependenciesPage() {
  const globalDemoMode = useDemoMode()
  const [localDemoMode, setLocalDemoMode] = useState(false)
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
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
          <div className={demoMode ? 'relative' : ''}>
            {demoMode && (
              <div className="absolute top-3 right-3 z-10">
                <span className="text-xs bg-purple-600 text-white px-3 py-1.5 rounded-full flex items-center gap-1.5 shadow-lg">
                  <Play className="w-3 h-3" />
                  Demo Data
                </span>
              </div>
            )}
            <DependencyGraph onRefresh={refetch} graphRef={graphRef} demoMode={demoMode || displayDependencies === DEMO_DEPENDENCIES} />
          </div>
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

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
