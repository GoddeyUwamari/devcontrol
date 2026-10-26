'use client'

import { RichText } from '../../services/ScanTime'
import type { StatusLineView } from './overviewModel'

/** One headline, the top item, what wasn't checked, and the scan notes (§6.2). */
export function StatusLine({ status, now }: { status: StatusLineView; now: number }) {
  return (
    <section aria-labelledby="infra-status-heading" className="flex flex-col gap-1">
      <h2 id="infra-status-heading" className="m-0 text-section text-slate-900">{status.headline}</h2>
      {/* Wraps on a phone (no hover there to read a cut-off line); one line from sm up, full text in the title. */}
      {status.reason && <p data-testid="infra-status-reason" className="m-0 break-words text-body text-slate-700 sm:truncate" title={status.reason}>{status.reason}</p>}
      {status.notChecked && <p className="m-0 text-body text-slate-600">{status.notChecked}</p>}
      {status.notes.map((parts, i) => (
        <p key={i} className="m-0 text-meta text-slate-600"><RichText parts={parts} now={now} /></p>
      ))}
    </section>
  )
}
