-- Rollback: 202611101200_transfer_tenant_table_ownership.sql
--
-- Restores exactly the state the migration recorded in
-- public.admin_migration_prior_state for each of the nine tables (owner,
-- FORCE ROW LEVEL SECURITY, every ACL entry) and the owner of
-- update_refunds_updated_at(), then recomputes the same fingerprint and
-- refuses (rolling everything back) unless it equals the recorded one. Use
-- only if the migration itself breaks something: with devcontrol as owner
-- again, row level security stops applying to it on these tables.
-- Roll back this migration BEFORE 202611091300_harden_database_ownership.sql:
-- that rollback checks every other relation's owner and ACL in public, and
-- refuses while these nine are still postgres-owned.
-- Run as postgres in one transaction:
--
--   psql -X -v ON_ERROR_STOP=1 --single-transaction -d <database> \
--     -f 202611101200_transfer_tenant_table_ownership_rollback.sql
--
-- Never selected by CI (.github/scripts/ci-bootstrap-schema.js skips files
-- whose name contains "rollback").

SET LOCAL lock_timeout = '3s';

DO $$
DECLARE
  prior jsonb;
  t text;
  p jsonb;
  a record;
  now_tables jsonb;
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'must run as a superuser (current_user %) -- refusing to proceed.', current_user;
  END IF;
  IF to_regclass('public.admin_migration_prior_state') IS NOT NULL THEN
    -- Dynamic: a static reference would be planned (and fail) when the table is absent.
    EXECUTE 'SELECT prior_state FROM public.admin_migration_prior_state WHERE migration_name = $1'
       INTO prior USING '202611101200_transfer_tenant_table_ownership.sql';
  END IF;
  IF prior IS NULL THEN
    RAISE EXCEPTION 'no recorded prior state for 202611101200_transfer_tenant_table_ownership.sql -- refusing to proceed.';
  END IF;

  FOR t, p IN SELECT key, value FROM jsonb_each(prior->'tables') LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO %I', t, p->>'owner');
    IF NOT (p->>'force')::boolean THEN
      EXECUTE format('ALTER TABLE public.%I NO FORCE ROW LEVEL SECURITY', t);
    END IF;
    -- Remove every grant the table has now, then grant exactly the recorded entries.
    FOR a IN SELECT DISTINCT x.grantee FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
              WHERE c.oid = ('public.' || t)::regclass LOOP
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %s', t,
                     CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END);
    END LOOP;
    FOR a IN SELECT * FROM aclexplode((p->>'acl_raw')::aclitem[]) LOOP
      EXECUTE format('GRANT %s ON TABLE public.%I TO %s', a.privilege_type, t,
                     CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END);
    END LOOP;
  END LOOP;

  EXECUTE format('ALTER FUNCTION public.update_refunds_updated_at() OWNER TO %I', prior->>'refunds_trigger_function_owner');

  -- Recompute the recorded fingerprint and require equality.
  SELECT jsonb_object_agg(c.relname, jsonb_build_object(
           'owner', pg_get_userbyid(c.relowner),
           'force', c.relforcerowsecurity,
           'acl', (SELECT coalesce(string_agg(e, ',' ORDER BY e), '') FROM (
                     SELECT CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END
                            || '=' || x.privilege_type || '/' || pg_get_userbyid(x.grantor) AS e
                       FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x) y),
           'index_owners', (SELECT coalesce(string_agg(i.relname || '=' || pg_get_userbyid(i.relowner), ',' ORDER BY i.relname), '')
                              FROM pg_index ix JOIN pg_class i ON i.oid = ix.indexrelid WHERE ix.indrelid = c.oid)))
    INTO now_tables
    FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
     AND c.relname IN (SELECT jsonb_object_keys(prior->'tables'));

  IF now_tables <> (SELECT jsonb_object_agg(key, value - 'acl_raw') FROM jsonb_each(prior->'tables')) THEN
    RAISE EXCEPTION 'rollback read-back: restored tables % differ from recorded %',
      now_tables, (SELECT jsonb_object_agg(key, value - 'acl_raw') FROM jsonb_each(prior->'tables'));
  END IF;
  IF (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid = 'public.update_refunds_updated_at()'::regprocedure)
     <> prior->>'refunds_trigger_function_owner' THEN
    RAISE EXCEPTION 'rollback read-back: update_refunds_updated_at() owner differs from the recorded one';
  END IF;
  IF (SELECT md5(coalesce(string_agg(c.relname || '|' || c.relkind::text || '|' || pg_get_userbyid(c.relowner)
                                     || '|' || coalesce(c.relacl::text, '') || '|' || c.relforcerowsecurity::text, ';' ORDER BY c.relname), ''))
        FROM pg_class c
       WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
         AND c.relname NOT IN ('security_hub_findings', 'organization_security_hub_state', 'soc2_evidence_observations',
                               'soc2_control_evaluations', 'cost_analysis_runs', 'customer_evidence',
                               'organization_optimization_rule_configs', 'refunds', 'slo_definitions', 'admin_migration_prior_state'))
     <> prior->>'other_relations_md5' THEN
    RAISE EXCEPTION 'rollback read-back: another relation in public changed since the migration';
  END IF;

  DELETE FROM public.admin_migration_prior_state WHERE migration_name = '202611101200_transfer_tenant_table_ownership.sql';
  IF NOT EXISTS (SELECT 1 FROM public.admin_migration_prior_state) THEN
    DROP TABLE public.admin_migration_prior_state;
  END IF;
END $$;

DELETE FROM schema_migrations WHERE migration_name = '202611101200_transfer_tenant_table_ownership.sql';
