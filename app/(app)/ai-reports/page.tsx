'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAIReports } from '@/lib/hooks/useAIReports'
import { GeneratedReport, ReportHistoryItem } from '@/lib/services/ai-reports.service'
import {
  Sparkles, RefreshCw, Download, Trash2, MoreHorizontal,
  DollarSign, Shield, Server, BarChart3, CheckCircle2, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { useDemoMode } from '@/components/demo/demo-mode-toggle'
import { useSalesDemo } from '@/lib/demo/sales-demo-data'

// ─── Types ───────────────────────────────────────────────────────────────────

type NormalizedType = 'cost_analysis' | 'security' | 'infrastructure' | 'executive'

const typeConfig: Record<NormalizedType, {
  color: string; bg: string; label: string; title: string; icon: React.ReactNode
}> = {
  cost_analysis:  { color: '#16A34A', bg: '#F0FDF4', label: 'Cost',          title: 'Cost Optimization Report',     icon: <DollarSign size={15} /> },
  security:       { color: '#DC2626', bg: '#FEF2F2', label: 'Security',       title: 'Security Risk Report',         icon: <Shield size={15} />     },
  infrastructure: { color: '#2563EB', bg: '#EFF6FF', label: 'Infrastructure', title: 'Infrastructure Health Report', icon: <Server size={15} />     },
  executive:      { color: '#7C3AED', bg: '#F5F3FF', label: 'Executive',      title: 'Executive Summary',            icon: <BarChart3 size={15} />  },
}

const normalizeReportType = (rawType: string): NormalizedType => {
  const map: Record<string, NormalizedType> = {
    cost_analysis:     'cost_analysis',
    cost:              'cost_analysis',
    security_insights: 'security',
    security:          'security',
    infrastructure:    'infrastructure',
    infrastructure_health: 'infrastructure',
    infra:             'infrastructure',
    executive_summary: 'executive',
    executive:         'executive',
    weekly_summary:    'executive',
    monthly_summary:   'infrastructure',
  }
  return map[rawType?.toLowerCase()] ?? 'executive'
}

// Pull a single insight line from a report record
const extractInsight = (report: any): string | null => {
  // Demo reports carry a `summary` string directly
  if (typeof report.summary === 'string' && report.summary) {
    const s = report.summary.split(/\.\s+/)[0]
    return s.length < 130 ? s + '.' : s.slice(0, 110) + '…'
  }

  const data = report.report_data as GeneratedReport | undefined
  if (!data) return null

  // Best single-line insight sources, in priority order
  const costImpact = data.cost_insights?.[0]?.impact
  if (costImpact) return costImpact

  if (data.executive_summary) {
    const s = data.executive_summary.split(/\.\s+/)[0]
    return s.length < 130 ? s + '.' : s.slice(0, 110) + '…'
  }

  return null
}

const formatGeneratedAt = (dateVal: string | Date): string =>
  new Date(dateVal).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })

// ─── Confirmation Modal ───────────────────────────────────────────────────────

function ConfirmModal({
  title, body, confirmLabel, confirmDanger = true,
  onConfirm, onCancel, loading,
}: {
  title: string; body: string; confirmLabel: string; confirmDanger?: boolean
  onConfirm: () => void; onCancel: () => void; loading?: boolean
}) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(2px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onCancel}>
      <div style={{
        background: '#fff', borderRadius: '14px', padding: '28px 32px',
        width: '100%', maxWidth: '420px', boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
      }} onClick={e => e.stopPropagation()}>
        <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#0F172A', margin: '0 0 10px' }}>{title}</h3>
        <p style={{ fontSize: '0.875rem', color: '#475569', margin: '0 0 24px', lineHeight: 1.6 }}>{body}</p>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button onClick={onCancel} disabled={loading} style={{
            padding: '8px 18px', borderRadius: '7px', fontSize: '0.82rem', fontWeight: 600,
            border: '1px solid #E2E8F0', background: '#fff', color: '#475569', cursor: 'pointer',
          }}>Cancel</button>
          <button onClick={onConfirm} disabled={loading} style={{
            padding: '8px 18px', borderRadius: '7px', fontSize: '0.82rem', fontWeight: 600,
            border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
            background: confirmDanger ? '#DC2626' : '#7C3AED',
            color: '#fff', opacity: loading ? 0.7 : 1,
            display: 'flex', alignItems: 'center', gap: '6px',
          }}>
            {loading ? <><RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} /> Deleting…</> : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AIReportsPage() {
  const router = useRouter()
  const { generateReport, getReportHistory, deleteReport, bulkDeleteReports, isGenerating, isFetchingHistory, error } = useAIReports()
  const [currentReport, setCurrentReport] = useState<GeneratedReport | null>(null)
  const [reportHistory, setReportHistory] = useState<ReportHistoryItem[]>([])
  const [generatingType, setGeneratingType] = useState<string | null>(null)
  const [showAllReports, setShowAllReports] = useState(false)

  // Selection + bulk delete
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showBulkConfirm, setShowBulkConfirm] = useState(false)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [isBulkDeleting, setIsBulkDeleting] = useState(false)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const selectAllRef = useRef<HTMLInputElement>(null)

  // Close overflow menu on outside click
  useEffect(() => {
    if (!openMenuId) return
    const close = () => setOpenMenuId(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [openMenuId])

  // Fetch report history on mount
  useEffect(() => {
    loadReportHistory()
  }, [])

  const loadReportHistory = async () => {
    const history = await getReportHistory(50)
    setReportHistory(history)
  }

  const handleGenerateReport = async (reportType: string = 'weekly_summary') => {
    if (generatingType !== null) return
    setGeneratingType(reportType)

    const typeMap: Record<string, string> = {
      cost_analysis:  'cost_analysis',
      security:       'security_insights',
      infrastructure: 'infrastructure_health',
      executive:      'executive_summary',
    }
    const mappedType = typeMap[reportType] ?? 'weekly_summary'

    const report = await generateReport({
      dateRange: {
        from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        to: new Date().toISOString().split('T')[0],
      },
      reportType: mappedType as any,
    })

    setGeneratingType(null)

    if (report) {
      setCurrentReport(report)
      toast.success('Report generated successfully!')
      loadReportHistory()
    } else {
      toast.error(error || 'Failed to generate report')
    }
  }

  // Single delete (from ⋯ menu)
  const handleDeleteSingle = async () => {
    if (!deleteTargetId) return
    setIsBulkDeleting(true)
    const success = await deleteReport(deleteTargetId)
    setIsBulkDeleting(false)
    setDeleteTargetId(null)
    if (success) {
      toast.success('Report deleted')
      if (currentReport?.reportId === deleteTargetId) setCurrentReport(null)
      setSelectedIds(prev => { const next = new Set(prev); next.delete(deleteTargetId); return next })
      loadReportHistory()
    } else {
      toast.error('Failed to delete report')
    }
  }

  // Bulk delete
  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds)
    setIsBulkDeleting(true)
    const deleted = await bulkDeleteReports(ids)
    setIsBulkDeleting(false)
    setShowBulkConfirm(false)
    if (deleted > 0) {
      toast.success(`${deleted} report${deleted !== 1 ? 's' : ''} deleted`)
      setSelectedIds(new Set())
      if (currentReport?.reportId && ids.includes(currentReport.reportId)) setCurrentReport(null)
      loadReportHistory()
    } else {
      toast.error('Failed to delete reports')
    }
  }

  // Selection helpers
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])

  const demoMode = useDemoMode()
  const salesDemoMode = useSalesDemo((state) => state.enabled)
  const isDemoActive = demoMode || salesDemoMode

  const DEMO_REPORTS = [
    {
      id: 'report-1',
      title: 'Monthly Cost Analysis — March 2026',
      type: 'cost_analysis',
      status: 'completed',
      createdAt: new Date(Date.now() - 1000 * 60 * 30),
      summary: 'AWS spend increased 14.3% to $6,847/mo driven primarily by Lambda invocation spikes in payment-processor. Three zero-risk optimizations identified totaling $1,922/mo in savings.',
      metrics: { savings: '$1,922/mo', risk: 'Low', confidence: '95%' },
    },
    {
      id: 'report-2',
      title: 'Security Posture Report — Q1 2026',
      type: 'security',
      status: 'completed',
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 6),
      summary: 'Security score improved to 87/100, above industry benchmark of 74. PCI-DSS remains at 68% — remediation plan required within 30 days.',
      metrics: { score: '87/100', frameworks: '3/4 passing', vulnerabilities: '0 critical' },
    },
    {
      id: 'report-3',
      title: 'Infrastructure Health Report — March 2026',
      type: 'infrastructure',
      status: 'completed',
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24),
      summary: 'All 8 services operational with 99.97% uptime. Engineering velocity rated Elite (top 10%). One anomaly detected: CPU spike on production-worker-overloaded requires investigation.',
      metrics: { uptime: '99.97%', services: '8/8 healthy', velocity: 'Elite' },
    },
    {
      id: 'report-4',
      title: 'Executive Summary — February 2026',
      type: 'executive',
      status: 'completed',
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7),
      summary: 'DevControl identified $23,064 in annualized savings this quarter. Security posture improved 5 points. Infrastructure efficiency at 67% with clear path to 85%+.',
      metrics: { savings: '$23,064/yr', roi: '12x', efficiency: '67%' },
    },
  ]

  const displayReports = isDemoActive ? DEMO_REPORTS : (reportHistory || [])
  const visibleReports = showAllReports ? displayReports : displayReports.slice(0, 5)

  // Update select-all indeterminate state
  useEffect(() => {
    if (!selectAllRef.current || displayReports.length === 0) return
    const total = displayReports.length
    const count = displayReports.filter((r: any) => selectedIds.has(r.id)).length
    selectAllRef.current.indeterminate = count > 0 && count < total
  }, [selectedIds, displayReports])

  const allSelected = displayReports.length > 0 && displayReports.every((r: any) => selectedIds.has(r.id))
  const handleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(displayReports.map((r: any) => r.id)))
    }
  }

  const reportsThisMonth = isDemoActive ? 4 : displayReports.filter((r: any) => {
    const d = new Date(r.createdAt || r.created_at)
    const now = new Date()
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
  }).length

  const lastGenerated = isDemoActive
    ? 'Today, 30 minutes ago'
    : displayReports.length > 0
      ? formatGeneratedAt((displayReports[0] as any).createdAt || (displayReports[0] as any).created_at)
      : 'Never'

  const isLoading = isFetchingHistory

  const handleViewReport = (id: string) => router.push(`/ai-reports/${id}`)
  const handleDownloadReport = (id: string) => console.log('Download', id)

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
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .report-row:hover { background: #FAFAFA !important; border-color: #E2E8F0 !important; }
        .report-row.selected { background: #F5F3FF !important; border-color: #DDD6FE !important; }
        .menu-item:hover { background: #F8FAFC; }
        .menu-item-danger:hover { background: #FEF2F2; color: #DC2626 !important; }
        .action-btn:hover { opacity: 0.85; }
      `}</style>

      {/* PAGE HEADER */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '32px' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#0F172A', margin: '0 0 6px', letterSpacing: '-0.02em' }}>
            Uncover Cost Savings, Risks, and Insights Across Your AWS — in Minutes
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>
            Generate executive-ready AI reports with actionable recommendations your team can use immediately.
          </p>
        </div>
        <button
          onClick={() => handleGenerateReport()}
          disabled={generatingType !== null}
          style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            background: generatingType !== null ? '#A78BFA' : '#7C3AED',
            color: '#fff', padding: '10px 20px', borderRadius: '8px',
            fontSize: '0.875rem', fontWeight: 600, border: 'none', flexShrink: 0,
            cursor: generatingType !== null ? 'not-allowed' : 'pointer',
          }}>
          {generatingType === 'weekly_summary'
            ? <><RefreshCw size={15} style={{ animation: 'spin 1s linear infinite' }} /> Generating...</>
            : <><Sparkles size={15} /> Generate Report</>
          }
        </button>
      </div>

      {/* 3 KPI CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '28px' }}>
        {[
          {
            label: 'Reports This Month',
            value: reportsThisMonth > 0 ? reportsThisMonth : null,
            empty: 'No reports yet',
            sub: reportsThisMonth > 0 ? 'Generated reports' : 'Generate your first to track trends over time',
            hero: false,
          },
          {
            label: 'Last Generated',
            value: lastGenerated !== 'Never' ? lastGenerated : null,
            empty: 'Never',
            sub: lastGenerated !== 'Never' ? 'Most recent report' : 'Your first report takes ~2 minutes',
            hero: false,
          },
          {
            label: 'Available Insights',
            value: 4,
            empty: null,
            sub: 'Cost · Security · Infrastructure · Executive',
            hero: true,
          },
        ].map(({ label, value, empty, sub, hero }) => (
          <div key={label} style={{
            background: '#fff',
            borderRadius: '14px',
            padding: '32px',
            border: '1px solid #E2E8F0',
            borderLeft: hero ? '2px solid #534AB7' : '1px solid #E2E8F0',
          }}>
            <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 16px' }}>
              {label}
            </p>
            {value !== null ? (
              <div style={{ fontSize: typeof value === 'number' ? '2.5rem' : '1.1rem', fontWeight: 700, color: '#0F172A', letterSpacing: '-0.02em', lineHeight: 1.2, marginBottom: '8px' }}>
                {value}
              </div>
            ) : (
              <div style={{ fontSize: '0.875rem', fontWeight: 500, color: '#9ca3af', marginBottom: '8px', paddingTop: '4px' }}>
                {empty}
              </div>
            )}
            <p style={{ fontSize: '0.78rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>{sub}</p>
          </div>
        ))}
      </div>

      {/* REPORT TYPE CARDS */}
      <div style={{ marginBottom: '28px' }}>
        <p style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 16px' }}>
          Available Reports
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
          {[
            { icon: '💰', label: 'Cost Optimization Report',    desc: 'Identify unused resources, rightsizing opportunities, and immediate savings across your AWS account.', type: 'cost_analysis'  },
            { icon: '🔐', label: 'Security Risk Report',        desc: 'Detect misconfigurations, open ports, IAM issues, and compliance gaps before they become incidents.',   type: 'security'       },
            { icon: '⚙️', label: 'Infrastructure Health Report', desc: 'Analyze system performance, architecture bottlenecks, and reliability across all services.',           type: 'infrastructure' },
            { icon: '📊', label: 'Executive Summary',           desc: 'Board-ready insights combining cost, security, and performance data into a single decision-ready report.', type: 'executive'    },
          ].map(({ icon, label, desc, type }) => (
            <div key={type} style={{
              background: '#fff', borderRadius: '12px', padding: '24px',
              border: '1px solid #E2E8F0', display: 'flex', flexDirection: 'column', gap: '12px',
              transition: 'border-color 0.15s ease',
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#7C3AED' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#E2E8F0' }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                <span style={{ fontSize: '1.4rem' }}>{icon}</span>
                <div>
                  <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: '0 0 4px' }}>{label}</p>
                  <p style={{ fontSize: '0.78rem', color: '#64748B', margin: 0, lineHeight: 1.6 }}>{desc}</p>
                </div>
              </div>
              <button
                onClick={() => handleGenerateReport(type)}
                disabled={generatingType !== null}
                style={{
                  alignSelf: 'flex-start',
                  display: 'flex', alignItems: 'center', gap: '6px',
                  background: generatingType === type ? '#7C3AED' : 'transparent',
                  color: generatingType === type ? '#fff' : '#7C3AED',
                  border: '1px solid #7C3AED', padding: '6px 16px', borderRadius: '6px',
                  fontSize: '0.78rem', fontWeight: 600,
                  cursor: generatingType !== null ? 'not-allowed' : 'pointer',
                  opacity: generatingType !== null && generatingType !== type ? 0.5 : 1,
                  transition: 'all 0.15s ease',
                }}
              >
                {generatingType === type
                  ? <><RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} /> Generating...</>
                  : 'Generate →'
                }
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* GENERATION PROGRESS */}
      {generatingType !== null && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          background: '#F5F3FF', border: '1px solid #DDD6FE',
          borderRadius: '10px', padding: '12px 18px', marginBottom: '20px',
        }}>
          <RefreshCw size={14} style={{ color: '#7C3AED', flexShrink: 0, animation: 'spin 1s linear infinite' }} />
          <span style={{ fontSize: '0.82rem', color: '#5B21B6', fontWeight: 500 }}>
            AI is analyzing your infrastructure data — usually takes 20–30 seconds
          </span>
        </div>
      )}

      {/* REPORTS LIST */}
      {isLoading && !isDemoActive ? (
        <div style={{ background: '#fff', borderRadius: '16px', padding: '48px', textAlign: 'center', border: '1px solid #F1F5F9' }}>
          <RefreshCw size={24} style={{ color: '#94A3B8', margin: '0 auto 12px' }} />
          <p style={{ fontSize: '0.875rem', color: '#64748B', margin: 0 }}>Loading reports...</p>
        </div>
      ) : displayReports.length === 0 ? (
        <div style={{
          background: 'linear-gradient(135deg, #F5F3FF 0%, #EDE9FE 100%)',
          borderRadius: '16px', padding: '56px 40px', textAlign: 'center', border: '1px solid #DDD6FE',
        }}>
          <div style={{ fontSize: '2rem', marginBottom: '16px' }}>✨</div>
          <p style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0F172A', margin: '0 0 8px' }}>
            Start uncovering insights in minutes
          </p>
          <p style={{ fontSize: '0.875rem', color: '#475569', margin: '0 0 24px', lineHeight: 1.7, maxWidth: '480px', marginLeft: 'auto', marginRight: 'auto' }}>
            Generate your first AI report to discover:
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px', maxWidth: '440px', margin: '0 auto 28px', textAlign: 'left' }}>
            {['💰 Immediate cost-saving opportunities', '🔐 Hidden security risks and misconfigs', '⚙️ Infrastructure inefficiencies', '📊 Executive-ready summaries'].map(item => (
              <div key={item} style={{ fontSize: '0.82rem', color: '#475569', background: '#fff', borderRadius: '8px', padding: '10px 14px', border: '1px solid #EDE9FE' }}>
                {item}
              </div>
            ))}
          </div>
          <button
            onClick={() => handleGenerateReport()}
            disabled={generatingType !== null}
            style={{ background: generatingType !== null ? '#A78BFA' : '#7C3AED', color: '#fff', padding: '12px 28px', borderRadius: '8px', fontSize: '0.9rem', fontWeight: 600, border: 'none', cursor: generatingType !== null ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            {generatingType !== null
              ? <><RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} /> Generating...</>
              : <><Sparkles size={14} /> Generate My First AI Report</>
            }
          </button>
          <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: '12px 0 0' }}>
            Takes ~2 minutes · No setup required · Read-only access
          </p>
        </div>
      ) : (
        <div>
          {/* List header: select-all + bulk toolbar */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: '12px', minHeight: '32px', padding: '0 4px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input
                ref={selectAllRef}
                type="checkbox"
                checked={allSelected}
                onChange={handleSelectAll}
                style={{ width: '15px', height: '15px', cursor: 'pointer', accentColor: '#7C3AED' }}
              />
              {selectedIds.size > 0 ? (
                <span style={{ fontSize: '0.82rem', color: '#475569', fontWeight: 500 }}>
                  {selectedIds.size} report{selectedIds.size !== 1 ? 's' : ''} selected
                </span>
              ) : (
                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                  Recent Reports
                </span>
              )}
            </div>
            {selectedIds.size > 0 && (
              <button
                onClick={() => setShowBulkConfirm(true)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA',
                  padding: '6px 14px', borderRadius: '7px', fontSize: '0.78rem', fontWeight: 600,
                  cursor: 'pointer', transition: 'all 0.15s',
                }}>
                <Trash2 size={13} /> Delete Selected
              </button>
            )}
          </div>

          {/* Report rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {visibleReports.map((report: any) => {
              const normalizedType = normalizeReportType(report.type || report.report_type || '')
              const type = typeConfig[normalizedType]
              const isSelected = selectedIds.has(report.id)
              const insight = extractInsight(report)
              const dateVal = report.createdAt || report.created_at
              const reportTitle = report.title || type.title

              return (
                <div
                  key={report.id}
                  className={`report-row${isSelected ? ' selected' : ''}`}
                  style={{
                    background: isSelected ? '#F5F3FF' : '#fff',
                    borderRadius: '12px',
                    border: `1px solid ${isSelected ? '#DDD6FE' : '#F1F5F9'}`,
                    transition: 'background 0.12s, border-color 0.12s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', padding: '16px 20px' }}>
                    {/* Checkbox */}
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(report.id)}
                      style={{ marginTop: '2px', width: '15px', height: '15px', cursor: 'pointer', flexShrink: 0, accentColor: '#7C3AED' }}
                    />

                    {/* Type icon */}
                    <div style={{
                      width: '34px', height: '34px', borderRadius: '8px',
                      background: type.bg, color: type.color,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>
                      {type.icon}
                    </div>

                    {/* Main content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {/* Title + badges row */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '3px' }}>
                        <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#0F172A', lineHeight: 1.3 }}>
                          {reportTitle}
                        </span>
                        {/* Type badge */}
                        <span style={{
                          fontSize: '0.68rem', fontWeight: 700, padding: '2px 8px',
                          borderRadius: '100px', background: type.bg, color: type.color, flexShrink: 0,
                        }}>
                          {type.label}
                        </span>
                        {/* Status */}
                        <span style={{
                          display: 'flex', alignItems: 'center', gap: '3px',
                          fontSize: '0.68rem', fontWeight: 600, color: '#16A34A', flexShrink: 0,
                        }}>
                          <CheckCircle2 size={11} /> Ready
                        </span>
                      </div>

                      {/* Metadata */}
                      <p style={{ fontSize: '0.74rem', color: '#94A3B8', margin: '0 0 4px', lineHeight: 1.4 }}>
                        Generated {dateVal ? formatGeneratedAt(dateVal) : '—'} • Manual
                      </p>

                      {/* Insight highlight */}
                      {insight && (
                        <p style={{ fontSize: '0.78rem', color: '#64748B', margin: 0, lineHeight: 1.5, fontStyle: 'italic' }}>
                          "{insight}"
                        </p>
                      )}
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flexShrink: 0, marginTop: '1px' }}>
                      <button
                        className="action-btn"
                        onClick={() => handleViewReport(report.id)}
                        style={{ background: '#7C3AED', color: '#fff', padding: '6px 14px', borderRadius: '6px', fontSize: '0.78rem', fontWeight: 600, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        View Report
                      </button>
                      <button
                        className="action-btn"
                        onClick={() => handleDownloadReport(report.id)}
                        style={{ background: 'none', color: '#475569', padding: '5px 10px', borderRadius: '6px', fontSize: '0.78rem', fontWeight: 500, border: '1px solid #E2E8F0', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
                        <Download size={12} /> PDF
                      </button>

                      {/* Overflow menu */}
                      <div style={{ position: 'relative' }}>
                        <button
                          onClick={e => { e.stopPropagation(); setOpenMenuId(openMenuId === report.id ? null : report.id) }}
                          style={{ background: 'none', border: '1px solid #E2E8F0', color: '#64748B', padding: '5px 7px', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', lineHeight: 1 }}>
                          <MoreHorizontal size={15} />
                        </button>
                        {openMenuId === report.id && (
                          <div
                            onClick={e => e.stopPropagation()}
                            style={{
                              position: 'absolute', right: 0, top: 'calc(100% + 4px)',
                              background: '#fff', border: '1px solid #E2E8F0', borderRadius: '8px',
                              boxShadow: '0 6px 20px rgba(0,0,0,0.10)', zIndex: 50,
                              minWidth: '154px', padding: '4px',
                            }}>
                            <button
                              className="menu-item"
                              onClick={() => { handleDownloadReport(report.id); setOpenMenuId(null) }}
                              style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 12px', borderRadius: '5px', border: 'none', background: 'none', fontSize: '0.8rem', color: '#374151', cursor: 'pointer', textAlign: 'left', fontWeight: 500 }}>
                              <Download size={13} style={{ color: '#6B7280' }} /> Download PDF
                            </button>
                            <div style={{ height: '1px', background: '#F1F5F9', margin: '3px 0' }} />
                            <button
                              className="menu-item menu-item-danger"
                              onClick={() => { setDeleteTargetId(report.id); setOpenMenuId(null) }}
                              style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 12px', borderRadius: '5px', border: 'none', background: 'none', fontSize: '0.8rem', color: '#374151', cursor: 'pointer', textAlign: 'left', fontWeight: 500 }}>
                              <Trash2 size={13} style={{ color: '#DC2626' }} /> Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Show all toggle */}
          {displayReports.length > 5 && (
            <button
              onClick={() => setShowAllReports(!showAllReports)}
              style={{
                background: 'none', border: '1px solid #E2E8F0', borderRadius: '8px',
                padding: '10px 24px', fontSize: '0.82rem', fontWeight: 600,
                color: '#475569', cursor: 'pointer', width: '100%', marginTop: '10px',
              }}>
              {showAllReports ? '↑ Show less' : `↓ Show all ${displayReports.length} reports`}
            </button>
          )}
        </div>
      )}

      {/* BULK DELETE CONFIRMATION */}
      {showBulkConfirm && (
        <ConfirmModal
          title={`Delete ${selectedIds.size} report${selectedIds.size !== 1 ? 's' : ''}?`}
          body="This cannot be undone. The selected reports will be permanently removed."
          confirmLabel={`Delete ${selectedIds.size} report${selectedIds.size !== 1 ? 's' : ''}`}
          onConfirm={handleBulkDelete}
          onCancel={() => setShowBulkConfirm(false)}
          loading={isBulkDeleting}
        />
      )}

      {/* SINGLE DELETE CONFIRMATION */}
      {deleteTargetId && (
        <ConfirmModal
          title="Delete this report?"
          body="This cannot be undone. The report will be permanently removed."
          confirmLabel="Delete Report"
          onConfirm={handleDeleteSingle}
          onCancel={() => setDeleteTargetId(null)}
          loading={isBulkDeleting}
        />
      )}
    </div>
  )
}
