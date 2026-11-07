/**
 * FP PR 2b: readLowActivityTopology() -- each source answers completely or is
 * { ok: false }: a listing that never ends, a failed page, a missing client.
 * Mock clients, no network.
 */
import { readLowActivityTopology } from '../low-activity-topology';
import { MAX_LISTING_PAGES } from '../../utils/awsCallPolicy';
import { fakeAutoScaling, fakeClassicElb, fakeClient, fakeElb } from './helpers/low-activity-aws';

const ARN = (n: number) => `arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/placeholder-${n}/0`;

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('readLowActivityTopology', () => {
  it('reads every page of target groups and every group\'s targets; instance and IP targets kept apart', async () => {
    const elb = fakeClient((command: any) => {
      if (command.constructor.name === 'DescribeTargetGroupsCommand') {
        return command.input.Marker
          ? { TargetGroups: [{ TargetGroupArn: ARN(2), TargetType: 'ip' }] }
          : { TargetGroups: [{ TargetGroupArn: ARN(1), TargetType: 'instance' }], NextMarker: 'page-2' };
      }
      return { TargetHealthDescriptions: [{ Target: { Id: command.input.TargetGroupArn === ARN(1) ? 'i-1234567890abcdef0' : '10.0.1.15' } }] };
    });
    const reads = await readLowActivityTopology({ elb, elbClassic: fakeClassicElb({ classicInstances: [] }), autoScaling: fakeAutoScaling({}) }, ['i-1234567890abcdef0']);
    expect(reads.elbv2).toEqual({ ok: true, instanceIds: new Set(['i-1234567890abcdef0']), ipAddresses: new Set(['10.0.1.15']), targetGroupsRead: 2 });
    expect(elb.count('DescribeTargetGroupsCommand')).toBe(2);
    expect(elb.count('DescribeTargetHealthCommand')).toBe(2);
  });

  it('a target group listing that never ends is no answer (ok: false), never "not registered"', async () => {
    const elb = fakeClient(() => ({ TargetGroups: [], NextMarker: 'more' }));
    const reads = await readLowActivityTopology({ elb, elbClassic: fakeClassicElb({}), autoScaling: fakeAutoScaling({}) }, ['i-1234567890abcdef0']);
    expect(reads.elbv2).toEqual({ ok: false });
    expect(elb.send).toHaveBeenCalledTimes(MAX_LISTING_PAGES);
  });

  it('a Classic Load Balancer listing that never ends is no answer', async () => {
    const elbClassic = fakeClient(() => ({ LoadBalancerDescriptions: [], NextMarker: 'more' }));
    expect((await readLowActivityTopology({ elb: fakeElb({}), elbClassic, autoScaling: fakeAutoScaling({}) }, [])).classic).toEqual({ ok: false });
  });

  it('asks Auto Scaling about at most 50 instances per call and reads every page', async () => {
    const ids = Array.from({ length: 120 }, (_, i) => `i-${String(i).padStart(17, '0')}`);
    const autoScaling = fakeAutoScaling({ autoScalingMembers: [ids[0], ids[119]] });
    const reads = await readLowActivityTopology({ elb: fakeElb({}), elbClassic: fakeClassicElb({}), autoScaling }, ids);
    expect(autoScaling.send.mock.calls.map(([c]: any[]) => c.input.InstanceIds.length)).toEqual([50, 50, 20]);
    expect(reads.autoScaling).toEqual({ ok: true, memberIds: new Set([ids[0], ids[119]]) });
  });

  it('no clients: every source is { ok: false }', async () => {
    expect(await readLowActivityTopology({}, ['i-1234567890abcdef0'])).toEqual({ elbv2: { ok: false }, classic: { ok: false }, autoScaling: { ok: false } });
  });

  it('logs only the error name, never the AWS message', async () => {
    const secretish = Object.assign(new Error('User: arn:aws:sts::123456789012:assumed-role/placeholder is not authorized'), { name: 'AccessDeniedException' });
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    await readLowActivityTopology({ elb: fakeElb(secretish), elbClassic: fakeClassicElb({}), autoScaling: fakeAutoScaling({}) }, ['i-1234567890abcdef0']);
    const logged = errors.mock.calls.flat().join(' ');
    expect(logged).toContain('AccessDeniedException');
    expect(logged).not.toContain('arn:aws');
  });
});
