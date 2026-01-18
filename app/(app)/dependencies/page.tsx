'use client'

import { useState, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Network, List, Activity, AlertTriangle, Plus, Command } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { dependenciesService } from '@/lib/services/dependencies.service'
import { servicesService } from '@/lib/services/services.service'
import { DependencySetupSteps } from '@/components/dependencies/DependencySetupSteps'
import { DependencyGraphPreview } from '@/components/dependencies/DependencyGraphPreview'
import { DependencyBenefits } from '@/components/dependencies/DependencyBenefits'
import { DependencyIntegrations } from '@/components/dependencies/DependencyIntegrations'
import { DependencyUseCases } from '@/components/dependencies/DependencyUseCases'
import { ExportMenu } from '@/components/dependencies/ExportMenu'
import { DependencySearch, type DependencySearchHandle } from '@/components/dependencies/DependencySearch'
import { DependencyFilters, type DependencyFiltersHandle } from '@/components/dependencies/DependencyFilters'
import { FilterSummary } from '@/components/dependencies/FilterSummary'
import { KeyboardShortcutsModal } from '@/components/dependencies/KeyboardShortcutsModal'
import { useDependencySearch } from '@/lib/hooks/use-dependency-search'
import { useDependencyFilters } from '@/lib/hooks/use-dependency-filters'
import { useKeyboardShortcuts } from '@/lib/hooks/use-keyboard-shortcuts'
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

export default function DependenciesPage() {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [activeTab, setActiveTab] = useState('graph')
  const [showShortcuts, setShowShortcuts] = useState(false)
  const graphRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<DependencySearchHandle>(null)
  const exportButtonRef = useRef<HTMLButtonElement>(null)
  const filtersRef = useRef<DependencyFiltersHandle>(null)

  // Fetch all dependencies
  const {
    data: dependencies = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['dependencies'],
    queryFn: () => dependenciesService.getAll(),
  })

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

  // Search functionality
  const {
    query,
    setQuery,
    results,
    isSearching,
    clearSearch,
    hasActiveSearch,
  } = useDependencySearch(dependencies)

  // Filter functionality
  const {
    filters,
    setFilter,
    clearFilters,
    activeFilterCount,
    filteredResults,
  } = useDependencyFilters(results)

  // Map filtered search results back to ServiceDependency type
  const displayedDependencies = filteredResults
    .map((result) => {
      // Find the original dependency by matching serviceName and dependsOn
      return dependencies.find(
        (dep) =>
          (dep.sourceServiceName || dep.sourceServiceId) === result.item.serviceName &&
          (dep.targetServiceName || dep.targetServiceId) === result.item.dependsOn
      )
    })
    .filter((dep): dep is NonNullable<typeof dep> => dep !== undefined)

  // Calculate stats
  const stats = {
    total: dependencies.length,
    critical: dependencies.filter(d => d.isCritical).length,
    byType: {
      runtime: dependencies.filter(d => d.dependencyType === 'runtime').length,
      data: dependencies.filter(d => d.dependencyType === 'data').length,
      deployment: dependencies.filter(d => d.dependencyType === 'deployment').length,
      'shared-lib': dependencies.filter(d => d.dependencyType === 'shared-lib').length,
    },
  }

  const hasDependencies = dependencies.length > 0
  const hasServices = services.length > 0

  // Setup keyboard shortcuts
  useKeyboardShortcuts({
    onSearch: () => searchRef.current?.focus(),
    onClearSearch: () => searchRef.current?.clear(),
    onShowHelp: () => setShowShortcuts(true),
    onOpenFilters: () => filtersRef.current?.focusFirst(),
    onExport: () => exportButtonRef.current?.click(),
  })

  // Empty State
  if (!isLoading && !hasDependencies) {
    return (
      <div className="space-y-6 p-6">
        {/* Header */}
        <div>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Service Dependencies</h1>
              <p className="text-muted-foreground mt-1">
                Visualize and manage service dependency relationships
              </p>
            </div>
            {hasServices && (
              <Button onClick={() => setIsAddDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Dependency
              </Button>
            )}
          </div>
        </div>

        {/* Setup Steps */}
        <DependencySetupSteps hasServices={hasServices} />

        {/* Graph Preview */}
        <DependencyGraphPreview />

        {/* Value Proposition */}
        <DependencyBenefits />

        {/* Integration Options */}
        <DependencyIntegrations />

        {/* Use Cases */}
        <DependencyUseCases />

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
    <div className="space-y-6 p-6">
      {/* Header */}
      <div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Service Dependencies</h1>
            <p className="text-muted-foreground mt-1">
              Visualize and manage service dependency relationships
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowShortcuts(true)}
              className="text-muted-foreground hover:text-foreground"
            >
              <Command className="h-4 w-4 mr-2" />
              Shortcuts
            </Button>
            <ExportMenu
              ref={exportButtonRef}
              dependencies={displayedDependencies}
              cycles={cycles}
              graphRef={graphRef}
              activeTab={activeTab}
            />
            <Button onClick={() => setIsAddDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Dependency
            </Button>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard
          label="Total Dependencies"
          value={stats.total}
          icon={Network}
        />
        <StatCard
          label="Critical Path"
          value={stats.critical}
          icon={AlertTriangle}
          variant={stats.critical > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Runtime Dependencies"
          value={stats.byType.runtime}
          icon={Activity}
        />
        <StatCard
          label="Circular Cycles"
          value={cycles.length}
          icon={AlertTriangle}
          variant={cycles.length > 0 ? 'destructive' : 'default'}
        />
      </div>

      {/* Circular Dependency Alert */}
      {cycles.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <strong>Warning:</strong> {cycles.length} circular dependency cycle{cycles.length > 1 ? 's' : ''} detected.
            This can cause deployment issues and runtime failures.
            {' '}
            <button
              onClick={() => setActiveTab('list')}
              className="underline font-semibold"
            >
              View details
            </button>
          </AlertDescription>
        </Alert>
      )}

      {/* Search and Filters */}
      <div className="space-y-3">
        <DependencySearch
          ref={searchRef}
          query={query}
          onQueryChange={setQuery}
          resultsCount={displayedDependencies.length}
          totalCount={dependencies.length}
          isSearching={isSearching}
          onClear={clearSearch}
          hasActiveFilters={activeFilterCount > 0}
        />

        <DependencyFilters
          ref={filtersRef}
          filters={filters}
          onFilterChange={setFilter}
          onClearFilters={clearFilters}
          activeCount={activeFilterCount}
        />

        {activeFilterCount > 0 && (
          <FilterSummary filters={filters} onRemoveFilter={setFilter} />
        )}
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="graph">
            <Network className="h-4 w-4 mr-2" />
            Graph View
          </TabsTrigger>
          <TabsTrigger value="list">
            <List className="h-4 w-4 mr-2" />
            List View
          </TabsTrigger>
          <TabsTrigger value="impact">
            <Activity className="h-4 w-4 mr-2" />
            Impact Analysis
          </TabsTrigger>
        </TabsList>

        <TabsContent value="graph" className="space-y-4">
          <DependencyGraph onRefresh={refetch} graphRef={graphRef} />
        </TabsContent>

        <TabsContent value="list" className="space-y-4">
          <DependencyList
            dependencies={displayedDependencies}
            cycles={cycles}
            isLoading={isLoading}
            onRefresh={refetch}
            searchQuery={query}
            onClearSearch={clearSearch}
          />
        </TabsContent>

        <TabsContent value="impact" className="space-y-4">
          <ImpactAnalysisView />
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
    </div>
  )
}

// Stats Card Component
function StatCard({
  label,
  value,
  icon: Icon,
  variant = 'default',
}: {
  label: string
  value: number
  icon: any
  variant?: 'default' | 'warning' | 'destructive'
}) {
  const variantStyles = {
    default: 'border-border',
    warning: 'border-orange-200 bg-orange-50',
    destructive: 'border-red-200 bg-red-50',
  }

  return (
    <div className={`border rounded-lg p-4 ${variantStyles[variant]}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold mt-1">{value}</p>
        </div>
        <Icon className="h-8 w-8 text-muted-foreground" />
      </div>
    </div>
  )
}
