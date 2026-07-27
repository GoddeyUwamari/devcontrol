'use client'

import { useState, useRef, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, ReferenceLine,
} from 'recharts'
import {
  Search, Download, TrendingUp, TrendingDown, Minus,
  Sparkles, ArrowRight, Loader2, X, ChevronRight,
  Zap, Lock,
} from 'lucide-react'
import { usePlan } from '@/lib/hooks/use-plan'
import { platformStatsService } from '@/lib/services/platform-stats.service'
import { costRecommendationsService } from '@/lib/services/cost-recommendations.service'
import { nlQueryService, NLQueryResult } from '@/lib/services/nl-query.service'
import { useDemoMode } from '@/components/demo/demo-mode-toggle'
import { useSalesDemo } from '@/lib/demo/sales-demo-data'
import Link from 'next/link'
import type { PlatformDashboardStats, CostRecommendation, RecommendationSeverity } from '@/lib/types'
import { annualizeMonthly } from '@/lib/utils'

const SERVICE_COLORS: Record<string, string> = {
  'Compute (EC2, Lambda, ECS)': '#3B82F6',
  'Storage (S3, EBS)':          '#06B6D4',
  'Database (RDS, DynamoDB)':   '#8B5CF6',
  'Network (Data Transfer)':    '#F59E0B',
  'Other Services':             '#94A3B8',
}

const DATE_RANGES: { label: string; days: number; range: '7d' | '30d' | '90d' | '6mo' | '1yr' }[] = [
  { label: '7D',  days: 7,   range: '7d'  },
  { label: '30D', days: 30,  range: '30d' },
  { label: '3M',  days: 90,  range: '90d' },
  { label: '6M',  days: 180, range: '6mo' },
  { label: '1Y',  days: 365, range: '1yr' },
]

const severityStyles: Record<RecommendationSeverity, string> = {
  HIGH: 'bg-red-50 text-red-700 border-red-200',
  MEDIUM: 'bg-amber-50 text-amber-700 border-amber-200',
  LOW: 'bg-slate-100 text-slate-600 border-slate-200',
}

// Demo-only illustrative figures — not sourced from any backend service.
// Kept internally consistent with each other (annual = monthly*12, count = list length)
// rather than reusing the old forecast/optimization services' own demo generators,
// since both of those are being removed as part of this migration.
const DEMO_TOP_SAVINGS: { title: string; savings: number; severity: RecommendationSeverity }[] = [
  { title: 'RDS Reserved Instance Pricing', savings: 890, severity: 'HIGH' as RecommendationSeverity },
  { title: 'Idle RDS Instances',            savings: 445, severity: 'MEDIUM' as RecommendationSeverity },
  { title: 'Underloaded EC2 Instances',     savings: 362, severity: 'MEDIUM' as RecommendationSeverity },
]
const DEMO_TOTAL_SAVINGS = DEMO_TOP_SAVINGS.reduce((sum, r) => sum + r.savings, 0)
const DEMO_MTD_SPEND = 22050
const DEMO_GROWTH_RATE = 8.2

const DEMO_SPEND_DATA: { date: string; actual?: number; forecast?: number }[] = [
  { date: 'Apr 1',  actual: 218 }, { date: 'Apr 2',  actual: 215 },
  { date: 'Apr 3',  actual: 220 }, { date: 'Apr 4',  actual: 217 },
  { date: 'Apr 5',  actual: 214 }, { date: 'Apr 6',  actual: 216 },
  { date: 'Apr 7',  actual: 213 }, { date: 'Apr 8',  actual: 185 },
  { date: 'Apr 9',  actual: 187 }, { date: 'Apr 10', actual: 184 },
  { date: 'Apr 11', actual: 186 }, { date: 'Apr 12', actual: 183 },
  { date: 'Apr 13', actual: 188 }, { date: 'Apr 14', actual: 197 },
  { date: 'Apr 15', actual: 193 }, { date: 'Apr 16', actual: 191 },
  { date: 'Apr 17', actual: 194 }, { date: 'Apr 18', actual: 242 },
  { date: 'Apr 19', actual: 210 }, { date: 'Apr 20', actual: 198 },
  { date: 'Apr 21', actual: 192 }, { date: 'Apr 22', actual: 189 },
  { date: 'Apr 23', actual: 191 }, { date: 'Apr 24', actual: 188 },
  { date: 'Apr 25', actual: 186 }, { date: 'Apr 26', forecast: 188 },
  { date: 'Apr 27', forecast: 185 }, { date: 'Apr 28', forecast: 183 },
  { date: 'Apr 29', forecast: 187 }, { date: 'Apr 30', forecast: 184 },
]

const DEMO_CHART_DATA: { date: string; actual: number | null; forecast: number | null }[] = [
  { date: 'Apr 1',  actual: 215, forecast: null }, { date: 'Apr 2',  actual: 212, forecast: null },
  { date: 'Apr 3',  actual: 218, forecast: null }, { date: 'Apr 4',  actual: 210, forecast: null },
  { date: 'Apr 5',  actual: 216, forecast: null }, { date: 'Apr 6',  actual: 213, forecast: null },
  { date: 'Apr 7',  actual: 220, forecast: null }, { date: 'Apr 8',  actual: 185, forecast: null },
  { date: 'Apr 9',  actual: 187, forecast: null }, { date: 'Apr 10', actual: 188, forecast: null },
  { date: 'Apr 11', actual: 186, forecast: null }, { date: 'Apr 12', actual: 190, forecast: null },
  { date: 'Apr 13', actual: 188, forecast: null }, { date: 'Apr 14', actual: 195, forecast: null },
  { date: 'Apr 15', actual: 192, forecast: null }, { date: 'Apr 16', actual: 190, forecast: null },
  { date: 'Apr 17', actual: 193, forecast: null }, { date: 'Apr 18', actual: 240, forecast: null },
  { date: 'Apr 19', actual: 198, forecast: null }, { date: 'Apr 20', actual: 193, forecast: null },
  { date: 'Apr 21', actual: 195, forecast: null }, { date: 'Apr 22', actual: 191, forecast: null },
  { date: 'Apr 23', actual: 194, forecast: null }, { date: 'Apr 24', actual: 197, forecast: null },
  { date: 'Apr 25', actual: 192, forecast: null }, { date: 'Apr 26', actual: null, forecast: 188 },
  { date: 'Apr 27', actual: null, forecast: 190 }, { date: 'Apr 28', actual: null, forecast: 186 },
  { date: 'Apr 29', actual: null, forecast: 192 }, { date: 'Apr 30', actual: null, forecast: 195 },
]

// Month-over-month cost delta, derived from the already-fetched costTrend daily series
// (no new API call). Compares this month's spend-to-date against the same number of
// days into last month, calendar-string-parsed to avoid UTC/local timezone day-shift.
// Only returns a value when both windows have enough real daily coverage to trust the
// comparison — otherwise null. Mirrors computeMonthOverMonthCostChange in dashboard/page.tsx.
function computeMonthOverMonthCostChange(
  costTrend: Array<{ date: string; total: number }>
): number | null {
  if (!costTrend || costTrend.length === 0) return null

  const now = new Date()
  const curYear = now.getFullYear()
  const curMonth = now.getMonth()
  const dayOfMonth = now.getDate()
  const lastMonth = curMonth === 0 ? 11 : curMonth - 1
  const lastMonthYear = curMonth === 0 ? curYear - 1 : curYear

  let currentSum = 0, currentDays = 0
  let lastSum = 0, lastDays = 0

  for (const entry of costTrend) {
    const [y, m, d] = entry.date.split('-').map(Number)
    const month = m - 1
    if (y === curYear && month === curMonth && d <= dayOfMonth) {
      currentSum += entry.total
      currentDays++
    } else if (y === lastMonthYear && month === lastMonth && d <= dayOfMonth) {
      lastSum += entry.total
      lastDays++
    }
  }

  if (currentDays < dayOfMonth * 0.5 || lastDays < dayOfMonth * 0.5 || lastSum === 0) return null
  return Math.round(((currentSum - lastSum) / lastSum) * 1000) / 10
}

export default function CostsPage() {
  const { isPro } = usePlan()
  const [selectedRange, setSelectedRange] = useState('30D')
  const [nlQuery, setNlQuery] = useState('')
  const [nlResult, setNlResult] = useState<NLQueryResult | null>(null)
  const [nlLoading, setNlLoading] = useState(false)
  const [nlError, setNlError] = useState<string | null>(null)
  const [nlUpgradeBanner, setNlUpgradeBanner] = useState(false)
  const [hoveredCard, setHoveredCard] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const demoMode = useDemoMode()
  const salesDemoMode = useSalesDemo((state) => state.enabled)
  const isDemoActive = demoMode || salesDemoMode

  const selectedRangeParam = DATE_RANGES.find(r => r.label === selectedRange)?.range ?? '30d'

  // Source A: live AWS Cost Explorer, same call as dashboard/page.tsx.
  const { data: stats, isLoading: statsLoading } = useQuery<PlatformDashboardStats>({
    queryKey: ['platform-dashboard-stats'],
    queryFn: platformStatsService.getDashboardStats,
    // AWS cost data changes slowly — long staleTime/gcTime avoids re-hitting Cost Explorer
    // (billed per API call) on every render/tab-switch. Matches dashboard/page.tsx.
    staleTime: 4 * 60 * 60 * 1000, gcTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false, refetchOnMount: false, retry: false,
    enabled: !isDemoActive,
  })

  // Source A: per-category daily cost trend, same endpoint as dashboard/page.tsx.
  const { data: costTrend = [], isLoading: costTrendLoading } = useQuery<
    Array<{ date: string; compute: number; storage: number; database: number; network: number; other: number; total: number }>
  >({
    queryKey: ['cost-trend', selectedRangeParam],
    queryFn: async () => {
      const token = document.cookie.split(';').find(c => c.trim().startsWith('auth-token='))?.split('=')[1] || localStorage.getItem('accessToken')
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'}/api/platform/costs/trend?range=${selectedRangeParam}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
      })
      if (!res.ok) return []
      const json = await res.json()
      return json.data ?? []
    },
    staleTime: 4 * 60 * 60 * 1000, gcTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false, refetchOnMount: false, retry: false,
    enabled: !isDemoActive,
  })

  // Source C: cost_recommendations — same service Cost Optimization page uses.
  const { data: recStats, isLoading: recStatsLoading } = useQuery({
    queryKey: ['cost-recommendations-stats'],
    queryFn: costRecommendationsService.getStats,
    staleTime: 5 * 60 * 1000,
    enabled: !isDemoActive,
  })

  const { data: activeRecs = [] } = useQuery<CostRecommendation[]>({
    queryKey: ['cost-recommendations-active'],
    queryFn: () => costRecommendationsService.getAll({ status: 'ACTIVE' }),
    staleTime: 5 * 60 * 1000,
    enabled: !isDemoActive,
  })

  const handleNlQuery = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!nlQuery.trim()) return
    setNlLoading(true); setNlError(null); setNlResult(null); setNlUpgradeBanner(false)
    try {
      const result = await nlQueryService.executeQuery(nlQuery)
      setNlResult(result)
    } catch (err: any) {
      if (err?.status === 402) setNlUpgradeBanner(true)
      else setNlError('Could not process query. Try: "Show EC2 spend last 30 days" or "Which services cost the most?"')
    } finally {
      setNlLoading(false)
    }
  }

  const selectedDays = DATE_RANGES.find(r => r.label === selectedRange)?.days ?? 30
  const chartData = useMemo(() => {
    if (isDemoActive) return DEMO_CHART_DATA
    return costTrend.slice(-selectedDays).map(p => ({
      date: new Date(p.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      actual: Math.round(p.total),
      forecast: null as number | null,
    }))
  }, [isDemoActive, costTrend, selectedDays])

  const mtdSpend = isDemoActive ? DEMO_MTD_SPEND : (stats?.monthlyAwsCost ?? 0)

  const monthOverMonthChange = isDemoActive ? null : computeMonthOverMonthCostChange(costTrend)
  const growthRate = isDemoActive ? DEMO_GROWTH_RATE : (monthOverMonthChange ?? 0)

  const totalSavings   = isDemoActive ? DEMO_TOTAL_SAVINGS : (recStats?.totalPotentialSavings ?? 0)
  const displaySavings = totalSavings
  const displayAnnual  = Math.round(annualizeMonthly(displaySavings))
  const activeRecsCount = isDemoActive ? DEMO_TOP_SAVINGS.length : (recStats?.activeRecommendations ?? 0)

  const topSavingsRows: { id: string; title: string; savings: number; severity: RecommendationSeverity }[] = isDemoActive
    ? DEMO_TOP_SAVINGS.map((d, i) => ({ id: `demo-${i}`, title: d.title, savings: d.savings, severity: d.severity }))
    : [...activeRecs]
        .sort((a, b) => (b.potentialSavings || 0) - (a.potentialSavings || 0))
        .slice(0, 3)
        .map(r => ({ id: r.id, title: r.issue || r.resourceName || 'Cost optimization available', savings: r.potentialSavings || 0, severity: r.severity }))

  // Real per-service savings for the Cost by Service list, from the same activeRecs
  // (source C) already fetched above — no fabricated per-category dollar figure.
  const categorySavings = useMemo(() => {
    if (isDemoActive) return null
    const byType = (type: string) => activeRecs.filter(r => r.resourceType === type)
    const summarize = (recs: CostRecommendation[]) => {
      const total = recs.reduce((sum, r) => sum + (r.potentialSavings || 0), 0)
      const top = [...recs].sort((a, b) => (b.potentialSavings || 0) - (a.potentialSavings || 0))[0]
      return { total, issue: top?.issue ?? null }
    }
    return {
      compute: summarize(byType('EC2')),
      database: summarize(byType('RDS')),
    }
  }, [isDemoActive, activeRecs])

  const costAnomalyDetected = !isDemoActive && growthRate > 20

  const handleExportCSV = () => {
    const rows = [
      ['Date', 'Service', 'Cost'],
      ...DEMO_SPEND_DATA.map(d => [d.date, 'Total', d.actual ?? d.forecast ?? 0]),
    ]
    const csv = rows.map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `cost-overview-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Real per-category totals for the selected window, from the same costTrend response
  // already fetched for the chart — no fabricated percentage split of mtdSpend.
  const categoryTotals = useMemo(() => {
    if (isDemoActive) return null
    return costTrend.reduce((acc, p) => {
      acc.compute  += p.compute  ?? 0
      acc.storage  += p.storage  ?? 0
      acc.database += p.database ?? 0
      acc.network  += p.network  ?? 0
      acc.other    += p.other    ?? 0
      return acc
    }, { compute: 0, storage: 0, database: 0, network: 0, other: 0 })
  }, [isDemoActive, costTrend])

  const serviceBreakdown: { name: string; amount: number; pct: number; trend?: string; up?: boolean }[] = isDemoActive
    ? [
        { name: 'Compute (EC2, Lambda, ECS)', amount: Math.round(mtdSpend * 0.63), pct: 63, trend: '+13%', up: true },
        { name: 'Storage (S3, EBS)',          amount: Math.round(mtdSpend * 0.18), pct: 18, trend: '-5%',  up: false },
        { name: 'Database (RDS, DynamoDB)',   amount: Math.round(mtdSpend * 0.10), pct: 10, trend: '+8%',  up: true },
        { name: 'Network (Data Transfer)',    amount: Math.round(mtdSpend * 0.05), pct: 5,  trend: '+2%',  up: true },
        { name: 'Other Services',            amount: Math.round(mtdSpend * 0.04), pct: 4,  trend: '-1%',  up: false },
      ]
    : (() => {
        const ct = categoryTotals!
        const total = ct.compute + ct.storage + ct.database + ct.network + ct.other
        const pct = (v: number) => total > 0 ? Math.round((v / total) * 100) : 0
        return [
          { name: 'Compute (EC2, Lambda, ECS)', amount: Math.round(ct.compute),  pct: pct(ct.compute) },
          { name: 'Storage (S3, EBS)',          amount: Math.round(ct.storage),  pct: pct(ct.storage) },
          { name: 'Database (RDS, DynamoDB)',   amount: Math.round(ct.database), pct: pct(ct.database) },
          { name: 'Network (Data Transfer)',    amount: Math.round(ct.network),  pct: pct(ct.network) },
          { name: 'Other Services',             amount: Math.round(ct.other),    pct: pct(ct.other) },
        ]
      })()

  const kpiCards = [
    {
      key: 'savings', label: 'Identified Savings',
      value: (!isDemoActive && recStatsLoading) ? '—' : `$${displaySavings.toLocaleString()}/mo`,
      sub: mtdSpend > 0
        ? `$${displayAnnual.toLocaleString()} annually · ${Math.round((displaySavings / mtdSpend) * 100)}% of current spend`
        : `$${displayAnnual.toLocaleString()} annually`,
      subColor: 'text-green-600', TrendIcon: TrendingDown, trendColor: 'text-green-600',
      href: '/cost-optimization', borderTop: 'border-t-[3px] border-t-green-500', valueColor: 'text-green-600',
    },
    {
      key: 'mtd', label: 'Month-to-Date Spend',
      value: (!isDemoActive && statsLoading) ? '—' : `$${mtdSpend.toLocaleString()}`,
      sub: isDemoActive || stats?.costSource === 'actual' ? 'Live from AWS Cost Explorer' : 'Estimated · Cost Explorer unavailable',
      subColor: 'text-slate-500', TrendIcon: Minus, trendColor: 'text-slate-400',
      href: '/invoices', borderTop: '', valueColor: 'text-slate-900',
    },
    {
      key: 'momchange', label: 'Month-over-Month Change',
      value: (!isDemoActive && costTrendLoading) ? '—' : `${growthRate > 0 ? '+' : ''}${growthRate}%`,
      sub: growthRate > 0 ? 'Spend trending up vs last month' : growthRate < 0 ? 'Spend trending down vs last month' : 'Spend flat vs last month',
      subColor: growthRate > 10 ? 'text-red-600' : growthRate > 5 ? 'text-amber-500' : 'text-green-600',
      TrendIcon: growthRate > 0 ? TrendingUp : growthRate < 0 ? TrendingDown : Minus,
      trendColor: growthRate > 5 ? 'text-amber-500' : 'text-green-600',
      href: '/invoices', borderTop: '', valueColor: 'text-slate-900',
    },
    {
      key: 'activerecs', label: 'Active Recommendations',
      value: (!isDemoActive && recStatsLoading) ? '—' : `${activeRecsCount}`,
      sub: activeRecsCount > 0 ? 'Ready to review' : 'No open recommendations',
      subColor: activeRecsCount > 0 ? 'text-amber-500' : 'text-slate-500',
      TrendIcon: activeRecsCount > 0 ? TrendingUp : Minus,
      trendColor: activeRecsCount > 0 ? 'text-amber-500' : 'text-slate-400',
      href: '/cost-optimization', borderTop: '', valueColor: 'text-slate-900',
    },
  ]

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 max-w-[1320px] mx-auto overflow-x-hidden">
      <style>{`@keyframes ping { 75%, 100% { transform: scale(2); opacity: 0; } }`}</style>

      {/* ── PAGE HEADER ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-8">
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Cost Intelligence</h1>
            {demoMode && (
              <span className="text-xs font-semibold bg-amber-50 text-amber-600 border border-amber-200 px-3 py-0.5 rounded-full uppercase tracking-widest">
                Demo Mode
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 text-xs font-medium bg-slate-100 border border-slate-200 rounded-full px-2.5 py-1 text-slate-500">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
              Synced 2 min ago
            </span>
            <span className={`inline-flex items-center gap-1.5 text-xs font-medium rounded-full px-2.5 py-1 ${
              costAnomalyDetected && !isDemoActive
                ? 'bg-red-50 border border-red-200 text-red-600'
                : 'bg-green-50 border border-green-200 text-green-600'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${costAnomalyDetected && !isDemoActive ? 'bg-red-500' : 'bg-green-500'}`} />
              {costAnomalyDetected && !isDemoActive ? '1 anomaly detected' : 'All systems clear'}
            </span>
          </div>
          <p className="text-xs text-slate-500 font-medium leading-relaxed">
            Real-time AWS spend tracking, forecasting, and AI-powered savings recommendations
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={handleExportCSV} className="flex items-center gap-2 bg-white text-slate-600 px-4 py-2.5 rounded-lg text-sm font-medium border border-slate-200 hover:border-slate-300 cursor-pointer transition-colors whitespace-nowrap">
            <Download size={14} /> Export CSV
          </button>
          <a href="/cost-optimization" className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white px-4 py-2.5 rounded-lg text-sm font-semibold no-underline transition-colors whitespace-nowrap">
            <Zap size={14} /> Optimize Now
          </a>
        </div>
      </div>

      {/* ── COST ANOMALY BANNER ── */}
      {(isDemoActive || costAnomalyDetected) && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 sm:p-5 mb-6 flex items-start gap-3.5">
          <div className="relative shrink-0 mt-0.5">
            <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
            <div className="absolute inset-[-3px] rounded-full border-2 border-amber-500 opacity-40" style={{ animation: 'ping 1.5s cubic-bezier(0,0,0.2,1) infinite' }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1.5">
              <p className="text-xs font-bold text-amber-900 m-0">Cost Anomaly Detected</p>
              <span className="text-xs font-semibold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full border border-amber-200">AI Detected</span>
            </div>
            <p className="text-xs text-amber-800 leading-relaxed mb-2.5">
              {isDemoActive
                ? 'EC2 compute spending increased 35% in the last 24 hours. Possible cause: Lambda invocation spike on payment-processor triggering auto-scaling. Estimated impact: $864/month if sustained.'
                : 'Unusual cost pattern detected: spend is trending well above last month. Review your recent deployments and scaling events.'
              }
            </p>
            <div className="flex gap-2 flex-wrap">
              <a href="/anomalies" className="text-xs font-bold text-amber-600 bg-white border border-amber-200 px-3 py-1.5 rounded-lg no-underline inline-flex items-center gap-1">
                Investigate <ArrowRight size={11} />
              </a>
              <a href="/cost-optimization" className="text-xs font-medium text-amber-800 px-3 py-1.5 rounded-lg no-underline inline-flex items-center gap-1">
                View optimization recommendations →
              </a>
            </div>
          </div>
          <div className="shrink-0 text-right bg-white border border-amber-200 rounded-lg px-3 py-2 hidden sm:block">
            <p className="text-xs font-semibold text-amber-700 uppercase tracking-widest mb-1">Est. Impact</p>
            {isDemoActive ? (
              <>
                <p className="text-lg font-bold text-amber-500 m-0">+$864<span className="text-xs font-medium">/mo</span></p>
                <p className="text-xs text-amber-700 mt-0.5">if sustained</p>
              </>
            ) : (
              <>
                <p className="text-lg font-bold text-amber-500 m-0">+{growthRate}<span className="text-xs font-medium">%</span></p>
                <p className="text-xs text-amber-700 mt-0.5">vs last month</p>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── 4 KPI CARDS ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        {kpiCards.map(({ key, label, value, sub, subColor, TrendIcon, trendColor, href, borderTop, valueColor }) => (
          <Link key={key} href={href} className="no-underline">
            <div
              className={`bg-white rounded-xl p-4 sm:p-6 border border-slate-200 cursor-pointer transition-colors hover:border-violet-400 ${borderTop}`}
              onMouseEnter={() => setHoveredCard(key)}
              onMouseLeave={() => setHoveredCard(null)}
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-widest">{label}</span>
                <span className="text-slate-300 text-sm">›</span>
              </div>
              <div className={`text-2xl sm:text-3xl font-bold tracking-tight leading-none mb-2 ${valueColor}`}>{value}</div>
              <div className={`flex items-center gap-1.5 text-xs ${subColor}`}>
                <TrendIcon size={12} className={trendColor} />
                <span className="leading-relaxed">{sub}</span>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* ── NL SEARCH ── */}
      {!isPro ? (
        <div className="mb-6 bg-slate-50 border-2 border-dashed border-slate-200 rounded-xl p-7 text-center">
          <div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center mx-auto mb-3">
            <Lock size={18} className="text-violet-600" />
          </div>
          <p className="text-sm font-semibold text-slate-900 mb-1.5">Pro Plan Required</p>
          <p className="text-xs text-slate-500 mb-4">This feature is available on the Pro plan and above.</p>
          <a href="/settings/billing/upgrade" className="inline-block bg-violet-600 hover:bg-violet-700 text-white px-5 py-2 rounded-lg text-xs font-semibold no-underline transition-colors">
            Upgrade to Pro
          </a>
        </div>
      ) : (
        <>
          {nlUpgradeBanner && (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between bg-amber-50 border border-amber-400 rounded-xl px-5 py-3.5 mb-4 gap-3">
              <div className="flex items-center gap-2.5">
                <span className="text-lg">⚠️</span>
                <span className="text-sm font-medium text-amber-900">This feature requires the Pro plan.</span>
              </div>
              <a href="/settings/billing/upgrade" className="shrink-0 text-xs font-semibold text-white bg-amber-500 hover:bg-amber-600 rounded-lg px-4 py-2 no-underline whitespace-nowrap">
                Upgrade to Pro
              </a>
            </div>
          )}
          <form onSubmit={handleNlQuery} className="mb-6">
            <div className="relative">
              <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                ref={inputRef}
                value={nlQuery}
                onChange={e => setNlQuery(e.target.value)}
                placeholder='Ask anything — "Show EC2 spend last 30 days" · "Which region costs the most?"'
                className="w-full pl-11 pr-28 py-3.5 rounded-xl border border-slate-200 text-sm text-slate-900 bg-white outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/15 transition-all"
              />
              <button
                type="submit"
                disabled={nlLoading}
                className="absolute right-2 top-1/2 -translate-y-1/2 bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer border-none"
              >
                {nlLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                {nlLoading ? 'Analyzing...' : 'Ask AI'}
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {['Why is EC2 cost high?', 'What can I optimize today?', 'Show biggest waste', 'Compare vs last month'].map(chip => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => { setNlQuery(chip); inputRef.current?.focus() }}
                  className="text-xs text-violet-600 bg-violet-50 rounded-full px-2.5 py-1 cursor-pointer border-none font-medium hover:bg-violet-100 transition-colors"
                >
                  {chip}
                </button>
              ))}
            </div>
            {isDemoActive && !nlResult && (
              <div className="mt-2.5 flex items-center justify-between bg-slate-50 border-l-2 border-violet-500 rounded-r-lg px-4 py-3 gap-4">
                <p className="text-xs text-slate-500 leading-relaxed m-0">
                  <strong className="text-slate-900">AI insight:</strong> Your EC2 instances are 38% underutilized. 3 instances running at &lt;5% CPU for 21+ days.
                </p>
                <span className="text-xs font-bold text-green-600 shrink-0">$362/mo savings</span>
              </div>
            )}
            {nlResult && (
              <div className="mt-3 bg-white border border-violet-200 rounded-xl overflow-hidden">
                <div className="bg-violet-50 px-5 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-6 h-6 rounded-md bg-violet-600 flex items-center justify-center">
                      <Sparkles size={11} className="text-white" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-900 m-0">{nlResult.intent.explanation}</p>
                      <p className="text-xs text-violet-600 m-0">{nlResult.rowCount} results · {nlResult.executionMs}ms · Confidence: {nlResult.intent.confidence}</p>
                    </div>
                  </div>
                  <button onClick={() => setNlResult(null)} className="bg-transparent border-none cursor-pointer text-slate-400 hover:text-slate-600">
                    <X size={14} />
                  </button>
                </div>
                <div className="px-5 py-2.5 border-b border-slate-100 bg-slate-50">
                  <p className="text-xs text-slate-500 m-0">{nlResult.data.summary}</p>
                </div>
                {nlResult.data.rows.length > 0 && (
                  <div className="overflow-x-auto">
                    <div className="grid px-5 py-2.5 bg-slate-50 border-b border-slate-100" style={{ gridTemplateColumns: `repeat(${nlResult.data.columns.length}, 1fr)` }}>
                      {nlResult.data.columns.map(col => (
                        <span key={col} className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{col}</span>
                      ))}
                    </div>
                    {nlResult.data.rows.map((row, idx) => (
                      <div key={idx} className="grid px-5 py-3 border-b border-slate-50 last:border-b-0 hover:bg-slate-50 items-center" style={{ gridTemplateColumns: `repeat(${nlResult.data.columns.length}, 1fr)` }}>
                        {Object.values(row).slice(0, nlResult.data.columns.length).map((val: any, ci) => (
                          <span key={ci} className={`text-sm text-slate-900 ${ci === 0 ? 'font-semibold' : ''}`}>
                            {val instanceof Date ? new Date(val).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : val == null ? '—' : String(val)}
                          </span>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
                {nlResult.data.rows.length === 0 && (
                  <div className="px-5 py-8 text-center">
                    <p className="text-sm text-slate-500 m-0">No data matched your query. Try rephrasing or check your AWS connection.</p>
                  </div>
                )}
              </div>
            )}
            {nlError && <p className="mt-2 text-xs text-amber-600 px-1">{nlError}</p>}
          </form>
        </>
      )}

      {/* ── SPEND TREND CHART ── */}
      <div className="bg-white rounded-2xl p-4 sm:p-8 border border-slate-100 mb-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 mb-1 tracking-tight">Spend Trend</h2>
            <p className="text-xs text-slate-500 leading-relaxed m-0">
              {isDemoActive ? 'Historical spend and AI forecast · Dashed line indicates prediction' : 'Historical AWS spend by day, from Cost Explorer'}
            </p>
          </div>
          <div className="flex bg-slate-50 rounded-lg p-1 gap-0.5 overflow-x-auto">
            {DATE_RANGES.map(({ label }) => (
              <button
                key={label}
                onClick={() => setSelectedRange(label)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold border-none cursor-pointer transition-all whitespace-nowrap ${
                  selectedRange === label ? 'bg-white text-slate-900 shadow-sm' : 'bg-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Chart summary */}
        <div className="flex flex-wrap gap-4 sm:gap-8 mb-5 pb-5 border-b border-slate-100">
          {[
            { label: 'Current Run Rate',       value: `$${mtdSpend.toLocaleString()}/mo`, color: 'text-slate-900' },
            { label: 'Month-over-Month',       value: `${growthRate > 0 ? '+' : ''}${growthRate}%`, color: growthRate > 5 ? 'text-red-600' : 'text-green-600' },
            { label: 'Active Recommendations', value: `${activeRecsCount}`, color: 'text-slate-500' },
            { label: 'Identified Savings',     value: `$${displaySavings.toLocaleString()}/mo`, color: 'text-green-600' },
          ].map(({ label, value, color }) => (
            <div key={label}>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1">{label}</p>
              <p className={`text-lg font-bold tracking-tight m-0 ${color}`}>{value}</p>
            </div>
          ))}
        </div>

        {/* Top drivers */}
        <div className="flex flex-wrap gap-3 mb-5 pb-4 border-b border-slate-100">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest m-0 self-center">Top drivers</p>
          {[
            { name: 'Compute',  amount: isDemoActive ? 5200 : Math.round(categoryTotals?.compute  ?? 0), color: '#3B82F6' },
            { name: 'Database', amount: isDemoActive ? 2400 : Math.round(categoryTotals?.database ?? 0), color: '#8B5CF6' },
            { name: 'Storage',  amount: isDemoActive ? 3800 : Math.round(categoryTotals?.storage  ?? 0), color: '#06B6D4' },
          ].map(({ name, amount, color }) => (
            <div key={name} className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
              <span className="text-xs text-slate-500">{name}</span>
              <span className="text-xs font-bold text-slate-900">${amount.toLocaleString()}</span>
            </div>
          ))}
        </div>

        {/* Chart */}
        {isDemoActive ? (
          <div className="overflow-hidden">
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={DEMO_SPEND_DATA.slice(-Math.min(selectedDays, DEMO_SPEND_DATA.length))} margin={{ top: 28, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="demoActualGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0F172A" stopOpacity={0.12} />
                    <stop offset="100%" stopColor="#0F172A" stopOpacity={0.01} />
                  </linearGradient>
                  <linearGradient id="demoForecastGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#7C3AED" stopOpacity={0.10} />
                    <stop offset="100%" stopColor="#7C3AED" stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="#F1F5F9" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94A3B8' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: '#94A3B8' }} axisLine={false} tickLine={false} tickFormatter={(v: number) => v >= 1000 ? `$${(v/1000).toFixed(1)}k` : `$${v}`} width={48} domain={[150, (d: number) => Math.ceil(d * 1.05)]} />
                <Tooltip contentStyle={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: '10px', fontSize: '0.75rem', boxShadow: '0 4px 24px rgba(0,0,0,0.08)', padding: '10px 14px' }} labelStyle={{ fontWeight: 600, color: '#0F172A', marginBottom: '4px' }} formatter={(v: any, name: any) => [`$${typeof v === 'number' ? v.toLocaleString() : v}/mo`, name === 'actual' ? 'Actual Spend' : 'AI Forecast']} />
                <Area type="monotone" dataKey="actual" stroke="#0F172A" strokeWidth={2} fill="url(#demoActualGradient)" dot={false} connectNulls={false} activeDot={{ r: 4, fill: '#0F172A', strokeWidth: 0 }} />
                <Area type="monotone" dataKey="forecast" stroke="#7C3AED" strokeWidth={2} fill="url(#demoForecastGradient)" dot={false} connectNulls={false} strokeDasharray="6 3" activeDot={{ r: 4, fill: '#7C3AED', strokeWidth: 0 }} />
                <ReferenceLine x="Apr 8"  stroke="#3B6D11" strokeDasharray="4 3" strokeWidth={1.5} label={{ value: 'Apr 8 · Optimized', position: 'insideTopLeft' as const, fontSize: 9, fill: '#3B6D11' } as any} />
                <ReferenceLine x="Apr 14" stroke="#EF9F27" strokeDasharray="4 3" strokeWidth={1.5} label={{ value: 'Apr 14 · EC2 idle',  position: 'insideTopLeft' as const, fontSize: 9, fill: '#854F0B' } as any} />
                <ReferenceLine x="Apr 18" stroke="#E24B4A" strokeDasharray="4 3" strokeWidth={1.5} label={{ value: 'Apr 18 · Spike',      position: 'insideTopLeft' as const, fontSize: 9, fill: '#A32D2D' } as any} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : costTrendLoading ? (
          <div className="h-60 flex items-center justify-center">
            <Loader2 size={20} className="text-slate-400 animate-spin" />
          </div>
        ) : (
          <div className="overflow-hidden">
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={chartData} margin={{ top: 28, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="actualGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0F172A" stopOpacity={0.12} />
                    <stop offset="100%" stopColor="#0F172A" stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="#F1F5F9" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94A3B8' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: '#94A3B8' }} axisLine={false} tickLine={false} tickFormatter={(v: number) => v >= 1000 ? `$${(v/1000).toFixed(1)}k` : `$${v}`} width={48} domain={[(d: number) => Math.max(0, Math.floor(d * 0.85)), (d: number) => Math.ceil(d * 1.15)]} />
                <Tooltip contentStyle={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: '10px', fontSize: '0.75rem', boxShadow: '0 4px 24px rgba(0,0,0,0.08)', padding: '10px 14px' }} labelStyle={{ fontWeight: 600, color: '#0F172A', marginBottom: '4px' }} formatter={(v: any) => [`$${typeof v === 'number' ? v.toLocaleString() : v}/mo`, 'Actual Spend']} />
                <Area type="monotone" dataKey="actual" stroke="#0F172A" strokeWidth={2} fill="url(#actualGradient)" dot={false} connectNulls={false} activeDot={{ r: 4, fill: '#0F172A', strokeWidth: 0 }} />
                <ReferenceLine y={mtdSpend} stroke="#94A3B8" strokeDasharray="4 3" strokeWidth={1} label={{ value: `$${mtdSpend}/mo baseline`, position: 'insideTopRight', fontSize: 10, fill: '#94A3B8' } as any} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Legend */}
        <div className="flex flex-wrap gap-4 sm:gap-6 mt-4 pt-4 border-t border-slate-100">
          {(isDemoActive
            ? [
                { color: '#0F172A', dash: false, label: 'Actual spend' },
                { color: '#7C3AED', dash: true,  label: 'AI forecast'  },
              ]
            : [
                { color: '#0F172A', dash: false, label: 'Actual spend' },
              ]
          ).map(({ color, dash, label }) => (
            <div key={label} className="flex items-center gap-2">
              <svg width="24" height="2" className="shrink-0">
                <line x1="0" y1="1" x2="24" y2="1" stroke={color} strokeWidth="2" strokeDasharray={dash ? '5 3' : '0'} />
              </svg>
              <span className="text-xs text-slate-500 font-medium">{label}</span>
            </div>
          ))}
          <span className="text-xs text-slate-500 ml-auto hidden sm:block">
            {isDemoActive ? 'Values shown as monthly equivalent' : 'Values shown as daily spend'}
          </span>
        </div>
      </div>

      {/* ── COST BY SERVICE + TOP SAVINGS ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">

        {/* Cost by Service */}
        <div className="bg-white rounded-2xl p-5 sm:p-8 border border-slate-100">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-sm font-semibold text-slate-900 m-0 tracking-tight">Cost by Service</h2>
            <a href="/cost-optimization" className="text-xs font-semibold text-violet-600 no-underline flex items-center gap-1">
              Full breakdown <ChevronRight size={12} />
            </a>
          </div>
          <div className="flex flex-col gap-4">
            {(() => {
              const totalServiceSpend = serviceBreakdown.reduce((sum, s) => sum + s.amount, 0)
              const hasSpend = totalServiceSpend > 0
              return serviceBreakdown.map(({ name, amount, pct, trend, up }) => {
                const pctOfTotal = hasSpend ? Math.round((amount / totalServiceSpend) * 100) : 0
                const isCompute = name.startsWith('Compute')
                const isDatabase = name.startsWith('Database')
                const savingsFlag = amount === 0 ? null : isDemoActive
                  ? (isCompute ? '⚠ $362 savings available · Underloaded EC2' : isDatabase ? '⚠ $1,335 savings via reserved pricing' : null)
                  : (isCompute && categorySavings!.compute.total > 0
                      ? `⚠ $${Math.round(categorySavings!.compute.total).toLocaleString()}/mo savings available · ${categorySavings!.compute.issue}`
                      : isDatabase && categorySavings!.database.total > 0
                        ? `⚠ $${Math.round(categorySavings!.database.total).toLocaleString()}/mo savings available · ${categorySavings!.database.issue}`
                        : null)
                return (
                  <div key={name}>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: SERVICE_COLORS[name] ?? '#94A3B8' }} />
                        <span className="text-xs text-slate-700 font-medium">{name}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        {hasSpend && <span className="text-xs text-slate-500 font-medium">{pctOfTotal}%</span>}
                        {hasSpend && trend != null && <span className={`text-xs font-medium ${up ? 'text-amber-500' : 'text-green-600'}`}>{trend}</span>}
                        <span className="text-sm font-semibold text-slate-900 min-w-[60px] text-right">${amount.toLocaleString()}</span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${hasSpend ? pct : 0}%`, background: SERVICE_COLORS[name] ?? '#94A3B8' }} />
                    </div>
                    {savingsFlag && <p className="text-xs text-amber-500 mt-1 font-medium">{savingsFlag}</p>}
                  </div>
                )
              })
            })()}
          </div>
        </div>

        {/* Top Savings */}
        <div className="bg-white rounded-2xl p-5 sm:p-8 border border-green-200 border-t-[3px] border-t-green-500">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-sm font-semibold text-green-600 m-0 tracking-tight">Top Savings</h2>
            <a href="/cost-optimization" className="text-xs font-semibold text-violet-600 no-underline flex items-center gap-1">
              View all <ChevronRight size={12} />
            </a>
          </div>

          {isDemoActive && (
            <div className="flex items-center justify-between mb-3.5">
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1.5">Optimization Confidence</p>
                <div className="flex items-center gap-2">
                  <div className="h-1 bg-slate-100 rounded-full w-24">
                    <div className="h-full bg-green-500 rounded-full" style={{ width: '94%' }} />
                  </div>
                  <span className="text-sm font-bold text-green-600">94%</span>
                </div>
              </div>
              <span className="text-xs text-green-600 font-semibold bg-green-50 px-2.5 py-1 rounded-full border border-green-200">Safe to apply</span>
            </div>
          )}

          <div className="bg-green-50 rounded-xl p-4 mb-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-green-600 uppercase tracking-widest mb-1">Total Identified</p>
              <p className="text-2xl font-extrabold text-green-600 m-0">${displaySavings.toLocaleString()}<span className="text-sm font-medium">/mo</span></p>
            </div>
            <div className="text-center sm:text-right">
              <a href="/cost-optimization" className="bg-green-600 hover:bg-green-700 text-white px-4 py-2.5 rounded-xl text-xs font-bold no-underline inline-block transition-colors whitespace-nowrap">
                Review savings
              </a>
              {isDemoActive && <p className="text-xs text-green-600 mt-1 font-medium">No downtime risk · Fully reversible</p>}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {topSavingsRows.length > 0 ? topSavingsRows.map((rec) => (
              <div key={rec.id} className="p-3.5 bg-slate-50 rounded-xl border border-slate-100">
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <p className="text-xs font-medium text-slate-900 m-0 leading-relaxed">{rec.title}</p>
                  <span className="text-xs font-bold text-green-600 shrink-0">${rec.savings.toLocaleString()}/mo</span>
                </div>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${severityStyles[rec.severity]}`}>
                  {rec.severity}
                </span>
              </div>
            )) : (
              <div className="p-6 text-center">
                <p className="text-xs text-slate-500 m-0">No optimization recommendations yet. Run a cost scan to identify savings opportunities.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── DEVCONTROL VALUE DELIVERED ── */}
      {isDemoActive && (
        <div className="bg-slate-50 rounded-2xl p-5 sm:p-8 border border-slate-100 mb-4">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-5">DevControl value delivered</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: 'Saved this year',       value: '$23,400' },
              { label: 'Optimizations applied', value: '27' },
              { label: 'Efficiency score',      value: '100%',   note: '↑ from 72%' },
              { label: 'Anomalies caught',      value: '14' },
              { label: 'Monthly ROI',           value: '47×' },
              { label: 'Policies running',      value: '3' },
            ].map(({ label, value, note }) => (
              <div key={label} className="bg-white rounded-xl p-4 border border-slate-100">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1.5">{label}</p>
                <p className="text-xl font-bold text-slate-900 m-0 tracking-tight leading-none">{value}</p>
                {note && <p className="text-xs text-green-600 mt-1 font-medium">{note}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
