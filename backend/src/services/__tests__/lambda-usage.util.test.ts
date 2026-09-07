/**
 * Phase 3B: coverage for the shared getLambdaUsageOverWindow() -- the single
 * authoritative source of Lambda usage now used by both discovery
 * (awsResourceDiscovery.ts) and the lambda_low_usage optimization detector
 * (cost-optimization.service.ts). Critical properties: an empty Datapoints
 * array for Invocations is a confirmed zero (never "missing data"), a
 * thrown CloudWatch error is never coerced into zero usage, Duration is
 * only queried when invocations > 0, results are cached briefly per
 * (organizationId, functionName, windowDays) to avoid duplicate CloudWatch
 * calls when discovery and the optimization scan run back-to-back, and a
 * failure is never cached (so the very next caller gets its own real
 * attempt rather than inheriting a stale "unavailable").
 */
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { getLambdaUsageOverWindow, LAMBDA_USAGE_WINDOW_DAYS } from '../lambda-usage.util';

function withMockedSend(send: jest.Mock): CloudWatchClient {
  const client = new CloudWatchClient({ region: 'us-east-1' });
  (client as any).send = send;
  return client;
}

describe('getLambdaUsageOverWindow', () => {
  it('exports the documented 30-day window', () => {
    expect(LAMBDA_USAGE_WINDOW_DAYS).toBe(30);
  });

  it('a genuinely empty Datapoints array for Invocations is a confirmed zero, not missing data', async () => {
    const send = jest.fn().mockResolvedValueOnce({ Datapoints: [] });
    const client = withMockedSend(send);

    const usage = await getLambdaUsageOverWindow(client, 'org-usage-1', 'fn-never-called');

    expect(usage).toEqual({ invocations: 0, avgDurationMs: 0 });
    // Duration must never be queried for a zero-invocation function.
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('fetches real invocation count and average duration when usage exists', async () => {
    const send = jest
      .fn()
      .mockResolvedValueOnce({ Datapoints: [{ Sum: 42 }] })
      .mockResolvedValueOnce({ Datapoints: [{ Average: 137 }] });
    const client = withMockedSend(send);

    const usage = await getLambdaUsageOverWindow(client, 'org-usage-2', 'fn-real-usage');

    expect(usage).toEqual({ invocations: 42, avgDurationMs: 137 });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('a CloudWatch API failure returns null -- never coerced into zero usage', async () => {
    const send = jest.fn().mockRejectedValueOnce(new Error('Throttling: rate exceeded'));
    const client = withMockedSend(send);

    const usage = await getLambdaUsageOverWindow(client, 'org-usage-3', 'fn-unavailable');

    expect(usage).toBeNull();
  });

  it('caches a successful result for the same (org, function, window) so a second call within the TTL does not re-hit CloudWatch', async () => {
    // Sum: 0 -- a zero-invocation result never triggers the conditional
    // Duration call, keeping this test focused on caching, not on-call-count.
    const send = jest.fn().mockResolvedValueOnce({ Datapoints: [{ Sum: 0 }] });
    const client = withMockedSend(send);

    const first = await getLambdaUsageOverWindow(client, 'org-usage-4', 'fn-cached');
    const second = await getLambdaUsageOverWindow(client, 'org-usage-4', 'fn-cached');

    expect(first).toEqual({ invocations: 0, avgDurationMs: 0 });
    expect(second).toEqual({ invocations: 0, avgDurationMs: 0 });
    expect(send).toHaveBeenCalledTimes(1); // second call served from cache
  });

  it('never caches a failure -- a retry after a CloudWatch error gets its own real attempt', async () => {
    const send = jest
      .fn()
      .mockRejectedValueOnce(new Error('ServiceUnavailable'))
      .mockResolvedValueOnce({ Datapoints: [{ Sum: 0 }] });
    const client = withMockedSend(send);

    const first = await getLambdaUsageOverWindow(client, 'org-usage-5', 'fn-retry');
    const second = await getLambdaUsageOverWindow(client, 'org-usage-5', 'fn-retry');

    expect(first).toBeNull();
    expect(second).toEqual({ invocations: 0, avgDurationMs: 0 });
    expect(send).toHaveBeenCalledTimes(2); // no cached failure served
  });

  it('never reads another organization\'s cached usage for the same function name', async () => {
    const send = jest
      .fn()
      .mockResolvedValueOnce({ Datapoints: [{ Sum: 999 }] }) // org-A: Invocations
      .mockResolvedValueOnce({ Datapoints: [{ Average: 10 }] }) // org-A: Duration (invocations > 0)
      .mockResolvedValueOnce({ Datapoints: [{ Sum: 1 }] }) // org-B: Invocations -- own, different real usage
      .mockResolvedValueOnce({ Datapoints: [{ Average: 5 }] }); // org-B: Duration
    const client = withMockedSend(send);

    const orgA = await getLambdaUsageOverWindow(client, 'org-A-isolation', 'shared-fn-name');
    const orgB = await getLambdaUsageOverWindow(client, 'org-B-isolation', 'shared-fn-name');

    expect(orgA).toEqual({ invocations: 999, avgDurationMs: 10 });
    expect(orgB).toEqual({ invocations: 1, avgDurationMs: 5 });
    // Four real CloudWatch calls -- org-B's identical function name did not
    // serve org-A's cached value.
    expect(send).toHaveBeenCalledTimes(4);
  });
});
