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
import { isAwsAssumeRoleFailed } from './aws-client-factory.service';

type AccountRef = Partial<AwsAccountRow>;

function identityOf(account: AccountRef): { identity: string; rowId: string; organizationId: string } | null {
  if (!account.id || !account.org_id || !account.role_arn) return null;
  return {
    identity: awsConnectionIdentity({ id: account.id, account_id: account.account_id ?? null, role_arn: account.role_arn, region: account.region ?? null }),
    rowId: account.id,
    organizationId: account.org_id,
  };
}

/** A successful scan AssumeRole. `iam` is the scan's IAM client, used only if the role was replaced. */
export async function recordScanAssumeSuccess(params: {
  organizationId: string;
  account: AccountRef;
  /** Absent on a source not built by createClients (a test stub): nothing is recorded. */
  attemptedAt: Date | undefined;
  roleUniqueId: string | null;
  iam?: IamSender;
}): Promise<void> {
  const ref = identityOf(params.account);
  if (!ref || ref.organizationId !== params.organizationId || !(params.attemptedAt instanceof Date)) return;
  const written = await recordAssumeOutcomeSoft(params.organizationId, ref.identity, ref.rowId, {
    attempt: { at: params.attemptedAt, result: 'ok' },
    roleUniqueId: params.roleUniqueId,
    source: 'scan',
  });
  if (!written.roleReplacedNow || !params.iam) return;
  try {
    const result = await compareRolePolicies({
      iam: params.iam,
      roleArn: params.account.role_arn!,
      accountId: params.account.account_id ?? '',
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
  const ref = identityOf(error.account);
  if (!ref || ref.organizationId !== organizationId || !(error.attemptedAt instanceof Date)) return;
  const result: AssumeResult = ASSUME_RESULT_FOR_KIND[error.kind];
  await recordAssumeOutcomeSoft(organizationId, ref.identity, ref.rowId, { attempt: { at: error.attemptedAt, result }, source: 'scan' });
}
