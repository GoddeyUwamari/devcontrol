/**
 * Conservative reconciliation for AWS Resource Explorer-based discovery (Phase 2B).
 *
 * A resource is marked terminated only after MISSING_SCAN_THRESHOLD consecutive
 * discovery scans where the relevant discovery source *succeeded* and genuinely
 * did not return the resource's ARN. This is the fix for the long-standing gap
 * where discovery was purely additive and stale/deleted resources sat in
 * aws_resources indefinitely (see backlog: EC2/RDS rows outliving the real
 * AWS resources by months).
 *
 * The critical invariant: a failed/errored discovery call (timeout, throttling,
 * permission error, exception of any kind) is "no data this cycle", never
 * evidence of absence. Callers must not invoke `reconcile()` at all for a
 * failed source — see awsResourceDiscovery.ts, which only calls this when the
 * relevant discovery step succeeded.
 *
 * `reconcile()` is scoped by `resourceTypes` because there isn't one single
 * source of truth for "is this resource still there" — Resource Explorer's
 * single-region Search covers most types, but S3 (account-wide ListBuckets)
 * and CloudFront (us-east-1-pinned ListDistributions) have their own dedicated
 * discovery calls that are more authoritative for their type than a
 * single-region Resource Explorer search would be (see resourceExplorer.service.ts's
 * OWN_DISCOVERY_CFN_TYPES doc comment). awsResourceDiscovery.ts calls this
 * multiple times per cycle, once per independent presence source, each scoped
 * to only the resource type(s) that source actually speaks for — so a failure
 * in one source can never be papered over by another source's unrelated data,
 * and a resource type is never touched by two conflicting presence signals in
 * the same cycle.
 *
 * `region` is nullable because S3 and CloudFront rows aren't reconciled per the
 * org's single configured region — S3 buckets can each live in a different
 * region than the org's `aws_accounts.region`, and CloudFront rows are always
 * stored with region='global'. Passing `null` reconciles matching resource
 * types across all regions, using the caller's presentArns as the complete
 * account-wide truth for those types.
 */
import { PoolClient } from 'pg';
import { ResourceType } from '../types/aws-resources.types';

/**
 * Discovery runs every 6 hours (resourceDiscovery.job.ts). 2 consecutive absences
 * spans ~12 hours of confirmed absence — long enough to ride out a transient
 * Resource Explorer hiccup or regional throttling on any single scan, short enough
 * to catch a genuine deletion within about half a day.
 */
export const MISSING_SCAN_THRESHOLD = 2;

/**
 * Wildcards the account-id segment of a standard ARN (arn:partition:service:region:account:...)
 * when it's a real 12-digit account id or already a `*` placeholder — otherwise returns the ARN
 * unchanged (e.g. S3's arn:aws:s3:::bucket has no account segment to normalize).
 *
 * Exists because discoverEC2Instances (untouched by this phase — see aws-resources.types.ts
 * consumers in awsResourceDiscovery.ts) builds EC2 resource_arn with a literal '*' in place of
 * the account id, since DescribeInstances doesn't return it. Resource Explorer's Search results
 * always carry the real account id. Without normalizing both sides before comparing, every EC2
 * row — including genuinely-present instances — would look "absent" to reconciliation and
 * eventually get wrongly terminated. Applying the same normalization to both sides is harmless
 * for every other resource type, whose stored ARNs already carry the real account id.
 */
function normalizeArn(arn: string): string {
  return arn.replace(/^(arn:[^:]*:[^:]*:[^:]*:)(\d{12}|\*)(:.*)$/, '$1*$3');
}

export interface ReconciliationResult {
  resetCount: number;
  incrementedCount: number;
  terminatedArns: string[];
}

export class ResourceReconciliationService {
  /**
   * `presentArns` must come from a discovery call that succeeded — see the module
   * doc comment. Only rows whose `resource_type` is in `resourceTypes` are eligible
   * to be touched by this call. `region: null` reconciles matching types across all
   * regions (for account-wide/global sources like S3 and CloudFront); a specific
   * region scopes to exactly that region (for the Resource Explorer single-region
   * search covering everything else).
   */
  async reconcile(
    client: PoolClient,
    organizationId: string,
    region: string | null,
    presentArns: Set<string>,
    resourceTypes: ResourceType[]
  ): Promise<ReconciliationResult> {
    const presentArray = Array.from(presentArns, normalizeArn);
    // Both sides of the comparison run through the identical account-id wildcard —
    // see normalizeArn's doc comment.
    const normalizedArnColumn = `regexp_replace(resource_arn, '^(arn:[^:]*:[^:]*:[^:]*:)(\\d{12}|\\*)(:.*)$', '\\1*\\3')`;

    const resetResult = await client.query(
      `UPDATE aws_resources
       SET missing_scan_count = 0, updated_at = NOW()
       WHERE organization_id = $1
         AND ($2::text IS NULL OR region = $2)
         AND resource_type = ANY($3::text[])
         AND status != 'terminated'
         AND missing_scan_count != 0
         AND ${normalizedArnColumn} = ANY($4::text[])`,
      [organizationId, region, resourceTypes, presentArray]
    );

    const incrementResult = await client.query(
      `UPDATE aws_resources
       SET missing_scan_count = missing_scan_count + 1,
           status = CASE WHEN missing_scan_count + 1 >= $5 THEN 'terminated' ELSE status END,
           updated_at = NOW()
       WHERE organization_id = $1
         AND ($2::text IS NULL OR region = $2)
         AND resource_type = ANY($3::text[])
         AND status != 'terminated'
         AND NOT (${normalizedArnColumn} = ANY($4::text[]))
       RETURNING resource_arn, missing_scan_count, status`,
      [organizationId, region, resourceTypes, presentArray, MISSING_SCAN_THRESHOLD]
    );

    const terminatedArns = incrementResult.rows
      .filter((row) => row.status === 'terminated')
      .map((row) => row.resource_arn);

    return {
      resetCount: resetResult.rowCount ?? 0,
      incrementedCount: incrementResult.rowCount ?? 0,
      terminatedArns,
    };
  }
}
