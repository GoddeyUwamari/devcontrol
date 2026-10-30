'use client'

import { useState } from 'react'
import type { AlarmRowView, AlarmsListView } from './alarmsListModel'
import { ALARMS_COPY, ALARMS_SHOWN, PAGE_COPY } from './operationalHealthCopy'
import { BUTTON, LINK } from './tones'

const SKELETON_ROWS = 3

const Dash = ({ label = PAGE_COPY.notAvailable }: { label?: string }) => (
  <>
    <span aria-hidden="true">{PAGE_COPY.unavailable}</span>
    <span className="sr-only">{label}</span>
  </>
)

function Row({ row }: { row: AlarmRowView }) {
  return (
    <tr data-testid="alarm-row" className="border-t border-slate-200 align-top">
      <th scope="row" className="px-4 py-3 text-left font-normal sm:px-6">
        {row.name === null ? (
          <span className="block text-ui font-semibold text-ink"><Dash label={ALARMS_COPY.nameMissing} /></span>
        ) : row.href ? (
          <a href={row.href} target="_blank" rel="noopener noreferrer" aria-label={ALARMS_COPY.openAlarm(row.name)} className="break-all text-ui font-semibold text-ink-accent hover:underline">
            {row.name} <span aria-hidden="true">↗</span>
          </a>
        ) : (
          <span className="block break-all text-ui font-semibold text-ink">{row.name}</span>
        )}
      </th>
      <td data-testid="alarm-metric" className="px-3 py-3 text-body text-ink-body">
        {row.metric.composite ? (
          <>
            <Dash />
            <span className="block text-meta text-ink-muted">{ALARMS_COPY.composite}</span>
          </>
        ) : (
          <>
            <span className="block break-all">{row.metric.text ?? <Dash />}</span>
            {row.metric.namespace && <span className="block break-all text-meta text-ink-muted">{row.metric.namespace}</span>}
          </>
        )}
      </td>
      <td className="break-all px-3 py-3 text-body text-ink-body">{row.resource ?? <Dash />}</td>
      <td className="px-4 py-3 text-right text-body text-ink-body sm:px-6">
        {row.since ? (
          <time dateTime={row.since.iso}>
            <span className="block whitespace-nowrap">{row.since.relative}</span>
            <span className="block whitespace-nowrap text-meta text-ink-muted">{row.since.local}</span>
          </time>
        ) : (
          <Dash />
        )}
      </td>
    </tr>
  )
}

function Table({ children, busy }: { children: React.ReactNode; busy?: boolean }) {
  return (
    // Scrolls inside its own box on narrow screens; the page itself never scrolls sideways.
    <div data-testid="alarms-table-scroll" className="overflow-x-auto">
      <table aria-busy={busy || undefined} className="w-full min-w-[560px] border-collapse">
        <caption className="sr-only">{ALARMS_COPY.tableCaption}</caption>
        <thead>
          <tr className="bg-slate-50 text-left text-label uppercase tracking-[0.04em] text-ink-muted">
            <th scope="col" className="px-4 py-2.5 font-semibold sm:px-6">{ALARMS_COPY.columns.alarm}</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">{ALARMS_COPY.columns.metric}</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">{ALARMS_COPY.columns.resource}</th>
            <th scope="col" className="px-4 py-2.5 text-right font-semibold sm:px-6">{ALARMS_COPY.columns.since}</th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

/**
 * Active alarms (O3a), between the tiles and the By-type cards. It renders the
 * alarms answer the tiles use and fetches nothing itself: Retry is the page's
 * alarms-only retry, so the tile, banner and this list always show one answer.
 * The newest 25 show first; "Show all N" reveals the rest (decision D8).
 */
export function ActiveAlarms({ view, onRetry }: { view: AlarmsListView; onRetry: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const rows = view.state === 'rows' ? view.rows : []
  const shown = expanded ? rows : rows.slice(0, ALARMS_SHOWN)

  return (
    <section aria-labelledby="active-alarms" data-testid="active-alarms" className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-col gap-2 px-4 pt-4 sm:px-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="active-alarms" className="m-0 text-card-title text-ink">{ALARMS_COPY.title}</h2>
          {view.sectionHref ? (
            <a href={view.sectionHref} target="_blank" rel="noopener noreferrer" className={LINK}>{ALARMS_COPY.viewAll}</a>
          ) : (
            <span className="text-meta text-ink-muted">{ALARMS_COPY.caption}</span>
          )}
        </div>
        {view.state === 'rows' && view.partial && (
          <p data-testid="alarms-partial" className="m-0 text-meta text-ink-body">{view.partial}</p>
        )}
      </div>

      <div className="mt-3">
        {view.state === 'loading' && (
          <Table busy>
            {Array.from({ length: SKELETON_ROWS }, (_, i) => (
              <tr key={i} data-testid="alarm-skeleton-row" className="border-t border-slate-200">
                <td colSpan={4} className="px-4 py-4 sm:px-6">
                  {i === 0 && <span className="sr-only">{ALARMS_COPY.loading}</span>}
                  <span aria-hidden="true" className="block h-3 w-2/3 animate-pulse rounded bg-slate-200" />
                </td>
              </tr>
            ))}
          </Table>
        )}

        {view.state === 'rows' && (
          <>
            <Table>{shown.map((row) => <Row key={row.key} row={row} />)}</Table>
            {!expanded && rows.length > ALARMS_SHOWN && (
              <div className="border-t border-slate-200 px-4 py-3 sm:px-6">
                <button type="button" onClick={() => setExpanded(true)} className={BUTTON}>{ALARMS_COPY.showAll(rows.length)}</button>
              </div>
            )}
          </>
        )}

        {view.state === 'error' && (
          <div data-testid="alarms-error" className="flex flex-col items-start gap-2 border-t border-slate-200 px-4 py-4 sm:px-6">
            <p className="m-0 text-body text-ink">{ALARMS_COPY.error}</p>
            {view.detail && <p className="m-0 text-meta text-ink-body">{view.detail}</p>}
            <button type="button" onClick={onRetry} className={BUTTON}>{PAGE_COPY.retry}</button>
          </div>
        )}

        {view.state === 'notice' && (
          <div data-testid="alarms-notice" className="flex flex-col items-start gap-2 border-t border-slate-200 px-4 py-4 sm:px-6">
            <p className="m-0 text-body text-ink-body">{view.text}</p>
            {view.retry && <button type="button" onClick={onRetry} className={BUTTON}>{PAGE_COPY.retry}</button>}
          </div>
        )}

        {view.state === 'empty' && (
          <p data-testid="alarms-empty" className="m-0 border-t border-slate-200 px-4 py-4 text-body text-ink-body sm:px-6">{ALARMS_COPY.none}</p>
        )}

        {view.state === 'incomplete_empty' && (
          <p data-testid="alarms-incomplete" className="m-0 border-t border-slate-200 px-4 py-4 text-body text-ink-body sm:px-6">{ALARMS_COPY.incompleteEmpty}</p>
        )}
      </div>
    </section>
  )
}
