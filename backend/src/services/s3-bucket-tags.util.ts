/**
 * A bucket's tags, read from AWS.
 *
 * Three outcomes, kept apart:
 *   - a tag set                 the bucket's tags.
 *   - NoSuchTagSet              AWS's answer for a bucket with no tags: evidence of
 *                               zero tags, not a failure.
 *   - anything else             (AccessDenied, throttling, a network failure) the
 *                               tags are unknown. Never read as "no tags".
 *
 * GetBucketTagging is answered by the bucket's own region. A request sent anywhere
 * else is redirected, and S3 names the right region in the error; the read is then
 * repeated there, so a bucket outside the organization's home region is read like
 * any other instead of being recorded as unknown.
 */
import { S3Client, GetBucketTaggingCommand } from '@aws-sdk/client-s3';

export type BucketTags =
  | { state: 'observed'; tags: Record<string, string> }
  | { state: 'unavailable'; reason: string };

/** GetBucketLocation's LocationConstraint as a region: empty is us-east-1, and 'EU' is the old name of eu-west-1. */
export function regionFromLocationConstraint(constraint: string | undefined | null): string {
  if (!constraint) return 'us-east-1';
  return constraint === 'EU' ? 'eu-west-1' : constraint;
}

const WRONG_REGION_ERRORS = new Set(['PermanentRedirect', 'TemporaryRedirect', 'AuthorizationHeaderMalformed', 'IllegalLocationConstraintException']);

/** The region S3 says the bucket is in, when the error is a wrong-region answer that names one. */
function redirectedRegion(error: any): string | null {
  const status = error?.$metadata?.httpStatusCode;
  const wrongRegion = WRONG_REGION_ERRORS.has(error?.name) || WRONG_REGION_ERRORS.has(error?.Code) || status === 301 || status === 307;
  if (!wrongRegion) return null;
  const hinted = error?.$response?.headers?.['x-amz-bucket-region'] ?? error?.BucketRegion ?? error?.Region;
  return typeof hinted === 'string' && hinted.length > 0 ? hinted : null;
}

async function readTags(client: S3Client, bucketName: string): Promise<Record<string, string>> {
  const response = await client.send(new GetBucketTaggingCommand({ Bucket: bucketName }));
  const tags: Record<string, string> = {};
  for (const tag of response.TagSet ?? []) {
    // An empty value is still a tag the bucket has.
    if (tag.Key) tags[tag.Key] = tag.Value ?? '';
  }
  return tags;
}

/**
 * Reads a bucket's tags with a client for `region` (the bucket's own, as far as the
 * caller knows it), following one wrong-region answer to the region S3 names.
 */
export async function getBucketTags(
  clientForRegion: (region: string) => S3Client,
  bucketName: string,
  region: string
): Promise<BucketTags> {
  let attemptRegion = region;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return { state: 'observed', tags: await readTags(clientForRegion(attemptRegion), bucketName) };
    } catch (error: any) {
      if (error?.name === 'NoSuchTagSet' || error?.Code === 'NoSuchTagSet') return { state: 'observed', tags: {} };
      const elsewhere = redirectedRegion(error);
      if (attempt === 0 && elsewhere && elsewhere !== attemptRegion) {
        attemptRegion = elsewhere;
        continue;
      }
      return { state: 'unavailable', reason: error?.name || 'unknown error' };
    }
  }
  return { state: 'unavailable', reason: 'wrong region' };
}
