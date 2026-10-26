import { LineChart } from 'lucide-react'
import { Num } from '@/components/ui/typography'

interface ExecutiveRoiCardProps {
  monthlySavingsLabel: string | null
  annualSavingsLabel: string | null
  isDemoActive: boolean
  detailsHref?: string
}

/**
 * Compact executive summary of identified (not realized) savings. Never
 * claims DevControl "has saved" anything in real mode — only "identified" /
 * "estimated", since there's no authoritative realized-savings data source.
 */
export function ExecutiveRoiCard({ monthlySavingsLabel, annualSavingsLabel, isDemoActive, detailsHref = '/costs' }: ExecutiveRoiCardProps) {
  return (
    <div className="bg-[var(--surface-2)] rounded-2xl border border-border p-5 h-full flex flex-col">
      <div className="flex items-center flex-wrap justify-between gap-x-3 gap-y-1 mb-4">
        <div className="flex items-center gap-2.5">
          <LineChart size={17} style={{ color: 'var(--text-accent)' }} />
          <h3 className="text-section text-ink">Executive ROI Summary</h3>
        </div>
        <a href={detailsHref} className="text-label font-semibold no-underline whitespace-nowrap" style={{ color: 'var(--text-accent)' }}>
          View report →
        </a>
      </div>

      <p className="text-label font-medium text-ink-muted mb-1.5">
        {isDemoActive ? 'Monthly savings realized' : 'Estimated monthly savings'}
      </p>
      <div className="text-kpi tabular-nums leading-none mb-1.5" style={{ color: 'var(--text-success)' }}>
        {monthlySavingsLabel ?? '—'}
      </div>
      {/* No label means no active recommendation carries a figure -- not
          evidence that nothing can be saved, so no conclusion is shown. */}
      {monthlySavingsLabel && (
        <p className="text-meta text-ink-muted mb-4">
          Based on current optimization opportunities
        </p>
      )}

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
