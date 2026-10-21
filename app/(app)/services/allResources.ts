/**
 * The All resources list (Phase 1, PR S1-D): its filters, the GET /api/services
 * request they make (S1-A's opt-in params), and the titles of its empty
 * states. Pure, so every filter → query rule is tested without rendering.
 */
import type { AWSService, AWSServicesPage, AWSServicesPageRequest } from '@/lib/services/aws-services.service'
import { TYPE_DISPLAY } from './resourceTypes'

/** Rows per page. The server caps a page at 100. */
export const ALL_RESOURCES_PAGE_SIZE = 50

/** The API rejects a tag search longer than this (MAX_TAG_SEARCH_LENGTH). */
export const MAX_SEARCH_LENGTH = 200

export type ShowFilter = 'all' | 'needs_attention' | 'unowned' | 'unknown'

export interface AllResourcesFilters {
  /** The committed (debounced) search. */
  search: string
  type: string
  /** 'all' or an aws_resources.region value from /stats. */
  region: string
  /** 'all' | 'production' | 'staging' | 'untagged' */
  env: string
  /** '' = every team ("Everyone"): never sent. */
  team: string
  show: ShowFilter
}

export const DEFAULT_FILTERS: AllResourcesFilters = { search: '', type: 'all', region: 'all', env: 'all', team: '', show: 'all' }

/**
 * The list request for one page. Always the attention order (Q20). The
 * search also matches tags; "Untagged" leaves out resources whose tags could
 * not be read (Q22); "Everyone" sends no team (an empty ?team is a 400).
 */
export function allResourcesRequest(filters: AllResourcesFilters, page: number): AWSServicesPageRequest {
  const request: AWSServicesPageRequest = { sort: 'attention', page, limit: ALL_RESOURCES_PAGE_SIZE }
  const search = filters.search.trim()
  if (search) { request.search = search; request.search_tags = true }
  if (filters.type !== 'all') request.type = filters.type
  if (filters.region !== 'all') request.region = filters.region
  if (filters.env !== 'all') {
    request.env = filters.env
    if (filters.env === 'untagged') request.tags_known = true
  }
  if (filters.team.trim()) request.team = filters.team.trim()
  if (filters.show === 'needs_attention') request.needs_attention = true
  if (filters.show === 'unowned' || filters.show === 'unknown') request.ownership = filters.show
  return request
}

export function hasActiveFilter(filters: AllResourcesFilters): boolean {
  return filters.search.trim() !== '' || filters.type !== 'all' || filters.region !== 'all'
    || filters.env !== 'all' || filters.team.trim() !== '' || filters.show !== 'all'
}

/**
 * Whether the list's counts cover less than the whole inventory. The counts
 * ignore needs_attention (they split the set by it), so Show = Needs attention
 * alone does not narrow them.
 */
export function countsAreNarrowed(filters: AllResourcesFilters): boolean {
  return hasActiveFilter({ ...filters, show: filters.show === 'needs_attention' ? 'all' : filters.show })
}

/** The "no flagged issues" count is hidden in the needs-only view: every listed row is flagged. */
export function showsNoFlaggedLine(filters: AllResourcesFilters): boolean {
  return filters.show !== 'needs_attention'
}

/** Show = Needs attention with nothing else set: an empty result is good news (E30). */
export function isPositiveEmpty(filters: AllResourcesFilters): boolean {
  return filters.show === 'needs_attention' && !hasActiveFilter({ ...filters, show: 'all' })
}

/** The filter-miss title (E31 pattern; the new filters' titles per Q13). */
export function filterMissTitle(filters: AllResourcesFilters): string {
  const search = filters.search.trim()
  if (filters.show === 'needs_attention') return 'No resources that need attention match these filters'
  if (filters.show === 'unowned') return 'No unowned resources match these filters'
  if (filters.show === 'unknown') return 'No resources with unknown owner match these filters'
  if (filters.type !== 'all') return `No ${TYPE_DISPLAY[filters.type] ?? filters.type} resources found`
  if (filters.region !== 'all') return `No resources in ${filters.region}`
  if (filters.team.trim()) return `No resources owned by ${filters.team.trim()}`
  if (search) return `No resources match "${search}"`
  if (filters.env !== 'all') return `No ${filters.env} resources found`
  return 'No resources match these filters'
}

/** The Region filter's option text: the stored region and how many resources are there. */
export function regionOptionLabel(region: string, count: number, homeRegion: string | null): string {
  const what = region === 'global' ? 'global, CloudFront' : region === homeRegion ? `${region}, home` : region
  return `${what} (${count})`
}

const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }

/**
 * Demo mode: one page of the placeholder fixture with the filters applied the
 * way the API applies them, so the demo never makes a request.
 */
export function demoAllResourcesPage(rows: AWSService[], filters: AllResourcesFilters, page: number): AWSServicesPage {
  const search = filters.search.trim().toLowerCase()
  const team = filters.team.trim().toLowerCase()
  const env = filters.env.toLowerCase()
  const matching = rows.filter((r) => {
    if (filters.type !== 'all' && r.type !== filters.type) return false
    if (filters.region !== 'all' && r.aws_region !== filters.region) return false
    if (env === 'untagged' ? (r.environment !== null || r.ownership === 'unknown') : env !== 'all' && r.environment?.toLowerCase() !== env) return false
    if (team && (r.ownership === 'unknown' || r.team?.toLowerCase() !== team)) return false
    if ((filters.show === 'unowned' || filters.show === 'unknown') && r.ownership !== filters.show) return false
    if (search && !r.name.toLowerCase().includes(search) && !r.id.toLowerCase().includes(search)) return false
    return true
  })
  const needs = matching.filter((r) => r.needs_attention)
  const selected = (filters.show === 'needs_attention' ? needs : matching).slice().sort((a, b) => {
    const ra = a.needs_attention ? SEVERITY_RANK[a.priority_severity ?? 'low'] : 4
    const rb = b.needs_attention ? SEVERITY_RANK[b.priority_severity ?? 'low'] : 4
    return ra - rb || a.name.localeCompare(b.name, 'en') || (a.id < b.id ? -1 : 1)
  })
  const limit = ALL_RESOURCES_PAGE_SIZE
  const total = selected.length
  return {
    services: selected.slice((page - 1) * limit, page * limit),
    pagination: { page, limit, total, total_pages: Math.ceil(total / limit), has_more: page * limit < total },
    counts: { needs_attention: needs.length, no_flagged_issues: matching.length - needs.length },
  }
}
