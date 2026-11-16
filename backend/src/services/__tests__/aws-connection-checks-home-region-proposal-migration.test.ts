/**
 * Admin migration 202611161200_add_aws_connection_checks_home_region_proposal
 * (home region HR-0): four nullable columns on aws_connection_checks with no
 * default and no backfill, three named CHECK constraints, all marked; a paired
 * rollback that drops only the marked objects and the ledger row.
 *
 * Static: the shape of both files, the admin classification and the CI schema
 * path (the bootstrap applies it). Dynamic, in ONE rolled-back transaction that
 * takes the table's ACCESS EXCLUSIVE lock first: the rollback removes the
 * bootstrapped objects and keeps every other column and row; the migration
 * re-adds them (existing rows NULL); the constraints accept every valid state
 * and refuse the invalid ones, as the application role under row level
 * security; a re-run, a non-superuser run, a missing table and a table owned by
 * another role are refused with nothing applied; the rollback refuses unless
 * every marker is there. The production path is rehearsed end to end by the
 * founder scripts (hr0-migrate/).
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
const MIGRATION_FILE = '202611161200_add_aws_connection_checks_home_region_proposal.sql';
const ROLLBACK_FILE = '202611161200_add_aws_connection_checks_home_region_proposal_rollback.sql';
const MIGRATION_SQL = fs.readFileSync(path.join(ADMIN_DIR, MIGRATION_FILE), 'utf8');
const ROLLBACK_SQL = fs.readFileSync(path.join(ADMIN_DIR, ROLLBACK_FILE), 'utf8');
const MARKER = '[202611161200_add_aws_connection_checks_home_region_proposal]';
const COLUMNS = ['home_region_decided_at', 'home_region_proposal', 'home_region_proposal_state', 'home_region_proposed_at'];
const CONSTRAINTS = [
  'aws_connection_checks_home_region_proposal_complete',
  'aws_connection_checks_home_region_proposal_object',
  'aws_connection_checks_home_region_proposal_state',
];
// Other suites write aws_connection_checks; the 3 s production lock timeout is
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

describe('202611161200_add_aws_connection_checks_home_region_proposal: static shape', () => {
  const sql = statements(MIGRATION_SQL);
  const rollback = statements(ROLLBACK_SQL);

  it('starts with the 3 s lock timeout', () => {
    expect(sql.trim().startsWith("SET LOCAL lock_timeout = '3s';")).toBe(true);
    expect(rollback.trim().startsWith("SET LOCAL lock_timeout = '3s';")).toBe(true);
  });

  it('is additive: one ALTER TABLE on aws_connection_checks adding four nullable columns and three CHECKs, nothing else', () => {
    const alters = [...sql.matchAll(/^\s*ALTER TABLE ([\w.]+)\s*\n([\s\S]*?);\s*$/gim)];
    expect(alters.map((m) => m[1])).toEqual(['public.aws_connection_checks']);
    const body = alters[0][2];
    expect([...body.matchAll(/ADD COLUMN (\w+) ([A-Z0-9()]+)/g)].map((m) => `${m[1]} ${m[2]}`)).toEqual([
      'home_region_proposal JSONB',
      'home_region_proposal_state VARCHAR(16)',
      'home_region_proposed_at TIMESTAMPTZ',
      'home_region_decided_at TIMESTAMPTZ',
    ]);
    expect([...body.matchAll(/ADD CONSTRAINT (\w+)\s+CHECK/g)].map((m) => m[1]).sort()).toEqual(CONSTRAINTS);
    // Each column exactly: its type and nothing after it (no NOT NULL, no DEFAULT).
    expect([...body.matchAll(/^\s*ADD COLUMN .*$/gm)].map((m) => m[0].trim())).toEqual([
      'ADD COLUMN home_region_proposal JSONB,',
      'ADD COLUMN home_region_proposal_state VARCHAR(16),',
      'ADD COLUMN home_region_proposed_at TIMESTAMPTZ,',
      'ADD COLUMN home_region_decided_at TIMESTAMPTZ,',
    ]);
    expect(body).not.toMatch(/\bDEFAULT\b|\bDROP\b|\bRENAME\b|\bTYPE\b/i);
    // Statements only (a statement starts a line).
    expect(sql).not.toMatch(/^\s*(UPDATE\s|DELETE\s+FROM|INSERT\s+INTO|DROP\s|TRUNCATE\s|CREATE\s|GRANT\s|REVOKE\s)/im);
  });

  it('marks every object, refuses as a non-superuser, on a missing or foreign-owned table and on a re-run, and verifies itself before commit', () => {
    const raw = MIGRATION_SQL;
    for (const column of COLUMNS) expect(raw).toContain(`COMMENT ON COLUMN public.aws_connection_checks.${column} IS\n  '${MARKER} `);
    for (const constraint of CONSTRAINTS) expect(raw).toContain(`COMMENT ON CONSTRAINT ${constraint} ON public.aws_connection_checks IS\n  '${MARKER} `);
    expect(raw).toMatch(/current_setting\('is_superuser'\) <> 'on'/);
    expect(raw).toMatch(/aws_connection_checks does not exist \(apply 202611111200_create_aws_connection_checks\.sql first\) -- refusing to proceed/);
    expect(raw).toMatch(/aws_connection_checks is not owned by the role running this migration -- refusing to proceed/);
    expect(raw).toMatch(/a home_region_\* column already exists on aws_connection_checks -- refusing to proceed/);
    expect(raw).toMatch(/a home-region proposal constraint already exists on aws_connection_checks -- refusing to proceed/);
    expect(raw).toMatch(/are not marked, nullable, of the expected types and without a default -- refusing to commit/);
    expect(raw).toMatch(/constraints are not marked and validated -- refusing to commit/);
    expect(raw).toMatch(/row level security is no longer enabled and forced on aws_connection_checks -- refusing to commit/);
    expect(raw).toMatch(/devcontrol cannot SELECT, INSERT and UPDATE every new column of aws_connection_checks -- refusing to commit/);
  });

  it('the rollback checks every marker, drops only those objects, deletes its ledger row and never uses CASCADE', () => {
    expect(rollback).not.toMatch(/\bCASCADE\b/i);
    expect(rollback).toContain(`marker CONSTANT TEXT := '${MARKER}'`);
    const alters = [...rollback.matchAll(/^\s*ALTER TABLE ([\w.]+)\s*\n([\s\S]*?);\s*$/gim)];
    expect(alters.map((m) => m[1])).toEqual(['public.aws_connection_checks']);
    expect([...alters[0][2].matchAll(/DROP CONSTRAINT (\w+)/g)].map((m) => m[1]).sort()).toEqual(CONSTRAINTS);
    expect([...alters[0][2].matchAll(/DROP COLUMN (\w+)/g)].map((m) => m[1]).sort()).toEqual(COLUMNS);
    expect(rollback).toMatch(/DELETE FROM schema_migrations\s+WHERE migration_name = '202611161200_add_aws_connection_checks_home_region_proposal\.sql';/);
    expect(rollback).not.toMatch(/^\s*(UPDATE\s|INSERT\s+INTO|TRUNCATE\s|CREATE\s|GRANT\s|REVOKE\s|DROP\s+TABLE)/im);
  });

  it('is administrative: invisible to the ordinary path, after D1a and PR-UI-a, listed in the README, and its rollback is never selected', () => {
    expect(getMigrationFiles(path.join(ROOT, 'database/migrations'))).not.toContain(MIGRATION_FILE);
    const adminFiles: string[] = getMigrationFiles(ADMIN_DIR);
    expect(adminFiles).toContain(MIGRATION_FILE);
    expect(adminFiles).not.toContain(ROLLBACK_FILE);
    expect(adminFiles.indexOf(MIGRATION_FILE)).toBeGreaterThan(adminFiles.indexOf('202611111200_create_aws_connection_checks.sql'));
    expect(adminFiles.indexOf(MIGRATION_FILE)).toBeGreaterThan(adminFiles.indexOf('202611121200_add_users_previous_login_at.sql'));
    const readme = fs.readFileSync(path.join(ADMIN_DIR, 'README.md'), 'utf8');
    expect(readme).toContain(`**\`${MIGRATION_FILE}\`**`);
    expect(readme).toContain(`## Classification -- \`${MIGRATION_FILE}\``);
  });

  it('the CI schema bootstrap applies it (not excluded) and skips its rollback', () => {
    const bootstrap = fs.readFileSync(path.join(ROOT, '.github/scripts/ci-bootstrap-schema.js'), 'utf8');
    expect(bootstrap).toContain("path.join(__dirname, '..', '..', 'database', 'migrations-admin')");
    expect(bootstrap).toMatch(/file\.includes\('rollback'\)/);
    expect(bootstrap).not.toContain('202611161200');
  });
});

describe('202611161200_add_aws_connection_checks_home_region_proposal: applied (CI schema), rolled back, re-applied, refused', () => {
  it('the bootstrapped schema has the four marked columns, the three marked constraints and the ledger row', async () => {
    const client = new Client(dbConfig());
    await client.connect();
    try {
      const columns = (await client.query(
        `SELECT attname AS name, format_type(atttypid, atttypmod) AS type, attnotnull AS not_null, atthasdef AS has_default,
                starts_with(coalesce(col_description(attrelid, attnum), ''), $1) AS marked
           FROM pg_attribute WHERE attrelid = 'public.aws_connection_checks'::regclass AND attname LIKE 'home\\_region\\_%' AND NOT attisdropped
          ORDER BY attname`,
        [MARKER]
      )).rows;
      expect(columns).toEqual([
        { name: 'home_region_decided_at', type: 'timestamp with time zone', not_null: false, has_default: false, marked: true },
        { name: 'home_region_proposal', type: 'jsonb', not_null: false, has_default: false, marked: true },
        { name: 'home_region_proposal_state', type: 'character varying(16)', not_null: false, has_default: false, marked: true },
        { name: 'home_region_proposed_at', type: 'timestamp with time zone', not_null: false, has_default: false, marked: true },
      ]);
      const constraints = (await client.query(
        `SELECT conname AS name, convalidated AS valid, starts_with(coalesce(obj_description(oid, 'pg_constraint'), ''), $1) AS marked
           FROM pg_constraint WHERE conrelid = 'public.aws_connection_checks'::regclass AND conname LIKE '%home\\_region%' ORDER BY conname`,
        [MARKER]
      )).rows;
      expect(constraints).toEqual(CONSTRAINTS.map((name) => ({ name, valid: true, marked: true })));
      expect((await client.query(`SELECT count(*)::int AS n FROM schema_migrations WHERE migration_name = $1`, [MIGRATION_FILE])).rows[0].n).toBe(1);
    } finally {
      await client.end();
    }
  });

  it('rollback keeps every other column and row; apply re-adds them NULL; the constraints hold for the application; refusals change nothing', async () => {
    const client = new Client(dbConfig());
    await client.connect();
    const q = (text: string, values?: unknown[]) => client.query(text, values);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    /** The error message (or SQLSTATE-tagged message) of a statement that must fail, inside a savepoint ('allowed' if it ran). */
    const failure = async (text: string, values?: unknown[]) => {
      await q('SAVEPOINT f');
      try {
        await q(text, values);
        await q('RELEASE SAVEPOINT f');
        return 'allowed';
      } catch (error: any) {
        await q('ROLLBACK TO SAVEPOINT f');
        return `${error.code}: ${String(error.message)}`;
      }
    };
    const newColumns = async () => (await q(
      `SELECT count(*)::int AS n FROM pg_attribute
        WHERE attrelid = 'public.aws_connection_checks'::regclass AND attname LIKE 'home\\_region\\_%' AND NOT attisdropped`)).rows[0].n;
    const newConstraints = async () => (await q(
      `SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid = 'public.aws_connection_checks'::regclass AND conname LIKE '%home\\_region%'`)).rows[0].n;
    const otherShape = async () => (await q(
      `SELECT (SELECT string_agg(attname || ':' || format_type(atttypid, atttypmod) || ':' || attnotnull || ':' || atthasdef, ',' ORDER BY attname)
                 FROM pg_attribute WHERE attrelid = 'public.aws_connection_checks'::regclass AND attnum > 0 AND NOT attisdropped AND attname NOT LIKE 'home\\_region\\_%')
           || '|' || (SELECT string_agg(conname || ':' || pg_get_constraintdef(oid), ',' ORDER BY conname)
                 FROM pg_constraint WHERE conrelid = 'public.aws_connection_checks'::regclass AND conname NOT LIKE '%home\\_region%')
           || '|' || (SELECT relrowsecurity::text || relforcerowsecurity::text || pg_get_userbyid(relowner) || coalesce(relacl::text, '')
                 FROM pg_class WHERE oid = 'public.aws_connection_checks'::regclass) AS shape`)).rows[0].shape;
    const ledger = async () => (await q(`SELECT count(*)::int AS n FROM schema_migrations WHERE migration_name = $1`, [MIGRATION_FILE])).rows[0].n;
    try {
      await q('BEGIN');
      await q("SET LOCAL lock_timeout = '60s'");
      // Take the lock the DDL needs first, so no lock upgrade can deadlock with another suite.
      await q('LOCK TABLE public.aws_connection_checks IN ACCESS EXCLUSIVE MODE');

      const { rows: [org] } = await q(
        `INSERT INTO organizations (name, slug, display_name) VALUES ($1, $1, 'HR-0 migration') RETURNING id`, [`hr0-mig-${suffix}`]);
      const { rows: [row] } = await q(
        `INSERT INTO aws_connection_checks (aws_account_id, organization_id, last_attempt_at, last_attempt_result, consecutive_role_failures)
         VALUES (gen_random_uuid(), $1, '2026-11-01T09:00:00Z', 'ok', 0) RETURNING aws_account_id`, [org.id]);
      const rowsBefore = (await q('SELECT count(*)::int AS n FROM aws_connection_checks')).rows[0].n;
      const shapeBefore = await otherShape();
      expect(await ledger()).toBe(1);

      // The rollback, as the founder would run it.
      await q(relaxed(ROLLBACK_SQL));
      expect(await newColumns()).toBe(0);
      expect(await newConstraints()).toBe(0);
      expect(await ledger()).toBe(0);
      expect(await otherShape()).toBe(shapeBefore);
      expect((await q('SELECT count(*)::int AS n FROM aws_connection_checks')).rows[0].n).toBe(rowsBefore);
      expect((await q(`SELECT last_attempt_result FROM aws_connection_checks WHERE aws_account_id = $1`, [row.aws_account_id])).rows[0])
        .toEqual({ last_attempt_result: 'ok' });

      // As the application role: refused, nothing applied.
      await q('SAVEPOINT asapp');
      await q('SET LOCAL ROLE devcontrol');
      expect(await failure(relaxed(MIGRATION_SQL))).toMatch(/run as a superuser \(postgres\)/);
      await q('ROLLBACK TO SAVEPOINT asapp');
      expect(await newColumns()).toBe(0);

      // A table owned by another role, or no table at all: refused, nothing applied.
      await q('SAVEPOINT shape');
      await q('ALTER TABLE public.aws_connection_checks OWNER TO devcontrol');
      expect(await failure(relaxed(MIGRATION_SQL))).toMatch(/aws_connection_checks is not owned by the role running this migration/);
      await q('ROLLBACK TO SAVEPOINT shape');
      await q('SAVEPOINT shape');
      await q('ALTER TABLE public.aws_connection_checks RENAME TO aws_connection_checks_moved');
      expect(await failure(relaxed(MIGRATION_SQL))).toMatch(/aws_connection_checks does not exist/);
      await q('ROLLBACK TO SAVEPOINT shape');
      expect(await newColumns()).toBe(0);

      // Apply.
      await q(relaxed(MIGRATION_SQL));
      expect(await newColumns()).toBe(4);
      expect(await newConstraints()).toBe(3);
      expect(await otherShape()).toBe(shapeBefore);
      expect((await q('SELECT count(*)::int AS n FROM aws_connection_checks')).rows[0].n).toBe(rowsBefore);
      // Existing rows read NULL: never proposed (no backfill).
      expect((await q(
        `SELECT count(*)::int AS n FROM aws_connection_checks
          WHERE home_region_proposal IS NOT NULL OR home_region_proposal_state IS NOT NULL OR home_region_proposed_at IS NOT NULL OR home_region_decided_at IS NOT NULL`)).rows[0].n).toBe(0);

      // The constraints, as the application role under row level security (tagged for the row's organization).
      await q('SAVEPOINT app');
      await q('SET LOCAL ROLE devcontrol');
      await q(`SELECT set_config('app.current_organization_id', $1, true)`, [org.id]);
      const set = (assignments: string, values: unknown[] = []) =>
        failure(`UPDATE aws_connection_checks SET ${assignments} WHERE aws_account_id = $1`, [row.aws_account_id, ...values]);
      const proposal = JSON.stringify({ region: 'us-west-2', current: 'us-east-1', shares: [] });
      // Valid states.
      expect(await set(`home_region_proposal_state = 'no_signal', home_region_proposed_at = now()`)).toBe('allowed');
      expect(await set(`home_region_proposal_state = 'unavailable', home_region_proposed_at = now()`)).toBe('allowed');
      expect(await set(`home_region_proposal_state = 'proposed', home_region_proposed_at = now(), home_region_proposal = $2::jsonb`, [proposal])).toBe('allowed');
      expect(await set(`home_region_proposal_state = 'accepted', home_region_decided_at = now()`)).toBe('allowed');
      expect(await set(`home_region_proposal_state = 'superseded'`)).toBe('allowed');
      expect(await set(`home_region_proposal_state = 'dismissed'`)).toBe('allowed');
      expect(await set(`home_region_proposal_state = 'proposed', home_region_decided_at = NULL`)).toBe('allowed');
      // Split spend: an open prompt, with its evidence, no decision time.
      expect(await set(`home_region_proposal_state = 'split'`)).toBe('allowed');
      expect(await set(`home_region_decided_at = now()`)).toMatch(/^23514: .*aws_connection_checks_home_region_proposal_complete/);
      expect(await set(`home_region_proposal = NULL`)).toMatch(/^23514: .*aws_connection_checks_home_region_proposal_complete/);
      expect(await set(`home_region_proposal_state = 'proposed'`)).toBe('allowed');
      // Invalid ones.
      expect(await set(`home_region_proposal_state = 'bogus'`)).toMatch(/^23514: .*aws_connection_checks_home_region_proposal_state/);
      expect(await set(`home_region_proposed_at = NULL`)).toMatch(/^23514: .*aws_connection_checks_home_region_proposal_complete/);
      expect(await set(`home_region_proposal = NULL`)).toMatch(/^23514: .*aws_connection_checks_home_region_proposal_complete/);
      expect(await set(`home_region_proposal_state = 'accepted'`)).toMatch(/^23514: .*aws_connection_checks_home_region_proposal_complete/);
      expect(await set(`home_region_decided_at = now()`)).toMatch(/^23514: .*aws_connection_checks_home_region_proposal_complete/);
      expect(await set(`home_region_proposal = '[]'::jsonb`)).toMatch(/^23514: .*aws_connection_checks_home_region_proposal_object/);
      expect(await set(`home_region_proposal_state = NULL, home_region_proposal = NULL`)).toMatch(/^23514: .*aws_connection_checks_home_region_proposal_complete/);
      expect(await set(`home_region_proposal_state = NULL, home_region_proposal = NULL, home_region_proposed_at = NULL`)).toBe('allowed');
      await q('ROLLBACK TO SAVEPOINT app');

      // A re-run is refused.
      expect(await failure(relaxed(MIGRATION_SQL))).toMatch(/a home_region_\* column already exists on aws_connection_checks/);

      // The rollback refuses unless every object carries the marker, and keeps them all.
      await q(`INSERT INTO schema_migrations (migration_name, checksum) VALUES ($1, 'test') ON CONFLICT (migration_name) DO NOTHING`, [MIGRATION_FILE]);
      await q('SAVEPOINT marks');
      await q(`COMMENT ON COLUMN public.aws_connection_checks.home_region_decided_at IS 'something else'`);
      expect(await failure(relaxed(ROLLBACK_SQL))).toMatch(/home_region_\* columns are absent or were not all created by the paired migration/);
      await q('ROLLBACK TO SAVEPOINT marks');
      await q(`COMMENT ON CONSTRAINT aws_connection_checks_home_region_proposal_object ON public.aws_connection_checks IS 'something else'`);
      expect(await failure(relaxed(ROLLBACK_SQL))).toMatch(/proposal constraints are absent or were not all created by the paired migration/);
      expect(await newColumns()).toBe(4);
      expect(await newConstraints()).toBe(3);
      expect(await ledger()).toBe(1);
    } finally {
      await q('ROLLBACK').catch(() => undefined);
      await client.end();
    }
  });
});
