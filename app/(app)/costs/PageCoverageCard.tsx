'use client'

import { COVERAGE_INTRO, COVERAGE_STATUS_LABEL, COVERAGE_TITLE, LOADING, type CoverageRow, type CoverageStatus } from './cost-intelligence'

const STATUS_CHIP: Record<CoverageStatus, string> = {
  checked: 'bg-green-50 text-ink-success border-green-200',
  partly_checked: 'bg-amber-50 text-ink-warning border-amber-200',
  unavailable: 'bg-red-50 text-ink-danger border-red-200',
  not_checked: 'bg-slate-100 text-slate-600 border-slate-200',
}

/**
 * What this page covers (spec item 12): one row per source or scope, each
 * checked / partly checked / unavailable / not checked from real signals
 * (coverageRows). Never says the whole account was verified.
 */
export function PageCoverageCard({ rows }: { rows: CoverageRow[] }) {
  return (
    <section aria-labelledby="page-coverage-heading" className="bg-white rounded-2xl p-5 sm:p-8 border border-slate-100 mb-5" data-testid="page-coverage">
      <h2 id="page-coverage-heading" className="text-ui font-semibold text-slate-900 m-0 tracking-tight">{COVERAGE_TITLE}</h2>
      <p className="text-meta text-ink-muted m-0 mt-0.5 mb-5">{COVERAGE_INTRO}</p>
      <ul className="m-0 p-0 list-none flex flex-col divide-y divide-slate-100">
        {rows.map((row) => (
          <li key={row.id} className="py-3 first:pt-0 last:pb-0 flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-4" data-testid={`coverage-${row.id}`} data-status={row.status ?? 'loading'}>
            <div className="sm:w-48 shrink-0 flex items-center justify-between gap-2 sm:flex-col sm:items-start">
              <span className="text-label font-semibold text-slate-900">{row.label}</span>
              {row.status ? (
                <span className={`text-label font-semibold px-2 py-0.5 rounded-full border ${STATUS_CHIP[row.status]}`}>{COVERAGE_STATUS_LABEL[row.status]}</span>
              ) : (
                <span className="text-label text-ink-muted">{LOADING}</span>
              )}
            </div>
            <p className="text-meta text-ink-muted m-0 leading-relaxed min-w-0 break-words">{row.status ? row.detail : null}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}
