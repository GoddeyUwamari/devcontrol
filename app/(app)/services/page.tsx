'use client'

import { useState } from 'react'
import { Plus, Rocket, GitBranch, Activity, ArrowRight, Layers, RefreshCw, Sparkles, Check, Scan, AlertTriangle } from 'lucide-react'
import { useDemoMode } from '@/components/demo/demo-mode-toggle'
import { useSalesDemo } from '@/lib/demo/sales-demo-data'

const _now = Date.now()

const DEMO_SERVICES = [
  { id: '1', name: 'api-gateway',         environment: 'production', region: 'us-east-1', status: 'healthy', deployments: 12, uptime: 99.9, lastDeployed: new Date(_now - 1000 * 60 * 45),          template: 'ECS',    owner: 'sarah.chen',   teamId: 'Platform Team',  githubUrl: 'https://github.com/wayup/api-gateway' },
  { id: '2', name: 'auth-service',         environment: 'production', region: 'us-east-1', status: 'healthy', deployments: 8,  uptime: 99.7, lastDeployed: new Date(_now - 1000 * 60 * 120),         template: 'ECS',    owner: 'mike.johnson', teamId: 'Auth Team',      githubUrl: 'https://github.com/wayup/auth-service' },
  { id: '3', name: 'payment-processor',    environment: 'staging',    region: 'us-west-2', status: 'warning', deployments: 5,  uptime: 98.2, lastDeployed: new Date(_now - 1000 * 60 * 5),            template: 'Lambda', owner: 'alex.wong',    teamId: 'Payments Team',  githubUrl: 'https://github.com/wayup/payment-processor' },
  { id: '4', name: 'notification-service', environment: 'production', region: 'us-east-1', status: 'healthy', deployments: 15, uptime: 99.9, lastDeployed: new Date(_now - 1000 * 60 * 60 * 6),       template: 'Lambda', owner: 'emma.davis',   teamId: 'Platform Team',  githubUrl: 'https://github.com/wayup/notification-service' },
  { id: '5', name: 'analytics-worker',     environment: 'production', region: 'eu-west-1', status: 'healthy', deployments: 3,  uptime: 99.5, lastDeployed: new Date(_now - 1000 * 60 * 60 * 24),      template: 'EC2',    owner: 'david.kim',    teamId: 'Data Team',      githubUrl: 'https://github.com/wayup/analytics-worker' },
]

export default function ServicesPage() {
  const [envFilter, setEnvFilter] = useState<string>('all')
  const [templateFilter, setTemplateFilter] = useState<string>('all')
  const [isDiscovering, setIsDiscovering] = useState(false)
  const [discoveryComplete, setDiscoveryComplete] = useState(false)

  const handleAutoDiscover = async () => {
    setIsDiscovering(true)
    setDiscoveryComplete(false)
    await new Promise(r => setTimeout(r, 2500))
    setIsDiscovering(false)
    setDiscoveryComplete(true)
    setTimeout(() => setDiscoveryComplete(false), 4000)
  }

  const templateTypes = ['all', 'ECS', 'Lambda', 'EC2', 'RDS', 'Kubernetes']

  const demoMode = useDemoMode()
  const salesDemoMode = useSalesDemo((state) => state.enabled)
  const isDemoActive = demoMode || salesDemoMode

  const allServices = isDemoActive ? DEMO_SERVICES : []
  const displayServices = allServices

  const filteredServices = displayServices.filter((s: any) => {
    const matchesEnv = !envFilter || envFilter === 'all' || s.environment === envFilter
    const matchesTemplate = templateFilter === 'all' || s.template === templateFilter
    return matchesEnv && matchesTemplate
  })

  const totalServices = allServices.length
  const healthyCount = allServices.filter((s: any) => s.status === 'healthy').length
  const warningCount = allServices.filter((s: any) => s.status === 'warning' || s.status === 'critical').length
  const avgUptime = allServices.length > 0
    ? (allServices.reduce((sum: number, s: any) => sum + (s.uptime || 0), 0) / allServices.length).toFixed(1)
    : '—'

  const isLoading = false

  return (
    <div style={{
      padding: '40px 56px 64px',
      maxWidth: '1320px',
      margin: '0 auto',
      minHeight: '100vh',
      background: '#F9FAFB',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {/* PAGE HEADER */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '32px' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#0F172A', margin: '0 0 6px', letterSpacing: '-0.02em' }}>
            Application Services
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>
            Manage and monitor all services, deployments, and dependencies
          </p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={handleAutoDiscover}
            disabled={isDiscovering}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              background: discoveryComplete ? '#059669' : '#fff',
              color: discoveryComplete ? '#fff' : '#475569',
              padding: '10px 20px', borderRadius: '8px',
              fontSize: '0.875rem', fontWeight: 600,
              border: `1px solid ${discoveryComplete ? '#059669' : '#E2E8F0'}`,
              cursor: isDiscovering ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s',
            }}>
            {isDiscovering
              ? <><RefreshCw size={15} style={{ animation: 'spin 1s linear infinite' }} /> Scanning AWS...</>
              : discoveryComplete
                ? <><Check size={15} /> Discovery Complete</>
                : <><Scan size={15} /> Auto Discover</>
            }
          </button>
          <a href="/services/new" style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#7C3AED', color: '#fff', padding: '10px 20px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600, textDecoration: 'none' }}>
            <Plus size={15} /> Add Service
          </a>
        </div>
      </div>

      {/* 4 KPI CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', marginBottom: '28px' }}>
        {[
          { label: 'Total Services',  value: totalServices,    sub: 'Registered',          valueColor: '#0F172A' },
          { label: 'Healthy',         value: healthyCount,     sub: 'Operating normally',   valueColor: '#059669' },
          { label: 'Needs Attention', value: warningCount,     sub: 'Warning or critical',  valueColor: warningCount > 0 ? '#D97706' : '#059669' },
          { label: 'Avg Uptime',      value: `${avgUptime}%`,  sub: 'Across all services',  valueColor: '#0F172A' },
        ].map(({ label, value, sub, valueColor }) => (
          <div key={label} style={{ background: '#fff', borderRadius: '14px', padding: '32px', border: '1px solid #E2E8F0' }}>
            <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 16px' }}>{label}</p>
            <div style={{ fontSize: '2.5rem', fontWeight: 700, color: valueColor, letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '8px' }}>{value}</div>
            <p style={{ fontSize: '0.78rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>{sub}</p>
          </div>
        ))}
      </div>

      {/* AI Insight Banner */}
      <div style={{ background: '#fff', borderRadius: '12px', padding: '16px 24px', border: '1px solid #F1F5F9', marginBottom: '20px', display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
        <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#7C3AED', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Sparkles size={14} style={{ color: '#fff' }} />
        </div>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#7C3AED', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 4px' }}>AI Insight</p>
          <p style={{ fontSize: '0.875rem', color: '#1E293B', margin: 0, lineHeight: 1.6 }}>
            {isDemoActive
              ? `${warningCount} service${warningCount !== 1 ? 's' : ''} need${warningCount === 1 ? 's' : ''} attention. payment-processor has a Lambda invocation spike (+178%) — this is likely driving the $864 cost increase detected this month. Recommend investigating retry logic.`
              : totalServices === 0
                ? 'No services detected. Connect your AWS account and run Auto Discover to automatically find ECS, Lambda, EC2, and RDS services.'
                : `${healthyCount} of ${totalServices} services are healthy with ${avgUptime}% average uptime. ${warningCount > 0 ? `${warningCount} service${warningCount > 1 ? 's' : ''} require attention.` : 'No active issues detected.'}`
            }
          </p>
        </div>
        {warningCount > 0 && (
          <a href="/anomalies" style={{ fontSize: '0.78rem', fontWeight: 600, color: '#7C3AED', textDecoration: 'none', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
            Investigate <ArrowRight size={12} />
          </a>
        )}
      </div>

      {/* QUICK NAV */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px', marginBottom: '28px' }}>
        {[
          { icon: Rocket,    label: 'Deployments',  desc: 'Deployment history and tracking', href: '/deployments',  color: '#7C3AED', bg: '#F5F3FF' },
          { icon: GitBranch, label: 'Dependencies', desc: 'Service dependency map',          href: '/dependencies', color: '#059669', bg: '#F0FDF4' },
          { icon: Activity,  label: 'Status Page',  desc: 'Live system status',              href: '/status',       color: '#0EA5E9', bg: '#F0F9FF' },
        ].map(({ icon: Icon, label, desc, href, color, bg }) => (
          <a key={href} href={href} style={{ textDecoration: 'none' }}>
            <div
              style={{ background: '#fff', borderRadius: '12px', padding: '20px 24px', border: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', gap: '14px', transition: 'all 0.15s' }}
              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = color; (e.currentTarget as HTMLDivElement).style.boxShadow = `0 4px 16px ${color}18` }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#F1F5F9'; (e.currentTarget as HTMLDivElement).style.boxShadow = 'none' }}
            >
              <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon size={16} style={{ color }} />
              </div>
              <div>
                <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>{label}</p>
                <p style={{ fontSize: '0.75rem', color: '#475569', margin: 0 }}>{desc}</p>
              </div>
              <ArrowRight size={14} style={{ color: '#94A3B8', marginLeft: 'auto', flexShrink: 0 }} />
            </div>
          </a>
        ))}
      </div>

      {/* SERVICES TABLE */}
      <div style={{ background: '#fff', borderRadius: '16px', border: '1px solid #F1F5F9', overflow: 'hidden' }}>

        {/* Table header with dual filters */}
        <div style={{ padding: '20px 28px', borderBottom: '1px solid #F1F5F9' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
            <div>
              <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 2px' }}>All Services</p>
              <p style={{ fontSize: '0.78rem', color: '#94A3B8', margin: 0 }}>{filteredServices.length} of {totalServices} services</p>
            </div>
            {/* Environment filter */}
            <div style={{ display: 'flex', background: '#F8FAFC', borderRadius: '8px', padding: '4px', gap: '2px' }}>
              {['all', 'production', 'staging'].map(f => (
                <button key={f} onClick={() => setEnvFilter(f)}
                  style={{
                    padding: '5px 14px', borderRadius: '6px', fontSize: '0.78rem', fontWeight: 600,
                    border: 'none', cursor: 'pointer', textTransform: 'capitalize',
                    background: (envFilter === f || (!envFilter && f === 'all')) ? '#fff' : 'transparent',
                    color: (envFilter === f || (!envFilter && f === 'all')) ? '#0F172A' : '#64748B',
                    boxShadow: (envFilter === f || (!envFilter && f === 'all')) ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                  }}>
                  {f === 'all' ? 'All Envs' : f}
                </button>
              ))}
            </div>
          </div>

          {/* Template type filter */}
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {templateTypes.map(t => (
              <button key={t} onClick={() => setTemplateFilter(t)}
                style={{
                  padding: '4px 12px', borderRadius: '100px', fontSize: '0.75rem', fontWeight: 600,
                  border: 'none', cursor: 'pointer',
                  background: templateFilter === t ? '#7C3AED' : '#F1F5F9',
                  color: templateFilter === t ? '#fff' : '#475569',
                  transition: 'all 0.15s',
                }}>
                {t === 'all' ? 'All Types' : t}
              </button>
            ))}
          </div>
        </div>

        {/* Column headers */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 110px 130px 120px 130px 110px 100px 80px', padding: '10px 28px', background: '#F8FAFC', borderBottom: '1px solid #F1F5F9' }}>
          {['Service', 'Type', 'Environment', 'Region', 'Owner', 'Status', 'Uptime', ''].map(col => (
            <span key={col} style={{ fontSize: '0.7rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{col}</span>
          ))}
        </div>

        {/* Service rows */}
        {isLoading && !isDemoActive ? (
          <div style={{ padding: '48px', textAlign: 'center' }}>
            <RefreshCw size={20} style={{ color: '#94A3B8', margin: '0 auto 12px' }} />
            <p style={{ fontSize: '0.875rem', color: '#64748B', margin: 0 }}>Loading services...</p>
          </div>
        ) : filteredServices.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#F8FAFC', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <Layers size={22} style={{ color: '#94A3B8' }} />
            </div>
            <p style={{ fontSize: '1rem', fontWeight: 600, color: '#0F172A', margin: '0 0 6px' }}>Get started in 3 steps</p>
            <p style={{ fontSize: '0.875rem', color: '#475569', margin: '0 0 28px', lineHeight: 1.6 }}>
              Connect your AWS account to start monitoring services automatically.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', maxWidth: '600px', margin: '0 auto 28px', textAlign: 'left' }}>
              {[
                { step: '1', title: 'Connect AWS',       desc: 'Link your AWS account with read-only IAM permissions',     color: '#7C3AED' },
                { step: '2', title: 'Discover Services', desc: 'Auto-scan ECS, Lambda, EC2, and RDS resources',             color: '#059669' },
                { step: '3', title: 'Monitor & Act',     desc: 'Track deployments, health, and costs in real time',         color: '#0EA5E9' },
              ].map(({ step, title, desc, color }) => (
                <div key={step} style={{ padding: '16px', background: '#F8FAFC', borderRadius: '10px', border: '1px solid #F1F5F9' }}>
                  <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '10px' }}>
                    <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#fff' }}>{step}</span>
                  </div>
                  <p style={{ fontSize: '0.82rem', fontWeight: 600, color: '#0F172A', margin: '0 0 4px' }}>{title}</p>
                  <p style={{ fontSize: '0.75rem', color: '#475569', margin: 0, lineHeight: 1.5 }}>{desc}</p>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <button onClick={handleAutoDiscover} style={{ background: '#7C3AED', color: '#fff', padding: '10px 24px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600, border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                <Scan size={14} /> Auto Discover
              </button>
              <a href="/services/new" style={{ background: '#fff', color: '#475569', padding: '10px 24px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 500, border: '1px solid #E2E8F0', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                <Plus size={14} /> Add Manually
              </a>
            </div>
          </div>
        ) : (
          filteredServices.map((svc: any, idx: number) => {
            const isHealthy = svc.status === 'healthy'
            const isWarning = svc.status === 'warning'
            const statusColor = isHealthy ? '#059669' : isWarning ? '#D97706' : '#DC2626'
            const envColor    = svc.environment === 'production' ? '#059669' : svc.environment === 'staging' ? '#D97706' : '#64748B'
            const envBg       = svc.environment === 'production' ? '#F0FDF4' : svc.environment === 'staging' ? '#FFFBEB' : '#F8FAFC'
            const statusLabel = isHealthy ? 'Healthy' : isWarning ? 'Warning' : 'Critical'

            return (
              <div
                key={svc.id}
                style={{
                  padding: '16px 28px',
                  borderBottom: idx < filteredServices.length - 1 ? '1px solid #F8FAFC' : 'none',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = '#F8FAFC' }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
              >
                {/* Main row grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 110px 130px 120px 130px 110px 100px 80px', alignItems: 'center' }}>
                  {/* Service name */}
                  <div>
                    <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px', fontFamily: 'Inter, system-ui' }}>{svc.name}</p>
                    {svc.lastDeployed && (
                      <p style={{ fontSize: '0.72rem', color: '#94A3B8', margin: 0 }}>
                        Deployed {new Date(svc.lastDeployed).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    )}
                  </div>

                  {/* Template type */}
                  <span style={{
                    fontSize: '0.72rem', fontWeight: 700, padding: '3px 8px', borderRadius: '4px', width: 'fit-content',
                    background: svc.template === 'ECS' ? '#EFF6FF' : svc.template === 'Lambda' ? '#F5F3FF' : svc.template === 'EC2' ? '#F0FDF4' : svc.template === 'RDS' ? '#FFFBEB' : '#F8FAFC',
                    color:      svc.template === 'ECS' ? '#1D4ED8' : svc.template === 'Lambda' ? '#7C3AED'  : svc.template === 'EC2' ? '#059669'  : svc.template === 'RDS' ? '#D97706'  : '#64748B',
                  }}>
                    {svc.template || '—'}
                  </span>

                  {/* Environment */}
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, padding: '3px 10px', borderRadius: '100px', background: envBg, color: envColor, width: 'fit-content' }}>
                    {svc.environment}
                  </span>

                  {/* Region */}
                  <span style={{ fontSize: '0.82rem', color: '#475569', fontFamily: 'monospace' }}>{svc.region || '—'}</span>

                  {/* Owner */}
                  <div>
                    <p style={{ fontSize: '0.78rem', fontWeight: 500, color: '#1E293B', margin: '0 0 1px' }}>
                      {svc.owner?.split('@')[0] || svc.owner || '—'}
                    </p>
                    <p style={{ fontSize: '0.7rem', color: '#94A3B8', margin: 0 }}>
                      {svc.teamId || ''}
                    </p>
                  </div>

                  {/* Status */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
                    <span style={{ fontSize: '0.82rem', fontWeight: 600, color: statusColor }}>{statusLabel}</span>
                  </div>

                  {/* Uptime */}
                  <span style={{ fontSize: '0.875rem', fontWeight: 600, color: (svc.uptime ?? 0) >= 99 ? '#059669' : '#D97706' }}>
                    {svc.uptime ? `${svc.uptime}%` : '—'}
                  </span>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    {svc.githubUrl && (
                      <a href={svc.githubUrl} target="_blank" rel="noopener noreferrer"
                        style={{ color: '#94A3B8', display: 'flex', alignItems: 'center' }}
                        title="View repository">
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>
                      </a>
                    )}
                    <a href={`/services/${svc.id}`} style={{ fontSize: '0.78rem', fontWeight: 600, color: '#7C3AED', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      View <ArrowRight size={12} />
                    </a>
                  </div>
                </div>

                {/* Fix-It banner for warning/critical */}
                {(svc.status === 'warning' || svc.status === 'critical') && (
                  <div style={{ marginTop: '8px', padding: '10px 14px', background: '#FFFBEB', borderRadius: '8px', border: '1px solid #FDE68A', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <AlertTriangle size={13} style={{ color: '#D97706' }} />
                      <span style={{ fontSize: '0.78rem', color: '#92400E', fontWeight: 500 }}>
                        {isDemoActive
                          ? 'Lambda invocation spike detected (+178%). Possible retry loop or traffic surge.'
                          : `${svc.name} requires attention. Check recent deployments and anomalies.`}
                      </span>
                    </div>
                    <a href={`/anomalies?service=${svc.name}`}
                      style={{ fontSize: '0.75rem', fontWeight: 700, color: '#D97706', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0, background: '#fff', border: '1px solid #FDE68A', padding: '4px 10px', borderRadius: '6px' }}>
                      Investigate <ArrowRight size={11} />
                    </a>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

    </div>
  )
}
