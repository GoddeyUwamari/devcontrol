/**
 * Admin migration 202611201200_create_github_app_ingestion (D8a).
 *
 * Static: the shape of both files. Dynamic, in ONE rolled-back transaction:
 * the paired rollback removes the bootstrapped objects, the migration
 * re-creates them, the end state is checked, then as devcontrol (SET LOCAL
 * ROLE, tag set LOCAL): tenant isolation on the four tenant tables, no access
 * at all to github_held_deliveries, the definer functions (lookup, hold,
 * installer, release only to the claiming org), the same-organization service
 * rule, the demo-workspace refusal, duplicate delivery / event key /
 * deployment job ids refused, aws_region nullable; a re-run is refused; the
 * rollback refuses while a deployment has no region, then removes exactly its
 * marked objects, and refuses an unmarked table. Placeholders only.
 */
import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getMigrationFiles } = require('../../../../database/migrate.js');

const ADMIN_DIR = path.join(__dirname, '../../../../database/migrations-admin');
const MIGRATION_FILE = '202611201200_create_github_app_ingestion.sql';
const ROLLBACK_FILE = '202611201200_create_github_app_ingestion_rollback.sql';
const MIGRATION_SQL = fs.readFileSync(path.join(ADMIN_DIR, MIGRATION_FILE), 'utf8');
const ROLLBACK_SQL = fs.readFileSync(path.join(ADMIN_DIR, ROLLBACK_FILE), 'utf8');
const MARKER = '[202611201200_create_github_app_ingestion]';
const TENANT_TABLES = ['github_installations', 'github_install_states', 'pipeline_repositories', 'pipeline_events'];
const TENANT_EXPR = "organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid";

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

describe('202611201200_create_github_app_ingestion: static shape', () => {
  const sql = statements(MIGRATION_SQL);
  const rollback = statements(ROLLBACK_SQL);

  it('starts with the 3 s lock timeout', () => {
    expect(sql.trim().startsWith("SET LOCAL lock_timeout = '3s';")).toBe(true);
    expect(rollback.trim().startsWith("SET LOCAL lock_timeout = '3s';")).toBe(true);
  });

  it('creates exactly five tables; changes deployments only by two indexes and aws_region DROP NOT NULL', () => {
    expect([...sql.matchAll(/\bCREATE TABLE\s+([\w.]+)/gi)].map((m) => m[1])).toEqual([
      'public.github_installations', 'public.github_install_states', 'public.pipeline_repositories',
      'public.pipeline_events', 'public.github_held_deliveries']);
    expect([...sql.matchAll(/^ALTER TABLE public\.deployments (.+);$/gm)].map((m) => m[1])).toEqual(['ALTER COLUMN aws_region DROP NOT NULL']);
    expect([...sql.matchAll(/CREATE UNIQUE INDEX (\w+) ON public\.deployments/g)].map((m) => m[1]))
      .toEqual(['deployments_github_job_uidx', 'deployments_github_deployment_uidx']);
    expect(sql).not.toMatch(/^\s*(UPDATE\s|DELETE\s+FROM\s+public\.(deployments|services|organizations)|DROP\s|TRUNCATE\s)/im);
  });

  it('row level security enabled and forced on all five; one tenant policy on each tenant table; none on the held table', () => {
    for (const t of [...TENANT_TABLES, 'github_held_deliveries']) {
      expect(sql).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
      expect(sql).toContain(`ALTER TABLE public.${t} FORCE ROW LEVEL SECURITY;`);
    }
    const policies = [...sql.matchAll(/CREATE POLICY (\w+) ON public\.(\w+) FOR ALL\s+USING \(([^;]+)\)\s+WITH CHECK \(([^;]+)\);/g)];
    expect(policies.map((p) => p[2])).toEqual(TENANT_TABLES);
    for (const p of policies) {
      expect(p[1]).toBe(`${p[2]}_tenant`);
      expect(p[3]).toBe(TENANT_EXPR);
      expect(p[4]).toBe(TENANT_EXPR);
    }
  });

  it('exact grants: nothing on the held table; no DELETE on repositories', () => {
    expect([...sql.matchAll(/GRANT ([A-Z, ]+) ON TABLE public\.(\w+) TO devcontrol;/g)].map((m) => `${m[2]}: ${m[1]}`)).toEqual([
      'github_installations: SELECT, INSERT, UPDATE, DELETE',
      'github_install_states: SELECT, INSERT, UPDATE, DELETE',
      'pipeline_repositories: SELECT, INSERT, UPDATE',
      'pipeline_events: SELECT, INSERT, UPDATE, DELETE',
    ]);
  });

  it('identity: GitHub repository id unique per organization, delivery id unique globally, installation id the primary key', () => {
    expect(sql).toMatch(/CONSTRAINT pipeline_repositories_org_repo_key UNIQUE \(organization_id, github_repo_id\)/);
    expect(sql).toMatch(/CONSTRAINT pipeline_events_delivery_key UNIQUE \(delivery_id\)/);
    expect(sql).toMatch(/installation_id\s+BIGINT PRIMARY KEY/);
    expect(sql).not.toMatch(/UNIQUE \([^)]*full_name/);
  });

  it('stores no raw payload, token, secret, email, message or body column', () => {
    const columns = [...sql.matchAll(/^\s{2}(\w+)\s+(UUID|TIMESTAMPTZ|VARCHAR|INTEGER|JSONB|SMALLINT|BIGINT|BYTEA|CHAR)\b/gm)].map((m) => m[1]);
    expect(columns).toEqual(expect.arrayContaining(['facts', 'payload_sha256', 'state_hash']));
    expect(columns.filter((c) => /raw|^payload$|token|secret|email|message|body|private_key|^code$/i.test(c))).toEqual([]);
  });

  it('every SECURITY DEFINER function pins search_path pg_catalog, pg_temp; EXECUTE from PUBLIC revoked, devcontrol granted', () => {
    const definers = [...sql.matchAll(/CREATE FUNCTION public\.(\w+)\([^)]*\)[^$]*?SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS/g)].map((m) => m[1]);
    expect(definers).toEqual(['github_installation_org', 'github_hold_delivery', 'github_installer_of',
      'github_release_held_deliveries', 'github_purge_held_deliveries']);
    for (const f of definers) {
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${f}\\([^)]*\\) FROM PUBLIC;`));
      expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${f}\\([^)]*\\) TO devcontrol;`));
    }
  });

  it('the rollback drops only marked objects, never with CASCADE, and deletes its ledger row', () => {
    expect(rollback).not.toMatch(/\bCASCADE\b/);
    expect(rollback).toContain(`marker CONSTANT TEXT := '${MARKER}'`);
    expect([...rollback.matchAll(/\bDROP TABLE ([\w.]+);/g)].map((m) => m[1])).toEqual([
      'public.pipeline_events', 'public.pipeline_repositories', 'public.github_install_states', 'public.github_installations', 'public.github_held_deliveries']);
    expect(rollback).toMatch(/DELETE FROM schema_migrations\s+WHERE migration_name = '202611201200_create_github_app_ingestion\.sql';/);
  });

  it('is administrative: invisible to the ordinary path, after the demo foundation, listed in the README; the rollback is never selected', () => {
    expect(getMigrationFiles(path.join(__dirname, '../../../../database/migrations'))).not.toContain(MIGRATION_FILE);
    const adminFiles: string[] = getMigrationFiles(ADMIN_DIR);
    expect(adminFiles).toContain(MIGRATION_FILE);
    expect(adminFiles).not.toContain(ROLLBACK_FILE);
    expect(adminFiles.indexOf(MIGRATION_FILE)).toBeGreaterThan(adminFiles.indexOf('202611141200_demo_workspace_foundation.sql'));
    expect(fs.readFileSync(path.join(ADMIN_DIR, 'README.md'), 'utf8')).toContain(`**\`${MIGRATION_FILE}\`**`);
  });
});

describe('202611201200_create_github_app_ingestion: applied, as devcontrol, re-run, rolled back', () => {
  it('end state, isolation, definer functions, constraints, re-run guard and rollback', async () => {
    const client = new Client(dbConfig());
    await client.connect();
    const q = (text: string, values?: unknown[]) => client.query(text, values);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
    const asApp = async (org: string | null) => {
      await q('SET LOCAL ROLE devcontrol');
      await q(`SELECT set_config('app.current_organization_id', $1, true)`, [org ?? '']);
    };
    try {
      await q('BEGIN');
      await q("SET LOCAL lock_timeout = '10s'");
      await q(ROLLBACK_SQL);
      expect((await q(`SELECT to_regclass('public.pipeline_events') AS e, to_regclass('public.deployments_github_job_uidx') AS i`)).rows[0]).toEqual({ e: null, i: null });
      await q(MIGRATION_SQL);

      // End state.
      const state = (await q(`
        SELECT c.relname AS t, pg_get_userbyid(c.relowner) = current_user AS owned, c.relrowsecurity AND c.relforcerowsecurity AS forced,
               (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies,
               ARRAY(SELECT x FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) x
                      WHERE has_table_privilege('devcontrol', c.oid, x) ORDER BY x) AS devcontrol,
               starts_with(obj_description(c.oid, 'pg_class'), $1) AS marked
          FROM pg_class c WHERE c.oid = ANY(ARRAY['public.github_installations','public.github_install_states','public.pipeline_repositories',
                                                  'public.pipeline_events','public.github_held_deliveries']::regclass[])
          ORDER BY c.relname`, [MARKER])).rows;
      const all = ['DELETE', 'INSERT', 'SELECT', 'UPDATE'];
      expect(state).toEqual([
        { t: 'github_held_deliveries', owned: true, forced: true, policies: 0, devcontrol: [], marked: true },
        { t: 'github_install_states', owned: true, forced: true, policies: 1, devcontrol: all, marked: true },
        { t: 'github_installations', owned: true, forced: true, policies: 1, devcontrol: all, marked: true },
        { t: 'pipeline_events', owned: true, forced: true, policies: 1, devcontrol: all, marked: true },
        { t: 'pipeline_repositories', owned: true, forced: true, policies: 1, devcontrol: ['INSERT', 'SELECT', 'UPDATE'], marked: true },
      ]);
      expect((await q(`SELECT attnotnull FROM pg_attribute WHERE attrelid = 'public.deployments'::regclass AND attname = 'aws_region'`)).rows[0].attnotnull).toBe(false);

      // Fixtures (as postgres).
      const org = async (label: string, isDemo = false) => (await q(
        `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status${isDemo ? ', is_demo' : ''})
         VALUES ($1, $1, $1, 'free', 'free'${isDemo ? ', true' : ''}) RETURNING id::text AS id`, [`d8a-mig-${label}-${suffix}`])).rows[0].id as string;
      const orgA = await org('a');
      const orgB = await org('b');
      const svc = async (o: string) => (await q(`INSERT INTO services (name, template, owner, status, organization_id) VALUES ('s', 'api', 'o', 'active', $1) RETURNING id::text AS id`, [o])).rows[0].id as string;
      const svcA = await svc(orgA);
      const svcB = await svc(orgB);
      const claim = (inst: number, o: string) => q(`INSERT INTO github_installations (installation_id, organization_id, account_id, account_login, account_type,
        repository_selection, permissions_state, installer_github_user_id, claimed_by_github_user_id) VALUES ($1, $2, 1, 'acme', 'Organization', 'all', 'expected', 9, 9)`, [inst, o]);
      await claim(101, orgB);
      await q(`INSERT INTO pipeline_events (delivery_id, organization_id, installation_id, event, action, normalizer_version, facts)
               VALUES ('00000000-0000-4000-8000-000000000001', $1, 101, 'installation', 'created', 1, '{"sender":{"id":9}}')`, [orgB]);
      await q(`GRANT SELECT ON services TO devcontrol`);

      // As devcontrol tagged for A.
      await asApp(orgA);
      for (const t of TENANT_TABLES) expect((await q(`SELECT count(*)::int AS n FROM ${t} WHERE organization_id = $1`, [orgB])).rows[0].n).toBe(0);
      expect(await failure(`SELECT 1 FROM github_held_deliveries`)).toBe('42501');
      expect(await failure(`INSERT INTO github_held_deliveries (delivery_id, installation_id, event, action, normalizer_version, facts)
                            VALUES (gen_random_uuid(), 5, 'workflow_job', 'completed', 1, '{}')`)).toBe('42501');
      expect(await failure(`DELETE FROM github_held_deliveries`)).toBe('42501');
      // Lookup and installer: only the organization id / the sender id, for any installation.
      expect((await q(`SELECT github_installation_org(101)::text AS o, github_installation_org(999) AS none`)).rows[0]).toEqual({ o: orgB, none: null });
      expect((await q(`SELECT github_installer_of(101)::text AS i`)).rows[0].i).toBe('9');
      // Cross-organization writes.
      expect(await failure(`INSERT INTO pipeline_repositories (organization_id, github_repo_id, full_name) VALUES ($1, 1, 'a/b')`, [orgB])).toBe('42501');
      expect(await failure(`INSERT INTO github_installations (installation_id, organization_id, account_id, account_login, account_type, repository_selection,
        permissions_state, installer_github_user_id, claimed_by_github_user_id) VALUES (101, $1, 1, 'x', 'User', 'all', 'expected', 1, 1)`, [orgA])).toBe('23505'); // one org per installation
      expect(await failure(`INSERT INTO pipeline_events (delivery_id, organization_id, installation_id, event, action, normalizer_version, facts)
                            VALUES ('00000000-0000-4000-8000-000000000001', $1, 5, 'installation', 'created', 1, '{}')`, [orgA])).toBe('23505'); // delivery id is global
      // Hold, then a claim by A releases to A only.
      expect((await q(`SELECT github_hold_delivery('00000000-0000-4000-8000-000000000002', 202, 'installation', 'created', NULL, NULL, NULL, 1::smallint,
        '{"sender":{"id":7}}', NULL) AS o`)).rows[0].o).toBe('held');
      expect((await q(`SELECT github_hold_delivery('00000000-0000-4000-8000-000000000002', 202, 'installation', 'created', NULL, NULL, NULL, 1::smallint, '{}', NULL) AS o`)).rows[0].o).toBe('duplicate');
      expect((await q(`SELECT github_hold_delivery('00000000-0000-4000-8000-000000000001', 202, 'installation', 'created', NULL, NULL, NULL, 1::smallint, '{}', NULL) AS o`)).rows[0].o).toBe('duplicate'); // already an event
      expect((await q(`SELECT github_hold_delivery(gen_random_uuid(), 101, 'installation', 'created', NULL, NULL, NULL, 1::smallint, '{}', NULL) AS o`)).rows[0].o).toBe('claimed');
      expect((await q(`SELECT github_installer_of(202)::text AS i`)).rows[0].i).toBe('7');
      expect((await q(`SELECT github_release_held_deliveries(202) AS n`)).rows[0].n).toBe(0); // unclaimed
      await q(`INSERT INTO github_installations (installation_id, organization_id, account_id, account_login, account_type, repository_selection,
        permissions_state, installer_github_user_id, claimed_by_github_user_id) VALUES (202, $1, 1, 'acme', 'Organization', 'all', 'expected', 7, 7)`, [orgA]);
      await q(`SELECT set_config('app.current_organization_id', $1, true)`, [orgB]);
      expect((await q(`SELECT github_release_held_deliveries(202) AS n`)).rows[0].n).toBe(0); // B does not hold the claim
      await q(`SELECT set_config('app.current_organization_id', $1, true)`, [orgA]);
      expect((await q(`SELECT github_release_held_deliveries(202) AS n`)).rows[0].n).toBe(1);
      expect((await q(`SELECT organization_id::text AS o, held_at IS NOT NULL AS h FROM pipeline_events WHERE delivery_id = '00000000-0000-4000-8000-000000000002'`)).rows)
        .toEqual([{ o: orgA, h: true }]);
      // Repositories: same-organization service only; (organization, GitHub id) unique; never by name.
      expect(await failure(`INSERT INTO pipeline_repositories (organization_id, github_repo_id, full_name, service_id) VALUES ($1, 11, 'a/b', $2)`, [orgA, svcB])).toBe('23514');
      await q(`INSERT INTO pipeline_repositories (organization_id, github_repo_id, installation_id, full_name, service_id) VALUES ($1, 11, 202, 'a/b', $2)`, [orgA, svcA]);
      expect(await failure(`INSERT INTO pipeline_repositories (organization_id, github_repo_id, full_name) VALUES ($1, 11, 'a/renamed')`, [orgA])).toBe('23505');
      await q(`INSERT INTO pipeline_repositories (organization_id, github_repo_id, full_name) VALUES ($1, 12, 'a/b')`, [orgA]); // same name, other id: allowed
      expect(await failure(`INSERT INTO pipeline_repositories (organization_id, github_repo_id, installation_id, full_name) VALUES ($1, 13, 101, 'a/c')`, [orgA])).toBe('23503'); // B's installation
      expect(await failure(`UPDATE pipeline_repositories SET service_id = $2 WHERE organization_id = $1 AND github_repo_id = 11`, [orgA, svcB])).toBe('23514');
      expect(await failure(`DELETE FROM pipeline_repositories WHERE organization_id = $1`, [orgA])).toBe('42501');
      // event_key unique per organization.
      await q(`INSERT INTO pipeline_events (delivery_id, organization_id, installation_id, event, action, event_key, normalizer_version, facts)
               VALUES (gen_random_uuid(), $1, 202, 'workflow_job', 'completed', 'workflow_job:1:completed', 1, '{}')`, [orgA]);
      expect(await failure(`INSERT INTO pipeline_events (delivery_id, organization_id, installation_id, event, action, event_key, normalizer_version, facts)
               VALUES (gen_random_uuid(), $1, 202, 'workflow_job', 'completed', 'workflow_job:1:completed', 1, '{}')`, [orgA])).toBe('23505');
      expect(await failure(`INSERT INTO pipeline_events (delivery_id, organization_id, installation_id, event, action, normalizer_version, facts)
               VALUES (gen_random_uuid(), $1, 202, 'push', 'x', 1, '{}')`, [orgA])).toBe('23514');
      expect(await failure(`UPDATE pipeline_events SET processing_reason = 'Has A Message' WHERE organization_id = $1`, [orgA])).toBe('23514');
      expect(await failure(`TRUNCATE pipeline_events`)).toBe('42501');
      expect(await failure(`ALTER TABLE pipeline_events NO FORCE ROW LEVEL SECURITY`)).toBe('42501');
      // Untagged: nothing visible.
      await q(`SELECT set_config('app.current_organization_id', '', true)`);
      for (const t of TENANT_TABLES) expect((await q(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n).toBe(0);
      await q('RESET ROLE');

      // deployments: one row per (organization, GitHub job id); region may be NULL.
      const insertDeployment = (o: string, s: string, jobId: string) => q(`INSERT INTO deployments (service_id, environment, aws_region, status, deployed_by, organization_id, metadata)
        VALUES ($1, 'production', NULL, 'success', 'gh', $2, jsonb_build_object('github_job_id', $3::bigint))`, [s, o, jobId]);
      await insertDeployment(orgA, svcA, '555');
      expect(await failure(`INSERT INTO deployments (service_id, environment, aws_region, status, deployed_by, organization_id, metadata)
        VALUES ($1, 'production', 'us-east-1', 'success', 'gh', $2, '{"github_job_id":"555"}')`, [svcA, orgA])).toBe('23505');
      await insertDeployment(orgB, svcB, '555'); // another organization: allowed

      // Demo workspace: refused on every tenant table.
      const existingDemo = (await q(`SELECT id::text AS id FROM organizations WHERE is_demo`)).rows[0]?.id as string | undefined;
      const demoOrg = existingDemo ?? await org('demo', true);
      expect(await failure(`INSERT INTO pipeline_repositories (organization_id, github_repo_id, full_name) VALUES ($1, 1, 'd/d')`, [demoOrg])).toBe('23514');
      expect(await failure(`INSERT INTO pipeline_events (delivery_id, organization_id, installation_id, event, action, normalizer_version, facts)
        VALUES (gen_random_uuid(), $1, 1, 'installation', 'created', 1, '{}')`, [demoOrg])).toBe('23514');
      expect(await failure(`INSERT INTO github_installations (installation_id, organization_id, account_id, account_login, account_type, repository_selection,
        permissions_state, installer_github_user_id, claimed_by_github_user_id) VALUES (303, $1, 1, 'd', 'User', 'all', 'expected', 1, 1)`, [demoOrg])).toBe('23514');

      // Re-run refused.
      await q('SAVEPOINT rerun');
      await expect(q(MIGRATION_SQL)).rejects.toThrow(/aws_region already has a comment|already exists -- this migration creates it/);
      await q('ROLLBACK TO SAVEPOINT rerun');

      // Rollback refuses while a deployment has no region; after a value is set it removes everything marked.
      await q('SAVEPOINT nullregion');
      await expect(q(ROLLBACK_SQL)).rejects.toThrow(/aws_region NULL -- NOT NULL cannot be restored/);
      await q('ROLLBACK TO SAVEPOINT nullregion');
      await q(`UPDATE deployments SET aws_region = 'us-east-1' WHERE aws_region IS NULL`);
      await q(`DELETE FROM deployments WHERE organization_id = ANY($1::uuid[])`, [[orgA, orgB]]);
      await q(`INSERT INTO schema_migrations (migration_name, checksum) VALUES ($1, 'test') ON CONFLICT (migration_name) DO NOTHING`, [MIGRATION_FILE]);
      await q(ROLLBACK_SQL);
      expect((await q(`SELECT to_regclass('public.pipeline_events') AS e, to_regclass('public.github_held_deliveries') AS h,
                         to_regclass('public.deployments_github_job_uidx') AS i, to_regprocedure('public.github_installation_org(bigint)') AS f,
                         (SELECT attnotnull FROM pg_attribute WHERE attrelid = 'public.deployments'::regclass AND attname = 'aws_region') AS nn,
                         (SELECT count(*)::int FROM schema_migrations WHERE migration_name = $1) AS ledger`, [MIGRATION_FILE])).rows[0])
        .toEqual({ e: null, h: null, i: null, f: null, nn: true, ledger: 0 });
      // An unmarked table of that name is never dropped.
      await q(MIGRATION_SQL);
      await q(`COMMENT ON TABLE public.pipeline_events IS 'someone else'`);
      await q('SAVEPOINT unmarked');
      await expect(q(ROLLBACK_SQL)).rejects.toThrow(/pipeline_events was not created by the paired migration/);
      await q('ROLLBACK TO SAVEPOINT unmarked');
    } finally {
      await q('ROLLBACK').catch(() => undefined);
      await client.end();
    }
  });
});
