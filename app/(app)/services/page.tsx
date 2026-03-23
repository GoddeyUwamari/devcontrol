'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, Rocket, GitBranch, Activity, ArrowRight, Layers, RefreshCw, Sparkles, Check, Scan, AlertTriangle } from 'lucide-react'
import { useDemoMode } from '@/components/demo/demo-mode-toggle'
import { useSalesDemo } from '@/lib/demo/sales-demo-data'
import awsServicesService, { AWSService, AWSServicesStats } from '@/lib/services/aws-services.service'
import awsAccountsService from '@/lib/services/aws-accounts.service'

const _now = Date.now()

const DEMO_SERVICES: AWSService[] = [
  { id: '1', name: 'api-gateway',         environment: 'production', region: 'us-east-1', status: 'healthy', type: 'ecs',     uptime: 99.9, lastDeployed: new Date(_now - 1000 * 60 * 45).toISOString(),          owner: 'sarah.chen',   team: 'Platform Team',  monthly_cost: null, metadata: {} } as any,
  { id: '2', name: 'auth-service',         environment: 'production', region: 'us-east-1', status: 'healthy', type: 'ecs',     uptime: 99.7, lastDeployed: new Date(_now - 1000 * 60 * 120).toISOString(),         owner: 'mike.johnson', team: 'Auth Team',      monthly_cost: null, metadata: {} } as any,
  { id: '3', name: 'payment-processor',    environment: 'staging',    region: 'us-west-2', status: 'warning', type: 'lambda',  uptime: 98.2, lastDeployed: new Date(_now - 1000 * 60 * 5).toISOString(),            owner: 'alex.wong',    team: 'Payments Team',  monthly_cost: null, metadata: {} } as any,
  { id: '4', name: 'notification-service', environment: 'production', region: 'us-east-1', status: 'healthy', type: 'lambda',  uptime: 99.9, lastDeployed: new Date(_now - 1000 * 60 * 60 * 6).toISOString(),       owner: 'emma.davis',   team: 'Platform Team',  monthly_cost: null, metadata: {} } as any,
  { id: '5', name: 'analytics-worker',     environment: 'production', region: 'eu-west-1', status: 'healthy', type: 'ec2',     uptime: 99.5, lastDeployed: new Date(_now - 1000 * 60 * 60 * 24).toISOString(),      owner: 'david.kim',    team: 'Data Team',      monthly_cost: null, metadata: {} } as any,
]

const DEMO_STATS: AWSServicesStats = { total: 5, healthy: 4, needs_attention: 1, avg_uptime: 99.4 }

// All 15 resource types from the discovery engine
const RESOURCE_TYPE_CHIPS = [
  'all',
  'ec2', 'ecs', 'lambda', 'rds', 's3', 'eks', 'dynamodb',
  'cloudfront', 'api-gateway', 'elasticache', 'aurora', 'sqs', 'sns',
  'load-balancer', 'vpc',
]

const TYPE_DISPLAY: Record<string, string> = {
  'all':          'All Types',
  'ec2':          'EC2',
  'ecs':          'ECS',
  'lambda':       'Lambda',
  'rds':          'RDS',
  's3':           'S3',
  'eks':          'EKS',
  'dynamodb':     'DynamoDB',
  'cloudfront':   'CloudFront',
  'api-gateway':  'API Gateway',
  'elasticache':  'ElastiCache',
  'aurora':       'Aurora',
  'sqs':          'SQS',
  'sns':          'SNS',
  'load-balancer':'Load Balancer',
  'vpc':          'VPC',
}

// Type badge colors
const TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  ec2:           { bg: '#F0FDF4', color: '#059669' },
  ecs:           { bg: '#EFF6FF', color: '#1D4ED8' },
  lambda:        { bg: '#F5F3FF', color: '#7C3AED' },
  rds:           { bg: '#FFFBEB', color: '#D97706' },
  s3:            { bg: '#FFF7ED', color: '#C2410C' },
  eks:           { bg: '#F0F9FF', color: '#0369A1' },
  dynamodb:      { bg: '#FDF4FF', color: '#A21CAF' },
  cloudfront:    { bg: '#ECFDF5', color: '#047857' },
  'api-gateway': { bg: '#EFF6FF', color: '#1E40AF' },
  elasticache:   { bg: '#FFF7ED', color: '#9A3412' },
  aurora:        { bg: '#FFFBEB', color: '#92400E' },
  sqs:           { bg: '#FEF2F2', color: '#B91C1C' },
  sns:           { bg: '#FDF4FF', color: '#7E22CE' },
  'load-balancer':{ bg: '#F0FDF4', color: '#166534' },
  elb:           { bg: '#F0FDF4', color: '#166534' },
  vpc:           { bg: '#F8FAFC', color: '#475569' },
}

function typeStyle(t: string) {
  return TYPE_COLORS[t] ?? { bg: '#F8FAFC', color: '#64748B' }
}

export default function ServicesPage() {
  const [envFilter,      setEnvFilter]      = useState<string>('all')
  const [templateFilter, setTemplateFilter] = useState<string>('all')
  const [search,         setSearch]         = useState<string>('')
  const [isDiscovering,  setIsDiscovering]  = useState(false)
  const [discoveryComplete, setDiscoveryComplete] = useState(false)
  const [discoveryMsg,   setDiscoveryMsg]   = useState<string | null>(null)

  // Real-data state
  const [services,  setServices]  = useState<AWSService[]>([])
  const [stats,     setStats]     = useState<AWSServicesStats | null>(null)
  const [isLoading,     setIsLoading]     = useState(false)
  const [error,         setError]         = useState<string | null>(null)
  const [noAwsAccount,  setNoAwsAccount]  = useState(true)

  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const demoMode     = useDemoMode()
  const salesDemoMode = useSalesDemo((state) => state.enabled)
  const isDemoActive = demoMode || salesDemoMode

  // ── Fetch real data ──────────────────────────────────────────────────────

  const fetchServices = useCallback(async () => {
    if (isDemoActive) return
    setIsLoading(true)
    setError(null)
    try {
      const [svcs, st] = await Promise.all([
        awsServicesService.getServices({
          type:   templateFilter !== 'all' ? templateFilter : undefined,
          env:    envFilter      !== 'all' ? envFilter      : undefined,
          search: search.trim()  || undefined,
        }),
        awsServicesService.getStats(),
      ])
      setServices(svcs)
      setStats(st)
    } catch (err: any) {
      // Check if the failure is simply because no AWS account is connected yet.
      // If so, show the onboarding empty state instead of an error banner.
      try {
        const accounts = await awsAccountsService.getAccounts()
        if (accounts.length === 0) {
          setNoAwsAccount(true)
          setError(null)
        } else {
          setNoAwsAccount(false)
          setError(err.message || 'Failed to load services')
        }
      } catch {
        // Can't confirm an account exists — default to onboarding, not error banner
        setNoAwsAccount(true)
        setError(null)
      }
    } finally {
      setIsLoading(false)
    }
  }, [isDemoActive, templateFilter, envFilter, search])

  // Initial load + re-fetch when filters change
  useEffect(() => {
    fetchServices()
  }, [fetchServices])

  // Debounce search input
  const handleSearchChange = (val: string) => {
    setSearch(val)
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(() => fetchServices(), 400)
  }

  // ── Auto Discover ────────────────────────────────────────────────────────

  const handleAutoDiscover = async () => {
    if (isDemoActive) {
      // Demo: keep existing fake behavior
      setIsDiscovering(true)
      setDiscoveryComplete(false)
      await new Promise(r => setTimeout(r, 2500))
      setIsDiscovering(false)
      setDiscoveryComplete(true)
      setTimeout(() => setDiscoveryComplete(false), 4000)
      return
    }

    setIsDiscovering(true)
    setDiscoveryComplete(false)
    setDiscoveryMsg(null)
    try {
      const result = await awsServicesService.discoverServices()
      setDiscoveryMsg(result.message)
      setDiscoveryComplete(true)
      setTimeout(() => { setDiscoveryComplete(false); setDiscoveryMsg(null) }, 6000)
      // Refetch services after discovery
      await fetchServices()
    } catch (err: any) {
      setError(err.message || 'Discovery failed — check your AWS connection')
    } finally {
      setIsDiscovering(false)
    }
  }

  // ── Derived display values ───────────────────────────────────────────────

  const allServices     = isDemoActive ? DEMO_SERVICES : services
  const displayStats    = isDemoActive ? DEMO_STATS     : stats

  // In demo mode filter locally; in real mode the API filters server-side
  const filteredServices = isDemoActive
    ? allServices.filter((s: any) => {
        const matchEnv  = envFilter      === 'all' || s.environment === envFilter
        const matchType = templateFilter === 'all' || s.type        === templateFilter
        const matchSrch = !search.trim() || s.name.toLowerCase().includes(search.toLowerCase())
        return matchEnv && matchType && matchSrch
      })
    : allServices  // already filtered by API

  const totalServices  = displayStats?.total          ?? allServices.length
  const healthyCount   = displayStats?.healthy         ?? allServices.filter((s: any) => s.status === 'healthy').length
  const warningCount   = displayStats?.needs_attention ?? allServices.filter((s: any) => s.status !== 'healthy').length
  const avgUptime      = displayStats?.avg_uptime
    ?? (allServices.length > 0
      ? parseFloat((allServices.reduce((sum: number, s: any) => sum + (s.uptime || 0), 0) / allServices.length).toFixed(1))
      : null)

  const avgUptimeDisplay = avgUptime != null ? `${avgUptime}%` : '—'

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
          <p style={{ fontSize: '0.876rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>
            Your AWS infrastructure · cost, health, and risks in one place
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
                ? <><Check size={15} /> {discoveryMsg ?? 'Discovery Complete'}</>
                : <><Scan size={15} /> Auto Discover</>
            }
          </button>
          <a href="/services/new" style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#7C3AED', color: '#fff', padding: '10px 20px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600, textDecoration: 'none' }}>
            <Plus size={15} /> Add Service
          </a>
        </div>
      </div>

      {/* Error banner — only shown when an AWS account IS connected but the call failed */}
      {error && !noAwsAccount && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '10px', padding: '12px 20px', marginBottom: '20px' }}>
          <p style={{ fontSize: '0.875rem', color: '#DC2626', margin: 0 }}>
            Failed to load services — check your AWS connection
          </p>
        </div>
      )}

      {/* 4 KPI CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', marginBottom: '28px' }}>
        {[
          { label: 'Total Services',  value: isLoading && !isDemoActive ? '…' : totalServices,          sub: 'Registered',         valueColor: '#0F172A' },
          { label: 'Healthy',         value: isLoading && !isDemoActive ? '…' : healthyCount,            sub: 'Operating normally',  valueColor: '#059669' },
          { label: 'Needs Attention', value: isLoading && !isDemoActive ? '…' : warningCount,            sub: 'Warning or critical', valueColor: warningCount > 0 ? '#D97706' : '#059669' },
          { label: 'Est. Monthly Cost', value: isLoading && !isDemoActive ? '…' : (avgUptime != null ? avgUptimeDisplay : '$0'), sub: 'Infrastructure spend', valueColor: '#0F172A' },
        ].map(({ label, value, sub, valueColor }) => (
          <div key={label} style={{ background: '#fff', borderRadius: '14px', padding: '32px', border: '1px solid #E2E8F0', opacity: isLoading && !isDemoActive ? 0.6 : 1, transition: 'opacity 0.2s' }}>
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
                ? 'Connect AWS to unlock real-time cost insights, security risks, and performance signals. Most teams uncover 20–40% wasted spend in their first scan.'
                : warningCount > 0
                  ? `${healthyCount} of ${totalServices} services healthy. ${warningCount} service${warningCount > 1 ? 's' : ''} require${warningCount === 1 ? 's' : ''} attention — review the highlighted rows below.`
                  : `${totalServices} services running with ${avgUptimeDisplay} average uptime. No active issues detected.`
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

        {/* Table header with filters */}
        <div style={{ padding: '20px 28px', borderBottom: '1px solid #F1F5F9' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', gap: '16px' }}>
            <div>
              <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 2px' }}>All Services</p>
              <p style={{ fontSize: '0.78rem', color: '#94A3B8', margin: 0 }}>{filteredServices.length} of {totalServices} services</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {/* Search */}
              <input
                type="text"
                placeholder="Search services…"
                value={search}
                onChange={e => handleSearchChange(e.target.value)}
                style={{
                  padding: '6px 12px', borderRadius: '8px', border: '1px solid #E2E8F0',
                  fontSize: '0.82rem', color: '#0F172A', background: '#F8FAFC',
                  outline: 'none', width: '180px',
                }}
              />
              {/* Environment filter */}
              <div style={{ display: 'flex', background: '#F8FAFC', borderRadius: '8px', padding: '4px', gap: '2px' }}>
                {['all', 'production', 'staging'].map(f => (
                  <button key={f} onClick={() => setEnvFilter(f)}
                    style={{
                      padding: '5px 14px', borderRadius: '6px', fontSize: '0.78rem', fontWeight: 600,
                      border: 'none', cursor: 'pointer', textTransform: 'capitalize',
                      background: envFilter === f ? '#fff' : 'transparent',
                      color:      envFilter === f ? '#0F172A' : '#64748B',
                      boxShadow:  envFilter === f ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                    }}>
                    {f === 'all' ? 'All Envs' : f}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Resource type filter chips — all 15 types */}
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {RESOURCE_TYPE_CHIPS.map(t => (
              <button key={t} onClick={() => setTemplateFilter(t)}
                style={{
                  padding: '4px 12px', borderRadius: '100px', fontSize: '0.75rem', fontWeight: 600,
                  border: 'none', cursor: 'pointer',
                  background: templateFilter === t ? '#7C3AED' : '#F1F5F9',
                  color:      templateFilter === t ? '#fff'    : '#475569',
                  transition: 'all 0.15s',
                }}>
                {TYPE_DISPLAY[t] ?? t}
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
            <RefreshCw size={20} style={{ color: '#94A3B8', margin: '0 auto 12px', animation: 'spin 1s linear infinite' }} />
            <p style={{ fontSize: '0.875rem', color: '#64748B', margin: 0 }}>Loading services...</p>
          </div>
        ) : filteredServices.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#F8FAFC', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <Layers size={22} style={{ color: '#94A3B8' }} />
            </div>
            <p style={{ fontSize: '1rem', fontWeight: 600, color: '#0F172A', margin: '0 0 6px' }}>Connect AWS to See What&apos;s Costing You Money</p>
            <p style={{ fontSize: '0.875rem', color: '#475569', margin: '0 0 28px', lineHeight: 1.6 }}>
              Secure read-only access — no changes made to your infrastructure.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', maxWidth: '600px', margin: '0 auto 28px', textAlign: 'left' }}>
              {[
                { step: '1', title: 'Connect AWS',       desc: 'Secure read-only access — no changes made to your infrastructure',  color: '#7C3AED' },
                { step: '2', title: 'Discover Services', desc: 'Automatically map your infrastructure, costs, and dependencies',        color: '#059669' },
                { step: '3', title: 'Monitor & Act',     desc: 'Uncover cost waste, security gaps, and performance risks instantly',    color: '#0EA5E9' },
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
              {noAwsAccount ? (
                <a href="/connect-aws" style={{ background: '#7C3AED', color: '#fff', padding: '10px 24px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600, border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '8px', textDecoration: 'none' }}>
                  Connect AWS Account →
                </a>
              ) : (
                <button onClick={handleAutoDiscover} style={{ background: '#7C3AED', color: '#fff', padding: '10px 24px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600, border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                  <Scan size={14} /> Auto Discover
                </button>
              )}
              <a href="/services/new" style={{ background: '#fff', color: '#475569', padding: '10px 24px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 500, border: '1px solid #E2E8F0', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                + Add Manually
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
            const tc          = typeStyle(svc.type)

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
                    {svc.last_deployed && (
                      <p style={{ fontSize: '0.72rem', color: '#94A3B8', margin: 0 }}>
                        Synced {new Date(svc.last_deployed).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    )}
                  </div>

                  {/* Resource type */}
                  <span style={{
                    fontSize: '0.72rem', fontWeight: 700, padding: '3px 8px', borderRadius: '4px', width: 'fit-content',
                    background: tc.bg, color: tc.color,
                  }}>
                    {TYPE_DISPLAY[svc.type] ?? svc.type?.toUpperCase() ?? '—'}
                  </span>

                  {/* Environment */}
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, padding: '3px 10px', borderRadius: '100px', background: envBg, color: envColor, width: 'fit-content' }}>
                    {svc.environment}
                  </span>

                  {/* Region */}
                  <span style={{ fontSize: '0.82rem', color: '#475569', fontFamily: 'monospace' }}>{svc.region || '—'}</span>

                  {/* Owner / Team */}
                  <div>
                    <p style={{ fontSize: '0.78rem', fontWeight: 500, color: '#1E293B', margin: '0 0 1px' }}>
                      {svc.owner?.split('@')[0] ?? svc.owner ?? '—'}
                    </p>
                    <p style={{ fontSize: '0.7rem', color: '#94A3B8', margin: 0 }}>
                      {svc.team ?? ''}
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
