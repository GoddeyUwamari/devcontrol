'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useDemoMode } from '@/components/demo/demo-mode-toggle'
import { useSalesDemo } from '@/lib/demo/sales-demo-data'
import { alertHistoryService } from '@/lib/services/alert-history.service'
import { Alert, AlertFilters, DateRangeOption } from '@/lib/types'
import { RefreshCw, Bell, Shield, AlertTriangle } from 'lucide-react'
import { IncidentReadinessPanel, type ReadinessLoad, type ReadinessResult, type ReadinessSection } from '@/components/observability/incident-readiness-panel'

const DEMO_HISTORY = [
  { id: 'h1', alertName: 'High CPU Usage',          serviceName: 'api-gateway',          severity: 'critical', status: 'resolved', description: 'CPU usage above 90% for 15 minutes on api-gateway ECS cluster.',       labels: {}, annotations: {}, startedAt: new Date(Date.now() - 1000*60*60*2).toISOString(),  durationMinutes: 25, resolvedAt: new Date(Date.now() - 1000*60*95).toISOString(),      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), costImpact: '$1,240' },
  { id: 'h2', alertName: 'Deployment Failed',       serviceName: 'auth-service',         severity: 'critical', status: 'resolved', description: 'Deployment to staging failed. Rolled back to previous version.',      labels: {}, annotations: {}, startedAt: new Date(Date.now() - 1000*60*60*5).toISOString(),  durationMinutes: 22, resolvedAt: new Date(Date.now() - 1000*60*60*4).toISOString(),  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), costImpact: '$890' },
  { id: 'h3', alertName: 'Memory Spike',            serviceName: 'analytics-worker',     severity: 'warning',  status: 'resolved', description: 'Memory usage peaked at 94% during batch processing job.',             labels: {}, annotations: {}, startedAt: new Date(Date.now() - 1000*60*60*8).toISOString(),  durationMinutes: 45, resolvedAt: new Date(Date.now() - 1000*60*60*7).toISOString(),  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), costImpact: '$340' },
  { id: 'h4', alertName: 'RDS Failover',            serviceName: 'payment-processor',    severity: 'critical', status: 'resolved', description: 'RDS primary instance failover triggered. Standby promoted.',          labels: {}, annotations: {}, startedAt: new Date(Date.now() - 1000*60*60*24).toISOString(), durationMinutes: 8,  resolvedAt: new Date(Date.now() - 1000*60*60*23).toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), costImpact: '$2,100' },
  { id: 'h5', alertName: 'High Latency',            serviceName: 'api-gateway',          severity: 'warning',  status: 'resolved', description: 'p95 latency exceeded 800ms threshold for 10 minutes.',               labels: {}, annotations: {}, startedAt: new Date(Date.now() - 1000*60*60*28).toISOString(), durationMinutes: 18, resolvedAt: new Date(Date.now() - 1000*60*60*27).toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), costImpact: '$560' },
  { id: 'h6', alertName: 'Certificate Renewed',     serviceName: 'api-gateway',          severity: 'warning',  status: 'resolved', description: 'SSL certificate renewed successfully before expiry.',                labels: {}, annotations: {}, startedAt: new Date(Date.now() - 1000*60*60*48).toISOString(), durationMinutes: 5,  resolvedAt: new Date(Date.now() - 1000*60*60*47).toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), costImpact: '$0' },
  { id: 'h7', alertName: 'Lambda Timeout',          serviceName: 'notification-service', severity: 'warning',  status: 'resolved', description: 'Lambda function exceeded 30s timeout on 3 consecutive invocations.', labels: {}, annotations: {}, startedAt: new Date(Date.now() - 1000*60*60*52).toISOString(), durationMinutes: 12, resolvedAt: new Date(Date.now() - 1000*60*60*51).toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), costImpact: '$180' },
  { id: 'h8', alertName: 'S3 Bucket Policy Change', serviceName: 'analytics-worker',     severity: 'critical', status: 'resolved', description: 'Unexpected S3 bucket policy modification detected and reverted.',    labels: {}, annotations: {}, startedAt: new Date(Date.now() - 1000*60*60*72).toISOString(), durationMinutes: 3,  resolvedAt: new Date(Date.now() - 1000*60*60*71).toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), costImpact: '$3,400' },
] as unknown as Alert[]

const DEMO_STATS = { total: 8, critical: 4, avgResolutionTime: 17, mttr: 22 }
const demoSection = <T,>(state: ReadinessSection<T>['state'], source: string, reason: string | null, data: T | null = null, coverage: string | null = null): ReadinessSection<T> =>
  ({ state, source, asOf: null, coverage, reason, data })
const DEMO_NOT_SUPPORTED = (source: string, reason: string) => demoSection<never>('not_supported', source, reason)
const DEMO_READINESS: ReadinessResult = {
  connected: true,
  state: 'partial',
  reason: 'Measures EC2 and RDS alert coverage only (6 of 7 in-scope resources covered); monitoring coverage, signal freshness, response setup, and ALB/Lambda alert coverage are not supported yet.',
  readiness_score: 86,
  status: 'Ready',
  discovery_run: { completedAt: new Date(Date.now() - 1000 * 60 * 42).toISOString() },
  scope: { connectedAccountId: null, discoveryRegion: 'us-east-1' },
  components: {
    alert_coverage: {
      ec2: demoSection('available', 'CloudWatch metric alarms matched to DevControl EC2 inventory', null, {
        resourceType: 'ec2', applicable: true, inScope: 5, covered: 4, coveragePercent: 80,
        statusCounts: { running: 5 }, excluded: { notSeenByGatedRun: 0, otherRegion: 0 },
        nonQualifyingAlarms: { insufficient_data: 1, no_actions: 0, data_unverified: 0 },
      }),
      rds: demoSection('available', 'CloudWatch metric alarms matched to DevControl RDS inventory', null, {
        resourceType: 'rds', applicable: true, inScope: 2, covered: 2, coveragePercent: 100,
        statusCounts: { available: 2 }, excluded: { notSeenByGatedRun: 0, otherRegion: 0 },
        nonQualifyingAlarms: { insufficient_data: 0, no_actions: 0, data_unverified: 0 },
      }),
      alb: DEMO_NOT_SUPPORTED('ALB alert coverage', 'discovery failures for this type are not recorded'),
      lambda: DEMO_NOT_SUPPORTED('Lambda alert coverage', 'discovery failures for this type are not recorded'),
    },
    monitoring_coverage: DEMO_NOT_SUPPORTED('Monitoring coverage', 'DevControl does not yet check whether each discovered resource is reporting metrics'),
    signal_freshness: DEMO_NOT_SUPPORTED('Signal freshness', 'DevControl does not yet measure per-resource metric freshness'),
    response_config: DEMO_NOT_SUPPORTED('Response setup', 'DevControl does not yet record alert destinations or on-call routing'),
  },
  alarms: demoSection('available', 'CloudWatch metric alarms', null, {
    total: 9, matched: 7, orphaned: [{ alarmName: 'legacy-api-cpu' }], unsupported: [{ alarmName: 'fleet-cpu-math' }], unevaluated: 0,
  }),
  top_gaps: [{ type: 'alert_coverage_ec2', severity: 'medium', message: '1 of 5 in-scope EC2 resources has no enabled alarm with actions', action: 'Configure alerts', actionPath: '/observability/alerts' }],
}

type LocalDateRange = '24h' | DateRangeOption
const toServiceRange = (r: LocalDateRange): DateRangeOption => r === '24h' ? '7d' : r

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'
/**
 * connected:false (no AWS account row) is "not connected"; a non-OK response
 * or unsuccessful body throws, so it surfaces as a request error -- never as
 * "not connected" and never as a zero score.
 */
async function fetchReadiness(): Promise<{ connected: boolean | null; data: ReadinessResult | null }> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null
  const res = await fetch(`${API_URL}/api/observability/readiness`, { headers: { 'Authorization': `Bearer ${token}` } })
  if (!res.ok) throw new Error(`readiness request failed: ${res.status}`)
  const body = await res.json()
  if (!body.success) throw new Error('readiness request failed')
  return { connected: body.connected ?? null, data: body.data ?? null }
}

export default function AlertHistoryPage() {
  const demoMode = useDemoMode()
  const salesDemoMode = useSalesDemo((state) => state.enabled)
  const isDemoActive = demoMode || salesDemoMode

  const [dateRange, setDateRange] = useState<LocalDateRange>('30d')
  const [selectedSeverity, setSelectedSeverity] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState<string>('')

  const serviceRange = toServiceRange(dateRange)
  const filters: AlertFilters = { dateRange: serviceRange, severity: selectedSeverity !== 'all' ? selectedSeverity as any : undefined }

  const { data: historyData, isLoading, refetch } = useQuery({ queryKey: ['alert-history', filters], queryFn: () => alertHistoryService.getAlertHistory(filters), refetchInterval: 60000 })
  const { data: statsData } = useQuery({ queryKey: ['alert-stats-history', serviceRange], queryFn: () => alertHistoryService.getAlertStats({ dateRange: serviceRange }), refetchInterval: 60000 })
  const { data: readinessData, isLoading: readinessLoading, isError: readinessError } = useQuery({ queryKey: ['observability-readiness'], queryFn: fetchReadiness, refetchInterval: 120000, enabled: !isDemoActive, retry: false })

  const displayAlerts: Alert[] = isDemoActive ? DEMO_HISTORY : (historyData?.data || [])
  const displayStats = isDemoActive ? DEMO_STATS : { total: statsData?.data?.total || 0, critical: statsData?.data?.criticalCount || 0, avgResolutionTime: statsData?.data?.avgResolutionTime || 0, mttr: statsData?.data?.avgResolutionTime || 0 }
  const readinessLoad: ReadinessLoad = isDemoActive ? { kind: 'loaded', result: DEMO_READINESS }
    : readinessError ? { kind: 'request_error' }
    : readinessLoading || !readinessData ? { kind: 'loading' }
    : readinessData.data ? { kind: 'loaded', result: readinessData.data }
    : readinessData.connected === false ? { kind: 'not_connected' }
    : { kind: 'request_error' }
  const readinessGaps = readinessLoad.kind === 'loaded' ? readinessLoad.result.top_gaps : []

  const filteredAlerts = displayAlerts.filter((a: Alert) => {
    if (selectedSeverity !== 'all' && a.severity !== selectedSeverity) return false
    if (searchQuery && !a.alertName.toLowerCase().includes(searchQuery.toLowerCase()) && !a.serviceName?.toLowerCase().includes(searchQuery.toLowerCase())) return false
    return true
  })

  const formatTime = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 max-w-[1320px] mx-auto">

      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight mb-1.5">Incident Resolution Insights</h1>
          <p className="text-xs text-slate-500 font-medium leading-relaxed">Reliability intelligence · Mean time to resolve · Incident patterns · Last 30d</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => refetch()} className="flex items-center gap-2 bg-white text-slate-500 border border-slate-200 px-4 py-2.5 rounded-lg text-sm font-medium cursor-pointer hover:bg-slate-50 transition-colors whitespace-nowrap">
            <RefreshCw size={14} /> Refresh
          </button>
          <a href="/observability/alerts" className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white px-4 py-2.5 rounded-lg text-sm font-semibold no-underline transition-colors whitespace-nowrap">
            <Bell size={14} /> Active Alerts
          </a>
        </div>
      </div>

      {/* Incident readiness -- evidence-based EC2/RDS alert coverage */}
      <IncidentReadinessPanel load={readinessLoad} />

      {/* KPI cards */}
      {(isDemoActive || displayStats.total > 0) && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Total Resolved', value: displayStats.total || null, empty: 'No incidents yet', sub: `Last ${dateRange}`, hero: false },
            { label: 'Critical Resolved', value: displayStats.critical || null, empty: 'No incidents yet', sub: 'High severity incidents', hero: false },
            { label: 'Avg Resolution', value: displayStats.avgResolutionTime ? `${displayStats.avgResolutionTime}m` : null, empty: 'Available after first incident', sub: 'Mean time to resolve', hero: false },
            { label: 'MTTR', value: displayStats.mttr ? `${displayStats.mttr}m` : null, empty: 'Available after first incident', sub: isDemoActive ? 'vs 45m industry avg · Elite' : 'Mean time to recovery', hero: true },
          ].map(({ label, value, empty, sub, hero }) => (
            <div key={label} className={`bg-white rounded-xl p-4 sm:p-8 border border-slate-200 ${hero ? 'border-l-[3px] border-l-violet-600' : ''}`}>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">{label}</p>
              {value !== null ? <div className="text-3xl font-bold text-slate-900 tracking-tight leading-none mb-2">{value}</div> : <div className="text-sm font-medium text-slate-300 mb-2 pt-1.5">{empty}</div>}
              <p className="text-xs text-slate-500 leading-relaxed">{sub}</p>
            </div>
          ))}
        </div>
      )}

      {/* Coverage gaps */}
      {readinessGaps.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-6 mb-6">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">Coverage Gaps</p>
          <div className="flex flex-col gap-2.5">
            {[...readinessGaps].sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.severity] ?? 2) - ({ high: 0, medium: 1, low: 2 }[b.severity] ?? 2)).map((gap, i) => (
              <div key={i} className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 px-4 py-3 rounded-xl border bg-white border-slate-200">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle size={13} className={`shrink-0 mt-0.5 ${gap.severity === 'high' ? 'text-red-600' : 'text-amber-500'}`} />
                  <p className="text-xs text-slate-600 leading-relaxed">{gap.message}</p>
                </div>
                <a href={gap.actionPath} className="text-xs font-semibold text-violet-600 no-underline whitespace-nowrap shrink-0">{gap.action} →</a>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* History table */}
      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        <div className="px-4 sm:px-7 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-0.5">Alert Timeline</p>
            <p className="text-xs text-slate-500">{filteredAlerts.length} records</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex bg-slate-50 rounded-lg p-0.5 gap-0.5">
              {(['24h', '7d', '30d', '90d'] as LocalDateRange[]).map(r => (
                <button key={r} onClick={() => setDateRange(r)} className={`px-3 py-1.5 rounded-md border-none text-xs font-semibold cursor-pointer transition-all ${dateRange === r ? 'bg-white text-slate-900 shadow-sm' : 'bg-transparent text-slate-500'}`}>{r}</button>
              ))}
            </div>
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search history..."
              className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-900 outline-none focus:border-violet-500 transition-colors w-36" />
            <div className="flex bg-slate-50 rounded-lg p-0.5 gap-0.5">
              {['all', 'critical', 'warning'].map(s => (
                <button key={s} onClick={() => setSelectedSeverity(s)} className={`px-2.5 py-1.5 rounded-md border-none text-xs font-semibold cursor-pointer capitalize transition-all ${selectedSeverity === s ? 'bg-white text-slate-900 shadow-sm' : 'bg-transparent text-slate-500'}`}>{s === 'all' ? 'All' : s}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Desktop table */}
        <div className="hidden sm:block overflow-x-auto">
          <div className="grid px-7 py-2.5 bg-slate-50 border-b border-slate-50 min-w-[780px]" style={{ gridTemplateColumns: '2fr 130px 110px 100px 90px 140px 140px' }}>
            {['Alert', 'Service', 'Severity', 'Cost Impact', 'Duration', 'Started', 'Resolved'].map(col => (
              <span key={col} className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{col}</span>
            ))}
          </div>
          {isLoading && !isDemoActive ? (
            <div className="p-12 text-center"><RefreshCw size={18} className="text-slate-300 mx-auto mb-3" /><p className="text-sm text-slate-500">Loading alert history...</p></div>
          ) : filteredAlerts.length === 0 ? (
            <EmptyHistory />
          ) : filteredAlerts.map((alert: Alert, idx: number) => {
            const sevCls = alert.severity === 'critical' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'
            const cost = (alert as any).costImpact
            return (
              <div key={alert.id} className={`grid px-7 py-3.5 items-center hover:bg-slate-50 transition-colors min-w-[780px] ${idx < filteredAlerts.length - 1 ? 'border-b border-slate-50' : ''}`} style={{ gridTemplateColumns: '2fr 130px 110px 100px 90px 140px 140px' }}>
                <div>
                  <p className="text-sm font-semibold text-slate-900 mb-0.5">{alert.alertName}</p>
                  <p className="text-xs text-slate-500 truncate max-w-xs">{alert.description}</p>
                </div>
                <span className="text-xs text-slate-500 font-mono">{alert.serviceName || '—'}</span>
                <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full w-fit capitalize ${sevCls}`}>{alert.severity}</span>
                <span className={`text-xs font-semibold ${isDemoActive && cost && cost !== '$0' ? 'text-red-600' : 'text-slate-300'}`}>{isDemoActive ? (cost ?? '—') : '—'}</span>
                <span className="text-xs text-slate-500">{alert.durationMinutes ? `${alert.durationMinutes}m` : '—'}</span>
                <span className="text-xs text-slate-500">{formatTime(alert.startedAt)}</span>
                <span className="text-xs text-slate-500 font-medium">{alert.resolvedAt ? formatTime(alert.resolvedAt) : '—'}</span>
              </div>
            )
          })}
        </div>

        {/* Mobile cards */}
        <div className="sm:hidden flex flex-col divide-y divide-slate-50">
          {filteredAlerts.length === 0 ? <EmptyHistory /> : filteredAlerts.map((alert: Alert) => {
            const sevCls = alert.severity === 'critical' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'
            const cost = (alert as any).costImpact
            return (
              <div key={alert.id} className="px-4 py-4">
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <p className="text-sm font-semibold text-slate-900 leading-snug flex-1">{alert.alertName}</p>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full capitalize shrink-0 ${sevCls}`}>{alert.severity}</span>
                </div>
                <p className="text-xs text-slate-500 mb-1.5 line-clamp-2">{alert.description}</p>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500 font-mono">{alert.serviceName}</span>
                  <div className="flex gap-3 text-xs text-slate-500">
                    {alert.durationMinutes && <span>{alert.durationMinutes}m</span>}
                    {isDemoActive && cost && cost !== '$0' && <span className="text-red-600 font-semibold">{cost}</span>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function EmptyHistory() {
  return (
    <div className="p-10 sm:p-16 text-center">
      <div className="w-12 h-12 rounded-xl bg-violet-50 flex items-center justify-center mx-auto mb-4"><Shield size={20} className="text-violet-600" /></div>
      <p className="text-sm font-semibold text-slate-900 mb-2">No incidents recorded yet</p>
      <p className="text-sm text-slate-500 leading-relaxed mb-1 max-w-sm mx-auto">When alerts are triggered, this timeline will show what happened, which service was affected, how long it lasted, and how quickly it was resolved.</p>
      <p className="text-xs text-slate-500 mb-6">Use this to audit reliability and improve engineering response times.</p>
      <a href="/observability/alerts" className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white px-5 py-2.5 rounded-lg text-xs font-semibold no-underline transition-colors">
        Configure Alerts →
      </a>
    </div>
  )
}
