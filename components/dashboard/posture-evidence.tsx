import type { LucideIcon } from 'lucide-react'
import { Bell, Cloud, Shield } from 'lucide-react'
import type { SystemIntelligenceComponentScore, SystemIntelligenceResult } from '@/lib/services/system-intelligence.service'
import {
  INFRASTRUCTURE_POSTURE_NOT_UPTIME,
  INFRASTRUCTURE_POSTURE_WEIGHTED_DESCRIPTION,
  POSTURE_COMPONENT_LABELS,
} from '@/lib/infrastructure-posture'
import { EvidenceSection } from './evidence-info'
import { EvidenceBadge, NEUTRAL_COLOR, PartialBadge } from './evidence-badge'

type ComponentKey = keyof SystemIntelligenceResult['components']
type ComponentStatus = SystemIntelligenceComponentScore['status']
export type PostureStatusBadge = Record<ComponentStatus, { label: string; color: string }>

export const POSTURE_COMPONENT_ORDER = ['cost', 'security', 'observability'] as const

export const POSTURE_COMPONENT_ICONS: Record<ComponentKey, LucideIcon> = {
  cost: Cloud,
  security: Shield,
  observability: Bell,
}

/**
 * A component's display state, shared by the posture popover and the
 * Infrastructure Posture section tiles. `ready: false` can still carry a
 * number (a neutral 50, a preliminary score, an error's 0) and alert
 * coverage's score is null when nothing was measured -- so no score is shown
 * unless the component says it is real. Every component is shown on the
 * same 0-100 scale; alert coverage is never graded Strong / Needs
 * attention / At risk.
 */
export function describePostureComponent(
  key: ComponentKey,
  component: SystemIntelligenceResult['components'][ComponentKey],
  statusBadge: PostureStatusBadge,
) {
  const isAlertCoverage = key === 'observability'
  const scored = component.ready && component.score !== null
  return {
    label: POSTURE_COMPONENT_LABELS[key],
    isAlertCoverage,
    score: scored ? component.score : null,
    scoreText: scored ? String(component.score) : '—',
    tier: scored && !isAlertCoverage ? statusBadge[component.status] : null,
    partial: component.state === 'partial',
    missingText: scored ? null : component.state === 'error' ? 'Could not be retrieved' : 'Not yet available',
  }
}

/**
 * The Infrastructure Posture evidence panel: what the composite measures,
 * then each component's score, tier, evidence state, and the backend's own
 * reasons. Shared by the KPI card and the full-width section so both info
 * buttons open identical content.
 */
export function PostureEvidence({ components, statusBadge }: {
  components: SystemIntelligenceResult['components'] | undefined
  statusBadge: PostureStatusBadge
}) {
  return (
    <>
      <EvidenceSection heading="What this measures">
        <p className="m-0">{INFRASTRUCTURE_POSTURE_WEIGHTED_DESCRIPTION}. {INFRASTRUCTURE_POSTURE_NOT_UPTIME}</p>
      </EvidenceSection>
      {components && (
        <EvidenceSection heading="Component details">
          <ul className="list-none m-0 p-0">
            {POSTURE_COMPONENT_ORDER.map((key) => {
              const component = components[key]
              const d = describePostureComponent(key, component, statusBadge)
              const Icon = POSTURE_COMPONENT_ICONS[key]
              const chip = d.tier ? `${d.scoreText} · ${d.tier.label}` : d.score !== null ? `${d.scoreText} /100` : d.scoreText
              return (
                <li key={key} data-testid={`posture-evidence-${key}`} className="flex gap-3 py-2.5 border-b border-border last:border-b-0">
                  <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-[var(--surface-1)] border border-border">
                    <Icon size={14} aria-hidden="true" className="text-[var(--text-secondary)]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-semibold text-foreground mr-1">{d.label}</span>
                      <EvidenceBadge label={chip} color={d.tier?.color ?? NEUTRAL_COLOR} />
                      {d.partial && <PartialBadge />}
                    </div>
                    {component.reason ? (
                      <p className="m-0 mt-1 text-[11px] leading-snug">{component.reason}</p>
                    ) : d.missingText ? (
                      <p className="m-0 mt-1 text-[11px] leading-snug">{d.missingText}</p>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        </EvidenceSection>
      )}
    </>
  )
}
