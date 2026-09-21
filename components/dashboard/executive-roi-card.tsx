import { LineChart } from 'lucide-react'

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
          <h3 className="text-base font-bold text-foreground">Executive ROI</h3>
        </div>
        <a href={detailsHref} className="text-xs font-semibold no-underline whitespace-nowrap" style={{ color: 'var(--text-accent)' }}>
          View report →
        </a>
      </div>

      <p className="text-xs text-[var(--text-secondary)] font-medium mb-1.5">
        {isDemoActive ? 'Monthly savings realized' : 'Estimated monthly savings'}
      </p>
      <div className="text-3xl font-bold tracking-tight leading-none mb-1.5" style={{ color: 'var(--text-success)' }}>
        {monthlySavingsLabel ?? '—'}
      </div>
      <p className="text-xs text-[var(--text-secondary)] mb-4">
        {monthlySavingsLabel ? 'Based on current optimization opportunities' : 'No active cost-saving opportunities identified'}
      </p>

      {annualSavingsLabel && (
        <div className="bg-[var(--bg-accent)] border border-[var(--border-accent)] rounded-xl px-4 py-3 mt-auto">
          <p className="text-xs font-semibold" style={{ color: 'var(--text-accent)' }}>Potential annual savings</p>
          <p className="text-lg font-bold tracking-tight" style={{ color: 'var(--text-accent)' }}>{annualSavingsLabel}</p>
          <p className="text-[11px] text-[var(--text-secondary)]">(estimated)</p>
        </div>
      )}
    </div>
  )
}
