'use client'

import { useState } from 'react'
import { useDemoMode } from '@/components/demo/demo-mode-toggle'
import { useSalesDemo } from '@/lib/demo/sales-demo-data'
import {
  CheckCircle2, AlertTriangle, XCircle, Sparkles,
  ArrowRight, Globe, Zap, Server, Database,
  Cloud, Shield, Activity, Clock, TrendingUp,
  ChevronDown, ChevronUp
} from 'lucide-react'

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
  {
    id: 1,
    title: 'Elevated API Latency',
    severity: 'minor',
    status: 'resolved',
    date: 'Mar 14, 2026',
    duration: '15 minutes',
    affected: ['API Gateway'],
    updates: [
      { time: '03:45 AM EDT', message: 'Investigation identified elevated p95 latency on API Gateway due to upstream cache miss. Fix deployed.' },
      { time: '03:30 AM EDT', message: 'We are investigating reports of elevated API response times. All other services remain unaffected.' },
    ],
  },
  {
    id: 2,
    title: 'Dashboard Slow Loading',
    severity: 'minor',
    status: 'resolved',
    date: 'Mar 9, 2026',
    duration: '8 minutes',
    affected: ['Web Application'],
    updates: [
      { time: '11:08 AM EDT', message: 'Root cause identified as CDN cache invalidation. Resolved and monitoring.' },
      { time: '11:00 AM EDT', message: 'Some users experiencing slow dashboard load times. Engineering investigating.' },
    ],
  },
  {
    id: 3,
    title: 'Scheduled Maintenance — Database Upgrade',
    severity: 'maintenance',
    status: 'resolved',
    date: 'Mar 4, 2026',
    duration: '30 minutes',
    affected: ['API Gateway', 'Web Application', 'Data Pipeline'],
    updates: [
      { time: '02:30 AM EDT', message: 'Maintenance completed successfully. All services operational and performing within normal parameters.' },
      { time: '02:00 AM EDT', message: 'Scheduled maintenance window begins. PostgreSQL version upgrade in progress.' },
    ],
  },
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

export default function StatusPage() {
  const demoMode = useDemoMode()
  const salesDemoMode = useSalesDemo((state) => state.enabled)
  const isDemoActive = demoMode || salesDemoMode
  const [expandedIncidents, setExpandedIncidents] = useState<number[]>([])

  const overallStatus: ServiceStatus = services.every(s => s.status === 'operational')
    ? 'operational'
    : services.some(s => s.status === 'outage')
      ? 'outage'
      : 'degraded'

  const toggleIncident = (id: number) => {
    setExpandedIncidents(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    )
  }

  const statusConfig = {
    operational: { label: 'Operational', color: '#059669', bg: '#F0FDF4', border: '#BBF7D0' },
    degraded:    { label: 'Degraded',    color: '#D97706', bg: '#FFFBEB', border: '#FDE68A' },
    outage:      { label: 'Outage',      color: '#DC2626', bg: '#FEF2F2', border: '#FECACA' },
    maintenance: { label: 'Maintenance', color: '#7C3AED', bg: '#F5F3FF', border: '#DDD6FE' },
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

      {/* PAGE HEADER */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '32px' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#0F172A', margin: '0 0 6px', letterSpacing: '-0.02em' }}>
            Platform Status
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>
            Real-time operational status across all DevControl services and regions
          </p>
        </div>
        <a href="/monitoring" style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#7C3AED', color: '#fff', padding: '10px 20px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600, textDecoration: 'none' }}>
          <Activity size={15} /> Monitoring Overview
        </a>
      </div>

      {/* HERO STATUS BANNER */}
      <div style={{
        background: overallStatus === 'operational' ? '#F0FDF4' : overallStatus === 'degraded' ? '#FFFBEB' : '#FEF2F2',
        border: `1px solid ${overallStatus === 'operational' ? '#BBF7D0' : overallStatus === 'degraded' ? '#FDE68A' : '#FECACA'}`,
        borderRadius: '16px',
        padding: '32px 40px',
        marginBottom: '28px',
        display: 'flex',
        alignItems: 'center',
        gap: '20px',
      }}>
        <div style={{
          width: '56px', height: '56px', borderRadius: '50%',
          background: overallStatus === 'operational' ? '#DCFCE7' : overallStatus === 'degraded' ? '#FEF3C7' : '#FEE2E2',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          {overallStatus === 'operational'
            ? <CheckCircle2 size={28} style={{ color: '#059669' }} />
            : overallStatus === 'degraded'
              ? <AlertTriangle size={28} style={{ color: '#D97706' }} />
              : <XCircle size={28} style={{ color: '#DC2626' }} />
          }
        </div>
        <div>
          <h2 style={{
            fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 4px',
            color: overallStatus === 'operational' ? '#059669' : overallStatus === 'degraded' ? '#D97706' : '#DC2626',
          }}>
            {overallStatus === 'operational' ? 'All Systems Operational' : overallStatus === 'degraded' ? 'Partial Service Degradation' : 'Service Disruption Detected'}
          </h2>
          <p style={{ fontSize: '0.875rem', color: '#475569', margin: 0 }}>
            DevControl platform status · Last updated: {new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })}
          </p>
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
            All 6 services operating within SLA parameters across 4 global regions. Platform uptime is 99.98% over the last 30 days — Elite tier reliability. 3 minor incidents resolved in the last 30 days with an average resolution time of 18 minutes. No active incidents or anomalies detected.
          </p>
        </div>
        <a href="/monitoring/slos" style={{ fontSize: '0.78rem', fontWeight: 600, color: '#7C3AED', textDecoration: 'none', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
          View SLOs <ArrowRight size={12} />
        </a>
      </div>

      {/* 4 KPI CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', marginBottom: '28px' }}>
        {[
          { label: 'Platform Uptime',   value: '99.98%', sub: 'Last 30 days',            valueColor: '#059669' },
          { label: 'Avg Response Time', value: '45ms',   sub: 'Across all endpoints',    valueColor: '#059669' },
          { label: 'Incidents (30d)',   value: '3',      sub: 'All resolved · 0 active', valueColor: '#0F172A' },
          { label: 'Global Regions',    value: '4',      sub: 'All regions operational', valueColor: '#0F172A' },
        ].map(({ label, value, sub, valueColor }) => (
          <div key={label} style={{ background: '#fff', borderRadius: '14px', padding: '32px', border: '1px solid #E2E8F0' }}>
            <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 16px' }}>{label}</p>
            <div style={{ fontSize: '2.5rem', fontWeight: 700, color: valueColor, letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '8px' }}>{value}</div>
            <p style={{ fontSize: '0.78rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>{sub}</p>
          </div>
        ))}
      </div>

      {/* SERVICE STATUS */}
      <div style={{ background: '#fff', borderRadius: '16px', border: '1px solid #F1F5F9', overflow: 'hidden', marginBottom: '24px' }}>
        <div style={{ padding: '20px 28px', borderBottom: '1px solid #F1F5F9' }}>
          <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 2px' }}>Service Status</p>
          <p style={{ fontSize: '0.78rem', color: '#94A3B8', margin: 0 }}>{services.filter(s => s.status === 'operational').length}/{services.length} services operational</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1px', background: '#F1F5F9' }}>
          {services.map((service) => {
            const cfg = statusConfig[service.status]
            const Icon = service.icon
            return (
              <div key={service.name} style={{ background: '#fff', padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#F8FAFC', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon size={15} style={{ color: '#475569' }} />
                    </div>
                    <div>
                      <p style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0F172A', margin: 0 }}>{service.name}</p>
                      <p style={{ fontSize: '0.72rem', color: '#94A3B8', margin: 0 }}>{service.description}</p>
                    </div>
                  </div>
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '3px 10px', borderRadius: '100px', background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}>
                    {cfg.label}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '24px' }}>
                  <div>
                    <p style={{ fontSize: '0.68rem', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 2px' }}>Uptime</p>
                    <p style={{ fontSize: '0.95rem', fontWeight: 700, color: '#059669', margin: 0 }}>{service.uptime}</p>
                  </div>
                  <div>
                    <p style={{ fontSize: '0.68rem', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 2px' }}>Response</p>
                    <p style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0F172A', margin: 0 }}>{service.responseTime}</p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* 7-DAY UPTIME HISTORY */}
      <div style={{ background: '#fff', borderRadius: '16px', padding: '28px 32px', border: '1px solid #F1F5F9', marginBottom: '24px' }}>
        <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 4px' }}>7-Day Uptime History</p>
        <p style={{ fontSize: '0.875rem', color: '#0F172A', fontWeight: 600, margin: '0 0 24px' }}>Overall platform availability</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '8px' }}>
          {uptimeHistory.map(({ day, value }) => (
            <div key={day} style={{ textAlign: 'center' }}>
              <div style={{
                height: '48px', borderRadius: '6px', marginBottom: '8px',
                background: value === 100 ? '#059669' : value >= 99.9 ? '#34D399' : value >= 99 ? '#FDE68A' : '#FCA5A5',
                opacity: 0.85,
              }} />
              <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', margin: '0 0 2px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{day}</p>
              <p style={{ fontSize: '0.82rem', fontWeight: 700, color: value === 100 ? '#059669' : value >= 99.9 ? '#059669' : '#D97706', margin: 0 }}>{value === 100 ? '100%' : `${value}%`}</p>
            </div>
          ))}
        </div>
      </div>

      {/* REGIONAL STATUS */}
      <div style={{ background: '#fff', borderRadius: '16px', padding: '28px 32px', border: '1px solid #F1F5F9', marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
          <Globe size={16} style={{ color: '#475569' }} />
          <div>
            <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 2px' }}>Regional Status</p>
            <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: 0 }}>Status by geographic region</p>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
          {regions.map((region) => {
            const cfg = statusConfig[region.status]
            return (
              <div key={region.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', background: '#F8FAFC', borderRadius: '10px', border: '1px solid #F1F5F9' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <CheckCircle2 size={16} style={{ color: '#059669' }} />
                  <div>
                    <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: 0 }}>{region.name}</p>
                    <p style={{ fontSize: '0.72rem', color: '#94A3B8', margin: 0 }}>Latency: {region.latency}</p>
                  </div>
                </div>
                <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '3px 10px', borderRadius: '100px', background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}>
                  {cfg.label}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* INCIDENT HISTORY */}
      <div style={{ background: '#fff', borderRadius: '16px', border: '1px solid #F1F5F9', overflow: 'hidden' }}>
        <div style={{ padding: '20px 28px', borderBottom: '1px solid #F1F5F9' }}>
          <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 2px' }}>Incident History</p>
          <p style={{ fontSize: '0.78rem', color: '#94A3B8', margin: 0 }}>Past incidents from the last 30 days · {incidents.filter(i => i.status === 'resolved').length} resolved</p>
        </div>
        {incidents.map((incident, idx) => {
          const isExpanded = expandedIncidents.includes(incident.id)
          const severityColor = incident.severity === 'maintenance' ? '#7C3AED' : incident.severity === 'major' ? '#DC2626' : '#D97706'
          const severityBg    = incident.severity === 'maintenance' ? '#F5F3FF' : incident.severity === 'major' ? '#FEF2F2' : '#FFFBEB'
          return (
            <div key={incident.id} style={{ borderBottom: idx < incidents.length - 1 ? '1px solid #F8FAFC' : 'none' }}>
              <div
                onClick={() => toggleIncident(incident.id)}
                style={{ padding: '18px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', transition: 'background 0.1s' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#F8FAFC' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <p style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0F172A', margin: 0 }}>{incident.title}</p>
                      <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '2px 8px', borderRadius: '100px', background: severityBg, color: severityColor, textTransform: 'capitalize' }}>
                        {incident.severity}
                      </span>
                      <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '2px 8px', borderRadius: '100px', background: '#F0FDF4', color: '#059669' }}>
                        resolved
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '16px' }}>
                      <span style={{ fontSize: '0.75rem', color: '#64748B', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Clock size={11} /> {incident.date}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: '#64748B', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <TrendingUp size={11} /> {incident.duration}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: '#64748B' }}>
                        Affected: {incident.affected.join(', ')}
                      </span>
                    </div>
                  </div>
                </div>
                {isExpanded
                  ? <ChevronUp size={16} style={{ color: '#94A3B8', flexShrink: 0 }} />
                  : <ChevronDown size={16} style={{ color: '#94A3B8', flexShrink: 0 }} />
                }
              </div>
              {isExpanded && (
                <div style={{ padding: '0 28px 20px', borderTop: '1px solid #F8FAFC' }}>
                  <div style={{ paddingTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {incident.updates.map((update, i) => (
                      <div key={i} style={{ display: 'flex', gap: '14px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: i === 0 ? '#059669' : '#CBD5E1', marginTop: '4px' }} />
                          {i < incident.updates.length - 1 && (
                            <div style={{ width: '1px', flex: 1, background: '#E2E8F0', marginTop: '4px' }} />
                          )}
                        </div>
                        <div style={{ paddingBottom: i < incident.updates.length - 1 ? '12px' : '0' }}>
                          <p style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', margin: '0 0 4px' }}>{update.time}</p>
                          <p style={{ fontSize: '0.875rem', color: '#1E293B', margin: 0, lineHeight: 1.6 }}>{update.message}</p>
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
