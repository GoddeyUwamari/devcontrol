import { AlertTriangle, CircleDashed } from 'lucide-react'
import { StatusIcon, StatusLabel, type StatusKind } from '@/components/ui/status-icon'
import { Skeleton } from '@/components/ui/skeleton'
import { EvidenceBadge, NEUTRAL_COLOR, toneText } from './evidence-badge'
import { EvidenceInfo } from './evidence-info'
import { CardArrowLink } from './card-arrow-link'
import type { AISummaryResult } from '@/lib/services/ai-summary.service'

/** The service card's state (the same union as dashboardFreshness.ts ServiceStatusState). */
export type ServiceStatusState = 'operational' | 'degraded' | 'unavailable' | 'checking'

interface InfrastructureIntelligenceProps {
  topRisk: string | null
  /**
   * From the AI summary: only 'none_identified' may render as "no risks".
   * 'no_urgent_findings' (W11) and 'all_urgent_reviewed' (W11b) carry their own backend
   * text in topRisk, shown as is, with no severity badge and no "Open top risk" link.
   */
  topRiskStatus: AISummaryResult['topRiskStatus']
  aiSummaryLoading: boolean
  /** DevControl's own service health (its /health check) -- never the customer's AWS. */
  systemStatus: { value: string; caption: string; operational: boolean; color: string; state: ServiceStatusState }
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
const SEVERITY_SUFFIX = /\s*\((critical|high|medium|low) severity\)$/

export function parseTopRiskSeverity(topRisk: string | null): TopRiskSeverity | null {
  const match = topRisk?.match(SEVERITY_SUFFIX)
  return match ? (match[1] as TopRiskSeverity) : null
}

/** The finding title without the severity suffix the chip already shows; unparsed text is returned whole. */
export function topRiskTitle(topRisk: string): string {
  return topRisk.replace(SEVERITY_SUFFIX, '')
}

// Red tint only for critical/high.
const SEVERITY_STYLE: Record<TopRiskSeverity, { label: string; color: string; background: string; border: string }> = {
  critical: { label: 'Critical', color: 'var(--text-danger)', background: 'var(--bg-danger)', border: 'var(--border-danger)' },
  high: { label: 'High', color: 'var(--text-danger)', background: 'var(--bg-danger)', border: 'var(--border-danger)' },
  medium: { label: 'Medium', color: 'var(--text-warning)', background: 'var(--bg-warning)', border: 'var(--border-warning)' },
  low: { label: 'Low', color: NEUTRAL_COLOR, background: 'var(--surface-2)', border: 'var(--border)' },
}
const NEUTRAL_CARD = { color: NEUTRAL_COLOR, background: 'var(--surface-2)', border: 'var(--border)' }

/** Filled status icon per severity (mock §8): error for critical/high, warning for medium, none for low. */
export const TOP_RISK_STATUS_KIND: Record<TopRiskSeverity, Extract<StatusKind, 'error' | 'warning'> | null> = {
  critical: 'error',
  high: 'error',
  medium: 'warning',
  low: null,
}

/** Filled status icon per service state (mock §2); "Checking…" is not a status and has none. */
export const SERVICE_STATUS_KIND: Record<ServiceStatusState, Extract<StatusKind, 'success' | 'warning' | 'error'> | null> = {
  operational: 'success',
  degraded: 'warning',
  unavailable: 'error',
  checking: null,
}

// Existing page over the same account findings Top Risk names.
const TOP_RISK_HREF = '/security#findings'

export const SERVICE_STATUS_TITLE = 'DevControl service status'

export const SYSTEM_HEALTH_EXPLANATION =
  "Measures whether DevControl's API and database respond to a health check. This indicator reflects DevControl application availability, not your connected AWS infrastructure uptime."

function TopRiskCard({ topRisk, topRiskStatus, aiSummaryLoading }: Omit<InfrastructureIntelligenceProps, 'systemStatus'>) {
  const identified = !aiSummaryLoading && topRiskStatus === 'identified' && !!topRisk
  const severity = identified ? parseTopRiskSeverity(topRisk) : null
  const style = severity ? SEVERITY_STYLE[severity] : NEUTRAL_CARD
  const headline = topRisk ? topRiskTitle(topRisk) : (topRiskStatus === 'none_identified' ? 'No urgent risks identified' : 'Risk status unavailable')
  const description = topRisk
    ? null
    : topRiskStatus === 'none_identified'
      ? "No active findings in DevControl's evaluated security checks."
      : 'DevControl could not evaluate current risks right now.'

  return (
    <div
      data-testid="top-risk-card"
      data-severity={severity ?? 'none'}
      className="rounded-2xl border p-5 h-full flex items-start gap-3"
      style={{ background: style.background, borderColor: style.border }}
    >
      {severity ? (
        TOP_RISK_STATUS_KIND[severity] && <StatusIcon kind={TOP_RISK_STATUS_KIND[severity]} size={20} className="mt-0.5" onTint data-testid="top-risk-icon" />
      ) : (
        // No severity (no risk, unavailable, loading, unparsed text): the neutral outline icon, unchanged.
        <AlertTriangle size={20} aria-hidden="true" className="shrink-0 mt-0.5" style={{ color: style.color }} />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <p className="text-ui font-semibold m-0" style={{ color: severity ? toneText(style.color) : 'var(--foreground)' }}>Top Risk</p>
            {severity && <EvidenceBadge label={SEVERITY_STYLE[severity].label} color={style.color} testId="top-risk-severity" />}
          </div>
          {/* Only an identified risk links to the findings, as before. */}
          {identified && <CardArrowLink href={TOP_RISK_HREF} label="Open top risk" />}
        </div>
        {aiSummaryLoading ? (
          <span className="flex flex-col gap-1.5">
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-3 w-1/2" />
          </span>
        ) : (
          <>
            <p className="text-meta text-ink leading-snug m-0 break-words">{headline}</p>
            {description && <p className="text-meta text-ink-muted leading-snug mt-1 mb-0">{description}</p>}
          </>
        )}
      </div>
    </div>
  )
}

function SystemHealthCard({ systemStatus }: { systemStatus: InfrastructureIntelligenceProps['systemStatus'] }) {
  const kind = SERVICE_STATUS_KIND[systemStatus.state]
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
      {kind ? (
        // Only Operational tints the card (--bg-success); the other states sit on --surface-2.
        <StatusIcon kind={kind} size={20} className="mt-0.5" onTint={systemStatus.operational} data-testid="system-health-icon" />
      ) : (
        <CircleDashed size={20} aria-hidden="true" className="shrink-0 mt-0.5" style={{ color: 'var(--text-secondary)' }} data-testid="system-health-icon" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-2 min-w-0">
            <p className="text-ui font-semibold text-ink m-0 truncate">{SERVICE_STATUS_TITLE}</p>
            <EvidenceInfo about={SERVICE_STATUS_TITLE} align="start">
              <p className="m-0">{SYSTEM_HEALTH_EXPLANATION}</p>
            </EvidenceInfo>
          </div>
        </div>
        <span
          className="inline-flex items-center gap-1.5 text-label font-semibold px-2 py-0.5 rounded-full border border-border"
          style={{ color: systemStatus.color, background: 'var(--surface-2)' }}
          data-testid="system-health-status"
        >
          {kind ? <StatusLabel kind={kind}>{systemStatus.value}</StatusLabel> : systemStatus.value}
        </span>
        <p className="text-meta text-ink-muted leading-snug mt-2 mb-0" data-testid="system-health-caption">{systemStatus.caption}</p>
      </div>
    </div>
  )
}

/**
 * Risk and status row: Top Risk (left) and DevControl service status (right).
 *
 * Top Risk's "No urgent risks identified" is a specific, falsifiable claim,
 * so it's shown only when the backend reports topRiskStatus
 * 'none_identified' (security evidence evaluated, no active findings) --
 * never merely because topRisk is null. Missing or failed evidence reads
 * "Risk status unavailable". Only an identified risk links to the findings,
 * through the arrow button; neither card is itself a link.
 *
 * DevControl service status is DevControl's own /health check (API +
 * database), never the customer's AWS. It has no link: its info panel says
 * what it measures.
 */
export function InfrastructureIntelligence({ topRisk, topRiskStatus, aiSummaryLoading, systemStatus }: InfrastructureIntelligenceProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6" data-testid="risk-status-row">
      <TopRiskCard topRisk={topRisk} topRiskStatus={topRiskStatus} aiSummaryLoading={aiSummaryLoading} />
      <SystemHealthCard systemStatus={systemStatus} />
    </div>
  )
}
