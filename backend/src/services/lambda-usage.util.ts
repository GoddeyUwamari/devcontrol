/**
 * Shared, single-source-of-truth read of a Lambda function's real CloudWatch
 * usage over a trailing window. Used by both awsResourceDiscovery.ts (to
 * compute `estimated_monthly_cost` for inventory) and
 * cost-optimization.service.ts's lambda_low_usage detector (to decide
 * whether a recommendation is warranted and what it would save). A single
 * implementation means the two can never silently disagree about what a
 * Lambda function's real usage is -- replacing the discovery-time fabricated
 * assumption of 100K invocations/month, which never reflected any real
 * account's actual usage, and the AI Assistant's separate broken
 * `tags->>'invocations'` read, which always evaluated to 0.
 *
 * CloudWatch semantics (unchanged from the pre-existing detector this was
 * extracted from -- see git history of cost-optimization.service.ts):
 *   - Invocations: Sum over the full window, as a single datapoint
 *     (Period == window length). Unlike S3's BucketSizeBytes (published
 *     daily regardless of activity) or EC2's CPUUtilization (published
 *     continuously for any running instance), AWS Lambda's Invocations
 *     metric only ever emits a datapoint for a period that had at least one
 *     invocation -- CloudWatch returning zero datapoints for a real,
 *     existing function is the documented, correct signal for "zero
 *     invocations in this window", not missing data.
 *   - Duration: Average over the window, only fetched when invocations > 0
 *     (a function with zero invocations has no duration to average).
 *   - A thrown error from the API call itself (throttling, permissions,
 *     network) is the only case treated as "we don't know" -- returns null,
 *     and every caller must skip/preserve-prior-value rather than assume
 *     zero cost or zero usage.
 *
 * Caching: discovery calls this once per function, and moments later (same
 * discoverAllResources() run -- see awsResourceDiscovery.ts's call into
 * costOptimizationService.analyzeAllResources()) the optimization scan calls
 * it again for the same functions. Without a cache this would double
 * per-function CloudWatch API calls on every discovery cycle for no benefit
 * (the usage can't meaningfully change in the seconds/minutes between the
 * two phases of one run). The cache is short (15 minutes) -- long enough to
 * cover that gap, short enough that it is never mistaken for a real
 * across-cycle freshness guarantee (discovery itself only runs every 6
 * hours). Failures are never cached: a transient throttle/network error
 * during discovery must not prevent the very next call (from the
 * optimization scan, or a manual retry) from getting its own real attempt.
 * Keyed by organizationId -- never just functionName -- so two
 * organizations that happen to name a function identically can never read
 * each other's usage data out of this in-process cache.
 */
import { CloudWatchClient, GetMetricStatisticsCommand, Statistic } from '@aws-sdk/client-cloudwatch';

export const LAMBDA_USAGE_WINDOW_DAYS = 30;

const LAMBDA_USAGE_CACHE_TTL_MS = 15 * 60 * 1000;

export interface LambdaUsage {
  invocations: number;
  avgDurationMs: number;
}

interface CacheEntry {
  data: LambdaUsage;
  timestamp: number;
}

const usageCache = new Map<string, CacheEntry>();

function cacheKey(organizationId: string, functionName: string, windowDays: number): string {
  return `${organizationId}:${functionName}:${windowDays}`;
}

/**
 * Real Invocations (Sum) and Duration (Average) for one Lambda function over
 * the trailing `windowDays`. Returns null only when the CloudWatch API call
 * itself failed -- callers must treat that as "unavailable", never as zero
 * usage or zero cost.
 */
export async function getLambdaUsageOverWindow(
  cloudWatchClient: CloudWatchClient,
  organizationId: string,
  functionName: string,
  windowDays: number = LAMBDA_USAGE_WINDOW_DAYS
): Promise<LambdaUsage | null> {
  const key = cacheKey(organizationId, functionName, windowDays);
  const cached = usageCache.get(key);
  if (cached && Date.now() - cached.timestamp < LAMBDA_USAGE_CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - windowDays * 24 * 60 * 60 * 1000);
    const windowSeconds = windowDays * 24 * 60 * 60;

    const invocationsResponse = await cloudWatchClient.send(
      new GetMetricStatisticsCommand({
        Namespace: 'AWS/Lambda',
        MetricName: 'Invocations',
        Dimensions: [{ Name: 'FunctionName', Value: functionName }],
        StartTime: startTime,
        EndTime: endTime,
        Period: windowSeconds,
        Statistics: [Statistic.Sum],
      })
    );
    const invocations = invocationsResponse.Datapoints?.[0]?.Sum ?? 0;

    let avgDurationMs = 0;
    if (invocations > 0) {
      const durationResponse = await cloudWatchClient.send(
        new GetMetricStatisticsCommand({
          Namespace: 'AWS/Lambda',
          MetricName: 'Duration',
          Dimensions: [{ Name: 'FunctionName', Value: functionName }],
          StartTime: startTime,
          EndTime: endTime,
          Period: windowSeconds,
          Statistics: [Statistic.Average],
        })
      );
      avgDurationMs = durationResponse.Datapoints?.[0]?.Average ?? 0;
    }

    const data: LambdaUsage = { invocations, avgDurationMs };
    usageCache.set(key, { data, timestamp: Date.now() });
    return data;
  } catch (error: any) {
    console.error(`Error fetching CloudWatch usage for Lambda function ${functionName}:`, error?.message || error);
    return null;
  }
}
