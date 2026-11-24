'use client'

import Link from 'next/link'
import { OVERVIEW_COPY, type OwnershipView } from './overviewModel'

function Stat({ value, label, testId }: { value: number; label: string; testId: string }) {
  return (
    <div data-testid={testId} className="flex flex-col gap-1 rounded-lg bg-slate-50 p-3">
      <span className="text-kpi tabular-nums text-slate-900">{value.toLocaleString('en-US')}</span>
      <span className="text-meta text-slate-700">{label}</span>
    </div>
  )
}

/**
 * Ownership (redesign item 6), beside What we checked: "No owner tag" and "Tags couldn't be read"
 * (never "unowned"), the sentence, and the links to Services right under it. The sentence and
 * "All N resources" are hidden on a phone (board 2).
 */
export function OwnershipGaps({ ownership }: { ownership: OwnershipView }) {
  return (
    <section aria-labelledby="infra-ownership-heading" className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
      <h2 id="infra-ownership-heading" className="m-0 text-section text-slate-900">{OVERVIEW_COPY.ownershipTitle}</h2>
      {ownership.status === 'loading' && <p role="status" className="m-0 text-ui text-slate-600">Loading…</p>}
      {ownership.status === 'error' && <p className="m-0 text-ui text-slate-700">{ownership.text}</p>}
      {ownership.status === 'empty' && (
        <div className="flex flex-col gap-1">
          <p className="m-0 text-ui font-semibold text-slate-900">{ownership.text}</p>
          {ownership.note && <p className="m-0 text-meta text-slate-600">{ownership.note}</p>}
        </div>
      )}
      {ownership.status === 'ready' && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Stat value={ownership.noOwnerTag} label={OVERVIEW_COPY.noOwnerTag} testId="infra-ownership-no-owner-tag" />
            <Stat value={ownership.unknown} label={OVERVIEW_COPY.tagsUnreadable} testId="infra-ownership-unknown" />
          </div>
          <p data-testid="infra-ownership-sentence" className="m-0 hidden text-meta text-slate-600 sm:block">{ownership.sentence}</p>
        </>
      )}
      {/* Directly under the sentence (founder, Nov 24 round 3), not pinned to the card's bottom. */}
      <div className="flex flex-col gap-2">
        <Link href="/services" className="flex min-h-11 items-center text-ui font-semibold text-violet-700 hover:underline sm:min-h-0">{OVERVIEW_COPY.seeOwnership}</Link>
        {ownership.status === 'ready' && (
          <Link href="/services" data-testid="infra-ownership-all" className="hidden text-ui font-semibold text-violet-700 hover:underline sm:block">
            All {ownership.total.toLocaleString('en-US')} {ownership.total === 1 ? 'resource' : 'resources'} →
          </Link>
        )}
      </div>
    </section>
  )
}
