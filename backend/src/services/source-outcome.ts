/**
 * How one presence source of a discovery scan fared (multi-region plan M4, plan §6.1).
 *
 * A source is one listing that speaks for some resource types or findings: the
 * Resource Explorer search, the EBS, S3 and CloudFront listings, the security-group
 * and IAM scans. Only a `complete` source authorizes a destructive statement for what
 * it speaks for: a termination, a missing_scan_count increment, a findings resolve.
 * Every other status means "no answer this cycle", never "gone":
 *
 *   truncated     the listing stopped at its page limit (or its own result cap)
 *   partial       part of it failed (the security-group and IAM scans)
 *   failed        a page or the listing failed
 *   denied        the role is not allowed to list it
 *   timed_out     a call ran past the call policy's time limit
 *   skipped_tier  not listed: the organization's tier does not include the type
 *
 * What a source did read is still real evidence and is still upserted.
 */
import { AwsCallTimeoutError, isAccessDeniedError } from '../utils/awsCallPolicy';

export type SourceStatus = 'complete' | 'truncated' | 'partial' | 'failed' | 'denied' | 'timed_out' | 'skipped_tier';

export interface SourceOutcome {
  source: string;
  status: SourceStatus;
}

/** The status of a source whose listing threw `error`. */
export function failedSourceStatus(error: unknown): SourceStatus {
  if (error instanceof AwsCallTimeoutError) return 'timed_out';
  if (isAccessDeniedError(error)) return 'denied';
  return 'failed';
}

/** Whether `outcome` lets the scan delete, terminate or resolve what the source speaks for. */
export function authorizesCleanup(outcome: SourceOutcome | undefined): boolean {
  return outcome?.status === 'complete';
}
