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
import { EffectiveOptimizationRuleConfig } from '../optimization-rule-config.service';

function withMockedSend<T extends { send: (...args: any[]) => any }>(client: T, send: jest.Mock): T {
  (client as any).send = send;
  return client;
}

// Enterprise Workstream 3B, Phase D: detectLowUsageLambdaFunctions() now
// requires an already-resolved EffectiveOptimizationRuleConfig instead of
// reading a hardcoded module-level constant. This fixture matches today's
// pre-3B default (10) exactly, so every pre-existing assertion below keeps
// proving the same behavior it always did.
const DEFAULT_LAMBDA_CONFIG: EffectiveOptimizationRuleConfig = {
  ruleId: 'lambda_low_usage',
  parameterId: 'max_invocations',
  value: 10,
  source: 'default',
};

describe('CostOptimizationService.detectLowUsageLambdaFunctions (lambda_low_usage)', () => {
  it('flags a genuinely zero-usage function -- an empty Datapoints array is a confirmed zero for Lambda, not missing data', async () => {
    const lambdaSend = jest.fn().mockResolvedValueOnce({
      Functions: [{ FunctionName: 'never-called', MemorySize: 128 }],
    });
    const lambdaClient = withMockedSend(new LambdaClient({ region: 'us-east-1' }), lambdaSend);

    const cwSend = jest.fn().mockResolvedValueOnce({ Datapoints: [] }); // Invocations: none
    const cwClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), cwSend);

    const result = await (costOptimizationService as any).detectLowUsageLambdaFunctions('test-org', lambdaClient, cwClient, DEFAULT_LAMBDA_CONFIG);

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

    const result = await (costOptimizationService as any).detectLowUsageLambdaFunctions('test-org', lambdaClient, cwClient, DEFAULT_LAMBDA_CONFIG);

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

    const result = await (costOptimizationService as any).detectLowUsageLambdaFunctions('test-org', lambdaClient, cwClient, DEFAULT_LAMBDA_CONFIG);

    expect(result.issues).toHaveLength(0);
  });

  it('skips a function whose CloudWatch call fails -- never assumes zero usage', async () => {
    const lambdaSend = jest.fn().mockResolvedValueOnce({
      Functions: [{ FunctionName: 'metrics-unavailable', MemorySize: 128 }],
    });
    const lambdaClient = withMockedSend(new LambdaClient({ region: 'us-east-1' }), lambdaSend);

    const cwSend = jest.fn().mockRejectedValueOnce(new Error('Throttling: rate exceeded'));
    const cwClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), cwSend);

    const result = await (costOptimizationService as any).detectLowUsageLambdaFunctions('test-org', lambdaClient, cwClient, DEFAULT_LAMBDA_CONFIG);

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

    const result = await (costOptimizationService as any).detectLowUsageLambdaFunctions('test-org', lambdaClient, cwClient, DEFAULT_LAMBDA_CONFIG);

    const flaggedIds = result.issues.map((i: any) => i.resourceId).sort();
    expect(flaggedIds).toEqual(['fn-low', 'fn-zero']);
  });

  it('an AWS ListFunctions failure returns success: false, never a false "nothing found"', async () => {
    const lambdaSend = jest.fn().mockRejectedValueOnce(new Error('ServiceUnavailable'));
    const lambdaClient = withMockedSend(new LambdaClient({ region: 'us-east-1' }), lambdaSend);
    const cwClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), jest.fn());

    const result = await (costOptimizationService as any).detectLowUsageLambdaFunctions('test-org', lambdaClient, cwClient, DEFAULT_LAMBDA_CONFIG);

    expect(result).toEqual({ success: false, issues: [] });
  });

  it('defaults memory to 128MB when MemorySize is absent from the function config', async () => {
    const lambdaSend = jest.fn().mockResolvedValueOnce({
      Functions: [{ FunctionName: 'no-memory-field' }],
    });
    const lambdaClient = withMockedSend(new LambdaClient({ region: 'us-east-1' }), lambdaSend);

    const cwSend = jest.fn().mockResolvedValueOnce({ Datapoints: [] });
    const cwClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), cwSend);

    const result = await (costOptimizationService as any).detectLowUsageLambdaFunctions('test-org', lambdaClient, cwClient, DEFAULT_LAMBDA_CONFIG);

    expect(result.issues[0].metadata.memory_mb).toBe(128);
  });
});

describe('CostOptimizationService.detectLowUsageLambdaFunctions — Enterprise Workstream 3B threshold configuration', () => {
  const OVERRIDE_CONFIG: EffectiveOptimizationRuleConfig = {
    ruleId: 'lambda_low_usage',
    parameterId: 'max_invocations',
    value: 100,
    source: 'organization_override',
  };

  const ZERO_OVERRIDE_CONFIG: EffectiveOptimizationRuleConfig = {
    ruleId: 'lambda_low_usage',
    parameterId: 'max_invocations',
    value: 0,
    source: 'organization_override',
  };

  it('(1) an organization override of 100 qualifies a function invoked exactly 100 times', async () => {
    const lambdaClient = withMockedSend(new LambdaClient({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce({ Functions: [{ FunctionName: 'fn-100', MemorySize: 128 }] }));
    const cwClient = withMockedSend(
      new CloudWatchClient({ region: 'us-east-1' }),
      jest.fn().mockResolvedValueOnce({ Datapoints: [{ Sum: 100 }] }).mockResolvedValueOnce({ Datapoints: [{ Average: 50 }] })
    );

    const result = await (costOptimizationService as any).detectLowUsageLambdaFunctions('test-org', lambdaClient, cwClient, OVERRIDE_CONFIG);

    expect(result.issues).toHaveLength(1);
  });

  it('(2) an organization override of 100 does NOT qualify a function invoked 101 times', async () => {
    const lambdaClient = withMockedSend(new LambdaClient({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce({ Functions: [{ FunctionName: 'fn-101', MemorySize: 128 }] }));
    const cwClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce({ Datapoints: [{ Sum: 101 }] }));

    const result = await (costOptimizationService as any).detectLowUsageLambdaFunctions('test-org', lambdaClient, cwClient, OVERRIDE_CONFIG);

    expect(result.issues).toHaveLength(0);
  });

  it('(3) an organization override of 0 still qualifies a genuinely zero-usage function', async () => {
    const lambdaClient = withMockedSend(new LambdaClient({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce({ Functions: [{ FunctionName: 'fn-zero-strict', MemorySize: 128 }] }));
    const cwClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce({ Datapoints: [] }));

    const result = await (costOptimizationService as any).detectLowUsageLambdaFunctions('test-org', lambdaClient, cwClient, ZERO_OVERRIDE_CONFIG);

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].metadata.usage_state).toBe('zero_usage');
  });

  it('(4) an organization override of 0 does NOT qualify a function invoked even once', async () => {
    const lambdaClient = withMockedSend(new LambdaClient({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce({ Functions: [{ FunctionName: 'fn-once', MemorySize: 128 }] }));
    const cwClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce({ Datapoints: [{ Sum: 1 }] }));

    const result = await (costOptimizationService as any).detectLowUsageLambdaFunctions('test-org', lambdaClient, cwClient, ZERO_OVERRIDE_CONFIG);

    expect(result.issues).toHaveLength(0);
  });

  it('(5) usage === null (CloudWatch call failure) is still skipped regardless of configuration -- unaffected by 3B', async () => {
    const lambdaClient = withMockedSend(new LambdaClient({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce({ Functions: [{ FunctionName: 'fn-cw-down', MemorySize: 128 }] }));
    const cwClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), jest.fn().mockRejectedValueOnce(new Error('Throttling')));

    const result = await (costOptimizationService as any).detectLowUsageLambdaFunctions('test-org', lambdaClient, cwClient, OVERRIDE_CONFIG);

    expect(result.success).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('(6) zero_usage vs. low_usage metadata distinction is preserved alongside the new configuration provenance', async () => {
    // Unique function name, distinct from the pre-existing 'fn-low' used
    // earlier in this file for the same organizationId -- getLambdaUsageOverWindow()
    // caches per (organizationId, functionName, windowDays) for 15 minutes
    // (see lambda-usage.util.ts), so reusing 'fn-low' here would silently
    // return that earlier test's cached usage instead of exercising this
    // test's own mocked CloudWatch responses.
    const lambdaClient = withMockedSend(new LambdaClient({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce({ Functions: [{ FunctionName: 'fn-low-metadata-check', MemorySize: 128 }] }));
    const cwClient = withMockedSend(
      new CloudWatchClient({ region: 'us-east-1' }),
      jest.fn().mockResolvedValueOnce({ Datapoints: [{ Sum: 4 }] }).mockResolvedValueOnce({ Datapoints: [{ Average: 80 }] })
    );

    const result = await (costOptimizationService as any).detectLowUsageLambdaFunctions('test-org', lambdaClient, cwClient, DEFAULT_LAMBDA_CONFIG);

    expect(result.issues[0].metadata.usage_state).toBe('low_usage');
    expect(result.issues[0].metadata.configuration).toEqual({
      parameter: 'max_invocations',
      value: 10,
      source: 'default',
    });
  });

  it('(7) qualifying metadata records "organization_override" as the source when an override is in effect', async () => {
    const lambdaClient = withMockedSend(new LambdaClient({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce({ Functions: [{ FunctionName: 'fn-override', MemorySize: 128 }] }));
    const cwClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce({ Datapoints: [{ Sum: 50 }] }).mockResolvedValueOnce({ Datapoints: [{ Average: 30 }] }));

    const result = await (costOptimizationService as any).detectLowUsageLambdaFunctions('test-org', lambdaClient, cwClient, OVERRIDE_CONFIG);

    expect(result.issues[0].metadata.configuration).toEqual({
      parameter: 'max_invocations',
      value: 100,
      source: 'organization_override',
    });
  });

  it('(8) the issue identity is never encoded with the threshold -- always the same canonical constant regardless of configuration', async () => {
    const lambdaClientDefault = withMockedSend(new LambdaClient({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce({ Functions: [{ FunctionName: 'fn-id-a', MemorySize: 128 }] }));
    const cwClientDefault = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce({ Datapoints: [] }));
    const defaultResult = await (costOptimizationService as any).detectLowUsageLambdaFunctions('test-org', lambdaClientDefault, cwClientDefault, DEFAULT_LAMBDA_CONFIG);

    const lambdaClientOverride = withMockedSend(new LambdaClient({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce({ Functions: [{ FunctionName: 'fn-id-b', MemorySize: 128 }] }));
    const cwClientOverride = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce({ Datapoints: [] }));
    const overrideResult = await (costOptimizationService as any).detectLowUsageLambdaFunctions('test-org', lambdaClientOverride, cwClientOverride, OVERRIDE_CONFIG);

    expect(defaultResult.issues[0].issue).toBe(ISSUE_LAMBDA_LOW_USAGE);
    expect(overrideResult.issues[0].issue).toBe(ISSUE_LAMBDA_LOW_USAGE);
  });
});
