/**
 * Phase 3D: ebs_gp2_to_gp3. Coverage for
 * CostOptimizationService.detectGp2ToGp3Migrations() -- the critical
 * properties under test are: the IOPS safety gate is a hard exclusion (not
 * a confidence downgrade), savings come from the same shared
 * estimateEBSMonthlyCost() ebs_unattached and discovery already use (never
 * a second EBS pricing calculation), and missing/invalid data is skipped,
 * never fabricated into a $0 or guessed recommendation. Same synthetic-mock
 * pattern as cost-optimization-ebs.test.ts.
 */
import { EC2Client } from '@aws-sdk/client-ec2';
import costOptimizationService from '../cost-optimization.service';
import { ISSUE_EBS_GP2_TO_GP3 } from '../../config/optimization-rules';
import { estimateEBSMonthlyCost } from '../../config/aws-pricing';

function withMockedSend<T extends { send: (...args: any[]) => any }>(client: T, send: jest.Mock): T {
  (client as any).send = send;
  return client;
}

describe('CostOptimizationService.detectGp2ToGp3Migrations (ebs_gp2_to_gp3)', () => {
  describe('eligibility', () => {
    it('flags a gp2 volume safely within the gp3 IOPS baseline', async () => {
      const send = jest.fn().mockResolvedValueOnce({
        Volumes: [
          { VolumeId: 'vol-gp2-1', VolumeType: 'gp2', Size: 100, Iops: 300, AvailabilityZone: 'us-east-1a' },
        ],
      });
      const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), send);

      const result = await (costOptimizationService as any).detectGp2ToGp3Migrations(ec2Client);

      expect(result.success).toBe(true);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].resourceId).toBe('vol-gp2-1');
      expect(result.issues[0].issue).toBe(ISSUE_EBS_GP2_TO_GP3);
      expect(result.issues[0].resourceType).toBe('EBS');
    });

    it('queries AWS with the real "volume-type: gp2" filter', async () => {
      const send = jest.fn().mockResolvedValueOnce({ Volumes: [] });
      const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), send);

      await (costOptimizationService as any).detectGp2ToGp3Migrations(ec2Client);

      const sentCommand = send.mock.calls[0][0];
      expect(sentCommand.input.Filters).toEqual([{ Name: 'volume-type', Values: ['gp2'] }]);
    });

    it('does not flag a volume the API itself did not tag as gp2 (defensive, even though the server-side filter already excludes it)', async () => {
      const send = jest.fn().mockResolvedValueOnce({
        Volumes: [{ VolumeId: 'vol-gp3', VolumeType: 'gp3', Size: 100, Iops: 3000 }],
      });
      const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), send);

      const result = await (costOptimizationService as any).detectGp2ToGp3Migrations(ec2Client);

      expect(result.issues).toHaveLength(0);
    });
  });

  describe('savings -- reuses the shared EBS pricing calculation, never a second implementation', () => {
    it.each([
      [100, 20], // small volume, low derived IOPS
      [50, 10],
      [250, 30],
    ])('computes savings for a %dGB volume from estimateEBSMonthlyCost, not a hardcoded formula', async (sizeGB, iops) => {
      const send = jest.fn().mockResolvedValueOnce({
        Volumes: [{ VolumeId: 'vol-size-test', VolumeType: 'gp2', Size: sizeGB, Iops: iops }],
      });
      const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), send);

      const result = await (costOptimizationService as any).detectGp2ToGp3Migrations(ec2Client);

      const expectedSavings = estimateEBSMonthlyCost('gp2', sizeGB) - estimateEBSMonthlyCost('gp3', sizeGB);
      expect(result.issues[0].potentialSavings).toBeCloseTo(expectedSavings, 8);
      expect(result.issues[0].metadata.current_monthly_cost).toBeCloseTo(estimateEBSMonthlyCost('gp2', sizeGB), 8);
      expect(result.issues[0].metadata.proposed_monthly_cost).toBeCloseTo(estimateEBSMonthlyCost('gp3', sizeGB), 8);
    });

    it('assigns severity via the same calculateSeverity() thresholds every other detector uses', async () => {
      // 5000GB gp2 at a low reported IOPS (within baseline) -> large enough
      // savings ($0.02/GB * 5000 = $100/mo) to cross the HIGH severity threshold.
      const send = jest.fn().mockResolvedValueOnce({
        Volumes: [{ VolumeId: 'vol-high-severity', VolumeType: 'gp2', Size: 5000, Iops: 2999 }],
      });
      const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), send);

      const result = await (costOptimizationService as any).detectGp2ToGp3Migrations(ec2Client);

      expect(result.issues[0].severity).toBe('HIGH');
    });
  });

  describe('IOPS safety gate -- hard exclusion, not a confidence downgrade', () => {
    it('includes a volume with reported IOPS safely below the gp3 baseline', async () => {
      const send = jest.fn().mockResolvedValueOnce({
        Volumes: [{ VolumeId: 'vol-below', VolumeType: 'gp2', Size: 100, Iops: 2999 }],
      });
      const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), send);

      const result = await (costOptimizationService as any).detectGp2ToGp3Migrations(ec2Client);

      expect(result.issues).toHaveLength(1);
    });

    it('includes a volume with reported IOPS exactly at the gp3 baseline (3,000 is included, not excluded)', async () => {
      const send = jest.fn().mockResolvedValueOnce({
        Volumes: [{ VolumeId: 'vol-exact', VolumeType: 'gp2', Size: 1000, Iops: 3000 }],
      });
      const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), send);

      const result = await (costOptimizationService as any).detectGp2ToGp3Migrations(ec2Client);

      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].metadata.current_iops).toBe(3000);
    });

    it('excludes a volume with reported IOPS one above the gp3 baseline', async () => {
      const send = jest.fn().mockResolvedValueOnce({
        Volumes: [{ VolumeId: 'vol-above', VolumeType: 'gp2', Size: 1500, Iops: 3001 }],
      });
      const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), send);

      const result = await (costOptimizationService as any).detectGp2ToGp3Migrations(ec2Client);

      expect(result.issues).toHaveLength(0);
    });

    it('falls back to the documented gp2 size-derived formula (3 IOPS/GB) when AWS reports no Iops value', async () => {
      // 500GB * 3 IOPS/GB = 1500 -- within baseline, no reported Iops field at all.
      const send = jest.fn().mockResolvedValueOnce({
        Volumes: [{ VolumeId: 'vol-derived-below', VolumeType: 'gp2', Size: 500 }],
      });
      const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), send);

      const result = await (costOptimizationService as any).detectGp2ToGp3Migrations(ec2Client);

      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].metadata.current_iops).toBe(1500);
    });

    it('excludes via the size-derived formula when no Iops is reported and size alone implies exceeding baseline', async () => {
      // 1001GB * 3 IOPS/GB = 3003 -- exceeds the 3,000 baseline.
      const send = jest.fn().mockResolvedValueOnce({
        Volumes: [{ VolumeId: 'vol-derived-above', VolumeType: 'gp2', Size: 1001 }],
      });
      const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), send);

      const result = await (costOptimizationService as any).detectGp2ToGp3Migrations(ec2Client);

      expect(result.issues).toHaveLength(0);
    });

    it('includes a volume exactly at the size-derived boundary (1,000GB -> 3,000 IOPS, included)', async () => {
      const send = jest.fn().mockResolvedValueOnce({
        Volumes: [{ VolumeId: 'vol-derived-exact', VolumeType: 'gp2', Size: 1000 }],
      });
      const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), send);

      const result = await (costOptimizationService as any).detectGp2ToGp3Migrations(ec2Client);

      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].metadata.current_iops).toBe(3000);
    });

    it('applies the documented gp2 minimum of 100 IOPS for a very small volume with no reported Iops', async () => {
      // 10GB * 3 IOPS/GB = 30, below the 100 IOPS documented minimum.
      const send = jest.fn().mockResolvedValueOnce({
        Volumes: [{ VolumeId: 'vol-tiny', VolumeType: 'gp2', Size: 10 }],
      });
      const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), send);

      const result = await (costOptimizationService as any).detectGp2ToGp3Migrations(ec2Client);

      expect(result.issues[0].metadata.current_iops).toBe(100);
    });
  });

  describe('invalid/missing data -- skip, never fabricate', () => {
    it('skips a volume with no VolumeId', async () => {
      const send = jest.fn().mockResolvedValueOnce({
        Volumes: [{ VolumeType: 'gp2', Size: 100, Iops: 300 }],
      });
      const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), send);

      const result = await (costOptimizationService as any).detectGp2ToGp3Migrations(ec2Client);

      expect(result.success).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('skips a volume with no Size at all', async () => {
      const send = jest.fn().mockResolvedValueOnce({
        Volumes: [{ VolumeId: 'vol-no-size', VolumeType: 'gp2', Iops: 300 }],
      });
      const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), send);

      const result = await (costOptimizationService as any).detectGp2ToGp3Migrations(ec2Client);

      expect(result.issues).toHaveLength(0);
    });

    it('skips a volume with a zero or negative size', async () => {
      const send = jest.fn().mockResolvedValueOnce({
        Volumes: [
          { VolumeId: 'vol-zero', VolumeType: 'gp2', Size: 0, Iops: 300 },
          { VolumeId: 'vol-negative', VolumeType: 'gp2', Size: -5, Iops: 300 },
        ],
      });
      const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), send);

      const result = await (costOptimizationService as any).detectGp2ToGp3Migrations(ec2Client);

      expect(result.issues).toHaveLength(0);
    });

    it('skips a volume with a malformed (non-finite) size', async () => {
      const send = jest.fn().mockResolvedValueOnce({
        Volumes: [{ VolumeId: 'vol-nan', VolumeType: 'gp2', Size: NaN, Iops: 300 }],
      });
      const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), send);

      const result = await (costOptimizationService as any).detectGp2ToGp3Migrations(ec2Client);

      expect(result.issues).toHaveLength(0);
    });

    it('skips a volume with a malformed (non-finite) reported Iops, falling back to the size-derived formula instead of crashing', async () => {
      const send = jest.fn().mockResolvedValueOnce({
        Volumes: [{ VolumeId: 'vol-bad-iops', VolumeType: 'gp2', Size: 100, Iops: NaN as any }],
      });
      const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), send);

      const result = await (costOptimizationService as any).detectGp2ToGp3Migrations(ec2Client);

      // 100GB * 3 IOPS/GB = 300 (derived fallback), well within baseline
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].metadata.current_iops).toBe(300);
    });
  });

  describe('AWS API behavior', () => {
    it('returns no volumes found (empty, success: true) when the account genuinely has none', async () => {
      const send = jest.fn().mockResolvedValueOnce({ Volumes: [] });
      const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), send);

      const result = await (costOptimizationService as any).detectGp2ToGp3Migrations(ec2Client);

      expect(result).toEqual({ success: true, issues: [] });
    });

    it('an AWS API failure returns success: false, never a false "nothing found"', async () => {
      const send = jest.fn().mockRejectedValueOnce(new Error('AccessDenied: ec2:DescribeVolumes'));
      const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), send);

      const result = await (costOptimizationService as any).detectGp2ToGp3Migrations(ec2Client);

      expect(result).toEqual({ success: false, issues: [] });
    });

    it('falls back to the VolumeId as the name when there is no Name tag', async () => {
      const send = jest.fn().mockResolvedValueOnce({
        Volumes: [{ VolumeId: 'vol-no-name', VolumeType: 'gp2', Size: 100, Iops: 300 }],
      });
      const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), send);

      const result = await (costOptimizationService as any).detectGp2ToGp3Migrations(ec2Client);

      expect(result.issues[0].resourceName).toBe('vol-no-name');
    });

    it('evaluates multiple volumes independently in the same scan', async () => {
      const send = jest.fn().mockResolvedValueOnce({
        Volumes: [
          { VolumeId: 'vol-eligible', VolumeType: 'gp2', Size: 100, Iops: 300 },
          { VolumeId: 'vol-excluded-iops', VolumeType: 'gp2', Size: 2000, Iops: 5000 },
          { VolumeType: 'gp2', Size: 50 }, // no VolumeId -- must be skipped
        ],
      });
      const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), send);

      const result = await (costOptimizationService as any).detectGp2ToGp3Migrations(ec2Client);

      const flaggedIds = result.issues.map((i: any) => i.resourceId).sort();
      expect(flaggedIds).toEqual(['vol-eligible']);
    });
  });
});
