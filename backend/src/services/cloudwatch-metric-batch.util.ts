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
import { CloudWatchClient, GetMetricDataCommand, StatusCode } from '@aws-sdk/client-cloudwatch'

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
  stat: 'Average' | 'Sum'
}

export interface BatchSeriesResult {
  timestamps: Date[]
  values: number[]
}

// Keyed by BatchMetricQuery.id. A missing key is never produced -- every submitted query's
// id is pre-seeded to null before any request is sent, so a caller can always safely
// `.get(id)` for every query it submitted, whether or not AWS ever returned a result for it.
export type BatchMetricResults = Map<string, BatchSeriesResult | null>

// AWS hard limit: a single GetMetricData call accepts at most 500 MetricDataQuery entries.
const MAX_QUERIES_PER_REQUEST = 500

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
 * Handles NextToken pagination per chunk defensively (not expected to trigger at today's
 * datapoint volumes -- see the Phase 2C scoping audit -- but never assumed away).
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
  const results: BatchMetricResults = new Map()
  if (queries.length === 0) return results
  for (const q of queries) results.set(q.id, null)

  for (let offset = 0; offset < queries.length; offset += MAX_QUERIES_PER_REQUEST) {
    const chunk = queries.slice(offset, offset + MAX_QUERIES_PER_REQUEST)
    await fetchChunk(client, chunk, startTime, endTime, results)
  }

  return results
}

async function fetchChunk(
  client: CloudWatchClient,
  chunk: BatchMetricQuery[],
  startTime: Date,
  endTime: Date,
  results: BatchMetricResults
): Promise<void> {
  try {
    let nextToken: string | undefined
    do {
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

      for (const result of response.MetricDataResults ?? []) {
        // Map by Id, never by array position -- GetMetricData does not document that
        // MetricDataResults preserves MetricDataQueries' order.
        if (!result.Id) continue
        if (result.StatusCode === StatusCode.INTERNAL_ERROR || result.StatusCode === StatusCode.FORBIDDEN) continue
        const values = result.Values ?? []
        if (values.length === 0) continue
        results.set(result.Id, { timestamps: result.Timestamps ?? [], values })
      }

      nextToken = response.NextToken
    } while (nextToken)
  } catch (err) {
    console.error('[CloudWatch] GetMetricData batch request failed:', err)
    // Every id in this chunk stays null (already pre-seeded in fetchMetricDataBatch) --
    // other chunks are unaffected, since this catch only wraps this one chunk's requests.
  }
}

/**
 * Reduces a raw batched series to the single scalar cloudwatch.service.ts's healthRule
 * functions expect -- identical math to the pre-Phase-2C per-metric GetMetricStatistics
 * reduction (Sum: total across all datapoints; Average: mean across all datapoints), just
 * applied to GetMetricData's flat Values array instead of GetMetricStatistics's per-point
 * {Sum, Average} objects. A null series, or a series with zero datapoints, is null --
 * never fabricated as 0.
 */
export function reduceSeriesToScalar(series: BatchSeriesResult | null, stat: 'Average' | 'Sum'): number | null {
  if (series === null || series.values.length === 0) return null
  if (stat === 'Sum') {
    return series.values.reduce((sum, v) => sum + v, 0)
  }
  return series.values.reduce((sum, v) => sum + v, 0) / series.values.length
}
