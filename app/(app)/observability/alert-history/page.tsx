'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useDemoMode } from '@/components/demo/demo-mode-toggle'
import { useSalesDemo } from '@/lib/demo/sales-demo-data'
import { alertHistoryService } from '@/lib/services/alert-history.service'
import { Alert, AlertFilters, DateRangeOption } from '@/lib/types'
import { Sparkles, ArrowRight, RefreshCw, Bell, Shield, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'

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
const DEMO_READINESS = {
  readiness_score: 72, status: 'Partially Ready',
  components: {
    alert_coverage:           { score: 100, label: 'Alert Coverage',    detail: '5 of 5 services have alerts',           status: 'good' },
    monitoring_coverage:      { score: 80,  label: 'Monitoring',        detail: '4 of 5 services reporting',             status: 'good' },
    critical_service_coverage:{ score: 100, label: 'Critical Coverage', detail: '3 of 3 critical services covered',      status: 'good' },
    signal_freshness:         { score: 80,  label: 'Signal Freshness',  detail: 'Metrics up to date',                   status: 'good' },
    response_config:          { score: 0,   label: 'Response Setup',    detail: 'No alert destinations configured',      status: 'risk' },
  },
  top_gaps: [{ type: 'response_config', severity: 'medium', message: 'No on-call routing configured — team will not be notified of incidents', action: 'Configure destinations', actionPath: '/settings/notifications' }],
}

type LocalDateRange = '24h' | DateRangeOption
const toServiceRange = (r: LocalDateRange): DateRangeOption => r === '24h' ? '7d' : r

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'
async function fetchReadiness() {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null
  const res = await fetch(`${API_URL}/api/observability/readiness`, { headers: { 'Authorization': `Bearer ${token}` } })
  if (!res.ok) return null
  const data = await res.json()
  return data.success ? data.data : null
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
  const { data: readinessData } = useQuery({ queryKey: ['observability-readiness'], queryFn: fetchReadiness, refetchInterval: 120000, enabled: !isDemoActive })

  const displayAlerts: Alert[] = isDemoActive ? DEMO_HISTORY : (historyData?.data || [])
  const displayStats = isDemoActive ? DEMO_STATS : { total: statsData?.data?.total || 0, critical: statsData?.data?.criticalCount || 0, avgResolutionTime: statsData?.data?.avgResolutionTime || 0, mttr: statsData?.data?.avgResolutionTime || 0 }
  const displayReadiness = isDemoActive ? DEMO_READINESS : readinessData

  const filteredAlerts = displayAlerts.filter((a: Alert) => {
    if (selectedSeverity !== 'all' && a.severity !== selectedSeverity) return false
    if (searchQuery && !a.alertName.toLowerCase().includes(searchQuery.toLowerCase()) && !a.serviceName?.toLowerCase().includes(searchQuery.toLowerCase())) return false
    return true
  })

  const formatTime = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

  const scoreColor = (s: number) => s >= 80 ? '#059669' : s >= 65 ? '#D97706' : '#DC2626'
  const scoreBg = (s: number) => s >= 80 ? 'bg-green-50 border-green-600' : s >= 65 ? 'bg-amber-50 border-amber-500' : 'bg-red-50 border-red-600'

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 max-w-[1320px] mx-auto">

      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mb-1.5">Incident Resolution Insights</h1>
          <p className="text-sm text-slate-500 leading-relaxed">Reliability intelligence · Mean time to resolve · Incident patterns · Last 30d</p>
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

      {/* AI Insight */}
      <div className="bg-white rounded-xl border border-slate-100 px-4 sm:px-6 py-4 mb-6 flex items-start gap-3.5">
        <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center shrink-0"><Sparkles size={13} className="text-white" /></div>
        <div className="flex-1">
          <p className="text-[10px] font-semibold text-violet-600 uppercase tracking-widest mb-1">AI Insight</p>
          <p className="text-sm text-slate-700 leading-relaxed">
            {isDemoActive
              ? '4 critical alerts resolved in the last 72 hours. RDS Failover and S3 Bucket Policy Change had the fastest resolution times (8m and 3m). Average MTTR is 17 minutes — Elite tier performance.'
              : displayReadiness
                ? (() => { const s = displayReadiness.readiness_score; const g = displayReadiness.top_gaps[0]; if (s >= 85) return 'System is fully prepared for incident detection. All services have alert coverage and metrics are reporting normally.'; if (s >= 65) return `System is ${Math.round(s)}% ready for incident detection. ${g ? g.message + '. Fix this to improve response time.' : 'Minor gaps exist in coverage.'}`; return `Incident detection is at risk (${Math.round(s)}/100). ${g ? g.message : 'Multiple coverage gaps detected.'} Resolve gaps before the next incident occurs.` })()
                : 'Connect your AWS account to begin incident readiness monitoring.'}
          </p>
        </div>
        <a href="/observability/alerts" className="text-xs font-semibold text-violet-600 no-underline shrink-0 flex items-center gap-1 whitespace-nowrap">Active alerts <ArrowRight size={11} /></a>
      </div>

      {/* Readiness banner */}
      {displayReadiness && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 sm:p-7 mb-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-5">
            <div className="flex items-center gap-4">
              <div className={`w-14 h-14 rounded-full border-2 flex flex-col items-center justify-center shrink-0 ${scoreBg(displayReadiness.readiness_score)}`}>
                <span className="text-xl font-bold leading-none" style={{ color: scoreColor(displayReadiness.readiness_score) }}>{displayReadiness.readiness_score}</span>
                <span className="text-[9px] text-slate-400 font-semibold uppercase tracking-widest">/100</span>
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <p className="text-base font-bold text-slate-900">Incident Readiness</p>
                  <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full" style={{ background: scoreBg(displayReadiness.readiness_score).includes('green') ? '#F0FDF4' : scoreBg(displayReadiness.readiness_score).includes('amber') ? '#FFFBEB' : '#FEF2F2', color: scoreColor(displayReadiness.readiness_score) }}>{displayReadiness.status}</span>
                </div>
                <p className="text-xs text-slate-500">{displayReadiness.top_gaps.length === 0 ? 'All systems ready — full incident detection coverage' : `${displayReadiness.top_gaps.length} gap${displayReadiness.top_gaps.length !== 1 ? 's' : ''} reducing detection capability`}</p>
                {displayReadiness.readiness_score < 80 && (
                  <p className="text-xs font-medium mt-1" style={{ color: scoreColor(displayReadiness.readiness_score) }}>
                    {displayReadiness.readiness_score < 65 ? 'Incidents may go undetected — immediate action required' : 'Detection and response may be delayed for critical failures'}
                  </p>
                )}
              </div>
            </div>
            {displayReadiness.top_gaps[0] && (
              <a href={displayReadiness.top_gaps[0].actionPath} className="bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 rounded-lg text-xs font-semibold no-underline transition-colors whitespace-nowrap self-start sm:self-auto">
                {displayReadiness.top_gaps[0].action} →
              </a>
            )}
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {Object.values(displayReadiness.components).map((comp: any) => {
              const isRisk = comp.status === 'risk', isWarn = comp.status === 'warning'
              return (
                <div key={comp.label} className={`rounded-xl p-3.5 border ${isRisk ? 'bg-red-50 border-l-[3px] border-red-600 border-t-red-100 border-r-red-100 border-b-red-100' : isWarn ? 'bg-amber-50 border-l-[3px] border-amber-500 border-t-amber-100 border-r-amber-100 border-b-amber-100' : 'bg-slate-50 border-slate-100'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{comp.label}</p>
                    {comp.status === 'good' ? <CheckCircle2 size={12} className="text-green-600 shrink-0" /> : comp.status === 'warning' ? <AlertTriangle size={12} className="text-amber-500 shrink-0" /> : <XCircle size={12} className="text-red-600 shrink-0" />}
                  </div>
                  <div className="text-xl font-bold leading-none mb-1.5" style={{ color: scoreColor(comp.score) }}>{comp.score}%</div>
                  <p className="text-[10px] text-slate-400 leading-snug">{comp.detail}</p>
                </div>
              )
            })}
          </div>
        </div>
      )}

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
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-3">{label}</p>
              {value !== null ? <div className="text-3xl font-bold text-slate-900 tracking-tight leading-none mb-2">{value}</div> : <div className="text-sm font-medium text-slate-300 mb-2 pt-1.5">{empty}</div>}
              <p className="text-xs text-slate-400 leading-relaxed">{sub}</p>
            </div>
          ))}
        </div>
      )}

      {/* Top priority action */}
      {displayReadiness && (displayReadiness.components.response_config.score === 0 || displayReadiness.components.monitoring_coverage.score < 50) && (
        <div className="bg-red-50 border border-red-100 border-l-[4px] border-l-red-600 rounded-xl px-4 sm:px-5 py-4 mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold text-red-600 uppercase tracking-widest mb-1">Top Priority</p>
            <p className="text-sm font-semibold text-slate-900 mb-0.5">{displayReadiness.components.response_config.score === 0 ? 'Configure alert destinations' : 'Restore metric reporting for 2 services'}</p>
            <p className="text-xs text-red-600">{displayReadiness.components.response_config.score === 0 ? 'Without this, your team will not be notified when incidents occur' : 'Services are not sending metrics — incidents may go undetected'}</p>
          </div>
          <a href={displayReadiness.components.response_config.score === 0 ? '/settings/notifications' : '/admin/monitoring'} className="bg-red-600 hover:bg-red-700 text-white px-4 py-2.5 rounded-lg text-xs font-bold no-underline whitespace-nowrap self-start sm:self-auto transition-colors">Fix now →</a>
        </div>
      )}

      {/* Coverage gaps */}
      {displayReadiness?.top_gaps?.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-6 mb-6">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">Coverage Gaps</p>
          <div className="flex flex-col gap-2.5">
            {[...displayReadiness.top_gaps].sort((a: any, b: any) => ({ high: 0, medium: 1, low: 2 }[a.severity as string] ?? 2) - ({ high: 0, medium: 1, low: 2 }[b.severity as string] ?? 2)).map((gap: any, i: number) => (
              <div key={i} className={`flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 px-4 py-3 rounded-xl border ${gap.severity === 'high' ? 'bg-red-50 border-red-100' : 'bg-amber-50 border-amber-200'}`}>
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
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-0.5">Alert Timeline</p>
            <p className="text-xs text-slate-400">{filteredAlerts.length} records</p>
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
              <span key={col} className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{col}</span>
            ))}
          </div>
          {isLoading && !isDemoActive ? (
            <div className="p-12 text-center"><RefreshCw size={18} className="text-slate-300 mx-auto mb-3" /><p className="text-sm text-slate-400">Loading alert history...</p></div>
          ) : filteredAlerts.length === 0 ? (
            <EmptyHistory />
          ) : filteredAlerts.map((alert: Alert, idx: number) => {
            const sevCls = alert.severity === 'critical' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'
            const cost = (alert as any).costImpact
            return (
              <div key={alert.id} className={`grid px-7 py-3.5 items-center hover:bg-slate-50 transition-colors min-w-[780px] ${idx < filteredAlerts.length - 1 ? 'border-b border-slate-50' : ''}`} style={{ gridTemplateColumns: '2fr 130px 110px 100px 90px 140px 140px' }}>
                <div>
                  <p className="text-sm font-semibold text-slate-900 mb-0.5">{alert.alertName}</p>
                  <p className="text-[11px] text-slate-400 truncate max-w-xs">{alert.description}</p>
                </div>
                <span className="text-xs text-slate-500 font-mono">{alert.serviceName || '—'}</span>
                <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full w-fit capitalize ${sevCls}`}>{alert.severity}</span>
                <span className={`text-xs font-semibold ${isDemoActive && cost && cost !== '$0' ? 'text-red-600' : 'text-slate-300'}`}>{isDemoActive ? (cost ?? '—') : '—'}</span>
                <span className="text-xs text-slate-400">{alert.durationMinutes ? `${alert.durationMinutes}m` : '—'}</span>
                <span className="text-xs text-slate-400">{formatTime(alert.startedAt)}</span>
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
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize shrink-0 ${sevCls}`}>{alert.severity}</span>
                </div>
                <p className="text-xs text-slate-400 mb-1.5 line-clamp-2">{alert.description}</p>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-400 font-mono">{alert.serviceName}</span>
                  <div className="flex gap-3 text-[11px] text-slate-400">
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
      <p className="text-base font-semibold text-slate-900 mb-2">No incidents recorded yet</p>
      <p className="text-sm text-slate-400 leading-relaxed mb-1 max-w-sm mx-auto">When alerts are triggered, this timeline will show what happened, which service was affected, how long it lasted, and how quickly it was resolved.</p>
      <p className="text-xs text-slate-300 mb-6">Use this to audit reliability and improve engineering response times.</p>
      <a href="/observability/alerts" className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white px-5 py-2.5 rounded-lg text-xs font-semibold no-underline transition-colors">Configure Alerts →</a>
    </div>
  )
}