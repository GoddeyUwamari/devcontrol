/**
 * Records the outcome of a scan's AssumeRole as the connection's health (AWS
 * connect PR D1, connect-d1-step1.md §1.2-1.4): called by ScanContext for the
 * scan's first AssumeRole and for every mid-scan credential refresh. Nothing
 * else records health from a scan (D1-D3: cost, observability, AI and stats
 * calls never do).
 *
 * Never throws and never delays a scan beyond its own database write: a
 * failure is logged by name only (aws-connection-checks.repository.ts).
 *
 * A failure on DevControl's own side (PlatformAwsCredentialsUnavailableError)
 * carries no account, changes no state and is not recorded.
 *
 * When a successful AssumeRole first returns a role ID different from the one
 * recorded, the role at this ARN was replaced: the role's policies are
 * compared once (D1-D7) with the scan's own IAM client.
 */
import { awsConnectionIdentity, type AwsAccountRow } from '../repositories/aws-accounts.repository';
import {
  logChecksWriteFailure,
  recordAssumeOutcomeSoft,
  savePolicyResult,
} from '../repositories/aws-connection-checks.repository';
import { ASSUME_RESULT_FOR_KIND, type AssumeResult } from './connection-health';
import { compareRolePolicies, type IamSender } from './connect-policy-compare';
import { parseAccountIdFromArn } from '../utils/awsAccountId';
import { assumeFailureTargetOf, isAwsAssumeRoleFailed } from './aws-client-factory.service';

type AccountRef = Partial<AwsAccountRow>;

function identityOf(account: AccountRef): { identity: string; rowId: string; organizationId: string } | null {
  if (!account.id || !account.org_id || !account.role_arn) return null;
  return {
    identity: awsConnectionIdentity({ id: account.id, account_id: account.account_id ?? null, role_arn: account.role_arn, region: account.region ?? null }),
    rowId: account.id,
    organizationId: account.org_id,
  };
}

/**
 * A successful scan AssumeRole. With `iam` (the scan's IAM client), a role
 * replacement this write detects is compared at once; without it the caller
 * compares later with compareAfterRoleReplacement (the mid-scan refresh does,
 * once its fresh credentials are in place). Either way at most once per
 * replacement: roleReplacedNow is true only for the write that first records it.
 */
export async function recordScanAssumeSuccess(params: {
  organizationId: string;
  account: AccountRef;
  /** Absent on a source not built by createClients (a test stub): nothing is recorded. */
  attemptedAt: Date | undefined;
  roleUniqueId: string | null;
  iam?: IamSender;
}): Promise<{ roleReplacedNow: boolean }> {
  const ref = identityOf(params.account);
  if (!ref || ref.organizationId !== params.organizationId || !(params.attemptedAt instanceof Date)) return { roleReplacedNow: false };
  const written = await recordAssumeOutcomeSoft(params.organizationId, ref.identity, ref.rowId, {
    attempt: { at: params.attemptedAt, result: 'ok' },
    roleUniqueId: params.roleUniqueId,
    source: 'scan',
  });
  if (written.roleReplacedNow && params.iam) {
    await compareAfterRoleReplacement({ organizationId: params.organizationId, account: params.account, iam: params.iam });
  }
  return { roleReplacedNow: written.roleReplacedNow };
}

/** The D1-D7 policy compare after a role replacement, saved as `role_replaced`. Never throws. */
export async function compareAfterRoleReplacement(params: { organizationId: string; account: AccountRef; iam: IamSender }): Promise<void> {
  const ref = identityOf(params.account);
  if (!ref || ref.organizationId !== params.organizationId) return;
  try {
    const result = await compareRolePolicies({
      iam: params.iam,
      roleArn: params.account.role_arn!,
      // The role's own account (the <ACCOUNT_ID> of the contract), as ScanContext.awsAccountId is.
      accountId: parseAccountIdFromArn(params.account.role_arn!) ?? '',
      context: `Scan org ${params.organizationId}`,
    });
    await savePolicyResult(params.organizationId, ref.identity, ref.rowId, { result, at: new Date(), trigger: 'role_replaced' });
  } catch (error: unknown) {
    logChecksWriteFailure('policy compare after role replacement', params.organizationId, error);
  }
}

/** A failed scan AssumeRole: recorded when it is the role's (AwsAssumeRoleFailedError), ignored otherwise. */
export async function recordScanAssumeFailure(organizationId: string, error: unknown): Promise<void> {
  if (!isAwsAssumeRoleFailed(error)) return;
  const target = assumeFailureTargetOf(error);
  if (!target || target.organizationId !== organizationId || !(error.attemptedAt instanceof Date)) return;
  const result: AssumeResult = ASSUME_RESULT_FOR_KIND[error.kind];
  await recordAssumeOutcomeSoft(organizationId, target.identity, target.rowId, { attempt: { at: error.attemptedAt, result }, source: 'scan' });
}
