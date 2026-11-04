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
  status: 'active' | 'inactive'
}

export interface ConnectInitData {
  externalId: string
  platformAccountId: string
  trustPolicy: object
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

  async getAccounts(): Promise<AwsAccount[]> {
    const response = await api.get<{ success: boolean; data: AwsAccount[] }>(
      '/api/aws/accounts'
    )
    return handleApiResponse(response)
  },
}

export default awsAccountsService
