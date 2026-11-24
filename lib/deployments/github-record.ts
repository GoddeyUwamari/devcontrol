/**
 * A deployment row the GitHub App recorded (D8a-2 metadata, read back for the
 * detail page in D8b-2): the frontend twin of the backend's
 * readPipelineMetadata. Only stored values; nothing is guessed, and an unknown
 * value is "—" (founder ruling R10).
 */

export const UNKNOWN = '—'

export type GitHubRecordSource = 'github_actions' | 'github_deployments'

export interface GitHubRecordDetail {
  source: GitHubRecordSource
  /** "Recorded from GitHub Actions" / "Recorded from GitHub Deployments": always the row's own stored source. */
  sourceLabel: string
  repository: string
  commit: string
  /** The full SHA, for a title attribute; null when none was stored. */
  commitFull: string | null
  /** "Job" for workflow-job rows, "Environment" for deployment rows. */
  targetLabel: 'Job' | 'Environment'
  target: string
  started: string
  duration: string
  /** The stored GitHub URL (job rows only); null when none was stored. */
  url: string | null
}

type Obj = Record<string, unknown>
const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/
const str = (x: unknown): string | null => (typeof x === 'string' && x.trim() !== '' ? x : null)

export function isGitHubAppRecord(metadata: unknown): boolean {
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) return false
  const m = metadata as Obj
  return m.connection === 'github_app' && m.pipeline_metadata_version === 1
    && (m.source === 'github_actions' || m.source === 'github_deployments')
}

/** "4m 12s", "38s", "1h 5m". */
export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

/** A stored URL on github.com over https, or null (never a link we built). */
function githubUrl(x: unknown): string | null {
  const v = str(x)
  if (!v) return null
  try {
    const u = new URL(v)
    return u.protocol === 'https:' && u.hostname === 'github.com' ? u.toString() : null
  } catch {
    return null
  }
}

export function githubRecordDetail(
  deployment: { metadata?: Record<string, unknown> | null; deployedAt: string },
  repositoryName: string | null | undefined,
  locale?: string,
): GitHubRecordDetail | null {
  if (!isGitHubAppRecord(deployment.metadata)) return null
  const m = deployment.metadata as Obj
  const sha = typeof m.head_sha === 'string' && SHA.test(m.head_sha) ? m.head_sha : null
  const common = {
    repository: repositoryName && repositoryName.trim() ? repositoryName : UNKNOWN,
    commit: sha ? sha.slice(0, 7) : UNKNOWN,
    commitFull: sha,
  }
  if (m.source === 'github_actions') {
    const workflow = str(m.workflow_name)
    const job = str(m.job_name)
    const startedAt = typeof m.job_started_at === 'string' && ISO.test(m.job_started_at) ? m.job_started_at : null
    const start = startedAt ? Date.parse(startedAt) : NaN
    const end = Date.parse(deployment.deployedAt)
    const known = Number.isFinite(start) && Number.isFinite(end) && end >= start
    return {
      ...common,
      source: 'github_actions',
      sourceLabel: 'Recorded from GitHub Actions',
      targetLabel: 'Job',
      target: workflow && job ? `${workflow} › ${job}` : job ?? workflow ?? UNKNOWN,
      started: startedAt ? new Date(startedAt).toLocaleString(locale) : UNKNOWN,
      duration: known ? formatDuration(end - start) : UNKNOWN,
      url: githubUrl(m.html_url),
    }
  }
  return {
    ...common,
    source: 'github_deployments',
    sourceLabel: 'Recorded from GitHub Deployments',
    targetLabel: 'Environment',
    target: str(m.github_environment) ?? UNKNOWN,
    // GitHub's deployment events carry no start time and no page URL that DevControl stores.
    started: UNKNOWN,
    duration: UNKNOWN,
    url: null,
  }
}
