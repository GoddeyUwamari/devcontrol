'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAIReports } from '@/lib/hooks/useAIReports'
import { GeneratedReport, ReportHistoryItem } from '@/lib/services/ai-reports.service'
import {
  Sparkles, RefreshCw, Download, Trash2, MoreHorizontal,
  DollarSign, Shield, Server, BarChart3, CheckCircle2, X,
  ChevronUp, ChevronDown, Lock,
} from 'lucide-react'
import { usePlan } from '@/lib/hooks/use-plan'
import { toast } from 'sonner'
import { useDemoMode } from '@/components/demo/demo-mode-toggle'
import { useSalesDemo } from '@/lib/demo/sales-demo-data'

type NormalizedType = 'cost_analysis' | 'security' | 'infrastructure' | 'executive'

const typeConfig: Record<NormalizedType, { color: string; bg: string; label: string; title: string; icon: React.ReactNode }> = {
  cost_analysis:  { color: '#16A34A', bg: '#F0FDF4', label: 'Cost',          title: 'Cost Optimization Report',     icon: <DollarSign size={15} /> },
  security:       { color: '#DC2626', bg: '#FEF2F2', label: 'Security',       title: 'Security Risk Report',         icon: <Shield size={15} />     },
  infrastructure: { color: '#2563EB', bg: '#EFF6FF', label: 'Infrastructure', title: 'Infrastructure Health Report', icon: <Server size={15} />     },
  executive:      { color: '#7C3AED', bg: '#F5F3FF', label: 'Executive',      title: 'Executive Summary',            icon: <BarChart3 size={15} />  },
}

const normalizeReportType = (rawType: string): NormalizedType => {
  const map: Record<string, NormalizedType> = {
    cost_analysis: 'cost_analysis', cost: 'cost_analysis',
    security_insights: 'security', security: 'security',
    infrastructure: 'infrastructure', infrastructure_health: 'infrastructure', infra: 'infrastructure',
    executive_summary: 'executive', executive: 'executive', weekly_summary: 'executive', monthly_summary: 'infrastructure',
  }
  return map[rawType?.toLowerCase()] ?? 'executive'
}

const extractInsight = (report: any): string | null => {
  if (typeof report.summary === 'string' && report.summary) {
    const s = report.summary.split(/\.\s+/)[0]
    return s.length < 130 ? s + '.' : s.slice(0, 110) + '…'
  }
  const data = report.report_data as GeneratedReport | undefined
  if (!data) return null
  const costImpact = data.cost_insights?.[0]?.impact
  if (costImpact) return costImpact
  if (data.executive_summary) {
    const s = data.executive_summary.split(/\.\s+/)[0]
    return s.length < 130 ? s + '.' : s.slice(0, 110) + '…'
  }
  return null
}

const formatGeneratedAt = (dateVal: string | Date): string =>
  new Date(dateVal).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

const outcomeChip = (type: NormalizedType): { label: string; color: string } | null => {
  if (type === 'cost_analysis')  return { label: '$1,697 savings found', color: '#059669' }
  if (type === 'security')       return { label: '2 risks detected',      color: '#DC2626' }
  if (type === 'infrastructure') return { label: '99.9% uptime',          color: '#2563EB' }
  if (type === 'executive')      return { label: '12x ROI',               color: '#7C3AED' }
  return null
}

const relativeTime = (dateVal: string | Date): string => {
  const diff = Date.now() - new Date(dateVal).getTime()
  const mins = Math.floor(diff / 60000), hours = Math.floor(diff / 3600000), days = Math.floor(diff / 86400000)
  if (mins < 60) return `${mins} min ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return formatGeneratedAt(dateVal)
}

function ConfirmModal({ title, body, confirmLabel, confirmDanger = true, onConfirm, onCancel, loading }: {
  title: string; body: string; confirmLabel: string; confirmDanger?: boolean
  onConfirm: () => void; onCancel: () => void; loading?: boolean
}) {
  return (
    <div className="fixed inset-0 z-[9999] bg-slate-900/45 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-6" onClick={onCancel}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-7 shadow-2xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-bold text-slate-900 mb-2.5">{title}</h3>
        <p className="text-sm text-slate-500 leading-relaxed mb-6">{body}</p>
        <div className="flex gap-2.5 justify-end">
          <button onClick={onCancel} disabled={loading} className="px-4 py-2 rounded-lg text-xs font-semibold border border-slate-200 bg-white text-slate-500 cursor-pointer hover:bg-slate-50 transition-colors">Cancel</button>
          <button onClick={onConfirm} disabled={loading} className={`px-4 py-2 rounded-lg text-xs font-semibold text-white border-none flex items-center gap-1.5 transition-colors ${confirmDanger ? 'bg-red-600 hover:bg-red-700' : 'bg-violet-600 hover:bg-violet-700'} ${loading ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'}`}>
            {loading ? <><RefreshCw size={12} className="animate-spin" /> Deleting…</> : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

const DEMO_REPORTS = [
  { id: 'report-1', title: 'Monthly Cost Analysis — March 2026', type: 'cost_analysis', status: 'completed', createdAt: new Date(Date.now() - 1000 * 60 * 30), summary: 'AWS spend increased 14.3% to $6,847/mo driven primarily by Lambda invocation spikes in payment-processor. Three zero-risk optimizations identified totaling $1,922/mo in savings.', metrics: { savings: '$1,922/mo', risk: 'Low', confidence: '95%' } },
  { id: 'report-2', title: 'Security Posture Report — Q1 2026', type: 'security', status: 'completed', createdAt: new Date(Date.now() - 1000 * 60 * 60 * 6), summary: 'Security score improved to 87/100, above industry benchmark of 74. PCI-DSS remains at 68% — remediation plan required within 30 days.', metrics: { score: '87/100', frameworks: '3/4 passing', vulnerabilities: '0 critical' } },
  { id: 'report-3', title: 'Infrastructure Health Report — March 2026', type: 'infrastructure', status: 'completed', createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24), summary: 'All 8 services operational with 99.97% uptime. Engineering velocity rated Elite (top 10%). One anomaly detected: CPU spike on production-worker-overloaded requires investigation.', metrics: { uptime: '99.97%', services: '8/8 healthy', velocity: 'Elite' } },
  { id: 'report-4', title: 'Executive Summary — February 2026', type: 'executive', status: 'completed', createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7), summary: 'DevControl identified $23,064 in annualized savings this quarter. Security posture improved 5 points. Infrastructure efficiency at 67% with clear path to 85%+.', metrics: { savings: '$23,064/yr', roi: '12x', efficiency: '67%' } },
]

export default function AIReportsPage() {
  const router = useRouter()
  const { isPro } = usePlan()
  const { generateReport, getReportHistory, deleteReport, bulkDeleteReports, isGenerating, isFetchingHistory, error } = useAIReports()
  const [showUpgradeBanner, setShowUpgradeBanner] = useState(false)
  const [currentReport, setCurrentReport] = useState<GeneratedReport | null>(null)
  const [reportHistory, setReportHistory] = useState<ReportHistoryItem[]>([])
  const [generatingType, setGeneratingType] = useState<string | null>(null)
  const [showAllReports, setShowAllReports] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showBulkConfirm, setShowBulkConfirm] = useState(false)
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [isBulkDeleting, setIsBulkDeleting] = useState(false)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const selectAllRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!openMenuId) return
    const close = () => setOpenMenuId(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [openMenuId])

  useEffect(() => { loadReportHistory() }, [])

  const loadReportHistory = async () => {
    try {
      const history = await getReportHistory(50)
      setReportHistory(history)
    } catch (err: any) {
      if (err?.status === 402) setShowUpgradeBanner(true)
    }
  }

  const handleGenerateReport = async (reportType: string = 'weekly_summary') => {
    if (generatingType !== null) return
    setGeneratingType(reportType)
    const typeMap: Record<string, string> = { cost_analysis: 'cost_analysis', security: 'security_insights', infrastructure: 'infrastructure_health', executive: 'executive_summary' }
    try {
      const report = await generateReport({ dateRange: { from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], to: new Date().toISOString().split('T')[0] }, reportType: (typeMap[reportType] ?? 'weekly_summary') as any })
      setGeneratingType(null)
      if (report) { setCurrentReport(report); toast.success('Report generated successfully!'); loadReportHistory() }
      else toast.error(error || 'Failed to generate report')
    } catch (err: any) {
      setGeneratingType(null)
      if (err?.status === 402) setShowUpgradeBanner(true)
      else toast.error('Failed to generate report')
    }
  }

  const handleDeleteSingle = async () => {
    if (!deleteTargetId) return
    setIsBulkDeleting(true)
    const success = await deleteReport(deleteTargetId)
    setIsBulkDeleting(false); setDeleteTargetId(null)
    if (success) { toast.success('Report deleted'); if (currentReport?.reportId === deleteTargetId) setCurrentReport(null); setSelectedIds(prev => { const next = new Set(prev); next.delete(deleteTargetId!); return next }); loadReportHistory() }
    else toast.error('Failed to delete report')
  }

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds)
    setIsBulkDeleting(true)
    const deleted = await bulkDeleteReports(ids)
    setIsBulkDeleting(false); setShowBulkConfirm(false)
    if (deleted > 0) { toast.success(`${deleted} report${deleted !== 1 ? 's' : ''} deleted`); setSelectedIds(new Set()); if (currentReport?.reportId && ids.includes(currentReport.reportId)) setCurrentReport(null); loadReportHistory() }
    else toast.error('Failed to delete reports')
  }

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
  }, [])

  const demoMode = useDemoMode()
  const salesDemoMode = useSalesDemo((state) => state.enabled)
  const isDemoActive = demoMode || salesDemoMode
  const displayReports = isDemoActive ? DEMO_REPORTS : (reportHistory || [])
  const visibleReports = showAllReports ? displayReports : displayReports.slice(0, 5)

  useEffect(() => {
    if (!selectAllRef.current || displayReports.length === 0) return
    const total = displayReports.length, count = displayReports.filter((r: any) => selectedIds.has(r.id)).length
    selectAllRef.current.indeterminate = count > 0 && count < total
  }, [selectedIds, displayReports])

  const allSelected = displayReports.length > 0 && displayReports.every((r: any) => selectedIds.has(r.id))
  const handleSelectAll = () => { if (allSelected) setSelectedIds(new Set()); else setSelectedIds(new Set(displayReports.map((r: any) => r.id))) }

  const reportsThisMonth = isDemoActive ? 4 : displayReports.filter((r: any) => { const d = new Date(r.createdAt || r.created_at), now = new Date(); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear() }).length
  const lastGenerated = isDemoActive ? 'Today, 30 minutes ago' : displayReports.length > 0 ? formatGeneratedAt((displayReports[0] as any).createdAt || (displayReports[0] as any).created_at) : 'Never'
  const isLoading = isFetchingHistory
  const handleViewReport = (id: string) => router.push(`/ai-reports/${id}`)
  const handleDownloadReport = (id: string) => router.push(`/ai-reports/${id}?print=1`)

  if (!isPro) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-10">
        <div className="text-center max-w-sm">
          <div className="w-14 h-14 rounded-2xl bg-violet-50 flex items-center justify-center mx-auto mb-5">
            <Lock size={24} className="text-violet-600" />
          </div>
          <h2 className="text-lg font-bold text-slate-900 mb-2.5">Pro Plan Required</h2>
          <p className="text-sm text-slate-500 leading-relaxed mb-6">This feature is available on the Pro plan and above.</p>
          <a href="/settings/billing/upgrade" className="inline-block bg-violet-600 hover:bg-violet-700 text-white px-6 py-2.5 rounded-lg text-sm font-semibold no-underline transition-colors">Upgrade to Pro</a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 max-w-[1320px] mx-auto">
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {/* Upgrade banner */}
      {showUpgradeBanner && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between bg-amber-50 border border-amber-400 rounded-xl px-5 py-3.5 mb-6 gap-3">
          <div className="flex items-center gap-2.5"><span className="text-lg">⚠️</span><span className="text-sm font-medium text-amber-900">This feature requires the Pro plan.</span></div>
          <a href="/settings/billing/upgrade" className="shrink-0 text-xs font-semibold text-white bg-amber-500 hover:bg-amber-600 rounded-lg px-4 py-2 no-underline whitespace-nowrap">Upgrade to Pro</a>
        </div>
      )}

      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-8">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight mb-1.5">Uncover Cost Savings, Risks, and Insights Across Your AWS — in Minutes</h1>
          <p className="text-sm text-slate-500 leading-relaxed">Generate executive-ready AI reports with actionable recommendations your team can use immediately.</p>
        </div>
        <button onClick={() => handleGenerateReport()} disabled={generatingType !== null}
          className={`flex items-center gap-2 bg-white text-violet-600 px-4 py-2.5 rounded-lg text-sm font-semibold border border-violet-200 whitespace-nowrap shrink-0 transition-colors ${generatingType !== null ? 'cursor-not-allowed opacity-70' : 'hover:bg-violet-50 cursor-pointer'}`}>
          {generatingType === 'weekly_summary' ? <><RefreshCw size={14} className="animate-spin" /> Generating...</> : <><Sparkles size={14} /> Generate Executive Summary</>}
        </button>
      </div>

      {/* 3 KPI cards */}
      {(() => {
        const lastReport = displayReports[0] as any
        const lastInsight = lastReport ? extractInsight(lastReport) : null
        const lastReportType = lastReport ? normalizeReportType(lastReport.type || lastReport.report_type || '') : null
        const lastTypeConfig = lastReportType ? typeConfig[lastReportType] : null
        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr] gap-4 mb-4">
            {/* Recommended next */}
            <div className="bg-slate-50 rounded-xl p-6 border border-slate-200">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Recommended Next</p>
              <div className="flex items-center gap-2.5 mb-2">
                <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center shrink-0"><Shield size={14} className="text-red-600" /></div>
                <p className="text-sm font-bold text-slate-900">Security Risk Report</p>
              </div>
              <p className="text-sm text-slate-600 leading-relaxed mb-2.5">{reportsThisMonth === 0 ? 'No reports generated yet — start here' : 'Active anomalies detected — security scan recommended'}</p>
              <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-3 text-xs text-red-600 font-semibold">2 active critical anomalies detected — security scan recommended now</div>
              <button onClick={() => handleGenerateReport('security')} disabled={generatingType !== null}
                className={`bg-red-600 hover:bg-red-700 text-white border-none rounded-lg px-4 py-2 text-xs font-bold inline-flex items-center gap-1.5 transition-colors ${generatingType !== null ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
                Generate security report →
              </button>
            </div>
            {/* Last outcome */}
            <div className="bg-white rounded-xl p-5 border border-slate-200">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Last Outcome</p>
              {lastInsight && lastTypeConfig ? (
                <>
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: lastTypeConfig.bg, color: lastTypeConfig.color }}>{lastTypeConfig.label}</span>
                    <span className="text-[10px] text-slate-400">{lastReport?.createdAt ? formatGeneratedAt(lastReport.createdAt) : ''}</span>
                  </div>
                  <p className="text-sm text-slate-700 leading-relaxed font-medium">{lastInsight}</p>
                </>
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="text-sm text-slate-400 leading-relaxed">No insights yet — generate your first report to surface key findings</p>
                  <button onClick={() => handleGenerateReport()} disabled={generatingType !== null} className="bg-transparent border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-semibold text-violet-600 cursor-pointer w-fit hover:bg-violet-50 transition-colors">Generate first report →</button>
                </div>
              )}
            </div>
            {/* Report activity */}
            <div className="bg-white rounded-xl p-5 border border-slate-200">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Report Activity</p>
              <div className="text-3xl font-bold text-slate-900 tracking-tight leading-none mb-2">{reportsThisMonth}</div>
              <p className="text-sm text-slate-600 mb-2.5">Reports generated this month</p>
              <div className="flex flex-wrap gap-1.5">
                {(['cost_analysis', 'security', 'infrastructure', 'executive'] as const).map(t => {
                  const count = displayReports.filter((r: any) => normalizeReportType(r.type || r.report_type || '') === t).length
                  const tc = typeConfig[t]
                  return count > 0 ? <span key={t} className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: tc.bg, color: tc.color }}>{tc.label} {count}</span> : null
                })}
              </div>
            </div>
          </div>
        )
      })()}

      {/* Report type cards */}
      <div className="mb-4">
        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-4">Available Reports</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { type: 'cost_analysis',  badge: 'High impact',  badgeColor: '#059669', badgeBg: '#F0FDF4' },
            { type: 'security',       badge: 'Relevant now', badgeColor: '#475569', badgeBg: '#F1F5F9' },
            { type: 'infrastructure', badge: null,           badgeColor: null,      badgeBg: null      },
            { type: 'executive',      badge: 'Board-ready',  badgeColor: '#7C3AED', badgeBg: '#F5F3FF' },
          ].map(({ type, badge, badgeColor, badgeBg }) => {
            const tc = typeConfig[type as NormalizedType]
            return (
              <div key={type} className="bg-white rounded-xl p-5 border border-slate-200 flex flex-col gap-2.5 hover:border-slate-300 hover:shadow-sm transition-all">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: tc.bg, color: tc.color }}>{tc.icon}</div>
                    <div>
                      <p className="text-sm font-bold text-slate-900 mb-1">{tc.title}</p>
                      <p className="text-xs text-slate-500 leading-relaxed">
                        {type === 'cost_analysis' ? 'Identify unused resources, rightsizing opportunities, and immediate savings.'
                          : type === 'security' ? 'Detect misconfigurations, IAM issues, and compliance gaps.'
                          : type === 'infrastructure' ? 'Analyze performance, bottlenecks, and reliability across services.'
                          : 'Board-ready insights combining cost, security, and performance.'}
                      </p>
                    </div>
                  </div>
                  {badge && <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full shrink-0 whitespace-nowrap" style={{ background: badgeBg!, color: badgeColor! }}>{badge}</span>}
                </div>
                <button onClick={() => handleGenerateReport(type)} disabled={generatingType !== null}
                  className={`self-start flex items-center gap-1.5 text-white border-none px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${generatingType !== null ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:opacity-90'}`}
                  style={{ background: generatingType === type ? tc.color : '#7C3AED' }}>
                  {generatingType === type ? <><RefreshCw size={11} className="animate-spin" /> Generating...</> : 'Generate →'}
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {/* Generation progress */}
      {generatingType !== null && (
        <div className="flex items-center gap-2.5 bg-violet-50 border border-violet-200 rounded-xl px-4 py-3 mb-5">
          <RefreshCw size={13} className="text-violet-600 shrink-0 animate-spin" />
          <span className="text-xs text-violet-700 font-medium">AI is analyzing your infrastructure data — usually takes 20–30 seconds</span>
        </div>
      )}

      {/* Reports list */}
      {isLoading && !isDemoActive ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-slate-100">
          <RefreshCw size={22} className="text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-400">Loading reports...</p>
        </div>
      ) : displayReports.length === 0 ? (
        <div className="bg-gradient-to-br from-violet-50 to-violet-100 rounded-2xl p-8 sm:p-14 text-center border border-violet-200">
          <div className="text-3xl mb-4">✨</div>
          <p className="text-lg font-bold text-slate-900 mb-2">Start uncovering insights in minutes</p>
          <p className="text-sm text-slate-500 leading-relaxed mb-6 max-w-sm mx-auto">Generate your first AI report to discover:</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-w-sm mx-auto mb-7 text-left">
            {['💰 Immediate cost-saving opportunities', '🔐 Hidden security risks and misconfigs', '⚙️ Infrastructure inefficiencies', '📊 Executive-ready summaries'].map(item => (
              <div key={item} className="text-xs text-slate-500 bg-white rounded-lg px-3.5 py-2.5 border border-violet-100">{item}</div>
            ))}
          </div>
          <button onClick={() => handleGenerateReport()} disabled={generatingType !== null}
            className={`text-white px-7 py-3 rounded-xl text-sm font-semibold border-none inline-flex items-center gap-2 transition-colors ${generatingType !== null ? 'bg-violet-400 cursor-not-allowed' : 'bg-violet-600 hover:bg-violet-700 cursor-pointer'}`}>
            {generatingType !== null ? <><RefreshCw size={13} className="animate-spin" /> Generating...</> : <><Sparkles size={13} /> Generate My First AI Report</>}
          </button>
          <p className="text-xs text-slate-400 mt-3">Takes ~2 minutes · No setup required · Read-only access</p>
        </div>
      ) : (
        <div>
          {/* List header */}
          <div className="flex items-center justify-between mb-3 min-h-8 px-1">
            <div className="flex items-center gap-2.5">
              <input ref={selectAllRef} type="checkbox" checked={allSelected} onChange={handleSelectAll} className="w-3.5 h-3.5 cursor-pointer accent-violet-600" />
              {selectedIds.size > 0
                ? <span className="text-xs text-slate-500 font-medium">{selectedIds.size} report{selectedIds.size !== 1 ? 's' : ''} selected</span>
                : <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Recent Reports</span>}
            </div>
            {selectedIds.size > 0 && (
              <button onClick={() => setShowBulkConfirm(true)} className="flex items-center gap-1.5 bg-red-50 text-red-600 border border-red-200 px-3.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer hover:bg-red-100 transition-colors">
                <Trash2 size={12} /> Delete Selected
              </button>
            )}
          </div>

          {/* Report rows */}
          <div className="flex flex-col gap-2">
            {visibleReports.map((report: any) => {
              const normalizedType = normalizeReportType(report.type || report.report_type || '')
              const type = typeConfig[normalizedType]
              const isSelected = selectedIds.has(report.id)
              const insight = extractInsight(report)
              const dateVal = report.createdAt || report.created_at
              const reportTitle = report.title || type.title

              return (
                <div key={report.id} className={`rounded-xl border transition-colors ${isSelected ? 'bg-violet-50 border-violet-200' : 'bg-white border-slate-100 hover:border-slate-200 hover:bg-slate-50'}`}>
                  <div className="flex items-start gap-3.5 p-4 sm:p-5">
                    <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(report.id)} className="mt-0.5 w-3.5 h-3.5 cursor-pointer shrink-0 accent-violet-600" />
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: type.bg, color: type.color }}>{type.icon}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="text-sm font-semibold text-slate-900">{reportTitle}</span>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0" style={{ background: type.bg, color: type.color }}>{type.label}</span>
                        <span className="flex items-center gap-1 text-[10px] font-semibold text-green-600 shrink-0"><CheckCircle2 size={10} /> Ready</span>
                        {normalizedType === 'cost_analysis' ? (
                          <a href="/cost-optimization" className="text-[10px] font-semibold text-green-600 no-underline" onClick={e => e.stopPropagation()}>· $1,697 savings — Apply now →</a>
                        ) : normalizedType === 'security' ? (
                          <a href="/anomalies" className="text-[10px] font-semibold text-red-600 no-underline" onClick={e => e.stopPropagation()}>· 2 risks detected — Fix now →</a>
                        ) : (() => { const chip = outcomeChip(normalizedType); return chip ? <span className="text-[10px] font-semibold shrink-0" style={{ color: chip.color }}>· {chip.label}</span> : null })()}
                      </div>
                      <p className="text-xs text-slate-400 mb-1">Generated {dateVal ? relativeTime(dateVal) : '—'}</p>
                      {insight && <p className="text-xs text-slate-600 leading-relaxed">{insight}</p>}
                    </div>
                    {/* Actions */}
                    <div className="flex items-center gap-1.5 shrink-0 mt-0.5 flex-wrap justify-end">
                      <button onClick={() => handleViewReport(report.id)} className="bg-violet-600 hover:bg-violet-700 text-white px-3.5 py-1.5 rounded-lg text-xs font-semibold border-none cursor-pointer transition-colors whitespace-nowrap">View Report</button>
                      <button onClick={() => handleDownloadReport(report.id)} className="bg-transparent text-slate-500 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-200 cursor-pointer flex items-center gap-1 hover:bg-slate-50 transition-colors whitespace-nowrap"><Download size={11} /> PDF</button>
                      <div className="relative">
                        <button onClick={e => { e.stopPropagation(); setOpenMenuId(openMenuId === report.id ? null : report.id) }}
                          className="bg-transparent border border-slate-200 text-slate-500 p-1.5 rounded-lg cursor-pointer flex items-center hover:bg-slate-50 transition-colors">
                          <MoreHorizontal size={14} />
                        </button>
                        {openMenuId === report.id && (
                          <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-50 min-w-[150px] p-1" onClick={e => e.stopPropagation()}>
                            <button onClick={() => { handleDownloadReport(report.id); setOpenMenuId(null) }} className="flex items-center gap-2 w-full px-3 py-2 rounded-lg border-none bg-transparent text-xs text-slate-600 cursor-pointer hover:bg-slate-50 font-medium text-left"><Download size={12} className="text-slate-400" /> Download PDF</button>
                            <div className="h-px bg-slate-100 my-1" />
                            <button onClick={() => { setDeleteTargetId(report.id); setOpenMenuId(null) }} className="flex items-center gap-2 w-full px-3 py-2 rounded-lg border-none bg-transparent text-xs text-slate-600 cursor-pointer hover:bg-red-50 hover:text-red-600 font-medium text-left"><Trash2 size={12} className="text-red-500" /> Delete</button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {displayReports.length > 5 && (
            <button onClick={() => setShowAllReports(!showAllReports)} className="bg-transparent border border-slate-200 rounded-xl px-6 py-2.5 text-xs font-semibold text-slate-500 cursor-pointer w-full mt-2.5 hover:bg-slate-50 transition-colors">
              <span className="flex items-center gap-1.5 justify-center">
                {showAllReports ? <><ChevronUp size={13} /> Show less</> : <><ChevronDown size={13} /> Show all {displayReports.length} reports</>}
              </span>
            </button>
          )}
        </div>
      )}

      {showBulkConfirm && <ConfirmModal title={`Delete ${selectedIds.size} report${selectedIds.size !== 1 ? 's' : ''}?`} body="This cannot be undone. The selected reports will be permanently removed." confirmLabel={`Delete ${selectedIds.size} report${selectedIds.size !== 1 ? 's' : ''}`} onConfirm={handleBulkDelete} onCancel={() => setShowBulkConfirm(false)} loading={isBulkDeleting} />}
      {deleteTargetId && <ConfirmModal title="Delete this report?" body="This cannot be undone. The report will be permanently removed." confirmLabel="Delete Report" onConfirm={handleDeleteSingle} onCancel={() => setDeleteTargetId(null)} loading={isBulkDeleting} />}
    </div>
  )
}