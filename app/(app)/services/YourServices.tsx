'use client'

import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { RegisteredService } from '@/lib/types'
import { AddServiceButton } from './AddServiceButton'
import { PhaseTwoTag } from './PhaseTwoTag'

export type YourServicesState =
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | { status: 'ready'; services: RegisteredService[] }

/**
 * Your services (Q12): the services registered with Add Service. The
 * Registered date column is kept. The per-service column and the footer
 * sentence say resources are not mapped, so they show only while /stats says
 * no resource is mapped to a service (mappedToService === 0); unknown shows
 * neither. With no resources at all there is nothing to map, so the footer
 * sentence is left out.
 */
/** Rows shown before "Show all N". */
export const SERVICES_PREVIEW_ROWS = 10

export function YourServices({ state, mappedToService, totalResources }: {
  state: YourServicesState
  mappedToService: number | undefined
  totalResources: number | undefined
}) {
  const notMapped = mappedToService === 0
  // Expands and collapses in place: the rows are already loaded; nothing is fetched.
  const [showAll, setShowAll] = useState(false)

  let body: React.ReactNode
  if (state.status === 'error') {
    body = (
      <div role="alert" className="flex flex-col items-start gap-3 px-4 py-6">
        <p className="text-sm font-medium text-red-700 m-0">Couldn&apos;t load registered services.</p>
        <button
          type="button"
          onClick={state.retry}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-300"
        >
          <RefreshCw size={12} aria-hidden="true" /> Try again
        </button>
      </div>
    )
  } else if (state.status === 'loading') {
    body = <p role="status" className="px-4 py-6 text-sm text-slate-600 m-0">Loading registered services...</p>
  } else if (state.services.length === 0) {
    body = (
      <div className="flex flex-col items-start gap-3 px-4 py-6">
        <p className="text-sm text-slate-700 m-0">No services registered yet.</p>
        <AddServiceButton size="sm" />
      </div>
    )
  } else {
    const total = state.services.length
    const rows = showAll ? state.services : state.services.slice(0, SERVICES_PREVIEW_ROWS)
    body = (
      <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">
              <th scope="col" className="px-4 py-2.5">Service</th>
              <th scope="col" className="px-3 py-2.5">Owner</th>
              <th scope="col" className="px-3 py-2.5">Team</th>
              <th scope="col" className="px-3 py-2.5">Repository</th>
              <th scope="col" className="px-3 py-2.5">Registered</th>
              {notMapped && <th scope="col" className="px-3 py-2.5">Resources · findings · cost · deploys <PhaseTwoTag /></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((service) => (
              <tr key={service.id} className="border-b border-slate-50 last:border-0">
                <td className="px-4 py-3 font-semibold text-slate-900">{service.name}</td>
                <td className="px-3 py-3 text-slate-700">{service.owner?.trim() ? service.owner : <span className="text-slate-600">No owner set</span>}</td>
                <td className="px-3 py-3 text-slate-700">{service.teamName ?? <span className="text-slate-600">No team set</span>}</td>
                <td className="px-3 py-3">
                  {service.githubUrl ? (
                    <a href={service.githubUrl} target="_blank" rel="noopener noreferrer" className="text-violet-700 hover:underline break-all">
                      {service.githubUrl.replace(/^https?:\/\//, '')}
                    </a>
                  ) : (
                    <span className="text-slate-600">No repository set</span>
                  )}
                </td>
                <td className="px-3 py-3 text-slate-700 whitespace-nowrap">{new Date(service.createdAt).toLocaleDateString()}</td>
                {notMapped && <td className="px-3 py-3 text-slate-600">Not mapped yet</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > SERVICES_PREVIEW_ROWS && (
        <div className="border-t border-slate-100 px-4 py-2.5">
          <button
            type="button"
            aria-expanded={showAll}
            onClick={() => setShowAll((v) => !v)}
            className="text-sm font-semibold text-violet-700 hover:underline"
          >
            {showAll ? 'Show fewer' : `Show all ${total}`}
          </button>
        </div>
      )}
      </>
    )
  }

  return (
    <section aria-labelledby="your-services-heading" className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-100 px-4 py-3">
        <h2 id="your-services-heading" className="text-base font-bold text-slate-900 m-0">Your services</h2>
        {state.status === 'ready' && state.services.length > 0 && (
          <span className="text-sm text-slate-600">{state.services.length} registered</span>
        )}
        {/* The empty state carries its own Add Service. */}
        {!(state.status === 'ready' && state.services.length === 0) && <span className="ml-auto"><AddServiceButton size="sm" /></span>}
      </div>
      {body}
      {notMapped && typeof totalResources === 'number' && totalResources > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 bg-slate-50 px-4 py-3">
          <p className="m-0 flex-[1_1_320px] text-sm text-slate-600">
            None of the {totalResources} resources are mapped to a service yet. Mapping by tag or by hand fills in resources, findings, cost and deploys per service.
          </p>
          <button type="button" disabled className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 opacity-60 cursor-not-allowed">
            Map resources to services
          </button>
          <PhaseTwoTag />
        </div>
      )}
    </section>
  )
}
