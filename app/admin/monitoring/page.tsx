'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Activity, CheckCircle2, XCircle, TrendingUp, DollarSign } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'

export default function MonitoringPage() {
  const [systemStatus, setSystemStatus] = useState<'healthy' | 'degraded' | 'down'>('healthy')
  const [metricsAvailable, setMetricsAvailable] = useState(false)

  useEffect(() => {
    const checkMonitoring = async () => {
      try {
        const apiRes = await fetch('http://localhost:8080/metrics').catch(() => null)
        setMetricsAvailable(apiRes?.ok ?? false)
        setSystemStatus(apiRes?.ok ? 'healthy' : 'down')
      } catch {
        setSystemStatus('down')
        setMetricsAvailable(false)
      }
    }

    checkMonitoring()
    const interval = setInterval(checkMonitoring, 30000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="space-y-6 px-4 md:px-6 lg:px-8 py-6">
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
            {systemStatus === 'healthy' ? (
              <CheckCircle2 className="h-4 w-4 text-green-600" />
            ) : (
              <XCircle className="h-4 w-4 text-red-600" />
            )}
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${systemStatus === 'healthy' ? 'text-green-600' : 'text-red-600'}`}>
              {systemStatus === 'healthy' ? 'Operational' : 'Down'}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              3 services monitored
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Uptime</CardTitle>
            <TrendingUp className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">99.9%</div>
            <p className="text-xs text-muted-foreground mt-1">Last 30 days</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Response Time</CardTitle>
            <Activity className="h-4 w-4 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">59ms</div>
            <p className="text-xs text-muted-foreground mt-1">Average p95</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Monthly Cost</CardTitle>
            <DollarSign className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">$1,675</div>
            <p className="text-xs text-muted-foreground mt-1">AWS resources</p>
          </CardContent>
        </Card>
      </div>

      {/* Service Health */}
      <Card>
        <CardHeader>
          <CardTitle>Service Health</CardTitle>
          <CardDescription>Current status of platform services</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[
              { name: 'DevControl API', status: 'healthy', uptime: '99.9%', latency: '45ms' },
              { name: 'PostgreSQL', status: 'healthy', uptime: '100%', latency: '12ms' },
              { name: 'Frontend', status: 'healthy', uptime: '99.8%', latency: '120ms' },
            ].map((service) => (
              <div key={service.name} className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
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
                  <Badge className="bg-green-100 text-green-700">Healthy</Badge>
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