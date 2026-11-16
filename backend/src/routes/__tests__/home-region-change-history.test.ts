/**
 * Home region HR-1 (founder addition, Nov 16; for PR 3's "no longer scanned since
 * {date}"): previous_home_region and home_region_changed_at, derived from the
 * latest aws_account.home_region_changed audit event of the connection (no new
 * column).
 *
 *   GET /api/services/coverage   account.previous_home_region / home_region_changed_at
 *     present only after a change; absent for an account that never changed, so
 *     its response stays byte-identical, flag off and flag on (the PR 2 contracts
 *     pin those bytes).
 *   GET /api/aws/accounts        previous_home_region / home_region_changed_at,
 *     null when never changed.
 *   Only this organization's events for THIS connection row count; an event that
 *   no longer explains the current home region (a hand edit since) does not.
 *
 * Real routes over live Postgres; only authService.verifyToken and the background
 * scan are stubbed. Placeholders only.
 */
import awsRoutes from '../aws.routes';
import servicesCoverageRoutes from '../services-coverage.routes';
import { AWSResourceDiscoveryService } from '../../services/awsResourceDiscovery';
import { createRoleGateHarness } from './role-gate-harness';
import { ensureSharedFixtureTable } from './shared-fixture-tables';
import { HOME_REGION_FIXTURE_TABLES, homeRegionRouteFixtures, type Org } from './home-region-route-fixtures';

const harness = createRoleGateHarness('home-region-history');
const { pool } = harness;
const { connectedOrg, put, accounts } = homeRegionRouteFixtures(harness);

const coverage = async (org: Org) => {
  const res = await harness.sendAs(org.orgId, org.viewer, 'GET', '/services/coverage');
  expect(res.status).toBe(200);
  return res.json();
};
const flagOn = (org: Org) =>
  pool.query(`INSERT INTO organization_feature_flags (organization_id, flag, enabled, set_by, note) VALUES ($1, 'multi_region_discovery', true, 'test', 'test')`, [org.orgId]);
const auditTime = async (org: Org) =>
  (await pool.query(`SELECT created_at FROM audit_logs WHERE organization_id = $1 AND action = 'aws_account.home_region_changed' ORDER BY created_at DESC LIMIT 1`, [org.orgId])).rows[0].created_at as Date;

beforeAll(async () => {
  await ensureSharedFixtureTable(pool, 'aws_accounts');
  await harness.listen((app) => {
    app.use('/api/services/coverage', servicesCoverageRoutes);
    app.use('/api/aws', awsRoutes);
  });
});

beforeEach(() => {
  jest.spyOn(AWSResourceDiscoveryService.prototype, 'discoverAllResources').mockResolvedValue({
    job_id: 'stub-job', resources_discovered: 0, resources_updated: 0, resources_deleted: 0, errors: [], warnings: [],
  } as any);
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  await harness.close(async (orgIds) => {
    for (const table of [...HOME_REGION_FIXTURE_TABLES, 'resource_discovery_jobs']) {
      await pool.query(`DELETE FROM ${table} WHERE organization_id = ANY($1)`, [orgIds]);
    }
    await pool.query('DELETE FROM aws_accounts WHERE org_id = ANY($1)', [orgIds]);
  });
});

describe('never changed: absent in coverage (byte-identical), null in GET /api/aws/accounts', () => {
  it.each([['off'], ['on']])('flag %s: coverage account has exactly its old keys; accounts reads null', async (flag) => {
    const org = await connectedOrg();
    if (flag === 'on') await flagOn(org);
    const body = await coverage(org);
    expect(Object.keys(body.coverage.account).sort()).toEqual(['connected', 'home_region', 'status']);
    const acc = await (await accounts(org)).json();
    expect(acc).toMatchObject({ previous_home_region: null, home_region_changed_at: null });
  });
});

describe('after a change: the former home region and the change time', () => {
  it.each([['off'], ['on']])('flag %s: coverage and accounts both name us-east-1 and the audit event time', async (flag) => {
    const org = await connectedOrg();
    if (flag === 'on') await flagOn(org);
    expect((await put(org, { region: 'us-west-2' })).status).toBe(200);
    const at = (await auditTime(org)).toISOString();
    const body = await coverage(org);
    expect(body.coverage.account).toEqual({
      connected: true, status: 'active', home_region: 'us-west-2', previous_home_region: 'us-east-1', home_region_changed_at: at,
    });
    expect(await (await accounts(org)).json()).toMatchObject({ previous_home_region: 'us-east-1', home_region_changed_at: at });
  });

  it('two changes: the latest one counts', async () => {
    const org = await connectedOrg();
    expect((await put(org, { region: 'us-west-2' })).status).toBe(200);
    expect((await put(org, { region: 'us-east-1' })).status).toBe(200);
    const body = await coverage(org);
    expect(body.coverage.account).toMatchObject({ home_region: 'us-east-1', previous_home_region: 'us-west-2', home_region_changed_at: (await auditTime(org)).toISOString() });
  });

  it('a hand edit since the change: the event no longer explains the home region, so nothing is reported', async () => {
    const org = await connectedOrg();
    expect((await put(org, { region: 'us-west-2' })).status).toBe(200);
    await pool.query(`UPDATE aws_accounts SET region = 'eu-west-1' WHERE id = $1`, [org.rowId]);
    expect(Object.keys((await coverage(org)).coverage.account).sort()).toEqual(['connected', 'home_region', 'status']);
    expect(await (await accounts(org)).json()).toMatchObject({ previous_home_region: null, home_region_changed_at: null });
  });

  it('only this organization\'s events for this connection row count (another organization, an earlier connection)', async () => {
    const a = await connectedOrg();
    const b = await connectedOrg();
    expect((await put(b, { region: 'us-west-2' })).status).toBe(200);
    // An event of an earlier connection of A (another row id), leading to A's current region.
    await pool.query(
      `INSERT INTO audit_logs (organization_id, user_id, action, resource_type, resource_id, changes, metadata)
       VALUES ($1, $2, 'aws_account.home_region_changed', 'aws_account', gen_random_uuid(), '{"from":"eu-west-1","to":"us-east-1"}', '{}')`,
      [a.orgId, a.owner]
    );
    expect(Object.keys((await coverage(a)).coverage.account).sort()).toEqual(['connected', 'home_region', 'status']);
    expect(await (await accounts(a)).json()).toMatchObject({ previous_home_region: null, home_region_changed_at: null });
    expect((await coverage(b)).coverage.account.previous_home_region).toBe('us-east-1');
  });
});
