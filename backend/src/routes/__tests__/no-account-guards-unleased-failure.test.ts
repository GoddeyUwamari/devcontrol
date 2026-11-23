/**
 * PR1 fix round 1 (review S-1): a CONNECTED organization whose scan fails with no
 * account to lease still records its failed scan, unleased, as before PR1.
 *
 * recordAccountContextFailure (awsResourceDiscovery.ts) writes one failed
 * resource_discovery_jobs row, with no scan lease, when leaseTargetFor() names no
 * account. After PR1 the no-account guard refuses "none" first, so that branch runs
 * only for an organization that HAS an eligible account and still has no lease target:
 *
 *   (a) its one eligible account's role ARN names no AWS account;
 *   (b) it has more than one eligible account (AWS_ACCOUNT_AMBIGUOUS).
 *
 * Both pass the guard (hasEligibleAwsAccount is true) and take the path they took
 * before PR1: one failed job row with the fixed text, no aws_scan_leases row, and the
 * route's answer for that error, unchanged.
 *
 * aws_accounts_org_id_key (UNIQUE org_id) keeps a second row out of the table, so (b)
 * keeps one real eligible row (the guard reads it) and stubs the one-account lookups a
 * real two-row organization fails on: requireEligibleAwsAccount (createClients) and
 * findEligibleAwsAccount (leaseTargetFor). Real routes and real Postgres; only token
 * verification, the AssumeRole call and those two lookups are stubbed. Placeholders only.
 */
import servicesRoutes from '../services.routes';
import { createRoleGateHarness, RoleGateOrg } from './role-gate-harness';
import { ensureSharedFixtureTable } from './shared-fixture-tables';
import * as platformSts from '../../services/platform-sts';
import * as accountsRepository from '../../repositories/aws-accounts.repository';
import { AWS_ACCOUNT_AMBIGUOUS_MESSAGE, AwsAccountAmbiguousError, hasEligibleAwsAccount } from '../../repositories/aws-accounts.repository';
import { leaseTargetFor } from '../../services/scan-session';
import { leaseHolder } from '../../services/scan-lease';
import { DISCOVERY_FAILED_MESSAGE } from '../../services/discovery-job-messages';
import { connectPlaceholderAccount, removePlaceholderAccounts } from '../../services/__tests__/helpers/scan-source';

const harness = createRoleGateHarness('pr1-unleased');
const { pool } = harness;

/** The F5 ARN (m4b-leases.test.ts): a role ARN that names no 12-digit account. */
const UNPARSEABLE_ROLE_ARN = 'arn:aws:iam::not-an-account:role/devcontrol-readonly';

/** Every table a scan can write for an organization (pr1-build.md §2), plus audit_logs. */
const COUNTED_TABLES = [
  'resource_discovery_jobs',
  'aws_scan_leases',
  'job_leases',
  'cost_analysis_runs',
  'aws_connection_checks',
  'aws_resources',
  'cost_recommendations',
  'analytics_events',
  'audit_logs',
] as const;

type Counts = Record<(typeof COUNTED_TABLES)[number], number>;

/**
 * `<hostname>:<pid>:` of this process's lease holders. job_leases is counted for this process only:
 * another test file's all-organization cron pass (resourceDiscovery.job tests, triggerManualScan),
 * in another jest worker on the same database, also leases this connected organization, and that
 * completed lease row stays by design. Scan now runs in this process, so its leases still count.
 */
const OWN_HOLDER = ((holder) => holder.slice(0, holder.lastIndexOf(':') + 1))(leaseHolder());

async function counts(orgId: string): Promise<Counts> {
  const result = {} as Counts;
  for (const table of COUNTED_TABLES) {
    const { rows } = table === 'job_leases'
      ? await pool.query(`SELECT count(*)::int AS n FROM job_leases WHERE organization_id = $1 AND starts_with(holder, $2)`, [orgId, OWN_HOLDER])
      : await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE organization_id = $1`, [orgId]);
    result[table] = rows[0].n;
  }
  return result;
}

/** A free-tier organization with one eligible (active) aws_accounts row. */
async function connectedOrg(): Promise<RoleGateOrg> {
  const org = await harness.buildOrg();
  await pool.query(`UPDATE organizations SET subscription_tier = 'free' WHERE id = $1`, [org.orgId]);
  await connectPlaceholderAccount(pool, org.orgId);
  return org;
}

async function scanNow(org: RoleGateOrg) {
  const res = await harness.sendAs(org.orgId, org.owner, 'POST', '/services/discover');
  return { status: res.status, body: await res.json() };
}

async function discoveryJobs(orgId: string) {
  const { rows } = await pool.query(
    `SELECT status, error_message, completed_at IS NOT NULL AS completed FROM resource_discovery_jobs WHERE organization_id = $1 ORDER BY created_at`,
    [orgId]
  );
  return rows;
}

async function leaseRows(orgId: string) {
  return (await pool.query(`SELECT 1 FROM aws_scan_leases WHERE organization_id = $1`, [orgId])).rows;
}

beforeAll(async () => {
  await ensureSharedFixtureTable(pool, 'aws_accounts');
  await harness.listen((app) => {
    app.use('/api/services', servicesRoutes);
  });
});

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  await harness.close(async (orgIds) => {
    for (const table of [
      'soc2_evidence_observations', 'soc2_control_evaluations', 'account_security_findings', 'framework_evaluation_runs',
      ...COUNTED_TABLES.filter((table) => table !== 'analytics_events' && table !== 'audit_logs'),
      'aws_account_regions',
    ]) {
      await pool.query(`DELETE FROM ${table} WHERE organization_id = ANY($1)`, [orgIds]).catch(() => undefined);
    }
    await removePlaceholderAccounts(pool, orgIds);
    await pool.query('DELETE FROM aws_accounts WHERE org_id = ANY($1)', [orgIds]);
  });
}, 30_000);

describe('a connected organization with no account to lease: its failed scan is still recorded, unleased (review S-1)', () => {
  it('(a) one eligible account whose role ARN names no account: Scan now records ONE failed job, no scan lease, today\'s 409 aws_not_connected', async () => {
    const org = await connectedOrg();
    await pool.query(`UPDATE aws_accounts SET role_arn = $1 WHERE org_id = $2`, [UNPARSEABLE_ROLE_ARN, org.orgId]);
    // AWS refuses an AssumeRole into a role ARN that names no account.
    const assume = jest.spyOn(platformSts, 'assumeRoleAsPlatform').mockRejectedValue(
      Object.assign(new Error('1 validation error detected: Value at roleArn failed to satisfy constraint'), {
        name: 'ValidationError',
        $metadata: { httpStatusCode: 400 },
      })
    );
    // The preconditions: the guard passes (an eligible row exists) and there is no lease target.
    expect(await hasEligibleAwsAccount(pool, org.orgId)).toBe(true);
    expect(await leaseTargetFor(pool, org.orgId)).toBeNull();
    const before = await counts(org.orgId);

    const { status, body } = await scanNow(org);

    expect(assume).toHaveBeenCalled();
    expect(await discoveryJobs(org.orgId)).toEqual([{ status: 'failed', error_message: DISCOVERY_FAILED_MESSAGE, completed: true }]);
    expect(await leaseRows(org.orgId)).toEqual([]);
    // Today's answer for a role failure (the AWS_NOT_CONNECTED prefix branch), not the PR1 refusal.
    expect(status).toBe(409);
    expect(body).toEqual({ error: 'aws_not_connected', message: 'Please connect your AWS account in Settings to run audits.' });
    // The failed job and the connection's health (written before PR1 too); nothing else.
    expect(await counts(org.orgId)).toEqual({ ...before, resource_discovery_jobs: 1, aws_connection_checks: before.aws_connection_checks + 1 });
  });

  it('(b) more than one eligible account (ambiguous): Scan now records ONE failed job, no scan lease, today\'s 409 with the ambiguous text', async () => {
    const org = await connectedOrg();
    // A real two-row organization: the guard's read finds rows (it never selects one);
    // every one-account lookup refuses.
    jest.spyOn(accountsRepository, 'requireEligibleAwsAccount').mockRejectedValue(new AwsAccountAmbiguousError(org.orgId, 2));
    jest.spyOn(accountsRepository, 'findEligibleAwsAccount').mockRejectedValue(new AwsAccountAmbiguousError(org.orgId, 2));
    const assume = jest.spyOn(platformSts, 'assumeRoleAsPlatform');
    // The preconditions: the guard passes and there is no lease target.
    expect(await hasEligibleAwsAccount(pool, org.orgId)).toBe(true);
    expect(await leaseTargetFor(pool, org.orgId)).toBeNull();
    const before = await counts(org.orgId);

    const { status, body } = await scanNow(org);

    expect(assume).not.toHaveBeenCalled();
    expect(await discoveryJobs(org.orgId)).toEqual([{ status: 'failed', error_message: DISCOVERY_FAILED_MESSAGE, completed: true }]);
    expect(await leaseRows(org.orgId)).toEqual([]);
    expect(status).toBe(409);
    expect(body).toEqual({ success: false, error: AWS_ACCOUNT_AMBIGUOUS_MESSAGE });
    // The failed job only.
    expect(await counts(org.orgId)).toEqual({ ...before, resource_discovery_jobs: 1 });
  });
});
