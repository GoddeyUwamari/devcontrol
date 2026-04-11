'use client'

import { Suspense, useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { deploymentsService } from '@/lib/services/deployments.service'
import type { Deployment, DeploymentEnvironment, DeploymentStatus } from '@/lib/types'
import { useWebSocket } from '@/lib/hooks/useWebSocket'
import { useDemoMode } from '@/components/demo/demo-mode-toggle'
import { useSalesDemo } from '@/lib/demo/sales-demo-data'
import { usePlan } from '@/lib/hooks/use-plan'
import { Rocket, RefreshCw, ArrowRight, Sparkles, XCircle, X, AlertTriangle } from 'lucide-react'

type EnvironmentFilter = 'all' | DeploymentEnvironment

const _now = Date.now()

const DEMO_DEPLOYMENTS: Deployment[] = [
  { id: 'd1', serviceId: 'svc-1', serviceName: 'api-gateway',         environment: 'production', awsRegion: 'us-east-1', status: 'running',   costEstimate: 245.50, deployedBy: 'sarah.chen@company.com',   deployedAt: new Date(_now - 1000 * 60 * 45).toISOString(),      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'd2', serviceId: 'svc-2', serviceName: 'auth-service',         environment: 'production', awsRegion: 'us-east-1', status: 'running',   costEstimate: 178.00, deployedBy: 'mike.johnson@company.com', deployedAt: new Date(_now - 1000 * 60 * 120).toISOString(),     createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'd3', serviceId: 'svc-3', serviceName: 'payment-processor',    environment: 'staging',    awsRegion: 'us-west-2', status: 'deploying', costEstimate: 89.50,  deployedBy: 'alex.wong@company.com',    deployedAt: new Date(_now - 1000 * 60 * 5).toISOString(),       createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'd4', serviceId: 'svc-4', serviceName: 'notification-service', environment: 'production', awsRegion: 'eu-west-1', status: 'running',   costEstimate: 156.30, deployedBy: 'emma.davis@company.com',   deployedAt: new Date(_now - 1000 * 60 * 60 * 6).toISOString(),  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'd5', serviceId: 'svc-5', serviceName: 'analytics-worker',     environment: 'production', awsRegion: 'us-east-1', status: 'running',   costEstimate: 312.80, deployedBy: 'david.kim@company.com',    deployedAt: new Date(_now - 1000 * 60 * 60 * 24).toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'd6', serviceId: 'svc-2', serviceName: 'auth-service',         environment: 'staging',    awsRegion: 'us-east-1', status: 'failed',    costEstimate: 45.00,  deployedBy: 'mike.johnson@company.com', deployedAt: new Date(_now - 1000 * 60 * 60 * 30).toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'd7', serviceId: 'svc-1', serviceName: 'api-gateway',         environment: 'production', awsRegion: 'us-east-1', status: 'running',   costEstimate: 238.00, deployedBy: 'sarah.chen@company.com',   deployedAt: new Date(_now - 1000 * 60 * 60 * 48).toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'd8', serviceId: 'svc-5', serviceName: 'analytics-worker',     environment: 'production', awsRegion: 'us-east-1', status: 'stopped',   costEstimate: 0,      deployedBy: 'david.kim@company.com',    deployedAt: new Date(_now - 1000 * 60 * 60 * 72).toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
]

const DEMO_DORA = {
  frequency: '12/week', frequencyTier: 'Elite',
  leadTime:  '2.4 hours', leadTimeTier: 'Elite',
  cfr:       '3.2%',    cfrTier:      'Elite',
  mttr:      '36 min',  mttrTier:     'Elite',
}

export default function DeploymentsPage() {
  return (
    <Suspense fallback={<div className="p-12 text-center text-slate-400">Loading...</div>}>
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

  useEffect(() => {
    const urlEnv = searchParams.get('environment') as EnvironmentFilter
    if (urlEnv && urlEnv !== environmentFilter) setEnvironmentFilter(urlEnv)
  }, [searchParams])

  const handleFilterChange = (filter: EnvironmentFilter) => {
    setEnvironmentFilter(filter)
    const params = new URLSearchParams(searchParams.toString())
    if (filter === 'all') params.delete('environment')
    else params.set('environment', filter)
    const queryString = params.toString()
    router.push(`/deployments${queryString ? `?${queryString}` : ''}`)
  }

  const { data: deployments = [], isLoading, error, refetch } = useQuery({
    queryKey: ['deployments', environmentFilter],
    queryFn: () => deploymentsService.getAll(
      environmentFilter !== 'all' ? { environment: environmentFilter } : undefined
    ),
  })

  useEffect(() => {
    if (!socket) return
    socket.on('deployment:started',   () => queryClient.invalidateQueries({ queryKey: ['deployments'] }))
    socket.on('deployment:status',    () => queryClient.invalidateQueries({ queryKey: ['deployments'] }))
    socket.on('deployment:completed', () => queryClient.invalidateQueries({ queryKey: ['deployments'] }))
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

  const { data: deploymentStats } = useQuery({
    queryKey: ['deployment-stats'],
    queryFn: () => deploymentsService.getStats(),
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
      setModalForm({ serviceName: '', environment: 'production', region: 'us-east-1', version: '' })
      setTimeout(() => { setShowModal(false); setModalSuccess(null) }, 2000)
    } catch (err: any) {
      if (err.response?.status === 402) { setShowModal(false); setShowUpgradePrompt(true) }
      else setModalError(err.message || 'Failed to create deployment')
    } finally { setModalSubmitting(false) }
  }

  const displayDeployments  = isDemoActive ? DEMO_DEPLOYMENTS : deployments
  const filteredDeployments = displayDeployments.filter((d: Deployment) =>
    !environmentFilter || environmentFilter === 'all' || d.environment === environmentFilter
  )

  const totalDeployments   = filteredDeployments.length
  const successCount       = filteredDeployments.filter((d: Deployment) => d.status === 'running').length
  const failedCount        = filteredDeployments.filter((d: Deployment) => d.status === 'failed').length
  const deployingCount     = filteredDeployments.filter((d: Deployment) => d.status === 'deploying').length
  const successRate        = totalDeployments > 0 ? Math.round((successCount / totalDeployments) * 100) : 0
  const totalCost          = filteredDeployments.reduce((sum: number, d: Deployment) => sum + (d.costEstimate || 0), 0)
  const displaySuccessRate = isDemoActive ? 94 : (totalDeployments > 0 ? successRate : null)
  const displayRunning     = isDemoActive ? 7  : successCount

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 max-w-[1320px] mx-auto">
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {/* ── PAGE HEADER ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mb-1">Deployment History</h1>
          <p className="text-sm text-slate-500 leading-relaxed">
            Track all service deployments across environments · Real-time status
            {!isDemoActive && deploymentStats && (
              <span className="ml-2 text-slate-400">
                · {deploymentStats.deployments_this_month} deployment{deploymentStats.deployments_this_month !== 1 ? 's' : ''} this month
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            className="flex items-center gap-2 bg-white text-slate-500 px-4 py-2 rounded-lg text-sm font-medium border border-slate-200 hover:border-slate-300 cursor-pointer transition-colors whitespace-nowrap"
          >
            <RefreshCw size={14} /> Refresh
          </button>
          <button
            onClick={() => { setShowModal(true); setModalError(null); setModalSuccess(null) }}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 rounded-lg text-sm font-semibold border-none cursor-pointer transition-colors whitespace-nowrap"
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
            <span className="text-sm font-medium text-amber-900">
              You've reached your monthly deployment limit on the <strong>{tier}</strong> plan. Upgrade to continue deploying.
            </span>
          </div>
          <a href="/settings/billing/upgrade" className="shrink-0 text-xs font-semibold text-white bg-amber-500 hover:bg-amber-600 rounded-lg px-4 py-2 no-underline whitespace-nowrap transition-colors">
            Upgrade plan
          </a>
        </div>
      )}

      {/* ── ERROR BANNER ── */}
      {!isDemoActive && error && !showUpgradePrompt && (
        <div className="flex items-center gap-2.5 bg-red-50 border border-red-200 rounded-xl px-5 py-3.5 mb-6">
          <AlertTriangle size={16} className="text-red-600 shrink-0" />
          <span className="text-sm text-red-800">Failed to load deployments — check your connection and try again.</span>
          <button onClick={() => refetch()} className="ml-auto text-xs font-semibold text-red-600 bg-transparent border border-red-200 rounded-lg px-3 py-1.5 cursor-pointer shrink-0">
            Retry
          </button>
        </div>
      )}

      {/* ── AI INSIGHT ── */}
      <div className="bg-white rounded-xl px-5 py-4 border border-slate-100 mb-6 flex items-start gap-3.5">
        <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center shrink-0">
          <Sparkles size={14} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-semibold text-violet-600 uppercase tracking-widest mb-1">AI Insight</p>
          <p className="text-sm text-slate-800 leading-relaxed m-0">
            {isDemoActive
              ? 'Deployment frequency is Elite tier at 12/week. All 4 DORA metrics are Elite tier — top 10% of engineering teams. payment-processor has a deploying status in staging — monitor for completion.'
              : totalDeployments === 0
                ? 'No deployments found. Connect your CI/CD pipeline to start tracking deployment history automatically.'
                : `${successCount} of ${totalDeployments} deployments are running successfully with ${successRate}% success rate. ${failedCount > 0 ? `${failedCount} failed deployment${failedCount > 1 ? 's' : ''} require attention.` : 'No failed deployments detected.'}`
            }
          </p>
        </div>
        {failedCount > 0 && (
          <a href="/anomalies" className="text-xs font-semibold text-violet-600 no-underline shrink-0 flex items-center gap-1 whitespace-nowrap">
            Investigate <ArrowRight size={12} />
          </a>
        )}
      </div>

      {/* ── 4 KPI CARDS ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          {
            label: 'Total Deployments',
            value: totalDeployments,
            sub: 'In selected filter',
            valueClass: 'text-slate-900',
          },
          {
            label: 'Success Rate',
            value: displaySuccessRate !== null ? `${displaySuccessRate}%` : '—',
            sub: `${displayRunning} running`,
            valueClass: displaySuccessRate === null ? 'text-slate-900' : displaySuccessRate >= 90 ? 'text-green-600' : displaySuccessRate >= 70 ? 'text-amber-500' : 'text-red-600',
          },
          {
            label: 'Active Now',
            value: deployingCount,
            sub: 'Currently deploying',
            valueClass: deployingCount > 0 ? 'text-amber-500' : 'text-green-600',
          },
          {
            label: 'Est. Cost',
            value: `$${Math.round(totalCost).toLocaleString()}`,
            sub: 'Total cost estimate',
            valueClass: 'text-slate-900',
          },
        ].map(({ label, value, sub, valueClass }) => (
          <div key={label} className="bg-white rounded-xl p-5 sm:p-8 border border-slate-200">
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-3">{label}</p>
            <div className={`text-3xl sm:text-4xl font-bold tracking-tight leading-none mb-2 ${valueClass}`}>{value}</div>
            <p className="text-xs text-slate-500 m-0">{sub}</p>
          </div>
        ))}
      </div>

      {/* ── DORA METRICS ── */}
      {isDemoActive ? (
        <div className="bg-white rounded-2xl p-6 sm:p-8 border border-slate-100 mb-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-1">DORA Metrics</p>
              <p className="text-sm font-semibold text-slate-900 m-0">
                Engineering Velocity —{' '}
                <span className="text-green-600">Elite Tier</span>
                <span className="text-[11px] font-semibold bg-green-50 text-green-600 px-2 py-0.5 rounded-full ml-2">Top 10%</span>
              </p>
            </div>
            <a href="/dora-metrics" className="text-xs font-semibold text-violet-600 no-underline flex items-center gap-1 whitespace-nowrap">
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
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-2.5">{label}</p>
                <p className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight mb-1.5">{value}</p>
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                  tier === 'Elite' ? 'bg-green-50 text-green-600' : tier === 'High' ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-600'
                }`}>{tier}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl p-6 border border-slate-100 mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-1">DORA Metrics</p>
            <p className="text-sm text-slate-500 leading-relaxed m-0">Connect your CI/CD pipeline to unlock deployment frequency, lead time, and reliability metrics.</p>
          </div>
          <a href="/dora-metrics" className="text-sm font-semibold text-violet-600 no-underline flex items-center gap-1 shrink-0">
            Learn more <ArrowRight size={13} />
          </a>
        </div>
      )}

      {/* ── DEPLOYMENT TABLE ── */}
      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">

        {/* Table header + filters */}
        <div className="px-5 sm:px-7 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-0.5">Deployment Log</p>
            <p className="text-xs text-slate-400 m-0">{filteredDeployments.length} deployments</p>
          </div>
          {/* Environment filter */}
          <div className="flex bg-slate-50 rounded-lg p-1 gap-0.5 overflow-x-auto">
            {(['all', 'production', 'staging', 'development'] as const).map(env => (
              <button
                key={env}
                onClick={() => handleFilterChange(env as EnvironmentFilter)}
                className={`px-3 py-1 rounded-md text-xs font-semibold border-none cursor-pointer capitalize whitespace-nowrap transition-all ${
                  environmentFilter === env ? 'bg-white text-slate-900 shadow-sm' : 'bg-transparent text-slate-500'
                }`}
              >
                {env === 'all' ? 'All' : env}
              </button>
            ))}
          </div>
        </div>

        {/* Desktop column headers */}
        <div className="hidden sm:grid sm:grid-cols-[2fr_130px_130px_160px_120px_100px] px-7 py-2.5 bg-slate-50 border-b border-slate-100">
          {['Service', 'Environment', 'Region', 'Deployed By', 'Status', 'Cost'].map(col => (
            <span key={col} className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{col}</span>
          ))}
        </div>

        {/* Rows */}
        {isLoading && !isDemoActive ? (
          <div className="px-7 py-12 text-center">
            <RefreshCw size={20} className="text-slate-400 mx-auto mb-3" style={{ animation: 'spin 1s linear infinite' }} />
            <p className="text-sm text-slate-500 m-0">Loading deployments...</p>
          </div>
        ) : filteredDeployments.length === 0 ? (
          <div className="px-5 sm:px-16 py-16 text-center">
            <div className="w-12 h-12 rounded-xl bg-slate-50 flex items-center justify-center mx-auto mb-4">
              <Rocket size={22} className="text-slate-400" />
            </div>
            <p className="text-base font-semibold text-slate-900 mb-1.5">No deployments found</p>
            <p className="text-sm text-slate-500 mb-6 leading-relaxed max-w-sm mx-auto">Connect your CI/CD pipeline to start tracking deployments automatically.</p>
            <button
              onClick={() => { setShowModal(true); setModalError(null); setModalSuccess(null) }}
              className="bg-violet-600 hover:bg-violet-700 text-white px-6 py-2.5 rounded-lg text-sm font-semibold border-none cursor-pointer inline-flex items-center gap-2 transition-colors"
            >
              <Rocket size={14} /> Create First Deployment
            </button>
          </div>
        ) : (
          filteredDeployments.map((d: Deployment, idx: number) => {
            const statusColor = d.status === 'running' ? '#059669' : d.status === 'deploying' ? '#D97706' : d.status === 'failed' ? '#DC2626' : '#64748B'
            const statusBg    = d.status === 'running' ? '#F0FDF4' : d.status === 'deploying' ? '#FFFBEB' : d.status === 'failed' ? '#FEF2F2' : '#F8FAFC'
            const statusLabel = d.status === 'running' ? 'Running' : d.status === 'deploying' ? 'Deploying' : d.status === 'failed' ? 'Failed' : 'Stopped'
            const envColor    = d.environment === 'production' ? '#059669' : d.environment === 'staging' ? '#D97706' : '#64748B'
            const envBg       = d.environment === 'production' ? '#F0FDF4' : d.environment === 'staging' ? '#FFFBEB' : '#F8FAFC'

            return (
              <div key={d.id} className="border-b border-slate-50 last:border-b-0">

                {/* Mobile card */}
                <div className="sm:hidden px-5 py-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-900 mb-0.5 truncate">{d.serviceName || d.serviceId.slice(0, 8)}</p>
                      <p className="text-xs text-slate-400 m-0">
                        {new Date(d.deployedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        {d.deployedBy && ` · ${d.deployedBy.split('@')[0]}`}
                      </p>
                    </div>
                    <span className="text-xs font-bold px-2.5 py-1 rounded-full shrink-0" style={{ background: statusBg, color: statusColor }}>{statusLabel}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full" style={{ background: envBg, color: envColor }}>{d.environment}</span>
                    <span className="text-xs text-slate-400 font-mono">{d.awsRegion}</span>
                    {d.costEstimate ? <span className="text-xs font-semibold text-slate-700 ml-auto">${d.costEstimate.toFixed(2)}</span> : null}
                  </div>
                  {d.status === 'failed' && (
                    <div className="mt-2.5 px-3 py-2 bg-red-50 rounded-lg border border-red-100 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <XCircle size={12} className="text-red-600 shrink-0" />
                        <span className="text-xs text-red-800 font-medium">Deployment failed · Check logs</span>
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        <a href={`/deployments/${d.id}/logs`} className="text-[11px] font-bold text-red-600 no-underline bg-white border border-red-200 px-2 py-1 rounded">Logs</a>
                        <a href={`/deployments/${d.id}/rollback`} className="text-[11px] font-bold text-red-600 no-underline bg-white border border-red-200 px-2 py-1 rounded">Rollback</a>
                      </div>
                    </div>
                  )}
                </div>

                {/* Desktop row */}
                <div
                  className="hidden sm:grid sm:grid-cols-[2fr_130px_130px_160px_120px_100px] px-7 py-3.5 items-center transition-colors hover:bg-slate-50"
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-900 mb-0.5">{d.serviceName || d.serviceId.slice(0, 8)}</p>
                    <p className="text-xs text-slate-400 m-0">
                      {new Date(d.deployedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      {d.deployedBy && ` · ${d.deployedBy.split('@')[0]}`}
                    </p>
                  </div>
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full w-fit" style={{ background: envBg, color: envColor }}>{d.environment}</span>
                  <span className="text-xs text-slate-500 font-mono">{d.awsRegion || '—'}</span>
                  <span className="text-xs text-slate-500 overflow-hidden text-ellipsis whitespace-nowrap">{d.deployedBy?.split('@')[0] || '—'}</span>
                  <span className="text-xs font-bold px-2.5 py-1 rounded-full w-fit" style={{ background: statusBg, color: statusColor }}>{statusLabel}</span>
                  <span className="text-sm font-semibold text-slate-900">{d.costEstimate ? `$${d.costEstimate.toFixed(2)}` : '—'}</span>
                </div>

                {/* Failed banner — desktop only (mobile handled inline above) */}
                {d.status === 'failed' && (
                  <div className="hidden sm:flex mx-7 mb-2 px-3.5 py-2.5 bg-red-50 rounded-lg border border-red-100 items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <XCircle size={13} className="text-red-600 shrink-0" />
                      <span className="text-xs text-red-800 font-medium">Deployment failed · Check logs and consider rolling back to previous version</span>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <a href={`/deployments/${d.id}/logs`} className="text-xs font-bold text-red-600 no-underline bg-white border border-red-200 px-2.5 py-1 rounded-lg">View Logs</a>
                      <a href={`/deployments/${d.id}/rollback`} className="text-xs font-bold text-red-600 no-underline bg-white border border-red-200 px-2.5 py-1 rounded-lg">Rollback</a>
                    </div>
                  </div>
                )}
              </div>
            )
          })
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
                <h2 className="text-lg font-bold text-slate-900 mb-1">New Deployment</h2>
                <p className="text-xs text-slate-500 m-0">Deploy a service to an environment</p>
              </div>
              <button onClick={() => setShowModal(false)} className="bg-transparent border-none cursor-pointer text-slate-400 hover:text-slate-600 p-1 transition-colors">
                <X size={18} />
              </button>
            </div>

            {modalSuccess ? (
              <div className="p-4 bg-green-50 rounded-xl border border-green-200 text-center">
                <p className="text-sm font-semibold text-green-600 m-0">{modalSuccess}</p>
              </div>
            ) : (
              <form onSubmit={handleNewDeploymentSubmit} className="flex flex-col gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">Service Name</label>
                  <input
                    type="text"
                    value={modalForm.serviceName}
                    onChange={e => setModalForm(f => ({ ...f, serviceName: e.target.value }))}
                    placeholder="e.g. api-gateway, auth-service"
                    className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm text-slate-900 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/15 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">Environment</label>
                  <select
                    value={modalForm.environment}
                    onChange={e => setModalForm(f => ({ ...f, environment: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm text-slate-900 bg-white outline-none focus:border-violet-500 transition-all"
                  >
                    <option value="production">Production</option>
                    <option value="staging">Staging</option>
                    <option value="development">Development</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">Region</label>
                  <select
                    value={modalForm.region}
                    onChange={e => setModalForm(f => ({ ...f, region: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm text-slate-900 bg-white outline-none focus:border-violet-500 transition-all"
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
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Version <span className="font-normal text-slate-400">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={modalForm.version}
                    onChange={e => setModalForm(f => ({ ...f, version: e.target.value }))}
                    placeholder="e.g. v2.4.1, main@a1b2c3d"
                    className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm text-slate-900 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/15 transition-all"
                  />
                </div>
                {modalError && (
                  <div className="px-3.5 py-2.5 bg-red-50 rounded-lg border border-red-100">
                    <p className="text-xs text-red-600 m-0">{modalError}</p>
                  </div>
                )}
                <div className="flex gap-3 justify-end pt-1">
                  <button type="button" onClick={() => setShowModal(false)}
                    className="px-5 py-2.5 rounded-lg border border-slate-200 bg-white text-slate-600 text-sm font-medium cursor-pointer hover:bg-slate-50 transition-colors">
                    Cancel
                  </button>
                  <button type="submit" disabled={modalSubmitting}
                    className={`px-5 py-2.5 rounded-lg text-white text-sm font-semibold border-none inline-flex items-center gap-2 transition-colors ${modalSubmitting ? 'bg-violet-400 cursor-default' : 'bg-violet-600 hover:bg-violet-700 cursor-pointer'}`}>
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