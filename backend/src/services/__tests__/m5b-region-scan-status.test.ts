/**
 * Multi-region plan M5b (m5-plan.md §13): the home region's scan status.
 *
 *  - homeRegionScanStatus (services/region-scan-status.ts): which sources count
 *    and how their outcomes combine (denied > timed_out > failed > partial > ok),
 *    and which existing truncation code a `partial` carries.
 *  - recordHomeRegionScanStatus (repositories/multi-region-foundation.repository.ts):
 *    the fenced write (F18) -- only the scan columns, last_success_at per status,
 *    never an insert or a delete, never over a newer scan, stale tokens (F1), the
 *    account check (F2) and two-organization isolation under row-level security.
 *
 * The repository tests run against their own schema holding the real foundation
 * migration (read from disk), as devcontrol under row-level security, with rows
 * committed by separate connections; the schema is dropped in finally.
 * Placeholders only.
 */
import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { SourceOutcome, SourceStatus } from '../source-outcome';
import { HOME_REGION_SOURCES, HomeRegionScanResult, RESOURCE_EXPLORER_SOURCE, homeRegionScanStatus } from '../region-scan-status';
import { DISCOVERY_WARNING_LISTING_TRUNCATED, DISCOVERY_WARNING_TRUNCATED_INDEX } from '../discovery-warnings';
import { recordHomeRegionScanStatus, recordRegionList } from '../../repositories/multi-region-foundation.repository';
import { AwsAccountAmbiguousError } from '../../repositories/aws-accounts.repository';
import { HeldLease, LeaseLostError, acquireScanLease, releaseLease } from '../scan-lease';
import { ListedRegion } from '../region-list';

const MIGRATION_SQL = fs.readFileSync(
  path.join(__dirname, '../../../../database/migrations-admin/202610191200_create_multi_region_scan_foundation.sql'),
  'utf8'
);

const HOME = 'us-east-1';
const OTHER = 'eu-west-1';
/** Documented placeholder account ids (aws-account-id-literals.test.ts). */
const ACCOUNT_A = '111122223333';
const ACCOUNT_B = '123456789012';
const roleArn = (account: string) => `arn:aws:iam::${account}:role/devcontrol-test`;

const outcome = (source: string, status: SourceStatus): SourceOutcome => ({ source, status });
/** Every home-region source complete, then `changes` applied. */
function sources(changes: Record<string, SourceStatus> = {}): SourceOutcome[] {
  return HOME_REGION_SOURCES.map((source) => outcome(source, changes[source] ?? 'complete'));
}

// ---------------------------------------------------------------------------
describe('homeRegionScanStatus: which sources count', () => {
  it('the home region is the five inventory listings and the Resource Explorer search', () => {
    expect([...HOME_REGION_SOURCES].sort()).toEqual(['ebs', 'ec2', 'lambda', 'load-balancer', 'rds', RESOURCE_EXPLORER_SOURCE].sort());
  });

  it('S3, CloudFront, IAM and the security-group scan never count, whatever their outcome (Q-B)', () => {
    const others = [
      outcome('s3', 'failed'),
      outcome('cloudfront', 'denied'),
      outcome('iam', 'timed_out'),
      outcome('security-groups', 'partial'),
      outcome('networking', 'failed'),
    ];
    expect(homeRegionScanStatus([...sources(), ...others])).toEqual({ status: 'ok', errorCode: null });
    // Only those: nothing counts, nothing is written.
    expect(homeRegionScanStatus(others)).toBeNull();
    expect(homeRegionScanStatus([outcome('s3', 'complete')])).toBeNull();
    expect(homeRegionScanStatus([outcome('cloudfront', 'complete')])).toBeNull();
  });

  it('a source the tier does not include is left out; with none left, nothing is written', () => {
    const freeTier = sources({ lambda: 'skipped_tier', 'load-balancer': 'skipped_tier' });
    expect(homeRegionScanStatus(freeTier)).toEqual({ status: 'ok', errorCode: null });
    expect(homeRegionScanStatus(HOME_REGION_SOURCES.map((s) => outcome(s, 'skipped_tier')))).toBeNull();
    expect(homeRegionScanStatus([])).toBeNull();
  });
});

describe('homeRegionScanStatus: one status, worst wins (denied > timed_out > failed > partial > ok)', () => {
  it.each<[string, Record<string, SourceStatus>, HomeRegionScanResult]>([
    ['every source complete', {}, { status: 'ok', errorCode: null }],
    ['one source denied', { ec2: 'denied' }, { status: 'denied', errorCode: null }],
    ['one source timed out', { lambda: 'timed_out' }, { status: 'timed_out', errorCode: null }],
    ['one source failed', { rds: 'failed' }, { status: 'failed', errorCode: null }],
    ['the Resource Explorer search failed', { [RESOURCE_EXPLORER_SOURCE]: 'failed' }, { status: 'failed', errorCode: null }],
    ['denied, timed out and failed together', { ec2: 'denied', ebs: 'timed_out', rds: 'failed' }, { status: 'denied', errorCode: null }],
    ['timed out and failed together', { ebs: 'failed', lambda: 'timed_out' }, { status: 'timed_out', errorCode: null }],
    ['failed and truncated together', { rds: 'failed', ebs: 'truncated', [RESOURCE_EXPLORER_SOURCE]: 'truncated' }, { status: 'failed', errorCode: null }],
    ['denied and truncated together', { 'load-balancer': 'denied', ec2: 'truncated' }, { status: 'denied', errorCode: null }],
    ['every source denied', Object.fromEntries(HOME_REGION_SOURCES.map((s) => [s, 'denied'])), { status: 'denied', errorCode: null }],
  ])('%s', (_label, changes, expected) => {
    expect(homeRegionScanStatus(sources(changes))).toEqual(expected);
  });

  it('mixed: some sources fail while the others complete -> the failure, never partial or ok', () => {
    for (const failure of ['denied', 'timed_out', 'failed'] as const) {
      for (const source of HOME_REGION_SOURCES) {
        expect(homeRegionScanStatus(sources({ [source]: failure }))).toEqual({ status: failure, errorCode: null });
      }
    }
  });

  it('a status no listing produces today (partial) is a failure, never ok', () => {
    expect(homeRegionScanStatus(sources({ ec2: 'partial' }))).toEqual({ status: 'failed', errorCode: null });
  });
});

describe('homeRegionScanStatus: partial and its code (the two existing truncation codes)', () => {
  it('only the Resource Explorer search cut off -> the truncated-index code', () => {
    expect(homeRegionScanStatus(sources({ [RESOURCE_EXPLORER_SOURCE]: 'truncated' }))).toEqual({
      status: 'partial',
      errorCode: DISCOVERY_WARNING_TRUNCATED_INDEX,
    });
  });

  it.each(['ec2', 'ebs', 'rds', 'lambda', 'load-balancer'])('only the %s listing cut off -> the listing-truncated code', (source) => {
    expect(homeRegionScanStatus(sources({ [source]: 'truncated' }))).toEqual({
      status: 'partial',
      errorCode: DISCOVERY_WARNING_LISTING_TRUNCATED,
    });
  });

  it('both cut off -> the truncated-index code', () => {
    expect(homeRegionScanStatus(sources({ ec2: 'truncated', [RESOURCE_EXPLORER_SOURCE]: 'truncated' }))).toEqual({
      status: 'partial',
      errorCode: DISCOVERY_WARNING_TRUNCATED_INDEX,
    });
  });

  it('the codes are the existing ones', () => {
    expect([DISCOVERY_WARNING_TRUNCATED_INDEX, DISCOVERY_WARNING_LISTING_TRUNCATED]).toEqual([
      'deletion_detection_paused_truncated_index',
      'discovery_listing_truncated',
    ]);
  });
});

// ---------------------------------------------------------------------------
// recordHomeRegionScanStatus against the real migration, as devcontrol under RLS.

function dbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };
}

const ROLE_SQL = 'SELECT current_user AS role, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user';
let schemaCounter = 0;

interface Env {
  schema: string;
  admin: Client;
  organization: (account?: string | null) => Promise<string>;
  connection: (organization: string) => Promise<Client>;
  /** A committed job row of `organization`, started `minutesAgo` minutes ago. */
  job: (organization: string, minutesAgo?: number) => Promise<string>;
}

async function withSchema(fn: (env: Env) => Promise<void>): Promise<void> {
  const admin = new Client(dbConfig());
  await admin.connect();
  const schema = `m5b_region_status_test_${process.pid}_${Date.now()}_${schemaCounter++}`;
  const clients: Client[] = [];
  try {
    await admin.query('BEGIN');
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.query(`SET LOCAL search_path TO ${schema}`);
    await admin.query(`CREATE TABLE organizations (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(255) NOT NULL)`);
    await admin.query(`
      CREATE TABLE resource_discovery_jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        error_message TEXT,
        started_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )`);
    await admin.query(`
      CREATE TABLE aws_accounts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id UUID NOT NULL,
        role_arn TEXT NOT NULL,
        account_id VARCHAR(32),
        nickname VARCHAR(255),
        external_id VARCHAR(64),
        region VARCHAR(32) DEFAULT 'us-east-1',
        connected_at TIMESTAMPTZ,
        status VARCHAR(32)
      )`);
    await admin.query(MIGRATION_SQL);
    await admin.query(`GRANT USAGE ON SCHEMA ${schema} TO devcontrol`);
    await admin.query(`GRANT SELECT ON aws_accounts TO devcontrol`);
    await admin.query(`GRANT SELECT ON resource_discovery_jobs TO devcontrol`);
    await admin.query('COMMIT');

    await fn({
      schema,
      admin,
      organization: async (account = ACCOUNT_A) => {
        const org = (await admin.query(`INSERT INTO ${schema}.organizations (name) VALUES ('Region Status Org') RETURNING id`)).rows[0].id;
        if (account) await admin.query(`INSERT INTO ${schema}.aws_accounts (org_id, role_arn, status) VALUES ($1, $2, 'active')`, [org, roleArn(account)]);
        return org;
      },
      connection: async (organization) => {
        const client = new Client({ ...dbConfig(), options: '-c statement_timeout=15000' });
        client.on('error', () => undefined);
        await client.connect();
        clients.push(client);
        await client.query(`SET search_path TO ${schema}`);
        await client.query('SET ROLE devcontrol');
        await client.query("SELECT set_config('app.current_organization_id', $1, false)", [organization]);
        expect((await client.query(ROLE_SQL)).rows).toEqual([{ role: 'devcontrol', rolsuper: false, rolbypassrls: false }]);
        return client;
      },
      job: async (organization, minutesAgo = 5) =>
        (
          await admin.query(
            `INSERT INTO ${schema}.resource_discovery_jobs (organization_id, status, started_at)
             VALUES ($1, 'running', now() - make_interval(mins => $2)) RETURNING id`,
            [organization, minutesAgo]
          )
        ).rows[0].id,
    });
  } finally {
    await Promise.all(clients.map((client) => client.end().catch(() => undefined)));
    await admin.query('ROLLBACK').catch(() => undefined);
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
}

const scanKey = (organizationId: string, awsAccountId = ACCOUNT_A) => ({ organizationId, awsAccountId, scanKind: 'discovery' });

async function lease(db: Client, org: string, account = ACCOUNT_A, ttlSeconds?: number): Promise<HeldLease> {
  const held = await acquireScanLease(db, scanKey(org, account), 'm5b-test', { ttlSeconds });
  expect(held).not.toBeNull();
  return held!;
}

const LIST: ListedRegion[] = [
  { region: HOME, optInStatus: 'opt-in-not-required', enabled: true },
  { region: OTHER, optInStatus: 'opt-in-not-required', enabled: true },
  { region: 'eu-south-1', optInStatus: 'not-opted-in', enabled: false },
];

/** Every row of the organization, read as the owner (no RLS), by region. */
async function rowsOf(env: Env, org: string): Promise<Record<string, any>> {
  const { rows } = await env.admin.query(`SELECT * FROM ${env.schema}.aws_account_regions WHERE organization_id = $1 ORDER BY region`, [org]);
  return Object.fromEntries(rows.map((row) => [row.region, row]));
}

const LIST_COLUMNS = ['organization_id', 'aws_account_id', 'region', 'opt_in_status', 'enabled', 'scan_enabled', 'first_seen_at', 'last_listed_at', 'disabled_at'];
const SCAN_COLUMNS = [
  'last_scan_started_at', 'last_scan_finished_at', 'last_success_at', 'last_scan_status', 'last_error_code', 'last_error_message', 'consecutive_failures',
];
const pick = (row: any, columns: string[]) => Object.fromEntries(columns.map((c) => [c, row[c]]));

const PRIOR_SUCCESS = new Date('2026-10-01T00:00:00Z');

/** The home row with a prior scan's values (as the owner): a non-NULL last_success_at, 2 failures, a code. */
async function seedPriorScan(env: Env, org: string, lastSuccess: Date | null = PRIOR_SUCCESS): Promise<void> {
  await env.admin.query(
    `UPDATE ${env.schema}.aws_account_regions
        SET last_scan_started_at = now() - interval '7 hours', last_scan_finished_at = now() - interval '6 hours',
            last_success_at = $3, last_scan_status = 'partial', last_error_code = 'discovery_listing_truncated', consecutive_failures = 2
      WHERE organization_id = $1 AND region = $2`,
    [org, HOME, lastSuccess]
  );
}

/** An organization with a stored list (its home row), a job, a held lease and a connection. */
async function scanned(env: Env) {
  const org = await env.organization();
  const db = await env.connection(org);
  const held = await lease(db, org);
  await recordRegionList(db, held, LIST);
  const jobId = await env.job(org);
  return { org, db, held, jobId };
}

const write = (db: Client, held: HeldLease, jobId: string, result: HomeRegionScanResult, region = HOME) =>
  recordHomeRegionScanStatus(db, held, { region, jobId, result });

describe('recordHomeRegionScanStatus (F18): what is written per status', () => {
  it('ok: status ok, no code, last_success_at now (moved past a prior value), started = the job\'s start, failures reset', async () => {
    await withSchema(async (env) => {
      const { org, db, held, jobId } = await scanned(env);
      await seedPriorScan(env, org);
      const jobStart = (await env.admin.query(`SELECT started_at FROM ${env.schema}.resource_discovery_jobs WHERE id = $1`, [jobId])).rows[0].started_at;

      expect(await write(db, held, jobId, { status: 'ok', errorCode: null })).toBe(1);
      const row = (await rowsOf(env, org))[HOME];
      expect(row).toMatchObject({ last_scan_status: 'ok', last_error_code: null, last_error_message: null, consecutive_failures: 0 });
      expect(row.last_scan_started_at).toEqual(jobStart);
      expect(row.last_scan_finished_at.getTime()).toBeGreaterThanOrEqual(jobStart.getTime());
      expect(row.last_success_at.getTime()).toBeGreaterThan(PRIOR_SUCCESS.getTime());
      expect(row.last_success_at).toEqual(row.last_scan_finished_at);
    });
  });

  it.each([
    ['partial with the truncated-index code', { status: 'partial', errorCode: DISCOVERY_WARNING_TRUNCATED_INDEX }, 2],
    ['partial with the listing-truncated code', { status: 'partial', errorCode: DISCOVERY_WARNING_LISTING_TRUNCATED }, 2],
    ['failed', { status: 'failed', errorCode: null }, 3],
    ['denied', { status: 'denied', errorCode: null }, 3],
    ['timed_out', { status: 'timed_out', errorCode: null }, 3],
  ] as Array<[string, HomeRegionScanResult, number]>)('%s: a non-NULL prior last_success_at is preserved', async (_label, result, failures) => {
    await withSchema(async (env) => {
      const { org, db, held, jobId } = await scanned(env);
      await seedPriorScan(env, org);
      expect(await write(db, held, jobId, result)).toBe(1);
      const row = (await rowsOf(env, org))[HOME];
      expect(row).toMatchObject({ last_scan_status: result.status, last_error_code: result.errorCode, consecutive_failures: failures });
      expect(row.last_success_at).toEqual(PRIOR_SUCCESS);
      expect(row.last_scan_finished_at.getTime()).toBeGreaterThan(Date.now() - 60_000);
    });
  });

  it.each(['partial', 'failed', 'denied', 'timed_out'] as const)('%s: a NULL prior last_success_at stays NULL', async (status) => {
    await withSchema(async (env) => {
      const { org, db, held, jobId } = await scanned(env);
      await seedPriorScan(env, org, null);
      const errorCode = status === 'partial' ? DISCOVERY_WARNING_LISTING_TRUNCATED : null;
      expect(await write(db, held, jobId, { status, errorCode })).toBe(1);
      expect((await rowsOf(env, org))[HOME]).toMatchObject({ last_scan_status: status, last_success_at: null });
    });
  });

  it('ok after a failure, then a failure after ok: last_success_at is the ok scan\'s, kept through the failure', async () => {
    await withSchema(async (env) => {
      const { org, db, held, jobId } = await scanned(env);
      await write(db, held, jobId, { status: 'ok', errorCode: null });
      const okAt = (await rowsOf(env, org))[HOME].last_success_at;
      const later = await env.job(org, 1);
      await write(db, held, later, { status: 'denied', errorCode: null });
      const row = (await rowsOf(env, org))[HOME];
      expect(row).toMatchObject({ last_scan_status: 'denied', consecutive_failures: 1 });
      expect(row.last_success_at).toEqual(okAt);
    });
  });
});

describe('recordHomeRegionScanStatus (F18): only the home row\'s scan columns', () => {
  it('the list columns and every other row are untouched by the status write', async () => {
    await withSchema(async (env) => {
      const { org, db, held, jobId } = await scanned(env);
      const before = await rowsOf(env, org);
      await write(db, held, jobId, { status: 'failed', errorCode: null });
      const after = await rowsOf(env, org);
      expect(pick(after[HOME], LIST_COLUMNS)).toEqual(pick(before[HOME], LIST_COLUMNS));
      expect(after[OTHER]).toEqual(before[OTHER]);
      expect(after['eu-south-1']).toEqual(before['eu-south-1']);
    });
  });

  it('and the list write leaves the scan columns as the status write left them', async () => {
    await withSchema(async (env) => {
      const { org, db, held, jobId } = await scanned(env);
      await write(db, held, jobId, { status: 'ok', errorCode: null });
      const before = pick((await rowsOf(env, org))[HOME], SCAN_COLUMNS);
      await recordRegionList(db, held, LIST);
      expect(pick((await rowsOf(env, org))[HOME], SCAN_COLUMNS)).toEqual(before);
    });
  });

  it('no home row (the region list was never stored): nothing inserted, 0 returned', async () => {
    await withSchema(async (env) => {
      const org = await env.organization();
      const db = await env.connection(org);
      const held = await lease(db, org);
      const jobId = await env.job(org);
      expect(await write(db, held, jobId, { status: 'ok', errorCode: null })).toBe(0);
      expect(await rowsOf(env, org)).toEqual({});
    });
  });

  it('a newer scan\'s status is never overwritten by an older scan', async () => {
    await withSchema(async (env) => {
      const { org, db, held } = await scanned(env);
      const older = await env.job(org, 30);
      const newer = await env.job(org, 5);
      await write(db, held, newer, { status: 'denied', errorCode: null });
      const before = await rowsOf(env, org);
      expect(await write(db, held, older, { status: 'ok', errorCode: null })).toBe(0);
      expect(await rowsOf(env, org)).toEqual(before);
    });
  });

  it('the same scan written twice: the second write lands (idempotent per job)', async () => {
    await withSchema(async (env) => {
      const { org, db, held, jobId } = await scanned(env);
      await write(db, held, jobId, { status: 'failed', errorCode: null });
      expect(await write(db, held, jobId, { status: 'failed', errorCode: null })).toBe(1);
      expect((await rowsOf(env, org))[HOME].consecutive_failures).toBe(2);
    });
  });

  it('another organization\'s job never dates this organization\'s row: 0 rows', async () => {
    await withSchema(async (env) => {
      const { org, db, held } = await scanned(env);
      const other = await env.organization(ACCOUNT_B);
      const otherJob = await env.job(other);
      const before = await rowsOf(env, org);
      expect(await write(db, held, otherJob, { status: 'ok', errorCode: null })).toBe(0);
      expect(await rowsOf(env, org)).toEqual(before);
    });
  });

  it('a region the scan did not scan gets nothing when there is no row; S3/CloudFront regions are never written by name', async () => {
    await withSchema(async (env) => {
      const { org, db, held, jobId } = await scanned(env);
      expect(await write(db, held, jobId, { status: 'ok', errorCode: null }, 'ap-south-2')).toBe(0);
      expect(Object.keys(await rowsOf(env, org)).sort()).toEqual(LIST.map((r) => r.region).sort());
      // 'global' is not a region the table can hold, and the update matches no row.
      expect(await write(db, held, jobId, { status: 'ok', errorCode: null }, 'global')).toBe(0);
    });
  });
});

describe('recordHomeRegionScanStatus (F18): fenced', () => {
  it('F1 a token from a released lease that another worker took over writes nothing', async () => {
    await withSchema(async (env) => {
      const { org, db: a, held: stale, jobId } = await scanned(env);
      const b = await env.connection(org);
      const before = await rowsOf(env, org);
      await releaseLease(a, stale);
      const current = await lease(b, org);
      expect(BigInt(current.fencingToken)).toBeGreaterThan(BigInt(stale.fencingToken));

      expect(await write(a, stale, jobId, { status: 'ok', errorCode: null }).catch((err) => err)).toBeInstanceOf(LeaseLostError);
      expect(await rowsOf(env, org)).toEqual(before);

      expect(await write(b, current, jobId, { status: 'ok', errorCode: null })).toBe(1);
      expect((await rowsOf(env, org))[HOME].last_scan_status).toBe('ok');
    });
  });

  it('F1 a lease that expired by the database clock writes nothing, before and after a takeover', async () => {
    await withSchema(async (env) => {
      const org = await env.organization();
      const a = await env.connection(org);
      const b = await env.connection(org);
      // The home row is committed by the owner, so nothing has to beat the 1 s lease.
      await env.admin.query(`INSERT INTO ${env.schema}.aws_account_regions (organization_id, aws_account_id, region, enabled) VALUES ($1, $2, $3, true)`, [
        org, ACCOUNT_A, HOME,
      ]);
      const stale = await lease(a, org, ACCOUNT_A, 1);
      const jobId = await env.job(org);
      const before = await rowsOf(env, org);
      const deadline = Date.now() + 15_000;
      while ((await env.admin.query(`SELECT expires_at <= clock_timestamp() AS e FROM ${env.schema}.aws_scan_leases WHERE organization_id = $1`, [org])).rows[0].e !== true) {
        if (Date.now() > deadline) throw new Error('the lease did not expire');
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(await write(a, stale, jobId, { status: 'ok', errorCode: null }).catch((err) => err)).toBeInstanceOf(LeaseLostError);
      await lease(b, org);
      expect(await write(a, stale, jobId, { status: 'ok', errorCode: null }).catch((err) => err)).toBeInstanceOf(LeaseLostError);
      expect(await rowsOf(env, org)).toEqual(before);
    });
  });

  it.each([
    ['a second active account appears', 'second_active', AwsAccountAmbiguousError],
    ['the account row names another account', 'other', LeaseLostError],
  ] as const)('F2 %s: refused, nothing written', async (_label, change, errorType) => {
    await withSchema(async (env) => {
      const { org, db, held, jobId } = await scanned(env);
      const before = await rowsOf(env, org);
      if (change === 'second_active') {
        await env.admin.query(`INSERT INTO ${env.schema}.aws_accounts (org_id, role_arn, status) VALUES ($1, $2, 'active')`, [org, roleArn(ACCOUNT_B)]);
      } else {
        await env.admin.query(`UPDATE ${env.schema}.aws_accounts SET role_arn = $2 WHERE org_id = $1`, [org, roleArn(ACCOUNT_B)]);
      }
      expect(await write(db, held, jobId, { status: 'ok', errorCode: null }).catch((err) => err)).toBeInstanceOf(errorType);
      expect(await rowsOf(env, org)).toEqual(before);
    });
  });

  it('a job lease is refused before any statement', async () => {
    await withSchema(async (env) => {
      const { org, db, held, jobId } = await scanned(env);
      const jobLease = { ...held, key: { ...held.key, table: 'job_leases' } } as unknown as HeldLease;
      await expect(write(db, jobLease, jobId, { status: 'ok', errorCode: null })).rejects.toThrow(/a scan lease is required/);
      expect((await rowsOf(env, org))[HOME].last_scan_status).toBe('never_scanned');
    });
  });
});

describe('recordHomeRegionScanStatus: two organizations under row-level security (committed rows)', () => {
  it('two organizations with the same AWS account: each status write changes only its own row', async () => {
    await withSchema(async (env) => {
      const orgA = await env.organization(ACCOUNT_A);
      const orgB = await env.organization(ACCOUNT_A);
      const dbA = await env.connection(orgA);
      const dbB = await env.connection(orgB);
      const leaseA = await lease(dbA, orgA);
      const leaseB = await lease(dbB, orgB);
      await recordRegionList(dbA, leaseA, LIST);
      await recordRegionList(dbB, leaseB, LIST);
      await write(dbB, leaseB, await env.job(orgB), { status: 'denied', errorCode: null });
      const beforeB = await rowsOf(env, orgB);

      expect(await write(dbA, leaseA, await env.job(orgA), { status: 'ok', errorCode: null })).toBe(1);
      expect(await rowsOf(env, orgB)).toEqual(beforeB);
      expect((await rowsOf(env, orgA))[HOME].last_scan_status).toBe('ok');

      // Row-level security alone (no organization predicate): A's connection reaches only A's row.
      const update = await dbA.query(`UPDATE aws_account_regions SET last_error_code = 'rls_probe' WHERE aws_account_id = $1 AND region = $2`, [ACCOUNT_A, HOME]);
      expect(update.rowCount).toBe(1);
      expect(await rowsOf(env, orgB)).toEqual(beforeB);
      expect((await dbA.query(`SELECT DISTINCT organization_id FROM aws_account_regions`)).rows).toEqual([{ organization_id: orgA }]);
    });
  });

  it('another organization\'s lease on this organization\'s connection is refused; neither row changes', async () => {
    await withSchema(async (env) => {
      const orgA = await env.organization(ACCOUNT_A);
      const orgB = await env.organization(ACCOUNT_A);
      const dbA = await env.connection(orgA);
      const dbB = await env.connection(orgB);
      const leaseA = await lease(dbA, orgA);
      const leaseB = await lease(dbB, orgB);
      await recordRegionList(dbA, leaseA, LIST);
      await recordRegionList(dbB, leaseB, LIST);
      const before = { a: await rowsOf(env, orgA), b: await rowsOf(env, orgB) };
      const error = await write(dbA, leaseB, await env.job(orgB), { status: 'ok', errorCode: null }).catch((err) => err);
      expect(error).toBeInstanceOf(LeaseLostError);
      expect({ a: await rowsOf(env, orgA), b: await rowsOf(env, orgB) }).toEqual(before);
    });
  });
});
