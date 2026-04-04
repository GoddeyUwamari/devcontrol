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
import {
  Rocket, RefreshCw, ArrowRight, Sparkles, XCircle, X, AlertTriangle,
} from 'lucide-react'

type EnvironmentFilter = 'all' | DeploymentEnvironment

// Module-level constants avoid impure Date.now() calls during render
const _now = Date.now()

const DEMO_DEPLOYMENTS: Deployment[] = [
  { id: 'd1', serviceId: 'svc-1', serviceName: 'api-gateway',         environment: 'production', awsRegion: 'us-east-1', status: 'running',   costEstimate: 245.50, deployedBy: 'sarah.chen@company.com',   deployedAt: new Date(_now - 1000 * 60 * 45).toISOString(),          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'd2', serviceId: 'svc-2', serviceName: 'auth-service',         environment: 'production', awsRegion: 'us-east-1', status: 'running',   costEstimate: 178.00, deployedBy: 'mike.johnson@company.com', deployedAt: new Date(_now - 1000 * 60 * 120).toISOString(),         createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'd3', serviceId: 'svc-3', serviceName: 'payment-processor',    environment: 'staging',    awsRegion: 'us-west-2', status: 'deploying', costEstimate: 89.50,  deployedBy: 'alex.wong@company.com',    deployedAt: new Date(_now - 1000 * 60 * 5).toISOString(),           createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'd4', serviceId: 'svc-4', serviceName: 'notification-service', environment: 'production', awsRegion: 'eu-west-1', status: 'running',   costEstimate: 156.30, deployedBy: 'emma.davis@company.com',   deployedAt: new Date(_now - 1000 * 60 * 60 * 6).toISOString(),      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'd5', serviceId: 'svc-5', serviceName: 'analytics-worker',     environment: 'production', awsRegion: 'us-east-1', status: 'running',   costEstimate: 312.80, deployedBy: 'david.kim@company.com',    deployedAt: new Date(_now - 1000 * 60 * 60 * 24).toISOString(),     createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'd6', serviceId: 'svc-2', serviceName: 'auth-service',         environment: 'staging',    awsRegion: 'us-east-1', status: 'failed',    costEstimate: 45.00,  deployedBy: 'mike.johnson@company.com', deployedAt: new Date(_now - 1000 * 60 * 60 * 30).toISOString(),     createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'd7', serviceId: 'svc-1', serviceName: 'api-gateway',         environment: 'production', awsRegion: 'us-east-1', status: 'running',   costEstimate: 238.00, deployedBy: 'sarah.chen@company.com',   deployedAt: new Date(_now - 1000 * 60 * 60 * 48).toISOString(),     createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'd8', serviceId: 'svc-5', serviceName: 'analytics-worker',     environment: 'production', awsRegion: 'us-east-1', status: 'stopped',   costEstimate: 0,      deployedBy: 'david.kim@company.com',    deployedAt: new Date(_now - 1000 * 60 * 60 * 72).toISOString(),     createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
]

const DEMO_DORA = {
  frequency:    '12/week',  frequencyTier: 'Elite',
  leadTime:     '2.4 hours', leadTimeTier: 'Elite',
  cfr:          '3.2%',     cfrTier:      'Elite',
  mttr:         '36 min',   mttrTier:     'Elite',
}

export default function DeploymentsPage() {
  return (
    <Suspense fallback={<div style={{ padding: '48px', textAlign: 'center', color: '#6b7280' }}>Loading...</div>}>
      <DeploymentsContent />
    </Suspense>
  )
}

function DeploymentsContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { socket } = useWebSocket()
  const queryClient = useQueryClient()

  // Initialize from URL params
  const [environmentFilter, setEnvironmentFilter] = useState<EnvironmentFilter>(
    (searchParams.get('environment') as EnvironmentFilter) || 'all'
  )

  // Sync URL params to state
  useEffect(() => {
    const urlEnv = searchParams.get('environment') as EnvironmentFilter
    if (urlEnv && urlEnv !== environmentFilter) {
      setEnvironmentFilter(urlEnv)
    }
  }, [searchParams])

  // Update URL when filter changes
  const handleFilterChange = (filter: EnvironmentFilter) => {
    setEnvironmentFilter(filter)

    const params = new URLSearchParams(searchParams.toString())
    if (filter === 'all') {
      params.delete('environment')
    } else {
      params.set('environment', filter)
    }

    const queryString = params.toString()
    router.push(`/deployments${queryString ? `?${queryString}` : ''}`)
  }

  const { data: deployments = [], isLoading, error, refetch } = useQuery({
    queryKey: ['deployments', environmentFilter],
    queryFn: () => deploymentsService.getAll(
      environmentFilter !== 'all' ? { environment: environmentFilter } : undefined
    ),
  })

  // WebSocket event listeners for real-time updates
  useEffect(() => {
    if (!socket) return

    console.log('📡 Deployments: Setting up WebSocket listeners...')

    socket.on('deployment:started', () => {
      console.log('🚀 Deployment started - refreshing list')
      queryClient.invalidateQueries({ queryKey: ['deployments'] })
    })

    socket.on('deployment:status', () => {
      console.log('🔄 Deployment status changed - refreshing list')
      queryClient.invalidateQueries({ queryKey: ['deployments'] })
    })

    socket.on('deployment:completed', () => {
      console.log('✅ Deployment completed - refreshing list')
      queryClient.invalidateQueries({ queryKey: ['deployments'] })
    })

    return () => {
      console.log('🧹 Deployments: Cleaning up WebSocket listeners...')
      socket.off('deployment:started')
      socket.off('deployment:status')
      socket.off('deployment:completed')
    }
  }, [socket, queryClient])

  const demoMode = useDemoMode()
  const salesDemoMode = useSalesDemo((state) => state.enabled)
  const isDemoActive = demoMode || salesDemoMode
  const { tier } = usePlan()

  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false)

  // ─── Monthly usage stats ──────────────────────────────────────────────────
  const { data: deploymentStats } = useQuery({
    queryKey: ['deployment-stats'],
    queryFn: () => deploymentsService.getStats(),
    enabled: !isDemoActive,
  })

  // ─── Handle react-query list error (including 402) ────────────────────────
  useEffect(() => {
    if (error) {
      if ((error as any).response?.status === 402) {
        setShowUpgradePrompt(true)
      }
    }
  }, [error])

  // ─── New Deployment modal state ───────────────────────────────────────────
  const [showModal, setShowModal] = useState(false)
  const [modalForm, setModalForm] = useState({ serviceName: '', environment: 'production', region: 'us-east-1', version: '' })
  const [modalSubmitting, setModalSubmitting] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)
  const [modalSuccess, setModalSuccess] = useState<string | null>(null)

  const handleNewDeploymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!modalForm.serviceName.trim()) { setModalError('Service name is required'); return }
    setModalSubmitting(true)
    setModalError(null)
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
      if (err.response?.status === 402) {
        setShowModal(false)
        setShowUpgradePrompt(true)
      } else {
        setModalError(err.message || 'Failed to create deployment')
      }
    } finally {
      setModalSubmitting(false)
    }
  }

  const displayDeployments = isDemoActive ? DEMO_DEPLOYMENTS : deployments

  const filteredDeployments = displayDeployments.filter((d: Deployment) =>
    !environmentFilter || environmentFilter === 'all' || d.environment === environmentFilter
  )

  // KPI derived values
  const totalDeployments = filteredDeployments.length
  const successCount = filteredDeployments.filter((d: Deployment) => d.status === 'running').length
  const failedCount = filteredDeployments.filter((d: Deployment) => d.status === 'failed').length
  const deployingCount = filteredDeployments.filter((d: Deployment) => d.status === 'deploying').length
  const successRate = totalDeployments > 0 ? Math.round((successCount / totalDeployments) * 100) : 0
  const totalCost = filteredDeployments.reduce((sum: number, d: Deployment) => sum + (d.costEstimate || 0), 0)

  // Demo overrides for success rate KPI
  const displaySuccessRate = isDemoActive ? 94 : (totalDeployments > 0 ? successRate : null)
  const displayRunning     = isDemoActive ? 7  : successCount

  return (
    <div style={{
      padding: '40px 56px 64px',
      maxWidth: '1320px',
      margin: '0 auto',
      minHeight: '100vh',
      background: '#F9FAFB',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>

      {/* PAGE HEADER */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '32px' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#0F172A', margin: '0 0 6px', letterSpacing: '-0.02em' }}>
            Deployment History
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>
            Track all service deployments across environments · Real-time status
            {!isDemoActive && deploymentStats && (
              <span style={{ marginLeft: '8px', fontSize: '0.78rem', color: '#94A3B8' }}>
                · {deploymentStats.deployments_this_month} deployment{deploymentStats.deployments_this_month !== 1 ? 's' : ''} this month
              </span>
            )}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={() => refetch()}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#fff', color: '#475569', padding: '10px 20px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 500, border: '1px solid #E2E8F0', cursor: 'pointer' }}>
            <RefreshCw size={15} /> Refresh
          </button>
          <button
            onClick={() => { setShowModal(true); setModalError(null); setModalSuccess(null) }}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#7C3AED', color: '#fff', padding: '10px 20px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600, border: 'none', cursor: 'pointer' }}>
            <Rocket size={15} /> New Deployment
          </button>
        </div>
      </div>

      {/* Tier limit upgrade prompt */}
      {showUpgradePrompt && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: '#FEF3C7', border: '1px solid #F59E0B', borderRadius: '10px',
          padding: '14px 20px', marginBottom: '24px', gap: '16px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '1.1rem' }}>⚠️</span>
            <span style={{ fontSize: '0.875rem', fontWeight: 500, color: '#92400E' }}>
              You've reached your monthly deployment limit on the <strong>{tier}</strong> plan. Upgrade to continue deploying.
            </span>
          </div>
          <a
            href="/settings/billing/upgrade"
            style={{
              flexShrink: 0, fontSize: '0.8125rem', fontWeight: 600,
              color: '#fff', background: '#D97706', borderRadius: '6px',
              padding: '7px 16px', textDecoration: 'none', whiteSpace: 'nowrap',
            }}
          >
            Upgrade plan
          </a>
        </div>
      )}

      {/* Generic error banner (non-402 failures) */}
      {!isDemoActive && error && !showUpgradePrompt && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '10px',
          padding: '14px 20px', marginBottom: '24px',
        }}>
          <AlertTriangle size={16} style={{ color: '#DC2626', flexShrink: 0 }} />
          <span style={{ fontSize: '0.875rem', color: '#991B1B' }}>
            Failed to load deployments — check your connection and try again.
          </span>
          <button
            onClick={() => refetch()}
            style={{ marginLeft: 'auto', fontSize: '0.8125rem', fontWeight: 600, color: '#DC2626', background: 'none', border: '1px solid #FECACA', borderRadius: '6px', padding: '5px 12px', cursor: 'pointer', flexShrink: 0 }}
          >
            Retry
          </button>
        </div>
      )}

      {/* AI INSIGHT BANNER */}
      <div style={{ background: '#fff', borderRadius: '12px', padding: '16px 24px', border: '1px solid #F1F5F9', marginBottom: '24px', display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
        <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#7C3AED', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Sparkles size={14} style={{ color: '#fff' }} />
        </div>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#7C3AED', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 4px' }}>AI Insight</p>
          <p style={{ fontSize: '0.875rem', color: '#1E293B', margin: 0, lineHeight: 1.6 }}>
            {isDemoActive
              ? 'Deployment frequency is Elite tier at 12/week. All 4 DORA metrics are Elite tier — top 10% of engineering teams. payment-processor has a deploying status in staging — monitor for completion.'
              : totalDeployments === 0
                ? 'No deployments found. Connect your CI/CD pipeline to start tracking deployment history automatically.'
                : `${successCount} of ${totalDeployments} deployments are running successfully with ${successRate}% success rate. ${failedCount > 0 ? `${failedCount} failed deployment${failedCount > 1 ? 's' : ''} require attention.` : 'No failed deployments detected.'}`
            }
          </p>
        </div>
        {failedCount > 0 && (
          <a href="/anomalies" style={{ fontSize: '0.78rem', fontWeight: 600, color: '#7C3AED', textDecoration: 'none', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
            Investigate <ArrowRight size={12} />
          </a>
        )}
      </div>

      {/* 4 KPI CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', marginBottom: '28px' }}>
        {[
          { label: 'Total Deployments', value: totalDeployments,                       sub: 'In selected filter',      valueColor: '#0F172A' },
          {
            label: 'Success Rate',
            value: displaySuccessRate !== null ? `${displaySuccessRate}%` : '—',
            sub: `${displayRunning} running`,
            valueColor: displaySuccessRate === null ? '#0F172A' : displaySuccessRate >= 90 ? '#059669' : displaySuccessRate >= 70 ? '#D97706' : '#DC2626',
          },
          { label: 'Active Now',        value: deployingCount,                         sub: 'Currently deploying',     valueColor: deployingCount > 0 ? '#D97706' : '#059669' },
          { label: 'Est. Cost',         value: `$${Math.round(totalCost).toLocaleString()}`, sub: 'Total cost estimate', valueColor: '#0F172A' },
        ].map(({ label, value, sub, valueColor }) => (
          <div key={label} style={{ background: '#fff', borderRadius: '14px', padding: '32px', border: '1px solid #E2E8F0' }}>
            <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 16px' }}>{label}</p>
            <div style={{ fontSize: '2.5rem', fontWeight: 700, color: valueColor, letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '8px' }}>{value}</div>
            <p style={{ fontSize: '0.78rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>{sub}</p>
          </div>
        ))}
      </div>

      {/* DORA METRICS — gated by isDemoActive */}
      {isDemoActive ? (
        <div style={{ background: '#fff', borderRadius: '16px', padding: '28px 32px', border: '1px solid #F1F5F9', marginBottom: '28px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
            <div>
              <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 2px' }}>DORA Metrics</p>
              <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: 0 }}>
                Engineering Velocity —{' '}
                <span style={{ color: '#059669' }}>Elite Tier</span>
                <span style={{ fontSize: '0.72rem', fontWeight: 600, background: '#ECFDF5', color: '#059669', padding: '2px 8px', borderRadius: '100px', marginLeft: '8px' }}>Top 10%</span>
              </p>
            </div>
            <a href="/dora-metrics" style={{ fontSize: '0.78rem', fontWeight: 600, color: '#7C3AED', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}>
              Full report <ArrowRight size={12} />
            </a>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px' }}>
            {[
              { label: 'Deployment Frequency', value: DEMO_DORA.frequency, tier: DEMO_DORA.frequencyTier },
              { label: 'Lead Time for Changes', value: DEMO_DORA.leadTime,  tier: DEMO_DORA.leadTimeTier  },
              { label: 'Change Failure Rate',   value: DEMO_DORA.cfr,       tier: DEMO_DORA.cfrTier       },
              { label: 'Mean Time to Recovery', value: DEMO_DORA.mttr,      tier: DEMO_DORA.mttrTier      },
            ].map(({ label, value, tier }) => (
              <div key={label} style={{ padding: '16px 20px', background: '#F8FAFC', borderRadius: '10px', border: '1px solid #F1F5F9' }}>
                <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 10px' }}>{label}</p>
                <p style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.02em', margin: '0 0 6px' }}>{value}</p>
                <span style={{
                  fontSize: '0.68rem', fontWeight: 700, padding: '2px 8px', borderRadius: '100px',
                  background: tier === 'Elite' ? '#ECFDF5' : tier === 'High' ? '#FFFBEB' : '#FEF2F2',
                  color:      tier === 'Elite' ? '#059669' : tier === 'High' ? '#D97706' : '#DC2626',
                }}>{tier}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ background: '#fff', borderRadius: '16px', padding: '28px 32px', border: '1px solid #F1F5F9', marginBottom: '28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px' }}>DORA Metrics</p>
            <p style={{ fontSize: '0.875rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>
              Connect your CI/CD pipeline to unlock deployment frequency, lead time, and reliability metrics.
            </p>
          </div>
          <a href="/dora-metrics" style={{ fontSize: '0.82rem', fontWeight: 600, color: '#7C3AED', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
            Learn more <ArrowRight size={13} />
          </a>
        </div>
      )}

      {/* DEPLOYMENT TABLE */}
      <div style={{ background: '#fff', borderRadius: '16px', border: '1px solid #F1F5F9', overflow: 'hidden' }}>
        {/* Table header + filters */}
        <div style={{ padding: '20px 28px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 2px' }}>Deployment Log</p>
            <p style={{ fontSize: '0.78rem', color: '#94A3B8', margin: 0 }}>{filteredDeployments.length} deployments</p>
          </div>
          {/* Environment filter */}
          <div style={{ display: 'flex', background: '#F8FAFC', borderRadius: '8px', padding: '4px', gap: '2px' }}>
            {(['all', 'production', 'staging', 'development'] as const).map(env => (
              <button
                key={env}
                onClick={() => handleFilterChange(env as EnvironmentFilter)}
                style={{
                  padding: '5px 14px', borderRadius: '6px', fontSize: '0.78rem', fontWeight: 600,
                  border: 'none', cursor: 'pointer', textTransform: 'capitalize',
                  background: (environmentFilter === env) || (!environmentFilter && env === 'all') ? '#fff' : 'transparent',
                  color:      (environmentFilter === env) || (!environmentFilter && env === 'all') ? '#0F172A' : '#64748B',
                  boxShadow:  (environmentFilter === env) || (!environmentFilter && env === 'all') ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                }}>
                {env === 'all' ? 'All' : env}
              </button>
            ))}
          </div>
        </div>

        {/* Column headers */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 130px 130px 160px 120px 100px', padding: '10px 28px', background: '#F8FAFC', borderBottom: '1px solid #F1F5F9' }}>
          {['Service', 'Environment', 'Region', 'Deployed By', 'Status', 'Cost'].map(col => (
            <span key={col} style={{ fontSize: '0.7rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{col}</span>
          ))}
        </div>

        {/* Rows */}
        {isLoading && !isDemoActive ? (
          <div style={{ padding: '48px', textAlign: 'center' }}>
            <RefreshCw size={20} style={{ color: '#94A3B8', margin: '0 auto 12px' }} />
            <p style={{ fontSize: '0.875rem', color: '#64748B', margin: 0 }}>Loading deployments...</p>
          </div>
        ) : filteredDeployments.length === 0 ? (
          <div style={{ padding: '64px', textAlign: 'center' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#F8FAFC', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <Rocket size={22} style={{ color: '#94A3B8' }} />
            </div>
            <p style={{ fontSize: '1rem', fontWeight: 600, color: '#0F172A', margin: '0 0 6px' }}>No deployments found</p>
            <p style={{ fontSize: '0.875rem', color: '#475569', margin: '0 0 24px', lineHeight: 1.6 }}>
              Connect your CI/CD pipeline to start tracking deployments automatically.
            </p>
            <button
              onClick={() => { setShowModal(true); setModalError(null); setModalSuccess(null) }}
              style={{ background: '#7C3AED', color: '#fff', padding: '10px 24px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600, border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
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
              <div key={d.id}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '2fr 130px 130px 160px 120px 100px',
                    padding: '14px 28px',
                    borderBottom: idx < filteredDeployments.length - 1 || d.status === 'failed' ? '1px solid #F8FAFC' : 'none',
                    alignItems: 'center',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = '#F8FAFC' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
                >
                  {/* Service */}
                  <div>
                    <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>
                      {d.serviceName || d.serviceId.slice(0, 8)}
                    </p>
                    <p style={{ fontSize: '0.72rem', color: '#94A3B8', margin: 0 }}>
                      {new Date(d.deployedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      {d.deployedBy && ` · ${d.deployedBy.split('@')[0]}`}
                    </p>
                  </div>

                  {/* Environment */}
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, padding: '3px 10px', borderRadius: '100px', background: envBg, color: envColor, width: 'fit-content' }}>
                    {d.environment}
                  </span>

                  {/* Region */}
                  <span style={{ fontSize: '0.78rem', color: '#475569', fontFamily: 'monospace' }}>
                    {d.awsRegion || '—'}
                  </span>

                  {/* Deployed by */}
                  <span style={{ fontSize: '0.78rem', color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {d.deployedBy?.split('@')[0] || '—'}
                  </span>

                  {/* Status */}
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, padding: '3px 10px', borderRadius: '100px', background: statusBg, color: statusColor, width: 'fit-content' }}>
                    {statusLabel}
                  </span>

                  {/* Cost */}
                  <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A' }}>
                    {d.costEstimate ? `$${d.costEstimate.toFixed(2)}` : '—'}
                  </span>
                </div>

                {/* Failed deployment Fix-It banner */}
                {d.status === 'failed' && (
                  <div style={{ margin: '0 28px 8px', padding: '10px 14px', background: '#FEF2F2', borderRadius: '8px', border: '1px solid #FEE2E2', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <XCircle size={13} style={{ color: '#DC2626' }} />
                      <span style={{ fontSize: '0.78rem', color: '#991B1B', fontWeight: 500 }}>
                        Deployment failed · Check logs and consider rolling back to previous version
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                      <a href={`/deployments/${d.id}/logs`} style={{ fontSize: '0.72rem', fontWeight: 700, color: '#DC2626', textDecoration: 'none', background: '#fff', border: '1px solid #FEE2E2', padding: '3px 10px', borderRadius: '6px' }}>
                        View Logs
                      </a>
                      <a href={`/deployments/${d.id}/rollback`} style={{ fontSize: '0.72rem', fontWeight: 700, color: '#DC2626', textDecoration: 'none', background: '#fff', border: '1px solid #FEE2E2', padding: '3px 10px', borderRadius: '6px' }}>
                        Rollback
                      </a>
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* ─── NEW DEPLOYMENT MODAL ─────────────────────────────────────────── */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={e => { if (e.target === e.currentTarget) setShowModal(false) }}>
          <div style={{ background: '#fff', borderRadius: '16px', padding: '32px', width: '480px', maxWidth: '90vw', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
              <div>
                <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0F172A', margin: '0 0 4px' }}>New Deployment</h2>
                <p style={{ fontSize: '0.8rem', color: '#64748B', margin: 0 }}>Deploy a service to an environment</p>
              </div>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: '4px' }}>
                <X size={18} />
              </button>
            </div>

            {/* Success state */}
            {modalSuccess ? (
              <div style={{ padding: '16px', background: '#F0FDF4', borderRadius: '10px', border: '1px solid #BBF7D0', textAlign: 'center' }}>
                <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#059669', margin: 0 }}>{modalSuccess}</p>
              </div>
            ) : (
              <form onSubmit={handleNewDeploymentSubmit}>
                {/* Service Name */}
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>Service Name</label>
                  <input
                    type="text"
                    value={modalForm.serviceName}
                    onChange={e => setModalForm(f => ({ ...f, serviceName: e.target.value }))}
                    placeholder="e.g. api-gateway, auth-service"
                    style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #E2E8F0', fontSize: '0.875rem', color: '#0F172A', outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>

                {/* Environment */}
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>Environment</label>
                  <select
                    value={modalForm.environment}
                    onChange={e => setModalForm(f => ({ ...f, environment: e.target.value }))}
                    style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #E2E8F0', fontSize: '0.875rem', color: '#0F172A', background: '#fff', outline: 'none', boxSizing: 'border-box' }}>
                    <option value="production">Production</option>
                    <option value="staging">Staging</option>
                    <option value="development">Development</option>
                  </select>
                </div>

                {/* Region */}
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>Region</label>
                  <select
                    value={modalForm.region}
                    onChange={e => setModalForm(f => ({ ...f, region: e.target.value }))}
                    style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #E2E8F0', fontSize: '0.875rem', color: '#0F172A', background: '#fff', outline: 'none', boxSizing: 'border-box' }}>
                    <option value="us-east-1">us-east-1 (N. Virginia)</option>
                    <option value="us-west-2">us-west-2 (Oregon)</option>
                    <option value="eu-west-1">eu-west-1 (Ireland)</option>
                    <option value="eu-central-1">eu-central-1 (Frankfurt)</option>
                    <option value="ap-southeast-1">ap-southeast-1 (Singapore)</option>
                    <option value="ap-northeast-1">ap-northeast-1 (Tokyo)</option>
                  </select>
                </div>

                {/* Version */}
                <div style={{ marginBottom: '24px' }}>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>Version <span style={{ fontWeight: 400, color: '#94A3B8' }}>(optional)</span></label>
                  <input
                    type="text"
                    value={modalForm.version}
                    onChange={e => setModalForm(f => ({ ...f, version: e.target.value }))}
                    placeholder="e.g. v2.4.1, main@a1b2c3d"
                    style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1px solid #E2E8F0', fontSize: '0.875rem', color: '#0F172A', outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>

                {/* Error */}
                {modalError && (
                  <div style={{ marginBottom: '16px', padding: '10px 14px', background: '#FEF2F2', borderRadius: '8px', border: '1px solid #FEE2E2' }}>
                    <p style={{ fontSize: '0.8rem', color: '#DC2626', margin: 0 }}>{modalError}</p>
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                  <button type="button" onClick={() => setShowModal(false)}
                    style={{ padding: '9px 20px', borderRadius: '8px', border: '1px solid #E2E8F0', background: '#fff', color: '#475569', fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer' }}>
                    Cancel
                  </button>
                  <button type="submit" disabled={modalSubmitting}
                    style={{ padding: '9px 20px', borderRadius: '8px', background: modalSubmitting ? '#A78BFA' : '#7C3AED', color: '#fff', fontSize: '0.875rem', fontWeight: 600, border: 'none', cursor: modalSubmitting ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {modalSubmitting ? <><RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} /> Deploying...</> : <><Rocket size={13} /> Deploy</>}
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
