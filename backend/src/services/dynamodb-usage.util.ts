/**
 * Real, per-table DynamoDB capacity/throttle telemetry from CloudWatch
 * (`AWS/DynamoDB`) -- ConsumedReadCapacityUnits, ConsumedWriteCapacityUnits,
 * ReadThrottleEvents, WriteThrottleEvents.
 *
 * Foundation only (Phase 3E, Checkpoint B): this module fetches and
 * normalizes real usage data. It does not decide what "low utilization"
 * means, does not compute a percentile/peak/average, does not compare
 * against provisioned capacity, and does not make any recommendation --
 * that policy belongs entirely to a future dynamodb_capacity detector (not
 * built yet). `windowDays`/`periodSeconds` are required caller inputs, not
 * a baked-in default, so this file never smuggles in an observation-window
 * policy decision that isn't this layer's to make.
 *
 * Table-level only: this does not fetch GSI-dimensioned metrics
 * (TableName + GlobalSecondaryIndexName), matching Checkpoint A's decision
 * not to over-model GSI economics in the foundation layer. A future
 * detector that needs GSI-level capacity evidence will need its own,
 * explicitly scoped extension of this pattern.
 *
 * Per-period datapoints, not a single collapsed number: unlike Lambda's
 * getLambdaUsageOverWindow() (one Sum over the whole window, because the
 * low-usage rule only ever needed a single 30-day total), a capacity-safety
 * rule needs to reason about peaks and bursts, not just an average --
 * collapsing to one number here would silently foreclose that analysis.
 * Each requested metric returns one entry per period in
 * [start, end), aligned to the full expected time grid; a period AWS
 * genuinely returned no datapoint for is `null` in that slot, never 0 --
 * whether "no datapoint" means "confirmed zero" (as it likely does for
 * ConsumedRead/WriteCapacityUnits, similar to EC2's continuously-published
 * CPUUtilization) or "monitoring gap" (as Lambda's Invocations metric
 * documented) has NOT been independently re-verified against current AWS
 * documentation in this session for DynamoDB specifically -- a future
 * detector must confirm this before treating a null-filled gap as anything
 * other than "we don't know," per this codebase's established discipline.
 * Read/WriteThrottleEvents are event-driven metrics (AWS's own convention:
 * only emitted when the event actually occurs), so an all-null throttle
 * series across a real observation window is a substantially stronger
 * signal of "no throttling occurred" than an all-null capacity series is
 * of "no capacity consumed" -- but this module still returns null, not 0,
 * for both, leaving that interpretation to the caller.
 *
 * Caching: short-TTL (15 min), keyed by (organizationId, tableName,
 * windowDays, periodSeconds) -- same rationale as lambda-usage.util.ts:
 * this avoids duplicate CloudWatch calls if discovery and a future
 * optimization scan both request the same table's usage close together.
 * Failures are never cached, so a transient throttle/network error never
 * prevents the very next caller from getting its own real attempt.
 * Org-scoped so two organizations that happen to name a table identically
 * can never read each other's usage data out of this in-process cache.
 */
import { CloudWatchClient, GetMetricStatisticsCommand, Statistic } from '@aws-sdk/client-cloudwatch';

const DYNAMODB_USAGE_CACHE_TTL_MS = 15 * 60 * 1000;

// AWS's documented hard cap on datapoints returned by a single
// GetMetricStatistics call. Refusing to request more than this is a real
// AWS API constraint, not an invented business threshold.
const MAX_DATAPOINTS_PER_CALL = 1440;

export interface DynamoDBCapacityDatapoint {
  /** ISO timestamp of this period's start. */
  timestamp: string;
  /** Sum of ConsumedReadCapacityUnits over this period; null = no datapoint returned. */
  consumedReadCapacityUnits: number | null;
  /** Sum of ConsumedWriteCapacityUnits over this period; null = no datapoint returned. */
  consumedWriteCapacityUnits: number | null;
  /** Sum of ReadThrottleEvents over this period; null = no datapoint returned. */
  readThrottleEvents: number | null;
  /** Sum of WriteThrottleEvents over this period; null = no datapoint returned. */
  writeThrottleEvents: number | null;
}

export interface DynamoDBCapacityUsage {
  windowDays: number;
  periodSeconds: number;
  /** One entry per period in [start, end), oldest first. */
  datapoints: DynamoDBCapacityDatapoint[];
}

export type DynamoDBCapacityUsageResult =
  | { status: 'fetched'; usage: DynamoDBCapacityUsage }
  | { status: 'unavailable'; reason: string };

interface CacheEntry {
  data: DynamoDBCapacityUsage;
  timestamp: number;
}

const usageCache = new Map<string, CacheEntry>();

function cacheKey(organizationId: string, tableName: string, windowDays: number, periodSeconds: number): string {
  return `${organizationId}:${tableName}:${windowDays}:${periodSeconds}`;
}

/** Builds the full expected period-start grid for [start, end), stepped by periodSeconds. */
function buildExpectedTimestamps(start: Date, end: Date, periodSeconds: number): Date[] {
  const timestamps: Date[] = [];
  let cursor = start.getTime();
  const endMs = end.getTime();
  const stepMs = periodSeconds * 1000;
  while (cursor < endMs) {
    timestamps.push(new Date(cursor));
    cursor += stepMs;
  }
  return timestamps;
}

/** Aligns sparse AWS datapoints onto the full expected grid; unmatched slots are null. */
function alignToGrid(
  expected: Date[],
  awsDatapoints: Array<{ Timestamp?: Date; Sum?: number }> | undefined
): Array<number | null> {
  const byTimestamp = new Map<number, number>();
  for (const dp of awsDatapoints || []) {
    if (dp.Timestamp && dp.Sum !== undefined) {
      byTimestamp.set(dp.Timestamp.getTime(), dp.Sum);
    }
  }
  return expected.map((ts) => byTimestamp.get(ts.getTime()) ?? null);
}

/**
 * Fetches real ConsumedReadCapacityUnits/ConsumedWriteCapacityUnits/
 * ReadThrottleEvents/WriteThrottleEvents for one table over
 * [now - windowDays, now), bucketed into periodSeconds-wide periods.
 *
 * Returns `{status: 'unavailable'}` -- never a fabricated/zero-filled
 * series -- when the requested window/period would exceed AWS's per-call
 * datapoint limit, or when any of the four CloudWatch calls fails.
 */
export async function getDynamoDBCapacityUsage(
  cloudWatchClient: CloudWatchClient,
  organizationId: string,
  tableName: string,
  windowDays: number,
  periodSeconds: number
): Promise<DynamoDBCapacityUsageResult> {
  const windowSeconds = windowDays * 24 * 60 * 60;
  const expectedDatapointCount = Math.ceil(windowSeconds / periodSeconds);
  if (expectedDatapointCount > MAX_DATAPOINTS_PER_CALL) {
    return {
      status: 'unavailable',
      reason: `Requested window (${windowDays}d) at this period (${periodSeconds}s) would need ${expectedDatapointCount} datapoints per metric, exceeding CloudWatch's ${MAX_DATAPOINTS_PER_CALL}-datapoint-per-call limit`,
    };
  }

  const key = cacheKey(organizationId, tableName, windowDays, periodSeconds);
  const cached = usageCache.get(key);
  if (cached && Date.now() - cached.timestamp < DYNAMODB_USAGE_CACHE_TTL_MS) {
    return { status: 'fetched', usage: cached.data };
  }

  try {
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - windowSeconds * 1000);
    const expectedTimestamps = buildExpectedTimestamps(startTime, endTime, periodSeconds);

    const metricNames = [
      'ConsumedReadCapacityUnits',
      'ConsumedWriteCapacityUnits',
      'ReadThrottleEvents',
      'WriteThrottleEvents',
    ] as const;

    const responses = await Promise.all(
      metricNames.map((metricName) =>
        cloudWatchClient.send(
          new GetMetricStatisticsCommand({
            Namespace: 'AWS/DynamoDB',
            MetricName: metricName,
            Dimensions: [{ Name: 'TableName', Value: tableName }],
            StartTime: startTime,
            EndTime: endTime,
            Period: periodSeconds,
            Statistics: [Statistic.Sum],
          })
        )
      )
    );

    const [consumedRead, consumedWrite, readThrottle, writeThrottle] = responses.map((r) =>
      alignToGrid(expectedTimestamps, r.Datapoints)
    );

    const datapoints: DynamoDBCapacityDatapoint[] = expectedTimestamps.map((ts, i) => ({
      timestamp: ts.toISOString(),
      consumedReadCapacityUnits: consumedRead[i],
      consumedWriteCapacityUnits: consumedWrite[i],
      readThrottleEvents: readThrottle[i],
      writeThrottleEvents: writeThrottle[i],
    }));

    const usage: DynamoDBCapacityUsage = { windowDays, periodSeconds, datapoints };
    usageCache.set(key, { data: usage, timestamp: Date.now() });
    return { status: 'fetched', usage };
  } catch (error: any) {
    console.error(`Error fetching CloudWatch capacity usage for DynamoDB table ${tableName}:`, error?.message || error);
    return { status: 'unavailable', reason: error?.message || error?.name || 'Unknown error' };
  }
}
