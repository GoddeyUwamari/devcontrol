/**
 * Phase 3E, dynamodb_capacity: fetchDynamoDBCapacityMetrics() -- the batched
 * GetMetricData fetch/alignment layer. Locked methodology: one call
 * requesting all six metrics, Sum->average-per-second conversion for
 * consumed metrics, deterministic NextToken pagination, never a fabricated
 * datapoint on failure.
 */
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { fetchDynamoDBCapacityMetrics } from '../dynamodb-capacity-analysis.util';

function withMockedSend(send: jest.Mock): CloudWatchClient {
  const client = new CloudWatchClient({ region: 'us-east-1' });
  (client as any).send = send;
  return client;
}

describe('fetchDynamoDBCapacityMetrics', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-07T00:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('requests all six metrics in a single batched call with the locked 30-day/1-hour methodology', async () => {
    const send = jest.fn().mockResolvedValueOnce({ MetricDataResults: [] });
    const client = withMockedSend(send);

    await fetchDynamoDBCapacityMetrics(client, 'my-table');

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0][0];
    const input = command.input;

    expect(input.MetricDataQueries).toHaveLength(6);
    const ids = input.MetricDataQueries.map((q: any) => q.Id).sort();
    expect(ids).toEqual(
      ['consumedRead', 'consumedWrite', 'provisionedRead', 'provisionedWrite', 'readThrottle', 'writeThrottle'].sort()
    );

    for (const q of input.MetricDataQueries) {
      expect(q.MetricStat.Metric.Namespace).toBe('AWS/DynamoDB');
      expect(q.MetricStat.Metric.Dimensions).toEqual([{ Name: 'TableName', Value: 'my-table' }]);
      expect(q.MetricStat.Period).toBe(3600);
    }

    const byId = Object.fromEntries(input.MetricDataQueries.map((q: any) => [q.Id, q]));
    expect(byId.consumedRead.MetricStat.Stat).toBe('Sum');
    expect(byId.consumedWrite.MetricStat.Stat).toBe('Sum');
    expect(byId.readThrottle.MetricStat.Stat).toBe('Sum');
    expect(byId.writeThrottle.MetricStat.Stat).toBe('Sum');
    expect(byId.provisionedRead.MetricStat.Stat).toBe('Average');
    expect(byId.provisionedWrite.MetricStat.Stat).toBe('Average');

    const expectedEnd = new Date('2026-09-07T00:00:00.000Z');
    const expectedStart = new Date(expectedEnd.getTime() - 30 * 24 * 60 * 60 * 1000);
    expect(input.StartTime).toEqual(expectedStart);
    expect(input.EndTime).toEqual(expectedEnd);
  });

  it('converts a Sum datapoint to average-per-second by dividing by the period', async () => {
    const ts = new Date('2026-08-08T00:00:00.000Z');
    const send = jest.fn().mockResolvedValueOnce({
      MetricDataResults: [
        { Id: 'consumedRead', Timestamps: [ts], Values: [3600] }, // 1 unit/sec average
        { Id: 'consumedWrite', Timestamps: [ts], Values: [7200] }, // 2 units/sec average
        { Id: 'provisionedRead', Timestamps: [ts], Values: [500] },
        { Id: 'provisionedWrite', Timestamps: [ts], Values: [200] },
        { Id: 'readThrottle', Timestamps: [ts], Values: [0] },
        { Id: 'writeThrottle', Timestamps: [ts], Values: [0] },
      ],
    });
    const client = withMockedSend(send);

    const result = await fetchDynamoDBCapacityMetrics(client, 'my-table');

    expect(result.status).toBe('fetched');
    if (result.status === 'fetched') {
      const idx = result.series.intervalStartTimes.indexOf(ts.toISOString());
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(result.series.consumedReadPerSecond[idx]).toBe(1);
      expect(result.series.consumedWritePerSecond[idx]).toBe(2);
      expect(result.series.provisionedRead[idx]).toBe(500);
      expect(result.series.provisionedWrite[idx]).toBe(200);
    }
  });

  it('leaves an interval null (never 0) when CloudWatch returns no datapoint for it', async () => {
    const send = jest.fn().mockResolvedValueOnce({ MetricDataResults: [] });
    const client = withMockedSend(send);

    const result = await fetchDynamoDBCapacityMetrics(client, 'my-table');

    expect(result.status).toBe('fetched');
    if (result.status === 'fetched') {
      expect(result.series.consumedReadPerSecond.every((v) => v === null)).toBe(true);
      expect(result.series.provisionedRead.every((v) => v === null)).toBe(true);
      expect(result.series.readThrottleEvents.every((v) => v === null)).toBe(true);
      expect(result.series.intervalStartTimes.length).toBe(720); // 30 days * 24 hours
    }
  });

  it('follows NextToken pagination deterministically, merging results across pages without duplication or loss', async () => {
    const ts1 = new Date('2026-08-08T00:00:00.000Z');
    const ts2 = new Date('2026-08-08T01:00:00.000Z');
    const send = jest
      .fn()
      .mockResolvedValueOnce({
        MetricDataResults: [{ Id: 'consumedRead', Timestamps: [ts1], Values: [3600] }],
        NextToken: 'page-2',
      })
      .mockResolvedValueOnce({
        MetricDataResults: [{ Id: 'consumedRead', Timestamps: [ts2], Values: [7200] }],
      });
    const client = withMockedSend(send);

    const result = await fetchDynamoDBCapacityMetrics(client, 'my-table');

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0].input.NextToken).toBe('page-2');
    expect(result.status).toBe('fetched');
    if (result.status === 'fetched') {
      const idx1 = result.series.intervalStartTimes.indexOf(ts1.toISOString());
      const idx2 = result.series.intervalStartTimes.indexOf(ts2.toISOString());
      expect(result.series.consumedReadPerSecond[idx1]).toBe(1);
      expect(result.series.consumedReadPerSecond[idx2]).toBe(2);
    }
  });

  it('returns unavailable, never a fabricated series, when the CloudWatch call throws', async () => {
    const send = jest.fn().mockRejectedValueOnce(new Error('Throttled'));
    const client = withMockedSend(send);

    const result = await fetchDynamoDBCapacityMetrics(client, 'my-table');

    expect(result).toEqual({ status: 'unavailable', reason: 'Throttled' });
  });
});
