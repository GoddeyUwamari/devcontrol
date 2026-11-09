-- Rollback: 202611091300_pin_onboarding_trigger_search_path.sql
--
-- Restores the pre-migration production shape: the 009 body (unqualified),
-- postgres-owned SECURITY DEFINER with no function-level search_path, and
-- TEMPORARY on the database for PUBLIC (the default, which also covers
-- devcontrol). Use only if the migration itself breaks registration: it
-- removes the hardening. Run as postgres in one transaction:
--
--   psql -X -v ON_ERROR_STOP=1 --single-transaction -d <database> \
--     -f 202611091300_pin_onboarding_trigger_search_path_rollback.sql
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

ALTER FUNCTION public.initialize_onboarding_for_organization() OWNER TO postgres;

DO $$
BEGIN
  EXECUTE format('GRANT TEMPORARY ON DATABASE %I TO PUBLIC', current_database());
END $$;

DELETE FROM schema_migrations WHERE migration_name = '202611091300_pin_onboarding_trigger_search_path.sql';
