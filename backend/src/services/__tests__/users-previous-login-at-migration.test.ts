/**
 * Admin migration 202611121200_add_users_previous_login_at (Dashboard PR-UI-a,
 * DB-D8): one nullable timestamptz column on users, no default, no backfill,
 * marked; a paired rollback that drops only the marked column and its ledger
 * row.
 *
 * Static: the shape of both files, the admin classification and the CI schema
 * path (the bootstrap applies it). Dynamic, in ONE rolled-back transaction
 * that takes users' ACCESS EXCLUSIVE lock first: the rollback removes the
 * bootstrapped column and keeps every other column and row; the migration
 * re-adds it (existing rows NULL, last_login_at untouched); the end state is
 * checked; a re-run, a non-superuser run and a missing or wrongly typed
 * last_login_at are refused with nothing applied; the rollback refuses an
 * unmarked column. The production path is rehearsed end to end by the
 * founder scripts (ui-a-migrate/).
 *
 * Synthetic rows only.
 */
import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getMigrationFiles } = require('../../../../database/migrate.js');

const ROOT = path.join(__dirname, '../../../..');
const ADMIN_DIR = path.join(ROOT, 'database/migrations-admin');
const MIGRATION_FILE = '202611121200_add_users_previous_login_at.sql';
const ROLLBACK_FILE = '202611121200_add_users_previous_login_at_rollback.sql';
const MIGRATION_SQL = fs.readFileSync(path.join(ADMIN_DIR, MIGRATION_FILE), 'utf8');
const ROLLBACK_SQL = fs.readFileSync(path.join(ADMIN_DIR, ROLLBACK_FILE), 'utf8');
const MARKER = '[202611121200_add_users_previous_login_at]';
// Other suites hold short locks on users; the 3 s production lock timeout is
// asserted statically below and widened only for these runs.
const relaxed = (sql: string) => sql.replace("SET LOCAL lock_timeout = '3s';", "SET LOCAL lock_timeout = '60s';");

function dbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };
}

const statements = (sql: string) => sql.replace(/--[^\n]*/g, '');

describe('202611121200_add_users_previous_login_at: static shape', () => {
  const sql = statements(MIGRATION_SQL);
  const rollback = statements(ROLLBACK_SQL);

  it('starts with the 3 s lock timeout', () => {
    expect(sql.trim().startsWith("SET LOCAL lock_timeout = '3s';")).toBe(true);
    expect(rollback.trim().startsWith("SET LOCAL lock_timeout = '3s';")).toBe(true);
  });

  it('is additive: one nullable timestamptz column on users, no default, no backfill, nothing else altered', () => {
    expect([...sql.matchAll(/^\s*ALTER TABLE ([\w.]+) (.+);$/gim)].map((m) => [m[1], m[2]]))
      .toEqual([['public.users', 'ADD COLUMN previous_login_at TIMESTAMPTZ']]);
    // Statements only (a statement starts a line).
    expect(sql).not.toMatch(/^\s*(UPDATE\s|DELETE\s+FROM|INSERT\s+INTO|DROP\s|TRUNCATE\s|CREATE\s|GRANT\s|REVOKE\s)/im);
    // The one ALTER above carries no DEFAULT / NOT NULL; nothing sets either later.
    expect(sql).not.toMatch(/\bSET\s+DEFAULT\b|\bSET\s+NOT\s+NULL\b|\bSET\s+DATA\s+TYPE\b/i);
  });

  it('marks its column, refuses as a non-superuser, on a missing last_login_at and on a re-run, and verifies itself before commit', () => {
    const raw = MIGRATION_SQL; // the messages contain " -- ", which the comment-stripped form cuts
    expect(raw).toContain(`COMMENT ON COLUMN public.users.previous_login_at IS\n  '${MARKER} The sign-in before the latest one`);
    expect(raw).toMatch(/current_setting\('is_superuser'\) <> 'on'/);
    expect(raw).toMatch(/users\.last_login_at \(timestamptz\) does not exist -- refusing to proceed/);
    expect(raw).toMatch(/users\.previous_login_at already exists -- refusing to proceed/);
    expect(raw).toMatch(/is not a marked, nullable timestamptz without a default -- refusing to commit/);
  });

  it('the rollback checks the marker, drops only that column, deletes its ledger row and never uses CASCADE', () => {
    expect(rollback).not.toMatch(/\bCASCADE\b/i);
    expect(rollback).toContain(`marker CONSTANT TEXT := '${MARKER}'`);
    expect([...rollback.matchAll(/^\s*(ALTER TABLE|DROP)\s+(.+);$/gim)].map((m) => `${m[1]} ${m[2]}`))
      .toEqual(['ALTER TABLE public.users DROP COLUMN previous_login_at']);
    expect(rollback).toMatch(/DELETE FROM schema_migrations\s+WHERE migration_name = '202611121200_add_users_previous_login_at\.sql';/);
  });

  it('is administrative: invisible to the ordinary path, after D1a, listed in the README, and its rollback is never selected', () => {
    expect(getMigrationFiles(path.join(ROOT, 'database/migrations'))).not.toContain(MIGRATION_FILE);
    const adminFiles: string[] = getMigrationFiles(ADMIN_DIR);
    expect(adminFiles).toContain(MIGRATION_FILE);
    expect(adminFiles).not.toContain(ROLLBACK_FILE);
    expect(adminFiles.indexOf(MIGRATION_FILE)).toBeGreaterThan(adminFiles.indexOf('202611111200_create_aws_connection_checks.sql'));
    expect(fs.readFileSync(path.join(ADMIN_DIR, 'README.md'), 'utf8')).toContain(`**\`${MIGRATION_FILE}\`**`);
  });

  it('the CI schema bootstrap applies it (not excluded) and skips its rollback', () => {
    const bootstrap = fs.readFileSync(path.join(ROOT, '.github/scripts/ci-bootstrap-schema.js'), 'utf8');
    expect(bootstrap).toContain("path.join(__dirname, '..', '..', 'database', 'migrations-admin')");
    expect(bootstrap).toMatch(/file\.includes\('rollback'\)/);
    expect(bootstrap).not.toContain('202611121200');
  });
});

describe('202611121200_add_users_previous_login_at: applied (CI schema), rolled back, re-applied, refused', () => {
  it('the bootstrapped schema has the marked column and its ledger row', async () => {
    const client = new Client(dbConfig());
    await client.connect();
    try {
      const { rows } = await client.query(
        `SELECT format_type(atttypid, atttypmod) AS type, attnotnull AS not_null, atthasdef AS has_default,
                starts_with(col_description(attrelid, attnum), $1) AS marked,
                (SELECT count(*)::int FROM schema_migrations WHERE migration_name = $2) AS ledger
           FROM pg_attribute WHERE attrelid = 'public.users'::regclass AND attname = 'previous_login_at' AND NOT attisdropped`,
        [MARKER, MIGRATION_FILE]
      );
      expect(rows).toEqual([{ type: 'timestamp with time zone', not_null: false, has_default: false, marked: true, ledger: 1 }]);
    } finally {
      await client.end();
    }
  });

  it('rollback keeps every other column and row; apply re-adds it NULL; re-run, non-superuser and missing last_login_at refused; unmarked column kept', async () => {
    const client = new Client(dbConfig());
    await client.connect();
    const q = (text: string, values?: unknown[]) => client.query(text, values);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    /** The error message of a statement that must fail, inside a savepoint ('allowed' if it ran). */
    const failure = async (text: string) => {
      await q('SAVEPOINT f');
      try {
        await q(text);
        await q('RELEASE SAVEPOINT f');
        return 'allowed';
      } catch (error: any) {
        await q('ROLLBACK TO SAVEPOINT f');
        return String(error.message);
      }
    };
    const column = async () => (await q(
      `SELECT format_type(atttypid, atttypmod) AS type, attnotnull AS not_null, atthasdef AS has_default,
              starts_with(coalesce(col_description(attrelid, attnum), ''), $1) AS marked,
              has_column_privilege('devcontrol', attrelid, attnum, 'SELECT') AND has_column_privilege('devcontrol', attrelid, attnum, 'UPDATE') AS app_reaches
         FROM pg_attribute WHERE attrelid = 'public.users'::regclass AND attname = 'previous_login_at' AND NOT attisdropped`,
      [MARKER])).rows;
    const otherColumns = async () => (await q(
      `SELECT string_agg(attname || ':' || format_type(atttypid, atttypmod) || ':' || attnotnull || ':' || atthasdef, ',' ORDER BY attname) AS cols
         FROM pg_attribute WHERE attrelid = 'public.users'::regclass AND attnum > 0 AND NOT attisdropped AND attname <> 'previous_login_at'`)).rows[0].cols;
    const ledger = async () => (await q(`SELECT count(*)::int AS n FROM schema_migrations WHERE migration_name = $1`, [MIGRATION_FILE])).rows[0].n;
    try {
      await q('BEGIN');
      await q("SET LOCAL lock_timeout = '60s'");
      // Take the lock the DDL needs first, so no lock upgrade can deadlock with another suite.
      await q('LOCK TABLE public.users IN ACCESS EXCLUSIVE MODE');
      // Production's shape: the application role holds table-level SELECT and UPDATE on users
      // (the CI schema grants it nothing there). Rolled back with everything else.
      await q('GRANT SELECT, UPDATE ON public.users TO devcontrol');

      const { rows: [user] } = await q(
        `INSERT INTO users (email, password_hash, full_name, last_login_at, previous_login_at)
         VALUES ($1, 'x', 'Prev Login Migration', '2026-11-01T09:00:00.5Z', '2026-10-30T07:00:00Z') RETURNING id`,
        [`prev-login-mig-${suffix}@example.com`]
      );
      const rowsBefore = (await q('SELECT count(*)::int AS n FROM users')).rows[0].n;
      const othersBefore = await otherColumns();
      expect(await ledger()).toBe(1);

      // The rollback, as the founder would run it.
      await q(relaxed(ROLLBACK_SQL));
      expect(await column()).toEqual([]);
      expect(await ledger()).toBe(0);
      expect(await otherColumns()).toBe(othersBefore);
      expect((await q('SELECT count(*)::int AS n FROM users')).rows[0].n).toBe(rowsBefore);
      expect((await q(`SELECT (last_login_at AT TIME ZONE 'UTC')::text AS last FROM users WHERE id = $1`, [user.id])).rows[0].last)
        .toBe('2026-11-01 09:00:00.5');

      // Missing or wrongly typed last_login_at: refused, nothing applied.
      await q('SAVEPOINT shape');
      await q('ALTER TABLE public.users RENAME COLUMN last_login_at TO last_login_at_moved');
      expect(await failure(relaxed(MIGRATION_SQL))).toMatch(/users\.last_login_at \(timestamptz\) does not exist/);
      await q('ALTER TABLE public.users ADD COLUMN last_login_at timestamp');
      expect(await failure(relaxed(MIGRATION_SQL))).toMatch(/users\.last_login_at \(timestamptz\) does not exist/);
      expect(await column()).toEqual([]);
      await q('ROLLBACK TO SAVEPOINT shape');

      // As the application role: refused, nothing applied.
      await q('SAVEPOINT asapp');
      await q('SET LOCAL ROLE devcontrol');
      expect(await failure(relaxed(MIGRATION_SQL))).toMatch(/run as a superuser \(postgres\)/);
      await q('ROLLBACK TO SAVEPOINT asapp');
      expect(await column()).toEqual([]);

      // Apply.
      await q(relaxed(MIGRATION_SQL));
      expect(await column()).toEqual([{ type: 'timestamp with time zone', not_null: false, has_default: false, marked: true, app_reaches: true }]);
      expect(await otherColumns()).toBe(othersBefore);
      expect((await q('SELECT count(*)::int AS n FROM users')).rows[0].n).toBe(rowsBefore);
      // Existing rows read NULL (no backfill); last_login_at is untouched.
      expect((await q(`SELECT (last_login_at AT TIME ZONE 'UTC')::text AS last, previous_login_at AS previous FROM users WHERE id = $1`, [user.id])).rows[0])
        .toEqual({ last: '2026-11-01 09:00:00.5', previous: null });
      expect((await q('SELECT count(*)::int AS n FROM users WHERE previous_login_at IS NOT NULL')).rows[0].n).toBe(0);
      // The sign-in UPDATE as both paths now run it: the right-hand side reads the old row.
      await q('UPDATE users SET previous_login_at = last_login_at, last_login_at = NOW() WHERE id = $1', [user.id]);
      expect((await q(`SELECT (previous_login_at AT TIME ZONE 'UTC')::text AS previous, last_login_at = NOW() AS now FROM users WHERE id = $1`, [user.id])).rows[0])
        .toEqual({ previous: '2026-11-01 09:00:00.5', now: true });

      // A re-run is refused.
      expect(await failure(relaxed(MIGRATION_SQL))).toMatch(/users\.previous_login_at already exists/);

      // The rollback refuses a column that the migration did not create (no marker), and keeps it.
      await q(`INSERT INTO schema_migrations (migration_name, checksum) VALUES ($1, 'test') ON CONFLICT (migration_name) DO NOTHING`, [MIGRATION_FILE]);
      await q(`COMMENT ON COLUMN public.users.previous_login_at IS 'something else'`);
      expect(await failure(relaxed(ROLLBACK_SQL))).toMatch(/previous_login_at is absent or was not created by the paired migration/);
      expect(await column()).toHaveLength(1);
      expect(await ledger()).toBe(1);
    } finally {
      await q('ROLLBACK').catch(() => undefined);
      await client.end();
    }
  });
});
