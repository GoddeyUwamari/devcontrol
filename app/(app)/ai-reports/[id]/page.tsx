'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { aiReportsService, ReportDetail } from '@/lib/services/ai-reports.service'
import { useDemoMode } from '@/components/demo/demo-mode-toggle'
import { useSalesDemo } from '@/lib/demo/sales-demo-data'
import {
  ArrowLeft, Download, AlertCircle,
  DollarSign, Shield, Server, BarChart3, CheckCircle2,
  TrendingUp, Lock, Zap, ChevronRight,
} from 'lucide-react'

type NormalizedType = 'cost_analysis' | 'security' | 'infrastructure' | 'executive'

const typeConfig: Record<NormalizedType, { color: string; bg: string; label: string; title: string; icon: React.ReactNode }> = {
  cost_analysis:  { color: '#16A34A', bg: '#F0FDF4', label: 'Cost',          title: 'Cost Optimization Report',     icon: <DollarSign size={16} /> },
  security:       { color: '#DC2626', bg: '#FEF2F2', label: 'Security',       title: 'Security Risk Report',         icon: <Shield size={16} />     },
  infrastructure: { color: '#2563EB', bg: '#EFF6FF', label: 'Infrastructure', title: 'Infrastructure Health Report', icon: <Server size={16} />     },
  executive:      { color: '#7C3AED', bg: '#F5F3FF', label: 'Executive',      title: 'Executive Summary',            icon: <BarChart3 size={16} />  },
}

const normalizeType = (raw: string): NormalizedType => {
  const map: Record<string, NormalizedType> = {
    cost_analysis: 'cost_analysis', cost: 'cost_analysis',
    security_insights: 'security', security: 'security',
    infrastructure: 'infrastructure', infrastructure_health: 'infrastructure',
    executive_summary: 'executive', executive: 'executive',
    weekly_summary: 'executive', monthly_summary: 'infrastructure',
  }
  return map[raw?.toLowerCase()] ?? 'executive'
}

const impactColors: Record<string, { color: string; bg: string }> = {
  high:   { color: '#DC2626', bg: '#FEF2F2' },
  medium: { color: '#D97706', bg: '#FFFBEB' },
  low:    { color: '#16A34A', bg: '#F0FDF4' },
}

const effortLabel: Record<string, string> = { low: 'Low effort', medium: 'Medium effort', high: 'High effort' }

const DEMO_DETAILS: Record<string, ReportDetail> = {
  'report-1': { id: 'report-1', reportType: 'cost_analysis', dateRange: { from: '2026-02-25', to: '2026-03-26' }, summary: 'AWS spend increased 14.3% to $6,847/mo driven primarily by Lambda invocation spikes in payment-processor.', executiveSummary: 'AWS spend increased 14.3% to $6,847/mo driven primarily by Lambda invocation spikes in payment-processor. Three zero-risk optimizations identified totaling $1,922/mo in savings. Recommend approving reserved instance pricing for RDS immediately. Overall cost trajectory is manageable with immediate action on identified recommendations.', keyHighlights: ['Lambda costs up 38% — payment-processor invocations spiked due to retry storms', '$1,922/mo in zero-risk savings identified across RDS, S3, and idle EC2', 'RDS reserved instance pricing would save $840/mo with 0 operational changes', 'S3 lifecycle policies on dev buckets could reduce storage costs by $310/mo'], costAnalysis: { overview: 'Total AWS spend reached $6,847/month, a 14.3% increase from $5,990/month last period. The primary driver is a 38% spike in Lambda invocation costs, traced to retry loops in the payment-processor service triggered by upstream timeout issues.', trends: 'Lambda invocations grew from 4.2M to 5.8M month-over-month. Storage costs have been creeping up 3-5% monthly due to accumulation in dev/staging S3 buckets without lifecycle policies.', recommendations: ['Enable RDS reserved instances for production-db — saves $840/mo with 1-year commitment', 'Add S3 lifecycle policies on dev-* and staging-* buckets — saves $310/mo immediately', 'Fix payment-processor retry logic to reduce Lambda invocations by ~40%', 'Right-size worker-large EC2 instance from r5.2xlarge to r5.xlarge — saves $420/mo'] }, securityAnalysis: { overview: 'Security posture remains strong at 87/100. No critical vulnerabilities detected this period.', topRisks: 'Legacy S3 buckets missing explicit public-access-block settings.', recommendations: ['Apply S3 public-access-block to 3 legacy buckets (30-minute fix)', 'Scope down data-pipeline IAM role to specific S3 prefixes only'] }, performanceAnalysis: { overview: 'Deployment velocity remains in Elite DORA category with 12 deployments/week.', doraMetrics: 'Deployment frequency: 12/week (Elite). Lead time: 2.4h (Elite). Change failure rate: 1.8% (High). MTTR: 47 minutes (Elite).', recommendations: ['Investigate payment-processor timeout issues before next release cycle', 'Add circuit breaker to Lambda retry logic to prevent cost spikes during upstream failures'] }, topRecommendations: [{ title: 'Fix payment-processor retry storm', impact: 'high', description: 'Upstream timeout is triggering 3x Lambda retries, inflating invocation costs by ~$640/mo.', estimatedSavings: 640, effort: 'medium' }, { title: 'RDS reserved instance pricing', impact: 'high', description: 'Switch production-db from on-demand to 1-year reserved pricing. Zero operational changes required.', estimatedSavings: 840, effort: 'low' }, { title: 'S3 lifecycle policies on dev/staging', impact: 'medium', description: 'Add 30-day expiry lifecycle rules to dev-* and staging-* buckets.', estimatedSavings: 310, effort: 'low' }, { title: 'Right-size worker-large EC2', impact: 'medium', description: 'CPU utilization on worker-large averages 18%. Downsizing from r5.2xlarge to r5.xlarge maintains headroom.', estimatedSavings: 420, effort: 'low' }], metadata: { aiModel: 'claude-sonnet-4-20250514', generationTime: 18420, wasFallback: false, createdAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(), sentTo: null, sentAt: null, deliveryStatus: null } },
  'report-2': { id: 'report-2', reportType: 'security', dateRange: { from: '2026-01-01', to: '2026-03-26' }, summary: 'Security score improved to 87/100, above industry benchmark of 74.', executiveSummary: 'Security score improved to 87/100, above industry benchmark of 74. CIS AWS Benchmark at 87%, NIST CSF at 91%. PCI-DSS remains at 68% — remediation plan required within 30 days.', keyHighlights: ['Security score 87/100 — 5 points above industry benchmark of 74', 'PCI-DSS compliance at 68% — 30-day remediation plan required', 'Zero critical vulnerabilities detected (down from 3 in Q4 2025)', 'IAM access review identified 12 unused roles/policies for cleanup'], costAnalysis: undefined, securityAnalysis: { overview: 'Overall security posture is strong and improving. The security score of 87/100 is above the industry benchmark of 74.', topRisks: 'PCI-DSS gap in cardholder data environment segmentation (3 findings).', recommendations: ['Implement CHD environment network segmentation to close PCI-DSS gap — highest priority', 'Enable default S3 encryption on 5 legacy buckets', 'Restrict EC2 security group ingress rules on dev-bastion and legacy-api instances', 'Complete IAM access review — remove 12 unused roles and 8 overly broad policies'] }, performanceAnalysis: undefined, topRecommendations: [{ title: 'PCI-DSS network segmentation', impact: 'high', description: 'Cardholder data environment lacks proper network segmentation. Must be remediated within 30 days.', effort: 'high' }, { title: 'IAM cleanup — 12 unused roles', impact: 'medium', description: 'Access review identified 12 unused IAM roles and 8 overly broad policies.', effort: 'low' }, { title: 'S3 default encryption', impact: 'medium', description: 'Enable SSE-S3 encryption as default on 5 legacy buckets.', effort: 'low' }, { title: 'EC2 security group hardening', impact: 'medium', description: 'Two instances have overly permissive ingress rules.', effort: 'low' }], metadata: { aiModel: 'claude-sonnet-4-20250514', generationTime: 21300, wasFallback: false, createdAt: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(), sentTo: null, sentAt: null, deliveryStatus: null } },
  'report-3': { id: 'report-3', reportType: 'infrastructure', dateRange: { from: '2026-02-25', to: '2026-03-26' }, summary: 'All 8 services operational with 99.97% uptime.', executiveSummary: 'All 8 services operational with 99.97% uptime this period. Engineering velocity remains in the Elite DORA category. One anomaly detected — CPU spike on production-worker-overloaded requires investigation.', keyHighlights: ['99.97% uptime across all 8 services — only 13 minutes downtime this period', 'DORA metrics: Elite category for deployment frequency and lead time', 'production-worker-overloaded CPU spike detected — peak 94% for 40 minutes', 'p99 API latency improved 23ms after indexing optimization'], costAnalysis: undefined, securityAnalysis: undefined, performanceAnalysis: { overview: 'Infrastructure health is excellent with 99.97% uptime across all 8 services.', doraMetrics: 'Deployment frequency: 12/week (Elite). Lead time for changes: 2.4h (Elite). Change failure rate: 1.8% (High performer). MTTR: 47 minutes (Elite).', recommendations: ['Investigate production-worker-overloaded CPU spikes', 'Set up autoscaling for worker tier to handle burst load automatically', 'Continue indexing optimizations — 3 more slow queries identified', 'Add p99 latency alerting thresholds to production-api service'] }, topRecommendations: [{ title: 'Investigate worker CPU spike pattern', impact: 'high', description: 'production-worker-overloaded hit 94% CPU twice this period for ~40 minutes each.', effort: 'medium' }, { title: 'Worker tier autoscaling', impact: 'medium', description: 'Add horizontal autoscaling to the worker tier to handle burst loads.', effort: 'medium' }, { title: 'Query optimization — 3 slow queries', impact: 'medium', description: 'Three additional slow queries identified: orders join, analytics aggregation, and audit log scan.', effort: 'low' }, { title: 'p99 latency alerting', impact: 'low', description: 'Add PagerDuty alerts for p99 > 500ms on production-api.', effort: 'low' }], metadata: { aiModel: 'claude-sonnet-4-20250514', generationTime: 19800, wasFallback: false, createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), sentTo: null, sentAt: null, deliveryStatus: null } },
  'report-4': { id: 'report-4', reportType: 'executive', dateRange: { from: '2026-02-01', to: '2026-02-28' }, summary: 'DevControl identified $23,064 in annualized savings this quarter with 12x ROI.', executiveSummary: 'DevControl identified $23,064 in annualized savings this quarter. Security posture improved 5 points to 87/100, above industry benchmark. Infrastructure efficiency is at 67% with a clear path to 85%+. ROI on the DevControl platform investment stands at 12x for Q1 2026.', keyHighlights: ['$23,064 annualized savings identified — $1,922/mo actionable immediately', 'Security score 87/100, up 5 points — above 74/100 industry benchmark', 'Engineering velocity: Elite DORA (top 10% globally)', 'Infrastructure efficiency at 67% — path to 85%+ approved and in progress', 'Platform ROI: 12x on DevControl investment in Q1 2026'], costAnalysis: { overview: 'AWS spend totaled $6,847/month in February. Three immediate cost optimizations totaling $1,570/month in zero-risk savings.', trends: 'Cost efficiency is improving quarter-over-quarter. Reserved instance coverage increased from 42% to 61%.', recommendations: ['Approve RDS reserved instance migration ($840/mo savings, zero risk)', 'Execute S3 lifecycle policy rollout ($310/mo savings, 1-hour implementation)', 'Schedule right-sizing review for Q2'] }, securityAnalysis: { overview: 'Security posture improved meaningfully this quarter with a 5-point improvement to 87/100.', topRisks: 'PCI-DSS compliance at 68% is the primary risk. Formal remediation project must begin in Q2.', recommendations: ['Initiate PCI-DSS remediation project — assign technical lead by April 1', 'Complete IAM access review'] }, performanceAnalysis: { overview: 'Engineering velocity is strong and improving. All four DORA metrics are in the Elite or High Performer categories.', doraMetrics: 'All four DORA metrics are Elite or High Performer: Deployment frequency 12/week, Lead time 2.4h, MTTR 47min, Change failure rate 1.8%.', recommendations: ['Maintain current deployment cadence — velocity is a competitive advantage', 'Address worker CPU spike before it becomes a reliability incident'] }, topRecommendations: [{ title: 'RDS reserved instance migration', impact: 'high', description: 'Immediate $840/mo savings with zero operational risk.', estimatedSavings: 840, effort: 'low' }, { title: 'PCI-DSS remediation project', impact: 'high', description: 'Must begin Q2. Network segmentation of CHD environment. Assign technical lead by April 1.', effort: 'high' }, { title: 'S3 lifecycle policies', impact: 'medium', description: '$310/mo savings from dev/staging bucket lifecycle rules.', estimatedSavings: 310, effort: 'low' }, { title: 'Worker autoscaling', impact: 'medium', description: 'Prevent the recurring CPU spike on production-worker from becoming a reliability incident.', effort: 'medium' }], metadata: { aiModel: 'claude-sonnet-4-20250514', generationTime: 24100, wasFallback: false, createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7).toISOString(), sentTo: null, sentAt: null, deliveryStatus: null } },
}

function Skeleton({ width = '100%', height = '16px', radius = '6px' }: { width?: string; height?: string; radius?: string }) {
  return <div style={{ width, height, borderRadius: radius, background: 'linear-gradient(90deg, #F1F5F9 25%, #E2E8F0 50%, #F1F5F9 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite' }} />
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
      <div className="px-5 sm:px-6 py-4 border-b border-slate-50 flex items-center gap-2">
        {icon && <span className="text-slate-500">{icon}</span>}
        <h2 className="text-sm font-bold text-slate-900 tracking-tight">{title}</h2>
      </div>
      <div className="px-5 sm:px-6 py-5">{children}</div>
    </div>
  )
}

export default function ReportDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params?.id as string
  const demoMode = useDemoMode()
  const salesDemoMode = useSalesDemo((state) => state.enabled)
  const isDemoActive = demoMode || salesDemoMode
  const [report, setReport] = useState<ReportDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!id) return
    if (isDemoActive && DEMO_DETAILS[id]) { setReport(DEMO_DETAILS[id]); setLoading(false); return }
    aiReportsService.getReportDetail(id).then(data => { setReport(data); setLoading(false) }).catch(() => { setLoading(false); setNotFound(true) })
  }, [id, isDemoActive])

  useEffect(() => {
    if (!report) return
    if (typeof window !== 'undefined' && window.location.search.includes('print=1')) {
      const t = setTimeout(() => window.print(), 400); return () => clearTimeout(t)
    }
  }, [report])

  if (loading) {
    return (
      <div className="px-4 py-8 sm:px-6 lg:px-14 max-w-3xl mx-auto">
        <style>{`@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
        <div className="flex flex-col gap-4">
          <Skeleton width="120px" height="14px" />
          <Skeleton height="32px" width="60%" />
          <Skeleton height="14px" width="40%" />
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white rounded-xl border border-slate-100 p-6 flex flex-col gap-2.5">
              <Skeleton height="14px" width="30%" /><Skeleton height="12px" /><Skeleton height="12px" width="85%" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (notFound || !report) {
    return (
      <div className="px-4 py-8 sm:px-6 lg:px-14 max-w-3xl mx-auto">
        <div className="bg-white rounded-2xl border border-slate-100 p-16 text-center">
          <AlertCircle size={32} className="text-slate-300 mx-auto mb-4" />
          <p className="text-base font-bold text-slate-900 mb-2">Report not found</p>
          <p className="text-sm text-slate-400 mb-6">This report may have been deleted or you may not have access to it.</p>
          <button onClick={() => router.push('/ai-reports')} className="inline-flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white px-4 py-2.5 rounded-lg text-xs font-semibold border-none cursor-pointer transition-colors">
            <ArrowLeft size={12} /> Back to Reports
          </button>
        </div>
      </div>
    )
  }

  const normalizedType = normalizeType(report.reportType)
  const type = typeConfig[normalizedType]
  const formattedDate = new Date(report.metadata.createdAt).toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  const dateRange = `${new Date(report.dateRange.from).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} – ${new Date(report.dateRange.to).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 max-w-3xl mx-auto">
      <style>{`
        @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
        @media print {
          body { background: white !important; }
          .no-print { display: none !important; }
          * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>

      {/* Top nav */}
      <div className="no-print flex items-center justify-between mb-7">
        <button onClick={() => router.push('/ai-reports')} className="flex items-center gap-1.5 bg-transparent border-none text-slate-500 text-xs font-medium cursor-pointer hover:text-slate-700 transition-colors">
          <ArrowLeft size={14} /> Back to Reports
        </button>
        <button onClick={() => window.print()} className="flex items-center gap-1.5 bg-white border border-slate-200 text-slate-600 px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer hover:bg-slate-50 transition-colors">
          <Download size={12} /> Download PDF
        </button>
      </div>

      {/* Report header */}
      <div className="bg-white rounded-xl border border-slate-100 p-5 sm:p-7 mb-4">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: type.bg, color: type.color }}>{type.icon}</div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1.5">
              <h1 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight">{type.title}</h1>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: type.bg, color: type.color }}>{type.label}</span>
              <span className="flex items-center gap-1 text-[10px] font-semibold text-green-600"><CheckCircle2 size={10} /> Ready</span>
            </div>
            <p className="text-xs text-slate-400 mb-0.5">Generated {formattedDate} · Manual</p>
            <p className="text-xs text-slate-500">Period: {dateRange}</p>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {/* Executive Summary */}
        <div className="bg-white rounded-xl border border-slate-100 border-l-[4px] border-l-violet-600 px-5 sm:px-7 py-5">
          <h2 className="text-[10px] font-bold text-violet-600 uppercase tracking-widest mb-3">Executive Summary</h2>
          <p className="text-sm text-slate-700 leading-relaxed">{report.executiveSummary || report.summary}</p>
        </div>

        {/* Key Highlights */}
        {report.keyHighlights?.length > 0 && (
          <Section title="Key Highlights" icon={<Zap size={13} />}>
            <ul className="list-none p-0 m-0 flex flex-col gap-2">
              {report.keyHighlights.map((h, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm text-slate-600 leading-relaxed">
                  <ChevronRight size={13} className="text-violet-600 shrink-0 mt-0.5" />{h}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Cost Analysis */}
        {report.costAnalysis && (
          <Section title="Cost Analysis" icon={<DollarSign size={13} />}>
            <div className="flex flex-col gap-4">
              {[{ label: 'Overview', text: report.costAnalysis.overview }, { label: 'Trends', text: report.costAnalysis.trends }].map(({ label, text }) => (
                <div key={label}><p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">{label}</p><p className="text-sm text-slate-600 leading-relaxed">{text}</p></div>
              ))}
              {report.costAnalysis.recommendations?.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Recommendations</p>
                  <ul className="list-none p-0 m-0 flex flex-col gap-1.5">
                    {report.costAnalysis.recommendations.map((r, i) => <li key={i} className="flex items-start gap-2 text-sm text-slate-600 leading-relaxed"><span className="text-green-600 font-bold shrink-0">→</span>{r}</li>)}
                  </ul>
                </div>
              )}
            </div>
          </Section>
        )}

        {/* Security Analysis */}
        {report.securityAnalysis && (
          <Section title="Security Analysis" icon={<Lock size={13} />}>
            <div className="flex flex-col gap-4">
              {[{ label: 'Overview', text: report.securityAnalysis.overview }, { label: 'Top Risks', text: report.securityAnalysis.topRisks }].map(({ label, text }) => (
                <div key={label}><p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">{label}</p><p className="text-sm text-slate-600 leading-relaxed">{text}</p></div>
              ))}
              {report.securityAnalysis.recommendations?.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Recommendations</p>
                  <ul className="list-none p-0 m-0 flex flex-col gap-1.5">
                    {report.securityAnalysis.recommendations.map((r, i) => <li key={i} className="flex items-start gap-2 text-sm text-slate-600 leading-relaxed"><span className="text-red-600 font-bold shrink-0">→</span>{r}</li>)}
                  </ul>
                </div>
              )}
            </div>
          </Section>
        )}

        {/* Performance Analysis */}
        {report.performanceAnalysis && (
          <Section title="Performance & Deployments" icon={<TrendingUp size={13} />}>
            <div className="flex flex-col gap-4">
              {[{ label: 'Overview', text: report.performanceAnalysis.overview }, { label: 'DORA Metrics', text: report.performanceAnalysis.doraMetrics }].map(({ label, text }) => (
                <div key={label}><p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">{label}</p><p className="text-sm text-slate-600 leading-relaxed">{text}</p></div>
              ))}
              {report.performanceAnalysis.recommendations?.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Recommendations</p>
                  <ul className="list-none p-0 m-0 flex flex-col gap-1.5">
                    {report.performanceAnalysis.recommendations.map((r, i) => <li key={i} className="flex items-start gap-2 text-sm text-slate-600 leading-relaxed"><span className="text-blue-600 font-bold shrink-0">→</span>{r}</li>)}
                  </ul>
                </div>
              )}
            </div>
          </Section>
        )}

        {/* Top Recommendations */}
        {report.topRecommendations?.length > 0 && (
          <Section title="Top Recommendations" icon={<Zap size={13} />}>
            <div className="flex flex-col gap-3">
              {report.topRecommendations.map((rec, i) => {
                const impact = impactColors[rec.impact] || impactColors.medium
                return (
                  <div key={i} className="border border-slate-100 rounded-xl p-4" style={{ borderLeft: `3px solid ${impact.color}` }}>
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-1.5">
                      <p className="text-sm font-semibold text-slate-900">{rec.title}</p>
                      <div className="flex gap-1.5 shrink-0 flex-wrap">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: impact.bg, color: impact.color }}>{rec.impact.charAt(0).toUpperCase() + rec.impact.slice(1)} impact</span>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-50 text-slate-500 border border-slate-100">{effortLabel[rec.effort]}</span>
                      </div>
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed">{rec.description}</p>
                    {rec.estimatedSavings && <p className="text-xs font-semibold text-green-600 mt-2">Est. savings: ${rec.estimatedSavings.toLocaleString()}/mo</p>}
                  </div>
                )
              })}
            </div>
          </Section>
        )}

        {/* Footer metadata */}
        <div className="bg-slate-50 rounded-xl border border-slate-100 px-5 py-4">
          <div className="flex flex-wrap gap-5">
            {[{ label: 'Model', value: 'DevControl AI' }, { label: 'Generation time', value: report.metadata.generationTime ? `${(report.metadata.generationTime / 1000).toFixed(1)}s` : '—' }, { label: 'Source', value: report.metadata.wasFallback ? 'Fallback' : 'AI-generated' }, { label: 'Report ID', value: report.id.slice(0, 8) + '…' }].map(({ label, value }) => (
              <div key={label}>
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-0.5">{label}</p>
                <p className="text-xs text-slate-500 font-medium">{value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}