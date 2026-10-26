'use client'

import { Fragment, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, RefreshCw } from 'lucide-react'
import type { AWSService, AWSServicesPage } from '@/lib/services/aws-services.service'
import { SeverityBadge } from '@/components/ui/severity-badge'
import { TYPE_DISPLAY } from './resourceTypes'
import { ownerDisplay } from './ownership'
import { timeAgo } from './coverage'

/** Rows in the compact table (Q18): the server's order, severity then name. */
export const ATTENTION_ROWS = 6

export const ATTENTION_DESCRIPTION = 'Critical and high findings, high-severity cost recommendations, stopped or failed resources'

export type AttentionState =
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | { status: 'ready'; page: AWSServicesPage }

export const SEVERITY_LABEL: Record<string, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' }

// The lifecycle state as the list reports it, without calling anything healthy.
export const STATUS_LABEL: Record<AWSService['status'], string> = {
  healthy: 'Not stopped or failed',
  warning: 'Stopped or degraded',
  critical: 'Failed or terminated',
  unknown: 'Not read',
}

const OWNERSHIP_LABEL: Record<string, string> = { owned: 'Owned', unowned: 'Unowned', unknown: 'Unknown · tags unreadable' }

export function typeLabel(type: string) {
  return TYPE_DISPLAY[type] ?? type?.toUpperCase() ?? '—'
}

/**
 * The owner, as S1-C labels it. withTeam: the team follows the owner
 * ("{owner} · {team}", "No Owner tag · {team}"); tables with their own Team
 * column pass false, so the team is shown once.
 */
export function OwnerCell({ row, withTeam = true }: { row: AWSService; withTeam?: boolean }) {
  const owner = ownerDisplay(row)
  switch (owner.kind) {
    case 'unowned':
      return <span className="rounded px-2 py-0.5 text-label bg-orange-50 text-orange-900">Unowned</span>
    case 'unknown':
      return <span className="rounded px-2 py-0.5 text-label bg-slate-100 text-slate-700">{owner.label}</span>
    case 'owner':
      return <span className="text-slate-700">{owner.label}{withTeam && owner.team ? ` · ${owner.team}` : ''}</span>
    case 'team-only':
      return <span className="text-slate-700">{withTeam ? `No Owner tag · ${owner.team}` : 'No Owner tag'}</span>
    default:
      return <span className="text-slate-600">—</span>
  }
}

/** A row's environment: "Untagged" only when its tags were read; "—" when they could not be. */
export function environmentLabel(row: AWSService): string {
  return row.environment ?? (row.ownership === 'unknown' ? '—' : 'Untagged')
}

/** "Oct 22, 1:00 PM (2 h ago)": when a discovery last listed the resource. */
export function lastSeenText(iso: string, now: number): string {
  return `${new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} (${timeAgo(iso, now)})`
}

/** The expanded row (Q5): fields the list already returned. Nothing is fetched. */
export function Details({ row }: { row: AWSService }) {
  const [now] = useState(() => Date.now())
  const owner = ownerDisplay(row)
  const items: [string, string][] = [
    ['Issue', row.reason ?? '—'],
    ['Resource', row.name],
    ['Type', typeLabel(row.type)],
    ['Region', row.aws_region ?? '—'],
    ['Environment', environmentLabel(row)],
    ['Owner', owner.kind === 'owner' ? owner.label : owner.kind === 'team-only' ? 'No Owner tag' : owner.label],
    ['Team', owner.kind === 'unknown' ? '—' : row.team ?? '—'],
    ['Ownership', row.ownership ? OWNERSHIP_LABEL[row.ownership] : '—'],
    ['Last seen', row.last_seen_at ? lastSeenText(row.last_seen_at, now) : '—'],
    ['Lifecycle state', STATUS_LABEL[row.status] ?? '—'],
  ]
  return (
    <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3 text-ui">
      {items.map(([term, value]) => (
        <div key={term} className="min-w-0">
          <dt className="text-label uppercase tracking-[0.04em] text-slate-600">{term}</dt>
          <dd className="m-0 break-words text-slate-900">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

// aria-controls names the detail row only while it is in the DOM.
function Action({ row, expanded, onToggle, detailsId }: { row: AWSService; expanded: boolean; onToggle: () => void; detailsId: string }) {
  // No Fix in Phase 1 (Q4): a cost recommendation is reviewed on its own page.
  if (row.attention_cause === 'cost_recommendation') {
    return (
      <Link href="/cost-optimization" aria-label={`Review ${row.name}`} className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-label text-slate-700 no-underline hover:border-slate-300">
        Review
      </Link>
    )
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-controls={expanded ? detailsId : undefined}
      aria-label={`${expanded ? 'Hide details' : 'View details'} for ${row.name}`}
      className="inline-flex items-center rounded-lg px-2.5 py-1 text-label text-violet-700 hover:bg-violet-50"
    >
      {expanded ? 'Hide details' : 'View details'}
    </button>
  )
}

/**
 * What needs attention: the first six resources that need attention, across
 * the organization (no filters), in the server's order. "View all N" opens the
 * full list below with Needs attention selected.
 */
export function AttentionTable({ state, totalResources, onViewAll, onShowAll }: {
  state: AttentionState
  /** /stats' total, for the empty state's sentence; undefined when unknown. */
  totalResources: number | undefined
  onViewAll: () => void
  onShowAll: () => void
}) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const total = state.status === 'ready' ? state.page.pagination.total : null

  let body: React.ReactNode
  if (state.status === 'loading') {
    body = <p role="status" className="m-0 px-5 py-6 text-ui text-slate-600">Loading resources…</p>
  } else if (state.status === 'error') {
    body = (
      <div role="alert" className="px-5 py-8 text-center">
        <p className="text-ui font-semibold text-slate-900 mb-1">The resource list could not be loaded</p>
        <p className="text-meta text-slate-600 mb-4 leading-relaxed">This is a loading error, not an empty result.</p>
        <button type="button" onClick={state.retry} className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 px-4 py-2 rounded-lg text-label cursor-pointer inline-flex items-center gap-1.5">
          <RefreshCw size={13} aria-hidden="true" /> Try again
        </button>
      </div>
    )
  } else if (state.page.services.length === 0) {
    const n = totalResources
    body = (
      <div className="px-5 py-8 text-center">
        <CheckCircle2 size={18} className="text-green-700 mx-auto mb-2" aria-hidden="true" />
        <p className="text-ui font-semibold text-slate-900 mb-1">Nothing needs attention right now</p>
        {typeof n === 'number' && (
          <p className="text-meta text-slate-600 mb-4 leading-relaxed">None of the {n} resource{n !== 1 ? 's have' : ' has'} a flagged issue.</p>
        )}
        <button type="button" onClick={onShowAll} className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 px-4 py-2 rounded-lg text-label cursor-pointer">
          Show all resources
        </button>
      </div>
    )
  } else {
    body = (
      <div className="overflow-x-auto">
        <table className="w-full text-ui">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-label uppercase tracking-[0.04em] text-slate-600">
              <th scope="col" className="px-4 py-2.5">Severity</th>
              <th scope="col" className="px-3 py-2.5">Issue</th>
              <th scope="col" className="px-3 py-2.5">Resource</th>
              <th scope="col" className="px-3 py-2.5">Region</th>
              <th scope="col" className="px-3 py-2.5">Owner / team</th>
              <th scope="col" className="px-4 py-2.5 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {state.page.services.map((row) => {
              const isOpen = expanded === row.id
              const detailsId = `attention-details-${row.id}`
              return (
                <Fragment key={row.id}>
                  <tr className="border-b border-slate-100 align-middle">
                    <td className="px-4 py-3 whitespace-nowrap">
                      {row.priority_severity && <SeverityBadge severity={row.priority_severity} label={SEVERITY_LABEL[row.priority_severity]} />}
                    </td>
                    <td className="px-3 py-3 min-w-[220px] text-slate-900">{row.reason ?? '—'}</td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span className="font-medium text-slate-900">{row.name}</span>{' '}
                      <span className="text-meta text-slate-600">{typeLabel(row.type)}</span>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap font-mono text-meta text-slate-700">{row.aws_region ?? '—'}</td>
                    <td className="px-3 py-3 whitespace-nowrap"><OwnerCell row={row} /></td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <Action row={row} expanded={isOpen} detailsId={detailsId} onToggle={() => setExpanded(isOpen ? null : row.id)} />
                    </td>
                  </tr>
                  {isOpen && (
                    <tr id={detailsId} className="border-b border-slate-100 bg-slate-50">
                      <td colSpan={6} className="px-4 py-4"><Details row={row} /></td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <section aria-labelledby="attention-heading" className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-100 px-4 py-3.5">
        <h2 id="attention-heading" className="m-0 text-section text-slate-900">What needs attention</h2>
        <span className="text-ui text-slate-600">{ATTENTION_DESCRIPTION}</span>
        {total !== null && total > 0 && (
          <button type="button" onClick={onViewAll} className="ml-auto text-ui font-semibold text-violet-700 hover:underline">
            View all {total} →
          </button>
        )}
      </div>
      {body}
    </section>
  )
}
