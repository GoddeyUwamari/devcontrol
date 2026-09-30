import { Code2, TrendingUp, TrendingDown } from 'lucide-react'

interface DoraRow {
  label: string
  value: string
  /** Demo-only decorative delta — never populated in real mode. */
  delta?: { direction: 'up' | 'down'; label: string; good: boolean }
}

interface EngineeringHealthCardProps {
  isDemoActive: boolean
  doraRows: DoraRow[]
}

/**
 * Real mode has no DORA metrics source wired to this card. It says only that,
 * without claiming anything about the organization's CI/CD or deployments
 * (which may well exist); "View details" leads to the DORA metrics page.
 * Demo mode keeps the existing demonstration metrics, laid out as a compact
 * 4-up stat grid.
 */
export function EngineeringHealthCard({ isDemoActive, doraRows }: EngineeringHealthCardProps) {
  return (
    <div className="bg-[var(--surface-2)] rounded-2xl border border-border p-5 h-full">
      <div className="flex items-center flex-wrap justify-between gap-x-3 gap-y-1 mb-4">
        <div className="flex items-center gap-2.5">
          <Code2 size={17} style={{ color: 'var(--text-accent)' }} />
          <h3 className="text-base font-bold text-foreground">Engineering Health</h3>
        </div>
        <a href="/app/dora-metrics" className="text-xs font-semibold no-underline flex items-center gap-1 whitespace-nowrap" style={{ color: 'var(--text-accent)' }}>
          View details →
        </a>
      </div>

      {isDemoActive ? (
        <div className="grid grid-cols-2 gap-4">
          {doraRows.map(({ label, value, delta }) => {
            const DeltaIcon = delta?.direction === 'up' ? TrendingUp : TrendingDown
            return (
              <div key={label}>
                <div className="text-2xl font-bold text-foreground leading-none mb-1.5">{value}</div>
                <p className="text-xs text-[var(--text-secondary)] leading-snug mb-1.5">{label}</p>
                {delta && (
                  <div className="flex items-center gap-1" style={{ color: delta.good ? 'var(--text-success)' : 'var(--text-danger)' }}>
                    <DeltaIcon size={12} />
                    <span className="text-xs font-semibold">{delta.label}</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="flex flex-col items-start gap-3 py-4">
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed">DORA metrics are not summarized on the dashboard yet.</p>
        </div>
      )}
    </div>
  )
}
