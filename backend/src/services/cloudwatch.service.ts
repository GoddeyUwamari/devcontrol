import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch'
import { AWSClientFactory } from './aws-client-factory.service'
import { pool } from '../config/database'
import awsCostService from './aws-cost.service'

export type MonitoringRange = '5m' | '15m' | '1h' | '3h' | '24h' | '7d'

interface RangeConfig {
  lookbackSeconds: number
  periodSeconds: number
}

// Period must be a multiple of 60s (CloudWatch's granularity floor) and stay under the
// 1440-datapoint-per-request ceiling for the chosen lookback window.
const RANGE_CONFIG: Record<MonitoringRange, RangeConfig> = {
  '5m': { lookbackSeconds: 5 * 60, periodSeconds: 60 },
  '15m': { lookbackSeconds: 15 * 60, periodSeconds: 60 },
  '1h': { lookbackSeconds: 60 * 60, periodSeconds: 5 * 60 },
  '3h': { lookbackSeconds: 3 * 60 * 60, periodSeconds: 5 * 60 },
  '24h': { lookbackSeconds: 24 * 60 * 60, periodSeconds: 60 * 60 },
  '7d': { lookbackSeconds: 7 * 24 * 60 * 60, periodSeconds: 4 * 60 * 60 },
}

const DEFAULT_RANGE: MonitoringRange = '1h'

function resolveRange(range?: string): MonitoringRange {
  return range && range in RANGE_CONFIG ? (range as MonitoringRange) : DEFAULT_RANGE
}

export interface ResponseTimePoint {
  timestamp: number
  value: number
}

export interface CloudWatchServiceHealth {
  resourceId: string
  name: string
  description: string
  resourceType: 'ec2' | 'rds' | 'load-balancer' | 'lambda'
  status: 'healthy' | 'degraded' | 'down' | 'unknown'
  // null means CloudWatch genuinely has no data for this metric right now — never
  // fabricate a plausible-looking number in its place.
  uptime: number | null
  responseTimeMs: number | null
  errorRate: number | null
  critical: boolean
  // Whether any real metric backs this row at all, vs. inventory-only (e.g. RDS today).
  monitored: boolean
}

export interface CloudWatchMetrics {
  accountId: string
  nickname: string | null
  region: string
  uptime: number | null
  avgResponseTimeMs: number | null
  requestsPerMinute: number | null
  errorRate: number | null
  monthlyCost: number | null
  trendPercent: number | null
  responseTimeHistory: ResponseTimePoint[]
  // What this account topology actually lets us measure — drives the page's coverage
  // claim instead of a hardcoded "EC2, RDS, Lambda" string.
  coverage: { ec2: boolean; loadBalancer: boolean; rds: boolean }
  services: CloudWatchServiceHealth[]
  capturedAt: string
}

interface InventoryRow {
  resource_id: string
  resource_name: string | null
  resource_type: 'ec2' | 'rds' | 'load-balancer' | 'lambda'
  resource_arn: string
  status: string | null
  metadata: Record<string, any> | null
}

type Dimension = { Name: string; Value: string }

interface MetricDefinition {
  // Key this metric's fetched value is stored under in the `values` map passed to healthRule.
  key: string
  metricName: string
  statistic: 'Average' | 'Sum'
  // 'previous' fetches the same metric for the prior lookback window (used for trend
  // comparisons). Defaults to 'current'.
  window?: 'current' | 'previous'
}

interface HealthRuleContext {
  lookbackSeconds: number
  dims: Dimension[]
}

/**
 * A capability definition describes how to fetch CloudWatch data for one resource type
 * and how to turn that data (plus the resource's own inventory row) into a
 * CloudWatchServiceHealth row. `extra` is an optional bag of additional derived values
 * a capability needs to expose to callers beyond the per-resource health row — today
 * only the load-balancer capability uses this, to feed the account-wide response-time/
 * request-rate KPI rollups in getMetrics().
 */
interface ResourceCapability<TExtra = void> {
  resourceType: CloudWatchServiceHealth['resourceType']
  // Null namespace/dimensionKey means this resource type has no CloudWatch metrics wired
  // up (e.g. RDS today) — the engine skips the CloudWatch fetch entirely and calls
  // healthRule with an empty values map.
  cloudwatchNamespace: string | null
  dimensionKey: string | null
  // Returns null when the resource can't be mapped to a CloudWatch dimension value
  // (e.g. a malformed ALB ARN) — the engine treats that resource as unfetchable.
  getDimensionValue: (resource: InventoryRow) => string | null
  metrics: MetricDefinition[]
  healthRule: (
    resource: InventoryRow,
    values: Record<string, number | null>,
    context: HealthRuleContext
  ) => { service: CloudWatchServiceHealth; extra: TExtra }
}

/**
 * ALB's LoadBalancer dimension value is the ARN suffix after "loadbalancer/"
 * (e.g. "app/my-alb/50dc6c495c0c9188"), not the full ARN.
 */
function albDimensionValue(resourceArn: string): string | null {
  const match = resourceArn.match(/loadbalancer\/(.+)$/)
  return match ? match[1] : null
}

interface AlbExtra {
  avgResponseTimeMs: number | null
  previousAvgResponseTimeMs: number | null
  requestsPerMinute: number | null
  errorRate: number | null
  requestSum: number
  dims: Dimension[]
}

const ec2Capability: ResourceCapability = {
  resourceType: 'ec2',
  cloudwatchNamespace: 'AWS/EC2',
  dimensionKey: 'InstanceId',
  getDimensionValue: (instance) => instance.resource_id,
  metrics: [
    { key: 'statusCheckFailed', metricName: 'StatusCheckFailed', statistic: 'Average' },
    { key: 'cpu', metricName: 'CPUUtilization', statistic: 'Average' },
  ],
  healthRule: (instance, values) => {
    const statusCheckFailed = values.statusCheckFailed
    const cpu = values.cpu

    const uptime = statusCheckFailed !== null ? Math.max(0, Math.min(100, Math.round((1 - statusCheckFailed) * 10000) / 100)) : null

    let status: CloudWatchServiceHealth['status']
    if (instance.status === 'stopped' || instance.status === 'stopping' || instance.status === 'shutting-down') {
      status = 'down'
    } else if (uptime !== null) {
      status = uptime >= 99.9 ? 'healthy' : 'degraded'
    } else if (cpu !== null) {
      status = cpu < 80 ? 'healthy' : 'degraded'
    } else {
      status = 'unknown'
    }

    return {
      service: {
        resourceId: instance.resource_id,
        name: instance.resource_name || instance.resource_id,
        description: `EC2 · ${instance.resource_id}`,
        resourceType: 'ec2',
        status,
        uptime,
        responseTimeMs: null,
        errorRate: null,
        critical: true,
        monitored: uptime !== null || cpu !== null,
      },
      extra: undefined,
    }
  },
}

const rdsCapability: ResourceCapability = {
  resourceType: 'rds',
  // No CloudWatch metrics wired for RDS yet — inventory-only, shown honestly as such.
  cloudwatchNamespace: null,
  dimensionKey: null,
  getDimensionValue: () => null,
  metrics: [],
  healthRule: (r) => ({
    service: {
      resourceId: r.resource_id,
      name: r.resource_name || r.resource_id,
      description: `RDS · ${r.metadata?.engine ?? 'database'}`,
      resourceType: 'rds',
      status: r.status === 'available' ? 'healthy' : r.status === 'stopped' ? 'down' : 'unknown',
      uptime: null,
      responseTimeMs: null,
      errorRate: null,
      critical: true,
      monitored: false,
    },
    extra: undefined,
  }),
}

const loadBalancerCapability: ResourceCapability<AlbExtra> = {
  resourceType: 'load-balancer',
  cloudwatchNamespace: 'AWS/ApplicationELB',
  dimensionKey: 'LoadBalancer',
  getDimensionValue: (alb) => albDimensionValue(alb.resource_arn),
  metrics: [
    { key: 'latencySec', metricName: 'TargetResponseTime', statistic: 'Average', window: 'current' },
    { key: 'requestSum', metricName: 'RequestCount', statistic: 'Sum', window: 'current' },
    { key: 'errorSum', metricName: 'HTTPCode_Target_5XX_Count', statistic: 'Sum', window: 'current' },
    { key: 'previousLatencySec', metricName: 'TargetResponseTime', statistic: 'Average', window: 'previous' },
  ],
  healthRule: (alb, values, { lookbackSeconds, dims }) => {
    const latencySec = values.latencySec
    const requestSum = values.requestSum
    const errorSum = values.errorSum
    const previousLatencySec = values.previousLatencySec

    const avgResponseTimeMs = latencySec !== null ? Math.round(latencySec * 1000) : null
    const previousAvgResponseTimeMs = previousLatencySec !== null ? Math.round(previousLatencySec * 1000) : null
    const requestsPerMinute = requestSum !== null ? Math.round(requestSum / (lookbackSeconds / 60)) : null
    const errorRate =
      errorSum !== null && requestSum !== null && requestSum > 0
        ? Math.round((errorSum / requestSum) * 10000) / 100
        : requestSum !== null
          ? 0
          : null

    const service: CloudWatchServiceHealth = {
      resourceId: alb.resource_id,
      name: alb.resource_name || alb.resource_id,
      description: 'Application Load Balancer',
      resourceType: 'load-balancer',
      status: avgResponseTimeMs !== null ? (avgResponseTimeMs < 500 ? 'healthy' : 'degraded') : 'unknown',
      uptime: null,
      responseTimeMs: avgResponseTimeMs,
      errorRate,
      critical: false,
      monitored: avgResponseTimeMs !== null,
    }

    return {
      service,
      extra: { avgResponseTimeMs, previousAvgResponseTimeMs, requestsPerMinute, errorRate, requestSum: requestSum ?? 0, dims },
    }
  },
}

const lambdaCapability: ResourceCapability = {
  resourceType: 'lambda',
  cloudwatchNamespace: 'AWS/Lambda',
  dimensionKey: 'FunctionName',
  // Discovery stores the function name (not the ARN) as resource_id — same value
  // CloudWatch's FunctionName dimension expects, so no ARN parsing needed here.
  getDimensionValue: (fn) => fn.resource_id,
  metrics: [
    { key: 'invocations', metricName: 'Invocations', statistic: 'Sum' },
    { key: 'errors', metricName: 'Errors', statistic: 'Sum' },
    { key: 'duration', metricName: 'Duration', statistic: 'Average' },
  ],
  healthRule: (fn, values) => {
    const invocations = values.invocations
    const errors = values.errors
    const duration = values.duration

    const responseTimeMs = duration !== null ? Math.round(duration) : null
    const errorRate =
      invocations !== null && invocations > 0 && errors !== null
        ? Math.round((errors / invocations) * 10000) / 100
        : invocations !== null
          ? 0
          : null

    let status: CloudWatchServiceHealth['status']
    if (fn.status === 'Failed' || fn.status === 'Inactive') {
      status = 'down'
    } else if (errorRate !== null) {
      status = errorRate < 5 ? 'healthy' : 'degraded'
    } else {
      status = 'unknown'
    }

    return {
      service: {
        resourceId: fn.resource_id,
        name: fn.resource_name || fn.resource_id,
        description: `Lambda · ${fn.metadata?.runtime ?? 'function'}`,
        resourceType: 'lambda',
        status,
        uptime: null,
        responseTimeMs,
        errorRate,
        critical: false,
        monitored: invocations !== null,
      },
      extra: undefined,
    }
  },
}

// Adding a future resource type (e.g. DynamoDB) means adding a capability
// definition here — the fetch/dimension plumbing in evaluateResource() is generic.
const resourceTypeRegistry: {
  ec2: ResourceCapability
  rds: ResourceCapability
  'load-balancer': ResourceCapability<AlbExtra>
  lambda: ResourceCapability
} = {
  ec2: ec2Capability,
  rds: rdsCapability,
  'load-balancer': loadBalancerCapability,
  lambda: lambdaCapability,
}

export class CloudWatchService {
  private async getAccount(organizationId: string): Promise<{ account_id: string; nickname: string | null } | null> {
    const result = await pool.query(
      `SELECT account_id, nickname
       FROM aws_accounts
       WHERE org_id = $1 AND status = 'active'
       ORDER BY connected_at DESC
       LIMIT 1`,
      [organizationId]
    )
    return result.rows[0] ?? null
  }

  private async getResourceInventory(organizationId: string): Promise<InventoryRow[]> {
    const { rows } = await pool.query(
      `SELECT resource_id, resource_name, resource_type, resource_arn, status, metadata
       FROM aws_resources
       WHERE organization_id = $1
         AND resource_type IN ('ec2', 'rds', 'load-balancer', 'lambda')
         AND status != 'terminated'
       ORDER BY resource_name ASC NULLS LAST`,
      [organizationId]
    )
    return rows
  }

  private async getMetricStat(
    client: CloudWatchClient,
    namespace: string,
    metricName: string,
    dimensions: Dimension[],
    startTime: Date,
    endTime: Date,
    periodSeconds: number,
    statistic: 'Average' | 'Sum'
  ): Promise<number | null> {
    try {
      const command = new GetMetricStatisticsCommand({
        Namespace: namespace,
        MetricName: metricName,
        Dimensions: dimensions,
        StartTime: startTime,
        EndTime: endTime,
        Period: periodSeconds,
        Statistics: [statistic],
      })
      const response = await client.send(command)
      const points = response.Datapoints ?? []
      if (points.length === 0) return null
      if (statistic === 'Sum') {
        return points.reduce((sum, p) => sum + (p.Sum ?? 0), 0)
      }
      return points.reduce((sum, p) => sum + (p.Average ?? 0), 0) / points.length
    } catch (err) {
      console.error(`[CloudWatch] ${namespace}/${metricName} fetch failed:`, err)
      return null
    }
  }

  private async getResponseTimeSeries(
    client: CloudWatchClient,
    dimensions: Dimension[],
    startTime: Date,
    endTime: Date,
    periodSeconds: number
  ): Promise<ResponseTimePoint[]> {
    try {
      const command = new GetMetricStatisticsCommand({
        Namespace: 'AWS/ApplicationELB',
        MetricName: 'TargetResponseTime',
        Dimensions: dimensions,
        StartTime: startTime,
        EndTime: endTime,
        Period: periodSeconds,
        Statistics: ['Average'],
      })
      const response = await client.send(command)
      return (response.Datapoints ?? [])
        .filter((p) => p.Timestamp && p.Average !== undefined)
        .map((p) => ({ timestamp: p.Timestamp!.getTime(), value: Math.round(p.Average! * 1000) }))
        .sort((a, b) => a.timestamp - b.timestamp)
    } catch (err) {
      console.error('[CloudWatch] TargetResponseTime series fetch failed:', err)
      return []
    }
  }

  /**
   * Generic engine: given a resource and its registry capability definition, fetches
   * every metric the capability declares (skipping the CloudWatch call entirely for
   * capabilities with no namespace/dimension wired up, e.g. RDS) and hands the raw
   * values to the capability's healthRule to produce the resource's health row.
   * Returns null when the resource can't be mapped to a CloudWatch dimension value.
   */
  private async evaluateResource<TExtra>(
    client: CloudWatchClient,
    capability: ResourceCapability<TExtra>,
    resource: InventoryRow,
    currentStart: Date,
    previousStart: Date,
    now: Date,
    periodSeconds: number,
    lookbackSeconds: number
  ): Promise<{ service: CloudWatchServiceHealth; extra: TExtra } | null> {
    let dims: Dimension[] = []
    let values: Record<string, number | null> = {}

    if (capability.cloudwatchNamespace && capability.dimensionKey) {
      const dimValue = capability.getDimensionValue(resource)
      if (dimValue === null) return null
      dims = [{ Name: capability.dimensionKey, Value: dimValue }]

      const namespace = capability.cloudwatchNamespace
      const entries = await Promise.all(
        capability.metrics.map(async (metric) => {
          const [start, end] = metric.window === 'previous' ? [previousStart, currentStart] : [currentStart, now]
          const value = await this.getMetricStat(client, namespace, metric.metricName, dims, start, end, periodSeconds, metric.statistic)
          return [metric.key, value] as const
        })
      )
      values = Object.fromEntries(entries)
    }

    return capability.healthRule(resource, values, { lookbackSeconds, dims })
  }

  async getMetrics(organizationId: string, range?: string): Promise<CloudWatchMetrics | null> {
    const account = await this.getAccount(organizationId)
    if (!account) return null

    let clients
    try {
      clients = await AWSClientFactory.createClients(organizationId)
    } catch (err) {
      console.error('[CloudWatch] Failed to create AWS clients:', err)
      return null
    }
    if (!clients.enabled) return null

    const { lookbackSeconds, periodSeconds } = RANGE_CONFIG[resolveRange(range)]
    const now = new Date()
    const currentStart = new Date(now.getTime() - lookbackSeconds * 1000)
    const previousStart = new Date(currentStart.getTime() - lookbackSeconds * 1000)

    const resources = await this.getResourceInventory(organizationId)
    const ec2Instances = resources.filter((r) => r.resource_type === 'ec2').slice(0, 15)
    const rdsInstances = resources.filter((r) => r.resource_type === 'rds').slice(0, 15)
    const albs = resources.filter((r) => r.resource_type === 'load-balancer' && r.metadata?.type === 'application').slice(0, 5)
    const lambdaFunctions = resources.filter((r) => r.resource_type === 'lambda').slice(0, 15)

    const ec2Results = (
      await Promise.all(
        ec2Instances.map((instance) =>
          this.evaluateResource(clients.cloudWatch, resourceTypeRegistry.ec2, instance, currentStart, previousStart, now, periodSeconds, lookbackSeconds)
        )
      )
    ).filter((r): r is NonNullable<typeof r> => r !== null)
    const ec2Services = ec2Results.map((r) => r.service)
    const uptimeValues = ec2Services.map((s) => s.uptime).filter((v): v is number => v !== null)
    const uptime = uptimeValues.length > 0 ? Math.round((uptimeValues.reduce((a, b) => a + b, 0) / uptimeValues.length) * 100) / 100 : null

    const rdsResults = (
      await Promise.all(
        rdsInstances.map((instance) =>
          this.evaluateResource(clients.cloudWatch, resourceTypeRegistry.rds, instance, currentStart, previousStart, now, periodSeconds, lookbackSeconds)
        )
      )
    ).filter((r): r is NonNullable<typeof r> => r !== null)
    const rdsServices = rdsResults.map((r) => r.service)

    const lambdaResults = (
      await Promise.all(
        lambdaFunctions.map((fn) =>
          this.evaluateResource(clients.cloudWatch, resourceTypeRegistry.lambda, fn, currentStart, previousStart, now, periodSeconds, lookbackSeconds)
        )
      )
    ).filter((r): r is NonNullable<typeof r> => r !== null)
    const lambdaServices = lambdaResults.map((r) => r.service)

    const albEvaluations = (
      await Promise.all(
        albs.map((alb) =>
          this.evaluateResource(
            clients.cloudWatch,
            resourceTypeRegistry['load-balancer'],
            alb,
            currentStart,
            previousStart,
            now,
            periodSeconds,
            lookbackSeconds
          )
        )
      )
    ).filter((r): r is NonNullable<typeof r> => r !== null)

    const albServices = albEvaluations.map((r) => r.service)
    const albResults = albEvaluations.map((r) => ({
      service: r.service,
      avgResponseTimeMs: r.extra.avgResponseTimeMs,
      previousAvgResponseTimeMs: r.extra.previousAvgResponseTimeMs,
      requestsPerMinute: r.extra.requestsPerMinute,
      errorRate: r.extra.errorRate,
      requestSum: r.extra.requestSum,
      dims: r.extra.dims,
    }))

    // Response time / request-rate KPIs only make sense when at least one ALB exists —
    // an EC2-only or Lambda+API-Gateway account genuinely has no ALB-shaped metrics.
    let avgResponseTimeMs: number | null = null
    let requestsPerMinute: number | null = null
    let errorRate: number | null = null
    let trendPercent: number | null = null
    let responseTimeHistory: ResponseTimePoint[] = []

    if (albResults.length > 0) {
      const measuredLatencies = albResults.filter((r) => r.avgResponseTimeMs !== null)
      avgResponseTimeMs =
        measuredLatencies.length > 0
          ? Math.round(measuredLatencies.reduce((sum, r) => sum + r.avgResponseTimeMs!, 0) / measuredLatencies.length)
          : null
      requestsPerMinute = albResults.some((r) => r.requestsPerMinute !== null)
        ? albResults.reduce((sum, r) => sum + (r.requestsPerMinute ?? 0), 0)
        : null
      const errorRates = albResults.filter((r) => r.errorRate !== null)
      errorRate = errorRates.length > 0 ? Math.round((errorRates.reduce((sum, r) => sum + r.errorRate!, 0) / errorRates.length) * 100) / 100 : null

      const previousLatencies = albResults.filter((r) => r.previousAvgResponseTimeMs !== null)
      const previousAvg =
        previousLatencies.length > 0
          ? previousLatencies.reduce((sum, r) => sum + r.previousAvgResponseTimeMs!, 0) / previousLatencies.length
          : null
      trendPercent =
        avgResponseTimeMs !== null && previousAvg !== null && previousAvg > 0
          ? Math.round(((avgResponseTimeMs - previousAvg) / previousAvg) * 1000) / 10
          : null

      // Chart the highest-traffic ALB — response time isn't meaningfully additive
      // across multiple load balancers, so a single representative series beats an
      // average-of-averages line.
      const primary = albResults.reduce((best, r) => (r.requestSum > best.requestSum ? r : best), albResults[0])
      responseTimeHistory = await this.getResponseTimeSeries(clients.cloudWatch, primary.dims, currentStart, now, periodSeconds)
    }

    let monthlyCost: number | null = null
    try {
      const cost = await awsCostService.fetchMonthlyCosts(organizationId)
      monthlyCost = cost.total
    } catch (err) {
      console.error('[CloudWatch] Monthly cost fetch failed:', err)
    }

    return {
      accountId: account.account_id,
      nickname: account.nickname,
      region: clients.region,
      uptime,
      avgResponseTimeMs,
      requestsPerMinute,
      errorRate,
      monthlyCost,
      trendPercent,
      responseTimeHistory,
      coverage: { ec2: ec2Instances.length > 0, loadBalancer: albResults.length > 0, rds: rdsInstances.length > 0 },
      services: [...ec2Services, ...albServices, ...rdsServices, ...lambdaServices],
      capturedAt: new Date().toISOString(),
    }
  }

  async hasConnectedAccount(organizationId: string): Promise<boolean> {
    try {
      const result = await pool.query(
        `SELECT id FROM aws_accounts WHERE org_id = $1 AND status = 'active' LIMIT 1`,
        [organizationId]
      )
      return result.rows.length > 0
    } catch {
      return false
    }
  }
}
