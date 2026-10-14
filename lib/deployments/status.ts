import type { Deployment } from '../types'

/**
 * What a recorded deployment status means, and how it is shown.
 *
 * The only writers are the CI deploy webhook ('success' / 'failed') and the
 * New Deployment form ('deploying'). Nothing updates a row afterwards, so a
 * 'deploying' row is in progress only while it is recent; after that there is
 * simply no completion on record. Every other value (including the legacy
 * 'running' / 'stopped') is shown as Unknown -- never as another state.
 *
 * Mirrors backend/src/services/deployment-status.ts.
 */
export type DeploymentOutcome =
  | 'success'
  | 'failed'
  | 'in_progress'
  | 'no_completion_recorded'
  | 'unknown'

/** A 'deploying' row older than this has no completion on record. */
export const IN_PROGRESS_MAX_AGE_HOURS = 2

/** A deployment as the API returns it: status is whatever was recorded. */
export type RecordedDeployment = Omit<Deployment, 'status'> & { status: string }

export function classifyDeploymentStatus(
  status: unknown,
  createdAt: string | Date | null | undefined,
  now: Date = new Date()
): DeploymentOutcome {
  if (status === 'success') return 'success'
  if (status === 'failed') return 'failed'
  if (status !== 'deploying') return 'unknown'

  const created = createdAt == null ? NaN : new Date(createdAt).getTime()
  if (Number.isNaN(created)) return 'no_completion_recorded'
  const ageHours = (now.getTime() - created) / 3_600_000
  return ageHours < IN_PROGRESS_MAX_AGE_HOURS ? 'in_progress' : 'no_completion_recorded'
}

export interface DeploymentStatusDisplay {
  outcome: DeploymentOutcome
  label: string
  color: string
  background: string
}

const OUTCOME_DISPLAY: Record<DeploymentOutcome, Omit<DeploymentStatusDisplay, 'outcome'>> = {
  success:                { label: 'Succeeded',               color: '#059669', background: '#F0FDF4' },
  failed:                 { label: 'Failed',                  color: '#DC2626', background: '#FEF2F2' },
  in_progress:            { label: 'In progress',             color: '#D97706', background: '#FFFBEB' },
  no_completion_recorded: { label: 'No completion recorded',  color: '#64748B', background: '#F8FAFC' },
  unknown:                { label: 'Unknown',                 color: '#64748B', background: '#F8FAFC' },
}

export function deploymentStatusDisplay(
  status: unknown,
  createdAt: string | Date | null | undefined,
  now: Date = new Date()
): DeploymentStatusDisplay {
  const outcome = classifyDeploymentStatus(status, createdAt, now)
  return { outcome, ...OUTCOME_DISPLAY[outcome] }
}

/** GET /api/deployments/stats: one organization's counts for one window. */
export interface DeploymentStats {
  window_days: number
  total: number
  success: number
  failed: number
  in_progress: number
  no_completion_recorded: number
  unknown: number
  /** failed / (success + failed) as a percentage; null when nothing finished. */
  change_failure_rate: number | null
  /**
   * Whether the organization has any deployment at all, in any environment
   * or window: what separates "nothing matches these filters" from "nothing
   * has ever been recorded".
   */
  organization_has_deployments: boolean
  /** Most recent finished deployment, regardless of the window. */
  last_deployment: { status: string; deployed_at: string } | null
}

export type StatsWindow = '7d' | '30d' | '90d'

/** Page sizes GET /api/deployments accepts. */
export const PAGE_SIZES = [25, 50, 100] as const
export type PageSize = typeof PAGE_SIZES[number]
export const DEFAULT_PAGE_SIZE: PageSize = 25

/** One page of the deployment log, with the total its filters select. */
export interface DeploymentPage {
  deployments: RecordedDeployment[]
  total: number
  limit: number
  offset: number
}

/**
 * The cost recorded for a deployment, or null when none was. Nothing records
 * a cost today: rows hold NULL, or the 0.00 older rows were given by default,
 * and neither is a cost of $0.00.
 */
export function recordedCost(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const cost = typeof value === 'number' ? value : parseFloat(String(value))
  return Number.isFinite(cost) && cost > 0 ? cost : null
}

/** "$12.50", or a dash when no cost was recorded -- never "$0.00". */
export function formatRecordedCost(value: unknown): string {
  const cost = recordedCost(value)
  return cost === null ? '—' : `$${cost.toFixed(2)}`
}

/** Whether any of the rows in view has a recorded cost (else the column is hidden). */
export function anyRecordedCost(deployments: { costEstimate?: unknown }[]): boolean {
  return deployments.some(d => recordedCost(d.costEstimate) !== null)
}

/**
 * Page numbers to offer: first, last, and those around the current one, with
 * 'gap' where numbers are skipped. Pages are 1-based.
 */
export function pageNumbers(current: number, pageCount: number): (number | 'gap')[] {
  const wanted = new Set<number>([1, pageCount, current - 1, current, current + 1])
  const pages = [...wanted].filter(p => p >= 1 && p <= pageCount).sort((a, b) => a - b)
  const out: (number | 'gap')[] = []
  pages.forEach((p, i) => {
    if (i > 0 && p - pages[i - 1] > 1) out.push(p - pages[i - 1] === 2 ? p - 1 : 'gap')
    out.push(p)
  })
  return out
}

/**
 * Failed deployments as a percentage of finished (success + failed) ones, to
 * one decimal place. Null when nothing finished.
 */
export function changeFailureRate(success: number, failed: number): number | null {
  const finished = success + failed
  if (finished <= 0) return null
  return Math.round((failed / finished) * 1000) / 10
}

export function formatChangeFailureRate(rate: number | null | undefined): string {
  return rate == null ? '—' : `${rate}%`
}

/** The same counts the stats endpoint returns, from a list of deployments. */
export function summarizeDeployments(
  deployments: Pick<RecordedDeployment, 'status' | 'createdAt' | 'deployedAt'>[],
  windowDays: number,
  now: Date = new Date()
): DeploymentStats {
  const stats: DeploymentStats = {
    window_days: windowDays, total: 0, success: 0, failed: 0, in_progress: 0,
    no_completion_recorded: 0, unknown: 0, change_failure_rate: null,
    organization_has_deployments: deployments.length > 0, last_deployment: null,
  }
  const since = now.getTime() - windowDays * 24 * 3_600_000
  for (const d of deployments) {
    const outcome = classifyDeploymentStatus(d.status, d.createdAt, now)
    const deployedAt = new Date(d.deployedAt).getTime()
    if (
      (outcome === 'success' || outcome === 'failed') &&
      (!stats.last_deployment || deployedAt > new Date(stats.last_deployment.deployed_at).getTime())
    ) {
      stats.last_deployment = { status: d.status, deployed_at: d.deployedAt }
    }
    if (!(deployedAt >= since)) continue
    stats.total += 1
    stats[outcome] += 1
  }
  stats.change_failure_rate = changeFailureRate(stats.success, stats.failed)
  return stats
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * One-paragraph summary built only from the recorded counts. Deterministic
 * text -- not model output.
 */
export function deploymentSummaryText(stats: DeploymentStats): string {
  const window = `the last ${stats.window_days} days`
  const finished = stats.success + stats.failed
  const parts: string[] = []

  if (stats.total === 0) {
    parts.push(`No deployments were recorded in ${window}.`)
  } else if (finished === 0) {
    parts.push(`No deployments finished in ${window}.`)
  } else {
    parts.push(
      `${stats.success} of ${plural(finished, 'finished deployment', 'finished deployments')} in ${window} succeeded and ${stats.failed} failed` +
      ` (change failure rate ${formatChangeFailureRate(stats.change_failure_rate)}).`
    )
  }
  if (stats.in_progress > 0) parts.push(`${plural(stats.in_progress, 'is', 'are')} in progress.`)
  if (stats.no_completion_recorded > 0) {
    parts.push(`${plural(stats.no_completion_recorded, 'has', 'have')} no completion recorded.`)
  }
  if (stats.unknown > 0) parts.push(`${plural(stats.unknown, 'has', 'have')} an unrecognised status.`)
  return parts.join(' ')
}
