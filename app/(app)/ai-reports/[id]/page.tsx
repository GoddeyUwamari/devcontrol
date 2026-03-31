'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { aiReportsService, ReportDetail } from '@/lib/services/ai-reports.service'
import { useDemoMode } from '@/components/demo/demo-mode-toggle'
import { useSalesDemo } from '@/lib/demo/sales-demo-data'
import {
  ArrowLeft, Download, RefreshCw, AlertCircle,
  DollarSign, Shield, Server, BarChart3, CheckCircle2,
  TrendingUp, Lock, Zap, ChevronRight,
} from 'lucide-react'

// ─── Shared config ────────────────────────────────────────────────────────────

type NormalizedType = 'cost_analysis' | 'security' | 'infrastructure' | 'executive'

const typeConfig: Record<NormalizedType, {
  color: string; bg: string; label: string; title: string; icon: React.ReactNode
}> = {
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

const effortLabel: Record<string, string> = {
  low: 'Low effort', medium: 'Medium effort', high: 'High effort',
}

// ─── Demo data ────────────────────────────────────────────────────────────────

const DEMO_DETAILS: Record<string, ReportDetail> = {
  'report-1': {
    id: 'report-1', reportType: 'cost_analysis',
    dateRange: { from: '2026-02-25', to: '2026-03-26' },
    summary: 'AWS spend increased 14.3% to $6,847/mo driven primarily by Lambda invocation spikes in payment-processor.',
    executiveSummary: 'AWS spend increased 14.3% to $6,847/mo driven primarily by Lambda invocation spikes in payment-processor. Three zero-risk optimizations identified totaling $1,922/mo in savings. Recommend approving reserved instance pricing for RDS immediately. Overall cost trajectory is manageable with immediate action on identified recommendations.',
    keyHighlights: [
      'Lambda costs up 38% — payment-processor invocations spiked due to retry storms',
      '$1,922/mo in zero-risk savings identified across RDS, S3, and idle EC2',
      'RDS reserved instance pricing would save $840/mo with 0 operational changes',
      'S3 lifecycle policies on dev buckets could reduce storage costs by $310/mo',
    ],
    costAnalysis: {
      overview: 'Total AWS spend reached $6,847/month, a 14.3% increase from $5,990/month last period. The primary driver is a 38% spike in Lambda invocation costs, traced to retry loops in the payment-processor service triggered by upstream timeout issues. Compute costs remain steady at $2,100/month while database costs rose slightly to $1,840/month.',
      trends: 'Lambda invocations grew from 4.2M to 5.8M month-over-month. Storage costs have been creeping up 3-5% monthly due to accumulation in dev/staging S3 buckets without lifecycle policies. Network egress costs are stable.',
      recommendations: [
        'Enable RDS reserved instances for production-db — saves $840/mo with 1-year commitment',
        'Add S3 lifecycle policies on dev-* and staging-* buckets — saves $310/mo immediately',
        'Fix payment-processor retry logic to reduce Lambda invocations by ~40%',
        'Right-size worker-large EC2 instance from r5.2xlarge to r5.xlarge — saves $420/mo',
      ],
    },
    securityAnalysis: {
      overview: 'Security posture remains strong at 87/100. No critical vulnerabilities detected this period. Two medium-severity findings related to S3 bucket public-access defaults on legacy buckets.',
      topRisks: 'Legacy S3 buckets missing explicit public-access-block settings. One IAM role with overly broad permissions scope identified in data-pipeline service.',
      recommendations: [
        'Apply S3 public-access-block to 3 legacy buckets (30-minute fix)',
        'Scope down data-pipeline IAM role to specific S3 prefixes only',
      ],
    },
    performanceAnalysis: {
      overview: 'Deployment velocity remains in Elite DORA category with 12 deployments/week. Lead time averaged 2.4 hours. One production incident this period with 47-minute MTTR.',
      doraMetrics: 'Deployment frequency: 12/week (Elite). Lead time: 2.4h (Elite). Change failure rate: 1.8% (High). MTTR: 47 minutes (Elite).',
      recommendations: [
        'Investigate payment-processor timeout issues before next release cycle',
        'Add circuit breaker to Lambda retry logic to prevent cost spikes during upstream failures',
      ],
    },
    topRecommendations: [
      { title: 'Fix payment-processor retry storm', impact: 'high', description: 'Upstream timeout is triggering 3x Lambda retries, inflating invocation costs by ~$640/mo and causing cascading latency.', estimatedSavings: 640, effort: 'medium' },
      { title: 'RDS reserved instance pricing', impact: 'high', description: 'Switch production-db from on-demand to 1-year reserved pricing. Zero operational changes required.', estimatedSavings: 840, effort: 'low' },
      { title: 'S3 lifecycle policies on dev/staging', impact: 'medium', description: 'Add 30-day expiry lifecycle rules to dev-* and staging-* buckets. Storage has been accumulating unchecked.', estimatedSavings: 310, effort: 'low' },
      { title: 'Right-size worker-large EC2', impact: 'medium', description: 'CPU utilization on worker-large averages 18%. Downsizing from r5.2xlarge to r5.xlarge maintains headroom.', estimatedSavings: 420, effort: 'low' },
    ],
    metadata: { aiModel: 'claude-sonnet-4-20250514', generationTime: 18420, wasFallback: false, createdAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(), sentTo: null, sentAt: null, deliveryStatus: null },
  },
  'report-2': {
    id: 'report-2', reportType: 'security',
    dateRange: { from: '2026-01-01', to: '2026-03-26' },
    summary: 'Security score improved to 87/100, above industry benchmark of 74. No critical vulnerabilities detected.',
    executiveSummary: 'Security score improved to 87/100, above industry benchmark of 74. CIS AWS Benchmark at 87%, NIST CSF at 91%. PCI-DSS remains at 68% — remediation plan required within 30 days. No critical vulnerabilities detected this quarter, representing a significant improvement from Q4 2025.',
    keyHighlights: [
      'Security score 87/100 — 5 points above industry benchmark of 74',
      'PCI-DSS compliance at 68% — 30-day remediation plan required',
      'Zero critical vulnerabilities detected (down from 3 in Q4 2025)',
      'IAM access review identified 12 unused roles/policies for cleanup',
    ],
    costAnalysis: undefined,
    securityAnalysis: {
      overview: 'Overall security posture is strong and improving. The security score of 87/100 is above the industry benchmark of 74. CIS AWS Benchmark compliance stands at 87% and NIST CSF at 91%. The primary gap is PCI-DSS at 68%, which requires a formal remediation plan within 30 days to maintain compliance.',
      topRisks: 'PCI-DSS gap in cardholder data environment segmentation (3 findings). Legacy S3 buckets without encryption-at-rest defaults. Two EC2 instances with security groups allowing 0.0.0.0/0 on non-standard ports.',
      recommendations: [
        'Implement CHD environment network segmentation to close PCI-DSS gap — highest priority',
        'Enable default S3 encryption on 5 legacy buckets',
        'Restrict EC2 security group ingress rules on dev-bastion and legacy-api instances',
        'Complete IAM access review — remove 12 unused roles and 8 overly broad policies',
      ],
    },
    performanceAnalysis: undefined,
    topRecommendations: [
      { title: 'PCI-DSS network segmentation', impact: 'high', description: 'Cardholder data environment lacks proper network segmentation. Required for PCI-DSS compliance. Must be remediated within 30 days.', effort: 'high' },
      { title: 'IAM cleanup — 12 unused roles', impact: 'medium', description: 'Access review identified 12 unused IAM roles and 8 overly broad policies. Removing these reduces attack surface.', effort: 'low' },
      { title: 'S3 default encryption', impact: 'medium', description: 'Enable SSE-S3 encryption as default on 5 legacy buckets. CIS Benchmark requirement L1.', effort: 'low' },
      { title: 'EC2 security group hardening', impact: 'medium', description: 'Two instances have overly permissive ingress rules. Lock down to specific CIDR ranges.', effort: 'low' },
    ],
    metadata: { aiModel: 'claude-sonnet-4-20250514', generationTime: 21300, wasFallback: false, createdAt: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(), sentTo: null, sentAt: null, deliveryStatus: null },
  },
  'report-3': {
    id: 'report-3', reportType: 'infrastructure',
    dateRange: { from: '2026-02-25', to: '2026-03-26' },
    summary: 'All 8 services operational with 99.97% uptime. Engineering velocity rated Elite (top 10%).',
    executiveSummary: 'All 8 services operational with 99.97% uptime this period. Engineering velocity remains in the Elite DORA category, placing the team in the top 10% globally. Deployment frequency averaged 12/week with 2.4h lead time. One anomaly detected — CPU spike on production-worker-overloaded requires investigation before next sprint.',
    keyHighlights: [
      '99.97% uptime across all 8 services — only 13 minutes downtime this period',
      'DORA metrics: Elite category for deployment frequency and lead time',
      'production-worker-overloaded CPU spike detected — peak 94% for 40 minutes',
      'p99 API latency improved 23ms after indexing optimization on user-events table',
    ],
    costAnalysis: undefined,
    securityAnalysis: undefined,
    performanceAnalysis: {
      overview: 'Infrastructure health is excellent with 99.97% uptime across all 8 services. The one notable anomaly is a recurring CPU spike on the production-worker-overloaded instance, reaching 94% for ~40 minutes twice this period. API performance improved measurably following the user-events table indexing optimization.',
      doraMetrics: 'Deployment frequency: 12/week (Elite). Lead time for changes: 2.4h (Elite). Change failure rate: 1.8% (High performer). MTTR: 47 minutes (Elite). All four DORA metrics are trending positively.',
      recommendations: [
        'Investigate production-worker-overloaded CPU spikes — likely a job queue backlog issue',
        'Set up autoscaling for worker tier to handle burst load automatically',
        'Continue indexing optimizations — 3 more slow queries identified in this period',
        'Add p99 latency alerting thresholds to production-api service',
      ],
    },
    topRecommendations: [
      { title: 'Investigate worker CPU spike pattern', impact: 'high', description: 'production-worker-overloaded hit 94% CPU twice this period for ~40 minutes each. Likely job queue backlog. Requires root cause analysis.', effort: 'medium' },
      { title: 'Worker tier autoscaling', impact: 'medium', description: 'Add horizontal autoscaling to the worker tier to handle burst loads without manual intervention.', effort: 'medium' },
      { title: 'Query optimization — 3 slow queries', impact: 'medium', description: 'Three additional slow queries identified: orders join, analytics aggregation, and audit log scan. Each is a candidate for indexing.', effort: 'low' },
      { title: 'p99 latency alerting', impact: 'low', description: 'Add PagerDuty alerts for p99 > 500ms on production-api. Currently only p50 is monitored.', effort: 'low' },
    ],
    metadata: { aiModel: 'claude-sonnet-4-20250514', generationTime: 19800, wasFallback: false, createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), sentTo: null, sentAt: null, deliveryStatus: null },
  },
  'report-4': {
    id: 'report-4', reportType: 'executive',
    dateRange: { from: '2026-02-01', to: '2026-02-28' },
    summary: 'DevControl identified $23,064 in annualized savings this quarter with 12x ROI on platform investment.',
    executiveSummary: 'DevControl identified $23,064 in annualized savings this quarter. Security posture improved 5 points to 87/100, above industry benchmark. Infrastructure efficiency is at 67% with a clear path to 85%+ via approved optimizations. Engineering velocity is in the Elite DORA category. ROI on the DevControl platform investment stands at 12x for Q1 2026.',
    keyHighlights: [
      '$23,064 annualized savings identified — $1,922/mo actionable immediately',
      'Security score 87/100, up 5 points — above 74/100 industry benchmark',
      'Engineering velocity: Elite DORA (top 10% globally)',
      'Infrastructure efficiency at 67% — path to 85%+ approved and in progress',
      'Platform ROI: 12x on DevControl investment in Q1 2026',
    ],
    costAnalysis: {
      overview: 'AWS spend totaled $6,847/month in February. Three immediate cost optimizations have been identified totaling $1,570/month in zero-risk savings. Annualized, the total identified savings across the quarter is $23,064.',
      trends: 'Cost efficiency is improving quarter-over-quarter. Reserved instance coverage increased from 42% to 61%. Unused resource spend decreased from $890/mo to $440/mo.',
      recommendations: [
        'Approve RDS reserved instance migration ($840/mo savings, zero risk)',
        'Execute S3 lifecycle policy rollout ($310/mo savings, 1-hour implementation)',
        'Schedule right-sizing review for Q2 to address remaining 33% efficiency gap',
      ],
    },
    securityAnalysis: {
      overview: 'Security posture improved meaningfully this quarter. The 5-point improvement to 87/100 reflects successful remediation of the critical findings from Q4 2025. The outstanding PCI-DSS gap requires a formal remediation project in Q2.',
      topRisks: 'PCI-DSS compliance at 68% is the primary risk. Formal remediation project must begin in Q2. All other compliance frameworks are above industry benchmarks.',
      recommendations: [
        'Initiate PCI-DSS remediation project — assign technical lead by April 1',
        'Complete IAM access review (scoped and ready, low effort)',
      ],
    },
    performanceAnalysis: {
      overview: 'Engineering velocity is strong and improving. All four DORA metrics are in the Elite or High Performer categories. Infrastructure reliability at 99.97% uptime represents a 0.12% improvement from Q4.',
      doraMetrics: 'All four DORA metrics are Elite or High Performer: Deployment frequency 12/week, Lead time 2.4h, MTTR 47min, Change failure rate 1.8%.',
      recommendations: [
        'Maintain current deployment cadence — velocity is a competitive advantage',
        'Address worker CPU spike before it becomes a reliability incident',
      ],
    },
    topRecommendations: [
      { title: 'RDS reserved instance migration', impact: 'high', description: 'Immediate $840/mo savings with zero operational risk. Requires 1-year commitment approval.', estimatedSavings: 840, effort: 'low' },
      { title: 'PCI-DSS remediation project', impact: 'high', description: 'Must begin Q2. Network segmentation of CHD environment. Assign technical lead by April 1.', effort: 'high' },
      { title: 'S3 lifecycle policies', impact: 'medium', description: '$310/mo savings from dev/staging bucket lifecycle rules. 1-hour implementation.', estimatedSavings: 310, effort: 'low' },
      { title: 'Worker autoscaling', impact: 'medium', description: 'Prevent the recurring CPU spike on production-worker from becoming a reliability incident.', effort: 'medium' },
    ],
    metadata: { aiModel: 'claude-sonnet-4-20250514', generationTime: 24100, wasFallback: false, createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7).toISOString(), sentTo: null, sentAt: null, deliveryStatus: null },
  },
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function Skeleton({ width = '100%', height = '16px', radius = '6px' }: { width?: string; height?: string; radius?: string }) {
  return (
    <div style={{
      width, height, borderRadius: radius,
      background: 'linear-gradient(90deg, #F1F5F9 25%, #E2E8F0 50%, #F1F5F9 75%)',
      backgroundSize: '200% 100%',
      animation: 'shimmer 1.4s infinite',
    }} />
  )
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', borderRadius: '14px', border: '1px solid #F1F5F9', overflow: 'hidden' }}>
      <div style={{ padding: '18px 24px 14px', borderBottom: '1px solid #F8FAFC', display: 'flex', alignItems: 'center', gap: '8px' }}>
        {icon && <span style={{ color: '#64748B' }}>{icon}</span>}
        <h2 style={{ fontSize: '0.875rem', fontWeight: 700, color: '#0F172A', margin: 0, letterSpacing: '-0.01em' }}>
          {title}
        </h2>
      </div>
      <div style={{ padding: '20px 24px' }}>
        {children}
      </div>
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

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

    // Demo mode: serve static data for demo report IDs
    if (isDemoActive && DEMO_DETAILS[id]) {
      setReport(DEMO_DETAILS[id])
      setLoading(false)
      return
    }

    aiReportsService.getReportDetail(id).then(data => {
      setReport(data)
      setLoading(false)
    }).catch(err => {
      setLoading(false)
      if (err.message?.includes('not found') || err.message?.includes('Invalid')) {
        setNotFound(true)
      } else {
        setNotFound(true)
      }
    })
  }, [id, isDemoActive])

  // Auto-print if ?print=1 is in the URL
  useEffect(() => {
    if (!report) return
    if (typeof window !== 'undefined' && window.location.search.includes('print=1')) {
      const t = setTimeout(() => window.print(), 400)
      return () => clearTimeout(t)
    }
  }, [report])

  const handlePrint = () => window.print()

  // ── Render helpers ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ padding: '40px 56px', maxWidth: '900px', margin: '0 auto', fontFamily: 'Inter, system-ui, sans-serif' }}>
        <style>{`@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '32px' }}>
          <Skeleton width="120px" height="14px" />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <Skeleton height="32px" width="60%" />
          <Skeleton height="14px" width="40%" />
          <div style={{ height: '24px' }} />
          {[1, 2, 3].map(i => (
            <div key={i} style={{ background: '#fff', borderRadius: '14px', border: '1px solid #F1F5F9', padding: '24px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <Skeleton height="14px" width="30%" />
              <Skeleton height="12px" />
              <Skeleton height="12px" width="85%" />
              <Skeleton height="12px" width="70%" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (notFound || !report) {
    return (
      <div style={{ padding: '40px 56px', maxWidth: '900px', margin: '0 auto', fontFamily: 'Inter, system-ui, sans-serif' }}>
        <div style={{ background: '#fff', borderRadius: '16px', border: '1px solid #F1F5F9', padding: '64px 40px', textAlign: 'center' }}>
          <AlertCircle size={32} style={{ color: '#94A3B8', margin: '0 auto 16px' }} />
          <p style={{ fontSize: '1.05rem', fontWeight: 700, color: '#0F172A', margin: '0 0 8px' }}>Report not found</p>
          <p style={{ fontSize: '0.875rem', color: '#64748B', margin: '0 0 24px' }}>
            This report may have been deleted or you may not have access to it.
          </p>
          <button
            onClick={() => router.push('/ai-reports')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#7C3AED', color: '#fff', padding: '9px 18px', borderRadius: '7px', fontSize: '0.82rem', fontWeight: 600, border: 'none', cursor: 'pointer' }}>
            <ArrowLeft size={13} /> Back to Reports
          </button>
        </div>
      </div>
    )
  }

  const normalizedType = normalizeType(report.reportType)
  const type = typeConfig[normalizedType]
  const formattedDate = new Date(report.metadata.createdAt).toLocaleString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  const dateRange = `${new Date(report.dateRange.from).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} – ${new Date(report.dateRange.to).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`

  return (
    <div style={{ padding: '40px 56px 80px', maxWidth: '900px', margin: '0 auto', background: '#F9FAFB', minHeight: '100vh', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

        @media print {
          body { background: white !important; }
          .no-print { display: none !important; }
          .print-page { padding: 0 !important; background: white !important; max-width: 100% !important; }
          .print-header { display: block !important; }
          * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
        .print-header { display: none; }
      `}</style>

      {/* Print-only header */}
      <div className="print-header" style={{ marginBottom: '24px', paddingBottom: '16px', borderBottom: '2px solid #E2E8F0' }}>
        <p style={{ fontSize: '0.75rem', color: '#94A3B8', margin: '0 0 4px' }}>DevControl AI Report</p>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#0F172A', margin: '0 0 4px' }}>{type.title}</h1>
        <p style={{ fontSize: '0.8rem', color: '#64748B', margin: 0 }}>Generated {formattedDate} · Period: {dateRange}</p>
      </div>

      <div className="print-page">
        {/* Top nav */}
        <div className="no-print" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '28px' }}>
          <button
            onClick={() => router.push('/ai-reports')}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', color: '#64748B', fontSize: '0.82rem', fontWeight: 500, cursor: 'pointer', padding: '6px 0' }}>
            <ArrowLeft size={15} /> Back to Reports
          </button>
          <button
            onClick={handlePrint}
            style={{ display: 'flex', alignItems: 'center', gap: '7px', background: '#fff', border: '1px solid #E2E8F0', color: '#374151', padding: '8px 16px', borderRadius: '8px', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer' }}>
            <Download size={13} /> Download PDF
          </button>
        </div>

        {/* Report header card */}
        <div style={{ background: '#fff', borderRadius: '16px', border: '1px solid #F1F5F9', padding: '28px 32px', marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
            <div style={{ width: '44px', height: '44px', borderRadius: '10px', background: type.bg, color: type.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {type.icon}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '6px' }}>
                <h1 style={{ fontSize: '1.3rem', fontWeight: 700, color: '#0F172A', margin: 0, letterSpacing: '-0.02em' }}>
                  {type.title}
                </h1>
                <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '2px 9px', borderRadius: '100px', background: type.bg, color: type.color }}>
                  {type.label}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '0.7rem', fontWeight: 600, color: '#16A34A' }}>
                  <CheckCircle2 size={11} /> Ready
                </span>
              </div>
              <p style={{ fontSize: '0.78rem', color: '#94A3B8', margin: '0 0 4px' }}>
                Generated {formattedDate} · Manual
              </p>
              <p style={{ fontSize: '0.78rem', color: '#64748B', margin: 0 }}>
                Period: {dateRange}
              </p>
            </div>
          </div>
        </div>

        {/* Content sections */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* Executive Summary */}
          <div style={{
            background: '#fff',
            borderRadius: '12px',
            border: '1px solid #E2E8F0',
            borderLeft: '4px solid #7C3AED',
            padding: '24px 28px',
          }}>
            <h2 style={{ fontSize: '0.78rem', fontWeight: 700, color: '#7C3AED', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 12px' }}>
              Executive Summary
            </h2>
            <p style={{ fontSize: '0.925rem', color: '#1E293B', margin: 0, lineHeight: 1.75, fontWeight: 400 }}>
              {report.executiveSummary || report.summary}
            </p>
          </div>

          {/* Key Highlights */}
          {report.keyHighlights?.length > 0 && (
            <Section title="Key Highlights" icon={<Zap size={14} />}>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {report.keyHighlights.map((h, i) => (
                  <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', fontSize: '0.875rem', color: '#374151', lineHeight: 1.6 }}>
                    <ChevronRight size={14} style={{ color: '#7C3AED', flexShrink: 0, marginTop: '3px' }} />
                    {h}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* Cost Analysis */}
          {report.costAnalysis && (
            <Section title="Cost Analysis" icon={<DollarSign size={14} />}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                <div>
                  <p style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 6px' }}>Overview</p>
                  <p style={{ fontSize: '0.875rem', color: '#374151', margin: 0, lineHeight: 1.7 }}>{report.costAnalysis.overview}</p>
                </div>
                <div>
                  <p style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 6px' }}>Trends</p>
                  <p style={{ fontSize: '0.875rem', color: '#374151', margin: 0, lineHeight: 1.7 }}>{report.costAnalysis.trends}</p>
                </div>
                {report.costAnalysis.recommendations?.length > 0 && (
                  <div>
                    <p style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 8px' }}>Recommendations</p>
                    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {report.costAnalysis.recommendations.map((r, i) => (
                        <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '0.855rem', color: '#374151', lineHeight: 1.6 }}>
                          <span style={{ color: '#16A34A', fontWeight: 700, flexShrink: 0 }}>→</span> {r}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* Security Analysis */}
          {report.securityAnalysis && (
            <Section title="Security Analysis" icon={<Lock size={14} />}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                <div>
                  <p style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 6px' }}>Overview</p>
                  <p style={{ fontSize: '0.875rem', color: '#374151', margin: 0, lineHeight: 1.7 }}>{report.securityAnalysis.overview}</p>
                </div>
                <div>
                  <p style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 6px' }}>Top Risks</p>
                  <p style={{ fontSize: '0.875rem', color: '#374151', margin: 0, lineHeight: 1.7 }}>{report.securityAnalysis.topRisks}</p>
                </div>
                {report.securityAnalysis.recommendations?.length > 0 && (
                  <div>
                    <p style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 8px' }}>Recommendations</p>
                    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {report.securityAnalysis.recommendations.map((r, i) => (
                        <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '0.855rem', color: '#374151', lineHeight: 1.6 }}>
                          <span style={{ color: '#DC2626', fontWeight: 700, flexShrink: 0 }}>→</span> {r}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* Performance Analysis */}
          {report.performanceAnalysis && (
            <Section title="Performance & Deployments" icon={<TrendingUp size={14} />}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                <div>
                  <p style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 6px' }}>Overview</p>
                  <p style={{ fontSize: '0.875rem', color: '#374151', margin: 0, lineHeight: 1.7 }}>{report.performanceAnalysis.overview}</p>
                </div>
                <div>
                  <p style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 6px' }}>DORA Metrics</p>
                  <p style={{ fontSize: '0.875rem', color: '#374151', margin: 0, lineHeight: 1.7 }}>{report.performanceAnalysis.doraMetrics}</p>
                </div>
                {report.performanceAnalysis.recommendations?.length > 0 && (
                  <div>
                    <p style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 8px' }}>Recommendations</p>
                    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {report.performanceAnalysis.recommendations.map((r, i) => (
                        <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '0.855rem', color: '#374151', lineHeight: 1.6 }}>
                          <span style={{ color: '#2563EB', fontWeight: 700, flexShrink: 0 }}>→</span> {r}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* Top Recommendations */}
          {report.topRecommendations?.length > 0 && (
            <Section title="Top Recommendations" icon={<Zap size={14} />}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {report.topRecommendations.map((rec, i) => {
                  const impact = impactColors[rec.impact] || impactColors.medium
                  return (
                    <div key={i} style={{
                      border: '1px solid #F1F5F9', borderRadius: '10px', padding: '16px 18px',
                      borderLeft: `3px solid ${impact.color}`,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', marginBottom: '6px' }}>
                        <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0F172A', margin: 0 }}>{rec.title}</p>
                        <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                          <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '2px 8px', borderRadius: '100px', background: impact.bg, color: impact.color }}>
                            {rec.impact.charAt(0).toUpperCase() + rec.impact.slice(1)} impact
                          </span>
                          <span style={{ fontSize: '0.68rem', fontWeight: 600, padding: '2px 8px', borderRadius: '100px', background: '#F8FAFC', color: '#64748B', border: '1px solid #F1F5F9' }}>
                            {effortLabel[rec.effort]}
                          </span>
                        </div>
                      </div>
                      <p style={{ fontSize: '0.835rem', color: '#475569', margin: '0', lineHeight: 1.65 }}>{rec.description}</p>
                      {rec.estimatedSavings && (
                        <p style={{ fontSize: '0.78rem', fontWeight: 600, color: '#16A34A', margin: '8px 0 0' }}>
                          Est. savings: ${rec.estimatedSavings.toLocaleString()}/mo
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            </Section>
          )}

          {/* Footer metadata */}
          <div style={{ padding: '16px 20px', background: '#F8FAFC', borderRadius: '10px', border: '1px solid #F1F5F9' }}>
            <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
              {[
                { label: 'Model', value: 'DevControl AI' },
                { label: 'Generation time', value: report.metadata.generationTime ? `${(report.metadata.generationTime / 1000).toFixed(1)}s` : '—' },
                { label: 'Source', value: report.metadata.wasFallback ? 'Fallback' : 'AI-generated' },
                { label: 'Report ID', value: report.id.slice(0, 8) + '…' },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p style={{ fontSize: '0.68rem', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 2px' }}>{label}</p>
                  <p style={{ fontSize: '0.78rem', color: '#475569', margin: 0, fontWeight: 500 }}>{value}</p>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
