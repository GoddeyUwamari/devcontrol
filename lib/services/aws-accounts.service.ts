import api, { handleApiResponse } from '@/lib/api'

export interface AwsAccount {
  id: number
  org_id: string
  account_id: string
  role_arn: string
  nickname: string | null
  external_id: string | null
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

const awsAccountsService = {
  async connectInit(): Promise<ConnectInitData> {
    const response = await api.get<{ success: boolean; data: ConnectInitData }>(
      '/api/aws/accounts/connect-init'
    )
    return handleApiResponse(response)
  },

  async connect(payload: ConnectAwsPayload): Promise<AwsAccount> {
    const response = await api.post<{ success: boolean; data: AwsAccount; message: string }>(
      '/api/aws/accounts',
      payload
    )
    return handleApiResponse(response)
  },

  async getAccounts(): Promise<AwsAccount[]> {
    const response = await api.get<{ success: boolean; data: AwsAccount[] }>(
      '/api/aws/accounts'
    )
    return handleApiResponse(response)
  },
}

export default awsAccountsService
