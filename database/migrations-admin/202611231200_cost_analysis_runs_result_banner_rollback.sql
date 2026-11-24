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
-- Removes only what the paired migration added, and its schema_migrations row.
-- No statement uses CASCADE.

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.cost_analysis_runs
  DROP COLUMN open_count,
  DROP COLUMN result_acknowledged_at,
  DROP COLUMN initiated_by_user_id;

DELETE FROM schema_migrations WHERE migration_name = '202611231200_cost_analysis_runs_result_banner.sql';
