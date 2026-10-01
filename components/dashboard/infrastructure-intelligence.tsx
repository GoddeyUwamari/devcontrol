import Link from 'next/link'
import { AlertTriangle, Activity, ArrowRight, ChevronRight } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { EvidenceBadge, NEUTRAL_COLOR } from './evidence-badge'
import { EvidenceInfo } from './evidence-info'

interface InfrastructureIntelligenceProps {
  topRisk: string | null
  /** From the AI summary: only 'none_identified' may render as "no risks". */
  topRiskStatus: 'identified' | 'none_identified' | 'unavailable'
  aiSummaryLoading: boolean
  /** DevControl's own service health (its /health check) -- never the customer's AWS. */
  systemStatus: { value: string; detail: string; operational: boolean; color: string; dotColor: string }
}

export type TopRiskSeverity = 'critical' | 'high' | 'medium' | 'low'

/**
 * The finding's own severity, from the deterministic Top Risk format the
 * backend writes for account findings (ai-summary.service.ts topRiskFor:
 * "<title> (<severity> severity)", severity constrained to
 * critical/high/medium/low by account_security_findings). Anything else --
 * the resource-compliance count line, demo text -- has no severity, and gets
 * no badge rather than a guessed one.
 * Follow-up: expose severity as its own field instead of parsing text.
 */
export function parseTopRiskSeverity(topRisk: string | null): TopRiskSeverity | null {
  const match = topRisk?.match(/\((critical|high|medium|low) severity\)$/)
  return match ? (match[1] as TopRiskSeverity) : null
}

// Red tint only for critical/high.
const SEVERITY_STYLE: Record<TopRiskSeverity, { label: string; color: string; background: string; border: string }> = {
  critical: { label: 'Critical', color: 'var(--text-danger)', background: 'var(--bg-danger)', border: 'var(--border-danger)' },
  high: { label: 'High', color: 'var(--text-danger)', background: 'var(--bg-danger)', border: 'var(--border-danger)' },
  medium: { label: 'Medium', color: 'var(--text-warning)', background: 'var(--bg-warning)', border: 'var(--border-warning)' },
  low: { label: 'Low', color: NEUTRAL_COLOR, background: 'var(--surface-2)', border: 'var(--border)' },
}
const NEUTRAL_CARD = { color: NEUTRAL_COLOR, background: 'var(--surface-2)', border: 'var(--border)' }

// Existing page over the same account findings Top Risk names.
const TOP_RISK_HREF = '/security#findings'
const SYSTEM_STATUS_HREF = '/admin/monitoring'

export const SYSTEM_HEALTH_DISCLAIMER = 'Not a status of your AWS resources.'
export const SYSTEM_HEALTH_EXPLANATION =
  "Measures whether DevControl's API and database respond to a health check. This indicator reflects DevControl application availability, not your connected AWS infrastructure uptime."

function TopRiskCard({ topRisk, topRiskStatus, aiSummaryLoading }: Omit<InfrastructureIntelligenceProps, 'systemStatus'>) {
  const identified = !aiSummaryLoading && topRiskStatus === 'identified' && !!topRisk
  const severity = identified ? parseTopRiskSeverity(topRisk) : null
  const style = severity ? SEVERITY_STYLE[severity] : NEUTRAL_CARD
  const headline = topRisk ?? (topRiskStatus === 'none_identified' ? 'No urgent risks identified' : 'Risk status unavailable')
  const description = topRisk
    ? null
    : topRiskStatus === 'none_identified'
      ? "No active findings in DevControl's evaluated security checks."
      : 'DevControl could not evaluate current risks right now.'

  const content = (
    <div
      data-testid="top-risk-card"
      data-severity={severity ?? 'none'}
      className="rounded-2xl border p-5 h-full flex items-start gap-3"
      style={{ background: style.background, borderColor: style.border }}
    >
      <AlertTriangle size={20} aria-hidden="true" className="shrink-0 mt-0.5" style={{ color: style.color }} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 mb-1.5">
          <p className="text-sm font-semibold m-0" style={{ color: severity ? style.color : 'var(--foreground)' }}>Top Risk</p>
          {severity && <EvidenceBadge label={SEVERITY_STYLE[severity].label} color={style.color} testId="top-risk-severity" />}
        </div>
        {aiSummaryLoading ? (
          <span className="flex flex-col gap-1.5">
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-3 w-1/2" />
          </span>
        ) : (
          <>
            <p className="text-[13px] text-foreground leading-snug m-0 break-words">{headline}</p>
            {description && <p className="text-xs text-[var(--text-secondary)] leading-snug mt-1 mb-0">{description}</p>}
          </>
        )}
      </div>
      {identified && <ChevronRight size={18} aria-hidden="true" className="shrink-0 self-center text-[var(--text-secondary)]" />}
    </div>
  )
  return identified ? <Link href={TOP_RISK_HREF} className="no-underline block h-full" aria-label={`Top Risk: ${topRisk}`}>{content}</Link> : content
}

function SystemHealthCard({ systemStatus }: { systemStatus: InfrastructureIntelligenceProps['systemStatus'] }) {
  // Green only when DevControl's own health check reports operational.
  const tint = systemStatus.operational
    ? { background: 'var(--bg-success)', border: 'var(--border-success)' }
    : { background: 'var(--surface-2)', border: 'var(--border)' }
  return (
    <div
      data-testid="system-health-card"
      className="relative rounded-2xl border p-5 h-full flex items-start gap-3"
      style={{ background: tint.background, borderColor: tint.border }}
    >
      <Activity size={20} aria-hidden="true" className="shrink-0 mt-0.5" style={{ color: systemStatus.color }} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <Link href={SYSTEM_STATUS_HREF} className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground no-underline hover:underline min-w-0">
            <span className="truncate">DevControl System Health</span>
            <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" className="text-[var(--text-secondary)] shrink-0" />
          </Link>
          <EvidenceInfo label="DevControl System Health details" title="DevControl Platform Health">
            <p className="m-0">{SYSTEM_HEALTH_EXPLANATION}</p>
          </EvidenceInfo>
        </div>
        <span
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-full border border-border"
          style={{ color: systemStatus.color, background: 'var(--surface-2)' }}
        >
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: systemStatus.dotColor }} aria-hidden="true" />
          {systemStatus.value}
        </span>
        <p className="text-xs text-[var(--text-secondary)] leading-snug mt-2 mb-0">{systemStatus.detail}</p>
        <p className="text-xs text-[var(--text-secondary)] leading-snug mt-0.5 mb-0">{SYSTEM_HEALTH_DISCLAIMER}</p>
      </div>
    </div>
  )
}

/**
 * Risk and status row: Top Risk (left) and DevControl System Health (right).
 *
 * Top Risk's "No urgent risks identified" is a specific, falsifiable claim,
 * so it's shown only when the backend reports topRiskStatus
 * 'none_identified' (security evidence evaluated, no active findings) --
 * never merely because topRisk is null. Missing or failed evidence reads
 * "Risk status unavailable". Only an identified risk links to the findings.
 *
 * System Health is DevControl's own /health check (API + database), never
 * the customer's AWS, and the card says so on its face.
 */
export function InfrastructureIntelligence({ topRisk, topRiskStatus, aiSummaryLoading, systemStatus }: InfrastructureIntelligenceProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6" data-testid="risk-status-row">
      <TopRiskCard topRisk={topRisk} topRiskStatus={topRiskStatus} aiSummaryLoading={aiSummaryLoading} />
      <SystemHealthCard systemStatus={systemStatus} />
    </div>
  )
}
