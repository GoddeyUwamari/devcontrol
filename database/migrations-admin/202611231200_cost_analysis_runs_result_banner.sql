-- Migration: 202611231200_cost_analysis_runs_result_banner.sql
--
-- The Cost Optimization scan result banner (founder-locked behaviour,
-- 2026-11-23): a manual "Run cost analysis" run's result is shown to the user
-- who started it, once, until seen or closed, on any device. Adds to
-- cost_analysis_runs:
--
--   initiated_by_user_id    the user who pressed Run cost analysis. NULL for
--                           discovery (scheduled) runs and every existing row,
--                           so no run from before this migration ever shows a
--                           banner. Deliberately no foreign key, like
--                           discovery_job_id: one would lock users for no
--                           behaviour the application relies on; a deleted
--                           user's run is simply never shown.
--   result_acknowledged_at  when that user saw or closed the result. NULL = not
--                           yet. Only the initiator sets it (every statement is
--                           also scoped to the organization).
--   open_count              ACTIVE findings right after the manual run
--                           reconciled: "K still open from earlier" is
--                           open_count - new_count, frozen at the run.
--                           NULL = not recorded, never 0.
--
-- ADDITIVE ONLY, and safe BEFORE the code that uses it is deployed: three
-- nullable columns with no default, no constraint, no index (the lookup uses
-- idx_cost_analysis_runs_org_source_created). The deployed application keeps
-- inserting and updating as it does today.
--
-- ADMINISTRATIVE MIGRATION (see README.md): cost_analysis_runs is owned by
-- postgres (202611101200_transfer_tenant_table_ownership.sql). Applied by the
-- founder, as postgres, BEFORE the code is merged. Owner, grants and row-level
-- security are unchanged: devcontrol's table-level SELECT, INSERT, UPDATE
-- cover the new columns.
--
--   psql -v ON_ERROR_STOP=1 --single-transaction -d <database> \
--     -f 202611231200_cost_analysis_runs_result_banner.sql
--
-- Written for PostgreSQL 14 and later.

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.cost_analysis_runs'::regclass
       AND attname IN ('initiated_by_user_id', 'result_acknowledged_at', 'open_count')
       AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'cost_analysis_runs already has a result banner column -- refusing to proceed. Investigate before re-running.';
  END IF;
END $$;

ALTER TABLE public.cost_analysis_runs
  ADD COLUMN initiated_by_user_id UUID,
  ADD COLUMN result_acknowledged_at TIMESTAMPTZ,
  ADD COLUMN open_count INTEGER;

COMMENT ON COLUMN public.cost_analysis_runs.initiated_by_user_id IS
  '[202611231200_cost_analysis_runs_result_banner] The user who started a manual run (POST /analyze). NULL for discovery runs and rows before this migration. No foreign key, like discovery_job_id.';
COMMENT ON COLUMN public.cost_analysis_runs.result_acknowledged_at IS
  '[202611231200_cost_analysis_runs_result_banner] When the initiating user saw or closed this run''s result banner. NULL = not yet shown. Only the initiator sets it.';
COMMENT ON COLUMN public.cost_analysis_runs.open_count IS
  '[202611231200_cost_analysis_runs_result_banner] ACTIVE findings in the organization right after this manual run reconciled. NULL means not recorded, never 0.';

-- Self-check before commit: three marked, nullable columns of the right types, no defaults.
DO $$
DECLARE
  found_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO found_count
    FROM pg_attribute
   WHERE attrelid = 'public.cost_analysis_runs'::regclass AND NOT attisdropped
     AND NOT attnotnull AND NOT atthasdef
     AND starts_with(COALESCE(col_description(attrelid, attnum), ''), '[202611231200_cost_analysis_runs_result_banner]')
     AND ((attname = 'initiated_by_user_id' AND atttypid = 'uuid'::regtype)
       OR (attname = 'result_acknowledged_at' AND atttypid = 'timestamptz'::regtype)
       OR (attname = 'open_count' AND atttypid = 'int4'::regtype));
  IF found_count <> 3 THEN
    RAISE EXCEPTION 'cost_analysis_runs result banner columns are not as expected (% of 3) -- refusing to commit.', found_count;
  END IF;
END $$;

DO $$ BEGIN
  RAISE NOTICE 'Migration 202611231200_cost_analysis_runs_result_banner completed';
END $$;
