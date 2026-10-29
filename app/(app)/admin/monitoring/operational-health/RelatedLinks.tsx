'use client'

import Link from 'next/link'
import { PAGE_COPY, PAGE_HREF } from './operationalHealthCopy'
import { LINK } from './tones'

/** SLO report, Audit logs, Costs (decision D10) and DevControl's own status page. */
export function RelatedLinks() {
  return (
    <nav aria-label="Related" className="flex flex-wrap gap-x-6 gap-y-1">
      <Link href={PAGE_HREF.sloReport} className={LINK}>{PAGE_COPY.sloReport}</Link>
      <Link href={PAGE_HREF.auditLogs} className={LINK}>{PAGE_COPY.auditLogs}</Link>
      <Link href={PAGE_HREF.costs} className={LINK}>{PAGE_COPY.costs}</Link>
      <a href={PAGE_HREF.serviceStatus} target="_blank" rel="noopener noreferrer" className={LINK}>{PAGE_COPY.serviceStatus}</a>
    </nav>
  )
}
