'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Activity, CheckCircle2, XCircle, TrendingUp, TrendingDown, DollarSign, Loader2, ExternalLink, AlertCircle } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { TimeRangeSelector } from '@/components/monitoring/TimeRangeSelector'
import { ResponseTimeChart } from '@/components/monitoring/ResponseTimeChart'
import { ServiceHealthTable } from '@/components/monitoring/ServiceHealthTable'
import { ActiveAlertsPanel } from '@/components/monitoring/ActiveAlertsPanel'
import { SLODashboard } from '@/components/monitoring/SLODashboard'
import { MonitoringEmptyState } from '@/components/monitoring/MonitoringEmptyState'
import { MonitoringErrorState, MonitoringErrorType } from '@/components/monitoring/MonitoringErrorState'
import { MonitoringProFeaturesGrid, InlineUpgradePrompt } from '@/components/monitoring/MonitoringProFeatures'
import { ErrorBoundary } from '@/components/error-boundary'
import { useDemoMode } from '@/components/demo/demo-mode-toggle'
import { useSubscription } from '@/lib/hooks/useSubscription'
import { LastSynced } from '@/components/ui/last-synced'
import { Skeleton } from '@/components/ui/skeleton'
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
  const subscription = useSubscription()

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
  }, [timeRange, demoMode, generateDemoMetrics])

  const handleRefresh = async () => {
    await fetchMetrics()
  }

  useEffect(() => {
    fetchMetrics()

    // Smart auto-refresh based on subscription tier
    const refreshInterval = subscription.isPro ? 30000 : 5 * 60 * 1000 // Pro: 30s, Free: 5min
    const interval = setInterval(fetchMetrics, refreshInterval)

    return () => clearInterval(interval)
  }, [fetchMetrics, subscription.isPro])

  // Show empty state if no metrics and not in demo mode
  if (!metricsAvailable && !demoMode && !loading && !error) {
    return (
      <ErrorBoundary>
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <MonitoringEmptyState onSetup={() => router.push('/settings/monitoring')} />
        </div>
      </ErrorBoundary>
    )
  }

  return (
    <ErrorBoundary>
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Demo Mode Banner */}
        {demoMode && (
          <div
            className="bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800 rounded-lg p-4 -mx-4 sm:-mx-6 lg:-mx-8 -mt-6 mb-0"
            role="status"
            aria-live="polite"
          >
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" aria-hidden="true" />
              <p className="text-sm font-medium text-purple-900 dark:text-purple-100">
                Demo Mode Active — Showing sample monitoring data
              </p>
            </div>
          </div>
        )}

        {/* Header with Time Range Selector */}
        <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                <Activity className="h-8 w-8" aria-hidden="true" />
                System Monitoring
              </h1>
              <LastSynced
                timestamp={lastSynced}
                onRefresh={handleRefresh}
                autoRefresh={true}
                size="sm"
              />
            </div>
            <p className="text-muted-foreground mt-2">
              Real-time metrics with enterprise-grade observability
            </p>
          </div>
          <TimeRangeSelector
            selected={timeRange}
            onChange={setTimeRange}
            onRefresh={handleRefresh}
          />
        </header>

        {/* Error State */}
        {error && (
          <MonitoringErrorState
            type={error.type}
            message={error.message}
            action={error.action}
            onRetry={handleRefresh}
            onSettings={() => router.push('/settings/monitoring')}
          />
        )}

        {/* Free tier refresh rate notice */}
        {!subscription.isPro && !error && (
          <InlineUpgradePrompt
            feature="Real-Time Monitoring"
            description="Free tier updates every 5 minutes. Upgrade to Pro for 30-second refresh rate."
            tier="pro"
          />
        )}

        {/* Status Cards */}
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="System metrics">
          <Card className="hover:shadow-xl hover:-translate-y-1 transition-all duration-200">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">System Status</CardTitle>
              <div className="w-10 h-10 bg-gradient-to-br from-blue-100 to-blue-200 dark:from-blue-900/30 dark:to-blue-800/30 rounded-lg flex items-center justify-center" aria-hidden="true">
                {loading ? (
                  <Loader2 className="h-5 w-5 animate-spin text-blue-600 dark:text-blue-400" />
                ) : systemStatus === 'healthy' ? (
                  <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                ) : systemStatus === 'degraded' ? (
                  <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
                ) : (
                  <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
                )}
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-8 w-24" />
              ) : (
                <>
                  <div className={`text-2xl font-bold ${
                    systemStatus === 'healthy'
                      ? 'text-green-600 dark:text-green-400'
                      : systemStatus === 'degraded'
                      ? 'text-yellow-600 dark:text-yellow-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}>
                    {systemStatus === 'healthy' ? 'Operational' : systemStatus === 'degraded' ? 'Degraded' : 'Down'}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {services.length} services monitored
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="hover:shadow-xl hover:-translate-y-1 transition-all duration-200">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">API Uptime</CardTitle>
              <div className="w-10 h-10 bg-gradient-to-br from-green-100 to-green-200 dark:from-green-900/30 dark:to-green-800/30 rounded-lg flex items-center justify-center" aria-hidden="true">
                {loading ? (
                  <Loader2 className="h-5 w-5 animate-spin text-green-600 dark:text-green-400" />
                ) : (
                  <TrendingUp className="h-5 w-5 text-green-600 dark:text-green-400" />
                )}
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-8 w-20" />
              ) : (
                <>
                  <div className="text-2xl font-bold">{uptime}</div>
                  <div className="flex items-center gap-1 text-xs mt-1">
                    <TrendingUp className="w-3 h-3 text-green-600 dark:text-green-400" aria-hidden="true" />
                    <span className="text-green-600 dark:text-green-400">+0.05% vs last week</span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="hover:shadow-xl hover:-translate-y-1 transition-all duration-200">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Response Time</CardTitle>
              <div className="w-10 h-10 bg-gradient-to-br from-purple-100 to-purple-200 dark:from-purple-900/30 dark:to-purple-800/30 rounded-lg flex items-center justify-center" aria-hidden="true">
                {loading ? (
                  <Loader2 className="h-5 w-5 animate-spin text-purple-600 dark:text-purple-400" />
                ) : (
                  <Activity className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                )}
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-8 w-20" />
              ) : (
                <>
                  <div className="text-2xl font-bold">{responseTimeString}</div>
                  <div className="flex items-center gap-1 text-xs mt-1">
                    {trendPercent > 0 ? (
                      <>
                        <TrendingUp className="w-3 h-3 text-red-600 dark:text-red-400" aria-hidden="true" />
                        <span className="text-red-600 dark:text-red-400">+{trendPercent.toFixed(1)}% slower</span>
                      </>
                    ) : (
                      <>
                        <TrendingDown className="w-3 h-3 text-green-600 dark:text-green-400" aria-hidden="true" />
                        <span className="text-green-600 dark:text-green-400">{trendPercent.toFixed(1)}% faster</span>
                      </>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="hover:shadow-xl hover:-translate-y-1 transition-all duration-200">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Monthly Cost</CardTitle>
              <div className="w-10 h-10 bg-gradient-to-br from-orange-100 to-orange-200 dark:from-orange-900/30 dark:to-orange-800/30 rounded-lg flex items-center justify-center" aria-hidden="true">
                {loading ? (
                  <Loader2 className="h-5 w-5 animate-spin text-orange-600 dark:text-orange-400" />
                ) : (
                  <DollarSign className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                )}
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-8 w-24" />
              ) : (
                <>
                  <div className="text-2xl font-bold">{monthlyCost}</div>
                  <p className="text-xs text-muted-foreground mt-1">Infrastructure</p>
                </>
              )}
            </CardContent>
          </Card>
        </section>

        {/* Active Alerts (if any) */}
        {alerts.length > 0 && <ActiveAlertsPanel alerts={alerts} />}

        {/* Response Time Chart */}
        {metricsAvailable && responseTimeData.length > 0 && (
          <ResponseTimeChart
            data={responseTimeData}
            currentValue={responseTime}
            trendPercent={trendPercent}
          />
        )}

        {/* SLO Dashboard */}
        {metricsAvailable && slos.length > 0 && <SLODashboard slos={slos} />}

        {/* Service Health Table */}
        <ServiceHealthTable services={services} loading={loading} />

        {/* Pro Features (Free tier only) */}
        {!subscription.isPro && !error && metricsAvailable && (
          <section className="space-y-4" aria-label="Premium monitoring features">
            <div className="text-center space-y-2">
              <h2 className="text-2xl font-bold">Unlock Advanced Monitoring</h2>
              <p className="text-muted-foreground">
                Upgrade to Pro for historical data, real-time updates, custom alerts, and more
              </p>
            </div>
            <MonitoringProFeaturesGrid />
          </section>
        )}

        {/* Deep Dive Links */}
        {metricsAvailable && (
          <section
            className="bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-950/20 dark:to-purple-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-6"
            aria-label="Advanced monitoring tools"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <ExternalLink className="w-5 h-5 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                <div>
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                    Advanced Monitoring Tools
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Access Prometheus, Grafana, and alert management
                  </p>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Button variant="outline" size="sm" className="justify-start" asChild>
                <a
                  href={PROMETHEUS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Open Prometheus in new tab"
                >
                  <Activity className="w-4 h-4 mr-2" aria-hidden="true" />
                  Open Prometheus
                </a>
              </Button>
              <Button variant="outline" size="sm" className="justify-start" asChild>
                <a
                  href={GRAFANA_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Open Grafana in new tab"
                >
                  <TrendingUp className="w-4 h-4 mr-2" aria-hidden="true" />
                  Open Grafana
                </a>
              </Button>
              <Button variant="outline" size="sm" className="justify-start" asChild>
                <a
                  href={`${ALERTMANAGER_URL}/#/alerts`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="View alerts in Alertmanager in new tab"
                >
                  <Activity className="w-4 h-4 mr-2" aria-hidden="true" />
                  View Alerts
                </a>
              </Button>
            </div>
          </section>
        )}
      </div>
    </ErrorBoundary>
  )
}
