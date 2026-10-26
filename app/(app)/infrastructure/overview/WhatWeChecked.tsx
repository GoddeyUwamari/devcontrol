'use client'

import Link from 'next/link'
import { RichText } from '../../services/ScanTime'
import type { Line } from './overviewModel'

/** What each scan checks, and what it doesn't (§3.7, §17.1, §18.1 Q-R2). */
export function WhatWeChecked({ lines, now }: { lines: Line[]; now: number }) {
  return (
    <section aria-labelledby="infra-checked-heading" className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
      <h2 id="infra-checked-heading" className="m-0 mb-3 text-section text-slate-900">What we checked</h2>
      {lines.length === 0 ? (
        <p role="status" className="m-0 text-ui text-slate-600">Loading…</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0 text-ui">
          {lines.map((line) => (
            <li key={line.key} data-testid={`infra-checked-${line.key}`} className={line.tone === 'warn' ? 'text-amber-800' : 'text-slate-700'}>
              <RichText parts={line.parts} now={now} />
              {line.link && <> <Link href={line.link.href} className="font-semibold text-violet-700 hover:underline">{line.link.text}</Link></>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
