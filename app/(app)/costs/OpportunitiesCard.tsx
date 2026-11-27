'use client'

import { ChevronRight } from 'lucide-react'
import type { RecommendationSeverity } from '@/lib/types'

export interface OpportunityRow {
  id: string
  title: string
  savingsLabel: string
  severity: RecommendationSeverity
  why: string
}

const severityStyles: Record<RecommendationSeverity, string> = {
  HIGH: 'bg-red-50 text-red-700 border-red-200',
  MEDIUM: 'bg-amber-50 text-amber-700 border-amber-200',
  LOW: 'bg-slate-100 text-slate-600 border-slate-200',
}

/** How many cards the page shows (founder ruling Q8); the rest are on Cost Optimization. */
export const OPPORTUNITY_LIMIT = 5

export const OPPORTUNITIES_ERROR = 'Recommendations could not be retrieved.'
export const OPPORTUNITIES_EMPTY = 'No optimization recommendations yet. Run cost analysis to identify savings opportunities.'

/**
 * Opportunities (spec item 11): the top open findings by the savings figure
 * each card shows (rankByDisplayedSavings, fix round 1 N-7), each with its
 * "Why:" line from allowlisted evidence (why-evidence.ts). `total` is /stats'
 * open count, null when unknown. While loading: "—", never the empty text
 * (N-1). `emptyText`: what an analysis that left nothing open says, so the
 * card agrees with the savings tile (N-1); otherwise OPPORTUNITIES_EMPTY.
 */
export function OpportunitiesCard({ rows, total, isError, isLoading = false, emptyText }: {
  rows: OpportunityRow[]; total: number | null; isError: boolean; isLoading?: boolean; emptyText?: string
}) {
  return (
    <section aria-labelledby="opportunities-heading" className="bg-white rounded-2xl p-5 sm:p-8 border border-slate-100 mb-5">
      <div className="flex items-center justify-between gap-3 mb-5">
        <div className="min-w-0">
          <h2 id="opportunities-heading" className="text-ui font-semibold text-slate-900 m-0 tracking-tight">Opportunities</h2>
          {!isError && rows.length > 0 && total !== null && total > rows.length && (
            <p className="text-meta text-ink-muted m-0 mt-0.5">Top {rows.length} of {total}, largest savings first</p>
          )}
        </div>
        <a href="/cost-optimization" className="text-label font-semibold text-violet-600 no-underline flex items-center gap-1 shrink-0">
          View all <ChevronRight size={12} aria-hidden="true" />
        </a>
      </div>
      {isError ? (
        <p className="text-meta text-ink-muted m-0 p-6 text-center">{OPPORTUNITIES_ERROR}</p>
      ) : isLoading ? (
        <p className="text-meta text-ink-muted m-0 p-6 text-center" data-testid="opportunities-loading" aria-busy="true">—</p>
      ) : rows.length === 0 ? (
        <p className="text-meta text-ink-muted m-0 p-6 text-center" data-testid="opportunities-empty">{emptyText ?? OPPORTUNITIES_EMPTY}</p>
      ) : (
        <ul className="m-0 p-0 list-none flex flex-col gap-3">
          {rows.map((rec) => (
            <li key={rec.id} className="p-3.5 sm:p-4 bg-slate-50 rounded-xl border border-slate-100" data-testid="opportunity-card">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3 mb-1.5">
                <p className="text-label font-medium text-slate-900 m-0 leading-relaxed">{rec.title}</p>
                <span className="text-label font-semibold text-slate-900 shrink-0 tabular-nums" data-testid="opportunity-savings">{rec.savingsLabel}</span>
              </div>
              <p className="text-meta text-ink-muted m-0 mb-2 break-words" data-testid="opportunity-why">{rec.why}</p>
              <span className={`text-label font-semibold px-2 py-0.5 rounded-full border ${severityStyles[rec.severity]}`}>{rec.severity}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
