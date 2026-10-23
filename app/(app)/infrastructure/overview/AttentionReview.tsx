'use client'

import { Fragment, useState } from 'react'
import Link from 'next/link'
import { RefreshCw } from 'lucide-react'
import { SeverityBadge } from '@/components/ui/severity-badge'
import { RichText } from '../../services/ScanTime'
import { OVERVIEW_COPY, type AttentionRow, type AttentionView } from './overviewModel'

/**
 * The Review expansion: display only. It makes no request, mutation or
 * navigation; links inside it are plain navigation to existing pages.
 */
function ReviewDetail({ row, now }: { row: AttentionRow; now: number }) {
  return (
    <dl className="m-0 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
      <div>
        <dt className="text-xs font-semibold uppercase tracking-wide text-slate-600">What we found</dt>
        <dd className="m-0 break-words text-slate-900">
          {row.found}
          {row.foundAt && <span className="block text-xs text-slate-600"><RichText parts={['Found on the scan that finished ', { iso: row.foundAt }]} now={now} /></span>}
        </dd>
      </div>
      {row.nextStep && (
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-600">Next step</dt>
          <dd className="m-0 break-words text-slate-900">
            {'text' in row.nextStep ? row.nextStep.text : <Link href={row.nextStep.href} className="font-semibold text-violet-700 hover:underline">{row.nextStep.link}</Link>}
          </dd>
        </div>
      )}
      <div>
        <dt className="text-xs font-semibold uppercase tracking-wide text-slate-600">Before you change anything</dt>
        <dd className="m-0 text-slate-900">{OVERVIEW_COPY.beforeYouChange}</dd>
      </div>
    </dl>
  )
}

function ReviewButton({ row, open, controls, onToggle, full = false }: { row: AttentionRow; open: boolean; controls: string; onToggle: () => void; full?: boolean }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={open ? controls : undefined}
      aria-label={`Review ${row.resource}`}
      className={`${full ? 'w-full justify-center' : ''} inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:border-slate-300`}
    >
      {open ? 'Hide' : 'Review'}
    </button>
  )
}

/** What needs attention: a table from sm up, a list on a phone (§10). */
export function AttentionReview({ view, now, onRetry }: { view: AttentionView; now: number; onRetry: () => void }) {
  const [open, setOpen] = useState<string | null>(null)
  const toggle = (key: string) => setOpen((o) => (o === key ? null : key))

  let body: React.ReactNode
  if (view.status === 'loading') {
    body = <p role="status" className="m-0 px-4 py-6 text-sm text-slate-600">Loading…</p>
  } else if (view.status === 'error') {
    body = (
      <div role="alert" className="flex flex-col items-center gap-2 px-4 py-8 text-center">
        <p className="m-0 text-sm font-semibold text-slate-900">{OVERVIEW_COPY.attentionError}</p>
        <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">
          <RefreshCw size={12} aria-hidden="true" /> Retry
        </button>
      </div>
    )
  } else if (view.rows.length === 0) {
    body = (
      <div className="flex flex-col gap-1 px-4 py-8 text-center">
        <p className="m-0 text-sm font-semibold text-slate-900">{OVERVIEW_COPY.attentionEmpty}</p>
        {view.empty && <p className="m-0 text-xs text-slate-600">{view.empty.scope}</p>}
      </div>
    )
  } else {
    body = (
      <>
        <table className="hidden w-full text-sm sm:table">
          <caption className="sr-only">{OVERVIEW_COPY.attentionTitle}</caption>
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">
              <th scope="col" className="px-4 py-2">Severity</th>
              <th scope="col" className="px-3 py-2">Issue</th>
              <th scope="col" className="px-3 py-2">Resource</th>
              <th scope="col" className="px-3 py-2">Region</th>
              <th scope="col" className="px-4 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row) => {
              const id = `${row.key}-detail`
              const isOpen = open === row.key
              return (
                <Fragment key={row.key}>
                  <tr className="border-b border-slate-100 align-middle">
                    <td className="whitespace-nowrap px-4 py-3"><SeverityBadge severity={row.severity.severity} label={row.severity.label} /></td>
                    <th scope="row" className="px-3 py-3 text-left font-normal text-slate-900">{row.issue}</th>
                    <td className="px-3 py-3">
                      <span className="font-medium text-slate-900">{row.resource}</span>{' '}
                      <span className="text-xs text-slate-600">{row.resourceKind}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-slate-700">{row.region}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <ReviewButton row={row} open={isOpen} controls={id} onToggle={() => toggle(row.key)} />
                    </td>
                  </tr>
                  {isOpen && (
                    <tr id={id} className="border-b border-slate-100 bg-slate-50">
                      <td colSpan={5} className="px-4 py-4"><ReviewDetail row={row} now={now} /></td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
        <ul className="m-0 flex list-none flex-col p-0 sm:hidden">
          {view.rows.map((row) => {
            const id = `${row.key}-detail-list`
            const isOpen = open === row.key
            return (
              <li key={row.key} className="flex flex-col gap-2 border-b border-slate-100 px-4 py-3">
                <SeverityBadge severity={row.severity.severity} label={row.severity.label} className="w-fit" />
                <p className="m-0 text-sm text-slate-900">{row.issue}</p>
                <p className="m-0 break-words text-xs text-slate-600">{row.resource} · {row.resourceKind} · {row.region}</p>
                <ReviewButton row={row} open={isOpen} controls={id} onToggle={() => toggle(row.key)} full />
                {isOpen && <div id={id}><ReviewDetail row={row} now={now} /></div>}
              </li>
            )
          })}
        </ul>
      </>
    )
  }

  const ready = view.status === 'ready' ? view : null
  return (
    <section aria-labelledby="infra-attention-heading" className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-col gap-1 border-b border-slate-100 px-4 py-3">
        <h2 id="infra-attention-heading" className="m-0 text-base font-bold text-slate-900">{OVERVIEW_COPY.attentionTitle}</h2>
        <p className="m-0 text-sm text-slate-600">
          {OVERVIEW_COPY.attentionDescription}
          {ready && ` ${ready.resourceTotal} ${ready.resourceTotal === 1 ? 'resource' : 'resources'}${ready.accountTotal !== null ? ` · ${ready.accountTotal} account-level ${ready.accountTotal === 1 ? 'finding' : 'findings'}` : ''}.`}
        </p>
        {ready?.accountError && <p role="alert" className="m-0 text-xs text-slate-700">{OVERVIEW_COPY.accountFindingsError}</p>}
        {ready?.firstHundred && <p className="m-0 text-xs text-slate-600">{OVERVIEW_COPY.firstHundred}</p>}
      </div>
      {body}
      {ready && (ready.viewAll !== null || ready.securityLink) && (
        <div className="flex flex-wrap gap-4 border-t border-slate-100 px-4 py-3 text-sm">
          {ready.viewAll !== null && <Link href="/services" className="font-semibold text-violet-700 hover:underline">View all {ready.viewAll} in Services &amp; Ownership →</Link>}
          {ready.securityLink && <Link href="/security" className="font-semibold text-violet-700 hover:underline">Security findings →</Link>}
        </div>
      )}
    </section>
  )
}
