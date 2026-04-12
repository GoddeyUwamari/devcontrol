'use client'

import { useState } from 'react'
import { useDemoMode } from '@/components/demo/demo-mode-toggle'
import { useSalesDemo } from '@/lib/demo/sales-demo-data'
import { Sparkles, ArrowRight, Target, AlertTriangle, Activity } from 'lucide-react'

interface SLO {
  id: string; name: string; description: string; category: string
  current: number; target: number; errorBudget: number; errorBudgetUsed: number
  trend: 'up' | 'down' | 'stable'; trendValue: number
  status: 'met' | 'at_risk' | 'breached'; window: string
}

const DEMO_SLOS: SLO[] = [
  { id: 's1', name: 'API Availability',       description: 'Overall API uptime across all endpoints',        category: 'Availability', current: 99.97, target: 99.9,  errorBudget: 0.1,  errorBudgetUsed: 30,  trend: 'stable', trendValue: 0.01,  status: 'met',      window: '30 days' },
  { id: 's2', name: 'Response Time p95',       description: '95th percentile latency under 500ms',            category: 'Performance',  current: 98.50, target: 95.0,  errorBudget: 5.0,  errorBudgetUsed: 30,  trend: 'up',     trendValue: 1.2,   status: 'met',      window: '30 days' },
  { id: 's3', name: 'Error Rate',              description: 'Less than 0.1% error rate across all services', category: 'Reliability',  current: 99.88, target: 99.9,  errorBudget: 0.1,  errorBudgetUsed: 120, trend: 'down',   trendValue: -0.05, status: 'at_risk',  window: '30 days' },
  { id: 's4', name: 'Deployment Success Rate', description: 'Successful deployments to production',          category: 'Deployment',   current: 98.80, target: 98.0,  errorBudget: 2.0,  errorBudgetUsed: 60,  trend: 'up',     trendValue: 0.8,   status: 'met',      window: '30 days' },
  { id: 's5', name: 'Data Pipeline Freshness', description: 'Data pipelines completing within SLA window',   category: 'Data',         current: 97.20, target: 99.0,  errorBudget: 1.0,  errorBudgetUsed: 280, trend: 'down',   trendValue: -1.8,  status: 'breached', window: '30 days' },
  { id: 's6', name: 'Payment Processing',      description: 'Payment transactions completing successfully',   category: 'Business',     current: 99.96, target: 99.95, errorBudget: 0.05, errorBudgetUsed: 80,  trend: 'stable', trendValue: 0.0,   status: 'met',      window: '30 days' },
]

const DEMO_STATS = { total: 6, met: 4, atRisk: 1, breached: 1, avgCompliance: 99.05 }

export default function SLODashboardPage() {
  const demoMode = useDemoMode()
  const salesDemoMode = useSalesDemo((state) => state.enabled)
  const isDemoActive = demoMode || salesDemoMode
  const [selectedCategory, setSelectedCategory] = useState<string>('all')

  const displaySLOs = isDemoActive ? DEMO_SLOS : []
  const displayStats = isDemoActive ? DEMO_STATS : { total: 0, met: 0, atRisk: 0, breached: 0, avgCompliance: 0 }
  const categories = ['all', ...Array.from(new Set(DEMO_SLOS.map(s => s.category)))]
  const filteredSLOs = selectedCategory === 'all' ? displaySLOs : displaySLOs.filter(s => s.category === selectedCategory)

  const ACTIONS_DEMO = [
    { priority: 1, priorityColor: 'text-red-600', title: 'Resolve Data Pipeline breach', impact: 'SLA exposure active', impactColor: 'text-red-600', sub: 'Data Pipeline Freshness · 280% error budget consumed · ingestion delays suspected · reporting impact', bg: 'bg-red-50', border: 'border-red-200', badge: 'Critical', badgeCls: 'bg-red-600 text-white', ctaLabel: 'Investigate →', ctaHref: '/observability/alert-history', ctaCls: 'bg-red-600 hover:bg-red-700 text-white border-transparent' },
    { priority: 2, priorityColor: 'text-amber-500', title: 'Monitor Error Rate SLO', impact: 'budget 120% consumed', impactColor: 'text-amber-500', sub: 'Error Rate · trending worse ↓ 0.05% · user-facing risk if unresolved · error budget degrading', bg: 'bg-amber-50', border: 'border-amber-200', badge: 'At Risk', badgeCls: 'bg-amber-100 text-amber-800', ctaLabel: 'Review →', ctaHref: '/observability/alert-history', ctaCls: 'bg-white hover:bg-slate-50 text-slate-500 border-slate-200' },
    { priority: 3, priorityColor: 'text-slate-500', title: 'Define SLO for API Server — 99.9% uptime', impact: 'latency signal active', impactColor: 'text-slate-500', sub: 'production-api-server · CloudWatch signal · no SLO defined · reliability blind spot', bg: 'bg-slate-50', border: 'border-slate-100', badge: 'Gap Detected', badgeCls: 'bg-slate-100 text-slate-500', ctaLabel: 'Add SLO →', ctaHref: '/monitoring', ctaCls: 'bg-violet-600 hover:bg-violet-700 text-white border-transparent' },
    { priority: 4, priorityColor: 'text-slate-500', title: 'Define SLO for CloudFront CDN — error rate <1%', impact: 'anomaly warning active', impactColor: 'text-slate-500', sub: 'production-cdn · latency warning in anomalies · no SLO defined · user experience risk', bg: 'bg-slate-50', border: 'border-slate-100', badge: 'Gap Detected', badgeCls: 'bg-slate-100 text-slate-500', ctaLabel: 'Add SLO →', ctaHref: '/monitoring', ctaCls: 'bg-violet-600 hover:bg-violet-700 text-white border-transparent' },
  ]

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 max-w-[1320px] mx-auto">

      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-8">
        <div>
          <p className="text-[10px] font-bold text-violet-600 uppercase tracking-widest mb-1.5">Observability</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mb-1.5">SLO Intelligence</h1>
          <p className="text-sm text-slate-500 leading-relaxed">Reliability targets, error budget tracking, and breach risk across all services.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <a href="/monitoring" className="bg-white text-slate-500 border border-slate-200 rounded-lg px-3.5 py-2.5 text-xs font-semibold no-underline hover:bg-slate-50 transition-colors whitespace-nowrap">Monitoring Overview</a>
          <a href="/observability/alert-history" className="flex items-center gap-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg px-4 py-2.5 text-xs font-bold no-underline transition-colors whitespace-nowrap">
            <AlertTriangle size={11} /> Resolve Breached SLOs
          </a>
        </div>
      </div>

      {/* Decision Intelligence */}
      <div className="bg-white rounded-xl border border-slate-100 px-4 sm:px-5 py-4 mb-4 flex items-start gap-3.5">
        <div className="w-7 h-7 rounded-lg bg-violet-600 flex items-center justify-center shrink-0"><Sparkles size={12} className="text-white" /></div>
        <div className="flex-1">
          <p className="text-[10px] font-bold text-violet-600 uppercase tracking-widest mb-1">Decision Intelligence</p>
          <p className="text-sm text-slate-700 leading-relaxed">
            {isDemoActive
              ? <>Primary risk is <strong className="text-red-600">data pipeline instability</strong> — error budget <strong className="text-red-600">280% consumed</strong>. If unresolved, reporting latency and downstream systems will degrade within 24h. Error Rate SLO approaching breach at 120% budget. 4 of 6 SLOs healthy.<span className="block mt-1.5 text-xs text-slate-400">Recommended: investigate ingestion delays in last 24h window · define CDN SLO to track latency automatically.</span></>
              : <>No reliability targets defined — <strong className="text-red-600">system risk is currently unbounded</strong>. Without SLOs, you cannot detect performance degradation before users feel it.<span className="block mt-1.5 text-xs text-slate-400">Define your first SLO to begin measuring reliability against targets.</span></>
            }
          </p>
        </div>
        {isDemoActive && displayStats.breached > 0 && (
          <a href="/observability/alert-history" className="text-[11px] font-bold text-red-600 no-underline shrink-0 flex items-center gap-1 whitespace-nowrap">View alerts <ArrowRight size={10} /></a>
        )}
      </div>

      {/* Reliability Intelligence Strip */}
      {isDemoActive && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 mb-4">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-5 flex-wrap">
              {/* Score ring */}
              <div className="flex items-center gap-3">
                <div className="relative w-12 h-12 shrink-0">
                  <svg width="54" height="54" viewBox="0 0 54 54">
                    <circle cx="27" cy="27" r="23" fill="none" stroke="#F1F5F9" strokeWidth="5"/>
                    <circle cx="27" cy="27" r="23" fill="none" stroke="#D97706" strokeWidth="5" strokeDasharray="144.5" strokeDashoffset="58" strokeLinecap="round" transform="rotate(-90 27 27)"/>
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-slate-900">60</span>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Reliability Score</p>
                  <p className="text-sm font-bold text-slate-900 mb-0.5">At Risk</p>
                  <p className="text-[10px] text-slate-400">6/6 services measured · High confidence</p>
                </div>
              </div>
              <div className="hidden sm:block w-px h-10 bg-slate-200 shrink-0" />
              {/* Score drivers */}
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Driven by</p>
                <div className="flex flex-col gap-0.5">
                  <p className="text-xs text-red-600 font-semibold">● Data pipeline breach (280% error budget)</p>
                  <p className="text-xs text-amber-500 font-medium">● Error rate nearing budget limit (120%)</p>
                  <p className="text-xs text-slate-400 font-medium">● CDN latency anomaly detected</p>
                </div>
              </div>
              <div className="hidden sm:block w-px h-10 bg-slate-200 shrink-0" />
              {/* Business impact */}
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Business Impact</p>
                <p className="text-sm font-semibold text-slate-900 mb-0.5">Reporting latency · downstream degradation</p>
                <p className="text-[10px] font-semibold text-red-600">If unresolved: SLA breach exposure within 24h</p>
              </div>
              <div className="hidden sm:block w-px h-10 bg-slate-200 shrink-0" />
              {/* Services impacted */}
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Services Impacted</p>
                <p className="text-base font-bold text-red-600 mb-0.5">2 of 6</p>
                <p className="text-[10px] text-slate-400">1 breached · 1 at risk</p>
              </div>
            </div>
            <a href="/ai-reports" className="text-[11px] font-bold text-violet-600 no-underline flex items-center gap-1 whitespace-nowrap shrink-0 self-start lg:self-auto">Full report <ArrowRight size={10} /></a>
          </div>
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 mb-4">
        <div className="bg-white rounded-xl p-4 sm:p-5 border border-slate-200">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">SLOs Meeting Target</p>
          {displayStats.total > 0
            ? <div className="text-2xl font-bold text-slate-900 tracking-tight leading-none mb-1.5">{displayStats.met}<span className="text-base text-slate-300 font-normal">/{displayStats.total}</span></div>
            : <div className="text-xs text-slate-300 mb-2">No SLOs defined yet</div>}
          <p className="text-[11px] text-slate-400">Within defined targets</p>
        </div>
        <div className="bg-white rounded-xl p-4 sm:p-5 border border-slate-200">
          <p className="text-[10px] font-bold text-amber-500 uppercase tracking-widest mb-3">At Risk</p>
          {displayStats.total > 0
            ? <div className="text-2xl font-bold text-amber-500 tracking-tight leading-none mb-1.5">{displayStats.atRisk}</div>
            : <div className="text-xs text-slate-300 mb-2">No data — define SLOs</div>}
          <p className="text-[11px] text-slate-400 mb-0.5">Error budget &gt;50% used</p>
          {displayStats.atRisk > 0 && <p className="text-[10px] font-bold text-amber-500">Review now →</p>}
        </div>
        <div className={`rounded-xl p-4 sm:p-5 border ${displayStats.breached > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-slate-200'}`}>
          <p className="text-[10px] font-bold text-red-600 uppercase tracking-widest mb-3">Breached</p>
          {displayStats.total > 0
            ? <div className="text-2xl font-bold text-red-600 tracking-tight leading-none mb-1.5">{displayStats.breached}</div>
            : <div className="text-xs text-slate-300 mb-2">No breaches detected</div>}
          <p className="text-[11px] text-slate-400 mb-0.5">Immediate action required</p>
          {displayStats.breached > 0 && <p className="text-[10px] font-bold text-red-600">Resolve now →</p>}
        </div>
        <div className="bg-white rounded-xl p-4 sm:p-5 border border-slate-200">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Avg Compliance</p>
          {displayStats.total > 0
            ? <div className="text-2xl font-bold text-green-600 tracking-tight leading-none mb-1.5">{displayStats.avgCompliance.toFixed(2)}%</div>
            : <div className="text-xs text-slate-300 mb-2">Calculated after SLO data is collected</div>}
          <p className="text-[11px] text-slate-400">Across all SLOs</p>
        </div>
      </div>

      {/* Recommended Actions */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 mb-4">
        <div className="mb-4">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Recommended Actions</p>
          <p className="text-xs text-slate-500">{isDemoActive ? 'Ranked by urgency · derived from active signals in your infrastructure' : 'Define SLOs to begin measuring reliability against targets'}</p>
        </div>
        {isDemoActive ? (
          <div className="flex flex-col gap-2.5">
            {ACTIONS_DEMO.map(action => (
              <div key={action.priority} className={`flex flex-col sm:flex-row sm:items-center sm:justify-between ${action.bg} rounded-xl border ${action.border} px-4 py-3 gap-3`}>
                <div className="flex items-start gap-3.5">
                  <div className="text-center min-w-[36px] shrink-0">
                    <p className={`text-[9px] font-bold uppercase mb-0.5 ${action.priorityColor}`}>Priority</p>
                    <p className={`text-base font-bold ${action.priorityColor}`}>{action.priority}</p>
                  </div>
                  <div className={`w-px h-8 self-center border-l ${action.border} shrink-0`} />
                  <div>
                    <p className="text-sm font-semibold text-slate-900 mb-0.5">{action.title} — <span className={action.impactColor}>{action.impact}</span></p>
                    <p className="text-[11px] text-slate-400">{action.sub}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 self-start sm:self-center">
                  <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded ${action.badgeCls}`}>{action.badge}</span>
                  <a href={action.ctaHref} className={`border rounded-lg px-3 py-1.5 text-[11px] font-bold cursor-pointer no-underline transition-colors ${action.ctaCls}`}>{action.ctaLabel}</a>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {[
              { label: 'Define an uptime SLO', sub: 'Track availability across your API endpoints', href: '/monitoring' },
              { label: 'Define a latency SLO', sub: 'Measure p95 response time against a target threshold', href: '/monitoring' },
              { label: 'Define an error rate SLO', sub: 'Detect service degradation before users feel it', href: '/monitoring' },
            ].map(item => (
              <div key={item.label} className="flex items-center justify-between bg-slate-50 rounded-xl border border-slate-100 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900 mb-0.5">{item.label}</p>
                  <p className="text-xs text-slate-400">{item.sub}</p>
                </div>
                <a href={item.href} className="bg-violet-600 hover:bg-violet-700 text-white border-none rounded-lg px-3.5 py-1.5 text-[11px] font-bold no-underline transition-colors whitespace-nowrap">Add SLO →</a>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* SLO Cards */}
      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        <div className="px-5 sm:px-7 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-0.5">Service Level Objectives</p>
            <p className="text-xs text-slate-300">{filteredSLOs.length} SLOs · 30-day rolling window</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {categories.map(cat => (
              <button key={cat} onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border-none cursor-pointer transition-colors ${selectedCategory === cat ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                {cat === 'all' ? 'All' : cat}
              </button>
            ))}
          </div>
        </div>

        {filteredSLOs.length === 0 ? (
          <div className="p-10 sm:p-16 text-center">
            <div className="w-12 h-12 rounded-xl bg-slate-50 flex items-center justify-center mx-auto mb-4"><Target size={20} className="text-slate-300" /></div>
            <p className="text-base font-semibold text-slate-900 mb-2">Reliability visibility: 0%</p>
            <p className="text-sm text-slate-400 leading-relaxed mb-7 max-w-sm mx-auto">Without SLOs, system risk is unknown — you cannot detect performance degradation before users feel it or quantify reliability exposure.</p>
            <a href="/monitoring" className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white px-6 py-3 rounded-lg text-sm font-semibold no-underline transition-colors">
              <Activity size={13} /> Set Up SLO Tracking
            </a>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 divide-y sm:divide-y-0 divide-slate-100" style={{ gap: '1px', background: '#F1F5F9' }}>
            {filteredSLOs.map((slo) => {
              const isBreached = slo.status === 'breached', isAtRisk = slo.status === 'at_risk'
              const valueColor = isBreached ? '#DC2626' : isAtRisk ? '#D97706' : '#0F172A'
              const budgetBarColor = slo.errorBudgetUsed > 100 ? '#DC2626' : slo.errorBudgetUsed > 50 ? '#D97706' : '#059669'
              const budgetTextColor = slo.errorBudgetUsed > 100 ? 'text-red-600' : slo.errorBudgetUsed > 50 ? 'text-amber-500' : 'text-slate-500'
              const statusBadgeCls = slo.status === 'met' ? 'bg-slate-100 text-slate-500' : slo.status === 'at_risk' ? 'bg-amber-100 text-amber-800' : 'bg-red-600 text-white'
              const statusLabel = slo.status === 'met' ? 'Met' : slo.status === 'at_risk' ? 'At Risk' : 'Breached'
              return (
                <div key={slo.id} className={`p-5 sm:p-7 ${isBreached ? 'bg-red-50' : 'bg-white'}`}>
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      {!isBreached && <span className={`w-2 h-2 rounded-full shrink-0 mt-0.5 ${isAtRisk ? 'bg-amber-500' : 'bg-green-500'}`} />}
                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">{slo.category}</p>
                        <p className="text-sm font-bold text-slate-900">{slo.name}</p>
                      </div>
                    </div>
                    <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full shrink-0 ml-2 ${statusBadgeCls}`}>{statusLabel}</span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed mb-5">{slo.description}</p>
                  <div className="flex items-baseline gap-2 mb-2">
                    <span className="text-2xl font-bold tracking-tight" style={{ color: valueColor }}>{slo.current.toFixed(2)}%</span>
                    <span className="text-xs text-slate-300">target {slo.target}%</span>
                    <span className={`text-xs font-semibold ml-auto ${slo.trend === 'up' ? 'text-green-600' : slo.trend === 'down' ? 'text-red-600' : 'text-slate-400'}`}>
                      {slo.trend === 'up' ? '↑' : slo.trend === 'down' ? '↓' : '→'}{slo.trendValue !== 0 ? ` ${Math.abs(slo.trendValue)}%` : ' stable'}
                    </span>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full mb-4 overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-300" style={{ width: `${Math.min(slo.current, 100)}%`, background: valueColor }} />
                  </div>
                  <div className={`rounded-lg px-3.5 py-2.5 ${isBreached ? 'bg-red-100' : 'bg-slate-50'}`}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Error Budget</span>
                      <span className={`text-xs font-bold ${budgetTextColor}`}>{slo.errorBudgetUsed}% used</span>
                    </div>
                    <div className="h-1 bg-slate-200 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-300" style={{ width: `${Math.min(slo.errorBudgetUsed, 100)}%`, background: budgetBarColor }} />
                    </div>
                    {(isAtRisk || isBreached) && (
                      <p className={`text-[10px] font-bold mt-1.5 ${isBreached ? 'text-red-800' : 'text-amber-800'}`}>
                        {isBreached ? `Immediate investigation required · ${slo.errorBudgetUsed}% consumed` : `Budget exhausted · trending ${slo.trend === 'down' ? 'worse ↓' : 'stable'}`}
                      </p>
                    )}
                    {slo.status === 'met' && <p className="text-[10px] text-slate-300 mt-1.5">{slo.window} rolling window</p>}
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