/**
 * The one way to find an organization's AWS account (multi-region plan M2,
 * S3a-1's repository part).
 *
 * Selection rule: collect the organization's ELIGIBLE accounts. Exactly one
 * is used. None fails closed as AWS_NOT_CONNECTED; more than one fails closed
 * as AWS_ACCOUNT_AMBIGUOUS. No caller picks by row order, LIMIT 1 or newest
 * first: until S3a lifts it, a second eligible account is an error, never a
 * guess.
 *
 * Eligible means status = 'active', the only status the connect flow writes
 * (POST /api/aws/accounts, routes/aws.routes.ts:254-256). It is the rule the
 * cost, remediation, CloudWatch, onboarding and cron readers already applied
 * (aws-cost.service.ts:397, remediation.service.ts:310,
 * cloudwatch.service.ts:684 and :2192, onboarding.service.ts:468,
 * resourceDiscovery.job.ts:251); the client factory, AI chat, Services page
 * and readiness readers read any status before M2.
 *
 * aws_accounts has no RLS (S3a audit §1.1): every query here filters org_id
 * explicitly.
 */

/** The only aws_accounts.status an account is used with. */
export const ELIGIBLE_AWS_ACCOUNT_STATUS = 'active';

export const AWS_NOT_CONNECTED = 'AWS_NOT_CONNECTED';
export const AWS_ACCOUNT_AMBIGUOUS = 'AWS_ACCOUNT_AMBIGUOUS';

/** What a caller is told, with HTTP 409, when its organization has more than one eligible account. */
export const AWS_ACCOUNT_AMBIGUOUS_MESSAGE = 'Multiple AWS accounts are not yet supported.';

export interface AwsAccountRow {
  id: string;
  org_id: string;
  account_id: string | null;
  role_arn: string;
  external_id: string | null;
  region: string | null;
  nickname: string | null;
  status: string | null;
  connected_at: Date | null;
}

/** A pool, a pool client, or the ambient request client. */
export interface AwsAccountsQueryable {
  query(text: string, values?: unknown[]): Promise<{ rows: any[] }>;
}

/** The organization has no eligible AWS account. */
export class AwsAccountNotConnectedError extends Error {
  readonly code = AWS_NOT_CONNECTED;

  constructor(organizationId: string) {
    super(`${AWS_NOT_CONNECTED}: org ${organizationId} has not connected an AWS account (no eligible AWS account)`);
    this.name = 'AwsAccountNotConnectedError';
  }
}

/** The organization has more than one eligible AWS account, which nothing supports yet. */
export class AwsAccountAmbiguousError extends Error {
  readonly code = AWS_ACCOUNT_AMBIGUOUS;

  constructor(organizationId: string, count: number) {
    super(`${AWS_ACCOUNT_AMBIGUOUS}: org ${organizationId} has ${count} eligible AWS accounts; multiple AWS accounts are not yet supported`);
    this.name = 'AwsAccountAmbiguousError';
  }
}

export function isAwsAccountAmbiguous(err: unknown): err is AwsAccountAmbiguousError {
  return err instanceof AwsAccountAmbiguousError;
}

/** The region an account with no recorded region is scanned in. */
export const DEFAULT_HOME_REGION = 'us-east-1';

/**
 * The account's home region, the one region discovery scans: its recorded
 * region, or DEFAULT_HOME_REGION when none is recorded. The client factory
 * builds the scan's clients in it, and readers that report the scanned region
 * use the same rule.
 */
export function homeRegionOf(account: Pick<AwsAccountRow, 'region'>): string {
  return account.region ?? DEFAULT_HOME_REGION;
}

/** The eligibility predicate, in SQL. A NULL status is not eligible. */
const ELIGIBLE = `status = '${ELIGIBLE_AWS_ACCOUNT_STATUS}'`;

const ACCOUNT_COLUMNS = 'id, org_id, account_id, role_arn, external_id, region, nickname, status, connected_at';

/**
 * The organization's one eligible account, or null when it has none. Throws
 * AwsAccountAmbiguousError when it has more than one.
 */
export async function findEligibleAwsAccount(db: AwsAccountsQueryable, organizationId: string): Promise<AwsAccountRow | null> {
  const { rows } = await db.query(
    `SELECT ${ACCOUNT_COLUMNS} FROM aws_accounts WHERE org_id = $1 AND ${ELIGIBLE}`,
    [organizationId]
  );
  return selectOne(organizationId, rows);
}

/** The selection rule itself: exactly one eligible account, none, or a refusal. */
function selectOne(organizationId: string, eligible: AwsAccountRow[]): AwsAccountRow | null {
  if (eligible.length > 1) throw new AwsAccountAmbiguousError(organizationId, eligible.length);
  return eligible[0] ?? null;
}

/**
 * The organization's one eligible account. Throws AwsAccountNotConnectedError
 * when it has none and AwsAccountAmbiguousError when it has more than one.
 */
export async function requireEligibleAwsAccount(db: AwsAccountsQueryable, organizationId: string): Promise<AwsAccountRow> {
  const account = await findEligibleAwsAccount(db, organizationId);
  if (!account) throw new AwsAccountNotConnectedError(organizationId);
  return account;
}

/**
 * How many eligible accounts the organization has. Selects none of them, so
 * it does not fail on more than one.
 */
export async function countEligibleAwsAccounts(db: AwsAccountsQueryable, organizationId: string): Promise<number> {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS eligible FROM aws_accounts WHERE org_id = $1 AND ${ELIGIBLE}`,
    [organizationId]
  );
  return rows[0].eligible;
}

/**
 * Whether the organization has at least one eligible account. Selects none of
 * them, so it does not fail on more than one.
 */
export async function hasEligibleAwsAccount(db: AwsAccountsQueryable, organizationId: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT id FROM aws_accounts WHERE org_id = $1 AND ${ELIGIBLE}`,
    [organizationId]
  );
  return rows.length > 0;
}

/**
 * The organization's one eligible account (the same rule as
 * findEligibleAwsAccount()) and, in the same read, the statuses of its rows
 * that are not eligible, for reporting why nothing was selected. Throws
 * AwsAccountAmbiguousError when it has more than one eligible account.
 */
export async function readAwsAccountConnection(
  db: AwsAccountsQueryable,
  organizationId: string
): Promise<{ account: AwsAccountRow | null; ineligibleStatuses: Array<string | null> }> {
  const { rows } = await db.query(`SELECT ${ACCOUNT_COLUMNS} FROM aws_accounts WHERE org_id = $1`, [organizationId]);
  const eligible = rows.filter((row: AwsAccountRow) => row.status === ELIGIBLE_AWS_ACCOUNT_STATUS);
  const ineligibleStatuses = rows
    .filter((row: AwsAccountRow) => row.status !== ELIGIBLE_AWS_ACCOUNT_STATUS)
    .map((row: AwsAccountRow) => row.status ?? null)
    .sort((a: string | null, b: string | null) => (a === b ? 0 : a === null ? -1 : b === null ? 1 : a < b ? -1 : 1));
  return { account: selectOne(organizationId, eligible), ineligibleStatuses };
}
