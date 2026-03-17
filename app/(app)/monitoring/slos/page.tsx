'use client'

import { useState } from 'react'
import { useDemoMode } from '@/components/demo/demo-mode-toggle'
import { useSalesDemo } from '@/lib/demo/sales-demo-data'
import { Sparkles, ArrowRight, Target, TrendingUp, TrendingDown, AlertTriangle, CheckCircle2, Activity } from 'lucide-react'

interface SLO {
  id: string
  name: string
  description: string
  category: string
  current: number
  target: number
  errorBudget: number
  errorBudgetUsed: number
  trend: 'up' | 'down' | 'stable'
  trendValue: number
  status: 'met' | 'at_risk' | 'breached'
  window: string
}

const DEMO_SLOS: SLO[] = [
  { id: 's1', name: 'API Availability',       description: 'Overall API uptime across all endpoints',         category: 'Availability', current: 99.97, target: 99.9,  errorBudget: 0.1,  errorBudgetUsed: 30,  trend: 'stable', trendValue: 0.01,  status: 'met',      window: '30 days' },
  { id: 's2', name: 'Response Time p95',       description: '95th percentile latency under 500ms',             category: 'Performance',  current: 98.50, target: 95.0,  errorBudget: 5.0,  errorBudgetUsed: 30,  trend: 'up',     trendValue: 1.2,   status: 'met',      window: '30 days' },
  { id: 's3', name: 'Error Rate',              description: 'Less than 0.1% error rate across all services',  category: 'Reliability',  current: 99.88, target: 99.9,  errorBudget: 0.1,  errorBudgetUsed: 120, trend: 'down',   trendValue: -0.05, status: 'at_risk',  window: '30 days' },
  { id: 's4', name: 'Deployment Success Rate', description: 'Successful deployments to production',           category: 'Deployment',   current: 98.80, target: 98.0,  errorBudget: 2.0,  errorBudgetUsed: 60,  trend: 'up',     trendValue: 0.8,   status: 'met',      window: '30 days' },
  { id: 's5', name: 'Data Pipeline Freshness', description: 'Data pipelines completing within SLA window',    category: 'Data',         current: 97.20, target: 99.0,  errorBudget: 1.0,  errorBudgetUsed: 280, trend: 'down',   trendValue: -1.8,  status: 'breached', window: '30 days' },
  { id: 's6', name: 'Payment Processing',      description: 'Payment transactions completing successfully',    category: 'Business',     current: 99.96, target: 99.95, errorBudget: 0.05, errorBudgetUsed: 80,  trend: 'stable', trendValue: 0.0,   status: 'met',      window: '30 days' },
]

const DEMO_STATS = {
  total: 6,
  met: 4,
  atRisk: 1,
  breached: 1,
  avgCompliance: 99.05,
}

export default function SLODashboardPage() {
  const demoMode = useDemoMode()
  const salesDemoMode = useSalesDemo((state) => state.enabled)
  const isDemoActive = demoMode || salesDemoMode
  const [selectedCategory, setSelectedCategory] = useState<string>('all')

  const displaySLOs = isDemoActive ? DEMO_SLOS : []
  const displayStats = isDemoActive ? DEMO_STATS : { total: 0, met: 0, atRisk: 0, breached: 0, avgCompliance: 0 }

  const categories = ['all', ...Array.from(new Set(DEMO_SLOS.map(s => s.category)))]
  const filteredSLOs = selectedCategory === 'all'
    ? displaySLOs
    : displaySLOs.filter(s => s.category === selectedCategory)

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
            SLO Dashboard
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>
            Service Level Objectives — reliability targets and error budget tracking
          </p>
        </div>
        <a href="/monitoring" style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#7C3AED', color: '#fff', padding: '10px 20px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600, textDecoration: 'none' }}>
          <Activity size={15} /> Monitoring Overview
        </a>
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
              ? 'Data Pipeline Freshness SLO is breached — error budget 280% consumed. Immediate investigation required. Error Rate SLO is at risk with 120% budget consumed. 4 of 6 SLOs are healthy. Payment Processing maintaining 99.96% — exceeding target.'
              : 'Connect your monitoring stack to start tracking SLOs. SLO data will automatically populate from Prometheus metrics.'
            }
          </p>
        </div>
        {isDemoActive && displayStats.breached > 0 && (
          <a href="/observability/alerts" style={{ fontSize: '0.78rem', fontWeight: 600, color: '#DC2626', textDecoration: 'none', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
            View alerts <ArrowRight size={12} />
          </a>
        )}
      </div>

      {/* 4 KPI CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', marginBottom: '28px' }}>
        {[
          { label: 'SLOs Meeting Target', value: `${displayStats.met}/${displayStats.total}`,                                                                       sub: 'Within defined targets',   valueColor: '#059669' },
          { label: 'At Risk',             value: displayStats.atRisk,                                                                                               sub: 'Error budget > 50% used',  valueColor: displayStats.atRisk > 0 ? '#D97706' : '#059669' },
          { label: 'Breached',            value: displayStats.breached,                                                                                             sub: 'Require immediate action', valueColor: displayStats.breached > 0 ? '#DC2626' : '#059669' },
          { label: 'Avg Compliance',      value: displayStats.total > 0 ? `${displayStats.avgCompliance.toFixed(2)}%` : 'N/A',                                     sub: 'Across all SLOs',          valueColor: displayStats.avgCompliance >= 99 ? '#059669' : '#D97706' },
        ].map(({ label, value, sub, valueColor }) => (
          <div key={label} style={{ background: '#fff', borderRadius: '14px', padding: '32px', border: '1px solid #E2E8F0' }}>
            <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 16px' }}>{label}</p>
            <div style={{ fontSize: '2.5rem', fontWeight: 700, color: valueColor, letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '8px' }}>{value}</div>
            <p style={{ fontSize: '0.78rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>{sub}</p>
          </div>
        ))}
      </div>

      {/* SLO CARDS */}
      <div style={{ background: '#fff', borderRadius: '16px', border: '1px solid #F1F5F9', overflow: 'hidden' }}>

        {/* Header + category filter */}
        <div style={{ padding: '20px 28px', borderBottom: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 2px' }}>Service Level Objectives</p>
            <p style={{ fontSize: '0.78rem', color: '#94A3B8', margin: 0 }}>{filteredSLOs.length} SLOs · 30-day rolling window</p>
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {categories.map(cat => (
              <button key={cat} onClick={() => setSelectedCategory(cat)}
                style={{ padding: '4px 12px', borderRadius: '100px', fontSize: '0.75rem', fontWeight: 600, border: 'none', cursor: 'pointer',
                  background: selectedCategory === cat ? '#7C3AED' : '#F1F5F9',
                  color: selectedCategory === cat ? '#fff' : '#475569',
                }}>
                {cat === 'all' ? 'All' : cat}
              </button>
            ))}
          </div>
        </div>

        {/* SLO grid */}
        {filteredSLOs.length === 0 ? (
          <div style={{ padding: '64px', textAlign: 'center' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#F8FAFC', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <Target size={22} style={{ color: '#94A3B8' }} />
            </div>
            <p style={{ fontSize: '1rem', fontWeight: 600, color: '#0F172A', margin: '0 0 6px' }}>No SLOs configured</p>
            <p style={{ fontSize: '0.875rem', color: '#475569', margin: '0 0 24px', lineHeight: 1.6 }}>
              Connect your Prometheus instance to automatically track SLOs against your services.
            </p>
            <a href="/monitoring" style={{ background: '#7C3AED', color: '#fff', padding: '10px 24px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              <Activity size={14} /> Go to Monitoring
            </a>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1px', background: '#F1F5F9' }}>
            {filteredSLOs.map((slo) => {
              const statusColor = slo.status === 'met' ? '#059669' : slo.status === 'at_risk' ? '#D97706' : '#DC2626'
              const statusBg    = slo.status === 'met' ? '#F0FDF4' : slo.status === 'at_risk' ? '#FFFBEB' : '#FEF2F2'
              const statusLabel = slo.status === 'met' ? 'Met' : slo.status === 'at_risk' ? 'At Risk' : 'Breached'
              const budgetColor = slo.errorBudgetUsed > 100 ? '#DC2626' : slo.errorBudgetUsed > 50 ? '#D97706' : '#059669'
              const progressPct = Math.min((slo.current / 100) * 100, 100)
              const budgetBarPct = Math.min(slo.errorBudgetUsed, 100)

              return (
                <div key={slo.id} style={{ background: '#fff', padding: '28px 32px' }}>
                  {/* Card header */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '16px' }}>
                    <div>
                      <p style={{ fontSize: '0.68rem', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 4px' }}>{slo.category}</p>
                      <p style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0F172A', margin: 0, letterSpacing: '-0.01em' }}>{slo.name}</p>
                    </div>
                    <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '3px 10px', borderRadius: '100px', background: statusBg, color: statusColor, flexShrink: 0, marginLeft: '8px' }}>
                      {statusLabel}
                    </span>
                  </div>

                  <p style={{ fontSize: '0.78rem', color: '#64748B', margin: '0 0 20px', lineHeight: 1.5 }}>{slo.description}</p>

                  {/* Current vs target */}
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '8px' }}>
                    <span style={{ fontSize: '1.75rem', fontWeight: 700, color: statusColor, letterSpacing: '-0.02em' }}>{slo.current.toFixed(2)}%</span>
                    <span style={{ fontSize: '0.78rem', color: '#94A3B8' }}>target {slo.target}%</span>
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: slo.trend === 'up' ? '#059669' : slo.trend === 'down' ? '#DC2626' : '#64748B', marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '2px' }}>
                      {slo.trend === 'up' ? '↑' : slo.trend === 'down' ? '↓' : '→'}
                      {slo.trendValue !== 0 ? ` ${Math.abs(slo.trendValue)}%` : ' stable'}
                    </span>
                  </div>

                  {/* Compliance progress bar */}
                  <div style={{ height: '6px', background: '#F1F5F9', borderRadius: '100px', marginBottom: '16px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${progressPct}%`, background: statusColor, borderRadius: '100px', transition: 'width 0.3s' }} />
                  </div>

                  {/* Error budget */}
                  <div style={{ background: '#F8FAFC', borderRadius: '8px', padding: '10px 14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Error Budget</span>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: budgetColor }}>{slo.errorBudgetUsed}% used</span>
                    </div>
                    <div style={{ height: '4px', background: '#E2E8F0', borderRadius: '100px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${budgetBarPct}%`, background: budgetColor, borderRadius: '100px', transition: 'width 0.3s' }} />
                    </div>
                    <p style={{ fontSize: '0.72rem', color: '#94A3B8', margin: '6px 0 0' }}>{slo.window} rolling window</p>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

    </div>
  )
}
