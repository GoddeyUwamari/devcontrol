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

export interface GitHubRepository {
  id: string
  github_repo_id: string
  installation_id: string | null
  full_name: string
  service_id: string | null
  service_name: string | null
  deploy_rule: { mode?: string } | null
  access_state: 'active' | 'removed' | string
  removed_at: string | null
  last_event_at: string | null
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

  async repositories(): Promise<GitHubRepository[]> {
    const res = await api.get<{ success: boolean; data: { repositories: GitHubRepository[] } }>('/api/integrations/github/repositories')
    const list = res.data?.data?.repositories
    if (!Array.isArray(list)) throw new Error('The GitHub repositories response was not a list')
    return list
  },

  startInstall: () => answer(api.post('/api/integrations/github/install', {}, ANSWER_EVERY_STATUS)),

  claim: (body: { state: string; code?: string; installation_id?: string; setup_action?: string }) =>
    answer(api.post('/api/integrations/github/claim', body, ANSWER_EVERY_STATUS)),

  retryClaim: (state: string) => answer(api.post('/api/integrations/github/claim/retry', { state }, ANSWER_EVERY_STATUS)),

  disconnect: (installationId: string) =>
    answer(api.delete(`/api/integrations/github/installations/${encodeURIComponent(installationId)}`, ANSWER_EVERY_STATUS)),
}
