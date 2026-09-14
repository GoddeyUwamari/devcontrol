import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch'
import { ECSClient, DescribeServicesCommand } from '@aws-sdk/client-ecs'
import { EKSClient, DescribeClusterCommand } from '@aws-sdk/client-eks'
import { EC2Client, paginateDescribeVolumeStatus, VolumeStatusItem } from '@aws-sdk/client-ec2'
import { RDSClient } from '@aws-sdk/client-rds'
import { AWSClientFactory } from './aws-client-factory.service'
import { pool } from '../config/database'
import awsCostService from './aws-cost.service'
import { fetchMetricDataBatch, reduceSeriesToScalar, BatchMetricQuery, BatchSeriesResult } from './cloudwatch-metric-batch.util'
import { describeAuroraClusters, AuroraClusterInfo } from './aurora-cluster.util'

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

// Phase B: generic, typed per-resource metric — backend supplies raw numbers only, never
// pre-formatted strings, so the frontend controls display (thousands separators, rounding,
// unit suffixes, future threshold-based coloring) without ever parsing a string back apart.
export interface ServiceMetric {
  label: string
  value: number
  unit?: string
}

export interface CloudWatchServiceHealth {
  resourceId: string
  name: string
  description: string
  resourceType: 'ec2' | 'rds' | 'load-balancer' | 'lambda' | 'dynamodb' | 'ecs' | 'eks' | 'ebs' | 'cloudfront' | 'aurora'
  status: 'healthy' | 'degraded' | 'critical' | 'down' | 'unknown'
  // null means CloudWatch genuinely has no data for this metric right now — never
  // fabricate a plausible-looking number in its place.
  uptime: number | null
  responseTimeMs: number | null
  errorRate: number | null
  critical: boolean
  // Whether any real metric backs this row at all, vs. inventory-only (e.g. RDS today).
  monitored: boolean
  // Optional explainability fields — populated by capabilities with a richer, multi-signal
  // health rule (currently DynamoDB and ECS). Deliberately optional rather than backfilled
  // across every existing capability in this same change; EC2/RDS/ALB/Lambda omit them.
  reason?: string | null
  signals?: Record<string, number | null> | null
  // Phase B: generic per-resource-type display metrics. Each capability decides what's
  // meaningful for its type (CPU for EC2, invocations for Lambda, throttling for DynamoDB)
  // and returns typed values here — the shared engine and any UI consuming this never need
  // per-type branching. Omitted or empty when nothing meaningful is available yet.
  metrics?: ServiceMetric[]
  // Phase 2D: raw DB identity threaded through from InventoryRow, used only to build the
  // deterministic keyset-pagination cursor (type -> resourceSortName -> resourceDbId) --
  // never a display field, resourceId/name above already serve that purpose. Populated by
  // every capability's healthRule() and by evaluateEcsService()/evaluateEksService().
  resourceDbId: string
  resourceSortName: string | null
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
  // Service Health Coverage Expansion: adds ebs/cloudfront, and fixes a pre-existing
  // drift where `lambda` was never included here (lambda has always been evaluated —
  // see computeMetrics()'s lambdaTask — this field just never reflected it).
  coverage: { ec2: boolean; loadBalancer: boolean; rds: boolean; lambda: boolean; dynamodb: boolean; ecs: boolean; eks: boolean; ebs: boolean; cloudfront: boolean; aurora: boolean }
  // Monitoring Truthfulness Phase 1: shown-vs-total per resource type, so the UI can
  // honestly disclose when the per-scan cap below (ec2Instances.slice(0, 15), etc.) has
  // silently omitted resources, instead of presenting a partial list as if it were
  // complete. Built from the same pre-slice inventory arrays already fetched for
  // `coverage` above — no additional AWS/CloudWatch calls.
  resourceCounts: {
    ec2: ResourceCoverageCount
    loadBalancer: ResourceCoverageCount
    rds: ResourceCoverageCount
    lambda: ResourceCoverageCount
    dynamodb: ResourceCoverageCount
    ecs: ResourceCoverageCount
    eks: ResourceCoverageCount
    ebs: ResourceCoverageCount
    cloudfront: ResourceCoverageCount
    aurora: ResourceCoverageCount
  }
  // Phase 2D: complete-fleet-derived aggregate health -- computed from every evaluated
  // resource across all seven types, never from the (now paginated) `services` page
  // below. See computeMetrics()'s healthSummary/systemStatus construction, which mirrors
  // the health-status precedence the frontend used to derive client-side from a
  // (formerly capped, now would-be-paginated) services[] array -- moved server-side
  // because that derivation is no longer correct once services[] is only a page.
  healthSummary: CloudWatchHealthSummary
  systemStatus: CloudWatchSystemStatus
  services: CloudWatchServiceHealth[]
  // Phase 2D: present only on the paginated HTTP response (added by the route layer
  // after getMetrics() returns) -- absent on the cached CloudWatchMetrics object itself,
  // since pagination is not part of what Phase 2A caches. See cloudwatch.routes.ts.
  pagination?: { shown: number; total: number; hasMore: boolean; cursor: string | null }
  capturedAt: string
}

export interface ResourceCoverageCount {
  shown: number
  total: number
}

// Phase 2D: complete-fleet aggregate health counts. `total` is every evaluated resource
// regardless of monitored status (e.g. includes RDS, which is always monitored: false
// today); `monitored` is the subset with a live CloudWatch/control-plane signal;
// healthy/degraded/critical/down are computed only among monitored resources, matching
// the pre-2D client-side derivation's own precedent (an unmonitored resource's `status`
// is inventory-derived, not a live health verdict, so it was never counted in these
// buckets and still isn't).
export interface CloudWatchHealthSummary {
  total: number
  healthy: number
  degraded: number
  critical: number
  down: number
  monitored: number
}

// Phase 2D: same precedence the frontend used to compute client-side from `services`
// (down > critical > degraded > healthy), now computed server-side from the complete
// evaluated fleet's monitored resources -- see computeMetrics().
export type CloudWatchSystemStatus = 'healthy' | 'degraded' | 'critical' | 'down'

interface InventoryRow {
  // Phase 2D: the raw aws_resources.id UUID primary key -- distinct from resource_id
  // (the AWS-side identifier, e.g. an EC2 instance id). Used only as the deterministic
  // keyset-pagination tiebreaker (see getResourceInventory()'s ORDER BY and
  // cloudwatch-pagination.util.ts); never displayed. NOT populated on the separate,
  // unmodified evaluateResourceForSlo() query path -- that path never reads it.
  id: string
  resource_id: string
  resource_name: string | null
  resource_type: 'ec2' | 'rds' | 'load-balancer' | 'lambda' | 'dynamodb' | 'ecs' | 'eks' | 'ebs' | 'cloudfront' | 'aurora'
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
 *
 * This contract is CloudWatch-specific by design (cloudwatchNamespace/dimensionKey are
 * CloudWatch concepts). ECS deliberately does NOT implement this interface — its health
 * source is the ECS control plane (DescribeServices), not CloudWatch, and is evaluated by
 * a separate dedicated function below rather than being forced through evaluateResource().
 * Both still produce the same universal CloudWatchServiceHealth shape, unified in
 * getMetrics() — see the architecture note on evaluateEcsService() for why this is the
 * minimal honest version of "provider-agnostic" rather than a premature formal interface.
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

/**
 * ECS service ARNs look like arn:aws:ecs:region:account:service/cluster-name/service-name.
 * Discovery's generic extractResourceId() (lastIndexOf('/') vs lastIndexOf(':')) would
 * collapse this to just "service-name", silently dropping the cluster — which
 * DescribeServices requires alongside the service name. So ECS parses resource_arn
 * directly here rather than relying on resource_id, unlike every other generic type.
 */
function parseEcsClusterAndService(resourceArn: string): { cluster: string; service: string } | null {
  const match = resourceArn.match(/:service\/([^/]+)\/([^/]+)$/)
  if (!match) return null
  return { cluster: match[1], service: match[2] }
}

/**
 * CloudWatch Scalability Phase 2C: converts a raw batched TargetResponseTime series into
 * the same ResponseTimePoint[] shape the pre-2C getResponseTimeSeries() produced (Average
 * seconds -> rounded milliseconds, ascending by timestamp). Used to fold the primary ALB's
 * chart series out of its already-fetched current-window latencySec query result, instead
 * of issuing a second, duplicate GetMetricStatistics/GetMetricData call for the same
 * namespace/metric/dimensions/window the aggregate value was already computed from.
 */
function seriesToResponseTimePoints(series: BatchSeriesResult | null): ResponseTimePoint[] {
  if (!series) return []
  const points: ResponseTimePoint[] = []
  for (let i = 0; i < series.timestamps.length; i++) {
    const ts = series.timestamps[i]
    const v = series.values[i]
    if (ts === undefined || v === undefined) continue
    points.push({ timestamp: ts.getTime(), value: Math.round(v * 1000) })
  }
  return points.sort((a, b) => a.timestamp - b.timestamp)
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
        resourceDbId: instance.id,
        resourceSortName: instance.resource_name,
        name: instance.resource_name || instance.resource_id,
        description: `EC2 · ${instance.resource_id}`,
        resourceType: 'ec2',
        status,
        uptime,
        responseTimeMs: null,
        errorRate: null,
        critical: true,
        monitored: uptime !== null || cpu !== null,
        // CPU was already being computed above for status evaluation — previously
        // discarded after use, now also surfaced as a display metric.
        metrics: cpu !== null ? [{ label: 'CPU', value: Math.round(cpu * 10) / 10, unit: '%' }] : undefined,
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
      resourceDbId: r.id,
      resourceSortName: r.resource_name,
      name: r.resource_name || r.resource_id,
      description: `RDS · ${r.metadata?.engine ?? 'database'}`,
      resourceType: 'rds',
      status: r.status === 'available' ? 'healthy' : r.status === 'stopped' ? 'down' : 'unknown',
      uptime: null,
      responseTimeMs: null,
      errorRate: null,
      critical: true,
      monitored: false,
      // No CloudWatch data source yet — metrics intentionally omitted, not fabricated.
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
      resourceDbId: alb.id,
      resourceSortName: alb.resource_name,
      name: alb.resource_name || alb.resource_id,
      description: 'Application Load Balancer',
      resourceType: 'load-balancer',
      status: avgResponseTimeMs !== null ? (avgResponseTimeMs < 500 ? 'healthy' : 'degraded') : 'unknown',
      uptime: null,
      responseTimeMs: avgResponseTimeMs,
      errorRate,
      critical: false,
      monitored: avgResponseTimeMs !== null,
      metrics: [
        ...(requestsPerMinute !== null ? [{ label: 'Requests/min', value: requestsPerMinute }] : []),
        ...(errorRate !== null ? [{ label: 'Error rate', value: errorRate, unit: '%' }] : []),
      ],
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
        resourceDbId: fn.id,
        resourceSortName: fn.resource_name,
        name: fn.resource_name || fn.resource_id,
        description: `Lambda · ${fn.metadata?.runtime ?? 'function'}`,
        resourceType: 'lambda',
        status,
        uptime: null,
        responseTimeMs,
        errorRate,
        critical: false,
        monitored: invocations !== null,
        metrics: [
          ...(invocations !== null ? [{ label: 'Invocations', value: invocations }] : []),
          ...(errors !== null ? [{ label: 'Errors', value: errors }] : []),
        ],
      },
      extra: undefined,
    }
  },
}

// Below what count of throttled requests (summed across the whole lookback window) we
// treat throttling as a secondary factor rather than enough on its own, combined with
// SystemErrors, to justify 'critical'. This is a magnitude heuristic, not true "repeated
// over time" detection — a single-window Sum can't distinguish "many small bursts" from
// "one big burst"; that would need multiple evaluation periods, deliberately out of scope
// for this first pass. Easy to retune or replace once we have real production signal.
const DYNAMODB_MEANINGFUL_THROTTLE_THRESHOLD = 10

const dynamoDbCapability: ResourceCapability = {
  resourceType: 'dynamodb',
  cloudwatchNamespace: 'AWS/DynamoDB',
  dimensionKey: 'TableName',
  // Discovery stores the bare table name as resource_id (extracted from the ARN's
  // "table/Name" suffix by resourceExplorer.service.ts's extractResourceId) — same value
  // CloudWatch's TableName dimension expects, so no further parsing needed here.
  getDimensionValue: (table) => table.resource_id,
  metrics: [
    { key: 'systemErrors', metricName: 'SystemErrors', statistic: 'Sum' },
    { key: 'throttledRequests', metricName: 'ThrottledRequests', statistic: 'Sum' },
  ],
  healthRule: (table, values) => {
    const systemErrors = values.systemErrors
    const throttledRequests = values.throttledRequests

    const hasData = systemErrors !== null || throttledRequests !== null
    const hasSystemErrors = systemErrors !== null && systemErrors > 0
    const hasThrottling = throttledRequests !== null && throttledRequests > 0
    const hasMeaningfulThrottling = throttledRequests !== null && throttledRequests >= DYNAMODB_MEANINGFUL_THROTTLE_THRESHOLD

    let status: CloudWatchServiceHealth['status']
    let reason: string | null

    if (!hasData) {
      status = 'unknown'
      reason = 'No CloudWatch telemetry available for this table in the selected window'
    } else if (hasSystemErrors && hasMeaningfulThrottling) {
      status = 'critical'
      reason = 'DynamoDB system errors with significant throttling detected'
    } else if (hasSystemErrors) {
      status = 'degraded'
      reason = 'DynamoDB system errors detected'
    } else if (hasThrottling) {
      status = 'degraded'
      reason = 'DynamoDB throttling detected'
    } else {
      status = 'healthy'
      reason = null
    }

    return {
      service: {
        resourceId: table.resource_id,
        resourceDbId: table.id,
        resourceSortName: table.resource_name,
        name: table.resource_name || table.resource_id,
        description: 'DynamoDB table',
        resourceType: 'dynamodb',
        status,
        uptime: null,
        responseTimeMs: null,
        errorRate: null,
        critical: false,
        monitored: hasData,
        reason,
        signals: { systemErrors, throttledRequests },
        metrics: [
          ...(systemErrors !== null ? [{ label: 'System errors', value: systemErrors }] : []),
          ...(throttledRequests !== null ? [{ label: 'Throttled', value: throttledRequests }] : []),
        ],
      },
      extra: undefined,
    }
  },
}

// Adding a future CloudWatch-backed resource type means adding a capability definition
// here — the fetch/dimension plumbing in evaluateResource() is generic. ECS is
// deliberately NOT in this registry — see evaluateEcsService() below and the
// ResourceCapability doc comment for why.
const resourceTypeRegistry: {
  ec2: ResourceCapability
  rds: ResourceCapability
  'load-balancer': ResourceCapability<AlbExtra>
  lambda: ResourceCapability
  dynamodb: ResourceCapability
} = {
  ec2: ec2Capability,
  rds: rdsCapability,
  'load-balancer': loadBalancerCapability,
  lambda: lambdaCapability,
  dynamodb: dynamoDbCapability,
}

/**
 * INTERNAL ENGINEERING TRACKING ONLY — never serialized into any API response, never
 * imported by frontend code. Distinguishes three genuinely different milestones that are
 * easy to conflate in conversation and backlog notes: code that compiles, code that's
 * deployed and running, and code that's actually been exercised against real customer
 * AWS data. A clean deploy proves the code runs; it does not prove the feature works
 * against real infrastructure. Update this by hand when a capability crosses a milestone
 * (e.g. the first time a real ECS service is discovered and evaluateEcsService() actually
 * executes a DescribeServices call against it, bump ecs to 'live_verified').
 */
type ValidationLevel = 'compiled' | 'deployed' | 'live_verified'

const CAPABILITY_VALIDATION_STATUS: Record<CloudWatchServiceHealth['resourceType'], ValidationLevel> = {
  ec2: 'live_verified',
  rds: 'live_verified',
  'load-balancer': 'live_verified',
  lambda: 'live_verified',
  // Only the no-data/Unknown path has been exercised against a real (disposable) inventory
  // row in production. Healthy/Degraded/Critical are correct by code+type review only.
  dynamodb: 'deployed',
  // Deployed and type-safe; DescribeServices has never actually been called against real
  // AWS data — this account has zero ECS resources. IAM permission for
  // ecs:DescribeServices is also unconfirmed. Bump to 'live_verified' once a real or
  // disposable ECS service has been evaluated end-to-end.
  ecs: 'deployed',
  // Deployed and type-safe; eks:DescribeCluster has never actually been called against a
  // real cluster — the connected test account (815931739526, us-east-1 + us-west-2) has
  // zero EKS clusters. Unlike ECS, the IAM permission itself IS confirmed: live-tested via
  // eks:DescribeCluster/ListNodegroups/DescribeNodegroup against a nonexistent cluster name
  // under the connected org's actual assumed role (DevControlRole-Test, AWS managed
  // ReadOnlyAccess) — got ResourceNotFoundException, not AccessDeniedException, proving the
  // permission is granted without needing a real cluster to exist. That role uses a broad
  // managed policy, not necessarily representative of a real customer's least-privilege
  // onboarding grant. Bump to 'live_verified' once a real or disposable EKS cluster has
  // been evaluated end-to-end.
  eks: 'deployed',
  // Service Health Coverage Expansion: live-verified 2026-09-14 in production (account
  // 815931739526, us-east-1) against two real EBS volumes (vol-01f542a56c1d5e998,
  // available; and the devcontrol-backend instance's attached root volume, in-use) —
  // ec2:DescribeVolumeStatus succeeded (IAM permission confirmed granted, distinct from
  // discovery's own ec2:DescribeVolumes), both resolved VolumeStatus.Status 'ok', and
  // evaluateEbsVolumes() correctly mapped both to 'healthy' with monitored: true and a
  // real "Status check events" signal — confirmed via the authenticated Infrastructure
  // Intelligence page, not generic Resource Explorer inventory data (which would show
  // status 'unknown' and a "Not monitored" pill instead).
  ebs: 'live_verified',
  // Deployed and type-safe; the AWS/CloudFront GetMetricData call (see
  // evaluateCloudFrontDistributions()) has never been called against real distribution
  // data — this account has zero CloudFront distributions. IAM permission for
  // cloudwatch:GetMetricData in us-east-1 for the AWS/CloudFront namespace is unconfirmed.
  // Bump to 'live_verified' once a real or disposable distribution has been evaluated
  // end-to-end.
  cloudfront: 'deployed',
  // Aurora Service Health: deployed and type-safe; rds:DescribeDBClusters (see
  // evaluateAuroraClusters()) has never been called against real cluster data --
  // this account has zero Aurora/RDS DB clusters. IAM permission for both
  // rds:DescribeDBClusters and cloudwatch:GetMetricData (AWS/RDS namespace,
  // DBClusterIdentifier+Role dimensions) was confirmed granted to the production
  // application role via a temporary, read-only assumed-role probe (2026-09-14) --
  // real API access, not a real cluster's health evaluated end-to-end. Bump to
  // 'live_verified' once a real or disposable Aurora cluster has been evaluated
  // end-to-end -- do not provision one merely to reach that status.
  aurora: 'deployed',
}

// SLO 3A: the subset of resourceTypeRegistry with a live_verified CloudWatch capability
// that also produces a meaningful single-resource health signal. RDS/ECS/EKS are
// deliberately excluded -- see CAPABILITY_VALIDATION_STATUS and evaluateEcsService/
// evaluateEksService's doc comments -- and DynamoDB is excluded because its validation
// level is still 'deployed', not 'live_verified' (see the audit this feature is built
// from). Widening this set is a deliberate follow-up, not something to do here.
export type SloResourceType = 'ec2' | 'load-balancer' | 'lambda'
export type SloWindow = Extract<MonitoringRange, '24h' | '7d'>

export interface SloResourceObservation {
  // False only when the SLO's configured resource_id no longer exists in this org's
  // discovered inventory (e.g. it was terminated/re-discovered under a new id) --
  // distinct from `monitored`, which covers "the resource exists but CloudWatch has no
  // data for it right now".
  resourceExists: boolean
  // Mirrors CloudWatchServiceHealth.monitored: true only if CloudWatch actually returned
  // at least one datapoint for every metric this resource type's health rule depends on.
  // False covers BOTH "no datapoints in this window" and "the underlying CloudWatch call
  // itself failed" -- getMetricStat()'s catch block (below) does not distinguish those
  // two cases today, so this honestly doesn't either, rather than fabricating a
  // distinction the reused code can't actually make. See slo.service.ts's evaluate().
  monitored: boolean
  uptime: number | null
  avgLatencyMs: number | null
  errorRatePercent: number | null
}

// CloudWatch Scalability Phase 2A: response cache for getMetrics(). 45s TTL, matching
// the Phase 2 scoping decision (just under the frontend's existing 60s poll interval, so
// a normal poll almost always hits a fresh entry). Mirrors the established pattern in
// aws-cost.service.ts's monthlyCostCache/monthlyCostInFlight -- an in-process Map, not
// Redis, because CloudWatchService (like AWSCostService) is instantiated once per
// process (see cloudwatch.routes.ts) and PM2 runs devcontrol-api in fork_mode (a single
// process), so no cross-instance staleness is possible today. Would need to move to a
// shared store only if this deployment ever became multi-instance.
const METRICS_CACHE_TTL_MS = 45 * 1000

interface CachedMetricsEntry {
  data: CloudWatchMetrics | null
  cachedAt: number
}

export class CloudWatchService {
  // Keyed by `${organizationId}:${resolvedRange}` -- see metricsCacheKey(). This cache is
  // an efficiency layer only; it never widens who can see what. Every cached entry was
  // itself produced by computeMetrics()'s own organization-scoped queries and AWS calls,
  // so a cache hit returns exactly what a fresh call for that same org+range would have
  // returned moments earlier -- tenant isolation is inherited from computeMetrics(), not
  // reimplemented here.
  private metricsCache = new Map<string, CachedMetricsEntry>()
  // In-flight promise per cache key, so concurrent identical requests (e.g. two browser
  // tabs polling the same org+range at once) share one upstream computation instead of
  // each independently re-running the full AWS/CloudWatch sweep.
  private metricsInFlight = new Map<string, Promise<CloudWatchMetrics | null>>()

  private metricsCacheKey(organizationId: string, resolvedRange: MonitoringRange): string {
    return `${organizationId}:${resolvedRange}`
  }

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
    // Phase 2D: `id ASC` is a required tiebreaker, not cosmetic -- resource_name has no
    // uniqueness constraint (can collide or be NULL for multiple rows), so without it
    // this is not a strict total order. Deterministic keyset pagination (see
    // cloudwatch-pagination.util.ts) depends on this exact order -- type bucket (fixed
    // downstream in computeMetrics()'s services[] concatenation), then resource_name ASC
    // NULLS LAST, then id ASC -- being stable across requests within a cache window.
    const { rows } = await pool.query(
      `SELECT id, resource_id, resource_name, resource_type, resource_arn, status, metadata
       FROM aws_resources
       WHERE organization_id = $1
         AND resource_type IN ('ec2', 'rds', 'load-balancer', 'lambda', 'dynamodb', 'ecs', 'eks', 'ebs', 'cloudfront', 'aurora')
         AND status != 'terminated'
       ORDER BY resource_name ASC NULLS LAST, id ASC`,
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

  /**
   * CloudWatch Scalability Phase 2C: batches every resource's CloudWatch-backed metrics
   * for one capability into as few GetMetricData requests as possible, then runs the SAME
   * unmodified capability.healthRule() per resource that evaluateResource() above always
   * has -- this function only changes how the raw values are fetched, never what they
   * mean. Used today by EC2/Lambda/DynamoDB (a single current-window batch) and ALB (a
   * current-window batch plus a second, independent previous-window batch, dispatched
   * concurrently -- see the two-window split below). RDS has no CloudWatch metrics wired
   * and still goes through the unbatched evaluateResource() in its own task, since there
   * is no AWS call to batch there either way; evaluateResourceForSlo() also still uses
   * evaluateResource() directly for its single-named-resource lookups, unaffected by this
   * phase.
   *
   * A resource whose dimension value can't be resolved (e.g. a malformed ARN) is dropped
   * entirely, same as evaluateResource() returning null for it before.
   *
   * Query Ids are `${typePrefix}${resourceIndex}_${metricIndex}` -- built from array
   * indices, never from the resource's own identifier. AWS resource identifiers (EC2
   * instance IDs, ALB dimension values, Lambda function names, DynamoDB table names)
   * routinely contain hyphens, slashes, or periods, none of which MetricDataQuery.Id
   * permits (letters, digits, and underscore only, with a lowercase-leading first
   * character) -- see the Phase 2C scoping audit. Index-based Ids sidestep this entirely
   * and are trivially collision-safe within one capability's own batch.
   *
   * Returns, alongside each resource's evaluated {service, extra}, the raw current-window
   * series per resource (keyed by metric key) that was already fetched -- so a caller
   * needing a chart-quality series for one specific resource (only ALB's primary-ALB
   * response-time history today) can reuse an already-fetched query's result instead of
   * issuing a second, duplicate CloudWatch request for the same data.
   */
  private async evaluateCapabilityBatch<TExtra>(
    client: CloudWatchClient,
    capability: ResourceCapability<TExtra>,
    resources: InventoryRow[],
    typePrefix: string,
    currentStart: Date,
    previousStart: Date,
    now: Date,
    periodSeconds: number,
    lookbackSeconds: number
  ): Promise<{
    evaluations: Array<{ service: CloudWatchServiceHealth; extra: TExtra }>
    currentSeriesByResource: Array<Record<string, BatchSeriesResult | null>>
  }> {
    if (!capability.cloudwatchNamespace || !capability.dimensionKey) {
      // No CloudWatch metrics wired for this capability (e.g. RDS) -- every resource's
      // healthRule runs with an empty values map, exactly as evaluateResource() did
      // before, with no AWS call at all. (Not exercised via this method in practice today
      // -- RDS's task still calls evaluateResource() directly -- kept here only so this
      // method stays a correct, general-purpose replacement for evaluateResource().)
      return {
        evaluations: resources.map((r) => capability.healthRule(r, {}, { lookbackSeconds, dims: [] })),
        currentSeriesByResource: resources.map(() => ({})),
      }
    }

    const namespace = capability.cloudwatchNamespace
    const dimensionKey = capability.dimensionKey

    const contexts: Array<{ resource: InventoryRow; dims: Dimension[] }> = []
    for (const resource of resources) {
      const dimValue = capability.getDimensionValue(resource)
      if (dimValue === null) continue
      contexts.push({ resource, dims: [{ Name: dimensionKey, Value: dimValue }] })
    }

    const currentQueries: BatchMetricQuery[] = []
    const previousQueries: BatchMetricQuery[] = []
    // resourceIndex -> metricKey -> queryId, so results can be looked up per resource
    // without re-deriving the id format at read time.
    const idsByResource: Array<Record<string, string>> = contexts.map(() => ({}))

    contexts.forEach((ctx, resourceIndex) => {
      capability.metrics.forEach((metric, metricIndex) => {
        const id = `${typePrefix}${resourceIndex}_${metricIndex}`
        idsByResource[resourceIndex][metric.key] = id
        const query: BatchMetricQuery = {
          id,
          namespace,
          metricName: metric.metricName,
          dimensions: ctx.dims,
          period: periodSeconds,
          stat: metric.statistic,
        }
        if (metric.window === 'previous') previousQueries.push(query)
        else currentQueries.push(query)
      })
    })

    // GetMetricData's StartTime/EndTime are request-level, shared by every query in one
    // call -- current-window and previous-window metrics can never be combined into a
    // single request, so this always issues up to two independent requests. When a
    // capability has no previous-window metric (EC2/Lambda/DynamoDB today), previousQueries
    // is empty and fetchMetricDataBatch() returns immediately with no AWS call at all --
    // dispatched via the same Promise.all() regardless, so the two windows are always
    // concurrent when both are real requests (ALB today), never serialized.
    const [currentResults, previousResults] = await Promise.all([
      fetchMetricDataBatch(client, currentQueries, currentStart, now),
      fetchMetricDataBatch(client, previousQueries, previousStart, currentStart),
    ])

    const currentSeriesByResource: Array<Record<string, BatchSeriesResult | null>> = contexts.map(() => ({}))
    const evaluations = contexts.map((ctx, resourceIndex) => {
      const values: Record<string, number | null> = {}
      capability.metrics.forEach((metric) => {
        const id = idsByResource[resourceIndex][metric.key]
        const isPrevious = metric.window === 'previous'
        const series = (isPrevious ? previousResults : currentResults).get(id) ?? null
        if (!isPrevious) currentSeriesByResource[resourceIndex][metric.key] = series
        values[metric.key] = reduceSeriesToScalar(series, metric.statistic)
      })
      return capability.healthRule(ctx.resource, values, { lookbackSeconds, dims: ctx.dims })
    })

    return { evaluations, currentSeriesByResource }
  }

  /**
   * ECS control-plane health, evaluated separately from the CloudWatch-only registry
   * above. ECS's authoritative health signal — desired/running/pending task counts and
   * service lifecycle state — comes from the ECS API's DescribeServices, not CloudWatch.
   * CloudWatch does support ClusterName+ServiceName CPU/Memory metrics without Container
   * Insights, but those are supplemental utilization numbers, not the control-plane
   * source of truth; wiring them in as a secondary signal is a deliberate later step, not
   * done here. This still returns the same universal CloudWatchServiceHealth shape so
   * getMetrics() can unify it with every CloudWatch-backed type with no special casing
   * downstream — the shared *output* contract is what matters, not a shared internal
   * execution engine that ECS doesn't naturally fit.
   */
  private async evaluateEcsService(client: ECSClient, resource: InventoryRow): Promise<CloudWatchServiceHealth> {
    const parsed = parseEcsClusterAndService(resource.resource_arn)

    if (!parsed) {
      return {
        resourceId: resource.resource_id,
        resourceDbId: resource.id,
        resourceSortName: resource.resource_name,
        name: resource.resource_name || resource.resource_id,
        description: 'ECS service',
        resourceType: 'ecs',
        status: 'unknown',
        uptime: null,
        responseTimeMs: null,
        errorRate: null,
        critical: false,
        monitored: false,
        reason: 'Could not determine cluster/service from resource ARN',
      }
    }

    try {
      const response = await client.send(
        new DescribeServicesCommand({ cluster: parsed.cluster, services: [parsed.service] })
      )

      const svc = response.services?.[0]
      const hasFailure = (response.failures?.length ?? 0) > 0

      if (!svc || hasFailure) {
        return {
          resourceId: resource.resource_id,
          resourceDbId: resource.id,
          resourceSortName: resource.resource_name,
          name: resource.resource_name || resource.resource_id,
          description: `ECS · ${parsed.cluster}`,
          resourceType: 'ecs',
          status: 'unknown',
          uptime: null,
          responseTimeMs: null,
          errorRate: null,
          critical: false,
          monitored: false,
          reason: hasFailure
            ? (response.failures?.[0]?.reason ?? 'ECS reported a failure describing this service')
            : 'ECS service not found',
        }
      }

      const desiredCount = svc.desiredCount ?? 0
      const runningCount = svc.runningCount ?? 0
      const pendingCount = svc.pendingCount ?? 0
      const ecsStatus = svc.status

      // Service lifecycle state (ACTIVE/DRAINING/INACTIVE) is a different concept from
      // task health (running vs. desired count) — a DRAINING service is often a
      // deliberate, in-progress scale-down or deployment, not a failure, so it's
      // Degraded rather than Down. INACTIVE means genuinely deleted/deactivated.
      let status: CloudWatchServiceHealth['status']
      let reason: string | null
      if (ecsStatus === 'INACTIVE') {
        status = 'down'
        reason = 'ECS service is inactive'
      } else if (ecsStatus === 'DRAINING') {
        status = 'degraded'
        reason = 'ECS service is draining (scale-down or deployment in progress)'
      } else if (runningCount === 0 && desiredCount > 0) {
        status = 'critical'
        reason = 'No tasks running for a service with a nonzero desired count'
      } else if (runningCount < desiredCount) {
        status = 'degraded'
        reason = `Running ${runningCount} of ${desiredCount} desired tasks`
      } else if (ecsStatus === 'ACTIVE') {
        status = 'healthy'
        reason = null
      } else {
        status = 'unknown'
        reason = `Unrecognized ECS service status: ${ecsStatus ?? 'none'}`
      }

      return {
        resourceId: resource.resource_id,
        resourceDbId: resource.id,
        resourceSortName: resource.resource_name,
        name: resource.resource_name || resource.resource_id,
        description: `ECS · ${parsed.cluster}`,
        resourceType: 'ecs',
        status,
        uptime: null,
        responseTimeMs: null,
        errorRate: null,
        critical: false,
        monitored: true,
        reason,
        signals: { desiredCount, runningCount, pendingCount },
        metrics: [
          { label: 'Running', value: runningCount },
          { label: 'Desired', value: desiredCount },
          { label: 'Pending', value: pendingCount },
        ],
      }
    } catch (err) {
      console.error(`[ECS] DescribeServices failed for ${parsed.cluster}/${parsed.service}:`, err)
      return {
        resourceId: resource.resource_id,
        resourceDbId: resource.id,
        resourceSortName: resource.resource_name,
        name: resource.resource_name || resource.resource_id,
        description: `ECS · ${parsed.cluster}`,
        resourceType: 'ecs',
        status: 'unknown',
        uptime: null,
        responseTimeMs: null,
        errorRate: null,
        critical: false,
        monitored: false,
        reason: 'Failed to reach the ECS API for this service',
      }
    }
  }

  /**
   * EKS cluster control-plane health, evaluated separately from the CloudWatch-only
   * registry above — same reasoning as evaluateEcsService(), but the authoritative
   * signal here is even more direct than ECS's derived task counts: DescribeCluster
   * returns both `status` (lifecycle) AND `health.issues` (a purpose-built, AWS-curated
   * list of control-plane problems — IamRoleNotFound, Ec2SubnetNotFound,
   * ClusterUnreachable, UnsupportedVersion, KmsKeyDisabled, etc. — live-verified against
   * the installed @aws-sdk/client-eks type definitions). This is a genuine AWS-reported
   * verdict, not something DevControl has to infer from proxy metrics.
   *
   * There is no "AWS/EKS" CloudWatch namespace publishing always-on free metrics the way
   * AWS/EC2 or AWS/RDS do, and Container Insights — the only path to EKS CloudWatch
   * telemetry — cannot be assumed enabled for any given customer cluster (both
   * live-verified empty against the one connected test account, region us-east-1 and
   * us-west-2). So, like ECS, this bypasses evaluateResource() and the CloudWatch-dimension
   * registry entirely; there is currently no CloudWatch signal for EKS to fetch.
   *
   * Node-group-level detail (eks:ListNodegroups / eks:DescribeNodegroup — permissions
   * confirmed available, live-tested against the connected test account's IAM role) is
   * deliberately not fetched here. Cluster-level status+health is a complete, independent
   * signal on its own; per-nodegroup health is additive future work, not required for a
   * correct first version — see the audit note in this change's PR description.
   *
   * Scope boundary, stated explicitly: every signal here — `status` AND `health.issues`
   * alike — is control-plane-level. It answers "does AWS's EKS control plane consider
   * this cluster provisioned and reachable," never "are the workloads running on it
   * healthy." Pod/container status, Deployment rollout state, and node `Ready` conditions
   * are Kubernetes-API-level concepts that DescribeCluster/DescribeNodegroup cannot see
   * into at all — that would need a network path to each cluster's API server plus
   * cluster-side RBAC/access-entry grants this codebase's assumed-role architecture
   * doesn't have. Deliberately not approximated by anything below; a `healthy` result
   * here means "AWS reports no control-plane problems," not "the cluster's workloads
   * are healthy."
   */
  private async evaluateEksService(client: EKSClient, resource: InventoryRow): Promise<CloudWatchServiceHealth> {
    try {
      const response = await client.send(new DescribeClusterCommand({ name: resource.resource_id }))
      const cluster = response.cluster

      if (!cluster) {
        return {
          resourceId: resource.resource_id,
          resourceDbId: resource.id,
          resourceSortName: resource.resource_name,
          name: resource.resource_name || resource.resource_id,
          description: 'EKS cluster',
          resourceType: 'eks',
          status: 'unknown',
          uptime: null,
          responseTimeMs: null,
          errorRate: null,
          critical: false,
          monitored: false,
          reason: 'EKS cluster not found via the EKS API',
        }
      }

      const issues = cluster.health?.issues ?? []
      const clusterStatus = cluster.status

      // Lifecycle state (CREATING/UPDATING/DELETING/PENDING) is a different concept from
      // control-plane health (health.issues) — an in-progress AWS-driven operation isn't
      // a failure, mirroring evaluateEcsService()'s DRAINING/INACTIVE split. Only FAILED
      // is a lifecycle-level failure on its own; ACTIVE clusters are further checked
      // against health.issues, since that field is only meaningfully populated in that
      // state. PENDING (EKS-Anywhere/local clusters) and any unrecognized future status
      // fall through to 'unknown' — DevControl has no rule for those, and guessing would
      // be exactly the "terminated -> false critical" mistake class from the prior audit.
      let status: CloudWatchServiceHealth['status']
      let reason: string | null
      if (clusterStatus === 'FAILED') {
        status = 'critical'
        reason = 'EKS cluster is in a failed state'
      } else if (clusterStatus === 'CREATING' || clusterStatus === 'UPDATING' || clusterStatus === 'DELETING') {
        status = 'degraded'
        reason = `EKS cluster is ${clusterStatus.toLowerCase()} (in-progress AWS operation, not a failure)`
      } else if (clusterStatus === 'ACTIVE') {
        if (issues.length > 0) {
          status = 'critical'
          reason = issues.map((i) => i.message ?? i.code).filter(Boolean).join('; ') || 'EKS reported cluster health issues'
        } else {
          status = 'healthy'
          reason = null
        }
      } else {
        status = 'unknown'
        reason = `Unrecognized or unsupported EKS cluster status: ${clusterStatus ?? 'none'}`
      }

      return {
        resourceId: resource.resource_id,
        resourceDbId: resource.id,
        resourceSortName: resource.resource_name,
        name: resource.resource_name || resource.resource_id,
        description: `EKS · Kubernetes ${cluster.version ?? 'unknown version'}`,
        resourceType: 'eks',
        status,
        uptime: null,
        responseTimeMs: null,
        errorRate: null,
        // Matches ECS's judgment call, not EC2/RDS's — a container-orchestration control
        // plane, not a single compute/database instance.
        critical: false,
        monitored: true,
        reason,
        signals: { issueCount: issues.length },
        metrics: [{ label: 'Health issues', value: issues.length }],
      }
    } catch (err) {
      console.error(`[EKS] DescribeCluster failed for ${resource.resource_id}:`, err)
      return {
        resourceId: resource.resource_id,
        resourceDbId: resource.id,
        resourceSortName: resource.resource_name,
        name: resource.resource_name || resource.resource_id,
        description: 'EKS cluster',
        resourceType: 'eks',
        status: 'unknown',
        uptime: null,
        responseTimeMs: null,
        errorRate: null,
        critical: false,
        monitored: false,
        reason: 'Failed to reach the EKS API for this cluster',
      }
    }
  }

  /**
   * Service Health Coverage Expansion: EBS volume health, evaluated separately from the
   * CloudWatch-only registry above — same reasoning as evaluateEcsService()/
   * evaluateEksService(): EBS's authoritative health source is not a CloudWatch namespace
   * but ec2:DescribeVolumeStatus, the same AWS-native "volume status check" mechanism
   * EC2's own StatusCheckFailed CloudWatch metric is itself derived from for instances (no
   * equivalent metric is published for volumes, so the check must be called directly).
   *
   * Unlike ECS/EKS's one-call-per-resource pattern, DescribeVolumeStatus accepts a batch
   * of VolumeIds in one paginated call — so, like the CloudWatch capabilities' GetMetricData
   * batching, this fetches the whole fleet's live status in as few AWS calls as possible
   * (chunked defensively; ID count is unbounded in practice), never one call per volume.
   *
   * Two independent evidence sources are combined, both already real AWS state:
   * - `resource.status`, already stored from discovery's own DescribeVolumes call (the
   *   volume's lifecycle State: available/in-use/creating/deleting/deleted/error) — reused
   *   here with zero additional AWS calls, exactly as EC2's capability reuses
   *   instance.status for its own down-state override.
   * - The live VolumeStatus.Status from this method's own DescribeVolumeStatus call
   *   (ok/impaired/warning/insufficient-data) — AWS's own volume-level health verdict,
   *   analogous to EC2's status-check-derived uptime.
   *
   * A volume attached vs. unattached ("available") is deliberately NOT treated as a health
   * signal here — that is orphaned-resource/cost-waste territory (see
   * orphanedResourceDetector.ts), a different concern from "is this volume healthy."
   */
  private async evaluateEbsVolumes(client: EC2Client, volumes: InventoryRow[]): Promise<CloudWatchServiceHealth[]> {
    if (volumes.length === 0) return []

    const statusByVolumeId = new Map<string, VolumeStatusItem>()
    const CHUNK_SIZE = 200
    for (let offset = 0; offset < volumes.length; offset += CHUNK_SIZE) {
      const chunkIds = volumes.slice(offset, offset + CHUNK_SIZE).map((v) => v.resource_id)
      try {
        for await (const page of paginateDescribeVolumeStatus({ client }, { VolumeIds: chunkIds })) {
          for (const item of page.VolumeStatuses ?? []) {
            if (item.VolumeId) statusByVolumeId.set(item.VolumeId, item)
          }
        }
      } catch (err) {
        // This chunk's volumes fall through to the no-live-status branch below (still
        // evaluated from resource.status alone, never silently dropped) — other chunks
        // already fetched, or not yet attempted, are unaffected, mirroring
        // fetchMetricDataBatch's per-chunk failure isolation.
        console.error('[EBS] DescribeVolumeStatus failed for a chunk of volumes:', err)
      }
    }

    return volumes.map((volume) => {
      const state = volume.status
      const live = statusByVolumeId.get(volume.resource_id)
      const checkStatus = live?.VolumeStatus?.Status
      const eventCount = live?.Events?.length ?? 0

      let status: CloudWatchServiceHealth['status']
      let reason: string | null
      let monitored: boolean

      if (state === 'error') {
        status = 'down'
        reason = 'AWS reports this volume is in an error state'
        monitored = true
      } else if (state === 'deleting' || state === 'deleted') {
        status = 'down'
        reason = `Volume is ${state}`
        monitored = true
      } else if (checkStatus === 'ok') {
        status = 'healthy'
        reason = null
        monitored = true
      } else if (checkStatus === 'impaired') {
        status = 'critical'
        reason = 'AWS volume status check reports this volume as impaired'
        monitored = true
      } else if (checkStatus === 'warning') {
        status = 'degraded'
        reason = 'AWS volume status check reports a warning for this volume'
        monitored = true
      } else if (checkStatus === 'insufficient-data') {
        status = 'unknown'
        reason = 'AWS has insufficient data to determine this volume\'s status check'
        monitored = true
      } else if (state === 'creating') {
        status = 'unknown'
        reason = 'Volume is still being created'
        monitored = false
      } else {
        status = 'unknown'
        reason = 'No volume status check data available for this volume'
        monitored = false
      }

      return {
        resourceId: volume.resource_id,
        resourceDbId: volume.id,
        resourceSortName: volume.resource_name,
        name: volume.resource_name || volume.resource_id,
        description: `EBS · ${volume.metadata?.volume_type ?? 'volume'}`,
        resourceType: 'ebs',
        status,
        uptime: null,
        responseTimeMs: null,
        errorRate: null,
        // Supporting storage infrastructure, not a primary compute/data resource — matches
        // ALB/Lambda/DynamoDB/ECS/EKS's judgment call, not EC2/RDS's.
        critical: false,
        monitored,
        reason,
        ...(live ? { signals: { eventCount }, metrics: [{ label: 'Status check events', value: eventCount }] } : {}),
      }
    })
  }

  /**
   * Service Health Coverage Expansion: CloudFront distribution health. Bypasses the
   * ResourceCapability registry (like EBS/ECS/EKS above) for a different reason than any
   * of them: CloudFront's CloudWatch metrics require BOTH a DistributionId dimension AND a
   * fixed Region="Global" dimension together, which ResourceCapability's single
   * dimensionKey/getDimensionValue contract has no way to express without changing that
   * shared interface (and, with it, every other capability) — see the
   * ResourceCapability doc comment. This still reuses fetchMetricDataBatch directly (the
   * same Phase 2C GetMetricData batching utility evaluateCapabilityBatch() itself calls
   * internally), so the whole CloudFront fleet's metrics are still fetched in as few
   * requests as the 500-query batch limit allows -- never one request per distribution.
   *
   * CloudFront metrics are published ONLY to us-east-1's CloudWatch regardless of the
   * distribution's own configuration (a global service) -- the caller must pass a
   * us-east-1-scoped CloudWatchClient (see AWSClientFactory.getCloudWatchClientForRegion),
   * never the org's default-region client every other capability uses.
   *
   * Deployment/enabled state (dist.Status/dist.Enabled, already captured by discovery's
   * discoverCloudFrontDistributions with zero extra AWS calls -- resource.status is
   * 'active' only when AWS reports Status === 'Deployed') is checked BEFORE any
   * CloudWatch-derived error rate, mirroring evaluateEcsService's lifecycle-before-metrics
   * precedence: a distribution that AWS itself reports as disabled or still propagating
   * shouldn't be called "healthy" just because no errors have been recorded for it yet.
   *
   * Thresholds below are a first-pass heuristic, not a validated SLO -- same caveat as
   * dynamoDbCapability's DYNAMODB_MEANINGFUL_THROTTLE_THRESHOLD -- easy to retune once
   * real production error-rate distributions are observed.
   */
  private async evaluateCloudFrontDistributions(
    cloudWatchUsEast1: CloudWatchClient,
    distributions: InventoryRow[],
    currentStart: Date,
    now: Date,
    periodSeconds: number
  ): Promise<CloudWatchServiceHealth[]> {
    if (distributions.length === 0) return []

    const metricDefs: { key: string; metricName: string }[] = [
      { key: 'totalErrorRate', metricName: 'TotalErrorRate' },
      { key: 'rate4xx', metricName: '4xxErrorRate' },
      { key: 'rate5xx', metricName: '5xxErrorRate' },
    ]

    const queries: BatchMetricQuery[] = []
    // distributionIndex -> metricKey -> queryId
    const idsByDistribution: Array<Record<string, string>> = distributions.map(() => ({}))

    distributions.forEach((dist, distIndex) => {
      const dims: Dimension[] = [
        { Name: 'DistributionId', Value: dist.resource_id },
        { Name: 'Region', Value: 'Global' },
      ]
      metricDefs.forEach((metric, metricIndex) => {
        const id = `cf${distIndex}_${metricIndex}`
        idsByDistribution[distIndex][metric.key] = id
        queries.push({
          id,
          namespace: 'AWS/CloudFront',
          metricName: metric.metricName,
          dimensions: dims,
          period: periodSeconds,
          stat: 'Average',
        })
      })
    })

    const results = await fetchMetricDataBatch(cloudWatchUsEast1, queries, currentStart, now)

    return distributions.map((dist, distIndex) => {
      const totalErrorRate = reduceSeriesToScalar(
        results.get(idsByDistribution[distIndex].totalErrorRate) ?? null,
        'Average'
      )
      const rate4xxRaw = reduceSeriesToScalar(results.get(idsByDistribution[distIndex].rate4xx) ?? null, 'Average')
      const rate5xxRaw = reduceSeriesToScalar(results.get(idsByDistribution[distIndex].rate5xx) ?? null, 'Average')
      // CloudFront reports error rates as fractions (0.0-1.0), not percentages — convert
      // once here so status thresholds and displayed metrics both work in the same units
      // every other percentage-based capability (ALB/Lambda/DynamoDB) already uses.
      const totalErrorPct = totalErrorRate !== null ? Math.round(totalErrorRate * 10000) / 100 : null
      const rate4xxPct = rate4xxRaw !== null ? Math.round(rate4xxRaw * 10000) / 100 : null
      const rate5xxPct = rate5xxRaw !== null ? Math.round(rate5xxRaw * 10000) / 100 : null

      const isEnabled = dist.metadata?.is_enabled
      const isDeployed = dist.status === 'active'

      let status: CloudWatchServiceHealth['status']
      let reason: string | null
      let monitored: boolean

      if (isEnabled === false) {
        status = 'down'
        reason = 'Distribution is disabled'
        monitored = true
      } else if (!isDeployed) {
        status = 'degraded'
        reason = 'Distribution configuration is still propagating (not yet Deployed)'
        monitored = true
      } else if (totalErrorPct === null) {
        status = 'unknown'
        reason = 'No CloudWatch telemetry available for this distribution in the selected window'
        monitored = false
      } else if (totalErrorPct >= 25) {
        status = 'critical'
        reason = `Elevated error rate (${totalErrorPct}% of requests failing)`
        monitored = true
      } else if (totalErrorPct >= 5) {
        status = 'degraded'
        reason = `Error rate above normal (${totalErrorPct}%)`
        monitored = true
      } else {
        status = 'healthy'
        reason = null
        monitored = true
      }

      return {
        resourceId: dist.resource_id,
        resourceDbId: dist.id,
        resourceSortName: dist.resource_name,
        name: dist.resource_name || dist.resource_id,
        description: 'CloudFront distribution',
        resourceType: 'cloudfront',
        status,
        uptime: null,
        responseTimeMs: null,
        errorRate: totalErrorPct,
        // Edge/CDN layer, not a primary compute/data resource — matches
        // ALB/Lambda/DynamoDB/ECS/EKS/EBS's judgment call, not EC2/RDS's.
        critical: false,
        monitored,
        reason,
        signals: { totalErrorPct, rate4xxPct, rate5xxPct },
        metrics: [
          ...(rate4xxPct !== null ? [{ label: '4xx rate', value: rate4xxPct, unit: '%' }] : []),
          ...(rate5xxPct !== null ? [{ label: '5xx rate', value: rate5xxPct, unit: '%' }] : []),
        ],
      }
    })
  }

  // CPU thresholds are PROPOSED PRODUCT BEHAVIOR, not AWS-defined boundaries -- see the
  // approved Aurora contract. <80 healthy, 80-90 inclusive degraded, >90 critical.
  private static auroraCpuStatus(cpuPercent: number | null): 'healthy' | 'degraded' | 'critical' | null {
    if (cpuPercent === null) return null
    if (cpuPercent > 90) return 'critical'
    if (cpuPercent >= 80) return 'degraded'
    return 'healthy'
  }

  // Replica-lag thresholds, same PROPOSED PRODUCT BEHAVIOR caveat. <1000ms healthy,
  // 1000-5000ms inclusive degraded, >5000ms critical. Returns null (ambiguous/transient,
  // never forced to 'unknown' on its own) when a datapoint is genuinely missing on a
  // cluster that has a reader, and is never called at all for a cluster with no reader --
  // see evaluateAuroraClusters()'s hasReader branch below.
  private static auroraLagStatus(lagMs: number | null): 'healthy' | 'degraded' | 'critical' | null {
    if (lagMs === null) return null
    if (lagMs > 5000) return 'critical'
    if (lagMs >= 1000) return 'degraded'
    return 'healthy'
  }

  /**
   * Aurora Service Health: control-plane state (this evaluation cycle's own fresh,
   * fleet-level describeAuroraClusters() call -- see aurora-cluster.util.ts's doc comment
   * for why this cannot reuse discovery's last enrichment result, which can be up to 6h
   * stale) combined with two CloudWatch signals. Both CPUUtilization and
   * AuroraReplicaLagMaximum are AWS-documented instance-level metrics that require the
   * DBClusterIdentifier+Role dimension pair to scope them to a cluster's writer instance
   * without needing to know its DBInstanceIdentifier -- see the approved contract. Like
   * EBS/CloudFront, this bypasses the single-dimensionKey ResourceCapability registry
   * entirely (two dimensions, not one) and batches both metrics for the whole fleet in one
   * fetchMetricDataBatch() call, never one GetMetricData per cluster.
   *
   * Defense in depth: even though discovery-time enrichment (see
   * awsResourceDiscovery.ts's enrichAuroraClusters()) already reclassifies confirmed
   * non-Aurora DBClusters out of the 'aurora' type, this evaluator re-checks Engine against
   * this cycle's own live DescribeDBClusters result before evaluating a row as Aurora -- a
   * row that's still 'aurora' only because discovery hasn't run again since a
   * classification changed must never be silently evaluated and displayed as if it were
   * Aurora.
   */
  private async evaluateAuroraClusters(
    rdsClient: RDSClient,
    cloudWatchClient: CloudWatchClient,
    clusters: InventoryRow[],
    currentStart: Date,
    now: Date,
    periodSeconds: number
  ): Promise<CloudWatchServiceHealth[]> {
    if (clusters.length === 0) return []

    const controlPlane = await describeAuroraClusters(rdsClient)

    if (controlPlane.status === 'unavailable') {
      // Whole-fleet control-plane failure -- every Aurora row this cycle is unknown, never
      // fabricated from stale CloudWatch data. Mirrors EBS's whole-chunk-failure isolation.
      return clusters.map((cluster) => ({
        resourceId: cluster.resource_id,
        resourceDbId: cluster.id,
        resourceSortName: cluster.resource_name,
        name: cluster.resource_name || cluster.resource_id,
        description: 'Aurora cluster',
        resourceType: 'aurora',
        status: 'unknown',
        uptime: null,
        responseTimeMs: null,
        errorRate: null,
        critical: true,
        monitored: false,
        reason: 'Failed to reach the RDS API for cluster status',
      }))
    }

    // Only clusters this cycle's live DescribeDBClusters actually confirms are a real
    // Aurora engine are queried against CloudWatch at all -- a stale/misclassified row (or
    // one absent from this region's result entirely) never gets a fabricated health verdict.
    const evaluable: Array<{ resource: InventoryRow; info: AuroraClusterInfo }> = []
    const results: CloudWatchServiceHealth[] = []

    for (const resource of clusters) {
      const info = controlPlane.clustersById.get(resource.resource_id)
      if (!info) {
        results.push({
          resourceId: resource.resource_id,
          resourceDbId: resource.id,
          resourceSortName: resource.resource_name,
          name: resource.resource_name || resource.resource_id,
          description: 'Aurora cluster',
          resourceType: 'aurora',
          status: 'unknown',
          uptime: null,
          responseTimeMs: null,
          errorRate: null,
          critical: true,
          monitored: false,
          reason: 'Cluster not found in this evaluation cycle\'s DescribeDBClusters result',
        })
        continue
      }
      if (!info.isAuroraEngine) {
        results.push({
          resourceId: resource.resource_id,
          resourceDbId: resource.id,
          resourceSortName: resource.resource_name,
          name: resource.resource_name || resource.resource_id,
          description: `Aurora cluster · ${info.engine || 'unknown engine'}`,
          resourceType: 'aurora',
          status: 'unknown',
          uptime: null,
          responseTimeMs: null,
          errorRate: null,
          critical: true,
          monitored: false,
          reason: `Engine=${info.engine || 'unknown'} is not an Aurora engine -- awaiting discovery reclassification`,
        })
        continue
      }
      evaluable.push({ resource, info })
    }

    if (evaluable.length === 0) return results

    const metricDefs: { key: string; metricName: string; stat: 'Average' | 'Maximum' }[] = [
      { key: 'cpu', metricName: 'CPUUtilization', stat: 'Average' },
      { key: 'lag', metricName: 'AuroraReplicaLagMaximum', stat: 'Maximum' },
    ]

    const queries: BatchMetricQuery[] = []
    const idsByCluster: Array<Record<string, string>> = evaluable.map(() => ({}))

    evaluable.forEach((entry, index) => {
      const dims = [
        { Name: 'DBClusterIdentifier', Value: entry.resource.resource_id },
        { Name: 'Role', Value: 'WRITER' },
      ]
      metricDefs.forEach((metric, metricIndex) => {
        const id = `aur${index}_${metricIndex}`
        idsByCluster[index][metric.key] = id
        queries.push({
          id,
          namespace: 'AWS/RDS',
          metricName: metric.metricName,
          dimensions: dims,
          period: periodSeconds,
          stat: metric.stat,
        })
      })
    })

    const metricResults = await fetchMetricDataBatch(cloudWatchClient, queries, currentStart, now)

    evaluable.forEach((entry, index) => {
      const { resource, info } = entry
      const cpuPercent = reduceSeriesToScalar(metricResults.get(idsByCluster[index].cpu) ?? null, 'Average')
      const rawLagMs = reduceSeriesToScalar(metricResults.get(idsByCluster[index].lag) ?? null, 'Maximum')
      // AuroraReplicaLagMaximum is only a real signal when the cluster actually has a
      // reader -- a writer-only cluster publishes no datapoints for it at all, and that
      // absence is not a failure, never treated as unknown/missing evidence.
      const lagMs = info.hasReader ? rawLagMs : null

      const controlStatus = info.status ?? null
      let status: CloudWatchServiceHealth['status']
      let reason: string | null
      let monitored: boolean

      if (controlStatus === 'deleting' || controlStatus === 'stopped' || controlStatus === 'stopping') {
        status = 'down'
        reason = `Cluster is ${controlStatus}`
        monitored = true
      } else if (controlStatus === 'failing-over') {
        status = 'degraded'
        reason = 'Cluster is failing over (in-progress AWS operation, not a failure)'
        monitored = true
      } else if (controlStatus !== 'available') {
        status = 'unknown'
        reason = `Unrecognized or unsupported DB cluster status: ${controlStatus ?? 'none'}`
        monitored = true
      } else {
        const cpuState = CloudWatchService.auroraCpuStatus(cpuPercent)
        const lagState = info.hasReader ? CloudWatchService.auroraLagStatus(lagMs) : null
        const signals = [cpuState, lagState].filter((s): s is 'healthy' | 'degraded' | 'critical' => s !== null)

        if (signals.length === 0) {
          status = 'unknown'
          reason = 'Cluster is available but no CloudWatch telemetry was returned for this window'
          // Real control-plane evidence was obtained (Status: available) even though
          // CloudWatch returned nothing -- monitored reflects that a live evaluation
          // genuinely happened, without claiming a CloudWatch-confirmed healthy state.
          monitored = true
        } else if (signals.includes('critical')) {
          status = 'critical'
          reason = cpuState === 'critical' ? `CPU utilization is critical (${cpuPercent}%)` : `Replica lag is critical (${lagMs}ms)`
          monitored = true
        } else if (signals.includes('degraded')) {
          status = 'degraded'
          reason = cpuState === 'degraded' ? `CPU utilization is elevated (${cpuPercent}%)` : `Replica lag is elevated (${lagMs}ms)`
          monitored = true
        } else {
          status = 'healthy'
          reason = null
          monitored = true
        }
      }

      results.push({
        resourceId: resource.resource_id,
        resourceDbId: resource.id,
        resourceSortName: resource.resource_name,
        name: resource.resource_name || resource.resource_id,
        description: `Aurora · ${info.engine}`,
        resourceType: 'aurora',
        status,
        uptime: null,
        responseTimeMs: null,
        errorRate: null,
        // Primary data resource, matching RDS's own judgment call, not the majority
        // supporting-infrastructure types (ALB/Lambda/DynamoDB/ECS/EKS/EBS/CloudFront).
        critical: true,
        monitored,
        reason,
        signals: { cpuPercent, lagMs },
        metrics: [
          ...(cpuPercent !== null ? [{ label: 'CPU', value: Math.round(cpuPercent * 10) / 10, unit: '%' }] : []),
          ...(lagMs !== null ? [{ label: 'Replica lag', value: Math.round(lagMs), unit: 'ms' }] : []),
        ],
      })
    })

    return results
  }

  /**
   * CloudWatch Scalability Phase 2A: the actual AWS/CloudWatch sweep, unchanged from the
   * pre-Phase-2A getMetrics() implementation (renamed only) -- no AWS API selection,
   * batching, resource-evaluation cap, or health-evaluation semantics were touched here.
   * Never call this directly from outside the class; getMetrics() below is the cached
   * public entry point every caller (the /metrics route) should use.
   */
  private async computeMetrics(organizationId: string, range?: string): Promise<CloudWatchMetrics | null> {
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
    const ec2InstancesAll = resources.filter((r) => r.resource_type === 'ec2')
    const rdsInstancesAll = resources.filter((r) => r.resource_type === 'rds')
    const albsAll = resources.filter((r) => r.resource_type === 'load-balancer' && r.metadata?.type === 'application')
    const lambdaFunctionsAll = resources.filter((r) => r.resource_type === 'lambda')
    const dynamoTablesAll = resources.filter((r) => r.resource_type === 'dynamodb')
    const ecsServicesInventoryAll = resources.filter((r) => r.resource_type === 'ecs')
    const eksClustersInventoryAll = resources.filter((r) => r.resource_type === 'eks')
    const ebsVolumesAll = resources.filter((r) => r.resource_type === 'ebs')
    const cloudfrontDistributionsAll = resources.filter((r) => r.resource_type === 'cloudfront')
    const auroraClustersAll = resources.filter((r) => r.resource_type === 'aurora')

    // CloudWatch Scalability Phase 2D: the per-scan evaluation cap that used to live here
    // (slice(0, 15) / slice(0, 5), including ALB) has been removed -- aggregate health
    // and the CloudWatch/control-plane evaluation below now run over the COMPLETE
    // discovered fleet for every one of the seven types, not a capped subset. These are
    // now plain aliases of the *All arrays (kept, rather than renaming every downstream
    // reference below) so every evaluation task, `coverage`, and `resourceCounts`
    // computation needs no further change. Bounding what the CLIENT sees is handled
    // entirely downstream, by the pagination layer (cloudwatch-pagination.util.ts)
    // slicing the already-evaluated `services[]` in the route handler -- never here, and
    // never by re-capping evaluation itself.
    const ec2Instances = ec2InstancesAll
    const rdsInstances = rdsInstancesAll
    const albs = albsAll
    const lambdaFunctions = lambdaFunctionsAll
    const dynamoTables = dynamoTablesAll
    const ecsServicesInventory = ecsServicesInventoryAll
    const eksClustersInventory = eksClustersInventoryAll
    const ebsVolumes = ebsVolumesAll
    const cloudfrontDistributions = cloudfrontDistributionsAll
    const auroraClusters = auroraClustersAll

    // Monitoring Truthfulness Phase 1, amended by Phase 2D: shown now always equals
    // total for every type, since evaluation is no longer capped -- resourceCounts
    // answers "how many resources were discovered" (both fields are the complete
    // discovered inventory count), a separate question from pagination's "how many
    // evaluated rows are being returned in this response," which is answered by the new
    // `pagination` field the route layer adds. Kept structurally unchanged (not merged
    // with pagination) and left in place rather than removed, even though it can no
    // longer disclose a truncation that no longer exists.
    const resourceCounts: CloudWatchMetrics['resourceCounts'] = {
      ec2: { shown: ec2Instances.length, total: ec2InstancesAll.length },
      loadBalancer: { shown: albs.length, total: albsAll.length },
      rds: { shown: rdsInstances.length, total: rdsInstancesAll.length },
      lambda: { shown: lambdaFunctions.length, total: lambdaFunctionsAll.length },
      dynamodb: { shown: dynamoTables.length, total: dynamoTablesAll.length },
      ecs: { shown: ecsServicesInventory.length, total: ecsServicesInventoryAll.length },
      eks: { shown: eksClustersInventory.length, total: eksClustersInventoryAll.length },
      ebs: { shown: ebsVolumes.length, total: ebsVolumesAll.length },
      cloudfront: { shown: cloudfrontDistributions.length, total: cloudfrontDistributionsAll.length },
      aurora: { shown: auroraClusters.length, total: auroraClustersAll.length },
    }

    // CloudWatch Scalability Phase 2B: the seven resource-type evaluation blocks below
    // start concurrently instead of sequentially. Each block reads only its own disjoint
    // slice of `resources` (partitioned by resource_type above, so no resource can ever
    // appear in two blocks) and writes no shared state -- see the Phase 2B audit for the
    // full independence proof. Each block is wrapped in its own try/catch so an
    // unexpected rejection (anything not already handled by that block's own internal
    // AWS-error handling inside evaluateResource/evaluateEcsService/evaluateEksService,
    // which already return safe 'unknown'/empty results and never throw for ordinary AWS
    // errors) degrades that one type to its existing empty/unknown representation instead
    // of failing the other six blocks or the whole response. This is strictly more
    // failure-isolated than the prior sequential-await chain, where an unhandled
    // rejection in an earlier block already prevented every later block from running at
    // all and produced a 500 with no partial data. Final response ordering (EC2, ALB,
    // RDS, Lambda, DynamoDB, ECS, EKS) is fixed explicitly in the `services` concatenation
    // below and does not depend on which block's promise settles first -- Promise.all()
    // resolves values in input order, not completion order.
    const ec2Task = (async (): Promise<CloudWatchServiceHealth[]> => {
      try {
        const { evaluations } = await this.evaluateCapabilityBatch(
          clients.cloudWatch, resourceTypeRegistry.ec2, ec2Instances, 'ec2', currentStart, previousStart, now, periodSeconds, lookbackSeconds
        )
        return evaluations.map((r) => r.service)
      } catch (err) {
        console.error('[CloudWatch] EC2 evaluation block failed unexpectedly:', err)
        return []
      }
    })()

    const rdsTask = (async (): Promise<CloudWatchServiceHealth[]> => {
      try {
        const results = (
          await Promise.all(
            rdsInstances.map((instance) =>
              this.evaluateResource(clients.cloudWatch, resourceTypeRegistry.rds, instance, currentStart, previousStart, now, periodSeconds, lookbackSeconds)
            )
          )
        ).filter((r): r is NonNullable<typeof r> => r !== null)
        return results.map((r) => r.service)
      } catch (err) {
        console.error('[CloudWatch] RDS evaluation block failed unexpectedly:', err)
        return []
      }
    })()

    const lambdaTask = (async (): Promise<CloudWatchServiceHealth[]> => {
      try {
        const { evaluations } = await this.evaluateCapabilityBatch(
          clients.cloudWatch, resourceTypeRegistry.lambda, lambdaFunctions, 'lambda', currentStart, previousStart, now, periodSeconds, lookbackSeconds
        )
        return evaluations.map((r) => r.service)
      } catch (err) {
        console.error('[CloudWatch] Lambda evaluation block failed unexpectedly:', err)
        return []
      }
    })()

    const dynamoTask = (async (): Promise<CloudWatchServiceHealth[]> => {
      try {
        const { evaluations } = await this.evaluateCapabilityBatch(
          clients.cloudWatch, resourceTypeRegistry.dynamodb, dynamoTables, 'dynamodb', currentStart, previousStart, now, periodSeconds, lookbackSeconds
        )
        return evaluations.map((r) => r.service)
      } catch (err) {
        console.error('[CloudWatch] DynamoDB evaluation block failed unexpectedly:', err)
        return []
      }
    })()

    // ECS bypasses evaluateResource() entirely — see evaluateEcsService() doc comment.
    const ecsTask = (async (): Promise<CloudWatchServiceHealth[]> => {
      try {
        return await Promise.all(ecsServicesInventory.map((svc) => this.evaluateEcsService(clients.ecs, svc)))
      } catch (err) {
        console.error('[CloudWatch] ECS evaluation block failed unexpectedly:', err)
        return []
      }
    })()

    // EKS also bypasses evaluateResource() entirely — see evaluateEksService() doc comment.
    const eksTask = (async (): Promise<CloudWatchServiceHealth[]> => {
      try {
        return await Promise.all(eksClustersInventory.map((cluster) => this.evaluateEksService(clients.eks, cluster)))
      } catch (err) {
        console.error('[CloudWatch] EKS evaluation block failed unexpectedly:', err)
        return []
      }
    })()

    // Service Health Coverage Expansion: EBS also bypasses the CloudWatch registry — see
    // evaluateEbsVolumes() doc comment. Its own batched DescribeVolumeStatus call(s) are
    // isolated inside that method, same failure-isolation guarantee as every other block.
    const ebsTask = (async (): Promise<CloudWatchServiceHealth[]> => {
      try {
        return await this.evaluateEbsVolumes(clients.ec2, ebsVolumes)
      } catch (err) {
        console.error('[CloudWatch] EBS evaluation block failed unexpectedly:', err)
        return []
      }
    })()

    // Service Health Coverage Expansion: CloudFront metrics only exist in us-east-1's
    // CloudWatch regardless of the org's default region — a dedicated client is required
    // (see evaluateCloudFrontDistributions() doc comment), never clients.cloudWatch.
    const cloudfrontTask = (async (): Promise<CloudWatchServiceHealth[]> => {
      try {
        const cloudWatchUsEast1 = clients.getCloudWatchClientForRegion('us-east-1')
        return await this.evaluateCloudFrontDistributions(cloudWatchUsEast1, cloudfrontDistributions, currentStart, now, periodSeconds)
      } catch (err) {
        console.error('[CloudWatch] CloudFront evaluation block failed unexpectedly:', err)
        return []
      }
    })()

    // Aurora Service Health: DBClusterIdentifier+Role-dimensioned metrics are regional,
    // same as every other type here — clients.cloudWatch (org's default region), never a
    // dedicated regional client the way CloudFront's global-service metrics require.
    const auroraTask = (async (): Promise<CloudWatchServiceHealth[]> => {
      try {
        return await this.evaluateAuroraClusters(clients.rds, clients.cloudWatch, auroraClusters, currentStart, now, periodSeconds)
      } catch (err) {
        console.error('[CloudWatch] Aurora evaluation block failed unexpectedly:', err)
        return []
      }
    })()

    // The ALB block additionally derives account-wide response-time/request-rate KPIs
    // from its own results (a dependency on ALB's *own* output, not on any other block --
    // see the Phase 2B audit), so its failure boundary returns the same "no ALB data"
    // defaults computeMetrics() has always used when there are zero ALBs, rather than a
    // bare empty array.
    interface AlbBlockResult {
      services: CloudWatchServiceHealth[]
      avgResponseTimeMs: number | null
      requestsPerMinute: number | null
      errorRate: number | null
      trendPercent: number | null
      responseTimeHistory: ResponseTimePoint[]
    }

    const albTask = (async (): Promise<AlbBlockResult> => {
      const empty: AlbBlockResult = {
        services: [],
        avgResponseTimeMs: null,
        requestsPerMinute: null,
        errorRate: null,
        trendPercent: null,
        responseTimeHistory: [],
      }
      try {
        const { evaluations: albEvaluations, currentSeriesByResource } = await this.evaluateCapabilityBatch(
          clients.cloudWatch,
          resourceTypeRegistry['load-balancer'],
          albs,
          'alb',
          currentStart,
          previousStart,
          now,
          periodSeconds,
          lookbackSeconds
        )

        const albServices = albEvaluations.map((r) => r.service)
        const albResults = albEvaluations.map((r, i) => ({
          service: r.service,
          avgResponseTimeMs: r.extra.avgResponseTimeMs,
          previousAvgResponseTimeMs: r.extra.previousAvgResponseTimeMs,
          requestsPerMinute: r.extra.requestsPerMinute,
          errorRate: r.extra.errorRate,
          requestSum: r.extra.requestSum,
          dims: r.extra.dims,
          resultIndex: i,
        }))

        // Response time / request-rate KPIs only make sense when at least one ALB exists —
        // an EC2-only or Lambda+API-Gateway account genuinely has no ALB-shaped metrics.
        if (albResults.length === 0) {
          return { ...empty, services: albServices }
        }

        const measuredLatencies = albResults.filter((r) => r.avgResponseTimeMs !== null)
        const avgResponseTimeMs =
          measuredLatencies.length > 0
            ? Math.round(measuredLatencies.reduce((sum, r) => sum + r.avgResponseTimeMs!, 0) / measuredLatencies.length)
            : null
        const requestsPerMinute = albResults.some((r) => r.requestsPerMinute !== null)
          ? albResults.reduce((sum, r) => sum + (r.requestsPerMinute ?? 0), 0)
          : null
        const errorRates = albResults.filter((r) => r.errorRate !== null)
        const errorRate = errorRates.length > 0 ? Math.round((errorRates.reduce((sum, r) => sum + r.errorRate!, 0) / errorRates.length) * 100) / 100 : null

        const previousLatencies = albResults.filter((r) => r.previousAvgResponseTimeMs !== null)
        const previousAvg =
          previousLatencies.length > 0
            ? previousLatencies.reduce((sum, r) => sum + r.previousAvgResponseTimeMs!, 0) / previousLatencies.length
            : null
        const trendPercent =
          avgResponseTimeMs !== null && previousAvg !== null && previousAvg > 0
            ? Math.round(((avgResponseTimeMs - previousAvg) / previousAvg) * 1000) / 10
            : null

        // Chart the highest-traffic ALB — response time isn't meaningfully additive
        // across multiple load balancers, so a single representative series beats an
        // average-of-averages line.
        const primary = albResults.reduce((best, r) => (r.requestSum > best.requestSum ? r : best), albResults[0])
        // Phase 2C: reuses the current-window latencySec query already fetched for
        // `primary` above -- the exact same namespace/metric/dimensions/window the old
        // getResponseTimeSeries() call duplicated -- instead of issuing a second CloudWatch
        // request for data already in hand.
        const primarySeries = currentSeriesByResource[primary.resultIndex]?.['latencySec'] ?? null
        const responseTimeHistory = seriesToResponseTimePoints(primarySeries)

        return { services: albServices, avgResponseTimeMs, requestsPerMinute, errorRate, trendPercent, responseTimeHistory }
      } catch (err) {
        console.error('[CloudWatch] ALB evaluation block failed unexpectedly:', err)
        return empty
      }
    })()

    // All ten tasks above have already started (each async IIFE runs synchronously up
    // to its own first await) -- this Promise.all() only waits for them, in a fixed input
    // order that determines the destructured order below regardless of completion timing.
    const [ec2Services, albBlock, rdsServices, lambdaServices, dynamoServices, ecsServices, eksServices, ebsServices, cloudfrontServices, auroraServices] =
      await Promise.all([ec2Task, albTask, rdsTask, lambdaTask, dynamoTask, ecsTask, eksTask, ebsTask, cloudfrontTask, auroraTask])

    const uptimeValues = ec2Services.map((s) => s.uptime).filter((v): v is number => v !== null)
    const uptime = uptimeValues.length > 0 ? Math.round((uptimeValues.reduce((a, b) => a + b, 0) / uptimeValues.length) * 100) / 100 : null

    let monthlyCost: number | null = null
    try {
      const cost = await awsCostService.fetchMonthlyCosts(organizationId)
      monthlyCost = cost.total
    } catch (err) {
      console.error('[CloudWatch] Monthly cost fetch failed:', err)
    }

    // Ordering is an explicit preserved response contract (EC2, ALB, RDS, Lambda,
    // DynamoDB, ECS, EKS, EBS, CloudFront, Aurora) -- see
    // cloudwatch.service.concurrency.test.ts's ordering test and
    // cloudwatch-pagination.util.ts's TYPE_ORDER, which both must stay consistent with
    // this exact sequence. EBS/CloudFront/Aurora are appended after the original seven in
    // the order each was added, rather than interleaved, so existing pagination cursors
    // issued before each addition remain valid across the rollout.
    // This is now the COMPLETE evaluated fleet (Phase 2D removed the per-type evaluation
    // cap above) -- both healthSummary/systemStatus below and the pagination layer in
    // cloudwatch.routes.ts operate on this same array, never on a re-capped subset.
    const allServices = [
      ...ec2Services,
      ...albBlock.services,
      ...rdsServices,
      ...lambdaServices,
      ...dynamoServices,
      ...ecsServices,
      ...eksServices,
      ...ebsServices,
      ...cloudfrontServices,
      ...auroraServices,
    ]

    // CloudWatch Scalability Phase 2D: complete-fleet aggregate health, computed here
    // (before any pagination exists) so it is unaffected by however the response is
    // later sliced into a page. Mirrors the precedent the frontend used to apply
    // client-side from a (formerly capped) services[] array -- same "only monitored
    // resources contribute a status" rule, same down > critical > degraded > healthy
    // systemStatus precedence -- moved server-side because that derivation stops being
    // correct once services[] is only a page rather than the whole fleet.
    const monitoredServices = allServices.filter((s) => s.monitored)
    const healthSummary: CloudWatchHealthSummary = {
      total: allServices.length,
      healthy: monitoredServices.filter((s) => s.status === 'healthy').length,
      degraded: monitoredServices.filter((s) => s.status === 'degraded').length,
      critical: monitoredServices.filter((s) => s.status === 'critical').length,
      down: monitoredServices.filter((s) => s.status === 'down').length,
      monitored: monitoredServices.length,
    }
    const systemStatus: CloudWatchSystemStatus = monitoredServices.some((s) => s.status === 'down')
      ? 'down'
      : monitoredServices.some((s) => s.status === 'critical')
        ? 'critical'
        : monitoredServices.some((s) => s.status === 'degraded')
          ? 'degraded'
          : 'healthy'

    return {
      accountId: account.account_id,
      nickname: account.nickname,
      region: clients.region,
      uptime,
      avgResponseTimeMs: albBlock.avgResponseTimeMs,
      requestsPerMinute: albBlock.requestsPerMinute,
      errorRate: albBlock.errorRate,
      monthlyCost,
      trendPercent: albBlock.trendPercent,
      responseTimeHistory: albBlock.responseTimeHistory,
      coverage: {
        ec2: ec2Instances.length > 0,
        loadBalancer: albBlock.services.length > 0,
        rds: rdsInstances.length > 0,
        lambda: lambdaFunctions.length > 0,
        dynamodb: dynamoTables.length > 0,
        ecs: ecsServicesInventory.length > 0,
        eks: eksClustersInventory.length > 0,
        ebs: ebsVolumes.length > 0,
        cloudfront: cloudfrontDistributions.length > 0,
        aurora: auroraClusters.length > 0,
      },
      resourceCounts,
      healthSummary,
      systemStatus,
      services: allServices,
      capturedAt: new Date().toISOString(),
    }
  }

  /**
   * CloudWatch Scalability Phase 2A: cached public entry point for the /metrics route.
   * Wraps computeMetrics() with a 45s per-(organization, resolved range) response cache
   * plus in-flight promise deduplication -- no AWS API selection, batching, resource cap,
   * or health-evaluation semantics are touched; this method only decides *when* to call
   * computeMetrics() versus reuse a recent result.
   *
   * `forceRefresh` bypasses the completed-result cache (a stored, possibly-up-to-45s-old
   * answer) so a manual refresh always gets a genuinely fresh computeMetrics() call --
   * but it still joins an already-in-flight computation for the same key if one exists,
   * since an in-flight fetch is not stale data, it's a fresh one already underway.
   *
   * Only a *resolved* computeMetrics() result is ever cached: a rejected computation is
   * never written to metricsCache, and its in-flight entry is removed in the `catch`
   * below so the very next call (forced or not) starts a genuinely new attempt rather
   * than replaying a failure or hanging on a promise that already settled.
   */
  async getMetrics(organizationId: string, range?: string, forceRefresh = false): Promise<CloudWatchMetrics | null> {
    const resolvedRange = resolveRange(range)
    const cacheKey = this.metricsCacheKey(organizationId, resolvedRange)

    if (!forceRefresh) {
      const cached = this.metricsCache.get(cacheKey)
      if (cached && Date.now() - cached.cachedAt < METRICS_CACHE_TTL_MS) {
        return cached.data
      }
    }

    const existingInFlight = this.metricsInFlight.get(cacheKey)
    if (existingInFlight) {
      return existingInFlight
    }

    const fetchPromise = this.computeMetrics(organizationId, range)
      .then((result) => {
        this.metricsCache.set(cacheKey, { data: result, cachedAt: Date.now() })
        this.metricsInFlight.delete(cacheKey)
        return result
      })
      .catch((err) => {
        this.metricsInFlight.delete(cacheKey)
        throw err
      })

    this.metricsInFlight.set(cacheKey, fetchPromise)
    return fetchPromise
  }

  /**
   * Engineering-only accessor for CAPABILITY_VALIDATION_STATUS — not part of the public
   * API surface, not called from any route today. Exists so this status is queryable from
   * code (e.g. a future internal debug endpoint or a test asserting a capability has been
   * bumped to 'live_verified' before some release gate) rather than only living in prose.
   */
  getCapabilityValidationStatus(): Record<CloudWatchServiceHealth['resourceType'], ValidationLevel> {
    return { ...CAPABILITY_VALIDATION_STATUS }
  }

  /**
   * SLO 3A: evaluates ONE specific, named resource's health telemetry over a fixed
   * 24h/7d window — deliberately NOT a second CloudWatch abstraction, just a second
   * entry point into the exact same evaluateResource() engine and capability registry
   * getMetrics() already uses for the full-account sweep. RANGE_CONFIG's existing
   * '24h'/'7d' entries are reused unchanged (see the module-level comment on
   * RANGE_CONFIG for why their periods are already CloudWatch-datapoint-safe).
   *
   * Returns null when the org has no active/enabled AWS connection at all — the caller
   * (slo.service.ts) must not interpret that as "0% availability" or any other
   * fabricated value.
   */
  async evaluateResourceForSlo(
    organizationId: string,
    resourceType: SloResourceType,
    resourceId: string,
    window: SloWindow
  ): Promise<SloResourceObservation | null> {
    let clients
    try {
      clients = await AWSClientFactory.createClients(organizationId)
    } catch (err) {
      console.error('[CloudWatch] SLO: failed to create AWS clients:', err)
      return null
    }
    if (!clients.enabled) return null

    const { rows } = await pool.query(
      `SELECT resource_id, resource_name, resource_type, resource_arn, status, metadata
       FROM aws_resources
       WHERE organization_id = $1 AND resource_id = $2 AND resource_type = $3
         AND status != 'terminated'
       LIMIT 1`,
      [organizationId, resourceId, resourceType]
    )
    const resource: InventoryRow | undefined = rows[0]
    if (!resource) {
      return { resourceExists: false, monitored: false, uptime: null, avgLatencyMs: null, errorRatePercent: null }
    }

    const { lookbackSeconds, periodSeconds } = RANGE_CONFIG[window]
    const now = new Date()
    const currentStart = new Date(now.getTime() - lookbackSeconds * 1000)
    const previousStart = new Date(currentStart.getTime() - lookbackSeconds * 1000)

    const capability = resourceTypeRegistry[resourceType]
    const result = await this.evaluateResource(
      clients.cloudWatch,
      capability as ResourceCapability<unknown>,
      resource,
      currentStart,
      previousStart,
      now,
      periodSeconds,
      lookbackSeconds
    )

    if (!result) {
      return { resourceExists: true, monitored: false, uptime: null, avgLatencyMs: null, errorRatePercent: null }
    }

    return {
      resourceExists: true,
      monitored: result.service.monitored,
      uptime: result.service.uptime,
      avgLatencyMs: result.service.responseTimeMs,
      errorRatePercent: result.service.errorRate,
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