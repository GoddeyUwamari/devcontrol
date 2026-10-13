-- Rollback: remove framework evaluation persistence
-- Paired with: 202610112300_create_framework_evaluation_persistence.sql
--
-- Manual only. database/migrate.js never runs a file whose name contains
-- "rollback" (getMigrationFiles()), and CI's schema bootstrap skips it too.
-- Run it as the postgres role, in ONE transaction, stopping at the first error:
--
--   psql -v ON_ERROR_STOP=1 --single-transaction -d <database> \
--     -f 202610112300_create_framework_evaluation_persistence_rollback.sql
--
-- Precondition: no deployed release reads or writes these tables. Stored
-- evaluations are discarded; the next scan of a release that has the tables
-- regenerates them. aws_resources.compliance_issues is not touched.
--
-- Removes only what the paired migration created, and refuses (instead of
-- cascading) when anything else depends on it:
--   - the three tables;
--   - aws_resources_compliance_evaluation_ref_key, only if the paired migration
--     added it (it does not when a suitable constraint already existed) and no
--     other foreign key has come to use it; otherwise it is left in place and
--     reported. aws_resources_id_org_unique, or any other constraint the paired
--     migration reused, is never dropped;
--   - the paired migration's own schema_migrations row, and no other.
-- No statement uses CASCADE.

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  dependents TEXT;
BEGIN
  IF to_regclass('framework_evaluation_runs') IS NULL
     OR to_regclass('compliance_check_evaluations') IS NULL
     OR to_regclass('framework_evaluation_reconciliations') IS NULL THEN
    RAISE EXCEPTION
      'framework evaluation tables not found -- the paired migration is not applied here; '
      'nothing to roll back. Refusing to proceed.';
  END IF;

  -- Foreign keys from any other table into the three tables being dropped.
  SELECT string_agg(format('%s on %s', fk.conname, fk.conrelid::regclass), ', ')
    INTO dependents
    FROM pg_constraint fk
   WHERE fk.contype = 'f'
     AND fk.confrelid IN ('framework_evaluation_runs'::regclass,
                          'compliance_check_evaluations'::regclass,
                          'framework_evaluation_reconciliations'::regclass)
     AND fk.conrelid NOT IN ('framework_evaluation_runs'::regclass,
                             'compliance_check_evaluations'::regclass,
                             'framework_evaluation_reconciliations'::regclass);
  IF dependents IS NOT NULL THEN
    RAISE EXCEPTION 'framework evaluation tables are referenced by other foreign keys (%) -- refusing to drop them.', dependents;
  END IF;

END $$;

DROP TABLE framework_evaluation_reconciliations;
DROP TABLE compliance_check_evaluations;
DROP TABLE framework_evaluation_runs;

-- Only the constraint this migration added, only if it added one, and only if
-- nothing else has come to depend on it since (another table's foreign key over
-- the same columns may have been bound to it). In that case it is left in place
-- and reported, rather than dropped from under its dependent.
DO $$
DECLARE
  dependents TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'aws_resources_compliance_evaluation_ref_key' AND conrelid = 'aws_resources'::regclass
  ) THEN
    RAISE NOTICE 'aws_resources_compliance_evaluation_ref_key was not added by the paired migration here; nothing to drop.';
    RETURN;
  END IF;

  SELECT string_agg(format('%s on %s', fk.conname, fk.conrelid::regclass), ', ')
    INTO dependents
    FROM pg_constraint fk
    JOIN pg_constraint uq
      ON uq.conname = 'aws_resources_compliance_evaluation_ref_key' AND uq.conrelid = 'aws_resources'::regclass
   WHERE fk.contype = 'f' AND fk.conindid = uq.conindid;

  IF dependents IS NOT NULL THEN
    RAISE NOTICE 'aws_resources_compliance_evaluation_ref_key is used by other foreign keys (%); left in place.', dependents;
  ELSE
    ALTER TABLE aws_resources DROP CONSTRAINT aws_resources_compliance_evaluation_ref_key;
  END IF;
END $$;

-- The paired migration's own ledger row only, so it can be applied again.
DELETE FROM schema_migrations
 WHERE migration_name = '202610112300_create_framework_evaluation_persistence.sql';

DO $$
BEGIN
  RAISE NOTICE 'Rolled back 202610112300_create_framework_evaluation_persistence.sql';
END $$;
