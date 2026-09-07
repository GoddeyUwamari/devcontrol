/**
 * Phase 3E, Checkpoint B: getDynamoDBCapacityUsage() -- the shared, evidence-
 * only DynamoDB capacity/throttle telemetry primitive. Critical properties:
 * per-period null for a genuinely missing datapoint (never 0), no window/
 * threshold policy baked in, a hard AWS datapoint-limit guard, and the same
 * cache/no-cache-on-failure/org-isolation discipline as lambda-usage.util.ts.
 */
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { getDynamoDBCapacityUsage } from '../dynamodb-usage.util';

function withMockedSend(send: jest.Mock): CloudWatchClient {
  const client = new CloudWatchClient({ region: 'us-east-1' });
  (client as any).send = send;
  return client;
}

// 4 metrics always fetched per call: ConsumedRead, ConsumedWrite, ReadThrottle, WriteThrottle.
function fourEmptyResponses() {
  return [{ Datapoints: [] }, { Datapoints: [] }, { Datapoints: [] }, { Datapoints: [] }];
}

describe('getDynamoDBCapacityUsage', () => {
  it('fetches all 4 metrics (consumed read/write, read/write throttle) for the table', async () => {
    const send = jest.fn().mockImplementation(() => Promise.resolve({ Datapoints: [] }));
    const client = withMockedSend(send);

    await getDynamoDBCapacityUsage(client, 'org-1', 'orders', 1, 3600);

    expect(send).toHaveBeenCalledTimes(4);
    const metricNames = send.mock.calls.map((call) => call[0].input.MetricName).sort();
    expect(metricNames).toEqual([
      'ConsumedReadCapacityUnits',
      'ConsumedWriteCapacityUnits',
      'ReadThrottleEvents',
      'WriteThrottleEvents',
    ]);
    for (const call of send.mock.calls) {
      expect(call[0].input.Namespace).toBe('AWS/DynamoDB');
      expect(call[0].input.Dimensions).toEqual([{ Name: 'TableName', Value: 'orders' }]);
      expect(call[0].input.Period).toBe(3600);
    }
  });

  it('a genuinely missing datapoint is null, never 0, for every metric', async () => {
    const send = jest.fn().mockImplementation(() => Promise.resolve({ Datapoints: [] }));
    const client = withMockedSend(send);

    const result = await getDynamoDBCapacityUsage(client, 'org-2', 'empty-table', 1, 86400);

    expect(result.status).toBe('fetched');
    if (result.status === 'fetched') {
      expect(result.usage.datapoints).toHaveLength(1);
      const dp = result.usage.datapoints[0];
      expect(dp.consumedReadCapacityUnits).toBeNull();
      expect(dp.consumedWriteCapacityUnits).toBeNull();
      expect(dp.readThrottleEvents).toBeNull();
      expect(dp.writeThrottleEvents).toBeNull();
    }
  });

  it('preserves real per-period values, aligned to the correct period slot', async () => {
    // Real AWS behavior: CloudWatch computes each returned Datapoint's
    // Timestamp aligned to Period boundaries starting from the StartTime we
    // send. Freezing the clock for this test makes every `new Date()` call
    // inside the function return the exact same value, so the expected
    // period boundaries can be computed independently without drifting by
    // the few milliseconds two separate real `new Date()` calls would
    // otherwise differ by.
    jest.useFakeTimers().setSystemTime(new Date('2026-01-15T00:00:00.000Z'));
    try {
      const windowStart = new Date('2026-01-13T00:00:00.000Z'); // now - 2 days
      const period1Start = windowStart;
      const period2Start = new Date(windowStart.getTime() + 86400 * 1000);

      const send = jest
        .fn()
        .mockResolvedValueOnce({ Datapoints: [{ Timestamp: period1Start, Sum: 120 }] }) // ConsumedRead
        .mockResolvedValueOnce({ Datapoints: [{ Timestamp: period2Start, Sum: 45 }] }) // ConsumedWrite
        .mockResolvedValueOnce({ Datapoints: [] }) // ReadThrottle
        .mockResolvedValueOnce({ Datapoints: [{ Timestamp: period1Start, Sum: 3 }] }); // WriteThrottle
      const client = withMockedSend(send);

      const result = await getDynamoDBCapacityUsage(client, 'org-3', 'busy-table', 2, 86400);

      expect(result.status).toBe('fetched');
      if (result.status === 'fetched') {
        const [first, second] = result.usage.datapoints;
        expect(first.consumedReadCapacityUnits).toBe(120);
        expect(first.consumedWriteCapacityUnits).toBeNull();
        expect(first.writeThrottleEvents).toBe(3);
        expect(second.consumedWriteCapacityUnits).toBe(45);
        expect(second.consumedReadCapacityUnits).toBeNull();
      }
    } finally {
      jest.useRealTimers();
    }
  });

  it('returns one datapoint per period across a multi-period window (7 days, daily periods = 7 datapoints)', async () => {
    const send = jest.fn().mockImplementation(() => Promise.resolve({ Datapoints: [] }));
    const client = withMockedSend(send);

    const result = await getDynamoDBCapacityUsage(client, 'org-4', 'weekly-table', 7, 86400);

    expect(result.status).toBe('fetched');
    if (result.status === 'fetched') {
      expect(result.usage.datapoints).toHaveLength(7);
    }
  });

  it('rejects a window/period combination that would exceed CloudWatch\'s 1440-datapoint-per-call limit -- never silently truncates', async () => {
    const send = jest.fn();
    const client = withMockedSend(send);

    // 30 days at 1-second granularity = 2,592,000 datapoints, far past the limit.
    const result = await getDynamoDBCapacityUsage(client, 'org-5', 'table', 30, 1);

    expect(result.status).toBe('unavailable');
    expect(send).not.toHaveBeenCalled(); // never even attempts the call
  });

  it('a CloudWatch API failure returns unavailable, never a fabricated/zero-filled series', async () => {
    const send = jest.fn().mockRejectedValueOnce(new Error('Throttling: rate exceeded'));
    const client = withMockedSend(send);

    const result = await getDynamoDBCapacityUsage(client, 'org-6', 'unavailable-table', 1, 3600);

    expect(result).toEqual({ status: 'unavailable', reason: 'Throttling: rate exceeded' });
  });

  it('caches a successful fetch for the same (org, table, window, period) so a second call does not re-hit CloudWatch', async () => {
    const send = jest.fn().mockImplementation(() => Promise.resolve({ Datapoints: [] }));
    const client = withMockedSend(send);

    await getDynamoDBCapacityUsage(client, 'org-7', 'cached-table', 1, 3600);
    await getDynamoDBCapacityUsage(client, 'org-7', 'cached-table', 1, 3600);

    expect(send).toHaveBeenCalledTimes(4); // only the first call's 4 metric fetches
  });

  it('never caches a failure -- a retry after a CloudWatch error gets its own real attempt', async () => {
    const send = jest
      .fn()
      .mockRejectedValueOnce(new Error('ServiceUnavailable'))
      .mockImplementation(() => Promise.resolve({ Datapoints: [] }));
    const client = withMockedSend(send);

    const first = await getDynamoDBCapacityUsage(client, 'org-8', 'retry-table', 1, 3600);
    const second = await getDynamoDBCapacityUsage(client, 'org-8', 'retry-table', 1, 3600);

    expect(first.status).toBe('unavailable');
    expect(second.status).toBe('fetched');
  });

  it('never reads another organization\'s cached usage for the same table name', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-15T00:00:00.000Z'));
    try {
      const windowStart = new Date('2026-01-14T00:00:00.000Z'); // now - 1 day

      const send = jest
        .fn()
        .mockResolvedValueOnce({ Datapoints: [{ Timestamp: windowStart, Sum: 999 }] })
        .mockResolvedValueOnce({ Datapoints: [] })
        .mockResolvedValueOnce({ Datapoints: [] })
        .mockResolvedValueOnce({ Datapoints: [] })
        .mockResolvedValueOnce({ Datapoints: [{ Timestamp: windowStart, Sum: 1 }] })
        .mockResolvedValueOnce({ Datapoints: [] })
        .mockResolvedValueOnce({ Datapoints: [] })
        .mockResolvedValueOnce({ Datapoints: [] });
      const client = withMockedSend(send);

      const orgA = await getDynamoDBCapacityUsage(client, 'org-A-isolation', 'shared-table-name', 1, 86400);
      const orgB = await getDynamoDBCapacityUsage(client, 'org-B-isolation', 'shared-table-name', 1, 86400);

      expect(orgA.status).toBe('fetched');
      expect(orgB.status).toBe('fetched');
      if (orgA.status === 'fetched' && orgB.status === 'fetched') {
        expect(orgA.usage.datapoints[0].consumedReadCapacityUnits).toBe(999);
        expect(orgB.usage.datapoints[0].consumedReadCapacityUnits).toBe(1);
      }
      expect(send).toHaveBeenCalledTimes(8); // org-B's identical table name did not serve org-A's cache
    } finally {
      jest.useRealTimers();
    }
  });
});
