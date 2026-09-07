/**
 * Phase 3B: AWSResourceDiscoveryService.discoverLambdaFunctions() no longer
 * fabricates a 100K-invocations/month assumption for `estimated_monthly_cost`
 * -- it uses the same shared, real-CloudWatch-usage calculation
 * (lambda-usage.util.ts + aws-pricing.ts's estimateLambdaMonthlyCostFromUsage)
 * as the lambda_low_usage optimization detector. Same synthetic-mock pattern
 * as awsResourceDiscovery.ebs.test.ts.
 */
import { LambdaClient } from '@aws-sdk/client-lambda';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { AWSResourceDiscoveryService } from '../awsResourceDiscovery';
import { estimateLambdaMonthlyCostFromUsage } from '../../config/aws-pricing';

function withMockedSend<T extends { send: (...args: any[]) => any }>(client: T, send: jest.Mock): T {
  (client as any).send = send;
  return client;
}

describe('AWSResourceDiscoveryService.discoverLambdaFunctions', () => {
  const service = new AWSResourceDiscoveryService({} as any);

  it('computes estimated_monthly_cost from real CloudWatch usage, not a fabricated assumption', async () => {
    const lambdaSend = jest
      .fn()
      .mockResolvedValueOnce({ Functions: [{ FunctionArn: 'arn:aws:lambda:us-east-1:1:function:real-usage', FunctionName: 'real-usage', MemorySize: 512 }] })
      .mockResolvedValueOnce({ Tags: { env: 'prod' } });
    const lambdaClient = withMockedSend(new LambdaClient({ region: 'us-east-1' }), lambdaSend);

    const cwSend = jest
      .fn()
      .mockResolvedValueOnce({ Datapoints: [{ Sum: 250 }] }) // Invocations over 30d
      .mockResolvedValueOnce({ Datapoints: [{ Average: 300 }] }); // Duration avg
    const cwClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), cwSend);

    const resources = await (service as any).discoverLambdaFunctions('org-lambda-1', lambdaClient, cwClient, 'us-east-1');

    expect(resources).toHaveLength(1);
    const [resource] = resources;
    expect(resource.resource_type).toBe('lambda');
    expect(resource.resource_id).toBe('real-usage');
    const expectedCost = estimateLambdaMonthlyCostFromUsage(250, 300, 512);
    expect(resource.estimated_monthly_cost).toBeCloseTo(expectedCost, 8);
    expect(resource.metadata.invocations_30d).toBe(250);
    expect(resource.metadata.avg_duration_ms).toBe(300);
    expect(resource.metadata.usage_state).toBe('normal_usage');
  });

  it('never derives cost from a fixed 100,000-invocation assumption', async () => {
    const lambdaSend = jest
      .fn()
      .mockResolvedValueOnce({ Functions: [{ FunctionArn: 'arn:aws:lambda:us-east-1:1:function:low-usage', FunctionName: 'low-usage', MemorySize: 128 }] })
      .mockResolvedValueOnce({ Tags: {} });
    const lambdaClient = withMockedSend(new LambdaClient({ region: 'us-east-1' }), lambdaSend);

    const cwSend = jest
      .fn()
      .mockResolvedValueOnce({ Datapoints: [{ Sum: 4 }] })
      .mockResolvedValueOnce({ Datapoints: [{ Average: 80 }] });
    const cwClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), cwSend);

    const resources = await (service as any).discoverLambdaFunctions('org-lambda-2', lambdaClient, cwClient, 'us-east-1');

    const fabricatedAssumptionCost = estimateLambdaMonthlyCostFromUsage(100_000, 3000, 128);
    expect(resources[0].estimated_monthly_cost).not.toBeCloseTo(fabricatedAssumptionCost, 2);
    expect(resources[0].metadata.invocations_30d).toBe(4);
  });

  it('a genuinely zero-invocation function reports a real (near-zero), not fabricated, cost -- and is marked zero_usage', async () => {
    const lambdaSend = jest
      .fn()
      .mockResolvedValueOnce({ Functions: [{ FunctionArn: 'arn:aws:lambda:us-east-1:1:function:idle-fn', FunctionName: 'idle-fn', MemorySize: 256 }] })
      .mockResolvedValueOnce({ Tags: {} });
    const lambdaClient = withMockedSend(new LambdaClient({ region: 'us-east-1' }), lambdaSend);

    const cwSend = jest.fn().mockResolvedValueOnce({ Datapoints: [] }); // Invocations: none
    const cwClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), cwSend);

    const resources = await (service as any).discoverLambdaFunctions('org-lambda-3', lambdaClient, cwClient, 'us-east-1');

    expect(resources[0].estimated_monthly_cost).toBe(0); // real zero usage -> real zero compute+request cost
    expect(resources[0].metadata.usage_state).toBe('zero_usage');
  });

  it('a CloudWatch failure leaves estimated_monthly_cost null -- never a fabricated or zero fallback', async () => {
    const lambdaSend = jest
      .fn()
      .mockResolvedValueOnce({ Functions: [{ FunctionArn: 'arn:aws:lambda:us-east-1:1:function:cw-down', FunctionName: 'cw-down', MemorySize: 128 }] })
      .mockResolvedValueOnce({ Tags: {} });
    const lambdaClient = withMockedSend(new LambdaClient({ region: 'us-east-1' }), lambdaSend);

    const cwSend = jest.fn().mockRejectedValueOnce(new Error('Throttling'));
    const cwClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), cwSend);

    const resources = await (service as any).discoverLambdaFunctions('org-lambda-4', lambdaClient, cwClient, 'us-east-1');

    expect(resources[0].estimated_monthly_cost).toBeNull();
    expect(resources[0].metadata.usage_state).toBe('unavailable');
    expect(resources[0].metadata.invocations_30d).toBeUndefined();
    expect(resources[0].metadata.cost_basis).toBeUndefined();
  });

  it('records the real architecture in metadata, defaulting to x86_64 when absent (pricing does not yet vary by architecture -- documented gap)', async () => {
    const lambdaSend = jest
      .fn()
      .mockResolvedValueOnce({
        Functions: [{ FunctionArn: 'arn:aws:lambda:us-east-1:1:function:arm-fn', FunctionName: 'arm-fn', MemorySize: 128, Architectures: ['arm64'] }],
      })
      .mockResolvedValueOnce({ Tags: {} });
    const lambdaClient = withMockedSend(new LambdaClient({ region: 'us-east-1' }), lambdaSend);

    const cwSend = jest.fn().mockResolvedValueOnce({ Datapoints: [] });
    const cwClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), cwSend);

    const resources = await (service as any).discoverLambdaFunctions('org-lambda-5', lambdaClient, cwClient, 'us-east-1');

    expect(resources[0].metadata.architecture).toBe('arm64');
  });

  it('defaults memory to 128MB when MemorySize is absent, matching the optimization detector', async () => {
    const lambdaSend = jest
      .fn()
      .mockResolvedValueOnce({ Functions: [{ FunctionArn: 'arn:aws:lambda:us-east-1:1:function:no-memory', FunctionName: 'no-memory' }] })
      .mockResolvedValueOnce({ Tags: {} });
    const lambdaClient = withMockedSend(new LambdaClient({ region: 'us-east-1' }), lambdaSend);

    const cwSend = jest
      .fn()
      .mockResolvedValueOnce({ Datapoints: [{ Sum: 10 }] })
      .mockResolvedValueOnce({ Datapoints: [{ Average: 50 }] });
    const cwClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), cwSend);

    const resources = await (service as any).discoverLambdaFunctions('org-lambda-6', lambdaClient, cwClient, 'us-east-1');

    const expectedCost = estimateLambdaMonthlyCostFromUsage(10, 50, 128);
    expect(resources[0].estimated_monthly_cost).toBeCloseTo(expectedCost, 8);
  });

  it('skips a function with no FunctionArn/FunctionName', async () => {
    const lambdaSend = jest.fn().mockResolvedValueOnce({ Functions: [{ MemorySize: 128 }] });
    const lambdaClient = withMockedSend(new LambdaClient({ region: 'us-east-1' }), lambdaSend);
    const cwClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), jest.fn());

    const resources = await (service as any).discoverLambdaFunctions('org-lambda-7', lambdaClient, cwClient, 'us-east-1');

    expect(resources).toHaveLength(0);
  });

  it('a ListFunctions failure returns an empty list rather than throwing (matches every other discoverer\'s error handling)', async () => {
    const lambdaSend = jest.fn().mockRejectedValueOnce(new Error('ServiceUnavailable'));
    const lambdaClient = withMockedSend(new LambdaClient({ region: 'us-east-1' }), lambdaSend);
    const cwClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), jest.fn());

    const resources = await (service as any).discoverLambdaFunctions('org-lambda-8', lambdaClient, cwClient, 'us-east-1');

    expect(resources).toEqual([]);
  });
});
