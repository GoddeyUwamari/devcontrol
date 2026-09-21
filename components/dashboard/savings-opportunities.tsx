import { PuzzleIcon } from 'lucide-react'

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

/**
 * Compact detected-opportunity cards, one per supported resource type.
 * "Not currently evaluated" is only ever shown when the org genuinely has no
 * completed optimization scan yet (evaluationState from cost_analysis_runs)
 * -- never merely because a type's filtered count happens to be zero. A
 * type that ran and found nothing renders a truthful zero ("0 detected",
 * "$0/mo"), not a false "not evaluated" claim.
 */
export function SavingsOpportunities({ items, evaluationState, totalActiveCount, detailsHref = '/cost-optimization' }: SavingsOpportunitiesProps) {
  return (
    <div className="bg-[var(--surface-2)] rounded-2xl border border-border p-5 h-full">
      <div className="flex items-center flex-wrap justify-between gap-x-3 gap-y-1 mb-4">
        <div className="flex items-center gap-2.5">
          <PuzzleIcon size={17} style={{ color: 'var(--text-accent)' }} />
          <h3 className="text-base font-bold text-foreground">Cost-Saving Opportunities</h3>
        </div>
        <a href={detailsHref} className="text-xs font-semibold no-underline whitespace-nowrap" style={{ color: 'var(--text-accent)' }}>
          View all ({totalActiveCount}) →
        </a>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
    </div>
  )
}
