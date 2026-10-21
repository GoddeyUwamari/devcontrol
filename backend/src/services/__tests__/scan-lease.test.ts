/**
 * Live-Postgres coverage for services/scan-lease.ts (multi-region plan M4a):
 * the lease primitives for aws_scan_leases and job_leases, the commit fence
 * (with the scan lease's account check) and the heartbeat.
 *
 * Every test runs against its own schema holding the real foundation
 * migration (database/migrations-admin/202610191200_create_multi_region_scan_foundation.sql,
 * read from disk) on a minimal fixture. The fixture is COMMITTED so separate
 * connections and pools (standing in for separate processes and hosts) see
 * it, and the schema is dropped in finally. Every lease statement runs as
 * devcontrol, the application's role, under row-level security; each
 * connection asserts it is neither a superuser nor BYPASSRLS.
 *
 * Plan test ids (m4-plan.md §7, §13): L1 primitives, L2 two-connection fence on
 * job_leases (and on aws_scan_leases through the module), L8 heartbeat, L8b
 * the age limit never hits a healthy scan, H1 two "hosts", H2 database clock
 * only, I2 the fence's account check.
 */
import { Client, Pool, PoolClient } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { AwsAccountAmbiguousError } from '../../repositories/aws-accounts.repository';
import {
  HeldLease,
  LEASE_AGE_WARNING,
  LEASE_AGE_WARNING_FRACTION,
  LEASE_HEARTBEAT_INTERVAL_MS,
  LEASE_TTL_SECONDS,
  LeaseHeartbeat,
  LeaseLostError,
  MAX_CONSECUTIVE_RENEW_ERRORS,
  MAX_LEASE_AGE_SECONDS,
  RENEW_LOCK_TIMEOUT_MS,
  acquireJobLease,
  acquireScanLease,
  completeJobLease,
  fence,
  fenceLease,
  fenceScanLease,
  isLeaseLost,
  leaseHolder,
  releaseLease,
  renewLease,
  withFencedTransaction,
} from '../scan-lease';

const MIGRATION_FILE = '202610191200_create_multi_region_scan_foundation.sql';
const MIGRATION_SQL = fs.readFileSync(path.join(__dirname, '../../../../database/migrations-admin', MIGRATION_FILE), 'utf8');
const MODULE_SOURCE = fs.readFileSync(path.join(__dirname, '../scan-lease.ts'), 'utf8');

const SCHEMA_PREFIX = 'scan_lease_test_';

/** Documented placeholder account ids (aws-account-id-literals.test.ts). */
const ACCOUNT_A = '111122223333';
const ACCOUNT_B = '123456789012';
const roleArn = (account: string) => `arn:aws:iam::${account}:role/devcontrol-test`;

function dbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };
}

let schemaCounter = 0;

/**
 * Every statement on an application connection in this file is cut off by the
 * server after this long, so a regression that blocks on a lock fails the test
 * instead of leaving a connection waiting and Jest unable to exit.
 */
const TEST_STATEMENT_TIMEOUT_MS = 15_000;
const APP_CONNECTION_OPTIONS = `-c statement_timeout=${TEST_STATEMENT_TIMEOUT_MS}`;

interface Env {
  schema: string;
  admin: Client;
  /** A new organization with one aws_accounts row for `account` (none when null). */
  organization: (account?: string | null) => Promise<string>;
  /** A dedicated devcontrol connection tagged for `organization` for its whole session. */
  connection: (organization: string) => Promise<Client>;
  /** A devcontrol pool (a "host"); its connections are untagged until the module tags them. */
  pool: () => TestPool;
}

/** The current role of a connection, as every devcontrol connection here must report it. */
const DEVCONTROL_ROLE = { role: 'devcontrol', rolsuper: false, rolbypassrls: false };
const ROLE_SQL = 'SELECT current_user AS role, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user';

/**
 * A pool whose every checkout is devcontrol in the test schema: the role is
 * set, awaited and checked before the connection is handed out (an error
 * fails the checkout; nothing is swallowed). `roles` records each checkout's
 * role for assertions.
 */
interface TestPool {
  connect(): Promise<PoolClient>;
  roles: Array<Record<string, unknown>>;
  raw: Pool;
}

/**
 * The tables the migration needs (organizations, resource_discovery_jobs),
 * the migration itself, and aws_accounts with the columns the account rule
 * reads (findEligibleAwsAccount; the shape of routes/__tests__/shared-fixture-tables.ts).
 * aws_accounts deliberately has no UNIQUE (org_id) here, so a second account
 * row can be written to prove the fence's rule for it.
 */
async function withSchema(fn: (env: Env) => Promise<void>): Promise<void> {
  const admin = new Client(dbConfig());
  await admin.connect();
  const schema = `${SCHEMA_PREFIX}${process.pid}_${Date.now()}_${schemaCounter++}`;
  const clients: Client[] = [];
  const pools: Pool[] = [];
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
    await admin.query('COMMIT');

    const env: Env = {
      schema,
      admin,
      organization: async (account = ACCOUNT_A) => {
        const org = (await admin.query(`INSERT INTO ${schema}.organizations (name) VALUES ('Lease Org') RETURNING id`)).rows[0].id;
        if (account) {
          await admin.query(`INSERT INTO ${schema}.aws_accounts (org_id, role_arn, status) VALUES ($1, $2, 'active')`, [org, roleArn(account)]);
        }
        return org;
      },
      connection: async (organization) => {
        const client = new Client({ ...dbConfig(), options: APP_CONNECTION_OPTIONS });
        // A session the server ends (idle_in_transaction_session_timeout) reports it here;
        // the test asserts on the failed query instead.
        client.on('error', () => undefined);
        await client.connect();
        clients.push(client);
        await client.query(`SET search_path TO ${schema}`);
        await client.query('SET ROLE devcontrol');
        await client.query("SELECT set_config('app.current_organization_id', $1, false)", [organization]);
        expect((await client.query(ROLE_SQL)).rows).toEqual([DEVCONTROL_ROLE]);
        return client;
      },
      pool: () => {
        const raw = new Pool({ ...dbConfig(), options: APP_CONNECTION_OPTIONS, max: 4 });
        pools.push(raw);
        const testPool: TestPool = {
          raw,
          roles: [],
          connect: async () => {
            const client = await raw.connect();
            try {
              await client.query(`SET search_path TO ${schema}`);
              await client.query('SET ROLE devcontrol');
              testPool.roles.push((await client.query(ROLE_SQL)).rows[0]);
              return client;
            } catch (error) {
              client.release(error as Error);
              throw error;
            }
          },
        };
        return testPool;
      },
    };
    await fn(env);
  } finally {
    await Promise.all(clients.map((client) => client.end().catch(() => undefined)));
    await Promise.all(pools.map((pool) => pool.end().catch(() => undefined)));
    await admin.query('ROLLBACK').catch(() => undefined);
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
}

/** Polls `condition` until it holds; fails after `timeoutMs`. */
async function waitFor(condition: () => Promise<boolean>, what: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** Waits until `lease` has really expired by the database clock (never by editing the row). */
async function untilExpired(env: Env, lease: HeldLease): Promise<void> {
  await waitFor(
    async () =>
      (
        await env.admin.query(`SELECT expires_at <= clock_timestamp() AS expired FROM ${env.schema}.${lease.key.table} WHERE fencing_token = $1`, [
          lease.fencingToken,
        ])
      ).rows[0]?.expired === true,
    'the lease to expire'
  );
}

/** A lease row as the tests read it back (both tables; job-only columns are undefined for a scan lease). */
interface LeaseRow {
  holder: string;
  heartbeat_at: Date;
  expires_at: Date;
  released_at: Date | null;
  last_completed_at?: Date | null;
}

async function leaseRow(env: Env, lease: HeldLease): Promise<LeaseRow> {
  return (await env.admin.query(`SELECT * FROM ${env.schema}.${lease.key.table} WHERE organization_id = $1`, [lease.key.organizationId])).rows[0];
}

/** A write the tests can count: one aws_account_regions row per call. */
async function markerWrite(client: Client, org: string, region: string): Promise<void> {
  await client.query(
    `INSERT INTO aws_account_regions (organization_id, aws_account_id, region, enabled) VALUES ($1, $2, $3, true)`,
    [org, ACCOUNT_A, region]
  );
}

async function markerCount(env: Env, org: string): Promise<number> {
  return (await env.admin.query(`SELECT count(*)::int AS n FROM ${env.schema}.aws_account_regions WHERE organization_id = $1`, [org])).rows[0].n;
}

const scanKey = (organizationId: string, awsAccountId = ACCOUNT_A) => ({ organizationId, awsAccountId, scanKind: 'discovery' });
const jobKey = (organizationId: string) => ({ organizationId, jobName: 'resource_discovery' });

/** `promise`, or a rejection naming `what` once `ms` have passed: a per-test deadline that cannot hang. */
async function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`deadline of ${ms} ms passed: ${what}`)), ms);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** A promise and the function that settles it, to hold a transaction open. */
function gate(): { opened: Promise<void>; open: () => void } {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
}

describe('scan-lease: constants', () => {
  it('pins the M3 contract timings and the provisional M4 age limit (changing them is the pre-M7 reassessment)', () => {
    expect(LEASE_TTL_SECONDS).toBe(300);
    expect(LEASE_HEARTBEAT_INTERVAL_MS).toBe(60_000);
    expect(MAX_LEASE_AGE_SECONDS).toBe(3600);
    expect(LEASE_AGE_WARNING_FRACTION).toBe(0.5);
    expect(RENEW_LOCK_TIMEOUT_MS).toBe(10_000);
    expect(MAX_CONSECUTIVE_RENEW_ERRORS).toBe(2);
  });

  it('H2: decides nothing by this process\'s clock: no Date in the module, every comparison is now()/clock_timestamp()', () => {
    expect(MODULE_SOURCE).not.toMatch(/\bnew Date\b|\bDate\.now\b/);
    expect(MODULE_SOURCE).toMatch(/expires_at > clock_timestamp\(\)\s+FOR SHARE/);
  });

  it('holder is <host>:<pid>:<run id>, at most 255 characters, unique per call', () => {
    const a = leaseHolder();
    expect(a).toMatch(new RegExp(`^.+:${process.pid}:[0-9a-f-]{36}$`));
    expect(a.length).toBeLessThanOrEqual(255);
    expect(leaseHolder()).not.toBe(a);
  });
});

describe('scan-lease: L1 primitives, as devcontrol', () => {
  it('scan lease: acquire, held refuses a second, renew, release, then a greater token; acquiredAt is the database time', async () => {
    await withSchema(async (env) => {
      const org = await env.organization();
      const db = await env.connection(org);
      const first = await acquireScanLease(db, scanKey(org), 'host:1:run');
      expect(first).not.toBeNull();
      const dbNow = (await db.query('SELECT now() AS t')).rows[0].t as Date;
      expect(Math.abs(first!.acquiredAt.getTime() - dbNow.getTime())).toBeLessThan(5_000);
      expect(await acquireScanLease(db, scanKey(org), 'host:2:run')).toBeNull();
      // Another account, or another kind, is another key.
      expect(await acquireScanLease(db, scanKey(org, ACCOUNT_B), 'host:2:run')).not.toBeNull();
      expect(await acquireScanLease(db, { ...scanKey(org), scanKind: 'other_kind' }, 'host:2:run')).not.toBeNull();

      const before = await leaseRow(env, first!);
      expect(await renewLease(db, first!)).toBe(true);
      expect((await leaseRow(env, first!)).expires_at.getTime()).toBeGreaterThanOrEqual(before.expires_at.getTime());
      expect(await releaseLease(db, first!)).toBe(true);
      expect(await releaseLease(db, first!)).toBe(false);
      expect(await renewLease(db, first!)).toBe(false);

      const second = await acquireScanLease(db, scanKey(org), 'host:2:run');
      expect(BigInt(second!.fencingToken) > BigInt(first!.fencingToken)).toBe(true);
    });
  });

  it('scan lease: after real expiry a takeover gets a greater token; the stale token cannot renew, release or pass the fence', async () => {
    await withSchema(async (env) => {
      const org = await env.organization();
      const db = await env.connection(org);
      const stale = (await acquireScanLease(db, scanKey(org), 'host:1:run', { ttlSeconds: 1 }))!;
      await untilExpired(env, stale);
      expect(await renewLease(db, stale)).toBe(false);
      const current = (await acquireScanLease(db, scanKey(org), 'host:2:run'))!;
      expect(BigInt(current.fencingToken) > BigInt(stale.fencingToken)).toBe(true);
      expect(await renewLease(db, stale)).toBe(false);
      expect(await releaseLease(db, stale)).toBe(false);
      await expect(withFencedTransaction(db, stale, async () => markerWrite(db, org, 'eu-west-1'))).rejects.toBeInstanceOf(LeaseLostError);
      expect(await markerCount(env, org)).toBe(0);
      await withFencedTransaction(db, current, async () => markerWrite(db, org, 'eu-west-1'));
      expect(await markerCount(env, org)).toBe(1);
      expect((await leaseRow(env, current)).holder).toBe('host:2:run');
    });
  });

  it('job lease: acquire, held refuses, renew and release (M3 left these to M4), completion only by the current token', async () => {
    await withSchema(async (env) => {
      const org = await env.organization(null);
      const db = await env.connection(org);
      const first = (await acquireJobLease(db, jobKey(org), 'host:1:run'))!;
      expect(await acquireJobLease(db, jobKey(org), 'host:2:run')).toBeNull();
      expect(await renewLease(db, first)).toBe(true);
      expect(await releaseLease(db, first)).toBe(true);
      expect(await renewLease(db, first)).toBe(false);
      expect(await completeJobLease(db, first)).toBe(false);
      expect((await leaseRow(env, first)).last_completed_at).toBeNull();

      const stale = (await acquireJobLease(db, jobKey(org), 'host:2:run', { ttlSeconds: 1 }))!;
      expect(BigInt(stale.fencingToken) > BigInt(first.fencingToken)).toBe(true);
      await untilExpired(env, stale);
      expect(await renewLease(db, stale)).toBe(false);
      expect(await completeJobLease(db, stale)).toBe(false);
      const current = (await acquireJobLease(db, jobKey(org), 'host:3:run'))!;
      expect(BigInt(current.fencingToken) > BigInt(stale.fencingToken)).toBe(true);
      expect(await releaseLease(db, stale)).toBe(false);
      expect(await completeJobLease(db, stale)).toBe(false);
      expect(await completeJobLease(db, current)).toBe(true);
      const row = await leaseRow(env, current);
      expect(row.last_completed_at).toBeInstanceOf(Date);
      expect(row.released_at).toBeInstanceOf(Date);
    });
  });

  it('job lease: minSecondsSinceCompletion refuses a run completed too recently, and allows one after that', async () => {
    await withSchema(async (env) => {
      const org = await env.organization(null);
      const db = await env.connection(org);
      const run = (await acquireJobLease(db, jobKey(org), 'host:1:run'))!;
      expect(await completeJobLease(db, run)).toBe(true);
      expect(await acquireJobLease(db, jobKey(org), 'host:2:run', { minSecondsSinceCompletion: 5 * 3600 })).toBeNull();
      expect((await leaseRow(env, run)).holder).toBe('host:1:run');
      await waitFor(
        async () =>
          (await env.admin.query(`SELECT last_completed_at <= now() - interval '1 second' AS old FROM ${env.schema}.job_leases`)).rows[0].old,
        'one second since completion'
      );
      expect(await acquireJobLease(db, jobKey(org), 'host:2:run', { minSecondsSinceCompletion: 1 })).not.toBeNull();
      // Without the option, completion time is not a condition.
      const org2 = await env.organization(null);
      const db2 = await env.connection(org2);
      expect(await completeJobLease(db2, (await acquireJobLease(db2, jobKey(org2), 'h'))!)).toBe(true);
      expect(await acquireJobLease(db2, jobKey(org2), 'h')).not.toBeNull();
    });
  });

  it('completeJobLease and fenceScanLease refuse the other table\'s lease', async () => {
    await withSchema(async (env) => {
      const org = await env.organization();
      const db = await env.connection(org);
      const scan = (await acquireScanLease(db, scanKey(org), 'h'))!;
      const job = (await acquireJobLease(db, jobKey(org), 'h'))!;
      await expect(completeJobLease(db, scan)).rejects.toThrow(/not a job lease/);
      await db.query('BEGIN');
      await expect(fenceScanLease(db, job)).rejects.toThrow(/not a scan lease/);
      await db.query('ROLLBACK');
    });
  });

  it('withFencedTransaction rolls back everything when its body fails, and passes through its result', async () => {
    await withSchema(async (env) => {
      const org = await env.organization();
      const db = await env.connection(org);
      const lease = (await acquireScanLease(db, scanKey(org), 'h'))!;
      await expect(
        withFencedTransaction(db, lease, async () => {
          await markerWrite(db, org, 'eu-west-1');
          throw new Error('body failed');
        })
      ).rejects.toThrow('body failed');
      expect(await markerCount(env, org)).toBe(0);
      expect(await withFencedTransaction(db, lease, async () => 'done')).toBe('done');
      // The connection is usable afterwards (no transaction left open).
      expect((await db.query('SELECT 1 AS one')).rows).toEqual([{ one: 1 }]);
    });
  });

  it('tenant isolation: a connection tagged for another organization cannot acquire, renew, release or fence this one\'s lease', async () => {
    await withSchema(async (env) => {
      const orgA = await env.organization();
      const orgB = await env.organization(ACCOUNT_B);
      const dbA = await env.connection(orgA);
      const dbB = await env.connection(orgB);
      const lease = (await acquireScanLease(dbA, scanKey(orgA), 'h'))!;
      // RLS: B cannot even see A's row, so a takeover attempt is an insert that WITH CHECK refuses.
      await expect(acquireScanLease(dbB, scanKey(orgA), 'h')).rejects.toMatchObject({ code: '42501' });
      expect(await renewLease(dbB, lease)).toBe(false);
      expect(await releaseLease(dbB, lease)).toBe(false);
      await expect(withFencedTransaction(dbB, lease, async () => undefined)).rejects.toBeInstanceOf(LeaseLostError);
      expect((await leaseRow(env, lease)).released_at).toBeNull();
    });
  });
});

describe('scan-lease: I2 the scan fence checks the account', () => {
  it('passes with exactly one aws_accounts row naming the lease\'s account', async () => {
    await withSchema(async (env) => {
      const org = await env.organization(ACCOUNT_A);
      const db = await env.connection(org);
      const lease = (await acquireScanLease(db, scanKey(org), 'h'))!;
      await withFencedTransaction(db, lease, async () => markerWrite(db, org, 'eu-west-1'));
      expect(await markerCount(env, org)).toBe(1);
    });
  });

  it('a second account row that is not eligible (inactive) does not count: the fence passes', async () => {
    await withSchema(async (env) => {
      const org = await env.organization(ACCOUNT_A);
      await env.admin.query(`INSERT INTO ${env.schema}.aws_accounts (org_id, role_arn, status) VALUES ($1, $2, 'inactive')`, [org, roleArn(ACCOUNT_B)]);
      const db = await env.connection(org);
      const lease = (await acquireScanLease(db, scanKey(org), 'h'))!;
      await withFencedTransaction(db, lease, async () => markerWrite(db, org, 'eu-west-1'));
      expect(await markerCount(env, org)).toBe(1);
    });
  });

  it.each([
    ['a second ACTIVE account row appears', 'second_active', AwsAccountAmbiguousError],
    ['the single row turns non-active', 'deactivated', LeaseLostError],
    ['the row names another account', 'other', LeaseLostError],
    ['the row is gone', 'none', LeaseLostError],
  ] as const)('%s: the fence refuses and nothing is written', async (_label, change, errorType) => {
    await withSchema(async (env) => {
      const org = await env.organization(ACCOUNT_A);
      const db = await env.connection(org);
      const lease = (await acquireScanLease(db, scanKey(org), 'h'))!;
      if (change === 'second_active') {
        await env.admin.query(`INSERT INTO ${env.schema}.aws_accounts (org_id, role_arn, status) VALUES ($1, $2, 'active')`, [org, roleArn(ACCOUNT_B)]);
      } else if (change === 'deactivated') {
        await env.admin.query(`UPDATE ${env.schema}.aws_accounts SET status = 'inactive' WHERE org_id = $1`, [org]);
      } else if (change === 'other') {
        await env.admin.query(`UPDATE ${env.schema}.aws_accounts SET role_arn = $2 WHERE org_id = $1`, [org, roleArn(ACCOUNT_B)]);
      } else {
        await env.admin.query(`DELETE FROM ${env.schema}.aws_accounts WHERE org_id = $1`, [org]);
      }
      const error = await withFencedTransaction(db, lease, async () => markerWrite(db, org, 'eu-west-1')).catch((err) => err);
      expect(error).toBeInstanceOf(errorType);
      if (error instanceof LeaseLostError) expect(error.reason).toBe('account_changed');
      if (error instanceof AwsAccountAmbiguousError) expect(error.code).toBe('AWS_ACCOUNT_AMBIGUOUS');
      expect(await markerCount(env, org)).toBe(0);
      // The lease itself is untouched: only this transaction was refused.
      expect((await leaseRow(env, lease)).released_at).toBeNull();
    });
  });

  it('another organization\'s account rows do not count', async () => {
    await withSchema(async (env) => {
      const org = await env.organization(ACCOUNT_A);
      await env.organization(ACCOUNT_B);
      const db = await env.connection(org);
      const lease = (await acquireScanLease(db, scanKey(org), 'h'))!;
      await withFencedTransaction(db, lease, async () => markerWrite(db, org, 'eu-west-1'));
      expect(await markerCount(env, org)).toBe(1);
    });
  });

  it('a job lease fence does not read aws_accounts (organization-level work)', async () => {
    await withSchema(async (env) => {
      const org = await env.organization(null);
      const db = await env.connection(org);
      const lease = (await acquireJobLease(db, jobKey(org), 'h'))!;
      await withFencedTransaction(db, lease, async () => undefined);
      await db.query('BEGIN');
      await fence(db, lease);
      await fenceLease(db, lease);
      await db.query('ROLLBACK');
    });
  });
});

describe('scan-lease: the fence reads the current database time, not the transaction start', () => {
  it('a lease that expires while a transaction is open fails the fence later in that same transaction', async () => {
    await withSchema(async (env) => {
      const org = await env.organization();
      const db = await env.connection(org);
      const lease = (await acquireScanLease(db, scanKey(org), 'h', { ttlSeconds: 2 }))!;
      await db.query('BEGIN');
      try {
        // Valid at the start of the transaction.
        await fence(db, lease);

        // The lease expires while the transaction stays open: by clock_timestamp() it is
        // past expires_at, while now() (fixed at the transaction's start) is still before it.
        await untilExpired(env, lease);
        const { rows } = await db.query(
          `SELECT now() < expires_at AS by_now_still_held, clock_timestamp() >= expires_at AS by_clock_expired
             FROM aws_scan_leases WHERE organization_id = $1`,
          [org]
        );
        expect(rows).toEqual([{ by_now_still_held: true, by_clock_expired: true }]);

        // The same fence, again in the same transaction, now finds no row.
        const error = await fenceLease(db, lease).catch((err) => err);
        expect(error).toBeInstanceOf(LeaseLostError);
        expect(error.reason).toBe('lease_lost');
      } finally {
        await db.query('ROLLBACK');
      }
    });
  });
});

describe('scan-lease: F2 bounded fenced transactions and acquisitions', () => {
  it('a callback that idles past the idle-in-transaction limit is aborted by the server and its writes are rolled back', async () => {
    await withSchema(async (env) => {
      const org = await env.organization();
      const db = await env.connection(org);
      const lease = (await acquireScanLease(db, scanKey(org), 'h'))!;
      const error = await withFencedTransaction(
        db,
        lease,
        async () => {
          await markerWrite(db, org, 'eu-west-1');
          // Breaks the contract: an await that is not a statement on db.
          await new Promise((resolve) => setTimeout(resolve, 1_500));
          await markerWrite(db, org, 'eu-central-1');
        },
        { idleInTransactionTimeoutMs: 300 }
      ).catch((err) => err);
      expect(error).toBeInstanceOf(Error);
      expect(isLeaseLost(error)).toBe(false);
      expect(await markerCount(env, org)).toBe(0);
    });
  }, 20_000);

  it('the fenced transaction sets both server limits (per statement and idle), local to that transaction', async () => {
    await withSchema(async (env) => {
      const org = await env.organization();
      const db = await env.connection(org);
      const lease = (await acquireScanLease(db, scanKey(org), 'h'))!;
      const inside = await withFencedTransaction(db, lease, async () =>
        (await db.query("SELECT current_setting('statement_timeout') AS st, current_setting('idle_in_transaction_session_timeout') AS idle")).rows[0]
      );
      expect(inside).toEqual({ st: '1min', idle: '10s' });
      const after = (await db.query("SELECT current_setting('statement_timeout') AS st, current_setting('idle_in_transaction_session_timeout') AS idle")).rows[0];
      expect(after).toEqual({ st: '15s', idle: '0' });
    });
  });

  it('with lockTimeoutMs, an acquisition blocked by the holder\'s fenced transaction returns null quickly instead of waiting', async () => {
    await withSchema(async (env) => {
      const org = await env.organization();
      const a = await env.connection(org);
      const b = await env.connection(org);
      const lease = (await acquireScanLease(a, scanKey(org), 'host:a', { ttlSeconds: 1 }))!;
      const hold = gate();
      const entered = gate();
      const transaction = withFencedTransaction(a, lease, async () => {
        entered.open();
        await hold.opened;
      }, { idleInTransactionTimeoutMs: 20_000 });
      await entered.opened;
      try {
        await untilExpired(env, lease);
        const started = Date.now();
        expect(await within(acquireScanLease(b, scanKey(org), 'host:b', { lockTimeoutMs: 200 }), 5_000, 'the acquisition to give up')).toBeNull();
        expect(Date.now() - started).toBeLessThan(5_000);
        // b's connection is not left inside a transaction.
        expect((await b.query("SELECT now() = statement_timestamp() AS fresh")).rows[0].fresh).toBe(true);
      } finally {
        hold.open();
        await transaction;
      }
      // Once the holder's transaction ended, the expired lease can be taken over.
      expect(await acquireScanLease(b, scanKey(org), 'host:b', { lockTimeoutMs: 200 })).not.toBeNull();
    });
  });
});

describe('scan-lease: F6 renew and complete read the current database time', () => {
  it.each(['aws_scan_leases', 'job_leases'] as const)(
    '%s: a lease that expires inside an open transaction cannot be renewed (or completed) later in that transaction',
    async (table) => {
      await withSchema(async (env) => {
        const org = await env.organization();
        const db = await env.connection(org);
        const lease =
          table === 'job_leases'
            ? (await acquireJobLease(db, jobKey(org), 'h', { ttlSeconds: 2 }))!
            : (await acquireScanLease(db, scanKey(org), 'h', { ttlSeconds: 2 }))!;
        await db.query('BEGIN');
        try {
          // now() is fixed here, before the lease expires.
          await db.query('SELECT 1');
          await waitFor(
            async () => (await db.query(`SELECT clock_timestamp() >= expires_at AS expired FROM ${table} WHERE organization_id = $1`, [org])).rows[0].expired,
            'the lease to expire inside the open transaction'
          );
          const { rows } = await db.query(
            `SELECT now() < expires_at AS by_now_still_held, clock_timestamp() >= expires_at AS by_clock_expired
               FROM ${table} WHERE organization_id = $1`,
            [org]
          );
          expect(rows).toEqual([{ by_now_still_held: true, by_clock_expired: true }]);
          expect(await renewLease(db, lease)).toBe(false);
          if (table === 'job_leases') expect(await completeJobLease(db, lease)).toBe(false);
        } finally {
          await db.query('ROLLBACK');
        }
        const row = await leaseRow(env, lease);
        expect(row.last_completed_at ?? null).toBeNull();
      });
    }
  );
});

describe('scan-lease: L2 commit fence across two connections', () => {
  it.each([
    ['job_leases', 'COMMIT'],
    ['job_leases', 'ROLLBACK'],
    ['aws_scan_leases', 'COMMIT'],
    ['aws_scan_leases', 'ROLLBACK'],
  ] as const)(
    '%s: A is fenced and writing; after real expiry B\'s takeover waits on Lock until A ends (%s), gets a greater token, and A\'s next fence fails',
    async (table, end) => {
      await withSchema(async (env) => {
        const org = await env.organization();
        const a = await env.connection(org);
        const b = await env.connection(org);
        const acquire = (db: Client, holder: string, ttlSeconds?: number) =>
          table === 'job_leases'
            ? acquireJobLease(db, jobKey(org), holder, { ttlSeconds })
            : acquireScanLease(db, scanKey(org), holder, { ttlSeconds });
        const t1 = (await acquire(a, 'host:a:run', 2))!;

        const hold = gate();
        const entered = gate();
        const aTransaction = withFencedTransaction(a, t1, async () => {
          await markerWrite(a, org, 'eu-west-1');
          entered.open();
          await hold.opened;
          if (end === 'ROLLBACK') throw new Error('A rolls back');
        }).catch((err) => err);
        await entered.opened;

        await untilExpired(env, t1);
        const bPid = (await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        let bFinished = false;
        const takeover = acquire(b, 'host:b:run').then((lease) => {
          bFinished = true;
          return lease;
        });
        await waitFor(
          async () => (await env.admin.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1', [bPid])).rows[0]?.wait_event_type === 'Lock',
          'B to wait on a lock'
        );
        expect(bFinished).toBe(false);

        hold.open();
        const aResult = await aTransaction;
        if (end === 'ROLLBACK') expect(aResult).toEqual(new Error('A rolls back'));
        else expect(aResult).toBeUndefined();

        const t2 = (await takeover)!;
        expect(t2).not.toBeNull();
        expect(BigInt(t2.fencingToken) > BigInt(t1.fencingToken)).toBe(true);
        expect(await markerCount(env, org)).toBe(end === 'COMMIT' ? 1 : 0);

        const stale = await withFencedTransaction(a, t1, async () => markerWrite(a, org, 'eu-central-1')).catch((err) => err);
        expect(isLeaseLost(stale)).toBe(true);
        expect(await markerCount(env, org)).toBe(end === 'COMMIT' ? 1 : 0);
      });
    },
    30_000
  );
});

describe('scan-lease: H1 two "hosts" (independent pools and module instances)', () => {
  it('concurrent acquisitions of one key from two pools: exactly one token; then the fence and takeover behave as on one host', async () => {
    await withSchema(async (env) => {
      const org = await env.organization();
      let hostA!: typeof import('../scan-lease');
      let hostB!: typeof import('../scan-lease');
      // isolateModules loads a module synchronously, so these two loads use require().
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        hostA = require('../scan-lease');
      });
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        hostB = require('../scan-lease');
      });
      expect(hostA).not.toBe(hostB);
      const poolA = env.pool();
      const poolB = env.pool();

      const attempt = async (host: typeof hostA, pool: TestPool, holder: string) => {
        const client = await pool.connect();
        try {
          expect((await client.query(ROLE_SQL)).rows).toEqual([DEVCONTROL_ROLE]);
          await client.query("SELECT set_config('app.current_organization_id', $1, false)", [org]);
          return await host.acquireScanLease(client, scanKey(org), holder, { ttlSeconds: 2 });
        } finally {
          await client.query("SELECT set_config('app.current_organization_id', '', false)");
          client.release();
        }
      };
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) => (i % 2 === 0 ? attempt(hostA, poolA, `host-a:${i}`) : attempt(hostB, poolB, `host-b:${i}`)))
      );
      const winners = results.filter((lease) => lease !== null);
      expect(winners).toHaveLength(1);
      const first = winners[0]!;

      await untilExpired(env, first);
      const second = (await attempt(hostB, poolB, 'host-b:takeover'))!;
      expect(BigInt(second.fencingToken) > BigInt(first.fencingToken)).toBe(true);

      const clientA = await poolA.connect();
      try {
        await clientA.query("SELECT set_config('app.current_organization_id', $1, false)", [org]);
        await expect(hostA.withFencedTransaction(clientA, first, async () => undefined)).rejects.toMatchObject({ code: 'SCAN_LEASE_LOST' });
      } finally {
        clientA.release();
      }
    });
  });
});

describe('scan-lease: L8 heartbeat', () => {
  afterEach(() => jest.restoreAllMocks());

  it('renews on its own connections every interval, and stopAndRelease releases', async () => {
    await withSchema(async (env) => {
      const org = await env.organization();
      const db = await env.connection(org);
      const lease = (await acquireScanLease(db, scanKey(org), 'h', { ttlSeconds: 2 }))!;
      const pool = env.pool();
      const heartbeat = new LeaseHeartbeat(pool, lease, { intervalMs: 200, ttlSeconds: 2 }).start();
      // Without renewal it would expire after 2 s; it is still held well after that.
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      expect(heartbeat.lost).toBe(false);
      expect((await env.admin.query(`SELECT expires_at > clock_timestamp() AS held FROM ${env.schema}.aws_scan_leases`)).rows[0].held).toBe(true);
      heartbeat.checkpoint();
      expect(await heartbeat.stopAndRelease()).toBe(true);
      expect((await leaseRow(env, lease)).released_at).toBeInstanceOf(Date);
      // Every connection the heartbeat used was the application role, never a superuser or BYPASSRLS.
      expect(pool.roles.length).toBeGreaterThan(1);
      for (const role of pool.roles) expect(role).toEqual(DEVCONTROL_ROLE);
    });
  }, 20_000);

  it('a refused renewal (taken over after expiry) marks the lease lost; checkpoint() throws; renewing stops', async () => {
    await withSchema(async (env) => {
      const org = await env.organization();
      const db = await env.connection(org);
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const lease = (await acquireScanLease(db, scanKey(org), 'h:a', { ttlSeconds: 1 }))!;
      const heartbeat = new LeaseHeartbeat(env.pool(), lease, { ttlSeconds: 1 });
      await untilExpired(env, lease);
      const takeover = (await acquireScanLease(db, scanKey(org), 'h:b'))!;
      await heartbeat.beat();
      expect(heartbeat.lost).toBe(true);
      expect(heartbeat.reason).toBe('lease_lost');
      expect(() => heartbeat.checkpoint()).toThrow(LeaseLostError);
      const after = await leaseRow(env, takeover);
      await heartbeat.beat();
      expect((await leaseRow(env, takeover)).heartbeat_at).toEqual(after.heartbeat_at);
      expect(await heartbeat.stopAndRelease()).toBe(false);
      expect((await leaseRow(env, takeover)).released_at).toBeNull();
    });
  });

  it('a renewal blocked behind the holder\'s own fenced transaction times out instead of hanging; two in a row mark it lost', async () => {
    await withSchema(async (env) => {
      const org = await env.organization();
      const db = await env.connection(org);
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const lease = (await acquireScanLease(db, scanKey(org), 'h'))!;
      const heartbeat = new LeaseHeartbeat(env.pool(), lease, { renewLockTimeoutMs: 200 });
      const hold = gate();
      const entered = gate();
      const transaction = withFencedTransaction(db, lease, async () => {
        entered.open();
        await hold.opened;
      });
      await entered.opened;
      // Each renewal must give up on the row lock by itself (renewLockTimeoutMs). The
      // deadline fails the test fast if it does not; finally always ends A's
      // transaction, which unblocks any renewal still waiting, so nothing is left hanging.
      const beats: Promise<void>[] = [];
      try {
        beats.push(heartbeat.beat());
        await within(beats[0], 5_000, 'the first renewal to give up on the lock');
        expect(heartbeat.lost).toBe(false);
        beats.push(heartbeat.beat());
        await within(beats[1], 5_000, 'the second renewal to give up on the lock');
        expect(heartbeat.lost).toBe(true);
        expect(heartbeat.reason).toBe('lease_lost');
      } finally {
        hold.open();
        await transaction;
        await Promise.allSettled(beats);
      }
    });
  });

  it('an error then a success does not count as lost', async () => {
    await withSchema(async (env) => {
      const org = await env.organization();
      const db = await env.connection(org);
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const lease = (await acquireScanLease(db, scanKey(org), 'h'))!;
      const pool = env.pool();
      let failNext = true;
      const flaky = {
        connect: async () => {
          if (failNext) {
            failNext = false;
            throw new Error('connection refused');
          }
          return pool.connect();
        },
      };
      const heartbeat = new LeaseHeartbeat(flaky, lease);
      await heartbeat.beat();
      expect(heartbeat.lost).toBe(false);
      await heartbeat.beat();
      expect(heartbeat.lost).toBe(false);
      failNext = true;
      await heartbeat.beat();
      expect(heartbeat.lost).toBe(false);
    });
  });

  it('F3: a renewal that cannot complete is cut off by its statement timeout and settles as an error; stop() returns', async () => {
    await withSchema(async (env) => {
      const org = await env.organization();
      const db = await env.connection(org);
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const lease = (await acquireScanLease(db, scanKey(org), 'h'))!;
      // The lock wait alone would last 60 s; the statement limit ends it.
      const heartbeat = new LeaseHeartbeat(env.pool(), lease, { renewLockTimeoutMs: 60_000, renewStatementTimeoutMs: 300 });
      const hold = gate();
      const entered = gate();
      const transaction = withFencedTransaction(db, lease, async () => {
        entered.open();
        await hold.opened;
      }, { idleInTransactionTimeoutMs: 20_000 });
      await entered.opened;
      const beat = heartbeat.beat();
      try {
        await within(beat, 5_000, 'the blocked renewal to settle');
        expect(heartbeat.lost).toBe(false);
        await within(heartbeat.stop(), 1_000, 'stop() to return');
      } finally {
        hold.open();
        await transaction;
        await Promise.allSettled([beat]);
      }
      expect(await within(heartbeat.stopAndRelease(), 5_000, 'stopAndRelease() to return')).toBe(true);
    });
  });

  it('F3: a pool that never hands out a connection: renewals settle as errors, the lease is lost after two, stop() and stopAndRelease() return', async () => {
    await withSchema(async (env) => {
      const org = await env.organization();
      const db = await env.connection(org);
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const lease = (await acquireScanLease(db, scanKey(org), 'h'))!;
      const stuck = { connect: () => new Promise<PoolClient>(() => undefined) };
      const heartbeat = new LeaseHeartbeat(stuck, lease, { connectTimeoutMs: 200 });
      await within(heartbeat.beat(), 5_000, 'the first renewal to settle');
      expect(heartbeat.lost).toBe(false);
      await within(heartbeat.beat(), 5_000, 'the second renewal to settle');
      expect(heartbeat.lost).toBe(true);
      await within(heartbeat.stop(), 1_000, 'stop() to return');
      expect(await within(heartbeat.stopAndRelease(), 5_000, 'stopAndRelease() to return')).toBe(false);
    });
  });

  it('F7: the heartbeat clears the tenant tag before its connection goes back to the pool', async () => {
    await withSchema(async (env) => {
      const org = await env.organization();
      const db = await env.connection(org);
      const lease = (await acquireScanLease(db, scanKey(org), 'h'))!;
      const pool = env.pool();
      await new LeaseHeartbeat(pool, lease).beat();
      // The same pool hands the connections back out: none still carries the organization.
      const clients = await Promise.all([pool.connect(), pool.connect(), pool.connect(), pool.connect()]);
      try {
        for (const client of clients) {
          expect((await client.query("SELECT current_setting('app.current_organization_id', true) AS tag")).rows[0].tag ?? '').toBe('');
        }
      } finally {
        for (const client of clients) client.release();
      }
      expect(pool.roles.every((role) => role.role === 'devcontrol')).toBe(true);
    });
  });

  it('N1: the renewal\'s lock timeout alone bounds a blocked renewal (statement timeout far longer): it settles fast, as an error', async () => {
    await withSchema(async (env) => {
      const org = await env.organization();
      const db = await env.connection(org);
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const lease = (await acquireScanLease(db, scanKey(org), 'h'))!;
      // Only the lock timeout can end this wait: the statement limit is 30 s.
      const heartbeat = new LeaseHeartbeat(env.pool(), lease, { renewLockTimeoutMs: 200, renewStatementTimeoutMs: 30_000 });
      const hold = gate();
      const entered = gate();
      const transaction = withFencedTransaction(db, lease, async () => {
        entered.open();
        await hold.opened;
      }, { idleInTransactionTimeoutMs: 20_000 });
      await entered.opened;
      const started = Date.now();
      const beat = heartbeat.beat();
      try {
        await within(beat, 3_000, 'the blocked renewal to give up on the lock');
        expect(Date.now() - started).toBeLessThan(3_000);
        expect(heartbeat.lost).toBe(false); // one error is not a loss
      } finally {
        hold.open();
        await transaction;
        await Promise.allSettled([beat]);
      }
      expect(await heartbeat.stopAndRelease()).toBe(true);
    });
  });

  it('N2: a connection that never answers (a dead TCP connection) is given up client-side; the renewal settles and the connection is discarded', async () => {
    await withSchema(async (env) => {
      const org = await env.organization();
      const db = await env.connection(org);
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const lease = (await acquireScanLease(db, scanKey(org), 'h'))!;
      const released: unknown[] = [];
      const dead = {
        connect: async () =>
          ({
            query: () => new Promise(() => undefined),
            release: (error?: unknown) => released.push(error),
          }) as unknown as PoolClient,
      };
      // The server-side limit cannot reach a connection that is gone; the client-side
      // guard (statement timeout + HEARTBEAT_CLIENT_TIMEOUT_MARGIN_MS) does.
      const heartbeat = new LeaseHeartbeat(dead, lease, { renewLockTimeoutMs: 100, renewStatementTimeoutMs: 200 });
      await within(heartbeat.beat(), 5_000, 'the first renewal on a dead connection to settle');
      expect(heartbeat.lost).toBe(false);
      await within(heartbeat.beat(), 5_000, 'the second renewal on a dead connection to settle');
      expect(heartbeat.lost).toBe(true);
      expect(released).toHaveLength(2);
      for (const error of released) expect(error).toBeInstanceOf(Error);
      expect(await within(heartbeat.stopAndRelease(), 5_000, 'stopAndRelease() to return')).toBe(false);
    });
  }, 20_000);

  it('F8: the age warning uses the database\'s acquired_at, so a heartbeat started late still warns at the first renewal', async () => {
    await withSchema(async (env) => {
      const org = await env.organization();
      const db = await env.connection(org);
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const lease = (await acquireScanLease(db, scanKey(org), 'h'))!;
      await waitFor(
        async () =>
          (await env.admin.query(`SELECT acquired_at <= clock_timestamp() - interval '1.2 seconds' AS old FROM ${env.schema}.aws_scan_leases`)).rows[0].old,
        'the lease to be 1.2 s old'
      );
      // Created now, 1.2 s after the acquisition: 60 % of a 2 s maximum by the database's age.
      const heartbeat = new LeaseHeartbeat(env.pool(), lease, { maxAgeSeconds: 2 });
      await heartbeat.beat();
      expect(heartbeat.lost).toBe(false);
      expect(warn.mock.calls.filter((call) => String(call[0]).includes(LEASE_AGE_WARNING))).toHaveLength(1);
    });
  });

  it('at the maximum age (database clock) renewal is refused and the reason is max_age', async () => {
    await withSchema(async (env) => {
      const org = await env.organization();
      const db = await env.connection(org);
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const lease = (await acquireScanLease(db, scanKey(org), 'h'))!;
      expect(await renewLease(db, lease, { maxAgeSeconds: 1 })).toBe(true);
      await waitFor(
        async () =>
          (await env.admin.query(`SELECT acquired_at <= now() - interval '1 second' AS aged FROM ${env.schema}.aws_scan_leases`)).rows[0].aged,
        'the lease to be one second old'
      );
      const heartbeat = new LeaseHeartbeat(env.pool(), lease, { maxAgeSeconds: 1 });
      await heartbeat.beat();
      expect(heartbeat.lost).toBe(true);
      expect(heartbeat.reason).toBe('max_age');
      expect(() => heartbeat.checkpoint()).toThrow(expect.objectContaining({ reason: 'max_age' }));
    });
  });
});

describe('scan-lease: L8b the age limit never hits a healthy scan below it', () => {
  afterEach(() => jest.restoreAllMocks());

  it('a heartbeating scan running for most of its maximum age keeps its lease; the age warning is logged exactly once', async () => {
    await withSchema(async (env) => {
      const org = await env.organization();
      const db = await env.connection(org);
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const lease = (await acquireScanLease(db, scanKey(org), 'h', { ttlSeconds: 1 }))!;
      const heartbeat = new LeaseHeartbeat(env.pool(), lease, { intervalMs: 150, ttlSeconds: 1, maxAgeSeconds: 4 }).start();
      // About 80 % of the maximum age, far past the TTL.
      await new Promise((resolve) => setTimeout(resolve, 3_200));
      expect(heartbeat.lost).toBe(false);
      heartbeat.checkpoint();
      await withFencedTransaction(db, lease, async () => markerWrite(db, org, 'eu-west-1'));
      expect(await markerCount(env, org)).toBe(1);
      await heartbeat.stop();
      const warnings = warn.mock.calls.filter((call) => String(call[0]).includes(LEASE_AGE_WARNING));
      expect(warnings).toHaveLength(1);
      expect(error).not.toHaveBeenCalled();
    });
  }, 20_000);
});
