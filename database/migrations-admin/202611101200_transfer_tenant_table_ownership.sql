-- Migration: postgres owns the nine row-level-security tenant tables that the
-- application role devcontrol created through the ordinary migration path
-- (AWS connect C-G). One transaction (database/migrate.js), 3 s lock timeout,
-- all or nothing.
--
-- Tables: security_hub_findings, organization_security_hub_state,
-- soc2_evidence_observations, soc2_control_evaluations, cost_analysis_runs,
-- customer_evidence, organization_optimization_rule_configs, refunds,
-- slo_definitions.
--
-- For each table:
--   * ALTER TABLE ... OWNER TO postgres (its indexes follow);
--   * FORCE ROW LEVEL SECURITY;
--   * REVOKE ALL from PUBLIC and devcontrol, then GRANT devcontrol exactly the
--     privileges the application uses (no TRUNCATE, REFERENCES or TRIGGER):
--       SELECT, INSERT, UPDATE           every table (each has an upsert or UPDATE)
--       DELETE                           only soc2_evidence_observations,
--                                        organization_optimization_rule_configs,
--                                        slo_definitions
--     A table owner's privileges are rewritten to the new owner by ALTER ...
--     OWNER, so without these grants devcontrol would keep nothing.
-- Dependent objects: refunds' trigger function update_refunds_updated_at()
-- also becomes postgres-owned, so the application role cannot replace code
-- that runs whenever anyone (an administrator included) updates refunds. The
-- tables have no other triggers, no sequences, no views and no inbound foreign
-- keys; the guard refuses otherwise.
--
-- Requires 202611091300_harden_database_ownership.sql (database owned by
-- postgres). The prior state is recorded in public.admin_migration_prior_state
-- so the paired rollback restores it exactly and checks that it did.
-- Administrative: needs a superuser. Locks: ACCESS EXCLUSIVE on the nine tables
-- and their indexes for the transaction's few milliseconds; nothing on
-- organizations.
-- Paired rollback: 202611101200_transfer_tenant_table_ownership_rollback.sql.

SET LOCAL lock_timeout = '3s';

-- ---------------------------------------------------------------------------
-- Guard: refuse (nothing applied) unless every assumption holds.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  tables constant text[] := ARRAY['security_hub_findings', 'organization_security_hub_state',
    'soc2_evidence_observations', 'soc2_control_evaluations', 'cost_analysis_runs', 'customer_evidence',
    'organization_optimization_rule_configs', 'refunds', 'slo_definitions'];
  tenant_expr constant text := '((organization_id)::text = current_setting(''app.current_organization_id''::text, true))';
  r record;
  recorded boolean;
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'must run as a superuser (current_user %) -- refusing to proceed.', current_user;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres' AND rolsuper) THEN
    RAISE EXCEPTION 'role postgres is missing or not a superuser -- refusing to proceed.';
  END IF;
  SELECT rolsuper, rolbypassrls, rolcreaterole INTO r FROM pg_roles WHERE rolname = 'devcontrol';
  IF NOT FOUND THEN RAISE EXCEPTION 'role devcontrol does not exist -- refusing to proceed.'; END IF;
  IF r.rolsuper OR r.rolbypassrls OR r.rolcreaterole THEN
    RAISE EXCEPTION 'devcontrol is SUPERUSER, BYPASSRLS or CREATEROLE -- refusing to proceed.';
  END IF;
  IF pg_has_role('devcontrol', 'postgres', 'MEMBER') THEN
    RAISE EXCEPTION 'devcontrol is a member of postgres -- refusing to proceed.';
  END IF;
  IF (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()) <> 'postgres'
     OR has_schema_privilege('devcontrol', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'apply 202611091300_harden_database_ownership.sql first (database owned by postgres, no CREATE on public for devcontrol) -- refusing to proceed.';
  END IF;
  IF to_regclass('public.admin_migration_prior_state') IS NOT NULL THEN
    -- Dynamic: a static reference would be planned (and fail) when the table is absent.
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.admin_migration_prior_state WHERE migration_name = $1)'
       INTO recorded USING '202611101200_transfer_tenant_table_ownership.sql';
    IF recorded THEN
      RAISE EXCEPTION 'a prior state for this migration is already recorded -- refusing to proceed.';
    END IF;
  END IF;

  FOREACH t IN ARRAY tables LOOP
    SELECT c.oid, c.relrowsecurity, pg_get_userbyid(c.relowner) AS owner INTO r
      FROM pg_class c WHERE c.oid = to_regclass('public.' || t);
    IF NOT FOUND OR r.oid IS NULL THEN RAISE EXCEPTION '% does not exist -- refusing to proceed.', t; END IF;
    IF NOT r.relrowsecurity THEN RAISE EXCEPTION '% has row level security disabled -- refusing to proceed.', t; END IF;
    IF r.owner NOT IN ('devcontrol', 'postgres') THEN
      RAISE EXCEPTION '% is owned by % (expected devcontrol or postgres) -- refusing to proceed.', t, r.owner;
    END IF;
    IF (SELECT count(*) FROM pg_policy p WHERE p.polrelid = r.oid) <> 2
       OR EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = r.oid
                   AND (NOT p.polpermissive OR p.polroles <> '{0}'::oid[]
                        OR NOT ((p.polcmd = '*' AND pg_get_expr(p.polqual, p.polrelid) = tenant_expr AND p.polwithcheck IS NULL)
                             OR (p.polcmd = 'a' AND p.polqual IS NULL AND pg_get_expr(p.polwithcheck, p.polrelid) = tenant_expr))))
       OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = r.oid AND p.polcmd = '*')
       OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = r.oid AND p.polcmd = 'a') THEN
      RAISE EXCEPTION '% does not have exactly the two expected tenant policies -- refusing to proceed; re-plan.', t;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_depend d JOIN pg_rewrite w ON d.classid = 'pg_rewrite'::regclass AND d.objid = w.oid
                WHERE d.refobjid = r.oid AND w.ev_class <> r.oid)
       OR EXISTS (SELECT 1 FROM pg_depend d JOIN pg_class s ON d.classid = 'pg_class'::regclass AND d.objid = s.oid AND s.relkind = 'S'
                   WHERE d.refobjid = r.oid)
       OR EXISTS (SELECT 1 FROM pg_constraint f WHERE f.contype = 'f' AND f.confrelid = r.oid) THEN
      RAISE EXCEPTION '% has a view, rule, owned sequence or inbound foreign key -- refusing to proceed; re-plan.', t;
    END IF;
  END LOOP;

  -- The only user trigger on the nine tables: refunds_updated_at -> update_refunds_updated_at().
  IF (SELECT array_agg(t.tgrelid::regclass::text || ':' || t.tgname || ':' || t.tgfoid::regprocedure::text ORDER BY 1)
        FROM pg_trigger t
       WHERE NOT t.tgisinternal AND t.tgrelid IN (SELECT to_regclass('public.' || x) FROM unnest(tables) x))
     IS DISTINCT FROM ARRAY['refunds:refunds_updated_at:update_refunds_updated_at()'] THEN
    RAISE EXCEPTION 'the user triggers on the nine tables are not exactly refunds_updated_at -- refusing to proceed; re-plan.';
  END IF;
  SELECT pg_get_userbyid(p.proowner) AS owner, p.prosecdef, l.lanname, btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g')) AS body INTO r
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.oid = 'public.update_refunds_updated_at()'::regprocedure;
  IF r.owner NOT IN ('devcontrol', 'postgres') OR r.prosecdef OR r.lanname <> 'plpgsql'
     OR r.body <> 'BEGIN NEW.updated_at = NOW(); RETURN NEW; END;' THEN
    RAISE EXCEPTION 'update_refunds_updated_at() is not the expected devcontrol- or postgres-owned invoker function -- refusing to proceed; re-plan.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Record the prior state (read by the rollback).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_migration_prior_state (
  migration_name TEXT PRIMARY KEY,
  prior_state JSONB NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);
ALTER TABLE public.admin_migration_prior_state OWNER TO postgres;
REVOKE ALL ON TABLE public.admin_migration_prior_state FROM PUBLIC;

INSERT INTO public.admin_migration_prior_state (migration_name, prior_state)
SELECT '202611101200_transfer_tenant_table_ownership.sql',
       jsonb_build_object(
         'tables', (SELECT jsonb_object_agg(c.relname, jsonb_build_object(
                      'owner', pg_get_userbyid(c.relowner),
                      'force', c.relforcerowsecurity,
                      'acl_raw', coalesce(c.relacl, acldefault('r', c.relowner))::text,
                      'acl', (SELECT coalesce(string_agg(e, ',' ORDER BY e), '') FROM (
                                SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END
                                       || '=' || a.privilege_type || '/' || pg_get_userbyid(a.grantor) AS e
                                  FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a) x),
                      'index_owners', (SELECT coalesce(string_agg(i.relname || '=' || pg_get_userbyid(i.relowner), ',' ORDER BY i.relname), '')
                                         FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid WHERE x.indrelid = c.oid)))
                      FROM pg_class c
                     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
                       AND c.relname IN ('security_hub_findings', 'organization_security_hub_state', 'soc2_evidence_observations',
                                         'soc2_control_evaluations', 'cost_analysis_runs', 'customer_evidence',
                                         'organization_optimization_rule_configs', 'refunds', 'slo_definitions')),
         'refunds_trigger_function_owner', (SELECT pg_get_userbyid(proowner) FROM pg_proc
                                             WHERE oid = 'public.update_refunds_updated_at()'::regprocedure),
         'other_relations_md5', (SELECT md5(coalesce(string_agg(c.relname || '|' || c.relkind::text || '|' || pg_get_userbyid(c.relowner)
                                                                || '|' || coalesce(c.relacl::text, '') || '|' || c.relforcerowsecurity::text,
                                                                ';' ORDER BY c.relname), ''))
                                   FROM pg_class c
                                  WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
                                    AND c.relname NOT IN ('security_hub_findings', 'organization_security_hub_state', 'soc2_evidence_observations',
                                                          'soc2_control_evaluations', 'cost_analysis_runs', 'customer_evidence',
                                                          'organization_optimization_rule_configs', 'refunds', 'slo_definitions',
                                                          'admin_migration_prior_state')));

-- ---------------------------------------------------------------------------
-- The transfer.
-- ---------------------------------------------------------------------------
ALTER TABLE public.security_hub_findings                  OWNER TO postgres;
ALTER TABLE public.organization_security_hub_state        OWNER TO postgres;
ALTER TABLE public.soc2_evidence_observations             OWNER TO postgres;
ALTER TABLE public.soc2_control_evaluations               OWNER TO postgres;
ALTER TABLE public.cost_analysis_runs                     OWNER TO postgres;
ALTER TABLE public.customer_evidence                      OWNER TO postgres;
ALTER TABLE public.organization_optimization_rule_configs OWNER TO postgres;
ALTER TABLE public.refunds                                OWNER TO postgres;
ALTER TABLE public.slo_definitions                        OWNER TO postgres;

ALTER TABLE public.security_hub_findings                  FORCE ROW LEVEL SECURITY;
ALTER TABLE public.organization_security_hub_state        FORCE ROW LEVEL SECURITY;
ALTER TABLE public.soc2_evidence_observations             FORCE ROW LEVEL SECURITY;
ALTER TABLE public.soc2_control_evaluations               FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cost_analysis_runs                     FORCE ROW LEVEL SECURITY;
ALTER TABLE public.customer_evidence                      FORCE ROW LEVEL SECURITY;
ALTER TABLE public.organization_optimization_rule_configs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.refunds                                FORCE ROW LEVEL SECURITY;
ALTER TABLE public.slo_definitions                        FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.security_hub_findings, public.organization_security_hub_state,
  public.soc2_evidence_observations, public.soc2_control_evaluations, public.cost_analysis_runs,
  public.customer_evidence, public.organization_optimization_rule_configs, public.refunds,
  public.slo_definitions FROM PUBLIC, devcontrol;

GRANT SELECT, INSERT, UPDATE ON TABLE public.security_hub_findings, public.organization_security_hub_state,
  public.soc2_control_evaluations, public.cost_analysis_runs, public.customer_evidence, public.refunds TO devcontrol;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.soc2_evidence_observations,
  public.organization_optimization_rule_configs, public.slo_definitions TO devcontrol;

ALTER FUNCTION public.update_refunds_updated_at() OWNER TO postgres;

-- ---------------------------------------------------------------------------
-- Read-back: fail the transaction unless the end state is exact.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  with_delete constant text[] := ARRAY['soc2_evidence_observations', 'organization_optimization_rule_configs', 'slo_definitions'];
  r record;
  prior jsonb;
  privs text;
  expected_privs text;
  others_now text;
BEGIN
  FOREACH t IN ARRAY ARRAY['security_hub_findings', 'organization_security_hub_state', 'soc2_evidence_observations',
                           'soc2_control_evaluations', 'cost_analysis_runs', 'customer_evidence',
                           'organization_optimization_rule_configs', 'refunds', 'slo_definitions'] LOOP
    SELECT c.oid, c.relacl, c.relowner, pg_get_userbyid(c.relowner) AS owner, c.relrowsecurity, c.relforcerowsecurity INTO r
      FROM pg_class c WHERE c.oid = ('public.' || t)::regclass;
    IF r.owner <> 'postgres' OR NOT r.relrowsecurity OR NOT r.relforcerowsecurity THEN
      RAISE EXCEPTION 'read-back: % owner % rls % force %', t, r.owner, r.relrowsecurity, r.relforcerowsecurity;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid WHERE x.indrelid = r.oid AND i.relowner <> r.relowner) THEN
      RAISE EXCEPTION 'read-back: an index of % is not owned by postgres', t;
    END IF;
    SELECT string_agg(p, ',' ORDER BY p) INTO privs
      FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
     WHERE has_table_privilege('devcontrol', r.oid, p);
    -- Assigned first: PL/pgSQL ends an IF condition at the first THEN, a CASE's included.
    expected_privs := CASE WHEN t = ANY (with_delete) THEN 'DELETE,INSERT,SELECT,UPDATE' ELSE 'INSERT,SELECT,UPDATE' END;
    IF privs IS DISTINCT FROM expected_privs THEN
      RAISE EXCEPTION 'read-back: devcontrol has % on % (expected %)', privs, t, expected_privs;
    END IF;
    IF EXISTS (SELECT 1 FROM aclexplode(r.relacl) a WHERE a.grantee NOT IN (r.relowner, 'devcontrol'::regrole)) THEN
      RAISE EXCEPTION 'read-back: % grants to a role other than postgres and devcontrol (or to PUBLIC)', t;
    END IF;
    IF (SELECT count(*) FROM pg_policy WHERE polrelid = r.oid) <> 2 THEN
      RAISE EXCEPTION 'read-back: the policies of % changed', t;
    END IF;
  END LOOP;

  IF (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid = 'public.update_refunds_updated_at()'::regprocedure) <> 'postgres' THEN
    RAISE EXCEPTION 'read-back: update_refunds_updated_at() is not owned by postgres';
  END IF;

  SELECT prior_state INTO STRICT prior FROM public.admin_migration_prior_state
   WHERE migration_name = '202611101200_transfer_tenant_table_ownership.sql';
  IF (SELECT count(*) FROM jsonb_object_keys(prior->'tables')) <> 9 THEN
    RAISE EXCEPTION 'read-back: the recorded prior state does not cover the nine tables';
  END IF;
  SELECT md5(coalesce(string_agg(c.relname || '|' || c.relkind::text || '|' || pg_get_userbyid(c.relowner)
                                 || '|' || coalesce(c.relacl::text, '') || '|' || c.relforcerowsecurity::text, ';' ORDER BY c.relname), ''))
    INTO others_now
    FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
     AND c.relname NOT IN ('security_hub_findings', 'organization_security_hub_state', 'soc2_evidence_observations',
                           'soc2_control_evaluations', 'cost_analysis_runs', 'customer_evidence',
                           'organization_optimization_rule_configs', 'refunds', 'slo_definitions', 'admin_migration_prior_state');
  IF others_now <> prior->>'other_relations_md5' THEN
    RAISE EXCEPTION 'read-back: an owner, ACL or FORCE setting of another relation in public changed';
  END IF;
END $$;
