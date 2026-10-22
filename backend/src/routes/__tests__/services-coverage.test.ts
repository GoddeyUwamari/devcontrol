/**
 * GET /api/services/coverage: what the Services page may say about scan
 * coverage (Phase 1, PR S1-B). Read from the database only.
 *
 * Policy under test:
 *   - 401 without a token or with a revoked membership; every role with a
 *     current membership may read, viewers included.
 *   - The organization is the authenticated caller's. Nothing in the query
 *     string selects a tenant, and nothing crosses organizations: by the
 *     explicit predicates, and, as the non-superuser devcontrol role, by
 *     row-level security alone.
 *   - States: no AWS account; an account but no scan yet; a failed last scan
 *     (status only, never its error text); the truncated-index warning read
 *     from error_message (before M4c), from the warnings column (after M4c),
 *     and from a database without the column (before M3 is applied); the
 *     free plan's four types; resources only in the home region; S3 buckets
 *     in other regions and CloudFront as global.
 *   - The home region is the account's, or us-east-1 when none is recorded;
 *     until a region list is stored, enabled regions are reported as
 *     unknown, never as a number (M5c below: once one is, its count).
 *   - Counts agree with /api/services/stats; tags_unknown_by_type is its
 *     unknown_by_type.
 *   - 409 with a fixed message for more than one eligible account; any other
 *     failure is a fixed 500 message.
 *   - No AWS SDK call is made.
 *   - Multi-region M5c (m5c-plan.md): the enabled regions of the latest region
 *     list and each one's last scan status (codes on an allow-list only, never
 *     the stored message), staleness on the database clock, a scan in progress
 *     only while the discovery lease is held AND names a running or pending
 *     job, and the newest completed scan (null when no job has completed). Read for the account the role ARN names; every
 *     test organization is on the same AWS account (the fixture ARN), so none
 *     sees another's rows by the explicit predicates (superuser run) or by RLS
 *     alone (devcontrol run). The pre-M5c keys are unchanged.
 *
 * Real routes over an in-process HTTP server against live Postgres. Only
 * authService.verifyToken is stubbed (to choose the caller). Every
 * identifier is synthetic.
 */
import fs from 'fs';
import path from 'path';
import { Client } from 'pg';
import { EC2Client } from '@aws-sdk/client-ec2';
import servicesCoverageRoutes from '../services-coverage.routes';
import servicesRoutes from '../services.routes';
import { MEMBERSHIP_REVOKED_CODE } from '../../middleware/auth.middleware';
import * as awsAccountsRepository from '../../repositories/aws-accounts.repository';
import { AwsAccountAmbiguousError, DEFAULT_HOME_REGION } from '../../repositories/aws-accounts.repository';
import { AWSClientFactory } from '../../services/aws-client-factory.service';
import { ScanContext } from '../../services/scan-context';
import {
  DISCOVERY_WARNING_LISTING_TRUNCATED,
  DISCOVERY_WARNING_TRUNCATED_INDEX,
  joinDiscoveryMessage,
} from '../../services/discovery-warnings';
import { MAX_LEASE_AGE_SECONDS } from '../../services/scan-lease';
import { SCAN_KIND_DISCOVERY } from '../../services/scan-session';
import { RESOURCE_EXPLORER_SOURCE, homeRegionScanStatus } from '../../services/region-scan-status';
import { DISCOVERY_INTERVAL_SECONDS, REGION_ERROR_CODES, STALE_AFTER_SECONDS } from '../services-coverage.routes';
import { createRoleGateHarness, RoleGateOrg } from './role-gate-harness';
import { ensureSharedFixtureTable } from './shared-fixture-tables';

const harness = createRoleGateHarness('services-coverage');
const { pool } = harness;

const FREE_PLAN_TYPES = ['ec2', 'ebs', 'rds', 's3'];
// What a failed job's error_message can hold: never passed on.
const INTERNAL_ERROR_TEXT = 'Resource Explorer: AccessDeniedException arn:aws:iam::123456789012:role/internal-role';

// Every statement the app runs: a pass-through recorder on pg's Client.prototype.query,
// installed before any connection exists (as services.routes.inventory-facets.test.ts).
interface Recorded { text: string; values: unknown[] }
const originalClientQuery = Client.prototype.query;
const recorded: Recorded[] = [];

async function statementsDuring(fn: () => Promise<unknown>, pattern: RegExp): Promise<Recorded[]> {
  const start = recorded.length;
  await fn();
  return recorded.slice(start).filter((r) => pattern.test(r.text));
}

let accountSeq = 0;

// The AWS account every fixture account's role ARN names (a documented placeholder).
const ACCOUNT = '123456789012';
const OTHER_ACCOUNT = '111122223333';

async function insertAccount(
  orgId: string,
  region: string | null,
  status = 'active',
  roleArn = `arn:aws:iam::${ACCOUNT}:role/DevControlRole`
): Promise<void> {
  accountSeq += 1;
  await pool.query(
    `INSERT INTO aws_accounts (org_id, role_arn, account_id, external_id, region, connected_at, status)
     VALUES ($1, $5, $2, 'external-id-1', $3, NOW(), $4)`,
    [orgId, `cov-${accountSeq}-${orgId}`.slice(0, 32), region, status, roleArn]
  );
}

interface JobFixture {
  status: 'pending' | 'running' | 'completed' | 'failed';
  createdAt: string;
  completedAt?: string | null;
  resourceTypes?: string[] | null;
  errorMessage?: string | null;
  warnings?: unknown;
}

async function insertJob(orgId: string, job: JobFixture): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO resource_discovery_jobs
       (organization_id, status, started_at, completed_at, created_at, resource_types, error_message, warnings)
     VALUES ($1, $2, $3, $4, $3, $5, $6, $7::jsonb)
     RETURNING id`,
    [
      orgId,
      job.status,
      job.createdAt,
      job.completedAt ?? null,
      job.resourceTypes === undefined ? FREE_PLAN_TYPES : job.resourceTypes,
      job.errorMessage ?? null,
      job.warnings === undefined ? null : JSON.stringify(job.warnings),
    ]
  );
  return rows[0].id;
}

interface RegionFixture {
  enabled?: boolean;
  /** Seconds before `base`; rows of one list share it. null = never listed. */
  listedAgo?: number | null;
  status?: string;
  finishedAgo?: number | null;
  successAgo?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  consecutiveFailures?: number;
}

/** The database clock, read once per test so every fixture time is relative to the same instant. */
async function dbNow(): Promise<Date> {
  return (await pool.query('SELECT now() AS t')).rows[0].t;
}

/** An aws_account_regions row, written as the test's superuser (RLS bypassed), times relative to `base` (the database clock). */
async function insertRegion(orgId: string, account: string, region: string, f: RegionFixture = {}, base?: Date): Promise<void> {
  await pool.query(
    `INSERT INTO aws_account_regions
       (organization_id, aws_account_id, region, opt_in_status, enabled, last_listed_at,
        last_scan_status, last_scan_started_at, last_scan_finished_at, last_success_at,
        last_error_code, last_error_message, consecutive_failures)
     SELECT $1, $2, $3, CASE WHEN $4 THEN 'opt-in-not-required' ELSE 'not-opted-in' END, $4,
            b.t - make_interval(secs => $5),
            $6, b.t - make_interval(secs => $7 + 60), b.t - make_interval(secs => $7),
            b.t - make_interval(secs => $8), $9, $10, $11
       FROM (SELECT COALESCE($12::timestamptz, now()) AS t) b`,
    [
      orgId, account, region, f.enabled ?? true,
      f.listedAgo === undefined ? 60 : f.listedAgo,
      f.status ?? 'never_scanned',
      f.finishedAgo ?? null, f.successAgo ?? null,
      f.errorCode ?? null, f.errorMessage ?? null, f.consecutiveFailures ?? 0,
      base ?? null,
    ]
  );
}

interface LeaseFixture {
  jobId?: string | null;
  /** Seconds after the database's now() the lease expires; negative = already expired. */
  expiresIn?: number;
  released?: boolean;
  scanKind?: string;
}

/** An aws_scan_leases row (superuser), acquired a minute ago by the database clock. Returns acquired_at. */
async function insertLease(orgId: string, account: string, f: LeaseFixture = {}): Promise<Date> {
  const { rows } = await pool.query(
    `INSERT INTO aws_scan_leases (organization_id, aws_account_id, scan_kind, holder, job_id, acquired_at, heartbeat_at, expires_at, released_at)
     SELECT $1, $2, $3, 'test-holder', $4, c.ts - interval '10 minutes', c.ts - interval '10 minutes',
            c.ts + make_interval(secs => $5), CASE WHEN $6 THEN c.ts - interval '1 second' END
       FROM (SELECT now() AS ts) c
     RETURNING acquired_at`,
    [orgId, account, f.scanKind ?? SCAN_KIND_DISCOVERY, f.jobId ?? null, f.expiresIn ?? 300, f.released ?? false]
  );
  return rows[0].acquired_at;
}

interface ResourceFixture {
  type: string;
  region: string;
  status?: string;
  metadata?: Record<string, unknown>;
}

let resourceSeq = 0;

async function insertResource(orgId: string, name: string, f: ResourceFixture): Promise<void> {
  resourceSeq += 1;
  const resourceId = `${name}-${resourceSeq}-${orgId.slice(0, 8)}`;
  await pool.query(
    `INSERT INTO aws_resources
       (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status, tags, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, '{}', $8)`,
    [
      orgId,
      `arn:aws:${f.type}:${f.region}:123456789012:resource/${resourceId}`,
      resourceId,
      name,
      f.type,
      f.region,
      f.status ?? 'running',
      JSON.stringify(f.metadata ?? {}),
    ]
  );
}

async function get(org: RoleGateOrg, route = '/services/coverage', userId = org.viewer) {
  const res = await harness.sendAs(org.orgId, userId, 'GET', route);
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) };
}

async function coverageOf(org: RoleGateOrg) {
  const { status, body } = await get(org);
  expect(status).toBe(200);
  return body.coverage;
}

const NOT_CONNECTED = { connected: false, status: null, home_region: null };
const ENABLED_REGIONS_UNKNOWN = { known: false, count: null };
const M5C_REGIONS_UNKNOWN = { listed_at: null, stale: false };

// The keys multi-region M5c adds. Every pre-M5c expectation below is compared
// with them removed (and is byte-identical to its c8b6a1c form); they are
// asserted on their own.
const M5C_KEYS = ['region_status', 'scan_in_progress', 'last_completed_scan'] as const;
const NO_REGION_DATA = { region_status: [], scan_in_progress: null };

/** A coverage response body, as JSON. */
type CoverageJson = Record<string, unknown> & { scope: Record<string, unknown> & { enabled_regions: Record<string, unknown> } };

/** One region_status element of a response body. */
interface RegionJson { region: string; home: boolean; status: string; stale: boolean; last_error_code: string | null }

/** The response as it was before M5c: the added keys removed. */
function preM5c(coverage: CoverageJson) {
  const old: CoverageJson = { ...coverage, scope: { ...coverage.scope, enabled_regions: { ...coverage.scope.enabled_regions } } };
  for (const key of M5C_KEYS) delete old[key];
  delete old.scope.enabled_regions.listed_at;
  delete old.scope.enabled_regions.stale;
  return old;
}

/** Only the keys M5c adds. */
function m5c(coverage: CoverageJson) {
  return {
    enabled_regions: { listed_at: coverage.scope.enabled_regions.listed_at, stale: coverage.scope.enabled_regions.stale },
    region_status: coverage.region_status,
    scan_in_progress: coverage.scan_in_progress,
    last_completed_scan: coverage.last_completed_scan,
  };
}

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
    // As routes/index.ts mounts them: coverage before /services.
    app.use('/api/services/coverage', servicesCoverageRoutes);
    app.use('/api/services', servicesRoutes);
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  Client.prototype.query = originalClientQuery;
  await harness.close(async (orgIds) => {
    await pool.query('DELETE FROM aws_resources WHERE organization_id = ANY($1)', [orgIds]);
    await pool.query('DELETE FROM aws_account_regions WHERE organization_id = ANY($1)', [orgIds]);
    await pool.query('DELETE FROM aws_scan_leases WHERE organization_id = ANY($1)', [orgIds]);
    await pool.query('DELETE FROM resource_discovery_jobs WHERE organization_id = ANY($1)', [orgIds]);
    await pool.query('DELETE FROM aws_accounts WHERE org_id = ANY($1)', [orgIds]);
  });
});

describe('precondition', () => {
  it('this database has the M3 warnings column, so the column cases below are not vacuous', async () => {
    const { rows } = await pool.query(
      `SELECT data_type FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'resource_discovery_jobs' AND column_name = 'warnings'`
    );
    expect(rows).toEqual([{ data_type: 'jsonb' }]);
  });
});

describe('authentication and authorization', () => {
  let org: RoleGateOrg;
  let other: RoleGateOrg;

  beforeAll(async () => {
    org = await harness.buildOrg();
    other = await harness.buildOrg();
  });

  it('401 without a token', async () => {
    const res = await fetch(`${harness.url()}/services/coverage`);
    expect(res.status).toBe(401);
  });

  it.each(['viewer', 'member', 'admin', 'owner'] as const)('%s can read', async (role) => {
    const { status, body } = await get(org, '/services/coverage', org[role]);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('a member of another organization presenting this organization is refused, with no data', async () => {
    const { status, body } = await get(org, '/services/coverage', other.owner);
    expect(status).toBe(401);
    expect(body.code).toBe(MEMBERSHIP_REVOKED_CODE);
    expect(body.coverage).toBeUndefined();
  });

  it('a revoked membership is refused on the next request', async () => {
    const user = await harness.insertUser('revoked');
    await harness.addMembership(org.orgId, user.id, 'viewer');
    expect((await get(org, '/services/coverage', user.id)).status).toBe(200);
    await pool.query(
      'UPDATE organization_memberships SET is_active = false WHERE organization_id = $1 AND user_id = $2',
      [org.orgId, user.id]
    );
    const { status, body } = await get(org, '/services/coverage', user.id);
    expect(status).toBe(401);
    expect(body.coverage).toBeUndefined();
  });

  it('is not captured by GET /api/services/:id', async () => {
    const { body } = await get(org);
    expect(body.coverage).toBeDefined();
  });
});

describe('no AWS account', () => {
  it('says not connected, with no home region, no scan and no counts', async () => {
    const org = await harness.buildOrg();
    const coverage = await coverageOf(org);
    expect(m5c(coverage)).toEqual({ enabled_regions: M5C_REGIONS_UNKNOWN, ...NO_REGION_DATA, last_completed_scan: null });
    expect(preM5c(coverage)).toEqual({
      account: NOT_CONNECTED,
      scope: {
        home_region: null,
        s3: { in_last_scan: false, regions: [] },
        cloudfront: { in_last_scan: false, count: 0 },
        enabled_regions: ENABLED_REGIONS_UNKNOWN,
      },
      last_successful_scan_at: null,
      last_scan: null,
      resource_types: null,
      tags_unknown_by_type: {},
      regions: [],
      total: 0,
    });
  });

  it('an account that is not eligible (inactive) is not connected', async () => {
    const org = await harness.buildOrg();
    await insertAccount(org.orgId, 'eu-west-1', 'inactive');
    expect((await coverageOf(org)).account).toEqual(NOT_CONNECTED);
  });

  it('resources left from an earlier connection are counted, but no region is called home', async () => {
    const org = await harness.buildOrg();
    await insertResource(org.orgId, 'leftover', { type: 'ec2', region: 'eu-west-1' });
    const coverage = await coverageOf(org);
    expect(coverage.account).toEqual(NOT_CONNECTED);
    expect(coverage.scope.home_region).toBeNull();
    expect(coverage.regions).toEqual([{ region: 'eu-west-1', count: 1 }]);
    expect(coverage.total).toBe(1);
  });
});

describe('an account but no scan yet', () => {
  it('is connected in its own home region, with no scan, no types and nothing in scope yet', async () => {
    const org = await harness.buildOrg();
    await insertAccount(org.orgId, 'eu-west-1');
    const coverage = await coverageOf(org);
    expect(m5c(coverage)).toEqual({ enabled_regions: M5C_REGIONS_UNKNOWN, ...NO_REGION_DATA, last_completed_scan: null });
    expect(preM5c(coverage)).toEqual({
      account: { connected: true, status: 'active', home_region: 'eu-west-1' },
      scope: {
        home_region: { region: 'eu-west-1', count: 0 },
        s3: { in_last_scan: false, regions: [] },
        cloudfront: { in_last_scan: false, count: 0 },
        enabled_regions: ENABLED_REGIONS_UNKNOWN,
      },
      last_successful_scan_at: null,
      last_scan: null,
      resource_types: null,
      tags_unknown_by_type: {},
      regions: [],
      total: 0,
    });
  });

  it('an account with no recorded region is at home in us-east-1, the client factory\'s rule', async () => {
    const org = await harness.buildOrg();
    await insertAccount(org.orgId, null);
    const coverage = await coverageOf(org);
    expect(DEFAULT_HOME_REGION).toBe('us-east-1');
    expect(coverage.account.home_region).toBe(DEFAULT_HOME_REGION);
    expect(coverage.scope.home_region).toEqual({ region: DEFAULT_HOME_REGION, count: 0 });
  });

  it('a scan still running is the last scan, with no successful scan yet', async () => {
    const org = await harness.buildOrg();
    await insertAccount(org.orgId, 'eu-west-1');
    await insertJob(org.orgId, { status: 'running', createdAt: '2026-03-01T10:00:00.000Z' });
    const coverage = await coverageOf(org);
    expect(coverage.last_scan).toEqual({
      status: 'running', started_at: '2026-03-01T10:00:00.000Z', completed_at: null, warnings: [],
    });
    expect(coverage.last_successful_scan_at).toBeNull();
    expect(coverage).not.toHaveProperty('scanInProgress');
    // A running job with no lease (its worker is gone) is not a scan in progress.
    expect(coverage.scan_in_progress).toBeNull();
    expect(coverage.last_completed_scan).toBeNull();
  });
});

describe('last scan failed', () => {
  it('reports the failure by status only; the last successful scan is the earlier completed one', async () => {
    const org = await harness.buildOrg();
    await insertAccount(org.orgId, 'eu-west-1');
    await insertJob(org.orgId, {
      status: 'completed', createdAt: '2026-03-01T10:00:00.000Z', completedAt: '2026-03-01T10:05:00.000Z',
    });
    await insertJob(org.orgId, {
      status: 'failed', createdAt: '2026-03-02T10:00:00.000Z', completedAt: '2026-03-02T10:01:00.000Z',
      errorMessage: INTERNAL_ERROR_TEXT,
    });
    const { text, body } = await get(org);
    expect(body.coverage.last_scan).toEqual({
      status: 'failed',
      started_at: '2026-03-02T10:00:00.000Z',
      completed_at: '2026-03-02T10:01:00.000Z',
      warnings: [],
    });
    expect(body.coverage.last_successful_scan_at).toBe('2026-03-01T10:05:00.000Z');
    expect(text).not.toContain('AccessDenied');
    expect(text).not.toContain('123456789012');
    expect(text).not.toContain('error_message');
  });

  it('a failed run with a warning keeps the warning and drops the error text', async () => {
    const org = await harness.buildOrg();
    await insertAccount(org.orgId, 'eu-west-1');
    await insertJob(org.orgId, {
      status: 'failed', createdAt: '2026-03-02T10:00:00.000Z', completedAt: '2026-03-02T10:01:00.000Z',
      errorMessage: joinDiscoveryMessage([INTERNAL_ERROR_TEXT], [DISCOVERY_WARNING_TRUNCATED_INDEX]),
    });
    const { text, body } = await get(org);
    expect(body.coverage.last_scan.warnings).toEqual([DISCOVERY_WARNING_TRUNCATED_INDEX]);
    expect(text).not.toContain('AccessDenied');
    // Only a failed job: no completed scan, and a failed one is never offered in its place.
    expect(body.coverage.last_completed_scan).toBeNull();
    expect(body.coverage.last_successful_scan_at).toBeNull();
  });
});

describe('the truncated-index warning, wherever the job stored it', () => {
  async function lastScanWith(job: Partial<JobFixture>) {
    const org = await harness.buildOrg();
    await insertAccount(org.orgId, 'eu-west-1');
    await insertJob(org.orgId, {
      status: 'completed', createdAt: '2026-03-01T10:00:00.000Z', completedAt: '2026-03-01T10:05:00.000Z', ...job,
    });
    return { org, coverage: await coverageOf(org) };
  }

  it('in error_message only, as discovery writes it before M4c', async () => {
    const { coverage } = await lastScanWith({ errorMessage: DISCOVERY_WARNING_TRUNCATED_INDEX, warnings: undefined });
    expect(coverage.last_scan.status).toBe('completed');
    expect(coverage.last_scan.warnings).toEqual([DISCOVERY_WARNING_TRUNCATED_INDEX]);
    expect(coverage.last_successful_scan_at).toBe('2026-03-01T10:05:00.000Z');
  });

  it('in the warnings column only, as M4c will write it', async () => {
    const { coverage } = await lastScanWith({ errorMessage: null, warnings: [DISCOVERY_WARNING_TRUNCATED_INDEX] });
    expect(coverage.last_scan.warnings).toEqual([DISCOVERY_WARNING_TRUNCATED_INDEX]);
  });

  it('in both, as M4c\'s dual-write stores it: reported once', async () => {
    const { coverage } = await lastScanWith({
      errorMessage: DISCOVERY_WARNING_TRUNCATED_INDEX, warnings: [DISCOVERY_WARNING_TRUNCATED_INDEX],
    });
    expect(coverage.last_scan.warnings).toEqual([DISCOVERY_WARNING_TRUNCATED_INDEX]);
  });

  it('the column passes on codes only: free text, non-strings and a non-array are dropped', async () => {
    const codes = await lastScanWith({
      warnings: ['scan_lease_lost', 'Some text with arn:aws:iam::123456789012:role/x', 42, null, DISCOVERY_WARNING_TRUNCATED_INDEX],
    });
    expect(codes.coverage.last_scan.warnings).toEqual(['scan_lease_lost', DISCOVERY_WARNING_TRUNCATED_INDEX]);
    const notArray = await lastScanWith({ warnings: { code: DISCOVERY_WARNING_TRUNCATED_INDEX } });
    expect(notArray.coverage.last_scan.warnings).toEqual([]);
  });

  it('only the last job\'s warnings count: an earlier warned run does not mark a clean one', async () => {
    const org = await harness.buildOrg();
    await insertAccount(org.orgId, 'eu-west-1');
    await insertJob(org.orgId, {
      status: 'completed', createdAt: '2026-03-01T10:00:00.000Z', completedAt: '2026-03-01T10:05:00.000Z',
      errorMessage: DISCOVERY_WARNING_TRUNCATED_INDEX, warnings: [DISCOVERY_WARNING_TRUNCATED_INDEX],
    });
    await insertJob(org.orgId, {
      status: 'completed', createdAt: '2026-03-02T10:00:00.000Z', completedAt: '2026-03-02T10:05:00.000Z',
    });
    const coverage = await coverageOf(org);
    expect(coverage.last_scan.warnings).toEqual([]);
    expect(coverage.last_successful_scan_at).toBe('2026-03-02T10:05:00.000Z');
  });

  it('the same statement works on a database without the column (M3 not applied): error_message still counts', async () => {
    const { org, coverage } = await lastScanWith({ errorMessage: DISCOVERY_WARNING_TRUNCATED_INDEX, warnings: null });
    const [statement] = await statementsDuring(() => get(org), /WITH last_job AS/);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // A temporary table is found before the real one: the same statement now
      // reads a resource_discovery_jobs that has every column but warnings.
      await client.query(
        `CREATE TEMP TABLE resource_discovery_jobs ON COMMIT DROP AS
           SELECT id, organization_id, status, started_at, completed_at, created_at, resource_types, error_message
             FROM public.resource_discovery_jobs WHERE organization_id = $1`,
        [org.orgId]
      );
      const columns = await client.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'resource_discovery_jobs' AND table_schema LIKE 'pg_temp%'`
      );
      expect(columns.rows.map((r) => r.column_name)).not.toContain('warnings');
      const { rows } = await client.query(statement.text, statement.values);
      expect(rows[0].status).toBe('completed');
      expect(rows[0].warnings).toBeNull();
      expect(rows[0].error_message).toBe(DISCOVERY_WARNING_TRUNCATED_INDEX);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    // And the route's reading of that row is the one above.
    expect(coverage.last_scan.warnings).toEqual([DISCOVERY_WARNING_TRUNCATED_INDEX]);
  });
});

describe('resource types covered by the last scan', () => {
  it('the free plan\'s four types: S3 in the scan, CloudFront not', async () => {
    const org = await harness.buildOrg();
    await insertAccount(org.orgId, 'eu-west-1');
    await insertJob(org.orgId, {
      status: 'completed', createdAt: '2026-03-01T10:00:00.000Z', completedAt: '2026-03-01T10:05:00.000Z',
      resourceTypes: FREE_PLAN_TYPES,
    });
    const coverage = await coverageOf(org);
    expect(coverage.resource_types).toEqual(FREE_PLAN_TYPES);
    expect(coverage.scope.s3.in_last_scan).toBe(true);
    expect(coverage.scope.cloudfront.in_last_scan).toBe(false);
  });

  it('follow the last job, not the plan: an upgraded plan\'s next scan adds CloudFront', async () => {
    const org = await harness.buildOrg();
    await insertAccount(org.orgId, 'eu-west-1');
    await insertJob(org.orgId, {
      status: 'completed', createdAt: '2026-03-01T10:00:00.000Z', completedAt: '2026-03-01T10:05:00.000Z',
      resourceTypes: FREE_PLAN_TYPES,
    });
    await insertJob(org.orgId, {
      status: 'running', createdAt: '2026-03-02T10:00:00.000Z', resourceTypes: [...FREE_PLAN_TYPES, 'lambda', 'cloudfront'],
    });
    const coverage = await coverageOf(org);
    expect(coverage.resource_types).toEqual([...FREE_PLAN_TYPES, 'lambda', 'cloudfront']);
    expect(coverage.scope.cloudfront.in_last_scan).toBe(true);
  });

  it('a job with no recorded types covers none', async () => {
    const org = await harness.buildOrg();
    await insertAccount(org.orgId, 'eu-west-1');
    await insertJob(org.orgId, { status: 'failed', createdAt: '2026-03-01T10:00:00.000Z', resourceTypes: null });
    const coverage = await coverageOf(org);
    expect(coverage.resource_types).toEqual([]);
    expect(coverage.scope.s3.in_last_scan).toBe(false);
  });
});

describe('counts by scope', () => {
  it('an organization with resources only in its home region', async () => {
    const org = await harness.buildOrg();
    await insertAccount(org.orgId, 'eu-west-1');
    await insertJob(org.orgId, {
      status: 'completed', createdAt: '2026-03-01T10:00:00.000Z', completedAt: '2026-03-01T10:05:00.000Z',
    });
    await insertResource(org.orgId, 'web-1', { type: 'ec2', region: 'eu-west-1' });
    await insertResource(org.orgId, 'vol-a', { type: 'ebs', region: 'eu-west-1' });
    await insertResource(org.orgId, 'db-1', { type: 'rds', region: 'eu-west-1' });
    await insertResource(org.orgId, 'bucket-home', { type: 's3', region: 'eu-west-1', metadata: { tags_state: 'observed' } });
    await insertResource(org.orgId, 'gone', { type: 'ec2', region: 'eu-west-1', status: 'terminated' });
    const coverage = await coverageOf(org);
    expect(coverage.scope.home_region).toEqual({ region: 'eu-west-1', count: 4 });
    expect(coverage.scope.s3.regions).toEqual([{ region: 'eu-west-1', count: 1 }]);
    expect(coverage.scope.cloudfront.count).toBe(0);
    expect(coverage.regions).toEqual([{ region: 'eu-west-1', count: 4 }]);
    expect(coverage.tags_unknown_by_type).toEqual({});
    expect(coverage.total).toBe(4);
  });

  it('an organization with S3 buckets in other regions and CloudFront as global', async () => {
    const org = await harness.buildOrg();
    await insertAccount(org.orgId, 'eu-west-1');
    await insertJob(org.orgId, {
      status: 'completed', createdAt: '2026-03-01T10:00:00.000Z', completedAt: '2026-03-01T10:05:00.000Z',
      resourceTypes: [...FREE_PLAN_TYPES, 'cloudfront'],
    });
    await insertResource(org.orgId, 'web-1', { type: 'ec2', region: 'eu-west-1' });
    await insertResource(org.orgId, 'bucket-home', { type: 's3', region: 'eu-west-1', metadata: { tags_state: 'observed' } });
    await insertResource(org.orgId, 'bucket-usw2-a', { type: 's3', region: 'us-west-2', metadata: { tags_state: 'observed' } });
    await insertResource(org.orgId, 'bucket-usw2-b', { type: 's3', region: 'us-west-2', metadata: { tags_state: 'unavailable' } });
    await insertResource(org.orgId, 'bucket-aps1', { type: 's3', region: 'ap-south-1', metadata: { tags_state: 'observed' } });
    // CloudFront tags are never read: Unknown, as /stats counts it.
    await insertResource(org.orgId, 'cdn-1', { type: 'cloudfront', region: 'global' });
    await insertResource(org.orgId, 'cdn-2', { type: 'cloudfront', region: 'global' });
    const coverage = await coverageOf(org);
    expect(preM5c(coverage).scope).toEqual({
      home_region: { region: 'eu-west-1', count: 2 },
      s3: {
        in_last_scan: true,
        regions: [
          { region: 'us-west-2', count: 2 },
          { region: 'ap-south-1', count: 1 },
          { region: 'eu-west-1', count: 1 },
        ],
      },
      cloudfront: { in_last_scan: true, count: 2 },
      enabled_regions: ENABLED_REGIONS_UNKNOWN,
    });
    expect(coverage.regions).toEqual([
      { region: 'eu-west-1', count: 2 },
      { region: 'global', count: 2 },
      { region: 'us-west-2', count: 2 },
      { region: 'ap-south-1', count: 1 },
    ]);
    expect(coverage.tags_unknown_by_type).toEqual({ cloudfront: 2, s3: 1 });
    expect(coverage.total).toBe(7);
    expect(m5c(coverage).enabled_regions).toEqual(M5C_REGIONS_UNKNOWN);
    // No IAM claim, and (no region list stored) no number of enabled regions anywhere.
    expect(JSON.stringify(coverage)).not.toMatch(/iam/i);
  });

  it('agrees with /api/services/stats: same total, same regions, same unknown-by-type', async () => {
    const org = await harness.buildOrg();
    await insertAccount(org.orgId, 'eu-west-1');
    await insertResource(org.orgId, 'web-1', { type: 'ec2', region: 'eu-west-1' });
    await insertResource(org.orgId, 'bucket-x', { type: 's3', region: 'us-west-2' });
    await insertResource(org.orgId, 'fn-1', { type: 'lambda', region: 'eu-west-1', metadata: { tags_state: 'unavailable' } });
    await insertResource(org.orgId, 'cdn-1', { type: 'cloudfront', region: 'global' });
    const coverage = await coverageOf(org);
    const stats = (await get(org, '/services/stats')).body.stats;
    expect(coverage.total).toBe(stats.total);
    expect(coverage.regions).toEqual(stats.regions);
    expect(coverage.tags_unknown_by_type).toEqual(stats.unknown_by_type);
  });
});

describe('errors return fixed messages', () => {
  it('more than one eligible account is a 409 with the shared message', async () => {
    const org = await harness.buildOrg();
    jest.spyOn(awsAccountsRepository, 'findEligibleAwsAccount').mockRejectedValue(new AwsAccountAmbiguousError(org.orgId, 2));
    let response: Awaited<ReturnType<typeof get>> | undefined;
    const reads = await statementsDuring(async () => { response = await get(org); }, /resource_discovery_jobs|aws_resources|aws_account_regions|aws_scan_leases/);
    expect(reads).toEqual([]);
    const { status, text, body } = response!;
    expect(status).toBe(409);
    expect(body).toEqual({ success: false, error: awsAccountsRepository.AWS_ACCOUNT_AMBIGUOUS_MESSAGE });
    expect(text).not.toContain(org.orgId);
  });

  it('any other failure is a 500 that carries none of the error', async () => {
    const org = await harness.buildOrg();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(awsAccountsRepository, 'findEligibleAwsAccount').mockRejectedValue(
      new Error('relation "internal_table" does not exist at arn:aws:iam::123456789012:role/x')
    );
    const { status, text, body } = await get(org);
    expect(status).toBe(500);
    expect(body).toEqual({ success: false, error: 'Failed to load scan coverage' });
    expect(text).not.toContain('internal_table');
  });
});

describe('tenant isolation', () => {
  let a: RoleGateOrg;
  let b: RoleGateOrg;

  beforeAll(async () => {
    a = await harness.buildOrg();
    b = await harness.buildOrg();
    // The same region names in both: only the organization tells them apart.
    await insertAccount(a.orgId, 'eu-west-1');
    await insertAccount(b.orgId, 'ap-south-1');
    await insertJob(a.orgId, {
      status: 'completed', createdAt: '2026-03-01T10:00:00.000Z', completedAt: '2026-03-01T10:05:00.000Z',
      resourceTypes: FREE_PLAN_TYPES,
    });
    await insertJob(b.orgId, {
      status: 'failed', createdAt: '2026-03-05T10:00:00.000Z', completedAt: '2026-03-05T10:01:00.000Z',
      resourceTypes: [...FREE_PLAN_TYPES, 'cloudfront'], errorMessage: DISCOVERY_WARNING_TRUNCATED_INDEX,
      warnings: [DISCOVERY_WARNING_TRUNCATED_INDEX],
    });
    await insertJob(b.orgId, {
      status: 'completed', createdAt: '2026-03-04T10:00:00.000Z', completedAt: '2026-03-04T10:05:00.000Z',
    });
    // B, on the SAME AWS account as A, has a region list, a home status and a
    // scan in progress (lease held, naming B's running job, older than B's
    // newest job so last_scan is unchanged). A has none of these.
    const bRunning = await insertJob(b.orgId, { status: 'running', createdAt: '2026-03-03T10:00:00.000Z' });
    const base = await dbNow();
    await insertRegion(b.orgId, ACCOUNT, 'ap-south-1', { status: 'ok', finishedAgo: 600, successAgo: 600 }, base);
    await insertRegion(b.orgId, ACCOUNT, 'eu-west-1', {}, base);
    await insertLease(b.orgId, ACCOUNT, { jobId: bRunning });
    await insertResource(a.orgId, 'a-web', { type: 'ec2', region: 'eu-west-1' });
    await insertResource(a.orgId, 'a-bucket', { type: 's3', region: 'us-west-2', metadata: { tags_state: 'observed' } });
    await insertResource(b.orgId, 'b-web', { type: 'ec2', region: 'eu-west-1' });
    await insertResource(b.orgId, 'b-web-2', { type: 'ec2', region: 'ap-south-1' });
    await insertResource(b.orgId, 'b-bucket', { type: 's3', region: 'us-west-2', metadata: { tags_state: 'unavailable' } });
    await insertResource(b.orgId, 'b-cdn', { type: 'cloudfront', region: 'global' });
  });

  const expectedA = {
    account: { connected: true, status: 'active', home_region: 'eu-west-1' },
    scope: {
      home_region: { region: 'eu-west-1', count: 1 },
      s3: { in_last_scan: true, regions: [{ region: 'us-west-2', count: 1 }] },
      cloudfront: { in_last_scan: false, count: 0 },
      enabled_regions: ENABLED_REGIONS_UNKNOWN,
    },
    last_successful_scan_at: '2026-03-01T10:05:00.000Z',
    last_scan: { status: 'completed', started_at: '2026-03-01T10:00:00.000Z', completed_at: '2026-03-01T10:05:00.000Z', warnings: [] },
    resource_types: FREE_PLAN_TYPES,
    tags_unknown_by_type: {},
    regions: [{ region: 'eu-west-1', count: 1 }, { region: 'us-west-2', count: 1 }],
    total: 2,
  };

  const expectedM5cA = {
    enabled_regions: M5C_REGIONS_UNKNOWN,
    ...NO_REGION_DATA,
    last_completed_scan: {
      started_at: '2026-03-01T10:00:00.000Z', completed_at: '2026-03-01T10:05:00.000Z', resource_types: FREE_PLAN_TYPES, warnings: [],
    },
  };

  it('each organization sees only its own account, jobs and resources', async () => {
    const coverageA = await coverageOf(a);
    expect(preM5c(coverageA)).toEqual(expectedA);
    expect(m5c(coverageA)).toEqual(expectedM5cA);
    const coverageB = await coverageOf(b);
    expect(coverageB.scope.enabled_regions).toMatchObject({ known: true, count: 2 });
    expect(coverageB.region_status.map((r: RegionJson) => [r.region, r.home, r.status])).toEqual([
      ['ap-south-1', true, 'ok'], ['eu-west-1', false, 'never_scanned'],
    ]);
    expect(coverageB.scan_in_progress).not.toBeNull();
    expect(coverageB.account.home_region).toBe('ap-south-1');
    expect(coverageB.scope.home_region).toEqual({ region: 'ap-south-1', count: 1 });
    expect(coverageB.last_scan.status).toBe('failed');
    expect(coverageB.last_scan.warnings).toEqual([DISCOVERY_WARNING_TRUNCATED_INDEX]);
    expect(coverageB.last_successful_scan_at).toBe('2026-03-04T10:05:00.000Z');
    expect(coverageB.tags_unknown_by_type).toEqual({ cloudfront: 1, s3: 1 });
    expect(coverageB.total).toBe(4);
  });

  it('nothing in the query string selects the tenant', async () => {
    for (const query of [`?organization_id=${b.orgId}`, `?organizationId=${b.orgId}`, `?org=${b.orgId}`]) {
      const coverage = (await get(a, `/services/coverage${query}`)).body.coverage;
      expect(preM5c(coverage)).toEqual(expectedA);
      expect(m5c(coverage)).toEqual(expectedM5cA);
    }
  });

  it('reads with few statements: one account lookup, one statement for jobs, inventory, regions and the lease', async () => {
    const all = await statementsDuring(() => get(a), /./);
    expect(all.filter((s) => /FROM aws_accounts/.test(s.text))).toHaveLength(1);
    const coverageReads = all.filter((s) => /resource_discovery_jobs|aws_resources|aws_account_regions|aws_scan_leases/.test(s.text));
    expect(coverageReads).toHaveLength(1);
    expect(coverageReads[0].values[0]).toBe(a.orgId);
  });

  describe('row-level security alone, as the non-superuser devcontrol role', () => {
    // The route's exact statement, with every explicit organization predicate
    // replaced by a test that holds for any organization. Only RLS
    // (app.current_organization_id) is left to scope it.
    function withoutOrganizationPredicate(text: string): string {
      // The two-letter aliases first: 'r.' and 'j.' are suffixes of them.
      const stripped = text
        .split('ar.organization_id = $1').join('$1::uuid IS NOT NULL')
        .split('sl.organization_id = $1').join('$1::uuid IS NOT NULL')
        .split('lj.organization_id = $1').join('$1::uuid IS NOT NULL')
        .split('cj.organization_id = $1').join('$1::uuid IS NOT NULL')
        .split('j.organization_id = $1').join('$1::uuid IS NOT NULL')
        .split('r.organization_id = $1').join('$1::uuid IS NOT NULL');
      expect(stripped).not.toMatch(/organization_id = \$1/);
      return stripped;
    }

    // The tables the statement reads are public's. Other suites commit
    // same-named copies in their own schemas (resource_discovery_jobs without
    // RLS among them), so the lookup is pinned to public.
    const PUBLIC_SCHEMA_PREDICATE = "AND relnamespace = 'public'::regnamespace ";
    const TABLES_QUERY =
      `SELECT relname, relrowsecurity, pg_get_userbyid(relowner) <> current_user AS not_owner
         FROM pg_class WHERE relkind = 'r' AND relname = ANY($1) ${PUBLIC_SCHEMA_PREDICATE}ORDER BY relname`;
    const TABLES = ['aws_account_regions', 'aws_resources', 'aws_scan_leases', 'resource_discovery_jobs'];
    const EXPECTED_TABLES = [
      { relname: 'aws_account_regions', relrowsecurity: true, not_owner: true },
      { relname: 'aws_resources', relrowsecurity: true, not_owner: true },
      { relname: 'aws_scan_leases', relrowsecurity: true, not_owner: true },
      { relname: 'resource_discovery_jobs', relrowsecurity: true, not_owner: true },
    ];

    it('returns only the tagged organization\'s jobs and counts, whatever organization is asked for', async () => {
      const [statementA] = await statementsDuring(() => get(a), /WITH last_job AS/);
      const statement = withoutOrganizationPredicate(statementA.text);
      const paramsFor = (orgId: string) => [orgId, ...statementA.values.slice(1)];

      const client = await pool.connect();
      try {
        // Rolled back: the grants never outlive this test.
        await client.query('BEGIN');
        await client.query('GRANT SELECT ON aws_resources, resource_discovery_jobs TO devcontrol');
        await client.query('SET LOCAL ROLE devcontrol');
        const role = await client.query(
          'SELECT current_user AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user'
        );
        expect(role.rows[0]).toEqual({ name: 'devcontrol', rolsuper: false, rolbypassrls: false });
        const tables = await client.query(TABLES_QUERY, [TABLES]);
        expect(tables.rows).toEqual(EXPECTED_TABLES);
        // The M3 tables also FORCE row-level security (their owner is subject to it too).
        const forced = await client.query(
          `SELECT relname, relforcerowsecurity FROM pg_class
            WHERE relkind = 'r' AND relname = ANY($1) ${PUBLIC_SCHEMA_PREDICATE}ORDER BY relname`,
          [['aws_account_regions', 'aws_scan_leases']]
        );
        expect(forced.rows).toEqual([
          { relname: 'aws_account_regions', relforcerowsecurity: true },
          { relname: 'aws_scan_leases', relforcerowsecurity: true },
        ]);

        // Tagged for A, asking for B: A's job and counts.
        await client.query("SELECT set_config('app.current_organization_id', $1, true)", [a.orgId]);
        const [rowA] = (await client.query(statement, paramsFor(b.orgId))).rows;
        expect(rowA).toMatchObject({
          status: 'completed',
          resource_types: FREE_PLAN_TYPES,
          warnings: null,
          total: expectedA.total,
          home_count: 1,
          cloudfront_count: 0,
          s3_regions: expectedA.scope.s3.regions,
          regions: expectedA.regions,
          tags_unknown_by_type: {},
          // B's region rows and lease are on the same AWS account: none is A's.
          regions_listed_at: null,
          enabled_region_count: 0,
          regions_list_stale: false,
          region_status: [],
          scan_in_progress_since: null,
        });
        expect(rowA.last_successful_scan_at.toISOString()).toBe(expectedA.last_successful_scan_at);
        expect(rowA.last_completed_completed_at.toISOString()).toBe(expectedA.last_successful_scan_at);

        // Tagged for B, asking for A: B's.
        await client.query("SELECT set_config('app.current_organization_id', $1, true)", [b.orgId]);
        const [rowB] = (await client.query(statement, paramsFor(a.orgId))).rows;
        expect(rowB).toMatchObject({ status: 'failed', total: 4, cloudfront_count: 1, tags_unknown_by_type: { cloudfront: 1, s3: 1 } });
        expect(rowB.enabled_region_count).toBe(2);
        expect(rowB.region_status).toHaveLength(2);
        expect(rowB.scan_in_progress_since).not.toBeNull();
        expect(rowB.last_completed_completed_at.toISOString()).toBe('2026-03-04T10:05:00.000Z');

        // No tag: nothing at all.
        await client.query("SELECT set_config('app.current_organization_id', '', true)");
        const [untagged] = (await client.query(statement, paramsFor(a.orgId))).rows;
        expect(untagged).toMatchObject({
          status: null, last_successful_scan_at: null, total: 0, home_count: 0, cloudfront_count: 0,
          s3_regions: [], regions: [], tags_unknown_by_type: {},
          regions_listed_at: null, enabled_region_count: 0, region_status: [], scan_in_progress_since: null,
          last_completed_completed_at: null,
        });
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });

    it('the table lookup reads public\'s tables even when a same-named table without RLS exists in another schema', async () => {
      const unqualified = TABLES_QUERY.split(PUBLIC_SCHEMA_PREDICATE).join('');
      expect(unqualified).not.toContain('relnamespace');
      const schema = `cov_rls_decoy_${process.pid}_${Date.now()}`;

      const client = await pool.connect();
      try {
        // Rolled back: the decoy schema is never visible to any other connection.
        await client.query('BEGIN');
        await client.query(`CREATE SCHEMA ${schema}`);
        await client.query(`CREATE TABLE ${schema}.resource_discovery_jobs (id UUID)`);
        await client.query('GRANT SELECT ON aws_resources, resource_discovery_jobs TO devcontrol');
        await client.query('SET LOCAL ROLE devcontrol');

        // Not vacuous: without the schema predicate, the decoy is selected too.
        const loose = await client.query(unqualified, [TABLES]);
        expect(loose.rows).toContainEqual({ relname: 'resource_discovery_jobs', relrowsecurity: false, not_owner: true });
        expect(loose.rows).not.toEqual(EXPECTED_TABLES);

        const tables = await client.query(TABLES_QUERY, [TABLES]);
        expect(tables.rows).toEqual(EXPECTED_TABLES);
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
      const gone = await pool.query('SELECT to_regnamespace($1) AS ns', [schema]);
      expect(gone.rows[0].ns).toBeNull();
    });
  });
});

// ─── Multi-region M5c (m5c-plan.md) ─────────────────────────────────────────

const HOUR = 60 * 60;
const JUST_FRESH = 13 * HOUR - 60;   // 12 h 59 min
const JUST_STALE = 13 * HOUR + 60;   // 13 h 01 min

describe('M5c: enabled regions from the latest region list', () => {
  it('counts the enabled regions of the latest list only: not a not-enabled region, not one missing from the latest list, not one disabled in an older list', async () => {
    const org = await harness.buildOrg();
    await insertAccount(org.orgId, 'eu-west-1');
    const base = await dbNow();
    for (const region of ['eu-west-1', 'us-east-1', 'ap-south-1']) await insertRegion(org.orgId, ACCOUNT, region, { listedAgo: 60 }, base);
    await insertRegion(org.orgId, ACCOUNT, 'me-south-1', { enabled: false, listedAgo: 60 }, base);
    // Listed by an earlier list only (absent from the latest one).
    await insertRegion(org.orgId, ACCOUNT, 'eu-north-1', { listedAgo: 7 * 24 * HOUR }, base);
    // Not enabled in an earlier list, and absent from the latest one.
    await insertRegion(org.orgId, ACCOUNT, 'af-south-1', { enabled: false, listedAgo: 7 * 24 * HOUR }, base);

    const coverage = await coverageOf(org);
    expect(coverage.scope.enabled_regions).toEqual({
      known: true, count: 3, listed_at: new Date(base.getTime() - 60_000).toISOString(), stale: false,
    });
    expect(coverage.region_status.map((r: RegionJson) => r.region)).toEqual(['eu-west-1', 'ap-south-1', 'us-east-1']);
    expect(coverage.region_status).toHaveLength(coverage.scope.enabled_regions.count);
  });

  it('the region list is stale past 13 hours by the database clock, fresh just before; unknown is never stale', async () => {
    expect(STALE_AFTER_SECONDS).toBe(13 * HOUR);
    const fresh = await harness.buildOrg();
    const stale = await harness.buildOrg();
    for (const org of [fresh, stale]) await insertAccount(org.orgId, 'eu-west-1');
    await insertRegion(fresh.orgId, ACCOUNT, 'eu-west-1', { listedAgo: JUST_FRESH });
    await insertRegion(stale.orgId, ACCOUNT, 'eu-west-1', { listedAgo: JUST_STALE });
    expect((await coverageOf(fresh)).scope.enabled_regions).toMatchObject({ known: true, count: 1, stale: false });
    expect((await coverageOf(stale)).scope.enabled_regions).toMatchObject({ known: true, count: 1, stale: true });
  });
});

describe('M5c: each enabled region\'s last scan status', () => {
  it('home first, then by name; the stored message never leaves the database; codes on the allow-list only', async () => {
    const org = await harness.buildOrg();
    await insertAccount(org.orgId, 'eu-west-1');
    const base = await dbNow();
    await insertRegion(org.orgId, ACCOUNT, 'eu-west-1', {
      status: 'partial', finishedAgo: 600, successAgo: 2 * HOUR, errorCode: DISCOVERY_WARNING_LISTING_TRUNCATED,
      errorMessage: 'listing cut off at arn:aws:iam::123456789012:role/internal-role', consecutiveFailures: 1,
    }, base);
    // A raw AWS-style code in the column: not on the allow-list, so it is returned as null.
    await insertRegion(org.orgId, ACCOUNT, 'ap-south-1', {
      status: 'failed', finishedAgo: 600, errorCode: 'AccessDenied',
      errorMessage: 'AccessDeniedException request-id 0f1e2d3c', consecutiveFailures: 4,
    }, base);
    await insertRegion(org.orgId, ACCOUNT, 'us-east-1', {}, base);

    const { text, body } = await get(org);
    const finished = new Date(base.getTime() - 600_000).toISOString();
    expect(body.coverage.region_status).toEqual([
      {
        region: 'eu-west-1', home: true, status: 'partial', last_scan_finished_at: finished,
        last_success_at: new Date(base.getTime() - 2 * HOUR * 1000).toISOString(),
        last_error_code: DISCOVERY_WARNING_LISTING_TRUNCATED, consecutive_failures: 1, stale: false,
      },
      {
        region: 'ap-south-1', home: false, status: 'failed', last_scan_finished_at: finished, last_success_at: null,
        last_error_code: null, consecutive_failures: 4, stale: false,
      },
      {
        region: 'us-east-1', home: false, status: 'never_scanned', last_scan_finished_at: null, last_success_at: null,
        last_error_code: null, consecutive_failures: 0, stale: false,
      },
    ]);
    for (const leaked of ['AccessDenied', 'internal-role', 'request-id', '123456789012', 'last_error_message', 'listing cut off']) {
      expect(text).not.toContain(leaked);
    }
  });

  it('the allow-list holds exactly the codes M5b records, so none of them is dropped', () => {
    const produced = new Set<string | null>([
      homeRegionScanStatus([{ source: RESOURCE_EXPLORER_SOURCE, status: 'truncated' }])!.errorCode,
      homeRegionScanStatus([{ source: 'ec2', status: 'truncated' }])!.errorCode,
    ]);
    expect([...produced].sort()).toEqual([...REGION_ERROR_CODES].sort());
    expect([...REGION_ERROR_CODES].sort()).toEqual([DISCOVERY_WARNING_LISTING_TRUNCATED, DISCOVERY_WARNING_TRUNCATED_INDEX].sort());
  });

  it('home is the account\'s region: eu-west-1 is home, us-east-1 is not', async () => {
    const org = await harness.buildOrg();
    await insertAccount(org.orgId, 'eu-west-1');
    const base = await dbNow();
    for (const region of ['us-east-1', 'eu-west-1', 'ap-south-1']) await insertRegion(org.orgId, ACCOUNT, region, {}, base);
    const { region_status } = await coverageOf(org);
    expect(region_status.map((r: RegionJson) => [r.region, r.home])).toEqual([
      ['eu-west-1', true], ['ap-south-1', false], ['us-east-1', false],
    ]);
  });

  it('the home region changed after the latest list (absent from it): no entry is home, none is put first', async () => {
    const org = await harness.buildOrg();
    await insertAccount(org.orgId, 'eu-west-1');
    const base = await dbNow();
    for (const region of ['us-east-1', 'ap-south-1']) await insertRegion(org.orgId, ACCOUNT, region, {}, base);
    const coverage = await coverageOf(org);
    expect(coverage.account.home_region).toBe('eu-west-1');
    expect(coverage.region_status.map((r: RegionJson) => [r.region, r.home])).toEqual([
      ['ap-south-1', false], ['us-east-1', false],
    ]);
  });

  it('the allow-list is case-sensitive: an upper-case variant of an allowed code is returned as null', async () => {
    const org = await harness.buildOrg();
    await insertAccount(org.orgId, 'eu-west-1');
    const base = await dbNow();
    await insertRegion(org.orgId, ACCOUNT, 'eu-west-1', {
      status: 'partial', finishedAgo: 600, errorCode: DISCOVERY_WARNING_LISTING_TRUNCATED.toUpperCase(),
    }, base);
    await insertRegion(org.orgId, ACCOUNT, 'us-east-1', {
      status: 'partial', finishedAgo: 600, errorCode: DISCOVERY_WARNING_TRUNCATED_INDEX.toUpperCase(),
    }, base);
    const { text, body } = await get(org);
    expect(body.coverage.region_status.map((r: RegionJson) => [r.region, r.last_error_code])).toEqual([
      ['eu-west-1', null], ['us-east-1', null],
    ]);
    expect(text).not.toContain(DISCOVERY_WARNING_LISTING_TRUNCATED.toUpperCase());
    expect(text).not.toContain(DISCOVERY_WARNING_TRUNCATED_INDEX.toUpperCase());
  });

  it('stale past 13 hours since the status was written (database clock); never_scanned is never stale', async () => {
    const org = await harness.buildOrg();
    await insertAccount(org.orgId, 'eu-west-1');
    const base = await dbNow();
    await insertRegion(org.orgId, ACCOUNT, 'eu-west-1', { status: 'failed', finishedAgo: JUST_STALE }, base);
    await insertRegion(org.orgId, ACCOUNT, 'ap-south-1', { status: 'ok', finishedAgo: JUST_FRESH, successAgo: JUST_FRESH }, base);
    // Written an hour ago; its last success is days old: the status is not stale.
    await insertRegion(org.orgId, ACCOUNT, 'eu-north-1', { status: 'ok', finishedAgo: HOUR, successAgo: 3 * 24 * HOUR }, base);
    // never_scanned, whatever its (hand-seeded) times.
    await insertRegion(org.orgId, ACCOUNT, 'us-east-1', { status: 'never_scanned', finishedAgo: 3 * 24 * HOUR }, base);
    const { region_status } = await coverageOf(org);
    expect(Object.fromEntries(region_status.map((r: RegionJson) => [r.region, r.stale]))).toEqual({
      'eu-west-1': true, 'ap-south-1': false, 'eu-north-1': false, 'us-east-1': false,
    });
  });

  it('only the connected AWS account\'s rows: an earlier account\'s newer list is not read; an ARN naming no account reads nothing', async () => {
    const org = await harness.buildOrg();
    await insertAccount(org.orgId, 'eu-west-1');
    const base = await dbNow();
    await insertRegion(org.orgId, ACCOUNT, 'eu-west-1', { status: 'ok', listedAgo: 2 * HOUR, finishedAgo: 2 * HOUR, successAgo: 2 * HOUR }, base);
    for (const region of ['eu-west-1', 'us-east-1', 'ap-south-1']) {
      await insertRegion(org.orgId, OTHER_ACCOUNT, region, { status: 'failed', listedAgo: 60, finishedAgo: 60 }, base);
    }
    const coverage = await coverageOf(org);
    expect(coverage.scope.enabled_regions).toMatchObject({ known: true, count: 1 });
    expect(coverage.region_status.map((r: RegionJson) => [r.region, r.status])).toEqual([['eu-west-1', 'ok']]);

    const unparseable = await harness.buildOrg();
    await insertAccount(unparseable.orgId, 'eu-west-1', 'active', 'not-a-role-arn');
    await insertRegion(unparseable.orgId, ACCOUNT, 'eu-west-1', { status: 'ok', finishedAgo: 60, successAgo: 60 });
    await insertLease(unparseable.orgId, ACCOUNT, {
      jobId: await insertJob(unparseable.orgId, { status: 'running', createdAt: '2026-03-01T10:00:00.000Z' }),
    });
    const none = await coverageOf(unparseable);
    expect(m5c(none)).toEqual({ enabled_regions: M5C_REGIONS_UNKNOWN, ...NO_REGION_DATA, last_completed_scan: null });
    expect(none.scope.enabled_regions).toEqual({ known: false, count: null, ...M5C_REGIONS_UNKNOWN });
  });
});

describe('M5c: a scan in progress is the discovery lease held AND naming a running or pending job', () => {
  async function orgWithAccount() {
    const org = await harness.buildOrg();
    await insertAccount(org.orgId, 'eu-west-1');
    return org;
  }
  const running = (orgId: string) => insertJob(orgId, { status: 'running', createdAt: '2026-03-01T10:00:00.000Z' });

  it('held + its running job: since = the lease\'s acquisition', async () => {
    const org = await orgWithAccount();
    const acquiredAt = await insertLease(org.orgId, ACCOUNT, { jobId: await running(org.orgId) });
    expect((await coverageOf(org)).scan_in_progress).toEqual({ since: acquiredAt.toISOString() });
  });

  it('held + its pending job: since = the lease\'s acquisition', async () => {
    const org = await orgWithAccount();
    const jobId = await insertJob(org.orgId, { status: 'pending', createdAt: '2026-03-01T10:00:00.000Z' });
    const acquiredAt = await insertLease(org.orgId, ACCOUNT, { jobId });
    expect((await coverageOf(org)).scan_in_progress).toEqual({ since: acquiredAt.toISOString() });
  });

  it('held with no job (a cost Analyze): not in progress', async () => {
    const org = await orgWithAccount();
    await running(org.orgId);
    await insertLease(org.orgId, ACCOUNT, { jobId: null });
    expect((await coverageOf(org)).scan_in_progress).toBeNull();
  });

  it('held, but its job already finished (completed or failed): not in progress', async () => {
    for (const status of ['completed', 'failed'] as const) {
      const org = await orgWithAccount();
      const jobId = await insertJob(org.orgId, { status, createdAt: '2026-03-01T10:00:00.000Z', completedAt: '2026-03-01T10:05:00.000Z' });
      await insertLease(org.orgId, ACCOUNT, { jobId });
      const coverage = await coverageOf(org);
      expect(coverage.scan_in_progress).toBeNull();
      // The failed job is not a completed scan.
      expect(coverage.last_completed_scan).toEqual(
        status === 'failed' ? null : expect.objectContaining({ completed_at: '2026-03-01T10:05:00.000Z' })
      );
    }
  });

  it('a running job whose lease was released, or has expired by the database clock: not in progress', async () => {
    const released = await orgWithAccount();
    await insertLease(released.orgId, ACCOUNT, { jobId: await running(released.orgId), released: true });
    expect((await coverageOf(released)).scan_in_progress).toBeNull();

    const expired = await orgWithAccount();
    await insertLease(expired.orgId, ACCOUNT, { jobId: await running(expired.orgId), expiresIn: -60 });
    expect((await coverageOf(expired)).scan_in_progress).toBeNull();
  });

  it('another scan kind\'s lease is not a discovery scan', async () => {
    const org = await orgWithAccount();
    await insertLease(org.orgId, ACCOUNT, { jobId: await running(org.orgId), scanKind: 'security_hub_sync' });
    expect((await coverageOf(org)).scan_in_progress).toBeNull();
  });

  it('decided on the database clock: the application\'s clock a day off changes nothing', async () => {
    const held = await orgWithAccount();
    await insertLease(held.orgId, ACCOUNT, { jobId: await running(held.orgId) });
    const expired = await orgWithAccount();
    await insertLease(expired.orgId, ACCOUNT, { jobId: await running(expired.orgId), expiresIn: -60 });
    const realNow = Date.now();
    const timers = ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
      'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval',
      'setTimeout', 'clearTimeout'] as const;
    try {
      // Only Date is faked.
      jest.useFakeTimers({ doNotFake: [...timers], now: realNow + 24 * HOUR * 1000 });
      expect((await coverageOf(held)).scan_in_progress).not.toBeNull();
      jest.setSystemTime(realNow - 24 * HOUR * 1000);
      expect((await coverageOf(expired)).scan_in_progress).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('M5c: the newest completed scan', () => {
  it('is the newest completed job while newer failed and running jobs are the last scan; its time is last_successful_scan_at', async () => {
    const org = await harness.buildOrg();
    await insertAccount(org.orgId, 'eu-west-1');
    await insertJob(org.orgId, {
      status: 'completed', createdAt: '2026-03-01T10:00:00.000Z', completedAt: '2026-03-01T10:05:00.000Z',
      resourceTypes: FREE_PLAN_TYPES, warnings: [DISCOVERY_WARNING_TRUNCATED_INDEX],
    });
    await insertJob(org.orgId, {
      status: 'completed', createdAt: '2026-02-01T10:00:00.000Z', completedAt: '2026-02-01T10:05:00.000Z',
      resourceTypes: ['ec2'],
    });
    await insertJob(org.orgId, {
      status: 'failed', createdAt: '2026-03-02T10:00:00.000Z', completedAt: '2026-03-02T10:01:00.000Z',
      resourceTypes: [...FREE_PLAN_TYPES, 'cloudfront'], errorMessage: INTERNAL_ERROR_TEXT,
    });
    await insertJob(org.orgId, { status: 'running', createdAt: '2026-03-03T10:00:00.000Z', resourceTypes: [...FREE_PLAN_TYPES, 'cloudfront'] });

    const { text, body } = await get(org);
    expect(body.coverage.last_scan.status).toBe('running');
    expect(body.coverage.resource_types).toEqual([...FREE_PLAN_TYPES, 'cloudfront']);
    expect(body.coverage.last_completed_scan).toEqual({
      started_at: '2026-03-01T10:00:00.000Z', completed_at: '2026-03-01T10:05:00.000Z',
      resource_types: FREE_PLAN_TYPES, warnings: [DISCOVERY_WARNING_TRUNCATED_INDEX],
    });
    expect(body.coverage.last_completed_scan.completed_at).toBe(body.coverage.last_successful_scan_at);
    expect(text).not.toContain('AccessDenied');
  });

  it('a completed job\'s warnings stored only in error_message are passed on as codes, the text never', async () => {
    const org = await harness.buildOrg();
    await insertJob(org.orgId, {
      status: 'completed', createdAt: '2026-03-01T10:00:00.000Z', completedAt: '2026-03-01T10:05:00.000Z',
      errorMessage: joinDiscoveryMessage([], [DISCOVERY_WARNING_TRUNCATED_INDEX]),
    });
    const coverage = await coverageOf(org);
    // No account: the organization's jobs are still read, as last_successful_scan_at always was.
    expect(coverage.account.connected).toBe(false);
    expect(coverage.last_completed_scan.warnings).toEqual([DISCOVERY_WARNING_TRUNCATED_INDEX]);
  });
});

describe('M5c: the explicit predicates alone keep tenants apart (superuser, RLS bypassed)', () => {
  it('B\'s region list, home status, held lease and running job on the SAME AWS account never reach A', async () => {
    const a = await harness.buildOrg();
    const b = await harness.buildOrg();
    await insertAccount(a.orgId, 'eu-west-1');
    await insertAccount(b.orgId, 'eu-west-1');
    const base = await dbNow();
    for (const region of ['eu-west-1', 'us-east-1']) {
      await insertRegion(b.orgId, ACCOUNT, region, { status: 'ok', finishedAgo: 60, successAgo: 60 }, base);
    }
    const bJob = await insertJob(b.orgId, { status: 'running', createdAt: '2026-03-01T10:00:00.000Z' });
    await insertLease(b.orgId, ACCOUNT, { jobId: bJob });
    // A's own lease names B's running job (job_id is not a foreign key): still not A's scan.
    await insertLease(a.orgId, ACCOUNT, { jobId: bJob });
    await insertJob(b.orgId, { status: 'completed', createdAt: '2026-03-02T10:00:00.000Z', completedAt: '2026-03-02T10:05:00.000Z' });

    // Through the route (request connection, RLS + predicates).
    const coverage = await coverageOf(a);
    expect(m5c(coverage)).toEqual({ enabled_regions: M5C_REGIONS_UNKNOWN, ...NO_REGION_DATA, last_completed_scan: null });
    expect(coverage.scope.enabled_regions.known).toBe(false);

    // The route's exact statement as the superuser: RLS bypassed, only the predicates scope it.
    const [statementA] = await statementsDuring(() => get(a), /WITH last_job AS/);
    expect(statementA.values[0]).toBe(a.orgId);
    const role = await pool.query('SELECT rolsuper OR rolbypassrls AS bypasses FROM pg_roles WHERE rolname = current_user');
    expect(role.rows[0].bypasses).toBe(true);
    const [row] = (await pool.query(statementA.text, statementA.values)).rows;
    expect(row).toMatchObject({
      status: null, regions_listed_at: null, enabled_region_count: 0, region_status: [],
      scan_in_progress_since: null, last_completed_completed_at: null,
    });
    // Not vacuous: the same statement for B finds B's.
    const [rowB] = (await pool.query(statementA.text, [b.orgId, ...statementA.values.slice(1)])).rows;
    expect(rowB.enabled_region_count).toBe(2);
    expect(rowB.scan_in_progress_since).not.toBeNull();
    expect(rowB.last_completed_completed_at).not.toBeNull();
  });
});

describe('M5c: staleness constants', () => {
  it('the interval is the discovery cron\'s, and stale = 2 intervals + the longest scan (the lease\'s maximum age)', () => {
    const job = fs.readFileSync(path.join(__dirname, '..', '..', 'jobs', 'resourceDiscovery.job.ts'), 'utf8');
    const schedules = [...job.matchAll(/cron\.schedule\('([^']+)'/g)].map((m) => m[1]);
    expect(schedules).toEqual(['0 */6 * * *']);
    expect(DISCOVERY_INTERVAL_SECONDS).toBe(6 * HOUR);
    expect(MAX_LEASE_AGE_SECONDS).toBe(HOUR);
    expect(STALE_AFTER_SECONDS).toBe(2 * DISCOVERY_INTERVAL_SECONDS + MAX_LEASE_AGE_SECONDS);
  });
});

describe('no AWS call', () => {
  it('the handler makes no AWS SDK call and builds no AWS client or scan context', async () => {
    const org = await harness.buildOrg();
    await insertAccount(org.orgId, 'eu-west-1');
    await insertJob(org.orgId, {
      status: 'completed', createdAt: '2026-03-01T10:00:00.000Z', completedAt: '2026-03-01T10:05:00.000Z',
    });
    await insertResource(org.orgId, 'web-1', { type: 'ec2', region: 'eu-west-1' });
    // Every AWS SDK v3 client's send() is the shared smithy Client.prototype.send.
    const sdkClientPrototype = Object.getPrototypeOf(EC2Client.prototype);
    expect(typeof sdkClientPrototype.send).toBe('function');
    const send = jest.spyOn(sdkClientPrototype, 'send');
    const createClients = jest.spyOn(AWSClientFactory, 'createClients');
    const assumeRole = jest.spyOn(AWSClientFactory, 'assumeAccountRole');
    const forOrg = jest.spyOn(ScanContext, 'forOrg');

    expect((await get(org)).status).toBe(200);
    expect(send).not.toHaveBeenCalled();
    expect(createClients).not.toHaveBeenCalled();
    expect(assumeRole).not.toHaveBeenCalled();
    expect(forOrg).not.toHaveBeenCalled();
  });

  it('the route module imports no AWS SDK package, client factory, scan context or STS helper', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'services-coverage.routes.ts'), 'utf8');
    const imports = source.split('\n').filter((line) => /^import /.test(line));
    expect(imports.length).toBeGreaterThan(0);
    for (const line of imports) {
      expect(line).not.toMatch(/@aws-sdk|aws-client-factory|scan-context|platform-sts|awsResourceDiscovery|resourceExplorer/);
    }
  });
});
