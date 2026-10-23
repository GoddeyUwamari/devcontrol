'use client'

import Link from 'next/link'
import { OVERVIEW_COPY, type OverviewView } from './overviewModel'

/** Unowned and unreadable-tag counts only (no D3 split in this phase). */
export function OwnershipGaps({ ownership }: { ownership: NonNullable<OverviewView['ownership']> }) {
  return (
    <section aria-labelledby="infra-ownership-heading" className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
      <h2 id="infra-ownership-heading" className="m-0 mb-3 text-base font-bold text-slate-900">{OVERVIEW_COPY.ownershipTitle}</h2>
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm text-slate-700">
        {ownership.lines.map((line) => <li key={line}>{line}</li>)}
      </ul>
      {ownership.note && <p className="m-0 mt-2 text-xs text-slate-600">{ownership.note}</p>}
      <Link href="/services" className="mt-3 inline-block text-sm font-semibold text-violet-700 hover:underline">{OVERVIEW_COPY.assignOwners}</Link>
    </section>
  )
}
