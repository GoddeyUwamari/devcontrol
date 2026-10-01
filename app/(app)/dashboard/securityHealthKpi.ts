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
 * The one compliance-scan rule the Security Posture face caption and its
 * info panel both read, so they can't disagree: pending only when the
 * resource stats loaded and say the compliance scan has not completed
 * (scan_completed === false). A failed request or an absent field is not
 * "pending".
 */
export function complianceScanPending(resourceScanCompleted: boolean | undefined, resourceComplianceError: boolean): boolean {
  return !resourceComplianceError && resourceScanCompleted === false
}

/**
 * The resource compliance status line, shared by the Security Posture info
 * panel and Security Key Findings so the two can't disagree. Pending (see
 * complianceScanPending) wins, with any counts appended; a completed scan
 * with zero reported counts says so rather than "Not yet evaluated"; a failed
 * request is "Unavailable"; an absent scan_completed field keeps the previous
 * wording.
 */
export function resourceComplianceLine(params: {
  complianceBreakdown: string | null
  complianceCountsReported: boolean
  resourceScanCompleted: boolean | undefined
  resourceComplianceError: boolean
}): string {
  const { complianceBreakdown, complianceCountsReported, resourceScanCompleted, resourceComplianceError } = params
  if (resourceComplianceError) return 'Unavailable'
  if (complianceScanPending(resourceScanCompleted, resourceComplianceError)) {
    return `Compliance scan pending${complianceBreakdown ? ` · ${complianceBreakdown}` : ''}`
  }
  if (complianceBreakdown) return complianceBreakdown
  if (resourceScanCompleted === true) return complianceCountsReported ? 'No open issues in the completed compliance scan' : 'Not available'
  return 'Not yet evaluated'
}

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
  /** Already-formatted resource compliance breakdown ("2 High · 1 Low"), or null when every count is zero or none came back. */
  complianceBreakdown: string | null
  /** The resource stats carried severity counts (all zero when complianceBreakdown is null). */
  complianceCountsReported: boolean
  resourceScanCompleted: boolean | undefined
  resourceComplianceError: boolean
  securityComponent: Pick<SystemIntelligenceComponentScore, 'reason'> | undefined
}): { findings: string[]; resourceCompliance: string | null; evaluation: string | null } {
  const { isDemoActive, isLoading, findingCounts, findingsError, securityComponent } = params
  if (isDemoActive) return { findings: [], resourceCompliance: null, evaluation: null }
  if (isLoading) return { findings: ['Loading…'], resourceCompliance: null, evaluation: null }

  const counts = findingsError
    ? ['Account-level findings: Unavailable']
    : (['critical', 'high', 'medium', 'low'] as const)
        .filter((tier) => (findingCounts?.[tier] ?? 0) > 0)
        .map((tier) => `${findingCounts![tier]} ${tier} finding${findingCounts![tier] !== 1 ? 's' : ''}`)
  return {
    findings: counts.length > 0 ? counts : ['No open account-level findings recorded yet.'],
    resourceCompliance: `Resource compliance: ${resourceComplianceLine(params)}`,
    evaluation: securityComponent?.reason ?? null,
  }
}

/**
 * "1 critical · 5 high findings": active account-level findings by severity,
 * zero counts omitted, plural from the total. null when there are no counts
 * to show (none loaded, the request failed, or every count is zero -- the
 * panel words those states).
 */
export function securityFindingsCaption(findingCounts: SeverityCounts | null | undefined): string | null {
  if (!findingCounts) return null
  const tiers = (['critical', 'high', 'medium', 'low'] as const).filter((tier) => findingCounts[tier] > 0)
  if (tiers.length === 0) return null
  const total = tiers.reduce((sum, tier) => sum + findingCounts[tier], 0)
  return `${tiers.map((tier) => `${findingCounts[tier]} ${tier}`).join(' · ')} finding${total !== 1 ? 's' : ''}`
}

/**
 * The Security Posture card's one face caption: the finding counts above,
 * plus "compliance scan pending" under the same rule as the panel
 * (complianceScanPending). Each part is
 * omitted when its data is loading, failed, or absent.
 */
export function securityKpiCaption(params: {
  isDemoActive: boolean
  isLoading: boolean
  findingCounts: SeverityCounts | null | undefined
  findingsError: boolean
  resourceScanCompleted: boolean | undefined
  resourceComplianceError: boolean
}): string | null {
  const { isDemoActive, isLoading, findingCounts, findingsError, resourceScanCompleted, resourceComplianceError } = params
  if (isDemoActive || isLoading) return null
  const parts = [
    findingsError ? null : securityFindingsCaption(findingCounts),
    complianceScanPending(resourceScanCompleted, resourceComplianceError) ? 'compliance scan pending' : null,
  ].filter((p): p is string => p !== null)
  return parts.length > 0 ? parts.join(' · ') : null
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
