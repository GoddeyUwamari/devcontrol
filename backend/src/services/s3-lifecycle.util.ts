/**
 * Shared, single-source-of-truth read of a bucket's lifecycle configuration.
 * Used by both awsResourceDiscovery.ts (to store honest inventory metadata,
 * replacing the old `lifecycle_rules: 0` placeholder that was never actually
 * queried from AWS) and cost-optimization.service.ts's s3_lifecycle detector
 * (to decide whether a recommendation is warranted). A single implementation
 * means the two can never silently disagree about what "has a lifecycle
 * policy" means.
 *
 * The critical property this preserves: an AWS API failure (AccessDenied,
 * throttling, network error -- anything other than the documented
 * NoSuchLifecycleConfiguration "this bucket genuinely has none" response)
 * must never be interpreted as "no lifecycle rules". Getting that wrong would
 * turn a permissions problem into a false "this bucket is unoptimized"
 * finding.
 */
import { S3Client, GetBucketLifecycleConfigurationCommand, LifecycleRule } from '@aws-sdk/client-s3';

export type BucketLifecycleStatus =
  | { state: 'no_lifecycle_configuration' }
  | { state: 'has_lifecycle_rules'; enabledRuleCount: number; rules: LifecycleRule[] }
  | { state: 'unavailable'; reason: string };

export async function getBucketLifecycleStatus(
  s3Client: S3Client,
  bucketName: string
): Promise<BucketLifecycleStatus> {
  try {
    const response = await s3Client.send(
      new GetBucketLifecycleConfigurationCommand({ Bucket: bucketName })
    );
    const rules = response.Rules || [];
    const enabledRules = rules.filter((rule) => rule.Status === 'Enabled');

    if (enabledRules.length === 0) {
      // AWS returned a configuration, but it has zero enabled rules -- same
      // practical effect as no configuration at all, so it's classified the
      // same way rather than as a separate, more confusing state.
      return { state: 'no_lifecycle_configuration' };
    }

    return { state: 'has_lifecycle_rules', enabledRuleCount: enabledRules.length, rules: enabledRules };
  } catch (error: any) {
    // NoSuchLifecycleConfiguration is AWS's documented response for "this
    // bucket genuinely has no lifecycle policy" -- the one error case that IS
    // a real, confirmed finding rather than an unavailable one.
    if (error?.name === 'NoSuchLifecycleConfiguration' || error?.Code === 'NoSuchLifecycleConfiguration') {
      return { state: 'no_lifecycle_configuration' };
    }

    // Everything else (AccessDenied, throttling, network failure, etc.) is
    // "we don't know" -- never coerced into "no lifecycle configuration".
    return { state: 'unavailable', reason: error?.message || error?.name || 'Unknown error' };
  }
}

/**
 * A bucket's enabled rules exist but none of them actually reduce storage
 * cost over time (no Expiration, NoncurrentVersionExpiration, or
 * AbortIncompleteMultipartUpload action) -- e.g. transition-only rules that
 * move objects between storage classes but never expire anything. Derived
 * entirely from the real rule actions already fetched above; not a guess
 * about object age or content.
 */
export function hasOnlyNonExpiringRules(rules: LifecycleRule[]): boolean {
  return rules.every(
    (rule) =>
      !rule.Expiration &&
      !rule.NoncurrentVersionExpiration &&
      !rule.AbortIncompleteMultipartUpload
  );
}
