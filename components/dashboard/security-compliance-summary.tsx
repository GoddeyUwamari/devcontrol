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
  /**
   * Per-fact "the request failed and there is no data to show" flags. Each one
   * renders "Unavailable" in place of that fact's empty/not-evaluated text, so a
   * failed request is never presented as a real zero or empty result.
   */
  findingsError?: boolean
  resourceComplianceError?: boolean
  soc2Error?: boolean
  customFrameworksError?: boolean
  detailsHref?: string
}

const SEVERITY_CONFIG = {
  critical: { label: 'Critical', color: 'var(--text-danger)', background: 'var(--bg-danger)' },
  high: { label: 'High', color: 'var(--text-warning)', background: 'var(--bg-warning)' },
  medium: { label: 'Medium', color: 'var(--text-warning)', background: 'var(--bg-warning)' },
  low: { label: 'Low', color: 'var(--text-secondary)', background: 'var(--surface-1)' },
} as const

const INFO_BADGE = { label: 'Info', color: '#1D4ED8', background: '#EFF6FF' }

// Shown in place of a fact whose request failed -- never that fact's empty text.
const UNAVAILABLE = 'Unavailable'

// Destinations are existing pages over the same data each row summarizes.
// Resource compliance has none (no page shows per-resource compliance_issues),
// so it gets no href -- and the chevron only renders when a row really links.
const FINDINGS_HREF = '/security#findings'
const SOC2_HREF = '/compliance/frameworks/soc2'
const CUSTOM_FRAMEWORKS_HREF = '/compliance/frameworks'

function Row({ badge, headline, sub, href }: { badge: { label: string; color: string; background: string }; headline: string; sub: string; href?: string }) {
  // The divider belongs on whichever element is the list's direct child --
  // on the inner div, a wrapping <a> would make every row :last-child.
  const divider = 'border-b border-border last:border-b-0'
  const content = (
    <div className={`flex items-center gap-3 py-3${href ? '' : ` ${divider}`}`}>
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
      {href && <ChevronRight size={14} className="text-[var(--text-secondary)] shrink-0" />}
    </div>
  )
  return href ? <a href={href} className={`no-underline block ${divider}`}>{content}</a> : content
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
 *
 * Each fact is also error-aware: a request that failed renders "Unavailable",
 * checked before the empty-state branch, since "we checked and found nothing"
 * and "we couldn't check" are different claims.
 */
export function SecurityComplianceSummary({
  findingCounts,
  riskDataLoading,
  complianceBreakdown,
  soc2Subtext,
  soc2Loading,
  customFrameworksSubtext,
  customFrameworksLoading,
  findingsError = false,
  resourceComplianceError = false,
  soc2Error = false,
  customFrameworksError = false,
  detailsHref = FINDINGS_HREF,
}: SecurityComplianceSummaryProps) {
  const severityRows = findingCounts
    ? (['critical', 'high', 'medium', 'low'] as const)
        .filter((tier) => findingCounts[tier] > 0)
        .map((tier) => ({
          badge: SEVERITY_CONFIG[tier],
          headline: `${findingCounts[tier]} ${SEVERITY_CONFIG[tier].label.toLowerCase()} finding${findingCounts[tier] !== 1 ? 's' : ''}`,
          sub: 'Account-level security finding',
          href: FINDINGS_HREF,
        }))
    : []

  return (
    <div className="bg-[var(--surface-2)] rounded-2xl border border-border p-5 h-full">
      <div className="flex items-center flex-wrap justify-between gap-x-3 gap-y-1 mb-2">
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
        ) : findingsError ? (
          <div className="py-4 text-xs text-[var(--text-secondary)]">Account-level findings: Unavailable</div>
        ) : severityRows.length > 0 ? (
          severityRows.map((row) => <Row key={row.badge.label} {...row} />)
        ) : (
          <div className="py-4 text-xs text-[var(--text-secondary)]">No open account-level findings recorded yet.</div>
        )}

        {riskDataLoading ? (
          <RowSkeleton />
        ) : (
          <Row badge={INFO_BADGE} headline="Resource compliance" sub={resourceComplianceError ? UNAVAILABLE : (complianceBreakdown ?? 'Not yet evaluated')} />
        )}

        {soc2Loading ? (
          <RowSkeleton />
        ) : (
          <Row badge={INFO_BADGE} headline="SOC 2 readiness" sub={soc2Error ? UNAVAILABLE : soc2Subtext} href={SOC2_HREF} />
        )}

        {customFrameworksLoading ? (
          <RowSkeleton />
        ) : (
          <Row badge={INFO_BADGE} headline="Custom frameworks" sub={customFrameworksError ? UNAVAILABLE : customFrameworksSubtext} href={CUSTOM_FRAMEWORKS_HREF} />
        )}
      </div>
    </div>
  )
}
