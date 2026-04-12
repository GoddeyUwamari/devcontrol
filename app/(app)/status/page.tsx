'use client'

import { useState } from 'react'
import { useDemoMode } from '@/components/demo/demo-mode-toggle'
import { useSalesDemo } from '@/lib/demo/sales-demo-data'
import { CheckCircle2, AlertTriangle, XCircle, Sparkles, ArrowRight, Globe, Zap, Server, Database, Cloud, Shield, Activity, Clock, TrendingUp, ChevronDown, ChevronUp } from 'lucide-react'

type ServiceStatus = 'operational' | 'degraded' | 'outage' | 'maintenance'

const services = [
  { name: 'API Gateway',     description: 'REST API endpoints and routing',   status: 'operational' as ServiceStatus, uptime: '99.99%', responseTime: '45ms',  icon: Server   },
  { name: 'Web Application', description: 'Dashboard and user interface',      status: 'operational' as ServiceStatus, uptime: '99.98%', responseTime: '120ms', icon: Activity },
  { name: 'Data Pipeline',   description: 'Data processing and analytics',     status: 'operational' as ServiceStatus, uptime: '99.95%', responseTime: '200ms', icon: Database },
  { name: 'AWS Integration', description: 'Resource discovery and cost sync',  status: 'operational' as ServiceStatus, uptime: '99.97%', responseTime: '80ms',  icon: Cloud    },
  { name: 'Webhooks',        description: 'Event notifications and callbacks', status: 'operational' as ServiceStatus, uptime: '99.99%', responseTime: '35ms',  icon: Zap      },
  { name: 'Authentication',  description: 'Login, SSO, and access control',   status: 'operational' as ServiceStatus, uptime: '100%',   responseTime: '25ms',  icon: Shield   },
]

const incidents = [
  { id: 1, title: 'Elevated API Latency', severity: 'minor', status: 'resolved', date: 'Mar 14, 2026', duration: '15 minutes', affected: ['API Gateway'], updates: [{ time: '03:45 AM EDT', message: 'Investigation identified elevated p95 latency on API Gateway due to upstream cache miss. Fix deployed.' }, { time: '03:30 AM EDT', message: 'We are investigating reports of elevated API response times. All other services remain unaffected.' }] },
  { id: 2, title: 'Dashboard Slow Loading', severity: 'minor', status: 'resolved', date: 'Mar 9, 2026', duration: '8 minutes', affected: ['Web Application'], updates: [{ time: '11:08 AM EDT', message: 'Root cause identified as CDN cache invalidation. Resolved and monitoring.' }, { time: '11:00 AM EDT', message: 'Some users experiencing slow dashboard load times. Engineering investigating.' }] },
  { id: 3, title: 'Scheduled Maintenance — Database Upgrade', severity: 'maintenance', status: 'resolved', date: 'Mar 4, 2026', duration: '30 minutes', affected: ['API Gateway', 'Web Application', 'Data Pipeline'], updates: [{ time: '02:30 AM EDT', message: 'Maintenance completed successfully. All services operational and performing within normal parameters.' }, { time: '02:00 AM EDT', message: 'Scheduled maintenance window begins. PostgreSQL version upgrade in progress.' }] },
]

const regions = [
  { name: 'US East (Virginia)',   latency: '12ms', status: 'operational' as ServiceStatus },
  { name: 'US West (Oregon)',     latency: '15ms', status: 'operational' as ServiceStatus },
  { name: 'EU (Ireland)',         latency: '18ms', status: 'operational' as ServiceStatus },
  { name: 'Asia Pacific (Tokyo)', latency: '25ms', status: 'operational' as ServiceStatus },
]

const uptimeHistory = [
  { day: 'Mon', value: 100   },
  { day: 'Tue', value: 99.98 },
  { day: 'Wed', value: 100   },
  { day: 'Thu', value: 100   },
  { day: 'Fri', value: 99.95 },
  { day: 'Sat', value: 100   },
  { day: 'Sun', value: 100   },
]

const statusConfig = {
  operational: { label: 'Operational', color: '#059669', bg: '#F0FDF4', border: '#BBF7D0' },
  degraded:    { label: 'Degraded',    color: '#D97706', bg: '#FFFBEB', border: '#FDE68A' },
  outage:      { label: 'Outage',      color: '#DC2626', bg: '#FEF2F2', border: '#FECACA' },
  maintenance: { label: 'Maintenance', color: '#7C3AED', bg: '#F5F3FF', border: '#DDD6FE' },
}

export default function StatusPage() {
  const demoMode = useDemoMode()
  const salesDemoMode = useSalesDemo((state) => state.enabled)
  const [expandedIncidents, setExpandedIncidents] = useState<number[]>([])

  const overallStatus: ServiceStatus = services.every(s => s.status === 'operational') ? 'operational' : services.some(s => s.status === 'outage') ? 'outage' : 'degraded'
  const toggleIncident = (id: number) => setExpandedIncidents(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id])

  const heroBg = overallStatus === 'operational' ? 'bg-green-50 border-green-200' : overallStatus === 'degraded' ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'
  const heroIconBg = overallStatus === 'operational' ? 'bg-green-100' : overallStatus === 'degraded' ? 'bg-amber-100' : 'bg-red-100'
  const heroTitleColor = overallStatus === 'operational' ? 'text-green-600' : overallStatus === 'degraded' ? 'text-amber-500' : 'text-red-600'

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 max-w-[1320px] mx-auto">

      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-8">
        <div>
          <p className="text-[10px] font-bold text-violet-600 uppercase tracking-widest mb-1.5">Observability</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mb-1.5">Status Intelligence</h1>
          <p className="text-sm text-slate-500 leading-relaxed">Real-time health, uptime, and performance across your monitored services and regions</p>
        </div>
        <a href="/monitoring" className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white px-4 py-2.5 rounded-lg text-sm font-semibold no-underline transition-colors whitespace-nowrap self-start">
          <Activity size={14} /> Monitoring Overview
        </a>
      </div>

      {/* Hero status banner */}
      <div className={`rounded-2xl border p-6 sm:p-8 mb-7 flex items-center gap-4 sm:gap-5 ${heroBg}`}>
        <div className={`w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center shrink-0 ${heroIconBg}`}>
          {overallStatus === 'operational' ? <CheckCircle2 size={26} className="text-green-600" /> : overallStatus === 'degraded' ? <AlertTriangle size={26} className="text-amber-500" /> : <XCircle size={26} className="text-red-600" />}
        </div>
        <div>
          <h2 className={`text-xl sm:text-2xl font-bold tracking-tight mb-1 ${heroTitleColor}`}>
            {overallStatus === 'operational' ? 'System Healthy — No Action Required' : overallStatus === 'degraded' ? 'Partial Service Degradation' : 'Service Disruption Detected'}
          </h2>
          <p className="text-sm text-slate-500">
            {overallStatus === 'operational'
              ? `System risk: NONE · all services within SLA · last updated: ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })}`
              : overallStatus === 'degraded'
                ? `System risk: ELEVATED · service degradation detected · last updated: ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })}`
                : `System risk: CRITICAL · active outage detected · last updated: ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })}`}
          </p>
        </div>
      </div>

      {/* Decision Intelligence */}
      <div className="bg-white rounded-xl border border-slate-100 px-4 sm:px-5 py-4 mb-6 flex items-start gap-3.5">
        <div className="w-7 h-7 rounded-lg bg-violet-600 flex items-center justify-center shrink-0"><Sparkles size={12} className="text-white" /></div>
        <div className="flex-1">
          <p className="text-[10px] font-bold text-violet-600 uppercase tracking-widest mb-1">Decision Intelligence</p>
          <p className="text-sm text-slate-700 leading-relaxed">
            {overallStatus === 'operational'
              ? <><strong className="text-green-600">All systems operating within SLA.</strong> Uptime stable at 99.98% — Elite tier (last 30 days). 3 minor incidents resolved · avg resolution 18 minutes. No performance degradation across regions · no cost anomalies linked to incidents.<span className="block mt-1 text-xs text-green-600 font-semibold">No action required — system is healthy.</span></>
              : overallStatus === 'degraded'
                ? <><strong className="text-amber-500">Partial service degradation detected.</strong> Review highlighted services and check recent deployments for root cause.<span className="block mt-1 text-xs text-amber-500 font-semibold">Action required — investigate degraded services.</span></>
                : <><strong className="text-red-600">Service disruption detected.</strong> Escalate immediately and review incident timeline for impact scope.<span className="block mt-1 text-xs text-red-600 font-semibold">Critical — escalate now.</span></>}
          </p>
        </div>
        <a href="/monitoring/slos" className="text-[11px] font-bold text-violet-600 no-underline shrink-0 flex items-center gap-1 whitespace-nowrap">View SLOs <ArrowRight size={10} /></a>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-7">
        {[
          { label: 'Platform Uptime',   value: '99.98%', sub: 'Last 30 days',            color: 'text-green-600', hero: true  },
          { label: 'Avg Response Time', value: '45ms',   sub: 'Across all endpoints',    color: 'text-slate-900', hero: false },
          { label: 'Incidents (30d)',   value: '3',      sub: 'All resolved · 0 active', color: 'text-slate-900', hero: false },
          { label: 'Global Regions',    value: '4',      sub: 'All regions operational', color: 'text-slate-900', hero: false },
        ].map(({ label, value, sub, color, hero }) => (
          <div key={label} className={`bg-white rounded-xl p-4 sm:p-8 border border-slate-200 ${hero ? 'border-l-[2px] border-l-violet-600' : ''}`}>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">{label}</p>
            <div className={`text-2xl sm:text-3xl font-bold tracking-tight leading-none mb-2 ${color}`}>{value}</div>
            <p className="text-xs text-slate-400 leading-relaxed">{sub}</p>
          </div>
        ))}
      </div>

      {/* Service status */}
      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden mb-6">
        <div className="px-5 sm:px-7 py-4 border-b border-slate-100">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Service Status</p>
          <p className="text-xs text-slate-300">{services.filter(s => s.status === 'operational').length}/{services.length} services operational</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" style={{ gap: '1px', background: '#F1F5F9' }}>
          {services.map((service) => {
            const cfg = statusConfig[service.status]
            const Icon = service.icon
            return (
              <div key={service.name} className="bg-white p-5 sm:p-7 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center shrink-0"><Icon size={14} className="text-slate-400" /></div>
                    <div>
                      <p className="text-sm font-bold text-slate-900">{service.name}</p>
                      <p className="text-[10px] text-slate-400">{service.description}</p>
                    </div>
                  </div>
                  <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full border shrink-0 ml-2" style={{ background: cfg.bg, color: cfg.color, borderColor: cfg.border }}>{cfg.label}</span>
                </div>
                <div className="flex gap-6">
                  <div>
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-0.5">Uptime</p>
                    <p className="text-sm font-bold text-green-600">{service.uptime}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-0.5">Response</p>
                    <p className="text-sm font-bold text-slate-900">{service.responseTime}</p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* 7-day uptime history */}
      <div className="bg-white rounded-2xl p-5 sm:p-8 border border-slate-100 mb-6">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">7-Day Uptime History</p>
        <p className="text-sm font-semibold text-slate-900 mb-6">No downtime in the last 7 days · 100% availability across all monitored services</p>
        <div className="grid grid-cols-7 gap-2">
          {uptimeHistory.map(({ day, value }) => (
            <div key={day} className="text-center">
              <div className="h-10 sm:h-12 rounded-md mb-2" style={{ background: value === 100 ? '#059669' : value >= 99.9 ? '#34D399' : value >= 99 ? '#FDE68A' : '#FCA5A5', opacity: 0.85 }} />
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-0.5">{day}</p>
              <p className={`text-xs font-bold ${value >= 99.9 ? 'text-green-600' : 'text-amber-500'}`}>{value === 100 ? '100%' : `${value}%`}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Regional status */}
      <div className="bg-white rounded-2xl p-5 sm:p-8 border border-slate-100 mb-6">
        <div className="flex items-center gap-2.5 mb-5">
          <Globe size={15} className="text-slate-400" />
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Regional Status</p>
            <p className="text-sm font-semibold text-slate-900">All regions operational · No latency anomalies detected</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {regions.map((region) => {
            const cfg = statusConfig[region.status]
            return (
              <div key={region.name} className="flex items-center justify-between px-4 sm:px-5 py-3.5 bg-slate-50 rounded-xl border border-slate-100">
                <div className="flex items-center gap-2.5">
                  <CheckCircle2 size={15} className="text-green-600 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{region.name}</p>
                    <p className="text-[10px] text-slate-400">Latency: {region.latency}</p>
                  </div>
                </div>
                <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full border" style={{ background: cfg.bg, color: cfg.color, borderColor: cfg.border }}>{cfg.label}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Incident history */}
      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        <div className="px-5 sm:px-7 py-4 border-b border-slate-100">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Incident History</p>
          <p className="text-xs text-slate-300">{incidents.filter(i => i.status === 'resolved').length} incidents in the last 30 days — all minor, no customer impact</p>
        </div>
        {incidents.map((incident, idx) => {
          const isExpanded = expandedIncidents.includes(incident.id)
          const severityColor = incident.severity === 'maintenance' ? '#7C3AED' : incident.severity === 'major' ? '#DC2626' : '#D97706'
          const severityBg    = incident.severity === 'maintenance' ? '#F5F3FF' : incident.severity === 'major' ? '#FEF2F2' : '#FFFBEB'
          return (
            <div key={incident.id} className={idx < incidents.length - 1 ? 'border-b border-slate-50' : ''}>
              <div onClick={() => toggleIncident(incident.id)}
                className="px-5 sm:px-7 py-4 flex items-center justify-between cursor-pointer hover:bg-slate-50 transition-colors">
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-1.5">
                    <p className="text-sm font-bold text-slate-900">{incident.title}</p>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full capitalize" style={{ background: severityBg, color: severityColor }}>{incident.severity}</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-50 text-green-600">resolved</span>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <span className="text-xs text-slate-400 flex items-center gap-1"><Clock size={10} /> {incident.date}</span>
                    <span className="text-xs text-slate-400 flex items-center gap-1"><TrendingUp size={10} /> {incident.duration}</span>
                    <span className="text-xs text-slate-400">Affected: {incident.affected.join(', ')}</span>
                  </div>
                </div>
                {isExpanded ? <ChevronUp size={15} className="text-slate-300 shrink-0 ml-3" /> : <ChevronDown size={15} className="text-slate-300 shrink-0 ml-3" />}
              </div>
              {isExpanded && (
                <div className="px-5 sm:px-7 pb-5 border-t border-slate-50 pt-4">
                  <div className="flex flex-col gap-3">
                    {incident.updates.map((update, i) => (
                      <div key={i} className="flex gap-3.5">
                        <div className="flex flex-col items-center shrink-0">
                          <div className={`w-2 h-2 rounded-full mt-1 ${i === 0 ? 'bg-green-500' : 'bg-slate-200'}`} />
                          {i < incident.updates.length - 1 && <div className="w-px flex-1 bg-slate-200 mt-1" />}
                        </div>
                        <div className={i < incident.updates.length - 1 ? 'pb-3' : ''}>
                          <p className="text-xs font-semibold text-slate-400 mb-1">{update.time}</p>
                          <p className="text-sm text-slate-700 leading-relaxed">{update.message}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}