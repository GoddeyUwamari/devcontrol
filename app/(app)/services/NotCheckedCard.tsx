'use client'

import { useState } from 'react'
import type { AWSServicesStats, ServicesCoverage } from '@/lib/services/aws-services.service'
import { notCheckedLines } from './notChecked'

/**
 * What we didn't check (Phase 1, PR S1-D): the limits of what this page
 * covers, from coverage and /stats only. Not rendered when nothing applies.
 */
export function NotCheckedCard({ coverage, stats, inTabWarnings, leaseRule = false }: {
  coverage: ServicesCoverage
  stats: AWSServicesStats | undefined
  inTabWarnings: readonly string[]
  /** Multi-region M6: "did not finish" from the scan lease (notCheckedLines). */
  leaseRule?: boolean
}) {
  const [now] = useState(() => Date.now())
  const lines = notCheckedLines(coverage, stats, now, inTabWarnings, leaseRule)
  if (lines.length === 0) return null
  return (
    <section aria-labelledby="not-checked-heading" className="bg-white rounded-xl border border-slate-200 p-4 mb-6 flex flex-col gap-2.5">
      <h2 id="not-checked-heading" className="m-0 text-base font-bold text-slate-900">What we didn&apos;t check</h2>
      <p className="m-0 text-sm text-slate-600">So nothing on this page looks more complete than it is.</p>
      <ul className="m-0 flex flex-col gap-2 pl-5 text-sm text-slate-900 list-disc">
        {lines.map((line) => <li key={line.key} data-line={line.key}>{line.text}</li>)}
      </ul>
    </section>
  )
}
