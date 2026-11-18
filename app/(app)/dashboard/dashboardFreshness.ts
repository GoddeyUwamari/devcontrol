/**
 * The Dashboard's time lines (PR-UI-b): the header's "Last scan · Last login",
 * the DevControl service status card, and the "Data freshness" row. Every time
 * comes from data the page already loaded; a part with no source is left out,
 * never filled with the page-load time. Pure, so it is tested without a render.
 *
 * Lives in its own module (not exported from page.tsx) because Next.js's App
 * Router only permits a fixed set of named exports from a page file.
 */
import type { CostSummary, SystemHealth } from '@/lib/types'
import type { ServicesCoverage } from '@/lib/services/aws-services.service'
import { formatLocalWhen } from '@/lib/utils/localTime'
import { lastScanFinishedPhrase, scanState } from '../services/servicesTruth'
import { billedThroughInPeriod, NO_BILLED_DAYS_YET, shortDay } from '../costs/cost-display'

// ── Header ──

/**
 * "Last scan finished today, 6:02 PM · Last login: yesterday, 9:14 AM". The
 * scan part is the Services page's header line (servicesTruth scanState, PR
 * 3d-1 D3: running, failed or didn't finish, finished, none), from the same
 * coverage response; it is left out while coverage loads or failed. The login part is the previous sign-in only (/me previousLoginAt):
 * null or absent leaves it out, and the current sign-in is never used.
 */
export function headerStatusLine(i: {
  coverage: ServicesCoverage | undefined
  previousLoginAt: string | null | undefined
  now: number
}): string | null {
  const parts: string[] = []
  const scan = i.coverage ? scanState(i.coverage, i.now) : null
  if (scan) parts.push(scan.text)
  const login = typeof i.previousLoginAt === 'string' ? formatLocalWhen(i.previousLoginAt, i.now) : null
  if (login) parts.push(`Last login: ${login}`)
  return parts.length > 0 ? parts.join(' · ') : null
}

// ── DevControl service status (DB-D7) ──

export type ServiceStatusState = 'operational' | 'degraded' | 'unavailable' | 'checking'

export interface ServiceStatusView {
  state: ServiceStatusState
  value: string
  caption: string
  color: string
}

export const SERVICE_STATUS_COPY = {
  operational: "DevControl's API and database are responding. This is our service, not your AWS resources.",
  degraded: 'Some DevControl services are slow or failing. Figures on this page may be delayed.',
  unavailable: "Can't reach DevControl's API right now. Figures on this page may be out of date.",
  checking: "Checking DevControl's own service status.",
} as const

/**
 * The /health check's result: operational; degraded only when the API answered
 * 500 with its database disconnected (monitoring.service); unavailable for a
 * timeout, network error or any other failure; checking until a check has
 * returned. "Checked <time>" is the check's own time (lastUpdate).
 */
export function serviceStatusView(health: Pick<SystemHealth, 'status' | 'lastUpdate'> | undefined, now: number, isDemoActive = false): ServiceStatusView {
  if (isDemoActive || health?.status === 'operational') {
    const checked = isDemoActive ? null : formatLocalWhen(health?.lastUpdate, now)
    return {
      state: 'operational', value: 'Operational',
      caption: `${SERVICE_STATUS_COPY.operational}${checked ? ` · Checked ${checked}` : ''}`,
      color: 'var(--text-success)',
    }
  }
  if (health?.status === 'degraded') {
    return { state: 'degraded', value: 'Degraded', caption: SERVICE_STATUS_COPY.degraded, color: 'var(--text-warning)' }
  }
  if (health?.status === 'disrupted') {
    return { state: 'unavailable', value: 'Unavailable', caption: SERVICE_STATUS_COPY.unavailable, color: 'var(--text-danger)' }
  }
  return { state: 'checking', value: 'Checking…', caption: SERVICE_STATUS_COPY.checking, color: 'var(--text-secondary)' }
}

// ── Data freshness (DAY1-D8, DB-D9, DB-D10) ──

export interface FreshnessSegment { key: 'costs' | 'resources' | 'alerts' | 'service'; label: string; text: string }

/** The discovery job's interval (resourceDiscovery.job.ts `0 *\/6 * * *`), never a clock time. */
export const SCAN_CADENCE = 'every 6 hours'

/**
 * One segment per source that has a time:
 * - Costs: billed AWS Cost Explorer month to date only; "billed through" is
 *   Cost Explorer's own evidence (monthState.billedThrough) inside the current
 *   period (DAY1-D8, which replaces DB-D6's calendar finishedThrough); "no
 *   billed days yet this month" only in the month state no_billed_days_yet;
 *   any other missing evidence leaves the part out (F-1, as the Services
 *   tile). "refreshed" is the Cost Explorer read (asOf). No cadence: the
 *   4-hour cache is not a schedule.
 * - Resources and security: "last scan finished {when}" (PR 3d-1, D3), plus
 *   "every 6 hours" unless the region list is stale or the latest attempt
 *   didn't finish (DB-D10; the shared scan state's failed / didn't finish).
 * - Alerts: Resource checks' CloudWatch capturedAt, once that section has loaded (DB-D9).
 * - DevControl service: the last /health check.
 */
export function dataFreshnessSegments(i: {
  costSummary: CostSummary | undefined
  costSummaryError: boolean
  coverage: ServicesCoverage | undefined
  cloudwatchCapturedAt: number | null
  serviceCheckedAt: string | null | undefined
  now: number
}): FreshnessSegment[] {
  const segments: FreshnessSegment[] = []

  // DAY1-D8 (founder, 2026-11-15; replaces DB-D6): "billed through" is only
  // Cost Explorer's evidence inside the current period, never the calendar
  // finishedThrough (a day of the previous month on days 1-2). "No billed days
  // yet this month" only when the backend's month state says so (F-1,
  // founder 2026-11-15). Evidence missing for any other reason (the daily
  // request failed, a backend without a month state, a stale daily cache) is
  // not "no billed days": the part is left out, as on the Services tile.
  const section = i.costSummary?.spend
  const billed = !i.costSummaryError && !!section?.data && (section.state === 'available' || section.state === 'partial')
    && section.provenance === 'actual' && section.data.basis === 'billed_month_to_date'
  if (billed) {
    const billedThrough = billedThroughInPeriod(section)
    const noBilledDays = section?.data?.monthState?.state === 'no_billed_days_yet'
    const part = billedThrough ? `billed through ${shortDay(billedThrough)}` : noBilledDays ? NO_BILLED_DAYS_YET : null
    const refreshed = formatLocalWhen(i.costSummary?.spend.asOf, i.now)
    // A source with no time at all (no evidence, no Cost Explorer read time) still has no segment.
    if (billedThrough || refreshed) {
      const source = `AWS Cost Explorer${part ? `, ${part}` : ''}`
      segments.push({ key: 'costs', label: 'Costs', text: refreshed ? `${source} · refreshed ${refreshed}` : source })
    }
  }

  const scanned = i.coverage ? lastScanFinishedPhrase(i.coverage, i.now) : null
  if (i.coverage && scanned) {
    const onSchedule = !i.coverage.scope.enabled_regions.stale && scanState(i.coverage, i.now).state !== 'failed'
    segments.push({ key: 'resources', label: 'Resources and security', text: `${scanned}${onSchedule ? ` · ${SCAN_CADENCE}` : ''}` })
  }

  const alerts = i.cloudwatchCapturedAt === null ? null : formatLocalWhen(i.cloudwatchCapturedAt, i.now)
  if (alerts) segments.push({ key: 'alerts', label: 'Alerts', text: `CloudWatch · checked ${alerts}` })

  const service = formatLocalWhen(i.serviceCheckedAt, i.now)
  if (service) segments.push({ key: 'service', label: 'DevControl service', text: `checked ${service}` })

  return segments
}
