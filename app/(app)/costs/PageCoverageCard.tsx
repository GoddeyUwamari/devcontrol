'use client'

import { ArrowRight, CircleAlert, CircleCheck, CircleDashed, CircleX, TriangleAlert } from 'lucide-react'
import { COVERAGE_INTRO, COVERAGE_STATUS_LABEL, COVERAGE_TITLE, LOADING, type CoverageRow, type CoverageStatus } from './cost-intelligence'

/** Each status's icon and its ink colour (the app's status inks, AA on white). */
const STATUS_ICON: Record<CoverageStatus, { Icon: typeof CircleCheck; className: string }> = {
  checked: { Icon: CircleCheck, className: 'text-ink-success' },
  partly_checked: { Icon: TriangleAlert, className: 'text-ink-warning' },
  unavailable: { Icon: CircleX, className: 'text-ink-danger' },
  not_checked: { Icon: CircleAlert, className: 'text-ink-muted' },
}

/** Cost Optimization's "How DevControl checks" section (its CHECKS_ANCHOR). */
export const HOW_DEVCONTROL_CHECKS_HREF = '/cost-optimization#how-devcontrol-checks'

/**
 * What this page covers (spec item 12): one row per source or scope, each
 * checked / partly checked / unavailable / not checked from real signals
 * (coverageRows). Never says the whole account was verified.
 * Layout (mock-match item 7): a status icon, the bold "label · status", and
 * the muted detail under it; "How DevControl checks →" at the foot.
 */
export function PageCoverageCard({ rows, className = '' }: { rows: CoverageRow[]; className?: string }) {
  return (
    <section aria-labelledby="page-coverage-heading" className={`bg-white rounded-xl p-5 sm:p-6 border border-slate-200 flex flex-col gap-4 min-w-0 ${className}`} data-testid="page-coverage">
      <div>
        <h2 id="page-coverage-heading" className="text-section font-semibold text-slate-900 m-0 tracking-tight">{COVERAGE_TITLE}</h2>
        <p className="text-meta text-ink-muted m-0 mt-0.5">{COVERAGE_INTRO}</p>
      </div>
      <ul className="m-0 p-0 list-none flex flex-col gap-3.5">
        {rows.map((row) => {
          const icon = row.status ? STATUS_ICON[row.status] : { Icon: CircleDashed, className: 'text-ink-muted' }
          return (
            <li key={row.id} className="flex items-start gap-3 min-w-0" data-testid={`coverage-${row.id}`} data-status={row.status ?? 'loading'}>
              <icon.Icon size={18} className={`${icon.className} shrink-0 mt-px`} aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-ui font-semibold text-slate-900 m-0">
                  {row.label} · <span data-testid="coverage-status">{row.status ? COVERAGE_STATUS_LABEL[row.status].toLowerCase() : LOADING}</span>
                </p>
                {row.status && <p className="text-ui text-ink-muted m-0 leading-relaxed break-words">{row.detail}</p>}
              </div>
            </li>
          )
        })}
      </ul>
      <a href={HOW_DEVCONTROL_CHECKS_HREF} className="mt-auto inline-flex min-h-11 items-center gap-1 self-start text-ui font-semibold text-violet-700 hover:text-violet-800 no-underline">
        How DevControl checks <ArrowRight size={14} aria-hidden="true" />
      </a>
    </section>
  )
}
