/**
 * Phase 2, rule 3: s3_lifecycle. Coverage for
 * CostOptimizationService.detectS3LifecycleOptimization() -- the critical
 * property under test is that an AWS API failure is never coerced into "no
 * lifecycle rules", and that missing size data is never treated as zero.
 */
import { S3Client } from '@aws-sdk/client-s3';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import costOptimizationService from '../cost-optimization.service';
import { ISSUE_S3_LIFECYCLE_OPTIMIZATION } from '../../config/optimization-rules';

function withMockedSend<T extends { send: (...args: any[]) => any }>(client: T, send: jest.Mock): T {
  (client as any).send = send;
  return client;
}

const GB = 1024 * 1024 * 1024;

describe('CostOptimizationService.detectS3LifecycleOptimization (s3_lifecycle)', () => {
  it('flags a bucket with no lifecycle configuration and real size data, with a ceiling savings estimate', async () => {
    const s3Send = jest
      .fn()
      .mockResolvedValueOnce({ Buckets: [{ Name: 'no-lifecycle-bucket' }] }) // ListBuckets
      .mockRejectedValueOnce({ name: 'NoSuchLifecycleConfiguration' }); // GetBucketLifecycleConfiguration
    const s3Client = withMockedSend(new S3Client({ region: 'us-east-1' }), s3Send);

    const cwSend = jest.fn().mockResolvedValueOnce({
      Datapoints: [{ Average: 100 * GB, Timestamp: new Date() }],
    });
    const cwClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), cwSend);

    const result = await (costOptimizationService as any).detectS3LifecycleOptimization(s3Client, cwClient);

    expect(result.success).toBe(true);
    expect(result.issues).toHaveLength(1);
    const [issue] = result.issues;
    expect(issue.resourceId).toBe('no-lifecycle-bucket');
    expect(issue.issue).toBe(ISSUE_S3_LIFECYCLE_OPTIMIZATION);
    expect(issue.metadata.lifecycle_state).toBe('no_lifecycle_configuration');
    // 100GB * (0.023 - 0.0125) = 1.05
    expect(issue.potentialSavings).toBeCloseTo(100 * (0.023 - 0.0125));
  });

  it('flags a bucket whose enabled rules only transition storage class and never expire anything', async () => {
    const s3Send = jest
      .fn()
      .mockResolvedValueOnce({ Buckets: [{ Name: 'transition-only-bucket' }] })
      .mockResolvedValueOnce({
        Rules: [{ Status: 'Enabled', ID: 'r1', Transitions: [{ Days: 30, StorageClass: 'STANDARD_IA' }] }],
      });
    const s3Client = withMockedSend(new S3Client({ region: 'us-east-1' }), s3Send);

    const cwSend = jest.fn().mockResolvedValueOnce({
      Datapoints: [{ Average: 50 * GB, Timestamp: new Date() }],
    });
    const cwClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), cwSend);

    const result = await (costOptimizationService as any).detectS3LifecycleOptimization(s3Client, cwClient);

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].metadata.lifecycle_state).toBe('incomplete_lifecycle_rules');
    expect(result.issues[0].metadata.enabled_rule_count).toBe(1);
  });

  it('does NOT flag a bucket whose enabled rule has a real expiration action', async () => {
    const s3Send = jest
      .fn()
      .mockResolvedValueOnce({ Buckets: [{ Name: 'sufficient-bucket' }] })
      .mockResolvedValueOnce({
        Rules: [{ Status: 'Enabled', ID: 'r1', Expiration: { Days: 365 } }],
      });
    const s3Client = withMockedSend(new S3Client({ region: 'us-east-1' }), s3Send);
    const cwClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), jest.fn());

    const result = await (costOptimizationService as any).detectS3LifecycleOptimization(s3Client, cwClient);

    expect(result.issues).toHaveLength(0);
  });

  it('does NOT flag a bucket whose lifecycle check is unavailable (AccessDenied) -- never coerced to "no rules"', async () => {
    const s3Send = jest
      .fn()
      .mockResolvedValueOnce({ Buckets: [{ Name: 'denied-bucket' }] })
      .mockRejectedValueOnce({ name: 'AccessDenied', message: 'Access Denied' });
    const s3Client = withMockedSend(new S3Client({ region: 'us-east-1' }), s3Send);
    const cwClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), jest.fn());

    const result = await (costOptimizationService as any).detectS3LifecycleOptimization(s3Client, cwClient);

    expect(result.success).toBe(true); // one bucket's failure doesn't fail the whole detector
    expect(result.issues).toHaveLength(0);
  });

  it('does NOT flag a bucket with no lifecycle configuration when size data is unavailable (no datapoints) -- never treated as zero', async () => {
    const s3Send = jest
      .fn()
      .mockResolvedValueOnce({ Buckets: [{ Name: 'no-size-data-bucket' }] })
      .mockRejectedValueOnce({ name: 'NoSuchLifecycleConfiguration' });
    const s3Client = withMockedSend(new S3Client({ region: 'us-east-1' }), s3Send);

    const cwSend = jest.fn().mockResolvedValueOnce({ Datapoints: [] });
    const cwClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), cwSend);

    const result = await (costOptimizationService as any).detectS3LifecycleOptimization(s3Client, cwClient);

    expect(result.issues).toHaveLength(0);
  });

  it('does NOT flag a genuinely empty bucket (real 0-byte size)', async () => {
    const s3Send = jest
      .fn()
      .mockResolvedValueOnce({ Buckets: [{ Name: 'empty-bucket' }] })
      .mockRejectedValueOnce({ name: 'NoSuchLifecycleConfiguration' });
    const s3Client = withMockedSend(new S3Client({ region: 'us-east-1' }), s3Send);

    const cwSend = jest.fn().mockResolvedValueOnce({ Datapoints: [{ Average: 0, Timestamp: new Date() }] });
    const cwClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), cwSend);

    const result = await (costOptimizationService as any).detectS3LifecycleOptimization(s3Client, cwClient);

    expect(result.issues).toHaveLength(0);
  });

  it('an AWS ListBuckets failure returns success: false, never a false "nothing found"', async () => {
    const s3Send = jest.fn().mockRejectedValueOnce(new Error('ServiceUnavailable'));
    const s3Client = withMockedSend(new S3Client({ region: 'us-east-1' }), s3Send);
    const cwClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), jest.fn());

    const result = await (costOptimizationService as any).detectS3LifecycleOptimization(s3Client, cwClient);

    expect(result).toEqual({ success: false, issues: [] });
  });

  it('picks the most recent CloudWatch datapoint when multiple are returned', async () => {
    const s3Send = jest
      .fn()
      .mockResolvedValueOnce({ Buckets: [{ Name: 'multi-datapoint-bucket' }] })
      .mockRejectedValueOnce({ name: 'NoSuchLifecycleConfiguration' });
    const s3Client = withMockedSend(new S3Client({ region: 'us-east-1' }), s3Send);

    const cwSend = jest.fn().mockResolvedValueOnce({
      Datapoints: [
        { Average: 10 * GB, Timestamp: new Date('2026-09-01T00:00:00Z') },
        { Average: 200 * GB, Timestamp: new Date('2026-09-04T00:00:00Z') }, // most recent
      ],
    });
    const cwClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), cwSend);

    const result = await (costOptimizationService as any).detectS3LifecycleOptimization(s3Client, cwClient);

    expect(result.issues[0].metadata.standard_storage_gb).toBeCloseTo(200);
  });
});
