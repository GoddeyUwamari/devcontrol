'use client'

import { useId, useState } from 'react'
import { AlertTriangle, Info, OctagonAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CardNote, CoverageCardView, GlobalRow, PanelRow, RowStatus } from './redesignModel'
import { REDESIGN_COPY } from './redesignModel'
import { formatExact, formatWhen } from './regionCoverage'
import { RichText, ScanTime } from './ScanTime'
import { DOT, STATUS_INK, SURFACE, TONE } from './redesignTone'

export const REGION_COVERAGE_CARD_ID = 'region-coverage'

const NOTE: Record<CardNote['tone'], { surface: string; ink: string; Icon: typeof Info; role: 'status' | 'note' }> = {
  info: { surface: SURFACE.info, ink: TONE.body, Icon: Info, role: 'status' },
  warn: { surface: SURFACE.warning, ink: TONE.warning, Icon: AlertTriangle, role: 'note' },
  danger: { surface: SURFACE.danger, ink: TONE.danger, Icon: OctagonAlert, role: 'note' },
}

function Status({ status }: { status: RowStatus | null }) {
  if (!status) return <span className={TONE.muted}>—</span>
  return (
    <span className={cn('inline-flex items-center gap-1.5', STATUS_INK[status.key])} data-status={status.key}>
      <span aria-hidden="true" className={cn('inline-block h-2 w-2 shrink-0 rounded-full', DOT[status.key])} />
      {status.label}
    </span>
  )
}

/** "—" for null (never 0); the count, then its note ("from an earlier scan", "never scanned", "9 S3 buckets listed"). */
function Resources({ value, note }: { value: number | null; note?: string }) {
  return (
    <span className="inline-flex flex-col items-end text-right sm:items-end">
      {value === null ? <span className={TONE.muted}>—</span> : <span className={cn('tabular-nums', TONE.ink)}>{value.toLocaleString('en-US')}</span>}
      {note && <span className={cn('text-meta', TONE.muted)}>{note}</span>}
    </span>
  )
}

/**
 * The phone rows' scan time (pr3b-review F2): only the relative time shows;
 * the exact time is a role="tooltip" that describes the button, opening on
 * tap, hover and keyboard focus (Escape closes it), as UnknownOwnerTip does.
 * The desktop table keeps ScanTime's hover/focus tooltip.
 */
function TapScanTime({ iso, now }: { iso: string; now: number }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  return (
    <span className="relative inline-block" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-describedby={id}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false) }}
        className={cn('rounded-sm text-left underline decoration-dotted underline-offset-2', TONE.body, TONE.focus)}
      >
        <time dateTime={iso}>{formatWhen(iso, now)}</time>
      </button>
      <span
        role="tooltip"
        id={id}
        data-open={open ? 'true' : 'false'}
        className={cn(
          // Anchored at the time's right edge: the time sits in the row's second column, so a
          // left-anchored box ran past a 390 px screen (fix-round shot t15); this one never does.
          'absolute right-0 top-full z-20 mt-1 w-60 max-w-[80vw] whitespace-normal rounded-lg border border-border bg-popover px-3 py-2 text-meta text-popover-foreground shadow-md',
          open ? 'block' : 'hidden',
        )}
      >
        {formatExact(iso)}
      </span>
    </span>
  )
}

function LastFull({ value, now, phone = false }: { value: PanelRow['lastFull']; now: number; phone?: boolean }) {
  if (value === null) return <span className={TONE.muted}>—</span>
  if (typeof value === 'string') return <span>{value}</span>
  return phone ? <TapScanTime iso={value.iso} now={now} /> : <ScanTime iso={value.iso} now={now} />
}

/** The group's regions behind "Show regions" / "Hide regions" (a native disclosure). */
function Regions({ row, open, onToggle }: { row: PanelRow; open: boolean; onToggle: (open: boolean) => void }) {
  return (
    <details className="mt-1" open={open} onToggle={(e) => onToggle((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className={cn('cursor-pointer text-meta font-normal', TONE.link, TONE.focus)}>{open ? 'Hide regions' : 'Show regions'}</summary>
      <ul aria-label={row.regionsLabel} className={cn('m-0 mt-1 flex list-none flex-wrap gap-x-2 gap-y-0.5 p-0 font-mono text-meta font-normal', TONE.muted)}>
        {row.regions!.map((r) => <li key={r}>{r}</li>)}
      </ul>
    </details>
  )
}

function Name({ row }: { row: PanelRow }) {
  if (row.kind === 'group') return <span className={TONE.ink}>{row.label}</span>
  return (
    <>
      <span className={cn('font-mono', TONE.ink)}>{row.label}</span>
      {row.home && <span className={TONE.homeBadge}>Home</span>}
      {row.formerHome && <span data-chip="former-home" className={cn('ml-1.5 rounded border border-dashed border-border px-1.5 py-0.5 text-label', TONE.muted)}>{REDESIGN_COPY.formerHomeChip}</span>}
      {row.sublabel && <span className={cn('text-meta font-normal', TONE.muted)}> · {row.sublabel}</span>}
    </>
  )
}

function Details({ row, open }: { row: PanelRow; open: boolean }) {
  if (!row.details) return <span className={TONE.muted}>—</span>
  return (
    <>
      {row.details}
      {open && row.detailsWhenOpen && <span className={cn('mt-1 block text-meta', TONE.muted)}>{row.detailsWhenOpen}</span>}
    </>
  )
}

function TableRow({ row, now }: { row: PanelRow; now: number }) {
  const [open, setOpen] = useState(false)
  return (
    <tr data-row={row.key} className={cn('border-t align-top', TONE.divider, row.muted && 'bg-muted/40')}>
      <th scope="row" className="px-4 py-2.5 text-left font-medium">
        <Name row={row} />
        {row.regions && <Regions row={row} open={open} onToggle={setOpen} />}
      </th>
      <td className="px-4 py-2.5 text-right"><Resources value={row.resources} note={row.resourcesNote} /></td>
      <td className="px-4 py-2.5 whitespace-nowrap"><Status status={row.status} /></td>
      <td className={cn('px-4 py-2.5 whitespace-nowrap', TONE.body)}><LastFull value={row.lastFull} now={now} /></td>
      <td className={cn('px-4 py-2.5', TONE.body)}><Details row={row} open={open} /></td>
    </tr>
  )
}

function StackedRow({ row, now }: { row: PanelRow; now: number }) {
  const [open, setOpen] = useState(false)
  return (
    <li data-row={row.key} className={cn('border-t px-4 py-3 first:border-t-0', TONE.divider, row.muted && 'bg-muted/40')}>
      <div className="font-medium">
        <Name row={row} />
        {row.regions && <Regions row={row} open={open} onToggle={setOpen} />}
      </div>
      <dl className="m-0 mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className={TONE.muted}>Resources</dt><dd className="m-0 [&>span]:items-start [&>span]:text-left"><Resources value={row.resources} note={row.resourcesNote} /></dd>
        <dt className={TONE.muted}>Status</dt><dd className="m-0"><Status status={row.status} /></dd>
        {row.lastFull !== null && <><dt className={TONE.muted}>Last full scan</dt><dd className={cn('m-0', TONE.body)}><LastFull value={row.lastFull} now={now} phone /></dd></>}
        {row.details && <><dt className={TONE.muted}>Details</dt><dd className={cn('m-0', TONE.body)}><Details row={row} open={open} /></dd></>}
      </dl>
    </li>
  )
}

function globalAsRow(g: GlobalRow): PanelRow {
  return { key: g.key, kind: 'group', label: g.label, resources: g.resources, status: g.status, lastFull: g.lastFull, details: null }
}

/**
 * Region coverage (mock v2.2): the organising line, the home-region line
 * (HR-S8, then the owner-only "Change", PR 3c), the notes, every enabled region (individual
 * rows, then the collapsed groups), the global CloudFront row under its own
 * subheading and outside every region count, the legend of the states shown,
 * and the footer. A table from the sm breakpoint, a stacked list below it.
 */
export function RegionCoverageCard({ view, now, onChangeHomeRegion }: {
  view: CoverageCardView
  now: number
  /** PR 3c: the owner-only "Change" after HR-S8 (only when the server says the caller may change it). */
  onChangeHomeRegion?: (() => void) | null
}) {
  const global = view.global ? globalAsRow(view.global) : null
  return (
    <section id={REGION_COVERAGE_CARD_ID} aria-labelledby="region-coverage-heading" className={cn(TONE.card, 'mb-6 scroll-mt-4')}>
      <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-3', TONE.divider)}>
        <h2 id="region-coverage-heading" className={cn('m-0 text-section', TONE.ink, TONE.accentHeading)}>{REDESIGN_COPY.coverageHeading}</h2>
        <span className={cn('inline-flex items-center gap-1.5 text-meta', TONE.muted)}>
          <span aria-hidden="true" className={cn('inline-block h-2 w-2 rounded-full', DOT.complete)} />{REDESIGN_COPY.connected}
        </span>
      </div>

      <div className="flex flex-col gap-1 px-4 pt-3">
        <p data-testid="organising-line" data-failed={view.line.failed ? 'true' : undefined} className={cn('m-0 flex items-center gap-2 text-body font-semibold', TONE.ink)}>
          {view.line.failed && <span aria-hidden="true" className={cn('inline-block h-2 w-2 shrink-0 rounded-full', DOT.couldnt)} />}
          {view.line.text}
        </p>
        {view.homeLine && (
          <p className={cn('m-0 text-ui', TONE.muted)}>
            <span data-testid="home-line">{view.homeLine}</span>
            {onChangeHomeRegion && (
              <>
                {' '}
                <button type="button" data-testid="change-home-region" aria-label="Change home region" onClick={onChangeHomeRegion}
                  className={cn('rounded-sm font-medium', TONE.link, TONE.focus)}>Change</button>
              </>
            )}
          </p>
        )}
      </div>

      {view.notes.length > 0 && (
        <div className="flex flex-col gap-2 px-4 pt-3">
          {view.notes.map((note) => {
            const n = NOTE[note.tone]
            return (
              <div key={note.key} role={n.role} data-note={note.key} className={cn('flex items-start gap-2 rounded-lg border px-3 py-2 text-ui', n.surface, n.ink)}>
                <n.Icon size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span><RichText parts={note.parts} now={now} /></span>
              </div>
            )
          })}
        </div>
      )}

      <div className="mt-3 hidden sm:block" data-layout="table">
        <table className="w-full border-collapse text-ui">
          <caption className="sr-only">Scan status of each enabled region</caption>
          <thead>
            <tr className={cn('text-left text-label uppercase tracking-[0.04em]', TONE.subtle, TONE.muted)}>
              <th scope="col" className="px-4 py-2">Region</th>
              <th scope="col" className="px-4 py-2 text-right">Resources</th>
              <th scope="col" className="px-4 py-2">Status</th>
              <th scope="col" className="px-4 py-2">Last full scan</th>
              <th scope="col" className="px-4 py-2">Details</th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row) => <TableRow key={row.key} row={row} now={now} />)}
            {global && (
              <>
                <tr data-row="global-heading" className={cn('border-t', TONE.divider, TONE.subtle)}>
                  <th scope="colgroup" colSpan={5} className={cn('px-4 py-1.5 text-left text-label', TONE.muted)}>{REDESIGN_COPY.globalHeading}</th>
                </tr>
                <TableRow row={global} now={now} />
              </>
            )}
          </tbody>
        </table>
      </div>

      <ul className="m-0 mt-3 list-none p-0 text-ui sm:hidden" data-layout="stacked" aria-label="Scan status of each enabled region">
        {view.rows.map((row) => <StackedRow key={row.key} row={row} now={now} />)}
        {global && (
          <>
            <li data-row="global-heading" className={cn('border-t px-4 py-1.5 text-label', TONE.divider, TONE.subtle, TONE.muted)}>{REDESIGN_COPY.globalHeading}</li>
            <StackedRow row={global} now={now} />
          </>
        )}
      </ul>

      {view.legend.length > 0 && (
        <ul aria-label="Status legend" className={cn('m-0 flex list-none flex-col gap-1 border-t px-4 py-3 text-meta', TONE.divider, TONE.muted)}>
          {view.legend.map((entry) => (
            <li key={entry.key} className="flex items-start gap-1.5">
              <span aria-hidden="true" className={cn('mt-1 inline-block h-2 w-2 shrink-0 rounded-full', DOT[entry.key])} />
              <span><strong className={cn('font-semibold', STATUS_INK[entry.key])}>{entry.label}:</strong> {entry.text}</span>
            </li>
          ))}
        </ul>
      )}

      {view.footer.length > 0 && (
        <div className={cn('flex flex-col gap-1 border-t px-4 py-3 text-ui', TONE.divider, TONE.body)}>
          {view.footer.map((parts, i) => <p key={i} className="m-0" data-line={`footer-${i}`}><RichText parts={parts} now={now} /></p>)}
        </div>
      )}
    </section>
  )
}
