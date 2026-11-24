/**
 * Pure rules of the GitHub connection screens (D8b-1): the index card's
 * state, each installation's problem banners, and how a claim answer maps to
 * a board 4 outcome. No rendering, so each rule is tested on its own.
 */
import type { ApiAnswer, GitHubConnection, GitHubInstallation, GitHubRepository } from '../services/github-connection.service'

export type CardState = 'off' | 'not_connected' | 'connected' | 'attention' | 'demo'

/** An installation needs attention when it is uninstalled, suspended or its permissions differ. */
export function needsAttention(installation: GitHubInstallation): boolean {
  return installation.deleted_at !== null || installation.suspended_at !== null || installation.permissions_state === 'mismatch'
}

/** The index card's state (board 1): switched off, not connected, connected, needs attention; demo shows the sample. */
export function cardState(connection: GitHubConnection): CardState {
  if (!connection.configured) return 'off'
  if (connection.demo) return 'demo'
  if (connection.installations.length === 0) return 'not_connected'
  return connection.installations.some(needsAttention) ? 'attention' : 'connected'
}

/** Repositories still linked to an installation (a disconnected one's are hidden). */
export function linkedRepositories(repositories: readonly GitHubRepository[]): GitHubRepository[] {
  return repositories.filter((r) => r.installation_id !== null)
}

/**
 * "Recording": a linked repository with access, a service and a deploy rule
 * other than "Don't record deploys". Nothing about whether a deploy was recorded yet.
 */
export function isRecording(repository: GitHubRepository): boolean {
  return (
    repository.installation_id !== null &&
    repository.access_state !== 'removed' &&
    repository.service_id !== null &&
    repository.deploy_rule !== null &&
    repository.deploy_rule.mode !== 'none'
  )
}

/** "{account} · 4 repositories · 3 recording" (board 1, connected card). Without repositories (not loaded): the account only. */
export function connectedLine(connection: Extract<GitHubConnection, { configured: true }>, repositories: readonly GitHubRepository[] | null): string {
  const accounts = connection.installations.map((i) => i.account_login).join(', ')
  if (repositories === null) return accounts
  const linked = linkedRepositories(repositories).filter((r) => r.access_state !== 'removed')
  const recording = linked.filter(isRecording).length
  return `${accounts} · ${linked.length} ${linked.length === 1 ? 'repository' : 'repositories'} · ${recording} recording`
}

export type Banner = 'uninstalled' | 'suspended' | 'mismatch'

/**
 * The installation's banners, most serious first. Uninstalled says it all: a
 * removed installation's suspension or permissions no longer matter.
 */
export function bannersFor(installation: GitHubInstallation): Banner[] {
  if (installation.deleted_at !== null) return ['uninstalled']
  const banners: Banner[] = []
  if (installation.suspended_at !== null) banners.push('suspended')
  if (installation.permissions_state === 'mismatch') banners.push('mismatch')
  return banners
}

/** The removed-repository rows (board 6): linked repositories GitHub no longer gives access to. */
export function removedRepositories(repositories: readonly GitHubRepository[]): GitHubRepository[] {
  return linkedRepositories(repositories).filter((r) => r.access_state === 'removed')
}

// ── Claim outcomes (board 4) ─────────────────────────────────────────────────

export type ClaimOutcome =
  | { kind: 'connected'; account: string }
  | { kind: 'already_connected' }
  | { kind: 'waiting' }
  | { kind: 'approval_requested' }
  | { kind: 'expired' }
  | { kind: 'no_response'; canRetry: boolean }
  | { kind: 'elsewhere' }
  | { kind: 'installer_mismatch' }
  | { kind: 'not_allowed' }
  | { kind: 'install_event_missing'; message: string }
  | { kind: 'demo' }
  | { kind: 'off' }
  | { kind: 'failed' }

/**
 * A claim or retry answer -> its outcome. `afterWaiting`: a 202 was already
 * seen for this state, so the server has verified it and a retry can still
 * succeed (RC-O2); before that, a 502 spent the state and a retry answers 400,
 * which then reads "expired".
 */
export function claimOutcome(answer: ApiAnswer, afterWaiting: boolean): ClaimOutcome {
  const { status, body } = answer
  const error = body?.error
  const data = (body?.data ?? {}) as { status?: unknown; installation?: { account_login?: unknown } }
  if (status === 200 && data.status === 'connected') {
    const account = typeof data.installation?.account_login === 'string' ? data.installation.account_login : ''
    return { kind: 'connected', account }
  }
  if (status === 200 && data.status === 'already_connected') return { kind: 'already_connected' }
  if (status === 200 && data.status === 'pending_github_approval') return { kind: 'approval_requested' }
  if (status === 202 && data.status === 'waiting_for_github') return { kind: 'waiting' }
  if (status === 400 && (error === 'invalid_state' || error === 'missing_code_or_installation' || error === 'invalid_request')) return { kind: 'expired' }
  if (status === 403 && (error === 'installation_not_accessible' || error === 'not_installer' || error === 'github_authorization_failed')) {
    return { kind: 'installer_mismatch' }
  }
  if (status === 403 && error === 'not_available_in_demo') return { kind: 'demo' }
  if (status === 403) return { kind: 'not_allowed' }
  if (status === 409 && error === 'installation_claimed_elsewhere') return { kind: 'elsewhere' }
  if (status === 409 && error === 'install_event_not_received') {
    return { kind: 'install_event_missing', message: typeof body?.message === 'string' ? body.message : '' }
  }
  if (status === 502 && error === 'github_unavailable') return { kind: 'no_response', canRetry: afterWaiting }
  if (status === 503 && error === 'github_app_not_configured') return { kind: 'off' }
  return { kind: 'failed' }
}

/** Outcomes the claim may still move on from by itself (polling) or on Try again. */
export const RETRY_INTERVAL_MS = 3_000
/** The server allows 10 retries; one more than that is never sent. */
export const MAX_RETRIES = 10
