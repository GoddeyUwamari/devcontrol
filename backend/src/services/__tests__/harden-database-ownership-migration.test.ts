/**
 * Admin migration 202611091300_harden_database_ownership (AWS connect C-G0).
 *
 * The migration: creates nl_query_analytics and its two indexes when absent;
 * makes postgres the database owner; revokes CREATE and TEMPORARY on the
 * database from PUBLIC and devcontrol, and CREATE on schema public from PUBLIC
 * and devcontrol; makes initialize_onboarding_for_organization() (the AFTER
 * INSERT trigger on organizations that creates the onboarding_progress row) a
 * postgres-owned SECURITY DEFINER function with a pinned search_path and
 * schema-qualified references; and records the prior state for its rollback.
 *
 * Static: the migration's shape, and that it is administrative.
 * Catalog (the bootstrapped schema, migration applied): ownership and
 * privileges; every SECURITY DEFINER function pins a search_path that starts
 * with pg_catalog and has pg_temp, if present, last; nl_query_analytics; the
 * recorded prior state.
 * Behaviour, each in ONE rolled-back transaction:
 *   - with the pre-migration definition (unqualified, no search_path), a
 *     temporary relation named onboarding_progress is resolved by the function
 *     and runs with the function owner's identity -- the condition this
 *     migration removes; with the migrated definition it is ignored and
 *     public.onboarding_progress gets the row (as a NOSUPERUSER NOBYPASSRLS
 *     role given TEMPORARY explicitly, so the search_path fix is proven
 *     independently of the revoke);
 *   - devcontrol can create neither a temporary table nor a table in public,
 *     not even CREATE TABLE IF NOT EXISTS on the existing nl_query_analytics;
 *   - the guard refuses a second run and a function body that is not 009's.
 * The exact restore by the paired rollback (database owned by devcontrol;
 * public owned by pg_database_owner or by postgres with CREATE for PUBLIC) is
 * rehearsed end to end on dedicated scratch databases by the founder scripts,
 * not here: it changes shared catalog rows other suites grant on.
 */
import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getMigrationFiles } = require('../../../../database/migrate.js');

const ADMIN_DIR = path.join(__dirname, '../../../../database/migrations-admin');
const MIGRATION_FILE = '202611091300_harden_database_ownership.sql';
const ROLLBACK_FILE = '202611091300_harden_database_ownership_rollback.sql';
const MIGRATION_SQL = fs.readFileSync(path.join(ADMIN_DIR, MIGRATION_FILE), 'utf8');
const ROLLBACK_SQL = fs.readFileSync(path.join(ADMIN_DIR, ROLLBACK_FILE), 'utf8');
const ORIGINAL_SQL = fs.readFileSync(path.join(ADMIN_DIR, '009_create_onboarding_progress.sql'), 'utf8');
const PINNED_SEARCH_PATH = 'search_path=pg_catalog, public, pg_temp';
/** nl_query_analytics' columns as the application always created them (name:type:not null:default). */
const NL_COLUMNS =
  'id:uuid:true:gen_random_uuid(),organization_id:uuid:true:,query:text:true:,target:character varying(50):true:,' +
  'action:character varying(50):true:,filter_count:integer:false:0,confidence:character varying(20):true:,' +
  'was_cached:boolean:false:false,response_time:integer:true:,created_at:timestamp without time zone:false:now()';

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
  const anchor = sql.indexOf('FUNCTION public.initialize_onboarding_for_organization()') >= 0
    ? sql.indexOf('FUNCTION public.initialize_onboarding_for_organization()')
    : sql.indexOf('FUNCTION initialize_onboarding_for_organization()');
  const start = sql.indexOf(open, anchor);
  const end = sql.indexOf(close, start + open.length);
  if (anchor < 0 || start < 0 || end < 0) throw new Error('function body not found');
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
     VALUES ($1, $1, $1, 'free', 'free') RETURNING id`,
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

describe('202611091300_harden_database_ownership: static shape', () => {
  const sql = statements(MIGRATION_SQL);

  it('starts with the 3 s lock timeout', () => {
    expect(sql.trim().startsWith("SET LOCAL lock_timeout = '3s';")).toBe(true);
  });

  it('makes postgres the database owner and revokes CREATE/TEMPORARY (database) and CREATE (public) from PUBLIC and devcontrol', () => {
    expect(sql).toMatch(/EXECUTE format\('ALTER DATABASE %I OWNER TO postgres', current_database\(\)\)/);
    expect(sql).toMatch(/REVOKE CREATE, TEMPORARY ON DATABASE %I FROM PUBLIC/);
    expect(sql).toMatch(/REVOKE CREATE, TEMPORARY ON DATABASE %I FROM devcontrol/);
    expect(sql).toMatch(/REVOKE CREATE ON SCHEMA public FROM PUBLIC;/);
    expect(sql).toMatch(/REVOKE CREATE ON SCHEMA public FROM devcontrol;/);
    expect(sql).not.toMatch(/\bGRANT\s+(ALL|CREATE|TEMPORARY)\b/i);
  });

  it('refuses unless devcontrol is NOSUPERUSER, NOBYPASSRLS, NOCREATEROLE and not a member of postgres, and owns no schema, extension, publication, subscription or event trigger', () => {
    expect(sql).toMatch(/IF r\.rolsuper OR r\.rolbypassrls OR r\.rolcreaterole THEN/);
    expect(sql).toMatch(/pg_has_role\('devcontrol', 'postgres', 'MEMBER'\)/);
    for (const catalog of ['pg_namespace WHERE nspowner', 'pg_extension', 'pg_publication', 'pg_subscription', 'pg_event_trigger']) {
      expect(sql).toContain(catalog);
    }
  });

  it('creates or alters no table but nl_query_analytics and admin_migration_prior_state, and no index but the two nl_query_analytics ones', () => {
    const tables = [...sql.matchAll(/\b(?:CREATE TABLE(?: IF NOT EXISTS)?|ALTER TABLE)\s+([\w.]+)/g)].map((m) => m[1]);
    expect(new Set(tables)).toEqual(new Set(['public.admin_migration_prior_state', 'public.nl_query_analytics']));
    const indexes = [...sql.matchAll(/\bCREATE (?:UNIQUE )?INDEX\s+(\w+)\s+ON\s+([\w.]+)/g)].map((m) => `${m[1]} ON ${m[2]}`);
    expect(indexes).toEqual(['idx_nl_analytics_org_created ON public.nl_query_analytics', 'idx_nl_analytics_query ON public.nl_query_analytics']);
    expect(sql).not.toMatch(/\b(DROP\s|DELETE\s+FROM|TRUNCATE)/i);
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

  it('the rollback restores 009 body exactly (whitespace aside), with no search_path', () => {
    const original = normalize(functionBody(ORIGINAL_SQL, 'RETURNS TRIGGER AS $$', '$$ LANGUAGE plpgsql;'));
    expect(normalize(functionBody(ROLLBACK_SQL, 'AS $function$', '$function$;'))).toBe(original);
    expect(PRE_MIGRATION_DEFINITION).toMatch(/SECURITY DEFINER\s+AS \$function\$/);
    expect(PRE_MIGRATION_DEFINITION).not.toMatch(/search_path/);
  });

  it('the rollback restores from the recorded prior state and refuses unless the restored state equals it', () => {
    const rb = statements(ROLLBACK_SQL);
    expect(rb).toMatch(/FROM public\.admin_migration_prior_state/);
    expect(rb).toMatch(/ALTER DATABASE %I OWNER TO %I', db, prior->>'db_owner'/);
    expect(rb).toMatch(/IF now_state <> \(prior - 'db_acl_raw' - 'public_acl_raw'\) THEN/);
  });

  it('is administrative: invisible to the ordinary path, and its rollback is never selected', () => {
    expect(getMigrationFiles(path.join(__dirname, '../../../../database/migrations'))).not.toContain(MIGRATION_FILE);
    const adminFiles: string[] = getMigrationFiles(ADMIN_DIR);
    expect(adminFiles).toContain(MIGRATION_FILE);
    expect(adminFiles).not.toContain(ROLLBACK_FILE);
    expect(adminFiles.indexOf(MIGRATION_FILE)).toBeGreaterThan(adminFiles.indexOf('009_create_onboarding_progress.sql'));
  });
});

describe('202611091300_harden_database_ownership: catalog after the bootstrap', () => {
  it('postgres owns the database; devcontrol keeps CONNECT and USAGE on public and has no CREATE or TEMPORARY anywhere', async () => {
    const { rows } = await admin.query(
      `SELECT pg_get_userbyid(d.datdba) AS db_owner,
              pg_has_role('devcontrol', 'pg_database_owner', 'MEMBER') AS database_owner_member,
              has_database_privilege('devcontrol', d.oid, 'CONNECT') AS connect,
              has_database_privilege('devcontrol', d.oid, 'CREATE') AS db_create,
              has_database_privilege('devcontrol', d.oid, 'TEMPORARY') AS db_temp,
              has_schema_privilege('devcontrol', 'public', 'USAGE') AS public_usage,
              has_schema_privilege('devcontrol', 'public', 'CREATE') AS public_create,
              pg_get_userbyid(n.nspowner) IN ('postgres', 'pg_database_owner') AS public_owned_by_postgres
         FROM pg_database d, pg_namespace n WHERE d.datname = current_database() AND n.nspname = 'public'`
    );
    expect(rows[0]).toEqual({
      db_owner: 'postgres',
      database_owner_member: false,
      connect: true,
      db_create: false,
      db_temp: false,
      public_usage: true,
      public_create: false,
      public_owned_by_postgres: true,
    });
  });

  it('PUBLIC has neither CREATE/TEMPORARY on the database nor CREATE on public', async () => {
    const { rows } = await admin.query(
      `SELECT EXISTS (SELECT 1 FROM pg_database d, aclexplode(coalesce(d.datacl, acldefault('d', d.datdba))) a
                       WHERE d.datname = current_database() AND a.grantee = 0 AND a.privilege_type IN ('CREATE', 'TEMPORARY')) AS db,
              EXISTS (SELECT 1 FROM pg_namespace n, aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
                       WHERE n.nspname = 'public' AND a.grantee = 0 AND a.privilege_type = 'CREATE') AS public_schema`
    );
    expect(rows[0]).toEqual({ db: false, public_schema: false });
  });

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

  it('nl_query_analytics and its two indexes exist with the columns the application always used; devcontrol can SELECT and INSERT', async () => {
    const { rows } = await admin.query(
      `SELECT (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':'
                                 || coalesce(pg_get_expr(d.adbin, d.adrelid), ''), ',' ORDER BY a.attnum)
                 FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
                WHERE a.attrelid = 'public.nl_query_analytics'::regclass AND a.attnum > 0 AND NOT a.attisdropped) AS columns,
              (SELECT string_agg(pg_get_indexdef(indexrelid), ' | ' ORDER BY indexrelid::regclass::text)
                 FROM pg_index WHERE indrelid = 'public.nl_query_analytics'::regclass) AS indexes,
              has_table_privilege('devcontrol', 'public.nl_query_analytics', 'SELECT') AS can_select,
              has_table_privilege('devcontrol', 'public.nl_query_analytics', 'INSERT') AS can_insert`
    );
    expect(rows[0]).toEqual({
      columns: NL_COLUMNS,
      indexes:
        'CREATE INDEX idx_nl_analytics_org_created ON public.nl_query_analytics USING btree (organization_id, created_at DESC) | ' +
        'CREATE INDEX idx_nl_analytics_query ON public.nl_query_analytics USING btree (query) | ' +
        'CREATE UNIQUE INDEX nl_query_analytics_pkey ON public.nl_query_analytics USING btree (id)',
      can_select: true,
      can_insert: true,
    });
  });

  it('the prior state is recorded in a postgres-owned table devcontrol cannot read', async () => {
    const { rows } = await admin.query(
      `SELECT pg_get_userbyid(c.relowner) AS owner,
              has_table_privilege('devcontrol', c.oid, 'SELECT') AS devcontrol_select,
              (SELECT array_agg(k ORDER BY k) FROM public.admin_migration_prior_state s, jsonb_object_keys(s.prior_state) k
                WHERE s.migration_name = '202611091300_harden_database_ownership.sql') AS keys
         FROM pg_class c WHERE c.oid = 'public.admin_migration_prior_state'::regclass`
    );
    expect(rows[0]).toEqual({
      owner: 'postgres',
      devcontrol_select: false,
      keys: ['db_acl', 'db_acl_raw', 'db_owner', 'devcontrol', 'function', 'nl', 'public_acl', 'public_acl_raw', 'public_owner', 'relations_md5'],
    });
  });
});

describe('202611091300_harden_database_ownership: behaviour', () => {
  it('BEFORE (pre-migration definition): a temporary onboarding_progress is resolved and runs as the function owner', async () => {
    await inRolledBackTransaction(async (c) => {
      await c.query(PRE_MIGRATION_DEFINITION as string);
      await expect(insertOrganizationWithTemporaryShadow(c)).rejects.toMatchObject({
        code: 'P0T01',
        message: 'temporary onboarding_progress used by postgres',
      });
    });
  });

  it('AFTER (migrated definition): registration as a non-superuser ignores the temporary relation and writes the onboarding row', async () => {
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

  it.each([
    ['a temporary table', 'CREATE TEMP TABLE cg0_probe (x int)'],
    ['a table in public', 'CREATE TABLE public.cg0_probe (x int)'],
    ['CREATE TABLE IF NOT EXISTS on the existing nl_query_analytics', 'CREATE TABLE IF NOT EXISTS public.nl_query_analytics (id uuid)'],
    ['an index on nl_query_analytics', 'CREATE INDEX IF NOT EXISTS idx_nl_analytics_query ON public.nl_query_analytics (query)'],
    ['a schema', 'CREATE SCHEMA cg0_probe'],
  ])('devcontrol cannot create %s (42501)', async (_label, statement) => {
    await inRolledBackTransaction(async (c) => {
      await c.query('SET LOCAL ROLE devcontrol');
      await expect(c.query(statement)).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('the guard refuses a second run, and a function body that is not 009', async () => {
    await inRolledBackTransaction(async (c) => {
      await c.query('SAVEPOINT second_run');
      await expect(c.query(MIGRATION_SQL)).rejects.toThrow(/a prior state for this migration is already recorded -- refusing to proceed/);
      await c.query('ROLLBACK TO SAVEPOINT second_run');
      await c.query(`DELETE FROM public.admin_migration_prior_state WHERE migration_name = '${MIGRATION_FILE}'`);
      await c.query(`CREATE OR REPLACE FUNCTION public.initialize_onboarding_for_organization() RETURNS trigger
                     LANGUAGE plpgsql SECURITY DEFINER AS $f$ BEGIN RETURN NEW; END; $f$`);
      await expect(c.query(MIGRATION_SQL)).rejects.toThrow(/body differs from 009 -- refusing to proceed/);
    });
  });
});
