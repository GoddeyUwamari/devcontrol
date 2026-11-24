-- Rollback: remove the scan result banner columns from cost_analysis_runs
-- Paired with: 202611231200_cost_analysis_runs_result_banner.sql
--
-- Manual only. database/migrate.js never runs a file whose name contains
-- "rollback", and CI's schema bootstrap skips it too. Run it as the postgres
-- role in ONE transaction, stopping at the first error, AFTER the application
-- has been reverted to a release that does not read these columns:
--
--   psql -v ON_ERROR_STOP=1 --single-transaction -d <database> \
--     -f 202611231200_cost_analysis_runs_result_banner_rollback.sql
--
-- Discards on purpose: who started each manual run, whether its result was
-- seen, and its open count. Findings and runs themselves are untouched.
--
-- Removes only the three columns carrying the paired migration's marker, and
-- its schema_migrations row. REFUSES (nothing changed) unless all three are
-- present and marked. No statement uses CASCADE.

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  marker CONSTANT TEXT := '[202611231200_cost_analysis_runs_result_banner]';
  marked INTEGER;
BEGIN
  SELECT COUNT(*) INTO marked
    FROM pg_attribute
   WHERE attrelid = 'public.cost_analysis_runs'::regclass
     AND attname IN ('initiated_by_user_id', 'result_acknowledged_at', 'open_count')
     AND NOT attisdropped
     AND starts_with(COALESCE(col_description(attrelid, attnum), ''), marker);
  IF marked <> 3 THEN
    RAISE EXCEPTION 'cost_analysis_runs result banner columns are absent or were not created by the paired migration (% of 3 marked) -- refusing to roll back.', marked;
  END IF;
END $$;

ALTER TABLE public.cost_analysis_runs
  DROP COLUMN open_count,
  DROP COLUMN result_acknowledged_at,
  DROP COLUMN initiated_by_user_id;

DELETE FROM schema_migrations WHERE migration_name = '202611231200_cost_analysis_runs_result_banner.sql';

DO $$ BEGIN
  RAISE NOTICE 'Rolled back 202611231200_cost_analysis_runs_result_banner.sql';
END $$;
