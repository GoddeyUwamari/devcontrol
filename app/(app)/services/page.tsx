'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Rocket, GitBranch, Activity, ArrowRight, Layers, RefreshCw, Sparkles, Check, Scan, AlertTriangle } from 'lucide-react'
import { useDemoMode } from '@/components/demo/demo-mode-toggle'
import { useSalesDemo } from '@/lib/demo/sales-demo-data'
import awsServicesService, { AWSService, AWSServicesStats } from '@/lib/services/aws-services.service'
import awsAccountsService from '@/lib/services/aws-accounts.service'
import { usePlan } from '@/lib/hooks/use-plan'

const _now = Date.now()

const DEMO_SERVICES: AWSService[] = [
  { id: '1', name: 'api-gateway',         environment: 'production', region: 'us-east-1', status: 'healthy', type: 'ecs',    uptime: 99.9, lastDeployed: new Date(_now - 1000 * 60 * 45).toISOString(),         owner: 'sarah.chen',   team: 'Platform Team',  monthly_cost: null, metadata: {} } as any,
  { id: '2', name: 'auth-service',         environment: 'production', region: 'us-east-1', status: 'healthy', type: 'ecs',    uptime: 99.7, lastDeployed: new Date(_now - 1000 * 60 * 120).toISOString(),        owner: 'mike.johnson', team: 'Auth Team',      monthly_cost: null, metadata: {} } as any,
  { id: '3', name: 'payment-processor',    environment: 'staging',    region: 'us-west-2', status: 'warning', type: 'lambda', uptime: 98.2, lastDeployed: new Date(_now - 1000 * 60 * 5).toISOString(),           owner: 'alex.wong',    team: 'Payments Team',  monthly_cost: null, metadata: {} } as any,
  { id: '4', name: 'notification-service', environment: 'production', region: 'us-east-1', status: 'healthy', type: 'lambda', uptime: 99.9, lastDeployed: new Date(_now - 1000 * 60 * 60 * 6).toISOString(),      owner: 'emma.davis',   team: 'Platform Team',  monthly_cost: null, metadata: {} } as any,
  { id: '5', name: 'analytics-worker',     environment: 'production', region: 'eu-west-1', status: 'healthy', type: 'ec2',    uptime: 99.5, lastDeployed: new Date(_now - 1000 * 60 * 60 * 24).toISOString(),     owner: 'david.kim',    team: 'Data Team',      monthly_cost: null, metadata: {} } as any,
]

const DEMO_STATS: AWSServicesStats = { total: 5, healthy: 4, needs_attention: 1, avg_uptime: 99.4 }

const RESOURCE_TYPE_CHIPS = [
  'all',
  'ec2', 'ecs', 'lambda', 'rds', 's3', 'eks', 'dynamodb',
  'cloudfront', 'api-gateway', 'elasticache', 'aurora', 'sqs', 'sns',
  'load-balancer', 'vpc',
]

const TYPE_DISPLAY: Record<string, string> = {
  'all': 'All Types', 'ec2': 'EC2', 'ecs': 'ECS', 'lambda': 'Lambda',
  'rds': 'RDS', 's3': 'S3', 'eks': 'EKS', 'dynamodb': 'DynamoDB',
  'cloudfront': 'CloudFront', 'api-gateway': 'API Gateway',
  'elasticache': 'ElastiCache', 'aurora': 'Aurora', 'sqs': 'SQS',
  'sns': 'SNS', 'load-balancer': 'Load Balancer', 'vpc': 'VPC',
}

const TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  ec2:            { bg: '#F0FDF4', color: '#059669' },
  ecs:            { bg: '#EFF6FF', color: '#1D4ED8' },
  lambda:         { bg: '#F5F3FF', color: '#7C3AED' },
  rds:            { bg: '#FFFBEB', color: '#D97706' },
  s3:             { bg: '#FFF7ED', color: '#C2410C' },
  eks:            { bg: '#F0F9FF', color: '#0369A1' },
  dynamodb:       { bg: '#FDF4FF', color: '#A21CAF' },
  cloudfront:     { bg: '#ECFDF5', color: '#047857' },
  'api-gateway':  { bg: '#EFF6FF', color: '#1E40AF' },
  elasticache:    { bg: '#FFF7ED', color: '#9A3412' },
  aurora:         { bg: '#FFFBEB', color: '#92400E' },
  sqs:            { bg: '#FEF2F2', color: '#B91C1C' },
  sns:            { bg: '#FDF4FF', color: '#7E22CE' },
  'load-balancer':{ bg: '#F0FDF4', color: '#166534' },
  elb:            { bg: '#F0FDF4', color: '#166534' },
  vpc:            { bg: '#F8FAFC', color: '#475569' },
}

function typeStyle(t: string) {
  return TYPE_COLORS[t] ?? { bg: '#F8FAFC', color: '#64748B' }
}

export default function ServicesPage() {
  const [envFilter,      setEnvFilter]      = useState<string>('all')
  const [templateFilter, setTemplateFilter] = useState<string>('all')
  const [search,         setSearch]         = useState<string>('')
  const [showAll,        setShowAll]        = useState(false)
  const INITIAL_VISIBLE = 4
  const [isDiscovering,     setIsDiscovering]     = useState(false)
  const [discoveryComplete, setDiscoveryComplete] = useState(false)
  const [discoveryMsg,      setDiscoveryMsg]      = useState<string | null>(null)
  const [services,          setServices]          = useState<AWSService[]>([])
  const [stats,             setStats]             = useState<AWSServicesStats | null>(null)
  const [isLoading,         setIsLoading]         = useState(false)
  const [error,             setError]             = useState<string | null>(null)
  const [noAwsAccount,      setNoAwsAccount]      = useState(true)
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false)

  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const demoMode      = useDemoMode()
  const salesDemoMode = useSalesDemo((state) => state.enabled)
  const isDemoActive  = demoMode || salesDemoMode
  const { tier }      = usePlan()

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
      if (err.response?.status === 402) { setShowUpgradePrompt(true); return }
      try {
        const accounts = await awsAccountsService.getAccounts()
        if (accounts.length === 0) { setNoAwsAccount(true); setError(null) }
        else { setNoAwsAccount(false); setError(err.message || 'Failed to load services') }
      } catch { setNoAwsAccount(true); setError(null) }
    } finally { setIsLoading(false) }
  }, [isDemoActive, templateFilter, envFilter, search])

  useEffect(() => { fetchServices() }, [fetchServices])

  const handleSearchChange = (val: string) => {
    setSearch(val)
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(() => fetchServices(), 400)
  }

  const handleAutoDiscover = async () => {
    if (isDemoActive) {
      setIsDiscovering(true); setDiscoveryComplete(false)
      await new Promise(r => setTimeout(r, 2500))
      setIsDiscovering(false); setDiscoveryComplete(true)
      setTimeout(() => setDiscoveryComplete(false), 4000)
      return
    }
    setIsDiscovering(true); setDiscoveryComplete(false); setDiscoveryMsg(null)
    try {
      const result = await awsServicesService.discoverServices()
      setDiscoveryMsg(result.message); setDiscoveryComplete(true)
      setTimeout(() => { setDiscoveryComplete(false); setDiscoveryMsg(null) }, 6000)
      await fetchServices()
    } catch (err: any) {
      if (err.response?.status === 402) setShowUpgradePrompt(true)
      else setError(err.message || 'Discovery failed — check your AWS connection')
    } finally { setIsDiscovering(false) }
  }

  const allServices      = isDemoActive ? DEMO_SERVICES : services
  const displayStats     = isDemoActive ? DEMO_STATS    : stats
  const filteredServices = isDemoActive
    ? allServices.filter((s: any) => {
        const matchEnv  = envFilter      === 'all' || s.environment === envFilter
        const matchType = templateFilter === 'all' || s.type        === templateFilter
        const matchSrch = !search.trim() || s.name.toLowerCase().includes(search.toLowerCase())
        return matchEnv && matchType && matchSrch
      })
    : allServices

  const totalServices = displayStats?.total          ?? allServices.length
  const healthyCount  = displayStats?.healthy         ?? allServices.filter((s: any) => s.status === 'healthy').length
  const warningCount  = displayStats?.needs_attention ?? allServices.filter((s: any) => s.status !== 'healthy').length
  const avgUptime     = displayStats?.avg_uptime
    ?? (allServices.length > 0
      ? parseFloat((allServices.reduce((sum: number, s: any) => sum + (s.uptime || 0), 0) / allServices.length).toFixed(1))
      : null)
  const avgUptimeDisplay  = avgUptime != null ? `${avgUptime}%` : '—'
  const visibleServices   = showAll ? filteredServices : filteredServices.slice(0, INITIAL_VISIBLE)
  const totalMonthlyCost  = allServices.reduce((sum: number, s: any) => sum + (s.monthly_cost || 0), 0)
  const costDisplay       = '$' + totalMonthlyCost.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

  useEffect(() => { setShowAll(false) }, [envFilter, templateFilter, search])

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 max-w-[1320px] mx-auto font-sans">
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {/* ── PAGE HEADER ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-8">
        <div>
          <p className="text-[0.65rem] font-bold uppercase tracking-widest text-violet-600 mb-1">Services</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mb-1">Services Intelligence</h1>
          <p className="text-sm text-slate-500 leading-relaxed">Performance, cost, and risk across all services — real time.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleAutoDiscover}
            disabled={isDiscovering}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
              discoveryComplete
                ? 'bg-green-600 text-white border-green-600'
                : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
            } ${isDiscovering ? 'cursor-not-allowed opacity-70' : ''}`}
          >
            {isDiscovering
              ? <><RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} /> Scanning...</>
              : discoveryComplete
                ? <><Check size={13} /> {discoveryMsg ?? 'Complete'}</>
                : <><Scan size={13} /> Auto Discover</>
            }
          </button>
          <a
            href="/anomalies"
            className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 rounded-xl text-xs font-semibold transition-colors no-underline whitespace-nowrap"
          >
            <AlertTriangle size={13} />
            {warningCount > 0 ? 'Resolve At-Risk Services' : 'Add Service'}
          </a>
        </div>
      </div>

      {/* ── SYSTEM INTELLIGENCE STRIP ── */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-6 mb-4">
        {/* Mobile: stacked layout */}
        <div className="flex flex-col gap-4 sm:hidden">
          {/* Score + headline */}
          <div className="flex items-center gap-3">
            <div className="relative w-14 h-14 shrink-0">
              <svg width="54" height="54" viewBox="0 0 54 54">
                <circle cx="27" cy="27" r="23" fill="none" stroke="#F1F5F9" strokeWidth="5"/>
                <circle cx="27" cy="27" r="23" fill="none"
                  stroke={warningCount > 0 ? '#D97706' : '#059669'}
                  strokeWidth="5" strokeDasharray="144.5"
                  strokeDashoffset={warningCount > 0 ? 43 : 14}
                  strokeLinecap="round" transform="rotate(-90 27 27)"/>
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-slate-900">
                {warningCount > 0 ? 78 : 95}
              </span>
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-700 mb-1">Service Health Score</p>
              <p className="text-base font-bold text-slate-900 leading-tight">
                {warningCount > 0 ? 'Performance Risk Emerging' : 'All Systems Healthy'}
              </p>
              <p className="text-xs font-medium text-slate-500">{totalServices}/{totalServices} services · High confidence</p>
            </div>
          </div>
          {/* Stats row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-700 mb-1">At Risk</p>
              <p className="text-2xl font-bold text-red-600">{warningCount} <span className="text-sm text-slate-400 font-normal">of {totalServices}</span></p>
              <p className="text-xs text-slate-500">{isDemoActive ? '1 reliability · 1 cost' : warningCount > 0 ? 'Require review' : 'All healthy'}</p>
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-700 mb-1">Business Impact</p>
              <p className="text-sm font-bold text-slate-900 leading-tight">
                {isDemoActive ? 'Transaction flow at risk' : warningCount > 0 ? `${warningCount} at risk` : 'No impact detected'}
              </p>
              <p className={`text-xs font-semibold ${warningCount > 0 ? 'text-red-600' : 'text-green-600'}`}>
                {isDemoActive ? 'Payment degradation' : warningCount > 0 ? 'Review below' : 'All nominal'}
              </p>
            </div>
          </div>
          <a href="/ai-reports" className="text-xs font-bold text-violet-600 no-underline flex items-center gap-1">
            Full report <ArrowRight size={11} />
          </a>
        </div>

        {/* Desktop: horizontal layout */}
        <div className="hidden sm:flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-5 flex-wrap">
            {/* Score ring */}
            <div className="flex items-center gap-3">
              <div className="relative w-14 h-14 shrink-0">
                <svg width="54" height="54" viewBox="0 0 54 54">
                  <circle cx="27" cy="27" r="23" fill="none" stroke="#F1F5F9" strokeWidth="5"/>
                  <circle cx="27" cy="27" r="23" fill="none"
                    stroke={warningCount > 0 ? '#D97706' : '#059669'}
                    strokeWidth="5" strokeDasharray="144.5"
                    strokeDashoffset={warningCount > 0 ? 43 : 14}
                    strokeLinecap="round" transform="rotate(-90 27 27)"/>
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-slate-900">
                  {warningCount > 0 ? 78 : 95}
                </span>
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-slate-700 mb-1">Service Health Score</p>
                <p className="text-base font-bold text-slate-900">
                  {warningCount > 0 ? 'System Stable — Performance Risk Emerging in Production' : 'All Systems Healthy'}
                </p>
                <p className="text-xs font-medium text-slate-500">{totalServices}/{totalServices} services measured · High confidence</p>
              </div>
            </div>

            <div className="w-px h-11 bg-slate-200 shrink-0" />

            {/* Drivers */}
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-700 mb-1.5">Driven by</p>
              <div className="flex flex-col gap-0.5">
                {isDemoActive ? (
                  <>
                    <p className="text-sm text-red-600 font-semibold m-0">● Payment processor invocation spike (+178%)</p>
                    <p className="text-sm text-slate-700 font-medium m-0">● Analytics worker cost inefficiency detected</p>
                    <p className="text-sm text-slate-700 font-medium m-0">● {healthyCount} services operating within thresholds</p>
                  </>
                ) : warningCount > 0 ? (
                  <>
                    <p className="text-sm text-red-600 font-semibold m-0">● {warningCount} service{warningCount !== 1 ? 's' : ''} requiring attention</p>
                    <p className="text-sm text-slate-700 font-medium m-0">● {healthyCount} services operating within thresholds</p>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-green-600 font-semibold m-0">● All {totalServices} services operating within thresholds</p>
                    <p className="text-sm text-slate-700 font-medium m-0">● Average uptime {avgUptimeDisplay}</p>
                  </>
                )}
              </div>
            </div>

            <div className="w-px h-11 bg-slate-200 shrink-0" />

            {/* Business impact */}
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-700 mb-1">Business Impact</p>
              <p className="text-sm font-bold text-slate-900 mb-0.5">
                {isDemoActive ? 'Transaction flow at risk · $864 cost increase' : warningCount > 0 ? `${warningCount} service${warningCount !== 1 ? 's' : ''} at risk` : 'No active business impact detected'}
              </p>
              <p className={`text-xs font-semibold m-0 ${warningCount > 0 ? 'text-red-600' : 'text-green-600'}`}>
                {isDemoActive ? 'Payment processing degradation — user-facing' : warningCount > 0 ? 'Review highlighted services below' : 'All systems nominal'}
              </p>
            </div>

            <div className="w-px h-11 bg-slate-200 shrink-0" />

            {/* At risk */}
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-red-600 mb-1">At Risk</p>
              <p className="text-2xl font-bold text-red-600 mb-0.5">{warningCount} of {totalServices}</p>
              <p className="text-xs font-medium text-slate-500 m-0">
                {isDemoActive ? '1 reliability · 1 cost inefficiency' : warningCount > 0 ? 'Require immediate review' : 'All services healthy'}
              </p>
            </div>
          </div>
          <a href="/ai-reports" className="text-[11px] font-bold text-violet-600 no-underline flex items-center gap-1 whitespace-nowrap shrink-0">
            Full report <ArrowRight size={11} />
          </a>
        </div>
      </div>

      {/* ── UPGRADE PROMPT ── */}
      {showUpgradePrompt && (
        <div className="flex items-center justify-between bg-amber-50 border border-amber-400 rounded-xl px-5 py-3.5 mb-6 gap-4 flex-wrap">
          <div className="flex items-center gap-2.5">
            <span className="text-lg">⚠️</span>
            <span className="text-sm font-medium text-amber-900">
              You've reached your service limit on the <strong>{tier}</strong> plan. Upgrade to monitor more services.
            </span>
          </div>
          <a href="/settings/billing/upgrade" className="shrink-0 text-xs font-semibold text-white bg-amber-500 hover:bg-amber-600 rounded-lg px-4 py-2 no-underline whitespace-nowrap transition-colors">
            Upgrade plan
          </a>
        </div>
      )}

      {/* ── ERROR BANNER ── */}
      {error && !noAwsAccount && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-3 mb-5">
          <p className="text-sm text-red-600 m-0">Failed to load services — check your AWS connection</p>
        </div>
      )}

      {/* ── IMMEDIATE ACTION BANNER ── */}
      {warningCount > 0 && (
        <div className="bg-red-50 border-2 border-red-600 rounded-2xl p-4 sm:px-6 sm:py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <div>
            <p className="text-red-600 text-[10px] font-bold tracking-widest uppercase mb-1">Immediate Action Required</p>
            <p className="text-red-900 text-base font-semibold mb-2">
              {warningCount} production service{warningCount !== 1 ? 's' : ''} at risk — potential downtime &amp; revenue impact
            </p>
            <div className="flex gap-1.5 flex-wrap">
              {['Revenue disruption risk', 'SLA breach risk', 'Fix in < 5 min'].map(pill => (
                <span key={pill} className="bg-white border border-red-200 rounded-full px-3 py-0.5 text-[11px] text-red-800">{pill}</span>
              ))}
            </div>
          </div>
          <a href="/anomalies" className="bg-red-600 hover:bg-red-700 text-white rounded-xl px-5 py-2.5 text-sm font-semibold no-underline whitespace-nowrap shrink-0 transition-colors">
            Resolve All Critical Issues
          </a>
        </div>
      )}

      {/* ── EXECUTIVE SUMMARY STRIP ── */}
      <div className="bg-white border border-gray-100 rounded-xl px-4 sm:px-5 py-3 mb-4">
        {/* Mobile: 2x2 grid */}
        <div className="grid grid-cols-2 gap-2 sm:hidden text-sm">
          <div><span className="text-slate-500 font-medium">Cost: </span>
            {totalMonthlyCost > 0
              ? <span className="font-bold text-slate-900">{costDisplay}</span>
              : <span className="text-slate-400">Syncing...</span>}
          </div>
          <div><span className="text-slate-500 font-medium">At risk: </span><span className="font-bold text-red-600">{warningCount}</span></div>
          <div><span className="text-slate-500 font-medium">Health: </span><span className="font-medium text-slate-900">{warningCount > 0 ? 'Degraded' : 'Stable'}</span></div>
          <div><span className="text-slate-500 font-medium">Monitored: </span><span className="font-medium text-slate-900">{totalServices}</span></div>
        </div>
        {/* Desktop: inline */}
        <div className="hidden sm:flex items-center justify-between">
          <div className="flex items-center">
            <span className="text-sm font-medium text-slate-500">
              Total cost: {totalMonthlyCost > 0
                ? <span className="text-slate-900 font-bold">{costDisplay}</span>
                : <span className="text-slate-400 font-medium">Syncing...</span>}
            </span>
            <span className="w-px h-3.5 bg-slate-200 mx-4 inline-block" />
            <span className="text-sm font-medium text-slate-500">Services at risk: <span className="text-red-600 font-bold">{warningCount}</span></span>
            <span className="w-px h-3.5 bg-slate-200 mx-4 inline-block" />
            <span className="text-sm font-medium text-slate-500">System health: <span className="text-slate-900 font-medium">{warningCount > 0 ? 'Degraded' : 'Stable'}</span></span>
            <span className="w-px h-3.5 bg-slate-200 mx-4 inline-block" />
            <span className="text-sm font-medium text-slate-500">{totalServices} services monitored</span>
          </div>
          {warningCount > 0 && (
            <span className="text-red-600 text-xs font-semibold">Recommended: Resolve {warningCount} critical service{warningCount !== 1 ? 's' : ''} now</span>
          )}
        </div>
      </div>

      {/* ── 4 KPI CARDS ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5 mb-8">
        <div className={`bg-white rounded-xl p-5 border border-slate-200 ${isLoading && !isDemoActive ? 'opacity-60' : ''}`}>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-700 mb-3">Total Services</p>
          <div className="text-4xl font-bold text-slate-900 leading-none mb-1">{isLoading && !isDemoActive ? '…' : totalServices}</div>
          <p className="text-slate-500 text-xs font-medium m-0">Registered across all environments</p>
        </div>

        <div className={`bg-white rounded-xl p-5 border border-slate-200 ${isLoading && !isDemoActive ? 'opacity-60' : ''}`}>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-700 mb-3">Healthy</p>
          <div className="text-4xl font-bold text-green-600 leading-none mb-1">{isLoading && !isDemoActive ? '…' : healthyCount}</div>
          <p className="text-slate-500 text-xs font-medium m-0">Operating within thresholds</p>
        </div>

        <div className={`bg-white rounded-xl p-5 border border-slate-200 ${isLoading && !isDemoActive ? 'opacity-60' : ''}`}>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-700 mb-3">At Risk</p>
          <div className="text-4xl font-bold text-red-600 leading-none mb-1">{isLoading && !isDemoActive ? '…' : warningCount}</div>
          <p className="text-slate-500 text-xs font-medium m-0">
            {isDemoActive ? '1 reliability · 1 cost inefficiency · both in production' : warningCount > 0 ? `${warningCount} at risk — affecting production services` : 'No services at risk'}
          </p>
          {warningCount > 0 && <p className="text-xs font-semibold text-red-600 mt-1 m-0">Resolve now →</p>}
        </div>

        <div className={`bg-white rounded-xl p-5 border border-slate-200 ${isLoading && !isDemoActive ? 'opacity-60' : ''}`}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-700 m-0">Monthly Cost</p>
            <span className="text-[9px] font-bold text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded uppercase tracking-wide">Partial</span>
          </div>
          <div className="text-3xl font-bold text-slate-900 leading-none mb-1">{isLoading && !isDemoActive ? '…' : '$11,444'}</div>
          <p className="text-slate-500 text-xs font-medium m-0">Aggregate · breakdown in progress</p>
        </div>
      </div>

      {/* ── AI INSIGHT ── */}
      <div className="bg-violet-50 rounded-xl p-4 sm:p-5 border border-violet-200 mb-5 flex items-start gap-3.5">
        <div className="w-7 h-7 rounded-lg bg-violet-600 flex items-center justify-center shrink-0 mt-0.5">
          <Sparkles size={12} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-violet-600 text-[10px] font-bold tracking-widest uppercase mb-1">AI Insight</p>
          <p className="text-sm text-slate-900 font-semibold leading-relaxed mb-1">
            {isDemoActive
              ? <><strong className="text-red-600">Payment Processor</strong> showing Lambda invocation spike (+178%) — likely retry loop driving <strong className="text-red-600">$864 cost increase</strong> this month.</>
              : totalServices === 0
                ? 'Connect AWS to unlock real-time cost insights, security risks, and performance signals.'
                : warningCount > 0
                  ? <>{warningCount} service{warningCount > 1 ? 's' : ''} showing early degradation signals. No current outage risk, but performance instability detected.</>
                  : <>{totalServices} services running with {avgUptimeDisplay} average uptime. No active issues.</>
            }
          </p>
          <p className="text-xs text-slate-500 font-medium m-0">
            {isDemoActive
              ? '17 of 19 services operating within thresholds · no new issues in last 24h.'
              : warningCount > 0
                ? `Review highlighted services below — ${healthyCount} of ${totalServices} operating normally.`
                : totalServices > 0 ? 'System is healthy — no action required.' : ''
            }
          </p>
        </div>
        {warningCount > 0 && (
          <a href="/anomalies" className="text-xs font-semibold text-violet-600 no-underline shrink-0 flex items-center gap-1 whitespace-nowrap hidden sm:flex">
            Resolve before impact occurs →
          </a>
        )}
      </div>

      {/* ── PRIORITY ACTIONS ── */}
      {(isDemoActive || warningCount > 0) && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 mb-5">
          <div className="flex items-start justify-between mb-4 gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-700 mb-1">Priority Actions</p>
              <p className="text-sm text-slate-500 m-0">Ranked by impact · {isDemoActive ? '2 services at risk in production' : `${warningCount} service${warningCount !== 1 ? 's' : ''} at risk`}</p>
            </div>
            <span className="inline-flex bg-violet-50 text-violet-600 border border-violet-200 rounded-full px-3 py-1 text-[11px] font-semibold shrink-0">Action required</span>
          </div>
          <div className="flex flex-col gap-2.5">
            {isDemoActive ? (
              <>
                {/* Demo Priority 1 */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-4 sm:p-5 bg-red-50 rounded-xl border-2 border-red-200 gap-3">
                  <div className="flex items-start gap-3.5">
                    <div className="text-center min-w-[40px]">
                      <p className="text-[10px] font-bold text-red-600 uppercase mb-0.5">Priority</p>
                      <p className="text-2xl font-bold text-red-600 m-0">1</p>
                    </div>
                    <div className="w-px h-10 bg-red-200 shrink-0 hidden sm:block" />
                    <div>
                      <p className="text-sm font-semibold text-slate-900 mb-1">
                        Payment Processor (Lambda) — <span className="text-red-600">invocation spike +178%</span>
                      </p>
                      <p className="text-xs text-slate-600 font-medium mb-1">Staging · us-west-2 · retry loop suspected · $864 cost increase · user-facing transaction risk</p>
                      <p className="text-red-800 text-[11px] font-medium m-0">Potential impact: Revenue disruption · SLA breach risk</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 flex-wrap">
                    <span className="px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase bg-red-600 text-white">High</span>
                    <span className="px-2 py-0.5 rounded text-[9.5px] font-bold uppercase bg-red-100 text-red-800">Reliability</span>
                    <a href="/anomalies" className="bg-violet-600 hover:bg-violet-700 text-white rounded-lg px-4 py-2 text-xs font-semibold no-underline transition-colors">Resolve Issue →</a>
                  </div>
                </div>
                {/* Demo Priority 2 */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-3.5 sm:p-4 bg-amber-50 rounded-xl border border-amber-200 gap-3">
                  <div className="flex items-start gap-3.5">
                    <div className="text-center min-w-[40px]">
                      <p className="text-[10px] font-bold text-amber-600 uppercase mb-0.5">Priority</p>
                      <p className="text-lg font-bold text-amber-600 m-0">2</p>
                    </div>
                    <div className="w-px h-8 bg-amber-200 shrink-0 hidden sm:block" />
                    <div>
                      <p className="text-sm font-semibold text-slate-900 mb-1">
                        Analytics Worker (EC2) — <span className="text-amber-600">cost inefficiency detected</span>
                      </p>
                      <p className="text-xs text-slate-500 m-0">Production · eu-west-1 · over-provisioned · non-critical · recoverable savings available</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 flex-wrap">
                    <span className="px-2 py-0.5 rounded text-[9.5px] font-bold uppercase bg-amber-100 text-amber-800">Medium</span>
                    <span className="px-2 py-0.5 rounded text-[9.5px] font-bold uppercase bg-amber-100 text-amber-800">Cost Waste</span>
                    <a href="/cost-optimization" className="bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-semibold no-underline transition-colors">Review Impact →</a>
                  </div>
                </div>
              </>
            ) : (
              allServices
                .filter((s: any) => s.status !== 'healthy')
                .map((svc: any, i: number) => (
                  <div key={svc.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-4 sm:p-5 bg-red-50 rounded-xl border-2 border-red-200 gap-3">
                    <div className="flex items-start gap-3.5">
                      <div className="text-center min-w-[40px]">
                        <p className="text-[10px] font-bold text-red-600 uppercase mb-0.5">Priority</p>
                        <p className="text-2xl font-bold text-red-600 m-0">{i + 1}</p>
                      </div>
                      <div className="w-px h-10 bg-red-200 shrink-0 hidden sm:block" />
                      <div>
                        <p className="text-sm font-semibold text-slate-900 mb-1">
                          {svc.name} ({(svc.type as string)?.toUpperCase()}) — <span className="text-red-600">at risk</span>
                        </p>
                        <p className="text-xs text-slate-600 font-medium mb-1">{svc.environment} · {svc.region || 'us-east-1'} · uptime {svc.uptime}%</p>
                        <p className="text-red-800 text-[11px] font-medium m-0">Potential impact: Revenue disruption · SLA breach risk</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 flex-wrap">
                      <span className="px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase bg-red-600 text-white">High</span>
                      <a href={`/anomalies?service=${svc.name}`} className="bg-violet-600 hover:bg-violet-700 text-white rounded-lg px-4 py-2 text-xs font-semibold no-underline transition-colors">Resolve Issue →</a>
                    </div>
                  </div>
                ))
            )}
          </div>
        </div>
      )}

      {/* ── QUICK NAV ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 mb-8">
        {[
          { icon: Rocket,    label: 'Deployments',  desc: 'Deployment history and tracking', href: '/deployments',  color: '#7C3AED', bg: '#F5F3FF' },
          { icon: GitBranch, label: 'Dependencies', desc: 'Service dependency map',          href: '/dependencies', color: '#059669', bg: '#F0FDF4' },
          { icon: Activity,  label: 'Status Page',  desc: 'Live system status',              href: '/status',       color: '#0EA5E9', bg: '#F0F9FF' },
        ].map(({ icon: Icon, label, desc, href, color, bg }) => (
          <a key={href} href={href} className="no-underline group">
            <div className="bg-white rounded-xl px-5 py-4 border border-slate-100 flex items-center gap-3.5 transition-all group-hover:border-violet-300 group-hover:shadow-md">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: bg }}>
                <Icon size={16} style={{ color }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-900 mb-0.5">{label}</p>
                <p className="text-xs text-slate-500 m-0">{desc}</p>
              </div>
              <ArrowRight size={14} className="text-slate-400 shrink-0" />
            </div>
          </a>
        ))}
      </div>

      {/* ── SERVICES TABLE / CARDS ── */}
      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">

        {/* Table header */}
        <div className="px-5 sm:px-7 py-5 border-b border-slate-100">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-0.5">All Services</p>
              <p className="text-xs text-slate-400 m-0">{filteredServices.length} of {totalServices} services</p>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <input
                type="text"
                placeholder="Search services…"
                value={search}
                onChange={e => handleSearchChange(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-900 bg-slate-50 outline-none w-full sm:w-44"
              />
              <div className="flex bg-slate-50 rounded-lg p-1 gap-0.5">
                {['all', 'production', 'staging'].map(f => (
                  <button key={f} onClick={() => setEnvFilter(f)}
                    className={`px-3 py-1 rounded-md text-xs font-semibold border-none cursor-pointer capitalize transition-all ${
                      envFilter === f ? 'bg-white text-slate-900 shadow-sm' : 'bg-transparent text-slate-500'
                    }`}>
                    {f === 'all' ? 'All Envs' : f}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {/* Type chips */}
          <div className="flex gap-1.5 flex-wrap">
            {RESOURCE_TYPE_CHIPS.map(t => (
              <button key={t} onClick={() => setTemplateFilter(t)}
                className={`px-3 py-1 rounded-full text-xs font-semibold border-none cursor-pointer transition-all ${
                  templateFilter === t ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}>
                {TYPE_DISPLAY[t] ?? t}
              </button>
            ))}
          </div>
        </div>

        {/* Desktop column headers */}
        <div className="hidden sm:grid sm:grid-cols-[2fr_110px_130px_110px_100px_110px_80px] px-7 py-2.5 bg-slate-50 border-b border-slate-100">
          {['Service', 'Type', 'Environment', 'Status', 'Uptime', 'Monthly Cost', ''].map(col => (
            <span key={col} className="text-[11px] font-bold text-slate-600 uppercase tracking-widest">{col}</span>
          ))}
        </div>

        {/* Content */}
        {isLoading && !isDemoActive ? (
          <div className="px-7 py-12 text-center">
            <RefreshCw size={20} className="text-slate-400 mx-auto mb-3" style={{ animation: 'spin 1s linear infinite' }} />
            <p className="text-sm text-slate-500 m-0">Loading services...</p>
          </div>
        ) : filteredServices.length === 0 ? (
          <div className="px-5 sm:px-12 py-12 text-center">
            <div className="w-12 h-12 rounded-xl bg-slate-50 flex items-center justify-center mx-auto mb-4">
              <Layers size={22} className="text-slate-400" />
            </div>
            <p className="text-base font-semibold text-slate-900 mb-1.5">Connect AWS to See What's Costing You Money</p>
            <p className="text-sm text-slate-500 mb-7 leading-relaxed max-w-md mx-auto">Secure read-only access — no changes made to your infrastructure.</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-lg mx-auto mb-7 text-left">
              {[
                { step: '1', title: 'Connect AWS',       desc: 'Secure read-only access — no changes made to your infrastructure', color: '#7C3AED' },
                { step: '2', title: 'Discover Services', desc: 'Automatically map your infrastructure, costs, and dependencies',    color: '#059669' },
                { step: '3', title: 'Monitor & Act',     desc: 'Uncover cost waste, security gaps, and performance risks instantly', color: '#0EA5E9' },
              ].map(({ step, title, desc, color }) => (
                <div key={step} className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center mb-2.5" style={{ background: color }}>
                    <span className="text-[11px] font-bold text-white">{step}</span>
                  </div>
                  <p className="text-xs font-semibold text-slate-900 mb-1">{title}</p>
                  <p className="text-xs text-slate-500 m-0 leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-3 justify-center flex-wrap">
              {noAwsAccount ? (
                <a href="/connect-aws" className="bg-violet-600 hover:bg-violet-700 text-white px-6 py-2.5 rounded-lg text-sm font-semibold no-underline inline-flex items-center gap-2 transition-colors">
                  Connect AWS Account →
                </a>
              ) : (
                <button onClick={handleAutoDiscover} className="bg-violet-600 hover:bg-violet-700 text-white px-6 py-2.5 rounded-lg text-sm font-semibold border-none cursor-pointer inline-flex items-center gap-2 transition-colors">
                  <Scan size={14} /> Auto Discover
                </button>
              )}
              <a href="/services/new" className="bg-white hover:bg-slate-50 text-slate-600 px-6 py-2.5 rounded-lg text-sm font-medium border border-slate-200 no-underline inline-flex items-center gap-2 transition-colors">
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
            const svcName     = svc.name.split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')

            return (
              <div key={svc.id} className={`border-b border-slate-50 last:border-b-0 transition-colors ${isAtRisk ? 'bg-amber-50 hover:bg-amber-100/70' : 'bg-white hover:bg-slate-50'}`}>

                {/* Mobile card layout */}
                <div className="sm:hidden px-5 py-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-900 mb-0.5 truncate">{svcName} ({(svc.type as string)?.toUpperCase()})</p>
                      {isAtRisk ? (
                        <p className="text-xs font-semibold m-0" style={{ color: svc.status === 'critical' ? '#DC2626' : '#D97706' }}>
                          {isDemoActive ? 'Lambda invocation spike detected (+178%)' : `${svc.name} at risk · check anomalies`}
                        </p>
                      ) : svc.last_deployed ? (
                        <p className="text-xs text-slate-400 m-0">
                          Last synced {new Date(svc.last_deployed).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <div className="w-1.5 h-1.5 rounded-full" style={{ background: statusColor }} />
                      <span className="text-xs font-semibold" style={{ color: isAtRisk ? statusColor : '#059669' }}>
                        {isAtRisk ? (svc.status === 'critical' ? 'Critical' : 'At Risk') : 'Healthy'}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-700">
                      {TYPE_DISPLAY[svc.type] ?? svc.type?.toUpperCase() ?? '—'}
                    </span>
                    <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full" style={{ background: envBg, color: envColor }}>
                      {svc.environment}
                    </span>
                    {svc.uptime && <span className="text-xs text-slate-500">{svc.uptime}% uptime</span>}
                    {svc.monthly_cost && <span className="text-xs text-slate-500">${svc.monthly_cost.toLocaleString()}/mo</span>}
                    <a
                      href={isAtRisk ? `/anomalies?service=${svc.name}` : `/services/${svc.id}`}
                      className="ml-auto text-xs font-semibold text-violet-600 no-underline flex items-center gap-1"
                    >
                      {isAtRisk ? 'Investigate' : 'View'} <ArrowRight size={11} />
                    </a>
                  </div>
                </div>

                {/* Desktop row layout */}
                <div className="hidden sm:grid sm:grid-cols-[2fr_110px_130px_110px_100px_110px_80px] items-center px-7 py-4">
                  <div>
                    <p className="text-sm font-semibold text-slate-900 mb-0.5">{svcName} ({(svc.type as string)?.toUpperCase()})</p>
                    {isAtRisk ? (
                      <p className="text-xs font-semibold m-0" style={{ color: svc.status === 'critical' ? '#DC2626' : '#D97706' }}>
                        {isDemoActive ? 'Lambda invocation spike detected (+178%) · retry loop suspected' : `${svc.name} at risk · check recent deployments and anomalies`}
                      </p>
                    ) : svc.last_deployed ? (
                      <p className="text-xs text-slate-400 m-0">
                        Last synced {new Date(svc.last_deployed).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    ) : null}
                  </div>
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md w-fit" style={{ background: tc.bg, color: tc.color }}>
                    {TYPE_DISPLAY[svc.type] ?? svc.type?.toUpperCase() ?? '—'}
                  </span>
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full w-fit" style={{ background: envBg, color: envColor }}>
                    {svc.environment}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: statusColor }} />
                    <span className="text-sm font-semibold" style={{ color: isAtRisk ? statusColor : '#059669' }}>
                      {isAtRisk ? (svc.status === 'critical' ? 'Critical' : 'At Risk') : 'Healthy'}
                    </span>
                  </div>
                  <span className="text-sm font-semibold text-slate-900">{svc.uptime ? `${svc.uptime}%` : '—'}</span>
                  <span className="text-sm text-slate-400 italic">{svc.monthly_cost ? `$${svc.monthly_cost.toLocaleString()}` : '—'}</span>
                  <a
                    href={isAtRisk ? `/anomalies?service=${svc.name}` : `/services/${svc.id}`}
                    className="text-xs font-semibold text-violet-600 no-underline flex items-center gap-1"
                  >
                    {isAtRisk ? 'Investigate' : 'View'} <ArrowRight size={12} />
                  </a>
                </div>
              </div>
            )
          })
        )}

        {/* Show more/less */}
        {filteredServices.length > INITIAL_VISIBLE && (
          <div className="text-center py-3.5 border-t border-slate-100">
            <button
              onClick={() => setShowAll(prev => !prev)}
              className="text-sm text-violet-700 bg-transparent border-none cursor-pointer inline-flex items-center gap-1.5 font-medium hover:text-violet-900 transition-colors"
            >
              {showAll ? `Show less ↑` : `See all ${filteredServices.length} services ↓`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}