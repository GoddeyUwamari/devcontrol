'use client'

import { useState, useEffect, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Rocket, GitBranch, Activity, ArrowRight, Layers, RefreshCw, Sparkles, Check, Scan, AlertTriangle, SearchX, Search, ChevronDown, ChevronUp, CheckCircle2 } from 'lucide-react'
import { useDemoMode } from '@/components/demo/demo-mode-toggle'
import { useSalesDemo } from '@/lib/demo/sales-demo-data'
import awsServicesService, { AWSService, AWSServicesStats } from '@/lib/services/aws-services.service'
import awsAccountsService from '@/lib/services/aws-accounts.service'
import { usePlan } from '@/lib/hooks/use-plan'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SeverityBadge } from '@/components/ui/severity-badge'

const _now = Date.now()

const DEMO_SERVICES: AWSService[] = [
  { id: '1', name: 'api-gateway',         environment: 'production', region: 'us-east-1', status: 'healthy', type: 'ecs',    uptime: 99.9, lastDeployed: new Date(_now - 1000 * 60 * 45).toISOString(),         owner: 'sarah.chen',   team: 'Platform Team',  monthly_cost: null, metadata: {}, priority_severity: null,   needs_attention: false, reason: null } as any,
  { id: '2', name: 'auth-service',         environment: 'production', region: 'us-east-1', status: 'healthy', type: 'ecs',    uptime: 99.7, lastDeployed: new Date(_now - 1000 * 60 * 120).toISOString(),        owner: 'mike.johnson', team: 'Auth Team',      monthly_cost: null, metadata: {}, priority_severity: null,   needs_attention: false, reason: null } as any,
  { id: '3', name: 'payment-processor',    environment: 'staging',    region: 'us-west-2', status: 'warning', type: 'lambda', uptime: 98.2, lastDeployed: new Date(_now - 1000 * 60 * 5).toISOString(),           owner: 'alex.wong',    team: 'Payments Team',  monthly_cost: null, metadata: {}, priority_severity: 'high',   needs_attention: true,  reason: 'Lambda invocation spike detected (+178%) · retry loop suspected' } as any,
  { id: '4', name: 'notification-service', environment: 'production', region: 'us-east-1', status: 'healthy', type: 'lambda', uptime: 99.9, lastDeployed: new Date(_now - 1000 * 60 * 60 * 6).toISOString(),      owner: 'emma.davis',   team: 'Platform Team',  monthly_cost: null, metadata: {}, priority_severity: null,   needs_attention: false, reason: null } as any,
  { id: '5', name: 'analytics-worker',     environment: 'production', region: 'eu-west-1', status: 'healthy', type: 'ec2',    uptime: 99.5, lastDeployed: new Date(_now - 1000 * 60 * 60 * 24).toISOString(),     owner: 'david.kim',    team: 'Data Team',      monthly_cost: 623.4, metadata: {}, priority_severity: 'medium', needs_attention: true,  reason: 'Cost inefficiency detected — over-provisioned' } as any,
]

const DEMO_STATS: AWSServicesStats = { total: 5, healthy: 3, needs_attention: 2, avg_uptime: 99.4 }

// Sort rank for the merged severity scale — critical first. Any resource
// without a priority_severity is healthy and sorts after all of these.
const SEVERITY_SORT_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
const SEVERITY_LABEL: Record<string, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' }

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

// Shared row used by both the Needs Attention list and the expanded Healthy
// group — same shape either way: severity badge (when flagged), name +
// reason/last-synced, type badge, environment badge, cost, view link.
function ServiceRow({ svc }: { svc: any }) {
  const tc         = typeStyle(svc.type)
  const svcName    = svc.name.split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  const envColor   = svc.environment === 'production' ? '#059669' : svc.environment === 'staging' ? '#D97706' : '#64748B'
  const envBg      = svc.environment === 'production' ? '#F0FDF4' : svc.environment === 'staging' ? '#FFFBEB' : '#F8FAFC'

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-4 sm:px-5 py-3.5 border-b border-slate-50 last:border-b-0 transition-colors hover:bg-slate-50">
      {svc.priority_severity && (
        <div className="shrink-0">
          <SeverityBadge severity={svc.priority_severity} label={SEVERITY_LABEL[svc.priority_severity]} />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-900 mb-0.5 truncate">{svcName}</p>
        {svc.reason ? (
          <p className="text-xs font-medium m-0 truncate text-slate-500">{svc.reason}</p>
        ) : svc.last_deployed ? (
          <p className="text-xs text-slate-400 m-0 truncate">
            Last synced {new Date(svc.last_deployed).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </p>
        ) : null}
      </div>
      <div className="flex items-center gap-2 shrink-0 flex-wrap">
        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md" style={{ background: tc.bg, color: tc.color }}>
          {TYPE_DISPLAY[svc.type] ?? svc.type?.toUpperCase() ?? '—'}
        </span>
        <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full" style={{ background: envBg, color: envColor }}>
          {svc.environment}
        </span>
        <span className="text-xs text-slate-500 w-16 text-right tabular-nums">
          {svc.monthly_cost !== null && svc.monthly_cost !== undefined ? `$${svc.monthly_cost.toLocaleString()}` : '—'}
        </span>
        <a
          href={svc.needs_attention ? `/anomalies?service=${svc.name}` : `/services/${svc.id}`}
          className="text-xs font-semibold text-violet-600 no-underline flex items-center gap-1 whitespace-nowrap"
        >
          View <ArrowRight size={11} />
        </a>
      </div>
    </div>
  )
}

export default function ServicesPage() {
  const queryClient = useQueryClient()
  const [envFilter,      setEnvFilter]      = useState<string>('all')
  const [templateFilter, setTemplateFilter] = useState<string>('all')
  const [search,         setSearch]         = useState<string>('')
  const [debouncedSearch, setDebouncedSearch] = useState<string>('')
  const [onlyNeedsAttention, setOnlyNeedsAttention] = useState(false)
  const [healthyExpanded,    setHealthyExpanded]    = useState(false)
  const [costSort,           setCostSort]           = useState<'asc' | 'desc' | null>(null)
  const [isDiscovering,     setIsDiscovering]     = useState(false)
  const [discoveryComplete, setDiscoveryComplete] = useState(false)
  const [discoveryMsg,      setDiscoveryMsg]      = useState<string | null>(null)
  const [services,          setServices]          = useState<AWSService[]>([])
  const [stats,             setStats]             = useState<AWSServicesStats | null>(null)
  const [isLoading,         setIsLoading]         = useState(false)
  const [error,             setError]             = useState<string | null>(null)
  const [noAwsAccount,      setNoAwsAccount]      = useState(true)
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false)

  const demoMode      = useDemoMode()
  const salesDemoMode = useSalesDemo((state) => state.enabled)
  const isDemoActive  = demoMode || salesDemoMode
  const { tier }      = usePlan()

  // Determines whether an AWS account is connected at all — independent of the
  // current type/env/search filter, since a filtered-to-zero result set must
  // never be mistaken for "nothing connected."
  const checkAwsConnection = useCallback(async () => {
    if (isDemoActive) return
    try {
      const accounts = await awsAccountsService.getAccounts()
      setNoAwsAccount(accounts.length === 0)
    } catch {
      // Leave noAwsAccount as-is; fetchServices' error path covers this too.
    }
  }, [isDemoActive])

  useEffect(() => { checkAwsConnection() }, [checkAwsConnection])

  // Debounce the raw input into a separate committed value, rather than
  // scheduling a delayed fetchServices() call directly — a setTimeout that
  // calls fetchServices() captures whatever `search` was in scope at the
  // moment it was scheduled. If the user then changes the input again before
  // that timer fires, the stale closure still fires ~400ms later with the
  // OLD search term and silently overwrites the correct, fresher results.
  // Debouncing the state instead means fetchServices always reads the latest
  // committed value, and there's no closure to go stale.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400)
    return () => clearTimeout(t)
  }, [search])

  const fetchServices = useCallback(async () => {
    if (isDemoActive) return
    setIsLoading(true)
    setError(null)
    try {
      const [svcs, st] = await Promise.all([
        awsServicesService.getServices({
          type:   templateFilter !== 'all' ? templateFilter  : undefined,
          env:    envFilter      !== 'all' ? envFilter       : undefined,
          search: debouncedSearch.trim()   || undefined,
        }),
        awsServicesService.getStats(),
      ])
      setServices(svcs)
      setStats(st)
      // Do NOT infer connection status from a successful-but-empty result here —
      // an empty aws_resources table returns success for both a never-connected
      // org and a connected-but-zero-matches filter. noAwsAccount is decided
      // solely by checkAwsConnection() (an explicit aws_accounts lookup) and by
      // totalServices > 0 (see isAwsConnected below), never by this fetch alone.
    } catch (err: any) {
      if (err.response?.status === 402) { setShowUpgradePrompt(true); return }
      try {
        const accounts = await awsAccountsService.getAccounts()
        if (accounts.length === 0) { setNoAwsAccount(true); setError(null) }
        else { setNoAwsAccount(false); setError(err.message || 'Failed to load services') }
      } catch { setNoAwsAccount(true); setError(null) }
    } finally { setIsLoading(false) }
  }, [isDemoActive, templateFilter, envFilter, debouncedSearch])

  useEffect(() => { fetchServices() }, [fetchServices])

  const handleSearchChange = (val: string) => {
    setSearch(val)
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
      // A scan can flip compliance_scan_completed, which changes isPreliminary —
      // without this, the security score (dashboard/security pages) stays on its
      // pre-scan cached value for up to staleTime (5 min).
      queryClient.invalidateQueries({ queryKey: ['risk-score-trend'] })
      queryClient.invalidateQueries({ queryKey: ['risk-score-current'] })
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
  const servicesWithUptime = allServices.filter((s: any) => s.uptime != null)
  const avgUptime     = displayStats?.avg_uptime
    ?? (servicesWithUptime.length > 0
      ? parseFloat((servicesWithUptime.reduce((sum: number, s: any) => sum + s.uptime, 0) / servicesWithUptime.length).toFixed(1))
      : null)
  const avgUptimeDisplay  = avgUptime != null ? `${avgUptime}%` : '—'
  const totalMonthlyCost  = allServices.reduce((sum: number, s: any) => sum + (s.monthly_cost || 0), 0)
  const costDisplay       = '$' + totalMonthlyCost.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

  // "Needs attention" quick-filter chip narrows the already type/env/search-
  // filtered set further — a separate dimension, not folded into fetchServices.
  const visibleFilteredServices = onlyNeedsAttention
    ? filteredServices.filter((s: any) => s.needs_attention)
    : filteredServices

  // Priority-sorted: critical first, then cost descending as tiebreaker —
  // fixed order, not user-sortable (unlike the healthy group below).
  const needsAttentionSorted = visibleFilteredServices
    .filter((s: any) => s.needs_attention)
    .sort((a: any, b: any) => {
      const ra = SEVERITY_SORT_RANK[a.priority_severity as string] ?? 4
      const rb = SEVERITY_SORT_RANK[b.priority_severity as string] ?? 4
      if (ra !== rb) return ra - rb
      return (b.monthly_cost ?? 0) - (a.monthly_cost ?? 0)
    })

  const healthyFiltered = visibleFilteredServices.filter((s: any) => !s.needs_attention)
  const healthySorted   = costSort
    ? [...healthyFiltered].sort((a: any, b: any) =>
        costSort === 'asc' ? (a.monthly_cost ?? 0) - (b.monthly_cost ?? 0) : (b.monthly_cost ?? 0) - (a.monthly_cost ?? 0)
      )
    : [...healthyFiltered].sort((a: any, b: any) => a.name.localeCompare(b.name))

  const toggleCostSort = () => setCostSort(prev => prev === 'desc' ? 'asc' : prev === 'asc' ? null : 'desc')

  // Connection status — deliberately independent of the current type/env/search
  // filter, so filtering to zero matches can never be mistaken for "AWS not
  // connected." True when there's a connected account OR any resources have
  // ever synced (totalServices comes from the unfiltered /services/stats call).
  const isAwsConnected    = isDemoActive || !noAwsAccount || totalServices > 0
  const activeFilterLabel = templateFilter !== 'all' ? TYPE_DISPLAY[templateFilter] : null
  // A "needs attention" filter turning up zero results is good news, not a
  // dead end — keep it visually and textually distinct from a real no-match.
  const isPositiveEmptyState = onlyNeedsAttention && !activeFilterLabel && !search.trim() && envFilter === 'all'
    && visibleFilteredServices.length === 0 && isAwsConnected
  const noMatchTitle      = onlyNeedsAttention && !isPositiveEmptyState
    ? 'No at-risk services match these filters'
    : activeFilterLabel
      ? `No ${activeFilterLabel} resources found`
      : search.trim()
        ? `No services match "${search.trim()}"`
        : envFilter !== 'all'
          ? `No ${envFilter} services found`
          : 'No services match these filters'
  const hasActiveFilter   = templateFilter !== 'all' || envFilter !== 'all' || !!search.trim() || onlyNeedsAttention
  const clearFilters = () => { setTemplateFilter('all'); setEnvFilter('all'); setSearch(''); setOnlyNeedsAttention(false) }

  useEffect(() => { setHealthyExpanded(false) }, [envFilter, templateFilter, search, onlyNeedsAttention])

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
            {isDemoActive && (
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
            )}
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-700 mb-1">
                {isDemoActive ? 'Service Health Score' : 'Service Status'}
              </p>
              <p className="text-base font-bold text-slate-900 leading-tight">
                {isDemoActive
                  ? (warningCount > 0 ? 'Performance Risk Emerging' : 'All Systems Healthy')
                  : (warningCount === 0 ? 'All Healthy' : `${warningCount} of ${totalServices} at risk`)}
              </p>
              {isDemoActive && (
                <p className="text-xs font-medium text-slate-500">{totalServices}/{totalServices} services · High confidence</p>
              )}
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
              {isDemoActive && (
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
              )}
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-slate-700 mb-1">
                  {isDemoActive ? 'Service Health Score' : 'Service Status'}
                </p>
                <p className="text-base font-bold text-slate-900">
                  {isDemoActive
                    ? (warningCount > 0 ? 'System Stable — Performance Risk Emerging in Production' : 'All Systems Healthy')
                    : (warningCount === 0 ? 'All Healthy' : `${warningCount} of ${totalServices} at risk`)}
                </p>
                {isDemoActive && (
                  <p className="text-xs font-medium text-slate-500">{totalServices}/{totalServices} services measured · High confidence</p>
                )}
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
          <div className="text-3xl font-bold text-slate-900 leading-none mb-1">{isLoading && !isDemoActive ? '…' : totalMonthlyCost > 0 ? costDisplay : '—'}</div>
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
                  : <>All {totalServices} service{totalServices !== 1 ? 's' : ''} healthy. No active issues.</>
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

      {/* ── SERVICES LIST ── */}
      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">

        {/* Search — primary navigation method */}
        <div className="px-5 sm:px-7 py-5 border-b border-slate-100">
          <div className="relative mb-3.5">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              placeholder={`Search ${totalServices} service${totalServices !== 1 ? 's' : ''}…`}
              value={search}
              onChange={e => handleSearchChange(e.target.value)}
              className="w-full pl-10 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-900 bg-slate-50 outline-none focus:border-violet-300 focus:bg-white transition-colors"
            />
          </div>

          {/* Two compact dropdowns + 2 quick-filter chips — deliberately few elements */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-2.5">
            <div className="flex gap-2 shrink-0">
              <Select value={templateFilter} onValueChange={setTemplateFilter}>
                <SelectTrigger className="h-8 text-xs w-[128px]"><SelectValue placeholder="Type" /></SelectTrigger>
                <SelectContent>
                  {RESOURCE_TYPE_CHIPS.map(t => (
                    <SelectItem key={t} value={t} className="text-xs">{TYPE_DISPLAY[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={envFilter} onValueChange={setEnvFilter}>
                <SelectTrigger className="h-8 text-xs w-[128px]"><SelectValue placeholder="Environment" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-xs">All Envs</SelectItem>
                  <SelectItem value="production" className="text-xs">Production</SelectItem>
                  <SelectItem value="staging" className="text-xs">Staging</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              <button
                onClick={() => setOnlyNeedsAttention(v => !v)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border cursor-pointer transition-all ${
                  onlyNeedsAttention ? 'bg-red-600 text-white border-red-600' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                }`}
              >
                Needs attention{warningCount > 0 ? ` (${warningCount})` : ''}
              </button>
              <button
                onClick={() => setEnvFilter(prev => prev === 'production' ? 'all' : 'production')}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border cursor-pointer transition-all ${
                  envFilter === 'production' ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                }`}
              >
                Production
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        {isLoading && !isDemoActive ? (
          <div className="px-7 py-12 text-center">
            <RefreshCw size={20} className="text-slate-400 mx-auto mb-3" style={{ animation: 'spin 1s linear infinite' }} />
            <p className="text-sm text-slate-500 m-0">Loading services...</p>
          </div>
        ) : visibleFilteredServices.length === 0 ? (
          !isAwsConnected ? (
            // ── STATE A — no AWS account connected at all ──
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
          ) : isPositiveEmptyState ? (
            // ── STATE C — "needs attention" filter, nothing flagged (good news, not an error) ──
            <div className="px-5 py-10 text-center">
              <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center mx-auto mb-3">
                <CheckCircle2 size={18} className="text-green-600" />
              </div>
              <p className="text-sm font-semibold text-slate-900 mb-1">Nothing needs attention right now</p>
              <p className="text-xs text-slate-500 mb-4 leading-relaxed">
                All {totalServices} service{totalServices !== 1 ? 's' : ''} are healthy.
              </p>
              <button
                onClick={clearFilters}
                className="bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5 transition-colors"
              >
                Show all services
              </button>
            </div>
          ) : (
            // ── STATE B — AWS connected, current filter matches zero services ──
            <div className="px-5 py-8 text-center">
              <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center mx-auto mb-3">
                <SearchX size={18} className="text-slate-400" />
              </div>
              <p className="text-sm font-semibold text-slate-900 mb-1">{noMatchTitle}</p>
              <p className="text-xs text-slate-500 mb-4 leading-relaxed">
                Try a different resource type, or clear filters to see all {totalServices} service{totalServices !== 1 ? 's' : ''}.
              </p>
              {hasActiveFilter && (
                <button
                  onClick={clearFilters}
                  className="bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 rounded-lg text-xs font-semibold border-none cursor-pointer inline-flex items-center gap-1.5 transition-colors"
                >
                  Clear filter
                </button>
              )}
            </div>
          )
        ) : (
          <>
            {/* Needs attention — expanded by default, restrained styling, fixed severity+cost sort */}
            {needsAttentionSorted.length > 0 && (
              <div>
                <div className="px-5 sm:px-7 py-2.5 bg-slate-50/70 border-b border-slate-100">
                  <p className="text-[11px] font-bold text-slate-600 uppercase tracking-widest m-0">
                    Needs Attention · {needsAttentionSorted.length}
                  </p>
                </div>
                {needsAttentionSorted.map((svc: any) => <ServiceRow key={svc.id} svc={svc} />)}
              </div>
            )}

            {/* Collapsed healthy group — expands into the same row format, sortable by cost */}
            {healthySorted.length > 0 && (
              <div>
                <button
                  onClick={() => setHealthyExpanded(v => !v)}
                  className="w-full flex items-center justify-between gap-3 px-5 sm:px-7 py-3.5 bg-green-50/40 hover:bg-green-50 border-b border-slate-100 cursor-pointer text-left transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <CheckCircle2 size={15} className="text-green-600 shrink-0" />
                    <span className="text-sm font-semibold text-slate-700">
                      {healthySorted.length} service{healthySorted.length !== 1 ? 's' : ''} healthy
                    </span>
                  </span>
                  {healthyExpanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                </button>
                {healthyExpanded && (
                  <>
                    <div className="hidden sm:flex items-center justify-end px-7 py-2 bg-slate-50 border-b border-slate-100">
                      <button
                        onClick={toggleCostSort}
                        className="flex items-center gap-1 text-[11px] font-bold text-slate-500 uppercase tracking-widest cursor-pointer bg-transparent border-none hover:text-slate-700"
                      >
                        Monthly Cost
                        {costSort === 'asc' ? <ChevronUp size={12} /> : costSort === 'desc' ? <ChevronDown size={12} /> : null}
                      </button>
                    </div>
                    {healthySorted.map((svc: any) => <ServiceRow key={svc.id} svc={svc} />)}
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}