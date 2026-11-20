import { COPY, type WhatChangedItem } from '../_lib/dora-page'

/** Up to three fixed-rule sentences (whatChanged in _lib/dora-page.ts), or one explaining why there are none. */
export function WhatChanged({ items, emptyText }: { items: WhatChangedItem[] | null; emptyText: string }) {
  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 flex flex-col min-w-0" data-testid="dora-what-changed" aria-label={COPY.whatChangedTitle}>
      <h2 className="text-card-title text-ink mb-3">{COPY.whatChangedTitle}</h2>
      {items && items.length > 0 ? (
        <ul className="flex flex-col gap-3 mb-3">
          {items.map((item) => (
            <li key={item.headline} data-testid="dora-what-changed-item">
              <p className="text-ui font-semibold text-ink">{item.headline}</p>
              <p className="text-meta text-ink-muted">{item.detail}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-meta text-ink-muted mb-3" data-testid="dora-what-changed-empty">{emptyText}</p>
      )}
      <p className="mt-auto pt-3 border-t border-slate-100 text-meta text-ink-muted">{COPY.whatChangedFooter}</p>
    </section>
  )
}
