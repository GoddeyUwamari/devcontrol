'use client'

import { Fragment, useEffect, useId, useRef, useState } from 'react'
import { Num } from '@/components/ui/typography'
import { SeverityBadge } from '@/components/ui/severity-badge'
import type { SeverityLevel } from '@/lib/utils/severity-colors'
import { cn } from '@/lib/utils'
import { HIDDEN } from '@/lib/security/findingDisplay'
import {
  SCOPE_LABEL, SECURITY_COPY, SEVERITY_LABEL, STATUS_LABEL, filterRows, groupRows,
  type FilterKey, type FilterView, type FindingRow, type SecurityView,
} from './securityModel'
import { LIST_LIMIT, PAGE_COPY } from './securityCopy'
import { FindingPanel } from './FindingPanel'
import { RegionText } from './RegionText'
import { FindingActions } from './FindingActions'

const SEVERITY_LEVELS: readonly string[] = ['critical', 'high', 'medium', 'low']
const severityLevel = (s: string): SeverityLevel => (SEVERITY_LEVELS.includes(s) ? (s as SeverityLevel) : 'info')

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
 * One row: the severity pill, the issue (with the web-server hint on open web ports, its status chip and first-found
 * date), where, scope, and "Review" / "Hide",
 * which shows or hides the row's details in a full-width row below it. aria-expanded follows the real state.
 */
function Row({ row, role, orgId, onDecided }: { row: FindingRow; role: string | null; orgId: string | null; onDecided: (rowId: string) => void }) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const status = STATUS_LABEL[row.status]
  // The type and region stay whole ("Security group", "us-east-1"); a long name may wrap anywhere.
  const where = ([[row.where.name, 'wrap-anywhere'], [row.where.kind, 'whitespace-nowrap'], [row.where.region, 'whitespace-nowrap']] as const)
    .filter(([part]) => part)
    .map(([part, wrap], i) => (
      <Fragment key={i}>{i > 0 && ' · '}<span data-testid="security-where-part" className={wrap}>{part}</span></Fragment>
    ))
  // The accessible name says which resource; a row with no name ("…" or empty) keeps the plain form.
  const resource = row.where.name && row.where.name !== HIDDEN ? row.where.name : undefined
  return (
    <>
      <tr data-testid="security-row" data-row-id={row.id}>
        <td className={CELL}>
          <SeverityBadge severity={severityLevel(row.severity)} label={SEVERITY_LABEL[row.severity] ?? row.severity} className="whitespace-nowrap" />
        </td>
        <td className={CELL}>
          <span className="flex min-w-0 flex-col items-start gap-0.5">
            <span className="text-ui text-ink"><RegionText text={row.title} /></span>
            {row.webHint && <span data-testid="security-row-web-hint" className="text-meta text-ink-muted">{row.webHint}</span>}
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
            aria-label={open ? PAGE_COPY.hideDetails(row.title, resource) : PAGE_COPY.showDetails(row.title, resource)}
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
            <FindingPanel row={row} actions={row.canDisposition ? <FindingActions row={row} role={role} orgId={orgId} onConfirmed={() => onDecided(row.id)} /> : null} />
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
export function FindingsList({ view, role, orgId }: { view: SecurityView; role: string | null; orgId: string | null }) {
  const [filter, setFilter] = useState<FilterKey>('all')
  const [grouped, setGrouped] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const section = useRef<HTMLElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const scrolled = useRef(false)
  const settled = view.empty !== null
  // The rows as last shown, and a confirmed decision waiting for the list to change (founder decision on focus).
  const order = useRef<string[]>([])
  const pendingFocus = useRef<{ rowId: string; before: string[] } | null>(null)

  useEffect(() => {
    if (!settled || scrolled.current) return
    scrolled.current = true
    if (window.location.hash === '#findings') section.current?.scrollIntoView()
  }, [settled])

  const rows = filterRows(view.rows, filter)
  const shown = grouped || showAll ? rows : rows.slice(0, LIST_LIMIT)
  const groups = grouped ? groupRows(rows) : null
  const ids = (groups ? groups.flatMap((g) => g.rows) : shown).map((r) => r.id)
  const note = view.tiles.findings?.note ?? null

  /**
   * When a confirmed decision moves a row out of the current filter, keyboard focus goes to the next row's
   * Review button, else the previous row's, else (the list is now empty) the "Security findings" heading.
   * The toast announces the result; no new text. A row that stays in the filter keeps focus where it is.
   */
  useEffect(() => {
    const pending = pendingFocus.current
    order.current = ids
    if (!pending) return
    pendingFocus.current = null
    if (ids.includes(pending.rowId)) return
    const at = pending.before.indexOf(pending.rowId)
    const target = pending.before.slice(at + 1).find((id) => ids.includes(id))
      ?? pending.before.slice(0, Math.max(at, 0)).reverse().find((id) => ids.includes(id))
    const rowEl = target
      ? [...(section.current?.querySelectorAll<HTMLElement>('[data-testid="security-row"]') ?? [])].find((r) => r.dataset.rowId === target)
      : undefined
    ;(rowEl?.querySelector<HTMLElement>('button[aria-expanded]') ?? heading.current)?.focus()
  })

  const onDecided = (rowId: string) => {
    // Set just before the confirmed row is written to the cache, so the next render is the changed list.
    pendingFocus.current = { rowId, before: order.current }
  }

  return (
    <section
      id="findings"
      ref={section}
      aria-labelledby="security-findings-heading"
      aria-busy={!settled || undefined}
      className="flex min-w-0 flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-6"
    >
      <h2 id="security-findings-heading" ref={heading} tabIndex={-1} className="m-0 text-section text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-600">{PAGE_COPY.findingsHeading}</h2>

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
              ? groups!.map((g) => (
                  <tbody key={g.key} data-testid="security-group">
                    <tr>
                      <th scope="rowgroup" colSpan={PAGE_COPY.tableHeaders.length} className="border-t border-slate-200 bg-slate-50 px-4 py-2 text-left">
                        <h3 className="m-0 text-ui font-semibold text-ink">{g.label}</h3>
                      </th>
                    </tr>
                    {g.rows.map((row) => <Row key={row.id} row={row} role={role} orgId={orgId} onDecided={onDecided} />)}
                  </tbody>
                ))
              : <tbody>{shown.map((row) => <Row key={row.id} row={row} role={role} orgId={orgId} onDecided={onDecided} />)}</tbody>}
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
