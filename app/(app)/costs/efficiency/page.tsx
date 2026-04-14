'use client'

import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ScatterChart, Scatter, ZAxis,
  ReferenceLine, Cell,
} from 'recharts'
import {
  TrendingUp, TrendingDown, Activity, DollarSign,
  Zap, Download, RefreshCw, ArrowRight,
} from 'lucide-react'
import { useDemoMode } from '@/components/demo/demo-mode-toggle'
import { useSalesDemo } from '@/lib/demo/sales-demo-data'
import { usePlan } from '@/lib/hooks/use-plan'
import { infrastructureService } from '@/lib/services/infrastructure.service'
import { costRecommendationsService } from '@/lib/services/cost-recommendations.service'
import { forecastService } from '@/lib/services/forecast.service'
import type { InfrastructureResource } from '@/lib/types'
import Link from 'next/link'

// ── Demo data ────────────────────────────────────────────────────────────────

const DEMO_KPIS = {
  totalSpend:      94280,
  totalSpendDelta: -12.4,
  costPerResource: 48.20,
  costPerDelta:    -8.3,
  idleCost:        11340,
  idleDelta:       +3.2,
  savingsRealized: 18960,
  savingsDelta:    +14.7,
}

const DEMO_BAR_DATA = [
  { month: 'Mar', EC2: 5200, RDS: 2800, S3: 1200, Lambda: 800,  Other: 600  },
  { month: 'Apr', EC2: 6100, RDS: 3100, S3: 1400, Lambda: 900,  Other: 700  },
  { month: 'May', EC2: 5800, RDS: 3400, S3: 1300, Lambda: 900,  Other: 650  },
  { month: 'Jun', EC2: 7200, RDS: 3800, S3: 1600, Lambda: 1100, Other: 800  },
  { month: 'Jul', EC2: 6400, RDS: 3600, S3: 1500, Lambda: 1000, Other: 750  },
  { month: 'Aug', EC2: 7800, RDS: 4100, S3: 1700, Lambda: 1200, Other: 900  },
]

const DEMO_SCATTER_DATA = [
  { x: 18000, y: 82,  name: 'prod-ec2-1',    q: 'strategic' },
  { x: 22000, y: 71,  name: 'rds-primary',   q: 'strategic' },
  { x: 26000, y: 88,  name: 'cdn-cluster',   q: 'strategic' },
  { x: 14000, y: 38,  name: 'dev-ec2',       q: 'at-risk'   },
  { x: 10000, y: 45,  name: 'staging-rds',   q: 'at-risk'   },
  { x: 8000,  y: 28,  name: 's3-archive',    q: 'at-risk'   },
  { x: 24000, y: 55,  name: 'lambda-api',    q: 'low-roi'   },
  { x: 16000, y: 62,  name: 'elb-prod',      q: 'low-roi'   },
  { x: 30000, y: 91,  name: 'k8s-cluster',   q: 'efficient' },
  { x: 28000, y: 84,  name: 'aurora-db',     q: 'efficient' },
  { x: 32000, y: 78,  name: 'cloudfront',    q: 'efficient' },
]

const SERVICE_COLORS: Record<string, string> = {
  EC2:    '#4f8ef7',
  RDS:    '#38c9a0',
  S3:     '#a78bfa',
  Lambda: '#f59e0b',
  Other:  '#64748b',
}

const QUADRANT_COLORS: Record<string, string> = {
  'strategic': '#4f8ef7',
  'efficient': '#38c9a0',
  'at-risk':   '#e05d2e',
  'low-roi':   '#64748b',
}

const QUADRANT_LABELS: Record<string, string> = {
  'strategic': 'Strategic',
  'efficient': 'Efficient',
  'at-risk':   'At Risk',
  'low-roi':   'Low ROI',
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function deriveEfficiencyScore(r: InfrastructureResource): number {
  if (r.status === 'stopped') return 15
  if (r.status === 'pending') return 35
  const cost = r.costPerMonth ?? 0
  if (cost > 1000) return 85
  if (cost > 500)  return 70
  if (cost > 200)  return 55
  if (cost > 50)   return 40
  return 25
}

function deriveQuadrant(cost: number, efficiency: number): string {
  const highCost = cost > 15000
  const highEff  = efficiency > 65
  if (highCost  && highEff)  return 'strategic'
  if (!highCost && highEff)  return 'efficient'
  if (highCost  && !highEff) return 'low-roi'
  return 'at-risk'
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KPICard({
  label, value, delta, prefix = '', suffix = '', accent = false,
}: {
  label: string; value: number | string; delta?: number
  prefix?: string; suffix?: string; accent?: boolean
}) {
  const isPositiveDelta = (delta ?? 0) > 0
  const deltaColor = label === 'Idle Resource Cost'
    ? isPositiveDelta ? '#e05d2e' : '#38c9a0'
    : isPositiveDelta ? '#38c9a0' : '#e05d2e'

  return (
    <div style={{
      background: '#1a1f2e',
      border: accent ? '1px solid #4f8ef755' : '1px solid #2d3748',
      borderRadius: '10px',
      padding: '16px',
      borderLeft: accent ? '3px solid #4f8ef7' : undefined,
    }}>
      <p style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '8px' }}>{label}</p>
      <p style={{ fontSize: '24px', fontWeight: 600, color: '#f1f5f9', lineHeight: 1, marginBottom: '8px' }}>
        {prefix}{typeof value === 'number' ? value.toLocaleString() : value}{suffix}
      </p>
      {delta !== undefined && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          {(delta > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />)}
          <span style={{ fontSize: '11px', fontWeight: 600, color: deltaColor }}>
            {delta > 0 ? '+' : ''}{delta}%
          </span>
          <span style={{ fontSize: '11px', color: '#475569' }}>vs previous</span>
        </div>
      )}
    </div>
  )
}

const CustomScatterTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d) return null
  return (
    <div style={{ background: '#1e2433', border: '1px solid #2d3748', borderRadius: '8px', padding: '10px 14px' }}>
      <p style={{ fontSize: '12px', fontWeight: 600, color: '#f1f5f9', marginBottom: '4px' }}>{d.name}</p>
      <p style={{ fontSize: '11px', color: '#94a3b8' }}>Cost: ${(d.x / 1000).toFixed(1)}K/mo</p>
      <p style={{ fontSize: '11px', color: '#94a3b8' }}>Efficiency: {d.y}%</p>
      <p style={{ fontSize: '11px', fontWeight: 600, marginTop: '4px' }} style2={{ color: QUADRANT_COLORS[d.q] }}>
        {QUADRANT_LABELS[d.q]}
      </p>
    </div>
  )
}

const CustomBarTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  const total = payload.reduce((s: number, p: any) => s + (p.value || 0), 0)
  return (
    <div style={{ background: '#1e2433', border: '1px solid #2d3748', borderRadius: '8px', padding: '10px 14px' }}>
      <p style={{ fontSize: '12px', fontWeight: 600, color: '#f1f5f9', marginBottom: '6px' }}>{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '2px' }}>
          <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '2px', background: p.fill, marginRight: '6px' }} />
          {p.name}: ${p.value.toLocaleString()}
        </p>
      ))}
      <p style={{ fontSize: '11px', fontWeight: 600, color: '#f1f5f9', marginTop: '6px', borderTop: '1px solid #2d3748', paddingTop: '6px' }}>
        Total: ${total.toLocaleString()}
      </p>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function EfficiencyPage() {
  const demoMode    = useDemoMode()
  const { enabled: salesDemo } = useSalesDemo()
  const isDemoActive = demoMode || salesDemo
  const { canAccess } = usePlan('pro')

  const [barGrouping, setBarGrouping] = useState<'service' | 'region' | 'team'>('service')
  const [scatterFilter, setScatterFilter] = useState<'all' | 'at-risk' | 'efficient' | 'strategic' | 'low-roi'>('all')

  const { data: resources = [], isLoading: resLoading } = useQuery({
    queryKey: ['infrastructure-all'],
    queryFn: async () => {
      const all = await infrastructureService.getAll()
      return all.filter(r => (r.resourceType as string) !== 'AWS_COST_TOTAL')
    },
    enabled: !isDemoActive,
  })

  const { data: savingsStats } = useQuery({
    queryKey: ['cost-recommendations-stats'],
    queryFn: costRecommendationsService.getStats,
    enabled: !isDemoActive,
  })

  // ── Derived real data ──
  const realTotalSpend    = resources.reduce((s, r) => s + (r.costPerMonth ?? 0), 0)
  const realIdleCost      = resources.filter(r => r.status !== 'running').reduce((s, r) => s + (r.costPerMonth ?? 0), 0)
  const realCostPerRes    = resources.length > 0 ? realTotalSpend / resources.length : 0
  const realSavings       = savingsStats?.totalPotentialSavings ?? 0

  const kpis = isDemoActive ? DEMO_KPIS : {
    totalSpend:      realTotalSpend,
    totalSpendDelta: 0,
    costPerResource: realCostPerRes,
    costPerDelta:    0,
    idleCost:        realIdleCost,
    idleDelta:       0,
    savingsRealized: realSavings,
    savingsDelta:    0,
  }

  // ── Scatter data from real resources ──
  const scatterData = isDemoActive
    ? DEMO_SCATTER_DATA
    : resources.map(r => {
        const cost = (r.costPerMonth ?? 0) * 30
        const eff  = deriveEfficiencyScore(r)
        return {
          x: Math.round(cost),
          y: eff,
          name: (r as any).serviceName || r.serviceId?.slice(0, 12) || 'Unknown',
          q: deriveQuadrant(cost, eff),
        }
      })

  const filteredScatter = scatterFilter === 'all'
    ? scatterData
    : scatterData.filter(d => d.q === scatterFilter)

  // Group scatter by quadrant for separate Scatter components
  const scatterByQ = ['strategic', 'efficient', 'at-risk', 'low-roi'].map(q => ({
    q,
    data: filteredScatter.filter(d => d.q === q),
  }))

  const barData = DEMO_BAR_DATA // real bar data would need time-series from forecast API

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 max-w-[1400px] mx-auto min-h-screen"
      style={{ background: '#0a0d14', fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* ── HEADER ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-8">
        <div>
          <p style={{ fontSize: '10px', fontWeight: 700, color: '#7C3AED', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '6px' }}>Costs</p>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#f1f5f9', margin: '0 0 6px', letterSpacing: '-0.02em' }}>
            Cloud Efficiency Overview
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#64748b' }}>
            Resource efficiency, spend breakdown, and cost-to-value analysis across your AWS environment.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link href="/cost-optimization" style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            background: '#7C3AED', color: '#fff', padding: '9px 18px',
            borderRadius: '8px', fontSize: '13px', fontWeight: 600,
            textDecoration: 'none',
          }}>
            <Zap size={14} /> Apply Optimizations
          </Link>
          <button style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            background: '#1a1f2e', border: '1px solid #2d3748', color: '#94a3b8',
            padding: '9px 14px', borderRadius: '8px', fontSize: '13px', cursor: 'pointer',
          }}>
            <Download size={14} /> Export
          </button>
        </div>
      </div>

      {/* ── KPI CARDS ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPICard label="Total Spend"        value={kpis.totalSpend}      delta={kpis.totalSpendDelta} prefix="$" accent />
        <KPICard label="Cost Per Resource"  value={kpis.costPerResource.toFixed(2)} delta={kpis.costPerDelta} prefix="$" />
        <KPICard label="Idle Resource Cost" value={kpis.idleCost}        delta={kpis.idleDelta}       prefix="$" />
        <KPICard label="Savings Realized"   value={kpis.savingsRealized} delta={kpis.savingsDelta}    prefix="$" />
      </div>

      {/* ── CHARTS ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Stacked Bar */}
        <div style={{ background: '#1a1f2e', border: '1px solid #2d3748', borderRadius: '12px', padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <div>
              <p style={{ fontSize: '13px', fontWeight: 600, color: '#f1f5f9', margin: 0 }}>Spend breakdown</p>
              <p style={{ fontSize: '11px', color: '#64748b', margin: '2px 0 0' }}>Monthly cost by service · Last 6 months</p>
            </div>
            <select
              value={barGrouping}
              onChange={e => setBarGrouping(e.target.value as any)}
              style={{ background: '#0f1117', border: '1px solid #2d3748', color: '#94a3b8', fontSize: '11px', padding: '5px 9px', borderRadius: '6px', cursor: 'pointer' }}
            >
              <option value="service">By Service</option>
              <option value="region">By Region</option>
              <option value="team">By Team</option>
            </select>
          </div>

          {/* Legend */}
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '12px' }}>
            {Object.entries(SERVICE_COLORS).map(([name, color]) => (
              <span key={name} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: '#94a3b8' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: color, display: 'inline-block' }} />
                {name}
              </span>
            ))}
          </div>

          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={barData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2433" />
              <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={{ stroke: '#2d3748' }} tickLine={false} />
              <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => '$' + (v/1000).toFixed(0) + 'K'} />
              <Tooltip content={<CustomBarTooltip />} />
              {Object.entries(SERVICE_COLORS).map(([name, color]) => (
                <Bar key={name} dataKey={name} stackId="a" fill={color} radius={name === 'Other' ? [3, 3, 0, 0] : [0, 0, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Scatter Plot */}
        <div style={{ background: '#1a1f2e', border: '1px solid #2d3748', borderRadius: '12px', padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <div>
              <p style={{ fontSize: '13px', fontWeight: 600, color: '#f1f5f9', margin: 0 }}>Resource efficiency vs cost</p>
              <p style={{ fontSize: '11px', color: '#64748b', margin: '2px 0 0' }}>Quadrant analysis · {isDemoActive ? '11' : scatterData.length} resources</p>
            </div>
            <select
              value={scatterFilter}
              onChange={e => setScatterFilter(e.target.value as any)}
              style={{ background: '#0f1117', border: '1px solid #2d3748', color: '#94a3b8', fontSize: '11px', padding: '5px 9px', borderRadius: '6px', cursor: 'pointer' }}
            >
              <option value="all">All resources</option>
              <option value="at-risk">At Risk only</option>
              <option value="efficient">Efficient only</option>
              <option value="strategic">Strategic only</option>
              <option value="low-roi">Low ROI only</option>
            </select>
          </div>

          {/* Legend */}
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '12px' }}>
            {Object.entries(QUADRANT_LABELS).map(([q, label]) => (
              <span key={q} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: '#94a3b8' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: QUADRANT_COLORS[q], display: 'inline-block' }} />
                {label}
              </span>
            ))}
          </div>

          <ResponsiveContainer width="100%" height={240}>
            <ScatterChart margin={{ top: 4, right: 4, left: 0, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2433" />
              <XAxis
                type="number" dataKey="x" name="cost"
                domain={[0, 40000]}
                tick={{ fill: '#64748b', fontSize: 10 }}
                axisLine={{ stroke: '#2d3748' }} tickLine={false}
                tickFormatter={v => '$' + (v/1000).toFixed(0) + 'K'}
                label={{ value: 'Monthly cost', position: 'insideBottom', offset: -12, fill: '#475569', fontSize: 11 }}
              />
              <YAxis
                type="number" dataKey="y" name="efficiency"
                domain={[0, 100]}
                tick={{ fill: '#64748b', fontSize: 10 }}
                axisLine={false} tickLine={false}
                tickFormatter={v => v + '%'}
                label={{ value: 'Efficiency', angle: -90, position: 'insideLeft', fill: '#475569', fontSize: 11 }}
              />
              <ZAxis range={[60, 60]} />
              <Tooltip cursor={{ strokeDasharray: '3 3', stroke: '#2d3748' }} content={<CustomScatterTooltip />} />
              {/* Quadrant dividers */}
              <ReferenceLine x={20000} stroke="#2d3748" strokeDasharray="4 4" />
              <ReferenceLine y={65}    stroke="#2d3748" strokeDasharray="4 4" />
              {scatterByQ.map(({ q, data }) => (
                <Scatter
                  key={q}
                  name={QUADRANT_LABELS[q]}
                  data={data}
                  fill={QUADRANT_COLORS[q]}
                  fillOpacity={0.85}
                />
              ))}
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── QUADRANT SUMMARY ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-5">
        {[
          { q: 'at-risk',   icon: '⚠', title: 'At Risk',   sub: 'High cost, low efficiency — act now',       cta: '/cost-optimization', ctaLabel: 'Fix now →'    },
          { q: 'low-roi',   icon: '↓',  title: 'Low ROI',   sub: 'Spending high, returns not justified',      cta: '/cost-optimization', ctaLabel: 'Review →'    },
          { q: 'strategic', icon: '★',  title: 'Strategic', sub: 'High value, high cost — justified spend',   cta: '/infrastructure',    ctaLabel: 'Monitor →'   },
          { q: 'efficient', icon: '✓',  title: 'Efficient', sub: 'Low cost, high efficiency — keep going',    cta: '/infrastructure',    ctaLabel: 'View →'      },
        ].map(({ q, icon, title, sub, cta, ctaLabel }) => {
          const count = scatterData.filter(d => d.q === q).length
          const color = QUADRANT_COLORS[q]
          return (
            <div key={q} style={{ background: '#1a1f2e', border: `1px solid ${color}33`, borderLeft: `3px solid ${color}`, borderRadius: '10px', padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                <span style={{ fontSize: '14px', color }}>{icon}</span>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#f1f5f9' }}>{title}</span>
                <span style={{ marginLeft: 'auto', fontSize: '11px', fontWeight: 700, color, background: color + '22', padding: '1px 7px', borderRadius: '100px' }}>{count}</span>
              </div>
              <p style={{ fontSize: '11px', color: '#64748b', marginBottom: '10px', lineHeight: 1.5 }}>{sub}</p>
              <Link href={cta} style={{ fontSize: '11px', fontWeight: 600, color, textDecoration: 'none' }}>{ctaLabel}</Link>
            </div>
          )
        })}
      </div>

      {/* ── PRO GATE for non-pro users ── */}
      {!canAccess && !isDemoActive && (
        <div style={{ background: '#1a1f2e', border: '1px solid #2d3748', borderRadius: '12px', padding: '32px', textAlign: 'center', marginTop: '24px' }}>
          <p style={{ fontSize: '1rem', fontWeight: 600, color: '#f1f5f9', marginBottom: '8px' }}>Full Efficiency Analysis — Pro Plan</p>
          <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '16px' }}>Upgrade to unlock detailed resource efficiency scoring, quadrant drill-down, and export.</p>
          <Link href="/settings/billing/upgrade" style={{ background: '#7C3AED', color: '#fff', padding: '10px 24px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, textDecoration: 'none' }}>
            Upgrade to Pro
          </Link>
        </div>
      )}

    </div>
  )
}