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

/** The same composite with the backend's 30/40/30 weights spelled out (display copy only). */
export const INFRASTRUCTURE_POSTURE_WEIGHTED_DESCRIPTION = 'Composite of cost (30%), security (40%), and alert coverage (30%)'

/** What the composite is not -- shown alongside the weighted description. */
export const INFRASTRUCTURE_POSTURE_NOT_UPTIME = 'A posture score, not measured uptime or performance.'

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
 * not measure. Each of the four tiers keeps its own label, in increasing
 * severity: Strong, Stable, Needs attention, Weak. 'Pending' has no label
 * (the score is not ready).
 */
export const POSTURE_STATUS_LABELS: Record<Exclude<PostureStatus, 'Pending'>, string> = {
  Healthy: 'Strong',
  Stable: 'Stable',
  Degraded: 'Needs attention',
  'At Risk': 'Weak',
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

// The cost component's limitation sentences, exactly as the backend writes
// them into its reason (system-intelligence.service.ts computeCostScore), with
// their short tile wording. Matched as whole sentences only; any other reason
// text stays in the info panel. Follow-up: structured limitation codes.
const COST_LIMITATION_CAPTIONS: Array<[sentence: string, caption: string]> = [
  ['Insufficient spend data to assess cost efficiency.', 'insufficient spend data'],
  ['Anomaly checks not yet active.', 'anomaly checks not yet active'],
]

/**
 * The Cost tile's one caption: where its spend comes from (the component's
 * costSource -- the inventory's monthly run-rate estimate, not the Spend
 * card's Cost Explorer month-to-date figure), then its known limitations.
 * null when the component has no costSource and no recognized limitation.
 */
export function costComponentCaption(component: Pick<SystemIntelligenceResult['components']['cost'], 'costSource' | 'reason'> | undefined): string | null {
  if (!component) return null
  const source = component.costSource === 'estimated'
    ? 'Monthly run-rate estimate'
    : component.costSource === 'actual' ? 'Based on AWS Cost Explorer spend' : null
  const sentences = (component.reason ?? '').split(/(?<=\.)\s+/)
  const limitations = COST_LIMITATION_CAPTIONS.filter(([sentence]) => sentences.includes(sentence)).map(([, caption]) => caption)
  const parts = [source, ...limitations].filter((p): p is string => p !== null)
  if (parts.length === 0) return null
  const caption = parts.join(' · ')
  return caption.charAt(0).toUpperCase() + caption.slice(1)
}

/**
 * "Partial · <why>" when the backend marked the composite partial. The why is
 * composite_reason as-is: the backend names every partial component with its
 * own reason ("Cost: … Alert Coverage: …"), so no component's limitation is
 * attributed to another.
 */
export function posturePartialCaption(result: Pick<SystemIntelligenceResult, 'composite_state' | 'composite_reason'> | null | undefined): string | null {
  if (!result || result.composite_state !== 'partial') return null
  return `Partial · ${result.composite_reason ?? 'built on incomplete evidence'}`
}
