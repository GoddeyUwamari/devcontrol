-- Rollback: one free trial per organization
-- Paired with: 202611091200_add_trial_used_at.sql
--
-- Manual only. database/migrate.js never runs a file whose name contains
-- "rollback", and CI's schema bootstrap skips it too. Run it as the postgres
-- role in ONE transaction, stopping at the first error:
--
--   psql -v ON_ERROR_STOP=1 --single-transaction -d <database> \
--     -f 202611091200_add_trial_used_at_rollback.sql
--
-- Run it only with an application release that does not use the trial
-- columns (any release before the trial PR).
--
-- What is lost: the record of which organizations already used their free
-- trial. After a re-apply those organizations could be offered a second
-- trial. Export the used rows to a private file first if any exist (the
-- founder script does this).
--
-- Removes only objects carrying the paired migration's marker, and its
-- schema_migrations row. No statement uses CASCADE.

SET LOCAL lock_timeout = '3s';

DO $$
DECLARE
  marker CONSTANT TEXT := '[202611091200_add_trial_used_at]';
  col TEXT;
BEGIN
  FOREACH col IN ARRAY ARRAY['trial_used_at', 'trial_subscription_id'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute
       WHERE attrelid = 'organizations'::regclass AND attname = col AND NOT attisdropped
         AND starts_with(COALESCE(col_description('organizations'::regclass, attnum), ''), marker)
    ) THEN
      RAISE EXCEPTION 'organizations.% is absent or was not created by the paired migration -- refusing to roll back.', col;
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'organizations_trial_claim_complete' AND conrelid = 'organizations'::regclass
       AND starts_with(COALESCE(obj_description(oid, 'pg_constraint'), ''), marker)
  ) THEN
    RAISE EXCEPTION 'organizations_trial_claim_complete is absent or was not created by the paired migration -- refusing to roll back.';
  END IF;
END $$;

ALTER TABLE organizations DROP CONSTRAINT organizations_trial_claim_complete;

ALTER TABLE organizations
  DROP COLUMN trial_subscription_id,
  DROP COLUMN trial_used_at;

DELETE FROM schema_migrations
 WHERE migration_name = '202611091200_add_trial_used_at.sql';

DO $$ BEGIN
  RAISE NOTICE 'Rolled back 202611091200_add_trial_used_at.sql';
END $$;
