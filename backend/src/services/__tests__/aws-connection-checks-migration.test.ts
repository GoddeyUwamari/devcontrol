/**
 * Admin migration 202611111200_create_aws_connection_checks (AWS connect PR D1a,
 * D1-D5): one new tenant table, postgres-owned, row level security enabled and
 * forced, one tenant policy, devcontrol SELECT/INSERT/UPDATE only (no DELETE:
 * C-b adds its own), and a composite foreign key to aws_accounts (id, org_id)
 * through a new unique index, so a row can never name another organization's
 * connection.
 *
 * Static: the shape of both files. Dynamic, in ONE rolled-back transaction on
 * the shared aws_accounts fixture: the paired rollback removes the
 * bootstrapped table, the migration re-creates it with the index and the
 * foreign key, the end state is checked, then as devcontrol (SET LOCAL ROLE,
 * tag set LOCAL): cross-organization rows are invisible, a row cannot be moved
 * to another organization, DELETE/TRUNCATE/ALTER fail, and the foreign key
 * refuses another organization's aws_account_id; a re-run is refused; the
 * rollback removes exactly its marked objects and refuses an unmarked table.
 * The production path (production-shaped aws_accounts, owner devcontrol
 * database) is rehearsed end to end by the founder scripts.
 *
 * Placeholders only.
 */
import { Client, Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { ensureSharedFixtureTable } from '../../routes/__tests__/shared-fixture-tables';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getMigrationFiles } = require('../../../../database/migrate.js');

const ADMIN_DIR = path.join(__dirname, '../../../../database/migrations-admin');
const MIGRATION_FILE = '202611111200_create_aws_connection_checks.sql';
const ROLLBACK_FILE = '202611111200_create_aws_connection_checks_rollback.sql';
const MIGRATION_SQL = fs.readFileSync(path.join(ADMIN_DIR, MIGRATION_FILE), 'utf8');
const ROLLBACK_SQL = fs.readFileSync(path.join(ADMIN_DIR, ROLLBACK_FILE), 'utf8');
const MARKER = '[202611111200_create_aws_connection_checks]';

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

describe('202611111200_create_aws_connection_checks: static shape', () => {
  const sql = statements(MIGRATION_SQL);
  const rollback = statements(ROLLBACK_SQL);

  it('starts with the 3 s lock timeout', () => {
    expect(sql.trim().startsWith("SET LOCAL lock_timeout = '3s';")).toBe(true);
    expect(rollback.trim().startsWith("SET LOCAL lock_timeout = '3s';")).toBe(true);
  });

  it('creates exactly one table and one index on aws_accounts; alters no existing column or row', () => {
    expect([...sql.matchAll(/\bCREATE TABLE\s+([\w.]+)/gi)].map((m) => m[1])).toEqual(['public.aws_connection_checks']);
    expect([...sql.matchAll(/CREATE UNIQUE INDEX (\w+) ON public\.aws_accounts \(id, org_id\)/g)].map((m) => m[1])).toEqual(['aws_accounts_id_org_uidx']);
    // Statements only (a statement starts a line); the self-check names TRUNCATE etc. inside has_table_privilege().
    expect(sql).not.toMatch(/^\s*(ALTER TABLE public\.aws_accounts|UPDATE\s|DELETE\s+FROM|DROP\s|TRUNCATE\s)/im);
  });

  it('row level security enabled and forced, one tenant policy keyed on organization_id', () => {
    expect(sql).toMatch(/ALTER TABLE public\.aws_connection_checks ENABLE ROW LEVEL SECURITY;/);
    expect(sql).toMatch(/ALTER TABLE public\.aws_connection_checks FORCE ROW LEVEL SECURITY;/);
    const policies = [...sql.matchAll(/CREATE POLICY (\w+) ON public\.aws_connection_checks FOR ALL\s+USING \(([^;]+)\)\s+WITH CHECK \(([^;]+)\);/g)];
    expect(policies.map((p) => p[1])).toEqual(['aws_connection_checks_tenant']);
    for (const expr of [policies[0][2], policies[0][3]]) {
      expect(expr).toBe("organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid");
    }
  });

  it('revokes everything, then grants exactly SELECT, INSERT, UPDATE to devcontrol (no DELETE: C-b adds it)', () => {
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.aws_connection_checks FROM PUBLIC, devcontrol;/);
    expect([...sql.matchAll(/GRANT ([A-Z, ]+) ON TABLE ([\w.]+) TO (\w+);/g)].map((m) => [m[1], m[2], m[3]]))
      .toEqual([['SELECT, INSERT, UPDATE', 'public.aws_connection_checks', 'devcontrol']]);
  });

  it('the composite foreign key to aws_accounts (id, org_id) cascades on delete', () => {
    expect(sql).toMatch(/FOREIGN KEY \(aws_account_id, organization_id\) REFERENCES public\.aws_accounts \(id, org_id\) ON DELETE CASCADE/);
  });

  it('stores no credential, External ID, role ARN, policy document or AWS message column', () => {
    const columns = [...sql.matchAll(/^\s{2}(\w+)\s+(UUID|TIMESTAMPTZ|VARCHAR|INTEGER|JSONB|SMALLINT)/gm)].map((m) => m[1]);
    expect(columns).toContain('role_unique_id');
    expect(columns.filter((c) => /external|arn|secret|credential|token|document|message|error/i.test(c))).toEqual([]);
  });

  it('the role unique ID CHECK is the documented RoleId shape (connection-health.ts ROLE_UNIQUE_ID_PATTERN)', () => {
    expect(sql).toMatch(/CHECK \(role_unique_id ~ '\^\[A-Za-z0-9_\]\{16,128\}\$'\)/);
  });

  it('marks its table and index, refuses to run twice or as a non-superuser, and verifies itself before commit', () => {
    const sql = MIGRATION_SQL; // the messages contain " -- ", which the comment-stripped form cuts
    expect(sql).toContain(`'${MARKER} One row per AWS connection`);
    expect(sql).toContain(`'${MARKER} The target of aws_connection_checks`);
    expect(sql).toMatch(/aws_connection_checks already exists -- this migration creates it and refuses to proceed/);
    expect(sql).toMatch(/current_setting\('is_superuser'\) <> 'on'/);
    expect(sql).toMatch(/aws_accounts\.id and aws_accounts\.org_id must both be uuid/);
    expect(sql).toMatch(/devcontrol does not have exactly SELECT, INSERT and UPDATE on aws_connection_checks -- refusing to commit/);
  });

  it('the rollback drops only marked objects, never with CASCADE, and deletes its ledger row', () => {
    expect(rollback).not.toMatch(/\bCASCADE\b/);
    expect(rollback).toContain(`marker CONSTANT TEXT := '${MARKER}'`);
    expect([...rollback.matchAll(/\bDROP (TABLE|INDEX) ([\w.]+);/g)].map((m) => `${m[1]} ${m[2]}`))
      .toEqual(['TABLE public.aws_connection_checks', 'INDEX public.aws_accounts_id_org_uidx']);
    expect(rollback).toMatch(/DELETE FROM schema_migrations\s+WHERE migration_name = '202611111200_create_aws_connection_checks\.sql';/);
  });

  it('is administrative: invisible to the ordinary path, after C-G, listed in the README, and its rollback is never selected', () => {
    expect(getMigrationFiles(path.join(__dirname, '../../../../database/migrations'))).not.toContain(MIGRATION_FILE);
    const adminFiles: string[] = getMigrationFiles(ADMIN_DIR);
    expect(adminFiles).toContain(MIGRATION_FILE);
    expect(adminFiles).not.toContain(ROLLBACK_FILE);
    expect(adminFiles.indexOf(MIGRATION_FILE)).toBeGreaterThan(adminFiles.indexOf('202611101200_transfer_tenant_table_ownership.sql'));
    expect(fs.readFileSync(path.join(ADMIN_DIR, 'README.md'), 'utf8')).toContain(`**\`${MIGRATION_FILE}\`**`);
  });
});

describe('202611111200_create_aws_connection_checks: applied, as devcontrol, re-run, rolled back', () => {
  const pool = new Pool(dbConfig());
  beforeAll(async () => {
    await ensureSharedFixtureTable(pool, 'aws_accounts');
  });
  afterAll(async () => {
    await pool.end();
  });

  it('end state, isolation, the composite foreign key, the re-run guard and the rollback', async () => {
    const client = new Client(dbConfig());
    await client.connect();
    const q = (text: string, values?: unknown[]) => client.query(text, values);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    /** The SQLSTATE of a statement that must fail, inside a savepoint. */
    const failure = async (text: string, values?: unknown[]) => {
      await q('SAVEPOINT f');
      try {
        await q(text, values);
        await q('RELEASE SAVEPOINT f');
        return 'allowed';
      } catch (error: any) {
        await q('ROLLBACK TO SAVEPOINT f');
        return error.code as string;
      }
    };
    try {
      await q('BEGIN');
      await q("SET LOCAL lock_timeout = '10s'");

      // The bootstrapped table goes first (the rollback, as the founder would run it).
      await q(ROLLBACK_SQL);
      expect((await q(`SELECT to_regclass('public.aws_connection_checks') AS t, to_regclass('public.aws_accounts_id_org_uidx') AS i`)).rows[0])
        .toEqual({ t: null, i: null });

      await q(MIGRATION_SQL);

      // End state.
      const state = (await q(`
        SELECT pg_get_userbyid(c.relowner) = current_user AS owned_by_runner, c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
               (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies,
               ARRAY(SELECT x FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) x
                      WHERE has_table_privilege('devcontrol', c.oid, x) ORDER BY x) AS devcontrol,
               (SELECT count(*)::int FROM aclexplode(c.relacl) a WHERE a.grantee = 0) AS public_grants,
               starts_with(obj_description(c.oid, 'pg_class'), $1) AS marked
          FROM pg_class c WHERE c.oid = 'public.aws_connection_checks'::regclass`, [MARKER])).rows[0];
      expect(state).toEqual({ owned_by_runner: true, rls: true, force: true, policies: 1, devcontrol: ['INSERT', 'SELECT', 'UPDATE'], public_grants: 0, marked: true });
      const fk = (await q(`SELECT confrelid::regclass::text AS ref, confdeltype AS del,
          (SELECT string_agg(attname, ',' ORDER BY k.ord) FROM unnest(conkey) WITH ORDINALITY k(attnum, ord) JOIN pg_attribute a ON a.attrelid = conrelid AND a.attnum = k.attnum) AS cols,
          (SELECT string_agg(attname, ',' ORDER BY k.ord) FROM unnest(confkey) WITH ORDINALITY k(attnum, ord) JOIN pg_attribute a ON a.attrelid = confrelid AND a.attnum = k.attnum) AS refcols
        FROM pg_constraint WHERE conname = 'aws_connection_checks_connection_fk'`)).rows;
      expect(fk).toEqual([{ ref: 'aws_accounts', del: 'c', cols: 'aws_account_id,organization_id', refcols: 'id,org_id' }]);
      expect((await q(`SELECT indexdef, starts_with(obj_description('public.aws_accounts_id_org_uidx'::regclass, 'pg_class'), $1) AS marked
                         FROM pg_indexes WHERE indexname = 'aws_accounts_id_org_uidx'`, [MARKER])).rows[0])
        .toEqual({ indexdef: expect.stringMatching(/CREATE UNIQUE INDEX aws_accounts_id_org_uidx ON public\.aws_accounts USING btree \(id, org_id\)/), marked: true });

      // Two organizations, one connection each.
      const org = async (label: string) => (await q(
        `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status) VALUES ($1, $1, $1, 'free', 'free') RETURNING id::text AS id`,
        [`d1-mig-${label}-${suffix}`])).rows[0].id as string;
      const orgA = await org('a');
      const orgB = await org('b');
      const connection = async (orgId: string, n: number) => (await q(
        `INSERT INTO aws_accounts (org_id, role_arn, account_id, external_id, region, status, connected_at)
         VALUES ($1, 'arn:aws:iam::123456789012:role/DevControlRole', $2, 'placeholder-external-id', 'us-east-1', 'active', NOW()) RETURNING id::text AS id`,
        [orgId, `ph-d1-${n}-${suffix}`.slice(0, 32)])).rows[0].id as string;
      const rowA = await connection(orgA, 1);
      const rowB = await connection(orgB, 2);
      const rowC = await connection(await org('c'), 3);
      await q(`INSERT INTO aws_connection_checks (aws_account_id, organization_id) VALUES ($1, $2)`, [rowB, orgB]);

      // As devcontrol, tagged for A (both LOCAL: they end with the transaction).
      await q(`SET LOCAL ROLE devcontrol`);
      await q(`SELECT set_config('app.current_organization_id', '', true)`);
      expect((await q(`SELECT count(*)::int AS n FROM aws_connection_checks WHERE organization_id = ANY($1)`, [[orgA, orgB]])).rows[0].n).toBe(0);
      await q(`SELECT set_config('app.current_organization_id', $1, true)`, [orgA]);
      expect(await failure(`INSERT INTO aws_connection_checks (aws_account_id, organization_id) VALUES ($1, $2)`, [rowA, orgA])).toBe('allowed');
      expect((await q(`SELECT organization_id::text AS org FROM aws_connection_checks`)).rows).toEqual([{ org: orgA }]);
      // Another organization's row: refused by the policy; another organization's connection under A: refused by the foreign key.
      expect(await failure(`INSERT INTO aws_connection_checks (aws_account_id, organization_id) VALUES (gen_random_uuid(), $1)`, [orgB])).toBe('42501');
      await q(`RESET ROLE`);
      await q(`DELETE FROM aws_connection_checks WHERE aws_account_id = $1`, [rowA]);
      await q(`SET LOCAL ROLE devcontrol`);
      await q(`SELECT set_config('app.current_organization_id', $1, true)`, [orgA]);
      expect(await failure(`INSERT INTO aws_connection_checks (aws_account_id, organization_id) VALUES ($1, $2)`, [rowB, orgA])).toBe('23505'); // B's row exists (PK)
      // Organization C's connection (no checks row yet) named under A: the composite foreign key refuses it.
      expect(await failure(`INSERT INTO aws_connection_checks (aws_account_id, organization_id) VALUES ($1, $2)`, [rowC, orgA])).toBe('23503');
      expect(await failure(`INSERT INTO aws_connection_checks (aws_account_id, organization_id) VALUES (gen_random_uuid(), $1)`, [orgA])).toBe('23503');
      await q(`INSERT INTO aws_connection_checks (aws_account_id, organization_id) VALUES ($1, $2)`, [rowA, orgA]);
      expect((await q(`UPDATE aws_connection_checks SET consecutive_role_failures = 0 WHERE organization_id = $1`, [orgB])).rowCount).toBe(0);
      expect(await failure(`UPDATE aws_connection_checks SET organization_id = $1 WHERE aws_account_id = $2`, [orgB, rowA])).toBe('42501');
      expect(await failure(`DELETE FROM aws_connection_checks WHERE aws_account_id = $1`, [rowA])).toBe('42501');
      expect(await failure(`TRUNCATE aws_connection_checks`)).toBe('42501');
      expect(await failure(`ALTER TABLE aws_connection_checks NO FORCE ROW LEVEL SECURITY`)).toBe('42501');
      expect(await failure(`ALTER TABLE aws_connection_checks DISABLE TRIGGER USER`)).toBe('42501');
      // The CHECKs: an unknown result and a role ID that is not the documented shape.
      expect(await failure(`UPDATE aws_connection_checks SET last_attempt_result = 'maybe' WHERE aws_account_id = $1`, [rowA])).toBe('23514');
      expect(await failure(`UPDATE aws_connection_checks SET role_unique_id = 'AROA-NOT:VALID' WHERE aws_account_id = $1`, [rowA])).toBe('23514');
      expect(await failure(`UPDATE aws_connection_checks SET health_state = 'ok' WHERE aws_account_id = $1`, [rowA])).toBe('23514'); // no conclusive time
      await q(`RESET ROLE`);

      // Deleting the connection deletes its checks row (ON DELETE CASCADE).
      await q(`DELETE FROM aws_accounts WHERE id = $1`, [rowA]);
      expect((await q(`SELECT count(*)::int AS n FROM aws_connection_checks WHERE aws_account_id = $1`, [rowA])).rows[0].n).toBe(0);

      // A re-run is refused.
      await q('SAVEPOINT rerun');
      await expect(q(MIGRATION_SQL)).rejects.toThrow(/aws_connection_checks already exists/);
      await q('ROLLBACK TO SAVEPOINT rerun');

      // The rollback removes the table, the index and the ledger row.
      await q(`INSERT INTO schema_migrations (migration_name, checksum) VALUES ($1, 'test') ON CONFLICT (migration_name) DO NOTHING`, [MIGRATION_FILE]);
      await q(ROLLBACK_SQL);
      expect((await q(`SELECT to_regclass('public.aws_connection_checks') AS t, to_regclass('public.aws_accounts_id_org_uidx') AS i,
                         (SELECT count(*)::int FROM schema_migrations WHERE migration_name = $1) AS ledger`, [MIGRATION_FILE])).rows[0])
        .toEqual({ t: null, i: null, ledger: 0 });
      // An unmarked table of that name is never dropped.
      await q(`CREATE TABLE public.aws_connection_checks (x int)`);
      await q('SAVEPOINT unmarked');
      await expect(q(ROLLBACK_SQL)).rejects.toThrow(/not created by the paired migration/);
      await q('ROLLBACK TO SAVEPOINT unmarked');
    } finally {
      await q('ROLLBACK').catch(() => undefined);
      await client.end();
    }
  });
});
