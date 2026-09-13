/**
 * CloudWatch Scalability Phase 2C: coverage for fetchMetricDataBatch()/reduceSeriesToScalar(),
 * the shared GetMetricData batching mechanics used by cloudwatch.service.ts's EC2/ALB/
 * Lambda/DynamoDB capabilities. Pure mechanics only -- no health/business semantics, no
 * database, no CloudWatchService -- matching the module's own stated scope. Query
 * construction, dimension/statistic/period correctness, and health-rule equivalence are
 * covered at the CloudWatchService level in cloudwatch.service.batching.test.ts instead,
 * since those require the actual capability definitions this module knows nothing about.
 */
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { fetchMetricDataBatch, reduceSeriesToScalar, BatchMetricQuery } from '../cloudwatch-metric-batch.util';

function withMockedSend(send: jest.Mock): CloudWatchClient {
  const client = new CloudWatchClient({ region: 'us-east-1' });
  (client as any).send = send;
  return client;
}

function query(id: string, overrides: Partial<BatchMetricQuery> = {}): BatchMetricQuery {
  return {
    id,
    namespace: 'AWS/EC2',
    metricName: 'CPUUtilization',
    dimensions: [{ Name: 'InstanceId', Value: 'i-test' }],
    period: 300,
    stat: 'Average',
    ...overrides,
  };
}

describe('fetchMetricDataBatch', () => {
  const startTime = new Date('2026-01-01T00:00:00Z');
  const endTime = new Date('2026-01-01T01:00:00Z');

  it('(1) sends no request and returns an empty map for zero queries', async () => {
    const send = jest.fn();
    const client = withMockedSend(send);

    const results = await fetchMetricDataBatch(client, [], startTime, endTime);

    expect(send).not.toHaveBeenCalled();
    expect(results.size).toBe(0);
  });

  it('(2) query construction: Namespace/MetricName/Dimensions/Period/Stat/Id map correctly, and ReturnData is set', async () => {
    const send = jest.fn().mockResolvedValue({ MetricDataResults: [] });
    const client = withMockedSend(send);
    const q = query('ec2_0_0', { namespace: 'AWS/Lambda', metricName: 'Invocations', stat: 'Sum', period: 60, dimensions: [{ Name: 'FunctionName', Value: 'my-fn' }] });

    await fetchMetricDataBatch(client, [q], startTime, endTime);

    const sentCommand = send.mock.calls[0][0];
    expect(sentCommand.input.StartTime).toBe(startTime);
    expect(sentCommand.input.EndTime).toBe(endTime);
    expect(sentCommand.input.MetricDataQueries).toEqual([
      {
        Id: 'ec2_0_0',
        MetricStat: {
          Metric: { Namespace: 'AWS/Lambda', MetricName: 'Invocations', Dimensions: [{ Name: 'FunctionName', Value: 'my-fn' }] },
          Period: 60,
          Stat: 'Sum',
        },
        ReturnData: true,
      },
    ]);
  });

  it('(3) maps results by Id, not by array position, even when the response order is shuffled', async () => {
    const send = jest.fn().mockResolvedValue({
      MetricDataResults: [
        { Id: 'q2', StatusCode: 'Complete', Timestamps: [startTime], Values: [222] },
        { Id: 'q0', StatusCode: 'Complete', Timestamps: [startTime], Values: [0] },
        { Id: 'q1', StatusCode: 'Complete', Timestamps: [startTime], Values: [111] },
      ],
    });
    const client = withMockedSend(send);

    const results = await fetchMetricDataBatch(client, [query('q0'), query('q1'), query('q2')], startTime, endTime);

    expect(results.get('q0')?.values).toEqual([0]);
    expect(results.get('q1')?.values).toEqual([111]);
    expect(results.get('q2')?.values).toEqual([222]);
  });

  it('(4) a query id missing entirely from the response maps to null, not undefined or a thrown error', async () => {
    const send = jest.fn().mockResolvedValue({ MetricDataResults: [{ Id: 'q0', StatusCode: 'Complete', Timestamps: [startTime], Values: [5] }] });
    const client = withMockedSend(send);

    const results = await fetchMetricDataBatch(client, [query('q0'), query('q1')], startTime, endTime);

    expect(results.get('q0')?.values).toEqual([5]);
    expect(results.get('q1')).toBeNull();
  });

  it('(5) an empty Values array maps to null, never fabricated as zero datapoints', async () => {
    const send = jest.fn().mockResolvedValue({ MetricDataResults: [{ Id: 'q0', StatusCode: 'Complete', Timestamps: [], Values: [] }] });
    const client = withMockedSend(send);

    const results = await fetchMetricDataBatch(client, [query('q0')], startTime, endTime);

    expect(results.get('q0')).toBeNull();
  });

  it.each(['Complete', 'PartialData'])('(6) StatusCode %s with non-empty Values is used as-is, not treated as failure', async (statusCode) => {
    const send = jest.fn().mockResolvedValue({ MetricDataResults: [{ Id: 'q0', StatusCode: statusCode, Timestamps: [startTime], Values: [9] }] });
    const client = withMockedSend(send);

    const results = await fetchMetricDataBatch(client, [query('q0')], startTime, endTime);

    expect(results.get('q0')?.values).toEqual([9]);
  });

  it.each(['InternalError', 'Forbidden'])('(7) StatusCode %s maps to null even though Values may be present', async (statusCode) => {
    const send = jest.fn().mockResolvedValue({ MetricDataResults: [{ Id: 'q0', StatusCode: statusCode, Timestamps: [startTime], Values: [9] }] });
    const client = withMockedSend(send);

    const results = await fetchMetricDataBatch(client, [query('q0')], startTime, endTime);

    expect(results.get('q0')).toBeNull();
  });

  it('(8) whole-request failure maps every query id in that request to null, without throwing', async () => {
    const send = jest.fn().mockRejectedValue(new Error('ThrottlingException'));
    const client = withMockedSend(send);

    const results = await fetchMetricDataBatch(client, [query('q0'), query('q1')], startTime, endTime);

    expect(results.get('q0')).toBeNull();
    expect(results.get('q1')).toBeNull();
  });

  it('(9) NextToken pagination: a second page is requested and merged with the first', async () => {
    const send = jest.fn()
      .mockResolvedValueOnce({
        MetricDataResults: [{ Id: 'q0', StatusCode: 'PartialData', Timestamps: [startTime], Values: [1] }],
        NextToken: 'page-2',
      })
      .mockResolvedValueOnce({
        MetricDataResults: [{ Id: 'q0', StatusCode: 'Complete', Timestamps: [startTime, endTime], Values: [1, 2] }],
      });
    const client = withMockedSend(send);

    const results = await fetchMetricDataBatch(client, [query('q0')], startTime, endTime);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0].input.NextToken).toBe('page-2');
    // The second page's result for the same Id replaces the first -- last-page-wins is
    // this module's documented contract (callers needing an accumulated series across
    // pages are not exercised by today's workload; see the Phase 2C scoping audit's
    // pagination analysis for why this is not expected to matter at current caps).
    expect(results.get('q0')?.values).toEqual([1, 2]);
  });

  it('(10) more than 500 queries are split into multiple chunked requests', async () => {
    const send = jest.fn().mockImplementation(async (command: any) => ({
      MetricDataResults: command.input.MetricDataQueries.map((q: any) => ({ Id: q.Id, StatusCode: 'Complete', Timestamps: [startTime], Values: [1] })),
    }));
    const client = withMockedSend(send);
    const queries = Array.from({ length: 620 }, (_, i) => query(`q${i}`));

    const results = await fetchMetricDataBatch(client, queries, startTime, endTime);

    expect(send).toHaveBeenCalledTimes(2); // 500 + 120
    expect(send.mock.calls[0][0].input.MetricDataQueries).toHaveLength(500);
    expect(send.mock.calls[1][0].input.MetricDataQueries).toHaveLength(120);
    expect(results.get('q0')?.values).toEqual([1]);
    expect(results.get('q619')?.values).toEqual([1]);
  });

  it('(11) chunk-level failure isolation: one chunk failing does not affect another chunk\'s results', async () => {
    const send = jest.fn()
      .mockImplementationOnce(async () => {
        throw new Error('Chunk 1 network failure');
      })
      .mockImplementationOnce(async (command: any) => ({
        MetricDataResults: command.input.MetricDataQueries.map((q: any) => ({ Id: q.Id, StatusCode: 'Complete', Timestamps: [startTime], Values: [1] })),
      }));
    const client = withMockedSend(send);
    const queries = Array.from({ length: 501 }, (_, i) => query(`q${i}`)); // 500 in chunk 1, 1 in chunk 2

    const results = await fetchMetricDataBatch(client, queries, startTime, endTime);

    expect(results.get('q0')).toBeNull(); // chunk 1 failed entirely
    expect(results.get('q499')).toBeNull();
    expect(results.get('q500')?.values).toEqual([1]); // chunk 2 succeeded independently
  });
});

describe('reduceSeriesToScalar', () => {
  it('(12) returns null for a null series', () => {
    expect(reduceSeriesToScalar(null, 'Average')).toBeNull();
  });

  it('(13) returns null for a series with zero values', () => {
    expect(reduceSeriesToScalar({ timestamps: [], values: [] }, 'Sum')).toBeNull();
  });

  it('(14) Sum statistic totals every value', () => {
    expect(reduceSeriesToScalar({ timestamps: [new Date(), new Date(), new Date()], values: [10, 20, 30] }, 'Sum')).toBe(60);
  });

  it('(15) Average statistic means every value, matching the pre-2C GetMetricStatistics reduction exactly', () => {
    expect(reduceSeriesToScalar({ timestamps: [new Date(), new Date()], values: [40, 60] }, 'Average')).toBe(50);
  });
});
