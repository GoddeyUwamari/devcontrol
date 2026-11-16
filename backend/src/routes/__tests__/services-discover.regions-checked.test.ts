/**
 * Multi-region PR 2: POST /api/services/discover's regions_checked (Step 1 §10, the
 * discover result's region count for PR 3's "Scan finished · c of m regions checked").
 *
 *   - flag off (no row, or a row saying off): the response is exactly as before: the
 *     same keys, no regions_checked;
 *   - flag on: counts of the scan's own region results (the rows whose status that
 *     job wrote), for the connected AWS account, against the latest list's enabled
 *     regions; another job's results and another organization's rows are never counted;
 *   - a read that fails leaves the key out, never the scan's answer.
 *
 * The discovery run itself is stubbed (discoverOrJoin answers with a job the test
 * wrote); everything else is the real route against live Postgres. Placeholders only.
 */
import servicesRoutes from '../services.routes';
import { AWSResourceDiscoveryService } from '../../services/awsResourceDiscovery';
import * as coverageRepository from '../../repositories/multi-region-coverage.repository';
import { createRoleGateHarness, RoleGateOrg } from './role-gate-harness';
import { ensureSharedFixtureTable } from './shared-fixture-tables';

const harness = createRoleGateHarness('services-discover-mr');
const { pool } = harness;
const ACCOUNT = '123456789012';
const OTHER_ACCOUNT = '111122223333';
const LISTED = '2026-03-02T09:59:00.000Z';
const THIS_SCAN = '2026-03-02T10:00:00.000Z';
const EARLIER_SCAN = '2026-03-01T10:00:00.000Z';

let seq = 0;

async function connect(orgId: string): Promise<void> {
  seq += 1;
  await pool.query(
    `INSERT INTO aws_accounts (org_id, role_arn, account_id, external_id, region, connected_at, status)
     VALUES ($1, $2, $3, 'external-id-1', 'us-east-1', NOW(), 'active')`,
    [orgId, `arn:aws:iam::${ACCOUNT}:role/DevControlRole`, `dis-${seq}-${orgId}`.slice(0, 32)]
  );
}

async function job(orgId: string, startedAt: string): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO resource_discovery_jobs (organization_id, status, started_at, completed_at, created_at, resource_types, regions)
     VALUES ($1, 'completed', $2, $2::timestamptz + interval '5 minutes', $2, '{ec2}', '{us-east-1}') RETURNING id`,
    [orgId, startedAt]
  );
  return rows[0].id;
}

async function region(orgId: string, name: string, status: string, startedAt: string | null, { enabled = true, account = ACCOUNT, code = null as string | null } = {}) {
  await pool.query(
    `INSERT INTO aws_account_regions (organization_id, aws_account_id, region, opt_in_status, enabled, last_listed_at, last_scan_status,
                                      last_scan_started_at, last_scan_finished_at, last_error_code)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8::timestamptz + interval '2 minutes', $9)`,
    [orgId, account, name, enabled ? 'opt-in-not-required' : 'not-opted-in', enabled, LISTED, status, startedAt, code]
  );
}

async function flag(orgId: string, enabled: boolean) {
  await pool.query(
    `INSERT INTO organization_feature_flags (organization_id, flag, enabled, set_by, note) VALUES ($1, 'multi_region_discovery', $2, 'test', 'test')`,
    [orgId, enabled]
  );
}

function stubScan(jobId: string) {
  return jest.spyOn(AWSResourceDiscoveryService.prototype, 'discoverOrJoin').mockResolvedValue({
    job_id: jobId, resources_discovered: 4, resources_updated: 12, resources_deleted: 0, errors: [], warnings: ['region_incomplete'],
  });
}

async function discover(org: RoleGateOrg) {
  const res = await harness.sendAs(org.orgId, org.owner, 'POST', '/services/discover');
  return { status: res.status, body: await res.json() };
}

/** Five enabled regions and one not enabled; this scan wrote four of them, an earlier scan the fifth. */
async function seedScan(orgId: string): Promise<string> {
  await job(orgId, EARLIER_SCAN);
  const jobId = await job(orgId, THIS_SCAN);
  await region(orgId, 'us-east-1', 'ok', THIS_SCAN);
  await region(orgId, 'eu-west-1', 'partial', THIS_SCAN, { code: 'discovery_listing_truncated' });
  await region(orgId, 'ap-south-1', 'denied', THIS_SCAN, { code: 'access_denied_scp' });
  await region(orgId, 'us-west-2', 'timed_out', THIS_SCAN, { code: 'scan_budget' });
  // Written by an earlier scan: not this scan's.
  await region(orgId, 'me-central-1', 'ok', EARLIER_SCAN);
  await region(orgId, 'ap-east-1', 'never_scanned', null, { enabled: false });
  // Another AWS account's row (an earlier connection), with this scan's time: never counted.
  await region(orgId, 'eu-central-1', 'ok', THIS_SCAN, { account: OTHER_ACCOUNT });
  return jobId;
}

const BEFORE_PR2 = {
  success: true,
  message: 'Discovery complete — 4 new, 12 updated',
  discovered: 4,
  updated: 12,
  errors: [],
  warnings: ['region_incomplete'],
};

beforeAll(async () => {
  await ensureSharedFixtureTable(pool, 'aws_accounts');
  await harness.listen((app) => app.use('/api/services', servicesRoutes));
});

afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  await harness.close(async (orgIds) => {
    for (const table of ['aws_account_regions', 'resource_discovery_jobs', 'organization_feature_flags']) {
      await pool.query(`DELETE FROM ${table} WHERE organization_id = ANY($1)`, [orgIds]);
    }
    await pool.query('DELETE FROM aws_accounts WHERE org_id = ANY($1)', [orgIds]);
  });
});

describe('POST /api/services/discover: regions_checked', () => {
  it.each([
    ['no flag row', undefined],
    ['a flag row saying off', false],
  ])('%s: exactly the keys and values of before PR 2, no regions_checked', async (_label, flagValue) => {
    const org = await harness.buildOrg();
    await connect(org.orgId);
    const jobId = await seedScan(org.orgId);
    if (flagValue !== undefined) await flag(org.orgId, flagValue);
    stubScan(jobId);
    const { status, body } = await discover(org);
    expect(status).toBe(200);
    expect(body).toEqual({ ...BEFORE_PR2, jobId });
    expect(Object.keys(body)).toEqual(['success', 'message', 'discovered', 'updated', 'errors', 'warnings', 'jobId']);
  });

  it('flag on: the scan\'s own region results only, for the connected account, against the latest list\'s enabled regions', async () => {
    const org = await harness.buildOrg();
    await connect(org.orgId);
    const jobId = await seedScan(org.orgId);
    await flag(org.orgId, true);
    stubScan(jobId);
    const { status, body } = await discover(org);
    expect(status).toBe(200);
    expect(body).toEqual({
      ...BEFORE_PR2,
      jobId,
      regions_checked: { enabled: 5, recorded: 4, complete: 1, partial: 1, not_checked: 2 },
    });
  });

  it('flag on: another organization\'s rows on the same AWS account are never counted', async () => {
    const org = await harness.buildOrg();
    const other = await harness.buildOrg();
    await connect(org.orgId);
    await connect(other.orgId);
    const jobId = await job(org.orgId, THIS_SCAN);
    await region(org.orgId, 'us-east-1', 'ok', THIS_SCAN);
    await seedScan(other.orgId);
    await flag(org.orgId, true);
    stubScan(jobId);
    expect((await discover(org)).body.regions_checked).toEqual({ enabled: 1, recorded: 1, complete: 1, partial: 0, not_checked: 0 });
  });

  it('flag on, a job that is not this organization\'s: no regions_checked', async () => {
    const org = await harness.buildOrg();
    const other = await harness.buildOrg();
    await connect(org.orgId);
    await flag(org.orgId, true);
    const othersJob = await job(other.orgId, THIS_SCAN);
    stubScan(othersJob);
    const { body } = await discover(org);
    expect(body).not.toHaveProperty('regions_checked');
  });

  it('flag on, the read fails: the scan\'s answer without regions_checked (fail-soft), logged by error name only', async () => {
    const org = await harness.buildOrg();
    await connect(org.orgId);
    const jobId = await seedScan(org.orgId);
    await flag(org.orgId, true);
    stubScan(jobId);
    jest.spyOn(coverageRepository, 'readScanRegionsChecked').mockRejectedValue(Object.assign(new Error('placeholder detail'), { name: 'PlaceholderError' }));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { status, body } = await discover(org);
    expect(status).toBe(200);
    expect(body).toEqual({ ...BEFORE_PR2, jobId });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('regions_checked_unreadable'));
    expect(warn.mock.calls.flat().join(' ')).not.toContain('placeholder detail');
  });
});
