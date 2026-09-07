import { S3Client } from '@aws-sdk/client-s3';
import { getBucketLifecycleStatus, hasOnlyNonExpiringRules } from '../s3-lifecycle.util';

function withMockedSend<T extends { send: (...args: any[]) => any }>(client: T, send: jest.Mock): T {
  (client as any).send = send;
  return client;
}

describe('getBucketLifecycleStatus', () => {
  it('returns has_lifecycle_rules with only Enabled rules counted', async () => {
    const send = jest.fn().mockResolvedValueOnce({
      Rules: [
        { Status: 'Enabled', ID: 'a', Expiration: { Days: 30 } },
        { Status: 'Disabled', ID: 'b', Expiration: { Days: 30 } },
      ],
    });
    const s3Client = withMockedSend(new S3Client({ region: 'us-east-1' }), send);

    const result = await getBucketLifecycleStatus(s3Client, 'bucket-1');

    expect(result).toEqual({
      state: 'has_lifecycle_rules',
      enabledRuleCount: 1,
      rules: [{ Status: 'Enabled', ID: 'a', Expiration: { Days: 30 } }],
    });
  });

  it('returns no_lifecycle_configuration when AWS returns a configuration with zero enabled rules', async () => {
    const send = jest.fn().mockResolvedValueOnce({ Rules: [{ Status: 'Disabled', ID: 'a' }] });
    const s3Client = withMockedSend(new S3Client({ region: 'us-east-1' }), send);

    const result = await getBucketLifecycleStatus(s3Client, 'bucket-1');

    expect(result).toEqual({ state: 'no_lifecycle_configuration' });
  });

  it('returns no_lifecycle_configuration on the documented NoSuchLifecycleConfiguration error', async () => {
    const send = jest.fn().mockRejectedValueOnce({ name: 'NoSuchLifecycleConfiguration' });
    const s3Client = withMockedSend(new S3Client({ region: 'us-east-1' }), send);

    const result = await getBucketLifecycleStatus(s3Client, 'bucket-1');

    expect(result).toEqual({ state: 'no_lifecycle_configuration' });
  });

  it('returns unavailable (never no_lifecycle_configuration) on AccessDenied', async () => {
    const send = jest.fn().mockRejectedValueOnce({ name: 'AccessDenied', message: 'Access Denied' });
    const s3Client = withMockedSend(new S3Client({ region: 'us-east-1' }), send);

    const result = await getBucketLifecycleStatus(s3Client, 'bucket-1');

    expect(result.state).toBe('unavailable');
  });

  it('returns unavailable on a throttling/transient failure', async () => {
    const send = jest.fn().mockRejectedValueOnce({ name: 'ThrottlingException', message: 'Rate exceeded' });
    const s3Client = withMockedSend(new S3Client({ region: 'us-east-1' }), send);

    const result = await getBucketLifecycleStatus(s3Client, 'bucket-1');

    expect(result.state).toBe('unavailable');
  });
});

describe('hasOnlyNonExpiringRules', () => {
  it('is true when no rule has any expiring action', () => {
    expect(hasOnlyNonExpiringRules([{ Status: 'Enabled', Transitions: [{ Days: 30, StorageClass: 'STANDARD_IA' }] }])).toBe(true);
  });

  it('is false when at least one rule has an Expiration action', () => {
    expect(hasOnlyNonExpiringRules([{ Status: 'Enabled', Expiration: { Days: 90 } }])).toBe(false);
  });

  it('is false when at least one rule has a NoncurrentVersionExpiration action', () => {
    expect(hasOnlyNonExpiringRules([{ Status: 'Enabled', NoncurrentVersionExpiration: { NoncurrentDays: 30 } }])).toBe(false);
  });

  it('is false when at least one rule has an AbortIncompleteMultipartUpload action', () => {
    expect(hasOnlyNonExpiringRules([{ Status: 'Enabled', AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 } }])).toBe(false);
  });
});
