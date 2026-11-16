/**
 * Multi-region PR 3a: the coverage fields the Services redesign reads outside
 * multi_region, plus RR-L1 and the G11 edges.
 *
 *   G7  coverage.not_enabled_regions, for EVERY organization: the latest stored list's
 *       not-enabled regions ([] with no account or no list); equal to
 *       multi_region.not_enabled_regions for a flagged organization (same reader).
 *   G8  coverage.home_only_coverage, ONLY when multi_region is absent: regions_total =
 *       the enabled regions of the latest list; regions_checked = 1 only when the CURRENT
 *       home region's last status is ok or partial. A former home region's stale ok never
 *       counts. null with no account or no list.
 *   G11 multi_region.region_warnings_unattributed: [] with no job and while a scan runs
 *       (the running job has no warnings yet); the attributed case is the doc example.
 *   RR-L1 a home row with scan_enabled = false is never 'excluded'.
 *
 * The flag-off example blocks in docs/SERVICES_COVERAGE_MULTI_REGION.md §15 are this
 * suite's real answers. Tenancy: explicit predicate, and row-level security alone (the
 * non-superuser devcontrol role, every organization predicate stripped).
 *
 * Real route over an in-process HTTP server against live Postgres; only
 * authService.verifyToken is stubbed (role-gate harness). Placeholders only.
 */
import fs from 'fs';
import path from 'path';
import { Client } from 'pg';
import servicesCoverageRoutes, { homeOnlyCoverage } from '../services-coverage.routes';
import servicesRoutes from '../services.routes';
import { SCAN_KIND_DISCOVERY } from '../../services/scan-session';
import { createRoleGateHarness, RoleGateOrg } from './role-gate-harness';
import { ensureSharedFixtureTable } from './shared-fixture-tables';

const harness = createRoleGateHarness('services-coverage-pr3a');
const { pool } = harness;
const DOC = path.join(__dirname, '..', '..', '..', '..', 'docs', 'SERVICES_COVERAGE_MULTI_REGION.md');
const ACCOUNT = '123456789012';
const LISTED = '2026-11-15T09:59:00.000Z';
const STARTED = '2026-11-15T10:00:00.000Z';
const FINISHED = '2026-11-15T10:03:00.000Z';

interface RegionRow {
  name: string;
  enabled?: boolean;
  status?: string;
  code?: string | null;
  scanEnabled?: boolean;
  /** When its last result was started (default STARTED, the scan the test inserts). */
  started?: string;
  /** ec2 rows stored in the region (first discovered before any scan here). */
  resources?: number;
}

interface Recorded { text: string; values: unknown[] }
const recorded: Recorded[] = [];
const originalClientQuery = Client.prototype.query;

let seq = 0;

/** An organization with a connection whose home region is `home`, and (if given) a latest region list. */
async function orgWith(home: string | null, regions: RegionRow[] | null, { flag = false } = {}): Promise<RoleGateOrg> {
  const org = await harness.buildOrg();
  seq += 1;
  if (home !== null) {
    await pool.query(
      `INSERT INTO aws_accounts (org_id, role_arn, account_id, external_id, region, connected_at, status)
       VALUES ($1, $2, $3, 'external-id-1', $4, $5, 'active')`,
      [org.orgId, `arn:aws:iam::${ACCOUNT}:role/DevControlRole`, `p3a-${seq}-${org.orgId}`.slice(0, 32), home, STARTED]
    );
  }
  if (flag) {
    await pool.query(
      `INSERT INTO organization_feature_flags (organization_id, flag, enabled, set_by, note) VALUES ($1, 'multi_region_discovery', true, 'test', 'pr3a')`,
      [org.orgId]
    );
  }
  for (const r of regions ?? []) {
    const status = r.status ?? 'never_scanned';
    const scanned = status !== 'never_scanned';
    const started = r.started ?? STARTED;
    const finished = new Date(Date.parse(started) + 3 * 60_000).toISOString();
    await pool.query(
      `INSERT INTO aws_account_regions (organization_id, aws_account_id, region, opt_in_status, enabled, scan_enabled, last_listed_at, last_scan_status,
                                        last_scan_started_at, last_scan_finished_at, last_success_at, last_error_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [org.orgId, ACCOUNT, r.name, r.enabled === false ? 'not-opted-in' : 'opt-in-not-required', r.enabled ?? true, r.scanEnabled ?? true, LISTED, status,
        scanned ? started : null, scanned ? finished : null, status === 'ok' ? finished : null, r.code ?? null]
    );
    for (let i = 0; i < (r.resources ?? 0); i++) {
      await pool.query(
        `INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status, tags, metadata, first_discovered_at, created_at)
         VALUES ($1, $2, $3, $3, 'ec2', $4, 'running', '{}', '{}', '2026-11-01T08:00:00Z', '2026-11-01T08:00:00Z')`,
        [org.orgId, `arn:aws:ec2:${r.name}:${ACCOUNT}:instance/p3a-${i}-${org.orgId.slice(0, 8)}`, `p3a-${i}-${org.orgId.slice(0, 8)}`, r.name]
      );
    }
  }
  return org;
}

async function coverageOf(org: RoleGateOrg): Promise<any> {
  const res = await harness.sendAs(org.orgId, org.viewer, 'GET', '/services/coverage');
  expect(res.status).toBe(200);
  return (await res.json()).coverage;
}

/** The §15 flag-off example blocks: a ```json fence right after `<!-- example-flag-off: name -->`. */
function flagOffExamples(): Record<string, unknown> {
  const text = fs.readFileSync(DOC, 'utf8');
  const out: Record<string, unknown> = {};
  const pattern = /<!-- example-flag-off: ([a-z_0-9]+) -->\s*```json\n([\s\S]*?)\n```/g;
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) out[m[1]] = JSON.parse(m[2]);
  return out;
}

const OTHERS: RegionRow[] = [{ name: 'eu-west-1' }, { name: 'ap-south-1' }];

beforeAll(async () => {
  Client.prototype.query = function (this: Client, ...args: unknown[]) {
    const arg = args[0] as string | { text?: string; values?: unknown[] } | null;
    recorded.push({
      text: typeof arg === 'string' ? arg : arg?.text ?? '',
      values: (typeof arg === 'string' ? (Array.isArray(args[1]) ? args[1] : []) : arg?.values ?? []) as unknown[],
    });
    return (originalClientQuery as (...a: unknown[]) => unknown).apply(this, args);
  } as typeof Client.prototype.query;
  await ensureSharedFixtureTable(pool, 'aws_accounts');
  await harness.listen((app) => {
    app.use('/api/services/coverage', servicesCoverageRoutes);
    app.use('/api/services', servicesRoutes);
  });
});

afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  Client.prototype.query = originalClientQuery;
  await harness.close(async (orgIds) => {
    for (const table of ['aws_resources', 'aws_account_regions', 'aws_scan_leases', 'resource_discovery_jobs', 'organization_feature_flags']) {
      await pool.query(`DELETE FROM ${table} WHERE organization_id = ANY($1)`, [orgIds]);
    }
    await pool.query('DELETE FROM aws_accounts WHERE org_id = ANY($1)', [orgIds]);
  });
});

describe('G8 home_only_coverage (flag off): 1 only when the CURRENT home region is ok or partial', () => {
  it.each([
    ['ok', null, 1],
    ['partial', 'discovery_listing_truncated', 1],
    ['failed', 'error', 0],
    ['denied', 'access_denied', 0],
    ['timed_out', 'call_timeout', 0],
    ['never_scanned', null, 0],
  ] as const)('home %s (code %s) → regions_checked %d', async (status, code, checked) => {
    const org = await orgWith('us-east-1', [{ name: 'us-east-1', status, code }, ...OTHERS]);
    const coverage = await coverageOf(org);
    expect(coverage.multi_region).toBeUndefined();
    expect(coverage.home_only_coverage).toEqual({ regions_total: 3, regions_checked: checked });
    expect(coverage.home_only_coverage.regions_total).toBe(coverage.scope.enabled_regions.count);
  });

  it('a former home region\'s stale ok never counts: the current home (never scanned) reads 0', async () => {
    const org = await orgWith('us-west-2', [{ name: 'us-east-1', status: 'ok' }, { name: 'us-west-2' }, { name: 'eu-west-1' }]);
    expect((await coverageOf(org)).home_only_coverage).toEqual({ regions_total: 3, regions_checked: 0 });
  });

  it('a former home ok beside a current home ok is still 1, never 2', async () => {
    const org = await orgWith('us-west-2', [{ name: 'us-east-1', status: 'ok' }, { name: 'us-west-2', status: 'ok' }, { name: 'eu-west-1', status: 'ok' }]);
    expect((await coverageOf(org)).home_only_coverage).toEqual({ regions_total: 3, regions_checked: 1 });
  });

  it('not-enabled regions are outside regions_total', async () => {
    const org = await orgWith('us-east-1', [{ name: 'us-east-1', status: 'ok' }, ...OTHERS, { name: 'ap-east-1', enabled: false }]);
    expect((await coverageOf(org)).home_only_coverage).toEqual({ regions_total: 3, regions_checked: 1 });
  });

  it('null with no account, and with an account but no stored list', async () => {
    const noAccount = await coverageOf(await orgWith(null, null));
    expect(noAccount.home_only_coverage).toBeNull();
    const noList = await coverageOf(await orgWith('us-east-1', null));
    expect(noList.home_only_coverage).toBeNull();
  });

  it('absent for a flagged organization (multi_region.scan carries its N of M)', async () => {
    const coverage = await coverageOf(await orgWith('us-east-1', [{ name: 'us-east-1', status: 'ok' }, ...OTHERS], { flag: true }));
    expect(coverage.multi_region).toBeDefined();
    expect('home_only_coverage' in coverage).toBe(false);
  });

  it('homeOnlyCoverage (pure): the home row decides; a missing home row is 0; no list or no connection is null', () => {
    expect(homeOnlyCoverage(true, 2, [{ home: false, status: 'ok' }, { home: true, status: 'partial' }])).toEqual({ regions_total: 2, regions_checked: 1 });
    expect(homeOnlyCoverage(true, 2, [{ home: false, status: 'ok' }, { home: false, status: 'ok' }])).toEqual({ regions_total: 2, regions_checked: 0 });
    expect(homeOnlyCoverage(true, null, [])).toBeNull();
    expect(homeOnlyCoverage(false, 2, [{ home: true, status: 'ok' }])).toBeNull();
  });
});

describe('G7 not_enabled_regions, for every organization', () => {
  it('flag off: the latest list\'s not-enabled regions, by name', async () => {
    const org = await orgWith('us-east-1', [{ name: 'us-east-1', status: 'ok' }, ...OTHERS, { name: 'me-south-1', enabled: false }, { name: 'af-south-1', enabled: false }]);
    expect((await coverageOf(org)).not_enabled_regions).toEqual(['af-south-1', 'me-south-1']);
  });

  it('flag on: equal to multi_region.not_enabled_regions (same reader)', async () => {
    const coverage = await coverageOf(await orgWith('us-east-1', [{ name: 'us-east-1', status: 'ok' }, { name: 'ap-east-1', enabled: false }], { flag: true }));
    expect(coverage.not_enabled_regions).toEqual(['ap-east-1']);
    expect(coverage.not_enabled_regions).toEqual(coverage.multi_region.not_enabled_regions);
  });

  it('[] with no account, with no list, and when every region is enabled', async () => {
    expect((await coverageOf(await orgWith(null, null))).not_enabled_regions).toEqual([]);
    expect((await coverageOf(await orgWith('us-east-1', null))).not_enabled_regions).toEqual([]);
    expect((await coverageOf(await orgWith('us-east-1', [{ name: 'us-east-1', status: 'ok' }, ...OTHERS]))).not_enabled_regions).toEqual([]);
  });

  it('only the LATEST list: a region not enabled in an older list is not reported', async () => {
    const org = await orgWith('us-east-1', [{ name: 'us-east-1', status: 'ok' }]);
    await pool.query(
      `INSERT INTO aws_account_regions (organization_id, aws_account_id, region, opt_in_status, enabled, last_listed_at, last_scan_status)
       VALUES ($1, $2, 'ap-east-1', 'not-opted-in', false, '2026-10-01T00:00:00Z', 'never_scanned')`,
      [org.orgId, ACCOUNT]
    );
    expect((await coverageOf(org)).not_enabled_regions).toEqual([]);
  });

  it('tenancy: another organization\'s list never shows', async () => {
    const a = await orgWith('us-east-1', [{ name: 'us-east-1', status: 'ok' }, { name: 'ap-east-1', enabled: false }]);
    const b = await orgWith('us-east-1', [{ name: 'us-east-1', status: 'ok' }, { name: 'me-south-1', enabled: false }]);
    expect((await coverageOf(a)).not_enabled_regions).toEqual(['ap-east-1']);
    expect((await coverageOf(b)).not_enabled_regions).toEqual(['me-south-1']);
  });

  it('row-level security alone (devcontrol, every organization predicate stripped): only the tagged organization\'s list', async () => {
    const a = await orgWith('us-east-1', [{ name: 'us-east-1', status: 'ok' }, { name: 'ap-east-1', enabled: false }]);
    const b = await orgWith('us-east-1', [{ name: 'us-east-1', status: 'ok' }, { name: 'me-south-1', enabled: false }]);
    const start = recorded.length;
    await coverageOf(a);
    const [statement] = recorded.slice(start).filter((r) => /WITH last_job AS/.test(r.text));
    expect(statement).toBeDefined();
    // The two-letter aliases first: 'j.' and 'r.' are suffixes of them.
    const stripped = statement.text
      .split('ar.organization_id = $1').join('$1::uuid IS NOT NULL')
      .split('sl.organization_id = $1').join('$1::uuid IS NOT NULL')
      .split('lj.organization_id = $1').join('$1::uuid IS NOT NULL')
      .split('cj.organization_id = $1').join('$1::uuid IS NOT NULL')
      .split(' j.organization_id = $1').join(' $1::uuid IS NOT NULL')
      .split('r.organization_id = $1').join('$1::uuid IS NOT NULL');
    expect(stripped).not.toMatch(/organization_id = \$1/);
    const paramsFor = (orgId: string) => [orgId, ...statement.values.slice(1)];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('GRANT SELECT ON aws_resources, resource_discovery_jobs TO devcontrol');
      await client.query('SET LOCAL ROLE devcontrol');
      const role = await client.query('SELECT current_user AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user');
      expect(role.rows[0]).toEqual({ name: 'devcontrol', rolsuper: false, rolbypassrls: false });
      await client.query("SELECT set_config('app.current_organization_id', $1, true)", [a.orgId]);
      expect((await client.query(stripped, paramsFor(b.orgId))).rows[0].not_enabled_regions).toEqual(['ap-east-1']);
      await client.query("SELECT set_config('app.current_organization_id', $1, true)", [b.orgId]);
      expect((await client.query(stripped, paramsFor(a.orgId))).rows[0].not_enabled_regions).toEqual(['me-south-1']);
      await client.query("SELECT set_config('app.current_organization_id', '', true)");
      expect((await client.query(stripped, paramsFor(a.orgId))).rows[0].not_enabled_regions).toEqual([]);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});

describe('docs §15: the flag-off example blocks are real answers', () => {
  const pick = (coverage: any) => ({ not_enabled_regions: coverage.not_enabled_regions, home_only_coverage: coverage.home_only_coverage });

  it('the document has exactly these flag-off examples', () => {
    expect(Object.keys(flagOffExamples()).sort()).toEqual(['former_home_ok', 'home_ok']);
  });

  it('home_ok', async () => {
    const org = await orgWith('us-east-1', [{ name: 'us-east-1', status: 'ok' }, ...OTHERS, { name: 'ap-east-1', enabled: false }, { name: 'af-south-1', enabled: false }]);
    expect(pick(await coverageOf(org))).toEqual(flagOffExamples().home_ok);
  });

  it('former_home_ok', async () => {
    const org = await orgWith('us-west-2', [{ name: 'us-east-1', status: 'ok' }, { name: 'us-west-2' }, { name: 'eu-west-1' }]);
    expect(pick(await coverageOf(org))).toEqual(flagOffExamples().former_home_ok);
  });
});

describe('G11 region_warnings_unattributed edges', () => {
  it('[] when no scan has run', async () => {
    const coverage = await coverageOf(await orgWith('us-east-1', [{ name: 'us-east-1' }], { flag: true }));
    expect(coverage.multi_region.scan).toBeNull();
    expect(coverage.multi_region.region_warnings_unattributed).toEqual([]);
  });

  it('a newest FAILED job\'s Resource Explorer code with no region named is listed; non-RE codes never are', async () => {
    const org = await orgWith('us-east-1', [{ name: 'us-east-1', status: 'ok' }], { flag: true });
    await pool.query(
      `INSERT INTO resource_discovery_jobs (organization_id, status, started_at, completed_at, created_at, resource_types, regions, warnings)
       VALUES ($1, 'failed', $2, $3, $2, '{}', $4, $5::jsonb)`,
      [org.orgId, STARTED, FINISHED, ['us-east-1'], JSON.stringify(['scan_deadline', 'resource_explorer_no_view', 'discovery_listing_truncated'])]
    );
    expect((await coverageOf(org)).multi_region.region_warnings_unattributed).toEqual(['resource_explorer_no_view']);
  });
});

describe('RR-L1: the home region is never excluded', () => {
  it('a completed scan: home with scan_enabled = false reads checked; 2 of 2, all_checked', async () => {
    const org = await orgWith('us-east-1', [{ name: 'us-east-1', status: 'ok', scanEnabled: false }, { name: 'eu-west-1', status: 'ok' }], { flag: true });
    await pool.query(
      `INSERT INTO resource_discovery_jobs (organization_id, status, started_at, completed_at, created_at, resource_types, regions)
       VALUES ($1, 'completed', $2, $3, $2, '{}', $4)`,
      [org.orgId, STARTED, '2026-11-15T10:20:00.000Z', ['us-east-1', 'eu-west-1']]
    );
    const mr = (await coverageOf(org)).multi_region;
    expect(mr.regions[0]).toMatchObject({ region: 'us-east-1', home: true, state: 'checked' });
    expect(mr.regions_checked.by_state.excluded).toBe(0);
    expect(mr.scan).toMatchObject({ regions_total: 2, regions_checked: 2 });
    expect(mr.coverage_status).toBe('all_checked');
  });

  it('during a scan: home with scan_enabled = false is never scan_state excluded; another such region still is', async () => {
    const org = await orgWith('us-east-1', [
      { name: 'us-east-1', status: 'ok', scanEnabled: false },
      { name: 'eu-west-1', status: 'ok', scanEnabled: false },
    ], { flag: true });
    const { rows } = await pool.query(
      `INSERT INTO resource_discovery_jobs (organization_id, status, started_at, created_at, resource_types, regions)
       VALUES ($1, 'running', $2, $2, '{}', $3) RETURNING id`,
      [org.orgId, STARTED, ['us-east-1']]
    );
    await pool.query(
      `INSERT INTO aws_scan_leases (organization_id, aws_account_id, scan_kind, holder, job_id, acquired_at, heartbeat_at, expires_at)
       VALUES ($1, $2, $3, 'pr3a', $4, $5, $5, '2099-01-01T00:00:00Z')`,
      [org.orgId, ACCOUNT, SCAN_KIND_DISCOVERY, rows[0].id, STARTED]
    );
    const mr = (await coverageOf(org)).multi_region;
    const home = mr.regions.find((r: any) => r.region === 'us-east-1');
    const other = mr.regions.find((r: any) => r.region === 'eu-west-1');
    expect(home.scan_state).not.toBe('excluded');
    expect(home.state).not.toBe('excluded');
    expect(other).toMatchObject({ scan_state: 'excluded', state: 'excluded' });
    // The running job has no warnings yet: nothing unattributed.
    expect(mr.region_warnings_unattributed).toEqual([]);
  });
});

/**
 * G6 beyond the doc examples (review of PR 3a's own negative control N3): a region this
 * scan checked and found empty, beside a region whose resources come from an EARLIER scan.
 * The earlier region must never make the scan's regions_with_resources larger.
 */
describe('G6: a region\'s earlier-scan resources never count for the scan described', () => {
  const EARLIER = '2026-11-15T04:00:00.000Z';

  async function insertJob(orgId: string, status: string, started: string, regions: string[]): Promise<string> {
    const { rows } = await pool.query(
      `INSERT INTO resource_discovery_jobs (organization_id, status, started_at, completed_at, created_at, resource_types, regions)
       VALUES ($1, $2, $3, $4, $3, '{}', $5) RETURNING id`,
      [orgId, status, started, status === 'running' ? null : new Date(Date.parse(started) + 20 * 60_000).toISOString(), regions]
    );
    return rows[0].id;
  }

  it('latest_scan_failed: home checked by it and empty; eu-west-1\'s 2 are from the earlier scan → 0 with resources, 1 empty', async () => {
    const org = await orgWith('us-east-1', [
      { name: 'us-east-1', status: 'ok', resources: 0 },
      { name: 'eu-west-1', status: 'ok', started: EARLIER, resources: 2 },
    ], { flag: true });
    await insertJob(org.orgId, 'completed', EARLIER, ['us-east-1', 'eu-west-1']);
    await insertJob(org.orgId, 'failed', STARTED, ['us-east-1']);
    const mr = (await coverageOf(org)).multi_region;
    expect(mr.coverage_status).toBe('latest_scan_failed');
    expect(mr.regions.find((r: any) => r.region === 'eu-west-1')).toMatchObject({ result_of: 'earlier_scan', resources: 2 });
    expect(mr.scan).toMatchObject({ regions_checked: 1, regions_with_resources: 0, regions_empty: 1, regions_zero_with_warnings: 0 });
  });

  it('in_progress: home done in the running scan and empty; eu-west-1 waits with 2 from earlier → 0 with resources, 1 empty', async () => {
    const org = await orgWith('us-east-1', [
      { name: 'us-east-1', status: 'ok', resources: 0 },
      { name: 'eu-west-1', status: 'ok', started: EARLIER, resources: 2 },
    ], { flag: true });
    await insertJob(org.orgId, 'completed', EARLIER, ['us-east-1', 'eu-west-1']);
    const running = await insertJob(org.orgId, 'running', STARTED, ['us-east-1']);
    await pool.query(
      `INSERT INTO aws_scan_leases (organization_id, aws_account_id, scan_kind, holder, job_id, acquired_at, heartbeat_at, expires_at)
       VALUES ($1, $2, $3, 'pr3a', $4, $5, $5, '2099-01-01T00:00:00Z')`,
      [org.orgId, ACCOUNT, SCAN_KIND_DISCOVERY, running, STARTED]
    );
    const mr = (await coverageOf(org)).multi_region;
    expect(mr.coverage_status).toBe('in_progress');
    expect(mr.regions.find((r: any) => r.region === 'eu-west-1')).toMatchObject({ resources_from: 'earlier_success', resources: 2 });
    expect(mr.scan).toMatchObject({ regions_checked: 1, regions_with_resources: 0, regions_empty: 1, regions_zero_with_warnings: 0 });
  });
});
