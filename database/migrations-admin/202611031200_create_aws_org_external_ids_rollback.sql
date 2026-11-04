-- Rollback: remove aws_org_external_ids
-- Paired with: 202611031200_create_aws_org_external_ids.sql
--
-- Manual only. database/migrate.js never runs a file whose name contains
-- "rollback", and CI's schema bootstrap skips it too. Run it as the postgres
-- role in ONE transaction, stopping at the first error, AFTER the application
-- has been reverted to a release that does not read this table:
--
--   psql -v ON_ERROR_STOP=1 --single-transaction -d <database> \
--     -f 202611031200_create_aws_org_external_ids_rollback.sql
--
-- What is lost: each organization's stable External ID record. Existing
-- connections are unaffected, because aws_accounts.external_id still holds the
-- value each one's AssumeRole sends. The reverted application goes back to
-- one-hour aws_connect_sessions values. An organization that set up a role with
-- the stable value but has not connected yet must then update the role's trust
-- policy to the value the page shows.
--
-- Removes only what the paired migration created, and its schema_migrations
-- row. No statement uses CASCADE.

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  marker CONSTANT TEXT := '[202611031200_create_aws_org_external_ids]';
BEGIN
  IF to_regclass('aws_org_external_ids') IS NULL THEN
    RAISE NOTICE 'aws_org_external_ids does not exist; skipped.';
  ELSIF NOT starts_with(COALESCE(obj_description(to_regclass('aws_org_external_ids'), 'pg_class'), ''), marker) THEN
    RAISE EXCEPTION 'aws_org_external_ids was not created by the paired migration (no marker) -- refusing to drop it.';
  ELSE
    DROP TABLE aws_org_external_ids;
  END IF;
END $$;

DROP FUNCTION IF EXISTS aws_org_external_ids_refuse_update();

DELETE FROM schema_migrations
 WHERE migration_name = '202611031200_create_aws_org_external_ids.sql';

DO $$ BEGIN
  RAISE NOTICE 'Rolled back 202611031200_create_aws_org_external_ids.sql';
END $$;
