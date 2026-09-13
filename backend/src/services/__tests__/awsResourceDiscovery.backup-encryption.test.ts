/**
 * Security Truthfulness #41: coverage for discoverEC2Instances()/discoverEBSVolumes()
 * wiring the real AWS Backup evidence helper into has_backup, replacing the prior
 * hardcoded `false`. Same synthetic-mock pattern as awsResourceDiscovery.ebs.test.ts /
 * awsResourceDiscovery.pagination.test.ts. Pure unit-of-work tests against the discovery
 * methods directly -- no database.
 */
import { EC2Client } from '@aws-sdk/client-ec2';
import { BackupClient } from '@aws-sdk/client-backup';
import { AWSResourceDiscoveryService } from '../awsResourceDiscovery';
import { createAwsBackupEvidenceCache } from '../aws-backup-evidence.util';

function withMockedSend<T extends { send: (...args: any[]) => any }>(client: T, send: jest.Mock): T {
  (client as any).send = send;
  return client;
}

function recoveryPoint(status: string) {
  return { RecoveryPointArn: `arn:aws:backup:us-east-1:111111111111:recovery-point:${status}`, Status: status };
}

const ACCOUNT_ID = '111111111111';

describe('AWSResourceDiscoveryService.discoverEC2Instances — has_backup (Security Truthfulness #41)', () => {
  const service = new AWSResourceDiscoveryService({} as any);

  it('(5) EC2 with a qualifying AWS Backup recovery point -> has_backup: true', async () => {
    const ec2Send = jest.fn().mockResolvedValueOnce({ Reservations: [{ Instances: [{ InstanceId: 'i-backed-up' }] }] });
    const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), ec2Send);
    const backupSend = jest.fn().mockResolvedValue({ RecoveryPoints: [recoveryPoint('COMPLETED')] });
    const backupClient = withMockedSend(new BackupClient({ region: 'us-east-1' }), backupSend);
    const checkBackupEvidence = createAwsBackupEvidenceCache(backupClient);

    const resources = await (service as any).discoverEC2Instances('org-1', ec2Client, 'us-east-1', ACCOUNT_ID, checkBackupEvidence);

    expect(resources[0].has_backup).toBe(true);
    expect(backupSend.mock.calls[0][0].input.ResourceArn).toBe(`arn:aws:ec2:us-east-1:${ACCOUNT_ID}:instance/i-backed-up`);
  });

  it('(6) EC2 with a successful lookup and no qualifying evidence -> has_backup: false', async () => {
    const ec2Send = jest.fn().mockResolvedValueOnce({ Reservations: [{ Instances: [{ InstanceId: 'i-unprotected' }] }] });
    const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), ec2Send);
    const backupSend = jest.fn().mockResolvedValue({ RecoveryPoints: [] });
    const backupClient = withMockedSend(new BackupClient({ region: 'us-east-1' }), backupSend);
    const checkBackupEvidence = createAwsBackupEvidenceCache(backupClient);

    const resources = await (service as any).discoverEC2Instances('org-1', ec2Client, 'us-east-1', ACCOUNT_ID, checkBackupEvidence);

    expect(resources[0].has_backup).toBe(false);
  });

  it('(7) EC2 AccessDenied on the AWS Backup call -> has_backup: null, never false', async () => {
    const ec2Send = jest.fn().mockResolvedValueOnce({ Reservations: [{ Instances: [{ InstanceId: 'i-denied' }] }] });
    const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), ec2Send);
    const err: any = new Error('AccessDenied');
    err.name = 'AccessDeniedException';
    const backupSend = jest.fn().mockRejectedValue(err);
    const backupClient = withMockedSend(new BackupClient({ region: 'us-east-1' }), backupSend);
    const checkBackupEvidence = createAwsBackupEvidenceCache(backupClient);

    const resources = await (service as any).discoverEC2Instances('org-1', ec2Client, 'us-east-1', ACCOUNT_ID, checkBackupEvidence);

    expect(resources[0].has_backup).toBeNull();
  });

  it('(8) AWS Backup API failure (non-AccessDenied) -> has_backup: null, discovery does not crash', async () => {
    const ec2Send = jest.fn().mockResolvedValueOnce({ Reservations: [{ Instances: [{ InstanceId: 'i-throttled' }] }] });
    const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), ec2Send);
    const backupSend = jest.fn().mockRejectedValue(new Error('ThrottlingException'));
    const backupClient = withMockedSend(new BackupClient({ region: 'us-east-1' }), backupSend);
    const checkBackupEvidence = createAwsBackupEvidenceCache(backupClient);

    const resources = await (service as any).discoverEC2Instances('org-1', ec2Client, 'us-east-1', ACCOUNT_ID, checkBackupEvidence);

    expect(resources[0].has_backup).toBeNull();
    expect(resources).toHaveLength(1);
  });

  it('unknown account ID -> has_backup: null without attempting any AWS Backup call', async () => {
    const ec2Send = jest.fn().mockResolvedValueOnce({ Reservations: [{ Instances: [{ InstanceId: 'i-no-account' }] }] });
    const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), ec2Send);
    const backupSend = jest.fn();
    const backupClient = withMockedSend(new BackupClient({ region: 'us-east-1' }), backupSend);
    const checkBackupEvidence = createAwsBackupEvidenceCache(backupClient);

    const resources = await (service as any).discoverEC2Instances('org-1', ec2Client, 'us-east-1', undefined, checkBackupEvidence);

    expect(resources[0].has_backup).toBeNull();
    expect(backupSend).not.toHaveBeenCalled();
  });

  it('multiple EC2 instances each get their own independently correct has_backup value, not conflated', async () => {
    const ec2Send = jest.fn().mockResolvedValueOnce({
      Reservations: [{ Instances: [{ InstanceId: 'i-yes' }, { InstanceId: 'i-no' }, { InstanceId: 'i-unknown' }] }],
    });
    const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), ec2Send);
    const backupSend = jest.fn().mockImplementation(async (command: any) => {
      const arn = command.input.ResourceArn as string;
      if (arn.endsWith('i-yes')) return { RecoveryPoints: [recoveryPoint('AVAILABLE')] };
      if (arn.endsWith('i-no')) return { RecoveryPoints: [] };
      throw new Error('boom');
    });
    const backupClient = withMockedSend(new BackupClient({ region: 'us-east-1' }), backupSend);
    const checkBackupEvidence = createAwsBackupEvidenceCache(backupClient);

    const resources = await (service as any).discoverEC2Instances('org-1', ec2Client, 'us-east-1', ACCOUNT_ID, checkBackupEvidence);

    const byId = Object.fromEntries(resources.map((r: any) => [r.resource_id, r.has_backup]));
    expect(byId).toEqual({ 'i-yes': true, 'i-no': false, 'i-unknown': null });
  });
});

describe('AWSResourceDiscoveryService.discoverEBSVolumes — has_backup (Security Truthfulness #41)', () => {
  const service = new AWSResourceDiscoveryService({} as any);

  it('(9) EBS volume with direct qualifying protection -> has_backup: true', async () => {
    const ec2Send = jest.fn().mockResolvedValueOnce({
      Volumes: [{ VolumeId: 'vol-direct', VolumeType: 'gp3', Size: 20, State: 'in-use', AvailabilityZone: 'us-east-1a' }],
    });
    const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), ec2Send);
    const backupSend = jest.fn().mockResolvedValue({ RecoveryPoints: [recoveryPoint('COMPLETED')] });
    const backupClient = withMockedSend(new BackupClient({ region: 'us-east-1' }), backupSend);
    const checkBackupEvidence = createAwsBackupEvidenceCache(backupClient);

    const resources = await (service as any).discoverEBSVolumes('org-1', ec2Client, 'us-east-1', ACCOUNT_ID, checkBackupEvidence);

    expect(resources[0].has_backup).toBe(true);
  });

  it('(10) EBS volume protected only through its parent EC2 instance -> has_backup: true, and does not under-report valid EC2-level protection', async () => {
    const ec2Send = jest.fn().mockResolvedValueOnce({
      Volumes: [{
        VolumeId: 'vol-via-parent', VolumeType: 'gp3', Size: 20, State: 'in-use', AvailabilityZone: 'us-east-1a',
        Attachments: [{ InstanceId: 'i-parent' }],
      }],
    });
    const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), ec2Send);
    const backupSend = jest.fn().mockImplementation(async (command: any) => {
      const arn = command.input.ResourceArn as string;
      // The volume itself has no direct protected-resource entry -- only its parent
      // instance does, exactly the scenario the locked decision requires DevControl to
      // still count as covered.
      if (arn.includes(':instance/i-parent')) return { RecoveryPoints: [recoveryPoint('AVAILABLE')] };
      return { RecoveryPoints: [] };
    });
    const backupClient = withMockedSend(new BackupClient({ region: 'us-east-1' }), backupSend);
    const checkBackupEvidence = createAwsBackupEvidenceCache(backupClient);

    const resources = await (service as any).discoverEBSVolumes('org-1', ec2Client, 'us-east-1', ACCOUNT_ID, checkBackupEvidence);

    expect(resources[0].has_backup).toBe(true);
    expect(backupSend).toHaveBeenCalledTimes(2); // volume checked, then parent instance checked
  });

  it('(11) EBS volume with a successful lookup and no qualifying evidence anywhere (volume or parent) -> has_backup: false', async () => {
    const ec2Send = jest.fn().mockResolvedValueOnce({
      Volumes: [{
        VolumeId: 'vol-unprotected', VolumeType: 'gp3', Size: 20, State: 'in-use', AvailabilityZone: 'us-east-1a',
        Attachments: [{ InstanceId: 'i-also-unprotected' }],
      }],
    });
    const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), ec2Send);
    const backupSend = jest.fn().mockResolvedValue({ RecoveryPoints: [] });
    const backupClient = withMockedSend(new BackupClient({ region: 'us-east-1' }), backupSend);
    const checkBackupEvidence = createAwsBackupEvidenceCache(backupClient);

    const resources = await (service as any).discoverEBSVolumes('org-1', ec2Client, 'us-east-1', ACCOUNT_ID, checkBackupEvidence);

    expect(resources[0].has_backup).toBe(false);
  });

  it('(12) EBS AccessDenied / AWS Backup API failure -> has_backup: null, discovery does not crash', async () => {
    const ec2Send = jest.fn().mockResolvedValueOnce({
      Volumes: [{ VolumeId: 'vol-denied', VolumeType: 'gp3', Size: 20, State: 'in-use', AvailabilityZone: 'us-east-1a' }],
    });
    const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), ec2Send);
    const err: any = new Error('AccessDenied');
    err.name = 'AccessDeniedException';
    const backupSend = jest.fn().mockRejectedValue(err);
    const backupClient = withMockedSend(new BackupClient({ region: 'us-east-1' }), backupSend);
    const checkBackupEvidence = createAwsBackupEvidenceCache(backupClient);

    const resources = await (service as any).discoverEBSVolumes('org-1', ec2Client, 'us-east-1', ACCOUNT_ID, checkBackupEvidence);

    expect(resources[0].has_backup).toBeNull();
    expect(resources).toHaveLength(1);
  });

  it('does not fall back to EBS snapshot existence or any other evidence source when AWS Backup is unavailable', async () => {
    const ec2Send = jest.fn().mockResolvedValueOnce({
      Volumes: [{ VolumeId: 'vol-x', VolumeType: 'gp3', Size: 20, State: 'in-use', AvailabilityZone: 'us-east-1a' }],
    });
    const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), ec2Send);
    const backupSend = jest.fn().mockRejectedValue(new Error('ServiceUnavailable'));
    const backupClient = withMockedSend(new BackupClient({ region: 'us-east-1' }), backupSend);
    const checkBackupEvidence = createAwsBackupEvidenceCache(backupClient);

    const resources = await (service as any).discoverEBSVolumes('org-1', ec2Client, 'us-east-1', ACCOUNT_ID, checkBackupEvidence);

    // ec2Send was called exactly once -- for DescribeVolumes only. No DescribeSnapshots
    // (or any other EC2 call) was ever attempted as a fallback evidence source.
    expect(ec2Send).toHaveBeenCalledTimes(1);
    expect(resources[0].has_backup).toBeNull();
  });
});

describe('Shared AWS Backup evidence cache across EC2 + EBS discovery in one run', () => {
  const service = new AWSResourceDiscoveryService({} as any);

  it('an EC2 instance checked by discoverEC2Instances is reused (not re-queried) when an EBS volume attached to it is checked by discoverEBSVolumes', async () => {
    const ec2SendForInstances = jest.fn().mockResolvedValueOnce({ Reservations: [{ Instances: [{ InstanceId: 'i-shared' }] }] });
    const ec2ClientForInstances = withMockedSend(new EC2Client({ region: 'us-east-1' }), ec2SendForInstances);

    const ec2SendForVolumes = jest.fn().mockResolvedValueOnce({
      Volumes: [{
        VolumeId: 'vol-shared', VolumeType: 'gp3', Size: 20, State: 'in-use', AvailabilityZone: 'us-east-1a',
        Attachments: [{ InstanceId: 'i-shared' }],
      }],
    });
    const ec2ClientForVolumes = withMockedSend(new EC2Client({ region: 'us-east-1' }), ec2SendForVolumes);

    const backupSend = jest.fn().mockImplementation(async (command: any) => {
      const arn = command.input.ResourceArn as string;
      return arn.includes(':instance/i-shared') ? { RecoveryPoints: [recoveryPoint('COMPLETED')] } : { RecoveryPoints: [] };
    });
    const backupClient = withMockedSend(new BackupClient({ region: 'us-east-1' }), backupSend);
    // One cache instance shared across both discovery calls, exactly as
    // discoverAllResources() constructs it once and passes it to both.
    const checkBackupEvidence = createAwsBackupEvidenceCache(backupClient);

    const ec2Resources = await (service as any).discoverEC2Instances('org-1', ec2ClientForInstances, 'us-east-1', ACCOUNT_ID, checkBackupEvidence);
    const ebsResources = await (service as any).discoverEBSVolumes('org-1', ec2ClientForVolumes, 'us-east-1', ACCOUNT_ID, checkBackupEvidence);

    expect(ec2Resources[0].has_backup).toBe(true);
    expect(ebsResources[0].has_backup).toBe(true); // via parent instance, reusing the cached result
    // The instance ARN was queried against AWS Backup exactly once, even though both the
    // EC2 discovery and the EBS discovery's parent-instance fallback needed it.
    const instanceCalls = backupSend.mock.calls.filter((c) => c[0].input.ResourceArn.includes(':instance/i-shared'));
    expect(instanceCalls).toHaveLength(1);
  });
});
