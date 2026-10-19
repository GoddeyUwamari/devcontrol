/**
 * The one account lookup (aws-accounts.repository.ts), against live Postgres.
 *
 * Policy under test:
 *   - Exactly one eligible (status 'active') account is used; none fails
 *     closed as AWS_NOT_CONNECTED, whatever ineligible rows exist.
 *   - Each organization only ever sees its own row (aws_accounts has no RLS:
 *     the lookup filters org_id itself).
 *   - Counting and existence checks count eligible rows only.
 *   - AWSClientFactory.createClients() goes through the lookup: a missing or
 *     ineligible account gets AWS_NOT_CONNECTED with no STS call.
 *
 * aws_accounts_org_id_key (UNIQUE org_id) keeps a second row out of the
 * table, so two eligible accounts are covered with a stub executor here and
 * per consumer in aws-account-selection-fail-closed.test.ts.
 *
 * Every ID, ARN and account ID here is a placeholder.
 */
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import * as platformSts from '../../services/platform-sts';
import { AWSClientFactory } from '../../services/aws-client-factory.service';
import { pool as appPool } from '../../config/database';
import { ensureSharedFixtureTable } from '../../routes/__tests__/shared-fixture-tables';
import {
  AwsAccountAmbiguousError,
  AwsAccountNotConnectedError,
  countEligibleAwsAccounts,
  findEligibleAwsAccount,
  hasEligibleAwsAccount,
  listIneligibleAwsAccountStatuses,
  requireEligibleAwsAccount,
} from '../aws-accounts.repository';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'platform_portal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});
const createdOrgIds: string[] = [];

/** An organization with one aws_accounts row of `status` (or none). */
async function orgWithAccount(status: string | null | 'none', region = 'eu-west-1'): Promise<string> {
  const orgId = randomUUID();
  createdOrgIds.push(orgId);
  if (status !== 'none') {
    await pool.query(
      `INSERT INTO aws_accounts (org_id, role_arn, account_id, external_id, region, connected_at, status)
       VALUES ($1, 'arn:aws:iam::123456789012:role/devcontrol-readonly', $2, 'external-id-1', $3, NOW(), $4)`,
      [orgId, `m2-${orgId}`.slice(0, 32), region, status]
    );
  }
  return orgId;
}

/** Whether this test database's aws_accounts.status column accepts NULL. */
async function statusIsNullable(): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT is_nullable FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = 'aws_accounts' AND column_name = 'status'`
  );
  return rows[0]?.is_nullable === 'YES';
}

beforeAll(async () => {
  await ensureSharedFixtureTable(pool, 'aws_accounts');
});

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await pool.query('DELETE FROM aws_accounts WHERE org_id = ANY($1)', [createdOrgIds]);
  await pool.end();
  await appPool.end();
});

describe('selection', () => {
  it('one eligible account: returned', async () => {
    const orgId = await orgWithAccount('active');

    const account = await requireEligibleAwsAccount(pool, orgId);

    expect(account).toMatchObject({ org_id: orgId, status: 'active', region: 'eu-west-1', external_id: 'external-id-1' });
    await expect(findEligibleAwsAccount(pool, orgId)).resolves.toMatchObject({ id: account.id });
  });

  it('no account at all: none, and requiring one fails closed as AWS_NOT_CONNECTED', async () => {
    const orgId = await orgWithAccount('none');

    await expect(findEligibleAwsAccount(pool, orgId)).resolves.toBeNull();
    const thrown = await requireEligibleAwsAccount(pool, orgId).catch((err: unknown) => err);
    expect(thrown).toBeInstanceOf(AwsAccountNotConnectedError);
    expect((thrown as Error).message).toBe(`AWS_NOT_CONNECTED: org ${orgId} has not connected an AWS account (no eligible AWS account)`);
    await expect(listIneligibleAwsAccountStatuses(pool, orgId)).resolves.toEqual([]);
  });

  it.each([['disconnected'], ['pending'], [null]])('an account with status %p is not eligible: fails closed', async (status) => {
    if (status === null && !(await statusIsNullable())) return;
    const orgId = await orgWithAccount(status);

    await expect(findEligibleAwsAccount(pool, orgId)).resolves.toBeNull();
    await expect(requireEligibleAwsAccount(pool, orgId)).rejects.toBeInstanceOf(AwsAccountNotConnectedError);
    await expect(hasEligibleAwsAccount(pool, orgId)).resolves.toBe(false);
    await expect(countEligibleAwsAccounts(pool, orgId)).resolves.toBe(0);
    await expect(listIneligibleAwsAccountStatuses(pool, orgId)).resolves.toEqual([status]);
  });

  it('two eligible accounts: fails closed as AWS_ACCOUNT_AMBIGUOUS, never one of them', async () => {
    const rows = [
      { id: 'a', org_id: 'org-two', role_arn: 'arn:aws:iam::111122223333:role/a', status: 'active' },
      { id: 'b', org_id: 'org-two', role_arn: 'arn:aws:iam::123456789012:role/b', status: 'active' },
    ];
    const stub = { query: jest.fn().mockResolvedValue({ rows }) };

    const thrown = await findEligibleAwsAccount(stub, 'org-two').catch((err: unknown) => err);

    expect(thrown).toBeInstanceOf(AwsAccountAmbiguousError);
    expect((thrown as Error).message).toBe('AWS_ACCOUNT_AMBIGUOUS: org org-two has 2 eligible AWS accounts; multiple AWS accounts are not yet supported');
    await expect(requireEligibleAwsAccount(stub, 'org-two')).rejects.toBeInstanceOf(AwsAccountAmbiguousError);
    // Existence checks select nothing, so they do not fail on two.
    await expect(hasEligibleAwsAccount(stub, 'org-two')).resolves.toBe(true);
    // No ORDER BY or LIMIT: nothing could pick one of them.
    for (const [sql] of stub.query.mock.calls) expect(sql).not.toMatch(/ORDER BY|LIMIT/i);
  });
});

describe('two organizations', () => {
  it("each sees only its own account, and one's ineligible row never answers for the other", async () => {
    const orgA = await orgWithAccount('active', 'eu-west-1');
    const orgB = await orgWithAccount('active', 'ap-southeast-2');
    const orgC = await orgWithAccount('disconnected', 'us-west-2');

    const [a, b, c] = await Promise.all([orgA, orgB, orgC].map((orgId) => findEligibleAwsAccount(pool, orgId)));

    expect(a).toMatchObject({ org_id: orgA, region: 'eu-west-1' });
    expect(b).toMatchObject({ org_id: orgB, region: 'ap-southeast-2' });
    expect(a!.id).not.toBe(b!.id);
    expect(c).toBeNull();
    await expect(countEligibleAwsAccounts(pool, orgA)).resolves.toBe(1);
    await expect(countEligibleAwsAccounts(pool, orgC)).resolves.toBe(0);
    await expect(listIneligibleAwsAccountStatuses(pool, orgA)).resolves.toEqual([]);
    await expect(listIneligibleAwsAccountStatuses(pool, orgC)).resolves.toEqual(['disconnected']);
  });
});

describe('AWSClientFactory.createClients goes through the lookup', () => {
  it.each([['no account', 'none'], ['an ineligible account', 'disconnected']] as const)(
    '%s: AWS_NOT_CONNECTED and no STS call',
    async (_label, status) => {
      const assumeRole = jest.spyOn(platformSts, 'assumeRoleAsPlatform');
      const orgId = await orgWithAccount(status);

      await expect(AWSClientFactory.createClients(orgId)).rejects.toThrow(`AWS_NOT_CONNECTED: org ${orgId} has not connected an AWS account`);
      expect(assumeRole).not.toHaveBeenCalled();
    }
  );

  it('an eligible account: its own role, ExternalId and region', async () => {
    const assumeRole = jest.spyOn(platformSts, 'assumeRoleAsPlatform').mockResolvedValue({
      Credentials: { AccessKeyId: 'ASIATEMP', SecretAccessKey: 'temp-secret', SessionToken: 'temp-token', Expiration: new Date() },
    } as any);
    const orgId = await orgWithAccount('active', 'ap-southeast-2');

    const clients = await AWSClientFactory.createClients(orgId);

    expect(clients.region).toBe('ap-southeast-2');
    expect(assumeRole).toHaveBeenCalledTimes(1);
    expect(assumeRole.mock.calls[0][0]).toBe('ap-southeast-2');
    expect(assumeRole.mock.calls[0][1]).toMatchObject({
      RoleArn: 'arn:aws:iam::123456789012:role/devcontrol-readonly',
      ExternalId: 'external-id-1',
    });
  });
});
