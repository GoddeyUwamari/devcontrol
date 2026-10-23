'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import awsServicesService, { type InventoryResource } from '@/lib/services/aws-services.service'
import { STATUS_LABEL, typeLabel } from './AttentionTable'
import { timeAgo } from './coverage'

export const RESOURCE_NOT_FOUND_TEXT = "This resource isn't in your current inventory. It may have been removed, belong to another organization, or the link may be wrong."

/**
 * `/services?resource=<id>` (the command palette's link, sent on from
 * /infrastructure, infra-overview-plan.md §17.4): one inventoried resource,
 * read with GET /api/services/:id (database only, org-scoped). Renders nothing
 * without the parameter, and nothing in demo or sales demo (Q-R3). The state
 * is the Services page's own wording (STATUS_LABEL); no cost is shown.
 */
export function ResourceFocus({ orgId, isDemoActive }: { orgId: string | null; isDemoActive: boolean }) {
  const resourceId = useSearchParams()?.get('resource') ?? null
  if (!resourceId || isDemoActive) return null
  return <ResourceCard key={resourceId} orgId={orgId} resourceId={resourceId} />
}

function ResourceCard({ orgId, resourceId }: { orgId: string | null; resourceId: string }) {
  const router = useRouter()
  const [now] = useState(() => Date.now())
  const query = useQuery<InventoryResource | null>({
    queryKey: ['services-resource', orgId, resourceId],
    queryFn: () => awsServicesService.getResource(resourceId),
    enabled: !!orgId, retry: false, refetchOnWindowFocus: false,
  })
  const close = () => router.replace('/services')
  const row = query.data

  let body: React.ReactNode
  if (query.isPending) {
    body = <p role="status" className="m-0 text-sm text-slate-600">Loading resource…</p>
  } else if (!row) {
    body = (
      <div className="flex flex-col gap-2">
        <p className="m-0 text-sm text-slate-700">{RESOURCE_NOT_FOUND_TEXT}</p>
        <button type="button" onClick={close} className="w-fit text-sm font-semibold text-violet-700 hover:underline">Show all resources</button>
      </div>
    )
  } else {
    const items: [string, string][] = [
      ['Resource', row.resource_name ?? row.resource_id ?? '—'],
      ['Type', typeLabel(row.resource_type)],
      ['Region', row.region ?? '—'],
      ['AWS ID', row.resource_id ?? '—'],
      ['Last seen', row.last_synced_at ? `${new Date(row.last_synced_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} (${timeAgo(row.last_synced_at, now)})` : '—'],
      ['Lifecycle state', STATUS_LABEL[row.status] ?? '—'],
    ]
    body = (
      <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {items.map(([term, value]) => (
          <div key={term} className="min-w-0">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-600">{term}</dt>
            <dd className="m-0 break-words text-slate-900">{value}</dd>
          </div>
        ))}
      </dl>
    )
  }

  return (
    <section aria-labelledby="resource-focus-heading" data-testid="resource-focus" className="mb-6 rounded-xl border border-violet-200 bg-white p-4 sm:p-6">
      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 id="resource-focus-heading" className="m-0 text-base font-bold text-slate-900">Resource</h2>
        <button type="button" onClick={close} className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700">Close</button>
      </div>
      {body}
    </section>
  )
}
