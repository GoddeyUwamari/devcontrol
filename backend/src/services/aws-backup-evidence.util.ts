/**
 * Security Truthfulness — issue #41: authoritative AWS Backup evidence for the
 * `has_backup` claim on EC2 instances and EBS volumes.
 *
 * The existing product claim (complianceScanner.ts: "does not have regular snapshots",
 * "must have automated backups") means a recurring, working backup mechanism -- not
 * merely that a snapshot happens to exist somewhere. Bare EBS snapshot existence and DLM
 * policy presence were both evaluated and explicitly rejected as the primary evidence
 * source (see the #41 scoping report) because neither proves the claim: a snapshot can be
 * a one-off manual action with no ongoing protection, and a DLM policy can be
 * misconfigured or never have successfully run. AWS Backup's recovery-point evidence is
 * the only source that proves both "a recurring managed mechanism targets this resource"
 * and "it has actually produced a real, usable result" -- a completed or available
 * recovery point cannot exist without both being true.
 *
 * Three-state result, never a fallback to a different evidence source:
 *   true  -- at least one COMPLETED/AVAILABLE recovery point exists for this ARN
 *   false -- the lookup succeeded and found no qualifying recovery point
 *   null  -- the lookup could not be completed (AccessDenied, any other API failure,
 *            throttling) -- never coerced to false. If AWS Backup is unavailable for a
 *            resource, the answer is unknown, not "no backup".
 *
 * AWS Backup has no multi-ARN batch lookup API (ListRecoveryPointsByResource and
 * DescribeProtectedResource both take exactly one ResourceArn) -- per-resource calls are
 * an inherent constraint of this API, not an oversight here. createAwsBackupEvidenceCache()
 * deduplicates repeated lookups for the same ARN within one discovery run instead (e.g. an
 * EC2 instance's own has_backup check and every attached EBS volume's fallback check to
 * that same instance ARN share one AWS call, not one each).
 */
import { BackupClient, ListRecoveryPointsByResourceCommand } from '@aws-sdk/client-backup';

// AWS Backup's RecoveryPointStatus values that represent a real, usable backup -- see
// RecoveryPointStatus in @aws-sdk/client-backup: AVAILABLE and COMPLETED are the only
// states that represent a finished, restorable recovery point. CREATING/PARTIAL/STOPPED
// are in-progress or incomplete; DELETING/EXPIRED are gone. None of those qualify as
// evidence of working backup coverage.
const QUALIFYING_RECOVERY_POINT_STATUSES = new Set(['AVAILABLE', 'COMPLETED']);

export type BackupEvidenceResult = boolean | null;

/**
 * Checks one resource ARN for qualifying AWS Backup recovery-point evidence. Paginates
 * via NextToken. Never throws -- every failure path (including AccessDenied) resolves to
 * `null`, logged distinctly so a missing IAM permission is diagnosable separately from a
 * transient AWS-side failure, though callers never need to distinguish them themselves.
 */
export async function checkAwsBackupRecoveryPoints(
  backupClient: BackupClient,
  resourceArn: string
): Promise<BackupEvidenceResult> {
  try {
    let nextToken: string | undefined;
    do {
      const response = await backupClient.send(
        new ListRecoveryPointsByResourceCommand({ ResourceArn: resourceArn, NextToken: nextToken })
      );
      const points = response.RecoveryPoints ?? [];
      if (points.some((p) => p.Status && QUALIFYING_RECOVERY_POINT_STATUSES.has(p.Status))) {
        return true;
      }
      nextToken = response.NextToken;
    } while (nextToken);
    return false;
  } catch (err: any) {
    const isAccessDenied = err?.name === 'AccessDeniedException' || err?.$metadata?.httpStatusCode === 403;
    if (isAccessDenied) {
      console.error(`[AWS Backup] Access denied checking recovery points for ${resourceArn} -- IAM permission likely missing:`, err?.message || err);
    } else {
      console.error(`[AWS Backup] Failed to check recovery points for ${resourceArn}:`, err?.message || err);
    }
    return null;
  }
}

/**
 * Per-discovery-run cache/dedup wrapper around checkAwsBackupRecoveryPoints() -- the same
 * ARN is never looked up twice in one run, regardless of how many callers ask for it
 * (an EC2 instance's own check, plus every attached EBS volume's parent-instance
 * fallback check, all share one in-flight/settled promise per ARN).
 */
export function createAwsBackupEvidenceCache(backupClient: BackupClient) {
  const cache = new Map<string, Promise<BackupEvidenceResult>>();
  return function checkWithCache(resourceArn: string): Promise<BackupEvidenceResult> {
    let pending = cache.get(resourceArn);
    if (!pending) {
      pending = checkAwsBackupRecoveryPoints(backupClient, resourceArn);
      cache.set(resourceArn, pending);
    }
    return pending;
  };
}

/**
 * EBS-specific: a volume counts as backed up if EITHER its own ARN has qualifying
 * evidence, OR (when attached to an instance) its parent EC2 instance's ARN does. AWS
 * Backup can protect an EC2 instance as a whole -- implicitly covering every attached
 * volume -- without creating a separate per-volume protected-resource entry. Checking
 * only the volume's own ARN would under-report that valid, real coverage.
 *
 * Combining rule: true if either check is true. If neither is true and either check
 * returned null (unknown), the combined result is null -- a confirmed-false volume check
 * does not rule out unconfirmed parent-instance coverage, so this only resolves to false
 * when BOTH checks positively confirm no qualifying evidence.
 */
export async function checkEBSBackupCoverage(
  checkWithCache: (resourceArn: string) => Promise<BackupEvidenceResult>,
  volumeArn: string,
  parentInstanceArn: string | null
): Promise<BackupEvidenceResult> {
  const volumeResult = await checkWithCache(volumeArn);
  if (volumeResult === true) return true;
  if (!parentInstanceArn) return volumeResult;

  const instanceResult = await checkWithCache(parentInstanceArn);
  if (instanceResult === true) return true;

  if (volumeResult === null || instanceResult === null) return null;
  return false;
}
