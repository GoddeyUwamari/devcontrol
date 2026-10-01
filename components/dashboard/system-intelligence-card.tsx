import { Gauge } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import type { ObservabilityComponentScore, SystemIntelligenceComponentScore, SystemIntelligenceResult } from '@/lib/services/system-intelligence.service'
import { INFRASTRUCTURE_POSTURE_DESCRIPTION, INFRASTRUCTURE_POSTURE_LABEL, POSTURE_COMPONENT_LABELS } from '@/lib/infrastructure-posture'

type ComponentStatus = SystemIntelligenceComponentScore['status']
type ComponentKey = keyof SystemIntelligenceResult['components']

interface SystemIntelligenceCardProps {
  isDemoActive: boolean
  /** The dashboard's already-fetched systemIntelligence.components -- this card never fetches. */
  components: SystemIntelligenceResult['components'] | undefined
  isLoading: boolean
  /** Status wording, passed in so the card reuses the dashboard's existing scheme (SECURITY_STATUS_BADGE). */
  statusBadge: Record<ComponentStatus, { label: string; color: string }>
}

// Fill color comes only from the component's canonical `status` -- the backend
// grades each component at its own thresholds (cost 75/55, security and
// observability 80/60), so re-deriving color from the score here would disagree.
// Literal class strings so Tailwind generates them.
const STATUS_FILL_CLASS: Record<ComponentStatus, string> = {
  good: 'bg-[color:var(--fill-success)]',
  warning: 'bg-[color:var(--fill-warning)]',
  risk: 'bg-[color:var(--fill-danger)]',
}

const COMPONENT_ORDER = ['cost', 'security', 'observability'] as const

function ComponentColumn({ componentKey, component, statusBadge }: { componentKey: ComponentKey; component: SystemIntelligenceComponentScore | ObservabilityComponentScore; statusBadge: SystemIntelligenceCardProps['statusBadge'] }) {
  const label = POSTURE_COMPONENT_LABELS[componentKey]
  // Each component's own evidence state and reason, from the backend -- a
  // partial component shows its own limitations, never another's.
  const { state, reason } = component
  // Alert coverage is a coverage percentage, not a posture grade: it shows its
  // value and scope, not the Strong / Needs attention / At risk wording.
  const isAlertCoverage = componentKey === 'observability'

  // `ready: false` can still carry a number (a neutral 50 or a preliminary
  // score), and observability's score is null when nothing was measured -- so
  // nothing score-derived is rendered until the component says it is real.
  if (!component.ready || component.score === null) {
    return (
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground truncate">{label}</p>
        <p className="text-base font-bold text-[var(--text-secondary)] mt-1">—</p>
        <p className="text-xs text-[var(--text-secondary)]">{state === 'error' ? 'Could not be retrieved' : 'Not yet available'}</p>
      </div>
    )
  }

  const badge = isAlertCoverage ? null : statusBadge[component.status]
  const valueText = isAlertCoverage ? `${component.score}%` : String(component.score)
  return (
    <div className="min-w-0">
      <p className="text-sm font-semibold text-foreground truncate">{label}</p>
      <p className="text-xs mt-1 mb-2">
        <span className="text-base font-bold text-foreground">{valueText}</span>
        {badge && (
          <>
            <span className="text-[var(--text-secondary)]"> · </span>
            <span className="font-semibold" style={{ color: badge.color }}>{badge.label}</span>
          </>
        )}
        {state === 'partial' && (
          <>
            <span className="text-[var(--text-secondary)]"> · </span>
            <span data-testid={`${label}-partial`} className="font-semibold text-[var(--text-warning)]">Partial</span>
          </>
        )}
      </p>
      <Progress
        value={component.score}
        className="h-1.5 bg-[color:var(--border)]"
        indicatorClassName={STATUS_FILL_CLASS[component.status]}
        aria-label={`${label} score`}
        aria-valuenow={component.score}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${isAlertCoverage ? `${valueText} alert coverage` : `${valueText} of 100`}${badge ? `, ${badge.label}` : ''}${state === 'partial' ? ', partial' : ''}`}
      />
      {state === 'partial' && reason && (
        <p className="text-xs text-[var(--text-secondary)] mt-2 leading-snug">{reason}</p>
      )}
    </div>
  )
}

/**
 * Cost / Security / Alert Coverage breakdown of the canonical System
 * Intelligence result -- the same already-fetched response behind the
 * Infrastructure Posture KPI. Each component is gated on its own `ready`.
 * Never shown in demo mode (there are no demo component scores to show, and
 * none are invented).
 */
export function SystemIntelligenceCard({ isDemoActive, components, isLoading, statusBadge }: SystemIntelligenceCardProps) {
  if (isDemoActive) return null

  return (
    <div className="bg-[var(--surface-2)] rounded-2xl border border-border p-5 mb-6">
      <div className="flex items-center gap-2.5 mb-1">
        <Gauge size={17} style={{ color: 'var(--text-accent)' }} />
        <h3 className="text-base font-bold text-foreground">{INFRASTRUCTURE_POSTURE_LABEL}</h3>
      </div>
      <p className="text-xs text-[var(--text-secondary)] mb-4">{INFRASTRUCTURE_POSTURE_DESCRIPTION}</p>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          {COMPONENT_ORDER.map((key) => (
            <div key={key} className="flex flex-col gap-2">
              <Skeleton className="h-3.5 w-1/2" />
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-1.5 w-full" />
            </div>
          ))}
        </div>
      ) : !components ? (
        <p className="text-xs text-[var(--text-secondary)]">— · Unavailable</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          {COMPONENT_ORDER.map((key) => (
            <ComponentColumn key={key} componentKey={key} component={components[key]} statusBadge={statusBadge} />
          ))}
        </div>
      )}
    </div>
  )
}
