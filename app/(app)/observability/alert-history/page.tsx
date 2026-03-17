'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useDemoMode } from '@/components/demo/demo-mode-toggle'
import { useSalesDemo } from '@/lib/demo/sales-demo-data'
import { alertHistoryService } from '@/lib/services/alert-history.service'
import { Alert, AlertFilters, DateRangeOption } from '@/lib/types'
import {
  Sparkles, ArrowRight, RefreshCw, CheckCircle2,
  Clock, Bell, TrendingDown, Filter
} from 'lucide-react'

const DEMO_HISTORY: Alert[] = [
  { id: 'h1', alertName: 'High CPU Usage',          serviceName: 'api-gateway',          severity: 'critical', status: 'resolved', description: 'CPU usage above 90% for 15 minutes on api-gateway ECS cluster.',        labels: {}, annotations: {}, startedAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),  durationMinutes: 25, resolvedAt: new Date(Date.now() - 1000 * 60 * 95).toISOString(),       createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'h2', alertName: 'Deployment Failed',       serviceName: 'auth-service',         severity: 'critical', status: 'resolved', description: 'Deployment to staging failed. Rolled back to previous version.',       labels: {}, annotations: {}, startedAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),  durationMinutes: 22, resolvedAt: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(),   createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'h3', alertName: 'Memory Spike',            serviceName: 'analytics-worker',     severity: 'warning',  status: 'resolved', description: 'Memory usage peaked at 94% during batch processing job.',              labels: {}, annotations: {}, startedAt: new Date(Date.now() - 1000 * 60 * 60 * 8).toISOString(),  durationMinutes: 45, resolvedAt: new Date(Date.now() - 1000 * 60 * 60 * 7).toISOString(),   createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'h4', alertName: 'RDS Failover',            serviceName: 'payment-processor',    severity: 'critical', status: 'resolved', description: 'RDS primary instance failover triggered. Standby promoted.',           labels: {}, annotations: {}, startedAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), durationMinutes: 8,  resolvedAt: new Date(Date.now() - 1000 * 60 * 60 * 23).toISOString(),  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'h5', alertName: 'High Latency',            serviceName: 'api-gateway',          severity: 'warning',  status: 'resolved', description: 'p95 latency exceeded 800ms threshold for 10 minutes.',                labels: {}, annotations: {}, startedAt: new Date(Date.now() - 1000 * 60 * 60 * 28).toISOString(), durationMinutes: 18, resolvedAt: new Date(Date.now() - 1000 * 60 * 60 * 27).toISOString(),  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'h6', alertName: 'Certificate Renewed',     serviceName: 'api-gateway',          severity: 'warning',  status: 'resolved', description: 'SSL certificate renewed successfully before expiry.',                 labels: {}, annotations: {}, startedAt: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(), durationMinutes: 5,  resolvedAt: new Date(Date.now() - 1000 * 60 * 60 * 47).toISOString(),  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'h7', alertName: 'Lambda Timeout',          serviceName: 'notification-service', severity: 'warning',  status: 'resolved', description: 'Lambda function exceeded 30s timeout on 3 consecutive invocations.',  labels: {}, annotations: {}, startedAt: new Date(Date.now() - 1000 * 60 * 60 * 52).toISOString(), durationMinutes: 12, resolvedAt: new Date(Date.now() - 1000 * 60 * 60 * 51).toISOString(),  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'h8', alertName: 'S3 Bucket Policy Change', serviceName: 'analytics-worker',     severity: 'critical', status: 'resolved', description: 'Unexpected S3 bucket policy modification detected and reverted.',     labels: {}, annotations: {}, startedAt: new Date(Date.now() - 1000 * 60 * 60 * 72).toISOString(), durationMinutes: 3,  resolvedAt: new Date(Date.now() - 1000 * 60 * 60 * 71).toISOString(),  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
]

const DEMO_STATS = {
  total: 8,
  critical: 4,
  avgResolutionTime: 17,
  mttr: 22,
}

// Local type extends the imported DateRangeOption with 24h for the UI toggle.
// We clamp to a valid DateRangeOption when passing to service calls.
type LocalDateRange = '24h' | DateRangeOption

function toServiceRange(r: LocalDateRange): DateRangeOption {
  return r === '24h' ? '7d' : r
}

export default function AlertHistoryPage() {
  const demoMode = useDemoMode()
  const salesDemoMode = useSalesDemo((state) => state.enabled)
  const isDemoActive = demoMode || salesDemoMode
  const queryClient = useQueryClient()

  const [dateRange, setDateRange] = useState<LocalDateRange>('30d')
  const [selectedSeverity, setSelectedSeverity] = useState<string>('all')
  const [selectedStatus, setSelectedStatus] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState<string>('')

  const serviceRange = toServiceRange(dateRange)

  const filters: AlertFilters = {
    dateRange: serviceRange,
    severity: selectedSeverity !== 'all' ? selectedSeverity as any : undefined,
    status: selectedStatus !== 'all' ? selectedStatus as any : undefined,
  }

  const { data: historyData, isLoading, refetch } = useQuery({
    queryKey: ['alert-history', filters],
    queryFn: () => alertHistoryService.getAlertHistory(filters),
    refetchInterval: 60000,
  })

  const { data: statsData } = useQuery({
    queryKey: ['alert-stats-history', serviceRange],
    queryFn: () => alertHistoryService.getAlertStats({ dateRange: serviceRange }),
    refetchInterval: 60000,
  })

  const displayAlerts: Alert[] = isDemoActive
    ? DEMO_HISTORY
    : (historyData?.data || [])

  const displayStats = isDemoActive
    ? DEMO_STATS
    : {
        total: statsData?.data?.total || 0,
        critical: statsData?.data?.criticalCount || 0,
        avgResolutionTime: statsData?.data?.avgResolutionTime || 0,
        mttr: statsData?.data?.avgResolutionTime || 0,
      }

  const filteredAlerts = displayAlerts.filter((a: Alert) => {
    if (selectedSeverity !== 'all' && a.severity !== selectedSeverity) return false
    if (selectedStatus !== 'all' && a.status !== selectedStatus) return false
    if (searchQuery && !a.alertName.toLowerCase().includes(searchQuery.toLowerCase()) && !a.serviceName?.toLowerCase().includes(searchQuery.toLowerCase())) return false
    return true
  })

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

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
            Alert History
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>
            Historical alert timeline and resolution audit · Last {dateRange}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={() => refetch()}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#fff', color: '#475569', padding: '10px 20px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 500, border: '1px solid #E2E8F0', cursor: 'pointer' }}>
            <RefreshCw size={15} /> Refresh
          </button>
          <a href="/observability/alerts" style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#7C3AED', color: '#fff', padding: '10px 20px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600, textDecoration: 'none' }}>
            <Bell size={15} /> Active Alerts
          </a>
        </div>
      </div>

      {/* AI INSIGHT BANNER */}
      <div style={{ background: '#fff', borderRadius: '12px', padding: '16px 24px', border: '1px solid #F1F5F9', marginBottom: '24px', display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
        <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#7C3AED', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Sparkles size={14} style={{ color: '#fff' }} />
        </div>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#7C3AED', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 4px' }}>AI Insight</p>
          <p style={{ fontSize: '0.875rem', color: '#1E293B', margin: 0, lineHeight: 1.6 }}>
            {isDemoActive
              ? '4 critical alerts resolved in the last 72 hours. RDS Failover and S3 Bucket Policy Change had the fastest resolution times (8m and 3m). Average MTTR is 17 minutes — Elite tier performance. No recurring alert patterns detected.'
              : displayStats.total === 0
                ? 'No alert history found for the selected time range. Adjust filters or expand the date range.'
                : `${displayStats.total} alerts resolved in the selected period. Average resolution time ${displayStats.avgResolutionTime} minutes. ${displayStats.critical} critical alerts were resolved.`
            }
          </p>
        </div>
        <a href="/observability/alerts" style={{ fontSize: '0.78rem', fontWeight: 600, color: '#7C3AED', textDecoration: 'none', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
          Active alerts <ArrowRight size={12} />
        </a>
      </div>

      {/* 4 KPI CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', marginBottom: '28px' }}>
        {[
          { label: 'Total Resolved',    value: displayStats.total,                                                             sub: `Last ${dateRange}`,         valueColor: '#0F172A' },
          { label: 'Critical Resolved', value: displayStats.critical,                                                          sub: 'High severity incidents',   valueColor: displayStats.critical > 0 ? '#DC2626' : '#059669' },
          { label: 'Avg Resolution',    value: displayStats.avgResolutionTime ? `${displayStats.avgResolutionTime}m` : 'N/A',  sub: 'Mean time to resolve',      valueColor: '#059669' },
          { label: 'MTTR',              value: displayStats.mttr ? `${displayStats.mttr}m` : 'N/A',                            sub: 'Mean time to recovery',     valueColor: '#059669' },
        ].map(({ label, value, sub, valueColor }) => (
          <div key={label} style={{ background: '#fff', borderRadius: '14px', padding: '32px', border: '1px solid #E2E8F0' }}>
            <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 16px' }}>{label}</p>
            <div style={{ fontSize: '2.5rem', fontWeight: 700, color: valueColor, letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '8px' }}>{value}</div>
            <p style={{ fontSize: '0.78rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>{sub}</p>
          </div>
        ))}
      </div>

      {/* HISTORY TABLE */}
      <div style={{ background: '#fff', borderRadius: '16px', border: '1px solid #F1F5F9', overflow: 'hidden' }}>

        {/* Table header + filters */}
        <div style={{ padding: '20px 28px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
          <div>
            <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 2px' }}>Alert Timeline</p>
            <p style={{ fontSize: '0.78rem', color: '#94A3B8', margin: 0 }}>{filteredAlerts.length} records</p>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Date range */}
            <div style={{ display: 'flex', background: '#F8FAFC', borderRadius: '8px', padding: '4px', gap: '2px' }}>
              {(['24h', '7d', '30d', '90d'] as LocalDateRange[]).map(r => (
                <button key={r} onClick={() => setDateRange(r)}
                  style={{ padding: '4px 12px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600, border: 'none', cursor: 'pointer',
                    background: dateRange === r ? '#fff' : 'transparent',
                    color: dateRange === r ? '#0F172A' : '#64748B',
                    boxShadow: dateRange === r ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                  }}>{r}</button>
              ))}
            </div>
            {/* Search */}
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search history..."
              style={{ padding: '6px 12px', borderRadius: '8px', border: '1px solid #E2E8F0', fontSize: '0.82rem', color: '#0F172A', outline: 'none', width: '160px' }}
            />
            {/* Severity filter */}
            <div style={{ display: 'flex', background: '#F8FAFC', borderRadius: '8px', padding: '4px', gap: '2px' }}>
              {['all', 'critical', 'warning'].map(s => (
                <button key={s} onClick={() => setSelectedSeverity(s)}
                  style={{ padding: '4px 12px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600, border: 'none', cursor: 'pointer', textTransform: 'capitalize',
                    background: selectedSeverity === s ? '#fff' : 'transparent',
                    color: selectedSeverity === s ? '#0F172A' : '#64748B',
                    boxShadow: selectedSeverity === s ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                  }}>{s === 'all' ? 'All' : s}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Column headers */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 140px 120px 120px 160px 160px', padding: '10px 28px', background: '#F8FAFC', borderBottom: '1px solid #F1F5F9' }}>
          {['Alert', 'Service', 'Severity', 'Duration', 'Started', 'Resolved'].map(col => (
            <span key={col} style={{ fontSize: '0.7rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{col}</span>
          ))}
        </div>

        {/* Rows */}
        {isLoading && !isDemoActive ? (
          <div style={{ padding: '48px', textAlign: 'center' }}>
            <RefreshCw size={20} style={{ color: '#94A3B8', margin: '0 auto 12px' }} />
            <p style={{ fontSize: '0.875rem', color: '#64748B', margin: 0 }}>Loading alert history...</p>
          </div>
        ) : filteredAlerts.length === 0 ? (
          <div style={{ padding: '64px', textAlign: 'center' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#F0FDF4', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <CheckCircle2 size={22} style={{ color: '#059669' }} />
            </div>
            <p style={{ fontSize: '1rem', fontWeight: 600, color: '#0F172A', margin: '0 0 6px' }}>No alert history found</p>
            <p style={{ fontSize: '0.875rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>
              No resolved alerts match your current filters. Try expanding the date range.
            </p>
          </div>
        ) : (
          filteredAlerts.map((alert: Alert, idx: number) => {
            const severityColor = alert.severity === 'critical' ? '#DC2626' : '#D97706'
            const severityBg    = alert.severity === 'critical' ? '#FEF2F2' : '#FFFBEB'
            const duration      = alert.durationMinutes ? `${alert.durationMinutes}m` : '—'

            return (
              <div key={alert.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '2fr 140px 120px 120px 160px 160px',
                  padding: '14px 28px',
                  borderBottom: idx < filteredAlerts.length - 1 ? '1px solid #F8FAFC' : 'none',
                  alignItems: 'center',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = '#F8FAFC' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                {/* Alert name */}
                <div>
                  <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>{alert.alertName}</p>
                  <p style={{ fontSize: '0.72rem', color: '#94A3B8', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '320px' }}>{alert.description}</p>
                </div>

                {/* Service */}
                <span style={{ fontSize: '0.78rem', color: '#475569', fontFamily: 'monospace' }}>{alert.serviceName || '—'}</span>

                {/* Severity */}
                <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '3px 10px', borderRadius: '100px', background: severityBg, color: severityColor, width: 'fit-content', textTransform: 'capitalize' }}>
                  {alert.severity}
                </span>

                {/* Duration */}
                <span style={{ fontSize: '0.78rem', color: '#475569' }}>{duration}</span>

                {/* Started */}
                <span style={{ fontSize: '0.75rem', color: '#64748B' }}>{formatTime(alert.startedAt)}</span>

                {/* Resolved */}
                <span style={{ fontSize: '0.75rem', color: '#059669', fontWeight: 500 }}>
                  {alert.resolvedAt ? formatTime(alert.resolvedAt) : '—'}
                </span>
              </div>
            )
          })
        )}
      </div>

    </div>
  )
}
