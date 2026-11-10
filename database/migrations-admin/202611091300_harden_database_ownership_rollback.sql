-- Rollback: 202611091300_harden_database_ownership.sql
--
-- Restores exactly the state the migration recorded in
-- public.admin_migration_prior_state: the database owner and ACL, schema
-- public's ACL, the onboarding trigger function as it was (009 body, no
-- function-level search_path, its prior SECURITY DEFINER/INVOKER and owner),
-- and removes the nl_query_analytics relations only if the migration created
-- them (refusing if the table then holds rows). It then recomputes the same
-- fingerprint and refuses (rolling everything back) unless it equals the
-- recorded one. Use only if the migration itself breaks something: it removes
-- the hardening. Run as postgres in one transaction:
--
--   psql -X -v ON_ERROR_STOP=1 --single-transaction -d <database> \
--     -f 202611091300_harden_database_ownership_rollback.sql
--
-- Never selected by CI (.github/scripts/ci-bootstrap-schema.js skips files
-- whose name contains "rollback").

SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.initialize_onboarding_for_organization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  -- When a new organization is created, initialize onboarding
  INSERT INTO onboarding_progress (
    organization_id,
    user_id,
    current_stage,
    started_at
  )
  VALUES (
    NEW.id,
    NULL, -- Will be set when first user accesses
    'welcome',
    NOW()
  )
  ON CONFLICT (organization_id) DO NOTHING;

  RETURN NEW;
END;
$function$;

DO $$
DECLARE
  prior jsonb;
  now_state jsonb;
  a record;
  db text := current_database();
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'must run as a superuser (current_user %) -- refusing to proceed.', current_user;
  END IF;
  IF to_regclass('public.admin_migration_prior_state') IS NOT NULL THEN
    -- Dynamic: a static reference would be planned (and fail) when the table is absent.
    EXECUTE 'SELECT prior_state FROM public.admin_migration_prior_state WHERE migration_name = $1'
       INTO prior USING '202611091300_harden_database_ownership.sql';
  END IF;
  IF prior IS NULL THEN
    RAISE EXCEPTION 'no recorded prior state for 202611091300_harden_database_ownership.sql -- refusing to proceed.';
  END IF;

  -- The function's prior attributes.
  EXECUTE format('ALTER FUNCTION public.initialize_onboarding_for_organization() OWNER TO %I', prior->'function'->>'owner');
  IF NOT (prior->'function'->>'secdef')::boolean THEN
    ALTER FUNCTION public.initialize_onboarding_for_organization() SECURITY INVOKER;
  END IF;

  -- nl_query_analytics: remove only what the migration created.
  IF NOT (prior->'nl'->>'query_index')::boolean AND to_regclass('public.idx_nl_analytics_query') IS NOT NULL THEN
    DROP INDEX public.idx_nl_analytics_query;
  END IF;
  IF NOT (prior->'nl'->>'org_index')::boolean AND to_regclass('public.idx_nl_analytics_org_created') IS NOT NULL THEN
    DROP INDEX public.idx_nl_analytics_org_created;
  END IF;
  IF NOT (prior->'nl'->>'table')::boolean AND to_regclass('public.nl_query_analytics') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.nl_query_analytics) THEN
      RAISE EXCEPTION 'nl_query_analytics was created by the migration and now holds rows -- refusing to drop it.';
    END IF;
    DROP TABLE public.nl_query_analytics;
  END IF;

  -- The database owner, then every prior ACL entry of the database and of schema public.
  EXECUTE format('ALTER DATABASE %I OWNER TO %I', db, prior->>'db_owner');
  FOR a IN SELECT * FROM aclexplode((prior->>'db_acl_raw')::aclitem[]) LOOP
    EXECUTE format('GRANT %s ON DATABASE %I TO %s', a.privilege_type, db,
                   CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END);
  END LOOP;
  FOR a IN SELECT * FROM aclexplode((prior->>'public_acl_raw')::aclitem[]) LOOP
    EXECUTE format('GRANT %s ON SCHEMA public TO %s', a.privilege_type,
                   CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END);
  END LOOP;

  -- Recompute the recorded fingerprint and require equality.
  SELECT jsonb_build_object(
           'db_owner', pg_get_userbyid(d.datdba),
           'db_acl', (SELECT coalesce(string_agg(e, ',' ORDER BY e), '') FROM (
                        SELECT CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END
                               || '=' || x.privilege_type || '/' || pg_get_userbyid(x.grantor) AS e
                          FROM aclexplode(coalesce(d.datacl, acldefault('d', d.datdba))) x) y),
           'public_owner', pg_get_userbyid(n.nspowner),
           'public_acl', (SELECT coalesce(string_agg(e, ',' ORDER BY e), '') FROM (
                            SELECT CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END
                                   || '=' || x.privilege_type || '/' || pg_get_userbyid(x.grantor) AS e
                              FROM aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) x) y),
           'devcontrol', jsonb_build_object(
             'db_connect', has_database_privilege('devcontrol', d.oid, 'CONNECT'),
             'db_create', has_database_privilege('devcontrol', d.oid, 'CREATE'),
             'db_temp', has_database_privilege('devcontrol', d.oid, 'TEMPORARY'),
             'public_usage', has_schema_privilege('devcontrol', n.oid, 'USAGE'),
             'public_create', has_schema_privilege('devcontrol', n.oid, 'CREATE'),
             'database_owner_member', pg_has_role('devcontrol', 'pg_database_owner', 'MEMBER')),
           'relations_md5', (SELECT md5(coalesce(string_agg(c.relname || '|' || c.relkind::text || '|' || pg_get_userbyid(c.relowner)
                                                            || '|' || coalesce(c.relacl::text, ''), ';' ORDER BY c.relname), ''))
                               FROM pg_class c
                              WHERE c.relnamespace = n.oid
                                AND c.relname NOT IN ('nl_query_analytics', 'idx_nl_analytics_org_created', 'idx_nl_analytics_query',
                                                      'nl_query_analytics_pkey', 'admin_migration_prior_state',
                                                      'admin_migration_prior_state_pkey')),
           'function', (SELECT jsonb_build_object('secdef', p.prosecdef, 'owner', pg_get_userbyid(p.proowner),
                                                  'config', p.proconfig::text,
                                                  'body_md5', md5(btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))))
                          FROM pg_proc p WHERE p.oid = 'public.initialize_onboarding_for_organization()'::regprocedure),
           'nl', jsonb_build_object(
             'table', to_regclass('public.nl_query_analytics') IS NOT NULL,
             'org_index', to_regclass('public.idx_nl_analytics_org_created') IS NOT NULL,
             'query_index', to_regclass('public.idx_nl_analytics_query') IS NOT NULL))
    INTO now_state
    FROM pg_database d, pg_namespace n
   WHERE d.datname = db AND n.nspname = 'public';

  IF now_state <> (prior - 'db_acl_raw' - 'public_acl_raw') THEN
    RAISE EXCEPTION 'rollback read-back: restored state % differs from recorded %', now_state, prior - 'db_acl_raw' - 'public_acl_raw';
  END IF;

  DELETE FROM public.admin_migration_prior_state WHERE migration_name = '202611091300_harden_database_ownership.sql';
  IF NOT EXISTS (SELECT 1 FROM public.admin_migration_prior_state) THEN
    DROP TABLE public.admin_migration_prior_state;
  END IF;
END $$;

DELETE FROM schema_migrations WHERE migration_name = '202611091300_harden_database_ownership.sql';
