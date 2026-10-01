import Link from 'next/link'
import { Gauge } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import type { SystemIntelligenceComponentScore, SystemIntelligenceResult } from '@/lib/services/system-intelligence.service'
import { INFRASTRUCTURE_POSTURE_LABEL, INFRASTRUCTURE_POSTURE_WEIGHTED_DESCRIPTION } from '@/lib/infrastructure-posture'
import { EvidenceBadge, PartialBadge } from './evidence-badge'
import { EvidenceInfo } from './evidence-info'
import { describePostureComponent, POSTURE_COMPONENT_ICONS, POSTURE_COMPONENT_ORDER, PostureEvidence, type PostureStatusBadge } from './posture-evidence'

type ComponentStatus = SystemIntelligenceComponentScore['status']
type ComponentKey = keyof SystemIntelligenceResult['components']

interface SystemIntelligenceCardProps {
  isDemoActive: boolean
  /** The dashboard's already-fetched systemIntelligence.components -- this card never fetches. */
  components: SystemIntelligenceResult['components'] | undefined
  isLoading: boolean
  /** Status wording, passed in so the card reuses the dashboard's existing scheme (SECURITY_STATUS_BADGE). */
  statusBadge: PostureStatusBadge
  /** The composite score (system_score); null renders "—", never 0. */
  score?: number | null
  /** The composite's existing status badge (postureStatusLabel wording), when there is one. */
  scoreBadge?: { label: string; color: string }
  /** The backend's composite_state, read as-is -- never derived here. */
  compositeState?: SystemIntelligenceResult['composite_state']
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

const RING_SIZE = 112
const RING_STROKE = 10

function ScoreRing({ score, color }: { score: number | null; color: string }) {
  const r = (RING_SIZE - RING_STROKE) / 2
  const circumference = 2 * Math.PI * r
  return (
    <div className="relative shrink-0" style={{ width: RING_SIZE, height: RING_SIZE }} data-testid="posture-ring">
      <svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} aria-hidden="true" className="-rotate-90">
        <circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={RING_STROKE} />
        {score !== null && (
          <circle
            cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={r} fill="none" stroke={color} strokeWidth={RING_STROKE} strokeLinecap="round"
            strokeDasharray={circumference} strokeDashoffset={circumference * (1 - Math.max(0, Math.min(100, score)) / 100)}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[28px] font-bold leading-none text-foreground">{score === null ? '—' : score}</span>
        <span className="text-xs text-[var(--text-secondary)] mt-1">/ 100</span>
      </div>
    </div>
  )
}

function ComponentTile({ componentKey, component, statusBadge }: { componentKey: ComponentKey; component: SystemIntelligenceResult['components'][ComponentKey]; statusBadge: PostureStatusBadge }) {
  const d = describePostureComponent(componentKey, component, statusBadge)
  const Icon = POSTURE_COMPONENT_ICONS[componentKey]
  return (
    <div className="min-w-0 rounded-xl border border-border p-4 flex flex-col" data-testid={`posture-tile-${componentKey}`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon size={15} aria-hidden="true" className="text-[var(--text-secondary)] shrink-0" />
        <p className="text-sm font-semibold text-foreground truncate m-0">{d.label}</p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        <span className={`text-lg font-bold leading-none mr-1 ${d.score === null ? 'text-[var(--text-secondary)]' : 'text-foreground'}`}>{d.scoreText}</span>
        {d.tier && <EvidenceBadge label={d.tier.label} color={d.tier.color} />}
        {d.partial && d.score !== null && <PartialBadge testId={`${d.label}-partial`} />}
      </div>
      {d.score !== null ? (
        <Progress
          value={d.score}
          className="h-1.5 mt-auto bg-[color:var(--border)]"
          indicatorClassName={STATUS_FILL_CLASS[component.status]}
          aria-label={`${d.label} score`}
          aria-valuenow={d.score}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuetext={`${d.isAlertCoverage ? `${d.scoreText} alert coverage` : `${d.scoreText} of 100`}${d.tier ? `, ${d.tier.label}` : ''}${d.partial ? ', partial' : ''}`}
        />
      ) : (
        <p className="text-xs text-[var(--text-secondary)] m-0 mt-auto">{d.missingText}</p>
      )}
    </div>
  )
}

/**
 * Infrastructure Posture section: the composite score ring with its status
 * on the left, and Cost / Security / Alert Coverage tiles on the right -- the
 * same already-fetched System Intelligence response behind the KPI card.
 * Each component is gated on its own `ready`. Reasons live behind the info
 * button (the same panel as the KPI card), not on the face. Never shown in
 * demo mode (there are no demo component scores, and none are invented).
 */
export function SystemIntelligenceCard({ isDemoActive, components, isLoading, statusBadge, score = null, scoreBadge, compositeState = null }: SystemIntelligenceCardProps) {
  if (isDemoActive) return null
  const partial = compositeState === 'partial'

  return (
    <div className="bg-[var(--surface-2)] rounded-2xl border border-border p-5 mb-6" data-testid="posture-section">
      <div className="relative flex flex-wrap items-start justify-between gap-x-4 gap-y-2 mb-5">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-[var(--bg-accent)]">
            <Gauge size={16} aria-hidden="true" style={{ color: 'var(--text-accent)' }} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-bold text-foreground m-0">{INFRASTRUCTURE_POSTURE_LABEL}</h3>
              <EvidenceInfo label={`${INFRASTRUCTURE_POSTURE_LABEL} section details`} title={INFRASTRUCTURE_POSTURE_LABEL} align="start">
                <PostureEvidence components={components} statusBadge={statusBadge} />
              </EvidenceInfo>
              {partial && <PartialBadge testId="posture-section-partial" />}
            </div>
            <p className="text-xs text-[var(--text-secondary)] m-0 mt-0.5">{INFRASTRUCTURE_POSTURE_WEIGHTED_DESCRIPTION}</p>
          </div>
        </div>
        <Link href="/infrastructure" className="text-xs font-semibold no-underline whitespace-nowrap py-2" style={{ color: 'var(--text-accent)' }}>
          View details →
        </Link>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {POSTURE_COMPONENT_ORDER.map((key) => (
            <div key={key} className="flex flex-col gap-2">
              <Skeleton className="h-3.5 w-1/2" />
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-1.5 w-full" />
            </div>
          ))}
        </div>
      ) : !components ? (
        <p className="text-xs text-[var(--text-secondary)] m-0">— · Unavailable</p>
      ) : (
        <div className="flex flex-col lg:flex-row lg:items-center gap-6">
          <div className="flex items-center gap-4 shrink-0">
            <ScoreRing score={score} color={scoreBadge ? scoreBadge.color.replace('--text-', '--fill-') : 'var(--border)'} />
            {score !== null && scoreBadge && <EvidenceBadge label={scoreBadge.label} color={scoreBadge.color} testId="posture-section-status" />}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 flex-1 min-w-0">
            {POSTURE_COMPONENT_ORDER.map((key) => (
              <ComponentTile key={key} componentKey={key} component={components[key]} statusBadge={statusBadge} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
