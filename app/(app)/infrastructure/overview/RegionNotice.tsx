'use client'

import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { OVERVIEW_COPY, type RegionNotice as RegionNoticeView } from './overviewModel'

/** The one amber notice (redesign item 2): only when the scan couldn't check a region. */
export function RegionNotice({ notice }: { notice: RegionNoticeView }) {
  return (
    <div role="status" data-testid="infra-region-notice" className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
      <AlertTriangle size={20} aria-hidden="true" className="hidden shrink-0 text-amber-700 sm:block" />
      <p className="m-0 min-w-0 flex-1 text-ui text-amber-900">
        <b className="font-semibold">{notice.lead}</b>
        {notice.body && <> {notice.body}</>}
      </p>
      {notice.link && <Link href={OVERVIEW_COPY.regionsHref} className="text-ui font-semibold text-amber-800 hover:underline">{OVERVIEW_COPY.regionsLink}</Link>}
    </div>
  )
}
