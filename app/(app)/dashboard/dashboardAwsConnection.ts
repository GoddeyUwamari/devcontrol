/**
 * Whether the organization has AWS connected, as far as the dashboard can
 * tell -- extracted for testability, like dashboardAwsGates.
 *
 *   connected    GET /api/aws/accounts returned at least one account, or the
 *                legacy dashboard stats already show AWS-derived data (the
 *                same fallback the dashboard has always honoured)
 *   unconnected  the accounts request succeeded with no accounts, and the
 *                stats show nothing either
 *   unknown      the accounts request failed (401, 500, network): a failure
 *                is never read as "not connected"
 *   loading      the accounts or the stats have not settled yet
 *
 * Only `connected` renders the dashboard body; only `unconnected` invites the
 * user to connect.
 */
export type AwsConnectionState = 'connected' | 'unconnected' | 'unknown' | 'loading'

export function computeAwsConnectionState(params: {
  isDemoActive: boolean
  /** The accounts list from the last successful request; undefined if there has been none. */
  awsAccounts: unknown[] | undefined
  /** The accounts request failed and there is no earlier successful result. */
  awsAccountsFailed: boolean
  statsLoading: boolean
  stats: { monthlyAwsCost: number; activeDeployments: number; totalServices: number } | undefined
}): AwsConnectionState {
  const { isDemoActive, awsAccounts, awsAccountsFailed, statsLoading, stats } = params
  if (isDemoActive) return 'connected'
  if (awsAccounts && awsAccounts.length > 0) return 'connected'
  if (stats && (stats.monthlyAwsCost > 0 || stats.activeDeployments > 0 || stats.totalServices > 0)) return 'connected'
  if (statsLoading) return 'loading'
  if (awsAccounts !== undefined) return 'unconnected'
  return awsAccountsFailed ? 'unknown' : 'loading'
}
