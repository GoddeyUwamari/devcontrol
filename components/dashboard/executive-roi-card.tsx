import { LineChart } from 'lucide-react'
import { Num } from '@/components/ui/typography'
import type { OpportunityEvaluationState } from './savings-opportunities'

interface ExecutiveRoiCardProps {
  monthlySavingsLabel: string | null
  annualSavingsLabel: string | null
  isDemoActive: boolean
  /** The latest cost analysis's state, the same one Cost-Saving Opportunities shows. */
  evaluationState?: OpportunityEvaluationState
  /** Server count of active findings; null when the stats request failed. */
  activeCount?: number | null
  /** S3 lifecycle upper bound, shown apart from the estimate and never added to it. */
  ceilingLabel?: string | null
  statsLoading?: boolean
  statsFailed?: boolean
  onRetry?: () => void
  detailsHref?: string
}

/**
 * Compact summary of identified (not realized) savings. Never claims
 * DevControl "has saved" anything in real mode, and never turns an empty
 * finding list into a "nothing to save" conclusion: a completed scan does not
 * record whether each check succeeded. Exactly one line per situation.
 */
export function ExecutiveRoiCard({
  monthlySavingsLabel,
  annualSavingsLabel,
  isDemoActive,
  evaluationState = 'loading',
  activeCount = null,
  ceilingLabel = null,
  statsLoading = false,
  statsFailed = false,
  onRetry,
  detailsHref = '/cost-optimization',
}: ExecutiveRoiCardProps) {
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
          <p className="text-meta text-ink-muted mb-4">
            Based on current optimization opportunities
          </p>
        )}
        {!isDemoActive && ceilingLabel && (
          <p className="text-meta text-ink-muted mb-4">Plus up to {ceilingLabel}/month from S3 lifecycle (upper bound)</p>
        )}
      </>
    )
  } else if (statsLoading) {
    body = statusLine('Loading…')
  } else if (statsFailed || evaluationState === 'unavailable') {
    body = statusLine('Savings couldn’t be loaded.', retry)
  } else if (activeCount !== null && activeCount > 0) {
    // An active finding always wins over the analysis state.
    body = ceilingLabel
      ? statusLine(`Up to ${ceilingLabel}/month · S3 lifecycle, upper bound`)
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
    <div className="bg-[var(--surface-2)] rounded-2xl border border-border p-5 h-full flex flex-col">
      <div className="flex items-center flex-wrap justify-between gap-x-3 gap-y-1 mb-4">
        <div className="flex items-center gap-2.5">
          <LineChart size={17} style={{ color: 'var(--text-accent)' }} />
          <h3 className="text-section text-ink">Estimated savings</h3>
        </div>
        <a href={detailsHref} className="text-label font-semibold no-underline whitespace-nowrap" style={{ color: 'var(--text-accent)' }}>
          View findings →
        </a>
      </div>

      {body}

      {annualSavingsLabel && (
        <div className="bg-[var(--bg-accent)] border border-[var(--border-accent)] rounded-xl px-4 py-3 mt-auto">
          <p className="text-label font-semibold" style={{ color: 'var(--text-accent)' }}>Potential annual savings</p>
          <p className="text-section tracking-tight" style={{ color: 'var(--text-accent)' }}><Num>{annualSavingsLabel}</Num></p>
          <p className="text-label font-normal text-ink-muted">(estimated)</p>
        </div>
      )}
    </div>
  )
}
