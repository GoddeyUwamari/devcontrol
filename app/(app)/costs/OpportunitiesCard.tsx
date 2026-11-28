'use client'

import { ChevronRight } from 'lucide-react'
import type { RecommendationSeverity } from '@/lib/types'
import { opportunitiesFooter } from './cost-intelligence'

export interface OpportunityRow {
  id: string
  title: string
  savingsLabel: string
  /** Green figure: a firm estimate of at least $1/mo as displayed (opportunityFigure); otherwise grey (ruling Q2). */
  strong: boolean
  /** The figure's basis ("Upper-bound estimate", "Monthly estimate"); null for no dollar figure. */
  basisNote: string | null
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

export const OPPORTUNITIES_TITLE = 'Optimization opportunities'
/** The section's id: the result banner's "See the new opportunity" brings it into view and focuses its heading (PR B). */
export const OPPORTUNITIES_ANCHOR = 'opportunities'
export const OPPORTUNITIES_ERROR = 'Recommendations could not be retrieved.'
export const OPPORTUNITIES_EMPTY = 'No optimization recommendations yet. Run cost analysis to identify savings opportunities.'
/**
 * Where each card's Review goes: Cost Optimization's Opportunities section (its existing OPPORTUNITIES_ANCHOR,
 * cost-optimization/page.tsx). That page has no per-finding anchor, so the section is the closest existing target.
 */
export const OPPORTUNITY_REVIEW_HREF = '/cost-optimization#opportunities'

/**
 * Opportunities (spec item 11): the top open findings by the savings figure
 * each card shows (rankByDisplayedSavings, fix round 1 N-7), each with its
 * "Why:" line from allowlisted evidence (why-evidence.ts). `total` is /stats'
 * open count, null when unknown. While loading: "—", never the empty text
 * (N-1). `emptyText`: what an analysis that left nothing open says, so the
 * card agrees with the savings tile (N-1); otherwise OPPORTUNITIES_EMPTY.
 *
 * Layout (mock-match item 4), by the card's own width (a container query):
 * from 32rem, the mock's row: figure, then title, "Why:", severity and the
 * figure's basis, then Review. Narrower (the three-column row, a phone): the
 * text first, then the figure with Review beside it. Only `order`, `basis`
 * and margins change, so every card in a column has the same layout.
 */
export function OpportunitiesCard({ rows, total, isError, isLoading = false, emptyText, className = '' }: {
  rows: OpportunityRow[]; total: number | null; isError: boolean; isLoading?: boolean; emptyText?: string; className?: string
}) {
  const footer = !isError && !isLoading ? opportunitiesFooter(rows.length, total) : null
  return (
    <section id={OPPORTUNITIES_ANCHOR} aria-labelledby="opportunities-heading" className={`scroll-mt-24 bg-white rounded-xl p-5 sm:p-6 border border-slate-200 flex flex-col gap-4 min-w-0 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="opportunities-heading" tabIndex={-1} className="text-section font-semibold text-slate-900 m-0 tracking-tight outline-none">{OPPORTUNITIES_TITLE}</h2>
          {!isError && rows.length > 0 && total !== null && total > rows.length && (
            <p className="text-meta text-ink-muted m-0 mt-0.5">Top {rows.length} of {total}, largest savings first</p>
          )}
        </div>
        <a href="/cost-optimization" className="text-ui font-semibold text-violet-700 hover:text-violet-800 no-underline flex items-center gap-1 shrink-0 whitespace-nowrap">
          View all <ChevronRight size={14} aria-hidden="true" />
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
            <li key={rec.id} className="@container p-4 rounded-xl border border-slate-200 min-w-0" data-testid="opportunity-card">
              <div className="flex flex-wrap items-center gap-3 @lg:flex-nowrap @lg:gap-4">
              <span
                className={`order-2 @lg:order-1 shrink-0 px-2.5 py-1.5 rounded-lg text-ui font-semibold tabular-nums whitespace-nowrap ${rec.strong ? 'bg-green-50 text-ink-success' : 'bg-slate-100 text-ink-muted'}`}
                data-testid="opportunity-savings"
              >
                {rec.savingsLabel}
              </span>
              <div className="order-1 @lg:order-2 basis-full @lg:basis-0 grow min-w-0 flex flex-col gap-1.5">
                <p className="text-ui font-semibold text-slate-900 m-0 leading-snug break-words">{rec.title}</p>
                <p className="text-meta text-ink-muted m-0 break-words" data-testid="opportunity-why">{rec.why}</p>
                <p className="m-0 flex flex-wrap items-center gap-2 text-meta text-ink-muted">
                  <span className={`text-label font-semibold px-2 py-0.5 rounded-full border ${severityStyles[rec.severity]}`}>{rec.severity}</span>
                  {rec.basisNote && <span data-testid="opportunity-basis">{rec.basisNote}</span>}
                </p>
              </div>
              <a
                href={OPPORTUNITY_REVIEW_HREF}
                aria-label={`Review ${rec.title} on Cost Optimization`}
                className="order-3 ml-auto shrink-0 inline-flex min-h-11 items-center justify-center rounded-lg bg-green-700 hover:bg-green-800 px-4 text-ui font-semibold text-white no-underline transition-colors"
                data-testid="opportunity-review"
              >
                Review
              </a>
              </div>
            </li>
          ))}
        </ul>
      )}
      {footer && <p className="text-meta text-ink-muted m-0" data-testid="opportunities-footer">{footer}</p>}
    </section>
  )
}
