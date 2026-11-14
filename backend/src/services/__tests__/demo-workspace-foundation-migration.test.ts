/**
 * Admin migration 202611141200_demo_workspace_foundation (demo workspace T2):
 *   - organizations.is_demo, at most one demo organization, fixed at insert;
 *   - the demo organization holds no billing, Stripe, trial, checkout or AWS
 *     credential state, while every other organization keeps every valid
 *     billing state;
 *   - demo_workspace_access: a grant names no organization, needs an existing
 *     demo organization, is unique per user and cascades with the user;
 *   - integration tables refuse demo rows and still accept real ones, also
 *     for the application role;
 *   - the demo's aws_accounts row is the placeholder only;
 *   - the rollback restores the previous schema exactly, and refuses while a
 *     demo organization exists.
 *
 * Database cases run in rolled-back transactions on a connection of their own
 * (the bootstrap has already applied the migration). Placeholder values only.
 */
import { Client, Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { ensureSharedFixtureTable } from '../../routes/__tests__/shared-fixture-tables';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getMigrationFiles } = require('../../../../database/migrate.js');

const ADMIN_DIR = path.join(__dirname, '../../../../database/migrations-admin');
const MIGRATION_FILE = '202611141200_demo_workspace_foundation.sql';
const ROLLBACK_FILE = '202611141200_demo_workspace_foundation_rollback.sql';
const MIGRATION_SQL = fs.readFileSync(path.join(ADMIN_DIR, MIGRATION_FILE), 'utf8');
const ROLLBACK_SQL = fs.readFileSync(path.join(ADMIN_DIR, ROLLBACK_FILE), 'utf8');
// Other suites may hold row locks on these tables briefly; the 3 s production
// lock timeout is asserted statically below and widened only for these runs.
const relaxed = (sql: string) => sql.replace("SET LOCAL lock_timeout = '3s';", "SET LOCAL lock_timeout = '60s';");
const MARKER = '[202611141200_demo_workspace_foundation]';
const INTEGRATION_TABLES = [
  'organization_invitations', 'scheduled_reports', 'observability_collection_scopes', 'aws_org_external_ids', 'aws_connection_checks',
];

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

/** The SQL with -- comments and '...' literals (doubled quotes included) blanked, scanned in one pass. */
function codeOnly(sql: string): string {
  let out = '';
  for (let i = 0; i < sql.length; ) {
    if (sql.startsWith('--', i)) {
      while (i < sql.length && sql[i] !== '\n') i += 1;
    } else if (sql[i] === "'") {
      i += 1;
      while (i < sql.length && !(sql[i] === "'" && sql[i + 1] !== "'")) i += sql[i] === "'" ? 2 : 1;
      i += 1;
      out += "''";
    } else {
      out += sql[i];
      i += 1;
    }
  }
  return out;
}

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
  let caught: { message?: unknown; code?: unknown } | null = null;
  try {
    await client.query(sql, params);
  } catch (error) {
    caught = error as { message?: unknown; code?: unknown };
  }
  await client.query('ROLLBACK TO SAVEPOINT expect_error');
  expect(caught).not.toBeNull();
  expect(String(caught?.message)).toMatch(pattern);
  if (code) expect(caught?.code).toBe(code);
}

async function expectOk(client: Client, sql: string, params: unknown[] = []): Promise<void> {
  await client.query('SAVEPOINT expect_ok');
  try {
    await client.query(sql, params);
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT expect_ok');
  }
}

let seq = 0;
const unique = (label: string) => `demo-mig-${label}-${process.pid}-${Date.now()}-${seq++}`;

async function insertOrg(client: Client, label: string, isDemo = false): Promise<string> {
  const name = unique(label);
  const { rows } = await client.query(
    `INSERT INTO organizations (name, slug, display_name, is_demo) VALUES ($1, $1, $1, $2) RETURNING id`, [name, isDemo]);
  return rows[0].id;
}

async function insertUser(client: Client, label: string): Promise<string> {
  const { rows } = await client.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'demo migration probe') RETURNING id`,
    [`${unique(label)}@probe.invalid`]);
  return rows[0].id;
}

/** One minimal valid row for each integration table, for organization $1. */
const INTEGRATION_INSERT: Record<string, string> = {
  organization_invitations: `INSERT INTO organization_invitations (organization_id, email, role, invitation_token, invitation_expires_at)
                               VALUES ($1, 'invitee@probe.invalid', 'member', md5(random()::text), NOW() + interval '1 day')`,
  scheduled_reports: `INSERT INTO scheduled_reports (organization_id, name, report_type, schedule_type, schedule_time, delivery_email)
                        VALUES ($1, 'probe report', 'cost_summary', 'daily', '09:00', true)`,
  observability_collection_scopes: `INSERT INTO observability_collection_scopes (organization_id, aws_account_id, region)
                                      VALUES ($1, '111122223333', 'us-east-1')`,
  aws_org_external_ids: `INSERT INTO aws_org_external_ids (organization_id, external_id, source) VALUES ($1, 'probe-external-id', 'generated')`,
  aws_connection_checks: `INSERT INTO aws_connection_checks (aws_account_id, organization_id) VALUES (gen_random_uuid(), $1)`,
};

/** The schema objects the migration may touch, for an exact before/after comparison. */
async function schemaShape(client: Client): Promise<string[]> {
  const tables = ['organizations', 'users', ...INTEGRATION_TABLES, 'aws_accounts'];
  const { rows } = await client.query(
    `SELECT 'column|' || c.relname || '|' || a.attname || '|' || format_type(a.atttypid, a.atttypmod) || '|' || a.attnotnull
              || '|' || coalesce(pg_get_expr(d.adbin, d.adrelid), '') AS line
       FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
       LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY($1) AND a.attnum > 0 AND NOT a.attisdropped
     UNION ALL
     SELECT 'constraint|' || conrelid::regclass::text || '|' || conname || '|' || pg_get_constraintdef(oid)
       FROM pg_constraint WHERE conrelid = ANY(SELECT oid FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname = ANY($1))
     UNION ALL
     SELECT 'index|' || tablename || '|' || indexname || '|' || indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = ANY($1)
     UNION ALL
     SELECT 'trigger|' || tgrelid::regclass::text || '|' || tgname || '|' || pg_get_triggerdef(oid)
       FROM pg_trigger WHERE NOT tgisinternal AND tgrelid = ANY(SELECT oid FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname = ANY($1))
     UNION ALL
     SELECT 'acl|' || relname || '|' || coalesce(relacl::text, '') FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname = ANY($1)
     UNION ALL
     SELECT 'function|' || proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'demo\\_workspace\\_%'
     UNION ALL
     SELECT 'table|demo_workspace_access' WHERE to_regclass('public.demo_workspace_access') IS NOT NULL
     ORDER BY 1`,
    [tables]
  );
  return rows.map((r) => r.line);
}

const isDemoObject = (line: string) =>
  /\|is_demo\||organizations_single_demo_uidx|organizations_demo_holds_no_billing_or_credentials|organizations_demo_flag_immutable|demo_workspace_/.test(line);

describe('202611141200_demo_workspace_foundation: static shape', () => {
  it('is administrative, after the latest admin migration, and its rollback is never selected', () => {
    expect(getMigrationFiles(path.join(__dirname, '../../../../database/migrations'))).not.toContain(MIGRATION_FILE);
    const adminFiles: string[] = getMigrationFiles(ADMIN_DIR);
    expect(adminFiles).toContain(MIGRATION_FILE);
    expect(adminFiles).not.toContain(ROLLBACK_FILE);
    expect(adminFiles.indexOf(MIGRATION_FILE)).toBeGreaterThan(adminFiles.indexOf('202611121200_add_users_previous_login_at.sql'));
    expect(adminFiles.indexOf(MIGRATION_FILE)).toBeGreaterThan(adminFiles.indexOf('202611091200_add_trial_used_at.sql'));
  });

  it('is additive: no data change, no drop, a 3 s lock timeout, one ALTER on organizations only', () => {
    const sql = statements(MIGRATION_SQL);
    expect(sql).toContain("SET LOCAL lock_timeout = '3s';");
    // Literals blanked: the self-check names privileges such as 'TRUNCATE'.
    expect(codeOnly(MIGRATION_SQL)).not.toMatch(/\bDROP\s|\bDELETE\s+FROM\b|\bTRUNCATE\b|\bUPDATE\s+\w+\s+SET\b|\bINSERT\s+INTO\b/i);
    expect(sql).not.toMatch(/\bALTER\s+TABLE\s+(?!public\.organizations\b)/i);
    expect(sql).toContain('ADD COLUMN is_demo BOOLEAN NOT NULL DEFAULT false');
  });

  it('the grant table DDL has no organization column', () => {
    const ddl = statements(MIGRATION_SQL).match(/CREATE TABLE public\.demo_workspace_access \(([\s\S]*?)\n\);/);
    expect(ddl).not.toBeNull();
    expect(ddl![1]).not.toMatch(/organization|org_id/i);
  });

  it('the rollback refuses while a demo exists, checks the marker, deletes its ledger row and never uses CASCADE', () => {
    const sql = statements(ROLLBACK_SQL);
    expect(sql).not.toMatch(/CASCADE/i);
    expect(sql).toContain(MARKER);
    expect(sql).toContain('IF EXISTS (SELECT 1 FROM public.organizations WHERE is_demo) THEN');
    expect(sql).toContain("DELETE FROM schema_migrations\n WHERE migration_name = '202611141200_demo_workspace_foundation.sql';");
    expect(sql).toContain("SET LOCAL lock_timeout = '3s';");
  });
});

describe('202611141200_demo_workspace_foundation: the marker and the one-demo rule', () => {
  it('is_demo is a marked boolean NOT NULL DEFAULT false; no existing organization is a demo; a new one defaults to false', async () => {
    await inTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull, pg_get_expr(d.adbin, d.adrelid) AS def,
                col_description(a.attrelid, a.attnum) AS comment
           FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
          WHERE a.attrelid = 'organizations'::regclass AND a.attname = 'is_demo' AND NOT a.attisdropped`);
      expect(rows).toHaveLength(1);
      expect([rows[0].type, rows[0].attnotnull, rows[0].def]).toEqual(['boolean', true, 'false']);
      expect(String(rows[0].comment).startsWith(MARKER)).toBe(true);
      const { rows: demos } = await client.query(`SELECT count(*)::int AS n FROM organizations WHERE is_demo`);
      expect(demos[0].n).toBe(0);
      const name = unique('default');
      const { rows: inserted } = await client.query(
        `INSERT INTO organizations (name, slug, display_name) VALUES ($1, $1, $1) RETURNING is_demo`, [name]);
      expect(inserted[0].is_demo).toBe(false);
    });
  });

  it('a second demo organization fails; many real organizations are fine', async () => {
    await inTransaction(async (client) => {
      await insertOrg(client, 'first-demo', true);
      await insertOrg(client, 'real-a');
      await insertOrg(client, 'real-b');
      const name = unique('second-demo');
      await expectError(client, `INSERT INTO organizations (name, slug, display_name, is_demo) VALUES ($1, $1, $1, true)`, [name],
        /organizations_single_demo_uidx/, '23505');
    });
  });

  it('is_demo cannot change after insert, in either direction; other columns of the demo still update', async () => {
    await inTransaction(async (client) => {
      const real = await insertOrg(client, 'real');
      const demo = await insertOrg(client, 'demo', true);
      await expectError(client, `UPDATE organizations SET is_demo = true WHERE id = $1`, [real], /is_demo is fixed/, '23514');
      await expectError(client, `UPDATE organizations SET is_demo = false WHERE id = $1`, [demo], /is_demo is fixed/, '23514');
      await expectOk(client, `UPDATE organizations SET display_name = 'Example SaaS (sample)', is_demo = true WHERE id = $1`, [demo]);
    });
  });
});

describe('202611141200_demo_workspace_foundation: the demo holds no billing or credential state', () => {
  // Each prohibited state, as a SET clause on the demo organization.
  const PROHIBITED: Array<[string, string]> = [
    ['paid tier starter', `subscription_tier = 'starter'`],
    ['paid tier pro', `subscription_tier = 'pro'`],
    ['paid tier enterprise', `subscription_tier = 'enterprise'`],
    ['subscription status active', `subscription_status = 'active'`],
    ['subscription status trialing', `subscription_status = 'trialing'`],
    ['Stripe customer', `stripe_customer_id = 'cus_demo_probe'`],
    ['Stripe customer as empty string', `stripe_customer_id = ''`],
    ['Stripe subscription', `stripe_subscription_id = 'sub_demo_probe'`],
    ['Stripe subscription as empty string', `stripe_subscription_id = ''`],
    ['period start', `subscription_current_period_start = NOW()`],
    ['period end', `subscription_current_period_end = NOW()`],
    ['cancel at period end', `subscription_cancel_at_period_end = true`],
    ['processed invoice watermark', `latest_processed_invoice_created_at = NOW()`],
    ['processed subscription event watermark', `latest_processed_subscription_event_created_at = NOW()`],
    ['grace period', `billing_lifecycle_state = 'grace_period', grace_period_ends_at = NOW() + interval '7 days', payment_failed_at = NOW()`],
    ['restricted', `billing_lifecycle_state = 'restricted'`],
    ['payment failed', `payment_failed_at = NOW()`],
    ['grace deadline alone', `grace_period_ends_at = NOW()`],
    ['payment failure notice sent', `payment_failed_notification_sent_at = NOW()`],
    ['checkout reservation', `checkout_reservation_id = gen_random_uuid(), checkout_reservation_plan = 'pro', checkout_reservation_expires_at = NOW() + interval '31 minutes'`],
    ['checkout session', `checkout_reservation_id = gen_random_uuid(), checkout_reservation_plan = 'pro', checkout_reservation_expires_at = NOW() + interval '31 minutes', checkout_session_id = 'cs_demo_probe'`],
    ['trial claimed', `trial_used_at = NOW()`],
    ['trial with subscription', `trial_used_at = NOW(), trial_subscription_id = 'sub_demo_probe'`],
    ['stored AWS credentials', `aws_credentials_encrypted = 'ciphertext-probe'`],
  ];

  it.each(PROHIBITED)('refuses %s on the demo organization (CHECK)', async (_label, set) => {
    await inTransaction(async (client) => {
      const demo = await insertOrg(client, 'demo', true);
      await expectError(client, `UPDATE organizations SET ${set} WHERE id = $1`, [demo],
        /organizations_demo_holds_no_billing_or_credentials/, '23514');
    });
  });

  it('refuses a demo organization inserted with billing state, and accepts a clean one', async () => {
    await inTransaction(async (client) => {
      const name = unique('dirty-demo');
      await expectError(client,
        `INSERT INTO organizations (name, slug, display_name, is_demo, subscription_tier) VALUES ($1, $1, $1, true, 'pro')`, [name],
        /organizations_demo_holds_no_billing_or_credentials/, '23514');
      await insertOrg(client, 'clean-demo', true);
    });
  });

  it('a real organization still takes every valid billing state: trial, checkout, paid, grace, restricted, credentials', async () => {
    await inTransaction(async (client) => {
      const real = await insertOrg(client, 'real');
      for (const set of [
        `checkout_reservation_id = gen_random_uuid(), checkout_reservation_plan = 'pro', checkout_reservation_expires_at = NOW() + interval '31 minutes', checkout_session_id = 'cs_real_probe'`,
        `checkout_reservation_id = NULL, checkout_reservation_plan = NULL, checkout_reservation_expires_at = NULL, checkout_session_id = NULL`,
        `stripe_customer_id = 'cus_real_probe_${process.pid}', stripe_subscription_id = 'sub_real_probe_${process.pid}', subscription_tier = 'pro', subscription_status = 'trialing', trial_used_at = NOW(), trial_subscription_id = 'sub_real_probe_${process.pid}'`,
        `subscription_status = 'active', subscription_tier = 'enterprise', subscription_current_period_start = NOW(), subscription_current_period_end = NOW() + interval '30 days', latest_processed_invoice_created_at = NOW(), latest_processed_subscription_event_created_at = NOW()`,
        `subscription_status = 'past_due', billing_lifecycle_state = 'grace_period', payment_failed_at = NOW(), grace_period_ends_at = NOW() + interval '7 days', payment_failed_notification_sent_at = NOW()`,
        `billing_lifecycle_state = 'restricted', subscription_cancel_at_period_end = true`,
        `aws_credentials_encrypted = 'ciphertext-probe'`,
      ]) {
        await client.query(`UPDATE organizations SET ${set} WHERE id = $1`, [real]);
      }
    });
  });
});

describe('202611141200_demo_workspace_foundation: demo_workspace_access', () => {
  it('names no organization, is owned by the migration role, and gives devcontrol exactly SELECT, INSERT, DELETE', async () => {
    await inTransaction(async (client) => {
      const { rows: cols } = await client.query(
        `SELECT attname FROM pg_attribute WHERE attrelid = 'demo_workspace_access'::regclass AND attnum > 0 AND NOT attisdropped ORDER BY attnum`);
      expect(cols.map((r) => r.attname)).toEqual(['user_id', 'granted_at', 'source']);
      const { rows: privs } = await client.query(
        `SELECT p, has_table_privilege('devcontrol', 'demo_workspace_access', p) AS granted
           FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p`);
      expect(Object.fromEntries(privs.map((r) => [r.p, r.granted]))).toEqual({
        SELECT: true, INSERT: true, UPDATE: false, DELETE: true, TRUNCATE: false, REFERENCES: false, TRIGGER: false,
      });
      const { rows: comment } = await client.query(`SELECT obj_description('demo_workspace_access'::regclass, 'pg_class') AS c`);
      expect(String(comment[0].c).startsWith(MARKER)).toBe(true);
    });
  });

  it('a grant cannot be inserted while no demo organization exists', async () => {
    await inTransaction(async (client) => {
      const user = await insertUser(client, 'no-demo');
      await expectError(client, `INSERT INTO demo_workspace_access (user_id, source) VALUES ($1, 'self')`, [user],
        /no demo organization exists/, '23514');
    });
  });

  it('one grant per user; source is self or founder; revoking one leaves the others; deleting the user cascades', async () => {
    await inTransaction(async (client) => {
      await insertOrg(client, 'demo', true);
      const [a, b, c] = [await insertUser(client, 'a'), await insertUser(client, 'b'), await insertUser(client, 'c')];
      await client.query(`INSERT INTO demo_workspace_access (user_id, source) VALUES ($1, 'self'), ($2, 'founder'), ($3, 'self')`, [a, b, c]);
      await expectError(client, `INSERT INTO demo_workspace_access (user_id, source) VALUES ($1, 'self')`, [a],
        /demo_workspace_access_pkey/, '23505');
      const other = await insertUser(client, 'other');
      await expectError(client, `INSERT INTO demo_workspace_access (user_id, source) VALUES ($1, 'admin')`, [other],
        /demo_workspace_access_source_check/, '23514');

      await client.query(`DELETE FROM demo_workspace_access WHERE user_id = $1`, [a]);
      await client.query(`DELETE FROM users WHERE id = $1`, [b]);
      const { rows } = await client.query(
        `SELECT user_id FROM demo_workspace_access WHERE user_id = ANY($1) ORDER BY user_id`, [[a, b, c]]);
      expect(rows.map((r) => r.user_id)).toEqual([c]);
    });
  });

  it('a grant cannot point at or imply a real organization: no organization column, and no real organization can become the demo', async () => {
    await inTransaction(async (client) => {
      const real = await insertOrg(client, 'real');
      const demo = await insertOrg(client, 'demo', true);
      const user = await insertUser(client, 'u');
      await client.query(`INSERT INTO demo_workspace_access (user_id, source) VALUES ($1, 'self')`, [user]);
      await expectError(client, `INSERT INTO demo_workspace_access (user_id, source, organization_id) VALUES ($1, 'self', $2)`,
        [await insertUser(client, 'u2'), real], /column "organization_id" .* does not exist/, '42703');
      await expectError(client, `UPDATE organizations SET is_demo = true WHERE id = $1`, [real], /is_demo is fixed/);
      await expectError(client, `UPDATE organizations SET is_demo = false WHERE id = $1`, [demo], /is_demo is fixed/);
      // The only organization any grant can imply:
      const { rows } = await client.query(`SELECT id FROM organizations WHERE is_demo`);
      expect(rows.map((r) => r.id)).toEqual([demo]);
    });
  });

  it('as devcontrol: insert, read and delete a grant work; update is denied', async () => {
    await inTransaction(async (client) => {
      await insertOrg(client, 'demo', true);
      const user = await insertUser(client, 'dc');
      await client.query('SET LOCAL ROLE devcontrol');
      await client.query(`INSERT INTO demo_workspace_access (user_id, source) VALUES ($1, 'self')`, [user]);
      const { rows } = await client.query(`SELECT source FROM demo_workspace_access WHERE user_id = $1`, [user]);
      expect(rows).toEqual([{ source: 'self' }]);
      await expectError(client, `UPDATE demo_workspace_access SET source = 'founder' WHERE user_id = $1`, [user],
        /permission denied/, '42501');
      await client.query(`DELETE FROM demo_workspace_access WHERE user_id = $1`, [user]);
      await client.query('RESET ROLE');
    });
  });
});

describe('202611141200_demo_workspace_foundation: integration rows', () => {
  it.each(INTEGRATION_TABLES)('%s refuses a row for the demo organization and accepts one for a real organization', async (table) => {
    await inTransaction(async (client) => {
      const real = await insertOrg(client, 'real');
      const demo = await insertOrg(client, 'demo', true);
      await expectError(client, INTEGRATION_INSERT[table], [demo], new RegExp(`${table} rows are not allowed for the demo organization`), '23514');
      await expectOk(client, INTEGRATION_INSERT[table], [real]);
      const { rows } = await client.query(
        `SELECT tgenabled, obj_description(oid, 'pg_trigger') AS comment FROM pg_trigger
          WHERE tgrelid = $1::regclass AND tgname = 'demo_workspace_refuse_row'`, [table]);
      expect(rows).toHaveLength(1);
      expect(rows[0].tgenabled).toBe('O');
      expect(String(rows[0].comment).startsWith(MARKER)).toBe(true);
    });
  });

  it('an existing real row cannot be moved onto the demo organization', async () => {
    await inTransaction(async (client) => {
      const real = await insertOrg(client, 'real');
      const demo = await insertOrg(client, 'demo', true);
      await client.query(INTEGRATION_INSERT.scheduled_reports, [real]);
      await expectError(client, `UPDATE scheduled_reports SET organization_id = $1 WHERE organization_id = $2`, [demo, real],
        /scheduled_reports rows are not allowed for the demo organization/, '23514');
    });
  });

  it('as devcontrol (no SELECT on organizations here): demo invitations are refused, real ones still insert', async () => {
    await inTransaction(async (client) => {
      const real = await insertOrg(client, 'real');
      const demo = await insertOrg(client, 'demo', true);
      await client.query('SET LOCAL ROLE devcontrol');
      await expectError(client, INTEGRATION_INSERT.organization_invitations, [demo],
        /organization_invitations rows are not allowed for the demo organization/, '23514');
      await expectOk(client, INTEGRATION_INSERT.organization_invitations, [real]);
      await client.query('RESET ROLE');
    });
  });

  it('every demo_workspace_* function is a postgres-owned SECURITY DEFINER with a pinned search_path and no EXECUTE for devcontrol', async () => {
    await inTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT proname, prosecdef, proconfig, has_function_privilege('devcontrol', oid, 'EXECUTE') AS exec,
                starts_with(coalesce(obj_description(oid, 'pg_proc'), ''), $1) AS marked
           FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'demo\\_workspace\\_%' ORDER BY proname`, [MARKER]);
      expect(rows.map((r) => r.proname)).toEqual([
        'demo_workspace_access_requires_demo', 'demo_workspace_constrain_aws_account', 'demo_workspace_flag_immutable', 'demo_workspace_refuse_row',
      ]);
      for (const r of rows) {
        expect([r.prosecdef, r.proconfig, r.exec, r.marked]).toEqual([true, ['search_path=pg_catalog, pg_temp'], false, true]);
      }
    });
  });
});

describe('202611141200_demo_workspace_foundation: the demo AWS row (aws_accounts exists in production)', () => {
  beforeAll(async () => {
    const pool = new Pool(dbConfig());
    try {
      await ensureSharedFixtureTable(pool, 'aws_accounts');
    } finally {
      await pool.end();
    }
  });

  it('with aws_accounts present, the demo row must be the placeholder with no External ID; real rows are unaffected', async () => {
    await inTransaction(async (client) => {
      // The bootstrap ran before the fixture table existed: re-apply so the trigger attaches, as in production.
      await client.query(relaxed(ROLLBACK_SQL));
      await client.query(relaxed(MIGRATION_SQL));
      const { rows: trig } = await client.query(
        `SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid = 'aws_accounts'::regclass AND tgname = 'demo_workspace_constrain_aws_account'`);
      expect(trig[0].n).toBe(1);
      await client.query(`DELETE FROM aws_accounts WHERE account_id IN ('111122223333', '444455556666')`);

      const real = await insertOrg(client, 'real');
      const demo = await insertOrg(client, 'demo', true);
      const insert = `INSERT INTO aws_accounts (org_id, role_arn, account_id, external_id) VALUES ($1, $2, $3, $4)`;
      const pattern = /the demo organization's AWS row must be the placeholder account 111122223333/;
      await expectError(client, insert, [demo, 'arn:aws:iam::444455556666:role/DevControlRole', '444455556666', null], pattern, '23514');
      await expectError(client, insert, [demo, 'arn:aws:iam::444455556666:role/DevControlRole', '111122223333', null], pattern, '23514');
      await expectError(client, insert, [demo, 'arn:aws:iam::111122223333:role/DevControlRole', '111122223333', 'probe-external-id'], pattern, '23514');
      await client.query(insert, [demo, 'arn:aws:iam::111122223333:role/DevControlRole', '111122223333', null]);
      await expectError(client, `UPDATE aws_accounts SET external_id = 'probe-external-id' WHERE org_id = $1`, [demo], pattern, '23514');
      await expectOk(client, insert, [real, 'arn:aws:iam::444455556666:role/DevControlRole', '444455556666', 'probe-external-id']);
    });
  });
});

describe('202611141200_demo_workspace_foundation: rollback, re-apply, refusal', () => {
  it('the rollback restores the previous schema exactly (only marked objects go) and removes its ledger row; re-apply restores it', async () => {
    await inTransaction(async (client) => {
      await client.query(`INSERT INTO schema_migrations (migration_name, checksum) VALUES ($1, 'test') ON CONFLICT (migration_name) DO NOTHING`, [MIGRATION_FILE]);
      const applied = await schemaShape(client);
      expect(applied.filter(isDemoObject).length).toBeGreaterThan(10);

      await client.query(relaxed(ROLLBACK_SQL));
      const rolledBack = await schemaShape(client);
      expect(rolledBack.filter(isDemoObject)).toEqual([]);
      expect(rolledBack).toEqual(applied.filter((line) => !isDemoObject(line)));
      const { rows } = await client.query(`SELECT count(*)::int AS n FROM schema_migrations WHERE migration_name = $1`, [MIGRATION_FILE]);
      expect(rows[0].n).toBe(0);

      await client.query(relaxed(MIGRATION_SQL));
      // Re-applying attaches the aws_accounts trigger whenever that table exists now. The CI
      // bootstrap ran before the fixture table existed, so the original apply may not have.
      const awsTrigger = (line: string) => line.startsWith('trigger|aws_accounts|demo_workspace_constrain_aws_account|');
      const reapplied = await schemaShape(client);
      expect(reapplied.filter((l) => !awsTrigger(l))).toEqual(applied.filter((l) => !awsTrigger(l)));
      const { rows: aws } = await client.query(`SELECT to_regclass('public.aws_accounts') IS NOT NULL AS present`);
      expect(reapplied.some(awsTrigger)).toBe(aws[0].present);
    });
  });

  it('the rollback refuses while a demo organization exists, and changes nothing', async () => {
    await inTransaction(async (client) => {
      await insertOrg(client, 'demo', true);
      const before = await schemaShape(client);
      await expectError(client, relaxed(ROLLBACK_SQL), [], /a demo organization exists: delete it first/);
      expect(await schemaShape(client)).toEqual(before);
    });
  });

  it('the rollback refuses an is_demo column the migration did not create (no marker)', async () => {
    await inTransaction(async (client) => {
      await client.query(`COMMENT ON COLUMN organizations.is_demo IS 'something else'`);
      await expectError(client, relaxed(ROLLBACK_SQL), [], /is_demo is absent or was not created by the paired migration/);
    });
  });

  it('refuses, with nothing applied, when run twice', async () => {
    await inTransaction(async (client) => {
      const before = await schemaShape(client);
      await expectError(client, relaxed(MIGRATION_SQL), [], /organizations\.is_demo already exists/);
      expect(await schemaShape(client)).toEqual(before);
    });
  });
});
