/**
 * Admin migration 202611091200_add_trial_used_at: additive shape, the claim
 * CHECK, refusal (dependency missing, a trial column already there), and a
 * rollback that removes only its own objects and its ledger row.
 *
 * The database cases run in rolled-back transactions on a connection of their
 * own (the bootstrap has already applied the migration).
 */
import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getMigrationFiles } = require('../../../../database/migrate.js');

const ADMIN_DIR = path.join(__dirname, '../../../../database/migrations-admin');
const MIGRATION_FILE = '202611091200_add_trial_used_at.sql';
const ROLLBACK_FILE = '202611091200_add_trial_used_at_rollback.sql';
const MIGRATION_SQL = fs.readFileSync(path.join(ADMIN_DIR, MIGRATION_FILE), 'utf8');
const ROLLBACK_SQL = fs.readFileSync(path.join(ADMIN_DIR, ROLLBACK_FILE), 'utf8');
const RESERVATION_ROLLBACK_SQL = fs.readFileSync(path.join(ADMIN_DIR, '202611071200_add_checkout_reservation_rollback.sql'), 'utf8');
// Other suites may hold row locks on organizations briefly; the 3 s production
// lock timeout is asserted statically below and widened only for these runs.
const relaxed = (sql: string) => sql.replace("SET LOCAL lock_timeout = '3s';", "SET LOCAL lock_timeout = '60s';");
const MARKER = '[202611091200_add_trial_used_at]';
const COLUMNS = ['trial_used_at', 'trial_subscription_id'];

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

async function inTransaction(fn: (client: Client) => Promise<void>): Promise<void> {
  const client = new Client(dbConfig());
  await client.connect();
  try {
    await client.query('BEGIN');
    await fn(client);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
}

async function expectError(client: Client, sql: string, params: unknown[], pattern: RegExp, code?: string): Promise<void> {
  await client.query('SAVEPOINT expect_error');
  let caught: any = null;
  try {
    await client.query(sql, params);
  } catch (error) {
    caught = error;
  }
  await client.query('ROLLBACK TO SAVEPOINT expect_error');
  expect(caught).not.toBeNull();
  expect(String(caught.message)).toMatch(pattern);
  if (code) expect(caught.code).toBe(code);
}

async function trialColumns(client: Client): Promise<number> {
  const { rows } = await client.query(
    `SELECT count(*)::int AS n FROM pg_attribute WHERE attrelid = 'organizations'::regclass AND attname = ANY($1) AND NOT attisdropped`,
    [COLUMNS]
  );
  return rows[0].n;
}

describe('202611091200_add_trial_used_at: static shape', () => {
  it('is additive: two nullable columns and one CHECK on organizations; nothing dropped, deleted, updated or backfilled', () => {
    const sql = statements(MIGRATION_SQL);
    expect(sql).toContain("SET LOCAL lock_timeout = '3s';");
    expect(sql).not.toMatch(/\bDROP\s|\bDELETE\s+FROM\b|\bTRUNCATE\b|\bUPDATE\s+\w+\s+SET\b|\bINSERT\s+INTO\b|\bDEFAULT\b|NOT NULL\b(?!\))/i);
    expect(sql).not.toMatch(/\bALTER\s+TABLE\s+(?!organizations\b)/i);
    expect(sql).toContain('ADD COLUMN trial_used_at TIMESTAMPTZ');
    expect(sql).toContain('ADD COLUMN trial_subscription_id VARCHAR(255)');
    expect(sql).toMatch(/CHECK \(trial_subscription_id IS NULL OR trial_used_at IS NOT NULL\)/);
  });

  it('is administrative: invisible to the ordinary path, after the reservation migration, and its rollback is never selected', () => {
    expect(getMigrationFiles(path.join(__dirname, '../../../../database/migrations'))).not.toContain(MIGRATION_FILE);
    const adminFiles: string[] = getMigrationFiles(ADMIN_DIR);
    expect(adminFiles).toContain(MIGRATION_FILE);
    expect(adminFiles).not.toContain(ROLLBACK_FILE);
    expect(adminFiles.indexOf(MIGRATION_FILE)).toBeGreaterThan(adminFiles.indexOf('202611071200_add_checkout_reservation.sql'));
  });

  it('the rollback checks the marker, drops only its own objects, deletes its ledger row and never uses CASCADE', () => {
    const sql = statements(ROLLBACK_SQL);
    expect(sql).not.toMatch(/CASCADE/i);
    expect(sql).toContain(MARKER);
    expect(sql).toContain("DELETE FROM schema_migrations\n WHERE migration_name = '202611091200_add_trial_used_at.sql';");
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|INDEX)\b/i);
  });
});

describe('202611091200_add_trial_used_at: applied schema', () => {
  it('both columns exist, nullable, marked; existing rows are NULL', async () => {
    await inTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT attname, format_type(atttypid, atttypmod) AS type, attnotnull,
                col_description('organizations'::regclass, attnum) AS comment
           FROM pg_attribute WHERE attrelid = 'organizations'::regclass AND attname = ANY($1) AND NOT attisdropped ORDER BY attname`,
        [COLUMNS]
      );
      expect(rows.map(r => [r.attname, r.type, r.attnotnull])).toEqual([
        ['trial_subscription_id', 'character varying(255)', false],
        ['trial_used_at', 'timestamp with time zone', false],
      ]);
      for (const row of rows) expect(String(row.comment).startsWith(MARKER)).toBe(true);
      const { rows: inserted } = await client.query(
        `INSERT INTO organizations (name, slug, display_name) VALUES ('trial-mig', $1, 'trial-mig') RETURNING trial_used_at, trial_subscription_id`,
        [`trial-mig-${Date.now()}`]
      );
      expect(inserted[0]).toEqual({ trial_used_at: null, trial_subscription_id: null });
    });
  });

  it('a trial subscription is recorded only with its claim (CHECK)', async () => {
    await inTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO organizations (name, slug, display_name) VALUES ('trial-chk', $1, 'trial-chk') RETURNING id`,
        [`trial-chk-${Date.now()}`]
      );
      await expectError(client, `UPDATE organizations SET trial_subscription_id = 'sub_test_x' WHERE id = $1`, [rows[0].id],
        /organizations_trial_claim_complete/, '23514');
      await client.query(`UPDATE organizations SET trial_used_at = NOW() WHERE id = $1`, [rows[0].id]);
      await client.query(`UPDATE organizations SET trial_subscription_id = 'sub_test_x' WHERE id = $1`, [rows[0].id]);
    });
  });
});

describe('202611091200_add_trial_used_at: rollback, re-apply, refusal', () => {
  it('rolls back only its own objects and its ledger row, then re-applies', async () => {
    await inTransaction(async (client) => {
      await client.query(relaxed(ROLLBACK_SQL));
      const gone = await client.query(
        `SELECT (SELECT count(*) FROM pg_constraint WHERE conname = 'organizations_trial_claim_complete')::int AS checks,
                (SELECT count(*) FROM schema_migrations WHERE migration_name = $1)::int AS ledger,
                (SELECT count(*) FROM pg_attribute WHERE attrelid = 'organizations'::regclass AND attname = 'checkout_reservation_id' AND NOT attisdropped)::int AS reservation_kept`,
        [MIGRATION_FILE]
      );
      expect(await trialColumns(client)).toBe(0);
      expect(gone.rows[0]).toEqual({ checks: 0, ledger: 0, reservation_kept: 1 });

      await client.query(relaxed(MIGRATION_SQL));
      expect(await trialColumns(client)).toBe(2);
    });
  });

  it('the rollback refuses a column that the migration did not create (no marker)', async () => {
    await inTransaction(async (client) => {
      await client.query(`COMMENT ON COLUMN organizations.trial_used_at IS 'something else'`);
      await expectError(client, relaxed(ROLLBACK_SQL), [], /trial_used_at is absent or was not created by the paired migration/);
      expect(await trialColumns(client)).toBe(2);
    });
  });

  it('refuses, with nothing applied, when a trial column already exists', async () => {
    await inTransaction(async (client) => {
      await client.query(relaxed(ROLLBACK_SQL));
      await client.query('ALTER TABLE organizations ADD COLUMN trial_used_at TIMESTAMPTZ');
      await expectError(client, relaxed(MIGRATION_SQL), [], /a trial column already exists/);
      const { rows } = await client.query(`SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'organizations_trial_claim_complete'`);
      expect(rows[0].n).toBe(0);
    });
  });

  it('refuses when the checkout reservation migration is not applied', async () => {
    await inTransaction(async (client) => {
      await client.query(relaxed(ROLLBACK_SQL));
      await client.query(relaxed(RESERVATION_ROLLBACK_SQL));
      await expectError(client, relaxed(MIGRATION_SQL), [], /is 202611071200_add_checkout_reservation applied\?/);
      expect(await trialColumns(client)).toBe(0);
    });
  });
});
