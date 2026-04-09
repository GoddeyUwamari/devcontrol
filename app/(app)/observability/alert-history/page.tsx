'use client'

import { useState, useEffect } from 'react'

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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useDemoMode } from '@/components/demo/demo-mode-toggle'
import { useSalesDemo } from '@/lib/demo/sales-demo-data'
import { alertHistoryService } from '@/lib/services/alert-history.service'
import { Alert, AlertFilters, DateRangeOption } from '@/lib/types'
import {
  Sparkles, ArrowRight, RefreshCw,
  Clock, Bell, TrendingDown, Filter, Shield,
  CheckCircle2, AlertTriangle, XCircle, ChevronRight,
} from 'lucide-react'

const DEMO_HISTORY = [
  { id: 'h1', alertName: 'High CPU Usage',          serviceName: 'api-gateway',          severity: 'critical', status: 'resolved', description: 'CPU usage above 90% for 15 minutes on api-gateway ECS cluster.',        labels: {}, annotations: {}, startedAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),  durationMinutes: 25, resolvedAt: new Date(Date.now() - 1000 * 60 * 95).toISOString(),       createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), costImpact: '$1,240' },
  { id: 'h2', alertName: 'Deployment Failed',       serviceName: 'auth-service',         severity: 'critical', status: 'resolved', description: 'Deployment to staging failed. Rolled back to previous version.',       labels: {}, annotations: {}, startedAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),  durationMinutes: 22, resolvedAt: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(),   createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), costImpact: '$890' },
  { id: 'h3', alertName: 'Memory Spike',            serviceName: 'analytics-worker',     severity: 'warning',  status: 'resolved', description: 'Memory usage peaked at 94% during batch processing job.',              labels: {}, annotations: {}, startedAt: new Date(Date.now() - 1000 * 60 * 60 * 8).toISOString(),  durationMinutes: 45, resolvedAt: new Date(Date.now() - 1000 * 60 * 60 * 7).toISOString(),   createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), costImpact: '$340' },
  { id: 'h4', alertName: 'RDS Failover',            serviceName: 'payment-processor',    severity: 'critical', status: 'resolved', description: 'RDS primary instance failover triggered. Standby promoted.',           labels: {}, annotations: {}, startedAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), durationMinutes: 8,  resolvedAt: new Date(Date.now() - 1000 * 60 * 60 * 23).toISOString(),  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), costImpact: '$2,100' },
  { id: 'h5', alertName: 'High Latency',            serviceName: 'api-gateway',          severity: 'warning',  status: 'resolved', description: 'p95 latency exceeded 800ms threshold for 10 minutes.',                labels: {}, annotations: {}, startedAt: new Date(Date.now() - 1000 * 60 * 60 * 28).toISOString(), durationMinutes: 18, resolvedAt: new Date(Date.now() - 1000 * 60 * 60 * 27).toISOString(),  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), costImpact: '$560' },
  { id: 'h6', alertName: 'Certificate Renewed',     serviceName: 'api-gateway',          severity: 'warning',  status: 'resolved', description: 'SSL certificate renewed successfully before expiry.',                 labels: {}, annotations: {}, startedAt: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(), durationMinutes: 5,  resolvedAt: new Date(Date.now() - 1000 * 60 * 60 * 47).toISOString(),  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), costImpact: '$0' },
  { id: 'h7', alertName: 'Lambda Timeout',          serviceName: 'notification-service', severity: 'warning',  status: 'resolved', description: 'Lambda function exceeded 30s timeout on 3 consecutive invocations.',  labels: {}, annotations: {}, startedAt: new Date(Date.now() - 1000 * 60 * 60 * 52).toISOString(), durationMinutes: 12, resolvedAt: new Date(Date.now() - 1000 * 60 * 60 * 51).toISOString(),  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), costImpact: '$180' },
  { id: 'h8', alertName: 'S3 Bucket Policy Change', serviceName: 'analytics-worker',     severity: 'critical', status: 'resolved', description: 'Unexpected S3 bucket policy modification detected and reverted.',     labels: {}, annotations: {}, startedAt: new Date(Date.now() - 1000 * 60 * 60 * 72).toISOString(), durationMinutes: 3,  resolvedAt: new Date(Date.now() - 1000 * 60 * 60 * 71).toISOString(),  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), costImpact: '$3,400' },
] as unknown as Alert[]

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

const API_URL =
  process.env.NEXT_PUBLIC_API_URL
  || 'http://localhost:8080'

async function fetchReadiness() {
  const token =
    typeof window !== 'undefined'
      ? localStorage.getItem('accessToken')
      : null
  const res = await fetch(
    `${API_URL}/api/observability/readiness`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    }
  )
  if (!res.ok) return null
  const data = await res.json()
  return data.success ? data.data : null
}

export default function AlertHistoryPage() {
  const width = useWindowWidth()
  const isMobile = width > 0 && width < 640
  const isTablet = width >= 640 && width < 1024
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

  const { data: readinessData } = useQuery({
    queryKey: ['observability-readiness'],
    queryFn: fetchReadiness,
    refetchInterval: 120000,
    enabled: !isDemoActive,
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

  const DEMO_READINESS = {
    readiness_score: 72,
    status: 'Partially Ready',
    components: {
      alert_coverage: {
        score: 100,
        label: 'Alert Coverage',
        detail: '5 of 5 services have alerts',
        status: 'good',
      },
      monitoring_coverage: {
        score: 80,
        label: 'Monitoring Coverage',
        detail: '4 of 5 services reporting',
        status: 'good',
      },
      critical_service_coverage: {
        score: 100,
        label: 'Critical Coverage',
        detail: '3 of 3 critical services covered',
        status: 'good',
      },
      signal_freshness: {
        score: 80,
        label: 'Signal Freshness',
        detail: 'Metrics up to date',
        status: 'good',
      },
      response_config: {
        score: 0,
        label: 'Response Setup',
        detail: 'No alert destinations configured',
        status: 'risk',
      },
    },
    top_gaps: [
      {
        type: 'response_config',
        severity: 'medium',
        message: 'No on-call routing configured — team will not be notified of incidents',
        action: 'Configure destinations',
        actionPath: '/settings/notifications',
      },
    ],
  }

  const displayReadiness = isDemoActive
    ? DEMO_READINESS
    : readinessData

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
      padding: isMobile ? '24px 16px' : isTablet ? '40px 24px' : '40px 56px 64px',
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
            Incident Resolution Insights
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>
            Reliability intelligence · Mean time to resolve · Incident patterns · Last 30d
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
              : displayReadiness
                ? (() => {
                    const score = displayReadiness.readiness_score
                    const gaps = displayReadiness.top_gaps
                    const worstGap = gaps[0]

                    if (score >= 85) {
                      return 'System is fully prepared for incident detection. All services have alert coverage and metrics are reporting normally.'
                    }
                    if (score >= 65) {
                      return `System is ${Math.round(score)}% ready for incident detection. ${worstGap ? worstGap.message + '. Fix this to improve response time.' : 'Minor gaps exist in coverage.'}`
                    }
                    return `Incident detection is at risk (${Math.round(score)}/100). ${worstGap ? worstGap.message : 'Multiple coverage gaps detected.'} Resolve gaps before the next incident occurs.`
                  })()
                : 'Connect your AWS account to begin incident readiness monitoring.'
            }
          </p>
        </div>
        <a href="/observability/alerts" style={{ fontSize: '0.78rem', fontWeight: 600, color: '#7C3AED', textDecoration: 'none', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
          Active alerts <ArrowRight size={12} />
        </a>
      </div>

      {/* READINESS BANNER */}
      {displayReadiness && (
        <div style={{
          background: '#fff',
          borderRadius: '14px',
          border: '1px solid #E2E8F0',
          padding: '24px 28px',
          marginBottom: '20px',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '20px',
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '16px',
            }}>
              {/* Score circle */}
              <div style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                background:
                  displayReadiness.readiness_score >= 80
                    ? '#F0FDF4'
                    : displayReadiness.readiness_score >= 65
                      ? '#FFFBEB'
                      : '#FEF2F2',
                border: `2px solid ${
                  displayReadiness.readiness_score >= 80
                    ? '#059669'
                    : displayReadiness.readiness_score >= 65
                      ? '#D97706'
                      : '#DC2626'
                }`,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
                <span style={{
                  fontSize: '1.25rem',
                  fontWeight: 700,
                  color:
                    displayReadiness.readiness_score >= 80
                      ? '#059669'
                      : displayReadiness.readiness_score >= 65
                        ? '#D97706'
                        : '#DC2626',
                  lineHeight: 1,
                }}>
                  {displayReadiness.readiness_score}
                </span>
                <span style={{
                  fontSize: '0.55rem',
                  color: '#94A3B8',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}>
                  /100
                </span>
              </div>
              <div>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginBottom: '4px',
                }}>
                  <p style={{
                    fontSize: '1rem',
                    fontWeight: 700,
                    color: '#0F172A',
                    margin: 0,
                  }}>
                    Incident Readiness
                  </p>
                  <span style={{
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    padding: '2px 9px',
                    borderRadius: '100px',
                    background:
                      displayReadiness.readiness_score >= 80
                        ? '#F0FDF4'
                        : displayReadiness.readiness_score >= 65
                          ? '#FFFBEB'
                          : '#FEF2F2',
                    color:
                      displayReadiness.readiness_score >= 80
                        ? '#059669'
                        : displayReadiness.readiness_score >= 65
                          ? '#D97706'
                          : '#DC2626',
                  }}>
                    {displayReadiness.status}
                  </span>
                </div>
                <p style={{
                  fontSize: '0.82rem',
                  color: '#475569',
                  margin: 0,
                }}>
                  {displayReadiness.top_gaps.length === 0
                    ? 'All systems ready — full incident detection coverage'
                    : `${displayReadiness.top_gaps.length} gap${displayReadiness.top_gaps.length !== 1 ? 's' : ''} reducing detection capability`
                  }
                </p>
                {displayReadiness.readiness_score < 80 && (
                  <p style={{
                    fontSize: '0.72rem',
                    color:
                      displayReadiness.readiness_score < 65
                        ? '#DC2626' : '#D97706',
                    margin: '4px 0 0',
                    fontWeight: 500,
                  }}>
                    {displayReadiness.readiness_score < 65
                      ? 'Incidents may go undetected — immediate action required'
                      : 'Detection and response may be delayed for critical failures'
                    }
                  </p>
                )}
              </div>
            </div>

            {/* Top gap CTA */}
            {displayReadiness.top_gaps[0] && (
              <a
                href={displayReadiness.top_gaps[0].actionPath}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: '#7C3AED',
                  color: '#fff',
                  padding: '8px 16px',
                  borderRadius: '8px',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  textDecoration: 'none',
                  flexShrink: 0,
                }}
              >
                {displayReadiness.top_gaps[0].action} →
              </a>
            )}
          </div>

          {/* Component cards */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : isTablet ? 'repeat(2,1fr)' : 'repeat(5, 1fr)',
            gap: '12px',
          }}>
            {Object.values(displayReadiness.components).map((comp: any) => {
              const cardSeverityStyle = (status: string) => {
                if (status === 'risk') return {
                  background: '#FEF2F2',
                  border: '1px solid #FECACA',
                  borderLeft: '3px solid #DC2626',
                }
                if (status === 'warning') return {
                  background: '#FFFBEB',
                  border: '1px solid #FDE68A',
                  borderLeft: '3px solid #D97706',
                }
                return {
                  background: '#F8FAFC',
                  border: '1px solid #F1F5F9',
                  borderLeft: '1px solid #F1F5F9',
                }
              }
              return (
              <div key={comp.label} style={{
                borderRadius: '10px',
                padding: '14px 16px',
                ...cardSeverityStyle(comp.status),
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '8px',
                }}>
                  <p style={{
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    color: '#475569',
                    textTransform: 'uppercase',
                    letterSpacing: '0.07em',
                    margin: 0,
                  }}>
                    {comp.label}
                  </p>
                  {comp.status === 'good'
                    ? <CheckCircle2 size={13} style={{ color: '#059669', flexShrink: 0 }} />
                    : comp.status === 'warning'
                      ? <AlertTriangle size={13} style={{ color: '#D97706', flexShrink: 0 }} />
                      : <XCircle size={13} style={{ color: '#DC2626', flexShrink: 0 }} />
                  }
                </div>
                <div style={{
                  fontSize: '1.5rem',
                  fontWeight: 700,
                  color:
                    comp.status === 'good'
                      ? '#059669'
                      : comp.status === 'warning'
                        ? '#D97706'
                        : '#DC2626',
                  lineHeight: 1,
                  marginBottom: '6px',
                  letterSpacing: '-0.02em',
                }}>
                  {comp.score}%
                </div>
                <p style={{
                  fontSize: '0.7rem',
                  color: '#64748B',
                  margin: 0,
                  lineHeight: 1.4,
                }}>
                  {comp.detail}
                </p>
              </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 4 KPI CARDS — only in demo mode or when incidents exist */}
      {(isDemoActive || displayStats.total > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : isTablet ? 'repeat(2,1fr)' : 'repeat(4, 1fr)', gap: '20px', marginBottom: '28px' }}>
          {[
            {
              label: 'Total Resolved',
              value: displayStats.total > 0 ? displayStats.total : null,
              empty: 'No incidents yet',
              sub: `Last ${dateRange}`,
              valueColor: '#0F172A',
              hero: false,
            },
            {
              label: 'Critical Resolved',
              value: displayStats.critical > 0 ? displayStats.critical : null,
              empty: 'No incidents yet',
              sub: 'High severity incidents',
              valueColor: '#0F172A',
              hero: false,
            },
            {
              label: 'Avg Resolution',
              value: displayStats.avgResolutionTime ? `${displayStats.avgResolutionTime}m` : null,
              empty: 'Available after first incident',
              sub: 'Mean time to resolve',
              valueColor: '#0F172A',
              hero: false,
            },
            {
              label: 'MTTR',
              value: displayStats.mttr ? `${displayStats.mttr}m` : null,
              empty: 'Available after first incident',
              sub: isDemoActive ? 'vs 45m industry avg · Elite' : 'Mean time to recovery',
              valueColor: '#0F172A',
              hero: true,
            },
          ].map(({ label, value, empty, sub, valueColor, hero }) => (
            <div key={label} style={{
              background: '#fff',
              borderRadius: '14px',
              padding: isMobile ? '16px 14px' : '32px',
              border: '1px solid #E2E8F0',
              borderLeft: hero ? '3px solid #7C3AED' : '1px solid #E2E8F0',
            }}>
              <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569',
                textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 16px' }}>
                {label}
              </p>
              {value !== null ? (
                <div style={{ fontSize: '2.5rem', fontWeight: 700, color: valueColor,
                  letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '8px' }}>
                  {value}
                </div>
              ) : (
                <div style={{ fontSize: '0.875rem', fontWeight: 500, color: '#9ca3af',
                  marginBottom: '8px', paddingTop: '6px' }}>
                  {empty}
                </div>
              )}
              <p style={{ fontSize: '0.78rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>{sub}</p>
            </div>
          ))}
        </div>
      )}

      {/* TOP PRIORITY ACTION */}
      {displayReadiness && (
        displayReadiness.components.response_config.score === 0 ||
        displayReadiness.components.monitoring_coverage.score < 50
      ) && (
        <div style={{
          background: '#FEF2F2',
          border: '1px solid #FECACA',
          borderLeft: '4px solid #DC2626',
          borderRadius: '12px',
          padding: '16px 20px',
          marginBottom: '16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '16px',
        }}>
          <div>
            <p style={{
              fontSize: '0.62rem',
              fontWeight: 700,
              color: '#DC2626',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              margin: '0 0 4px',
            }}>
              Top Priority
            </p>
            <p style={{
              fontSize: '0.875rem',
              fontWeight: 600,
              color: '#0F172A',
              margin: '0 0 2px',
            }}>
              {displayReadiness.components.response_config.score === 0
                ? 'Configure alert destinations'
                : 'Restore metric reporting for 2 services'
              }
            </p>
            <p style={{
              fontSize: '0.78rem',
              color: '#DC2626',
              margin: 0,
            }}>
              {displayReadiness.components.response_config.score === 0
                ? 'Without this, your team will not be notified when incidents occur'
                : 'Services are not sending metrics — incidents may go undetected'
              }
            </p>
          </div>
          <a
            href={
              displayReadiness.components.response_config.score === 0
                ? '/settings/notifications'
                : '/admin/monitoring'
            }
            style={{
              background: '#DC2626',
              color: '#fff',
              padding: '9px 18px',
              borderRadius: '8px',
              fontSize: '0.78rem',
              fontWeight: 700,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            Fix now →
          </a>
        </div>
      )}

      {/* TOP GAPS */}
      {displayReadiness?.top_gaps?.length > 0 && (
        <div style={{
          background: '#fff',
          borderRadius: '12px',
          border: '1px solid #E2E8F0',
          padding: '20px 24px',
          marginBottom: '24px',
        }}>
          <p style={{
            fontSize: '0.7rem',
            fontWeight: 700,
            color: '#475569',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            margin: '0 0 14px',
          }}>
            Coverage Gaps
          </p>
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}>
            {[...displayReadiness.top_gaps]
              .sort((a: any, b: any) => {
                const order = { high: 0, medium: 1, low: 2 }
                return (
                  (order[a.severity as keyof typeof order] ?? 2) -
                  (order[b.severity as keyof typeof order] ?? 2)
                )
              })
              .map((gap: any, i: number) => (
              <div key={i} style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: '16px',
                padding: '12px 16px',
                borderRadius: '8px',
                background: gap.severity === 'high' ? '#FEF2F2' : '#FFFBEB',
                border: `1px solid ${gap.severity === 'high' ? '#FECACA' : '#FDE68A'}`,
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                }}>
                  <AlertTriangle
                    size={14}
                    style={{
                      color: gap.severity === 'high' ? '#DC2626' : '#D97706',
                      flexShrink: 0,
                      marginTop: '1px',
                    }}
                  />
                  <p style={{
                    fontSize: '0.82rem',
                    color: '#374151',
                    margin: 0,
                    lineHeight: 1.5,
                  }}>
                    {gap.message}
                  </p>
                </div>
                <a
                  href={gap.actionPath}
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: '#7C3AED',
                    textDecoration: 'none',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  {gap.action} →
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* HISTORY TABLE */}
      <div style={{ background: '#fff', borderRadius: '16px', border: '1px solid #F1F5F9', overflow: 'hidden', overflowX: isMobile ? 'auto' : 'hidden' }}>

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
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 140px 120px 100px 120px 150px 150px', padding: '10px 28px', background: '#F8FAFC', borderBottom: '1px solid #F1F5F9' }}>
          {['Alert', 'Service', 'Severity', 'Cost Impact', 'Duration', 'Started', 'Resolved'].map(col => (
            <span key={col} style={{ fontSize: '0.7rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{col}</span>
          ))}
        </div>

        {/* Rows */}
        {isLoading && !isDemoActive ? (
          <div style={{ padding: isMobile ? '16px 14px' : '48px', textAlign: 'center' }}>
            <RefreshCw size={20} style={{ color: '#94A3B8', margin: '0 auto 12px' }} />
            <p style={{ fontSize: '0.875rem', color: '#64748B', margin: 0 }}>Loading alert history...</p>
          </div>
        ) : filteredAlerts.length === 0 ? (
          <div style={{ padding: isMobile ? '16px 14px' : '64px 40px', textAlign: 'center' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '12px',
              background: '#F5F3FF', display: 'flex', alignItems: 'center',
              justifyContent: 'center', margin: '0 auto 16px' }}>
              <Shield size={22} style={{ color: '#7C3AED' }} />
            </div>
            <p style={{ fontSize: '1rem', fontWeight: 600, color: '#0F172A', margin: '0 0 8px' }}>
              No incidents recorded yet
            </p>
            <p style={{ fontSize: '0.82rem', color: '#64748B', margin: '0 0 6px', lineHeight: 1.7 }}>
              When alerts are triggered, this timeline will show what happened,<br />
              which service was affected, how long it lasted, and how quickly it was resolved.
            </p>
            <p style={{ fontSize: '0.78rem', color: '#94A3B8', margin: '0 0 24px' }}>
              Use this to audit reliability and improve engineering response times.
            </p>
            <a href="/observability/alerts" style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              background: '#7C3AED', color: '#fff', padding: '9px 20px',
              borderRadius: '8px', fontSize: '0.82rem', fontWeight: 600,
              textDecoration: 'none',
            }}>
              Configure Alerts →
            </a>
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
                  gridTemplateColumns: '2fr 140px 120px 100px 120px 150px 150px',
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

                {/* Cost Impact */}
                <span style={{ fontSize: '0.78rem', fontWeight: 600,
                  color: (alert as any).costImpact && (alert as any).costImpact !== '$0' ? '#DC2626' : '#9ca3af' }}>
                  {isDemoActive ? ((alert as any).costImpact ?? '—') : '—'}
                </span>

                {/* Duration */}
                <span style={{ fontSize: '0.78rem', color: '#475569' }}>{duration}</span>

                {/* Started */}
                <span style={{ fontSize: '0.75rem', color: '#64748B' }}>{formatTime(alert.startedAt)}</span>

                {/* Resolved */}
                <span style={{ fontSize: '0.75rem', color: '#475569', fontWeight: 500 }}>
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
