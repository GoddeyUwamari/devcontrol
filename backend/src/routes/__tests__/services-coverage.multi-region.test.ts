/**
 * Multi-region PR 2: GET /api/services/coverage's multi_region key, for an
 * organization whose multi_region_discovery flag is on (Step 1 §10 "PR 2", founder
 * clarifications C-F). The flag-off response is pinned byte for byte by
 * services-coverage.multi-region-flag-off.contract.test.ts.
 *
 * Policy under test:
 *   - the key exists only with the flag on (no row, or a row saying off: absent);
 *   - not_enabled_regions: the latest list's not-enabled regions only;
 *   - each enabled region: home first, its last recorded result, codes on
 *     MULTI_REGION_ERROR_CODES only (never the stored message), opt-in marked;
 *   - scan selection (mock state (d)): while a scan runs, its progress and, per
 *     region, done / running / waiting; a region done in it shows the running scan's
 *     result, every other its earlier one, clearly marked (result_of); a running or
 *     waiting region never shows what the running scan wrote so far, and never 0
 *     unless its earlier result was 0 (null when never scanned);
 *   - with no scan running: the latest scan's results, progress null;
 *   - a held lease whose job finished, or a running job whose lease is gone: no progress;
 *   - regions_checked, savings_regions (the home region only, FD-1), region_warnings
 *     with their region (RR-M2) and whether they can be complete;
 *   - tenant isolation: by the explicit predicates (superuser) and by row-level
 *     security alone (as the non-superuser devcontrol role);
 *   - no AWS call (the route module's import rule is in services-coverage.test.ts).
 *
 * Real routes over an in-process HTTP server against live Postgres. Only
 * authService.verifyToken is stubbed. Placeholders only.
 */
import { Client } from 'pg';
import { EC2Client } from '@aws-sdk/client-ec2';
import { AWSClientFactory } from '../../services/aws-client-factory.service';
import { ScanContext } from '../../services/scan-context';
import servicesCoverageRoutes, { MULTI_REGION_ERROR_CODES, REGION_WARNING_CODES, readServicesCoverage } from '../services-coverage.routes';
import servicesRoutes from '../services.routes';
import { SCAN_KIND_DISCOVERY } from '../../services/scan-session';
import {
  REGION_CODE_ACCESS_DENIED,
  REGION_CODE_ACCESS_DENIED_SCP,
  REGION_CODE_CALL_TIMEOUT,
  REGION_CODE_DEADLINE,
  REGION_CODE_ERROR,
  REGION_CODE_NOT_READY,
  REGION_CODE_SCAN_BUDGET,
  REGION_CODE_THROTTLED,
} from '../../services/region-run';
import { createRoleGateHarness, RoleGateOrg } from './role-gate-harness';
import { ensureSharedFixtureTable } from './shared-fixture-tables';

const harness = createRoleGateHarness('services-coverage-mr');
const { pool } = harness;

const ACCOUNT = '123456789012';
const HOME = 'us-east-1';
const TYPES = ['ec2', 'ebs', 'rds', 's3', 'lambda', 'load-balancer', 'cloudfront', 'sqs'];
const LIST_LATEST = '2026-03-02T09:59:00.000Z';
const LIST_OLD = '2026-02-01T09:00:00.000Z';
const EARLIER_START = '2026-03-01T10:00:00.000Z';
const SCAN_START = '2026-03-02T10:00:00.000Z';
const BEFORE_SCAN = '2026-02-20T08:00:00.000Z';
const DURING_SCAN = '2026-03-02T10:02:00.000Z';

// Every statement the app runs (as services-coverage.test.ts records them).
interface Recorded { text: string; values: unknown[] }
const originalClientQuery = Client.prototype.query;
const recorded: Recorded[] = [];

let seq = 0;

async function insertAccount(orgId: string, region = HOME): Promise<void> {
  seq += 1;
  await pool.query(
    `INSERT INTO aws_accounts (org_id, role_arn, account_id, external_id, region, connected_at, status)
     VALUES ($1, $2, $3, 'external-id-1', $4, NOW(), 'active')`,
    [orgId, `arn:aws:iam::${ACCOUNT}:role/DevControlRole`, `mr-${seq}-${orgId}`.slice(0, 32), region]
  );
}

async function setFlag(orgId: string, enabled: boolean): Promise<void> {
  await pool.query(
    `INSERT INTO organization_feature_flags (organization_id, flag, enabled, set_by, note) VALUES ($1, 'multi_region_discovery', $2, 'test', 'test')`,
    [orgId, enabled]
  );
}

async function insertJob(orgId: string, status: string, startedAt: string, regions: string[], completedAt: string | null = null): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO resource_discovery_jobs (organization_id, status, started_at, completed_at, created_at, resource_types, regions)
     VALUES ($1, $2, $3, $4, $3, $5, $6) RETURNING id`,
    [orgId, status, startedAt, completedAt, TYPES, regions]
  );
  return rows[0].id;
}

async function insertLease(orgId: string, jobId: string | null, { expired = false, released = false } = {}): Promise<void> {
  await pool.query(
    `INSERT INTO aws_scan_leases (organization_id, aws_account_id, scan_kind, holder, job_id, acquired_at, heartbeat_at, expires_at, released_at)
     VALUES ($1, $2, $3, 'test-holder', $4, $5, $5, $6, $7)`,
    [orgId, ACCOUNT, SCAN_KIND_DISCOVERY, jobId, SCAN_START, expired ? '2026-03-02T10:05:00Z' : '2099-01-01T00:00:00Z', released ? '2026-03-02T10:06:00Z' : null]
  );
}

interface RegionRow {
  optIn?: string;
  enabled?: boolean;
  listedAt?: string;
  status?: string;
  started?: string | null;
  finished?: string | null;
  success?: string | null;
  code?: string | null;
  message?: string | null;
}

async function insertRegion(orgId: string, region: string, r: RegionRow = {}, account = ACCOUNT): Promise<void> {
  const status = r.status ?? 'never_scanned';
  const started = r.started === undefined ? (status === 'never_scanned' ? null : EARLIER_START) : r.started;
  const finished = r.finished === undefined ? (started ? new Date(Date.parse(started) + 180_000).toISOString() : null) : r.finished;
  await pool.query(
    `INSERT INTO aws_account_regions
       (organization_id, aws_account_id, region, opt_in_status, enabled, last_listed_at, last_scan_status,
        last_scan_started_at, last_scan_finished_at, last_success_at, last_error_code, last_error_message)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      orgId, account, region, r.optIn ?? (r.enabled === false ? 'not-opted-in' : 'opt-in-not-required'), r.enabled ?? true,
      r.listedAt ?? LIST_LATEST, status, started, finished, r.success === undefined ? (status === 'ok' ? finished : null) : r.success,
      r.code ?? null, r.message ?? null,
    ]
  );
}

async function insertResource(orgId: string, name: string, type: string, region: string, discovered: string, status = 'running'): Promise<void> {
  await pool.query(
    `INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status, tags, metadata, first_discovered_at, created_at)
     VALUES ($1, $2, $3, $3, $4, $5, $6, '{}', '{}', $7, $7)`,
    [orgId, `arn:aws:${type}:${region}:${ACCOUNT}:resource/${name}-${orgId.slice(0, 8)}`, `${name}-${orgId.slice(0, 8)}`, type, region, status, discovered]
  );
}

async function coverageOf(org: RoleGateOrg) {
  const res = await harness.sendAs(org.orgId, org.viewer, 'GET', '/services/coverage');
  expect(res.status).toBe(200);
  return (await res.json()).coverage;
}

/** A by_state record: every state, 0 unless given (review M-2). */
const byState = (counts: Partial<Record<string, number>> = {}) =>
  Object.fromEntries(['not_started', 'in_progress', 'checked', 'checked_with_warnings', 'failed', 'not_checked_budget', 'not_checked_deadline', 'denied', 'not_ready', 'excluded'].map((s) => [s, counts[s] ?? 0]));

/** The flagged organization's regions by name. */
const byRegion = (coverage: any) => Object.fromEntries(coverage.multi_region.regions.map((r: any) => [r.region, r]));

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

// ---------------------------------------------------------------------------
describe('the key exists only with the flag on', () => {
  it('no flag row and a row saying off: no multi_region key; a row saying on: the key', async () => {
    const none = await harness.buildOrg();
    const off = await harness.buildOrg();
    const on = await harness.buildOrg();
    for (const org of [none, off, on]) await insertAccount(org.orgId);
    await setFlag(off.orgId, false);
    await setFlag(on.orgId, true);
    expect(await coverageOf(none)).not.toHaveProperty('multi_region');
    expect(await coverageOf(off)).not.toHaveProperty('multi_region');
    expect(await coverageOf(on)).toHaveProperty('multi_region');
  });

  it('a flag that cannot be read is off: the response is the flag-off one, never a failure', async () => {
    const org = await harness.buildOrg();
    await insertAccount(org.orgId);
    await setFlag(org.orgId, true);
    // The route's own read, on an executor that refuses only the flag statement.
    const executor = {
      query: (text: string, values?: unknown[]) =>
        /FROM organization_feature_flags/.test(text)
          ? Promise.reject(Object.assign(new Error('boom'), { name: 'PlaceholderError' }))
          : pool.query(text, values as any[]),
    };
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const unreadable = await readServicesCoverage(executor, org.orgId);
    expect(unreadable).not.toHaveProperty('multi_region');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('multi_region_flag_unreadable'));
    // The same read with the flag readable has the key.
    expect(await readServicesCoverage({ query: (text: string, values?: unknown[]) => pool.query(text, values as any[]) }, org.orgId)).toHaveProperty('multi_region');
  });
});

// ---------------------------------------------------------------------------
describe('no scan running: the latest scan', () => {
  let org: RoleGateOrg;
  beforeAll(async () => {
    org = await harness.buildOrg();
    await insertAccount(org.orgId);
    await setFlag(org.orgId, true);
    await insertJob(org.orgId, 'completed', EARLIER_START, [HOME, 'eu-west-1', 'ap-south-1', 'me-central-1'], '2026-03-01T10:05:00Z');
    await insertRegion(org.orgId, HOME, { status: 'ok' });
    await insertRegion(org.orgId, 'eu-west-1', { status: 'ok', code: 'resource_explorer_no_view' });
    await insertRegion(org.orgId, 'ap-south-1', { status: 'denied', code: REGION_CODE_ACCESS_DENIED_SCP, message: 'stored text naming arn:aws:iam::123456789012:role/x' });
    await insertRegion(org.orgId, 'me-central-1', { optIn: 'opted-in', status: 'partial', code: 'discovery_listing_truncated' });
    await insertRegion(org.orgId, 'us-west-2', {});
    await insertRegion(org.orgId, 'ca-central-1', { status: 'failed', code: 'SomethingNotAllowed' });
    await insertRegion(org.orgId, 'ap-east-1', { enabled: false });
    await insertRegion(org.orgId, 'me-south-1', { enabled: false });
    // Missing from the latest list: never reported, enabled or not.
    await insertRegion(org.orgId, 'sa-east-1', { listedAt: LIST_OLD, status: 'ok' });
    await insertRegion(org.orgId, 'af-south-1', { listedAt: LIST_OLD, enabled: false });
    await insertResource(org.orgId, 'home-1', 'ec2', HOME, BEFORE_SCAN);
    await insertResource(org.orgId, 'home-2', 'ec2', HOME, DURING_SCAN);
    await insertResource(org.orgId, 'home-gone', 'ec2', HOME, BEFORE_SCAN, 'terminated');
    await insertResource(org.orgId, 'eu-1', 'sqs', 'eu-west-1', BEFORE_SCAN, 'active');
    // A never-scanned region's S3 bucket: in the top-level counts, not as a region result.
    await insertResource(org.orgId, 'west-bucket', 's3', 'us-west-2', BEFORE_SCAN, 'active');
  });

  it('every enabled region of the latest list, home first then by name, with its latest result; progress null', async () => {
    const coverage = await coverageOf(org);
    const mr = coverage.multi_region;
    expect(mr.regions.map((r: any) => r.region)).toEqual([HOME, 'ap-south-1', 'ca-central-1', 'eu-west-1', 'me-central-1', 'us-west-2']);
    expect(mr.progress).toBeNull();
    const regions = byRegion(coverage);
    // Written by the newest scan (review M-1): 'latest_scan'.
    expect(regions[HOME]).toMatchObject({ home: true, opt_in: false, status: 'ok', error_code: null, result_of: 'latest_scan', scan_state: null, resources: 2, resources_from: 'last_result', empty: false });
    expect(regions['eu-west-1']).toMatchObject({ home: false, status: 'ok', error_code: 'resource_explorer_no_view', resources: 1, resources_from: 'last_result' });
    // Review H-1 (fixed): denied by an SCP with no earlier success: never checked, so no count (was 0).
    expect(regions['ap-south-1']).toMatchObject({ status: 'denied', error_code: REGION_CODE_ACCESS_DENIED_SCP, resources: null, resources_from: null, empty: false });
    // partial is a successful check: its rows are counted, but it is never "empty".
    expect(regions['me-central-1']).toMatchObject({ opt_in: true, status: 'partial', error_code: 'discovery_listing_truncated', resources: 0, resources_from: 'last_result', empty: false });
    // A code outside the allow-list is null; the stored message never leaves the database.
    expect(regions['ca-central-1']).toMatchObject({ status: 'failed', error_code: null });
    expect(JSON.stringify(coverage)).not.toContain('stored text');
    // Never scanned: no result, no count (its S3 bucket is in the top-level regions counts).
    expect(regions['us-west-2']).toMatchObject({ status: 'never_scanned', result_of: null, resources: null, resources_from: null, empty: false, last_scan_finished_at: null });
    expect(coverage.regions).toContainEqual({ region: 'us-west-2', count: 1 });
  });

  it('not_enabled_regions: the latest list\'s not-enabled regions only, by name', async () => {
    expect((await coverageOf(org)).multi_region.not_enabled_regions).toEqual(['ap-east-1', 'me-south-1']);
  });

  it('regions_checked, savings_regions (home only) and region-scoped warnings with their region', async () => {
    const mr = (await coverageOf(org)).multi_region;
    expect(mr.regions_checked).toEqual({
      enabled: 6, complete: 2, partial: 1, not_checked: 2, not_reached: 0, never_scanned: 1,
      by_state: byState({ checked: 1, checked_with_warnings: 2, denied: 1, failed: 1, not_started: 1 }),
    });
    expect(mr.home_region).toBe(HOME);
    expect(mr.savings_regions).toEqual([HOME]);
    expect(mr.region_warnings).toEqual([
      { code: 'resource_explorer_no_view', region: 'eu-west-1' },
      { code: 'discovery_listing_truncated', region: 'me-central-1' },
    ]);
    // Regions with another outcome (denied, failed, partial) could hide a Resource Explorer code.
    expect(mr.region_warnings_complete).toBe(false);
  });

  it('every scanned region ok: region_warnings can name every region', async () => {
    const clean = await harness.buildOrg();
    await insertAccount(clean.orgId);
    await setFlag(clean.orgId, true);
    await insertRegion(clean.orgId, HOME, { status: 'ok' });
    await insertRegion(clean.orgId, 'eu-west-1', { status: 'ok', code: 'resource_explorer_no_index' });
    await insertRegion(clean.orgId, 'us-west-2', {});
    const mr = (await coverageOf(clean)).multi_region;
    expect(mr.region_warnings).toEqual([{ code: 'resource_explorer_no_index', region: 'eu-west-1' }]);
    expect(mr.region_warnings_complete).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('a scan in progress (mock state (d)): its progress, and each region\'s last result, marked', () => {
  let org: RoleGateOrg;
  beforeAll(async () => {
    org = await harness.buildOrg();
    await insertAccount(org.orgId);
    await setFlag(org.orgId, true);
    await insertJob(org.orgId, 'completed', EARLIER_START, [HOME, 'eu-west-1', 'ap-south-1', 'ap-northeast-1'], '2026-03-01T10:05:00Z');
    // The running scan has started home and eu-west-1 (resource_discovery_jobs.regions).
    const running = await insertJob(org.orgId, 'running', SCAN_START, [HOME, 'eu-west-1']);
    await insertLease(org.orgId, running);
    // Home: done in the running scan (its status was written by it).
    await insertRegion(org.orgId, HOME, { status: 'ok', started: SCAN_START });
    // eu-west-1: running; its earlier result was ok with 2 resources.
    await insertRegion(org.orgId, 'eu-west-1', { status: 'ok' });
    // ap-south-1: waiting; its earlier result found 1 resource.
    await insertRegion(org.orgId, 'ap-south-1', { status: 'ok' });
    // ap-northeast-1: waiting; its earlier result found nothing (0 is that result).
    await insertRegion(org.orgId, 'ap-northeast-1', { status: 'ok' });
    // us-west-2: waiting, never scanned.
    await insertRegion(org.orgId, 'us-west-2', {});
    await insertRegion(org.orgId, 'ap-east-1', { enabled: false });

    await insertResource(org.orgId, 'home-old', 'ec2', HOME, BEFORE_SCAN);
    await insertResource(org.orgId, 'home-new', 'ec2', HOME, DURING_SCAN);
    await insertResource(org.orgId, 'eu-old-1', 'ec2', 'eu-west-1', BEFORE_SCAN);
    await insertResource(org.orgId, 'eu-old-2', 'sqs', 'eu-west-1', BEFORE_SCAN, 'active');
    // What the running scan has written in eu-west-1 so far, and an S3 bucket its S3
    // listing (before the regions) stored in ap-south-1: neither is an earlier result.
    await insertResource(org.orgId, 'eu-new', 'ec2', 'eu-west-1', DURING_SCAN);
    await insertResource(org.orgId, 'ap-old', 'rds', 'ap-south-1', BEFORE_SCAN, 'available');
    await insertResource(org.orgId, 'ap-new-bucket', 's3', 'ap-south-1', DURING_SCAN, 'active');
  });

  it('progress: 1 of 5 done, 1 running, 3 waiting; since the running job\'s start', async () => {
    const mr = (await coverageOf(org)).multi_region;
    expect(mr.progress).toEqual({ scan_started_at: SCAN_START, regions_total: 5, regions_done: 1, regions_running: 1, regions_waiting: 3 });
  });

  it('per region: done shows the running scan\'s result; running and waiting show the earlier one, marked, never its partial writes', async () => {
    const regions = byRegion(await coverageOf(org));
    expect(regions[HOME]).toMatchObject({ scan_state: 'done', result_of: 'running_scan', status: 'ok', resources: 2, resources_from: 'last_result' });
    expect(regions['eu-west-1']).toMatchObject({ scan_state: 'running', result_of: 'earlier_scan', status: 'ok', resources: 2, resources_from: 'earlier_success', empty: false });
    expect(regions['ap-south-1']).toMatchObject({ scan_state: 'waiting', result_of: 'earlier_scan', resources: 1, resources_from: 'earlier_success' });
    // Its last SUCCESSFUL check found nothing: that 0 is shown, marked as the earlier
    // success, and never "empty" while the region waits (founder decision H-1).
    expect(regions['ap-northeast-1']).toMatchObject({ scan_state: 'waiting', result_of: 'earlier_scan', resources: 0, resources_from: 'earlier_success', empty: false });
    expect(regions['us-west-2']).toMatchObject({ scan_state: 'waiting', result_of: null, resources: null, resources_from: null, empty: false });
  });

  it('a running or waiting region never reads the 0 a per-scan count would give it', async () => {
    const regions = byRegion(await coverageOf(org));
    for (const region of ['eu-west-1', 'ap-south-1']) {
      expect(regions[region].resources).toBeGreaterThan(0);
    }
  });

  it('the moment a region is done, it shows the running scan\'s result (rows written by it included)', async () => {
    const done = await harness.buildOrg();
    await insertAccount(done.orgId);
    await setFlag(done.orgId, true);
    const running = await insertJob(done.orgId, 'running', SCAN_START, [HOME, 'eu-west-1']);
    await insertLease(done.orgId, running);
    await insertRegion(done.orgId, HOME, { status: 'ok', started: SCAN_START });
    await insertRegion(done.orgId, 'eu-west-1', { status: 'ok', started: SCAN_START });
    await insertResource(done.orgId, 'eu-old', 'ec2', 'eu-west-1', BEFORE_SCAN);
    await insertResource(done.orgId, 'eu-new', 'ec2', 'eu-west-1', DURING_SCAN);
    const coverage = await coverageOf(done);
    expect(byRegion(coverage)['eu-west-1']).toMatchObject({ scan_state: 'done', result_of: 'running_scan', resources: 2 });
    expect(coverage.multi_region.progress).toMatchObject({ regions_total: 2, regions_done: 2, regions_running: 0, regions_waiting: 0 });
  });

  it('before the first region starts (the scan empties its region list when it begins): every region waiting', async () => {
    const early = await harness.buildOrg();
    await insertAccount(early.orgId);
    await setFlag(early.orgId, true);
    const running = await insertJob(early.orgId, 'running', SCAN_START, []);
    await insertLease(early.orgId, running);
    await insertRegion(early.orgId, HOME, { status: 'ok' });
    await insertRegion(early.orgId, 'eu-west-1', { status: 'ok' });
    const mr = (await coverageOf(early)).multi_region;
    expect(mr.progress).toMatchObject({ regions_total: 2, regions_done: 0, regions_running: 0, regions_waiting: 2 });
    expect(mr.regions.map((r: any) => r.scan_state)).toEqual(['waiting', 'waiting']);
  });

  it('no region list stored yet: the scan covers the home region only (the scanner\'s rule)', async () => {
    const unlisted = await harness.buildOrg();
    await insertAccount(unlisted.orgId);
    await setFlag(unlisted.orgId, true);
    const running = await insertJob(unlisted.orgId, 'running', SCAN_START, [HOME]);
    await insertLease(unlisted.orgId, running);
    const mr = (await coverageOf(unlisted)).multi_region;
    expect(mr.regions).toEqual([]);
    expect(mr.not_enabled_regions).toEqual([]);
    expect(mr.regions_checked).toEqual({ enabled: null, complete: 0, partial: 0, not_checked: 0, not_reached: 0, never_scanned: 0, by_state: byState() });
    expect(mr.progress).toMatchObject({ regions_total: 1, regions_done: 0, regions_running: 1, regions_waiting: 0 });
  });
});

// ---------------------------------------------------------------------------
describe('review H-1: a count (including 0) only when a successful check backs it; empty only for a successful check that found nothing', () => {
  /** A flagged organization, a home region checked ok with one resource, and `regions` as given. */
  async function orgWithRegions(regions: Array<[string, RegionRow]>, scan?: { started: string[] }) {
    const org = await harness.buildOrg();
    await insertAccount(org.orgId);
    await setFlag(org.orgId, true);
    if (scan) {
      const running = await insertJob(org.orgId, 'running', SCAN_START, scan.started);
      await insertLease(org.orgId, running);
      await insertRegion(org.orgId, HOME, { status: 'ok', started: SCAN_START });
    } else {
      await insertJob(org.orgId, 'completed', EARLIER_START, [HOME], '2026-03-01T10:05:00Z');
      await insertRegion(org.orgId, HOME, { status: 'ok' });
    }
    await insertResource(org.orgId, 'home-1', 'ec2', HOME, BEFORE_SCAN);
    for (const [name, row] of regions) await insertRegion(org.orgId, name, row);
    return org;
  }
  const view = (r: any) => ({ resources: r.resources, resources_from: r.resources_from, empty: r.empty });
  const NONE = { resources: null, resources_from: null, empty: false };

  it('no scan running (PB1): never reached (scan budget), not ready, denied, failed and timed out with no earlier success read null, never 0', async () => {
    const org = await orgWithRegions([
      ['eu-west-1', { status: 'timed_out', code: REGION_CODE_SCAN_BUDGET }],
      ['ap-south-1', { status: 'failed', code: REGION_CODE_NOT_READY }],
      ['me-central-1', { status: 'denied', code: REGION_CODE_ACCESS_DENIED }],
      ['ca-central-1', { status: 'failed', code: REGION_CODE_ERROR }],
      ['sa-east-1', { status: 'timed_out', code: REGION_CODE_DEADLINE }],
    ]);
    const regions = byRegion(await coverageOf(org));
    for (const name of ['eu-west-1', 'ap-south-1', 'me-central-1', 'ca-central-1', 'sa-east-1']) expect([name, view(regions[name])]).toEqual([name, NONE]);
  });

  it('terminal empty: an ok region (no warning) checked with nothing found, no scan running: 0 and empty', async () => {
    const org = await orgWithRegions([['us-west-2', { status: 'ok' }]]);
    expect(view(byRegion(await coverageOf(org))['us-west-2'])).toEqual({ resources: 0, resources_from: 'last_result', empty: true });
  });

  it('ok with a Resource Explorer warning and 0 rows: counted, but not empty (the generic types were not listed)', async () => {
    const org = await orgWithRegions([['us-west-2', { status: 'ok', code: 'resource_explorer_no_index' }]]);
    expect(view(byRegion(await coverageOf(org))['us-west-2'])).toEqual({ resources: 0, resources_from: 'last_result', empty: false });
  });

  it('failed, not empty: a failed region with no earlier success and stored rows (e.g. S3) still reads null; with an earlier success, the rows kept from it', async () => {
    const org = await orgWithRegions([
      ['eu-west-1', { status: 'failed', code: REGION_CODE_ERROR }],
      ['ap-south-1', { status: 'denied', code: REGION_CODE_ACCESS_DENIED, success: '2026-02-25T10:00:00.000Z' }],
    ]);
    await insertResource(org.orgId, 'eu-bucket', 's3', 'eu-west-1', BEFORE_SCAN, 'active');
    await insertResource(org.orgId, 'ap-db', 'rds', 'ap-south-1', BEFORE_SCAN, 'available');
    const regions = byRegion(await coverageOf(org));
    expect(view(regions['eu-west-1'])).toEqual(NONE);
    expect(view(regions['ap-south-1'])).toEqual({ resources: 1, resources_from: 'earlier_success', empty: false });
  });

  it('an earlier success that found nothing, then a failure: 0 from the earlier success, never empty', async () => {
    const org = await orgWithRegions([['eu-west-1', { status: 'timed_out', code: REGION_CODE_DEADLINE, success: '2026-02-25T10:00:00.000Z' }]]);
    expect(view(byRegion(await coverageOf(org))['eu-west-1'])).toEqual({ resources: 0, resources_from: 'earlier_success', empty: false });
  });

  it('scan running (PB2): a waiting region whose earlier result was the scan budget or a failure reads null, never 0', async () => {
    const org = await orgWithRegions(
      [
        ['eu-west-1', { status: 'timed_out', code: REGION_CODE_SCAN_BUDGET }],
        ['ap-south-1', { status: 'failed', code: REGION_CODE_ERROR }],
        ['me-central-1', { status: 'never_scanned' }],
      ],
      { started: [HOME] }
    );
    const regions = byRegion(await coverageOf(org));
    for (const name of ['eu-west-1', 'ap-south-1', 'me-central-1']) {
      expect([name, regions[name].scan_state, view(regions[name])]).toEqual([name, 'waiting', NONE]);
    }
  });

  it('scan running: a region done in it with nothing found is empty; a running region never is', async () => {
    const org = await orgWithRegions(
      [
        ['eu-west-1', { status: 'ok', started: SCAN_START }],
        ['ap-south-1', { status: 'ok' }],
      ],
      { started: [HOME, 'eu-west-1', 'ap-south-1'] }
    );
    const regions = byRegion(await coverageOf(org));
    expect([regions['eu-west-1'].scan_state, view(regions['eu-west-1'])]).toEqual(['done', { resources: 0, resources_from: 'last_result', empty: true }]);
    expect([regions['ap-south-1'].scan_state, view(regions['ap-south-1'])]).toEqual(['running', { resources: 0, resources_from: 'earlier_success', empty: false }]);
  });
});

// ---------------------------------------------------------------------------
describe('review M-2: one state per region; the scan budget is never counted as a failure', () => {
  it('every recorded outcome maps to its own state; status and error_code keep the detail', async () => {
    const org = await harness.buildOrg();
    await insertAccount(org.orgId);
    await setFlag(org.orgId, true);
    const cases: Array<[string, RegionRow, string]> = [
      [HOME, { status: 'ok' }, 'checked'],
      ['eu-west-1', { status: 'ok', code: 'resource_explorer_no_index' }, 'checked_with_warnings'],
      ['eu-west-2', { status: 'partial', code: 'discovery_listing_truncated' }, 'checked_with_warnings'],
      ['eu-west-3', { status: 'failed', code: REGION_CODE_ERROR }, 'failed'],
      ['eu-north-1', { status: 'timed_out', code: REGION_CODE_THROTTLED }, 'failed'],
      ['eu-south-1', { status: 'timed_out', code: REGION_CODE_CALL_TIMEOUT }, 'failed'],
      ['ap-south-1', { status: 'timed_out', code: REGION_CODE_SCAN_BUDGET }, 'not_checked_budget'],
      ['ap-south-2', { status: 'timed_out', code: REGION_CODE_DEADLINE }, 'not_checked_deadline'],
      ['ca-central-1', { status: 'denied', code: REGION_CODE_ACCESS_DENIED }, 'denied'],
      ['ca-west-1', { status: 'denied', code: REGION_CODE_ACCESS_DENIED_SCP }, 'denied'],
      ['me-central-1', { status: 'failed', code: REGION_CODE_NOT_READY }, 'not_ready'],
      ['us-west-2', {}, 'not_started'],
    ];
    for (const [name, row] of cases) await insertRegion(org.orgId, name, row);
    const regions = byRegion(await coverageOf(org));
    for (const [name, row, state] of cases) {
      expect([name, regions[name].state, regions[name].status, regions[name].error_code]).toEqual([name, state, row.status ?? 'never_scanned', row.code ?? null]);
    }
  });

  it('a scan-budget region through the API: timed_out / scan_budget / not_checked_budget, no count, counted as not reached (never as not checked or failed), never a warning', async () => {
    const org = await harness.buildOrg();
    await insertAccount(org.orgId);
    await setFlag(org.orgId, true);
    await insertJob(org.orgId, 'completed', EARLIER_START, [HOME], '2026-03-01T10:05:00Z');
    await insertRegion(org.orgId, HOME, { status: 'ok' });
    await insertRegion(org.orgId, 'eu-west-1', { status: 'timed_out', code: REGION_CODE_SCAN_BUDGET });
    await insertRegion(org.orgId, 'ap-south-1', { status: 'failed', code: REGION_CODE_ERROR });
    const mr = (await coverageOf(org)).multi_region;
    expect(byRegion({ multi_region: mr })['eu-west-1']).toMatchObject({
      status: 'timed_out', error_code: REGION_CODE_SCAN_BUDGET, state: 'not_checked_budget', resources: null, empty: false,
    });
    expect(mr.regions_checked).toEqual({
      enabled: 3, complete: 1, partial: 0, not_checked: 1, not_reached: 1, never_scanned: 0,
      by_state: byState({ checked: 1, not_checked_budget: 1, failed: 1 }),
    });
    expect(mr.region_warnings).toEqual([]);
  });

  it('while a scan runs: running is in_progress, waiting is not_started (whatever its earlier result), done is its new result', async () => {
    const org = await harness.buildOrg();
    await insertAccount(org.orgId);
    await setFlag(org.orgId, true);
    const running = await insertJob(org.orgId, 'running', SCAN_START, [HOME, 'eu-west-1']);
    await insertLease(org.orgId, running);
    await insertRegion(org.orgId, HOME, { status: 'partial', code: 'discovery_listing_truncated', started: SCAN_START });
    await insertRegion(org.orgId, 'eu-west-1', { status: 'denied', code: REGION_CODE_ACCESS_DENIED });
    await insertRegion(org.orgId, 'ap-south-1', { status: 'ok' });
    const mr = (await coverageOf(org)).multi_region;
    const regions = byRegion({ multi_region: mr });
    expect([regions[HOME].state, regions['eu-west-1'].state, regions['ap-south-1'].state]).toEqual(['checked_with_warnings', 'in_progress', 'not_started']);
    expect(mr.regions_checked.by_state).toEqual(byState({ checked_with_warnings: 1, in_progress: 1, not_started: 1 }));
  });

  it('review L-1: a region the allow-list excludes (scan_enabled = false) is excluded, never waiting, and outside the scan\'s progress', async () => {
    const org = await harness.buildOrg();
    await insertAccount(org.orgId);
    await setFlag(org.orgId, true);
    const running = await insertJob(org.orgId, 'running', SCAN_START, [HOME]);
    await insertLease(org.orgId, running);
    await insertRegion(org.orgId, HOME, { status: 'ok', started: SCAN_START });
    await insertRegion(org.orgId, 'eu-west-1', {});
    await pool.query(`UPDATE aws_account_regions SET scan_enabled = false WHERE organization_id = $1 AND region = 'eu-west-1'`, [org.orgId]);
    const mr = (await coverageOf(org)).multi_region;
    expect(byRegion({ multi_region: mr })['eu-west-1']).toMatchObject({ scan_state: 'excluded', state: 'excluded' });
    expect(mr.progress).toMatchObject({ regions_total: 1, regions_done: 1, regions_waiting: 0 });
    expect(mr.regions_checked.by_state.excluded).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe('review M-1: the scan described (id, status, times) and one overall coverage status', () => {
  async function flagged() {
    const org = await harness.buildOrg();
    await insertAccount(org.orgId);
    await setFlag(org.orgId, true);
    return org;
  }

  it('PB6: a newer attempt failed after one region: latest_scan_failed, 1 of 3 checked by it, never "3 of 3"; the others are marked earlier_scan', async () => {
    const org = await flagged();
    await insertJob(org.orgId, 'completed', EARLIER_START, [HOME, 'eu-west-1', 'ap-south-1'], '2026-03-01T10:30:00Z');
    const failed = await insertJob(org.orgId, 'failed', SCAN_START, [HOME], '2026-03-02T10:10:00Z');
    await insertRegion(org.orgId, HOME, { status: 'ok', started: SCAN_START });
    await insertRegion(org.orgId, 'eu-west-1', { status: 'ok' });
    await insertRegion(org.orgId, 'ap-south-1', { status: 'ok' });
    const mr = (await coverageOf(org)).multi_region;
    expect(mr.coverage_status).toBe('latest_scan_failed');
    expect(mr.scan).toEqual({ id: failed, status: 'failed', started_at: SCAN_START, completed_at: '2026-03-02T10:10:00.000Z', regions_total: 3, regions_checked: 1,
      // PR 3a (G6): the one region this scan checked (home, ok, no resources) is empty.
      regions_with_resources: 0, regions_empty: 1, regions_zero_with_warnings: 0 });
    expect(mr.regions.map((r: any) => [r.region, r.result_of])).toEqual([[HOME, 'latest_scan'], ['ap-south-1', 'earlier_scan'], ['eu-west-1', 'earlier_scan']]);
  });

  it('all_checked: the newest scan completed and wrote a checked result (warnings included) for every region it covers', async () => {
    const org = await flagged();
    const done = await insertJob(org.orgId, 'completed', EARLIER_START, [HOME, 'eu-west-1', 'ap-south-1'], '2026-03-01T10:30:00Z');
    await insertRegion(org.orgId, HOME, { status: 'ok' });
    await insertRegion(org.orgId, 'eu-west-1', { status: 'ok', code: 'resource_explorer_no_view' });
    await insertRegion(org.orgId, 'ap-south-1', { status: 'partial', code: 'discovery_listing_truncated' });
    await insertRegion(org.orgId, 'ap-east-1', { enabled: false });
    const mr = (await coverageOf(org)).multi_region;
    expect(mr.coverage_status).toBe('all_checked');
    expect(mr.scan).toMatchObject({ id: done, status: 'completed', regions_total: 3, regions_checked: 3 });
  });

  it.each([
    ['the scan budget', { status: 'timed_out', code: REGION_CODE_SCAN_BUDGET }],
    ['a regional failure', { status: 'denied', code: REGION_CODE_ACCESS_DENIED }],
    ['a deadline', { status: 'timed_out', code: REGION_CODE_DEADLINE }],
  ] as Array<[string, RegionRow]>)('completed_with_regions_not_checked: the newest scan completed, one region not checked by it (%s)', async (_label, row) => {
    const org = await flagged();
    await insertJob(org.orgId, 'completed', EARLIER_START, [HOME, 'eu-west-1'], '2026-03-01T10:30:00Z');
    await insertRegion(org.orgId, HOME, { status: 'ok' });
    await insertRegion(org.orgId, 'eu-west-1', row);
    const mr = (await coverageOf(org)).multi_region;
    expect(mr.coverage_status).toBe('completed_with_regions_not_checked');
    expect(mr.scan).toMatchObject({ regions_total: 2, regions_checked: 1 });
  });

  it('a completed scan that never wrote a region\'s result (an older ok stays): not all checked by it', async () => {
    const org = await flagged();
    await insertJob(org.orgId, 'completed', SCAN_START, [HOME], '2026-03-02T10:30:00Z');
    await insertRegion(org.orgId, HOME, { status: 'ok', started: SCAN_START });
    await insertRegion(org.orgId, 'eu-west-1', { status: 'ok' });
    expect((await coverageOf(org)).multi_region).toMatchObject({ coverage_status: 'completed_with_regions_not_checked', scan: { regions_total: 2, regions_checked: 1 } });
  });

  it('in_progress: the running job is the scan described (its id), counted by the regions done in it', async () => {
    const org = await flagged();
    await insertJob(org.orgId, 'completed', EARLIER_START, [HOME, 'eu-west-1'], '2026-03-01T10:30:00Z');
    const running = await insertJob(org.orgId, 'running', SCAN_START, [HOME, 'eu-west-1']);
    await insertLease(org.orgId, running);
    await insertRegion(org.orgId, HOME, { status: 'ok', started: SCAN_START });
    await insertRegion(org.orgId, 'eu-west-1', { status: 'ok' });
    const mr = (await coverageOf(org)).multi_region;
    expect(mr.coverage_status).toBe('in_progress');
    expect(mr.scan).toEqual({ id: running, status: 'running', started_at: SCAN_START, completed_at: null, regions_total: 2, regions_checked: 1,
      // PR 3a (G6): only the region done in the running scan (home, ok, no resources) is split.
      regions_with_resources: 0, regions_empty: 1, regions_zero_with_warnings: 0 });
  });

  it('unavailable: no scan has run, or no region list is stored', async () => {
    const none = await flagged();
    await insertRegion(none.orgId, HOME, {});
    expect((await coverageOf(none)).multi_region).toMatchObject({ scan: null, coverage_status: 'unavailable' });
    const unlisted = await flagged();
    await insertJob(unlisted.orgId, 'completed', EARLIER_START, [HOME], '2026-03-01T10:30:00Z');
    expect((await coverageOf(unlisted)).multi_region).toMatchObject({ coverage_status: 'unavailable', scan: { status: 'completed', regions_total: 1, regions_checked: 0 } });
  });
});

// ---------------------------------------------------------------------------
describe('review M-4: the remaining required tests', () => {
  async function flagged() {
    const org = await harness.buildOrg();
    await insertAccount(org.orgId);
    await setFlag(org.orgId, true);
    return org;
  }

  it('scan_deadline stays scan-level: in last_scan.warnings, never a region warning, no region state changed by it', async () => {
    const org = await flagged();
    const { rows } = await pool.query(
      `INSERT INTO resource_discovery_jobs (organization_id, status, started_at, completed_at, created_at, resource_types, regions, warnings)
       VALUES ($1, 'completed', $2, '2026-03-01T10:55:00Z', $2, $3, $4, '["scan_deadline"]'::jsonb) RETURNING id`,
      [org.orgId, EARLIER_START, TYPES, [HOME, 'eu-west-1']]
    );
    await insertRegion(org.orgId, HOME, { status: 'ok' });
    await insertRegion(org.orgId, 'eu-west-1', { status: 'ok', code: 'resource_explorer_no_index' });
    const coverage = await coverageOf(org);
    expect(coverage.last_scan.warnings).toEqual(['scan_deadline']);
    const mr = coverage.multi_region;
    expect(mr.region_warnings).toEqual([{ code: 'resource_explorer_no_index', region: 'eu-west-1' }]);
    expect(JSON.stringify(mr.region_warnings)).not.toContain('scan_deadline');
    expect(mr.regions.map((r: any) => r.state)).toEqual(['checked', 'checked_with_warnings']);
    // The regions were all checked by the scan; the post-region stop is the job's warning.
    expect(mr).toMatchObject({ coverage_status: 'all_checked', scan: { id: rows[0].id, regions_checked: 2 } });
  });

  it('no mutation on GET: a flagged read with a running scan writes nothing (the auth meter api_usage aside, as on every route)', async () => {
    const org = await flagged();
    const running = await insertJob(org.orgId, 'running', SCAN_START, [HOME, 'eu-west-1']);
    await insertLease(org.orgId, running);
    await insertRegion(org.orgId, HOME, { status: 'ok', started: SCAN_START });
    await insertRegion(org.orgId, 'eu-west-1', { status: 'denied', code: REGION_CODE_ACCESS_DENIED });
    const start = recorded.length;
    const coverage = await coverageOf(org);
    expect(coverage.multi_region.progress).not.toBeNull();
    const statements = recorded.slice(start).map((r) => r.text);
    expect(statements.some((t) => /WITH listed AS/.test(t))).toBe(true);
    const writes = statements.filter((t) => /\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|MERGE\s+INTO|TRUNCATE|ALTER\s+TABLE|CREATE\s+TABLE)\b/i.test(t));
    expect(writes.filter((t) => !/INSERT INTO api_usage/i.test(t))).toEqual([]);
  });

  it('no AWS call on the flagged path: no SDK send, no client, no scan context', async () => {
    const org = await flagged();
    const running = await insertJob(org.orgId, 'running', SCAN_START, [HOME]);
    await insertLease(org.orgId, running);
    await insertRegion(org.orgId, HOME, { status: 'ok', started: SCAN_START });
    const sdkClientPrototype = Object.getPrototypeOf(EC2Client.prototype);
    const send = jest.spyOn(sdkClientPrototype, 'send');
    const createClients = jest.spyOn(AWSClientFactory, 'createClients');
    const buildClients = jest.spyOn(AWSClientFactory, 'buildClients');
    const forOrg = jest.spyOn(ScanContext, 'forOrg');
    const coverage = await coverageOf(org);
    expect(coverage).toHaveProperty('multi_region');
    for (const spy of [send, createClients, buildClients, forOrg]) expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    ['a partial region only', { status: 'partial', code: 'discovery_listing_truncated' }],
    ['a denied region only', { status: 'denied', code: REGION_CODE_ACCESS_DENIED }],
    ['a timed-out region only', { status: 'timed_out', code: REGION_CODE_DEADLINE }],
  ] as Array<[string, RegionRow]>)('R10: region_warnings_complete is false with %s (its one code column could hide a Resource Explorer code)', async (_label, row) => {
    const org = await flagged();
    await insertRegion(org.orgId, HOME, { status: 'ok' });
    await insertRegion(org.orgId, 'eu-west-1', row);
    expect((await coverageOf(org)).multi_region.region_warnings_complete).toBe(false);
  });

  it('R13: stale per region: a result older than 13 hours is stale, a recent one is not, a never-scanned one never is', async () => {
    const org = await flagged();
    const recent = new Date(Date.now() - 10 * 60_000).toISOString();
    await insertRegion(org.orgId, HOME, { status: 'ok', started: recent, finished: recent });
    await insertRegion(org.orgId, 'eu-west-1', { status: 'ok' });
    await insertRegion(org.orgId, 'ap-south-1', {});
    const regions = byRegion(await coverageOf(org));
    expect([regions[HOME].stale, regions['eu-west-1'].stale, regions['ap-south-1'].stale]).toEqual([false, true, false]);
  });
});

// ---------------------------------------------------------------------------
describe('a scan is in progress only while the lease is held AND names a running or pending job', () => {
  async function orgWith(lease: (orgId: string, jobId: string) => Promise<void>, jobStatus = 'running') {
    const org = await harness.buildOrg();
    await insertAccount(org.orgId);
    await setFlag(org.orgId, true);
    const job = await insertJob(org.orgId, jobStatus, SCAN_START, [HOME], jobStatus === 'running' ? null : '2026-03-02T10:30:00Z');
    await lease(org.orgId, job);
    await insertRegion(org.orgId, HOME, { status: 'ok', started: SCAN_START });
    await insertRegion(org.orgId, 'eu-west-1', { status: 'ok' });
    return coverageOf(org);
  }

  it.each([
    // A running job with no held lease was abandoned: the newest scan did not finish.
    ['the lease was released', (orgId: string, job: string) => insertLease(orgId, job, { released: true }), 'running', 'latest_scan_failed'],
    ['the lease expired', (orgId: string, job: string) => insertLease(orgId, job, { expired: true }), 'running', 'latest_scan_failed'],
    // Completed, but eu-west-1's result is an older scan's: not every region checked by it.
    ['the lease names a finished job', (orgId: string, job: string) => insertLease(orgId, job), 'completed', 'completed_with_regions_not_checked'],
    ['a lease with no job (a cost Analyze)', (orgId: string) => insertLease(orgId, null), 'running', 'latest_scan_failed'],
  ])('%s: no progress; every region shows its last result with no scan state; never in_progress', async (_label, lease, jobStatus, coverageStatus) => {
    const coverage = await orgWith(lease as any, jobStatus as string);
    expect(coverage.multi_region.progress).toBeNull();
    expect(coverage.multi_region.coverage_status).toBe(coverageStatus);
    expect(coverage.multi_region.regions.map((r: any) => [r.scan_state, r.result_of])).toEqual([[null, 'latest_scan'], [null, 'earlier_scan']]);
  });
});

// ---------------------------------------------------------------------------
describe('codes', () => {
  it('MULTI_REGION_ERROR_CODES holds every code a multi-region scan writes, and the warnings are a subset', () => {
    for (const code of [
      REGION_CODE_ACCESS_DENIED, REGION_CODE_ACCESS_DENIED_SCP, REGION_CODE_NOT_READY, REGION_CODE_DEADLINE,
      REGION_CODE_THROTTLED, REGION_CODE_CALL_TIMEOUT, REGION_CODE_SCAN_BUDGET, REGION_CODE_ERROR,
      'deletion_detection_paused_truncated_index', 'discovery_listing_truncated', 'resource_explorer_no_index', 'resource_explorer_no_view',
      // Region-access PR (b).
      'resource_explorer_denied', 'resource_explorer_throttled', 'resource_explorer_failed',
    ]) {
      expect(MULTI_REGION_ERROR_CODES).toContain(code);
    }
    for (const code of REGION_WARNING_CODES) expect(MULTI_REGION_ERROR_CODES).toContain(code);
  });
});

// ---------------------------------------------------------------------------
describe('tenant isolation', () => {
  let a: RoleGateOrg;
  let b: RoleGateOrg;

  beforeAll(async () => {
    a = await harness.buildOrg();
    b = await harness.buildOrg();
    // Both flagged, both on the SAME AWS account; B has a list, a running scan and resources, A has none.
    for (const org of [a, b]) {
      await insertAccount(org.orgId);
      await setFlag(org.orgId, true);
    }
    const running = await insertJob(b.orgId, 'running', SCAN_START, [HOME, 'eu-west-1']);
    await insertLease(b.orgId, running);
    await insertRegion(b.orgId, HOME, { status: 'ok', started: SCAN_START });
    await insertRegion(b.orgId, 'eu-west-1', { status: 'denied', code: REGION_CODE_ACCESS_DENIED });
    await insertRegion(b.orgId, 'ap-east-1', { enabled: false });
    await insertResource(b.orgId, 'b-web', 'ec2', 'eu-west-1', BEFORE_SCAN);
  });

  const EMPTY = {
    scan: null,
    coverage_status: 'unavailable',
    home_region: HOME,
    savings_regions: [HOME],
    not_enabled_regions: [],
    regions: [],
    regions_checked: { enabled: null, complete: 0, partial: 0, not_checked: 0, not_reached: 0, never_scanned: 0, by_state: byState() },
    progress: null,
    region_warnings: [],
    region_warnings_complete: true,
    region_warnings_unattributed: [],
  };

  it('by the explicit predicates (superuser): A sees none of B\'s regions, scan or resources', async () => {
    expect((await coverageOf(a)).multi_region).toEqual(EMPTY);
    const mrB = (await coverageOf(b)).multi_region;
    expect(mrB.regions.map((r: any) => r.region)).toEqual([HOME, 'eu-west-1']);
    expect(mrB.progress).not.toBeNull();
  });

  it('by row-level security alone, as the non-superuser devcontrol role: the statement with every organization predicate removed', async () => {
    const start = recorded.length;
    await coverageOf(a);
    const [statementA] = recorded.slice(start).filter((r) => /WITH listed AS/.test(r.text));
    expect(statementA).toBeDefined();
    // The two-letter aliases first: 'l.' and 'r.' are suffixes of them.
    const stripped = statementA.text
      .split('ar.organization_id = $1').join('$1::uuid IS NOT NULL')
      .split('sl.organization_id = $1').join('$1::uuid IS NOT NULL')
      .split('lj.organization_id = $1').join('$1::uuid IS NOT NULL')
      .split(' j.organization_id = $1').join(' $1::uuid IS NOT NULL')
      .split(' l.organization_id = $1').join(' $1::uuid IS NOT NULL')
      .split('r.organization_id = $1').join('$1::uuid IS NOT NULL');
    expect(stripped).not.toMatch(/organization_id = \$1/);
    const paramsFor = (orgId: string) => [orgId, ...statementA.values.slice(1)];

    const client = await pool.connect();
    try {
      // Rolled back: the grants never outlive this test.
      await client.query('BEGIN');
      await client.query('GRANT SELECT ON aws_resources, resource_discovery_jobs TO devcontrol');
      await client.query('SET LOCAL ROLE devcontrol');
      const role = await client.query('SELECT current_user AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user');
      expect(role.rows[0]).toEqual({ name: 'devcontrol', rolsuper: false, rolbypassrls: false });

      // Tagged for A, asking for B: nothing of B's.
      await client.query("SELECT set_config('app.current_organization_id', $1, true)", [a.orgId]);
      const [rowA] = (await client.query(stripped, paramsFor(b.orgId))).rows;
      expect(rowA).toMatchObject({ scanning: false, running_started_at: null, running_job: null, newest_job: null, not_enabled: [], regions: [] });

      // Tagged for B, asking for A: B's.
      await client.query("SELECT set_config('app.current_organization_id', $1, true)", [b.orgId]);
      const [rowB] = (await client.query(stripped, paramsFor(a.orgId))).rows;
      expect(rowB.scanning).toBe(true);
      expect(rowB.running_job).toMatchObject({ status: 'running' });
      expect(rowB.newest_job).toMatchObject({ status: 'running' });
      expect(rowB.not_enabled).toEqual(['ap-east-1']);
      expect(rowB.regions.map((r: any) => [r.region, r.now_count])).toEqual([[HOME, 0], ['eu-west-1', 1]]);

      // No tag: nothing at all.
      await client.query("SELECT set_config('app.current_organization_id', '', true)");
      const [untagged] = (await client.query(stripped, paramsFor(a.orgId))).rows;
      expect(untagged).toMatchObject({ scanning: false, running_job: null, newest_job: null, not_enabled: [], regions: [] });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
