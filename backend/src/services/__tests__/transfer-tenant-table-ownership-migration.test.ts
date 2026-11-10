/**
 * Admin migration 202611101200_transfer_tenant_table_ownership (AWS connect C-G):
 * postgres owns the nine row-level-security tenant tables devcontrol created,
 * row level security is forced on them, devcontrol keeps exactly the
 * privileges the application uses, and refunds' trigger function is
 * postgres-owned. The end state and the behaviour as devcontrol are covered by
 * tenant-table-ownership.test.ts (T-OWN); this file covers the migration's
 * shape, its guard and its recorded prior state. The exact restore by the
 * paired rollback (tables owned by devcontrol before) is rehearsed end to end
 * on dedicated scratch databases by the founder scripts.
 */
import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getMigrationFiles } = require('../../../../database/migrate.js');

const ADMIN_DIR = path.join(__dirname, '../../../../database/migrations-admin');
const MIGRATION_FILE = '202611101200_transfer_tenant_table_ownership.sql';
const ROLLBACK_FILE = '202611101200_transfer_tenant_table_ownership_rollback.sql';
const MIGRATION_SQL = fs.readFileSync(path.join(ADMIN_DIR, MIGRATION_FILE), 'utf8');
const ROLLBACK_SQL = fs.readFileSync(path.join(ADMIN_DIR, ROLLBACK_FILE), 'utf8');
const NINE = [
  'security_hub_findings', 'organization_security_hub_state', 'soc2_evidence_observations', 'soc2_control_evaluations',
  'cost_analysis_runs', 'customer_evidence', 'organization_optimization_rule_configs', 'refunds', 'slo_definitions',
];
const WITH_DELETE = ['soc2_evidence_observations', 'organization_optimization_rule_configs', 'slo_definitions'];

function dbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };
}

/** The SQL with comments removed, for static checks. */
const statements = (sql: string) => sql.replace(/--[^\n]*/g, '');
const tableList = (s: string) => s.split(',').map((x) => x.trim().replace(/^public\./, '')).sort();

describe('202611101200_transfer_tenant_table_ownership: static shape', () => {
  const sql = statements(MIGRATION_SQL);

  it('starts with the 3 s lock timeout', () => {
    expect(sql.trim().startsWith("SET LOCAL lock_timeout = '3s';")).toBe(true);
  });

  it('transfers exactly the nine tables to postgres and forces row level security on each', () => {
    expect([...sql.matchAll(/ALTER TABLE public\.(\w+)\s+OWNER TO postgres;/g)].map((m) => m[1]).filter((t) => t !== 'admin_migration_prior_state').sort()).toEqual([...NINE].sort());
    expect([...sql.matchAll(/ALTER TABLE public\.(\w+)\s+FORCE ROW LEVEL SECURITY;/g)].map((m) => m[1]).sort()).toEqual([...NINE].sort());
    expect(sql).not.toMatch(/NO FORCE|DISABLE ROW LEVEL SECURITY|ALTER TABLE public\.organizations\b/);
  });

  it('revokes everything from PUBLIC and devcontrol on the nine, then grants exactly SELECT/INSERT/UPDATE (+ DELETE where used)', () => {
    const revoke = sql.match(/REVOKE ALL ON TABLE ([^;]*?) FROM PUBLIC, devcontrol;/);
    expect(revoke && tableList(revoke[1])).toEqual([...NINE].sort());
    const grants = [...sql.matchAll(/GRANT ([A-Z, ]+) ON TABLE ([^;]*?) TO devcontrol;/g)].map((m) => ({ privileges: m[1].trim(), tables: tableList(m[2]) }));
    expect(grants).toEqual([
      { privileges: 'SELECT, INSERT, UPDATE', tables: NINE.filter((t) => !WITH_DELETE.includes(t)).sort() },
      { privileges: 'SELECT, INSERT, UPDATE, DELETE', tables: [...WITH_DELETE].sort() },
    ]);
    expect(sql).not.toMatch(/GRANT[^;]*\b(ALL|TRUNCATE|REFERENCES|TRIGGER)\b/i);
  });

  it('makes refunds\' trigger function postgres-owned and changes no other object', () => {
    expect(sql).toMatch(/ALTER FUNCTION public\.update_refunds_updated_at\(\) OWNER TO postgres;/);
    expect(sql.match(/ALTER FUNCTION/g)).toHaveLength(1);
    expect(sql).not.toMatch(/\b(DROP\s|DELETE\s+FROM|TRUNCATE\s|CREATE\s+(OR\s+REPLACE\s+)?(FUNCTION|POLICY|TRIGGER|INDEX)|ALTER\s+DATABASE|ALTER\s+SCHEMA)/i);
  });

  it('requires C-G0 and refuses unless policies, triggers and dependents are the expected ones', () => {
    expect(sql).toContain('apply 202611091300_harden_database_ownership.sql first');
    expect(sql).toContain('does not have exactly the two expected tenant policies');
    expect(sql).toContain("ARRAY['refunds:refunds_updated_at:update_refunds_updated_at()']");
    expect(sql).toContain('has a view, rule, owned sequence or inbound foreign key');
  });

  it('the rollback restores from the recorded prior state and refuses unless the restored state equals it', () => {
    const rb = statements(ROLLBACK_SQL);
    expect(rb).toMatch(/FROM public\.admin_migration_prior_state/);
    expect(rb).toMatch(/ALTER TABLE public\.%I OWNER TO %I', t, p->>'owner'/);
    expect(rb).toMatch(/IF now_tables <> \(SELECT jsonb_object_agg\(key, value - 'acl_raw'\)/);
  });

  it('is administrative, after C-G0, and its rollback is never selected', () => {
    expect(getMigrationFiles(path.join(__dirname, '../../../../database/migrations'))).not.toContain(MIGRATION_FILE);
    const adminFiles: string[] = getMigrationFiles(ADMIN_DIR);
    expect(adminFiles).toContain(MIGRATION_FILE);
    expect(adminFiles).not.toContain(ROLLBACK_FILE);
    expect(adminFiles.indexOf(MIGRATION_FILE)).toBeGreaterThan(adminFiles.indexOf('202611091300_harden_database_ownership.sql'));
  });
});

describe('202611101200_transfer_tenant_table_ownership: recorded prior state and guard', () => {
  const admin = new Client(dbConfig());
  beforeAll(() => admin.connect());
  afterAll(() => admin.end());

  it('records, for each of the nine, owner, FORCE, the raw and canonical ACL and index owners, and the trigger function owner', async () => {
    const { rows } = await admin.query(
      `SELECT (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(prior_state->'tables') k) AS tables,
              (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(prior_state->'tables'->'refunds') k) AS keys,
              prior_state->>'refunds_trigger_function_owner' IS NOT NULL AS fn,
              length(prior_state->>'other_relations_md5') AS md5_len
         FROM public.admin_migration_prior_state WHERE migration_name = $1`,
      [MIGRATION_FILE]
    );
    expect(rows[0]).toEqual({ tables: [...NINE].sort(), keys: ['acl', 'acl_raw', 'force', 'index_owners', 'owner'], fn: true, md5_len: 32 });
  });

  it('refuses a second run, and an unexpected trigger function body (each in a rolled-back transaction)', async () => {
    const c = new Client(dbConfig());
    await c.connect();
    try {
      await c.query('BEGIN');
      await c.query('SAVEPOINT second_run');
      await expect(c.query(MIGRATION_SQL)).rejects.toThrow(/a prior state for this migration is already recorded -- refusing to proceed/);
      await c.query('ROLLBACK TO SAVEPOINT second_run');
      await c.query(`DELETE FROM public.admin_migration_prior_state WHERE migration_name = '${MIGRATION_FILE}'`);
      await c.query(`CREATE OR REPLACE FUNCTION public.update_refunds_updated_at() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END; $f$`);
      await expect(c.query(MIGRATION_SQL)).rejects.toThrow(/update_refunds_updated_at\(\) is not the expected/);
    } finally {
      await c.query('ROLLBACK').catch(() => undefined);
      await c.end();
    }
  });
});
