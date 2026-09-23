import { Gauge } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import type { SystemIntelligenceComponentScore, SystemIntelligenceResult } from '@/lib/services/system-intelligence.service'

type ComponentStatus = SystemIntelligenceComponentScore['status']

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

function ComponentColumn({ component, statusBadge }: { component: SystemIntelligenceComponentScore; statusBadge: SystemIntelligenceCardProps['statusBadge'] }) {
  // `ready: false` still carries a number (a neutral 50, a preliminary score, or
  // an error's 0) -- so nothing score-derived is rendered until the component
  // itself says its result is real.
  if (!component.ready) {
    return (
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground truncate">{component.label}</p>
        <p className="text-base font-bold text-[var(--text-secondary)] mt-1">—</p>
        <p className="text-xs text-[var(--text-secondary)]">Not yet available</p>
      </div>
    )
  }

  const badge = statusBadge[component.status]
  return (
    <div className="min-w-0">
      <p className="text-sm font-semibold text-foreground truncate">{component.label}</p>
      <p className="text-xs mt-1 mb-2">
        <span className="text-base font-bold text-foreground">{component.score}</span>
        <span className="text-[var(--text-secondary)]"> · </span>
        <span className="font-semibold" style={{ color: badge.color }}>{badge.label}</span>
      </p>
      <Progress
        value={component.score}
        className="h-1.5 bg-[color:var(--border)]"
        indicatorClassName={STATUS_FILL_CLASS[component.status]}
        aria-label={`${component.label} score`}
        aria-valuenow={component.score}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${component.score} of 100, ${badge.label}`}
      />
    </div>
  )
}

/**
 * Cost / Security / Observability breakdown of the canonical System
 * Intelligence result -- the same already-fetched response behind the
 * Infrastructure Health KPI. Labels are the backend's component.label verbatim;
 * each component is gated on its own `ready`. Never shown in demo mode (there
 * are no demo component scores to show, and none are invented).
 */
export function SystemIntelligenceCard({ isDemoActive, components, isLoading, statusBadge }: SystemIntelligenceCardProps) {
  if (isDemoActive) return null

  return (
    <div className="bg-[var(--surface-2)] rounded-2xl border border-border p-5 mb-6">
      <div className="flex items-center gap-2.5 mb-4">
        <Gauge size={17} style={{ color: 'var(--text-accent)' }} />
        <h3 className="text-base font-bold text-foreground">System Intelligence</h3>
      </div>

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
            <ComponentColumn key={key} component={components[key]} statusBadge={statusBadge} />
          ))}
        </div>
      )}
    </div>
  )
}
