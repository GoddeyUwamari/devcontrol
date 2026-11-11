import api, { handleApiResponse } from '@/lib/api'

export interface AwsAccount {
  id: number
  org_id: string
  account_id: string
  role_arn: string
  nickname: string | null
  /** Present for the organization owner only; absent for every other role. */
  external_id?: string | null
  region: string
  connected_at: string
  status: string
}

export interface ConnectInitData {
  externalId: string
  platformAccountId: string
  trustPolicy: object
  /**
   * The CloudFormation quick-create link and template version, sent only once the template is
   * hosted and its server switch is on (AWS connect PR D2). No server sends it before then, so
   * the Connect AWS page's CloudFormation card stays hidden.
   */
  launchStack?: { url: string; templateVersion: string }
}

export interface ConnectAwsPayload {
  roleArn: string
  nickname?: string
}

/** One operation the post-connect permission check tested (backend connect-permission-check.ts). */
export type PermissionCheckStatus = 'verified' | 'denied' | 'not_verified'
export interface PermissionCheckEntry {
  action: string
  status: PermissionCheckStatus
}
export interface PermissionCheckReport {
  checks: PermissionCheckEntry[]
}

export interface ConnectAwsResult {
  account: AwsAccount
  /** Absent only from a server older than the permission check. */
  permissionCheck: PermissionCheckReport | null
}

/**
 * Whether the organization has an active AWS connection, as the server decides
 * it (GET /api/aws/accounts `connection.state`, backend routes/aws.routes.ts
 * readConnectionState): exactly one eligible ('active') aws_accounts row.
 *
 *   connected      the one active connection exists
 *   not_connected  none: no row, or only rows that are not active
 *   ambiguous      more than one active row: the server scans none of them
 *
 * Never derived from how many rows the list has, nor from any AWS-derived data
 * (stats, resources, spend): historical data left from an earlier connection
 * says nothing about the current one.
 */
export type AwsConnectionState = 'connected' | 'not_connected' | 'ambiguous'

export interface AwsAccountsAndConnection {
  accounts: AwsAccount[]
  connection: AwsConnectionState
}

const CONNECTION_STATES: readonly string[] = ['connected', 'not_connected', 'ambiguous']

/**
 * The connection state of a GET /api/aws/accounts body. A server from before the
 * `connection` field (a deploy where this frontend ships first) is answered by
 * the same rule from its rows' own status: exactly one 'active' row. Anything
 * else is an error, never "not connected".
 */
export function parseAwsConnection(connection: unknown, accounts: unknown): AwsConnectionState {
  const state = (connection as { state?: unknown } | null | undefined)?.state
  if (typeof state === 'string' && CONNECTION_STATES.includes(state)) return state as AwsConnectionState
  if (connection !== undefined) throw new Error('The AWS connection state was not recognized')
  if (!Array.isArray(accounts)) throw new Error('The AWS accounts response was not a list')
  const active = accounts.filter((account) => (account as { status?: unknown } | null)?.status === 'active').length
  return active === 0 ? 'not_connected' : active === 1 ? 'connected' : 'ambiguous'
}

const awsAccountsService = {
  async connectInit(): Promise<ConnectInitData> {
    const response = await api.get<{ success: boolean; data: ConnectInitData }>(
      '/api/aws/accounts/connect-init'
    )
    return handleApiResponse(response)
  },

  async connect(payload: ConnectAwsPayload): Promise<ConnectAwsResult> {
    const response = await api.post<{ success: boolean; data: AwsAccount; message: string; permissionCheck?: PermissionCheckReport }>(
      '/api/aws/accounts',
      payload
    )
    const account = handleApiResponse(response)
    return { account, permissionCheck: response.data.permissionCheck ?? null }
  },

  /** The organization's account rows and the server's connection state (parseAwsConnection). */
  async getAccountsAndConnection(): Promise<AwsAccountsAndConnection> {
    const response = await api.get<{ success: boolean; data: AwsAccount[]; connection?: unknown }>(
      '/api/aws/accounts'
    )
    const accounts = handleApiResponse(response)
    return { accounts, connection: parseAwsConnection(response.data.connection, accounts) }
  },
}

export default awsAccountsService
