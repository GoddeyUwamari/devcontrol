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
  /** Each tile's one face caption, built by the page from data it already loads; omitted when null. */
  captions?: Partial<Record<ComponentKey, string | null>>
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

function ComponentTile({ componentKey, component, statusBadge, caption }: {
  componentKey: ComponentKey
  component: SystemIntelligenceResult['components'][ComponentKey]
  statusBadge: PostureStatusBadge
  caption: string | null
}) {
  const d = describePostureComponent(componentKey, component, statusBadge)
  const Icon = POSTURE_COMPONENT_ICONS[componentKey]
  // One caption line: the missing-score wording when there is no score, else the page's caption.
  const faceCaption = d.score === null ? d.missingText : caption
  return (
    <div className="relative min-w-0 rounded-xl border border-border p-4 flex flex-col" data-testid={`posture-tile-${componentKey}`}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <Icon size={15} aria-hidden="true" className="text-[var(--text-secondary)] shrink-0" />
          <p className="text-sm font-semibold text-foreground truncate m-0">{d.label}</p>
        </div>
        {component.reason && (
          <EvidenceInfo label={`${d.label} details`} title={d.label} align={componentKey === 'observability' ? 'end' : 'start'}>
            <p className="m-0">{component.reason}</p>
          </EvidenceInfo>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`text-lg font-bold leading-none mr-1 ${d.score === null ? 'text-[var(--text-secondary)]' : 'text-foreground'}`}>{d.scoreText}</span>
        {d.tier && <EvidenceBadge label={d.tier.label} color={d.tier.color} />}
      </div>
      {faceCaption && (
        <p className="text-xs text-[var(--text-secondary)] leading-snug m-0 mt-2" data-testid={`posture-tile-caption-${componentKey}`}>{faceCaption}</p>
      )}
      {d.score !== null && (
        <div className="mt-auto pt-3">
          <Progress
            value={d.score}
            className="h-1.5 bg-[color:var(--border)]"
            indicatorClassName={STATUS_FILL_CLASS[component.status]}
            aria-label={`${d.label} score`}
            aria-valuenow={d.score}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuetext={`${d.isAlertCoverage ? `${d.scoreText} alert coverage` : `${d.scoreText} of 100`}${d.tier ? `, ${d.tier.label}` : ''}${d.partial ? ', partial' : ''}`}
          />
        </div>
      )}
    </div>
  )
}

/**
 * Infrastructure Posture section: Cost / Security / Alert Coverage tiles from
 * the same already-fetched System Intelligence response behind the KPI card
 * (which carries the composite score). Each component is gated on its own
 * `ready`. The composite's Partial state is the one badge, in the header; a
 * tile shows one caption, and its full reason sits behind its own info
 * button. Never shown in demo mode (there are no demo component scores, and
 * none are invented).
 */
export function SystemIntelligenceCard({ isDemoActive, components, isLoading, statusBadge, captions = {}, compositeState = null }: SystemIntelligenceCardProps) {
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
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {POSTURE_COMPONENT_ORDER.map((key) => (
            <ComponentTile key={key} componentKey={key} component={components[key]} statusBadge={statusBadge} caption={captions[key] ?? null} />
          ))}
        </div>
      )}
    </div>
  )
}
