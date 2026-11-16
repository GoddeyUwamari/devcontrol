/**
 * Multi-region PR 2 contract: with multi_region_discovery OFF, GET /api/services/coverage
 * answers byte for byte what it answered before PR 2.
 *
 * The snapshot was recorded against the route as it was before PR 2 (commit 6252fe4e,
 * the PR 1b code), in a temporary worktree, and is never re-recorded by PR 2: a flag-off
 * difference fails it. The fixtures exercise everything PR 2 reads or adds: a region
 * list with every status, codes outside the old allow-list (an access_denied_scp and a
 * Resource Explorer code a multi-region scan writes), a not-enabled opt-in region, a
 * region missing from the latest list, a scan in progress (held lease naming a running
 * job that has started regions), resources first stored before and during that scan,
 * a terminated resource, S3 and CloudFront. Every time is a fixed instant (the lease
 * expires in 2099), so the response text is the same on every run.
 *
 * Three organizations get the same fixtures:
 *   - no flag row, and a flag row that says OFF: both answer the snapshot exactly;
 *   - flag ON: the same text once its one added key, multi_region, is removed (the
 *     extension is additive: no existing key changes, even for a flagged organization).
 *
 * Real route over an in-process HTTP server against live Postgres; only
 * authService.verifyToken is stubbed (role-gate harness). Placeholders only.
 */
import servicesCoverageRoutes from '../services-coverage.routes';
import servicesRoutes from '../services.routes';
import { SCAN_KIND_DISCOVERY } from '../../services/scan-session';
import { createRoleGateHarness, RoleGateOrg } from './role-gate-harness';
import { ensureSharedFixtureTable } from './shared-fixture-tables';

const harness = createRoleGateHarness('services-coverage-mr-contract');
const { pool } = harness;

// The documented placeholder AWS account every fixture role ARN names.
const ACCOUNT = '123456789012';
const HOME = 'us-east-1';
const TYPES = ['ec2', 'ebs', 'rds', 's3', 'lambda', 'load-balancer', 'cloudfront', 'sqs'];

// Fixed instants. The running scan started at SCAN_START; the newest completed scan before it.
const LIST_OLD = '2026-02-01T09:00:00.000Z';
const LIST_LATEST = '2026-03-02T09:59:00.000Z';
const DONE_STARTED = '2026-03-01T10:00:00.000Z';
const DONE_FINISHED = '2026-03-01T10:05:00.000Z';
const SCAN_START = '2026-03-02T10:00:00.000Z';
const BEFORE_SCAN = '2026-02-20T08:00:00.000Z';
const DURING_SCAN = '2026-03-02T10:02:00.000Z';

let seq = 0;

async function seedFixtures(orgId: string): Promise<void> {
  seq += 1;
  await pool.query(
    `INSERT INTO aws_accounts (org_id, role_arn, account_id, external_id, region, connected_at, status)
     VALUES ($1, $2, $3, 'external-id-1', $4, $5, 'active')`,
    [orgId, `arn:aws:iam::${ACCOUNT}:role/DevControlRole`, `mrc-${seq}-${orgId}`.slice(0, 32), HOME, DONE_STARTED]
  );
  await pool.query(
    `INSERT INTO resource_discovery_jobs (organization_id, status, started_at, completed_at, created_at, resource_types, regions, error_message, warnings)
     VALUES ($1, 'completed', $2, $3, $2, $4, $5, NULL, $6::jsonb)`,
    [orgId, DONE_STARTED, DONE_FINISHED, TYPES, [HOME, 'eu-west-1', 'ap-south-1', 'me-central-1'],
      JSON.stringify(['resource_explorer_no_index', 'region_incomplete', 'discovery_listing_truncated'])]
  );
  const running = await pool.query(
    `INSERT INTO resource_discovery_jobs (organization_id, status, started_at, created_at, resource_types, regions)
     VALUES ($1, 'running', $2, $2, $3, $4) RETURNING id`,
    [orgId, SCAN_START, TYPES, [HOME, 'eu-west-1']]
  );
  await pool.query(
    `INSERT INTO aws_scan_leases (organization_id, aws_account_id, scan_kind, holder, job_id, acquired_at, heartbeat_at, expires_at)
     VALUES ($1, $2, $3, 'contract-holder', $4, $5, $5, '2099-01-01T00:00:00Z')`,
    [orgId, ACCOUNT, SCAN_KIND_DISCOVERY, running.rows[0].id, SCAN_START]
  );
  const region = (
    name: string, optIn: string, enabled: boolean, listedAt: string, status: string,
    started: string | null, finished: string | null, success: string | null, code: string | null, failures = 0
  ) =>
    pool.query(
      `INSERT INTO aws_account_regions
         (organization_id, aws_account_id, region, opt_in_status, enabled, last_listed_at, last_scan_status,
          last_scan_started_at, last_scan_finished_at, last_success_at, last_error_code, consecutive_failures)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [orgId, ACCOUNT, name, optIn, enabled, listedAt, status, started, finished, success, code, failures]
    );
  // Done in the running scan.
  await region(HOME, 'opt-in-not-required', true, LIST_LATEST, 'ok', SCAN_START, '2026-03-02T10:03:00.000Z', '2026-03-02T10:03:00.000Z', null);
  // Earlier results: ok with a Resource Explorer code (PR 2's RR-M2 write), denied by an SCP, partial.
  await region('eu-west-1', 'opt-in-not-required', true, LIST_LATEST, 'ok', DONE_STARTED, '2026-03-01T10:04:00.000Z', '2026-03-01T10:04:00.000Z', 'resource_explorer_no_index');
  await region('ap-south-1', 'opt-in-not-required', true, LIST_LATEST, 'denied', DONE_STARTED, '2026-03-01T10:03:00.000Z', null, 'access_denied_scp', 2);
  await region('me-central-1', 'opted-in', true, LIST_LATEST, 'partial', DONE_STARTED, '2026-03-01T10:04:30.000Z', '2026-02-20T10:00:00.000Z', 'discovery_listing_truncated');
  await region('us-west-2', 'opt-in-not-required', true, LIST_LATEST, 'never_scanned', null, null, null, null);
  // Not enabled (opt-in), and a region missing from the latest list.
  await region('ap-east-1', 'not-opted-in', false, LIST_LATEST, 'never_scanned', null, null, null, null);
  await region('sa-east-1', 'opt-in-not-required', true, LIST_OLD, 'ok', '2026-01-31T10:00:00.000Z', '2026-01-31T10:05:00.000Z', '2026-01-31T10:05:00.000Z', null);

  const resource = (name: string, type: string, where: string, discovered: string, status = 'running', tags = '{}') =>
    pool.query(
      `INSERT INTO aws_resources
         (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status, tags, metadata, first_discovered_at, created_at)
       VALUES ($1, $2, $3, $3, $4, $5, $6, $7::jsonb, '{}', $8, $8)`,
      [orgId, `arn:aws:${type}:${where}:${ACCOUNT}:resource/${name}`, name, type, where, status, tags, discovered]
    );
  await resource('home-web-1', 'ec2', HOME, BEFORE_SCAN, 'running', '{"owner":"placeholder-team"}');
  await resource('home-web-2', 'ec2', HOME, DURING_SCAN);
  await resource('eu-queue', 'sqs', 'eu-west-1', BEFORE_SCAN, 'active');
  await resource('eu-queue-new', 'sqs', 'eu-west-1', DURING_SCAN, 'active');
  await resource('ap-db', 'rds', 'ap-south-1', BEFORE_SCAN, 'available');
  await resource('ap-gone', 'ec2', 'ap-south-1', BEFORE_SCAN, 'terminated');
  await resource('west-bucket', 's3', 'us-west-2', BEFORE_SCAN, 'active');
  await resource('cdn', 'cloudfront', 'global', BEFORE_SCAN, 'active');
}

async function coverageText(org: RoleGateOrg): Promise<string> {
  const res = await harness.sendAs(org.orgId, org.viewer, 'GET', '/services/coverage');
  expect(res.status).toBe(200);
  return res.text();
}

let noRow: RoleGateOrg;
let flagOff: RoleGateOrg;
let flagOn: RoleGateOrg;

beforeAll(async () => {
  await ensureSharedFixtureTable(pool, 'aws_accounts');
  await harness.listen((app) => {
    app.use('/api/services/coverage', servicesCoverageRoutes);
    app.use('/api/services', servicesRoutes);
  });
  noRow = await harness.buildOrg();
  flagOff = await harness.buildOrg();
  flagOn = await harness.buildOrg();
  for (const org of [noRow, flagOff, flagOn]) await seedFixtures(org.orgId);
  await pool.query(
    `INSERT INTO organization_feature_flags (organization_id, flag, enabled, set_by, note) VALUES ($1, 'multi_region_discovery', false, 'test', 'contract'), ($2, 'multi_region_discovery', true, 'test', 'contract')`,
    [flagOff.orgId, flagOn.orgId]
  );
});

afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  await harness.close(async (orgIds) => {
    for (const table of ['aws_resources', 'aws_account_regions', 'aws_scan_leases', 'resource_discovery_jobs', 'organization_feature_flags']) {
      await pool.query(`DELETE FROM ${table} WHERE organization_id = ANY($1)`, [orgIds]);
    }
    await pool.query('DELETE FROM aws_accounts WHERE org_id = ANY($1)', [orgIds]);
  });
});

describe('GET /api/services/coverage with multi_region_discovery OFF is byte-identical to before PR 2', () => {
  it('no flag row: the response text is the recorded one, byte for byte', async () => {
    expect(await coverageText(noRow)).toMatchSnapshot();
  });

  it('a flag row that says OFF: exactly the same text as no row', async () => {
    expect(await coverageText(flagOff)).toBe(await coverageText(noRow));
  });

  it('flag ON: removing its multi_region key leaves exactly the same text (additive only)', async () => {
    const body = JSON.parse(await coverageText(flagOn));
    delete body.coverage.multi_region;
    expect(JSON.stringify(body)).toBe(await coverageText(noRow));
  });
});
