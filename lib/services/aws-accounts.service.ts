import api, { handleApiResponse } from '@/lib/api'

export interface AwsAccount {
  id: number
  account_id: string
  nickname: string | null
  connected_at: string
  status: 'active' | 'inactive'
}

export interface ConnectAwsPayload {
  roleArn: string
  accountId: string
  nickname?: string
}

const awsAccountsService = {
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
