/**
 * Phase 2, rule 4: lambda_low_usage. Coverage for
 * CostOptimizationService.detectLowUsageLambdaFunctions() -- the critical
 * properties under test are: a genuine zero-invocations datapoint gap is a
 * confirmed finding (not "missing data"), a thrown CloudWatch error is never
 * assumed to be zero, and savings come from real usage, not the removed
 * fake 100K/month assumption.
 */
import { LambdaClient } from '@aws-sdk/client-lambda';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import costOptimizationService from '../cost-optimization.service';
import { ISSUE_LAMBDA_LOW_USAGE } from '../../config/optimization-rules';

function withMockedSend<T extends { send: (...args: any[]) => any }>(client: T, send: jest.Mock): T {
  (client as any).send = send;
  return client;
}

describe('CostOptimizationService.detectLowUsageLambdaFunctions (lambda_low_usage)', () => {
  it('flags a genuinely zero-usage function -- an empty Datapoints array is a confirmed zero for Lambda, not missing data', async () => {
    const lambdaSend = jest.fn().mockResolvedValueOnce({
      Functions: [{ FunctionName: 'never-called', MemorySize: 128 }],
    });
    const lambdaClient = withMockedSend(new LambdaClient({ region: 'us-east-1' }), lambdaSend);

    const cwSend = jest.fn().mockResolvedValueOnce({ Datapoints: [] }); // Invocations: none
    const cwClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), cwSend);

    const result = await (costOptimizationService as any).detectLowUsageLambdaFunctions('test-org', lambdaClient, cwClient);

    expect(result.success).toBe(true);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].resourceId).toBe('never-called');
    expect(result.issues[0].issue).toBe(ISSUE_LAMBDA_LOW_USAGE);
    expect(result.issues[0].metadata.usage_state).toBe('zero_usage');
    expect(result.issues[0].metadata.invocations_30d).toBe(0);
    expect(result.issues[0].potentialSavings).toBe(0); // real zero usage -> real zero compute cost
    // Duration is never queried for a zero-invocation function
    expect(cwSend).toHaveBeenCalledTimes(1);
  });

  it('flags a genuinely low-usage function using its REAL invocation count and duration for savings, not a fake assumption', async () => {
    const lambdaSend = jest.fn().mockResolvedValueOnce({
      Functions: [{ FunctionName: 'rarely-called', MemorySize: 512 }],
    });
    const lambdaClient = withMockedSend(new LambdaClient({ region: 'us-east-1' }), lambdaSend);

    const cwSend = jest
      .fn()
      .mockResolvedValueOnce({ Datapoints: [{ Sum: 3 }] }) // Invocations: 3 over 30 days
      .mockResolvedValueOnce({ Datapoints: [{ Average: 250 }] }); // Duration: 250ms avg
    const cwClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), cwSend);

    const result = await (costOptimizationService as any).detectLowUsageLambdaFunctions('test-org', lambdaClient, cwClient);

    expect(result.issues).toHaveLength(1);
    const [issue] = result.issues;
    expect(issue.metadata.usage_state).toBe('low_usage');
    expect(issue.metadata.invocations_30d).toBe(3);
    expect(issue.metadata.avg_duration_ms).toBe(250);
    // requestCost = 3/1e6 * 0.20 = 0.0000006; computeCost = 3 * 0.25s * 0.5GB * 0.0000166667 ≈ 0.00000625
    const expected = (3 / 1_000_000) * 0.2 + 3 * 0.25 * 0.5 * 0.0000166667;
    expect(issue.potentialSavings).toBeCloseTo(expected, 8);
  });

  it('does NOT flag a function with normal usage (above the low-usage threshold)', async () => {
    const lambdaSend = jest.fn().mockResolvedValueOnce({
      Functions: [{ FunctionName: 'busy-function', MemorySize: 256 }],
    });
    const lambdaClient = withMockedSend(new LambdaClient({ region: 'us-east-1' }), lambdaSend);

    const cwSend = jest.fn().mockResolvedValueOnce({ Datapoints: [{ Sum: 50000 }] });
    const cwClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), cwSend);

    const result = await (costOptimizationService as any).detectLowUsageLambdaFunctions('test-org', lambdaClient, cwClient);

    expect(result.issues).toHaveLength(0);
  });

  it('skips a function whose CloudWatch call fails -- never assumes zero usage', async () => {
    const lambdaSend = jest.fn().mockResolvedValueOnce({
      Functions: [{ FunctionName: 'metrics-unavailable', MemorySize: 128 }],
    });
    const lambdaClient = withMockedSend(new LambdaClient({ region: 'us-east-1' }), lambdaSend);

    const cwSend = jest.fn().mockRejectedValueOnce(new Error('Throttling: rate exceeded'));
    const cwClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), cwSend);

    const result = await (costOptimizationService as any).detectLowUsageLambdaFunctions('test-org', lambdaClient, cwClient);

    expect(result.success).toBe(true); // one function's failure doesn't fail the whole detector
    expect(result.issues).toHaveLength(0);
  });

  it('evaluates multiple functions independently, in the same organization scan', async () => {
    const lambdaSend = jest.fn().mockResolvedValueOnce({
      Functions: [
        { FunctionName: 'fn-zero', MemorySize: 128 },
        { FunctionName: 'fn-busy', MemorySize: 128 },
        { FunctionName: 'fn-low', MemorySize: 128 },
      ],
    });
    const lambdaClient = withMockedSend(new LambdaClient({ region: 'us-east-1' }), lambdaSend);

    const cwSend = jest
      .fn()
      .mockResolvedValueOnce({ Datapoints: [] }) // fn-zero: Invocations
      .mockResolvedValueOnce({ Datapoints: [{ Sum: 100000 }] }) // fn-busy: Invocations (normal usage)
      .mockResolvedValueOnce({ Datapoints: [{ Sum: 2 }] }) // fn-low: Invocations
      .mockResolvedValueOnce({ Datapoints: [{ Average: 100 }] }); // fn-low: Duration
    const cwClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), cwSend);

    const result = await (costOptimizationService as any).detectLowUsageLambdaFunctions('test-org', lambdaClient, cwClient);

    const flaggedIds = result.issues.map((i: any) => i.resourceId).sort();
    expect(flaggedIds).toEqual(['fn-low', 'fn-zero']);
  });

  it('an AWS ListFunctions failure returns success: false, never a false "nothing found"', async () => {
    const lambdaSend = jest.fn().mockRejectedValueOnce(new Error('ServiceUnavailable'));
    const lambdaClient = withMockedSend(new LambdaClient({ region: 'us-east-1' }), lambdaSend);
    const cwClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), jest.fn());

    const result = await (costOptimizationService as any).detectLowUsageLambdaFunctions('test-org', lambdaClient, cwClient);

    expect(result).toEqual({ success: false, issues: [] });
  });

  it('defaults memory to 128MB when MemorySize is absent from the function config', async () => {
    const lambdaSend = jest.fn().mockResolvedValueOnce({
      Functions: [{ FunctionName: 'no-memory-field' }],
    });
    const lambdaClient = withMockedSend(new LambdaClient({ region: 'us-east-1' }), lambdaSend);

    const cwSend = jest.fn().mockResolvedValueOnce({ Datapoints: [] });
    const cwClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), cwSend);

    const result = await (costOptimizationService as any).detectLowUsageLambdaFunctions('test-org', lambdaClient, cwClient);

    expect(result.issues[0].metadata.memory_mb).toBe(128);
  });
});
