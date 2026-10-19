-- Rollback: remove the multi-region scan foundation
-- Paired with: 202610191200_create_multi_region_scan_foundation.sql
--
-- Manual only. database/migrate.js never runs a file whose name contains
-- "rollback" (getMigrationFiles()), so --execute-only cannot target this
-- file, and CI's schema bootstrap skips it too. Run it as the postgres role,
-- the same identity as the admin track, in ONE transaction and stopping at
-- the first error:
--
--   psql -v ON_ERROR_STOP=1 --single-transaction -d <database> \
--     -f 202610191200_create_multi_region_scan_foundation_rollback.sql
--
-- Precondition: no deployed release reads or writes these objects (true until
-- M4/M5 code ships, since M3 adds no reader or writer).
--
-- Removes ONLY what the paired migration created, in dependency order (no new
-- table references another; the warnings column depends on nothing):
--   1. organization_feature_flags   DATA LOSS: every per-organization flag
--                                   value; every flag reads as OFF afterwards.
--   2. job_leases                   DATA LOSS: current job leases, their
--                                   fencing tokens and last_completed_at.
--   3. aws_scan_leases              DATA LOSS: current scan leases and their
--                                   fencing tokens (and the token sequence).
--   4. aws_account_regions          DATA LOSS: every recorded region list,
--                                   allow-list choice and per-region scan
--                                   status, time and error.
--   5. resource_discovery_jobs.warnings
--                                   DATA LOSS: every stored discovery warning.
--                                   The rest of the table is untouched.
--   6. the paired migration's own schema_migrations row, so it can be applied
--      again. No data loss.
--
-- Each step is guarded and RE-RUN SAFE: an object that is absent is skipped
-- with a NOTICE. A table is dropped only when its COMMENT starts with the
-- paired migration's marker, and the column only when ITS comment does (the
-- migration writes the column comment only when it added the column), so a
-- same-named object this migration did not create is never dropped. Indexes,
-- policies, constraints and identity sequences go with their tables.
-- No statement uses CASCADE: an unexpected dependent (a view, another table's
-- foreign key) makes the DROP fail, and the transaction rolls back.

SET LOCAL lock_timeout = '5s';

-- Steps 1-4: the four tables.
DO $$
DECLARE
  marker CONSTANT TEXT := '[202610191200_create_multi_region_scan_foundation]';
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['organization_feature_flags', 'job_leases', 'aws_scan_leases', 'aws_account_regions'] LOOP
    IF to_regclass(t) IS NULL THEN
      RAISE NOTICE '% does not exist; skipped.', t;
    ELSIF COALESCE(obj_description(to_regclass(t), 'pg_class'), '') NOT LIKE marker || '%' THEN
      RAISE NOTICE '% was not created by the paired migration (no marker); left in place.', t;
    ELSE
      EXECUTE format('DROP TABLE %I', t);
      RAISE NOTICE 'Dropped %.', t;
    END IF;
  END LOOP;
END $$;

-- Step 5: resource_discovery_jobs.warnings.
DO $$
DECLARE
  marker CONSTANT TEXT := '[202610191200_create_multi_region_scan_foundation]';
  col_attnum SMALLINT;
BEGIN
  IF to_regclass('resource_discovery_jobs') IS NULL THEN
    RAISE NOTICE 'resource_discovery_jobs does not exist; skipped.';
    RETURN;
  END IF;
  SELECT attnum INTO col_attnum FROM pg_attribute
   WHERE attrelid = 'resource_discovery_jobs'::regclass AND attname = 'warnings' AND NOT attisdropped;
  IF col_attnum IS NULL THEN
    RAISE NOTICE 'resource_discovery_jobs.warnings does not exist; skipped.';
  ELSIF COALESCE(col_description('resource_discovery_jobs'::regclass, col_attnum), '') NOT LIKE marker || '%' THEN
    RAISE NOTICE 'resource_discovery_jobs.warnings was not added by the paired migration (no marker); left in place.';
  ELSE
    ALTER TABLE resource_discovery_jobs DROP COLUMN IF EXISTS warnings;
    RAISE NOTICE 'Dropped resource_discovery_jobs.warnings.';
  END IF;
END $$;

-- Step 6: the paired migration's own ledger row only.
DO $$
BEGIN
  IF to_regclass('schema_migrations') IS NOT NULL THEN
    DELETE FROM schema_migrations
     WHERE migration_name = '202610191200_create_multi_region_scan_foundation.sql';
  END IF;
  RAISE NOTICE 'Rolled back 202610191200_create_multi_region_scan_foundation.sql';
END $$;
