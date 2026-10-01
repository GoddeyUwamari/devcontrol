import type { SystemIntelligenceResult } from '@/lib/services/system-intelligence.service'

/**
 * Display vocabulary for the System Intelligence composite
 * (system-intelligence.service.ts: 30% cost, 40% security, 30% EC2/RDS alert
 * coverage). Presentation only -- the score, its status thresholds, and its
 * partial state are computed by the backend and never re-derived here.
 *
 * The composite is a posture/readiness score, not a measurement of uptime,
 * performance, or resource health, so it is never labeled "health".
 */
export const INFRASTRUCTURE_POSTURE_LABEL = 'Infrastructure Posture'

export const INFRASTRUCTURE_POSTURE_DESCRIPTION = 'Composite of cost, security, and alert coverage.'

/** Customer-facing component names, keyed by the backend's component keys. */
export const POSTURE_COMPONENT_LABELS = {
  cost: 'Cost',
  security: 'Security',
  // The backend key is still 'observability'; since #148 it measures EC2/RDS
  // alert coverage only.
  observability: 'Alert Coverage',
} as const

type PostureStatus = SystemIntelligenceResult['status']

/**
 * Display label for the backend's existing composite status (scoreToStatus:
 * >=85 Healthy, >=70 Stable, >=50 Degraded, else At Risk). Only the words
 * change: "Healthy"/"Degraded" read as runtime health, which this score does
 * not measure. 'Pending' has no label (the score is not ready).
 */
export const POSTURE_STATUS_LABELS: Record<Exclude<PostureStatus, 'Pending'>, string> = {
  Healthy: 'Strong',
  Stable: 'Stable',
  Degraded: 'Needs attention',
  'At Risk': 'At risk',
}

export function postureStatusLabel(status: string | null | undefined): string | null {
  return status != null && status in POSTURE_STATUS_LABELS
    ? POSTURE_STATUS_LABELS[status as keyof typeof POSTURE_STATUS_LABELS]
    : null
}

/**
 * "Composite · Cost 96 · Security 57 · Alert coverage 0" from the components
 * the composite was actually built from. null unless every component has a
 * score (the backend only produces a composite in that case).
 */
export function postureCompositionCaption(components: SystemIntelligenceResult['components'] | undefined): string | null {
  if (!components) return null
  const { cost, security, observability } = components
  if (cost?.score == null || security?.score == null || observability?.score == null) return null
  return `Composite · Cost ${cost.score} · Security ${security.score} · Alert coverage ${observability.score}`
}

/**
 * "Partial · <why>" when the backend marked the composite partial. Prefers the
 * alert-coverage component's own reason (e.g. "Measures EC2 alert coverage
 * only (0 of 1 in-scope resources covered); …") over composite_reason, whose
 * wording names the component by its internal key.
 */
export function posturePartialCaption(result: Pick<SystemIntelligenceResult, 'composite_state' | 'composite_reason' | 'components'> | null | undefined): string | null {
  if (!result || result.composite_state !== 'partial') return null
  const reason = result.components?.observability?.reason ?? result.composite_reason ?? 'built on incomplete evidence'
  return `Partial · ${reason}`
}
