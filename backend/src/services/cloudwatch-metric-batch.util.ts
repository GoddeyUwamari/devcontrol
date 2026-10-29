/**
 * CloudWatch Scalability Phase 2C: a shared GetMetricData batching helper used by
 * cloudwatch.service.ts's EC2/ALB/Lambda/DynamoDB capabilities to replace what was
 * previously one GetMetricStatistics call per metric per resource with as few
 * GetMetricData requests as the API's 500-MetricDataQuery limit allows.
 *
 * Deliberately minimal: this module only knows how to send queries and map results back
 * by Id -- it assigns no health, uptime, or business meaning to any value. That mapping
 * (which metric means what, how a missing value should be interpreted) stays entirely in
 * cloudwatch.service.ts's own capability.healthRule() functions, unchanged by this phase.
 *
 * GetMetricData's StartTime/EndTime are request-level fields, shared by every query in
 * one call -- this is why a caller with two different time windows for the same resource
 * type (e.g. ALB's current-vs-previous trend comparison) must call this function twice,
 * once per window, rather than once. This module does not attempt to hide that constraint
 * behind a single call; see cloudwatch.service.ts's evaluateCapabilityBatch() for how the
 * two windows are split and dispatched concurrently.
 */
import { CloudWatchClient, GetMetricDataCommand, MetricDataResult, StatusCode } from '@aws-sdk/client-cloudwatch'
import { isAccessDeniedError, isThrottlingError, listAllPages, Listing } from '../utils/awsCallPolicy'

export type BatchDimension = { Name: string; Value: string }

export interface BatchMetricQuery {
  // Must already be a valid MetricDataQuery Id (lowercase-leading, letters/digits/
  // underscore only) and unique within this call -- building a collision-safe, charset-
  // valid Id is the caller's responsibility (see cloudwatch.service.ts's index-based
  // scheme), since a raw AWS resource identifier is very often NOT a valid Id itself
  // (EC2 instance IDs and ALB dimension values both routinely contain hyphens/slashes).
  id: string
  namespace: string
  metricName: string
  dimensions: BatchDimension[]
  period: number
  // 'Maximum' added for Aurora's AuroraReplicaLagMaximum signal (the metric's own name
  // already means "max across replicas" at a point in time; requesting the Maximum
  // statistic additionally catches a lag spike within the period that Average would
  // smooth away -- see cloudwatch.service.ts's evaluateAuroraClusters()).
  // 'Minimum' added for RDS FreeStorageSpace (OB3): the lowest free space in the window.
  stat: 'Average' | 'Sum' | 'Maximum' | 'Minimum'
}

export interface BatchSeriesResult {
  timestamps: Date[]
  values: number[]
}

// Keyed by BatchMetricQuery.id. A missing key is never produced -- every submitted query's
// id is pre-seeded to null before any request is sent, so a caller can always safely
// `.get(id)` for every query it submitted, whether or not AWS ever returned a result for it.
export type BatchMetricResults = Map<string, BatchSeriesResult | null>

/**
 * How one query ended, which a `null` series cannot say:
 *   complete       the query completed and returned at least one datapoint;
 *   empty          the query completed and returned no datapoints;
 *   access_denied  StatusCode Forbidden, or the request was refused;
 *   throttled      the request was throttled (after the SDK's own retries);
 *   query_failed   StatusCode InternalError, or PartialData on the query's last
 *                  page, the request failed otherwise, the query's Id never came
 *                  back, its pages repeated a timestamp, or its chunk stopped at
 *                  the page limit with pages left.
 */
export type QueryOutcome = 'complete' | 'empty' | 'access_denied' | 'throttled' | 'query_failed'

export interface BatchQueryStatus {
  outcome: QueryOutcome
  // Newest datapoint timestamp; null unless outcome is 'complete'.
  newestTimestamp: Date | null
}

export type BatchQueryStatuses = Map<string, BatchQueryStatus>

// AWS hard limit: a single GetMetricData call accepts at most 500 MetricDataQuery entries.
const MAX_QUERIES_PER_REQUEST = 500

/** The outcome a whole failed request gives each of its queries. */
function requestFailureOutcome(err: unknown): QueryOutcome {
  if (isThrottlingError(err)) return 'throttled'
  if (isAccessDeniedError(err)) return 'access_denied'
  return 'query_failed'
}

/**
 * Fetches a set of CloudWatch metrics, all sharing one [startTime, endTime) window, in as
 * few GetMetricData requests as the 500-query limit allows. Returns a map from each
 * query's `id` to its raw {timestamps, values} series, or `null` if that specific query
 * has no usable result -- covering all of: the query id missing entirely from the
 * response, an empty Values array, and a per-query StatusCode of InternalError or
 * Forbidden. A query with StatusCode Complete or PartialData and a non-empty Values array
 * is returned as-is -- PartialData is not treated as failure, exactly as the prior
 * GetMetricStatistics-based fetch already tolerated an incomplete window without
 * distinguishing it from a complete one.
 *
 * Reads every NextToken page of each chunk (at most listAllPages' page limit) and
 * appends each query's datapoints across its pages. Not expected to trigger at today's
 * datapoint volumes -- see the Phase 2C scoping audit -- but never assumed away.
 *
 * If an entire chunk's request throws (network/auth/throttling), every query id in that
 * chunk maps to `null`; other chunks already fetched, or not yet attempted, are
 * unaffected, since each chunk is an independent request. This never fabricates a value
 * and never falls back to a per-metric GetMetricStatistics call -- a failure here means
 * "no data available right now," exactly like a null result already means today. No
 * custom retry logic is added beyond the AWS SDK's own built-in behavior.
 */
export async function fetchMetricDataBatch(
  client: CloudWatchClient,
  queries: BatchMetricQuery[],
  startTime: Date,
  endTime: Date
): Promise<BatchMetricResults> {
  return (await fetchMetricDataBatchWithStatus(client, queries, startTime, endTime)).results
}

/**
 * The same requests as fetchMetricDataBatch(), returning its unchanged `results` map
 * alongside each query's QueryOutcome. `results` is filled by exactly the code
 * fetchMetricDataBatch() always ran, so the two never disagree on a value; `statuses`
 * only adds what that map collapses to null.
 */
export async function fetchMetricDataBatchWithStatus(
  client: CloudWatchClient,
  queries: BatchMetricQuery[],
  startTime: Date,
  endTime: Date
): Promise<{ results: BatchMetricResults; statuses: BatchQueryStatuses }> {
  const results: BatchMetricResults = new Map()
  const statuses: BatchQueryStatuses = new Map()
  if (queries.length === 0) return { results, statuses }
  for (const q of queries) results.set(q.id, null)

  for (let offset = 0; offset < queries.length; offset += MAX_QUERIES_PER_REQUEST) {
    const chunk = queries.slice(offset, offset + MAX_QUERIES_PER_REQUEST)
    await fetchChunk(client, chunk, startTime, endTime, results, statuses)
  }

  return { results, statuses }
}

function newestOf(timestamps: Date[]): Date | null {
  let newest: Date | null = null
  for (const ts of timestamps) {
    if (ts instanceof Date && !isNaN(ts.getTime()) && (newest === null || ts > newest)) newest = ts
  }
  return newest
}

async function fetchChunk(
  client: CloudWatchClient,
  chunk: BatchMetricQuery[],
  startTime: Date,
  endTime: Date,
  results: BatchMetricResults,
  statuses: BatchQueryStatuses
): Promise<void> {
  let listing: Listing<MetricDataResult>
  try {
    listing = await listAllPages('CloudWatch: GetMetricData', async (nextToken) => {
      const response = await client.send(
        new GetMetricDataCommand({
          MetricDataQueries: chunk.map((q) => ({
            Id: q.id,
            MetricStat: {
              Metric: { Namespace: q.namespace, MetricName: q.metricName, Dimensions: q.dimensions },
              Period: q.period,
              Stat: q.stat,
            },
            ReturnData: true,
          })),
          StartTime: startTime,
          EndTime: endTime,
          NextToken: nextToken,
        })
      )
      return { items: response.MetricDataResults ?? [], nextToken: response.NextToken }
    })
  } catch (err) {
    console.error('[CloudWatch] GetMetricData batch request failed:', err)
    // Every id in this chunk stays null (already pre-seeded in fetchMetricDataBatch) --
    // other chunks are unaffected, since this catch only wraps this one chunk's requests.
    // The whole request failed, so no query in it completed, whatever an earlier page said.
    const outcome = requestFailureOutcome(err)
    for (const q of chunk) statuses.set(q.id, { outcome, newestTimestamp: null })
    return
  }

  // Every page's results for an Id, in page order. A query whose datapoints did not fit
  // one response continues on the next page, so its series is all of its pages together.
  const pagesById = new Map<string, MetricDataResult[]>()
  for (const result of listing.items) {
    // Map by Id, never by array position -- GetMetricData does not document that
    // MetricDataResults preserves MetricDataQueries' order.
    if (!result.Id) continue
    const pages = pagesById.get(result.Id)
    if (pages) pages.push(result)
    else pagesById.set(result.Id, [result])
  }

  for (const q of chunk) {
    const pages = pagesById.get(q.id)
    if (!pages) {
      statuses.set(q.id, { outcome: 'query_failed', newestTimestamp: null })
      continue
    }
    const merged = mergePages(pages)
    if (merged.series) results.set(q.id, merged.series)
    // Stopped at the page limit with pages left: no query in this chunk is known complete.
    statuses.set(q.id, listing.complete ? merged.status : { outcome: 'query_failed', newestTimestamp: null })
  }
}

/**
 * One query's pages as one series and one outcome. Pages answered Forbidden or
 * InternalError contribute no values (as a single page never did); the worst of them
 * decides the outcome; otherwise the query is complete only if its last page says
 * Complete -- a page with no NextToken after it does not make a PartialData query
 * complete. A timestamp a later page repeats from an earlier one can't be merged without
 * counting a datapoint twice, so that query has no series and is query_failed.
 */
function mergePages(pages: MetricDataResult[]): { series: BatchSeriesResult | null; status: BatchQueryStatus } {
  const timestamps: Date[] = []
  const values: number[] = []
  // Timestamps on earlier pages: one page is taken as AWS sent it, as it always was.
  const earlierPages = new Set<number>()
  let duplicate = false
  for (const page of pages) {
    if (page.StatusCode === StatusCode.INTERNAL_ERROR || page.StatusCode === StatusCode.FORBIDDEN) continue
    const pageValues = page.Values ?? []
    const pageTimestamps = page.Timestamps ?? []
    const thisPage: number[] = []
    for (let i = 0; i < pageValues.length; i++) {
      const ts = pageTimestamps[i]
      if (!(ts instanceof Date)) continue
      if (earlierPages.has(ts.getTime())) duplicate = true
      thisPage.push(ts.getTime())
    }
    for (const t of thisPage) earlierPages.add(t)
    timestamps.push(...pageTimestamps)
    values.push(...pageValues)
  }

  const failed = { series: null, status: { outcome: 'query_failed' as const, newestTimestamp: null } }
  if (duplicate) return failed
  const series = values.length > 0 ? { timestamps, values } : null
  if (pages.some((p) => p.StatusCode === StatusCode.FORBIDDEN)) return { series, status: { outcome: 'access_denied', newestTimestamp: null } }
  if (pages.some((p) => p.StatusCode === StatusCode.INTERNAL_ERROR)) return { series, status: { outcome: 'query_failed', newestTimestamp: null } }
  return { series, status: statusOf(pages[pages.length - 1].StatusCode, values.length, timestamps) }
}

function statusOf(statusCode: string | undefined, valueCount: number, timestamps: Date[]): BatchQueryStatus {
  if (statusCode === StatusCode.FORBIDDEN) return { outcome: 'access_denied', newestTimestamp: null }
  if (statusCode !== StatusCode.COMPLETE) return { outcome: 'query_failed', newestTimestamp: null }
  if (valueCount === 0) return { outcome: 'empty', newestTimestamp: null }
  return { outcome: 'complete', newestTimestamp: newestOf(timestamps) }
}

/**
 * Reduces a raw batched series to the single scalar cloudwatch.service.ts's healthRule
 * functions expect -- identical math to the pre-Phase-2C per-metric GetMetricStatistics
 * reduction (Sum: total across all datapoints; Average: mean across all datapoints), just
 * applied to GetMetricData's flat Values array instead of GetMetricStatistics's per-point
 * {Sum, Average} objects. A null series, or a series with zero datapoints, is null --
 * never fabricated as 0.
 */
export function reduceSeriesToScalar(series: BatchSeriesResult | null, stat: BatchMetricQuery['stat']): number | null {
  if (series === null || series.values.length === 0) return null
  if (stat === 'Sum') {
    return series.values.reduce((sum, v) => sum + v, 0)
  }
  if (stat === 'Maximum') {
    return Math.max(...series.values)
  }
  if (stat === 'Minimum') {
    let min = series.values[0]
    for (const v of series.values) if (v < min) min = v
    return min
  }
  return series.values.reduce((sum, v) => sum + v, 0) / series.values.length
}
