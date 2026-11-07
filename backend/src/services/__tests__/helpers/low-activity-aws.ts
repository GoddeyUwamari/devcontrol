/**
 * Test helper (FP PR 2b): fake AWS clients for the low-activity detector --
 * DescribeInstances, GetMetricData, ELBv2 target groups, Classic Load
 * Balancers and Auto Scaling -- each counting the commands it receives. No
 * network. Not a test file itself.
 */
import { lowActivityWindow } from '../../low-activity-evaluation';

const HOUR = 3_600_000;

export type HourValue = (hour: number) => number | null;

export interface FakeMetrics {
  cpu?: HourValue;
  networkIn?: HourValue;
  networkOut?: HourValue;
  /** StatusCode returned for this instance's queries (default Complete). */
  status?: 'Complete' | 'PartialData' | 'Forbidden' | 'InternalError';
}

export const QUIET: Required<Omit<FakeMetrics, 'status'>> = {
  cpu: () => 2,
  networkIn: () => 100_000,
  networkOut: () => 100_000,
};

export interface FakeInstance {
  InstanceId: string;
  InstanceType?: string;
  LaunchTime?: Date;
  PrivateIpAddress?: string;
  Tags?: Array<{ Key: string; Value: string }>;
}

/** A client whose send() records each command's class name and answers through `answer`. */
export function fakeClient(answer: (command: any) => Promise<any> | any) {
  const calls: string[] = [];
  const send = jest.fn(async (command: any) => {
    calls.push(command.constructor.name);
    return answer(command);
  });
  return { send, calls, count: (name: string) => calls.filter((c) => c === name).length };
}

export function fakeEc2(instances: FakeInstance[] | Error) {
  return fakeClient(() => {
    if (instances instanceof Error) throw instances;
    return { Reservations: [{ Instances: instances }] };
  });
}

/** GetMetricData over the window for `now`: each query's series from `byInstance[instanceId]`. */
export function fakeCloudWatch(now: Date, byInstance: Record<string, FakeMetrics> | Error) {
  const window = lowActivityWindow(now);
  return fakeClient((command: any) => {
    if (byInstance instanceof Error) throw byInstance;
    const results = (command.input.MetricDataQueries as any[]).map((q) => {
      const instanceId = q.MetricStat.Metric.Dimensions[0].Value as string;
      const metric = q.MetricStat.Metric.MetricName as string;
      const spec = byInstance[instanceId] ?? {};
      const fn = (metric === 'CPUUtilization' ? spec.cpu ?? QUIET.cpu : metric === 'NetworkIn' ? spec.networkIn ?? QUIET.networkIn : spec.networkOut ?? QUIET.networkOut);
      const Timestamps: Date[] = [];
      const Values: number[] = [];
      for (let h = 0; h < 30 * 24; h++) {
        const v = fn(h);
        if (v === null) continue;
        Timestamps.push(new Date(window.start.getTime() + h * HOUR));
        Values.push(v);
      }
      return { Id: q.Id, Label: metric, Timestamps, Values, StatusCode: spec.status ?? 'Complete' };
    });
    return { MetricDataResults: results };
  });
}

export interface FakeTopology {
  /** Target groups and their registered target ids. */
  targetGroups?: Array<{ arn: string; type: 'instance' | 'ip' | 'lambda' | 'alb'; targets: string[] }>;
  classicInstances?: string[];
  autoScalingMembers?: string[];
}

export function fakeElb(topology: FakeTopology | Error, healthError?: Error) {
  return fakeClient((command: any) => {
    if (topology instanceof Error) throw topology;
    const groups = topology.targetGroups ?? [];
    if (command.constructor.name === 'DescribeTargetGroupsCommand') {
      return { TargetGroups: groups.map((g) => ({ TargetGroupArn: g.arn, TargetType: g.type })) };
    }
    if (healthError) throw healthError;
    const group = groups.find((g) => g.arn === command.input.TargetGroupArn);
    return { TargetHealthDescriptions: (group?.targets ?? []).map((Id) => ({ Target: { Id }, TargetHealth: { State: 'unused' } })) };
  });
}

export function fakeClassicElb(topology: FakeTopology | Error) {
  return fakeClient(() => {
    if (topology instanceof Error) throw topology;
    return { LoadBalancerDescriptions: [{ LoadBalancerName: 'placeholder-clb', Instances: (topology.classicInstances ?? []).map((InstanceId) => ({ InstanceId })) }] };
  });
}

export function fakeAutoScaling(topology: FakeTopology | Error) {
  return fakeClient((command: any) => {
    if (topology instanceof Error) throw topology;
    const asked: string[] = command.input.InstanceIds ?? [];
    return { AutoScalingInstances: (topology.autoScalingMembers ?? []).filter((id) => asked.includes(id)).map((InstanceId) => ({ InstanceId, AutoScalingGroupName: 'placeholder-asg' })) };
  });
}

/** An AWS-shaped access-denied error (no message from AWS is ever logged). */
export function accessDenied(): Error {
  const error = new Error('denied');
  error.name = 'AccessDeniedException';
  return error;
}
