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
          <p style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#7C3AED', margin: '0 0 6px' }}>
            Observability
          </p>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#0F172A', margin: '0 0 6px', letterSpacing: '-0.02em' }}>
            SLO Intelligence
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>
            Reliability targets, error budget tracking, and breach risk across all services.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <a href="/monitoring" style={{ background: '#fff', color: '#475569', border: '1px solid #E2E8F0', borderRadius: '7px', padding: '8px 14px', fontSize: '12px', fontWeight: 600, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            Monitoring Overview
          </a>
          <a href="/observability/alert-history" style={{ background: '#DC2626', color: '#fff', border: 'none', borderRadius: '7px', padding: '9px 18px', fontSize: '12px', fontWeight: 700, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <AlertTriangle size={12} /> Resolve Breached SLOs
          </a>
        </div>
      </div>

      {/* DECISION INTELLIGENCE BANNER */}
      <div style={{ background: '#fff', borderRadius: '12px', padding: '14px 20px', border: '1px solid #E2E8F0', marginBottom: '16px', display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
        <div style={{ width: '28px', height: '28px', borderRadius: '7px', background: '#7C3AED', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Sparkles size={12} style={{ color: '#fff' }} />
        </div>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: '0.65rem', fontWeight: 700, color: '#7C3AED', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 4px' }}>Decision Intelligence</p>
          <p style={{ fontSize: '0.84rem', color: '#1E293B', margin: 0, lineHeight: 1.7 }}>
            {isDemoActive
              ? <>Primary risk is <strong style={{ color: '#DC2626' }}>data pipeline instability</strong> — error budget <strong style={{ color: '#DC2626' }}>280% consumed</strong>. If unresolved, reporting latency and downstream systems will degrade within 24h. Error Rate SLO approaching breach at 120% budget. 4 of 6 SLOs healthy — Payment Processing exceeding target at 99.96%.<span style={{ display: 'block', marginTop: '6px', fontSize: '0.78rem', color: '#64748B' }}>Recommended: investigate ingestion delays in last 24h window · define CDN SLO to track latency automatically.</span></>
              : <>No reliability targets defined — <strong style={{ color: '#DC2626' }}>system risk is currently unbounded</strong>. Without SLOs, you cannot detect performance degradation before users feel it or quantify reliability risk.<span style={{ display: 'block', marginTop: '6px', fontSize: '0.78rem', color: '#64748B' }}>Define your first SLO to begin measuring reliability against targets.</span></>
            }
          </p>
        </div>
        {isDemoActive && displayStats.breached > 0 && (
          <a href="/observability/alert-history" style={{ fontSize: '11px', fontWeight: 700, color: '#DC2626', textDecoration: 'none', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
            View alerts <ArrowRight size={11} />
          </a>
        )}
      </div>

      {/* RELIABILITY INTELLIGENCE STRIP */}
      {isDemoActive && (
        <div style={{ background: '#fff', borderRadius: '10px', border: '1px solid #E2E8F0', padding: '20px 24px', marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>

            {/* Score ring */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ position: 'relative', width: '54px', height: '54px', flexShrink: 0 }}>
                <svg width="54" height="54" viewBox="0 0 54 54">
                  <circle cx="27" cy="27" r="23" fill="none" stroke="#F1F5F9" strokeWidth="5"/>
                  <circle cx="27" cy="27" r="23" fill="none" stroke="#D97706" strokeWidth="5"
                    strokeDasharray="144.5" strokeDashoffset="58"
                    strokeLinecap="round" transform="rotate(-90 27 27)"/>
                </svg>
                <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: 700, color: '#0F172A' }}>60</span>
              </div>
              <div>
                <p style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#64748B', margin: '0 0 4px' }}>Reliability Score</p>
                <p style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0F172A', margin: '0 0 3px' }}>At Risk</p>
                <p style={{ fontSize: '0.68rem', color: '#64748B', margin: 0 }}>6/6 services measured · High confidence</p>
              </div>
            </div>

            <div style={{ width: '1px', height: '44px', background: '#E2E8F0', flexShrink: 0 }} />

            {/* Score drivers */}
            <div>
              <p style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#64748B', margin: '0 0 6px' }}>Driven by</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <p style={{ fontSize: '0.75rem', color: '#DC2626', fontWeight: 600, margin: 0 }}>● Data pipeline breach (280% error budget)</p>
                <p style={{ fontSize: '0.75rem', color: '#D97706', fontWeight: 500, margin: 0 }}>● Error rate nearing budget limit (120%)</p>
                <p style={{ fontSize: '0.75rem', color: '#64748B', fontWeight: 500, margin: 0 }}>● CDN latency anomaly detected</p>
              </div>
            </div>

            <div style={{ width: '1px', height: '44px', background: '#E2E8F0', flexShrink: 0 }} />

            {/* Business impact */}
            <div>
              <p style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#64748B', margin: '0 0 4px' }}>Business Impact</p>
              <p style={{ fontSize: '0.82rem', fontWeight: 600, color: '#0F172A', margin: '0 0 3px' }}>Reporting latency · downstream degradation</p>
              <p style={{ fontSize: '0.68rem', fontWeight: 600, color: '#DC2626', margin: 0 }}>If unresolved: SLA breach exposure within 24h</p>
            </div>

            <div style={{ width: '1px', height: '44px', background: '#E2E8F0', flexShrink: 0 }} />

            {/* Services impacted */}
            <div>
              <p style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#64748B', margin: '0 0 4px' }}>Services Impacted</p>
              <p style={{ fontSize: '0.95rem', fontWeight: 700, color: '#DC2626', margin: '0 0 3px' }}>2 of 6</p>
              <p style={{ fontSize: '0.68rem', color: '#64748B', margin: 0 }}>1 breached · 1 at risk</p>
            </div>

          </div>
          <a href="/costs/ai-reports" style={{ fontSize: '11px', fontWeight: 700, color: '#7C3AED', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap', flexShrink: 0 }}>
            Full report <ArrowRight size={11} />
          </a>
        </div>
      )}

      {/* 4 KPI CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px', marginBottom: '18px' }}>

        {/* SLOs Meeting Target — neutral */}
        <div style={{ background: '#fff', borderRadius: '12px', padding: '22px', border: '1px solid #E2E8F0' }}>
          <p style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#64748B', margin: '0 0 14px' }}>SLOs Meeting Target</p>
          {displayStats.total > 0
            ? <div style={{ fontSize: '2.1rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '5px' }}>{displayStats.met}<span style={{ fontSize: '1rem', color: '#94A3B8', fontWeight: 400 }}>/{displayStats.total}</span></div>
            : <div style={{ fontSize: '0.82rem', color: '#9CA3AF', marginBottom: '8px', lineHeight: 1.5 }}>No SLOs defined yet</div>
          }
          <p style={{ fontSize: '0.72rem', color: '#475569', margin: 0 }}>Within defined targets</p>
        </div>

        {/* At Risk — neutral with amber accent text only */}
        <div style={{ background: '#fff', borderRadius: '12px', padding: '22px', border: '1px solid #E2E8F0' }}>
          <p style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#D97706', margin: '0 0 14px' }}>At Risk</p>
          {displayStats.total > 0
            ? <div style={{ fontSize: '2.1rem', fontWeight: 700, color: '#D97706', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '5px' }}>{displayStats.atRisk}</div>
            : <div style={{ fontSize: '0.82rem', color: '#9CA3AF', marginBottom: '8px', lineHeight: 1.5 }}>No data — define SLOs</div>
          }
          <p style={{ fontSize: '0.72rem', color: '#475569', margin: '0 0 3px' }}>Error budget &gt;50% used</p>
          {displayStats.atRisk > 0 && <p style={{ fontSize: '10px', fontWeight: 700, color: '#D97706', margin: 0 }}>Review now →</p>}
        </div>

        {/* Breached — only this card gets red background */}
        <div style={{ background: displayStats.breached > 0 ? '#FFF5F5' : '#fff', borderRadius: '12px', padding: '22px', border: displayStats.breached > 0 ? '1px solid #FECACA' : '1px solid #E2E8F0' }}>
          <p style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#DC2626', margin: '0 0 14px' }}>Breached</p>
          {displayStats.total > 0
            ? <div style={{ fontSize: '2.1rem', fontWeight: 700, color: '#DC2626', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '5px' }}>{displayStats.breached}</div>
            : <div style={{ fontSize: '0.82rem', color: '#9CA3AF', marginBottom: '8px', lineHeight: 1.5 }}>No breaches detected</div>
          }
          <p style={{ fontSize: '0.72rem', color: '#475569', margin: '0 0 3px' }}>Immediate action required</p>
          {displayStats.breached > 0 && <p style={{ fontSize: '10px', fontWeight: 700, color: '#DC2626', margin: 0 }}>Resolve now →</p>}
        </div>

        {/* Avg Compliance — neutral */}
        <div style={{ background: '#fff', borderRadius: '12px', padding: '22px', border: '1px solid #E2E8F0' }}>
          <p style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#64748B', margin: '0 0 14px' }}>Avg Compliance</p>
          {displayStats.total > 0
            ? <div style={{ fontSize: '2.1rem', fontWeight: 700, color: '#059669', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '5px' }}>{displayStats.avgCompliance.toFixed(2)}%</div>
            : <div style={{ fontSize: '0.82rem', color: '#9CA3AF', marginBottom: '8px', lineHeight: 1.5 }}>Calculated after SLO data is collected</div>
          }
          <p style={{ fontSize: '0.72rem', color: '#475569', margin: 0 }}>Across all SLOs</p>
        </div>

      </div>

      {/* RECOMMENDED ACTIONS */}
      <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: '12px', padding: '20px 24px', marginBottom: '18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <div>
            <p style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#64748B', margin: '0 0 3px' }}>Recommended Actions</p>
            <p style={{ fontSize: '0.8rem', color: '#475569', margin: 0 }}>
              {isDemoActive ? 'Ranked by urgency · derived from active signals in your infrastructure' : 'Define SLOs to begin measuring reliability against targets'}
            </p>
          </div>
        </div>

        {isDemoActive ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
            {[
              {
                priority: 1, priorityColor: '#DC2626',
                title: 'Resolve Data Pipeline breach',
                impact: 'SLA exposure active',
                impactColor: '#DC2626',
                sub: 'Data Pipeline Freshness · 280% error budget consumed · ingestion delays suspected · reporting impact',
                bg: '#FFF5F5', border: '#FECACA', dividerColor: '#FECACA',
                badge: 'Critical', badgeBg: '#DC2626', badgeColor: '#fff',
                ctaLabel: 'Investigate →', ctaHref: '/observability/alert-history',
                ctaBg: '#DC2626', ctaColor: '#fff',
              },
              {
                priority: 2, priorityColor: '#D97706',
                title: 'Monitor Error Rate SLO',
                impact: 'budget 120% consumed',
                impactColor: '#D97706',
                sub: 'Error Rate · trending worse ↓ 0.05% · user-facing risk if unresolved · error budget degrading',
                bg: '#FFFBEB', border: '#FDE68A', dividerColor: '#FDE68A',
                badge: 'At Risk', badgeBg: '#FEF3C7', badgeColor: '#92400E',
                ctaLabel: 'Review →', ctaHref: '/observability/alert-history',
                ctaBg: '#fff', ctaColor: '#475569', ctaBorder: '1px solid #E2E8F0',
              },
              {
                priority: 3, priorityColor: '#64748B',
                title: 'Define SLO for API Server — 99.9% uptime',
                impact: 'latency signal active',
                impactColor: '#64748B',
                sub: 'production-api-server · CloudWatch signal · no SLO defined · reliability blind spot',
                bg: '#F8FAFC', border: '#F1F5F9', dividerColor: '#E2E8F0',
                badge: 'Gap Detected', badgeBg: '#F1F5F9', badgeColor: '#475569',
                ctaLabel: 'Add SLO →', ctaHref: '/monitoring',
                ctaBg: '#7C3AED', ctaColor: '#fff',
              },
              {
                priority: 4, priorityColor: '#64748B',
                title: 'Define SLO for CloudFront CDN — error rate <1%',
                impact: 'anomaly warning active',
                impactColor: '#64748B',
                sub: 'production-cdn · latency warning in anomalies · no SLO defined · user experience risk',
                bg: '#F8FAFC', border: '#F1F5F9', dividerColor: '#E2E8F0',
                badge: 'Gap Detected', badgeBg: '#F1F5F9', badgeColor: '#475569',
                ctaLabel: 'Add SLO →', ctaHref: '/monitoring',
                ctaBg: '#7C3AED', ctaColor: '#fff',
              },
            ].map((action) => (
              <div key={action.priority} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 16px', background: action.bg, borderRadius: '8px', border: `1px solid ${action.border}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <div style={{ textAlign: 'center', minWidth: '40px' }}>
                    <p style={{ fontSize: '0.6rem', fontWeight: 700, color: action.priorityColor, textTransform: 'uppercase', margin: '0 0 2px' }}>Priority</p>
                    <p style={{ fontSize: '1rem', fontWeight: 700, color: action.priorityColor, margin: 0 }}>{action.priority}</p>
                  </div>
                  <div style={{ width: '1px', height: '32px', background: action.dividerColor, flexShrink: 0 }} />
                  <div>
                    <p style={{ fontSize: '0.84rem', fontWeight: 600, color: '#0F172A', margin: '0 0 3px' }}>
                      {action.title} — <span style={{ color: action.impactColor }}>{action.impact}</span>
                    </p>
                    <p style={{ fontSize: '0.7rem', color: '#64748B', margin: 0 }}>{action.sub}</p>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flexShrink: 0 }}>
                  <span style={{ display: 'inline-flex', padding: '2px 7px', borderRadius: '4px', fontSize: '9.5px', fontWeight: 700, textTransform: 'uppercase', background: action.badgeBg, color: action.badgeColor }}>{action.badge}</span>
                  <a href={action.ctaHref} style={{ background: action.ctaBg, color: action.ctaColor, border: (action as any).ctaBorder ?? 'none', borderRadius: '6px', padding: '5px 13px', fontSize: '11px', fontWeight: 700, textDecoration: 'none' }}>{action.ctaLabel}</a>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
            {[
              { label: 'Define an uptime SLO', sub: 'Track availability across your API endpoints', href: '/monitoring' },
              { label: 'Define a latency SLO', sub: 'Measure p95 response time against a target threshold', href: '/monitoring' },
              { label: 'Define an error rate SLO', sub: 'Detect service degradation before users feel it', href: '/monitoring' },
            ].map((item) => (
              <div key={item.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: '#F8FAFC', borderRadius: '8px', border: '1px solid #F1F5F9' }}>
                <div>
                  <p style={{ fontSize: '0.84rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>{item.label}</p>
                  <p style={{ fontSize: '0.72rem', color: '#64748B', margin: 0 }}>{item.sub}</p>
                </div>
                <a href={item.href} style={{ background: '#7C3AED', color: '#fff', border: 'none', borderRadius: '6px', padding: '5px 13px', fontSize: '11px', fontWeight: 700, textDecoration: 'none' }}>Add SLO →</a>
              </div>
            ))}
          </div>
        )}
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
            <p style={{ fontSize: '1rem', fontWeight: 600, color: '#0F172A', margin: '0 0 6px' }}>Reliability visibility: 0%</p>
            <p style={{ fontSize: '0.875rem', color: '#475569', margin: '0 0 24px', lineHeight: 1.6 }}>
              Without SLOs, system risk is unknown — you cannot detect performance degradation before users feel it, quantify reliability exposure, or prevent incidents from becoming reactive.
            </p>
            <a href="/monitoring" style={{ background: '#7C3AED', color: '#fff', padding: '10px 24px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              <Activity size={14} /> Set Up SLO Tracking
            </a>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1px', background: '#F1F5F9' }}>
            {filteredSLOs.map((slo) => {
              const cardBg     = slo.status === 'breached' ? '#FFF5F5' : '#fff'
              const cardBorder = slo.status === 'breached' ? '1px solid #FECACA' : 'none'

              const statusBadgeBg    = slo.status === 'met' ? '#F1F5F9' : slo.status === 'at_risk' ? '#FEF3C7' : '#DC2626'
              const statusBadgeColor = slo.status === 'met' ? '#475569' : slo.status === 'at_risk' ? '#92400E' : '#fff'
              const statusLabel      = slo.status === 'met' ? 'Met' : slo.status === 'at_risk' ? 'At Risk' : 'Breached'

              const valueColor    = slo.status === 'breached' ? '#DC2626' : slo.status === 'at_risk' ? '#D97706' : '#0F172A'
              const budgetBg      = slo.status === 'breached' ? '#FEE2E2' : '#F8FAFC'
              const budgetBarColor = slo.errorBudgetUsed > 100 ? '#DC2626' : slo.errorBudgetUsed > 50 ? '#D97706' : '#059669'
              const budgetTextColor = slo.errorBudgetUsed > 100 ? '#DC2626' : slo.errorBudgetUsed > 50 ? '#D97706' : '#475569'

              const progressPct  = Math.min((slo.current / 100) * 100, 100)
              const budgetBarPct = Math.min(slo.errorBudgetUsed, 100)

              return (
                <div key={slo.id} style={{ background: cardBg, padding: '24px 28px', border: cardBorder }}>
                  {/* Card header */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {slo.status !== 'breached' && (
                        <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: slo.status === 'met' ? '#059669' : '#D97706', display: 'inline-block', flexShrink: 0, marginTop: '2px' }} />
                      )}
                      <div>
                        <p style={{ fontSize: '0.65rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 4px' }}>{slo.category}</p>
                        <p style={{ fontSize: '0.92rem', fontWeight: 700, color: '#0F172A', margin: 0 }}>{slo.name}</p>
                      </div>
                    </div>
                    <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 9px', borderRadius: '100px', background: statusBadgeBg, color: statusBadgeColor, flexShrink: 0, marginLeft: '8px' }}>{statusLabel}</span>
                  </div>

                  <p style={{ fontSize: '0.78rem', color: '#64748B', margin: '0 0 20px', lineHeight: 1.5 }}>{slo.description}</p>

                  {/* Current vs target */}
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '8px' }}>
                    <span style={{ fontSize: '1.75rem', fontWeight: 700, color: valueColor, letterSpacing: '-0.02em' }}>{slo.current.toFixed(2)}%</span>
                    <span style={{ fontSize: '0.78rem', color: '#94A3B8' }}>target {slo.target}%</span>
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: slo.trend === 'up' ? '#059669' : slo.trend === 'down' ? '#DC2626' : '#64748B', marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '2px' }}>
                      {slo.trend === 'up' ? '↑' : slo.trend === 'down' ? '↓' : '→'}
                      {slo.trendValue !== 0 ? ` ${Math.abs(slo.trendValue)}%` : ' stable'}
                    </span>
                  </div>

                  {/* Compliance progress bar */}
                  <div style={{ height: '6px', background: '#F1F5F9', borderRadius: '100px', marginBottom: '16px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${progressPct}%`, background: valueColor, borderRadius: '100px', transition: 'width 0.3s' }} />
                  </div>

                  {/* Error budget */}
                  <div style={{ background: budgetBg, borderRadius: '8px', padding: '10px 14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Error Budget</span>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: budgetTextColor }}>{slo.errorBudgetUsed}% used</span>
                    </div>
                    <div style={{ height: '4px', background: '#E2E8F0', borderRadius: '100px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${budgetBarPct}%`, background: budgetBarColor, borderRadius: '100px', transition: 'width 0.3s' }} />
                    </div>
                    {(slo.status === 'at_risk' || slo.status === 'breached') && (
                      <p style={{ fontSize: '0.68rem', fontWeight: 700, color: slo.status === 'breached' ? '#991B1B' : '#92400E', margin: '5px 0 0' }}>
                        {slo.status === 'breached'
                          ? `Immediate investigation required · ${slo.errorBudgetUsed}% consumed`
                          : `Budget exhausted · trending ${slo.trend === 'down' ? 'worse ↓' : 'stable'}`
                        }
                      </p>
                    )}
                    {slo.status === 'met' && (
                      <p style={{ fontSize: '0.68rem', color: '#94A3B8', margin: '5px 0 0' }}>{slo.window} rolling window</p>
                    )}
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
