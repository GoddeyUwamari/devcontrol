import api from '../api'

/**
 * /api/integrations/github (D8a routes, D8b-1 additions). The claim, retry,
 * install and disconnect calls return every HTTP answer as data (status +
 * body), never a thrown error, so the GitHub page maps each code to its own
 * screen. A network failure is status 0.
 */

export interface PermissionDifference {
  permission: string
  /** null: the app has no access to it on GitHub. */
  granted: string | null
  /** null: DevControl doesn't ask for it. */
  expected: 'read' | null
}

export interface GitHubInstallation {
  installation_id: string
  account_login: string
  account_type: 'User' | 'Organization' | 'Enterprise' | string
  repository_selection: 'all' | 'selected' | string
  permissions_state: 'expected' | 'mismatch' | string
  permission_differences: PermissionDifference[]
  claimed_at: string
  claimed_by_name: string | null
  suspended_at: string | null
  deleted_at: string | null
}

export type GitHubConnection =
  | { configured: false }
  | {
      configured: true
      can_manage: boolean
      demo: boolean
      installations: GitHubInstallation[]
      last_event_at: string | null
    }

/** A deploy rule as stored (D8a-2 `{ v: 1, mode, ... }`); only the fields the screen reads. */
export interface StoredDeployRule {
  v?: number
  mode?: string
  workflow_name?: string
  job_name?: string
  branch?: string
  branch_name?: string | null
  /** D8b-2 (R2): one GitHub environment. Absent on rules that record every known name. */
  environment_name?: string
  environment_map?: Record<string, string>
}

export interface GitHubRepository {
  id: string
  github_repo_id: string
  installation_id: string | null
  full_name: string
  service_id: string | null
  service_name: string | null
  deploy_rule: StoredDeployRule | null
  access_state: 'accessible' | 'removed' | string
  removed_at: string | null
  last_event_at: string | null
  /** D8b-2: events a mapping or rule would pick up next, last held_event_days days (0 once both exist). */
  held_events: number
  /** D8b-2: GitHub environment names seen on deployment events (30 days). */
  environments_seen: string[]
  /** D8b-2: workflow + job names seen on completed jobs (30 days). */
  jobs_seen: { workflow_name: string; job_name: string }[]
  /** D8b-2: newest deployment recorded from this repository, or null. */
  last_deployment_at: string | null
  /** D8b-2: deployments refused this month because the plan's monthly limit was reached. */
  over_limit_this_month: number
}

export interface GitHubRepositoryList {
  repositories: GitHubRepository[]
  /** How long held events are picked up (the server's HELD_EVENT_DAYS); null if the server didn't say. */
  held_event_days: number | null
}

/** The body of PUT /repositories/:id/deploy-rule that the screen sends (R2, R3: branch and environment use the server defaults). */
export type DeployRuleRequest =
  | { mode: 'job'; workflow_name: string; job_name: string }
  | { mode: 'github_deployments'; environment_name: string }

/** A repository row as received, with D8b-2's fields defaulted so an older server never breaks the table. */
function parseRepository(raw: Record<string, unknown>): GitHubRepository {
  const r = raw as unknown as GitHubRepository
  const count = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0)
  return {
    ...r,
    held_events: count(raw.held_events),
    environments_seen: Array.isArray(raw.environments_seen) ? raw.environments_seen.filter((e): e is string => typeof e === 'string') : [],
    jobs_seen: Array.isArray(raw.jobs_seen)
      ? (raw.jobs_seen as { workflow_name?: unknown; job_name?: unknown }[])
        .filter((j) => typeof j?.workflow_name === 'string' && typeof j?.job_name === 'string') as GitHubRepository['jobs_seen']
      : [],
    last_deployment_at: typeof raw.last_deployment_at === 'string' ? raw.last_deployment_at : null,
    over_limit_this_month: count(raw.over_limit_this_month),
  }
}

export interface ApiAnswer {
  status: number
  body: { success?: boolean; error?: string; message?: string; data?: Record<string, unknown> } | null
}

const ANSWER_EVERY_STATUS = { validateStatus: () => true }

async function answer(request: Promise<{ status: number; data: unknown }>): Promise<ApiAnswer> {
  try {
    const res = await request
    const body = res.data && typeof res.data === 'object' ? (res.data as ApiAnswer['body']) : null
    return { status: res.status, body }
  } catch {
    return { status: 0, body: null }
  }
}

function parseConnection(data: unknown): GitHubConnection {
  const d = (data ?? {}) as Record<string, unknown>
  if (d.configured === false) return { configured: false }
  if (d.configured !== true || !Array.isArray(d.installations)) throw new Error('The GitHub connection response was not recognized')
  return {
    configured: true,
    can_manage: d.can_manage === true,
    demo: d.demo === true,
    installations: d.installations as GitHubInstallation[],
    last_event_at: typeof d.last_event_at === 'string' ? d.last_event_at : null,
  }
}

export const githubConnectionService = {
  async get(): Promise<GitHubConnection> {
    const res = await api.get<{ success: boolean; data: unknown }>('/api/integrations/github')
    return parseConnection(res.data?.data)
  },

  async repositories(): Promise<GitHubRepositoryList> {
    const res = await api.get<{ success: boolean; data: { repositories: unknown; held_event_days?: unknown } }>('/api/integrations/github/repositories')
    const list = res.data?.data?.repositories
    if (!Array.isArray(list)) throw new Error('The GitHub repositories response was not a list')
    const days = res.data?.data?.held_event_days
    return {
      repositories: list.map((r) => parseRepository(r as Record<string, unknown>)),
      held_event_days: typeof days === 'number' && Number.isInteger(days) && days > 0 ? days : null,
    }
  },

  /** D8b-2: map a repository to one of the workspace's services, or unmap it (null). */
  setService: (repositoryId: string, serviceId: string | null) =>
    answer(api.put(`/api/integrations/github/repositories/${encodeURIComponent(repositoryId)}/service`, { service_id: serviceId }, ANSWER_EVERY_STATUS)),

  /** D8b-2: the repository's deploy rule. */
  setDeployRule: (repositoryId: string, rule: DeployRuleRequest) =>
    answer(api.put(`/api/integrations/github/repositories/${encodeURIComponent(repositoryId)}/deploy-rule`, rule, ANSWER_EVERY_STATUS)),

  startInstall: () => answer(api.post('/api/integrations/github/install', {}, ANSWER_EVERY_STATUS)),

  claim: (body: { state: string; code?: string; installation_id?: string; setup_action?: string }) =>
    answer(api.post('/api/integrations/github/claim', body, ANSWER_EVERY_STATUS)),

  retryClaim: (state: string) => answer(api.post('/api/integrations/github/claim/retry', { state }, ANSWER_EVERY_STATUS)),

  disconnect: (installationId: string) =>
    answer(api.delete(`/api/integrations/github/installations/${encodeURIComponent(installationId)}`, ANSWER_EVERY_STATUS)),
}
