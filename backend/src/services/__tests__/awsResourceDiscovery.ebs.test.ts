/**
 * Phase 2, rule 1 (ebs_unattached) — the discovery/inventory side.
 * AWSResourceDiscoveryService.discoverEBSVolumes() populates aws_resources
 * with real per-volume metadata (size, type, attachment) so EBS is a
 * first-class discovered resource type, not just something the analyzer
 * happens to also call AWS for. Same synthetic-mock pattern as
 * awsResourceDiscovery.pagination.test.ts.
 */
import { EC2Client } from '@aws-sdk/client-ec2';
import { AWSResourceDiscoveryService } from '../awsResourceDiscovery';

function withMockedSend<T extends { send: (...args: any[]) => any }>(client: T, send: jest.Mock): T {
  (client as any).send = send;
  return client;
}

describe('AWSResourceDiscoveryService.discoverEBSVolumes', () => {
  const service = new AWSResourceDiscoveryService({} as any);

  it('maps an attached volume with real metadata and cost estimate', async () => {
    const send = jest.fn().mockResolvedValueOnce({
      Volumes: [
        {
          VolumeId: 'vol-attached',
          VolumeType: 'gp3',
          Size: 50,
          State: 'in-use',
          AvailabilityZone: 'us-east-1a',
          Encrypted: true,
          Attachments: [{ InstanceId: 'i-abc123' }],
        },
      ],
      // no NextToken -> single page
    });
    const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), send);

    const resources = await (service as any).discoverEBSVolumes('org-1', ec2Client, 'us-east-1');

    expect(resources).toHaveLength(1);
    const [resource] = resources;
    expect(resource.resource_type).toBe('ebs');
    expect(resource.resource_id).toBe('vol-attached');
    expect(resource.status).toBe('in-use');
    expect(resource.is_encrypted).toBe(true);
    expect(resource.metadata).toEqual({
      volume_type: 'gp3',
      size_gb: 50,
      iops: undefined,
      throughput: undefined,
      availability_zone: 'us-east-1a',
      attached: true,
      attached_instance_id: 'i-abc123',
    });
    expect(resource.estimated_monthly_cost).toBeCloseTo(50 * 0.08); // gp3 rate
  });

  it('marks an unattached volume as attached: false with no instance id', async () => {
    const send = jest.fn().mockResolvedValueOnce({
      Volumes: [{ VolumeId: 'vol-free', VolumeType: 'gp2', Size: 10, State: 'available' }],
    });
    const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), send);

    const resources = await (service as any).discoverEBSVolumes('org-1', ec2Client, 'us-east-1');

    expect(resources[0].metadata.attached).toBe(false);
    expect(resources[0].metadata.attached_instance_id).toBeUndefined();
  });

  it('paginates across multiple pages', async () => {
    const send = jest
      .fn()
      .mockResolvedValueOnce({
        Volumes: [{ VolumeId: 'vol-page1', VolumeType: 'gp2', Size: 10, State: 'available' }],
        NextToken: 'token-2',
      })
      .mockResolvedValueOnce({
        Volumes: [{ VolumeId: 'vol-page2', VolumeType: 'gp2', Size: 10, State: 'available' }],
      });
    const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), send);

    const resources = await (service as any).discoverEBSVolumes('org-1', ec2Client, 'us-east-1');

    expect(send).toHaveBeenCalledTimes(2);
    expect(resources.map((r: any) => r.resource_id)).toEqual(['vol-page1', 'vol-page2']);
  });

  it('skips a volume with no VolumeId', async () => {
    const send = jest.fn().mockResolvedValueOnce({
      Volumes: [{ VolumeType: 'gp2', Size: 10, State: 'available' }],
    });
    const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), send);

    const resources = await (service as any).discoverEBSVolumes('org-1', ec2Client, 'us-east-1');

    expect(resources).toHaveLength(0);
  });
});
