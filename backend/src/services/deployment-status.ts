/**
 * What a deployments.status value means.
 *
 * The only writers are the GitHub deploy webhook ('success' / 'failed') and
 * POST /api/deployments ('deploying'). Nothing ever updates a row, so a
 * 'deploying' row is in progress only while it is recent; after that there is
 * simply no completion on record. Every other value (including the legacy
 * 'running' / 'stopped' of seed data) is unknown -- never guessed at.
 *
 * Only 'success' and 'failed' are finished deployments: they alone count
 * towards deployment frequency and change failure rate.
 */
export type DeploymentOutcome =
  | 'success'
  | 'failed'
  | 'in_progress'
  | 'no_completion_recorded'
  | 'unknown';

/** A 'deploying' row older than this has no completion on record. */
export const IN_PROGRESS_MAX_AGE_HOURS = 2;

export function classifyDeploymentStatus(
  status: unknown,
  createdAt: Date | string | null | undefined,
  now: Date = new Date()
): DeploymentOutcome {
  if (status === 'success') return 'success';
  if (status === 'failed') return 'failed';
  if (status !== 'deploying') return 'unknown';

  const created = createdAt == null ? NaN : new Date(createdAt).getTime();
  if (Number.isNaN(created)) return 'no_completion_recorded';
  const ageHours = (now.getTime() - created) / 3_600_000;
  return ageHours < IN_PROGRESS_MAX_AGE_HOURS ? 'in_progress' : 'no_completion_recorded';
}

/**
 * Failed deployments as a percentage of finished (success + failed)
 * deployments, to one decimal place. Null when nothing finished: there is no
 * rate to report, and 0% would claim a clean record that was never measured.
 */
export function changeFailureRate(success: number, failed: number): number | null {
  const finished = success + failed;
  if (finished <= 0) return null;
  return Math.round((failed / finished) * 1000) / 10;
}

export const STATS_WINDOW_DAYS = { '7d': 7, '30d': 30, '90d': 90 } as const;
export type StatsWindow = keyof typeof STATS_WINDOW_DAYS;

export function isStatsWindow(value: unknown): value is StatsWindow {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STATS_WINDOW_DAYS, value);
}
