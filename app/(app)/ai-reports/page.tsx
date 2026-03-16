'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAIReports } from '@/lib/hooks/useAIReports'
import { GeneratedReport, ReportHistoryItem } from '@/lib/services/ai-reports.service'
import { Sparkles, RefreshCw, Download } from 'lucide-react'
import { toast } from 'sonner'
import { useDemoMode } from '@/components/demo/demo-mode-toggle'
import { useSalesDemo } from '@/lib/demo/sales-demo-data'

export default function AIReportsPage() {
  const router = useRouter()
  const { generateReport, getReportHistory, deleteReport, isGenerating, isFetchingHistory, error } = useAIReports()
  const [currentReport, setCurrentReport] = useState<GeneratedReport | null>(null)
  const [reportHistory, setReportHistory] = useState<ReportHistoryItem[]>([])

  // Fetch report history on mount
  useEffect(() => {
    loadReportHistory()
  }, [])

  const loadReportHistory = async () => {
    const history = await getReportHistory(10)
    setReportHistory(history)
  }

  const handleGenerateReport = async () => {
    toast.info('Generating AI report...')

    const report = await generateReport({
      dateRange: {
        from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        to: new Date().toISOString().split('T')[0],
      },
      reportType: 'weekly_summary',
    })

    if (report) {
      setCurrentReport(report)
      toast.success('Report generated successfully!')
      loadReportHistory()
    } else {
      toast.error(error || 'Failed to generate report')
    }
  }

  const handleDeleteReport = async (reportId: string) => {
    const success = await deleteReport(reportId)
    if (success) {
      toast.success('Report deleted')
      loadReportHistory()
      if (currentReport?.reportId === reportId) {
        setCurrentReport(null)
      }
    } else {
      toast.error('Failed to delete report')
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

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
      summary: 'AWS spend increased 14.3% to $6,847/mo driven primarily by Lambda invocation spikes in payment-processor. Three zero-risk optimizations identified totaling $1,922/mo in savings. Recommend approving reserved instance pricing for RDS immediately.',
      metrics: { savings: '$1,922/mo', risk: 'Low', confidence: '95%' },
    },
    {
      id: 'report-2',
      title: 'Security Posture Report — Q1 2026',
      type: 'security',
      status: 'completed',
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 6),
      summary: 'Security score improved to 87/100, above industry benchmark of 74. CIS AWS Benchmark at 87%, NIST CSF at 91%. PCI-DSS remains at 68% — remediation plan required within 30 days. No critical vulnerabilities detected.',
      metrics: { score: '87/100', frameworks: '3/4 passing', vulnerabilities: '0 critical' },
    },
    {
      id: 'report-3',
      title: 'Infrastructure Health Report — March 2026',
      type: 'infrastructure',
      status: 'completed',
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24),
      summary: 'All 8 services operational with 99.97% uptime. Engineering velocity rated Elite (top 10%). Deployment frequency at 12/week with 2.4hr lead time. One anomaly detected: CPU spike on production-worker-overloaded requires investigation.',
      metrics: { uptime: '99.97%', services: '8/8 healthy', velocity: 'Elite' },
    },
    {
      id: 'report-4',
      title: 'Executive Summary — February 2026',
      type: 'executive',
      status: 'completed',
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7),
      summary: 'DevControl identified $23,064 in annualized savings this quarter. Security posture improved 5 points. Infrastructure efficiency at 67% with clear path to 85%+ via approved optimizations. ROI on DevControl platform: 12x.',
      metrics: { savings: '$23,064/yr', roi: '12x', efficiency: '67%' },
    },
  ]

  const displayReports = isDemoActive ? DEMO_REPORTS : (reportHistory || [])

  const reportsThisMonth = isDemoActive ? 4 : displayReports.filter((r: any) => {
    const d = new Date(r.createdAt || r.created_at)
    const now = new Date()
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
  }).length

  const lastGenerated = isDemoActive
    ? 'Today, 30 minutes ago'
    : displayReports.length > 0
      ? new Date((displayReports[0] as any).createdAt || (displayReports[0] as any).created_at).toLocaleString()
      : 'Never'

  const typeConfig: Record<string, { color: string; bg: string; label: string }> = {
    cost_analysis:  { color: '#3B82F6', bg: '#EFF6FF', label: 'Cost Analysis'    },
    security:       { color: '#059669', bg: '#F0FDF4', label: 'Security'          },
    infrastructure: { color: '#7C3AED', bg: '#F5F3FF', label: 'Infrastructure'    },
    executive:      { color: '#D97706', bg: '#FFFBEB', label: 'Executive Summary' },
  }

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

      {/* PAGE HEADER */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '32px' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#0F172A', margin: '0 0 6px', letterSpacing: '-0.02em' }}>
            AI Reports
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>
            AI-powered executive summaries and infrastructure insights
          </p>
        </div>
        <button
          onClick={handleGenerateReport}
          disabled={isGenerating}
          style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            background: isGenerating ? '#A78BFA' : '#7C3AED',
            color: '#fff', padding: '10px 20px', borderRadius: '8px',
            fontSize: '0.875rem', fontWeight: 600, border: 'none',
            cursor: isGenerating ? 'not-allowed' : 'pointer',
          }}>
          {isGenerating
            ? <><RefreshCw size={15} /> Generating...</>
            : <><Sparkles size={15} /> Generate Report</>
          }
        </button>
      </div>

      {/* 3 KPI CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '28px' }}>
        {[
          { label: 'Reports This Month', value: reportsThisMonth, sub: 'Generated reports',                      valueColor: '#7C3AED' },
          { label: 'Last Generated',     value: lastGenerated,   sub: 'Most recent report',                     valueColor: '#0F172A' },
          { label: 'Report Types',       value: 4,               sub: 'Cost, Security, Infra, Executive',       valueColor: '#0F172A' },
        ].map(({ label, value, sub, valueColor }) => (
          <div key={label} style={{ background: '#fff', borderRadius: '14px', padding: '32px', border: '1px solid #E2E8F0' }}>
            <p style={{ fontSize: '0.72rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 16px' }}>{label}</p>
            <div style={{ fontSize: typeof value === 'number' ? '2.5rem' : '1.1rem', fontWeight: 700, color: valueColor, letterSpacing: '-0.02em', lineHeight: 1.2, marginBottom: '8px' }}>{value}</div>
            <p style={{ fontSize: '0.78rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>{sub}</p>
          </div>
        ))}
      </div>

      {/* REPORTS LIST */}
      {isLoading && !isDemoActive ? (
        <div style={{ background: '#fff', borderRadius: '16px', padding: '48px', textAlign: 'center', border: '1px solid #F1F5F9' }}>
          <RefreshCw size={24} style={{ color: '#94A3B8', margin: '0 auto 12px' }} />
          <p style={{ fontSize: '0.875rem', color: '#64748B', margin: 0 }}>Loading reports...</p>
        </div>
      ) : displayReports.length === 0 ? (
        <div style={{ background: '#fff', borderRadius: '16px', padding: '64px', textAlign: 'center', border: '1px solid #F1F5F9' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#F8FAFC', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <Sparkles size={22} style={{ color: '#94A3B8' }} />
          </div>
          <p style={{ fontSize: '1rem', fontWeight: 600, color: '#0F172A', margin: '0 0 6px' }}>No reports generated yet</p>
          <p style={{ fontSize: '0.875rem', color: '#475569', margin: '0 0 24px', lineHeight: 1.6 }}>
            Generate your first AI report to get executive summaries of your AWS infrastructure.
          </p>
          <button
            onClick={handleGenerateReport}
            style={{ background: '#7C3AED', color: '#fff', padding: '10px 24px', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600, border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            <Sparkles size={14} /> Generate First Report
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {displayReports.map((report: any) => {
            const type = typeConfig[report.type] || typeConfig.executive
            return (
              <div key={report.id} style={{
                background: '#fff', borderRadius: '14px',
                padding: '24px 28px', border: '1px solid #F1F5F9',
                transition: 'border-color 0.15s',
              }}
                onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#E2E8F0' }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = '#F1F5F9' }}>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '24px', alignItems: 'start' }}>
                  <div>
                    {/* Title row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                      <span style={{ fontSize: '0.95rem', fontWeight: 600, color: '#0F172A' }}>
                        {report.title || (report.report_type
                          ? report.report_type.replace('_', ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())
                          : 'Report')}
                      </span>
                      <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '2px 8px', borderRadius: '100px', background: type.bg, color: type.color, flexShrink: 0 }}>
                        {type.label}
                      </span>
                    </div>

                    {/* Summary */}
                    <p style={{ fontSize: '0.82rem', color: '#475569', margin: '0 0 14px', lineHeight: 1.7 }}>
                      {report.summary || report.report_data?.executive_summary || '—'}
                    </p>

                    {/* Metrics pills */}
                    {report.metrics && (
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        {Object.entries(report.metrics).map(([key, val]) => (
                          <span key={key} style={{ fontSize: '0.75rem', fontWeight: 600, padding: '3px 10px', borderRadius: '100px', background: '#F8FAFC', color: '#475569', border: '1px solid #F1F5F9' }}>
                            {String(val)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Right side */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '10px', flexShrink: 0 }}>
                    <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>
                      {new Date(report.createdAt || report.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={() => handleViewReport(report.id)}
                        style={{ background: '#7C3AED', color: '#fff', padding: '6px 14px', borderRadius: '6px', fontSize: '0.78rem', fontWeight: 600, border: 'none', cursor: 'pointer' }}>
                        View Report
                      </button>
                      <button
                        onClick={() => handleDownloadReport(report.id)}
                        style={{ background: 'none', color: '#475569', padding: '6px 12px', borderRadius: '6px', fontSize: '0.78rem', fontWeight: 500, border: '1px solid #E2E8F0', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Download size={12} /> PDF
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

    </div>
  )
}
