'use client'

import { Fragment, useId, useState } from 'react'
import { CheckCircle2, Layers, RefreshCw, Scan, SearchX } from 'lucide-react'
import type { AWSService, AWSServicesPage, ServicesCoverage } from '@/lib/services/aws-services.service'
import { SeverityBadge } from '@/components/ui/severity-badge'
import { RESOURCE_TYPE_CHIPS, TYPE_DISPLAY } from './resourceTypes'
import { Details, OwnerCell, SEVERITY_LABEL, environmentLabel, typeLabel } from './AttentionTable'
import { PhaseTwoTag } from './PhaseTwoTag'
import { resourcesScopeCaption, timeAgo } from './coverage'
import type { StatsState } from './SummaryTiles'
import {
  type AllResourcesFilters, type ShowFilter, MAX_SEARCH_LENGTH,
  countsAreNarrowed, filterMissTitle, hasActiveFilter, isPositiveEmpty, regionOptionLabel, showsNoFlaggedLine,
} from './allResources'

export type AllResourcesState =
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  /** dimmed: the previous page, shown while the next one loads. */
  | { status: 'ready'; page: AWSServicesPage; dimmed: boolean }

const selectClass = 'w-full min-h-[34px] rounded-lg border border-slate-300 bg-white px-2.5 text-sm text-slate-900'
const labelClass = 'flex flex-col gap-1 text-xs font-medium text-slate-600'

/** A count for a Show option: "…" while loading, "—" when /stats failed, never 0 by default. */
function showCount(n: number | undefined, stats: StatsState): string {
  if (stats.loading) return '…'
  if (stats.unavailable || typeof n !== 'number') return '—'
  return String(n)
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

function Row({ row }: { row: AWSService }) {
  const [open, setOpen] = useState(false)
  // "Last seen" is read against the time the row mounted.
  const [now] = useState(() => Date.now())
  const detailsId = `all-resources-details-${row.id}`
  const owner = row.ownership === 'unknown'
  return (
    <Fragment>
      <tr className="border-b border-slate-100 align-middle">
        <td className="px-4 py-3">
          {/* "View details" always on its own line under the name. */}
          <div className="flex flex-col items-start gap-1">
          <span className="font-medium text-slate-900">{row.name}</span>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={open ? detailsId : undefined}
            aria-label={`${open ? 'Hide details' : 'View details'} for ${row.name}`}
            className="-ml-1.5 rounded px-1.5 py-0.5 text-xs font-semibold text-violet-700 hover:bg-violet-50"
          >
            {open ? 'Hide details' : 'View details'}
          </button>
          </div>
        </td>
        <td className="px-3 py-3 whitespace-nowrap">
          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">{typeLabel(row.type)}</span>
        </td>
        <td className="px-3 py-3 whitespace-nowrap font-mono text-xs text-slate-700">{row.aws_region ?? '—'}</td>
        <td className="px-3 py-3 whitespace-nowrap text-slate-700">{environmentLabel(row)}</td>
        <td className="px-3 py-3 whitespace-nowrap"><OwnerCell row={row} withTeam={false} /></td>
        <td className="px-3 py-3 whitespace-nowrap text-slate-700">{owner || !row.team ? <span className="text-slate-600">—</span> : row.team}</td>
        <td className="px-3 py-3 min-w-[200px]">
          {row.needs_attention ? (
            // One layout for every row: the chip, then the text on the same line, wrapping after it.
            <p className="m-0 leading-6 text-slate-900">
              {row.priority_severity && <SeverityBadge className="mr-2 align-middle" severity={row.priority_severity} label={SEVERITY_LABEL[row.priority_severity]} />}
              {row.reason ?? '—'}
            </p>
          ) : <span className="text-slate-600">None flagged</span>}
        </td>
        <td className="px-3 py-3 whitespace-nowrap text-slate-600">{row.last_seen_at ? timeAgo(row.last_seen_at, now) : '—'}</td>
      </tr>
      {open && (
        <tr id={detailsId} className="border-b border-slate-100 bg-slate-50">
          <td colSpan={8} className="px-4 py-4"><Details row={row} /></td>
        </tr>
      )}
    </Fragment>
  )
}

/**
 * All resources (Phase 1, PR S1-D): every resource of the organization, paged
 * and filtered by the server (S1-A's params), in the attention order. Replaces
 * the current page's two-section list when the redesign flag is on. Filters
 * are controlled by ServicesOverview, so the tiles and cards above can set them.
 */
export function AllResourcesTable({
  state, filters, searchInput, onSearchInput, onFilters, onClearFilters, onPage,
  stats, coverage, knownNoAccount, teamSelectRef, isDiscovering, onAutoDiscover,
}: {
  state: AllResourcesState
  filters: AllResourcesFilters
  searchInput: string
  onSearchInput: (value: string) => void
  onFilters: (change: Partial<AllResourcesFilters>) => void
  onClearFilters: () => void
  onPage: (page: number) => void
  stats: StatsState
  coverage: ServicesCoverage | undefined
  /** The page knows the organization has no AWS account (used while coverage is unknown). */
  knownNoAccount: boolean
  teamSelectRef: React.RefObject<HTMLSelectElement | null>
  isDiscovering: boolean
  onAutoDiscover: () => void
}) {
  const ids = useId()
  const id = (name: string) => `${ids}-${name}`
  const statsData = stats.stats
  const home = coverage?.account.connected ? coverage.scope.home_region?.region ?? null : null
  const teams = statsData?.teams
  const moreTeams = teams ? teams.total_teams - teams.all.length : 0
  const filtered = hasActiveFilter(filters)
  const narrowed = countsAreNarrowed(filters)
  const page = state.status === 'ready' ? state.page : null
  const total = page?.pagination.total
  // The organization's total, only from loaded /stats: never a number from a failed or loading request.
  const orgTotal = !stats.loading && !stats.unavailable && typeof statsData?.total === 'number' ? statsData.total : undefined

  const showOptions: { value: ShowFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'needs_attention', label: `Needs attention (${showCount(statsData?.needs_attention, stats)})` },
    { value: 'unowned', label: `Unowned (${showCount(statsData?.ownership?.unowned, stats)})` },
    { value: 'unknown', label: `Owner unknown (${showCount(statsData?.ownership?.unknown, stats)})` },
  ]

  let body: React.ReactNode
  if (state.status === 'loading') {
    body = (
      <div role="status" className="px-7 py-12 text-center">
        <RefreshCw size={20} className="text-slate-500 mx-auto mb-3" aria-hidden="true" style={{ animation: 'spin 1s linear infinite' }} />
        <p className="text-sm text-slate-600 m-0">Loading resources…</p>
      </div>
    )
  } else if (state.status === 'error') {
    body = (
      <div className="px-5 py-10 text-center" role="alert">
        <p className="text-sm font-semibold text-slate-900 mb-1">The resource list could not be loaded</p>
        <p className="text-xs text-slate-600 mb-4 leading-relaxed">This is a loading error, not an empty result.</p>
        <button type="button" onClick={state.retry} className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 px-4 py-2 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5">
          <RefreshCw size={13} aria-hidden="true" /> Try again
        </button>
      </div>
    )
  } else if (state.page.pagination.total === 0) {
    const n = orgTotal
    const noAccount = coverage ? !coverage.account.connected : knownNoAccount
    // No resources at all (loaded /stats total 0): the no-filter states, whatever the filters.
    const unfilteredState = !filtered || n === 0
    if (unfilteredState && noAccount) {
      body = (
        <div className="px-5 sm:px-12 py-12 text-center">
          <Layers size={22} className="text-slate-500 mx-auto mb-4" aria-hidden="true" />
          <p className="text-sm font-semibold text-slate-900 mb-1.5">No AWS account connected</p>
          <p className="text-sm text-slate-600 mb-6 leading-relaxed max-w-md mx-auto">Connect an AWS account with read-only access. DevControl lists the resources it discovers here.</p>
          <a href="/connect-aws" className="bg-violet-600 hover:bg-violet-700 text-white px-6 py-2.5 rounded-lg text-sm font-semibold no-underline inline-flex items-center gap-2">
            Connect AWS account
          </a>
        </div>
      )
    } else if (unfilteredState) {
      body = (
        <div className="px-5 py-10 text-center">
          <Layers size={18} className="text-slate-500 mx-auto mb-3" aria-hidden="true" />
          <p className="text-sm font-semibold text-slate-900 mb-1">No resources discovered yet</p>
          <p className="text-xs text-slate-600 mb-4 leading-relaxed">Run Auto Discover to scan your connected account.</p>
          <button type="button" onClick={onAutoDiscover} disabled={isDiscovering} className="bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5">
            <Scan size={13} aria-hidden="true" /> Auto Discover
          </button>
        </div>
      )
    } else if (isPositiveEmpty(filters) && n !== 0) {
      // The count only when /stats is loaded; otherwise the state without it.
      body = (
        <div className="px-5 py-10 text-center">
          <CheckCircle2 size={18} className="text-green-700 mx-auto mb-3" aria-hidden="true" />
          <p className={`text-sm font-semibold text-slate-900 ${typeof n === 'number' ? 'mb-1' : 'mb-4'}`}>Nothing needs attention right now</p>
          {typeof n === 'number' && <p className="text-xs text-slate-600 mb-4 leading-relaxed">None of the {n} resource{n !== 1 ? 's have' : ' has'} a flagged issue.</p>}
          <button type="button" onClick={onClearFilters} className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 px-4 py-2 rounded-lg text-xs font-semibold">
            Show all resources
          </button>
        </div>
      )
    } else {
      body = (
        <div className="px-5 py-8 text-center">
          <SearchX size={18} className="text-slate-500 mx-auto mb-3" aria-hidden="true" />
          <p className="text-sm font-semibold text-slate-900 mb-1">{filterMissTitle(filters)}</p>
          <p className="text-xs text-slate-600 mb-4 leading-relaxed">
            {typeof n === 'number'
              ? `Try a different resource type, or clear filters to see all ${n} resource${n !== 1 ? 's' : ''}.`
              : 'Try a different resource type, or clear filters to see all resources.'}
          </p>
          <button type="button" onClick={onClearFilters} className="bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 rounded-lg text-xs font-semibold">
            Clear filter
          </button>
        </div>
      )
    }
  } else {
    const { pagination } = state.page
    const first = Math.min((pagination.page - 1) * pagination.limit + 1, pagination.total)
    const last = Math.min(pagination.page * pagination.limit, pagination.total)
    body = (
      <div className={state.dimmed ? 'opacity-60' : ''}>
        {/* The table scrolls in its own box at phone width; the box is focusable for keyboard scrolling. */}
        <div role="region" aria-label="All resources table" tabIndex={0} className="overflow-x-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">
                {['Resource', 'Type', 'Region', 'Environment', 'Owner', 'Team', 'Issue', 'Last seen'].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2.5 first:px-4 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {state.page.services.map((row) => <Row key={row.id} row={row} />)}
            </tbody>
          </table>
        </div>
        <nav aria-label="All resources pages" className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-3 border-t border-slate-100">
          <p className="text-xs text-slate-600 font-medium m-0">Showing {first}–{last} of {pagination.total}</p>
          <div className="flex items-center gap-2">
            <button type="button" className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={state.dimmed || pagination.page <= 1} onClick={() => onPage(pagination.page - 1)}>Previous</button>
            <span className="text-xs text-slate-600 font-medium">Page {pagination.page} of {Math.max(1, pagination.total_pages)}</span>
            <button type="button" className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={state.dimmed || !pagination.has_more} onClick={() => onPage(pagination.page + 1)}>Next</button>
          </div>
        </nav>
      </div>
    )
  }

  const scope = resourcesScopeCaption(coverage)
  const noFlagged = page?.counts.no_flagged_issues
  return (
    <section aria-labelledby={id('heading')} className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-100 px-4 py-3.5">
        <h2 id={id('heading')} className="m-0 text-base font-bold text-slate-900">All resources</h2>
        {typeof total === 'number' && (
          <span className="text-sm text-slate-600">
            {plural(total, 'resource')}{filtered ? ' matching current filters' : scope ? ` ${scope}` : ''}
          </span>
        )}
        {typeof noFlagged === 'number' && noFlagged > 0 && showsNoFlaggedLine(filters) && (
          <span className="text-sm text-slate-600">
            · {plural(noFlagged, 'resource')} with no flagged issues{narrowed ? ' matching current filters' : ''}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2 border-b border-slate-100 px-4 py-3">
        {/* Six filters in 1, 2, 3 or 6 equal columns, so every row is full: none is left alone on a second row. */}
        <div data-testid="all-resources-filters" className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        <label htmlFor={id('search')} className={labelClass}>Search
          <input id={id('search')} type="search" placeholder="Name, ID or tag" maxLength={MAX_SEARCH_LENGTH}
            value={searchInput} onChange={(e) => onSearchInput(e.target.value)} className={selectClass} />
        </label>
        <label htmlFor={id('type')} className={labelClass}>Type
          <select id={id('type')} value={filters.type} onChange={(e) => onFilters({ type: e.target.value })} className={selectClass}>
            {RESOURCE_TYPE_CHIPS.map((t) => <option key={t} value={t}>{TYPE_DISPLAY[t]}</option>)}
          </select>
        </label>
        <label htmlFor={id('region')} className={labelClass}>Region
          <select id={id('region')} value={filters.region} onChange={(e) => onFilters({ region: e.target.value })} className={selectClass}>
            <option value="all">All scanned regions</option>
            {(statsData?.regions ?? []).map((r) => <option key={r.region} value={r.region}>{regionOptionLabel(r.region, r.count, home)}</option>)}
          </select>
        </label>
        <label htmlFor={id('env')} className={labelClass}>Environment
          <select id={id('env')} value={filters.env} onChange={(e) => onFilters({ env: e.target.value })} className={selectClass}>
            <option value="all">All environments</option>
            <option value="production">Production</option>
            <option value="staging">Staging</option>
            <option value="untagged">Untagged</option>
          </select>
        </label>
        <label htmlFor={id('team')} className={labelClass}>Owner / team
          <select id={id('team')} ref={teamSelectRef} value={filters.team} onChange={(e) => onFilters({ team: e.target.value })} className={selectClass}>
            <option value="">Everyone</option>
            {(teams?.all ?? []).map((t) => <option key={t.team} value={t.team}>{`${t.team} (${t.count})`}</option>)}
            {moreTeams > 0 && <option disabled value="__more">{`${moreTeams} more ${moreTeams === 1 ? 'team' : 'teams'} not listed`}</option>}
          </select>
        </label>
        <label htmlFor={id('show')} className={labelClass}>Show
          <select id={id('show')} value={filters.show} onChange={(e) => onFilters({ show: e.target.value as ShowFilter })} className={selectClass}>
            {showOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-pressed={filters.env === 'production'}
          onClick={() => onFilters({ env: filters.env === 'production' ? 'all' : 'production' })}
          className={`min-h-[34px] rounded-full border px-3 text-xs font-semibold ${filters.env === 'production' ? 'border-violet-700 bg-violet-700 text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'}`}
        >
          Production
        </button>
        <div role="group" aria-label="Group by" className="ml-auto flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
          <span aria-hidden="true">Group by</span>
          <button type="button" aria-pressed="true" className="rounded-lg border border-violet-300 bg-violet-50 px-2.5 py-1 font-semibold text-violet-900">Resource</button>
          <button type="button" disabled className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-semibold text-slate-700 opacity-60 cursor-not-allowed">Service</button>
          <PhaseTwoTag />
        </div>
        </div>
      </div>
      {body}
    </section>
  )
}
