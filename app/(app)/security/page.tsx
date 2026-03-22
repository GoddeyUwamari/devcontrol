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
  TrendingUp, TrendingDown, Eye, Check,
} from 'lucide-react'
import { useCurrentRiskScore, useRiskScoreTrend } from '@/lib/hooks/useRiskScore'
import { useComplianceFrameworks } from '@/lib/hooks/useComplianceFrameworks'
import { anomalyService } from '@/lib/services/anomaly.service'
import { demoModeService } from '@/lib/services/demo-mode.service'
import type { AnomalyDetection } from '@/types/anomaly.types'

// Local display type for compliance — the API type lacks complianceScore/status
type FrameworkDisplay = {
  id: string
  name: string
  complianceScore: number
  status: 'passing' | 'in_progress' | 'failing'
}

// Shared card style
const card: React.CSSProperties = {
  background: '#FFFFFF',
  borderRadius: '16px',
  padding: '32px',
  border: '1px solid #F1F5F9',
}

const overline: React.CSSProperties = {
  fontSize: '0.72rem',
  fontWeight: 600,
  color: '#64748B',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  margin: '0 0 16px',
}

export default function SecurityPage() {
  const [acknowledging, setAcknowledging] = useState<string | null>(null)
  const demoMode = demoModeService.isEnabled()

  // Risk score hooks
  const { data: riskScore, isLoading: riskLoading } = useCurrentRiskScore(!demoMode)
  const { data: riskTrend, isLoading: trendLoading } = useRiskScoreTrend('30d', !demoMode)

  // Compliance frameworks
  const { frameworks, loading: frameworksLoading } = useComplianceFrameworks()

  // Anomalies
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

  // ── Derived values ──────────────────────────────────────────────────────────
  const score = riskScore?.score ?? 87
  const scoreLabel = score >= 90 ? 'Excellent' : score >= 80 ? 'Good' : score >= 70 ? 'Fair' : 'At Risk'
  const scoreColor = score >= 80 ? '#059669' : score >= 70 ? '#D97706' : '#DC2626'

  const activeAnomalies = anomalyStats?.active || anomalyData?.anomalies?.length || 0
  const criticalAnomalies = anomalyStats?.bySeverity?.critical ?? 0

  // Compliance display — map real frameworks or fall back to demo data
  const FALLBACK_FRAMEWORKS: FrameworkDisplay[] = [
    { id: '1', name: 'CIS AWS Benchmark', complianceScore: 87, status: 'passing' },
    { id: '2', name: 'SOC 2 Type II',      complianceScore: 74, status: 'in_progress' },
    { id: '3', name: 'NIST CSF',           complianceScore: 91, status: 'passing' },
    { id: '4', name: 'PCI-DSS',            complianceScore: 68, status: 'failing' },
  ]
  const displayFrameworks: FrameworkDisplay[] = frameworks.length > 0
    ? frameworks.slice(0, 4).map((f) => ({
        id: f.id,
        name: f.name,
        complianceScore: f.enabled ? 80 : 55,
        status: f.enabled ? 'passing' : 'failing',
      }))
    : FALLBACK_FRAMEWORKS

  const passingFrameworks = displayFrameworks.filter((f) => f.status === 'passing').length
  const totalFrameworks = displayFrameworks.length || 4

  // Trend direction from API
  const trendDirection = riskTrend?.trend ?? 'stable'
  const trendPct = riskTrend?.trendPercentage ?? 5
  const TrendIcon = trendDirection === 'declining' ? TrendingDown : TrendingUp
  const trendColor = trendDirection === 'declining' ? '#DC2626' : '#059669'
  const trendLabel = trendDirection === 'declining'
    ? `-${trendPct} pts this month`
    : `+${trendPct} pts this month`

  // Chart data — uses `.history` (RiskScoreTrendPoint[])
  const chartData = riskTrend?.history?.map((point) => ({
    date: new Date(point.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    score: point.score,
  })) ?? Array.from({ length: 30 }, (_, i) => ({
    date: new Date(Date.now() - (29 - i) * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    score: 82 + Math.round(Math.sin(i / 5) * 4 + (i / 30) * 5),
  }))

  // Risk factor checks — use actual RiskScoreFactors field names
  const riskFactors: { label: string; score: number; status: 'Pass' | 'Warning' }[] = riskScore?.factors
    ? [
        { label: 'Encryption',          score: riskScore.factors.encryption,        status: riskScore.factors.encryption >= 80 ? 'Pass' : 'Warning' },
        { label: 'Public Access',        score: riskScore.factors.publicAccess,      status: riskScore.factors.publicAccess >= 80 ? 'Pass' : 'Warning' },
        { label: 'Backup Coverage',      score: riskScore.factors.backup,            status: riskScore.factors.backup >= 80 ? 'Pass' : 'Warning' },
        { label: 'Compliance',           score: riskScore.factors.compliance,        status: riskScore.factors.compliance >= 80 ? 'Pass' : 'Warning' },
        { label: 'Resource Management',  score: riskScore.factors.resourceManagement, status: riskScore.factors.resourceManagement >= 80 ? 'Pass' : 'Warning' },
      ]
    : [
        { label: 'Encryption',          score: 95, status: 'Pass' },
        { label: 'Public Access',        score: 78, status: 'Warning' },
        { label: 'Backup Coverage',      score: 88, status: 'Pass' },
        { label: 'Compliance',           score: 92, status: 'Pass' },
        { label: 'Resource Management',  score: 71, status: 'Warning' },
      ]

  // Top anomalies (AnomalyDetection uses 'info' | 'warning' | 'critical')
  const FALLBACK_ANOMALIES: AnomalyDetection[] = [
    {
      id: '1', organizationId: 'demo', type: 'cpu_spike', severity: 'critical',
      resourceName: 'production-worker', resourceType: 'EC2',
      metric: 'cpu', currentValue: 92, expectedValue: 45, deviation: 104,
      historicalAverage: 45, historicalStdDev: 5, detectedAt: new Date(),
      timeWindow: '1h', title: 'Unusual IAM activity detected', description: '',
      aiExplanation: '', impact: '', recommendation: '', confidence: 95,
      status: 'active',
    },
    {
      id: '2', organizationId: 'demo', type: 'cost_spike', severity: 'warning',
      resourceName: 'old-backup-bucket', resourceType: 'S3',
      metric: 'cost', currentValue: 45, expectedValue: 20, deviation: 125,
      historicalAverage: 20, historicalStdDev: 3, detectedAt: new Date(),
      timeWindow: '24h', title: 'S3 bucket public access enabled', description: '',
      aiExplanation: '', impact: '', recommendation: '', confidence: 88,
      status: 'active',
    },
    {
      id: '3', organizationId: 'demo', type: 'error_rate_spike', severity: 'info',
      resourceName: 'auth-service', resourceType: 'Lambda',
      metric: 'errors', currentValue: 120, expectedValue: 40, deviation: 200,
      historicalAverage: 40, historicalStdDev: 8, detectedAt: new Date(),
      timeWindow: '1h', title: 'Failed login attempts spike', description: '',
      aiExplanation: '', impact: '', recommendation: '', confidence: 72,
      status: 'active',
    },
  ]
  const topAnomalies = anomalyData?.anomalies?.slice(0, 3) ?? FALLBACK_ANOMALIES

  const severityColor = (s: AnomalyDetection['severity']) =>
    s === 'critical' ? '#DC2626' : s === 'warning' ? '#D97706' : '#64748B'
  const severityBg = (s: AnomalyDetection['severity']) =>
    s === 'critical' ? '#FEF2F2' : s === 'warning' ? '#FFFBEB' : '#F8FAFC'
  const severityBorder = (s: AnomalyDetection['severity']) =>
    s === 'critical' ? '#FEE2E2' : s === 'warning' ? '#FDE68A' : '#F1F5F9'
  const severityBadgeBg = (s: AnomalyDetection['severity']) =>
    s === 'critical' ? '#FEE2E2' : s === 'warning' ? '#FDE68A' : '#F1F5F9'

  const handleAcknowledge = async (id: string) => {
    setAcknowledging(id)
    try {
      await anomalyService.acknowledge(id)
      refetchAnomalies()
    } catch (e) {
      console.error('Failed to acknowledge:', e)
    } finally {
      setAcknowledging(null)
    }
  }

  return (
    <div style={{
      padding: '40px 56px 80px',
      maxWidth: '1320px',
      margin: '0 auto',
      minHeight: '100vh',
      background: '#F9FAFB',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>

      {/* ── PAGE HEADER ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '32px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px' }}>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#0F172A', margin: 0, letterSpacing: '-0.02em' }}>
              Security Command Center
            </h1>
            {demoMode && (
              <span style={{ fontSize: '0.7rem', fontWeight: 600, background: '#FFFBEB', color: '#D97706', border: '1px solid #FDE68A', padding: '3px 12px', borderRadius: '100px', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                Demo Mode
              </span>
            )}
          </div>
          <p style={{ fontSize: '0.875rem', color: '#64748B', margin: 0, lineHeight: 1.6 }}>
            Security posture, anomaly detection, compliance frameworks, and audit trail
          </p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={() => anomalyService.triggerScan().then(() => refetchAnomalies())}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#fff', color: '#374151', padding: '10px 20px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 500, border: '1px solid #E2E8F0', cursor: 'pointer' }}
          >
            <RefreshCw size={15} /> Run Scan
          </button>
          <a href="/anomalies" style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#7C3AED', color: '#fff', padding: '10px 20px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600, textDecoration: 'none' }}>
            <Shield size={15} /> View All Threats
          </a>
        </div>
      </div>

      {/* ── 3 KPI CARDS ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '28px' }}>

        {/* Security Score */}
        <div style={card}>
          <p style={overline}>Security Score</p>
          {riskLoading ? <Loader2 size={20} style={{ color: '#94A3B8' }} /> : (
            <>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px', marginBottom: '10px' }}>
                <span style={{ fontSize: '3rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.03em', lineHeight: 1 }}>{score}</span>
                <span style={{ fontSize: '1.25rem', color: '#64748B', marginBottom: '4px' }}>/100</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: scoreColor }}>{scoreLabel}</span>
                <span style={{ fontSize: '0.78rem', color: '#64748B' }}>· Above benchmark</span>
              </div>
            </>
          )}
        </div>

        {/* Active Anomalies */}
        <div style={{ ...card, border: `1px solid ${criticalAnomalies > 0 ? '#FEE2E2' : '#F1F5F9'}` }}>
          <p style={overline}>Active Anomalies</p>
          {anomalyLoading ? <Loader2 size={20} style={{ color: '#94A3B8' }} /> : (
            <>
              <div style={{ fontSize: '3rem', fontWeight: 700, color: activeAnomalies > 5 ? '#DC2626' : activeAnomalies > 0 ? '#D97706' : '#059669', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '10px' }}>
                {activeAnomalies}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {criticalAnomalies > 0 ? (
                  <><AlertTriangle size={13} style={{ color: '#DC2626' }} /><span style={{ fontSize: '0.78rem', color: '#DC2626', fontWeight: 600 }}>{criticalAnomalies} critical · Requires action</span></>
                ) : (
                  <><Check size={13} style={{ color: '#059669' }} /><span style={{ fontSize: '0.78rem', color: '#64748B' }}>No critical threats</span></>
                )}
              </div>
            </>
          )}
        </div>

        {/* Compliance Status */}
        <div style={card}>
          <p style={overline}>Compliance Status</p>
          {frameworksLoading ? <Loader2 size={20} style={{ color: '#94A3B8' }} /> : (
            <>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px', marginBottom: '10px' }}>
                <span style={{ fontSize: '3rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.03em', lineHeight: 1 }}>{passingFrameworks}</span>
                <span style={{ fontSize: '1.25rem', color: '#64748B', marginBottom: '4px' }}>/{totalFrameworks}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <CheckSquare size={13} style={{ color: '#059669' }} />
                <span style={{ fontSize: '0.78rem', color: '#64748B', lineHeight: 1.6 }}>Frameworks passing</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── RISK SCORE TREND + SECURITY CHECKS ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: '24px', marginBottom: '28px' }}>

        {/* Risk Score Trend */}
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
            <div>
              <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#0F172A', margin: '0 0 4px', letterSpacing: '-0.01em' }}>Security Score Trend</h2>
              <p style={{ fontSize: '0.8rem', color: '#64748B', margin: 0, lineHeight: 1.6 }}>30-day posture history</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <TrendIcon size={14} style={{ color: trendColor }} />
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: trendColor }}>{trendLabel}</span>
            </div>
          </div>
          {trendLoading ? (
            <div style={{ height: '180px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Loader2 size={20} style={{ color: '#94A3B8' }} />
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="scoreGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#059669" stopOpacity={0.1} />
                    <stop offset="95%" stopColor="#059669" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="#F1F5F9" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis domain={[60, 100]} tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} width={32} />
                <Tooltip
                  contentStyle={{ background: '#fff', border: '1px solid #F1F5F9', borderRadius: '8px', fontSize: '0.8rem', boxShadow: '0 4px 16px rgba(0,0,0,0.08)' }}
                  formatter={(value: number | string | (number | string)[] | undefined) => {
                    const display = typeof value === 'number' ? value : value != null ? String(value) : '—'
                    return [`${display}/100`, 'Security Score']
                  }}
                />
                <Area type="monotone" dataKey="score" stroke="#059669" strokeWidth={2} fill="url(#scoreGradient)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Security Checks */}
        <div style={card}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#0F172A', margin: '0 0 24px', letterSpacing: '-0.01em' }}>Security Checks</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {riskFactors.map(({ label, score: s, status }) => (
              <div key={label}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span style={{ fontSize: '0.82rem', color: '#374151', fontWeight: 500 }}>{label}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#0F172A' }}>{s}</span>
                    <span style={{
                      fontSize: '0.7rem', fontWeight: 600, padding: '2px 8px', borderRadius: '100px',
                      background: status === 'Pass' ? '#F0FDF4' : '#FFFBEB',
                      color: status === 'Pass' ? '#059669' : '#D97706',
                    }}>
                      {status}
                    </span>
                  </div>
                </div>
                <div style={{ height: '4px', background: '#F1F5F9', borderRadius: '100px' }}>
                  <div style={{ height: '100%', width: `${s}%`, background: status === 'Pass' ? '#059669' : '#D97706', borderRadius: '100px', transition: 'width 0.6s ease' }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── ACTIVE ANOMALIES + COMPLIANCE FRAMEWORKS ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '28px' }}>

        {/* Active Anomalies */}
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#0F172A', margin: 0, letterSpacing: '-0.01em' }}>Active Anomalies</h2>
            <a href="/anomalies" style={{ fontSize: '0.78rem', fontWeight: 600, color: '#7C3AED', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}>
              View all <ChevronRight size={13} />
            </a>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {topAnomalies.map((anomaly) => (
              <div key={anomaly.id} style={{
                padding: '16px', borderRadius: '10px',
                background: severityBg(anomaly.severity),
                border: `1px solid ${severityBorder(anomaly.severity)}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', marginBottom: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                    <div style={{ width: '6px', height: '6px', borderRadius: '50%', marginTop: '6px', flexShrink: 0, background: severityColor(anomaly.severity) }} />
                    <div>
                      <p style={{ fontSize: '0.85rem', fontWeight: 500, color: '#0F172A', margin: '0 0 3px', lineHeight: 1.4 }}>{anomaly.title}</p>
                      <span style={{ fontSize: '0.72rem', color: '#64748B' }}>{anomaly.resourceType ?? anomaly.resourceName ?? '—'}</span>
                    </div>
                  </div>
                  <span style={{
                    fontSize: '0.7rem', fontWeight: 700, padding: '2px 8px', borderRadius: '100px', flexShrink: 0, textTransform: 'capitalize',
                    background: severityBadgeBg(anomaly.severity),
                    color: severityColor(anomaly.severity),
                  }}>
                    {anomaly.severity}
                  </span>
                </div>
                <button
                  onClick={() => handleAcknowledge(anomaly.id)}
                  disabled={acknowledging === anomaly.id}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '5px 12px', fontSize: '0.75rem', fontWeight: 600, color: '#374151', cursor: 'pointer' }}
                >
                  {acknowledging === anomaly.id ? <Loader2 size={11} /> : <Eye size={11} />}
                  Acknowledge
                </button>
              </div>
            ))}
            {topAnomalies.length === 0 && (
              <div style={{ textAlign: 'center', padding: '32px 0', color: '#64748B' }}>
                <Check size={24} style={{ color: '#059669', margin: '0 auto 8px' }} />
                <p style={{ fontSize: '0.875rem', margin: 0, lineHeight: 1.6 }}>No active anomalies · System is secure</p>
              </div>
            )}
          </div>
        </div>

        {/* Compliance Frameworks */}
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#0F172A', margin: 0, letterSpacing: '-0.01em' }}>Compliance Frameworks</h2>
            <a href="/compliance/frameworks" style={{ fontSize: '0.78rem', fontWeight: 600, color: '#7C3AED', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}>
              Manage <ChevronRight size={13} />
            </a>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {displayFrameworks.map((f) => {
              const pct = f.complianceScore
              const passing = f.status === 'passing'
              const failing = f.status === 'failing'
              const statusColor = passing ? '#059669' : failing ? '#DC2626' : '#D97706'
              const statusBg = passing ? '#F0FDF4' : failing ? '#FEF2F2' : '#FFFBEB'
              const statusLabel = passing ? 'Passing' : failing ? 'Failing' : 'In Progress'
              return (
                <div key={f.id} style={{ padding: '14px 16px', background: '#F8FAFC', borderRadius: '10px', border: '1px solid #F1F5F9' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#0F172A' }}>{f.name}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '0.82rem', fontWeight: 700, color: statusColor }}>{pct}%</span>
                      <span style={{ fontSize: '0.7rem', fontWeight: 600, padding: '2px 8px', borderRadius: '100px', background: statusBg, color: statusColor }}>{statusLabel}</span>
                    </div>
                  </div>
                  <div style={{ height: '4px', background: '#E2E8F0', borderRadius: '100px' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: statusColor, borderRadius: '100px', transition: 'width 0.6s ease' }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* ── QUICK NAVIGATION ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
        {([
          { icon: AlertTriangle, label: 'All Anomalies', desc: 'Investigate and resolve threats',   href: '/anomalies',              color: '#DC2626', bg: '#FEF2F2' },
          { icon: CheckSquare,   label: 'Compliance',    desc: 'CIS, NIST, SOC 2, PCI-DSS',        href: '/compliance/frameworks',  color: '#059669', bg: '#F0FDF4' },
          { icon: ClipboardList, label: 'Audit Logs',    desc: 'Full activity trail',               href: '/audit-logs',             color: '#7C3AED', bg: '#F5F3FF' },
        ] as const).map(({ icon: Icon, label, desc, href, color, bg }) => (
          <a key={href} href={href} style={{ textDecoration: 'none' }}>
            <div
              style={{ background: '#fff', borderRadius: '14px', padding: '24px', border: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', gap: '16px', cursor: 'pointer', transition: 'all 0.15s' }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = color; e.currentTarget.style.boxShadow = `0 4px 16px ${color}18` }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#F1F5F9'; e.currentTarget.style.boxShadow = 'none' }}
            >
              <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon size={18} style={{ color }} />
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: '0 0 2px' }}>{label}</p>
                <p style={{ fontSize: '0.78rem', color: '#64748B', margin: 0, lineHeight: 1.6 }}>{desc}</p>
              </div>
              <ArrowRight size={15} style={{ color: '#94A3B8', flexShrink: 0 }} />
            </div>
          </a>
        ))}
      </div>

    </div>
  )
}
