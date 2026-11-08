/**
 * Admin migration 202611071200_add_checkout_reservation: additive shape, the
 * reservation CHECK, the two identity indexes, refusal when production
 * already holds a duplicate, and a rollback that keeps a customer index that
 * predates it.
 *
 * The database cases run in rolled-back transactions on a connection of
 * their own (the bootstrap has already applied the migration).
 */
import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getMigrationFiles } = require('../../../../database/migrate.js');

const ADMIN_DIR = path.join(__dirname, '../../../../database/migrations-admin');
const MIGRATION_FILE = '202611071200_add_checkout_reservation.sql';
const ROLLBACK_FILE = '202611071200_add_checkout_reservation_rollback.sql';
const MIGRATION_SQL = fs.readFileSync(path.join(ADMIN_DIR, MIGRATION_FILE), 'utf8');
const ROLLBACK_SQL = fs.readFileSync(path.join(ADMIN_DIR, ROLLBACK_FILE), 'utf8');
// Other suites may hold row locks on organizations briefly; the 3 s production
// lock timeout is asserted statically below and widened only for these runs.
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
const COLUMNS = ['checkout_reservation_id', 'checkout_reservation_plan', 'checkout_reservation_expires_at', 'checkout_session_id'];

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

async function insertOrg(client: Client, label: string, customer: string | null, subscription: string | null): Promise<string> {
  const { rows } = await client.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status, stripe_customer_id, stripe_subscription_id)
     VALUES ($1, $1, $1, 'free', 'free', $2, $3) RETURNING id`,
    [`resv-mig-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, customer, subscription]
  );
  return rows[0].id;
}

describe('202611071200_add_checkout_reservation: static shape', () => {
  it('is additive: it adds columns, one CHECK and indexes, and never drops, deletes or updates anything', () => {
    const sql = statements(MIGRATION_SQL);
    expect(sql).toContain("SET LOCAL lock_timeout = '3s';");
    expect(sql).not.toMatch(/\bDROP\s|\bDELETE\s+FROM\b|\bTRUNCATE\b|\bUPDATE\s+\w+\s+SET\b|\bINSERT\s+INTO\b/i);
    expect(sql).not.toMatch(/\bALTER\s+TABLE\s+(?!organizations\b)/i);
    for (const column of COLUMNS) expect(sql).toContain(`ADD COLUMN ${column}`);
    expect(sql).toMatch(/CREATE UNIQUE INDEX idx_organizations_stripe_subscription_unique\s+ON organizations \(stripe_subscription_id\)\s+WHERE stripe_subscription_id IS NOT NULL;/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX idx_organizations_stripe_customer_unique\s+ON organizations \(stripe_customer_id\)\s+WHERE stripe_customer_id IS NOT NULL/);
  });

  it('is administrative: invisible to the ordinary path, last in the admin order, and its rollback is never selected', () => {
    expect(getMigrationFiles(path.join(__dirname, '../../../../database/migrations'))).not.toContain(MIGRATION_FILE);
    const adminFiles: string[] = getMigrationFiles(ADMIN_DIR);
    expect(adminFiles).toContain(MIGRATION_FILE);
    expect(adminFiles).not.toContain(ROLLBACK_FILE);
    expect(adminFiles.indexOf(MIGRATION_FILE)).toBeGreaterThan(adminFiles.indexOf('202608270610_add_stripe_fields.sql'));
  });

  it('the rollback drops only marked objects and never uses CASCADE', () => {
    const sql = statements(ROLLBACK_SQL);
    expect(sql).not.toMatch(/CASCADE/i);
    expect(sql).toContain("DELETE FROM schema_migrations\n WHERE migration_name = '202611071200_add_checkout_reservation.sql';");
  });
});

describe('202611071200_add_checkout_reservation: applied schema', () => {
  it('reservation columns are set together (CHECK)', async () => {
    await inTransaction(async (client) => {
      const orgId = await insertOrg(client, 'check', null, null);
      await expectError(client, `UPDATE organizations SET checkout_reservation_id = gen_random_uuid() WHERE id = $1`, [orgId],
        /organizations_checkout_reservation_complete/, '23514');
      await expectError(client, `UPDATE organizations SET checkout_session_id = 'cs_x' WHERE id = $1`, [orgId],
        /organizations_checkout_reservation_complete/, '23514');
      await client.query(
        `UPDATE organizations SET checkout_reservation_id = gen_random_uuid(), checkout_reservation_plan = 'starter:monthly',
                checkout_reservation_expires_at = NOW() + interval '35 minutes', checkout_session_id = 'cs_x' WHERE id = $1`, [orgId]);
    });
  });

  it('one Stripe subscription, and one Stripe customer, per organization at most', async () => {
    await inTransaction(async (client) => {
      const sub = `sub_resv_${Date.now()}`;
      const cus = `cus_resv_${Date.now()}`;
      await insertOrg(client, 'a', cus, sub);
      await expectError(client, `INSERT INTO organizations (name, slug, display_name, stripe_subscription_id) VALUES ('x1', 'x1-resv', 'x1', $1)`, [sub],
        /idx_organizations_stripe_subscription_unique/, '23505');
      await expectError(client, `INSERT INTO organizations (name, slug, display_name, stripe_customer_id) VALUES ('x2', 'x2-resv', 'x2', $1)`, [cus],
        /idx_organizations_stripe_customer_unique/, '23505');
      // NULLs are not constrained.
      await insertOrg(client, 'n1', null, null);
      await insertOrg(client, 'n2', null, null);
    });
  });
});

describe('202611071200_add_checkout_reservation: rollback, re-apply, refusal', () => {
  it('rolls back only its own objects (keeps the 202608270610 customer index), then re-applies', async () => {
    await inTransaction(async (client) => {
      await client.query(relaxed(ROLLBACK_SQL));
      const gone = await client.query(
        `SELECT (SELECT count(*) FROM pg_attribute WHERE attrelid = 'organizations'::regclass AND attname = ANY($1) AND NOT attisdropped)::int AS columns,
                to_regclass('idx_organizations_stripe_subscription_unique') IS NULL AS sub_index_gone,
                to_regclass('idx_organizations_stripe_customer_unique') IS NOT NULL AS customer_index_kept,
                (SELECT count(*) FROM schema_migrations WHERE migration_name = $2)::int AS ledger`,
        [COLUMNS, MIGRATION_FILE]
      );
      expect(gone.rows[0]).toEqual({ columns: 0, sub_index_gone: true, customer_index_kept: true, ledger: 0 });

      await client.query(relaxed(MIGRATION_SQL));
      const back = await client.query(
        `SELECT (SELECT count(*) FROM pg_attribute WHERE attrelid = 'organizations'::regclass AND attname = ANY($1) AND NOT attisdropped)::int AS columns,
                (SELECT indisunique AND indisvalid FROM pg_index WHERE indexrelid = 'idx_organizations_stripe_subscription_unique'::regclass) AS sub_index,
                obj_description('idx_organizations_stripe_customer_unique'::regclass, 'pg_class') AS customer_comment`,
        [COLUMNS]
      );
      expect(back.rows[0].columns).toBe(4);
      expect(back.rows[0].sub_index).toBe(true);
      // The customer index predates the migration, so it carries no marker and a later rollback keeps it.
      expect(String(back.rows[0].customer_comment ?? '')).not.toContain('[202611071200_add_checkout_reservation]');
    });
  });

  it('creates the customer index (with its marker) where it is absent, and the rollback then removes it', async () => {
    await inTransaction(async (client) => {
      await client.query(relaxed(ROLLBACK_SQL));
      await client.query('DROP INDEX idx_organizations_stripe_customer_unique');
      await client.query(relaxed(MIGRATION_SQL));
      const created = await client.query(`SELECT obj_description('idx_organizations_stripe_customer_unique'::regclass, 'pg_class') AS c`);
      expect(created.rows[0].c).toContain('[202611071200_add_checkout_reservation]');
      await client.query(relaxed(ROLLBACK_SQL));
      const after = await client.query(`SELECT to_regclass('idx_organizations_stripe_customer_unique') AS i`);
      expect(after.rows[0].i).toBeNull();
    });
  });

  it('refuses, with nothing applied, when two organizations share a subscription id or a customer id', async () => {
    await inTransaction(async (client) => {
      await client.query(relaxed(ROLLBACK_SQL));
      await client.query('DROP INDEX idx_organizations_stripe_customer_unique');
      const sub = `sub_dupe_${Date.now()}`;
      await insertOrg(client, 's1', null, sub);
      await insertOrg(client, 's2', null, sub);
      await expectError(client, relaxed(MIGRATION_SQL), [], /Stripe subscription id\(s\) are recorded on more than one organization/);
      await client.query(`UPDATE organizations SET stripe_subscription_id = NULL WHERE stripe_subscription_id = $1`, [sub]);

      const cus = `cus_dupe_${Date.now()}`;
      await insertOrg(client, 'c1', cus, null);
      await insertOrg(client, 'c2', cus, null);
      await expectError(client, relaxed(MIGRATION_SQL), [], /Stripe customer id\(s\) are recorded on more than one organization/);

      const none = await client.query(
        `SELECT count(*)::int AS n FROM pg_attribute WHERE attrelid = 'organizations'::regclass AND attname = ANY($1) AND NOT attisdropped`, [COLUMNS]);
      expect(none.rows[0].n).toBe(0);
    });
  });

  it('refuses an existing customer index with another definition', async () => {
    await inTransaction(async (client) => {
      await client.query(relaxed(ROLLBACK_SQL));
      await client.query('DROP INDEX idx_organizations_stripe_customer_unique');
      await client.query('CREATE INDEX idx_organizations_stripe_customer_unique ON organizations (stripe_customer_id)');
      await expectError(client, relaxed(MIGRATION_SQL), [], /exists but is not a valid UNIQUE/);
    });
  });
});
