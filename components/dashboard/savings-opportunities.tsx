import { PuzzleIcon, Sparkles } from 'lucide-react'

export type OpportunityEvaluationState = 'evaluated' | 'not_evaluated' | 'in_progress'

export interface OpportunityCategoryItem {
  /** Resource type key, kept distinct from the display title so new supported
   *  types can be added without any UI restructuring. */
  type: string
  title: string
  description: string
  count: number
  savingsLabel: string
  priorityBadge?: { label: string; color: string; background: string }
}

interface SavingsOpportunitiesProps {
  items: OpportunityCategoryItem[]
  /** One state for all categories -- every wired detector runs in the same
   *  optimization scan (cost_analysis_runs), so there is no scenario where
   *  one category is evaluated and another isn't. */
  evaluationState: OpportunityEvaluationState
  /** Same authoritative count the Recommended Action CTA uses -- never
   *  independently re-derived from just these 4 known categories, since a
   *  real recommendation can exist for a type this UI doesn't have a card
   *  for yet. */
  totalActiveCount: number
  detailsHref?: string
}

const EVALUATION_LABEL: Record<OpportunityEvaluationState, string> = {
  evaluated: '',
  not_evaluated: 'Not currently evaluated',
  in_progress: 'Evaluation in progress',
}

function countPhrase(count: number): string {
  if (count === 0) return '0 detected'
  return `${count} opportunit${count !== 1 ? 'ies' : 'y'}`
}

// Grid columns scale to however many cards are actually rendered (1-4), rather
// than always reserving a fixed 4-wide layout -- the dashboard summary caps at
// 3 real-signal categories, while the not-yet-evaluated/in-progress states can
// still show all 4.
const GRID_COLS_BY_COUNT: Record<number, string> = {
  1: 'lg:grid-cols-1',
  2: 'lg:grid-cols-2',
  3: 'lg:grid-cols-3',
  4: 'lg:grid-cols-4',
}

/**
 * Compact detected-opportunity cards, one per supported resource type.
 * "Not currently evaluated" is only ever shown when the org genuinely has no
 * completed optimization scan yet (evaluationState from cost_analysis_runs)
 * -- never merely because a type's filtered count happens to be zero. A
 * type that ran and found nothing renders a truthful zero ("0 detected",
 * "$0/mo"), not a false "not evaluated" claim.
 */
export function SavingsOpportunities({ items, evaluationState, totalActiveCount, detailsHref = '/cost-optimization' }: SavingsOpportunitiesProps) {
  // Only a genuinely completed scan that found nothing across every category
  // renders this truthful "no signal" empty state -- not_evaluated/in_progress
  // keep their own per-category cards (each showing its own status) instead,
  // since "no active opportunities" is a specific, falsifiable claim that
  // isn't true yet if scanning hasn't finished.
  const showEmptyState = evaluationState === 'evaluated' && items.length === 0
  const gridColsClass = GRID_COLS_BY_COUNT[Math.min(items.length, 4)] ?? 'lg:grid-cols-1'

  return (
    <div className="bg-[var(--surface-2)] rounded-2xl border border-border p-5 h-full">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <PuzzleIcon size={17} style={{ color: 'var(--text-accent)' }} />
          <h3 className="text-base font-bold text-foreground">Cost-Saving Opportunities</h3>
        </div>
        <a href={detailsHref} className="text-xs font-semibold no-underline whitespace-nowrap" style={{ color: 'var(--text-accent)' }}>
          View all ({totalActiveCount}) →
        </a>
      </div>
      {showEmptyState ? (
        <div className="text-center py-8 flex flex-col items-center gap-2">
          <div className="w-10 h-10 rounded-xl bg-[var(--surface-1)] flex items-center justify-center mb-1">
            <Sparkles size={18} className="text-[var(--text-secondary)]" />
          </div>
          <p className="text-sm font-semibold text-foreground">No active cost-saving opportunities identified</p>
        </div>
      ) : (
      <div className={`grid grid-cols-1 sm:grid-cols-2 ${gridColsClass} gap-4`}>
        {items.map(({ type, title, description, count, savingsLabel, priorityBadge }) => (
          <div key={type} className="bg-[var(--surface-1)] rounded-xl border border-border p-4">
            <p className="text-xs text-[var(--text-secondary)] font-medium mb-2">{title}</p>
            {evaluationState === 'evaluated' ? (
              <>
                <div className="text-xl font-bold tracking-tight leading-none mb-1" style={{ color: count > 0 ? 'var(--text-success)' : 'var(--text-secondary)' }}>
                  {savingsLabel}
                </div>
                <p className="text-xs text-[var(--text-secondary)] mb-2">{countPhrase(count)}</p>
              </>
            ) : (
              <div className="text-sm font-semibold text-[var(--text-secondary)] mb-2">
                {EVALUATION_LABEL[evaluationState]}
              </div>
            )}
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed mb-2.5">{description}</p>
            {evaluationState === 'evaluated' && count > 0 && priorityBadge && (
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full inline-block" style={{ color: priorityBadge.color, background: priorityBadge.background }}>
                {priorityBadge.label}
              </span>
            )}
          </div>
        ))}
      </div>
      )}
    </div>
  )
}
