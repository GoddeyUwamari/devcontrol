/**
 * Admin migration 202611031200_create_aws_org_external_ids: additive, the
 * backfill's precedence (the value AWS already trusts first), malformed values
 * skipped, rollback, and refusal to run twice.
 *
 * The backfill cases run in one rolled-back transaction: the paired rollback
 * removes the bootstrapped table for the transaction's duration, a private
 * schema first on the search_path holds seeded aws_accounts and
 * aws_connect_sessions copies, and the migration runs against them.
 */
import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getMigrationFiles } = require('../../../../database/migrate.js');

const ADMIN_DIR = path.join(__dirname, '../../../../database/migrations-admin');
const MIGRATION_FILE = '202611031200_create_aws_org_external_ids.sql';
const ROLLBACK_FILE = '202611031200_create_aws_org_external_ids_rollback.sql';
const MIGRATION_SQL = fs.readFileSync(path.join(ADMIN_DIR, MIGRATION_FILE), 'utf8');
const ROLLBACK_SQL = fs.readFileSync(path.join(ADMIN_DIR, ROLLBACK_FILE), 'utf8');

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

describe('202611031200_create_aws_org_external_ids: static shape', () => {
  it('is additive: it creates one table and never alters, drops, updates or deletes anything that exists', () => {
    const sql = statements(MIGRATION_SQL);
    expect(sql.match(/\bCREATE TABLE\s+(\w+)/gi)).toEqual(['CREATE TABLE aws_org_external_ids']);
    expect(sql).not.toMatch(/\bALTER\s+TABLE\s+(?!aws_org_external_ids\b)/i);
    expect(sql).not.toMatch(/\bDROP\s|\bDELETE\s+FROM\b|\bTRUNCATE\b|\bUPDATE\s+\w+\s+SET\b/i);
    // The backfill only inserts, and an existing row always wins.
    for (const insert of sql.match(/INSERT INTO aws_org_external_ids[\s\S]*?ON CONFLICT \(organization_id\) DO NOTHING/g) ?? []) {
      expect(insert).toContain('ON CONFLICT (organization_id) DO NOTHING');
    }
    expect((sql.match(/INSERT INTO aws_org_external_ids/g) ?? []).length).toBe(2);
    expect((sql.match(/ON CONFLICT \(organization_id\) DO NOTHING/g) ?? []).length).toBe(2);
  });

  it('grants the application role SELECT and INSERT only', () => {
    const sql = statements(MIGRATION_SQL);
    expect(sql).toMatch(/GRANT SELECT, INSERT ON TABLE aws_org_external_ids TO devcontrol;/);
    expect(sql).not.toMatch(/GRANT[^;]*\b(UPDATE|DELETE|TRUNCATE|ALL)\b[^;]*aws_org_external_ids/i);
  });

  it('is administrative: invisible to the ordinary path, after 202611021200, and its rollback is never selected', () => {
    expect(getMigrationFiles(path.join(__dirname, '../../../../database/migrations'))).not.toContain(MIGRATION_FILE);
    const adminFiles: string[] = getMigrationFiles(ADMIN_DIR);
    expect(adminFiles).toContain(MIGRATION_FILE);
    expect(adminFiles).not.toContain(ROLLBACK_FILE);
    expect(adminFiles.indexOf(MIGRATION_FILE)).toBeGreaterThan(adminFiles.indexOf('202611021200_extend_cost_analysis_runs.sql'));
  });
});

describe('202611031200_create_aws_org_external_ids: backfill, rollback, re-run', () => {
  it('copies the trusted value by precedence, skips malformed values, and rolls back cleanly', async () => {
    const client = new Client(dbConfig());
    await client.connect();
    const schema = `extid_mig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO schema_migrations (migration_name, checksum) VALUES ($1, 'test') ON CONFLICT (migration_name) DO NOTHING`, [MIGRATION_FILE]);

      await client.query(ROLLBACK_SQL);
      const gone = await client.query(`SELECT to_regclass('public.aws_org_external_ids') AS t,
        (SELECT count(*) FROM schema_migrations WHERE migration_name = $1)::int AS ledger,
        (SELECT count(*) FROM pg_proc WHERE proname = 'aws_org_external_ids_refuse_update')::int AS fn`, [MIGRATION_FILE]);
      expect(gone.rows[0]).toEqual({ t: null, ledger: 0, fn: 0 });

      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET LOCAL search_path = ${schema}, public`);
      await client.query(`CREATE TABLE aws_accounts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(), org_id UUID, external_id VARCHAR(64),
        status VARCHAR(32), connected_at TIMESTAMPTZ)`);
      await client.query(`CREATE TABLE aws_connect_sessions (
        org_id UUID PRIMARY KEY, external_id VARCHAR(64) NOT NULL, expires_at TIMESTAMPTZ NOT NULL)`);

      const orgs: Record<string, string> = {};
      for (const key of ['activeWins', 'newestWins', 'sessionFallback', 'expiredSession', 'malformedOnly', 'nothing', 'orphan']) {
        if (key === 'orphan') { orgs[key] = '00000000-0000-4000-8000-0000000000ff'; continue; }
        const { rows } = await client.query(
          `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
           VALUES ($1, $1, $1, 'free', 'free') RETURNING id`, [`${schema}-${key}`]);
        orgs[key] = rows[0].id;
      }
      const acct = (org: string, ext: string | null, status: string, at: string) => client.query(
        `INSERT INTO aws_accounts (org_id, external_id, status, connected_at) VALUES ($1, $2, $3, $4::timestamptz)`, [org, ext, status, at]);
      const sess = (org: string, ext: string, expired: boolean) => client.query(
        `INSERT INTO aws_connect_sessions (org_id, external_id, expires_at) VALUES ($1, $2, NOW() + $3::interval)`, [org, ext, expired ? '-3 days' : '1 hour']);

      // active first, even when an inactive row is newer; a session never beats a connection
      await acct(orgs.activeWins, 'Old_Inactive-1', 'inactive', '2026-10-30');
      await acct(orgs.activeWins, 'Active_Trusted-1', 'active', '2026-10-01');
      await sess(orgs.activeWins, 'Session_Loses-1', false);
      // no active row: the newest connection
      await acct(orgs.newestWins, 'Older_Value-2', 'inactive', '2026-09-01');
      await acct(orgs.newestWins, 'Newer_Value-2', 'inactive', '2026-10-01');
      // malformed connection value: skipped, the session is used
      await acct(orgs.sessionFallback, 'has a space', 'active', '2026-10-01');
      await sess(orgs.sessionFallback, 'Session_Used-3', false);
      // expired session only
      await sess(orgs.expiredSession, 'Expired_Kept-4', true);
      // malformed everything: no row (generated at runtime)
      await acct(orgs.malformedOnly, null, 'active', '2026-10-01');
      // organization that no longer exists: no row (foreign key)
      await sess(orgs.orphan, 'Orphan_Value-6', false);

      const notices: string[] = [];
      client.on('notice', (n) => notices.push(n.message ?? ''));
      await client.query(MIGRATION_SQL);

      const { rows } = await client.query(`SELECT organization_id, external_id, source FROM aws_org_external_ids`);
      const byOrg = Object.fromEntries(rows.map((r) => [r.organization_id, [r.external_id, r.source]]));
      expect(byOrg).toEqual({
        [orgs.activeWins]: ['Active_Trusted-1', 'connection'],
        [orgs.newestWins]: ['Newer_Value-2', 'connection'],
        [orgs.sessionFallback]: ['Session_Used-3', 'session'],
        [orgs.expiredSession]: ['Expired_Kept-4', 'session'],
      });
      // existing connections are untouched
      const accounts = await client.query(`SELECT external_id FROM aws_accounts`);
      expect(accounts.rows.map((r) => String(r.external_id)).sort()).toEqual(
        ['null', 'Active_Trusted-1', 'Newer_Value-2', 'Old_Inactive-1', 'Older_Value-2', 'has a space'].sort());
      expect(notices.join('\n')).toMatch(/2 from connections, 2 from sessions/);
      expect(notices.join('\n')).toMatch(/2 aws_accounts row\(s\) with a missing or malformed external_id skipped/);
      // the notice never prints a value
      expect(notices.join('\n')).not.toMatch(/Trusted|Session_|Expired_/);

      // running it again refuses
      await client.query('SAVEPOINT rerun');
      await expect(client.query(MIGRATION_SQL)).rejects.toThrow(/already exists -- this migration creates it and refuses/);
      await client.query('ROLLBACK TO SAVEPOINT rerun');
    } finally {
      await client.query('ROLLBACK');
      await client.end();
    }
  });
  // The other path, with neither legacy table present, is CI's own schema
  // bootstrap: it applies this migration to a database that has neither.
});
