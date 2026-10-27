'use client'

import Link from 'next/link'
import { PAGE_COPY, PAGE_HREF } from './securityCopy'

const CARDS = [
  { href: PAGE_HREF.anomalies, title: PAGE_COPY.anomaliesCard, text: PAGE_COPY.anomaliesCardText },
  { href: PAGE_HREF.anomalyRules, title: PAGE_COPY.anomalyRulesCard, text: PAGE_COPY.anomalyRulesCardText },
  { href: PAGE_HREF.auditLogs, title: PAGE_COPY.auditCard, text: PAGE_COPY.auditCardText },
]

/** The bottom row of three link cards (founder answer 1, F2c); they stack on phones. Each card is one link: title and text on the left, the arrow pinned right. */
export function BottomLinks() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {CARDS.map((card) => (
        <Link key={card.href} href={card.href} className="flex min-h-11 items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-600 sm:p-6">
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-card-title text-ink">{card.title}</span>
            <span className="text-meta text-ink-muted">{card.text}</span>
          </span>
          <span data-testid="security-card-arrow" aria-hidden="true" className="shrink-0 text-card-title text-ink-muted">{PAGE_COPY.cardArrow}</span>
        </Link>
      ))}
    </div>
  )
}
