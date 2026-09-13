/**
 * Enterprise Workstream 3B, Phase D: coverage for
 * CostOptimizationService.detectIdleEC2Instances() and its telemetry helper
 * getAverageCPUUtilization() -- the critical properties under test are:
 *
 *   - the qualifying comparison now uses the caller-supplied
 *     EffectiveOptimizationRuleConfig.value instead of a hardcoded `5`;
 *   - a genuine 0% CPU datapoint still qualifies (never conflated with
 *     missing data);
 *   - CloudWatch returning zero datapoints yields "insufficient evidence",
 *     never a false idle qualification;
 *   - a thrown CloudWatch/API error fails the whole detector category via
 *     the existing DetectorResult.success:false convention, rather than
 *     being silently treated as 0% CPU;
 *   - qualifying recommendations carry configuration provenance in metadata,
 *     without disturbing any pre-existing metadata field.
 */
import { EC2Client } from '@aws-sdk/client-ec2';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import costOptimizationService from '../cost-optimization.service';
import { ISSUE_EC2_IDLE_INSTANCE } from '../../config/optimization-rules';
import { EffectiveOptimizationRuleConfig } from '../optimization-rule-config.service';

function withMockedSend<T extends { send: (...args: any[]) => any }>(client: T, send: jest.Mock): T {
  (client as any).send = send;
  return client;
}

function ec2Instance(instanceId: string) {
  return { Reservations: [{ Instances: [{ InstanceId: instanceId, InstanceType: 't3.micro', Placement: { AvailabilityZone: 'us-east-1a' } }] }] };
}

function cpuDatapoints(...averages: number[]) {
  return { Datapoints: averages.map((Average) => ({ Average })) };
}

const DEFAULT_CONFIG: EffectiveOptimizationRuleConfig = {
  ruleId: 'ec2_idle',
  parameterId: 'cpu_threshold_percent',
  value: 5,
  source: 'default',
};

const OVERRIDE_CONFIG: EffectiveOptimizationRuleConfig = {
  ruleId: 'ec2_idle',
  parameterId: 'cpu_threshold_percent',
  value: 10,
  source: 'organization_override',
};

describe('CostOptimizationService.detectIdleEC2Instances (ec2_idle) — threshold configuration', () => {
  it('(1) default threshold 5 qualifies an instance averaging 4.9% CPU', async () => {
    const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce(ec2Instance('i-1')));
    const cwClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce(cpuDatapoints(4.9)));

    const result = await (costOptimizationService as any).detectIdleEC2Instances(ec2Client, cwClient, DEFAULT_CONFIG);

    expect(result.success).toBe(true);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].issue).toBe(ISSUE_EC2_IDLE_INSTANCE);
  });

  it('(2) default threshold 5 does NOT qualify an instance averaging exactly 5.0% CPU', async () => {
    const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce(ec2Instance('i-2')));
    const cwClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce(cpuDatapoints(5.0)));

    const result = await (costOptimizationService as any).detectIdleEC2Instances(ec2Client, cwClient, DEFAULT_CONFIG);

    expect(result.issues).toHaveLength(0);
  });

  it('(3) an organization override of 10 qualifies an instance averaging 8% CPU (would not qualify at the default)', async () => {
    const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce(ec2Instance('i-3')));
    const cwClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce(cpuDatapoints(8)));

    const result = await (costOptimizationService as any).detectIdleEC2Instances(ec2Client, cwClient, OVERRIDE_CONFIG);

    expect(result.issues).toHaveLength(1);
  });

  it('(4) an organization override of 10 does NOT qualify an instance averaging exactly 10% CPU', async () => {
    const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce(ec2Instance('i-4')));
    const cwClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce(cpuDatapoints(10)));

    const result = await (costOptimizationService as any).detectIdleEC2Instances(ec2Client, cwClient, OVERRIDE_CONFIG);

    expect(result.issues).toHaveLength(0);
  });

  it('(5) a genuine 0% CPU datapoint qualifies as idle -- real evidence, not missing data', async () => {
    const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce(ec2Instance('i-5')));
    const cwClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce(cpuDatapoints(0)));

    const result = await (costOptimizationService as any).detectIdleEC2Instances(ec2Client, cwClient, DEFAULT_CONFIG);

    expect(result.success).toBe(true);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].metadata.average_cpu).toBe(0);
  });

  it('(6) zero CloudWatch datapoints does NOT qualify as idle -- insufficient evidence, not assumed 0%', async () => {
    const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce(ec2Instance('i-6')));
    const cwClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce({ Datapoints: [] }));

    const result = await (costOptimizationService as any).detectIdleEC2Instances(ec2Client, cwClient, DEFAULT_CONFIG);

    expect(result.success).toBe(true); // the scan itself succeeded; this one instance just has no evidence
    expect(result.issues).toHaveLength(0);
  });

  it('(7) a thrown CloudWatch/API error fails the whole detector category (success: false), never becomes a false 0% CPU', async () => {
    const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce(ec2Instance('i-7')));
    const cwClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), jest.fn().mockRejectedValueOnce(new Error('Throttling: rate exceeded')));

    const result = await (costOptimizationService as any).detectIdleEC2Instances(ec2Client, cwClient, DEFAULT_CONFIG);

    expect(result).toEqual({ success: false, issues: [] });
  });

  it('(8) an AWS DescribeInstances failure also returns success: false, never a false "nothing found"', async () => {
    const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), jest.fn().mockRejectedValueOnce(new Error('ServiceUnavailable')));
    const cwClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), jest.fn());

    const result = await (costOptimizationService as any).detectIdleEC2Instances(ec2Client, cwClient, DEFAULT_CONFIG);

    expect(result).toEqual({ success: false, issues: [] });
  });

  it('(9) qualifying metadata records the effective configuration that actually produced the finding -- default source', async () => {
    const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce(ec2Instance('i-9')));
    const cwClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce(cpuDatapoints(2)));

    const result = await (costOptimizationService as any).detectIdleEC2Instances(ec2Client, cwClient, DEFAULT_CONFIG);

    expect(result.issues[0].metadata.configuration).toEqual({
      parameter: 'cpu_threshold_percent',
      value: 5,
      source: 'default',
    });
    // pre-existing fields must survive unchanged alongside the new key
    expect(result.issues[0].metadata.instance_type).toBe('t3.micro');
    expect(result.issues[0].metadata.days_analyzed).toBe(7);
  });

  it('(10) qualifying metadata records "organization_override" as the source when an override is in effect', async () => {
    const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce(ec2Instance('i-10')));
    const cwClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce(cpuDatapoints(7)));

    const result = await (costOptimizationService as any).detectIdleEC2Instances(ec2Client, cwClient, OVERRIDE_CONFIG);

    expect(result.issues[0].metadata.configuration).toEqual({
      parameter: 'cpu_threshold_percent',
      value: 10,
      source: 'organization_override',
    });
  });

  it('(11) the issue identity is never encoded with the threshold -- always the same canonical constant regardless of configuration', async () => {
    const ec2ClientDefault = withMockedSend(new EC2Client({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce(ec2Instance('i-11a')));
    const cwClientDefault = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce(cpuDatapoints(1)));
    const defaultResult = await (costOptimizationService as any).detectIdleEC2Instances(ec2ClientDefault, cwClientDefault, DEFAULT_CONFIG);

    const ec2ClientOverride = withMockedSend(new EC2Client({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce(ec2Instance('i-11b')));
    const cwClientOverride = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce(cpuDatapoints(1)));
    const overrideResult = await (costOptimizationService as any).detectIdleEC2Instances(ec2ClientOverride, cwClientOverride, OVERRIDE_CONFIG);

    expect(defaultResult.issues[0].issue).toBe(ISSUE_EC2_IDLE_INSTANCE);
    expect(overrideResult.issues[0].issue).toBe(ISSUE_EC2_IDLE_INSTANCE);
    expect(defaultResult.issues[0].issue).toBe(overrideResult.issues[0].issue);
  });
});
