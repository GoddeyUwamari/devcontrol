import {
  CostExplorerClient,
  GetCostAndUsageCommand,
  Granularity,
  Metric,
} from '@aws-sdk/client-cost-explorer'
import {
  EC2Client,
  DescribeInstancesCommand,
  Instance,
} from '@aws-sdk/client-ec2'
import {
  RDSClient,
  DescribeDBInstancesCommand,
  DBInstance,
} from '@aws-sdk/client-rds'
import {
  S3Client,
  ListBucketsCommand,
  GetBucketLocationCommand,
} from '@aws-sdk/client-s3'
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts'
import { Pool } from 'pg'
import { pool } from '../config/database'

interface ResourceCost {
  service: string
  resourceId: string
  resourceName: string
  resourceType: string
  region: string
  status: string
  costPerMonth: number
  tags?: Record<string, string>
}

interface MonthlyCost {
  total: number
  byService: {
    service: string
    amount: number
  }[]
  period: {
    start: string
    end: string
  }
}

interface MonthlyCostCacheEntry {
  data: MonthlyCost
  timestamp: number
}

interface CostTrendCacheEntry {
  data: CostTrendPoint[]
  timestamp: number
}

export type CostTrendRange = '7d' | '30d' | '90d' | '6mo' | '1yr'

export interface CostTrendPoint {
  date: string
  compute: number
  storage: number
  database: number
  network: number
  other: number
  total: number
  // Optional: raw per-service breakdown alongside the fixed category buckets above.
  // Optional so cached entries written before this field existed, or points from a
  // rolling deploy still running the old shape, degrade gracefully instead of breaking.
  byService?: { service: string; amount: number }[]
  // Optional: chart-ready view of byService — display names normalized, capped at
  // the top TOP_SERVICE_COUNT services (by total spend across the whole range) plus
  // an "Other" bucket, each with a stable color. Same optionality rationale as byService.
  byServiceDisplay?: { service: string; amount: number; color: string }[]
}

type CostCategory = 'compute' | 'storage' | 'database' | 'network' | 'other'

// How many individual services the trend chart shows before folding the rest into
// "Other". 7 named services + 1 gray "Other" bucket = 8 segments, matching the
// categorical palette's validated 8-hue cap for stacked/adjacent charts (see the
// dataviz skill's palette.md — worst adjacent CVD ΔE 9.1 light / 8.4 dark for exactly
// 8 slots; a 9th slot has no safe hue to assign, hence folding to "Other" instead).
const TOP_SERVICE_COUNT = 7

// Fixed 8-hue categorical order (dataviz skill's validated default palette, light-mode
// hex). Order is the CVD-safety mechanism, not cosmetic — do not reorder or cycle it.
const CATEGORICAL_PALETTE = [
  '#2a78d6', // 1 blue
  '#eb6834', // 2 orange
  '#1baf7a', // 3 aqua
  '#eda100', // 4 yellow
  '#e87ba4', // 5 magenta
  '#008300', // 6 green
  '#4a3aa7', // 7 violet
  '#e34948', // 8 red
] as const

// "Other" is a residual bucket, not a service identity, so it gets a neutral gray
// instead of spending one of the 8 categorical hues — matches the existing
// 'Other Services' color already used for the category breakdown on the frontend.
const OTHER_SERVICE_COLOR = '#94A3B8'

/**
 * AWS Cost Explorer SERVICE dimension values, mapped to short display names for the
 * per-service chart. Exact-match on the raw Cost Explorer string; anything not listed
 * falls back to normalizeServiceName's cleanup below rather than failing.
 */
const SERVICE_DISPLAY_NAMES: Record<string, string> = {
  'Amazon Elastic Compute Cloud - Compute': 'EC2',
  'EC2 - Other': 'EC2 (Other)',
  'Amazon Simple Storage Service': 'S3',
  'Amazon Relational Database Service': 'RDS',
  'Amazon DynamoDB': 'DynamoDB',
  'AWS Lambda': 'Lambda',
  'Amazon Virtual Private Cloud': 'VPC',
  'AWS Data Transfer': 'Data Transfer',
  'Amazon CloudFront': 'CloudFront',
  'Amazon Elastic Load Balancing': 'Load Balancer',
  'Amazon Elastic Block Store': 'EBS',
  'Amazon Elastic File System': 'EFS',
  'AWS Cost Explorer': 'Cost Explorer',
  'Amazon Simple Notification Service': 'SNS',
  'Amazon Simple Queue Service': 'SQS',
  'Amazon Elastic Container Service': 'ECS',
  'Amazon Elastic Container Registry': 'ECR',
  'Amazon Elastic Kubernetes Service': 'EKS',
  'Amazon Route 53': 'Route 53',
  'Amazon ElastiCache': 'ElastiCache',
  'Amazon Redshift': 'Redshift',
  'Amazon Neptune': 'Neptune',
  'Amazon DocumentDB (with MongoDB compatibility)': 'DocumentDB',
  'AWS Glue': 'Glue',
  'AWS Key Management Service': 'KMS',
  'AWS Secrets Manager': 'Secrets Manager',
  'AmazonCloudWatch': 'CloudWatch',
  'AWS CloudTrail': 'CloudTrail',
  'Amazon API Gateway': 'API Gateway',
  'AWS Backup': 'Backup',
  'AWS Direct Connect': 'Direct Connect',
  'AWS Certificate Manager': 'ACM',
  'AWS Step Functions': 'Step Functions',
  'Amazon Simple Email Service': 'SES',
  'Amazon Kinesis': 'Kinesis',
  'AWS WAF': 'WAF',
  'Amazon Cognito': 'Cognito',
  'AWS Elastic Beanstalk': 'Elastic Beanstalk',
  'Savings Plans for AWS Compute usage': 'Savings Plans',
}

// Hand-assigned, guaranteed-distinct hues for the 8 services most likely to co-occur
// in the same account's top spend (EC2 + EC2 (Other) in particular show up together
// almost always; Data Transfer + VPC are both network-related and commonly co-occur
// too, hence each gets its own slot rather than sharing one). Keyed by display name
// so color follows entity identity, never rank. CloudFront deliberately omitted here —
// with all 8 slots spoken for by this set, it falls through to the deterministic hash
// below like any other less-common service.
const SERVICE_COLOR_OVERRIDES: Record<string, string> = {
  'EC2': CATEGORICAL_PALETTE[0],
  'EC2 (Other)': CATEGORICAL_PALETTE[1],
  'S3': CATEGORICAL_PALETTE[2],
  'Lambda': CATEGORICAL_PALETTE[3],
  'RDS': CATEGORICAL_PALETTE[4],
  'VPC': CATEGORICAL_PALETTE[5],
  'DynamoDB': CATEGORICAL_PALETTE[6],
  'Data Transfer': CATEGORICAL_PALETTE[7],
}

/**
 * Map a raw Cost Explorer SERVICE name to a short display name. Falls back to
 * stripping the "Amazon"/"AWS" prefix and truncating, so an unmapped service still
 * renders reasonably instead of showing the full Cost Explorer string.
 *
 * Cost Explorer's SERVICE names are inconsistent about the space after the
 * "Amazon"/"AWS" prefix — e.g. "AmazonCloudWatch" has none, while "AWS Glue" does —
 * so both the exact-match table above and this fallback have to tolerate either.
 */
function normalizeServiceName(rawName: string): string {
  const mapped = SERVICE_DISPLAY_NAMES[rawName]
  if (mapped) return mapped

  const cleaned = rawName.replace(/^(Amazon|AWS)\s*/, '').trim()
  if (!cleaned) return 'Unknown'
  return cleaned.length > 28 ? `${cleaned.slice(0, 27)}…` : cleaned
}

/**
 * Deterministic string hash into the categorical palette, for services with no
 * explicit color override. Same input always yields the same slot — no randomness —
 * so a service's color never changes between fetches even without a hand-picked hue.
 */
function hashToColorSlot(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0
  }
  return CATEGORICAL_PALETTE[Math.abs(hash) % CATEGORICAL_PALETTE.length]
}

/**
 * Assign a color to each of the (at most TOP_SERVICE_COUNT) named services in a
 * single response, guaranteeing no two of them share a hex. A per-name hash alone
 * can't promise that — two unrelated services can hash to the same slot and, unlike
 * the wider space of ~40 mapped services, everything here is guaranteed to appear
 * together in the same chart. So: lock in hand-assigned overrides first, then walk
 * the fixed palette order and hand each remaining service the first hue not already
 * taken *within this set* (falling back to the hash only if all 8 hues are somehow
 * already spoken for, which TOP_SERVICE_COUNT's cap of 7 prevents in practice).
 */
function assignServiceColors(orderedDisplayNames: string[]): Map<string, string> {
  const colorByName = new Map<string, string>()
  const usedSlots = new Set<string>()

  for (const name of orderedDisplayNames) {
    const override = SERVICE_COLOR_OVERRIDES[name]
    if (override) {
      colorByName.set(name, override)
      usedSlots.add(override)
    }
  }

  for (const name of orderedDisplayNames) {
    if (colorByName.has(name)) continue
    const freeSlot = CATEGORICAL_PALETTE.find((hex) => !usedSlots.has(hex))
    const color = freeSlot ?? hashToColorSlot(name)
    colorByName.set(name, color)
    usedSlots.add(color)
  }

  return colorByName
}

/**
 * Mutates each point in place, adding byServiceDisplay: the top TOP_SERVICE_COUNT
 * services by total spend across the whole range (so chart segment membership is
 * stable across dates, not recomputed per-day), normalized to display names with
 * stable colors, plus an "Other" bucket for everything outside the top set.
 */
function attachServiceDisplayBreakdown(points: CostTrendPoint[]): void {
  const totalsByDisplayName = new Map<string, number>()
  for (const point of points) {
    for (const { service, amount } of point.byService || []) {
      const name = normalizeServiceName(service)
      totalsByDisplayName.set(name, (totalsByDisplayName.get(name) || 0) + amount)
    }
  }

  const topServices = [...totalsByDisplayName.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_SERVICE_COUNT)
    .map(([name]) => name)
  const topServiceSet = new Set(topServices)
  const hasOther = topServiceSet.size < totalsByDisplayName.size
  const colorByName = assignServiceColors(topServices)

  for (const point of points) {
    const amountsByDisplayName = new Map<string, number>()
    for (const { service, amount } of point.byService || []) {
      const name = normalizeServiceName(service)
      amountsByDisplayName.set(name, (amountsByDisplayName.get(name) || 0) + amount)
    }

    const breakdown = topServices.map((name) => ({
      service: name,
      amount: Math.max(0, amountsByDisplayName.get(name) || 0),
      color: colorByName.get(name)!,
    }))

    if (hasOther) {
      const otherAmount = [...amountsByDisplayName.entries()]
        .filter(([name]) => !topServiceSet.has(name))
        .reduce((sum, [, amount]) => sum + amount, 0)
      breakdown.push({ service: 'Other', amount: Math.max(0, otherAmount), color: OTHER_SERVICE_COLOR })
    }

    point.byServiceDisplay = breakdown
  }
}

/**
 * AWS Cost Explorer SERVICE dimension values vary in exact wording across
 * accounts/regions, so categorize by keyword rather than an exact-match table.
 *
 * "Tax", AWS Support plan fees, and any other non-service charges intentionally
 * fall through to 'other' — they aren't a real spend category (compute/storage/
 * database/network), so bucketing them there is correct, not a mapping gap.
 */
function categorizeAwsService(serviceName: string): CostCategory {
  const name = serviceName.toLowerCase()
  if (
    name.includes('compute cloud') || name.includes('lambda') ||
    name.includes('container service') || name.includes('kubernetes') ||
    name.includes('fargate') || name.includes('elastic beanstalk') ||
    name.includes('container registry') || name.includes('savings plans')
  ) {
    return 'compute'
  }
  if (
    name.includes('simple storage') || name.includes('elastic block store') ||
    name.includes('elastic file system') || name.includes('backup') ||
    name.includes('glacier') || name.includes('ec2 - other')
  ) {
    return 'storage'
  }
  if (
    name.includes('relational database') || name.includes('dynamodb') ||
    name.includes('elasticache') || name.includes('redshift') ||
    name.includes('documentdb') || name.includes('neptune')
  ) {
    return 'database'
  }
  if (
    name.includes('data transfer') || name.includes('cloudfront') ||
    name.includes('elastic load balancing') || name.includes('direct connect') ||
    name.includes('route 53') || name.includes('virtual private cloud')
  ) {
    return 'network'
  }
  return 'other'
}

class AWSCostService {
  private costExplorerClient: CostExplorerClient
  private ec2Client: EC2Client
  private rdsClient: RDSClient
  private s3Client: S3Client
  private enabled: boolean

  // Per-org cache for fetchMonthlyCosts — Cost Explorer is billed per API call and rate
  // limited, and this same singleton is polled every ~2min by system-intelligence plus
  // invalidated on every cost/alert/deployment WebSocket event, so uncached it re-runs
  // STS AssumeRole + GetCostAndUsageCommand far more often than the data actually changes.
  // TTL matches the 4h staleTime already used for cost data on the frontend (dashboard/page.tsx).
  private monthlyCostCache: Map<string, MonthlyCostCacheEntry> = new Map()
  private static readonly MONTHLY_COST_CACHE_TTL = 4 * 60 * 60 * 1000

  // In-flight promise per org, keyed the same as monthlyCostCache. Several independent
  // call sites (stats.controller, infrastructure.controller, aws.routes, system-intelligence)
  // share this singleton and can all miss the cache within the same window — e.g. on
  // dashboard mount or right after the 4h TTL expires. Without this, every concurrent miss
  // fires its own STS AssumeRole + GetCostAndUsageCommand (a cache stampede) even though
  // they're all asking for the exact same result. Callers that arrive while a fetch is
  // already in flight await that same promise instead of starting a new one.
  private monthlyCostInFlight: Map<string, Promise<MonthlyCost>> = new Map()

  // Per-org+range cache for fetchCostTrend — same rationale as monthlyCostCache above:
  // Cost Explorer is billed per API call, and this was being called uncached on every
  // dashboard load and time-range tab switch. TTL matches MONTHLY_COST_CACHE_TTL.
  private costTrendCache: Map<string, CostTrendCacheEntry> = new Map()

  // In-flight promise per org+range, same stampede rationale as monthlyCostInFlight.
  private costTrendInFlight: Map<string, Promise<CostTrendPoint[]>> = new Map()

  constructor(private dbPool?: Pool) {
    this.enabled = this.checkAWSCredentials()

    if (this.enabled) {
      const config = {
        region: process.env.AWS_REGION || 'us-east-1',
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        },
      }

      this.costExplorerClient = new CostExplorerClient(config)
      this.ec2Client = new EC2Client(config)
      this.rdsClient = new RDSClient(config)
      this.s3Client = new S3Client(config)
    } else {
      // Initialize with dummy clients for non-AWS environments
      this.costExplorerClient = {} as CostExplorerClient
      this.ec2Client = {} as EC2Client
      this.rdsClient = {} as RDSClient
      this.s3Client = {} as S3Client
    }
  }

  /**
   * Create an AWSCostService instance scoped to a specific org via STS AssumeRole.
   * Queries aws_accounts for the org's role_arn / external_id / region, then assumes
   * the role and initialises all AWS clients with the temporary credentials.
   */
  static async createForOrg(organizationId: string, dbPool: Pool): Promise<AWSCostService> {
    const result = await dbPool.query(
      "SELECT role_arn, external_id, region FROM aws_accounts WHERE org_id = $1 AND status = 'active' LIMIT 1",
      [organizationId]
    )

    if (result.rows.length === 0) {
      throw new Error(`AWS_NOT_CONNECTED: org ${organizationId} has not connected an AWS account`)
    }

    const { role_arn: roleArn, external_id: externalId, region } = result.rows[0]

    const stsClient = new STSClient({ region: 'us-east-1' })
    const assumed = await stsClient.send(new AssumeRoleCommand({
      RoleArn: roleArn,
      RoleSessionName: 'DevControlCostSession',
      ExternalId: externalId,
      DurationSeconds: 3600,
    }))

    const credentials = {
      accessKeyId: assumed.Credentials!.AccessKeyId!,
      secretAccessKey: assumed.Credentials!.SecretAccessKey!,
      sessionToken: assumed.Credentials!.SessionToken!,
    }

    const instance = new AWSCostService(dbPool)
    instance.costExplorerClient = new CostExplorerClient({ region, credentials })
    instance.ec2Client = new EC2Client({ region, credentials })
    instance.rdsClient = new RDSClient({ region, credentials })
    instance.s3Client = new S3Client({ region, credentials })
    instance.enabled = true

    return instance
  }

  private checkAWSCredentials(): boolean {
    return !!(
      process.env.AWS_ACCESS_KEY_ID &&
      process.env.AWS_SECRET_ACCESS_KEY &&
      process.env.AWS_REGION
    )
  }

  /**
   * Fetch current-calendar-month-to-date costs from AWS Cost Explorer.
   * By design, this reads as a low/partial number for the first 1-3 days of a new month
   * (Cost Explorer's usage data lags 24-48h) — accepted tradeoff, not a bug.
   * If organizationId is supplied, assumes the org's IAM role via STS before calling
   * Cost Explorer; otherwise falls back to platform-level env-var credentials.
   */
  async fetchMonthlyCosts(organizationId?: string): Promise<MonthlyCost> {
    if (organizationId) {
      const cached = this.monthlyCostCache.get(organizationId)
      if (cached && Date.now() - cached.timestamp < AWSCostService.MONTHLY_COST_CACHE_TTL) {
        return cached.data
      }

      const inFlight = this.monthlyCostInFlight.get(organizationId)
      if (inFlight) {
        return inFlight
      }

      const fetchPromise = (async () => {
        const orgService = await AWSCostService.createForOrg(organizationId, this.dbPool || pool)
        const result = await orgService.fetchMonthlyCosts()
        this.monthlyCostCache.set(organizationId, { data: result, timestamp: Date.now() })
        return result
      })().finally(() => {
        this.monthlyCostInFlight.delete(organizationId)
      })

      this.monthlyCostInFlight.set(organizationId, fetchPromise)
      return fetchPromise
    }

    if (!this.enabled) {
      console.log('AWS credentials not configured, returning mock data')
      return {
        total: 0,
        byService: [],
        period: {
          start: new Date().toISOString().split('T')[0],
          end: new Date().toISOString().split('T')[0],
        },
      }
    }

    try {
      const now = new Date()
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
      // Cost Explorer's End is exclusive; include today.
      const endOfToday = new Date(now)
      endOfToday.setDate(endOfToday.getDate() + 1)

      const command = new GetCostAndUsageCommand({
        TimePeriod: {
          Start: startOfMonth.toISOString().split('T')[0],
          End: endOfToday.toISOString().split('T')[0],
        },
        Granularity: Granularity.MONTHLY,
        Metrics: [Metric.UNBLENDED_COST],
        GroupBy: [
          {
            Type: 'DIMENSION',
            Key: 'SERVICE',
          },
        ],
      })

      const response = await this.costExplorerClient.send(command)

      const byService =
        response.ResultsByTime?.[0]?.Groups?.map((group) => ({
          service: group.Keys?.[0] || 'Unknown',
          amount: parseFloat(group.Metrics?.UnblendedCost?.Amount || '0'),
        })) || []

      const total = byService.reduce((sum, item) => sum + item.amount, 0)

      return {
        total,
        byService,
        period: {
          start: startOfMonth.toISOString().split('T')[0],
          end: endOfToday.toISOString().split('T')[0],
        },
      }
    } catch (error) {
      console.error('Error fetching monthly costs:', error)
      throw error
    }
  }

  /**
   * Compute the TimePeriod + Granularity for a given trend range.
   * Short ranges use DAILY granularity; 6mo/1yr use MONTHLY (calendar-month aligned,
   * current partial month included).
   */
  private resolveTrendPeriod(range: CostTrendRange): { start: string; end: string; granularity: Granularity } {
    const now = new Date()
    const toISODate = (d: Date) => d.toISOString().split('T')[0]

    if (range === '6mo' || range === '1yr') {
      const monthsBack = range === '6mo' ? 6 : 12
      const start = new Date(now.getFullYear(), now.getMonth() - (monthsBack - 1), 1)
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 1)
      return { start: toISODate(start), end: toISODate(end), granularity: Granularity.MONTHLY }
    }

    const daysBack = range === '7d' ? 7 : range === '30d' ? 30 : 90
    const start = new Date(now)
    start.setDate(start.getDate() - daysBack)
    const end = new Date(now)
    end.setDate(end.getDate() + 1) // Cost Explorer's End is exclusive; include today
    return { start: toISODate(start), end: toISODate(end), granularity: Granularity.DAILY }
  }

  /**
   * Fetch a cost time-series broken down by category (compute/storage/database/network/other)
   * for the given range, from AWS Cost Explorer. Each point also carries the raw
   * per-service breakdown (byService) that the category buckets were derived from, and
   * a chart-ready byServiceDisplay: the top TOP_SERVICE_COUNT services (by total spend
   * across the range) with normalized names and stable colors, plus an "Other" bucket.
   * If organizationId is supplied, assumes the org's IAM role via STS before calling
   * Cost Explorer; otherwise falls back to platform-level env-var credentials.
   */
  async fetchCostTrend(organizationId: string | undefined, range: CostTrendRange): Promise<CostTrendPoint[]> {
    if (organizationId) {
      const cacheKey = `${organizationId}:${range}`
      const cached = this.costTrendCache.get(cacheKey)
      if (cached && Date.now() - cached.timestamp < AWSCostService.MONTHLY_COST_CACHE_TTL) {
        return cached.data
      }

      const inFlight = this.costTrendInFlight.get(cacheKey)
      if (inFlight) {
        return inFlight
      }

      const fetchPromise = (async () => {
        const orgService = await AWSCostService.createForOrg(organizationId, this.dbPool || pool)
        const result = await orgService.fetchCostTrend(undefined, range)
        this.costTrendCache.set(cacheKey, { data: result, timestamp: Date.now() })
        return result
      })().finally(() => {
        this.costTrendInFlight.delete(cacheKey)
      })

      this.costTrendInFlight.set(cacheKey, fetchPromise)
      return fetchPromise
    }

    if (!this.enabled) {
      return []
    }

    const { start, end, granularity } = this.resolveTrendPeriod(range)

    const command = new GetCostAndUsageCommand({
      TimePeriod: { Start: start, End: end },
      Granularity: granularity,
      Metrics: [Metric.UNBLENDED_COST],
      GroupBy: [
        {
          Type: 'DIMENSION',
          Key: 'SERVICE',
        },
      ],
    })

    const response = await this.costExplorerClient.send(command)

    const points: CostTrendPoint[] = (response.ResultsByTime || []).map((result) => {
      const raw: Record<CostCategory, number> = {
        compute: 0,
        storage: 0,
        database: 0,
        network: 0,
        other: 0,
      }
      const byService: { service: string; amount: number }[] = []

      for (const group of result.Groups || []) {
        const serviceName = group.Keys?.[0] || ''
        const amount = parseFloat(group.Metrics?.UnblendedCost?.Amount || '0')
        const category = categorizeAwsService(serviceName)
        raw[category] += amount
        byService.push({ service: serviceName || 'Unknown', amount })
      }

      // Floor each category at 0 — credits/refunds can make a category net-negative
      // for a day, but a stacked category-breakdown chart can't meaningfully render
      // negative segments. The true bill total (including credits) is reported
      // separately via fetchMonthlyCosts, not reconciled through this breakdown.
      const compute = Math.max(0, raw.compute)
      const storage = Math.max(0, raw.storage)
      const database = Math.max(0, raw.database)
      const network = Math.max(0, raw.network)
      const other = Math.max(0, raw.other)

      return {
        date: result.TimePeriod?.Start || '',
        compute,
        storage,
        database,
        network,
        other,
        total: compute + storage + database + network + other,
        byService,
      }
    })

    attachServiceDisplayBreakdown(points)

    return points
  }

  /**
   * Fetch EC2 instances
   */
  async fetchEC2Instances(): Promise<ResourceCost[]> {
    if (!this.enabled) return []

    try {
      const command = new DescribeInstancesCommand({})
      const response = await this.ec2Client.send(command)

      const resources: ResourceCost[] = []

      response.Reservations?.forEach((reservation) => {
        reservation.Instances?.forEach((instance: Instance) => {
          const nameTag = instance.Tags?.find((tag) => tag.Key === 'Name')

          resources.push({
            service: 'EC2',
            resourceId: instance.InstanceId || '',
            resourceName: nameTag?.Value || instance.InstanceId || 'Unnamed',
            resourceType: instance.InstanceType || 'unknown',
            region: instance.Placement?.AvailabilityZone?.slice(0, -1) || 'us-east-1',
            status: instance.State?.Name || 'unknown',
            costPerMonth: this.estimateEC2Cost(instance.InstanceType || ''),
            tags: this.convertTags(instance.Tags || []),
          })
        })
      })

      return resources
    } catch (error) {
      console.error('Error fetching EC2 instances:', error)
      return []
    }
  }

  /**
   * Fetch RDS instances
   */
  async fetchRDSInstances(): Promise<ResourceCost[]> {
    if (!this.enabled) return []

    try {
      const command = new DescribeDBInstancesCommand({})
      const response = await this.rdsClient.send(command)

      const resources: ResourceCost[] = []

      response.DBInstances?.forEach((instance: DBInstance) => {
        resources.push({
          service: 'RDS',
          resourceId: instance.DBInstanceIdentifier || '',
          resourceName: instance.DBInstanceIdentifier || 'Unnamed',
          resourceType: `${instance.Engine || 'unknown'} ${instance.DBInstanceClass || ''}`,
          region: instance.AvailabilityZone?.slice(0, -1) || 'us-east-1',
          status: instance.DBInstanceStatus || 'unknown',
          costPerMonth: this.estimateRDSCost(instance.DBInstanceClass || ''),
          tags: {},
        })
      })

      return resources
    } catch (error) {
      console.error('Error fetching RDS instances:', error)
      return []
    }
  }

  /**
   * Fetch S3 buckets
   */
  async fetchS3Buckets(): Promise<ResourceCost[]> {
    if (!this.enabled) return []

    try {
      const listCommand = new ListBucketsCommand({})
      const response = await this.s3Client.send(listCommand)

      const resources: ResourceCost[] = []

      for (const bucket of response.Buckets || []) {
        try {
          const locationCommand = new GetBucketLocationCommand({
            Bucket: bucket.Name,
          })
          const locationResponse = await this.s3Client.send(locationCommand)
          const region = locationResponse.LocationConstraint || 'us-east-1'

          resources.push({
            service: 'S3',
            resourceId: bucket.Name || '',
            resourceName: bucket.Name || 'Unnamed',
            resourceType: 'Bucket',
            region: region,
            status: 'active',
            costPerMonth: 5, // Estimate, would need CloudWatch metrics for accurate cost
            tags: {},
          })
        } catch (error) {
          console.error(`Error getting location for bucket ${bucket.Name}:`, error)
        }
      }

      return resources
    } catch (error) {
      console.error('Error fetching S3 buckets:', error)
      return []
    }
  }

  /**
   * Fetch all AWS resources
   */
  async fetchAllResources(): Promise<ResourceCost[]> {
    const [ec2Instances, rdsInstances, s3Buckets] = await Promise.all([
      this.fetchEC2Instances(),
      this.fetchRDSInstances(),
      this.fetchS3Buckets(),
    ])

    return [...ec2Instances, ...rdsInstances, ...s3Buckets]
  }

  /**
   * Sync AWS resources to database
   */
  async syncResourcesToDatabase(): Promise<void> {
    if (!this.enabled) {
      console.log('AWS integration disabled, skipping sync')
      return
    }

    try {
      const resources = await this.fetchAllResources()

      // Clear existing AWS-sourced resources
      await pool.query(
        'DELETE FROM infrastructure_resources WHERE tags @> \'{"source": "aws"}\'::jsonb'
      )

      // Insert new resources
      for (const resource of resources) {
        const tags = { ...resource.tags, source: 'aws' }

        await pool.query(
          `INSERT INTO infrastructure_resources
           (service, resource_id, resource_name, resource_type, region, status, cost_per_month, tags)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            resource.service,
            resource.resourceId,
            resource.resourceName,
            resource.resourceType,
            resource.region,
            resource.status,
            resource.costPerMonth,
            JSON.stringify(tags),
          ]
        )
      }

      console.log(`Synced ${resources.length} AWS resources to database`)
    } catch (error) {
      console.error('Error syncing resources to database:', error)
      throw error
    }
  }

  /**
   * Helper: Estimate EC2 cost based on instance type
   */
  private estimateEC2Cost(instanceType: string): number {
    const costs: Record<string, number> = {
      't2.micro': 8.5,
      't2.small': 17,
      't2.medium': 34,
      't3.micro': 7.5,
      't3.small': 15,
      't3.medium': 30,
      'm5.large': 70,
      'm5.xlarge': 140,
      'c5.large': 62,
      'r5.large': 91,
    }

    return costs[instanceType] || 50 // Default estimate
  }

  /**
   * Helper: Estimate RDS cost based on instance class
   */
  private estimateRDSCost(instanceClass: string): number {
    const costs: Record<string, number> = {
      'db.t3.micro': 12,
      'db.t3.small': 24,
      'db.t3.medium': 48,
      'db.m5.large': 122,
      'db.r5.large': 175,
    }

    return costs[instanceClass] || 75 // Default estimate
  }

  /**
   * Helper: Convert AWS tags to object
   */
  private convertTags(tags: Array<{ Key?: string; Value?: string }>): Record<string, string> {
    const result: Record<string, string> = {}
    tags.forEach((tag) => {
      if (tag.Key && tag.Value) {
        result[tag.Key] = tag.Value
      }
    })
    return result
  }
}

export { AWSCostService }
// @deprecated — use AWSCostService.createForOrg(organizationId, pool) for per-org credential isolation
export default new AWSCostService()
