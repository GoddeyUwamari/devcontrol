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
import {
  absentCurrentMonthIsNoDataYet,
  costMetricAmount,
  deriveCostMonthState,
  monthToDatePeriodUtc,
  type CostMonthState,
} from './cost-month-state'
import { costReportStates, isProvisional, type CostReportState } from './cost-trend-report-state'



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
  // The month's state (cost-month-state.ts): whether Cost Explorer has
  // reported anything for it yet and whether `total` may be used as a number.
  // `total` is 0 whenever there are no line items; a consumer that shows a
  // month-to-date figure reads monthState.amount (null when not usable), never
  // a bare 0. Optional for the same reason as fetchedAt.
  monthState?: CostMonthState
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
 * completes later, and empty results (no line items yet, or a real $0 month)
 * are scoped the same way.
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
  // Cost Explorer SERVICE groups in this period: 0 means Cost Explorer reported
  // nothing for it. Optional for the same reason as byService.
  lineItems?: number
  // How far Cost Explorer has reported the period (cost-trend-report-state.ts):
  // 'not_reported' is a gap, never $0.00; 'updating' is an amount so far that
  // Cost Explorer may still add to; 'final' is everything else. Optional for the
  // same reason as byService.
  reportState?: CostReportState
  // ResultByTime.Estimated for the period; null when Cost Explorer did not send it.
  estimated?: boolean | null
  // Kept for older consumers: true unless reportState is 'final' (so a
  // not_reported period, which has no line items, still reads as a gap there).
  provisional?: boolean
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

/** The current calendar month to date, in UTC (one implementation: cost-month-state.ts). */
export { monthToDatePeriodUtc }

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
 * The range the 7d trend is served from (today-bar TB-D1): the 7-day and
 * 30-day views then share each day's reportState, because costReportStates()
 * decides a day by the series around it (the last period with line items in
 * that series). Decided over 8 days alone, an account whose last charge was
 * before today-7 read as final $0 days in 7d but not reported in 30d.
 */
export const SEVEN_DAY_TREND_SOURCE = '30d' satisfies CostTrendRange

/** Points in the 7d trend: today-7 .. today (trendPeriodUtc('7d')). */
export const SEVEN_DAY_TREND_POINTS = 8

/**
 * The 7d trend from the 30d series: its points from today-7 (the series' last
 * point is today) on, as copies, so the cached 30d points are never changed.
 * reportState and every amount are the 30d points' own. Only byServiceDisplay
 * is recomputed, over these days (TB-D7): its top services are this week's,
 * as when 7d had its own request.
 */
export function sevenDayTrendFrom(series: ReadonlyArray<CostTrendPoint>): CostTrendPoint[] {
  if (series.length === 0) return []
  const last = series[series.length - 1].date.slice(0, 10)
  const [y, m, d] = last.split('-').map(Number)
  const from = utcDate(new Date(Date.UTC(y, m - 1, d - (SEVEN_DAY_TREND_POINTS - 1))))
  const points = series.filter((p) => p.date.slice(0, 10) >= from).map((p) => ({ ...p }))
  attachServiceDisplayBreakdown(points)
  return points
}

/**
 * The range the 30d trend is served from (CE-2, ce1-build.md A4 (ii)): the
 * Dashboard already asks for the 90d series (month-over-month) whenever it
 * asks for 30d, and 30d is a slice of it (same DAILY granularity, metric and
 * SERVICE grouping), so 30d costs no Cost Explorer request of its own.
 */
export const THIRTY_DAY_TREND_SOURCE = '90d' satisfies CostTrendRange

/**
 * The 30d trend from the 90d series, exactly as a 30d request of its own
 * would have returned it: the points of trendPeriodUtc('30d', now), as copies
 * (the cached 90d points are never changed), with every amount the 90d
 * point's own, and the two things that depend on the series around a day
 * decided again over these 31 days:
 *   - reportState / provisional (costReportStates over the slice), so a day
 *     reads as it did when 30d was its own request. Decided over 90 days, an
 *     account whose last charge was 31-90 days ago would read "not reported"
 *     for its last 8 days instead of final $0 (ce1-build.md A4 (i));
 *   - byServiceDisplay (the top services over these 31 days).
 * `now` must be the time the 90d entry's key was computed from: the key ends
 * tomorrow (UTC), so it is the UTC day the 90d states were decided for, and
 * costReportStates reads only the UTC date. A daily point's last day is its
 * own date (Cost Explorer's End is the next day, exclusive).
 */
export function thirtyDayTrendFrom(series: ReadonlyArray<CostTrendPoint>, now: Date): CostTrendPoint[] {
  const { start, end } = trendPeriodUtc('30d', now)
  const points = series
    .filter((p) => p.date.slice(0, 10) >= start && p.date.slice(0, 10) < end)
    .map((p) => ({ ...p }))
  const states = costReportStates(
    points.map((p) => ({ lastDay: p.date.slice(0, 10), lineItems: p.lineItems ?? 0, estimated: p.estimated ?? null })),
    now
  )
  points.forEach((p, i) => {
    p.reportState = states[i]
    p.provisional = isProvisional(states[i])
  })
  attachServiceDisplayBreakdown(points)
  return points
}

/** The range whose cache entry (and Cost Explorer request) serves `range`: 7d and 30d read the 90d entry. */
export function trendCacheSource(range: CostTrendRange): CostTrendRange {
  if (range === '7d') return trendCacheSource(SEVEN_DAY_TREND_SOURCE)
  if (range === '30d') return THIRTY_DAY_TREND_SOURCE
  return range
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
/**
 * A Cost Explorer SERVICE name as the cost trend chart shows it. Exported for
 * the weekly email's service lines, so the email and the chart name a service
 * the same way.
 */
export function normalizeServiceName(rawName: string): string {
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

  // Per-org, per-connection cache for fetchMonthlyCosts (costCacheKey) — Cost Explorer is billed per API call
  // (USD 0.01 to the customer's account) and rate limited, and every Dashboard surface (stats,
  // cost summary, AI summary, resource checks) reads the month to date, the AI summary on a
  // 5-minute poll; uncached it would re-run STS AssumeRole + GetCostAndUsageCommand far more
  // often than the data actually changes. (System Intelligence reads only the inventory
  // run-rate, never Cost Explorer.) No background job reads Cost Explorer except the Monday
  // weekly email (the trend). This cache lives in process memory: a restart empties it.
  // TTL matches the 4h staleTime already used for cost data on the frontend (dashboard/page.tsx).
  private monthlyCostCache: Map<string, MonthlyCostCacheEntry> = new Map()
  private static readonly MONTHLY_COST_CACHE_TTL = 4 * 60 * 60 * 1000

  // In-flight promise per org and connection, keyed the same as monthlyCostCache (costCacheKey). Several independent
  // call sites (stats.controller, infrastructure.controller, aws.routes, the cost context
  // behind the cost summary, AI summary and chat, cloudwatch resource checks) share this singleton and can all miss the cache within the same window — e.g. on
  // dashboard mount or right after the 4h TTL expires. Without this, every concurrent miss
  // fires its own STS AssumeRole + GetCostAndUsageCommand (a cache stampede) even though
  // they're all asking for the exact same result. Callers that arrive while a fetch is
  // already in flight await that same promise instead of starting a new one.
  private monthlyCostInFlight: Map<string, Promise<MonthlyCost>> = new Map()

  // Per-org+connection+range cache for fetchCostTrend (costCacheKey) — same rationale as monthlyCostCache above:
  // Cost Explorer is billed per API call, and this was being called uncached on every
  // dashboard load and time-range tab switch. TTL matches MONTHLY_COST_CACHE_TTL.
  // 7d and 30d have no entry of their own: both are served from the 90d entry
  // (trendCacheSource), so the Dashboard's 7d chart and its 90d month-over-month
  // comparison share one Cost Explorer request (CE-2).
  private costTrendCache: Map<string, CostTrendCacheEntry> = new Map()

  // In-flight promise per org+connection+range, same stampede rationale as monthlyCostInFlight.
  // 7d, 30d and 90d asked together (the Dashboard's chart and summary mounting at once)
  // all wait on the one 90d fetch.
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
   * Early in a UTC month Cost Explorer may have reported nothing yet: monthState
   * says no_billed_days_yet / latest_days_updating (cost-month-state.ts), and a
   * consumer never shows that as $0.
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
    // The key includes the UTC day (the period's end), so the month state,
    // computed at fetch time, never outlives the day it was computed for.
    const now = new Date()
    const period = monthlyCostsRequestPeriodUtc(now)
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
      const result = await orgService.queryMonthlyCosts(period, now)
      // Stamped once, right here, at the moment the real Cost Explorer call
      // actually succeeded -- not when a later cache hit happens to be read.
      const fetchedAt = new Date().toISOString()
      const resultWithTimestamp: MonthlyCost = {
        ...result,
        fetchedAt,
        monthState: result.monthState ? { ...result.monthState, asOf: fetchedAt } : result.monthState,
      }
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
   * is "no billed days yet" only while no day of the month is past Cost
   * Explorer's reporting lag and the previous month's result is there
   * (DAY1-D4); otherwise it is an error. Never a $0 month. A group without the
   * requested cost metric fails the read (CostMetricMissingError), never $0.
   */
  private async queryMonthlyCosts(period: ReturnType<typeof monthlyCostsRequestPeriodUtc>, now: Date = new Date()): Promise<MonthlyCost> {
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
          amount: costMetricAmount(group),
        }))

      const current = results.find((r) => r.TimePeriod?.Start === period.monthToDate.start)
      const previous = results.find((r) => r.TimePeriod?.Start === period.start)
      if (!current && !absentCurrentMonthIsNoDataYet(period.monthToDate, previous !== undefined, now)) {
        throw new Error('Cost Explorer returned no result for the current month')
      }

      const byService = current ? serviceAmounts(current) : []
      const total = byService.reduce((sum, item) => sum + item.amount, 0)
      const fetchedAt = new Date().toISOString()
      const previousMonth = previous
        ? {
            period: { start: period.start, end: period.monthToDate.start },
            total: serviceAmounts(previous).reduce((sum, item) => sum + item.amount, 0),
          }
        : null

      return {
        total,
        byService,
        period: period.monthToDate,
        fetchedAt,
        previousMonth,
        monthState: deriveCostMonthState({
          period: period.monthToDate,
          total,
          lineItems: byService.length,
          currentMonthResult: current ? 'present' : 'absent',
          ceEstimated: typeof current?.Estimated === 'boolean' ? current.Estimated : null,
          asOf: fetchedAt,
          previousMonth,
        }, now),
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
   * $0 month and a net-negative month (credits exceed charges) are billing
   * data, not a failure; the first hours of a month are monthState
   * no_billed_days_yet, not a $0 month (this bare figure feeds only the
   * Dashboard's connection gates). Only a failed fetch falls back to the
   * inventory estimate.
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
    // 7d and 30d are read from the 90d entry (fetchCostTrend).
    const source = trendCacheSource(range)
    const cached = this.costTrendCache.get(AWSCostService.trendCacheKey(organizationId, awsConnectionIdentity(account), source, trendPeriodUtc(source, new Date())))
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

    // 7d is the 30d series' last 8 days (today-7 .. today), from the same
    // request and cache entry (today-bar TB-D1): each day's reportState is then
    // the 30-day view's, never one decided over 8 days alone (round-2 L-2).
    if (range === '7d') return sevenDayTrendFrom(await this.fetchCostTrend(organizationId, SEVEN_DAY_TREND_SOURCE))

    // One instant for the period, the key and the report states below.
    const now = new Date()

    // 30d is the 90d series' last 31 days (today-30 .. today), from the same
    // request and cache entry (CE-2), with each day's reportState decided again
    // over those 31 days: exactly what a 30d request of its own returned.
    if (range === '30d') return thirtyDayTrendFrom(await this.cachedCostTrend(organizationId, THIRTY_DAY_TREND_SOURCE, now), now)

    return this.cachedCostTrend(organizationId, range, now)
  }

  /**
   * One trend range's series as Cost Explorer returns it for the period that
   * range resolves to at `now`: from this org's cache entry for its current
   * connection, or one fetch shared by every concurrent caller (in-flight).
   */
  private async cachedCostTrend(organizationId: string, range: CostTrendRange, now: Date): Promise<CostTrendPoint[]> {
    // The connection first (costCacheKey): none throws AWS_NOT_CONNECTED, as before.
    const account = await requireEligibleAwsAccount(this.dbPool || pool, organizationId)
    // The period is fixed here, once: the key and the query below both use it.
    // Its end is tomorrow (UTC), so each point's reportState (and `provisional`),
    // computed at fetch time, never outlives the day it was computed for.
    const period = trendPeriodUtc(range, now)
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
      const result = await orgService.queryCostTrend(period, now)
      pruneExpired(this.costTrendCache, AWSCostService.MONTHLY_COST_CACHE_TTL, Date.now())
      this.costTrendCache.set(cacheKey, { data: result, timestamp: Date.now() })
      return result
    })().finally(() => {
      this.costTrendInFlight.delete(cacheKey)
    })

    this.costTrendInFlight.set(cacheKey, fetchPromise)
    return fetchPromise
  }

  /**
   * The Cost Explorer query itself (every page), on this instance's organization
   * credentials. Each point's reportState comes from the series' own line items
   * and Estimated flags, relative to `now` (costReportStates). A group without
   * the requested cost metric fails the read (CostMetricMissingError), never $0.
   */
  private async queryCostTrend(period: { start: string; end: string; granularity: Granularity }, now: Date = new Date()): Promise<CostTrendPoint[]> {
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

    const lastDays: string[] = []
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
        const amount = costMetricAmount(group)
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

      const end = result.TimePeriod?.End || ''
      const [ey, em, ed] = end.split('-').map(Number)
      const lastDay = end ? new Date(Date.UTC(ey, em - 1, ed - 1)).toISOString().slice(0, 10) : ''
      lastDays.push(lastDay)

      return {
        date: result.TimePeriod?.Start || '',
        compute,
        storage,
        database,
        network,
        other,
        total: compute + storage + database + network + other,
        byService,
        lineItems: (result.Groups || []).length,
        estimated: typeof result.Estimated === 'boolean' ? result.Estimated : null,
      }
    })

    const states = costReportStates(
      points.map((p, i) => ({ lastDay: lastDays[i], lineItems: p.lineItems ?? 0, estimated: p.estimated ?? null })),
      now
    )
    points.forEach((p, i) => {
      p.reportState = states[i]
      p.provisional = isProvisional(states[i])
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
