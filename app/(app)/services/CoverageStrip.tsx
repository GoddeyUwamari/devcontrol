'use client'

import { useState } from 'react'
import { AlertTriangle, Info, RefreshCw } from 'lucide-react'
import type { ServicesCoverage } from '@/lib/services/aws-services.service'
import { describeCoverage, warningNotes, type CoverageChip, type CoverageNote } from './coverage'

export type CoverageState =
  | { status: 'loading' }
  | { status: 'error'; retry?: () => void }
  | { status: 'ready'; coverage: ServicesCoverage }

const CHIP_CLASS: Record<CoverageChip['state'], { chip: string; dot: string }> = {
  complete: { chip: 'border-slate-200 bg-white', dot: 'bg-green-700' },
  partial:  { chip: 'border-amber-300 bg-amber-50', dot: 'bg-amber-700' },
  failed:   { chip: 'border-red-300 bg-red-50 text-red-900', dot: 'bg-red-700' },
  scanning: { chip: 'border-blue-300 bg-blue-50', dot: 'bg-blue-700' },
  global:   { chip: 'border-slate-200 bg-white', dot: 'bg-slate-500' },
  off:      { chip: 'border-dashed border-slate-300 bg-slate-50', dot: 'border-[1.5px] border-slate-500 bg-transparent' },
}

function Note({ note }: { note: CoverageNote }) {
  const warn = note.tone === 'warn'
  return (
    <div role="note" className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${warn ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-blue-200 bg-blue-50 text-blue-950'}`}>
      {warn ? <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" /> : <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />}
      <span>{note.title && <strong>{note.title} </strong>}{note.body}</span>
    </div>
  )
}

/**
 * Account and scan coverage (stage M6), with today's resource status line
 * (E5) as its second line and the discovery warnings (E4) as notes. Legend:
 * only the states possible at M6 (Q8).
 */
export const STORED_RESOURCES_NOTE = '· showing resources from a previous connection'

export function CoverageStrip({ state, statusHeadline, inTabWarnings, storedResources = false, now: nowProp }: {
  state: CoverageState
  /** /stats counts stored resources (total > 0). With no account connected they are from a previous connection. */
  storedResources?: boolean
  /** The page's "Resource status" headline, same states and words as before. */
  statusHeadline: string
  inTabWarnings: readonly string[]
  now?: number
}) {
  // "N min ago" is read against the time the strip mounted.
  const [mountedAt] = useState(() => Date.now())
  const now = nowProp ?? mountedAt
  const view = state.status === 'ready' ? describeCoverage(state.coverage, now, inTabWarnings) : null
  const notes = view ? view.notes : warningNotes([], inTabWarnings)

  return (
    <section aria-label="Account and scan coverage" className="bg-white rounded-xl border border-slate-200 p-4 mb-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {state.status === 'loading' && <span role="status" className="text-slate-600">Loading scan coverage…</span>}
        {state.status === 'error' && (
          <span role="alert" className="flex flex-wrap items-center gap-2 text-slate-700">
            Scan coverage could not be loaded.
            {state.retry && (
              <button type="button" onClick={state.retry} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:border-slate-300">
                <RefreshCw size={12} aria-hidden="true" /> Try again
              </button>
            )}
          </span>
        )}
        {view && !view.connected && (
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-900">No AWS account connected</span>
            {/* A real space, so the sentence reads as one (the flex gap is visual only). */}
            {storedResources && <>{' '}<span className="text-slate-700">{STORED_RESOURCES_NOTE}</span></>}
            <a href="/connect-aws" className="text-violet-700 underline-offset-2 hover:underline">Connect AWS account</a>
          </span>
        )}
        {view?.connected && (
          <>
            <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900">
              <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-green-700" />AWS account connected
            </span>
            <span><strong className="text-slate-900">{view.headline}</strong> <span className="text-slate-600">{view.headlineSub}</span></span>
            <span className={view.lastScanFailed ? 'font-semibold text-red-700' : 'text-slate-600'}>{view.lastScan}</span>
          </>
        )}
      </div>

      <p className="m-0 text-sm text-slate-700">
        <span className="font-semibold">Resource status:</span> {statusHeadline}
      </p>

      {view?.connected && (
        <>
          <ul aria-label="Scanned regions" className="m-0 flex list-none flex-wrap gap-2 p-0">
            {view.chips.map((chip) => (
              <li key={chip.key} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${CHIP_CLASS[chip.state].chip}`}>
                <span aria-hidden="true" className={`inline-block h-2 w-2 rounded-full ${CHIP_CLASS[chip.state].dot}`} />
                <span className="font-mono text-slate-900">{chip.region}</span>
                <span className={chip.state === 'failed' ? 'font-semibold text-red-800' : 'text-slate-600'}>{chip.note}</span>
              </li>
            ))}
          </ul>
          <div aria-label="Region states" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
            <span><strong className="text-slate-900">Complete</strong>: the last scan finished with no warning</span>
            <span><strong className="text-slate-900">Partial</strong>: the last scan finished with a warning, shown below</span>
            <span><strong className="text-slate-900">Last scan failed</strong>: some counts may be from an earlier scan</span>
            <span><strong className="text-slate-900">Scan in progress</strong>: counts may change when it finishes</span>
            <span><strong className="text-slate-900">Not scanned</strong>: not scanned yet</span>
          </div>
        </>
      )}

      {notes.map((note) => <Note key={note.key} note={note} />)}
    </section>
  )
}
