'use client'

import { Suspense, useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { PAGE_SUBTITLE_CLASS, PAGE_TITLE_CLASS } from '@/components/ui/typography'
import { deploymentsService } from '@/lib/services/deployments.service'
import type { DeploymentEnvironment } from '@/lib/types'
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZES,
  anyRecordedCost,
  deploymentStatusDisplay,
  deploymentSummaryText,
  formatChangeFailureRate,
  formatRecordedCost,
  pageNumbers,
  recordedCost,
  summarizeDeployments,
  type PageSize,
  type RecordedDeployment as Deployment,
  type StatsWindow,
} from '@/lib/deployments/status'
import { useWebSocket } from '@/lib/hooks/useWebSocket'
import { useDemoMode } from '@/components/demo/demo-mode-toggle'
import { useSalesDemo } from '@/lib/demo/sales-demo-data'
import { usePlan } from '@/lib/hooks/use-plan'
import { Rocket, RefreshCw, ArrowRight, XCircle, X, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react'

type EnvironmentFilter = 'all' | DeploymentEnvironment

const STATS_WINDOWS: { value: StatsWindow; days: number }[] = [
  { value: '7d', days: 7 },
  { value: '30d', days: 30 },
  { value: '90d', days: 90 },
]

const _now = Date.now()

const DEMO_DEPLOYMENTS: Deployment[] = [
  { id: 'd1', serviceId: 'svc-1', serviceName: 'api-gateway',         environment: 'production', awsRegion: 'us-east-1', status: 'success',   costEstimate: 245.50, deployedBy: 'sarah.chen@company.com',   deployedAt: new Date(_now - 1000 * 60 * 45).toISOString(),      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'd2', serviceId: 'svc-2', serviceName: 'auth-service',         environment: 'production', awsRegion: 'us-east-1', status: 'success',   costEstimate: 178.00, deployedBy: 'mike.johnson@company.com', deployedAt: new Date(_now - 1000 * 60 * 120).toISOString(),     createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'd3', serviceId: 'svc-3', serviceName: 'payment-processor',    environment: 'staging',    awsRegion: 'us-west-2', status: 'deploying', costEstimate: 89.50,  deployedBy: 'alex.wong@company.com',    deployedAt: new Date(_now - 1000 * 60 * 5).toISOString(),       createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'd4', serviceId: 'svc-4', serviceName: 'notification-service', environment: 'production', awsRegion: 'eu-west-1', status: 'success',   costEstimate: 156.30, deployedBy: 'emma.davis@company.com',   deployedAt: new Date(_now - 1000 * 60 * 60 * 6).toISOString(),  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'd5', serviceId: 'svc-5', serviceName: 'analytics-worker',     environment: 'production', awsRegion: 'us-east-1', status: 'success',   costEstimate: 312.80, deployedBy: 'david.kim@company.com',    deployedAt: new Date(_now - 1000 * 60 * 60 * 24).toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'd6', serviceId: 'svc-2', serviceName: 'auth-service',         environment: 'staging',    awsRegion: 'us-east-1', status: 'failed',    costEstimate: 45.00,  deployedBy: 'mike.johnson@company.com', deployedAt: new Date(_now - 1000 * 60 * 60 * 30).toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'd7', serviceId: 'svc-1', serviceName: 'api-gateway',         environment: 'production', awsRegion: 'us-east-1', status: 'success',   costEstimate: 238.00, deployedBy: 'sarah.chen@company.com',   deployedAt: new Date(_now - 1000 * 60 * 60 * 48).toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'd8', serviceId: 'svc-5', serviceName: 'analytics-worker',     environment: 'production', awsRegion: 'us-east-1', status: 'success',   costEstimate: 0,      deployedBy: 'david.kim@company.com',    deployedAt: new Date(_now - 1000 * 60 * 60 * 72).toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
]

const DEMO_DORA = {
  frequency: '12/week', frequencyTier: 'Elite',
  leadTime:  '2.4 hours', leadTimeTier: 'Elite',
  cfr:       '3.2%',    cfrTier:      'Elite',
  mttr:      '36 min',  mttrTier:     'Elite',
}

export default function DeploymentsPage() {
  return (
    <Suspense fallback={<div className="p-12 text-center text-ink-muted">Loading...</div>}>
      <DeploymentsContent />
    </Suspense>
  )
}

function DeploymentsContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { socket } = useWebSocket()
  const queryClient = useQueryClient()

  const [environmentFilter, setEnvironmentFilter] = useState<EnvironmentFilter>(
    (searchParams.get('environment') as EnvironmentFilter) || 'all'
  )

  const [statsWindow, setStatsWindow] = useState<StatsWindow>('30d')
  const windowDays = STATS_WINDOWS.find(w => w.value === statsWindow)!.days

  // The log is paged by the server; `page` is 1-based. Changing what is
  // selected (environment, window) or the page size starts again at page 1.
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE)
  const [page, setPage] = useState(1)

  useEffect(() => {
    const urlEnv = searchParams.get('environment') as EnvironmentFilter
    if (urlEnv && urlEnv !== environmentFilter) { setEnvironmentFilter(urlEnv); setPage(1) }
  }, [searchParams])

  const handleFilterChange = (filter: EnvironmentFilter) => {
    setEnvironmentFilter(filter)
    setPage(1)
    const params = new URLSearchParams(searchParams.toString())
    if (filter === 'all') params.delete('environment')
    else params.set('environment', filter)
    const queryString = params.toString()
    router.push(`/deployments${queryString ? `?${queryString}` : ''}`)
  }

  // One page of the log: the environment filter, the window and the paging
  // are applied by the server, and the total is counted with the same filters
  // as the summary cards.
  const { data: deploymentPage, isLoading, isPlaceholderData, error, refetch } = useQuery({
    queryKey: ['deployments', 'page', environmentFilter, statsWindow, pageSize, page],
    queryFn: () => deploymentsService.getPage({
      environment: environmentFilter,
      dateRange: statsWindow,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    }),
    placeholderData: keepPreviousData,
  })

  useEffect(() => {
    if (!socket) return
    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: ['deployments'] })
      queryClient.invalidateQueries({ queryKey: ['deployment-stats'] })
    }
    socket.on('deployment:started',   refresh)
    socket.on('deployment:status',    refresh)
    socket.on('deployment:completed', refresh)
    return () => {
      socket.off('deployment:started')
      socket.off('deployment:status')
      socket.off('deployment:completed')
    }
  }, [socket, queryClient])

  const demoMode      = useDemoMode()
  const salesDemoMode = useSalesDemo((state) => state.enabled)
  const isDemoActive  = demoMode || salesDemoMode
  const { tier }      = usePlan()

  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false)

  // Totals, change failure rate and last deployment come from the windowed
  // counts for the whole organization -- never from the page of rows below.
  const { data: deploymentStats, isLoading: statsLoading, error: statsError, refetch: refetchStats } = useQuery({
    queryKey: ['deployment-stats', environmentFilter, statsWindow],
    queryFn: () => deploymentsService.getStats({ environment: environmentFilter, dateRange: statsWindow }),
    enabled: !isDemoActive,
  })

  useEffect(() => {
    if (error && (error as any).response?.status === 402) setShowUpgradePrompt(true)
  }, [error])

  const [showModal,      setShowModal]      = useState(false)
  const [modalForm,      setModalForm]      = useState({ serviceName: '', environment: 'production', region: 'us-east-1', version: '' })
  const [modalSubmitting, setModalSubmitting] = useState(false)
  const [modalError,     setModalError]     = useState<string | null>(null)
  const [modalSuccess,   setModalSuccess]   = useState<string | null>(null)

  const handleNewDeploymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!modalForm.serviceName.trim()) { setModalError('Service name is required'); return }
    setModalSubmitting(true); setModalError(null)
    try {
      await deploymentsService.createFromModal({
        serviceName: modalForm.serviceName.trim(),
        environment: modalForm.environment,
        region:      modalForm.region,
        version:     modalForm.version.trim() || undefined,
      })
      setModalSuccess(`Deployment of ${modalForm.serviceName} to ${modalForm.environment} started`)
      queryClient.invalidateQueries({ queryKey: ['deployments'] })
      queryClient.invalidateQueries({ queryKey: ['deployment-stats'] })
      setModalForm({ serviceName: '', environment: 'production', region: 'us-east-1', version: '' })
      setTimeout(() => { setShowModal(false); setModalSuccess(null) }, 2000)
    } catch (err: any) {
      if (err.response?.status === 402) { setShowModal(false); setShowUpgradePrompt(true) }
      else setModalError(err.message || 'Failed to create deployment')
    } finally { setModalSubmitting(false) }
  }

  // Demo mode has no API: the same filters, window and paging over the demo
  // fixtures.
  const demoDeployments = DEMO_DEPLOYMENTS.filter((d: Deployment) =>
    (environmentFilter === 'all' || d.environment === environmentFilter) &&
    new Date(d.deployedAt).getTime() >= Date.now() - windowDays * 24 * 3_600_000
  )
  // While another page, filter, window or size is being fetched, the query
  // still holds the previous answer (so the pager keeps its place). Those rows
  // and that count belong to the previous selection: none of them is shown as
  // the new one's.
  const pagePending = !isDemoActive && (isLoading || isPlaceholderData)
  const filteredDeployments: Deployment[] = isDemoActive
    ? demoDeployments.slice((page - 1) * pageSize, page * pageSize)
    : pagePending ? [] : deploymentPage?.deployments ?? []
  const totalDeployments = isDemoActive ? demoDeployments.length : pagePending ? 0 : deploymentPage?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(totalDeployments / pageSize))
  const firstRow = totalDeployments === 0 ? 0 : (page - 1) * pageSize + 1
  const lastRow = firstRow === 0 ? 0 : firstRow + filteredDeployments.length - 1
  // Nothing records a cost today: the column appears only when a row in view has one.
  const showCost = anyRecordedCost(filteredDeployments)
  const rowGrid = showCost
    ? 'sm:grid-cols-[2fr_130px_130px_160px_120px_100px]'
    : 'sm:grid-cols-[2fr_130px_130px_160px_120px]'

  // The log shrank under the current page (rows deleted, or a refresh): step
  // back to the last page that exists rather than showing an empty one.
  useEffect(() => {
    if (!pagePending && page > pageCount) setPage(pageCount)
  }, [pagePending, page, pageCount])

  // Demo mode has no API: the same counts, from the demo fixtures.
  const stats = isDemoActive
    ? { ...summarizeDeployments(demoDeployments, windowDays), organization_has_deployments: DEMO_DEPLOYMENTS.length > 0 }
    : deploymentStats
  const finishedCount = stats ? stats.success + stats.failed : 0
  const unfinishedNote = stats
    ? [
        stats.in_progress > 0 ? `${stats.in_progress} in progress` : null,
        stats.no_completion_recorded > 0 ? `${stats.no_completion_recorded} with no completion recorded` : null,
        stats.unknown > 0 ? `${stats.unknown} with an unrecognised status` : null,
      ].filter(Boolean).join(' · ')
    : ''
  const lastDeployment = stats?.last_deployment ?? null
  const lastDeploymentDisplay = lastDeployment ? deploymentStatusDisplay(lastDeployment.status, null) : null
  const windowLabel = `Last ${windowDays} days`
  const environmentLabel = environmentFilter === 'all' ? '' : ` in ${environmentFilter}`
  // Nothing has ever been recorded for this organization, in any environment
  // or window: say that, instead of a row of zeros that reads like data. An
  // environment or window with nothing in it is a different, narrower fact.
  const nothingRecorded = !!stats && !stats.organization_has_deployments

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 max-w-[1320px] mx-auto">
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {/* ── PAGE HEADER ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-8">
        <div>
          <h1 className={`${PAGE_TITLE_CLASS} mb-1`}>Deployment History</h1>
          <p className={PAGE_SUBTITLE_CLASS}>
            Track all service deployments across environments · Status as recorded by your pipeline
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { refetch(); refetchStats() }}
            className="flex items-center gap-2 bg-white text-ink-muted px-4 py-2 rounded-lg text-ui font-medium border border-slate-200 hover:border-slate-300 cursor-pointer transition-colors whitespace-nowrap"
          >
            <RefreshCw size={14} /> Refresh
          </button>
          <button
            onClick={() => { setShowModal(true); setModalError(null); setModalSuccess(null) }}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 rounded-lg text-ui font-semibold border-none cursor-pointer transition-colors whitespace-nowrap"
          >
            <Rocket size={14} /> New Deployment
          </button>
        </div>
      </div>

      {/* ── UPGRADE PROMPT ── */}
      {showUpgradePrompt && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between bg-amber-50 border border-amber-400 rounded-xl px-5 py-3.5 mb-6 gap-3">
          <div className="flex items-center gap-2.5">
            <span className="text-lg">⚠️</span>
            <span className="text-ui font-medium text-amber-900">
              You've reached your monthly deployment limit on the <strong>{tier}</strong> plan. Upgrade to continue deploying.
            </span>
          </div>
          <a href="/settings/billing/upgrade" className="shrink-0 text-label text-white bg-amber-500 hover:bg-amber-600 rounded-lg px-4 py-2 no-underline whitespace-nowrap transition-colors">
            Upgrade plan
          </a>
        </div>
      )}

      {/* ── ERROR BANNER ── */}
      {!isDemoActive && error && !showUpgradePrompt && (
        <div className="flex items-center gap-2.5 bg-red-50 border border-red-200 rounded-xl px-5 py-3.5 mb-6">
          <AlertTriangle size={16} className="text-red-600 shrink-0" />
          <span className="text-ui text-red-800">Failed to load deployments — check your connection and try again.</span>
          <button onClick={() => refetch()} className="ml-auto text-label text-ink-danger bg-transparent border border-red-200 rounded-lg px-3 py-1.5 cursor-pointer shrink-0">
            Retry
          </button>
        </div>
      )}

      {nothingRecorded ? (
        <div className="bg-white rounded-xl px-5 py-6 border border-slate-200 mb-6 flex items-start gap-3.5" data-testid="deployments-empty-state">
          <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
            <Rocket size={14} className="text-slate-600" />
          </div>
          <div>
            <p className="text-ui font-semibold text-slate-900 mb-1">No deployments recorded</p>
            <p className="text-ui text-ink-muted leading-relaxed m-0">Connect your CI to record deployments. Success, failure and change failure rate appear here once a deployment has been recorded.</p>
          </div>
        </div>
      ) : (<>
      {/* ── SUMMARY (built from the recorded counts; not model output) ── */}
      <div className="bg-white rounded-xl px-5 py-4 border border-slate-100 mb-6 flex items-start gap-3.5" data-testid="deployment-summary">
        <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
          <Rocket size={14} className="text-slate-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-label text-ink-muted uppercase tracking-[0.04em] mb-1">Summary · {windowLabel}</p>
          <p className="text-ui text-slate-800 leading-relaxed m-0">
            {stats
              ? deploymentSummaryText(stats)
              : statsError
                ? 'The deployment summary could not be loaded.'
                : 'Loading deployment summary…'}
          </p>
        </div>
        <div className="flex bg-slate-50 rounded-lg p-1 gap-0.5 shrink-0" role="group" aria-label="Summary window">
          {STATS_WINDOWS.map(w => (
            <button
              key={w.value}
              onClick={() => { setStatsWindow(w.value); setPage(1) }}
              aria-pressed={statsWindow === w.value}
              className={`px-2.5 py-1 rounded-md text-label border-none cursor-pointer whitespace-nowrap transition-all ${
                statsWindow === w.value ? 'bg-white text-slate-900 shadow-sm' : 'bg-transparent text-ink-muted'
              }`}
            >
              {w.value}
            </button>
          ))}
        </div>
      </div>

      {/* ── 4 SUMMARY CARDS ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-2">
        {[
          {
            label: 'Succeeded',
            value: stats ? stats.success : '—',
            sub: windowLabel,
            valueClass: 'text-slate-900',
          },
          {
            label: 'Failed deploys',
            value: stats ? stats.failed : '—',
            sub: `${windowLabel} · pipeline runs stopped by tests before deploying aren't counted`,
            valueClass: stats && stats.failed > 0 ? 'text-ink-danger' : 'text-slate-900',
          },
          {
            label: 'Change Failure Rate',
            value: stats ? formatChangeFailureRate(stats.change_failure_rate) : '—',
            sub: !stats
              ? windowLabel
              : finishedCount > 0
                ? `${stats.failed} of ${finishedCount} finished deployment${finishedCount !== 1 ? 's' : ''} failed`
                : 'No finished deployments in this window',
            valueClass: 'text-slate-900',
          },
          {
            label: 'Last Deployment',
            value: lastDeployment
              ? new Date(lastDeployment.deployed_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
              : '—',
            sub: lastDeploymentDisplay ? lastDeploymentDisplay.label : stats ? 'No finished deployment recorded' : windowLabel,
            valueClass: 'text-slate-900',
            small: true,
          },
        ].map(({ label, value, sub, valueClass, small }) => (
          <div key={label} className="bg-white rounded-xl p-5 sm:p-8 border border-slate-200" data-testid={`deployment-card-${label.toLowerCase().replace(/ /g, '-')}`}>
            <p className="text-label text-ink-muted uppercase tracking-[0.04em] mb-3">{label}</p>
            <div className={`${small ? 'text-section' : 'text-kpi'} tabular-nums leading-none mb-2 ${valueClass}`}>{value}</div>
            <p className="text-meta text-ink-muted m-0">{sub}</p>
          </div>
        ))}
      </div>
      <p className="text-meta text-ink-muted mb-6 min-h-4" data-testid="deployment-unfinished-note">
        {!isDemoActive && statsLoading
          ? ''
          : unfinishedNote
            ? `Not counted as succeeded or failed: ${unfinishedNote}.`
            : ''}
      </p>
      </>)}

      {/* ── DORA METRICS ── */}
      {isDemoActive ? (
        <div className="bg-white rounded-2xl p-6 sm:p-8 border border-slate-100 mb-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <p className="text-label text-ink-muted uppercase tracking-[0.04em] mb-1">DORA Metrics</p>
              <p className="text-ui font-semibold text-slate-900 m-0">
                Engineering Velocity —{' '}
                <span className="text-ink-success">Elite Tier</span>
                <span className="text-label bg-green-50 text-ink-success px-2 py-0.5 rounded-full ml-2">Top 10%</span>
              </p>
            </div>
            <a href="/app/dora-metrics" className="text-label text-violet-600 no-underline flex items-center gap-1 whitespace-nowrap">
              Full report <ArrowRight size={12} />
            </a>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5">
            {[
              { label: 'Deployment Frequency', value: DEMO_DORA.frequency, tier: DEMO_DORA.frequencyTier },
              { label: 'Lead Time for Changes', value: DEMO_DORA.leadTime,  tier: DEMO_DORA.leadTimeTier  },
              { label: 'Change Failure Rate',   value: DEMO_DORA.cfr,       tier: DEMO_DORA.cfrTier       },
              { label: 'Mean Time to Recovery', value: DEMO_DORA.mttr,      tier: DEMO_DORA.mttrTier      },
            ].map(({ label, value, tier }) => (
              <div key={label} className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                <p className="text-label text-ink-muted uppercase tracking-[0.04em] mb-2.5">{label}</p>
                <p className="text-section sm:text-kpi tabular-nums text-slate-900 mb-1.5">{value}</p>
                <span className={`text-label px-2 py-0.5 rounded-full ${
                  tier === 'Elite' ? 'bg-green-50 text-ink-success' : tier === 'High' ? 'bg-amber-50 text-ink-warning' : 'bg-red-50 text-ink-danger'
                }`}>{tier}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl p-6 border border-slate-100 mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="text-label text-ink-muted uppercase tracking-[0.04em] mb-1">DORA Metrics</p>
            <p className="text-ui text-ink-muted leading-relaxed m-0">{nothingRecorded ? 'Deployment frequency and change failure rate need recorded deployments.' : 'Deployment frequency and change failure rate are computed from these deployment records.'}</p>
          </div>
          <a href="/app/dora-metrics" className="text-ui font-semibold text-violet-600 no-underline flex items-center gap-1 shrink-0">
            View DORA metrics <ArrowRight size={13} />
          </a>
        </div>
      )}

      {/* ── DEPLOYMENT TABLE ── */}
      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">

        {/* Table header + filters */}
        <div className="px-5 sm:px-7 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="text-label text-ink-muted uppercase tracking-[0.04em] mb-0.5">Deployment Log</p>
            <p className="text-meta text-ink-muted m-0" data-testid="deployment-log-count">
              {pagePending
                ? windowLabel
                : error && !isDemoActive
                  ? `${windowLabel} · count unavailable`
                  : `${windowLabel} · ${totalDeployments} deployment${totalDeployments !== 1 ? 's' : ''}${environmentLabel}`}
            </p>
          </div>
          {/* Environment filter */}
          <div className="flex bg-slate-50 rounded-lg p-1 gap-0.5 overflow-x-auto">
            {(['all', 'production', 'staging', 'development'] as const).map(env => (
              <button
                key={env}
                onClick={() => handleFilterChange(env as EnvironmentFilter)}
                className={`px-3 py-1 rounded-md text-label border-none cursor-pointer capitalize whitespace-nowrap transition-all ${
                  environmentFilter === env ? 'bg-white text-slate-900 shadow-sm' : 'bg-transparent text-ink-muted'
                }`}
              >
                {env === 'all' ? 'All' : env}
              </button>
            ))}
          </div>
        </div>

        {/* Desktop column headers */}
        <div className={`hidden sm:grid ${rowGrid} px-7 py-2.5 bg-slate-50 border-b border-slate-100`} data-testid="deployment-log-columns">
          {['Service', 'Environment', 'Region', 'Deployed By', 'Status', ...(showCost ? ['Cost'] : [])].map(col => (
            <span key={col} className="text-label text-ink-muted uppercase tracking-[0.04em]">{col}</span>
          ))}
        </div>

        {/* Rows */}
        {pagePending ? (
          <div className="px-7 py-12 text-center" data-testid="deployment-log-loading">
            <RefreshCw size={20} className="text-slate-400 mx-auto mb-3" style={{ animation: 'spin 1s linear infinite' }} />
            <p className="text-ui text-ink-muted m-0">Loading deployments...</p>
          </div>
        ) : error && !isDemoActive ? (
          <div className="px-5 sm:px-16 py-12 text-center" data-testid="deployment-log-error">
            <p className="text-ui text-ink-muted m-0">Deployments could not be loaded.</p>
          </div>
        ) : filteredDeployments.length === 0 && nothingRecorded ? (
          <div className="px-5 sm:px-16 py-16 text-center" data-testid="deployment-log-empty" data-reason="none-recorded">
            <div className="w-12 h-12 rounded-xl bg-slate-50 flex items-center justify-center mx-auto mb-4">
              <Rocket size={22} className="text-slate-400" />
            </div>
            <p className="text-card-title text-slate-900 mb-1.5">No deployments recorded</p>
            <p className="text-ui text-ink-muted mb-6 leading-relaxed max-w-sm mx-auto">Connect your CI to record deployments.</p>
            <button
              onClick={() => { setShowModal(true); setModalError(null); setModalSuccess(null) }}
              className="bg-violet-600 hover:bg-violet-700 text-white px-6 py-2.5 rounded-lg text-ui font-semibold border-none cursor-pointer inline-flex items-center gap-2 transition-colors"
            >
              <Rocket size={14} /> Create First Deployment
            </button>
          </div>
        ) : filteredDeployments.length === 0 ? (
          // The filters select nothing. Whether the organization has
          // deployments elsewhere is the stats' to say; this never claims
          // that nothing was recorded at all.
          <div className="px-5 sm:px-16 py-12 text-center" data-testid="deployment-log-empty" data-reason="no-match">
            <p className="text-card-title text-slate-900 mb-1.5">
              No deployments{environmentLabel} in the last {windowDays} days
            </p>
            <p className="text-ui text-ink-muted m-0 leading-relaxed max-w-sm mx-auto">
              Try a longer window{environmentFilter === 'all' ? '' : ' or another environment'}.
            </p>
          </div>
        ) : (
          filteredDeployments.map((d: Deployment, idx: number) => {
            // The status as recorded; unrecognised values are Unknown.
            const { label: statusLabel, color: statusColor, background: statusBg } = deploymentStatusDisplay(d.status, d.createdAt)
            const envColor    = d.environment === 'production' ? '#059669' : d.environment === 'staging' ? '#D97706' : '#64748B'
            const envBg       = d.environment === 'production' ? '#F0FDF4' : d.environment === 'staging' ? '#FFFBEB' : '#F8FAFC'

            return (
              <div key={d.id} className="border-b border-slate-50 last:border-b-0">

                {/* Mobile card */}
                <div className="sm:hidden px-5 py-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-ui font-semibold text-slate-900 mb-0.5 truncate">{d.serviceName || d.serviceId.slice(0, 8)}</p>
                      <p className="text-meta text-ink-muted m-0">
                        {new Date(d.deployedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        {d.deployedBy && ` · ${d.deployedBy.split('@')[0]}`}
                      </p>
                    </div>
                    <span className="text-label px-2.5 py-1 rounded-full shrink-0" style={{ background: statusBg, color: statusColor }}>{statusLabel}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-label px-2.5 py-0.5 rounded-full" style={{ background: envBg, color: envColor }}>{d.environment}</span>
                    <span className="text-meta text-ink-muted font-mono">{d.awsRegion}</span>
                    {recordedCost(d.costEstimate) !== null && <span className="text-meta font-semibold text-slate-700 ml-auto">{formatRecordedCost(d.costEstimate)}</span>}
                  </div>
                  {d.status === 'failed' && (
                    <div className="mt-2.5 px-3 py-2 bg-red-50 rounded-lg border border-red-100 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <XCircle size={12} className="text-red-600 shrink-0" />
                        <span className="text-meta text-red-800 font-medium">Deployment failed · Check logs</span>
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        <a href={`/deployments/${d.id}/logs`} className="text-label text-ink-danger no-underline bg-white border border-red-200 px-2 py-1 rounded">Logs</a>
                        <a href={`/deployments/${d.id}/rollback`} className="text-label text-ink-danger no-underline bg-white border border-red-200 px-2 py-1 rounded">Rollback</a>
                      </div>
                    </div>
                  )}
                </div>

                {/* Desktop row */}
                <div
                  className={`hidden sm:grid ${rowGrid} px-7 py-3.5 items-center transition-colors hover:bg-slate-50`}
                  data-testid="deployment-row"
                >
                  <div>
                    <p className="text-ui font-semibold text-slate-900 mb-0.5">{d.serviceName || d.serviceId.slice(0, 8)}</p>
                    <p className="text-meta text-ink-muted m-0">
                      {new Date(d.deployedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      {d.deployedBy && ` · ${d.deployedBy.split('@')[0]}`}
                    </p>
                  </div>
                  <span className="text-label px-2.5 py-1 rounded-full w-fit" style={{ background: envBg, color: envColor }}>{d.environment}</span>
                  <span className="text-meta text-ink-muted font-mono">{d.awsRegion || '—'}</span>
                  <span className="text-meta text-ink-muted overflow-hidden text-ellipsis whitespace-nowrap">{d.deployedBy?.split('@')[0] || '—'}</span>
                  <span className="text-label px-2.5 py-1 rounded-full w-fit" style={{ background: statusBg, color: statusColor }}>{statusLabel}</span>
                  {showCost && (
                    <span className="text-ui font-semibold tabular-nums text-slate-900" title={recordedCost(d.costEstimate) === null ? 'Not recorded' : undefined}>
                      {formatRecordedCost(d.costEstimate)}
                    </span>
                  )}
                </div>

                {/* Failed banner — desktop only (mobile handled inline above) */}
                {d.status === 'failed' && (
                  <div className="hidden sm:flex mx-7 mb-2 px-3.5 py-2.5 bg-red-50 rounded-lg border border-red-100 items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <XCircle size={13} className="text-red-600 shrink-0" />
                      <span className="text-meta text-red-800 font-medium">Deployment failed · Check logs and consider rolling back to previous version</span>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <a href={`/deployments/${d.id}/logs`} className="text-label text-ink-danger no-underline bg-white border border-red-200 px-2.5 py-1 rounded-lg">View Logs</a>
                      <a href={`/deployments/${d.id}/rollback`} className="text-label text-ink-danger no-underline bg-white border border-red-200 px-2.5 py-1 rounded-lg">Rollback</a>
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}

        {/* Pagination */}
        {(totalDeployments > 0 || (pagePending && isPlaceholderData)) && !(error && !isDemoActive) && (
          <div className="px-5 sm:px-7 py-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3" data-testid="deployment-pagination">
            <div className="flex items-center gap-4">
              <p className="text-meta text-ink-muted m-0" data-testid="deployment-range">
                {pagePending ? 'Loading…' : `${firstRow}–${lastRow} of ${totalDeployments}`}
              </p>
              <label className="flex items-center gap-1.5 text-meta text-ink-muted">
                Rows per page
                <select
                  value={pageSize}
                  onChange={e => { setPageSize(Number(e.target.value) as PageSize); setPage(1) }}
                  className="text-label font-normal text-slate-700 bg-white border border-slate-200 rounded-md px-1.5 py-1 cursor-pointer"
                >
                  {PAGE_SIZES.map(size => <option key={size} value={size}>{size}</option>)}
                </select>
              </label>
            </div>
            <nav className="flex items-center gap-1" aria-label="Deployment log pages">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={pagePending || page <= 1}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md text-label text-slate-600 bg-white border border-slate-200 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft size={12} /> Previous
              </button>
              {!pagePending && pageNumbers(page, pageCount).map((p, i) => p === 'gap' ? (
                <span key={`gap-${i}`} className="px-1 text-meta text-slate-400" aria-hidden="true">…</span>
              ) : (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  aria-label={`Page ${p}`}
                  aria-current={p === page ? 'page' : undefined}
                  className={`min-w-7 px-2 py-1 rounded-md text-label border cursor-pointer ${
                    p === page ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200'
                  }`}
                >
                  {p}
                </button>
              ))}
              <button
                onClick={() => setPage(p => Math.min(pageCount, p + 1))}
                disabled={pagePending || page >= pageCount}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md text-label text-slate-600 bg-white border border-slate-200 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next <ChevronRight size={12} />
              </button>
            </nav>
          </div>
        )}
      </div>

      {/* ── NEW DEPLOYMENT MODAL ── */}
      {showModal && (
        <div
          className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-[1000] p-0 sm:p-4"
          onClick={e => { if (e.target === e.currentTarget) setShowModal(false) }}
        >
          <div className="bg-white rounded-t-2xl sm:rounded-2xl p-6 sm:p-8 w-full sm:max-w-lg shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-section text-slate-900 mb-1">New Deployment</h2>
                <p className="text-meta text-ink-muted m-0">Deploy a service to an environment</p>
              </div>
              <button onClick={() => setShowModal(false)} className="bg-transparent border-none cursor-pointer text-slate-400 hover:text-slate-600 p-1 transition-colors">
                <X size={18} />
              </button>
            </div>

            {modalSuccess ? (
              <div className="p-4 bg-green-50 rounded-xl border border-green-200 text-center">
                <p className="text-ui font-semibold text-ink-success m-0">{modalSuccess}</p>
              </div>
            ) : (
              <form method="post" onSubmit={handleNewDeploymentSubmit} className="flex flex-col gap-4">
                <div>
                  <label className="block text-label text-slate-700 mb-1.5">Service Name</label>
                  <input
                    type="text"
                    value={modalForm.serviceName}
                    onChange={e => setModalForm(f => ({ ...f, serviceName: e.target.value }))}
                    placeholder="e.g. api-gateway, auth-service"
                    className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-ui text-slate-900 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/15 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-label text-slate-700 mb-1.5">Environment</label>
                  <select
                    value={modalForm.environment}
                    onChange={e => setModalForm(f => ({ ...f, environment: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-ui text-slate-900 bg-white outline-none focus:border-violet-500 transition-all"
                  >
                    <option value="production">Production</option>
                    <option value="staging">Staging</option>
                    <option value="development">Development</option>
                  </select>
                </div>
                <div>
                  <label className="block text-label text-slate-700 mb-1.5">Region</label>
                  <select
                    value={modalForm.region}
                    onChange={e => setModalForm(f => ({ ...f, region: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-ui text-slate-900 bg-white outline-none focus:border-violet-500 transition-all"
                  >
                    <option value="us-east-1">us-east-1 (N. Virginia)</option>
                    <option value="us-west-2">us-west-2 (Oregon)</option>
                    <option value="eu-west-1">eu-west-1 (Ireland)</option>
                    <option value="eu-central-1">eu-central-1 (Frankfurt)</option>
                    <option value="ap-southeast-1">ap-southeast-1 (Singapore)</option>
                    <option value="ap-northeast-1">ap-northeast-1 (Tokyo)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-label text-slate-700 mb-1.5">
                    Version <span className="font-normal text-ink-muted">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={modalForm.version}
                    onChange={e => setModalForm(f => ({ ...f, version: e.target.value }))}
                    placeholder="e.g. v2.4.1, main@a1b2c3d"
                    className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-ui text-slate-900 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/15 transition-all"
                  />
                </div>
                {modalError && (
                  <div className="px-3.5 py-2.5 bg-red-50 rounded-lg border border-red-100">
                    <p className="text-meta text-ink-danger m-0">{modalError}</p>
                  </div>
                )}
                <div className="flex gap-3 justify-end pt-1">
                  <button type="button" onClick={() => setShowModal(false)}
                    className="px-5 py-2.5 rounded-lg border border-slate-200 bg-white text-slate-600 text-ui font-medium cursor-pointer hover:bg-slate-50 transition-colors">
                    Cancel
                  </button>
                  <button type="submit" disabled={modalSubmitting}
                    className={`px-5 py-2.5 rounded-lg text-white text-ui font-semibold border-none inline-flex items-center gap-2 transition-colors ${modalSubmitting ? 'bg-violet-400 cursor-default' : 'bg-violet-600 hover:bg-violet-700 cursor-pointer'}`}>
                    {modalSubmitting
                      ? <><RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} /> Deploying...</>
                      : <><Rocket size={13} /> Deploy</>
                    }
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  )
}