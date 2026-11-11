/**
 * T-OWN: tenant tables and the application role (AWS connect C-G).
 *
 * Invariant, on the bootstrapped schema: every tenant table (a table with an
 * organization_id or org_id column) is either
 *   - correct: not owned by devcontrol (nor by a role devcontrol belongs to),
 *     row level security enabled AND forced, at least one policy and every
 *     policy keyed on organization_id and app.current_organization_id, and no
 *     TRUNCATE, REFERENCES or TRIGGER for devcontrol; or
 *   - on the reviewed ALLOWLIST below, with its written reason.
 * Ownership by devcontrol is never allowlisted here: CI builds the schema as a
 * superuser, so the production-only ownership facts in the allowlist are
 * checked by the founder's pre-check, not by this test. A NEW gap fails; so
 * does an allowlist entry whose table has become correct (move it out), and a
 * listed name that exists here but is not (or no longer) a tenant table.
 * Names absent from the repository schema (production-only tables) are
 * tolerated.
 *
 * Test fixtures: suites create a few tables in the shared test database that
 * no migration creates (routes/__tests__/shared-fixture-tables.ts; never
 * dropped, so whether one exists when this suite runs depends on suite order).
 * The ones production also has are on the allowlist under their production
 * category. One production does not have is allowlisted as
 * 'test-fixture-not-in-production', and only while the fixture helper
 * defines it and no migration creates it: once a migration creates it, it is
 * a real table and must be correct.
 *
 * Also: devcontrol is NOSUPERUSER NOBYPASSRLS, owns nothing in public, has no
 * CREATE on the database or public and no TEMPORARY; every SECURITY DEFINER
 * function pins a search_path starting with pg_catalog, pg_temp last.
 *
 * Behaviour, for each of the nine tables C-G transferred to postgres, as the
 * real devcontrol role, tagged the way production tags a connection
 * (set_config('app.current_organization_id', <org>, false) on a checked-out
 * client of a pool with installTenantTagReset): only the tagged organization's
 * rows are visible; untagged and cleared connections see none; cross-org
 * INSERT, UPDATE (both moving a row and touching another org's rows) and
 * DELETE change nothing or fail; same-org writes work; the exact privileges;
 * and every owner-only operation (ALTER, DISABLE TRIGGER USER, NO FORCE ROW
 * LEVEL SECURITY) and TRUNCATE fail with 42501.
 */
import * as fs from 'fs';
import * as path from 'path';
import { Client, Pool, PoolClient } from 'pg';
import { installTenantTagReset } from '../../config/database';
import { SHARED_FIXTURE_TABLE_NAMES, ensureSharedFixtureTable } from '../../routes/__tests__/shared-fixture-tables';

function dbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };
}

type Category = 'superuser-owner-not-forced' | 'C-G2-tenant-rls-off' | 'rls-coverage-backlog' | 'test-fixture-not-in-production';

const REASONS: Record<Category, string> = {
  'superuser-owner-not-forced':
    'postgres-owned with tenant policies but not forced; a superuser owner bypasses RLS whether forced or not, so FORCE adds nothing (founder decision 2026-11-09, CG-Q3)',
  'C-G2-tenant-rls-off':
    'owned by devcontrol in production with row level security off; C-G2 (ownership, and policy design including pre-authentication paths such as SAML and invitations)',
  'rls-coverage-backlog': 'postgres-owned, row level security off; RLS coverage backlog',
  'test-fixture-not-in-production':
    'not in production (founder check 2026-11-05); created only by the test helper routes/__tests__/shared-fixture-tables.ts, and by no migration; must be postgres-owned with row level security forced and tenant policies before the API keys feature ships',
};

/** Reviewed allowlist (production pre-check §3, founder 2026-11-09). Names may be absent here. */
const ALLOWLIST: Record<string, Category> = Object.fromEntries([
  ...[
    'account_security_findings', 'alert_history', 'analytics_events', 'anomaly_rules', 'audit_logs', 'aws_resources',
    'compliance_framework_rules', 'compliance_frameworks', 'compliance_scan_findings', 'compliance_scans',
    'cost_recommendations', 'deployments', 'infrastructure_resources', 'onboarding_progress', 'resource_discovery_jobs',
    'service_dependencies', 'services', 'teams',
  ].map((t) => [t, 'superuser-owner-not-forced']),
  ...['aws_connect_sessions', 'custom_anomaly_rules', 'nl_query_analytics', 'organization_invitations', 'saml_request_ids'].map(
    (t) => [t, 'C-G2-tenant-rls-off']
  ),
  ...[
    'anomaly_detections', 'api_usage', 'aws_accounts', 'compliance_scan_results', 'cost_optimizations', 'custom_dora_benchmarks',
    'generated_reports', 'organization_memberships', 'remediation_workflows', 'risk_score_history', 'scheduled_reports',
    'services_backup_20251228', 'sessions', 'sso_configurations', 'tenants', 'weekly_summaries',
  ].map((t) => [t, 'rls-coverage-backlog']),
  ...['api_keys'].map((t) => [t, 'test-fixture-not-in-production']),
]) as Record<string, Category>;

/** Every .sql file under database/migrations and database/migrations-admin, rollbacks included, comments removed. */
function migrationSql(): { file: string; sql: string }[] {
  const root = path.join(__dirname, '../../../../database');
  return ['migrations', 'migrations-admin'].flatMap((dir) =>
    fs
      .readdirSync(path.join(root, dir))
      .filter((f) => f.endsWith('.sql'))
      .map((f) => ({
        file: `${dir}/${f}`,
        sql: fs.readFileSync(path.join(root, dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ''),
      }))
  );
}

/** CREATE [UNLOGGED] TABLE [IF NOT EXISTS] [public.]<table>, quoted or not. */
const createsTable = (sql: string, table: string) =>
  new RegExp(`\\bCREATE\\s+(?:UNLOGGED\\s+)?TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:"?public"?\\s*\\.\\s*)?"?${table}"?(?![\\w$])`, 'i').test(sql);

/** devcontrol-owned in production but not tenant tables; C-G2. Documented here; their ownership is a production fact. */
const NON_TENANT_C_G2 = ['migration_tracking_baseline', 'platform_staff', 'schema_migrations', 'stripe_webhook_events'];

/** Correct in production after C-1/M-series migrations (pre-check §3) and after C-G (the nine). */
const EXPECTED_CORRECT = [
  'aws_account_regions', 'aws_org_external_ids', 'aws_preserved_customer_decisions', 'aws_scan_leases', 'compliance_check_evaluations',
  'cost_finding_detections', 'framework_evaluation_reconciliations', 'framework_evaluation_runs', 'job_leases',
  'observability_collection_scopes', 'organization_feature_flags', 'remediation_executions', 'remediation_step_claims',
  'resource_health_evaluation_results', 'resource_health_evaluation_runs', 'resource_telemetry_observations',
  // C-G:
  'security_hub_findings', 'organization_security_hub_state', 'soc2_evidence_observations', 'soc2_control_evaluations',
  'cost_analysis_runs', 'customer_evidence', 'organization_optimization_rule_configs', 'refunds', 'slo_definitions',
  // AWS connect PR D1a (admin migration 202611111200):
  'aws_connection_checks',
];

/** The nine tables of C-G and devcontrol's exact privileges on each, derived from the application's statements. */
const C_G_PRIVILEGES: Record<string, string[]> = {
  security_hub_findings: ['INSERT', 'SELECT', 'UPDATE'],
  organization_security_hub_state: ['INSERT', 'SELECT', 'UPDATE'],
  soc2_evidence_observations: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
  soc2_control_evaluations: ['INSERT', 'SELECT', 'UPDATE'],
  cost_analysis_runs: ['INSERT', 'SELECT', 'UPDATE'],
  customer_evidence: ['INSERT', 'SELECT', 'UPDATE'],
  organization_optimization_rule_configs: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
  refunds: ['INSERT', 'SELECT', 'UPDATE'],
  slo_definitions: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
};
/**
 * Tables created postgres-owned by an admin migration after C-G, with devcontrol's exact privileges.
 * aws_connection_checks (D1a): no DELETE; the disconnect cleanup (C-b) must add DELETE in its own migration.
 */
const CREATED_CORRECT_PRIVILEGES: Record<string, string[]> = {
  aws_connection_checks: ['INSERT', 'SELECT', 'UPDATE'],
};
/** Every table the behaviour block runs as devcontrol. */
const TOWN_PRIVILEGES: Record<string, string[]> = { ...C_G_PRIVILEGES, ...CREATED_CORRECT_PRIVILEGES };
const TABLE_PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];

type TableFacts = {
  table: string;
  owner: string;
  owner_is_superuser: boolean;
  devcontrol_owns: boolean;
  rls: boolean;
  force: boolean;
  policies: number;
  policies_keyed: boolean;
  devcontrol_extra_privileges: string[];
};

const admin = new Client(dbConfig());
let facts: Map<string, TableFacts>;

beforeAll(async () => {
  await admin.connect();
  const { rows } = await admin.query<TableFacts>(
    `SELECT c.relname AS table, pg_get_userbyid(c.relowner) AS owner, o.rolsuper AS owner_is_superuser,
            pg_has_role('devcontrol', c.relowner, 'MEMBER') AS devcontrol_owns,
            c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
            (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies,
            NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid
                         AND NOT (coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
                                  ~ '(organization_id|org_id).*current_setting\\(''app\\.current_organization_id''')) AS policies_keyed,
            ARRAY(SELECT x FROM unnest(ARRAY['TRUNCATE', 'REFERENCES', 'TRIGGER']) x
                   WHERE has_table_privilege('devcontrol', c.oid, x)) AS devcontrol_extra_privileges
       FROM pg_class c JOIN pg_roles o ON o.oid = c.relowner
      WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
        AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname IN ('organization_id', 'org_id') AND NOT a.attisdropped)`
  );
  facts = new Map(rows.map((r) => [r.table, r]));
});

afterAll(async () => {
  await admin.end();
});

const isCorrect = (f: TableFacts) =>
  !f.devcontrol_owns && f.rls && f.force && f.policies > 0 && f.policies_keyed && f.devcontrol_extra_privileges.length === 0;

describe('T-OWN invariant: every tenant table is correct or on the reviewed allowlist', () => {
  it('the schema has tenant tables to check, and every C-G table among them', () => {
    expect(facts.size).toBeGreaterThan(40);
    for (const t of Object.keys(C_G_PRIVILEGES)) expect(facts.has(t)).toBe(true);
  });

  it('no tenant table is owned by devcontrol or a role it belongs to (never allowlisted)', () => {
    expect([...facts.values()].filter((f) => f.devcontrol_owns).map((f) => `${f.table} (${f.owner})`)).toEqual([]);
  });

  it('every tenant table not on the allowlist is correct: RLS on and forced, tenant-keyed policies, no TRUNCATE/REFERENCES/TRIGGER for devcontrol', () => {
    const gaps = [...facts.values()]
      .filter((f) => !(f.table in ALLOWLIST) && !isCorrect(f))
      .map((f) => `${f.table}: owner ${f.owner}, rls ${f.rls}, force ${f.force}, policies ${f.policies} (keyed ${f.policies_keyed}), devcontrol extra ${f.devcontrol_extra_privileges.join('/') || 'none'}`);
    expect(gaps).toEqual([]);
  });

  it('the tables expected to be correct are correct', () => {
    const notCorrect = EXPECTED_CORRECT.filter((t) => facts.has(t) && !isCorrect(facts.get(t) as TableFacts));
    expect(notCorrect).toEqual([]);
    expect(EXPECTED_CORRECT.filter((t) => t in ALLOWLIST)).toEqual([]);
  });

  it('allowlisted superuser-owned tables still have row level security and tenant-keyed policies', () => {
    const broken = Object.entries(ALLOWLIST)
      .filter(([t, c]) => c === 'superuser-owner-not-forced' && facts.has(t))
      .map(([t]) => facts.get(t) as TableFacts)
      .filter((f) => !f.owner_is_superuser || !f.rls || f.policies === 0 || !f.policies_keyed)
      .map((f) => f.table);
    expect(broken).toEqual([]);
  });

  it('no allowlist entry is stale: a listed table that is now correct must be moved out', () => {
    expect(Object.keys(ALLOWLIST).filter((t) => facts.has(t) && isCorrect(facts.get(t) as TableFacts))).toEqual([]);
  });

  it('test-fixture entries are defined by the shared fixture helper and created by no migration (a migration-created table must be correct)', () => {
    const fixtureEntries = Object.entries(ALLOWLIST)
      .filter(([, c]) => c === 'test-fixture-not-in-production')
      .map(([t]) => t);
    expect(fixtureEntries.length).toBeGreaterThan(0);
    expect(fixtureEntries.filter((t) => !(SHARED_FIXTURE_TABLE_NAMES as string[]).includes(t))).toEqual([]);

    const migrations = migrationSql();
    expect(migrations.length).toBeGreaterThan(50);
    // The scan reads the real files: 026 mentions api_keys (it only ALTERs it), yet creates nothing.
    expect(migrations.some((m) => /\bapi_keys\b/.test(m.sql))).toBe(true);
    expect(
      fixtureEntries.flatMap((t) => migrations.filter((m) => createsTable(m.sql, t)).map((m) => `${t}: created by ${m.file}`))
    ).toEqual([]);
  });

  it('the CREATE TABLE detector matches the forms a migration could use, and nothing else', () => {
    for (const sql of [
      'CREATE TABLE api_keys (id int);', 'create table if not exists api_keys(id int);', 'CREATE TABLE public.api_keys (id int);',
      'CREATE TABLE "api_keys" (id int);', 'CREATE UNLOGGED TABLE IF NOT EXISTS "public"."api_keys" (id int);',
    ]) {
      expect(createsTable(sql, 'api_keys')).toBe(true);
    }
    for (const sql of ['ALTER TABLE api_keys ADD COLUMN x int;', 'CREATE TABLE api_keys_archive (id int);', 'DROP TABLE api_keys;', 'CREATE INDEX i ON api_keys (id);']) {
      expect(createsTable(sql, 'api_keys')).toBe(false);
    }
  });

  it('every listed name present in this schema is a tenant table; the non-tenant C-G2 tables have no organization column', async () => {
    const { rows } = await admin.query(
      `SELECT c.relname FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')`
    );
    const present = new Set(rows.map((r) => r.relname as string));
    expect(Object.keys(ALLOWLIST).filter((t) => present.has(t) && !facts.has(t))).toEqual([]);
    expect(NON_TENANT_C_G2.filter((t) => facts.has(t))).toEqual([]);
    expect(Object.values(REASONS).every((r) => r.length > 20)).toBe(true);
  });

  it('devcontrol: NOSUPERUSER NOBYPASSRLS, owns nothing in public, no CREATE (database, public), no TEMPORARY', async () => {
    const { rows } = await admin.query(
      `SELECT r.rolsuper, r.rolbypassrls,
              (SELECT count(*)::int FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND pg_has_role('devcontrol', c.relowner, 'MEMBER')) AS owned_relations,
              (SELECT count(*)::int FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND pg_has_role('devcontrol', p.proowner, 'MEMBER')) AS owned_functions,
              has_database_privilege('devcontrol', current_database(), 'CREATE') AS db_create,
              has_database_privilege('devcontrol', current_database(), 'TEMPORARY') AS db_temp,
              has_schema_privilege('devcontrol', 'public', 'CREATE') AS public_create
         FROM pg_roles r WHERE r.rolname = 'devcontrol'`
    );
    expect(rows[0]).toEqual({
      rolsuper: false, rolbypassrls: false, owned_relations: 0, owned_functions: 0, db_create: false, db_temp: false, public_create: false,
    });
  });

  it('every SECURITY DEFINER function pins a search_path that starts with pg_catalog and has pg_temp, if present, last', async () => {
    const { rows } = await admin.query(
      `SELECT p.oid::regprocedure::text AS fn, p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog', 'information_schema')`
    );
    const unpinned = rows.filter(({ proconfig }) => {
      const setting = (proconfig as string[] | null)?.find((s) => s.startsWith('search_path='));
      if (!setting) return true;
      const schemas = setting.slice('search_path='.length).split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
      const temp = schemas.indexOf('pg_temp');
      return schemas[0] !== 'pg_catalog' || (temp >= 0 && temp !== schemas.length - 1);
    });
    expect(unpinned.map((r) => r.fn)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Behaviour of the nine C-G tables as the real devcontrol role.
// ---------------------------------------------------------------------------

/** One valid row of `table` for `org`; `label` keeps unique columns unique. Upserts mirror the application's. */
const ROW: Record<string, (org: string, label: string) => [string, unknown[]]> = {
  security_hub_findings: (org, label) => [
    `INSERT INTO security_hub_findings (organization_id, finding_id, product_arn, title, severity, security_hub_created_at, security_hub_updated_at)
     VALUES ($1, $2, 'arn:aws:securityhub:us-east-1::product/aws/securityhub', 'T-OWN', 'low', now(), now())`, [org, `town-${label}`]],
  organization_security_hub_state: (org) => [
    `INSERT INTO organization_security_hub_state (organization_id, capability_status) VALUES ($1, 'ENABLED')
     ON CONFLICT (organization_id) DO UPDATE SET capability_status = EXCLUDED.capability_status`, [org]],
  soc2_evidence_observations: (org, label) => [
    `INSERT INTO soc2_evidence_observations (organization_id, criterion_id, resource_arn, resource_type, provenance, result, collected_at, source, explanation)
     VALUES ($1, 'CC6.1', $2, 'iam_user', 'OBSERVED', 'SUPPORTS', now(), '{}', 'T-OWN')`, [org, `town-${label}`]],
  soc2_control_evaluations: (org, label) => [
    `INSERT INTO soc2_control_evaluations (organization_id, criterion_id, disposition_class, evidence_summary, computed_at)
     VALUES ($1, $2, 'A_OBSERVABLE', '{}', now())`, [org, `town-${label}`]],
  cost_analysis_runs: (org) => [`INSERT INTO cost_analysis_runs (organization_id) VALUES ($1)`, [org]],
  customer_evidence: (org, label) => [
    `INSERT INTO customer_evidence (organization_id, criterion_id, evidence_type, title) VALUES ($1, 'CC6.1', 'policy', $2)`, [org, `town-${label}`]],
  organization_optimization_rule_configs: (org) => [
    `INSERT INTO organization_optimization_rule_configs (organization_id, rule_id, parameter_id, value_numeric)
     VALUES ($1, 'ec2_idle', 'cpu_threshold_percent', 5)
     ON CONFLICT (organization_id, rule_id, parameter_id) DO UPDATE SET value_numeric = EXCLUDED.value_numeric`, [org]],
  refunds: (org, label) => [
    `INSERT INTO refunds (organization_id, stripe_refund_id, stripe_payment_intent_id, amount, currency, status)
     VALUES ($1, $2, $3, 100, 'usd', 'pending')`, [org, `re_town_${label}`, `pi_town_${label}`]],
  slo_definitions: (org, label) => [
    `INSERT INTO slo_definitions (organization_id, name, resource_type, resource_id, sli, target_value)
     VALUES ($1, $2, 'ec2', 'i-1234567890abcdef0', 'ec2_availability', 99)`, [org, `town-${label}`]],
  // One row per connection: the organization's own aws_accounts row (the composite foreign key, when present,
  // refuses any other); the upsert mirrors the repository's lazy INSERT.
  aws_connection_checks: (org) => [
    `INSERT INTO aws_connection_checks (aws_account_id, organization_id) VALUES ($1, $2)
     ON CONFLICT (aws_account_id) DO UPDATE SET updated_at = now()`, [connectionRowOf[org], org]],
};
const TOWN_TABLES = Object.keys(TOWN_PRIVILEGES);
/** Each probe organization's aws_accounts row id (aws_connection_checks rows reference it). */
const connectionRowOf: Record<string, string> = {};

const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const SET_TENANT_TAG_SQL = "SELECT set_config('app.current_organization_id', $1, false)";
let orgA: string;
let orgB: string;
let appPool: Pool;

async function asDevcontrol<T>(org: string | null, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await appPool.connect();
  try {
    if (org !== null) await c.query(SET_TENANT_TAG_SQL, [org]);
    return await fn(c);
  } finally {
    c.release();
  }
}

/** fn inside a transaction that is always rolled back, so a wrongly allowed write never persists. */
async function rolledBack<T>(c: PoolClient, fn: () => Promise<T>): Promise<T> {
  await c.query('BEGIN');
  try {
    return await fn();
  } finally {
    await c.query('ROLLBACK');
  }
}

describe('T-OWN behaviour: the nine C-G tables and the D1a table as devcontrol', () => {
  beforeAll(async () => {
    appPool = installTenantTagReset(new Pool({ ...dbConfig(), max: 2, options: '-c role=devcontrol' }));
    const { rows } = await admin.query(
      `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
       VALUES ($1, $1, $1, 'free', 'free'), ($2, $2, $2, 'free', 'free') RETURNING id, name`,
      [`town-a-${suffix}`, `town-b-${suffix}`]
    );
    orgA = rows.find((r) => r.name === `town-a-${suffix}`).id;
    orgB = rows.find((r) => r.name === `town-b-${suffix}`).id;
    const fixturePool = new Pool({ ...dbConfig(), max: 1 });
    try {
      await ensureSharedFixtureTable(fixturePool, 'aws_accounts');
    } finally {
      await fixturePool.end();
    }
    for (const [org, n] of [[orgA, 'a'], [orgB, 'b']] as const) {
      connectionRowOf[org] = (await admin.query(
        `INSERT INTO aws_accounts (org_id, role_arn, account_id, external_id, region, status)
         VALUES ($1, 'arn:aws:iam::123456789012:role/DevControlRole', $2, 'placeholder-external-id', 'us-east-1', 'active') RETURNING id::text AS id`,
        [org, `town-${n}-${suffix}`.slice(0, 32)]
      )).rows[0].id;
    }
    for (const t of TOWN_TABLES) {
      for (const [org, l] of [[orgA, 'a'], [orgB, 'b']] as const) {
        const [sql, params] = ROW[t](org, `${l}-${suffix}`);
        await admin.query(sql, params);
      }
    }
  });

  afterAll(async () => {
    await appPool.end();
    await admin.query('DELETE FROM organizations WHERE id = ANY($1)', [[orgA, orgB].filter(Boolean)]);
    await admin.query('DELETE FROM aws_accounts WHERE org_id = ANY($1)', [[orgA, orgB].filter(Boolean)]);
  });

  it('connects as devcontrol, which is no superuser and cannot bypass row level security', async () => {
    const who = await asDevcontrol(null, async (c) => (await c.query(
      `SELECT current_user AS u, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`
    )).rows[0]);
    expect(who).toEqual({ u: 'devcontrol', rolsuper: false, rolbypassrls: false });
  });

  it.each(TOWN_TABLES)('%s: postgres-owned, forced, and devcontrol has exactly the privileges the application uses', async (t) => {
    const { rows } = await admin.query(
      `SELECT pg_get_userbyid(c.relowner) AS owner, c.relforcerowsecurity AS force,
              ARRAY(SELECT p FROM unnest($2::text[]) p WHERE has_table_privilege('devcontrol', c.oid, p) ORDER BY p) AS privileges
         FROM pg_class c WHERE c.oid = ('public.' || $1)::regclass`,
      [t, TABLE_PRIVILEGES]
    );
    expect(rows[0]).toEqual({ owner: 'postgres', force: true, privileges: TOWN_PRIVILEGES[t] });
  });

  it.each(TOWN_TABLES)('%s: tagged for A, only A is visible; untagged and cleared connections see nothing', async (t) => {
    const tagged = await asDevcontrol(orgA, async (c) => (await c.query(
      `SELECT organization_id::text AS org, count(*)::int AS n FROM ${t} GROUP BY 1 ORDER BY 1`
    )).rows);
    expect(tagged).toEqual([{ org: orgA, n: expect.any(Number) }]);
    expect(tagged[0].n).toBeGreaterThanOrEqual(1);
    const untagged = await asDevcontrol(null, async (c) => (await c.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n);
    expect(untagged).toBe(0);
    // The connection released above was tagged (by the previous checkout) and cleared on release: '' sees nothing.
    const cleared = await asDevcontrol(null, async (c) => {
      const tag = (await c.query("SELECT current_setting('app.current_organization_id', true) AS tag")).rows[0].tag;
      return { tag: tag === null ? null : tag, n: (await c.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n };
    });
    expect(cleared.n).toBe(0);
  });

  it.each(TOWN_TABLES)('%s: cross-organization INSERT, UPDATE and DELETE change nothing or fail; same-org writes work', async (t) => {
    const before = (await admin.query(`SELECT count(*)::int AS n FROM ${t} WHERE organization_id = $1`, [orgB])).rows[0].n;
    await asDevcontrol(orgA, async (c) => {
      const [insertB, paramsB] = ROW[t](orgB, `x-${suffix}`);
      await rolledBack(c, async () => expect(c.query(insertB, paramsB)).rejects.toMatchObject({ code: '42501' }));

      const touched = await rolledBack(c, async () =>
        (await c.query(`UPDATE ${t} SET organization_id = organization_id WHERE organization_id = $1`, [orgB])).rowCount);
      expect(touched).toBe(0);

      await rolledBack(c, async () =>
        expect(c.query(`UPDATE ${t} SET organization_id = $1 WHERE organization_id = $2`, [orgB, orgA])).rejects.toMatchObject({ code: '42501' }));

      if (TOWN_PRIVILEGES[t].includes('DELETE')) {
        const deleted = await rolledBack(c, async () => (await c.query(`DELETE FROM ${t} WHERE organization_id = $1`, [orgB])).rowCount);
        expect(deleted).toBe(0);
      } else {
        await rolledBack(c, async () =>
          expect(c.query(`DELETE FROM ${t} WHERE organization_id = $1`, [orgB])).rejects.toMatchObject({ code: '42501' }));
      }

      const [insertA, paramsA] = ROW[t](orgA, `same-${suffix}`);
      const inserted = await rolledBack(c, async () => (await c.query(insertA, paramsA)).rowCount);
      expect(inserted).toBe(1);
    });
    const after = (await admin.query(`SELECT count(*)::int AS n FROM ${t} WHERE organization_id = $1`, [orgB])).rows[0].n;
    expect(after).toBe(before);
  });

  it.each(TOWN_TABLES)('%s: owner-only operations and TRUNCATE fail with 42501', async (t) => {
    await asDevcontrol(orgA, async (c) => {
      for (const statement of [
        `ALTER TABLE ${t} ADD COLUMN town_probe int`,
        `ALTER TABLE ${t} DISABLE TRIGGER USER`,
        `ALTER TABLE ${t} NO FORCE ROW LEVEL SECURITY`,
        `TRUNCATE ${t}`,
      ]) {
        await rolledBack(c, async () => expect(c.query(statement)).rejects.toMatchObject({ code: '42501' }));
      }
    });
  });

  it('refunds: the trigger function is postgres-owned', async () => {
    const { rows } = await admin.query(
      `SELECT pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE oid = 'public.update_refunds_updated_at()'::regprocedure`
    );
    expect(rows[0].owner).toBe('postgres');
  });
});
