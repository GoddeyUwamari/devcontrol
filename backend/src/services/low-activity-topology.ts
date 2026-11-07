/**
 * The load balancer and Auto Scaling reads the low-activity rule needs (D3),
 * for the scan's home region. Read-only Describe calls, all allowed by the
 * customer role's managed policies (SecurityAudit, ViewOnlyAccess) and none on
 * the DevControlReadExtras deny list.
 *
 *   ELBv2 target groups   DescribeTargetGroups (every page), then
 *                         DescribeTargetHealth for each group that can hold
 *                         instances or IP addresses. Registration in any state
 *                         counts, including a group not attached to a load
 *                         balancer.
 *   Classic Load Balancers DescribeLoadBalancers (every page): Instances[].
 *   Auto Scaling groups   DescribeAutoScalingInstances for the given instances.
 *
 * Each source either answers completely or is `{ ok: false }`: a missing
 * client, a denied, throttled or failed call, or a listing cut off at its page
 * limit. Never "not registered" on a failed read. Only error names are logged,
 * never ARNs or AWS messages.
 */
import {
  DescribeTargetGroupsCommand,
  DescribeTargetHealthCommand,
  type ElasticLoadBalancingV2Client,
  type TargetGroup,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import {
  DescribeLoadBalancersCommand as DescribeClassicLoadBalancersCommand,
  type ElasticLoadBalancingClient,
  type LoadBalancerDescription,
} from '@aws-sdk/client-elastic-load-balancing';
import { DescribeAutoScalingInstancesCommand, type AutoScalingClient } from '@aws-sdk/client-auto-scaling';
import { listAllPages } from '../utils/awsCallPolicy';
import type { TopologyReads } from './low-activity-evaluation';

/** Clients the reads use: the scan's own (same connection, call policy applied). */
export interface LowActivityTopologyClients {
  elb?: Pick<ElasticLoadBalancingV2Client, 'send'>;
  elbClassic?: Pick<ElasticLoadBalancingClient, 'send'>;
  autoScaling?: Pick<AutoScalingClient, 'send'>;
}

const AUTO_SCALING_IDS_PER_CALL = 50;

function logFailure(source: string, error: unknown): void {
  const name = error && typeof error === 'object' && 'name' in error ? String((error as { name: unknown }).name) : 'Error';
  console.error(`[LowActivity] ${source} read failed (${name}); affected instances are reported as not checked`);
}

async function readTargetGroups(client: LowActivityTopologyClients['elb']): Promise<TopologyReads['elbv2']> {
  if (!client) return { ok: false };
  try {
    const groups = await listAllPages<TargetGroup>('low activity: DescribeTargetGroups', async (marker) => {
      const page = await client.send(new DescribeTargetGroupsCommand({ Marker: marker, PageSize: 400 }));
      return { items: page.TargetGroups ?? [], nextToken: page.NextMarker };
    });
    if (!groups.complete) return { ok: false };

    const instanceIds = new Set<string>();
    const ipAddresses = new Set<string>();
    for (const group of groups.items) {
      // A Lambda or ALB target is never an EC2 instance.
      if (group.TargetType === 'lambda' || group.TargetType === 'alb') continue;
      if (!group.TargetGroupArn) return { ok: false };
      const health = await client.send(new DescribeTargetHealthCommand({ TargetGroupArn: group.TargetGroupArn }));
      for (const description of health.TargetHealthDescriptions ?? []) {
        const id = description.Target?.Id;
        if (!id) continue;
        if (group.TargetType === 'instance') instanceIds.add(id);
        else if (group.TargetType === 'ip') ipAddresses.add(id);
        else {
          // An unrecognised target type: match it both ways rather than miss it.
          instanceIds.add(id);
          ipAddresses.add(id);
        }
      }
    }
    return { ok: true, instanceIds, ipAddresses, targetGroupsRead: groups.items.length };
  } catch (error) {
    logFailure('ELBv2 target group', error);
    return { ok: false };
  }
}

async function readClassicLoadBalancers(client: LowActivityTopologyClients['elbClassic']): Promise<TopologyReads['classic']> {
  if (!client) return { ok: false };
  try {
    const balancers = await listAllPages<LoadBalancerDescription>('low activity: DescribeLoadBalancers (Classic)', async (marker) => {
      const page = await client.send(new DescribeClassicLoadBalancersCommand({ Marker: marker, PageSize: 400 }));
      return { items: page.LoadBalancerDescriptions ?? [], nextToken: page.NextMarker };
    });
    if (!balancers.complete) return { ok: false };
    const instanceIds = new Set<string>();
    for (const balancer of balancers.items) {
      for (const instance of balancer.Instances ?? []) if (instance.InstanceId) instanceIds.add(instance.InstanceId);
    }
    return { ok: true, instanceIds, loadBalancersRead: balancers.items.length };
  } catch (error) {
    logFailure('Classic Load Balancer', error);
    return { ok: false };
  }
}

async function readAutoScalingMembers(
  client: LowActivityTopologyClients['autoScaling'],
  instanceIds: readonly string[]
): Promise<TopologyReads['autoScaling']> {
  if (!client) return { ok: false };
  try {
    const memberIds = new Set<string>();
    for (let offset = 0; offset < instanceIds.length; offset += AUTO_SCALING_IDS_PER_CALL) {
      const chunk = instanceIds.slice(offset, offset + AUTO_SCALING_IDS_PER_CALL);
      const members = await listAllPages('low activity: DescribeAutoScalingInstances', async (token) => {
        const page = await client.send(new DescribeAutoScalingInstancesCommand({ InstanceIds: [...chunk], MaxRecords: 50, NextToken: token }));
        return { items: page.AutoScalingInstances ?? [], nextToken: page.NextToken };
      });
      if (!members.complete) return { ok: false };
      for (const member of members.items) if (member.InstanceId) memberIds.add(member.InstanceId);
    }
    return { ok: true, memberIds };
  } catch (error) {
    logFailure('Auto Scaling', error);
    return { ok: false };
  }
}

/** All three sources for the candidates (instances that passed the metric checks). */
export async function readLowActivityTopology(
  clients: LowActivityTopologyClients,
  candidateIds: readonly string[]
): Promise<TopologyReads> {
  const [elbv2, classic, autoScaling] = await Promise.all([
    readTargetGroups(clients.elb),
    readClassicLoadBalancers(clients.elbClassic),
    readAutoScalingMembers(clients.autoScaling, candidateIds),
  ]);
  return { elbv2, classic, autoScaling };
}
