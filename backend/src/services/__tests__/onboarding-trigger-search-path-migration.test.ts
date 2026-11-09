/**
 * Admin migration 202611091300_pin_onboarding_trigger_search_path (AWS connect
 * C-G0).
 *
 * initialize_onboarding_for_organization() is the AFTER INSERT trigger on
 * organizations that creates a new organization's onboarding_progress row. It
 * runs as a postgres-owned SECURITY DEFINER function. The migration pins its
 * search_path (pg_catalog, public, pg_temp), schema-qualifies its references,
 * and removes TEMPORARY on the database from PUBLIC and devcontrol.
 *
 * Static: the migration's shape, and that it is administrative.
 * Catalog (the bootstrapped schema, migration applied): the function's
 * attributes; every SECURITY DEFINER function pins a search_path that starts
 * with pg_catalog and has pg_temp, if present, last; devcontrol and PUBLIC have
 * no TEMPORARY on the database.
 * Behaviour, each in ONE rolled-back transaction, as a NOSUPERUSER NOBYPASSRLS
 * role that is given TEMPORARY explicitly (so the search_path fix is proven
 * independently of the revoke):
 *   - with the pre-migration definition (unqualified, no search_path), a
 *     temporary relation named onboarding_progress is resolved by the function
 *     and runs with the function owner's identity -- the condition this
 *     migration removes;
 *   - with the migrated definition the same temporary relation is ignored and
 *     public.onboarding_progress gets the row;
 *   - devcontrol cannot create a temporary table at all;
 *   - the paired rollback restores the pre-migration definition and TEMPORARY,
 *     the migration applies again on top of it, and it refuses a function body
 *     that is not 009's.
 */
import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getMigrationFiles } = require('../../../../database/migrate.js');

const ADMIN_DIR = path.join(__dirname, '../../../../database/migrations-admin');
const MIGRATION_FILE = '202611091300_pin_onboarding_trigger_search_path.sql';
const ROLLBACK_FILE = '202611091300_pin_onboarding_trigger_search_path_rollback.sql';
const MIGRATION_SQL = fs.readFileSync(path.join(ADMIN_DIR, MIGRATION_FILE), 'utf8');
const ROLLBACK_SQL = fs.readFileSync(path.join(ADMIN_DIR, ROLLBACK_FILE), 'utf8');
const ORIGINAL_SQL = fs.readFileSync(path.join(ADMIN_DIR, '009_create_onboarding_progress.sql'), 'utf8');
const PINNED_SEARCH_PATH = 'search_path=pg_catalog, public, pg_temp';

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
const normalize = (body: string) => body.replace(/\s+/g, ' ').trim();
/** The body between the dollar quotes of initialize_onboarding_for_organization's definition in `sql`. */
function functionBody(sql: string, open: string, close: string): string {
  const start = sql.indexOf(open, sql.indexOf('FUNCTION public.initialize_onboarding_for_organization()') >= 0
    ? sql.indexOf('FUNCTION public.initialize_onboarding_for_organization()')
    : sql.indexOf('FUNCTION initialize_onboarding_for_organization()'));
  const end = sql.indexOf(close, start + open.length);
  if (start < 0 || end < 0) throw new Error('function body not found');
  return sql.slice(start + open.length, end);
}
/** The rollback's CREATE OR REPLACE statement: the pre-migration production definition. */
const PRE_MIGRATION_DEFINITION = (ROLLBACK_SQL.match(/CREATE OR REPLACE FUNCTION[\s\S]*?\$function\$;/) ?? [])[0];

const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const ROLE = `tenant_reset_test_cg0_${suffix}`;
const admin = new Client(dbConfig());

beforeAll(async () => {
  await admin.connect();
  await admin.query(`CREATE ROLE ${ROLE} NOSUPERUSER NOBYPASSRLS`);
  await admin.query(`GRANT USAGE ON SCHEMA public TO ${ROLE}`);
  await admin.query(`GRANT SELECT, INSERT ON organizations TO ${ROLE}`);
  await admin.query(`DO $$ BEGIN EXECUTE format('GRANT TEMPORARY ON DATABASE %I TO ${ROLE}', current_database()); END $$`);
});

afterAll(async () => {
  await admin.query(`DROP OWNED BY ${ROLE}`);
  await admin.query(`DROP ROLE ${ROLE}`);
  await admin.end();
});

/** One fresh connection (no temporary schema yet), in a transaction that is always rolled back. */
async function inRolledBackTransaction<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client(dbConfig());
  await c.connect();
  try {
    await c.query('BEGIN');
    return await fn(c);
  } finally {
    await c.query('ROLLBACK').catch(() => undefined);
    await c.end();
  }
}

/**
 * As ROLE: a temporary onboarding_progress whose BEFORE INSERT trigger raises
 * (SQLSTATE P0T01) naming current_user, then a registration-shaped
 * organizations INSERT. Returns the new organization id, or throws.
 */
async function insertOrganizationWithTemporaryShadow(c: Client): Promise<string> {
  await c.query(`SET LOCAL ROLE ${ROLE}`);
  await c.query(`CREATE TEMP TABLE onboarding_progress (organization_id uuid UNIQUE, user_id uuid, current_stage text, started_at timestamptz)`);
  await c.query(`CREATE FUNCTION pg_temp.cg0_shadow_used() RETURNS trigger LANGUAGE plpgsql AS $$
                 BEGIN RAISE EXCEPTION 'temporary onboarding_progress used by %', current_user USING ERRCODE = 'P0T01'; END $$`);
  await c.query(`CREATE TRIGGER cg0_shadow_used BEFORE INSERT ON pg_temp.onboarding_progress
                 FOR EACH ROW EXECUTE FUNCTION pg_temp.cg0_shadow_used()`);
  const { rows } = await c.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ('cg0', $1, 'cg0', 'free', 'free') RETURNING id`,
    [`cg0-${suffix}-${Math.random().toString(36).slice(2, 8)}`]
  );
  return rows[0].id as string;
}

async function functionState(c: Client) {
  const { rows } = await c.query(
    `SELECT p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) AS owner, p.prosrc
       FROM pg_proc p WHERE p.oid = 'public.initialize_onboarding_for_organization()'::regprocedure`
  );
  return rows[0] as { prosecdef: boolean; proconfig: string[] | null; owner: string; prosrc: string };
}

describe('202611091300_pin_onboarding_trigger_search_path: static shape', () => {
  const sql = statements(MIGRATION_SQL);

  it('starts with the 3 s lock timeout', () => {
    expect(sql.trim().startsWith("SET LOCAL lock_timeout = '3s';")).toBe(true);
  });

  it('replaces only initialize_onboarding_for_organization: SECURITY DEFINER, pinned search_path, owner postgres', () => {
    expect(sql.match(/CREATE OR REPLACE FUNCTION\s+([\w.]+)/g)).toEqual(['CREATE OR REPLACE FUNCTION public.initialize_onboarding_for_organization']);
    expect(sql).toMatch(/LANGUAGE plpgsql\s+SECURITY DEFINER\s+SET search_path = pg_catalog, public, pg_temp\s+AS \$function\$/);
    expect(sql).toMatch(/ALTER FUNCTION public\.initialize_onboarding_for_organization\(\) OWNER TO postgres;/);
  });

  it('schema-qualifies every table and function reference in the new body', () => {
    const body = functionBody(MIGRATION_SQL, 'AS $function$', '$function$;');
    expect(statements(body).match(/\b(INTO|FROM|UPDATE|JOIN)\s+(?!public\.|pg_catalog\.)\w+/gi)).toBeNull();
    expect(statements(body)).toMatch(/pg_catalog\.now\(\)/);
  });

  it('the new body does exactly what 009 does (only qualification differs)', () => {
    const original = normalize(functionBody(ORIGINAL_SQL, 'RETURNS TRIGGER AS $$', '$$ LANGUAGE plpgsql;'));
    const migrated = normalize(functionBody(MIGRATION_SQL, 'AS $function$', '$function$;'))
      .replace('public.onboarding_progress', 'onboarding_progress')
      .replace('pg_catalog.now()', 'NOW()');
    expect(migrated).toBe(original);
  });

  it('the rollback restores 009 body exactly (whitespace aside), SECURITY DEFINER with no search_path', () => {
    const original = normalize(functionBody(ORIGINAL_SQL, 'RETURNS TRIGGER AS $$', '$$ LANGUAGE plpgsql;'));
    expect(normalize(functionBody(ROLLBACK_SQL, 'AS $function$', '$function$;'))).toBe(original);
    expect(PRE_MIGRATION_DEFINITION).toMatch(/SECURITY DEFINER\s+AS \$function\$/);
    expect(PRE_MIGRATION_DEFINITION).not.toMatch(/search_path/);
  });

  it('revokes TEMPORARY on the current database from PUBLIC and devcontrol, and changes nothing else', () => {
    expect(sql).toMatch(/REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC/);
    expect(sql).toMatch(/REVOKE TEMPORARY ON DATABASE %I FROM devcontrol/);
    expect(sql).not.toMatch(/\b(ALTER\s+TABLE|CREATE\s+TABLE|CREATE\s+TRIGGER|DROP\s|DELETE\s+FROM|TRUNCATE|GRANT\s)/i);
    expect(sql).not.toMatch(/\bUPDATE\s+\w+\s+SET\b/i);
  });

  it('is administrative: invisible to the ordinary path, and its rollback is never selected', () => {
    expect(getMigrationFiles(path.join(__dirname, '../../../../database/migrations'))).not.toContain(MIGRATION_FILE);
    const adminFiles: string[] = getMigrationFiles(ADMIN_DIR);
    expect(adminFiles).toContain(MIGRATION_FILE);
    expect(adminFiles).not.toContain(ROLLBACK_FILE);
    expect(adminFiles.indexOf(MIGRATION_FILE)).toBeGreaterThan(adminFiles.indexOf('009_create_onboarding_progress.sql'));
  });
});

describe('202611091300_pin_onboarding_trigger_search_path: catalog after the bootstrap', () => {
  it('the function is postgres-owned SECURITY DEFINER with the pinned search_path and a qualified body', async () => {
    const fn = await functionState(admin);
    expect(fn.prosecdef).toBe(true);
    expect(fn.owner).toBe('postgres');
    expect(fn.proconfig).toEqual([PINNED_SEARCH_PATH]);
    expect(fn.prosrc).toMatch(/INSERT INTO public\.onboarding_progress/);
  });

  it('every SECURITY DEFINER function pins a search_path that starts with pg_catalog and has pg_temp, if present, last', async () => {
    const { rows } = await admin.query(
      `SELECT p.oid::regprocedure::text AS fn, p.proconfig
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog', 'information_schema') ORDER BY 1`
    );
    expect(rows.length).toBeGreaterThan(0);
    const unpinned = rows.filter(({ proconfig }) => {
      const setting = (proconfig as string[] | null)?.find((s) => s.startsWith('search_path='));
      if (!setting) return true;
      const schemas = setting.slice('search_path='.length).split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
      const temp = schemas.indexOf('pg_temp');
      return schemas[0] !== 'pg_catalog' || (temp >= 0 && temp !== schemas.length - 1);
    });
    expect(unpinned).toEqual([]);
  });

  it('neither devcontrol nor PUBLIC has TEMPORARY on the database', async () => {
    const { rows } = await admin.query(
      `SELECT has_database_privilege('devcontrol', current_database(), 'TEMPORARY') AS devcontrol_temp,
              EXISTS (SELECT 1 FROM pg_database d, aclexplode(d.datacl) a
                       WHERE d.datname = current_database() AND a.grantee = 0 AND a.privilege_type = 'TEMPORARY') AS public_temp`
    );
    expect(rows[0]).toEqual({ devcontrol_temp: false, public_temp: false });
  });
});

describe('202611091300_pin_onboarding_trigger_search_path: behaviour', () => {
  it('BEFORE (pre-migration definition): a temporary onboarding_progress is resolved and runs as the function owner', async () => {
    await inRolledBackTransaction(async (c) => {
      await c.query(PRE_MIGRATION_DEFINITION as string);
      await expect(insertOrganizationWithTemporaryShadow(c)).rejects.toMatchObject({
        code: 'P0T01',
        message: 'temporary onboarding_progress used by postgres',
      });
    });
  });

  it('AFTER (migrated definition): the temporary relation is ignored and public.onboarding_progress gets the row', async () => {
    await inRolledBackTransaction(async (c) => {
      const orgId = await insertOrganizationWithTemporaryShadow(c);
      expect((await c.query('SELECT count(*)::int AS n FROM pg_temp.onboarding_progress')).rows[0].n).toBe(0);
      await c.query('RESET ROLE');
      const { rows } = await c.query(
        `SELECT current_stage, user_id FROM public.onboarding_progress WHERE organization_id = $1`,
        [orgId]
      );
      expect(rows).toEqual([{ current_stage: 'welcome', user_id: null }]);
    });
  });

  it('devcontrol cannot create a temporary table', async () => {
    await inRolledBackTransaction(async (c) => {
      await c.query('SET LOCAL ROLE devcontrol');
      await expect(c.query('CREATE TEMP TABLE cg0_probe (x int)')).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('the rollback restores the pre-migration state, the migration applies again on top of it, and it refuses a body that is not 009', async () => {
    await inRolledBackTransaction(async (c) => {
      await c.query(ROLLBACK_SQL);
      const rolledBack = await functionState(c);
      expect(rolledBack).toMatchObject({ prosecdef: true, owner: 'postgres', proconfig: null });
      expect(rolledBack.prosrc).not.toMatch(/public\.onboarding_progress/);
      expect((await c.query(`SELECT has_database_privilege('devcontrol', current_database(), 'TEMPORARY') AS t`)).rows[0].t).toBe(true);

      await c.query('SAVEPOINT reapply');
      await c.query(MIGRATION_SQL);
      expect(await functionState(c)).toMatchObject({ prosecdef: true, owner: 'postgres', proconfig: [PINNED_SEARCH_PATH] });
      expect((await c.query(`SELECT has_database_privilege('devcontrol', current_database(), 'TEMPORARY') AS t`)).rows[0].t).toBe(false);
      await c.query('ROLLBACK TO SAVEPOINT reapply');

      await c.query(`CREATE OR REPLACE FUNCTION public.initialize_onboarding_for_organization() RETURNS trigger
                     LANGUAGE plpgsql SECURITY DEFINER AS $f$ BEGIN RETURN NEW; END; $f$`);
      await expect(c.query(MIGRATION_SQL)).rejects.toThrow(/body differs from 009 -- refusing to proceed/);
    });
  });
});
