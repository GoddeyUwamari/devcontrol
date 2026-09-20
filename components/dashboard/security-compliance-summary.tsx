import { ShieldCheck, ChevronRight } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'

interface FindingCounts {
  critical: number
  high: number
  medium: number
  low: number
}

interface SecurityComplianceSummaryProps {
  findingCounts: FindingCounts | null
  /** Same underlying query as findingCounts/complianceBreakdown -- one flag covers both rows. */
  riskDataLoading: boolean
  complianceBreakdown: string | null
  soc2Subtext: string
  soc2Loading: boolean
  customFrameworksSubtext: string
  customFrameworksLoading: boolean
  detailsHref?: string
}

const SEVERITY_CONFIG = {
  critical: { label: 'Critical', color: 'var(--text-danger)', background: 'var(--bg-danger)' },
  high: { label: 'High', color: 'var(--text-warning)', background: 'var(--bg-warning)' },
  medium: { label: 'Medium', color: 'var(--text-warning)', background: 'var(--bg-warning)' },
  low: { label: 'Low', color: 'var(--text-secondary)', background: 'var(--surface-1)' },
} as const

const INFO_BADGE = { label: 'Info', color: '#1D4ED8', background: '#EFF6FF' }

function Row({ badge, headline, sub }: { badge: { label: string; color: string; background: string }; headline: string; sub: string }) {
  return (
    <div className="flex items-center gap-3 py-3 border-b border-border last:border-b-0">
      <span
        className="text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap shrink-0"
        style={{ color: badge.color, background: badge.background }}
      >
        {badge.label}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-foreground leading-snug truncate">{headline}</p>
        <p className="text-xs text-[var(--text-secondary)] leading-snug truncate">{sub}</p>
      </div>
      <ChevronRight size={14} className="text-[var(--text-secondary)] shrink-0" />
    </div>
  )
}

function RowSkeleton() {
  return (
    <div className="flex items-center gap-3 py-3 border-b border-border last:border-b-0">
      <Skeleton className="h-5 w-14 rounded-full shrink-0" />
      <div className="min-w-0 flex-1 flex flex-col gap-1.5">
        <Skeleton className="h-3.5 w-2/3" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    </div>
  )
}

/**
 * Security & Compliance is deliberately never collapsed into one "score" —
 * per-severity finding counts, resource compliance, SOC 2 readiness, and
 * custom frameworks are distinct facts, each shown only when the backend
 * actually has data for it. Never renders "SOC 2 compliant/certified" or a
 * manufactured framework pass count.
 *
 * Each fact is loading-aware: a query still in flight renders a skeleton,
 * never the "nothing found" empty-state text -- null is only ever read as
 * "confirmed empty" once its own query has actually settled.
 */
export function SecurityComplianceSummary({
  findingCounts,
  riskDataLoading,
  complianceBreakdown,
  soc2Subtext,
  soc2Loading,
  customFrameworksSubtext,
  customFrameworksLoading,
  detailsHref = '/security',
}: SecurityComplianceSummaryProps) {
  const severityRows = findingCounts
    ? (['critical', 'high', 'medium', 'low'] as const)
        .filter((tier) => findingCounts[tier] > 0)
        .map((tier) => ({
          badge: SEVERITY_CONFIG[tier],
          headline: `${findingCounts[tier]} ${SEVERITY_CONFIG[tier].label.toLowerCase()} finding${findingCounts[tier] !== 1 ? 's' : ''}`,
          sub: 'Account-level security finding',
        }))
    : []

  return (
    <div className="bg-[var(--surface-2)] rounded-2xl border border-border p-5 h-full">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2.5">
          <ShieldCheck size={17} style={{ color: 'var(--text-accent)' }} />
          <h3 className="text-base font-bold text-foreground">Security Key Findings</h3>
        </div>
        <a href={detailsHref} className="text-xs font-semibold no-underline whitespace-nowrap" style={{ color: 'var(--text-accent)' }}>
          View all →
        </a>
      </div>

      <div>
        {riskDataLoading ? (
          <>
            <RowSkeleton />
            <RowSkeleton />
          </>
        ) : severityRows.length > 0 ? (
          severityRows.map((row) => <Row key={row.badge.label} {...row} />)
        ) : (
          <div className="py-4 text-xs text-[var(--text-secondary)]">No open account-level findings recorded yet.</div>
        )}

        {riskDataLoading ? (
          <RowSkeleton />
        ) : (
          <Row badge={INFO_BADGE} headline="Resource compliance" sub={complianceBreakdown ?? 'Not yet evaluated'} />
        )}

        {soc2Loading ? (
          <RowSkeleton />
        ) : (
          <Row badge={INFO_BADGE} headline="SOC 2 readiness" sub={soc2Subtext} />
        )}

        {customFrameworksLoading ? (
          <RowSkeleton />
        ) : (
          <Row badge={INFO_BADGE} headline="Custom frameworks" sub={customFrameworksSubtext} />
        )}
      </div>
    </div>
  )
}
