import { Num } from '@/components/ui/typography'
import { describeCeilings, describeCeilingsWithoutEstimate } from '@/lib/savings-basis'
import type { OpportunityEvaluationState } from './savings-opportunities'

interface EstimatedSavingsSummaryProps {
  monthlySavingsLabel: string | null
  annualSavingsLabel: string | null
  isDemoActive: boolean
  /** The latest cost analysis's state, the same one Cost-Saving Opportunities shows. */
  evaluationState?: OpportunityEvaluationState
  /** Server count of active findings; null when the stats request failed. */
  activeCount?: number | null
  /**
   * Upper bounds per resource type (S3 lifecycle, DynamoDB capacity, ...), shown
   * apart from the estimate and never added to it: one line each.
   */
  ceilingByResourceType?: Record<string, number> | null
  /** The surface's currency formatter for the ceiling lines. */
  formatAmount?: (value: number) => string
  statsLoading?: boolean
  statsFailed?: boolean
  onRetry?: () => void
}

/**
 * Identified (not realized) savings: the header of the Dashboard's
 * Cost-Saving Opportunities card (DB-D12 S1, formerly the separate "Estimated
 * savings" card). Never claims DevControl "has saved" anything in real mode,
 * and never turns an empty finding list into a "nothing to save" conclusion:
 * a completed scan does not record whether each check succeeded. Exactly one
 * line per situation, plus one line per ceiling type in the weekly email's
 * wording (DB-D13). Green is used only for a real estimate.
 */
export function EstimatedSavingsSummary({
  monthlySavingsLabel,
  annualSavingsLabel,
  isDemoActive,
  evaluationState = 'loading',
  activeCount = null,
  ceilingByResourceType = null,
  formatAmount = (value) => `$${value.toFixed(2)}`,
  statsLoading = false,
  statsFailed = false,
  onRetry,
}: EstimatedSavingsSummaryProps) {
  const ceilings = !isDemoActive && ceilingByResourceType ? ceilingByResourceType : {}
  const statusLine = (text: string, extra?: React.ReactNode) => (
    <div className="mb-1.5" data-testid="roi-state">
      <p className="text-ui text-ink-muted leading-relaxed">{text}</p>
      {extra}
    </div>
  )
  const retry = onRetry && (
    <button type="button" onClick={onRetry} className="text-label font-semibold bg-transparent border-none p-0 mt-1.5 cursor-pointer" style={{ color: 'var(--text-accent)' }}>
      Retry
    </button>
  )
  const link = (label: string) => (
    <a href="/cost-optimization" className="text-label font-semibold no-underline inline-block mt-1.5" style={{ color: 'var(--text-accent)' }}>{label}</a>
  )
  const ceilingLines = (lines: string[]) => lines.map((line) => (
    <p key={line} className="text-meta text-ink-muted mb-1.5" data-testid="savings-ceiling-line">{`${line}.`}</p>
  ))

  let body: React.ReactNode
  if (isDemoActive || monthlySavingsLabel) {
    body = (
      <>
        <p className="text-label font-medium text-ink-muted mb-1.5">
          {isDemoActive ? 'Estimated monthly savings (sample)' : 'Estimated monthly savings'}
        </p>
        <div className="text-kpi tabular-nums leading-none mb-1.5" style={{ color: 'var(--text-success)' }}>
          {monthlySavingsLabel ?? '—'}
        </div>
        {monthlySavingsLabel && (
          <p className="text-meta text-ink-muted mb-1.5">
            Based on current optimization opportunities
          </p>
        )}
        {ceilingLines(describeCeilings(ceilings, formatAmount, 'month'))}
      </>
    )
  } else if (statsLoading) {
    body = statusLine('Loading…')
  } else if (statsFailed || evaluationState === 'unavailable') {
    body = statusLine('Savings couldn’t be loaded.', retry)
  } else if (activeCount !== null && activeCount > 0) {
    // An active finding always wins over the analysis state.
    const lines = describeCeilingsWithoutEstimate(ceilings, formatAmount, 'month')
    body = lines.length > 0
      ? <div data-testid="roi-state">{ceilingLines(lines)}</div>
      : statusLine(`${activeCount} finding${activeCount === 1 ? '' : 's'} found; none has a dollar estimate yet.`)
  } else if (evaluationState === 'loading') {
    body = statusLine('Loading…')
  } else if (evaluationState === 'in_progress') {
    body = statusLine('Cost analysis in progress. Savings appear when it finishes.')
  } else if (evaluationState === 'failed') {
    body = statusLine('The last cost analysis didn’t finish.', link('See Cost Optimization →'))
  } else if (evaluationState === 'evaluated') {
    body = statusLine('Nothing flagged in the last cost analysis.', link('See results by check →'))
  } else {
    body = statusLine('Shown after your first cost analysis finishes.')
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4" data-testid="savings-summary">
      <div className="min-w-0">{body}</div>
      {annualSavingsLabel && (
        <div className="bg-[var(--bg-accent)] border border-[var(--border-accent)] rounded-xl px-4 py-3 shrink-0" data-testid="savings-annual">
          <p className="text-label font-semibold" style={{ color: 'var(--text-accent)' }}>Potential annual savings</p>
          <p className="text-section tracking-tight" style={{ color: 'var(--text-accent)' }}><Num>{annualSavingsLabel}</Num></p>
          <p className="text-label font-normal text-ink-muted">(estimated)</p>
        </div>
      )}
    </div>
  )
}
