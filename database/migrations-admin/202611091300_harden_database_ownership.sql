-- Migration: database ownership and privilege hardening for the application
-- role devcontrol (AWS connect C-G0). One transaction (database/migrate.js),
-- 3 s lock timeout, all or nothing.
--
-- 1. nl_query_analytics and its two indexes are created here when absent, so
--    no install depends on the application creating them at runtime (the
--    application now only checks that they exist). Where they already exist
--    they are left as they are; the table's columns must match.
-- 2. The database is owned by postgres. devcontrol therefore stops being a
--    member of pg_database_owner (the owner of schema public on PostgreSQL 15
--    and later) and cannot create schemas, publications or objects in public,
--    or drop the database.
-- 3. CREATE and TEMPORARY on the database are revoked from PUBLIC and
--    devcontrol, and CREATE on schema public from PUBLIC and devcontrol.
--    devcontrol keeps CONNECT and USAGE on public (both through PUBLIC) and
--    every table privilege and ownership it has today.
-- 4. initialize_onboarding_for_organization(), the AFTER INSERT trigger on
--    organizations that creates a new organization's onboarding_progress row,
--    becomes postgres-owned SECURITY DEFINER with
--    SET search_path = pg_catalog, public, pg_temp and schema-qualified
--    references; same body and effect otherwise.
--
-- The prior state (owners, the database and public ACLs, devcontrol's
-- effective privileges, the function's attributes, which nl_query_analytics
-- relations existed, and a digest of every relation's owner and ACL in
-- public) is recorded in public.admin_migration_prior_state, so the paired
-- rollback restores exactly that state and checks it did.
--
-- Administrative: needs a superuser. It takes no lock on the database or on
-- organizations; it locks the function object, and nl_query_analytics only if
-- it has to create one of its relations.
-- Paired rollback: 202611091300_harden_database_ownership_rollback.sql.

SET LOCAL lock_timeout = '3s';

-- ---------------------------------------------------------------------------
-- Guard: refuse (nothing applied) unless every assumption holds.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  fn record;
  r record;
  expected_body constant text :=
    'BEGIN -- When a new organization is created, initialize onboarding INSERT INTO onboarding_progress '
    || '( organization_id, user_id, current_stage, started_at ) VALUES ( NEW.id, NULL, -- Will be set when '
    || 'first user accesses ''welcome'', NOW() ) ON CONFLICT (organization_id) DO NOTHING; RETURN NEW; END;';
  expected_nl_columns constant text :=
    'id:uuid:true:gen_random_uuid(),organization_id:uuid:true:,query:text:true:,'
    || 'target:character varying(50):true:,action:character varying(50):true:,filter_count:integer:false:0,'
    || 'confidence:character varying(20):true:,was_cached:boolean:false:false,response_time:integer:true:,'
    || 'created_at:timestamp without time zone:false:now()';
  nl_columns text;
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
  IF (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()) NOT IN ('devcontrol', 'postgres') THEN
    RAISE EXCEPTION 'the database is owned by neither devcontrol nor postgres -- refusing to proceed; re-plan.';
  END IF;
  IF (SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = 'public') NOT IN ('pg_database_owner', 'postgres') THEN
    RAISE EXCEPTION 'schema public is owned by neither pg_database_owner nor postgres -- refusing to proceed; re-plan.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspowner = 'devcontrol'::regrole) THEN
    RAISE EXCEPTION 'devcontrol owns a schema -- refusing to proceed; re-plan.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_extension WHERE pg_has_role('devcontrol', extowner, 'MEMBER')) THEN
    RAISE EXCEPTION 'devcontrol owns an extension -- refusing to proceed; re-plan.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pg_has_role('devcontrol', pubowner, 'MEMBER'))
     OR EXISTS (SELECT 1 FROM pg_subscription WHERE pg_has_role('devcontrol', subowner, 'MEMBER'))
     OR EXISTS (SELECT 1 FROM pg_event_trigger WHERE pg_has_role('devcontrol', evtowner, 'MEMBER')) THEN
    RAISE EXCEPTION 'devcontrol owns a publication, subscription or event trigger -- refusing to proceed; re-plan.';
  END IF;
  IF to_regclass('public.admin_migration_prior_state') IS NOT NULL THEN
    -- Dynamic: a static reference would be planned (and fail) before the table exists.
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.admin_migration_prior_state WHERE migration_name = $1)'
       INTO recorded USING '202611091300_harden_database_ownership.sql';
    IF recorded THEN
      RAISE EXCEPTION 'a prior state for this migration is already recorded -- refusing to proceed.';
    END IF;
  END IF;

  IF (SELECT count(*) FROM pg_proc WHERE proname = 'initialize_onboarding_for_organization') <> 1 THEN
    RAISE EXCEPTION 'expected exactly one initialize_onboarding_for_organization function -- refusing to proceed.';
  END IF;
  SELECT p.oid, p.pronamespace::regnamespace::text AS schema, p.pronargs, p.prorettype::regtype::text AS rettype,
         l.lanname, o.rolsuper AS owner_is_superuser,
         btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g')) AS body
    INTO fn
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang JOIN pg_roles o ON o.oid = p.proowner
   WHERE p.proname = 'initialize_onboarding_for_organization';
  IF fn.schema <> 'public' OR fn.pronargs <> 0 OR fn.rettype <> 'trigger' OR fn.lanname <> 'plpgsql' THEN
    RAISE EXCEPTION 'initialize_onboarding_for_organization is not public.(), RETURNS trigger, plpgsql -- refusing to proceed.';
  END IF;
  IF NOT fn.owner_is_superuser THEN
    RAISE EXCEPTION 'initialize_onboarding_for_organization is not owned by a superuser -- refusing to proceed.';
  END IF;
  IF fn.body <> expected_body THEN
    RAISE EXCEPTION 'initialize_onboarding_for_organization body differs from 009 -- refusing to proceed; re-plan.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgname = 'trigger_initialize_onboarding' AND t.tgrelid = 'public.organizations'::regclass
       AND t.tgfoid = fn.oid AND NOT t.tgisinternal AND t.tgenabled = 'O'
       AND (t.tgtype & 1) = 1      -- FOR EACH ROW
       AND (t.tgtype & 2) = 0      -- AFTER
       AND (t.tgtype & 4) = 4      -- INSERT
  ) THEN
    RAISE EXCEPTION 'trigger_initialize_onboarding is not an enabled AFTER INSERT FOR EACH ROW trigger on organizations calling this function -- refusing to proceed.';
  END IF;
  IF to_regclass('public.onboarding_progress') IS NULL THEN
    RAISE EXCEPTION 'public.onboarding_progress does not exist -- refusing to proceed.';
  END IF;

  IF to_regclass('public.nl_query_analytics') IS NOT NULL THEN
    SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':'
                      || coalesce(pg_get_expr(d.adbin, d.adrelid), ''), ',' ORDER BY a.attnum)
      INTO nl_columns
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE a.attrelid = 'public.nl_query_analytics'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
    IF nl_columns <> expected_nl_columns THEN
      RAISE EXCEPTION 'nl_query_analytics exists with different columns -- refusing to proceed; re-plan.';
    END IF;
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
COMMENT ON TABLE public.admin_migration_prior_state IS
  'Prior state recorded by administrative migrations whose paired rollback restores it exactly. Owned by postgres; no application access.';

INSERT INTO public.admin_migration_prior_state (migration_name, prior_state)
SELECT '202611091300_harden_database_ownership.sql',
       jsonb_build_object(
         'db_owner', pg_get_userbyid(d.datdba),
         'db_acl_raw', coalesce(d.datacl, acldefault('d', d.datdba))::text,
         'db_acl', (SELECT coalesce(string_agg(e, ',' ORDER BY e), '') FROM (
                      SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END
                             || '=' || a.privilege_type || '/' || pg_get_userbyid(a.grantor) AS e
                        FROM aclexplode(coalesce(d.datacl, acldefault('d', d.datdba))) a) x),
         'public_owner', pg_get_userbyid(n.nspowner),
         'public_acl_raw', coalesce(n.nspacl, acldefault('n', n.nspowner))::text,
         'public_acl', (SELECT coalesce(string_agg(e, ',' ORDER BY e), '') FROM (
                          SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END
                                 || '=' || a.privilege_type || '/' || pg_get_userbyid(a.grantor) AS e
                            FROM aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a) x),
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
  FROM pg_database d, pg_namespace n
 WHERE d.datname = current_database() AND n.nspname = 'public';

-- ---------------------------------------------------------------------------
-- 1. nl_query_analytics: created here when absent (no runtime DDL).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.nl_query_analytics') IS NULL THEN
    CREATE TABLE public.nl_query_analytics (
      id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
      organization_id UUID NOT NULL,
      query TEXT NOT NULL,
      target VARCHAR(50) NOT NULL,
      action VARCHAR(50) NOT NULL,
      filter_count INTEGER DEFAULT 0,
      confidence VARCHAR(20) NOT NULL,
      was_cached BOOLEAN DEFAULT false,
      response_time INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT pg_catalog.now()
    );
    ALTER TABLE public.nl_query_analytics OWNER TO postgres;
    GRANT SELECT, INSERT ON TABLE public.nl_query_analytics TO devcontrol;
  END IF;
  IF to_regclass('public.idx_nl_analytics_org_created') IS NULL THEN
    CREATE INDEX idx_nl_analytics_org_created ON public.nl_query_analytics (organization_id, created_at DESC);
  END IF;
  IF to_regclass('public.idx_nl_analytics_query') IS NULL THEN
    CREATE INDEX idx_nl_analytics_query ON public.nl_query_analytics (query);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2.-3. Database owner postgres; CREATE/TEMPORARY revoked.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I OWNER TO postgres', current_database());
  EXECUTE format('REVOKE CREATE, TEMPORARY ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('REVOKE CREATE, TEMPORARY ON DATABASE %I FROM devcontrol', current_database());
END $$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM devcontrol;

-- ---------------------------------------------------------------------------
-- 4. The onboarding trigger function: pinned search_path, qualified references.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.initialize_onboarding_for_organization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
BEGIN
  -- When a new organization is created, initialize onboarding
  INSERT INTO public.onboarding_progress (
    organization_id,
    user_id,
    current_stage,
    started_at
  )
  VALUES (
    NEW.id,
    NULL, -- Will be set when first user accesses
    'welcome',
    pg_catalog.now()
  )
  ON CONFLICT (organization_id) DO NOTHING;

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.initialize_onboarding_for_organization() OWNER TO postgres;

-- ---------------------------------------------------------------------------
-- Read-back: fail the transaction unless the end state is exact.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  fn record;
  db record;
  prior jsonb;
  relations_now text;
BEGIN
  SELECT d.oid, pg_get_userbyid(d.datdba) AS owner, coalesce(d.datacl, acldefault('d', d.datdba)) AS acl INTO db
    FROM pg_database d WHERE d.datname = current_database();
  IF db.owner <> 'postgres' THEN
    RAISE EXCEPTION 'read-back: database owner is %', db.owner;
  END IF;
  IF (SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = 'public') NOT IN ('postgres', 'pg_database_owner') THEN
    RAISE EXCEPTION 'read-back: schema public is not effectively owned by postgres';
  END IF;
  IF pg_has_role('devcontrol', 'pg_database_owner', 'MEMBER') THEN
    RAISE EXCEPTION 'read-back: devcontrol is still a member of pg_database_owner';
  END IF;
  IF has_database_privilege('devcontrol', db.oid, 'CREATE') OR has_database_privilege('devcontrol', db.oid, 'TEMPORARY')
     OR has_schema_privilege('devcontrol', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'read-back: devcontrol still has CREATE or TEMPORARY on the database, or CREATE on public';
  END IF;
  IF NOT has_database_privilege('devcontrol', db.oid, 'CONNECT') OR NOT has_schema_privilege('devcontrol', 'public', 'USAGE') THEN
    RAISE EXCEPTION 'read-back: devcontrol lost CONNECT on the database or USAGE on public';
  END IF;
  IF EXISTS (SELECT 1 FROM aclexplode(db.acl) a WHERE a.grantee = 0 AND a.privilege_type IN ('CREATE', 'TEMPORARY'))
     OR EXISTS (SELECT 1 FROM pg_namespace n, aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
                 WHERE n.nspname = 'public' AND a.grantee = 0 AND a.privilege_type = 'CREATE') THEN
    RAISE EXCEPTION 'read-back: PUBLIC still has CREATE/TEMPORARY on the database or CREATE on public';
  END IF;

  SELECT prior_state INTO STRICT prior FROM public.admin_migration_prior_state
   WHERE migration_name = '202611091300_harden_database_ownership.sql';
  SELECT md5(coalesce(string_agg(c.relname || '|' || c.relkind::text || '|' || pg_get_userbyid(c.relowner)
                                 || '|' || coalesce(c.relacl::text, ''), ';' ORDER BY c.relname), ''))
    INTO relations_now
    FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace
     AND c.relname NOT IN ('nl_query_analytics', 'idx_nl_analytics_org_created', 'idx_nl_analytics_query',
                           'nl_query_analytics_pkey', 'admin_migration_prior_state', 'admin_migration_prior_state_pkey');
  IF relations_now <> prior->>'relations_md5' THEN
    RAISE EXCEPTION 'read-back: an owner or ACL of an existing relation in public changed';
  END IF;

  IF to_regclass('public.nl_query_analytics') IS NULL OR to_regclass('public.idx_nl_analytics_org_created') IS NULL
     OR to_regclass('public.idx_nl_analytics_query') IS NULL THEN
    RAISE EXCEPTION 'read-back: nl_query_analytics or one of its indexes is missing';
  END IF;
  IF NOT (has_table_privilege('devcontrol', 'public.nl_query_analytics', 'SELECT')
          AND has_table_privilege('devcontrol', 'public.nl_query_analytics', 'INSERT')) THEN
    RAISE EXCEPTION 'read-back: devcontrol cannot SELECT and INSERT nl_query_analytics';
  END IF;

  SELECT p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) AS owner, p.prosrc INTO fn
    FROM pg_proc p WHERE p.oid = 'public.initialize_onboarding_for_organization()'::regprocedure;
  IF NOT fn.prosecdef OR fn.owner <> 'postgres'
     OR fn.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, pg_temp'] THEN
    RAISE EXCEPTION 'read-back: function secdef % owner % config %', fn.prosecdef, fn.owner, fn.proconfig;
  END IF;
  IF fn.prosrc !~ 'INSERT INTO public\.onboarding_progress' OR fn.prosrc ~ 'INTO onboarding_progress' THEN
    RAISE EXCEPTION 'read-back: the function body does not schema-qualify onboarding_progress';
  END IF;
END $$;
