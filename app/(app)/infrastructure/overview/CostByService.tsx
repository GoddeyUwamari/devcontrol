'use client'

import { OVERVIEW_COPY, type CostByServiceView } from './overviewModel'

/** Billed month-to-date spend by AWS service: the cost summary's top 5 plus everything else. */
export function CostByService({ view }: { view: CostByServiceView }) {
  return (
    <section aria-labelledby="infra-cost-heading" className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
      <h2 id="infra-cost-heading" className="m-0 text-base font-bold text-slate-900">{OVERVIEW_COPY.costByServiceTitle}</h2>
      {view.sub && <p className="m-0 mt-1 text-xs text-slate-600">{view.sub}</p>}
      <div className="mt-3">
        {view.status === 'loading' ? (
          <p role="status" className="m-0 text-sm text-slate-600">Loading…</p>
        ) : view.status === 'unavailable' ? (
          <p className="m-0 text-sm text-slate-700">{view.unavailable}</p>
        ) : (
          <table className="w-full text-sm">
            <caption className="sr-only">{OVERVIEW_COPY.costByServiceTitle}</caption>
            <thead>
              <tr className="text-left text-xs font-semibold uppercase tracking-wider text-slate-600">
                <th scope="col" className="py-2">Service</th>
                <th scope="col" className="py-2 text-right">Billed</th>
                {view.rows.some((r) => r.share) && <th scope="col" className="py-2 text-right">Share</th>}
              </tr>
            </thead>
            <tbody>
              {view.rows.map((r) => (
                <tr key={r.service} className="border-t border-slate-100">
                  <th scope="row" className="break-words py-2 pr-3 text-left font-normal text-slate-900">{r.service}</th>
                  <td className="whitespace-nowrap py-2 text-right font-semibold text-slate-900">{r.amount}</td>
                  {view.rows.some((x) => x.share) && <td className="whitespace-nowrap py-2 pl-3 text-right text-slate-600">{r.share ?? ''}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="m-0 mt-3 text-xs text-slate-600">{OVERVIEW_COPY.costByServiceNote}</p>
    </section>
  )
}
