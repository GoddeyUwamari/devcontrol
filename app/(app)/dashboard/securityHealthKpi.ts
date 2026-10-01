import type { SystemIntelligenceComponentScore } from '@/lib/services/system-intelligence.service'

export interface SecurityKpiBadge {
  label: string
  direction: 'up' | 'flat' | 'down'
  color: string
}

export interface SecurityKpi {
  /** Large KPI value. Only a number when the canonical component is ready. */
  value: string
  /** The ready component's score, else null (so no "/100" suffix is shown). */
  score: number | null
  badge?: SecurityKpiBadge
}

// Descriptive labels for the security component's own status -- which the
// backend derives at the component's 80/60 thresholds (good/warning/risk).
// Deliberately not benchmark language ("Elite Tier", "Above baseline"): no
// external benchmark exists behind this score.
export const SECURITY_STATUS_BADGE: Record<SystemIntelligenceComponentScore['status'], SecurityKpiBadge> = {
  good: { label: 'Strong', direction: 'up', color: 'var(--text-success)' },
  warning: { label: 'Needs attention', direction: 'flat', color: 'var(--text-warning)' },
  risk: { label: 'At risk', direction: 'down', color: 'var(--text-danger)' },
}

type SeverityCounts = { critical: number; high: number; medium: number; low: number }

/**
 * The Security Posture info panel's lines, from data the Dashboard already
 * loads (the same reads behind Security Key Findings), in its existing
 * wording: active account-level finding counts by severity (zero counts
 * omitted), resource compliance, and the security component's own
 * evaluation-state reason. A failed request reads "Unavailable", never a
 * zero or an empty result.
 */
export function computeSecurityEvidence(params: {
  isDemoActive: boolean
  isLoading: boolean
  findingCounts: SeverityCounts | null | undefined
  findingsError: boolean
  /** Already-formatted resource compliance breakdown ("2 High · 1 Low"), or null when not evaluated. */
  complianceBreakdown: string | null
  resourceComplianceError: boolean
  securityComponent: Pick<SystemIntelligenceComponentScore, 'reason'> | undefined
}): { findings: string[]; resourceCompliance: string | null; evaluation: string | null } {
  const { isDemoActive, isLoading, findingCounts, findingsError, complianceBreakdown, resourceComplianceError, securityComponent } = params
  if (isDemoActive) return { findings: [], resourceCompliance: null, evaluation: null }
  if (isLoading) return { findings: ['Loading…'], resourceCompliance: null, evaluation: null }

  const counts = findingsError
    ? ['Account-level findings: Unavailable']
    : (['critical', 'high', 'medium', 'low'] as const)
        .filter((tier) => (findingCounts?.[tier] ?? 0) > 0)
        .map((tier) => `${findingCounts![tier]} ${tier} finding${findingCounts![tier] !== 1 ? 's' : ''}`)
  return {
    findings: counts.length > 0 ? counts : ['No open account-level findings recorded yet.'],
    resourceCompliance: `Resource compliance: ${resourceComplianceError ? 'Unavailable' : (complianceBreakdown ?? 'Not yet evaluated')}`,
    evaluation: securityComponent?.reason ?? null,
  }
}

/**
 * Pure, extracted-for-testability Security Posture KPI state.
 *
 * Reads the canonical System Intelligence *security component* -- the same
 * RiskTrackingService.calculateCurrentRiskScore the Pro-gated
 * /api/risk-score/trend returned, but readable on every plan -- and uses its
 * own status rather than re-deriving thresholds here. Not the overall
 * 85/70/50 System Intelligence status: that grades a different, blended score.
 *
 * `ready === false` covers both "compliance scans still pending" and the
 * component's error fallback (a score-0 placeholder); the response doesn't
 * distinguish them, so no number is shown until the component is ready. A
 * ready score of 0 is a real score and is shown as one.
 *
 * Lives in its own module (not exported from page.tsx) because Next.js's App
 * Router only permits a fixed set of named exports from a page file.
 */
export function computeSecurityHealthKpi(params: {
  isDemoActive: boolean
  hasOrganization: boolean
  isLoading: boolean
  securityComponent: Pick<SystemIntelligenceComponentScore, 'score' | 'status' | 'ready'> | undefined
}): SecurityKpi {
  const { isDemoActive, hasOrganization, isLoading, securityComponent } = params
  if (isDemoActive) return { value: '87', score: 87, badge: SECURITY_STATUS_BADGE.good }
  if (isLoading || !hasOrganization) return { value: 'Calculating…', score: null }
  if (!securityComponent) {
    return { value: '—', score: null, badge: { label: 'Unavailable', direction: 'flat', color: 'var(--text-secondary)' } }
  }
  if (!securityComponent.ready) {
    return { value: '—', score: null, badge: { label: 'Not yet available', direction: 'flat', color: 'var(--text-secondary)' } }
  }
  return {
    value: String(securityComponent.score),
    score: securityComponent.score,
    badge: SECURITY_STATUS_BADGE[securityComponent.status],
  }
}
