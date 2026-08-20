/**
 * Live-Postgres coverage for database/migrate.js — the canonical migration
 * runner introduced by the schema-migrations forensic audit's forward-looking
 * baseline work.
 *
 * Runs against the actual local dev Postgres instance (same DB the app and
 * every other live-Postgres test in this repo connects to), not a mocked pg
 * client — consistent with this repo's established convention (see
 * resourceReconciliation.service.test.ts, aws-resources-lifecycle.test.ts).
 *
 * Full isolation per test: each test creates its own disposable Postgres
 * SCHEMA and sets search_path to it before running the migration runner, so
 * `schema_migrations` / `migration_tracking_baseline` and every fixture
 * table land inside that schema only — never in `public`, never touching
 * any real application table, and never requiring or using the real
 * database/migrations/ directory. Each test also gets its own disposable
 * temp directory of fixture .sql files (not the real migration set).
 */

import { Client } from 'pg';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  runMigrations,
  getPendingMigrations,
  getBaseline,
  computeChecksum,
  hasApplicationSchema,
  ADVISORY_LOCK_KEY,
} = require('../../../../database/migrate.js');

function dbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };
}

/** Fresh disposable schema + a connected client scoped to it via search_path. */
async function newIsolatedClient(schemaName: string): Promise<Client> {
  const admin = new Client(dbConfig());
  await admin.connect();
  await admin.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
  await admin.query(`CREATE SCHEMA ${schemaName}`);
  await admin.end();

  const client = new Client(dbConfig());
  await client.connect();
  await client.query(`SET search_path TO ${schemaName}, public`);
  return client;
}

async function dropSchema(schemaName: string) {
  const admin = new Client(dbConfig());
  await admin.connect();
  await admin.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
  await admin.end();
}

function mkFixtureDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-runner-test-'));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content, 'utf8');
  }
  return dir;
}

function rmFixtureDir(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('database/migrate.js — canonical runner', () => {
  let schemaCounter = 0;
  const schemas: string[] = [];
  const fixtureDirs: string[] = [];

  function nextSchema() {
    const name = `migrate_test_${Date.now()}_${schemaCounter++}`;
    schemas.push(name);
    return name;
  }

  afterAll(async () => {
    for (const s of schemas) await dropSchema(s);
    for (const d of fixtureDirs) rmFixtureDir(d);
  });

  it('(1) fresh tracking state: bootstraps ledger + baseline tables with no baseline set', async () => {
    const schema = nextSchema();
    const client = await newIsolatedClient(schema);
    const dir = mkFixtureDir({});
    fixtureDirs.push(dir);
    try {
      const result = await runMigrations({ client, migrationsDir: dir, dryRun: true });
      expect(result.pending).toEqual([]);
      const baseline = await getBaseline(client);
      expect(baseline).toBeNull();
    } finally {
      await client.end();
    }
  });

  it('(2) baseline: can be established once, and refuses a second time', async () => {
    const schema = nextSchema();
    const client = await newIsolatedClient(schema);
    const dir = mkFixtureDir({});
    fixtureDirs.push(dir);
    try {
      const result = await runMigrations({
        client,
        migrationsDir: dir,
        initBaselineNote: 'test baseline — historical provenance not reconstructed',
      });
      expect(result.baseline).toBeTruthy();
      expect(result.baseline.note).toContain('test baseline');

      await expect(
        runMigrations({ client, migrationsDir: dir, initBaselineNote: 'second attempt' })
      ).rejects.toThrow(/Baseline already established/);
    } finally {
      await client.end();
    }
  });

  it('(2b) baseline semantics: establishing a baseline never inserts a schema_migrations row', async () => {
    const schema = nextSchema();
    const client = await newIsolatedClient(schema);
    const dir = mkFixtureDir({});
    fixtureDirs.push(dir);
    try {
      await runMigrations({ client, migrationsDir: dir, initBaselineNote: 'baseline only' });
      const { rows } = await client.query('SELECT * FROM schema_migrations');
      expect(rows).toHaveLength(0);
    } finally {
      await client.end();
    }
  });

  it('(3) first forward migration: executes, records filename + checksum + timestamp, creates the table', async () => {
    const schema = nextSchema();
    const client = await newIsolatedClient(schema);
    const sql = 'CREATE TABLE widget (id SERIAL PRIMARY KEY, name TEXT);';
    const dir = mkFixtureDir({ '202601010000_create_widget.sql': sql });
    fixtureDirs.push(dir);
    try {
      const result = await runMigrations({ client, migrationsDir: dir });
      expect(result.executed).toEqual(['202601010000_create_widget.sql']);

      const { rows } = await client.query(
        'SELECT migration_name, checksum, executed_at FROM schema_migrations'
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].migration_name).toBe('202601010000_create_widget.sql');
      expect(rows[0].checksum).toBe(computeChecksum(sql));
      expect(rows[0].executed_at).toBeInstanceOf(Date);

      // to_regclass() displays an unqualified name when resolved via search_path —
      // assert non-null (table exists) rather than a specific qualified string.
      const tableCheck = await client.query(`SELECT to_regclass('${schema}.widget') AS t`);
      expect(tableCheck.rows[0].t).not.toBeNull();
    } finally {
      await client.end();
    }
  });

  it('(4) idempotent rerun: running twice does not execute or duplicate the same migration', async () => {
    const schema = nextSchema();
    const client = await newIsolatedClient(schema);
    const dir = mkFixtureDir({
      '202601010000_create_gadget.sql': 'CREATE TABLE gadget (id SERIAL PRIMARY KEY);',
    });
    fixtureDirs.push(dir);
    try {
      const first = await runMigrations({ client, migrationsDir: dir });
      expect(first.executed).toEqual(['202601010000_create_gadget.sql']);

      const second = await runMigrations({ client, migrationsDir: dir });
      expect(second.executed).toEqual([]);

      const { rows } = await client.query('SELECT COUNT(*)::int AS n FROM schema_migrations');
      expect(rows[0].n).toBe(1);
    } finally {
      await client.end();
    }
  });

  it('(5) failure rollback: a failing migration is rolled back and never recorded as applied', async () => {
    const schema = nextSchema();
    const client = await newIsolatedClient(schema);
    const dir = mkFixtureDir({
      '202601010000_broken.sql': 'CREATE TABLE broken_table (id SERIAL PRIMARY KEY,);', // trailing comma: syntax error
    });
    fixtureDirs.push(dir);
    try {
      await expect(runMigrations({ client, migrationsDir: dir })).rejects.toThrow();

      const { rows } = await client.query('SELECT * FROM schema_migrations');
      expect(rows).toHaveLength(0);

      const tableCheck = await client.query(`SELECT to_regclass('${schema}.broken_table') AS t`);
      expect(tableCheck.rows[0].t).toBeNull();
    } finally {
      await client.end();
    }
  });

  it('(6) checksum drift: a modified already-applied migration file is detected and blocks the run', async () => {
    const schema = nextSchema();
    const client = await newIsolatedClient(schema);
    const filePath = (dir: string) => path.join(dir, '202601010000_create_thing.sql');
    const dir = mkFixtureDir({
      '202601010000_create_thing.sql': 'CREATE TABLE thing (id SERIAL PRIMARY KEY);',
    });
    fixtureDirs.push(dir);
    try {
      const first = await runMigrations({ client, migrationsDir: dir });
      expect(first.executed).toEqual(['202601010000_create_thing.sql']);

      // Mutate the already-applied file's content on disk.
      fs.writeFileSync(filePath(dir), 'CREATE TABLE thing (id SERIAL PRIMARY KEY, extra TEXT);', 'utf8');

      const { mismatched } = await getPendingMigrations(client, dir);
      expect(mismatched).toHaveLength(1);
      expect(mismatched[0].file).toBe('202601010000_create_thing.sql');

      await expect(runMigrations({ client, migrationsDir: dir })).rejects.toThrow(/Checksum mismatch/);
    } finally {
      await client.end();
    }
  });

  it('(6b) checksum drift blocks the entire run, including unrelated pending migrations', async () => {
    const schema = nextSchema();
    const client = await newIsolatedClient(schema);
    const filePath = (dir: string) => path.join(dir, '202601010000_stable.sql');
    const dir = mkFixtureDir({
      '202601010000_stable.sql': 'CREATE TABLE stable_thing (id SERIAL PRIMARY KEY);',
    });
    fixtureDirs.push(dir);
    try {
      await runMigrations({ client, migrationsDir: dir });
      fs.writeFileSync(filePath(dir), 'CREATE TABLE stable_thing (id SERIAL PRIMARY KEY, changed BOOLEAN);', 'utf8');
      // Add a brand-new, otherwise-valid pending migration alongside the mismatched one.
      fs.writeFileSync(
        path.join(dir, '202601020000_new_one.sql'),
        'CREATE TABLE new_one (id SERIAL PRIMARY KEY);',
        'utf8'
      );

      await expect(runMigrations({ client, migrationsDir: dir })).rejects.toThrow(/Checksum mismatch/);

      const tableCheck = await client.query(`SELECT to_regclass('${schema}.new_one') AS t`);
      expect(tableCheck.rows[0].t).toBeNull(); // never ran, because the batch was blocked
    } finally {
      await client.end();
    }
  });

  it('(7) pending/dry-run: reports pending migrations without executing them', async () => {
    const schema = nextSchema();
    const client = await newIsolatedClient(schema);
    const dir = mkFixtureDir({
      '202601010000_dry_run_table.sql': 'CREATE TABLE dry_run_table (id SERIAL PRIMARY KEY);',
    });
    fixtureDirs.push(dir);
    try {
      const result = await runMigrations({ client, migrationsDir: dir, dryRun: true });
      expect(result.pending).toEqual(['202601010000_dry_run_table.sql']);
      expect(result.executed).toEqual([]);

      const tableCheck = await client.query(`SELECT to_regclass('${schema}.dry_run_table') AS t`);
      expect(tableCheck.rows[0].t).toBeNull();

      const { rows } = await client.query('SELECT * FROM schema_migrations');
      expect(rows).toHaveLength(0);
    } finally {
      await client.end();
    }
  });

  it('(8) multiple pending migrations execute in filename order, each recorded once', async () => {
    const schema = nextSchema();
    const client = await newIsolatedClient(schema);
    const dir = mkFixtureDir({
      '202601020000_second.sql': 'CREATE TABLE second_tbl (id SERIAL PRIMARY KEY);',
      '202601010000_first.sql': 'CREATE TABLE first_tbl (id SERIAL PRIMARY KEY);',
    });
    fixtureDirs.push(dir);
    try {
      const result = await runMigrations({ client, migrationsDir: dir });
      expect(result.executed).toEqual(['202601010000_first.sql', '202601020000_second.sql']);
    } finally {
      await client.end();
    }
  });
});

describe('database/migrate.js — no-baseline safety gate', () => {
  let schemaCounter = 0;
  const schemas: string[] = [];
  const fixtureDirs: string[] = [];

  function nextSchema() {
    const name = `migrate_gate_test_${Date.now()}_${schemaCounter++}`;
    schemas.push(name);
    return name;
  }

  afterAll(async () => {
    for (const s of schemas) await dropSchema(s);
    for (const d of fixtureDirs) rmFixtureDir(d);
  });

  it('(9) fresh empty database + no baseline: hasApplicationSchema is false, migrations run normally', async () => {
    const schema = nextSchema();
    const client = await newIsolatedClient(schema);
    const dir = mkFixtureDir({
      '202601010000_create_widget9.sql': 'CREATE TABLE widget9 (id SERIAL PRIMARY KEY);',
    });
    fixtureDirs.push(dir);
    try {
      const result = await runMigrations({ client, migrationsDir: dir });
      expect(result.executed).toEqual(['202601010000_create_widget9.sql']);
      const baseline = await getBaseline(client);
      expect(baseline).toBeNull();
    } finally {
      await client.end();
    }
  });

  it('(10) existing application table + no baseline + no ledger: normal run refuses before executing anything, with an actionable error', async () => {
    const schema = nextSchema();
    const client = await newIsolatedClient(schema);
    // Simulate a pre-existing production-like database: an application table
    // exists, but was created out-of-band — not through this runner — so
    // there is no baseline and no schema_migrations row for it.
    await client.query('CREATE TABLE preexisting_app_table (id SERIAL PRIMARY KEY)');

    const dir = mkFixtureDir({
      '202601010000_should_not_run.sql': 'CREATE TABLE should_not_run (id SERIAL PRIMARY KEY);',
    });
    fixtureDirs.push(dir);
    try {
      expect(await hasApplicationSchema(client)).toBe(true);

      await expect(runMigrations({ client, migrationsDir: dir })).rejects.toThrow(
        /no migration tracking baseline.*no recorded.*migration history/s
      );
      // Assert on the actionable instruction specifically, not just that
      // *an* error was thrown — a future refactor that made this vaguer or
      // silent must fail this test.
      await expect(runMigrations({ client, migrationsDir: dir })).rejects.toThrow(
        /--init-baseline/
      );

      // Nothing executed: the fixture migration's table was never created,
      // and schema_migrations stays empty.
      const tableCheck = await client.query(`SELECT to_regclass('${schema}.should_not_run') AS t`);
      expect(tableCheck.rows[0].t).toBeNull();
      const { rows } = await client.query('SELECT * FROM schema_migrations');
      expect(rows).toHaveLength(0);
    } finally {
      await client.end();
    }
  });

  it('(11) existing application table + --init-baseline: baseline can be established', async () => {
    const schema = nextSchema();
    const client = await newIsolatedClient(schema);
    await client.query('CREATE TABLE preexisting_app_table_11 (id SERIAL PRIMARY KEY)');
    const dir = mkFixtureDir({});
    fixtureDirs.push(dir);
    try {
      const result = await runMigrations({
        client,
        migrationsDir: dir,
        initBaselineNote: 'existing app schema, provenance not reconstructed',
      });
      expect(result.baseline).toBeTruthy();
      expect(await getBaseline(client)).toBeTruthy();
    } finally {
      await client.end();
    }
  });

  it('(12) existing application table + baseline: normal migration execution works', async () => {
    const schema = nextSchema();
    const client = await newIsolatedClient(schema);
    await client.query('CREATE TABLE preexisting_app_table_12 (id SERIAL PRIMARY KEY)');
    const dir = mkFixtureDir({
      '202601010000_create_widget12.sql': 'CREATE TABLE widget12 (id SERIAL PRIMARY KEY);',
    });
    fixtureDirs.push(dir);
    try {
      await runMigrations({
        client,
        migrationsDir: dir,
        initBaselineNote: 'baseline before normal run',
      });

      const result = await runMigrations({ client, migrationsDir: dir });
      expect(result.executed).toEqual(['202601010000_create_widget12.sql']);

      const tableCheck = await client.query(`SELECT to_regclass('${schema}.widget12') AS t`);
      expect(tableCheck.rows[0].t).not.toBeNull();
    } finally {
      await client.end();
    }
  });

  it('(13) existing schema_migrations history without a baseline: proceeds explicitly (ledger rows are authentic, not inferred) rather than refusing', async () => {
    const schema = nextSchema();
    const client = await newIsolatedClient(schema);
    const dir = mkFixtureDir({
      '202601010000_first13.sql': 'CREATE TABLE first13 (id SERIAL PRIMARY KEY);',
    });
    fixtureDirs.push(dir);
    try {
      // Run once with no baseline on a genuinely fresh DB — this records real
      // ledger history without ever establishing a baseline, reproducing
      // "schema_migrations has rows, but no baseline" without fabricating it.
      const first = await runMigrations({ client, migrationsDir: dir });
      expect(first.executed).toEqual(['202601010000_first13.sql']);
      expect(await getBaseline(client)).toBeNull();

      // Add a second pending migration and run again — should proceed
      // normally (not refuse), because schema_migrations already has
      // authentic history from this runner, even though there is still no
      // formal baseline.
      fs.writeFileSync(
        path.join(dir, '202601020000_second13.sql'),
        'CREATE TABLE second13 (id SERIAL PRIMARY KEY);',
        'utf8'
      );
      const second = await runMigrations({ client, migrationsDir: dir });
      expect(second.executed).toEqual(['202601020000_second13.sql']);
      expect(await getBaseline(client)).toBeNull();
    } finally {
      await client.end();
    }
  });

  it('(14) existing baseline + --dry-run: remains read-only', async () => {
    const schema = nextSchema();
    const client = await newIsolatedClient(schema);
    await client.query('CREATE TABLE preexisting_app_table_14 (id SERIAL PRIMARY KEY)');
    const dir = mkFixtureDir({
      '202601010000_create_widget14.sql': 'CREATE TABLE widget14 (id SERIAL PRIMARY KEY);',
    });
    fixtureDirs.push(dir);
    try {
      await runMigrations({ client, migrationsDir: dir, initBaselineNote: 'baseline for dry-run test' });

      const result = await runMigrations({ client, migrationsDir: dir, dryRun: true });
      expect(result.pending).toEqual(['202601010000_create_widget14.sql']);
      expect(result.executed).toEqual([]);

      const tableCheck = await client.query(`SELECT to_regclass('${schema}.widget14') AS t`);
      expect(tableCheck.rows[0].t).toBeNull();
      const { rows } = await client.query('SELECT * FROM schema_migrations');
      expect(rows).toHaveLength(0);
    } finally {
      await client.end();
    }
  });

  it('(15) existing baseline + checksum drift: remains blocked', async () => {
    const schema = nextSchema();
    const client = await newIsolatedClient(schema);
    const filePath = (dir: string) => path.join(dir, '202601010000_thing15.sql');
    const dir = mkFixtureDir({
      '202601010000_thing15.sql': 'CREATE TABLE thing15 (id SERIAL PRIMARY KEY);',
    });
    fixtureDirs.push(dir);
    try {
      await runMigrations({ client, migrationsDir: dir, initBaselineNote: 'baseline for drift test' });
      const first = await runMigrations({ client, migrationsDir: dir });
      expect(first.executed).toEqual(['202601010000_thing15.sql']);

      fs.writeFileSync(filePath(dir), 'CREATE TABLE thing15 (id SERIAL PRIMARY KEY, extra TEXT);', 'utf8');

      await expect(runMigrations({ client, migrationsDir: dir })).rejects.toThrow(/Checksum mismatch/);
    } finally {
      await client.end();
    }
  });

  it('(16) existing baseline + migration failure: rollback happens and the advisory lock is actually released (re-acquirable immediately after)', async () => {
    const schema = nextSchema();
    const client = await newIsolatedClient(schema);
    const dir = mkFixtureDir({
      '202601010000_broken16.sql': 'CREATE TABLE broken16 (id SERIAL PRIMARY KEY,);', // syntax error
    });
    fixtureDirs.push(dir);
    try {
      await runMigrations({ client, migrationsDir: dir, initBaselineNote: 'baseline for failure test' });

      await expect(runMigrations({ client, migrationsDir: dir })).rejects.toThrow();

      const { rows } = await client.query('SELECT * FROM schema_migrations');
      expect(rows).toHaveLength(0);
      const tableCheck = await client.query(`SELECT to_regclass('${schema}.broken16') AS t`);
      expect(tableCheck.rows[0].t).toBeNull();

      // The lock must have been released in `finally` even though the
      // migration threw — prove it behaviorally, not just by reading the
      // try/finally in source, by immediately trying to acquire it again on
      // a second connection. Advisory locks are database-scoped, not
      // schema-scoped, so a plain second connection (no schema
      // drop/recreate — that would destroy this test's own ledger tables)
      // is all that's needed here.
      const second = new Client(dbConfig());
      await second.connect();
      try {
        const { rows: lockRows } = await second.query(
          'SELECT pg_try_advisory_lock($1) AS acquired',
          [ADVISORY_LOCK_KEY]
        );
        expect(lockRows[0].acquired).toBe(true);
        await second.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
      } finally {
        await second.end();
      }
    } finally {
      await client.end();
    }
  });
});

describe('database/migrate.js — legacy schema_migrations upgrade path (backfillLegacyChecksums)', () => {
  let schemaCounter = 0;
  const schemas: string[] = [];
  const fixtureDirs: string[] = [];

  function nextSchema() {
    const name = `migrate_legacy_test_${Date.now()}_${schemaCounter++}`;
    schemas.push(name);
    return name;
  }

  afterAll(async () => {
    for (const s of schemas) await dropSchema(s);
    for (const d of fixtureDirs) rmFixtureDir(d);
  });

  it('(17) old-shaped schema_migrations (no checksum column) is upgraded safely: checksums backfilled, history preserved, no false mismatches, and modification after backfill is still caught', async () => {
    const schema = nextSchema();
    const client = await newIsolatedClient(schema);

    const sqlA = 'CREATE TABLE legacy_a (id SERIAL PRIMARY KEY);';
    const sqlB = 'CREATE TABLE legacy_b (id SERIAL PRIMARY KEY);';
    const dir = mkFixtureDir({
      '202601010000_legacy_a.sql': sqlA,
      '202601020000_legacy_b.sql': sqlB,
    });
    fixtureDirs.push(dir);

    try {
      // Manually construct the LEGACY table shape — exactly what this
      // project's real local dev database was found to have during review
      // (id, migration_name, executed_at — no checksum column at all).
      // Deliberately do NOT call ensureTrackingTables/runMigrations first;
      // that would create the modern shape and defeat the point of this
      // test.
      await client.query(`
        CREATE TABLE schema_migrations (
          id SERIAL PRIMARY KEY,
          migration_name VARCHAR(255) UNIQUE NOT NULL,
          executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);
      await client.query(
        `INSERT INTO schema_migrations (migration_name, executed_at) VALUES ($1, NOW() - INTERVAL '2 days')`,
        ['202601010000_legacy_a.sql']
      );
      await client.query(
        `INSERT INTO schema_migrations (migration_name, executed_at) VALUES ($1, NOW() - INTERVAL '1 day')`,
        ['202601020000_legacy_b.sql']
      );

      // Sanity: confirm the legacy shape really has no checksum column yet,
      // scoped explicitly to this isolated schema (not `public`, which may
      // independently have its own schema_migrations by now).
      const preCols = await client.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'schema_migrations'`,
        [schema]
      );
      expect(preCols.rows.map((r: { column_name: string }) => r.column_name)).not.toContain('checksum');

      // Run the actual upgrade path. dry-run is fine here — both
      // ensureTrackingTables and backfillLegacyChecksums run unconditionally
      // before the dryRun branch, so this exercises the real upgrade logic
      // without needing to execute anything.
      const result = await runMigrations({ client, migrationsDir: dir, dryRun: true });

      // 1. checksum column added
      const postCols = await client.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'schema_migrations' AND column_name = 'checksum'`,
        [schema]
      );
      expect(postCols.rows).toHaveLength(1);

      // 2. existing records remain intact — same two rows, not deleted or
      // recreated.
      const rows = await client.query(
        'SELECT migration_name, checksum, executed_at FROM schema_migrations ORDER BY migration_name'
      );
      expect(rows.rows).toHaveLength(2);
      expect(rows.rows[0].migration_name).toBe('202601010000_legacy_a.sql');
      expect(rows.rows[1].migration_name).toBe('202601020000_legacy_b.sql');
      expect(rows.rows[0].executed_at).toBeInstanceOf(Date);
      expect(rows.rows[1].executed_at).toBeInstanceOf(Date);

      // 3. checksums correctly populated from the actual current file content
      expect(rows.rows[0].checksum).toBe(computeChecksum(sqlA));
      expect(rows.rows[1].checksum).toBe(computeChecksum(sqlB));

      // 4 & 5. both recognized as already applied — not pending, not
      // reported as mismatched.
      expect(result.pending).toEqual([]);
      expect(result.mismatched).toEqual([]);

      // 6. a genuinely modified migration, now carrying a non-null
      // backfilled checksum, is still rejected — proves the backfill does
      // not weaken mismatch protection going forward for the exact rows it
      // just touched.
      fs.writeFileSync(
        path.join(dir, '202601010000_legacy_a.sql'),
        'CREATE TABLE legacy_a (id SERIAL PRIMARY KEY, tampered BOOLEAN);',
        'utf8'
      );
      await expect(runMigrations({ client, migrationsDir: dir })).rejects.toThrow(/Checksum mismatch/);

      // And confirm it's specifically the tampered file flagged, not a
      // false positive on its untouched sibling.
      const { mismatched } = await getPendingMigrations(client, dir);
      expect(mismatched).toHaveLength(1);
      expect(mismatched[0].file).toBe('202601010000_legacy_a.sql');
    } finally {
      await client.end();
    }
  });

  it('(18) a legacy row whose file no longer exists on disk is left with a NULL checksum — never fabricated, never surfaces as pending or mismatched', async () => {
    const schema = nextSchema();
    const client = await newIsolatedClient(schema);
    const dir = mkFixtureDir({}); // empty — simulates the referenced file having been deleted/renamed at some point
    fixtureDirs.push(dir);

    try {
      await client.query(`
        CREATE TABLE schema_migrations (
          id SERIAL PRIMARY KEY,
          migration_name VARCHAR(255) UNIQUE NOT NULL,
          executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);
      await client.query(
        'INSERT INTO schema_migrations (migration_name) VALUES ($1)',
        ['202601010000_orphaned.sql']
      );

      const result = await runMigrations({ client, migrationsDir: dir, dryRun: true });

      const { rows } = await client.query('SELECT migration_name, checksum FROM schema_migrations');
      expect(rows).toHaveLength(1);
      expect(rows[0].migration_name).toBe('202601010000_orphaned.sql');
      expect(rows[0].checksum).toBeNull(); // never fabricated

      // Permanently inert: not on disk, so never considered pending; no
      // file content to compare against, so never considered mismatched.
      expect(result.pending).toEqual([]);
      expect(result.mismatched).toEqual([]);
    } finally {
      await client.end();
    }
  });
});
