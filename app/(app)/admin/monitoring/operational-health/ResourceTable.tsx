'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { TableQuery } from './observabilityTypes'
import type { RowView, TableView } from './resourceTableModel'
import { PAGE_COPY, TABLE_COPY, TABLE_HREF } from './operationalHealthCopy'
import { BUTTON, DOT, LINK } from './tones'

/** Typing settles for this long before the search is sent. */
export const SEARCH_DEBOUNCE_MS = 300

const SKELETON_ROWS = 5

const Dash = () => (
  <>
    <span aria-hidden="true">{PAGE_COPY.unavailable}</span>
    <span className="sr-only">{PAGE_COPY.notAvailable}</span>
  </>
)

function Row({ row }: { row: RowView }) {
  return (
    <tr data-testid="resource-row" className="border-t border-slate-200 align-top">
      <th scope="row" className="px-4 py-3 text-left font-normal sm:px-6">
        <span className="block text-ui font-semibold text-ink">{row.name}</span>
        {row.id && <span className="block break-all font-mono text-meta text-ink-body">{row.id}</span>}
      </th>
      <td className="px-3 py-3 text-body text-ink-body">{row.type}</td>
      <td className="px-3 py-3" data-testid="row-status" data-tone={row.status.tone}>
        <span className="flex items-center gap-2 text-ui font-semibold text-ink">
          <span aria-hidden="true" className={cn('inline-block size-2 shrink-0 rounded-full', DOT[row.status.tone])} />
          {row.status.label}
        </span>
        {row.status.reason && <span className="block text-meta text-ink-body">{row.status.reason}</span>}
      </td>
      <td className="px-3 py-3 text-body text-ink-body">{row.metric ?? <Dash />}</td>
      <td className="px-4 py-3 text-right text-body text-ink-body sm:px-6">
        {row.lastSeen ? (
          <time dateTime={row.lastSeen.iso} title={row.lastSeen.title}>
            <span className="sr-only">{row.lastSeen.title}: </span>
            <span className="block whitespace-nowrap">{row.lastSeen.relative}</span>
            <span className="block whitespace-nowrap text-meta text-ink-muted">{row.lastSeen.local}</span>
          </time>
        ) : (
          <Dash />
        )}
      </td>
    </tr>
  )
}

function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (page: number) => void }) {
  return (
    <nav aria-label={TABLE_COPY.pages} className="flex gap-2">
      <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} className={BUTTON}>{TABLE_COPY.previous}</button>
      <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)} className={BUTTON}>{TABLE_COPY.next}</button>
    </nav>
  )
}

function Table({ children, busy }: { children: React.ReactNode; busy?: boolean }) {
  return (
    // Scrolls inside its own box on narrow screens; the page itself never scrolls sideways.
    <div data-testid="resource-table-scroll" className="overflow-x-auto">
      <table aria-busy={busy || undefined} className="w-full min-w-[640px] border-collapse">
        <caption className="sr-only">{TABLE_COPY.tableCaption}</caption>
        <thead>
          <tr className="bg-slate-50 text-left text-label uppercase tracking-[0.04em] text-ink-muted">
            <th scope="col" className="px-4 py-2.5 font-semibold sm:px-6">{TABLE_COPY.columns.resource}</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">{TABLE_COPY.columns.type}</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">{TABLE_COPY.columns.status}</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">{TABLE_COPY.columns.metric}</th>
            <th scope="col" className="px-4 py-2.5 text-right font-semibold sm:px-6">{TABLE_COPY.columns.lastSeen}</th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

/**
 * The Resource checks table (O2), below the By-type cards. Search, filters and
 * paging go to the server (the hook's table query); this keeps only the text
 * being typed. Any answer that isn't a table for the query asked is "Couldn't
 * load resource checks." + Retry, never an empty table.
 */
export function ResourceTable({
  view,
  query,
  onQuery,
  onRetry,
}: {
  view: TableView
  query: TableQuery
  onQuery: (next: Partial<TableQuery>) => void
  onRetry: () => void
}) {
  const [text, setText] = useState(query.q)
  // While a new search, filter or page loads, the controls stay (the model passes the last
  // answer's counts), so typing never unmounts the input.
  const filters = view.state === 'ok' || view.state === 'loading' ? view.filters : null

  useEffect(() => {
    if (text.trim() === query.q) return
    const timer = setTimeout(() => onQuery({ q: text.trim(), page: 1 }), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [text, query.q, onQuery])

  const clearSearch = () => {
    setText('')
    onQuery({ q: '', page: 1 })
  }

  return (
    <section aria-labelledby="resource-checks" data-testid="resource-table" className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-col gap-3 px-4 pt-4 sm:px-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="resource-checks" className="m-0 text-card-title text-ink">{TABLE_COPY.title}</h2>
          <span className="text-meta text-ink-muted">{TABLE_COPY.caption}</span>
        </div>
        {filters && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 focus-within:ring-2 focus-within:ring-violet-600">
              <span className="sr-only">{TABLE_COPY.search}</span>
              <input
                type="search"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={TABLE_COPY.search}
                maxLength={100}
                className="w-44 border-0 bg-transparent text-ui text-ink outline-none"
              />
            </label>
            <div role="group" aria-label={TABLE_COPY.filterGroup} className="flex flex-wrap gap-1.5">
              {filters.map((f) => (
                <button
                  key={f.filter}
                  type="button"
                  aria-pressed={f.pressed}
                  aria-label={`${f.label}, ${f.count.toLocaleString()}`}
                  onClick={() => onQuery({ filter: f.filter, page: 1 })}
                  className={cn(BUTTON, f.pressed && 'border-violet-600 bg-violet-50 text-violet-900')}
                >
                  {f.label} <span className="tabular-nums">{f.count.toLocaleString()}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {view.state === 'ok' && view.captions.map((c) => (
          <p key={c} data-testid="table-caption" className="m-0 text-meta text-ink-body">{c}</p>
        ))}
      </div>

      <div className="mt-3">
        {view.state === 'loading' && (
          <Table busy>
            {Array.from({ length: SKELETON_ROWS }, (_, i) => (
              <tr key={i} data-testid="skeleton-row" className="border-t border-slate-200">
                <td colSpan={5} className="px-4 py-4 sm:px-6">
                  {i === 0 && <span className="sr-only">{TABLE_COPY.loading}</span>}
                  <span aria-hidden="true" className="block h-3 w-2/3 animate-pulse rounded bg-slate-200" />
                </td>
              </tr>
            ))}
          </Table>
        )}

        {view.state === 'error' && (
          <div data-testid="table-error" className="flex flex-col items-start gap-2 border-t border-slate-200 px-4 py-4 sm:px-6">
            <p className="m-0 text-body text-ink">{TABLE_COPY.error}</p>
            <button type="button" onClick={onRetry} className={BUTTON}>{PAGE_COPY.retry}</button>
          </div>
        )}

        {view.state === 'notice' && (
          <p data-testid="table-notice" className="m-0 border-t border-slate-200 px-4 py-4 text-body text-ink-body sm:px-6">{view.text}</p>
        )}

        {view.state === 'ok' && view.body.kind === 'empty_inventory' && (
          <p data-testid="table-empty" className="m-0 border-t border-slate-200 px-4 py-4 text-body text-ink-body sm:px-6">{view.body.text}</p>
        )}

        {view.state === 'ok' && view.body.kind === 'no_match' && (
          <div data-testid="table-no-match" className="flex flex-col items-start gap-2 border-t border-slate-200 px-4 py-4 sm:px-6">
            <p className="m-0 text-body text-ink-body">{view.body.text}</p>
            <div className="flex flex-wrap gap-2">
              {view.body.clearSearch && <button type="button" onClick={clearSearch} className={BUTTON}>{TABLE_COPY.clearSearch}</button>}
              {view.body.showAll && <button type="button" onClick={() => onQuery({ filter: 'all', page: 1 })} className={BUTTON}>{TABLE_COPY.showAll}</button>}
            </div>
          </div>
        )}

        {view.state === 'ok' && view.body.kind === 'rows' && (
          <>
            <Table>
              {view.body.rows.map((row) => (
                <Row key={row.key} row={row} />
              ))}
            </Table>
            <div className="flex flex-col gap-2 border-t border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <p data-testid="table-footer" aria-live="polite" className="m-0 text-meta text-ink-body">{view.body.footer}</p>
              <Pager page={view.body.page} pages={view.body.pages} onPage={(page) => onQuery({ page })} />
            </div>
          </>
        )}
      </div>

      <div className="border-t border-slate-200 px-4 py-3 sm:px-6">
        <Link href={TABLE_HREF.allServices} className={LINK}>{TABLE_COPY.allServices}</Link>
      </div>
    </section>
  )
}
