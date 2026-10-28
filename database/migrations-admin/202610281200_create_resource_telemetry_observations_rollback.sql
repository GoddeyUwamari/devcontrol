-- Rollback: remove resource telemetry observation storage
-- Paired with: 202610281200_create_resource_telemetry_observations.sql
--
-- Manual only. database/migrate.js never runs a file whose name contains
-- "rollback" (getMigrationFiles()), so --execute-only cannot target this
-- file, and CI's schema bootstrap skips it too. Run it as the postgres role,
-- the same identity as the admin track, in ONE transaction and stopping at
-- the first error:
--
--   psql -v ON_ERROR_STOP=1 --single-transaction -d <database> \
--     -f 202610281200_create_resource_telemetry_observations_rollback.sql
--
-- The application keeps working without these tables (Last seen falls back
-- to the current window, checked at to this collection when it completed),
-- so no release has to be rolled back first. The stored history is
-- discarded.
--
-- Removes only what the paired migration created: the two tables and the
-- paired migration's own schema_migrations row. It never touches
-- aws_resources. No statement uses CASCADE: an unexpected dependent (a view,
-- another table's foreign key) makes the DROP fail, and the transaction rolls
-- back.

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  dependents TEXT;
BEGIN
  IF to_regclass('resource_telemetry_observations') IS NULL
     OR to_regclass('observability_collection_scopes') IS NULL THEN
    RAISE EXCEPTION
      'resource_telemetry_observations/observability_collection_scopes not found -- the paired migration '
      'is not applied here; nothing to roll back. Refusing to proceed.';
  END IF;

  SELECT string_agg(format('%s on %s', fk.conname, fk.conrelid::regclass), ', ')
    INTO dependents
    FROM pg_constraint fk
   WHERE fk.contype = 'f'
     AND fk.confrelid IN ('resource_telemetry_observations'::regclass, 'observability_collection_scopes'::regclass);
  IF dependents IS NOT NULL THEN
    RAISE EXCEPTION
      'the observation tables are referenced by other foreign keys (%) -- refusing to drop them.', dependents;
  END IF;
END $$;

DROP TABLE resource_telemetry_observations;
DROP TABLE observability_collection_scopes;

-- The paired migration's own ledger row only, so it can be applied again.
DELETE FROM schema_migrations
 WHERE migration_name = '202610281200_create_resource_telemetry_observations.sql';

DO $$
BEGIN
  RAISE NOTICE 'Rolled back 202610281200_create_resource_telemetry_observations.sql';
END $$;
