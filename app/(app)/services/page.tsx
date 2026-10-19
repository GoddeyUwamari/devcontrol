'use client'

import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { Rocket, ArrowRight, Layers, RefreshCw, Check, Scan, SearchX, Search, ChevronDown, ChevronUp, CheckCircle2 } from 'lucide-react'
import { useDemoMode } from '@/components/demo/demo-mode-toggle'
import { useSalesDemo } from '@/lib/demo/sales-demo-data'
import awsServicesService, { AWSService, AWSServicesPage, AWSServicesStats } from '@/lib/services/aws-services.service'
import awsAccountsService from '@/lib/services/aws-accounts.service'
import { usePlan } from '@/lib/hooks/use-plan'
import { useAuth } from '@/lib/contexts/auth-context'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SeverityBadge } from '@/components/ui/severity-badge'
import { DiscoveryWarningNotice } from '@/components/aws/discovery-warning-notice'
import { statusNeedsAttention } from './statusAttention'
import { connectedAccountsCaption } from './accountCaption'
import { RegisteredServices } from './RegisteredServices'

const _now = Date.now()

const DEMO_SERVICES: AWSService[] = [
  { id: '1', name: 'api-gateway',         environment: 'production', region: 'us-east-1', status: 'healthy', type: 'ecs',    uptime: 99.9, lastDeployed: new Date(_now - 1000 * 60 * 45).toISOString(),         owner: 'sarah.chen',   team: 'Platform Team',  monthly_cost: null, metadata: {}, priority_severity: null,   needs_attention: false, reason: null } as any,
  { id: '2', name: 'auth-service',         environment: 'production', region: 'us-east-1', status: 'healthy', type: 'ecs',    uptime: 99.7, lastDeployed: new Date(_now - 1000 * 60 * 120).toISOString(),        owner: 'mike.johnson', team: 'Auth Team',      monthly_cost: null, metadata: {}, priority_severity: null,   needs_attention: false, reason: null } as any,
  { id: '3', name: 'payment-processor',    environment: 'staging',    region: 'us-west-2', status: 'warning', type: 'lambda', uptime: 98.2, lastDeployed: new Date(_now - 1000 * 60 * 5).toISOString(),           owner: 'alex.wong',    team: 'Payments Team',  monthly_cost: null, metadata: {}, priority_severity: 'high',   needs_attention: true,  reason: 'Lambda invocation spike detected (+178%) · retry loop suspected' } as any,
  { id: '4', name: 'notification-service', environment: 'production', region: 'us-east-1', status: 'healthy', type: 'lambda', uptime: 99.9, lastDeployed: new Date(_now - 1000 * 60 * 60 * 6).toISOString(),      owner: 'emma.davis',   team: 'Platform Team',  monthly_cost: null, metadata: {}, priority_severity: null,   needs_attention: false, reason: null } as any,
  { id: '5', name: 'analytics-worker',     environment: 'production', region: 'eu-west-1', status: 'healthy', type: 'ec2',    uptime: 99.5, lastDeployed: new Date(_now - 1000 * 60 * 60 * 24).toISOString(),     owner: 'david.kim',    team: 'Data Team',      monthly_cost: 623.4, metadata: {}, priority_severity: 'medium', needs_attention: true,  reason: 'Cost inefficiency detected — over-provisioned' } as any,
]

const DEMO_STATS: AWSServicesStats = { total: 5, healthy: 3, needs_attention: 2, avg_uptime: 99.4, aws_accounts_connected: 1 }

// Sort rank for the merged severity scale — critical first. Any resource
// without a priority_severity is healthy and sorts after all of these.
const SEVERITY_SORT_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
const SEVERITY_LABEL: Record<string, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' }

const RESOURCE_TYPE_CHIPS = [
  'all',
  'ec2', 'ebs', 'ecs', 'lambda', 'rds', 's3', 'eks', 'dynamodb',
  'cloudfront', 'api-gateway', 'elasticache', 'aurora', 'sqs', 'sns',
  'load-balancer', 'vpc',
]

const TYPE_DISPLAY: Record<string, string> = {
  'all': 'All Types', 'ec2': 'EC2', 'ebs': 'EBS', 'ecs': 'ECS', 'lambda': 'Lambda',
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
// reason/last-synced, type badge, environment badge. The name is shown exactly
// as stored; a resource with no environment tag is "Untagged".
function ServiceRow({ svc }: { svc: any }) {
  const tc         = typeStyle(svc.type)
  // Tag values keep their case ("Production", "PRODUCTION"); style by meaning.
  const env        = svc.environment?.toLowerCase()
  const envColor   = env === 'production' ? '#059669' : env === 'staging' ? '#D97706' : '#64748B'
  const envBg      = env === 'production' ? '#F0FDF4' : env === 'staging' ? '#FFFBEB' : '#F8FAFC'

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 px-4 sm:px-5 py-3.5 border-b border-slate-50 last:border-b-0 transition-colors hover:bg-slate-50">
      {svc.needs_attention && svc.priority_severity && (
        <div className="shrink-0">
          <SeverityBadge severity={svc.priority_severity} label={SEVERITY_LABEL[svc.priority_severity]} />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-900 mb-0.5 truncate">{svc.name}</p>
        {svc.needs_attention && svc.reason ? (
          <p className="text-xs font-medium m-0 truncate text-slate-500">{svc.reason}</p>
        ) : svc.last_deployed ? (
          <p className="text-xs text-slate-500 font-medium m-0 truncate">
            Last synced {new Date(svc.last_deployed).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </p>
        ) : null}
      </div>
      <div className="flex items-center gap-2 shrink-0 flex-wrap">
        <span className="text-xs font-semibold px-2 py-0.5 rounded-md" style={{ background: tc.bg, color: tc.color }}>
          {TYPE_DISPLAY[svc.type] ?? svc.type?.toUpperCase() ?? '—'}
        </span>
        <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full" style={{ background: envBg, color: envColor }}>
          {svc.environment ?? 'Untagged'}
        </span>
      </div>
    </div>
  )
}

// Rows per page of each section. The server caps a page at 100.
const PAGE_SIZE = 50

// The same order the server pages in: severity, then name compared as 'en',
// then id, so re-sorting a page never moves a row the server placed.
function byNameThenId(a: any, b: any) {
  return a.name.localeCompare(b.name, 'en') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

// Previous / Next for one section, with the server's range and total. Only
// rendered when the section has more than one page.
function Pager({ label, pagination, onPage, busy }: {
  label: string
  pagination: AWSServicesPage['pagination']
  onPage: (page: number) => void
  busy: boolean
}) {
  const { page, limit, total, total_pages, has_more } = pagination
  if (total_pages <= 1) return null
  const first = Math.min((page - 1) * limit + 1, total)
  const last  = Math.min(page * limit, total)
  const buttonClass = 'px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-600 cursor-pointer transition-colors hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50'
  return (
    <nav aria-label={`${label} pages`} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-5 sm:px-7 py-3 border-b border-slate-100">
      <p className="text-xs text-slate-500 font-medium m-0">Showing {first}–{last} of {total}</p>
      <div className="flex items-center gap-2">
        <button type="button" className={buttonClass} disabled={busy || page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
        <span className="text-xs text-slate-500 font-medium">Page {page} of {total_pages}</span>
        <button type="button" className={buttonClass} disabled={busy || !has_more} onClick={() => onPage(page + 1)}>Next</button>
      </div>
    </nav>
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
  const [isDiscovering,     setIsDiscovering]     = useState(false)
  const [discoveryComplete, setDiscoveryComplete] = useState(false)
  const [discoveryMsg,      setDiscoveryMsg]      = useState<string | null>(null)
  // The last discovery run's warnings, kept until the next run.
  const [discoveryWarnings, setDiscoveryWarnings] = useState<string[]>([])
  const [discoveryError,    setDiscoveryError]    = useState<string | null>(null)
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false)

  const demoMode      = useDemoMode()
  const salesDemoMode = useSalesDemo((state) => state.enabled)
  const isDemoActive  = demoMode || salesDemoMode
  const { tier }      = usePlan()
  // Every query below is keyed by organization and disabled until it is known,
  // so a response for one organization can never render for another: a late
  // answer for the previous organization lands in that organization's cache
  // entry, which this page no longer reads.
  const { organization } = useAuth()
  const orgId    = organization?.id ?? null
  const realMode = !isDemoActive && !!orgId

  // Debounce the raw input into a separate committed value, rather than
  // scheduling a delayed fetch directly — a setTimeout that fetches captures
  // whatever `search` was in scope at the moment it was scheduled. If the user
  // then changes the input again before that timer fires, the stale closure
  // still fires ~400ms later with the OLD search term and silently overwrites
  // the correct, fresher results. Debouncing the state instead means the list
  // query always reads the latest committed value.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400)
    return () => clearTimeout(t)
  }, [search])

  // Whether an AWS account is connected at all — independent of the current
  // type/env/search filter, since a filtered-to-zero result set must never be
  // mistaken for "nothing connected."
  const accountsQuery = useQuery({
    queryKey: ['services-aws-accounts', orgId],
    queryFn: () => awsAccountsService.getAccounts(),
    enabled: realMode, retry: false, refetchOnWindowFocus: false,
  })
  const noAwsAccount   = accountsQuery.data ? accountsQuery.data.length === 0 : true
  const knownNoAccount = accountsQuery.data?.length === 0

  // Organization-wide numbers. Filters can't change them, so a filter or search
  // change never refetches them; discovery does (handleAutoDiscover).
  const statsQuery = useQuery<AWSServicesStats>({
    queryKey: ['services-stats', orgId],
    queryFn: () => awsServicesService.getStats(),
    enabled: realMode, retry: false, refetchOnWindowFocus: false,
  })

  // The two sections are paged by the server, each over the full filtered set.
  const listFilters = {
    type:   templateFilter !== 'all' ? templateFilter  : undefined,
    env:    envFilter      !== 'all' ? envFilter       : undefined,
    search: debouncedSearch.trim()   || undefined,
  }
  // A new organization or filter starts both sections at page 1, in the same
  // render, so no request is made for a stale page.
  const pagingKey = JSON.stringify([orgId, listFilters])
  const [paging, setPaging] = useState({ key: pagingKey, needs: 1, healthy: 1 })
  const needsPage   = paging.key === pagingKey ? paging.needs   : 1
  const healthyPage = paging.key === pagingKey ? paging.healthy : 1
  const goToPage = (section: 'needs' | 'healthy', page: number) =>
    setPaging((prev) => ({ ...(prev.key === pagingKey ? prev : { needs: 1, healthy: 1 }), key: pagingKey, [section]: page }))

  const sectionQuery = (needsAttention: boolean, page: number, enabled: boolean) => {
    const queryKey = ['services-list', orgId, listFilters, needsAttention, page] as const
    return {
      queryKey,
      queryFn: () => awsServicesService.getServices({ ...listFilters, needs_attention: needsAttention, page, limit: PAGE_SIZE }),
      enabled, retry: false, refetchOnWindowFocus: false,
      // Turning a page keeps the current rows until the next page arrives. Any
      // other change (organization, filter, section) starts from loading.
      placeholderData: (previous: AWSServicesPage | undefined, previousQuery: { queryKey: readonly unknown[] } | undefined) =>
        previousQuery && JSON.stringify(previousQuery.queryKey.slice(0, 4)) === JSON.stringify(queryKey.slice(0, 4)) ? previous : undefined,
    }
  }
  const needsQuery   = useQuery(sectionQuery(true,  needsPage,   realMode))
  const healthyQuery = useQuery(sectionQuery(false, healthyPage, realMode && !onlyNeedsAttention))

  // A page past the end (the inventory shrank after a discovery) goes back to the last page.
  useEffect(() => {
    for (const [section, data] of [['needs', needsQuery.data], ['healthy', healthyQuery.data]] as const) {
      const p = data?.pagination
      if (p && p.page > 1 && p.page > p.total_pages) goToPage(section, Math.max(1, p.total_pages))
    }
  })

  // Discovery's error is cleared by the next filter change, as the list's own error is.
  useEffect(() => { setDiscoveryError(null) }, [pagingKey])

  // A query disabled because the organization isn't known yet counts as loading,
  // so nothing renders as empty before it could be fetched.
  const statsLoading = !isDemoActive && (!orgId || statsQuery.isPending)
  const listLoading  = !isDemoActive && (!orgId || needsQuery.isPending || (!onlyNeedsAttention && healthyQuery.isPending))
  const listFailed   = !isDemoActive && (needsQuery.isError || (!onlyNeedsAttention && healthyQuery.isError))
  // A failed request is an error unless the organization is known to have no
  // AWS account, in which case the page says that instead.
  const error = (!isDemoActive && (listFailed || statsQuery.isError) && !knownNoAccount) || !!discoveryError

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
    setIsDiscovering(true); setDiscoveryComplete(false); setDiscoveryMsg(null); setDiscoveryWarnings([]); setDiscoveryError(null)
    try {
      const result = await awsServicesService.discoverServices()
      setDiscoveryMsg(result.message); setDiscoveryComplete(true)
      setDiscoveryWarnings(result.warnings)
      setTimeout(() => { setDiscoveryComplete(false); setDiscoveryMsg(null) }, 6000)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['services-list', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['services-stats', orgId] }),
      ])
      // A scan can flip compliance_scan_completed, which changes isPreliminary —
      // without this, the security score (dashboard/security pages) stays on its
      // pre-scan cached value for up to staleTime (5 min).
      queryClient.invalidateQueries({ queryKey: ['risk-score-trend'] })
      queryClient.invalidateQueries({ queryKey: ['risk-score-current'] })
    } catch (err: any) {
      if (err.response?.status === 402) setShowUpgradePrompt(true)
      else setDiscoveryError(err.message || 'Discovery failed — check your AWS connection')
    } finally { setIsDiscovering(false) }
  }

  const listRows: AWSService[] = [...(needsQuery.data?.services ?? []), ...(onlyNeedsAttention ? [] : healthyQuery.data?.services ?? [])]
  const allServices      = isDemoActive ? DEMO_SERVICES : listRows
  const displayStats     = isDemoActive ? DEMO_STATS    : statsQuery.data
  // Real mode: the server already filtered and paged. Demo: filtered here.
  const filteredServices = isDemoActive
    ? allServices.filter((s: any) => {
        const matchEnv  = envFilter      === 'all' || s.environment === envFilter
        const matchType = templateFilter === 'all' || s.type        === templateFilter
        const matchSrch = !search.trim() || s.name.toLowerCase().includes(search.toLowerCase())
        return matchEnv && matchType && matchSrch
      })
    : allServices
  // The server's counts for the filtered set, used only when /stats has not answered.
  const listCounts = isDemoActive ? undefined : needsQuery.data?.counts

  const totalServices = displayStats?.total          ?? (listCounts ? listCounts.needs_attention + listCounts.no_flagged_issues : allServices.length)
  const healthyCount  = displayStats?.healthy         ?? listCounts?.no_flagged_issues ?? allServices.filter((s: any) => s.status === 'healthy').length
  // Fallback when the stats request has not answered: only a known warning or critical
  // status counts. 'unknown' (no lifecycle state to judge) is not a reason for attention.
  const warningCount  = displayStats?.needs_attention ?? listCounts?.needs_attention ?? allServices.filter(statusNeedsAttention).length
  // A failed stats request shows no number rather than a zero.
  const statsUnavailable = !isDemoActive && !statsLoading && !displayStats
  const kpiValue = (n: number) => statsLoading ? '…' : statsUnavailable ? '—' : n
  // The chip's count is organization-wide, so it comes from /stats or not at all:
  // never from the filtered list's counts.
  const chipCountUnavailable = statsLoading || statsUnavailable
  // From the backend's count of connected accounts, never assumed from the
  // resources: inventory can outlive a connection.
  const accountsCaption = connectedAccountsCaption(displayStats?.aws_accounts_connected)

  // "Needs attention" quick-filter chip narrows the already type/env/search-
  // filtered set further: the healthy section is not requested at all.
  const visibleFilteredServices = onlyNeedsAttention
    ? filteredServices.filter((s: any) => s.needs_attention)
    : filteredServices

  // Priority-sorted: critical first, then by name — fixed order, the server's.
  const needsAttentionSorted = visibleFilteredServices
    .filter((s: any) => s.needs_attention)
    .sort((a: any, b: any) => {
      const ra = SEVERITY_SORT_RANK[a.priority_severity as string] ?? 4
      const rb = SEVERITY_SORT_RANK[b.priority_severity as string] ?? 4
      if (ra !== rb) return ra - rb
      return byNameThenId(a, b)
    })

  const healthySorted = visibleFilteredServices
    .filter((s: any) => !s.needs_attention)
    .sort(byNameThenId)

  // Section sizes: the server's totals over the full filtered set, never the
  // rows of the current page.
  const needsAttentionTotal = isDemoActive ? needsAttentionSorted.length : needsQuery.data?.pagination.total ?? 0
  const healthyTotal        = isDemoActive ? healthySorted.length : onlyNeedsAttention ? 0 : healthyQuery.data?.pagination.total ?? 0
  const visibleTotal        = needsAttentionTotal + healthyTotal
  // Section counts follow the type/env/search filters; the chip and KPI counts don't.
  const listIsNarrowed = templateFilter !== 'all' || envFilter !== 'all' || !!debouncedSearch.trim()

  // Connection status — deliberately independent of the current type/env/search
  // filter, so filtering to zero matches can never be mistaken for "AWS not
  // connected." True when there's a connected account OR any resources have
  // ever synced (totalServices comes from the unfiltered /services/stats call).
  const isAwsConnected    = isDemoActive || !noAwsAccount || totalServices > 0
  // What the counts below can support. "Healthy" in /services/stats means "not
  // stopped/failed and no high-severity finding" -- no monitoring source exists
  // -- so real mode says "no flagged issues", and zero resources or a failed
  // request is never read as all-healthy.
  const serviceDataState: 'loading' | 'unavailable' | 'none' | 'present' = isDemoActive ? 'present'
    : statsLoading ? 'loading'
    : error ? 'unavailable'
    : totalServices === 0 ? 'none'
    : 'present'
  const serviceStatusHeadline = serviceDataState === 'loading' ? 'Loading…'
    : serviceDataState === 'unavailable' ? 'Resource data unavailable'
    : serviceDataState === 'none' ? 'No resources discovered'
    : warningCount === 0 ? 'No resources flagged'
    : `${warningCount} of ${totalServices} at risk`
  const activeFilterLabel = templateFilter !== 'all' ? TYPE_DISPLAY[templateFilter] : null
  // A "needs attention" filter turning up zero results is good news, not a
  // dead end — keep it visually and textually distinct from a real no-match.
  const isPositiveEmptyState = onlyNeedsAttention && !activeFilterLabel && !search.trim() && envFilter === 'all'
    && visibleTotal === 0 && isAwsConnected
  const noMatchTitle      = onlyNeedsAttention && !isPositiveEmptyState
    ? 'No at-risk resources match these filters'
    : activeFilterLabel
      ? `No ${activeFilterLabel} resources found`
      : search.trim()
        ? `No resources match "${search.trim()}"`
        : envFilter !== 'all'
          ? `No ${envFilter} resources found`
          : 'No resources match these filters'
  const hasActiveFilter   = templateFilter !== 'all' || envFilter !== 'all' || !!search.trim() || onlyNeedsAttention
  // Connected, but discovery has not found anything yet — not a filter miss.
  const nothingDiscovered = !isDemoActive && isAwsConnected && serviceDataState === 'none' && !hasActiveFilter
  const clearFilters = () => { setTemplateFilter('all'); setEnvFilter('all'); setSearch(''); setOnlyNeedsAttention(false) }

  useEffect(() => { setHealthyExpanded(false) }, [envFilter, templateFilter, search, onlyNeedsAttention])

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 max-w-[1320px] mx-auto font-sans">
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {/* ── PAGE HEADER ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight mb-1">Services</h1>
          <p className="text-xs text-slate-500 font-medium leading-relaxed">Until services are mapped, this page lists the AWS resources discovered in your connected account and any flagged issues.</p>
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
        </div>
      </div>

      <DiscoveryWarningNotice warnings={discoveryWarnings} className="mb-4" />

      {/* ── RESOURCE STATUS STRIP ── */}
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
              <p className="text-xs font-bold uppercase tracking-widest text-slate-700 mb-1">
                {isDemoActive ? 'Service Health Score' : 'Resource status'}
              </p>
              <p className="text-base font-bold text-slate-900 leading-tight">
                {isDemoActive
                  ? (warningCount > 0 ? 'Performance Risk Emerging' : 'All Systems Healthy')
                  : serviceStatusHeadline}
              </p>
              {isDemoActive && (
                <p className="text-xs font-medium text-slate-500">{totalServices}/{totalServices} services · High confidence</p>
              )}
            </div>
          </div>
          {/* At risk */}
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-700 mb-1">At Risk</p>
            <p className="text-2xl font-bold text-red-600">{kpiValue(warningCount)} <span className="text-sm text-slate-500 font-normal">of {kpiValue(totalServices)}</span></p>
            <p className="text-xs text-slate-500">{isDemoActive ? '1 reliability · 1 cost' : statsUnavailable ? '—' : warningCount > 0 ? 'Flagged for review' : serviceDataState === 'present' ? 'None flagged' : '—'}</p>
          </div>
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
                <p className="text-xs font-bold uppercase tracking-widest text-slate-700 mb-1">
                  {isDemoActive ? 'Service Health Score' : 'Resource status'}
                </p>
                <p className="text-base font-bold text-slate-900">
                  {isDemoActive
                    ? (warningCount > 0 ? 'System Stable — Performance Risk Emerging in Production' : 'All Systems Healthy')
                    : serviceStatusHeadline}
                </p>
                {isDemoActive && (
                  <p className="text-xs font-medium text-slate-500">{totalServices}/{totalServices} services measured · High confidence</p>
                )}
              </div>
            </div>

            <div className="w-px h-11 bg-slate-200 shrink-0" />

            {/* At risk */}
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-red-600 mb-1">At Risk</p>
              <p className="text-2xl font-bold text-red-600 mb-0.5">{kpiValue(warningCount)} of {kpiValue(totalServices)}</p>
              <p className="text-xs font-medium text-slate-500 m-0">
                {isDemoActive ? '1 reliability · 1 cost inefficiency' : statsUnavailable ? '—' : warningCount > 0 ? 'Flagged for review' : serviceDataState === 'present' ? 'None flagged' : '—'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── UPGRADE PROMPT ── */}
      {showUpgradePrompt && (
        <div className="flex items-center justify-between bg-amber-50 border border-amber-400 rounded-xl px-5 py-3.5 mb-6 gap-4 flex-wrap">
          <div className="flex items-center gap-2.5">
            <span className="text-lg">⚠️</span>
            <span className="text-sm font-medium text-amber-900">
              You've reached the AWS resource limit on the <strong>{tier}</strong> plan. Upgrade to discover more resources.
            </span>
          </div>
          <a href="/settings/billing/upgrade" className="shrink-0 text-xs font-semibold text-white bg-amber-500 hover:bg-amber-600 rounded-lg px-4 py-2 no-underline whitespace-nowrap transition-colors">
            Upgrade plan
          </a>
        </div>
      )}

      {/* ── ERROR BANNER ── */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-3 mb-5">
          <p className="text-sm text-red-600 m-0">Failed to load resources.</p>
        </div>
      )}

      {/* ── KPI CARDS ── */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 mb-8">
        <div className={`bg-white rounded-xl p-5 border border-slate-200 ${statsLoading ? 'opacity-60' : ''}`}>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-700 mb-3">AWS resources</p>
          <div className="text-4xl font-bold text-slate-900 leading-none mb-1">{kpiValue(totalServices)}</div>
          {accountsCaption && <p className="text-slate-500 text-xs font-medium m-0">{accountsCaption}</p>}
        </div>

        <div className={`bg-white rounded-xl p-5 border border-slate-200 ${statsLoading ? 'opacity-60' : ''}`}>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-700 mb-3">{isDemoActive ? 'Healthy' : 'No Flagged Issues'}</p>
          <div className="text-4xl font-bold text-green-600 leading-none mb-1">{kpiValue(healthyCount)}</div>
          <p className="text-slate-500 text-xs font-medium m-0">{isDemoActive ? 'Operating within thresholds' : 'Resources with no flagged issues'}</p>
        </div>

        <div className={`bg-white rounded-xl p-5 border border-slate-200 ${statsLoading ? 'opacity-60' : ''}`}>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-700 mb-3">At Risk</p>
          <div className="text-4xl font-bold text-red-600 leading-none mb-1">{kpiValue(warningCount)}</div>
          <p className="text-slate-500 text-xs font-medium m-0">
            {isDemoActive ? '1 reliability · 1 cost inefficiency · both in production' : statsUnavailable ? '—' : warningCount > 0 ? `${warningCount} flagged for review` : serviceDataState === 'present' ? 'None flagged' : '—'}
          </p>
        </div>
      </div>

      {/* ── DEPLOYMENTS LINK ── */}
      <Link href="/deployments" className="block no-underline group mb-8 sm:max-w-md">
        <div className="bg-white rounded-xl px-5 py-4 border border-slate-100 flex items-center gap-3.5 transition-all group-hover:border-violet-300 group-hover:shadow-md">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: '#F5F3FF' }}>
            <Rocket size={16} style={{ color: '#7C3AED' }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-900 mb-0.5">Deployments</p>
            <p className="text-xs text-slate-500 m-0">Deployment history and tracking</p>
          </div>
          <ArrowRight size={14} className="text-slate-400 shrink-0" />
        </div>
      </Link>

      {/* ── REGISTERED SERVICES ── */}
      <RegisteredServices />

      {/* ── SERVICES LIST ── */}
      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">

        {/* Search — primary navigation method */}
        <div className="px-5 sm:px-7 py-5 border-b border-slate-100">
          <div className="relative mb-3.5">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              placeholder={`Search ${totalServices} resource${totalServices !== 1 ? 's' : ''}…`}
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
                <SelectTrigger className="h-8 text-xs w-[152px]"><SelectValue placeholder="Environment" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-xs">All environments</SelectItem>
                  <SelectItem value="production" className="text-xs">Production</SelectItem>
                  <SelectItem value="staging" className="text-xs">Staging</SelectItem>
                  <SelectItem value="untagged" className="text-xs">Untagged</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              <button
                onClick={() => setOnlyNeedsAttention(v => !v)}
                title={chipCountUnavailable
                  ? 'The count across every resource in this organization is not available right now'
                  : 'Count across every resource in this organization, before search and filters'}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border cursor-pointer transition-all ${
                  onlyNeedsAttention ? 'bg-red-600 text-white border-red-600' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                }`}
              >
                Needs attention{chipCountUnavailable ? ' (—)' : warningCount > 0 ? ` (${warningCount})` : ''}
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
        {listLoading ? (
          <div className="px-7 py-12 text-center">
            <RefreshCw size={20} className="text-slate-400 mx-auto mb-3" style={{ animation: 'spin 1s linear infinite' }} />
            <p className="text-sm text-slate-500 m-0">Loading resources…</p>
          </div>
        ) : listFailed && !knownNoAccount ? (
          // ── The list request failed: an error, never an empty state ──
          <div className="px-5 py-10 text-center" role="alert">
            <p className="text-sm font-semibold text-slate-900 mb-1">The resource list could not be loaded</p>
            <p className="text-xs text-slate-500 mb-4 leading-relaxed">This is a loading error, not an empty result.</p>
            <button
              onClick={() => { needsQuery.refetch(); if (!onlyNeedsAttention) healthyQuery.refetch() }}
              className="bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5 transition-colors"
            >
              <RefreshCw size={13} /> Try again
            </button>
          </div>
        ) : visibleTotal === 0 ? (
          !isAwsConnected ? (
            // ── STATE A — no AWS account connected at all ──
            <div className="px-5 sm:px-12 py-12 text-center">
              <div className="w-12 h-12 rounded-xl bg-slate-50 flex items-center justify-center mx-auto mb-4">
                <Layers size={22} className="text-slate-400" />
              </div>
              <p className="text-sm font-semibold text-slate-900 mb-1.5">No AWS account connected</p>
              <p className="text-sm text-slate-500 mb-6 leading-relaxed max-w-md mx-auto">Connect an AWS account with read-only access. DevControl lists the resources it discovers here.</p>
              <a href="/connect-aws" className="bg-violet-600 hover:bg-violet-700 text-white px-6 py-2.5 rounded-lg text-sm font-semibold no-underline inline-flex items-center gap-2 transition-colors">
                Connect AWS account
              </a>
            </div>
          ) : nothingDiscovered ? (
            // ── STATE D — connected, discovery has found nothing yet ──
            <div className="px-5 py-10 text-center">
              <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center mx-auto mb-3">
                <Layers size={18} className="text-slate-400" />
              </div>
              <p className="text-sm font-semibold text-slate-900 mb-1">No resources discovered yet</p>
              <p className="text-xs text-slate-500 mb-4 leading-relaxed">Run Auto Discover to scan your connected account.</p>
              <button onClick={handleAutoDiscover} disabled={isDiscovering} className="bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 rounded-lg text-xs font-semibold border-none cursor-pointer inline-flex items-center gap-1.5 transition-colors">
                <Scan size={13} /> Auto Discover
              </button>
            </div>
          ) : isPositiveEmptyState ? (
            // ── STATE C — "needs attention" filter, nothing flagged (good news, not an error) ──
            <div className="px-5 py-10 text-center">
              <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center mx-auto mb-3">
                <CheckCircle2 size={18} className="text-green-600" />
              </div>
              <p className="text-sm font-semibold text-slate-900 mb-1">Nothing needs attention right now</p>
              <p className="text-xs text-slate-500 mb-4 leading-relaxed">
                None of the {totalServices} resource{totalServices !== 1 ? 's have' : ' has'} a flagged issue.
              </p>
              <button
                onClick={clearFilters}
                className="bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5 transition-colors"
              >
                Show all resources
              </button>
            </div>
          ) : (
            // ── STATE B — AWS connected, current filter matches zero resources ──
            <div className="px-5 py-8 text-center">
              <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center mx-auto mb-3">
                <SearchX size={18} className="text-slate-400" />
              </div>
              <p className="text-sm font-semibold text-slate-900 mb-1">{noMatchTitle}</p>
              <p className="text-xs text-slate-500 mb-4 leading-relaxed">
                Try a different resource type, or clear filters to see all {totalServices} resource{totalServices !== 1 ? 's' : ''}.
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
            {/* Needs attention — expanded by default, restrained styling, fixed severity+name sort */}
            {needsAttentionTotal > 0 && (
              <div className={needsQuery.isPlaceholderData ? 'opacity-60' : ''}>
                <div className="px-5 sm:px-7 py-2.5 bg-slate-50/70 border-b border-slate-100">
                  <p className="text-xs font-bold text-slate-600 uppercase tracking-widest m-0">
                    <span>Needs Attention · {needsAttentionTotal}</span>
                    {listIsNarrowed && <span className="normal-case tracking-normal font-medium text-slate-500"> · matching current filters</span>}
                  </p>
                </div>
                {needsAttentionSorted.map((svc: any) => <ServiceRow key={svc.id} svc={svc} />)}
                {needsQuery.data && (
                  <Pager label="Needs attention" pagination={needsQuery.data.pagination} busy={needsQuery.isFetching} onPage={(p) => goToPage('needs', p)} />
                )}
              </div>
            )}

            {/* Collapsed no-flagged-issues group — expands into the same row format, sorted by name */}
            {healthyTotal > 0 && (
              <div className={healthyQuery.isPlaceholderData ? 'opacity-60' : ''}>
                <button
                  onClick={() => setHealthyExpanded(v => !v)}
                  className="w-full flex items-center justify-between gap-3 px-5 sm:px-7 py-3.5 bg-green-50/40 hover:bg-green-50 border-b border-slate-100 cursor-pointer text-left transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <CheckCircle2 size={15} className="text-green-600 shrink-0" />
                    <span className="text-sm font-semibold text-slate-700">
                      {healthyTotal} resource{healthyTotal !== 1 ? 's' : ''} with no flagged issues
                    </span>
                    {listIsNarrowed && <span className="text-xs font-medium text-slate-500">matching current filters</span>}
                  </span>
                  {healthyExpanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                </button>
                {healthyExpanded && healthySorted.map((svc: any) => <ServiceRow key={svc.id} svc={svc} />)}
                {healthyExpanded && healthyQuery.data && (
                  <Pager label="No flagged issues" pagination={healthyQuery.data.pagination} busy={healthyQuery.isFetching} onPage={(p) => goToPage('healthy', p)} />
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}