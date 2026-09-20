import { PuzzleIcon } from 'lucide-react'

interface OpportunityItem {
  title: string
  description: string
  /** null = this resource type isn't wired into the real recommendation backend yet — never shown as "$0 detected". */
  savingsLabel: string | null
  count: number | null
  /** Derived from the top matching recommendation's real `severity` field — never a fabricated "effort" estimate. */
  priorityBadge?: { label: string; color: string; background: string }
}

/**
 * Compact detected-opportunity cards. A resource type the backend doesn't
 * actually scan for yet (savingsLabel === null) renders "Not currently
 * evaluated", never a fabricated dollar figure or "0 detected" that would
 * imply active coverage.
 */
export function SavingsOpportunities({ items, detailsHref = '/cost-optimization' }: { items: OpportunityItem[]; detailsHref?: string }) {
  const totalCount = items.reduce((sum, i) => sum + (i.count ?? 0), 0)
  return (
    <div className="bg-[var(--surface-2)] rounded-2xl border border-border p-5 h-full">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <PuzzleIcon size={17} style={{ color: 'var(--text-accent)' }} />
          <h3 className="text-base font-bold text-foreground">Cost-Saving Opportunities</h3>
        </div>
        <a href={detailsHref} className="text-xs font-semibold no-underline whitespace-nowrap" style={{ color: 'var(--text-accent)' }}>
          View all ({totalCount}) →
        </a>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {items.map(({ title, description, savingsLabel, priorityBadge }) => (
          <div key={title} className="bg-[var(--surface-1)] rounded-xl border border-border p-4">
            <p className="text-xs text-[var(--text-secondary)] font-medium mb-2">{title}</p>
            <div className="text-xl font-bold tracking-tight leading-none mb-2" style={{ color: savingsLabel ? 'var(--text-success)' : 'var(--text-secondary)' }}>
              {savingsLabel ?? 'Not currently evaluated'}
            </div>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed mb-2.5">{description}</p>
            {priorityBadge && (
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
