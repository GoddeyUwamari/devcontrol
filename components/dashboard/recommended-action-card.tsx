import { Zap, CheckCircle2 } from 'lucide-react'

interface RecommendedActionCardProps {
  opportunityCount: number
  savingsLabel: string | null
  ctaHref: string
  isDemoActive?: boolean
}

/**
 * Single, prominent savings recommendation — the ONE primary savings CTA on
 * the dashboard. Renders a truthful empty state instead of a fabricated
 * recommendation when there is nothing active to review.
 */
export function RecommendedActionCard({ opportunityCount, savingsLabel, ctaHref, isDemoActive = false }: RecommendedActionCardProps) {
  const hasOpportunities = opportunityCount > 0

  return (
    <div className="rounded-2xl border px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6" style={{ background: 'var(--bg-accent)', borderColor: 'var(--border-accent)' }}>
      <div className="flex items-start gap-3.5">
        <div className="w-10 h-10 rounded-xl bg-[var(--surface-2)] flex items-center justify-center shrink-0">
          <Zap size={17} style={{ color: 'var(--text-accent)' }} />
        </div>
        <div>
          <div className="text-[11px] font-bold tracking-widest uppercase mb-1" style={{ color: 'var(--text-accent)' }}>
            Recommended action
          </div>
          {hasOpportunities ? (
            <>
              <div className="text-base font-bold text-foreground mb-1">
                {opportunityCount} optimization opportunit{opportunityCount !== 1 ? 'ies' : 'y'} identified
              </div>
              {savingsLabel && (
                <div className="flex items-center gap-1.5 text-[13px]" style={{ color: 'var(--text-success)' }}>
                  <CheckCircle2 size={13} />
                  <span>Potential savings: {savingsLabel}</span>
                </div>
              )}
              {isDemoActive && (
                <div className="flex gap-1.5 flex-wrap mt-2">
                  {['Zero downtime', 'Fully reversible', 'Takes < 5 min'].map((pill) => (
                    <span key={pill} className="bg-[var(--surface-2)] border border-border rounded-full px-2.5 py-0.5 text-xs text-[var(--text-secondary)]">
                      {pill}
                    </span>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="text-base font-semibold text-[var(--text-secondary)]">
              No active cost-saving opportunities identified
            </div>
          )}
        </div>
      </div>
      {hasOpportunities && (
        <a
          href={ctaHref}
          className="bg-[var(--text-accent)] text-white rounded-xl px-5 py-2.5 text-[13px] font-semibold no-underline whitespace-nowrap shrink-0 self-start sm:self-center"
        >
          Review Savings ({opportunityCount}) →
        </a>
      )}
    </div>
  )
}
