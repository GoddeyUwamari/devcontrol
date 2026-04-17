'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ScatterChart, Scatter, ZAxis,
  ReferenceLine,
} from 'recharts'
import {
  TrendingUp, TrendingDown, Zap, Download, ArrowRight,
  AlertTriangle, Activity,
} from 'lucide-react'
import { useDemoMode } from '@/components/demo/demo-mode-toggle'
import { useSalesDemo } from '@/lib/demo/sales-demo-data'
import { usePlan } from '@/lib/hooks/use-plan'
import { infrastructureService } from '@/lib/services/infrastructure.service'
import { costRecommendationsService } from '@/lib/services/cost-recommendations.service'
import type { InfrastructureResource } from '@/lib/types'
import Link from 'next/link'

// ── Demo data ─────────────────────────────────────────────────────────────────

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

const DEMO_WASTEFUL_RESOURCES = [
  { name: 'analytics-warehouse',      type: 'RDS',    region: 'us-west-2', cost: 2341.60, efficiency: 22, issue: 'Oversized · avg 8% CPU',        savings: 937  },
  { name: 'production-postgres-primary', type: 'RDS', region: 'us-east-1', cost: 1876.30, efficiency: 31, issue: 'Reserved Instance available',    savings: 751  },
  { name: 'production-kubernetes',    type: 'EKS',    region: 'us-east-1', cost: 1456.20, efficiency: 28, issue: 'Over-provisioned node group',    savings: 582  },
  { name: 'payment-processor',        type: 'EC2',    region: 'us-east-1', cost: 1243.20, efficiency: 35, issue: 'Idle 60% of the time',           savings: 497  },
  { name: 'production-postgres-replica', type: 'RDS', region: 'us-east-1', cost: 938.15,  efficiency: 41, issue: 'Replica rarely read from',       savings: 375  },
]

const DEMO_ANOMALIES = [
  { service: 'payment-processor', type: 'EC2',    delta: +178, severity: 'critical', date: 'Apr 13', detail: 'Lambda invocation spike' },
  { service: 'analytics-worker',  type: 'EC2',    delta: +94,  severity: 'high',     date: 'Apr 12', detail: 'CPU overload detected'   },
  { service: 'rds-prod-primary',  type: 'RDS',    delta: +67,  severity: 'high',     date: 'Apr 11', detail: 'Unusual query volume'     },
  { service: 's3-data-lake',      type: 'S3',     delta: +43,  severity: 'medium',   date: 'Apr 10', detail: 'Storage growth spike'     },
]

const DEMO_SERVICE_EFFICIENCY = [
  { name: 'k8s-cluster',      score: 91, cost: 30000, type: 'EKS'    },
  { name: 'cdn-cluster',      score: 88, cost: 26000, type: 'CF'     },
  { name: 'prod-ec2-1',       score: 82, cost: 18000, type: 'EC2'    },
  { name: 'aurora-db',        score: 84, cost: 28000, type: 'RDS'    },
  { name: 'cloudfront',       score: 78, cost: 32000, type: 'CDN'    },
  { name: 'rds-primary',      score: 71, cost: 22000, type: 'RDS'    },
  { name: 'elb-prod',         score: 62, cost: 16000, type: 'ELB'    },
  { name: 'lambda-api',       score: 55, cost: 24000, type: 'Lambda' },
  { name: 'staging-rds',      score: 45, cost: 10000, type: 'RDS'    },
  { name: 'dev-ec2',          score: 38, cost: 14000, type: 'EC2'    },
  { name: 's3-archive',       score: 28, cost: 8000,  type: 'S3'     },
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

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#ef4444',
  high:     '#f59e0b',
  medium:   '#7c3aed',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function efficiencyColor(score: number): string {
  if (score >= 75) return '#16a34a'
  if (score >= 50) return '#f59e0b'
  return '#ef4444'
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function KPICard({
  label, value, delta, prefix = '', suffix = '', accent = false,
}: {
  label: string; value: number | string; delta?: number
  prefix?: string; suffix?: string; accent?: boolean
}) {
  const isPositiveDelta = (delta ?? 0) > 0
  const deltaColor = label === 'Idle Resource Cost'
    ? isPositiveDelta ? '#ef4444' : '#16a34a'
    : isPositiveDelta ? '#16a34a' : '#ef4444'

  return (
    <div style={{ background: '#fff', border: accent ? '1.5px solid #e5e7eb' : '1.5px solid #e5e7eb', borderRadius: '10px', padding: '16px', borderLeft: accent ? '3px solid #7c3aed' : undefined }}>
      <p style={{ fontSize: '10px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '8px' }}>{label}</p>
      <p style={{ fontSize: '24px', fontWeight: 600, color: '#0f172a', lineHeight: 1, marginBottom: '8px' }}>
        {prefix}{typeof value === 'number' ? value.toLocaleString() : value}{suffix}
      </p>
      {delta !== undefined && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          {delta > 0 ? <TrendingUp size={12} style={{ color: deltaColor }} /> : <TrendingDown size={12} style={{ color: deltaColor }} />}
          <span style={{ fontSize: '11px', fontWeight: 600, color: deltaColor }}>{delta > 0 ? '+' : ''}{delta}%</span>
          <span style={{ fontSize: '11px', color: '#6b7280' }}>vs previous</span>
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
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '10px 14px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
      <p style={{ fontSize: '12px', fontWeight: 600, color: '#0f172a', marginBottom: '4px' }}>{d.name}</p>
      <p style={{ fontSize: '11px', color: '#374151' }}>Cost: ${(d.x / 1000).toFixed(1)}K/mo</p>
      <p style={{ fontSize: '11px', color: '#374151' }}>Efficiency: {d.y}%</p>
      <p style={{ fontSize: '11px', fontWeight: 600, color: QUADRANT_COLORS[d.q], marginTop: '4px' }}>{QUADRANT_LABELS[d.q]}</p>
    </div>
  )
}

const CustomBarTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  const total = payload.reduce((s: number, p: any) => s + (p.value || 0), 0)
  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '10px 14px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
      <p style={{ fontSize: '12px', fontWeight: 600, color: '#0f172a', marginBottom: '6px' }}>{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ fontSize: '11px', color: '#374151', marginBottom: '2px' }}>
          <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '2px', background: p.fill, marginRight: '6px' }} />
          {p.name}: ${p.value.toLocaleString()}
        </p>
      ))}
      <p style={{ fontSize: '11px', fontWeight: 600, color: '#0f172a', marginTop: '6px', borderTop: '1px solid #e5e7eb', paddingTop: '6px' }}>
        Total: ${total.toLocaleString()}
      </p>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function EfficiencyPage() {
  const demoMode         = useDemoMode()
  const { enabled: salesDemo } = useSalesDemo()
  const isDemoActive     = demoMode || salesDemo
  const { canAccess }    = usePlan('pro')

  const [barGrouping,    setBarGrouping]    = useState<'service' | 'region' | 'team'>('service')
  const [scatterFilter,  setScatterFilter]  = useState<'all' | 'at-risk' | 'efficient' | 'strategic' | 'low-roi'>('all')

  const { data: resources = [] } = useQuery({
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
  const realTotalSpend = resources.reduce((s, r) => s + (r.costPerMonth ?? 0), 0)
  const realIdleCost   = resources.filter(r => r.status !== 'running').reduce((s, r) => s + (r.costPerMonth ?? 0), 0)
  const realCostPerRes = resources.length > 0 ? realTotalSpend / resources.length : 0
  const realSavings    = savingsStats?.totalPotentialSavings ?? 0

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

  // ── Scatter data ──
  const scatterData = isDemoActive
    ? DEMO_SCATTER_DATA
    : resources.map(r => {
        const cost = (r.costPerMonth ?? 0) * 30
        const eff  = deriveEfficiencyScore(r)
        return {
          x:    Math.round(cost),
          y:    eff,
          name: (r as any).serviceName || r.serviceId?.slice(0, 12) || 'Unknown',
          q:    deriveQuadrant(cost, eff),
        }
      })

  const filteredScatter = scatterFilter === 'all' ? scatterData : scatterData.filter(d => d.q === scatterFilter)
  const scatterByQ = ['strategic', 'efficient', 'at-risk', 'low-roi'].map(q => ({
    q, data: filteredScatter.filter(d => d.q === q),
  }))

  // ── Wasteful resources ──
  const wastefulResources = isDemoActive
    ? DEMO_WASTEFUL_RESOURCES
    : resources
        .filter(r => deriveEfficiencyScore(r) < 50)
        .sort((a, b) => (b.costPerMonth ?? 0) - (a.costPerMonth ?? 0))
        .slice(0, 5)
        .map(r => ({
          name:       (r as any).serviceName || r.serviceId?.slice(0, 16) || 'Unknown',
          type:       (r.resourceType as string)?.toUpperCase() ?? '—',
          region:     r.awsRegion || '—',
          cost:       r.costPerMonth ?? 0,
          efficiency: deriveEfficiencyScore(r),
          issue:      r.status !== 'running' ? 'Resource not running' : 'Low efficiency score',
          savings:    Math.round((r.costPerMonth ?? 0) * 0.4),
        }))

  // ── Service efficiency ──
  const serviceEfficiency = isDemoActive
    ? DEMO_SERVICE_EFFICIENCY
    : (() => {
        const map: Record<string, { cost: number; scores: number[] }> = {}
        resources.forEach(r => {
          const key = (r as any).serviceName || r.resourceType || 'Unknown'
          if (!map[key]) map[key] = { cost: 0, scores: [] }
          map[key].cost += r.costPerMonth ?? 0
          map[key].scores.push(deriveEfficiencyScore(r))
        })
        return Object.entries(map)
          .map(([name, { cost, scores }]) => ({
            name,
            score: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
            cost:  Math.round(cost * 30),
            type:  '',
          }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 11)
      })()

  const barData = DEMO_BAR_DATA

  const handleExport = () => {
    const rows = [
      ['Month', 'EC2', 'RDS', 'S3', 'Lambda', 'Other', 'Total'],
      ...barData.map(d => [
        d.month, d.EC2, d.RDS, d.S3, d.Lambda, d.Other,
        d.EC2 + d.RDS + d.S3 + d.Lambda + d.Other,
      ]),
    ]
    const csv = rows.map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `cloud-efficiency-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div
      className="px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 max-w-[1400px] mx-auto min-h-screen"
      style={{ background: '#fff' }}
    >

      {/* ── HEADER ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-8">
        <div>
          <p style={{ fontSize: '10px', fontWeight: 700, color: '#7C3AED', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '6px' }}>Costs</p>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#0f172a', margin: '0 0 6px', letterSpacing: '-0.02em' }}>Cloud Efficiency Overview</h1>
          <p style={{ fontSize: '0.875rem', color: '#6b7280' }}>Resource efficiency, spend breakdown, and cost-to-value analysis across your AWS environment.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link href="/cost-optimization" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#7C3AED', color: '#fff', padding: '9px 18px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, textDecoration: 'none' }}>
            <Zap size={14} /> Apply Optimizations
          </Link>
          <button onClick={handleExport} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#f9fafb', border: '1px solid #e5e7eb', color: '#374151', padding: '9px 14px', borderRadius: '8px', fontSize: '13px', cursor: 'pointer' }}>
            <Download size={14} /> Export
          </button>
        </div>
      </div>

      {/* ── KPI CARDS ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPICard label="Total Spend"        value={kpis.totalSpend}                   delta={kpis.totalSpendDelta} prefix="$" accent />
        <KPICard label="Cost Per Resource"  value={kpis.costPerResource.toFixed(2)}   delta={kpis.costPerDelta}    prefix="$" />
        <KPICard label="Idle Resource Cost" value={kpis.idleCost}                     delta={kpis.idleDelta}       prefix="$" />
        <KPICard label="Savings Realized"   value={kpis.savingsRealized}              delta={kpis.savingsDelta}    prefix="$" />
      </div>

      {/* ── CHARTS ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">

        {/* Stacked Bar */}
        <div style={{ background: '#fff', border: '1.5px solid #e5e7eb', borderRadius: '12px', padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <div>
              <p style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a', margin: 0 }}>Spend breakdown</p>
              <p style={{ fontSize: '11px', color: '#6b7280', margin: '2px 0 0' }}>Monthly cost by service · Last 6 months</p>
            </div>
            <select value={barGrouping} onChange={e => setBarGrouping(e.target.value as any)} style={{ background: '#f9fafb', border: '1px solid #e5e7eb', color: '#374151', fontSize: '11px', padding: '5px 9px', borderRadius: '6px', cursor: 'pointer' }}>
              <option value="service">By Service</option>
              <option value="region">By Region</option>
              <option value="team">By Team</option>
            </select>
          </div>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '12px' }}>
            {Object.entries(SERVICE_COLORS).map(([name, color]) => (
              <span key={name} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: '#374151' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: color, display: 'inline-block' }} />{name}
              </span>
            ))}
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={barData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="month" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={{ stroke: '#e5e7eb' }} tickLine={false} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => '$' + (v/1000).toFixed(0) + 'K'} />
              <Tooltip content={<CustomBarTooltip />} />
              {Object.entries(SERVICE_COLORS).map(([name, color]) => (
                <Bar key={name} dataKey={name} stackId="a" fill={color} radius={name === 'Other' ? [3, 3, 0, 0] : [0, 0, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Scatter Plot */}
        <div style={{ background: '#fff', border: '1.5px solid #e5e7eb', borderRadius: '12px', padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <div>
              <p style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a', margin: 0 }}>Resource efficiency vs cost</p>
              <p style={{ fontSize: '11px', color: '#6b7280', margin: '2px 0 0' }}>Quadrant analysis · {isDemoActive ? '11' : scatterData.length} resources</p>
            </div>
            <select value={scatterFilter} onChange={e => setScatterFilter(e.target.value as any)} style={{ background: '#f9fafb', border: '1px solid #e5e7eb', color: '#374151', fontSize: '11px', padding: '5px 9px', borderRadius: '6px', cursor: 'pointer' }}>
              <option value="all">All resources</option>
              <option value="at-risk">At Risk only</option>
              <option value="efficient">Efficient only</option>
              <option value="strategic">Strategic only</option>
              <option value="low-roi">Low ROI only</option>
            </select>
          </div>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '12px' }}>
            {Object.entries(QUADRANT_LABELS).map(([q, label]) => (
              <span key={q} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: '#374151' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: QUADRANT_COLORS[q], display: 'inline-block' }} />{label}
              </span>
            ))}
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <ScatterChart margin={{ top: 4, right: 4, left: 0, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis type="number" dataKey="x" name="cost" domain={[0, 40000]} tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={{ stroke: '#e5e7eb' }} tickLine={false} tickFormatter={v => '$' + (v/1000).toFixed(0) + 'K'} label={{ value: 'Monthly cost', position: 'insideBottom', offset: -12, fill: '#6b7280', fontSize: 11 }} />
              <YAxis type="number" dataKey="y" name="efficiency" domain={[0, 100]} tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => v + '%'} label={{ value: 'Efficiency', angle: -90, position: 'insideLeft', fill: '#6b7280', fontSize: 11 }} />
              <ZAxis range={[60, 60]} />
              <Tooltip cursor={{ strokeDasharray: '3 3', stroke: '#e5e7eb' }} content={<CustomScatterTooltip />} />
              <ReferenceLine x={20000} stroke="#e5e7eb" strokeDasharray="4 4" />
              <ReferenceLine y={65}    stroke="#e5e7eb" strokeDasharray="4 4" />
              {scatterByQ.map(({ q, data }) => (
                <Scatter key={q} name={QUADRANT_LABELS[q]} data={data} fill={QUADRANT_COLORS[q]} fillOpacity={0.85} />
              ))}
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── QUADRANT SUMMARY ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { q: 'at-risk',   icon: '⚠', title: 'At Risk',   sub: 'High cost, low efficiency — act now',     cta: '/cost-optimization', ctaLabel: 'Fix now →'  },
          { q: 'low-roi',   icon: '↓',  title: 'Low ROI',   sub: 'Spending high, returns not justified',    cta: '/cost-optimization', ctaLabel: 'Review →'   },
          { q: 'strategic', icon: '★',  title: 'Strategic', sub: 'High value, high cost — justified spend', cta: '/infrastructure',    ctaLabel: 'Monitor →'  },
          { q: 'efficient', icon: '✓',  title: 'Efficient', sub: 'Low cost, high efficiency — keep going',  cta: '/infrastructure',    ctaLabel: 'View →'     },
        ].map(({ q, icon, title, sub, cta, ctaLabel }) => {
          const count = scatterData.filter(d => d.q === q).length
          const color = QUADRANT_COLORS[q]
          return (
            <div key={q} style={{ background: '#fff', border: `1.5px solid ${color}33`, borderLeft: `3px solid ${color}`, borderRadius: '10px', padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                <span style={{ fontSize: '14px', color }}>{icon}</span>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>{title}</span>
                <span style={{ marginLeft: 'auto', fontSize: '11px', fontWeight: 700, color, background: color + '22', padding: '1px 7px', borderRadius: '100px' }}>{count}</span>
              </div>
              <p style={{ fontSize: '11px', color: '#6b7280', marginBottom: '10px', lineHeight: 1.5 }}>{sub}</p>
              <Link href={cta} style={{ fontSize: '11px', fontWeight: 600, color, textDecoration: 'none' }}>{ctaLabel}</Link>
            </div>
          )
        })}
      </div>

      {/* ── NEW SECTION 1: TOP WASTEFUL RESOURCES ── */}
      <div style={{ background: '#fff', border: '1.5px solid #e5e7eb', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div>
            <p style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a', margin: 0 }}>Top wasteful resources</p>
            <p style={{ fontSize: '11px', color: '#6b7280', margin: '2px 0 0' }}>Ranked by recoverable savings · Immediate action recommended</p>
          </div>
          <Link href="/cost-optimization" style={{ fontSize: '11px', fontWeight: 600, color: '#7C3AED', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}>
            Fix all → 
          </Link>
        </div>

        {/* Desktop table */}
        <div className="hidden sm:block overflow-x-auto">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                {['Resource', 'Type', 'Region', 'Monthly Cost', 'Efficiency', 'Issue', 'Potential Savings', ''].map(h => (
                  <th key={h} style={{ fontSize: '10px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.07em', padding: '8px 12px', textAlign: h === 'Monthly Cost' || h === 'Potential Savings' ? 'right' : 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {wastefulResources.map((r, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '12px', fontSize: '13px', fontWeight: 500, color: '#0f172a' }}>{r.name}</td>
                  <td style={{ padding: '12px' }}>
                    <span style={{ fontSize: '10px', fontWeight: 700, color: '#7c3aed', background: '#7c3aed22', padding: '2px 7px', borderRadius: '4px' }}>{r.type}</span>
                  </td>
                  <td style={{ padding: '12px', fontSize: '12px', color: '#6b7280', fontFamily: 'monospace' }}>{r.region}</td>
                  <td style={{ padding: '12px', fontSize: '13px', fontWeight: 600, color: '#0f172a', textAlign: 'right' }}>${r.cost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td style={{ padding: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ flex: 1, height: '4px', background: '#f3f4f6', borderRadius: '2px', minWidth: '60px' }}>
                        <div style={{ width: `${r.efficiency}%`, height: '100%', borderRadius: '2px', background: efficiencyColor(r.efficiency) }} />
                      </div>
                      <span style={{ fontSize: '11px', color: efficiencyColor(r.efficiency), fontWeight: 600, minWidth: '28px' }}>{r.efficiency}%</span>
                    </div>
                  </td>
                  <td style={{ padding: '12px', fontSize: '12px', color: '#f59e0b' }}>{r.issue}</td>
                  <td style={{ padding: '12px', fontSize: '13px', fontWeight: 700, color: '#16a34a', textAlign: 'right' }}>-${r.savings.toLocaleString()}/mo</td>
                  <td style={{ padding: '12px' }}>
                    <Link href="/cost-optimization" style={{ fontSize: '11px', fontWeight: 600, color: '#7C3AED', textDecoration: 'none', background: '#7C3AED22', padding: '4px 10px', borderRadius: '6px' }}>Fix →</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="sm:hidden flex flex-col gap-3">
          {wastefulResources.map((r, i) => (
            <div key={i} style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>{r.name}</span>
                <span style={{ fontSize: '10px', fontWeight: 700, color: '#7c3aed', background: '#7c3aed22', padding: '2px 7px', borderRadius: '4px' }}>{r.type}</span>
              </div>
              <p style={{ fontSize: '11px', color: '#f59e0b', marginBottom: '8px' }}>{r.issue}</p>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '12px', color: '#374151' }}>${r.cost.toFixed(0)}/mo</span>
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#16a34a' }}>Save ${r.savings}/mo</span>
                <Link href="/cost-optimization" style={{ fontSize: '11px', fontWeight: 600, color: '#7C3AED', textDecoration: 'none' }}>Fix →</Link>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── NEW SECTION 2: COST ANOMALIES ── */}
      <div style={{ background: '#fff', border: '1.5px solid #e5e7eb', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div>
            <p style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a', margin: 0 }}>Recent cost anomalies</p>
            <p style={{ fontSize: '11px', color: '#6b7280', margin: '2px 0 0' }}>Unusual cost spikes detected in the last 7 days</p>
          </div>
          <Link href="/anomalies" style={{ fontSize: '11px', fontWeight: 600, color: '#7C3AED', textDecoration: 'none' }}>
            View all →
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {DEMO_ANOMALIES.map((a, i) => {
            const color = SEVERITY_COLORS[a.severity]
            return (
              <div key={i} style={{ background: '#f9fafb', border: `1px solid ${color}33`, borderLeft: `3px solid ${color}`, borderRadius: '8px', padding: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '10px', fontWeight: 700, color, background: color + '22', padding: '2px 7px', borderRadius: '4px', textTransform: 'uppercase' }}>{a.severity}</span>
                  <span style={{ fontSize: '10px', color: '#9ca3af' }}>{a.date}</span>
                </div>
                <p style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a', marginBottom: '4px' }}>{a.service}</p>
                <p style={{ fontSize: '11px', color: '#6b7280', marginBottom: '8px' }}>{a.detail}</p>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '10px', fontWeight: 700, color, background: color + '22', padding: '2px 7px', borderRadius: '4px' }}>{a.type}</span>
                  <span style={{ fontSize: '13px', fontWeight: 700, color }}>+{a.delta}%</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── NEW SECTION 3: EFFICIENCY SCORE BY SERVICE ── */}
      <div style={{ background: '#fff', border: '1.5px solid #e5e7eb', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div>
            <p style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a', margin: 0 }}>Efficiency score by service</p>
            <p style={{ fontSize: '11px', color: '#6b7280', margin: '2px 0 0' }}>How well each service is utilizing its allocated resources</p>
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
            {[['#16a34a', '75%+'], ['#f59e0b', '50–74%'], ['#ef4444', '<50%']].map(([color, label]) => (
              <span key={label} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: '#374151' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: color as string, display: 'inline-block' }} />{label}
              </span>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {serviceEfficiency.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: '12px', color: '#374151', width: '170px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>{s.name}</span>
              <div style={{ flex: 1, height: '6px', background: '#f3f4f6', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{ width: `${s.score}%`, height: '100%', borderRadius: '3px', background: efficiencyColor(s.score), transition: 'width 0.4s ease' }} />
              </div>
              <span style={{ fontSize: '12px', fontWeight: 700, color: efficiencyColor(s.score), width: '36px', textAlign: 'right', flexShrink: 0 }}>{s.score}%</span>
              <span style={{ fontSize: '11px', color: '#6b7280', width: '70px', textAlign: 'right', flexShrink: 0 }}>${(s.cost / 1000).toFixed(1)}K/mo</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── PRO GATE ── */}
      {!canAccess && !isDemoActive && (
        <div style={{ background: '#f9fafb', border: '1.5px solid #e5e7eb', borderRadius: '12px', padding: '32px', textAlign: 'center', marginTop: '8px' }}>
          <p style={{ fontSize: '1rem', fontWeight: 600, color: '#0f172a', marginBottom: '8px' }}>Full Efficiency Analysis — Pro Plan</p>
          <p style={{ fontSize: '13px', color: '#6b7280', marginBottom: '16px' }}>Upgrade to unlock detailed resource efficiency scoring, quadrant drill-down, and export.</p>
          <Link href="/settings/billing/upgrade" style={{ background: '#7C3AED', color: '#fff', padding: '10px 24px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, textDecoration: 'none' }}>
            Upgrade to Pro
          </Link>
        </div>
      )}

    </div>
  )
}