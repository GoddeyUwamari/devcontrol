'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Num } from '@/components/ui/typography'
import { cn } from '@/lib/utils'
import {
  SCOPE_LABEL, SECURITY_COPY, SEVERITY_LABEL, STATUS_LABEL, filterRows, groupRows,
  type FilterKey, type FilterView, type FindingRow, type SecurityView,
} from './securityModel'
import { LIST_LIMIT, PAGE_COPY } from './securityCopy'
import { FindingPanel } from './FindingPanel'

const SEVERITY_INK: Record<string, string> = {
  critical: 'text-ink-danger',
  high: 'text-ink-warning',
  medium: 'text-ink-body',
  low: 'text-ink-muted',
}

const PRESSABLE = 'inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3 text-ui font-semibold'
const pressed = (on: boolean) => (on ? 'border-violet-700 bg-violet-50 text-ink-accent' : 'border-slate-300 bg-white text-ink hover:bg-slate-50')

/** "<Label> <count>"; a count that didn't load is "—", read as "not available" (founder answer 7). */
function FilterButton({ filter, on, onClick }: { filter: FilterView; on: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} data-testid={`security-filter-${filter.key}`} className={cn(PRESSABLE, pressed(on))}>
      {filter.label}{' '}
      {filter.count === null
        ? <><span aria-hidden="true">{PAGE_COPY.unavailable}</span><span className="sr-only">{PAGE_COPY.notAvailable}</span></>
        : <Num>{filter.count}</Num>}
    </button>
  )
}

const CELL = 'border-t border-slate-100 px-4 py-3 align-top'

/**
 * One row: severity, the issue (with its status chip and first-found date), where, scope, and "Review" / "Hide",
 * which shows or hides the row's details in a full-width row below it. aria-expanded follows the real state.
 */
function Row({ row }: { row: FindingRow }) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const status = STATUS_LABEL[row.status]
  const where = [row.where.name, row.where.kind, row.where.region].filter(Boolean).join(' · ')
  return (
    <>
      <tr data-testid="security-row" data-row-id={row.id}>
        <td className={cn(CELL, 'text-ui font-semibold', SEVERITY_INK[row.severity] ?? 'text-ink-body')}>{SEVERITY_LABEL[row.severity] ?? row.severity}</td>
        <td className={CELL}>
          <span className="flex min-w-0 flex-col items-start gap-0.5">
            <span className="text-ui text-ink">{row.title}</span>
            {status && <span data-testid="security-row-status" className="rounded-md bg-slate-100 px-2 py-0.5 text-label text-ink-body">{status}</span>}
            {row.firstFound && <span className="text-meta text-ink-muted">{row.firstFound}</span>}
          </span>
        </td>
        <td className={cn(CELL, 'text-meta text-ink-muted')}>{where}</td>
        <td className={cn(CELL, 'text-ui text-ink-body')}>{SCOPE_LABEL[row.scope]}</td>
        <td className={CELL}>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={open ? panelId : undefined}
            aria-label={open ? PAGE_COPY.hideDetails(row.title) : PAGE_COPY.showDetails(row.title)}
            onClick={() => setOpen(!open)}
            className={cn(PRESSABLE, pressed(false))}
          >
            {open ? PAGE_COPY.hide : PAGE_COPY.review}
          </button>
        </td>
      </tr>
      {open && (
        <tr id={panelId} data-testid="security-row-panel">
          <td colSpan={PAGE_COPY.tableHeaders.length} className="border-t border-slate-100 bg-slate-50 px-4 py-4">
            <FindingPanel row={row} actions={null} />
          </td>
        </tr>
      )}
    </>
  )
}

const HEADER = 'bg-slate-50 px-4 py-2 text-left text-label text-ink-muted'

/** The mock's header row (founder decision, §5 of the F2 decisions). */
function HeaderRow() {
  return (
    <tr>
      {PAGE_COPY.tableHeaders.map((name) => <th key={name} scope="col" className={HEADER}>{name}</th>)}
    </tr>
  )
}

/**
 * "Security findings", the Dashboard's /security#findings target. The section (and its id) is there while
 * the findings load, and the page scrolls to it once, after they settle, when the URL asks for it: the
 * redesign is loaded lazily, so the browser's own jump can run before the section exists.
 */
export function FindingsList({ view }: { view: SecurityView }) {
  const [filter, setFilter] = useState<FilterKey>('all')
  const [grouped, setGrouped] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const section = useRef<HTMLElement>(null)
  const scrolled = useRef(false)
  const settled = view.empty !== null

  useEffect(() => {
    if (!settled || scrolled.current) return
    scrolled.current = true
    if (window.location.hash === '#findings') section.current?.scrollIntoView()
  }, [settled])

  const rows = filterRows(view.rows, filter)
  const shown = grouped || showAll ? rows : rows.slice(0, LIST_LIMIT)
  const note = view.tiles.findings?.note ?? null

  return (
    <section
      id="findings"
      ref={section}
      aria-labelledby="security-findings-heading"
      aria-busy={!settled || undefined}
      className="flex min-w-0 flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-6"
    >
      <h2 id="security-findings-heading" className="m-0 text-section text-ink">{PAGE_COPY.findingsHeading}</h2>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {view.filters.map((f) => (
            <FilterButton key={f.key} filter={f} on={filter === f.key} onClick={() => { setFilter(f.key); setShowAll(false) }} />
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" aria-pressed={!grouped} onClick={() => setGrouped(false)} className={cn(PRESSABLE, pressed(!grouped))}>{PAGE_COPY.viewList}</button>
          <button type="button" aria-pressed={grouped} onClick={() => setGrouped(true)} className={cn(PRESSABLE, pressed(grouped))}>{PAGE_COPY.viewGroups}</button>
        </div>
      </div>

      {filter === 'accepted' && <p data-testid="security-accepted-caption" className="m-0 text-meta text-ink-muted">{SECURITY_COPY.acceptedCaption}</p>}
      {note && <p data-testid="security-findings-note" className="m-0 text-meta text-ink-muted">{note}</p>}

      {settled && rows.length === 0 && (
        <p data-testid="security-findings-empty" className="m-0 text-body text-ink-body">{view.empty![filter]}</p>
      )}

      {rows.length > 0 && (
        <div role="region" aria-labelledby="security-findings-heading" tabIndex={0} className="overflow-x-auto rounded-lg border border-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-600">
          <table className="w-full min-w-[640px] border-collapse">
            <thead><HeaderRow /></thead>
            {grouped
              ? groupRows(rows).map((g) => (
                  <tbody key={g.key} data-testid="security-group">
                    <tr>
                      <th scope="rowgroup" colSpan={PAGE_COPY.tableHeaders.length} className="border-t border-slate-200 bg-slate-50 px-4 py-2 text-left">
                        <h3 className="m-0 text-ui font-semibold text-ink">{g.label}</h3>
                      </th>
                    </tr>
                    {g.rows.map((row) => <Row key={row.id} row={row} />)}
                  </tbody>
                ))
              : <tbody>{shown.map((row) => <Row key={row.id} row={row} />)}</tbody>}
          </table>
        </div>
      )}

      {!grouped && rows.length > LIST_LIMIT && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="m-0 text-meta text-ink-muted">{PAGE_COPY.showing(shown.length, rows.length)}</p>
          <button type="button" onClick={() => setShowAll(!showAll)} className={cn(PRESSABLE, pressed(false))}>
            {showAll ? PAGE_COPY.showFewer : PAGE_COPY.showAll(rows.length)}
          </button>
        </div>
      )}
    </section>
  )
}
