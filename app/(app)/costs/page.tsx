'use client'

import { useState, useRef, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, ReferenceLine,
} from 'recharts'
import {
  Search, Download, TrendingUp, TrendingDown,
  Sparkles, ArrowRight, Loader2, X, ChevronRight,
  DollarSign, BarChart3, Zap, Target, Lock,
} from 'lucide-react'
import { usePlan } from '@/lib/hooks/use-plan'
import { forecastService } from '@/lib/services/forecast.service'
import { optimizationService } from '@/lib/services/optimization.service'
import { costRecommendationsService } from '@/lib/services/cost-recommendations.service'
import { nlQueryService, NLQueryIntent, NLQueryResult, NLQueryResultData } from '@/lib/services/nl-query.service'
import { demoModeService } from '@/lib/services/demo-mode.service'
import { useDemoMode } from '@/components/demo/demo-mode-toggle'
import { useSalesDemo } from '@/lib/demo/sales-demo-data'
import Link from 'next/link'
import { OptimizationRecommendation } from '@/types/optimization.types'

const SERVICE_COLORS: Record<string, string> = {
  'Compute (EC2, Lambda, ECS)': '#3B82F6',
  'Storage (S3, EBS)':          '#06B6D4',
  'Database (RDS, DynamoDB)':   '#8B5CF6',
  'Network (Data Transfer)':    '#F59E0B',
  'Other Services':             '#94A3B8',
}

const DATE_RANGES = [
  { label: '7D',  days: 7   },
  { label: '30D', days: 30  },
  { label: '3M',  days: 90  },
  { label: '6M',  days: 180 },
  { label: '1Y',  days: 365 },
]

// FIX 2 — strip markdown bold/italic markers before rendering
const stripMarkdown = (text: string) =>
  text.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1').trim()

// FIX 4 — fallback savings when optimization service returns empty
const FALLBACK_SAVINGS = [
  { savings: 890 },
  { savings: 445 },
  { savings: 362 },
]

// Demo spend chart data — fixed April story for the standalone demo chart
const DEMO_SPEND_DATA: { date: string; actual?: number; forecast?: number }[] = [
  { date: 'Apr 1',  actual: 218 },
  { date: 'Apr 2',  actual: 215 },
  { date: 'Apr 3',  actual: 220 },
  { date: 'Apr 4',  actual: 217 },
  { date: 'Apr 5',  actual: 214 },
  { date: 'Apr 6',  actual: 216 },
  { date: 'Apr 7',  actual: 213 },
  { date: 'Apr 8',  actual: 185 },
  { date: 'Apr 9',  actual: 187 },
  { date: 'Apr 10', actual: 184 },
  { date: 'Apr 11', actual: 186 },
  { date: 'Apr 12', actual: 183 },
  { date: 'Apr 13', actual: 188 },
  { date: 'Apr 14', actual: 197 },
  { date: 'Apr 15', actual: 193 },
  { date: 'Apr 16', actual: 191 },
  { date: 'Apr 17', actual: 194 },
  { date: 'Apr 18', actual: 242 },
  { date: 'Apr 19', actual: 210 },
  { date: 'Apr 20', actual: 198 },
  { date: 'Apr 21', actual: 192 },
  { date: 'Apr 22', actual: 189 },
  { date: 'Apr 23', actual: 191 },
  { date: 'Apr 24', actual: 188 },
  { date: 'Apr 25', actual: 186 },
  { date: 'Apr 26', forecast: 188 },
  { date: 'Apr 27', forecast: 185 },
  { date: 'Apr 28', forecast: 183 },
  { date: 'Apr 29', forecast: 187 },
  { date: 'Apr 30', forecast: 184 },
]

// Demo chart data — fixed April story so event markers at Apr 8/14/18 are meaningful
const DEMO_CHART_DATA: { date: string; actual: number | null; forecast: number | null }[] = [
  { date: 'Apr 1',  actual: 215, forecast: null },
  { date: 'Apr 2',  actual: 212, forecast: null },
  { date: 'Apr 3',  actual: 218, forecast: null },
  { date: 'Apr 4',  actual: 210, forecast: null },
  { date: 'Apr 5',  actual: 216, forecast: null },
  { date: 'Apr 6',  actual: 213, forecast: null },
  { date: 'Apr 7',  actual: 220, forecast: null },
  { date: 'Apr 8',  actual: 185, forecast: null },  // optimization applied — drop
  { date: 'Apr 9',  actual: 187, forecast: null },
  { date: 'Apr 10', actual: 188, forecast: null },
  { date: 'Apr 11', actual: 186, forecast: null },
  { date: 'Apr 12', actual: 190, forecast: null },
  { date: 'Apr 13', actual: 188, forecast: null },
  { date: 'Apr 14', actual: 195, forecast: null },  // EC2 idle detected — small uptick
  { date: 'Apr 15', actual: 192, forecast: null },
  { date: 'Apr 16', actual: 190, forecast: null },
  { date: 'Apr 17', actual: 193, forecast: null },
  { date: 'Apr 18', actual: 240, forecast: null },  // storage spike
  { date: 'Apr 19', actual: 198, forecast: null },
  { date: 'Apr 20', actual: 193, forecast: null },
  { date: 'Apr 21', actual: 195, forecast: null },
  { date: 'Apr 22', actual: 191, forecast: null },
  { date: 'Apr 23', actual: 194, forecast: null },
  { date: 'Apr 24', actual: 197, forecast: null },
  { date: 'Apr 25', actual: 192, forecast: null },
  { date: 'Apr 26', actual: null, forecast: 188 },  // forecast (dashed) begins
  { date: 'Apr 27', actual: null, forecast: 190 },
  { date: 'Apr 28', actual: null, forecast: 186 },
  { date: 'Apr 29', actual: null, forecast: 192 },
  { date: 'Apr 30', actual: null, forecast: 195 },
]

export default function CostsPage() {
  const { isPro } = usePlan()
  const [selectedRange, setSelectedRange] = useState('30D')
  const [nlQuery, setNlQuery] = useState('')
  const [nlResult, setNlResult] = useState<NLQueryResult | null>(null)
  const [nlLoading, setNlLoading] = useState(false)
  const [nlError, setNlError] = useState<string | null>(null)
  const [nlUpgradeBanner, setNlUpgradeBanner] = useState(false)
  const [hoveredCard, setHoveredCard] = useState<string | null>(null)
  const [narrativeExpanded, setNarrativeExpanded] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const demoMode = useDemoMode()
  const salesDemoMode = useSalesDemo((state) => state.enabled)
  const isDemoActive = demoMode || salesDemoMode

  const { data: forecast, isLoading: forecastLoading } = useQuery({
    queryKey: ['forecast', '90d', isDemoActive],
    queryFn: () => forecastService.getForecast('90d'),
    staleTime: 5 * 60 * 1000,
  })

  const { data: optimization, isLoading: optimizationLoading } = useQuery({
    queryKey: ['optimization', 'summary'],
    queryFn: () => optimizationService.getRecommendations(),
    staleTime: 5 * 60 * 1000,
  })

  useQuery({
    queryKey: ['cost-recommendations'],
    queryFn: () => costRecommendationsService.getAll(),
    staleTime: 5 * 60 * 1000,
  })

  const handleNlQuery = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!nlQuery.trim()) return
    setNlLoading(true)
    setNlError(null)
    setNlResult(null)
    setNlUpgradeBanner(false)
    try {
      const result = await nlQueryService.executeQuery(nlQuery)
      setNlResult(result)
    } catch (err: any) {
      if (err?.status === 402) {
        setNlUpgradeBanner(true)
      } else {
        setNlError('Could not process query. Try: "Show EC2 spend last 30 days" or "Which services cost the most?"')
      }
    } finally {
      setNlLoading(false)
    }
  }

  const selectedDays = DATE_RANGES.find(r => r.label === selectedRange)?.days ?? 30
  const chartData = useMemo(() => {
    if (isDemoActive) return DEMO_CHART_DATA
    if (!forecast) return []

    const historical = forecast.historicalData
      .slice(-selectedDays)
      .map(p => ({
        date: p.date instanceof Date
          ? p.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          : new Date(p.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        actual: Math.round((p.value || 0) * 30),   // daily → monthly
        forecast: null as number | null,
      }))

    const predictions = forecast.predictions
      .slice(0, Math.max(0, selectedDays - forecast.historicalData.length))
      .map(p => ({
        date: p.date instanceof Date
          ? p.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          : new Date(p.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        actual: null as number | null,
        forecast: Math.round((p.value || 0) * 30),  // daily → monthly
      }))

    return [...historical, ...predictions]
  }, [isDemoActive, forecast, selectedDays])

  const mtdSpend = forecast?.historicalTotal ?? 0
  const forecast90 = forecast?.predicted90Day ?? 0
  const totalSavings = optimization?.summary?.totalMonthlySavings ?? 0
  const annualSavings = optimization?.summary?.totalAnnualSavings ?? 0

  // FIX 4 — display values fall back to summed demo cards when service returns 0
  const displaySavings = totalSavings > 0
    ? totalSavings
    : FALLBACK_SAVINGS.reduce((sum, r) => sum + r.savings, 0)
  const displayAnnual = annualSavings > 0
    ? annualSavings
    : displaySavings * 12

  const efficiencyScore = mtdSpend > 0
    ? Math.round(((mtdSpend - totalSavings) / mtdSpend) * 100)
    : 0
  const growthRate = forecast?.growthRate ?? 0
  const topRecs: OptimizationRecommendation[] = optimization?.recommendations?.slice(0, 3) ?? []

  const serviceBreakdown = [
    { name: 'Compute (EC2, Lambda, ECS)', amount: Math.round(mtdSpend * 0.63), pct: 63, trend: '+13%', up: true },
    { name: 'Storage (S3, EBS)',          amount: Math.round(mtdSpend * 0.18), pct: 18, trend: '-5%',  up: false },
    { name: 'Database (RDS, DynamoDB)',   amount: Math.round(mtdSpend * 0.10), pct: 10, trend: '+8%',  up: true },
    { name: 'Network (Data Transfer)',    amount: Math.round(mtdSpend * 0.05), pct: 5,  trend: '+2%',  up: true },
    { name: 'Other Services',            amount: Math.round(mtdSpend * 0.04), pct: 4,  trend: '-1%',  up: false },
  ]

  const currentSpend = mtdSpend
  const nextMonthForecast = isDemoActive
    ? Math.round(currentSpend * 1.09)
    : Math.round((forecast90 / 3) * 1.09)
  const nextMonthBaseline = isDemoActive
    ? currentSpend
    : Math.round(forecast90 / 3)

  const costAnomalyDetected = !isDemoActive && (forecast?.growthRate ?? 0) > 20

  return (
    <div style={{
      padding: '40px 56px 64px',
      maxWidth: '1320px',
      margin: '0 auto',
      minHeight: '100vh',
      background: '#F9FAFB',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      <style>{`
        @keyframes ping {
          75%, 100% { transform: scale(2); opacity: 0; }
        }
      `}</style>

      {/* PAGE HEADER */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '32px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px' }}>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#0F172A', margin: 0, letterSpacing: '-0.02em' }}>
              Cost Intelligence
            </h1>
            {demoMode && (
              <span style={{ fontSize: '0.7rem', fontWeight: 600, background: '#FFFBEB', color: '#D97706', border: '1px solid #FDE68A', padding: '3px 12px', borderRadius: '100px', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                Demo Mode
              </span>
            )}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '10px', fontWeight: 500, background: '#F1F5F9', border: '0.5px solid #E5E7EB', borderRadius: '100px', padding: '3px 9px', color: '#475569' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#22C55E', flexShrink: 0 }} />
              Synced 2 min ago
            </span>
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              fontSize: '10px',
              fontWeight: 500,
              background: costAnomalyDetected && !isDemoActive ? '#FEF2F2' : '#F0FDF4',
              border: `0.5px solid ${costAnomalyDetected && !isDemoActive ? '#FCA5A5' : '#BBF7D0'}`,
              borderRadius: '100px',
              padding: '3px 9px',
              color: costAnomalyDetected && !isDemoActive ? '#DC2626' : '#059669',
            }}>
              <span style={{
                width: '6px', height: '6px',
                borderRadius: '50%',
                background: costAnomalyDetected && !isDemoActive ? '#DC2626' : '#22C55E',
                flexShrink: 0,
              }}/>
              {costAnomalyDetected && !isDemoActive ? '1 anomaly detected' : 'All systems clear'}
            </span>
          </div>
          <p style={{ fontSize: '0.875rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>
            Real-time AWS spend tracking, forecasting, and AI-powered savings recommendations
          </p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#fff', color: '#374151', padding: '10px 20px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 500, border: '1px solid #E2E8F0', cursor: 'pointer' }}>
            <Download size={15} /> Export CSV
          </button>
          <a href="/cost-optimization" style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#7C3AED', color: '#fff', padding: '10px 20px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600, textDecoration: 'none' }}>
            <Zap size={15} /> Optimize Now
          </a>
        </div>
      </div>

      {/* Cost Anomaly Detection Banner */}
      {(isDemoActive || costAnomalyDetected) && (
        <div style={{
          background: '#FFFBEB',
          border: '1px solid #FDE68A',
          borderRadius: '12px',
          padding: '16px 20px',
          marginBottom: '24px',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '14px',
        }}>
          {/* Pulsing dot */}
          <div style={{ position: 'relative', flexShrink: 0, marginTop: '2px' }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#D97706' }} />
            <div style={{
              position: 'absolute', inset: '-3px',
              borderRadius: '50%',
              border: '2px solid #D97706',
              opacity: 0.4,
              animation: 'ping 1.5s cubic-bezier(0,0,0.2,1) infinite',
            }} />
          </div>

          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <p style={{ fontSize: '0.78rem', fontWeight: 700, color: '#92400E', margin: 0 }}>
                Cost Anomaly Detected
              </p>
              <span style={{ fontSize: '0.68rem', fontWeight: 600, background: '#FEF3C7', color: '#B45309', padding: '1px 8px', borderRadius: '100px', border: '1px solid #FDE68A' }}>
                AI Detected
              </span>
            </div>
            <p style={{ fontSize: '0.82rem', color: '#92400E', margin: '0 0 10px', lineHeight: 1.6 }}>
              {isDemoActive
                ? 'EC2 compute spending increased 35% in the last 24 hours. Possible cause: Lambda invocation spike on payment-processor triggering auto-scaling. Estimated impact: $864/month if sustained.'
                : 'Unusual cost pattern detected in the last 24 hours. Review your recent deployments and scaling events.'
              }
            </p>
            <div style={{ display: 'flex', gap: '8px' }}>
              <a href="/anomalies" style={{ fontSize: '0.75rem', fontWeight: 700, color: '#D97706', background: '#fff', border: '1px solid #FDE68A', padding: '5px 12px', borderRadius: '6px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                Investigate <ArrowRight size={11} />
              </a>
              <a href="/cost-optimization" style={{ fontSize: '0.75rem', fontWeight: 600, color: '#92400E', padding: '5px 12px', borderRadius: '6px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                View optimization recommendations →
              </a>
            </div>
          </div>

          {/* Cost impact callout */}
          <div style={{ flexShrink: 0, textAlign: 'right', background: '#fff', border: '1px solid #FDE68A', borderRadius: '8px', padding: '10px 14px' }}>
            <p style={{ fontSize: '0.68rem', fontWeight: 600, color: '#B45309', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 3px' }}>Est. Impact</p>
            <p style={{ fontSize: '1.1rem', fontWeight: 700, color: '#D97706', margin: 0, letterSpacing: '-0.02em' }}>+$864<span style={{ fontSize: '0.75rem', fontWeight: 500 }}>/mo</span></p>
            <p style={{ fontSize: '0.68rem', color: '#B45309', margin: '2px 0 0' }}>if sustained</p>
          </div>
        </div>
      )}

      {/* 4 KPI CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', marginBottom: '20px' }}>
        {([
          {
            cardKey: 'savings',
            label: 'Identified Savings',
            value: optimizationLoading ? '—' : `$${displaySavings.toLocaleString()}/mo`,
            sub: `$${displayAnnual.toLocaleString()} annually · ${mtdSpend > 0 ? Math.round((displaySavings / mtdSpend) * 100) : 290}% of current spend`,
            subColor: '#059669',
            TrendIcon: TrendingDown,
            trendColor: '#059669',
            href: '/cost-optimization' as string | null,
            cardBg: undefined as string | undefined,
            cardBorder: undefined as string | undefined,
            cardBorderTop: '3px solid #059669' as string | undefined,
            valueColor: '#059669' as string | undefined,
            valueFontSize: '2.25rem' as string | undefined,
          },
          {
            cardKey: 'mtd',
            label: 'Month-to-Date Spend',
            value: forecastLoading ? '—' : `$${mtdSpend.toLocaleString()}`,
            sub: `${growthRate > 0 ? '+' : ''}${growthRate}% vs last period`,
            subColor: growthRate > 10 ? '#DC2626' : growthRate > 5 ? '#D97706' : '#059669',
            TrendIcon: growthRate > 0 ? TrendingUp : TrendingDown,
            trendColor: growthRate > 5 ? '#D97706' : '#059669',
            href: '/invoices' as string | null,
            cardBg: undefined as string | undefined,
            cardBorder: undefined as string | undefined,
            cardBorderTop: undefined as string | undefined,
            valueColor: undefined as string | undefined,
            valueFontSize: undefined as string | undefined,
          },
          {
            cardKey: 'nextmonth',
            label: 'Next Month Forecast',
            value: forecastLoading && !isDemoActive ? '—' : `$${nextMonthForecast.toLocaleString()}`,
            sub: `+9% projected · $${nextMonthBaseline.toLocaleString()} baseline`,
            subColor: '#D97706',
            TrendIcon: TrendingUp,
            trendColor: '#D97706',
            href: '/forecast' as string | null,
            cardBg: undefined as string | undefined,
            cardBorder: undefined as string | undefined,
            cardBorderTop: undefined as string | undefined,
            valueColor: undefined as string | undefined,
            valueFontSize: undefined as string | undefined,
          },
          {
            cardKey: '90day',
            label: '90-Day Forecast',
            value: forecastLoading ? '—' : `$${forecast90.toLocaleString()}`,
            sub: `${forecast?.confidence ?? 85}% confidence`,
            subColor: '#475569',
            TrendIcon: TrendingUp,
            trendColor: '#D97706',
            href: '/forecast' as string | null,
            cardBg: undefined as string | undefined,
            cardBorder: undefined as string | undefined,
            cardBorderTop: undefined as string | undefined,
            valueColor: undefined as string | undefined,
            valueFontSize: undefined as string | undefined,
          },
        ]).map((card: any) => {
          const { cardKey, label, value, sub, subColor, TrendIcon, trendColor, href, cardBg, cardBorder, cardBorderTop, valueColor, valueFontSize } = card
          const isHovered = hoveredCard === cardKey
          const content = (
            <div
              key={label}
              style={{ background: cardBg ?? '#fff', borderRadius: '14px', padding: '32px', border: isHovered ? '0.5px solid #7C3AED' : `0.5px solid ${cardBorder ?? '#e5e7eb'}`, ...(cardBorderTop ? { borderTop: cardBorderTop } : {}), transition: 'border-color 0.15s ease', cursor: 'pointer' }}
              onMouseEnter={() => setHoveredCard(cardKey)}
              onMouseLeave={() => setHoveredCard(null)}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>
                <span style={{ fontSize: 14, color: '#9ca3af', lineHeight: 1 }}>›</span>
              </div>
              <div style={{ fontSize: valueFontSize ?? '1.875rem', fontWeight: 700, color: valueColor ?? '#0F172A', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '10px' }}>{value}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <TrendIcon size={13} style={{ color: trendColor }} />
                <span style={{ fontSize: '0.78rem', color: subColor, lineHeight: 1.6 }}>{sub}</span>
              </div>
            </div>
          )
          return <Link key={label} href={href} style={{ textDecoration: 'none' }}>{content}</Link>
        })}
      </div>

      {/* NL SEARCH BAR / AI CO-PILOT */}
      {!isPro && (
        <div style={{
          marginBottom: '24px', background: '#F8FAFC', border: '1.5px dashed #CBD5E1',
          borderRadius: '12px', padding: '28px', textAlign: 'center',
        }}>
          <div style={{
            width: '40px', height: '40px', borderRadius: '10px', background: '#F5F3FF',
            display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px',
          }}>
            <Lock size={18} color="#7C3AED" />
          </div>
          <p style={{ fontSize: '0.9rem', fontWeight: 600, color: '#0F172A', margin: '0 0 6px' }}>Pro Plan Required</p>
          <p style={{ fontSize: '0.8rem', color: '#64748B', margin: '0 0 16px' }}>
            This feature is available on the Pro plan and above.
          </p>
          <a
            href="/settings/billing/upgrade"
            style={{
              display: 'inline-block', background: '#7C3AED', color: '#fff',
              padding: '8px 20px', borderRadius: '8px', fontSize: '0.8125rem',
              fontWeight: 600, textDecoration: 'none',
            }}
          >
            Upgrade to Pro
          </a>
        </div>
      )}
      {nlUpgradeBanner && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: '#FEF3C7', border: '1px solid #F59E0B', borderRadius: '10px',
          padding: '14px 20px', marginBottom: '16px', gap: '16px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '1.1rem' }}>⚠️</span>
            <span style={{ fontSize: '0.875rem', fontWeight: 500, color: '#92400E' }}>
              This feature requires the Pro plan.
            </span>
          </div>
          <a
            href="/settings/billing/upgrade"
            style={{
              flexShrink: 0, fontSize: '0.8125rem', fontWeight: 600,
              color: '#fff', background: '#D97706', borderRadius: '6px',
              padding: '7px 16px', textDecoration: 'none', whiteSpace: 'nowrap',
            }}
          >
            Upgrade to Pro
          </a>
        </div>
      )}
      <form onSubmit={handleNlQuery} style={{ marginBottom: '24px', display: isPro ? undefined : 'none' }}>
        <div style={{ position: 'relative' }}>
          <Search size={16} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: '#94A3B8', pointerEvents: 'none' }} />
          <input
            ref={inputRef}
            value={nlQuery}
            onChange={e => setNlQuery(e.target.value)}
            placeholder='Ask anything — "Show EC2 spend last 30 days" · "Which region costs the most?" · "Compare this month vs last"'
            style={{
              width: '100%',
              padding: '14px 120px 14px 44px',
              borderRadius: '12px',
              border: '1.5px solid #E2E8F0',
              fontSize: '0.875rem',
              color: '#0F172A',
              background: '#fff',
              outline: 'none',
              boxSizing: 'border-box',
              fontFamily: 'Inter, system-ui, sans-serif',
              lineHeight: 1.6,
            }}
          />
          <button
            type="submit"
            disabled={nlLoading}
            style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: '#7C3AED', color: '#fff', padding: '8px 18px', borderRadius: '8px', fontSize: '0.8rem', fontWeight: 600, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
            {nlLoading ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {nlLoading ? 'Analyzing...' : 'Ask AI'}
          </button>
        </div>

        {/* Quick-prompt chips */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '10px' }}>
          {['Why is EC2 cost high?', 'What can I optimize today?', 'Show biggest waste', 'Compare vs last month'].map(chip => (
            <button
              key={chip}
              type="button"
              onClick={() => { setNlQuery(chip); if (inputRef.current) inputRef.current.focus() }}
              style={{ fontSize: '11px', color: '#534AB7', background: '#EEEDFE', borderRadius: '100px', padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              {chip}
            </button>
          ))}
        </div>

        {/* AI insight preview — demo: static; real: replace with actual insight if available */}
        {isDemoActive && !nlResult && (
          <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#F9FAFB', borderLeft: '2px solid #534AB7', borderRadius: '0 8px 8px 0', padding: '12px 16px', gap: '16px' }}>
            <p style={{ fontSize: '0.8rem', color: '#475569', margin: 0, lineHeight: 1.5 }}>
              <strong style={{ color: '#0F172A' }}>AI insight:</strong> Your EC2 instances are 38% underutilized. 3 instances running at &lt;5% CPU for 21+ days.
            </p>
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#059669', flexShrink: 0 }}>$362/mo savings</span>
          </div>
        )}

        {nlResult && (
          <div style={{ marginTop: '12px', background: '#fff', border: '1px solid #DDD6FE', borderRadius: '12px', padding: '0', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ background: '#F5F3FF', padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '26px', height: '26px', borderRadius: '6px', background: '#7C3AED', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Sparkles size={12} style={{ color: '#fff' }} />
                </div>
                <div>
                  <p style={{ fontSize: '0.82rem', fontWeight: 600, color: '#0F172A', margin: 0 }}>{nlResult.intent.explanation}</p>
                  <p style={{ fontSize: '0.72rem', color: '#6D28D9', margin: 0 }}>
                    {nlResult.rowCount} result{nlResult.rowCount !== 1 ? 's' : ''} · {nlResult.executionMs}ms · Confidence: <strong>{nlResult.intent.confidence}</strong>
                  </p>
                </div>
              </div>
              <button onClick={() => setNlResult(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}>
                <X size={14} />
              </button>
            </div>

            {/* Summary bar */}
            <div style={{ padding: '10px 20px', borderBottom: '1px solid #F1F5F9', background: '#FAFAF9' }}>
              <p style={{ fontSize: '0.78rem', color: '#475569', margin: 0 }}>{nlResult.data.summary}</p>
            </div>

            {/* Results table */}
            {nlResult.data.rows.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                {/* Column headers */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${nlResult.data.columns.length}, 1fr)`,
                  padding: '10px 20px',
                  background: '#F8FAFC',
                  borderBottom: '1px solid #F1F5F9',
                }}>
                  {nlResult.data.columns.map(col => (
                    <span key={col} style={{ fontSize: '0.68rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{col}</span>
                  ))}
                </div>
                {/* Rows */}
                {nlResult.data.rows.map((row, idx) => (
                  <div key={idx} style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${nlResult.data.columns.length}, 1fr)`,
                    padding: '12px 20px',
                    borderBottom: idx < nlResult.data.rows.length - 1 ? '1px solid #F8FAFC' : 'none',
                    alignItems: 'center',
                  }}
                    onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = '#F8FAFC' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
                  >
                    {Object.values(row).slice(0, nlResult.data.columns.length).map((val: any, ci) => (
                      <span key={ci} style={{ fontSize: '0.8rem', color: '#0F172A', fontWeight: ci === 0 ? 600 : 400 }}>
                        {val instanceof Date
                          ? new Date(val).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                          : val === null || val === undefined ? '—'
                          : String(val)}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            )}

            {/* Empty state */}
            {nlResult.data.rows.length === 0 && (
              <div style={{ padding: '32px', textAlign: 'center' }}>
                <p style={{ fontSize: '0.875rem', color: '#64748B', margin: 0 }}>No data matched your query. Try rephrasing or check your AWS connection.</p>
              </div>
            )}
          </div>
        )}
        {nlError && (
          <p style={{ marginTop: '8px', fontSize: '0.8rem', color: '#D97706', padding: '0 4px' }}>{nlError}</p>
        )}
      </form>

      {/* SPEND TREND CHART — FIX 1: auto domain + smart tickFormatter */}
      <div style={{ background: '#fff', borderRadius: '16px', padding: '32px', border: '1px solid #F1F5F9', marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
          <div>
            <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#0F172A', margin: '0 0 4px', letterSpacing: '-0.01em' }}>Spend Trend</h2>
            <p style={{ fontSize: '0.8rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>Historical spend and AI forecast · Dashed line indicates prediction</p>
          </div>
          <div style={{ display: 'flex', background: '#F8FAFC', borderRadius: '8px', padding: '4px', gap: '2px' }}>
            {DATE_RANGES.map(({ label }) => (
              <button
                key={label}
                onClick={() => setSelectedRange(label)}
                style={{
                  padding: '6px 14px', borderRadius: '6px', fontSize: '0.78rem', fontWeight: 600,
                  border: 'none', cursor: 'pointer',
                  background: selectedRange === label ? '#fff' : 'transparent',
                  color: selectedRange === label ? '#0F172A' : '#475569',
                  boxShadow: selectedRange === label ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                  transition: 'all 0.15s',
                }}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Chart summary row */}
        <div style={{
          display: 'flex',
          gap: '32px',
          marginBottom: '20px',
          paddingBottom: '20px',
          borderBottom: '1px solid #F1F5F9',
        }}>
          {[
            { label: 'Current Run Rate', value: `$${mtdSpend.toLocaleString()}/mo`, color: '#0F172A' },
            { label: '90-Day Forecast',  value: `$${forecast90.toLocaleString()}`,  color: '#7C3AED' },
            { label: 'Growth Rate',      value: `${growthRate > 0 ? '+' : ''}${growthRate}%`, color: growthRate > 5 ? '#DC2626' : '#059669' },
            { label: 'Confidence',       value: `${forecast?.confidence ?? 85}%`,   color: '#475569' },
          ].map(({ label, value, color }) => (
            <div key={label}>
              <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 4px' }}>{label}</p>
              <p style={{ fontSize: '1.1rem', fontWeight: 700, color, margin: 0, letterSpacing: '-0.02em' }}>{value}</p>
            </div>
          ))}
        </div>

        {/* Top 3 cost drivers — quick callout */}
        <div style={{ display: 'flex', gap: '16px', marginBottom: '20px', paddingBottom: '16px', borderBottom: '1px solid #F1F5F9' }}>
          <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0, flexShrink: 0, alignSelf: 'center' }}>Top drivers</p>
          {[
            { name: 'Compute',  amount: isDemoActive ? 5200 : Math.round((mtdSpend || 0) * 0.63), color: '#3B82F6' },
            { name: 'Database', amount: isDemoActive ? 2400 : Math.round((mtdSpend || 0) * 0.10), color: '#8B5CF6' },
            { name: 'Storage',  amount: isDemoActive ? 3800 : Math.round((mtdSpend || 0) * 0.18), color: '#06B6D4' },
          ].map(({ name, amount, color }) => (
            <div key={name} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: color, flexShrink: 0 }} />
              <span style={{ fontSize: '0.78rem', color: '#475569' }}>{name}</span>
              <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#0F172A' }}>${amount.toLocaleString()}</span>
            </div>
          ))}
        </div>

{isDemoActive ? (
          /* Demo chart — pure static render, zero query dependencies */
          <div style={{ overflow: 'visible' }}>
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={DEMO_SPEND_DATA.slice(-Math.min(selectedDays, DEMO_SPEND_DATA.length))} margin={{ top: 28, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="demoActualGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="#0F172A" stopOpacity={0.12} />
                    <stop offset="100%" stopColor="#0F172A" stopOpacity={0.01} />
                  </linearGradient>
                  <linearGradient id="demoForecastGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="#7C3AED" stopOpacity={0.10} />
                    <stop offset="100%" stopColor="#7C3AED" stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="#F1F5F9" strokeDasharray="0" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: '#64748B', fontFamily: 'Inter, system-ui' }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#64748B', fontFamily: 'Inter, system-ui' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v}`}
                  width={56}
                  domain={[150, (dataMax: number) => Math.ceil(dataMax * 1.05)]}
                />
                <Tooltip
                  contentStyle={{
                    background: '#fff',
                    border: '1px solid #E2E8F0',
                    borderRadius: '10px',
                    fontSize: '0.8rem',
                    boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
                    padding: '10px 14px',
                  }}
                  labelStyle={{ fontWeight: 600, color: '#0F172A', marginBottom: '4px' }}
                  formatter={(value: number | string | (number | string)[] | undefined, name: string | undefined) => {
                    const display = typeof value === 'number' ? value.toLocaleString() : value != null ? String(value) : '—'
                    return [`$${display}/mo`, name === 'actual' ? 'Actual Spend' : 'AI Forecast']
                  }}
                />
                <Area type="monotone" dataKey="actual"   stroke="#0F172A" strokeWidth={2} fill="url(#demoActualGradient)"   dot={false} connectNulls={false} activeDot={{ r: 4, fill: '#0F172A', strokeWidth: 0 }} />
                <Area type="monotone" dataKey="forecast" stroke="#7C3AED" strokeWidth={2} fill="url(#demoForecastGradient)" dot={false} connectNulls={false} strokeDasharray="6 3" activeDot={{ r: 4, fill: '#7C3AED', strokeWidth: 0 }} />
                <ReferenceLine x="Apr 8"  stroke="#3B6D11" strokeDasharray="4 3" strokeWidth={1.5} ifOverflow="extendDomain" label={{ value: 'Apr 8 · Optimized', position: 'insideTopLeft' as const, fontSize: 9, fill: '#3B6D11' } as any} />
                <ReferenceLine x="Apr 14" stroke="#EF9F27" strokeDasharray="4 3" strokeWidth={1.5} ifOverflow="extendDomain" label={{ value: 'Apr 14 · EC2 idle',  position: 'insideTopLeft' as const, fontSize: 9, fill: '#854F0B' } as any} />
                <ReferenceLine x="Apr 18" stroke="#E24B4A" strokeDasharray="4 3" strokeWidth={1.5} ifOverflow="extendDomain" label={{ value: 'Apr 18 · Spike',      position: 'insideTopLeft' as const, fontSize: 9, fill: '#A32D2D' } as any} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          /* Real-data chart — unchanged */
          <>
            {forecastLoading ? (
              <div style={{ height: '280px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Loader2 size={20} style={{ color: '#94A3B8' }} />
              </div>
            ) : (
              <div style={{ overflow: 'visible' }}>
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={chartData} margin={{ top: 28, right: 8, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id="actualGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%"   stopColor="#0F172A" stopOpacity={0.12} />
                        <stop offset="100%" stopColor="#0F172A" stopOpacity={0.01} />
                      </linearGradient>
                      <linearGradient id="forecastGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%"   stopColor="#7C3AED" stopOpacity={0.10} />
                        <stop offset="100%" stopColor="#7C3AED" stopOpacity={0.01} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} stroke="#F1F5F9" strokeDasharray="0" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11, fill: '#64748B', fontFamily: 'Inter, system-ui' }}
                      axisLine={false}
                      tickLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: '#64748B', fontFamily: 'Inter, system-ui' }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v: number) => v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v}`}
                      width={56}
                      domain={[
                        (dataMin: number) => Math.max(0, Math.floor(dataMin * 0.85)),
                        (dataMax: number) => Math.ceil(dataMax * 1.15),
                      ]}
                    />
                    <Tooltip
                      contentStyle={{
                        background: '#fff',
                        border: '1px solid #E2E8F0',
                        borderRadius: '10px',
                        fontSize: '0.8rem',
                        boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
                        padding: '10px 14px',
                      }}
                      labelStyle={{ fontWeight: 600, color: '#0F172A', marginBottom: '4px' }}
                      formatter={(value: number | string | (number | string)[] | undefined, name: string | undefined) => {
                        const display = typeof value === 'number' ? value.toLocaleString() : value != null ? String(value) : '—'
                        return [`$${display}/mo`, name === 'actual' ? 'Actual Spend' : 'AI Forecast']
                      }}
                    />
                    <Area type="monotone" dataKey="actual"   stroke="#0F172A" strokeWidth={2} fill="url(#actualGradient)"   dot={false} connectNulls={false} activeDot={{ r: 4, fill: '#0F172A', strokeWidth: 0 }} />
                    <Area type="monotone" dataKey="forecast" stroke="#7C3AED" strokeWidth={2} fill="url(#forecastGradient)" dot={false} connectNulls={false} strokeDasharray="6 3" activeDot={{ r: 4, fill: '#7C3AED', strokeWidth: 0 }} />
                    {/* Baseline reference line */}
                    <ReferenceLine
                      y={mtdSpend}
                      stroke="#94A3B8"
                      strokeDasharray="4 3"
                      strokeWidth={1}
                      label={{
                        value: `$${mtdSpend}/mo baseline`,
                        position: 'insideTopRight',
                        fontSize: 10,
                        fill: '#94A3B8',
                      } as any}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </>
        )}

        {/* Chart legend */}
        <div style={{
          display: 'flex',
          gap: '24px',
          marginTop: '16px',
          paddingTop: '16px',
          borderTop: '1px solid #F1F5F9',
        }}>
          {[
            { color: '#0F172A', dash: false, label: 'Actual spend' },
            { color: '#7C3AED', dash: true,  label: 'AI forecast'  },
          ].map(({ color, dash, label }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <svg width="24" height="2" style={{ flexShrink: 0 }}>
                <line
                  x1="0" y1="1" x2="24" y2="1"
                  stroke={color}
                  strokeWidth="2"
                  strokeDasharray={dash ? '5 3' : '0'}
                />
              </svg>
              <span style={{ fontSize: '0.75rem', color: '#475569', fontWeight: 500 }}>{label}</span>
            </div>
          ))}
          <span style={{ fontSize: '0.75rem', color: '#94A3B8', marginLeft: 'auto' }}>
            Values shown as monthly equivalent
          </span>
        </div>
      </div>

      {/* COST BY SERVICE + TOP SAVINGS */}
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: '24px', marginBottom: '20px' }}>

        {/* Cost by Service */}
        <div style={{ background: '#fff', borderRadius: '16px', padding: '32px', border: '1px solid #F1F5F9' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#0F172A', margin: 0, letterSpacing: '-0.01em' }}>Cost by Service</h2>
            <a href="/cost-optimization" style={{ fontSize: '0.78rem', fontWeight: 600, color: '#7C3AED', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}>
              Full breakdown <ChevronRight size={13} />
            </a>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {serviceBreakdown.map(({ name, amount, pct, trend, up }) => {
              const totalServiceSpend = serviceBreakdown.reduce((sum, s) => sum + s.amount, 0)
              const pctOfTotal = totalServiceSpend > 0 ? Math.round((amount / totalServiceSpend) * 100) : pct
              const isCompute = name.startsWith('Compute')
              const isDatabase = name.startsWith('Database')
              const savingsFlag = isCompute
                ? '⚠ $362 savings available · Underloaded EC2'
                : isDatabase
                ? '⚠ $1,335 savings via reserved pricing'
                : null
              return (
                <div key={name}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: SERVICE_COLORS[name] ?? '#94A3B8', flexShrink: 0 }} />
                      <span style={{ fontSize: '0.82rem', color: '#1E293B', fontWeight: 500 }}>{name}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span style={{ fontSize: '0.72rem', color: '#94A3B8', fontWeight: 500 }}>{pctOfTotal}%</span>
                      <span style={{ fontSize: '0.78rem', fontWeight: 500, color: up ? '#D97706' : '#059669' }}>{trend}</span>
                      <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', minWidth: '72px', textAlign: 'right' }}>${amount.toLocaleString()}</span>
                    </div>
                  </div>
                  <div style={{ height: '5px', background: '#F1F5F9', borderRadius: '100px' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: SERVICE_COLORS[name] ?? '#94A3B8', borderRadius: '100px', transition: 'width 0.6s ease' }} />
                  </div>
                  {savingsFlag && (
                    <p style={{ fontSize: '0.72rem', color: '#D97706', margin: '4px 0 0', fontWeight: 500 }}>{savingsFlag}</p>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Top Savings Opportunities */}
        <div style={{ background: '#fff', borderRadius: '12px', padding: '32px', border: '1px solid #BBF7D0', borderTop: '3px solid #059669' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
            <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#059669', margin: 0, letterSpacing: '-0.01em' }}>Top Savings</h2>
            <a href="/cost-optimization" style={{ fontSize: '0.78rem', fontWeight: 600, color: '#7C3AED', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}>
              View all <ChevronRight size={13} />
            </a>
          </div>

          {/* Confidence summary */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
            <div>
              <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 3px' }}>Optimization Confidence</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ flex: 1, height: '4px', background: '#F1F5F9', borderRadius: '100px', width: '120px' }}>
                  <div style={{ width: '94%', height: '100%', background: '#059669', borderRadius: '100px' }} />
                </div>
                <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#059669' }}>94%</span>
              </div>
            </div>
            <span style={{ fontSize: '0.72rem', color: '#059669', fontWeight: 600, background: '#F0FDF4', padding: '3px 10px', borderRadius: '100px', border: '1px solid #BBF7D0' }}>
              Safe to apply
            </span>
          </div>

          <div style={{ background: '#F0FDF4', borderRadius: '10px', padding: '16px 20px', marginBottom: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#059669', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 4px' }}>Total Identified</p>
              <p style={{ fontSize: '1.75rem', fontWeight: 800, color: '#059669', margin: 0, letterSpacing: '-0.02em' }}>${displaySavings.toLocaleString()}<span style={{ fontSize: '0.875rem', fontWeight: 500 }}>/mo</span></p>
            </div>
            <div style={{ textAlign: 'center' }}>
              <a href="/cost-optimization" style={{ background: '#059669', color: '#fff', padding: '10px 18px', borderRadius: '9px', fontSize: '0.875rem', fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap', display: 'inline-block' }}>
                Approve all — safe changes only
              </a>
              <p style={{ fontSize: '0.7rem', color: '#059669', margin: '4px 0 0', fontWeight: 500 }}>No downtime risk · Fully reversible</p>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {topRecs.length > 0 ? topRecs.map((rec) => (
              <div key={rec.id} style={{ padding: '14px 16px', background: '#F8FAFC', borderRadius: '10px', border: '1px solid #F1F5F9' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px', marginBottom: '6px' }}>
                  <p style={{ fontSize: '0.82rem', fontWeight: 500, color: '#0F172A', margin: 0, lineHeight: 1.5 }}>{rec.title}</p>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#059669', flexShrink: 0 }}>
                    ${rec.monthlySavings.toLocaleString()}/mo
                  </span>
                </div>
                <span style={{
                  fontSize: '0.7rem', fontWeight: 600, padding: '2px 8px', borderRadius: '100px',
                  background: rec.risk === 'safe' ? '#F0FDF4' : rec.risk === 'caution' ? '#FFFBEB' : '#FEF2F2',
                  color: rec.risk === 'safe' ? '#059669' : rec.risk === 'caution' ? '#D97706' : '#DC2626',
                }}>
                  {rec.risk === 'safe' ? 'Zero Risk' : rec.risk === 'caution' ? 'Low Risk' : 'Review Required'}
                </span>
              </div>
            )) : (
              [
                { title: 'RDS Reserved Instance Pricing', savings: 890, risk: 'safe' as const },
                { title: 'Idle RDS Instances',            savings: 445, risk: 'safe' as const },
                { title: 'Underloaded EC2 Instances',     savings: 362, risk: 'caution' as const },
              ].map(item => (
                <div key={item.title} style={{ padding: '14px 16px', background: '#F8FAFC', borderRadius: '10px', border: '1px solid #F1F5F9' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px', marginBottom: '6px' }}>
                    <p style={{ fontSize: '0.82rem', fontWeight: 500, color: '#0F172A', margin: 0, lineHeight: 1.5 }}>{item.title}</p>
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#059669', flexShrink: 0 }}>${item.savings}/mo</span>
                  </div>
                  <span style={{ fontSize: '0.7rem', fontWeight: 600, padding: '2px 8px', borderRadius: '100px', background: item.risk === 'safe' ? '#F0FDF4' : '#FFFBEB', color: item.risk === 'safe' ? '#059669' : '#D97706' }}>
                    {item.risk === 'safe' ? 'Zero Risk' : 'Low Risk'}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* DEVCONTROL VALUE DELIVERED */}
      <div style={{ background: '#F9FAFB', borderRadius: '16px', padding: '32px', border: '1px solid #F1F5F9', marginBottom: '16px' }}>
        <p style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 20px' }}>DevControl value delivered</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '16px' }}>
          {[
            { label: 'Saved this year',        value: '$23,400' },
            { label: 'Optimizations applied',  value: '27' },
            { label: 'Efficiency score',        value: '100%', note: '↑ from 72%' },
            { label: 'Anomalies caught',        value: '14' },
            { label: 'Monthly ROI',             value: '47×' },
            { label: 'Policies running',        value: '3' },
            // TODO: wire to stats API in real mode
          ].map(({ label, value, note }) => (
            <div key={label} style={{ background: '#fff', borderRadius: '10px', padding: '16px', border: '1px solid #F1F5F9' }}>
              <p style={{ fontSize: '0.68rem', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 6px' }}>{label}</p>
              <p style={{ fontSize: '1.25rem', fontWeight: 700, color: '#0F172A', margin: 0, letterSpacing: '-0.02em', lineHeight: 1 }}>{value}</p>
              {note && <p style={{ fontSize: '0.7rem', color: '#059669', margin: '4px 0 0', fontWeight: 500 }}>{note}</p>}
            </div>
          ))}
        </div>
      </div>

      {/* AI COST NARRATIVE — FIX 2: stripMarkdown applied to each recommendation */}
      {forecast?.aiSummary && (
        <div style={{ background: '#fff', borderRadius: '16px', padding: '32px', border: '0.5px solid #E5E7EB', borderLeft: '3px solid #534AB7' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
            <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: '#7C3AED', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Sparkles size={16} style={{ color: '#fff' }} />
            </div>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#7C3AED', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 8px' }}>
                AI Cost Narrative
              </p>
              <p style={{
                fontSize: '0.875rem',
                color: '#0F172A',
                lineHeight: 1.7,
                margin: '0 0 12px',
              }}>
                {narrativeExpanded
                  ? forecast.aiSummary
                  : forecast.aiSummary.split(/\.\s+/)[0] + '.'}
              </p>
              <button
                onClick={() => setNarrativeExpanded(!narrativeExpanded)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  color: '#7C3AED',
                  cursor: 'pointer',
                  padding: 0,
                  marginBottom: narrativeExpanded ? '16px' : 0,
                }}
              >
                {narrativeExpanded ? 'Show less ↑' : 'Read full analysis →'}
              </button>
              {narrativeExpanded && (forecast.aiRecommendations?.length ?? 0) > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {forecast.aiRecommendations.slice(0, 3).map((rec, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                      <span style={{ color: '#7C3AED', fontWeight: 700, flexShrink: 0, marginTop: '1px' }}>→</span>
                      <span style={{ fontSize: '0.875rem', color: '#475569', lineHeight: 1.6 }}>{stripMarkdown(rec)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <a href="/forecast" style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', fontWeight: 600, color: '#7C3AED', textDecoration: 'none', flexShrink: 0 }}>
              Full forecast <ArrowRight size={13} />
            </a>
          </div>
        </div>
      )}

    </div>
  )
}
