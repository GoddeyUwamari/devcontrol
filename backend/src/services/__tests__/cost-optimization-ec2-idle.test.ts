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

// LaunchTime (the most recent launch/start) well before the 7-day window.
const LONG_RUNNING = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

/** `launchTime: null` omits LaunchTime entirely. */
function ec2Instance(instanceId: string, launchTime: Date | null = LONG_RUNNING) {
  return { Reservations: [{ Instances: [{ InstanceId: instanceId, InstanceType: 't3.micro', LaunchTime: launchTime ?? undefined, Placement: { AvailabilityZone: 'us-east-1a' } }] }] };
}

/** `count` hourly datapoints of `average` -- defaults to the full 168-hour window. */
function cpuWindow(average: number, count = 168) {
  return { Datapoints: Array.from({ length: count }, () => ({ Average: average })) };
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
    const cwClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce(cpuWindow(4.9)));

    const result = await (costOptimizationService as any).detectIdleEC2Instances(ec2Client, cwClient, DEFAULT_CONFIG);

    expect(result.success).toBe(true);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].issue).toBe(ISSUE_EC2_IDLE_INSTANCE);
  });

  it('(2) default threshold 5 does NOT qualify an instance averaging exactly 5.0% CPU', async () => {
    const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce(ec2Instance('i-2')));
    const cwClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce(cpuWindow(5.0)));

    const result = await (costOptimizationService as any).detectIdleEC2Instances(ec2Client, cwClient, DEFAULT_CONFIG);

    expect(result.issues).toHaveLength(0);
  });

  it('(3) an organization override of 10 qualifies an instance averaging 8% CPU (would not qualify at the default)', async () => {
    const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce(ec2Instance('i-3')));
    const cwClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce(cpuWindow(8)));

    const result = await (costOptimizationService as any).detectIdleEC2Instances(ec2Client, cwClient, OVERRIDE_CONFIG);

    expect(result.issues).toHaveLength(1);
  });

  it('(4) an organization override of 10 does NOT qualify an instance averaging exactly 10% CPU', async () => {
    const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce(ec2Instance('i-4')));
    const cwClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce(cpuWindow(10)));

    const result = await (costOptimizationService as any).detectIdleEC2Instances(ec2Client, cwClient, OVERRIDE_CONFIG);

    expect(result.issues).toHaveLength(0);
  });

  it('(5) a complete window of genuine 0% CPU qualifies as idle -- real evidence, not missing data', async () => {
    const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce(ec2Instance('i-5')));
    const cwClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce(cpuWindow(0)));

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
    const cwClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce(cpuWindow(2)));

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
    const cwClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce(cpuWindow(7)));

    const result = await (costOptimizationService as any).detectIdleEC2Instances(ec2Client, cwClient, OVERRIDE_CONFIG);

    expect(result.issues[0].metadata.configuration).toEqual({
      parameter: 'cpu_threshold_percent',
      value: 10,
      source: 'organization_override',
    });
  });

  it('(11) the issue identity is never encoded with the threshold -- always the same canonical constant regardless of configuration', async () => {
    const ec2ClientDefault = withMockedSend(new EC2Client({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce(ec2Instance('i-11a')));
    const cwClientDefault = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce(cpuWindow(1)));
    const defaultResult = await (costOptimizationService as any).detectIdleEC2Instances(ec2ClientDefault, cwClientDefault, DEFAULT_CONFIG);

    const ec2ClientOverride = withMockedSend(new EC2Client({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce(ec2Instance('i-11b')));
    const cwClientOverride = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce(cpuWindow(1)));
    const overrideResult = await (costOptimizationService as any).detectIdleEC2Instances(ec2ClientOverride, cwClientOverride, OVERRIDE_CONFIG);

    expect(defaultResult.issues[0].issue).toBe(ISSUE_EC2_IDLE_INSTANCE);
    expect(overrideResult.issues[0].issue).toBe(ISSUE_EC2_IDLE_INSTANCE);
    expect(defaultResult.issues[0].issue).toBe(overrideResult.issues[0].issue);
  });
});

describe('CostOptimizationService.detectIdleEC2Instances (ec2_idle) — evidence completeness', () => {
  async function detect(instance: ReturnType<typeof ec2Instance>, cloudWatchResponse: unknown) {
    const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce(instance));
    const cwSend = jest.fn().mockResolvedValueOnce(cloudWatchResponse);
    const cwClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), cwSend);
    const result = await (costOptimizationService as any).detectIdleEC2Instances(ec2Client, cwClient, DEFAULT_CONFIG);
    return { result, cwSend };
  }

  it('(12) a complete window (168 of 168 hourly datapoints) is evaluated normally', async () => {
    const { result, cwSend } = await detect(ec2Instance('i-12'), cpuWindow(1.5));

    expect(result.success).toBe(true);
    expect(result.issues).toHaveLength(1);
    const input = cwSend.mock.calls[0][0].input;
    expect(input.Period).toBe(3600);
    expect(input.EndTime.getTime() - input.StartTime.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('(13) exactly the 80% floor (134 of 168) qualifies; one below it (133) does not', async () => {
    const atFloor = await detect(ec2Instance('i-13a'), cpuWindow(1, 134));
    const belowFloor = await detect(ec2Instance('i-13b'), cpuWindow(1, 133));

    expect(atFloor.result.issues).toHaveLength(1);
    expect(belowFloor.result.success).toBe(true);
    expect(belowFloor.result.issues).toHaveLength(0);
  });

  it('(14) a single datapoint is insufficient evidence -- never presented as a 7-day average', async () => {
    const { result } = await detect(ec2Instance('i-14'), cpuDatapoints(0.5));

    expect(result.success).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('(15) low average CPU with insufficient coverage is not an idle candidate', async () => {
    const { result } = await detect(ec2Instance('i-15'), cpuWindow(0.1, 48));

    expect(result.issues).toHaveLength(0);
  });

  it('(16) a LaunchTime (most recent launch/start, e.g. after a stop/start) inside the window is not a full-window evaluation -- CloudWatch is not even queried', async () => {
    const lastStartedTwoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const { result, cwSend } = await detect(ec2Instance('i-16', lastStartedTwoDaysAgo), cpuWindow(0));

    expect(result.success).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(cwSend).not.toHaveBeenCalled();
  });

  it('(17) a missing LaunchTime is insufficient evidence -- whether it ran for the whole window cannot be established', async () => {
    const { result } = await detect(ec2Instance('i-17', null), cpuWindow(0));

    expect(result.issues).toHaveLength(0);
  });

  it('(18) high CPU over a complete window is not an idle candidate', async () => {
    const { result } = await detect(ec2Instance('i-18'), cpuWindow(65));

    expect(result.success).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('(19) datapoints with no numeric Average are not counted, and never read as 0% CPU', async () => {
    const response = { Datapoints: Array.from({ length: 168 }, (_, i) => (i < 100 ? { Average: 1 } : {})) };
    const { result } = await detect(ec2Instance('i-19'), response);

    expect(result.issues).toHaveLength(0); // only 100 real datapoints -- below the 134 floor
  });

  it('(20) the finding records its actual evidence: datapoints observed, expected, required, and the window', async () => {
    const { result } = await detect(ec2Instance('i-20'), cpuWindow(2, 150));
    const evidence = result.issues[0].metadata.cpu_evidence;

    expect(evidence).toMatchObject({
      source: 'CloudWatch AWS/EC2 CPUUtilization (Average)',
      period_seconds: 3600,
      datapoints_observed: 150,
      datapoints_expected: 168,
      datapoints_required: 134,
    });
    expect(new Date(evidence.window_end).getTime() - new Date(evidence.window_start).getTime()).toBe(7 * 24 * 60 * 60 * 1000);
    expect(result.issues[0].metadata.average_cpu).toBe(2);
  });

  it('(21) the description states the real coverage and calls it an idle candidate, not a rightsizing recommendation', async () => {
    const { result } = await detect(ec2Instance('i-21'), cpuWindow(2, 150));
    const description: string = result.issues[0].description;

    expect(description).toContain('150 of 168 hourly CloudWatch datapoints');
    expect(description).toContain('idle candidate');
    expect(description).toContain('not a rightsizing recommendation');
    expect(description).not.toMatch(/downsiz/i);
  });

  it('(22) its estimated savings are labeled as an estimate and declare the instance cost they draw on', async () => {
    const { result } = await detect(ec2Instance('i-22'), cpuWindow(2));
    const metadata = result.issues[0].metadata;

    expect(metadata.savings_basis).toMatch(/^estimated:/);
    expect(metadata.savings_basis).toContain('not billed cost or guaranteed savings');
    // Nothing the customer sees implies a guaranteed saving from stopping it.
    for (const text of [metadata.savings_basis, result.issues[0].description]) {
      expect(text).not.toMatch(/stopping|would save|will save|guarantee(?!d savings)/i);
    }
    expect(metadata.savings_claim).toEqual({ kind: 'full_resource_cost', resource_ids: ['i-22'] });
  });
});

