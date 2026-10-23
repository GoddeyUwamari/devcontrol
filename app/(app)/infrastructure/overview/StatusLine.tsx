'use client'

import { RichText } from '../../services/ScanTime'
import type { StatusLineView } from './overviewModel'

/** One headline, the top item, what wasn't checked, and the scan notes (§6.2). */
export function StatusLine({ status, now }: { status: StatusLineView; now: number }) {
  return (
    <section aria-labelledby="infra-status-heading" className="flex flex-col gap-1">
      <h2 id="infra-status-heading" className="m-0 text-base font-bold text-slate-900">{status.headline}</h2>
      {status.reason && <p className="m-0 truncate text-sm text-slate-700" title={status.reason}>{status.reason}</p>}
      {status.notChecked && <p className="m-0 text-sm text-slate-600">{status.notChecked}</p>}
      {status.notes.map((parts, i) => (
        <p key={i} className="m-0 text-xs text-slate-600"><RichText parts={parts} now={now} /></p>
      ))}
    </section>
  )
}
