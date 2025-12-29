'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Activity, CheckCircle2, XCircle, TrendingUp, DollarSign, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Breadcrumb } from '@/components/navigation/breadcrumb'

interface ServiceHealth {
  name: string
  status: 'healthy' | 'degraded' | 'down'
  uptime: string
  latency: string
}

export default function MonitoringPage() {
  const [systemStatus, setSystemStatus] = useState<'healthy' | 'degraded' | 'down'>('healthy')
  const [metricsAvailable, setMetricsAvailable] = useState(false)
  const [loading, setLoading] = useState(true)

  // Metric states
  const [uptime, setUptime] = useState<string>('--')
  const [responseTime, setResponseTime] = useState<string>('--')
  const [monthlyCost, setMonthlyCost] = useState<string>('--')
  const [services, setServices] = useState<ServiceHealth[]>([
    { name: 'DevControl API', status: 'down', uptime: '--', latency: '--' },
    { name: 'PostgreSQL', status: 'down', uptime: '--', latency: '--' },
    { name: 'Node Exporter', status: 'down', uptime: '--', latency: '--' },
  ])

  const queryPrometheus = async (query: string): Promise<any> => {
    try {
      const response = await fetch(
        `http://localhost:9090/api/v1/query?query=${encodeURIComponent(query)}`
      )
      if (!response.ok) return null
      const data = await response.json()
      return data.status === 'success' ? data.data : null
    } catch (error) {
      console.error('Prometheus query error:', error)
      return null
    }
  }

  const fetchMetrics = async () => {
    try {
      setLoading(true)

      // Check if metrics endpoint is available
      const apiRes = await fetch('http://localhost:8080/metrics').catch(() => null)
      const isAvailable = apiRes?.ok ?? false
      setMetricsAvailable(isAvailable)
      setSystemStatus(isAvailable ? 'healthy' : 'down')

      if (!isAvailable) {
        setLoading(false)
        return
      }

      // Fetch uptime for DevControl API
      const uptimeData = await queryPrometheus('up{job="devcontrol-api"}')
      if (uptimeData?.result?.[0]?.value?.[1]) {
        const uptimeValue = parseFloat(uptimeData.result[0].value[1])
        setUptime(uptimeValue === 1 ? '100%' : '0%')
      }

      // Fetch response time (p95)
      const responseTimeData = await queryPrometheus(
        'histogram_quantile(0.95, rate(http_request_duration_seconds_bucket{job="devcontrol-api"}[5m]))'
      )
      if (responseTimeData?.result?.[0]?.value?.[1]) {
        const p95 = parseFloat(responseTimeData.result[0].value[1]) * 1000
        setResponseTime(`${Math.round(p95)}ms`)
      }

      // Fetch monthly cost
      const costData = await queryPrometheus('infrastructure_cost_monthly_total')
      if (costData?.result?.[0]?.value?.[1]) {
        const cost = parseFloat(costData.result[0].value[1])
        setMonthlyCost(`$${cost.toLocaleString()}`)
      } else {
        setMonthlyCost('$0')
      }

      // Fetch service health
      const serviceHealthData = await Promise.all([
        queryPrometheus('up{job="devcontrol-api"}'),
        queryPrometheus('up{job="postgres-exporter"}'),
        queryPrometheus('up{job="node-exporter"}'),
      ])

      const updatedServices: ServiceHealth[] = [
        {
          name: 'DevControl API',
          status: serviceHealthData[0]?.result?.[0]?.value?.[1] === '1' ? 'healthy' : 'down',
          uptime: serviceHealthData[0]?.result?.[0]?.value?.[1] === '1' ? '100%' : '0%',
          latency: responseTime !== '--' ? responseTime : '--',
        },
        {
          name: 'PostgreSQL',
          status: serviceHealthData[1]?.result?.[0]?.value?.[1] === '1' ? 'healthy' : 'down',
          uptime: serviceHealthData[1]?.result?.[0]?.value?.[1] === '1' ? '100%' : '0%',
          latency: '--',
        },
        {
          name: 'Node Exporter',
          status: serviceHealthData[2]?.result?.[0]?.value?.[1] === '1' ? 'healthy' : 'down',
          uptime: serviceHealthData[2]?.result?.[0]?.value?.[1] === '1' ? '100%' : '0%',
          latency: '--',
        },
      ]

      setServices(updatedServices)
      setLoading(false)
    } catch (error) {
      console.error('Error fetching metrics:', error)
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchMetrics()
    const interval = setInterval(fetchMetrics, 30000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="space-y-6 px-4 md:px-6 lg:px-8 py-6">
      <Breadcrumb
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Monitoring' }
        ]}
      />

      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Activity className="h-8 w-8" />
          System Monitoring
        </h1>
        <p className="text-muted-foreground mt-2">
          Real-time metrics powered by Prometheus + Grafana
        </p>
      </div>

      {!metricsAvailable && (
        <Alert>
          <AlertDescription>
            Monitoring stack not running. Start with:
            <code className="ml-2 px-2 py-1 bg-muted rounded text-sm">
              cd monitoring && docker-compose -f docker-compose.monitoring.yml up -d
            </code>
          </AlertDescription>
        </Alert>
      )}

      {/* Status Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">System Status</CardTitle>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
            ) : systemStatus === 'healthy' ? (
              <CheckCircle2 className="h-4 w-4 text-green-600" />
            ) : (
              <XCircle className="h-4 w-4 text-red-600" />
            )}
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${systemStatus === 'healthy' ? 'text-green-600' : 'text-red-600'}`}>
              {loading ? 'Loading...' : systemStatus === 'healthy' ? 'Operational' : 'Down'}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {services.length} services monitored
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">API Uptime</CardTitle>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
            ) : (
              <TrendingUp className="h-4 w-4 text-blue-600" />
            )}
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{uptime}</div>
            <p className="text-xs text-muted-foreground mt-1">Current session</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Response Time</CardTitle>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
            ) : (
              <Activity className="h-4 w-4 text-purple-600" />
            )}
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{responseTime}</div>
            <p className="text-xs text-muted-foreground mt-1">p95 latency (5m)</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Monthly Cost</CardTitle>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
            ) : (
              <DollarSign className="h-4 w-4 text-green-600" />
            )}
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{monthlyCost}</div>
            <p className="text-xs text-muted-foreground mt-1">Infrastructure</p>
          </CardContent>
        </Card>
      </div>

      {/* Service Health */}
      <Card>
        <CardHeader>
          <CardTitle>Service Health</CardTitle>
          <CardDescription>
            Current status of platform services
            {loading && <span className="ml-2 text-xs">(Loading...)</span>}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {services.map((service) => (
              <div key={service.name} className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex items-center gap-3">
                  {loading ? (
                    <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                  ) : service.status === 'healthy' ? (
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                  ) : (
                    <XCircle className="h-5 w-5 text-red-600" />
                  )}
                  <div>
                    <p className="font-medium">{service.name}</p>
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <div className="text-right">
                    <p className="text-sm font-medium">{service.uptime}</p>
                    <p className="text-xs text-muted-foreground">Uptime</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium">{service.latency}</p>
                    <p className="text-xs text-muted-foreground">Latency</p>
                  </div>
                  <Badge className={
                    service.status === 'healthy'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-red-100 text-red-700'
                  }>
                    {service.status === 'healthy' ? 'Healthy' : 'Down'}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Quick Links */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Prometheus</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-2">
              Query and explore metrics
            </p>
            <a
              href="http://localhost:9090"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 hover:underline"
            >
              Open Prometheus →
            </a>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Grafana</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-2">
              View dashboards
            </p>
            <a
              href="http://localhost:3000"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 hover:underline"
            >
              Open Grafana →
            </a>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Alerts</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-2">
              View active alerts
            </p>
            <a
              href="http://localhost:9090/alerts"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 hover:underline"
            >
              View Alerts →
            </a>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}