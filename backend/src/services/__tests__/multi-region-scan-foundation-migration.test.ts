/**
 * Live-Postgres coverage for
 * database/migrations-admin/202610191200_create_multi_region_scan_foundation.sql
 * and its paired rollback. Executes the actual files (read from disk, not
 * reimplemented) against a fixture shaped like the production tables they
 * touch, in an isolated schema -- the technique of
 * resource-health-evaluations-migration.test.ts.
 *
 * Every test runs inside ONE transaction that is always rolled back: the
 * schema, the fixture, the migration, every grant and every row disappear
 * with it, so nothing outlives a test and no role is created.
 *
 * The connecting role (`postgres` in CI, a local superuser locally) is a
 * superuser, which row-level security never restricts. Every RLS assertion
 * therefore runs after `SET LOCAL ROLE devcontrol` -- the application's role,
 * created in CI before the schema bootstrap -- and first asserts that the
 * acting role is neither a superuser nor BYPASSRLS.
 *
 * The "CI bootstrap" block assumes a database bootstrapped by
 * .github/scripts/ci-bootstrap-schema.js.
 */
import { Client } from 'pg';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  MULTI_REGION_DISCOVERY_FLAG,
  getJobLease,
  getScanLease,
  isOrganizationFeatureEnabled,
  listAccountRegions,
} from '../../repositories/multi-region-foundation.repository';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { runMigrations, getMigrationFiles, MIGRATIONS_DIR } = require('../../../../database/migrate.js');

const MIGRATION_FILE = '202610191200_create_multi_region_scan_foundation.sql';
const ROLLBACK_FILE = '202610191200_create_multi_region_scan_foundation_rollback.sql';
const ADMIN_DIR = path.join(__dirname, '../../../../database/migrations-admin');
const MIGRATION_SQL = fs.readFileSync(path.join(ADMIN_DIR, MIGRATION_FILE), 'utf8');
const ROLLBACK_SQL = fs.readFileSync(path.join(ADMIN_DIR, ROLLBACK_FILE), 'utf8');

const SCHEMA_PREFIX = 'mr_found_mig_test_';
const MARKER = '[202610191200_create_multi_region_scan_foundation]';
const TABLES = ['aws_account_regions', 'aws_scan_leases', 'job_leases', 'organization_feature_flags'];

/** Documented placeholder account ids (aws-account-id-literals.test.ts). */
const ACCOUNT_A = '111122223333';
const ACCOUNT_B = '123456789012';

/** The policy expression, as PostgreSQL deparses it, for USING and WITH CHECK alike. */
const TENANT_EXPRESSION =
  "(organization_id = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid)";

function dbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };
}

/**
 * The production shapes this migration touches: organizations,
 * resource_discovery_jobs (008_create_aws_resources.sql, including its
 * row-level security) and database/migrate.js's two ledger tables, with a
 * baseline so the runner accepts the schema.
 */
async function createFixture(client: Client, { warningsColumn = null as string | null } = {}) {
  await client.query(`
    CREATE TABLE organizations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL
    )
  `);
  await client.query(`
    CREATE TABLE resource_discovery_jobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      status VARCHAR(50) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'completed', 'failed')),
      resources_discovered INTEGER DEFAULT 0,
      regions VARCHAR(255)[],
      error_message TEXT,
      started_at TIMESTAMP WITH TIME ZONE,
      completed_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      ${warningsColumn ? `, warnings ${warningsColumn}` : ''}
    )
  `);
  await client.query('ALTER TABLE resource_discovery_jobs ENABLE ROW LEVEL SECURITY');
  await client.query(`
    CREATE POLICY discovery_jobs_isolation_policy ON resource_discovery_jobs
      FOR ALL USING (organization_id::text = current_setting('app.current_organization_id', true))
  `);
  await client.query(`
    CREATE TABLE schema_migrations (
      id SERIAL PRIMARY KEY,
      migration_name VARCHAR(255) UNIQUE NOT NULL,
      checksum VARCHAR(64) NOT NULL,
      executed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE TABLE migration_tracking_baseline (
      id SERIAL PRIMARY KEY,
      established_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      note TEXT NOT NULL,
      repository_ref VARCHAR(255)
    )
  `);
  await client.query("INSERT INTO migration_tracking_baseline (note) VALUES ('test fixture')");
  await client.query(
    "INSERT INTO schema_migrations (migration_name, checksum) VALUES ('202610161210_create_resource_health_evaluations.sql', 'x')"
  );
}

let schemaCounter = 0;

interface Options {
  migrate?: boolean;
  warningsColumn?: string | null;
  beforeMigrate?: (client: Client) => Promise<void>;
}

/**
 * Runs `fn` in a fresh connection, inside one transaction holding a new
 * isolated schema with the fixture (and, by default, the migration applied).
 * Always rolled back.
 */
async function inIsolatedSchema(
  fn: (client: Client, schema: string) => Promise<void>,
  { migrate = true, warningsColumn = null, beforeMigrate }: Options = {}
): Promise<void> {
  const client = new Client(dbConfig());
  await client.connect();
  const schema = `${SCHEMA_PREFIX}${process.pid}_${Date.now()}_${schemaCounter++}`;
  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA ${schema}`);
    // Schema-only search_path: no fallback to public, so nothing here can
    // resolve against real tables of the same name.
    await client.query(`SET LOCAL search_path TO ${schema}`);
    await createFixture(client, { warningsColumn });
    if (beforeMigrate) await beforeMigrate(client);
    if (migrate) await client.query(MIGRATION_SQL);
    await fn(client, schema);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
}

/** The error `sql` fails with; the transaction continues from before it. */
async function failureOf(client: Client, sql: string, params: unknown[] = []): Promise<{ code?: string; message: string }> {
  await client.query('SAVEPOINT expected_failure');
  try {
    await client.query(sql, params);
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT expected_failure');
    return err as { code?: string; message: string };
  }
  await client.query('ROLLBACK TO SAVEPOINT expected_failure');
  throw new Error(`expected this statement to fail, and it succeeded: ${sql}`);
}

/**
 * Act as the application role for the rest of the transaction. `organization`
 * undefined leaves app.current_organization_id untouched (unset in a new
 * session); a string is set transaction-locally, as given.
 */
async function asApp(client: Client, schema: string, organization?: string): Promise<void> {
  await client.query(`GRANT USAGE ON SCHEMA ${schema} TO devcontrol`);
  await client.query('SET LOCAL ROLE devcontrol');
  if (organization !== undefined) {
    await client.query("SELECT set_config('app.current_organization_id', $1, true)", [organization]);
  }
  const { rows } = await client.query(
    'SELECT current_user AS role, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user'
  );
  expect(rows).toEqual([{ role: 'devcontrol', rolsuper: false, rolbypassrls: false }]);
}

async function asOwner(client: Client): Promise<void> {
  await client.query('RESET ROLE');
}

async function count(client: Client, table: string): Promise<number> {
  const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${table}`);
  return rows[0].n;
}

/**
 * Everything in the schema's catalog the migration could change: relations
 * (with owner, RLS flags and comment), columns, indexes, constraints,
 * policies, grants and column comments, plus the ledger's migration names.
 */
async function catalog(client: Client, schema: string): Promise<unknown[]> {
  const queries = [
    `SELECT relname, relkind::text, pg_get_userbyid(relowner) AS owner, relrowsecurity, relforcerowsecurity,
            obj_description(oid, 'pg_class') AS comment
       FROM pg_class WHERE relnamespace = $1::regnamespace ORDER BY relname`,
    `SELECT table_name, column_name, data_type, is_nullable, column_default, is_identity,
            col_description(format('%I.%I', table_schema, table_name)::regclass, ordinal_position::int) AS comment
       FROM information_schema.columns WHERE table_schema = $1 ORDER BY table_name, column_name`,
    `SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = $1 ORDER BY tablename, indexname`,
    `SELECT conrelid::regclass::text AS rel, conname, pg_get_constraintdef(oid) AS def
       FROM pg_constraint WHERE connamespace = $1::regnamespace ORDER BY rel, conname`,
    `SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies WHERE schemaname = $1 ORDER BY tablename, policyname`,
    `SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
      WHERE table_schema = $1 ORDER BY table_name, grantee, privilege_type`,
  ];
  const out: unknown[] = [];
  for (const sql of queries) out.push((await client.query(sql, [schema])).rows);
  out.push((await client.query('SELECT migration_name FROM schema_migrations ORDER BY migration_name')).rows);
  return out;
}

async function twoOrganizations(client: Client): Promise<[string, string]> {
  const { rows } = await client.query("INSERT INTO organizations (name) VALUES ('Org A'), ('Org B') RETURNING id");
  return [rows[0].id, rows[1].id];
}

/** One row per new table for `org`, written as the owner. */
async function seedRows(client: Client, org: string, account: string): Promise<void> {
  await client.query(
    `INSERT INTO aws_account_regions (organization_id, aws_account_id, region, enabled) VALUES ($1, $2, 'us-east-1', true)`,
    [org, account]
  );
  await client.query(
    `INSERT INTO aws_scan_leases (organization_id, aws_account_id, scan_kind, holder, acquired_at, heartbeat_at, expires_at)
     VALUES ($1, $2, 'discovery', 'host:1:run', now(), now(), now() + interval '5 minutes')`,
    [org, account]
  );
  await client.query(
    `INSERT INTO job_leases (organization_id, job_name, holder, acquired_at, heartbeat_at, expires_at)
     VALUES ($1, 'resource_discovery', 'host:1:run', now(), now(), now() + interval '5 minutes')`,
    [org]
  );
  await client.query(
    `INSERT INTO organization_feature_flags (organization_id, flag, enabled) VALUES ($1, $2, true)`,
    [org, MULTI_REGION_DISCOVERY_FLAG]
  );
}

// The lease contract from the migration header, as M4 is expected to run it.
const ACQUIRE_SCAN = `
  INSERT INTO aws_scan_leases (organization_id, aws_account_id, scan_kind, holder, acquired_at, heartbeat_at, expires_at)
  VALUES ($1, $2, 'discovery', $3, now(), now(), now() + interval '5 minutes')
  ON CONFLICT (organization_id, aws_account_id, scan_kind) DO UPDATE
    SET fencing_token = DEFAULT, holder = EXCLUDED.holder, acquired_at = now(), heartbeat_at = now(),
        expires_at = EXCLUDED.expires_at, released_at = NULL
  WHERE aws_scan_leases.released_at IS NOT NULL OR aws_scan_leases.expires_at <= now()
  RETURNING fencing_token`;
const RENEW_SCAN = `
  UPDATE aws_scan_leases SET heartbeat_at = now(), expires_at = now() + interval '5 minutes'
   WHERE organization_id = $1 AND aws_account_id = $2 AND scan_kind = 'discovery'
     AND fencing_token = $3 AND released_at IS NULL AND expires_at > now()`;
const FENCE_SCAN = `
  SELECT 1 FROM aws_scan_leases
   WHERE organization_id = $1 AND aws_account_id = $2 AND scan_kind = 'discovery'
     AND fencing_token = $3 AND released_at IS NULL AND expires_at > clock_timestamp()
   FOR SHARE`;
const RELEASE_SCAN = `
  UPDATE aws_scan_leases SET released_at = now()
   WHERE organization_id = $1 AND aws_account_id = $2 AND scan_kind = 'discovery'
     AND fencing_token = $3 AND released_at IS NULL`;
const ACQUIRE_JOB = `
  INSERT INTO job_leases (organization_id, job_name, holder, acquired_at, heartbeat_at, expires_at)
  VALUES ($1, 'resource_discovery', $2, now(), now(), now() + interval '5 minutes')
  ON CONFLICT (organization_id, job_name) DO UPDATE
    SET fencing_token = DEFAULT, holder = EXCLUDED.holder, acquired_at = now(), heartbeat_at = now(),
        expires_at = EXCLUDED.expires_at, released_at = NULL
  WHERE job_leases.released_at IS NOT NULL OR job_leases.expires_at <= now()
  RETURNING fencing_token`;
const COMPLETE_JOB = `
  UPDATE job_leases SET last_completed_at = now(), released_at = now()
   WHERE organization_id = $1 AND job_name = 'resource_discovery'
     AND fencing_token = $2 AND released_at IS NULL AND expires_at > now()`;

/** As the owner, moves a lease's times into the past so it reads as expired (now() is fixed in a transaction). */
async function expire(client: Client, table: string): Promise<void> {
  await asOwner(client);
  await client.query(
    `UPDATE ${table} SET acquired_at = now() - interval '20 minutes', heartbeat_at = now() - interval '20 minutes',
                         expires_at = now() - interval '10 minutes'`
  );
  await client.query('SET LOCAL ROLE devcontrol');
}

describe(`${MIGRATION_FILE}: catalog`, () => {
  it('creates the four tables, owned by the migrating role, each marked for the rollback', async () => {
    await inIsolatedSchema(async (client) => {
      const { rows } = await client.query(
        `SELECT relname, pg_get_userbyid(relowner) AS owner, obj_description(oid, 'pg_class') AS comment
           FROM pg_class WHERE relname = ANY($1) AND relnamespace = current_schema()::regnamespace ORDER BY relname`,
        [TABLES]
      );
      expect(rows.map((r) => r.relname)).toEqual([...TABLES].sort());
      const { rows: me } = await client.query('SELECT current_user AS u');
      for (const r of rows) {
        expect(r.owner).toBe(me[0].u);
        expect(r.comment.startsWith(MARKER)).toBe(true);
      }
    });
  });

  it('enables and forces row-level security on every new table', async () => {
    await inIsolatedSchema(async (client) => {
      const { rows } = await client.query(
        `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
          WHERE relname = ANY($1) AND relnamespace = current_schema()::regnamespace ORDER BY relname`,
        [TABLES]
      );
      expect(rows).toEqual(
        [...TABLES].sort().map((relname) => ({ relname, relrowsecurity: true, relforcerowsecurity: true }))
      );
    });
  });

  it('has exactly one tenant policy per table, for every command, on app.current_organization_id', async () => {
    await inIsolatedSchema(async (client, schema) => {
      const { rows } = await client.query(
        `SELECT tablename, policyname, cmd, permissive, roles, qual, with_check
           FROM pg_policies WHERE schemaname = $1 AND tablename = ANY($2) ORDER BY tablename`,
        [schema, TABLES]
      );
      expect(rows).toEqual(
        [...TABLES].sort().map((t) => ({
          tablename: t,
          policyname: `${t}_tenant`,
          cmd: 'ALL',
          permissive: 'PERMISSIVE',
          roles: '{public}',
          qual: TENANT_EXPRESSION,
          with_check: TENANT_EXPRESSION,
        }))
      );
    });
  });

  it('grants devcontrol only what each table needs -- never TRUNCATE; no DELETE on leases; flags read-only', async () => {
    await inIsolatedSchema(async (client, schema) => {
      const { rows } = await client.query(
        `SELECT table_name, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privs
           FROM information_schema.role_table_grants
          WHERE table_schema = $1 AND grantee = 'devcontrol' GROUP BY table_name ORDER BY table_name`,
        [schema]
      );
      expect(rows).toEqual([
        { table_name: 'aws_account_regions', privs: 'DELETE,INSERT,SELECT,UPDATE' },
        { table_name: 'aws_scan_leases', privs: 'INSERT,SELECT,UPDATE' },
        { table_name: 'job_leases', privs: 'INSERT,SELECT,UPDATE' },
        { table_name: 'organization_feature_flags', privs: 'SELECT' },
      ]);
    });
  });

  it('ignores default privileges: devcontrol ends with exactly arwd / arw / arw / r, and PUBLIC with nothing', async () => {
    await inIsolatedSchema(
      async (client, schema) => {
        const acl = async (relname: string): Promise<string[]> =>
          (await client.query(`SELECT relacl::text[] AS acl FROM pg_class WHERE relname = $1 AND relnamespace = $2::regnamespace`, [relname, schema])).rows[0].acl ?? [];
        const privilegesOf = (entries: string[], grantee: string) =>
          entries.filter((e) => e.startsWith(`${grantee}=`)).map((e) => e.slice(grantee.length + 1).split('/')[0]);

        // The default privileges were in force: a table created alongside got them.
        const probe = await acl('default_acl_probe');
        expect(privilegesOf(probe, 'devcontrol')).toEqual(['arwdDxt']);
        expect(privilegesOf(probe, '')).toEqual(['r']);

        const expected: Record<string, string> = {
          aws_account_regions: 'arwd',
          aws_scan_leases: 'arw',
          job_leases: 'arw',
          organization_feature_flags: 'r',
        };
        for (const table of TABLES) {
          const entries = await acl(table);
          expect([table, privilegesOf(entries, 'devcontrol')]).toEqual([table, [expected[table]]]);
          // PUBLIC's entry is the one with an empty grantee ("=r/owner").
          expect([table, privilegesOf(entries, '')]).toEqual([table, []]);
        }
      },
      {
        beforeMigrate: async (client) => {
          const { rows } = await client.query('SELECT current_schema() AS s');
          await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${rows[0].s} GRANT ALL ON TABLES TO devcontrol`);
          await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${rows[0].s} GRANT SELECT ON TABLES TO PUBLIC`);
          await client.query('CREATE TABLE default_acl_probe (id INT)');
        },
      }
    );
  });

  it('adds resource_discovery_jobs.warnings as nullable JSONB with no default, marked, and changes nothing else there', async () => {
    let before: unknown;
    await inIsolatedSchema(
      async (client, schema) => {
        const { rows } = await client.query(
          `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
            WHERE table_schema = $1 AND table_name = 'resource_discovery_jobs' AND column_name = 'warnings'`,
          [schema]
        );
        expect(rows).toEqual([{ column_name: 'warnings', data_type: 'jsonb', is_nullable: 'YES', column_default: null }]);
        const { rows: c } = await client.query(
          `SELECT col_description('resource_discovery_jobs'::regclass, attnum) AS comment
             FROM pg_attribute WHERE attrelid = 'resource_discovery_jobs'::regclass AND attname = 'warnings'`
        );
        expect(c[0].comment.startsWith(MARKER)).toBe(true);

        const after = await client.query(
          `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
            WHERE conrelid = 'resource_discovery_jobs'::regclass ORDER BY conname`
        );
        const policies = await client.query(
          `SELECT policyname, qual FROM pg_policies WHERE tablename = 'resource_discovery_jobs' AND schemaname = $1`,
          [schema]
        );
        const rls = await client.query(
          "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'resource_discovery_jobs'::regclass"
        );
        expect([after.rows, policies.rows, rls.rows]).toEqual(before);
      },
      {
        beforeMigrate: async (client) => {
          const schema = (await client.query('SELECT current_schema() AS s')).rows[0].s;
          const cons = await client.query(
            `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
              WHERE conrelid = 'resource_discovery_jobs'::regclass ORDER BY conname`
          );
          const policies = await client.query(
            `SELECT policyname, qual FROM pg_policies WHERE tablename = 'resource_discovery_jobs' AND schemaname = $1`,
            [schema]
          );
          const rls = await client.query(
            "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'resource_discovery_jobs'::regclass"
          );
          before = [cons.rows, policies.rows, rls.rows];
        },
      }
    );
  });

  it('fencing_token is a bigint GENERATED ALWAYS identity, NO CYCLE, unique, on both lease tables', async () => {
    await inIsolatedSchema(async (client, schema) => {
      for (const t of ['aws_scan_leases', 'job_leases']) {
        const { rows } = await client.query(
          `SELECT data_type, is_identity, identity_generation, identity_cycle FROM information_schema.columns
            WHERE table_schema = $1 AND table_name = $2 AND column_name = 'fencing_token'`,
          [schema, t]
        );
        expect(rows).toEqual([{ data_type: 'bigint', is_identity: 'YES', identity_generation: 'ALWAYS', identity_cycle: 'NO' }]);
        const { rows: u } = await client.query(
          `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = $1::regclass AND conname = $2`,
          [t, `${t}_fencing_token_unique`]
        );
        expect(u).toEqual([{ def: 'UNIQUE (fencing_token)' }]);
      }
    });
  });

  it('creates the primary keys and the scannable, unreleased and enabled-flag indexes', async () => {
    await inIsolatedSchema(async (client, schema) => {
      const { rows } = await client.query(
        `SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = ANY($2) ORDER BY indexname`,
        [schema, TABLES]
      );
      expect(rows.map((r) => r.indexname)).toEqual([
        'aws_account_regions_pkey',
        'aws_account_regions_scannable',
        'aws_scan_leases_fencing_token_unique',
        'aws_scan_leases_pkey',
        'aws_scan_leases_unreleased',
        'job_leases_fencing_token_unique',
        'job_leases_pkey',
        'job_leases_unreleased',
        'organization_feature_flags_enabled',
        'organization_feature_flags_pkey',
      ]);
    });
  });
});

describe(`${MIGRATION_FILE}: re-run and refusals`, () => {
  it('a second execution changes nothing in the catalog', async () => {
    await inIsolatedSchema(async (client, schema) => {
      const first = await catalog(client, schema);
      await client.query(MIGRATION_SQL);
      expect(await catalog(client, schema)).toEqual(first);
    });
  });

  it('a second execution keeps existing rows and lease tokens', async () => {
    await inIsolatedSchema(async (client) => {
      const [a] = await twoOrganizations(client);
      await seedRows(client, a, ACCOUNT_A);
      const before = await client.query('SELECT fencing_token FROM aws_scan_leases');
      await client.query(MIGRATION_SQL);
      for (const t of TABLES) expect(await count(client, t)).toBe(1);
      expect((await client.query('SELECT fencing_token FROM aws_scan_leases')).rows).toEqual(before.rows);
    });
  });

  it.each(TABLES)('refuses, and creates nothing, when %s already exists without the marker', async (table) => {
    await inIsolatedSchema(
      async (client) => {
        await client.query(`CREATE TABLE ${table} (organization_id UUID)`);
        const err = await failureOf(client, MIGRATION_SQL);
        expect(err.message).toBe(
          `${table} already exists and was not created by this migration -- refusing to proceed. Investigate before re-running.`
        );
        const { rows } = await client.query(
          'SELECT count(*)::int AS n FROM pg_class WHERE relname = ANY($1) AND relnamespace = current_schema()::regnamespace',
          [TABLES]
        );
        expect(rows[0].n).toBe(1);
      },
      { migrate: false }
    );
  });

  it('refuses when resource_discovery_jobs.warnings exists with another type', async () => {
    await inIsolatedSchema(
      async (client) => {
        const err = await failureOf(client, MIGRATION_SQL);
        expect(err.message).toMatch(/resource_discovery_jobs\.warnings already exists with type text \(expected jsonb\)/);
      },
      { migrate: false, warningsColumn: 'TEXT' }
    );
  });

  it('leaves a pre-existing JSONB warnings column exactly as it is (no comment written)', async () => {
    await inIsolatedSchema(
      async (client) => {
        const { rows } = await client.query(
          `SELECT col_description('resource_discovery_jobs'::regclass, attnum) AS comment
             FROM pg_attribute WHERE attrelid = 'resource_discovery_jobs'::regclass AND attname = 'warnings'`
        );
        expect(rows).toEqual([{ comment: null }]);
      },
      { warningsColumn: 'JSONB' }
    );
  });

  it('refuses when resource_discovery_jobs does not exist', async () => {
    await inIsolatedSchema(
      async (client) => {
        await client.query('DROP TABLE resource_discovery_jobs');
        const err = await failureOf(client, MIGRATION_SQL);
        expect(err.message).toBe('resource_discovery_jobs does not exist -- refusing to proceed.');
      },
      { migrate: false }
    );
  });

  it('is administrative: invisible to the ordinary path, and its rollback is never selected by the runner', () => {
    expect(getMigrationFiles(MIGRATIONS_DIR)).not.toContain(MIGRATION_FILE);
    const adminFiles: string[] = getMigrationFiles(ADMIN_DIR);
    expect(adminFiles).toContain(MIGRATION_FILE);
    expect(adminFiles).not.toContain(ROLLBACK_FILE);
    expect(adminFiles[adminFiles.length - 1]).toBe(MIGRATION_FILE);
  });
});

describe(`${MIGRATION_FILE}: database/migrate.js --execute-only --dry-run`, () => {
  it('reports the target as pending and changes nothing in the catalog', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mr-found-dry-run-'));
    fs.copyFileSync(path.join(ADMIN_DIR, MIGRATION_FILE), path.join(dir, MIGRATION_FILE));
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await inIsolatedSchema(
        async (client, schema) => {
          const before = await catalog(client, schema);
          const result = await runMigrations({ client, migrationsDir: dir, executeOnly: MIGRATION_FILE, dryRun: true });
          expect(result.executed).toEqual([]);
          expect(result.pending).toEqual([MIGRATION_FILE]);
          expect(result.executeOnlyTarget).toBe(MIGRATION_FILE);
          expect(await catalog(client, schema)).toEqual(before);
          const { rows } = await client.query('SELECT to_regclass($1) AS t', ['aws_scan_leases']);
          expect(rows[0].t).toBeNull();
          const printed = log.mock.calls.map((c) => c.join(' ')).join('\n');
          expect(printed).toMatch(/Dry run — targeted execution preview \(not executed\)/);
          expect(printed).toMatch(/ONLY the target migration will be executed\./);
        },
        { migrate: false }
      );
    } finally {
      log.mockRestore();
      warn.mockRestore();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe(`${MIGRATION_FILE}: row-level security, as devcontrol`, () => {
  it.each(TABLES)("%s: tagged with one organization, reads and changes only that organization's rows", async (table) => {
    await inIsolatedSchema(async (client, schema) => {
      const [a, b] = await twoOrganizations(client);
      await seedRows(client, a, ACCOUNT_A);
      await seedRows(client, b, ACCOUNT_B);
      await asApp(client, schema, a);
      const { rows } = await client.query(`SELECT DISTINCT organization_id FROM ${table}`);
      expect(rows).toEqual([{ organization_id: a }]);
      // devcontrol cannot update flags at all (asserted separately).
      if (table !== 'organization_feature_flags') {
        const upd = await client.query(`UPDATE ${table} SET organization_id = organization_id WHERE organization_id = $1`, [b]);
        expect(upd.rowCount).toBe(0);
      }
    });
  });

  it.each(TABLES)('%s: with the setting unset or empty, reads nothing; not a UUID, fails', async (table) => {
    await inIsolatedSchema(async (client, schema) => {
      const [a, b] = await twoOrganizations(client);
      await seedRows(client, a, ACCOUNT_A);
      await seedRows(client, b, ACCOUNT_B);
      await asApp(client, schema);
      expect(await count(client, table)).toBe(0);
      await client.query("SELECT set_config('app.current_organization_id', '', true)");
      expect(await count(client, table)).toBe(0);
      await client.query("SELECT set_config('app.current_organization_id', 'not-a-uuid', true)");
      const err = await failureOf(client, `SELECT count(*) FROM ${table}`);
      expect(err.code).toBe('22P02');
    });
  });

  it('cannot write a row for another organization, or move its own row to one', async () => {
    await inIsolatedSchema(async (client, schema) => {
      const [a, b] = await twoOrganizations(client);
      await seedRows(client, a, ACCOUNT_A);
      await asApp(client, schema, a);
      const inserts: Array<[string, unknown[]]> = [
        [`INSERT INTO aws_account_regions (organization_id, aws_account_id, region, enabled) VALUES ($1, $2, 'eu-west-1', true)`, [b, ACCOUNT_B]],
        [ACQUIRE_SCAN, [b, ACCOUNT_B, 'host:2:run']],
        [ACQUIRE_JOB, [b, 'host:2:run']],
      ];
      for (const [sql, params] of inserts) {
        expect((await failureOf(client, sql, params)).code).toBe('42501');
      }
      for (const t of ['aws_account_regions', 'aws_scan_leases', 'job_leases']) {
        expect((await failureOf(client, `UPDATE ${t} SET organization_id = $1`, [b])).code).toBe('42501');
      }
    });
  });

  it('organization_feature_flags is read-only to devcontrol, even for its own organization', async () => {
    await inIsolatedSchema(async (client, schema) => {
      const [a] = await twoOrganizations(client);
      await asApp(client, schema, a);
      const ins = await failureOf(
        client,
        'INSERT INTO organization_feature_flags (organization_id, flag, enabled) VALUES ($1, $2, true)',
        [a, MULTI_REGION_DISCOVERY_FLAG]
      );
      expect(ins.code).toBe('42501');
      expect((await failureOf(client, 'UPDATE organization_feature_flags SET enabled = true')).code).toBe('42501');
    });
  });
});

describe(`${MIGRATION_FILE}: feature flag defaults to OFF`, () => {
  it('no row is OFF; a row written with only its key is OFF; only enabled = true is ON', async () => {
    await inIsolatedSchema(async (client, schema) => {
      const [a] = await twoOrganizations(client);
      await asApp(client, schema, a);
      expect(await isOrganizationFeatureEnabled(client, a, MULTI_REGION_DISCOVERY_FLAG)).toBe(false);

      await asOwner(client);
      const { rows } = await client.query(
        'INSERT INTO organization_feature_flags (organization_id, flag) VALUES ($1, $2) RETURNING enabled',
        [a, MULTI_REGION_DISCOVERY_FLAG]
      );
      expect(rows).toEqual([{ enabled: false }]);
      await client.query('SET LOCAL ROLE devcontrol');
      expect(await isOrganizationFeatureEnabled(client, a, MULTI_REGION_DISCOVERY_FLAG)).toBe(false);

      await asOwner(client);
      await client.query('UPDATE organization_feature_flags SET enabled = true');
      await client.query('SET LOCAL ROLE devcontrol');
      expect(await isOrganizationFeatureEnabled(client, a, MULTI_REGION_DISCOVERY_FLAG)).toBe(true);
    });
  });

  it("another organization's ON flag does not turn it on here", async () => {
    await inIsolatedSchema(async (client, schema) => {
      const [a, b] = await twoOrganizations(client);
      await seedRows(client, b, ACCOUNT_B);
      await asApp(client, schema, a);
      expect(await isOrganizationFeatureEnabled(client, a, MULTI_REGION_DISCOVERY_FLAG)).toBe(false);
      // Even naming the other organization explicitly reads nothing under RLS.
      expect(await isOrganizationFeatureEnabled(client, b, MULTI_REGION_DISCOVERY_FLAG)).toBe(false);
    });
  });
});

describe(`${MIGRATION_FILE}: lease contract, as devcontrol`, () => {
  it('acquire returns a token; a second acquire while held gets nothing', async () => {
    await inIsolatedSchema(async (client, schema) => {
      const [a] = await twoOrganizations(client);
      await asApp(client, schema, a);
      const first = await client.query(ACQUIRE_SCAN, [a, ACCOUNT_A, 'host:1:run']);
      expect(first.rows).toHaveLength(1);
      const second = await client.query(ACQUIRE_SCAN, [a, ACCOUNT_A, 'host:2:run']);
      expect(second.rows).toHaveLength(0);
      const lease = await getScanLease(client, a, ACCOUNT_A, 'discovery');
      expect(lease).toMatchObject({ held: true, holder: 'host:1:run', fencingToken: String(first.rows[0].fencing_token) });
    });
  });

  it('every acquisition of a key gets a strictly greater token: after release and after expiry', async () => {
    await inIsolatedSchema(async (client, schema) => {
      const [a] = await twoOrganizations(client);
      await asApp(client, schema, a);
      const t1 = BigInt((await client.query(ACQUIRE_SCAN, [a, ACCOUNT_A, 'host:1:run'])).rows[0].fencing_token);
      expect((await client.query(RELEASE_SCAN, [a, ACCOUNT_A, t1.toString()])).rowCount).toBe(1);
      const t2 = BigInt((await client.query(ACQUIRE_SCAN, [a, ACCOUNT_A, 'host:2:run'])).rows[0].fencing_token);
      expect(t2 > t1).toBe(true);
      await expire(client, 'aws_scan_leases');
      const t3 = BigInt((await client.query(ACQUIRE_SCAN, [a, ACCOUNT_A, 'host:3:run'])).rows[0].fencing_token);
      expect(t3 > t2).toBe(true);
      expect(await count(client, 'aws_scan_leases')).toBe(1);
    });
  });

  it('a stale token cannot renew, pass the commit fence or release once the lease was taken over', async () => {
    await inIsolatedSchema(async (client, schema) => {
      const [a] = await twoOrganizations(client);
      await asApp(client, schema, a);
      const stale = (await client.query(ACQUIRE_SCAN, [a, ACCOUNT_A, 'host:1:run'])).rows[0].fencing_token;
      expect((await client.query(RENEW_SCAN, [a, ACCOUNT_A, stale])).rowCount).toBe(1);
      expect((await client.query(FENCE_SCAN, [a, ACCOUNT_A, stale])).rows).toHaveLength(1);

      await expire(client, 'aws_scan_leases');
      // Expired but not yet taken over: the holder has already lost it.
      expect((await client.query(RENEW_SCAN, [a, ACCOUNT_A, stale])).rowCount).toBe(0);
      expect((await client.query(FENCE_SCAN, [a, ACCOUNT_A, stale])).rows).toHaveLength(0);

      const current = (await client.query(ACQUIRE_SCAN, [a, ACCOUNT_A, 'host:2:run'])).rows[0].fencing_token;
      expect((await client.query(RENEW_SCAN, [a, ACCOUNT_A, stale])).rowCount).toBe(0);
      expect((await client.query(FENCE_SCAN, [a, ACCOUNT_A, stale])).rows).toHaveLength(0);
      expect((await client.query(RELEASE_SCAN, [a, ACCOUNT_A, stale])).rowCount).toBe(0);
      expect((await client.query(FENCE_SCAN, [a, ACCOUNT_A, current])).rows).toHaveLength(1);
      expect(await getScanLease(client, a, ACCOUNT_A, 'discovery')).toMatchObject({ held: true, holder: 'host:2:run' });
    });
  });

  it('a token cannot be chosen by the writer, on insert or update', async () => {
    await inIsolatedSchema(async (client, schema) => {
      const [a] = await twoOrganizations(client);
      await asApp(client, schema, a);
      const ins = await failureOf(
        client,
        `INSERT INTO aws_scan_leases (organization_id, aws_account_id, scan_kind, fencing_token, holder, acquired_at, heartbeat_at, expires_at)
         VALUES ($1, $2, 'discovery', 999, 'h', now(), now(), now() + interval '1 minute')`,
        [a, ACCOUNT_A]
      );
      expect(ins.code).toBe('428C9');
      await client.query(ACQUIRE_SCAN, [a, ACCOUNT_A, 'host:1:run']);
      const upd = await failureOf(client, 'UPDATE aws_scan_leases SET fencing_token = 999');
      expect(upd.code).toBe('428C9');
      const job = await failureOf(client, 'UPDATE job_leases SET fencing_token = 999');
      expect(job.code).toBe('428C9');
    });
  });

  it('lease rows cannot be deleted by the application (a deleted key could restart at a lower token)', async () => {
    await inIsolatedSchema(async (client, schema) => {
      const [a] = await twoOrganizations(client);
      await asApp(client, schema, a);
      await client.query(ACQUIRE_SCAN, [a, ACCOUNT_A, 'host:1:run']);
      await client.query(ACQUIRE_JOB, [a, 'host:1:run']);
      expect((await failureOf(client, 'DELETE FROM aws_scan_leases')).code).toBe('42501');
      expect((await failureOf(client, 'DELETE FROM job_leases')).code).toBe('42501');
      expect((await failureOf(client, 'TRUNCATE aws_scan_leases')).code).toBe('42501');
    });
  });

  it('tokens are unique across keys, organizations and both kinds of acquisition', async () => {
    await inIsolatedSchema(async (client, schema) => {
      const [a, b] = await twoOrganizations(client);
      const tokens: string[] = [];
      await asApp(client, schema, a);
      tokens.push((await client.query(ACQUIRE_SCAN, [a, ACCOUNT_A, 'h'])).rows[0].fencing_token);
      tokens.push((await client.query(ACQUIRE_SCAN, [a, ACCOUNT_B, 'h'])).rows[0].fencing_token);
      await client.query("SELECT set_config('app.current_organization_id', $1, true)", [b]);
      tokens.push((await client.query(ACQUIRE_SCAN, [b, ACCOUNT_A, 'h'])).rows[0].fencing_token);
      expect(new Set(tokens).size).toBe(3);
    });
  });

  it('job lease: completion is recorded only by the current token, and blocks a second holder while held', async () => {
    await inIsolatedSchema(async (client, schema) => {
      const [a] = await twoOrganizations(client);
      await asApp(client, schema, a);
      const stale = (await client.query(ACQUIRE_JOB, [a, 'host:1:run'])).rows[0].fencing_token;
      expect((await client.query(ACQUIRE_JOB, [a, 'host:2:run'])).rows).toHaveLength(0);
      await expire(client, 'job_leases');
      const current = (await client.query(ACQUIRE_JOB, [a, 'host:2:run'])).rows[0].fencing_token;
      expect(BigInt(current) > BigInt(stale)).toBe(true);
      expect((await client.query(COMPLETE_JOB, [a, stale])).rowCount).toBe(0);
      expect((await getJobLease(client, a, 'resource_discovery'))?.lastCompletedAt).toBeNull();
      expect((await client.query(COMPLETE_JOB, [a, current])).rowCount).toBe(1);
      const lease = await getJobLease(client, a, 'resource_discovery');
      expect(lease).toMatchObject({ held: false, holder: 'host:2:run', fencingToken: String(current) });
      expect(lease?.lastCompletedAt).toBeInstanceOf(Date);
    });
  });
});

/** Polls `condition` until it holds; fails after `timeoutMs`. */
async function waitFor(condition: () => Promise<boolean>, what: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const ACQUIRE_SCAN_WITH_TTL = ACQUIRE_SCAN.replace("now() + interval '5 minutes'", 'now() + $4::interval');

/**
 * Runs `fn` against a schema whose fixture and migration are COMMITTED, so
 * separate connections see them. The schema (and with it every row, grant,
 * sequence and policy) is dropped in finally.
 */
async function withCommittedSchema(fn: (schema: string, admin: Client) => Promise<void>): Promise<void> {
  const admin = new Client(dbConfig());
  await admin.connect();
  const schema = `${SCHEMA_PREFIX}fence_${process.pid}_${Date.now()}_${schemaCounter++}`;
  try {
    await admin.query('BEGIN');
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.query(`SET LOCAL search_path TO ${schema}`);
    await createFixture(admin);
    await admin.query(MIGRATION_SQL);
    await admin.query(`GRANT USAGE ON SCHEMA ${schema} TO devcontrol`);
    await admin.query('COMMIT');
    await fn(schema, admin);
  } finally {
    await admin.query('ROLLBACK').catch(() => undefined);
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
}

/** A connection acting as devcontrol for one organization, for its whole session. */
async function appConnection(schema: string, organization: string): Promise<Client> {
  const client = new Client(dbConfig());
  await client.connect();
  await client.query(`SET search_path TO ${schema}`);
  await client.query('SET ROLE devcontrol');
  await client.query("SELECT set_config('app.current_organization_id', $1, false)", [organization]);
  const { rows } = await client.query(
    'SELECT current_user AS role, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user'
  );
  expect(rows).toEqual([{ role: 'devcontrol', rolsuper: false, rolbypassrls: false }]);
  return client;
}

describe(`${MIGRATION_FILE}: commit fence across two connections, as devcontrol`, () => {
  it.each(['COMMIT', 'ROLLBACK'] as const)(
    "A holds the fence; after expiry B's takeover waits for A to %s, then gets a greater token and A's fence fails",
    async (end) => {
      await withCommittedSchema(async (schema, admin) => {
        const org = (await admin.query(`INSERT INTO ${schema}.organizations (name) VALUES ('Fence Org') RETURNING id`)).rows[0].id;
        const a = await appConnection(schema, org);
        const b = await appConnection(schema, org);
        try {
          const t1 = BigInt((await a.query(ACQUIRE_SCAN_WITH_TTL, [org, ACCOUNT_A, 'host:a:run', '3 seconds'])).rows[0].fencing_token);

          // A's destructive transaction: the fence first, then the write.
          await a.query('BEGIN');
          expect((await a.query(FENCE_SCAN, [org, ACCOUNT_A, t1.toString()])).rows).toHaveLength(1);
          await a.query(
            `INSERT INTO aws_account_regions (organization_id, aws_account_id, region, enabled) VALUES ($1, $2, 'eu-west-1', true)`,
            [org, ACCOUNT_A]
          );

          // The lease expires while A's transaction is still open.
          await waitFor(
            async () => (await admin.query(`SELECT expires_at <= clock_timestamp() AS expired FROM ${schema}.aws_scan_leases`)).rows[0].expired,
            'the lease to expire'
          );

          // B's takeover blocks on A's FOR SHARE row lock.
          const bPid = (await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
          let bFinished = false;
          const takeover = b.query(ACQUIRE_SCAN, [org, ACCOUNT_A, 'host:b:run']).then((result) => {
            bFinished = true;
            return result;
          });
          await waitFor(
            async () => (await admin.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1', [bPid])).rows[0]?.wait_event_type === 'Lock',
            "B to wait on a lock"
          );
          expect(bFinished).toBe(false);

          await a.query(end);

          const t2 = BigInt((await takeover).rows[0].fencing_token);
          expect(t2 > t1).toBe(true);
          const written = await admin.query(`SELECT count(*)::int AS n FROM ${schema}.aws_account_regions WHERE organization_id = $1`, [org]);
          expect(written.rows[0].n).toBe(end === 'COMMIT' ? 1 : 0);
          expect(await getScanLease(b, org, ACCOUNT_A, 'discovery')).toMatchObject({ held: true, holder: 'host:b:run', fencingToken: t2.toString() });

          // A's stale token no longer passes the fence.
          await a.query('BEGIN');
          expect((await a.query(FENCE_SCAN, [org, ACCOUNT_A, t1.toString()])).rows).toHaveLength(0);
          await a.query('ROLLBACK');
        } finally {
          await a.end();
          await b.end();
        }
      });
    },
    30_000
  );
});

describe(`${MIGRATION_FILE}: aws_account_regions shape, as devcontrol`, () => {
  it('defaults a new region to never_scanned, scan-enabled, no failures; reads back typed', async () => {
    await inIsolatedSchema(async (client, schema) => {
      const [a] = await twoOrganizations(client);
      await asApp(client, schema, a);
      await client.query(
        `INSERT INTO aws_account_regions (organization_id, aws_account_id, region, enabled) VALUES ($1, $2, 'us-east-1', true)`,
        [a, ACCOUNT_A]
      );
      const regions = await listAccountRegions(client, a, ACCOUNT_A);
      expect(regions).toHaveLength(1);
      expect(regions[0]).toMatchObject({
        region: 'us-east-1',
        enabled: true,
        scanEnabled: true,
        lastScanStatus: 'never_scanned',
        consecutiveFailures: 0,
        lastErrorCode: null,
      });
    });
  });

  it('rejects malformed account ids, regions, statuses and over-long error messages', async () => {
    await inIsolatedSchema(async (client, schema) => {
      const [a] = await twoOrganizations(client);
      await asApp(client, schema, a);
      const insert = (cols: string, vals: string, params: unknown[]) =>
        failureOf(
          client,
          `INSERT INTO aws_account_regions (organization_id, aws_account_id, region, enabled${cols}) VALUES ($1, $2, $3, true${vals})`,
          params
        );
      expect((await insert('', '', [a, '12345', 'us-east-1'])).code).toBe('23514');
      expect((await insert('', '', [a, ACCOUNT_A, 'global'])).code).toBe('23514');
      expect((await insert(', last_scan_status', ", 'done'", [a, ACCOUNT_A, 'us-east-1'])).code).toBe('23514');
      expect((await insert(', last_error_code, last_error_message', ', $4, $5', [a, ACCOUNT_A, 'us-east-1', 'Throttling', 'x'.repeat(501)])).code).toBe('23514');
      expect((await insert(', last_error_message', ', $4', [a, ACCOUNT_A, 'us-east-1', 'message without a code'])).code).toBe('23514');
    });
  });
});

describe(ROLLBACK_FILE, () => {
  it('restores the catalog exactly as it was before the migration, including the ledger', async () => {
    let before: unknown;
    await inIsolatedSchema(
      async (client, schema) => {
        await client.query(
          "INSERT INTO schema_migrations (migration_name, checksum) VALUES ($1, 'x')",
          [MIGRATION_FILE]
        );
        const [a] = await twoOrganizations(client);
        await seedRows(client, a, ACCOUNT_A);
        await client.query("INSERT INTO resource_discovery_jobs (organization_id, warnings) VALUES ($1, '[]')", [a]);
        await client.query(ROLLBACK_SQL);
        expect(await catalog(client, schema)).toEqual(before);
        expect(await count(client, 'resource_discovery_jobs')).toBe(1);
      },
      {
        beforeMigrate: async (client) => {
          const schema = (await client.query('SELECT current_schema() AS s')).rows[0].s;
          before = await catalog(client, schema);
        },
      }
    );
  });

  it('is re-run safe, and the migration can then be applied again', async () => {
    await inIsolatedSchema(async (client, schema) => {
      const applied = await catalog(client, schema);
      await client.query(ROLLBACK_SQL);
      const once = await catalog(client, schema);
      await client.query(ROLLBACK_SQL);
      expect(await catalog(client, schema)).toEqual(once);
      await client.query(MIGRATION_SQL);
      expect(await catalog(client, schema)).toEqual(applied);
    });
  });

  it('never drops a same-named table or a warnings column this migration did not create', async () => {
    await inIsolatedSchema(
      async (client) => {
        await client.query('CREATE TABLE job_leases (organization_id UUID)');
        await client.query(ROLLBACK_SQL);
        const { rows } = await client.query("SELECT to_regclass('job_leases') IS NOT NULL AS present");
        expect(rows).toEqual([{ present: true }]);
        const { rows: col } = await client.query(
          "SELECT count(*)::int AS n FROM pg_attribute WHERE attrelid = 'resource_discovery_jobs'::regclass AND attname = 'warnings' AND NOT attisdropped"
        );
        expect(col[0].n).toBe(1);
      },
      { migrate: false, warningsColumn: 'JSONB' }
    );
  });

  it('keeps a pre-existing JSONB warnings column the migration reused', async () => {
    await inIsolatedSchema(
      async (client) => {
        await client.query(ROLLBACK_SQL);
        const { rows } = await client.query(
          "SELECT count(*)::int AS n FROM pg_attribute WHERE attrelid = 'resource_discovery_jobs'::regclass AND attname = 'warnings' AND NOT attisdropped"
        );
        expect(rows[0].n).toBe(1);
        expect(await client.query("SELECT to_regclass('aws_scan_leases') AS t").then((r) => r.rows[0].t)).toBeNull();
      },
      { warningsColumn: 'JSONB' }
    );
  });

  it('deletes only the paired ledger row', async () => {
    await inIsolatedSchema(async (client) => {
      await client.query("INSERT INTO schema_migrations (migration_name, checksum) VALUES ($1, 'x')", [MIGRATION_FILE]);
      await client.query(ROLLBACK_SQL);
      const { rows } = await client.query('SELECT migration_name FROM schema_migrations ORDER BY 1');
      expect(rows).toEqual([{ migration_name: '202610161210_create_resource_health_evaluations.sql' }]);
    });
  });

  it('never cascades: a view over a new table makes it fail', async () => {
    await inIsolatedSchema(async (client) => {
      await client.query('CREATE VIEW held_leases AS SELECT organization_id FROM aws_scan_leases');
      const err = await failureOf(client, ROLLBACK_SQL);
      expect(err.code).toBe('2BP01');
      const { rows } = await client.query("SELECT to_regclass('organization_feature_flags') IS NOT NULL AS present");
      expect(rows).toEqual([{ present: true }]);
    });
  });
});

describe('CI bootstrap (read-only)', () => {
  it('applied the migration: the four tables exist, marked, with RLS forced, and the ledger row is recorded', async () => {
    const client = new Client(dbConfig());
    await client.connect();
    try {
      await client.query('BEGIN READ ONLY');
      await client.query('SET LOCAL search_path TO public');
      const { rows } = await client.query(
        `SELECT relname, relrowsecurity, relforcerowsecurity, obj_description(oid, 'pg_class') LIKE $2 || '%' AS marked
           FROM pg_class WHERE relname = ANY($1) AND relnamespace = 'public'::regnamespace ORDER BY relname`,
        [TABLES, MARKER]
      );
      expect(rows).toEqual(
        [...TABLES].sort().map((relname) => ({ relname, relrowsecurity: true, relforcerowsecurity: true, marked: true }))
      );
      const ledger = await client.query('SELECT 1 FROM schema_migrations WHERE migration_name = $1', [MIGRATION_FILE]);
      expect(ledger.rows).toHaveLength(1);
    } finally {
      await client.query('ROLLBACK');
      await client.end();
    }
  });
});
