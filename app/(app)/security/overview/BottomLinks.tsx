'use client'

import Link from 'next/link'
import { PAGE_COPY, PAGE_HREF } from './securityCopy'

const CARDS = [
  { href: PAGE_HREF.anomalies, title: PAGE_COPY.anomaliesCard, text: PAGE_COPY.anomaliesCardText },
  { href: PAGE_HREF.auditLogs, title: PAGE_COPY.auditCard, text: PAGE_COPY.auditCardText },
]

/** The bottom row of two link cards (founder answer 1). */
export function BottomLinks() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {CARDS.map((card) => (
        <Link key={card.href} href={card.href} className="flex min-h-11 flex-col gap-1 rounded-xl border border-slate-200 bg-white p-4 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-600 sm:p-6">
          <span className="text-card-title text-ink">{card.title}</span>
          <span className="text-meta text-ink-muted">{card.text}</span>
        </Link>
      ))}
    </div>
  )
}
