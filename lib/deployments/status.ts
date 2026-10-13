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
  total_cost: number
  /** Most recent finished deployment, regardless of the window. */
  last_deployment: { status: string; deployed_at: string } | null
}

export type StatsWindow = '7d' | '30d' | '90d'

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
  deployments: Pick<RecordedDeployment, 'status' | 'createdAt' | 'deployedAt' | 'costEstimate'>[],
  windowDays: number,
  now: Date = new Date()
): DeploymentStats {
  const stats: DeploymentStats = {
    window_days: windowDays, total: 0, success: 0, failed: 0, in_progress: 0,
    no_completion_recorded: 0, unknown: 0, change_failure_rate: null, total_cost: 0, last_deployment: null,
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
    stats.total_cost += d.costEstimate || 0
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
