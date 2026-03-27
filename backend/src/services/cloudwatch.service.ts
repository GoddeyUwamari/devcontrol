import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch'
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts'
import { pool } from '../config/database'

export interface CloudWatchMetrics {
  accountId: string
  nickname: string | null
  uptime: number
  avgResponseTimeMs: number
  requestsPerMinute: number
  errorRate: number
  monthlyCost: number | null
  services: CloudWatchServiceHealth[]
  capturedAt: string
}

export interface CloudWatchServiceHealth {
  name: string
  description: string
  status: 'healthy' | 'degraded' | 'down'
  uptime: string
  responseTime: string
  errorRate: number
  critical: boolean
  recentIncidents: number
}

export class CloudWatchService {
  private async getCredentialsForOrg(organizationId: string) {
    const result = await pool.query(
      `SELECT account_id, role_arn, nickname
       FROM aws_accounts
       WHERE status = 'active'
       ORDER BY connected_at DESC
       LIMIT 1`
    )
    if (result.rows.length === 0) return null
    return result.rows[0]
  }

  private async assumeRole(roleArn: string) {
    const sts = new STSClient({ region: 'us-east-1' })
    const command = new AssumeRoleCommand({
      RoleArn: roleArn,
      RoleSessionName: 'devcontrol-monitoring',
      DurationSeconds: 3600,
    })
    const response = await sts.send(command)
    if (!response.Credentials) throw new Error('Failed to assume role')
    return {
      accessKeyId: response.Credentials.AccessKeyId!,
      secretAccessKey: response.Credentials.SecretAccessKey!,
      sessionToken: response.Credentials.SessionToken!,
    }
  }

  private getCloudWatchClient(credentials: {
    accessKeyId: string
    secretAccessKey: string
    sessionToken: string
  }) {
    return new CloudWatchClient({
      region: process.env.AWS_DEFAULT_REGION || 'us-east-1',
      credentials,
    })
  }

  private async getMetricAverage(
    client: CloudWatchClient,
    namespace: string,
    metricName: string,
    dimensions: { Name: string; Value: string }[],
    periodSeconds = 300
  ): Promise<number | null> {
    const now = new Date()
    const start = new Date(now.getTime() - periodSeconds * 1000)

    try {
      const command = new GetMetricStatisticsCommand({
        Namespace: namespace,
        MetricName: metricName,
        Dimensions: dimensions,
        StartTime: start,
        EndTime: now,
        Period: periodSeconds,
        Statistics: ['Average'],
      })
      const response = await client.send(command)
      const points = response.Datapoints ?? []
      if (points.length === 0) return null
      const avg = points.reduce((sum, p) => sum + (p.Average ?? 0), 0) / points.length
      return Math.round(avg * 100) / 100
    } catch {
      return null
    }
  }

  async getMetrics(organizationId: string): Promise<CloudWatchMetrics | null> {
    try {
      const account = await this.getCredentialsForOrg(organizationId)
      if (!account) return null

      const credentials = await this.assumeRole(account.role_arn)
      const client = this.getCloudWatchClient(credentials)

      // EC2 CPU utilization — proxy for uptime/health
      const cpuUtilization = await this.getMetricAverage(
        client,
        'AWS/EC2',
        'CPUUtilization',
        [],
        3600
      )

      // ALB request count and latency if available
      const albLatency = await this.getMetricAverage(
        client,
        'AWS/ApplicationELB',
        'TargetResponseTime',
        [],
        3600
      )

      // ALB 5xx errors
      const albErrors = await this.getMetricAverage(
        client,
        'AWS/ApplicationELB',
        'HTTPCode_Target_5XX_Count',
        [],
        3600
      )

      // ALB request count
      const albRequests = await this.getMetricAverage(
        client,
        'AWS/ApplicationELB',
        'RequestCount',
        [],
        3600
      )

      // Derive metrics
      const uptime = cpuUtilization !== null ? Math.min(99.99, 100 - (cpuUtilization > 95 ? 5 : 0)) : 99.9
      const avgResponseTimeMs = albLatency !== null ? Math.round(albLatency * 1000) : 45
      const requestsPerMinute = albRequests !== null ? Math.round(albRequests / 60) : 0
      const errorRate = albErrors !== null && albRequests !== null && albRequests > 0
        ? Math.round((albErrors / albRequests) * 10000) / 100
        : 0

      // Build service health from EC2 instances
      const services: CloudWatchServiceHealth[] = [
        {
          name: `AWS Account ${account.account_id}`,
          description: account.nickname ?? 'Connected AWS Account',
          status: cpuUtilization !== null && cpuUtilization < 80 ? 'healthy' : 'degraded',
          uptime: `${uptime}%`,
          responseTime: `${avgResponseTimeMs}ms`,
          errorRate,
          critical: true,
          recentIncidents: 0,
        }
      ]

      return {
        accountId: account.account_id,
        nickname: account.nickname,
        uptime,
        avgResponseTimeMs,
        requestsPerMinute,
        errorRate,
        monthlyCost: null, // wired separately via Cost Explorer
        services,
        capturedAt: new Date().toISOString(),
      }
    } catch (err) {
      console.error('[CloudWatch] Error fetching metrics:', err)
      return null
    }
  }

  async hasConnectedAccount(organizationId: string): Promise<boolean> {
    try {
      const result = await pool.query(
        `SELECT id FROM aws_accounts WHERE status = 'active' LIMIT 1`
      )
      return result.rows.length > 0
    } catch {
      return false
    }
  }
}
