'use client'

import Link from 'next/link'
import { RefreshCw } from 'lucide-react'
import { RichText } from '../../services/ScanTime'
import { OVERVIEW_COPY, type OverviewView } from './overviewModel'

/** The account <dl>: connection, home region, enabled regions, regions checked. */
export function AccountStrip({ account, now, coverageError, onRetry }: {
  account: OverviewView['account']
  now: number
  coverageError: boolean
  onRetry: () => void
}) {
  return (
    <section aria-labelledby="infra-account-heading" className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
      <h2 id="infra-account-heading" className="sr-only">AWS account</h2>
      {coverageError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3">
          <p className="m-0 text-ui font-semibold text-slate-900">Coverage couldn&apos;t be loaded</p>
          <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1 text-label text-slate-700">
            <RefreshCw size={12} aria-hidden="true" /> Retry
          </button>
        </div>
      ) : !account ? (
        <p role="status" className="m-0 text-ui text-slate-600">Loading…</p>
      ) : (
        <div className="flex flex-col gap-3">
          <dl className="m-0 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {account.items.map(({ term, value }) => (
              <div key={term} className="min-w-0">
                <dt className="text-label uppercase tracking-[0.04em] text-slate-600">{term}</dt>
                <dd className="m-0 break-words text-ui text-slate-900">{value}</dd>
              </div>
            ))}
          </dl>
          {(account.regionsLink || account.listNote) && (
            <p className="m-0 flex flex-wrap gap-x-3 text-meta text-slate-600">
              {account.listNote && <span><RichText parts={account.listNote} now={now} /></span>}
              {account.regionsLink && <Link href={OVERVIEW_COPY.regionsHref} className="font-semibold text-violet-700 hover:underline">View regions →</Link>}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
