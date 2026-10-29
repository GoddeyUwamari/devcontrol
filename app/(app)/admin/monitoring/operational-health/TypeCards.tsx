'use client'

import { cn } from '@/lib/utils'
import type { TypeCard } from './operationalHealthModel'
import { PAGE_COPY } from './operationalHealthCopy'
import { PILL } from './tones'

/** One card per resource type found; the pill's text carries the state, its colour the worst one. */
export function TypeCards({ cards }: { cards: TypeCard[] | null }) {
  if (!cards || cards.length === 0) return null
  return (
    <section aria-labelledby="health-by-type" className="rounded-xl border border-slate-200 bg-white p-4 sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="health-by-type" className="m-0 text-card-title text-ink">{PAGE_COPY.byTypeTitle}</h2>
        <span className="text-meta text-ink-muted">{PAGE_COPY.byTypeCaption}</span>
      </div>
      <ul className="m-0 mt-3 grid list-none gap-2.5 p-0 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
        {cards.map((card) => (
          <li key={card.type} data-testid={`type-card-${card.type}`} className="flex flex-col gap-1 rounded-lg border border-slate-200 px-3.5 py-3">
            <div className="flex items-center justify-between gap-2">
              <strong className="text-ui text-ink">{card.title}</strong>
              <span data-testid="type-pill" data-tone={card.pill.tone} className={cn('rounded-full border px-2 py-px text-meta font-semibold', PILL[card.pill.tone])}>{card.pill.text}</span>
            </div>
            {card.detail && <span className="text-meta text-ink-body">{card.detail}</span>}
            {card.measuredBy && <span className="text-meta text-ink-muted">Measured by {card.measuredBy}</span>}
          </li>
        ))}
      </ul>
    </section>
  )
}
