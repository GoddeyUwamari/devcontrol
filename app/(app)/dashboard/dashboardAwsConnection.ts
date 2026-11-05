/**
 * Whether the organization has AWS connected, as far as the dashboard can
 * tell -- extracted for testability, like dashboardAwsGates.
 *
 * Only the server's connection state decides it (GET /api/aws/accounts
 * `connection`, AWS connect PR B): never how many account rows exist, and
 * never AWS-derived data such as the legacy dashboard stats (cost,
 * deployments, services), which may be left from an earlier connection.
 *
 *   connected    the server reports one active connection
 *   unconnected  the server reports none (no row, or only rows that are not
 *                active)
 *   unknown      the accounts request failed (401, 500, network), or the
 *                server reports more than one active connection: a failure is
 *                never read as "not connected"
 *   loading      the accounts request has not settled yet
 *
 * Only `connected` renders the dashboard body; only `unconnected` invites the
 * user to connect.
 */
import type { AwsConnectionState as ServerConnectionState } from '@/lib/services/aws-accounts.service'

export type AwsConnectionState = 'connected' | 'unconnected' | 'unknown' | 'loading'

export function computeAwsConnectionState(params: {
  isDemoActive: boolean
  /** The server's connection state from the last successful request; undefined if there has been none. */
  connection: ServerConnectionState | undefined
  /** The accounts request failed and there is no earlier successful result. */
  connectionFailed: boolean
}): AwsConnectionState {
  const { isDemoActive, connection, connectionFailed } = params
  if (isDemoActive) return 'connected'
  if (connection === 'connected') return 'connected'
  if (connection === 'not_connected') return 'unconnected'
  if (connection === 'ambiguous') return 'unknown'
  return connectionFailed ? 'unknown' : 'loading'
}
