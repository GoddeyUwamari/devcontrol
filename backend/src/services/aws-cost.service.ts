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

export type CostTrendRange = '7d' | '30d' | '90d' | '6mo' | '1yr'

export interface CostTrendPoint {
  date: string
  compute: number
  storage: number
  database: number
  network: number
  other: number
  total: number
}

type CostCategory = 'compute' | 'storage' | 'database' | 'network' | 'other'

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
   * Fetch monthly costs from AWS Cost Explorer.
   * If organizationId is supplied, assumes the org's IAM role via STS before calling
   * Cost Explorer; otherwise falls back to platform-level env-var credentials.
   */
  async fetchMonthlyCosts(organizationId?: string): Promise<MonthlyCost> {
    if (organizationId) {
      const orgService = await AWSCostService.createForOrg(organizationId, this.dbPool || pool)
      return orgService.fetchMonthlyCosts()
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
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0)

      const command = new GetCostAndUsageCommand({
        TimePeriod: {
          Start: startOfMonth.toISOString().split('T')[0],
          End: endOfMonth.toISOString().split('T')[0],
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
          end: endOfMonth.toISOString().split('T')[0],
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
   * for the given range, from AWS Cost Explorer.
   * If organizationId is supplied, assumes the org's IAM role via STS before calling
   * Cost Explorer; otherwise falls back to platform-level env-var credentials.
   */
  async fetchCostTrend(organizationId: string | undefined, range: CostTrendRange): Promise<CostTrendPoint[]> {
    if (organizationId) {
      const orgService = await AWSCostService.createForOrg(organizationId, this.dbPool || pool)
      return orgService.fetchCostTrend(undefined, range)
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

      for (const group of result.Groups || []) {
        const serviceName = group.Keys?.[0] || ''
        const amount = parseFloat(group.Metrics?.UnblendedCost?.Amount || '0')
        const category = categorizeAwsService(serviceName)
        raw[category] += amount
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
      }
    })

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
