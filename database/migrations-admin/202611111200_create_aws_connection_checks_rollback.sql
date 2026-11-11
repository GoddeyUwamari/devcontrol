-- Rollback: remove aws_connection_checks (AWS connect PR D1a)
-- Paired with: 202611111200_create_aws_connection_checks.sql
--
-- Manual only. database/migrate.js never runs a file whose name contains
-- "rollback", and CI's schema bootstrap skips it too. Run it as the postgres
-- role in ONE transaction, stopping at the first error, AFTER the application
-- has been reverted to a release that does not use this table:
--
--   psql -v ON_ERROR_STOP=1 --single-transaction -d <database> \
--     -f 202611111200_create_aws_connection_checks_rollback.sql
--
-- (The application tolerates the table being absent: health shows "not checked
-- yet", nothing fails. Rolling back with D1a deployed is therefore safe, but it
-- loses every recorded health result, saved check and role ID.)
--
-- What is lost: the rows of aws_connection_checks. Nothing else: aws_accounts
-- keeps every row; only the index this migration added to it is dropped.
--
-- Removes only what the paired migration created (each checked by its marker
-- comment), and its schema_migrations row. No statement uses CASCADE.

SET LOCAL lock_timeout = '3s';

DO $$
DECLARE
  marker CONSTANT TEXT := '[202611111200_create_aws_connection_checks]';
BEGIN
  IF to_regclass('public.aws_connection_checks') IS NULL THEN
    RAISE NOTICE 'aws_connection_checks does not exist; skipped.';
  ELSIF NOT starts_with(COALESCE(obj_description(to_regclass('public.aws_connection_checks'), 'pg_class'), ''), marker) THEN
    RAISE EXCEPTION 'aws_connection_checks was not created by the paired migration (no marker) -- refusing to drop it.';
  ELSE
    -- Its foreign key to aws_accounts goes with it.
    DROP TABLE public.aws_connection_checks;
  END IF;

  IF to_regclass('public.aws_accounts_id_org_uidx') IS NULL THEN
    RAISE NOTICE 'aws_accounts_id_org_uidx does not exist; skipped.';
  ELSIF NOT starts_with(COALESCE(obj_description(to_regclass('public.aws_accounts_id_org_uidx'), 'pg_class'), ''), marker) THEN
    RAISE EXCEPTION 'aws_accounts_id_org_uidx was not created by the paired migration (no marker) -- refusing to drop it.';
  ELSE
    DROP INDEX public.aws_accounts_id_org_uidx;
  END IF;
END $$;

DELETE FROM schema_migrations
 WHERE migration_name = '202611111200_create_aws_connection_checks.sql';

DO $$ BEGIN
  RAISE NOTICE 'Rolled back 202611111200_create_aws_connection_checks.sql';
END $$;
