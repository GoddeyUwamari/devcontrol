/**
 * FP PR 2b: CostOptimizationService.detectLowActivityEC2Instances() -- the
 * low-activity rule wired to AWS (mocked clients, no network).
 *
 *   - a finding only when every day is quiet and complete and the instance is
 *     not behind a load balancer or in an Auto Scaling group; the finding keeps
 *     the 'Idle Instance' identity, the W2b description, the rule identity and
 *     the daily evidence;
 *   - topology is read only for instances whose metrics pass (FP2b-Q9);
 *   - a failed metric or topology read makes the instance couldn't check, not
 *     the category (Q7); only a failed listing fails the category;
 *   - never the old CPU-average rule: no average, no ec2_idle threshold.
 */
import costOptimizationService from '../cost-optimization.service';
import { ISSUE_EC2_IDLE_INSTANCE } from '../../config/optimization-rules';
import { hasLowActivityRuleIdentity } from '../../config/low-activity-rule';
import { judgeStopEligibility } from '../stop-instance-eligibility';
import {
  accessDenied,
  fakeAutoScaling,
  fakeClassicElb,
  fakeCloudWatch,
  fakeEc2,
  fakeElb,
  type FakeInstance,
  type FakeMetrics,
  type FakeTopology,
} from './helpers/low-activity-aws';

const NOW = new Date('2026-11-07T15:00:00Z');
const LAUNCHED = new Date('2026-09-01T00:00:00Z');
const A = 'i-1234567890abcdef0';
const B = 'i-0123456789abcdef0';

function instance(id: string, overrides: Partial<FakeInstance> = {}): FakeInstance {
  return { InstanceId: id, InstanceType: 't3.micro', LaunchTime: LAUNCHED, PrivateIpAddress: '10.0.1.15', ...overrides };
}

function setup(options: {
  instances?: FakeInstance[] | Error;
  metrics?: Record<string, FakeMetrics> | Error;
  topology?: FakeTopology;
  elb?: FakeTopology | Error;
  classic?: FakeTopology | Error;
  autoScaling?: FakeTopology | Error | 'missing';
} = {}) {
  const topology = options.topology ?? {};
  const ec2 = fakeEc2(options.instances ?? [instance(A)]);
  const cloudWatch = fakeCloudWatch(NOW, options.metrics ?? {});
  const elb = fakeElb(options.elb ?? topology);
  const elbClassic = fakeClassicElb(options.classic ?? topology);
  const autoScaling = options.autoScaling === 'missing' ? undefined : fakeAutoScaling(options.autoScaling ?? topology);
  const clients = { ec2, cloudWatch, elb, elbClassic, autoScaling } as any;
  const run = () => (costOptimizationService as any).detectLowActivityEC2Instances(clients, 'us-east-1', NOW);
  return { run, ec2, cloudWatch, elb, elbClassic, autoScaling };
}

const topologyCalls = (s: ReturnType<typeof setup>) =>
  s.elb.calls.length + s.elbClassic.calls.length + (s.autoScaling?.calls.length ?? 0);

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('a low-activity instance', () => {
  it('becomes one finding with the identity, description, evidence and price provenance', async () => {
    const s = setup({ metrics: { [A]: { cpu: (h) => (h === 50 ? 4.26 : 2), networkIn: (h) => (h === 30 ? 1_160_000 : 50_000) } } });
    const result = await s.run();

    expect(result.success).toBe(true);
    expect(result.unknownResourceIds).toEqual([]);
    expect(result.endActiveForUnknown).toBe(true);
    expect(result.issues).toHaveLength(1);
    const issue = result.issues[0];
    expect(issue).toMatchObject({ resourceId: A, resourceType: 'EC2', issue: ISSUE_EC2_IDLE_INSTANCE, potentialSavings: 7.5, severity: 'LOW', awsRegion: 'us-east-1' });
    // Busiest network day (2026-10-09, hour 30): In 23 x 50,000 + 1,160,000 = 2,310,000, Out 24 x 100,000 = 2,400,000.
    expect(issue.description).toBe(
      "Over the past 30 days this instance's CPU peaked at 4.3%, its network traffic stayed under 4.8 MB a day, and it isn't registered with a load balancer or part of an Auto Scaling group. It may no longer be needed. Check with its owner before stopping it: low activity doesn't prove nothing depends on it."
    );
    const m = issue.metadata;
    expect(hasLowActivityRuleIdentity(m)).toBe(true);
    expect(m.rule_version).toBe(2);
    expect(m.low_activity).toMatchObject({
      evaluated_at: NOW.toISOString(),
      window_start: '2026-10-08T00:00:00.000Z',
      window_end: '2026-11-07T00:00:00.000Z',
      launch_time: LAUNCHED.toISOString(),
      completeness: 'complete',
      worst: { cpu_peak_percent: 4.26, cpu_peak_date: '2026-10-10', network_bytes_max: 4_710_000, network_max_date: '2026-10-09' },
      topology: { elbv2_target_groups: 'not_registered', classic_load_balancers: 'not_registered', auto_scaling: 'not_member' },
    });
    expect(m.low_activity.days).toHaveLength(30);
    expect(m).toMatchObject({ instance_type: 't3.micro', price_source: 'list_table', savings_claim: { kind: 'full_resource_cost', resource_ids: [A] } });
    expect(m.savings_basis).toMatch(/^estimated: /);
    // Q22: no CPU average anywhere, and no ec2_idle threshold provenance.
    for (const key of ['average_cpu', 'days_analyzed', 'cpu_evidence', 'configuration']) expect(m).not.toHaveProperty(key);
    expect(result.lowActivity).toEqual({
      evaluated: 1, low_activity: 1,
      not_low_activity: { cpu_peak: 0, network: 0, load_balancer: 0, auto_scaling: 0 },
      couldnt_check: { too_new_or_restarted: 0, cloudwatch_failed: 0, cloudwatch_incomplete: 0, topology_unreadable: 0 },
    });
  });

  it('is the only kind of finding the stop rule accepts (PR 2a marker, now set)', async () => {
    const { issues } = await setup().run();
    const verdict = judgeStopEligibility({
      resourceId: A, recommendationId: 'rec', now: NOW,
      finding: { id: 'rec', resource_id: A, resource_type: 'EC2', issue: ISSUE_EC2_IDLE_INSTANCE, status: 'ACTIVE', metadata: issues[0].metadata },
    });
    expect(verdict).toEqual({ eligible: true });
  });

  it('asks CloudWatch for hourly CPU Maximum and NetworkIn/Out Sum over the 30-day window, in one batch', async () => {
    const s = setup({ instances: [instance(A), instance(B)] });
    await s.run();
    expect(s.cloudWatch.send).toHaveBeenCalledTimes(1);
    const input = s.cloudWatch.send.mock.calls[0][0].input;
    expect(input.StartTime.toISOString()).toBe('2026-10-08T00:00:00.000Z');
    expect(input.EndTime.toISOString()).toBe('2026-11-07T00:00:00.000Z');
    const shape = input.MetricDataQueries.map((q: any) => [q.MetricStat.Metric.Dimensions[0].Value, q.MetricStat.Metric.MetricName, q.MetricStat.Stat, q.MetricStat.Period]);
    expect(shape).toEqual([
      [A, 'CPUUtilization', 'Maximum', 3600], [A, 'NetworkIn', 'Sum', 3600], [A, 'NetworkOut', 'Sum', 3600],
      [B, 'CPUUtilization', 'Maximum', 3600], [B, 'NetworkIn', 'Sum', 3600], [B, 'NetworkOut', 'Sum', 3600],
    ]);
    expect(input.MetricDataQueries.some((q: any) => q.MetricStat.Stat === 'Average')).toBe(false);
  });

  it('an unlisted instance type keeps the default figure, its provenance and a fixed LOW severity', async () => {
    const { issues } = await setup({ instances: [instance(A, { InstanceType: 'x9.placeholder' })] }).run();
    expect(issues[0]).toMatchObject({ potentialSavings: 50, severity: 'LOW' });
    expect(issues[0].metadata).toMatchObject({ price_source: 'default_unlisted_type', severity_basis: 'fixed_low_unknown_price' });
  });
});

describe('not low-activity and couldn\'t check', () => {
  it('a CPU peak: no finding, not unknown, and no topology read (FP2b-Q9)', async () => {
    const s = setup({ metrics: { [A]: { cpu: (h) => (h === 400 ? 62.4 : 2) } } });
    const result = await s.run();
    expect(result.issues).toEqual([]);
    expect(result.unknownResourceIds).toEqual([]);
    expect(result.lowActivity.not_low_activity.cpu_peak).toBe(1);
    expect(topologyCalls(s)).toBe(0);
  });

  it('busy network: no finding, not unknown', async () => {
    const result = await setup({ metrics: { [A]: { networkOut: () => 450_000 } } }).run();
    expect(result.issues).toEqual([]);
    expect(result.unknownResourceIds).toEqual([]);
    expect(result.lowActivity.not_low_activity.network).toBe(1);
  });

  it('a missing hour: unknown (couldn\'t check), no finding, no topology read', async () => {
    const s = setup({ metrics: { [A]: { networkIn: (h) => (h === 77 ? null : 100_000) } } });
    const result = await s.run();
    expect(result.issues).toEqual([]);
    expect(result.unknownResourceIds).toEqual([A]);
    expect(result.lowActivity.couldnt_check.cloudwatch_incomplete).toBe(1);
    expect(topologyCalls(s)).toBe(0);
  });

  it('PartialData from CloudWatch: unknown, never low-activity', async () => {
    const result = await setup({ metrics: { [A]: { status: 'PartialData' } } }).run();
    expect(result.issues).toEqual([]);
    expect(result.unknownResourceIds).toEqual([A]);
  });

  it('launched inside the window: unknown (too new or restarted)', async () => {
    const result = await setup({ instances: [instance(A, { LaunchTime: new Date('2026-10-20T00:00:00Z') })] }).run();
    expect(result.unknownResourceIds).toEqual([A]);
    expect(result.lowActivity.couldnt_check.too_new_or_restarted).toBe(1);
  });

  it('a CloudWatch request that throws: every instance unknown, the category still completes (FP2b-Q7)', async () => {
    const result = await setup({ instances: [instance(A), instance(B)], metrics: new Error('timeout') }).run();
    expect(result.success).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.unknownResourceIds.sort()).toEqual([A, B].sort());
    expect(result.lowActivity.couldnt_check.cloudwatch_failed).toBe(2);
  });

  it('a failed instance listing fails the whole category', async () => {
    const result = await setup({ instances: accessDenied() }).run();
    expect(result).toEqual({ success: false, issues: [] });
  });

  it('no running instances: a completed check with nothing found', async () => {
    const s = setup({ instances: [] });
    const result = await s.run();
    expect(result).toMatchObject({ success: true, issues: [], unknownResourceIds: [] });
    expect(s.cloudWatch.send).not.toHaveBeenCalled();
  });

  it('counts add up to the instances evaluated', async () => {
    const result = await setup({
      instances: [instance(A), instance(B), instance('i-0aaaaaaaaaaaaaaa0'), instance('i-0bbbbbbbbbbbbbbb0', { LaunchTime: undefined })],
      metrics: { [B]: { cpu: () => 50 }, 'i-0aaaaaaaaaaaaaaa0': { cpu: (h) => (h === 3 ? null : 2) } },
    }).run();
    const c = result.lowActivity;
    const total = c.low_activity
      + Object.values(c.not_low_activity as Record<string, number>).reduce((a, b) => a + b, 0)
      + Object.values(c.couldnt_check as Record<string, number>).reduce((a, b) => a + b, 0);
    expect(c.evaluated).toBe(4);
    expect(total).toBe(4);
    expect(c.low_activity).toBe(1);
  });
});

describe('topology exclusions (D3)', () => {
  it.each([
    ['an instance target group (any health state)', { targetGroups: [{ arn: 'arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/placeholder/0', type: 'instance', targets: [A] }] }, 'load_balancer'],
    ['an IP target group with its private IP', { targetGroups: [{ arn: 'arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/placeholder-ip/0', type: 'ip', targets: ['10.0.1.15'] }] }, 'load_balancer'],
    ['a Classic Load Balancer', { classicInstances: [A] }, 'load_balancer'],
    ['an Auto Scaling group', { autoScalingMembers: [A] }, 'auto_scaling'],
  ] as const)('registered with %s: no finding, not unknown', async (_label, topology, reason) => {
    const result = await setup({ topology: topology as unknown as FakeTopology }).run();
    expect(result.issues).toEqual([]);
    expect(result.unknownResourceIds).toEqual([]);
    expect(result.lowActivity.not_low_activity[reason]).toBe(1);
  });

  it('the aws:autoscaling:groupName tag excludes without any Auto Scaling call needed', async () => {
    const result = await setup({ instances: [instance(A, { Tags: [{ Key: 'aws:autoscaling:groupName', Value: 'placeholder-asg' }] })] }).run();
    expect(result.issues).toEqual([]);
    expect(result.lowActivity.not_low_activity.auto_scaling).toBe(1);
  });

  it('Lambda and ALB target groups are never read for health', async () => {
    const s = setup({ topology: { targetGroups: [
      { arn: 'arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/placeholder-fn/0', type: 'lambda', targets: [] },
      { arn: 'arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/placeholder-alb/0', type: 'alb', targets: [] },
    ] } });
    const result = await s.run();
    expect(result.issues).toHaveLength(1);
    expect(s.elb.count('DescribeTargetHealthCommand')).toBe(0);
  });

  it.each([
    ['DescribeTargetGroups denied', { elb: accessDenied() }],
    ['the Classic Load Balancer read denied', { classic: accessDenied() }],
    ['the Auto Scaling read denied', { autoScaling: accessDenied() }],
    ['no Auto Scaling client', { autoScaling: 'missing' }],
  ] as const)('%s: unknown (couldn\'t check), never "not registered"', async (_label, failure) => {
    const result = await setup(failure as any).run();
    expect(result.issues).toEqual([]);
    expect(result.unknownResourceIds).toEqual([A]);
    expect(result.lowActivity.couldnt_check.topology_unreadable).toBe(1);
  });

  it('DescribeTargetHealth failing for one group: unknown', async () => {
    const ec2 = fakeEc2([instance(A)]);
    const clients = {
      ec2,
      cloudWatch: fakeCloudWatch(NOW, {}),
      elb: fakeElb({ targetGroups: [{ arn: 'arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/placeholder/0', type: 'instance', targets: [] }] }, accessDenied()),
      elbClassic: fakeClassicElb({}),
      autoScaling: fakeAutoScaling({}),
    };
    const result = await (costOptimizationService as any).detectLowActivityEC2Instances(clients, 'us-east-1', NOW);
    expect(result.unknownResourceIds).toEqual([A]);
  });

  it('a failed topology read does not hide an exclusion another read found', async () => {
    const result = await setup({ elb: accessDenied(), autoScaling: { autoScalingMembers: [A] } }).run();
    expect(result.unknownResourceIds).toEqual([]);
    expect(result.lowActivity.not_low_activity.auto_scaling).toBe(1);
  });

  it('asks Auto Scaling only about the instances whose metrics passed', async () => {
    const s = setup({ instances: [instance(A), instance(B)], metrics: { [B]: { cpu: () => 30 } } });
    await s.run();
    expect(s.autoScaling!.send).toHaveBeenCalledTimes(1);
    expect(s.autoScaling!.send.mock.calls[0][0].input.InstanceIds).toEqual([A]);
  });
});
