'use client'

import Link from 'next/link'
import { OVERVIEW_COPY } from './overviewModel'

/** "All N resources → Open Services & Ownership". */
export function OverviewFooter({ total }: { total: number | null }) {
  return (
    <section aria-labelledby="infra-footer-heading" className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
      <h2 id="infra-footer-heading" className="m-0 text-sm font-semibold text-slate-900">
        {total !== null ? `All ${total} ${total === 1 ? 'resource' : 'resources'}` : 'All resources'}
      </h2>
      <Link href="/services" className="inline-flex justify-center rounded-lg bg-violet-700 px-4 py-2 text-sm font-semibold text-white no-underline hover:bg-violet-800">
        {OVERVIEW_COPY.openServices}
      </Link>
    </section>
  )
}
