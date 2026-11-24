'use client'

import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { RichText } from '../../services/ScanTime'
import type { CheckedView, ChipTone } from './overviewModel'

const CHIP: Record<ChipTone, string> = {
  warn: 'border-amber-200 bg-amber-50 text-amber-800',
  ok: 'border-green-200 bg-green-50 text-green-800',
  muted: 'border-dashed border-slate-400 bg-slate-50 text-slate-700',
}

/**
 * What each scan checks, and what it doesn't (§3.7, §17.1, §18.1 Q-R2), as rows: name, one muted detail
 * line (hidden on a phone, board 2), status chip. The chips say what the detail lines say; the scan's
 * warnings follow in amber.
 */
export function WhatWeChecked({ view, now }: { view: CheckedView; now: number }) {
  return (
    <section aria-labelledby="infra-checked-heading" className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:p-6 lg:col-span-2">
      <div className="flex flex-col gap-1">
        <h2 id="infra-checked-heading" className="m-0 text-section text-slate-900">What we checked</h2>
        {view.from && <p className="m-0 hidden text-meta text-slate-600 sm:block"><RichText parts={view.from} now={now} /></p>}
      </div>
      {view.error ? (
        <p className="m-0 text-ui text-slate-700">{view.error}</p>
      ) : view.rows.length === 0 ? (
        <p role="status" className="m-0 text-ui text-slate-600">Loading…</p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {view.rows.map((row) => (
            <li key={row.key} data-testid={`infra-checked-${row.key}`} className="flex items-start justify-between gap-4 border-t border-slate-100 py-3">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-ui font-semibold text-slate-900">{row.name}</span>
                {(row.detail || row.link) && (
                  <span className="hidden break-words text-meta text-slate-600 sm:block">
                    {row.detail && <RichText parts={row.detail} now={now} />}
                    {row.link && <>{row.detail ? ' · ' : ''}<Link href={row.link.href} className="font-semibold text-violet-700 hover:underline">{row.link.text}</Link></>}
                  </span>
                )}
                {row.extra && <span data-testid={`infra-checked-${row.key}-extra`} className="text-meta text-slate-600">{row.extra}</span>}
              </div>
              <span data-chip={row.chip.tone} className={`shrink-0 self-center whitespace-nowrap rounded-full border px-3 py-1 text-label font-semibold ${CHIP[row.chip.tone]}`}>{row.chip.text}</span>
            </li>
          ))}
        </ul>
      )}
      {view.warnings.map((w) => (
        <p key={w.key} data-testid={`infra-checked-${w.key}`} className="m-0 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-meta text-amber-900">
          <AlertTriangle size={16} aria-hidden="true" className="mt-1 shrink-0 text-amber-700" />
          <span>{w.text}</span>
        </p>
      ))}
    </section>
  )
}
