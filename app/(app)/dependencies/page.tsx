'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { useQueryClient } from '@tanstack/react-query'
import type { Node, Edge } from '@xyflow/react'
import { Network, List, Activity, AlertTriangle, Plus, Loader2, X, Clock, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PAGE_SUBTITLE_CLASS, PAGE_TITLE_CLASS } from '@/components/ui/typography'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ErrorDisplay } from '@/components/ui/error-display'
import { createAppError, ErrorType, type AppError } from '@/lib/errors/error-types'
import { useCurrentRole } from '@/lib/hooks/use-current-role'
import {
  SessionOrganizationChangedError,
  dependencyKeys,
  useDependencyCycles,
  useDependencyList,
  useDependencyServices,
  useSessionOrganizationId,
} from '@/lib/hooks/use-dependencies'
import {
  DependencyList,
  DEPENDENCY_TYPE_LABELS,
  NO_DEPENDENCY_FILTERS,
  filterDependencies,
  type DependencyListFilters,
} from '@/components/dependencies/DependencyList'
import { EnhancedEmptyState } from '@/components/dependencies/EnhancedEmptyState'
import { ExportMenu } from '@/components/dependencies/ExportMenu'
import type { CircularDependency, ServiceDependency } from '@/lib/types'

// Dynamically import React Flow component to avoid SSR issues
const DependencyGraph = dynamic(
  () => import('@/components/dependencies/DependencyGraph').then(mod => mod.DependencyGraph),
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

const NO_DATA = 'No data yet'

/** How long the first load may take before the page says so. */
export const LOADING_TIMEOUT_MS = 15_000

function toAppError(error: unknown): AppError {
  if (error instanceof SessionOrganizationChangedError) {
    return {
      type: ErrorType.AUTH_ERROR,
      message: error.message,
      userMessage: 'Your session switched to a different organization. Reload the page to see its dependencies.',
      retryable: false,
    }
  }
  return createAppError(error, 'load dependencies')
}

function display(value: unknown): string {
  return typeof value === 'string' && value.trim() !== '' ? value : NO_DATA
}

/**
 * Service dependencies as recorded in service_dependencies, read through
 * /api/dependencies. Every figure on this page comes from those rows or the
 * organization's services; there is no demo data, no browser cache, and no
 * metric the backend does not store.
 */
export default function DependenciesPage() {
  const organizationId = useSessionOrganizationId()
  // A new organization gets fresh page state: no tab, selection or open
  // panel carries over from the previous one.
  return <DependenciesContent key={organizationId ?? 'none'} organizationId={organizationId} />
}

function DependenciesContent({ organizationId }: { organizationId: string | null }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const role = useCurrentRole()
  const canManage = role === 'owner' || role === 'admin'
  const graphRef = useRef<HTMLDivElement>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [loadingTimeout, setLoadingTimeout] = useState(false)

  const [activeTab, setActiveTab] = useState('graph')
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null)
  const [impactServiceId, setImpactServiceId] = useState<string | null>(null)
  const [listFilters, setListFilters] = useState<DependencyListFilters>(NO_DEPENDENCY_FILTERS)
  const panelOpen = selectedNode !== null || selectedEdge !== null

  const listQuery = useDependencyList(organizationId)
  const cyclesQuery = useDependencyCycles(organizationId)
  const servicesQuery = useDependencyServices(organizationId)

  const dependencies = listQuery.data ?? []
  const cycles = cyclesQuery.data ?? []
  const hasServices = (servicesQuery.data?.length ?? 0) > 0

  const closePanel = () => {
    setSelectedNode(null)
    setSelectedEdge(null)
  }

  // Refetches every query on this page for this organization: list, cycles,
  // graph, services and any open impact analysis.
  const handleRefresh = async () => {
    if (!organizationId) return
    setIsRefreshing(true)
    try {
      await queryClient.refetchQueries({ queryKey: dependencyKeys.all(organizationId), type: 'active' })
    } finally {
      setIsRefreshing(false)
    }
  }

  // Say so when the first load is taking unusually long.
  const isFirstLoad = listQuery.isPending && !listQuery.isError
  useEffect(() => {
    if (!isFirstLoad) return
    const timer = setTimeout(() => setLoadingTimeout(true), LOADING_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [isFirstLoad])

  // Close the side panel on Escape
  useEffect(() => {
    if (!panelOpen) return
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedNode(null)
        setSelectedEdge(null)
      }
    }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [panelOpen])

  const addButton = canManage && organizationId && hasServices ? (
    <Button
      onClick={() => setIsAddDialogOpen(true)}
      aria-label="Add new dependency"
      aria-haspopup="dialog"
    >
      <Plus className="h-4 w-4 mr-2" aria-hidden="true" />
      Add Dependency
    </Button>
  ) : null

  let body: React.ReactNode
  if (listQuery.isError) {
    // A failed load is an error, never "no dependencies".
    body = (
      <ErrorDisplay
        error={toAppError(listQuery.error)}
        onRetry={listQuery.error instanceof SessionOrganizationChangedError ? undefined : () => { listQuery.refetch() }}
        isRetrying={listQuery.isFetching}
      />
    )
  } else if (listQuery.isPending) {
    body = loadingTimeout && isFirstLoad ? (
      <div role="status" className="flex flex-col items-center justify-center rounded-xl border border-amber-200 bg-amber-50 px-4 py-8 text-center sm:px-6 sm:py-12">
        <Clock size={32} className="mb-4 text-amber-600" aria-hidden="true" />
        <h3 className="mb-2 text-card-title text-amber-800">
          This is taking longer than usual
        </h3>
        <p className="mb-5 max-w-md text-ui leading-relaxed text-amber-700">
          We&apos;re still loading your dependencies. This might be due to network conditions. You can wait or try refreshing.
        </p>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="flex items-center gap-2 rounded-lg border border-amber-200 bg-white px-4 py-2 text-ui font-semibold text-amber-800 disabled:cursor-not-allowed"
        >
          <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} aria-hidden="true" />
          {isRefreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>
    ) : (
      <div role="status" className="flex items-center justify-center gap-2 rounded-lg border bg-white p-12 text-ui text-ink-muted">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Loading dependencies...
      </div>
    )
  } else if (dependencies.length === 0) {
    body = (
      <>
        <p className="text-ui font-medium text-slate-700">No dependencies recorded yet.</p>
        <EnhancedEmptyState
          canManage={canManage}
          hasServices={servicesQuery.isSuccess ? hasServices : null}
          onAddDependency={() => setIsAddDialogOpen(true)}
          onAddService={() => router.push('/services/new')}
        />
      </>
    )
  } else {
    const critical = dependencies.filter(d => d.isCritical).length
    const runtime = dependencies.filter(d => d.dependencyType === 'runtime').length
    const cyclesValue = cyclesQuery.isError ? 'Unavailable' : cyclesQuery.isPending ? '—' : String(cycles.length)

    body = (
      <>
        {/* Counts, all from the rows above */}
        <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
          {[
            ['Total dependencies', String(dependencies.length)],
            ['Critical', String(critical)],
            ['Runtime', String(runtime)],
            ['Circular cycles', cyclesValue],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border bg-white p-4">
              <p className="text-label uppercase tracking-[0.04em] text-slate-700 mb-1">{label}</p>
              <p className="text-section lg:text-kpi tabular-nums text-slate-900">{value}</p>
            </div>
          ))}
        </div>

        {cycles.length > 0 && (
          <Alert variant="destructive" role="alert">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
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

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList aria-label="Dependency view options">
            <TabsTrigger value="graph">
              <Network className="h-4 w-4 mr-2" aria-hidden="true" />
              Graph View
            </TabsTrigger>
            <TabsTrigger value="list">
              <List className="h-4 w-4 mr-2" aria-hidden="true" />
              List View
            </TabsTrigger>
            <TabsTrigger value="impact">
              <Activity className="h-4 w-4 mr-2" aria-hidden="true" />
              Impact Analysis
            </TabsTrigger>
          </TabsList>

          <TabsContent value="graph" className="space-y-4">
            <DependencyGraph
              organizationId={organizationId}
              graphRef={graphRef}
              onNodeClick={(node) => { setSelectedNode(node); setSelectedEdge(null) }}
              onEdgeClick={(edge) => { setSelectedEdge(edge); setSelectedNode(null) }}
            />
          </TabsContent>

          <TabsContent value="list" className="space-y-4">
            <DependencyList
              dependencies={dependencies}
              cycles={cycles}
              filters={listFilters}
              onFiltersChange={setListFilters}
            />
          </TabsContent>

          <TabsContent value="impact" className="space-y-4">
            <ImpactAnalysisView
              organizationId={organizationId}
              selectedServiceId={impactServiceId}
              onSelectService={setImpactServiceId}
            />
          </TabsContent>
        </Tabs>

        {panelOpen && (
          <>
            <div className="fixed inset-0 z-[49]" onClick={closePanel} />
            <DetailsPanel
              node={selectedNode}
              edge={selectedEdge}
              dependencies={dependencies}
              cycles={cyclesQuery.isSuccess ? cycles : null}
              onClose={closePanel}
              onAnalyzeImpact={(serviceId) => {
                setImpactServiceId(serviceId)
                setActiveTab('impact')
                closePanel()
              }}
              onViewServices={() => {
                closePanel()
                router.push('/services')
              }}
            />
          </>
        )}
      </>
    )
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-[1320px] flex-col gap-6 overflow-x-hidden bg-[#F9FAFB] px-4 py-6 sm:px-6 sm:py-10 lg:px-14">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className={`${PAGE_TITLE_CLASS} mb-1`}>Service Dependency Mapping</h1>
          <p className={PAGE_SUBTITLE_CLASS}>
            Map dependencies, detect cycles, and analyze impact
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {organizationId && (
            <Button
              variant="outline"
              onClick={handleRefresh}
              disabled={isRefreshing}
              aria-label={isRefreshing ? 'Refreshing dependencies' : 'Refresh dependencies'}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
              {isRefreshing ? 'Refreshing...' : 'Refresh'}
            </Button>
          )}
          {listQuery.isSuccess && dependencies.length > 0 && (
            <ExportMenu
              // The searched and filtered rows, as the list view shows them.
              dependencies={filterDependencies(dependencies, listFilters)}
              cycles={cyclesQuery.isSuccess ? cycles : null}
              graphRef={graphRef}
              activeTab={activeTab}
            />
          )}
          {listQuery.isSuccess && dependencies.length > 0 && addButton}
        </div>
      </div>

      {body}

      {canManage && organizationId && (
        <AddDependencyDialog
          organizationId={organizationId}
          open={isAddDialogOpen}
          onClose={() => setIsAddDialogOpen(false)}
        />
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 rounded-lg bg-slate-50 px-3 py-2">
      <span className="text-ui text-ink-muted">{label}</span>
      <span className={`text-ui font-medium text-right ${value === NO_DATA ? 'text-ink-muted' : 'text-slate-900'}`}>{value}</span>
    </div>
  )
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 border-b border-slate-100 pb-1.5 text-label uppercase tracking-[0.04em] text-slate-600">
      {children}
    </p>
  )
}

interface DetailsPanelProps {
  node: Node | null
  edge: Edge | null
  dependencies: ServiceDependency[]
  /** null while cycles are loading or failed to load. */
  cycles: CircularDependency[] | null
  onClose: () => void
  onAnalyzeImpact: (serviceId: string) => void
  onViewServices: () => void
}

/**
 * Details of the clicked service or dependency. Shows only stored fields: the
 * service's own columns, the recorded dependency rows touching it, and the
 * detected cycles. Anything the product does not record reads "No data yet".
 */
function DetailsPanel({ node, edge, dependencies, cycles, onClose, onAnalyzeImpact, onViewServices }: DetailsPanelProps) {
  const title = node
    ? display(node.data?.label)
    : edge
      ? (() => {
          const dep = dependencies.find(d => d.id === edge.id)
          return `${dep?.sourceServiceName || edge.source} → ${dep?.targetServiceName || edge.target}`
        })()
      : ''

  const edgeDependency = edge ? dependencies.find(d => d.id === edge.id) ?? null : null

  let content: React.ReactNode = null
  if (node) {
    const dependsOn = dependencies.filter(d => d.sourceServiceId === node.id)
    const dependedOnBy = dependencies.filter(d => d.targetServiceId === node.id)
    const inCycle = cycles?.some(c => c.cycle.some(s => s.serviceId === node.id))
    content = (
      <>
        <div className="space-y-1.5">
          <SectionHeader>Service</SectionHeader>
          <Field label="Status" value={display(node.data?.status)} />
          <Field label="Owner" value={display(node.data?.owner)} />
          <Field label="Template" value={display(node.data?.template)} />
          <Field label="In a circular dependency" value={cycles === null ? NO_DATA : inCycle ? 'Yes' : 'No'} />
        </div>
        <div className="space-y-1.5">
          <SectionHeader>Depends on ({dependsOn.length})</SectionHeader>
          {dependsOn.length === 0 ? (
            <p className="text-ui text-ink-muted">None recorded</p>
          ) : dependsOn.map(d => (
            <Field
              key={d.id}
              label={`→ ${d.targetServiceName || d.targetServiceId}`}
              value={`${DEPENDENCY_TYPE_LABELS[d.dependencyType] || d.dependencyType}${d.isCritical ? ' · Critical' : ''}`}
            />
          ))}
        </div>
        <div className="space-y-1.5">
          <SectionHeader>Depended on by ({dependedOnBy.length})</SectionHeader>
          {dependedOnBy.length === 0 ? (
            <p className="text-ui text-ink-muted">None recorded</p>
          ) : dependedOnBy.map(d => (
            <Field
              key={d.id}
              label={`← ${d.sourceServiceName || d.sourceServiceId}`}
              value={`${DEPENDENCY_TYPE_LABELS[d.dependencyType] || d.dependencyType}${d.isCritical ? ' · Critical' : ''}`}
            />
          ))}
        </div>
        <div className="space-y-1.5">
          <SectionHeader>Runtime metrics</SectionHeader>
          <Field label="Latency, errors, traffic, cost" value={NO_DATA} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={onViewServices}>View Full Service</Button>
          <Button size="sm" variant="outline" onClick={() => onAnalyzeImpact(node.id)}>Analyze impact</Button>
        </div>
      </>
    )
  } else if (edge) {
    const dep = dependencies.find(d => d.id === edge.id)
    content = (
      <div className="space-y-1.5">
        <SectionHeader>Dependency</SectionHeader>
        <Field label="Type" value={dep ? DEPENDENCY_TYPE_LABELS[dep.dependencyType] || dep.dependencyType : NO_DATA} />
        <Field label="Priority" value={dep ? (dep.isCritical ? 'Critical' : 'Standard') : NO_DATA} />
        {!dep ? (
          <Field label="Failure Impact" value={NO_DATA} />
        ) : dep.isCritical ? (
          <Field label="Failure Impact" value="Critical" />
        ) : (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-ui text-ink-muted m-0">Not marked critical</p>
        )}
        <Field label="Description" value={display(dep?.description)} />
        <Field label="Recorded by" value={display(dep?.createdBy)} />
        <Field label="Recorded on" value={dep?.createdAt ? new Date(dep.createdAt).toLocaleDateString() : NO_DATA} />
        <Field label="Traffic between services" value={NO_DATA} />
      </div>
    )
  }

  return (
    <div
      role="dialog"
      aria-label={`Details: ${title}`}
      className="fixed right-0 top-0 z-50 h-screen w-full overflow-y-auto bg-white shadow-[-4px_0_24px_rgba(0,0,0,0.12)] sm:w-[420px]"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-2 border-b border-slate-100 px-6 pb-4 pt-5">
        <div className="min-w-0">
          <h2 className="text-card-title leading-snug text-slate-900">{title}</h2>
          {edgeDependency && (
            <span
              className={`mt-2 inline-block rounded px-2 py-0.5 text-label uppercase ${
                edgeDependency.isCritical ? 'bg-red-50 text-ink-danger' : 'bg-slate-50 text-ink-muted'
              }`}
            >
              {edgeDependency.isCritical
                ? 'Critical'
                : DEPENDENCY_TYPE_LABELS[edgeDependency.dependencyType] || edgeDependency.dependencyType} dependency
            </span>
          )}
        </div>
        <button onClick={onClose} aria-label="Close details" className="p-0.5 text-slate-400 hover:text-slate-600">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="flex flex-col gap-5 px-6 py-5">{content}</div>
    </div>
  )
}
