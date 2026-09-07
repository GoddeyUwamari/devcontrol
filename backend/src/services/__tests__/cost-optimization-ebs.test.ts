/**
 * Phase 2, rule 1: ebs_unattached. Coverage for
 * CostOptimizationService's detectUnattachedEBSVolumes() (accessed via
 * `(service as any)` since it's private, same pattern as
 * awsResourceDiscovery.pagination.test.ts) -- a synthetic-mock unit test
 * against a real EC2Client instance with `.send` overridden, not a live AWS
 * call.
 */
import { EC2Client } from '@aws-sdk/client-ec2';
import costOptimizationService from '../cost-optimization.service';
import { ISSUE_EBS_UNATTACHED_VOLUME } from '../../config/optimization-rules';

function withMockedSend<T extends { send: (...args: any[]) => any }>(client: T, send: jest.Mock): T {
  (client as any).send = send;
  return client;
}

describe('CostOptimizationService.detectUnattachedEBSVolumes (ebs_unattached)', () => {
  it('flags a genuinely unattached (state: available) volume with stable identity', async () => {
    const send = jest.fn().mockResolvedValueOnce({
      Volumes: [
        {
          VolumeId: 'vol-unattached-1',
          VolumeType: 'gp3',
          Size: 100,
          State: 'available',
          AvailabilityZone: 'us-east-1a',
          Encrypted: true,
          Tags: [{ Key: 'Name', Value: 'orphaned-data-volume' }],
        },
      ],
    });
    const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), send);

    const result = await (costOptimizationService as any).detectUnattachedEBSVolumes(ec2Client);

    expect(result.success).toBe(true);
    expect(result.issues).toHaveLength(1);
    const [issue] = result.issues;
    expect(issue.resourceId).toBe('vol-unattached-1');
    expect(issue.resourceName).toBe('orphaned-data-volume');
    expect(issue.resourceType).toBe('EBS');
    expect(issue.issue).toBe(ISSUE_EBS_UNATTACHED_VOLUME);
    expect(issue.awsRegion).toBe('us-east-1');
    expect(issue.metadata).toEqual({
      volume_type: 'gp3',
      size_gb: 100,
      availability_zone: 'us-east-1a',
      encrypted: true,
    });
  });

  it('queries AWS with the real "status: available" filter -- never infers unattached from missing metadata', async () => {
    const send = jest.fn().mockResolvedValueOnce({ Volumes: [] });
    const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), send);

    await (costOptimizationService as any).detectUnattachedEBSVolumes(ec2Client);

    const sentCommand = send.mock.calls[0][0];
    expect(sentCommand.input.Filters).toEqual([{ Name: 'status', Values: ['available'] }]);
  });

  it('computes savings from real published per-GB-month pricing, by volume type', async () => {
    const send = jest.fn().mockResolvedValueOnce({
      Volumes: [
        { VolumeId: 'vol-gp3', VolumeType: 'gp3', Size: 100, State: 'available' }, // 100 * 0.08 = 8
        { VolumeId: 'vol-gp2', VolumeType: 'gp2', Size: 100, State: 'available' }, // 100 * 0.10 = 10
        { VolumeId: 'vol-io1', VolumeType: 'io1', Size: 50, State: 'available' },  // 50 * 0.125 = 6.25
      ],
    });
    const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), send);

    const result = await (costOptimizationService as any).detectUnattachedEBSVolumes(ec2Client);

    const byId = Object.fromEntries(result.issues.map((i: any) => [i.resourceId, i.potentialSavings]));
    expect(byId['vol-gp3']).toBeCloseTo(8);
    expect(byId['vol-gp2']).toBeCloseTo(10);
    expect(byId['vol-io1']).toBeCloseTo(6.25);
  });

  it('falls back to the VolumeId as the name when there is no Name tag', async () => {
    const send = jest.fn().mockResolvedValueOnce({
      Volumes: [{ VolumeId: 'vol-no-name', VolumeType: 'gp2', Size: 20, State: 'available' }],
    });
    const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), send);

    const result = await (costOptimizationService as any).detectUnattachedEBSVolumes(ec2Client);

    expect(result.issues[0].resourceName).toBe('vol-no-name');
  });

  it('skips a volume with no VolumeId rather than crashing on malformed data', async () => {
    const send = jest.fn().mockResolvedValueOnce({
      Volumes: [{ VolumeType: 'gp2', Size: 20, State: 'available' }],
    });
    const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), send);

    const result = await (costOptimizationService as any).detectUnattachedEBSVolumes(ec2Client);

    expect(result.success).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('returns no volumes found (empty, success: true) when the account genuinely has none', async () => {
    const send = jest.fn().mockResolvedValueOnce({ Volumes: [] });
    const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), send);

    const result = await (costOptimizationService as any).detectUnattachedEBSVolumes(ec2Client);

    expect(result).toEqual({ success: true, issues: [] });
  });

  it('an AWS API failure returns success: false, never a false "nothing found"', async () => {
    const send = jest.fn().mockRejectedValueOnce(new Error('AccessDenied: ec2:DescribeVolumes'));
    const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), send);

    const result = await (costOptimizationService as any).detectUnattachedEBSVolumes(ec2Client);

    expect(result).toEqual({ success: false, issues: [] });
  });
});
