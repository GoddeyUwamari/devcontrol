'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

function useWindowWidth() {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const update = () => setWidth(window.innerWidth)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return width
}
import { Plus, Rocket, GitBranch, Activity, ArrowRight, Layers, RefreshCw, Sparkles, Check, Scan, AlertTriangle } from 'lucide-react'
import { useDemoMode } from '@/components/demo/demo-mode-toggle'
import { useSalesDemo } from '@/lib/demo/sales-demo-data'
import awsServicesService, { AWSService, AWSServicesStats } from '@/lib/services/aws-services.service'
import awsAccountsService from '@/lib/services/aws-accounts.service'
import { usePlan } from '@/lib/hooks/use-plan'

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
  const width = useWindowWidth()
  const isMobile = width > 0 && width < 640
  const isTablet = width >= 640 && width < 1024
  const [envFilter,      setEnvFilter]      = useState<string>('all')
  const [templateFilter, setTemplateFilter] = useState<string>('all')
  const [search,         setSearch]         = useState<string>('')
  const [showAll,        setShowAll]        = useState(false)
  const INITIAL_VISIBLE = 4
  const [isDiscovering,  setIsDiscovering]  = useState(false)
  const [discoveryComplete, setDiscoveryComplete] = useState(false)
  const [discoveryMsg,   setDiscoveryMsg]   = useState<string | null>(null)

  // Real-data state
  const [services,  setServices]  = useState<AWSService[]>([])
  const [stats,     setStats]     = useState<AWSServicesStats | null>(null)
  const [isLoading,     setIsLoading]     = useState(false)
  const [error,         setError]         = useState<string | null>(null)
  const [noAwsAccount,  setNoAwsAccount]  = useState(true)
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false)

  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const demoMode     = useDemoMode()
  const salesDemoMode = useSalesDemo((state) => state.enabled)
  const isDemoActive = demoMode || salesDemoMode
  const { tier } = usePlan()

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
      if (err.response?.status === 402) {
        setShowUpgradePrompt(true)
        return
      }
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
      if (err.response?.status === 402) {
        setShowUpgradePrompt(true)
      } else {
        setError(err.message || 'Discovery failed — check your AWS connection')
      }
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

  const visibleServices = showAll ? filteredServices : filteredServices.slice(0, INITIAL_VISIBLE)

  // Reset show-all when filters or search change
  useEffect(() => {
    setShowAll(false)
  }, [envFilter, templateFilter, search])

  const totalMonthlyCost = allServices.reduce((sum: number, s: any) => sum + (s.monthly_cost || 0), 0)
  const costDisplay = '$' + totalMonthlyCost.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

  return (
    <div style={{
      padding: isMobile ? '24px 16px' : isTablet ? '40px 24px' : '40px 56px 64px',
      maxWidth: '1320px',
      margin: '0 auto',
      minHeight: '100vh',
      background: '#F9FAFB',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {/* PAGE HEADER */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '34px' }}>
        <div>
          <p style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#7C3AED', margin: '0 0 6px' }}>
            Services
          </p>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#0F172A', margin: '0 0 6px', letterSpacing: '-0.02em' }}>
            Services Intelligence
          </h1>
          <p style={{ fontSize: '0.876rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>
            Performance, cost, and risk across all services — real time.
          </p>
        </div>
        <div style={{ display: 'flex', gap: isMobile ? '8px' : '10px', alignItems: 'center', flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
          <button
            onClick={handleAutoDiscover}
            disabled={isDiscovering}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              background: discoveryComplete ? '#059669' : '#fff',
              color: discoveryComplete ? '#fff' : '#475569',
              padding: '8px 14px', borderRadius: '7px',
              fontSize: '12px', fontWeight: 600,
              border: `1px solid ${discoveryComplete ? '#059669' : '#E2E8F0'}`,
              cursor: isDiscovering ? 'not-allowed' : 'pointer',
            }}>
            {isDiscovering
              ? <><RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} /> Scanning...</>
              : discoveryComplete
                ? <><Check size={13} /> {discoveryMsg ?? 'Complete'}</>
                : <><Scan size={13} /> Auto Discover</>
            }
          </button>
          <a href="/anomalies" style={{
            display: 'flex', alignItems: 'center', gap: '7px',
            background: '#7c3aed',
            color: 'white', padding: '10px 20px', borderRadius: '10px',
            fontSize: '13px', fontWeight: 600, textDecoration: 'none', border: 'none',
          }}>
            <AlertTriangle size={13} />
            {warningCount > 0 ? 'Resolve At-Risk Services' : 'Add Service'}
          </a>
        </div>
      </div>

      {/* SYSTEM INTELLIGENCE STRIP */}
      <div style={{
        background: '#fff', borderRadius: '10px', border: '1px solid #E2E8F0',
        padding: '20px 24px', marginBottom: '18px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: '16px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>

          {/* Score ring */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ position: 'relative', width: '54px', height: '54px', flexShrink: 0 }}>
              <svg width="54" height="54" viewBox="0 0 54 54">
                <circle cx="27" cy="27" r="23" fill="none" stroke="#F1F5F9" strokeWidth="5"/>
                <circle cx="27" cy="27" r="23" fill="none"
                  stroke={warningCount > 0 ? '#D97706' : '#059669'}
                  strokeWidth="5"
                  strokeDasharray="144.5"
                  strokeDashoffset={warningCount > 0 ? 43 : 14}
                  strokeLinecap="round"
                  transform="rotate(-90 27 27)"/>
              </svg>
              <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: 700, color: '#0F172A' }}>
                {warningCount > 0 ? 78 : 95}
              </span>
            </div>
            <div>
              <p style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#374151', margin: '0 0 4px' }}>Service Health Score</p>
              <p style={{ fontSize: '16px', fontWeight: 700, color: '#111827', margin: '0 0 3px' }}>
                {warningCount > 0 ? 'System Stable — Performance Risk Emerging in Production' : 'All Systems Healthy'}
              </p>
              <p style={{ fontSize: '12px', fontWeight: 500, color: '#374151', margin: 0 }}>
                {totalServices}/{totalServices} services measured · High confidence
              </p>
            </div>
          </div>

          <div style={{ width: '1px', height: '44px', background: '#E2E8F0', flexShrink: 0 }} />

          {/* Drivers */}
          <div>
            <p style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#374151', margin: '0 0 6px' }}>Driven by</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              {isDemoActive ? (
                <>
                  <p style={{ fontSize: '13px', color: '#DC2626', fontWeight: 600, margin: 0 }}>● Payment processor invocation spike (+178%)</p>
                  <p style={{ fontSize: '13px', color: '#374151', fontWeight: 500, margin: 0 }}>● Analytics worker cost inefficiency detected</p>
                  <p style={{ fontSize: '13px', color: '#374151', fontWeight: 500, margin: 0 }}>● {healthyCount} services operating within thresholds</p>
                </>
              ) : warningCount > 0 ? (
                <>
                  <p style={{ fontSize: '13px', color: '#DC2626', fontWeight: 600, margin: 0 }}>● {warningCount} service{warningCount !== 1 ? 's' : ''} requiring attention</p>
                  <p style={{ fontSize: '13px', color: '#374151', fontWeight: 500, margin: 0 }}>● {healthyCount} services operating within thresholds</p>
                </>
              ) : (
                <>
                  <p style={{ fontSize: '13px', color: '#059669', fontWeight: 600, margin: 0 }}>● All {totalServices} services operating within thresholds</p>
                  <p style={{ fontSize: '13px', color: '#374151', fontWeight: 500, margin: 0 }}>● Average uptime {avgUptimeDisplay}</p>
                </>
              )}
            </div>
          </div>

          <div style={{ width: '1px', height: '44px', background: '#E2E8F0', flexShrink: 0 }} />

          {/* Business impact */}
          <div>
            <p style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#374151', margin: '0 0 4px' }}>Business Impact</p>
            <p style={{ fontSize: '14px', fontWeight: 700, color: '#111827', margin: '0 0 3px' }}>
              {isDemoActive ? 'Transaction flow at risk · $864 cost increase' : warningCount > 0 ? `${warningCount} service${warningCount !== 1 ? 's' : ''} at risk` : 'No active business impact detected'}
            </p>
            <p style={{ fontSize: '12px', fontWeight: 600, color: warningCount > 0 ? '#DC2626' : '#059669', margin: 0 }}>
              {isDemoActive ? 'Payment processing degradation — user-facing' : warningCount > 0 ? 'Review highlighted services below' : 'All systems nominal'}
            </p>
          </div>

          <div style={{ width: '1px', height: '44px', background: '#E2E8F0', flexShrink: 0 }} />

          {/* At risk count */}
          <div>
            <p style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#DC2626', margin: '0 0 4px' }}>At Risk</p>
            <p style={{ fontSize: '22px', fontWeight: 700, color: '#DC2626', margin: '0 0 3px' }}>
              {warningCount} of {totalServices}
            </p>
            <p style={{ fontSize: '12px', fontWeight: 500, color: '#374151', margin: 0 }}>
              {isDemoActive ? '1 reliability · 1 cost inefficiency' : warningCount > 0 ? 'Require immediate review' : 'All services healthy'}
            </p>
          </div>

        </div>
        <a href="/ai-reports" style={{ fontSize: '11px', fontWeight: 700, color: '#7C3AED', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap', flexShrink: 0 }}>
          Full report <ArrowRight size={11} />
        </a>
      </div>

      {/* Tier limit upgrade prompt */}
      {showUpgradePrompt && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: '#FEF3C7', border: '1px solid #F59E0B', borderRadius: '10px',
          padding: '14px 20px', marginBottom: '26px', gap: '16px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '1.1rem' }}>⚠️</span>
            <span style={{ fontSize: '0.875rem', fontWeight: 500, color: '#92400E' }}>
              You've reached your service limit on the <strong>{tier}</strong> plan. Upgrade to monitor more services.
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

      {/* Error banner — only shown when an AWS account IS connected but the call failed */}
      {error && !noAwsAccount && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '10px', padding: '12px 20px', marginBottom: '22px' }}>
          <p style={{ fontSize: '0.875rem', color: '#DC2626', margin: 0 }}>
            Failed to load services — check your AWS connection
          </p>
        </div>
      )}

      {/* IMMEDIATE ACTION BANNER */}
      {warningCount > 0 && (
        <div style={{
          background: '#FEF2F2', border: '1.5px solid #DC2626', borderRadius: '14px',
          padding: '16px 22px', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', gap: '16px', marginBottom: '18px',
        }}>
          <div>
            <p style={{ color: '#DC2626', fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 4px' }}>Immediate Action Required</p>
            <p style={{ color: '#7f1d1d', fontSize: '16px', fontWeight: 600, margin: '0 0 8px' }}>
              {warningCount} production service{warningCount !== 1 ? 's' : ''} at risk — potential downtime &amp; revenue impact
            </p>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {['Revenue disruption risk', 'SLA breach risk', 'Fix in < 5 min'].map(pill => (
                <span key={pill} style={{ background: 'white', border: '0.5px solid #fecaca', borderRadius: '20px', padding: '2px 9px', fontSize: '11px', color: '#991b1b' }}>{pill}</span>
              ))}
            </div>
          </div>
          <a href="/anomalies" style={{
            background: '#DC2626', color: 'white', border: 'none', borderRadius: '10px',
            padding: '11px 20px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
            textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0,
          }}>Resolve All Critical Issues</a>
        </div>
      )}

      {/* EXECUTIVE SUMMARY STRIP */}
      <div style={{
        background: 'white', border: '0.5px solid #f3f4f6', borderRadius: '12px',
        padding: '10px 20px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', marginBottom: '18px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span style={{ fontSize: '13px', fontWeight: 500, color: '#374151' }}>
            Total cost: {totalMonthlyCost > 0
              ? <span style={{ color: '#111827', fontWeight: 700 }}>{costDisplay}</span>
              : <span style={{ color: '#6b7280', fontWeight: 500 }}>Syncing...</span>
            }
          </span>
          <span style={{ width: '1px', height: '14px', background: '#e5e7eb', margin: '0 16px', display: 'inline-block' }} />
          <span style={{ fontSize: '13px', fontWeight: 500, color: '#374151' }}>
            Services at risk: <span style={{ color: '#DC2626', fontWeight: 700 }}>{warningCount}</span>
          </span>
          <span style={{ width: '1px', height: '14px', background: '#e5e7eb', margin: '0 16px', display: 'inline-block' }} />
          <span style={{ fontSize: '13px', fontWeight: 500, color: '#374151' }}>
            System health: <span style={{ color: '#111827', fontWeight: 500 }}>{warningCount > 0 ? 'Degraded' : 'Stable'}</span>
          </span>
          <span style={{ width: '1px', height: '14px', background: '#e5e7eb', margin: '0 16px', display: 'inline-block' }} />
          <span style={{ fontSize: '13px', fontWeight: 500, color: '#374151' }}>{totalServices} services monitored</span>
        </div>
        {warningCount > 0 && (
          <span style={{ color: '#DC2626', fontSize: '12px', fontWeight: 600 }}>
            Recommended: Resolve {warningCount} critical service{warningCount !== 1 ? 's' : ''} now
          </span>
        )}
      </div>

      {/* 4 KPI CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : isTablet ? 'repeat(2,1fr)' : 'repeat(4, 1fr)', gap: '20px', marginBottom: '30px' }}>

        {/* Total Services */}
        <div style={{ background: '#fff', borderRadius: '12px', padding: '22px', border: '1px solid #E2E8F0', opacity: isLoading && !isDemoActive ? 0.6 : 1 }}>
          <p style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#374151', margin: '0 0 14px' }}>Total Services</p>
          <div style={{ fontSize: '38px', fontWeight: 700, color: '#111827', lineHeight: 1, marginBottom: '5px' }}>
            {isLoading && !isDemoActive ? '…' : totalServices}
          </div>
          <p style={{ color: '#6b7280', fontSize: '12px', fontWeight: 500, margin: 0 }}>Registered across all environments</p>
        </div>

        {/* Healthy */}
        <div style={{ background: '#fff', borderRadius: '12px', padding: '22px', border: '1px solid #E2E8F0', opacity: isLoading && !isDemoActive ? 0.6 : 1 }}>
          <p style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#374151', margin: '0 0 14px' }}>Healthy</p>
          <div style={{ fontSize: '38px', fontWeight: 700, color: '#059669', lineHeight: 1, marginBottom: '5px' }}>
            {isLoading && !isDemoActive ? '…' : healthyCount}
          </div>
          <p style={{ color: '#6b7280', fontSize: '12px', fontWeight: 500, margin: 0 }}>Operating within thresholds</p>
        </div>

        {/* At Risk */}
        <div style={{ background: '#fff', borderRadius: '12px', padding: '22px', border: '1px solid #E2E8F0', opacity: isLoading && !isDemoActive ? 0.6 : 1 }}>
          <p style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#374151', margin: '0 0 14px' }}>At Risk</p>
          <div style={{ fontSize: '38px', fontWeight: 700, color: '#DC2626', lineHeight: 1, marginBottom: '5px' }}>
            {isLoading && !isDemoActive ? '…' : warningCount}
          </div>
          <p style={{ color: '#6b7280', fontSize: '12px', fontWeight: 500, margin: '0 0 3px' }}>
            {isDemoActive ? '1 reliability · 1 cost inefficiency · both in production' : warningCount > 0 ? `${warningCount} at risk — affecting production services` : 'No services at risk'}
          </p>
          {warningCount > 0 && (
            <p style={{ fontSize: '12px', fontWeight: 600, color: '#DC2626', margin: 0 }}>Resolve now →</p>
          )}
        </div>

        {/* Total Monthly Cost */}
        <div style={{ background: '#fff', borderRadius: '12px', padding: '22px', border: '1px solid #E2E8F0', opacity: isLoading && !isDemoActive ? 0.6 : 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
            <p style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#374151', margin: 0 }}>Total Monthly Cost</p>
            <span style={{ fontSize: '9px', fontWeight: 700, color: '#D97706', background: '#FEF3C7', padding: '1px 6px', borderRadius: '3px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Partial</span>
          </div>
          <div style={{ fontSize: '32px', fontWeight: 700, color: '#111827', lineHeight: 1, marginBottom: '5px' }}>
            {isLoading && !isDemoActive ? '…' : '$11,444'}
          </div>
          <p style={{ color: '#6b7280', fontSize: '12px', fontWeight: 500, margin: 0 }}>Aggregate · per-service breakdown in progress</p>
        </div>

      </div>

      {/* DECISION INTELLIGENCE */}
      <div style={{
        background: '#faf5ff', borderRadius: '12px', padding: '16px 20px',
        border: '1px solid #e9d5ff', marginBottom: '22px',
        display: 'flex', alignItems: 'flex-start', gap: '14px',
      }}>
        <div style={{ width: '28px', height: '28px', borderRadius: '7px', background: '#7C3AED', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Sparkles size={12} style={{ color: '#fff' }} />
        </div>
        <div style={{ flex: 1 }}>
          <p style={{ color: '#7c3aed', fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 4px' }}>AI Insight</p>
          <p style={{ fontSize: '14px', color: '#111827', fontWeight: 600, lineHeight: 1.5, margin: '0 0 4px' }}>
            {isDemoActive
              ? <><strong style={{ color: '#DC2626' }}>Payment Processor</strong> showing Lambda invocation spike (+178%) — likely retry loop driving <strong style={{ color: '#DC2626' }}>$864 cost increase</strong> this month. Investigate retry logic before this impacts transaction reliability. Analytics Worker has a cost inefficiency — non-critical but recoverable.</>
              : totalServices === 0
                ? 'Connect AWS to unlock real-time cost insights, security risks, and performance signals. Most teams uncover 20–40% wasted spend in their first scan.'
                : warningCount > 0
                  ? <>{warningCount} service{warningCount > 1 ? 's' : ''} showing early degradation signals. No current outage risk, but performance instability detected in production.</>
                  : <>{totalServices} services running with {avgUptimeDisplay} average uptime. No active issues detected.</>
            }
          </p>
          <p style={{ fontSize: '13px', color: '#374151', fontWeight: 500, margin: 0 }}>
            {isDemoActive
              ? '17 of 19 services operating within thresholds · no new issues detected in last 24h.'
              : totalServices === 0
                ? ''
                : warningCount > 0
                  ? `Review highlighted services below — ${healthyCount} of ${totalServices} services operating normally.`
                  : 'System is healthy — no action required.'
            }
          </p>
        </div>
        {warningCount > 0 && (
          <a href="/anomalies" style={{ fontSize: '12px', fontWeight: 600, color: '#7c3aed', textDecoration: 'none', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
            Recommended: Resolve before impact occurs →
          </a>
        )}
      </div>

      {/* PRIORITY ACTIONS */}
      {(isDemoActive || warningCount > 0) && (
        <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: '12px', padding: '20px 24px', marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
            <div>
              <p style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#374151', margin: '0 0 3px' }}>Priority Actions</p>
              <p style={{ fontSize: '0.8rem', color: '#475569', margin: 0 }}>
                Ranked by impact · {isDemoActive ? '2 services at risk in production' : `${warningCount} service${warningCount !== 1 ? 's' : ''} at risk`}
              </p>
            </div>
            <span style={{ display: 'inline-flex', background: '#f5f3ff', color: '#7c3aed', border: '1px solid #e9d5ff', borderRadius: '20px', padding: '3px 12px', fontSize: '11px', fontWeight: 600 }}>Action required</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
            {isDemoActive ? (
              <>
                {/* Demo Priority 1 */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', background: '#fff9f9', borderRadius: '12px', border: '1.5px solid #fecaca' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                    <div style={{ textAlign: 'center', minWidth: '40px' }}>
                      <p style={{ fontSize: '0.6rem', fontWeight: 700, color: '#DC2626', textTransform: 'uppercase', margin: '0 0 2px' }}>Priority</p>
                      <p style={{ fontSize: '22px', fontWeight: 700, color: '#DC2626', margin: 0 }}>1</p>
                    </div>
                    <div style={{ width: '1px', height: '40px', background: '#fecaca', flexShrink: 0 }} />
                    <div>
                      <p style={{ fontSize: '14px', fontWeight: 600, color: '#111827', margin: '0 0 3px' }}>
                        Payment Processor (Lambda) — <span style={{ color: '#DC2626', fontWeight: 600 }}>invocation spike +178%</span>
                      </p>
                      <p style={{ fontSize: '12px', color: '#374151', fontWeight: 500, margin: 0 }}>Staging · us-west-2 · retry loop suspected · $864 cost increase · user-facing transaction risk</p>
                      <p style={{ color: '#991b1b', fontSize: '11px', fontWeight: 500, margin: '4px 0 0' }}>Potential impact: Revenue disruption · SLA breach risk</p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flexShrink: 0 }}>
                    <span style={{ display: 'inline-flex', padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', background: '#DC2626', color: 'white' }}>High</span>
                    <span style={{ display: 'inline-flex', padding: '2px 7px', borderRadius: '4px', fontSize: '9.5px', fontWeight: 700, textTransform: 'uppercase', background: '#FEE2E2', color: '#991B1B' }}>Reliability</span>
                    <a href="/anomalies" style={{ background: '#7c3aed', color: 'white', border: 'none', borderRadius: '8px', padding: '8px 16px', fontSize: '12px', fontWeight: 600, textDecoration: 'none' }}>Resolve Issue →</a>
                  </div>
                </div>
                {/* Demo Priority 2 */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 16px', background: '#FFFBEB', borderRadius: '8px', border: '1px solid #FDE68A' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                    <div style={{ textAlign: 'center', minWidth: '40px' }}>
                      <p style={{ fontSize: '0.6rem', fontWeight: 700, color: '#D97706', textTransform: 'uppercase', margin: '0 0 2px' }}>Priority</p>
                      <p style={{ fontSize: '1rem', fontWeight: 700, color: '#D97706', margin: 0 }}>2</p>
                    </div>
                    <div style={{ width: '1px', height: '32px', background: '#FDE68A', flexShrink: 0 }} />
                    <div>
                      <p style={{ fontSize: '0.84rem', fontWeight: 600, color: '#0F172A', margin: '0 0 3px' }}>
                        Analytics Worker (EC2) — <span style={{ color: '#D97706' }}>cost inefficiency detected</span>
                      </p>
                      <p style={{ fontSize: '0.7rem', color: '#64748B', margin: 0 }}>Production · eu-west-1 · over-provisioned · non-critical · recoverable savings available</p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flexShrink: 0 }}>
                    <span style={{ display: 'inline-flex', padding: '2px 7px', borderRadius: '4px', fontSize: '9.5px', fontWeight: 700, textTransform: 'uppercase', background: '#FEF3C7', color: '#92400E' }}>Medium</span>
                    <span style={{ display: 'inline-flex', padding: '2px 7px', borderRadius: '4px', fontSize: '9.5px', fontWeight: 700, textTransform: 'uppercase', background: '#FEF3C7', color: '#92400E' }}>Cost Waste</span>
                    <a href="/cost-optimization" style={{ background: '#fff', color: '#475569', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '5px 12px', fontSize: '11px', fontWeight: 600, textDecoration: 'none' }}>Review Impact →</a>
                  </div>
                </div>
              </>
            ) : (
              // Real mode — render at-risk services as priority items
              allServices
                .filter((s: any) => s.status !== 'healthy')
                .map((svc: any, i: number) => (
                  <div key={svc.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', background: '#fff9f9', borderRadius: '12px', border: '1.5px solid #fecaca' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                      <div style={{ textAlign: 'center', minWidth: '40px' }}>
                        <p style={{ fontSize: '0.6rem', fontWeight: 700, color: '#DC2626', textTransform: 'uppercase', margin: '0 0 2px' }}>Priority</p>
                        <p style={{ fontSize: '22px', fontWeight: 700, color: '#DC2626', margin: 0 }}>{i + 1}</p>
                      </div>
                      <div style={{ width: '1px', height: '40px', background: '#fecaca', flexShrink: 0 }} />
                      <div>
                        <p style={{ fontSize: '14px', fontWeight: 600, color: '#111827', margin: '0 0 3px' }}>
                          {svc.name} ({(svc.type as string)?.toUpperCase()}) — <span style={{ color: '#DC2626', fontWeight: 600 }}>at risk</span>
                        </p>
                        <p style={{ fontSize: '12px', color: '#374151', fontWeight: 500, margin: 0 }}>
                          {svc.environment} · {svc.region || 'us-east-1'} · uptime {svc.uptime}%
                        </p>
                        <p style={{ color: '#991b1b', fontSize: '11px', fontWeight: 500, margin: '4px 0 0' }}>Potential impact: Revenue disruption · SLA breach risk</p>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flexShrink: 0 }}>
                      <span style={{ display: 'inline-flex', padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', background: '#DC2626', color: 'white' }}>High</span>
                      <a href={`/anomalies?service=${svc.name}`} style={{ background: '#7c3aed', color: 'white', border: 'none', borderRadius: '8px', padding: '8px 16px', fontSize: '12px', fontWeight: 600, textDecoration: 'none' }}>
                        Resolve Issue →
                      </a>
                    </div>
                  </div>
                ))
            )}
          </div>
        </div>
      )}

      {/* QUICK NAV */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : isTablet ? 'repeat(2,1fr)' : 'repeat(3, 1fr)', gap: '14px', marginBottom: '30px' }}>
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
      <div style={{ background: '#fff', borderRadius: '16px', border: '1px solid #F1F5F9', overflow: 'hidden', overflowX: isMobile ? 'auto' : 'hidden' }}>

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
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 110px 130px 110px 100px 110px 80px', padding: '10px 28px', background: '#F8FAFC', borderBottom: '1px solid #F1F5F9' }}>
          {['Service', 'Type', 'Environment', 'Status', 'Uptime', 'Monthly Cost', ''].map(col => (
            <span key={col} style={{ fontSize: '11px', fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{col}</span>
          ))}
        </div>

        {/* Service rows */}
        {isLoading && !isDemoActive ? (
          <div style={{ padding: isMobile ? '16px 14px' : '48px', textAlign: 'center' }}>
            <RefreshCw size={20} style={{ color: '#94A3B8', margin: '0 auto 12px', animation: 'spin 1s linear infinite' }} />
            <p style={{ fontSize: '0.875rem', color: '#64748B', margin: 0 }}>Loading services...</p>
          </div>
        ) : filteredServices.length === 0 ? (
          <div style={{ padding: isMobile ? '16px 14px' : '48px', textAlign: 'center' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#F8FAFC', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <Layers size={22} style={{ color: '#94A3B8' }} />
            </div>
            <p style={{ fontSize: '1rem', fontWeight: 600, color: '#0F172A', margin: '0 0 6px' }}>Connect AWS to See What&apos;s Costing You Money</p>
            <p style={{ fontSize: '0.875rem', color: '#475569', margin: '0 0 28px', lineHeight: 1.6 }}>
              Secure read-only access — no changes made to your infrastructure.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : isTablet ? 'repeat(2,1fr)' : 'repeat(3, 1fr)', gap: '16px', maxWidth: '600px', margin: '0 auto 28px', textAlign: 'left' }}>
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
          visibleServices.map((svc: any, idx: number) => {
            const isAtRisk    = svc.status === 'warning' || svc.status === 'critical'
            const isHealthy   = svc.status === 'healthy'
            const isWarning   = svc.status === 'warning'
            const statusColor = isHealthy ? '#059669' : isWarning ? '#D97706' : '#DC2626'
            const envColor    = svc.environment === 'production' ? '#059669' : svc.environment === 'staging' ? '#D97706' : '#64748B'
            const envBg       = svc.environment === 'production' ? '#F0FDF4' : svc.environment === 'staging' ? '#FFFBEB' : '#F8FAFC'
            const tc          = typeStyle(svc.type)
            const rowBg       = isAtRisk ? '#FFFBEB' : '#fff'
            const rowBorderBottom = isAtRisk ? '1px solid #FDE68A' : idx < visibleServices.length - 1 ? '1px solid #F8FAFC' : 'none'

            return (
              <div
                key={svc.id}
                style={{
                  padding: '16px 28px',
                  background: rowBg,
                  borderBottom: rowBorderBottom,
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = isAtRisk ? '#FFF7ED' : '#F8FAFC' }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = rowBg }}
              >
                {/* Main row grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 110px 130px 110px 100px 110px 80px', alignItems: 'center' }}>
                  {/* Service name */}
                  <div>
                    <p style={{ fontSize: '13px', fontWeight: 600, color: '#111827', margin: '0 0 2px' }}>
                      {svc.name.split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')} ({(svc.type as string)?.toUpperCase()})
                    </p>
                    {isAtRisk && (
                      <p style={{ fontSize: '0.68rem', color: svc.status === 'critical' ? '#DC2626' : '#D97706', fontWeight: 600, margin: 0 }}>
                        {isDemoActive
                          ? 'Lambda invocation spike detected (+178%) · retry loop suspected'
                          : `${svc.name} at risk · check recent deployments and anomalies`
                        }
                      </p>
                    )}
                    {!isAtRisk && svc.last_deployed && (
                      <p style={{ fontSize: '0.68rem', color: '#94A3B8', margin: 0 }}>
                        Last synced {new Date(svc.last_deployed).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    )}
                  </div>

                  {/* Resource type */}
                  <span style={{
                    fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '6px', width: 'fit-content',
                    background: '#f3f4f6', color: '#374151',
                  }}>
                    {TYPE_DISPLAY[svc.type] ?? svc.type?.toUpperCase() ?? '—'}
                  </span>

                  {/* Environment */}
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, padding: '3px 10px', borderRadius: '100px', background: envBg, color: envColor, width: 'fit-content' }}>
                    {svc.environment}
                  </span>

                  {/* Status */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
                    <span style={{ fontSize: '0.8rem', fontWeight: 600, color: isAtRisk ? statusColor : '#059669' }}>
                      {isAtRisk ? (svc.status === 'critical' ? 'Critical' : 'At Risk') : 'Healthy'}
                    </span>
                  </div>

                  {/* Uptime */}
                  <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#111827' }}>
                    {svc.uptime ? `${svc.uptime}%` : '—'}
                  </span>

                  {/* Monthly Cost */}
                  <span style={{ fontSize: '0.82rem', color: '#94A3B8', fontStyle: 'italic' }}>
                    {svc.monthly_cost ? `$${svc.monthly_cost.toLocaleString()}` : '—'}
                  </span>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <a
                      href={isAtRisk ? `/anomalies?service=${svc.name}` : `/services/${svc.id}`}
                      style={{
                        fontSize: '0.75rem', fontWeight: 600,
                        color: '#7c3aed',
                        textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px'
                      }}
                    >
                      {isAtRisk ? 'Investigate' : 'View'} <ArrowRight size={12} />
                    </a>
                  </div>
                </div>
              </div>
            )
          })
        )}
        {filteredServices.length > INITIAL_VISIBLE && (
          <div style={{
            textAlign: 'center',
            padding: '14px 0',
            borderTop: '0.5px solid #e5e7eb',
          }}>
            <button
              onClick={() => setShowAll(prev => !prev)}
              style={{
                fontSize: '13px',
                color: '#534AB7',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontWeight: 500,
              }}
            >
              {showAll
                ? `Show less ↑`
                : `See all ${filteredServices.length} services ↓`}
            </button>
          </div>
        )}
      </div>

    </div>
  )
}
