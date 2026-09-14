'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Sparkles, ExternalLink } from 'lucide-react'
import { TimeRangeSelector } from '@/components/monitoring/TimeRangeSelector'
import { ResponseTimeChart } from '@/components/monitoring/ResponseTimeChart'
import { ServiceHealthTable } from '@/components/monitoring/ServiceHealthTable'
import { ActiveAlertsPanel } from '@/components/monitoring/ActiveAlertsPanel'
import { SLODashboard } from '@/components/monitoring/SLODashboard'
import { MonitoringEmptyState } from '@/components/monitoring/MonitoringEmptyState'
import { MonitoringErrorState, MonitoringErrorType } from '@/components/monitoring/MonitoringErrorState'
import { DevControlPlatformStatus, DevControlPlatformStatusService } from '@/components/monitoring/DevControlPlatformStatus'
import { ErrorBoundary } from '@/components/error-boundary'
import { useDemoMode } from '@/components/demo/demo-mode-toggle'
import { useSalesDemo } from '@/lib/demo/sales-demo-data'
import { alertHistoryService } from '@/lib/services/alert-history.service'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'
const AWS_REGION = process.env.NEXT_PUBLIC_AWS_DEFAULT_REGION || 'us-east-1'

interface ServiceMetric {
  label: string
  value: number
  unit?: string
}

interface ServiceHealth {
  name: string; description?: string; status: 'healthy' | 'degraded' | 'critical' | 'down' | 'unknown'
  uptime: string; responseTime: string; errorRate: number | null; critical?: boolean
  recentIncidents?: number; uptimeHistory?: number[]; monitored?: boolean
  // Phase B additions, passed through from the backend response below.
  resourceType?: string; metrics?: ServiceMetric[]
}
interface MonitoringError { type: MonitoringErrorType; message: string; action?: string }
// Service Health Coverage Expansion: adds ebs/cloudfront, and fixes a pre-existing drift
// where this type never included lambda or ecs even though both have always been
// evaluated by the backend (see cloudwatch.service.ts's coverage object) — coverageLabel
// below silently omitted them from the summary string as a result.
interface CloudWatchCoverage { ec2: boolean; loadBalancer: boolean; rds: boolean; lambda: boolean; dynamodb: boolean; ecs: boolean; eks: boolean; ebs: boolean; cloudfront: boolean; aurora: boolean }

// CloudWatch Scalability Phase 2D: complete-fleet aggregate health, computed server-side
// from every evaluated resource (see cloudwatch.service.ts's computeMetrics()) -- never
// derived client-side from `services` anymore, since that's now only a bounded page.
interface HealthSummary { total: number; healthy: number; degraded: number; critical: number; down: number; monitored: number }
type SystemStatus = 'healthy' | 'degraded' | 'critical' | 'down'
interface PaginationMeta { shown: number; total: number; hasMore: boolean; cursor: string | null }

// Shared styling for the non-healthy system-status banner — centralized here instead of
// repeating the same 3-way ternary in multiple render spots, and so adding a future
// status only means adding one branch, not hunting down every place it's rendered.
function systemStatusBannerStyle(status: 'degraded' | 'critical' | 'down') {
  switch (status) {
    case 'degraded':
      return { bg: 'bg-amber-50 border-amber-200', dot: 'bg-amber-500', text: 'text-amber-800', subtext: 'text-amber-700', label: 'Degraded' }
    case 'critical':
      return { bg: 'bg-red-50 border-red-200', dot: 'bg-red-600', text: 'text-red-800', subtext: 'text-red-700', label: 'Critical' }
    case 'down':
      return { bg: 'bg-red-50 border-red-200', dot: 'bg-red-900', text: 'text-red-900', subtext: 'text-red-700', label: 'Down' }
  }
}

// Health-summary status-dot color, keyed off the same systemStatus the banner uses —
// separate from systemStatusBannerStyle because the summary line needs a 'healthy' case
// too (the banner never renders when healthy, so it never needed one).
function healthSummaryDotColor(status: 'healthy' | 'degraded' | 'critical' | 'down') {
  switch (status) {
    case 'healthy': return 'bg-green-500'
    case 'degraded': return 'bg-amber-500'
    case 'critical': return 'bg-red-600'
    case 'down': return 'bg-red-900'
  }
}

export default function MonitoringPage() {
  const router = useRouter()
  const demoMode = useDemoMode()
  const salesDemoMode = useSalesDemo((state) => state.enabled)
  const isDemoActive = demoMode || salesDemoMode

  const userRole = useMemo(() => {
    try { const token = localStorage.getItem('accessToken'); if (!token) return 'owner'; const payload = JSON.parse(atob(token.split('.')[1])); return payload.role ?? 'owner' } catch { return 'owner' }
  }, [])

  const [coverage, setCoverage] = useState<CloudWatchCoverage | null>(null)
  const coverageLabel = useMemo(() => {
    if (!coverage) return 'EC2, Application Load Balancer'
    const parts = [
      coverage.ec2 && 'EC2',
      coverage.loadBalancer && 'Application Load Balancer',
      coverage.rds && 'RDS (inventory only)',
      coverage.lambda && 'Lambda',
      coverage.dynamodb && 'DynamoDB',
      coverage.ecs && 'ECS',
      coverage.eks && 'EKS',
      coverage.ebs && 'EBS',
      coverage.cloudfront && 'CloudFront',
      coverage.aurora && 'Aurora',
    ].filter(Boolean)
    return parts.length > 0 ? parts.join(', ') : 'no monitored resources yet'
  }, [coverage])

  const [systemStatus, setSystemStatus] = useState<SystemStatus>('healthy')
  const [metricsAvailable, setMetricsAvailable] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<MonitoringError | null>(null)
  const [timeRange, setTimeRange] = useState('1h')
  const [lastSynced, setLastSynced] = useState<Date>(new Date())
  const [uptime, setUptime] = useState<string>('--')
  const [responseTime, setResponseTime] = useState<number>(0)
  const [responseTimeString, setResponseTimeString] = useState<string>('--')
  const [monthlyCost, setMonthlyCost] = useState<string>('--')
  const [requestsPerMinute, setRequestsPerMinute] = useState<number>(0)
  const [services, setServices] = useState<ServiceHealth[]>([])
  const [responseTimeData, setResponseTimeData] = useState<Array<{ timestamp: number; value: number }>>([])
  const [trendPercent, setTrendPercent] = useState<number>(0)
  const [alerts, setAlerts] = useState<Array<{ id: string; title: string; message: string; severity: 'critical' | 'warning'; service: string; triggeredAt: Date }>>([])
  const [slos, setSlos] = useState<Array<{ name: string; current: number; target: number; errorBudget: number; description?: string }>>([])
  const [lastSnapshot, setLastSnapshot] = useState<any>(null)
  const [isDiagnosing, setIsDiagnosing] = useState(false)
  const [diagnosticResult, setDiagnosticResult] = useState<any>(null)
  const [awsConnected, setAwsConnected] = useState<boolean | null>(null)
  const [cloudWatchMetrics, setCloudWatchMetrics] = useState<any>(null)
  const [requestsAvailable, setRequestsAvailable] = useState(false)
  const [trendAvailable, setTrendAvailable] = useState(false)
  // Monitoring Truthfulness Phase 1: DevControl's own Prometheus-backed infrastructure
  // status, deliberately kept in a state object separate from `services` -- it must never
  // be able to populate ServiceHealthTable, which is exclusively AWS/CloudWatch data.
  const [platformStatus, setPlatformStatus] = useState<{ checked: boolean; available: boolean; services: DevControlPlatformStatusService[] }>({ checked: false, available: false, services: [] })
  // CloudWatch Scalability Phase 2D: complete-fleet aggregate health and pagination
  // metadata, consumed directly from the backend response -- `services` below is now
  // only a bounded page, so these can no longer be derived from it client-side (see the
  // removed `healthCounts` useMemo this replaces). `healthSummary.total` is every
  // evaluated resource regardless of monitored status; `.monitored` is the subset with a
  // live signal; healthy/degraded/critical/down are counted only among those, matching
  // this page's own prior client-side precedent (an unmonitored resource's status is
  // inventory-derived, never counted in these buckets).
  const [healthSummary, setHealthSummary] = useState<HealthSummary | null>(null)
  const [pagination, setPagination] = useState<PaginationMeta | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  const overallHealthPercent = useMemo(() => {
    if (!healthSummary || healthSummary.monitored === 0) return null
    return Math.round((healthSummary.healthy / healthSummary.monitored) * 100)
  }, [healthSummary])

  const generateDemoMetrics = useCallback(() => {
    setError(null)
    const now = Date.now()
    const chartData = Array.from({ length: 12 }, (_, i) => ({ timestamp: now - (11 - i) * 5 * 60 * 1000, value: Math.round(120 + Math.random() * 80) }))
    setUptime('99.95%'); setResponseTime(145); setResponseTimeString('145ms'); setMonthlyCost('$847'); setRequestsPerMinute(1247); setResponseTimeData(chartData); setTrendPercent(-2.3)
    setServices([
      { name: 'Payment API', description: 'Payment processing service', status: 'healthy', uptime: '99.99%', responseTime: '89ms', errorRate: 0.05, critical: true, recentIncidents: 0, uptimeHistory: [99.9,99.95,99.98,99.99,100,99.99,99.98,99.99], monitored: true },
      { name: 'User Service', description: 'User authentication and management', status: 'healthy', uptime: '99.98%', responseTime: '123ms', errorRate: 0.08, critical: true, recentIncidents: 0, uptimeHistory: [99.8,99.9,99.95,99.98,99.97,99.99,99.98,100], monitored: true },
      { name: 'Order Processor', description: 'Background order processing', status: 'degraded', uptime: '98.45%', responseTime: '458ms', errorRate: 1.23, critical: false, recentIncidents: 2, uptimeHistory: [99.5,98.8,97.5,98.2,98.9,98.5,98.1,98.45], monitored: true },
      { name: 'Notification Service', description: 'Email and push notifications', status: 'healthy', uptime: '99.92%', responseTime: '234ms', errorRate: 0.15, critical: false, recentIncidents: 0, uptimeHistory: [99.7,99.8,99.85,99.9,99.92,99.88,99.91,99.92], monitored: true },
    ])
    setSlos([{ name: 'API Uptime', current: 99.95, target: 99.9, errorBudget: 0.05, description: 'API availability SLO' }, { name: 'Response Time', current: 98.5, target: 95.0, errorBudget: 3.5, description: '< 500ms for 95% requests' }, { name: 'Error Rate', current: 99.9, target: 99.9, errorBudget: 0.0, description: '< 0.1% error rate' }])
    setAlerts([{ id: '1', title: 'High Response Time', message: 'Order Processor response time above threshold', severity: 'warning', service: 'order-processor', triggeredAt: new Date(Date.now() - 15 * 60 * 1000) }, { id: '2', title: 'Elevated Error Rate', message: 'Order Processor error rate at 1.23%', severity: 'warning', service: 'order-processor', triggeredAt: new Date(Date.now() - 8 * 60 * 1000) }])
    // Phase 2D: demo mode has no backend to compute healthSummary/pagination server-side
    // -- mirror them here to match the 4 hardcoded rows above (3 healthy + 1 degraded),
    // so the KPI cards and health-summary line render the same way they did before
    // healthCounts moved server-side.
    setHealthSummary({ total: 4, healthy: 3, degraded: 1, critical: 0, down: 0, monitored: 4 })
    setPagination({ shown: 4, total: 4, hasMore: false, cursor: null })
    setSystemStatus('degraded'); setMetricsAvailable(true); setLoading(false)
  }, [])

  const queryPrometheus = async (query: string) => {
    try {
      const controller = new AbortController(); const timeoutId = setTimeout(() => controller.abort(), 10000)
      const response = await fetch(`${API_URL}/api/prometheus/query?query=${encodeURIComponent(query)}`, { signal: controller.signal })
      clearTimeout(timeoutId)
      if (!response.ok) { if (response.status === 401 || response.status === 403) throw new Error('CREDENTIALS'); if (response.status >= 500) throw new Error('SERVER_ERROR'); return null }
      const data = await response.json(); return data.status === 'success' ? data.data : null
    } catch (error: any) { if (error.name === 'AbortError') throw new Error('TIMEOUT'); if (error.message === 'CREDENTIALS' || error.message === 'SERVER_ERROR') throw error; throw new Error('CONNECTION') }
  }

  const loadSnapshot = useCallback(async () => {
    try { const token = document.cookie.split(';').find(c => c.trim().startsWith('auth-token='))?.split('=')[1] || localStorage.getItem('accessToken'); const res = await fetch(`${API_URL}/api/prometheus/snapshot`, { headers: { 'Authorization': `Bearer ${token}` } }); const data = await res.json(); if (data.success && data.data) setLastSnapshot(data.data) } catch {}
  }, [])

  // Monitoring Truthfulness Phase 1: returns the resolved boolean directly (in addition to
  // setting state for other consumers) so the caller can branch on it immediately without
  // relying on a `setState` having already been applied -- reading `awsConnected` right
  // after calling this without awaiting a returned value was the root cause of the
  // AWS-connection race that could let the Prometheus fallback run before connection
  // state was actually known. See fetchAll() below.
  const checkAwsConnection = useCallback(async (): Promise<boolean> => {
    try {
      const token = document.cookie.split(';').find(c => c.trim().startsWith('auth-token='))?.split('=')[1] || localStorage.getItem('accessToken')
      const res = await fetch(`${API_URL}/api/cloudwatch/status`, { headers: { 'Authorization': `Bearer ${token}` } })
      const data = await res.json()
      const connected = data.success ? data.data.connected : false
      setAwsConnected(connected)
      return connected
    } catch {
      setAwsConnected(false)
      return false
    }
  }, [])

  // CloudWatch Scalability Phase 2A: `forceRefresh` maps to `?refresh=true`, the backend's
  // explicit cache-bypass signal (CloudWatchService.getMetrics()) -- passed only from
  // handleRefresh()/refreshAwsHealth(true) (manual refresh, error-state Retry), never
  // from the automatic 60s poll, which should keep benefiting from the response cache.
  const fetchCloudWatchMetrics = useCallback(async (range?: string, forceRefresh?: boolean) => {
    try {
      const token = document.cookie.split(';').find(c => c.trim().startsWith('auth-token='))?.split('=')[1] || localStorage.getItem('accessToken')
      const params = new URLSearchParams()
      if (range) params.set('range', range)
      if (forceRefresh) params.set('refresh', 'true')
      const query = params.toString()
      const url = `${API_URL}/api/cloudwatch/metrics${query ? `?${query}` : ''}`
      const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } })
      const data = await res.json()
      if (data.success && data.data) { setCloudWatchMetrics(data.data); return data.data }
      return null
    } catch { return null }
  }, [])

  // Monitoring Truthfulness Phase 1: DevControl's own platform status, sourced from
  // DevControl's own Prometheus instance. Completely independent of AWS connection
  // state -- this is checkable (and meaningful) whether or not the customer has connected
  // AWS. Never fabricates: a field that genuinely has no data is omitted, never defaulted
  // to a placeholder number, and a service whose `up{}` value is neither '1' nor '0' is
  // reported as 'unknown', not forced into 'down'.
  const fetchPlatformStatus = useCallback(async () => {
    try {
      const controller = new AbortController(); const timeoutId = setTimeout(() => controller.abort(), 5000)
      const apiRes = await fetch(`${API_URL}/api/prometheus/health`, { signal: controller.signal }).catch(() => null)
      clearTimeout(timeoutId)
      const isAvailable = apiRes?.ok ?? false
      if (!isAvailable) {
        setPlatformStatus({ checked: true, available: false, services: [] })
        return
      }

      let responseTimeMs: number | null = null
      const p95Query = await queryPrometheus('histogram_quantile(0.95, rate(http_request_duration_seconds_bucket{job="devcontrol-api"}[5m]))').catch(() => null)
      if (p95Query?.result?.[0]?.value?.[1]) {
        const raw = parseFloat(p95Query.result[0].value[1])
        if (!isNaN(raw) && raw > 0) responseTimeMs = Math.round(raw * 1000)
      }
      if (responseTimeMs === null) {
        const avgQuery = await queryPrometheus('rate(http_request_duration_seconds_sum{job="devcontrol-api"}[5m]) / rate(http_request_duration_seconds_count{job="devcontrol-api"}[5m])').catch(() => null)
        if (avgQuery?.result?.[0]?.value?.[1]) {
          const raw = parseFloat(avgQuery.result[0].value[1])
          if (!isNaN(raw) && raw > 0) responseTimeMs = Math.round(raw * 1000)
        }
      }
      // No fabricated fallback here -- responseTimeMs stays null if genuinely unavailable.

      const [apiUp, dbUp, nodeUp] = await Promise.all([
        queryPrometheus('up{job="devcontrol-api"}').catch(() => null),
        queryPrometheus('up{job="postgres-exporter"}').catch(() => null),
        queryPrometheus('up{job="node-exporter"}').catch(() => null),
      ])
      const statusFor = (result: any): DevControlPlatformStatusService['status'] => {
        const value = result?.result?.[0]?.value?.[1]
        if (value === '1') return 'healthy'
        if (value === '0') return 'down'
        return 'unknown'
      }
      setPlatformStatus({
        checked: true,
        available: true,
        services: [
          { name: 'DevControl API', status: statusFor(apiUp), responseTimeMs },
          { name: 'PostgreSQL', status: statusFor(dbUp), responseTimeMs: null },
          { name: 'Node Exporter', status: statusFor(nodeUp), responseTimeMs: null },
        ],
      })
    } catch {
      setPlatformStatus({ checked: true, available: false, services: [] })
    }
  }, [])

  // Reuses the same alertHistoryService the /observability/alerts page is built on,
  // instead of the CloudWatch-branch's previous demo-only alert list.
  const fetchAlerts = useCallback(async () => {
    try {
      const res = await alertHistoryService.getAlertHistory({ status: 'firing', limit: 20 })
      const mapped = (res.data || []).map(a => ({
        id: a.id,
        title: a.alertName,
        message: a.description,
        severity: a.severity,
        service: a.serviceName || a.serviceId || 'unknown',
        triggeredAt: new Date(a.startedAt),
      }))
      setAlerts(mapped)
    } catch (err) {
      console.error('Error fetching alerts:', err)
    }
  }, [])

  const runDiagnostic = useCallback(async () => {
    setIsDiagnosing(true); setDiagnosticResult(null)
    try { const token = document.cookie.split(';').find(c => c.trim().startsWith('auth-token='))?.split('=')[1] || localStorage.getItem('accessToken'); const res = await fetch(`${API_URL}/api/prometheus/diagnose`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } }); const data = await res.json(); if (data.success) setDiagnosticResult(data.data) } catch {} finally { setIsDiagnosing(false) }
  }, [])

  // CloudWatch Scalability Phase 2D: shared mapper so the first page (fetchMetrics,
  // below) and subsequent pages (loadMoreServices) map a raw API service row to the
  // display shape identically, rather than duplicating this logic.
  const mapServiceRow = (s: any): ServiceHealth => ({
    name: s.name,
    description: s.description,
    status: s.status,
    uptime: s.uptime !== null && s.uptime !== undefined ? `${s.uptime}%` : 'N/A',
    responseTime: s.responseTimeMs !== null && s.responseTimeMs !== undefined ? `${s.responseTimeMs}ms` : 'N/A',
    errorRate: s.errorRate ?? null,
    critical: s.critical,
    monitored: s.monitored,
    // Phase B: pass through resourceType and metrics — previously dropped here even
    // though the backend already returned resourceType, which is why filter tabs and
    // per-resource metrics couldn't be built without this fix.
    resourceType: s.resourceType,
    metrics: Array.isArray(s.metrics) ? s.metrics : undefined,
  })

  const fetchMetrics = useCallback(async (cwData?: any, connectedOverride?: boolean) => {
    const cw = cwData ?? cloudWatchMetrics
    if (cw && !demoMode) {
      const data = cw
      const hasUptime = data.uptime !== null && data.uptime !== undefined
      const hasResponseTime = data.avgResponseTimeMs !== null && data.avgResponseTimeMs !== undefined
      const hasRequests = data.requestsPerMinute !== null && data.requestsPerMinute !== undefined
      const hasTrend = data.trendPercent !== null && data.trendPercent !== undefined

      setUptime(hasUptime ? `${data.uptime}%` : 'N/A')
      setResponseTime(hasResponseTime ? data.avgResponseTimeMs : 0)
      setResponseTimeString(hasResponseTime ? `${data.avgResponseTimeMs}ms` : 'N/A')
      setRequestsPerMinute(hasRequests ? data.requestsPerMinute : 0)
      setRequestsAvailable(hasRequests)
      setMonthlyCost(data.monthlyCost !== null && data.monthlyCost !== undefined ? `$${Math.round(data.monthlyCost).toLocaleString()}` : '--')
      setTrendPercent(hasTrend ? data.trendPercent : 0)
      setTrendAvailable(hasTrend)
      setResponseTimeData(Array.isArray(data.responseTimeHistory) ? data.responseTimeHistory : [])
      setCoverage(data.coverage ?? null)

      // CloudWatch Scalability Phase 2D: `services` is now only the first bounded page --
      // `healthSummary`/`systemStatus` are server-computed from the complete evaluated
      // fleet and must be consumed as-is, never re-derived from the page. `pagination`
      // drives the "load more" control below the table.
      setHealthSummary(data.healthSummary ?? null)
      setSystemStatus(data.systemStatus ?? 'healthy')
      setPagination(data.pagination ?? null)
      setServices((data.services ?? []).map(mapServiceRow))

      setMetricsAvailable(true); setError(null); setLoading(false); setLastSynced(new Date())
      fetchAlerts()
      return
    }
    if (demoMode) { generateDemoMetrics(); return }
    // Monitoring Truthfulness Phase 1: prefer the caller-provided, just-resolved connection
    // result over the `awsConnected` state closure, which may not yet reflect a check that
    // just completed (see refreshAwsHealth()).
    const isConnected = connectedOverride ?? awsConnected
    if (isConnected === true) {
      // AWS is connected but this fetch couldn't get CloudWatch data — don't fall
      // through to the Prometheus path below. Prometheus isn't how this account's
      // data is sourced, and querying it here would show a misleading "can't reach
      // Prometheus" error for what's actually a CloudWatch/IAM-side hiccup.
      setLoading(false); setMetricsAvailable(false)
      setError({
        type: 'connection',
        message: "Can't fetch CloudWatch metrics right now",
        action: 'Your AWS account is connected, but CloudWatch metrics could not be retrieved this time — usually a temporary API or IAM permissions issue, not an outage. Your infrastructure is still running normally.',
      })
      return
    }
    // Monitoring Truthfulness Phase 1: awsConnected is confirmed false here (the `=== true`
    // branch above already returned). This function must never substitute DevControl's own
    // Prometheus data for AWS Service Health -- the dedicated "AWS not connected" CTA
    // (gated on awsConnected === false, rendered below) already communicates this state.
    // DevControl's own platform health is fetched and rendered entirely independently by
    // fetchPlatformStatus() / <DevControlPlatformStatus>, never through `services` here.
    setLoading(false)
    setMetricsAvailable(false)
    setServices([])
    setHealthSummary(null)
    setPagination(null)
  }, [timeRange, isDemoActive, generateDemoMetrics, fetchAlerts, awsConnected])

  // Monitoring Truthfulness Phase 1: the AWS connection check is always awaited, and its
  // resolved value is passed explicitly into fetchMetrics() as `connectedOverride` rather
  // than relying on fetchMetrics()'s closure having already observed the `awsConnected`
  // state update (React state updates are not synchronous, which is what made the old
  // "call checkAwsConnection() then immediately read awsConnected" pattern racy). This is
  // strict await-ordering, not a timeout/delay.
  // `forceRefresh` (default false) is only ever true when called from handleRefresh() --
  // the automatic mount/poll calls below always take the default, cached path.
  const refreshAwsHealth = useCallback(async (forceRefresh = false) => {
    if (demoMode) { fetchMetrics(); return }
    const connected = await checkAwsConnection()
    if (connected) {
      const cw = await fetchCloudWatchMetrics(timeRange, forceRefresh)
      fetchMetrics(cw, true)
    } else {
      fetchMetrics(undefined, false)
    }
  }, [demoMode, checkAwsConnection, fetchCloudWatchMetrics, fetchMetrics, timeRange])

  // CloudWatch Scalability Phase 2A: the only call site that requests a forced refresh --
  // the TimeRangeSelector's refresh button and the error-state Retry buttons all funnel
  // through this, so a user explicitly asking for fresh data always bypasses the cache.
  const handleRefresh = async () => { await refreshAwsHealth(true) }

  // CloudWatch Scalability Phase 2D: fetches the next page using the cursor the backend
  // handed back and APPENDS it to `services` -- never re-fetches or replaces the pages
  // already loaded, and never re-derives healthSummary/systemStatus from the growing
  // `services` array (those stay server-provided and are identical across pages within
  // the same 45s cache window; refreshed here only for consistency, not correctness).
  const loadMoreServices = useCallback(async () => {
    if (!pagination?.hasMore || !pagination.cursor || loadingMore) return
    setLoadingMore(true)
    try {
      const token = document.cookie.split(';').find(c => c.trim().startsWith('auth-token='))?.split('=')[1] || localStorage.getItem('accessToken')
      const params = new URLSearchParams()
      if (timeRange) params.set('range', timeRange)
      params.set('cursor', pagination.cursor)
      const res = await fetch(`${API_URL}/api/cloudwatch/metrics?${params.toString()}`, { headers: { 'Authorization': `Bearer ${token}` } })
      const data = await res.json()
      if (data.success && data.data) {
        setServices(prev => [...prev, ...((data.data.services ?? []).map(mapServiceRow))])
        setPagination(data.data.pagination ?? null)
        if (data.data.healthSummary) setHealthSummary(data.data.healthSummary)
        if (data.data.systemStatus) setSystemStatus(data.data.systemStatus)
      }
    } catch (err) {
      console.error('Error loading more resources:', err)
    } finally {
      setLoadingMore(false)
    }
  }, [pagination, loadingMore, timeRange])

  useEffect(() => {
    refreshAwsHealth()
    loadSnapshot()
    const interval = setInterval(refreshAwsHealth, 60000)
    return () => clearInterval(interval)
  }, [refreshAwsHealth, loadSnapshot])

  // Monitoring Truthfulness Phase 1: DevControl's own platform status is fetched entirely
  // independently of the AWS-connection state machine above -- it is meaningful whether or
  // not this organization has connected AWS, and must never share a fetch/orchestration
  // path with the AWS Service Health data.
  useEffect(() => {
    fetchPlatformStatus()
    const interval = setInterval(fetchPlatformStatus, 60000)
    return () => clearInterval(interval)
  }, [fetchPlatformStatus])

  // Monitoring Truthfulness Phase 1: this generic empty state is for genuinely unknown
  // connection status only (awsConnected === null) -- "confirmed not connected"
  // (awsConnected === false) has its own explicit "Stop Flying Blind on AWS" CTA below,
  // which must still render. Before this phase, the removed Prometheus fallback always
  // set `metricsAvailable` or `error` as a side effect for the not-connected case, which
  // incidentally kept this gate from ever firing then; correctly removing that fabrication
  // meant this gate needed its own explicit `awsConnected === null` condition instead of
  // the looser `awsConnected !== true`.
  if (!metricsAvailable && !isDemoActive && !loading && !error && awsConnected === null && !cloudWatchMetrics) {
    return (
      <ErrorBoundary>
        <div className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 max-w-[1320px] mx-auto">
          <DevControlPlatformStatus checked={platformStatus.checked} available={platformStatus.available} services={platformStatus.services} />
          <MonitoringEmptyState onSetup={() => router.push('/settings/monitoring')} />
        </div>
      </ErrorBoundary>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 max-w-[1320px] mx-auto">
      <style>{`@keyframes pulse { 0%, 100% { opacity: 0.6; } 50% { opacity: 0.3; } }`}</style>

      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mb-1.5">Infrastructure Intelligence</h1>
          <p className="text-sm text-slate-500 leading-relaxed">AWS infrastructure health, performance, cost, and risk. {coverageLabel} · {cloudWatchMetrics?.region || AWS_REGION}</p>
          {cloudWatchMetrics && (
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium bg-green-50 border border-green-200 rounded-full px-3 py-1 text-green-600">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" /> CloudWatch connected
              </span>
              <span className="text-[11px] text-slate-400">· Last synced {lastSynced.toLocaleTimeString()}</span>
            </div>
          )}
          {/* Phase A: health-summary line, immediately visible below the header — surfaces
              status counts the page already computes rather than burying them in the table. */}
          {metricsAvailable && healthSummary && healthSummary.monitored > 0 && (
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <span className={`w-2 h-2 rounded-full shrink-0 ${healthSummaryDotColor(systemStatus)}`} />
              <span className="text-sm font-semibold text-slate-900">
                {systemStatus === 'healthy' ? 'Healthy' : systemStatus === 'degraded' ? 'Degraded' : systemStatus === 'critical' ? 'Critical' : 'Down'}
              </span>
              <span className="text-sm text-slate-500">
                · {healthSummary.monitored} resource{healthSummary.monitored !== 1 ? 's' : ''} monitored · {healthSummary.healthy} healthy · {healthSummary.degraded} degraded · {healthSummary.critical} critical
              </span>
            </div>
          )}
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <TimeRangeSelector selected={timeRange} onChange={setTimeRange} onRefresh={handleRefresh} />
          {awsConnected && (
            <div className="flex gap-2">
              <a href={`https://console.aws.amazon.com/cloudwatch/home?region=${AWS_REGION}`} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 bg-white text-slate-500 border border-slate-200 rounded-lg px-3.5 py-2 text-xs font-medium no-underline hover:bg-slate-50 transition-colors whitespace-nowrap">
                <ExternalLink size={12} /> CloudWatch
              </a>
              <a href="https://console.aws.amazon.com/cost-management/home#/cost-explorer" target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 bg-white text-slate-500 border border-slate-200 rounded-lg px-3.5 py-2 text-xs font-medium no-underline hover:bg-slate-50 transition-colors whitespace-nowrap">
                <ExternalLink size={12} /> Cost Explorer
              </a>
            </div>
          )}
        </div>
      </div>

      {/* Monitoring Truthfulness Phase 1: DevControl's own platform status -- deliberately
          its own section, its own heading, and its own data source, rendered regardless of
          AWS connection state. Must never be confused with, or feed, AWS Service Health
          below. */}
      <DevControlPlatformStatus checked={platformStatus.checked} available={platformStatus.available} services={platformStatus.services} />

      {/* AWS not connected */}
      {!isDemoActive && awsConnected === false && (
        <div className="bg-gradient-to-br from-violet-50 to-violet-100 rounded-2xl border border-violet-200 p-8 sm:p-16 text-center mb-7">
          <div className="w-16 h-16 rounded-2xl bg-violet-600 flex items-center justify-center mx-auto mb-6 text-3xl">🔍</div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight mb-3">Stop Flying Blind on AWS</h2>
          <p className="text-sm text-slate-500 leading-relaxed mb-2 max-w-lg mx-auto">Get real-time visibility into your infrastructure, detect risks early, and track performance across all services — before issues impact your users or your revenue.</p>
          <p className="text-sm text-violet-600 font-medium mb-8">No agents. No setup. Read-only access via AWS CloudWatch.</p>
          <p className="text-xs text-slate-400 mb-6">Takes less than 2 minutes · Zero risk to your infrastructure · Read-only access</p>
          <div className="flex flex-wrap gap-3 justify-center mb-8">
            <a href={awsConnected ? "https://console.aws.amazon.com/cloudwatch/" : "/connect-aws"} target={awsConnected ? "_blank" : undefined} rel={awsConnected ? "noopener noreferrer" : undefined} className="bg-violet-600 hover:bg-violet-700 text-white px-7 py-3 rounded-lg text-sm font-semibold no-underline inline-flex items-center gap-2 transition-colors">☁️ Enable CloudWatch Monitoring →</a>
            <button onClick={() => { const event = new CustomEvent('demo-mode-changed', { detail: { enabled: true } }); window.dispatchEvent(event) }}
              className="bg-white text-violet-600 border border-violet-200 px-7 py-3 rounded-lg text-sm font-semibold cursor-pointer hover:bg-violet-50 transition-colors">Explore Demo Data</button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-lg mx-auto">
            {[{ icon: '📊', label: 'Continuous visibility', desc: 'Identify issues before they impact users' }, { icon: '🔔', label: 'Proactive alerts', desc: 'Get notified before incidents escalate' }, { icon: '💰', label: 'Cost leak detection', desc: 'Find wasted spend across all services' }].map(({ icon, label, desc }) => (
              <div key={label} className="bg-white rounded-xl p-4 border border-violet-100 text-left">
                <div className="text-2xl mb-2">{icon}</div>
                <p className="text-xs font-semibold text-slate-900 mb-1">{label}</p>
                <p className="text-[11px] text-slate-400">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Non-AWS orgs whose Prometheus source is unreachable — the diagnose/snapshot
          tooling here is Prometheus-specific and only meaningful in that path. */}
      {!isDemoActive && awsConnected !== true && error && (
        <MonitoringErrorState type={error.type} message={error.message} action={error.action} onRetry={handleRefresh} onSettings={() => router.push('/settings/monitoring')} onDiagnose={runDiagnostic} isDiagnosing={isDiagnosing} diagnosticResult={diagnosticResult} lastSnapshot={lastSnapshot} />
      )}

      {/* AWS-connected orgs whose CloudWatch fetch failed — a distinct, source-correct
          card instead of reusing the Prometheus-flavored one above (wrong docs link,
          wrong troubleshooting steps like "port 9090" for an IAM-role-based source). */}
      {!isDemoActive && awsConnected === true && error && !cloudWatchMetrics && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-8 sm:p-10 text-center mb-7">
          <div className="w-14 h-14 rounded-2xl bg-red-100 flex items-center justify-center mx-auto mb-4 text-2xl">⚠️</div>
          <h2 className="text-lg font-bold text-slate-900 mb-2">{error.message}</h2>
          <p className="text-sm text-slate-500 leading-relaxed max-w-md mx-auto mb-6">{error.action}</p>
          <div className="flex gap-3 justify-center">
            <button onClick={handleRefresh} className="bg-red-600 hover:bg-red-700 text-white px-5 py-2.5 rounded-lg text-sm font-semibold border-none cursor-pointer transition-colors">Retry</button>
            <a href="/settings/monitoring" className="bg-white text-slate-600 border border-slate-200 px-5 py-2.5 rounded-lg text-sm font-semibold no-underline hover:bg-slate-50 transition-colors">Check AWS Connection</a>
          </div>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && !isDemoActive && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-7">
          {[1,2,3,4].map(i => <div key={i} className="bg-white rounded-xl border border-slate-200 h-28" style={{ animation: 'pulse 1.5s ease-in-out infinite', opacity: 0.6 }} />)}
        </div>
      )}

      {/* Main content */}
      {(!loading || isDemoActive) && (!error || isDemoActive) && (
        <>
          {/* AI Insight banner — Phase A: rewritten healthy-case sentence to reference the
              actual resource counts computed above instead of response-time/uptime figures
              that are usually N/A for non-ALB accounts. Degraded/critical/down branches
              unchanged from tonight's earlier fix. */}
          <div className="bg-white rounded-xl border border-slate-100 px-4 sm:px-6 py-4 mb-6 flex items-start gap-3.5">
            <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center shrink-0"><Sparkles size={13} className="text-white" /></div>
            <div className="flex-1">
              <p className="text-[10px] font-semibold text-violet-600 uppercase tracking-widest mb-1">AI Insight</p>
              <p className="text-sm text-slate-700 leading-relaxed">
                {systemStatus === 'down'
                  ? 'System is down. Immediate investigation required across all services.'
                  : systemStatus === 'critical'
                    ? 'One or more services are reporting critical health signals. Review Service Health below for details.'
                    : systemStatus === 'degraded'
                      ? (isDemoActive
                          ? 'Order Processor is degraded with 1.23% error rate and 458ms response time — 2 active alerts. Root cause likely upstream dependency or resource constraint. Payment API and User Service remain healthy at 99.99% uptime.'
                          : 'One or more services may need attention. Review Service Health below for details.')
                      : (healthSummary?.monitored ?? 0) > 0
                        ? `Infrastructure is healthy. ${healthSummary!.monitored} AWS resource${healthSummary!.monitored !== 1 ? 's are' : ' is'} currently monitored with no active health violations. ${alerts.length === 0 ? 'No reliability anomalies were detected during the selected period.' : `${alerts.length} active alert${alerts.length !== 1 ? 's' : ''}.`}`
                        : 'No monitored resources yet. Connect AWS or run resource discovery to start tracking infrastructure health.'}
              </p>
            </div>
            {alerts.length > 0 && (
              <a href="/settings/alerts" className="text-xs font-semibold text-violet-600 no-underline shrink-0 flex items-center gap-1 whitespace-nowrap">View alerts <ArrowRight size={11} /></a>
            )}
          </div>

          {/* System status banner */}
          {systemStatus !== 'healthy' && (() => {
            const style = systemStatusBannerStyle(systemStatus)
            return (
              <div className={`rounded-xl border px-5 py-3 mb-6 flex flex-wrap items-center gap-2 ${style.bg}`}>
                <div className={`w-2 h-2 rounded-full shrink-0 ${style.dot}`} />
                <span className={`text-sm font-semibold ${style.text}`}>System {style.label} · {alerts.length} active alert{alerts.length !== 1 ? 's' : ''}</span>
                <span className={`text-xs ${style.subtext}`}>· Last synced {lastSynced.toLocaleTimeString()}</span>
              </div>
            )
          })()}

          {/* 4 KPI cards — Phase A: replaced System Uptime/Avg Response Time/Requests-Min
              (frequently N/A on non-ALB accounts) with capability-aware cards that are
              always computable from data the page already has: overall health percentage,
              monitored resource count, active alert count, and monthly cost (unchanged). */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-7">
            {[
              { label: 'Overall Health', value: overallHealthPercent !== null ? `${overallHealthPercent}%` : 'N/A', sub: overallHealthPercent === null ? 'No monitored resources' : `${healthSummary?.healthy ?? 0}/${healthSummary?.monitored ?? 0} healthy`, color: overallHealthPercent === null ? 'text-slate-300' : overallHealthPercent >= 90 ? 'text-green-600' : overallHealthPercent >= 70 ? 'text-amber-500' : 'text-red-600' },
              { label: 'Monitored Resources', value: (healthSummary?.monitored ?? 0).toLocaleString(), sub: (healthSummary?.monitored ?? 0) === 0 ? 'Run discovery to add resources' : coverageLabel, color: (healthSummary?.monitored ?? 0) === 0 ? 'text-slate-300' : 'text-slate-900' },
              { label: 'Active Alerts', value: alerts.length.toLocaleString(), sub: alerts.length === 0 ? 'No active alerts' : 'Needs attention', color: alerts.length === 0 ? 'text-slate-900' : 'text-red-600' },
              { label: 'Monthly Cost', value: monthlyCost, sub: monthlyCost === '--' ? 'Cost data unavailable' : 'Current monthly spend', color: monthlyCost === '--' ? 'text-slate-300' : 'text-slate-900' },
            ].map(({ label, value, sub, color }) => (
              <div key={label} className="bg-white rounded-xl p-4 sm:p-8 border border-slate-200">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-3">{label}</p>
                <div className={`text-2xl sm:text-3xl font-bold tracking-tight leading-none mb-2 ${color}`}>{value}</div>
                <p className="text-xs text-slate-400 leading-relaxed">{sub}</p>
              </div>
            ))}
          </div>

          {/* Response time chart + alerts */}
          <div className="grid grid-cols-1 sm:grid-cols-[3fr_2fr] gap-5 mb-7">
            <div className="bg-white rounded-xl p-4 sm:p-8 border border-slate-100">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-5">
                <div>
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">Response Time Trend</p>
                  <p className="text-sm font-semibold text-slate-900">
                    {responseTimeString}
                    {trendAvailable && (
                      <span className={`text-xs font-normal ml-2 ${trendPercent < 0 ? 'text-green-600' : 'text-amber-500'}`}>{trendPercent > 0 ? '+' : ''}{trendPercent.toFixed(1)}% vs last period</span>
                    )}
                  </p>
                </div>
              </div>
              <ResponseTimeChart data={responseTimeData} currentValue={responseTime} trendPercent={trendPercent} />
            </div>
            <div className="bg-white rounded-xl p-4 sm:p-8 border border-slate-100">
              <div className="flex items-center justify-between mb-5">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Active Alerts</p>
                <a href="/settings/alerts" className="text-xs font-semibold text-violet-600 no-underline flex items-center gap-1">View all <ArrowRight size={11} /></a>
              </div>
              <ActiveAlertsPanel alerts={alerts} />
            </div>
          </div>

          {/* Service health table */}
          <div className="bg-white rounded-xl p-4 sm:p-8 border border-slate-100 mb-7 overflow-x-auto">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-5">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Service Health</p>
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-400">{healthSummary?.healthy ?? 0}/{healthSummary?.monitored ?? 0} healthy</span>
                <a href="/services" className="text-xs font-semibold text-violet-600 no-underline flex items-center gap-1">All services <ArrowRight size={11} /></a>
              </div>
            </div>
            <ServiceHealthTable services={services} loading={loading} rangeLabel={timeRange} />
            {/* CloudWatch Scalability Phase 2D: detail rows are a bounded, server-paginated
                page of the complete evaluated fleet -- this is a display/pagination limit,
                not the (now-removed) AWS evaluation cap the old truncation banner used to
                describe. Aggregate health above already reflects every resource regardless
                of how many rows are loaded here. */}
            {pagination && pagination.total > 0 && (
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mt-4 pt-4 border-t border-slate-100">
                <span className="text-xs text-slate-400">
                  Showing {services.length.toLocaleString()} of {pagination.total.toLocaleString()} resources
                </span>
                {pagination.hasMore && (
                  <button
                    onClick={loadMoreServices}
                    disabled={loadingMore}
                    className="text-xs font-semibold text-violet-600 bg-transparent border-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed self-start sm:self-auto"
                  >
                    {loadingMore ? 'Loading…' : 'Load more resources'}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* SLO dashboard */}
          <div className="bg-white rounded-xl p-4 sm:p-8 border border-slate-100">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-5">
              <div>
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">Service Level Objectives</p>
                <p className="text-sm text-slate-900">{slos.length === 0 ? 'No active SLOs' : `${slos.filter(s => s.current >= s.target).length}/${slos.length} SLOs meeting target`}</p>
              </div>
              <a href="/monitoring/slos" className="text-xs font-semibold text-violet-600 no-underline flex items-center gap-1 whitespace-nowrap">Full SLO report <ArrowRight size={11} /></a>
            </div>
            {slos.length === 0 && !isDemoActive ? (
              <div className="text-center py-10">
                <p className="text-sm text-slate-500 leading-relaxed mb-3">No SLOs configured yet. Set up target thresholds for latency or error rate budgets.</p>
                <a href="/monitoring/slos" className="text-xs font-semibold text-violet-600 no-underline inline-flex items-center gap-1">Set up SLOs <ArrowRight size={11} /></a>
              </div>
            ) : (
              <SLODashboard slos={slos} />
            )}
          </div>
        </>
      )}

      {/* Monitoring Truthfulness Phase 1: excludes awsConnected === false -- that case
          already has its own explicit "Stop Flying Blind on AWS" CTA above (rendered
          because services.length is now honestly 0 there instead of the removed
          Prometheus fallback's fabricated rows), so this block would otherwise render a
          second, redundant "connect AWS" prompt underneath it.
          CloudWatch Scalability Phase 2D: gates on the server-provided complete-fleet
          total, not `services.length` -- `services` is now only a bounded page, so an
          org with resources beyond the first page must never be told "no resources
          discovered" just because a later page hasn't been loaded yet. */}
      {!loading && !isDemoActive && (healthSummary?.total ?? 0) === 0 && !error && awsConnected !== false && (
        awsConnected === true ? (
          // AWS is connected and CloudWatch is reachable — the gap is that nothing has
          // been discovered yet, not that monitoring was never set up. Sending this org
          // to the generic "Setup Monitoring" CTA below would misstate which step they're on.
          <div className="bg-white border border-slate-200 rounded-2xl p-8 sm:p-12 text-center">
            <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4 text-2xl">🔎</div>
            <h2 className="text-lg font-bold text-slate-900 mb-2">AWS connected — no resources discovered yet</h2>
            <p className="text-sm text-slate-500 leading-relaxed max-w-md mx-auto mb-6">
              CloudWatch is reachable, but no EC2 instances, load balancers, or RDS databases have been discovered for this account yet. Run discovery to populate infrastructure health here.
            </p>
            <a href="/services" className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white px-5 py-2.5 rounded-lg text-sm font-semibold no-underline transition-colors">
              Run Resource Discovery <ArrowRight size={13} />
            </a>
          </div>
        ) : (
          <MonitoringEmptyState onSetup={() => router.push('/settings/monitoring')} />
        )
      )}
    </div>
  )
}