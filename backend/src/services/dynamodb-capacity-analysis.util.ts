/**
 * Real, per-table DynamoDB provisioned-capacity utilization telemetry for the
 * `dynamodb_capacity` detector (Phase 3E). Fetches the six CloudWatch metrics
 * AWS's own right-sizing guide uses (`ConsumedReadCapacityUnits`,
 * `ConsumedWriteCapacityUnits`, `ProvisionedReadCapacityUnits`,
 * `ProvisionedWriteCapacityUnits`, `ReadThrottleEvents`,
 * `WriteThrottleEvents` -- see
 * https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/CostOptimization_RightSizedProvisioning.html)
 * in a single batched `GetMetricData` call and reduces them to the exact
 * per-dimension statistics the detector's locked-in methodology needs.
 *
 * Locked methodology (do not change without a new methodology checkpoint):
 * 30-day window, 3,600-second (1-hour) period -- matches AWS's own worked
 * example, stays within `ProvisionedRead/WriteCapacityUnits`'s native
 * 5-minute-or-coarser emission granularity, and comfortably fits in one
 * `GetMetricData` call (720 datapoints/metric, vs. that API's ~100,800
 * datapoint ceiling -- pagination is still handled defensively via
 * `NextToken`, but is not expected to trigger at this scale).
 * `Consumed*CapacityUnits`/`*ThrottleEvents` use `Sum`;
 * `Provisioned*CapacityUnits` uses `Average` -- AWS's own documented pairing.
 *
 * This module only fetches and aligns the raw series -- it makes no
 * eligibility or recommendation decision. `analyzeDynamoDBCapacityDimension()`
 * below is a separate, pure reduction step; the actual qualification
 * thresholds (the 20% reference utilization signal, the 85%-of-valid-
 * intervals requirement, the 576-of-720 minimum valid sample) belong to the
 * detector in cost-optimization.service.ts, exactly mirroring how this
 * codebase's other detectors (e.g. detectLowUsageLambdaFunctions) keep their
 * own threshold constants separate from the shared fetch utility.
 *
 * Never fabricates: a missing datapoint for either the consumed or the
 * provisioned side of an interval makes that interval invalid for utilization
 * purposes -- never assumed 0% or 100%. Throttle validity is tracked
 * completely independently of utilization validity (a hierarchy AWS's own
 * metric reference does not merge, and this module must not merge either) --
 * see analyzeDynamoDBCapacityDimension()'s doc comment for why a missing
 * throttle datapoint is excluded, not assumed zero, even though AWS's docs
 * did not explicitly confirm zero-throttle hours reliably emit an explicit
 * zero datapoint the way ConsumedReadCapacityUnits's SampleCount is
 * documented to.
 *
 * Table-level only, and only the base table: this never requests the
 * `GlobalSecondaryIndexName` dimension. AWS's own metrics reference confirms
 * `TableName`-only queries for every metric here (including the throttle
 * metrics) return base-table data only -- a GSI's own consumption and
 * throttling are a completely separate, unfetched data source. This is why
 * GSI-bearing tables must be excluded by the caller before this module is
 * ever invoked for them: the throttle safety gate itself is blind to
 * GSI-scoped throttling, not just the utilization evidence.
 */
import { CloudWatchClient, GetMetricDataCommand, ScanBy } from '@aws-sdk/client-cloudwatch';

export const DYNAMODB_CAPACITY_ANALYSIS_WINDOW_DAYS = 30;
export const DYNAMODB_CAPACITY_PERIOD_SECONDS = 3600;

const METRIC_QUERIES = [
  { id: 'consumedRead', metricName: 'ConsumedReadCapacityUnits', stat: 'Sum' },
  { id: 'consumedWrite', metricName: 'ConsumedWriteCapacityUnits', stat: 'Sum' },
  { id: 'provisionedRead', metricName: 'ProvisionedReadCapacityUnits', stat: 'Average' },
  { id: 'provisionedWrite', metricName: 'ProvisionedWriteCapacityUnits', stat: 'Average' },
  { id: 'readThrottle', metricName: 'ReadThrottleEvents', stat: 'Sum' },
  { id: 'writeThrottle', metricName: 'WriteThrottleEvents', stat: 'Sum' },
] as const;

export interface DynamoDBCapacityMetricSeries {
  /** ISO timestamp of each hourly interval's start, oldest first. */
  intervalStartTimes: string[];
  /** Average RCU/sec for the interval (Sum(ConsumedReadCapacityUnits)/periodSeconds); null = no datapoint. */
  consumedReadPerSecond: Array<number | null>;
  consumedWritePerSecond: Array<number | null>;
  /** Average(ProvisionedReadCapacityUnits) for the interval; null = no datapoint. */
  provisionedRead: Array<number | null>;
  provisionedWrite: Array<number | null>;
  /** Sum(ReadThrottleEvents) for the interval; null = no datapoint (never assumed 0). */
  readThrottleEvents: Array<number | null>;
  writeThrottleEvents: Array<number | null>;
}

export type DynamoDBCapacityMetricsResult =
  | { status: 'fetched'; series: DynamoDBCapacityMetricSeries }
  | { status: 'unavailable'; reason: string };

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

/** Aligns a GetMetricData result's parallel Timestamps/Values arrays onto the full expected hourly grid; unmatched slots are null. */
function alignToGrid(expected: Date[], timestamps: Date[], values: number[]): Array<number | null> {
  const byTimestamp = new Map<number, number>();
  for (let i = 0; i < timestamps.length; i++) {
    byTimestamp.set(timestamps[i].getTime(), values[i]);
  }
  return expected.map((ts) => byTimestamp.get(ts.getTime()) ?? null);
}

/**
 * Fetches all six metrics for one table in a single batched `GetMetricData`
 * call (paginating via `NextToken` if CloudWatch ever splits the response --
 * not expected at this datapoint volume, but handled correctly rather than
 * assumed away). Returns `{status: 'unavailable'}` -- never a partial or
 * zero-filled series -- if the call itself fails.
 */
export async function fetchDynamoDBCapacityMetrics(
  cloudWatchClient: CloudWatchClient,
  tableName: string,
  windowDays: number = DYNAMODB_CAPACITY_ANALYSIS_WINDOW_DAYS,
  periodSeconds: number = DYNAMODB_CAPACITY_PERIOD_SECONDS
): Promise<DynamoDBCapacityMetricsResult> {
  try {
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - windowDays * 24 * 60 * 60 * 1000);
    const expectedTimestamps = buildExpectedTimestamps(startTime, endTime, periodSeconds);

    const rawById = new Map<string, { timestamps: Date[]; values: number[] }>();
    for (const q of METRIC_QUERIES) rawById.set(q.id, { timestamps: [], values: [] });

    let nextToken: string | undefined;
    do {
      const response = await cloudWatchClient.send(
        new GetMetricDataCommand({
          MetricDataQueries: METRIC_QUERIES.map((q) => ({
            Id: q.id,
            MetricStat: {
              Metric: {
                Namespace: 'AWS/DynamoDB',
                MetricName: q.metricName,
                Dimensions: [{ Name: 'TableName', Value: tableName }],
              },
              Period: periodSeconds,
              Stat: q.stat,
            },
            ReturnData: true,
          })),
          StartTime: startTime,
          EndTime: endTime,
          ScanBy: ScanBy.TIMESTAMP_ASCENDING,
          NextToken: nextToken,
        })
      );

      for (const result of response.MetricDataResults || []) {
        if (!result.Id) continue;
        const acc = rawById.get(result.Id);
        if (!acc) continue;
        acc.timestamps.push(...(result.Timestamps || []));
        acc.values.push(...(result.Values || []));
      }
      nextToken = response.NextToken;
    } while (nextToken);

    const consumedReadSum = alignToGrid(expectedTimestamps, rawById.get('consumedRead')!.timestamps, rawById.get('consumedRead')!.values);
    const consumedWriteSum = alignToGrid(expectedTimestamps, rawById.get('consumedWrite')!.timestamps, rawById.get('consumedWrite')!.values);
    const provisionedRead = alignToGrid(expectedTimestamps, rawById.get('provisionedRead')!.timestamps, rawById.get('provisionedRead')!.values);
    const provisionedWrite = alignToGrid(expectedTimestamps, rawById.get('provisionedWrite')!.timestamps, rawById.get('provisionedWrite')!.values);
    const readThrottleEvents = alignToGrid(expectedTimestamps, rawById.get('readThrottle')!.timestamps, rawById.get('readThrottle')!.values);
    const writeThrottleEvents = alignToGrid(expectedTimestamps, rawById.get('writeThrottle')!.timestamps, rawById.get('writeThrottle')!.values);

    // Sum -> average-per-second, exactly AWS's documented conversion
    // (Sum over the period / period length in seconds). A null Sum stays
    // null -- dividing a real gap by 3600 must never produce a fabricated 0.
    const toPerSecond = (sums: Array<number | null>): Array<number | null> =>
      sums.map((s) => (s === null ? null : s / periodSeconds));

    const series: DynamoDBCapacityMetricSeries = {
      intervalStartTimes: expectedTimestamps.map((ts) => ts.toISOString()),
      consumedReadPerSecond: toPerSecond(consumedReadSum),
      consumedWritePerSecond: toPerSecond(consumedWriteSum),
      provisionedRead,
      provisionedWrite,
      readThrottleEvents,
      writeThrottleEvents,
    };

    return { status: 'fetched', series };
  } catch (error: any) {
    return { status: 'unavailable', reason: error?.message || error?.name || 'Unknown error' };
  }
}

export interface DynamoDBCapacityDimensionAnalysis {
  totalIntervals: number;
  /** Intervals with both a real consumed and a real provisioned datapoint. */
  validUtilizationIntervals: number;
  /** Of the valid intervals, how many had hourly-average utilization below the reference threshold. */
  lowUtilizationIntervals: number;
  /** 0 when validUtilizationIntervals is 0 -- the caller must gate on validUtilizationIntervals separately, never rely on this percentage alone. */
  lowUtilizationPercentage: number;
  /** The single highest hourly-average utilization observed, as a percentage. Null if no valid interval exists. NEVER call this "peak" -- it is an hourly average, not an instantaneous maximum (AWS's own documented smoothing caveat). */
  highestHourlyAverageUtilizationPercent: number | null;
  /** The raw average-RCU/sec-or-WCU/sec throughput at that same busiest valid interval -- the figure the cost scenario is built from. Null if no valid interval exists. */
  highestHourlyAverageThroughputPerSecond: number | null;
  /** Intervals with a real (non-null) throttle datapoint -- tracked completely independently of utilization validity. */
  throttleValidIntervals: number;
  /** Of the valid throttle intervals, how many had Sum > 0 (confirmed table-level provisioned-throughput throttling). */
  throttleConfirmedIntervals: number;
}

/**
 * Pure reduction over one dimension's (read or write) aligned series. Takes
 * no threshold-eligibility decision itself -- only computes the facts a
 * detector's eligibility policy needs. `referenceThresholdPercent` is the
 * caller's chosen investigation-signal percentage (locked at 20% for v1,
 * per AWS's own documented reference point -- see
 * cost-optimization.service.ts's DYNAMODB_CAPACITY_REFERENCE_UTILIZATION_THRESHOLD_PERCENT),
 * passed in rather than hardcoded here so this module stays a pure
 * evidence-computation layer, not a policy layer.
 */
export function analyzeDynamoDBCapacityDimension(
  consumedPerSecond: Array<number | null>,
  provisioned: Array<number | null>,
  throttleEvents: Array<number | null>,
  referenceThresholdPercent: number
): DynamoDBCapacityDimensionAnalysis {
  const totalIntervals = consumedPerSecond.length;
  let validUtilizationIntervals = 0;
  let lowUtilizationIntervals = 0;
  let highestHourlyAverageUtilizationPercent: number | null = null;
  let highestHourlyAverageThroughputPerSecond: number | null = null;

  for (let i = 0; i < totalIntervals; i++) {
    const consumed = consumedPerSecond[i];
    const prov = provisioned[i];
    // Missing consumed OR missing/non-positive provisioned -> interval
    // excluded entirely, never treated as 0% or 100% utilization.
    if (consumed === null || prov === null || !(prov > 0)) continue;

    validUtilizationIntervals++;
    const utilizationPercent = (consumed / prov) * 100;
    if (utilizationPercent < referenceThresholdPercent) lowUtilizationIntervals++;
    if (highestHourlyAverageUtilizationPercent === null || utilizationPercent > highestHourlyAverageUtilizationPercent) {
      highestHourlyAverageUtilizationPercent = utilizationPercent;
      highestHourlyAverageThroughputPerSecond = consumed;
    }
  }

  let throttleValidIntervals = 0;
  let throttleConfirmedIntervals = 0;
  for (const t of throttleEvents) {
    if (t === null) continue; // never assumed zero
    throttleValidIntervals++;
    if (t > 0) throttleConfirmedIntervals++;
  }

  return {
    totalIntervals,
    validUtilizationIntervals,
    lowUtilizationIntervals,
    lowUtilizationPercentage: validUtilizationIntervals > 0 ? (lowUtilizationIntervals / validUtilizationIntervals) * 100 : 0,
    highestHourlyAverageUtilizationPercent,
    highestHourlyAverageThroughputPerSecond,
    throttleValidIntervals,
    throttleConfirmedIntervals,
  };
}
