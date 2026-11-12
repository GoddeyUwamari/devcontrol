import {
  CostExplorerClient,
  GetCostAndUsageCommand,
  type GetCostAndUsageCommandInput,
  Granularity,
  Metric,
  type ResultByTime,
} from '@aws-sdk/client-cost-explorer'
import { Pool } from 'pg'
import { pool } from '../config/database'
import { assumeRoleAsPlatform } from './platform-sts'
import { AwsAccountRow, awsConnectionIdentity, requireEligibleAwsAccount } from '../repositories/aws-accounts.repository'
import type { SpendProvenance } from './ai-context-contract'



export interface MonthlyCost {
  total: number
  byService: {
    service: string
    amount: number
  }[]
  period: {
    start: string
    end: string
  }
  // When this result was actually obtained from Cost Explorer -- set once, at
  // the moment of a real fetch, and carried unchanged through the cache on
  // every subsequent cache hit (see monthlyCostCache below). Consumers that
  // need to know whether they're looking at a fresh or a cached result should
  // compare this against Date.now(), not assume the value is current just
  // because they received it just now. Optional so any caller pattern-matching
  // on the pre-existing shape (there are several: stats.controller.ts,
  // infrastructure.controller.ts, aws.routes.ts, system-intelligence.service.ts,
  // cloudwatch.service.ts) is unaffected by this additive field.
  fetchedAt?: string
  // The previous UTC calendar month's net total (same metric and grouping),
  // from the same Cost Explorer request as the month to date. null when Cost
  // Explorer returned no result for that month. Optional for the same reason
  // as fetchedAt.
  previousMonth?: { period: { start: string; end: string }; total: number } | null
}

interface MonthlyCostCacheEntry {
  data: MonthlyCost
  timestamp: number
}

interface CostTrendCacheEntry {
  data: CostTrendPoint[]
  timestamp: number
}

/**
 * The key of every cost cache and in-flight entry (AWS connect PR B): the
 * organization AND its connection identity (awsConnectionIdentity of the
 * aws_accounts row whose credentials fetched the data), plus the exact Cost
 * Explorer period the entry answers (start, exclusive end, and for the trend
 * its range and granularity). The identity is read BEFORE the lookup and the
 * fetch then uses that same row, so an entry only ever holds data fetched with
 * its own connection's credentials: a request after a connection change misses
 * every entry of the old connection, including an old in-flight fetch that
 * completes later, and empty results (a $0 month) are scoped the same way.
 * The period is computed once per request and the fetch uses that same period,
 * so after 00:00 UTC on the 1st a request for the new month never receives an
 * entry fetched for the old one. Errors are never stored.
 */
function costCacheKey(organizationId: string, identity: string, period: readonly string[]): string {
  return JSON.stringify([organizationId, identity, ...period])
}

/** Drop entries older than the TTL, so entries for past periods don't accumulate. */
function pruneExpired<T extends { timestamp: number }>(cache: Map<string, T>, ttl: number, now: number): void {
  for (const [key, entry] of cache) {
    if (now - entry.timestamp >= ttl) cache.delete(key)
  }
}

/**
 * Every page of one GetCostAndUsage request (USD 0.01 per page to the customer's
 * account), merged: results for the same TimePeriod have their Groups joined
 * in page order. Any failed page fails the whole read -- a partial result is
 * never returned -- and a response that keeps paging past MAX_COST_EXPLORER_PAGES
 * is refused rather than truncated.
 */
export const MAX_COST_EXPLORER_PAGES = 20

export async function getCostAndUsageAllPages(client: CostExplorerClient, input: GetCostAndUsageCommandInput): Promise<ResultByTime[]> {
  const merged: ResultByTime[] = []
  const byPeriod = new Map<string, ResultByTime>()
  let token: string | undefined
  let pages = 0
  do {
    if (pages === MAX_COST_EXPLORER_PAGES) {
      throw new Error(`Cost Explorer returned more than ${MAX_COST_EXPLORER_PAGES} pages; the result was not used`)
    }
    const page = await client.send(new GetCostAndUsageCommand(token ? { ...input, NextPageToken: token } : input))
    pages++
    for (const result of page.ResultsByTime ?? []) {
      const key = `${result.TimePeriod?.Start ?? ''}/${result.TimePeriod?.End ?? ''}`
      const existing = byPeriod.get(key)
      if (existing) {
        existing.Groups = [...(existing.Groups ?? []), ...(result.Groups ?? [])]
      } else {
        const copy: ResultByTime = { ...result, Groups: [...(result.Groups ?? [])] }
        byPeriod.set(key, copy)
        merged.push(copy)
      }
    }
    token = page.NextPageToken || undefined
  } while (token)
  return merged
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

/** YYYY-MM-DD of a UTC instant. */
function utcDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * The current calendar month to date, in UTC: from the 1st of this UTC month
 * through today, with Cost Explorer's exclusive End set to tomorrow. Computed
 * from UTC fields only, so the window never depends on the server's time zone.
 */
export function monthToDatePeriodUtc(now: Date): { start: string; end: string } {
  return {
    start: utcDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))),
    end: utcDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))),
  }
}

/**
 * The one MONTHLY Cost Explorer request behind the month to date: from the 1st
 * of the previous UTC month through today, so the same request (and charge)
 * also returns the previous month's total. `monthToDate` is the current
 * month's part of it.
 */
export function monthlyCostsRequestPeriodUtc(now: Date): { start: string; end: string; monthToDate: { start: string; end: string } } {
  const monthToDate = monthToDatePeriodUtc(now)
  return {
    start: utcDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))),
    end: monthToDate.end,
    monthToDate,
  }
}

/**
 * Cost Explorer TimePeriod and granularity for a trend range, in UTC. Short
 * ranges are DAILY through today; 6mo/1yr are MONTHLY, aligned to UTC calendar
 * months, current partial month included.
 */
export function trendPeriodUtc(range: CostTrendRange, now: Date): { start: string; end: string; granularity: Granularity } {
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()
  if (range === '6mo' || range === '1yr') {
    const monthsBack = range === '6mo' ? 6 : 12
    return {
      start: utcDate(new Date(Date.UTC(y, m - (monthsBack - 1), 1))),
      end: utcDate(new Date(Date.UTC(y, m + 1, 1))),
      granularity: Granularity.MONTHLY,
    }
  }
  const daysBack = range === '7d' ? 7 : range === '30d' ? 30 : 90
  const d = now.getUTCDate()
  return {
    start: utcDate(new Date(Date.UTC(y, m, d - daysBack))),
    // Cost Explorer's End is exclusive; include today.
    end: utcDate(new Date(Date.UTC(y, m, d + 1))),
    granularity: Granularity.DAILY,
  }
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
  // Set only by createForOrg(), from the organization's assumed-role
  // credentials. The shared default instance never has one: it only caches and
  // dispatches to a per-organization instance.
  private costExplorerClient: CostExplorerClient | null = null

  // Per-org, per-connection cache for fetchMonthlyCosts (costCacheKey) — Cost Explorer is billed per API call and rate
  // limited, and this same singleton is polled every ~2min by system-intelligence plus
  // invalidated on every cost/alert/deployment WebSocket event, so uncached it re-runs
  // STS AssumeRole + GetCostAndUsageCommand far more often than the data actually changes.
  // TTL matches the 4h staleTime already used for cost data on the frontend (dashboard/page.tsx).
  private monthlyCostCache: Map<string, MonthlyCostCacheEntry> = new Map()
  private static readonly MONTHLY_COST_CACHE_TTL = 4 * 60 * 60 * 1000

  // In-flight promise per org and connection, keyed the same as monthlyCostCache (costCacheKey). Several independent
  // call sites (stats.controller, infrastructure.controller, aws.routes, system-intelligence)
  // share this singleton and can all miss the cache within the same window — e.g. on
  // dashboard mount or right after the 4h TTL expires. Without this, every concurrent miss
  // fires its own STS AssumeRole + GetCostAndUsageCommand (a cache stampede) even though
  // they're all asking for the exact same result. Callers that arrive while a fetch is
  // already in flight await that same promise instead of starting a new one.
  private monthlyCostInFlight: Map<string, Promise<MonthlyCost>> = new Map()

  // Per-org+connection+range cache for fetchCostTrend (costCacheKey) — same rationale as monthlyCostCache above:
  // Cost Explorer is billed per API call, and this was being called uncached on every
  // dashboard load and time-range tab switch. TTL matches MONTHLY_COST_CACHE_TTL.
  private costTrendCache: Map<string, CostTrendCacheEntry> = new Map()

  // In-flight promise per org+range, same stampede rationale as monthlyCostInFlight.
  private costTrendInFlight: Map<string, Promise<CostTrendPoint[]>> = new Map()

  // Builds no AWS client: there is no cost data without an organization, and
  // an organization's clients come only from createForOrg().
  constructor(private dbPool?: Pool) {}

  /**
   * Create an AWSCostService instance scoped to a specific org via STS AssumeRole.
   * Reads the org's one eligible account (aws-accounts.repository.ts), then assumes
   * the role and builds the Cost Explorer client with the temporary credentials.
   * The STS client is the platform's own identity and is used only for AssumeRole.
   */
  static async createForOrg(organizationId: string, dbPool: Pool, account?: AwsAccountRow): Promise<AWSCostService> {
    // `account`, when given, is the row the caller already read (and keyed its cache
    // by): the credentials then come from that same row, never a second read.
    const { role_arn: roleArn, external_id: externalId } = account ?? (await requireEligibleAwsAccount(dbPool, organizationId))

    const assumed = await assumeRoleAsPlatform('us-east-1', {
      RoleArn: roleArn,
      RoleSessionName: 'DevControlCostSession',
      ExternalId: externalId ?? undefined,
      DurationSeconds: 3600,
    }, `AWSCostService org ${organizationId}`)

    const credentials = {
      accessKeyId: assumed.Credentials!.AccessKeyId!,
      secretAccessKey: assumed.Credentials!.SecretAccessKey!,
      sessionToken: assumed.Credentials!.SessionToken!,
    }

    const instance = new AWSCostService(dbPool)
    // Cost Explorer is a global service answered in us-east-1, whatever region the
    // account's resources are scanned in.
    instance.costExplorerClient = new CostExplorerClient({ region: 'us-east-1', credentials })

    return instance
  }

  /** An organization-scoped operation was called without an organization: never answered from anywhere else. */
  private requireOrganizationId(organizationId: unknown): asserts organizationId is string {
    if (typeof organizationId !== 'string' || organizationId.trim() === '') {
      throw new Error('ORGANIZATION_REQUIRED: AWS cost data is only available for a specific organization')
    }
  }

  /** The Cost Explorer client of the organization this instance was created for; there is no other. */
  private customerCostExplorer(): CostExplorerClient {
    if (!this.costExplorerClient) {
      throw new Error('AWS_NOT_CONNECTED: no organization AWS credentials on this cost service instance')
    }
    return this.costExplorerClient
  }

  /**
   * Fetch current-calendar-month-to-date costs from AWS Cost Explorer.
   * By design, this reads as a low/partial number for the first 1-3 days of a new month
   * (Cost Explorer's usage data lags 24-48h) — accepted tradeoff, not a bug.
   * Always for one organization: assumes that organization's IAM role via STS
   * before calling Cost Explorer. Throws AWS_NOT_CONNECTED when it has no
   * connected account -- there is no other source of credentials.
   */
  async fetchMonthlyCosts(organizationId: string): Promise<MonthlyCost> {
    return (await this.fetchMonthlyCostsWithConnection(organizationId)).costs
  }

  /**
   * fetchMonthlyCosts(), plus the identity of the connection the costs belong to:
   * the row read first, whose credentials fetched them (or whose cache entry they
   * came from). A caller that persists them fences its write on this identity.
   */
  async fetchMonthlyCostsWithConnection(organizationId: string): Promise<{ costs: MonthlyCost; connection: string }> {
    this.requireOrganizationId(organizationId)

    // The connection first (costCacheKey): none throws AWS_NOT_CONNECTED, as before.
    const account = await requireEligibleAwsAccount(this.dbPool || pool, organizationId)
    const connection = awsConnectionIdentity(account)
    return { costs: await this.monthlyCostsFor(organizationId, account, connection), connection }
  }

  private async monthlyCostsFor(organizationId: string, account: AwsAccountRow, connection: string): Promise<MonthlyCost> {
    // The period is fixed here, once: the key and the query below both use it.
    const period = monthlyCostsRequestPeriodUtc(new Date())
    const key = costCacheKey(organizationId, connection, ['month_to_date', period.start, period.end])

    const cached = this.monthlyCostCache.get(key)
    if (cached && Date.now() - cached.timestamp < AWSCostService.MONTHLY_COST_CACHE_TTL) {
      return cached.data
    }

    const inFlight = this.monthlyCostInFlight.get(key)
    if (inFlight) {
      return inFlight
    }

    const fetchPromise = (async () => {
      const orgService = await AWSCostService.createForOrg(organizationId, this.dbPool || pool, account)
      const result = await orgService.queryMonthlyCosts(period)
      // Stamped once, right here, at the moment the real Cost Explorer call
      // actually succeeded -- not when a later cache hit happens to be read.
      const resultWithTimestamp: MonthlyCost = { ...result, fetchedAt: new Date().toISOString() }
      pruneExpired(this.monthlyCostCache, AWSCostService.MONTHLY_COST_CACHE_TTL, Date.now())
      this.monthlyCostCache.set(key, { data: resultWithTimestamp, timestamp: Date.now() })
      return resultWithTimestamp
    })().finally(() => {
      this.monthlyCostInFlight.delete(key)
    })

    this.monthlyCostInFlight.set(key, fetchPromise)
    return fetchPromise
  }

  /**
   * The Cost Explorer query itself, on this instance's organization credentials:
   * one MONTHLY request from the 1st of the previous UTC month through today
   * (every page), split into the month to date and the previous month by each
   * result's own TimePeriod. A response without a result for the current month
   * is an error, never a $0 month.
   */
  private async queryMonthlyCosts(period: ReturnType<typeof monthlyCostsRequestPeriodUtc>): Promise<MonthlyCost> {
    const costExplorer = this.customerCostExplorer()

    try {
      const results = await getCostAndUsageAllPages(costExplorer, {
        TimePeriod: { Start: period.start, End: period.end },
        Granularity: Granularity.MONTHLY,
        Metrics: [Metric.UNBLENDED_COST],
        GroupBy: [
          {
            Type: 'DIMENSION',
            Key: 'SERVICE',
          },
        ],
      })

      const serviceAmounts = (result: ResultByTime) =>
        (result.Groups ?? []).map((group) => ({
          service: group.Keys?.[0] || 'Unknown',
          amount: parseFloat(group.Metrics?.UnblendedCost?.Amount || '0'),
        }))

      const current = results.find((r) => r.TimePeriod?.Start === period.monthToDate.start)
      if (!current) {
        throw new Error('Cost Explorer returned no result for the current month')
      }
      const previous = results.find((r) => r.TimePeriod?.Start === period.start)

      const byService = serviceAmounts(current)
      const total = byService.reduce((sum, item) => sum + item.amount, 0)

      return {
        total,
        byService,
        period: period.monthToDate,
        fetchedAt: new Date().toISOString(),
        previousMonth: previous
          ? {
              period: { start: period.start, end: period.monthToDate.start },
              total: serviceAmounts(previous).reduce((sum, item) => sum + item.amount, 0),
            }
          : null,
      }
    } catch (error) {
      console.error('Error fetching monthly costs:', error)
      throw error
    }
  }

  /**
   * Canonical "live Cost Explorer spend, or DB estimate if unavailable" decision —
   * previously duplicated independently in stats.controller.ts and
   * system-intelligence.service.ts. Reuses fetchMonthlyCosts()'s own per-org cache/
   * in-flight dedup above, so calling this doesn't add any Cost Explorer traffic
   * beyond what that cache already governs. The DB estimate query and its
   * organization/status filtering are unchanged from both prior call sites.
   *
   * Any successful Cost Explorer result is 'actual', whatever its value: a real
   * $0 month (including the first hours of a month, before AWS reports any
   * charge) and a net-negative month (credits exceed charges) are billing data,
   * not a failure. Only a failed fetch falls back to the inventory estimate.
   */
  async getMonthlySpendWithFallback(
    organizationId: string
  ): Promise<{ amount: number; source: SpendProvenance }> {
    try {
      const liveCost = await this.fetchMonthlyCosts(organizationId)
      return { amount: liveCost.total, source: 'actual' }
    } catch (_err) {
      // Live fetch failed — fall through to the DB estimate below, same as
      // both call sites this consolidates.
    }

    return { amount: await this.getInventoryMonthlyRunRate(organizationId), source: 'estimated' }
  }

  /**
   * The inventory's monthly run-rate estimate: SUM(estimated_monthly_cost) over
   * the org's non-terminated resources. A DB read only -- never Cost Explorer.
   */
  async getInventoryMonthlyRunRate(organizationId: string): Promise<number> {
    const estimateResult = await (this.dbPool || pool).query(
      `SELECT COALESCE(SUM(estimated_monthly_cost), 0) as total FROM aws_resources WHERE organization_id = $1 AND status != 'terminated'`,
      [organizationId]
    )
    return parseFloat(estimateResult.rows[0].total)
  }

  /** The trend cache key for a range and the period it resolves to right now. */
  private static trendCacheKey(organizationId: string, identity: string, range: CostTrendRange, period: { start: string; end: string; granularity: Granularity }): string {
    return costCacheKey(organizationId, identity, ['trend', range, period.start, period.end, period.granularity])
  }

  /**
   * When the cached fetchCostTrend() result for this org's CURRENT connection and
   * range, for the period that range resolves to now, was actually fetched from
   * Cost Explorer (ISO timestamp), or null if nothing is cached for it (or the
   * organization has no eligible connection, or its connection could not be read).
   */
  async getCostTrendFetchedAt(organizationId: string, range: CostTrendRange): Promise<string | null> {
    let account: AwsAccountRow
    try {
      account = await requireEligibleAwsAccount(this.dbPool || pool, organizationId)
    } catch {
      return null
    }
    const cached = this.costTrendCache.get(AWSCostService.trendCacheKey(organizationId, awsConnectionIdentity(account), range, trendPeriodUtc(range, new Date())))
    return cached ? new Date(cached.timestamp).toISOString() : null
  }

  /**
   * Fetch a cost time-series broken down by category (compute/storage/database/network/other)
   * for the given range, from AWS Cost Explorer. Each point also carries the raw
   * per-service breakdown (byService) that the category buckets were derived from, and
   * a chart-ready byServiceDisplay: the top TOP_SERVICE_COUNT services (by total spend
   * across the range) with normalized names and stable colors, plus an "Other" bucket.
   * Always for one organization, on that organization's assumed-role credentials;
   * throws AWS_NOT_CONNECTED when it has no connected account.
   */
  async fetchCostTrend(organizationId: string, range: CostTrendRange): Promise<CostTrendPoint[]> {
    this.requireOrganizationId(organizationId)

    // The connection first (costCacheKey): none throws AWS_NOT_CONNECTED, as before.
    const account = await requireEligibleAwsAccount(this.dbPool || pool, organizationId)
    // The period is fixed here, once: the key and the query below both use it.
    const period = trendPeriodUtc(range, new Date())
    const cacheKey = AWSCostService.trendCacheKey(organizationId, awsConnectionIdentity(account), range, period)
    const cached = this.costTrendCache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < AWSCostService.MONTHLY_COST_CACHE_TTL) {
      return cached.data
    }

    const inFlight = this.costTrendInFlight.get(cacheKey)
    if (inFlight) {
      return inFlight
    }

    const fetchPromise = (async () => {
      const orgService = await AWSCostService.createForOrg(organizationId, this.dbPool || pool, account)
      const result = await orgService.queryCostTrend(period)
      pruneExpired(this.costTrendCache, AWSCostService.MONTHLY_COST_CACHE_TTL, Date.now())
      this.costTrendCache.set(cacheKey, { data: result, timestamp: Date.now() })
      return result
    })().finally(() => {
      this.costTrendInFlight.delete(cacheKey)
    })

    this.costTrendInFlight.set(cacheKey, fetchPromise)
    return fetchPromise
  }

  /** The Cost Explorer query itself (every page), on this instance's organization credentials. */
  private async queryCostTrend(period: { start: string; end: string; granularity: Granularity }): Promise<CostTrendPoint[]> {
    const costExplorer = this.customerCostExplorer()

    const { start, end, granularity } = period

    const results = await getCostAndUsageAllPages(costExplorer, {
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

    const points: CostTrendPoint[] = results.map((result) => {
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
}

export { AWSCostService }
// The shared instance holds only the per-organization caches and no AWS client:
// every fetch requires an organization id and runs on that organization's
// assumed-role credentials (createForOrg).
export default new AWSCostService()
