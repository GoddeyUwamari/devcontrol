-- Rollback: demo workspace foundation (T2)
-- Paired with: 202611141200_demo_workspace_foundation.sql
--
-- Manual only. database/migrate.js never runs a file whose name contains
-- "rollback", and CI's schema bootstrap skips it too. Run it as the postgres
-- role in ONE transaction, stopping at the first error:
--
--   psql -v ON_ERROR_STOP=1 --single-transaction -d <database> \
--     -f 202611141200_demo_workspace_foundation_rollback.sql
--
-- Run it only AFTER the application has been reverted to a release that does
-- not read organizations.is_demo (any release before PR-1a). PR-1a's jobs and
-- metrics select organizations with "NOT o.is_demo": with the column gone they
-- fail.
--
-- REFUSES while any organization has is_demo = true. Dropping the column would
-- turn the demo organization into an ordinary one, with none of the
-- protections (no CHECK, no refusals, back in every job's selection, and its
-- placeholder AWS row in front of discovery). Delete the demo organization
-- first, deliberately.
--
-- What is lost: every demo access grant (demo_workspace_access is dropped;
-- export it first if the list matters). No other row of any table changes:
-- organizations keeps every other column and row.
--
-- Removes only objects carrying the paired migration's marker, and its
-- schema_migrations row. No statement uses CASCADE.

SET LOCAL lock_timeout = '3s';

DO $$
DECLARE
  marker CONSTANT TEXT := '[202611141200_demo_workspace_foundation]';
  t TEXT;
BEGIN
  IF current_setting('is_superuser') <> 'on' THEN
    RAISE EXCEPTION 'run as a superuser (postgres) -- refusing to roll back.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.organizations'::regclass AND attname = 'is_demo' AND NOT attisdropped
       AND starts_with(COALESCE(col_description(attrelid, attnum), ''), marker)
  ) THEN
    RAISE EXCEPTION 'organizations.is_demo is absent or was not created by the paired migration -- refusing to roll back.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.organizations WHERE is_demo) THEN
    RAISE EXCEPTION 'a demo organization exists: delete it first (dropping is_demo would make it an ordinary organization) -- refusing to roll back.';
  END IF;
  IF to_regclass('public.demo_workspace_access') IS NULL
     OR NOT starts_with(COALESCE(obj_description('public.demo_workspace_access'::regclass, 'pg_class'), ''), marker) THEN
    RAISE EXCEPTION 'demo_workspace_access is absent or was not created by the paired migration -- refusing to roll back.';
  END IF;
  IF NOT starts_with(COALESCE(obj_description('public.organizations_single_demo_uidx'::regclass, 'pg_class'), ''), marker) THEN
    RAISE EXCEPTION 'organizations_single_demo_uidx was not created by the paired migration -- refusing to roll back.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.organizations'::regclass
                  AND conname = 'organizations_demo_holds_no_billing_or_credentials'
                  AND starts_with(COALESCE(obj_description(oid, 'pg_constraint'), ''), marker)) THEN
    RAISE EXCEPTION 'organizations_demo_holds_no_billing_or_credentials is absent or unmarked -- refusing to roll back.';
  END IF;
  FOREACH t IN ARRAY ARRAY['demo_workspace_flag_immutable', 'demo_workspace_access_requires_demo',
                           'demo_workspace_refuse_row', 'demo_workspace_constrain_aws_account'] LOOP
    IF NOT starts_with(COALESCE(obj_description(('public.' || t || '()')::regprocedure, 'pg_proc'), ''), marker) THEN
      RAISE EXCEPTION 'function % is unmarked -- refusing to roll back.', t;
    END IF;
  END LOOP;
  -- Nothing but the paired migration's own triggers may use its functions.
  IF EXISTS (SELECT 1 FROM pg_trigger tg JOIN pg_proc p ON p.oid = tg.tgfoid
              WHERE p.proname LIKE 'demo\_workspace\_%' AND p.pronamespace = 'public'::regnamespace
                AND NOT starts_with(COALESCE(obj_description(tg.oid, 'pg_trigger'), ''), marker)) THEN
    RAISE EXCEPTION 'an unmarked trigger uses a demo_workspace_* function -- refusing to roll back.';
  END IF;
END $$;

DROP TRIGGER demo_workspace_refuse_row ON public.organization_invitations;
DROP TRIGGER demo_workspace_refuse_row ON public.scheduled_reports;
DROP TRIGGER demo_workspace_refuse_row ON public.observability_collection_scopes;
DROP TRIGGER demo_workspace_refuse_row ON public.aws_org_external_ids;
DROP TRIGGER demo_workspace_refuse_row ON public.aws_connection_checks;
DO $$
BEGIN
  IF to_regclass('public.aws_accounts') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS demo_workspace_constrain_aws_account ON public.aws_accounts';
  END IF;
END $$;
DROP TRIGGER demo_workspace_access_requires_demo ON public.demo_workspace_access;
DROP TRIGGER organizations_demo_flag_immutable ON public.organizations;

DROP FUNCTION public.demo_workspace_refuse_row();
DROP FUNCTION public.demo_workspace_constrain_aws_account();
DROP FUNCTION public.demo_workspace_access_requires_demo();
DROP FUNCTION public.demo_workspace_flag_immutable();

DROP TABLE public.demo_workspace_access;

ALTER TABLE public.organizations DROP CONSTRAINT organizations_demo_holds_no_billing_or_credentials;
DROP INDEX public.organizations_single_demo_uidx;
ALTER TABLE public.organizations DROP COLUMN is_demo;

DELETE FROM schema_migrations
 WHERE migration_name = '202611141200_demo_workspace_foundation.sql';

DO $$ BEGIN
  RAISE NOTICE 'Rolled back 202611141200_demo_workspace_foundation.sql';
END $$;
