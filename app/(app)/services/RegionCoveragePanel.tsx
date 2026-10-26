'use client'

import type { RegionCoverageView, RegionRow, RegionState } from './regionCoverage'
import { RichText, ScanTime } from './ScanTime'

export const REGION_COVERAGE_ID = 'region-coverage'

const DOT: Record<RegionState, string> = {
  complete: 'bg-green-700',
  partial: 'bg-amber-700',
  scanning: 'bg-blue-700',
  out_of_date: 'bg-amber-700',
  denied: 'bg-red-700',
  timed_out: 'bg-red-700',
  failed: 'bg-red-700',
  unfinished: 'bg-red-700',
  not_scanned: 'border-[1.5px] border-slate-500 bg-transparent',
  not_listed: 'border-[1.5px] border-slate-500 bg-transparent',
  unavailable: 'bg-slate-400',
}

function Status({ row }: { row: RegionRow }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className={`inline-block h-2 w-2 shrink-0 rounded-full ${DOT[row.state]}`} />
      {row.status}
    </span>
  )
}

function RegionName({ row }: { row: RegionRow }) {
  return (
    <>
      <span className="font-mono text-slate-900">{row.label}</span>
      {row.home && <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-label text-slate-700">home</span>}
      {row.sublabel && <span className="text-slate-600"> · {row.sublabel}</span>}
      {row.regions && (
        <ul aria-label="Regions not scanned yet" className="m-0 mt-1 flex list-none flex-wrap gap-x-2 gap-y-0.5 p-0 font-mono text-meta font-normal text-slate-600">
          {row.regions.map((r) => <li key={r}>{r}</li>)}
        </ul>
      )}
    </>
  )
}

function LastSuccess({ row, now, exactLine = false }: { row: RegionRow; now: number; exactLine?: boolean }) {
  return typeof row.lastSuccess === 'string'
    ? <span className="text-slate-600">{row.lastSuccess}</span>
    : <ScanTime iso={row.lastSuccess.iso} now={now} exactLine={exactLine} />
}

function Details({ row, now }: { row: RegionRow; now: number }) {
  return row.details.length > 0 ? <RichText parts={row.details} now={now} /> : <span className="text-slate-600">—</span>
}

/**
 * Region coverage (multi-region M6): every enabled region's latest scan
 * status, home first, the not-yet-scanned regions as one row. A table from
 * the sm breakpoint; a stacked list below it, with the exact times printed.
 */
export function RegionCoveragePanel({ view, now }: { view: RegionCoverageView; now: number }) {
  return (
    <section id={REGION_COVERAGE_ID} aria-labelledby="region-coverage-heading" className="scroll-mt-4 bg-white rounded-xl border border-slate-200 mb-6">
      <h2 id="region-coverage-heading" className="m-0 border-b border-slate-100 px-4 py-3 text-section text-slate-900">Region coverage</h2>

      <div className="hidden sm:block" data-layout="table">
        <table className="w-full border-collapse text-ui">
          <caption className="sr-only">Scan status of each enabled region</caption>
          <thead>
            <tr className="bg-slate-50 text-left text-label uppercase tracking-[0.04em] text-slate-600">
              <th scope="col" className="px-4 py-2 font-semibold">Region</th>
              <th scope="col" className="px-4 py-2 font-semibold">Status</th>
              <th scope="col" className="px-4 py-2 font-semibold">Last full scan</th>
              <th scope="col" className="px-4 py-2 font-semibold">Details</th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row) => (
              <tr key={row.key} data-row={row.key} className="border-t border-slate-100 align-top">
                <th scope="row" className="px-4 py-2.5 text-left font-medium"><RegionName row={row} /></th>
                <td className="px-4 py-2.5 whitespace-nowrap"><Status row={row} /></td>
                <td className="px-4 py-2.5 whitespace-nowrap"><LastSuccess row={row} now={now} /></td>
                <td className="px-4 py-2.5 text-slate-700"><Details row={row} now={now} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="m-0 list-none p-0 sm:hidden" data-layout="stacked" aria-label="Scan status of each enabled region">
        {view.rows.map((row) => (
          <li key={row.key} data-row={row.key} className="border-t border-slate-100 px-4 py-3 text-ui first:border-t-0">
            <div className="font-medium"><RegionName row={row} /></div>
            <dl className="m-0 mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-slate-600">Status</dt><dd className="m-0"><Status row={row} /></dd>
              <dt className="text-slate-600">Last full scan</dt><dd className="m-0"><LastSuccess row={row} now={now} exactLine /></dd>
              <dt className="text-slate-600">Details</dt><dd className="m-0 text-slate-700"><Details row={row} now={now} /></dd>
            </dl>
          </li>
        ))}
      </ul>

      {(view.footer || view.listNote) && (
        <div className="flex flex-col gap-1 border-t border-slate-100 px-4 py-3 text-ui text-slate-700">
          {view.footer && <p className="m-0" data-line="footer">{view.footer}</p>}
          {view.listNote && <p className="m-0" data-line="list-note"><RichText parts={view.listNote} now={now} /></p>}
        </div>
      )}
    </section>
  )
}
