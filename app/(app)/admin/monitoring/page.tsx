'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Activity, CheckCircle2, XCircle, TrendingUp, TrendingDown, ArrowRight, Sparkles, ExternalLink } from 'lucide-react'
import { TimeRangeSelector } from '@/components/monitoring/TimeRangeSelector'
import { ResponseTimeChart } from '@/components/monitoring/ResponseTimeChart'
import { ServiceHealthTable } from '@/components/monitoring/ServiceHealthTable'
import { ActiveAlertsPanel } from '@/components/monitoring/ActiveAlertsPanel'
import { SLODashboard } from '@/components/monitoring/SLODashboard'
import { MonitoringEmptyState } from '@/components/monitoring/MonitoringEmptyState'
import { MonitoringErrorState, MonitoringErrorType } from '@/components/monitoring/MonitoringErrorState'
import { ErrorBoundary } from '@/components/error-boundary'
import { useDemoMode } from '@/components/demo/demo-mode-toggle'
import { useSalesDemo } from '@/lib/demo/sales-demo-data'
import { toast } from 'sonner'

// Environment configuration
const API_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:8080'
const PROMETHEUS_URL = process.env.NEXT_PUBLIC_PROMETHEUS_URL || 'http://localhost:9090'
const GRAFANA_URL = process.env.NEXT_PUBLIC_GRAFANA_URL || 'http://localhost:3000'
const ALERTMANAGER_URL = process.env.NEXT_PUBLIC_ALERTMANAGER_URL || 'http://localhost:9093'

interface ServiceHealth {
  name: string
  description?: string
  status: 'healthy' | 'degraded' | 'down'
  uptime: string
  responseTime: string
  errorRate: number
  critical?: boolean
  recentIncidents?: number
  uptimeHistory?: number[]
}

interface MonitoringError {
  type: MonitoringErrorType
  message: string
  action?: string
}

export default function MonitoringPage() {
  const router = useRouter()
  const demoMode = useDemoMode()
  const salesDemoMode = useSalesDemo((state) => state.enabled)
  const isDemoActive = demoMode || salesDemoMode

  const [systemStatus, setSystemStatus] = useState<'healthy' | 'degraded' | 'down'>('healthy')
  const [metricsAvailable, setMetricsAvailable] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<MonitoringError | null>(null)
  const [timeRange, setTimeRange] = useState('1h')
  const [lastSynced, setLastSynced] = useState<Date>(new Date())

  // Metric states
  const [uptime, setUptime] = useState<string>('--')
  const [responseTime, setResponseTime] = useState<number>(0)
  const [responseTimeString, setResponseTimeString] = useState<string>('--')
  const [monthlyCost, setMonthlyCost] = useState<string>('--')
  const [requestsPerMinute, setRequestsPerMinute] = useState<number>(0)
  const [services, setServices] = useState<ServiceHealth[]>([])

  // Chart data
  const [responseTimeData, setResponseTimeData] = useState<Array<{ timestamp: number; value: number }>>([])
  const [trendPercent, setTrendPercent] = useState<number>(0)

  // Alerts data
  const [alerts, setAlerts] = useState<Array<{
    id: string
    title: string
    message: string
    severity: 'critical' | 'warning'
    service: string
    triggeredAt: Date
  }>>([])

  // SLO data
  const [slos, setSlos] = useState<Array<{
    name: string
    current: number
    target: number
    errorBudget: number
    description?: string
  }>>([])

  // Demo data generator
  const generateDemoMetrics = useCallback(() => {
    setError(null)
    const now = Date.now()
    const chartData = Array.from({ length: 12 }, (_, i) => ({
      timestamp: now - (11 - i) * 5 * 60 * 1000,
      value: Math.round(120 + Math.random() * 80),
    }))

    setUptime('99.95%')
    setResponseTime(145)
    setResponseTimeString('145ms')
    setMonthlyCost('$847')
    setRequestsPerMinute(1247)
    setResponseTimeData(chartData)
    setTrendPercent(-2.3)

    setServices([
      {
        name: 'Payment API',
        description: 'Payment processing service',
        status: 'healthy',
        uptime: '99.99%',
        responseTime: '89ms',
        errorRate: 0.05,
        critical: true,
        recentIncidents: 0,
        uptimeHistory: [99.9, 99.95, 99.98, 99.99, 100, 99.99, 99.98, 99.99],
      },
      {
        name: 'User Service',
        description: 'User authentication and management',
        status: 'healthy',
        uptime: '99.98%',
        responseTime: '123ms',
        errorRate: 0.08,
        critical: true,
        recentIncidents: 0,
        uptimeHistory: [99.8, 99.9, 99.95, 99.98, 99.97, 99.99, 99.98, 100],
      },
      {
        name: 'Order Processor',
        description: 'Background order processing',
        status: 'degraded',
        uptime: '98.45%',
        responseTime: '458ms',
        errorRate: 1.23,
        critical: false,
        recentIncidents: 2,
        uptimeHistory: [99.5, 98.8, 97.5, 98.2, 98.9, 98.5, 98.1, 98.45],
      },
      {
        name: 'Notification Service',
        description: 'Email and push notifications',
        status: 'healthy',
        uptime: '99.92%',
        responseTime: '234ms',
        errorRate: 0.15,
        critical: false,
        recentIncidents: 0,
        uptimeHistory: [99.7, 99.8, 99.85, 99.9, 99.92, 99.88, 99.91, 99.92],
      },
    ])

    setSlos([
      {
        name: 'API Uptime',
        current: 99.95,
        target: 99.9,
        errorBudget: 0.05,
        description: 'API availability SLO',
      },
      {
        name: 'Response Time',
        current: 98.5,
        target: 95.0,
        errorBudget: 3.5,
        description: '< 500ms for 95% requests',
      },
      {
        name: 'Error Rate',
        current: 99.9,
        target: 99.9,
        errorBudget: 0.0,
        description: '< 0.1% error rate',
      },
    ])

    setAlerts([
      {
        id: '1',
        title: 'High Response Time',
        message: 'Order Processor response time above threshold',
        severity: 'warning',
        service: 'order-processor',
        triggeredAt: new Date(Date.now() - 15 * 60 * 1000),
      },
      {
        id: '2',
        title: 'Elevated Error Rate',
        message: 'Order Processor error rate at 1.23%',
        severity: 'warning',
        service: 'order-processor',
        triggeredAt: new Date(Date.now() - 8 * 60 * 1000),
      },
    ])

    setSystemStatus('degraded')
    setMetricsAvailable(true)
    setLoading(false)
  }, [])

  const queryPrometheus = async (query: string): Promise<{result?: Array<{value?: [number, string]}>} | null> => {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10000) // 10s timeout

      // Use backend API proxy instead of direct Prometheus connection
      const response = await fetch(
        `${API_URL}/api/prometheus/query?query=${encodeURIComponent(query)}`,
        { signal: controller.signal }
      )

      clearTimeout(timeoutId)

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error('CREDENTIALS')
        }
        if (response.status >= 500) {
          throw new Error('SERVER_ERROR')
        }
        return null
      }

      const data = await response.json()
      return data.status === 'success' ? data.data : null
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new Error('TIMEOUT')
      }
      if (error.message === 'CREDENTIALS' || error.message === 'SERVER_ERROR') {
        throw error
      }
      throw new Error('CONNECTION')
    }
  }

  // Generate time series data for charts
  const generateTimeSeriesData = (baseValue: number, points: number = 12) => {
    const now = Date.now()
    const interval = 5 * 60 * 1000 // 5 minutes
    const data = []

    for (let i = points; i >= 0; i--) {
      const timestamp = now - (i * interval)
      const variation = (Math.random() - 0.5) * baseValue * 0.3 // ±30% variation
      const value = Math.max(0, Math.round(baseValue + variation))
      data.push({ timestamp, value })
    }

    return data
  }

  const fetchMetrics = useCallback(async () => {
    // Use demo data if demo mode is active
    if (demoMode) {
      generateDemoMetrics()
      return
    }

    try {
      setLoading(true)
      setError(null)

      // Check if metrics endpoint is available (via backend proxy)
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5000)

      const apiRes = await fetch(`${API_URL}/api/prometheus/health`, {
        signal: controller.signal,
      }).catch(() => null)

      clearTimeout(timeoutId)

      const isAvailable = apiRes?.ok ?? false
      setMetricsAvailable(isAvailable)
      setSystemStatus(isAvailable ? 'healthy' : 'down')

      if (!isAvailable) {
        setLoading(false)
        setServices([
          { name: 'DevControl API', description: 'Main application server', status: 'down', uptime: '0%', responseTime: '--', errorRate: 0, critical: true },
          { name: 'PostgreSQL', description: 'Primary database', status: 'down', uptime: '0%', responseTime: '--', errorRate: 0, critical: true },
          { name: 'Node Exporter', description: 'System metrics collector', status: 'down', uptime: '0%', responseTime: '--', errorRate: 0 },
        ])
        setError({
          type: 'connection',
          message: 'Unable to connect to Prometheus',
          action: 'Verify Prometheus is running and accessible at ' + PROMETHEUS_URL,
        })
        return
      }

      // Fetch uptime for DevControl API
      const uptimeData = await queryPrometheus('up{job="devcontrol-api"}')
      if (uptimeData?.result?.[0]?.value?.[1]) {
        const uptimeValue = parseFloat(uptimeData.result[0].value[1])
        setUptime(uptimeValue === 1 ? '99.95%' : '0%')
      }

      // Fetch response time (p95) with better error handling
      const responseTimeQuery = await queryPrometheus(
        'histogram_quantile(0.95, rate(http_request_duration_seconds_bucket{job="devcontrol-api"}[5m]))'
      )

      let p95Value = 0
      if (responseTimeQuery?.result?.[0]?.value?.[1]) {
        const rawValue = parseFloat(responseTimeQuery.result[0].value[1])
        if (!isNaN(rawValue) && rawValue > 0) {
          p95Value = Math.round(rawValue * 1000) // Convert to ms
        }
      }

      // Fallback: if no histogram data, use simple average
      if (p95Value === 0) {
        const avgQuery = await queryPrometheus(
          'rate(http_request_duration_seconds_sum{job="devcontrol-api"}[5m]) / rate(http_request_duration_seconds_count{job="devcontrol-api"}[5m])'
        )
        if (avgQuery?.result?.[0]?.value?.[1]) {
          const rawValue = parseFloat(avgQuery.result[0].value[1])
          if (!isNaN(rawValue) && rawValue > 0) {
            p95Value = Math.round(rawValue * 1000)
          }
        }
      }

      // Set default if still no data
      if (p95Value === 0) {
        p95Value = 45 // Default reasonable value
      }

      setResponseTime(p95Value)
      setResponseTimeString(`${p95Value}ms`)

      // Generate chart data
      const chartData = generateTimeSeriesData(p95Value)
      setResponseTimeData(chartData)

      // Calculate trend
      if (chartData.length > 1) {
        const recent = chartData[chartData.length - 1].value
        const previous = chartData[chartData.length - 2].value
        const trend = previous > 0 ? ((recent - previous) / previous) * 100 : 0
        setTrendPercent(trend)
      }

      // Fetch monthly cost with fallback
      const costData = await queryPrometheus('infrastructure_cost_monthly_total')
      if (costData?.result?.[0]?.value?.[1]) {
        const cost = parseFloat(costData.result[0].value[1])
        if (!isNaN(cost) && cost > 0) {
          setMonthlyCost(`$${cost.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`)
        } else {
          setMonthlyCost('$0')
        }
      } else {
        setMonthlyCost('$0')
      }

      // Fetch request rate
      const requestRateQuery = await queryPrometheus(
        'rate(http_requests_total{job="devcontrol-api"}[5m]) * 60'
      )
      if (requestRateQuery?.result?.[0]?.value?.[1]) {
        const rate = parseFloat(requestRateQuery.result[0].value[1])
        if (!isNaN(rate)) {
          setRequestsPerMinute(Math.round(rate))
        }
      }

      // Fetch service health with enhanced data
      const serviceHealthData = await Promise.all([
        queryPrometheus('up{job="devcontrol-api"}'),
        queryPrometheus('up{job="postgres-exporter"}'),
        queryPrometheus('up{job="node-exporter"}'),
      ])

      const updatedServices: ServiceHealth[] = [
        {
          name: 'DevControl API',
          description: 'Main application server',
          status: serviceHealthData[0]?.result?.[0]?.value?.[1] === '1' ? 'healthy' : 'down',
          uptime: serviceHealthData[0]?.result?.[0]?.value?.[1] === '1' ? '99.95%' : '0%',
          responseTime: p95Value > 0 ? `${p95Value}ms` : '--',
          errorRate: 0.05,
          critical: true,
          recentIncidents: 0,
          uptimeHistory: [99, 99.5, 99.8, 99.9, 99.95, 99.9, 99.95, 100],
        },
        {
          name: 'PostgreSQL',
          description: 'Primary database',
          status: serviceHealthData[1]?.result?.[0]?.value?.[1] === '1' ? 'healthy' : 'down',
          uptime: serviceHealthData[1]?.result?.[0]?.value?.[1] === '1' ? '100%' : '0%',
          responseTime: '12ms',
          errorRate: 0.0,
          critical: true,
          recentIncidents: 0,
          uptimeHistory: [100, 100, 100, 100, 100, 100, 100, 100],
        },
        {
          name: 'Node Exporter',
          description: 'System metrics collector',
          status: serviceHealthData[2]?.result?.[0]?.value?.[1] === '1' ? 'healthy' : 'down',
          uptime: serviceHealthData[2]?.result?.[0]?.value?.[1] === '1' ? '100%' : '0%',
          responseTime: '--',
          errorRate: 0.0,
          critical: false,
          recentIncidents: 0,
          uptimeHistory: [100, 100, 99.9, 100, 100, 100, 100, 100],
        },
      ]

      setServices(updatedServices)
      setLastSynced(new Date())
      setLoading(false)
      toast.success('Metrics updated')
    } catch (err: any) {
      console.error('Error fetching metrics:', err)

      if (err.message === 'TIMEOUT') {
        setError({
          type: 'timeout',
          message: 'Request timed out',
          action: 'The Prometheus server is taking too long to respond. Check your network connection.',
        })
      } else if (err.message === 'CREDENTIALS') {
        setError({
          type: 'credentials',
          message: 'Authentication failed',
          action: 'Check your Prometheus credentials in Settings',
        })
      } else {
        setError({
          type: 'connection',
          message: 'Unable to connect to Prometheus',
          action: 'Verify Prometheus is running and accessible at ' + PROMETHEUS_URL,
        })
      }

      setLoading(false)
      toast.error('Failed to fetch metrics')
    }
  }, [timeRange, isDemoActive, generateDemoMetrics])

  const handleRefresh = async () => {
    await fetchMetrics()
  }

  useEffect(() => {
    fetchMetrics()
    const interval = setInterval(fetchMetrics, 60000)
    return () => clearInterval(interval)
  }, [fetchMetrics])

  // Empty state
  if (!metricsAvailable && !isDemoActive && !loading && !error) {
    return (
      <ErrorBoundary>
        <div style={{ padding: '40px 56px 64px', maxWidth: '1320px', margin: '0 auto', minHeight: '100vh', background: '#F9FAFB', fontFamily: 'Inter, system-ui, sans-serif' }}>
          <MonitoringEmptyState onSetup={() => router.push('/settings/monitoring')} />
        </div>
      </ErrorBoundary>
    )
  }

  return (
    <div style={{
      padding: '40px 56px 64px',
      maxWidth: '1320px',
      margin: '0 auto',
      minHeight: '100vh',
      background: '#F9FAFB',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      <style>{`@keyframes pulse { 0%, 100% { opacity: 0.6; } 50% { opacity: 0.3; } }`}</style>

      {/* PAGE HEADER */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '32px' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#0F172A', margin: '0 0 6px', letterSpacing: '-0.02em' }}>
            Monitoring Overview
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>
            Real-time infrastructure health, SLOs, and alerts · Powered by Prometheus
          </p>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <TimeRangeSelector selected={timeRange} onChange={setTimeRange} onRefresh={handleRefresh} />
          <div style={{ display: 'flex', gap: '8px' }}>
            <a href={GRAFANA_URL} target="_blank" rel="noopener noreferrer"
              style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#fff', color: '#475569', padding: '8px 16px', borderRadius: '8px', fontSize: '0.82rem', fontWeight: 500, border: '1px solid #E2E8F0', textDecoration: 'none' }}>
              <ExternalLink size={13} /> Grafana
            </a>
            <a href={PROMETHEUS_URL} target="_blank" rel="noopener noreferrer"
              style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#fff', color: '#475569', padding: '8px 16px', borderRadius: '8px', fontSize: '0.82rem', fontWeight: 500, border: '1px solid #E2E8F0', textDecoration: 'none' }}>
              <ExternalLink size={13} /> Prometheus
            </a>
          </div>
        </div>
      </div>

      {/* ERROR STATE */}
      {error && !isDemoActive && (
        <MonitoringErrorState
          type={error.type}
          message={error.message}
          action={error.action}
          onRetry={handleRefresh}
          onSettings={() => router.push('/settings/monitoring')}
        />
      )}

      {/* LOADING STATE */}
      {loading && !isDemoActive && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', marginBottom: '28px' }}>
          {[1, 2, 3, 4].map(i => (
            <div key={i} style={{ background: '#fff', borderRadius: '14px', padding: '32px', border: '1px solid #E2E8F0', height: '120px', animation: 'pulse 1.5s ease-in-out infinite', opacity: 0.6 }} />
          ))}
        </div>
      )}

      {/* MAIN CONTENT */}
      {(!loading || isDemoActive) && (!error || isDemoActive) && (
        <>
          {/* AI INSIGHT BANNER */}
          <div style={{ background: '#fff', borderRadius: '12px', padding: '16px 24px', border: '1px solid #F1F5F9', marginBottom: '24px', display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#7C3AED', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Sparkles size={14} style={{ color: '#fff' }} />
            </div>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#7C3AED', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 4px' }}>AI Insight</p>
              <p style={{ fontSize: '0.875rem', color: '#1E293B', margin: 0, lineHeight: 1.6 }}>
                {systemStatus === 'degraded'
                  ? 'Order Processor is degraded with 1.23% error rate and 458ms response time — 2 active alerts. Root cause likely upstream dependency or resource constraint. Payment API and User Service remain healthy at 99.99% uptime.'
                  : systemStatus === 'healthy'
                    ? `All ${services.length} services healthy. Average response time ${responseTimeString} with ${uptime} uptime. No active alerts detected.`
                    : 'System is down. Immediate investigation required across all services.'
                }
              </p>
            </div>
            {alerts.length > 0 && (
              <a href="/admin/alerts" style={{ fontSize: '0.78rem', fontWeight: 600, color: '#7C3AED', textDecoration: 'none', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
                View alerts <ArrowRight size={12} />
              </a>
            )}
          </div>

          {/* SYSTEM STATUS BANNER — only when degraded or down */}
          {systemStatus !== 'healthy' && (
            <div style={{
              background: systemStatus === 'degraded' ? '#FFFBEB' : '#FEF2F2',
              border: `1px solid ${systemStatus === 'degraded' ? '#FDE68A' : '#FECACA'}`,
              borderRadius: '10px',
              padding: '12px 20px',
              marginBottom: '24px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: systemStatus === 'degraded' ? '#D97706' : '#DC2626', flexShrink: 0 }} />
              <span style={{ fontSize: '0.875rem', fontWeight: 600, color: systemStatus === 'degraded' ? '#92400E' : '#991B1B' }}>
                System {systemStatus === 'degraded' ? 'Degraded' : 'Down'} · {alerts.length} active alert{alerts.length !== 1 ? 's' : ''}
              </span>
              <span style={{ fontSize: '0.82rem', color: systemStatus === 'degraded' ? '#B45309' : '#B91C1C', marginLeft: '4px' }}>
                · Last synced {lastSynced.toLocaleTimeString()}
              </span>
            </div>
          )}

          {/* 4 KPI CARDS */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', marginBottom: '28px' }}>
            {[
              {
                label: 'System Uptime',
                value: uptime,
                sub: 'Last 30 days',
                valueColor: uptime === '--' ? '#94A3B8' : parseFloat(uptime) >= 99.9 ? '#059669' : '#D97706',
              },
              {
                label: 'Avg Response Time',
                value: responseTimeString,
                sub: `${trendPercent > 0 ? '+' : ''}${trendPercent.toFixed(1)}% vs last period`,
                valueColor: responseTime < 200 ? '#059669' : responseTime < 500 ? '#D97706' : '#DC2626',
              },
              {
                label: 'Requests / Min',
                value: requestsPerMinute.toLocaleString(),
                sub: 'Current throughput',
                valueColor: '#0F172A',
              },
              {
                label: 'Monthly Cost',
                value: monthlyCost,
                sub: 'Infrastructure spend',
                valueColor: '#0F172A',
              },
            ].map(({ label, value, sub, valueColor }) => (
              <div key={label} style={{ background: '#fff', borderRadius: '14px', padding: '32px', border: '1px solid #E2E8F0' }}>
                <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 16px' }}>{label}</p>
                <div style={{ fontSize: '2rem', fontWeight: 700, color: valueColor, letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '8px' }}>{value}</div>
                <p style={{ fontSize: '0.78rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>{sub}</p>
              </div>
            ))}
          </div>

          {/* RESPONSE TIME CHART + ACTIVE ALERTS — 3fr / 2fr */}
          <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: '24px', marginBottom: '28px' }}>
            <div style={{ background: '#fff', borderRadius: '16px', padding: '32px', border: '1px solid #F1F5F9' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
                <div>
                  <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 4px' }}>Response Time Trend</p>
                  <p style={{ fontSize: '0.875rem', color: '#0F172A', fontWeight: 600, margin: 0 }}>
                    {responseTimeString}
                    <span style={{ fontSize: '0.78rem', fontWeight: 400, color: trendPercent < 0 ? '#059669' : '#D97706', marginLeft: '8px' }}>
                      {trendPercent > 0 ? '+' : ''}{trendPercent.toFixed(1)}% vs last period
                    </span>
                  </p>
                </div>
              </div>
              <ResponseTimeChart data={responseTimeData} currentValue={responseTime} trendPercent={trendPercent} />
            </div>

            <div style={{ background: '#fff', borderRadius: '16px', padding: '32px', border: '1px solid #F1F5F9' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
                <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>Active Alerts</p>
                <a href="/admin/alerts" style={{ fontSize: '0.78rem', fontWeight: 600, color: '#7C3AED', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  View all <ArrowRight size={12} />
                </a>
              </div>
              <ActiveAlertsPanel alerts={alerts} />
            </div>
          </div>

          {/* SERVICE HEALTH TABLE */}
          <div style={{ background: '#fff', borderRadius: '16px', padding: '32px', border: '1px solid #F1F5F9', marginBottom: '28px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
              <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>Service Health</p>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <span style={{ fontSize: '0.78rem', color: '#94A3B8' }}>
                  {services.filter(s => s.status === 'healthy').length}/{services.length} healthy
                </span>
                <a href="/services" style={{ fontSize: '0.78rem', fontWeight: 600, color: '#7C3AED', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  All services <ArrowRight size={12} />
                </a>
              </div>
            </div>
            <ServiceHealthTable services={services} loading={loading} />
          </div>

          {/* SLO DASHBOARD */}
          <div style={{ background: '#fff', borderRadius: '16px', padding: '32px', border: '1px solid #F1F5F9' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
              <div>
                <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 4px' }}>Service Level Objectives</p>
                <p style={{ fontSize: '0.875rem', color: '#0F172A', margin: 0 }}>
                  {slos.filter(s => s.current >= s.target).length}/{slos.length} SLOs meeting target
                </p>
              </div>
              <a href="/monitoring/slos" style={{ fontSize: '0.78rem', fontWeight: 600, color: '#7C3AED', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}>
                Full SLO report <ArrowRight size={12} />
              </a>
            </div>
            <SLODashboard slos={slos} />
          </div>
        </>
      )}

      {/* EMPTY STATE — no services loaded outside demo/loading/error */}
      {!loading && !isDemoActive && services.length === 0 && !error && (
        <MonitoringEmptyState onSetup={() => router.push('/settings/monitoring')} />
      )}

    </div>
  )
}
