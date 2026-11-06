/**
 * Admin migration 202611051200_aws_disconnect_expand (AWS connect PR C, stage C-1):
 * the compatibility table of the PR C plan (rev4 §7.2), as tests.
 *
 * Static: the migration only adds (columns, partial indexes, new tables, one
 * non-restrictive trigger, a backfill of the new column, DELETE grants); it
 * never adds a CHECK, NOT NULL, constraint or restrictive trigger to an
 * existing table, and it starts with the 3 s lock timeout (C-D29).
 *
 * Dynamic, in ONE rolled-back transaction: the paired rollback first removes
 * the bootstrapped objects; a private schema, first on the search_path, holds
 * an aws_accounts shaped like production (the two UNIQUE(org_id) constraints
 * and UNIQUE(account_id), nullable org_id/account_id/status, status default
 * 'active'); then
 *   - the DEPLOYED connect INSERT (read from routes/aws.routes.ts) gives the
 *     same answers before and after the migration: a fresh org inserts, a
 *     second row for an org is DO NOTHING, a second org with the same AWS
 *     account is a unique violation (the route answers that SAVE_FAILED);
 *   - the backfill stamps only the snapshots of an org with exactly one
 *     aws_accounts row, and that row active, and only those written at or after
 *     that connection's connected_at: a snapshot written before the connection
 *     existed (even on the connect day) stays unstamped and is kept;
 *   - the DEPLOYED risk snapshot writer (RiskScoreHistoryRepository.createSnapshot),
 *     run as devcontrol, gets its row stamped by the trigger, and an org with no
 *     connection gets NULL; the trigger never refuses a snapshot;
 *   - devcontrol can write the new tables (under RLS) and delete from the three
 *     granted tables;
 *   - re-running is refused; the rollback refuses once lifecycle state exists,
 *     and otherwise removes everything the migration added.
 * The dynamic part runs with production's extra risk_score_history.computed_at
 * column present; the static part checks C-1 never names it.
 *
 * Placeholders only.
 */
import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { RiskScoreHistoryRepository } from '../../repositories/risk-score-history.repository';
import { ensureSharedFixtureTable } from '../../routes/__tests__/shared-fixture-tables';
import { Pool } from 'pg';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getMigrationFiles } = require('../../../../database/migrate.js');

const ADMIN_DIR = path.join(__dirname, '../../../../database/migrations-admin');
const MIGRATION_FILE = '202611051200_aws_disconnect_expand.sql';
const ROLLBACK_FILE = '202611051200_aws_disconnect_expand_rollback.sql';
const MIGRATION_SQL = fs.readFileSync(path.join(ADMIN_DIR, MIGRATION_FILE), 'utf8');
const ROLLBACK_SQL = fs.readFileSync(path.join(ADMIN_DIR, ROLLBACK_FILE), 'utf8');

/** The connect INSERT exactly as the deployed route sends it. */
const ROUTE_SOURCE = fs.readFileSync(path.join(__dirname, '../../routes/aws.routes.ts'), 'utf8');
const DEPLOYED_CONNECT_INSERT = (ROUTE_SOURCE.match(/`(INSERT INTO aws_accounts[\s\S]*?)`/) ?? [])[1];

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

describe('202611051200_aws_disconnect_expand: static shape (compatibility table)', () => {
  const sql = statements(MIGRATION_SQL);

  it('starts with the 3 s lock timeout (C-D29)', () => {
    expect(sql.trim().startsWith("SET LOCAL lock_timeout = '3s';")).toBe(true);
  });

  it('creates exactly the three new tables', () => {
    expect((sql.match(/\bCREATE TABLE\s+(\w+)/gi) ?? []).sort()).toEqual([
      'CREATE TABLE aws_preserved_customer_decisions',
      'CREATE TABLE remediation_executions',
      'CREATE TABLE remediation_step_claims',
    ]);
  });

  it('alters existing tables only by ADD COLUMN, on aws_accounts and risk_score_history', () => {
    const alters = sql.match(/\bALTER\s+TABLE\s+(\w+)\s+(\w+(?:\s+\w+)?)/gi) ?? [];
    for (const alter of alters) {
      const [, table, action] = alter.match(/ALTER\s+TABLE\s+(\w+)\s+(.*)/i)!;
      if (['aws_preserved_customer_decisions', 'remediation_executions', 'remediation_step_claims'].includes(table)) continue;
      expect([table, action.split(/\s+/)[0].toUpperCase()]).toEqual([expect.stringMatching(/^(aws_accounts|risk_score_history)$/), 'ADD']);
    }
    expect(sql).toMatch(/ALTER TABLE aws_accounts\s+ADD COLUMN disconnect_requested_at/);
    expect(sql).toMatch(/ALTER TABLE risk_score_history ADD COLUMN aws_connection_id UUID;/);
  });

  it('every connection-id column is uuid, the type of aws_accounts.id, and the migration refuses an aws_accounts.id that is not', () => {
    // Every declaration (ADD COLUMN or CREATE TABLE) of a connection-id column, whatever type it names.
    const columns = (sql.match(/\b(aws_connection_id|source_connection_id|applied_connection_id)\s+(UUID|TEXT|VARCHAR|CHAR\w*|INT\w*|BIGINT)\b/gi) ?? []).map((m) => m.replace(/\s+/g, ' '));
    expect(columns.sort()).toEqual([
      'applied_connection_id UUID',
      'aws_connection_id UUID',
      'aws_connection_id UUID',
      'source_connection_id UUID',
    ]);
    // The only TEXT column the migration adds is the decision's stable key.
    expect((sql.match(/\w+\s+TEXT\b/g) ?? []).map((m) => m.split(/\s+/)[0])).toEqual(['stable_key']);
    expect(sql).toMatch(/IS DISTINCT FROM 'uuid' THEN\s+RAISE EXCEPTION 'aws_accounts\.id is not uuid/);
  });

  it('adds no CHECK, NOT NULL or constraint to an existing column, drops nothing and deletes nothing', () => {
    expect(sql).not.toMatch(/\bDROP\s|\bDELETE\s+FROM\b|\bTRUNCATE\b|ADD\s+CONSTRAINT|SET\s+NOT\s+NULL|VALIDATE\s+CONSTRAINT|ALTER\s+COLUMN/i);
    // The one NOT NULL on aws_accounts is a new column with a constant default.
    const awsAccountsAlter = (sql.match(/ALTER TABLE aws_accounts[\s\S]*?\$q\$/) ?? [''])[0];
    expect(awsAccountsAlter.match(/NOT NULL/g) ?? []).toHaveLength(1);
    expect(awsAccountsAlter).toMatch(/ADD COLUMN cleanup_attempts\s+INTEGER NOT NULL DEFAULT 0/);
    // The only UPDATE is the backfill of the new column.
    const updates = sql.match(/\bUPDATE\s+\w+(\s+\w+)?\s+SET\s+\w+/gi) ?? [];
    expect(updates).toEqual([expect.stringMatching(/UPDATE risk_score_history h\s+SET aws_connection_id/)]);
  });

  it('its only trigger on an existing table is the BEFORE INSERT stamp, which never raises', () => {
    expect(sql.match(/CREATE TRIGGER \w+/g)).toEqual(['CREATE TRIGGER risk_score_history_stamp_connection']);
    expect(sql).toMatch(/BEFORE INSERT ON risk_score_history/);
    const fn = (sql.match(/CREATE FUNCTION risk_score_history_stamp_connection\(\)[\s\S]*?END \$\$;/) ?? [''])[0];
    expect(fn).not.toMatch(/RAISE EXCEPTION/);
    expect(fn).toMatch(/EXCEPTION WHEN OTHERS THEN/);
  });

  it('the backfill stamps only snapshots written at or after the connection\'s connected_at', () => {
    const backfill = (sql.match(/UPDATE risk_score_history h[\s\S]*?\$q\$;/) ?? [''])[0];
    expect(backfill).toMatch(/min\(connected_at\) AS connected_at/);
    expect(backfill).toMatch(/AND h\.created_at >= s\.connected_at \$q\$;$/);
  });

  it('does not depend on risk_score_history.computed_at (production has it, the repo schema does not)', () => {
    expect(sql).not.toMatch(/computed_at/i);
    expect(statements(ROLLBACK_SQL)).not.toMatch(/computed_at/i);
  });

  it('the live-connection indexes are partial on (active, disconnecting)', () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX aws_accounts_live_org_uidx\s+ON aws_accounts \(org_id\) WHERE status IN \('active', 'disconnecting'\)/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX aws_accounts_live_account_uidx\s+ON aws_accounts \(account_id\) WHERE status IN \('active', 'disconnecting'\)/);
  });

  it('grants: SELECT/INSERT/UPDATE on the new tables (no DELETE), DELETE on exactly the three cleanup tables', () => {
    const grants = sql.match(/GRANT [^;]+;/g) ?? [];
    expect(grants).toEqual([
      'GRANT SELECT, INSERT, UPDATE ON TABLE aws_preserved_customer_decisions, remediation_executions, remediation_step_claims TO devcontrol;',
      'GRANT DELETE ON TABLE cost_finding_detections, observability_collection_scopes, resource_telemetry_observations TO devcontrol;',
    ]);
  });

  it('is administrative: invisible to the ordinary path, after the 202611031200 migrations, and its rollback is never selected', () => {
    expect(getMigrationFiles(path.join(__dirname, '../../../../database/migrations'))).not.toContain(MIGRATION_FILE);
    const adminFiles: string[] = getMigrationFiles(ADMIN_DIR);
    expect(adminFiles).toContain(MIGRATION_FILE);
    expect(adminFiles).not.toContain(ROLLBACK_FILE);
    expect(adminFiles.indexOf(MIGRATION_FILE)).toBeGreaterThan(adminFiles.indexOf('202611031200_create_cost_finding_detections.sql'));
    expect(adminFiles.indexOf(MIGRATION_FILE)).toBeGreaterThan(adminFiles.indexOf('202611031200_create_aws_org_external_ids.sql'));
  });

  it('the deployed connect INSERT is the one this compatibility table is proven against', () => {
    expect(DEPLOYED_CONNECT_INSERT).toBeDefined();
    expect(DEPLOYED_CONNECT_INSERT).toMatch(/ON CONFLICT \(org_id\) DO NOTHING/);
    expect(DEPLOYED_CONNECT_INSERT).toMatch(/VALUES \(\$1, \$2, \$3, \$4, \$5, 'us-east-1', NOW\(\), 'active'\)/);
  });
});

describe('202611051200_aws_disconnect_expand: against a production-shaped aws_accounts', () => {
  const pool = new Pool(dbConfig());
  beforeAll(async () => {
    // The stamp trigger reads public.aws_accounts (its search_path is pinned).
    await ensureSharedFixtureTable(pool, 'aws_accounts');
  });
  afterAll(async () => {
    await pool.end();
  });

  it('keeps the deployed connect and snapshot writers working, backfills, grants, refuses a re-run, and rolls back', async () => {
    const client = new Client(dbConfig());
    await client.connect();
    const schema = `c1_mig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const q = (text: string, values?: unknown[]) => client.query(text, values);
    try {
      await q('BEGIN');
      await q(`INSERT INTO schema_migrations (migration_name, checksum) VALUES ($1, 'test') ON CONFLICT (migration_name) DO NOTHING`, [MIGRATION_FILE]);
      await q(`CREATE SCHEMA ${schema}`);
      // The new tables land in this private schema in the test; devcontrol must be able to see them.
      await q(`GRANT USAGE ON SCHEMA ${schema} TO devcontrol`);
      await q(`CREATE TABLE ${schema}.aws_accounts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id UUID,
        role_arn TEXT NOT NULL,
        account_id VARCHAR(12),
        nickname VARCHAR(255),
        external_id VARCHAR(64),
        region VARCHAR(32) DEFAULT 'us-east-1',
        connected_at TIMESTAMP,
        status VARCHAR(50) DEFAULT 'active',
        CONSTRAINT aws_accounts_org_id_key UNIQUE (org_id),
        CONSTRAINT aws_accounts_account_id_unique UNIQUE (account_id)
      )`);
      // Production's second UNIQUE (org_id) came from a later ALTER (CREATE TABLE would fold the duplicate into one).
      await q(`ALTER TABLE ${schema}.aws_accounts ADD CONSTRAINT aws_accounts_org_id_unique UNIQUE (org_id)`);
      expect((await q(`SELECT conname FROM pg_constraint WHERE conrelid = '${schema}.aws_accounts'::regclass AND contype = 'u' ORDER BY 1`)).rows.map((r: any) => r.conname))
        .toEqual(['aws_accounts_account_id_unique', 'aws_accounts_org_id_key', 'aws_accounts_org_id_unique']);
      await q(`SET LOCAL search_path = ${schema}, public`);
      // Production's risk_score_history also has computed_at (timestamp without time zone); the repo
      // schema does not. Run with it present, as production (rolled back with the transaction).
      await q(`ALTER TABLE public.risk_score_history ADD COLUMN IF NOT EXISTS computed_at TIMESTAMP`);

      // The bootstrapped C-1 objects are removed first (the rollback, as the founder would run it).
      await q(ROLLBACK_SQL);
      expect((await q(`SELECT to_regclass('public.remediation_step_claims') AS t,
        (SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.risk_score_history'::regclass AND attname = 'aws_connection_id' AND NOT attisdropped)::int AS col`)).rows[0])
        .toEqual({ t: null, col: 0 });

      const org = async (label: string) => (await q(
        `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status) VALUES ($1, $2, $1, 'free', 'free') RETURNING id`,
        [`C1 ${label} ${schema}`, `c1-${label.toLowerCase()}-${schema.replace(/_/g, '-')}`]
      )).rows[0].id as string;
      const [orgA, orgB, orgC, orgD] = [await org('A'), await org('B'), await org('C'), await org('D')];
      const account = (n: number) => String(1e11 + n * 1e9 + Math.floor(Math.random() * 1e9));
      const accountA = account(1);
      await q(`INSERT INTO aws_accounts (org_id, role_arn, account_id, external_id, connected_at, status) VALUES ($1, $2, $3, 'placeholder-external-id', NOW(), 'active')`,
        [orgA, `arn:aws:iam::${accountA}:role/DevControlRole`, accountA]);
      const rowA = (await q(`SELECT id::text AS id FROM aws_accounts WHERE org_id = $1`, [orgA])).rows[0].id;
      const accountC = account(3);
      await q(`INSERT INTO aws_accounts (org_id, role_arn, account_id, external_id, status) VALUES ($1, $2, $3, 'placeholder-external-id', 'inactive')`,
        [orgC, `arn:aws:iam::${accountC}:role/DevControlRole`, accountC]);
      const snapshot = (orgId: string, day: string) => q(
        `INSERT INTO risk_score_history (organization_id, snapshot_date, overall_score, grade, encryption_score, public_access_score, backup_score, compliance_score, resource_management_score)
         VALUES ($1, $2, 80, 'B', 80, 80, 80, 80, 80)`, [orgId, day]);
      await snapshot(orgA, '2026-10-01'); await snapshot(orgA, '2026-10-02');
      // Org G, as production's primary org: snapshots were written before the connection existed.
      const orgG = await org('G');
      const accountG = account(7);
      const rowG = (await q(`INSERT INTO aws_accounts (org_id, role_arn, account_id, external_id, connected_at, status)
        VALUES ($1, $2, $3, 'placeholder-external-id', TIMESTAMP '2026-05-31 02:38:36', 'active') RETURNING id::text AS id`,
        [orgG, `arn:aws:iam::${accountG}:role/DevControlRole`, accountG])).rows[0].id;
      const snapshotAt = (orgId: string, day: string, createdAt: string) => q(
        `INSERT INTO risk_score_history (organization_id, snapshot_date, overall_score, grade, encryption_score, public_access_score, backup_score, compliance_score, resource_management_score, created_at)
         VALUES ($1, $2, 80, 'B', 80, 80, 80, 80, 80, $3::timestamp)`, [orgId, day, createdAt]);
      await snapshotAt(orgG, '2026-04-09', '2026-04-09 03:00:00');     // weeks before the connection
      await snapshotAt(orgG, '2026-05-31', '2026-05-31 00:10:00');     // the connect day, but before connected_at
      await snapshotAt(orgG, '2026-06-01', '2026-06-01 03:00:00');     // after
      await snapshotAt(orgG, '2026-06-02', '2026-05-31 02:38:36');     // exactly at connected_at: stamped (>=)
      await snapshot(orgB, '2026-10-01'); await snapshot(orgC, '2026-10-01');

      // The deployed connect INSERT, before the migration.
      const connect = async (orgId: string, accountId: string) => {
        await q('SAVEPOINT probe');
        try {
          const r = await q(DEPLOYED_CONNECT_INSERT!, [orgId, `arn:aws:iam::${accountId}:role/DevControlRole`, accountId, null, 'placeholder-external-id']);
          await q('RELEASE SAVEPOINT probe');
          return { rows: r.rows.length };
        } catch (error: any) {
          await q('ROLLBACK TO SAVEPOINT probe');
          return { error: error.code };
        }
      };
      const probes = async () => [
        await connect(orgD, account(4)),   // a fresh org
        await connect(orgA, account(5)),   // a second row for a connected org
        await connect(orgB, accountA),     // a second org with a connected AWS account
      ];
      const before = await probes();
      expect(before).toEqual([{ rows: 1 }, { rows: 0 }, { error: '23505' }]);
      await q(`DELETE FROM aws_accounts WHERE org_id = $1`, [orgD]);

      // The migration.
      await q(MIGRATION_SQL);

      // The deployed connect INSERT answers exactly as before.
      expect(await probes()).toEqual(before);
      await q(`DELETE FROM aws_accounts WHERE org_id = $1`, [orgD]);

      // Lifecycle columns added with their defaults; existing rows unchanged otherwise.
      expect((await q(`SELECT disconnect_requested_at, disconnecting_at, disconnected_at, cleanup_attempts, status FROM aws_accounts WHERE org_id = $1`, [orgA])).rows[0])
        .toEqual({ disconnect_requested_at: null, disconnecting_at: null, disconnected_at: null, cleanup_attempts: 0, status: 'active' });
      const indexes = (await q(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND indexname LIKE 'aws_accounts_live_%' ORDER BY 1`, [schema])).rows;
      expect(indexes.map((i: any) => i.indexname)).toEqual(['aws_accounts_live_account_uidx', 'aws_accounts_live_org_uidx']);
      for (const i of indexes) expect(i.indexdef).toMatch(/WHERE \(\(status\)::text = ANY \(\(ARRAY\['active'::character varying, 'disconnecting'::character varying\]\)::text\[\]\)\)/);

      // The four connection-id columns are uuid and refuse a value that is not one.
      expect((await q(`SELECT string_agg(c, ',' ORDER BY c) AS cols FROM (SELECT attrelid::regclass::text || '.' || attname || ':' || format_type(atttypid, atttypmod) AS c
          FROM pg_attribute WHERE attname IN ('aws_connection_id', 'source_connection_id', 'applied_connection_id') AND NOT attisdropped
           AND attrelid IN ('public.risk_score_history'::regclass, 'remediation_executions'::regclass, 'aws_preserved_customer_decisions'::regclass)) t`)).rows[0].cols)
        .toEqual('aws_preserved_customer_decisions.applied_connection_id:uuid,aws_preserved_customer_decisions.source_connection_id:uuid,remediation_executions.aws_connection_id:uuid,risk_score_history.aws_connection_id:uuid');
      await q('SAVEPOINT not_uuid');
      await expect(q(`UPDATE risk_score_history SET aws_connection_id = 'not-a-uuid' WHERE organization_id = $1`, [orgB])).rejects.toMatchObject({ code: '22P02' });
      await q('ROLLBACK TO SAVEPOINT not_uuid');

      // Backfill: only org A (one row, active) is stamped.
      const stamps = (await q(`SELECT organization_id::text AS org, aws_connection_id FROM risk_score_history WHERE organization_id = ANY($1) ORDER BY 1, snapshot_date`, [[orgA, orgB, orgC]])).rows;
      expect(stamps).toEqual(expect.arrayContaining([
        { org: orgA, aws_connection_id: rowA },
        { org: orgB, aws_connection_id: null },
        { org: orgC, aws_connection_id: null },
      ]));
      expect(stamps.filter((s: any) => s.org === orgA).every((s: any) => s.aws_connection_id === rowA)).toBe(true);
      // Org G: only the snapshots written at or after connected_at are stamped; the earlier ones are kept, unstamped.
      expect((await q(`SELECT snapshot_date::text AS day, aws_connection_id FROM risk_score_history WHERE organization_id = $1 ORDER BY snapshot_date`, [orgG])).rows)
        .toEqual([
          { day: '2026-04-09', aws_connection_id: null },
          { day: '2026-05-31', aws_connection_id: null },
          { day: '2026-06-01', aws_connection_id: rowG },
          { day: '2026-06-02', aws_connection_id: rowG },
        ]);

      // The deployed snapshot writer, as devcontrol: stamped from public.aws_accounts by the trigger.
      const orgE = await org('E');
      const orgF = await org('F');
      const accountE = account(6);
      const rowE = (await q(`INSERT INTO public.aws_accounts (org_id, role_arn, account_id, external_id, region, status)
        VALUES ($1, $2, $3, 'placeholder-external-id', 'us-east-1', 'active') RETURNING id::text AS id`,
        [orgE, `arn:aws:iam::${accountE}:role/DevControlRole`, `ph-${orgE.replace(/-/g, '').slice(0, 29)}`])).rows[0].id;
      // As production: devcontrol reads aws_accounts and writes risk snapshots (rolled back with the transaction).
      await q(`GRANT SELECT ON public.aws_accounts TO devcontrol`);
      await q(`GRANT SELECT, INSERT, UPDATE ON public.risk_score_history TO devcontrol`);
      await q(`SET LOCAL ROLE devcontrol`);
      const repository = new RiskScoreHistoryRepository(pool);
      const snap = (orgId: string) => repository.createSnapshot({
        organizationId: orgId, snapshotDate: new Date('2026-11-05T12:00:00Z'), overallScore: 90, grade: 'A', encryptionScore: 90,
        publicAccessScore: 90, backupScore: 90, complianceScore: 90, resourceManagementScore: 90, totalResources: 1, unencryptedCount: 0,
        publicCount: 0, missingBackupCount: 0, complianceIssues: { critical: 0, high: 0, medium: 0, low: 0 }, orphanedCount: 0,
      }, client as any);
      await snap(orgE);
      await snap(orgF);
      await snap(orgE); // the ON CONFLICT DO UPDATE path keeps the stamp
      await q(`RESET ROLE`);
      expect((await q(`SELECT organization_id::text AS org, aws_connection_id FROM risk_score_history WHERE organization_id = ANY($1) ORDER BY 1`, [[orgE, orgF]])).rows)
        .toEqual(expect.arrayContaining([{ org: orgE, aws_connection_id: rowE }, { org: orgF, aws_connection_id: null }]));

      // devcontrol: writes the new tables under RLS; deletes from the three granted tables.
      await q(`SET LOCAL ROLE devcontrol`);
      await q(`SELECT set_config('app.current_organization_id', $1, true)`, [orgA]);
      const exec = (await q(`INSERT INTO remediation_executions (organization_id, workflow_id, aws_connection_id) VALUES ($1, gen_random_uuid(), $2) RETURNING id`, [orgA, rowA])).rows[0].id;
      const claim = (await q(`INSERT INTO remediation_step_claims (organization_id, execution_id, step) VALUES ($1, $2, 'StopInstances#1') RETURNING fencing_token`, [orgA, exec])).rows[0];
      expect(Number(claim.fencing_token)).toBeGreaterThan(0);
      await q(`INSERT INTO aws_preserved_customer_decisions (organization_id, aws_account_id, source_connection_id, kind, stable_key, decision)
               VALUES ($1, $2, $3, 'cost_dismissal', 'i-1234567890abcdef0|Idle Instance', '{"status":"DISMISSED"}')`, [orgA, accountA, rowA]);
      await expect(q(`SAVEPOINT rls; INSERT INTO remediation_executions (organization_id, workflow_id, aws_connection_id) VALUES ('${orgB}', gen_random_uuid(), gen_random_uuid())`))
        .rejects.toMatchObject({ code: '42501' });
      await q('ROLLBACK TO SAVEPOINT rls');
      for (const table of ['cost_finding_detections', 'observability_collection_scopes', 'resource_telemetry_observations']) {
        expect((await q(`SELECT has_table_privilege('devcontrol', $1, 'DELETE') AS d`, [`public.${table}`])).rows[0].d).toBe(true);
        await q(`DELETE FROM public.${table} WHERE organization_id = $1`, [orgA]);
      }
      await q(`RESET ROLE`);
      for (const table of ['aws_preserved_customer_decisions', 'remediation_executions', 'remediation_step_claims']) {
        expect((await q(`SELECT has_table_privilege('devcontrol', $1, 'DELETE') AS d`, [table])).rows[0].d).toBe(false);
      }

      // Re-running is refused.
      await q('SAVEPOINT rerun');
      await expect(q(MIGRATION_SQL)).rejects.toThrow(/already exists -- refusing to proceed/);
      await q('ROLLBACK TO SAVEPOINT rerun');

      // The rollback refuses while lifecycle state or rows exist...
      await q('SAVEPOINT refuse');
      await expect(q(ROLLBACK_SQL)).rejects.toThrow(/row\(s\) in the disconnect tables -- refusing to roll back/);
      await q('ROLLBACK TO SAVEPOINT refuse');
      await q(`DELETE FROM aws_preserved_customer_decisions; DELETE FROM remediation_step_claims; DELETE FROM remediation_executions`);
      await q(`UPDATE aws_accounts SET disconnect_requested_at = NOW() WHERE org_id = $1`, [orgA]);
      await q('SAVEPOINT refuse2');
      await expect(q(ROLLBACK_SQL)).rejects.toThrow(/carry disconnect lifecycle state -- refusing to roll back/);
      await q('ROLLBACK TO SAVEPOINT refuse2');
      await q(`UPDATE aws_accounts SET disconnect_requested_at = NULL WHERE org_id = $1`, [orgA]);

      // ...and otherwise removes everything the migration added, keeping every snapshot row.
      const snapshotsBefore = (await q(`SELECT count(*)::int AS n FROM risk_score_history`)).rows[0].n;
      await q(ROLLBACK_SQL);
      const after = (await q(`SELECT
          to_regclass('remediation_step_claims') AS claims, to_regclass('remediation_executions') AS execs, to_regclass('aws_preserved_customer_decisions') AS decisions,
          (SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.risk_score_history'::regclass AND attname = 'aws_connection_id' AND NOT attisdropped)::int AS stamp_col,
          (SELECT count(*) FROM pg_attribute WHERE attrelid = 'aws_accounts'::regclass AND attname LIKE 'disconnect%' AND NOT attisdropped)::int AS lifecycle_cols,
          (SELECT count(*) FROM pg_indexes WHERE schemaname = $1 AND indexname LIKE 'aws_accounts_live_%')::int AS live_indexes,
          (SELECT count(*) FROM pg_trigger WHERE tgname = 'risk_score_history_stamp_connection')::int AS triggers,
          (SELECT count(*) FROM schema_migrations WHERE migration_name = $2)::int AS ledger,
          has_table_privilege('devcontrol', 'public.cost_finding_detections', 'DELETE') AS cfd_delete,
          (SELECT count(*) FROM risk_score_history)::int AS snapshots`, [schema, MIGRATION_FILE])).rows[0];
      expect(after).toEqual({
        claims: null, execs: null, decisions: null, stamp_col: 0, lifecycle_cols: 0, live_indexes: 0, triggers: 0, ledger: 0,
        cfd_delete: false, snapshots: snapshotsBefore,
      });
      // The three original constraints are untouched throughout.
      expect((await q(`SELECT conname FROM pg_constraint WHERE conrelid = 'aws_accounts'::regclass AND contype = 'u' ORDER BY 1`)).rows.map((r: any) => r.conname))
        .toEqual(['aws_accounts_account_id_unique', 'aws_accounts_org_id_key', 'aws_accounts_org_id_unique']);
    } finally {
      await q('ROLLBACK').catch(() => undefined);
      await client.end();
    }
  }, 60_000);
});
