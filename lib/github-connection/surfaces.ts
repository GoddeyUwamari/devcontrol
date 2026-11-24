/**
 * The GitHub connection as other pages show it (board 7, D8b-2): the
 * Deployment History chip, the Developers tile and the Engineering
 * Intelligence banner. null = say nothing new (still loading, a request
 * failed, the demo workspace): those pages then keep their existing copy.
 * Never inferred from anything but the server's answers.
 */
import type { GitHubConnection, GitHubRepository } from '../services/github-connection.service'
import { isRecording, needsAttention } from './model'

export type GitHubSurface =
  | { kind: 'off' }
  | { kind: 'not_connected'; canManage: boolean }
  | { kind: 'attention' }
  | { kind: 'connected'; recording: number | null }

export function githubSurface(
  connection: GitHubConnection | undefined,
  repositories: readonly GitHubRepository[] | undefined,
): GitHubSurface | null {
  if (!connection) return null
  if (!connection.configured) return { kind: 'off' }
  if (connection.demo) return null
  if (connection.installations.length === 0) return { kind: 'not_connected', canManage: connection.can_manage }
  if (connection.installations.some(needsAttention)) return { kind: 'attention' }
  return { kind: 'connected', recording: repositories ? repositories.filter(isRecording).length : null }
}
