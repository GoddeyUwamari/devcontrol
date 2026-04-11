'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from 'recharts'
import {
  Shield, AlertTriangle, CheckSquare, ClipboardList,
  ArrowRight, ChevronRight, Loader2, RefreshCw,
  TrendingUp, TrendingDown, Check,
} from 'lucide-react'
import { useCurrentRiskScore, useRiskScoreTrend } from '@/lib/hooks/useRiskScore'
import { useComplianceFrameworks } from '@/lib/hooks/useComplianceFrameworks'
import { anomalyService } from '@/lib/services/anomaly.service'
import { demoModeService } from '@/lib/services/demo-mode.service'
import type { AnomalyDetection } from '@/types/anomaly.types'

type FrameworkDisplay = { id: string; name: string; complianceScore: number; status: 'passing' | 'in_progress' | 'failing' }

const FALLBACK_FRAMEWORKS: FrameworkDisplay[] = [
  { id: '1', name: 'CIS AWS Benchmark', complianceScore: 87, status: 'passing' },
  { id: '2', name: 'SOC 2 Type II',      complianceScore: 74, status: 'in_progress' },
  { id: '3', name: 'NIST CSF',           complianceScore: 91, status: 'passing' },
  { id: '4', name: 'PCI-DSS',            complianceScore: 68, status: 'failing' },
]

const FALLBACK_ANOMALIES: AnomalyDetection[] = [
  { id: '1', organizationId: 'demo', type: 'cpu_spike', severity: 'critical', resourceName: 'production-worker', resourceType: 'EC2', metric: 'cpu', currentValue: 92, expectedValue: 45, deviation: 104, historicalAverage: 45, historicalStdDev: 5, detectedAt: new Date(), timeWindow: '1h', title: 'Unusual IAM activity detected', description: '', aiExplanation: '', impact: '', recommendation: '', confidence: 95, status: 'active' },
  { id: '2', organizationId: 'demo', type: 'cost_spike', severity: 'warning', resourceName: 'old-backup-bucket', resourceType: 'S3', metric: 'cost', currentValue: 45, expectedValue: 20, deviation: 125, historicalAverage: 20, historicalStdDev: 3, detectedAt: new Date(), timeWindow: '24h', title: 'S3 bucket public access enabled', description: '', aiExplanation: '', impact: '', recommendation: '', confidence: 88, status: 'active' },
  { id: '3', organizationId: 'demo', type: 'error_rate_spike', severity: 'info', resourceName: 'auth-service', resourceType: 'Lambda', metric: 'errors', currentValue: 120, expectedValue: 40, deviation: 200, historicalAverage: 40, historicalStdDev: 8, detectedAt: new Date(), timeWindow: '1h', title: 'Failed login attempts spike', description: '', aiExplanation: '', impact: '', recommendation: '', confidence: 72, status: 'active' },
]

const actionMap: Record<string, { statement: string; link: string }> = {
  'Public Access':       { statement: 'Public access exposed — remediate now',  link: '/security/public-access' },
  'Resource Management': { statement: 'Resource management gaps detected',      link: '/security/resources' },
  'Encryption':          { statement: 'Encryption coverage incomplete',         link: '/security/encryption' },
  'Backup Coverage':     { statement: 'Backup coverage below threshold',        link: '/security/backup' },
  'Compliance':          { statement: 'Compliance checks failing',              link: '/compliance/frameworks' },
}

const severityColor = (s: AnomalyDetection['severity']) => s === 'critical' ? '#DC2626' : s === 'warning' ? '#D97706' : '#64748B'
const severityBadgeBg = (s: AnomalyDetection['severity']) => s === 'critical' ? '#FEE2E2' : s === 'warning' ? '#FDE68A' : '#F1F5F9'

export default function SecurityPage() {
  const [acknowledging, setAcknowledging] = useState<string | null>(null)
  const demoMode = demoModeService.isEnabled()

  const { data: riskScore, isLoading: riskLoading } = useCurrentRiskScore(!demoMode)
  const { data: riskTrend, isLoading: trendLoading } = useRiskScoreTrend('30d', !demoMode)
  const { frameworks, loading: frameworksLoading } = useComplianceFrameworks()

  const { data: anomalyData, isLoading: anomalyLoading, refetch: refetchAnomalies } = useQuery({
    queryKey: ['anomalies', 'active'],
    queryFn: () => anomalyService.getAnomalies('active'),
    staleTime: 2 * 60 * 1000,
  })

  const { data: anomalyStats } = useQuery({
    queryKey: ['anomaly-stats'],
    queryFn: () => anomalyService.getStats(),
    staleTime: 2 * 60 * 1000,
  })

  const score = riskScore?.score ?? 87
  const scoreLabel = score >= 90 ? 'Excellent' : score >= 80 ? 'Good' : score >= 70 ? 'Fair' : 'At Risk'
  const scoreColor = score >= 80 ? '#059669' : score >= 70 ? '#D97706' : '#DC2626'
  const activeAnomalies = anomalyStats?.active || anomalyData?.anomalies?.length || 0
  const criticalAnomalies = anomalyData?.anomalies?.filter((a: AnomalyDetection) => a.severity === 'critical' && a.status === 'active').length ?? 0

  const displayFrameworks: FrameworkDisplay[] = frameworks.length > 0
    ? frameworks.slice(0, 4).map((f) => ({ id: f.id, name: f.name, complianceScore: f.enabled ? 80 : 55, status: f.enabled ? 'passing' : 'failing' }))
    : FALLBACK_FRAMEWORKS

  const passingFrameworks = displayFrameworks.filter((f) => f.status === 'passing').length
  const failingFrameworks = displayFrameworks.filter((f) => f.status === 'failing').length
  const totalFrameworks = displayFrameworks.length || 4

  const trendDirection = riskTrend?.trend ?? 'stable'
  const trendPct = riskTrend?.trendPercentage ?? 5
  const TrendIcon = trendDirection === 'declining' ? TrendingDown : TrendingUp
  const trendColor = trendDirection === 'declining' ? '#DC2626' : '#059669'
  const trendLabel = trendDirection === 'declining' ? `-${trendPct} pts this month` : `+${trendPct} pts this month`

  const chartData = riskTrend?.history?.map((point) => ({
    date: new Date(point.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    score: point.score,
  })) ?? Array.from({ length: 30 }, (_, i) => ({
    date: new Date(Date.now() - (29 - i) * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    score: 82 + Math.round(Math.sin(i / 5) * 4 + (i / 30) * 5),
  }))

  const riskFactors: { label: string; score: number; status: 'Pass' | 'Warning' }[] = riskScore?.factors
    ? [
        { label: 'Encryption',         score: riskScore.factors.encryption,         status: riskScore.factors.encryption >= 80 ? 'Pass' : 'Warning' },
        { label: 'Public Access',       score: riskScore.factors.publicAccess,       status: riskScore.factors.publicAccess >= 80 ? 'Pass' : 'Warning' },
        { label: 'Backup Coverage',     score: riskScore.factors.backup,             status: riskScore.factors.backup >= 80 ? 'Pass' : 'Warning' },
        { label: 'Compliance',          score: riskScore.factors.compliance,         status: riskScore.factors.compliance >= 80 ? 'Pass' : 'Warning' },
        { label: 'Resource Management', score: riskScore.factors.resourceManagement, status: riskScore.factors.resourceManagement >= 80 ? 'Pass' : 'Warning' },
      ]
    : [
        { label: 'Encryption',         score: 95, status: 'Pass' },
        { label: 'Public Access',       score: 78, status: 'Warning' },
        { label: 'Backup Coverage',     score: 88, status: 'Pass' },
        { label: 'Compliance',          score: 92, status: 'Pass' },
        { label: 'Resource Management', score: 71, status: 'Warning' },
      ]

  const topAnomalies = anomalyData?.anomalies?.slice(0, 3) ?? FALLBACK_ANOMALIES

  const navCards = [
    { icon: AlertTriangle, label: 'All Anomalies', desc: criticalAnomalies > 0 ? `${criticalAnomalies} critical — investigate now` : 'Investigate and resolve threats', href: '/anomalies', color: criticalAnomalies > 0 ? '#DC2626' : '#D97706', bg: criticalAnomalies > 0 ? '#FEF2F2' : '#FFFBEB' },
    { icon: CheckSquare,   label: 'Compliance',    desc: failingFrameworks > 0 ? `${failingFrameworks} framework${failingFrameworks > 1 ? 's' : ''} failing — remediate now` : 'CIS, NIST, SOC 2, PCI-DSS', href: '/compliance/frameworks', color: failingFrameworks > 0 ? '#DC2626' : '#059669', bg: failingFrameworks > 0 ? '#FEF2F2' : '#F0FDF4' },
    { icon: ClipboardList, label: 'Audit Logs',    desc: 'Full activity trail', href: '/audit-logs', color: '#7C3AED', bg: '#F5F3FF' },
  ]

  const handleAcknowledge = async (id: string) => {
    setAcknowledging(id)
    try { await anomalyService.acknowledge(id); refetchAnomalies() }
    catch (e) { console.error('Failed to acknowledge:', e) }
    finally { setAcknowledging(null) }
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 max-w-[1320px] mx-auto">

      {/* ── PAGE HEADER ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-8">
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-1.5">
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">Security Command Center</h1>
            {demoMode && <span className="text-[10px] font-semibold bg-amber-50 text-amber-600 border border-amber-200 px-3 py-0.5 rounded-full uppercase tracking-widest">Demo Mode</span>}
          </div>
          <p className="text-sm text-slate-500 leading-relaxed">Security posture, anomaly detection, compliance frameworks, and audit trail</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={async () => { try { await anomalyService.triggerScan(); await refetchAnomalies() } catch (e) { console.error('Scan failed:', e) } }}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white px-4 py-2.5 rounded-lg text-sm font-semibold border-none cursor-pointer transition-colors whitespace-nowrap">
            <RefreshCw size={14} /> Run Scan
          </button>
          <a href="/anomalies" className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white px-4 py-2.5 rounded-lg text-sm font-semibold no-underline transition-colors whitespace-nowrap">
            <Shield size={14} /> View All Threats
          </a>
        </div>
      </div>

      {/* ── CRITICAL BANNER ── */}
      {criticalAnomalies > 0 && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-4 sm:px-5 py-3.5 mb-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle size={15} className="text-red-600 shrink-0 mt-0.5" />
            <div>
              <span className="text-sm font-semibold text-red-600">{criticalAnomalies} critical risk{criticalAnomalies !== 1 ? 's' : ''} impacting user-facing services (us-east-1)</span>
              <p className="text-xs text-red-800 font-medium mt-0.5">Critical service degradation — immediate action required</p>
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <a href="/anomalies" className="text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg px-3.5 py-2 no-underline transition-colors">Fix issues →</a>
            <a href="/anomalies" className="bg-white text-slate-500 border border-slate-200 rounded-lg px-3.5 py-2 text-xs font-medium no-underline hover:bg-slate-50 transition-colors">Investigate</a>
          </div>
        </div>
      )}

      {/* ── TOP RISK CARD ── */}
      {(() => {
        const topRisk = topAnomalies.find(a => a.severity === 'critical' && a.status === 'active') ?? topAnomalies[0]
        if (!criticalAnomalies || !topRisk) return null
        const rt = topRisk.resourceType ?? 'Service'
        const d = Math.round(Math.abs(topRisk.deviation ?? 0))
        return (
          <div className="bg-white border border-red-100 rounded-xl p-5 sm:p-7 mb-7">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="w-2 h-2 rounded-full bg-red-600 shrink-0" />
              <span className="text-[10px] font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded-full">ACT NOW</span>
              <span className="text-xs text-slate-400">Highest priority risk</span>
              <span className="ml-auto text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded flex items-center gap-1">⚠ Unassigned</span>
            </div>
            <div className="flex flex-col sm:flex-row items-start gap-5">
              <div className="flex-1">
                <p className="text-lg font-bold text-slate-900 mb-1.5">
                  {rt.toLowerCase().includes('ec2') ? `${rt} latency risk — CPU saturation (${Math.round(topRisk.currentValue ?? 88)}%)` : rt.toLowerCase().includes('lambda') ? `${rt} throttling risk — concurrency saturation (+${d}%)` : `${rt} anomaly — +${d}% deviation`}
                </p>
                <div className="flex flex-wrap gap-2 text-[10px] text-slate-400 mb-3">
                  <span>{topRisk.resourceType ?? '—'}</span><span>·</span><span>{topRisk.resourceName ?? '—'}</span><span>·</span><span>us-east-1</span>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3 flex items-center gap-2 text-xs text-amber-800">
                  <AlertTriangle size={11} className="text-amber-500 shrink-0" />
                  <span><strong>Impact:</strong> {rt.toLowerCase().includes('ec2') ? `+${d > 50 ? Math.round(d * 0.3) : 35}% latency → user-facing degradation` : `+${d}% above normal — service impact likely`}</span>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 mb-3">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Root Cause</p>
                  {[rt.toLowerCase().includes('ec2') ? 'Traffic spike or under-provisioned EC2' : 'Invocation surge exceeding concurrency limits', rt.toLowerCase().includes('ec2') ? 'CPU sustained >80% → throttling risk' : `+${d}% above normal → cost + latency impact`].map((bullet, i) => (
                    <div key={i} className="flex items-start gap-2 mb-1 last:mb-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-violet-600 shrink-0 mt-1.5" />
                      <span className="text-xs text-slate-600 leading-relaxed">{bullet}</span>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span className="font-semibold text-green-600">High confidence</span>
                  <span className="text-slate-300">|</span>
                  <span>Deviation: <span className="font-semibold text-red-600">+{d}%</span></span>
                  <span className="text-slate-300">|</span>
                  <span>Medium effort · No downtime</span>
                </div>
              </div>
              <div className="flex sm:flex-col gap-2 shrink-0 w-full sm:w-32">
                <a href="/anomalies" className="flex-1 sm:flex-none bg-green-600 hover:bg-green-700 text-white rounded-lg px-3.5 py-2.5 text-xs font-semibold no-underline text-center transition-colors">Apply fix →</a>
                <a href="/anomalies" className="flex-1 sm:flex-none bg-white text-slate-500 border border-slate-200 rounded-lg px-3.5 py-2.5 text-xs font-medium no-underline text-center hover:bg-slate-50 transition-colors">Investigate</a>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── 3 KPI CARDS ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-7">
        <div className="bg-white rounded-xl p-5 border border-slate-100 border-t-[3px] border-t-violet-600">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-3">Security Score</p>
          {riskLoading ? <Loader2 size={18} className="text-slate-300" /> : (
            <>
              <div className="flex items-end gap-1 mb-2">
                <span className="text-3xl font-bold text-slate-900 tracking-tight leading-none">{score}</span>
                <span className="text-lg text-slate-400 mb-0.5">/100</span>
              </div>
              <span className="text-xs font-semibold" style={{ color: scoreColor }}>{scoreLabel}</span>
              <span className={`block text-xs mt-0.5 ${(criticalAnomalies > 0 || activeAnomalies > 0) ? 'text-red-600 font-semibold' : 'text-slate-400'}`}>
                {(criticalAnomalies > 0 || activeAnomalies > 0) ? 'Unstable — active critical risks' : 'Above benchmark'}
              </span>
            </>
          )}
        </div>
        <div className={`bg-white rounded-xl p-5 border ${criticalAnomalies > 0 ? 'border-red-100' : 'border-slate-100'}`}>
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-3">Active Anomalies</p>
          {anomalyLoading ? <Loader2 size={18} className="text-slate-300" /> : (
            <>
              <div className="flex items-end gap-2 mb-2">
                <span className="text-3xl font-bold text-slate-900 tracking-tight leading-none">{activeAnomalies}</span>
                <span className={`w-2 h-2 rounded-full mb-1.5 shrink-0 ${activeAnomalies > 5 ? 'bg-red-500' : activeAnomalies > 0 ? 'bg-amber-500' : 'bg-green-500'}`} />
              </div>
              <div className="flex items-center gap-1.5">
                {criticalAnomalies > 0
                  ? <><AlertTriangle size={12} className="text-red-600" /><span className="text-xs text-red-600 font-semibold">{criticalAnomalies} critical need attention</span></>
                  : <><Check size={12} className="text-green-600" /><span className="text-xs text-slate-400">No critical threats</span></>}
              </div>
            </>
          )}
        </div>
        <div className="bg-white rounded-xl p-5 border border-slate-100">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-3">Compliance Status</p>
          {frameworksLoading ? <Loader2 size={18} className="text-slate-300" /> : (
            <>
              <div className="flex items-end gap-1 mb-2">
                <span className="text-3xl font-bold text-slate-900 tracking-tight leading-none">{passingFrameworks}</span>
                <span className="text-lg text-slate-400 mb-0.5">/{totalFrameworks}</span>
              </div>
              <div className="flex items-center gap-1.5">
                {failingFrameworks > 0
                  ? <><AlertTriangle size={12} className="text-red-600" /><span className="text-xs text-red-600 font-semibold">{failingFrameworks} framework{failingFrameworks > 1 ? 's' : ''} failing</span></>
                  : <><CheckSquare size={12} className="text-green-600" /><span className="text-xs text-slate-400">All frameworks passing</span></>}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── RISK TREND + SECURITY GAPS ── */}
      <div className="grid grid-cols-1 sm:grid-cols-[3fr_2fr] gap-5 mb-7">
        <div className="bg-white rounded-xl p-5 sm:p-8 border border-slate-100">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-6">
            <div>
              <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1">Security Score Trend</h2>
              <p className="text-xs text-slate-400 leading-relaxed">30-day posture history</p>
            </div>
            <div className="flex items-center gap-1.5">
              <TrendIcon size={13} style={{ color: trendColor }} />
              <span className="text-xs font-semibold" style={{ color: trendColor }}>{trendLabel}</span>
            </div>
          </div>
          {trendLoading ? (
            <div className="h-44 flex items-center justify-center"><Loader2 size={18} className="text-slate-300" /></div>
          ) : (chartData.length === 0 || chartData.every(d => d.score === chartData[0].score)) ? (
            <div className="h-44 flex flex-col items-center justify-center gap-2 bg-slate-50 rounded-xl">
              <p className="text-sm font-medium text-slate-500">Security posture stable</p>
              <p className="text-xs text-slate-400">No significant changes · Score: {score}/100</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="scoreGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#059669" stopOpacity={0.1} />
                    <stop offset="95%" stopColor="#059669" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="#F1F5F9" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94A3B8' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis domain={[60, 100]} tick={{ fontSize: 10, fill: '#94A3B8' }} axisLine={false} tickLine={false} width={28} />
                <Tooltip contentStyle={{ background: '#fff', border: '1px solid #F1F5F9', borderRadius: '8px', fontSize: '0.75rem' }} formatter={(v: any) => [`${v}/100`, 'Security Score']} />
                <Area type="monotone" dataKey="score" stroke="#059669" strokeWidth={2} fill="url(#scoreGradient)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-white rounded-xl p-5 sm:p-8 border border-slate-100">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-5">Top Security Gaps</h2>
          <div className="flex flex-col gap-4">
            {riskFactors.filter(rf => rf.status === 'Warning').sort((a, b) => a.score - b.score).map(({ label, score: s }) => (
              <div key={label}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-amber-500 font-semibold">{actionMap[label]?.statement ?? label}</span>
                  <a href={actionMap[label]?.link ?? '/security'} className="text-[10px] font-semibold text-violet-600 no-underline">Review →</a>
                </div>
                <div className="h-1 bg-slate-100 rounded-full">
                  <div className="h-full rounded-full bg-amber-500 transition-all duration-500" style={{ width: `${s}%` }} />
                </div>
              </div>
            ))}
            {riskFactors.filter(rf => rf.status === 'Warning').length === 0 && (
              <div className="py-5 text-center"><p className="text-xs text-green-600 font-medium">All security checks passing</p></div>
            )}
          </div>
        </div>
      </div>

      {/* ── ANOMALIES + COMPLIANCE ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-7">
        {/* Active Anomalies */}
        <div className="bg-white rounded-xl p-5 border border-slate-100">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Active Anomalies</h2>
            <a href="/anomalies" className="text-xs font-semibold text-violet-600 no-underline flex items-center gap-1">View all <ChevronRight size={12} /></a>
          </div>
          <div className="flex flex-col gap-3">
            {topAnomalies.map((anomaly) => {
              const rt = anomaly.resourceType ?? ''
              const d = Math.round(Math.abs(anomaly.deviation ?? 0))
              const t = anomaly.title ?? ''
              const riskTitle = (() => {
                if (t.toLowerCase().includes('cpu') || rt.toLowerCase().includes('ec2')) return `${rt || 'EC2'} latency risk — CPU saturation`
                if (t.toLowerCase().includes('lambda') || t.toLowerCase().includes('invocation')) return `${rt || 'Lambda'} throttling risk — concurrency spike`
                if (t.toLowerCase().includes('cost') || rt.toLowerCase().includes('s3')) return `Cost spike — ${rt || 'resource'} overspend`
                if (t.toLowerCase().includes('iam') || t.toLowerCase().includes('login') || t.toLowerCase().includes('auth')) return `Identity risk — ${t}`
                return t
              })()
              const miniImpact = anomaly.severity === 'critical' ? 'User-facing degradation risk' : d > 50 ? `+${d}% above normal — monitor now` : `${rt || 'Service'} performance degraded`
              return (
                <div key={anomaly.id} className="bg-slate-50 border border-slate-100 rounded-xl p-3.5">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-start gap-2.5">
                      <div className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: severityColor(anomaly.severity) }} />
                      <div>
                        <p className="text-sm font-semibold text-slate-900 mb-0.5 leading-snug">{riskTitle}</p>
                        <span className="text-[10px] text-slate-400">{anomaly.resourceType ?? '—'}{anomaly.resourceName ? ` · ${anomaly.resourceName}` : ''} · us-east-1</span>
                      </div>
                    </div>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 capitalize" style={{ background: severityBadgeBg(anomaly.severity), color: severityColor(anomaly.severity) }}>{anomaly.severity}</span>
                  </div>
                  <p className="text-xs text-amber-500 font-medium mb-2.5 pl-4">{miniImpact}</p>
                  <div className="flex gap-2">
                    <a href="/anomalies" className="bg-green-600 hover:bg-green-700 text-white rounded-lg px-3 py-1.5 text-[10px] font-semibold no-underline transition-colors">Apply fix →</a>
                    <a href="/anomalies" className="bg-white text-slate-500 border border-slate-200 rounded-lg px-3 py-1.5 text-[10px] font-medium no-underline hover:bg-slate-50 transition-colors">Investigate</a>
                  </div>
                </div>
              )
            })}
            {topAnomalies.length === 0 && (
              <div className="text-center py-8">
                <Check size={22} className="text-green-500 mx-auto mb-2" />
                <p className="text-sm text-slate-400">No active anomalies · System is secure</p>
              </div>
            )}
          </div>
        </div>

        {/* Compliance Frameworks */}
        <div className="bg-white rounded-xl p-5 border border-slate-100">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Compliance Frameworks</h2>
            <a href="/compliance/frameworks" className="text-xs font-semibold text-violet-600 no-underline flex items-center gap-1">Manage <ChevronRight size={12} /></a>
          </div>
          <div className="flex flex-col gap-3">
            {displayFrameworks.map((f) => {
              const pct = f.complianceScore
              const passing = f.status === 'passing', failing = f.status === 'failing'
              const statusColor = passing ? '#059669' : failing ? '#DC2626' : '#D97706'
              const statusBg = passing ? '#F0FDF4' : failing ? '#FEF2F2' : '#FFFBEB'
              const statusLabel = passing ? 'Passing' : failing ? 'Failing' : 'In Progress'
              return (
                <div key={f.id} className={`rounded-xl p-3.5 border ${failing ? 'bg-red-50 border-red-100' : 'bg-slate-50 border-slate-100'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-slate-900">{f.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold" style={{ color: statusColor }}>{pct}%</span>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: statusBg, color: statusColor }}>{statusLabel}</span>
                    </div>
                  </div>
                  {failing && <p className="text-[10px] text-red-600 font-medium mb-2">Blocking compliance readiness</p>}
                  <div className="h-1 bg-slate-200 rounded-full">
                    <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: statusColor }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* ── QUICK NAVIGATION ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {navCards.map(({ icon: Icon, label, desc, href, color, bg }) => (
          <a key={href} href={href} className="no-underline group">
            <div className="bg-white rounded-xl p-5 sm:p-6 border border-slate-100 flex items-center gap-4 cursor-pointer hover:border-slate-300 hover:shadow-sm transition-all">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: bg }}>
                <Icon size={17} style={{ color }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-900 mb-0.5">{label}</p>
                <p className="text-xs leading-relaxed font-medium truncate" style={{ color }}>{desc}</p>
              </div>
              <ArrowRight size={14} className="text-slate-300 shrink-0" />
            </div>
          </a>
        ))}
      </div>
    </div>
  )
}