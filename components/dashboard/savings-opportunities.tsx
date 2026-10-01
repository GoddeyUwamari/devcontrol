import { PuzzleIcon, Sparkles } from 'lucide-react'

/**
 * The latest cost analysis's state, mapped from the shared
 * deriveAnalysisStatus() (app/(app)/cost-optimization/costOptimizationStatus.ts)
 * plus the dashboard's own request state: 'unavailable' is a failed request,
 * never "not evaluated".
 */
export type OpportunityEvaluationState = 'evaluated' | 'not_evaluated' | 'in_progress' | 'failed' | 'unavailable' | 'loading'

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
   *  cost analysis (scheduled or manual), so there is no scenario where one
   *  category is evaluated and another isn't. It only qualifies a zero count. */
  evaluationState: OpportunityEvaluationState
  /** Same authoritative count the Recommended Action CTA uses -- never
   *  independently re-derived from just these 4 known categories, since a
   *  real recommendation can exist for a type this UI doesn't have a card
   *  for yet. null when the stats request failed: no count is shown. */
  totalActiveCount: number | null
  detailsHref?: string
}

const EVALUATION_LABEL: Record<OpportunityEvaluationState, string> = {
  evaluated: '',
  not_evaluated: 'Not currently evaluated',
  in_progress: 'Evaluation in progress',
  failed: 'Latest cost analysis did not complete',
  unavailable: 'Could not be retrieved',
  loading: 'Loading…',
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
 * An active recommendation is a fact whatever the analysis state, so a card
 * with one always shows its count and savings. The evaluation state only
 * qualifies a zero: "Not currently evaluated" only when no cost analysis
 * (scheduled or manual) has completed, never merely because a type's count
 * is zero; "Could not be retrieved" when a request failed.
 */
export function SavingsOpportunities({ items, evaluationState, totalActiveCount, detailsHref = '/cost-optimization' }: SavingsOpportunitiesProps) {
  // A completed scan with nothing active shows no conclusion -- a completed
  // run does not record whether each check succeeded or had enough data, so
  // "no opportunities" would be unsupported. not_evaluated/in_progress keep
  // their own per-category cards (each showing its own status) instead.
  const showEmptyState = evaluationState === 'evaluated' && items.length === 0
  const gridColsClass = GRID_COLS_BY_COUNT[Math.min(items.length, 4)] ?? 'lg:grid-cols-1'

  return (
    <div className="bg-[var(--surface-2)] rounded-2xl border border-border p-5 h-full">
      <div className="flex items-center flex-wrap justify-between gap-x-3 gap-y-1 mb-4">
        <div className="flex items-center gap-2.5">
          <PuzzleIcon size={17} style={{ color: 'var(--text-accent)' }} />
          <h3 className="text-base font-bold text-foreground">Cost-Saving Opportunities</h3>
        </div>
        <a href={detailsHref} className="text-xs font-semibold no-underline whitespace-nowrap" style={{ color: 'var(--text-accent)' }}>
          {totalActiveCount === null ? 'View all →' : `View all (${totalActiveCount}) →`}
        </a>
      </div>
      {showEmptyState ? (
        <div className="text-center py-8 flex flex-col items-center gap-2">
          <div className="w-10 h-10 rounded-xl bg-[var(--surface-1)] flex items-center justify-center mb-1">
            <Sparkles size={18} className="text-[var(--text-secondary)]" />
          </div>
          <p className="text-sm text-[var(--text-secondary)]">Scan results by check are on the Cost Optimization page.</p>
        </div>
      ) : (
      <div className={`grid grid-cols-1 sm:grid-cols-2 ${gridColsClass} gap-4`}>
        {items.map(({ type, title, description, count, savingsLabel, priorityBadge }) => (
          <div key={type} className="bg-[var(--surface-1)] rounded-xl border border-border p-4">
            <p className="text-xs text-[var(--text-secondary)] font-medium mb-2">{title}</p>
            {evaluationState === 'evaluated' || count > 0 ? (
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
            {count > 0 && priorityBadge && (
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
