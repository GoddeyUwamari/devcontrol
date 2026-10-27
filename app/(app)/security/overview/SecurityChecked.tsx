'use client'

import Link from 'next/link'
import { cn } from '@/lib/utils'
import { isServicesCoverageM6Enabled } from '../../services/servicesCoverageM6Flag'
import { isServicesV2Enabled } from '../../services/servicesV2Flag'
import { OVERVIEW_COPY } from '../../infrastructure/overview/overviewModel'
import type { CheckedLine } from './securityModel'
import { PAGE_COPY } from './securityCopy'
import { RegionText } from './RegionText'

/** What the score and findings rest on, and what they don't (plan §4). */
export function SecurityChecked({ lines }: { lines: CheckedLine[] }) {
  // The region page exists only with the Services redesign and its coverage panel (the Infrastructure Overview's rule).
  const regionsLink = isServicesV2Enabled() && isServicesCoverageM6Enabled()
  return (
    <section aria-labelledby="security-checked-heading" aria-busy={lines.length === 0 || undefined} className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
      <h2 id="security-checked-heading" className="m-0 text-section text-ink">{PAGE_COPY.checkedHeading}</h2>
      {lines.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-2 p-0 text-ui">
          {lines.map((line) => (
            <li key={line.key} data-testid={`security-checked-${line.key}`} className="flex flex-wrap justify-between gap-x-3 text-ink-body">
              <span><RegionText text={line.label} /></span>
              {line.status && (
                <span className={cn('font-semibold', line.status === 'checked' ? 'text-ink-success' : 'text-ink-muted')}>
                  {line.status === 'checked' ? PAGE_COPY.checked : PAGE_COPY.notChecked}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {regionsLink && (
        <Link href={OVERVIEW_COPY.regionsHref} className="inline-flex min-h-11 w-fit items-center text-ui font-semibold text-ink-accent hover:underline">{PAGE_COPY.regionCoverage}</Link>
      )}
    </section>
  )
}
