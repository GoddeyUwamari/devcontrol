-- Migration: pin the search_path of initialize_onboarding_for_organization()
-- and remove TEMPORARY on the database from PUBLIC and devcontrol.
--
-- initialize_onboarding_for_organization() is the AFTER INSERT trigger on
-- organizations (009_create_onboarding_progress.sql) that creates the new
-- organization's onboarding_progress row. In production it runs as a
-- postgres-owned SECURITY DEFINER function, which is why registration can
-- create that row with no tenant tag set. This migration gives every
-- environment that same shape and adds the standard hardening for a
-- SECURITY DEFINER function:
--
--   * SET search_path = pg_catalog, public, pg_temp (pinned on the function);
--   * every table and function reference schema-qualified;
--   * owner postgres, SECURITY DEFINER, same body and the same effect: one
--     public.onboarding_progress row per new organization, ON CONFLICT
--     (organization_id) DO NOTHING.
--
-- TEMPORARY on the database is revoked from PUBLIC and from devcontrol. No
-- application, job, script or migration creates temporary tables (checked
-- for CREATE TEMP/TEMPORARY, ON COMMIT and pg_temp); superusers are not
-- affected by the revoke.
--
-- Administrative: CREATE OR REPLACE FUNCTION on a postgres-owned function and
-- REVOKE on the database need the owner, so this runs as postgres. One
-- transaction (database/migrate.js), 3 s lock timeout. It takes no lock on
-- organizations. It refuses to run unless the function's current body is
-- 009's (whitespace aside), so "identical behaviour" is checked, not assumed.
-- Paired rollback: 202611091300_pin_onboarding_trigger_search_path_rollback.sql.

SET LOCAL lock_timeout = '3s';

DO $$
DECLARE
  fn record;
  expected_body constant text :=
    'BEGIN -- When a new organization is created, initialize onboarding INSERT INTO onboarding_progress '
    || '( organization_id, user_id, current_stage, started_at ) VALUES ( NEW.id, NULL, -- Will be set when '
    || 'first user accesses ''welcome'', NOW() ) ON CONFLICT (organization_id) DO NOTHING; RETURN NEW; END;';
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'must run as a superuser (current_user %) -- refusing to proceed.', current_user;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres' AND rolsuper) THEN
    RAISE EXCEPTION 'role postgres is missing or not a superuser -- refusing to proceed.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'devcontrol') THEN
    RAISE EXCEPTION 'role devcontrol does not exist -- refusing to proceed.';
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
END $$;

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

DO $$
BEGIN
  EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM devcontrol', current_database());
END $$;

-- Read-back: fail the transaction unless the end state is exact.
DO $$
DECLARE fn record;
BEGIN
  SELECT p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) AS owner, p.prosrc INTO fn
    FROM pg_proc p WHERE p.oid = 'public.initialize_onboarding_for_organization()'::regprocedure;
  IF NOT fn.prosecdef OR fn.owner <> 'postgres'
     OR fn.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, public, pg_temp'] THEN
    RAISE EXCEPTION 'read-back: function secdef % owner % config %', fn.prosecdef, fn.owner, fn.proconfig;
  END IF;
  IF fn.prosrc !~ 'INSERT INTO public\.onboarding_progress' OR fn.prosrc ~ 'INTO onboarding_progress' THEN
    RAISE EXCEPTION 'read-back: the function body does not schema-qualify onboarding_progress';
  END IF;
  IF has_database_privilege('devcontrol', current_database(), 'TEMPORARY') THEN
    RAISE EXCEPTION 'read-back: devcontrol still has TEMPORARY on %', current_database();
  END IF;
  IF EXISTS (SELECT 1 FROM pg_database d, aclexplode(d.datacl) a
              WHERE d.datname = current_database() AND a.grantee = 0 AND a.privilege_type = 'TEMPORARY') THEN
    RAISE EXCEPTION 'read-back: PUBLIC still has TEMPORARY on %', current_database();
  END IF;
END $$;
