-- Rollback: home-region proposal columns on aws_connection_checks (home region HR-0)
-- Paired with: 202611161200_add_aws_connection_checks_home_region_proposal.sql
--
-- Manual only. database/migrate.js never runs a file whose name contains
-- "rollback", and CI's schema bootstrap skips it too. Run it as the postgres
-- role in ONE transaction, stopping at the first error:
--
--   psql -v ON_ERROR_STOP=1 --single-transaction -d <database> \
--     -f 202611161200_add_aws_connection_checks_home_region_proposal_rollback.sql
--
-- Run it only AFTER the application has been reverted to a release before
-- home region HR-1. That release reads the columns fail-soft, but its
-- proposal writes and the owner's dismiss would stop working.
--
-- What is lost: every connection's home-region proposal, its state and its
-- times. The home region itself (aws_accounts.region) and its change history
-- (audit_logs) are not touched; every other column and row of
-- aws_connection_checks is kept.
--
-- Removes only the three constraints and four columns carrying the paired
-- migration's marker, and its schema_migrations row. Refuses unless all seven
-- carry it. No statement uses CASCADE.

SET LOCAL lock_timeout = '3s';

DO $$
DECLARE
  marker CONSTANT TEXT := '[202611161200_add_aws_connection_checks_home_region_proposal]';
BEGIN
  IF to_regclass('public.aws_connection_checks') IS NULL THEN
    RAISE EXCEPTION 'aws_connection_checks does not exist -- refusing to roll back.';
  END IF;
  IF (SELECT count(*) FROM pg_attribute
       WHERE attrelid = 'public.aws_connection_checks'::regclass AND NOT attisdropped
         AND attname IN ('home_region_proposal', 'home_region_proposal_state', 'home_region_proposed_at', 'home_region_decided_at')
         AND starts_with(COALESCE(col_description(attrelid, attnum), ''), marker)) <> 4 THEN
    RAISE EXCEPTION 'the home_region_* columns are absent or were not all created by the paired migration -- refusing to roll back.';
  END IF;
  IF (SELECT count(*) FROM pg_constraint
       WHERE conrelid = 'public.aws_connection_checks'::regclass
         AND conname IN ('aws_connection_checks_home_region_proposal_object',
                         'aws_connection_checks_home_region_proposal_state',
                         'aws_connection_checks_home_region_proposal_complete')
         AND starts_with(COALESCE(obj_description(oid, 'pg_constraint'), ''), marker)) <> 3 THEN
    RAISE EXCEPTION 'the home-region proposal constraints are absent or were not all created by the paired migration -- refusing to roll back.';
  END IF;
END $$;

ALTER TABLE public.aws_connection_checks
  DROP CONSTRAINT aws_connection_checks_home_region_proposal_complete,
  DROP CONSTRAINT aws_connection_checks_home_region_proposal_state,
  DROP CONSTRAINT aws_connection_checks_home_region_proposal_object,
  DROP COLUMN home_region_decided_at,
  DROP COLUMN home_region_proposed_at,
  DROP COLUMN home_region_proposal_state,
  DROP COLUMN home_region_proposal;

DELETE FROM schema_migrations
 WHERE migration_name = '202611161200_add_aws_connection_checks_home_region_proposal.sql';

DO $$ BEGIN
  RAISE NOTICE 'Rolled back 202611161200_add_aws_connection_checks_home_region_proposal.sql';
END $$;
