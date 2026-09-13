/**
 * Security Truthfulness #41: coverage for checkAwsBackupRecoveryPoints() /
 * createAwsBackupEvidenceCache() / checkEBSBackupCoverage() -- the shared AWS Backup
 * evidence helper used by awsResourceDiscovery.ts's EC2/EBS has_backup fix. Pure unit
 * tests, no database, no discovery service -- matching the module's own stated scope.
 */
import { BackupClient } from '@aws-sdk/client-backup';
import {
  checkAwsBackupRecoveryPoints,
  createAwsBackupEvidenceCache,
  checkEBSBackupCoverage,
} from '../aws-backup-evidence.util';

function withMockedSend(send: jest.Mock): BackupClient {
  const client = new BackupClient({ region: 'us-east-1' });
  (client as any).send = send;
  return client;
}

function recoveryPoint(status: string) {
  return { RecoveryPointArn: `arn:aws:backup:us-east-1:1:recovery-point:${status}`, Status: status };
}

describe('checkAwsBackupRecoveryPoints', () => {
  it('(1) returns true when a COMPLETED recovery point exists', async () => {
    const send = jest.fn().mockResolvedValue({ RecoveryPoints: [recoveryPoint('COMPLETED')] });
    const client = withMockedSend(send);

    const result = await checkAwsBackupRecoveryPoints(client, 'arn:aws:ec2:us-east-1:1:instance/i-1');

    expect(result).toBe(true);
  });

  it('(2) returns true when an AVAILABLE recovery point exists', async () => {
    const send = jest.fn().mockResolvedValue({ RecoveryPoints: [recoveryPoint('AVAILABLE')] });
    const client = withMockedSend(send);

    expect(await checkAwsBackupRecoveryPoints(client, 'arn:1')).toBe(true);
  });

  it('(3) returns false when the lookup succeeds with zero recovery points', async () => {
    const send = jest.fn().mockResolvedValue({ RecoveryPoints: [] });
    const client = withMockedSend(send);

    expect(await checkAwsBackupRecoveryPoints(client, 'arn:1')).toBe(false);
  });

  it('(4) returns false when only non-qualifying recovery points exist (CREATING/PARTIAL/EXPIRED)', async () => {
    const send = jest.fn().mockResolvedValue({
      RecoveryPoints: [recoveryPoint('CREATING'), recoveryPoint('PARTIAL'), recoveryPoint('EXPIRED')],
    });
    const client = withMockedSend(send);

    expect(await checkAwsBackupRecoveryPoints(client, 'arn:1')).toBe(false);
  });

  it('(5) AccessDenied returns null, never false, and never throws', async () => {
    const err: any = new Error('User is not authorized to perform: backup:ListRecoveryPointsByResource');
    err.name = 'AccessDeniedException';
    const send = jest.fn().mockRejectedValue(err);
    const client = withMockedSend(send);

    await expect(checkAwsBackupRecoveryPoints(client, 'arn:1')).resolves.toBeNull();
  });

  it('(6) a generic AWS Backup API failure returns null, never false, and never throws', async () => {
    const send = jest.fn().mockRejectedValue(new Error('ThrottlingException'));
    const client = withMockedSend(send);

    await expect(checkAwsBackupRecoveryPoints(client, 'arn:1')).resolves.toBeNull();
  });

  it('(7) paginates via NextToken, checking every page for qualifying evidence', async () => {
    const send = jest
      .fn()
      .mockResolvedValueOnce({ RecoveryPoints: [recoveryPoint('EXPIRED')], NextToken: 'page-2' })
      .mockResolvedValueOnce({ RecoveryPoints: [recoveryPoint('COMPLETED')] });
    const client = withMockedSend(send);

    const result = await checkAwsBackupRecoveryPoints(client, 'arn:1');

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0].input.NextToken).toBe('page-2');
    expect(result).toBe(true);
  });

  it('(8) stops paginating as soon as qualifying evidence is found on an earlier page', async () => {
    const send = jest.fn().mockResolvedValue({ RecoveryPoints: [recoveryPoint('COMPLETED')], NextToken: 'page-2' });
    const client = withMockedSend(send);

    const result = await checkAwsBackupRecoveryPoints(client, 'arn:1');

    expect(send).toHaveBeenCalledTimes(1); // never fetched page 2 -- already had a positive answer
    expect(result).toBe(true);
  });
});

describe('createAwsBackupEvidenceCache', () => {
  it('(9) deduplicates repeated lookups for the same ARN within one run', async () => {
    const send = jest.fn().mockResolvedValue({ RecoveryPoints: [recoveryPoint('COMPLETED')] });
    const client = withMockedSend(send);
    const check = createAwsBackupEvidenceCache(client);

    const [a, b, c] = await Promise.all([check('arn:shared'), check('arn:shared'), check('arn:shared')]);

    expect(send).toHaveBeenCalledTimes(1);
    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(c).toBe(true);
  });

  it('(10) different ARNs are checked independently, not deduplicated together', async () => {
    const send = jest.fn().mockImplementation(async (command: any) => {
      return command.input.ResourceArn === 'arn:a'
        ? { RecoveryPoints: [recoveryPoint('COMPLETED')] }
        : { RecoveryPoints: [] };
    });
    const client = withMockedSend(send);
    const check = createAwsBackupEvidenceCache(client);

    const [a, b] = await Promise.all([check('arn:a'), check('arn:b')]);

    expect(send).toHaveBeenCalledTimes(2);
    expect(a).toBe(true);
    expect(b).toBe(false);
  });
});

describe('checkEBSBackupCoverage', () => {
  it('(11) true when the volume itself has direct qualifying protection', async () => {
    const check = jest.fn().mockImplementation(async (arn: string) => (arn === 'arn:volume' ? true : false));

    const result = await checkEBSBackupCoverage(check, 'arn:volume', 'arn:instance');

    expect(result).toBe(true);
  });

  it('(12) true when protected only through the parent EC2 instance, not the volume directly', async () => {
    const check = jest.fn().mockImplementation(async (arn: string) => (arn === 'arn:instance' ? true : false));

    const result = await checkEBSBackupCoverage(check, 'arn:volume', 'arn:instance');

    expect(result).toBe(true);
    expect(check).toHaveBeenCalledWith('arn:volume');
    expect(check).toHaveBeenCalledWith('arn:instance');
  });

  it('(13) false only when both the volume and its parent instance are confirmed with no qualifying evidence', async () => {
    const check = jest.fn().mockResolvedValue(false);

    const result = await checkEBSBackupCoverage(check, 'arn:volume', 'arn:instance');

    expect(result).toBe(false);
  });

  it('(14) does not check a parent instance when the volume is unattached (null parent ARN)', async () => {
    const check = jest.fn().mockResolvedValue(false);

    const result = await checkEBSBackupCoverage(check, 'arn:volume', null);

    expect(result).toBe(false);
    expect(check).toHaveBeenCalledTimes(1);
    expect(check).toHaveBeenCalledWith('arn:volume');
  });

  it('(15) unknown (null) if the volume check fails, even when the parent instance is confirmed false -- a confirmed-false parent does not rule out unconfirmed volume-level coverage', async () => {
    const check = jest.fn().mockImplementation(async (arn: string) => (arn === 'arn:volume' ? null : false));

    const result = await checkEBSBackupCoverage(check, 'arn:volume', 'arn:instance');

    expect(result).toBeNull();
  });

  it('(16) unknown (null) if the volume is confirmed false but the parent instance check fails', async () => {
    const check = jest.fn().mockImplementation(async (arn: string) => (arn === 'arn:volume' ? false : null));

    const result = await checkEBSBackupCoverage(check, 'arn:volume', 'arn:instance');

    expect(result).toBeNull();
  });

  it('(17) does not call the parent-instance check at all once the volume itself already confirms true (short-circuit)', async () => {
    const check = jest.fn().mockResolvedValue(true);

    await checkEBSBackupCoverage(check, 'arn:volume', 'arn:instance');

    expect(check).toHaveBeenCalledTimes(1);
  });
});
