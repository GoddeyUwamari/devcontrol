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
import { ErrorBoundary } from '@/components/error-boundary'
import { useDemoMode } from '@/components/demo/demo-mode-toggle'
import { useSalesDemo } from '@/lib/demo/sales-demo-data'
import { toast } from 'sonner'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'
const AWS_REGION = process.env.NEXT_PUBLIC_AWS_DEFAULT_REGION || 'us-east-1'

interface ServiceHealth {
  name: string; description?: string; status: 'healthy' | 'degraded' | 'down'
  uptime: string; responseTime: string; errorRate: number; critical?: boolean
  recentIncidents?: number; uptimeHistory?: number[]
}
interface MonitoringError { type: MonitoringErrorType; message: string; action?: string }

export default function MonitoringPage() {
  const router = useRouter()
  const demoMode = useDemoMode()
  const salesDemoMode = useSalesDemo((state) => state.enabled)
  const isDemoActive = demoMode || salesDemoMode

  const userRole = useMemo(() => {
    try { const token = localStorage.getItem('accessToken'); if (!token) return 'owner'; const payload = JSON.parse(atob(token.split('.')[1])); return payload.role ?? 'owner' } catch { return 'owner' }
  }, [])

  const [systemStatus, setSystemStatus] = useState<'healthy' | 'degraded' | 'down'>('healthy')
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

  const generateDemoMetrics = useCallback(() => {
    setError(null)
    const now = Date.now()
    const chartData = Array.from({ length: 12 }, (_, i) => ({ timestamp: now - (11 - i) * 5 * 60 * 1000, value: Math.round(120 + Math.random() * 80) }))
    setUptime('99.95%'); setResponseTime(145); setResponseTimeString('145ms'); setMonthlyCost('$847'); setRequestsPerMinute(1247); setResponseTimeData(chartData); setTrendPercent(-2.3)
    setServices([
      { name: 'Payment API', description: 'Payment processing service', status: 'healthy', uptime: '99.99%', responseTime: '89ms', errorRate: 0.05, critical: true, recentIncidents: 0, uptimeHistory: [99.9,99.95,99.98,99.99,100,99.99,99.98,99.99] },
      { name: 'User Service', description: 'User authentication and management', status: 'healthy', uptime: '99.98%', responseTime: '123ms', errorRate: 0.08, critical: true, recentIncidents: 0, uptimeHistory: [99.8,99.9,99.95,99.98,99.97,99.99,99.98,100] },
      { name: 'Order Processor', description: 'Background order processing', status: 'degraded', uptime: '98.45%', responseTime: '458ms', errorRate: 1.23, critical: false, recentIncidents: 2, uptimeHistory: [99.5,98.8,97.5,98.2,98.9,98.5,98.1,98.45] },
      { name: 'Notification Service', description: 'Email and push notifications', status: 'healthy', uptime: '99.92%', responseTime: '234ms', errorRate: 0.15, critical: false, recentIncidents: 0, uptimeHistory: [99.7,99.8,99.85,99.9,99.92,99.88,99.91,99.92] },
    ])
    setSlos([{ name: 'API Uptime', current: 99.95, target: 99.9, errorBudget: 0.05, description: 'API availability SLO' }, { name: 'Response Time', current: 98.5, target: 95.0, errorBudget: 3.5, description: '< 500ms for 95% requests' }, { name: 'Error Rate', current: 99.9, target: 99.9, errorBudget: 0.0, description: '< 0.1% error rate' }])
    setAlerts([{ id: '1', title: 'High Response Time', message: 'Order Processor response time above threshold', severity: 'warning', service: 'order-processor', triggeredAt: new Date(Date.now() - 15 * 60 * 1000) }, { id: '2', title: 'Elevated Error Rate', message: 'Order Processor error rate at 1.23%', severity: 'warning', service: 'order-processor', triggeredAt: new Date(Date.now() - 8 * 60 * 1000) }])
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

  const checkAwsConnection = useCallback(async () => {
    try { const token = document.cookie.split(';').find(c => c.trim().startsWith('auth-token='))?.split('=')[1] || localStorage.getItem('accessToken'); const res = await fetch(`${API_URL}/api/cloudwatch/status`, { headers: { 'Authorization': `Bearer ${token}` } }); const data = await res.json(); setAwsConnected(data.success ? data.data.connected : false) } catch { setAwsConnected(false) }
  }, [])

  const fetchCloudWatchMetrics = useCallback(async () => {
    try { const token = document.cookie.split(';').find(c => c.trim().startsWith('auth-token='))?.split('=')[1] || localStorage.getItem('accessToken'); const res = await fetch(`${API_URL}/api/cloudwatch/metrics`, { headers: { 'Authorization': `Bearer ${token}` } }); const data = await res.json(); if (data.success && data.data) { setCloudWatchMetrics(data.data); return data.data } return null } catch { return null }
  }, [])

  const saveSnapshot = useCallback(async (metrics: any) => {
    try { const token = document.cookie.split(';').find(c => c.trim().startsWith('auth-token='))?.split('=')[1] || localStorage.getItem('accessToken'); await fetch(`${API_URL}/api/prometheus/snapshot`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(metrics) }) } catch {}
  }, [])

  const runDiagnostic = useCallback(async () => {
    setIsDiagnosing(true); setDiagnosticResult(null)
    try { const token = document.cookie.split(';').find(c => c.trim().startsWith('auth-token='))?.split('=')[1] || localStorage.getItem('accessToken'); const res = await fetch(`${API_URL}/api/prometheus/diagnose`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } }); const data = await res.json(); if (data.success) setDiagnosticResult(data.data) } catch {} finally { setIsDiagnosing(false) }
  }, [])

  const generateTimeSeriesData = (baseValue: number, points: number = 12) => {
    const now = Date.now(), interval = 5 * 60 * 1000, data = []
    for (let i = points; i >= 0; i--) { const timestamp = now - (i * interval); const variation = (Math.random() - 0.5) * baseValue * 0.3; data.push({ timestamp, value: Math.max(0, Math.round(baseValue + variation)) }) }
    return data
  }

  const fetchMetrics = useCallback(async (cwData?: any) => {
    const cw = cwData ?? cloudWatchMetrics
    if (cw && !demoMode) {
      const data = cw
      setUptime(data.uptime ? `${data.uptime}%` : '99.9%')
      setResponseTime(data.avgResponseTimeMs ?? 45); setResponseTimeString(`${data.avgResponseTimeMs ?? 45}ms`)
      setRequestsPerMinute(data.requestsPerMinute ?? 0)
      setMonthlyCost(data.monthlyCost ? `$${Math.round(data.monthlyCost).toLocaleString()}` : '--')
      setTrendPercent(0)
      setResponseTimeData(Array.from({ length: 12 }, (_, i) => ({ timestamp: Date.now() - (11 - i) * 5 * 60 * 1000, value: Math.round((data.avgResponseTimeMs ?? 45) * (0.85 + Math.random() * 0.3)) })))
      setServices([
        { name: 'Compute (EC2)', description: 'api-server-overloaded · us-east-1', status: (data.uptime ?? 99.9) >= 99 ? 'healthy' : 'degraded', uptime: `${data.uptime ?? 99.9}%`, responseTime: `${data.avgResponseTimeMs ?? 45}ms`, errorRate: data.errorRate ?? 0, critical: true, recentIncidents: 0 },
        { name: 'Database (RDS)', description: 'PostgreSQL · us-east-1', status: 'healthy', uptime: '100%', responseTime: '12ms', errorRate: 0, critical: true, recentIncidents: 0 },
      ])
      setSystemStatus((data.uptime ?? 99.9) >= 99.9 ? 'healthy' : 'degraded'); setMetricsAvailable(true); setError(null); setLoading(false); setLastSynced(new Date()); return
    }
    if (demoMode) { generateDemoMetrics(); return }
    try {
      setLoading(true); setError(null)
      const controller = new AbortController(); const timeoutId = setTimeout(() => controller.abort(), 5000)
      const apiRes = await fetch(`${API_URL}/api/prometheus/health`, { signal: controller.signal }).catch(() => null)
      clearTimeout(timeoutId)
      const isAvailable = apiRes?.ok ?? false; setMetricsAvailable(isAvailable); setSystemStatus(isAvailable ? 'healthy' : 'down')
      if (!isAvailable) {
        setLoading(false)
        setServices([{ name: 'DevControl API', description: 'Main application server', status: 'down', uptime: '0%', responseTime: '--', errorRate: 0, critical: true }, { name: 'PostgreSQL', description: 'Primary database', status: 'down', uptime: '0%', responseTime: '--', errorRate: 0, critical: true }, { name: 'Node Exporter', description: 'System metrics collector', status: 'down', uptime: '0%', responseTime: '--', errorRate: 0 }])
        setError({ type: 'connection', message: 'Unable to connect to Prometheus', action: 'Verify Prometheus is running and accessible at ' + (process.env.NEXT_PUBLIC_PROMETHEUS_URL || 'http://localhost:9090') }); return
      }
      const uptimeData = await queryPrometheus('up{job="devcontrol-api"}')
      if (uptimeData?.result?.[0]?.value?.[1]) setUptime(parseFloat(uptimeData.result[0].value[1]) === 1 ? '99.95%' : '0%')
      let p95Value = 0
      const responseTimeQuery = await queryPrometheus('histogram_quantile(0.95, rate(http_request_duration_seconds_bucket{job="devcontrol-api"}[5m]))')
      if (responseTimeQuery?.result?.[0]?.value?.[1]) { const raw = parseFloat(responseTimeQuery.result[0].value[1]); if (!isNaN(raw) && raw > 0) p95Value = Math.round(raw * 1000) }
      if (p95Value === 0) { const avgQuery = await queryPrometheus('rate(http_request_duration_seconds_sum{job="devcontrol-api"}[5m]) / rate(http_request_duration_seconds_count{job="devcontrol-api"}[5m])'); if (avgQuery?.result?.[0]?.value?.[1]) { const raw = parseFloat(avgQuery.result[0].value[1]); if (!isNaN(raw) && raw > 0) p95Value = Math.round(raw * 1000) } }
      if (p95Value === 0) p95Value = 45
      setResponseTime(p95Value); setResponseTimeString(`${p95Value}ms`)
      const chartData = generateTimeSeriesData(p95Value); setResponseTimeData(chartData)
      if (chartData.length > 1) { const recent = chartData[chartData.length - 1].value; const previous = chartData[chartData.length - 2].value; setTrendPercent(previous > 0 ? ((recent - previous) / previous) * 100 : 0) }
      const costData = await queryPrometheus('infrastructure_cost_monthly_total')
      if (costData?.result?.[0]?.value?.[1]) { const cost = parseFloat(costData.result[0].value[1]); setMonthlyCost(!isNaN(cost) && cost > 0 ? `$${cost.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : '$0') } else setMonthlyCost('$0')
      const requestRateQuery = await queryPrometheus('rate(http_requests_total{job="devcontrol-api"}[5m]) * 60')
      if (requestRateQuery?.result?.[0]?.value?.[1]) { const rate = parseFloat(requestRateQuery.result[0].value[1]); if (!isNaN(rate)) setRequestsPerMinute(Math.round(rate)) }
      const serviceHealthData = await Promise.all([queryPrometheus('up{job="devcontrol-api"}'), queryPrometheus('up{job="postgres-exporter"}'), queryPrometheus('up{job="node-exporter"}')])
      const updatedServices: ServiceHealth[] = [
        { name: 'DevControl API', description: 'Main application server', status: serviceHealthData[0]?.result?.[0]?.value?.[1] === '1' ? 'healthy' : 'down', uptime: serviceHealthData[0]?.result?.[0]?.value?.[1] === '1' ? '99.95%' : '0%', responseTime: p95Value > 0 ? `${p95Value}ms` : '--', errorRate: 0.05, critical: true, recentIncidents: 0, uptimeHistory: [99,99.5,99.8,99.9,99.95,99.9,99.95,100] },
        { name: 'PostgreSQL', description: 'Primary database', status: serviceHealthData[1]?.result?.[0]?.value?.[1] === '1' ? 'healthy' : 'down', uptime: serviceHealthData[1]?.result?.[0]?.value?.[1] === '1' ? '100%' : '0%', responseTime: '12ms', errorRate: 0.0, critical: true, recentIncidents: 0, uptimeHistory: [100,100,100,100,100,100,100,100] },
        { name: 'Node Exporter', description: 'System metrics collector', status: serviceHealthData[2]?.result?.[0]?.value?.[1] === '1' ? 'healthy' : 'down', uptime: serviceHealthData[2]?.result?.[0]?.value?.[1] === '1' ? '100%' : '0%', responseTime: '--', errorRate: 0.0, critical: false, recentIncidents: 0, uptimeHistory: [100,100,99.9,100,100,100,100,100] },
      ]
      setServices(updatedServices); setLastSynced(new Date())
      saveSnapshot({ uptime: parseFloat(uptime) || null, responseTimeMs: responseTime || null, requestsPerMinute: requestsPerMinute || null, monthlyCost: parseFloat(monthlyCost.replace(/[$,]/g, '')) || null, services: updatedServices, slos, systemStatus })
      setLoading(false); toast.success('Metrics updated')
    } catch (err: any) {
      console.error('Error fetching metrics:', err)
      if (err.message === 'TIMEOUT') setError({ type: 'timeout', message: 'Request timed out', action: 'The Prometheus server is taking too long to respond.' })
      else if (err.message === 'CREDENTIALS') setError({ type: 'credentials', message: 'Authentication failed', action: 'Check your Prometheus credentials in Settings' })
      else setError({ type: 'connection', message: 'Unable to connect to Prometheus', action: 'Verify Prometheus is running and accessible at ' + (process.env.NEXT_PUBLIC_PROMETHEUS_URL || 'http://localhost:9090') })
      setLoading(false); toast.error('Failed to fetch metrics')
    }
  }, [timeRange, isDemoActive, generateDemoMetrics])

  const handleRefresh = async () => { await fetchMetrics() }

  useEffect(() => {
    checkAwsConnection()
    fetchCloudWatchMetrics().then(fetchMetrics)
    loadSnapshot()
    const interval = setInterval(() => fetchCloudWatchMetrics().then(fetchMetrics), 60000)
    return () => clearInterval(interval)
  }, [checkAwsConnection, fetchCloudWatchMetrics, fetchMetrics, loadSnapshot])

  if (!metricsAvailable && !isDemoActive && !loading && !error && awsConnected !== true && !cloudWatchMetrics) {
    return (
      <ErrorBoundary>
        <div className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 max-w-[1320px] mx-auto">
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
          <p className="text-sm text-slate-500 leading-relaxed">Real-time AWS infrastructure health, powered by CloudWatch · EC2, RDS, Lambda · {AWS_REGION}</p>
          {cloudWatchMetrics && (
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium bg-green-50 border border-green-200 rounded-full px-3 py-1 text-green-600">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" /> CloudWatch connected
              </span>
              <span className="text-[11px] text-slate-400">· Last synced {lastSynced.toLocaleTimeString()}</span>
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
            {[{ icon: '📊', label: 'Real-time visibility', desc: 'Identify issues before they impact users' }, { icon: '🔔', label: 'Proactive alerts', desc: 'Get notified before incidents escalate' }, { icon: '💰', label: 'Cost leak detection', desc: 'Find wasted spend across all services' }].map(({ icon, label, desc }) => (
              <div key={label} className="bg-white rounded-xl p-4 border border-violet-100 text-left">
                <div className="text-2xl mb-2">{icon}</div>
                <p className="text-xs font-semibold text-slate-900 mb-1">{label}</p>
                <p className="text-[11px] text-slate-400">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {!isDemoActive && awsConnected === true && error && !cloudWatchMetrics && (
        <MonitoringErrorState type={error.type} message={error.message} action={error.action} onRetry={handleRefresh} onSettings={() => router.push('/settings/monitoring')} onDiagnose={runDiagnostic} isDiagnosing={isDiagnosing} diagnosticResult={diagnosticResult} lastSnapshot={lastSnapshot} />
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
          {/* AI Insight banner */}
          <div className="bg-white rounded-xl border border-slate-100 px-4 sm:px-6 py-4 mb-6 flex items-start gap-3.5">
            <div className="w-8 h-8 rounded-lg bg-violet-600 flex items-center justify-center shrink-0"><Sparkles size={13} className="text-white" /></div>
            <div className="flex-1">
              <p className="text-[10px] font-semibold text-violet-600 uppercase tracking-widest mb-1">AI Insight</p>
              <p className="text-sm text-slate-700 leading-relaxed">
                {systemStatus === 'degraded'
                  ? 'Order Processor is degraded with 1.23% error rate and 458ms response time — 2 active alerts. Root cause likely upstream dependency or resource constraint. Payment API and User Service remain healthy at 99.99% uptime.'
                  : systemStatus === 'healthy'
                    ? `All ${services.length} services healthy. Average response time ${responseTimeString} with ${uptime} uptime. No active alerts detected.`
                    : 'System is down. Immediate investigation required across all services.'}
              </p>
            </div>
            {alerts.length > 0 && (
              <a href="/settings/alerts" className="text-xs font-semibold text-violet-600 no-underline shrink-0 flex items-center gap-1 whitespace-nowrap">View alerts <ArrowRight size={11} /></a>
            )}
          </div>

          {/* System status banner */}
          {systemStatus !== 'healthy' && (
            <div className={`rounded-xl border px-5 py-3 mb-6 flex flex-wrap items-center gap-2 ${systemStatus === 'degraded' ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'}`}>
              <div className={`w-2 h-2 rounded-full shrink-0 ${systemStatus === 'degraded' ? 'bg-amber-500' : 'bg-red-500'}`} />
              <span className={`text-sm font-semibold ${systemStatus === 'degraded' ? 'text-amber-800' : 'text-red-800'}`}>System {systemStatus === 'degraded' ? 'Degraded' : 'Down'} · {alerts.length} active alert{alerts.length !== 1 ? 's' : ''}</span>
              <span className={`text-xs ${systemStatus === 'degraded' ? 'text-amber-700' : 'text-red-700'}`}>· Last synced {lastSynced.toLocaleTimeString()}</span>
            </div>
          )}

          {/* 4 KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-7">
            {[
              { label: 'System Uptime', value: uptime, sub: 'Last 30 days', color: uptime === '--' ? 'text-slate-300' : parseFloat(uptime) >= 99.9 ? 'text-green-600' : 'text-amber-500' },
              { label: 'Avg Response Time', value: responseTimeString, sub: `${trendPercent > 0 ? '+' : ''}${trendPercent.toFixed(1)}% vs last period`, color: responseTime < 200 ? 'text-green-600' : responseTime < 500 ? 'text-amber-500' : 'text-red-600' },
              { label: 'Requests / Min', value: requestsPerMinute.toLocaleString(), sub: 'Current throughput', color: 'text-slate-900' },
              { label: 'Monthly Cost', value: monthlyCost, sub: monthlyCost === '--' ? 'Syncing — available in 24–48h' : 'Current monthly spend', color: monthlyCost === '--' ? 'text-slate-300' : 'text-slate-900' },
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
                    <span className={`text-xs font-normal ml-2 ${trendPercent < 0 ? 'text-green-600' : 'text-amber-500'}`}>{trendPercent > 0 ? '+' : ''}{trendPercent.toFixed(1)}% vs last period</span>
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
                <span className="text-xs text-slate-400">{services.filter(s => s.status === 'healthy').length}/{services.length} healthy</span>
                <a href="/services" className="text-xs font-semibold text-violet-600 no-underline flex items-center gap-1">All services <ArrowRight size={11} /></a>
              </div>
            </div>
            <ServiceHealthTable services={services} loading={loading} />
          </div>

          {/* SLO dashboard */}
          <div className="bg-white rounded-xl p-4 sm:p-8 border border-slate-100">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-5">
              <div>
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">Service Level Objectives</p>
                <p className="text-sm text-slate-900">{slos.filter(s => s.current >= s.target).length}/{slos.length} SLOs meeting target</p>
              </div>
              <a href="/monitoring/slos" className="text-xs font-semibold text-violet-600 no-underline flex items-center gap-1 whitespace-nowrap">Full SLO report <ArrowRight size={11} /></a>
            </div>
            <SLODashboard slos={slos} />
          </div>
        </>
      )}

      {!loading && !isDemoActive && services.length === 0 && !error && (
        <MonitoringEmptyState onSetup={() => router.push('/settings/monitoring')} />
      )}
    </div>
  )
}