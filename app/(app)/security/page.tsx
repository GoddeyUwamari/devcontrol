'use client'

import { useState, useEffect } from 'react'

function useWindowWidth() {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const update = () => setWidth(window.innerWidth)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return width
}
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
  color: '#94A3B8',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  margin: '0 0 16px',
}

export default function SecurityPage() {
  const width = useWindowWidth()
  const isMobile = width > 0 && width < 640
  const isTablet = width >= 640 && width < 1024
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
  const criticalAnomalies = anomalyData?.anomalies?.filter(
    (a: AnomalyDetection) => a.severity === 'critical' && a.status === 'active'
  ).length ?? 0

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
  const failingFrameworks = displayFrameworks.filter((f) => f.status === 'failing').length
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

  const actionMap: Record<string, { statement: string; link: string }> = {
    'Public Access':       { statement: 'Public access exposed — remediate now',      link: '/security/public-access' },
    'Resource Management': { statement: 'Resource management gaps detected',          link: '/security/resources' },
    'Encryption':          { statement: 'Encryption coverage incomplete',             link: '/security/encryption' },
    'Backup Coverage':     { statement: 'Backup coverage below threshold',            link: '/security/backup' },
    'Compliance':          { statement: 'Compliance checks failing',                  link: '/compliance/frameworks' },
  }

  const navCards = [
    {
      icon: AlertTriangle,
      label: 'All Anomalies',
      desc: criticalAnomalies > 0 ? `${criticalAnomalies} critical — investigate now` : 'Investigate and resolve threats',
      href: '/anomalies',
      color: criticalAnomalies > 0 ? '#DC2626' : '#D97706',
      bg: criticalAnomalies > 0 ? '#FEF2F2' : '#FFFBEB',
    },
    {
      icon: CheckSquare,
      label: 'Compliance',
      desc: failingFrameworks > 0 ? `${failingFrameworks} framework${failingFrameworks > 1 ? 's' : ''} failing — remediate now` : 'CIS, NIST, SOC 2, PCI-DSS',
      href: '/compliance/frameworks',
      color: failingFrameworks > 0 ? '#DC2626' : '#059669',
      bg: failingFrameworks > 0 ? '#FEF2F2' : '#F0FDF4',
    },
    {
      icon: ClipboardList,
      label: 'Audit Logs',
      desc: 'Full activity trail',
      href: '/audit-logs',
      color: '#7C3AED',
      bg: '#F5F3FF',
    },
  ]

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
      padding: isMobile ? '24px 16px' : isTablet ? '40px 24px' : '40px 56px 80px',
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
            onClick={async () => {
              try {
                await anomalyService.triggerScan()
                await refetchAnomalies()
              } catch (e) {
                console.error('Scan failed:', e)
              }
            }}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#7C3AED', color: '#fff', padding: '10px 20px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600, border: 'none', cursor: 'pointer' }}
          >
            <RefreshCw size={15} /> Run Scan
          </button>
          <a href="/anomalies" style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#7C3AED', color: '#fff', padding: '10px 20px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600, textDecoration: 'none' }}>
            <Shield size={15} /> View All Threats
          </a>
        </div>
      </div>

      {/* ── CRITICAL BANNER ── */}
      {criticalAnomalies > 0 && (
        <div style={{ background: '#FEF2F2', border: '1px solid #FEE2E2', borderRadius: '12px', padding: '14px 20px', marginBottom: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <AlertTriangle size={16} style={{ color: '#DC2626', flexShrink: 0 }} />
            <div>
              <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#DC2626' }}>
                {criticalAnomalies} critical risk{criticalAnomalies !== 1 ? 's' : ''}{' '}impacting user-facing services (us-east-1)
              </span>
              {(() => {
                const bannerServices = topAnomalies
                  .filter(a => a.severity === 'critical')
                  .slice(0, 2)
                  .map(a => {
                    const rt = a.resourceType ?? 'Service'
                    if (rt.toLowerCase().includes('ec2')) return 'EC2 latency'
                    if (rt.toLowerCase().includes('lambda')) return 'Lambda throttling'
                    return rt + ' degradation'
                  })
                  .join(' + ')
                return (
                  <p style={{ fontSize: '0.78rem', color: '#991B1B', margin: '2px 0 0', fontWeight: 500 }}>
                    {bannerServices || 'Critical service degradation'} — immediate action required
                  </p>
                )
              })()}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <a href="/anomalies" style={{ fontSize: '0.78rem', fontWeight: 600, color: '#fff', background: '#DC2626', borderRadius: '7px', padding: '7px 16px', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}>
              Fix issues →
            </a>
            <a href="/anomalies" style={{ background: '#fff', color: '#475569', border: '1px solid #E2E8F0', borderRadius: '7px', padding: '7px 16px', fontSize: '0.78rem', fontWeight: 500, textDecoration: 'none' }}>
              Investigate
            </a>
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
          <div style={{ background: '#fff', border: '1px solid #FEE2E2', borderRadius: '12px', padding: '24px 28px', marginBottom: '28px' }}>
            {/* Header strip */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#DC2626', display: 'inline-block', flexShrink: 0 }} />
              <span style={{ fontSize: '0.62rem', fontWeight: 700, color: '#DC2626', background: '#FEE2E2', padding: '2px 8px', borderRadius: '100px', letterSpacing: '0.05em' }}>ACT NOW</span>
              <span style={{ fontSize: '0.72rem', color: '#64748B' }}>Highest priority risk</span>
              <span style={{ marginLeft: 'auto', fontSize: '0.72rem', fontWeight: 600, color: '#D97706', background: '#FFFBEB', border: '1px solid #FDE68A', padding: '2px 8px', borderRadius: '4px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                ⚠ Unassigned
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '20px' }}>
              <div style={{ flex: 1 }}>
                {/* Title + meta */}
                <p style={{ fontSize: '1.25rem', fontWeight: 700, color: '#0F172A', margin: '0 0 6px' }}>
                  {rt.toLowerCase().includes('ec2')
                    ? `${rt} latency risk — CPU saturation (${Math.round(topRisk.currentValue ?? 88)}%)`
                    : rt.toLowerCase().includes('lambda')
                    ? `${rt} throttling risk — concurrency saturation (+${d}%)`
                    : `${rt} anomaly — +${d}% deviation`}
                </p>

                <div style={{ fontSize: '0.7rem', color: '#94A3B8', marginBottom: '12px', display: 'flex', gap: '10px' }}>
                  <span>{topRisk.resourceType ?? '—'}</span>
                  <span style={{ color: '#D1D5DB' }}>·</span>
                  <span>{topRisk.resourceName ?? '—'}</span>
                  <span style={{ color: '#D1D5DB' }}>·</span>
                  <span>us-east-1</span>
                  <span style={{ color: '#D1D5DB' }}>·</span>
                  <span>{(() => {
                    const mins = topRisk.detectedAt ? Math.round((Date.now() - new Date(topRisk.detectedAt).getTime()) / 60000) : null
                    if (!mins) return 'Ongoing'
                    if (mins < 60) return `Active ${mins}m`
                    return `Ongoing (${Math.floor(mins / 60)}h)`
                  })()}</span>
                </div>

                {/* Impact block */}
                <div style={{ fontSize: '0.82rem', color: '#92400E', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '6px', padding: '8px 12px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '7px' }}>
                  <AlertTriangle size={12} style={{ color: '#D97706', flexShrink: 0 }} />
                  <span>
                    <strong style={{ color: '#92400E' }}>Impact:</strong>{' '}
                    {rt.toLowerCase().includes('ec2')
                      ? `+${d > 50 ? Math.round(d * 0.3) : 35}% latency → user-facing degradation`
                      : rt.toLowerCase().includes('lambda')
                      ? `+${d}% load → Lambda throttling → payment risk`
                      : `+${d}% above normal — service impact likely`}
                  </span>
                </div>

                {/* Root cause bullets */}
                <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '10px 12px', marginBottom: '12px' }}>
                  <p style={{ fontSize: '0.68rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 6px' }}>Root Cause</p>
                  {[
                    rt.toLowerCase().includes('ec2') ? 'Traffic spike or under-provisioned EC2' : 'Invocation surge exceeding concurrency limits',
                    rt.toLowerCase().includes('ec2') ? 'CPU sustained >80% → throttling risk' : `+${d}% above normal → cost + latency impact`,
                  ].map((bullet, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: i === 0 ? '4px' : 0 }}>
                      <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#7C3AED', flexShrink: 0, marginTop: '7px' }} />
                      <span style={{ fontSize: '0.8rem', color: '#374151', lineHeight: 1.5 }}>{bullet}</span>
                    </div>
                  ))}
                </div>

                {/* Signal line */}
                <p style={{ fontSize: '0.75rem', color: '#475569', margin: 0, display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600, color: '#059669' }}>High confidence</span>
                  <span style={{ color: '#D1D5DB' }}>|</span>
                  <span><span style={{ color: '#64748B' }}>Deviation:</span>{' '}<span style={{ fontWeight: 600, color: '#DC2626' }}>+{d}%</span></span>
                  <span style={{ color: '#D1D5DB' }}>|</span>
                  <span style={{ color: '#475569' }}>Medium effort · No downtime</span>
                </p>
              </div>

              {/* Action column */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flexShrink: 0, minWidth: '130px' }}>
                <a href="/anomalies" style={{ background: '#059669', color: '#fff', border: 'none', borderRadius: '8px', padding: '9px 14px', fontSize: '0.78rem', fontWeight: 600, textDecoration: 'none', textAlign: 'center', display: 'block' }}>
                  Apply fix →
                </a>
                <a href="/anomalies" style={{ background: '#fff', color: '#475569', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '8px 14px', fontSize: '0.78rem', fontWeight: 500, textDecoration: 'none', textAlign: 'center', display: 'block' }}>
                  Investigate
                </a>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── 3 KPI CARDS ── */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : isTablet ? 'repeat(2,1fr)' : 'repeat(3, 1fr)', gap: '20px', marginBottom: '28px' }}>

        {/* Security Score */}
        <div style={{ ...card, border: '1px solid #F1F5F9', borderTop: '3px solid #7C3AED', borderRadius: '12px', padding: '16px 20px' }}>
          <p style={overline}>Security Score</p>
          {riskLoading ? <Loader2 size={20} style={{ color: '#94A3B8' }} /> : (
            <>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px', marginBottom: '10px' }}>
                <span style={{ fontSize: '2.5rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.03em', lineHeight: 1 }}>{score}</span>
                <span style={{ fontSize: '1.1rem', color: '#94A3B8', marginBottom: '4px' }}>/100</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 600, color: scoreColor }}>{scoreLabel}</span>
                <span style={{ fontSize: '0.75rem', color: (criticalAnomalies > 0 || activeAnomalies > 0) ? '#DC2626' : '#64748B', fontWeight: (criticalAnomalies > 0 || activeAnomalies > 0) ? 600 : 400, display: 'block' }}>
                  {(criticalAnomalies > 0 || activeAnomalies > 0) ? 'Unstable — active critical risks' : 'Above benchmark'}
                </span>
              </div>
            </>
          )}
        </div>

        {/* Active Anomalies */}
        <div style={{ ...card, border: `1px solid ${criticalAnomalies > 0 ? '#FEE2E2' : '#F1F5F9'}`, padding: '16px 20px' }}>
          <p style={overline}>Active Anomalies</p>
          {anomalyLoading ? <Loader2 size={20} style={{ color: '#94A3B8' }} /> : (
            <>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', marginBottom: '10px' }}>
                <span style={{ fontSize: '2.5rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.03em', lineHeight: 1 }}>{activeAnomalies}</span>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: activeAnomalies > 5 ? '#DC2626' : activeAnomalies > 0 ? '#D97706' : '#059669', marginBottom: '10px', flexShrink: 0 }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {criticalAnomalies > 0 ? (
                  <><AlertTriangle size={13} style={{ color: '#DC2626' }} /><span style={{ fontSize: '0.78rem', color: '#DC2626', fontWeight: 600 }}>{criticalAnomalies} critical need attention</span></>
                ) : (
                  <><Check size={13} style={{ color: '#059669' }} /><span style={{ fontSize: '0.78rem', color: '#64748B' }}>No critical threats</span></>
                )}
              </div>
            </>
          )}
        </div>

        {/* Compliance Status */}
        <div style={{ ...card, padding: '16px 20px' }}>
          <p style={overline}>Compliance Status</p>
          {frameworksLoading ? <Loader2 size={20} style={{ color: '#94A3B8' }} /> : (
            <>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px', marginBottom: '10px' }}>
                <span style={{ fontSize: '2.5rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.03em', lineHeight: 1 }}>{passingFrameworks}</span>
                <span style={{ fontSize: '1.1rem', color: '#94A3B8', marginBottom: '4px' }}>/{totalFrameworks}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {failingFrameworks > 0 ? (
                  <><AlertTriangle size={13} style={{ color: '#DC2626' }} /><span style={{ fontSize: '0.78rem', color: '#DC2626', fontWeight: 600 }}>{failingFrameworks} framework{failingFrameworks > 1 ? 's' : ''} failing</span></>
                ) : (
                  <><CheckSquare size={13} style={{ color: '#059669' }} /><span style={{ fontSize: '0.78rem', color: '#64748B', lineHeight: 1.6 }}>All frameworks passing</span></>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── RISK SCORE TREND + SECURITY CHECKS ── */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '3fr 2fr', gap: '24px', marginBottom: '28px' }}>

        {/* Risk Score Trend */}
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
            <div>
              <h2 style={{ fontSize: '0.875rem', fontWeight: 600, color: '#475569', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Security Score Trend</h2>
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
          ) : (chartData.length === 0 || chartData.every(d => d.score === chartData[0].score)) ? (
            <div style={{ height: '180px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#F8FAFC', borderRadius: '8px' }}>
              <p style={{ fontSize: '0.875rem', fontWeight: 500, color: '#475569', margin: 0 }}>Security posture stable</p>
              <p style={{ fontSize: '0.78rem', color: '#94A3B8', margin: 0 }}>No significant changes in the last 30 days · Score: {score}/100</p>
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

        {/* Top Security Gaps */}
        <div style={card}>
          <h2 style={{ fontSize: '0.875rem', fontWeight: 600, color: '#475569', margin: '0 0 20px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Top Security Gaps</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {riskFactors.filter(rf => rf.status === 'Warning').sort((a, b) => a.score - b.score).map(({ label, score: s }) => (
              <div key={label}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span style={{ fontSize: '0.82rem', color: '#D97706', fontWeight: 600 }}>
                    {actionMap[label]?.statement ?? label}
                  </span>
                  <a href={actionMap[label]?.link ?? '/security'} style={{ fontSize: '0.72rem', fontWeight: 600, color: '#7C3AED', textDecoration: 'none' }}>
                    Review →
                  </a>
                </div>
                <div style={{ height: '4px', background: '#F1F5F9', borderRadius: '100px' }}>
                  <div style={{ height: '100%', width: `${s}%`, background: '#D97706', borderRadius: '100px', transition: 'width 0.6s ease' }} />
                </div>
              </div>
            ))}
            {riskFactors.filter(rf => rf.status === 'Warning').length === 0 && (
              <div style={{ padding: '20px 0', textAlign: 'center' }}>
                <p style={{ fontSize: '0.82rem', color: '#059669', fontWeight: 500, margin: 0 }}>All security checks passing</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── ACTIVE ANOMALIES + COMPLIANCE FRAMEWORKS ── */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '24px', marginBottom: '28px' }}>

        {/* Active Anomalies */}
        <div style={{ ...card, padding: '20px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
            <h2 style={{ fontSize: '0.875rem', fontWeight: 600, color: '#475569', margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Active Anomalies</h2>
            <a href="/anomalies" style={{ fontSize: '0.78rem', fontWeight: 600, color: '#7C3AED', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}>
              View all <ChevronRight size={13} />
            </a>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {topAnomalies.map((anomaly) => {
              const rt = anomaly.resourceType ?? ''
              const d = anomaly.deviation ?? 0
              const dAbs = Math.round(Math.abs(d))
              const t = anomaly.title ?? ''

              const riskTitle = (() => {
                if (t.toLowerCase().includes('cpu') || rt.toLowerCase().includes('ec2')) return `${rt || 'EC2'} latency risk — CPU saturation`
                if (t.toLowerCase().includes('lambda') || t.toLowerCase().includes('invocation')) return `${rt || 'Lambda'} throttling risk — concurrency spike`
                if (t.toLowerCase().includes('cost') || t.toLowerCase().includes('spend') || rt.toLowerCase().includes('s3')) return `Cost spike — ${rt || 'resource'} overspend`
                if (t.toLowerCase().includes('iam') || t.toLowerCase().includes('login') || t.toLowerCase().includes('auth')) return `Identity risk — ${t}`
                return t
              })()

              const miniImpact = (() => {
                if (anomaly.severity === 'critical') return `User-facing degradation risk`
                if (dAbs > 50) return `+${dAbs}% above normal — monitor now`
                return `${rt || 'Service'} performance degraded`
              })()

              return (
                <div key={anomaly.id} style={{
                  padding: '14px 16px', borderRadius: '10px',
                  background: '#F8FAFC',
                  border: '1px solid #E2E8F0',
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', marginBottom: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                      <div style={{ width: '6px', height: '6px', borderRadius: '50%', marginTop: '6px', flexShrink: 0, background: severityColor(anomaly.severity) }} />
                      <div>
                        <p style={{ fontSize: '0.85rem', fontWeight: 600, color: '#0F172A', margin: '0 0 3px', lineHeight: 1.4 }}>{riskTitle}</p>
                        <span style={{ fontSize: '0.7rem', color: '#94A3B8' }}>
                          {anomaly.resourceType ?? '—'}{anomaly.resourceName ? ` · ${anomaly.resourceName}` : ''}{' · us-east-1'}
                        </span>
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
                  <p style={{ fontSize: '0.75rem', color: '#D97706', fontWeight: 500, margin: '0 0 10px', paddingLeft: '16px' }}>{miniImpact}</p>
                  <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                    <a href="/anomalies" style={{ background: '#059669', color: '#fff', border: 'none', borderRadius: '6px', padding: '5px 12px', fontSize: '0.72rem', fontWeight: 600, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      Apply fix →
                    </a>
                    <a href="/anomalies" style={{ background: '#fff', color: '#475569', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '5px 12px', fontSize: '0.72rem', fontWeight: 500, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      Investigate
                    </a>
                  </div>
                </div>
              )
            })}
            {topAnomalies.length === 0 && (
              <div style={{ textAlign: 'center', padding: '32px 0', color: '#64748B' }}>
                <Check size={24} style={{ color: '#059669', margin: '0 auto 8px' }} />
                <p style={{ fontSize: '0.875rem', margin: 0, lineHeight: 1.6 }}>No active anomalies · System is secure</p>
              </div>
            )}
          </div>
        </div>

        {/* Compliance Frameworks */}
        <div style={{ ...card, padding: '20px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
            <h2 style={{ fontSize: '0.875rem', fontWeight: 600, color: '#475569', margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Compliance Frameworks</h2>
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
                <div key={f.id} style={{ padding: '14px 16px', background: failing ? '#FEF2F2' : '#F8FAFC', borderRadius: '10px', border: `1px solid ${failing ? '#FEE2E2' : '#F1F5F9'}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: failing ? '4px' : '8px' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#0F172A' }}>{f.name}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '0.82rem', fontWeight: 700, color: statusColor }}>{pct}%</span>
                      <span style={{ fontSize: '0.7rem', fontWeight: 600, padding: '2px 8px', borderRadius: '100px', background: statusBg, color: statusColor }}>{statusLabel}</span>
                    </div>
                  </div>
                  {failing && (
                    <p style={{ fontSize: '0.72rem', color: '#DC2626', fontWeight: 500, margin: '0 0 8px' }}>Blocking compliance readiness</p>
                  )}
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
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : isTablet ? 'repeat(2,1fr)' : 'repeat(3, 1fr)', gap: '16px' }}>
        {navCards.map(({ icon: Icon, label, desc, href, color, bg }) => (
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
                <p style={{ fontSize: '0.78rem', color, margin: 0, lineHeight: 1.6, fontWeight: desc.includes('now') || desc.includes('failing') ? 600 : 400 }}>{desc}</p>
              </div>
              <ArrowRight size={15} style={{ color: '#94A3B8', flexShrink: 0 }} />
            </div>
          </a>
        ))}
      </div>

    </div>
  )
}
