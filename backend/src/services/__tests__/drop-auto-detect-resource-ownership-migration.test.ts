/**
 * Live-Postgres coverage for
 * database/migrations-admin/202610102024_drop_auto_detect_resource_ownership.sql
 * and its manual-only paired rollback file.
 *
 * Executes the real migration/rollback SQL read from disk, never a
 * reimplementation. The function under test is recreated from migration
 * 011's own text (extracted by marker, not retyped).
 *
 * Every test that creates or drops anything runs inside a transaction that
 * is rolled back, so the database is left exactly as it was found. The
 * function and its fixtures must live in `public` (the migration targets the
 * exact signature public.auto_detect_resource_ownership()), so the
 * isolated-schema technique used elsewhere doesn't apply; the rolled-back
 * transaction gives the same isolation, since uncommitted DDL is invisible
 * to every other session.
 *
 * The "CI bootstrap" block assumes a database bootstrapped by
 * .github/scripts/ci-bootstrap-schema.js, which is what CI's backend test
 * step runs against (run locally against a fresh scratch database
 * bootstrapped the same way).
 */
import { Client } from 'pg';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { runMigrations, getMigrationFiles } = require('../../../../database/migrate.js');

const REPO_ROOT = path.join(__dirname, '../../../..');
const ADMIN_DIR = path.join(REPO_ROOT, 'database/migrations-admin');
const M011 = '011_add_cost_attribution_to_aws_resources.sql';
const FORWARD = '202610102024_drop_auto_detect_resource_ownership.sql';
const ROLLBACK = '202610102024_drop_auto_detect_resource_ownership_rollback.sql';

const M011_SQL = fs.readFileSync(path.join(ADMIN_DIR, M011), 'utf8');
const FORWARD_SQL = fs.readFileSync(path.join(ADMIN_DIR, FORWARD), 'utf8');
const ROLLBACK_SQL = fs.readFileSync(path.join(ADMIN_DIR, ROLLBACK), 'utf8');

const OPT_IN = "SET LOCAL devcontrol.allow_unsafe_auto_detect_rollback = 'reintroduce-cross-tenant-risk'";

/**
 * Migration 011's function section, from its "FUNCTION: AUTO-DETECT
 * OWNERSHIP" comment banner through `$$ LANGUAGE plpgsql;` (inclusive, with
 * its trailing newline).
 */
function m011FunctionBlock(): string {
  const banner =
    '-- =====================================================\n' +
    '-- FUNCTION: AUTO-DETECT OWNERSHIP FROM AWS TAGS\n';
  const start = M011_SQL.indexOf(banner);
  const endMarker = '$$ LANGUAGE plpgsql;\n';
  const end = M011_SQL.indexOf(endMarker, start);
  if (start === -1 || end === -1) throw new Error('Could not locate the function block in migration 011');
  return M011_SQL.slice(start, end + endMarker.length);
}

function dbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };
}

/** Schema- and signature-specific: public, name, zero arguments. */
async function functionCount(client: Client): Promise<number> {
  const { rows } = await client.query(`
    SELECT count(*)::int AS n
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'auto_detect_resource_ownership'
       AND p.pronargs = 0
  `);
  return rows[0].n;
}

/** Everything about the function that a faithful restore must reproduce. */
async function functionIdentity(client: Client) {
  const { rows } = await client.query(`
    SELECT pg_catalog.pg_get_functiondef(p.oid) AS def,
           p.prosrc, l.lanname, p.provolatile, p.prosecdef, p.proconfig,
           p.proisstrict, p.proleakproof, p.proparallel, p.prokind,
           p.prorettype::regtype::text AS rettype, p.proretset,
           pg_catalog.obj_description(p.oid, 'pg_proc') AS comment
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_language l ON l.oid = p.prolang
     WHERE p.oid = pg_catalog.to_regprocedure('public.auto_detect_resource_ownership()')
  `);
  return rows[0];
}

/** Runs sql under a savepoint; returns the error (or null) and undoes a failure. */
async function tryUnderSavepoint(client: Client, sql: string): Promise<Error | null> {
  await client.query('SAVEPOINT attempt');
  try {
    await client.query(sql);
    await client.query('RELEASE SAVEPOINT attempt');
    return null;
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT attempt');
    return err as Error;
  }
}

async function objectExists(client: Client, regprocedure: string): Promise<boolean> {
  const { rows } = await client.query('SELECT pg_catalog.to_regprocedure($1) IS NOT NULL AS e', [regprocedure]);
  return rows[0].e;
}

let client: Client;

beforeAll(async () => {
  client = new Client(dbConfig());
  await client.connect();
});

afterAll(async () => {
  await client.end();
});

/** BEGIN; search_path = public; fn(); ROLLBACK -- always rolled back. */
async function inRolledBackTransaction(fn: () => Promise<void>) {
  await client.query('BEGIN');
  try {
    await client.query('SET LOCAL search_path TO public');
    await fn();
  } finally {
    await client.query('ROLLBACK');
  }
}

/** Recreates the function exactly as migration 011 did. */
async function createFrom011() {
  await client.query(m011FunctionBlock());
  expect(await functionCount(client)).toBe(1);
}

describe('file layout and runner selection (no database writes)', () => {
  it('the forward migration is selected by the runner; the rollback file is not', () => {
    const files: string[] = getMigrationFiles(ADMIN_DIR);
    expect(files).toContain(FORWARD);
    expect(files).toContain(M011);
    expect(files).not.toContain(ROLLBACK);
    expect(files.indexOf(M011)).toBeLessThan(files.indexOf(FORWARD));
  });

  it('CI bootstrap uses the same "rollback" filename exclusion', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, '.github/scripts/ci-bootstrap-schema.js'), 'utf8');
    expect(src).toMatch(/file\.includes\('rollback'\)/);
  });

  it('forward migration: exact signature, no CASCADE, no transaction control of its own', () => {
    const code = FORWARD_SQL.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');
    expect(code).toContain('DROP FUNCTION IF EXISTS public.auto_detect_resource_ownership();');
    expect(code).toContain("to_regprocedure('public.auto_detect_resource_ownership()')");
    // Outside string literals: the HINT text itself says "Never use CASCADE".
    const statements = code.replace(/'(?:[^']|'')*'/g, "''");
    expect(statements).not.toMatch(/\bCASCADE\b/i);
    expect(statements).not.toMatch(/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im);
  });

  it('rollback file contains migration 011\'s function block byte-for-byte and warns it is unsafe', () => {
    const block = m011FunctionBlock();
    expect(block).toContain('CREATE OR REPLACE FUNCTION auto_detect_resource_ownership()');
    expect(ROLLBACK_SQL.split(block)).toHaveLength(2);
    expect(ROLLBACK_SQL).toMatch(/REINTRODUCES THE CROSS-TENANT OWNERSHIP-ASSIGNMENT\s+-- RISK/);
    expect(ROLLBACK_SQL).toMatch(/NEVER RUN IN NORMAL OPERATIONS/);
  });

  it('--execute-only refuses the rollback file as not found (isolated schema, nothing executed)', async () => {
    const schema = `drop_autodetect_runner_${process.pid}`;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drop-autodetect-'));
    fs.copyFileSync(path.join(ADMIN_DIR, FORWARD), path.join(tmp, FORWARD));
    fs.copyFileSync(path.join(ADMIN_DIR, ROLLBACK), path.join(tmp, ROLLBACK));
    const isolated = new Client(dbConfig());
    await isolated.connect();
    try {
      await isolated.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await isolated.query(`CREATE SCHEMA ${schema}`);
      await isolated.query(`SET search_path TO ${schema}`);
      const quiet = jest.spyOn(console, 'log').mockImplementation(() => undefined);
      const quietWarn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const quietErr = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        await expect(
          runMigrations({ client: isolated, migrationsDir: tmp, executeOnly: ROLLBACK })
        ).rejects.toThrow(/was not found/);
      } finally {
        quiet.mockRestore();
        quietWarn.mockRestore();
        quietErr.mockRestore();
      }
      const { rows } = await isolated.query('SELECT count(*)::int AS n FROM schema_migrations');
      expect(rows[0].n).toBe(0);
    } finally {
      await isolated.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await isolated.end();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('CI bootstrap result (database bootstrapped by ci-bootstrap-schema.js)', () => {
  it('applied migration 011 and then the forward migration, in that order', async () => {
    const { rows } = await client.query(
      'SELECT migration_name, id FROM schema_migrations WHERE migration_name = ANY($1) ORDER BY id',
      [[M011, FORWARD, ROLLBACK]]
    );
    expect(rows.map((r) => r.migration_name)).toEqual([M011, FORWARD]);
  });

  it('the function is absent from pg_proc after bootstrap', async () => {
    expect(await functionCount(client)).toBe(0);
  });
});

describe('forward migration behavior', () => {
  it('drops the function created by 011, and re-running is a no-op that leaves it absent', async () => {
    await inRolledBackTransaction(async () => {
      await createFrom011();
      await client.query(FORWARD_SQL);
      expect(await functionCount(client)).toBe(0);
      await client.query(FORWARD_SQL);
      expect(await functionCount(client)).toBe(0);
    });
  });

  it('succeeds when the function never existed (011 not applied)', async () => {
    await inRolledBackTransaction(async () => {
      await client.query('DROP FUNCTION IF EXISTS public.auto_detect_resource_ownership()');
      expect(await tryUnderSavepoint(client, FORWARD_SQL)).toBeNull();
      expect(await functionCount(client)).toBe(0);
    });
  });

  it('leaves same-named functions with a different signature or schema alone', async () => {
    await inRolledBackTransaction(async () => {
      await createFrom011();
      await client.query('CREATE FUNCTION public.auto_detect_resource_ownership(x int) RETURNS int LANGUAGE sql AS $f$ SELECT 1 $f$');
      await client.query('CREATE SCHEMA drop_autodetect_other');
      await client.query('CREATE FUNCTION drop_autodetect_other.auto_detect_resource_ownership() RETURNS int LANGUAGE sql AS $f$ SELECT 2 $f$');
      // The two decoys mention nothing in their source, so the guard passes.
      await client.query(FORWARD_SQL);
      expect(await functionCount(client)).toBe(0);
      expect(await objectExists(client, 'public.auto_detect_resource_ownership(integer)')).toBe(true);
      expect(await objectExists(client, 'drop_autodetect_other.auto_detect_resource_ownership()')).toBe(true);
    });
  });

  it('a pg_depend dependent stops the migration with a clear error, drops nothing, and the fixture-only cleanup lets it succeed', async () => {
    await inRolledBackTransaction(async () => {
      await createFrom011();
      // SQL-standard body: PostgreSQL records a normal (n) pg_depend row on the target.
      await client.query(`
        CREATE FUNCTION public.zz_drop_autodetect_dependent() RETURNS void
        LANGUAGE sql
        BEGIN ATOMIC
          SELECT public.auto_detect_resource_ownership();
        END
      `);

      const err = await tryUnderSavepoint(client, FORWARD_SQL);
      expect(err).not.toBeNull();
      expect(err!.message).toMatch(
        /^Refusing to drop public\.auto_detect_resource_ownership\(\): 1 dependent object\(s\) found: function zz_drop_autodetect_dependent\(\) \(deptype n\)$/
      );
      // Nothing cascaded: the function and its dependent both still exist.
      expect(await functionCount(client)).toBe(1);
      expect(await objectExists(client, 'public.zz_drop_autodetect_dependent()')).toBe(true);

      // Remove only the test fixture, then the migration proceeds normally.
      await client.query('DROP FUNCTION public.zz_drop_autodetect_dependent()');
      await client.query(FORWARD_SQL);
      expect(await functionCount(client)).toBe(0);
    });
  });

  it('a PL/pgSQL caller (not tracked in pg_depend) also stops the migration', async () => {
    await inRolledBackTransaction(async () => {
      await createFrom011();
      await client.query(`
        CREATE FUNCTION public.zz_drop_autodetect_caller() RETURNS void
        LANGUAGE plpgsql AS $f$ BEGIN PERFORM public.auto_detect_resource_ownership(); END $f$
      `);
      const err = await tryUnderSavepoint(client, FORWARD_SQL);
      expect(err!.message).toBe(
        'Refusing to drop public.auto_detect_resource_ownership(): 1 other function(s) mention it in their source: zz_drop_autodetect_caller()'
      );
      expect(await functionCount(client)).toBe(1);
      expect(await objectExists(client, 'public.zz_drop_autodetect_caller()')).toBe(true);
    });
  });

  it('a pg_cron-shaped job that calls it stops the migration (simulated cron.job table)', async () => {
    const { rows } = await client.query("SELECT to_regclass('cron.job') IS NOT NULL AS present");
    if (rows[0].present) {
      throw new Error('A real cron.job exists in this test database; refusing to simulate one alongside it');
    }
    await inRolledBackTransaction(async () => {
      await createFrom011();
      await client.query('CREATE SCHEMA cron');
      await client.query('CREATE TABLE cron.job (jobid bigint PRIMARY KEY, command text NOT NULL)');
      await client.query("INSERT INTO cron.job VALUES (7, 'SELECT 1'), (42, 'SELECT AUTO_DETECT_RESOURCE_OWNERSHIP();')");
      const err = await tryUnderSavepoint(client, FORWARD_SQL);
      expect(err!.message).toBe(
        'Refusing to drop public.auto_detect_resource_ownership(): 1 pg_cron job(s) call it (jobid 42)'
      );
      expect(await functionCount(client)).toBe(1);
    });
  });
});

describe('paired rollback file (manual-only)', () => {
  it('refuses to run without the explicit opt-in, and creates nothing', async () => {
    await inRolledBackTransaction(async () => {
      await client.query('DROP FUNCTION IF EXISTS public.auto_detect_resource_ownership()');
      const err = await tryUnderSavepoint(client, ROLLBACK_SQL);
      expect(err!.message).toMatch(/^Refusing to restore auto_detect_resource_ownership\(\): it reintroduces cross-tenant/);
      expect(await functionCount(client)).toBe(0);
    });
  });

  it('refuses to run outside the public schema even with the opt-in', async () => {
    await inRolledBackTransaction(async () => {
      await client.query(OPT_IN);
      await client.query('CREATE SCHEMA drop_autodetect_elsewhere');
      await client.query('SET LOCAL search_path TO drop_autodetect_elsewhere');
      const err = await tryUnderSavepoint(client, ROLLBACK_SQL);
      expect(err!.message).toMatch(/current schema is drop_autodetect_elsewhere, migration 011 created it in public/);
      expect(await objectExists(client, 'drop_autodetect_elsewhere.auto_detect_resource_ownership()')).toBe(false);
    });
  });

  it('restores a function catalog-identical to the one migration 011 creates', async () => {
    await inRolledBackTransaction(async () => {
      await client.query(OPT_IN);
      await client.query('DROP FUNCTION IF EXISTS public.auto_detect_resource_ownership()');
      await client.query(ROLLBACK_SQL);
      const restored = await functionIdentity(client);

      await client.query('DROP FUNCTION public.auto_detect_resource_ownership()');
      await createFrom011();
      const original = await functionIdentity(client);

      expect(restored).toEqual(original);
      expect(original).toMatchObject({
        lanname: 'plpgsql',
        provolatile: 'v',
        prosecdef: false,
        proconfig: null,
        rettype: 'void',
        comment: null,
      });
    });
  });
});
