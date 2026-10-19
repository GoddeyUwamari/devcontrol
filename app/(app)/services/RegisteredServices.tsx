'use client'

import Link from 'next/link'
import { Plus, RefreshCw } from 'lucide-react'
import { useRegisteredServices } from '@/lib/hooks/use-registered-services'

/**
 * The services registered through Add Service (the services table, via
 * GET /api/services/registered) -- separate from the discovered AWS
 * resources listed below it on this page. Refetched on every visit (see
 * useRegisteredServices), so a service just created on /services/new is
 * listed when the form returns here.
 */
export function RegisteredServices() {
  const query = useRegisteredServices()

  let body: React.ReactNode
  if (query.isError) {
    body = (
      <div role="alert" className="flex flex-col items-start gap-3 px-5 py-6 sm:px-7">
        <p className="text-sm font-medium text-red-700 m-0">Couldn&apos;t load registered services.</p>
        <button
          onClick={() => query.refetch()}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-slate-300"
        >
          <RefreshCw size={12} aria-hidden="true" /> Try again
        </button>
      </div>
    )
  } else if (query.isPending) {
    body = (
      <p role="status" className="px-5 py-6 text-sm text-slate-500 sm:px-7 m-0">Loading registered services...</p>
    )
  } else if (query.data.length === 0) {
    body = (
      <div className="flex flex-col items-start gap-3 px-5 py-6 sm:px-7">
        <p className="text-sm text-slate-600 m-0">No services registered yet.</p>
        <Link
          href="/services/new"
          className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white no-underline hover:bg-violet-700"
        >
          <Plus size={12} aria-hidden="true" /> Add Service
        </Link>
      </div>
    )
  } else {
    body = (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
              <th className="px-5 py-2.5 sm:px-7">Name</th>
              <th className="px-3 py-2.5">Owner</th>
              <th className="px-3 py-2.5">Team</th>
              <th className="px-3 py-2.5">Repository</th>
              <th className="px-3 py-2.5">Registered</th>
            </tr>
          </thead>
          <tbody>
            {query.data.map((service) => (
              <tr key={service.id} className="border-b border-slate-50 last:border-0">
                <td className="px-5 py-3 font-semibold text-slate-900 sm:px-7">{service.name}</td>
                <td className="px-3 py-3 text-slate-600">{service.owner}</td>
                <td className="px-3 py-3 text-slate-600">{service.teamName ?? <span className="text-slate-400">No team</span>}</td>
                <td className="px-3 py-3">
                  {service.githubUrl ? (
                    <a href={service.githubUrl} target="_blank" rel="noopener noreferrer" className="text-violet-700 hover:underline break-all">
                      {service.githubUrl.replace(/^https?:\/\//, '')}
                    </a>
                  ) : (
                    <span className="text-slate-400">None</span>
                  )}
                </td>
                <td className="px-3 py-3 text-slate-600 whitespace-nowrap">{new Date(service.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <section aria-labelledby="registered-services-heading" className="bg-white rounded-2xl border border-slate-100 overflow-hidden mb-8">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:px-7">
        <div>
          <h2 id="registered-services-heading" className="text-base font-bold text-slate-900 m-0">Registered services</h2>
          <p className="text-xs text-slate-500 m-0">Services added with Add Service. Discovered AWS resources are listed below.</p>
        </div>
        {query.isSuccess && query.data.length > 0 && (
          <span className="text-xs font-semibold text-slate-500">{query.data.length} registered</span>
        )}
      </div>
      {body}
    </section>
  )
}
